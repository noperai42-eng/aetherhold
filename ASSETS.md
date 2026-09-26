# Taking Aetherhold's models somewhere else

Everything the colony is made of — the settlers, the fauna, the twenty-seven
buildings, the eight kinds of pile that pool on the ground, the trees — is
authored in code, in `src/client/render/`, as merged and dyed `BufferGeometry`
with an ambient-occlusion pass baked into its vertex colours. That is a good way
to build a game and a bad way to share one. This document is the bridge: one
command turns the whole set into ordinary `.glb` files that any engine, any
editor and any other project can open, and the rest of this page says what is in
them and what is not.

```bash
npm run export:models              # writes models/
npm run export:models -- somewhere # or writes somewhere/
```

It takes a few seconds, needs no browser and no GPU — it runs the real renderer
against a real seeded valley under Node — and it prints what it wrote:

```
models: 42 models, 35 kinds mapped, 54668 triangles, 5742 KiB
heaviest: settler 2800, animal.mossback 2474, animal.fenwolf 2418, ...
```

`models/` is git-ignored on purpose. The models are generated from the renderer,
so a checked-in copy is a copy that is wrong the first time somebody improves a
stove; re-run the command instead of vendoring the output, and if you must vendor
it, vendor `manifest.json` alongside so you can tell which export you have.

## What you get

| Family | Files | Triangles | Size |
| --- | --- | --- | --- |
| Buildings | 27 | 35,972 | 4.5 MiB |
| Resource piles | 8 | 3,476 | 460 KiB |
| Trees | 2 | 2,968 | 106 KiB |
| People and fauna | 5 | 12,252 | 526 KiB |
| **Total** | **42** | **54,668** | **5.6 MiB** |

The smallest model is 144 triangles (`stack.assemblies`); the largest is 2,800
(`settler`). Nothing here is a scanned asset — these are hand-built low-poly
shapes that have been through eleven rounds of a look loop, so they are cheap in
the way a stylised model is cheap and detailed in the way a considered one is.

The files are uncompressed and un-indexed, which is why 54,668 triangles come to
5.6 MiB. If size matters to you, run the set through `gltfpack` or
`gltf-transform optimize` — indexing and Draco typically take about 80% off, and
nothing here depends on the vertex layout.

## The conventions every file follows

**One unit is one colony tile**, and the scale reads as roughly a metre: a
settler is 1.67 units tall, a wall 2.60, a tree 4.50, a pile of logs 0.34.

**Y is up, and every model's feet are at y = 0.** Not approximately — the
exporter measures each model and pins it there, including the pawns, which are
cloned mid-stride and would otherwise land a few millimetres out depending on
which frame of the walk they were caught on. Drop a model at a position and it
stands on the floor.

**Every part is named after the part it is.** A stove arrives as `stove.feet`,
`stove.body`, `stove.door`, `stove.vents`, `stove.flue`, `stove.plate`; a settler
as `torso`, `neck`, `belt`, `head`, `hair`, `eye`, `eye`, `leg`, `boot`, `leg`,
`boot`, `arm`, `hand`, `arm`, `hand`, plus the `stock` and `action` of the rifle
they are carrying. The parts keep their own local transforms, so a pawn is a
usable rig: rotate the node called `arm` and the arm swings.

The name is on the **node**, not on the mesh or the material — `meshes[].name` and
`materials[].name` are null throughout, which is what `GLTFExporter` writes. Every
loader that maps a glTF node onto a scene object carries the name across, so in
three.js `root.getObjectByName('arm')` finds it and in Blender it is the object
name in the outliner; only code reading the glTF JSON by hand has to know to look
at `nodes[]`. Buildings, piles and trees are named right through. The things that
move are not quite: a settler carries two unnamed nodes and an animal nine, which
are the rig's own pivots — the group a rifle hangs from, the joint a leg swings
about — plus the wrapper the exporter puts under each root so the model's own
translation survives the trip. They are unnamed because they are not parts. Walk
past them; the parts hang underneath.

**Materials are metallic-roughness with no textures at all.** Colour, roughness
and metalness are the whole surface. That means no image files to lose, no atlas
to pack, and no licensing question about a texture — but it also means these
models want a lit scene. Give them a directional light and something ambient
(a hemisphere light or an environment map) or they will read as flat shapes.

**Contact shadows travel in `COLOR_0`.** The soft darkening where a bed meets the
floor and where a flue meets a stove top is baked ambient occlusion, exported as
a vertex-colour attribute. Any loader that honours `COLOR_0` gets it for free and
should multiply it into the base colour; a renderer that ignores vertex colours
will show a correct but slightly flatter model. Pawns and animals have no
`COLOR_0` — they move, so the game shades them with a real shadow instead.

**Colours are the colours the game paints.** They are read out of the live
instance tints at export time rather than re-derived from a palette, so a trunk
is the brown the trunk actually is. Two consequences worth knowing: a building
that was damaged or unpowered would export dulled, so the exporter stands
everything undamaged and switches the power on; and a part that had no instance
standing at export time — an unlit campfire has no flame — wears its family's
colour instead of its own. Those are listed in the manifest under `borrowed`, so
you can check rather than guess. In the current export they are `fence.stub`,
`fire.embers` and `fire.flame`.

## Loading them

In three.js, nothing special is required:

```js
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const { scene: stove } = await loader.loadAsync('/models/stove.glb');
stove.position.set(4, 0, 7);           // feet land on the floor
world.add(stove);
```

`GLTFLoader` sets `vertexColors` on the materials by itself when `COLOR_0` is
present, so the baked occlusion arrives without a line of setup. The models cast
and receive shadows well; turn both on if your scene has a shadow map.

Elsewhere:

- **Blender** — `File → Import → glTF 2.0`. Vertex colours land as a colour
  attribute named `Col`; the Principled BSDF does not read it automatically, so
  wire the attribute into base colour through a Multiply if you want the baked
  shading.
- **Godot 4** — drop the `.glb` into the project. Vertex colours need
  `vertex_color_use_as_albedo` enabled on the material to show up.
- **Unity** — the built-in importer does not read glTF; use glTFast or
  UnityGLTF, and note that URP/HDRP Lit does not consume vertex colours without a
  Shader Graph that samples them.
- **Anything else** — these are plain glTF 2.0 binary files: metallic-roughness
  materials, no textures, no skins, no animations. The one extension anywhere in
  the set is `KHR_materials_emissive_strength`, on the handful of things that
  glow, and it degrades on its own — a loader that has never heard of it reads
  the plain emissive factor and gets a slightly dimmer lamp. If it opens a
  `.glb`, it opens these.

## The manifest

`manifest.json` sits beside the models and is the part you should read from code
rather than eyeballing the directory:

```json
{
  "seed": 4242,
  "models": {
    "stove": {
      "file": "stove.glb",
      "parts": ["stove.feet", "stove.body", "stove.door", "..."],
      "borrowed": [],
      "triangles": 1344,
      "bytes": 184780
    }
  },
  "kinds": {
    "stove": ["stove"],
    "stonewall": ["stone", "wall"],
    "wood": ["stack.wood"]
  }
}
```

`kinds` is the interesting half: it maps every buildable kind and every resource
to the models it is drawn from, and it is **measured, not declared** — the
exporter stands one kind at a time and records which prototypes appeared. That is
why `stonewall` names two files: a stone wall's corner quoins come out of the
same pool as a wooden wall's corner posts, which is true, easy to forget, and
would have been wrong in any table maintained by hand.

## What is deliberately not in here

- **Terrain.** The ground is a single generated mesh coloured per cell from the
  season and the biome. Exporting it would export one particular valley, which is
  a map, not an asset.
- **Grass and ground scatter.** The tufts sway, and the sway is a vertex program
  injected into the material at compile time. glTF has nowhere to put a vertex
  program, so exporting a blade would hand you a stiff green dart and call it
  grass. If you want the effect, port the shader; the geometry alone is not it.
- **Faces and hair strands.** A settler's brows, eye whites, mouth, beard, moustache,
  stubble, freckles, age lines, hair strands, locks, their relief, sheen and parting are painted by a fragment
  program (`src/client/render/face.ts`), not modelled, and so are the eyeballs on the eye
  beads, so an exported `head` is plain skin with its nose and its chin and its eyes are plain flattened lenses,
  and an exported `hair` is its colour with darker ends baked into the vertex
  colours. The export has one settler, so it carries one of the four cuts.
- **Effects.** Smoke, fire glow, muzzle flashes and weather are billboards and
  canvas-drawn textures built at runtime, and none of them are models.
- **Landmarks.** The four survey props are close cousins of the scatter stones
  and are not named in the renderer yet, which is the only thing standing between
  them and this list — see below.
- **Animation.** The rigs are exported as one pose. The game animates by writing
  transforms every frame rather than by playing clips, so there is nothing to
  convert; what you get instead is a named hierarchy you can animate yourself.

## Adding something to the export

The exporter finds prototypes by walking a view's group and reading
`geometry.name`, so an unnamed geometry is an invisible one. To add a family:

1. Give each geometry a dotted key when its pool is made — `thing.body`,
   `thing.lid` — the same way `buildings.ts` does. Parts sharing a prefix become
   one file.
2. If it is not a `BuildingsView` pool, add the view to `exportModels` in
   `src/tools/models.ts` next to the two that are there.
3. If the prefix rule would group it wrongly — as it would for the two tree crown
   variants, which are alternatives rather than parts — say so in `assemblyOf`.
4. Run `npx vitest run tests/export-models.test.ts`. The tests open the written
   files and check the manifest against them, so a family that exported as an
   empty node fails rather than passing quietly.

## Where the models come from, if you want to change them

Read [LOOK.md](LOOK.md) before editing geometry. Everything a player sees in this
project is changed through a loop that photographs the same sixteen frames before
and after and judges the pictures, and the models in this export are the output of
eleven of those rounds. [ARCHITECTURE.md](ARCHITECTURE.md) says where the render
code lives; the round log, kept in the box, says what each round changed and why.
