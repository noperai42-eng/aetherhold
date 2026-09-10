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
import {
  ANIMAL_DEFAULT,
  animalFittings,
  animalGrowth,
  assembleAnimal,
  growAnimal,
  legSwing,
  poseLegs,
  settlerBob,
  settlerGeometry,
  settlerPose,
  type SettlerParts,
  type SettlerPose,
  SETTLER_DEFAULT,
  sleeveOf,
  speciesGeometries,
  speciesModels,
  thumbLimit,
  assembleSettler,
  type AnimalRecipe,
  type SettlerRecipe,
  type SpeciesModel,
} from '../src/client/render/pawns';
import { ANIMAL_KINDS, RESOURCE_KINDS } from '../src/sim/types';
import type { PawnActivity } from '../src/sim/types';
import { SETTLER_PHASE, phaseScale } from '../src/client/gait';
import { PawnsView } from '../src/client/render/pawns';
import { ANIMALS } from '../src/sim/wildlife';
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
 * off the pools the renderer had built. Seventy-three shapes: the loose stone,
 * the grass tuft, the bole, the four skirts of each of the wood's two crowns,
 * one stack of each of the eight things a settler can carry, every buffer of
 * every one of the four species in the herd, and the sixteen a settler is cut
 * from.
 *
 * The stacks and the herd are here for a different reason from the rest. No
 * slider on either bench moves a vertex of them — a pile's recipe is where its
 * stacks are put, and an animal's is the stride, the newborn, the collar and the
 * marker, none of which is a shape — so these lines are not guarding a refactor
 * that lifted their literals into a table. They are the first thing that has
 * ever measured `logs()`, `pelt()`, `makeMossback()` or `makeFenwolf()` at all.
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
  // The herd. Ten buffers on a mossback and a dunhare, nine on the two that
  // carry no antler; the leg and the hoof of a dunhare and a brambletail are the
  // same cut, and the digests say so.
  'animal.mossback.body': 'verts=1116 idx=0 hash=234f1a21 box=[-0.231,0.4562,-0.45..0.231,0.95,0.45]',
  'animal.mossback.saddle': 'verts=55 idx=210 hash=e5172b28 box=[-0.215,0.7955,-0.0657..0.2009,0.972,0.4203]',
  'animal.mossback.tail': 'verts=56 idx=264 hash=eeb0bcd4 box=[-0.05,0.535,-0.545..0.05,0.7877,-0.3649]',
  'animal.mossback.neck': 'verts=65 idx=288 hash=2ae16625 box=[-0.16,-0.15,-0.16..0.16,0.27,0.16]',
  'animal.mossback.head': 'verts=1032 idx=0 hash=fb648b0d box=[-0.1182,-0.115,-0.1344..0.1182,0.11,0.347]',
  'animal.mossback.crown0': 'verts=396 idx=0 hash=d6404876 box=[-0.02,0,-0.0287..0.0892,0.317,0.0277]',
  'animal.mossback.crown1': 'verts=54 idx=240 hash=e5626366 box=[-0.05,-0.007,-0.019..0.05,0.14,0.019]',
  'animal.mossback.lining1': 'verts=42 idx=180 hash=73081988 box=[-0.043,-0.0068,0..0.043,0.1358,0.0217]',
  'animal.mossback.leg': 'verts=40 idx=162 hash=dc77e699 box=[-0.062,-0.6,-0.0611..0.0583,0,0.0611]',
  'animal.mossback.hoof': 'verts=40 idx=126 hash=74bb440 box=[-0.0805,0,-0.0853..0.0725,0.077,0.0853]',
  'animal.dunhare.body': 'verts=1296 idx=0 hash=95622a35 box=[-0.2575,0.17,-0.3091..0.2575,0.6658,0.2946]',
  'animal.dunhare.saddle': 'verts=65 idx=252 hash=c890d2ac box=[-0.2401,0.419,-0.3149..0.242,0.6873,0.3069]',
  'animal.dunhare.belly': 'verts=70 idx=270 hash=64458d4f box=[-0.2,0.17,-0.2161..0.1879,0.49,0.2961]',
  'animal.dunhare.scut': 'verts=80 idx=324 hash=118e8639 box=[-0.076,0.474,-0.3869..0.0715,0.63,-0.2371]',
  'animal.dunhare.neck': 'verts=65 idx=288 hash=a50bf389 box=[-0.09,-0.07,-0.09..0.09,0.145,0.09]',
  'animal.dunhare.head': 'verts=1032 idx=0 hash=89635cf0 box=[-0.0985,-0.1,-0.1152..0.0985,0.1,0.248]',
  'animal.dunhare.crown0': 'verts=54 idx=240 hash=28a8acbf box=[-0.055,-0.017,-0.021..0.055,0.34,0.021]',
  'animal.dunhare.lining0': 'verts=42 idx=180 hash=789a7522 box=[-0.0473,-0.0165,0..0.0473,0.3298,0.0239]',
  'animal.dunhare.leg': 'verts=40 idx=162 hash=e45e6cf1 box=[-0.04,-0.34,-0.0394..0.0376,0,0.0394]',
  'animal.dunhare.hoof': 'verts=40 idx=126 hash=fd3ff162 box=[-0.0518,0,-0.0548..0.0466,0.0495,0.0548]',
  'animal.brambletail.body': 'verts=864 idx=0 hash=af75dc89 box=[-0.14,0.31,-0.6674..0.14,0.8596,0.45]',
  'animal.brambletail.chest': 'verts=70 idx=270 hash=599521b2 box=[-0.11,0.28,0.1621..0.1034,0.48,0.4379]',
  'animal.brambletail.brush-tip': 'verts=80 idx=324 hash=80c1634d box=[-0.0604,0.776,-0.7005..0.0568,0.9,-0.5815]',
  'animal.brambletail.neck': 'verts=65 idx=288 hash=35679fa0 box=[-0.09,-0.07,-0.09..0.09,0.14,0.09]',
  'animal.brambletail.head': 'verts=1032 idx=0 hash=2f9515a9 box=[-0.0936,-0.09,-0.1056..0.0936,0.09,0.2385]',
  'animal.brambletail.crown0': 'verts=54 idx=240 hash=1feca675 box=[-0.068,-0.0085,-0.024..0.068,0.17,0.024]',
  'animal.brambletail.lining0': 'verts=42 idx=180 hash=7a32d7a5 box=[-0.0585,-0.0082,0..0.0585,0.1649,0.0274]',
  'animal.brambletail.leg': 'verts=40 idx=162 hash=a1a279a5 box=[-0.04,-0.45,-0.0394..0.0376,0,0.0394]',
  'animal.brambletail.hoof': 'verts=40 idx=126 hash=fd3ff162 box=[-0.0518,0,-0.0548..0.0466,0.0495,0.0548]',
  'animal.fenwolf.body': 'verts=1620 idx=0 hash=68166b89 box=[-0.22,0.3814,-0.7718..0.22,0.86,0.48]',
  'animal.fenwolf.belly': 'verts=70 idx=270 hash=77fdbe71 box=[-0.15,0.37,-0.2754..0.141,0.63,0.3154]',
  'animal.fenwolf.brush-tip': 'verts=80 idx=324 hash=27b97f6d box=[-0.0556,0.349,-0.8117..0.0522,0.463,-0.7023]',
  'animal.fenwolf.neck': 'verts=65 idx=288 hash=e73b2255 box=[-0.13,-0.12,-0.13..0.13,0.22,0.13]',
  'animal.fenwolf.head': 'verts=1032 idx=0 hash=ea45c00b box=[-0.1083,-0.1,-0.1248..0.1083,0.1,0.2765]',
  'animal.fenwolf.crown0': 'verts=54 idx=240 hash=8398c12b box=[-0.058,-0.0075,-0.022..0.058,0.15,0.022]',
  'animal.fenwolf.lining0': 'verts=42 idx=180 hash=c8dc699c box=[-0.0499,-0.0073,0..0.0499,0.1455,0.0251]',
  'animal.fenwolf.leg': 'verts=40 idx=162 hash=7a466b91 box=[-0.05,-0.58,-0.0492..0.047,0,0.0492]',
  'animal.fenwolf.hoof': 'verts=40 idx=126 hash=a202a50 box=[-0.0632,0,-0.067..0.057,0.0605,0.067]',
  // The settler. Sixteen buffers, of which two are cut to a length the recipe
  // names — the thigh to `leg` and the sleeve to `sleeve` — so these two lines
  // are the ones that move when the bench stretches a body rather than the ones
  // that stay put while it does.
  'settler.torso': 'verts=189 idx=960 hash=72a7a692 box=[-0.235,-0.29,-0.1457..0.235,0.29,0.1457]',
  'settler.belt': 'verts=42 idx=120 hash=942d5bd6 box=[-0.22,-0.03,-0.1364..0.22,0.03,0.1364]',
  'settler.neck': 'verts=85 idx=384 hash=2cf88dc6 box=[-0.1,-0.07,-0.1..0.1,0.12,0.1]',
  'settler.head': 'verts=231 idx=1080 hash=91277a12 box=[-0.13,-0.1378,-0.1664..0.13,0.1378,0.1664]',
  'settler.hair': 'verts=200 idx=936 hash=f284523c box=[-0.1477,-0.0627,-0.1885..0.1477,0.158,0.1896]',
  'settler.hairLong': 'verts=200 idx=936 hash=7abdcd2c box=[-0.1474,-0.1278,-0.1883..0.1474,0.158,0.1896]',
  'settler.eye': 'verts=42 idx=144 hash=e01a56de box=[-0.0152,-0.016,-0.0132..0.0152,0.016,0.0132]',
  'settler.leg': 'verts=104 idx=504 hash=a24d96e0 box=[-0.075,-0.74,-0.075..0.075,0,0.075]',
  'settler.boot': 'verts=78 idx=360 hash=aaaf0c2 box=[-0.0694,-0.049,-0.122..0.0694,0.049,0.1366]',
  'settler.arm': 'verts=104 idx=504 hash=dcdd36e9 box=[-0.065,-0.53,-0.065..0.065,0,0.065]',
  'settler.hand': 'verts=408 idx=0 hash=f5e2fb75 box=[-0.0734,-0.0821,-0.074..0.0547,0.0821,0.074]',
  'settler.rifleStock': 'verts=504 idx=0 hash=5f366205 box=[-0.024,-0.63,-0.1..0.024,-0.53,0.482]',
  'settler.rifleAction': 'verts=576 idx=0 hash=79f35144 box=[-0.025,-0.575,0.1..0.025,-0.481,0.72]',
  'settler.club': 'verts=648 idx=0 hash=45d9b923 box=[-0.052,-0.922,0.008..0.052,-0.53,0.112]',
  'settler.pack': 'verts=324 idx=0 hash=d891e66d box=[-0.19,-0.2,-0.11..0.19,0.2,0.11]',
  'settler.crate': 'verts=24 idx=36 hash=a653ec3d box=[-0.18,-0.15,-0.18..0.18,0.15,0.18]',
};

/** Every geometry the defaults build, keyed the way the renderer keys its pools. */
/**
 * A species' buffers, each under the name its golden is written against.
 *
 * `speciesGeometries` returns the same set for the teardown and does not name
 * them, because nothing needed the names until these lines did. The two are
 * held together by `covers every buffer the species owns` below: a marking or a
 * crown added to a species and not named here is a shape with no golden, which
 * is the way the eight stacks went unmeasured for eleven rounds.
 */
function speciesBuffers(kind: string, m: SpeciesModel): [string, THREE.BufferGeometry][] {
  return [
    [`animal.${kind}.body`, m.body],
    ...m.markings.map((k) => [`animal.${kind}.${k.name}`, k.geometry] as [string, THREE.BufferGeometry]),
    [`animal.${kind}.neck`, m.neck],
    [`animal.${kind}.head`, m.head],
    ...m.crowns.map((c, i) => [`animal.${kind}.crown${i}`, c.geometry] as [string, THREE.BufferGeometry]),
    ...m.crowns.flatMap((c, i) =>
      c.lining ? [[`animal.${kind}.lining${i}`, c.lining.geometry] as [string, THREE.BufferGeometry]] : [],
    ),
    [`animal.${kind}.leg`, m.leg],
    [`animal.${kind}.hoof`, m.hoof],
  ];
}

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
  const herd = speciesModels();
  for (const kind of ANIMAL_KINDS) for (const [n, g] of speciesBuffers(kind, herd[kind])) out.set(n, g);
  // Named off the record rather than by hand, so a buffer added to the settler
  // arrives here without being remembered — `covers every shape the goldens
  // name and no others` then asks for its golden.
  for (const [n, g] of Object.entries(settlerGeometry())) out.set(`settler.${n}`, g);
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

/**
 * What a species is, measured — the first time any of it has been.
 *
 * The buffers have goldens above; these are the relations between them that no
 * digest can see, and the reason the herd was worth a round. Two of them are
 * invariants the code now keeps by construction, and the third is a promise the
 * file makes that turns out not to hold.
 */
describe('the four species are measured against each other', () => {
  const herd = speciesModels();

  it('covers every buffer the species owns, so none goes unmeasured', () => {
    for (const kind of ANIMAL_KINDS) {
      const named = speciesBuffers(kind, herd[kind]).map(([, g]) => g);
      // Set against set, by identity: a marking added to a species and left out
      // of `speciesBuffers` is a shape with no golden, which is exactly how the
      // eight stacks went eleven rounds without one.
      expect(new Set(named)).toEqual(new Set(speciesGeometries(herd[kind])));
    }
  });

  it('cuts a leg to the one length it declares', () => {
    for (const kind of ANIMAL_KINDS) {
      const m = herd[kind];
      m.leg.computeBoundingBox();
      const box = m.leg.boundingBox!;
      // Hung from the hip: the top of the capsule is the origin the rig rotates
      // about, and the whole length hangs below it. Both halves matter — the rig
      // sets the hoof at `-legLength` inside the leg, so a capsule cut to any
      // other length puts the sole through the turf or leaves it in the air.
      expect(box.max.y).toBeCloseTo(0, 6);
      expect(box.min.y).toBeCloseTo(-m.legLength, 6);
    }
  });

  it('stands the hoof on the sole of the leg it hangs from', () => {
    const fittings = animalFittings();
    for (const kind of ANIMAL_KINDS) {
      const m = herd[kind];
      const parts = assembleAnimal(kind, 7, 1, m, fittings);
      parts.group.updateMatrixWorld(true);
      for (const leg of parts.legs) {
        const hoof = leg.children.find((c) => c.name === 'hoof')!;
        expect(hoof.position.y).toBeCloseTo(-m.legLength, 6);
      }
    }
  });

  /**
   * The promise, and what measuring it says.
   *
   * `SpeciesModel` states that "everything is laid out in body space, where a
   * mossback is a unit tall at the withers, and the rig scales the whole thing
   * by the species' `size` — so a hare is a hare-sized version of these numbers,
   * not a different set." Taken at its word that makes `size` the height an
   * animal is drawn at, as a fraction of a mossback.
   *
   * It is not. Each species is written in its own space — the four withers run
   * 0.666 to 0.95 before any scaling — so `size` lands somewhere else on every
   * one of them. A dunhare marked 0.45 of a mossback stands 0.32 of one; the
   * brambletail and the fenwolf come up about a tenth short. Nothing had ever
   * checked it, and it is not silently retuned here: how big the animals are
   * beside each other is a thing to judge in frames, so this table is what the
   * numbers are, and the brief is in FORGING.md.
   */
  it('does not lay the four out in one body space, whatever the file says', () => {
    const withers: Record<string, number> = {};
    for (const kind of ANIMAL_KINDS) {
      herd[kind].body.computeBoundingBox();
      withers[kind] = herd[kind].body.boundingBox!.max.y;
    }
    expect(withers).toEqual({
      mossback: expect.closeTo(0.95, 3),
      dunhare: expect.closeTo(0.6658, 3),
      brambletail: expect.closeTo(0.8596, 3),
      fenwolf: expect.closeTo(0.86, 3),
    });
    // A unit tall at the withers, five per cent short of one.
    expect(withers.mossback).toBeLessThan(1);

    const tall = (k: string): number => (withers[k]! * ANIMALS[k as 'mossback'].size) / withers.mossback!;
    expect(tall('mossback')).toBeCloseTo(1, 3);
    expect(tall('dunhare')).toBeCloseTo(0.3154, 3);
    expect(tall('brambletail')).toBeCloseTo(0.2715, 3);
    expect(tall('fenwolf')).toBeCloseTo(0.6337, 3);
    // Which is the gap, stated as the thing a reader would otherwise assume:
    // drawn height is not `size`, and on the dunhare it is thirty per cent under.
    for (const kind of ANIMAL_KINDS) {
      if (kind === 'mossback') continue;
      expect(tall(kind)).toBeLessThan(ANIMALS[kind].size);
    }
  });

  it('cuts the one collar wider than the widest throat that wears it', () => {
    // Every species scales the shared ring by its own throat over the cut, so a
    // cut narrower than a neck would scale the strap up past one and stand it
    // off the throat — the fault the per-species `collarR` exists to fix.
    const widest = Math.max(...ANIMAL_KINDS.map((k) => herd[k].collarR));
    expect(widest).toBeCloseTo(0.13, 6);
    expect(ANIMAL_DEFAULT.collarR).toBeGreaterThan(widest);
  });
});

/**
 * The three expressions the rig and the bench share, held apart from the bodies
 * they are applied to.
 */
describe('how an animal is posed and how big it is drawn', () => {
  it('swings a leg by the recipe, and pairs them diagonally', () => {
    expect(legSwing(0)).toBeCloseTo(0, 6);
    // The number, not `ANIMAL_DEFAULT.swing`. An expectation written off the
    // constant it is guarding moves with it, and a drill that raised the swing
    // to 0.6 walked straight past this line.
    expect(legSwing(Math.PI / 2)).toBeCloseTo(0.55, 6);
    expect(legSwing(Math.PI / 2, { ...ANIMAL_DEFAULT, swing: 0.2 })).toBeCloseTo(0.2, 6);

    const legs = [0, 1, 2, 3].map(() => new THREE.Mesh());
    poseLegs(legs, Math.PI / 2);
    // Fore left with hind right, fore right with hind left: the gait of a
    // four-legged animal, and the one thing a bench that copied the pose could
    // get backwards without anything going red.
    expect(legs[0]!.rotation.x).toBeCloseTo(ANIMAL_DEFAULT.swing, 6);
    expect(legs[3]!.rotation.x).toBeCloseTo(ANIMAL_DEFAULT.swing, 6);
    expect(legs[1]!.rotation.x).toBeCloseTo(-ANIMAL_DEFAULT.swing, 6);
    expect(legs[2]!.rotation.x).toBeCloseTo(-ANIMAL_DEFAULT.swing, 6);
  });

  it('takes a mossback a third of a metre of stride to do it', () => {
    // What 0.55 radians is worth on the ground, which is the thing the number
    // was chosen for and the thing a reader can argue with. A mossback's leg is
    // 0.6 m, so at full swing its hoof reaches 0.31 m behind where it stood and
    // lifts 9 cm of daylight under itself.
    const herd = speciesModels();
    const parts = assembleAnimal('mossback', 7, 1, herd.mossback, animalFittings());
    const hoofOf = (leg: THREE.Mesh): THREE.Vector3 => {
      parts.group.updateMatrixWorld(true);
      return leg.children.find((c) => c.name === 'hoof')!.getWorldPosition(new THREE.Vector3());
    };
    const still = hoofOf(parts.legs[0]!);
    poseLegs(parts.legs, Math.PI / 2);
    const swung = hoofOf(parts.legs[0]!);
    expect(swung.y - still.y).toBeCloseTo(0.0885, 4);
    expect(Math.abs(swung.z - still.z)).toBeCloseTo(0.3136, 4);
  });

  it('draws a newborn at the fraction of its dam the recipe names', () => {
    expect(animalGrowth(0)).toBeCloseTo(ANIMAL_DEFAULT.calf, 6);
    expect(animalGrowth(1)).toBeCloseTo(1, 6);
    expect(animalGrowth(0.5)).toBeCloseTo(0.725, 6);
    expect(animalGrowth(0, { ...ANIMAL_DEFAULT, calf: 0.2 })).toBeCloseTo(0.2, 6);
  });

  it('carries the hunt marker up with a body that grows, keeping its air', () => {
    const herd = speciesModels();
    const parts = assembleAnimal('mossback', 7, 1, herd.mossback, animalFittings());
    // Built at full size: the marker's point stands the recipe's clearance over
    // the crest of the animal.
    expect(parts.mark.position.y).toBeCloseTo(parts.crest + ANIMAL_DEFAULT.markClearance, 6);
    // And the clearance written out, in metres, rather than read back off the
    // recipe that sets it: 16 cm of daylight between the crest of the animal and
    // the point of the cone, the same 16 cm over a hare as over a mossback.
    expect(parts.mark.position.y - parts.crest).toBeCloseTo(0.16, 6);
    growAnimal(parts, ANIMAL_DEFAULT.calf);
    expect(parts.body.scale.y).toBeCloseTo(ANIMAL_DEFAULT.calf, 6);
    // The air over a calf is the same air as over its dam — it is drawn for the
    // player, in the player's units, and not in the animal's.
    expect(parts.mark.position.y).toBeCloseTo(
      parts.crest * ANIMAL_DEFAULT.calf + ANIMAL_DEFAULT.markClearance,
      6,
    );
  });
});

/**
 * A settler in a pose, with nothing on and nothing in the hands.
 *
 * `handsFull` and `cooldown` are the two that outrank the activity, so they are
 * named at every call site that means them rather than defaulted here.
 */
function stand(activity: PawnActivity, phase = 0): SettlerPose {
  return settlerPose({ activity, prone: false, phase, handsFull: false, cooldown: 0 });
}

/** The lowest point of either boot, above whatever the settler is standing on. */
function soleAt(parts: SettlerParts, pose: SettlerPose): number {
  parts.legL.rotation.x = pose.legL;
  parts.legR.rotation.x = pose.legR;
  parts.group.position.y = pose.lift;
  parts.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const leg of [parts.legL, parts.legR]) {
    box.expandByObject(leg.children.find((c) => c.name === 'boot')!);
  }
  return Math.round(box.min.y * 1e4) / 1e4;
}

describe('how a settler is posed and how far off the ground it ends up', () => {
  /** One full stride, in the units `animPhase` is counted in. */
  const cycle = (2 * Math.PI) / phaseScale(SETTLER_DEFAULT.leg, SETTLER_DEFAULT.swing);

  it('walks at the cadence the gait file worked out for this leg', () => {
    // Derived from the recipe rather than read off `SETTLER_PHASE`, so a bench
    // that lengthens the leg gets the cadence that leg walks at. The two have to
    // agree at the default or the colony on the map changed gait the day the
    // recipe was written, and nothing else would have said so.
    expect(phaseScale(SETTLER_DEFAULT.leg, SETTLER_DEFAULT.swing)).toBeCloseTo(SETTLER_PHASE, 10);
    // `gait.test.ts` holds the scale itself. What is worth writing down here is
    // the length of the thing every measurement below is sampled across: one
    // full stride is this much of `animPhase`, which is distance and not time.
    expect(cycle).toBeCloseTo(12.899, 3);
  });

  it('writes every one of the eight poses as the number it has always been', () => {
    // Literal numbers, not `SETTLER_DEFAULT.x`. An expectation written off the
    // constant it guards moves with it — which is how a drill on the herd raised
    // a leg swing by ten per cent and walked past the line that was watching it.
    const r = (n: number): number => Math.round(n * 1e4) / 1e4;
    const four = (p: SettlerPose): number[] => [r(p.legL), r(p.legR), r(p.armL), r(p.armR)];
    expect(four(stand('idle'))).toEqual([0, -0, 0.08, 0.08]);
    expect(four(stand('working'))).toEqual([0.05, -0.05, -1.15, -1.05]);
    expect(four(stand('fighting'))).toEqual([0.12, -0.12, -1.42, -1.42]);
    expect(four(stand('eating'))).toEqual([0.35, -0.35, -1.5, -0.6]);
    expect(four(stand('relaxing'))).toEqual([0.3, -0.3, -0.5, -0.5]);
    expect(four(stand('breaking'))).toEqual([0, -0, 0.42, 0.42]);
    expect(four(stand('walking', cycle / 4))).toEqual([0.62, -0.62, -0.465, 0.465]);
    const down = settlerPose({ activity: 'sleeping', prone: true, phase: 0, handsFull: false, cooldown: 0 });
    expect(four(down)).toEqual([0, 0, 0.15, -0.15]);
    expect(down.prone).toBe(true);
    expect(down.lift).toBeCloseTo(0.16, 6);
  });

  it('leans over a bench and nowhere else', () => {
    expect(stand('working').stoop).toBeCloseTo(0.3, 6);
    for (const a of ['idle', 'walking', 'fighting', 'eating', 'relaxing', 'breaking'] as const) {
      expect(stand(a).stoop).toBe(0);
    }
  });

  it('puts both arms at the same angle for a load, whatever the legs are doing', () => {
    // The composition the split was made for: hauling is filed under `walking`,
    // so before it, a colonist carrying a crate got the walk's arm swing and
    // both hands stayed empty.
    for (const a of ['idle', 'walking', 'working', 'fighting', 'eating', 'relaxing', 'breaking'] as const) {
      const p = settlerPose({ activity: a, prone: false, phase: 1.2, handsFull: true, cooldown: 0 });
      expect(p.armL).toBeCloseTo(-1.3, 6);
      expect(p.armR).toBeCloseTo(-1.3, 6);
    }
    // And the legs still answer to the activity underneath it.
    const hauling = settlerPose({ activity: 'walking', prone: false, phase: cycle / 4, handsFull: true, cooldown: 0 });
    expect(hauling.legL).toBeCloseTo(0.62, 6);
  });

  it('rides the recoil back out of a blow, and stops riding it at a third of a radian', () => {
    const swung = (cooldown: number): number =>
      settlerPose({ activity: 'fighting', prone: false, phase: 0, handsFull: false, cooldown }).armL;
    expect(swung(0)).toBeCloseTo(-1.42, 6);
    expect(swung(10)).toBeCloseTo(-1.22, 6);
    expect(swung(60)).toBeCloseTo(-1.07, 6);
    expect(swung(600)).toBeCloseTo(-1.07, 6);
  });

  it('hangs the arms inside the roll their own thumbs allow', () => {
    // `lighting.test.ts` holds the sleeve's colour and `lighting.test.ts` holds
    // the hand past the cuff. What neither could see is that the splay has a
    // ceiling and the shipped body sits under it — the tip of a thumb rolled
    // past the shoulder's own line reads as hands clasped in front of the body
    // rather than as arms hanging beside it.
    expect(thumbLimit()).toBeCloseTo(0.12628, 5);
    expect(SETTLER_DEFAULT.armSplay).toBeLessThan(thumbLimit());
    // A shorter arm can be rolled further before the thumb gets there, and a
    // longer one cannot be rolled as far.
    expect(thumbLimit({ ...SETTLER_DEFAULT, wristY: -0.2 })).toBeCloseTo(0.34997, 5);
    expect(thumbLimit({ ...SETTLER_DEFAULT, wristY: -1 })).toBeCloseTo(0.07287, 5);
  });

  it('takes the sleeve down by the step the recipe names and not the one the colony uses', () => {
    // The colour half of the recipe. `lighting.test.ts` holds the shipped step
    // at ten L* across every faction and every seed; what it cannot see is
    // whether the knob under it does anything, and a bench slider that moved
    // nothing would have looked exactly like one that worked.
    // CIE L*, the scale the step is named on, written out here the way
    // `lighting.test.ts` writes it — it is three lines of arithmetic and
    // exporting the render file's copy of it to be asked this once would be a
    // wider public surface than the question is worth.
    const lightness = (c: THREE.Color): number => {
      const y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      return 116 * Math.cbrt(y) - 16;
    };
    const shirt = new THREE.Color(0x3f6fa8);
    const step = (r: SettlerRecipe): number => lightness(shirt) - lightness(sleeveOf(shirt, r));
    expect(step(SETTLER_DEFAULT)).toBeCloseTo(10, 4);
    expect(step({ ...SETTLER_DEFAULT, sleeveStep: 4 })).toBeCloseTo(4, 4);
    expect(step({ ...SETTLER_DEFAULT, sleeveStep: 18 })).toBeCloseTo(18, 4);
    // A shirt already on the floor has no room to give and keeps its sleeves,
    // however big the step asked for is.
    const black = new THREE.Color(0x000000);
    expect(sleeveOf(black, { ...SETTLER_DEFAULT, sleeveStep: 30 }).getHex()).toBe(black.getHex());
  });

  it('never bobs a body below the height it set out from', () => {
    // The whole of the first-person bug, in one line. The camera had its own
    // copy of this expression with the absolute value dropped, so it went one
    // rise per cycle and spent half of every cycle under the floor it started
    // on. Sampled finely enough that a sign error anywhere in the cycle shows.
    for (let i = 0; i <= 200; i++) {
      expect(settlerBob((i / 200) * cycle * 3)).toBeGreaterThanOrEqual(0);
    }
    expect(settlerBob(0)).toBeCloseTo(0, 10);
    expect(settlerBob(cycle / 8)).toBeCloseTo(0.035, 6);
    expect(settlerBob(cycle / 4)).toBeCloseTo(0, 10);
    // Two rises per cycle, one per step.
    expect(settlerBob(cycle * 3 / 8)).toBeCloseTo(0.035, 6);
  });

  /**
   * The round's finding, measured and left standing.
   *
   * `gait.ts` argues at length that a settler's foot must stay where it was put,
   * and `footScrub` holds it there — horizontally. Nothing ever asked the other
   * question. Rotating a rigid leg about the hip lifts the sole through an arc,
   * and the body above it does not come down to meet it, so a walking settler is
   * airborne for everything but three instants of the cycle: at full swing BOTH
   * boots are forty-four millimetres clear of the ground.
   *
   * The bob makes it worse rather than better, and exactly out of phase. It
   * peaks at the eighths, where the soles are thirty-six millimetres up, and is
   * flat at the quarters, where they are at their highest. A real walk does the
   * opposite — the hip is highest over the planted foot at midstance and dips at
   * double support, which is where these legs are splayed.
   *
   * Pinned as it is and not as it should be. Which way to close it is a frame
   * question and not an arithmetic one: dropping the body by the sole's own rise
   * plants the foot and dips the hip at the splay, and whether that reads as a
   * walk or as a limp is what the look loop is for. FORGING.md carries the brief.
   */
  it('walks a settler through the air for all but three instants of a stride', () => {
    const parts = assembleSettler('colony', 4931, 'none', settlerGeometry());
    const soles = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => soleAt(parts, stand('walking', (i / 8) * cycle)));
    expect(soles).toEqual([0, 0.0364, 0.0438, 0.0364, 0, 0.0364, 0.0438, 0.0364, 0]);

    // And the bob is a quarter-cycle out with it: highest where the feet are
    // near the ground, flat where they are furthest off it.
    const lifts = [0, 1, 2, 3, 4].map((i) => Math.round(stand('walking', (i / 8) * cycle).lift * 1e4) / 1e4);
    expect(lifts).toEqual([0, 0.035, 0, 0.035, 0]);

    // A settler who is not walking stands on the floor, which is what makes the
    // above a fact about the gait rather than about the boot's own origin.
    expect(soleAt(parts, stand('idle'))).toBe(0);
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

  it('stands the four species side by side, and no fifth', () => {
    const animal = benchByName('animal')!;
    // The grid is the frame this family is judged in, and the only picture in
    // the repo where the four stand at their own sizes on the same ground: on
    // the map they are eleven cells below a camera, in a field, at three
    // different distances and half of them cropped.
    expect(animal.grid).toBe(ANIMAL_KINDS.length);
    const seeds = Array.from({ length: animal.grid! }, (_, i) => i * animal.seedStep);
    const grid = forgeSeeds(animal, animal.defaults, seeds, protos);
    expect(grid.map((m) => m.group!.name)).toEqual(ANIMAL_KINDS.map((k) => `animal.${k}`));
    // And at four different heights, which is what the grid is there to show.
    const tops = grid.map((m) => Math.round(new THREE.Box3().setFromObject(m.group!).max.y * 1e3) / 1e3);
    expect(new Set(tops).size).toBe(ANIMAL_KINDS.length);
  });

  it('hangs a bench animal’s parts exactly where the pen hangs them', () => {
    // The whole reason `assembleAnimal` was lifted out of the rig. A bench that
    // hung its own neck would agree with the pen right up until somebody moved
    // `neckAt`, and nothing would say which of the two was the game.
    const animal = benchByName('animal')!;
    const world = benchWorld();
    const beast = world.pawns.find((p) => p.animal === 'mossback');
    expect(beast).toBeDefined();
    world.pawns = [beast!];
    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 1, null, 1 / 60);
    view.group.updateMatrixWorld(true);

    const made = forge(animal, animal.defaults, protos);
    expect(made.problems).toEqual([]);
    // From the children down, not from the root: the bench names its top group
    // for the grid caption and the pen leaves it bare, and that one label is the
    // only thing about the two that is allowed to differ.
    const parts = (o: THREE.Object3D): string[] => {
      const out: string[] = [];
      const r = (n: number): number => Math.round(n * 1e5) / 1e5;
      for (const child of o.children) {
        child.traverse((c) => {
          if (!c.name) return;
          out.push(`${c.name} ${r(c.position.x)},${r(c.position.y)},${r(c.position.z)}`);
        });
      }
      return out.sort();
    };
    expect(parts(made.group!)).toEqual(parts(view.group));
  });

  it('refuses a collar cut narrower than the neck it has to ring', () => {
    const animal = benchByName('animal')!;
    const made = forge(animal, { ...animal.defaults, collarR: 0.1 }, protos);
    expect(made.group).toBeNull();
    expect(made.problems.join(' ')).toContain('narrower than the widest throat');
  });

  it('takes the collar and the marker off an animal nobody has claimed', () => {
    const animal = benchByName('animal')!;
    const bare = forge(animal, { ...animal.defaults, fittings: 0 }, protos);
    const worn: string[] = [];
    bare.group!.traverse((c) => {
      if (c.visible && ['mark', 'collar', 'tag'].includes(c.name)) worn.push(c.name);
    });
    expect(worn).toEqual([]);
    const kept = forge(animal, animal.defaults, protos);
    const shown: string[] = [];
    kept.group!.traverse((c) => {
      if (c.visible && ['mark', 'collar', 'tag'].includes(c.name)) shown.push(c.name);
    });
    expect(shown.sort()).toEqual(['collar', 'mark', 'tag']);
  });

  it('draws a newborn at the fraction of its dam the recipe names', () => {
    const animal = benchByName('animal')!;
    const grown = forge(animal, animal.defaults, protos);
    const calf = forge(animal, { ...animal.defaults, grown: 0 }, protos);
    const body = (m: THREE.Object3D): THREE.Object3D => m.children[0]!;
    expect(body(calf.group!).scale.y / body(grown.group!).scale.y).toBeCloseTo(ANIMAL_DEFAULT.calf, 6);
    // The marker comes down with it and keeps the same air, which is the pair of
    // lines `growAnimal` exists to keep together.
    const mark = (m: THREE.Object3D): THREE.Mesh => m.children.find((c) => c.name === 'mark') as THREE.Mesh;
    expect(mark(calf.group!).position.y).toBeLessThan(mark(grown.group!).position.y);
  });

  it('swings the bench animal’s legs the way the herd swings them', () => {
    const animal = benchByName('animal')!;
    const made = forge(animal, animal.defaults, protos);
    const legs: THREE.Mesh[] = [];
    made.group!.traverse((c) => {
      if (c.name === 'leg') legs.push(c as THREE.Mesh);
    });
    expect(legs).toHaveLength(4);
    const swung = legSwing(animal.defaults.phase!);
    expect(legs.map((l) => Math.round(l.rotation.x * 1e5) / 1e5).sort((a, b) => a - b)).toEqual(
      [-swung, -swung, swung, swung].map((v) => Math.round(v * 1e5) / 1e5).sort((a, b) => a - b),
    );
  });


  it('stands all eight poses side by side, and no ninth', () => {
    const settler = benchByName('settler')!;
    // The grid is the frame this family is judged in, and the only picture in
    // the repo where the eight stand together: on the map they are one settler
    // each, scattered across a valley, doing one thing at a time.
    expect(settler.grid).toBe(8);
    const seeds = Array.from({ length: settler.grid! }, (_, i) => i * settler.seedStep);
    const grid = forgeSeeds(settler, settler.defaults, seeds, protos);
    expect(grid.map((m) => m.group!.name)).toEqual([
      'settler.idle',
      'settler.walking',
      'settler.working',
      'settler.fighting',
      'settler.eating',
      'settler.relaxing',
      'settler.breaking',
      'settler.sleeping',
    ]);
    // And in eight different shapes, which is what the grid is there to show. A
    // pose that drew the same body as its neighbour would be a cell of the
    // picture saying nothing. Read off the limbs rather than off a bounding box:
    // two poses can occupy the same box while the arms in them are doing
    // different things, and the arms are the whole of what most of these say.
    const limbs = grid.map((m) =>
      m
        .group!.children.filter((c) => c.name === 'leg' || c.name === 'arm')
        .map((c) => Math.round(c.rotation.x * 1e4))
        .join(','),
    );
    expect(new Set(limbs).size).toBe(8);
  });

  it('hangs a bench settler’s parts exactly where the colony hangs them', () => {
    // The whole reason `assembleSettler` was lifted out of the rig, and the
    // reason the pose came with it: a bench that splayed its own arm would agree
    // with the colony right up until somebody moved the shoulder, and nothing
    // would say which of the two was the game.
    const settler = benchByName('settler')!;
    const world = benchWorld();
    const one = world.pawns.find((p) => p.faction === 'colony' && p.animal === undefined);
    expect(one).toBeDefined();
    one!.activity = 'idle';
    one!.animPhase = 0;
    one!.carryingItemId = null;
    one!.weapon = 'none';
    one!.colorSeed = 4931;
    world.pawns = [one!];
    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 1, null, 1 / 60);
    view.group.updateMatrixWorld(true);

    const made = forge(settler, { ...settler.defaults, pose: 0, phase: 0 }, protos);
    expect(made.problems).toEqual([]);
    // From the children down, not from the root: the bench names its top group
    // for the grid caption and the colony leaves it bare, and that one label is
    // the only thing about the two that is allowed to differ.
    const parts = (o: THREE.Object3D): string[] => {
      const out: string[] = [];
      const r = (n: number): number => Math.round(n * 1e5) / 1e5;
      for (const child of o.children) {
        child.traverse((c) => {
          if (!c.name) return;
          out.push(`${c.name} ${r(c.position.x)},${r(c.position.y)},${r(c.position.z)} ${r(c.rotation.x)},${r(c.rotation.z)}`);
        });
      }
      return out.sort();
    };
    expect(parts(made.group!)).toEqual(parts(view.group));
  });

  it('refuses an arm splayed past the shoulder its own thumb would cross', () => {
    const settler = benchByName('settler')!;
    const made = forge(settler, { ...settler.defaults, armSplay: 0.2 }, protos);
    expect(made.group).toBeNull();
    expect(made.problems.join(' ')).toContain('rolls the thumb past the shoulder');
    // And the limit moves with the arm it is worked out of, in the direction the
    // geometry says: a hand hung further from the shoulder is swept further
    // inboard by the same roll, so a LONGER arm is the tighter limit and a
    // shorter one is what makes this splay legal. Deriving it is what gets that
    // right; a number written down would have been written down the other way.
    expect(forge(settler, { ...settler.defaults, armSplay: 0.2, wristY: -1 }, protos).group).toBeNull();
    expect(forge(settler, { ...settler.defaults, armSplay: 0.2, wristY: -0.2 }, protos).group).not.toBeNull();
  });

  it('refuses a body worn inside out', () => {
    const settler = benchByName('settler')!;
    const low = forge(settler, { ...settler.defaults, headY: 1.2 }, protos);
    expect(low.group).toBeNull();
    expect(low.problems.join(' ')).toContain('is not above the shoulder');
    const sunk = forge(settler, { ...settler.defaults, shoulderY: 1.0 }, protos);
    expect(sunk.group).toBeNull();
    expect(sunk.problems.join(' ')).toContain('is not above the torso');
  });

  it('puts the crate in the hands of a settler in any of the eight poses', () => {
    // Carrying is a state of the hands and not an activity — which is the whole
    // argument `settlerPose` makes — so the bench composes it with every pose
    // rather than making it a ninth.
    const settler = benchByName('settler')!;
    for (let pose = 0; pose < settler.grid!; pose++) {
      const made = forge(settler, { ...settler.defaults, pose, carrying: 1 }, protos);
      expect(made.problems).toEqual([]);
      const load = made.group!.children.find((c) => c.name === 'load')!;
      expect(load.visible).toBe(true);
      expect(forge(settler, { ...settler.defaults, pose }, protos).group!.children.find((c) => c.name === 'load')!.visible).toBe(false);
    }
  });

  it('hides the weapon of a settler whose hands are already full', () => {
    // A rifle rides the right hand, so raising both arms to a crate raised the
    // rifle with them: a settler crossing the map with a shotgun standing out of
    // their fist above the box.
    const settler = benchByName('settler')!;
    const armed = forge(settler, { ...settler.defaults, armed: 2 }, protos);
    const stock = armed.group!.getObjectByName('stock');
    expect(stock).toBeDefined();
    expect(stock!.parent!.visible).toBe(true);
    const hauling = forge(settler, { ...settler.defaults, armed: 2, carrying: 1 }, protos);
    expect(hauling.group!.getObjectByName('stock')!.parent!.visible).toBe(false);
  });

  it('cuts a longer thigh for a longer leg instead of stretching the body round it', () => {
    // The two knobs that are lengths the buffers are cut to. A bench that moved
    // the hip and kept the thigh would draw a settler whose knee had come out
    // through the trouser, and no golden above could see it — the goldens are
    // written at the default.
    const settler = benchByName('settler')!;
    const made = forge(settler, { ...settler.defaults, leg: 1 }, protos);
    expect(made.problems).toEqual([]);
    const leg = made.group!.children.find((c) => c.name === 'leg') as THREE.Mesh;
    expect(leg.position.y).toBeCloseTo(1, 6);
    leg.geometry.computeBoundingBox();
    expect(leg.geometry.boundingBox!.min.y).toBeCloseTo(-1, 6);
    // And the boot is still on the end of it rather than where the old one ended.
    expect(leg.children.find((c) => c.name === 'boot')!.position.y).toBeCloseTo(-0.951, 6);
  });

  it('gives a trader freight and gives nobody else any', () => {
    const settler = benchByName('settler')!;
    const trader = forge(settler, { ...settler.defaults, tint: 2 }, protos);
    expect(trader.group!.children.filter((c) => c.name === '').length).toBeGreaterThan(0);
    expect(trader.group!.getObjectByName('torso')!.children.length).toBe(1);
    const colonist = forge(settler, { ...settler.defaults, tint: 0 }, protos);
    expect(colonist.group!.getObjectByName('torso')!.children.length).toBe(0);
  });

  it('builds the same settler from the pasted block, and none of the colony with it', () => {
    const settler = benchByName('settler')!;
    const k = { ...settler.defaults, bob: 0.09, stoop: 0.7 };
    const pasted = JSON.parse(recipeText(settler, k)) as SettlerRecipe;
    // Every field of the recipe, not the nineteen the page knows how to draw.
    expect(Object.keys(pasted).sort()).toEqual(Object.keys(SETTLER_DEFAULT).sort());
    expect(pasted.bob).toBe(0.09);
    expect(pasted.stoop).toBe(0.7);
    // And it is a recipe you can put back: the pose it produces is the pose the
    // knobs produce, which is what the block is offered for.
    const mine = settlerPose({ activity: 'working', prone: false, phase: 2, handsFull: false, cooldown: 0 }, pasted);
    const theirs = settlerPose(
      { activity: 'working', prone: false, phase: 2, handsFull: false, cooldown: 0 },
      settler.recipe(k) as SettlerRecipe,
    );
    expect(mine).toEqual(theirs);
    expect(mine.stoop).toBe(0.7);
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

  it('carries how many to a row when it was asked for, and not otherwise', () => {
    // A frame shot at three to a row and one shot at four are two pictures of
    // the same recipe, so an address that could not tell them apart would be a
    // provenance that lies. It is written only when asked for, because every
    // frame the look loop has ever taken was at the stage's own default and
    // stamping a number on those URLs would make them all look deliberate.
    expect(new URLSearchParams(searchOf(tree, tree.defaults)).has('columns')).toBe(false);
    const q = new URLSearchParams(searchOf(tree, tree.defaults, 3));
    expect(q.get('columns')).toBe('3');
    // And it is not a field: it shapes the frame, not the model, so it must not
    // come back out as a knob or the next paste would carry it into `decor.ts`.
    const back = knobsFromSearch(tree, q);
    expect(Object.keys(back).sort()).toEqual(tree.fields.map((f) => f.key).sort());
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

  it('builds the same animal from the pasted block, and none of the herd with it', () => {
    const animal = benchByName('animal')!;
    const k = { ...animal.defaults, species: 3, phase: 2.2, grown: 0.4, swing: 0.9 };
    const pasted = JSON.parse(recipeText(animal, k)) as AnimalRecipe;
    // Which species stood on the bench, how far through its stride it was and
    // how grown are the load, not the recipe. What goes back into `pawns.ts` is
    // how an animal is drawn and worn, which is the same four numbers for all
    // four of them.
    expect(pasted).toEqual(animal.recipe(k));
    expect(Object.keys(pasted).sort()).toEqual(Object.keys(ANIMAL_DEFAULT).sort());
    expect(pasted.swing).toBe(0.9);
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
