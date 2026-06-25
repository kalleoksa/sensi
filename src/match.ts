// Match rules for the v1 slice: goals + scoring + kickoff, and ball out of
// bounds with a real restart: the taker walks to the spot during a brief dead
// pause, then DELIVERS the ball — a throw-in tossed infield from the line, a
// goal kick launched by the keeper, a corner crossed toward the box.
//
// Team 0 attacks the TOP goal (decreasing y); team 1 attacks the BOTTOM.

import { dirFromVec, type Ball, type GameState, type Player } from './state';
import { kickToward } from './player';
import { brandishCard } from './referee';
import { emitSfx } from './audio';
import { homeForSlot } from './team';
import {
  FIELD_T,
  FIELD_B,
  FIELD_L,
  FIELD_R,
  CX,
  GOAL_W,
  GOAL_HEIGHT,
  SIX_BOX_D,
  PEN_SPOT_D,
  PEN_BOX_D,
  PEN_BOX_W,
  CORNER_R,
} from './world';

const DEAD_TIME = 1.7; // celebration: ball rolls into the net, then kickoff
const RESTART_LOCK = 99; // ball is dead until the taker delivers it
const KICKOFF_READY = 1.0; // ready freeze before a kickoff is released to play
const HALFTIME_PAUSE = 2.5; // HALF TIME overlay before the second-half kickoff
const HALF_LENGTH = 90; // seconds per half (SWOS-style 3-minute default match)

type RestartKind = 'throw' | 'goalkick' | 'corner' | 'freekick' | 'penalty';

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
  // Brief HUD card flash after a booking / sending-off.
  cardFlash: number;
  cardColor: 'yellow' | 'red' | null;
  // Which teams a human controls (set by the session from the control mode). A
  // human team's throw-in / free kick is aimed and released by the player rather
  // than auto-delivered.
  humanTeams: [boolean, boolean];
  // While set, a human is lining up a restart (throw-in or free kick): the taker
  // stands on the ball and the player aims (dx,dy) then presses action to
  // release. `t` counts idle time toward an auto-release fallback so the game
  // can't soft-lock.
  awaitRestart: { taker: Player; team: 0 | 1; kind: 'throw' | 'freekick'; dx: number; dy: number; t: number } | null;
}

const RESTART_DEAD = 0.8; // brief pause to set up a throw-in / goal kick / corner
const OUT_DELAY = 0.5; // let the ball roll out past the line before the whistle

// Manual restart (human team): the player aims with the stick and presses action
// to release. AIM_TIMEOUT auto-releases if they never do, so an idle game can't
// stall. A throw is a soft lob a short way infield; a free kick is a driven ball
// (a pass to a teammate or a strike at goal).
const AIM_TIMEOUT = 8; // seconds of no input before the restart auto-releases
const THROW_POWER = 175;
const THROW_LOB = 90;
const FK_POWER = 250; // driven free kick — strong enough to shoot or ping a pass
const FK_LOB = 60;
const RESTART_DIST = 60; // how far ahead of the taker the aim point sits

function clampf(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

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
    cardFlash: 0,
    cardColor: null,
    humanTeams: [false, false],
    awaitRestart: null,
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
    if (p.sentOff) continue; // stays off the pitch, a man down
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
    if (p.team !== kickoffTeam || p.role === 'gk' || p.sentOff) continue;
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
      if (p.team !== team || p.role === 'gk' || p.state === 'fallen' || p.sentOff) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        taker = p;
      }
    }
  }
  // If a team has been reduced to its keeper (e.g. multiple sendings-off), the
  // keeper takes the restart rather than leaving the ball frozen.
  if (!taker) {
    taker = state.players.find((p) => p.team === team && p.role === 'gk' && !p.sentOff) ?? null;
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

  // A corner is a set piece: push the attackers into the box and drop the
  // defenders in to mark, so the cross has targets at both ends.
  if (kind === 'corner') positionForCorner(state, team, y, taker);

  match.phase = 'dead';
  match.deadTimer = RESTART_DEAD;
  match.deadReset = false;
  match.restart = { kind, taker };
  emitSfx('whistleOut');
}

// Lay players out for a corner: the attacking outfielders fill the box, the
// defenders mark goal-side of them, and the defending keeper sits on his line.
function positionForCorner(state: GameState, attackTeam: 0 | 1, cornerY: number, taker: Player): void {
  const top = cornerY < (FIELD_T + FIELD_B) / 2;
  const goalLine = top ? FIELD_T : FIELD_B;
  const into = top ? 1 : -1; // from the goal line into the field
  const place = (p: Player, px: number, py: number): void => {
    p.x = Math.max(FIELD_L + 4, Math.min(FIELD_R - 4, px));
    p.y = py;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vx = p.vy = 0;
    p.state = 'idle';
  };
  // Box targets: [x offset from centre, depth from the goal line].
  const spots: Array<[number, number]> = [
    [-52, 16], [52, 20], [-18, 30], [20, 38], [0, 50], [-78, 40], [78, 40],
  ];
  const edge: Array<[number, number]> = [[-30, 70], [34, 72]];
  const attackers = state.players.filter(
    (p) => p.team === attackTeam && p.role !== 'gk' && p !== taker && !p.sentOff,
  );
  attackers.forEach((p, i) => {
    const s = i < spots.length ? spots[i] : edge[(i - spots.length) % edge.length];
    place(p, CX + s[0], goalLine + into * s[1]);
  });
  const defenders = state.players.filter(
    (p) => p.team !== attackTeam && p.role !== 'gk' && !p.sentOff,
  );
  defenders.forEach((p, i) => {
    const s = spots[i % spots.length];
    place(p, CX + s[0] * 0.8, goalLine + into * Math.max(6, s[1] * 0.6));
  });
  const gk = state.players.find((p) => p.team !== attackTeam && p.role === 'gk' && !p.sentOff);
  if (gk) place(gk, CX, goalLine + into * 8);
}

// Whether (x,y) is inside the penalty box in front of the goal `attacksTop`
// attacks (i.e. the box the defending team would concede a penalty in).
function inPenaltyBox(x: number, y: number, attackTop: boolean): boolean {
  const goalLine = attackTop ? FIELD_T : FIELD_B;
  return Math.abs(x - CX) < PEN_BOX_W / 2 && Math.abs(y - goalLine) < PEN_BOX_D;
}

// Set up a penalty: ball on the spot, the taker behind it, the defending keeper
// on his line, and everyone else cleared out of the box. The kick is taken when
// the dead pause ends (deliverRestart).
function placePenalty(state: GameState, match: Match, team: 0 | 1): void {
  const attackTop = attacksTop(team, match.half);
  const goalLine = attackTop ? FIELD_T : FIELD_B;
  const into = attackTop ? 1 : -1; // direction from the goal line into the field
  const spotY = goalLine + into * PEN_SPOT_D;

  const b = state.ball;
  b.x = CX;
  b.y = spotY;
  b.z = 0;
  b.prevX = b.x;
  b.prevY = b.y;
  b.prevZ = 0;
  b.vx = b.vy = b.vz = b.spin = 0;
  b.aftertouch = 0;
  b.controlLock = RESTART_LOCK;
  b.owner = null;
  state.carrier = null;

  // Taker: nearest outfielder of the awarded team, stood just behind the ball.
  let taker: Player | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team !== team || p.role === 'gk' || p.state === 'fallen' || p.sentOff) continue;
    const d = Math.hypot(p.x - CX, p.y - spotY);
    if (d < bestD) {
      bestD = d;
      taker = p;
    }
  }
  if (!taker) {
    taker = state.players.find((p) => p.team === team && p.role === 'gk' && !p.sentOff) ?? null;
  }
  if (!taker) return;
  taker.x = CX;
  taker.y = spotY + into * 6; // a step behind the ball
  taker.prevX = taker.x;
  taker.prevY = taker.y;
  taker.vx = taker.vy = 0;
  taker.state = 'idle';

  // Everyone else (bar the two keepers) waits outside the box, behind the spot.
  for (const p of state.players) {
    if (p === taker || p.role === 'gk' || p.sentOff) continue;
    if (inPenaltyBox(p.x, p.y, attackTop)) {
      p.y = goalLine + into * (PEN_BOX_D + 10);
      p.prevY = p.y;
      p.vx = p.vy = 0;
      if (p.state !== 'fallen') p.state = 'idle';
    }
  }

  match.phase = 'dead';
  match.deadTimer = RESTART_DEAD;
  match.deadReset = false;
  match.restart = { kind: 'penalty', taker };
  emitSfx('whistleOut');
}

const CARD_FLASH = 1.4; // seconds the card shows on the HUD

// Judge a card on the offending player. A foul is bookable if it concedes a
// penalty or is a cynical foul (stopped the carrier) in the offender's
// defensive third. A second booking is a red — the player is sent off and
// walks to the touchline, out of play.
function judgeCard(
  match: Match,
  foul: { offender: Player; deniedAttack: boolean; y: number },
  isPenalty: boolean,
): 'yellow' | 'red' | null {
  const off = foul.offender;
  const ownGoal = attacksTop(off.team, match.half) ? FIELD_B : FIELD_T;
  // A foul in a dangerous area is a booking: a conceded penalty, or a foul in
  // the offender's own half (a cynical stop while defending).
  const ownHalf = Math.abs(foul.y - ownGoal) < (FIELD_B - FIELD_T) / 2;
  const bookable = isPenalty || ownHalf;
  if (!bookable) return null;

  if (off.yellow) {
    off.sentOff = true; // second yellow => red
    match.cardColor = 'red';
    off.x = FIELD_L - 16; // trudge off to the touchline, out of play
    off.y = (FIELD_T + FIELD_B) / 2;
    off.prevX = off.x;
    off.prevY = off.y;
    off.vx = off.vy = 0;
    off.state = 'idle';
  } else {
    off.yellow = true;
    match.cardColor = 'yellow';
  }
  match.cardFlash = CARD_FLASH;
  return match.cardColor;
}

// Point a pending manual restart. Called from the session each frame with the
// taker's held direction; a non-zero stick sets the aim and resets the idle
// timer so the auto-release fallback only fires after sustained inactivity.
export function aimRestart(match: Match, dx: number, dy: number): void {
  const a = match.awaitRestart;
  if (!a) return;
  if (dx !== 0 || dy !== 0) {
    a.dx = dx;
    a.dy = dy;
    a.t = 0;
  }
}

// Release a pending manual restart along its current aim. A throw-in is a soft
// lob whose aim is forced infield (so it can't be thrown straight back out); a
// free kick is a driven ball in any direction the taker faces.
export function deliverRestartAimed(state: GameState, match: Match): void {
  const a = match.awaitRestart;
  if (!a) return;
  const t = a.taker;
  const isThrow = a.kind === 'throw';
  let nx = a.dx;
  let ny = a.dy;
  let len = Math.hypot(nx, ny);
  if (len < 0.1) {
    // No aim held: throw straight infield, free kick straight up the pitch.
    nx = isThrow ? (t.x < CX ? 1 : -1) : 0;
    ny = isThrow ? 0 : t.attacksTop ? -1 : 1;
    len = Math.hypot(nx, ny) || 1;
  }
  nx /= len;
  ny /= len;
  if (isThrow) {
    const infield = t.x < CX ? 1 : -1; // +x from the left line, -x from the right
    if (nx * infield < 0.2) {
      nx = infield * 0.5; // clamp an outward aim back into the field
      const ren = Math.hypot(nx, ny) || 1;
      nx /= ren;
      ny /= ren;
    }
  } else {
    // Free kick taken near a touchline: the aim point is clamped inside the
    // pitch, but kickToward still launches at full power along the aim — so an
    // outward aim flies PAST the clamp and straight out for a throw to the other
    // team. Kill any outward component near the line so it stays in (parallel or
    // infield). Midfield free kicks keep full directional freedom.
    const NEAR_LINE = 40;
    const inward = t.x > FIELD_R - NEAR_LINE ? -1 : t.x < FIELD_L + NEAR_LINE ? 1 : 0;
    if (inward !== 0 && nx * inward < 0) {
      nx = 0; // run it up/down the line instead of booting it out
      const ren = Math.hypot(nx, ny);
      if (ren < 0.1) {
        ny = t.attacksTop ? -1 : 1; // pure-outward aim: play it up the pitch
      } else {
        nx /= ren;
        ny /= ren;
      }
    }
  }
  const tx = clampf(t.x + nx * RESTART_DIST, FIELD_L + 4, FIELD_R - 4);
  const ty = clampf(t.y + ny * RESTART_DIST, FIELD_T + 4, FIELD_B - 4);
  t.dir = dirFromVec(nx, ny);
  state.ball.controlLock = 0;
  if (isThrow) kickToward(state, t, tx, ty, THROW_POWER, THROW_LOB);
  else kickToward(state, t, tx, ty, FK_POWER, FK_LOB);
  match.awaitRestart = null;
  match.restart = null;
  match.phase = 'play';
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
    if (m.team !== t.team || m === t || m.role === 'gk' || m.sentOff) continue;
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
  } else if (r.kind === 'penalty') {
    // Spot kick: drive it low into a corner of the goal; the keeper dives.
    const goalLine = attacksTop(t.team, match.half) ? FIELD_T : FIELD_B;
    const side = t.x <= CX ? 1 : -1; // aim across goal, away from the run-up lean
    kickToward(state, t, CX + side * (GOAL_W / 2 - 3), goalLine, 360, 24);
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
  if (match.cardFlash > 0) match.cardFlash = Math.max(0, match.cardFlash - dt);

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
    // A human is lining up a restart: hold here until they release it (or the
    // idle fallback fires). Aim + release are driven from the session.
    if (match.awaitRestart) {
      match.awaitRestart.t += dt;
      if (match.awaitRestart.t >= AIM_TIMEOUT) deliverRestartAimed(state, match);
      return;
    }
    match.deadTimer -= dt;
    if (match.deadTimer <= 0) {
      if (match.deadReset) {
        // After a goal: conceding team kicks off (its own ready freeze).
        beginKickoff(state, match, match.kickoffTeam);
      } else {
        const r = match.restart;
        // A human team's throw-in / free kick is handed to the player to aim and
        // release; everything else (and all AI restarts) is auto-delivered.
        if (r && (r.kind === 'throw' || r.kind === 'freekick') && match.humanTeams[r.taker.team]) {
          const t = r.taker;
          // Default aim: a throw goes infield from the line; a free kick points
          // up the pitch toward the goal the taker attacks.
          const dx = r.kind === 'throw' ? (t.x < CX ? 1 : -1) : 0;
          const dy = r.kind === 'throw' ? 0 : t.attacksTop ? -1 : 1;
          match.awaitRestart = { taker: t, team: t.team, kind: r.kind, dx, dy, t: 0 };
        } else {
          deliverRestart(state, match); // throw it in / kick it out to play
          match.phase = 'play';
        }
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
    // A foul inside the box the fouled team attacks is a penalty; else a free kick.
    const pen = inPenaltyBox(f.x, f.y, attacksTop(f.team, match.half));
    if (pen) {
      placePenalty(state, match, f.team);
    } else {
      const fx = Math.min(FIELD_R - 4, Math.max(FIELD_L + 4, f.x));
      const fy = Math.min(FIELD_B - 4, Math.max(FIELD_T + 4, f.y));
      placeRestart(state, match, fx, fy, f.team, 'freekick');
    }
    const card = judgeCard(match, f, pen);
    // Send the referee to the spot to brandish the card he just decided to show.
    if (card) brandishCard(state.referee, f.x, f.y, card);
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
