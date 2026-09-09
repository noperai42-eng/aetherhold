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
  treeCrown,
  treeSkirtGeometries,
  treeTrunkGeometry,
  BuildingsView,
} from '../src/client/render/buildings';
import { STONE_DEFAULT, stoneGeometry } from '../src/client/render/decor';
import { benchWorld, forge, forgeSeeds, prototypes } from '../src/forge/forge';
import { BENCHES, benchByName, type Bench, type Knobs, type Prototypes } from '../src/forge/recipes';

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
});

describe('a recipe is checked before it is built', () => {
  const stone = benchByName('stone')!;
  const tree = benchByName('tree')!;

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
