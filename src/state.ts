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

export type PlayerState = 'idle' | 'run' | 'kick' | 'header' | 'slide' | 'fallen' | 'gkdive';

// Shirt pattern for kit rendering. 'stripes' (vertical) and 'check' only render
// on chest-facing frames (front/back); the pure side view falls back to solid,
// SWOS-style. 'band' is a horizontal accent stripe across the chest (reads on
// every facing) — for flag-banded kits like Germany.
export type KitPattern = 'solid' | 'stripes' | 'check' | 'band';
export type Role = 'gk' | 'def' | 'mid' | 'fwd';

// Per-tick AI duty, assigned by computeDuties() in ai.ts. Transient: recomputed
// every step, never persisted across kickoffs. The duty seam is what lets the
// behaviour set grow toward a fuller tactical model without touching callers.
//   gk      keeper line/clearance logic
//   carrier on the ball: dribble/pass/shoot
//   press   closest defender, runs onto the ball / pressures the carrier
//   cover   second defender, backs up the presser a step behind
//   mark    picks up an opposing attacker, sits goal-side
//   support off-ball attacker making a run to give the carrier an option
//   hold    holds a compact formation point that tracks the ball + goal-side
export type Duty = 'gk' | 'carrier' | 'press' | 'cover' | 'mark' | 'support' | 'hold';

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
  duty: Duty; // transient AI duty for this tick (see Duty)
  markTarget: Player | null; // opponent this player marks when duty === 'mark'
  supportX: number; // best-support-spot target when duty === 'support'
  supportY: number;
  slotX: number; // formation slot, fraction across pitch width (0..1)
  slotY: number; // formation slot, fraction of own-half depth (0..1)
  attacksTop: boolean; // true => attacks the TOP goal this half (set per half)
  homeX: number; // formation anchor in world coords (recomputed each half)
  homeY: number;
  // Transient control state (human).
  charging: boolean; // shot power building while action held
  charge: number; // seconds the action has been held
  bufferedTap: number; // seconds left on a tap buffered during a lock
  pokeTimer: number; // seconds left on an extended-reach standing-tackle poke
  slideCooldown: number; // AI: seconds until this player may attempt another slide
  yellow: boolean; // has been booked once
  sentOff: boolean; // red-carded / second yellow — removed from play
  // Appearance
  kitShirt: RGB;
  kitShorts: RGB;
  kitSocks: RGB;
  kitPattern: KitPattern; // shirt pattern (default 'solid')
  kitAccent: RGB; // second colour for stripes/check/sleeves trim
  hair: RGB;
}

// The match referee. A persistent on-pitch figure that trails play (Kick Off
// style) and is purely cosmetic — the ball and players pass through him. He
// reuses the Player shape so the sprite renderer draws him with no extra code;
// the extra fields drive the card he brandishes at a foul.
export interface Referee extends Player {
  cardTimer: number; // seconds left brandishing a card at a foul (0 = none)
  cardColor: 'yellow' | 'red' | null;
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
  // Second local player's controlled team-1 player (null in one-player mode).
  controlled2: Player | null;
  // Raised by a foul (mistimed slide that hits the player, not the ball); the
  // referee (updateMatch) consumes it to award a free kick / penalty to `team`
  // and judge a card, then clears it. `offender` is the fouling player;
  // `deniedAttack` is true if the victim was the ball carrier (a cynical foul).
  foul: { team: 0 | 1; x: number; y: number; offender: Player; deniedAttack: boolean } | null;
  // Per-team cooldown (seconds) gating how often that team's AI commits a slide
  // tackle, so slides stay occasional rather than constant.
  teamSlideCd: [number, number];
  // The on-pitch referee (trails play; brandishes cards at fouls).
  referee: Referee;
}
