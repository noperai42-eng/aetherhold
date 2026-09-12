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
- The census is 42 assemblies over 35 kinds (`models/manifest.json`): 26 buildings,
  1 loose stone, 8 resource piles, 2 trees, 5 people and fauna. This bullet read
  "27 buildings" until the round that made the count honest checked it: the stone
  is not in `BUILD_MENU` and never was, and every round note that says
  "twenty-seven buildings" is quoting this line. Grass is not in it, because a
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
| Buildings | 26 | Largest surface (3,451 lines) and least varied per instance; a stove is one stove. Last on purpose. On the bench since 2026-09-10, with one field and no recipe. Five of the twenty-six — the machine shells — build from `ShellRecipe` as of 2026-09-10, the two tables from `TableRecipe` and the two walls from `WallRecipe` as of 2026-09-12, and the games table's trim follows its own top as of the same day — the first building whose parts would survive a knob being turned. The bench still has no knob, so the census still reads no recipe here. |

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

**Built — animals, 2026-09-09.** The four species, and the first family the contact sheet
picked on the strength of how badly it was photographed. `r10-A-animals.png` is the only
picture of a mossback, a dunhare, a brambletail and a fenwolf that this repo has ever taken,
and in it they are eleven cells below a manager's camera, in a field, at three different
distances, and half of them are cropped. Nobody has ever seen the four of them standing on the
same ground at the same distance. `Generate 4` is that picture, and `Bench.grid` — the field
the piles added — has a second user, which is the only test of whether the field was right.

`AnimalRecipe` and `ANIMAL_DEFAULT` in `pawns.ts` are the four numbers that were four module
constants: the leg swing, the fraction of its dam a newborn is drawn at, the collar's cut and
the marker's air. The species themselves stay tables — a blob radius, a hem sample, an ear
rake — for the reason `recipes.ts` states about trees: a table is not draggable, and a slider
that averaged four species into one would be a slider that draws an animal the game does not
have.

The extraction was not optional. `recipes.ts` forbids the bench from building its own
assemblies, so the whole of `AnimalRig`'s constructor came out into `assembleAnimal`, and the
rig now calls it. `growAnimal` and `poseLegs` are the same discipline as `stackRise`: the body
scale and the marker's height are one expression called from two places rather than two copies
that agree until one is edited, and a test stands a bench animal and a pen animal side by side
and compares every named part's position — the payoff of the extraction, measured rather than
asserted.

Reading the file to write the recipe found the fault the round is worth. Each species wrote its
leg length twice, once as the argument to `limb()` and once as the `legLength` field ten lines
down, while the settler in the same file uses one named `SETTLER_LEG`. The rig places a hoof at
`-legLength` inside the leg, so the two numbers drifting apart would leave a hoof in the air or
under the turf, silently, in a family nothing measured. Each species now names its length once,
and two tests hold it: a leg's box runs from 0 to `-legLength`, and the assembled hoof sits at
`-legLength` inside it.

And the promise the family was worth measuring. `SpeciesModel` says everything is laid out in
body space, "where a mossback is a unit tall at the withers, and the rig scales the whole thing
by the species' `size` — so a hare is a hare-sized version of these numbers, not a different
set." It is not. The four withers run 0.666 to 0.95 before any scaling — a 43 per cent spread —
so `size` is not the drawn height it reads as. A dunhare marked 0.45 of a mossback stands 0.32
of one; the brambletail and the fenwolf come up about a tenth short of their own numbers; and
the mossback, the unit, is 0.95. The four withers and the four drawn heights are now written
out exactly, and so is the direction of the error. **Brief: put the four species into one body
space, or make `size` mean the drawn height.** How big the animals are beside each other is a
look-loop judgement with frames in it, so it is a brief and not a silent edit — and the grid
frame this round adds is the first frame that judgement could ever be made from.

The grid frame also sharpened the pitch brief the piles opened. The stage spaces models by the
largest horizontal dimension of the widest of them and then frames a bounding *sphere*, so four
animals that are long and thin stand 1.3 m apart while being 0.3 m across, laid along a
diagonal inside a sphere they fill a sliver of, with two thirds of the frame grass. It is not
only depth the grid gets wrong; it is which axis a row is spaced on, and how a family only one
row deep is fitted.

One more thing surfaced that belongs to the sheet rather than to the animals, and is logged
rather than fixed. `scripts/look/forge.mjs` prints "`N` of 42 assemblies on the bench", but `N`
is the number of *benches*, not the number of assemblies they cover. Five benches cover
fourteen of the forty-two — nine tree pools that export as two, eight stacks, four species —
so the line understates by nearly three to one. It errs toward the caution its own comment
argues for, which is why it is a brief and not a bug, but saying it honestly needs each `Bench`
to declare which manifest entries it shapes, and that is a field on the interface rather than a
word in a template.

One smaller false promise came with it. `ANIMAL_DEFAULT.collarR` is documented as "a mossback's
throat, the widest neck on the map", and it is 0.15 against a mossback's own 0.13. The number
is right and the sentence is nearly right; what was missing was anything that would notice if
it stopped being. The bench now refuses a collar cut narrower than the widest throat that has
to wear it, which is the family's one cross-field rule.

**Built — settlers, 2026-09-09.** The last family that is not a building, and the one every
other frame in the repo has a settler standing in the corner of. `SettlerRecipe` and
`SETTLER_DEFAULT` in `pawns.ts` are fourteen numbers that were fourteen module constants: the
leg and the hip's swing, the three heights a torso, a shoulder and a head hang at, the sleeve
and the wrist, the arm's splay, the sleeve's step in L*, the three that place a carried load,
the bob and the stoop. Two of the fourteen also cut buffers, so `settlerGeometry(r)` came out
of `makeShared()` — a bench that lengthened the leg and kept the thigh would draw a settler
whose knee had come out through the trouser, and no golden could have seen it, because the
goldens are written at the default.

Two extractions, and `recipes.ts` forbade neither being optional. `PawnRig`'s whole constructor
came out into `assembleSettler`, the way `AnimalRig`'s came out into `assembleAnimal`, and a
test stands a bench settler and a colony settler side by side and compares every named part's
position AND its two rotations — the splay is set once in the constructor and never written
again, so a comparison that looked only at positions would have missed it entirely. The second
extraction is the one this family needed and the herd did not: `settlerPose` is the two switch
statements out of `update()`, a function of the stance and nothing else. That is what lets the
bench put all eight poses on one page, and it is what makes the grid say *pose* rather than
*seed* — `Bench.grid` now has a third user, and its first non-enumerable one, since the eight
poses are a list the switch writes rather than a family with a census.

`update()`'s own doc had been arguing for exactly this since the day the arms and the legs were
split apart: "the legs answer to locomotion and the arms answer to what the hands are doing,
and because those are separate questions, walking-while-carrying can now be one pose instead of
two that cannot both win." That is a description of a pure function of a stance. It had been a
description of a method on a rig for eleven rounds. The bench's `hands full` toggle composes
with every one of the eight, which is the argument made in a picture.

And the fault the round is worth, in the half of the gait nothing had ever looked at. `gait.ts`
opens by arguing that its skating fix "is not inverse kinematics. It is one equation", and
`footScrub` exists "so a test can say so in cells rather than in adjectives" — and every word
of that is about the horizontal. Rotating a rigid leg about the hip lifts the sole through an
arc, and the body above it does not come down to meet it. A walking settler is airborne for all
but three instants of a stride: at full swing BOTH boots are 44 mm clear of the ground, and at
the eighths they are 36 mm up. The bob does not help and is exactly out of phase with the feet
— it peaks at the eighths and is flat at the quarters, where the soles are highest, while a
real walk carries the hip highest over the planted foot at midstance and dips it at double
support, which is where these legs are splayed. **Brief: bring the walking body down to its own
feet — drop it by the planted sole's rise so the foot stays put and the hip dips at the splay
— and judge whether that reads as a walk or as a limp.** The five sole heights and the five
lifts are now written out exactly, as they are and not as they should be; which way to close it
is a frame question, and the bench's `bob` slider and eight-pose grid are the frame.

A second fault fell out of writing that down, and this one was fixed rather than logged, because
it was a stated contract broken rather than a judgement to make. `FpsController` carried its own
copy of the rig's bob with the absolute value dropped, under a comment claiming it was "the same
phase, amplitude and two-rises-per-cycle the rig bobs on". It was one rise per cycle, and it
sank the camera 35 mm BELOW standing height on every other step while the body it belongs to
rose. Twenty-one tests already drove that controller and not one of them had looked at the
height of the thing they were driving. Both now call one `settlerBob` — the `stackRise`
discipline, a third time — and three tests go red if the absolute value is dropped again.

One smaller thing worth writing down. `armSplay` is 0.12 and `thumbLimit` — the roll at which
the thumb's tip crosses the shoulder's own line, which the field's own doc argues for and now
computes — is 0.12628. The shipped body sits five per cent under its own ceiling. That is the
right side of the line and it is a narrower margin than the doc reads as, so the bench refuses
anything past it and a drill that nudged the splay by one hundredth turned nine tests red.

**Built — the stage, 2026-09-09.** Not a family. The room every family is
photographed in, taken on because the contact sheet asked for it three rounds
running and `src/forge/stage.ts` was the one file on the bench that no test had
ever touched. The piles round wrote that "the pitch is a function of footprint
and nothing else"; the animals round sharpened it to "two thirds of that frame is
grass" and could not judge the four species' sizes because of it; and r24's sheet
added a third symptom, a tree grid pulled back far enough that the background
plane runs out and sky shows. Nothing could say how much, because nothing
measured it.

The fault is the pitch, and it is `GAP`'s own wording broken. The field is
documented as "how far apart two models in a grid stand, **as a fraction of the
wider one**", and the code took the widest *dimension* of any model and stepped
by it on x and z alike. A family whose models are long and thin therefore paid
its own length as the gap between columns that are a third as wide. The herd
stands along z: four fenwolves 0.58 m through were spaced 2.32 m apart across,
and got 23 per cent of the frame. `gridPitch` now reads each axis off that axis
— 0.84 across, 2.32 along — and the same four get 34.

The measurement is the round's real product, and it is the thing the two earlier
briefs were reaching for: what fraction of the frame the subject actually
occupies, in screen space rather than in metres, because a grid that is wide and
shallow on the ground is wide and *short* in the picture and metres cannot say
that. Written out per family, as it is: stone 28, grass 30, tree 32, stack 28,
animal 34, settler 33.

Two suspects were measured and acquitted, which is worth as much as the
conviction. `COLUMNS = 4` is argued in a comment — "past that a grid of twelve is
a strip of stamps" — and never checked; measured, four is within a point of the
best column count for five of the six families. Only the piles want three, and
they want it by four points. **Brief: shoot the eight stacks at three to a row
beside four and judge whether a squarer block of piles reads better than a row of
four and a row of four, which is what the number says and what a number cannot
settle.**

The second acquittal is the sphere. `fitDistance` frames a sphere round the
bounding box rather than the box, which costs a third of the subject: an exact
fit against both fields takes every family from about 28 per cent to about 40.
Measured, almost none of that is the sphere being loose — on a square canvas the
exact fit is four centimetres tighter over thirty-four metres — and almost all of
it is the canvas being wider than it is tall. Banking it means every frame
becomes a function of the window it was taken in, which is the one thing the rest
of that file is arranged not to be: the same argument the `Viewport` is pinned at
`high` for. So the sphere stays, the trade is written into its doc in numbers
rather than claimed in a sentence, and a test holds both sides of it.

The frames the fix produced found the round's third thing, which no brief had
asked for. With the pitch tightened, three of the six families came up large
enough to show that they are crowded — the eight piles read as one heap with a
barrel across a crate and the mound half behind another, the twelve trees
interpenetrate so that few silhouettes can be read whole, and the eight settlers
overlap arm across body. The other three read clean: the twelve stones are a
lattice with air round every one of them, the four animals stand apart, and the
grass is ground cover where the question does not arise.

What is worth writing down is the two attempts to turn that into a number, both
of which the frames threw out. The first said a row clears the row in front when
`pitch.z` beats `height / tan 27`; it forgot that the camera stands at 43 degrees
of azimuth, so a step along z is not a step directly away from it. The second
corrected the trigonometry and counted screen-space bounding-box overlaps, and
ranked the stones as the third-worst family on the bench — against a frame in
which no stone touches another. Both failed the same way underneath: **a bounding
box is not a silhouette.** The animal box is topped by a hunt marker floating a
half-metre clear of the beast, so the herd measures as the tallest family on the
bench and photographs as the airiest; the settler box is as wide as an
outstretched arm and as full of gaps. This bench has met that instrument before —
the settler round found two poses sharing a box while their arms differed, and
read the four limb rotations instead.

So the crowding stays a look-loop judgement, which is what the columns brief above
already was, and this widens it rather than replacing it. Column count does not
change whether one model hides another at a fixed pitch; what it changes is how
many neighbours each model has. Twelve to a row is a single row that hides nothing
and is also twelve specks in a frame framed by a sphere. Two costs on opposite
sides of one question, and no number on the bench has yet been able to stand
between them. **Brief: shoot the piles, the trees and the settlers at two, three,
four and six to a row, and judge where a family stops reading as a lineup and
starts reading as a crowd — this is the same brief as the piles-at-three above,
and the pile frame is the worst crowd on the bench, so start there.** The
twenty-seven buildings are the most unequal set of heights this bench will ever
hold, so this wants settling before they arrive rather than after.

One smaller thing the round put right in passing. `show`'s doc said "every model
already has its feet at y = 0", which the settlers made false last round — a
walking settler bobs and a sleeping one is rolled onto its side and raised off
the turf. The layout was already an addition rather than an assignment, so
nothing was broken; a test now holds that it stays one, because the doc that
would have warned the next person had been wrong for a round.

**Built — the arrangement, 2026-09-10.** The stage again, answering the brief above.
There was no way to shoot it: `COLUMNS = 4` is a constant and the only frames the
loop could take were at four. So the count became an argument the whole way down —
`Stage.show` passes one to `placeGrid`, `main.ts` reads `?columns=` off the address,
and the sweep takes a comma list as a fourth argv and shoots the grid once per count.
It is a URL parameter and nothing else: no slider, not a recipe field, out of
`knobsFromSearch` and out of the paste, because it shapes the frame and no part of the
model. It is in the address for the one reason the address exists — a frame at three
to a row and a frame at four are different pictures of the same recipe, and a URL that
could not tell them apart would be a provenance that lies.

Twenty-four frames later, no family is worse at three than at four and two are much
better, so the constant was not merely unchecked — it was wrong for a third of the
bench. But there is no single number underneath it either: the trees and the piles want
three, the eight settlers want six, the herd wants four because four *is* one row for a
family of four, the grass does not care, and the stones read the same at three and at
four. That is the argument against ever writing a better `COLUMNS`. The count is a
property of the family, which is why it belongs on the address. **Brief: give each
bench its own count.** The numbers are decided, so that is wiring and not another
investigation — a `columns` on `Bench`, three families set away from four, `main.ts`
defaulting to it. It moves the shipped frame for three families, so last round's fill
numbers (tree 32, stack 28, settler 33) move with it and want re-reading rather than
re-fitting.

The round's other product is the number that finally survived being looked at, and it
came from asking a smaller question than the two thrown-out metrics did: at this
pitch, does any model on this bench ever touch another? No — not one pair, in any
family, at any count. The settler geometry sits up to 0.834 m off its own origin, a
sleeping settler being rolled onto its side, and the grid still clears because
`gridPitch` steps by the widest model's own size. So both earlier failures ran deeper
than "a bounding box is not a silhouette": **there was never a spacing fault to find.**
A world-space box test says clean for every family and a screen-space one says crowded
for every family, and neither can separate them, because what separates them is not
spacing. Every crowd on this bench is occlusion along the view ray — a barrel lying
across a crate is a barrel metres from that crate with the camera on the line between
them. The pin that came out of it is the first test to hold what `GAP` promises, and
the next person to see a crowded bench frame can stop looking for a spacing bug and go
and move the camera.

**Built — a count for each family, 2026-09-10.** The wiring the round before
decided. `Bench.columns` carries what its frames were judged at: the wood and the
piles at three, the eight settlers at six, and the stones, the grass and the herd
left at four, which is now what `COLUMNS` means — the count for a family that does
not name its own. `main.ts` takes the address first and the bench second, and puts
only the address's answer back in the address, because a bench's own count comes
back from `?model=` alone and stamping it would freeze today's number into a link
meant to show the shipped frame whatever it becomes.

The proof it reaches a browser and not only a test: every family's shipped grid
frame is now byte-identical to its arrangement frame at the chosen count — the
wood's to the one shot at three, the piles' to three, the settlers' to six, and the
other three to four, same SHA-1 file by file. Three of last round's fill numbers
moved with it and were re-read rather than re-fitted. The piles gained the four
points four was costing them and now sit at 32. The wood held at 32, because its
pitch is square and three-by-four frames almost exactly as four-by-three does. The
settlers gave up four and sit at 29, which is the one count on this bench chosen
against the fill: what is wrong with eight poses at four to a row is not their size
but which of them is behind which, and no amount of frame-filling fixes an arm
through a body.

Reading the shipped frames back found the thing this round is actually worth, and
it is not the counts. The wood's picture reads as a third sky across its top quarter
and mostly is not — the round after this one measured it properly and found 743 sky
pixels in 1.7 million, two wedges in the top corners, the rest of that dark band
being turf under the bench's fog. It was the same at four, so the arrangement did not
cause it either way. The bench lays
a 200 m square of turf under the subject; `fitDistance` stands the camera on the
line out of the subject's centre, so a wood four metres tall at its middle rides
the camera up with it while the pitch stays 27 degrees down, and the frame's two
top corners land 105 m out. A corner ray carries the horizontal half field as well
as the vertical one and leaves along the diagonal, where a square plane's edge is
nearest — the middle of that same top edge is still turf at 71 m, which is why the
rim shows in the corners and nowhere else. All six reaches are written down (35,
11, 105, 21, 25, 43), so the wood is one family over an edge the rest are nowhere
near. **Brief: widen the turf until no frame on this bench sees its edge, and shoot
the wood before and after.** It is one number in `stage.ts` and it is not a silent
edit, because it changes what is behind every tree in every frame two rounds are
compared across, and because a plane large enough to swallow twenty-seven buildings
is worth sizing once against the family that has not arrived yet rather than twice.

**Built — the turf, sized once, 2026-09-10.** The brief above, done: `GROUND` is 260.
Chosen against four measurements rather than up to the wood. It clears the wood's
105 m by a quarter again; it clears the widest twelve-grid of anything the game
actually has, which is a wood of `tree.b` at 86 m; it clears the twenty-seven
buildings that have not reached the bench yet, the widest of which is a dozen doors
at 50 m; and it clears every family on the bench with every slider dragged to the top
of its range, the widest of those being the grass at 117 m. The one thing it does not
clear is the wood with every slider at the top, which reaches 450 m — and that is not
a plane to widen, it is past this camera's own 400 m far plane, so the pin says so
rather than stopping short of it quietly. Widening costs two triangles: the sun's
shadow frustum and the sky dome follow the subject's centre, not the ground.

The frames, before and after, and the correction they forced. The wood's picture had
743 pale sky pixels in 1.7 million — two wedges in the top corners, eleven rows deep,
tapering from 162 pixels in the top row to two in the eleventh — and has none at all
now. Every other family's frame is the same picture: at most a hundred pixels moved
on the stones' shadow edges by up to 29 of 255, which is the shadow coordinate being
interpolated across a plane a third larger and is not something a reader would see.
The correction is that the round before called the top of that frame a third sky. It
is not. The measurement behind that number could not tell sky from turf gone dark,
and almost all of that band is turf.

**Which is the next brief, and it is a lighting one.** The turf goes dark because
`Viewport`'s constructor sets `THREE.Fog(0x223040, 40, 130)` and nothing on the bench
ever replaces it. The game replaces it every frame — `world-view.ts` reads
`SkyView.fogColor()` and `fogRange(world)` and writes both — so a bench frame hazes
toward a night-blue that the colony at noon never shows. Measured off the pixels at
the top of the wood's frame: (36, 51, 65), which is 0x223040 within rounding. That
contradicts the first paragraph of `stage.ts`, which says nothing in the file is a
lighting decision because the rig is the game's own. **Brief: sync the bench's fog
from its own sky the way `world-view.ts` does, and shoot all six before and after.**

**Built — the fog, one call for both, 2026-09-10.** The four lines the world view had
and the bench did not are now one method, `SkyView.applyFog(fog, world)`, and both
callers go through it. One call rather than a second copy for the same reason the
bench may not build its own assemblies: a bench keeping its own copy of the game's
lighting is a bench whose frames are not the game's frames. The bench world's sky
settles at `b6a18f`, near 40, far 339.41 — a clear day on a 192-cell map, see just
past the middle of it and fade out past its far corner — against the `0x223040`,
40, 130 that `Viewport`'s constructor leaves behind.

What it was worth, measured as how far into the haze the far corner of each family's
frame sits — from the eye and not from the origin, because fog is depth from the
camera and the camera stands a frame's whole distance back. The grass, the piles and
the herd never reach a 40 m near plane at all. The stones and the settlers graze it,
at 0.024 and 0.056. And the wood, the one frame on this bench with real distance in
it, has its far corner 138 m from the eye against a slate that stopped counting at
130 — so the top of that picture was raw night-blue with nothing of the ground left
in it, and is 0.328 of the way into a warm horizon now. The frames agree canvas by
canvas: eight of the twelve are pixel-identical between the sweeps, three more moved
by no more than 6 of 255 in a band along the top, and the twelfth is the wood's
twelve, which moved 726,323 pixels — 42 per cent of it — by up to 110.
Read back, the change is the dark navy band across the top third becoming turf
receding into pale warm green.

The round cost an afternoon to a second thing, which was not the change. The sweep
would not run: the page loaded, its scripts answered, and no animation frame ever
arrived, so `page.evaluate` hung for fifteen minutes and came back as a protocol
timeout that reads like a wedged renderer. On the GPU this Chrome takes its frames
from the display's vertical sync, and a Mac whose display has gone idle stops handing
them out — the harness now launches with `--disable-frame-rate-limit`, which is a
free-running frame source instead. 1 frame in seven seconds before, 58 a second
after, and the sweep re-shot under it is pixel-identical over every canvas.
[LOOK.md](LOOK.md)'s "What will bite" said this stall was the box and cleared on its
own; that entry has been corrected, because what it actually clears on is somebody
touching the keyboard.
Not folded into this round because the ground has already moved in these frames, and
two changes in one picture cannot be told apart.

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

**Built — trim that knows where its own table is, 2026-09-12.** The first trim in the
buildings to follow the body it sits on, and the round that says why three lifts had not
moved the bench any nearer a knob. Every decorated building here places its trim in world
coordinates that merely happen to line up with the shell underneath — the stove's firebox
door is at z = 0.44 because the stove's body half-depth is 0.43, and nothing in the code
says so. Drag a width and the body moves out from under its own trim. A recipe whose knob
produces a broken model is not a knob.

The games table is the smallest complete case: a top with three things standing on and
beside it. The chain was already in the numbers — the board's underside is exactly the
table's surface, a piece's underside exactly the board's top, a stool's centre exactly a
centimetre outside the top's edge. `GameRecipe`, `GAME_DEFAULT`, three geometry functions
that take the `TableRecipe` they stand on. The six pieces turned out to sit on a grid: their
spots are exactly six tenths and two tenths of the board's half-width, so they are held as
fractions and move with the board.

This round also needed a **new kind of pin**, and the distinction matters for every trim
round after it. A golden says *the parts are where they were*, which is necessary and not
sufficient, because the defect being fixed is invisible at the default — a literal 0.825 and
a derived `surface + thickness / 2` are the same number until something moves. So the parts
are also asserted to still meet each other on a table that was never drawn, none of whose
numbers appear in the trim. The mutation drill proves the two pins do different work:
reverting the board to its literal, or the spots to absolute, leaves every golden green and
is caught by the new pin alone.

**Built — the two walls, 2026-09-12.** Picked by counting rather than by guessing: 98
`pool` calls remain in `buildings.ts`, and the timber wall and the stone wall are five of
them with one composition — a square column with a coping slab lapped over the top. The
file had already said so; the stone wall's note has it as "the same silhouette as timber so
a mixed perimeter still reads as one wall". Both columns are square in plan, both copings
overhang equally in width and depth, and both seat the coping at exactly minus two
centimetres, lapped into the top of the column rather than set on it. They agree on nothing
else — 0.06 of overhang against 0.16, one with a plinth and one without — which is what
makes the two centimetres a family rather than a coincidence. `WallRecipe`, `WALL_DEFAULT`
and three geometry functions.

`stand` does two jobs: the stone wall's plinth is exactly the height its body is lifted by,
and the timber wall stands at zero and draws nothing. This is deliberately not
`ShellRecipe`, close as the two are — a machine's body is an `rbox` and a wall's is a plain
`box`, because the wall body keeps the exact box the sim collides with, and a flag to switch
the primitive would put a knob on the machines that nothing should ever turn. Nothing a
player sees moved; the cladding, the corner post and the masonry courses were left where
they were.

**Built — the two tables, 2026-09-12.** The second group out of its literals, chosen the
way the first was: the dining table and the games table were drawn eleven months apart, and
they are one object at two sizes. Every number that is a decision agrees — the slab is 0.08
thick and eased at 0.035 on both, both tops are square, and the legs stand 0.09 inside the
top's edge on both — while the width, the height and the taper are the only things that
differ. `buildings.ts` now has `TableRecipe`, `TABLE_DEFAULT` and two geometry functions,
and the four `pool` calls read out of the table.

`surface` is the field the others hang off, because it is the one number that is not the
modeller's: the dining table's 0.9 is `ITEM_REST`'s, where a hauled stack comes to rest on
it. The games table has no `ITEM_REST` entry, falls through to a `standHeight` of zero, and
so keeps its 0.81 as a literal — there is nothing in the sim to read. There is one `width`
and no `depth`, because `legs()` takes a single pitch for both axes and a rectangular top
would stand on a square frame.

Nothing a player sees moved, but this one was not free the way the shells were. The leg
height is the underside of the slab, and writing that as `surface - thickness` moves the
vertices at the *foot* of the leg: 0.9 − 0.08 is 0.8200000000000001 in a double, which is
far below what a float32 holds apart at the top of the leg and not below it at zero, where
the steps are eight orders finer. A probe written before the lift caught it; walking down
through the middle of the slab in two steps is exact for both tables, and the pin on the
legs' bounding box is `toBe` so that folding it back goes red. The census is unchanged and
correctly so, for the same reason as the shells: none of this is draggable yet.

**Built — the machine shells, 2026-09-10.** The first of the twenty-six buildings to come
out of its literals. The building grid stands all of them together, and the middle of that
frame is five upright box machines at one footprint and one height band — stove, cooler,
heater, generator, battery — with twenty-one one-offs around them. Their nine `pool` calls
were the same shape written five times, months apart, with forty-odd literals between them;
`buildings.ts` now has `ShellRecipe`, `SHELL_DEFAULT` and two geometry functions, and the
nine calls read out of the table.

Two fields are findings and not renames. Every lid overhangs its body by the same amount in
width as in depth, so an overhang is one number and not two; and no body's centre was ever
chosen, being half its own height above whatever its plinth stands it at, which makes
`stand` a field and `y` not one — the same number `tests/buildings-view.test.ts` was already
asserting as "a shell that starts a hand's width above the ground". The four lids' `seat`
values (+0.02, −0.01, 0.00, 0.00) stay a field: the cooler's two centimetres are filled by
the gasket plate in `cooler.vent` and the heater's overlap is what keeps its joint shut.

Nothing a player sees moved. The derived numbers differ from the literals by at most one or
two units in the last place of a double, which is some eight orders of magnitude under what
a `Float32Array` vertex holds, so all nine buffers are byte-identical — checked before the
lift was written, pinned after. The census is unchanged and correctly so: it counts benches
with a recipe, and the building bench still returns null because none of this is draggable
yet. Making it draggable needs the `covers` partition settled first, since a second
building bench would have to take its five names off the first.

**Built — what the sphere is actually for, 2026-09-10.** The arrangement question the
last round left was measured and closed without a change: five arrangements and four fits
against the eleven models that are still more than half hidden, and not one of them is
free. Opening the rows clears ten of the eleven and costs up to 80 per cent of every
model's size; laying the cells on the camera's own ground axes clears the herd's row
entirely, hides two more trees, and costs a quarter to a half everywhere. The eleven are
what this camera costs, not a grid nobody has thought of.

What came out of pricing them is a correction. `fitDistance` fits the bounding sphere and
its doc defended that with two properties: no aspect and no yaw. The first is true and is
worth a third of every grid frame, which an earlier round measured and chose to leave on
the table so that a frame is not a function of the window it was taken in. The second is
false. A sphere has no yaw but `Box3.setFromObject` does, and turning a family 45 degrees
frames it 8 to 34 per cent further off — the stones by a third, and by seventeen per cent
at fifteen degrees. It holds at 90 alone, where an axis-aligned box lands back on itself,
which is the only angle the old pin turned. And no bench turns a subject on the spot: the
wood's `twist` yaws a crown against its trunk, which is a change of shape, and the bench
drops the map's hashed whole-tree yaw on purpose. The claim was carrying an argument rather
than any weight. Corrected in place, pinned at four angles
and at the aspect below which the sphere crops, 0.804.

**Built — tallest at the back, 2026-09-10.** The arrangement question the buildings round
left, answered in `placeGrid` rather than on the building bench, because it was never a
question about the buildings. The camera stands above the grid and off its near corner, so
a nearer model stands in front of the one behind it; `gridPitch` steps by footprint and had
no opinion about height. `placeGrid` deals the cells by height now, tallest into the
furthest, and the models keep the order they arrived in.

Free, and that is why it and not the alternative. Spreading the rows far enough to clear a
2.60 m model at 27 degrees of elevation needs 3.26 times the pitch and costs 79 per cent of
every model's apparent size; sorting costs nothing and gains two per cent, the grid's box
narrowing as its widest models come off the edges. Across the seven benches' Generate
frames, seventeen of eighty-two models were more than half hidden behind a nearer one and
eleven are — and the buildings' four are none.

The eleven left are a footprint question, not a height one: ten of them are in the stone,
the wood and the stacks, whose models are all of a height (1.19, 1.00 and 1.10 to 1), and
the eleventh is one of four animals standing in a single row. `tests/forge-stage.test.ts`
carries the seven-family table, and it is where that round will be measured from.

The sort key is rounded to a millimetre, which is not fussiness. A box is measured by
subtracting its floor from its ceiling, and a metre-tall model standing 35 mm off the turf
measures 0.9999999999999999 — raw, a settler's bob decides where the settler stands.

**Built — the twenty-six buildings, 2026-09-10.** The family the census round named as
the only one left. The plan said they could not be looked at; the probe said they could,
and that seventeen of the twenty-six came out of `prototypes` wearing `ffffff`.

A building's colour is not written down anywhere — it is a hash of the cell it stands
on, and `assemble` writes it onto a cloned material from the first instance in the pool.
An empty pool never had a tint written, so its material stays the near-white it waits to
be multiplied by. The exporter has always known this and stands one of everything up
before reading anything off it; the bench did not. `standBuildings(world)` in `forge.ts`
does it now — one of every `BUILD_MENU` kind (twenty-seven of them, drawing twenty-six
models, since `stonewall` shares the wall's), powered, on a lattice three cells apart and
inset three from the map edge — called from `main.ts` **before** `prototypes`, which is
the whole fix and therefore the thing pinned.
Seventeen and not twenty-six because `benchWorld` lays a starter room: nine of them
already had an instance and looked right by accident, which is the pin's argument for
being a list of names rather than a count.

The bench has one field, the one that picks which building, and no recipe. `Bench.recipe`
returns `Recipe | null` and the paste block prints a sentence rather than an empty object.
That null is also what makes the sheet honest in the other direction: it now reads
**`42 of 42 assemblies on the bench, 16 with a recipe`**, because a bench that shows a
model without shaping it is coverage of the first kind and not the second, and fixing an
understatement by shipping an overstatement would be no fix at all.

Two bugs came out of the frames rather than the code. `drawGrid` started its run at the
seed in the box, which is right for a thousand-wide seed field and wrong for a field that
indexes a list — the settler bench has been asking for a ninth of eight poses since it
shipped, `SETTLER_POSES[k.pose!]!` handing the builder `undefined` behind an exclamation
mark. `gridSeeds` wraps inside the field's own range now. And the first version of that
wrap used `((v % w) + w) % w`, which is `3.7000000000000455` for the stone bench's
default seed and reshaded its whole grid; the pin on that line said `toBeCloseTo` and
went green. Both are in ROUND_NOTES.md.

What the frames say next is the arrangement: the twenty-six spread **47 to 1 in height**
(a wall is 2.60 m, a conduit is 0.05 m) against 3 to 1 in footprint, and `placeGrid` steps
by footprint. Four columns is already the fill-optimal count and gives up nothing, so this
is the settlers' problem one family larger — what is behind what — and not a fill problem.

**Built — an honest census, 2026-09-10.** The brief the animals round logged and four
rounds of sheets carried: `scripts/look/forge.mjs` printed "`N` of 42 assemblies on the
bench", and `N` was the number of *benches*. A bench is not a model — the wood is two
crown variants, the stack is eight files and there is no ninth, the herd is four
species — so six benches shape sixteen of the forty-two and the line understated by
nearly three to one.

`Bench` has a `covers` field now: which manifest entries this bench shapes, declared
where the bench is declared. The stack and the herd derive theirs from the same lists
their sliders index, so a ninth resource arrives on the bench and in the count at the
same moment. The grass declares none, and that is the finding rather than an omission
— a tuft's sway is a vertex program injected through `onBeforeCompile` and glTF has
nowhere to put one, so the exporter never writes a grass file. The index carries each
bench's list as `data-covers`, which is what the sweep reads, and a page that declares
none at all is told it is out of date rather than handed a zero.

The number the honest count produces is worth more than the correction. Sixteen of
forty-two is not a shortfall spread thinly over the game; the twenty-six that are left
are *all* buildings, every one of them a bare undotted name, because the dotted names
are exactly the families that come in variants and every one of those has a bench.
The pin says both halves and goes red two ways on purpose: a twenty-seventh building
says the bench fell further behind, and a fifth species or a ninth resource says a
family that has a bench grew past it.

The count is pinned in two places because neither can do it alone. `models/manifest.json`
is written by the export and `.gitignore` covers it, so `forge-recipes.test.ts` can only
pin the numerator — the roster, as literals, against the file that derives it. The
denominator lives in `export-models.test.ts`, where a real export already runs into a
temp directory: every name a bench claims has to be a file in it. A bench claiming
`stack.hides` passes the first and fails the second, which is the right way round.

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
