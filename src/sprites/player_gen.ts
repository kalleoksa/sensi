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
  WHITE,
  type RGB,
} from './palette';
import { Dir, type Dir8, type PlayerState, type KitPattern } from '../state';

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
  pattern?: KitPattern;
  accent?: RGB;
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
// Per-pixel shirt colour for the torso, given the kit pattern + facing. Stripes
// and checks only render on chest-facing frames (front/back/diagonal); the pure
// side view ('R') falls back to solid so a few-px-wide body doesn't turn to
// mush. 'band' is a horizontal chest stripe (upper shirt row) and reads on every
// facing.
type ShirtPaint = (x: number, y: number) => RGB;
function shirtPainter(col: PlayerColors, f: Facing): ShirtPaint {
  const base = col.shirt;
  const acc = col.accent ?? base;
  const pat = col.pattern ?? 'solid';
  if (pat === 'band') return (_x, y) => (y === 4 ? acc : base); // chest band, any facing
  if (f === 'R' || pat === 'solid') return () => base;
  if (pat === 'stripes') return (x) => (x % 2 === 0 ? base : acc); // vertical bands
  if (pat === 'check') return (x, y) => ((x + y) % 2 === 0 ? base : acc);
  return () => base;
}

function torso(
  f: Facing,
  shirtAt: ShirtPaint,
  shorts: RGB,
  skin: RGB,
  armL: number,
  armR: number,
): Px[] {
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) => px.push({ x, y, c });
  for (let x = 1; x <= 4; x++) {
    add(x, 4, shirtAt(x, 4));
    add(x, 5, shirtAt(x, 5));
  }
  add(0, 4, shirtAt(0, 4)); // shoulders
  add(5, 4, shirtAt(5, 4));
  // Side/diagonal facings: narrow the trailing shoulder a touch.
  if (f === 'R') {
    add(5, 4, shirtAt(5, 4));
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

// --- Slide tackle ----------------------------------------------------------
// A full-bodied figure laid flat ALONG the slide direction: head trailing,
// torso (with real width) laid out, legs/boots thrust toward facing, one limb
// kicked up. Built as its own sprite (not the upright torso) so the form
// matches the reference; widened so it stays the size of a standing player.
const FACING_VEC: Record<Facing, [number, number]> = {
  U: [0, -1],
  UR: [0.7, -0.7],
  R: [1, 0],
  DR: [0.7, 0.7],
  D: [0, 1],
};

function slideSprite(f: Facing, frame: number, col: PlayerColors): Px[] {
  const [fx, fy] = FACING_VEC[f];
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) =>
    px.push({ x: Math.round(x), y: Math.round(y), c });

  // Perpendicular axis, chosen to point "up" the screen (raised limb side).
  let pxn = -fy;
  let pyn = fx;
  if (pyn > 0) {
    pxn = fy;
    pyn = -fx;
  }

  // Centered in the cell (render anchors the slide on the cell center).
  // Canonical Sensi slide, read off the reference (sliding toward facing):
  // body leaning BACK with the head trailing and raised, one arm flung
  // forward-UP over the body (sleeve to hand), the tackling leg STRAIGHT out
  // level with the torso ending in a chunky boot, the other knee tucked under,
  // and a support arm pressed to the ground. +p = screen-up, +t = facing.
  const cx = 3.0;
  const cy = 6.0;
  const put = (t: number, p: number, c: RGB) =>
    add(cx + fx * t + pxn * p, cy + fy * t + pyn * p, c);

  // Integer (t, p) offsets so pixels land exactly (no rounding collisions).
  // Head: hair mass trailing and raised (leaning back), swept forward over the
  // face; eye sits inside the face with a skin chin below.
  put(-3, 3, col.hair);
  put(-2, 3, col.hair);
  put(-1, 3, col.hair); // swept over the brow
  put(-3, 4, col.hair);
  put(-2, 4, col.hair);
  put(-4, 4, col.hair); // crown tuft
  put(-2, 2, col.skin); // face
  put(-1, 2, WHITE); // eye highlight
  put(-1, 1, col.skin); // chin
  // Raised arm: sleeve arcing forward-up over the body to a 2px skin hand.
  put(0, 2, col.shirt);
  put(1, 3, col.shirt);
  put(2, 4, col.skin);
  put(3, 4, col.skin);
  // Torso: chunky red mass.
  put(-1, 0, col.shirt);
  put(0, 0, col.shirt);
  put(1, 0, col.shirt);
  put(0, 1, col.shirt);
  put(1, 1, col.shirt);
  // Support arm pressed to the ground under the torso.
  put(-1, -1, col.skin);
  put(0, -1, col.skin);
  // Hips.
  put(2, 0, col.shorts);
  put(2, 1, col.shorts);
  // Tucked (bent) knee under the hips.
  put(2, -1, col.skin);
  // Straight tackling leg: level with the torso, chunky 2px boot at the end.
  if (frame === 0) {
    put(3, 1, col.skin);
    put(4, 1, BLACK);
    put(4, 0, BLACK);
  } else {
    put(3, 1, col.skin);
    put(4, 1, col.skin);
    put(5, 1, BLACK);
    put(5, 0, BLACK);
  }
  return px;
}

// Knocked-down player: lying flat on the ground, limbs splayed. Drawn centered
// in the cell (render anchors fallen on the cell center, like slide).
function fallenSprite(col: PlayerColors): Px[] {
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) => px.push({ x, y, c });
  const cy = 5;
  // Head (left) + face.
  add(0, cy, col.hair);
  add(0, cy - 1, col.hair);
  add(1, cy - 1, col.hair);
  add(1, cy, col.skin);
  // Torso laid horizontally.
  for (let x = 2; x <= 4; x++) {
    add(x, cy - 1, col.shirt);
    add(x, cy, col.shirt);
  }
  // Sprawled arm up and hand.
  add(2, cy - 2, col.skin);
  // Shorts then splayed legs/boots.
  add(5, cy - 1, col.shorts);
  add(5, cy, col.shorts);
  add(6, cy - 1, col.socks);
  add(7, cy - 1, BLACK);
  add(6, cy + 1, col.socks);
  add(7, cy + 1, BLACK);
  return px;
}

// Goalkeeper dive: a flat, airborne keeper laid out horizontally, reaching
// toward the save (local +x). Two frames — gathered on the way up (0), fully
// stretched at the apex/descent (1). Drawn pointing right; spriteFor mirrors it
// for a leftward dive. Centered in the cell (render anchors it on the center,
// like slide/fallen) and lifted off the ground by p.z while in the air.
function gkDiveSprite(frame: number, col: PlayerColors): Px[] {
  const px: Px[] = [];
  const add = (x: number, y: number, c: RGB) => px.push({ x, y, c });
  const cy = 5;
  if (frame === 0) {
    // Gathered: knees up, arms half-extended.
    add(1, cy + 1, BLACK); // trailing boot
    add(2, cy + 1, col.socks);
    add(2, cy, col.skin); // tucked leg
    add(3, cy, col.shorts);
    add(3, cy + 1, col.shorts);
    add(4, cy - 1, col.shirt); // torso
    add(4, cy, col.shirt);
    add(5, cy - 1, col.shirt);
    add(5, cy, col.shirt);
    add(5, cy - 2, col.hair); // head leading + up
    add(6, cy - 2, col.hair);
    add(6, cy - 1, col.skin); // face
    add(6, cy, col.shirt); // sleeve
    add(7, cy, col.skin); // hand
    add(7, cy - 1, col.skin);
  } else {
    // Fully stretched horizontal: hands reaching far, legs trailing.
    add(0, cy, BLACK); // trailing boot
    add(1, cy, col.socks);
    add(2, cy, col.skin); // leg
    add(3, cy - 1, col.shorts);
    add(3, cy, col.shorts);
    add(4, cy - 1, col.shirt); // torso
    add(4, cy, col.shirt);
    add(5, cy - 1, col.shirt);
    add(5, cy, col.shirt);
    add(5, cy - 2, col.hair); // head up
    add(6, cy - 2, col.hair);
    add(6, cy - 1, col.skin); // face
    add(6, cy, col.shirt); // arm
    add(7, cy, col.skin); // reaching hands
    add(8, cy, col.skin);
    add(8, cy - 1, col.skin);
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
  // Slide and fallen are their own full-body poses, not the upright torso.
  if (state === 'slide') {
    return slideSprite(f, frame, col);
  }
  if (state === 'fallen') {
    return fallenSprite(col);
  }
  if (state === 'gkdive') {
    return gkDiveSprite(frame, col);
  }
  const px: Px[] = [
    ...head(f, col.hair, col.skin),
    ...torso(f, shirtPainter(col, f), col.shorts, col.skin, armL, armR),
  ];
  if (state === 'kick') {
    px.push(...kickLeg(fdx, fdy, col.socks, col.skin));
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
  gkdive: 2,
};

const cache = new Map<string, Atlas>();

function colorKey(c: PlayerColors): string {
  const j = (v: RGB) => v.join(',');
  const acc = c.accent ? j(c.accent) : '-';
  return `${j(c.shirt)}|${j(c.shorts)}|${j(c.socks)}|${j(c.hair)}|${j(c.skin)}|${c.pattern ?? 'solid'}|${acc}`;
}

export function buildAtlas(colorsIn: Partial<PlayerColors> & Pick<PlayerColors, 'shirt' | 'shorts' | 'socks' | 'hair'>): Atlas {
  const col: PlayerColors = { skin: DEF_SKIN, ...colorsIn };
  const key = colorKey(col);
  const hit = cache.get(key);
  if (hit) return hit;

  const cells = new Map<string, HTMLCanvasElement>();
  const states: PlayerState[] = ['idle', 'run', 'kick', 'slide', 'fallen', 'gkdive'];
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
