// Persist an in-progress tournament to localStorage so long competitions
// survive a refresh / close. We save the COMPETITION (not the live match) at
// between-match points; resuming drops the player back at the hub. The
// Competition holds TeamDef references and an Rng, neither of which is JSON, so
// teams are stored by id and rehydrated on load, and the PRNG state is captured
// so resumed auto-sims stay deterministic.

import { TEAMS, type TeamDef } from './teams/data';
import { makeRng } from './rng';
import type { Competition, CompetitionKind } from './competition';

const KEY = 'sensi.tournament';
const VERSION = 1;

interface SavedFixture {
  a: string;
  b: string;
  sa: number;
  sb: number;
  played: boolean;
  winner: string | null;
}

interface SavedTournament {
  version: number;
  kind: CompetitionKind;
  you: string;
  rounds: SavedFixture[][];
  roundIndex: number;
  done: boolean;
  champion: string | null;
  youOut: boolean;
  groups: string[][] | null;
  rngState: number;
  lengthIndex: number;
  pitchIndex: number;
}

const byId = (): Map<string, TeamDef> => new Map(TEAMS.map((t) => [t.id, t]));

export function saveTournament(comp: Competition, lengthIndex: number, pitchIndex: number): void {
  const id = (t: TeamDef | null): string | null => (t ? t.id : null);
  const data: SavedTournament = {
    version: VERSION,
    kind: comp.kind,
    you: comp.you.id,
    rounds: comp.rounds.map((r) =>
      r.map((f) => ({ a: f.a.id, b: f.b.id, sa: f.sa, sb: f.sb, played: f.played, winner: id(f.winner) })),
    ),
    roundIndex: comp.roundIndex,
    done: comp.done,
    champion: id(comp.champion),
    youOut: comp.youOut,
    groups: comp.groups ? comp.groups.map((g) => g.map((t) => t.id)) : null,
    rngState: comp.rng.getState(),
    lengthIndex,
    pitchIndex,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full / unavailable — saving is best-effort.
  }
}

function read(): SavedTournament | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as SavedTournament;
    return d && d.version === VERSION ? d : null;
  } catch {
    return null;
  }
}

// A resumable tournament exists (and isn't already finished).
export function hasTournament(): boolean {
  const d = read();
  return !!d && !d.done;
}

export function clearTournament(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Rebuild a Competition from the save, or null if it's missing / unreadable /
// references a team that no longer exists (e.g. after a roster change).
export function loadTournament(): { comp: Competition; lengthIndex: number; pitchIndex: number } | null {
  const d = read();
  if (!d) return null;
  const map = byId();
  const team = (tid: string): TeamDef | undefined => map.get(tid);
  const you = team(d.you);
  if (!you) return null;

  const rounds = [];
  for (const r of d.rounds) {
    const round = [];
    for (const f of r) {
      const a = team(f.a);
      const b = team(f.b);
      if (!a || !b) return null;
      round.push({ a, b, sa: f.sa, sb: f.sb, played: f.played, winner: f.winner ? team(f.winner) ?? null : null });
    }
    rounds.push(round);
  }
  let groups: TeamDef[][] | null = null;
  if (d.groups) {
    groups = [];
    for (const g of d.groups) {
      const grp: TeamDef[] = [];
      for (const tid of g) {
        const t = team(tid);
        if (!t) return null;
        grp.push(t);
      }
      groups.push(grp);
    }
  }
  const rng = makeRng(0);
  rng.setState(d.rngState);

  const comp: Competition = {
    kind: d.kind,
    you,
    rounds,
    roundIndex: d.roundIndex,
    done: d.done,
    champion: d.champion ? team(d.champion) ?? null : null,
    youOut: d.youOut,
    groups,
    rng,
  };
  return { comp, lengthIndex: d.lengthIndex, pitchIndex: d.pitchIndex };
}
