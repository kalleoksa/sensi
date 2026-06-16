// Boot: canvas + integer-scaled resize, build the world, wire the fixed-step
// loop to input -> player -> ball -> possession -> camera, then render.

import { VIEW_W, VIEW_H, WORLD_W, makeCamera, updateCamera, FIELD_T, FIELD_B, CX } from './world';
import { startLoop } from './loop';
import { initInput, consumeInputs } from './input';
import { bakePitch } from './sprites/pitch_gen';
import { makeRenderer } from './render';
import { makeBall, stepBall } from './ball';
import { controlHuman, resolvePossession, resolveSlideTackles } from './player';
import { buildAtlas, spriteFor } from './sprites/player_gen';
import { makeMatch, updateMatch, resetKickoff } from './match';
import { makeTeams } from './team';
import { updateTeamAi } from './ai';
import { makeRng } from './rng';
import { initAudio, flushSfx, setCrowdIntensity } from './audio';
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
initAudio(); // unlocks on first gesture; "M" toggles mute
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
  controlled2: null,
};
const match = makeMatch();
let twoPlayer = false; // toggled with "2": P2 = arrows + Enter, drives blue
resetKickoff(state);

// Each human drives their team's player nearest the ball (carrier if their
// team has it). A little stickiness avoids flicker when two are equidistant.
function pickControlled(s: GameState, team: 0 | 1, current: Player | null): Player {
  const b = s.ball;
  if (s.carrier && s.carrier.team === team && s.carrier.role !== 'gk') return s.carrier;
  let best: Player | null = current;
  let bestD = current && current.team === team && current.role !== 'gk'
    ? Math.hypot(current.x - b.x, current.y - b.y) * 0.8 // stickiness factor
    : Infinity;
  for (const p of s.players) {
    if (p.team !== team || p.role === 'gk') continue;
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

// R resets to kickoff (keeps score); "2" toggles two-player; P/Esc pauses.
let paused = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') resetKickoff(state);
  if (e.code === 'Digit2') {
    twoPlayer = !twoPlayer;
    state.controlled2 = null;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') paused = !paused;
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
  if (paused) return; // freeze the sim; render still draws the overlay
  const input = consumeInputs(twoPlayer);
  // Freeze player control during the post-goal pause, but keep the ball rolling
  // so it travels into the net during the goal celebration.
  if (match.phase === 'play') {
    state.controlled = pickControlled(state, 0, state.controlled);
    controlHuman(state, state.controlled, input.p1, dt);
    if (input.p2) {
      state.controlled2 = pickControlled(state, 1, state.controlled2);
      controlHuman(state, state.controlled2, input.p2, dt);
    } else {
      state.controlled2 = null;
    }
    updateTeamAi(state, dt);
    resolveSlideTackles(state);
    resolvePossession(state, dt);
  }
  stepBall(state.ball, dt);
  updateMatch(state, match, dt);
  updateCamera(state.camera, state.ball.x, state.ball.y, state.ball.vx, state.ball.vy, dt);
}

function frame(alpha: number): void {
  // Crowd swells as the ball nears either goal; spikes during the goal flash.
  const b = state.ball;
  const distToGoal = Math.min(Math.abs(b.y - FIELD_T), Math.abs(b.y - FIELD_B));
  const near = Math.max(0, 1 - distToGoal / 180);
  setCrowdIntensity(Math.max(near, match.flash > 0 ? 1 : 0));
  flushSfx(); // realize sounds the sim queued this frame
  render(state, alpha, match, paused);
}

startLoop(step, frame);
