// Match rules for the v1 slice: goals + scoring + kickoff, and ball out of
// bounds with the right restart (throw-in / goal kick / corner). No referee,
// no whistle — restarts just place a live ball; the player runs onto it.
//
// Team 0 attacks the TOP goal (decreasing y); team 1 attacks the BOTTOM.

import type { GameState, Player } from './state';
import {
  FIELD_T,
  FIELD_B,
  FIELD_L,
  FIELD_R,
  CX,
  GOAL_W,
  SIX_BOX_D,
  CORNER_R,
} from './world';

const GOAL_HEIGHT = 16; // ball above this z sails over the bar
const DEAD_TIME = 1.7; // celebration: ball rolls into the net, then kickoff
const RESTART_LOCK = 0.4; // ball can't be re-controlled instantly off a restart

export interface Match {
  score: [number, number]; // [team0, team1]
  phase: 'play' | 'dead';
  deadTimer: number;
  deadReset: boolean; // true => return to kickoff when the dead timer ends
  flash: number; // seconds remaining on the GOAL flash (HUD)
}

const RESTART_DEAD = 0.8; // brief pause to set up a throw-in / goal kick / corner

export function makeMatch(): Match {
  return { score: [0, 0], phase: 'play', deadTimer: 0, deadReset: false, flash: 0 };
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
}

function lastTouchTeam(state: GameState): 0 | 1 {
  return state.ball.owner ? state.ball.owner.team : 0;
}

// Park the ball at a restart spot just inside the field and bring the nearest
// restart-team player to take it, with a brief dead-ball pause to set up.
function placeRestart(state: GameState, match: Match, x: number, y: number, team: 0 | 1): void {
  const b = state.ball;
  b.x = x;
  b.y = y;
  b.z = 0;
  b.prevX = x;
  b.prevY = y;
  b.prevZ = 0;
  b.vx = b.vy = b.vz = b.spin = 0;
  b.aftertouch = 0;
  b.controlLock = RESTART_LOCK;
  b.owner = null;
  state.carrier = null;

  // Nearest outfielder of the restart team comes to take it, placed just behind
  // the ball (toward their own goal) so they face up the pitch.
  let taker: Player | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team !== team || p.role === 'gk') continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      taker = p;
    }
  }
  if (taker) {
    const behind = team === 0 ? 5 : -5;
    taker.x = Math.max(FIELD_L + 2, Math.min(FIELD_R - 2, x));
    taker.y = Math.max(FIELD_T + 2, Math.min(FIELD_B - 2, y + behind));
    taker.prevX = taker.x;
    taker.prevY = taker.y;
    taker.vx = taker.vy = 0;
    taker.state = 'idle';
  }

  match.phase = 'dead';
  match.deadTimer = RESTART_DEAD;
  match.deadReset = false;
}

function scoreGoal(_state: GameState, match: Match, scoringTeam: 0 | 1): void {
  match.score[scoringTeam]++;
  match.phase = 'dead';
  match.deadTimer = DEAD_TIME;
  match.deadReset = true;
  match.flash = DEAD_TIME;
  // Don't reset yet — let the ball roll on into the net during the celebration.
  // resetKickoff happens when the dead timer elapses (see updateMatch).
}

export function updateMatch(state: GameState, match: Match, dt: number): void {
  if (match.flash > 0) match.flash = Math.max(0, match.flash - dt);

  if (match.phase === 'dead') {
    match.deadTimer -= dt;
    if (match.deadTimer <= 0) {
      if (match.deadReset) resetKickoff(state); // after a goal: back to center
      match.phase = 'play'; // restarts just resume with the ball in place
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
      placeRestart(state, match, CX, lineY + dir * SIX_BOX_D, defendingTeam);
    } else {
      // Corner for the attackers: nearest corner on the side the ball exited.
      const cornerX = b.x < CX ? FIELD_L + inset : FIELD_R - inset;
      placeRestart(state, match, cornerX, lineY + dir * CORNER_R, attackingTeam);
    }
    return;
  }

  // --- Touchlines (left / right): throw-in to the team that didn't touch it ---
  if (b.x < FIELD_L || b.x > FIELD_R) {
    const x = b.x < FIELD_L ? FIELD_L + inset : FIELD_R - inset;
    const y = Math.max(FIELD_T + inset, Math.min(FIELD_B - inset, b.y));
    const throwTeam: 0 | 1 = lastTouchTeam(state) === 0 ? 1 : 0;
    placeRestart(state, match, x, y, throwTeam);
    return;
  }
}
