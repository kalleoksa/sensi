// Palette sampled from era-correct references (see raw/PLAN.md).
// RGB tuples; helpers below build CSS strings and pixel writes.

export type RGB = readonly [number, number, number];

export const GRASS_L: RGB = [151, 176, 33]; // light diamond band
export const GRASS_D: RGB = [143, 170, 25]; // dark band (keep contrast subtle)
export const GRASS_DD: RGB = [134, 162, 20]; // mottle noise
export const LINE: RGB = [236, 240, 226];
export const POST: RGB = [234, 236, 215];
export const CROSSBAR_UNDER: RGB = [170, 172, 162]; // shaded crossbar underside
export const NET: RGB = [150, 152, 146];
export const NET_BG: RGB = [71, 106, 4];
export const SHADOW: RGB = [86, 120, 8]; // all cast shadows, checkered 50%

export const SKIN: RGB = [235, 178, 122];
export const BLACK: RGB = [20, 20, 20];
export const WHITE: RGB = [238, 238, 232];

// Hair variants
export const HAIR_DARK: RGB = [40, 32, 30];
export const HAIR_BLOND: RGB = [222, 186, 80];
export const HAIR_GINGER: RGB = [170, 90, 30];

// Default team kit template colors (recolored per-team via palette swap).
export const KIT_RED: RGB = [199, 60, 32];
export const KIT_BLUE: RGB = [44, 80, 200];

export function css(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
