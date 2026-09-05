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
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { TERRAIN_COLOR } from './palette';
import { growingCells } from '../../sim/farming';
import { windStrength } from '../../sim/weather';
import { terrainAt } from '../../sim/types';
import type { World } from '../../sim/types';

/** Blades per grass cell. Three is enough to read as a tuft, cheap enough to cover a map. */
const TUFTS_PER_CELL = 3;
/** Fraction of bare cells that get a stone. Sparse on purpose — scatter, not gravel. */
const STONE_CHANCE = 0.16;
const TUFT_HEIGHT = 0.42;

const GRASS_BASE = new THREE.Color(0x40632f);
const GRASS_TIP = new THREE.Color(0x7d9c4e);

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

    // A blade rather than a spike: a tapered strip that curves forward as it
    // rises, so from overhead it is a leaf and from eye level it is a bent stem
    // instead of a green pyramid. Base at the origin so per-instance scale is a
    // height, and so the shader can use object-space y directly as "how far from
    // the roots am I".
    const blade = bladeGeometry(0.8, 4, 0.5);
    this.tufts = new THREE.InstancedMesh(
      blade,
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
      lumpyGeometry(new THREE.IcosahedronGeometry(0.5, 1), 0.07, 3.7),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
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
          for (let n = 0; n < TUFTS_PER_CELL; n++) {
            const a = hash(x, y, n * 3.1 + 1.7);
            const b = hash(x, y, n * 3.1 + 5.3);
            const d = hash(x, y, n * 3.1 + 9.7);
            v.set(x + (a - 0.5) * 0.8, 0, y + (b - 0.5) * 0.8);
            // Leaning slightly off vertical, each blade its own way, so a tuft is
            // a tuft and not three copies of one spike.
            q.setFromEuler(new THREE.Euler((d - 0.5) * 0.5, a * Math.PI * 2, (b - 0.5) * 0.5));
            const h = TUFT_HEIGHT * (0.6 + d * 0.8);
            s.set(0.16 + a * 0.08, h, 0.16 + b * 0.08);
            m.compose(v, q, s);
            this.tufts.setMatrixAt(tuft, m);
            c.copy(GRASS_BASE).lerp(GRASS_TIP, d).offsetHSL(0, 0, (a - 0.5) * 0.08);
            this.tufts.setColorAt(tuft, c);
            tuft++;
          }
        } else if ((kind === 'dirt' || kind === 'stone' || kind === 'sand') && hash(x, y, 21.1) < STONE_CHANCE) {
          const a = hash(x, y, 31.3);
          const b = hash(x, y, 41.9);
          const r = 0.1 + a * 0.13;
          v.set(x + (a - 0.5) * 0.6, r * 0.45, y + (b - 0.5) * 0.6);
          q.setFromEuler(new THREE.Euler(a * 3, b * 3, (a + b) * 2));
          s.set(r * 2, r * 1.3, r * 2);
          m.compose(v, q, s);
          this.stones.setMatrixAt(stone, m);
          c.setHex(TERRAIN_COLOR.rock).offsetHSL(0, 0, (b - 0.5) * 0.14);
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
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWind = wind;
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
