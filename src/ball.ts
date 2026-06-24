// Ball physics: rolling friction, gravity, bounce, spin curl, aftertouch.
// One step == one fixed 60Hz tick (dt in seconds).

import type { Ball } from './state';
import {
  WORLD_W,
  WORLD_H,
  FIELD_T,
  FIELD_B,
  CX,
  GOAL_W,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_BAR_THICK,
} from './world';
import { emitSfx } from './audio';

export const GRAVITY = 360; // px/s^2 on vz (lighter = balls hang longer)
export const BOUNCE = 0.6; // vertical restitution
export const GROUND_FRICTION = 2.2; // per-second velocity decay while rolling
export const AIR_DRAG = 0.15; // light horizontal drag in flight
export const BALL_RADIUS = 1.5;
export const BAR_RESTITUTION = 0.5; // how lively the ball rebounds off the crossbar

// Pitch-condition multipliers, set once per match from the chosen surface (see
// options.ts). >1 friction = a slow/draggy pitch (mud); <1 = slick (ice). These
// are a fixed config for the match, so the seeded sim stays deterministic.
let frictionMul = 1;
let bounceMul = 1;
export function setPitch(friction: number, bounce: number): void {
  frictionMul = friction;
  bounceMul = bounce;
}

export function makeBall(x: number, y: number): Ball {
  return {
    x,
    y,
    z: 0,
    prevX: x,
    prevY: y,
    prevZ: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    spin: 0,
    owner: null,
    aftertouch: 0,
    controlLock: 0,
  };
}

export function ballSpeed(b: Ball): number {
  return Math.hypot(b.vx, b.vy);
}

export function stepBall(b: Ball, dt: number): void {
  b.prevX = b.x;
  b.prevY = b.y;
  b.prevZ = b.z;

  const grounded = b.z <= 0.001 && b.vz <= 0.001;

  // Spin curls the ball: lateral accel perpendicular to travel direction.
  const sp = ballSpeed(b);
  if (Math.abs(b.spin) > 0.001 && sp > 1) {
    const nx = -b.vy / sp;
    const ny = b.vx / sp;
    b.vx += nx * b.spin * dt;
    b.vy += ny * b.spin * dt;
    b.spin *= Math.exp(-1.5 * dt); // spin bleeds off
  }

  if (grounded) {
    // Rolling friction (scaled by the pitch surface).
    const decay = Math.exp(-GROUND_FRICTION * frictionMul * dt);
    b.vx *= decay;
    b.vy *= decay;
    if (Math.hypot(b.vx, b.vy) < 2) {
      b.vx = 0;
      b.vy = 0;
    }
  } else {
    // In flight: gravity + light drag.
    b.vz -= GRAVITY * dt;
    const drag = Math.exp(-AIR_DRAG * dt);
    b.vx *= drag;
    b.vy *= drag;
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;

  // Bounce off the ground.
  if (b.z < 0) {
    b.z = 0;
    if (b.vz < 0) {
      const impact = -b.vz; // downward speed at contact
      b.vz = -b.vz * BOUNCE * bounceMul;
      if (b.vz < 30) b.vz = 0; // settle
      if (impact > 60) emitSfx('bounce', Math.min(1, impact / 300));
    }
  }

  // Keep inside the world bounds (walls of the surrounding area). v1: soft clamp.
  if (b.x < BALL_RADIUS) {
    b.x = BALL_RADIUS;
    b.vx = -b.vx * 0.4;
  } else if (b.x > WORLD_W - BALL_RADIUS) {
    b.x = WORLD_W - BALL_RADIUS;
    b.vx = -b.vx * 0.4;
  }
  if (b.y < BALL_RADIUS) {
    b.y = BALL_RADIUS;
    b.vy = -b.vy * 0.4;
  } else if (b.y > WORLD_H - BALL_RADIUS) {
    b.y = WORLD_H - BALL_RADIUS;
    b.vy = -b.vy * 0.4;
  }

  // Crossbar: a ball reaching the goal line within the mouth at bar height
  // (z within the bar's thickness band) strikes the woodwork and rebounds back
  // into play — instead of scoring (under the bar) or sailing over (above it).
  // Runs before net containment / the match's goal check, so a ball off the bar
  // is back in front of the line by the time those see it.
  {
    let lineY = 0;
    let into = 0; // sign that pushes the ball back into the field
    if (b.prevY >= FIELD_T && b.y < FIELD_T) {
      lineY = FIELD_T;
      into = 1; // field lies at +y from the top goal line
    } else if (b.prevY <= FIELD_B && b.y > FIELD_B) {
      lineY = FIELD_B;
      into = -1; // field lies at -y from the bottom goal line
    }
    if (into !== 0) {
      const barLo = GOAL_HEIGHT;
      const barHi = GOAL_HEIGHT + GOAL_BAR_THICK;
      const f = (lineY - b.prevY) / (b.y - b.prevY); // fraction of the step at the line
      const xCross = b.prevX + (b.x - b.prevX) * f;
      const zCross = b.prevZ + (b.z - b.prevZ) * f;
      if (Math.abs(xCross - CX) < GOAL_W / 2 && zCross >= barLo && zCross <= barHi) {
        const impact = Math.hypot(b.vx, b.vy, b.vz);
        b.x = xCross;
        b.y = lineY + into * (BALL_RADIUS + 1); // sit just in front of the bar
        b.z = barHi; // perched on the bar, about to fall
        b.vy = into * Math.abs(b.vy) * BAR_RESTITUTION; // rebound back into play
        b.vz = -Math.abs(b.vz) * 0.4; // deflect downward off the bar
        b.vx *= 0.7;
        b.spin *= 0.3;
        emitSfx('woodwork', Math.min(1, impact / 280));
      }
    }
  }

  // Net containment: inside the goal mouth (and below the bar), the ball is
  // caught by the netting instead of passing through to the world edge.
  const inMouth = Math.abs(b.x - CX) < GOAL_W / 2;
  if (inMouth && b.z < 18) {
    if (b.y < FIELD_T) {
      const back = FIELD_T - GOAL_DEPTH + 2;
      if (b.y < back) {
        b.y = back;
        b.vy = Math.abs(b.vy) * 0.15; // bounce off the back, downward into net
      }
      b.vx *= 0.8;
      b.vy *= 0.8;
    } else if (b.y > FIELD_B) {
      const back = FIELD_B + GOAL_DEPTH - 2;
      if (b.y > back) {
        b.y = back;
        b.vy = -Math.abs(b.vy) * 0.15;
      }
      b.vx *= 0.8;
      b.vy *= 0.8;
    }
  }

  if (b.aftertouch > 0) b.aftertouch = Math.max(0, b.aftertouch - dt);
  if (b.controlLock > 0) b.controlLock = Math.max(0, b.controlLock - dt);
}

// Apply aftertouch from the held direction during the post-kick window.
// `inX/inY` is the raw held dpad vector (already normalized or zero).
export function applyAftertouch(b: Ball, inX: number, inY: number, dt: number): void {
  if (b.aftertouch <= 0) return;
  const sp = ballSpeed(b);
  if (sp < 10) return;

  const tx = b.vx / sp;
  const ty = b.vy / sp;

  // Perpendicular component of input -> curl (lateral acceleration).
  const perp = inX * -ty + inY * tx; // signed
  const CURL = 900;
  const nx = -ty;
  const ny = tx;
  b.vx += nx * perp * CURL * dt;
  b.vy += ny * perp * CURL * dt;
  // Feed a little into spin so the curve continues after the window closes.
  b.spin += perp * 240 * dt;

  // Parallel component -> loft/dip (only meaningful while airborne).
  const para = inX * tx + inY * ty; // +1 pushing forward, -1 pulling back
  const LOFT = 160;
  b.vz += -para * LOFT * dt; // pull "down" on stick (para<0 if input opposes) -> loft up
}
