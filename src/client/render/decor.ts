/**
 * The scatter that makes ground look like ground: grass tufts on turf, loose
 * stones on rock and dirt. None of it is simulated — nothing here is collidable,
 * nothing here is a resource — so it is the one part of the world that may be
 * dropped wholesale on low quality without the two views disagreeing.
 *
 * It matters most in first person, where the eye is 1.6 m off a surface that
 * would otherwise be one flat colour all the way to the horizon.
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { growingCells } from '../../sim/farming';
import { yearPhase } from '../../sim/seasons';
import { snowDepth } from '../../sim/snowpack';
import { windStrength } from '../../sim/weather';
import { terrainAt } from '../../sim/types';
import type { World } from '../../sim/types';
import { SEASON_STEPS, SNOW_STEPS, seasonTint } from './palette';

/**
 * Tufts per grass cell.
 *
 * Seven, where it was five last round and three for the eight before that. The
 * count keeps rising for the same reason each time, and round 10's frames are
 * the clearest statement of it yet: sample the open turf west of the wall in
 * `3-colony` and only about one pixel in twenty belongs to a blade at all. A
 * field that is nineteen twentieths bare ground cannot read as cover however
 * well the tuft standing in it is drawn, which is why the manager camera has
 * gone on reporting "scattered marks" through two rounds of work on the blade.
 *
 * Seven and not nine, and that is the whole of the arithmetic. Root spacing goes
 * as one over the square root of the count: 0.447 m at five, 0.378 m at seven,
 * 0.333 m at nine. The first step buys 69 mm of it and the second only 45 more,
 * while both cost the same 228,570 triangles — on a 192-square map, 15,238 grass
 * cells is 76,190 tufts at five and 106,666 at seven, 1,142,850 triangles against
 * 1,599,990. That is 5.7 % on a colony frame of 8,000,822, and nine would have
 * been 11.4 % for two thirds of the effect. What the count still cannot do is add
 * a draw call or a shadow pass — it grows one pool inside one instanced draw, and
 * the grass casts nothing — so if a later round finds the frame time moved, this
 * is the first number to take it out of, and the blade is still not.
 */
const TUFTS_PER_CELL = 7;
/**
 * Where the tufts on a cell stand, before the jitter: the first seven points of
 * the R2 low-discrepancy sequence, offset by a hash of the cell.
 *
 * Seven independent random points in a square do not cover it. They clump, and
 * between the clumps they leave holes a third of a metre across — which is the
 * scale at which the manager camera stops seeing ground cover and starts seeing
 * a scatter of separate marks with gaps between them. Raising the count fights
 * that and loses, because uniform sampling puts every new point somewhere
 * independent of the ones already there; the holes shrink as one over the count
 * rather than as one over its square root.
 *
 * R2 is the two-dimensional cousin of the golden-ratio sequence and it fills a
 * square about as evenly as seven points can: the closest pair of these is
 * 0.27 apart where a random seven would routinely put two within 0.05. The cost
 * of an even fill is that it is the *same* even fill on every cell, so the whole
 * set is carried round the unit square by a per-cell hash before it is used and
 * lands on its own phase each time. Adjacent cells therefore interlock at
 * random, and the one thing the eye is best at — a repeating motif on a metre
 * lattice — never forms.
 */
const R2_X = 0.7548776662;
const R2_Z = 0.5698402909;
/**
 * The blades of one tuft, in "one tuft tall" units: how wide each is at the
 * root, how long, how far it is tipped out of the vertical, how far it bows
 * forward, which way it faces, how far it is wrung about its own length, and
 * where on the ground it comes up.
 *
 * Five thin blades rather than three broad ones, and a *sheaf* rather than a
 * star, which is the second half of a fix round 9 only got half of. Round 9
 * correctly named the three-blade clump a three-pointed star with a notch in
 * the middle and rebuilt it as five slim blades out of five separate patches of
 * ground — and then dealt them five bearings a little over a fifth of the
 * compass apart each, which is a five-pointed star. From twenty cells up a
 * five-fold radial figure of bright and dark strokes is not grass, it is a
 * glyph, and the eye reads a glyph long before it reads a texture: the manager
 * frame went on photographing bird tracks pressed into the turf through the
 * whole of round 10.
 *
 * So the bearings are now grouped. The three longest blades lie inside a single
 * 63-degree arc (`turn` 0.25, 0.85, 1.35) and the two shortest fall away behind
 * it (2.85, 4.20), which is how a real tussock sits: a fan of leaves arching one
 * way with a little spilling the other. Rotated to its own bearing by the
 * instance matrix, a field of these is a scatter of short strokes at every angle
 * — which is what a lawn looks like from a distance — instead of a stamp of the
 * same asterisk repeated ninety thousand times. The footprint from straight
 * overhead survives the grouping, because it is measured as reach and not as
 * symmetry: the three arcs of the compass still get 0.63, 0.57 and 0.61 of a
 * tuft-height of blade in them.
 *
 * The rest of the table is round 9's and still correct: no two lengths alike,
 * every blade coming up out of its own patch of ground (`rx`/`rz`, now placed
 * along each blade's own bearing so a leaf comes up where it leans) rather than
 * all five meeting at the origin, which is what removes the notch. The first
 * blade stands straight and keeps the height — its tip is the y = 1 the instance
 * scale means — and the rest lean, but none of them lean far: a blade tipped
 * past forty-five degrees is lying down, and lying down is what made the old
 * clump read as flat. What gives the tuft its footprint from directly
 * overhead is the bow rather than the lean, which is the difference
 * between grass that rises and curls over and grass that radiates.
 *
 * Everything here is written at the blade's own full length; `tuftGeometry`
 * then scales the whole blade by `len`, bow and width together. That is why the
 * widths sit so close to one another and the lengths do not: a short blade ends
 * up narrow in proportion, which is what it should be, and — the part that
 * actually mattered — it ends up bowing over a short distance rather than
 * reaching as far out as a full-length one and lying flat on the turf.
 *
 * `twist` is how far the blade is wrung about its own length, in radians at
 * the tip, and it is what replaces the crease the three-blade clump carried.
 * A flat strip has one plane and so one normal, and five of them would take
 * exactly the same light; a wrung one turns its face through the light along
 * its length, which costs no triangles at all. The root is untwisted (see
 * `tuftGeometry`) so it stays flat on the ground when the blade is leaned.
 */
const TUFT_BLADES: readonly TuftBlade[] = [
  { width: 0.2, len: 1, lean: 0, bend: 0.24, turn: 0.85, twist: 0.5, rx: 0.0451, rz: 0.0396 },
  { width: 0.18, len: 0.88, lean: 0.2, bend: 0.3, turn: 1.35, twist: -0.6, rx: 0.1366, rz: 0.0307 },
  { width: 0.21, len: 0.74, lean: 0.34, bend: 0.36, turn: 0.25, twist: 0.7, rx: 0.0322, rz: 0.126 },
  { width: 0.19, len: 0.63, lean: 0.44, bend: 0.4, turn: 2.85, twist: -0.45, rx: 0.0316, rz: -0.1054 },
  { width: 0.23, len: 0.52, lean: 0.52, bend: 0.42, turn: 4.2, twist: 0.6, rx: -0.0784, rz: -0.0441 },
];
/** Height rows in a blade: root, waist, tip. Three triangles, and five of those in a tuft. */
const BLADE_SEGMENTS = 2;
/** Fraction of bare cells that get a stone. Sparse on purpose — scatter, not gravel. */
const STONE_CHANCE = 0.16;
/**
 * The tallest tuft on the map, and the base it grows up from. Both under forty
 * centimetres: from a first-person eye 1.6 m up, a blade at waist height reads
 * as a scale error on everything around it, not as tall grass. The knee is the
 * ceiling, and the spread below it is what keeps a lawn from being one height.
 */
const TUFT_HEIGHT = 0.3;
const TUFT_HEIGHT_SPREAD = 0.1;

/** One leaf of a tuft, written at its own full length. See `TUFT_BLADES`. */
export interface TuftBlade {
  /** Across at the roots, before the quadratic taper. */
  readonly width: number;
  /** Length as a fraction of the tallest blade's, which is the tuft's own height. */
  readonly len: number;
  /** Tipped off the vertical about its root, in radians. */
  readonly lean: number;
  /** How far the tip bows forward, in the blade's own units. */
  readonly bend: number;
  /** Which way round the clump it comes up and leans, in radians. */
  readonly turn: number;
  /** How far the leaf is wrung about its own length, in radians at the tip. */
  readonly twist: number;
  /** Where its root sits, off the middle of the clump. */
  readonly rx: number;
  readonly rz: number;
}

/**
 * Every number a tuft is made of, in one place a bench can hand back.
 *
 * The table above is the shape and the four numbers under it are the spread — a
 * field of tufts is a field because no two of them are the same height or the
 * same width, and those are the numbers that decide by how much. Stage 5 of
 * [FORGING.md](../../../FORGING.md), which is where the argument for lifting
 * them out of the middle of a render file is written down.
 *
 * What is deliberately *not* here is anything about the field rather than the
 * clump: how many tufts a cell gets, what wear costs them, where on the cell
 * they stand. The bench shows one model, and a number that only means something
 * across a thousand of them cannot be judged on it.
 */
export interface TuftRecipe {
  readonly blades: readonly TuftBlade[];
  /** Height rows in a blade. Two is root, waist, tip. */
  readonly segments: number;
  /**
   * How much of the root-to-tip gradient a full-length blade travels.
   *
   * Written as `0.55 + 0.45 * len` before it was a field, and the base is now
   * `1 - tipReach` rather than a number of its own — which is not a tightening
   * of the recipe but a statement of what the pair already meant. The comment
   * over `tuftGeometry` says it: an outer blade tops out a little short of the
   * upright one's colour, the way the outer leaves of a clump sit in the shade
   * of the middle. A full-length blade landing exactly on the tip colour is the
   * fixed point that sentence is measured from.
   */
  readonly tipReach: number;
  /**
   * How much of a blade's true normal survives being tipped towards the sky.
   *
   * Zero is a leaf lit exactly like the turf under it; one is halfway back to
   * the horizontal normal a strip really has, which under a high sun is a dark
   * chevron on a bright field.
   */
  readonly skyward: number;
  /** The tallest tuft on the map, and how far either side of it the rest fall. */
  readonly height: number;
  readonly heightSpread: number;
  /** Girth as a proportion of height: never past `girthBase + girthSpread`. */
  readonly girthBase: number;
  readonly girthSpread: number;
}

/** The tuft the colony's turf is covered in. */
export const TUFT_DEFAULT: TuftRecipe = {
  blades: TUFT_BLADES,
  segments: BLADE_SEGMENTS,
  tipReach: 0.45,
  skyward: 0.5,
  height: TUFT_HEIGHT,
  heightSpread: TUFT_HEIGHT_SPREAD,
  girthBase: 0.55,
  girthSpread: 0.35,
};
/**
 * How much of a tuft is left where the turf runs out.
 *
 * Grass at one height and one density from the middle of the moor right up to
 * the edge of a trampled yard is the tell that the ground is a texture rather
 * than a place. `wearAt` says how bare a cell's surroundings are; this is what
 * that costs the tuft — the first one on a cell keeps most of itself, and each
 * one after it gives way faster, so worn ground ends up with a straggler and
 * four scraps of stubble where open turf has five full clumps. The count is
 * untouched either way: five tufts a cell is what the pool is sized for and
 * what the tests count, and what makes ground read as bare is that there is
 * almost nothing standing on it, not that the draw is cheaper.
 *
 * The per-tuft step falls every time the count rises, because the run from full
 * turf down to bare has to end in the same place however many tufts are sharing
 * it. The last one has to keep a little of itself — 0.3 + 6 × 0.075 is the same
 * 0.75 that 0.3 + 4 × 0.11 and 0.3 + 2 × 0.22 were — and that ceiling is
 * arithmetic rather than taste: `left` multiplies the instance's y scale, and a
 * tuft scaled by a negative height is a clump growing downwards through the turf
 * it is standing on.
 */
const WEAR_COST = 0.3;
const WEAR_COST_PER_TUFT = 0.075;

/**
 * Root and tip of a blade. The root sits a shade *above* the turf it grows from
 * (`TERRAIN_COLOR.grass`) rather than below it: from the manager camera a blade
 * darker than its lawn is a black chevron on a bright field, and nine thousand
 * of those are the loudest thing on the map. A shade was not enough of one: at
 * colony zoom the field still read as a scatter of dark marks on turf rather
 * than as cover over it, so the root now stands clearly over the ground's own
 * green and the whole tuft is tinted a touch up (`rebuild`).
 *
 * The tip is a paler green that
 * reads as light caught on the leaf — green, not yellow: a straw-coloured tip
 * on nine thousand tufts washed the wide frames the colour of hay, and a lawn
 * has to read as a lawn from twenty cells up. The gradient between them is
 * baked into the geometry as vertex colours (see `tuftGeometry`); the instance
 * colour only tints the whole tuft a little either way.
 */
export const GRASS_ROOT = new THREE.Color(0x4c8a3a);
export const GRASS_TIP = new THREE.Color(0x7fb050);

/**
 * A loose stone's colour. Not `TERRAIN_COLOR.rock`, deliberately: that navy grey
 * is a cliff's colour, and at pebble size on lit dirt it came out as a black
 * blob. A river stone is paler and browner than the face it broke off, so this
 * sits mid-grey with the warmth of the dirt it lies on, and each instance
 * wanders in hue and lightness so a field of them is not one stamp repeated.
 * Exported because it is *the* loose-stone colour: the cairns and fire rings in
 * `landmarks.ts` are stones somebody picked up off this ground, and two families
 * of pebble on one map — one warm, one near-black — read as two different games.
 */
export const STONE_COLOR = 0x8b8073;
/**
 * A stone is lit by the environment as well as the sun. Rough enough to stay
 * matte, but standard rather than Lambert so the sky map puts a rim on the
 * upper edge of every lump — which is what separates a pebble from the dirt it
 * lies on when the two are nearly one colour.
 */
export const STONE_ROUGHNESS = 0.8;
/**
 * How far a loose stone is knocked out of true, and how many faces it is left
 * with.
 *
 * A stone is a piece of something that broke. The outcrop it broke off has flat
 * faces, hard edges and a visible step in value from one face to the next, and
 * in `2b-closeup` the two are photographed side by side: the outcrop reads as
 * rock and the pebbles two metres from it read as eggs. That is not a question
 * of colour — they share the palette — it is that a smooth lump has one
 * highlight sliding over it and no edges, which is exactly what an egg is.
 *
 * So the base drops from a once-subdivided icosahedron to the bare twenty-sided
 * one and the displacement rises from nine hundredths of the radius to three
 * tenths, which is enough to leave no two faces the same size. Twenty large
 * facets is what the outcrop shows from any one direction, and twenty is also a
 * quarter of the eighty a subdivided lump cost — the pebbles are the one thing
 * in this file that casts a shadow, so the saving is taken twice.
 */
const STONE_DETAIL = 0;
const STONE_LUMP = 0.3;
/**
 * How far the faces of one stone differ in tone before any light reaches them.
 *
 * Flat shading already gives a stone a lit side and a shaded side, and that is
 * most of the fix. What it does not give is the difference between a face that
 * broke last winter and a face that has been weathering since the valley was
 * made, which is the other thing that says "this came off something bigger".
 * Baked into the vertex colours because three multiplies the instance tint into
 * them rather than replacing it, so the per-stone wander below survives — and
 * kept to a seventh either way, because the instance tone is already spending
 * most of the range the mid-tone band allows.
 */
const STONE_FACE_SPREAD = 0.14;
/**
 * How far a stone is bedded into the ground it lies on, as a fraction of its
 * own radius.
 *
 * It used to be able to be a shade under nothing. The stone was a flattened
 * lump lying down, its centre was lifted by nearly its own half-height, and the
 * arithmetic worked only because the lump was never turned far enough to stand
 * on its edge. Turning it freely — which is most of why the field stopped
 * reading as one stamp repeated — takes that guarantee away, so the lift comes
 * down to a fifth of the radius. The narrowest a stone can be through any axis
 * is its smallest scale times the closest an icosahedron's twelve corners get
 * to a face centre, 0.35 × 0.794 = 0.278 of the radius, so a fifth always
 * leaves the underside below the turf whichever way up it has landed.
 */
const STONE_SINK = 0.2;

/**
 * One loose stone, as a handful of numbers rather than as five constants nobody
 * outside this file can reach.
 *
 * The constants above are still where the argument for each number lives, and
 * they are still what the colony builds from — `STONE_DEFAULT` is made of them,
 * `stoneGeometry()` called with no arguments uses it, and the call in the view
 * below has not changed. What the struct buys is that the *same* builder can be
 * asked for a different stone. Until the bench in `src/forge/` existed there was
 * no way to see one: `stoneGeometry` took nothing, the seed was the literal 3.7,
 * and every loose stone in the valley was that one mesh turned about. Deciding
 * whether three tenths is the right displacement meant editing this line,
 * rebuilding, starting a colony and walking to a rock.
 */
export interface StoneRecipe {
  /** Which lump this is. Every vertex is moved by a hash against it. */
  seed: number;
  /** Subdivisions of the icosahedron it is knocked out of. Zero is twenty faces. */
  detail: number;
  /** The largest nudge, as a fraction of the radius. */
  lump: number;
  /** How far its faces differ in tone before any light reaches them. */
  faceSpread: number;
  /** How far it beds into the ground it lies on, as a fraction of its radius. */
  sink: number;
}

/** The stone the colony is made of. Every field is the constant above it. */
export const STONE_DEFAULT: StoneRecipe = {
  seed: 3.7,
  detail: STONE_DETAIL,
  lump: STONE_LUMP,
  faceSpread: STONE_FACE_SPREAD,
  sink: STONE_SINK,
};

export class DecorView {
  readonly group = new THREE.Group();
  private readonly tufts: THREE.InstancedMesh;
  private readonly stones: THREE.InstancedMesh;
  /** Shared with the grass shader; drives the sway. Seconds, from the sim clock. */
  private readonly time = { value: 0 };
  /** How hard the sway leans, from the weather. 1 is a still day. */
  private readonly wind = { value: 1 };
  private lastT = -1;
  private checksum = -1;
  private enabled = true;

  constructor(world: World) {
    const cells = world.width * world.height;

    // A tuft rather than a spike: five slim tapered leaves coming up out of
    // their own patches of ground, curving forward as they rise and wrung about
    // their own length, so from overhead it is a clump of foliage with light
    // running along it and from eye level a bent stem instead of a green
    // pyramid — and from neither is it three fat blades meeting at a notch,
    // which is what a field of them read as. Every root sits on y = 0 and close
    // enough to the origin to stay on its own cell, so per-instance scale is a
    // height and the shader can use object-space y directly as "how far from the
    // roots am I".
    const tuft = tuftGeometry(GRASS_ROOT, GRASS_TIP);
    this.tufts = new THREE.InstancedMesh(
      tuft,
      grassMaterial(this.time, this.wind),
      cells * TUFTS_PER_CELL,
    );
    // Grass does not cast: a map's worth of tuft shadows costs more than it shows.
    this.tufts.castShadow = false;
    this.tufts.receiveShadow = false;
    this.tufts.frustumCulled = false;
    this.group.add(this.tufts);

    // A piece of broken rock, not a river-worn pebble: twenty flat faces at
    // twenty different angles, so the light steps from one to the next instead
    // of rolling over the whole thing, and the same edges the outcrop across
    // the yard has. The colour attribute is written by `stoneGeometry` before
    // the flag that reads it is set on the material — declared and unbound, it
    // stands at (0, 0, 0) and every stone on the map draws black (see the top
    // of `occlusion.ts`).
    this.stones = new THREE.InstancedMesh(
      stoneGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: STONE_ROUGHNESS,
        vertexColors: true,
      }),
      cells,
    );
    this.stones.castShadow = true;
    this.stones.receiveShadow = true;
    this.stones.frustumCulled = false;
    this.group.add(this.stones);

    this.rebuild(world);
  }

  setDecor(on: boolean): void {
    this.enabled = on;
    this.group.visible = on;
  }

  /**
   * `t` is the sim tick — so the wind stops when the game is paused, which is what
   * a frozen world should look like.
   */
  sync(world: World, t: number): void {
    // The gust *rate* rises with the wind, so the phase has to be integrated:
    // multiplying the absolute clock instead would snap the whole field sideways
    // the instant a front arrived.
    const dt = this.lastT < 0 ? 0 : Math.min(4, Math.max(0, t - this.lastT));
    this.lastT = t;
    const wind = windStrength(world);
    this.time.value += (dt / 20) * (0.7 + wind * 1.6);
    this.wind.value = 0.55 + wind * 1.5;
    if (!this.enabled) return;
    const sum = scatterChecksum(world);
    if (sum === this.checksum) return;
    this.checksum = sum;
    this.rebuild(world);
  }

  /**
   * Placement is a pure function of the cell, so a tuft never jumps when
   * something unrelated across the map changes, and both views scatter it alike.
   */
  private rebuild(world: World): void {
    const farmed = new Set(growingCells(world));
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const e = new THREE.Euler();
    // What the year does to grass, as a ratio rather than as a colour.
    //
    // Stating it as a colour is the obvious version and it is wrong: the
    // root-to-tip gradient `tuftGeometry` bakes into the vertices multiplies with
    // this, so handing every instance one autumn gold would land the root and the
    // point on the same tone and flatten the one thing that stops a blade going
    // black where its normal turns from the sun. So the tint is what the season
    // does to the *tip* colour divided by that tip colour, per channel in linear
    // light — the same divide-by-the-entry-you-are-multiplying shape `buildings.ts`
    // paints its parts with. The tip lands exactly on `seasonTint(GRASS_TIP)`, and
    // the root travels the same distance in proportion rather than in absolute
    // terms, which is what a leaf sitting in the shade of its own clump does in
    // October: it turns, but less than the point the sun is on.
    const year = seasonTint(GRASS_TIP.clone(), yearPhase(world));
    const yearR = year.r / GRASS_TIP.r;
    const yearG = year.g / GRASS_TIP.g;
    const yearB = year.b / GRASS_TIP.b;
    let tuft = 0;
    let stone = 0;

    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const i = y * world.width + x;
        // Anything the colony has claimed — a wall, a floor, a sown plot — is
        // cleared ground. Grass growing through a stove reads as a bug.
        if (world.cellBuilding[i]! >= 0 || farmed.has(i)) continue;
        const kind = terrainAt(world, x, y);

        if (kind === 'grass') {
          const wear = wearAt(world, x, y, farmed);
          // Where this cell's copy of the R2 set is carried to. Read once per
          // cell rather than once per tuft: it is the whole set that moves, and
          // moving each point on its own would put the holes straight back.
          const phaseX = hash(x, y, 3.3);
          const phaseZ = hash(x, y, 4.7);
          for (let n = 0; n < TUFTS_PER_CELL; n++) {
            // Five draws rather than three, because a tuft that took its lean
            // from the same number as its offset leaned the same way everywhere
            // it stood to the right of its cell — a correlation the eye finds
            // long before it finds the numbers.
            const a = hash(x, y, n * 3.1 + 1.7);
            const b = hash(x, y, n * 3.1 + 5.3);
            const d = hash(x, y, n * 3.1 + 9.7);
            const g = hash(x, y, n * 3.1 + 14.3);
            const k = hash(x, y, n * 3.1 + 19.1);
            // The cell's own phase of the R2 set, plus a little jitter so the
            // seven do not sit on a visible lattice when a player stands among
            // them. Kept inside 0.49 of the cell centre: the placement is a pure
            // function of the cell, and every count in the tests reads a tuft's
            // cell back off its position by rounding.
            const ox = (phaseX + (n + 0.5) * R2_X) % 1;
            const oz = (phaseZ + (n + 0.5) * R2_Z) % 1;
            v.set(x - 0.44 + ox * 0.88 + (a - 0.5) * 0.1, 0, y - 0.44 + oz * 0.88 + (b - 0.5) * 0.1);
            // Turned to its own bearing and tipped its own way off the vertical,
            // far enough that five clumps on a cell are five clumps and not one
            // stamp printed five times — but not so far that a tuft lies down,
            // which reads as trodden rather than as grass. A fifth of a radian
            // either way rather than a third: the tuft itself is now five blades
            // of five different lengths on five uneven bearings, so it no longer
            // needs the instance lean to stop it looking like its neighbour, and
            // the wide spread was tipping the outer blades of an already-leaning
            // clump flat against the turf, where the manager camera sees a whole
            // blade broadside and reads the pair of them as a pair of wings.
            e.set((d - 0.5) * 0.4, g * Math.PI * 2, (k - 0.5) * 0.4);
            q.setFromEuler(e);
            // Where the ground around the cell has gone bare, the clump goes with
            // it: shorter, thinner, and the later tufts nearly gone.
            const left = 1 - wear * (WEAR_COST + n * WEAR_COST_PER_TUFT);
            const h = (TUFT_DEFAULT.height + (d - 0.5) * 2 * TUFT_DEFAULT.heightSpread) * left;
            // Girth as a proportion of height, not a number of its own.
            //
            // These were two independent hashes, and the worst of the pairings
            // they could deal was the defect: the widest girth on the shortest
            // tuft is a clump 0.30 across and 0.20 tall, and the tuft geometry
            // reaches 1.66 times its own height out along the ground at the far
            // tip, so that pairing put a blade 2.49 times further out than up —
            // lying flat, broadside to a camera looking almost straight down,
            // which is the brightest and flattest thing a blade can be and is
            // exactly the streak round 9 rebuilt the blade to stop drawing. Tied
            // to the height the ratio can never pass 0.9, so nothing reaches
            // further than 1.49 times its own height, and a tall tuft is a wide
            // one — which is also what a clump of grass does.
            const girth = (TUFT_DEFAULT.girthBase + a * TUFT_DEFAULT.girthSpread) * h;
            s.set(girth, h, girth);
            m.compose(v, q, s);
            this.tufts.setMatrixAt(tuft, m);
            // The root-to-tip gradient rides in the geometry; this is only the
            // tuft's own cast, and it is a multiplier on that gradient rather
            // than a colour, so it is written per channel. `offsetHSL` from white
            // could not do it: white has no saturation for a hue offset to turn,
            // and half the lightness range clipped at white, so two thirds of the
            // variation this comment used to promise was never on screen. Warm
            // one way and cool the other, dark to light across the whole, and a
            // shade drier where the ground is worn — and the year over all of it,
            // which is why this clump's own jitter and the season are two factors
            // in one product rather than two colours fighting for the same slot.
            const warm = (k - 0.5) * 0.12;
            // Centred a little over one rather than a little under it, so the
            // average blade is lit slightly brighter than the gradient baked
            // into it — the cheapest half of "grass reads as cover and not as
            // dark marks", the other half being the root colour above.
            const level = (0.86 + g * 0.34) * (1 - wear * 0.12);
            c.setRGB(level * (1 + warm) * yearR, level * yearG, level * (1 - warm) * yearB);
            this.tufts.setColorAt(tuft, c);
            tuft++;
          }
        } else if ((kind === 'dirt' || kind === 'stone' || kind === 'sand') && hash(x, y, 21.1) < STONE_CHANCE) {
          // Twelve hashes where there were three, and that is the point rather
          // than an extravagance. Size, place, the way up and the tone all came
          // off the same two numbers, so a big stone was always turned the same
          // way and always the same shade of the palette — one lump drawn at a
          // few sizes, which from any distance is one lump. Every property now
          // wanders on its own, and the field stops being a stamp. It costs
          // twelve sines on a few hundred cells at rebuild, not per frame.
          const a = hash(x, y, 31.3);
          const jx = hash(x, y, 41.9);
          const jz = hash(x, y, 51.7);
          const tiltX = hash(x, y, 61.1);
          const spin = hash(x, y, 67.3);
          const tiltZ = hash(x, y, 71.9);
          const wide = hash(x, y, 79.7);
          const thick = hash(x, y, 83.3);
          const long = hash(x, y, 89.1);
          const hue = hash(x, y, 97.7);
          const sat = hash(x, y, 101.3);
          const val = hash(x, y, 103.9);
          // From a chip to a cobble, weighted to the chip: the square puts the
          // median at 0.12 where a flat draw would sit at 0.18, so most of what
          // is lying about is small and the occasional big one reads as big.
          // Four to one between the largest and the smallest, where it was
          // three, and the eye measures a scatter by its extremes.
          const r = 0.07 + a * a * 0.21;
          v.set(x + (jx - 0.5) * 0.6, r * STONE_SINK, y + (jz - 0.5) * 0.6);
          // Turned right round about the vertical and tipped up to fifty degrees
          // either way off it, so no two stones show the same faces to the sun.
          // A lump with twenty flat sides has twenty different silhouettes, and
          // this is what spends them; before this the tilt came off the same
          // number as the size and every stone of a size sat the same way up.
          e.set((tiltX - 0.5) * 1.8, spin * Math.PI * 2, (tiltZ - 0.5) * 1.8);
          q.setFromEuler(e);
          s.set(r * 2 * (0.8 + wide * 0.5), r * (1 + thick * 0.7), r * 2 * (0.8 + long * 0.5));
          m.compose(v, q, s);
          this.stones.setMatrixAt(stone, m);
          // Warm one way, grey the other, and light to dark across the whole,
          // each on its own hash. `offsetHSL` works in the linear working space
          // and not in the sRGB the palette is written in, so these are not the
          // numbers they look like: 0.085 of linear lightness either way is
          // 0.389 to 0.582 read back as sRGB, which fills the mid-tone band a
          // stone is allowed and stops at both ends of it. A stone below that
          // band is a black dot on lit dirt; one above it is blown out.
          //
          // The hue and the saturation are held far tighter than the lightness,
          // and that asymmetry was paid for in one round. Widening all three
          // together — hue to a twelfth of the wheel, saturation to a quarter —
          // is what a smooth lump wanted, because a smooth lump has one
          // highlight and needs the tone to tell it from its neighbour. A
          // faceted one does not: twenty flat sides at twenty angles is already
          // the whole of the variety, and the tone spend on top of it went
          // somewhere the eye reads as a material rather than as a stone.
          // `STONE_COLOR` is a mid-grey with only a tenth of saturation in it
          // and its hue sits at 33 degrees, so a sixth of a turn down the wheel
          // lands at 11 degrees, and a quarter of added saturation on top of
          // that is not a warm grey but a pink. Round 11 photographed five of
          // them lying in the yard in `2b-closeup` and a dozen scattered across
          // the field at dusk, where the low sun pushes what is already pink
          // further, and a field of pink chips reads as petals and not as rock.
          // So the hue comes back inside a tenth of a turn and the saturation
          // to the tenth it was photographed at for ten rounds. What survives
          // the correction is the part that was actually right: the three
          // properties still wander on three independent hashes, so the field is
          // still not one stamp — it is a field of grey stones that differ,
          // rather than a field of stones that differ in colour.
          c.setHex(STONE_COLOR).offsetHSL((hue - 0.5) * 0.05, (sat - 0.5) * 0.1, (val - 0.5) * 0.17);
          this.stones.setColorAt(stone, c);
          stone++;
        }
      }
    }

    this.tufts.count = tuft;
    this.stones.count = stone;
    this.tufts.instanceMatrix.needsUpdate = true;
    this.stones.instanceMatrix.needsUpdate = true;
    if (this.tufts.instanceColor) this.tufts.instanceColor.needsUpdate = true;
    if (this.stones.instanceColor) this.stones.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.tufts.geometry.dispose();
    (this.tufts.material as THREE.Material).dispose();
    this.stones.geometry.dispose();
    (this.stones.material as THREE.Material).dispose();
  }
}

/**
 * How bare the ground around a cell is, from 0 in the middle of the moor to 1
 * with nothing but dirt, stone, water or cleared ground on every side.
 *
 * Turf does not stop at a line. Where a yard has been trodden down to earth,
 * where a plot has been broken, where the shore begins — the grass thins for a
 * cell or two before it gives out, and drawing it at full height right up to
 * the boundary is what made the ground read as a texture laid over the map
 * rather than as ground. This is read once per grass cell during a rebuild,
 * which happens when the map changes and not per frame, so eight neighbours a
 * cell is affordable where a distance field would not be.
 */
function wearAt(world: World, x: number, y: number, farmed: Set<number>): number {
  let bare = 0;
  let seen = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      // Off the map is not bare ground: the edge of the world is where the map
      // stops, and thinning the border would draw a mown stripe round it.
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      seen++;
      const i = ny * world.width + nx;
      if (world.cellBuilding[i]! >= 0 || farmed.has(i) || terrainAt(world, nx, ny) !== 'grass') bare++;
    }
  }
  return seen === 0 ? 0 : bare / seen;
}

/**
 * Everything that can clear a patch of ground — terrain (mining), buildings and
 * sown plots — and the year, which clears nothing and repaints all of it.
 *
 * The season had to come in here before it could reach a blade. A tuft's colour is
 * written once, into an instance attribute, at rebuild time; nothing else ever
 * touches it. So for as long as this checksum was a function of the map alone, the
 * valley could go gold and then white around a field of grass that stayed exactly
 * the green it was sown in, and no amount of work on the tint would have shown up
 * on screen. The year enters as `SEASON_STEPS` whole steps rather than
 * continuously for the reason `palette.ts` gives: a raw phase would rebuild
 * seventy-six thousand tufts every frame for a colour change nobody can see.
 *
 * The pack is in for the sake of the pair rather than for the tuft — the tint
 * below reads the year and not the snow — but these are the same two quanta
 * `terrain.ts` quantises the ground by, and reusing them is what keeps the grass
 * and the turf it stands on repainting on one clock instead of two that drift.
 */
export function scatterChecksum(world: World): number {
  let sum =
    Math.floor(yearPhase(world) * SEASON_STEPS) * 7919 +
    Math.floor(snowDepth(world) * SNOW_STEPS) * 104729;
  const t = world.terrain;
  for (let i = 0; i < t.length; i++) sum = (sum + t[i]! * (i + 1)) | 0;
  const cb = world.cellBuilding;
  for (let i = 0; i < cb.length; i++) if (cb[i]! >= 0) sum = (sum + i * 7 + 3) | 0;
  for (const z of world.zones) sum = (sum + z.cells.length * 13) | 0;
  return sum;
}

/**
 * Every number in the gust, in one place a bench can hand back.
 *
 * These eight lived inside the shader string, which is the one place in this
 * repo where a constant could not be seen, could not be typed and could not be
 * changed without a reload — and they describe motion, which no still frame of
 * the game shows at all. [FORGING.md](../../../FORGING.md) names grass as the
 * special case for exactly this reason: a tuft cannot be exported to `.glb`, so
 * the bench is the only place its sway will ever be judged in isolation.
 *
 * Two sines rather than one. A single sine is a metronome and the eye finds it
 * within a second; a slower, shallower one beating against it is what makes the
 * field look like weather instead of like a loop.
 */
export interface SwayRecipe {
  /** How far the gust carries a blade at full height, in the tuft's own units. */
  readonly gust: number;
  /** How fast that gust beats. */
  readonly gustRate: number;
  /** The slower second sine, which is what stops the first reading as a metronome. */
  readonly ripple: number;
  readonly rippleRate: number;
  /** How much harder the second sine is phased across the field than the first. */
  readonly rippleSkew: number;
  /** How the phase is read off where a tuft stands, so a gust crosses the field. */
  readonly phaseX: number;
  readonly phaseZ: number;
  /** How much of the gust goes sideways as well as along it. */
  readonly lateral: number;
}

/** The wind the colony's grass has been leaning in for eleven rounds of frames. */
export const SWAY_DEFAULT: SwayRecipe = {
  gust: 0.22,
  gustRate: 1.5,
  ripple: 0.12,
  rippleRate: 0.7,
  rippleSkew: 1.9,
  phaseX: 0.6,
  phaseZ: 0.85,
  lateral: 0.55,
};

/**
 * A number as GLSL will read it.
 *
 * `${1}` in a shader string is an int, and `uTime * 1` is a type error that
 * fails the whole compile with a message about operands — so every number
 * spliced into the source below has to arrive with a decimal point on it. This
 * is the one landmine in making the gust a recipe rather than a literal.
 */
function glsl(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/**
 * Lambert, plus a sway that grows with distance from the roots.
 *
 * Wind belongs in the vertex shader rather than in the instance matrices: it has
 * to move every blade every frame, and rewriting a few thousand matrices on the
 * CPU each frame to do it would cost more than the grass is worth.
 */
export function grassMaterial(
  time: { value: number },
  wind: { value: number },
  sway: SwayRecipe = SWAY_DEFAULT,
): THREE.MeshLambertMaterial {
  // Two-sided because a blade is a strip with no thickness: a possessed colonist
  // walking round a tuft would otherwise see it wink out for half the turn.
  // Vertex colours carry the root-to-tip gradient baked into the tuft geometry;
  // they multiply with the per-instance tint, so both survive.
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWind = wind;
    // A two-sided material flips the normal on its back faces, which is right
    // for a closed shell seen from inside and wrong for a leaf: the tuft's
    // normals are tipped towards the sky (see `tuftGeometry`) so a blade takes
    // the sun the way the turf under it does, and flipping them would light
    // every blade facing away from the camera from underground. Both faces of a
    // leaf are lit by the same sky, so both use the same normal.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      /* glsl */ `
      float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
      vec3 normal = normalize( vNormal );
      vec3 nonPerturbedNormal = normal;
      `,
    );
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uTime;\nuniform float uWind;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          // Phase by where the blade stands, so the gust crosses the field
          // instead of every tuft twitching in unison.
          vec3 tuftPos = instanceMatrix[3].xyz;
          float phase = tuftPos.x * ${glsl(sway.phaseX)} + tuftPos.z * ${glsl(sway.phaseZ)};
          float gust = (sin(uTime * ${glsl(sway.gustRate)} + phase) * ${glsl(sway.gust)}
            + sin(uTime * ${glsl(sway.rippleRate)} + phase * ${glsl(sway.rippleSkew)}) * ${glsl(sway.ripple)}) * uWind;
          float bend = max(transformed.y, 0.0);
          transformed.x += gust * bend;
          transformed.z += gust * ${glsl(sway.lateral)} * bend;
        #endif
        `,
      );
  };
  return mat;
}

/**
 * A single leaf: a strip `width` across at the roots, tapering to a point at
 * y = 1, that bows forward (+z) by `bend` at the tip. Built by hand because no
 * primitive is a curved sheet, and kept to a handful of triangles because the
 * grass draws one of these per blade across the whole map.
 *
 * The taper is quadratic — broad for most of its length, then narrowing fast —
 * which is what a blade of grass or a crop leaf actually looks like, and the bow
 * is quadratic too, so the base stands straight and only the upper half leans.
 * The instance matrix scales y to the blade's height and x/z to its girth, so
 * everything here is in "one blade tall" units.
 */
export function bladeGeometry(width: number, segments: number, bend: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const half = (width / 2) * (1 - t * t);
    const z = bend * t * t;
    pos.push(-half, t, z, half, t, z);
  }
  pos.push(0, 1, bend);
  const tip = segments * 2;
  for (let i = 0; i < segments - 1; i++) {
    const l = i * 2;
    idx.push(l, l + 1, l + 3, l, l + 3, l + 2);
  }
  idx.push(tip - 2, tip - 1, tip);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Where a folded blade's one cross-section sits, as a fraction of its length.
 * Low enough that the crease is under the broad part of the leaf the manager
 * camera looks down on, high enough that the band below it is not a sliver.
 */
const BLADE_WAIST = 0.45;

/**
 * The same leaf with a keel down the middle: a strip `width` across at the
 * roots, bowing `bend` forward by the tip at y = 1, whose midline is pushed out
 * of the plane of its edges by `fold` of the half-width where it is widest.
 *
 * A flat strip is the right shape from eye level and the wrong one from
 * directly above. Both of its halves are one plane, so both take exactly the
 * same light, and a tuft of them reads as folded paper — the blade has no
 * cross-section for the sun to find. Real grass is creased along its length,
 * and that crease is what makes one half of a leaf brighter than the other from
 * whatever direction the light comes.
 *
 * Everything about the topology here is the sixteen-triangle budget a whole
 * tuft has to fit inside, which leaves five triangles for a blade. So the root
 * is a plain edge with no midline vertex on it (a crease that started at the
 * ground would put the root vertices off y = 0, where the lean would swing them
 * under the turf), there is exactly one row of three across the waist, and the
 * tip is the same single vertex at (0, 1, `bend`) the flat strip ends in, so a
 * caller can still hang something off the end of one. Wound so that every face
 * points to the side the keel opens towards, which is the side a leaning blade
 * shows the sky.
 */
export function foldedBladeGeometry(width: number, bend: number, fold: number): THREE.BufferGeometry {
  const t = BLADE_WAIST;
  const half = width / 2;
  // The same quadratic taper the flat strip has, sampled at the one row there
  // is room for: broad most of the way up, then narrowing fast to the point.
  const waist = half * (1 - t * t);
  const z = bend * t * t;
  const keel = waist * fold;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -half, 0, 0, // 0 root, left
        half, 0, 0, // 1 root, right
        -waist, t, z, // 2 waist, left
        0, t, z + keel, // 3 waist, on the keel
        waist, t, z, // 4 waist, right
        0, 1, bend, // 5 tip
      ],
      3,
    ),
  );
  geo.setIndex([0, 3, 1, 0, 2, 3, 1, 3, 4, 2, 5, 3, 3, 5, 4]);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The keel of a leaf, without the row of vertices a keel costs: every vertex
 * is turned about the blade's own length by `twist` radians times how far up
 * the blade it sits.
 *
 * A blade of grass is not a flat sheet, and five flat sheets on one root take
 * one light between them however they are turned. Wringing each one puts a
 * different piece of its face towards the sky at every height, which is what a
 * crease bought and this buys for nothing — the tuft is instanced tens of
 * thousands of times, and there was no room left for another row of vertices.
 *
 * The root row is at y = 0 and so is untouched by construction, which is the
 * property the caller depends on: the roots have to stay flat on the ground
 * through the lean that follows, and a root vertex swung out of the y = 0 plane
 * before a `rotateX` would end up under the turf.
 */
function twistBlade(geo: THREE.BufferGeometry, twist: number): void {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = twist * p.getY(i);
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setXYZ(i, x * Math.cos(a) + z * Math.sin(a), p.getY(i), z * Math.cos(a) - x * Math.sin(a));
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * A clump of leaves, in "one tuft tall" units — one blade per entry in
 * `TUFT_BLADES`, each coming up out of its own patch of ground.
 *
 * The first blade stands straight so the clump's tallest point is exactly y = 1
 * and the instance matrix's y scale goes on meaning "height". The rest are
 * shorter, wrung their own way and bowed out on their own bearing, so the tuft
 * has a silhouette from every side and a footprint from straight above rather
 * than being one strip seen edge-on half the time.
 *
 * Each blade is *turned and leaned about its own root and then moved to it*, in
 * that order. The other order — move first, then rotate — would swing the roots
 * of the outlying blades through the ground, and the whole reason they are
 * offset is that five blades striking the turf at one point is a notch, and a
 * field of notches is what read as bird tracks.
 *
 * Two things are baked in here that the shader then leans on. Vertex colours
 * run from `root` at the base of each blade to `tip` at its point — faster than
 * linearly, so the upper half a manager camera mostly sees is already the lit
 * colour — which is what stops a blade going black where its normal turns away
 * from the sun. Along the blade and not up the clump: once the outer blades
 * lean far enough to give the tuft a footprint, their tips are barely off the
 * ground, and a gradient read off world height would hand them the root colour
 * for their whole length and put the dark chevrons straight back. What is left
 * of that idea is the reach below — an outer blade tops out a little short of
 * the upright one's colour, the way the outer leaves of a clump sit in the
 * shade of the middle. And the normals themselves are tipped towards the sky: a strip's true normal
 * is horizontal, so under a high sun a field of them takes almost no direct
 * light and reads as dark chevrons on bright turf. Blending each towards up
 * lights a blade like the ground it grows from, with what is left of the true
 * normal keeping the sides of a tuft from shading identically — and, since the
 * blades are wrung, keeping the top of one leaf from shading like its own root,
 * which is the whole reason the twist is there.
 */
export function tuftGeometry(
  root: THREE.Color,
  tip: THREE.Color,
  r: TuftRecipe = TUFT_DEFAULT,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (const shape of r.blades) {
    const blade = bladeGeometry(shape.width, r.segments, shape.bend);
    twistBlade(blade, shape.twist);
    // Painted while the blade is still upright and one unit long, which is the
    // only moment its own y *is* how far along it a vertex sits.
    const bp = blade.getAttribute('position') as THREE.BufferAttribute;
    const bc = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) {
      c.copy(root).lerp(tip, Math.sqrt(bp.getY(i)) * (1 - r.tipReach + r.tipReach * shape.len));
      bc[i * 3] = c.r;
      bc[i * 3 + 1] = c.g;
      bc[i * 3 + 2] = c.b;
    }
    blade.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    // Scaled whole and then tipped over about its root, so the root vertices
    // stay exactly on y = 0 and the tip swings out rather than the blade
    // stretching. Whole and not in height alone: `bend` is an offset at the tip
    // in the blade's own units, so squashing y and leaving z gave the short
    // blades the bow of a tall one — a leaf a quarter of a metre high reaching
    // two and a half times that far out along the ground. Those are the flat
    // streaks that made a tuft read as a bird from above however upright the
    // rest of it stood. Only then is the blade carried to where it comes up.
    blade.scale(shape.len, shape.len, shape.len);
    if (shape.lean !== 0) blade.rotateX(shape.lean);
    blade.rotateY(shape.turn);
    blade.translate(shape.rx, 0, shape.rz);
    parts.push(blade);
  }
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();

  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < nrm.count; i++) {
    n.fromBufferAttribute(nrm, i).multiplyScalar(r.skyward);
    n.y += 1;
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

/**
 * A loose stone: a twenty-sided lump knocked hard out of true, then torn apart
 * again so that every triangle keeps its own normal and its own tone.
 *
 * `lumpyGeometry` welds and smooths on purpose, and everything else that calls
 * it — the cairn stones, a berry, a grain of wheat — wants exactly that. This
 * one does not, and the frames are why. Round 10 photographed the outcrop and
 * the scatter in one frame two metres apart: the outcrop has faces, edges and a
 * visible step in value from one face to the next and reads as rock; the
 * pebbles have a single highlight sliding over an ovoid and read as eggs lying
 * in the dirt. A smooth lump *is* an egg. So the weld happens (the displacement
 * needs it — unwelded corners would tear apart under it) and is then undone,
 * which is the same de-indexing trick `buildings.ts` uses for its own flat
 * parts, and the normals are recomputed on the torn geometry so each of the
 * twenty faces takes the light alone.
 *
 * Then a tone per face, baked into the colour attribute. Flat shading gives a
 * stone a lit side and a shaded side; this gives it a fresh break and a
 * weathered one, which survives into the shadow of a wall and into the low sun
 * of the dusk frame where the shading difference has gone. It multiplies with
 * the per-instance tint rather than replacing it, so the wander across a field
 * of stones and the wander across one stone's faces are both on screen.
 */
export function stoneGeometry(r: StoneRecipe = STONE_DEFAULT): THREE.BufferGeometry {
  const welded = lumpyGeometry(new THREE.IcosahedronGeometry(0.5, r.detail), r.lump, r.seed);
  const geo = welded.toNonIndexed();
  welded.dispose();
  geo.computeVertexNormals();
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    // Hashed off the face's own middle rather than off its index, so the tone
    // is a property of the shape: two faces that ended up alike after the
    // displacement get alike tones, and the pattern does not shuffle if the
    // triangle order ever changes.
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const face = 1 + (hash(cx * 11.3, cy * 7.9 + cz * 5.1, 5.9) - 0.5) * 2 * r.faceSpread;
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = face;
      col[(i + k) * 3 + 1] = face;
      col[(i + k) * 3 + 2] = face;
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/**
 * A polyhedron knocked out of true and lit as one smooth surface.
 *
 * Three's subdivided polyhedra arrive as unshared triangles, so nudging their
 * vertices would tear the faces apart and `computeVertexNormals` would hand back
 * one normal per facet — exactly the low-poly look this is meant to lose. The
 * seams are welded first (dropping the uv and normal attributes that would keep
 * coincident corners apart — nothing here is textured), then every vertex is
 * moved by a hash of where it started, so the same shape comes out every time
 * and welded corners move together. `amount` is the largest nudge as a fraction
 * of the radius; `seed` picks which lump this is.
 */
export function lumpyGeometry(base: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const geo = mergeVertices(base);
  base.dispose();
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Pushed along the radius rather than in a random direction, so a vertex
    // never crosses its neighbour and the surface stays a surface.
    v.multiplyScalar(1 + (hash(v.x * 9.1, v.y * 7.3 + v.z * 5.7, seed) - 0.5) * 2 * amount);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * The scatter's own value noise: the same cell and the same salt give the same
 * number on every machine and in every session, which is what makes placement a
 * pure function of the cell rather than of when the view was built.
 *
 * Exported because the bench seeds a tuft with it. A bench that drew its own
 * random heights would show you a spread the map does not have.
 */
export function hash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
