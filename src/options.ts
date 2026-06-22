// Match options exposed on the Options screen: game length and pitch surface.
// Pitch surfaces carry physics multipliers applied via ball.setPitch() at
// kickoff (friction >1 = slow/draggy, <1 = slick; bounce scales restitution).

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

export interface Pitch {
  name: string;
  friction: number; // x GROUND_FRICTION
  bounce: number; // x BOUNCE
}

export const PITCHES: Pitch[] = [
  { name: 'NORMAL', friction: 1.0, bounce: 1.0 },
  { name: 'DRY', friction: 0.85, bounce: 1.08 },
  { name: 'HARD', friction: 0.78, bounce: 1.2 },
  { name: 'WET', friction: 0.68, bounce: 1.05 },
  { name: 'ICY', friction: 0.45, bounce: 1.15 },
  { name: 'SOFT', friction: 1.18, bounce: 0.82 },
  { name: 'MUDDY', friction: 1.7, bounce: 0.55 },
];

// The Options screen edits these indices; the app resolves them into a
// MatchConfig at launch.
export interface MatchOptions {
  lengthIndex: number;
  pitchIndex: number;
}

export const DEFAULT_OPTIONS: MatchOptions = { lengthIndex: 0, pitchIndex: 0 };
