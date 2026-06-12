// Keyboard: 8-way dpad (arrows / WASD) + one action button (Space).
// Exposes the current held vector and consumable press/release edges.
// Tap-vs-hold and the ~80ms buffer live in player.ts (it owns sim timing).

export interface InputFrame {
  dx: number; // raw held -1/0/1
  dy: number;
  down: boolean; // action held now
  pressed: boolean; // action went down since last consume
  released: boolean; // action went up since last consume
}

const held = new Set<string>();
let actionDown = false;
let pressedEdge = false;
let releasedEdge = false;

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];
const ACTION = ['Space'];

function anyHeld(codes: string[]): boolean {
  return codes.some((c) => held.has(c));
}

export function initInput(): void {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (
      ACTION.includes(e.code) ||
      LEFT.includes(e.code) ||
      RIGHT.includes(e.code) ||
      UP.includes(e.code) ||
      DOWN.includes(e.code)
    ) {
      e.preventDefault();
    }
    held.add(e.code);
    if (ACTION.includes(e.code) && !actionDown) {
      actionDown = true;
      pressedEdge = true;
    }
  });
  window.addEventListener('keyup', (e) => {
    held.delete(e.code);
    if (ACTION.includes(e.code) && actionDown) {
      actionDown = false;
      releasedEdge = true;
    }
  });
  // Drop held state if the tab loses focus (prevents stuck keys).
  window.addEventListener('blur', () => {
    held.clear();
    actionDown = false;
  });
}

// Snapshot + clear the press/release edges. Call once per rendered frame.
export function consumeInput(): InputFrame {
  const dx = (anyHeld(RIGHT) ? 1 : 0) - (anyHeld(LEFT) ? 1 : 0);
  const dy = (anyHeld(DOWN) ? 1 : 0) - (anyHeld(UP) ? 1 : 0);
  const frame: InputFrame = {
    dx,
    dy,
    down: actionDown,
    pressed: pressedEdge,
    released: releasedEdge,
  };
  pressedEdge = false;
  releasedEdge = false;
  return frame;
}
