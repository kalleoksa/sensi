// Boot: canvas + integer-scaled resize, build shared resources (pitch + match
// renderer, input, audio), then hand control to the app shell. The app owns the
// screen state machine (title -> menus -> match) and creates a match session on
// demand; the fixed-step loop just drives app.update / app.draw.

import { VIEW_W, VIEW_H } from './world';
import { startLoop } from './loop';
import { initInput } from './input';
import { initTouch, isTouchDevice } from './touch';
import { bakePitchFor } from './sprites/pitch_gen';
import { makeRenderer } from './render';
import { initAudio, flushSfx } from './audio';
import { makeApp } from './app';
import type { Session } from './session';

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

// Desktop keeps crisp pixel-perfect integer scaling. Touch devices fill the
// viewport (fractional, aspect-preserved): a phone in landscape is ~390 CSS px
// tall, so integer scaling would leave the game a tiny 384x320 island there —
// and would overflow screens narrower than 384px.
const touchDevice = isTouchDevice();
function fitToWindow(): void {
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const fit = Math.min(vw / VIEW_W, vh / VIEW_H);
  const scale = touchDevice ? fit : Math.max(1, Math.floor(fit));
  canvas.style.width = `${VIEW_W * scale}px`;
  canvas.style.height = `${VIEW_H * scale}px`;
}
window.addEventListener('resize', fitToWindow);
window.addEventListener('orientationchange', fitToWindow);
// iOS Safari resizes the visual viewport (not the window) when its toolbar
// collapses/expands; re-fit on those too.
window.visualViewport?.addEventListener('resize', fitToWindow);
fitToWindow();

initInput();
initTouch(); // on-screen joystick + buttons; no-op on mouse/keyboard devices
initAudio(); // unlocks on first gesture; "M" toggles mute

const render = makeRenderer(ctx);
// Each session carries its chosen surface; bakePitchFor caches one tinted
// pitch per surface, so the grass matches the surface's physics.
const renderMatch = (s: Session, alpha: number): void =>
  render(bakePitchFor(s.config.pitch), s.state, alpha, s.match, s.paused);

const app = makeApp({ ctx, renderMatch });

startLoop(
  (dt) => app.update(dt),
  (alpha) => {
    app.draw(alpha);
    flushSfx(); // realize any sounds queued this frame (sim or UI)
  },
);
