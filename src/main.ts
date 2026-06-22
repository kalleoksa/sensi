// Boot: canvas + integer-scaled resize, build shared resources (pitch + match
// renderer, input, audio), then hand control to the app shell. The app owns the
// screen state machine (title -> menus -> match) and creates a match session on
// demand; the fixed-step loop just drives app.update / app.draw.

import { VIEW_W, VIEW_H } from './world';
import { startLoop } from './loop';
import { initInput } from './input';
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

function fitToWindow(): void {
  const scale = Math.max(1, Math.min(Math.floor(window.innerWidth / VIEW_W), Math.floor(window.innerHeight / VIEW_H)));
  canvas.style.width = `${VIEW_W * scale}px`;
  canvas.style.height = `${VIEW_H * scale}px`;
}
window.addEventListener('resize', fitToWindow);
fitToWindow();

initInput();
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
