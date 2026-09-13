// Competition invariants. The bug these exist for: a knockout field that isn't a
// power of two used to build a fixture with only one team in it (52 teams ->
// 26 -> 13 -> a round of 7 ties where one had no opponent), which crashed on the
// next autosave and would have crashed the bracket draw too.

import { describe, expect, it } from 'vitest';
import {
  advance,
  leagueTable,
  makeCompetition,
  recordYourResult,
  simRound,
  yourFixture,
  type Competition,
} from '../src/competition';
import { TEAMS, WC_TEAMS } from '../src/teams/data';
import type { TeamDef } from '../src/teams/data';

const MAX_ROUNDS = 200; // playthrough guard: no competition should need this many

// Every fixture in every round must name two different, real teams.
function assertRoundsWellFormed(comp: Competition): void {
  const ids = new Set(TEAMS.map((t) => t.id));
  comp.rounds.forEach((round, r) => {
    const seen = new Set<string>();
    for (const f of round) {
      expect(f.a, `round ${r}: fixture with no home team`).toBeTruthy();
      expect(f.b, `round ${r}: fixture with no away team`).toBeTruthy();
      expect(ids.has(f.a.id), `round ${r}: unknown team ${f.a?.id}`).toBe(true);
      expect(ids.has(f.b.id), `round ${r}: unknown team ${f.b?.id}`).toBe(true);
      expect(f.a.id, `round ${r}: team drawn against itself`).not.toBe(f.b.id);
      // A team can only have one fixture per round.
      for (const id of [f.a.id, f.b.id]) {
        expect(seen.has(id), `round ${r}: ${id} appears twice`).toBe(false);
        seen.add(id);
      }
    }
    // A bye can't also be playing this round.
    for (const t of comp.byes[r] ?? []) {
      expect(seen.has(t.id), `round ${r}: ${t.id} has both a bye and a fixture`).toBe(false);
    }
  });
}

// Nobody may quietly vanish between knockout rounds: a round's survivors (one
// per tie, plus that round's byes) are exactly the field of the next one.
function assertKnockoutConservation(comp: Competition, from: number): void {
  for (let r = from; r + 1 < comp.rounds.length; r++) {
    const survivors = comp.rounds[r].length + (comp.byes[r]?.length ?? 0);
    const nextField = comp.rounds[r + 1].length * 2 + (comp.byes[r + 1]?.length ?? 0);
    expect(nextField, `round ${r} -> ${r + 1}: ${survivors} survivors became a field of ${nextField}`).toBe(
      survivors,
    );
  }
}

// The whole entry field is drawn into round one — playing or on a bye.
function assertFieldSize(comp: Competition, teams: number): void {
  expect(comp.rounds[0].length * 2 + comp.byes[0].length, 'teams missing from the first round').toBe(teams);
}

// Play a whole competition through, checking the invariants at every step. The
// player wins every match (3-0) so a knockout runs the full depth of the bracket
// rather than stopping at the first defeat.
function playThrough(comp: Competition): { rounds: number } {
  let rounds = 0;
  while (!comp.done) {
    expect(rounds, 'competition never finished').toBeLessThan(MAX_ROUNDS);
    assertRoundsWellFormed(comp);
    expect(comp.byes.length, 'byes must stay parallel to rounds').toBe(comp.rounds.length);
    if (yourFixture(comp)) {
      // recordYourResult orients the scoreline onto whichever side of the fixture
      // the schedule put the player on.
      recordYourResult(comp, 3, 0);
    }
    simRound(comp);
    for (const fx of comp.rounds[comp.roundIndex] ?? []) {
      expect(fx.played, 'every fixture in a completed round must be played').toBe(true);
    }
    advance(comp);
    rounds++;
  }
  assertRoundsWellFormed(comp);
  return { rounds };
}

describe('cup', () => {
  it('plays the real 52-team roster to a champion without a half-filled fixture', () => {
    const comp = makeCompetition('cup', [...TEAMS], TEAMS[0], 1234);
    assertFieldSize(comp, TEAMS.length);
    // The reported crash was in round 3 — assert we get well past it.
    const { rounds } = playThrough(comp);
    expect(rounds).toBeGreaterThan(3);
    assertKnockoutConservation(comp, 0);
    expect(comp.champion !== null || comp.youOut).toBe(true);
  });

  it('normalizes an odd field with byes so later rounds halve exactly', () => {
    const comp = makeCompetition('cup', TEAMS.slice(0, 13), TEAMS[0], 7);
    // 13 teams => 5 ties + 3 byes => a round of 8, then 4, 2, 1.
    expect(comp.rounds[0].length).toBe(5);
    expect(comp.byes[0].length).toBe(3);
    assertFieldSize(comp, 13);
    playThrough(comp);
    assertKnockoutConservation(comp, 0);
    expect(comp.rounds.map((r) => r.length)).toEqual([5, 4, 2, 1]);
    expect(comp.byes.slice(1).every((b) => b.length === 0)).toBe(true);
  });

  it('never gives the player a bye, so there is always a match to play', () => {
    // Field sizes that force byes in the opening round.
    for (const n of [3, 5, 7, 11, 13, 26, 33, 52]) {
      for (const youIndex of [0, 1, n - 1]) {
        const teams = TEAMS.slice(0, n);
        const comp = makeCompetition('cup', teams, teams[youIndex], n * 31 + youIndex);
        assertFieldSize(comp, n);
        while (!comp.done) {
          const mine = comp.byes[comp.roundIndex].some((t) => t.id === comp.you.id);
          expect(mine, `n=${n}: player was given a bye`).toBe(false);
          expect(yourFixture(comp), `n=${n}: player has no fixture`).toBeTruthy();
          recordYourResult(comp, 3, 0); // the player wins every round
          simRound(comp);
          advance(comp);
        }
        assertKnockoutConservation(comp, 0);
        expect(comp.champion?.id, `n=${n}: winner of every tie should lift the cup`).toBe(comp.you.id);
      }
    }
  });

  it('holds the invariants for every field size the roster can make', () => {
    const pool: TeamDef[] = [...TEAMS];
    for (let n = 2; n <= pool.length; n++) {
      const comp = makeCompetition('cup', pool.slice(0, n), pool[0], n);
      assertFieldSize(comp, n);
      playThrough(comp);
      assertKnockoutConservation(comp, 0);
      expect(comp.champion !== null || comp.youOut, `n=${n}: no outcome`).toBe(true);
    }
  });

  it('ends the run when the player loses a tie', () => {
    const comp = makeCompetition('cup', TEAMS.slice(0, 8), TEAMS[0], 99);
    recordYourResult(comp, 0, 4); // lose the first tie
    simRound(comp);
    advance(comp);
    expect(comp.done).toBe(true);
    expect(comp.youOut).toBe(true);
    expect(comp.champion).toBeNull();
  });
});

describe('league', () => {
  it('schedules a single round robin over the whole roster', () => {
    const comp = makeCompetition('league', [...TEAMS], TEAMS[3], 42);
    expect(comp.rounds.length).toBe(TEAMS.length - 1);
    for (const round of comp.rounds) expect(round.length).toBe(TEAMS.length / 2);
    // Every pair meets exactly once.
    const pairs = new Set<string>();
    for (const round of comp.rounds) {
      for (const f of round) {
        const key = [f.a.id, f.b.id].sort().join('-');
        expect(pairs.has(key)).toBe(false);
        pairs.add(key);
      }
    }
    expect(pairs.size).toBe((TEAMS.length * (TEAMS.length - 1)) / 2);
  });

  it('crowns the table leader after the last round', () => {
    const comp = makeCompetition('league', TEAMS.slice(0, 6), TEAMS[0], 5);
    playThrough(comp);
    expect(comp.done).toBe(true);
    const table = leagueTable(comp);
    expect(comp.champion?.id).toBe(table[0].team.id);
    // Everyone played everyone once.
    for (const row of table) expect(row.p).toBe(5);
  });
});

describe('world cup', () => {
  it('plays groups then a clean knockout bracket to a champion', () => {
    const comp = makeCompetition('worldcup', [...WC_TEAMS], WC_TEAMS[0], 2026);
    expect(comp.groups?.length).toBe(12);
    for (const g of comp.groups ?? []) expect(g.length).toBe(4);
    playThrough(comp);
    // Group stage (3 matchdays) then R32/R16/QF/SF/F when the player goes deep.
    expect(comp.rounds.length).toBeGreaterThanOrEqual(4);
    assertKnockoutConservation(comp, 3);
    const knockout = comp.rounds.slice(3).map((r) => r.length);
    expect(knockout[0]).toBe(16);
    // Each knockout round is half the previous one.
    for (let i = 1; i < knockout.length; i++) expect(knockout[i]).toBe(knockout[i - 1] / 2);
  });
});
