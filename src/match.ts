// Match rules for the v1 slice: goals + scoring + kickoff, and ball out of
// bounds with the right restart (throw-in / goal kick / corner). No referee,
// no whistle — restarts just place a live ball; the player runs onto it.
//
// Team 0 attacks the TOP goal (decreasing y); team 1 attacks the BOTTOM.

import type { GameState } from './state';
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
  flash: number; // seconds remaining on the GOAL flash (HUD)
}

export function makeMatch(): Match {
  return { score: [0, 0], phase: 'play', deadTimer: 0, flash: 0 };
}

// Kickoff: ball at center, the human just behind it (team 0 attacks up).
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
    const home = p.team === 0 ? midY + 22 : midY - 22;
    p.x = CX;
    p.y = home;
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

// Park the ball dead at a restart spot, just inside the field, live again.
function placeRestart(state: GameState, x: number, y: number): void {
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
}

function scoreGoal(_state: GameState, match: Match, scoringTeam: 0 | 1): void {
  match.score[scoringTeam]++;
  match.phase = 'dead';
  match.deadTimer = DEAD_TIME;
  match.flash = DEAD_TIME;
  // Don't reset yet — let the ball roll on into the net during the celebration.
  // resetKickoff happens when the dead timer elapses (see updateMatch).
}

export function updateMatch(state: GameState, match: Match, dt: number): void {
  if (match.flash > 0) match.flash = Math.max(0, match.flash - dt);

  if (match.phase === 'dead') {
    match.deadTimer -= dt;
    if (match.deadTimer <= 0) {
      resetKickoff(state); // ball was in the net; now restart from center
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
    if (lastTouchTeam(state) === attackingTeam) {
      // Goal kick for the defenders: ball at the six-yard box.
      placeRestart(state, CX, lineY + dir * SIX_BOX_D);
    } else {
      // Corner for the attackers: nearest corner on the side the ball exited.
      const cornerX = b.x < CX ? FIELD_L + inset : FIELD_R - inset;
      placeRestart(state, cornerX, lineY + dir * CORNER_R);
    }
    return;
  }

  // --- Touchlines (left / right): throw-in at the exit point ---
  if (b.x < FIELD_L || b.x > FIELD_R) {
    const x = b.x < FIELD_L ? FIELD_L + inset : FIELD_R - inset;
    const y = Math.max(FIELD_T + inset, Math.min(FIELD_B - inset, b.y));
    placeRestart(state, x, y);
    return;
  }
}
