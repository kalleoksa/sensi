// Minimal per-player AI. Each tick: the team's closest player to a loose/
// opponent ball chases; a carrier dribbles toward goal and shoots or passes;
// everyone else holds a formation anchor shifted toward the ball. The GK tracks
// the ball along its line and clears if it ends up with the ball.

import { Dir, type GameState, type Player } from './state';
import { moveToward, kickToward, PLAYER_SPEED } from './player';
import {
  FIELD_T,
  FIELD_B,
  FIELD_L,
  FIELD_R,
  CX,
  GOAL_W,
} from './world';

const AI_SPEED = PLAYER_SPEED * 0.94; // a touch slower than the human
const SHOOT_RANGE = 130;
const PASS_PRESSURE = 16; // an opponent this close makes the carrier look to pass
const MID_Y = (FIELD_T + FIELD_B) / 2;

// Goalkeeper dive tuning.
const DIVE_SPEED = 150; // lateral lunge speed along the goal line
const DIVE_POP = 64; // initial vz so the keeper leaves the ground
const GK_GRAVITY = 360; // pulls the diving keeper back down (matches the ball)
const DIVE_LOOKAHEAD = 0.62; // only react to shots arriving within this many sec
const DIVE_REACH_MIN = 6; // smaller offsets are covered just by standing/tracking
const DIVE_REACH_MAX = 40; // beyond this the keeper can't get there — it's a goal

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// The goal line each team attacks / defends.
function attackGoalY(team: 0 | 1): number {
  return team === 0 ? FIELD_T : FIELD_B;
}
function ownGoalY(team: 0 | 1): number {
  return team === 0 ? FIELD_B : FIELD_T;
}

function nearestOpponent(state: GameState, p: Player): { opp: Player | null; d: number } {
  let opp: Player | null = null;
  let best = Infinity;
  for (const q of state.players) {
    if (q.team === p.team) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best) {
      best = d;
      opp = q;
    }
  }
  return { opp, d: best };
}

function carrierAi(state: GameState, p: Player, dt: number): void {
  const goalY = attackGoalY(p.team);
  const dGoal = Math.hypot(CX - p.x, goalY - p.y);

  if (dGoal < SHOOT_RANGE) {
    // In range: shoot at the goal with a little loft.
    kickToward(state, p, CX, goalY, 360, 70);
    return;
  }

  const { opp, d } = nearestOpponent(state, p);
  if (opp && d < PASS_PRESSURE) {
    // Under pressure: pass to the most-advanced open teammate, else just run on.
    let best: Player | null = null;
    let bestAdv = -Infinity;
    for (const m of state.players) {
      if (m.team !== p.team || m === p || m.role === 'gk') continue;
      const advance = p.team === 0 ? p.y - m.y : m.y - p.y; // ahead of carrier
      const mark = nearestOpponent(state, m).d;
      if (advance > 8 && mark > 18 && advance > bestAdv) {
        bestAdv = advance;
        best = m;
      }
    }
    if (best) {
      kickToward(state, p, best.x, best.y, 215);
      return;
    }
  }
  // Dribble toward goal: running into the ball nudges it forward (no glue).
  moveToward(p, CX, goalY, dt, AI_SPEED);
}

function gkAi(state: GameState, p: Player, dt: number): void {
  const b = state.ball;

  // Mid-dive: the keeper is airborne and committed — coast laterally under
  // gravity until it lands ("input lock: until landed"). resolvePossession
  // turns a body that reaches the low ball into a catch on its own.
  if (p.state === 'gkdive') {
    p.prevX = p.x;
    p.prevY = p.y;
    p.x += p.vx * dt;
    p.vz -= GK_GRAVITY * dt;
    p.z += p.vz * dt;
    if (p.z <= 0) {
      p.z = 0;
      p.vz = 0;
      p.vx = 0;
      p.state = 'idle';
    }
    return;
  }

  // Cleared the ball if it ended up at the keeper's feet (caught a dive too).
  if (state.carrier === p) {
    p.z = 0;
    kickToward(state, p, CX + (b.x < CX ? 40 : -40), MID_Y, 300, 90);
    return;
  }

  const lineY = ownGoalY(p.team) + (p.team === 0 ? -7 : 7);

  // Dive at a low shot heading goalward that will cross the line offset from
  // the keeper — too far to cover by tracking, but within a dive's reach.
  const towardGoal = p.team === 0 ? b.vy > 60 : b.vy < -60;
  if (towardGoal && b.z < 12) {
    const t = (lineY - b.y) / b.vy; // time until the ball reaches the line
    if (t > 0 && t < DIVE_LOOKAHEAD) {
      const predX = b.x + b.vx * t;
      const onTarget = Math.abs(predX - CX) < GOAL_W / 2 + 6;
      const offset = predX - p.x;
      if (onTarget && Math.abs(offset) > DIVE_REACH_MIN && Math.abs(offset) < DIVE_REACH_MAX) {
        p.state = 'gkdive';
        p.dir = offset > 0 ? Dir.R : Dir.L;
        p.vx = Math.sign(offset) * DIVE_SPEED;
        p.vy = 0;
        p.vz = DIVE_POP;
        return;
      }
    }
  }

  const tx = clamp(b.x, CX - GOAL_W / 2 + 4, CX + GOAL_W / 2 - 4);
  // Edge off the line toward the ball when it's close and central.
  const ballClose = Math.abs(b.y - lineY) < 80 && Math.abs(b.x - CX) < GOAL_W;
  const ty = ballClose ? lineY + (p.team === 0 ? -10 : 10) : lineY;
  moveToward(p, tx, ty, dt, AI_SPEED, 1);
}

function positionHome(state: GameState, p: Player, dt: number): void {
  const b = state.ball;
  // Each player holds a point a role-weighted fraction of the way from THEIR
  // OWN home toward the ball. Unlike a global shift (which shoved everyone
  // past the field edge and clamped the whole team onto one line), this keeps
  // the formation's relative spacing while the team tracks play as a unit.
  const w = p.role === 'fwd' ? 0.5 : p.role === 'mid' ? 0.35 : 0.2;
  const tx = clamp(p.homeX + (b.x - p.homeX) * w * 0.7, FIELD_L + 4, FIELD_R - 4);
  const ty = clamp(p.homeY + (b.y - p.homeY) * w, FIELD_T + 6, FIELD_B - 6);
  moveToward(p, tx, ty, dt, AI_SPEED * 0.92);
}

export function updateTeamAi(state: GameState, dt: number): void {
  const b = state.ball;
  // Closest AI outfielder to the ball on each team (the designated chaser).
  // Exclude keepers and the human-controlled player — if one of those counted
  // as "nearest", the team's actual chaser slot went unfilled and nobody moved.
  const nearest: (Player | null)[] = [null, null];
  const nd = [Infinity, Infinity];
  for (const p of state.players) {
    if (p.role === 'gk' || p === state.controlled || p === state.controlled2) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < nd[p.team]) {
      nd[p.team] = d;
      nearest[p.team] = p;
    }
  }

  for (const p of state.players) {
    if (p === state.controlled || p === state.controlled2) continue; // human-driven
    if (p.role === 'gk') {
      gkAi(state, p, dt);
      continue;
    }
    if (state.carrier === p) {
      carrierAi(state, p, dt);
      continue;
    }
    const teamHasBall = state.carrier != null && state.carrier.team === p.team;
    if (nearest[p.team] === p && !teamHasBall) {
      // Chase / press right onto the ball (arrive=1) so contact pokes it loose.
      moveToward(p, b.x, b.y, dt, AI_SPEED, 1);
      continue;
    }
    positionHome(state, p, dt);
  }
}
