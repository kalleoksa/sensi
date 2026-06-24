// National team definitions. The 48-team 2026 World Cup field (tagged with its
// real Group A–L draw) plus a few non-qualified nations kept for Friendly /
// League / Cup. Kit colours follow the provided per-team table (home strips);
// `pattern` drives the shirt rendering (stripes / check / sleeve-trim) and
// `accent` is its second colour. Teams are grouped by continent so the
// team-select screen can browse them hierarchically (continent -> nation).

import type { RGB } from '../sprites/palette';
import type { KitPattern } from '../state';

export interface Kit {
  shirt: RGB;
  shorts: RGB;
  socks: RGB;
  pattern?: KitPattern; // shirt pattern; defaults to solid
  accent?: RGB; // second colour for the pattern/trim (defaults to shirt)
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
  gkKit?: Kit; // defaults to DEFAULT_GK_KIT
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

// Keepers wear this unless a team overrides it (distinct green so they read
// apart from outfielders, matching the previous hard-coded keeper kit).
export const DEFAULT_GK_KIT: Kit = { shirt: rgb(40, 150, 78), shorts: BLACK, socks: BLACK };

export const TEAMS: TeamDef[] = [
  // --- Europe (UEFA: 16 at WC26, + Italy/Ireland who didn't qualify) ---
  { id: 'eng', name: 'ENGLAND', short: 'ENG', continent: 'EUROPE', group: 'L', kit: { shirt: WHITE, shorts: hx('#0A285F'), socks: WHITE, pattern: 'sleeves', accent: hx('#0A285F') } },
  { id: 'fra', name: 'FRANCE', short: 'FRA', continent: 'EUROPE', group: 'I', kit: { shirt: hx('#1E3A6E'), shorts: WHITE, socks: hx('#1E3A6E'), pattern: 'sleeves', accent: WHITE } },
  { id: 'ger', name: 'GERMANY', short: 'GER', continent: 'EUROPE', group: 'E', kit: { shirt: WHITE, shorts: BLACK, socks: WHITE, pattern: 'sleeves', accent: BLACK } },
  { id: 'esp', name: 'SPAIN', short: 'ESP', continent: 'EUROPE', group: 'H', kit: { shirt: hx('#AA151B'), shorts: hx('#0A285F'), socks: hx('#0A285F'), pattern: 'sleeves', accent: hx('#F1BF00') } },
  { id: 'ned', name: 'NETHERLANDS', short: 'NED', continent: 'EUROPE', group: 'F', kit: { shirt: hx('#FF6900'), shorts: BLACK, socks: hx('#FF6900'), pattern: 'sleeves', accent: WHITE } },
  { id: 'swe', name: 'SWEDEN', short: 'SWE', continent: 'EUROPE', group: 'F', kit: { shirt: hx('#FECC00'), shorts: hx('#005293'), socks: hx('#FECC00'), pattern: 'sleeves', accent: hx('#005293') } },
  { id: 'cze', name: 'CZECHIA', short: 'CZE', continent: 'EUROPE', group: 'A', kit: { shirt: hx('#D7141A'), shorts: hx('#11457E'), socks: hx('#D7141A'), pattern: 'sleeves', accent: WHITE } },
  { id: 'bih', name: 'BOSNIA', short: 'BIH', continent: 'EUROPE', group: 'B', kit: { shirt: hx('#1B1464'), shorts: hx('#1B1464'), socks: hx('#1B1464'), pattern: 'sleeves', accent: hx('#FFD100') } },
  { id: 'sui', name: 'SWITZERLAND', short: 'SUI', continent: 'EUROPE', group: 'B', kit: { shirt: hx('#DA291C'), shorts: WHITE, socks: hx('#DA291C'), pattern: 'sleeves', accent: WHITE } },
  { id: 'sco', name: 'SCOTLAND', short: 'SCO', continent: 'EUROPE', group: 'C', kit: { shirt: hx('#0A285F'), shorts: WHITE, socks: hx('#0A285F'), pattern: 'sleeves', accent: WHITE } },
  { id: 'tur', name: 'TURKEY', short: 'TUR', continent: 'EUROPE', group: 'D', kit: { shirt: hx('#E30A17'), shorts: WHITE, socks: hx('#E30A17'), pattern: 'sleeves', accent: WHITE } },
  { id: 'bel', name: 'BELGIUM', short: 'BEL', continent: 'EUROPE', group: 'G', kit: { shirt: hx('#E30613'), shorts: BLACK, socks: hx('#E30613'), pattern: 'sleeves', accent: hx('#FFE500') } },
  { id: 'nor', name: 'NORWAY', short: 'NOR', continent: 'EUROPE', group: 'I', kit: { shirt: hx('#BA0C2F'), shorts: hx('#00205B'), socks: hx('#BA0C2F'), pattern: 'sleeves', accent: hx('#00205B') } },
  { id: 'aut', name: 'AUSTRIA', short: 'AUT', continent: 'EUROPE', group: 'J', kit: { shirt: hx('#ED2939'), shorts: WHITE, socks: hx('#ED2939'), pattern: 'sleeves', accent: WHITE } },
  { id: 'por', name: 'PORTUGAL', short: 'POR', continent: 'EUROPE', group: 'K', kit: { shirt: hx('#C8102E'), shorts: hx('#006600'), socks: hx('#C8102E'), pattern: 'sleeves', accent: hx('#006600') } },
  { id: 'cro', name: 'CROATIA', short: 'CRO', continent: 'EUROPE', group: 'L', kit: { shirt: WHITE, shorts: hx('#0F3B8C'), socks: WHITE, pattern: 'check', accent: hx('#D2122E') } },
  { id: 'ita', name: 'ITALY', short: 'ITA', continent: 'EUROPE', kit: { shirt: AZZURRI, shorts: WHITE, socks: AZZURRI } },
  { id: 'irl', name: 'IRELAND', short: 'IRL', continent: 'EUROPE', kit: { shirt: GREEN, shorts: WHITE, socks: GREEN } },

  // --- South America (CONMEBOL: 6) ---
  { id: 'bra', name: 'BRAZIL', short: 'BRA', continent: 'S. AMERICA', group: 'C', kit: { shirt: hx('#FFDF00'), shorts: hx('#002776'), socks: WHITE, pattern: 'sleeves', accent: hx('#009C3B') } },
  { id: 'par', name: 'PARAGUAY', short: 'PAR', continent: 'S. AMERICA', group: 'D', kit: { shirt: hx('#D52B1E'), shorts: hx('#0038A8'), socks: WHITE, pattern: 'stripes', accent: WHITE } },
  { id: 'ecu', name: 'ECUADOR', short: 'ECU', continent: 'S. AMERICA', group: 'E', kit: { shirt: hx('#FFD100'), shorts: hx('#003893'), socks: hx('#FFD100'), pattern: 'sleeves', accent: hx('#003893') } },
  { id: 'uru', name: 'URUGUAY', short: 'URU', continent: 'S. AMERICA', group: 'H', kit: { shirt: hx('#5CBFEB'), shorts: BLACK, socks: hx('#5CBFEB'), pattern: 'sleeves', accent: BLACK } },
  { id: 'arg', name: 'ARGENTINA', short: 'ARG', continent: 'S. AMERICA', group: 'J', kit: { shirt: hx('#75AADB'), shorts: hx('#0F3B8C'), socks: WHITE, pattern: 'stripes', accent: WHITE } },
  { id: 'col', name: 'COLOMBIA', short: 'COL', continent: 'S. AMERICA', group: 'K', kit: { shirt: hx('#FCD116'), shorts: hx('#003893'), socks: hx('#FCD116'), pattern: 'sleeves', accent: hx('#003893') } },

  // --- North America (CONCACAF: 3 hosts + 3 qualifiers) ---
  { id: 'mex', name: 'MEXICO', short: 'MEX', continent: 'N. AMERICA', group: 'A', kit: { shirt: hx('#006847'), shorts: WHITE, socks: hx('#006847'), pattern: 'sleeves', accent: WHITE } },
  { id: 'can', name: 'CANADA', short: 'CAN', continent: 'N. AMERICA', group: 'B', kit: { shirt: hx('#FF0000'), shorts: hx('#FF0000'), socks: hx('#FF0000'), pattern: 'sleeves', accent: WHITE } },
  { id: 'hai', name: 'HAITI', short: 'HAI', continent: 'N. AMERICA', group: 'C', kit: { shirt: hx('#00209F'), shorts: hx('#00209F'), socks: hx('#00209F'), pattern: 'sleeves', accent: hx('#D21034') } },
  { id: 'usa', name: 'USA', short: 'USA', continent: 'N. AMERICA', group: 'D', kit: { shirt: WHITE, shorts: hx('#1F2742'), socks: WHITE, pattern: 'sleeves', accent: hx('#1F2742') } },
  { id: 'cuw', name: 'CURACAO', short: 'CUW', continent: 'N. AMERICA', group: 'E', kit: { shirt: hx('#002B7F'), shorts: hx('#002B7F'), socks: hx('#002B7F'), pattern: 'sleeves', accent: hx('#FFD100') } },
  { id: 'pan', name: 'PANAMA', short: 'PAN', continent: 'N. AMERICA', group: 'L', kit: { shirt: hx('#DB0A16'), shorts: hx('#005293'), socks: hx('#DB0A16'), pattern: 'sleeves', accent: hx('#005293') } },

  // --- Africa (CAF: 10 at WC26, + Cameroon/Nigeria who didn't qualify) ---
  { id: 'rsa', name: 'SOUTH AFRICA', short: 'RSA', continent: 'AFRICA', group: 'A', kit: { shirt: hx('#007749'), shorts: WHITE, socks: hx('#007749'), pattern: 'sleeves', accent: hx('#FFB81C') } },
  { id: 'mar', name: 'MOROCCO', short: 'MAR', continent: 'AFRICA', group: 'C', kit: { shirt: hx('#C1272D'), shorts: hx('#C1272D'), socks: hx('#C1272D'), pattern: 'sleeves', accent: hx('#006233') } },
  { id: 'civ', name: 'IVORY COAST', short: 'CIV', continent: 'AFRICA', group: 'E', kit: { shirt: hx('#FF8200'), shorts: hx('#FF8200'), socks: hx('#FF8200'), pattern: 'sleeves', accent: WHITE } },
  { id: 'tun', name: 'TUNISIA', short: 'TUN', continent: 'AFRICA', group: 'F', kit: { shirt: hx('#E70013'), shorts: WHITE, socks: hx('#E70013'), pattern: 'sleeves', accent: WHITE } },
  { id: 'egy', name: 'EGYPT', short: 'EGY', continent: 'AFRICA', group: 'G', kit: { shirt: hx('#CE1126'), shorts: WHITE, socks: hx('#CE1126'), pattern: 'sleeves', accent: WHITE } },
  { id: 'cpv', name: 'CAPE VERDE', short: 'CPV', continent: 'AFRICA', group: 'H', kit: { shirt: hx('#003893'), shorts: WHITE, socks: hx('#003893'), pattern: 'sleeves', accent: WHITE } },
  { id: 'sen', name: 'SENEGAL', short: 'SEN', continent: 'AFRICA', group: 'I', kit: { shirt: WHITE, shorts: WHITE, socks: WHITE, pattern: 'sleeves', accent: hx('#00853F') } },
  { id: 'alg', name: 'ALGERIA', short: 'ALG', continent: 'AFRICA', group: 'J', kit: { shirt: WHITE, shorts: hx('#007229'), socks: WHITE, pattern: 'sleeves', accent: hx('#007229') } },
  { id: 'cod', name: 'DR CONGO', short: 'COD', continent: 'AFRICA', group: 'K', kit: { shirt: hx('#007FFF'), shorts: hx('#007FFF'), socks: hx('#007FFF'), pattern: 'sleeves', accent: hx('#F7D618') } },
  { id: 'gha', name: 'GHANA', short: 'GHA', continent: 'AFRICA', group: 'L', kit: { shirt: WHITE, shorts: hx('#006B3F'), socks: hx('#FCD116'), pattern: 'sleeves', accent: hx('#CE1126') } },
  { id: 'cmr', name: 'CAMEROON', short: 'CMR', continent: 'AFRICA', kit: { shirt: GREEN, shorts: RED, socks: YELLOW } },
  { id: 'nga', name: 'NIGERIA', short: 'NGA', continent: 'AFRICA', kit: { shirt: GREEN, shorts: WHITE, socks: GREEN } },

  // --- Asia (AFC: 8) ---
  { id: 'kor', name: 'S. KOREA', short: 'KOR', continent: 'ASIA', group: 'A', kit: { shirt: hx('#E4002B'), shorts: BLACK, socks: hx('#E4002B'), pattern: 'sleeves', accent: BLACK } },
  { id: 'qat', name: 'QATAR', short: 'QAT', continent: 'ASIA', group: 'B', kit: { shirt: hx('#8A1538'), shorts: WHITE, socks: hx('#8A1538'), pattern: 'sleeves', accent: WHITE } },
  { id: 'jpn', name: 'JAPAN', short: 'JPN', continent: 'ASIA', group: 'F', kit: { shirt: hx('#0A1F6B'), shorts: hx('#0A1F6B'), socks: hx('#0A1F6B'), pattern: 'sleeves', accent: WHITE } },
  { id: 'irn', name: 'IRAN', short: 'IRN', continent: 'ASIA', group: 'G', kit: { shirt: WHITE, shorts: WHITE, socks: WHITE, pattern: 'sleeves', accent: hx('#239F40') } },
  { id: 'ksa', name: 'SAUDI ARABIA', short: 'KSA', continent: 'ASIA', group: 'H', kit: { shirt: WHITE, shorts: WHITE, socks: WHITE, pattern: 'sleeves', accent: hx('#006C35') } },
  { id: 'irq', name: 'IRAQ', short: 'IRQ', continent: 'ASIA', group: 'I', kit: { shirt: hx('#009639'), shorts: WHITE, socks: hx('#009639'), pattern: 'sleeves', accent: WHITE } },
  { id: 'jor', name: 'JORDAN', short: 'JOR', continent: 'ASIA', group: 'J', kit: { shirt: WHITE, shorts: BLACK, socks: WHITE, pattern: 'sleeves', accent: hx('#CE1126') } },
  { id: 'uzb', name: 'UZBEKISTAN', short: 'UZB', continent: 'ASIA', group: 'K', kit: { shirt: WHITE, shorts: WHITE, socks: WHITE, pattern: 'sleeves', accent: hx('#0099B5') } },

  // --- Oceania (Australia AFC / New Zealand OFC, grouped here geographically) ---
  { id: 'aus', name: 'AUSTRALIA', short: 'AUS', continent: 'OCEANIA', group: 'D', kit: { shirt: hx('#FFB81C'), shorts: hx('#00843D'), socks: hx('#FFB81C'), pattern: 'sleeves', accent: hx('#00843D') } },
  { id: 'nzl', name: 'NEW ZEALAND', short: 'NZL', continent: 'OCEANIA', group: 'G', kit: { shirt: WHITE, shorts: BLACK, socks: WHITE, pattern: 'sleeves', accent: BLACK } },
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
