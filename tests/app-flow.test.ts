// Screen-flow tests driven through the real app shell, a frame at a time.
//
// The bug these exist for: quitting a competition match with Escape cleared the
// session but left the competition in place, so full time in the NEXT match — a
// Friendly — was routed to the competition results screen and posted the
// friendly's scoreline into the outstanding fixture.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeCtx, installLocalStorage, installWindow, type Keyboard } from './support/harness';
import { makeApp, type App, type SensiDev } from '../src/app';
import { yourFixture } from '../src/competition';
import { hasTournament } from '../src/save';

const DT = 1 / 60;

let app: App;
let dev: SensiDev;
let keyboard: Keyboard;

beforeEach(() => {
  installLocalStorage();
  keyboard = installWindow().keyboard;
  app = makeApp({ ctx: fakeCtx(), renderMatch: () => {} });
  dev = (globalThis as unknown as { window: { __sensiDev: SensiDev } }).window.__sensiDev;
});

// One frame with a key tapped: the edge is recorded, update() consumes it.
function tap(code: string): void {
  keyboard.down(code);
  app.update(DT);
  keyboard.up(code);
}

function frames(n: number): void {
  for (let i = 0; i < n; i++) app.update(DT);
}

// Walk from the competition hub into the live match (hub -> formation -> match).
function kickOffCompMatch(): void {
  expect(dev.screen()).toBe('compHub');
  tap('Space'); // play the fixture -> formation pick
  expect(dev.screen()).toBe('preMatch');
  tap('Space'); // confirm the formation -> match
  expect(dev.screen()).toBe('match');
}

// Blow the whistle: jump the clock to full time and let the hold elapse.
function playToFullTime(score: [number, number]): void {
  const session = dev.session();
  expect(session).not.toBeNull();
  session!.match.score[0] = score[0];
  session!.match.score[1] = score[1];
  session!.match.phase = 'fulltime';
  frames(240); // FULL TIME overlay holds for 3s
}

describe('competition match', () => {
  it('records the result at full time', () => {
    dev.quickComp('cup');
    const comp = dev.competition()!;
    const fixture = yourFixture(comp)!;
    kickOffCompMatch();
    playToFullTime([3, 1]);
    expect(dev.screen()).toBe('compResults');
    expect(fixture.played).toBe(true);
    const yours = fixture.a.id === comp.you.id ? [fixture.sa, fixture.sb] : [fixture.sb, fixture.sa];
    expect(yours).toEqual([3, 1]);
  });

  it('advances to the next round from the results screen', () => {
    dev.quickComp('league');
    const comp = dev.competition()!;
    kickOffCompMatch();
    playToFullTime([1, 0]);
    tap('Space'); // leave the results screen
    expect(comp.roundIndex).toBe(1);
    expect(dev.screen()).toBe('compHub');
  });
});

describe('quitting a match', () => {
  it('detaches the competition so the next match cannot post into it', () => {
    dev.quickComp('cup');
    const comp = dev.competition()!;
    const fixture = yourFixture(comp)!;
    kickOffCompMatch();

    tap('Escape'); // abandon the competition match
    expect(dev.screen()).toBe('mainMenu');
    expect(dev.session()).toBeNull();
    expect(dev.competition(), 'the abandoned run must not stay attached').toBeNull();

    // Now play a Friendly through to full time.
    dev.quickMatch();
    expect(dev.screen()).toBe('match');
    playToFullTime([5, 0]);
    expect(dev.screen(), 'a friendly must end on the post-match screen').toBe('postMatch');
    expect(fixture.played, 'the friendly score must not land in the fixture').toBe(false);
    expect([fixture.sa, fixture.sb]).toEqual([0, 0]);
  });

  it('leaves a saved tournament resumable', () => {
    // quickComp does not autosave, so save through the real flow: a competition
    // is written to storage as soon as the team is chosen.
    tap('Space'); // title -> main menu
    expect(dev.screen()).toBe('mainMenu');
    tap('ArrowDown'); // FRIENDLY -> WORLD CUP
    tap('ArrowDown'); // -> CUP
    tap('Space'); // enter the cup: team select (continent level)
    expect(dev.screen()).toBe('teamSelect');
    tap('Space'); // pick the first continent
    tap('Space'); // pick the first team
    expect(dev.screen()).toBe('compHub');
    expect(hasTournament()).toBe(true);

    kickOffCompMatch();
    tap('Escape');
    expect(dev.screen()).toBe('mainMenu');
    expect(dev.competition()).toBeNull();
    // The run itself survives: CONTINUE is offered and loads back into the hub.
    // (The highlight stays on CUP, where it was, so walk back up to the top.)
    expect(hasTournament()).toBe(true);
    tap('ArrowUp');
    tap('ArrowUp');
    tap('ArrowUp');
    tap('Space'); // CONTINUE
    expect(dev.screen()).toBe('compHub');
    expect(dev.competition()).not.toBeNull();
  });
});

describe('play again', () => {
  it('starts the replay from a clean sheet', () => {
    dev.quickMatch();
    const session = dev.session()!;
    // Rough up the match the way a real one ends: goals, a booking, a man off.
    session.match.score[0] = 2;
    session.match.score[1] = 2;
    session.state.players[3].sentOff = true;
    session.state.players[4].yellow = true;
    playToFullTime([2, 2]);
    expect(dev.screen()).toBe('postMatch');

    tap('Space'); // PLAY AGAIN
    expect(dev.screen()).toBe('match');
    const replay = dev.session()!;
    expect(replay.match.score).toEqual([0, 0]);
    expect(replay.match.phase).toBe('kickoff');
    expect(replay.match.awaitRestart).toBeNull();
    expect(replay.state.players.some((p) => p.sentOff)).toBe(false);
    expect(replay.state.players.some((p) => p.yellow)).toBe(false);
  });

  it('returns to the main menu and drops the session', () => {
    dev.quickMatch();
    playToFullTime([0, 0]);
    tap('ArrowDown'); // PLAY AGAIN -> MAIN MENU
    tap('Space');
    expect(dev.screen()).toBe('mainMenu');
    expect(dev.session()).toBeNull();
  });
});
