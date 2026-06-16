// Match rules for the v1 slice: goals + scoring + kickoff, and ball out of
// bounds with a real restart: the taker walks to the spot during a brief dead
// pause, then DELIVERS the ball — a throw-in tossed infield from the line, a
// goal kick launched by the keeper, a corner crossed toward the box.
//
// Team 0 attacks the TOP goal (decreasing y); team 1 attacks the BOTTOM.

import type { GameState, Player } from './state';
import { kickToward } from './player';
import { emitSfx } from './audio';
import {
  FIELD_T,
  FIELD_B,
  FIELD_L,
  FIELD_R,
  CX,
  GOAL_W,
  SIX_BOX_D,
  PEN_SPOT_D,
  CORNER_R,
} from './world';

const GOAL_HEIGHT = 16; // ball above this z sails over the bar
const DEAD_TIME = 1.7; // celebration: ball rolls into the net, then kickoff
const RESTART_LOCK = 99; // ball is dead until the taker delivers it

type RestartKind = 'throw' | 'goalkick' | 'corner';

interface Restart {
  kind: RestartKind;
  taker: Player;
}

export interface Match {
  score: [number, number]; // [team0, team1]
  phase: 'play' | 'dead';
  deadTimer: number;
  deadReset: boolean; // true => return to kickoff when the dead timer ends
  restart: Restart | null; // pending delivery executed when the pause ends
  flash: number; // seconds remaining on the GOAL flash (HUD)
}

const RESTART_DEAD = 0.8; // brief pause to set up a throw-in / goal kick / corner

export function makeMatch(): Match {
  return { score: [0, 0], phase: 'play', deadTimer: 0, deadReset: false, restart: null, flash: 0 };
}

// Kickoff: ball at center, every player back on its formation home.
export function resetKickoff(state: GameState): void {
  const b = state.ball;
  const midY = (FIELD_T + FIELD_B) / 2;
  b.x = CX;
  b.y = midY;
  b.z = 0;
  b.prevX = b.x;
  b.prevY = b.y;
  b.prevZ = 0;
  b.vx = b.vy = b.vz = b.spin = 0;
  b.aftertouch = 0;
  b.controlLock = 0;
  b.owner = null;
  for (const p of state.players) {
    p.x = p.homeX;
    p.y = p.homeY;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vx = p.vy = p.z = p.vz = 0;
    p.state = 'idle';
    p.charging = false;
  }
  state.carrier = null;
  emitSfx('whistleKick');
}

function lastTouchTeam(state: GameState): 0 | 1 {
  return state.ball.owner ? state.ball.owner.team : 0;
}

// Park the ball at the restart spot, stand the taker on it, and queue the
// delivery (executed when the dead pause ends).
function placeRestart(
  state: GameState,
  match: Match,
  x: number,
  y: number,
  team: 0 | 1,
  kind: RestartKind,
): void {
  const b = state.ball;
  b.x = x;
  b.y = y;
  b.z = 0;
  b.prevX = x;
  b.prevY = y;
  b.prevZ = 0;
  b.vx = b.vy = b.vz = b.spin = 0;
  b.aftertouch = 0;
  b.controlLock = RESTART_LOCK; // dead until delivered
  b.owner = null;
  state.carrier = null;

  // Goal kicks are taken by the keeper; everything else by the nearest
  // outfielder of the restart team.
  let taker: Player | null = null;
  if (kind === 'goalkick') {
    taker = state.players.find((p) => p.team === team && p.role === 'gk') ?? null;
  }
  if (!taker) {
    let bestD = Infinity;
    for (const p of state.players) {
      if (p.team !== team || p.role === 'gk') continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        taker = p;
      }
    }
  }
  if (!taker) return;

  // Stand the taker at the spot: on the line for a throw-in (ball at the line,
  // thrower right behind it outside), just behind the ball otherwise.
  if (kind === 'throw') {
    taker.x = x < CX ? FIELD_L - 2 : FIELD_R + 2;
    taker.y = y;
  } else {
    const behind = team === 0 ? 5 : -5;
    taker.x = Math.max(FIELD_L + 2, Math.min(FIELD_R - 2, x));
    taker.y = Math.max(FIELD_T + 2, Math.min(FIELD_B - 2, y + behind));
  }
  taker.prevX = taker.x;
  taker.prevY = taker.y;
  taker.vx = taker.vy = 0;
  taker.state = 'idle';

  match.phase = 'dead';
  match.deadTimer = RESTART_DEAD;
  match.deadReset = false;
  match.restart = { kind, taker };
  emitSfx('whistleOut');
}

// Execute the queued delivery: throw the ball in / kick it out to play.
function deliverRestart(state: GameState, match: Match): void {
  const r = match.restart;
  if (!r) return;
  match.restart = null;
  const b = state.ball;
  const t = r.taker;

  // Default target: the best-placed teammate (closest, slightly preferring the
  // attacking direction); fall back to a point infield.
  let target: Player | null = null;
  let bestScore = Infinity;
  for (const m of state.players) {
    if (m.team !== t.team || m === t || m.role === 'gk') continue;
    const d = Math.hypot(m.x - b.x, m.y - b.y);
    const adv = t.team === 0 ? m.y - b.y : b.y - m.y; // negative = ahead
    const score = d + adv * 0.4;
    if (d > 14 && score < bestScore) {
      bestScore = score;
      target = m;
    }
  }

  b.controlLock = 0; // live again; kickToward re-locks briefly
  if (r.kind === 'throw') {
    const tx = target ? target.x : b.x < CX ? b.x + 50 : b.x - 50;
    const ty = target ? target.y : b.y;
    kickToward(state, t, tx, ty, 165, 95); // lobbed in from the line
  } else if (r.kind === 'goalkick') {
    const midY = (FIELD_T + FIELD_B) / 2;
    kickToward(state, t, CX + (b.x < CX ? 50 : -50), midY, 310, 120); // long punt
  } else {
    // Corner: cross toward the penalty spot of that end.
    const spotY = b.y < (FIELD_T + FIELD_B) / 2 ? FIELD_T + PEN_SPOT_D : FIELD_B - PEN_SPOT_D;
    kickToward(state, t, CX, spotY, 250, 105);
  }
}

function scoreGoal(_state: GameState, match: Match, scoringTeam: 0 | 1): void {
  match.score[scoringTeam]++;
  match.phase = 'dead';
  match.deadTimer = DEAD_TIME;
  match.deadReset = true;
  match.flash = DEAD_TIME;
  emitSfx('goal');
  // Don't reset yet — let the ball roll on into the net during the celebration.
  // resetKickoff happens when the dead timer elapses (see updateMatch).
}

export function updateMatch(state: GameState, match: Match, dt: number): void {
  if (match.flash > 0) match.flash = Math.max(0, match.flash - dt);

  if (match.phase === 'dead') {
    match.deadTimer -= dt;
    if (match.deadTimer <= 0) {
      if (match.deadReset) resetKickoff(state); // after a goal: back to center
      deliverRestart(state, match); // throw it in / kick it out to play
      match.phase = 'play';
    }
    return;
  }

  const b = state.ball;
  const inGoalMouth = Math.abs(b.x - CX) < GOAL_W / 2;
  const inset = 3; // place restarts this far inside the line

  // --- Goal lines (top / bottom) ---
  if (b.y < FIELD_T || b.y > FIELD_B) {
    const top = b.y < FIELD_T;
    if (inGoalMouth && b.z < GOAL_HEIGHT) {
      // Top goal is attacked by team 0, bottom by team 1.
      scoreGoal(state, match, top ? 0 : 1);
      return;
    }
    // Out over the goal line, no goal: goal kick or corner by last touch.
    const lineY = top ? FIELD_T : FIELD_B;
    const dir = top ? 1 : -1; // into-field direction
    const attackingTeam: 0 | 1 = top ? 0 : 1; // who attacks this line
    const defendingTeam: 0 | 1 = top ? 1 : 0;
    if (lastTouchTeam(state) === attackingTeam) {
      // Goal kick for the defenders: ball at the six-yard box.
      placeRestart(state, match, CX, lineY + dir * SIX_BOX_D, defendingTeam, 'goalkick');
    } else {
      // Corner for the attackers: nearest corner on the side the ball exited.
      const cornerX = b.x < CX ? FIELD_L + inset : FIELD_R - inset;
      placeRestart(state, match, cornerX, lineY + dir * CORNER_R, attackingTeam, 'corner');
    }
    return;
  }

  // --- Touchlines (left / right): throw-in to the team that didn't touch it ---
  if (b.x < FIELD_L || b.x > FIELD_R) {
    const x = b.x < FIELD_L ? FIELD_L : FIELD_R; // ball ON the line for the throw
    const y = Math.max(FIELD_T + inset, Math.min(FIELD_B - inset, b.y));
    const throwTeam: 0 | 1 = lastTouchTeam(state) === 0 ? 1 : 0;
    placeRestart(state, match, x, y, throwTeam, 'throw');
    return;
  }
}
