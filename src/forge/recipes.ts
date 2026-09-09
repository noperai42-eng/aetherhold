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
 * Only numbers are knobs here. A recipe also carries lathe profiles — lists of
 * radius-and-height pairs — and those are not draggable on a slider; they are
 * what the JSON paste in stage 3 of [FORGING.md](../../FORGING.md) is for. They
 * are still validated, because a profile that runs downhill is the one way to
 * hand `lathe` something it cannot turn, and validating a field nobody can yet
 * edit is cheaper than finding out later that nobody ever checked it.
 */

import * as THREE from 'three';

import {
  TREE_DEFAULT,
  TREE_SKIRTS,
  treeSkirtGeometries,
  treeTrunkGeometry,
  type Profile,
  type TreeRecipe,
} from '../client/render/buildings';
import {
  STONE_COLOR,
  STONE_DEFAULT,
  STONE_ROUGHNESS,
  stoneGeometry,
  type StoneRecipe,
} from '../client/render/decor';
import { colorOf, occludeParts } from '../client/render/occlusion';

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
 * valley. `forge.ts` gathers it; the two entries below are the only readers.
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
  /** Everything wrong with this set of values, in words. Empty is buildable. */
  problems(k: Knobs): string[];
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
  build(k, _protos) {
    const r: StoneRecipe = {
      seed: k.seed!,
      detail: k.detail!,
      lump: k.lump!,
      faceSpread: k.faceSpread!,
      sink: k.sink!,
    };
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

export const BENCHES: readonly Bench[] = [STONE, TREE];

export function benchByName(name: string): Bench | null {
  return BENCHES.find((b) => b.name === name) ?? null;
}
