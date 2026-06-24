// A reusable vertical list menu: labels with a per-item enabled flag and a
// cursor that skips disabled rows. Every menu screen (main menu, friendly
// setup, team browser) is one of these. Drawing uses the shared pixel font.

import { drawText, measure, GLYPH_H } from './sprites/font';

export interface ListView {
  items: string[];
  enabled: boolean[];
  cursor: number;
}

export function makeList(items: string[], enabled?: boolean[]): ListView {
  const en = enabled ?? items.map(() => true);
  // Start the cursor on the first enabled row.
  let cursor = en.findIndex(Boolean);
  if (cursor < 0) cursor = 0;
  return { items, enabled: en, cursor };
}

// Move the cursor by one in the given direction, skipping disabled rows and
// clamping at the ends (no wrap, matching the original's feel). Returns true if
// the cursor actually moved (useful for triggering a blip).
export function listMove(v: ListView, dir: -1 | 1): boolean {
  let i = v.cursor;
  while (true) {
    const next = i + dir;
    if (next < 0 || next >= v.items.length) return false;
    i = next;
    if (v.enabled[i]) {
      v.cursor = i;
      return true;
    }
  }
}

export function selectedEnabled(v: ListView): boolean {
  return v.enabled[v.cursor] ?? false;
}

export interface ListStyle {
  scale: number; // font scale
  lineGap: number; // extra pixels between rows (added to the glyph height)
  hi: string; // highlighted label colour
  on: string; // enabled label colour
  off: string; // disabled label colour
  marker: string; // selection marker colour
}

export const DEFAULT_STYLE: ListStyle = {
  scale: 2,
  lineGap: 6,
  hi: 'rgb(248,236,120)', // warm yellow highlight
  on: 'rgb(232,236,222)',
  off: 'rgb(110,124,96)',
  marker: 'rgb(248,236,120)',
};

// Total pixel height of the list as drawn (for vertical centering).
export function listHeight(v: ListView, style: ListStyle = DEFAULT_STYLE): number {
  const row = GLYPH_H * style.scale + style.lineGap;
  return v.items.length * row - style.lineGap;
}

// Draw the list with its labels horizontally centered on `centerX`. The
// highlighted row gets a small '>' marker to its left. When `maxVisible` is set
// and the list is longer, only a window of rows around the cursor is drawn, with
// small chevrons indicating more rows above / below.
export function drawList(
  ctx: CanvasRenderingContext2D,
  v: ListView,
  centerX: number,
  topY: number,
  style: ListStyle = DEFAULT_STYLE,
  maxVisible?: number,
): void {
  const row = GLYPH_H * style.scale + style.lineGap;
  const n = v.items.length;
  const windowed = maxVisible != null && n > maxVisible;
  let start = 0;
  let end = n;
  if (windowed) {
    start = Math.min(Math.max(0, v.cursor - Math.floor(maxVisible / 2)), n - maxVisible);
    end = start + maxVisible;
  }
  for (let i = start; i < end; i++) {
    const label = v.items[i];
    const w = measure(label, style.scale);
    const x = Math.round(centerX - w / 2);
    const y = topY + (i - start) * row;
    const color = !v.enabled[i] ? style.off : i === v.cursor ? style.hi : style.on;
    drawText(ctx, label, x, y, color, style.scale);
    if (i === v.cursor) {
      // A small right-pointing triangle to the left of the highlighted row.
      const s = style.scale;
      const widths = [1, 2, 3, 2, 1];
      const mx = x - 6 * s;
      const my = y + s; // vertically centered in the 7-tall glyph cell
      ctx.fillStyle = style.marker;
      for (let r = 0; r < widths.length; r++) {
        ctx.fillRect(mx, my + r * s, widths[r] * s, s);
      }
    }
  }
  // More-above / more-below chevrons when the window is clipping the list.
  if (windowed) {
    const s = style.scale;
    ctx.fillStyle = style.marker;
    if (start > 0) {
      const ay = topY - 4 * s; // up chevron above the first visible row
      const up = [1, 3, 5];
      for (let r = 0; r < up.length; r++) {
        ctx.fillRect(Math.round(centerX - (up[r] * s) / 2), ay + r * s, up[r] * s, s);
      }
    }
    if (end < n) {
      const by = topY + (end - start) * row - style.lineGap + s; // below the last row
      const down = [5, 3, 1];
      for (let r = 0; r < down.length; r++) {
        ctx.fillRect(Math.round(centerX - (down[r] * s) / 2), by + r * s, down[r] * s, s);
      }
    }
  }
}
