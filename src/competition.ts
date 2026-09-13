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
//           run is over. A field that isn't a power of two hands out byes (never
//           to the player) so the bracket normalizes in the opening round and
//           every round after it halves cleanly — see pairRound.

import { GROUPS, type TeamDef } from './teams/data';
import { makeRng, type Rng } from './rng';

export type CompetitionKind = 'league' | 'cup' | 'worldcup';

const WC_GROUP_ROUNDS = 3; // matchdays in a 4-team group round-robin

// A single match. `a` and `b` are the two teams; for the player's own fixture we
// always orient `a` = you. winner is set when resolved (cup; or league for info).
// Both teams are always defined — a knockout field that doesn't pair off exactly
// hands out byes instead of half-filling a fixture (see pairRound).
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
  // Knockout byes, parallel to `rounds`: byes[r] are the teams that sat out
  // round r and walk straight into round r+1. Empty for every league round and
  // for any round whose field is even.
  byes: TeamDef[][];
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

// Largest power of two strictly below n. The size the next knockout round should
// have, so a field that isn't a power of two normalizes in one go.
function halfPowerOfTwo(n: number): number {
  let p = 1;
  while (p * 2 < n) p *= 2;
  return p;
}

// Pair a knockout field into ties, handing out byes when the field isn't twice a
// power of two (52 teams => 20 ties + 12 byes => a 32-team round two, and every
// round after that halves exactly). Byes are drawn at random from everyone but
// the player, so the player always has a match — and every fixture returned has
// two defined teams, which the rest of the app (bracket drawing, simulation,
// saving) relies on.
function pairRound(field: TeamDef[], you: TeamDef, rng: Rng): { ties: Fixture[]; byes: TeamDef[] } {
  if (field.length < 2) return { ties: [], byes: [...field] };
  const byeCount = 2 * halfPowerOfTwo(field.length) - field.length;
  const byes: TeamDef[] = [];
  let playing = field;
  if (byeCount > 0) {
    for (const t of shuffle(field, rng)) {
      if (byes.length >= byeCount) break;
      if (t.id !== you.id) byes.push(t);
    }
    const byeIds = new Set(byes.map((t) => t.id));
    playing = field.filter((t) => !byeIds.has(t.id)); // keeps the bracket order
  }
  const ties: Fixture[] = [];
  for (let i = 0; i + 1 < playing.length; i += 2) ties.push(fixture(playing[i], playing[i + 1]));
  return { ties, byes };
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
  let byes: TeamDef[][] | null = null; // set by the cup branch; no byes elsewhere
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
    const first = pairRound(shuffle(teams, rng), you, rng);
    rounds = [first.ties];
    byes = [first.byes];
  }
  return {
    kind,
    you,
    rounds,
    roundIndex: 0,
    done: false,
    champion: null,
    youOut: false,
    groups,
    byes: byes ?? rounds.map(() => []), // league / WC group stage: no byes
    rng,
  };
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
export function recordYourResult(
  comp: Competition,
  yourGoals: number,
  oppGoals: number,
  pensWon?: boolean,
): void {
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
  // A drawn knockout tie the player settled on the pitch (a real shootout)
  // overrides resolve()'s coin-flip penalties.
  if (pensWon !== undefined && f.sa === f.sb) {
    f.winner = pensWon ? comp.you : f.a === comp.you ? f.b : f.a;
  }
}

// Auto-simulate every other unplayed fixture in the current round.
export function simRound(comp: Competition): void {
  for (const f of comp.rounds[comp.roundIndex]) {
    if (f.played) continue;
    // Skill tilts the simulated scoreline: each star of difference shifts a
    // goal of ceiling from the weaker side to the stronger (still random, so
    // upsets happen — a minnow can nick one against anyone).
    const tilt = Math.round((f.a.skill - f.b.skill) / 2);
    const capA = Math.max(1, Math.min(MAX_GOALS + 1, MAX_GOALS + tilt));
    const capB = Math.max(1, Math.min(MAX_GOALS + 1, MAX_GOALS - tilt));
    f.sa = comp.rng.int(0, capA);
    f.sb = comp.rng.int(0, capB);
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
    comp.roundIndex++;
    if (comp.roundIndex < WC_GROUP_ROUNDS) return; // still in the group stage
    if (comp.roundIndex === WC_GROUP_ROUNDS) {
      // Groups done: seed the Round of 32 from the standings and play on.
      const r32 = buildKnockout(comp);
      comp.rounds.push(r32);
      comp.byes.push([]);
      if (!r32.some((f) => f.a.id === comp.you.id || f.b.id === comp.you.id)) {
        comp.done = true; // didn't qualify
        comp.youOut = true;
      }
      return;
    }
    // Knockout: build the next round from the winners of the one just completed.
    buildNextKnockoutRound(comp, comp.roundIndex - 1);
    return;
  }
  // Cup: gather winners; either crown a champion or build the next round.
  if (buildNextKnockoutRound(comp, comp.roundIndex)) comp.roundIndex++;
}

// Advance a knockout bracket: take the winners of round `from` plus that round's
// byes, then either crown a champion or pair the survivors into a new round.
// Shared by the Cup and the World Cup knockout stage so both get the same bye
// handling and the same two-defined-teams-per-fixture guarantee. Returns true
// when a new round was pushed (false once the bracket is decided).
function buildNextKnockoutRound(comp: Competition, from: number): boolean {
  const round = comp.rounds[from] ?? [];
  const winners = round.map((f) => f.winner).filter((w): w is TeamDef => !!w);
  const field = [...winners, ...(comp.byes[from] ?? [])];
  if (field.length <= 1) {
    comp.done = true;
    comp.champion = field[0] ?? null;
    if (!comp.champion || comp.champion.id !== comp.you.id) comp.youOut = true;
    return false;
  }
  const { ties, byes } = pairRound(field, comp.you, comp.rng);
  comp.rounds.push(ties);
  comp.byes.push(byes);
  if (!ties.some((f) => f.a.id === comp.you.id || f.b.id === comp.you.id)) {
    // The player lost their tie — their run ends here.
    comp.done = true;
    comp.youOut = true;
  }
  return true;
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
    case 16:
      return 'ROUND OF 32';
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

// Seed the Round of 32 from the group results: 12 winners + 12 runners-up + 8
// best thirds. Each winner is drawn against a lower seed from a different group;
// the leftover lower seeds pair off. A simplified, same-group-avoiding bracket —
// not the exact official template.
function buildKnockout(comp: Competition): Fixture[] {
  if (!comp.groups) return [];
  const winners: TeamDef[] = [];
  const lowers: TeamDef[] = []; // runners-up, then the best thirds
  const thirdRows: TableRow[] = [];
  for (const g of comp.groups) {
    const t = groupTable(comp, g);
    if (t[0]) winners.push(t[0].team);
    if (t[1]) lowers.push(t[1].team);
    if (t[2]) thirdRows.push(t[2]);
  }
  thirdRows.sort(cmpRows);
  for (let i = 0; i < 8 && i < thirdRows.length; i++) lowers.push(thirdRows[i].team);

  const pool = shuffle(lowers, comp.rng);
  const used = new Set<string>();
  const ties: Fixture[] = [];
  for (const w of winners) {
    const opp = pool.find((o) => !used.has(o.id) && o.group !== w.group) ?? pool.find((o) => !used.has(o.id));
    if (opp) {
      used.add(opp.id);
      ties.push(fixture(w, opp));
    }
  }
  const rest = pool.filter((o) => !used.has(o.id));
  for (let i = 0; i < rest.length; i += 2) if (rest[i + 1]) ties.push(fixture(rest[i], rest[i + 1]));
  return ties;
}
