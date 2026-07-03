// A live match session: the game state + match rules + how it's controlled.
// Created on demand when a mode launches (see app.ts) and stepped by the fixed
// loop. The per-step logic used to live at module scope in main.ts; it moved
// here so the app shell can own multiple screens above the match.

import { VIEW_W, VIEW_H, makeCamera, updateCamera, FIELD_T, FIELD_B, CX } from './world';
import { consumeInputs } from './input';
import { makeBall, stepBall, setPitch, GROUND_FRICTION } from './ball';
import {
  controlHuman,
  resolvePossession,
  resolveSlideTackles,
  resolveHeaders,
  resolveKeeperSaves,
  checkOffside,
  PLAYER_SPEED,
} from './player';
import { makeMatch, updateMatch, startMatch, aimRestart, deliverRestartAimed, type Match } from './match';
import { makeTeams } from './team';
import { updateTeamAi, coastPlayers, positionForRestart } from './ai';
import { makeReferee, stepReferee } from './referee';
import { makeRng } from './rng';
import type { GameState, Player, PlayerState } from './state';
import type { TeamDef } from './teams/data';
import type { FormationId } from './formations';
import type { Pitch } from './options';
import type { Shootout } from './shootout';

export type ControlMode = '1p' | '2p' | 'cpu';

export interface MatchConfig {
  home: TeamDef;
  away: TeamDef;
  controlMode: ControlMode;
  homeFormation: FormationId;
  awayFormation: FormationId;
  halfLength: number; // seconds per half
  pitch: Pitch;
  offside: boolean; // enforce the offside rule
}

// One recorded tick of open play for the goal replay: ball (x,y,z) and each
// player's (x,y,z,dir,stateIdx,distance). Recorded only during continuous
// 'play' (the buffer resets whenever play restarts, so a replay never shows a
// dead-ball teleport), capped to the last REPLAY_MAX ticks.
export interface ReplayFrame {
  b: [number, number, number];
  p: [number, number, number, number, number, number][];
}
export const REPLAY_STATES: PlayerState[] = ['idle', 'run', 'kick', 'header', 'slide', 'fallen', 'gkdive'];
export const REPLAY_MAX = 300; // 5s at 60Hz

export interface Session {
  state: GameState;
  match: Match;
  config: MatchConfig;
  paused: boolean;
  // Live penalty shootout settling a drawn knockout tie (see shootout.ts);
  // created by the app when full time ends level in a knockout round.
  shootout?: Shootout | null;
  // Rolling open-play recording for the post-goal replay (see app.ts).
  history: ReplayFrame[];
  lastPhase: string;
}

// Where the ball will be after t seconds: rolling under ground friction, or in
// flight (air drag is negligible for this estimate). Used to hand control to
// the player nearest the ball's PATH, not its current spot — picking by current
// position kept selecting players a fast pass had already gone past.
function ballPosAt(s: GameState, t: number): { x: number; y: number } {
  const b = s.ball;
  const f = b.z > 0.5 ? t : (1 - Math.exp(-GROUND_FRICTION * t)) / GROUND_FRICTION;
  return { x: b.x + b.vx * f, y: b.y + b.vy * f };
}

// Each human drives their team's player best placed to meet the ball (carrier
// if their team has it): distance is measured to where the ball will be by the
// time that player could reach it. A little stickiness avoids flicker when two
// are equidistant.
function pickControlled(s: GameState, team: 0 | 1, current: Player | null): Player {
  const b = s.ball;
  if (s.carrier && s.carrier.team === team && s.carrier.role !== 'gk') return s.carrier;
  const distTo = (p: Player): number => {
    const now = Math.hypot(p.x - b.x, p.y - b.y);
    const tau = Math.min(now / PLAYER_SPEED, 0.7); // time he'd need to get there
    const at = ballPosAt(s, tau);
    return Math.hypot(p.x - at.x, p.y - at.y);
  };
  let best: Player | null = current;
  let bestD =
    current && current.team === team && current.role !== 'gk'
      ? distTo(current) * 0.8 // stickiness factor
      : Infinity;
  for (const p of s.players) {
    if (p.team !== team || p.role === 'gk') continue;
    const d = distTo(p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best!;
}

export function makeSession(config: MatchConfig): Session {
  const rng = makeRng(7);
  const midY = (FIELD_T + FIELD_B) / 2;
  const state: GameState = {
    ball: makeBall(CX, midY),
    players: makeTeams(rng, config.home, config.away, config.homeFormation, config.awayFormation),
    camera: makeCamera(),
    carrier: null,
    controlled: null,
    controlled2: null,
    foul: null,
    teamSlideCd: [0, 0],
    referee: makeReferee(),
    offsideEnabled: config.offside,
    offsideWatch: null,
    offside: null,
  };
  setPitch(config.pitch.friction, config.pitch.bounce);
  const match = makeMatch();
  match.halfLength = config.halfLength; // startMatch -> setupHalf resets the clock to this
  // Which teams a human drives: 1p => team 0 only, 2p => both, cpu => neither.
  // Throw-ins for a human team are aimed and released by the player.
  match.humanTeams =
    config.controlMode === 'cpu' ? [false, false]
    : config.controlMode === '2p' ? [true, true]
    : [true, false];
  startMatch(state, match);
  // Center the camera on the ball at kickoff.
  updateCamera(state.camera, state.ball.x, state.ball.y, 0, 0, 1);
  return { state, match, config, paused: false, history: [], lastPhase: 'kickoff' };
}

export function restartSession(s: Session): void {
  startMatch(s.state, s.match);
}

export function stepSession(s: Session, dt: number): void {
  if (s.paused) return; // freeze the sim; render still draws the overlay
  const { state, match, config } = s;
  const twoPlayer = config.controlMode === '2p';
  const input = consumeInputs(twoPlayer);

  // Manual restart: a human is lining up a throw-in, free kick or corner. Aim
  // with the stick, HOLD action to build power, release to deliver. Meanwhile
  // the other players move into shape (a throw-in/free-kick spreads the teams; a
  // corner keeps its snapped box layout).
  if (match.awaitRestart) {
    const a = match.awaitRestart;
    const taker = a.taker; // capture before release may clear it
    const kind = a.kind;
    const frame = a.team === 0 ? input.p1 : input.p2;
    if (frame) {
      aimRestart(match, frame.dx, frame.dy);
      if (frame.pressed) {
        a.charging = true; // a fresh press starts charging (ignores a held-over key)
        a.charge = 0;
        a.t = 0;
      }
      if (a.charging && frame.down) {
        a.charge = Math.min(a.charge + dt, 0.7);
        a.t = 0;
      }
      if (a.charging && frame.released) deliverRestartAimed(state, match); // power from charge
    }
    // Shape the other players while we wait — but only if the ball hasn't just
    // been released this frame (deliverRestartAimed clears awaitRestart). A
    // corner holds its box layout (coast); a throw-in has no offside.
    if (match.awaitRestart) {
      if (kind === 'corner') coastPlayers(state, dt);
      else positionForRestart(state, taker, dt, kind === 'throw' || kind === 'goalkick');
    }
    stepBall(state.ball, dt);
    updateMatch(state, match, dt);
    stepReferee(state.referee, state.ball, dt);
    updateCamera(state.camera, state.ball.x, state.ball.y, state.ball.vx, state.ball.vy, dt);
    return;
  }

  // A fresh spell of open play starts a fresh replay recording, so a replay
  // never spans a dead-ball teleport.
  if (match.phase === 'play' && s.lastPhase !== 'play') s.history.length = 0;
  s.lastPhase = match.phase;

  // Freeze player control during the post-goal pause, but keep the ball rolling
  // so it travels into the net during the goal celebration.
  if (match.phase === 'play') {
    if (config.controlMode === 'cpu') {
      // Watch mode: no humans, AI drives everyone (both controlled slots null).
      state.controlled = null;
      state.controlled2 = null;
    } else {
      state.controlled = pickControlled(state, 0, state.controlled);
      controlHuman(state, state.controlled, input.p1, dt);
      if (input.p2) {
        state.controlled2 = pickControlled(state, 1, state.controlled2);
        controlHuman(state, state.controlled2, input.p2, dt);
      } else {
        state.controlled2 = null;
      }
    }
    updateTeamAi(state, dt);
    resolveSlideTackles(state);
    resolveKeeperSaves(state); // before headers: the keeper's ball beats a leap
    resolveHeaders(state);
    resolvePossession(state, dt);
    checkOffside(state); // judge the first touch after a watched kick
  } else if (
    match.phase === 'dead' &&
    match.restart &&
    (match.restart.kind === 'throw' || match.restart.kind === 'freekick' || match.restart.kind === 'goalkick')
  ) {
    // Throw-in / free-kick / goal-kick setup: shape the teams (attackers spread
    // into attacking positions, defenders mark) instead of leaving everyone
    // clustered. Corners/penalties keep their own snap placement. Throw-ins and
    // goal kicks have no offside.
    const noOff = match.restart.kind === 'throw' || match.restart.kind === 'goalkick';
    positionForRestart(state, match.restart.taker, dt, noOff);
  } else {
    // Not in open play (goal celebration, half/full-time, corner/penalty/goal-
    // kick setup): keep bodies moving naturally so the diving keeper falls
    // instead of freezing in the air, and runners coast to a stop.
    coastPlayers(state, dt);
  }
  stepBall(state.ball, dt);
  if (match.phase === 'play') recordReplayFrame(s); // incl. the goal-crossing tick
  updateMatch(state, match, dt);
  stepReferee(state.referee, state.ball, dt);
  updateCamera(state.camera, state.ball.x, state.ball.y, state.ball.vx, state.ball.vy, dt);
}

function recordReplayFrame(s: Session): void {
  const st = s.state;
  const b = st.ball;
  s.history.push({
    b: [b.x, b.y, b.z],
    p: st.players.map((p) => [p.x, p.y, p.z, p.dir, REPLAY_STATES.indexOf(p.state), p.distance]),
  });
  if (s.history.length > REPLAY_MAX) s.history.shift();
}

// Re-export view dims so callers don't need world.ts just for layout.
export { VIEW_W, VIEW_H };
