// Keyboard for one or two local players.
//   P1: WASD + Space        P2: Arrows + Enter
// In one-player mode both key sets merge into the P1 frame (so arrows still
// work solo). Exposes held vectors and consumable press/release edges per
// channel; tap-vs-hold and buffering live in player.ts.

export interface InputFrame {
  dx: number; // raw held -1/0/1
  dy: number;
  down: boolean; // action held now
  pressed: boolean; // action went down since last consume
  released: boolean; // action went up since last consume
}

interface Channel {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  action: string[];
  actionDown: boolean;
  pressedEdge: boolean;
  releasedEdge: boolean;
}

function makeChannel(
  left: string[],
  right: string[],
  up: string[],
  down: string[],
  action: string[],
): Channel {
  return { left, right, up, down, action, actionDown: false, pressedEdge: false, releasedEdge: false };
}

const P1 = makeChannel(['KeyA'], ['KeyD'], ['KeyW'], ['KeyS'], ['Space']);
const P2 = makeChannel(['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown'], ['Enter']);
const CHANNELS = [P1, P2];

const held = new Set<string>();

// Virtual channel written by the touch overlay (touch.ts). Folded into P1 in
// consumeInputs so touch and keyboard coexist with no downstream changes.
const touch = {
  dx: 0,
  dy: 0,
  actionDown: false,
  pressedEdge: false,
  releasedEdge: false,
};

// Joystick: pass a vector (any magnitude; player.ts normalizes to a unit dir).
export function setTouchVector(dx: number, dy: number): void {
  touch.dx = dx;
  touch.dy = dy;
}

// Action button: raise press/release edges on transitions, mirroring keys.
export function setTouchAction(down: boolean): void {
  if (down && !touch.actionDown) touch.pressedEdge = true;
  if (!down && touch.actionDown) touch.releasedEdge = true;
  touch.actionDown = down;
}

function watched(code: string): boolean {
  return CHANNELS.some(
    (c) =>
      c.left.includes(code) ||
      c.right.includes(code) ||
      c.up.includes(code) ||
      c.down.includes(code) ||
      c.action.includes(code),
  );
}

export function initInput(): void {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (watched(e.code)) e.preventDefault();
    held.add(e.code);
    for (const c of CHANNELS) {
      if (c.action.includes(e.code) && !c.actionDown) {
        c.actionDown = true;
        c.pressedEdge = true;
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    held.delete(e.code);
    for (const c of CHANNELS) {
      if (c.action.includes(e.code) && c.actionDown) {
        c.actionDown = false;
        c.releasedEdge = true;
      }
    }
  });
  // Drop held state if the tab loses focus (prevents stuck keys).
  window.addEventListener('blur', () => {
    held.clear();
    for (const c of CHANNELS) c.actionDown = false;
  });
}

function anyHeld(codes: string[]): boolean {
  return codes.some((c) => held.has(c));
}

function frameOf(c: Channel): InputFrame {
  const frame: InputFrame = {
    dx: (anyHeld(c.right) ? 1 : 0) - (anyHeld(c.left) ? 1 : 0),
    dy: (anyHeld(c.down) ? 1 : 0) - (anyHeld(c.up) ? 1 : 0),
    down: c.actionDown,
    pressed: c.pressedEdge,
    released: c.releasedEdge,
  };
  c.pressedEdge = false;
  c.releasedEdge = false;
  return frame;
}

function mergeFrames(a: InputFrame, b: InputFrame): InputFrame {
  return {
    dx: a.dx !== 0 ? a.dx : b.dx,
    dy: a.dy !== 0 ? a.dy : b.dy,
    down: a.down || b.down,
    pressed: a.pressed || b.pressed,
    released: a.released || b.released,
  };
}

// Snapshot + clear edges. Call once per logic step.
// One-player: p2 is null and its keys fold into p1.
export function consumeInputs(twoPlayer: boolean): { p1: InputFrame; p2: InputFrame | null } {
  const f1 = frameOf(P1);
  const f2 = frameOf(P2);
  const ft: InputFrame = {
    dx: touch.dx,
    dy: touch.dy,
    down: touch.actionDown,
    pressed: touch.pressedEdge,
    released: touch.releasedEdge,
  };
  touch.pressedEdge = false;
  touch.releasedEdge = false;
  // Touch always drives P1; in two-player mode P2 stays keyboard-only.
  if (twoPlayer) return { p1: mergeFrames(f1, ft), p2: f2 };
  return { p1: mergeFrames(mergeFrames(f1, f2), ft), p2: null };
}
