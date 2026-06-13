// On-screen touch controls, overlaid on the pitch corners. A floating virtual
// joystick (left thumb) feeds a movement vector; a single action button (right
// thumb) drives the action edges. Everything routes through input.ts's virtual
// channel, so tap=pass / hold=shot / release=strike / slide / aftertouch all
// come for free from the existing player.ts state machine.
//
// Pointer Events with per-pointerId tracking keep the two thumbs independent.

import { setTouchVector, setTouchAction } from './input';

const JOY_RADIUS = 48; // px the knob can travel from its base

// Only mount on touch / coarse-pointer devices. `?touch=1` forces it on (handy
// for testing on desktop and for hybrid touch laptops that report fine).
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).has('touch')) return true;
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}

function el(tag: string, css: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const node = document.createElement(tag);
  Object.assign(node.style, css);
  if (text) node.textContent = text;
  return node;
}

interface TouchOpts {
  onPause: () => void;
  onReset: () => void;
}

export function initTouch(opts: TouchOpts): void {
  const root = el('div', {
    position: 'fixed',
    inset: '0',
    touchAction: 'none',
    userSelect: 'none',
    zIndex: '10',
    // Container itself is transparent to pointers; only the controls capture.
    pointerEvents: 'none',
  });
  root.id = 'touch';

  // --- Floating joystick: a large capture zone on the lower-left. ---
  const joyZone = el('div', {
    position: 'absolute',
    left: '0',
    bottom: '0',
    width: '55%',
    height: '65%',
    pointerEvents: 'auto',
  });
  const joyBase = el('div', {
    position: 'absolute',
    width: `${JOY_RADIUS * 2}px`,
    height: `${JOY_RADIUS * 2}px`,
    marginLeft: `${-JOY_RADIUS}px`,
    marginTop: `${-JOY_RADIUS}px`,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.12)',
    border: '2px solid rgba(255,255,255,0.35)',
    display: 'none',
    pointerEvents: 'none',
  });
  const joyKnob = el('div', {
    position: 'absolute',
    width: '40px',
    height: '40px',
    marginLeft: '-20px',
    marginTop: '-20px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.45)',
    pointerEvents: 'none',
  });
  joyBase.appendChild(joyKnob);
  joyZone.appendChild(joyBase);

  let joyId: number | null = null;
  let baseX = 0;
  let baseY = 0;

  joyZone.addEventListener('pointerdown', (e) => {
    if (joyId !== null) return;
    e.preventDefault();
    joyId = e.pointerId;
    try { joyZone.setPointerCapture(e.pointerId); } catch {}
    baseX = e.clientX;
    baseY = e.clientY;
    joyBase.style.left = `${baseX}px`;
    joyBase.style.top = `${baseY}px`;
    joyBase.style.display = 'block';
    joyKnob.style.left = '50%';
    joyKnob.style.top = '50%';
  });
  joyZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return;
    e.preventDefault();
    let dx = e.clientX - baseX;
    let dy = e.clientY - baseY;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      dx = (dx / d) * JOY_RADIUS;
      dy = (dy / d) * JOY_RADIUS;
    }
    joyKnob.style.left = `${JOY_RADIUS + dx}px`;
    joyKnob.style.top = `${JOY_RADIUS + dy}px`;
    // Small dead zone so a resting thumb doesn't drift.
    setTouchVector(Math.abs(dx) > 6 ? dx : 0, Math.abs(dy) > 6 ? dy : 0);
  });
  const endJoy = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    joyBase.style.display = 'none';
    setTouchVector(0, 0);
  };
  joyZone.addEventListener('pointerup', endJoy);
  joyZone.addEventListener('pointercancel', endJoy);

  // --- Action button: lower-right. ---
  const action = el('div', {
    position: 'absolute',
    right: '24px',
    bottom: '32px',
    width: '88px',
    height: '88px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.18)',
    border: '3px solid rgba(255,255,255,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: 'bold 13px sans-serif',
    color: 'rgba(255,255,255,0.7)',
    pointerEvents: 'auto',
  }, 'PASS / SHOOT');
  let actionId: number | null = null;
  action.addEventListener('pointerdown', (e) => {
    if (actionId !== null) return;
    e.preventDefault();
    actionId = e.pointerId;
    try { action.setPointerCapture(e.pointerId); } catch {}
    action.style.background = 'rgba(255,255,255,0.38)';
    setTouchAction(true);
  });
  const endAction = (e: PointerEvent) => {
    if (e.pointerId !== actionId) return;
    actionId = null;
    action.style.background = 'rgba(255,255,255,0.18)';
    setTouchAction(false);
  };
  action.addEventListener('pointerup', endAction);
  action.addEventListener('pointercancel', endAction);

  // --- Pause + reset: small top-right buttons. ---
  function topButton(right: string, label: string, onTap: () => void): HTMLElement {
    const b = el('div', {
      position: 'absolute',
      top: '12px',
      right,
      width: '40px',
      height: '40px',
      borderRadius: '8px',
      background: 'rgba(0,0,0,0.35)',
      border: '1px solid rgba(255,255,255,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: 'bold 16px sans-serif',
      color: 'rgba(255,255,255,0.8)',
      pointerEvents: 'auto',
    }, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onTap();
    });
    return b;
  }
  const pauseBtn = topButton('12px', '⏸', opts.onPause);
  const resetBtn = topButton('60px', '↺', opts.onReset);

  root.append(joyZone, action, pauseBtn, resetBtn);
  document.body.appendChild(root);
}
