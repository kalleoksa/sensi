// Player entity + per-player state machine: movement, the distance-driven run
// cycle bookkeeping, possession/dribble nudging, and the kick model
// (tap=pass, hold=shot power, release=strike) plus slide tackles.

import {
  type Player,
  type GameState,
  type Dir8,
  type Role,
  DIR_VEC,
  dirFromVec,
} from './state';
import type { InputFrame } from './input';
import { applyAftertouch } from './ball';
import { emitSfx } from './audio';
import { type RGB } from './sprites/palette';
import { WORLD_W, WORLD_H } from './world';

export const PLAYER_SPEED = 72; // px/s; ~10s goal-to-goal over the 720px pitch
const SLIDE_SPEED = 126; // 1.75x run speed, trimmed with PLAYER_SPEED
const KICK_LOCK = 0.15;
const SLIDE_LOCK = 0.4;
export const FALLEN_LOCK = 0.6;

// Possession / dribble tuning.
const CONTROL_R = 13; // within this, a player is "near" the ball
const DRIBBLE_LEAD = 6; // ball is kept this far ahead of the carrier's feet
const DRIBBLE_SPRING = 11; // how hard the ball is held to the lead point
const TACKLE_R = 8; // an opponent this close to the carrier pokes the ball loose

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
  role: Role;
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
    role: init.role,
    homeX: init.x,
    homeY: init.y,
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
  emitSfx('slide');
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
  emitSfx(tap ? 'pass' : 'shot', tap ? 0.8 : clamp(speed / SHOT_MAX, 0.6, 1));
}

// Resolve who controls the ball (proximity, ball near ground), keep it on the
// dribbler's foot, and let a closing opponent poke it loose (a tackle).
export function resolvePossession(state: GameState, dt: number): void {
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

  // Tackle: an opponent closing to within TACKLE_R pokes the ball loose, away
  // along their movement direction, so it becomes a 50/50 both can chase.
  for (const o of state.players) {
    if (o.team === best.team || o.state === 'fallen') continue;
    if (Math.hypot(o.x - best.x, o.y - best.y) < TACKLE_R) {
      const [ox, oy] = DIR_VEC[o.dir];
      b.vx = ox * 112;
      b.vy = oy * 112;
      b.controlLock = 0.25; // brief no-control so it squirts free
      emitSfx('tackle', 0.6);
      b.owner = o;
      state.carrier = null;
      return;
    }
  }

  // Dribble: hold the ball a short lead ahead of the feet (spring), carried at
  // the player's velocity. Sticky but a kick (controlLock) or tackle frees it.
  const [fx, fy] = DIR_VEC[best.dir];
  const leadX = best.x + fx * DRIBBLE_LEAD;
  const leadY = best.y + fy * DRIBBLE_LEAD;
  b.vx = best.vx + (leadX - b.x) * DRIBBLE_SPRING;
  b.vy = best.vy + (leadY - b.y) * DRIBBLE_SPRING;
  b.owner = best;
  void dt;
}

// Slide tackles knock down opponents they slide into: the opponent falls
// (locked), and a carrier loses the ball.
export function resolveSlideTackles(state: GameState): void {
  for (const s of state.players) {
    if (s.state !== 'slide') continue;
    for (const o of state.players) {
      if (o.team === s.team || o === s || o.state === 'fallen') continue;
      if (Math.hypot(o.x - s.x, o.y - s.y) < 9) {
        o.state = 'fallen';
        o.stateTimer = FALLEN_LOCK;
        emitSfx('tackle');
        o.vx = 0;
        o.vy = 0;
        if (state.carrier === o) {
          state.carrier = null;
          state.ball.controlLock = 0.2;
        }
      }
    }
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

  // --- Aftertouch: the kicker's held dpad bends the ball post-kick ---
  if (
    state.ball.aftertouch > 0 &&
    state.ball.owner === p &&
    (input.dx !== 0 || input.dy !== 0)
  ) {
    const len = Math.hypot(input.dx, input.dy);
    applyAftertouch(state.ball, input.dx / len, input.dy / len, dt);
  }
}

// Steer an AI player toward a target point; handles facing, run/idle anim, the
// state-lock timer, and integration. Mirrors controlHuman's movement half.
export function moveToward(
  p: Player,
  tx: number,
  ty: number,
  dt: number,
  speed = PLAYER_SPEED,
  arrive = 2,
): void {
  if (p.stateTimer > 0) p.stateTimer = Math.max(0, p.stateTimer - dt);
  const locked = isLocked(p);
  if (!locked) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d > arrive) {
      p.vx = (dx / d) * speed;
      p.vy = (dy / d) * speed;
      p.dir = dirFromVec(dx, dy);
      if (p.state !== 'kick') p.state = 'run';
    } else {
      p.vx = 0;
      p.vy = 0;
      if (p.state !== 'kick') p.state = 'idle';
    }
  } else if (p.state === 'slide') {
    p.vx *= Math.exp(-3 * dt);
    p.vy *= Math.exp(-3 * dt);
  } else {
    p.vx = 0;
    p.vy = 0;
  }
  if (p.stateTimer <= 0 && (p.state === 'kick' || p.state === 'slide' || p.state === 'fallen')) {
    p.state = 'idle';
  }
  integrate(p, dt);
}

// Generic kick toward a target point (AI passes, shots, clearances).
export function kickToward(
  state: GameState,
  p: Player,
  tx: number,
  ty: number,
  speed: number,
  loft = 0,
): void {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const fx = dx / d;
  const fy = dy / d;
  const b = state.ball;
  b.x = p.x + fx * 6;
  b.y = p.y + fy * 6;
  b.vx = fx * speed;
  b.vy = fy * speed;
  b.vz = loft;
  b.spin = 0;
  b.aftertouch = 0;
  b.controlLock = 0.22;
  b.owner = p;
  p.dir = dirFromVec(fx, fy);
  p.state = 'kick';
  p.stateTimer = KICK_LOCK;
  // A hard strike reads as a shot/clearance; a gentle one as a pass.
  emitSfx(speed > 260 ? 'shot' : 'pass', clamp(speed / SHOT_MAX, 0.5, 1));
}
