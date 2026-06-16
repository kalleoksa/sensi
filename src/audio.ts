// Procedural sound — no audio assets, matching the project's generate-at-boot
// ethos. One AudioContext; every SFX is synthesized from oscillators + filtered
// noise shaped by gain envelopes, plus a looped crowd bed.
//
// The sim never plays sound directly: it pushes events via emitSfx(), and the
// loop calls flushSfx() once per rendered frame to realize them. Audio is a
// pure side-effect sink — it never reads back into game state or the seeded
// PRNG, so the fixed-step sim stays fully deterministic. emitSfx() is a cheap
// array push that costs the same whether or not audio is running.

export type SfxName =
  | 'pass'
  | 'shot'
  | 'bounce'
  | 'slide'
  | 'tackle'
  | 'whistleKick'
  | 'whistleGoal'
  | 'whistleOut'
  | 'goal';

interface SfxEvent {
  name: SfxName;
  gain: number; // 0..1 relative intensity
}

const QUEUE_CAP = 32;
const queue: SfxEvent[] = [];

// Minimum seconds between two plays of the same sound (anti machine-gun).
const MIN_INTERVAL: Record<SfxName, number> = {
  pass: 0.05,
  shot: 0.05,
  bounce: 0.06,
  slide: 0.15,
  tackle: 0.1,
  whistleKick: 0.5,
  whistleGoal: 0.5,
  whistleOut: 0.4,
  goal: 1,
};

const VOLUME_KEY = 'sensi.volume';
const MUTE_KEY = 'sensi.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let crowdGain: GainNode | null = null;
let crowdTarget = 0;
let noise: AudioBuffer | null = null; // shared white-noise source buffer
let volume = 0.5;
let muted = false;
let badge: HTMLElement | null = null;
const lastPlayed: Partial<Record<SfxName, number>> = {};

// --- setup ------------------------------------------------------------------

// Wire gesture + mute listeners. The context itself is created lazily on the
// first user gesture (browsers block audio until then; this also unlocks iOS).
export function initAudio(): void {
  // Guard against an absent key: Number(null) is 0, which would otherwise pass
  // the 0..1 check and silence audio for every first-time visitor.
  const storedRaw = localStorage.getItem(VOLUME_KEY);
  if (storedRaw !== null) {
    const stored = Number(storedRaw);
    if (stored >= 0 && stored <= 1) volume = stored;
  }
  muted = localStorage.getItem(MUTE_KEY) === '1';

  const unlock = (): void => {
    ensureContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
    updateBadge();
  };
  // Cover every gesture type browsers accept for unlocking audio.
  for (const ev of ['keydown', 'pointerdown', 'touchstart']) {
    window.addEventListener(ev, unlock);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') setMuted(!muted);
  });

  makeBadge();
  updateBadge();
}

// A small on-screen indicator: makes the audio state observable — whether sound
// still needs a gesture to start, and whether it's muted.
function makeBadge(): void {
  badge = document.createElement('div');
  badge.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:10;font:12px/1.4 system-ui,sans-serif;' +
    'color:#ECF0E2;background:rgba(0,0,0,0.55);padding:4px 8px;border-radius:4px;' +
    'pointer-events:none;user-select:none;';
  document.body.appendChild(badge);
}

function updateBadge(): void {
  if (!badge) return;
  if (!ctx || ctx.state !== 'running') {
    badge.textContent = '🔇 click or press a key to enable sound';
    badge.style.display = '';
  } else if (muted) {
    badge.textContent = '🔇 muted — press M';
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();

  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  // A gentle limiter so layered hits don't clip.
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  ctx.onstatechange = updateBadge;

  // Shared 1s white-noise buffer for clicks/scrapes/crowd.
  const len = Math.floor(ctx.sampleRate);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  startCrowd();
  return ctx;
}

export function setMuted(m: boolean): void {
  muted = m;
  localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  if (ctx && master) master.gain.setTargetAtTime(m ? 0 : volume, ctx.currentTime, 0.02);
  updateBadge();
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  localStorage.setItem(VOLUME_KEY, String(volume));
  if (ctx && master && !muted) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}

// --- event queue ------------------------------------------------------------

export function emitSfx(name: SfxName, gain = 1): void {
  if (queue.length >= QUEUE_CAP) return;
  queue.push({ name, gain });
}

// Continuous crowd excitement, 0..1 (e.g. rises near the goals). Smoothed.
export function setCrowdIntensity(x: number): void {
  crowdTarget = Math.max(0, Math.min(1, x));
}

// Realize all queued sounds. Called once per rendered frame from the loop.
export function flushSfx(): void {
  // Best-effort resume in case a gesture happened but the context stuck suspended.
  if (ctx && ctx.state === 'suspended') void ctx.resume();
  if (!ctx || ctx.state !== 'running' || !master) {
    queue.length = 0; // drop anything queued before audio is unlocked
    return;
  }
  const now = ctx.currentTime;
  if (crowdGain) {
    const base = 0.015 + crowdTarget * 0.14;
    crowdGain.gain.setTargetAtTime(base, now, 0.25);
  }
  for (const e of queue) {
    const last = lastPlayed[e.name] ?? -Infinity;
    if (now - last < MIN_INTERVAL[e.name]) continue;
    lastPlayed[e.name] = now;
    play(e, now);
  }
  queue.length = 0;
}

// --- synthesis --------------------------------------------------------------

function play(e: SfxEvent, t: number): void {
  const g = Math.max(0.02, Math.min(1, e.gain));
  switch (e.name) {
    case 'pass':
      thud(t, 150, 0.09, g * 0.5);
      break;
    case 'shot':
      thud(t, 120, 0.13, g * 0.85);
      break;
    case 'bounce':
      tick(t, 380, 0.05, g * 0.4);
      break;
    case 'slide':
      scrape(t, 0.3, g * 0.5);
      break;
    case 'tackle':
      thud(t, 90, 0.1, g * 0.6);
      tick(t, 250, 0.05, g * 0.4);
      break;
    case 'whistleKick':
      whistle(t, 1);
      break;
    case 'whistleOut':
      whistle(t, 1, 0.1);
      break;
    case 'whistleGoal':
      whistle(t, 3);
      break;
    case 'goal':
      roar(t);
      whistle(t + 0.15, 3);
      break;
  }
}

// Low pitch-dropping sine "pop" + a noise click: kicks, shots, thumps.
function thud(t: number, pitch: number, dur: number, gain: number): void {
  const c = ctx!;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.5, t + dur);
  const og = c.createGain();
  og.gain.setValueAtTime(gain, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(og).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
  tick(t, 1600, 0.035, gain * 0.5, 'highpass');
}

// Short filtered noise tick: ball bounce, contact click.
function tick(t: number, freq: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass'): void {
  const c = ctx!;
  const n = c.createBufferSource();
  n.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const ng = c.createGain();
  ng.gain.setValueAtTime(gain, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(ng).connect(master!);
  n.start(t);
  n.stop(t + dur + 0.02);
}

// Noise burst with a lowpass sweeping down: grass scrape of a slide tackle.
function scrape(t: number, dur: number, gain: number): void {
  const c = ctx!;
  const n = c.createBufferSource();
  n.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2400, t);
  f.frequency.exponentialRampToValueAtTime(300, t + dur);
  const ng = c.createGain();
  ng.gain.setValueAtTime(gain, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(ng).connect(master!);
  n.start(t);
  n.stop(t + dur + 0.02);
}

// Referee whistle: square tone ~2.6kHz with a fast trill, n blasts.
function whistle(t: number, blasts: number, blastDur = 0.16): void {
  const c = ctx!;
  for (let i = 0; i < blasts; i++) {
    const bt = t + i * (blastDur + 0.06);
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(2600, bt);
    // Trill (the pea rattle).
    const lfo = c.createOscillator();
    lfo.frequency.value = 28;
    const lfoG = c.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 4500;
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, bt);
    og.gain.linearRampToValueAtTime(0.22, bt + 0.012);
    og.gain.setValueAtTime(0.22, bt + blastDur - 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, bt + blastDur);
    o.connect(f).connect(og).connect(master!);
    o.start(bt);
    o.stop(bt + blastDur + 0.02);
    lfo.start(bt);
    lfo.stop(bt + blastDur + 0.02);
  }
}

// Goal roar: a noise burst with a slow swell + an immediate crowd-bed spike.
function roar(t: number): void {
  const c = ctx!;
  const n = c.createBufferSource();
  n.buffer = noise;
  n.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1100;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.linearRampToValueAtTime(0.35, t + 0.25);
  ng.gain.setValueAtTime(0.35, t + 0.8);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  n.connect(f).connect(ng).connect(master!);
  n.start(t);
  n.stop(t + 2.3);
}

function startCrowd(): void {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 450; // muffled rhubarb murmur
  crowdGain = c.createGain();
  crowdGain.gain.value = 0.015;
  src.connect(f).connect(crowdGain).connect(master!);
  src.start();
}
