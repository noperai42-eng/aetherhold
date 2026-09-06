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
import { windStrength } from '../../sim/weather';
import { terrainAt } from '../../sim/types';
import type { World } from '../../sim/types';

/** Tufts per grass cell. Three is enough to cover a map without carpeting it. */
const TUFTS_PER_CELL = 3;
/**
 * The blades of one tuft, in "one tuft tall" units: how wide each is at the
 * root, how long, how far it is tipped out of the vertical, how far it bows
 * forward, and which way it faces.
 *
 * A single blade is a shard wherever it stands; three leaning out from a shared
 * root are a clump, which is what grass does. Three rather than five because
 * the tuft is instanced tens of thousands of times and the whole clump has to
 * stay inside the sixteen-triangle budget the tests hold it to.
 *
 * What matters as much as the count is that the three do not stand in one
 * plane and do not stand upright. A tripod of near-vertical blades is three
 * lines meeting at a point when the manager camera looks straight down at it,
 * which is how a field of them came to read as one flat stamp repeated; the
 * first blade keeps the height (its tip is the y = 1 the instance scale means)
 * and the other two fall further and further out on bearings a long way apart,
 * so the clump has a footprint from directly overhead and a silhouette from
 * every side. The leans and bows are picked so no vertex reaches a whole unit
 * from the root: the tuft is scaled to a fifth of a cell across, and a blade
 * that overshot would be grass growing out of the cell next door.
 */
const TUFT_BLADES = [
  { width: 0.5, len: 1, lean: 0, bend: 0.34, turn: 0.9 },
  { width: 0.44, len: 0.82, lean: 0.5, bend: 0.5, turn: 3.2 },
  { width: 0.38, len: 0.6, lean: 0.78, bend: 0.5, turn: 5.3 },
] as const;
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
/**
 * How much of a tuft is left where the turf runs out.
 *
 * Grass at one height and one density from the middle of the moor right up to
 * the edge of a trampled yard is the tell that the ground is a texture rather
 * than a place. `wearAt` says how bare a cell's surroundings are; this is what
 * that costs the tuft — the first one on a cell keeps most of itself, and each
 * one after it gives way faster, so worn ground ends up with a straggler and
 * two scraps of stubble where open turf has three full clumps. The count is
 * untouched either way: three tufts a cell is what the pool is sized for and
 * what the tests count, and what makes ground read as bare is that there is
 * almost nothing standing on it, not that the draw is cheaper.
 */
const WEAR_COST = 0.3;
const WEAR_COST_PER_TUFT = 0.22;

/**
 * Root and tip of a blade. The root sits a shade *above* the turf it grows from
 * (`TERRAIN_COLOR.grass`) rather than below it: from the manager camera a blade
 * darker than its lawn is a black chevron on a bright field, and nine thousand
 * of those are the loudest thing on the map. The tip is a paler green that
 * reads as light caught on the leaf — green, not yellow: a straw-coloured tip
 * on nine thousand tufts washed the wide frames the colour of hay, and a lawn
 * has to read as a lawn from twenty cells up. The gradient between them is
 * baked into the geometry as vertex colours (see `tuftGeometry`); the instance
 * colour only tints the whole tuft a little either way.
 */
const GRASS_ROOT = new THREE.Color(0x437f34);
const GRASS_TIP = new THREE.Color(0x7fb050);

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

    // A tuft rather than a spike: a few slim tapered strips leaning out from one
    // root and curving forward as they rise, so from overhead it is a clump of
    // leaves and from eye level a bent stem instead of a green pyramid. Roots at
    // the origin so per-instance scale is a height, and so the shader can use
    // object-space y directly as "how far from the roots am I".
    const tuft = tuftGeometry(3, GRASS_ROOT, GRASS_TIP);
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

    // A river-worn pebble, not a die: a sphere knocked slightly out of true and
    // lit smoothly, so the facets that read as "low poly" from a metre away are
    // gone and what is left is a lump with a highlight sliding over it.
    this.stones = new THREE.InstancedMesh(
      lumpyGeometry(new THREE.IcosahedronGeometry(0.5, 1), 0.09, 3.7),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: STONE_ROUGHNESS }),
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
            v.set(x + (a - 0.5) * 0.8, 0, y + (b - 0.5) * 0.8);
            // Turned to its own bearing and tipped its own way off the vertical,
            // far enough that three clumps on a cell are three clumps and not one
            // stamp printed three times — but not so far that a tuft lies down,
            // which reads as trodden rather than as grass.
            e.set((d - 0.5) * 0.5, g * Math.PI * 2, (k - 0.5) * 0.5);
            q.setFromEuler(e);
            // Where the ground around the cell has gone bare, the clump goes with
            // it: shorter, thinner, and the later tufts nearly gone.
            const left = 1 - wear * (WEAR_COST + n * WEAR_COST_PER_TUFT);
            const h = (TUFT_HEIGHT + (d - 0.5) * 2 * TUFT_HEIGHT_SPREAD) * left;
            const girth = (0.17 + a * 0.13) * (0.55 + left * 0.45);
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
            // shade drier where the ground is worn.
            const warm = (k - 0.5) * 0.12;
            const level = (0.82 + g * 0.34) * (1 - wear * 0.12);
            c.setRGB(level * (1 + warm), level, level * (1 - warm));
            this.tufts.setColorAt(tuft, c);
            tuft++;
          }
        } else if ((kind === 'dirt' || kind === 'stone' || kind === 'sand') && hash(x, y, 21.1) < STONE_CHANCE) {
          const a = hash(x, y, 31.3);
          const b = hash(x, y, 41.9);
          const d = hash(x, y, 51.7);
          // Sizes from a pebble to a fist, and never a true round: the footprint is
          // stretched one way or the other so a stone reads as a stone that
          // rolled there, not a ball that was placed.
          const r = 0.08 + a * 0.17;
          v.set(x + (a - 0.5) * 0.6, r * 0.45, y + (b - 0.5) * 0.6);
          e.set(a * 3, b * 3, (a + b) * 2);
          q.setFromEuler(e);
          s.set(r * 2 * (0.85 + d * 0.3), r * 1.3, r * 2 * (1.15 - d * 0.3));
          m.compose(v, q, s);
          this.stones.setMatrixAt(stone, m);
          c.setHex(STONE_COLOR).offsetHSL((d - 0.5) * 0.06, (a - 0.5) * 0.1, (b - 0.5) * 0.16);
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
 * Everything that can clear a patch of ground: terrain (mining), buildings, and
 * sown plots. Cheaper than rebuilding the scatter every frame, and it catches the
 * three things that actually move it.
 */
export function scatterChecksum(world: World): number {
  let sum = 0;
  const t = world.terrain;
  for (let i = 0; i < t.length; i++) sum = (sum + t[i]! * (i + 1)) | 0;
  const cb = world.cellBuilding;
  for (let i = 0; i < cb.length; i++) if (cb[i]! >= 0) sum = (sum + i * 7 + 3) | 0;
  for (const z of world.zones) sum = (sum + z.cells.length * 13) | 0;
  return sum;
}

/**
 * Lambert, plus a sway that grows with distance from the roots.
 *
 * Wind belongs in the vertex shader rather than in the instance matrices: it has
 * to move every blade every frame, and rewriting a few thousand matrices on the
 * CPU each frame to do it would cost more than the grass is worth.
 */
function grassMaterial(
  time: { value: number },
  wind: { value: number },
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
          float phase = tuftPos.x * 0.6 + tuftPos.z * 0.85;
          float gust = (sin(uTime * 1.5 + phase) * 0.22 + sin(uTime * 0.7 + phase * 1.9) * 0.12) * uWind;
          float bend = max(transformed.y, 0.0);
          transformed.x += gust * bend;
          transformed.z += gust * 0.55 * bend;
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
 * A clump of leaves sharing one root, in "one tuft tall" units — one blade per
 * entry in `TUFT_BLADES`, each with `segments` rows.
 *
 * The first blade stands straight so the clump's tallest point is exactly y = 1
 * and the instance matrix's y scale goes on meaning "height". The rest are
 * shorter and fall further out, each on its own bearing, so the tuft has a
 * silhouette from every side and a footprint from straight above rather than
 * being one strip seen edge-on half the time.
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
 * normal keeping the sides of a tuft from shading identically.
 */
function tuftGeometry(
  segments: number,
  root: THREE.Color,
  tip: THREE.Color,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (const shape of TUFT_BLADES) {
    const blade = bladeGeometry(shape.width, segments, shape.bend);
    // Painted while the blade is still upright and one unit long, which is the
    // only moment its own y *is* how far along it a vertex sits.
    const bp = blade.getAttribute('position') as THREE.BufferAttribute;
    const bc = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) {
      c.copy(root).lerp(tip, Math.sqrt(bp.getY(i)) * (0.55 + 0.45 * shape.len));
      bc[i * 3] = c.r;
      bc[i * 3 + 1] = c.g;
      bc[i * 3 + 2] = c.b;
    }
    blade.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    // Scaled in height alone and then tipped over about its root, so the root
    // vertices stay exactly on y = 0 where the clump shares them and the tip
    // swings out rather than the blade stretching.
    blade.scale(1, shape.len, 1);
    if (shape.lean !== 0) blade.rotateX(shape.lean);
    blade.rotateY(shape.turn);
    parts.push(blade);
  }
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();

  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < nrm.count; i++) {
    n.fromBufferAttribute(nrm, i).multiplyScalar(0.5);
    n.y += 1;
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
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

function hash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
