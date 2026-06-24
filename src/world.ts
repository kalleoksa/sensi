// Pitch dimensions, world<->screen transform, and the ball-following camera.
// World units == game pixels. The pitch plays vertically (goals top & bottom).

// Internal render buffer (crisp-scaled to the window). Sized so the camera
// shows the full pitch width plus most of its length — the zoomed-out SWOS read
// where the 12px players sit small against the markings.
export const VIEW_W = 384;
export const VIEW_H = 320;

// Playing field (touchline to touchline, goal line to goal line).
// Aspect matches SWOS's measured proportions (~1.25:1 length:width) rather than
// a real pitch (1.54:1) or the old elongated 2.81:1 corridor.
// Sized so the markings fill the view the way they do in SWOS (pen box ~62% of
// the 320px-wide view) — the pitch is larger than the viewport in both axes, so
// the fixed 12px players read small against it and the camera scrolls a window.
export const PLAY_W = 352;
export const PLAY_H = 440; // 1.25:1; camera shows a scrolling window, not the whole pitch
export const BORDER = 48; // run-off / crowd margin around the field

export const WORLD_W = PLAY_W + BORDER * 2; // 448
export const WORLD_H = PLAY_H + BORDER * 2; // 536

// Field rectangle in world space.
export const FIELD_L = BORDER;
export const FIELD_R = BORDER + PLAY_W;
export const FIELD_T = BORDER;
export const FIELD_B = BORDER + PLAY_H;
export const CX = BORDER + PLAY_W / 2; // pitch center x

// Markings geometry (depths measured from the nearest goal line). Proportions
// follow SWOS: goal ~14% of pitch width, pen box ~57%, six-yard ~24.5%; the
// penalty box runs ~14% of pitch length deep.
export const GOAL_W = 48;
export const GOAL_DEPTH = 20; // visual 3D depth of the goal off the line
export const PEN_BOX_W = 200;
export const PEN_BOX_D = 60;
export const SIX_BOX_W = 86;
export const SIX_BOX_D = 20;
export const PEN_SPOT_D = 38;
export const CENTER_R = 48;
export const D_ARC_R = 48;
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
