# Architecture

One simulation, two views. That sentence is the whole design; everything below is how the
code keeps it true.

**The other four documents.** [README.md](README.md) is what the game *is* and why each
system earns its place; this file is how it is built. [PLAYTEST.md](PLAYTEST.md) is the
hands-on script, [ACCEPTANCE.md](ACCEPTANCE.md) is what has been checked and by whom, and
[ENDGAME.md](ENDGAME.md) is the plan for what comes after the founding.

## Contents

- [The source map](#the-source-map)
- [The dependency rule](#the-dependency-rule)
- [The loop](#the-loop)
- [What a tick costs](#what-a-tick-costs-and-how-to-find-out)
- [One scene, two cameras](#one-scene-two-cameras)
- [Collision equals geometry](#collision-equals-geometry)
- [Orders, jobs, and taking the wheel](#orders-jobs-and-taking-the-wheel)
- [The shape of a settler's day](#the-shape-of-a-settlers-day)
- [Where the walking goes](#where-the-walking-goes-and-the-two-levers-on-it)
- [A guard that is right about the wrong population](#a-guard-that-is-right-about-the-wrong-population)
- [The valley with nobody in it](#the-valley-with-nobody-in-it)
- [The seed contract](#the-seed-contract)
- [Difficulty multiplies after the draw](#difficulty-multiplies-after-the-draw-never-inside-it)
- [The balance grid, and why a promise needs an instrument](#the-balance-grid-and-why-a-promise-needs-an-instrument)
- [The only part of the storyteller that looks at the colony](#the-only-part-of-the-storyteller-that-looks-at-the-colony)
- [A ceiling is a ratio, not a constant](#a-ceiling-is-a-ratio-not-a-constant)
- [Grief is duration, not depth](#grief-is-duration-not-depth)
- [A floor is terrain, not a building](#a-floor-is-terrain-not-a-building)
- [A window and a history are different lists](#a-window-and-a-history-are-different-lists)
- [One flag cannot mean two endings](#one-flag-cannot-mean-two-endings)
- [A cable is not a footpath](#a-cable-is-not-a-footpath)
- [Save / load](#save--load)
- [Rendering notes](#rendering-notes)

## The source map

Seventy-three files in `sim/`, and the order below is roughly the order a colony meets them:
the ground, then the people, then the work, then the weather, then the things that come out
of the treeline.

```
src/
  main.ts              boot: canvas, quality preset, App
  sim/                 THE SIMULATION — plain data + pure-ish functions, no three.js
    types.ts           World, Pawn, Building, Job, constants (TICKS_PER_SECOND = 20)
    world.ts           construction, ids, message log, queries (hostiles, livingColonists)
    buildings.ts       the one table of building defs — `solid` here is the authority on collision
    worldgen.ts        192x192 map, starter cabin, trees/rock, the three settlers (HOME-anchored)
    pawn.ts            the one place a body comes into the world: settler, raider, beast, browser
    grid.ts            cell indexing, isSolid(), buildingAt(), nearestWalkable()
    path.ts            A* over the same grid, door cost 1.6
    movement.ts        moveWithCollision(), tickDoors()
    regions.ts         connected components of walkable ground: reachability without A*
    connectivity.ts    the watchdog: nobody gets walled in, and the colony says so out loud
    jobs.ts            job assignment + per-tick job execution (the biggest file, on purpose)
    queue.ts           the control stack: what a settler is doing, and what they do next
    tedium.ts          nobody wants to do the same job all day
    stranded.ts        work no living settler can reach, called off through the cancel door
    rebuild.ts         putting back what burned down or was shot to pieces
    needs.ts           food / rest / recreation / mood
    traits.ts          who a settler is: rolled from their own id, never from the world
    skills.ts          the one place a settler gets better at something, and says so
    knowhow.ts         what this colony can still make, and telling the player when that changes
    lifelog.ts         what happened to this one: six or eight lines for a whole life
    social.ts          who they get on with: one number per pair, feeding mood and grief
    partners.ts        who they come home to: earned from bonds, never rolled
    graves.ts          the dead: who is still lying out, burial, and what a body costs
    recreation.ts      where a settler spends an evening: quality, distance and company
    beauty.ts          what a room is worth to look at, and the mood that comes of it
    gear.ts            what a settler wears and what they carry: two slots, never more
    orders.ts          what the manager's clicks mean: blueprints, zones, designations, drafting
    interact.ts        what "E" means where you stand: describeTarget(), verbForBuilding()
    combat.ts          shooting, melee, projectiles, damage, downing, death, taking cover
    events.ts          the storyteller, raids, wildlife, fire spread
    encounters.ts      the beats that are not a raid: refugees, a dead grid, a herd passing
    difficulty.ts      how hard the valley bites: one table, three settings, three axes
    firesafety.ts      who runs from a fire and who gets carried out of one
    traps.ts           deadfalls: only hostiles spring one, and a sprung one is a blueprint
    clock.ts           time of day, daylight curve
    seasons.ts         the year: twenty days, five each, landing on the first morning of summer
    weather.ts         fronts that change decisions: rain, fog, storms
    snowpack.ts        snow that lies: one number for the whole map, arriving over hours
    ice.ts             the six days a year the lake is the fastest road on the map
    rooms.ts           the flood fill that turns four walls into a place, and how it seals
    temperature.ts     per-room air: the outdoor swing, coolers, heaters, campfires, lag
    fumes.ts           exhaust indoors: what a generator does to the air of the room it is in
    spoilage.ts        food goes off, slower where it is cold — the reason to build a larder
    farming.ts         growing zones: sow, ripen, harvest — the only renewable food
    berries.ts         bramblebushes: the only food the player does not have to earn twice
    fishing.ts         a stage on the shore, and food out of the water in a month with none
    forest.ts          the wood grows back: seed rain, crowding, and a clear yard
    floors.ts          laid ground: what a floor costs, where it may go, what it changes
    wildlife.ts        the herds: grazing, browsing, mating, ageing, and the resident wolves
    predators.ts       what a fenwolf does about all that — stalk, chase, bite, gorge, pack
    livestock.ts       pens: the animals you tamed instead of shooting, and their young
    husbandry.ts       what the herd pays for being kept alive: milk, down, and a clock
    pets.ts            the animal a settler keeps, rather than the one the colony eats
    crafting.ts        the recipe book: two gates, one on the colony and one on the person
    trade.ts           the pedlar who walks in, stands half a day, and swaps
    settlements.ts     the twelve neighbours off the map in three rings, and the caravan that walks to one
    commissions.ts     the neighbours ask for something back: one pack, on a clock
    prison.ts          what happens to a raider who goes down and does not die
    research.ts        the one axis that only goes forward: fifteen projects, 249,000 points
    scout.ts           the reason to leave the yard: ruins, caches, survivors
    explore.ts         what the colony has laid eyes on: one flag a cell, and it only goes up
    power.ts           networks by flood fill, generators, batteries, brownout shedding
    health.ts          illness: the severity-vs-immunity race, tending, bed rest
    alerts.ts          what is still wrong, derived fresh every frame and never stored
    idle.ts            why that settler is doing nothing, in one provable sentence
    pickies.ts         a question with legs: what you send to ask why nobody goes there
    objectives.ts      what to do next: the sticky curriculum behind the Goals panel
    victory.ts         the exam: five charters, the three days they hold, and no shutdown
    steward.ts         the colony's own foreman: restock, beds, fence, gate, grid, floors, cover
    tick.ts            stepWorld(): the one ordered tick
    save.ts            versioned envelope <-> localStorage
    transfer.ts        the same envelope as one line of text, so a colony can change origin
    rng.ts             seeded streams so a save reloads to the same future
  client/              THE VIEWS — three.js, DOM, input. Reads sim, never forks it.
    app.ts             fixed-timestep loop, mode switching, wiring
    pace.ts            how many ticks a frame owes: the accumulator, alone and testable
    devtools.ts        the console handles a developer needs and a player never sees
    input/input.ts     one keyboard/mouse listener set, shared by both modes
    input/touch-controls.ts  the same intents off a phone: sticks, taps, long-press
    manager/camera.ts  high-oblique camera, pan/zoom/orbit, screen<->cell picking
    manager/controller.ts  selection, drag-rectangles, tool state -> sim/orders
    fps/controller.ts  yaw/pitch, WASD -> moveWithCollision, E -> sim/interact, click -> combat
    render/            scene graph: terrain, instanced buildings, pawn rigs, sky, shroud,
                       landmarks, weather, decor, fx, palette
    ui/hud.ts          both HUDs (manager panels + first-person overlay) in one DOM tree
    ui/minimap.ts      the corner drawing of the valley, drawn from `world.seen`
    ui/toasts.ts       the things that must not scroll away in the log
    audio/sfx.ts       WebAudio, generated tones — no audio files
    audio/ambience.ts  the bed of sound under all of it, mixed by time of day and weather
  eval/                THE INSTRUMENT — headless colonies, played and scored (see below)
tests/                 1,585 tests: sim units, headless colony runs, and the first-person
                       controller driven with a stand-in Input
```

## The dependency rule

`sim/` does not import from `client/`. Not once — that is what makes the sim testable at
thousands of ticks per second in Node with no canvas, and it is what makes "two views" a
rendering question instead of a synchronization problem.

`client/` imports freely from `sim/`, calls its functions, and reads its data. It never
keeps a second copy of anything the sim owns. When the FPS controller moves your body it
calls the same `moveWithCollision()` a settler's job calls; when the manager places a wall
it calls `sim/orders.ts`, which appends a blueprint to `world.buildings`.

## The loop

`App.frame()` is driven by `requestAnimationFrame` and does two separate things:

1. **Advance the sim** in fixed 50 ms steps (`TICK_DT`), accumulator style. `speed` scales
   how much wall time feeds the accumulator: `0` (paused) feeds nothing, so a paused game
   takes *zero* ticks — the render loop keeps drawing, the world does not move. Catch-up is
   capped at `MAX_STEPS_PER_FRAME = 12`; past that the accumulator is dropped rather than
   letting a slow frame spiral.

   That arithmetic is `client/pace.ts` — eleven lines in their own module, importing nothing
   but the tick rate, because `app.ts` cannot be loaded outside a browser and "pause freezes
   the simulation" is a rule that has to be provable rather than asserted. `tests/pace.test.ts`
   holds it: 20 ticks per second of wall time at 60, 30, 144 and 47 fps, no drift over a
   simulated minute, zero ticks while paused, and paused time that is never banked.
2. **Render once** with `alpha = accumulator / TICK_DT`, so pawns and projectiles are drawn
   interpolated between their last two tick positions. Nothing rendered is ever written
   back into the sim — interpolation lives in `render/pawns.ts`, keyed by pawn id.

Speed lives in the manager. Entering a body clamps it to 1x (or paused): the manager is
where you fast-forward a day, the body is where you live in one.

### What a tick costs, and how to find out

A tick has 50 ms and spends about **0.8** of them — seed 99001 with the automated Steward
running, 24 000 ticks, measured on the development machine. `tests/colony-run.test.ts` holds
the ceiling at 2 ms, which is deliberately loose: it is a runaway alarm, not a target, and it
measures the machine as much as the code — the same run that clocks 0.8 ms solo can read 2.2
under five test files sharing the cores.

Profiling the sim needs a route around Vitest, which swallows `--cpu-prof`. Bundle an entry
point with the bundler already in `node_modules` and run it under plain Node:

```
./node_modules/.bin/rolldown bench.ts --format esm -o /tmp/bench.mjs
node --cpu-prof --cpu-prof-dir=/tmp/prof /tmp/bench.mjs
```

Read the `.cpuprofile` with any flamegraph tool, and read it knowing that **V8 charges an
inlined callee to the frame that inlined it**. A function with implausibly fat self-time is
usually a function that inlined something expensive, which is exactly how the one real
hotspot to date stayed hidden: `tickBushes` showed 84% self time and was in fact spending it
inside `roomAt`.

That was worth 37% of the whole sim. `roomAt` re-hashes every building in the colony on
every call to decide whether its cache is stale, and the bush loop called it once per bush
per tick — a hundred and fifty walks of the building list, twenty times a second, to be told
a number that could not vary, because a bramble is never indoors. The general rule the
episode leaves behind: **`roomAt` is not a lookup, it is a query.** Never call it per entity
per tick for a value that is the same for every entity outdoors.

## One scene, two cameras

There is a single `three.Scene` and a single `WorldView`. Switching views does not rebuild
it, does not reload, and does not touch the world — it swaps which camera renders and which
HUD layer is visible, in the same frame.

Camera layers keep each view honest:

- `LAYER_ALL` (0) — the world both views must agree on: terrain, buildings, pawns, fire.
- `LAYER_MANAGER` (1) — manager-only annotation: zone paint, the selection ring, the cell
  cursor. The FPS camera never enables this layer. Anything drawn here is by definition
  *not* part of the world — it is the manager's pen on top of it.
- `LAYER_FPS` (2) — held-item geometry that only makes sense from inside a head.

The possessed pawn's own body is moved to `LAYER_MANAGER` while you are inside it, so the
manager still sees the settler standing there and your first-person camera is not looking
at the inside of your own skull.

Blueprints are the one deliberate exception, and they are on `LAYER_ALL`: a blueprint is a
real entry in `world.buildings` that settlers path to and build, so it belongs in both
views. It is also the one thing you *can* walk through that you can see — `isSolid` returns
false until `built` — which is exactly why it is drawn as a translucent ghost rather than as
the wall it is going to be. The look is the tell.

## Collision equals geometry

`grid.isSolid(world, x, y)` is the only thing in the codebase that decides whether a body
may enter a cell. It reads `BUILDING_DEFS[kind].solid` for whatever building occupies it.
The pathfinder uses it, `moveWithCollision()` uses it for settlers, and the FPS controller
uses it for you — the controller never scans `world.buildings` itself, and
`tests/architecture.test.ts` fails if it starts. (`solid` is *read* in a few other places —
what counts as cover, what breaks a region, what the inspector prints — but none of those
can let a body through a wall.) The building meshes are instanced from the same
`world.buildings` array.

So there is exactly one way for a wall to exist and one way for it to stop something. No
ghost walls, no invisible ones. A door has `solid: false` and a path cost of 1.6, and
`tickDoors()` swings open any door with a pawn in its 3x3 — which is why doors open for you
by walking at them, with no interact key, exactly as they do for settlers.

`cellBuilding` uses `-1` for "nothing here", not `0`, because `0` is a valid building id.

## Orders, jobs, and taking the wheel

The manager never moves a pawn. It writes intent:

- A blueprint is a `Building` with `built: false`. The job system notices it needs material,
  queues hauling, then construction. Work types and per-settler priorities decide who.
- A right-click move order drafts the settler and gives them a move job.
- Drafting is a pawn flag; combat only fires for drafted pawns (and hostiles).

`assignJob()` runs for each idle pawn on a staggered interval, so 40 pawns never all
re-plan on the same tick. `tickJob()` advances one job by one stage per tick.

When you possess a settler, their job stays. If you press a movement key, the FPS controller
cancels the job and hands you the body — deliberately visible in the HUD, because a settler
who silently stopped working is a bug report. Leave the body and the manager's job system
picks them back up on the next assign interval.

### The shape of a settler's day

Bucket three days of a founding colony by `pawn.activity` and it reads, on seed 20260729:
**28 123 ticks walking against 4 730 working.** Six to one. A settler's day is a walk to a job,
a short burst of work, and a walk to the next one, and the colony's output is limited by the
legs rather than by the hands.

That number is load-bearing for any claim about work *rate*. `workRate()` — skill, morale,
traits, gear — only multiplies the burst, so a ±15% trait moves about ±2% of throughput, which
is well inside the swing between seeds. This is why `tests/traits.test.ts` measures **time at
the workface** rather than buildings finished: a hardworking crew clears the same board in a
quarter less time standing at it, which is the only thing the multiplier actually promises.

It is also a thing that *changed*, twice. The valley went from 96 cells square to 128 and then
to 192, and each time the walk got longer; several tests that had been quietly leaning on how
far a settler has to walk went red at once. Growing the map does not just invalidate the tick
budget — it invalidates every threshold, gate and expectation tuned against the old distances.

The second resize made that point in a way no test caught, because the thing it broke was not a
threshold in a test — it was a radius in the wildlife. A fed brambletail looks for a mate within
twenty cells. On a 128-cell moor holding a dozen browsers that circle covers about eight per cent
of the world; on a 192-cell moor it covers three, and the species quietly stopped breeding and
lived on the respawn trickle for a thousand simulated days with ninety per cent of its food
standing untouched. Every unit test still passed. See `tests/ecosystem.test.ts` — the general
lesson is that **a radius written against one map size is a hidden constant with the map size in
it**, and the fix is to make the search scale (`MATE_SEEK_RANGE`), not to inflate the radius,
because the radius is a fact about the animals and the search is a fact about the map.

### Where the walking goes, and the two levers on it

Bucket the same three days by the *job* the walking belongs to and it is not spread evenly.
Hauling is **more than half of it** — 7 896 ticks to the stockpile and 6 476 to blueprints out
of 28 280 — and hauling books no work ticks at all. It is the purest transit in the game, and
it is where the levers are:

- **An armful, not a handful** (`gatherArmful`). A hauler who has walked out to a felled tree
  sweeps up whatever else of the same kind is lying within two cells before setting off.
  Measured across three seeds, a settler standing on a pickup could take rather more than twice
  what they were sent for without moving: 12.0 in the arms and 15.6 more within reach.
- **A supply run, not a shuttle** (`frameNeed`, `SUPPLY_RADIUS`). A frame is fetched for by the
  exact amount it is short of, which turns a ten-segment wall into ten round trips to the same
  woodpile. Now the trip is sized for the whole run of frames beside it, and a settler still
  holding surplus walks it to the next frame instead of putting it down.

Together they moved seed 20260729's three-day output from **37 standing buildings to 66**, with
total walking down a fifth. The lesson generalises: on a map this size, a change that shortens
the walk is worth several that speed up the hands.

## A guard that is right about the wrong population

The food chain has two carrying capacities on purpose. Grazers answer to `populationCap`, which
reads off the *ground* — how much moor there is. Browsers answer to `browserCap`, which reads off
the *fruit*. A squirrel is a tenth the size of a mossback and nobody hunts it, so charging one
against the herd's budget would quietly delete a third of the deer on every map.

Two separate guards then quietly assumed the other one had it covered, and the result was a bug
worth keeping written down because neither guard was wrong on its own terms:

- The immigration hatch that repopulates a lost species tested for **extinction** — none left. But
  the state a played valley reaches is *one*, not zero: the browsers overshoot their fruit in the
  second week, starve back, and one survives. One cannot pair, so it cannot breed. The species is
  as finished as if it had gone, and the guard could see it standing there and called the matter
  settled.
- That hatch lived inside the arrival gate, which is `alive < populationCap` — and `alive`
  deliberately does not count browsers. On a map whose deer sit at their cap for weeks, the gate
  never opens, so the clause inside it never runs.

Measured over forty days on three seeds, every valley finished with 85–95% of its brambles ripe
and exactly one squirrel. The fix is `browsersCanBreed` — *is there a pair*, which reads a lone
animal, three males and a moor of kits all the same way — and a `stranded` term that opens the
gate on the fruit's ceiling rather than the ground's. Seed 20260729 now runs 11 → 8 at day ten →
5 → 5 → 8 at day forty, with the moor visibly grazed the whole way.

The generalisable part: **a population guard that asks "are any left" is asking the wrong
question.** The one that matters is whether what is left can replace itself. And when a subsystem
deliberately excludes something from a count, every gate built on that count inherits the
exclusion — including the ones added later for the thing that was excluded.

Note also what hid it: `tests/berries.test.ts`'s moor harness deletes every pawn that is not a
browser or a wolf, so its valleys have no deer, so the gate is always open. The harness was
simplifying away exactly the condition that caused the bug. `a species that cannot come back on
its own` keeps the herd for that reason.

## The valley with nobody in it

Every other harness in `src/eval` asks whether a *colony* survives. `src/eval/ecosystem.ts` asks
the question underneath it: does the moor survive on its own? It generates a world, lifts the
entire landing party out of it in one piece — settlers, buildings, items, zones, keeping the trees
because trees are terrain as far as the herds are concerned — and then runs `stepWorld` and
nothing else for as many days as you ask for, taking a census each night. `npm run eco` is a
thousand days of it. `tests/ecosystem.test.ts` is forty-five, which the suite can afford.

It is worth the file because two real bugs were invisible without it, and both of them looked
exactly like working code:

- **The browser tier was on respawn life support.** Covered above — a mate radius that had not
  been read next to the map size since the map changed.
- **The top of the food chain was not in the world.** `'fenwolf'` was spawned in exactly one
  place, `encounters.ts`, as a pack that walks at the colony and goes home afterwards. So a valley
  with no colony in it had no predation in it at all, ever, and a valley with one had predation
  only when the storyteller said so. Nothing asserted otherwise, because until there was a way to
  run the moor without a colony there was no way to notice. Wolves now live there: seeded by
  `spawnInitialFauna`, breeding off kills, starving without them, and capped by `wolfCap`.

`wolfCap` is worth a paragraph of its own, because the first two versions of it were wrong in
instructive ways. Counting prey *heads* makes a three-meat squirrel worth as much as a
thirty-four-meat mossback, so the ceiling tracked the noisiest term in the whole system and rose
and fell with squirrel booms; wolves bred into a boom and starved out of the crash. Weighting by
meat fixed the ceiling but not the deaths, and instrumenting each wolf showed why: they *were*
eating, about every two and a half days on average, against a four-day starvation limit. The mean
was comfortable and the tail was fatal — the unlucky quarter died every fortnight, and no birth
rate at a ceiling of five can cover that. **Never size a grace period against the mean.** Six days
holds. And because a predator at a ceiling of five can still lose its last pair to bad luck,
`strandedWolves` opens the same immigration hatch the browsers have, on the strictest terms in the
file: no breeding pair left *and* the prey would carry another.

What the harness pins is a shape, not a number. A thousand days at 192² holds mossbacks near 30,
dunhares near 24, wolves between two and five, and brambletails swinging 3 ↔ 34 in real
boom-and-bust as they strip the hedges and let them recover — with the moor's ripe fraction
swinging 10% ↔ 92% behind them. That oscillation is the system working. Thresholds in the test
are wide on purpose for exactly that reason: a band tight enough to catch a drift would be a band
that fails on a dice roll.

## The seed contract

`createWorld(seed)` spends **one shared `Rng` in a fixed order**, and every existing seed in the
game — the ones in tests, the ones players have bookmarked — is that exact order. A roll inserted
anywhere in the middle shifts every decision after it: terrain, trees, sites, and, because a
settler's traits are rolled from their own pawn id, the character of the colony itself. Two
balance tests have flipped on nothing worse than a building added a few lines too early.

So the rule for anything new in worldgen is: **take a derived stream, never the main one.**
`new Rng(seed ^ <a fresh constant>)` — the lake, the bramble scatter and the initial fauna each
have their own, and none of them cost the shared stream a single roll. Order between derived
streams doesn't matter; separate streams don't interleave. `tests/hunting.test.ts` pins
`createWorld(20260729).rng.main` to a literal, which is the alarm that catches a breach.

## Difficulty multiplies after the draw, never inside it

`sim/difficulty.ts` is a table of seven multipliers and one accessor. Two rules make it safe to
have added at all.

**Every multiplier on `settler` is exactly 1, and every call site applies it after it rolls.**
That is what keeps the default run bit-for-bit the run it was before the setting existed, which
matters because the eval sweeps, the survival harness, the thousand-day ecosystem run and the
seed contract above are all measurements *of that run*. `rng.chance(Math.min(0.6, base) * bite)`
rather than `rng.chance(Math.min(0.85, base * bite))`: the second reads plausibly, is identical
at `bite = 1` for the first six steps, and diverges at the seventh. A multiplier that changes how
many values a beat draws — not what it does with them — turns three tunings of one story into
three different stories, and no seed means anything across them.

**Three axes, each with exactly one call site.** The table used to have one axis and a charter
saying it would never have another: threat only, not hunger, not stores, because a kind difficulty
that quietly fed the colony would make the balance untestable and leave the player unable to tell
which of two gifts they had been given. That charter was half right. What was missing was not
restraint but an instrument, and the grid below is the instrument, so the charter is now that each
axis is declared, separately measured, and reads off a different column:

| axis | fields | where it lands |
| --- | --- | --- |
| treeline | `respite`, `band`, `bite`, `tech`, `grace` | `events.ts` — when they come, how many, how hard they hit, what they carry |
| larder | `larder` | `worldgen.ts`, day-one stores only |
| upkeep | `upkeep` | `needs.ts` — how fast food, rest and recreation drain |

`tech` scales the rifle chance rather than the band, so a harder setting is answered with better
guns and not only more bodies; it multiplies the probability the same `rng.chance` call already
drew, which is what keeps it inside the after-the-draw rule. `larder` scales what the last lot
left in the stockpile and nothing about the map — the ore, the woods, the water and the three
settlers are identical on all three settings, so a seed is still a place. It rounds up and floors
at one, so the first bandage exists even on harsh, because the first raid is a tutorial and it has
to be able to teach what it costs. `upkeep` is the tightness dial: it does not add work, it
shortens the gap between meals, so the same colony needs closer management rather than a different
plan.

The reason the boundary is drawn there rather than anywhere else: `larder` moves a number the
player can read on the setup card before they choose, and `upkeep` moves a rate they will feel
within a day. Neither is a hidden thumb on the scale. What is still forbidden is the invisible
kind — a setting that quietly changed crop yield, wound severity or learning rate would be
unmeasurable and unfair in the same breath.

Persistence is free: the save is the whole `World` as JSON, so `world.difficulty?: Difficulty`
carries with no `SAVE_VERSION` bump, and absent reads as `settler` — which is both what every
pre-setting save meant and what every test world means.

## The balance grid, and why a promise needs an instrument

Everything above is a claim. "Trouble comes about half as often, in smaller bands, and hits
softer" is printed on the setup card the player reads before they choose, and until something
measured it, it was decoration: the four multipliers could have been transposed, or a later
change could have quietly flattened them, and the only signal would have been a player who felt
the setting did nothing. `src/eval/sweep.ts` plays every seed on every setting; `src/eval/
principles.ts` writes the promises down as checks; `npm run measure` runs the first and
`npm run balance` scores the second against what it wrote down.

The unit is deliberately the *grid* and not the run. A difficulty setting is a claim about a
distribution — one map where Hard country happened to stay quiet is not a broken promise, and a
check that called it one would be switched off inside a week — so every principle compares means
across five seeds rather than pairs of runs, and the seeds are the five the survival sweep
already uses because three of the balance surprises found so far showed up on exactly one of them.

Every axis is read off its own column, and the column is chosen to be the one the axis cannot
reach by accident. `tech` is judged on the *share* of raiders carrying a rifle rather than the
count, because a setting that sends more bodies would raise the count without arming anybody, and
the share is pooled across runs rather than averaged over them so a quiet map that saw four
raiders does not weigh as much as a bloody one that saw sixty. `larder` is judged at genesis and
then deliberately not again, since after one day it is inseparable from labour.

`upkeep` cost six instruments and does not have a column, and that is the most useful thing the
harness has found. The obvious one is how well fed the colony is on an ordinary day, and on a
twelve-day grid it looked right: 0.60 → 0.57 → 0.54. On an eight-day grid the same column read
0.608 → 0.556 → **0.571** and Hard country came out better fed than Settler. Average fullness is
damped by the behaviour it is measuring — a settler eats when hungry and stops when full, so a
faster drain buys more trips to the table at about the same average — and it is confounded by
`larder`, because a fuller store is easier to stay fed from. It had been passing on noise. What
upkeep actually costs is *time*: the share of a free settler's day spent eating, sleeping or
relaxing instead of working, counted in pawn-ticks at 20 Hz. On the thirty-day grid that column read
30.7 % → 34.7 % → 36.1 %.

That last step is 1.4 points, and the check asks for one. It passed — and it was still not a
measurement anybody should enforce on, because the margin is thinner than the noise. Take the same
grid, the same code and the same thirty days, and read only the three seeds the arm happens to use:
Settler 35/34/35, Hard 35/35/35, a step of **+0.3**, comfortably broken. Five seeds said +1.4 and
passed. Which verdict this column returns is decided by the seed draw — and the sixty-day grid
proved the point from the other direction, where the same column reads 30.0 % → 33.3 % → 36.0 % and
that last step is now 2.7. The column did not get more honest; it got a different draw.

The dial is not the problem. Held alone — Settler played three times over with nothing moved but
`upkeep` — the column reads 30.8 % → 35.1 % → 36.6 %, and on the thirty-day arm it read 30.9 % →
34.6 % → 37.3 % with a separate probe carrying it to ×1.30 for 40.5 %: dead straight both times,
with headroom past anything the game ships. The
confound costs roughly half the effect. `larder` and `band` write into the same column, harder and
in the opposite direction, because a colony that is starving and fighting spends *less* of its day
on itself, not more — it has less to eat and less time to eat it in. Nearly three points of upkeep
travelling with five points of hunger and siege arrives as one and a half, which is close enough to
the floor that the answer depends on the weather.

So this axis gets an experiment rather than an observation. The grid carries a second kind of run
— an *arm* — which swaps the one multiplier in the difficulty table, holds seeds, days, threat and
stores still, and plays Settler at each setting's value: an A/B on a deterministic sim, which is a
thing a game can do and a field study cannot. The general rule it taught: **an observational grid can only verify an axis that is the
loudest thing in the column it is read from.** `tech` owns the rifle share and `band` owns the band
size, so those are readable off the grid. `upkeep` is quiet and keeps loud company, so it is not,
and no better column was ever going to fix that — the temptation to keep trying instruments until
one of them separates is precisely the failure this harness exists to prevent. Two related
measurements were made and thrown away for exactly that reason, and the reasoning is kept in the
comment above the check rather than in this paragraph.

The arm has one trap in it and it fired on the first run. The values it plays are read out of the
same table it writes into, so a loop that looked up its next dial mid-sweep read back what it had
written on the previous pass — it played calm twice, never played the ×1 baseline, and reported two
identical points, and the check correctly called an axis broken that was fine. Forty-four minutes of
grid to find a bug in the instrument. `UPKEEP_DIALS` is therefore snapshotted at module load, and
`tests/balance-principles.test.ts` asserts in a millisecond that it is three distinct ascending
values. The transferable half: **when a harness verifies something by mutating global state, the
list of what to try has to be captured before the first mutation** — and the check being right about
a number it was fed wrong is exactly why the grid prints its evidence next to its verdict.

One more thing fell out of measuring it directly: what a tighter setting actually squeezes is
**recreation**, not meals. Eating rises monotonically and barely — 1.30 % → 1.47 % → 1.60 % of the
day — and the whole rest of the movement is sleep and relaxation. Settlers on Hard country are not
eating more; they are being denied their downtime by time pressure.

Downed *and drafted* settlers are excluded from both halves of the ratio, and for one reason rather
than two: `takeJob` skips both outright, so each is a guaranteed zero on top of the fraction and a
guaranteed one underneath. Leaving either in lets `bite`, `band` and `respite` push the upkeep
column *down* on the setting that raids hardest.

Four things about it are load-bearing:

**Three checks are not gated, because they are what every other number is denominated in.** That
Settler is bit-for-bit the game as it was written is asserted by running the same seed with the
setting asked for and not asked for and comparing every snapshot and every incident — not by
trusting a default argument, because the seven multipliers are read in seven places at four
different times and this is the only thing that checks all of them multiply by one all the way
through a run. That difficulty changes what the last lot left behind and never the valley itself
is asserted at genesis, before a single tick, by generating all three worlds from one seed and
comparing the terrain, the sites and the settlers by name. And that `larder` actually moves —
calm above Settler and harsh below it, on every resource rather than just on food — is asserted
in the same breath, because a dial that reads well on the setup card and moves nothing is the
exact failure this harness exists to catch. All three happen at tick zero: after one raid the
three colonies have spent different amounts and no comparison between them means anything.

**A check can answer `untested`, and `untested` is not a pass.** The escalation ladder is built to
start *after* the eval window closes — three clean fights lands past day twelve, and that constant
is three for exactly that reason — so a ten-day grid asking whether the ladder reaches its top
rung is measuring the harness rather than the game. It says so instead of failing, and it says so
instead of passing. Same for the funerals question, which the long probes did not see move until
the back half of a hundred-day run. Thirty days was the shortest grid that could see any of it, and
the default is sixty now for a different reason: at thirty days most of the calm and settler
colonies closed their charter before the clock ran out, so the grid was measuring a three-week game
on exactly the maps that did best. Sixty days with `playPastFounding` set is the shortest grid where
every run is the same length as every other one.

**A principle is `enforced` or `open`, and the open ones are printed, not asserted.** Two questions
the grid was built to settle are genuinely unsettled — whether the ladder's top rungs should be
made reachable or the ladder shortened, and whether the valley should ever bury somebody — and
each has a test in `tests/balance.test.ts` on the other side of it. Asserting an unsettled
question just teaches everyone to ignore a red suite. Every run of the grid ends by printing
everything it could not settle, so that list lives on disk rather than in someone's head.

**The checks are tested against grids made of numbers, because the first grid failed on a check
that was wrong.** `tests/balance-principles.test.ts` hands `judgePrinciples` hand-written sweeps —
settings ordered backwards, settings too close together to feel, a grid too short to have reached
the ladder — and asserts the verdict for each. It runs in a third of a second against the
ten minutes the real grid costs to play, and it earned its place immediately: it found that
"Hard country is a different game" was checking `harsh > settler`, which would have signed off on
harsh costing 8 where Settler cost 7. That is the same game with worse luck, and the check now
asks for half again as expensive.

### Measured once, judged in milliseconds

The grid is expensive and the checks are not. Playing twenty-four colonies costs tens of minutes;
scoring the result costs nine milliseconds. For as long as those two lived inside one command the
whole cost was paid by anybody who wanted the cheap half — fix a threshold in a check, wait half an
hour to see whether the fix was right — and a feedback loop with that shape gets run less often
until it stops being run at all. So `npm run measure` plays the grid and writes `Sweep` to
`.eval/measurements.json`, and `npm run balance` reads that file and judges it. The slow half runs
when someone asks for it; the fast half runs in the test suite.

That split was only available because a sweep turned out to be pure JSON. `Sweep` used to carry the
full `EvalReport` of every run — every snapshot, every incident — and a grep for its consumers found
none: the reports were built, returned, and dropped. Had anything actually read them, the on-disk
file would have been tens of megabytes of day-by-day telemetry and this would have had to be a
different, worse design. The field was deleted, and what is left is small enough to read.

**The only permitted speed-up is doing the same work at once.** The tempting optimisations are all
in the sim — fewer ticks a day, coarser pathing, skip the hauling — and every one of them makes the
grid faster by making it measure a different game, which is the one thing an instrument may never
do. So the colonies are spread across worker threads and each one plays exactly the ticks it always
played. Determinism survives because `runColony` is pure in `(seed, days, difficulty, steward)` and
each worker holds its own module registry, and therefore its own copy of the difficulty table — the
arm's mutation of that table cannot reach a sibling, which is the property that makes an experiment
safe to run next to an observation. Results are placed into the grid by index rather than by arrival,
because a grid whose rows reordered themselves depending on how busy the machine was would be a grid
nobody could diff against yesterday's.

**The split invents exactly one new way to be wrong: judging old numbers against new code.** A
`Sweep` on disk looks equally authoritative whether it was written a minute ago or a month ago, and
a stale one would report the balance of a sim that no longer exists — in the confident voice of a
measurement. So the measurements carry a fingerprint: a hash over every `.ts` file in `src/sim` and
`src/eval`, taken *before* the first colony is played, re-taken after the last one, and refused
rather than saved if the two disagree. Taken at the end instead, an edit made during the wait would
be recorded as the source the numbers came from, which is precisely the lie the guard exists to
prevent — and a long grid makes editing during the wait the obvious thing to do. The judge
recomputes the same hash and refuses to score on a mismatch, so both ends are closed.

Two details of that guard are load-bearing and were nearly built backwards. The list of files that
do not count — the pool, the CLI, the on-disk format — is an *exclusion* list, so a new sim file
invalidates old measurements by default; an inclusion list would have meant new code silently not
counting, which fails in the direction that looks like everything is fine. And the hash is over
source text rather than meaning, so it fires on changes that cannot possibly move a number. The
first thing it ever caught was a dead-code deletion; the second was a batch of comment edits made
while writing this document. That is the conservative direction and the correct one: the cost of a
false alarm is ten minutes of re-measuring, and the cost of a missed one is a balance decision made
against a game nobody played.

Deleting that dead code was itself the point. `runSweep` and `runUpkeepArm` had no callers left once
the grid was described by `sweepSpecs`, played by `runSpec` and folded by `assembleSweep`, and the
argument for keeping them — "the serial reference implementation" — is exactly wrong: a second
definition of the grid that nothing compares against the first is not a reference, it is a fork
waiting to drift. There is one definition now. `npm run measure -- --serial` plays the same specs
through the same `runSpec` in one process, so if a parallel grid and a serial one ever disagree the
argument is settled by running both rather than by reading the pool.

What it bought: twenty-four colonies — 1,000 colony-days on the current sixty-day grid — in **1,556
seconds** on eight workers of a ten-core box, against several hours for the same grid played one at
a time. Do not call it a benchmark: the numbers were taken on a machine doing other work, and eight
workers buy something like three and a half times rather than eight for two reasons worth knowing.
The colonies are wildly uneven — a calm map with fourteen threats in sixty days is a fraction of the
work of a harsh one with forty-two, and the harsh colonies are also the ones that grow biggest — so
the run ends when the *longest* colony ends, and twenty-four specs across eight workers is three
waves deep with a ragged edge on each. The fix for that is to start the long ones first, and it is
not worth doing until the grid is long enough that the tail is the cost. The
determinism claim was checked twice over: `tests/eval-pool.test.ts` plays a mixed list of grid and
arm specs through two workers and asserts the results are identical to playing them one at a time,
and two independent parallel runs of the full grid, scheduled differently by a differently-loaded
machine, produced the same numbers row for row.

### What the grid found

Sixty days, five seeds, three settings, seven multipliers, every run played past its founding.
Thirteen principles are scored; ten of them are enforced and hold on measured evidence — trouble
comes sooner (day 5.0 → 3.0 → 2.0), more often (14.8 → 29.2 → 41.8 threats), in bigger bands (4.4 →
6.8 → 8.0), better armed (31 % → 60 % → 84 % of raiders carrying a rifle), hitting harder (2.4 →
27.6 → 109.4 trips to a sick bed), nobody is wiped on the quiet valley, Hard country costs a colony
×4.0 what Settler does, and the founding is no longer where the run stops: nine of the fifteen
colonies closed their charter and every one of them played out the rest of its sixty days. The
other three are open — findings the grid prints without asserting, because the fix is a design
decision rather than a number. One of those three holds anyway: four of the five Hard maps buried
somebody, which is the check that a colony sim where nobody ever dies is a screensaver. The other
two are below. Four things the grid found are worth writing down, because none of them was
designed:

**Difficulty reaches the pantry, and it gets there mostly through labour.** All three settings start
on stores the genesis check has already pinned, and after sixty days calm ends with 24.5 days of
food where harsh has 13.6. Only part of that is the `larder` dial handing harsh less; the rest is
that a settler who is shooting or on the floor is not farming. The enforced check is therefore a
ratio rather than a floor: threat multiplies ×2.82 across the settings while food in store moves
×1.80, and the promise is that the second number stays under the first. Watch the gap rather than
either number — before the direct `larder` dial existed the same comparison read ×3.3 against ×1.5,
and it is the *distance* between the two that says difficulty is still a valley rather than a
handicap.

**The upkeep axis is real, and the grid column measuring it is not the axis.** A free settler's day
runs 30.0 % → 33.3 % → 36.0 % across the grid; held alone in the controlled arm, with threat and
stores and seeds all pinned, the same three dials read 30.8 % → 35.1 % → 36.6 %. Both are monotone
and the two disagree about where the *step* is — the grid puts 3.3 points between calm and settler
where the arm puts 4.3, and 2.7 points between settler and hard where the arm puts 1.5. That is
`larder` and `band` writing the same column from the other side, and on the thirty-day grid the
discrepancy pointed the other way, which is the whole argument for not enforcing on the column. The
enforced promise reads off the arm; the long version is four paragraphs up.

**Six of fifteen runs had a settler starve beside a stocked larder.** Seed 1312 on the quiet valley
put a settler at 0.02 food with 19 days of meals in store; seed 424242 on Settler hit 0.00 with 16
days in store. That is a feeding or hauling failure and it has nothing to do with difficulty — it
happens on all three settings, which is exactly why it is not hung on a difficulty principle. The
first version of that check asserted "nobody starves on calm or settler", broke on five runs, and
named difficulty as the culprit for a bug in the food economy. Worse, by exempting harsh it hid four
more instances. It is now an open finding that prints the runs and does not claim the cause. Sixty
days did not move it: the same six-in-fifteen rate came back on the longer grid.

**The top of the escalation ladder is content nobody has ever been shown.** The highest rung reached
anywhere on the grid is 3 of 4, on one calm map, and harsh reads rung **0** on all five maps for all
sixty days — a flat zero on the setting whose entire promise is escalation. The ladder is fed by
`unbloodied`, a streak of fights that end with nobody on the grass, and Hard country cannot hold
that streak for a moment: it is knocked back to zero by the very casualties that make it hard. So
the rungs are reachable in principle and, exactly where they are supposed to matter, unreachable in
practice. Doubling the grid to sixty days made this *worse*, not better, which is the useful part —
more time is not the missing ingredient. This is open rather than enforced because the fix is a
design choice — shorten the ladder, or feed it something other than a streak the hard setting is
built to break — and the grid's job was to find it, not to make it.

## The only part of the storyteller that looks at the colony

`events.ts` counts beats. The band size is a function of beats fired, the raider stat line is a
function of beats fired, and the pacing between them is a function of the difficulty setting —
none of which has ever read a single thing about the colony it is aimed at. That is a good
default and a bad ceiling: both curves stop moving at beat ten, and the back half of a long game
is the front half again. Measured over a hundred days on seed 20260729, fifty beats cost the
colony three trips to a sick bed and no funerals at all.

`storyteller.unbloodied` is the exception, and it is kept deliberately small: one counter, up by
one when a fight ends with nobody on the grass, back to zero when one does not. `escalation()`
turns it into a number from zero to four, and exactly two expressions consume it — the band
ceiling and the raider stat step — but not at the same rate. The band takes the whole rung and
the stat step takes half of it, because the stat step is upstream of hp, aim and rifle odds
alike, and a rung that moved all four at once was a cliff rather than a curve: seed 99001
earned rung two by never losing anybody, and spent the six days after it with six of its ten
settlers down and its kitchen cold.

Three details worth keeping:

- **The fight boundary is detected in one place.** Three call sites set `raidActive`; none of
  them knows the streak exists. `tickStoryteller` notices the flag is up with no mark set, and
  that is the start of a fight; it notices the flag is up with nothing hostile standing, and that
  is the end of one. A fourth thing that starts a fight gets the accounting for free.
- **Downs are latched, deaths are differenced.** A settler patched up before the shooting stops
  still broke the streak, so `raidHurt` is set on the tick it happens rather than sampled at the
  end. A settler killed outright never passes through `downed` at all, so deaths are read off
  `stats.colonistsLost` against a mark taken when the fight began. Either term alone misses one
  of the two, and the one it misses is the one that matters more.
- **The ladder starts after the eval sweep.** Three clean fights lands somewhere past day twelve;
  the harness runs eight days. That is not a coincidence, it is the reason the constant is three.
  The sweep measures whether a colony can get on its feet, and a difficulty curve that moved
  inside its window would quietly have been measuring the curve instead.

The scaling input is a streak rather than a wealth score on purpose, and that is a design
constraint rather than an implementation one: scaling on what the colony owns punishes the player
for building what the game taught them to build, and every player who works that out starts
playing poor. A streak can only be shortened by taking casualties.

## A ceiling is a ratio, not a constant

The same sixty days that dated the pairing threshold turned up a worse problem underneath it. Every
bond in `sim/social.ts` was pinned at the cap of 100 by the end of the first week, on every seed, and
the labels `friendly` / `friend` / `inseparable` had collapsed into one word.

The cause is a ratio nobody had computed. `tickSocial` runs every 30 ticks — 160 times a game day —
and a pair within talking range gain roughly 0.7 each time, so two settlers who share a room gain
about **112 points a day** against a decay worth about **8**. The decay's doc comment claimed it was
what kept the colony off the ceiling. It was outnumbered fourteen to one.

The fix is the *shape*, not the constants: movement away from neutral is scaled by `(1 − |bond|/100)²`,
so the equilibrium a pair reach is set by how much of the day they actually spend together — around
forty for two settlers who pass in the yard, around seventy for two who share every meal. Raising the
decay or cutting `CHAT_HIGH` would only have moved the single ceiling everyone still arrived at.
Damping is deliberately one-directional; falling out is undamped, because it is *becoming* somebody's
closest friend that should be hard.

**Any bounded quantity with a gain rate and a decay rate has an equilibrium, and it is theirs alone —
`gain × frequency ÷ decay`. If nobody has computed it, every threshold defined against that quantity
is decoration.** Both this and the section below were found the same way: by running the game and
reading the number, rather than by reasoning about the constants.

Fixing the shape then invalidated every number defined against the old one, and that is the part worth
remembering: **changing a scale is not done until you have re-measured everything that reads it.** Ninety
days of three colonies were run again afterwards and the best bond any pair ever reached was 74, 80 and
74 — against a pairing threshold of 80, so the number of couples formed was zero on all three seeds. The
fix had quietly deleted the entire partner system, and nothing failed: every test in `tests/partners.test.ts`
sets its own bonds, so all 29 stayed green while the feature became unreachable in play. A test that
constructs the state it asserts on cannot tell you whether the game ever produces that state.
`PAIR_BOND` is now 70, read off the measured band the top bonds actually settle into.

## Grief is duration, not depth

`sim/partners.ts` pairs two settlers when their bond crosses 70 — the same line the inspector calls
`inseparable`, so the precondition is a word the player can already read — **and stays there for ten
days**. Nothing in the file rolls, which is what keeps it out of the story stream and off the seed
contract.

The ten days were not in the first version, and the way they got there is the more useful half of
this section. The threshold was chosen from arithmetic — bonds decay about eight percent a day, so 80
looked like months of two people seeking each other out — and the comment in the file said exactly
that. Then sixty days of an ordinary colony were actually run and the bonds read off the end: the top
four were **pinned at the cap of 100**, and the first pair formed on **day 12**, with four pairings
among seven settlers. Two people who share a table every evening saturate a bond in under a
fortnight, because the daily gain from sitting together beats the decay several times over. The
threshold was never the hard part; the comment was describing a game nobody was playing.

The fix is a clock rather than a bigger number, and the distinction matters: raising the line to 95
would have bought a few days and then saturated too, because **a threshold measures a peak and the
peak was cheap**. `World.courting` stamps the tick a free pair first crosses the line, and the
pairing waits ten days on the far side. That is a choice being made repeatedly instead of one good
fortnight — which is what the feature always claimed to be about.

The general lesson, and it is not about partnerships: **a threshold on an accumulating quantity is a
claim about time, and the only way to know what it claims is to run the thing and read the number.**

The clock cancelled on *any* dip below the line for exactly one day, and the correction is the third
lesson in this section. Once the social falloff landed and `PAIR_BOND` came down to 70, the line sat
inside the band the top bonds actually occupy — and those bonds wander about ten points over a month.
So the clock was being reset by the ordinary weather of the number it was watching: three ninety-day
colonies produced one pairing between them, and two of the three ended the run with pairs sitting on
71 and 73 whose clock had never survived ten consecutive days. **A latch on a noisy signal needs two
lines, not one.** `COURT_KEEP` is eight points under `PAIR_BOND`: crossing 70 starts the clock, only
falling to 62 stops it, and the announcement still requires the bond to be at or above 70 on the day
it lands — held long enough *and* close today. `fishing.ts` shuts and reopens the lake the same way,
for the same reason.

The first version made the loss of a partner a bigger spike: `WIDOW_GRIEF` on top of the bond
scaling `grieve` already applied. It does not work, and the reason is worth writing down. `moodOffset`
is clamped at ±0.3 and decays at a flat rate, so a settler who buried a close friend and a settler
who buried their partner both land on the ceiling and both climb out of it the same afternoon.
Multiplying harder changes nothing — the clamp eats it. **Any mood event large enough to matter is
already at the ceiling, so the ceiling is where the differences between events stop existing.**

So the difference lives in `MOURN_MOOD`, a small standing term that expires after six days, carried
in the *same field* that paid them for having somebody — `partnerMood`, positive while that person
is alive, negative for the week after they are not. One slot for one fact about the settler, one
row in the mood breakdown that reads "their partner" or "grieving" off the sign. A grieving settler
breaks a little sooner all week, which is what the loss should cost and what a spike can never say.

Dependencies run the same way `social.ts` does and for the same reason: `needs.ts` imports
`partners.ts`, never the reverse. `tickPartners` runs after `tickSocial` (a pairing should follow
from the day the colony just had) and prices mood *last* within its own pass, so the tick that pairs
two settlers is the tick they feel it.

## A floor is terrain, not a building

`sim/floors.ts` is small because the decision it encodes does the work. A cell holds at most
one building, so floorboards under a bed would have to be a second one — and terrain already
saves, loads, renders, paths, grows crops and carries fire. Making a laid floor a *terrain
kind* meant the feature landed as one new entry in `TERRAIN_LIST`, one movement multiplier,
one A\* discount and one line in the fire-spread rule, instead of a parallel layer under the
building grid.

`TERRAIN_LIST` is the contract: terrain is saved as an index into it, so entries may be
appended and never reordered or removed. The price of the decision is that a floor cannot be
lifted back to the exact ground it covered — laying a different one over the top is how the
player changes their mind.

## A window and a history are different lists

`world.messages` holds the last eighty lines and drops the rest. That is right for what it is — the
corner panel answers "what is the crew doing this minute", and a work log that never forgets is a
work log nobody reads. It was also, for most of this project's life, the only record the game kept of
anything, which meant a settler could die in the spring and by midsummer there was nowhere left in
the software that remembered it had happened. Eighty lines is about a day and a half of ordinary
hauling.

So `msg()` writes twice. Every message goes to `world.messages`; a message raised with
`headline: true` is *also* copied into `world.chronicle`, which keeps five hundred — several in-game
years at the rate headlines are actually raised. The copy is a copy (`{...m}`), not a shared
reference, because the two lists trim independently and aliased entries would have one list quietly
rewriting the other's history.

Two lists rather than one flag on one list, because they answer different questions and want
different lengths: **a window and a history are not the same data structure, and trying to serve both
from one bounded array means the shorter requirement wins silently.** `chronicle` is optional, so a
colony saved before it existed loads with no story and starts keeping one from that moment — a real
loss of one save's past, chosen over a version bump that costs every player their colony.

The panel is `;` in the colony view — every letter was already spoken for, `H` most of all (it has
been the hunt tool since the animals arrived), so the panel row `J` `L` `;` is the mnemonic instead
of the letter, the same trick `U`/`I`/`O` plays for the floors. Newest first: a player opens it to find out what just happened
and scrolls *down* into the past. Worldgen raises the founding as a headline so the history opens on
the arrival rather than on the day somebody first got shot at.

## One flag cannot mean two endings

`world.gameOver` used to mean both "everybody is dead" and "you won". Both are endings, both stop the
eval harness, and the HUD wanted the same final-tally card for each — so folding them into one
boolean looked like the tidy move. It cost the game its best colonies.

Nine sim passes read that flag before doing any work: `steward.ts`, `objectives.ts`, `scout.ts`, four
gates in `events.ts`, two in `trade.ts`, plus `commissions.ts`, `stranded.ts`, `settlements.ts` and
`alerts.ts`. Every one of them was written against the *death* reading, which is the only reading
that existed when they were written. So the moment `victory.ts` set the flag on a founding, the
colony stopped planning, stopped firing events, stopped trading, stopped scouting, stopped taking in
wanderers — and went on burning wood in the generator, because the generator is not one of the nine.

The symptom looked nothing like the cause. Seed 20260729 ran out of wood on day sixty with 32
reachable trees standing inside the harvest radius and a completely clear job board, and three
straight hypotheses about deforestation, board state and lingering hostiles were all wrong. What
found it was one probe that printed *every* early return in `tickSteward` on the same line instead of
reasoning about which one might be shut:

```
day 55ish  hour 11.0  wood 6  stewardOn true  gameOver true  hostiles 0  sleep false
boardClear true  heart size 99  stewardLast comfort
  stores     marks 8
```

`gameOver true` with eight living settlers. The `stores` ambition marks eight cells the instant it is
called by hand — it was never broken, it was never *asked*.

The rule, which is general: **a boolean that means two opposite things will be read as the worse one
by every caller that did not write it.** Callers do not read the definition; they read the name, and
`gameOver` says one thing. A founding is now `world.charter.won`, a wipe is `world.gameOver`, and the
only writer of the latter is `checkGameOver`. `eval/run.ts` — which genuinely does want both, because
it measures how a run *ends* — asks for both explicitly, and checks `hasWon` first so the best run
the harness can produce is not scored as the worst.

That separation is what makes an end game possible at all: the founding is already a milestone the
colony survives rather than a stop, so there is somewhere to put a second half. What there is not yet
is anything *in* that second half. Played out to sixty days, the founding lands between day 23 and day
40 on the quiet valley and the research tree runs dry on day 37 — twenty-three days at the end of that
run with nothing left to choose. Across the long runs the tree emptied on days 37, 43, 45 and 56, and
after that the colony is a going concern with no next thing to want. [ENDGAME.md](ENDGAME.md) is the
plan for what happens after the founding, and the measurements that say it is needed.

## A cable is not a footpath

The Steward could buy a turret long before it could power one. Two separate bugs, found by the same
measurement, both of which ended with three of a colony's four guns standing in the yard as scenery.

The first was that nothing was minding the meter. A forty-day census on three seeds printed
`generator:1` at every checkpoint on every one of them — the single generator worldgen puts down. The
foreman would build to the four-gun ladder (180 W) plus a cooler's worth of lamps and never once ask
where the watts came from, and `power.ts` then did exactly the right thing with the shortfall:
`SHED_ORDER` keeps the guns lit and puts the freezer out to pay for them. On seed 4242 the colony's
larder duly thawed on day twenty-eight, 3102 dark ticks and 2.5 % rot, and it presented as a spoilage
bug because the food was the thing that went wrong.

The `power` ambition now sizes the grid: enough generators to carry everything plugged in *plus a
cooler's worth of headroom*, capped at four. Only generators count toward that floor — a panel is
dark at night and a mill is dead under ice, so a grid sized on either fails on exactly the nights it
can least afford to. Panels come after, up to the generator count, because they are what stops the
firebox eating a tree a day; a battery bank waits until the colony owns something that must not go
out for twenty minutes. The headroom is free in fuel, which is what makes it affordable to insist on:
`tickPower` only lights a generator while `supply < demand`, so the spare firebox sits cold until the
night it is needed.

The second bug was the cable itself, and it got shipped twice:

- **A plain L walks into the yard fence and stops.** A fence does not conduct, deliberately — a
  paddock rail that silently powered a turret would be a rule nobody could see — and a fence is a
  *ring*, so there is no straight line out of one at all.
- **`findPathAdjacent` gets through the gate**, because a door conducts and the haulers walk that way
  anyway. But a footpath cuts corners and current does not: squaring up a diagonal step needs one of
  its two corner cells free, and a route that squeezes diagonally between two walls has neither. One
  such squeeze anywhere on a forty-cell run made the whole run unlayable, which took the two seeds
  that *had* been fine down to the same three dark turrets as the third.

Both are the same mistake — asking a question about walking and using the answer for wiring. What
conduit wants is four neighbours, no diagonals, and every cell either already conducting or free to
take a conduit. That is a plain breadth-first flood, it is nine lines, and it goes straight *through*
the cabin wall, which conducts, and is therefore both correct and shorter than going round to the
door. `wireRoute` in `steward.ts` is that flood, capped at 4000 expansions so a machine stranded
behind a lake cannot flood-fill the map every pass forever to re-learn what it already knows.

The general rule: **when two systems share a grid, they do not necessarily share its connectivity.**
Pawns move eight ways through open cells; current moves four ways through conductors. Reusing one
system's search for the other's question is a bug that typechecks.

## Save / load

`save.ts` writes a versioned envelope — `{ v, savedAt, world, view, speed }` — as JSON into
localStorage. `view` carries the mode and the possessed pawn id, so loading a save made from
inside a body puts you back inside that body. Version mismatch is reported, never guessed at.
RNG streams are saved too (`makeStreams` / `storeStreams`), so a reloaded save doesn't reroll
the storyteller's plans.

Derived state is not saved — the room index and the power networks are both flood fills off
the building list and are rebuilt on the first tick after a load. The one exception is
`world.roomTemps`: how warm a room *is* cannot be derived from the walls, and without it a
reloaded colony puts every fire out and brings its freezer back up to room temperature. It is
keyed by each room's lowest cell so the key survives the rebuild, and it is optional, so an
older save simply settles on its first tick.

## Rendering notes

Instanced meshes per building kind (`render/instanced.ts`), a procedural sky and one
directional sun driven by `sim/clock.ts` so the day/night cycle is the same number in both
views, additive fire/smoke sprites, and three quality presets that scale shadow map size,
pixel ratio and effect density. The device pixel ratio is always capped — at 1, 1.5 or 2 by
preset — because a retina display asking for 3 costs nine times the fill for a colony that
is mostly flat colour. All geometry is generated in code; there are no model, texture, or
audio files anywhere in the project, and `tests/architecture.test.ts` fails if one appears.
