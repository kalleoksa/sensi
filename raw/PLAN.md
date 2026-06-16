# Sensi — browser remake of Sensible Soccer

Handoff doc for implementation. Art direction and core algorithms were prototyped in Python
(included as reference: `pitch_frame.py`, `run_anim.py`); the game itself is TypeScript + Canvas.

## Scope

- v1: playable match slice. One human player (keyboard), local pitch, working ball physics,
  dribbling, pass/shot with aftertouch, basic AI opponents, goals + restarts.
- Explicitly out of v1: online play, menus, leagues/cups, GK AI beyond basics, referee.
- Legal: no original Sensible Soccer assets. All sprites are generated procedurally
  in our own style (specs below, derived from reference *metrics* only).

## Stack

- TypeScript, Canvas 2D, Vite. No game engine, no dependencies beyond dev tooling.
- All sprites generated at boot onto offscreen canvases (no PNG assets, no pipeline).
- Single `src/` codebase; prefer plain functions and data over classes where possible.

## Architecture

```
src/
  main.ts          // boot, canvas setup, resize
  loop.ts          // fixed timestep 60Hz logic, render interpolation
  input.ts         // keyboard (1 action button + dpad), buffering for tap/hold
  world.ts         // pitch dims, world<->screen transform, camera
  ball.ts          // ball state: pos(x,y), z height, vel, spin; physics step
  player.ts        // player entity + per-player state machine
  team.ts          // formations, AI role assignment
  ai.ts            // chase/mark/position behaviors
  match.ts         // rules: out of bounds, goals, kickoff, restarts
  sprites/
    palette.ts     // color constants (below)
    player_gen.ts  // procedural sprite atlas generation
    pitch_gen.ts   // grass, lines, goal rendering
  render.ts        // draw order: pitch -> shadows -> goal shadow -> entities (y-sorted) -> goal frame -> HUD
```

- **Fixed timestep**: logic at 60Hz, accumulate real time, interpolate render positions.
  Deterministic; all randomness through one seeded PRNG.
- **Camera**: follows ball with lookahead in ball-travel direction; pitch ~3 screens tall;
  base resolution 320×280 game pixels, integer-scaled to fit window (nearest-neighbor,
  `imageSmoothingEnabled = false`).
- **Coordinates**: world units = game pixels. Ball and jumping players carry `z` (height);
  ground position is (x, y), screen y = world y - z.

## Art spec

### Palette (sampled from era-correct references)

```ts
GRASS_L  = '#97B021'   // light diamond band
GRASS_D  = '#8FAA19'   // dark band (keep contrast subtle)
GRASS_DD = '#86A214'   // mottle noise
LINE     = '#ECF0E2'
POST     = '#EAECD7'
NET      = '#969892'
NET_BG   = '#476A04'
SHADOW   = '#567808'   // all cast shadows, checkered 50%
SKIN     = '#EBB27A'
```

Team kits are template-swapped (see Palette swap below). Hair: dark `#28201E`,
blond `#DEBA50`, ginger `#AA5A1E`.

### Pitch

- Mottled yellow-green: per-pixel hash noise (18% chance of darker variant) over a large
  diagonal diamond banding `((x+y)/24 + (x-y)/24) % 2`. Generate in **world space** so it
  scrolls coherently; render as a pre-baked full-pitch offscreen canvas (cheap: ~320×900).
- Lines 1px `LINE`. Standard markings: touchlines, halfway + center circle (squash ellipse
  y×0.78), boxes, D-arcs, spots, corner arcs.

### Goal (3D read)

- Vertical plane standing on the goal line: mesh interior (`NET` grid with `NET_BG` holes,
  2px pitch), 2px white posts, 3px crossbar with shaded underside `#AAAC A2`.
- Draw order: goal *shadow* on grass → players behind goal line → goal frame+net on top
  (net occludes the ball when it's inside).

### Lighting / shadows — single global rule

Sun upper-left. A point at height `z` above ground point `(x, y)` casts its shadow at:

```ts
shadowX = x + 1.4 * z
shadowY = y + 0.5 * z
```

- Applies to goal (project every solid pixel; higher parts land further down-right),
  ball in flight, and jumping players.
- Grounded players: fixed small blob offset right of feet.
- All shadows: `SHADOW` color, 50% checkerboard dither, drawn before entities.

### Player sprites

- Cell 8×12 visible (12×16 with margins), hair-dominant head (4×3 hair cap over 1px face
  sliver), shirt 2 rows + shoulder px, shorts 2 rows, skin legs, black boots.
- 8 directions: draw 5 (U, UR, R, DR, D), mirror horizontally for UL, L, DL.
- States × frames (from reference sheet metrics):

| state   | dirs | frames | input lock |
|---------|------|--------|-----------|
| idle    | 8    | 1      | no |
| run     | 8    | 3      | no |
| kick    | 8    | 1      | ~150ms |
| header  | 8    | 1      | airborne |
| slide   | 8    | 2      | ~400ms + recover |
| fallen  | 2    | 1      | ~600ms |
| gk dive | 2    | 2      | until landed |

- **Run cycle is distance-driven, not time-driven**:

```ts
const CYCLE = [0, 1, 2, 1];            // contact, pass, contact', pass
frame = CYCLE[Math.floor(distanceTraveled / 6) % 4];
```

  Player stops → legs stop instantly. `distanceTraveled` accumulates per player.
- Contact frames: forward boot 1px lower AND back boot raised — exaggerate the spread,
  the Python prototype was too subtle. Arms counter-swing 1–2px.

### Palette swap (kits)

Generate the atlas once in template colors, then per team:
`getImageData` → replace template RGB values (shirt, trim, shorts, socks) → cache
recolored canvas keyed by team. Hair/skin varied per player at generation time.

## Ball physics

- State: `x, y, z, vx, vy, vz, spin`.
- Ground friction when `z === 0`; gravity on `vz`; bounce with damping (~0.6).
- **Aftertouch**: after a kick, for ~300ms, held direction perpendicular to ball travel
  applies lateral acceleration (curl); held up/down adjusts loft. This is the soul of the
  game — tune relentlessly.
- Kick model: tap = pass (low, ball speed scaled to nearest-teammate logic later),
  hold = shot power bar, release = strike with current aftertouch window.
- Dribbling: no stickiness. Ball is nudged ahead ~10px on contact; possession = proximity.
  This (not glue) is what makes Sensi feel like Sensi.

## Input

- Arrows/WASD = 8-way direction, one action button (e.g. Space):
  - no ball, tap: slide tackle
  - with ball, tap: pass in facing direction
  - with ball, hold+release: shot with power
  - after any kick: aftertouch window
- Buffer taps ~80ms so inputs during locked states aren't eaten.

## Sound (`src/audio.ts`)

Procedural — **no audio assets**, synthesized at runtime via Web Audio, mirroring the
generate-at-boot, no-pipeline, legally-clean stance used for sprites and pitch.

- **Graph**: one `AudioContext` → master `GainNode` (volume/mute) → `DynamicsCompressor`
  (limiter so layered hits don't clip) → destination. A looped lowpassed-noise **crowd bed**
  feeds the master separately.
- **Autoplay gate**: the context is created lazily and `resume()`d on the first keydown/pointer
  gesture (also unlocks iOS/Safari). `M` toggles mute; volume + mute persist to `localStorage`.
- **Determinism**: the sim never plays sound — it only calls `emitSfx(name, gain)`, a cheap
  array push. The loop calls `flushSfx()` once per rendered frame to realize the queue. Audio is
  a one-way side-effect sink: it never reads back into game state or the seeded PRNG, so the
  fixed-step sim stays deterministic. Per-sound min-intervals throttle repeats; the queue is
  capped; events queued before the context unlocks are dropped.
- **SFX** (all from oscillators + filtered noise + gain envelopes):
  `pass`/`shot` (pitch-dropping sine pop + click, gain scaled by strike speed), `bounce`
  (filtered tick, gain from impact `vz`), `slide` (downward-sweep noise scrape), `tackle`,
  `whistleKick`/`whistleOut`/`whistleGoal` (square ~2.6kHz with an LFO pea-trill), and `goal`
  (noise roar swell + 3 whistle blasts).
- **Crowd**: `setCrowdIntensity(0..1)` each frame from ball-distance-to-goal, spiking on the goal
  flash; smoothed onto the bed's gain.
- **Emit sites**: `player.ts` (strike, kickToward, slide, loose-ball poke, knockdown),
  `ball.ts` (ground bounce), `match.ts` (goal, kickoff, out-of-bounds restart).

## AI (v1 minimal)

Per-player state machine: `position` (formation anchor, shifts with ball) →
`chase` (nearest N to ball) → `dribble/pass` (carrier: head to goal, pass when blocked) →
`tackle` (defender in range). GK: stay on line, track ball x, dive on close shots.

## Build order

1. Loop + camera + pre-baked pitch canvas scrolling
2. Sprite atlas generation (port `run_anim.py` sprite fn; all 5 dirs × states; debug
   contact-sheet view)
3. One player: movement + distance-driven run cycle
4. Ball physics + dribble nudge + kick
5. Aftertouch + power — **stop and tune here until it feels right**
6. Out of bounds, goals, restarts
7. Teams, AI, GK
8. Second local player, kits via palette swap, crowd/boards decoration

## Tuning constants

Derived from sourced reference metrics (not clip-measured — pitch-crossing time is the one
estimated calibration knob; everything else is anchored). World units == game pixels and the
world→screen transform is 1:1. **Applied** (see commit): the values below are now live in `src/`.

**Anchor**: players are 12px tall (Jon Hare, confirmed). `playerHeight = 12` world px. A real
footballer ≈ 1.8m → ~6.7 px/m; cross-checked against SWOS penalty-spot-at-70px (11m → 6.4 px/m).
Converge on **~6.5 px/m**.

### Zoom / camera

| quantity                  | target            | applied                    |
|---------------------------|-------------------|----------------------------|
| px/m                      | ~6.5              | `PLAY_H=720` / 105m → 6.9 ✓ |
| pitch length (heights)    | ~57–60            | 720 / 12 = 60 ✓            |
| view height               | **256** (PAL ref) | `VIEW_H = 256` ✓           |
| view in player-heights    | ~19–21            | 256 / 12 = 21.3 ✓          |
| player / viewport height  | ~5%               | 12 / 256 = 4.7% ✓          |

- Targets the **320×256** PAL reference: a player reads at ~1/21 of viewport height.
  (Stricter 1/19 anchor would be `VIEW_H = 228`; 256 chosen as the sourced reference and a
  gentler change to judge first — revisit if still too wide.) `VIEW_W` stays 320.

### Speed (the knob)

Calibrate so a full goal-to-goal solo run takes ~10s — slow enough that passing beats dribbling.

| constant        | was     | applied | note                                        |
|-----------------|---------|---------|---------------------------------------------|
| `PLAYER_SPEED`  | 96 px/s | **72**  | 720px / 10s = 72; = 1.2 px/tick @ 60Hz      |

- To recalibrate from footage: `heights/sec = 57 / (measured crossing seconds)`, then
  `per-tick = heights/sec × 12 / 60`.

### The pass/run ratio — the "football pinball" feel

A firm pass must travel **2–3× top run speed** (with enough ground friction to arrive
receivable). If the fastest dribbler can outrun a pass, passing dies and you get solo-dribble
football — the failure mode of the weak clones.

- `PASS_SPEED = 188` was **1.96×** run speed (96) — just under the floor, too dribble-friendly.
- The drop to 72 makes it **2.6×** with no change to `PASS_SPEED` — dead-center the band.
  Slowing the player fixes zoom-perceived-speed *and* restores passing primacy at once.
- Trimmed proportionally (×0.75) to preserve relative feel at the slower run speed:
  `SLIDE_SPEED` 168 → **126** (still 1.75× run), and the loose-ball poke 150 → **112**.

## Reference files

- `pitch_frame.py` — generates the approved still frame (palette, pitch texture, goal,
  shadow projection, scene composition). Source of truth for the look.
- `run_anim.py` — run-cycle GIF (sprite construction, cycle timing, world-space grass,
  camera-follow scroll).
- Port these by translating the per-pixel drawing into `OffscreenCanvas` + `fillRect`
  per pixel at generation time (done once at boot, performance irrelevant).

## Known deltas vs. target look (fix during step 2/8)

- Diamond banding still slightly too strong → reduce GRASS_L/GRASS_D contrast further.
- Goal side netting missing (angled mesh panels crossbar→ground posts) — main remaining 3D cue.
- Run cycle leg spread too subtle (see note above).
- Crowd should have row structure, not pure noise; add sparse waving-arm pixels.
