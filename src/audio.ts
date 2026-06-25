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
  | 'woodwork'
  | 'slide'
  | 'tackle'
  | 'whistleKick'
  | 'whistleGoal'
  | 'whistleOut'
  | 'goal'
  | 'uiMove'
  | 'uiSelect';

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
  woodwork: 0.1,
  slide: 0.15,
  tackle: 0.1,
  whistleKick: 0.5,
  whistleGoal: 0.5,
  whistleOut: 0.4,
  goal: 1,
  uiMove: 0.04,
  uiSelect: 0.06,
};

const VOLUME_KEY = 'sensi.volume';
const MUTE_KEY = 'sensi.muted';
const MUSIC_KEY = 'sensi.music';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let crowdGain: GainNode | null = null;
let crowdTarget = 0;
let noise: AudioBuffer | null = null; // shared white-noise source buffer
let volume = 0.5;
let muted = false;
let musicEnabled = true;
let musicGain: GainNode | null = null;
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
  musicEnabled = localStorage.getItem(MUSIC_KEY) !== '0';

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
    if (e.code === 'KeyN') setMusicEnabled(!musicEnabled);
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

  // The theme tune sits on its own sub-bus so it can fade in/out as a whole and
  // sit a touch below the SFX. It still feeds master, so mute/volume apply.
  musicGain = ctx.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(master);

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

export function setMusicEnabled(on: boolean): void {
  musicEnabled = on;
  localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
  updateBadge();
}

export function isMusicEnabled(): boolean {
  return musicEnabled;
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
  scheduleMusic(now);
  for (const e of queue) {
    const last = lastPlayed[e.name] ?? -Infinity;
    if (now - last < MIN_INTERVAL[e.name]) continue;
    lastPlayed[e.name] = now;
    play(e, now);
  }
  queue.length = 0;
}

// --- theme tune -------------------------------------------------------------
//
// A chiptune arrangement of "Goal Scoring Superstar Hero" (Sensible World of
// Soccer, 1994). The original rides an Em <-> A vamp; here a bouncing octave
// bass and offbeat triad stabs carry that, with a square-wave lead tracing the
// melodic hook. It's an interpretation, not a sample — sequenced live from
// oscillators like everything else. Plays on the menus, hushed during a match.
//
// A lookahead scheduler (driven once per frame from flushSfx) queues notes a
// little ahead of the clock, so timing stays solid regardless of frame rate.

const BPM = 132;
const STEP = 60 / BPM / 2; // one eighth note
const STEPS = 32; // four bars of 8 eighths
const LOOKAHEAD = 0.25; // seconds of audio to schedule ahead

// Bar chord: Em, A, Em, A. Each entry is [bass root midi, triad stab midis].
const EM = { root: 40, triad: [52, 55, 59] }; // E2 ; E3 G3 B3
const A = { root: 45, triad: [57, 61, 64] }; //  A2 ; A3 C#4 E4
const BARS = [EM, A, EM, A];

// Lead hook as [startStep, midi, lengthInSteps]. E natural minor over the vamp.
const LEAD: [number, number, number][] = [
  // Bar 1 (Em): "you're a goal scor-ing"
  [0, 64, 2], [2, 67, 1], [3, 71, 1], [4, 69, 2], [6, 67, 2],
  // Bar 2 (A): "su-per-star"
  [8, 71, 1], [9, 73, 1], [10, 69, 2], [12, 66, 2], [14, 64, 2],
  // Bar 3 (Em): "he-ro, you're a"
  [16, 76, 2], [18, 74, 1], [19, 71, 1], [20, 67, 2], [22, 71, 2],
  // Bar 4 (A): "su-per-star he-ro" (resolves, rings into the loop)
  [24, 73, 2], [26, 71, 1], [27, 69, 1], [28, 71, 4],
];

let musicWant = false; // caller wants the theme (true on menus, false in match)
let musicPlaying = false; // a loop is currently being scheduled
let musicStep = 0;
let nextStepTime = 0;

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// Ask for the theme to play (idempotent). It only sounds once audio is unlocked.
export function startTheme(): void {
  musicWant = true;
}

// Stop the theme; the sub-bus fades so in-flight notes tail off cleanly.
export function stopTheme(): void {
  musicWant = false;
}

function scheduleMusic(now: number): void {
  if (!musicGain) return;
  const live = musicWant && musicEnabled;
  if (!live) {
    if (musicPlaying) {
      musicGain.gain.setTargetAtTime(0, now, 0.08);
      musicPlaying = false;
    }
    return;
  }
  if (!musicPlaying) {
    musicPlaying = true;
    musicStep = 0;
    nextStepTime = now + 0.06;
    musicGain.gain.setTargetAtTime(0.5, now, 0.1);
  }
  while (nextStepTime < now + LOOKAHEAD) {
    scheduleStep(musicStep, nextStepTime);
    nextStepTime += STEP;
    musicStep = (musicStep + 1) % STEPS;
  }
}

function scheduleStep(step: number, t: number): void {
  const bar = BARS[(step >> 3) & 3];

  // Bouncing octave bass on every eighth: root, root+octave, alternating.
  const bassMidi = bar.root + (step & 1 ? 12 : 0);
  tone(t, mtof(bassMidi), STEP * 0.9, 0.22, 'triangle');

  // Offbeat triad stabs (the "skank") on the odd eighths.
  if (step & 1) {
    for (const m of bar.triad) tone(t, mtof(m), STEP * 0.55, 0.05, 'square');
  }

  // Lead notes that begin on this step.
  for (const [s, m, len] of LEAD) {
    if (s === step) tone(t, mtof(m), STEP * len * 0.92, 0.16, 'square', true);
  }
}

// A single chiptune voice: an oscillator with a quick percussive envelope.
// `lead` adds a detuned partner for a fuller, slightly buzzy top line.
function tone(t: number, freq: number, dur: number, gain: number, type: OscillatorType, lead = false): void {
  const c = ctx!;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.setValueAtTime(gain, t + Math.max(0.01, dur - 0.04));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(musicGain!);

  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.02);

  if (lead) {
    const o2 = c.createOscillator();
    o2.type = type;
    o2.frequency.value = freq;
    o2.detune.value = 7;
    o2.connect(g);
    o2.start(t);
    o2.stop(t + dur + 0.02);
  }
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
    case 'woodwork':
      // Hard wooden knock: a low resonant pop with a sharp click on top.
      thud(t, 220, 0.08, g * 0.7);
      tick(t, 600, 0.04, g * 0.5);
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
    case 'uiMove':
      tick(t, 880, 0.03, g * 0.3, 'bandpass');
      break;
    case 'uiSelect':
      tick(t, 1320, 0.04, g * 0.4, 'bandpass');
      tick(t + 0.04, 1760, 0.05, g * 0.35, 'bandpass');
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
