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

// Virtual touch controls feed the P1 channel (see initTouchControls below).
// dx/dy are snapped to -1/0/1 so the thumb-stick behaves exactly like the dpad.
const touch = { dx: 0, dy: 0, actionDown: false, pressedEdge: false, releasedEdge: false };

function touchFrame(): InputFrame {
  const frame: InputFrame = {
    dx: touch.dx,
    dy: touch.dy,
    down: touch.actionDown,
    pressed: touch.pressedEdge,
    released: touch.releasedEdge,
  };
  touch.pressedEdge = false;
  touch.releasedEdge = false;
  return frame;
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
  initTouchControls();
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
  // Touch always drives P1, on top of the keyboard, in both modes.
  const f1 = mergeFrames(frameOf(P1), touchFrame());
  const f2 = frameOf(P2);
  if (twoPlayer) return { p1: f1, p2: f2 };
  return { p1: mergeFrames(f1, f2), p2: null };
}

// On-screen controls for phones/tablets: a left thumb-stick (8-way, mirroring
// the dpad) and a right action button (mirroring Space: tap=pass, hold=shot,
// non-carrier=slide). Hidden via CSS on fine-pointer (mouse) devices so desktop
// is untouched; the overlay only appears where '(pointer: coarse)' matches.
let touchBuilt = false;
function initTouchControls(): void {
  if (touchBuilt || typeof document === 'undefined') return;
  touchBuilt = true;

  const style = document.createElement('style');
  style.textContent = `
    #touch { position: fixed; inset: 0; z-index: 8; pointer-events: none;
      display: none; touch-action: none; }
    @media (pointer: coarse) { #touch { display: block; } }
    #touch .stick, #touch .kick { position: absolute;
      bottom: calc(28px + env(safe-area-inset-bottom)); pointer-events: auto;
      touch-action: none; -webkit-user-select: none; user-select: none; }
    #touch .stick { left: calc(28px + env(safe-area-inset-left));
      width: 132px; height: 132px; border-radius: 50%;
      background: rgba(255,255,255,0.08); border: 2px solid rgba(255,255,255,0.25); }
    #touch .knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px;
      margin: -28px 0 0 -28px; border-radius: 50%; background: rgba(255,255,255,0.38);
      border: 2px solid rgba(255,255,255,0.55); transition: transform 0.05s linear; }
    #touch .kick { right: calc(28px + env(safe-area-inset-right));
      width: 96px; height: 96px; border-radius: 50%; background: rgba(214,69,65,0.55);
      border: 2px solid rgba(255,255,255,0.55); color: #ECF0E2;
      font: bold 16px/92px system-ui, sans-serif; text-align: center; }
    #touch .kick.active { background: rgba(214,69,65,0.9); }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'touch';
  const stick = document.createElement('div');
  stick.className = 'stick';
  const knob = document.createElement('div');
  knob.className = 'knob';
  stick.appendChild(knob);
  const kick = document.createElement('div');
  kick.className = 'kick';
  kick.textContent = 'KICK';
  root.appendChild(stick);
  root.appendChild(kick);
  document.body.appendChild(root);

  // Thumb-stick: vector from the base centre to the touch, deadzoned then
  // snapped to the 8 dpad directions.
  const DEAD = 0.32;
  let stickId: number | null = null;
  const updateStick = (clientX: number, clientY: number): void => {
    const r = stick.getBoundingClientRect();
    const maxR = r.width / 2;
    let nx = (clientX - (r.left + maxR)) / maxR;
    let ny = (clientY - (r.top + maxR)) / maxR;
    const mag = Math.hypot(nx, ny);
    if (mag > 1) {
      nx /= mag;
      ny /= mag;
    }
    touch.dx = nx > DEAD ? 1 : nx < -DEAD ? -1 : 0;
    touch.dy = ny > DEAD ? 1 : ny < -DEAD ? -1 : 0;
    knob.style.transform = `translate(${nx * maxR * 0.6}px, ${ny * maxR * 0.6}px)`;
  };
  const resetStick = (): void => {
    stickId = null;
    touch.dx = 0;
    touch.dy = 0;
    knob.style.transform = 'translate(0,0)';
  };
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    updateStick(e.clientX, e.clientY);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    e.preventDefault();
    updateStick(e.clientX, e.clientY);
  });
  const endStick = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    e.preventDefault();
    resetStick();
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  // Action button: press is an edge (pass/shot charge start, or slide), and the
  // release ends the shot charge — same as keydown/keyup on Space.
  kick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!touch.actionDown) {
      touch.actionDown = true;
      touch.pressedEdge = true;
    }
    kick.classList.add('active');
  });
  const endKick = (e: PointerEvent): void => {
    e.preventDefault();
    if (touch.actionDown) {
      touch.actionDown = false;
      touch.releasedEdge = true;
    }
    kick.classList.remove('active');
  };
  kick.addEventListener('pointerup', endKick);
  kick.addEventListener('pointercancel', endKick);
}
