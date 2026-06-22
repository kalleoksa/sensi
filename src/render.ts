// Draw order: pitch (+ baked goal shadows) -> dynamic shadows -> entities
// (y-sorted, lifted by z) -> goal frames (net occludes the ball) -> HUD.

import { type GameState, type Player } from './state';
import type { Camera } from './world';
import type { Match } from './match';
import { VIEW_W, VIEW_H } from './world';
import type { BakedPitch } from './sprites/pitch_gen';
import { buildAtlas, spriteFor, runFrame, CELL_W, CELL_H } from './sprites/player_gen';
import { css, SHADOW, WHITE } from './sprites/palette';
import { drawText, measure } from './sprites/font';

// Where the feet sit inside a sprite cell (anchor for world placement).
const FEET_X = 6;
const FEET_Y = 13;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
  const frame =
    p.state === 'run' ? runFrame(p.distance) : p.state === 'gkdive' ? (p.vz > 0 ? 0 : 1) : 0;
  const { canvas, flip } = spriteFor(atlas, p.state, p.dir, frame);

  // Slide, fallen and the GK dive are laid-flat full-body poses centered in the
  // cell, so anchor the cell center on the ground point; others anchor at feet.
  const laidFlat = p.state === 'slide' || p.state === 'fallen' || p.state === 'gkdive';
  const anchorX = laidFlat ? CELL_W / 2 : FEET_X;
  const anchorY = laidFlat ? CELL_H / 2 : FEET_Y;
  const dx = sx - anchorX;
  const dy = sy - anchorY;
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
  ctx.fillStyle = css(SHADOW);
  if (p.z < 1) {
    // Grounded: a compact solid blob cast down-right (sun upper-left). Solid,
    // not dithered — a 50% checker this small just reads as scattered dots.
    const sx = Math.round(wx - cam.x);
    const sy = Math.round(wy - cam.y);
    ctx.fillRect(sx - 2, sy - 1, 4, 1);
    ctx.fillRect(sx, sy, 4, 1);
    ctx.fillRect(sx + 2, sy + 1, 3, 1);
  } else {
    // Airborne: project by height down-right.
    const sx = Math.round(wx - cam.x + 1.4 * p.z);
    const sy = Math.round(wy - cam.y + 0.5 * p.z);
    ctx.fillRect(sx - 2, sy, 5, 2);
  }
}

export function makeRenderer(
  ctx: CanvasRenderingContext2D,
): (baked: BakedPitch, state: GameState, alpha: number, match: Match, paused: boolean) => void {
  return (baked, state, alpha, match, paused) => {
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
      // Ball shadow sits down-right (sun upper-left); rises away when airborne.
      const ssx = Math.round(bx - cam.x + 1 + 1.4 * bz);
      const ssy = Math.round(by - cam.y + 2 + 0.5 * bz);
      ctx.fillStyle = css(SHADOW);
      ctx.fillRect(ssx - 1, ssy, 3, 1);
      ctx.fillRect(ssx, ssy + 1, 2, 1);
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
        const px = Math.round(bx - cam.x) - 1;
        const py = Math.round(by - cam.y - bz) - 1;
        // 4x4 football, corners trimmed for a round read: white body with
        // black spots, shaded underside, bright top highlight.
        ctx.fillStyle = css(WHITE);
        ctx.fillRect(px + 1, py, 2, 1); // top row
        ctx.fillRect(px, py + 1, 4, 1); // upper-mid
        ctx.fillRect(px, py + 2, 4, 1); // lower-mid
        ctx.fillRect(px + 1, py + 3, 2, 1); // bottom row
        ctx.fillStyle = 'rgb(28,30,28)';
        ctx.fillRect(px + 2, py + 1, 1, 1); // spot
        ctx.fillRect(px + 1, py + 2, 1, 1); // spot
        ctx.fillStyle = 'rgb(150,152,146)';
        ctx.fillRect(px + 1, py + 3, 2, 1); // shaded underside
        ctx.fillStyle = 'rgb(255,255,250)';
        ctx.fillRect(px + 1, py, 1, 1); // highlight
      },
    });
    items.sort((a, c) => a.y - c.y);
    for (const it of items) it.draw();

    // Controlled-player indicators: a small downward chevron above the head
    // (white for P1's red player, yellow for P2's blue player).
    for (const [p, color] of [
      [state.controlled, 'rgb(250,250,240)'],
      [state.controlled2, 'rgb(245,215,80)'],
    ] as const) {
      if (!p) continue;
      const ix = Math.round(lerp(p.prevX, p.x, alpha) - cam.x);
      const iy = Math.round(lerp(p.prevY, p.y, alpha) - cam.y) - 17;
      ctx.fillStyle = color;
      ctx.fillRect(ix - 2, iy, 5, 1);
      ctx.fillRect(ix - 1, iy + 1, 3, 1);
      ctx.fillRect(ix, iy + 2, 1, 1);
    }

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

    // 6. Score HUD, top-left corner (out of the way of the goals when the
    // camera pans to either end): "T0 - T1". Flashes yellow just after a goal.
    const scoreText = `${match.score[0]}-${match.score[1]}`;
    const tw = measure(scoreText);
    const tx = 4;
    const ty = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(tx - 2, ty - 2, tw + 4, 11);
    drawText(ctx, scoreText, tx, ty, match.flash > 0 ? 'rgb(250,230,90)' : 'rgb(236,240,226)');

    // 6b. Match clock, just right of the score: m:ss of the time remaining.
    const secs = Math.max(0, Math.ceil(match.clock));
    const clockText = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const cw = measure(clockText);
    const clx = tx + tw + 5;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(clx - 2, ty - 2, cw + 4, 11);
    drawText(ctx, clockText, clx, ty, 'rgb(236,240,226)');

    // 7. Centered overlays (dim the pitch): kickoff/half/full-time and pause.
    const overlay =
      paused ? 'PAUSED'
      : match.phase === 'halftime' ? 'HALF TIME'
      : match.phase === 'fulltime' ? 'FULL TIME'
      : null;
    if (overlay) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const ww = measure(overlay, 2);
      drawText(ctx, overlay, Math.round((VIEW_W - ww) / 2), Math.round(VIEW_H / 2 - 7), 'rgb(245,245,235)', 2);
    }
  };
}
