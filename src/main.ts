// Boot: canvas + integer-scaled resize, build shared resources (pitch + match
// renderer, input, audio), then hand control to the app shell. The app owns the
// screen state machine (title -> menus -> match) and creates a match session on
// demand; the fixed-step loop just drives app.update / app.draw.

import { VIEW_W, VIEW_H, WORLD_W, WORLD_H, setViewSize } from './world';
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
// Touch devices cover the whole display, with two sizings:
//  - MATCH: a zoomed camera — the largest screen-shaped window that fits
//    INSIDE the pitch world, so nothing outside the stadium ever shows and
//    the players render big (iPhone landscape ~448x207, portrait ~248x536).
//  - MENUS: landscape keeps the 320px logical height the screens are laid
//    out for and widens; portrait keeps the 384px width and lengthens.
// The app flips the mode via setMatchView when a match is on screen.
const touchDevice = isTouchDevice();
let matchView = false;
export function setMatchView(on: boolean): void {
  if (matchView === on) return;
  matchView = on;
  fitToWindow();
}
function fitToWindow(): void {
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  if (touchDevice) {
    let w: number;
    let h: number;
    if (matchView) {
      const a = vw / vh;
      if (a >= WORLD_W / WORLD_H) {
        w = WORLD_W;
        h = Math.round(WORLD_W / a);
      } else {
        h = WORLD_H;
        w = Math.round(WORLD_H * a);
      }
    } else if (vw >= vh) {
      h = 320;
      w = Math.min(720, Math.max(384, Math.round((320 * vw) / vh)));
    } else {
      w = 384;
      h = Math.min(704, Math.max(320, Math.round((384 * vh) / vw)));
    }
    setViewSize(w, h);
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false; // resizing the buffer resets ctx state
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
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

const app = makeApp({ ctx, renderMatch, setMatchView });

startLoop(
  (dt) => app.update(dt),
  (alpha) => {
    app.draw(alpha);
    flushSfx(); // realize any sounds queued this frame (sim or UI)
  },
);
