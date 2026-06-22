// The eight selectable formations, as the original. Each is 11 slots: one
// keeper plus ten outfielders, positioned in the team's OWN half. x is the
// fraction across the pitch width (0..1); y is the fraction of the own-half
// depth from the own goal line (0 = on the goal line, 1 = the halfway line).
// The AI is slot-driven (it shifts these anchors toward the ball), so swapping
// formations "just works" without touching the behaviour code.

import type { Role } from './state';

export interface Slot {
  x: number;
  y: number;
  role: Role;
}

export type FormationId = '442' | '433' | '352' | '532' | '451' | '541' | 'attack' | 'defence';

const GK: Slot = { x: 0.5, y: 0.04, role: 'gk' };

export const FORMATIONS: Record<FormationId, Slot[]> = {
  '442': [
    GK,
    { x: 0.16, y: 0.2, role: 'def' },
    { x: 0.38, y: 0.17, role: 'def' },
    { x: 0.62, y: 0.17, role: 'def' },
    { x: 0.84, y: 0.2, role: 'def' },
    { x: 0.16, y: 0.48, role: 'mid' },
    { x: 0.38, y: 0.45, role: 'mid' },
    { x: 0.62, y: 0.45, role: 'mid' },
    { x: 0.84, y: 0.48, role: 'mid' },
    { x: 0.36, y: 0.76, role: 'fwd' },
    { x: 0.64, y: 0.76, role: 'fwd' },
  ],
  '433': [
    GK,
    { x: 0.18, y: 0.2, role: 'def' },
    { x: 0.39, y: 0.16, role: 'def' },
    { x: 0.61, y: 0.16, role: 'def' },
    { x: 0.82, y: 0.2, role: 'def' },
    { x: 0.3, y: 0.46, role: 'mid' },
    { x: 0.5, y: 0.42, role: 'mid' },
    { x: 0.7, y: 0.46, role: 'mid' },
    { x: 0.26, y: 0.72, role: 'fwd' },
    { x: 0.5, y: 0.78, role: 'fwd' },
    { x: 0.74, y: 0.72, role: 'fwd' },
  ],
  '352': [
    GK,
    { x: 0.28, y: 0.18, role: 'def' },
    { x: 0.5, y: 0.15, role: 'def' },
    { x: 0.72, y: 0.18, role: 'def' },
    { x: 0.14, y: 0.46, role: 'mid' },
    { x: 0.34, y: 0.5, role: 'mid' },
    { x: 0.5, y: 0.44, role: 'mid' },
    { x: 0.66, y: 0.5, role: 'mid' },
    { x: 0.86, y: 0.46, role: 'mid' },
    { x: 0.38, y: 0.76, role: 'fwd' },
    { x: 0.62, y: 0.76, role: 'fwd' },
  ],
  '532': [
    GK,
    { x: 0.12, y: 0.22, role: 'def' },
    { x: 0.31, y: 0.17, role: 'def' },
    { x: 0.5, y: 0.15, role: 'def' },
    { x: 0.69, y: 0.17, role: 'def' },
    { x: 0.88, y: 0.22, role: 'def' },
    { x: 0.3, y: 0.48, role: 'mid' },
    { x: 0.5, y: 0.45, role: 'mid' },
    { x: 0.7, y: 0.48, role: 'mid' },
    { x: 0.38, y: 0.76, role: 'fwd' },
    { x: 0.62, y: 0.76, role: 'fwd' },
  ],
  '451': [
    GK,
    { x: 0.16, y: 0.2, role: 'def' },
    { x: 0.38, y: 0.17, role: 'def' },
    { x: 0.62, y: 0.17, role: 'def' },
    { x: 0.84, y: 0.2, role: 'def' },
    { x: 0.14, y: 0.48, role: 'mid' },
    { x: 0.34, y: 0.5, role: 'mid' },
    { x: 0.5, y: 0.45, role: 'mid' },
    { x: 0.66, y: 0.5, role: 'mid' },
    { x: 0.86, y: 0.48, role: 'mid' },
    { x: 0.5, y: 0.76, role: 'fwd' },
  ],
  '541': [
    GK,
    { x: 0.12, y: 0.22, role: 'def' },
    { x: 0.31, y: 0.17, role: 'def' },
    { x: 0.5, y: 0.15, role: 'def' },
    { x: 0.69, y: 0.17, role: 'def' },
    { x: 0.88, y: 0.22, role: 'def' },
    { x: 0.18, y: 0.48, role: 'mid' },
    { x: 0.4, y: 0.46, role: 'mid' },
    { x: 0.6, y: 0.46, role: 'mid' },
    { x: 0.82, y: 0.48, role: 'mid' },
    { x: 0.5, y: 0.76, role: 'fwd' },
  ],
  // All-out attack: a high 3-4-3 with everyone pushed up the pitch.
  attack: [
    GK,
    { x: 0.22, y: 0.24, role: 'def' },
    { x: 0.5, y: 0.22, role: 'def' },
    { x: 0.78, y: 0.24, role: 'def' },
    { x: 0.18, y: 0.54, role: 'mid' },
    { x: 0.4, y: 0.52, role: 'mid' },
    { x: 0.6, y: 0.52, role: 'mid' },
    { x: 0.82, y: 0.54, role: 'mid' },
    { x: 0.26, y: 0.84, role: 'fwd' },
    { x: 0.5, y: 0.88, role: 'fwd' },
    { x: 0.74, y: 0.84, role: 'fwd' },
  ],
  // All-out defence: a deep, compact 5-4-1 sitting close to its own goal.
  defence: [
    GK,
    { x: 0.12, y: 0.15, role: 'def' },
    { x: 0.31, y: 0.11, role: 'def' },
    { x: 0.5, y: 0.09, role: 'def' },
    { x: 0.69, y: 0.11, role: 'def' },
    { x: 0.88, y: 0.15, role: 'def' },
    { x: 0.18, y: 0.36, role: 'mid' },
    { x: 0.4, y: 0.34, role: 'mid' },
    { x: 0.6, y: 0.34, role: 'mid' },
    { x: 0.82, y: 0.36, role: 'mid' },
    { x: 0.5, y: 0.62, role: 'fwd' },
  ],
};

// Display order + labels for the pre-match list.
export const FORMATION_IDS: FormationId[] = ['442', '433', '352', '532', '451', '541', 'attack', 'defence'];

export const FORMATION_NAMES: Record<FormationId, string> = {
  '442': '4-4-2',
  '433': '4-3-3',
  '352': '3-5-2',
  '532': '5-3-2',
  '451': '4-5-1',
  '541': '5-4-1',
  attack: 'ALL OUT ATTACK',
  defence: 'ALL OUT DEFENCE',
};

export const DEFAULT_FORMATION: FormationId = '442';
