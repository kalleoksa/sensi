// League and Cup competitions over the team roster. You control one team; the
// other fixtures in each round are auto-simulated (random scorelines, like the
// original presenting CPU match results). Lives in memory only — no save game,
// matching the original's "one sitting" leagues.
//
//   League: single round-robin (circle method), 3 pts win / 1 draw, table sorted
//           by points then goal difference. The team on top after every round is
//           played is champion.
//   Cup:    single-elimination bracket; drawn ties are settled on penalties (a
//           coin-flip here). Win the final to be champion; lose any tie and your
//           run is over.

import { GROUPS, type TeamDef } from './teams/data';
import { makeRng, type Rng } from './rng';

export type CompetitionKind = 'league' | 'cup' | 'worldcup';

const WC_GROUP_ROUNDS = 3; // matchdays in a 4-team group round-robin

// A single match. `a` and `b` are the two teams; for the player's own fixture we
// always orient `a` = you. winner is set when resolved (cup; or league for info).
export interface Fixture {
  a: TeamDef;
  b: TeamDef;
  sa: number;
  sb: number;
  played: boolean;
  winner: TeamDef | null;
}

export interface TableRow {
  team: TeamDef;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

export interface Competition {
  kind: CompetitionKind;
  you: TeamDef;
  rounds: Fixture[][]; // league: full fixed schedule; cup: filled round by round
  roundIndex: number; // current round being played
  done: boolean;
  champion: TeamDef | null; // set when finished (null if you were knocked out)
  youOut: boolean; // cup: eliminated before the final
  groups: TeamDef[][] | null; // worldcup: the 12 groups of 4; null otherwise
  rng: Rng;
}

const MAX_GOALS = 4; // ceiling for a simulated scoreline

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fixture(a: TeamDef, b: TeamDef): Fixture {
  return { a, b, sa: 0, sb: 0, played: false, winner: null };
}

// Round-robin via the circle method: each team meets every other once.
function leagueSchedule(teams: TeamDef[]): Fixture[][] {
  const n = teams.length;
  const half = n / 2;
  const idx = teams.map((_, i) => i);
  const rounds: Fixture[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: Fixture[] = [];
    for (let i = 0; i < half; i++) {
      round.push(fixture(teams[idx[i]], teams[idx[n - 1 - i]]));
    }
    rounds.push(round);
    // Rotate all but the first index one step.
    const rest = idx.slice(1);
    rest.unshift(rest.pop()!);
    idx.splice(1, idx.length - 1, ...rest);
  }
  return rounds;
}

export function makeCompetition(kind: CompetitionKind, teams: TeamDef[], you: TeamDef, seed: number): Competition {
  const rng = makeRng(seed);
  let rounds: Fixture[][];
  let groups: TeamDef[][] | null = null;
  if (kind === 'league') {
    rounds = leagueSchedule(shuffle(teams, rng));
  } else if (kind === 'worldcup') {
    // The real A–L draw; each group plays a 3-matchday round robin. Matchday r
    // is every group's round-r pairing concatenated (so the player's group game
    // sits alongside the rest of the world's that day).
    groups = GROUPS.map((g) => teams.filter((t) => t.group === g));
    const perGroup = groups.map((g) => leagueSchedule(g));
    rounds = [];
    for (let r = 0; r < WC_GROUP_ROUNDS; r++) rounds.push(perGroup.flatMap((gr) => gr[r]));
  } else {
    // Cup: pair the shuffled field into the first round; later rounds fill in.
    const field = shuffle(teams, rng);
    const first: Fixture[] = [];
    for (let i = 0; i < field.length; i += 2) first.push(fixture(field[i], field[i + 1]));
    rounds = [first];
  }
  return { kind, you, rounds, roundIndex: 0, done: false, champion: null, youOut: false, groups, rng };
}

// The player's fixture in the current round, or null if they have no match
// (cup: knocked out).
export function yourFixture(comp: Competition): Fixture | null {
  const round = comp.rounds[comp.roundIndex];
  if (!round) return null;
  return round.find((f) => f.a === comp.you || f.b === comp.you) ?? null;
}

function resolve(f: Fixture, rng: Rng): void {
  f.played = true;
  if (f.sa > f.sb) f.winner = f.a;
  else if (f.sb > f.sa) f.winner = f.b;
  else f.winner = rng.next() < 0.5 ? f.a : f.b; // penalties
}

// Record the player's own result. yourGoals/oppGoals come from the live match
// (the player is always team `a` of their fixture).
export function recordYourResult(comp: Competition, yourGoals: number, oppGoals: number): void {
  const f = yourFixture(comp);
  if (!f) return;
  // Orient so the score lands on the right side regardless of how the schedule
  // placed the player.
  if (f.a === comp.you) {
    f.sa = yourGoals;
    f.sb = oppGoals;
  } else {
    f.sb = yourGoals;
    f.sa = oppGoals;
  }
  resolve(f, comp.rng);
}

// Auto-simulate every other unplayed fixture in the current round.
export function simRound(comp: Competition): void {
  for (const f of comp.rounds[comp.roundIndex]) {
    if (f.played) continue;
    f.sa = comp.rng.int(0, MAX_GOALS);
    f.sb = comp.rng.int(0, MAX_GOALS);
    resolve(f, comp.rng);
  }
}

export function leagueTable(comp: Competition): TableRow[] {
  const rows = new Map<string, TableRow>();
  const ensure = (t: TeamDef): TableRow => {
    let r = rows.get(t.id);
    if (!r) {
      r = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      rows.set(t.id, r);
    }
    return r;
  };
  for (const round of comp.rounds) {
    for (const f of round) {
      if (!f.played) continue;
      const ra = ensure(f.a);
      const rb = ensure(f.b);
      ra.p++;
      rb.p++;
      ra.gf += f.sa;
      ra.ga += f.sb;
      rb.gf += f.sb;
      rb.ga += f.sa;
      if (f.sa > f.sb) {
        ra.w++;
        rb.l++;
        ra.pts += 3;
      } else if (f.sb > f.sa) {
        rb.w++;
        ra.l++;
        rb.pts += 3;
      } else {
        ra.d++;
        rb.d++;
        ra.pts++;
        rb.pts++;
      }
    }
  }
  // Make sure every team appears even before they've played.
  for (const round of comp.rounds) for (const f of round) {
    ensure(f.a);
    ensure(f.b);
  }
  return [...rows.values()].sort(
    (x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.team.name.localeCompare(y.team.name),
  );
}

// Advance past the current round once all its fixtures are played: update the
// standings / build the next cup round, and decide whether the competition is
// over (or the player is out).
export function advance(comp: Competition): void {
  if (comp.kind === 'league') {
    comp.roundIndex++;
    if (comp.roundIndex >= comp.rounds.length) {
      comp.done = true;
      comp.champion = leagueTable(comp)[0]?.team ?? null;
    }
    return;
  }
  if (comp.kind === 'worldcup') {
    // Group stage (Phase 2): after the 3 matchdays, the tournament ends here and
    // qualification is read off the group tables. (Knockout = Phase 3.)
    comp.roundIndex++;
    if (comp.roundIndex >= WC_GROUP_ROUNDS) {
      comp.done = true;
      if (!wcAdvancers(comp).some((t) => t.id === comp.you.id)) comp.youOut = true;
    }
    return;
  }
  // Cup: gather winners; either crown a champion or build the next round.
  const winners = comp.rounds[comp.roundIndex].map((f) => f.winner!).filter(Boolean);
  if (winners.length <= 1) {
    comp.done = true;
    comp.champion = winners[0] ?? null;
    if (comp.champion !== comp.you) comp.youOut = true;
    return;
  }
  const next: Fixture[] = [];
  for (let i = 0; i < winners.length; i += 2) next.push(fixture(winners[i], winners[i + 1]));
  comp.rounds.push(next);
  comp.roundIndex++;
  if (!next.some((f) => f.a === comp.you || f.b === comp.you)) {
    // The player lost their tie — their run ends here.
    comp.done = true;
    comp.youOut = true;
  }
}

// Human-readable name for the current cup round (by number of teams left).
export function cupRoundName(comp: Competition, roundIndex = comp.roundIndex): string {
  const ties = comp.rounds[roundIndex]?.length ?? 0;
  switch (ties) {
    case 1:
      return 'FINAL';
    case 2:
      return 'SEMI FINAL';
    case 4:
      return 'QUARTER FINAL';
    case 8:
      return 'ROUND OF 16';
    default:
      return `ROUND ${roundIndex + 1}`;
  }
}

// --- World Cup helpers -----------------------------------------------------

const cmpRows = (x: TableRow, y: TableRow): number =>
  y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.team.name.localeCompare(y.team.name);

// Standings for one group (only fixtures between its four teams).
export function groupTable(comp: Competition, teams: TeamDef[]): TableRow[] {
  const ids = new Set(teams.map((t) => t.id));
  const rows = new Map<string, TableRow>();
  for (const t of teams) rows.set(t.id, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  for (const round of comp.rounds) {
    for (const f of round) {
      if (!f.played || !ids.has(f.a.id) || !ids.has(f.b.id)) continue;
      const ra = rows.get(f.a.id)!;
      const rb = rows.get(f.b.id)!;
      ra.p++;
      rb.p++;
      ra.gf += f.sa;
      ra.ga += f.sb;
      rb.gf += f.sb;
      rb.ga += f.sa;
      if (f.sa > f.sb) {
        ra.w++;
        rb.l++;
        ra.pts += 3;
      } else if (f.sb > f.sa) {
        rb.w++;
        ra.l++;
        rb.pts += 3;
      } else {
        ra.d++;
        rb.d++;
        ra.pts++;
        rb.pts++;
      }
    }
  }
  return [...rows.values()].sort(cmpRows);
}

// The group a team is drawn in (or null).
export function wcGroupOf(comp: Competition, team: TeamDef): TeamDef[] | null {
  return comp.groups?.find((g) => g.some((t) => t.id === team.id)) ?? null;
}

// The 32 teams that advance: the top two of every group plus the eight
// best third-placed teams across all groups.
export function wcAdvancers(comp: Competition): TeamDef[] {
  if (!comp.groups) return [];
  const adv: TeamDef[] = [];
  const thirds: TableRow[] = [];
  for (const g of comp.groups) {
    const t = groupTable(comp, g);
    if (t[0]) adv.push(t[0].team);
    if (t[1]) adv.push(t[1].team);
    if (t[2]) thirds.push(t[2]);
  }
  thirds.sort(cmpRows);
  for (let i = 0; i < 8 && i < thirds.length; i++) adv.push(thirds[i].team);
  return adv;
}
