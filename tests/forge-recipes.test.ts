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
  TREE_DEFAULT,
  TREE_SKIRTS,
  type TreeRecipe,
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
 * off the pools the renderer had built. Ten shapes: the loose stone, the bole,
 * and the four skirts of each of the wood's two crowns.
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
