// Boot: canvas + integer-scaled resize, build the world, wire the fixed-step
// loop to input -> player -> ball -> possession -> camera, then render.

import { VIEW_W, VIEW_H, WORLD_W, makeCamera, updateCamera, FIELD_T, FIELD_B, CX } from './world';
import { startLoop } from './loop';
import { initInput, consumeInput } from './input';
import { bakePitch } from './sprites/pitch_gen';
import { makeRenderer } from './render';
import { makeBall, stepBall } from './ball';
import { makePlayer, controlHuman, resolvePossession } from './player';
import { buildAtlas, spriteFor } from './sprites/player_gen';
import { KIT_RED, WHITE, HAIR_DARK } from './sprites/palette';
import type { GameState } from './state';
import { Dir } from './state';

void WORLD_W;

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
const baked = bakePitch();
const render = makeRenderer(ctx, baked);

const midY = (FIELD_T + FIELD_B) / 2;

const human = makePlayer({
  x: CX,
  y: midY + 22,
  team: 0,
  isHuman: true,
  shirt: KIT_RED,
  shorts: WHITE,
  socks: KIT_RED,
  hair: HAIR_DARK,
});
human.dir = Dir.U;

const state: GameState = {
  ball: makeBall(CX, midY),
  players: [human],
  camera: makeCamera(),
  carrier: null,
};
// Center the camera on the ball at kickoff.
updateCamera(state.camera, state.ball.x, state.ball.y, 0, 0, 1);

// Dev: reset ball + player to kickoff with R; expose state for inspection.
function resetKickoff(): void {
  const b = state.ball;
  b.x = CX;
  b.y = midY;
  b.z = 0;
  b.prevX = b.x;
  b.prevY = b.y;
  b.prevZ = 0;
  b.vx = b.vy = b.vz = b.spin = 0;
  b.aftertouch = b.controlLock = 0;
  b.owner = null;
  human.x = CX;
  human.y = midY + 22;
  human.prevX = human.x;
  human.prevY = human.y;
  human.vx = human.vy = 0;
  human.state = 'idle';
  human.charging = false;
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') resetKickoff();
});
(window as unknown as { __game: GameState }).__game = state;
// Dev: expose sprite generation so the atlas can be inspected at any zoom.
(window as unknown as { __sprites: unknown }).__sprites = {
  buildAtlas,
  spriteFor,
  colors: { shirt: KIT_RED, shorts: WHITE, socks: KIT_RED, hair: HAIR_DARK },
};

function step(dt: number): void {
  const input = consumeInput();
  for (const p of state.players) {
    if (p.isHuman) controlHuman(state, p, input, dt);
  }
  stepBall(state.ball, dt);
  resolvePossession(state, dt);
  updateCamera(state.camera, state.ball.x, state.ball.y, state.ball.vx, state.ball.vy, dt);
}

startLoop(step, (alpha) => render(state, alpha));
