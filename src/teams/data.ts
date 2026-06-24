// National team definitions. The 48-team 2026 World Cup field (tagged with its
// real Group A–L draw) plus a few non-qualified nations kept for Friendly /
// League / Cup. Kit colours follow the provided per-team table (home strips).
// At 12px the secondary colour reads on the SHORTS, not shirt trim, so kits are
// solid unless the accent is structural: vertical stripes (Argentina, Paraguay),
// a red/white check (Croatia), or a horizontal chest band (flag-banded kits).

import type { RGB } from '../sprites/palette';
import type { KitPattern } from '../state';

export interface Kit {
  shirt: RGB;
  shorts: RGB;
  socks: RGB;
  pattern?: KitPattern; // shirt pattern; defaults to solid
  accent?: RGB; // second colour for the pattern (defaults to shirt)
}

export type Continent = 'EUROPE' | 'S. AMERICA' | 'N. AMERICA' | 'AFRICA' | 'ASIA' | 'OCEANIA';

// 2026 World Cup group (A–L); undefined for nations not at the tournament.
export type GroupId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';

export interface TeamDef {
  id: string;
  name: string; // shown in lists, uppercase to suit the font
  short: string; // 3-letter tag for compact spots
  continent: Continent;
  group?: GroupId; // World Cup 26 group, if qualified
  kit: Kit;
  gkKit?: Kit; // defaults to a contrast-picked stock keeper kit
}

const rgb = (r: number, g: number, b: number): RGB => [r, g, b];
// Parse a "#RRGGBB" string from the kit table into an RGB triple.
const hx = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// Soft white / black so pixels don't read as harsh pure values on the pitch;
// used wherever the table specifies #FFFFFF / #000000.
const WHITE = rgb(238, 238, 232);
const BLACK = rgb(30, 30, 34);
// Reused by the non-WC nations below.
const RED = rgb(200, 38, 40);
const GREEN = rgb(28, 140, 64);
const YELLOW = rgb(240, 206, 44);
const AZZURRI = rgb(34, 92, 170);

// Goalkeeper kits use a small stock pool (as the original did) picked per match
// to contrast with both outfield shirts and the pitch — the real FIFA rule.
// Green/yellow are deliberately absent: they blend with the grass.
export const GK_COLORS: RGB[] = [
  rgb(26, 26, 26), // black — default, contrasts with almost everything
  rgb(224, 0, 122), // magenta — when both teams wear dark
  rgb(255, 105, 0), // orange — when both teams wear light
  rgb(0, 194, 199), // cyan — secondary bright option
];

const PITCH_TONE: RGB = [151, 176, 33]; // approx grass; keepers must not blend in

function colorDist2(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

// Stock GK colour with the greatest minimum distance from every colour in
// `avoid` (the two outfield shirts, the pitch, and the other keeper).
export function pickGoalkeeperColor(avoid: RGB[]): RGB {
  let best = GK_COLORS[0];
  let bestScore = -1;
  for (const c of GK_COLORS) {
    let minD = Infinity;
    for (const a of avoid) minD = Math.min(minD, colorDist2(c, a));
    if (minD > bestScore) {
      bestScore = minD;
      best = c;
    }
  }
  return best;
}

// Keeper kits for a match: each contrasts with both shirts and the pitch, and
// the two keepers differ from each other. A team's explicit gkKit overrides this.
export function goalkeeperKits(homeShirt: RGB, awayShirt: RGB): { home: Kit; away: Kit } {
  const avoid = [homeShirt, awayShirt, PITCH_TONE];
  const h = pickGoalkeeperColor(avoid);
  const a = pickGoalkeeperColor([...avoid, h]);
  return {
    home: { shirt: h, shorts: BLACK, socks: BLACK },
    away: { shirt: a, shorts: BLACK, socks: BLACK },
  };
}

export const TEAMS: TeamDef[] = [
  // --- Europe (UEFA: 16 at WC26, + Italy/Ireland who didn't qualify) ---
  { id: 'eng', name: 'ENGLAND', short: 'ENG', continent: 'EUROPE', group: 'L', kit: { shirt: WHITE, shorts: hx('#0A285F'), socks: WHITE } },
  { id: 'fra', name: 'FRANCE', short: 'FRA', continent: 'EUROPE', group: 'I', kit: { shirt: hx('#1E3A6E'), shorts: WHITE, socks: hx('#1E3A6E') } },
  { id: 'ger', name: 'GERMANY', short: 'GER', continent: 'EUROPE', group: 'E', kit: { shirt: WHITE, shorts: BLACK, socks: WHITE, pattern: 'band', accent: hx('#DD0000') } },
  { id: 'esp', name: 'SPAIN', short: 'ESP', continent: 'EUROPE', group: 'H', kit: { shirt: hx('#AA151B'), shorts: hx('#0A285F'), socks: hx('#0A285F'), pattern: 'band', accent: hx('#F1BF00') } },
  { id: 'ned', name: 'NETHERLANDS', short: 'NED', continent: 'EUROPE', group: 'F', kit: { shirt: hx('#FF6900'), shorts: BLACK, socks: hx('#FF6900') } },
  { id: 'swe', name: 'SWEDEN', short: 'SWE', continent: 'EUROPE', group: 'F', kit: { shirt: hx('#FECC00'), shorts: hx('#005293'), socks: hx('#FECC00') } },
  { id: 'cze', name: 'CZECHIA', short: 'CZE', continent: 'EUROPE', group: 'A', kit: { shirt: hx('#D7141A'), shorts: hx('#11457E'), socks: hx('#D7141A') } },
  { id: 'bih', name: 'BOSNIA', short: 'BIH', continent: 'EUROPE', group: 'B', kit: { shirt: hx('#1B1464'), shorts: hx('#1B1464'), socks: hx('#1B1464'), pattern: 'band', accent: hx('#FFD100') } },
  { id: 'sui', name: 'SWITZERLAND', short: 'SUI', continent: 'EUROPE', group: 'B', kit: { shirt: hx('#DA291C'), shorts: WHITE, socks: hx('#DA291C') } },
  { id: 'sco', name: 'SCOTLAND', short: 'SCO', continent: 'EUROPE', group: 'C', kit: { shirt: hx('#0A285F'), shorts: WHITE, socks: hx('#0A285F') } },
  { id: 'tur', name: 'TURKEY', short: 'TUR', continent: 'EUROPE', group: 'D', kit: { shirt: hx('#E30A17'), shorts: WHITE, socks: hx('#E30A17') } },
  { id: 'bel', name: 'BELGIUM', short: 'BEL', continent: 'EUROPE', group: 'G', kit: { shirt: hx('#E30613'), shorts: BLACK, socks: hx('#E30613') } },
  { id: 'nor', name: 'NORWAY', short: 'NOR', continent: 'EUROPE', group: 'I', kit: { shirt: hx('#BA0C2F'), shorts: hx('#00205B'), socks: hx('#BA0C2F') } },
  { id: 'aut', name: 'AUSTRIA', short: 'AUT', continent: 'EUROPE', group: 'J', kit: { shirt: hx('#ED2939'), shorts: WHITE, socks: hx('#ED2939') } },
  { id: 'por', name: 'PORTUGAL', short: 'POR', continent: 'EUROPE', group: 'K', kit: { shirt: hx('#C8102E'), shorts: hx('#006600'), socks: hx('#C8102E') } },
  { id: 'cro', name: 'CROATIA', short: 'CRO', continent: 'EUROPE', group: 'L', kit: { shirt: WHITE, shorts: hx('#0F3B8C'), socks: WHITE, pattern: 'check', accent: hx('#D2122E') } },
  { id: 'ita', name: 'ITALY', short: 'ITA', continent: 'EUROPE', kit: { shirt: AZZURRI, shorts: WHITE, socks: AZZURRI } },
  { id: 'irl', name: 'IRELAND', short: 'IRL', continent: 'EUROPE', kit: { shirt: GREEN, shorts: WHITE, socks: GREEN } },

  // --- South America (CONMEBOL: 6) ---
  { id: 'bra', name: 'BRAZIL', short: 'BRA', continent: 'S. AMERICA', group: 'C', kit: { shirt: hx('#FFDF00'), shorts: hx('#002776'), socks: WHITE } },
  { id: 'par', name: 'PARAGUAY', short: 'PAR', continent: 'S. AMERICA', group: 'D', kit: { shirt: hx('#D52B1E'), shorts: hx('#0038A8'), socks: WHITE, pattern: 'stripes', accent: WHITE } },
  { id: 'ecu', name: 'ECUADOR', short: 'ECU', continent: 'S. AMERICA', group: 'E', kit: { shirt: hx('#FFD100'), shorts: hx('#003893'), socks: hx('#FFD100') } },
  { id: 'uru', name: 'URUGUAY', short: 'URU', continent: 'S. AMERICA', group: 'H', kit: { shirt: hx('#5CBFEB'), shorts: BLACK, socks: hx('#5CBFEB') } },
  { id: 'arg', name: 'ARGENTINA', short: 'ARG', continent: 'S. AMERICA', group: 'J', kit: { shirt: hx('#75AADB'), shorts: hx('#0F3B8C'), socks: WHITE, pattern: 'stripes', accent: WHITE } },
  { id: 'col', name: 'COLOMBIA', short: 'COL', continent: 'S. AMERICA', group: 'K', kit: { shirt: hx('#FCD116'), shorts: hx('#003893'), socks: hx('#FCD116') } },

  // --- North America (CONCACAF: 3 hosts + 3 qualifiers) ---
  { id: 'mex', name: 'MEXICO', short: 'MEX', continent: 'N. AMERICA', group: 'A', kit: { shirt: hx('#006847'), shorts: WHITE, socks: hx('#006847') } },
  { id: 'can', name: 'CANADA', short: 'CAN', continent: 'N. AMERICA', group: 'B', kit: { shirt: hx('#FF0000'), shorts: hx('#FF0000'), socks: hx('#FF0000') } },
  { id: 'hai', name: 'HAITI', short: 'HAI', continent: 'N. AMERICA', group: 'C', kit: { shirt: hx('#00209F'), shorts: hx('#00209F'), socks: hx('#00209F') } },
  { id: 'usa', name: 'USA', short: 'USA', continent: 'N. AMERICA', group: 'D', kit: { shirt: WHITE, shorts: hx('#1F2742'), socks: WHITE } },
  { id: 'cuw', name: 'CURACAO', short: 'CUW', continent: 'N. AMERICA', group: 'E', kit: { shirt: hx('#002B7F'), shorts: hx('#002B7F'), socks: hx('#002B7F') } },
  { id: 'pan', name: 'PANAMA', short: 'PAN', continent: 'N. AMERICA', group: 'L', kit: { shirt: hx('#DB0A16'), shorts: hx('#005293'), socks: hx('#DB0A16') } },

  // --- Africa (CAF: 10 at WC26, + Cameroon/Nigeria who didn't qualify) ---
  { id: 'rsa', name: 'SOUTH AFRICA', short: 'RSA', continent: 'AFRICA', group: 'A', kit: { shirt: hx('#007749'), shorts: WHITE, socks: hx('#007749') } },
  { id: 'mar', name: 'MOROCCO', short: 'MAR', continent: 'AFRICA', group: 'C', kit: { shirt: hx('#C1272D'), shorts: hx('#C1272D'), socks: hx('#C1272D') } },
  { id: 'civ', name: 'IVORY COAST', short: 'CIV', continent: 'AFRICA', group: 'E', kit: { shirt: hx('#FF8200'), shorts: hx('#FF8200'), socks: hx('#FF8200') } },
  { id: 'tun', name: 'TUNISIA', short: 'TUN', continent: 'AFRICA', group: 'F', kit: { shirt: hx('#E70013'), shorts: WHITE, socks: hx('#E70013') } },
  { id: 'egy', name: 'EGYPT', short: 'EGY', continent: 'AFRICA', group: 'G', kit: { shirt: hx('#CE1126'), shorts: WHITE, socks: hx('#CE1126') } },
  { id: 'cpv', name: 'CAPE VERDE', short: 'CPV', continent: 'AFRICA', group: 'H', kit: { shirt: hx('#003893'), shorts: WHITE, socks: hx('#003893') } },
  { id: 'sen', name: 'SENEGAL', short: 'SEN', continent: 'AFRICA', group: 'I', kit: { shirt: WHITE, shorts: WHITE, socks: WHITE } },
  { id: 'alg', name: 'ALGERIA', short: 'ALG', continent: 'AFRICA', group: 'J', kit: { shirt: WHITE, shorts: hx('#007229'), socks: WHITE, pattern: 'band', accent: hx('#007229') } },
  { id: 'cod', name: 'DR CONGO', short: 'COD', continent: 'AFRICA', group: 'K', kit: { shirt: hx('#007FFF'), shorts: hx('#007FFF'), socks: hx('#007FFF') } },
  { id: 'gha', name: 'GHANA', short: 'GHA', continent: 'AFRICA', group: 'L', kit: { shirt: WHITE, shorts: hx('#006B3F'), socks: hx('#FCD116'), pattern: 'band', accent: hx('#CE1126') } },
  { id: 'cmr', name: 'CAMEROON', short: 'CMR', continent: 'AFRICA', kit: { shirt: GREEN, shorts: RED, socks: YELLOW } },
  { id: 'nga', name: 'NIGERIA', short: 'NGA', continent: 'AFRICA', kit: { shirt: GREEN, shorts: WHITE, socks: GREEN } },

  // --- Asia (AFC: 8) ---
  { id: 'kor', name: 'S. KOREA', short: 'KOR', continent: 'ASIA', group: 'A', kit: { shirt: hx('#E4002B'), shorts: BLACK, socks: hx('#E4002B') } },
  { id: 'qat', name: 'QATAR', short: 'QAT', continent: 'ASIA', group: 'B', kit: { shirt: hx('#8A1538'), shorts: WHITE, socks: hx('#8A1538') } },
  { id: 'jpn', name: 'JAPAN', short: 'JPN', continent: 'ASIA', group: 'F', kit: { shirt: hx('#0A1F6B'), shorts: hx('#0A1F6B'), socks: hx('#0A1F6B') } },
  { id: 'irn', name: 'IRAN', short: 'IRN', continent: 'ASIA', group: 'G', kit: { shirt: WHITE, shorts: WHITE, socks: WHITE } },
  { id: 'ksa', name: 'SAUDI ARABIA', short: 'KSA', continent: 'ASIA', group: 'H', kit: { shirt: WHITE, shorts: WHITE, socks: WHITE } },
  { id: 'irq', name: 'IRAQ', short: 'IRQ', continent: 'ASIA', group: 'I', kit: { shirt: hx('#009639'), shorts: WHITE, socks: hx('#009639') } },
  { id: 'jor', name: 'JORDAN', short: 'JOR', continent: 'ASIA', group: 'J', kit: { shirt: WHITE, shorts: BLACK, socks: WHITE } },
  { id: 'uzb', name: 'UZBEKISTAN', short: 'UZB', continent: 'ASIA', group: 'K', kit: { shirt: WHITE, shorts: WHITE, socks: WHITE } },

  // --- Oceania (Australia AFC / New Zealand OFC, grouped here geographically) ---
  { id: 'aus', name: 'AUSTRALIA', short: 'AUS', continent: 'OCEANIA', group: 'D', kit: { shirt: hx('#FFB81C'), shorts: hx('#00843D'), socks: hx('#FFB81C') } },
  { id: 'nzl', name: 'NEW ZEALAND', short: 'NZL', continent: 'OCEANIA', group: 'G', kit: { shirt: WHITE, shorts: BLACK, socks: WHITE } },
];

// Continents that actually have teams, in display order.
export const CONTINENTS: Continent[] = ['EUROPE', 'S. AMERICA', 'N. AMERICA', 'AFRICA', 'ASIA', 'OCEANIA'];

export function teamsIn(c: Continent): TeamDef[] {
  return TEAMS.filter((t) => t.continent === c);
}

// World Cup 26 groups, in order.
export const GROUPS: GroupId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// The 48 nations in the World Cup field (those tagged with a group).
export const WC_TEAMS: TeamDef[] = TEAMS.filter((t) => t.group !== undefined);

export function teamsInGroup(g: GroupId): TeamDef[] {
  return TEAMS.filter((t) => t.group === g);
}
