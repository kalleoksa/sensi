// Per-player AI, organised around a per-tick DUTY assignment.
//
// Each step computeDuties() looks at who has the ball and hands every AI
// outfielder one job — press, cover, mark, support, hold (plus carrier / gk).
// updateTeamAi() then just dispatches each player to the behaviour for its
// duty. The duty layer is the seam: a richer tactical assigner can replace
// computeDuties() later without touching the behaviours or their callers.
//
// Phases (per team, derived from state.carrier):
//   attack  — a teammate carries: a few mids/fwds make runs (support), the
//             rest hold a compact shape that pushes up.
//   defend  — an opponent carries: nearest presses, second covers behind, the
//             defenders mark opposing attackers goal-side, rest hold compact.
//   loose   — no carrier: the nearest chases, everyone else tracks the ball.

import type { GameState, Player } from './state';
import { moveToward, kickToward, PLAYER_SPEED } from './player';
import { GROUND_FRICTION } from './ball';
import { FIELD_T, FIELD_B, FIELD_L, FIELD_R, PLAY_W, CX, GOAL_W } from './world';

const AI_SPEED = PLAYER_SPEED * 0.94; // a touch slower than the human
const SHOOT_RANGE = 130;
const COMFORT_ZONE = 26; // opponent within this AND ahead => carrier feels threatened
const DRIBBLE_AVOID = 40; // defender within this => carrier veers around them
const MAX_SUPPORT = 3; // off-ball attackers making forward runs at once

// Pass / shot evaluation speeds (must match the speeds the AI actually kicks at,
// so the interception test predicts real ball travel — see carrierAi/kickToward).
const PASS_EVAL_SPEED = 215;
const SHOT_EVAL_SPEED = 360;
const MIN_PASS_DIST = 24; // shorter than this isn't worth a pass
const INTERCEPT_PAD = 8; // player+ball radii: opponent this close to the lane intercepts

// SupportSpotCalculator (Buckland "Simple Soccer"): a grid of candidate spots in
// the attacking half, each scored on pass-safety + shooting potential + an
// optimal distance from the carrier. The best spots become the supporters' runs.
const SUPPORT_COLS = 4;
const SUPPORT_ROWS = 5;
const SUPPORT_PASS_SAFE_W = 2;
const SUPPORT_CAN_SHOOT_W = 1;
const SUPPORT_DIST_W = 2;
const SUPPORT_ADVANCE_W = 1; // prefer spots ahead of the ball
const SUPPORT_OPTIMAL_DIST = 70; // px from the carrier a supporter wants to be
const SUPPORT_MIN_SEP = 44; // keep supporters from piling on one spot
const SUPPORT_TRAVEL_W = 0.02; // mild bias: a supporter prefers nearer good spots

const MARK_GAP = 12; // a marker sits this far goal-side of its man
const COVER_GAP = 22; // the cover player sits this far behind the ball toward own goal
const HOLD_DROP = 6; // extra goal-side bias on the holding block when defending
const MID_Y = (FIELD_T + FIELD_B) / 2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// The goal line each player attacks / defends (depends on the current half via
// the per-player attacksTop flag, set by setupHalf).
function attackGoalY(p: Player): number {
  return p.attacksTop ? FIELD_T : FIELD_B;
}
function ownGoalY(p: Player): number {
  return p.attacksTop ? FIELD_B : FIELD_T;
}

// How far toY is ahead of fromY in p's attacking direction (positive = ahead).
function advanceOf(p: Player, fromY: number, toY: number): number {
  return p.attacksTop ? fromY - toY : toY - fromY;
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

// Distance from a point to the nearest player NOT on `team` — i.e. how open the
// point is for that team (passing target openness).
function nearestEnemyDist(state: GameState, x: number, y: number, team: 0 | 1): number {
  let best = Infinity;
  for (const q of state.players) {
    if (q.team === team) continue;
    const d = Math.hypot(q.x - x, q.y - y);
    if (d < best) best = d;
  }
  return best;
}

// --- passability (Buckland's geometric interception test) -------------------

// Time for a ground ball kicked at speed v0 to roll a distance d, under the
// game's rolling friction (v(t) = v0 * exp(-k t), so d = (v0/k)(1 - exp(-k t))).
// Returns Infinity if the ball stops short of d — i.e. the kick can't reach.
function ballTravelTime(d: number, v0: number): number {
  const reach = v0 / GROUND_FRICTION; // asymptotic max distance
  if (d >= reach) return Infinity;
  return -Math.log(1 - d / reach) / GROUND_FRICTION;
}

// Can the ball be kicked from->to without an opponent intercepting? Each
// opponent is projected onto the pass line: ignore those behind the kicker;
// for the rest, compare when the ball passes their perpendicular foot against
// how long they'd need to step into the lane. Deterministic, no RNG.
function passSafe(
  state: GameState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  team: 0 | 1,
  v0: number,
  excludeGk = false,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const passDist = Math.hypot(dx, dy) || 1;
  const ux = dx / passDist;
  const uy = dy / passDist;
  for (const q of state.players) {
    if (q.team === team) continue;
    if (excludeGk && q.role === 'gk') continue;
    const ox = q.x - fromX;
    const oy = q.y - fromY;
    const along = ox * ux + oy * uy; // distance along the pass
    if (along < 0) continue; // behind the kicker: can't catch a faster ball
    const perp = Math.abs(-ox * uy + oy * ux); // distance from the lane
    const foot = Math.min(along, passDist);
    const tBall = ballTravelTime(foot, v0);
    if (!isFinite(tBall)) continue; // ball stops before reaching this opponent
    if (perp <= PLAYER_SPEED * tBall + INTERCEPT_PAD) return false; // can step in
  }
  return true;
}

// --- duty assignment --------------------------------------------------------

export function computeDuties(state: GameState): void {
  assignTeamDuties(state, 0);
  assignTeamDuties(state, 1);
}

function assignTeamDuties(state: GameState, team: 0 | 1): void {
  const b = state.ball;
  const carrier = state.carrier;
  const teamHasBall = carrier != null && carrier.team === team;

  // Tag fixed duties (gk, carrier, human) and collect the AI outfielders that
  // still need a job this tick.
  const ai: Player[] = [];
  for (const p of state.players) {
    if (p.team !== team) continue;
    p.markTarget = null;
    if (p.role === 'gk') {
      p.duty = 'gk';
      continue;
    }
    if (p === state.controlled || p === state.controlled2) {
      p.duty = carrier === p ? 'carrier' : 'hold';
      continue; // human-driven; duty is cosmetic, AI won't act on it
    }
    if (carrier === p) {
      p.duty = 'carrier';
      continue;
    }
    ai.push(p);
  }
  if (ai.length === 0) return;

  // Stable nearest-to-ball ordering (deterministic: distance, then array index).
  const idx = new Map(state.players.map((p, i) => [p, i] as const));
  const byBall = [...ai].sort((a, c) => {
    const da = Math.hypot(a.x - b.x, a.y - b.y);
    const dc = Math.hypot(c.x - b.x, c.y - b.y);
    return da !== dc ? da - dc : (idx.get(a) ?? 0) - (idx.get(c) ?? 0);
  });

  if (teamHasBall) {
    // Attack: the nearest few mids/fwds make runs; defenders & extras hold.
    let support = 0;
    for (const p of byBall) {
      if (support < MAX_SUPPORT && (p.role === 'fwd' || p.role === 'mid')) {
        p.duty = 'support';
        support++;
      } else {
        p.duty = 'hold';
      }
    }
    if (carrier) assignSupportTargets(state, carrier);
  } else if (carrier == null) {
    // Loose ball: nearest chases, the rest hold and track the ball.
    byBall.forEach((p, i) => {
      p.duty = i === 0 ? 'press' : 'hold';
    });
  } else {
    // Defend: press + cover the ball, defenders mark, rest hold compact.
    byBall.forEach((p, i) => {
      p.duty = i === 0 ? 'press' : i === 1 ? 'cover' : p.role === 'def' ? 'mark' : 'hold';
    });
    assignMarks(state, team);
  }
}

// Greedily pair each marker with an opposing attacker — most dangerous threats
// (nearest our goal) claim the closest free marker first; surplus markers hold.
function assignMarks(state: GameState, team: 0 | 1): void {
  const markers = state.players.filter((p) => p.team === team && p.duty === 'mark');
  if (markers.length === 0) return;
  const goalY = ownGoalY(markers[0]);
  const opps = state.players.filter((p) => p.team !== team && p.role !== 'gk');
  opps.sort((a, c) => Math.abs(a.y - goalY) - Math.abs(c.y - goalY));

  const taken = new Set<Player>();
  for (const opp of opps) {
    let best: Player | null = null;
    let bd = Infinity;
    for (const m of markers) {
      if (taken.has(m)) continue;
      const d = Math.hypot(m.x - opp.x, m.y - opp.y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (!best) break;
    best.markTarget = opp;
    taken.add(best);
  }
  // More markers than attackers: the leftovers just hold the line.
  for (const m of markers) if (!m.markTarget) m.duty = 'hold';
}

interface Spot {
  x: number;
  y: number;
  score: number;
}

// Score a candidate support spot for the team in possession (Buckland's
// SupportSpotCalculator): reward spots a safe pass can reach, that a shot could
// come from, that sit an optimal distance from the carrier, and that advance
// play. Higher is better; a base of 1 keeps every spot weakly viable.
function scoreSpot(state: GameState, carrier: Player, x: number, y: number, goalY: number): number {
  let score = 1;
  const passDist = Math.hypot(x - carrier.x, y - carrier.y);

  if (
    passDist > MIN_PASS_DIST &&
    isFinite(ballTravelTime(passDist, PASS_EVAL_SPEED)) &&
    passSafe(state, carrier.x, carrier.y, x, y, carrier.team, PASS_EVAL_SPEED)
  ) {
    score += SUPPORT_PASS_SAFE_W;
  }

  // A shot from here (ignoring the keeper, who you're trying to beat) is on.
  const shotDist = Math.hypot(CX - x, goalY - y);
  if (shotDist < SHOOT_RANGE && passSafe(state, x, y, CX, goalY, carrier.team, SHOT_EVAL_SPEED, true)) {
    score += SUPPORT_CAN_SHOOT_W;
  }

  // Closeness to the ideal support distance from the carrier.
  score += SUPPORT_DIST_W * Math.max(0, 1 - Math.abs(SUPPORT_OPTIMAL_DIST - passDist) / SUPPORT_OPTIMAL_DIST);

  // Prefer spots ahead of the ball in the attacking direction.
  const advance = advanceOf(carrier, carrier.y, y);
  score += SUPPORT_ADVANCE_W * Math.max(0, Math.min(1, advance / 120));

  return score;
}

// Lay a grid of spots over the attacking half, score them, and assign each
// supporter the best free spot near it (claimed spots block their neighbours so
// supporters spread out rather than pile onto the single best spot).
function assignSupportTargets(state: GameState, carrier: Player): void {
  const supporters: Player[] = [];
  for (const p of state.players) if (p.team === carrier.team && p.duty === 'support') supporters.push(p);
  if (supporters.length === 0) return;

  const goalY = carrier.attacksTop ? FIELD_T : FIELD_B;
  const yFar = carrier.attacksTop ? FIELD_T + 24 : FIELD_B - 24; // just off the goal line
  const spots: Spot[] = [];
  for (let c = 0; c < SUPPORT_COLS; c++) {
    const x = FIELD_L + 8 + ((c + 0.5) / SUPPORT_COLS) * (PLAY_W - 16);
    for (let r = 0; r < SUPPORT_ROWS; r++) {
      const y = MID_Y + (yFar - MID_Y) * ((r + 0.5) / SUPPORT_ROWS);
      spots.push({ x, y, score: scoreSpot(state, carrier, x, y, goalY) });
    }
  }

  const claimed: Spot[] = [];
  for (const sp of supporters) {
    let best: Spot | null = null;
    let bestVal = -Infinity;
    for (const spot of spots) {
      let blocked = false;
      for (const cl of claimed) {
        if (Math.hypot(cl.x - spot.x, cl.y - spot.y) < SUPPORT_MIN_SEP) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      // Bias toward good spots this supporter doesn't have to run as far to reach.
      const val = spot.score - SUPPORT_TRAVEL_W * Math.hypot(spot.x - sp.x, spot.y - sp.y);
      if (val > bestVal) {
        bestVal = val;
        best = spot;
      }
    }
    if (best) {
      claimed.push(best);
      sp.supportX = best.x;
      sp.supportY = best.y;
    } else {
      sp.supportX = sp.homeX;
      sp.supportY = sp.homeY;
    }
  }
}

// --- behaviours -------------------------------------------------------------

export function updateTeamAi(state: GameState, dt: number): void {
  computeDuties(state);
  for (const p of state.players) {
    if (p === state.controlled || p === state.controlled2) continue; // human-driven
    switch (p.duty) {
      case 'gk':
        gkAi(state, p, dt);
        break;
      case 'carrier':
        carrierAi(state, p, dt);
        break;
      case 'press':
        // Chase / press right onto the ball (arrive=1) so contact pokes it loose.
        moveToward(p, state.ball.x, state.ball.y, dt, AI_SPEED, 1);
        break;
      case 'cover':
        coverAi(state, p, dt);
        break;
      case 'mark':
        markAi(state, p, dt);
        break;
      case 'support':
        supportAi(p, dt);
        break;
      case 'hold':
        holdAi(state, p, dt);
        break;
    }
  }
}

interface PassOption {
  mate: Player;
  advance: number;
  score: number;
}

// Best forward pass available to the carrier: a teammate ahead, reachable, with
// a lane no opponent can intercept (geometric passSafe test). Among safe passes,
// prefer the one that advances furthest and leaves the receiver most open.
function bestPass(state: GameState, p: Player): PassOption | null {
  let best: PassOption | null = null;
  let bestScore = -Infinity;
  for (const m of state.players) {
    if (m.team !== p.team || m === p || m.role === 'gk') continue;
    const advance = advanceOf(p, p.y, m.y);
    if (advance < 4) continue; // only forward-ish balls
    const passDist = Math.hypot(m.x - p.x, m.y - p.y);
    if (passDist < MIN_PASS_DIST) continue; // too short to bother
    if (!isFinite(ballTravelTime(passDist, PASS_EVAL_SPEED))) continue; // out of range
    if (!passSafe(state, p.x, p.y, m.x, m.y, p.team, PASS_EVAL_SPEED)) continue; // lane cut
    const open = nearestEnemyDist(state, m.x, m.y, p.team);
    const score = advance + open * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = { mate: m, advance, score };
    }
  }
  return best;
}

// Is an opponent close enough AND ahead (toward our goal) to threaten the
// carrier? Buckland's "threatened" gate: only then does the carrier rush a pass.
function threatened(state: GameState, p: Player): boolean {
  const goalY = attackGoalY(p);
  let gx = CX - p.x;
  let gy = goalY - p.y;
  const gl = Math.hypot(gx, gy) || 1;
  gx /= gl;
  gy /= gl;
  for (const q of state.players) {
    if (q.team === p.team) continue;
    const ox = q.x - p.x;
    const oy = q.y - p.y;
    if (Math.hypot(ox, oy) >= COMFORT_ZONE) continue;
    if (ox * gx + oy * gy > 0) return true; // within the zone and in front
  }
  return false;
}

function carrierAi(state: GameState, p: Player, dt: number): void {
  const goalY = attackGoalY(p);
  const dGoal = Math.hypot(CX - p.x, goalY - p.y);

  // Shoot -> pass -> dribble priority.
  if (dGoal < SHOOT_RANGE && passSafe(state, p.x, p.y, CX, goalY, p.team, SHOT_EVAL_SPEED, true)) {
    kickToward(state, p, CX, goalY, SHOT_EVAL_SPEED, 70); // shot with a little loft
    return;
  }

  const pass = bestPass(state, p);
  // Pass when threatened, or when a safe ball gains real ground.
  if (pass && (threatened(state, p) || pass.advance > 45)) {
    const fs = p.attacksTop ? -1 : 1;
    kickToward(state, p, pass.mate.x, pass.mate.y + fs * 8, PASS_EVAL_SPEED); // lead the run
    return;
  }

  // Dribble toward goal, veering around a defender that's closing in.
  const { opp, d } = nearestOpponent(state, p);
  let tx = CX;
  const ty = goalY;
  if (opp && d < DRIBBLE_AVOID) {
    const side = p.x <= opp.x ? -1 : 1; // step to the side away from the defender
    tx = clamp(p.x + side * 30, FIELD_L + 8, FIELD_R - 8);
  }
  moveToward(p, tx, ty, dt, AI_SPEED);
}

// Back up the presser: sit a short way behind the ball toward our own goal so a
// beaten press still has a second line.
function coverAi(state: GameState, p: Player, dt: number): void {
  const b = state.ball;
  const gy = ownGoalY(p);
  const dx = CX - b.x;
  const dy = gy - b.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = clamp(b.x + (dx / len) * COVER_GAP, FIELD_L + 4, FIELD_R - 4);
  const ty = clamp(b.y + (dy / len) * COVER_GAP, FIELD_T + 6, FIELD_B - 6);
  moveToward(p, tx, ty, dt, AI_SPEED);
}

// Mark a man: stand goal-side of him, nudged a little central toward our goal.
function markAi(state: GameState, p: Player, dt: number): void {
  const o = p.markTarget;
  if (!o) {
    holdAi(state, p, dt);
    return;
  }
  const gy = ownGoalY(p);
  const sign = gy < o.y ? -1 : 1; // toward our own goal in y
  const tx = clamp(o.x * 0.8 + CX * 0.2, FIELD_L + 4, FIELD_R - 4);
  const ty = clamp(o.y + sign * MARK_GAP, FIELD_T + 6, FIELD_B - 6);
  moveToward(p, tx, ty, dt, AI_SPEED);
}

// Off-ball attacking run: move to the best support spot picked for this player
// by assignSupportTargets (the SupportSpotCalculator) — open, in pass range,
// and a threat — so the carrier always has somewhere to play the ball.
function supportAi(p: Player, dt: number): void {
  moveToward(p, p.supportX, p.supportY, dt, AI_SPEED);
}

// Hold a compact formation point that tracks the ball, keeping relative spacing.
// Drops a touch goal-side while defending so the block stays behind the ball.
function holdAi(state: GameState, p: Player, dt: number): void {
  const b = state.ball;
  // Role-weighted fraction of the way from THIS player's home toward the ball —
  // keeps the formation's shape while the team tracks play as a unit.
  const w = p.role === 'fwd' ? 0.5 : p.role === 'mid' ? 0.35 : 0.2;
  const tx = clamp(p.homeX + (b.x - p.homeX) * w * 0.8, FIELD_L + 4, FIELD_R - 4);
  let ty = p.homeY + (b.y - p.homeY) * w;
  const defending = state.carrier != null && state.carrier.team !== p.team;
  if (defending) {
    const gy = ownGoalY(p);
    ty += (gy < ty ? -1 : 1) * HOLD_DROP;
  }
  ty = clamp(ty, FIELD_T + 6, FIELD_B - 6);
  moveToward(p, tx, ty, dt, AI_SPEED * 0.92);
}

function gkAi(state: GameState, p: Player, dt: number): void {
  const b = state.ball;
  // Cleared the ball if it ended up at the keeper's feet.
  if (state.carrier === p) {
    kickToward(state, p, CX + (b.x < CX ? 40 : -40), MID_Y, 300, 90);
    return;
  }
  const lineY = ownGoalY(p) + (p.attacksTop ? -7 : 7);
  const tx = clamp(b.x, CX - GOAL_W / 2 + 4, CX + GOAL_W / 2 - 4);
  // Edge off the line toward the ball when it's close and central.
  const ballClose = Math.abs(b.y - lineY) < 80 && Math.abs(b.x - CX) < GOAL_W;
  const ty = ballClose ? lineY + (p.attacksTop ? -10 : 10) : lineY;
  moveToward(p, tx, ty, dt, AI_SPEED, 1);
}
