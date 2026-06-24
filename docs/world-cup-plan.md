# World Cup 26 mode — plan

Status: **plan / preplan**. No code yet. Adds the 48-team 2026 World Cup as a
new competition mode with a group stage + knockout, expands the team registry
to all 48 nations, and considers procedural flags.

> Source: the 48-team field and Group A–L draw below are from the live 2026
> tournament (drawn 5 Dec 2025; playoff slots resolved late Mar 2026). Verify
> against the live bracket before shipping — some came from post-cutoff data.

## The field — 48 teams, Groups A–L

| Grp | Teams (confederation) |
|-----|-----------------------|
| A | Mexico (host), South Africa, South Korea, Czechia |
| B | Canada (host), Bosnia & Herzegovina, Qatar, Switzerland |
| C | Brazil, Morocco, Haiti, Scotland |
| D | USA (host), Paraguay, Australia, Turkey |
| E | Germany, Curaçao, Ivory Coast, Ecuador |
| F | Netherlands, Japan, Sweden, Tunisia |
| G | Belgium, Egypt, Iran, New Zealand |
| H | Spain, Cape Verde, Saudi Arabia, Uruguay |
| I | France, Senegal, Iraq, Norway |
| J | Argentina, Algeria, Austria, Jordan |
| K | Portugal, DR Congo, Uzbekistan, Colombia |
| L | England, Croatia, Ghana, Panama |

Already in `data.ts` (12): England, France, Germany, Spain, Netherlands, Sweden,
Brazil, Argentina, Uruguay, Colombia, USA, Mexico. **~36 new nations to add**
(kits). Note Italy, Ireland, Cameroon, Nigeria are *not* at WC26 — they stay in
the team pool for Friendly/League/Cup but aren't in the WC field.

## Format (authentic)

- 12 groups of 4, single round-robin → 3 group games per team (3 pts / 1 / 0).
- Knockout = **Round of 32**: the 12 group winners + 12 runners-up + the **8
  best third-placed** teams (ranked across groups by pts, GD, GF). → R32 → R16 →
  QF → SF → Final. Draws in knockout settled on penalties (coin-flip, as the Cup
  already does).
- Same play model as the existing Cup/League: **you pick one of the 48 and play
  your team's matches; every other fixture auto-sims.** Knocked out = run ends.

## Code changes

### 1. Team registry (`teams/data.ts`)
- Add the ~36 missing nations with kit colours (shirt/shorts/socks), reusing the
  palette. Add confederations the browser lacks: **ASIA, OCEANIA** (and keep the
  4 current continents) so the Friendly team-select can browse all 48 too.
- Optional `group?: 'A'..'L'` tag (or a separate WC draw table) for the WC mode.

### 2. Competition (`competition.ts`)
- New `kind: 'worldcup'`. The current `Competition` is a flat `rounds[][]`; the
  group stage needs **12 parallel mini-leagues** then a bracket, so either:
  - extend `Competition` with `groups: { teams; fixtures }[]` + a knockout phase, or
  - a dedicated `WorldCup` structure reusing `leagueSchedule` (per group) and the
    Cup bracket helpers.
- New logic: per-group tables, the **best-third ranking**, seeding the R32 from
  the qualification table, then reuse cup-style `advance`/round naming.
- Reuse `yourFixture` / `recordYourResult` / `simRound` shapes where possible.

### 3. App / screens (`app.ts`)
- New entry on the competition menu: **WORLD CUP**.
- Group-stage hub: show your group's table + your next fixture (extends `compHub`).
- After groups: a knockout bracket view (extends the Cup bracket display).
- Pick-your-team: reuse team-select (now browsing all 48, or pick from a group list).

### 4. Flags (optional — see decision)
- If procedural: a small flag module drawing N×M pixel flags from a pattern set
  (vertical/horizontal tricolours, bicolours, crosses, cantons, simple emblems).
  Most WC flags fit a handful of patterns; complex crests → simplified stripes.
  Shown on team-select + group tables + the bracket.

## Kit accuracy

Some existing kits are off, and the 36 new ones need correct colours. The
renderer draws the shirt as a **solid colour** (`torso` = 6×2px of `shirt`,
mirrored in the run/slide/fallen/dive poses), so two levels:

- **Colour accuracy (data only):** correct each team's `{shirt, shorts, socks}`
  RGB. Give teams their own shades instead of sharing palette constants where
  they actually differ (e.g. Argentina sky ≠ Italy azzurri; Brazil's specific
  green/yellow). No renderer change.
- **Patterns (data + renderer):** add an optional `pattern` to `Kit`
  (`stripes` | `halves` | `check` …) + a secondary colour, and make every
  shirt-drawing spot pick its colour by pixel position (thread a `shirtAt(x,y)`
  through `torso`, `slideSprite`, `fallenSprite`, `gkDiveSprite`, run frames).
  Coarse at 6px wide (~3 stripes / 1px check) but reads, and is very SWOS.
  Needed for proper Argentina / Croatia; most others are fine solid.

**Workflow for accurate colours:** I do a first pass from known kit colours, then
you correct specific teams with a hex value or a reference image (I sample it
into the palette). GK kits stay on the shared default unless a team clashes.

## Phasing
1. **Teams** — add all 48 to `data.ts` (kits), add ASIA/OCEANIA continents.
   Kit-colour accuracy pass happens here (existing + new teams).
2. **WC mode** — group stage (12 groups) + tables + your-fixture flow.
3. **Knockout** — best-thirds qualification + R32→Final bracket.
4. **Flags** (if chosen) — procedural flag module + show across the WC screens.

## Decisions (locked)
- **Flags**: **procedural pixel flags** — a small pattern-based flag module
  (offline, on-brand). No flagpedia / external assets.
- **Format**: **authentic 48 → R32** — 12 winners + 12 runners-up + 8 best
  thirds, then R32 → R16 → QF → SF → Final.
- **Groups**: the **real WC26 draw** (Groups A–L above). A random-draw toggle can
  come later but isn't required for v1.
- **Kits**: **accurate solid colours now** for all 48 (I derive a first pass from
  known kit references; you correct specific teams with a hex / reference image).
  **Patterns** (stripes/check for Argentina, Croatia, …) are a **deferred
  follow-up**, not in v1.
