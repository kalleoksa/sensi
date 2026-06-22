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

// One-shot key-down edges for UI screens (menus, match-control keys). Recorded
// on keydown and drained by consumeMenuInput / consumeMatchControls. Kept apart
// from the gameplay channels so menu navigation never disturbs the held-vector
// movement model and vice versa.
const uiEdges = new Set<string>();

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
    uiEdges.add(e.code);
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
    uiEdges.clear();
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
  if (twoPlayer) return { p1: f1, p2: f2 };
  return { p1: mergeFrames(f1, f2), p2: null };
}

// --- Menu / UI input --------------------------------------------------------
// Menus are not part of the deterministic sim, so timing here uses the wall
// clock. Navigation auto-repeats: one pulse on press, then steady repeats while
// the key stays held. Confirm/back are single-shot (no repeat).

const NAV_DELAY = 0.26; // s before a held direction starts repeating
const NAV_RATE = 0.09; // s between repeats thereafter

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];

interface NavState {
  active: boolean;
  next: number; // wall-clock time (s) of the next allowed pulse
}
const nav: Record<'up' | 'down' | 'left' | 'right', NavState> = {
  up: { active: false, next: 0 },
  down: { active: false, next: 0 },
  left: { active: false, next: 0 },
  right: { active: false, next: 0 },
};

function navPulse(dir: 'up' | 'down' | 'left' | 'right', codes: string[], now: number): boolean {
  const st = nav[dir];
  // A fresh key-down edge always fires once, even if the key is released before
  // the next frame samples it (covers very quick taps and synthetic events).
  const edge = codes.some((c) => uiEdges.has(c));
  if (edge) {
    st.active = true;
    st.next = now + NAV_DELAY;
    return true;
  }
  if (!anyHeld(codes)) {
    st.active = false;
    return false;
  }
  if (!st.active) {
    st.active = true;
    st.next = now + NAV_DELAY;
    return true;
  }
  if (now >= st.next) {
    st.next = now + NAV_RATE;
    return true;
  }
  return false;
}

export interface MenuInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
}

// Read one frame of menu navigation, then drain UI edges. Call exactly once per
// frame on a menu screen (and not alongside consumeMatchControls).
export function consumeMenuInput(): MenuInput {
  const now = performance.now() / 1000;
  const m: MenuInput = {
    up: navPulse('up', UP, now),
    down: navPulse('down', DOWN, now),
    left: navPulse('left', LEFT, now),
    right: navPulse('right', RIGHT, now),
    confirm: uiEdges.has('Space') || uiEdges.has('Enter'),
    back: uiEdges.has('Escape'),
  };
  uiEdges.clear();
  return m;
}

export interface MatchControls {
  pause: boolean; // P
  exit: boolean; // Esc -> back to menu
  restart: boolean; // R
  toggleTwoPlayer: boolean; // 2 (dev convenience)
}

// Read match-control key edges, then drain UI edges. Call once per frame while
// a match is on screen (and not alongside consumeMenuInput).
export function consumeMatchControls(): MatchControls {
  const c: MatchControls = {
    pause: uiEdges.has('KeyP'),
    exit: uiEdges.has('Escape'),
    restart: uiEdges.has('KeyR'),
    toggleTwoPlayer: uiEdges.has('Digit2'),
  };
  uiEdges.clear();
  return c;
}

// Clear pending action edges + UI edges. Call when launching a match so the
// keypress that confirmed the menu doesn't leak through as a first-frame kick.
export function clearActionEdges(): void {
  for (const c of CHANNELS) {
    c.pressedEdge = false;
    c.releasedEdge = false;
  }
  uiEdges.clear();
}
