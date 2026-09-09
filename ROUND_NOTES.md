# Round notes

One round, one measured gap, one fix. Newest first.

---

## 2026-09-09 — The grass gets a dial, and the bench gets caught measuring in metres

**Track: the forge.** Stage 5 of [FORGING.md](FORGING.md), first family. `decor.ts` for the
tuft's recipe, `src/forge/` for the bench entry and two faults the frames found in the bench
itself.

### Why grass, and not the table

FORGING.md guesses an order and says out loud that the photographs overrule it. They did.
The sweep's frames are stills, and grass is the one model in the game whose defining property
is that it moves — it is also the only one that cannot be exported to `.glb`, so the bench is
the only place its shader sway can ever be looked at on its own. That is a stronger argument
for going first than "every cell has them", which is what the table offered.

### The fix

`TuftRecipe`/`TUFT_DEFAULT` and `SwayRecipe`/`SWAY_DEFAULT` in `decor.ts`; `GRASS` in
`recipes.ts` with eighteen fields. `time` and `wind` are the last two and are deliberately
outside `recipe()`: they are the weather, not the tuft, and the printed block is a thing you
paste back into `decor.ts`, where the weather does not live. The bench opens at `time = 1`
because at `t = 0` both sines are zero and a dead-straight tuft is easy to mistake for a
broken shader.

Three things had to be true before a tuft would stand on the bench at all. The sway lives
inside `#ifdef USE_INSTANCING` and reads `instanceMatrix[3].xyz`, so a plain `Mesh` compiles
without the branch and stands perfectly still — the bench builds an `InstancedMesh` of count
one. Height and girth are drawn from `hash`, now exported, because a bench that drew its own
spread would show a spread the map does not have. And `${1}` spliced into GLSL is an int, so
`uTime * 1` fails the whole compile: every injected number goes through a one-line `glsl()`
that guarantees a decimal point.

### What the frames said about the bench

Both faults are the bench's, not the grass's, and only a small model could have found either.

- **Eighteen knobs did not fit the panel.** The single-tuft frame and the twelve-grid frame
  captured different slices of it, which breaks the one thing stage 4 stamps a frame with —
  every number that made the model standing in it. The panel is 320px now, with label, slider
  and box on one line.
- **The grid's gap was 0.45 metres flat.** That is a fifth of a tree and five times a tuft, so
  twelve tufts came back as specks in an acre of turf while twelve stones filled the frame.
  The gap is a fraction of the widest model now. A bench holding forty-two models between a
  pebble and a longhouse cannot space them in metres.

### What the frames said about the grass

Scrubbed across `t = 0, 0.5, 1, 1.5` the tuft is dead vertical, leans right, leans further,
and eases back, with the bases pinned — the sway works and is now judgeable. It is also only a
lean. The phase is a function of where a tuft stands, so every blade in one tuft shares it and
a tuft tilts as a rigid fan rather than rustling. In a field that reads fine, because
neighbours stand elsewhere. Alone it is the honest limit of the shader, and a per-blade phase
would mean a new geometry attribute and a change to how the game's grass looks. That is the
next brief, not this round.

### A pin that was not there

The drill found this, not the code. `tipReach` was mutated 0.45 → 0.46 and all fifty-two tests
stayed green: the golden digests are positions only — correctly, since occlusion writes vertex
colours — and `tipReach` writes nothing but colour. A knob had been exposed with nothing
holding it, which is the one risk FORGING.md names for this whole plan. The tuft's root-to-tip
ramp is now written out as five exact numbers, one per blade, rather than as bounds; the first
draft used bounds and the same mutation walked through them too.

### Verified

- `npx vitest run tests/forge-recipes.test.ts` — 54 passed, up from 41.
- Mutation drill, five pins, each failing exactly one named test: a blade's bend (tuft golden),
  `glsl()` dropping its decimal point, the empty-blade-table rule, a constant height draw, and
  `tipReach` against the new ramp table.
- `npx tsc --noEmit` clean; full suite green.
- `npm run look:forge` — `3/3 models: stone, grass, tree`, `3 of 42 assemblies on the bench`,
  no console errors. Frames in `.look/shots/r21-forge/`, sway sheet in `.look/shots/r20-sway/`.
  Every frame on the sheet carries its whole URL, the eighteen grass fields included, and the
  panel fits inside all six.

### A scar

Mid-round, `git checkout -- src/client/render/decor.ts src/forge/recipes.ts` was used to undo a
mutation. It restores from the index, and the index was the commit that had just been made — so
it took the round's uncommitted work with it. Recovered by replaying the edits out of the
session transcript and confirmed by the golden digest matching byte for byte, but the lesson is
cheap to write down: undo a deliberate mutation by copying a file back, never by asking git,
unless the work is committed first.

---

## 2026-09-09 — An address for a shape, and a sheet that admits how little it covers

**Track: the forge.** Stages 3 and 4 of [FORGING.md](FORGING.md). Nothing in `src/client/`
or `src/sim/` was touched at all; the whole round is `src/forge/`, one new look script and
its row in [LOOK.md](LOOK.md).

### The gap

The bench built in the last round is a viewer. You can move eleven sliders until a tree
looks right, and then the afternoon ends and the only thing that survives it is a memory of
a shape. There is no way to tell somebody which tree you meant, no way for a round note to
link the thing it is arguing about, and no way to get a shape you found back into
`decor.ts` except by reading eleven numbers off the screen and retyping them.

And there is no census. Two models are on the bench and forty are not, and nothing said so
out loud — which is exactly the failure FORGING.md's own risks section names: *a bench
covering eight models that says it covers the game*.

### The fix

**`src/forge/address.ts`** — the two small things that turn browsing into refining.

- **The address.** Every field round-trips through the query string on `change`, so a frame
  has a URL. Every field, including the ones sitting at their default: a shorter URL that
  omitted them would quietly change meaning the afternoon somebody moves a constant in
  `decor.ts`, and a link in a round note that shows a different rock than it did when it was
  written is worse than no link. Written on `change` and not on `input`, because a drag
  fires `input` per frame and Safari throws after a hundred `replaceState` calls in thirty
  seconds.
- **The paste.** The whole recipe — the lathe profiles included, which are on no slider — in
  a `<details>` with a Copy button. It is real JSON with quoted keys, and that is not
  pedantry: it is what lets a test parse the printed block back and run the done-criterion
  instead of an eye judging it. A profile pair stays on its own line, because
  `JSON.stringify(r, null, 2)` turns the tree's forty radius-and-height pairs into a hundred
  and sixty lines of column.

**`scripts/look/forge.mjs`** and `npm run look:forge` — the sweep, built the way `review.mjs`
is built. It reads `.index a` off the bench itself rather than carrying a list, so a recipe
added to `recipes.ts` is photographed on the next run without anyone coming here; an empty
index throws by name rather than writing a cheerful sheet of nothing. Two frames per model —
the bench and its `Generate 12` — plus one contact sheet.

`render-art-review.mjs`, which FORGING.md cites for stamping frames, is Evergrow's script
and not this repo's, so the stamp is made differently: the shot is of the whole `.bench`
rather than of the canvas, which puts every slider in the picture, and the exact URL of each
frame goes into `<label>-frames.json` beside it. A harness that doctors the page before
shooting it produces frames that are not quite the page.

### The sheet that said two of two

The first contact sheet's header read `2 of 2 models`, which is true and reads as complete.
The census now comes from `models/manifest.json` — the forty-two assemblies `npm run
export:models` writes — so the header reads **`2 of 2 shot, 2 of 42 assemblies on the
bench`**, and a box that has never run the export is told the census is unknown rather than
quietly given a smaller denominator. That number is the whole point of stage 4 and it should
be uncomfortable to look at for another few rounds.

### Before / after

Four frames plus the sheet, `1280×800 @1.5×`, in `.look/shots/r18-forge/`.

- **`r18-sheet.png`** — the four bench frames with the full recipe URL printed under each,
  which is the artefact this round exists to make: a picture whose caption is the thing that
  produced it.
- **`r18-stone.png`** / **`r18-tree.png`** — the bench with the recipe block open. Every
  number that made the shape is in the frame twice over, on the sliders and in the paste.

One thing was changed because of the frames rather than because of the code: the eleven
sliders were the browser's default blue, and blue was the one thing in a bench picture that
was not this game. They are `accent-color: var(--edge-strong)` now — the colony's amber. A
bench frame is meant to differ from a game frame by the camera and the ground and nothing
else, and that is a difference the code could not have told anybody about.

The pebble's cast shadow still peter-pans, for the reason last round gave: the bench
inherits the map-sized shadow frustum from `sky.ts`, and a bench with a kinder shadow map
would be a bench that lies about the map. Left alone, deliberately, for the second round
running.

### Verified

- **The done-criterion is run rather than looked at.** Three experience tests parse the
  printed JSON block back and build from it: a rock's golden digest, a tree's trunk and all
  four skirt digests, and a tree rebuilt from its own query string. If the paste ever stops
  being the shape on screen, those go red.
- **The new pins were watched fail.** Three tempting shortcuts were applied to `address.ts`
  at once — falling back to the default on an unreadable value, omitting default fields from
  the URL, and plain `JSON.stringify` — and exactly the four intended tests went red
  (`4 failed | 37 passed`). A pin nobody has seen fail is not a pin.
- **The sweep's loud-failure path was exercised.** `forge.html` moved aside gives
  `Error: the bench index listed no models — is the dev server on forge.html?` and a non-zero
  exit, rather than an empty sheet.
- `npx vitest run tests/forge-recipes.test.ts` — **41 passed**, eleven more than last round:
  eight on the address and the printed block, three on the round trip.
- `npx tsc --noEmit` — clean.
- `npm run look:forge -- .look/shots/r18-forge r18` — `2/2 models: stone, tree`, nothing
  missed, and **no console errors**.

---

## 2026-09-09 — A bench for one model at a time, and the rule that was wrong about trees

**Track: the forge.** Stages 0, 1 and 2 of [FORGING.md](FORGING.md). No player-facing
behaviour changed; one line of `buildings.ts` was exported and nothing else in `src/client/`
or `src/sim/` was touched.

### The gap

There are forty-one procedural models in `src/client/render/` and no way to look at one.
Shaping a rock means editing a constant in `decor.ts`, restarting vite, walking a colony
until a rock is in frame, and comparing it against a memory of the last one. The numbers that
make it — `STONE_LUMP`, `STONE_SINK`, the trunk profile, the four skirt profiles — are
module-private constants with no name a person can turn, and the only rock you ever see is
whichever one the seed happened to hand you. Evergrow's asset engine is the contrast that
made this legible: it generates and then *refines*, one item at a time, on a bench that is
not the game. This repo generates and then ships.

The second half of the gap is that the constants have never been pinned. Nothing in the suite
would have noticed if a refactor moved a vertex, which makes every change to that code a
change made on faith.

### The fix

**New `src/forge/`** — the bench, and a sibling of `src/review/` rather than a mode inside
it, protected the same way by the same mechanism: `forge.html` is served by vite in dev and
deliberately absent from `vite.config.ts`'s `build.rollupOptions.input`, so it cannot reach
the players' bundle, while staying inside `tsconfig` so `npm run build` typechecks it and it
cannot rot silently. `tests/forge-recipes.test.ts` guards the one-way rule directly: nothing
under `src/client/` or `src/sim/` may import from `src/forge/`.

- **`recipes.ts`** — a `Bench` per shapeable model: its fields with bounds, its defaults, its
  `problems()` and its `build()`. Two of them so far, stone and tree. The defaults are the
  constants that are already in the game, imported rather than retyped, so the bench's
  starting picture is the colony's picture by construction.
- **`stage.ts`** — the room the model stands in: an empty ground plane in `TERRAIN_COLOR.grass`,
  a fixed three-quarter camera that frames whatever it is handed, and the colony's own
  `SkyView` read out of `sky.ts` and `palette.ts` rather than a light rig invented for the
  bench. A model that looks right here looks right on the map, which is the whole point of
  not inventing one.
- **`forge.ts`** — the back half. `benchWorld()` freezes a clear noon; `prototypes()` syncs a
  real `BuildingsView`, bakes its occlusion and reads the pools through `assemble()`, so the
  bench tree wears the renderer's own material and the renderer's own baked contact shadow.
  Validation lives here and not in the builders, which are called forty times a frame.
- **`main.ts`** — a slider and a number box per field, live redraw on `input`, a seed field, a
  Random seed button, a **Generate 12** button that lays a deterministic grid of twelve seeds
  under the current recipe, and a history strip of the last sixteen recipes looked at. No
  parameter shows an index in the same `.index a` markup the review page uses, so stage 4's
  sweep can read the page's own list.

**`src/tools/assemble.ts`** was split out of `models.ts` for this. `models.ts` writes `.glb`
and so imports `node:fs`, which a browser bundle cannot resolve; the gathering logic the
bench needs is now in a file that touches no filesystem, and the export script imports it
back. One line of `buildings.ts` changed: `TREE_SKIRTS` is exported, so the crown rule can
check the recipe against the number of skirt pools the view actually draws rather than
against a four written twice.

### The rule that was wrong

FORGING.md's stage-1 plan said a lathe profile must be monotonic in height. The test written
against that sentence went red on the tree the colony already grows — twelve messages of the
form *skirt 1 runs downhill at point 1: 2 then 1.9*. The sentence was a wrong reading of the
recipe, not a bug in the wood: a bole climbs, but a skirt of boughs is a closed bowl that
runs out and *down* under the branches and back up over the top, and all four of the wood's
skirts double back. The rule is kept where it is true, FORGING.md is corrected in place with
the mistake left visible, and the test now guards the exemption as well as the rule. This is
the argument for writing the goldens before exposing the knobs, arriving on the first day it
could.

### Before / after

Four frames, `1280×800 @1.5×`, in the scratchpad rather than committed — they are a
before-and-after of a bench, not of the game.

- **`tree.png`** — one Aetherhold tree on grass under the colony's own sun: the right green,
  the bark brown from `buildings.ts`, a baked contact shadow and a cast one, and eleven knobs
  reading their defaults beside it.
- **`stone-lump-060.png`** vs. the default — `lump` moved from 0.3 to 0.6 in the number box
  is a plainly different rock, with no rebuild and no restart, and the history strip behind it
  reads `3.7*` then `3.7`. That is stage 1's done-criterion met on screen.
- **`tree-12.png`** and **`stone-12.png`** — twelve visibly different crowns and twelve
  visibly different stones in a 4×3 grid, which is stage 2's: a round note can now carry a
  single before-and-after pair of twelve-rock grids instead of an anecdote about one rock.

One artefact seen and deliberately left: the pebble's cast shadow peter-pans. The bench
inherits the game's map-sized shadow frustum and bias from `sky.ts`, which is exactly what
stage 0 asks for — a bench with its own kinder shadow map would be a bench that lies about
the map.

### Verified

- **The ten golden digests are byte-identical across the refactor.** `tests/forge-recipes.test.ts`
  hashes positions rounded to a micrometre plus vertex, index and bounding-box counts for
  `decor.stone` and all nine tree pools, captured before the recipe structs existed and
  unchanged after. Positions only, and on purpose: occlusion writes vertex colours, so
  retuning a contact shadow must not read as a moved model.
- **The golden test was watched fail.** `STONE_LUMP` nudged 0.3 → 0.31 produced
  `× decor.stone is unchanged` — `1 failed | 9 passed`. `decor.ts` was then restored and the
  constant reconfirmed. A pin nobody has seen fail is not a pin.
- `npx vitest run tests/forge-recipes.test.ts` — **30 passed**, the ten goldens, nine
  validation rules including the skirt exemption, ten experience tests driven through a real
  `BuildingsView`, and the dependency guard.
- `npx tsc --noEmit` — clean.
- Browser run of `/forge.html`: index reads `stone, tree`, history reads `3.7* 3.7`, and
  **no console errors**.
- `npx vitest run` — the whole suite, green: **125 of 127 files, 2,480 passed**, 13
  skipped, 1,249 s. Thirty of those are this round's and the rest are the reason the
  refactor can be believed — `decor.ts` and `buildings.ts` are load-bearing for the map,
  the export script and the look harness, and all three read the same builders the
  recipes now go through.
- `npm run build` — exit 0, `dist/index.html` alone. `benchByName`, `forgeSeeds` and
  `Generate 12` appear zero times in the bundle; the only `forge` in it is the game's own
  word. Typechecked and not shipped, which is the pair of promises the harness pattern is.

### Next target

- **Stage 3, the address** — the recipe in the URL and a JSON box to paste one into, so a
  round note can carry the exact rock rather than a picture of it.
- **Stage 4, the sweep** — `scripts/look/forge.mjs`, so the look loop photographs every bench
  the way `review.mjs` photographs every panel.
- **Stage 5, the other thirty-nine.** Stone and tree were chosen because they are the two ends
  of the range: one geometry with three numbers, and nine pools with two profile families.

---

## 2026-09-09 — What the kit is doing, and the body nobody could ask

**Track: the interface.** One complaint, and two things found underneath it that had the
same shape: the game knew a number and never said it.

### The gap

*"Should also be able to click on dead bodies and see what they are doing and strip the
bodies of clothes and items they are wearing."* Half of that is a simulation change and is
not in this round. The other half was two defects rather than one. The manager's click
resolved to the living only — `pawnAt` skipped a corpse before asking anything of it — so a
body was the one thing on the map you could point at and get silence from. And behind that,
if the click had landed, was the living settler's card: mood, rest, recreation, an errand
line, and Draft, Take over and Possess on somebody who is dead.

The second gap was found while looking for the first. The settler card printed what somebody
had on as two bare names, `fur parka` and `toolbelt`, and said nothing about what either
does. `gear.ts` has known the numbers all along — a parka is +0.85 warmth and five per cent
armour; plate is forty per cent armour bought at ninety-two per cent work and *minus* fifteen
hundredths of warmth — and none of it had ever reached a player. This is the same complaint
as the corpse card in a different coat: the trade is the interesting part, and the panel was
printing the label.

The third is a harness gap, and it is why the first two survived so long. Neither panel is
one the game holds still in. A corpse card is only ever read in the ten seconds after a raid
with half the colony downed, and a good gear comparison wants a rifleman in a jerkin standing
in reach of a steel plate in a cold snap. Waiting for a colony to arrive at either is why
neither had ever actually been looked at.

### The fix

**New `src/review/`** — the mirror. `review.html` served by vite in dev and deliberately
absent from `vite.config.ts`, so it is never in the players' bundle; `scenes.ts`, a registry
of ten scenes, each a seed, a world built from it, and one exported panel function called
against that world; `main.ts`, which reads `?scene=` and renders the index when there is
none. It never steps the simulation, never touches a save, and draws with the game's own
functions rather than a copy of them. One panel a page, which the stylesheet decided rather
than anybody's preference: forty-five rules hang off `#inspector`, and an id appears once in
a document. `scripts/look/review.mjs` reads the scene list off that index, so a scene added
in `scenes.ts` is photographed on the next run without anybody remembering to come here.

**New `src/client/ui/kit.ts`** — facts only, on `cell.ts`'s seam, with the words in
`hud.ts`. `kitFacts` shallow-clones the settler, calls the simulation's own `equip`, and
reads the simulation's own accessors for each axis; it never does the arithmetic itself. A
presentation layer that computes what a jerkin is worth is a second implementation of the
rules, and the day the two disagree it is the player who is lied to.

**`hud.ts`** gains three things. `kitRows`, which puts what each worn piece is doing under
its name on the settler card, one axis a line so it cannot wrap. `kitPanel`, the comparison
card, which is built, tested and photographed and has *no in-game hover target yet* — the
player never chooses gear in this game, settlers craft for themselves, and `equip` is never
called from `src/client/`. It is written down here rather than quietly shipped into a menu
nobody can reach. And `corpsePanel`.

The corpse card is short on purpose, and short in a particular way: it is not the settler
card with the numbers greyed out. A body has no mood, no rest and nothing it would like to be
doing, and printing those at zero says something false about somebody the player cared about.
What is left is what is still true — who they were, what is still on them and what it is
worth, where they are lying, how long before there is nothing left of any of it, and their
story, which is the one thing dying does not take away. The rot clock is the row that makes
the card a decision rather than an obituary: four days, in days while there are days and in
hours once there are not, because a body with two hours left is not "1 day" and that is the
side of it where being wrong costs somebody.

**`manager/controller.ts`** — `pawnAt` no longer skips the dead. It ranks the living ahead of
them on a tie, because a body on the floor of the ward must not take the click meant for the
doctor kneeling over it.

### Before / after

- **`.look/shots/review/r0-corpse-with-kit.png`** and **`r0-corpse-stripped.png`** (new frames).
  The staged case reads: *fur parka, 5% armour, +0.85 warmth · toolbelt, 115% work · club ·
  lies at 93, 98 · rots away in 4 days*, and then two lines of their life. The empty case
  reads *carrying nothing* and still has a name, a place and a clock on it. The first shoot
  of the second frame said *weapon: rifle* under a caption reading "died with nothing on" —
  the founding settler comes armed, and the scene now disarms them, because a frame captioned
  one thing and photographing another is worse than no frame.
- **First shoot of the rot row** read *about 96 hours*. True, and not a unit anybody decides
  in. `colonyTime` stops at hours, which is right everywhere else it is used, so `rotWords`
  branches locally rather than changing a helper four other panels share.
- **`tests/corpse-card.test.ts`** (new, 22 tests) — that a click reaches a body, that it does
  *not* reach one at the cost of a living settler standing in the same place, what the card
  says, and what it refuses to say: no mood, rest, recreation, hunger, skills or bonds row,
  and none of the three buttons only a living settler could obey.
- **`tests/kit-card.test.ts`** (new, 21 tests) — every number the kit card prints re-derived
  by putting the piece on a real settler with the game's own `equip`, plus the one-way
  dependency: nothing in `src/client` or `src/sim` imports `src/review/`.

### Verified

- `npx tsc --noEmit -p .` — clean, with `src/review/` inside the project even though
  `vite.config.ts` never bundles it. That is the shape wanted: a harness that cannot rot
  silently and cannot ship by accident.
- `npx vitest run` — the whole suite: **2450 passed, 13 skipped**, 124 files (2 skipped),
  1178 s.
- `npm run look:review` — **10/10 scenes photographed, 0 console errors.** The scene list came
  off the review page's own index rather than out of the script, which is the property that
  matters: the two corpse scenes were shot on the run after they were written, without
  anybody editing the harness.
- The two new suites were watched fail before they were watched pass. Reverting `pawnAt`'s
  ranking turns `a dead colonist can be clicked` red; dropping the `p.dead` branch out of
  `syncInspector` turns all eight of `what a body no longer has` red at once. A test nobody
  has watched fail is a test nobody has checked.
- `expect(scene.render()).toBe(scene.render())` on every registered scene, because the whole
  before-and-after discipline rests on a frame being the same frame twice.

### Next target

- **Stripping the body**, which is the rest of the complaint and is blocked on a decision
  rather than on code. The five `EquipKind`s are worn state on a pawn, not items — there is
  no `rawfood`-shaped stack for a parka — so stripping needs either a new item kind per
  equippable or a direct body-to-settler transfer that skips the ground. The first keeps one
  rule for how things move and is more code; the second is less code and adds a second way
  for gear to travel. [DECIDING.md](DECIDING.md) stage 2 argues for the first and marks the
  choice as not the author's to make. Until it lands, the rot clock is a countdown with no
  lever on the end of it.
- **What killed them.** The one row the corpse card obviously wants and cannot honestly
  print: `damagePawn` is handed a `source`, spends it on the death message and keeps nothing.
  That is a change to what a pawn stores, which is stage 3.
- **`kitPanel` has no hover target.** It is built, tested and photographed, and the game
  gives a player nowhere to summon it from, because settlers craft their own gear and the
  player never chooses any. Stage 2's strip surface is the first place one exists.
- **The rest of the panels have never been photographed either.** Ten scenes is what this
  round needed; the review page costs nothing per scene after the first, and the settler
  card, the grave, the bench and the trade stall are all panels the game will not hold still
  in.

## 2026-09-07 — Look round sixteen, the ceilings learn to show themselves

**Track: the interface.** Round fifteen gave the right-hand column measured ceilings and
the numbers came back clean — no overlaps, the count row in view. Then the frames were
looked at, which is the only reason this round exists.

### A ceiling is half an answer

`NEXT STEPS` stopped at its new band by slicing a line through the middle of its glyphs:
"Defence tab → Sandbag. Half the" and then a second line cut horizontally in two. The
inspector did the same across its `doing` row. Both panels scroll — the content is
reachable — but nothing on the screen said so, and a sentence guillotined mid-letter reads
as a broken layout rather than as a panel there is more of. The measurements could not see
this; they reported panels inside their bands, which was true.

The desk was left out of the phone's fade rules on the argument that a desk announces
overflow twice, with a scrollbar and a resize grip. The scrollbar half of that is wrong on
the machine these frames are taken on: macOS draws overlay scrollbars, which appear while
you scroll and are invisible until then. The cue that would tell a player to scroll only
arrives once they already have.

So the desk gets the phone's twenty pixels. On a class rather than on the selector, because
these panels shrink to their contents and a settler card short enough to fit would have its
last line faded for nothing — the same lie pointed the other way. `hud.ts` decides the class
from three numbers together, `scrollHeight - clientHeight - scrollTop`, and re-asks from a
`ResizeObserver` and a passive scroll listener: the content changes when another settler is
selected, the band changes when the strip grows underneath, and the scroll position changes
when the panel is read to its end, at which point there is nothing left to promise.

### The sweep found six more than the eye did

The guard was written to sweep the stylesheet for anything that caps and scrolls rather
than to list the two panels that were caught, and it came back with the roster, the log and
five overlay tabs as well. All of them can cut a line; none of them said so. They are fixed
by the same mechanism rather than exempted, because an exemption is a thing somebody has to
argue again every time a panel is added. The log is the interesting one: it fits its line
count to its own height and so should never turn the class on at all, which has gone from
something somebody knows to something the frames can be checked against.

Two panels do answer differently, and are now **forbidden** the mask rather than merely
excused from it. `#alerts` has its sticky `+N more` row and `.card` its sticky footer of
buttons, and each says *what* is below the fold rather than that something is. Each
exemption names the rule that earns it, and the test makes that rule prove it is still
sticky.

### The count row was being buried by the other cue

The phone had both. `#hud.phone #alerts` was in the blanket fade list, so the mask fell
across the sticky row added last round and left `+5 more` dimmer than the five rows it was
counting, on a background the map showed through — the least legible thing on the panel,
which is the exact inversion of its purpose. Photographed, fixed by taking the strip off the
list, photographed again: the row is now the brightest thing at the foot of the panel and
the row above fades under it.

### A frame that lied about which screen it was

The Events tab count is a child of the Events button, so the button's `textContent` became
`Events15` — and both capture harnesses select tab buttons by matching that text. The match
failed, `b?.click()` swallowed it, and `T3-phone-events` was a photograph of the details
sheet filed under the events name. A wrong frame that looks exactly like a right one is
worse than a missing one, and this round nearly judged the phone strip from it.

The buttons now carry `data-key`, the harnesses select on that, and — the part that matters
— they check that the sheet they asked for actually came up and throw if it did not. The
same silent `?.click()` shape is still on the Play button in five scripts; it is not
implicated in anything yet and is left alone rather than fixed on suspicion.

`trouble.mjs` also gained a stopwatch on stderr. Two runs earlier had died inside a
`page.evaluate` that never returned, which from outside is one protocol timeout and no clue
which of a dozen steps was holding the page; twice more this round I read a buffered tail
and called ordinary slowness a hang. The step lines are what settle that.

### Measured, and looked at

| | round fifteen | round sixteen |
|---|---|---|
| `#goals` foot | line cut through the glyphs | fades out over 20px |
| `#inspector` foot | `doing` row cut in half | fades out over 20px |
| phone `+5 more` | greyed, map showing through | opaque, brightest row on the panel |
| `T3-phone-events` | the details sheet, misfiled | the events sheet |
| overlaps, both states | `log`/`colonists` 208×188 | unchanged, still unfixed |
| console errors | 0 | 0 |

Eight new assertions, and eleven mutations run against them — a dropped fade, a dropped tab
group, an unstuck count row, a removed ceiling, a cue that ignores scroll position, a
missing observer, a missing listener, a stripped `data-key`, a mask put back over the strip,
a mask put over the news cards. Every one caught; sources restored byte-identical after each.

### Next

The left column is still over-subscribed and still needs a design decision rather than a
variable: 647px between the bars, minimap 224, log 320, eight settler cards 359. `#worktab`
has no ceiling at all, so the sweep does not see it — it is the next panel that will join
this list the moment somebody gives it one.

---

## 2026-09-07 — Look round fifteen, three panels on one edge, told about each other

**Track: the interface.** Round fourteen built the instrument and found the faults; this is
the round that fixes them. Everything below was measured on the staged colony
`trouble.mjs` produces — fifteen alerts, two settlers on the floor, two fires, a raid, no
food — at 1280 by 800, before and after.

### The row that reported the cut, inside the cut

`alertRows` caps the strip at ten and appends a row counting what it dropped, and
`alert-panel.test.ts` has held the panel to the right property since round ten: *a panel is
allowed to run out of room, and is not allowed to hide that it did.* That file reads the row
list rather than the DOM, on purpose and for good reasons, which is precisely why it could
not see what the DOM did with it. `#alerts` has a ceiling of its own — `min(46vh, …)`, 368px
here — and the count row is the last child, so with eleven rows the panel showed seven and
the eleventh, the one whose whole job is to say the other four exist, was one of the four.

The fix is not a new idea; it is `.card .acts`, which solved the same problem on the help
card two rounds ago. The row is opaque, `position: sticky` to the floor of its own
scrollport, with a gradient standing on top of it so the rows sliding under fade instead of
stopping at a hard line. The offset is `-6px` against the panel's own `6px` of bottom
padding, paid back as the row's own padding, which is the same arithmetic `.card .acts` does
at `-20px`.

Measured after: the strip draws six alert rows and the count, and the count sits at the foot
where the fourth clipped row used to be.

### One column, three panels, no mutual knowledge

`#goals`, `#inspector` and `#alerts` all hang off `right: 8px`. The first two drop from the
top bar; the third stands up from the build bar. Nothing tied them together, so the column
was three independent claims on the same 800 pixels and the tallest won.

- `#goals` had **no ceiling and no overflow of any kind** on the desk. The phone rule for the
  same panel has had `max-height: 19vh; overflow-y: auto` all along — the answer already
  existed one media context over, and the desk was the half that never got it. With nothing
  selected it covered the strip until three of eleven rows were left.
- `#inspector` had a ceiling that cleared the top bar and nothing else. Measured, the card
  ran to y784 through a build bar standing at y703, and the strip covered its bottom 368px —
  so its Possess button was unreachable in exactly the way that ceiling was added to prevent,
  one obstacle over. The original comment names the bug it fixed; it simply did not know
  there were two more things below the window edge.

Both now take the same band, and the band is measured rather than guessed: a third
`ResizeObserver` in `hud.ts` publishes the strip's real height as `--alerts-h`, which is the
same trick already played twice on that page for `--topbar-h` and `--buildbar-h`. A hidden
element measures zero, so on a colony with nothing wrong the panels above get the whole
column back without a special case.

| | before | after |
|---|---|---|
| `#goals` height / ceiling | grows to fit, none | 239px, content 481px, scrolls |
| `#inspector` bottom edge | y784, behind the build bar at y703 | inside the band |
| `goals`/`alerts` overlap | covers all but 3 of 11 rows | none |
| `alerts`/`inspector` overlap | 234×368 | none |
| count row | cut | at the foot |

One honest note on that table: the inspector's two rows were written from the arithmetic
rather than from a reading, because the probe that produced the other numbers ran before
the inspector's ceiling was in. The capture in round sixteen measured them and they hold —
no overlap in either state — but they were a prediction sitting in a column of
measurements for as long as it took to take the picture.

### The count on a phone's Events tab

The desk keeps the strip on screen the whole game. A phone keeps it behind a tab, so the
screen a phone player actually plays on is the one screen the strip is not on: a burning,
raided colony with four settlers down drew the same five words along the bottom edge as a
colony with nothing wrong. The tab now carries the number, and it is the length of the whole
alert list rather than of the rows that fit — a count taken from the rows would top out at
the cap and tell a phone player that a colony with fifteen problems has ten. It writes the
empty string rather than a zero, and `:empty` folds it away, so a quiet colony gets its word
back.

### What was fixed by a variable, and what cannot be

The left column has the same disease and does **not** have the same cure. `#log` covers
`#colonists` by 208×188, and the arithmetic says why: 647px between the bars, of which the
minimap takes 224, the log wants 320 and eight settler cards want 359. Subtracting the log's
height from the roster the way the strip's height was subtracted from the goals panel leaves
159px — two cards of eight, which is a worse failure than the overlap and a quieter one.
That column is over-subscribed, and the answer is a decision about what belongs on it: move
the log, shrink the map, or turn the roster sideways. Logged, not guessed at.

### The instrument

`trouble.mjs` grew a second report line rather than a second script. It already stages the
colony; measuring the panels off the same staged colony in the same run means a frame and
the geometry behind it can never disagree, which a separate probe with its own copy of the
staging could not promise. It prints, for both desk arrangements, how many alert rows are in
view, whether the count row is one of them, and every pairwise panel overlap. Round fourteen
read those numbers out of the stylesheet by hand and got the mechanism wrong twice before
the source corrected it; they are measured now.

### Tests

`tests/panel-column.test.ts` is new, and it guards the *column* rather than the two panels
that were caught: it finds every rule that pins to `right: 8px` and hangs from the top bar,
and requires each to have a ceiling, to subtract `--alerts-h`, to clear the build bar, and to
scroll rather than trim. A fourth panel that joins the column inherits the rule instead of
reintroducing the bug six rounds later. It also pins the publisher in `hud.ts`, because
`var(--alerts-h, 0px)` fails open by design — right for a missing variable, wrong for a
deleted publisher, which would silently restore both bugs and photograph as a tidy screen.

Four more in `scroll-cues.test.ts`, which already owned the property and already had the
sticky-footer pattern under `.card .acts`; three in `phone-layout.test.ts` for the tab count.
Nine mutations run against the new guards — the count row losing its class, the row losing
its stickiness, the fade turning the wrong way, the offset drifting off the padding, the
publisher deleted, the observer removed, the badge on every tab, the badge counting rows
instead of alerts, the badge printing a zero — all nine caught, sources restored
byte-identical.

### Next

The left column's design decision, above, is the open one. Below it: `#alerts` and `#log`
are both bottom-anchored and both `resize: both`, so a player who drags one taller has no
guard at all — the ceilings here are on the panels that grow by themselves, not on the ones
a hand can grow. Whether that matters is a question for a frame, not for the stylesheet.

---

## 2026-09-07 — Look round fourteen, the panels that carry bad news, carrying some

**Track: the interface.** No fix this round, and that is the finding. Round ten built the
panels that tell a player the colony is in trouble, and then judged them on the standard
frames, which pause seed 4242 at the first tick past 1800 — a summer noon on which nothing
has gone wrong. Nobody is down, the pantry is full, the woodpile is full, and the alert
strip holds nothing or close to it. Every panel built to carry bad news has been
photographed carrying none, and the collisions round ten found it found by reading CSS,
because no instrument in the project could take a picture of the state they happen in.

`scripts/look/trouble.mjs` (`npm run look:trouble`) is that instrument. The fire, the raid,
the solar flare and the flu go through `aether.*`, which is the same `forceThreat`,
`igniteFire` and `afflict` the storyteller calls, so the alerts, the log lines and the
models are the ones a real event produces. The rest is staged and the header says so: the
stores emptied, two of the three settlers put on the floor, moods dropped, weapons taken
away, and the raiders walked in from the map edge. Seven frames, two at the desk and five on
the phone, zero console errors. The colony it produces has **fifteen alerts**, which the
panel draws as ten rows and a `+5 more`.

### The method, before the findings, because it changed three of them

Eleven faults came off the frames on the first read. Then the stylesheet was read, and
**three of the eleven were not faults at all**: the phone's clipped top bar, the phone's
clipped alert strip, and the stack of event cards. Each is a decision somebody already made,
wrote a paragraph about, and built an affordance for — a horizontal scroll under a
twenty-six pixel fade mask, a bottom fade mask on every clipped phone panel, a
`MAX_TOASTS = 3`. A frame shows you that something is cut. It cannot tell you whether the
cut is a bug or a design, and the difference is the whole worth of the brief that comes out
of it. Photograph first, then read the rule that produced what you photographed, and only
then write the finding down. What follows is what survived that.

### What is actually wrong

**The `+N more` row is inside the overflow it exists to announce.** Eleven rows are in the
DOM at 1280×800 and about seven are on the glass. Both halves of this were designed on
purpose and they cancel each other out. `MAX_ALERTS` was raised from six to ten with the
reasoning written above it — "`#alerts` is `overflow: auto` in the stylesheet and the extra
four cost a scroll rather than a screen" — and the `+N more` row was added underneath
because "whatever the ceiling is, the player has to be able to see that it was reached."
But `#alerts` is capped at `min(46vh, …)`, which is 368 px at an 800-point window and holds
about seven rows. So rows eight, nine and ten cost a scroll exactly as intended, and the
eleventh row — the one whose entire job is to say that a list was cut — costs the same
scroll. It is the last child of the box it is reporting on, and at rest the only thing
saying so is an overlay scrollbar macOS does not paint until you touch it. A colony can be
out of wood, out of medicine, sleeping rough, with a body in the yard and a flare overhead,
and the screen says none of it.

**The right-hand column is three panels that share an edge and know nothing about each
other.** All three are `position: absolute; right: 8px`, and each was given a sensible rule
on its own: `#goals` hangs from `top: topbar + 18px` with **no ceiling and no overflow at
all** — the phone rule for the same panel gives it `max-height: 19vh; overflow-y: auto`, so
the answer already exists one media context over and the desk was never given it —
`#inspector` hangs from the same top with `max-height: 100vh - topbar - 24px`, and
`#alerts` stands on `bottom: buildbar + 12px` with its 46vh cap. At 1280×800 that puts the
alert panel at y 308–676 and the inspector anywhere from 52 to 794, so the alert panel lies
entirely inside the inspector's span, is eighteen pixels wider, and covers it. That is
`r14-T2-desk-downed`: the inspector runs from the name down to `doing · downed`, the alert
strip starts on top of it, and the same inspector resumes underneath with the job list and
the `Draft (T)` / `Take over` / `Possess (G)` buttons — `Possess (G)` clipped by the window.
`r14-T1-desk` is the other order of the same fault: with nothing selected, the goals panel
grows down over the alert strip and three rows of eleven survive.

**The left-hand column has the same disease.** `#colonists` runs y 268–664 and `#log` runs
356–676, both `left: 8px`, and the log wins. In the frame Oda Emberly's card is drawn down
as far as her HEALTH bar and the log starts across the rest of it. Three settlers is the
smallest colony the game ships, so the roster does not survive its own smallest case.

**Nothing on a phone says fifteen alerts exist.** The strip lives in the Events sheet, and
the map screen — where a phone player spends the game — shows no sign of it. `sheetbtn` is
built as `el('button', 'sheetbtn', {}, label)`: there is no badge, no count, no dot, and
nowhere to put one. This is the one phone finding the stylesheet did not take away, because
it is not a clipped panel with an affordance; it is a piece of the interface that was never
built.

**On the Events sheet the same two sentences are on screen twice.** The event cards stack
over the top of the map and the log directly beneath them prints the same two lines, word
for word. Three cards is the cap and the cap is fine; the duplication is not, and it costs
the sheet a quarter of its height on the screen where the news is supposed to live.

**On the Crew sheet the most urgent word has the least weight.** It is the best screen in
the set — three cards, the two downed settlers outlined in red, bars legible, a `flu —
untended` chip. And `downed` is set in the same small grey as `walking to the fence — to
carry materials over`. The outline does the work the word should be doing.

### Instrument caveats, said before they mislead somebody

The phone half needs a reload — `layout-mode.ts` asks its two questions once, in the HUD
constructor — and the reloaded page came back at **Quality: medium** while the desk half ran
at **high**. The two halves of this harness are therefore not photographs of the same
renderer. It touches none of the findings above, all of which are layout, but no judgment
about light or grain may be made across that seam.

The raiders are teleported to where the camera can see them and then the colony frame is
taken at zoom 3, at which they are outside it anyway. `2 hostiles on the map` is a sentence
these frames cannot check. Worth a tighter zoom next time, or the alert's own `Look` button.

### Shipped

`scripts/look/trouble.mjs`, the `look:trouble` script, and three rows added to the instrument
table in `LOOK.md` — `crew.mjs` and `heads.mjs` from rounds twelve and thirteen were never
listed there either. No test, matching the convention every other harness in `scripts/look/`
already follows: they are instruments run by hand and judged by eye, and the thing that
checks them is whether the frames come back.

Two rows of that table are still wrong and were left alone as out of scope: `hollow.mjs` and
`stress.mjs` are not listed, and `shot.mjs` is described as "the five standard frames" when
it has taken sixteen since round ten.

### Next

An interface round, worst first. Make the `+N more` row `position: sticky` at the foot of
its own panel, so the one row that reports the cut cannot be the row that is cut. Then give
the right-hand column a single rule instead of three independent ones — `#goals` has no
ceiling at all, which is where both desk collisions start. Then a count on the phone's
Events tab. Everything in that list is now a frame somebody can look at rather than a line
of CSS somebody has to reason about, which is why this round shipped an instrument and a
list instead of a fix.

### Cost

One capture, about eight minutes, seven frames, zero console errors, all seven on disk. The
harness found eleven faults on its first run and the stylesheet took three of them back,
which is the ratio worth remembering the next time a frame looks damning on its own.

---

## 2026-09-07 — Look round thirteen, a head shaped like a head

**Track: the rendered game.** One lane, and the brief is round twelve's *still wrong* list read
back verbatim: the head turn does not survive the manager camera, "the head is a near-featureless
dark sphere under a hair cap, and rotating a sphere changes almost no silhouette." That was half
the diagnosis. The round found the other half by measuring it, and the other half is the one that
mattered.

Two instruments were built to ask, because the standard frames could not. `scripts/look/crew.mjs`
pins every settler to one facing on purpose — that is what makes it a good instrument for a pose —
so every head ever photographed in this project has been the back of a head at one angle.
`scripts/look/heads.mjs` (`npm run look:heads`) stands eight settlers in a row at eight facings, a
quarter-turn apart, on the isometric diagonal that renders as a straight line, so the only thing
varying along the row is the thing being judged. `tests/head-read.test.ts` asks the same question
in numbers instead of pixels: it raycasts a grid at the head from the manager camera's own yaw and
pitch, collects the hits in the screen plane, and takes the covariance of that point cloud. That
gives an outline aspect ratio and a long-axis angle, which is the closest a number can get to what
an eye does when it looks at a silhouette.

### Better

**A settler's head now tells you which way they are facing.** The outline aspect went from
1.006–1.059 — a circle, within measurement noise, at all eight facings — to 1.150–1.338, and the
angle between the outline's long axis and the body's forward direction went from an error of up to
62.4 degrees, which is another way of saying the axis was meaningless, to 4.9 degrees or better at
every one of the eight, for both hair shapes. In `r13-after-D3-heads-far` the four heads in frame
are four eggs pointing four different ways, and you can read the row without looking at the feet.
Compare `r13-before-D3-heads-far`, where they are four identical discs.

**The fix is a correction, not a feature.** The head was a sphere. A skull is not: it is about
1.28 times longer front-to-back than it is wide, which is a cephalic index around 78 and the middle
of the human range. The change is three numbers — the skull scaled to `1, 1.06, 1.28`, the hair
shell to `0.148, 0.158, 0.19`, and the eye moved forward from `z 0.115` to `0.147` so it still sits
in a face that is now further out. No new mesh, no new material, no triangles added. The round
twelve head aim, which was built and then could not be seen, is what this pays for.

### Worse, and fixed inside the round

**The harness was lying about what varied along its row.** The two hair shapes are chosen by bit 12
of `colorSeed`, so the first version forced that bit to put four cropped heads next to four long
ones, and its own comment claimed "any difference between the two halves of the row is that bit and
not the facing." It was not. The hair *tone* is `(colorSeed >> 8) % HAIR_TONES.length`, and setting
bit 12 shifts that index by 16, which is 4 in a list of six: the first four settlers came back
ginger and the last four brunette. A row built to isolate one variable had quietly changed two.
All eight now keep the template's seed and the hair shape moved to a `LOOK_HAIR` environment axis,
photographed as two runs. The first shoot is kept at `.look/shots/r13-v1-mixedhair` as the record
of what the mistake looked like.

**The derivation was wrong and the instrument said so.** Before measuring, the geometry argued that
a settler facing the camera should show a band of face below the hair hem — the hem sits at about
94 degrees and the light terminator at 127. The raycast disagreed flatly: skin is 0 to 4.5 per cent
of the head's projected area, and exactly zero at three of the eight facings, because at the manager
camera's 52.7-degree elevation that band is very nearly tangent to the view. This is the real
finding and it is sharper than round twelve's guess. It is not that the head is a sphere with
nothing to rotate; it is that **96 to 100 per cent of the head the camera can see is one material**,
so there was no feature on it to rotate in the first place. That is why the fix had to be the
outline and could not have been a face.

### Still wrong

**At the distance the game is played at, the egg is legible but quiet.** In `r13-after-D-heads` the
heads are ovals and their axes do vary, but at roughly thirty pixels you have to know to look. The
whole read is carried by outline alone. A head that is one colour cannot do better than its own
edge, and the next thing that would pay here is a value break on the hair itself — a lighter crown
or a darker nape — so the head has an interior gradient that turns with it rather than only a
boundary.

**The skull elongation does not carry the read; the hair does.** The mutation sweep is explicit
about this. Reverting the skull to a sphere and leaving the hair shell an egg fails only the eye
test — the outline and the direction both still pass, because the hair is essentially all of the
visible head. The skull change is honest work for the eye's seating and for the exported `.glb`,
where a consumer gets a model rather than a silhouette, but it is not what a player sees. Saying so
here is cheaper than a later round rediscovering it.

### Shipped

`src/client/render/pawns.ts`, three numbers. `scripts/look/heads.mjs` and the `look:heads` script.
`tests/head-read.test.ts`, five tests, which measure what the camera sees rather than what the
geometry says: that the head is not a circle from any eighth of the compass, that its long axis
lies along the way the body is facing, that the hair stays outside the skin at every vertex, and
that the eye stays set in the face at the twenty millimetres proud the file has always stood it at.

The fifth test is a guard on the other four. It builds a bare sphere and requires the same
instrument to measure it under 1.05, because an aspect ratio computed from a raycast grid is a
number that can be wrong in a direction that looks like success, and a test that cannot fail when
the thing it measures is a circle is not measuring anything.

Verified red-first by mutation, five mutations, each caught, the file restored byte-identical
afterwards. The decisive one is the last: **a head made wider instead of longer fails the direction
test and passes the aspect test.** That is the proof the two assertions are not the same assertion
written twice, which is the usual way a pair of geometry tests goes wrong.

### Next

The value break on the hair, above — the cheapest remaining thing that would make the head read at
manager zoom. Then the load tinted by kind, and the carried settler drawn in the carrier's arms,
both still carried over from round twelve.

### Cost

Two captures at about ten minutes each plus one discarded to the harness bug, three frames apiece,
zero console errors in all three runs. The numeric instrument runs in four seconds, which is what
made the round cheap: the geometry was iterated against the number and photographed once at the end
rather than the other way round.

---

## 2026-09-07 — Look round twelve, what a settler does with their head and their hands

**Track: the rendered game.** One lane, `pawns.ts`, and the brief came out of the code rather
than out of round eleven's *still wrong* list. Two findings set it: `carryingItemId` has been on
the pawn since there were pawns and nothing in the renderer had ever read it, so a colonist
crossing the map with forty wood was pixel-identical to one walking home empty; and
`head.rotation.y` was untouched everywhere, while the file's own comment says the head is most of
what the manager camera sees.

The standard six frames could not judge either one. They pin seed 4242 at the first tick past
1800 so that two rounds photograph the same colony, and whether the settler under the close camera
happens to be hauling, or has a job two cells off his shoulder, at that tick is luck. So the round
added a seventh instrument, `scripts/look/crew.mjs` (`npm run look:crew`): seven settlers cloned
onto clear ground in one line — idle, two looking at jobs, working, hauling, carrying a person,
down — all facing the same way, so the only thing that varies along the row is the thing being
judged. Frames `r12b-before` against `r12c-after`.

### Better

**A settler with their hands full looks like one.** Both arms come up to `-1.3` and a sack rides
the chest at `(0, 1.16, 0.4)`, drawn from `carryingItemId` and hidden when the hands are empty.
Built for every rig and hidden rather than made when the hands fill, so nothing allocates on the
frame a colonist picks something up. The legs keep their own pose underneath — the update was
split into a legs layer and an arms layer for exactly this, so a hauler walks and carries at the
same time instead of choosing. Twelve triangles a settler, which is why the pose could be spent
without an argument about budget.

**The head attends to the work.** `head-aim.ts` is the whole of it and imports no `three`: two
angles in the body's frame, a neck that reaches about seventy degrees each way and further down
than up, and an exponential approach so the turn takes the same wall time at 30 fps and at 144.
An aim the neck cannot reach is dropped rather than clamped, which is the difference between a
settler who has not noticed something behind them and a settler staring at the limit of their own
collar. In `r12c-after-D2-crew-close` the two settlers with jobs off their shoulder have visibly
tipped their heads down at the ground they are working, and the pitch carries more of that read
than the yaw does.

### Worse, and fixed inside the round

**The rifle became a flagpole.** A weapon rides the right hand — `this.armR.add(this.weapon)` —
so raising both arms to a crate raised the rifle with them, and the first frames showed a settler
walking with a crate at their chest and a shotgun standing vertically out of their fist. Worse
than the empty hands it replaced. Hands that are full are full of one thing: the weapon now hides
while a load is drawn, and comes back when the hands come free or the body goes down.

**A rescuer had both arms up around nothing.** The first version keyed the carry pose on
`carryingItemId || carryingPawnId`, on the reasoning that a rescuer holds a body the same way. The
frames refused it. With no body mesh to hand the arms, a colonist crossing the map with both arms
raised around empty air reads as surrender, and that is a worse thing for a frame to say than the
ordinary walk it replaced. The pose is keyed on a drawn load alone now; a rescue joins it the day
the carried settler is drawn in the carrier's arms.

### Still wrong

**The head turn does not survive the manager camera.** At the zoom `D2-crew-close` is taken at it
is unmistakable; in `D-crew`, which is the zoom the game is actually played at, it is a handful of
pixels. The cause is the model, not the aim: the head is a near-featureless dark sphere under a
hair cap, and rotating a sphere changes almost no silhouette. Giving the head something
directional that reads from above — an asymmetric hair mass, a fringe, a face light enough to
catch the sun — is the next brief for this lane, and it would pay for the aim already built.

**The load is a generic crate.** It is the shared crate geometry in one brown, so forty wood, ten
steel and a stack of hides are the same box. The item kind is in hand at the call site
(`carryingItemId` names an item that knows what it is), so a tint or a swapped profile per kind is
cheap; it was left out because it is a second change and this round had a regression to photograph.

**The zoom LOD was briefed, measured, and dropped.** The lane was to cut eyes, hands and hair when
the camera pulls back, on the theory that it would pay for the two lanes above. The census says it
would not: a settler rig is 18 meshes and 2812 triangles, and a fresh colony is 81 pawns of which
**three** are settlers — 54 meshes against the animals' 1951, and 8.4 k triangles against their
184 k. Dropping the fine parts on three rigs saves about fifteen draw calls out of two thousand.
The measurement is the finding: if a LOD lane is ever worth building it belongs to `AnimalRig`,
which is 96 per cent of the pawn budget, and not to the settlers this round was about.

### Shipped

`src/client/render/head-aim.ts` (new, pure angles), `pawns.ts` (the two pose layers, the load, the
weapon hide, the head drive), and the `dt` that had to be threaded to reach it —
`world-view.ts`, `app.ts`, `models.ts`. Heads ease on frame time and not on ticks, because nothing
in the simulation depends on where a head is pointed and a head that stepped at 20 Hz while the
feet ran at 144 would show it. `models.ts` passes zero, so an exported `.glb` has every head
straight: an exported model is a body, not a moment.

Tests: `tests/head-aim.test.ts` (12) and `tests/pawn-rig.test.ts` (16, the first tests `pawns.ts`
has ever had), plus six call sites updated in `tests/lighting.test.ts` with their behaviour
preserved. Both new files were verified red-first by mutation rather than by inspection — fifteen
targeted mutations across the two source files, each caught, each file restored byte-identical
afterwards. `tests/pawn-rig.test.ts` goes through `PawnsView` and not the private rig, because a
test that reached past the view could pass while the view never built the body at all.

The carry state is not a feature that exists only in its own tests: `tests/repath.test.ts` already
runs a real colony until a hauler's `carryingItemId` fills, so the state the renderer now draws is
one the simulation is independently shown to reach.

### Next

The head's silhouette, above. Then the load by kind. Then the carried settler drawn in the
carrier's arms, which closes the rescue pose properly instead of declining it.

### Cost

Four captures at about ten minutes each — a before, an after, then a reframed pair after the first
framing ran the crew diagonally off the corner and never photographed two of the seven. Zero
console errors in all four. About two hours wall clock, most of it the harness.

---

## 2026-09-06 — Round eleven, and the colour a stone is not

**Track: the rendered game.** Three lanes, briefed straight off round ten's *still wrong* list
with no interpretation needed: the tree's root flare, the scatter stones and the grass at manager
zoom, and the settler silhouette at the zoom `3-colony` is taken at. The frames judged are `r10b`
against `r11b` — `r11b` and not the round's own `r11`, because `r11` is the set that caught the
regression below, and a fix has to be photographed before the round can close.

### Better

**The tree stands in the ground instead of on it.** `roots()` in `buildings.ts` takes the trunk
lathe and pushes its lowest rings out along a five-lobed and a three-lobed wave a little out of
step, dying out as `1 − (y / ROOT_RISE)²`, so the girth at the foot is carried by four or five
root swells rather than by the flat disc the old profile flared into. Round ten called that disc
a plant pot and it was the right word. No face of the new foot at ground level is more than
thirty degrees off vertical, which is the measurement that separates a bole from a saucer, and it
is pinned by a test rather than by the picture.

**The stones broke off something.** The scatter dropped from a once-subdivided icosahedron to the
bare twenty-sided one and the displacement rose from nine hundredths of the radius to three
tenths, so no two faces are the same size and every lump has twenty flat sides and hard edges. On
top of that: a per-face tone bake, free rotation, a size range widened from three-to-one to
four-to-one weighted toward the chip, and twelve independent hashes where three had been doing
all the work — so a big stone is no longer always turned the same way and always the same shade.
In `2b-closeup` the pebbles two metres from the rock outcrop used to read as eggs beside it; they
now read as pieces of the same rock. It is also a quarter of the triangles, and the stones are
the one thing in `decor.ts` that casts a shadow, so the saving is taken twice.

**The grass covers the ground at both zooms.** Seven tufts a cell instead of five, placed on a
per-cell phase of the R2 low-discrepancy set rather than on independent hashes — which is what
actually closed the holes; more tufts scattered independently is more scatter, not more cover. In
`4-firstperson` the field went from marks printed on the turf to a sward you are standing in, and
at the manager zoom of `3-colony` it stopped flattening back into chevrons, which was round ten's
specific complaint. The thinning over worn ground is unchanged in effect: seven tufts at 0.075
each on top of the flat 0.3 is the same 0.75 ceiling that five at 0.11 and three at 0.22 were.

**A settler has arms.** `ARM_SPLAY` rolls each shoulder out by 0.12 radians and the sleeves take
their own material off `sleeveOf(cloth)`. From directly overhead — which is exactly how
`1-settlers` and `3-colony` see a person — the arms used to merge into the torso and the figure
was a blue lozenge with a head on it. The gap between arm and body reads at both zooms now.

The frame is heavier by the grass and lighter by the stones, and the grass wins: **123 draw calls
/ 8,357,792 triangles**, against round ten's 123 / 8,000,822. Same binds, 4.5 % more work for the
card.

### The regression this round shipped, photographed, and fixed

**The stones came out pink.** The lane that gave the stones their facets also widened the
per-instance tone to match — hue from a sixteenth of a turn either way to a twelfth, saturation
from a twentieth to a quarter. That is what a *smooth* lump wants: a smooth lump has one
highlight sliding over it and needs colour to tell it from its neighbour. A faceted one does not.
Twenty flat sides at twenty angles is already the whole of the variety, and the tone spent on top
of it went somewhere the eye reads as a material rather than as a stone. `STONE_COLOR` is a
mid-grey carrying a tenth of a saturation at hue 33°; a sixth of a turn down the wheel lands at
11°, and a quarter of added saturation on top of that is a pink.

Measured off the frames rather than argued: six chips in `2b-closeup` span 18.0° to 41.2° of hue
in `r11` and 28.9° to 36.5° in `r11b` — a spread of 23° cut to 8°, with the low end, which is the
end that reads as pink, moved 11° back up the wheel. In `5-dusk`, where the low sun pushes what
is already warm further, the worst chip sat at hue 4.3° and now sits at 13.3°; the dusk scatter
as a whole is no more saturated than round ten's eggs were at the same hour, and is a great deal
better shaped.

Hue is back inside a tenth of a turn, saturation to the tenth it was photographed at for ten
rounds, lightness untouched. What survives is the part that was right: three properties on three
independent hashes, so the field is still not one stamp — it is a field of grey stones that
differ, rather than a field of stones that differ in colour.

Nothing in the suite could see it, and that is the more useful half. The existing stone test
checks a *lightness* band, and a pink of the right lightness is a pink; the variety test beside
it is actively **satisfied** by the defect, because a pink stone is certainly not the same colour
as its neighbour. `keeps every stone a grey, never a colour` writes down the two numbers a grey
actually is — saturation under a fifth, hue inside the brown wedge — read in sRGB rather than in
the linear working space, because the question is what the frame looked like and not what the
buffer held.

The grass gained the same kind of pin. `WEAR_COST_PER_TUFT` came down from 0.11 to 0.075 to keep
the ceiling where two more tufts a cell would have pushed it, and that compensation was arithmetic
in a comment and nothing else: raise the tufts-per-cell count again without lowering the step and
the last tuft's y scale goes through zero into negative, which is a clump drawn upside down
through the turf it stands on. The yard-versus-open-ground test could not have caught it — it
compares averages, and a negative height makes an average *smaller*, so it would have gone green
while the grass grew into the ground.

### Still wrong

- **The tree foot still catches red at dusk.** Smaller and less disc-like than round ten's saucer
  and no longer the worst thing in `5-dusk`, but the roots take the low sun's warm light on
  `BARK` and come out orange-red against green turf. The disc was the bug and the disc is fixed;
  the colour under a low sun is a separate question nobody has asked yet.
- **The minimap panel is still a 300-pixel box holding a 90-pixel picture.** Carried from round
  ten unchanged, and `6-hud-colony` shows it is still the largest empty thing in the left column.
- **The message log sits on top of the third crew card.** At the desk viewport the log panel's top
  edge cuts through Pell Emberly's MOOD row in `6-hud-colony`. Both panels are draggable, so this
  is a default-position defect and not a layout impossibility.

### The harness

`r11` came back 13/16 — `Page.captureScreenshot` timed out on `8-phone-details`, the frame taken
immediately after tapping a roster row, and the `catch` took `8-phone-events` and `8-phone-more`
with it. `r11b` took all sixteen from the same code on the same seed, so this is the contention
timeout this project has seen before and not a slow frame in the game. The protocol timeout is
already fifteen minutes; nothing is worth changing until it reproduces.

### Verified

- `npx tsc --noEmit -p .` — clean.
- `npx vitest run` — the whole suite: **2319 passed, 13 skipped**, 116 files, 1520 s.
- Two new tests written against the values that break them: reverting the stone tone widths turns
  `keeps every stone a grey, never a colour` red, and raising `TUFTS_PER_CELL` without lowering
  the step turns `leaves the last tuft on the barest cell standing` red. A test nobody has watched
  fail is a test nobody has checked.
- `r11b: 0 console errors, 26 showcase buildings stood, 17 ms/frame, colony frame 123 draw calls /
  8357792 triangles / 0 points / 0 lines, 192 geometries, 2 textures, 15 of 151 instanced meshes
  empty (13 of those hidden), 16/16 frames (all)`.
- Sixteen frames opened one at a time against `r10b`.

### Next target

- The tree foot's colour under a low sun.
- The two HUD defects above — both are position, not paint.
- The stones and the grass are done. The buildings' interiors are the least-photographed surface
  left in the set.

---

## 2026-09-06 — Round ten, and the instrument that lost two frames without saying so

**Track: the rendered game.** Eight lanes — pawns, buildings, decor, landmarks, sky and weather,
the minimap, the instanced pool, and a new one for contact shadows — briefed off round nine's
*still wrong* list. The frames judged are `r9b` against `r10b`, and `r10b` rather than the
round's own `r10` for a reason that turned out to be the round's headline: `r10` came back
missing six of its sixteen frames and with the one frame that photographs the pawn models
showing an empty patch of grass, and neither fact appeared anywhere in the harness output.

### Better

**Contact shadows, measured rather than lit.** New `src/client/render/occlusion.ts` bakes an
ambient-occlusion term into each prototype's vertex colours at startup — ray-cast against the
whole assembly plus a ground plane at `y = 0`, then multiplied into the colour attribute, which
survives every per-instance tint the view pushes because `color_vertex.glsl` multiplies rather
than replaces. A stove's feet come out at 0.8003 against a lid at 0.9593. In the frames it is
the darkening where a tree meets the turf and where a wall meets the ground: everything in the
colony now sits *on* the floor instead of hovering a centimetre over it. The bake is 396 ms and
runs off `requestIdleCallback` after the colony is already drawing.

**The wall became masonry.** Coursed brick up the face, a pale stone coping along the top and a
post standing proud at each outside corner. At the manager zoom it is the difference between a
perimeter and a row of cubes, and it is the first thing the eye lands on in `3-colony`.

**The trees got a canopy instead of a cone.** Four lobed skirts, rumpled per seed, two variants
so a wood is not one tree stamped forty times. With the contact darkening under them they read
as trees at every zoom in the set.

**The minimap stopped being a dead rectangle.** Unseen ground was 0x141a22 and the chrome around
the panel is 20, 26, 34 — the same colour — so on day one the largest element in the left column
was one flat box with a stamp of colour floating in it, which is what a widget that failed to
load looks like. It is the panel's own solid carried toward the HUD's dim label grey now, with
survey lines across it: a chart of country nobody has walked, which is what it actually is.

**The frame is counted.** `renderer.info` read between two animation frames, so a round that
makes the picture heavier says so in a number rather than in a screenshot timeout. The colony
frame is **123 draw calls / 8,000,822 triangles / 191 geometries**, and alongside it the tally
the wall clock cannot give: **15 of 151 instanced pools empty, 13 of those hidden**. That second
number is `instanced.ts` this round — pooled meshes no longer set `frustumCulled = false`.
The flag was covering for `InstancedMesh`'s own bounding sphere going stale (three computes it
once, lazily, and nothing about `setMatrixAt` invalidates it), and the fix is to stop it going
stale: `end()` recomputes the sphere after every rebuild and drops a pool with nothing in it out
of the render list, which is where the thirteen come from.

### Still wrong

- **Every tree stands in a plant pot.** `tree.trunk`'s root flare (`buildings.ts`, the
  `lathe([[0.44, 0], [0.3, 0.18], …])` profile) reads from the manager camera as a flat brown
  disc lying on the grass, and at dusk it catches the warm light and reads as a *red* one. It is
  the worst thing in `5-dusk` and it is not new — it predates this round — but nothing has ever
  photographed the tree foot closely enough to see it.
- **The scatter stones are eggs.** Dozens of pale, smooth, near-identical ovoids across the turf
  in every world frame, next to a rock outcrop that this round gave real facets and value
  variation to. The small stones are the un-upgraded version of the same idea and they now look
  it.
- **The grass reads differently at the two zooms.** In `2b-closeup` the tufts stand up out of the
  ground; at the manager zoom of `3-colony` they flatten into scattered chevrons again. Round
  nine's note says this class was fixed, and close up it was — the fix did not carry to the
  distance the game is actually played at.
- **The settlers are now the least detailed thing in the colony frame.** At the zoom `3-colony`
  is taken at, a settler is a hair dot, a torso and two sticks, standing in front of a wall that
  has coursing and a coping. Round nine and ten both went to the buildings; the models the player
  spends the game watching did not keep up.

### The harness, which this round broke and then fixed

Two defects, both found by looking at what came out rather than by reading the code:

- **`1-settlers` had no settler in it.** Every frame after the pause is taken of one colony
  standing still, and the pause is a `Space` sent to the canvas. If it is swallowed — focus and
  keypress landing either side of a slow frame under GPU contention — the settlers keep walking
  through the two seconds of zooming and easing that follow, and the frame whose whole job is
  the pawn models comes back as grass. `pause()` now presses, asks the app whether `speed === 0`,
  presses again, and throws after three tries. The swallow itself was not reproduced; what is
  fixed is that it can no longer be silent.
- **The phone half took the report down with it.** `waitForFunction(tick >= 1800)` timed out
  after the reload, the run died with a stack trace, and the shell's exit status was eaten by a
  pipe — so ten frames on disk read from outside exactly like sixteen. The phone block runs
  behind a `try`/`catch` now, its wait is 180 s, and the last line prints `16/16 frames (all)`
  or names every frame that is missing.

The world frames are also photographed with the HUD *down* and the interface frames with it
*up*: for nine rounds the blank was one-way and taken once, so the half of the screen the player
spends most of the game reading had never been in a frame at all.

### Verified

- `npx tsc --noEmit -p .` — clean.
- `npx vitest run` over the seven touched render files — **228 passed**, 14.9 s. New:
  `tests/occlusion.test.ts` (the bake, the black-material trap, the ordering rule against `dye`),
  and `tests/minimap.test.ts`.
- `r10b: 0 console errors, 26 showcase buildings stood, 17 ms/frame, colony frame 123 draw calls
  / 8000822 triangles / 191 geometries, 2 textures, 15 of 151 instanced meshes empty (13 of those
  hidden), 16/16 frames (all)`.
- Sixteen frames opened one at a time against `r9b`, which is the only gate this track has.

### Next target

- The tree's root flare, the scatter stones, and the grass at manager zoom — a decor and
  buildings round with the frames already naming their targets.
- The settler models, at the zoom `3-colony` is taken at rather than the zoom `1-settlers` is.
- The minimap panel is a chart of unwalked country on day one, which is honest and is still a
  300-pixel box holding a 90-pixel picture. That is a layout question, not a colour one.

## 2026-09-06 — The interface round, and the panels that clipped in silence

**Track: the HUD, not the world.** The first round on this project whose subject is the
instrument rather than the thing it points at, and it needed a new instrument of its own to run:
`scripts/look/shot.mjs` had been hiding the HUD before every frame since it was written, which
meant nine rounds of look work had been done against a game with its interface deliberately
switched off. The harness now takes sixteen frames — the six model frames unchanged and in their
places, plus `0-hud-help`, `6-hud-colony`, `7-hud-selected`, and seven phone frames at 390x844 on
a device-pixel ratio of three.

### Better

**Contrast, measured rather than eyeballed.** Every colour a player reads was put through the
sRGB-to-linear ratio against its real backdrop, which is not the panel: `.panel` is
`rgba(14,19,26,0.82)` over live 3D, so the effective ground is 0.82 of the panel plus 0.18 of
whatever the camera is looking at, and the brightest terrain in the round-8 frames is
rgb(156,185,124). Against that, twelve places were below 4.5:1 and are not now. The alert red
moved #e0745f to #e47661 (4.36 to 4.51). Twelve `opacity` multipliers on text became stated
colours, which is the whole class: an unaffordable blueprint's cost went 2.21 to 4.26, the locked
research, trade and road rows 2.11 and 2.21 to 5.25, the panel close cross 2.42 to 3.68, the drag
grip 2.65 to 4.24. The tutorial's dismiss link was on `--edge` at 1.99:1 — a control at twice the
contrast of nothing — and is now #7f878f with a 44-pixel square under it on a phone.

**Panels that ran out of room stopped hiding it.** The alert strip drew the first six rows of a
list that is routinely twenty long and then stopped, so a burning colony under raid with four
settlers down was never told it had run out of food, because "No food left" was the seventh row.
The cap is ten and the list ends with `+N more`. The log sliced a fixed seven lines because the
box was once a fixed 132px; it has had a resize grip and a viewport-relative height for some time,
so the count is derived from `clientHeight` now and a dragged panel fills.

**Fourteen scroll containers, one of which said so.** This is the finding of the round and it came
out of the phone frames rather than out of the code. On the desk a panel that overflows shows a
scrollbar and can be dragged bigger, so the cut announces itself twice. The phone has neither —
the scrollbar is hidden by rule and `makeMovable` returns early because there is nowhere to move a
panel to. So three separate panels were photographed clipping in perfect silence: the top bar cut
the clock to "12:0" and stopped; the next-steps panel ended on "Steel is what everything after
this costs" with the rest below the fold; and the build sheet showed four of its eleven
categories, so seven whole tabs of things to build were reachable only by a swipe that nothing on
the screen suggested. Every phone container that scrolls now carries a `mask-image` fade in the
axis it scrolls — 26px sideways, where a cut glyph has to be unmistakable, 20px down, which is
about a line and a half. The desk's one instance of the same defect is different in cause and got
its own fix: `.card .acts` is opaque and stuck to the floor of the help card, and on an 800-tall
window its hard edge lands immediately below the heading "How a run ends", so the section that
explains how the game is won photographed as a heading with nothing beneath it. A gradient stands
on the button row and the text fades under it instead.

**A key you can see is a key you can press.** Four of the seventeen colony bindings are one thin
glyph — the apostrophe for the work board, the semicolon for the story, the backtick for a Picky,
the erase glyph for cancel. Set bare in twelve-pixel mono on a dark panel each is three or four
lit pixels, so the row beside it read as an action with no key at all. Every key in the help card
now sits on a plate, which costs the wide rows nothing and is the difference between a mark and a
key for the narrow ones.

**"Walking to 4 meal."** The line on a settler card is on screen more than any other sentence in
the game and had no test whatsoever, and it was printing the internal key straight into English:
a settler carrying supper to the store was "walking to 4 meal", one fetching turnips "walking to
51 rawfood". `resourceWord` was written for exactly this and its own comment argues the case —
one table, not a second one that drifts out of step with the first — and this call site simply
did not use it. It does now, and because the strip's headings are already plural for the things
you count and bare for the things you weigh, "4 meals" and "169 wood" both come out right for
free. Six tests, sweeping every resource in the game.

**Small things that were wrong for small reasons.** A run of identical log lines collapses to one
row and a count, and collapses before the slice rather than after, so eight repeated fences buy
the player more of their afternoon rather than less of it. The watts cell was the only lowercase
heading in the top bar, because eight resources come out of a table capitalised and the ninth was
written by hand. A control-stack row said the cell at 86, 103 as "86,103", which every other
number in this HUD trains you to read as eighty-six thousand. A blueprint tile with no hotkey lost
its whole top line, because an empty block is a block of no height, so the Fence sat a line out of
step with the Wall and the Door either side of it. The help button is a "?" in a crowded top bar
and the word "Help" in the More drawer, where all ten of its neighbours are words.

### Still wrong

- **The minimap is a black box.** In every one of the nine HUD frames, desk and phone. On day one
  the explored patch is a fraction of the panel and the rest is very nearly pure black, which does
  not read as ground you have not walked yet — it reads as a widget that failed to load. It is the
  largest dead area in the desk HUD and the highest-contrast edge on the screen, so it is also the
  first thing the eye lands on. Being fixed in its own pass.
- **The next-steps panel's close cross sits on its own row**, below the header rather than in the
  corner of it, spending a whole line of a panel that is 19vh tall to hold one glyph.
- **"Quality: medium" is the only button in the More drawer that wraps to two lines.**
- **No frame has been taken of a colony in trouble.** Every HUD frame in this round is day one at
  noon with three settlers, full bars and no alerts — which is exactly the state in which an alert
  panel, a mood breakdown and a red bar cannot be judged at all. The contrast work above was
  measured against terrain rather than photographed against it for the same reason.

### Next

The interface has no equivalent of the `2b-closeup` frame: a state deliberately composed to put
the instruments under load. A fourth day, a raid landing, two settlers down, a fire, twenty alerts
and a mood breakdown with six lines in it would photograph every panel this round touched in the
condition it was built for, and none of them have ever been seen that way.

**Gate.** `npx tsc --noEmit -p .` clean. Six interface test files, 109 tests, all passing —
`scroll-cues` and `errand-line` are new this round, `alert-panel` gained seven. Sixteen frames in
`.look/shots/r10ui/`, 0 console errors.

---

## 2026-09-06 — Round nine, and a class of bug that missed a member of itself

**Track: the rendered game.** Six lanes through the workflow — pawns, buildings, decor, terrain,
lighting, critters — briefed off round 8's *still wrong* list, then four corrections made by hand
after every lane had reported green. The frames judged are `r8` against `r9b`, and `r9b` rather
than the workflow's own `r9`, because that set was photographed before the corrections and would
have certified a solar panel this round had just broken.

### Better

**The grass stopped being bird tracks.** From the manager camera a tuft was three fat darts meeting
at one point, and the pair either side of the upright one lay along the turf: a field of them read
as tracks pressed into the ground, which is what four rounds of frames had been showing without
anyone naming it. Two separate causes. The blades met at a single root, so the junction was a notch
rather than a patch of stems. And `tuftGeometry` scaled a blade with `scale(1, len, 1)` while the
bow is a tip offset in blade-local units, so the shortest leaf kept a full-length bow: a quarter of
a tuft-height tall and two and a half times that far out along the turf — broadside to the camera,
which is the brightest thing a blade can be. Five thin blades on the same fifteen triangles now,
uneven in length and unevenly bearinged, each rising out of its own patch of ground, scaled whole so
the bow shrinks with the blade. In the first-person frame the difference is not subtle: pale
chevrons lying in the dirt became grass standing up out of it.

**The lamp is a lamp.** `lamp.shade` was stated as dark iron, came out at four thousandths of linear
luminance under the building's own palette colour, and photographed as a black bowl with the gold
plate of the bulb showing under it. It is a pale globe now, in both the noon and the dusk frame.
The rule the round settled on: `paint(kind, target, rough, metal)` divides the wanted colour by
`BUILDING_COLOR[kind]` per channel in linear light, so a part lands on the colour it states whatever
the palette does underneath it. `tone()` states a multiplier and is where the whole class came from.

**The machines read as machines.** Against r8 the stove's flue is a pipe rather than a black stub and
its door and vents are visible; the heater has a grille and feet; the generator's skid, wheel and
trim separate; the solar panel's rim is a grey frame with the glass reading darker than it, instead
of the bright silver tray the lane left behind.

**The site marker stopped being a heptagon.** The flat gold seven-sided disc lying in the grass in
every zoo frame since round 4 was `landmarks.ts`: an unlit flat-shaded octahedron, every face taking
the identical amber, so from overhead it was a polygon cut out of the ground. It is a spun bead with
the sun baked into its vertex colours now — still unlit, still four draw calls, 192 triangles.

**The hunt marker cleared the fenwolf.** `markAt` expressed a world-space intent in body space, so
the clearance scaled with the species: 0.230 on a mossback, 0.098 on a fenwolf, 0.027 on a
brambletail — the marker was inside the small animals. Adding the clearance after the scale puts
every species and every calf at 0.240.

**Hands.** The arm capsule ran 0.6 long with the hand at y = −0.57 and a palm half-extent of 0.0446
against a sleeve radius of 0.065, so the hand was inside the cloth. Sleeve 0.53, wrist −0.575, palm
0.072 across ten meridians: there is a hand past the cuff in the settler frame now.

### Corrected by hand, after the lanes reported green

Four, all found by looking at frames and hex, none by the gate.

**The round's own class missed a member.** `stove.plate` — the hotplates, upward-facing, on the
building the round's note names as a victim of the bug — sat at 0.0042, half the lamp shade that
started the round. It survived the round's own floor test because that test exempts anything
carrying an emissive, and eight thousandths of glow is not "bright enough to be read off". The
exemption now requires the emissive to clear the floor itself; the seven parts that genuinely make
light sit between 0.046 and 0.897, so the tighter rule costs nothing real.

**`paint()` erased the palette families.** Because it states an absolute target, `BUILDING_COLOR`
stopped reaching the painted parts: `gen.trim` and `batt.trim` came out byte-identical, and so did
`bench.vise` and `solar.mount`, collapsing distinctions the palette's own comment calls deliberate.
Eight targets re-stated, families separated by hue, luminance held where it was.

**`solar.frame` was a blowout.** 0.2117 — brighter than grass at 0.124 and a stone wall at 0.159,
across a 0.77 m² backing plate, on the one building the palette documents as darkest because it is
glass. Down to 0.1037.

**The conduit test passed on the shape it was written to reject.** The capsule stood exactly 0.06 off
the floor and the assertion was `toBeLessThanOrEqual(0.06)`; only the aspect check caught it. Strict
now.

### Still wrong

**The mossback wears its marker as a collar.** The clearance fix is a constant added after the scale,
and 0.240 is barely more than the 0.230 the mossback already had — so on the largest animal the
marker still rides its neck and reads as a red band around the throat in both zoo frames. The
clearance wants measuring off the species' silhouette, not off a number that happens to clear a
fenwolf.

**The site marker is dough.** The bead is round, which was the fix, but it is pale tan with almost
no shading contrast and it has lost the amber that made it read as a marker rather than a lump. It
is the brightest thing in `C2-items-close` and it says nothing.

**The turf lost density.** Five thin blades cover less ground than three fat ones on the same
instance count, and from the manager camera the field reads sparser than r8 — the fix for the shape
was paid for out of the coverage. Either the count or the blade width wants raising; the tuft
budget has nothing spare, so it is the count.

**The stove is the brightest thing in the yard.** Every stove target is a mid-dark grey (0x44 to
0x56) yet the body photographs near-white in the close-up, brighter than the statue's stone plinth.
That is metalness 0.25–0.3 against a bright environment map, not albedo. Legible as a steel range,
but it out-shouts the palette and no test looks at a ceiling — the floor test has no twin.

**The walls are still bit-identical, and now it is measured.** One wall block face is 3,840 pixels
carrying seven RGB values, 99.6% of them one value, plane-fit residual 0.000 at p10, p50 and p90,
against open ground at p50 1.032 from 1,358 colours. The trap in measuring it: a crop of the "wall
region" reads p50 14.751 because it is all mortar joints, and would pass.

### Next

Round 10, in the order the evidence supports. Baked vertex AO in `buildings.ts` is proved out
end-to-end — triangle-accurate occluders through a uniform grid, seam vertices 12–18% below open
faces on the stove, generator, bed and lamp, bit-identical to brute force at a third of the cost,
and deterministic. It has to be baked per building rather than per pool (13 of 30 sampled prototypes
get nothing at all from self-occlusion), it must run after `dye`/`dyeEnds` because those overwrite
the attribute, and its floor is set by one part: `bed.frame` at 0.03283 against the test's 0.025
allows no multiplier below 0.762, so 0.80. It costs about 25× the current geometry build, which is
the reason to defer the bake behind first paint rather than the reason not to do it. Then wall
grain, on the albedo term and not roughness — at roughness 0.9 under a diffuse sky a roughness
perturbation measures as zero. Then the first real draw-call and triangle count of a live colony:
`renderer.info` appears nowhere in this project, so the frame-time regression LOOK.md claims to
watch has never had a baseline that was not a 26-building showcase.

Gate re-run by hand before the commit: `tsc` clean, twelve render test files, 265 tests, 403 test
lines added and nine removed. The nine are one assertion — the tuft's three-blade triangle budget —
replaced by five tests that pin the new budget, the vertex count, the root separation, the bow and
the blade's slimness, with the folded blade's own five triangles kept in a test of its own because
`fx.ts` still builds leaves out of it. `r9b: 0 console errors, 26 showcase buildings stood, 17
ms/frame`, which is r7's and r8's number.

---

## 2026-09-06 — Round eight, and a light that was applying its own falloff twice

**Track: the rendered game.** Four lanes. The sixth frame added at the end of round 7 paid for
itself in the first hour: the defect it exposed was not a lighting preference, it was arithmetic.

### Better

**The sun was multiplied by its own angle twice.** With the sun eight degrees up, nothing in the
colony cast a shadow — not the wall, not the trees, not the pawns. The shadow map was innocent
(forcing the floor to 1.0 photographs crisp shadows), and so was `shadowStrength`, which floors at
0.38 and never switches off. What the eye reads is the shadow's strength times *the sun's share of
the light landing on the cell*, and that share was 0.207: `sun.intensity` was scaling itself by
sin(elevation) when the shading maths already applies N·L, so the key light spent the evening worth
a fifth of the frame, while a readability floor built for a moonless night had already climbed to
1.49 with the sun still up. An omnidirectional term was outshouting the sun two to one. A shadow can
only take away what the sun was putting there, and it was putting 8%.

The numbers, before and after, at noon and at 17:24 — sun / shadow / hemisphere / fill / ambient:

    before  noon  2.577 / 1.000 / 0.731 / 0.680 / 0.300     dusk  0.719 / 0.380 / 0.401 / 0.292 / 1.490
    after   noon  2.577 / 1.000 / 0.731 / 0.680 / 0.300     dusk  1.912 / 0.590 / 0.273 / 0.199 / 0.522

Noon is unchanged by construction and unchanged in the frames. At eight degrees the sun's share goes
0.207 to 0.542 and a shadow now takes a third of the light where it took a twelfth. The evening also
has a colour for the first time: the sun held its daylight mix until six degrees, and the fill light,
which stands on the anti-solar side, was taking the sunset tint and acting as a second sun behind the
camera — cancelling the warm-against-cool split that evening is made of. Light on flat ground, red
over blue: noon 1.238, dusk 0.709 → 1.700. The old dusk ground was literally bluer than midday.

**The grave, the trap and the statue**, the last three kinds that read as flat objects. The grave is
a heaped mound with clods turned into it and a timber cross at its head; the trap is a sprung frame
with jaws, teeth and a visible trigger standing a hand's width above the rails; the statue is a
figure with shoulders, a head and one raised arm. All three are legible from the manager camera now.

**The trees, at branch scale.** Round 7's lobes were limb-sized and from overhead read as broccoli.
Amplitude down (0.24 → 0.15), frequency up (3–8 lobes on 24-segment skirts, a flatter spectral
falloff so the high lobes survive), and two crown variants hashed per tree, so each rim crosses its
own mean girth six to twelve times and no two trees repeat a silhouette. This is the best the wood
has looked.

**The tail, and the class of bug behind it.** The mossback's tail was a nine-sided capsule in the
hoof tone whose flat end cap pointed at the standard camera — a black hexagon in the rump. It is a
swept tapering tube ending in a dome, in the coat's own deeper tone, and the lane went looking for
the same shape elsewhere: darkest tone, presented end-on, too few segments. Boots were raised; the
hooves, the nose and the antler tines were found, priced and left, with the reasons written down.
The mossback is at 2,482 of its 2,500 triangles, paid for by taking the collar's tube section from
six sides to four.

**The stripped bush, fourth round and finally a plant.** Not a rebuild — colour, ordering and
symmetry. Grey-beige to the ripe bush's own green a little duller (a picked bush has lost its
berries, not its chlorophyll); the canes dropped below the leaves instead of caging them; seven
leaves at uneven bearings with one wide gap, two of them plainly larger, the knot carried off-axis,
and a seeded yaw per cell so a hedge is not one stamp printed. Beside the ripe bush it now reads as
the same plant in two states.

### Still wrong

**Nothing in this game should be black at noon.** The new lamp shade is a well-argued piece of
geometry — a shell turned down the outside and back up the inside so it is not a hole seen from
below — and from the manager camera at midday it renders as a flat black bowl, the darkest thing in
the frame. The watermill wheel reads nearly as dark. Whatever the cause (an inverted shell, or a tone
that was picked against a brighter ambient than the one this round shipped), it is the same defect
the tail had: a part the camera meets face-on with no light on it.

**Grass is a bird track.** At the settler camera a tuft is a three-pointed star with a hard notch,
and a field of them reads as a scatter of arrowheads rather than as grass. Rounds 6 and 8 both
improved the colour, the lean and the density of a shape that is itself wrong at close range.

**My briefing error, worth recording.** I put the conduit — which reads as a blue barbell lying on
the floor — in the decor lane's brief. It is built in `buildings.ts` and coloured in `palette.ts`,
neither of which that lane owns, so it came back correctly reported as untouched while the lane that
could have fixed it was never asked. A brief has to name the lane that owns the file, not the lane
that owns the subject.

Gate re-run by hand before the commit: `tsc` clean, eleven render test files, 241 tests, 393 test
lines added and none removed.

---

## 2026-09-06 — Round seven, and the instrument that could carry it

**Track: the rendered game.** Four lanes, briefed off round 6's leftovers, and one of the four
existed only because the previous round had been measured and found to have delivered nothing.

### Better

**The ground has grain.** Round 6 asked twice for texture in the dirt and got none, because a colour
set at the corners of a shared lattice is ramped across the whole cell before it is ever drawn. This
round did not touch those constants — it changed the instrument, and put the variation where it can
vary at the frequency of a pixel. It arrived, and it is measured rather than admired: fit a plane to
every 32x32 tile and take what is left over on the flat ground, and the tenth percentile goes 0.155
to 0.897 grey levels in the close-up and 0.221 to 1.111 in the colony frame — five times the detail
on the surfaces that had none. In the frames there is no banding and no tile you can find twice.

**The machines stand on something.** A stove, a generator, a battery and a cooler all sat directly
in the dirt with a flat face where a machine has a mechanism. They have feet and skids now, a firebox
door on hinges with a lever for a handle, a flue with collars and a rain cap, louvres recessed into
their housing with the blades tipped, cable glands and cables. The solar panel has a bolted plinth
and a yoke, with rails and purlins under the glass instead of a slab on a post.

**The trees stopped being rings.** Round 6 rebuilt a tree as four skirts and from directly overhead
they still read as concentric circles, because every skirt was a circle. Each skirt's rim radius now
runs per meridian between 0.57 and 1.13 of its nominal, so no two tiers share an outline and the
edge is lobed rather than turned. In profile a stand of them reads as a forest.

**The mossback's saddle.** It was a tube laid tangent to the animal's back, painted in the hoof tone,
which at eye level was a dark seam cut into the shoulder — the hole burnt in the hide that round 6
logged. It is an offset shell of the animal's own body ellipsoid now, in a tone of its own, so it
sits on the hide as markings rather than through it. Hands gained a thumb and boots a heel, ball and
toe, which is what stops a foot reading as a wedge.

### Still wrong

**The tail flag, which is the same bug one part further back.** `pawns.ts:1326`: the mossback's tail
is a nine-sided capsule in the darkest tone, and from behind — the angle the colony frame actually
shows — you see its end cap, a flat black hexagon set into the rump. The shoulder crop across rounds
5, 6 and 7 shows the stripe leaving and the hexagon staying. Two rounds have now fixed a dark part
that was read as a hole and left the neighbouring dark part alone.

**The stripped bush, a fourth time.** Stone, then lichened stone, then dead spider, and now a dried
flower: the silhouette is finally right — broad leaves, low, gappy — but the leaves are grey-beige
rather than green, the canes cross *over* the canopy instead of running under it, and the whole thing
is radially symmetric, which no bush is. The camera was the problem for three rounds; this round it
is the colour and the ordering.

**Smaller.** From overhead the new tree lobes are coarse enough to read as broccoli. The hunt mark is
still a large flat wedge when an animal is near the camera. In the wide showcase frame the grave
reads as a doormat and the trap as a plate.

**Not a bug, checked and dismissed.** The flat gold squares scattered through the showcase frame,
which have looked like a missing model since round 3, are pen-zone paint — `fx.ts:491`, straw-gold
for every zone that is not a stockpile. They are the overlay doing its job. *(Half right, corrected
in round 8: the solid squares lying on the ground are that zone paint, but the ones hovering over
the turret, the cooler and the lamp are a different overlay — the unpowered mark at `fx.ts:295`, a
four-sided ring over any built machine that wants watts and is not getting any. Two overlays in the
same colour family, and I named one of them for both.)*

### The harness gained a frame

Every frame in this loop has been pinned to noon, which is the fairest light to judge a model in and
the least revealing about the light itself: the sun is overhead, the shadows are short, and the warm
band at the horizon never appears. A lighting lane cannot be judged that way, so `shot.mjs` now takes
a sixth frame with the sun about eight degrees up and puts the clock back afterwards. A round-7
baseline for it was captured before round 8 was briefed, so the first lighting change has a before.

Gate re-run by hand before the commit: `tsc` clean, eleven render test files, 229 tests, and every
test change in the diff an addition.

---

## 2026-09-06 — Round six, and a grain the frame never got

**Track: the rendered game.** Four lanes again, briefed off the round-5 frames: the grass, the
trees, the furniture at manager zoom, the ears at a metre and a half, and the trampled ground.

### Better

**The wood.** A tree was three bowls stacked — each tier's widest point sat *above* where it met the
trunk, so every underside faced up and the whole thing was three cones standing on their points. It
is four skirts now, each running out and *down* from the trunk to a rim that hangs below the joint,
with radius and droop both falling off with height, a bole better than a third of the tree, and
girth hashed separately from height so a stand is tall-thin beside squat-wide instead of one shape
repeated. At eye level the horizon is a forest; from above a tree has a trunk.

**The grass.** It was one stamp: same size, same green, same lean, uniform density, carrying on
unchanged across bare earth. Per-tuft height, rotation, lean and tone now vary deterministically and
the density falls where the ground is bare. The wallpaper read is gone at both cameras — this is the
single biggest change to how a frame of this game looks, and it is the cheapest geometry in it.

**The beds.** A bed was a brown tile with a paler tile on it. It has legs, side and end rails, head
posts, a mattress dropped inside the rails and standing proud of them, a pillow with a pillow's
proportion and a blanket folded over the foot. Tables got an apron and legs that taper the right way
round — they were thin at the top and thick at the floor, which is a stool.

**The ears.** The dunhare's two ears were 6 cm wide, 2.7 cm thick and nearly coplanar, so at a metre
and a half they collapsed into one dark stick through the head. They are lathe blades now, 11 cm
across with a 7 cm gap at the midline and a pale lining that stands proud down the middle and sinks
into the rim at the edges — a lit cup in a dark blade, nothing coplanar. Same pass on all four
species; eyes, noses, muzzles and tail tips all gained a segment or two. Paid for inside the 2,500
budget by cutting a hidden second egg out of the hare's saddle and taking the collar torus from
10×24 to 6×22.

**A bug the lane found on its own.** One shared collar torus is cut to a mossback's throat and every
species wore it unscaled: on a dunhare it was a hoop nearly half again the width of the animal's own
head, hanging in the air, touching nothing. It scales to each species' neck radius now, with a test
that reads the neck lathe's own rings and asserts the strap straddles the hide.

### Still wrong, and one of them measured

**The ground grain never reached the frame.** The terrain lane raised the speckle share, the speckle
depth and the mottle lift, and the frames look exactly as they did. Not a judgement call: fit a plane
to every 32×32 tile of a frame and measure what is left, and the flat-ground residual is 0.185 →
0.209 grey levels in the closeup and 0.325 → 0.321 in the colony frame. A quarter of one grey level
is a smooth gradient with nothing on it.

The reason is structural and it is in the file's own first line: *one non-indexed quad per cell,
coloured at its corners*, on a lattice where a corner is shared by neighbouring cells. A per-corner
value cannot be grain. It is bilinearly ramped across a whole cell — two hundred pixels at closeup —
and averaged with its neighbours before that. The instrument cannot produce the thing being asked
for, however the constants are tuned. If the ground is to have texture it has to come from the
material (noise in the fragment shader, or a small tiled map multiplied into the vertex colour) or
from scattered geometry, the way the loose stones already are. That is the round-7 brief, and it is
worth writing down as a general lesson: *before briefing an amplitude, check the instrument can carry
the frequency.*

**The stripped bush, twice overcorrected.** Round 4 left it near-black and it read as a stone; round
5 lifted the colour and it read as a lichened stone; round 6 opened the silhouette into a cage of
thin branches and from directly overhead it now reads as a dead spider. Three rounds on one small
object says the object is being briefed from the wrong camera.

**Smaller.** From directly overhead a tree is still a set of concentric rings — the outline is not
broken enough. The mossback's dark saddle reads as a hole burnt in its shoulder at eye level.

Gate re-run by hand: `tsc` clean, eleven render test files, 227 tests (twelve new, and every test
change in the diff is an addition — no assertion was relaxed to make a lane green).

---

## 2026-09-05 — Round five, and a probe that asked one animal at a time

**Track: the rendered game.** The first round driven entirely from inside the repo — the harness in
`scripts/look`, the round workflow in `.claude/workflows/look-round.js`, the method in
[LOOK.md](LOOK.md) — and briefed straight off round 4's leftovers. Four lanes, four builders, the
same five frames plus the zoo, read by eye afterwards.

### The brief, and what came back

**Buildings.** The wall was breeze block at 1.6 m: five courses over two and a half metres put a
half-metre block on a timber cabin, and heavy mortar between them. It is seven courses now, with a
3.6 cm recessed joint that reads as a shadow line rather than as grout, every board a hair lighter or
darker than its neighbours, and the vertical joints of one course broken against the next. A course
that stops at a doorway stops short and is closed by a separate part, so the joints beside a jamb no
longer stack into one column. The watermill got a pitched roof.

**Decor and crops.** A crop is green at every stage now and only the produce turns gold — the old
plant ripened *into* yellow-olive, so a field ready to cut read as a field that had died, and a
player scanning for food was scanning for the colour of drought. The seedling is a rosette of four
broad leaves instead of a nearly invisible spike, and the leafy stage bows two tiers of leaves off a
stalk. Gold is a vertex-colour ratio on the heads rather than three fixed numbers, so it stays gold
the next time the leaves move.

**Pawns.** The hunt mark was an orange traffic cone in first person; it is a small hollow teardrop
that hugs the animal, sitting at a height each species names itself. The dunhare, which from manager
zoom was a pale smudge, got a dark saddle and dark ears raked back over its spine.

**Terrain.** Per-patch luminance noise on the ground, so the grass is no longer one flat sheet under
the camera at manager zoom.

### The verdict, from the frames

**Better,** in all four lanes: the wall reads as boards at first-person distance, the mill has a
roof, the ground has variation, a ripe plot is green carrying gold, the seedling is visible, the mark
is small, and the hare is legible from above.

**Still wrong.** The stripped bramble overshot. It was near-black and read as a stone; lifted to a
pale grey-green it now reads as a lichened stone. Colour was the wrong instrument — the shape is what
says foliage.

**Two frames, one question, one probe.** In both the round-4 and round-5 zoo frames the hunt mark
appeared to hover over the animal *beside* the hunted one. The code says it cannot: the mark is a
child of the animal's own rig and its visibility is that animal's `hunted` flag. So rather than brief
a bug from a crowded row, the scene was reduced to the claim — one hunted dunhare, alone, nearest
other animal thirty-three cells away. The mark is over the hare. The reading was mine, not the
renderer's; the zoo row is simply dense, and it ticks twice before the shot.

The gate: `tsc` clean, eleven render test files, 215 tests green — run again by hand before the
commit, because a builder's green is a claim and the tests are the thing being changed.

Leftovers for round 6: the stripped bush's silhouette; the hare's ears, which at close zoom collapse
into a single dark sliver; and the grass tufts, which at that zoom are flat two-blade chevrons.

---

## 2026-09-05 — Four rounds of looking, and the camera that made them repeatable

**Track: the rendered game.** Every other entry here is a grid answering a number. This one is a
camera answering a question no grid can be asked — does a thing look like what it is — and the
four rounds it took to get the models off their boxes and cones. The method, the instruments and
the gotchas are now written down in [LOOK.md](LOOK.md); this is the log of the rounds.

### The loop

One brief per lane, built in parallel by agents that never touch each other's files, gated by
`tsc` and the render tests, then the *same frames* photographed again and read by eye. Same seed
(4242, typed into the setup card — `world.seed` is a constant and lies), same tick (the first past
1800), same hour (noon; dusk hides everything), HUD hidden, the ground round the camera revealed by
hand. Five standard frames — settlers close, the twenty-six-building showcase wide, the showcase
close, the colony from high up, and a settler's own eyes — plus, from round 4, a staged zoo of every
animal, every crop stage and every loose item on clear ground.

The one rule that carried the quality: the driver opens every PNG. Builders return `green: true`
and a summary, and a summary is not a photograph. Two of the four rounds had a verdict overturned
by looking.

| round | lanes | what shipped |
|---|---|---|
| 1 | all six | rounded primitives in place of boxes, an environment map on the scene |
| 2 | pawns, buildings | settlers got a figure; buildings got their parts |
| 3 | pawns, buildings, decor, terrain | hairlines, belts, boots, rifle stocks, masonry, corner posts, door frames, one stone palette, knee-high grass, and `groundLiftAt` so marks and rings sit *on* the ground |
| 4 | pawns, buildings, decor, terrain | the animals, the crops, the bushes and everything dropped on the floor |

### Round 4, read frame by frame

The brief came from the first zoo frames, where four species were one silhouette at four scales and
five of six item kinds were the same bevelled cube in different colours.

**Better.** Each animal now reads as itself at manager zoom: the mossback is a humped grazer with
three-tined antlers, a dorsal ridge and hooves; the dunhare a crouched rump-high shape with ears
taller than its skull; the brambletail a russet fox with an actual brush; the fenwolf a grey-brown
hunter with a ruff — and no longer lavender, which was `pawnTint` (built for cloth, +68° of hue on
the seed) applied to a cold blue-grey base. Hides go through `hideTint` now, which varies lightness
and holds hue. Items are six objects: crossed logs with pale cut ends, a pyramid of ingots, a heaped
mound with tubers, a strapped crate, a white case with a red cross, a rolled pelt. `components` and
`assemblies` had *no pool at all* and had been invisible on the ground since they were added. Walls
break bond, so the first-person wall stopped reading as a filing cabinet. Crops are three shapes
rather than one scaled three ways, the growing zone is tilled brown with furrows instead of a pale
green square, and ripeness on a bramble is berries rather than the whole bush turning yellow. Rock
is angular with a flatter plateau and a darker underside; the pillowy boulders are gone.

**Still wrong.** The seedling stage is nearly invisible at manager zoom. The mid and ripe crops still
share a flat yellow rosette under the new golden heads, so a ripe plant reads yellow rather than
green-with-a-crop. A stripped bramble is dark enough to read as a stone. The hunt mark is an enormous
orange cone in first person. The wall's mortar lines are heavy and its blocks read oversized at 1.6 m.

**A verdict I got wrong.** I had logged "the hide stack drew as a flat amber diamond flush with the
ground — it is sunk", and briefed the bug. It is a *pen* zone cell: `fx.ts` paints stockpiles blue
and everything else straw-gold, and the same flat gold quads sit beside the game table in the round-3
closeup with no item near them. The builder said so from the code, held its ground, and was right. A
real sinking bug did exist next to it — `itemRest` ignored `groundLiftAt`, so under a full snowpack a
stack was a lid flush with the snow — and that is fixed.

Budgets held: mossback 2452 triangles of 2500 with collar, tag and mark shown, dunhare 2300,
brambletail 2084, fenwolf 2336; bush 280, headed crop 283; item stacks 144–648. The gate stood
twenty-six showcase buildings with no console errors at 17 ms a frame, and `tsc` plus the eleven
render test files (206 tests) are green.

### What the harness cost to get right

Two artefacts wasted more time than any bug in the game. Headless Chrome without
`--ignore-gpu-blocklist --use-angle=metal` falls to SwiftShader, where a frame takes seconds, the sim
advances a few ticks a minute, `world.seen` never fills — and every frame comes out hazed grey-blue
by the shroud, which looks exactly like a lighting regression. A whole round was judged "fog
everywhere" and the lighting lane was nearly briefed for it. And the first-person camera reads a rig
that only learns its position from a sim tick, so a pawn teleported into a staged scene while paused
renders where it used to stand and the camera shoots the old spot. Tick twice before the shot.

Both are now in `scripts/look/chrome.mjs` and LOOK.md rather than in anybody's memory.

Round 4 cost 32 minutes of wall clock and about 650k tokens across six agents. The leftovers above
are the round-5 brief.

---

## 2026-08-14 — The fence that was worth eight cells

**Track A: a measured fix.** The last round shipped two sim changes under one sixty-day grid and the
grid came back worse. This round is the arithmetic that says which one, and the constant that puts it
right. One line of `src/sim/combat.ts` moved, so the fingerprint moved and the grid was re-run.

### The thing you cannot do from an aggregate

That grid carried `walkTo` re-pathing a route cut by new geometry *and* raiders taking a fence apart.
Across fifteen unmanaged runs it read survivors 141 → 110, buried 28 → 40, the unfed column
14.2 h → 43.9 h, and the enforced promise `on-their-feet-at-zero-is-a-walk-home` broke for the first
time — settler/1312 left somebody upright at zero for **47.6 h** against a twelve-hour bar. Naming a
culprit from that is a guess, and I had already guessed once: I generalised "the sim got better" from
a single seed's pin and the aggregate said otherwise.

`scripts/probe-split.ts` plays *one* colony under *one* tree. Sixty days of a single seed is two
minutes rather than an hour and a half, so the same seed can be run under each change alone and the
difference read directly. It takes no flags for the variants — the worktree it is built in *is* the
variant — and it says `steward: false` out loud, because `runColony` opens `opts.steward ?? true` and
the grid's fifteen unmanaged runs are the arm every starvation principle is drawn from.

Three trees, sixty days, past founding:

| run | tree | feet | floor | strand | unfed | downs | buried | alive |
|---|---|---|---|---|---|---|---|---|
| settler/1312 | base `8e105f8` | 1.9 | 0.0 | 0.0 | 0.0 | 17 | 1 | 11 |
| settler/1312 | walkTo `d28dcbf` | **0.9** | 0.0 | 0.0 | 0.0 | **9** | 2 | 9 |
| settler/1312 | head `86c18ac` | **47.6** | 45.7 | 34.4 | 34.4 | **86** | 8 | 5 |
| calm/7 | base | 0.0 | 0.0 | 0.0 | 0.0 | 4 | 0 | 13 |
| calm/7 | walkTo | 8.9 | 0.0 | 0.0 | 0.0 | 2 | 0 | 15 |
| calm/7 | head | 7.2 | 0.0 | 0.0 | 0.0 | 0 | 0 | 8 |

`base` and `head` reproduce their grids exactly, which is the only reason to believe the middle row.
The re-path **improved** the seed that broke the bar — nine downs against seventeen. The whole
regression is the fence.

### Which half of the fence change

Two more variants off HEAD: pricing at time parity, and deleting the priced branch so only the
no-route fallback survives.

| run | variant | feet | floor | strand | unfed | downs | buried | alive |
|---|---|---|---|---|---|---|---|---|
| settler/1312 | price 0.32 | **0.9** | 1.8 | 1.8 | 0.0 | 40 | 1 | 8 |
| settler/1312 | no priced branch | 8.5 | 32.3 | 10.4 | 5.8 | 61 | 5 | 7 |
| calm/7 | price 0.32 | 2.2 | 0.0 | 0.0 | 0.0 | 1 | 0 | 10 |
| calm/7 | no priced branch | 0.0 | 0.0 | 0.0 | 0.0 | 2 | 0 | 9 |

Cutting the priced branch entirely is *worse* than pricing it honestly, which answers the obvious
retreat. The branch stays; the number was wrong.

### The number

```ts
const BREACH_CELLS_PER_HP = 0.32;   // was 0.12
```

Cells of extra walking a raider will trade for one hit point of whatever is in the way. A raider
walks 0.191 cells a tick at raiding pace and takes roughly 1.7 ticks a hit point off a wall with a
club, so **one hit point costs what 0.32 cells of walking costs**. That is parity: above the line the
way through genuinely arrives sooner, below it the raid is knocking a hole in something in order to
turn up late.

It shipped at 0.12 — a third of parity — on the reasoning that a raider crossing open ground is a
raider being shot at while it crosses, so the detour deserves a discount. That argument is the wrong
way round. A raider standing still swinging at a rail is also being shot at, for longer, and it is
not closing the distance while it happens. If the constant leaves parity at all it should leave it
*upward*.

At 0.12 a seventy-hit-point fence was worth breaking to save **eight cells** of walking, which is
nothing — so raids stopped routing to the gate and started coming through whichever siding they were
nearest. At 0.32 a fence is worth breaking to save twenty-two cells and a hut wall to save
forty-two: a rail thrown across the approach, not the ring round the goat pen.

### Why eight cells cost eighty downs

`raiderAI` resets `pawn.frustration = 0` on any tick the raider acted, and `attackBuilding` returns
`true` whenever it is in range. So **a raider committed to a breach never loses its nerve.**
`RAIDER_GIVE_UP` — 800 ticks, four in-game hours — was the valve that ended a raid geometry had
defeated, and after the breach change geometry stopped ending raids at all. The constant does not
decide how a breach behaves; it decides how often a raid enters the state it can never leave. That is
why a third of parity was not a third of the effect.

### The grid

Fingerprint `585b73c4` → `ad0668a1`, 39 colonies in 5252 s. The fifteen unmanaged sixty-day runs,
with the grid from *before* either change alongside, so the fence reads against the world it was
added to:

| | before `8b19f4e1` | at 0.12 `585b73c4` | at 0.32 `ad0668a1` |
|---|---|---|---|
| upright at zero, worst / summed | 9.8 h / 52.3 h | 47.6 h / 84.1 h | **11.1 h / 40.1 h** |
| on the floor at zero, worst / summed | 35.1 h / 164.5 h | 45.7 h / 184.2 h | **35.4 h / 123.3 h** |
| stranded, worst / summed | 8.0 h / 36.4 h | 34.4 h / 55.1 h | **9.8 h / 42.9 h** |
| unfed, worst / summed | 4.7 h / 14.2 h | 34.4 h / 43.9 h | **6.4 h / 28.3 h** |
| downs · buried · survivors | 704 · 28 · 141 | 672 · 40 · 110 | **671 · 19 · 122** |
| peak hands · verdicts | 167 · 9 holding 6 thriving | 128 · 9 / 6 | 135 · 8 holding 7 thriving |

`on-their-feet-at-zero-is-a-walk-home` reads **holds** again — longest spell anywhere 11.1 h,
harsh/424242. That is the enforced promise the last grid broke and the whole reason this round
existed. It holds with 0.9 h of room, which is less room than it had before the fence existed, and
that is worth saying rather than calling it fixed.

The costs, honestly. Against the world before the fence change every worst-case column is slightly
**up** — 9.8 → 11.1 upright, 8.0 → 9.8 stranded, 4.7 → 6.4 unfed, floor flat at 35.1 → 35.4 — while
three of the four summed columns are down, sharply for the floor at 164.5 → 123.3. Burials went
**28 → 19**, a third fewer than before raiders could touch timber at all.
`nobody-starves-beside-a-full-pantry` went 7 of 15 runs to **5 of 15**, at a worse worst (4.7 → 6.4).
Fewer colonies fail that promise and the ones that do fail it harder, which is what a defence layer
that now costs something looks like from the kitchen.

Survivors read 141 → 122, and that is not people dying: peak hands went 167 → 135 on the same run set
while burials went *down*. Nineteen fewer at the end with nine fewer graves is a headcount that never
arrived rather than one that was killed — storyteller arrival rolls landing differently once anything
upstream shifts. The same wobble is in the isolation table above, where calm/7 reads 13 → 15 → 8
survivors across three trees with zero deaths and zero downs in the last arm. Survivor count on a
fifteen-run grid is a soft number; graves and the starvation columns are not.

### The test that was passing on a three-cell margin

`tests/breach.test.ts` had a case titled *goes through the near rail rather than all the way round to
the gate*, and it went red at 0.32. It deserved to. Round that pen to the gate and back in is about
**nine** cells further than the straight line, against a threshold of 8.4 at the shipped constant: it
was passing on a three-cell margin and would have passed at almost any number below parity.

Re-fixtured to burn the near rail to `hp = 20` first, and retitled *goes through the rail it has
already burned rather than round to the gate*. That is not fixture convenience — nine cells is
cheaper than seventy hit points of standing still, so a **full** rail there is correctly left alone
(which the next test already pins), and the real case for going through is a rail that costs less
than the walk. It now tests the property that is scale-independent: priced against the structure's
*current* health, so the one somebody has already burned half through is the tempting one.

### Verified

- `npx tsc --noEmit` — clean.
- `npm test` — **1897 passed, 13 skipped, 0 failed** across 102 files in 1676 s, run serially with
  nothing else on the box. The thirteen skips are the five opt-in grids behind `BALANCE`, `SWEEP`,
  `LIVE`, `POOL` and `ECO`, which is how they have always run; nothing was skipped to make this
  green. The first attempt was run *beside* the sixty-day grid and came back with seven failures, all
  seven `Test timed out in 300000ms` and not one assertion, on a suite that took 2561 s against
  1090 s alone. That was a scheduling mistake, not a result, and it is recorded here because a
  timeout list looks exactly like a regression list in a log.
- Sixty-day grid `585b73c4` → `ad0668a1`, 39 colonies in 5252 s, and `npm run balance` re-judged
  against it.
- `tests/breach.test.ts` — four tests, one re-fixtured as above. The other three untouched and green:
  a pen with no gate gets broken into, a three-cell stub across open ground is walked round and left
  standing, and the raid comes through the hole it made and reaches the settler behind the fence.
- `scripts/probe-split.ts` — fixed. It read the four starvation columns and downs/buried/survivors
  off the `EvalReport`, where they do not exist, and every arm died on `Cannot read properties of
  undefined`. They are `DaySnapshot` fields, every one a running maximum, so the last snapshot is the
  whole run — which is exactly how `sweep.ts` builds a `RunMeasure`, and is the only reason these
  numbers can be set beside the grid's.

### Next

`nobody-starves-beside-a-full-pantry` is the open one, at 5 of 15 and every failing run in hard
country. And the valve this round leaned on is untested: nothing anywhere pins that a raider which
*cannot* reach anybody eventually gives up, because `attackBuilding` returning `true` resets
frustration and `RAIDER_GIVE_UP` never fires for a breacher. A raid that can be made permanent by
geometry is a bug waiting for a map that does it.

---

## 2026-08-13 — The rescuer who was excused for being peckish

**Track A: a measured fix**, plus the instrument that had to exist before the fix could be judged.
Both `src/sim/jobs.ts` and `src/eval/run.ts` moved, so the fingerprint moved and the sixty-day grid
was re-run.

### The column the round below asked for

The last entry's *Next* was to split the stranded column: some of those hours are a meal legitimately
walking over, and a column that excluded them would name **dispatch alone**. `unfedStarveHours` is
that column — the stranded spell (at zero, on the floor, with somebody upright) minus every tick a
`feedPatient` job already names that patient. `scripts/probe-unfed.ts` mirrors the shipped latch line
for line and reproduced `strandedStarveHours` exactly on both seeds it was checked against, 10.48 and
7.25, which is the only reason to believe the narrower reading beside it.

Pre-fix, on four unmanaged sixty-day seeds:

| run | stranded | unfed | of stranded ticks, a meal was already moving |
|---|---|---|---|
| harsh/20260729 | 10.48 h | **7.95 h** | 37 % |
| harsh/7 | 7.25 h | **3.27 h** | 61 % |
| harsh/424242 | 6.68 h | **2.26 h** | 47 % |
| settler/99001 | 6.63 h | **1.30 h** | 90 % |

Between a third and nine tenths of the column was a colony that *had* answered and was too slow. That
is a real problem and it is not the one this promise is about.

### One tick in six thousand

The busy-hands slice was supposed to be the target. It was not. Re-running `scripts/probe-feed.ts`
unmanaged on the three worst harsh seeds and tallying, in order, every gate `sendSomebodyToFeed`
checks before sending somebody: **of 6036 settler-ticks where the pass looked at an upright colonist
and declined to send them to somebody lying at 0.00, 6035 declined on the rescuer's own hunger.** One
tick in six thousand was anything else. The pass was working. It was being asked the wrong question.

The gate read `p.needs.food <= HUNGRY`, and `HUNGRY` is 0.34 — at `FOOD_DRAIN`, most of a working day
still in hand. The comments defending it said a settler who is themself starving deals with that
first or two die instead of one, which is true, and 0.34 is not starving. The errand *begins* at the
food stack, and nothing takes hit points off until zero.

### The change

```ts
const RESCUER_KEEPS = PATIENT_EMERGENCY_FOOD;   // 0.14
```

The same line, deliberately: a settler is excused from carrying a meal exactly when they are the
person somebody should be carrying one *to*. Three call sites — `sendSomebodyToFeed`, `assignJob`'s
`canRescue`, `assignNeedsOnly`. On the synthetic colony in `tests/feeding.test.ts`, time-to-first-meal
for a settler on the floor went **176 ticks → 49**.

### The grid

Fingerprint `ce4d9a8f` → `8b19f4e1`, 39 colonies in 3016 s. Fifteen unmanaged sweep runs, sixty days:

| | before | after |
|---|---|---|
| on the floor at zero, worst / summed | 58.39 h / 197.4 h | **35.14 h / 164.5 h** |
| stranded, worst / summed | 10.48 h / 48.4 h | **8.04 h / 36.4 h** |
| unfed, worst / summed | — | 4.72 h / 14.2 h |
| upright at zero, worst / summed | 7.92 h / 39.4 h | **9.79 h / 52.3 h** |
| downs · buried · survivors | 757 · 29 · 138 | **704 · 28 · 141** |

The upright column going **up** is the honest cost, and it is the cost the change asks for: rescuers
now spend their own margin on the errand. 0.14 is about 4.1 in-game hours of walking and the widest
crossing of the map is 6.2 h, `feedPatient` is in `NEVER_INTERRUPTED`, and the carrier takes one meal
and does not eat it — so a rescuer sent from just above the line to a patient at the far end can
arrive empty. The enforced bar on that column is twelve hours and the worst run is 9.79, so it holds,
with less room than it had. Against that: 53 fewer downs, one fewer burial, three more survivors, and
the worst wait on the floor cut by 40 %.

`nobody-starves-beside-a-full-pantry` now reads the narrow column, because its claim — *"is brought
one, by somebody who can"* — is about being **sent**. It went from 9 of 15 runs at worst 10.5 h to
**7 of 15 at worst 4.7 h**. Like-for-like on the old column the count is unchanged at 9: the fix
shortened the waits, it did not end them. The bar stays at one hour and stays open.

### The steward default, for the third time

`runColony` opens `const useSteward = opts.steward ?? true`. `--steward` is opt-in on
`npm run measure` and `measurements.json` records `steward: false`, so **the managed colony has no
grid coverage at all** — and every probe that forgets the flag measures the one arm nothing else
measures. It cost a round in `probe-upright.ts`, it put a contaminated four-way split into
`principles.ts` and `tests/feeding.test.ts` (both corrected here), and this round it surfaced as an
arithmetic impossibility: `probe-starve-pin.ts` read harsh/424242 at **155.7 h** upright at zero over
twenty days against the grid's 6.5 h over sixty, which no monotone longest-spell latch can do. Two
colonies, not one latch. Run unmanaged, the same seed reads 6.5 h at twenty days — the grid's number
exactly, since the worst spell happens early and never gets worse.

The probe and the pinned fixture both say `steward: false` out loud now, with the reason.

### The pin moved, again

`tests/colony-eval.test.ts` pins all four columns nonzero on a named run so a new column cannot die
wired to nothing and green forever. It is meant to fail when the sim gets better and it did, on
`expected 12.56 to be less than 12.56`: harsh/1312's floor and stranded columns **converged**, because
feeding people sooner kept that colony conscious and it never went fully dark. Re-pointed off the
probe to **harsh/99001, 20 days, unmanaged** — feet 1.9, floor 18.2, stranded 8.0, unfed 4.7 — which
is the grid's own worst run for both columns the promise is drawn on, and catches their exact
sixty-day readings (8.04 and 4.72) inside twenty days.

### Verified

- `npx tsc --noEmit` — clean.
- Sixty-day grid, `ce4d9a8f` → `8b19f4e1`, 39 colonies in 3016 s.
- `tests/feeding.test.ts` — three new, 8 → 11. A settler at 0.30 is worth the lunch break; a settler
  at 0.14 exactly is not, because the gate is `<=` and they are nearly the next patient; and an
  experience test that steps a whole colony of hungry settlers tick by tick and asserts the one on
  the floor is fed inside 100 ticks. That bar was measured, not guessed — a throwaway probe put the
  old gate at 176 ticks and the new one at 49, and 100 sits between them and near neither. The first
  version of that test asserted a food level after 900 ticks and **passed on the old code**, which is
  a decoration, not a test.
- `tests/balance-principles.test.ts` — one new pair. Nine hours stranded with a meal moving must read
  `holds`; the same nine hours with nobody sent must read `broken` **and quote 8.6, not 9.0**. Both
  fail on the old check. That file is hand-written cases rather than one per principle, so a check
  can ship with none.
- `npm test` — 98 of 100 files, **1866 green**, 13 skipped, 861 s. `npm run build` — clean.

### Next

How slow the carry is. The split says between a third and nine tenths of the stranded column is a
meal already in motion, and nothing measures whether that motion is fast enough — a per-tick latch
cannot, it wants a per-delivery clock from `feedPatient` created to fed. That is also the instrument
the deferred `stalledDays` replacement wants.

Then the rescuer's own margin, if the upright column keeps climbing. The clean fix is for the carrier
to take two meals and eat one at the stack; the cheap one is a floor on `RESCUER_KEEPS` that scales
with the distance to the patient. Neither is worth writing off one grid.

Carried forward unchanged: `starveHours` counts a **drafted** settler as upright, and
`sendSomebodyToFeed` skips drafted settlers on purpose. Harmless on the fifteen unmanaged sweep runs —
nothing drafts anybody without a player or a steward — but worth excluding when either column is next
touched.

---

## 2026-08-13 — The settler who slept through starving

**Track A: a measured fix.** One deleted early return in `src/sim/jobs.ts`. In `src/sim/**`, so the
fingerprint moved and the sixty-day grid was re-run.

### It was not a population

Last round handed this one its target: 102.1 h in the **on their feet** starvation column, four days
of somebody upright at zero food, printed by every verdict and judged by nothing. The obvious read is
a colony-wide walk-home problem. It is not. Sorted by run, the grid's upright column is 102.1 h in
one place and **7.92 h** in second place. One run, harsh/424242, and inside it very nearly one
settler.

`scripts/probe-upright.ts` — outside `src/sim` and `src/eval`, so it does not move the fingerprint —
walks the run tick by tick and asks of every upright settler at or below zero food *what is the first
thing stopping them eating*, in the order the sim would check. 27 524 settler-ticks came back under a
single answer: **`is asleep`**, with reachable food the whole time and a larder averaging 187 units.

### The false lead, kept

The first reading of that probe reported a 154.5 h spell against only 20.3 h of ticks in trouble,
which is arithmetically impossible unless the latch is leaking. I had a mechanism ready —
`settlements.ts` and `holdings.ts` both lift pawns off `world.pawns` for caravans and campaigns, and
a latch keyed on "still starving" never clears for somebody who is no longer on the list — and it was
wrong. `scripts/probe-absent.ts` ran the shipped latch and a corrected one that clears on absence
over the same world: **both read 102.1 h**. No leak.

The bug was in my probe. It called `stewardTick`, and the fifteen sweep runs the grid measures are
**unmanaged** — `measurements.json` keeps `steward` and `sweep` as separate top-level keys. A probe
that runs the steward is measuring a different colony living a different sixty days. The steward is
now opt-in in `probe-upright.ts` with the reason in its doc comment, and the negative result stays in
`probe-absent.ts` so nobody re-derives it.

### The defect

Two ways to sleep, one of them deaf to hunger. The `sleep` **job** ticks rest and checks
`food < 0.12 && rest > 0.5` every tick. `tryNeedJob`'s last resort — past `rest < 0.12` with every
bunk taken, drop where you stand, no job — is ticked by `tickGroundSleep`, which opened with

```ts
if (bed && isBed(bed.kind)) return; // handled by the sleep job
```

true of a settler in a sleep job, and false of every settler that function is ever called with: both
`tick.ts` call sites are reached only with `jobId === null`. A settler who collapsed onto somebody
else's bunk was therefore ticked by **nothing** — rest never climbed, the `rest > 0.9` wake never
fired, and `tick.ts` sends a jobless sleeper there and `continue`s, so the need pass never saw them.

`scripts/probe-sleep.ts`, same seed, before:

| settler | spell | rest | food at end | on a bed |
|---|---|---|---|---|
| Sela Ashdown | 126.7 h from day 56 | 0.00 → 0.00 | 0.00 | 100 % |
| Ivet Stonehearth | 57.2 h from day 58 | 0.03 → 0.03 | 0.00 | 100 % |
| Sela Ashdown | 13.6 h from day 46 | 0.12 → 0.12 | 0.29 | 100 % |

197.5 h of sleeping rough, 137.6 h of it at or below zero food, all of it on a bed. Sela was asleep
when the run ended.

### The change

Delete the guard. Sleeping rough now gains `REST_GAIN_GROUND` wherever it happens, and wakes on
`rest > 0.9` **or** `food < 0.12 && rest > 0.5` — the sleep job's own rule, so both ways of sleeping
answer an empty stomach the same way. The `rest > 0.5` half is load-bearing: waking somebody at zero
rest sends them straight back down, and a settler yo-yoing between bunk and pantry gets neither. The
rough-night mood hit moved from per-tick to the wake, so it is one charge for one night rather than a
penalty that deepens the longer they manage to sleep.

### The same probes, after

Same seed, unmanaged. A sim change re-rolls the history, so this is a different sixty days and the
totals are not subtractable — but the shape is unambiguous:

| | before | after |
|---|---|---|
| sleeping rough | 197.5 h | 13.4 h |
| of that, at or below zero food | 137.6 h | **0.0 h** |
| longest upright-at-zero spell | 102.1 h | 7.2 h |
| `is asleep` as a blocking reason | 27 524 ticks | **gone** |

The one surviving spell reads `rest 0.12 -> 0.90`: somebody sleeping, and then getting up. What is
left in the upright column on that seed is 3820 ticks of a meal already walking and 3585 ticks of a
hunter out on the moor — both of them a settler doing something, which is a different question.

### The grid handed over a paired sample

Fingerprint `2edb0102` → `ce4d9a8f`, 39 colonies in 2157 s — and **fourteen of the fifteen sweep runs
came back byte-identical**. Every column, every seed, every difficulty. Only harsh/424242 moved:

| run | upright at zero | on the floor | stranded |
|---|---|---|---|
| harsh/424242, before | **102.12 h** | 27.86 h | 3.60 h |
| harsh/424242, after | **7.23 h** | 27.86 h | 6.68 h |
| every other run | unchanged | unchanged | unchanged |

Three rounds running I have had to argue that a summed column moving a few per cent across re-rolled
sixty-day histories is noise wearing a number's clothes. This one is a paired sample by accident: the
deleted guard could only fire for a settler sleeping rough *on a bed cell*, and in sixty days across
fifteen colonies that happened on exactly one of them. The bug was as rare as it was total.

The stranded column on that run went the other way, 3.60 h → 6.68 h. That is the honest cost of the
divergence rather than a regression — Sela gets up on day 56 now, and what she does with the rest of
the run is a history the old grid never had. The grid-wide worst upright spell is now **7.92 h**, on
settler/99001, a run that did not change at all.

### The column is judged now

`on-their-feet-at-zero-is-a-walk-home`, in the fingerprint-exempt `principles.ts`, so it went in
after the grid and `npm run balance` re-ran alone. Twelve in-game hours, and the bar comes off the
map rather than off the grid: `WALK_SPEED` is 0.155 cells a tick, nothing in `TERRAIN_SPEED` is
slower than bare grass, so the widest crossing on a 192-cell map is 6.2 h at a dead walk and twelve is
that twice with the detours. A settler upright and empty for longer than it takes to cross the whole
valley and come back is not walking anywhere.

**Enforced**, against the file's usual convention of leaving a new bar open for one grid. That
convention is for bars around genuinely unsettled design questions; this is a pin on a defect that
has been found, measured and closed, and its whole job is to go red if that settler ever lies down
again. It reads `holds — longest anywhere: 7.9 h — settler/99001`.

### Verified

- `npx tsc --noEmit` — clean.
- Sixty-day grid, `2edb0102` → `ce4d9a8f`, 39 colonies in 2157 s. **22 principles hold, 8 break** —
  the new one is the twenty-second and the broken eight are unchanged in membership.
- `tests/sleep.test.ts` — eight new tests. Seven waking-rule assertions, one each so a failure names
  which rule moved, and one experience test: a settler dropped on somebody's bunk at zero rest and
  zero food, a meal two cells away, half a day of `stepWorld` with nothing touched — they wake and
  they eat. Run against the pre-fix `jobs.ts` and `tick.ts` it fails on the first assertion,
  `still asleep half a day later`, which is the difference between a test and a decoration.
- `tests/balance-principles.test.ts` — two more, because that file is hand-written cases rather than
  one per principle, and a new check shipped with none at all is a check nobody has seen fire: one
  that the bar catches 102.1 h, one that it lets a 7.9 h walk home alone and prints it anyway.
- `npm test` — **1862 tests green**, 13 skipped, 98 of 100 files, in 935 s. Run twice: once on the
  fresh grid and again after the principle and its two cases went in.
- `npm run build` — clean.

### Next

The 45.5 h stranded column, split. The pass fires at 0.14 food and the eval latches at 0.02, so some
of that is a meal legitimately walking over — the probe put that slice at 31.0 h of a pre-fix
reading, the largest non-wipe one. A column that excluded ticks with a `feedPatient` job already
targeting the patient would name dispatch alone, and only then is there a number worth enforcing.

Carried forward unchanged: `starveHours` counts a **drafted** settler as upright, and
`sendSomebodyToFeed` skips drafted settlers on purpose. Harmless on the fifteen unmanaged sweep runs —
nothing drafts anybody without a player or a steward — but worth excluding when either column is next
touched.

---

## 2026-08-12 — Somebody drops what they are doing and carries the meal over

**Track A: a measured fix.** In `src/sim/**`, so the fingerprint moved and the sixty-day grid was
re-run. This one is meant to move a column, and the column it is meant to move is `floorH`.

### The correction that started it

The round below shipped a sentence I had not measured: **"nothing in the sim carries food to a
downed settler."** It is false. `jobs.ts` has had `tryFeedPatient` the whole time, wired into the
`doctor` work case and into an emergency lane that sits *above* the work board in both assignment
entry points, with a comment naming this exact failure. The probe found the population; I supplied
the cause from the shape of the reading, wrote it into the principle, the architecture note, the
round notes and the commit message, and it took writing the fix to notice.

Everything measured in that round stands — the two disjoint populations, the durations, the
recruits eliminated, the pantry stocked throughout. One causal sentence was invented, and the
correction is left in place under the original rather than quietly edited out.

### The measurement

`scripts/probe-feed.ts` — outside `src/sim` and `src/eval`, so it does not move the fingerprint —
asks the question the first probe did not: not *is there a door* but *which gate is shut, and for
how long*. On every tick where a downed settler sits at zero, it asks every other settler why they
are not the one carrying a meal, taking the **first** blocking reason in the order the sim checks
them, so the tally reads as "what would have to change" rather than "what was also true".

Seed 1312, sixty days, before the fix — 88.2 h with a settler starving on the floor:

| slice | hours | what it is |
|---|---|---|
| the whole colony on the floor | 49.6 | nobody conscious to carry anything |
| a meal already on its way | 31.0 | the system working, slowly |
| every settler on their feet was mid-job | **7.2** | the defect |
| somebody standing free, no meal moving | 0.3 | the assignment cadence |

Four slices, one of them a decision the colony got wrong. Both entry points return early on
`pawn.jobId !== null`, so **from the floor, a colony that is merely busy is indistinguishable from a
colony that is unconscious.** Across all three harsh seeds the tallies agree: tens of thousands of
`is downed themselves`, then `is mid-job` in the hundreds to low thousands, and `is asleep` never
once — which is why the fix does not wake anybody.

### The change

`sendSomebodyToFeed(world)`, in `jobs.ts`, called from `stepWorld` right after the fire pass. It is
`firesafety.ts`'s `sendSomebody` with the fire swapped for hunger — colony-level, because "who goes"
is one decision with one answer, and the precedent for cancelling a working settler's job to save a
life is already in the codebase and it is a fire. After the fire pass rather than before, because a
settler running out of the flames is not the one to send for a meal, and a live `flee` can only be
skipped once it has been formed.

What it will not do is the load-bearing half:

- never wakes a sleeper — the probe found not one tick in three seeds where the only hands available
  were in bed, and `firesafety.ts` wakes people because the bed is on fire;
- never touches `flee`, `rescue`, `feedPatient`, `caravan` or `campaign`;
- skips anybody the player has spoken for — drafted, manual, possessed, doctoring off — and anybody
  running on empty themselves, or two die instead of one;
- looks for the food **before** it cancels anything, so an empty larder does not also cost the
  colony a half-built wall.

### The same probe, after

Re-run on the same seed, with one extra tally: on every tick that still reads "the only hands up
were all mid-job", *why did the interrupt decline*. The colony's history diverges the moment the
first meal is carried differently, so this is a different sixty days and the totals are not
subtractable — 92.6 h on the floor rather than 88.2, 49.3 h of it a fully floored colony.

The busy-hands slice reads **4.3 h**, and the breakdown of it is the part worth keeping:

| why the pass declined | settler-ticks |
|---|---|
| is hungry themselves | 1018 |
| is on a job nobody is pulled off (`feedPatient`) | 96 |
| **nothing — the pass should have sent them** | **0** |

Zero. What is left of that slice is a colony where everybody still standing is themselves under the
hunger line — a famine, not a dispatch failure — plus a settler already carrying a meal to a
*different* patient. Neither is something to fix by sending somebody anyway.

### The grid disagreed, and it was right about the instrument

The sixty-day grid came back with `nobody-starves-beside-a-full-pantry` broken on **nine** runs of
fifteen, up from seven, and the floor column up rather than down: 186.4 h summed across the fifteen
unmanaged colonies before, 197.4 h after; worst single run 35.9 h → 58.4 h. The round's headline,
measured against the round's own column, failed.

Two things are true at once and it took some care to keep them apart. The fix is right — the probe's
busy-hands slice reads zero settler-ticks, and the twenty-day run pinned in `colony-eval` lost its
floor spell entirely. And a sim change re-rolls every colony's history, so post-fix runs on the same
seeds are **not paired samples**; a column moving six per cent across fifteen re-rolled sixty-day
histories is noise wearing a number's clothes. The health columns say the same thing from the other
side — survivors 9.33 → 9.27 per colony, mean food 0.56 → 0.57, days of food in store 17.0 → 17.6,
buried 1.4 → 1.9 — a fix that cancels working settlers' jobs cost the colony nothing measurable, and
bought nothing measurable on the column it was aimed at.

The count going up is the finding, and it is about the column. `floorStarveHours` counts hours at
zero on the floor *including the hours when the entire colony is on the floor* — 49.3 of seed 1312's
92.6, on the probe. Nothing on the work board reaches a settlement with nobody conscious in it. The
column scores a wipe as a hauling failure, so it can never be tuned to zero, so it cannot tell the
next round anything.

So the instrument grew a third spell rather than the second being stretched, and the promise moved
onto it:

| column | at zero, and | what a fix could do |
|---|---|---|
| `starveHours` | on their feet | walk home sooner — still unmeasured, printed and unjudged |
| `floorStarveHours` | on the floor | nothing, if nobody is standing |
| `strandedStarveHours` | on the floor, **with somebody standing** | carry the meal over |

Same shape as [the wait column learning to tell a decision from a road](ARCHITECTURE.md#a-bar-derived-off-the-wrong-ring):
the promise was unreadable because its column mixed something the player can change with something
they cannot. The other two hours ride in the detail line on every verdict, passing ones included.

The re-run is a clean paired comparison, which is the one thing the previous grid could not be: no
`src/sim` file moved, so every colony lived the exact same sixty days and only the instrument
changed. Nine runs, same histories, both columns:

| run | on the floor | with hands free |
|---|---|---|
| settler/20260729 | 5.3 | 1.6 |
| settler/7 | 15.5 | 4.2 |
| settler/99001 | 21.6 | 6.6 |
| settler/424242 | 12.9 | 3.9 |
| harsh/20260729 | 58.4 | **10.5** |
| harsh/7 | 18.9 | 7.3 |
| harsh/1312 | 20.1 | 3.1 |
| harsh/99001 | 16.7 | 4.7 |
| harsh/424242 | 27.9 | 3.6 |
| **sum** | **197.3** | **45.5** |

**Three-quarters of the hours the old column counted were hours with nobody conscious to carry
anything.** The worst run in the grid drops from 58.4 h to 10.5 h; the promise still breaks on the
same nine runs, because the bar is one hour and every one of them clears it — but it now names a
quantity somebody could go and reduce instead of a quantity that includes the colony dying.

What is left in that 45.5 h is not yet split, and next round is where that happens: the pass fires at
0.14 food and the eval latches at 0.02, so some of it is a meal legitimately in transit — the probe
put that slice at 31.0 h of the pre-fix reading, the largest non-wipe one. A column that excluded
ticks with a `feedPatient` job already targeting the patient would name dispatch alone.

That also cost the `colony-eval` pin its run: harsh/424242 over twenty days no longer has a floor
spell at all, which is the pin doing its job — it failed the day the defect under it was fixed.
Re-pointed off `scripts/probe-starve-pin.ts`, which walks the short grid a unit test can afford and
prints all three columns per candidate.

### Verified

- `npx tsc --noEmit` — clean.
- Sixty-day grid, fingerprint `4952c293` → `2edb0102`, 39 colonies in 2218 s. **21 principles hold,
  8 break**, unchanged in membership from the round before — this round moved a number inside a
  broken principle rather than closing one.
- `tests/feeding.test.ts` — eight new tests. Seven gate assertions, one each so a failure names
  which gate moved, and one experience test: three settlers all mid-job, one on the floor at zero,
  nothing touched by the test, and the patient eats. That last one was run with the call to
  `sendSomebodyToFeed` commented out first — it fails with the patient still at 0.00, so it is
  load-bearing rather than decorative.
- `npm test` — **1852 tests green**, 13 skipped, 97 of 99 files, in 865 s. Run *after* the grid
  rather than beside it: last round's three timeouts were the grid stealing the machine, and on a
  quiet one the same three files finish in a quarter of the wall clock and pass.
- `npm run build` — clean, 920 kB bundle.

### Next

The settlers who are **on their feet** and starving. The grid reads 102.1 h in that column — better
than four days of somebody upright at zero food — and no principle fires on it at all, because the
one that watches food is now pointed at the floor. It is the same shape of gap this round started
from: a number the build prints and nobody judges.

One known softness to carry in with it: `upright` counts a **drafted** settler, and
`sendSomebodyToFeed` skips drafted settlers on purpose. On the fifteen sweep runs that is harmless —
`p.drafted = on` has exactly one writer, `orders.ts`, and nothing drafts anybody without a player or
a steward — but a managed run mid-raid can book an hour of "hands free" that no rule was ever going
to spend. Worth excluding when the column is next touched, not worth invalidating a finished grid
for.

---

## 2026-08-12 — Nobody starves beside a full pantry, and it took a duration to say who

**Track A: the instrument.** No game code changed — the client bundle comes out byte-identical.
`src/eval/**` changed, so the fingerprint moved and the sixty-day grid was re-run.

### The gap

`nobody-starves-beside-a-full-pantry` had reported `broken` on six of fifteen colonies for four
rounds, naming runs and no cause. Its own comment listed three live explanations — a downed settler
nobody carried a meal to, a recruit who joined starving, a hauling reservation holding the last
meal — and said honestly that it did not claim between them.

It could not. The check read `worstFood`, which is a **level**: how low did anybody get. A level
cannot tell a settler walking home from the far end of the valley, who bottoms out on the way and
eats on arrival, from one who is not going to be fed at all. Both read 0.00 and the detail line
could only ever say `hit 0.00 on 19 days of food`.

### The measurement

`scripts/probe-food.ts` — outside `src/sim` and `src/eval` so it does not move the fingerprint —
replays a named run and logs every unbroken spell at or below the starving line: how long, how much
of it on the floor, and whether the colony had food at the time. Every tick, not once a day: this
world's day boundary lands at 07:12 every time, so a daily sample of a hunger curve reads one fixed
phase of it, and forty minutes at zero looks exactly like a week at zero.

Two populations in the two runs it replayed, and they do not overlap:

| | length | on the floor | pantry stocked | ends in |
|---|---|---|---|---|
| walking home | 0.03–0.24 d | 0% | 100% | `eating` |
| on the floor | 0.39–1.05 d | 89–100% | 100% | getting up, or not |

Recruits are out: every settler who joined mid-run arrived at 0.45 food or better, so nobody walked
in already starving. The reservation theory is not needed either — the pantry was stocked for the
whole of every spell in both columns. What is left is the plain one. **Nothing in the sim carries
food to a downed settler.** They lie at zero next to weeks of meals until they get up or die.

> **Correction, one round later.** That last sentence is false and was never measured — the probe
> found the population, and I supplied the cause. `jobs.ts` has had `tryFeedPatient` and an
> emergency feeding lane the whole time. The round above measures which gate was shut. Everything
> else in this entry stands; the sentence is left in place with this note under it rather than
> quietly edited out.

### The change

Feeding is not fixed this round, deliberately. Fix it first and the principle still reads `broken`
— the walkers are still walking — and nothing in the grid shows the repair landing. So the round
buys the instrument that can see it, the way "the wait column learns to tell a decision from a
road" did two rounds ago.

- `starveHours` and `floorStarveHours` on every run: the longest unbroken spell at or below the
  line **on their feet**, and the longest **on the floor**. Disjoint by state, not nested — one is
  a walk to dinner, the other is a settler who is not getting one. Latched per tick inside the run
  loop, next to what upkeep already does.
- The check is `floorStarveHours >= 1 && endFoodDays >= 5`. The walkers are printed alongside
  rather than counted as failures, on every verdict — a number that only shows up on a failure is a
  number nobody tunes.
- `floorH` joins the grid table.

### The grid

- Fingerprint `4e7e7e91` → `4952c293`. 39 colonies, 3037 s.
- **Every pre-existing column is identical on all 15 sweep runs.** The new latches read the world
  and write nothing, and the grid says so rather than me.
- The one principle that moved is the one this round touched. All eight others return their
  previous verdict and detail line to the character.
- It moved in the direction I did not predict: six runs to **seven**. Every run the old check named
  did have a real unfed casualty, so on this grid the level was not over-firing — it was *missing*
  one. `settler/20260729` left a settler down and unfed for 6.7 h and never quite touched 0.00, and
  a bar drawn at the bottom of the scale read that colony as fine.
- And it put a number on the upright population for the first time: **26.3 h** at zero on their
  feet, against the under-six the probe's two runs showed. That is not a walk home. The check does
  not fire on it, on purpose — there is no measurement of what those settlers were doing, and the
  reason this principle spent four rounds saying nothing useful is that a bar once got drawn around
  a story instead of a reading. It is printed, in the open, waiting for a probe.

### Verified

- `npx tsc --noEmit` — clean.
- `npm test` — **96 of 98 files, 1843 tests green**, 13 skipped, in 2248 s (run alongside the grid,
  hence the wall clock). Three new: two on the principle's ability to tell the two columns apart,
  one on a named run that pins both columns nonzero and unequal — a new metric wired to nothing
  stays zero and passes every assertion about its shape.
- `npm run build` — 919.45 kB, **byte-identical bundle hash** to the round below. Nothing shipped
  to the player this round, and that is checkable rather than asserted.
- `npm run balance` — eight principles open, seven of them unchanged.

### Next

Carry food to a downed settler, with `floorStarveHours` as the number that has to fall.

---

## 2026-08-12 — One stride, and the four rates it was being fed at

**Track A: a measured fix.** In `src/sim/**`, so the fingerprint moved and the sixty-day grid was
re-run. The whole point of the re-run is that it should have changed nothing — see below.

### The gap

Found while checking the round below this one, which is the right way to find it and a bad look
for the round below this one. That round derived every rig's stride from `PHASE_PER_CELL = 7.5`
and stated that the sim advances `animPhase` by ground covered. Neither half survived reading the
sim.

`animPhase` had **four** writers converting distance into stride, at three rates, and two of them
stacked:

| where | what it added | per cell |
|---|---|---|
| `followPath` | `step * 7.5` — the step it *intended*, before collision refused any of it | 7.5 |
| a wolf chasing, a pet heeling, an animal browsing or courting | `speed * 9` **on top of** `followPath` | **16.5** |
| an animal walking home to its pen | nothing on top | 7.5 |
| an animal wandering | `hypot(dx, dy) * 9`, on the delta it asked for | 9 |
| a settler retreating from a threat, off-path | `step * 8` | 8 |

So a goat trotting to a berry bush ran its legs at **2.2×** the ground it covered — worse than the
settler defect the previous round spent itself on, on more bodies, and it was *introduced into the
render* by that round rather than found by it. The same animal walking home to its pen ran
correctly, because that one branch happened not to have the extra line. Two animals side by side,
one pathing and one strayed, disagreed with each other about how legs work.

And "after collision" was not true even for settlers. `followPath` charged the intended step, so a
free settler jammed against a wall kept striding for the twenty-five ticks it takes the stuck
counter to give up the path — the exact bug the previous round fixed in the possessed body while
claiming it was matching `followPath`.

### The fix

**One writer.** `moveWithCollision` advances the stride itself, by `hypot(moved) * PHASE_PER_CELL`,
and it is now the only place in the sim that touches `animPhase` by distance. Every walking thing
in the game already goes through that function — settler, wolf, pet, Picky, the body the player is
driving — so no caller has to remember, and the four call sites that used to remember are deleted.

- The advance is taken **before the unstick**, which can teleport a body up to six cells out of a
  wall raised on top of it. That is a rescue, not a step, and paying stride for it would spin a
  settler's legs the moment somebody finished a roof over their head.
- `PHASE_PER_CELL` is now **exported and imported**, and the mirror in `src/client/gait.ts` is
  gone. Last round justified the copy as sparing a grid re-run; that was the wrong saving, since
  the value it copied was one of four the sim was actually using.
- `fps/controller.ts` stopped advancing the phase by hand. It calls `moveWithCollision`, so it
  already had it.
- The flat per-tick advances in `jobs.ts` **stay**. A settler at a bench covers no ground and still
  has to move; that is a working cadence, a different quantity honestly sharing a field, and the
  renderer reads it under a different activity. A test pins that they are still flat rather than
  that they still exist.

### The grid

`animPhase` is never read by sim logic, so this edit cannot change what a colony does — which is a
claim, and the fingerprint is what turns it into a measurement. Sixty days, past founding, same
sweep as before.

- Fingerprint `4fc79614` → `4e7e7e91`. 39 colonies, 2470s.
- `steward` and `sweep` are **identical to the byte** against the pre-round baseline. Not one
  digit moved: same endings reached, same deaths, same stalls, same day counts.
- Which is the result the round wanted and the only one it would have accepted. Forty-one minutes
  to be told nothing happened is what the difference between *believing* a field is cosmetic and
  *knowing* it costs.

### Before / after

| | before | after |
|---|---|---|
| Rates converting distance to stride | **4 sites, 3 rates, 2 of them stacked** | 1 site, 1 rate |
| Animal pathing to food, a mate, or prey | 16.5 per cell — legs at **2.2×** the ground | 7.5, planted |
| Animal wandering | 9 per cell, on a delta collision had not agreed to | 7.5, on ground covered |
| Settler retreating from a threat | 8 per cell, on intent | 7.5, planted |
| Free settler jammed against a wall | strides on for ~25 ticks | stops with the body |
| `PHASE_PER_CELL` | one literal in the sim, one copy in the client, two other rates ignoring both | exported once, imported everywhere |

### Verified

- `npx tsc --noEmit` clean.
- `npm test` — 1840 passed, 13 skipped, 1184 s. Four new: two in `tests/sim-units.test.ts` that
  drive a body into a wall and assert the stride stops with it, and against the unstick that a
  body lifted out of a wall pays exactly zero; two in `tests/gait.test.ts` that scan every `.ts`
  under `src/sim` and fail if anywhere but `moveWithCollision` turns a distance into a stride.
- `npm run build` — 919.45 kB JS (263.12 kB gzip), 23.76 kB CSS (5.15 kB gzip). Five lines
  deleted and one added, so the bundle came back 0.16 kB smaller than the round before.
- `npm run balance` re-judged the identical grid and returned the identical eight open
  principles, which is what "identical to the byte" has to mean downstream to be worth saying.

### Next target

- **Look at it**, which was the last round's next target too and is now overdue by two rounds.
  Animals in particular: their legs just slowed by more than half, and no eye has been on that.
- The grid clock — sixty days reaches one ending of three — is still the player's call.

---

## 2026-08-12 — The body that kept walking after it had stopped

**Track B: L5 Motion.** Client only. `src/sim/**` is untouched, so the fingerprint keying
`.eval/measurements.json` is intact and the grid still stands.

> **Corrected by the round above it, the same day.** Two sentences below are wrong and they are
> left standing rather than quietly edited. *"the same arithmetic `followPath` does"* was not:
> `followPath` advanced the phase by the step it **intended**, not the ground it got, so a free
> settler jammed against a wall went on striding for up to twenty-five ticks while the possessed
> one correctly stopped. And *"neither of them scrubs"*, of the calf and its dam, was true only
> of the rate this round assumed — the sim was feeding animals at **9 per cell, and 16.5 when
> pathing**, so a wolf's legs came out of this round running at better than twice its ground.
> Both are fixed above; the wrong claims stay here because a round note that edits itself is
> not a record.

### The gap

Every body on the map animates off `Pawn.animPhase`, which the sim advances by the distance a
body *actually travelled after collision* — `followPath` adds `step * 7.5`. That half has always
been honest, and it is the half that makes one settler look the same from both cameras.

Nobody had checked the other half: what the renderer does with that distance. It did not use it.
A rig swung its legs about the hip by a fixed amplitude and the body translated on its own, so
the two agreed only by accident, and they did not agree. A settler's foot reaches
`0.74 · sin(0.62)` = **0.43 cells** either side of the hip, 0.86 across a step, while the body
covers `π / 7.5` = **0.42** over the same half-cycle. The planted foot slid backwards over the
ground by 0.44 cells per step — about the length of the step it had just taken. Eleven cells up
that is invisible. At eye level it is skating, and eye level is half of what this game is.

Two sharper ones turned up underneath it, both in the body the player is *guaranteed* to be
looking at:

- **The possessed settler did not use the sim's rule at all.** `controller.ts` added a flat
  `0.42` per tick — `0.62` running — and added it *after* `moveWithCollision`, on intent rather
  than on ground. Hold W against a wall and the body stood still while its legs sprinted, which
  the manager camera showed as a settler running on the spot. That is not a cosmetic gap, it is
  the one law: **one world, two cameras, never disagree.** The flat number also matched neither
  the walk speed nor the paving bonus, so a possessed settler and a free one on the same stone
  walked at different cadences.
- **The eye bobbed on a wall clock.** `bob += dt * 9`, gated on keys held, so the same wall left
  the view bobbing over a body that was not moving — at a rate that never changed between a walk
  and a run.

### The fix

`src/client/gait.ts`, pure and three.js-free, so it is testable under `environment: 'node'` — the
fourth module to earn that treatment after `pace`, `overlays` and `manifest`. It is one equation:
**a foot stays put when a full swing carries the body exactly as far as the foot reaches.**
`strideCells = 4 · leg · sin(swing)`, and `phaseScale = 2π / (stride · PHASE_PER_CELL)`.

- Both rigs convert distance into their own gait from their own legs. The settler's swing is
  **unchanged** — the amplitude was the readable part and was never the problem; the cadence was.
  So the walk looks the same and the legs run at half the speed, 7.4 steps a second down to 3.6.
- A calf gets a bigger scale than its dam out of the same formula — half the leg, twice the steps
  — and neither of them scrubs. That falls out; it was not written for.
- The possessed body advances its phase by `hypot(moved) * PHASE_PER_CELL`, measured after
  collision. It is now the same arithmetic `followPath` does, so the body you drive and the body
  walking beside it keep one gait.
- The eye bobs on the pawn's own phase, at the rig's amplitude and its two rises per cycle. It
  stops dead when the body is blocked and quickens into a run for nothing. `FpsController.bob`
  and `.moving` are both gone — the state that replaced them already belonged to the pawn.

`PHASE_PER_CELL` is **mirrored, not imported**. The literal is inline in `followPath`, and adding
an `export` to it would edit `src/sim/**`, change the fingerprint and spend a sixty-day grid
re-run to say exactly what the grid already says. A copy is only safe while something fails when
it drifts, so `tests/gait.test.ts` reads `movement.ts` as text and asserts the two still match.

Reading it cost one word elsewhere: `readFileSync` in `src/eval/node.d.ts` was declared as taking a
`string`, and the test hands it a `URL`. Widened to `string | URL`, which is what Node actually
accepts and what `existsSync` two lines below already said. That file is on the fingerprint's
`NOT_THE_SIM` list, so the grid is untouched by it.

### Left alone, deliberately

**The Picky.** Same defect, and it stays. Its legs already end below the floor — pivot 0.124 up,
leg 0.229 long — so there is no contact point to plant; its error is the opposite sign and a
quarter the size (0.09 cells against the settler's 0.44); and its body scale animates to near
zero as it poofs out, so a phase derived from its legs would spin them out while it vanished.

### Before / after

| | before | after |
|---|---|---|
| Settler foot scrub, per step | **0.441 cells** | **0** |
| Settler cadence at walking speed | 7.4 steps/s | 3.6 steps/s |
| Possessed body, phase per cell | 2.5 walking, 2.3 running, less again on paving | 7.5, whatever the ground |
| Possessed body held against a wall | legs sprint, body still | both stop |
| Eye bob | wall clock, gated on keys held | the body's own stride |

### Verified

- `npx tsc --noEmit` — clean, once the `URL` overload above was declared. It was not before: the
  round's first `npm run build` failed on that single line, which is the build gate earning its
  place on this list rather than rubber-stamping it.
- `tests/gait.test.ts` — **11 passed**, new.
- `tests/fps-view.test.ts` — **21 passed** (was 18).
- `npm test` — **1836 passed**, 13 skipped, 96 of 98 files, 850 s. Fourteen of those are new and
  the other 1822 are the ones that had to still be true.
- `npm run build` — exit 0. 919.61 kB JS (263.15 kB gzip), 23.76 kB CSS (5.15 kB gzip). The gait
  module cost **0.16 kB** shipped, and deleted two fields to do it.

**The honest caveat:** this is derived from the rig's geometry and pinned in cells, not looked at.
No browser has been attached this session, so *"it now reads as walking"* is still an inference —
a much better grounded one than the guess it replaces, but the eyes have not been on it. §9pp in
`ACCEPTANCE.md` is that step.

### Next target

- **Look at it.** The whole round argues from arithmetic. One pass at `:5062`, standing in a body
  and walking a settler past, would either confirm it or find the thing the numbers cannot say.
- The grid clock — whether to grow it past sixty days to chase the ship and berths endings — is
  still the player's call and still not a code change.

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
