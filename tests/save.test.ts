// Persistence tests. The stored value is untrusted input — an older build, a
// half-written entry, a hand-edited one — so a malformed save must degrade to
// "no save" rather than throwing somewhere inside the animation loop.

import { beforeEach, describe, expect, it } from 'vitest';
import { installLocalStorage, type FakeStorage } from './support/harness';
import { clearTournament, hasTournament, loadTournament, saveTournament } from '../src/save';
import { advance, makeCompetition, recordYourResult, simRound } from '../src/competition';
import { TEAMS } from '../src/teams/data';
import { MATCH_LENGTHS, PITCHES } from '../src/options';

const KEY = 'sensi.tournament';

let storage: FakeStorage;

beforeEach(() => {
  storage = installLocalStorage();
});

// The raw JSON of a valid save, ready to be corrupted field by field.
function validRaw(): Record<string, unknown> {
  const comp = makeCompetition('cup', TEAMS.slice(0, 8), TEAMS[0], 11);
  saveTournament(comp, 1, 2);
  return JSON.parse(storage.store.get(KEY)!) as Record<string, unknown>;
}

function write(value: unknown): void {
  storage.store.set(KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

describe('round trip', () => {
  it('restores rounds, byes, progress and the PRNG state', () => {
    const comp = makeCompetition('cup', [...TEAMS], TEAMS[5], 4242);
    recordYourResult(comp, 2, 1);
    simRound(comp);
    advance(comp);
    saveTournament(comp, 2, 3);

    const loaded = loadTournament();
    expect(loaded).not.toBeNull();
    const back = loaded!.comp;
    expect(loaded!.lengthIndex).toBe(2);
    expect(loaded!.pitchIndex).toBe(3);
    expect(back.kind).toBe('cup');
    expect(back.you.id).toBe(comp.you.id);
    expect(back.roundIndex).toBe(comp.roundIndex);
    expect(back.rounds.length).toBe(comp.rounds.length);
    expect(back.byes.map((r) => r.map((t) => t.id))).toEqual(comp.byes.map((r) => r.map((t) => t.id)));
    expect(back.rng.getState()).toBe(comp.rng.getState());
    // Resumed auto-sims stay deterministic.
    expect(back.rng.next()).toBe(comp.rng.next());
    // Fixtures come back with both teams and the recorded score.
    for (let r = 0; r < comp.rounds.length; r++) {
      expect(back.rounds[r].map((f) => [f.a.id, f.b.id, f.sa, f.sb, f.played])).toEqual(
        comp.rounds[r].map((f) => [f.a.id, f.b.id, f.sa, f.sb, f.played]),
      );
    }
  });

  it('round trips a world cup, groups included', () => {
    const comp = makeCompetition('worldcup', TEAMS.filter((t) => t.group !== undefined), TEAMS[0], 7);
    saveTournament(comp, 0, 0);
    const back = loadTournament()!.comp;
    expect(back.groups?.length).toBe(12);
    expect(back.groups?.[0].map((t) => t.id)).toEqual(comp.groups?.[0].map((t) => t.id));
  });

  it('reports a finished tournament as not resumable', () => {
    const comp = makeCompetition('cup', TEAMS.slice(0, 2), TEAMS[0], 1);
    recordYourResult(comp, 1, 0);
    simRound(comp);
    advance(comp);
    expect(comp.done).toBe(true);
    saveTournament(comp, 0, 0);
    expect(hasTournament()).toBe(false);
  });
});

describe('malformed saves', () => {
  it('drops a value that is not JSON at all', () => {
    write('{not json');
    expect(hasTournament()).toBe(false);
    expect(loadTournament()).toBeNull();
    expect(storage.store.has(KEY), 'unreadable save should be removed').toBe(false);
  });

  const corruptions: [string, (d: Record<string, unknown>) => void][] = [
    ['null rounds', (d) => (d.rounds = null)],
    ['rounds not nested', (d) => (d.rounds = [1, 2, 3])],
    ['fixture missing a team', (d) => ((d.rounds as Record<string, unknown>[][])[0][0].b = undefined)],
    ['fixture team not a string', (d) => ((d.rounds as Record<string, unknown>[][])[0][0].a = 17)],
    ['score not a number', (d) => ((d.rounds as Record<string, unknown>[][])[0][0].sa = '2')],
    ['score not an integer', (d) => ((d.rounds as Record<string, unknown>[][])[0][0].sa = 1.5)],
    ['negative score', (d) => ((d.rounds as Record<string, unknown>[][])[0][0].sb = -1)],
    ['played not a boolean', (d) => ((d.rounds as Record<string, unknown>[][])[0][0].played = 'yes')],
    ['roundIndex past the last round', (d) => (d.roundIndex = 99)],
    ['negative roundIndex', (d) => (d.roundIndex = -1)],
    ['roundIndex not an integer', (d) => (d.roundIndex = 0.5)],
    ['byes out of step with rounds', (d) => (d.byes = [])],
    ['byes holding non-strings', (d) => (d.byes = [[5]])],
    ['unknown kind', (d) => (d.kind = 'playoffs')],
    ['missing you', (d) => (d.you = null)],
    ['unknown team id', (d) => (d.you = 'atlantis')],
    ['done not a boolean', (d) => (d.done = 1)],
    ['groups not nested', (d) => (d.groups = ['eng'])],
    ['rngState not finite', (d) => (d.rngState = 'abc')],
    ['wrong version', (d) => (d.version = 0)],
    ['not an object', (d) => void d],
  ];

  for (const [name, corrupt] of corruptions) {
    it(`rejects a save with ${name}`, () => {
      const d = validRaw();
      corrupt(d);
      write(name === 'not an object' ? '[1,2,3]' : d);
      expect(() => hasTournament()).not.toThrow();
      expect(hasTournament()).toBe(false);
      expect(() => loadTournament()).not.toThrow();
      expect(loadTournament()).toBeNull();
    });
  }

  it('clamps option indices that are out of range instead of failing the load', () => {
    const d = validRaw();
    d.lengthIndex = 999;
    d.pitchIndex = -4;
    write(d);
    const loaded = loadTournament();
    expect(loaded).not.toBeNull();
    expect(loaded!.lengthIndex).toBeGreaterThanOrEqual(0);
    expect(loaded!.lengthIndex).toBeLessThan(MATCH_LENGTHS.length);
    expect(loaded!.pitchIndex).toBeGreaterThanOrEqual(0);
    expect(loaded!.pitchIndex).toBeLessThan(PITCHES.length);
  });

  it('refuses a save that references a team no longer in the roster', () => {
    const d = validRaw();
    (d.rounds as Record<string, unknown>[][])[0][0].a = 'atlantis';
    write(d);
    expect(loadTournament()).toBeNull();
  });
});

describe('unavailable storage', () => {
  it('never throws when localStorage itself is off limits', () => {
    storage.throwOnAccess = true;
    const comp = makeCompetition('league', TEAMS.slice(0, 4), TEAMS[0], 3);
    expect(() => saveTournament(comp, 0, 0)).not.toThrow();
    expect(() => clearTournament()).not.toThrow();
    expect(hasTournament()).toBe(false);
    expect(loadTournament()).toBeNull();
  });
});
