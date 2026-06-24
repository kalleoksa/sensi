# Plan: save game state + a controls view

Status: **plan**. Two asks: persist long tournaments so they survive a
refresh/close, and a controls reference reachable from the menu and mid-match.

## 1. Saving the tournament

**Where — `localStorage`.** The game is a static client-only app (Vite on
Vercel, no backend), so the natural store is `localStorage`: synchronous,
~5MB, per-origin, survives refresh/close. The save is a few KB of JSON — no
need for IndexedDB, and there's no server to sync to. (A copy-paste "save code"
could be a later extra; localStorage is the primary.)

**What — the competition, not the live match.** Competitions (League / Cup /
World Cup) are the long modes and are currently in-memory only
(`competition.ts`). We save **between matches** (at the hub / after a result),
not mid-match — the live match is 22 players + ball + clock and isn't worth
serialising; resuming drops you back at the hub with the bracket intact, the
way the original "continue" worked. Friendlies aren't saved (one-off).

**How — serialise by id.** `Competition` holds `TeamDef` *references* (you,
each `Fixture.a/.b`, `groups`, `champion`) and an `Rng`. JSON can't hold
references, so:
- store every team as its **`id`** string; rehydrate via a `TEAMS` id→def map on
  load.
- the **`Rng`**: mulberry32's state is the closure var `a`. Add `getState()` /
  `setState()` to the `Rng` interface so the PRNG position round-trips (resumed
  auto-sims stay deterministic). *(Simpler fallback: re-seed on load — the saved
  results are preserved either way; only future randomness differs.)*
- save shape: `{ version, kind, youId, roundIndex, rounds: [[{aId,bId,sa,sb,played,winnerId}]], groupsIds, championId, youOut, rngState, options }`.

**When — auto-save.** Write the save whenever the comp advances (after a result
/ entering the hub); clear it when the tournament ends or you quit to menu. One
slot ("current tournament") keeps it simple.

**Resume — `CONTINUE` on the main menu.** If a save exists, show `CONTINUE` at
the top of the main menu → load + jump to the comp hub. Starting a new
World Cup/Cup/League overwrites the slot (optionally confirm if one's in
progress).

**Pieces:** `save.ts` (serialise/deserialise + localStorage read/write);
`rng.ts` (state accessors); `competition.ts` (id↔def hydrate helpers);
`app.ts` (auto-save hooks, `CONTINUE` entry, clear-on-finish).

**Caveats:** per-browser/device only; clearing site data wipes it; mid-match
progress isn't saved (only between matches). A `version` field lets us reject
incompatible old saves rather than crash.

## 2. Controls view

A simple read-only screen listing the bindings (pulled from `input.ts`):

| Action | Key |
|---|---|
| Move | Arrows or WASD (P1 = WASD, P2 = Arrows) |
| Pass | tap Action (Space / Enter) |
| Shoot | hold Action |
| Tackle (poke) | tap Action without the ball |
| Slide | hold Action without the ball |
| Header | automatic on a high ball |
| Pause | P |
| Quit to menu | Esc |
| Play again / restart | R (at full time) |

**From the menu:** add `CONTROLS` to the Options screen (or main menu) →
a `controls` screen that draws the table; Esc returns.

**Mid-match:** the pause overlay already shows `PAUSED`; add a `CONTROLS` hint
there and let a key (e.g. `C`, or reuse the menu) toggle the same controls panel
over the paused match, so it's reachable without leaving the game.

**Pieces:** a `controls` screen + draw function in `app.ts`; an Options/menu
entry; a pause-screen toggle that overlays the panel. Pure UI — no sim impact.

## Suggested order
1. **Controls view** — quick, pure UI, immediately useful.
2. **Save/continue** — `save.ts` + rng state + `CONTINUE`, auto-saving between
   tournament matches.
