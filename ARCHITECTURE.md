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
- [A ladder with nothing behind it](#a-ladder-with-nothing-behind-it)
- [Three bodies in a place nothing expects one](#three-bodies-in-a-place-nothing-expects-one)
- [A cable is not a footpath](#a-cable-is-not-a-footpath)
- [Save / load](#save--load)
- [Rendering notes](#rendering-notes)

## The source map

Seventy-five files in `sim/`, and the order below is roughly the order a colony meets them:
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
    settlements.ts     the twelve neighbours off the map in three rings, and the two parties that walk to them
    commissions.ts     the neighbours ask for something back: one pack, on a clock
    prison.ts          what happens to a raider who goes down and does not die
    research.ts        the one axis that only goes forward: nineteen projects, 421,000 points
    scout.ts           the reason to leave the yard: ruins, caches, survivors
    explore.ts         what the colony has laid eyes on: one flag a cell, and it only goes up
    power.ts           networks by flood fill, generators, batteries, brownout shedding
    health.ts          illness: the severity-vs-immunity race, tending, bed rest
    alerts.ts          what is still wrong, derived fresh every frame and never stored
    idle.ts            why that settler is doing nothing, in one provable sentence
    pickies.ts         a question with legs: what you send to ask why nobody goes there
    objectives.ts      what to do next: the sticky curriculum behind the Goals panel
    victory.ts         the exam: five charters, the three days they hold, and no shutdown
    roads.ts           what comes after the exam: three ladders of four rungs, all derived
    holdings.ts        the ground the Ashbound hold, and the three settlers sent to take it
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

Five things about it are load-bearing:

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

**A grid with nobody at the wheel cannot be asked a question about the player.** The grid plays
`steward: false` on purpose — nobody manages the colony, and what it measures is the floor the sim
clears alone — which is the right instrument for every errand the colony's own foreman eventually
picks up. A campaign is not one of those. `types.ts` says so where the job kind is declared: never
planned by the colony, a war is the player's decision every time. So when stage 4 shipped, the
first sixty-day grid after it came back `campaigns 0` on all fifteen colonies, and the two war
promises duly reported that the holdings were priced out and the war party was scenery. Both were
false. An unmanaged grid cannot march, will never march, and the reading was of the instrument.
The fix was *not* to hand the whole grid to the Steward — twenty-four of the twenty-six promises
are calibrated against the unmanaged floor and would have started quietly measuring the Steward
instead, with nothing on screen to say the baseline had moved. `sweepSpecs` now emits a second
family, `kind: 'war'`: the same fifteen seed-and-setting colonies on the same clock, played with a
Steward at the wheel, collected into `Sweep.war`, and read by those two promises and nothing else.
(Two more joined them later in the same slice — the road promises below — so the split now runs
twenty-two against the floor and four against the played family. The principle is the same one:
a promise is read off the family that can make its number move, and moving a promise across is a
deliberate act with a paragraph attached, not a default.)
The transferable half: **when a measurement comes back at exactly zero on every run, ask what would
have had to happen for it to be non-zero, and check that the harness does that thing.** Fifteen
colonies agreeing exactly is not a finding, it is a constant, and a constant is usually the
instrument.

**Two more promises had the same fault, and were found by looking rather than by being bitten.**
Stage 4 rewired the warfare ladder to count ground held, and both stage-3 road promises —
`the-three-roads-are-three-roads` and `no-road-is-already-finished` — read `roadRungs` off the
unmanaged grid, where every colony stands on warfare rung 1 and no colony has ever stood anywhere
else. Neither had reported anything alarming, which is the point: one was scoring two of its three
pairs against a constant and calling one of them an inversion, and the other was reporting that
every road had somewhere left to go on the strength of colonies that had never set foot on one of
them. Both moved to `Sweep.war` for the same reason the war promises did. The rule that generalises
is narrower and more useful than "check your zeroes": **when a stage changes what a column counts,
re-ask which family every promise reading that column is denominated in** — the promises that break
loudly get looked at anyway, and the ones that quietly keep holding are the ones that need finding.

### Measured once, judged in milliseconds

The grid is expensive and the checks are not. Playing thirty-nine colonies costs thirty-six minutes;
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
false alarm is thirty-six minutes of re-measuring, and the cost of a missed one is a balance
decision made against a game nobody played.

**The judge is not on that list, and for a while it was.** `principles.ts` was hashed along with
everything else under `src/eval`, which meant moving a single bar cost a fresh grid before anybody
could see whether the move was right — the exact loop this section opens by abolishing, rebuilt at
the other end of the same file. It is not a false alarm of the useful kind, because there is no
version of the story where it catches something: the judge plays no colony, nothing in `src/sim`
imports it, and a `Sweep` measured yesterday is exactly as true today whatever the checks now ask of
it. The constants it reads — `WAR_PARTY`, `ROAD_RUNGS`, `roundTripDays` — live in sim files that
*are* hashed, so a bar that moved because the sim moved still stales the grid, through the file that
moved. So the judge joins the pool, the CLI and the on-disk format on the exclusion list, and the
guard now says what it always meant: *these numbers came out of a sim that has since changed*, not
*somebody edited something*.

The same argument does not yet reach `sweep.ts`, which holds the harness and the tables in one file
— so adding a column to a printed grid still costs a re-measure. That is a real cost and the fix is
obvious (the formatters do not decide anything either), but splitting a file to change a hash is a
change worth making on its own rather than in passing.

Deleting that dead code was itself the point. `runSweep` and `runUpkeepArm` had no callers left once
the grid was described by `sweepSpecs`, played by `runSpec` and folded by `assembleSweep`, and the
argument for keeping them — "the serial reference implementation" — is exactly wrong: a second
definition of the grid that nothing compares against the first is not a reference, it is a fork
waiting to drift. There is one definition now. `npm run measure -- --serial` plays the same specs
through the same `runSpec` in one process, so if a parallel grid and a serial one ever disagree the
argument is settled by running both rather than by reading the pool.

What it bought: twenty-four colonies — 1,000 colony-days on the sixty-day grid as it stood before
the war family was added — in **1,556 seconds** on eight workers of a ten-core box, against several
hours for the same grid played one at a time. The grid is thirty-nine colonies now and takes
**2,176 seconds** — sixty-two per cent more colonies for forty per cent more wall-clock, which is
the pool getting *better* as the list gets longer: more specs across the same eight workers means
fewer workers standing idle while the last long colony finishes.

Do not call it a benchmark: the numbers were taken on a machine doing other work, and eight
workers buy something like three and a half times rather than eight for two reasons worth knowing.
The colonies are wildly uneven — a calm map with fourteen threats in sixty days is a fraction of the
work of a harsh one with forty-two, and the harsh colonies are also the ones that grow biggest — so
the run ends when the *longest* colony ends, and thirty-nine specs across eight workers is five
waves deep with a ragged edge on each. The fix for that is to start the long ones first, and it is
not worth doing until the grid is long enough that the tail is the cost — the twelve-day arm runs
landing last on the most recent grid is exactly that cost, and it is still small.
The determinism claim was checked twice over: `tests/eval-pool.test.ts` plays a mixed list of grid and
arm specs through two workers and asserts the results are identical to playing them one at a time,
and two independent parallel runs of the full grid, scheduled differently by a differently-loaded
machine, produced the same numbers row for row.

### What the grid found

**The current reading lives in [ACCEPTANCE.md](ACCEPTANCE.md), not here.** That file is rewritten
every grid; this section is the story of what the grid *found* — the things nobody designed and
would not have guessed — and its figures are the ones that were on screen when each finding was
made. Counts below that disagree with ACCEPTANCE are older readings, not competing ones. The
promise count in particular only goes up: twenty when this was written, twenty-six now.

Sixty days, five seeds, three settings, seven multipliers, every run played past its founding.
Twenty principles were scored; fifteen of them are enforced and all fifteen held on measured
evidence — trouble comes sooner (day 5.0 → 3.0 → 2.0), more often (15.0 → 29.2 → 42.2 threats), in
bigger bands (4.0 → 6.8 → 8.8), better armed (31 % → 61 % → 84 % of raiders carrying a rifle),
hitting harder (2.4 → 36.6 → 104.6 trips to a sick bed), nobody is wiped on the quiet valley,
Hard country costs a colony ×2.8 what Settler does (41.6 → 115.6),
the far country is shut in week one and open by week six on seven maps in ten below
Hard, the roads past the near ring are actually walked (10 of 10 below Hard, mean trips by ring
3.6/3.4/0.1), and the founding is no longer where the run stops: seven of the fifteen colonies
closed their charter, the earliest on day 23, and every one of them played out the rest of its
sixty days.

Two of the fifteen are new since the third tier shipped. **No colony that played its whole clock
stood at an empty bench** — where before the tier eleven of fourteen finished the entire tree and
nine of those had a fortnight or more still to play. One colony does now clear all 19 projects,
calm/20260729, and it stands idle for exactly one day at the end of them; across the grid a run
spends 5.9 days worked-out and waiting on a delivery, worst 18. The other is **the first act is
finishable**, and it is a guard rather than a discovery: six of the ten runs below Hard country
close their charter. Guaranteeing the middle ring a parts town by dealing it a fixed card once
halved the foundings from eight to four, and every principle on the board still read HOLDS, because
the founding check asks only whether the colonies that founded played on afterwards and never
whether anybody founds.

Five are open — findings the grid prints without asserting, because the fix is a design decision
rather than a number. Two of the five hold anyway. Four of the five Hard maps buried somebody, which
is the check that a colony sim where nobody ever dies is a screensaver. And *the surplus finds a
buyer* has come good: all nine runs that ended above 300 steel spent at least a quarter of the pile
down at some point, the thinnest being settler/99001 at 36 % of 884. That one is worth a note,
because it was written for the same feature as the tree check and did not close with it — a grid ago
it read two rich runs in nine, calm/1312 sitting on 986 steel having never given back more than 196
of it, and both of the runs that failed it were runs whose caravan never got a parts delivery home
inside sixty days. Nothing was done to it directly. What closed it was the road work giving the pile
somewhere to go, which is the argument for having written the principle before the demand existed.
It stays open because a claim about demand that has held on one grid is a reading, not yet a
promise. The last three are below.

Four things the grid found are worth writing down, because none of them was designed:

**Difficulty reaches the pantry, and it gets there mostly through labour.** All three settings start
on stores the genesis check has already pinned, and after sixty days calm ends with 20.0 days of
food where harsh has 14.0. Only part of that is the `larder` dial handing harsh less; the rest is
that a settler who is shooting or on the floor is not farming. The enforced check is therefore a
ratio rather than a floor: threat multiplies ×2.81 across the settings while food in store moves
×1.43, and the promise is that the second number stays under the first. Watch the gap rather than
either number — before the direct `larder` dial existed the same comparison read ×3.3 against ×1.5,
and it is the *distance* between the two that says difficulty is still a valley rather than a
handicap.

**The upkeep axis is real, and the grid column measuring it is not the axis.** A free settler's day
runs 29.7 % → 33.5 % → 35.5 % across the grid; held alone in the controlled arm, with threat and
stores and seeds all pinned, the same three dials read 31.0 % → 35.1 % → 36.7 %. Both are monotone
and the two disagree about where the *step* is — the grid puts 3.8 points between calm and settler
where the arm puts 4.1, and 2.0 points between settler and hard where the arm puts 1.6. That is
`larder` and `band` writing the same column from the other side, and on the thirty-day grid the
discrepancy pointed the other way, which is the whole argument for not enforcing on the column. The
enforced promise reads off the arm; the long version is four paragraphs up.

**Seven of fifteen runs had a settler starve beside a stocked larder.** Every one of the seven
bottoms out at exactly 0.00 — a settler at nothing, not a settler running low — and every one does
it while the colony holds between thirteen and twenty-two days of meals. That is the signature of a
feeding or hauling failure rather than of an empty pantry, which is why the check prints the runs
and does not claim a cause: the first version of it asserted "nobody starves on calm or settler",
broke on five runs, named difficulty as the culprit for a bug in the food economy, and by exempting
harsh hid four more instances.

One thing about it has changed and is worth stating rather than smoothing over. It used to land on
one quiet-valley map, three Settler maps and four of the five Hard ones, and that spread across all
three settings was the argument for not hanging it on a difficulty principle. On this grid the calm
instance is gone and the seven are three Settler and four Hard — which *is* a correlation with
difficulty, and a weaker position than the paragraph used to hold. It is still not a difficulty
finding, because a settler at 0.00 beside three weeks of meals is the same failure whichever setting
it happens on, but the evidence for that is now the mechanism rather than the spread. Doubling the
grid to sixty days did not move this; the trade work did, from six in fifteen to eight and now back
to seven, which is a lead and not a diagnosis — a colony with a settler away on a six-day road has
one fewer pair of hands to carry a meal, and nobody has yet tested whether that is what happened.

**The top of the escalation ladder is content nobody has ever been shown.** The highest rung reached
anywhere on the grid is 2 of 4 — three calm maps and two Settler ones — and Hard country never gets
past rung **1**: its five maps read 0, 1, 1, 0, 1, on the setting whose entire promise is
escalation. That ceiling has come *down* since this was written, from a lone calm map that once
touched 3, and nothing was done to the ladder in between; the peak is a single map's luckiest
streak, so it moves with the seed and is not worth a diagnosis. The floor is the finding.

The ladder is fed by `unbloodied`, a streak of fights that end with nobody on the grass, and Hard
country cannot hold that streak for a moment: it is knocked back to zero by the very casualties that
make it hard. So the rungs are reachable in principle and, exactly where they are supposed to
matter, unreachable in practice. Doubling the grid to sixty days made this *worse*, not better,
which is the useful part — more time is not the missing ingredient. This is open rather than
enforced because the fix is a design choice — shorten the ladder, or feed it something other than a
streak the hard setting is built to break — and the grid's job was to find it, not to make it.

## A cost is scaled by the cost in front of it

The grid that motivated the third research tier found a fivefold steel pile on the quiet valley and
a shortage on Hard country — a factor of twenty between the poorest sixty-day run and the richest —
and the tier wanted to charge materials. A flat bill priced for one of those settings is a pleasant
sink on the first and an impassable wall on the second, and there is no single number that is both.

The resolution is that **a cost only ever presented to those who have already paid a larger one is
scaled by that larger one, whatever its own units say.** `research.ts` bills the four third-tier
projects in flat steel — 180, 220, 200, 260 — and the flatness is safe because no colony is shown
that bill until it has spent the 249,000 points clearing the two tiers beneath. That predicate is
not a sample of the three settings; it selects the colonies that ran out of tree, and on the current
grid that is nine runs — all five calm maps, three Settler ones, and Hard country exactly once in
five. Hard country mostly never meets the steel gate because it is still stopped at the points gate,
and that is the difficulty axis doing its own job rather than this one borrowing it. Look for the
gate in front of your gate before inventing a formula: the cheapest way to make a constant
setting-aware is to put it behind something that already is.

That predicate used to pick out the runs ending rich as well, and it no longer does — the richest
run on the grid, settler/99001 on 884 steel, never reaches the tier, and the one Hard map that does
ends on 180. The reason is worth keeping, because it is the feature working rather than the argument
failing: end-of-run steel now measures spending as much as earning. A colony that reaches the tier
buys parts with the pile, so it ends poorer than one that stood still, and settler/99001 ends
richest precisely because it never opened a road to spend anything on. **A quantity stops being a
proxy for wealth the moment you give wealth somewhere to go.** The gate is still doing its job — the
bill is never shown to a colony that could not pay it — but the evidence for that is now the points
gate itself, not the steel column that used to agree with it.

The second half of each bill is a different trick and worth naming separately. Components have no
patch, no recipe and no bench — the only supply anywhere is the middle ring. **A price
denominated in a journey needs no scaling at all**, because a journey costs whatever the colony can
spare, which is by construction what it has.

Neither claim would be worth much unattended, so the instrument came with them. A bench that is
worked out and short looks *exactly* like a bench with nothing left on it if all you read is `tech`:
two different failures, one reading, and the grid would have cheerfully reported the tree fixed
while every colony on it stood still for the opposite reason. `RunMeasure` grew `stalledDays` and
the sweep table grew a `wait` column, reported in the detail line of
`the-tree-is-not-empty-at-day-sixty` and asserted on by nothing — a few stalled days is a colony
organising a road trip, which is the tier working. **When a feature can fail two ways, an instrument
that cannot tell them apart will certify the wrong one.**

That column has since been split twice, and the second split is the more instructive of the two.
`the-bench-does-not-wait-on-an-errand` promises the colony *decides* — standing still is allowed to
cost a road, it is not allowed to cost a decision nobody made — so `unsent` was added beside `wait`
to count only the days nobody was on the road. The first predicate behind it asked whether the party
out there was out *for the bench*, which is the question the principle's name suggests and not the
one it means, and one run in nine went red on it. A per-tick probe — necessary, because
`caravanAllowed` opens and shuts several times a day and a day-boundary read reports whichever side
of it dawn fell on — found calm/99001's single spare settler had left on day forty-six for a ring-1
town carrying thirty meals, eight days *before* the bench had a bill at all. The errand was correct
when it was chosen and the colony had nobody to recall. The measure was still charging it for a
road; it had only stopped charging it for the bench's road.

So the predicate is `partyCommitted(world)`: any committed party, wherever bound, and both states of
a departure rather than one — the party that has left the map, and the sixth of a day the settler
spends walking to the road head with a `caravan` job in hand, which a day-boundary sample can land
in and read as indecision from a colony that had already decided. The reason it lives in
`settlements.ts` and not in the eval is that `caravanAllowed` refuses on both for the same reason,
and a measure that reimplements half of a rule the sim owns will eventually disagree with it.

Widening a measure until a red goes green is how a grid gets talked into lying, so the argument has
to be that the excluded case is not the fault named — and here it is checkable. A party that walks
past an available parts run to sell somewhere else *is* the fault, and that is forbidden in
`jobs.ts` and pinned by nine unit tests. What the widening excludes is a colony with one settler and
an errand that predates the bill. The check still fails things: the one day calm/99001 was home,
free and sent nobody is counted, and a colony that sits at home for a week still reads seven. It now
reads **2 against a threshold of 2** — a pass with no margin, worth stating rather than smoothing,
and the threshold was not raised to buy room. **A measure that has been narrowed twice should be
read as owing an argument, not as having been improved.**

The same reasoning runs through `settlements.ts`. Destination scoring was `worth / (days + 1)` and
nothing else, so an unattended colony would have sold steel to the best payer forever while the last
four projects sat at 100 % and waited. The fix is a second term — a town selling something the bench
is short of scores ×3 — keyed on the *shortfall* rather than the bill, so it switches itself off the
moment the crates land and reads exactly ×1 on every run that never reaches the third tier. That last
property is the one that mattered for the grid: **a new term that is the identity everywhere the old
measurements were taken leaves them comparable.** It combines with the ×5 for opening a ring by
`max`, not by multiplying — independent facts about one trip, and ×15 would stop being a tiebreak and
start being the only decision the foreman ever made.

## Two roads, and the gate that had to become one question

The third tier bills a colony four times over — 12, 18, 22 and 28 components, 180 to 260 steel — and
one road cannot carry that inside sixty days. Worst case on the near ring is a six-day round trip, so
two errands is twelve days of walking done strictly one after the other, and the colony spends the
back half of the tier watching a bench it has already paid for. So there are two parties now. The
principle written before the feature is `the-road-keeps-up-with-the-bench`: no colony that reaches
the third tier waits more than **twelve stalled days**, which is two worst-case round trips — one
trip that went wrong and one that went right — rather than a number picked to be passable.

The thing a second party is *not* is insurance. `tickCaravan` seeds its own `Rng` on
`(world.seed ^ ((s.id * 733 + s.visits + 1) * 0x9e3779b9))` and then increments `s.visits`, so a
town's road luck is a pre-drawn deck indexed by visit number: the second party does not get a
re-draw against the card that robbed the first, it gets the *next* card, which is the one the first
party would have drawn tomorrow anyway. What the second road buys is draws per day. That is worth
saying out loud, because "send two so one gets through" is the intuition, and it is wrong here.

The interesting part is what the suite did to the gate. The first cut charged the headcount floor
per departure against the people still at home — `CAN_SPARE_ONE = 4` others left behind, checked
again at each departure — and paired it with a cap of two. Both halves read as obviously safe, and
the doc comment written beside them said so: *a colony of five can just field two parties and is
down to three at home while they walk.* Then `tests/hunting.test.ts` went red. Nothing in that file
is about trade. A per-tick probe on seed 20260729 said it plainly: **two parties on the road by day
seven, three settlers left holding the valley**, out of five. A colony of five behaving like a colony
of three, in week one, long before the third tier the second road exists for. The colony that came
out of it was hunting to stay fed.

The fault was the pairing, not either half. A cap checked separately from a headcount is two gates
that can each be true while the pair of them says something nobody meant — five satisfies "four
others at home" on the way from five to four, and satisfies it again on the way from four to three.
So the two became one division:

```ts
export function roadsAllowed(world: World): number {
  return Math.min(CARAVAN_PARTIES_MAX, Math.floor(colonySize(world) / CAN_SPARE_ONE));
}
```

One road per four settlers, counting the ones already walking. Four fields one road, eight fields
two, five fields one however long the bench waits. Three properties make this defensible rather than
fitted: it is derived from a constant that already existed, it is monotone in colony size, and it is
**identical to the old rule for the first road** — so every grid reading taken before this still
describes the same behaviour, and the before-and-after can be read off one number.

`everyPartySpent` then asks `caravanAllowed`'s own question instead of a copy of it, which is why
the eval half of the change cost nothing. A measure that had reimplemented the cap-plus-headcount
pair would have gone on reporting the old rule after the sim stopped following it, with no test able
to tell — the same failure as the destination scoring above, one layer over.

Two things are owed here rather than claimed. The `unsent` column got **stricter** in the same
commit that made the road faster, since one committed party no longer excuses a colony that could
have sent a second, so a rise in `unsent` is not by itself evidence the road got worse. And
`the-bench-does-not-wait-on-an-errand` passed its last grid at exactly its 2-day threshold with no
margin, on a rule that has now changed underneath it; it was put on record as likely to move before
any numbers landed, because a prediction made after the reading is not a prediction.

**A design fault this cheap to state was found by a test about wildlife.** The grid measures day
sixty; this lived on day one and a half. That is the argument for running the whole suite before the
grid rather than after it.

## The instrument was sampling breakfast

Both of those owed items came due on the next grid, and neither came due the way it was written down.

`the-bench-does-not-wait-on-an-errand` went red, and the prediction that it might was correct for the
wrong reason. `unsent` was a field on `DaySnapshot`, and `DaySnapshot` is taken once a game day at the
day boundary — and a world starts its clock at **07:12**, not midnight. `timeOfDay` is
`world.tick % TICKS_PER_DAY` over `TICKS_PER_DAY`, the first tick is tick one, and so every reading
this column has ever produced, on every seed, in every grid in the repo's history, was taken at 07:12.

That is the one gap in a settler's day. Awake, so no sleep-hours refusal. Not yet fed, so the best
talker is often under `ROAD_FOOD` and `caravanAllowed` says no. Not yet departed, because the party
that is going to leave leaves at about eight. Attributing settler/1312's twelve samples by hand: nine
had every road already walking, two had a hungry talker, **one** was a colony that was free to go and
stayed home. The hour-by-hour permission profile is non-zero at 6, 7, 18 and 19 and flat zero from
eight in the morning to six at night, because by eight the question has been answered by leaving.

The column read three days. The same sixty days counted a tick at a time read **0.09**. A thirty-fold
overstatement, in the same direction, on every seed — which is the shape of an instrument fault, not
of noise. Worse, `everyPartySpent` never asks about food, so what the measure was charging the colony
for was in part *a road nobody was permitted to walk*: the third time this codebase has caught itself
measuring a proxy for a rule instead of the rule.

The fix is the cadence and the question, and deliberately nothing else. Ask every tick; ask
`caravanAllowed` itself. Only the best talker can ever lead a party, so asking `bestTalker` once is
exactly "was anybody permitted" at a thirteenth of the cost:

```ts
if (researchStalled(world)) {
  const talker = bestTalker(world);
  if (talker && caravanAllowed(world, talker)) idleTicks++;
}
```

`stalled` stayed a day sample and the same objection does not apply to it — a stalled bench is a state
that lasts days, and at tick resolution it reads 11.76 against the sample's 12. A quantity that
flickers inside an hour is a different kind of thing, and it was the only one that had to move.

**The threshold did not move with it.** `A_DECISION` stays at two days, which at the new cadence makes
the principle a regression guard rather than a live constraint. That is on purpose: a threshold left
alone while the instrument beneath it is replaced is the one honest way to find out what the old
instrument was worth. Moving both at once produces a grid nobody can read.

## A bar derived off the wrong ring

The other red was `the-road-keeps-up-with-the-bench`, and the second party did not fix it because the
bar was never reachable. `TWO_ROUND_TRIPS = 12` was derived as two round trips of ring zero — three
days out, six there and back, one trip that goes wrong and one that goes right.

Ring zero does not sell components. `RINGS` says so in its own comment: the **middle** ring is the
only place in the world that does, and it is five or six days out. A parts round trip is ten to twelve
days. Twelve is therefore *one* trip, not two — the principle was asking colonies to have the parts
home before the only journey that could fetch them had finished.

The two failing runs prove it rather than merely being excused by it. calm/1312 and calm/424242 spent
sixty days with a road free for a total of 0.05 and 0.01 days: both roads full, essentially
continuously. They were not deciding badly. They were walking.

So the principle is now `enforced: false`, and the number stays. Re-deriving it to twenty-four here
was considered and rejected, because twenty-four would have been green *before* the second party too —
the pre-slice waits were 18, 17, 13, 13 — and a bar that passes the code it was written to fail has no
evidentiary value left. The re-derivation is owed to the slice that changes where parts come from,
which is the slice that will know what the honest distance is. The repo has deferred a denominator on
these grounds once before, on `one-robbery-does-not-end-the-tier`.

Two red principles, two different lessons: **one was the colony's fault and one was the ruler's**, and
the only reason it was possible to tell them apart is that the claim was written down before the
feature and the instrument was cheap enough to audit at tick resolution.

## A road that was open and had nothing on it

The far ring came into range on every map the grid ever ran and was walked on two of them. That is not
a permission bug — `the-far-ring-is-earned` reads green, the vouches are earned, `withinRange` says
yes. It is a demand bug, and the cause is one line: `RINGS[2].sells` was `['steel', 'medicine']`, and
both of those are also on offer five days nearer.

`pickDestination` ranks a road on what a pack is worth divided by how far it has to go, and
`shoppingRun` takes the *nearest* road selling what the bench is short of. Neither has a tiebreak that
a nine-day town can win when the same goods sit at a five-day town. The far country was reachable and
irrelevant, which is a harder failure to see than an unreachable one: every instrument pointed at
access said the road was fine.

The fix has to be demand, not weighting. A far-ring multiplier or a standing order would make colonies
walk out there for goods they could buy nearer — the colony obeying its scoring function instead of
its economy, which is the failure mode the whole grid exists to catch. So `assemblies` is a good sold
**only** in ring 2, and the top two rungs of the tree bill it. The trip then pays for itself the
ordinary way: the bench wants it, nowhere else has it, `pickDestination` needs no thumb.

Two properties make that cheap enough to be safe. The parts town's guarantee generalises — `ensureParts`
is now `ensureSold(ring, kind)`, repairing a ring by converting the second seller of whatever it has
most of, never a sole seller — and it matters more out here, because three kinds over four towns leave
better than one map in five with nowhere to buy the top of the tree. And `settlementsOf` draws the
rings outward, so ring 2 is the seed's last draw: adding a third good to the far ring changes no die in
the near or middle country. Every reading taken before this slice is still comparable to every reading
taken after it, which is the only reason a change to the world generator was affordable at all.

## The bar comes back, one ring at a time

`TWO_ROUND_TRIPS` is gone. The bar is `deliveryBar(ring) = roundTripDays(ring) + A_DECISION` — 8, 14 or
22 days, depending on which ring the outstanding bill is payable in — and `roundTripDays` reads `RINGS`
rather than restating it, so a good that moves ring moves its own deadline with it. That is the actual
lesson of the section above this one: twelve was wrong not because twelve was too small but because a
delivery deadline that does not know how far away the goods are is not measuring anything.

One round trip and a decision, not two trips. The second trip was in the old derivation because a
colony had one party and a failed attempt had to queue behind it; a colony fields two roads now, so the
retry walks concurrently with whatever else is out. The re-derivation had to clear the bar the repo set
when it rejected a flat twenty-four — *it must still fail the build it was written to fail* — and it
does: calm/1312 at 18 days and calm/424242 at 17, both on middle-ring bills, against 14.

Reading the ring costs a column. `errandRing(world)` returns the deepest ring any outstanding research
bill is payable in, or −1; it is sampled on the daily snapshot beside `stalled`, folded into
`stallRing` on `RunMeasure`, and printed in the sweep table as `18@1`. Daily sampling is right here for
the same reason it was wrong for `unsent`: an unpaid bill lasts as long as the stall does, so any hour
of the day sees it, whereas permission-to-leave flickered hourly and 07:12 was the one hour it was
always false.

What deliberately did **not** change in the same slice: `stalledDays` is still the day-sampled total
rather than the longest single delivery. Moving the bar and the ruler together is exactly how the
`unsent` overstatement survived three grids unnoticed. The per-delivery instrument is owed to the next
slice, after this bar has been read once.

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

## A ladder with nothing behind it

The second half now has something in it, and the thing worth writing down is what `sim/roads.ts`
deliberately is not. It holds no state. There is no rung on the world, nothing in the save envelope,
nothing to migrate, and a colony saved before the file existed reads its three rungs correctly the
first time it is opened. Every tally is read off world the colony was already keeping — finished
projects, standing with the neighbours, raiders put down and ground held — and the whole module is
two pure functions over that.

That was not the obvious build. The obvious build is a `roadProgress` record on the world that the
tick advances, because that is how a progress bar usually works and because reading three tallies
every frame feels wasteful. It is the same mistake `alerts.ts` avoided and for the same reason: **a
stored copy of a derived number is a number that can drift, and nothing on screen will say which of
the two is lying.** A rung that says *Foundrymen* while the research panel shows eleven projects is a
bug with no natural place to be caught, and it survives a save.

The rung boundaries are derived rather than picked. Science steps at `NEED_RESEARCH`, at the free
tree finished, at the foundry branch, at the whole tree; economy at one place, `PER_RING`, two rings,
`NEIGHBOUR_COUNT`; warfare at `STANDING_BAND` — the standing band put down at home — and then one
rung per holding taken. Three of those constants had to be exported to make it possible, which is
a fair price: a ladder with hand-picked numbers in it is a fourth thing to balance, and it goes stale
silently the first time the tree or the map grows. Grow the map to a fourth ring and the economy road
lengthens on its own — and so does warfare, because `ROAD_RUNGS` and `1 + HOLDING_COUNT` are the same
number by construction and `roads.test.ts` holds them to it.

Warfare did not start there. It stepped at `STANDING_BAND` compounding by `CLEAN_PER_STEP` when this
file shipped, which was the best available reading of *how much war has this colony done* in a game
where war only ever happened in the yard. It stopped being the best reading the day there was
somewhere to march to, and the tell was in the grid before the replacement was: warfare was the road
that was **never behind**, on every seed, because raiders arrive whether or not the colony wants a
war. A tally that rises without the player choosing anything is a difficulty readout wearing a
ladder's clothes.

The rung exists at all because the three tallies are in different units — projects, places, raiders —
and no arithmetic across them means anything. The rung is the only comparable quantity the three
ladders produce, which is what lets the grid ask the question that matters:
`the-three-roads-are-three-roads` requires that for every *pair* of roads, some colony on the grid is
ahead on one and behind on the other. Correlation would be the wrong test — colonies that are doing
well are doing well at several things — but a pair that **never** inverts is the signature of one
measurement counted twice, and three tallies wired to the same underlying thing is exactly how a
choice of ending quietly becomes a choice between synonyms. A flat pair's *direction* is the whole
diagnosis and has to be in the sentence, which the first version of the check got wrong: it asked
whether either road was ever ahead, printed `always level` when the answer was no, and so reported a
pair where economy was strictly *behind* warfare on nine runs of fourteen as if the two were the same
number. Level means one measurement counted twice; leaning means a road nobody is walking. Those are
different bugs and they want different fixes. Its companion,
`no-road-is-already-finished`, breaks the day a sixty-day colony stands on a top rung, because a road
somebody has finished has stopped being somewhere to go. It would have failed a grid ago, when
calm/20260729 emptied the research tree, and since stage 4 read both of these off `Sweep.war` it
fails now: calm/1312 and settler/1312 hold three holdings each and stand on warfare rung 4 of 4.
Both promises are `enforced: false` for that reason — they are bills against the stage that puts an
ending at the top of each road, not defects in the ladder that measured them.

Reading it on the grid costs one column and no new sampling. `runColony` already writes a daily row,
so `roads: roadRungs(world)` rides along beside the columns that were there, the last row's copy
lands on `RunMeasure.roadRungs`, and the sweep table prints it as `1/2/0` per run with the
per-difficulty mean underneath as `1.4/1.0/0.2`. Three integers a day is the cheapest instrument in
the file, and it is only affordable because the rungs are derived: nothing had to be recorded during
the run to make the last day's reading true.

The panel is the founding's own panel. Once `hasWon`, `syncGoals` puts the three roads where the
charter checklist was: same rows, same bar, same hint line, and the ending each road leads to on the
row's hover. A player who learned to read that corner during the first act does not have to learn a
second one for the second.

## Three bodies in a place nothing expects one

The trade road already taught this lesson once: a traveller is *genuinely gone* — out of `world.pawns`
entirely, so nothing can path to them, feed them or shoot them — and that is both the cost the feature
is built around and a settler in a place nothing else in the sim looks. `holdings.ts` does it three at
a time, and adds the state the caravan never had: a party that is **half** off the map.

A muster is three settlers walking to the treeline as ordinary jobs. Between the order and the
departure, some of them are lifted and some are still crossing the yard, and every way that stretch can
end badly is a way to strand the colony in a state nothing can read — a `campaign` job whose party no
longer exists, a settler off the books with nobody to join, a war that is neither happening nor
cancelled. So there is exactly one exit. `abandonMuster` cancels every campaign job first and then puts
back everyone already lifted, and the four callers that can end a march early — a raid in the yard, a
settler the player takes over, a road out that is blocked, a muster that has not filled inside a day —
all go through it rather than each unwinding their own half. **One settler dropping out of a war party
is the party**, which sounds like a design choice and is really a structural one: a party of two is a
size no other rule in the file was written for.

The fight itself is a pure function of the fighters and the dice, and the caller writes the outcome
down. That split is what makes the assault testable at all — `storm` never touches the world, so the
branches can be exercised without a colony around them — and it is also what keeps the escalation
honest, because the one thing a win writes is `storyteller.unbloodied`, the streak the storyteller was
already counting. Taking ground raises what comes over the treeline next, with no second dial to keep
in step with the first.

Two numbers in there are worth naming because they are the ones a reader would expect to be invented
and are not. **A club counts for `club.range / rifle.range` of the exchange** — about an eighth. Off the
map there are no cells, so the range difference that `combat.ts` settles by making a clubbing man spend
the firefight walking has to be paid some other way, or three bodies would read as the equal of three
rifles. It is not a guess about melee; it is the ratio of the two numbers the on-map fight is already
using. **A beaten settler floors at a quarter of their health**, just above `combat.ts`'s downed line,
which is the whole of the arithmetic behind *nobody dies off-screen*: the homecoming does not have to
reproduce bleeding, rescue and a doctor's queue for bodies that were never on the map to be carried.
A settler killed by dice the player could not watch is a story the game has no way to tell them.

The bill is booked at the muster and not at the homecoming. The colony is short those three for the
whole walk the moment it says go — the road back is not optional — and a count that waited for the
return would read a holding as free for every day between taking it and standing down. That is the
difference between `no-holding-falls-for-free` measuring what a holding cost and it measuring nothing,
and it is the same reason the principle counts pawn-days instead of campaigns: a campaign that
resolved on the tick it was ordered still reports one campaign and one holding.

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
