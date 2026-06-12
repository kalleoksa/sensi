// Team construction + formations. Team 0 attacks the top goal, team 1 the
// bottom. Home anchors are laid out in each team's own half and stored in
// world coords on the player; the AI shifts them toward the ball during play.

import { makePlayer, type PlayerInit } from './player';
import type { Player, Role } from './state';
import type { Rng } from './rng';
import {
  FIELD_T,
  FIELD_B,
  FIELD_L,
  PLAY_W,
  PLAY_H,
} from './world';
import {
  KIT_RED,
  KIT_BLUE,
  WHITE,
  HAIR_DARK,
  HAIR_BLOND,
  HAIR_GINGER,
  type RGB,
} from './sprites/palette';

interface Slot {
  x: number; // fraction across pitch width (0..1)
  y: number; // fraction of own half depth from own goal line (0..1)
  role: Role;
}

// 4-3-3.
const FORMATION: Slot[] = [
  { x: 0.5, y: 0.04, role: 'gk' },
  { x: 0.18, y: 0.2, role: 'def' },
  { x: 0.39, y: 0.16, role: 'def' },
  { x: 0.61, y: 0.16, role: 'def' },
  { x: 0.82, y: 0.2, role: 'def' },
  { x: 0.3, y: 0.46, role: 'mid' },
  { x: 0.5, y: 0.42, role: 'mid' },
  { x: 0.7, y: 0.46, role: 'mid' },
  { x: 0.26, y: 0.72, role: 'fwd' },
  { x: 0.5, y: 0.78, role: 'fwd' },
  { x: 0.74, y: 0.72, role: 'fwd' },
];

const HAIRS: RGB[] = [HAIR_DARK, HAIR_DARK, HAIR_BLOND, HAIR_GINGER];

interface Kit {
  shirt: RGB;
  shorts: RGB;
  socks: RGB;
}

const KITS: Record<0 | 1, Kit> = {
  0: { shirt: KIT_RED, shorts: WHITE, socks: KIT_RED },
  1: { shirt: KIT_BLUE, shorts: WHITE, socks: KIT_BLUE },
};

// Keepers wear a distinct kit (green) so they read apart from outfielders.
const GK_KIT: Kit = { shirt: [40, 150, 78], shorts: [28, 30, 28], socks: [28, 30, 28] };

function homeFor(team: 0 | 1, slot: Slot): { x: number; y: number } {
  const x = FIELD_L + slot.x * PLAY_W;
  // Own goal line and into-field direction differ per team.
  const half = PLAY_H / 2;
  const y = team === 0 ? FIELD_B - slot.y * half : FIELD_T + slot.y * half;
  return { x, y };
}

function makeTeam(team: 0 | 1, rng: Rng): Player[] {
  return FORMATION.map((slot) => {
    const kit = slot.role === 'gk' ? GK_KIT : KITS[team];
    const home = homeFor(team, slot);
    const init: PlayerInit = {
      x: home.x,
      y: home.y,
      team,
      isHuman: false,
      role: slot.role,
      shirt: kit.shirt,
      shorts: kit.shorts,
      socks: kit.socks,
      hair: slot.role === 'gk' ? HAIR_DARK : rng.pick(HAIRS),
    };
    const p = makePlayer(init);
    p.homeX = home.x;
    p.homeY = home.y;
    return p;
  });
}

export function makeTeams(rng: Rng): Player[] {
  return [...makeTeam(0, rng), ...makeTeam(1, rng)];
}
