// Team construction + formations. Team 0 attacks the top goal, team 1 the
// bottom. Home anchors are laid out in each team's own half and stored in
// world coords on the player; the AI shifts them toward the ball during play.

import { makePlayer, type PlayerInit } from './player';
import type { Player } from './state';
import type { Rng } from './rng';
import {
  FIELD_T,
  FIELD_B,
  FIELD_L,
  PLAY_W,
  PLAY_H,
} from './world';
import { HAIR_DARK, HAIR_BLOND, HAIR_GINGER, type RGB } from './sprites/palette';
import { type TeamDef, type Kit, goalkeeperKits } from './teams/data';
import { FORMATIONS, type FormationId, type Slot } from './formations';

const HAIRS: RGB[] = [HAIR_DARK, HAIR_DARK, HAIR_BLOND, HAIR_GINGER];

// World-space formation home for a slot, given which goal the team attacks this
// half. slotY is depth into the team's OWN half (0 = own goal line). A team that
// attacks the top defends the bottom, so its own half is the bottom half.
export function homeForSlot(
  slotX: number,
  slotY: number,
  attacksTop: boolean,
): { x: number; y: number } {
  const x = FIELD_L + slotX * PLAY_W;
  const half = PLAY_H / 2;
  const y = attacksTop ? FIELD_B - slotY * half : FIELD_T + slotY * half;
  return { x, y };
}

function makeTeam(team: 0 | 1, def: TeamDef, slots: Slot[], rng: Rng, gkKit: Kit): Player[] {
  return slots.map((slot) => {
    const kit = slot.role === 'gk' ? gkKit : def.kit;
    // Half-1 placement: team 0 attacks the top, team 1 the bottom.
    const home = homeForSlot(slot.x, slot.y, team === 0);
    const init: PlayerInit = {
      x: home.x,
      y: home.y,
      team,
      isHuman: false,
      role: slot.role,
      shirt: kit.shirt,
      shorts: kit.shorts,
      socks: kit.socks,
      pattern: kit.pattern,
      accent: kit.accent,
      hair: slot.role === 'gk' ? HAIR_DARK : rng.pick(HAIRS),
    };
    const p = makePlayer(init);
    p.slotX = slot.x;
    p.slotY = slot.y;
    p.attacksTop = team === 0;
    p.homeX = home.x;
    p.homeY = home.y;
    return p;
  });
}

// Build both teams: home is team 0 (attacks the top in half 1), away is team 1.
export function makeTeams(
  rng: Rng,
  home: TeamDef,
  away: TeamDef,
  homeFormation: FormationId,
  awayFormation: FormationId,
): Player[] {
  // Stock keeper kits picked to contrast both shirts + the pitch (FIFA-style);
  // a team's explicit gkKit overrides the auto pick.
  const gk = goalkeeperKits(home.kit.shirt, away.kit.shirt);
  return [
    ...makeTeam(0, home, FORMATIONS[homeFormation], rng, home.gkKit ?? gk.home),
    ...makeTeam(1, away, FORMATIONS[awayFormation], rng, away.gkKit ?? gk.away),
  ];
}
