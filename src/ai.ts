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

import { Dir, type GameState, type Player } from './state';
import { moveToward, kickToward, integrate, startSlideToward, PLAYER_SPEED } from './player';
import { GROUND_FRICTION } from './ball';
import { FIELD_T, FIELD_B, FIELD_L, FIELD_R, PLAY_W, CX, GOAL_W } from './world';

const AI_SPEED = PLAYER_SPEED * 0.94; // a touch slower than the human
const SHOOT_RANGE = 130;
const FORWARD_PROGRESS_MIN = 25; // a safe forward pass gaining this much is worth taking
const RELEASE_DIST = 16; // defender this close => about to tackle, release the ball now
const BAIL_MAX_BACK = 25; // a release pass may not go more than this far backwards
const DRIBBLE_AVOID = 40; // defender within this => carrier veers around them
const MAX_SUPPORT = 3; // off-ball attackers making forward runs at once

// Pass / shot evaluation speeds (must match the speeds the AI actually kicks at,
// so the interception test predicts real ball travel — see carrierAi/kickToward).
const PASS_EVAL_SPEED = 215;
const SHOT_EVAL_SPEED = 360;
const MIN_PASS_DIST = 24; // shorter than this isn't worth a pass
const PASS_LEAD_TIME = 0.35; // seconds of the receiver's run to lead a pass into
const INTERCEPT_PAD = 8; // player+ball radii: opponent this close to the lane intercepts

// SupportSpotCalculator (Buckland "Simple Soccer"): a grid of candidate spots,
// each scored on how OPEN it is (distance to the nearest defender — this is what
// "finding free space" means), plus a safe pass lane to it, shooting potential,
// an optimal distance from the carrier, and advancement. The best spots become
// the supporters' off-ball runs. The grid is anchored to the ball's depth (not
// the halfway line) so a supporter can always show for a nearby outlet — even
// when we win the ball deep — as well as run in behind.
const SUPPORT_COLS = 5;
const SUPPORT_ROWS = 6;
const SUPPORT_OPEN_W = 2; // reward genuinely unmarked space (the core signal)
const SUPPORT_OPEN_REF = 55; // px to the nearest defender that counts as "open"
const SUPPORT_PASS_SAFE_W = 2;
const SUPPORT_CAN_SHOOT_W = 1;
const SUPPORT_DIST_W = 2;
const SUPPORT_ADVANCE_W = 1; // prefer spots ahead of the ball
const SUPPORT_OPTIMAL_DIST = 70; // px from the carrier a supporter wants to be
const SUPPORT_BEHIND = 34; // grid reaches this far behind the carrier (a drop outlet)
const OFFSIDE_MARGIN = 8; // keep attacking runs this far onside of the last defender
const SUPPORT_MIN_SEP = 44; // keep supporters from piling on one spot
const SUPPORT_TRAVEL_W = 0.02; // mild bias: a supporter prefers nearer good spots

// AI slide tackles: the presser lunges in when the opponent carrier is in this
// distance band (closer than this, the proximity poke already wins it; farther,
// the lunge can't reach). A cooldown stops repeated dives. Whether the lunge
// reaches the ball (clean) or only the man (foul) is judged by resolveSlideTackles.
const SLIDE_REACH_MIN = 12;
const SLIDE_REACH_MAX = 22;
const SLIDE_COOLDOWN = 8.0; // seconds before this player may slide again
const SLIDE_MIN_CARRIER_SPEED = 40; // only lunge at a carrier on the move
const TEAM_SLIDE_CD = 20; // seconds between slide attempts by the same team
const SLIDE_LEAD = 0.18; // aim ahead of the carrier so the lunge meets the ball
const MARK_GAP = 12; // a marker sits this far goal-side of its man
const COVER_GAP = 22; // the cover player sits this far behind the ball toward own goal
const VERT_TRACK = 0.5; // uniform vertical tracking: how far each line moves home->ball depth
const MID_Y = (FIELD_T + FIELD_B) / 2;

// Defensive line. The defending block holds a line goal-side of the ball that is
// never collapsed onto the goal line and never higher than a cap — so the team
// stays compact without packing its own six-yard box, leaving beatable space in
// behind (for runs / through-balls) and between the lines. Depth is measured
// from a team's own goal line, into the pitch.
const LINE_GAP = 22; // the back line sits this far goal-side of the ball
const LINE_MIN = 34; // never drop closer than this to our goal (the keeper covers behind)
const LINE_MAX = 140; // step up no further than this when the ball is far away
const LINE_TIER = 40; // mids/fwds hold a line this far ahead of the back line

// Goalkeeper dive tuning. The keeper aims to arrive at the ball's crossing
// point exactly as the ball gets there (not a constant-speed lunge that
// overshoots), in a low, deliberate arc so it reads as a slowed dive.
const DIVE_SPEED = 150; // cap on lateral lunge speed along the goal line
const GK_GRAVITY = 360; // pulls the diving keeper back down (matches the ball)
const DIVE_LOOKAHEAD = 0.62; // only react to shots arriving within this many sec
const DIVE_REACH_MIN = 6; // smaller offsets are covered just by standing/tracking
const DIVE_REACH_MAX = 44; // beyond this the keeper can't get there — it's a goal
const DIVE_FLIGHT_MIN = 0.34; // min airborne time — keeps the dive deliberate, low
const DIVE_FLIGHT_MAX = 0.6; // cap so a far shot doesn't float forever

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

// Sign that converts a world y into "depth into our half" for p: +1 if our goal
// is at the top (depth grows with y), -1 if it's at the bottom.
function intoField(p: Player): number {
  return ownGoalY(p) === FIELD_T ? 1 : -1;
}

// The depth (from our own goal) a defending player should hold: goal-side of the
// ball by LINE_GAP, clamped between a floor (never on the goal line) and a cap
// (a high line when the ball is far). Mids/fwds hold a tier ahead of the backs,
// so the block is two spaced lines rather than one clump.
function defendDepthFloor(p: Player, ballY: number): number {
  const ballDepth = (ballY - ownGoalY(p)) * intoField(p);
  const line = clamp(ballDepth - LINE_GAP, LINE_MIN, LINE_MAX);
  return p.role === 'def' ? line : line + LINE_TIER;
}

// Raise a target y so the player is no DEEPER than `floorDepth` from our goal
// (they may stand further forward; they just won't sink behind the line).
function clampToLine(ty: number, p: Player, floorDepth: number): number {
  const goalLine = ownGoalY(p);
  const into = intoField(p);
  const depth = (ty - goalLine) * into;
  return depth < floorDepth ? goalLine + into * floorDepth : ty;
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
    if (p.sentOff) continue; // removed from play; no duty
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

  // Openness: how far the nearest defender is from this spot. A supporter wants
  // to receive in space, not next to a marker — this is the primary "find free
  // space" term (saturates once we're a clear pass-radius clear of any opponent).
  const open = nearestEnemyDist(state, x, y, carrier.team);
  score += SUPPORT_OPEN_W * Math.min(1, open / SUPPORT_OPEN_REF);

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

// The offside line for `team`: the world y of the SECOND-most-advanced opponent
// (the last outfield defender, since the keeper is usually deepest). Attacking
// runs shouldn't push beyond this toward the goal they attack — we don't enforce
// offside, but players should at least try to stay onside.
function offsideLineY(state: GameState, team: 0 | 1, attacksTop: boolean): number {
  const adv = (y: number) => (attacksTop ? -y : y); // larger = more advanced toward the goal
  let first = -Infinity;
  let second = -Infinity;
  let firstY = 0;
  let secondY = 0;
  for (const p of state.players) {
    if (p.team === team || p.sentOff) continue;
    const a = adv(p.y);
    if (a > first) {
      second = first;
      secondY = firstY;
      first = a;
      firstY = p.y;
    } else if (a > second) {
      second = a;
      secondY = p.y;
    }
  }
  return second === -Infinity ? firstY : secondY;
}

// Lay a grid of spots over the attacking half, score them, and assign each
// supporter the best free spot near it (claimed spots block their neighbours so
// supporters spread out rather than pile onto the single best spot).
function assignSupportTargets(state: GameState, carrier: Player): void {
  const supporters: Player[] = [];
  for (const p of state.players) if (p.team === carrier.team && p.duty === 'support') supporters.push(p);
  if (supporters.length === 0) return;

  const goalY = carrier.attacksTop ? FIELD_T : FIELD_B;
  const fs = carrier.attacksTop ? -1 : 1; // forward sign (toward the attacking goal)
  // Far edge: the offside line (last defender), pulled a touch onside — so runs
  // stay level with the defence instead of parking beyond it near the byline.
  // Never push past the byline itself. The carrier may already be ahead of the
  // line, so also allow the edge to reach a bit beyond the carrier.
  const byline = carrier.attacksTop ? FIELD_T + 24 : FIELD_B - 24;
  // No offside on a throw-in: attackers may position right up to the byline.
  // Otherwise hold the offside line (last defender), pulled a touch onside.
  let yFar: number;
  if (state.suppressOffside) {
    yFar = byline;
  } else {
    const offside = offsideLineY(state, carrier.team, carrier.attacksTop) - fs * OFFSIDE_MARGIN;
    const aheadOfCarrier = carrier.y + fs * 20;
    yFar = carrier.attacksTop
      ? Math.max(byline, Math.min(offside, aheadOfCarrier))
      : Math.min(byline, Math.max(offside, aheadOfCarrier));
  }
  // Near edge sits a little BEHIND the carrier so a supporter can drop in to
  // offer a short outlet. This tracks the ball up the pitch instead of being
  // pinned to the halfway line, so building from deep still produces nearby
  // options rather than only long bombs.
  const yNear = clamp(carrier.y - fs * SUPPORT_BEHIND, FIELD_T + 24, FIELD_B - 24);
  const spots: Spot[] = [];
  for (let c = 0; c < SUPPORT_COLS; c++) {
    const x = FIELD_L + 8 + ((c + 0.5) / SUPPORT_COLS) * (PLAY_W - 16);
    for (let r = 0; r < SUPPORT_ROWS; r++) {
      const y = yNear + (yFar - yNear) * ((r + 0.5) / SUPPORT_ROWS);
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

// One frame of airborne-keeper physics: lateral coast + gravity until it lands.
function stepDive(p: Player, dt: number): void {
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
}

// Advance player physics for one frame WITHOUT any AI/control decisions. Used
// during non-play phases (post-goal celebration, dead-ball restarts) so bodies
// keep moving naturally instead of freezing: a diving keeper falls and lands,
// slides/knock-downs play out, and any residual run velocity coasts to a stop.
export function coastPlayers(state: GameState, dt: number): void {
  for (const p of state.players) {
    if (p.stateTimer > 0) p.stateTimer = Math.max(0, p.stateTimer - dt);
    if (p.state === 'gkdive') {
      stepDive(p, dt);
      continue;
    }
    // Friction so any leftover run/slide momentum settles smoothly.
    p.vx *= Math.exp(-3 * dt);
    p.vy *= Math.exp(-3 * dt);
    if (Math.abs(p.vx) < 1) p.vx = 0;
    if (Math.abs(p.vy) < 1) p.vy = 0;
    // Let timed states (kick / slide / fallen) expire to idle as usual.
    if (p.stateTimer <= 0 && (p.state === 'kick' || p.state === 'slide' || p.state === 'fallen')) {
      p.state = 'idle';
    }
    if (p.vx === 0 && p.vy === 0 && p.state === 'run') p.state = 'idle';
    integrate(p, dt);
  }
}

// Shape the teams during a throw-in / free-kick setup, instead of leaving every
// player frozen where the ball went dead (all clustered "under the ball"). The
// taker is treated as the carrier so the duty system spreads the restart team
// into attacking positions (support runs up the pitch) and drops the other team
// into its defending shape. The taker holds the ball; no one tackles (the ball
// is dead — press/cover just sit off it). Ball-untouched: only players move.
export function positionForRestart(state: GameState, taker: Player, dt: number, noOffside = false): void {
  const prev = state.carrier;
  const prevSuppress = state.suppressOffside;
  state.carrier = taker; // so duties read as "taker's team in possession"
  state.suppressOffside = noOffside; // throw-ins have no offside
  computeDuties(state);
  for (const p of state.players) {
    if (p === taker || p.sentOff) continue;
    switch (p.duty) {
      case 'support':
        supportAi(p, dt);
        break;
      case 'mark':
        markAi(state, p, dt);
        break;
      case 'cover':
      case 'press': // don't lunge at a dead ball — just sit off it
        coverAi(state, p, dt);
        break;
      case 'gk':
        gkAi(state, p, dt);
        break;
      default: // 'hold' (and the taker's 'carrier' is excluded above)
        holdAi(state, p, dt);
        break;
    }
  }
  state.carrier = prev;
  state.suppressOffside = prevSuppress;
}

// Press the ball; if the opponent carrier is in slide range and this player is
// off cooldown, lunge into a tackle (clean if it reaches the ball, a foul if it
// only catches the man).
function pressAi(state: GameState, p: Player, dt: number): void {
  const b = state.ball;
  const c = state.carrier;
  if (c && c.team !== p.team && b.z < 6 && p.slideCooldown <= 0 && state.teamSlideCd[p.team] <= 0) {
    const dBall = Math.hypot(b.x - p.x, b.y - p.y);
    const carrierSpeed = Math.hypot(c.vx, c.vy);
    // Only lunge to intercept a carrier running ONTO us (the ball arrives at the
    // tackler => clean). Never slide from behind a carrier moving away — that
    // catches the man, not the ball, and is a foul.
    const closing = c.vx * (p.x - c.x) + c.vy * (p.y - c.y) > 0;
    // Slides are a defensive last resort: only in our own half.
    const ownGoal = ownGoalY(p);
    const inOwnHalf = ownGoal > MID_Y ? b.y > MID_Y : b.y < MID_Y;
    if (
      inOwnHalf &&
      closing &&
      dBall > SLIDE_REACH_MIN &&
      dBall < SLIDE_REACH_MAX &&
      carrierSpeed > SLIDE_MIN_CARRIER_SPEED
    ) {
      // Lunge at where the BALL will be, so the tackle meets the ball (clean)
      // far more often than the man (foul).
      startSlideToward(p, b.x + b.vx * SLIDE_LEAD, b.y + b.vy * SLIDE_LEAD);
      p.slideCooldown = SLIDE_COOLDOWN;
      state.teamSlideCd[p.team] = TEAM_SLIDE_CD;
      return;
    }
  }
  // Chase / press right onto the ball (arrive=1) so contact pokes it loose.
  moveToward(p, b.x, b.y, dt, AI_SPEED, 1);
}

export function updateTeamAi(state: GameState, dt: number): void {
  computeDuties(state);
  if (state.teamSlideCd[0] > 0) state.teamSlideCd[0] = Math.max(0, state.teamSlideCd[0] - dt);
  if (state.teamSlideCd[1] > 0) state.teamSlideCd[1] = Math.max(0, state.teamSlideCd[1] - dt);
  for (const p of state.players) {
    if (p.slideCooldown > 0) p.slideCooldown = Math.max(0, p.slideCooldown - dt);
    if (p.sentOff) continue; // removed from play
    if (p === state.controlled || p === state.controlled2) continue; // human-driven
    switch (p.duty) {
      case 'gk':
        gkAi(state, p, dt);
        break;
      case 'carrier':
        carrierAi(state, p, dt);
        break;
      case 'press':
        pressAi(state, p, dt);
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

// A possession-retaining "release" pass for when a tackle is imminent: the
// safest reachable teammate, preferring forward/open men and never bailing more
// than BAIL_MAX_BACK backwards (so retaining the ball still keeps play going
// forward rather than endlessly recycling toward our own goal).
function safestPass(state: GameState, p: Player): Player | null {
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const m of state.players) {
    if (m.team !== p.team || m === p || m.role === 'gk') continue;
    const advance = advanceOf(p, p.y, m.y);
    if (advance < -BAIL_MAX_BACK) continue; // don't recycle deep backwards
    const passDist = Math.hypot(m.x - p.x, m.y - p.y);
    if (passDist < MIN_PASS_DIST) continue;
    if (!isFinite(ballTravelTime(passDist, PASS_EVAL_SPEED))) continue;
    if (!passSafe(state, p.x, p.y, m.x, m.y, p.team, PASS_EVAL_SPEED)) continue;
    const open = nearestEnemyDist(state, m.x, m.y, p.team);
    const score = advance + open * 0.5; // weight advancement so the outlet goes forward
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

function carrierAi(state: GameState, p: Player, dt: number): void {
  const goalY = attackGoalY(p);
  const dGoal = Math.hypot(CX - p.x, goalY - p.y);
  const fs = p.attacksTop ? -1 : 1;

  // 1) Shoot if in range with a clear lane (beating the keeper).
  if (dGoal < SHOOT_RANGE && passSafe(state, p.x, p.y, CX, goalY, p.team, SHOT_EVAL_SPEED, true)) {
    kickToward(state, p, CX, goalY, SHOT_EVAL_SPEED, 70);
    return;
  }

  // 1b) Tight to goal with no clear lane: shoot anyway — a blocked/saved shot
  //     beats dribbling the ball over the byline.
  if (dGoal < SHOOT_RANGE * 0.55) {
    kickToward(state, p, CX, goalY, SHOT_EVAL_SPEED, 40);
    return;
  }

  // 2) Take a safe forward pass that makes real ground (commit forward). Lead it
  //    into the space ahead of the receiver's run — a ball into space, not to
  //    feet — so he collects it on the move behind the defence.
  const fwd = bestPass(state, p);
  if (fwd && fwd.advance > FORWARD_PROGRESS_MIN) {
    const m = fwd.mate;
    const lx = clamp(m.x + m.vx * PASS_LEAD_TIME, FIELD_L + 6, FIELD_R - 6);
    const ly = clamp(m.y + m.vy * PASS_LEAD_TIME + fs * 8, FIELD_T + 6, FIELD_B - 6);
    kickToward(state, p, lx, ly, PASS_EVAL_SPEED);
    return;
  }

  // 3) About to be tackled (from ANY side — a chaser from behind is the usual
  //    way an equal-speed dribbler is dispossessed): release to the best outlet.
  const { opp, d } = nearestOpponent(state, p);
  if (d < RELEASE_DIST) {
    const bail = safestPass(state, p) ?? fwd?.mate ?? null;
    if (bail) {
      kickToward(state, p, bail.x, bail.y, PASS_EVAL_SPEED);
      return;
    }
  }

  // 4) Otherwise dribble at goal, veering around a defender that's closing in.
  //    Aim short of the goal line (and centrally) so we never run the ball out.
  let tx = CX;
  const ty = goalY - fs * 16;
  if (opp && d < DRIBBLE_AVOID) {
    // Step around the defender — but when we're already wide, cut back toward
    // the centre so we don't dribble into the corner and get pinned on the line.
    const wide = Math.abs(p.x - CX) > PLAY_W * 0.28;
    const side = wide ? Math.sign(CX - p.x) || -1 : p.x <= opp.x ? -1 : 1;
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
  let ty = clamp(o.y + sign * MARK_GAP, FIELD_T + 6, FIELD_B - 6);
  // Hold the defensive line: track the man, but don't follow a runner deeper than
  // the line — leave the ball in behind to the keeper instead of being dragged
  // onto our own goal line, so the box isn't packed and there's space to attack.
  ty = clampToLine(ty, p, defendDepthFloor(p, state.ball.y));
  moveToward(p, tx, ty, dt, AI_SPEED);
}

// Off-ball attacking run: move to the best support spot picked for this player
// by assignSupportTargets (the SupportSpotCalculator) — open, in pass range,
// and a threat — so the carrier always has somewhere to play the ball.
function supportAi(p: Player, dt: number): void {
  moveToward(p, p.supportX, p.supportY, dt, AI_SPEED);
}

// Hold a compact formation point that tracks the ball, keeping relative spacing.
// The block slides up/down the pitch AS A UNIT — every holder gets the SAME
// vertical shift toward the ball's depth — so the lines stay close together and
// midfield never empties out. (The old per-role fractional tracking let forwards
// chase up while defenders lagged, stretching a hole between the lines.)
function holdAi(state: GameState, p: Player, dt: number): void {
  const b = state.ball;
  // Vertical: every line tracks the ball's depth by the SAME fraction, so the
  // back four steps up with the play instead of lagging (the old per-role weight
  // gave defenders only 0.2, leaving a hole between defence and attack).
  let ty = p.homeY + (b.y - p.homeY) * VERT_TRACK;
  // Horizontal shift toward the ball's side keeps a per-role fraction so the
  // block leans toward play without collapsing onto the ball.
  const w = p.role === 'fwd' ? 0.5 : p.role === 'mid' ? 0.35 : 0.2;
  const tx = clamp(p.homeX + (b.x - p.homeX) * w * 0.8, FIELD_L + 4, FIELD_R - 4);
  const defending = state.carrier != null && state.carrier.team !== p.team;
  if (defending) {
    // Hold the defensive line rather than collapsing onto our goal: keep the
    // block compact but high enough to leave space in behind and between lines.
    ty = clampToLine(ty, p, defendDepthFloor(p, b.y));
  }
  ty = clamp(ty, FIELD_T + 6, FIELD_B - 6);
  moveToward(p, tx, ty, dt, AI_SPEED * 0.92);
}

function gkAi(state: GameState, p: Player, dt: number): void {
  const b = state.ball;

  // Mid-dive: the keeper is airborne and committed — coast laterally under
  // gravity until it lands. resolvePossession turns a body that reaches the low
  // ball into a catch on its own.
  if (p.state === 'gkdive') {
    stepDive(p, dt);
    return;
  }

  // Cleared the ball if it ended up at the keeper's feet (caught a dive too).
  if (state.carrier === p) {
    p.z = 0;
    kickToward(state, p, CX + (b.x < CX ? 40 : -40), MID_Y, 300, 90);
    return;
  }
  const lineY = ownGoalY(p) + (p.attacksTop ? -7 : 7);

  // Dive at a low shot heading goalward that will cross the line offset from the
  // keeper — too far to cover by tracking, but within a dive's reach.
  const towardGoal = p.attacksTop ? b.vy > 60 : b.vy < -60;
  if (towardGoal && b.z < 12) {
    const t = (lineY - b.y) / b.vy; // time until the ball reaches the line
    if (t > 0 && t < DIVE_LOOKAHEAD) {
      const predX = b.x + b.vx * t;
      const onTarget = Math.abs(predX - CX) < GOAL_W / 2 + 6;
      const offset = predX - p.x;
      if (onTarget && Math.abs(offset) > DIVE_REACH_MIN && Math.abs(offset) < DIVE_REACH_MAX) {
        const flight = clamp(t, DIVE_FLIGHT_MIN, DIVE_FLIGHT_MAX);
        p.state = 'gkdive';
        p.dir = offset > 0 ? Dir.R : Dir.L;
        // Reach the crossing point exactly as the ball arrives (capped), in a
        // low arc that lands ~flight later — so the keeper meets the low ball
        // instead of sailing past it.
        p.vx = clamp(offset / t, -DIVE_SPEED, DIVE_SPEED);
        p.vy = 0;
        p.vz = (GK_GRAVITY * flight) / 2;
        return;
      }
    }
  }

  const tx = clamp(b.x, CX - GOAL_W / 2 + 4, CX + GOAL_W / 2 - 4);
  // Edge off the line toward the ball when it's close and central.
  const ballClose = Math.abs(b.y - lineY) < 80 && Math.abs(b.x - CX) < GOAL_W;
  const ty = ballClose ? lineY + (p.attacksTop ? -10 : 10) : lineY;
  moveToward(p, tx, ty, dt, AI_SPEED, 1);
}
