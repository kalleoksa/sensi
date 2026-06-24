// National team definitions. The 48-team 2026 World Cup field (tagged with its
// real Group A–L draw) plus a few non-qualified nations kept for Friendly /
// League / Cup. Teams are grouped by continent so the team-select screen can
// browse them hierarchically (continent -> nation). Kit colours are an accurate
// first pass of each home strip; striped/checked patterns (Argentina, Croatia,
// Paraguay…) are rendered as their dominant solid colour for now.

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

// Shared kit colours. Distinct shades where real kits differ (e.g. Argentina's
// sky vs Italy's azzurri vs Uruguay's celeste).
const WHITE = rgb(238, 238, 232);
const BLACK = rgb(30, 30, 34);
const NAVY = rgb(26, 38, 88);
const RED = rgb(200, 38, 40);
const SPAIN_RED = rgb(170, 21, 27); // Spain's crimson (flag/kit #AA151B)
const CRIMSON = rgb(150, 28, 40); // deep red (Portugal)
const MAROON = rgb(122, 26, 48); // Qatar
const GREEN = rgb(28, 140, 64);
const DKGREEN = rgb(14, 98, 50);
const YELLOW = rgb(240, 206, 44);
const GOLD = rgb(250, 196, 30); // South Africa, Australia
const BRA_YELLOW = rgb(246, 214, 30); // Brazil
const BLUE = rgb(44, 86, 196);
const ROYAL = rgb(22, 66, 158);
const SKY = rgb(110, 178, 232); // Argentina, DR Congo
const CELESTE = rgb(96, 158, 214); // Uruguay
const AZZURRI = rgb(34, 92, 170); // Italy
const DEEPBLUE = rgb(22, 44, 112); // Japan
const FR_BLUE = rgb(38, 58, 142); // France
const ORANGE = rgb(236, 112, 20);

// Keepers wear this unless a team overrides it (distinct green so they read
// apart from outfielders, matching the previous hard-coded keeper kit).
export const DEFAULT_GK_KIT: Kit = { shirt: rgb(40, 150, 78), shorts: BLACK, socks: BLACK };

export const TEAMS: TeamDef[] = [
  // --- Europe (UEFA: 16 at WC26, + Italy/Ireland who didn't qualify) ---
  { id: 'eng', name: 'ENGLAND', short: 'ENG', continent: 'EUROPE', group: 'L', kit: { shirt: WHITE, shorts: NAVY, socks: WHITE } },
  { id: 'fra', name: 'FRANCE', short: 'FRA', continent: 'EUROPE', group: 'I', kit: { shirt: FR_BLUE, shorts: WHITE, socks: RED } },
  { id: 'ger', name: 'GERMANY', short: 'GER', continent: 'EUROPE', group: 'E', kit: { shirt: WHITE, shorts: BLACK, socks: WHITE } },
  { id: 'esp', name: 'SPAIN', short: 'ESP', continent: 'EUROPE', group: 'H', kit: { shirt: SPAIN_RED, shorts: NAVY, socks: NAVY } },
  { id: 'ned', name: 'NETHERLANDS', short: 'NED', continent: 'EUROPE', group: 'F', kit: { shirt: ORANGE, shorts: WHITE, socks: ORANGE } },
  { id: 'swe', name: 'SWEDEN', short: 'SWE', continent: 'EUROPE', group: 'F', kit: { shirt: YELLOW, shorts: BLUE, socks: YELLOW } },
  { id: 'cze', name: 'CZECHIA', short: 'CZE', continent: 'EUROPE', group: 'A', kit: { shirt: RED, shorts: WHITE, socks: BLUE } },
  { id: 'bih', name: 'BOSNIA', short: 'BIH', continent: 'EUROPE', group: 'B', kit: { shirt: ROYAL, shorts: ROYAL, socks: ROYAL } },
  { id: 'sui', name: 'SWITZERLAND', short: 'SUI', continent: 'EUROPE', group: 'B', kit: { shirt: RED, shorts: WHITE, socks: RED } },
  { id: 'sco', name: 'SCOTLAND', short: 'SCO', continent: 'EUROPE', group: 'C', kit: { shirt: NAVY, shorts: NAVY, socks: NAVY } },
  { id: 'tur', name: 'TURKEY', short: 'TUR', continent: 'EUROPE', group: 'D', kit: { shirt: RED, shorts: WHITE, socks: RED } },
  { id: 'bel', name: 'BELGIUM', short: 'BEL', continent: 'EUROPE', group: 'G', kit: { shirt: RED, shorts: BLACK, socks: RED } },
  { id: 'nor', name: 'NORWAY', short: 'NOR', continent: 'EUROPE', group: 'I', kit: { shirt: RED, shorts: WHITE, socks: NAVY } },
  { id: 'aut', name: 'AUSTRIA', short: 'AUT', continent: 'EUROPE', group: 'J', kit: { shirt: RED, shorts: WHITE, socks: RED } },
  { id: 'por', name: 'PORTUGAL', short: 'POR', continent: 'EUROPE', group: 'K', kit: { shirt: CRIMSON, shorts: DKGREEN, socks: CRIMSON } },
  { id: 'cro', name: 'CROATIA', short: 'CRO', continent: 'EUROPE', group: 'L', kit: { shirt: WHITE, shorts: NAVY, socks: WHITE, pattern: 'check', accent: RED } },
  { id: 'ita', name: 'ITALY', short: 'ITA', continent: 'EUROPE', kit: { shirt: AZZURRI, shorts: WHITE, socks: AZZURRI } },
  { id: 'irl', name: 'IRELAND', short: 'IRL', continent: 'EUROPE', kit: { shirt: GREEN, shorts: WHITE, socks: GREEN } },

  // --- South America (CONMEBOL: 6) ---
  { id: 'bra', name: 'BRAZIL', short: 'BRA', continent: 'S. AMERICA', group: 'C', kit: { shirt: BRA_YELLOW, shorts: NAVY, socks: WHITE, pattern: 'sleeves', accent: GREEN } },
  { id: 'par', name: 'PARAGUAY', short: 'PAR', continent: 'S. AMERICA', group: 'D', kit: { shirt: RED, shorts: NAVY, socks: NAVY, pattern: 'stripes', accent: WHITE } },
  { id: 'ecu', name: 'ECUADOR', short: 'ECU', continent: 'S. AMERICA', group: 'E', kit: { shirt: YELLOW, shorts: NAVY, socks: RED } },
  { id: 'uru', name: 'URUGUAY', short: 'URU', continent: 'S. AMERICA', group: 'H', kit: { shirt: CELESTE, shorts: BLACK, socks: BLACK } },
  { id: 'arg', name: 'ARGENTINA', short: 'ARG', continent: 'S. AMERICA', group: 'J', kit: { shirt: SKY, shorts: NAVY, socks: WHITE, pattern: 'stripes', accent: WHITE } },
  { id: 'col', name: 'COLOMBIA', short: 'COL', continent: 'S. AMERICA', group: 'K', kit: { shirt: YELLOW, shorts: NAVY, socks: RED } },

  // --- North America (CONCACAF: 3 hosts + 3 qualifiers) ---
  { id: 'mex', name: 'MEXICO', short: 'MEX', continent: 'N. AMERICA', group: 'A', kit: { shirt: GREEN, shorts: WHITE, socks: RED } },
  { id: 'can', name: 'CANADA', short: 'CAN', continent: 'N. AMERICA', group: 'B', kit: { shirt: RED, shorts: WHITE, socks: RED } },
  { id: 'hai', name: 'HAITI', short: 'HAI', continent: 'N. AMERICA', group: 'C', kit: { shirt: ROYAL, shorts: BLACK, socks: RED } },
  { id: 'usa', name: 'USA', short: 'USA', continent: 'N. AMERICA', group: 'D', kit: { shirt: WHITE, shorts: NAVY, socks: WHITE } },
  { id: 'cuw', name: 'CURACAO', short: 'CUW', continent: 'N. AMERICA', group: 'E', kit: { shirt: ROYAL, shorts: ROYAL, socks: YELLOW } },
  { id: 'pan', name: 'PANAMA', short: 'PAN', continent: 'N. AMERICA', group: 'L', kit: { shirt: RED, shorts: WHITE, socks: NAVY } },

  // --- Africa (CAF: 10 at WC26, + Cameroon/Nigeria who didn't qualify) ---
  { id: 'rsa', name: 'SOUTH AFRICA', short: 'RSA', continent: 'AFRICA', group: 'A', kit: { shirt: GOLD, shorts: DKGREEN, socks: DKGREEN } },
  { id: 'mar', name: 'MOROCCO', short: 'MAR', continent: 'AFRICA', group: 'C', kit: { shirt: RED, shorts: DKGREEN, socks: RED } },
  { id: 'civ', name: 'IVORY COAST', short: 'CIV', continent: 'AFRICA', group: 'E', kit: { shirt: ORANGE, shorts: WHITE, socks: DKGREEN } },
  { id: 'tun', name: 'TUNISIA', short: 'TUN', continent: 'AFRICA', group: 'F', kit: { shirt: RED, shorts: WHITE, socks: RED } },
  { id: 'egy', name: 'EGYPT', short: 'EGY', continent: 'AFRICA', group: 'G', kit: { shirt: RED, shorts: WHITE, socks: BLACK } },
  { id: 'cpv', name: 'CAPE VERDE', short: 'CPV', continent: 'AFRICA', group: 'H', kit: { shirt: ROYAL, shorts: WHITE, socks: ROYAL } },
  { id: 'sen', name: 'SENEGAL', short: 'SEN', continent: 'AFRICA', group: 'I', kit: { shirt: WHITE, shorts: DKGREEN, socks: RED } },
  { id: 'alg', name: 'ALGERIA', short: 'ALG', continent: 'AFRICA', group: 'J', kit: { shirt: WHITE, shorts: DKGREEN, socks: WHITE } },
  { id: 'cod', name: 'DR CONGO', short: 'COD', continent: 'AFRICA', group: 'K', kit: { shirt: SKY, shorts: ROYAL, socks: SKY } },
  { id: 'gha', name: 'GHANA', short: 'GHA', continent: 'AFRICA', group: 'L', kit: { shirt: WHITE, shorts: WHITE, socks: RED } },
  { id: 'cmr', name: 'CAMEROON', short: 'CMR', continent: 'AFRICA', kit: { shirt: GREEN, shorts: RED, socks: YELLOW } },
  { id: 'nga', name: 'NIGERIA', short: 'NGA', continent: 'AFRICA', kit: { shirt: GREEN, shorts: WHITE, socks: GREEN } },

  // --- Asia (AFC: 8) ---
  { id: 'kor', name: 'S. KOREA', short: 'KOR', continent: 'ASIA', group: 'A', kit: { shirt: RED, shorts: BLACK, socks: RED } },
  { id: 'qat', name: 'QATAR', short: 'QAT', continent: 'ASIA', group: 'B', kit: { shirt: MAROON, shorts: WHITE, socks: MAROON } },
  { id: 'jpn', name: 'JAPAN', short: 'JPN', continent: 'ASIA', group: 'F', kit: { shirt: DEEPBLUE, shorts: DEEPBLUE, socks: DEEPBLUE } },
  { id: 'irn', name: 'IRAN', short: 'IRN', continent: 'ASIA', group: 'G', kit: { shirt: WHITE, shorts: WHITE, socks: RED } },
  { id: 'ksa', name: 'SAUDI ARABIA', short: 'KSA', continent: 'ASIA', group: 'H', kit: { shirt: WHITE, shorts: WHITE, socks: DKGREEN } },
  { id: 'irq', name: 'IRAQ', short: 'IRQ', continent: 'ASIA', group: 'I', kit: { shirt: DKGREEN, shorts: WHITE, socks: DKGREEN } },
  { id: 'jor', name: 'JORDAN', short: 'JOR', continent: 'ASIA', group: 'J', kit: { shirt: RED, shorts: WHITE, socks: RED } },
  { id: 'uzb', name: 'UZBEKISTAN', short: 'UZB', continent: 'ASIA', group: 'K', kit: { shirt: ROYAL, shorts: WHITE, socks: ROYAL } },

  // --- Oceania (Australia AFC / New Zealand OFC, grouped here geographically) ---
  { id: 'aus', name: 'AUSTRALIA', short: 'AUS', continent: 'OCEANIA', group: 'D', kit: { shirt: GOLD, shorts: DKGREEN, socks: GOLD } },
  { id: 'nzl', name: 'NEW ZEALAND', short: 'NZL', continent: 'OCEANIA', group: 'G', kit: { shirt: WHITE, shorts: WHITE, socks: BLACK } },
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
