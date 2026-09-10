/**
 * What the bench can shape, and what it is allowed to be asked for.
 *
 * A bench entry is the same three things Evergrow's `forge-model.ts` is: the
 * knobs a shape has, the rules a set of knob values has to keep, and the call
 * into the game's own builder. It is deliberately not a fourth copy of the
 * geometry — `stoneGeometry` and `treeTrunkGeometry` live beside the constants
 * that argue for their numbers, in `src/client/render/`, and this file imports
 * them the way the renderer does. A bench that built its own trees would be a
 * bench that agrees with the game right up until somebody changed one of them.
 *
 * Only numbers are knobs here. A recipe also carries tables — the tree's lathe
 * profiles, the tuft's five blades — and a table is not draggable on a slider;
 * it is what the JSON paste in stage 3 of [FORGING.md](../../FORGING.md) is for.
 * They are still validated, because a profile that runs downhill is the one way
 * to hand `lathe` something it cannot turn, and validating a field nobody can
 * yet edit is cheaper than finding out later that nobody ever checked it.
 */

import * as THREE from 'three';

import {
  PILE_DEFAULT,
  TREE_DEFAULT,
  TREE_SKIRTS,
  stackLift,
  stackRise,
  stackSize,
  treeSkirtGeometries,
  treeTrunkGeometry,
  type PileRecipe,
  type Profile,
  type TreeRecipe,
} from '../client/render/buildings';
import {
  GRASS_ROOT,
  GRASS_TIP,
  STONE_COLOR,
  STONE_DEFAULT,
  STONE_ROUGHNESS,
  SWAY_DEFAULT,
  TUFT_DEFAULT,
  grassMaterial,
  hash,
  stoneGeometry,
  tuftGeometry,
  type StoneRecipe,
  type SwayRecipe,
  type TuftRecipe,
} from '../client/render/decor';
import { colorOf, occludeParts } from '../client/render/occlusion';
import {
  ANIMAL_DEFAULT,
  SETTLER_DEFAULT,
  animalFittings,
  animalGrowth,
  assembleAnimal,
  assembleSettler,
  growAnimal,
  poseLegs,
  settlerGeometry,
  settlerPose,
  speciesModels,
  thumbLimit,
  type AnimalRecipe,
  type SettlerRecipe,
} from '../client/render/pawns';
import { ANIMAL_KINDS, RESOURCE_KINDS } from '../sim/types';
import type { Faction, Pawn, PawnActivity } from '../sim/types';
import { ANIMALS } from '../sim/wildlife';

/** One draggable number, with the range outside which it stops being that shape. */
export interface Field {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Whether a fraction of one is meaningless here — a count of meridians. */
  readonly whole?: boolean;
}

/** A recipe as the page holds it: every numeric field, and nothing else. */
export type Knobs = Readonly<Record<string, number>>;

/**
 * The renderer's own prototypes, keyed by pool key.
 *
 * A bench entry takes its material from here rather than making one, so a bench
 * tree is the colour, the roughness and the shadow flags of the tree in the
 * valley. `forge.ts` gathers it off a `BuildingsView`, which is why the grass
 * entry below is handed an empty-looking map and makes its own: a tuft belongs
 * to `DecorView` and was never in these pools.
 */
export type Prototypes = ReadonlyMap<string, THREE.Mesh>;

export interface Bench {
  /** The `?model=` value. */
  readonly name: string;
  readonly title: string;
  /** One line on what this is and what it is worth looking at for. */
  readonly note: string;
  readonly fields: readonly Field[];
  /** The recipe the colony builds from today, as knobs. */
  readonly defaults: Knobs;
  /** Which field a new seed lands on, so `Random seed` means something here. */
  readonly seedKey: string;
  /**
   * How far apart the twelve seeds of a grid stand.
   *
   * Not one, and the wood is the reason. A crown seeds its four skirts at
   * `i + 1 + crownSeed`, so two crowns a single step apart share three of their
   * four outlines — which is why `treeCrown` puts the wood's two variants
   * sixty-one apart rather than next to each other. A grid of twelve whose
   * neighbours are three-quarters the same shape is a grid that says the recipe
   * has less variety in it than it has.
   */
  readonly seedStep: number;
  /**
   * How many the grid lays out, when twelve is the wrong number for this family.
   *
   * Left off by everything that has a seed in it, because a seed has no last
   * value and twelve draws from it is a sample. The stacks are the exception:
   * there are eight of them and there is no ninth, so a grid of twelve would
   * photograph three of the eight twice and say the family is bigger and less
   * even than it is.
   */
  readonly grid?: number;
  /** Everything wrong with this set of values, in words. Empty is buildable. */
  problems(k: Knobs): string[];
  /**
   * The whole recipe these knobs describe, in the shape the render file's
   * default table is written in — the lathe profiles and all, not just the
   * numbers that happened to be draggable. This is what the paste block under
   * the sliders prints, so what it offers is a recipe you can put back rather
   * than a list of the eleven fields the page knows how to show you.
   */
  recipe(k: Knobs): StoneRecipe | TreeRecipe | GrassRecipe | PileRecipe | AnimalRecipe | SettlerRecipe;
  /** The model, standing on y = 0 and facing the way the game draws it. */
  build(k: Knobs, protos: Prototypes): THREE.Group;
}

/** Whatever the sliders cannot say — a field out of range or not a number. */
function boundsProblems(fields: readonly Field[], k: Knobs): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const v = k[f.key];
    if (v === undefined) {
      out.push(`${f.key} is missing`);
      continue;
    }
    if (!Number.isFinite(v)) {
      out.push(`${f.key} is not a number`);
      continue;
    }
    if (v < f.min || v > f.max) out.push(`${f.key} is ${v}, outside ${f.min}..${f.max}`);
    if (f.whole && !Number.isInteger(v)) out.push(`${f.key} is ${v}, and half a ${f.label} is nothing`);
  }
  return out;
}

/**
 * What a profile has to be for a lathe to turn it into the thing it is named
 * after.
 *
 * Two rules hold for every profile. Fewer than two points is not a line and
 * `LatheGeometry` has nothing to revolve; a negative radius is a point on the
 * far side of the axis, which turns that band of the surface inside out and
 * renders as a shape with its lit face pointing in rather than as an error.
 *
 * `rising` is the third rule and it is deliberately not universal, because the
 * first draft of this file made it universal and the test caught it. A bole is
 * an open profile from the ground up and its heights only climb. A skirt of
 * boughs is a closed bowl: it runs out and *down* along the underside of the
 * branches, round the tip, and back up and in over the top — every one of the
 * wood's four skirts doubles back, and a rule that called that an error would
 * have refused to build the tree the colony has been growing for eleven rounds.
 */
function profileProblems(what: string, p: Profile, rising: boolean): string[] {
  if (p.length < 2) return [`${what} has ${p.length} points, and two is the fewest that turn`];
  const out: string[] = [];
  for (let i = 1; i < p.length; i++) {
    if (rising && p[i]![1] < p[i - 1]![1]) {
      out.push(`${what} runs downhill at point ${i}: ${p[i - 1]![1]} then ${p[i]![1]}`);
    }
    if (p[i]![0] < 0) out.push(`${what} has a negative radius at point ${i}`);
  }
  return out;
}

const STONE_FIELDS: readonly Field[] = [
  { key: 'seed', label: 'seed', min: 0, max: 999, step: 0.1 },
  { key: 'detail', label: 'subdivision', min: 0, max: 3, step: 1, whole: true },
  { key: 'lump', label: 'lump', min: 0, max: 0.9, step: 0.01 },
  { key: 'faceSpread', label: 'face spread', min: 0, max: 0.6, step: 0.005 },
  { key: 'sink', label: 'sink', min: 0, max: 0.6, step: 0.01 },
];

function stoneRecipe(k: Knobs): StoneRecipe {
  return { seed: k.seed!, detail: k.detail!, lump: k.lump!, faceSpread: k.faceSpread!, sink: k.sink! };
}

const STONE: Bench = {
  name: 'stone',
  title: 'Loose stone',
  note: 'A piece of something that broke, lying on the turf. Twenty flat faces and a tone on each.',
  fields: STONE_FIELDS,
  defaults: { ...STONE_DEFAULT },
  seedKey: 'seed',
  // Every vertex of a stone is moved by one hash of the seed, so a whole step
  // is already a different lump.
  seedStep: 1,
  problems(k) {
    // Every field of a stone is independent of every other one, so there is no
    // cross-field rule to state and none is invented here. The tree below has
    // two, and the difference between the two entries is the honest answer to
    // "what does validation catch" rather than a symmetry for its own sake.
    return boundsProblems(STONE_FIELDS, k);
  },
  recipe: stoneRecipe,
  build(k, _protos) {
    const r = stoneRecipe(k);
    const geo = stoneGeometry(r);
    // The view's material is a white multiplied by a per-instance tint that
    // wanders in hue, saturation and lightness about `STONE_COLOR`. At the
    // middle of all three hashes the tint is `STONE_COLOR` exactly, so this is
    // the median stone of the field rather than a colour picked for the bench.
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: STONE_COLOR, roughness: STONE_ROUGHNESS, vertexColors: true }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Bedded by the same rule the scatter uses — a fraction of the stone's own
    // radius — and otherwise left alone. The field also squashes each stone on
    // three hashed axes and tips it up to fifty degrees, and neither is applied
    // here: the bench is judging the shape, and a shape that arrives at a
    // different angle every time cannot be compared with the one before it.
    geo.computeBoundingSphere();
    mesh.position.y = geo.boundingSphere!.radius * r.sink;
    const group = new THREE.Group();
    group.name = 'stone';
    group.add(mesh);
    return group;
  },
};

const TREE_FIELDS: readonly Field[] = [
  { key: 'crownSeed', label: 'crown seed', min: 0, max: 999, step: 1, whole: true },
  { key: 'trunkSeg', label: 'trunk meridian', min: 3, max: 64, step: 1, whole: true },
  { key: 'rootReach', label: 'root reach', min: 0, max: 0.8, step: 0.005 },
  { key: 'rootRise', label: 'root rise', min: 0.02, max: 2.5, step: 0.01 },
  { key: 'skirtSeg', label: 'skirt meridian', min: 3, max: 64, step: 1, whole: true },
  { key: 'lobe', label: 'lobe', min: 0, max: 0.6, step: 0.005 },
  { key: 'topLobeScale', label: 'leader lobe', min: 0, max: 2, step: 0.01 },
  { key: 'size', label: 'size', min: 0.4, max: 2, step: 0.01 },
  { key: 'girth', label: 'girth', min: 0.4, max: 2, step: 0.01 },
  { key: 'lean', label: 'lean', min: 0, max: 0.6, step: 0.005 },
  { key: 'twist', label: 'twist', min: 0, max: 3.2, step: 0.01 },
];

/** A tree's own x axis, which is what `BuildingsView` leans it about. */
const LEAN_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function treeRecipe(k: Knobs): TreeRecipe {
  return {
    ...TREE_DEFAULT,
    crownSeed: k.crownSeed!,
    trunkSeg: k.trunkSeg!,
    rootReach: k.rootReach!,
    rootRise: k.rootRise!,
    skirtSeg: k.skirtSeg!,
    lobe: k.lobe!,
    topLobeScale: k.topLobeScale!,
    size: k.size!,
    girth: k.girth!,
    lean: k.lean!,
    twist: k.twist!,
  };
}

const TREE: Bench = {
  name: 'tree',
  title: 'Tree',
  note: 'A bole with buttresses and four lobed skirts of boughs, each turned past the one below it.',
  fields: TREE_FIELDS,
  defaults: {
    crownSeed: TREE_DEFAULT.crownSeed,
    trunkSeg: TREE_DEFAULT.trunkSeg,
    rootReach: TREE_DEFAULT.rootReach,
    rootRise: TREE_DEFAULT.rootRise,
    skirtSeg: TREE_DEFAULT.skirtSeg,
    lobe: TREE_DEFAULT.lobe,
    topLobeScale: TREE_DEFAULT.topLobeScale,
    size: TREE_DEFAULT.size,
    girth: TREE_DEFAULT.girth,
    lean: TREE_DEFAULT.lean,
    twist: TREE_DEFAULT.twist,
  },
  seedKey: 'crownSeed',
  seedStep: 61,
  problems(k) {
    const out = boundsProblems(TREE_FIELDS, k);
    const r = treeRecipe(k);
    // The two structural rules. The first is the lathe's; the second is the
    // view's, and it is the one that would otherwise crash: the draw asks for
    // `skirts[i]` for every name in `TREE_SKIRTS`, so a recipe with three
    // profiles in it hands `pool()` an undefined geometry.
    out.push(...profileProblems('the trunk profile', r.trunk, true));
    r.skirts.forEach((p, i) => out.push(...profileProblems(`skirt ${i + 1}`, p, false)));
    if (r.skirts.length !== TREE_SKIRTS.length) {
      out.push(`${r.skirts.length} skirt profiles for the ${TREE_SKIRTS.length} skirts the wood is drawn from`);
    }
    return out;
  },
  recipe: treeRecipe,
  build(k, protos) {
    const r = treeRecipe(k);
    const trunk = treeTrunkGeometry(r);
    const skirts = treeSkirtGeometries(r);
    const parts = [trunk, ...skirts];
    // The contact shadow, baked the way `queueOcclusion` bakes the wood's own:
    // the whole tree in one call, against a ground at y = 0 in the prototype's
    // own space. Without it a bench tree is the game's tree lit from one light
    // fewer, which is exactly the difference the eye reads as "the bench looks
    // different" and then spends a round chasing.
    for (const g of parts) colorOf(g);
    occludeParts(parts, { ground: true, groundY: 0 });

    const group = new THREE.Group();
    group.name = 'tree';
    const lean = new THREE.Quaternion().setFromAxisAngle(LEAN_AXIS, r.lean);
    const spin = new THREE.Quaternion();
    // A mature tree, so the growth scale the draw multiplies in is one and what
    // is left is the tree's own size. The hashed yaw is not applied: on the map
    // it decides which way the lean falls, and on a bench with a fixed camera
    // that would hide the lean behind the trunk on some seeds and not others.
    const put = (key: string, geo: THREE.BufferGeometry, q: THREE.Quaternion): void => {
      const proto = protos.get(key);
      if (!proto) throw new Error(`no ${key} prototype in the renderer's pools — nothing stood in it to be read`);
      const mesh = new THREE.Mesh(geo, proto.material);
      mesh.name = key;
      mesh.castShadow = proto.castShadow;
      mesh.receiveShadow = proto.receiveShadow;
      mesh.quaternion.copy(q);
      mesh.scale.set(r.size * r.girth, r.size, r.size * r.girth);
      group.add(mesh);
    };
    put('tree.trunk', trunk, lean);
    for (let i = 0; i < skirts.length; i++) {
      spin.setFromAxisAngle(UP, r.twist * (i + 1));
      put(TREE_SKIRTS[i] ?? `tree.skirt${i}`, skirts[i]!, lean.clone().multiply(spin));
    }
    return group;
  },
};

/**
 * Grass is two recipes, and that is why this is a pair rather than one object.
 *
 * A tuft's shape is geometry and its sway is a material, and the two live in
 * `decor.ts` as two default tables — `TUFT_DEFAULT` and `SWAY_DEFAULT` — because
 * the colony builds one once and compiles the other once. The paste block prints
 * both under the names they go back to.
 */
export interface GrassRecipe {
  readonly tuft: TuftRecipe;
  readonly sway: SwayRecipe;
}

/**
 * Eighteen numbers, of which two are not the recipe at all.
 *
 * `time` and `wind` are the weather rather than the tuft, and they are on the
 * page for the reason [FORGING.md](../../FORGING.md) singles grass out for: a
 * blade of grass cannot be exported to `.glb` and does not sit still, so the
 * eight numbers in the gust have never been visible anywhere. A slider that
 * scrubs time is the only way to look at them. They stay out of `recipe()`,
 * because what you paste back into `decor.ts` is a tuft and a wind, not an
 * afternoon.
 *
 * The blade table is not here either, for the same reason the tree's profiles
 * are not: five rows of eight numbers is a table, not a slider. It rides in the
 * paste.
 */
const GRASS_FIELDS: readonly Field[] = [
  { key: 'seed', label: 'seed', min: 0, max: 999, step: 1, whole: true },
  { key: 'segments', label: 'blade row', min: 1, max: 6, step: 1, whole: true },
  { key: 'tipReach', label: 'tip reach', min: 0, max: 1, step: 0.01 },
  { key: 'skyward', label: 'skyward normal', min: 0, max: 2, step: 0.01 },
  { key: 'height', label: 'height', min: 0.05, max: 1.2, step: 0.01 },
  { key: 'heightSpread', label: 'height spread', min: 0, max: 0.6, step: 0.005 },
  { key: 'girthBase', label: 'girth', min: 0.05, max: 1.5, step: 0.01 },
  { key: 'girthSpread', label: 'girth spread', min: 0, max: 1, step: 0.01 },
  { key: 'gust', label: 'gust', min: 0, max: 1, step: 0.005 },
  { key: 'gustRate', label: 'gust rate', min: 0, max: 6, step: 0.01 },
  { key: 'ripple', label: 'ripple', min: 0, max: 1, step: 0.005 },
  { key: 'rippleRate', label: 'ripple rate', min: 0, max: 6, step: 0.01 },
  { key: 'rippleSkew', label: 'ripple skew', min: 0, max: 4, step: 0.01 },
  { key: 'phaseX', label: 'phase east', min: 0, max: 3, step: 0.01 },
  { key: 'phaseZ', label: 'phase south', min: 0, max: 3, step: 0.01 },
  { key: 'lateral', label: 'lateral', min: 0, max: 2, step: 0.01 },
  { key: 'time', label: 'time', min: 0, max: 12, step: 0.05 },
  { key: 'wind', label: 'wind', min: 0, max: 3, step: 0.01 },
];

function grassRecipe(k: Knobs): GrassRecipe {
  return {
    tuft: {
      ...TUFT_DEFAULT,
      segments: k.segments!,
      tipReach: k.tipReach!,
      skyward: k.skyward!,
      height: k.height!,
      heightSpread: k.heightSpread!,
      girthBase: k.girthBase!,
      girthSpread: k.girthSpread!,
    },
    sway: {
      gust: k.gust!,
      gustRate: k.gustRate!,
      ripple: k.ripple!,
      rippleRate: k.rippleRate!,
      rippleSkew: k.rippleSkew!,
      phaseX: k.phaseX!,
      phaseZ: k.phaseZ!,
      lateral: k.lateral!,
    },
  };
}

const GRASS: Bench = {
  name: 'grass',
  title: 'Grass tuft',
  note: 'Five leaves of five lengths on five bearings, wrung about their own length. Scrub time to see the gust; every tuft in a grid takes the same one, because the phase is a function of where a tuft stands and nothing stands anywhere here.',
  fields: GRASS_FIELDS,
  defaults: {
    seed: 0,
    segments: TUFT_DEFAULT.segments,
    tipReach: TUFT_DEFAULT.tipReach,
    skyward: TUFT_DEFAULT.skyward,
    height: TUFT_DEFAULT.height,
    heightSpread: TUFT_DEFAULT.heightSpread,
    girthBase: TUFT_DEFAULT.girthBase,
    girthSpread: TUFT_DEFAULT.girthSpread,
    ...SWAY_DEFAULT,
    // One second in, which is near the top of the first gust. Zero is the
    // obvious default and it is the wrong one: at t = 0 both sines are zero, so
    // the bench would open on a dead-straight tuft and the eight numbers under
    // it would look like they did nothing.
    time: 1,
    // The still day `DecorView` starts its uniform on.
    wind: 1,
  },
  seedKey: 'seed',
  // A whole cell along. The seed is fed to the scatter's own hash as an x, and
  // two neighbouring cells are already two unrelated draws.
  seedStep: 1,
  problems(k) {
    const out = boundsProblems(GRASS_FIELDS, k);
    const blades = grassRecipe(k).tuft.blades;
    // The one structural rule, and it is the geometry's: `mergeGeometries` of
    // nothing is null, and a blade with no length or no width is a row of
    // vertices on top of each other that `computeVertexNormals` cannot give a
    // direction to. Nothing here rules on taste — a blade leaning past forty-
    // five degrees is lying down, which the comments in `decor.ts` argue about
    // at length and which is exactly the kind of judgement the bench exists to
    // let somebody make with their eyes.
    if (!blades.length) out.push('a tuft with no blades in it is bare ground');
    blades.forEach((b, i) => {
      if (b.len <= 0) out.push(`blade ${i + 1} is ${b.len} long`);
      if (b.width <= 0) out.push(`blade ${i + 1} is ${b.width} across`);
    });
    return out;
  },
  recipe: grassRecipe,
  build(k, _protos) {
    const r = grassRecipe(k);
    // The one bench entry that makes its own material instead of reading one off
    // the renderer's pools, and the reason is the pools: `prototypes()` walks a
    // `BuildingsView`, and grass belongs to `DecorView`. `grassMaterial` *is* the
    // renderer's own factory, and it is the thing being shaped here anyway — the
    // eight numbers of the gust are compiled into the shader it returns.
    const mesh = new THREE.InstancedMesh(
      tuftGeometry(GRASS_ROOT, GRASS_TIP, r.tuft),
      grassMaterial({ value: k.time! }, { value: k.wind! }, r.sway),
      1,
    );
    mesh.name = 'decor.tuft';
    // Instanced with a count of one, and not a plain `Mesh`, because the sway is
    // inside `#ifdef USE_INSTANCING` — it reads which tuft it is off the instance
    // matrix. A plain mesh compiles without the branch and stands perfectly
    // still, which would have been a bench that quietly answered the one question
    // it was built to answer with "there is no wind".
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    // The height and girth the field would deal this seed, by the field's own
    // arithmetic and the field's own hash, on open turf where wear takes nothing.
    // The instance's hashed yaw and tip are left off for the reason the stone's
    // are: a shape that arrives at a different angle every time cannot be
    // compared with the one before it. So is the per-instance tint, which leaves
    // the median tuft — the root-to-tip gradient the geometry carries, and no
    // season over it.
    const girthDraw = hash(k.seed!, 0, 1.7);
    const heightDraw = hash(k.seed!, 0, 9.7);
    const h = r.tuft.height + (heightDraw - 0.5) * 2 * r.tuft.heightSpread;
    const girth = (r.tuft.girthBase + girthDraw * r.tuft.girthSpread) * h;
    mesh.setMatrixAt(
      0,
      new THREE.Matrix4().compose(
        new THREE.Vector3(),
        new THREE.Quaternion(),
        new THREE.Vector3(girth, h, girth),
      ),
    );
    mesh.instanceMatrix.needsUpdate = true;

    const group = new THREE.Group();
    group.name = 'grass';
    group.add(mesh);
    return group;
  },
};

/**
 * Eleven numbers, of which three are what is standing on the bench rather than
 * the recipe.
 *
 * `kind`, `amount` and `stacks` are the load — which of the eight it is, how
 * much is in one of them, and how many landed on the same cell — and they are
 * on the page because the eight numbers under them do nothing visible without
 * one. A step of 0.3 m is a number; a step of 0.3 m under a stack of hides
 * that is 0.344 m tall is a seam you can see, and you can only see it with
 * something standing on something.
 *
 * The shapes are not here at all, and that is the one thing this family is
 * different about. A stone has five numbers that move its vertices and a tuft
 * has seven; a stack of steel has a hundred and thirty literals inside
 * `ingots()` and none of them is a slider — the recipe of a pile is where its
 * stacks are put, not what they are made of. Which is exactly why the eight
 * shapes needed the golden digests this round added: nothing on this page can
 * change them, so nothing on this page would have caught them changing.
 */
const STACK_FIELDS: readonly Field[] = [
  { key: 'kind', label: 'kind', min: 0, max: RESOURCE_KINDS.length - 1, step: 1, whole: true },
  { key: 'amount', label: 'amount', min: 1, max: 99, step: 1, whole: true },
  { key: 'stacks', label: 'stacks', min: 1, max: 8, step: 1, whole: true },
  { key: 'step', label: 'step', min: 0.02, max: 1, step: 0.005 },
  { key: 'cap', label: 'pile cap', min: 0, max: 3, step: 0.01 },
  { key: 'small', label: 'handful', min: 0.1, max: 1, step: 0.01 },
  { key: 'smallTo', label: 'handful to', min: 0, max: 40, step: 1, whole: true },
  { key: 'fullFrom', label: 'full from', min: 1, max: 60, step: 1, whole: true },
  { key: 'liftStep', label: 'load lift', min: 0, max: 0.6, step: 0.005 },
  { key: 'liftEvery', label: 'load size', min: 1, max: 99, step: 1, whole: true },
  { key: 'liftMax', label: 'load cap', min: 0, max: 6, step: 1, whole: true },
];

function pileRecipe(k: Knobs): PileRecipe {
  return {
    step: k.step!,
    cap: k.cap!,
    small: k.small!,
    smallTo: k.smallTo!,
    fullFrom: k.fullFrom!,
    liftStep: k.liftStep!,
    liftEvery: k.liftEvery!,
    liftMax: k.liftMax!,
  };
}

const STACK: Bench = {
  name: 'stack',
  title: 'Loose stack',
  note: 'A kind of thing dropped on the ground, and the pile the next of them lands on. Generate 8 stands the whole family side by side, which is the only way to see whether the eight agree about how tall a stack is.',
  fields: STACK_FIELDS,
  defaults: {
    // Wood, ten of it, three deep. Ten because that is where `stackSize` tops
    // out, so the stack on the bench is the full-size one the digests measure
    // rather than a handful of it; three because the fault this bench was built
    // to show is a seam between two stacks, and one stack has no seam.
    kind: 0,
    amount: 10,
    stacks: 3,
    ...PILE_DEFAULT,
  },
  seedKey: 'kind',
  // One kind along. There is nothing hashed here to spread out — the eight are
  // eight hand-built shapes in a list, and the next one is the next one.
  seedStep: 1,
  grid: RESOURCE_KINDS.length,
  problems(k) {
    const out = boundsProblems(STACK_FIELDS, k);
    // The one cross-field rule, and it is a division: `stackSize` ramps from
    // `small` to full across the gap between the two, so a gap of nothing is a
    // zero denominator and a size of Infinity, which scales a stack to a shape
    // with no bounding box that the camera then tries to frame.
    if (k.fullFrom !== undefined && k.smallTo !== undefined && k.fullFrom <= k.smallTo) {
      out.push(`full from ${k.fullFrom} is not above handful to ${k.smallTo}, and the ramp between them has no width`);
    }
    return out;
  },
  recipe: pileRecipe,
  build(k, protos) {
    const r = pileRecipe(k);
    const kind = RESOURCE_KINDS[k.kind!]!;
    const key = `stack.${kind}`;
    const proto = protos.get(key);
    if (!proto) throw new Error(`no ${key} prototype in the renderer's pools — nothing stood in it to be read`);

    // The view's own arithmetic, called rather than copied. What a bench is for
    // is finding out that the step and the shapes disagree, and a bench that
    // worked out the step for itself could only ever find out that it disagreed
    // with itself.
    const size = stackSize(k.amount!, r);
    const lift = stackLift(k.amount!, r);
    const rise = stackRise(k.amount!, r);

    const group = new THREE.Group();
    group.name = 'stack';
    // Resting on the bench floor rather than on `itemRest`, which on the map is
    // the top of whatever furniture the cell holds. There is no furniture here
    // and no snowpack, so the ground is the plane and the cap counts from it.
    let base = 0;
    for (let i = 0; i < k.stacks!; i++) {
      const mesh = new THREE.Mesh(proto.geometry, proto.material);
      mesh.name = key;
      mesh.castShadow = proto.castShadow;
      mesh.receiveShadow = proto.receiveShadow;
      mesh.position.y = base;
      mesh.scale.set(size, size * lift, size);
      group.add(mesh);
      base = Math.min(r.cap, base + rise);
    }
    return group;
  },
};


/**
 * The one coat every animal on this bench wears.
 *
 * `hideTint` spreads a species' colour over its seeds, and a bench that let the
 * seed follow the species would put four colours in a grid whose whole job is to
 * say four sizes. One seed, so the only thing that differs across the four is
 * the animal.
 */
const ANIMAL_SEED = 7;

/**
 * The herd's knobs. Three of them are the load rather than the recipe — which
 * species, where in its stride it is, and how grown it is — the way the grass
 * bench's `time` and `wind` are the weather and not the tuft. `size` is
 * deliberately not here: it lives in `ANIMALS`, it is the sim's number and not
 * the renderer's, and a grid of four at their own sizes is the only picture
 * that says how big these animals are beside each other.
 */
const ANIMAL_FIELDS: readonly Field[] = [
  { key: 'species', label: 'species', min: 0, max: ANIMAL_KINDS.length - 1, step: 1, whole: true },
  { key: 'phase', label: 'stride', min: 0, max: 6.28, step: 0.01 },
  { key: 'grown', label: 'grown', min: 0, max: 1, step: 0.01 },
  { key: 'fittings', label: 'collar and mark', min: 0, max: 1, step: 1, whole: true },
  { key: 'swing', label: 'leg swing', min: 0, max: 1.5, step: 0.01 },
  { key: 'calf', label: 'newborn', min: 0.05, max: 1, step: 0.01 },
  { key: 'collarR', label: 'collar cut', min: 0.02, max: 0.4, step: 0.005 },
  { key: 'markClearance', label: 'mark air', min: 0, max: 1, step: 0.005 },
];

/**
 * The widest throat on the map, worked out once and kept.
 *
 * `speciesModels()` builds all four species' geometry to hand back four records,
 * and the only thing this question needs off it is one number that cannot change
 * while the page is open. Asking it inside `problems` would build a herd on
 * every draw and then build a second one in `build` to keep one animal out of
 * it.
 */
let throat = 0;
function widestThroat(): number {
  if (!throat) throat = Math.max(...Object.values(speciesModels()).map((m) => m.collarR));
  return throat;
}

function animalRecipe(k: Knobs): AnimalRecipe {
  return {
    swing: k.swing!,
    calf: k.calf!,
    collarR: k.collarR!,
    markClearance: k.markClearance!,
  };
}

const ANIMAL: Bench = {
  name: 'animal',
  title: 'Herd animal',
  note: 'One of the four species, with the collar and the hunt marker the pen hangs on it. Generate 4 stands the whole herd side by side at their own sizes, which is the only place that picture exists.',
  fields: ANIMAL_FIELDS,
  defaults: {
    // The mossback, mid-stride, grown, wearing everything it can wear. Mid-stride
    // because a standing animal says nothing about `swing`, and wearing the
    // collar because two of the four knobs are about things a bare animal does
    // not have on it.
    species: 0,
    phase: 1.57,
    grown: 1,
    fittings: 1,
    ...ANIMAL_DEFAULT,
  },
  seedKey: 'species',
  // One species along. Like the stacks, these are hand-built shapes in a list
  // rather than draws from a hash, and the next one is the next one.
  seedStep: 1,
  grid: ANIMAL_KINDS.length,
  problems(k) {
    const out = boundsProblems(ANIMAL_FIELDS, k);
    // The one cross-field rule, and it is the collar. The buffer is cut once at
    // this radius and every species wears it scaled by its own throat over it,
    // so a cut narrower than the widest neck on the map is a strap scaled up
    // past one — a hoop standing off the throat with daylight under it, which is
    // the exact fault the per-species `collarR` was added to fix.
    if (k.collarR !== undefined) {
      const widest = widestThroat();
      if (k.collarR < widest) {
        out.push(`collar cut ${k.collarR} is narrower than the widest throat that wears it, ${widest}`);
      }
    }
    return out;
  },
  recipe: animalRecipe,
  build(k) {
    const r = animalRecipe(k);
    const kind = ANIMAL_KINDS[k.species!]!;
    const model = speciesModels()[kind];
    const { size } = ANIMALS[kind];
    // The rig's own assembly, called rather than copied — a bench that hung its
    // own neck would agree with the pen right up until somebody moved `neckAt`.
    // The seed is fixed: a coat that changed with the species would make four
    // different colours the thing the grid says, when what it has to say is four
    // different sizes.
    const parts = assembleAnimal(kind, ANIMAL_SEED, size, model, animalFittings(), r);
    growAnimal(parts, size * animalGrowth(k.grown!, r), r);
    poseLegs(parts.legs, k.phase!, r);
    const on = k.fittings === 1;
    parts.mark.visible = on;
    parts.collar.visible = on;
    parts.tag.visible = on;
    parts.group.name = `animal.${kind}`;
    return parts.group;
  },
};


/**
 * The factions a settler is ever drawn in. `wildlife` and `fauna` are the herd's
 * and a colonist tinted either would be a body that does not stand anywhere on
 * the map; the trader is here because it is the one that also carries freight.
 */
const SETTLER_FACTIONS: readonly Faction[] = ['colony', 'raider', 'trader', 'prisoner'];

/**
 * The eight poses, in the order the switch in `settlerPose` writes them, so
 * `pose` is an index into a list rather than a magic number. `sleeping` is the
 * prone one and stands in for the dead and the downed, who are drawn the same.
 */
const SETTLER_POSES: readonly PawnActivity[] = [
  'idle',
  'walking',
  'working',
  'fighting',
  'eating',
  'relaxing',
  'breaking',
  'sleeping',
];

/** The three weapons a settler can be holding, in the order the field counts them. */
const SETTLER_ARMS: readonly Pawn['weapon'][] = ['none', 'club', 'rifle'];

/**
 * Which colonist is on the bench.
 *
 * Fixed, and a field rather than a constant, for the two halves of the same
 * reason: the grid walks the poses, so the body in every cell has to be one
 * body — eight settlers in eight colours would make the colour the thing the
 * picture says — and the colour is nonetheless most of what a settler is, so
 * it has to be draggable somewhere. It is the one number here that changes
 * nothing about the shape.
 */
const SETTLER_SEED = 4931;

/**
 * The settler's knobs. Five of them are the load rather than the recipe — which
 * pose, where in it, what is in the hands, what is on the shoulder and who this
 * is — the way the herd's `species` and `grown` are.
 *
 * Every one of the recipe's own fourteen is here. This is the most complicated
 * body in the game and the bench is the only place any of them can be seen to
 * move; the two that also cut the buffers, `leg` and `sleeve`, rebuild the
 * geometry rather than stretching the body around it.
 */
const SETTLER_FIELDS: readonly Field[] = [
  { key: 'pose', label: 'pose', min: 0, max: SETTLER_POSES.length - 1, step: 1, whole: true },
  { key: 'phase', label: 'through it', min: 0, max: 6.28, step: 0.01 },
  { key: 'carrying', label: 'hands full', min: 0, max: 1, step: 1, whole: true },
  { key: 'armed', label: 'weapon', min: 0, max: SETTLER_ARMS.length - 1, step: 1, whole: true },
  { key: 'tint', label: 'faction', min: 0, max: SETTLER_FACTIONS.length - 1, step: 1, whole: true },
  { key: 'leg', label: 'leg', min: 0.3, max: 1.2, step: 0.005 },
  { key: 'swing', label: 'hip swing', min: 0, max: 1.5, step: 0.01 },
  { key: 'torsoY', label: 'torso', min: 0.5, max: 1.6, step: 0.005 },
  { key: 'shoulderY', label: 'shoulder', min: 0.6, max: 2, step: 0.005 },
  { key: 'headY', label: 'head', min: 0.7, max: 2.2, step: 0.005 },
  { key: 'sleeve', label: 'sleeve', min: 0.2, max: 1, step: 0.005 },
  { key: 'wristY', label: 'wrist', min: -1, max: -0.1, step: 0.005 },
  { key: 'armSplay', label: 'arm splay', min: 0, max: 0.6, step: 0.005 },
  { key: 'sleeveStep', label: 'sleeve step', min: 0, max: 30, step: 0.5 },
  { key: 'carryArm', label: 'carry arm', min: -2.2, max: 0, step: 0.01 },
  { key: 'carryY', label: 'load height', min: 0.4, max: 1.8, step: 0.005 },
  { key: 'carryZ', label: 'load out', min: 0, max: 0.9, step: 0.005 },
  { key: 'bob', label: 'bob', min: 0, max: 0.2, step: 0.001 },
  { key: 'stoop', label: 'stoop', min: 0, max: 1.2, step: 0.01 },
];

function settlerRecipe(k: Knobs): SettlerRecipe {
  return {
    leg: k.leg!,
    swing: k.swing!,
    torsoY: k.torsoY!,
    shoulderY: k.shoulderY!,
    headY: k.headY!,
    sleeve: k.sleeve!,
    wristY: k.wristY!,
    armSplay: k.armSplay!,
    sleeveStep: k.sleeveStep!,
    carryArm: k.carryArm!,
    carryY: k.carryY!,
    carryZ: k.carryZ!,
    bob: k.bob!,
    stoop: k.stoop!,
  };
}

const SETTLER: Bench = {
  name: 'settler',
  title: 'Settler',
  note: 'A colonist in one of the eight poses the rig can put them in. Generate 8 stands all eight side by side, which is the only place that picture exists — and `hands full` composes with every one of them, because carrying is a state of the hands and not an activity.',
  fields: SETTLER_FIELDS,
  defaults: {
    // Mid-stride, empty-handed, unarmed and of the colony. Walking because it
    // is what a settler is doing most of the time the player is looking at one,
    // and mid-stride because a standing body says nothing about `swing` or
    // `bob` — the two knobs this bench was opened to look at.
    pose: SETTLER_POSES.indexOf('walking'),
    phase: 1.57,
    carrying: 0,
    armed: 0,
    tint: SETTLER_FACTIONS.indexOf('colony'),
    ...SETTLER_DEFAULT,
  },
  seedKey: 'pose',
  // One pose along. Like the stacks and the species, these are entries in a
  // list rather than draws from a hash, and the next one is the next one.
  seedStep: 1,
  grid: SETTLER_POSES.length,
  problems(k) {
    const out = boundsProblems(SETTLER_FIELDS, k);
    // The one cross-field rule, and it is the arms. `armSplay`'s doc argues that
    // the roll has a limit and names where it is: the point at which the thumb's
    // tip crosses the shoulder's own line, past which the hands read as clasped
    // in front of the body rather than hanging beside it. `thumbLimit` works it
    // out of the hand and the wrist, so moving either moves this.
    if (k.armSplay !== undefined && k.wristY !== undefined) {
      const limit = thumbLimit(settlerRecipe(k));
      if (k.armSplay > limit) {
        out.push(`arm splay ${k.armSplay} rolls the thumb past the shoulder, which is at ${limit.toFixed(3)}`);
      }
    }
    // The head has to be above the shoulder and the shoulder above the torso's
    // centre, or the body is inside out — and the sliders can each be legal on
    // their own while the three of them together are a settler wearing its ribs
    // for a hat.
    if (k.headY !== undefined && k.shoulderY !== undefined && k.headY <= k.shoulderY) {
      out.push(`head at ${k.headY} is not above the shoulder at ${k.shoulderY}`);
    }
    if (k.shoulderY !== undefined && k.torsoY !== undefined && k.shoulderY <= k.torsoY) {
      out.push(`shoulder at ${k.shoulderY} is not above the torso at ${k.torsoY}`);
    }
    return out;
  },
  recipe: settlerRecipe,
  build(k) {
    const r = settlerRecipe(k);
    const activity = SETTLER_POSES[k.pose!]!;
    const faction = SETTLER_FACTIONS[k.tint!]!;
    // The rig's own assembly and the rig's own pose, called rather than copied.
    // The geometry is cut here too, because two of the knobs are lengths the
    // buffers are cut to and a body stretched around an unchanged thigh is not
    // the body the recipe describes.
    const parts = assembleSettler(faction, SETTLER_SEED, SETTLER_ARMS[k.armed!]!, settlerGeometry(r), r);
    const handsFull = k.carrying === 1;
    const pose = settlerPose(
      { activity, prone: activity === 'sleeping', phase: k.phase!, handsFull, cooldown: 0 },
      r,
    );
    parts.legL.rotation.x = pose.legL;
    parts.legR.rotation.x = pose.legR;
    parts.armL.rotation.x = pose.armL;
    parts.armR.rotation.x = pose.armR;
    parts.head.rotation.x = pose.stoop;
    parts.load.visible = handsFull;
    if (parts.weapon) parts.weapon.visible = !handsFull;

    // Stood on the floor and tipped over, on the assembly's own group and not on
    // a wrapper: these are the two lines the rig writes, on the object the rig
    // writes them on, and `stage.ts` adds to a model's position rather than
    // setting it — so the lift survives being laid out in a grid.
    parts.group.position.y = pose.lift;
    if (pose.prone) parts.group.rotation.x = -Math.PI / 2;
    parts.group.name = `settler.${activity}`;
    return parts.group;
  },
};

export const BENCHES: readonly Bench[] = [STONE, GRASS, TREE, STACK, ANIMAL, SETTLER];

export function benchByName(name: string): Bench | null {
  return BENCHES.find((b) => b.name === name) ?? null;
}
