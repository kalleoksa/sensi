// Boot: canvas + integer-scaled resize, build the world, wire the fixed-step
// loop to input -> player -> ball -> possession -> camera, then render.

import { VIEW_W, VIEW_H, WORLD_W, makeCamera, updateCamera, FIELD_T, FIELD_B, CX } from './world';
import { startLoop } from './loop';
import { initInput, consumeInput } from './input';
import { bakePitch } from './sprites/pitch_gen';
import { makeRenderer } from './render';
import { makeBall, stepBall } from './ball';
import { controlHuman, resolvePossession } from './player';
import { buildAtlas, spriteFor } from './sprites/player_gen';
import { makeMatch, updateMatch, resetKickoff } from './match';
import { makeTeams } from './team';
import { updateTeamAi } from './ai';
import { makeRng } from './rng';
import { KIT_RED, WHITE, HAIR_DARK } from './sprites/palette';
import type { GameState, Player } from './state';

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

const rng = makeRng(7);
const state: GameState = {
  ball: makeBall(CX, midY),
  players: makeTeams(rng),
  camera: makeCamera(),
  carrier: null,
  controlled: null,
};
const match = makeMatch();
resetKickoff(state);

// The human drives the team-0 player nearest the ball (carrier if team 0 has
// it). A little stickiness avoids flicker when two players are equidistant.
function pickControlled(s: GameState): Player {
  const b = s.ball;
  if (s.carrier && s.carrier.team === 0 && s.carrier.role !== 'gk') return s.carrier;
  let best: Player | null = s.controlled;
  let bestD = best && best.team === 0 && best.role !== 'gk'
    ? Math.hypot(best.x - b.x, best.y - b.y) * 0.8 // stickiness factor
    : Infinity;
  for (const p of s.players) {
    if (p.team !== 0 || p.role === 'gk') continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best!;
}

// Center the camera on the ball at kickoff.
updateCamera(state.camera, state.ball.x, state.ball.y, 0, 0, 1);

// Dev: reset to kickoff with R (keeps score); expose state for inspection.
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') resetKickoff(state);
});
(window as unknown as { __game: GameState }).__game = state;
(window as unknown as { __match: unknown }).__match = match;
// Dev: expose sprite generation so the atlas can be inspected at any zoom.
(window as unknown as { __sprites: unknown }).__sprites = {
  buildAtlas,
  spriteFor,
  colors: { shirt: KIT_RED, shorts: WHITE, socks: KIT_RED, hair: HAIR_DARK },
};

function step(dt: number): void {
  const input = consumeInput();
  // Freeze player control during the post-goal pause, but keep the ball rolling
  // so it travels into the net during the goal celebration.
  if (match.phase === 'play') {
    state.controlled = pickControlled(state);
    controlHuman(state, state.controlled, input, dt);
    updateTeamAi(state, dt);
    resolvePossession(state, dt);
  }
  stepBall(state.ball, dt);
  updateMatch(state, match, dt);
  updateCamera(state.camera, state.ball.x, state.ball.y, state.ball.vx, state.ball.vy, dt);
}

startLoop(step, (alpha) => render(state, alpha, match));
