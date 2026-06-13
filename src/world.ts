// Pitch dimensions, world<->screen transform, and the ball-following camera.
// World units == game pixels. The pitch plays vertically (goals top & bottom).

// The camera window, in game pixels. Mutable so mobile can widen/heighten it to
// match the device aspect (see setViewport); importers read the live binding.
export let VIEW_W = 320;
export let VIEW_H = 280;

// Resize the camera window. The pitch is baked at world size and blitted at the
// camera offset, so a larger view simply reveals more of it — no other changes.
export function setViewport(w: number, h: number): void {
  VIEW_W = w;
  VIEW_H = h;
}

// Playing field (touchline to touchline, goal line to goal line).
// FIFA standard pitch is 105 m x 68 m (1.544:1). Keep the width and derive the
// length from that ratio: 256 * 105/68 ≈ 396. (The marking depths below are
// absolute real-world sizes, e.g. the 16.5 m penalty box, and read correctly
// against this length.)
export const PLAY_W = 256;
export const PLAY_H = 396;
export const BORDER = 48; // run-off / crowd margin around the field

export const WORLD_W = PLAY_W + BORDER * 2; // 352
export const WORLD_H = PLAY_H + BORDER * 2; // 816

// Field rectangle in world space.
export const FIELD_L = BORDER;
export const FIELD_R = BORDER + PLAY_W;
export const FIELD_T = BORDER;
export const FIELD_B = BORDER + PLAY_H;
export const CX = BORDER + PLAY_W / 2; // pitch center x

// Markings geometry (depths measured from the nearest goal line).
export const GOAL_W = 64;
export const GOAL_DEPTH = 24; // visual 3D depth of the goal off the line
export const PEN_BOX_W = 160;
export const PEN_BOX_D = 62;
export const SIX_BOX_W = 88;
export const SIX_BOX_D = 22;
export const PEN_SPOT_D = 42;
export const CENTER_R = 52;
export const D_ARC_R = 36;
export const CORNER_R = 8;

export interface Camera {
  x: number; // world coord of view top-left
  y: number;
}

export function makeCamera(): Camera {
  return { x: (WORLD_W - VIEW_W) / 2, y: (WORLD_H - VIEW_H) / 2 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Follow a target with lookahead in the travel direction; clamp to world.
export function updateCamera(
  cam: Camera,
  targetX: number,
  targetY: number,
  velX: number,
  velY: number,
  dt: number,
): void {
  const lookahead = 14;
  const sp = Math.hypot(velX, velY);
  const lx = sp > 1 ? (velX / sp) * lookahead : 0;
  const ly = sp > 1 ? (velY / sp) * lookahead : 0;
  const desiredX = targetX + lx - VIEW_W / 2;
  const desiredY = targetY + ly - VIEW_H / 2;
  // Critically-damped-ish smoothing toward the desired top-left.
  const k = 1 - Math.exp(-8 * dt);
  cam.x += (desiredX - cam.x) * k;
  cam.y += (desiredY - cam.y) * k;
  cam.x = clamp(cam.x, 0, WORLD_W - VIEW_W);
  cam.y = clamp(cam.y, 0, WORLD_H - VIEW_H);
}
