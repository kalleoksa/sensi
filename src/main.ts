// Boot: canvas + integer-scaled resize, build shared resources (pitch + match
// renderer, input, audio), then hand control to the app shell. The app owns the
// screen state machine (title -> menus -> match) and creates a match session on
// demand; the fixed-step loop just drives app.update / app.draw.

import { VIEW_W, VIEW_H, setViewSize } from './world';
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

// Desktop keeps crisp pixel-perfect integer scaling of the fixed 384x320 view.
// Touch devices instead RESIZE THE VIEW to the screen's aspect so the canvas
// covers the whole display: landscape keeps the 320px logical height (menus
// are laid out for it) and widens the view; portrait keeps the 384px width and
// lengthens it. The renderer tiles crowd wherever the view outgrows the world.
const touchDevice = isTouchDevice();
function fitToWindow(): void {
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  if (touchDevice) {
    let w: number;
    let h: number;
    let scale: number;
    if (vw >= vh) {
      h = 320;
      scale = vh / h;
      w = Math.min(720, Math.max(384, Math.round(vw / scale)));
    } else {
      w = 384;
      scale = vw / w;
      h = Math.min(704, Math.max(320, Math.round(vh / scale)));
    }
    setViewSize(w, h);
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false; // resizing the buffer resets ctx state
    canvas.style.width = `${w * scale}px`;
    canvas.style.height = `${h * scale}px`;
    return;
  }
  const fit = Math.min(vw / VIEW_W, vh / VIEW_H);
  const scale = Math.max(1, Math.floor(fit));
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
