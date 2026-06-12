// Player entity + per-player state machine: movement, the distance-driven run
// cycle bookkeeping, possession/dribble nudging, and the kick model
// (tap=pass, hold=shot power, release=strike) plus slide tackles.

import {
  type Player,
  type GameState,
  type Dir8,
  DIR_VEC,
  dirFromVec,
} from './state';
import type { InputFrame } from './input';
import { applyAftertouch } from './ball';
import { type RGB } from './sprites/palette';
import { WORLD_W, WORLD_H } from './world';

export const PLAYER_SPEED = 96; // px/s on the ground
const SLIDE_SPEED = 168;
const KICK_LOCK = 0.15;
const SLIDE_LOCK = 0.4;

// Possession / dribble tuning.
const CONTROL_R = 12; // within this, a player is "near" the ball
const TOUCH_R = 7; // ball gets nudged when this close to the carrier
const NUDGE_BONUS = 34; // ball leads the carrier by this much speed

// Kick tuning.
const TAP_CHARGE = 0.16; // below this hold time, it's a pass not a shot
const MAX_CHARGE = 0.7;
const PASS_SPEED = 188;
const SHOT_MIN = 210;
const SHOT_MAX = 392;
const SHOT_LOFT = 190; // vz at full power
const AFTERTOUCH_WINDOW = 0.34;
const CONTROL_LOCK = 0.28;

export interface PlayerInit {
  x: number;
  y: number;
  team: 0 | 1;
  isHuman: boolean;
  shirt: RGB;
  shorts: RGB;
  socks: RGB;
  hair: RGB;
}

export function makePlayer(init: PlayerInit): Player {
  return {
    x: init.x,
    y: init.y,
    prevX: init.x,
    prevY: init.y,
    z: 0,
    vz: 0,
    vx: 0,
    vy: 0,
    dir: 4 as Dir8, // facing down
    state: 'idle',
    stateTimer: 0,
    distance: 0,
    team: init.team,
    isHuman: init.isHuman,
    charging: false,
    charge: 0,
    bufferedTap: 0,
    kitShirt: init.shirt,
    kitShorts: init.shorts,
    kitSocks: init.socks,
    hair: init.hair,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function isLocked(p: Player): boolean {
  return p.stateTimer > 0 && (p.state === 'kick' || p.state === 'slide' || p.state === 'fallen');
}

// Move + accumulate distance + world clamp. Call after velocities are set.
function integrate(p: Player, dt: number): void {
  p.prevX = p.x;
  p.prevY = p.y;
  const dx = p.vx * dt;
  const dy = p.vy * dt;
  p.x = clamp(p.x + dx, 2, WORLD_W - 2);
  p.y = clamp(p.y + dy, 2, WORLD_H - 2);
  p.distance += Math.hypot(dx, dy);
}

function startSlide(p: Player): void {
  const [fx, fy] = DIR_VEC[p.dir];
  p.state = 'slide';
  p.stateTimer = SLIDE_LOCK;
  p.vx = fx * SLIDE_SPEED;
  p.vy = fy * SLIDE_SPEED;
}

function strike(state: GameState, p: Player, charge: number): void {
  const b = state.ball;
  const [fx, fy] = DIR_VEC[p.dir];
  const tap = charge < TAP_CHARGE;
  let speed: number;
  let loft: number;
  if (tap) {
    speed = PASS_SPEED;
    loft = 0;
  } else {
    const t = clamp((charge - TAP_CHARGE) / (MAX_CHARGE - TAP_CHARGE), 0, 1);
    speed = SHOT_MIN + t * (SHOT_MAX - SHOT_MIN);
    loft = t * SHOT_LOFT;
  }
  // Strike from just ahead of the boot so it visibly leaves the feet.
  b.x = p.x + fx * 6;
  b.y = p.y + fy * 6;
  b.vx = fx * speed;
  b.vy = fy * speed;
  b.vz = loft;
  b.spin = 0;
  b.aftertouch = AFTERTOUCH_WINDOW;
  b.controlLock = CONTROL_LOCK;
  b.owner = p;
  p.state = 'kick';
  p.stateTimer = KICK_LOCK;
}

// Resolve who controls the ball (proximity, ball near ground) and apply the
// dribble nudge. No stickiness: the ball is repeatedly poked ahead.
export function resolvePossession(state: GameState, dt: number): void {
  void dt;
  const b = state.ball;
  let best: Player | null = null;
  let bestD = CONTROL_R;
  if (b.controlLock <= 0 && b.z < 4) {
    for (const p of state.players) {
      if (p.state === 'fallen') continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  state.carrier = best;
  if (!best) return;

  const sp = Math.hypot(best.vx, best.vy);
  const dist = Math.hypot(best.x - b.x, best.y - b.y);
  if (sp > 18 && dist < TOUCH_R) {
    // Poke the ball ahead along the carrier's facing.
    const [fx, fy] = DIR_VEC[best.dir];
    const nudge = sp + NUDGE_BONUS;
    b.vx = fx * nudge;
    b.vy = fy * nudge;
    b.owner = best;
  } else if (sp <= 18 && dist < TOUCH_R) {
    // Standing over it: damp so it settles at the feet rather than drifting.
    b.vx *= 0.6;
    b.vy *= 0.6;
  }
}

// Drive the human-controlled player from the input frame.
export function controlHuman(state: GameState, p: Player, input: InputFrame, dt: number): void {
  // Tick down lock + buffer.
  if (p.stateTimer > 0) p.stateTimer = Math.max(0, p.stateTimer - dt);
  if (p.bufferedTap > 0) p.bufferedTap = Math.max(0, p.bufferedTap - dt);

  const locked = isLocked(p);
  const isCarrier = state.carrier === p;

  // --- Movement ---
  if (!locked) {
    if (input.dx !== 0 || input.dy !== 0) {
      const len = Math.hypot(input.dx, input.dy);
      p.vx = (input.dx / len) * PLAYER_SPEED;
      p.vy = (input.dy / len) * PLAYER_SPEED;
      p.dir = dirFromVec(input.dx, input.dy);
      if (p.state !== 'kick') p.state = 'run';
    } else {
      p.vx = 0;
      p.vy = 0;
      if (p.state !== 'kick') p.state = 'idle';
    }
  } else if (p.state === 'slide') {
    // Friction on the slide lunge.
    p.vx *= Math.exp(-3 * dt);
    p.vy *= Math.exp(-3 * dt);
  } else {
    p.vx = 0;
    p.vy = 0;
  }

  // Exit locked states when the timer elapses.
  if (p.stateTimer <= 0 && (p.state === 'kick' || p.state === 'slide' || p.state === 'fallen')) {
    p.state = 'idle';
  }

  // --- Action button ---
  // Buffer a press that arrives during a lock so it isn't eaten (~80ms).
  const pressed = input.pressed || (!locked && p.bufferedTap > 0);
  if (input.pressed && locked) p.bufferedTap = 0.08;

  if (pressed && !locked) {
    p.bufferedTap = 0;
    if (isCarrier) {
      p.charging = true;
      p.charge = 0;
    } else {
      startSlide(p);
    }
  }
  if (p.charging) {
    if (input.down) {
      p.charge = Math.min(MAX_CHARGE + 0.1, p.charge + dt);
    } else {
      // Released.
      p.charging = false;
      strike(state, p, p.charge);
    }
  }

  integrate(p, dt);

  // --- Aftertouch: held dpad bends the ball during the post-kick window ---
  if (state.ball.aftertouch > 0 && (input.dx !== 0 || input.dy !== 0)) {
    const len = Math.hypot(input.dx, input.dy);
    applyAftertouch(state.ball, input.dx / len, input.dy / len, dt);
  }
}
