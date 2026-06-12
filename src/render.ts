// Draw order: pitch (+ baked goal shadows) -> dynamic shadows -> entities
// (y-sorted, lifted by z) -> goal frames (net occludes the ball) -> HUD.

import { type GameState, type Player, DIR_VEC } from './state';
import type { Camera } from './world';
import { VIEW_W, VIEW_H } from './world';
import type { BakedPitch } from './sprites/pitch_gen';
import { buildAtlas, spriteFor, runFrame, CELL_W } from './sprites/player_gen';
import { css, SHADOW, WHITE } from './sprites/palette';

// Where the feet sit inside a sprite cell (anchor for world placement).
const FEET_X = 6;
const FEET_Y = 14;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// 50% checkerboard shadow blob in world->screen space.
function checkerShadow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = css(SHADOW);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (((sx + x) + (sy + y)) % 2 === 0) {
        ctx.fillRect(sx + x, sy + y, 1, 1);
      }
    }
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: Player,
  cam: Camera,
  alpha: number,
): void {
  const wx = lerp(p.prevX, p.x, alpha);
  const wy = lerp(p.prevY, p.y, alpha);
  const sx = Math.round(wx - cam.x);
  const sy = Math.round(wy - cam.y - p.z);

  const atlas = buildAtlas({
    shirt: p.kitShirt,
    shorts: p.kitShorts,
    socks: p.kitSocks,
    hair: p.hair,
  });
  const frame = p.state === 'run' ? runFrame(p.distance) : 0;
  const { canvas, flip } = spriteFor(atlas, p.state, p.dir, frame);

  const dx = sx - FEET_X;
  const dy = sy - FEET_Y;
  if (flip) {
    ctx.save();
    ctx.translate(dx + CELL_W, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(canvas, dx, dy);
  }
}

function drawPlayerShadow(ctx: CanvasRenderingContext2D, p: Player, cam: Camera, alpha: number): void {
  const wx = lerp(p.prevX, p.x, alpha);
  const wy = lerp(p.prevY, p.y, alpha);
  // Grounded: fixed small blob offset right of the feet. Airborne (z): project.
  const sx = Math.round(wx - cam.x + 2 + 1.4 * p.z);
  const sy = Math.round(wy - cam.y + 1 + 0.5 * p.z);
  checkerShadow(ctx, sx - 2, sy, 5, 2);
}

export function makeRenderer(
  ctx: CanvasRenderingContext2D,
  baked: BakedPitch,
): (state: GameState, alpha: number) => void {
  return (state, alpha) => {
    const cam = state.camera;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    // 1. Pitch (grass, lines, baked goal shadows).
    ctx.drawImage(baked.canvas, -Math.round(cam.x), -Math.round(cam.y));

    // 2. Dynamic shadows (drawn before entities).
    for (const p of state.players) drawPlayerShadow(ctx, p, cam, alpha);
    const b = state.ball;
    {
      const bx = lerp(b.prevX, b.x, alpha);
      const by = lerp(b.prevY, b.y, alpha);
      const bz = lerp(b.prevZ, b.z, alpha);
      const ssx = Math.round(bx - cam.x + 1.4 * bz);
      const ssy = Math.round(by - cam.y + 0.5 * bz);
      checkerShadow(ctx, ssx, ssy, 2, 2);
    }

    // 3. Entities, y-sorted (feet/ground y), lifted by z.
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (const p of state.players) {
      items.push({ y: lerp(p.prevY, p.y, alpha), draw: () => drawPlayer(ctx, p, cam, alpha) });
    }
    items.push({
      y: lerp(b.prevY, b.y, alpha),
      draw: () => {
        const bx = lerp(b.prevX, b.x, alpha);
        const by = lerp(b.prevY, b.y, alpha);
        const bz = lerp(b.prevZ, b.z, alpha);
        const px = Math.round(bx - cam.x);
        const py = Math.round(by - cam.y - bz);
        ctx.fillStyle = css(WHITE);
        ctx.fillRect(px, py, 2, 2);
        ctx.fillStyle = 'rgb(190,190,185)';
        ctx.fillRect(px, py + 1, 1, 1);
      },
    });
    items.sort((a, c) => a.y - c.y);
    for (const it of items) it.draw();

    // 4. Goal frames on top (net occludes the ball when it's inside).
    ctx.drawImage(baked.goalTop.canvas, Math.round(baked.goalTop.ox - cam.x), Math.round(baked.goalTop.oy - cam.y));
    ctx.drawImage(
      baked.goalBottom.canvas,
      Math.round(baked.goalBottom.ox - cam.x),
      Math.round(baked.goalBottom.oy - cam.y),
    );

    // 5. HUD: shot power bar above the charging player's head.
    const human = state.players.find((p) => p.isHuman && p.charging);
    if (human) {
      const frac = Math.min(1, human.charge / 0.7);
      const hx = Math.round(lerp(human.prevX, human.x, alpha) - cam.x) - 6;
      const hy = Math.round(lerp(human.prevY, human.y, alpha) - cam.y) - 18;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(hx, hy, 14, 3);
      ctx.fillStyle = frac > 0.75 ? 'rgb(230,80,40)' : 'rgb(230,220,60)';
      ctx.fillRect(hx + 1, hy + 1, Math.round(12 * frac), 1);
    }

    // Facing tick for the carrier (subtle aim aid while tuning).
    if (state.carrier) {
      const p = state.carrier;
      const [fx, fy] = DIR_VEC[p.dir];
      const px = Math.round(lerp(p.prevX, p.x, alpha) - cam.x + fx * 9);
      const py = Math.round(lerp(p.prevY, p.y, alpha) - cam.y + fy * 9 - 7);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(px, py, 1, 1);
    }
  };
}
