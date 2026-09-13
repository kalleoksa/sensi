// Session-level contracts: what a restart must reset, and what changing the
// control mode mid-match must move with it.
//
// The bugs these cover: PLAY AGAIN / R used to reset only part of the match, so a
// player sent off in the previous game stayed off the pitch, cards and a pending
// manual restart carried over, and a restart begun during the old game could
// leave the "fresh" kickoff still waiting on a throw-in. And the in-match
// 2-player toggle changed the control mode without moving restart ownership, so
// one side's restarts either went unaimable or stalled for eight seconds.

import { beforeEach, describe, expect, it } from 'vitest';
import { installWindow, type Keyboard } from './support/harness';
import { consumeInputs } from '../src/input';
import { makeSession, restartSession, setControlMode, stepSession } from '../src/session';
import type { Session } from '../src/session';
import { TEAMS } from '../src/teams/data';
import { DEFAULT_FORMATION } from '../src/formations';
import { PITCHES } from '../src/options';
import type { ControlMode } from '../src/session';

let keyboard: Keyboard;

beforeEach(() => {
  keyboard = installWindow().keyboard;
});

function session(controlMode: ControlMode = '1p'): Session {
  return makeSession({
    home: TEAMS[0],
    away: TEAMS[1],
    controlMode,
    homeFormation: DEFAULT_FORMATION,
    awayFormation: DEFAULT_FORMATION,
    halfLength: 90,
    pitch: PITCHES[0],
  });
}

// Put the session into as messy a state as a real match can reach: goals on the
// board, second half, a man sent off, cards shown, a foul pending, a manual
// restart being lined up, and players mid-action.
function dirty(s: Session): void {
  const { state, match } = s;
  match.score[0] = 3;
  match.score[1] = 2;
  match.half = 2;
  match.clock = 12;
  match.phase = 'dead';
  match.deadTimer = 1.2;
  match.deadReset = true;
  match.flash = 0.9;
  match.cardFlash = 1.1;
  match.cardColor = 'red';
  match.outBall = { kind: 'throw', team: 1, x: 10, y: 20 };
  match.outTimer = 0.4;
  match.kickoffTeam = 0;
  match.firstKickoffTeam = 0;
  const taker = state.players[3];
  match.restart = { kind: 'throw', taker };
  match.awaitRestart = { taker, team: 0, kind: 'throw', dx: 1, dy: 0, t: 2, charge: 0.5, charging: true };

  const booked = state.players[2];
  booked.yellow = true;
  const off = state.players[4];
  off.yellow = true;
  off.sentOff = true;
  off.x = -100;
  off.y = -100;
  const busy = state.players[5];
  busy.state = 'slide';
  busy.stateTimer = 0.6;
  busy.charging = true;
  busy.charge = 0.4;
  busy.bufferedTap = 0.05;
  busy.pokeTimer = 0.2;
  busy.slideCooldown = 1.5;
  busy.vx = 40;
  busy.vy = -25;
  busy.distance = 900;

  state.foul = { team: 1, x: 30, y: 40, offender: off, deniedAttack: true };
  state.teamSlideCd[0] = 1.3;
  state.teamSlideCd[1] = 0.7;
  state.suppressOffside = true;
  state.carrier = busy;
  state.ball.owner = busy;
  state.ball.vx = 200;
  state.ball.controlLock = 3;
}

describe('restartSession', () => {
  it('returns every mutable field to its start-of-match value', () => {
    const s = session();
    dirty(s);
    restartSession(s);

    const { state, match } = s;
    expect(match.score).toEqual([0, 0]);
    expect(match.phase).toBe('kickoff');
    expect(match.half).toBe(1);
    expect(match.clock).toBe(match.halfLength);
    expect(match.restart).toBeNull();
    expect(match.awaitRestart, 'a pending manual restart must not survive').toBeNull();
    expect(match.outBall).toBeNull();
    expect(match.outTimer).toBe(0);
    expect(match.flash).toBe(0);
    expect(match.cardFlash).toBe(0);
    expect(match.cardColor).toBeNull();
    expect(match.deadReset).toBe(false);
    expect(match.firstKickoffTeam).toBe(1);
    expect(match.kickoffTeam).toBe(1);

    expect(state.foul).toBeNull();
    expect(state.teamSlideCd).toEqual([0, 0]);
    expect(state.suppressOffside).toBe(false);
    expect(state.carrier).toBeNull();
    expect(state.ball.owner).toBeNull();
    expect(state.ball.vx).toBe(0);
    expect(state.ball.controlLock).toBe(0);
    expect(state.referee.cardTimer).toBe(0);
    expect(state.referee.cardColor).toBeNull();

    for (const p of state.players) {
      expect(p.sentOff, 'a sent-off player must be back for the new match').toBe(false);
      expect(p.yellow).toBe(false);
      expect(p.state).toBe('idle');
      expect(p.stateTimer).toBe(0);
      expect(p.charging).toBe(false);
      expect(p.charge).toBe(0);
      expect(p.bufferedTap).toBe(0);
      expect(p.pokeTimer).toBe(0);
      expect(p.slideCooldown).toBe(0);
      expect(p.distance).toBe(0);
      expect(p.vx).toBe(0);
      expect(p.vy).toBe(0);
    }
    // Everyone is back on their formation home bar the kickoff taker, who stands
    // on the ball — in particular nobody is left parked off the pitch.
    const displaced = state.players.filter((p) => p.x !== p.homeX || p.y !== p.homeY);
    expect(displaced.length).toBe(1);
    expect(state.players.filter((p) => p.x < 0 || p.y < 0)).toEqual([]);
  });

  it('produces the same state as a brand-new session', () => {
    const fresh = session();
    const replayed = session();
    dirty(replayed);
    restartSession(replayed);

    const snapshot = (s: Session): unknown => ({
      match: { ...s.match, restart: null, awaitRestart: null },
      players: s.state.players.map((p) => ({
        x: p.x,
        y: p.y,
        state: p.state,
        yellow: p.yellow,
        sentOff: p.sentOff,
        homeX: p.homeX,
        homeY: p.homeY,
        attacksTop: p.attacksTop,
      })),
      ball: { ...s.state.ball, owner: null },
    });
    expect(snapshot(replayed)).toEqual(snapshot(fresh));
  });

  it('does not carry a manual restart into the fresh kickoff', () => {
    const s = session();
    dirty(s);
    restartSession(s);
    // With awaitRestart cleared, stepping runs the kickoff freeze and reaches play
    // instead of sitting in the manual-restart branch.
    for (let i = 0; i < 120; i++) stepSession(s, 1 / 60);
    expect(s.match.awaitRestart).toBeNull();
    expect(s.match.phase).toBe('play');
  });
});

describe('setControlMode', () => {
  it('moves restart ownership with the control mode', () => {
    const s = session('1p');
    expect(s.match.humanTeams).toEqual([true, false]);
    setControlMode(s, '2p');
    expect(s.match.humanTeams).toEqual([true, true]);
    setControlMode(s, '1p');
    expect(s.match.humanTeams).toEqual([true, false]);
    expect(s.state.controlled2).toBeNull();
  });

  it('releases a restart owned by a team that just stopped being human', () => {
    const s = session('2p');
    const taker = s.state.players.find((p) => p.team === 1 && p.role !== 'gk')!;
    s.match.phase = 'dead';
    s.match.awaitRestart = { taker, team: 1, kind: 'throw', dx: 1, dy: 0, t: 0, charge: 0, charging: false };
    setControlMode(s, '1p');
    // Left pending it would stall for the full eight-second idle fallback, since
    // player two no longer has an input frame.
    expect(s.match.awaitRestart).toBeNull();
    expect(s.match.phase).toBe('play');
  });

  it('keeps a human-owned restart pending when the mode change does not affect it', () => {
    const s = session('1p');
    const taker = s.state.players.find((p) => p.team === 0 && p.role !== 'gk')!;
    s.match.phase = 'dead';
    s.match.awaitRestart = { taker, team: 0, kind: 'throw', dx: 1, dy: 0, t: 0, charge: 0, charging: false };
    setControlMode(s, '2p');
    expect(s.match.awaitRestart).not.toBeNull();
  });

  it('is a no-op when the mode is unchanged', () => {
    const s = session('1p');
    const taker = s.state.players[1];
    s.match.awaitRestart = { taker, team: 0, kind: 'throw', dx: 1, dy: 0, t: 0, charge: 0.3, charging: true };
    setControlMode(s, '1p');
    expect(s.match.awaitRestart?.charge).toBe(0.3);
  });
});

describe('paused input', () => {
  // A press made while the sim is frozen must be gone by the time the sim reads
  // input again — otherwise it surfaces as a kick or a tackle on the resuming
  // frame. Observed by consuming: if the edge is still queued, consumeInputs
  // hands it to the very next step.
  it('a press made while paused is not delivered on resume', () => {
    const s = session('1p');
    for (let i = 0; i < 120; i++) stepSession(s, 1 / 60);
    expect(s.match.phase).toBe('play');

    s.paused = true;
    keyboard.down('Space');
    keyboard.up('Space');
    stepSession(s, 1 / 60); // frozen frame: drains the edges instead of buffering
    s.paused = false;
    const frame = consumeInputs(false).p1;
    expect(frame.pressed).toBe(false);
    expect(frame.released).toBe(false);
  });
});

// Control hand-off. The human drives whichever teammate is nearest the ball, so
// control jumps between players constantly; state that only one code path
// maintained used to leak across those jumps.
describe('control switching', () => {
  const DT = 1 / 60;

  // Step past the kickoff freeze into open play.
  function intoPlay(s: Session): void {
    for (let i = 0; i < 90 && s.match.phase !== 'play'; i++) stepSession(s, DT);
    expect(s.match.phase).toBe('play');
  }

  it('never hands control to a sent-off player, even when he is on the ball', () => {
    const s = session();
    intoPlay(s);
    const ghost = s.state.players.find((p) => p.team === 0 && p.role !== 'gk' && p !== s.state.controlled)!;
    ghost.sentOff = true;
    ghost.x = s.state.ball.x;
    ghost.y = s.state.ball.y;
    stepSession(s, DT);
    expect(s.state.controlled).not.toBe(ghost);
  });

  it('drops a half-built charge when control moves to another player', () => {
    const s = session();
    intoPlay(s);
    keyboard.down('Space');
    stepSession(s, DT);
    const first = s.state.controlled!;
    expect(first.charging).toBe(true);

    // Put the ball on the far-off teammate so the auto-switch picks him instead.
    const other = s.state.players
      .filter((p) => p.team === 0 && p.role !== 'gk' && p !== first)
      .sort((a, b) => Math.hypot(b.x - first.x, b.y - first.y) - Math.hypot(a.x - first.x, a.y - first.y))[0];
    s.state.ball.x = other.x;
    s.state.ball.y = other.y;
    s.state.ball.vx = s.state.ball.vy = 0;
    stepSession(s, DT);

    expect(s.state.controlled).toBe(other);
    expect(first.charging, 'the abandoned player must not keep charging').toBe(false);
    expect(first.charge).toBe(0);
    keyboard.up('Space');
  });

  it('ticks the poke-reach window on players the human is not controlling', () => {
    const s = session();
    intoPlay(s);
    const idle = s.state.players.find((p) => p.team === 1 && p.role !== 'gk')!; // AI side: never controlled in 1p
    idle.pokeTimer = 0.3;
    for (let i = 0; i < 60; i++) stepSession(s, DT);
    expect(idle.pokeTimer).toBe(0);
  });
});
