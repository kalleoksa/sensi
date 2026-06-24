// Match rules for the v1 slice: goals + scoring + kickoff, and ball out of
// bounds with a real restart: the taker walks to the spot during a brief dead
// pause, then DELIVERS the ball — a throw-in tossed infield from the line, a
// goal kick launched by the keeper, a corner crossed toward the box.
//
// Team 0 attacks the TOP goal (decreasing y); team 1 attacks the BOTTOM.

import type { Ball, GameState, Player } from './state';
import { kickToward } from './player';
import { emitSfx } from './audio';
import { homeForSlot } from './team';
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
const KICKOFF_READY = 1.0; // ready freeze before a kickoff is released to play
const HALFTIME_PAUSE = 2.5; // HALF TIME overlay before the second-half kickoff
const HALF_LENGTH = 90; // seconds per half (SWOS-style 3-minute default match)

type RestartKind = 'throw' | 'goalkick' | 'corner' | 'freekick';

interface Restart {
  kind: RestartKind;
  taker: Player;
}

export interface Match {
  score: [number, number]; // [team0, team1]
  // kickoff = ready freeze; dead = goal celebration / out-of-bounds restart;
  // halftime / fulltime = end-of-half freezes (fulltime is terminal).
  phase: 'kickoff' | 'play' | 'dead' | 'halftime' | 'fulltime';
  deadTimer: number; // generic phase countdown (kickoff / dead / halftime)
  deadReset: boolean; // true => return to kickoff when the dead timer ends
  restart: Restart | null; // pending delivery executed when the pause ends
  flash: number; // seconds remaining on the GOAL flash (HUD)
  half: 1 | 2;
  clock: number; // seconds remaining in the current half (counts down)
  halfLength: number;
  kickoffTeam: 0 | 1; // who takes the pending / active kickoff
  firstKickoffTeam: 0 | 1; // half-1 kicker; the other team kicks off half 2
  // While set, the ball has crossed a line and is rolling out in the run-off;
  // the whistle + restart are held off until outTimer elapses (see updateMatch).
  outBall: { kind: RestartKind; team: 0 | 1; x: number; y: number } | null;
  outTimer: number;
}

const RESTART_DEAD = 0.8; // brief pause to set up a throw-in / goal kick / corner
const OUT_DELAY = 0.5; // let the ball roll out past the line before the whistle

export function makeMatch(): Match {
  return {
    score: [0, 0],
    phase: 'kickoff',
    deadTimer: 0,
    deadReset: false,
    restart: null,
    flash: 0,
    half: 1,
    clock: HALF_LENGTH,
    halfLength: HALF_LENGTH,
    kickoffTeam: 1, // team 1 ("away") kicks off the first half
    firstKickoffTeam: 1,
    outBall: null,
    outTimer: 0,
  };
}

// Whether a team attacks the TOP goal in a given half. Half 1: team 0 -> top,
// team 1 -> bottom. Teams swap ends for half 2.
function attacksTop(team: 0 | 1, half: 1 | 2): boolean {
  return (team === 0) === (half === 1);
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

// Line everyone up for a kickoff and freeze play for a short ready beat. The
// kicking team's central forward stands on the centre spot; the taker is then
// free to dribble/pass immediately once play resumes (SWOS has no second-touch
// rule). Used at the start of each half and after every goal.
export function beginKickoff(state: GameState, match: Match, kickoffTeam: 0 | 1): void {
  resetKickoff(state);
  // Pick the kicking team's outfielder nearest the centre spot (their centre
  // forward) and stand them on the ball.
  let taker: Player | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team !== kickoffTeam || p.role === 'gk') continue;
    const d = Math.hypot(p.x - state.ball.x, p.y - state.ball.y);
    if (d < bestD) {
      bestD = d;
      taker = p;
    }
  }
  if (taker) {
    // Just behind the ball, on their own side of the halfway line.
    taker.x = state.ball.x;
    taker.y = state.ball.y + (taker.attacksTop ? 5 : -5);
    taker.prevX = taker.x;
    taker.prevY = taker.y;
  }
  match.kickoffTeam = kickoffTeam;
  match.phase = 'kickoff';
  match.deadTimer = KICKOFF_READY;
  match.deadReset = false;
  match.outBall = null;
  match.outTimer = 0;
}

// Configure a half: set each player's attacking direction and formation home for
// this half (teams swap ends in half 2), reset the clock, then start the kickoff.
export function setupHalf(state: GameState, match: Match, half: 1 | 2, kickoffTeam: 0 | 1): void {
  match.half = half;
  match.clock = match.halfLength;
  for (const p of state.players) {
    p.attacksTop = attacksTop(p.team, half);
    const home = homeForSlot(p.slotX, p.slotY, p.attacksTop);
    p.homeX = home.x;
    p.homeY = home.y;
  }
  beginKickoff(state, match, kickoffTeam);
}

// Kick off a fresh match: 0-0, first half, team 1 takes the first kickoff.
export function startMatch(state: GameState, match: Match): void {
  match.score[0] = 0;
  match.score[1] = 0;
  match.flash = 0;
  match.restart = null;
  match.firstKickoffTeam = 1;
  setupHalf(state, match, 1, match.firstKickoffTeam);
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
      if (p.team !== team || p.role === 'gk' || p.state === 'fallen') continue;
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
  } else if (r.kind === 'corner') {
    // Corner: cross toward the penalty spot of that end.
    const spotY = b.y < (FIELD_T + FIELD_B) / 2 ? FIELD_T + PEN_SPOT_D : FIELD_B - PEN_SPOT_D;
    kickToward(state, t, CX, spotY, 250, 105);
  } else {
    // Free kick: play it forward to the best teammate, else upfield toward the
    // opponent goal the taker attacks.
    const fwd = t.team === 0 ? FIELD_T + 100 : FIELD_B - 100;
    const tx = target ? target.x : CX;
    const ty = target ? target.y : fwd;
    kickToward(state, t, tx, ty, 235, 70);
  }
}

function scoreGoal(_state: GameState, match: Match, scoringTeam: 0 | 1): void {
  match.score[scoringTeam]++;
  match.phase = 'dead';
  match.deadTimer = DEAD_TIME;
  match.deadReset = true;
  match.flash = DEAD_TIME;
  match.kickoffTeam = (1 - scoringTeam) as 0 | 1; // conceding team kicks off
  emitSfx('goal');
  // Don't reset yet — let the ball roll on into the net during the celebration.
  // resetKickoff happens when the dead timer elapses (see updateMatch).
}

// Mark the ball out of play at a fixed restart spot, but let it keep rolling in
// the run-off for OUT_DELAY before the whistle. controlLock keeps it a dead ball
// (no player can dribble it back) while it rolls out.
function beginOut(match: Match, b: Ball, kind: RestartKind, team: 0 | 1, x: number, y: number): void {
  match.outBall = { kind, team, x, y };
  match.outTimer = OUT_DELAY;
  b.controlLock = OUT_DELAY + 0.1;
}

export function updateMatch(state: GameState, match: Match, dt: number): void {
  if (match.flash > 0) match.flash = Math.max(0, match.flash - dt);

  // Ready freeze before a kickoff: hold, then release control to play.
  if (match.phase === 'kickoff') {
    match.deadTimer -= dt;
    if (match.deadTimer <= 0) match.phase = 'play';
    return;
  }

  // Half-time freeze: show the overlay, then swap ends and kick off the 2nd half.
  if (match.phase === 'halftime') {
    match.deadTimer -= dt;
    if (match.deadTimer <= 0) {
      setupHalf(state, match, 2, (1 - match.firstKickoffTeam) as 0 | 1);
    }
    return;
  }

  if (match.phase === 'fulltime') return; // match over; R restarts (see main.ts)

  if (match.phase === 'dead') {
    match.deadTimer -= dt;
    if (match.deadTimer <= 0) {
      if (match.deadReset) {
        // After a goal: conceding team kicks off (its own ready freeze).
        beginKickoff(state, match, match.kickoffTeam);
      } else {
        deliverRestart(state, match); // throw it in / kick it out to play
        match.phase = 'play';
      }
    }
    return;
  }

  // --- phase === 'play': run the clock; end the half / match at zero ---
  match.clock -= dt;
  if (match.clock <= 0) {
    match.clock = 0;
    if (match.half === 1) {
      match.phase = 'halftime';
      match.deadTimer = HALFTIME_PAUSE;
    } else {
      match.phase = 'fulltime';
      emitSfx('whistleGoal'); // long full-time whistle (three blasts)
    }
    return;
  }

  const b = state.ball;

  // Referee: a mistimed slide flagged a foul. Whistle and award a free kick to
  // the fouled team at the foul spot (clamped inside the field).
  if (state.foul) {
    const f = state.foul;
    state.foul = null;
    const fx = Math.min(FIELD_R - 4, Math.max(FIELD_L + 4, f.x));
    const fy = Math.min(FIELD_B - 4, Math.max(FIELD_T + 4, f.y));
    placeRestart(state, match, fx, fy, f.team, 'freekick');
    return;
  }

  // Ball already over a line and rolling out in the run-off: hold the whistle
  // until it settles, then set up the throw-in / goal kick / corner where it
  // crossed. (The ball keeps moving via stepBall; we just wait it out.)
  if (match.outBall) {
    match.outTimer -= dt;
    if (match.outTimer <= 0) {
      const o = match.outBall;
      match.outBall = null;
      placeRestart(state, match, o.x, o.y, o.team, o.kind);
    }
    return;
  }

  const inGoalMouth = Math.abs(b.x - CX) < GOAL_W / 2;
  const inset = 3; // place restarts this far inside the line

  // Which team attacks each goal this half (teams swap ends in half 2).
  const topTeam: 0 | 1 = match.half === 1 ? 0 : 1;
  const bottomTeam: 0 | 1 = (1 - topTeam) as 0 | 1;

  // --- Goal lines (top / bottom) ---
  if (b.y < FIELD_T || b.y > FIELD_B) {
    const top = b.y < FIELD_T;
    if (inGoalMouth && b.z < GOAL_HEIGHT) {
      // The team attacking this goal scores.
      scoreGoal(state, match, top ? topTeam : bottomTeam);
      return;
    }
    // Out over the goal line, no goal: goal kick or corner by last touch. Fix
    // the restart spot at the crossing point, then let the ball roll out.
    const lineY = top ? FIELD_T : FIELD_B;
    const dir = top ? 1 : -1; // into-field direction
    const attackingTeam: 0 | 1 = top ? topTeam : bottomTeam; // who attacks this line
    const defendingTeam: 0 | 1 = (1 - attackingTeam) as 0 | 1;
    if (lastTouchTeam(state) === attackingTeam) {
      // Goal kick for the defenders: ball at the six-yard box.
      beginOut(match, b, 'goalkick', defendingTeam, CX, lineY + dir * SIX_BOX_D);
    } else {
      // Corner for the attackers: nearest corner on the side the ball exited.
      const cornerX = b.x < CX ? FIELD_L + inset : FIELD_R - inset;
      beginOut(match, b, 'corner', attackingTeam, cornerX, lineY + dir * CORNER_R);
    }
    return;
  }

  // --- Touchlines (left / right): throw-in to the team that didn't touch it ---
  if (b.x < FIELD_L || b.x > FIELD_R) {
    const x = b.x < FIELD_L ? FIELD_L : FIELD_R; // ball ON the line for the throw
    const y = Math.max(FIELD_T + inset, Math.min(FIELD_B - inset, b.y));
    const throwTeam: 0 | 1 = lastTouchTeam(state) === 0 ? 1 : 0;
    beginOut(match, b, 'throw', throwTeam, x, y);
    return;
  }
}
