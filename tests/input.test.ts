// Input edges. Gameplay action edges (press / release) are consumed by the sim,
// UI edges by the menus and match controls; the two sets are deliberately
// separate, and neither should survive a moment when nothing was reading it.

import { beforeEach, describe, expect, it } from 'vitest';
import { installWindow, type Keyboard } from './support/harness';
import { clearGameplayEdges, consumeInputs, consumeMatchControls, consumeMenuInput } from '../src/input';

let keyboard: Keyboard;

beforeEach(() => {
  keyboard = installWindow().keyboard;
  // Input state is module-level: a blur drops held keys and every pending edge,
  // so each test starts from a clean keyboard.
  keyboard.blur();
});

describe('gameplay edges', () => {
  it('reports a press once, then stops', () => {
    keyboard.down('Space');
    expect(consumeInputs(false).p1.pressed).toBe(true);
    expect(consumeInputs(false).p1.pressed).toBe(false);
  });

  it('reports held direction and the release edge', () => {
    keyboard.down('KeyD');
    keyboard.down('Space');
    let f = consumeInputs(false).p1;
    expect(f.dx).toBe(1);
    expect(f.down).toBe(true);
    keyboard.up('Space');
    f = consumeInputs(false).p1;
    expect(f.released).toBe(true);
    expect(f.down).toBe(false);
    keyboard.up('KeyD');
    expect(consumeInputs(false).p1.dx).toBe(0);
  });

  it('folds player two keys into player one when solo', () => {
    keyboard.down('ArrowLeft');
    keyboard.down('Enter');
    const solo = consumeInputs(false).p1;
    expect(solo.dx).toBe(-1);
    expect(solo.pressed).toBe(true);
    expect(consumeInputs(false).p2).toBeNull();
  });

  it('keeps the two channels apart in two-player mode', () => {
    keyboard.down('KeyA');
    keyboard.down('ArrowRight');
    const { p1, p2 } = consumeInputs(true);
    expect(p1.dx).toBe(-1);
    expect(p2?.dx).toBe(1);
  });
});

describe('clearGameplayEdges', () => {
  it('drops pending action edges', () => {
    keyboard.down('Space');
    keyboard.up('Space');
    clearGameplayEdges();
    const f = consumeInputs(false).p1;
    expect(f.pressed).toBe(false);
    expect(f.released).toBe(false);
  });

  it('leaves UI edges alone, so pause / quit keys still register', () => {
    keyboard.down('KeyP');
    clearGameplayEdges();
    expect(consumeMatchControls().pause).toBe(true);
  });
});

describe('blur', () => {
  it('releases held keys and drops pending action edges', () => {
    keyboard.down('KeyD');
    keyboard.down('Space');
    keyboard.blur();
    const f = consumeInputs(false).p1;
    expect(f.dx, 'held keys are released').toBe(0);
    expect(f.down).toBe(false);
    expect(f.pressed, 'a press lost to the blur must not come back later').toBe(false);
    expect(f.released).toBe(false);
  });

  it('clears UI edges too', () => {
    keyboard.down('Escape');
    keyboard.blur();
    expect(consumeMenuInput().back).toBe(false);
  });
});
