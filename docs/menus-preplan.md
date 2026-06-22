# Menus & Game Flow — Preplan

Status: **research / preplan**. No code yet. This captures how the original
*Sensible Soccer* (1992) and *Sensible World of Soccer* (1994, "SWOS") front-end
worked, where Sensi is today, and a phased roadmap to get from "boots straight
into one match" to "pick a team and a mode, then play".

---

## 1. How the original front-end worked

Two reference points sharing one design language:

- **Sensible Soccer '92 ("European Champions")** — the game asked about.
- **SWOS '94** — the sequel whose menu became the definitive "Sensi menu";
  the better template for where a remake usually wants to go.

### Look & feel (iconic — worth being faithful to)

- Flat **text-list** menus: a column (or two columns) of large pixel-font
  items on a flat coloured background (the famous blue / grey).
- **Keyboard / joystick only**: up-down moves a highlight, fire/enter selects,
  back/esc goes up a level. No mouse. This matches Sensi's existing input model.
- The whole front-end is a **stack of these list screens**:
  menu → submenu → setup → pre-match → kickoff.
- Distinctive chunky pixel font ("Sensible" / SWOS menu font).

### Sensible Soccer '92 — menu structure

Main menu, 8 entries:
`Options · Edit Teams · Load/Save Data · Highlights · Friendly · Cup · League · Specials`

Game modes:

- **Friendly** — single match. 2 players, player-vs-CPU, *or* CPU-vs-CPU (watch).
- **Cup** — knockout, 2–64 teams; configurable rounds, extra time, penalties.
- **League** — round-robin; 2 or 3 points for a win.
- **Specials** — preset real competitions (Cup Winners Cup, UEFA Cup,
  European Championship) plus custom leagues.

Options (match settings):

- Game length: **3 / 5 / 7 / 10 minutes**
- Pitch condition: **icy / wet / soft / muddy / normal / dry / hard**
- Weather / season
- Substitutions: up to **2 per team**

Pre-match team / tactics screen (shown to each human before kickoff):

- **8 formations**: 4-4-2, 5-4-1, 4-5-1, 5-3-2, 3-5-2, 4-3-3,
  All-Out Attack, All-Out Defence.
- Squad list down the left; pick a player name, then pick a position to
  move/swap him. **Subs highlighted**; swap them in/out here.
- Formation diagram shown beside the squad.
- **"View Oppo"** to inspect the opponent's lineup.
- Polish touch: **thumbs-up / tick** for a smart placement,
  **thumbs-down / 'x'** for a silly one.

Also: `Edit Teams` (rename teams/players/managers, edit kit colours),
`Load/Save Data`.

### SWOS '94 — the evolved version

Main menu, **10 options in two columns**:

- Left column (meta / edit tools): `Edit Custom Teams · Edit Tactics ·
  Highlights · Options · Save/Disk Filing`.
- Right column (play modes):
  - **Friendly** — any two teams in the world.
  - **DIY Competition** — build your own league/cup to spec.
  - **Preset Competition** — real ones (World Cup, UEFA Cup, continental
    & national leagues).
  - **Season** — one season, no management overhead (a "sampler").
  - **Career** — full management (transfers, finance, tactics).

Team selection in SWOS is **hierarchical**: continent → country →
competition/division → team. (Relevant later for Preset/Career; for a Friendly
it collapses to "browse to a team and pick it".)

`Edit Custom Teams` (names, manager, kit shirt/shorts/socks colour cycling,
import real teams) and `Edit Tactics` (author your own formations).

### Sources

- [Sensible Soccer manual (Lemon Amiga)](https://www.lemonamiga.com/games/docs.php?id=1415)
- [SWOS manual — worldofstuart](http://worldofstuart.excellentcontent.com/swos/manual5.htm)
- [SWOS — Wikipedia](https://en.wikipedia.org/wiki/Sensible_World_of_Soccer)
- [Sensible Soccer — Wikipedia](https://en.wikipedia.org/wiki/Sensible_Soccer)

---

## 2. Where Sensi is today (the gap)

From the code:

- [`src/main.ts`](../src/main.ts) boots **straight into one match** —
  builds the world, calls `makeTeams(rng)`, starts the loop. No app-level
  screen state.
- [`src/team.ts`](../src/team.ts) builds **exactly two hardcoded teams**
  (red attacks top, blue attacks bottom) from a **single hardcoded 4-3-3**
  `FORMATION`. `KITS` is a `Record<0|1, Kit>` of red/blue. No team identity
  (name, roster), no alternative formations.
- [`src/state.ts`](../src/state.ts) — `GameState` is purely the live match
  (ball, players, camera, carrier, controlled). No notion of "screen".

So menus decompose into three separable problems:

1. **App shell / screen-state machine** above the match (menu ↔ setup ↔
   match). Does not exist yet.
2. **Team & competition data** (a team has a name, kit, roster; a competition
   has fixtures + a table). Does not exist yet.
3. **Pre-match tactics** (multiple formations, selectable). One formation
   literal to generalise.

---

## 3. Phased roadmap

| Phase | Adds | Notes |
|---|---|---|
| **0. App shell** | Top-level `Screen` state (`menu / setup / match`) wrapping the loop; a main-menu screen rendered on-canvas in the pixel font, keyboard-navigated. | Smallest enabling change; everything else hangs off it. |
| **1. Friendly + team select** | Team data (name + kit + roster); a Friendly flow: pick home/away team, pick P1-v-CPU / 2P / CPU-v-CPU; launch match with chosen teams. | Generalise `KITS`/`makeTeams` to take team data instead of hardcoded red/blue. |
| **2. Options / pre-match** | Match length, pitch condition; the 8 selectable formations per side; pre-match tactics screen. | Generalise the single `FORMATION` into a table of 8. |
| **3. Competitions** | Cup (knockout) and League (round-robin) over the team list; fixtures + table persisting across matches. | Competition model feeds two teams back into a match each round. |
| **4. Editors (optional/later)** | Edit teams (names, kit colours), edit tactics. | Mirrors SWOS; lower priority for a remake. |

### Decisions

1. **Menu set:** start with the lean **SS'92 set**
   (Friendly/Cup/League/Specials), borrow SWOS polish. *(resolved)*
2. **Menu visuals:** *clean custom retro* — canvas-drawn pixel style, our own
   palette/layout (not a pixel-exact SWOS clone). *(resolved)*
3. **Team data:** ~16 **real-style nations**, **kits only** (player rosters
   deferred). *(resolved)*
4. **Team browse:** **grouped from the start** — continent → nation. *(resolved)*

### Detailed specs

Phase 0 (app shell + main menu) and Phase 1 (Friendly + team select) are
specified in full in [`phase-0-1-spec.md`](./phase-0-1-spec.md).
