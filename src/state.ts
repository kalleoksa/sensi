// Shared entity/state types. Plain data; behavior lives in ball.ts / player.ts / ai.ts.

import type { RGB } from './sprites/palette';
import type { Camera } from './world';

// 8-way direction. 0=Up, clockwise.
export const Dir = {
  U: 0,
  UR: 1,
  R: 2,
  DR: 3,
  D: 4,
  DL: 5,
  L: 6,
  UL: 7,
} as const;
export type Dir8 = (typeof Dir)[keyof typeof Dir];

// Unit vector per direction (screen/world space; +y is down).
export const DIR_VEC: readonly [number, number][] = [
  [0, -1], // U
  [Math.SQRT1_2, -Math.SQRT1_2], // UR
  [1, 0], // R
  [Math.SQRT1_2, Math.SQRT1_2], // DR
  [0, 1], // D
  [-Math.SQRT1_2, Math.SQRT1_2], // DL
  [-1, 0], // L
  [-Math.SQRT1_2, -Math.SQRT1_2], // UL
];

export function dirFromVec(dx: number, dy: number): Dir8 {
  // Snap an arbitrary vector to the nearest of 8 directions.
  const ang = Math.atan2(dy, dx); // 0 = +x (R)
  // Map so that index 0 == Up. Up is angle -PI/2.
  let oct = Math.round((ang + Math.PI / 2) / (Math.PI / 4)); // 0 == Up
  oct = ((oct % 8) + 8) % 8;
  return oct as Dir8;
}

export type PlayerState = 'idle' | 'run' | 'kick' | 'header' | 'slide' | 'fallen';
export type Role = 'gk' | 'def' | 'mid' | 'fwd';

export interface Player {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  z: number;
  vz: number;
  vx: number;
  vy: number;
  dir: Dir8;
  state: PlayerState;
  stateTimer: number; // seconds remaining of any input-lock
  distance: number; // accumulated travel, drives the run cycle
  team: 0 | 1;
  isHuman: boolean;
  role: Role;
  homeX: number; // formation anchor in world coords
  homeY: number;
  // Transient control state (human).
  charging: boolean; // shot power building while action held
  charge: number; // seconds the action has been held
  bufferedTap: number; // seconds left on a tap buffered during a lock
  // Appearance
  kitShirt: RGB;
  kitShorts: RGB;
  kitSocks: RGB;
  hair: RGB;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number; // lateral curl accel applied during flight
  owner: Player | null; // last/again toucher for possession bookkeeping
  aftertouch: number; // seconds remaining in the aftertouch window
  controlLock: number; // seconds before a player may re-take possession
}

export interface GameState {
  ball: Ball;
  players: Player[];
  camera: Camera;
  // Carrier resolved each step by proximity (dribble model).
  carrier: Player | null;
  // The team-0 player the human currently drives (auto-switches to nearest).
  controlled: Player | null;
}
