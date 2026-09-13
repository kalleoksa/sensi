// On-screen touch controls for phones/tablets, mounted only on coarse-pointer
// devices (or with ?touch=1 for desktop testing). A floating virtual joystick
// under the left thumb and a KICK zone under the right thumb, plus small pause
// and back buttons in the top-right corner.
//
// The overlay doesn't drive the game directly: it synthesizes the same key
// codes the keyboard produces (WASD, Space, KeyP, Escape) via input.ts's
// pressCode/releaseCode. Menus, match controls, set-piece aim/charge, tap=pass,
// hold=shot, slides and aftertouch all come for free from the existing paths,
// and keyboard play is untouched.
//
// Pointer Events with per-pointerId tracking keep the two thumbs independent.
// In landscape the canvas is pillarboxed (side gutters), so both thumb zones
// naturally sit over dead space rather than covering the pitch.

import { pressCode, releaseCode } from './input';

const JOY_RADIUS = 52; // px of thumb travel from the floating base to full tilt
const DEAD = 0.35; // fraction of JOY_RADIUS before a direction registers

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).has('touch')) return true;
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}

// The dpad codes the joystick currently holds down, diffed on every move so a
// direction change releases the old code and presses the new one (fresh edges).
const injected = new Set<string>();
function setCode(code: string, want: boolean): void {
  if (want && !injected.has(code)) {
    injected.add(code);
    pressCode(code);
  } else if (!want && injected.has(code)) {
    injected.delete(code);
    releaseCode(code);
  }
}
function syncStick(dx: number, dy: number): void {
  setCode('KeyA', dx < 0);
  setCode('KeyD', dx > 0);
  setCode('KeyW', dy < 0);
  setCode('KeyS', dy > 0);
}

export function initTouch(): void {
  if (!isTouchDevice()) return;

  const style = document.createElement('style');
  style.textContent = `
    #touch { position: fixed; inset: 0; z-index: 8; pointer-events: none;
      touch-action: none; -webkit-user-select: none; user-select: none; }
    #touch .zone { position: absolute; bottom: 0; height: 78%;
      pointer-events: auto; touch-action: none; }
    #touch .joyzone { left: 0; width: 52%; }
    #touch .kickzone { right: 0; width: 48%; }
    #touch .base { position: absolute; width: ${JOY_RADIUS * 2}px; height: ${JOY_RADIUS * 2}px;
      margin: -${JOY_RADIUS}px 0 0 -${JOY_RADIUS}px; border-radius: 50%; display: none;
      background: rgba(255,255,255,0.08); border: 2px solid rgba(255,255,255,0.3);
      pointer-events: none; }
    #touch .knob { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px;
      margin: -22px 0 0 -22px; border-radius: 50%;
      background: rgba(255,255,255,0.4); border: 2px solid rgba(255,255,255,0.55);
      pointer-events: none; }
    #touch .kick { position: absolute; right: calc(30px + env(safe-area-inset-right));
      bottom: calc(34px + env(safe-area-inset-bottom)); width: 92px; height: 92px;
      border-radius: 50%; background: rgba(214,69,65,0.5);
      border: 2px solid rgba(255,255,255,0.5); color: rgba(236,240,226,0.9);
      font: bold 15px/88px system-ui, sans-serif; text-align: center;
      pointer-events: none; }
    #touch .kick.active { background: rgba(214,69,65,0.9); }
    #touch .btn { position: absolute; top: calc(10px + env(safe-area-inset-top));
      width: 40px; height: 40px; border-radius: 50%; pointer-events: auto;
      touch-action: none; background: rgba(0,0,0,0.4);
      border: 2px solid rgba(255,255,255,0.35); color: rgba(236,240,226,0.9);
      font: bold 15px/38px system-ui, sans-serif; text-align: center; }
    #touch .pause { right: calc(12px + env(safe-area-inset-right)); }
    #touch .back { right: calc(62px + env(safe-area-inset-right)); }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="zone joyzone"><div class="base"><div class="knob"></div></div></div>
    <div class="zone kickzone"><div class="kick">KICK</div></div>
    <div class="btn back">&#10554;</div>
    <div class="btn pause">&#9646;&#9646;</div>
  `;
  document.body.appendChild(root);

  const joyZone = root.querySelector<HTMLElement>('.joyzone')!;
  const base = root.querySelector<HTMLElement>('.base')!;
  const knob = root.querySelector<HTMLElement>('.knob')!;
  const kickZone = root.querySelector<HTMLElement>('.kickzone')!;
  const kick = root.querySelector<HTMLElement>('.kick')!;

  // --- Floating joystick: the base appears where the thumb lands. ---
  let joyId: number | null = null;
  let baseX = 0;
  let baseY = 0;
  const moveJoy = (cx: number, cy: number): void => {
    let dx = cx - baseX;
    let dy = cy - baseY;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      dx = (dx / d) * JOY_RADIUS;
      dy = (dy / d) * JOY_RADIUS;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const t = DEAD * JOY_RADIUS;
    syncStick(dx > t ? 1 : dx < -t ? -1 : 0, dy > t ? 1 : dy < -t ? -1 : 0);
  };
  joyZone.addEventListener('pointerdown', (e) => {
    if (joyId !== null) return;
    e.preventDefault();
    joyId = e.pointerId;
    joyZone.setPointerCapture(e.pointerId);
    baseX = e.clientX;
    baseY = e.clientY;
    const r = joyZone.getBoundingClientRect();
    base.style.left = `${baseX - r.left}px`;
    base.style.top = `${baseY - r.top}px`;
    base.style.display = 'block';
    moveJoy(e.clientX, e.clientY);
  });
  joyZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return;
    e.preventDefault();
    moveJoy(e.clientX, e.clientY);
  });
  const endJoy = (e: PointerEvent): void => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    base.style.display = 'none';
    knob.style.transform = 'translate(0,0)';
    syncStick(0, 0);
  };
  joyZone.addEventListener('pointerup', endJoy);
  joyZone.addEventListener('pointercancel', endJoy);

  // --- Kick: the whole lower-right zone is the button (forgiving under
  // pressure); the visible circle just shows where it lives and lights up. ---
  let kickId: number | null = null;
  kickZone.addEventListener('pointerdown', (e) => {
    if (kickId !== null) return;
    e.preventDefault();
    kickId = e.pointerId;
    kickZone.setPointerCapture(e.pointerId);
    kick.classList.add('active');
    pressCode('Space');
  });
  const endKick = (e: PointerEvent): void => {
    if (e.pointerId !== kickId) return;
    kickId = null;
    kick.classList.remove('active');
    releaseCode('Space');
  };
  kickZone.addEventListener('pointerup', endKick);
  kickZone.addEventListener('pointercancel', endKick);

  // --- Corner buttons: tap = one key edge (pause / back). ---
  const bindButton = (el: HTMLElement, code: string): void => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pressCode(code);
    });
    const up = (e: PointerEvent): void => {
      e.preventDefault();
      releaseCode(code);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  bindButton(root.querySelector<HTMLElement>('.pause')!, 'KeyP');
  bindButton(root.querySelector<HTMLElement>('.back')!, 'Escape');
}
