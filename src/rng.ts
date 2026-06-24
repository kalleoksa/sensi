// Single seeded PRNG so the whole sim is deterministic.
// mulberry32 — fast, good enough for gameplay variation.

export interface Rng {
  next(): number; // [0, 1)
  range(min: number, max: number): number;
  int(min: number, max: number): number; // inclusive
  pick<T>(arr: readonly T[]): T;
  getState(): number; // current internal state (to serialise a save game)
  setState(n: number): void; // restore a saved state
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    getState: () => a >>> 0,
    setState: (n) => {
      a = n >>> 0;
    },
  };
}

// Stable per-pixel hash for world-space grass mottle (matches run_anim.py).
export function pixelHash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = (Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0;
  return h;
}
