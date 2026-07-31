// Persist an in-progress tournament to localStorage so long competitions
// survive a refresh / close. We save the COMPETITION (not the live match) at
// between-match points; resuming drops the player back at the hub. The
// Competition holds TeamDef references and an Rng, neither of which is JSON, so
// teams are stored by id and rehydrated on load, and the PRNG state is captured
// so resumed auto-sims stay deterministic.
//
// Anything under a storage key we don't control byte-for-byte (an older build, a
// half-written value, a hand-edited entry) has to be treated as untrusted input:
// loading validates the whole shape rather than trusting a type assertion, and a
// save that doesn't validate is dropped so the app boots into a clean menu
// instead of throwing inside the animation loop.

import { TEAMS, type TeamDef } from './teams/data';
import { makeRng } from './rng';
import { MATCH_LENGTHS, PITCHES } from './options';
import type { Competition, CompetitionKind } from './competition';

const KEY = 'sensi.tournament';
const VERSION = 2; // 2: added per-round byes

const KINDS: CompetitionKind[] = ['league', 'cup', 'worldcup'];

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
  byes: string[][];
  roundIndex: number;
  done: boolean;
  champion: string | null;
  youOut: boolean;
  groups: string[][] | null;
  rngState: number;
  lengthIndex: number;
  pitchIndex: number;
}

const MAX_GOALS_SAVED = 99; // a stored scoreline above this is nonsense

// TEAMS is a constant, so the id index is built once and reused (hasTournament
// runs every frame the main menu is up).
let idIndex: Map<string, TeamDef> | null = null;
const byId = (): Map<string, TeamDef> => (idIndex ??= new Map(TEAMS.map((t) => [t.id, t])));

export function saveTournament(comp: Competition, lengthIndex: number, pitchIndex: number): void {
  const id = (t: TeamDef | null): string | null => (t ? t.id : null);
  const data: SavedTournament = {
    version: VERSION,
    kind: comp.kind,
    you: comp.you.id,
    rounds: comp.rounds.map((r) =>
      r.map((f) => ({ a: f.a.id, b: f.b.id, sa: f.sa, sb: f.sb, played: f.played, winner: id(f.winner) })),
    ),
    byes: comp.byes.map((r) => r.map((t) => t.id)),
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

// --- validation -------------------------------------------------------------
// Every field of the parsed JSON is checked before it reaches the Competition,
// so a malformed save can only ever mean "no save" — never a throw mid-frame.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isIdOrNull = (v: unknown): v is string | null => v === null || isId(v);

// A finite integer in [lo, hi].
function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

function isIdArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isId);
}

function validFixture(v: unknown): v is SavedFixture {
  if (!isObj(v)) return false;
  return (
    isId(v.a) &&
    isId(v.b) &&
    isInt(v.sa, 0, MAX_GOALS_SAVED) &&
    isInt(v.sb, 0, MAX_GOALS_SAVED) &&
    isBool(v.played) &&
    isIdOrNull(v.winner)
  );
}

// Shape-check the parsed value and clamp the option indices (which only pick a
// label / physics preset, so a stale out-of-range index is worth salvaging).
function validate(v: unknown): SavedTournament | null {
  if (!isObj(v)) return null;
  if (v.version !== VERSION) return null;
  if (typeof v.kind !== 'string' || !KINDS.includes(v.kind as CompetitionKind)) return null;
  if (!isId(v.you)) return null;
  if (!Array.isArray(v.rounds) || !v.rounds.every((r) => Array.isArray(r) && r.every(validFixture))) return null;
  if (!Array.isArray(v.byes) || !v.byes.every(isIdArray)) return null;
  if (v.byes.length !== v.rounds.length) return null;
  if (!isInt(v.roundIndex, 0, Math.max(0, v.rounds.length - 1))) return null;
  if (!isBool(v.done) || !isBool(v.youOut)) return null;
  if (!isIdOrNull(v.champion)) return null;
  if (v.groups !== null && !(Array.isArray(v.groups) && v.groups.every(isIdArray))) return null;
  if (typeof v.rngState !== 'number' || !Number.isFinite(v.rngState)) return null;
  const clamp = (n: unknown, hi: number): number => (isInt(n, 0, hi) ? n : 0);
  return {
    version: VERSION,
    kind: v.kind as CompetitionKind,
    you: v.you,
    rounds: v.rounds as SavedFixture[][],
    byes: v.byes as string[][],
    roundIndex: v.roundIndex,
    done: v.done,
    champion: v.champion,
    youOut: v.youOut,
    groups: v.groups as string[][] | null,
    rngState: v.rngState >>> 0,
    lengthIndex: clamp(v.lengthIndex, MATCH_LENGTHS.length - 1),
    pitchIndex: clamp(v.pitchIndex, PITCHES.length - 1),
  };
}

// Read + validate the stored save. Anything unreadable or malformed is removed
// so a broken value can't keep offering a CONTINUE that never loads.
function read(): SavedTournament | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearTournament();
    return null;
  }
  const d = validate(parsed);
  if (!d) {
    clearTournament();
    return null;
  }
  return d;
}

// A resumable tournament exists: readable, unfinished, and for a team still in
// the roster. (Fixtures are only rehydrated by loadTournament — offering a
// CONTINUE that then fails to load is handled there by dropping the save.)
export function hasTournament(): boolean {
  const d = read();
  return !!d && !d.done && byId().has(d.you);
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
  const teamList = (ids: string[]): TeamDef[] | null => {
    const out: TeamDef[] = [];
    for (const tid of ids) {
      const t = team(tid);
      if (!t) return null;
      out.push(t);
    }
    return out;
  };
  const byes: TeamDef[][] = [];
  for (const b of d.byes) {
    const list = teamList(b);
    if (!list) return null;
    byes.push(list);
  }
  let groups: TeamDef[][] | null = null;
  if (d.groups) {
    groups = [];
    for (const g of d.groups) {
      const grp = teamList(g);
      if (!grp) return null;
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
    byes,
    rng,
  };
  return { comp, lengthIndex: d.lengthIndex, pitchIndex: d.pitchIndex };
}
