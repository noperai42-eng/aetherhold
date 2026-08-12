# Round notes

One round, one measured gap, one fix. Newest first.

---

## 2026-08-12 — Two promises that had only ever printed one verdict

**Track A.** Tests only; no behaviour changed and none was meant to.

### The gap

Three round notes in a row have closed with the same line: `every-ending-is-reachable` and
`no-ending-is-free` have no unit tests. Both are `enforced: false`, and on every grid ever run
they report `broken` or `untested` — which is the honest state of the game rather than a fault
in either check. Sixty days reaches one ending of three, and until one lands there is nothing
for the second promise to read.

That is exactly what made them worth testing and easy to keep not testing. **A check that has
only ever printed one verdict has never had its other branch executed.** The `holds` branch of
both, the detail line that names which roads came up short, the floor that separates a colony
which never fell out of the running from one that skipped the whole commitment — none of it had
ever run, anywhere, once. The day the grid's clock grows or a road gets faster is the day both
are read for the first time, in a report nobody is standing over.

### The fix

Eleven cases in `tests/balance-principles.test.ts`, building the grids the sim has not managed
to produce yet.

- **Every road going somewhere** (6) — a thirty-day grid is `untested` and not `broken`, because
  a promise that reported three unreached endings there would be describing the clock and calling
  it the game; a full-length grid whose colonies all died first is `untested` too, and that is
  the failure that looks most like the real one; the three endings **spread across three
  colonies** hold, which is the only shape that can keep this promise, since committing to one
  ending shuts the other two; the broken detail names the unreached roads with the rung anybody
  got furthest to, because *best rung 3 of 4* and *best rung 1 of 4* are two different problems
  wearing the same sentence; a commitment still paying when the clock stopped is not an arrival;
  and it reads `sweep.war` and not `sweep.runs`.
- **An ending costing what it says** (5) — `untested` on a grid with no landing; the slowest
  printed rather than the average, because the interesting colony is the one that lost days in
  the middle; **exactly `ENDING_DAYS` holds**, since a floor is a floor and a `<=` would call the
  best possible run the breach; a landing on the commitment day breaks and is named down to the
  colony; and a landing whose commitment day was never written down is skipped rather than scored
  from day nought — pinned because it is a *silence*, and treating the missing day as zero would
  read as a pass on exactly the records that lost data.

The last point is the one worth arguing with later. Skipping means a promise about endings goes
quiet on a damaged record. The alternative reads worse: the comfortable default is the one that
passes.

### Before / after

Both checks were mutated to prove the cases are load-bearing rather than agreeable:

- `<` → `<=` on the ending's floor — **3 of the 5 fail**, including the boundary case written
  for it.
- `s.war` → `s.runs` on the reachability check — **4 of the 6 fail**, including the one whose
  whole subject is which family gets read.

`src/eval/principles.ts` was restored to `HEAD` after each and verified with `git diff --stat`;
the fingerprint the grid reads is untouched, so `.eval/measurements.json` is still valid.

### Verified

- `npx tsc --noEmit` — clean. Two errors on the way there, both mine and both caught by it
  rather than by the suite: `EndingId` lives in `sim/endings.ts` and not `sim/types.ts`, and the
  eval `Verdict` for a dead colony is `collapsed`, not `wiped`.
- `tests/balance-principles.test.ts` — **75 passed** (was 64).
- `npm test` — **95 of 97 files, 1,822 passed, 13 skipped**, 911.01 s.
- `npm run build` — exit 0, and **byte-identical** to the last round: 919.45 kB JS, 23.76 kB CSS,
  down to the content hash in the filename. That is the result this round wanted. A tests-only
  round that moved the bundle would mean something had been changed that was not meant to be.
- Dual-view honesty: nothing outside `tests/` changed.

### Next target

- **Track B, and it is overdue: L5 Motion.** It is the widest gap between the two cameras and it
  has been named as next in three round notes without being picked up. A settler crossing the
  yard reads fine from above and reads as a slide from eye level.
- The grid clock is still the open product question — sixty days reaches one ending of three.
  Growing it to ~120 is the user's call, and the two promises above are now instrumented well
  enough that the day it changes, the report says so on its own.

---

## 2026-08-12 — The card knew how many, and not who

**Track A.** Stage 5c, the last piece of the endgame plan.

### The gap

`ENDGAME.md` has carried the same paragraph since it was written, under a heading that says
*the one thing to build now for the sequel*: when a colony reaches an ending, write out who
left — names, skills, traits, gear, injuries, who was married to whom, who is buried back in
the valley and did not come. **It is cheap to emit at stage 5 and expensive to reconstruct
afterward from a save that never recorded it.**

Nothing was emitting it. `EndingRecord` froze the day, the standing count and a copy of
`world.stats` — how many settlers saw it through, and not one of their names. That is a
one-way door and it was standing open: `world.pawns` drops an unburied corpse at `ROT_TICKS`,
skills move every day the colony works, and a settler shot a fortnight after the ship sails
looks in a save exactly like a settler who boarded wounded. A save written today and read by
anything later can answer *eight* and can never answer *which eight*.

### The fix

`takeManifest` runs on the landing tick, beside the tally, and freezes with it.

- `src/sim/types.ts` — `EndingRecord.manifest?: ManifestEntry[]`, **beside** `stats` and not
  inside it, because a test pins that tally as a bag of numbers and a shallow copy is only
  honest while it stays flat. `ManifestEntry` is every settler the colony still had a body for:
  `id`, name, fate, every skill they had a level in, traits, weapon, apparel, gear, how much of
  them was missing, and the partner they came here with.
- `src/sim/endings.ts` — `takeRecord` split into `takeTally` and `takeManifest`. Three fates:
  `left` (the ship and the berths take the colony off the map), `held` (the dominion is the one
  you win by staying), `lost` (everyone the colony buried and everyone it never got to bury).
  Skills are floored, because a level is what a level means everywhere else in the game and
  `4.83` would put settlers on the roll at *cooking 0*.
- **New** `src/client/manifest.ts` — the record is complete on purpose and a card is not, so
  the trimming is a decision with an opinion in it: two headings, three skills, one soft line.
  It returns rows rather than HTML; `hud.ts` gets the tags and the escaping and nothing else.
  Its own module for the reason `pace.ts` and `overlays.ts` are theirs.
- `src/client/ui/hud.ts` + `ui/style.css` — the roll under the final tally, name over trade
  over notes, on a card that already scrolls.

Two decisions worth naming because a later reader will want to undo them:

**A record written before the manifest existed reports a tally and no roll, and
`endingRecord` refuses to fill it in.** The fallback for a stale *number* is fine — a number
has drifted. A roll read twenty days late is a *different list of people*: settlers on it who
walked in after the ship sailed, missing the ones who were on board. There is no honest way to
answer *who left* out of a world that has moved, so it does not answer.

**The partner is read off `world.partners` raw, not through `partnerOf`.** That function
answers *do they have somebody now* and so returns null for the one who is left — right for the
inspector, wrong here. Somebody walking onto a ship alone who did not board it alone is the one
line on this card worth reading twice.

### Before / after

- **PLAYTEST 9oo — "Read the roll"** (new, follows 9nn). Before: the ending card ended at
  *Settlers lost: 2*. After: two headings and every name under them, and two checks that cost
  something — a settler whose partner is buried, and a fortnight of play after the landing that
  must not move a single row.
- **`tests/endings.test.ts`** (+10, 24 → 34) — the roll holds the dead and drops the
  prisoners; ship and moor file their people differently; a buried partner is still named;
  whole levels only, best first; frozen on the landing tick; copies and not a window onto the
  pawns; through a save and back; and a record written without a roll does not grow one.
- **`tests/manifest.test.ts`** (new, 10) — what the card is allowed to say. The dead in their
  own list under the living, the fate in the heading rather than in every row, three skills and
  the rest left in the record, an empty line for somebody with no trade rather than an invented
  judgement, wounds on the living and silence on the dead, and a trait a later build no longer
  has costing that settler one word instead of the card.
- **`tests/architecture.test.ts`** — one new rule, *"asks one module who goes on the ending
  card"*: `hud.ts` imports `../manifest`, calls `manifestSections`, and never reads
  `.manifest?.` itself.

### Verified

- `npx tsc --noEmit` — clean.
- `npm test` — **95 of 97 files, 1,811 passed, 13 skipped**, 818.31 s. Twenty-one of those are
  this round's, and the run was taken after the last edit and not beside it: an earlier pass was
  killed mid-flight when the de-gendering sweep was still going, because a suite that predates a
  line is not evidence about it.
- `npm run build` — exit 0. 919.45 kB JS (263.04 kB gzip), 23.76 kB CSS (5.15 kB gzip). The
  manifest cost **1.60 kB of JS and 0.35 kB of CSS**. Almost all of that JS is `endings.ts`: the
  card's half is one `map` over rows, and the sim's half is the part that has to walk every pawn
  and copy them.
- Dual-view honesty: the sim half writes a plain-JSON list and imports nothing new; the client
  half is a pure function over that list. Neither camera can show a different roll, because
  there is one roll and it stopped moving on the tick it was written.

### Next target

- Track B, still unclaimed: **L5 Motion** is the layer with the widest gap between the two
  cameras. A settler crossing the yard reads fine from above and reads as a slide from eye
  level.
- Still open from stage 5a: `every-ending-is-reachable` and `no-ending-is-free` have no unit
  tests in `tests/balance-principles.test.ts`, while the three road promises and 5b's do.
- The grid still only reaches one ending of three. That is a clock question as much as a
  balance one — sixty days gets the tree to 17 projects of 19 — and growing it to ~120 is the
  user's call, not a code change.

## 2026-08-12 — An overlay in first person was a trap

**Track A.** No Track B this round; the measured gap was not visual mush.

### The gap

The HUD's four overlays — key list, colony-code box, new-colony card, ending — live in one DOM
tree over both views. First person holds the pointer lock. A locked pointer is *no cursor at
all*, so any of the four landing on a possessed body was unanswerable, and one of them lands
without being asked for: the ending card opens on the tick a colony is founded or a ship sails,
whichever camera the player happens to be behind.

Three things were wrong at once, and all three were provable from the source rather than
guessed at:

- `Input` binds `keydown` and `mousemove` to `window`, not to the canvas. `App.step()` had no
  gate on either `fpsFrame()` or `fps.applyTick()`, so **W kept walking the settler and the
  mouse kept turning a head the player could not see**, behind the card.
- `input.releaseLock()` had exactly one caller in the whole client — `exitFps()`
  (`grep -rn releaseLock src/client/`). Nothing handed the pointer back when a card opened, so
  **there was no cursor to press any button with**.
- `globalKeys()` had Escape routes for help, backup and setup, and **none for the ending card**
  — which is the one card the player did not open. The HUD exposed no accessor for it either.

Escape was not a way out on its own: Chrome consumes the keypress that exits a pointer lock, so
the page never sees that keydown. A locked player pressing Escape got a cursor back and the
card stayed exactly where it was.

### The fix

One rule: **while an overlay is up, the body reads no input and the pointer goes back.**

- **New** `src/client/overlays.ts` — `anyOverlayUp`, `bodyMayAct`, `pointerMustBeFree`, and the
  `Overlays` shape. Its own module, importing only a type from `sim/save`, for the reason
  `pace.ts` is its own module: `app.ts` cannot be loaded outside a browser, and a rule about
  who is allowed to move should be provable rather than asserted in a comment.
- `app.ts` — `overlays()` reads the four HUD flags; `step()` gates the per-frame `fpsFrame()`
  and the per-tick `applyTick()` on the same `bodyMayAct` answer and calls `releaseLock()` when
  `pointerMustBeFree`; `globalKeys()` gains an Escape route for the ending card and then stops
  at a guard, so pause, the view swap and every panel key belong to the card while it is up.
  (That last one also fixes a smaller thing nobody had written down: a `p` typed into the
  colony-code box used to open the work tab underneath it.)
- `ui/hud.ts` — `endingOpen` and `closeEnding()`, matching the existing `helpOpen` /
  `backupOpen` / `setupOpen` shape, plus `endingDismissible`. The wipe card refuses to close:
  it has no dismiss button either, because there is no colony behind it to go back to.

The world keeps ticking behind the card. That is deliberate and it is stage 5b's promise — an
ending that stopped the colony would contradict the card that says *keep playing*.

### Before / after

- **PLAYTEST 9nn — "Take a card in a body"** (new, follows 9mm). Land an ending while walking
  in first person. Before: locked mouse, no cursor, W still walking, no Escape. After: the
  pointer comes back on the frame the card opens, the settler stands still, Escape closes it,
  and the *Click to look with the mouse* hint is waiting when it goes.
- **`tests/overlays.test.ts`** (new, 9 tests) — the rule over all sixteen combinations of the
  four overlays: the body has its controls only on an uncovered screen, loses them to any one
  of the four, has none to lose at the desk, and the pointer is handed back on exactly the
  frames the body is not driving.
- **`tests/architecture.test.ts`** — one new rule, *"asks one module who has the hands while a
  card is up"*: `app.ts` imports `./overlays` and mentions both decisions. Pins the wiring,
  which is the half a refactor drops silently.

### Verified

- `npx tsc --noEmit` — clean.
- `npm test` — **94 of 96 files, 1,790 passed, 13 skipped**, 1,477 s. Ten of those are this
  round's, and the run was taken *after* the last edit rather than beside it: an earlier pass
  that started before the `syncHud` change was discarded as the record even though it was green,
  because a suite that predates a line is not evidence about it. ACCEPTANCE.md carries the
  breakdown.
- `npm run build` — exit 0. 917.85 kB JS (262.44 kB gzip), 23.41 kB CSS. The rule cost 1.26 kB
  of JS and nothing at all in CSS, which is the right price for a thing that only decides who
  reads the keyboard.
- `npm run measure -- --days 60 --past-founding` then `npm run balance` — 39 colonies in
  2,847 s, 4 green. Not this round's work, but it is the first grid that could read stage 5b's
  two promises and both came back green, so the docs stopped deferring them.
- Dual-view honesty: nothing in `sim/` was touched. The rule reads `ViewMode` and two booleans;
  it cannot desync a view from the world because it never looks at the world.

### Next target

- **Stage 5c, the manifest** — who actually left, by name. `EndingRecord` is the hook, and the
  ending card is the place it belongs.
- Track B, when a round is free for it: **L5 Motion** is the layer with the widest gap between
  the two cameras. A settler crossing the yard reads fine from above and reads as a slide from
  eye level.
- Still open from stage 5a: `every-ending-is-reachable` and `no-ending-is-free` have no unit
  tests in `tests/balance-principles.test.ts`, while the three road promises and 5b's do.
