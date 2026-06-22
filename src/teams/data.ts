// Team definitions for the Friendly flow. Phase 1 ships ~16 real-style nations
// with authentic-ish kit colours and no individual player rosters yet. Teams
// are grouped by continent so the team-select screen can browse them
// hierarchically (continent -> nation).

import type { RGB } from '../sprites/palette';

export interface Kit {
  shirt: RGB;
  shorts: RGB;
  socks: RGB;
}

export type Continent = 'EUROPE' | 'S. AMERICA' | 'N. AMERICA' | 'AFRICA';

export interface TeamDef {
  id: string;
  name: string; // shown in lists, uppercase to suit the font
  short: string; // 3-letter tag for compact spots
  continent: Continent;
  kit: Kit;
  gkKit?: Kit; // defaults to DEFAULT_GK_KIT
}

const rgb = (r: number, g: number, b: number): RGB => [r, g, b];

// Common colours reused across kits.
const WHITE = rgb(238, 238, 232);
const NAVY = rgb(26, 38, 88);
const RED = rgb(196, 46, 38);
const GREEN = rgb(28, 140, 64);
const YELLOW = rgb(240, 206, 44);
const BLUE = rgb(44, 86, 196);
const SKY = rgb(120, 180, 232);
const ORANGE = rgb(234, 120, 24);
const BLACK = rgb(30, 30, 34);

// Keepers wear this unless a team overrides it (distinct green so they read
// apart from outfielders, matching the previous hard-coded keeper kit).
export const DEFAULT_GK_KIT: Kit = { shirt: rgb(40, 150, 78), shorts: BLACK, socks: BLACK };

export const TEAMS: TeamDef[] = [
  // --- Europe ---
  { id: 'eng', name: 'ENGLAND', short: 'ENG', continent: 'EUROPE', kit: { shirt: WHITE, shorts: NAVY, socks: WHITE } },
  { id: 'fra', name: 'FRANCE', short: 'FRA', continent: 'EUROPE', kit: { shirt: BLUE, shorts: WHITE, socks: RED } },
  { id: 'ger', name: 'GERMANY', short: 'GER', continent: 'EUROPE', kit: { shirt: WHITE, shorts: BLACK, socks: WHITE } },
  { id: 'ita', name: 'ITALY', short: 'ITA', continent: 'EUROPE', kit: { shirt: SKY, shorts: WHITE, socks: SKY } },
  { id: 'esp', name: 'SPAIN', short: 'ESP', continent: 'EUROPE', kit: { shirt: RED, shorts: NAVY, socks: NAVY } },
  { id: 'ned', name: 'NETHERLANDS', short: 'NED', continent: 'EUROPE', kit: { shirt: ORANGE, shorts: WHITE, socks: ORANGE } },
  { id: 'swe', name: 'SWEDEN', short: 'SWE', continent: 'EUROPE', kit: { shirt: YELLOW, shorts: BLUE, socks: YELLOW } },
  { id: 'irl', name: 'IRELAND', short: 'IRL', continent: 'EUROPE', kit: { shirt: GREEN, shorts: WHITE, socks: GREEN } },

  // --- South America ---
  { id: 'bra', name: 'BRAZIL', short: 'BRA', continent: 'S. AMERICA', kit: { shirt: YELLOW, shorts: BLUE, socks: WHITE } },
  { id: 'arg', name: 'ARGENTINA', short: 'ARG', continent: 'S. AMERICA', kit: { shirt: SKY, shorts: NAVY, socks: WHITE } },
  { id: 'uru', name: 'URUGUAY', short: 'URU', continent: 'S. AMERICA', kit: { shirt: SKY, shorts: BLACK, socks: BLACK } },
  { id: 'col', name: 'COLOMBIA', short: 'COL', continent: 'S. AMERICA', kit: { shirt: YELLOW, shorts: NAVY, socks: RED } },

  // --- North America ---
  { id: 'usa', name: 'USA', short: 'USA', continent: 'N. AMERICA', kit: { shirt: WHITE, shorts: NAVY, socks: RED } },
  { id: 'mex', name: 'MEXICO', short: 'MEX', continent: 'N. AMERICA', kit: { shirt: GREEN, shorts: WHITE, socks: RED } },

  // --- Africa ---
  { id: 'cmr', name: 'CAMEROON', short: 'CMR', continent: 'AFRICA', kit: { shirt: GREEN, shorts: RED, socks: YELLOW } },
  { id: 'nga', name: 'NIGERIA', short: 'NGA', continent: 'AFRICA', kit: { shirt: GREEN, shorts: WHITE, socks: GREEN } },
];

// Continents that actually have teams, in display order.
export const CONTINENTS: Continent[] = ['EUROPE', 'S. AMERICA', 'N. AMERICA', 'AFRICA'];

export function teamsIn(c: Continent): TeamDef[] {
  return TEAMS.filter((t) => t.continent === c);
}
