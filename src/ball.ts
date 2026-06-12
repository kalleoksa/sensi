// Ball physics: rolling friction, gravity, bounce, spin curl, aftertouch.
// One step == one fixed 60Hz tick (dt in seconds).

import type { Ball } from './state';
import { WORLD_W, WORLD_H } from './world';

export const GRAVITY = 520; // px/s^2 on vz
export const BOUNCE = 0.6; // vertical restitution
export const GROUND_FRICTION = 2.2; // per-second velocity decay while rolling
export const AIR_DRAG = 0.15; // light horizontal drag in flight
export const BALL_RADIUS = 1.5;

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
    // Rolling friction.
    const decay = Math.exp(-GROUND_FRICTION * dt);
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
      b.vz = -b.vz * BOUNCE;
      if (b.vz < 30) b.vz = 0; // settle
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
