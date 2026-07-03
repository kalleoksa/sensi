// Penalty shootout: settles a drawn knockout tie (Cup / World Cup KO rounds)
// with real, playable kicks instead of a coin flip. Best of five, alternating,
// then sudden death. All kicks are taken at the TOP goal; the defending keeper
// is the regular gkAi (dive prediction + the mid-air catch), so saves emerge
// from the same physics as open play.
//
// Human kicks: LEFT/RIGHT moves the aim marker across the goal mouth, HOLD
// action builds power, release strikes. AI kicks alternate corners with a
// deterministic wobble (the occasional one blazed wide) so shootouts end.

import type { GameState, Player } from './state';
import { stepBall } from './ball';
import { kickToward, resolveKeeperSaves } from './player';
import { gkAi } from './ai';
import { updateCamera } from './world';
import { consumeInputs } from './input';
import { emitSfx } from './audio';
import { FIELD_T, FIELD_B, FIELD_L, FIELD_R, CX, GOAL_W, GOAL_HEIGHT, PEN_SPOT_D } from './world';
import type { Session } from './session';

const SPOT_Y = FIELD_T + PEN_SPOT_D;
const AI_AIM_TIME = 0.9; // how long an AI taker stands over the ball
const RESULT_TIME = 1.5; // GOAL/SAVED banner hold between kicks
const BALL_TIMEOUT = 3.0; // a kick unresolved this long counts as missed
const GK_REACTION = 0.07; // the keeper moves this long after the strike — without
// it his dive + catch reach covers the whole goal mouth and corners never score
const AIM_SPEED = 1.6; // how fast the human aim marker sweeps (units/s)
const KICK_MIN = 300; // ball speed at zero charge
const KICK_MAX = 385; // and at full charge
const MAX_CHARGE = 0.7;

export interface Shootout {
  score: [number, number];
  taken: [number, number];
  kickTeam: 0 | 1;
  stage: 'place' | 'aim' | 'ball' | 'result' | 'done';
  timer: number;
  aim: number; // -1 (left post) .. +1 (right post); |aim| > ~0.92 risks wide
  charge: number;
  charging: boolean;
  lastResult: 'goal' | 'saved' | 'missed' | null;
  winner: 0 | 1 | null;
  kicker: Player | null;
  keeper: Player | null;
}

export function makeShootout(state: GameState): Shootout {
  const s: Shootout = {
    score: [0, 0],
    taken: [0, 0],
    kickTeam: 0,
    stage: 'place',
    timer: 0.6,
    aim: 0,
    charge: 0,
    charging: false,
    lastResult: null,
    winner: null,
    kicker: null,
    keeper: null,
  };
  // Everyone not involved waits around the centre circle.
  const midY = (FIELD_T + FIELD_B) / 2;
  state.players.forEach((p, i) => {
    if (p.sentOff) return;
    const ang = (i / state.players.length) * Math.PI * 2;
    p.x = CX + Math.cos(ang) * 40;
    p.y = midY + Math.sin(ang) * 30;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vx = p.vy = p.z = p.vz = 0;
    p.state = 'idle';
    p.charging = false;
  });
  state.carrier = null;
  state.controlled = null;
  state.controlled2 = null;
  state.offsideWatch = null;
  return s;
}

// The taker rotation: outfielders in squad order, wrapping around.
function takerFor(state: GameState, team: 0 | 1, nth: number): Player {
  const pool = state.players.filter((p) => p.team === team && p.role !== 'gk' && !p.sentOff);
  return pool[nth % pool.length];
}

function place(state: GameState, s: Shootout): void {
  const b = state.ball;
  b.x = CX;
  b.y = SPOT_Y;
  b.z = 0;
  b.prevX = b.x;
  b.prevY = b.y;
  b.prevZ = 0;
  b.vx = b.vy = b.vz = b.spin = 0;
  b.aftertouch = 0;
  b.controlLock = 0;
  b.owner = null;

  s.kicker = takerFor(state, s.kickTeam, s.taken[s.kickTeam]);
  s.keeper =
    state.players.find((p) => p.team !== s.kickTeam && p.role === 'gk' && !p.sentOff) ?? null;
  const k = s.kicker;
  k.x = CX;
  k.y = SPOT_Y + 8;
  k.prevX = k.x;
  k.prevY = k.y;
  k.vx = k.vy = 0;
  k.dir = 0; // facing up at the goal
  k.state = 'idle';
  const gk = s.keeper;
  if (gk) {
    gk.x = CX;
    gk.y = FIELD_T + 7;
    gk.prevX = gk.x;
    gk.prevY = gk.y;
    gk.vx = gk.vy = gk.z = gk.vz = 0;
    gk.state = 'idle';
  }
  s.aim = 0;
  s.charge = 0;
  s.charging = false;
  s.stage = 'aim';
  s.timer = 0;
  emitSfx('whistleKick');
}

function shoot(state: GameState, s: Shootout, aim: number, charge: number): void {
  const k = s.kicker!;
  const frac = Math.min(1, Math.max(0, charge / MAX_CHARGE));
  const speed = KICK_MIN + frac * (KICK_MAX - KICK_MIN);
  const tx = CX + aim * (GOAL_W / 2 + 2); // full tilt aims just past the post
  kickToward(state, k, tx, FIELD_T - 2, speed, 10 + frac * 26, false);
  s.stage = 'ball';
  s.timer = 0;
}

// Deterministic AI aim: alternate corners with a wobble; every so often one is
// blazed wide so sudden death can't loop forever.
function aiAim(s: Shootout): number {
  const v = s.taken[0] + s.taken[1];
  if ((v * 5 + 2) % 7 === 0) return 1.12 * (v % 2 === 0 ? 1 : -1); // wide!
  const side = v % 2 === 0 ? -1 : 1;
  return side * (0.55 + 0.15 * ((v * 3) % 3)); // 0.55 / 0.70 / 0.85 toward a corner
}

function recordKick(s: Shootout, scored: boolean, saved: boolean): void {
  s.taken[s.kickTeam]++;
  if (scored) {
    s.score[s.kickTeam]++;
    emitSfx('goal');
  }
  s.lastResult = scored ? 'goal' : saved ? 'saved' : 'missed';
  s.stage = 'result';
  s.timer = RESULT_TIME;
}

// Best-of-five with early decision, then sudden death on level kicks.
function judge(s: Shootout): 0 | 1 | null {
  const [a, b] = s.score;
  const [ta, tb] = s.taken;
  if (ta <= 5 && tb <= 5) {
    if (a > b + (5 - tb)) return 0; // team 1 can't catch up
    if (b > a + (5 - ta)) return 1;
  }
  if (ta >= 5 && tb >= 5 && ta === tb && a !== b) return a > b ? 0 : 1;
  return null;
}

export function stepShootout(session: Session, dt: number): void {
  const s = session.shootout!;
  const state = session.state;
  const b = state.ball;
  const input = consumeInputs(session.config.controlMode === '2p');

  if (s.stage === 'place') {
    s.timer -= dt;
    if (s.timer <= 0) place(state, s);
  } else if (s.stage === 'aim') {
    s.timer += dt;
    const human = session.match.humanTeams[s.kickTeam];
    if (human) {
      const frame = s.kickTeam === 0 ? input.p1 : input.p2;
      if (frame) {
        s.aim = Math.max(-1, Math.min(1, s.aim + frame.dx * AIM_SPEED * dt));
        if (frame.pressed) {
          s.charging = true;
          s.charge = 0;
        }
        if (s.charging && frame.down) s.charge = Math.min(s.charge + dt, MAX_CHARGE);
        if (s.charging && frame.released) shoot(state, s, s.aim, s.charge);
      }
      if (s.timer > 10) shoot(state, s, s.aim, 0.4); // idle failsafe
    } else if (s.timer >= AI_AIM_TIME) {
      shoot(state, s, aiAim(s), 0.55);
    }
  } else if (s.stage === 'ball') {
    s.timer += dt;
    stepBall(b, dt);
    if (s.keeper) {
      if (s.timer > GK_REACTION) gkAi(state, s.keeper, dt);
      resolveKeeperSaves(state);
    }
    // Let the kicker's kick pose expire.
    const k = s.kicker!;
    if (k.stateTimer > 0) {
      k.stateTimer = Math.max(0, k.stateTimer - dt);
      if (k.stateTimer <= 0 && k.state === 'kick') k.state = 'idle';
    }
    // Ground-ball block: open play stops low balls via resolvePossession, which
    // doesn't run here — so a rolling shot into the keeper's body is a save.
    if (
      s.keeper &&
      b.z < 6 &&
      Math.abs(b.z - s.keeper.z) < 8 &&
      Math.hypot(b.x - s.keeper.x, b.y - s.keeper.y) < 10
    ) {
      b.vx *= 0.05;
      b.vy *= 0.05;
      b.vz = 0;
      b.owner = s.keeper;
      emitSfx('tackle', 0.6);
    }
    const inMouth = Math.abs(b.x - CX) < GOAL_W / 2;
    if (b.y < FIELD_T) {
      recordKick(s, inMouth && b.z < GOAL_HEIGHT, false);
    } else if (s.keeper && b.owner === s.keeper) {
      recordKick(s, false, true); // in the keeper's hands
    } else if (
      s.timer > BALL_TIMEOUT ||
      b.x < FIELD_L ||
      b.x > FIELD_R ||
      (s.timer > 0.5 && Math.hypot(b.vx, b.vy) < 8)
    ) {
      recordKick(s, false, false); // rolled dead / wide
    }
  } else if (s.stage === 'result') {
    stepBall(b, dt);
    if (s.keeper) gkAi(state, s.keeper, dt); // he gathers / gets up naturally
    s.timer -= dt;
    if (s.timer <= 0) {
      const w = judge(s);
      if (w !== null) {
        s.winner = w;
        s.stage = 'done';
        s.timer = 3.0;
        emitSfx('whistleGoal');
      } else {
        s.kickTeam = (1 - s.kickTeam) as 0 | 1;
        s.stage = 'place';
        s.timer = 0.5;
      }
    }
  } else {
    // done: hold the banner; the app moves on when the timer runs out.
    s.timer -= dt;
  }

  updateCamera(state.camera, b.x, b.y, b.vx, b.vy, dt);
}
