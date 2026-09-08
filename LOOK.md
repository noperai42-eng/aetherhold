# Looking at it, round by round

How anything a player *sees* gets changed — models, materials, the HUD, a new screen,
the feel of a frame. [METHODOLOGY.md](METHODOLOGY.md) is the loop for what a grid can
measure; this is the loop for what only an eye can judge, and the harness that puts the
same picture in front of that eye before and after every change.

The loop was built in September 2026 to take the procedural Three.js models from boxes
and cones to something smooth, over four rounds. Nothing in it depends on which model
drives it. Fable drove those rounds; Opus or Sonnet can drive the next ones, and the
sections below say what carried the quality so that it carries over.

*Contents:* [The shape of a round](#the-shape-of-a-round) · [Setup, once](#setup-once) ·
[The instruments](#the-instruments) · [Running a round with the workflow](#running-a-round-with-the-workflow) ·
[Running a round by hand](#running-a-round-by-hand) · [How to look](#how-to-look) ·
[How to write a brief](#how-to-write-a-brief) · [Extending it to a new feature](#extending-it-to-a-new-feature) ·
[What will bite](#what-will-bite) · [How a look round is written down](#how-a-look-round-is-written-down) ·
[Driving it without Fable](#driving-it-without-fable)

## The shape of a round

One round is one brief, built, gated, photographed, and looked at:

1. **Frames from before** exist — the previous round's, or a baseline captured now.
2. **A brief per lane** names what is wrong *in a specific frame* and what it should
   look like instead. A lane is one builder's set of files; lanes never overlap.
3. **Builders** edit their lanes in parallel in the same working tree, each verifying
   with `tsc` and its own lane's tests, never the whole suite.
4. **The gate**: `tsc --noEmit` and the render tests, run by something that does not
   want the answer to be yes. Red gets two attempts at the smallest fix; still red
   aborts the round.
5. **The same frames again**, on the same seed, at the same tick, at noon.
6. **The driver looks** — every frame, previous then current, and writes down what is
   better, what is worse, and what still reads wrong, each observation anchored to an
   object in a frame. A regression outranks any win.
7. **Decide, fix, commit, log.** Small bugs the driver fixes; the rest becomes the next
   brief. The round is written into [ROUND_NOTES.md](ROUND_NOTES.md).

The discipline that makes it work is step 6. Builders report `green: true` and a
summary; a judge panel can be bolted on; none of that substitutes for the driver
opening the PNGs. Every round that went wrong went wrong because something was believed
that had not been looked at — a lighting lane blamed for fog that was the capture path
(see [What will bite](#what-will-bite)).

## Setup, once

```bash
npm run look:setup     # puppeteer-core into scripts/look/, Chrome for Testing into ~/.cache/puppeteer
npm run dev            # the page the harness photographs — vite on :5063
```

The harness needs a real GPU under headless Chrome, and it gets one only with the flags
in `scripts/look/chrome.mjs`. If the dev server is on another port (another session
owns `:5063`, say), every command below takes `URL=http://localhost:<port>/`.

## The instruments

| Instrument | What it does | Run |
|---|---|---|
| `scripts/look/shot.mjs` | The five standard frames of one colony | `npm run look -- .look/shots/r5 r5` |
| `scripts/look/zoo.mjs` | Staged scenes: every animal, crop stage and loose item, laid out on clear ground | `npm run look:zoo -- .look/shots/r5-zoo r5` |
| `scripts/look/crew.mjs` | Seven settlers in a row, one per state of hands and attention | `npm run look:crew -- .look/shots/r12-crew r12` |
| `scripts/look/heads.mjs` | Eight settlers at eight facings, for judging what a head's outline says | `LOOK_HAIR=long npm run look:heads -- .look/shots/r13 r13` |
| `scripts/look/trouble.mjs` | The colony on a bad day, interface up: the panels that carry bad news, carrying some — and, on its second report line, where those panels actually are, because a panel drawn over another panel photographs as a correct panel. Steps go to stderr with a stopwatch on them, so a run that dies names the step it died in | `npm run look:trouble -- .look/shots/r16 r16` |
| `scripts/look/grain.mjs` | Whether a change reached the frame at all | `node scripts/look/grain.mjs .look/shots/r5/r5-3-colony.png .look/shots/r6/r6-3-colony.png` |
| `scripts/look/diag-hang.mjs` | The stopwatch for when a capture stalls | `node scripts/look/diag-hang.mjs .look/hang` |
| `.claude/workflows/look-round.js` | One whole round, steps 2–5, as a workflow | see below |

`grain.mjs` is for one question, and it is a question the eye is bad at: *did anything
arrive?* It fits a plane to every 32×32 tile of a frame and reports what is left over,
so smooth shading falls out and fine detail does not; the low percentiles are the flat
surfaces answering for themselves. Round 6 asked for grain in the ground, the lane
raised its constants by half, and the frames were identical — p10 0.185 → 0.209 grey
levels, which is a gradient with nothing on it. The cause was structural (a per-corner
vertex colour on a shared lattice is ramped across a whole cell before it is drawn), and
no amount of tuning that amplitude was ever going to show. **Before briefing an
amplitude, check the instrument can carry the frequency.** Read the numbers only as a
before-and-after on the same frame; they say something arrived, never that it is good.

Frames land in `.look/shots/<label>/<label>-<frame>.png` (git-ignored). Both harnesses
pin everything a comparison needs pinned: seed `4242` typed into the setup card (each
load otherwise draws a random valley), pause at the first tick past 1800 so two rounds
photograph the same colony, the clock moved to noon of that day because dusk hides
models, the HUD hidden, the ground around the camera revealed by hand. They count
console errors and `shot.mjs` measures ten animation frames in milliseconds, so a round
that made the picture heavy shows up as a number rather than a timeout.

**Set `LOOK_MIRROR` before every shoot.** All three harnesses copy each frame to that
directory as well as writing it into `.look/shots/`, and the reason is the one step of
this loop that must never be skipped. Judging means opening all sixteen frames, and for
an agent working inside a repo each of those opens can cost the person at the keyboard
an approval — a toll on looking, whose first purchase is a summary read instead of a
photograph. Point it somewhere already readable (a session scratchpad) and the toll goes
away without the record moving:

```bash
LOOK_MIRROR=$SCRATCH/frames npm run look -- .look/shots/r11 r11
```

**The six standard frames** and what each one is for:

| Frame | Camera | Judges |
|---|---|---|
| `1-settlers` | overhead, close, on the first colonist | settler rigs, hair, clothes, tools; grass at close range |
| `2-buildings` | overhead, wide, on a showcase of every building kind stood in three rows south of the cabin | can every kind be told apart at manager zoom |
| `2b-closeup` | the middle showcase row, close | furniture and machine detail, materials |
| `3-colony` | the starting cabin from high up | the whole picture — ground, rock, trees, roofs, the shroud edge |
| `4-firstperson` | eye level, from a settler | walls, doors, grass and stones at 1.6 m; clipping |
| `5-dusk` | the colony camera again, sun about 8 degrees up | the light itself: shadow length and contrast, sun colour, lamps |

Five of the six are pinned to noon, which is the fairest light to judge a model in and
the least revealing about the light itself: the sun is overhead, the shadows are short,
and the warm band at the horizon never appears. `5-dusk` moves the clock to `timeOfDay`
0.725 and puts it back afterwards, so a round that changes the lighting has a frame that
can show it. It was added after round 7 photographed a dusk in which nothing cast a
shadow at all — a defect five noon frames had hidden for seven rounds.

The showcase rows are, in order: wall stonewall door fence sandbag turret trap bed
medbed · prisonbed table gametable statue stove bench lab cooler campfire · heater
generator battery solar watermill conduit lamp grave. When a kind is added to
`BUILDING_DEFS`, add it to `SHOWCASE` in `shot.mjs` or it will never be looked at.

**The zoo frames** answer a different question — not "is it smooth" but "does it look
like what it is": `A-animals` is a row of wild mossback, dunhare, brambletail, fenwolf,
a tame and bonded mossback (collar and tag), a hunted dunhare (hunt mark);
`A2-animals-fp` is that row from a settler standing three cells south; `B-crops` is
three growing cells at growth 0.15, 0.6 and 1.0 over two bramble bushes, stripped and
ripe; `C-items` and `C2-items-close` are the six loose-stack kinds — wood, steel,
rawfood, meal, medicine, hide — at amount 10 and amount 1.

## Running a round with the workflow

The workflow is the round with the driver's judgement left out of it: it builds, gates,
photographs, and hands the frames back. Launch it from a session with the Workflow tool:

```js
Workflow({
  scriptPath: '/Users/nope/Code/RimSim/.claude/workflows/look-round.js',
  args: {
    round: 5,                 // label r5
    prev: 'r4',               // the frames to compare against, .look/shots/r4/
    baseline: false,          // true captures `prev` first, for a first round
    zoo: true,                // also run zoo.mjs after the standard frames
    judges: false,            // the optional three-lens panel; the driver looks regardless
    lanes: ['pawns', 'decor'],// omit to run all six
    url: 'http://localhost:5063/',
    brief: { pawns: '...', decor: '...' },   // this round's change list per lane
  },
})
```

Phases, and who runs them:

- **Baseline** (only with `baseline: true`): a gate-runner captures `prev`.
- **Build**: one builder per active lane, in parallel, effort high, returning a
  structured result (`summary`, `filesTouched`, `verified`, `green`, `bugsFixed`,
  `bugsFound`, `concerns`). Each builder gets the lane's *standing* brief (in the script:
  files, tests, triangle budget, the target look) plus `args.brief[lane]`, this round's
  change list, which it does first.
- **Gate**: a gate-runner (cheap, no judgement) runs `tsc --noEmit` and the render tests
  and reports verbatim. Red gets a fixer, twice at most, told to never weaken a test.
  Green runs the harness, and the round aborts if a frame is missing.
- **Judge** (skipped with `judges: false`): three lenses — silhouette and smoothness,
  detail and materials, regression hunter — each read every frame and return scores,
  wins, problems and lane-tagged proposals, merged into `nextBrief`. They are extra
  eyes for the driver's brief, never the brief.

It returns `{ round, frames, builders, fixes, shots, verdict, judges, nextBrief }`. A
round with four lanes runs about an hour of wall clock, nearly all of it builders.

**The lanes** (edit the script to change them): `pawns` (`pawns.ts` — settlers and
animals), `buildings` (`buildings.ts` — structures, furniture, machines, trees, loose
items), `decor` (`decor.ts`, `landmarks.ts`, `fx.ts` — grass, stones, crops, bushes,
zone marks), `terrain` (`terrain.ts` — rock and ground), `lighting` (`renderer.ts`,
`sky.ts`, `palette.ts`), `critters` (`pickies.ts`). Every lane owns disjoint files, and
`palette.ts` belongs to lighting — a builder that needs a colour from another lane
asks for it in `concerns` rather than editing it. Keep a round to four lanes or fewer:
six builders and a gate all running `tsc` and vitest on one box starve each other.

## Running a round by hand

The workflow is a convenience. The same round, by hand, is what to do when the change
is one lane, or when a driver wants to build it itself:

```bash
npm run look -- .look/shots/r4 r4                         # frames from before (skip if they exist)
# ... edit the lane, verifying as you go:
npx tsc --noEmit && npx vitest run tests/buildings-view.test.ts
# the gate, then the frames from after:
npx tsc --noEmit && npx vitest run tests/buildings-view.test.ts tests/decor-view.test.ts tests/lake.test.ts tests/lighting.test.ts tests/ice.test.ts tests/landmarks.test.ts tests/minimap.test.ts tests/seasons.test.ts tests/snowpack.test.ts tests/terrain-view.test.ts
(pkill -f "Chrome for Testing" || true) && npm run look -- .look/shots/r5 r5 && npm run look:zoo -- .look/shots/r5-zoo r5
```

Then look (next section), fix, commit, log. Builders launched by hand with the Agent
tool should get the same brief a workflow builder gets — the standing lane brief from
the script plus the round's change list — and the same rule about files they may touch.

## How to look

Open every frame with the Read tool, previous first, then current, one pair at a time,
and write the observations down *before* reading what the builders said they did. Their
summaries prime the eye; the frame does not. Open the copies under `$LOOK_MIRROR`, not
the ones in `.look/shots/` — same pixels, and nobody has to approve sixteen reads for
the round to be judged.

Per frame, in this order:

1. **Regressions first.** Anything floating or sunk into the ground, z-fighting, black
   or blown-out surfaces, shadow acne on smooth surfaces, a darker or muddier picture
   than before, first-person clipping, console errors, a worse ms/frame. Count the
   showcase: twenty-six stood last time, so twenty-six now. A regression outranks any
   win, and a round with one is not "better with caveats"; it is a round with a bug to
   fix before the verdict.
2. **Silhouette.** At manager zoom, does each thing read as what it is without a
   tooltip — a bed as a bed, a mossback as something with antlers, a stack of wood as
   wood and not a brown cube? Can neighbouring kinds be told apart?
3. **Smoothness.** Where does the eye still catch a facet, a hard right angle, a
   six-sided cylinder? Is the low-poly look gone, or repainted?
4. **Materials.** Does wood, stone, cloth, metal, glass respond as itself — roughness,
   a highlight, an emissive globe on a lamp — or is it flat colour?
5. **Both cameras.** Something that reads overhead can fall apart at 1.6 m (a wall
   whose courses turn into filing-cabinet drawers) and the reverse.

For the zoo frames the only question is (2), asked of a new player: would they name it?

Write the verdict as a list of frame-anchored sentences, each tagged with its lane —
"the dunhare in A-animals reads as a small white dog: pawns" — split into *better*,
*worse*, and *still wrong*. The third list is most of the next brief. Score if it
helps, but the list is the record; a number without the sentence behind it is not.

A frame is 1280×800 at 1.5× and the Read tool shows it smaller than that. Detail under
a few pixels is invisible in `3-colony` and that is the correct verdict for the manager
camera; judge close detail on `2b-closeup`, `4-firstperson` and the zoo.

**When the whole frame cannot settle it, crop it.** A small object argued over across
several rounds — a stripped bush, a shoulder marking, a lamp head — is a handful of
pixels in a frame the reader sees shrunk, and a verdict at that size is a guess. Cut the
same box out of the round-before and round-after frames, magnify it, and put the two side
by side in one image; the judgement is then about a thing you can see. Four rounds in a
row have turned on this and it is worth the twenty seconds:

    python3 -c "
    from PIL import Image
    a = Image.open('.look/shots/r7-zoo/r7-B-crops.png'); b = Image.open('.look/shots/r8-zoo/r8-B-crops.png')
    box = (520, 440, 820, 700); w, h = 560, 486
    im = Image.new('RGB', (w*2+12, h), 'black')
    im.paste(a.crop(box).resize((w, h), Image.LANCZOS), (0, 0))
    im.paste(b.crop(box).resize((w, h), Image.LANCZOS), (w+12, 0))
    im.save('/tmp/before-after.png')"

The same crop at high magnification is also how an unidentified thing gets identified:
round 9 opened its brief with a flat gold seven-sided disc lying in the grass, which was
a blur in the full frame and unmistakable — no thickness, no shading, grass drawn over
it, so not an object and not the overlays it was mistaken for — at four times the size.

## How to write a brief

A brief a builder can act on without seeing the frames has four parts, in this order:

- **What is wrong**, anchored: the object, the frame, and what it reads as instead.
  "All four species are one capsule-and-cylinders silhouette at four scales; the
  dunhare in `A-animals` reads as a small white dog."
- **The target**, in shapes and tones, not adjectives: "a crouched egg body with the
  rump higher than the shoulders, upright ears taller than the head, a white puff tail,
  a sandy coat with a pale belly." "More detailed" is not a target.
- **What to keep**: the contracts the tests measure and the interfaces other files use
  — footprints and `def.height`, the `Rig` interface and its animation pivots,
  `InstancedPool` capacities, the facing convention, the triangle budget for the lane,
  the tests that must stay green.
- **Bugs to resolve**, if the frames showed any in that lane, stated as observations:
  "the hide stack in `C-items` drew as a flat diamond flush with the ground — only its
  top face shows, so it is sunk; check `itemRest` against the water sink added in
  round 3."

One round, one brief per lane. If the change list for a lane is longer than six items,
it is two rounds. The workflow's standing lane briefs are written in this shape and are
the reference.

## Extending it to a new feature

The loop is not about models. It is "photograph the same thing before and after, and
look". To bring a new visual or UX feature under it:

- **A new kind of object** (a building, an animal, an item): add it to `SHOWCASE` in
  `shot.mjs` or the relevant row in `zoo.mjs` so it is in a frame; add its file to a
  lane, or a new lane object in the script — `key`, `files`, `tests`, `budget`,
  `brief` — and add the lane key to the `JUDGE` schema's enum.
- **A new frame**: in `shot.mjs`, `aether.look(x, y)`, `zoomTo(n)`, `shot('name')`, and
  add the name to `FRAMES` in the script so the judges and the ok-check know about it.
  Keep the pins (seed, tick, noon) unless the frame is *about* the thing being pinned.
- **A staged state** (a raid, a fire, a flooded lake, a full ward): `zoo.mjs` is the
  pattern — find clear ground by walking out from the colony, mutate `aether.world`
  directly (push pawns, set `crops[cell]`, push into `items`, assign a zone), reveal the
  rectangle, `look`, zoom, shoot. The scenario triggers on `window.aether` (`fire`,
  `raid`, `herd`, `pack`, `refugee`, `ill`) exist for exactly this. The sim is paused:
  a settler teleported while paused *renders* where it stood until a tick passes, so
  press Space twice before a first-person shot of it.
- **A HUD or screen**: the standard frames hide the HUD (`#hud` is set to
  `display: none`); a UI frame leaves it, and drives the panel the way
  [METHODOLOGY.md](METHODOLOGY.md) "Looking at it" describes. Add a mobile frame with
  `page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })` when the
  feature has a phone layout. The rubric changes with the subject — for a screen it is
  hierarchy, one primary action, tap targets, contrast, and whether a first-time player
  understands it in five seconds — but the loop does not.

## What will bite

Each of these cost a round or an hour. They are listed so that they cost nothing again.

- **SwiftShader looks like fog.** Headless Chrome without `--ignore-gpu-blocklist
  --use-angle=metal` renders on software GL: seconds to minutes a frame, the sim
  advances a tenth of a second per frame, nothing is ever revealed, and every frame is
  hazed grey-blue by the shroud. It looks like a lighting regression. If a frame is
  uniformly hazed, print `aether.world.tick` and `aether.world.seen` before blaming a
  shader. `chrome.mjs` carries the flags; never launch Chrome another way.
- **The GPU stalls, sometimes.** The page answers `evaluate` instantly, the renderer
  still names the Apple GPU, and no animation frame arrives for minutes, so the tick
  freezes and `captureScreenshot` times out. It is the box, not the round — it hit two
  rounds' code alike and cleared on its own. First kill every orphaned `Chrome for
  Testing` (a failed harness leaves its browser on the GPU, and the next run stalls
  behind it) and rerun; if it persists, `diag-hang.mjs` races ten animation frames
  against fifteen seconds and, on a loss, prints the main-thread liveness, the JS
  stack, and the draw calls attributed to shader programs — a stall with a live main
  thread is the GPU; one with a stack is yours.
- **Capture only after the gate.** The dev server serves the tree as it is; a frame
  taken while builders are mid-edit is of a program that does not compile.
- **The vitest suite is not a builder's tool.** Alone it takes about fifteen minutes;
  beside four builders it takes over half an hour and the long sim tests time out. A
  red set that moves between runs is contention, not a regression. Builders run their
  lane's tests; the whole suite runs once, by itself, before the commit.
- **`world.seed` is not the valley.** It reads a constant. Repeatable frames come from
  typing the seed into the setup card's `input.seedbox` before Play, which the
  harnesses do.
- **Paused means paused for the renderer too.** Rigs learn positions from sim ticks;
  a pawn moved by script while paused renders at its old spot, and the first-person
  camera sits where the rig renders. Tick the sim before shooting.
- **Two handles.** `window.aetherhold` is the live `App` (viewport, hud, mode, speed);
  `window.aether` is the devtools handle with `look`, `build`, `world` and the scenario
  triggers. The harness uses `aether`.
- **Ports.** vite is `strictPort` on `:5063`; if a session already owns it the harness
  needs `URL=`. Never restart a dev server another session started.
- **The shell hook.** A preflight hook on this box rejects `;` in a Bash command:
  chain with `&&`, use `|| true` for a step allowed to fail, wait with a python loop
  rather than `sleep N;`, and there is no `timeout` binary on macOS. Every prompt the
  workflow sends says this because every builder that was not told tried `;` first.
- **Builders share one tree.** A `tsc` error in a file another lane owns is that
  builder mid-edit; the gate at the end is the arbiter. A builder that "fixes" it has
  edited a file it does not own, and the concern goes in `concerns`.
- **Builders' `green` is a claim.** Run the gate yourself before the commit.

## How a look round is written down

In [ROUND_NOTES.md](ROUND_NOTES.md), newest first, under a heading of the form
`YYYY-MM-DD — Look round N: <what changed, in a phrase>`:

- **Compared:** the two frame labels, and which lanes ran with what brief (a sentence
  each, or a pointer to the workflow args).
- **Verdict:** the three lists from [How to look](#how-to-look) — better, worse, still
  wrong — each line anchored to an object and a frame.
- **Shipped:** the commit, bugs fixed on the way, and the tests that hold the new
  contracts down (an [ACCEPTANCE.md](ACCEPTANCE.md) row where a promise was made).
- **Next:** the brief the *still wrong* list turned into, or the reason to stop.
- **Cost:** wall clock, and tokens if the session reports them.

Frames are not committed; the verdict is the record, which is why it is written in
sentences that name objects rather than in scores.

## Driving it without Fable

Nothing above needs a particular model. What carried the quality across the four rounds
that built this was structural, and any driver that keeps the structure keeps the
quality:

1. **Pinned frames.** Same seed, same tick, same hour, same showcase. A comparison
   between two different colonies is a guess.
2. **Frame-anchored briefs.** Written from the driver's own verdict list, in the shape
   above. The judge panel's proposals and the builders' `bugsFound` are inputs to that
   list, never the list.
3. **A gate nobody can argue with.** `tsc` and the render tests, run by a gate-runner
   that reports verbatim, and a fixer that may not weaken a test.
4. **The driver looks.** Every frame, every round, observations before summaries.
5. **One round, one brief; four lanes at most; stop on evidence.** Stop when two rounds
   in a row produce no *better* line that is not taste, or when the *still wrong* list
   is empty.

Effort settings that worked: builders at high, the gate-runner at low (it is Haiku and
runs commands), judges at medium when used. Harness edits — a new frame, a staged
scene — are Sonnet-grade work with a clear spec and were done that way. The driver's
own reading of the frames is the one step where a stronger model buys something, and
it buys it in step 4 and the brief that follows, not anywhere else in the loop; an
Opus driver that opens every PNG will out-judge a Fable driver that reads the builders'
summaries.

The rounds so far, for the record: r1 replaced boxes with rounded primitives and put an
environment map on the scene; r2 gave settlers a figure and buildings their parts; r3
added hairlines, belts, boots, rifle stocks, masonry, corner posts, door frames, a
unified stone palette and knee-high grass, and taught marks and rings to sit on the
ground (`groundLiftAt`); r4 is the animals, crops, bushes and loose items round, from
the first zoo frames. Their leftovers each became the next brief, which is the loop.
