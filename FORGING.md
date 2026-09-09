# A bench for the things the colony is made of

> Status, 2026-09-09: **nothing here is built.** This is a plan, and it is written
> against two readings — Evergrow at `~/Code/Evergrow` (cloned 2026-09-09), whose
> asset pipeline the first half of this document describes, and this repo's own
> `src/client/render/`, `src/tools/models.ts` and `src/review/`, whose gap the
> second half describes. Every line number and constant below was read out of the
> files named beside it.
>
> Like [DECIDING.md](DECIDING.md), this is **a code-surface reading, not a measured
> grid.** No colony was run to produce it. The instrument that settles most of it
> is the one in [LOOK.md](LOOK.md): photograph the frames, look at them. Where a
> claim here could be wrong, the section says which frame would show it.

*The other documents:* [README.md](README.md) is what the game is,
[ARCHITECTURE.md](ARCHITECTURE.md) is how the code is laid out,
[ASSETS.md](ASSETS.md) is how the models leave the game as `.glb`,
[LOOK.md](LOOK.md) is the loop that judges anything a player sees,
[DECIDING.md](DECIDING.md) and [ENDGAME.md](ENDGAME.md) are the other two forward
plans, and [METHODOLOGY.md](METHODOLOGY.md) is how a change gets measured.

## Contents

- [What Evergrow actually does](#what-evergrow-actually-does)
- [The gap, in this repo's own files](#the-gap-in-this-repos-own-files)
- [The shape of the thing to build](#the-shape-of-the-thing-to-build)
- [Stage 0 — a canvas that is not the game](#stage-0--a-canvas-that-is-not-the-game)
- [Stage 1 — the recipe](#stage-1--the-recipe)
- [Stage 2 — twelve at once](#stage-2--twelve-at-once)
- [Stage 3 — the address and the paste](#stage-3--the-address-and-the-paste)
- [Stage 4 — the sweep](#stage-4--the-sweep)
- [Stage 5 — the other thirty-eight](#stage-5--the-other-thirty-eight)
- [The order of work](#the-order-of-work)
- [Costs and risks, stated plainly](#costs-and-risks-stated-plainly)
- [What was deliberately not taken](#what-was-deliberately-not-taken)

## What Evergrow actually does

The first thing to say is the thing that is easy to miss: **Evergrow ships no art
files.** Not compressed ones, not small ones. There is no `assets/sprites`, no
atlas, no texture. `game/src/art-types.ts` opens by saying so in one line —
*"Procedural art only: every cached image below is drawn from geometry"* — and the
rest of the repository is that sentence carried out. The only binary in the art
path is a font.

Under that, four things hold it up.

**A tiny shared toolbox, and nothing more.** `art-primitives.ts` is 120 lines:
`randomFromSeed(seed)`, `hash`, `between`, `clamp`, `smooth`, `polygon`, `line`,
`taper`, `mixColor`, and a 2D affine `compose`/`transformPoint`. That is the whole
library. Everything visible in the game is those ten functions arranged. It also
carries its scars in comments, which is the same habit this repo has — `mixColor`
records that parsing its own `rgb()` output as hexadecimal turned every
subsequently-shaded pigment black.

**A naming convention that is a pipeline.** Roughly four hundred flat files in
`game/src/`, and the art ones come in fours: `*-shapes.ts` is geometry, `*-art.ts`
draws it, `*-content.ts` is the data table of what exists, `*-review.ts` is a page
for looking at that system on its own. `weapon-shapes.ts` → `item-art.ts` →
`weapon-content.ts` → the atelier. No file crosses those lines.

**Every shape is a function of a struct and a seed.** This is the part that
matters. `createTreeSprite(factory, kind, seed)` picks one of three growth habits
off `randomFromSeed(seed)` and varies lean, spread, trunk thickness and eighteen
bark furrows inside it. `weaponShapes(visual, draw)` takes a `WeaponVisual`
carrying `kind`, `length`, `width`, `gripLength`, `metal`, `edge`, `grip`,
`guard`, `glow` and `material`, and builds the silhouette from them — so a longer
sword is a number, not a new file. `ArmorPiece` is `{style, seed, material}` with
the comment that earns it: *"Geometry style and material are independent, so
equipment needs no textures."* Caches follow object lifetime rather than
accumulating: `WeakMap<Item, GearShape[]>` in `item-art.ts`, `WeakMap<WeaponVisual,
GearShape[]>` in `weapon-shapes.ts`, and finite variant libraries in `prop-art.ts`
(`TREE_VARIANTS = 48`, `ROCK_VARIANTS = 32`) so that memory does not grow with
distance walked.

**And then the forge, which is what the question was about.** `game/tools/forge.html`
is one line of markup. `src/tools/forge-model.ts` is nineteen lines and contains the
entire idea:

```ts
export interface ForgeRecipe {
  seed: number; level: number; kind: ItemKind; profile: string;
  tier: ItemTier; material: string; enhancement: number;
}
export function forgeItem(recipe: ForgeRecipe) {
  // bounds, then cross-field consistency: a profile must belong to the kind,
  // a material must belong to the profile
  const item = generateItem(recipe.seed, recipe.level, recipe.kind, ...);
  item.recipe.enhancement = recipe.enhancement;
  return deriveItem(item);
}
```

Three properties, and all three are the point. It is a **small serializable
struct** — seven scalars, so it fits in a URL and in a JSON file. It **validates**,
both the bounds and the cross-field consistency, so an impossible item is an error
rather than a strange picture. And it **calls the game's own generator**, not a
copy of it — `generateItem` and `deriveItem` are the functions that run when a
monster drops something.

`src/tools/forge.ts` is 47 lines on top of that, and its decisions are worth
listing because they are what turn a viewer into a bench:

- The preview is drawn by `itemIconSVG`, the same function the inventory calls. A
  thing that looks right on the forge looks right in the bag, because it is the
  same code path.
- Next to the icon, the item is put on a real character sheet through the real
  `addInventoryItem`/`equipItem` rules and drawn with `drawCharacterPortrait`. You
  see it in the hand, not only on the bench.
- There is a **Generate 12** button beside Generate item, and a sixteen-entry
  thumbnail history below. Comparison is the default and inspection is the
  exception, which is the opposite of how most asset viewers are built.
- Every field round-trips through the query string via `history.replaceState`, so
  a URL *is* the address of one exact asset.
- **Export item JSON**, and a `<details>` block printing the exact recipe, so what
  you found on the bench can leave it.

Around that sit about thirty-five more `*-review.ts` pages, indexed by a single
registry (`src/tools/catalog.ts`: forty-five tools in seven workspaces), and four
headless sweeps. `scripts/render-art-review.mjs` is the interesting one: it imports
the real `World`, `Renderer` and `Simulation` under Node, shims
`document.createElement` onto `@napi-rs/canvas`, renders a dozen scenes and stamps
each PNG with a caption reading *seed 7319, frozen actual renderer, no gameplay or
save access.* The provenance is printed into the image.

So the answer to "does it generate them with an engine, asset by asset" is yes, and
the engine is four things: a struct, a validator, the game's own builder, and a page
that shows you twelve.

## The gap, in this repo's own files

Aetherhold already has the *second* half of that loop and almost none of the first.

What it has is real and should not be rebuilt. `src/review/` stages one panel
against a fixture world and photographs it; `npm run look:review` reads the review
page's own index so a scene added in `scenes.ts` is shot without editing the
script; [LOOK.md](LOOK.md) is a written discipline for judging by frames rather
than by opinion; and `src/tools/models.ts` already stands one of everything on a
seeded valley, drives the **real views** under Node with no browser and no GPU, and
writes 42 `.glb` files. That last file's doc comment is already arguing the right
principle — it *drives* the renderer rather than re-listing what the renderer knows,
because a second copy is a thing that goes quietly out of date.

What it does not have is any way to vary a model, and the two examples the question
named are the two clearest cases.

**The scatter stones are all the same stone.** In `decor.ts:884`:

```ts
function stoneGeometry(): THREE.BufferGeometry {
  const welded = lumpyGeometry(new THREE.IcosahedronGeometry(0.5, STONE_DETAIL), STONE_LUMP, 3.7);
```

Zero arguments. The seed is the literal `3.7`. It is called once, at `decor.ts:294`,
into an `InstancedMesh`. Every loose rock in the colony is that one mesh, rotated.
`lumpyGeometry(base, amount, seed)` is exported and does take a seed — the knob
exists and is wired to a constant.

**The trees vary, but nobody can ask for one.** In `buildings.ts:3290`:

```ts
const size  = TREE_SIZE_MIN  + (TREE_SIZE_MAX  - TREE_SIZE_MIN)  * (((b.x * 11 + b.y * 5)  % 7) / 6);
const girth = TREE_GIRTH_MIN + (TREE_GIRTH_MAX - TREE_GIRTH_MIN) * (((b.x * 5  + b.y * 19) % 6) / 5);
const twist = TREE_TWIST_MIN + (TREE_TWIST_MAX - TREE_TWIST_MIN) * (((b.x * 13 + b.y * 3)  % 6) / 5);
```

A tree's proportions are a function of **where it stands**. There is genuine
variation in the wood — and it is unaddressable. You cannot ask for tree number
seven; you can only go and find a cell whose coordinates hash to it. The trunk
itself is a lathe profile of eight literal `[radius, height]` pairs typed inline at
`buildings.ts:2570`, and the only way to see what a ninth pair would look like is
to edit them, rebuild, boot a colony, and walk to a tree.

That is what it costs today. `scripts/look/zoo.mjs` is the honest measure of it: to
photograph a model it launches Chrome, loads the game, types a seed, waits for tick
1800, pauses, sets the clock to midday, hides the HUD, reveals a 140-cell square of
fog, hunts a lattice for clear ground, spawns things through `window.aether`, and
drives the camera by sending mouse-wheel events sixty milliseconds apart. Every one
of those lines is there for a good reason and none of them is about the rock.

Three more facts that shape the plan:

- The knobs are **module-private frozen constants**, and there are a lot of them:
  `STONE_DETAIL`, `STONE_LUMP`, `STONE_FACE_SPREAD`, `STONE_SINK`, `TUFT_HEIGHT`,
  `BLADE_WAIST`, `TREE_LOBE`, `SKIRT_SEG`, `ROOT_REACH`, `ROOT_RISE`,
  `PLANK_COURSES`, `PLANK_FACE`, `STONE_FACE`, `LOBE_MIN`, `LOBE_MAX`. They are
  values, not parameters, so there is no recipe to hold.
- `review.html` says *"There is no canvas here on purpose"*, and it is right to. Its
  contract — no simulation, no loop, photographable the instant load fires — is what
  makes it cheap. A 3D bench cannot live inside that contract and should not try.
- The census is 42 assemblies over 35 kinds (`models/manifest.json`): 27 buildings,
  8 resource piles, 2 trees, 5 people and fauna. Grass is not in it, because a
  tuft's sway is a vertex program injected through `onBeforeCompile` and glTF has
  nowhere to put one — which is an argument *for* a browser bench, since a browser
  can show the thing the `.glb` export cannot.

## The shape of the thing to build

One sentence: **put a recipe in front of the geometry builders this repo already
has, and a page in front of the recipe.**

Concretely, four pieces, mirroring the four that hold Evergrow up:

1. `src/forge/recipes.ts` — one small serializable struct per model family, with a
   default that is exactly today's constants.
2. `src/forge/forge.ts` — a validated pure `forgeModel(recipe): THREE.Object3D`
   that calls **the existing builders** in `src/client/render/`, never a copy.
3. `forge.html` + `src/forge/main.ts` — a bench: one model, real materials, real
   light, a control per field, twelve at a time, a URL that is an address, and a
   JSON block you can paste back into the default table.
4. `scripts/look/forge.mjs` — a sweep that reads the bench's own index and
   photographs everything, the way `review.mjs` already does for panels.

The non-negotiable rule, taken straight from `forge-model.ts` and from the doc
comment already at the top of `models.ts`: the bench **drives** the renderer. If the
bench draws a tree that the game does not draw, the bench is lying, and a lying
bench is worse than no bench.

## Stage 0 — a canvas that is not the game

Stand up `forge.html` and `src/forge/main.ts` as a sibling of `review.html`, not a
mode inside it. Same protections, for the same reason and by the same mechanism:
absent from `vite.config.ts`'s `build.rollupOptions.input` so it cannot reach the
players' bundle, still inside `tsconfig` so `npm run build` typechecks it and it
cannot rot silently.

It renders one thing: a single prototype on an empty ground plane, a fixed
three-quarter camera, and the game's own light rig read out of `sky.ts` and
`palette.ts` rather than a new one invented for the bench. `?model=tree` shows the
tree; no parameter lists what there is, the way `review.html` already does.

The pools are found the way `models.ts` finds them — `poolsOf(view.group)` walking
for `isInstancedMesh` with a named geometry — so a prototype the renderer stopped
building stops appearing on the bench, with no list to remember to edit.

**Done when:** a forge frame of the tree and a `zoo.mjs` frame of a tree differ only
by camera and ground. Photograph both and look; that is the whole test.

**Built** — 2026-09-09. `forge.html`, `src/forge/main.ts`, `stage.ts` and `forge.ts`.
One thing was learned in the doing and is worth writing down: the gathering logic the
bench needs lived in `src/tools/models.ts`, which imports `node:fs` to write `.glb` and
so cannot be resolved by a browser bundle at all. It was split into
`src/tools/assemble.ts` — everything that reads the views and hands back plain Three
objects, and nothing that touches a filesystem — which the export script now imports
back. The alternative was a second copy of `poolsOf` on the bench, which is the exact
thing the doc comment over there spends four paragraphs refusing to have.

## Stage 1 — the recipe

Turn the frozen constants into a struct, starting with the two the question named.

```ts
export interface StoneRecipe { seed: number; detail: number; lump: number; faceSpread: number; sink: number; }
export interface TreeRecipe  { seed: number; size: number; girth: number; lean: number; twist: number;
                               lobe: number; rootReach: number; rootRise: number; profile: readonly [number, number][]; }
```

Three disciplines make this safe rather than a licence to fiddle:

- **The default is today.** `STONE_DEFAULT` holds `{seed: 3.7, detail: STONE_DETAIL,
  lump: STONE_LUMP, ...}`, keeping the existing constants as the default table
  rather than deleting them. `stoneGeometry()` keeps its zero-argument signature and
  becomes `stoneGeometry(STONE_DEFAULT)`, so no call site in `decor.ts` changes.
- **A golden test per builder, written before the knob is exposed.** Build the
  geometry from the default recipe, assert its vertex count and bounding box against
  the geometry built today. Parameterising a constant is a chance to change it by
  accident, and this is the test that catches that. Functional category.
- **Validation, as in `forge-model.ts`.** Bounds on every field, and the
  cross-field rules where they exist — a profile needs two points and no radius past
  the axis, a trunk profile has to climb, and a crown needs one skirt profile per
  skirt the view draws. An impossible recipe is an error with a sentence, not a
  strange picture.

  This paragraph used to say a lathe profile must be monotonic in height, full stop,
  and the test written against that sentence went red on the tree the colony already
  grows. It was a wrong reading of the recipe: a bole climbs, but a skirt of boughs
  is a closed bowl that runs out and *down* under the branches and back up over the
  top, and all four of the wood's skirts double back. The rule is kept where it is
  true and `tests/forge-recipes.test.ts` now guards the exemption as well as the
  rule, which is the whole argument for writing the goldens before the knobs.

**Done when:** the default recipe renders a byte-identical geometry, the test says
so, and moving `lump` from 0.3 to 0.6 on the bench visibly changes the rock without
a rebuild.

**Built** — 2026-09-09. `StoneRecipe`/`STONE_DEFAULT` in `decor.ts`, `TreeRecipe`/
`TREE_DEFAULT` in `buildings.ts`, and a `Bench` per model in `src/forge/recipes.ts`
carrying the fields, the bounds, `problems()` and `build()`. All ten golden digests are
unchanged, and the golden test was watched fail before it was believed: `STONE_LUMP`
nudged 0.3 to 0.31 produced `× decor.stone is unchanged`, after which the constant was
restored. Both halves of the criterion are met on screen — `lump` at 0.6 is a plainly
different rock with no rebuild.

## Stage 2 — twelve at once

The single most valuable thing on Evergrow's forge is the **Generate 12** button,
and it is valuable for a reason that generalises: one rock tells you nothing about
whether the lump amount is right. Twelve rocks in a row tell you immediately, and
twelve rocks beside twelve other rocks settle an argument.

So: a seed field, a Random seed button, a Generate 12 button that lays a grid of
twelve seeds under the current recipe, and a history strip of the last sixteen you
looked at. The grid is one frame, which means it is one photograph, which means it
drops straight into the before-and-after discipline in [LOOK.md](LOOK.md).

**Done when:** a round note can carry a single before-and-after pair of twelve-rock
grids, and the verdict is obvious from looking at them.

**Built** — 2026-09-09. Seed field, Random seed, Generate 12 and a sixteen-deep history
strip. The grid's seeds are `first + i * seedStep` rather than random, so a before-and-after
pair compares the same twelve; the step is one for stone and **sixty-one** for the tree,
because a crown seeds its skirts at `i + 1 + crownSeed` and a step of one would share three
skirt outlines out of four between neighbours — which is the same sixty-one `treeCrown` puts
between the wood's two variants, arrived at from the other direction.

## Stage 3 — the address and the paste

Two small features that turn browsing into refining.

Every recipe field round-trips through the query string via `history.replaceState`,
so a frame has an address and a round note can link the exact thing it is arguing
about. And a JSON block — printed in a `<details>`, copyable — holding the recipe
in the shape the default table wants, so the artifact of a bench session is a
recipe you paste back into `decor.ts` or `buildings.ts`.

That paste is the loop closing. Without it the bench is a viewer; with it, an
afternoon of comparison ends in a diff.

**Done when:** a recipe found on the bench reaches the game by copy and paste, and
the frame after the paste matches the frame on the bench.

**Built** — 2026-09-09. `src/forge/address.ts`. Every field rides in the query string,
including the ones sitting at their default: a shorter URL that omitted them would
quietly change meaning on the afternoon somebody moves a constant in `decor.ts`, and a
link in a round note that shows a different rock than it did when it was written is
worse than no link at all. A field the URL spells badly — `lump=x`, or `lump=` with
nothing after it — becomes `NaN` and reaches the bench's own complaint, rather than
falling back to the default and showing you a rock you did not ask for; `Number('')` is
zero, and that is the trap. The paste block is real JSON with quoted keys, which is what
makes the done-criterion checkable by something other than an eye: three tests parse the
printed block back, hand it to `stoneGeometry` and `treeTrunkGeometry`, and compare
golden digests against what the sliders built. Two things a paste carries and cannot
avoid, said here rather than found out: `TREE_DEFAULT` writes some of its fields as named
constants (`rootReach: ROOT_REACH`) and a wholesale paste replaces those names with their
values, and the lathe profiles come out as bare numbers, so the reasons for them stay in
the comments above the table they came from.

## Stage 4 — the sweep

`scripts/look/forge.mjs`, built the way `review.mjs` is built: read the bench's own
index and photograph what it finds, so a model added to the game is photographed
without anyone editing the script. One frame per model at a fixed camera, plus a
contact sheet of the whole census.

This is what makes the census honest. Forty-two frames on disk is the only thing
that can answer "which of the forty-two have actually been looked at", and the
current answer — reachable only through `zoo.mjs`'s eleven-step boot — is a handful.

Stamp the frames with seed and provenance the way `render-art-review.mjs` does. A
photograph that does not say which seed it is of is a photograph that cannot be
compared to the next one.

**Done when:** `npm run look:forge` writes a frame per model into `.look/shots/`,
names any it could not shoot, and reports console errors — same contract as
`look:review`.

**Built** — 2026-09-09. `scripts/look/forge.mjs`, `npm run look:forge`, listed in
[LOOK.md](LOOK.md)'s table of instruments. It reads `.index a` off the bench itself, so a
recipe added to `src/forge/recipes.ts` is photographed on the next run without anyone
coming here; an empty index throws by name rather than writing a cheerful sheet of
nothing. `render-art-review.mjs` is Evergrow's script and not this repo's, so the frames
are stamped a different way: the shot is of the whole `.bench` rather than of the canvas,
which puts every slider in the picture, and the exact URL of each frame is written into
`<label>-frames.json` beside it — a harness that doctors the page before shooting it
produces frames that are not quite the page. The first sheet said `2 of 2 models`, which
is exactly the failure the risks above name, so the census is now read from
`models/manifest.json` and the sheet says `2 of 42 assemblies on the bench`. Two findings
came out of reading the frames back rather than out of the code: the sliders were the
browser's default blue, the one thing in a bench picture that was not this game, and are
now `accent-color: var(--edge-strong)`; and the stone's cast shadow peter-pans at bench
magnification, because the bench inherits the colony's own map-sized shadow frustum from
`sky.ts` — which is left alone, since a bench lit differently from the game is a bench
that lies about the game.

## Stage 5 — the other thirty-eight

Then it is rolling the recipe treatment forward, family by family, in the order the
frames from stage 4 say — not in the order this document guesses. A first guess,
to be overruled by the photographs:

| Family | Count | Why here |
| --- | --- | --- |
| Scatter and ground | rocks, tufts | Every cell has them and today they are one mesh each. Highest ratio of eyes-on-screen to knobs. |
| Trees | 2 | Variation already exists and is unaddressable; making it addressable is nearly free. |
| Piles | 8 | Eight objects sharing a prefix, seen constantly, each small. |
| People and fauna | 5 | The heaviest models and the most looked-at, but also the ones with the most existing look-loop rounds behind them — least likely to be wrong. |
| Buildings | 27 | Largest surface (3,451 lines) and least varied per instance; a stove is one stove. Last on purpose. |

Grass is a special case worth naming: it cannot be exported to `.glb`, so the bench
is the *only* place its shader sway can ever be judged in isolation. That makes it a
better early candidate than its position in the table suggests, and the frames from
stage 4 will say.

**Built — grass, 2026-09-09.** The frames said grass, and for the reason the paragraph
above guessed: the bench is a still camera, and grass is the one model in the game whose
defining property is that it moves. `TuftRecipe`/`TUFT_DEFAULT` and `SwayRecipe`/
`SWAY_DEFAULT` in `decor.ts`; `GRASS` in `recipes.ts` with eighteen fields, the last two
of which are `time` and `wind`. Those two are deliberately outside `recipe()`, because
they are the weather and not the tuft — the printed block is a thing you paste back into
`decor.ts`, and the weather is not in that file. Scrubbing `time` is what makes the sway
judgeable at all, and at `t = 0` both sines are zero, so the bench opens at `time = 1`
rather than on a dead-straight tuft it would be easy to mistake for a broken shader.

Three things had to be true before a tuft would stand on the bench at all. The sway lives
inside `#ifdef USE_INSTANCING` and reads `instanceMatrix[3].xyz`, so a plain `Mesh`
compiles without the branch and stands perfectly still — the bench builds an
`InstancedMesh` of count 1. The height and girth of a tuft are drawn from `hash`, which is
now exported, because a bench that drew its own random spread would show a spread the map
does not have. And a number spliced into GLSL as `${1}` is an int, so `uTime * 1` fails
the whole compile: every injected number goes through a one-line `glsl()` that guarantees
a decimal point, and a test reads `sin(uTime * 2.0 + phase)` out of the compiled source to
hold it.

Reading the frames back found two faults in the bench rather than in the grass, both of
which only a small model could have exposed. Eighteen knobs overflowed the panel, so the
single-tuft frame and the twelve-grid frame captured different slices of it — and a knob
that is not in the frame breaks the one thing stage 4 stamps a frame with, which is every
number that made the model standing in it. The panel is now 320px with label, slider and
box on one line. And the grid's gap was a flat 0.45 m, which is a fifth of a tree and five
times a tuft, so twelve tufts came back as twelve specks in an acre of turf while twelve
stones filled the frame; the gap is now a fraction of the widest model. A bench that has to
hold forty-two models between a pebble and a longhouse cannot space them in metres.

The drill found one thing the code did not, and it is the lesson for the other thirty-seven
families. `tipReach` was mutated 0.45 to 0.46 and every test stayed green: the golden digests
are positions only — correctly, because occlusion writes vertex colours — and `tipReach` writes
nothing but colour. A knob had been exposed with nothing holding it, which is exactly the risk
stated below in one line. So the rule for every family after this one is that the golden is the
floor and not the ceiling: whatever a recipe changes that is *not* a vertex position needs its
own pin, written before the knob is exposed. The tuft's root-to-tip ramp is now five exact
numbers, one per blade, and the gust is read back out of the compiled shader. Bounds were tried
first for the ramp and the same mutation walked straight through them.

What the sway frames say about the grass itself, for a later round rather than this one:
the phase is a function of where a tuft stands, so every blade in one tuft shares it and a
tuft tilts as a rigid fan rather than rustling. At distance in a field that reads fine,
because neighbouring tufts stand in different places. Alone on the bench it is the honest
limit of what the shader does, and giving a blade its own phase would mean a new geometry
attribute and a change to how the game's grass looks — which is a brief, not a bug.

**Built — piles, 2026-09-09.** The eight `stack.*` shapes, and the first family whose recipe
moves no vertex at all. A stone has five numbers that shift its vertices and a tuft has seven;
a stack of steel has a hundred and thirty literals inside `ingots()` and not one of them is a
slider, because the recipe of a pile is *where its stacks are put*. So `PileRecipe` and
`PILE_DEFAULT` in `buildings.ts` are the eight numbers that were three constants and two
literals buried in the middle of `sync` — the step, the cap, the handful and the two ends of
its ramp, and the three that decide how much taller a big load is drawn. `stackSize`,
`stackLift` and `stackRise` read them, and the view and the bench both call `stackRise` rather
than each writing out `step × size × lift`, which is two copies that agree until one is edited.

The eight shapes still got golden digests, and for the opposite reason from every family
before them: nothing on this page can change them, so nothing on this page would ever have
caught them changing. `logs()` and `pelt()` had never been measured by anything.

`Generate 12` is `Generate 8` here — `Bench.grid` is a new optional field and this is the only
entry that sets it. A family with a seed in it has no last value and twelve draws is a sample;
the stacks are eight hand-built shapes and there is no ninth, so a grid of twelve would
photograph three of them twice and say the family is larger and less even than it is. Fixing
that turned up a real fault in `Random seed`: it dealt `min + floor(random × span) × step` with
`span` computed exclusively, so the top of a range was never dealt. Over a seed field a
thousand wide that is invisible. Over a field eight wide it means the button cannot reach the
assemblies.

And the measurement the family was worth doing for. `STACK_SHAPE` promises each of the eight
"is built to top out at about `PILE_DEFAULT.step`, so a pile of mixed kinds still steps up by
the same amount", and `sync` takes it at its word. Measured, they run from 0.26 m to 0.344 m
against a step of 0.3 — raw food 13 per cent under and hide 15 per cent over, a 32 per cent
spread between the shortest and the tallest. Nothing had ever checked it, and the frames show
what it costs: a pile of hides sinks into itself by an eighth of a stack at every seam and a
pile of raw food floats 4 cm above its own base. Eight heights are now written out exactly and
the spread is held inside ±15 per cent, which is where they already sit — a band that admits
the gap rather than one that would be red the day it was written. Retuning eight shapes to the
step is a look-loop round with frames in it, not a silent edit, so it is a brief.

Reading the grid frames found one more thing, and it belongs to the bench rather than to the
piles: the grid's pitch is a function of footprint only, so a family taller than it is wide
hides its own back row. Four piles a metre tall stand in front of four more, and the same is
true of the twelve trees. It is not cheaply fixable — at the bench's 27° elevation a model of
height *h* occludes about 2*h* of ground behind it, so spacing the rows honestly would put a
tree grid over nine metres deep and shrink every tree in it to a stamp. Raising the camera or
splitting row pitch from column pitch are both design changes to every frame the loop has
taken so far, which makes this a brief too.

## The order of work

Stages 0, 1 and 2 are one piece of work and should be done together; a recipe with
no bench is a refactor, and a bench with no comparison is a viewer. Stages 3 and 4
only pay off once there is something worth comparing. Stage 5 is open-ended and
should be driven by the contact sheet, not by this table.

Nothing here blocks or is blocked by [DECIDING.md](DECIDING.md). They touch
different files entirely — that plan is `src/client/ui/`, this one is
`src/client/render/` — and the only shared surface is the look loop, which both
feed.

## Costs and risks, stated plainly

**Parameterising a constant is a chance to change it by accident.** This is the
real risk and the golden test in stage 1 is the whole mitigation. Write the test
first, per builder, before exposing the knob. A forge that quietly makes every rock
slightly wrong is worse than no forge, because it would be found weeks later in a
frame nobody was looking at.

**Forty-two models is a large surface and "every model" is an easy thing to claim
falsely.** The census is written down above and comes from `models/manifest.json`;
the contact sheet from stage 4 is what proves coverage. A bench covering eight
models that says it covers the game is the failure mode, and [ACCEPTANCE.md](ACCEPTANCE.md)
is where the honest count belongs.

**The bench must not reach players.** Mechanically identical to `review.html`:
absent from `vite.config.ts` input, present in `tsconfig`. [ACCEPTANCE.md](ACCEPTANCE.md)
already carries an anti-slop row for the review page; this needs the same row and
the same test.

**Not everything is a mesh.** Grass is a vertex program; some materials do work in
`onBeforeCompile`; the occlusion bake in `occlusion.ts` runs over a whole scene
rather than one prototype. A bench that shows a prototype without its bake is
showing a slightly wrong object, and stage 0 needs to decide explicitly whether to
drain `bakeOcclusion()` for the single-model case — `models.ts` already does exactly
this before writing `.glb`, so the answer is probably yes and the code is probably
reusable.

**It is a dev tool, and dev tools rot.** The counter-measure this repo already uses
is that harnesses read the page's own index rather than a hand-kept list —
`review.mjs` says so out loud, naming `SHOWCASE` in `shot.mjs` as the
counter-example. Both new pieces should do the same.

## What was deliberately not taken

**The forty-five-tool catalog.** Evergrow's `catalog.ts` registers forty-five tools
across seven workspaces with a shared nav, an iframe hub and route reporting. It
earns that. Aetherhold has one review page with ten scenes; a seven-workspace
registry over two pages is furniture, and it can be added the day there are twenty
pages to index.

**Style and material as independent types.** `ArmorPiece {style, seed, material}`
is the right shape for a game drawing flat polygons where a material is a palette.
Aetherhold's materials are `MeshStandardMaterial` with an ambient-occlusion bake
living in vertex colours, so the split is not free and is not obviously worth
paying for. Revisit if the recipe work makes it cheap.

**Node-side canvas rendering.** `render-art-review.mjs` shims `document` onto
`@napi-rs/canvas` because Evergrow draws in 2D. Aetherhold draws in WebGL2, and it
already has both halves of the equivalent: `models.ts` runs the real views under
Node with no GPU, and `scripts/look/` drives headless Chrome when pixels are wanted.
Adding a third rendering path would be a new dependency to serve no new frame.

**Finite variant libraries.** `TREE_VARIANTS = 48` and `ROCK_VARIANTS = 32` are a
memory strategy for a 2D game with unbounded exploration, where every new sprite is
a canvas that stays resident. Aetherhold instances a handful of prototypes across a
fixed-size map, so the pressure that produced those numbers does not exist here.

**A general-purpose model editor.** The temptation, once there is a bench with
sliders, is to keep going until it is a modelling tool. The thing that stops that is
the paste in stage 3: the bench's output is a small struct that goes into the source,
and anything that cannot be expressed as a small struct belongs in the geometry
functions where it already lives.
