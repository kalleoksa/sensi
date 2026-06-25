// The match referee: a persistent on-pitch figure that trails play, the way the
// old Anco "Kick Off" ref jogged around the field. Purely cosmetic — he never
// touches the ball or the players (he's not in state.players, so possession,
// AI and collisions all ignore him). At a foul he plants on the spot and
// brandishes the card the ref (updateMatch/judgeCard) decided to show.
//
// He reuses the Player shape so the existing sprite renderer draws him for free;
// movement is just moveToward at a reduced speed, keeping a standoff from the
// ball so he follows play without standing on it (and naturally lags a long
// ball, reading like a real ref trailing the break).

import type { Ball, Referee } from './state';
import { Dir } from './state';
import { moveToward, integrate, PLAYER_SPEED } from './player';
import { FIELD_T, FIELD_B, FIELD_L, FIELD_R, CX } from './world';

const REF_SPEED = PLAYER_SPEED * 0.72; // slower than the players, so he lags breaks
const REF_STANDOFF = 28; // px he keeps from the ball so he never sits on play
const REF_MARGIN = 6; // keep the ref this far inside the touchlines
export const REF_CARD_TIME = 1.4; // seconds he holds a card up at a foul (matches the HUD flash)

// Black kit, dark hair — a referee, distinct from both teams.
const REF_BLACK: [number, number, number] = [24, 24, 28];
const REF_SOCKS: [number, number, number] = [32, 32, 38];
const REF_HAIR: [number, number, number] = [40, 32, 24];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function makeReferee(): Referee {
  const x = CX + 40;
  const y = (FIELD_T + FIELD_B) / 2;
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    z: 0,
    vz: 0,
    vx: 0,
    vy: 0,
    dir: Dir.D,
    state: 'idle',
    stateTimer: 0,
    distance: 0,
    team: 0,
    isHuman: false,
    role: 'mid',
    duty: 'hold',
    markTarget: null,
    supportX: x,
    supportY: y,
    slotX: 0.5,
    slotY: 0.5,
    attacksTop: false,
    homeX: x,
    homeY: y,
    charging: false,
    charge: 0,
    bufferedTap: 0,
    pokeTimer: 0,
    slideCooldown: 0,
    yellow: false,
    sentOff: false,
    kitShirt: REF_BLACK,
    kitShorts: REF_BLACK,
    kitSocks: REF_SOCKS,
    kitPattern: 'solid',
    kitAccent: REF_BLACK,
    hair: REF_HAIR,
    cardTimer: 0,
    cardColor: null,
  };
}

// Plant the ref on the foul spot and start the card animation.
export function brandishCard(ref: Referee, x: number, y: number, color: 'yellow' | 'red'): void {
  ref.x = clamp(x, FIELD_L + REF_MARGIN, FIELD_R - REF_MARGIN);
  ref.y = clamp(y, FIELD_T + REF_MARGIN, FIELD_B - REF_MARGIN);
  ref.prevX = ref.x;
  ref.prevY = ref.y;
  ref.vx = ref.vy = 0;
  ref.state = 'idle';
  ref.cardTimer = REF_CARD_TIME;
  ref.cardColor = color;
}

// One frame of referee movement. While brandishing a card he stands still;
// otherwise he jogs toward a point a standoff short of the ball, lagging behind.
export function stepReferee(ref: Referee, ball: Ball, dt: number): void {
  if (ref.cardTimer > 0) {
    ref.cardTimer = Math.max(0, ref.cardTimer - dt);
    ref.prevX = ref.x; // hold position (no interpolation jitter)
    ref.prevY = ref.y;
    ref.vx = ref.vy = 0;
    ref.state = 'idle';
    if (ref.cardTimer === 0) ref.cardColor = null;
    return;
  }
  const dx = ball.x - ref.x;
  const dy = ball.y - ref.y;
  const d = Math.hypot(dx, dy);
  if (d > REF_STANDOFF) {
    // Aim a standoff short of the ball, kept inside the touchlines.
    const tx = clamp(ball.x - (dx / d) * REF_STANDOFF, FIELD_L + REF_MARGIN, FIELD_R - REF_MARGIN);
    const ty = clamp(ball.y - (dy / d) * REF_STANDOFF, FIELD_T + REF_MARGIN, FIELD_B - REF_MARGIN);
    moveToward(ref, tx, ty, dt, REF_SPEED);
  } else {
    // Close enough — stand and watch (still integrate so prevX/Y stay in step).
    ref.vx = ref.vy = 0;
    ref.state = 'idle';
    integrate(ref, dt);
  }
}
