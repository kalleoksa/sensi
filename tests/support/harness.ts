// Headless stand-ins for the handful of browser globals the game touches, so the
// app shell, the match sim and the save code can all be driven from node.
//
// Nothing here mocks game logic — the real modules run unmodified. We only
// provide a window that records listeners (so input.ts can be driven by
// synthesising key events), an in-memory localStorage, and a canvas context that
// swallows draw calls.

import { initInput } from '../../src/input';

// --- localStorage -----------------------------------------------------------

export interface FakeStorage {
  store: Map<string, string>;
  // When set, every access throws — the privacy-mode / sandboxed-iframe case.
  throwOnAccess: boolean;
}

export function installLocalStorage(): FakeStorage {
  const fake: FakeStorage = { store: new Map(), throwOnAccess: false };
  const guard = (): void => {
    if (fake.throwOnAccess) throw new Error('SecurityError: localStorage is not available');
  };
  const api = {
    getItem(key: string): string | null {
      guard();
      return fake.store.has(key) ? fake.store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      guard();
      fake.store.set(key, String(value));
    },
    removeItem(key: string): void {
      guard();
      fake.store.delete(key);
    },
    clear(): void {
      guard();
      fake.store.clear();
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: api, configurable: true, writable: true });
  return fake;
}

// --- window + keyboard ------------------------------------------------------

type Listener = (ev: unknown) => void;

export interface Keyboard {
  /** Key goes down (records the press edge the UI and gameplay channels read). */
  down: (code: string) => void;
  up: (code: string) => void;
  /** Down + up in one go — a quick tap. */
  tap: (code: string) => void;
  /** Drop focus: the game clears held keys and pending edges. */
  blur: () => void;
}

export interface FakeWindow {
  keyboard: Keyboard;
  listeners: Map<string, Listener[]>;
}

// Install a window that captures addEventListener handlers, then wire the real
// input module to it. Returns a keyboard that fires those handlers.
export function installWindow(): FakeWindow {
  const listeners = new Map<string, Listener[]>();
  const win = {
    addEventListener(type: string, fn: Listener): void {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type: string, fn: Listener): void {
      const list = listeners.get(type) ?? [];
      listeners.set(
        type,
        list.filter((f) => f !== fn),
      );
    },
  };
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });

  const fire = (type: string, ev: Record<string, unknown>): void => {
    for (const fn of listeners.get(type) ?? []) fn({ preventDefault(): void {}, repeat: false, ...ev });
  };
  const keyboard: Keyboard = {
    down: (code) => fire('keydown', { code }),
    up: (code) => fire('keyup', { code }),
    tap: (code) => {
      fire('keydown', { code });
      fire('keyup', { code });
    },
    blur: () => fire('blur', {}),
  };
  initInput();
  return { keyboard, listeners };
}

// --- canvas -----------------------------------------------------------------

// A 2D context that accepts every call and records nothing meaningful: the tests
// assert on game state, never on pixels.
export function fakeCtx(): CanvasRenderingContext2D {
  const noop = (): void => {};
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(obj, prop): unknown {
      if (prop in obj) return obj[prop as string];
      return noop; // every method is a no-op; every unread property reads as one
    },
    set(obj, prop, value): boolean {
      obj[prop as string] = value; // fillStyle etc.
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
