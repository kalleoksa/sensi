// Match options exposed on the Options screen: game length and pitch surface.
// Pitch surfaces carry physics multipliers applied via ball.setPitch() at
// kickoff (friction >1 = slow/draggy, <1 = slick; bounce scales restitution),
// and a grass tint baked into the pitch so each surface also looks distinct
// (see pitch_gen.bakePitch).

import type { RGB } from './sprites/palette';

export interface MatchLength {
  label: string;
  half: number; // seconds per half
}

// Total match minutes -> seconds per half (two halves). 3 min = 90s/half, the
// previous default.
export const MATCH_LENGTHS: MatchLength[] = [
  { label: '3 MIN', half: 90 },
  { label: '5 MIN', half: 150 },
  { label: '7 MIN', half: 210 },
  { label: '10 MIN', half: 300 },
];

// Grass recolor: each base grass color is scaled by `bright` then blended
// `amt` (0..1) toward `toward`. This preserves the subtle ~3-tone band/mottle
// delta (it's applied to all three grass tones equally) while shifting the
// overall hue/value. Omit `tint` to keep the default lush green (NORMAL).
export interface GrassTint {
  toward: RGB; // target color the grass blends toward
  amt: number; // blend strength, 0 (no shift) .. 1 (full target)
  bright: number; // brightness scale applied before the blend
}

export interface Pitch {
  name: string;
  friction: number; // x GROUND_FRICTION
  bounce: number; // x BOUNCE
  tint?: GrassTint; // grass recolor; absent = default green
}

// Surfaces follow the SWOS pitch conditions both in feel and look:
// DRY/HARD bleach toward pale straw, WET/SOFT deepen to a rich green, ICY
// frosts toward blue-white, MUDDY churns to brown.
export const PITCHES: Pitch[] = [
  { name: 'NORMAL', friction: 1.0, bounce: 1.0 },
  { name: 'DRY', friction: 0.85, bounce: 1.08, tint: { toward: [202, 206, 120], amt: 0.32, bright: 1.05 } },
  { name: 'HARD', friction: 0.78, bounce: 1.2, tint: { toward: [188, 192, 116], amt: 0.24, bright: 1.09 } },
  { name: 'WET', friction: 0.68, bounce: 1.05, tint: { toward: [58, 118, 30], amt: 0.32, bright: 0.9 } },
  { name: 'ICY', friction: 0.45, bounce: 1.15, tint: { toward: [205, 218, 225], amt: 0.6, bright: 1.1 } },
  { name: 'SOFT', friction: 1.18, bounce: 0.82, tint: { toward: [70, 135, 35], amt: 0.24, bright: 0.95 } },
  { name: 'MUDDY', friction: 1.7, bounce: 0.55, tint: { toward: [100, 68, 36], amt: 0.62, bright: 0.82 } },
];

// The Options screen edits these indices; the app resolves them into a
// MatchConfig at launch.
export interface MatchOptions {
  lengthIndex: number;
  pitchIndex: number;
}

export const DEFAULT_OPTIONS: MatchOptions = { lengthIndex: 0, pitchIndex: 0 };
