/**
 * The recipes the bench shapes, and the one thing turning a constant into a
 * field is allowed to have done: changed the model.
 *
 * Every number in a rock and a tree used to be a literal in the middle of a
 * render file. Lifting them into `STONE_DEFAULT` and `TREE_DEFAULT` is a
 * refactor with a very quiet failure mode — a field read from the wrong place,
 * a default typed one digit out, an argument that used to be `STONE_LUMP` and
 * is now `r.faceSpread` — and none of it throws. The colony still starts, the
 * rocks are still rocks, and the wood is a slightly different wood than the one
 * eleven rounds of frames were judged against.
 *
 * So the functional half here is a golden digest per builder: the vertex count,
 * the index count, a hash of every position and the bounding box, all captured
 * from the geometry the game built *before* the recipes existed and asserted
 * against the geometry it builds from the defaults now. It hashes positions
 * only, on purpose — the ambient-occlusion bake writes into the colour
 * attribute and moves nothing, so a digest that included colour would go red
 * every time a shadow was retuned and say "the tree changed" about a tree that
 * did not.
 *
 * The experience half runs the bench: a world, the renderer's real pools, and
 * `forge()` asked for a model the way the page asks for one. What it is
 * checking is the part a unit test cannot see — that a bench tree gets the
 * wood's own material and tint rather than a white default, that it stands on
 * the ground, and that a recipe with a fault comes back as words instead of as
 * a broken mesh.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PILE_DEFAULT,
  TREE_DEFAULT,
  TREE_SKIRTS,
  type PileRecipe,
  type TreeRecipe,
  stackGeometries,
  stackLift,
  stackSize,
  treeCrown,
  treeSkirtGeometries,
  treeTrunkGeometry,
  BuildingsView,
} from '../src/client/render/buildings';
import {
  GRASS_ROOT,
  GRASS_TIP,
  STONE_DEFAULT,
  SWAY_DEFAULT,
  TUFT_DEFAULT,
  stoneGeometry,
  tuftGeometry,
  type StoneRecipe,
  type TuftBlade,
} from '../src/client/render/decor';
import { RESOURCE_KINDS } from '../src/sim/types';
import { knobsFromSearch, recipeText, searchOf } from '../src/forge/address';
import { benchWorld, forge, forgeSeeds, prototypes } from '../src/forge/forge';
import {
  BENCHES,
  benchByName,
  type Bench,
  type GrassRecipe,
  type Knobs,
  type Prototypes,
} from '../src/forge/recipes';

/**
 * What a geometry is, in one line that changes when the shape does.
 *
 * FNV-1a over every position rounded to a micrometre. Rounded rather than raw
 * because the same arithmetic in a different order is allowed to differ in the
 * last bit of a float and a golden test that goes red for that is a golden test
 * nobody keeps; a micrometre is four orders finer than anything the eye judges
 * at this scale, so a real change cannot hide under it.
 */
function digest(g: THREE.BufferGeometry): string {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const arr = p.array as Float32Array;
  let h = 2166136261;
  for (let i = 0; i < arr.length; i++) {
    const v = Math.round(arr[i]! * 1e6);
    h = Math.imul(h ^ (v & 0xff), 16777619);
    h = Math.imul(h ^ ((v >> 8) & 0xff), 16777619);
    h = Math.imul(h ^ ((v >> 16) & 0xff), 16777619);
    h = Math.imul(h ^ ((v >> 24) & 0xff), 16777619);
  }
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const r = (n: number): number => Math.round(n * 1e4) / 1e4;
  const box = `${r(b.min.x)},${r(b.min.y)},${r(b.min.z)}..${r(b.max.x)},${r(b.max.y)},${r(b.max.z)}`;
  return `verts=${p.count} idx=${g.index ? g.index.count : 0} hash=${(h >>> 0).toString(16)} box=[${box}]`;
}

/**
 * The colony's geometry as it stood the day the recipes were written, measured
 * off the pools the renderer had built. Nineteen shapes: the loose stone, the
 * grass tuft, the bole, the four skirts of each of the wood's two crowns, and
 * one stack of each of the eight things a settler can carry.
 *
 * The eight stacks are here for a different reason from the rest. No slider on
 * the bench moves a vertex of them — a pile's recipe is where its stacks are
 * put, not what they are made of — so these lines are not guarding a refactor
 * that lifted their literals into a table. They are the first thing that has
 * ever measured `logs()` and `pelt()` at all.
 *
 * A line here changes when the model changes. That is the whole contract — if a
 * change to a builder is meant to change the shape, the new digest is what the
 * round note carries beside the frames, and if it is not meant to, this is what
 * says so before the frames are taken.
 */
const GOLDEN: Readonly<Record<string, string>> = {
  'decor.stone': 'verts=60 idx=0 hash=eb8923cb box=[-0.4718,-0.5338,-0.5519..0.4624,0.3738,0.4505]',
  'decor.tuft': 'verts=25 idx=45 hash=f8d35193 box=[-0.5004,0,-0.5275..0.4829,1,0.5088]',
  'tree.trunk': 'verts=168 idx=840 hash=3a1a8a56 box=[-0.3875,0,-0.3664..0.4099,3.9,0.4377]',
  'tree.lower': 'verts=200 idx=1008 hash=3fd94ea9 box=[-0.9539,1.6055,-0.855..0.9271,2.82,1.034]',
  'tree.mid': 'verts=200 idx=1008 hash=d91c6621 box=[-0.8096,2.4255,-0.8127..0.8066,3.48,0.7581]',
  'tree.upper': 'verts=200 idx=1008 hash=3261913a box=[-0.5346,3.0455,-0.6428..0.5842,3.98,0.5746]',
  'tree.top': 'verts=200 idx=1008 hash=81203ef9 box=[-0.2846,3.6549,-0.4307..0.5014,4.5,0.3535]',
  'tree.lower.b': 'verts=200 idx=1008 hash=531a0dbb box=[-1.0005,1.6055,-0.9936..0.9171,2.82,1.0051]',
  'tree.mid.b': 'verts=200 idx=1008 hash=769b49ef box=[-0.8954,2.4255,-0.8572..0.7466,3.48,0.7847]',
  'tree.upper.b': 'verts=200 idx=1008 hash=300664b0 box=[-0.5763,3.0455,-0.6499..0.6655,3.98,0.6312]',
  'tree.top.b': 'verts=200 idx=1008 hash=2cb2ab5 box=[-0.287,3.6549,-0.4649..0.5025,4.5,0.2854]',
  'stack.wood': 'verts=720 idx=0 hash=625fbd59 box=[-0.2725,0,-0.2904..0.2725,0.337,0.2922]',
  'stack.steel': 'verts=1944 idx=0 hash=2752e575 box=[-0.2639,0,-0.2719..0.2639,0.3,0.2719]',
  'stack.rawfood': 'verts=1776 idx=0 hash=9fe9380d box=[-0.3,0,-0.3..0.3,0.26,0.3]',
  'stack.meal': 'verts=1368 idx=0 hash=2c1ed881 box=[-0.3275,0,-0.3..0.3275,0.3225,0.3]',
  'stack.medicine': 'verts=1476 idx=0 hash=f4443501 box=[-0.28,0,-0.21..0.28,0.3175,0.215]',
  'stack.hide': 'verts=1284 idx=0 hash=b4381014 box=[-0.3,0,-0.2642..0.2922,0.344,0.2248]',
  'stack.components': 'verts=1428 idx=0 hash=cd1787f5 box=[-0.29,0,-0.29..0.29,0.29,0.29]',
  'stack.assemblies': 'verts=432 idx=0 hash=ea4016ed box=[-0.29,0,-0.255..0.29,0.31,0.255]',
};

/** Every geometry the defaults build, keyed the way the renderer keys its pools. */
function fromDefaults(): Map<string, THREE.BufferGeometry> {
  const out = new Map<string, THREE.BufferGeometry>();
  out.set('decor.stone', stoneGeometry(STONE_DEFAULT));
  out.set('decor.tuft', tuftGeometry(GRASS_ROOT, GRASS_TIP, TUFT_DEFAULT));
  out.set('tree.trunk', treeTrunkGeometry(TREE_DEFAULT));
  for (const [variant, suffix] of [
    [0, ''],
    [1, '.b'],
  ] as const) {
    treeSkirtGeometries(treeCrown(variant)).forEach((g, i) => out.set(`${TREE_SKIRTS[i]}${suffix}`, g));
  }
  for (const g of stackGeometries().values()) out.set(g.name, g);
  return out;
}

describe('the default recipes build the model the colony already had', () => {
  const built = fromDefaults();

  it('covers every shape the goldens name and no others', () => {
    expect([...built.keys()].sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  for (const [key, golden] of Object.entries(GOLDEN)) {
    it(`${key} is unchanged`, () => {
      expect(digest(built.get(key)!)).toBe(golden);
    });
  }

  it('builds the same geometry twice, so a digest means something', () => {
    const again = fromDefaults();
    for (const key of Object.keys(GOLDEN)) expect(digest(again.get(key)!)).toBe(digest(built.get(key)!));
  });

  /**
   * How far along the root-to-tip ramp each blade of a tuft actually gets.
   *
   * The digest is positions only, deliberately — occlusion writes vertex colours
   * elsewhere in `decor.ts`, and a retuned shadow must not read as a moved
   * model. That leaves one thing about a tuft no golden above can see, which is
   * its colour, and `tipReach` is a knob the bench now turns with nothing
   * holding it. That is the risk FORGING.md states in a line: parameterising a
   * constant is a chance to change it by accident. Found by mutating the default
   * and watching all fifty-two tests stay green.
   *
   * The ramp is `root.lerp(tip, a)`, so `a` comes back out of whichever channel
   * the two colours differ in most, and for grass that is green.
   */
  function tipward(geo: THREE.BufferGeometry, blades: number): number[] {
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    expect(col.count % blades).toBe(0);
    const per = col.count / blades;
    const span = GRASS_TIP.g - GRASS_ROOT.g;
    return Array.from({ length: blades }, (_, b) => {
      let most = 0;
      for (let i = b * per; i < (b + 1) * per; i++) {
        most = Math.max(most, (col.getY(i) - GRASS_ROOT.g) / span);
      }
      return most;
    });
  }

  it('runs the tuft colour ramp out with the length of the blade it is on', () => {
    const reach = tipward(tuftGeometry(GRASS_ROOT, GRASS_TIP, TUFT_DEFAULT), TUFT_DEFAULT.blades.length);
    // Five numbers rather than five bounds, and for the same reason the
    // positions above are a hash and not a bounding box: a loose assertion is
    // one a wrong default walks straight through. Written out, this is a
    // golden of the ramp — the leader reaches the tip colour outright and each
    // shorter leaf stops further back, so a tuft has a dark middle rather than
    // reading as one flat fan of green. It goes red for a changed `tipReach`
    // and for a changed blade length alike, which is correct: both of them are
    // the same statement about a tuft.
    expect(reach.map((a) => Math.round(a * 1e4) / 1e4)).toEqual([1, 0.946, 0.883, 0.8335, 0.784]);
  });

  it('paints every blade of a tuft to the same tip when tip reach is turned off', () => {
    const flat = tipward(
      tuftGeometry(GRASS_ROOT, GRASS_TIP, { ...TUFT_DEFAULT, tipReach: 0 }),
      TUFT_DEFAULT.blades.length,
    );
    for (const a of flat) expect(a).toBeCloseTo(1, 3);
  });
});

/**
 * The one promise this family makes, and the first thing to check whether it is
 * kept.
 *
 * `STACK_SHAPE` says every one of the eight "is built to top out at about
 * `PILE_DEFAULT.step`, so a pile of mixed kinds still steps up by the same
 * amount", and `sync` takes it at its word: it climbs a cell by `step × size ×
 * lift` whatever is standing there. So the promise is load-bearing — where a
 * shape is taller than the step, the next stack up sinks into it, and where it
 * is shorter, the next one floats.
 *
 * These are the measurements, not the intention. Eight of them are written out
 * because that is what makes a drift in `pelt()` land here rather than in a
 * frame six rounds later, and the band under them is the promise itself, stated
 * as the number "about" turns out to mean today.
 */
describe('the eight stacks keep the height the pile steps by', () => {
  const tops = new Map<string, number>();
  for (const [kind, g] of stackGeometries()) {
    g.computeBoundingBox();
    tops.set(kind, Math.round(g.boundingBox!.max.y * 1e4) / 1e4);
  }

  it('stands each of the eight exactly as tall as it stands today', () => {
    expect(Object.fromEntries(tops)).toEqual({
      wood: 0.337,
      steel: 0.3,
      rawfood: 0.26,
      meal: 0.3225,
      medicine: 0.3175,
      hide: 0.344,
      components: 0.29,
      assemblies: 0.31,
    });
  });

  it('sits every one of them within a seam’s width of the step', () => {
    // Fifteen hundredths, because that is where the eight actually sit: hides
    // are 14.7 per cent over the step and raw food 13.3 per cent under it, and
    // a band drawn any tighter would be red on the day it was written. It is
    // not a comfortable number — a stack of hides overlaps the one above it by
    // an eighth of its height — and the round note that added this says so. The
    // band is here so that the next shape somebody draws cannot be worse than
    // the worst one already is without saying so.
    for (const [kind, top] of tops) {
      const off = Math.abs(top - PILE_DEFAULT.step) / PILE_DEFAULT.step;
      expect(off, `${kind} tops out at ${top} against a step of ${PILE_DEFAULT.step}`).toBeLessThanOrEqual(0.15);
    }
  });

  it('starts every one of them on the ground, because the pile puts them there', () => {
    // A stack is placed at the top of the one under it, so a shape whose box
    // started below zero would be buried by exactly that much on every stack of
    // the pile but the first.
    for (const [kind, g] of stackGeometries()) {
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y, kind).toBeCloseTo(0, 6);
    }
  });
});

describe('how much is in a stack decides how it is drawn', () => {
  it('draws a handful small, a full load full, and ramps between the two', () => {
    // The ramp written out rather than bounded: `small` at five and under, one
    // at ten and over, and a straight line across the five in between. A
    // denominator taken from the wrong end of that gap still passes a
    // monotonic check and fails here.
    const sizes = [1, 5, 6, 7, 8, 9, 10, 40].map((n) => Math.round(stackSize(n) * 1e4) / 1e4);
    expect(sizes).toEqual([0.7, 0.7, 0.76, 0.82, 0.88, 0.94, 1, 1]);
  });

  it('lifts a stack by whole loads and stops lifting at the cap', () => {
    // The lift is the alternative to a pile that never stops climbing: past a
    // couple of loads a stack is drawn taller rather than the heap growing. Two
    // loads is where that stops, so a hundred and a fifty are drawn alike.
    const lifts = [0, 24, 25, 49, 50, 75, 100].map((n) => Math.round(stackLift(n) * 1e4) / 1e4);
    expect(lifts).toEqual([1, 1, 1.18, 1.18, 1.36, 1.36, 1.36]);
  });

  it('reads both off the recipe rather than off a literal', () => {
    // The whole point of lifting the eight numbers out of `sync`: a bench that
    // turns a knob has to be able to change what the game would draw. A recipe
    // that ramped from a tenth over a single unit is a different colony, and
    // both functions have to say so.
    const r: PileRecipe = { ...PILE_DEFAULT, small: 0.1, smallTo: 1, fullFrom: 2, liftEvery: 10, liftMax: 1 };
    expect(stackSize(1, r)).toBeCloseTo(0.1, 6);
    expect(stackSize(2, r)).toBeCloseTo(1, 6);
    expect(stackLift(30, r)).toBeCloseTo(1 + PILE_DEFAULT.liftStep, 6);
  });
});

describe('a recipe is checked before it is built', () => {
  const stone = benchByName('stone')!;
  const tree = benchByName('tree')!;
  const grass = benchByName('grass')!;

  it('passes the defaults of every bench', () => {
    for (const b of BENCHES) expect(b.problems(b.defaults)).toEqual([]);
  });

  it('names a field that is out of range, and says which way', () => {
    const said = stone.problems({ ...stone.defaults, lump: 4 });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('lump is 4');
    expect(said[0]).toContain('0..0.9');
  });

  it('names a field that is missing rather than building without it', () => {
    const short: Knobs = { ...stone.defaults };
    delete (short as Record<string, number>).sink;
    expect(stone.problems(short)).toEqual(['sink is missing']);
  });

  it('refuses a fraction of a meridian, which the lathe would round away', () => {
    expect(tree.problems({ ...tree.defaults, skirtSeg: 24.5 }).join(' ')).toContain('skirtSeg is 24.5');
  });

  it('refuses NaN, which no bound catches', () => {
    expect(stone.problems({ ...stone.defaults, seed: Number.NaN })).toEqual(['seed is not a number']);
  });

  /**
   * The two structural rules are on fields no slider reaches — the profiles are
   * what stage 3's JSON paste will edit — so they are reached the only way a
   * test can reach them today: by swapping one into `TREE_DEFAULT`, asking the
   * bench, and putting the wood back. `TREE_DEFAULT` is readonly at the type
   * level and not at runtime, and leaving it bent would poison every test that
   * runs after this one in the same file.
   */
  function askWith<K extends 'trunk' | 'skirts'>(field: K, value: (typeof TREE_DEFAULT)[K]): string[] {
    const held = TREE_DEFAULT[field];
    (TREE_DEFAULT as Record<K, (typeof TREE_DEFAULT)[K]>)[field] = value;
    try {
      return tree.problems(tree.defaults);
    } finally {
      (TREE_DEFAULT as Record<K, (typeof TREE_DEFAULT)[K]>)[field] = held;
    }
  }

  it('catches a lathe profile that runs downhill', () => {
    // A profile that doubles back builds a surface through itself, and that
    // renders as a shape with its inside out rather than as an error.
    const said = askWith('trunk', [
      [0.3, 0],
      [0.27, 0.4],
      [0.25, 0.2],
    ]);
    expect(said.join(' ')).toContain('the trunk profile runs downhill at point 2');
  });

  it('catches a crown with the wrong number of skirts, which the view would crash on', () => {
    const said = askWith('skirts', TREE_DEFAULT.skirts.slice(0, 3));
    expect(said.join(' ')).toContain(`3 skirt profiles for the ${TREE_SKIRTS.length}`);
  });

  it('lets a skirt double back, because every skirt in the wood does', () => {
    // The rule this is guarding was written universal in the first draft and
    // would have refused to build the tree the colony already has: a skirt runs
    // out and down under the boughs and back up over the top.
    const heights = TREE_DEFAULT.skirts.map((p) => p.map(([, y]) => y));
    expect(heights.every((h) => h.some((y, i) => i > 0 && y < h[i - 1]!))).toBe(true);
    expect(tree.problems(tree.defaults)).toEqual([]);
  });

  it('leaves the wood as it found it after bending it', () => {
    expect(tree.problems(tree.defaults)).toEqual([]);
    expect(TREE_DEFAULT.skirts).toHaveLength(TREE_SKIRTS.length);
  });

  /** The tuft's blade table, reached the same way and put back the same way. */
  function askWithBlades(blades: readonly TuftBlade[]): string[] {
    const held = TUFT_DEFAULT.blades;
    (TUFT_DEFAULT as { blades: readonly TuftBlade[] }).blades = blades;
    try {
      return grass.problems(grass.defaults);
    } finally {
      (TUFT_DEFAULT as { blades: readonly TuftBlade[] }).blades = held;
    }
  }

  it('catches a tuft with no blades in it, which merges to nothing', () => {
    expect(askWithBlades([])).toContain('a tuft with no blades in it is bare ground');
  });

  it('catches a blade with no length and one with no width, which have no normal', () => {
    const first = TUFT_DEFAULT.blades[0]!;
    const said = askWithBlades([
      { ...first, len: 0 },
      { ...first, width: 0 },
    ]);
    expect(said).toContain('blade 1 is 0 long');
    expect(said).toContain('blade 2 is 0 across');
  });

  it('leaves the turf as it found it after pulling a blade off it', () => {
    expect(grass.problems(grass.defaults)).toEqual([]);
    expect(TUFT_DEFAULT.blades).toHaveLength(5);
  });

  it('refuses a fraction of a blade row, which bladeGeometry would index past', () => {
    expect(grass.problems({ ...grass.defaults, segments: 1.5 })).toContain(
      'segments is 1.5, and half a blade row is nothing',
    );
  });
});

describe('the bench builds what the page asks it for', () => {
  let protos: Prototypes;
  let tree: Bench;
  let stone: Bench;

  beforeAll(() => {
    // The real thing: a colony, the renderer's own pools, and the occlusion
    // drained the way a page with no idle time has to drain it.
    tree = benchByName('tree')!;
    stone = benchByName('stone')!;
    protos = prototypes(benchWorld(), new BuildingsView());
  });

  it('finds the wood in the renderer rather than being told where it is', () => {
    for (const key of ['tree.trunk', ...TREE_SKIRTS]) expect(protos.has(key)).toBe(true);
  });

  it('gives a bench tree the wood’s own material, not a white default', () => {
    const made = forge(tree, tree.defaults, protos);
    expect(made.problems).toEqual([]);
    const parts = made.group!.children as THREE.Mesh[];
    expect(parts.map((p) => p.name)).toEqual(['tree.trunk', ...TREE_SKIRTS]);
    for (const p of parts) {
      const mat = p.material as THREE.MeshStandardMaterial;
      // A pool nothing stood in exports near-white; a pool read off a real tree
      // carries the tint the cell hashed to. The difference is the whole reason
      // the bench borrows the material instead of making one.
      expect(mat.color.getHex()).not.toBe(0xffffff);
      expect(mat.vertexColors).toBe(true);
      expect(p.castShadow).toBe(true);
    }
  });

  it('stands the tree on the ground and leans it the way the wood leans', () => {
    const upright = forge(tree, { ...tree.defaults, lean: 0 }, protos);
    expect(new THREE.Box3().setFromObject(upright.group!).min.y).toBeCloseTo(0, 5);

    const made = forge(tree, tree.defaults, protos);
    const box = new THREE.Box3().setFromObject(made.group!);
    // A leaning bole tips its foot, so one side of a disc 0.44 m across goes
    // under the turf by the radius times the sine of the lean — about 15 mm at
    // the wood's middle lean, and the same on the map. Under, never over: a
    // trunk floating above its own shadow is the failure this is watching for.
    expect(box.min.y).toBeLessThanOrEqual(0);
    expect(box.min.y).toBeGreaterThan(-0.05);
    // Tall enough to be a tree and short enough to be this one: the default
    // recipe is 4.5 m of crown at the middle of the wood's size hash.
    expect(box.max.y).toBeGreaterThan(3.5);
    expect(box.max.y).toBeLessThan(5);
  });

  it('bakes the contact shadow into the parts it hands back', () => {
    const made = forge(tree, tree.defaults, protos);
    const trunk = made.group!.children[0] as THREE.Mesh;
    const col = trunk.geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(col).toBeDefined();
    const arr = col.array as Float32Array;
    // Something under the crown and down at the roots is darker than white, or
    // the bake did not run and the tree is lit by one light fewer than the wood.
    expect(Math.min(...arr)).toBeLessThan(0.95);
  });

  it('hands back words instead of a mesh when the recipe is wrong', () => {
    const made = forge(stone, { ...stone.defaults, lump: 99 }, protos);
    expect(made.group).toBeNull();
    expect(made.problems.join(' ')).toContain('lump is 99');
  });

  it('lays out twelve seeds that are twelve different stones', () => {
    const grid = forgeSeeds(stone, stone.defaults, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], protos);
    expect(grid).toHaveLength(12);
    const shapes = grid.map((g) => digest((g.group!.children[0] as THREE.Mesh).geometry));
    expect(new Set(shapes).size).toBe(12);
  });

  it('says once, not twelve times, that a grid recipe will not build', () => {
    const grid = forgeSeeds(stone, { ...stone.defaults, sink: -3 }, [0, 1, 2], protos);
    expect(grid).toHaveLength(1);
    expect(grid[0]!.group).toBeNull();
  });

  /**
   * A stand-in for the shader three.js would hand `onBeforeCompile`, carrying
   * only the three anchors the grass material splices into.
   *
   * The gust is eight numbers inside a string, which is the one place in this
   * repo a constant is invisible to the compiler and to every test. This is how
   * a test gets to look at it: run the splice by hand and read what came out.
   */
  function spliced(mat: THREE.Material): string {
    const shader = {
      uniforms: {},
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader: 'void main() {\n#include <normal_fragment_begin>\n}',
    };
    (mat.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    return shader.vertexShader;
  }

  it('draws a tuft instanced, because the sway lives inside USE_INSTANCING', () => {
    const grass = benchByName('grass')!;
    // A plain mesh compiles without the branch and stands perfectly still, which
    // is a bench that answers "what does the wind do" with "there is no wind".
    const mesh = grass.build(grass.defaults, protos).children[0] as THREE.InstancedMesh;
    expect(mesh.isInstancedMesh).toBe(true);
    expect(mesh.count).toBe(1);
  });

  it('needs no prototype from the renderer, because grass was never in those pools', () => {
    const grass = benchByName('grass')!;
    // `prototypes()` walks a `BuildingsView` and a tuft belongs to `DecorView`.
    // The empty map is the honest statement of that, and it has to build anyway.
    expect(() => grass.build(grass.defaults, new Map())).not.toThrow();
  });

  it('compiles the gust into the shader with the decimal point GLSL needs', () => {
    const grass = benchByName('grass')!;
    // `uTime * 2` is an int times a float and fails the whole compile with a
    // message about operands, so a whole number has to arrive as `2.0`.
    const mesh = grass.build({ ...grass.defaults, gustRate: 2, lateral: 0.4 }, protos)
      .children[0] as THREE.InstancedMesh;
    const src = spliced(mesh.material as THREE.Material);
    expect(src).toContain('sin(uTime * 2.0 + phase)');
    expect(src).toContain('gust * 0.4 * bend');
  });

  it('deals twelve seeds twelve tufts of twelve heights', () => {
    const grass = benchByName('grass')!;
    const seeds = Array.from({ length: 12 }, (_, i) => i * grass.seedStep);
    const heights = forgeSeeds(grass, grass.defaults, seeds, protos).map((m) => {
      const mesh = m.group!.children[0] as THREE.InstancedMesh;
      const mat = new THREE.Matrix4();
      mesh.getMatrixAt(0, mat);
      const scale = new THREE.Vector3();
      mat.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      // Rounded to a tenth of a millimetre: two tufts that differ by less than
      // that are the same tuft as far as any frame is concerned.
      return Math.round(scale.y * 1e4);
    });
    expect(new Set(heights).size).toBe(12);
  });

  it('stands the eight kinds of stack side by side, and no ninth', () => {
    const stack = benchByName('stack')!;
    // The grid is the frame this family is judged in: eight piles in a row is
    // the only picture in which one of them being taller than the rest is a
    // thing you can see rather than a number you have to look up.
    expect(stack.grid).toBe(RESOURCE_KINDS.length);
    const seeds = Array.from({ length: stack.grid! }, (_, i) => i * stack.seedStep);
    const grid = forgeSeeds(stack, stack.defaults, seeds, protos);
    const names = grid.map((m) => (m.group!.children[0] as THREE.Mesh).name);
    expect(names).toEqual(RESOURCE_KINDS.map((k) => `stack.${k}`));
  });

  it('gives a bench stack the pool’s own colour and the pile’s own step', () => {
    const stack = benchByName('stack')!;
    const made = forge(stack, stack.defaults, protos);
    expect(made.problems).toEqual([]);
    const parts = made.group!.children as THREE.Mesh[];
    expect(parts).toHaveLength(stack.defaults.stacks!);
    for (const part of parts) {
      const mat = part.material as THREE.MeshStandardMaterial;
      // Untinted pools, so the material's colour is the kind's palette entry
      // outright — and not white, which is what a bench that made its own would
      // have drawn the logs in.
      expect(mat.color.getHex()).not.toBe(0xffffff);
      expect(mat.vertexColors).toBe(true);
    }
    // Ten in a stack is full size and no lift, so the step is the step: three
    // stacks at nought, one and two of it.
    const ys = parts.map((part) => part.position.y);
    expect(ys[0]).toBeCloseTo(0, 6);
    expect(ys[1]).toBeCloseTo(PILE_DEFAULT.step, 6);
    expect(ys[2]).toBeCloseTo(PILE_DEFAULT.step * 2, 6);
  });

  it('stops a tall pile at the cap instead of building a tower', () => {
    const stack = benchByName('stack')!;
    const made = forge(stack, { ...stack.defaults, stacks: 8 }, protos);
    const ys = (made.group!.children as THREE.Mesh[]).map((part) => part.position.y);
    // Three steps of 0.3 reach 0.9, which the cap of 0.75 refuses; from there
    // every further stack shares the top one's spot rather than the heap
    // growing past what a settler hauling to it could reach over.
    expect(ys.slice(0, 3).map((y) => Math.round(y * 1e4) / 1e4)).toEqual([0, 0.3, 0.6]);
    for (const y of ys.slice(3)) expect(y).toBeCloseTo(PILE_DEFAULT.cap, 6);
  });

  it('scales a handful of a big load the way the yard would', () => {
    const stack = benchByName('stack')!;
    // Fifty is two full loads, so the stack is drawn full width and better than
    // a third again as tall — the one place the pile arithmetic touches a shape
    // rather than a position, and the bench has to show it or the knob is
    // invisible.
    const made = forge(stack, { ...stack.defaults, amount: 50 }, protos);
    const one = made.group!.children[0] as THREE.Mesh;
    expect(one.scale.x).toBeCloseTo(1, 6);
    expect(one.scale.y).toBeCloseTo(stackLift(50), 6);
    expect(made.group!.children[1]!.position.y).toBeCloseTo(PILE_DEFAULT.step * stackLift(50), 6);
  });

  it('refuses a ramp with no width in it, which would scale a stack to nothing finite', () => {
    const stack = benchByName('stack')!;
    const made = forge(stack, { ...stack.defaults, smallTo: 10, fullFrom: 10 }, protos);
    expect(made.group).toBeNull();
    expect(made.problems.join(' ')).toContain('has no width');
  });

  it('steps the wood’s seeds far enough apart to be different crowns', () => {
    // A crown seeds its four skirts at `i + 1 + crownSeed`, so a step of one
    // would give two neighbours in the grid three of the same four outlines.
    expect(tree.seedStep).toBeGreaterThan(TREE_SKIRTS.length);
    const a = digest(treeSkirtGeometries(treeCrown(0))[1]!);
    const b = digest(treeSkirtGeometries({ ...TREE_DEFAULT, crownSeed: tree.seedStep })[1]!);
    expect(a).not.toBe(b);
  });
});

/**
 * The bench is a harness, and a harness that the game imports is not a harness
 * any more — it is a dependency that reaches the players' bundle the first time
 * somebody adds `src/forge` to `vite.config.ts`, or does not, and either way is
 * a surprise. `forge.html` being absent from the build input keeps the page out;
 * this keeps the direction of the arrow out too.
 */
describe('a recipe survives being written down', () => {
  const stone = benchByName('stone')!;
  const tree = benchByName('tree')!;

  it('takes what the query names and leaves the rest as the colony has it', () => {
    const k = knobsFromSearch(stone, new URLSearchParams('model=stone&lump=0.6'));
    expect(k.lump).toBe(0.6);
    expect(k.detail).toBe(STONE_DEFAULT.detail);
    expect(k.sink).toBe(STONE_DEFAULT.sink);
  });

  it('carries a value it cannot read through to a complaint, rather than swapping it', () => {
    // The failure this exists to prevent is silent: a bench that quietly shows
    // the default rock when the link asked for a particular one is a bench that
    // will lose somebody an afternoon of comparing a thing to itself.
    const k = knobsFromSearch(stone, new URLSearchParams('lump=elephant'));
    expect(k.lump).toBeNaN();
    expect(stone.problems(k)).toContain('lump is not a number');
  });

  it('does not read an empty value as zero, which is what Number would do', () => {
    expect(Number('')).toBe(0);
    const k = knobsFromSearch(stone, new URLSearchParams('lump='));
    expect(k.lump).toBeNaN();
  });

  it('ignores a parameter that is not a field of this bench', () => {
    const k = knobsFromSearch(stone, new URLSearchParams('model=stone&scene=corpse&lump=0.4'));
    expect(Object.keys(k).sort()).toEqual(stone.fields.map((f) => f.key).sort());
  });

  it('writes every field, including the ones still sitting on the default', () => {
    const q = new URLSearchParams(searchOf(tree, tree.defaults));
    expect(q.get('model')).toBe('tree');
    // Not an economy of characters: a URL that omits a default is a URL whose
    // meaning changes on the day somebody moves that default, and a link in a
    // round note that shows a different tree than it did when it was written is
    // worse than no link at all.
    for (const f of tree.fields) expect(q.get(f.key)).toBe(String(tree.defaults[f.key]));
  });

  it('round-trips a fiddly number exactly, to the last digit', () => {
    const k: Knobs = { ...tree.defaults, lean: 0.1234567890123, size: 1.0000001, twist: 0 };
    const back = knobsFromSearch(tree, new URLSearchParams(searchOf(tree, k)));
    for (const f of tree.fields) expect(back[f.key]).toBe(k[f.key]);
  });

  it('prints a block that is really JSON, so a machine can check the paste', () => {
    const text = recipeText(tree, tree.defaults);
    const parsed = JSON.parse(text) as TreeRecipe;
    expect(parsed.trunkSeg).toBe(TREE_DEFAULT.trunkSeg);
    // The profiles are the point. They are on no slider, so a paste block that
    // printed only the draggable numbers would hand back an incomplete recipe.
    expect(parsed.trunk).toEqual(TREE_DEFAULT.trunk);
    expect(parsed.skirts).toHaveLength(TREE_SKIRTS.length);
  });

  it('keeps a blade of a tuft on the line it belongs to', () => {
    const grass = benchByName('grass')!;
    const text = recipeText(grass, grass.defaults);
    // A blade is a row of a hand-laid table in `decor.ts` and reads as one row.
    expect(text).toContain('{ "width": 0.2, "len": 1, "lean": 0');
    const plain = JSON.stringify(grass.recipe(grass.defaults), null, 2);
    expect(text.split('\n').length).toBeLessThan(plain.split('\n').length / 2);
  });

  it('keeps a profile pair on the line it belongs to', () => {
    const text = recipeText(tree, tree.defaults);
    expect(text).toContain('[0.3, 0]');
    // Plain stringify puts each of the forty pairs' two numbers on lines of
    // their own, which is a hundred and sixty lines of column for a thing whose
    // whole purpose is to be read and pasted.
    const plain = JSON.stringify(tree.recipe(tree.defaults), null, 2);
    expect(text.split('\n').length).toBeLessThan(plain.split('\n').length / 2);
  });
});

describe('a recipe found on the bench reaches the game', () => {
  const stone = benchByName('stone')!;
  const tree = benchByName('tree')!;

  /**
   * The done-criterion of stage 3, run rather than looked at: take the block the
   * page offers, paste it into the game's own builder, and check that what comes
   * out is the geometry that was on the bench when it was copied. Everything
   * else here is about the two halves of the round trip; this is about whether
   * the loop actually closes.
   */
  it('builds the same rock from the pasted block as from the sliders', () => {
    const k = { ...stone.defaults, lump: 0.6, faceSpread: 0.4, seed: 12.5 };
    const pasted = JSON.parse(recipeText(stone, k)) as StoneRecipe;
    expect(digest(stoneGeometry(pasted))).toBe(digest(stoneGeometry(stone.recipe(k) as StoneRecipe)));
  });

  it('builds the same tree from the pasted block, skirts and all', () => {
    const k = { ...tree.defaults, crownSeed: 7, lobe: 0.42, girth: 1.3 };
    const pasted = JSON.parse(recipeText(tree, k)) as TreeRecipe;
    const mine = tree.recipe(k) as TreeRecipe;
    expect(digest(treeTrunkGeometry(pasted))).toBe(digest(treeTrunkGeometry(mine)));
    const theirs = treeSkirtGeometries(pasted).map(digest);
    expect(theirs).toEqual(treeSkirtGeometries(mine).map(digest));
    expect(theirs).toHaveLength(TREE_SKIRTS.length);
  });

  it('builds the same tuft from the pasted block, blade table and all', () => {
    const grass = benchByName('grass')!;
    const k = { ...grass.defaults, tipReach: 0.7, skyward: 1.2, segments: 3 };
    const pasted = JSON.parse(recipeText(grass, k)) as GrassRecipe;
    const mine = grass.recipe(k) as GrassRecipe;
    expect(digest(tuftGeometry(GRASS_ROOT, GRASS_TIP, pasted.tuft))).toBe(
      digest(tuftGeometry(GRASS_ROOT, GRASS_TIP, mine.tuft)),
    );
    // The wind comes back too, and untouched: the sliders that moved were the
    // tuft's, and a paste that quietly renormalised the gust would be a paste
    // that changed a thing nobody asked it to.
    expect(pasted.sway).toEqual(SWAY_DEFAULT);
  });

  it('builds the same pile from the pasted block, cap and all', () => {
    const stack = benchByName('stack')!;
    const k = { ...stack.defaults, step: 0.24, cap: 1.1, small: 0.5, smallTo: 3 };
    const pasted = JSON.parse(recipeText(stack, k)) as PileRecipe;
    // The load is not in the paste and must not be: `kind`, `amount` and
    // `stacks` are what was standing on the bench, and what goes back into
    // `buildings.ts` is a pile's arithmetic, not somebody's afternoon of it.
    expect(pasted).toEqual(stack.recipe(k));
    expect(Object.keys(pasted).sort()).toEqual(Object.keys(PILE_DEFAULT).sort());
  });

  it('builds the same tree from its own address, so a link is the frame', () => {
    const k = { ...tree.defaults, crownSeed: 244, lean: 0.085, twist: 1.1 };
    const back = knobsFromSearch(tree, new URLSearchParams(searchOf(tree, k)));
    expect(digest(treeTrunkGeometry(tree.recipe(back) as TreeRecipe))).toBe(
      digest(treeTrunkGeometry(tree.recipe(k) as TreeRecipe)),
    );
  });
});

describe('nothing the game ships imports the bench', () => {
  it('keeps the dependency running one way, out of the game and into the bench', () => {
    // src/forge/ may read the game. Nothing in the game may read src/forge/, or
    // the bench has become part of what ships.
    const offenders: string[] = [];
    for (const dir of ['src/client', 'src/sim']) {
      for (const [file, text] of readAll(dir)) if (/from '.*forge\//.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

/** Every .ts file under a directory, with its text. */
function readAll(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const path = `${d}/${e.name}`;
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith('.ts')) out.push([path, readFileSync(path, 'utf8')]);
    }
  };
  walk(fileURLToPath(new URL(`../${dir}`, import.meta.url)));
  return out;
}
