# Phase 0 & 1 — Detailed Spec

Companion to [`menus-preplan.md`](./menus-preplan.md). Covers the app shell +
main menu (Phase 0) and the Friendly flow + team selection (Phase 1) in
implementation detail. **No code yet** — this is the agreed feature spec.

### Decisions (locked)

- **Menu visuals:** *clean custom retro* — canvas-drawn pixel style with our own
  palette/layout, not a pixel-exact SWOS clone. Stays true to the all-procedural,
  integer-pixel, no-assets ethos.
- **Team data:** ~16 **real-style nations**, **kits only** (no individual player
  names yet — rosters deferred).
- **Team browse:** **grouped/hierarchical from the start** — for nations that is
  **continent → nation**.

### Codebase constraints this builds on

- View is **320×256**, integer-scaled, `imageSmoothingEnabled = false`
  ([`world.ts`](../src/world.ts)). (README's "280" is stale.)
- Only text facility today is a 3×5 pixel font covering digits + *partial*
  uppercase in [`render.ts`](../src/render.ts) → needs a full glyph set.
- [`input.ts`](../src/input.ts) gives press/release **edges only on the action
  button**; `dx/dy` are held-only → menus need up/down edges + key-repeat.
- [`main.ts`](../src/main.ts) builds the match at **module scope** → must become
  an on-demand `startMatch(config)`.
- Renderer already reads per-player `kitShirt/kitShorts/kitSocks` → kits are
  nearly data-driven already; they just need to come from a `TeamDef`.

---

## Phase 0 — App shell + Main Menu

### Goal
Boot → title → navigable main menu. Selecting **Friendly** transitions into a
match (red-vs-blue placeholder until Phase 1). **Esc** from a match returns to
the menu. Everything drawn on the game canvas.

### Features / components

**0.1 Screen state machine.**
```ts
type AppScreen = 'title' | 'mainMenu' | 'friendlySetup' | 'teamSelect' | 'match';
interface App { screen: AppScreen; /* + transient per-screen state, match config */ }
```
The fixed-step loop ([`loop.ts`](../src/loop.ts)) is unchanged; `step`/`frame`
dispatch on `app.screen`. Match state is created **on demand**, not at module
load. Lives in a new `src/app.ts`.

**0.2 Full bitmap font** (`src/sprites/font.ts`).
- Glyphs: `A–Z`, `0–9`, space, `- : . ' / ( )`. Single case (uppercase) is fine
  and on-theme.
- `drawText(ctx, text, x, y, color, scale=1)`, integer `scale` (menus ~2×).
- `measure(text, scale)` for centering/right-align.
- Migrate the score/clock HUD in [`render.ts`](../src/render.ts) onto it (dedupe
  the inline font).

**0.3 Menu navigation input** (extend [`input.ts`](../src/input.ts)).
- Add up/down/left/right **edge** detection + auto-repeat (initial delay ~250ms,
  repeat ~90ms).
- `consumeMenuInput(): { up, down, left, right, confirm, back }` one-shot
  booleans. Confirm = Space/Enter, Back = Esc.
- Match input path (`consumeInputs`) untouched.

**0.4 Reusable list-menu widget** (`src/menu.ts`).
- `Menu` = `{ items: {label, enabled, onSelect}[], cursor }` + `update()` +
  `draw(ctx)`. Disabled items render dimmed and are skipped by the cursor.
- A blip SFX on move/confirm via the existing audio system.

**0.5 Title + main-menu screens.**
- Title: game name in the big font on a flat panel, "PRESS SPACE" prompt.
- Main menu: SS'92-style list — `FRIENDLY · CUP · LEAGUE · SPECIALS · OPTIONS ·
  EDIT TEAMS`. **Only FRIENDLY enabled** this phase; the rest dimmed
  ("coming soon") so the screen looks complete and later phases flip them on.

### Look (clean custom retro)
- A flat background panel (own palette — e.g. deep green/blue to echo the pitch),
  a title band, a centered vertical list. Highlighted item: colour swap + a
  small caret/marker. Optional bottom status line.
- All integer-pixel, no smoothing, scales with the existing canvas fit.

### Touch points
New: `src/app.ts`, `src/sprites/font.ts`, `src/menu.ts`.
Edit: `src/input.ts` (menu input), `src/main.ts` (boot into `app`, dispatch),
`src/render.ts` (use font module).

### Done when
Boot → title → main menu navigable by keyboard; Friendly launches today's match;
Esc returns to menu; other items visibly present but disabled.

---

## Phase 1 — Friendly + team selection

### Goal
Friendly → choose control mode → browse **continent → nation** to pick **home**
then **away** → play that exact matchup with correct kits → return to menu.

### Features / components

**1.1 Team data model** (`src/teams/data.ts`).
```ts
interface Kit { shirt: RGB; shorts: RGB; socks: RGB }
interface TeamDef {
  id: string;          // 'eng'
  name: string;        // 'ENGLAND'
  short: string;       // 'ENG'
  continent: Continent;
  kit: Kit;
  gkKit?: Kit;         // defaults to the shared green keeper kit
}
type Continent = 'EUROPE' | 'S. AMERICA' | 'N. AMERICA' | 'AFRICA';
```
- ~16 nations, **kits only**. Proposed spread (final list tweakable):
  - **Europe:** England, France, Germany, Italy, Spain, Netherlands, Sweden, Ireland
  - **S. America:** Brazil, Argentina, Uruguay, Colombia
  - **N. America:** USA, Mexico
  - **Africa:** Cameroon, Nigeria
- Authentic primary/secondary kit colours per nation (add to
  [`palette.ts`](../src/sprites/palette.ts) as needed).

**1.2 Generalise team construction** ([`team.ts`](../src/team.ts)).
- `makeTeams(rng, home: TeamDef, away: TeamDef)` builds from defs instead of the
  hardcoded `KITS` record. `GK_KIT` becomes `def.gkKit ?? DEFAULT_GK_KIT`.
- Home still attacks top, away attacks bottom (unchanged geometry).

**1.3 Friendly setup screen.**
- `Menu` with control modes: **1 PLAYER (vs CPU)**, **2 PLAYERS**,
  **CPU vs CPU** (watch). Chosen mode is baked into the match config at launch
  (replaces the live "press 2" toggle for menu-launched matches; the dev toggle
  can stay for quick testing).

**1.4 Team-select — continent → nation browser.**
- **Level 1:** list of continents (only those with ≥1 team). Confirm drills in,
  Back returns to friendly setup.
- **Level 2:** nations within the chosen continent. A side panel previews the
  highlighted team: **name + kit swatch** (shirt/shorts/socks blocks drawn from
  the def). Back returns to the continent list.
- Flow: pick **HOME** (screen header says so) → pick **AWAY** → small **"HOME vs
  AWAY"** confirm screen → launch. Away cannot equal home (or allow it — minor
  call; default: allow, it's a friendly).

**1.5 Match-config plumbing.**
```ts
interface MatchConfig {
  home: TeamDef; away: TeamDef;
  controlMode: '1p' | '2p' | 'cpu';
  // halfLength etc. arrive in Phase 2 (Options)
}
```
`startMatch(config)` (from Phase 0) consumes it: builds teams from the defs,
sets two-player per `controlMode`. On full-time / Esc → main menu.

### Look
- Same clean-retro list style as Phase 0. Team-select adds the **kit-swatch
  preview panel** beside the nation list. Headers ("SELECT HOME TEAM") in the big
  font.

### Touch points
New: `src/teams/data.ts`.
Edit: `src/team.ts` (def-driven build), `src/app.ts` (friendly setup +
team-select screens + config), `src/main.ts`/`src/match.ts` (config-driven
launch + return-to-menu).

### Done when
From the menu you can pick a control mode and two nations via the
continent→nation browser, see kit previews, and play that exact matchup with the
right kits, then return to the menu.

---

## Suggested build order

1. Font module (`font.ts`) + migrate HUD text. *(testable in isolation)*
2. Menu input edges/repeat in `input.ts`.
3. `menu.ts` list widget.
4. `app.ts` screen machine + refactor `main.ts` match into `startMatch(config)`.
5. Title + main menu (Friendly → placeholder match). **← Phase 0 complete**
6. `teams/data.ts` + def-driven `makeTeams`.
7. Friendly setup screen (control mode).
8. Continent→nation team-select + kit preview + VS confirm.
9. Wire `MatchConfig` end-to-end; return-to-menu on full-time/Esc. **← Phase 1 complete**
