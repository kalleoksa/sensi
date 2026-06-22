// Pre-bakes the full pitch into one offscreen canvas: world-space mottled grass,
// white markings (both halves mirrored), and the goals' cast shadows.
// The goal *frames* (posts + net) are returned separately so the renderer can
// draw them on top of entities (the net must occlude the ball).

import { pixelHash } from '../rng';
import type { Pitch, GrassTint } from '../options';
import {
  GRASS_L,
  GRASS_D,
  GRASS_DD,
  LINE,
  POST,
  CROSSBAR_UNDER,
  NET,
  NET_BG,
  NET_WALL,
  NET_WALL_DOT,
  SHADOW,
  type RGB,
} from './palette';
import {
  WORLD_W,
  WORLD_H,
  FIELD_L,
  FIELD_R,
  FIELD_T,
  FIELD_B,
  CX,
  GOAL_W,
  GOAL_DEPTH,
  PEN_BOX_W,
  PEN_BOX_D,
  SIX_BOX_W,
  SIX_BOX_D,
  PEN_SPOT_D,
  CENTER_R,
  D_ARC_R,
  CORNER_R,
} from '../world';

export interface GoalFrame {
  canvas: HTMLCanvasElement; // frame pixels with alpha (net + posts)
  ox: number; // world x of canvas top-left
  oy: number; // world y of canvas top-left
}

export interface BakedPitch {
  canvas: HTMLCanvasElement;
  goalTop: GoalFrame;
  goalBottom: GoalFrame;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// --- ImageData pixel helpers ---------------------------------------------

class Buf {
  data: Uint8ClampedArray;
  constructor(public w: number, public h: number, img: ImageData) {
    this.data = img.data;
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
}

function hline(b: Buf, x0: number, x1: number, y: number, c: RGB): void {
  for (let x = x0; x <= x1; x++) b.set(x, y, c);
}
function vline(b: Buf, x: number, y0: number, y1: number, c: RGB): void {
  for (let y = y0; y <= y1; y++) b.set(x, y, c);
}

// --- Goal geometry (shared by shadow baking and frame canvases) -----------

interface GoalPixel {
  x: number;
  y: number;
  z: number; // height above the goal-line footprint
  c: RGB;
}

// Build the solid pixels of a goal. `top` => goal on the top line, structure
// extends off-field toward -y; otherwise bottom line, extends toward +y.
function goalSolids(top: boolean): GoalPixel[] {
  const out: GoalPixel[] = [];
  const gx0 = Math.round(CX - GOAL_W / 2);
  const gx1 = Math.round(CX + GOAL_W / 2);
  const lineY = top ? FIELD_T : FIELD_B;
  // y as a function of depth d (0 at the line, GOAL_DEPTH at the back).
  const yAt = (d: number) => (top ? lineY - d : lineY + d);

  // Net fills depths (0, GOAL_DEPTH) with a 3D read: the part near the back
  // (toward the crossbar) is the lit back wall (light gray dot grid); the part
  // toward the mouth is the net floor receding away (dark green, sparse dots).
  const wallStart = GOAL_DEPTH * 0.5;
  for (let d = 1; d < GOAL_DEPTH; d++) {
    const y = yAt(d);
    for (let x = gx0; x <= gx1; x++) {
      let c: RGB;
      if (d >= wallStart) {
        c = x % 2 === 0 && y % 2 === 0 ? NET_WALL_DOT : NET_WALL;
      } else {
        c = x % 2 === 0 && y % 2 === 0 ? NET : NET_BG;
      }
      out.push({ x, y, z: d, c });
    }
  }
  // Side posts (2px each side), full depth.
  for (let d = 0; d <= GOAL_DEPTH; d++) {
    const y = yAt(d);
    out.push({ x: gx0, y, z: d, c: POST });
    out.push({ x: gx0 + 1, y, z: d, c: POST });
    out.push({ x: gx1 - 1, y, z: d, c: POST });
    out.push({ x: gx1, y, z: d, c: POST });
  }
  // Crossbar at the back (max depth): 3px, shaded underside facing the field.
  const dBack = GOAL_DEPTH;
  const dUnder = top ? GOAL_DEPTH - 2 : GOAL_DEPTH - 2;
  for (let x = gx0; x <= gx1; x++) {
    out.push({ x, y: yAt(dBack), z: dBack, c: POST });
    out.push({ x, y: yAt(dBack - 1), z: dBack - 1, c: POST });
    out.push({ x, y: yAt(dUnder), z: dUnder, c: CROSSBAR_UNDER });
  }
  return out;
}

function bakeGoalFrame(top: boolean): GoalFrame {
  const pad = 1;
  const gx0 = Math.round(CX - GOAL_W / 2) - pad;
  const gx1 = Math.round(CX + GOAL_W / 2) + pad;
  const y0 = top ? FIELD_T - GOAL_DEPTH - pad : FIELD_B - pad;
  const y1 = top ? FIELD_T + pad : FIELD_B + GOAL_DEPTH + pad;
  const w = gx1 - gx0 + 1;
  const h = y1 - y0 + 1;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const b = new Buf(w, h, img);
  for (const px of goalSolids(top)) {
    b.set(px.x - gx0, px.y - y0, px.c);
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, ox: gx0, oy: y0 };
}

// --- Pitch baking ---------------------------------------------------------

function bakeShadows(b: Buf): void {
  for (const top of [true, false]) {
    for (const px of goalSolids(top)) {
      const z = px.z;
      const sx = Math.round(px.x + 1.4 * z);
      const sy = Math.round(px.y + 0.5 * z);
      if ((sx + sy) % 2 === 0) b.set(sx, sy, SHADOW);
    }
  }
}

function bakeMarkings(b: Buf): void {
  // Touchlines + goal lines (the field rectangle).
  hline(b, FIELD_L, FIELD_R, FIELD_T, LINE);
  hline(b, FIELD_L, FIELD_R, FIELD_B, LINE);
  vline(b, FIELD_L, FIELD_T, FIELD_B, LINE);
  vline(b, FIELD_R, FIELD_T, FIELD_B, LINE);

  // Halfway line + center circle (squashed ellipse y*0.78).
  const midY = Math.round((FIELD_T + FIELD_B) / 2);
  hline(b, FIELD_L, FIELD_R, midY, LINE);
  // Dense sampling (proportional to circumference) so the arc has no gaps.
  const circSteps = Math.ceil(CENTER_R * 8);
  for (let i = 0; i < circSteps; i++) {
    const a = (Math.PI * 2 * i) / circSteps;
    const x = Math.round(CX + CENTER_R * Math.cos(a));
    const y = Math.round(midY + CENTER_R * 0.78 * Math.sin(a));
    b.set(x, y, LINE);
  }
  b.set(CX, midY, LINE); // center spot

  // Per-goal markings, mirrored.
  for (const top of [true, false]) {
    const lineY = top ? FIELD_T : FIELD_B;
    const sgn = top ? 1 : -1;
    const yAt = (d: number) => lineY + sgn * d;

    // Penalty box.
    const pbL = Math.round(CX - PEN_BOX_W / 2);
    const pbR = Math.round(CX + PEN_BOX_W / 2);
    hline(b, pbL, pbR, yAt(PEN_BOX_D), LINE);
    vline(b, pbL, Math.min(lineY, yAt(PEN_BOX_D)), Math.max(lineY, yAt(PEN_BOX_D)), LINE);
    vline(b, pbR, Math.min(lineY, yAt(PEN_BOX_D)), Math.max(lineY, yAt(PEN_BOX_D)), LINE);

    // Six-yard box.
    const sbL = Math.round(CX - SIX_BOX_W / 2);
    const sbR = Math.round(CX + SIX_BOX_W / 2);
    hline(b, sbL, sbR, yAt(SIX_BOX_D), LINE);
    vline(b, sbL, Math.min(lineY, yAt(SIX_BOX_D)), Math.max(lineY, yAt(SIX_BOX_D)), LINE);
    vline(b, sbR, Math.min(lineY, yAt(SIX_BOX_D)), Math.max(lineY, yAt(SIX_BOX_D)), LINE);

    // Penalty spot.
    b.set(CX, yAt(PEN_SPOT_D), LINE);

    // D-arc outside the penalty box.
    const arcSteps = Math.ceil(D_ARC_R * 6);
    for (let i = 0; i <= arcSteps; i++) {
      const a = (Math.PI * i) / arcSteps;
      const x = Math.round(CX + D_ARC_R * Math.cos(a));
      const y = Math.round(yAt(PEN_SPOT_D) + sgn * D_ARC_R * Math.sin(a) * 0.78);
      // Only the lobe beyond the box line.
      if (sgn * (y - yAt(PEN_BOX_D)) > 0) b.set(x, y, LINE);
    }
  }

  // Corner arcs.
  for (const [cxp, cyp, qx, qy] of [
    [FIELD_L, FIELD_T, 1, 1],
    [FIELD_R, FIELD_T, -1, 1],
    [FIELD_L, FIELD_B, 1, -1],
    [FIELD_R, FIELD_B, -1, -1],
  ] as const) {
    const cSteps = Math.ceil(CORNER_R * 6);
    for (let i = 0; i <= cSteps; i++) {
      const a = (Math.PI / 2) * (i / cSteps);
      const x = Math.round(cxp + qx * CORNER_R * Math.cos(a));
      const y = Math.round(cyp + qy * CORNER_R * Math.sin(a));
      b.set(x, y, LINE);
    }
  }
}

// --- Stadium decoration (crowd + ad boards) around the pitch ---------------

const CROWD_COLORS: RGB[] = [
  [228, 107, 54],
  [241, 125, 50],
  [126, 71, 40],
  [160, 90, 50],
  [200, 160, 120],
  [90, 50, 30],
  [240, 200, 90],
  [220, 220, 210],
  [180, 70, 35],
];
const BARRIER: RGB = [170, 174, 178];
const BARRIER_D: RGB = [120, 124, 128];
const BOARD_PANELS: RGB[] = [
  [10, 10, 30],
  [199, 60, 32],
  [150, 60, 20],
];
const BOARD_TEXT: RGB = [238, 238, 232];

const CROWD_W = 26; // outer crowd band
const BOARD_W = 6; // ad boards between crowd and run-off grass

// Decorate one border pixel. `d` = distance to the world edge; `perim` = the
// coordinate running along the stand (so rows are parallel to the pitch).
function decorate(b: Buf, x: number, y: number, d: number, perim: number): void {
  if (d < CROWD_W) {
    // Crowd in rows: 3px-deep rows of 2px-wide heads, barrier rails every 5th
    // row, sparse waving arms above the heads.
    const row = Math.floor(d / 3);
    if (row % 5 === 0 && d % 3 === 0) {
      b.set(x, y, perim % 2 === 0 ? BARRIER : BARRIER_D);
      return;
    }
    const h = pixelHash(perim >> 1, row * 131 + (d % 3));
    if (h % 100 < 4) {
      b.set(x, y, [235, 178, 122]); // waving arm
      return;
    }
    b.set(x, y, CROWD_COLORS[pixelHash(perim >> 1, row) % CROWD_COLORS.length]);
    return;
  }
  // Ad boards: colored panels with a white dashed "text" row.
  const panel = BOARD_PANELS[Math.floor(perim / 44) % BOARD_PANELS.length];
  const inBoard = d - CROWD_W;
  if (inBoard === Math.floor(BOARD_W / 2) && perim % 7 < 4 && pixelHash(perim, 7) % 5 > 0) {
    b.set(x, y, BOARD_TEXT);
    return;
  }
  b.set(x, y, panel);
}

// Recolor a grass tone per the chosen surface (see options.GrassTint): scale
// by brightness, then blend toward the target. Applied equally to all three
// grass tones so the subtle band/mottle delta survives the shift.
function tintGrass(c: RGB, t: GrassTint): RGB {
  const ch = (v: number, target: number): number => {
    const scaled = v * t.bright;
    const out = scaled + (target - scaled) * t.amt;
    return Math.round(out < 0 ? 0 : out > 255 ? 255 : out);
  };
  return [ch(c[0], t.toward[0]), ch(c[1], t.toward[1]), ch(c[2], t.toward[2])];
}

export function bakePitch(tint?: GrassTint): BakedPitch {
  const canvas = makeCanvas(WORLD_W, WORLD_H);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(WORLD_W, WORLD_H);
  const b = new Buf(WORLD_W, WORLD_H, img);

  const gL = tint ? tintGrass(GRASS_L, tint) : GRASS_L;
  const gD = tint ? tintGrass(GRASS_D, tint) : GRASS_D;
  const gDD = tint ? tintGrass(GRASS_DD, tint) : GRASS_DD;

  // Grass: world-space diamond banding + hash mottle.
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const band = (Math.floor((x + y) / 24) + Math.floor((x - y) / 24)) & 1;
      let base = band === 0 ? gL : gD;
      if (pixelHash(x, y) % 100 < 18) {
        base = base === gD ? gDD : gD;
      }
      b.set(x, y, base);
    }
  }

  // Stadium ring: crowd + boards in the outer border, run-off grass inside.
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const dl = x;
      const dr = WORLD_W - 1 - x;
      const dt = y;
      const db = WORLD_H - 1 - y;
      const d = Math.min(dl, dr, dt, db);
      if (d >= CROWD_W + BOARD_W) continue;
      // Perimeter coordinate runs along whichever stand this pixel is in.
      const perim = d === dt || d === db ? x : y;
      decorate(b, x, y, d, perim);
    }
  }

  bakeShadows(b);
  bakeMarkings(b);
  ctx.putImageData(img, 0, 0);

  return {
    canvas,
    goalTop: bakeGoalFrame(true),
    goalBottom: bakeGoalFrame(false),
  };
}

// Baking the full pitch is a per-pixel pass, so cache one BakedPitch per
// surface (keyed by name) and reuse it across matches on that surface.
const pitchCache = new Map<string, BakedPitch>();
export function bakePitchFor(pitch: Pitch): BakedPitch {
  let baked = pitchCache.get(pitch.name);
  if (!baked) {
    baked = bakePitch(pitch.tint);
    pitchCache.set(pitch.name, baked);
  }
  return baked;
}
