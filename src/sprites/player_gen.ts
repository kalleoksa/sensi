// Procedural player sprite atlas. Ports run_anim.py's hair-dominant little
// Sensi player and generalizes it to 5 base directions (U, UR, R, DR, D) and
// the states we need for the playable slice. Left-facing dirs (UL, L, DL) are
// the right-facing sprites drawn mirrored — see spriteFor().
//
// Atlases are generated parametrically per color-combo and cached, which is the
// same end result as the getImageData palette-swap described in the plan but
// simpler (a handful of combos, generated once at boot).

import {
  SKIN as DEF_SKIN,
  BLACK,
  type RGB,
} from './palette';
import { Dir, type Dir8, type PlayerState } from '../state';

export const CELL_W = 12;
export const CELL_H = 16;
const OX = 3; // body origin within the cell (3px margin for kick/slide reach)
const OY = 3;

export interface PlayerColors {
  shirt: RGB;
  shorts: RGB;
  socks: RGB;
  hair: RGB;
  skin: RGB;
}

export interface Atlas {
  key: string;
  cells: Map<string, HTMLCanvasElement>; // `${state}_${dir}_${frame}`
}

// Base directions we actually draw. Index here matches Dir8 values 0..4.
const BASE_DIRS: Dir8[] = [Dir.U, Dir.UR, Dir.R, Dir.DR, Dir.D];

type Px = { x: number; y: number; c: RGB };
type Facing = 'U' | 'UR' | 'R' | 'DR' | 'D';

function facingOf(dir: Dir8): Facing {
  switch (dir) {
    case Dir.U:
      return 'U';
    case Dir.UR:
      return 'UR';
    case Dir.R:
      return 'R';
    case Dir.DR:
      return 'DR';
    default:
      return 'D';
  }
}

// --- Head (rows 0..3) ------------------------------------------------------
// Hair-dominant cap with a 1px face sliver whose placement reads the facing.
// Warm highlight for the face (the bright dot visible on reference faces).
const FACE_HI: RGB = [250, 206, 150];

function head(f: Facing, hair: RGB, skin: RGB): Px[] {
  const H = hair;
  const S = skin;
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) => px.push({ x, y, c });
  // Rounded crown + hair cap (rows 0-1), then two rows of face (rows 2-3)
  // framed by sideburns — so the player has an actual visible face, not a
  // solid black blob. Front facings show the most skin; U/UR show back of head.
  add(2, 0, H);
  add(3, 0, H);
  for (let x = 1; x <= 4; x++) add(x, 1, H);

  switch (f) {
    case 'D':
      add(1, 2, H); add(2, 2, S); add(3, 2, S); add(4, 2, H); // forehead
      add(1, 3, H); add(2, 3, S); add(3, 3, FACE_HI); add(4, 3, H); // face + highlight
      break;
    case 'DR':
      add(1, 2, H); add(2, 2, S); add(3, 2, S); add(4, 2, S); // face toward facing
      add(1, 3, H); add(2, 3, S); add(3, 3, FACE_HI); add(4, 3, S);
      break;
    case 'R':
      add(1, 2, H); add(2, 2, H); add(3, 2, S); add(4, 2, S); // profile, face front
      add(1, 3, H); add(2, 3, S); add(3, 3, FACE_HI); add(4, 3, S);
      break;
    case 'UR':
      add(1, 2, H); add(2, 2, H); add(3, 2, H); add(4, 2, S); // cheek sliver only
      for (let x = 1; x <= 4; x++) add(x, 3, H); // back of head
      break;
    case 'U':
      for (let x = 1; x <= 4; x++) { add(x, 2, H); add(x, 3, H); } // back of head
      break;
  }
  return px;
}

// --- Torso + arms (rows 4..7) ---------------------------------------------
// armL/armR give the row (4..6) of each hand for the counter-swing.
function torso(
  f: Facing,
  shirt: RGB,
  shorts: RGB,
  skin: RGB,
  armL: number,
  armR: number,
): Px[] {
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) => px.push({ x, y, c });
  for (let x = 1; x <= 4; x++) {
    add(x, 4, shirt);
    add(x, 5, shirt);
  }
  add(0, 4, shirt); // shoulders
  add(5, 4, shirt);
  // Side/diagonal facings: narrow the trailing shoulder a touch.
  if (f === 'R') {
    add(5, 4, shirt);
  }
  add(0, armL, skin); // hands
  add(5, armR, skin);
  for (let x = 1; x <= 4; x++) {
    add(x, 6, shorts);
    add(x, 7, shorts);
  }
  return px;
}

// --- Legs (rows 8..11) -----------------------------------------------------
// pose: 'idle' | 'f0'(left fwd) | 'f1'(together) | 'f2'(right fwd)
// Exaggerated spread per the plan note (forward boot lower, back boot raised).
function legs(
  pose: 'idle' | 'f0' | 'f1' | 'f2',
  _shorts: RGB,
  socks: RGB,
  skin: RGB,
  fdx: number,
): Px[] {
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) => px.push({ x, y, c });
  const lx = 1;
  const rx = 4;
  const sh = Math.sign(fdx); // horizontal lean for side facings

  // A planted leg: full skin thigh/shin, sock, boot. A forward leg reaches one
  // pixel lower; a raised (trailing) leg pulls the boot up with no shin gap.
  const planted = (x: number) => {
    add(x, 8, skin);
    add(x, 9, socks);
    add(x, 10, BLACK);
  };
  const forward = (x: number) => {
    add(x, 8, skin);
    add(x, 9, skin);
    add(x, 10, socks);
    add(x, 11, BLACK); // reaches further down/forward
  };
  const raised = (x: number) => {
    add(x, 8, skin);
    add(x, 9, BLACK); // boot lifted, no lower shin
  };

  if (pose === 'idle' || pose === 'f1') {
    planted(lx);
    planted(rx);
  } else if (pose === 'f0') {
    forward(lx + sh); // left leg forward
    raised(rx);
  } else {
    forward(rx + sh); // right leg forward
    raised(lx);
  }
  return px;
}

// --- Kick (extended leading leg in the facing direction) -------------------
function kickLeg(fdx: number, fdy: number, socks: RGB, skin: RGB): Px[] {
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) => px.push({ x, y, c });
  // Thrust the leading boot one cell out along facing.
  const bx = 4 + Math.round(fdx * 2);
  const by = 10 + Math.round(fdy > 0 ? 1 : fdy < 0 ? -1 : 0);
  add(4, 8, skin);
  add(bx, 9, socks);
  add(bx, by, BLACK);
  add(1, 9, socks); // planted leg
  add(1, 10, BLACK);
  add(1, 8, skin);
  return px;
}

// --- Slide tackle legs -----------------------------------------------------
// Keeps the full upright head + torso (so the player stays full-sized) and
// thrusts both legs toward the facing direction into a lunging tackle. Reach
// grows on frame 1. Drawn from the hips (row 8) outward along (fdx, fdy).
function slideLegs(frame: number, fdx: number, fdy: number, socks: RGB, skin: RGB): Px[] {
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) =>
    px.push({ x: Math.round(x), y: Math.round(y), c });
  const reach = frame === 0 ? 2 : 3;
  const spread = frame === 0 ? 0.8 : 1.3; // legs splay apart for a lunge read
  const perpx = fdy; // perpendicular to the slide axis
  const perpy = -fdx;
  for (const hx of [1, 4]) {
    const sign = hx === 1 ? -1 : 1; // left leg out one way, right leg the other
    add(hx, 8, skin); // skin thigh at the hip
    // Solid leg from hip (row 9) out to a splayed boot, no gaps.
    const hy = 9;
    const bx = hx + fdx * reach + perpx * spread * sign;
    const by = hy + fdy * reach + perpy * spread * sign;
    const steps = Math.max(1, Math.round(Math.max(Math.abs(bx - hx), Math.abs(by - hy))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      add(hx + (bx - hx) * t, hy + (by - hy) * t, i === steps ? BLACK : socks);
    }
  }
  return px;
}

function poseForRunFrame(frame: number): 'f0' | 'f1' | 'f2' {
  // CYCLE = [0,1,2,1] -> contact, pass, contact', pass
  return frame === 0 ? 'f0' : frame === 2 ? 'f2' : 'f1';
}

// Build the pixel list for one sprite cell (local body coords, pre-offset).
function buildCell(
  state: PlayerState,
  dir: Dir8,
  frame: number,
  col: PlayerColors,
  fdx: number,
  fdy: number,
): Px[] {
  const f = facingOf(dir);
  let armL = 5;
  let armR = 5;
  if (state === 'run') {
    const pose = poseForRunFrame(frame);
    if (pose === 'f0') {
      armL = 6 - 0; // (clamped into 4..6 below by row math)
      armL = 4;
      armR = 6;
    } else if (pose === 'f2') {
      armL = 6;
      armR = 4;
    }
  }
  const px: Px[] = [
    ...head(f, col.hair, col.skin),
    ...torso(f, col.shirt, col.shorts, col.skin, armL, armR),
  ];
  if (state === 'kick') {
    px.push(...kickLeg(fdx, fdy, col.socks, col.skin));
  } else if (state === 'slide') {
    px.push(...slideLegs(frame, fdx, fdy, col.socks, col.skin));
  } else if (state === 'run') {
    px.push(...legs(poseForRunFrame(frame), col.shorts, col.socks, col.skin, fdx));
  } else {
    px.push(...legs('idle', col.shorts, col.socks, col.skin, fdx));
  }
  return px;
}

function renderCell(px: Px[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CELL_W;
  c.height = CELL_H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(CELL_W, CELL_H);
  const d = img.data;
  for (const { x, y, c: col } of px) {
    const gx = x + OX;
    const gy = y + OY;
    if (gx < 0 || gy < 0 || gx >= CELL_W || gy >= CELL_H) continue;
    const i = (gy * CELL_W + gx) * 4;
    d[i] = col[0];
    d[i + 1] = col[1];
    d[i + 2] = col[2];
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const STATE_FRAMES: Record<string, number> = {
  idle: 1,
  run: 3,
  kick: 1,
  slide: 2,
  header: 1,
  fallen: 1,
};

const cache = new Map<string, Atlas>();

function colorKey(c: PlayerColors): string {
  const j = (v: RGB) => v.join(',');
  return `${j(c.shirt)}|${j(c.shorts)}|${j(c.socks)}|${j(c.hair)}|${j(c.skin)}`;
}

export function buildAtlas(colorsIn: Partial<PlayerColors> & Pick<PlayerColors, 'shirt' | 'shorts' | 'socks' | 'hair'>): Atlas {
  const col: PlayerColors = { skin: DEF_SKIN, ...colorsIn };
  const key = colorKey(col);
  const hit = cache.get(key);
  if (hit) return hit;

  const cells = new Map<string, HTMLCanvasElement>();
  const states: PlayerState[] = ['idle', 'run', 'kick', 'slide'];
  // Facing vector per base dir for leg/kick thrust.
  const FV: Record<number, [number, number]> = {
    [Dir.U]: [0, -1],
    [Dir.UR]: [0.7, -0.7],
    [Dir.R]: [1, 0],
    [Dir.DR]: [0.7, 0.7],
    [Dir.D]: [0, 1],
  };
  for (const state of states) {
    const frames = STATE_FRAMES[state] ?? 1;
    for (const dir of BASE_DIRS) {
      const [fdx, fdy] = FV[dir];
      for (let frame = 0; frame < frames; frame++) {
        cells.set(`${state}_${dir}_${frame}`, renderCell(buildCell(state, dir, frame, col, fdx, fdy)));
      }
    }
  }
  const atlas: Atlas = { key, cells };
  cache.set(key, atlas);
  return atlas;
}

// Resolve a sprite for any of the 8 directions; left dirs reuse the right-facing
// sprite drawn mirrored.
export function spriteFor(
  atlas: Atlas,
  state: PlayerState,
  dir: Dir8,
  frame: number,
): { canvas: HTMLCanvasElement; flip: boolean } {
  let baseDir = dir;
  let flip = false;
  if (dir === Dir.UL) {
    baseDir = Dir.UR;
    flip = true;
  } else if (dir === Dir.L) {
    baseDir = Dir.R;
    flip = true;
  } else if (dir === Dir.DL) {
    baseDir = Dir.DR;
    flip = true;
  }
  let st = state;
  if (!STATE_FRAMES[st] || !atlas.cells.has(`${st}_${baseDir}_${Math.min(frame, (STATE_FRAMES[st] ?? 1) - 1)}`)) {
    st = 'idle';
  }
  const maxFrame = (STATE_FRAMES[st] ?? 1) - 1;
  const f = Math.max(0, Math.min(frame, maxFrame));
  const canvas = atlas.cells.get(`${st}_${baseDir}_${f}`) ?? atlas.cells.get(`idle_${baseDir}_0`)!;
  return { canvas, flip };
}

// Distance-driven run frame (CYCLE = [0,1,2,1]).
const CYCLE = [0, 1, 2, 1];
export function runFrame(distance: number): number {
  return CYCLE[Math.floor(distance / 6) % 4];
}
