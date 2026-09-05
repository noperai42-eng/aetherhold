/**
 * The things worth walking to, drawn on the ground where they are.
 *
 * Eighteen sites are laid down on every map at worldgen and none of them were
 * ever visible. A scout walked out, a line appeared in the log, and the map
 * itself never changed — so the three thousand cells past the fence stayed
 * scenery no matter how much was buried in them, and "we found a cache out east"
 * was a sentence rather than a place.
 *
 * The rule here is the one the whole game runs on: what you can see is what is
 * there. An unsurveyed site shows a cairn and a marker over it — *something* is
 * out here, not *what* — and once a settler has read it the cairn is replaced by
 * the find itself: a crate broken open, an ore face split, a cold camp. The
 * marker goes out at the same moment, so a map that starts under eighteen pins
 * ends up under none, and where the colony has been is legible from the
 * isometric camera without a single line of UI.
 *
 * Nothing here is collidable, which is why nothing here is more than knee high.
 * The one tall part is the marker, and a marker that bobs a foot off the ground
 * reads as a pin rather than a post — nobody expects to walk into it. That keeps
 * the promise that the collision and the visuals agree.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { lumpyGeometry } from './decor';
import { BUILDING_COLOR, RESOURCE_COLOR, TERRAIN_COLOR } from './palette';
import type { Site, World } from '../../sim/types';

/** How high the marker floats, and how far it bobs either side of that. */
const PIN_HEIGHT = 2.05;
const PIN_BOB = 0.16;
/** Amber, the colour the HUD already uses for "you could do something here". */
const PIN_COLOR = 0xd8a24a;

/** Room for the biggest arrangement any one site can produce, so nothing clips. */
const STONES_PER_SITE = 8;
const BLOCKS_PER_SITE = 5;
const SHARDS_PER_SITE = 8;

/** One instance of one primitive, in world space. */
interface Piece {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
}

export class LandmarkView {
  readonly group = new THREE.Group();
  private readonly stones: THREE.InstancedMesh;
  private readonly blocks: THREE.InstancedMesh;
  private readonly shards: THREE.InstancedMesh;
  private readonly pins: THREE.InstancedMesh;
  /** Which sites, and whether each has been read. Rebuilt only when this moves. */
  private sig = '';
  /** Where each pin stands, so the bob is a per-frame write and not a rebuild. */
  private pinAt: Array<{ x: number; y: number; phase: number }> = [];

  constructor(world: World) {
    const n = Math.max(1, world.sites.length);
    // Three primitives cover every arrangement below, so the whole set of finds
    // on a map costs four draw calls rather than one per rock. Each is a rounded,
    // smooth-lit version of the shape it stands for: a stone is a worn lump, a
    // plank has softened edges so its silhouette does not cut like a wireframe,
    // and an ore chunk is a nugget — still pinched along its axes, which is what
    // keeps it from reading as one more pebble.
    this.stones = instanced(
      lumpyGeometry(new THREE.IcosahedronGeometry(0.5, 1), 0.07, 11.3),
      n * STONES_PER_SITE,
    );
    this.blocks = instanced(new RoundedBoxGeometry(1, 1, 1, 1, 0.08), n * BLOCKS_PER_SITE);
    this.shards = instanced(
      lumpyGeometry(new THREE.OctahedronGeometry(0.5, 2), 0.12, 17.9),
      n * SHARDS_PER_SITE,
    );
    // Unlit, so it reads as a marker and not as an object with a light on it.
    // Fog still touches it: a pin you can see through a snowstorm would be the
    // one thing on the map that ignores the weather.
    this.pins = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshBasicMaterial({ color: PIN_COLOR }),
      n,
    );
    this.pins.frustumCulled = false;
    this.group.add(this.stones, this.blocks, this.shards, this.pins);
    this.rebuild(world);
  }

  /**
   * `t` is the sim tick, so the bob stops when the game does. A pin still
   * drifting over a frozen colony is the sort of thing that makes a pause feel
   * like a stutter.
   */
  sync(world: World, t: number): void {
    const sig = world.sites.map((s) => `${s.id}${s.found ? '!' : ''}`).join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      this.rebuild(world);
    }
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.pinAt.length; i++) {
      const p = this.pinAt[i]!;
      const phase = t / 20 + p.phase;
      v.set(p.x, PIN_HEIGHT + Math.sin(phase * 1.1) * PIN_BOB, p.y);
      // Turning as well as bobbing, because an octahedron seen edge-on from the
      // isometric camera is a diamond that could be part of the ground.
      e.set(0, phase * 0.7, 0.35);
      q.setFromEuler(e);
      m.compose(v, q, one);
      this.pins.setMatrixAt(i, m);
    }
    this.pins.instanceMatrix.needsUpdate = true;
  }

  private rebuild(world: World): void {
    const stones: Piece[] = [];
    const blocks: Piece[] = [];
    const shards: Piece[] = [];
    this.pinAt = [];

    for (const site of world.sites) {
      if (!site.found) {
        cairn(site, stones);
        this.pinAt.push({ x: site.x, y: site.y, phase: (site.id % 32) * 0.61 });
      } else if (site.kind === 'cache') {
        openCrate(site, blocks, stones);
      } else if (site.kind === 'lode') {
        oreFace(site, shards);
      } else {
        coldCamp(site, blocks, stones);
      }
    }

    fill(this.stones, stones);
    fill(this.blocks, blocks);
    fill(this.shards, shards);
    this.pins.count = this.pinAt.length;
  }

  dispose(): void {
    for (const mesh of [this.stones, this.blocks, this.shards, this.pins]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

/**
 * An unsurveyed site: three stones stacked by somebody who came before.
 *
 * Deliberately the same shape for all three kinds. The player is meant to know
 * there is a reason to walk out here and not what the reason is — a cairn that
 * gave away a medicine cache would make the survey a formality.
 */
function cairn(site: Site, stones: Piece[]): void {
  // Each stone settles into the one below rather than balancing on it — which is
  // what a cairn built by hand looks like, and which keeps the whole stack
  // knee-high. Nothing out here is collidable, so nothing out here is taller
  // than something you would not notice walking through.
  const r = [0.28, 0.2, 0.14];
  let y = 0;
  for (let i = 0; i < r.length; i++) {
    const a = hash(site.id, i * 2 + 1);
    const b = hash(site.id, i * 2 + 2);
    stones.push({
      x: site.x + (a - 0.5) * 0.16,
      y: y + r[i]! * 0.8,
      z: site.y + (b - 0.5) * 0.16,
      rx: a * 2,
      ry: b * 3,
      rz: (a + b) * 1.5,
      sx: r[i]! * 2,
      sy: r[i]! * 1.5,
      sz: r[i]! * 2,
      color: shade(TERRAIN_COLOR.rock, (b - 0.5) * 0.12),
    });
    // Less than the two radii between centres, so they overlap and bite.
    y += r[i]! * 1.05;
  }
}

/** A cache, opened. The lid is off and thrown back — somebody has been here. */
function openCrate(site: Site, blocks: Piece[], stones: Piece[]): void {
  const turn = hash(site.id, 3.3) * Math.PI * 2;
  const wood = RESOURCE_COLOR.wood;
  blocks.push({
    x: site.x,
    y: 0.19,
    z: site.y,
    rx: 0,
    ry: turn,
    rz: 0,
    sx: 0.66,
    sy: 0.38,
    sz: 0.52,
    color: shade(wood, -0.04),
  });
  // Leaning back off the far edge, at the angle a lid falls to rather than flat
  // on the ground, so the crate reads as opened and not as broken.
  blocks.push({
    x: site.x - Math.sin(turn) * 0.3,
    y: 0.42,
    z: site.y - Math.cos(turn) * 0.3,
    rx: -1.15,
    ry: turn,
    rz: 0,
    sx: 0.66,
    sy: 0.06,
    sz: 0.5,
    color: shade(wood, 0.06),
  });
  for (let i = 0; i < 2; i++) {
    const a = hash(site.id, 11 + i);
    const b = hash(site.id, 21 + i);
    stones.push({
      x: site.x + (a - 0.5) * 1.3,
      y: 0.08,
      z: site.y + (b - 0.5) * 1.3,
      rx: a * 3,
      ry: b * 3,
      rz: a * 2,
      sx: 0.2,
      sy: 0.14,
      sz: 0.2,
      color: shade(TERRAIN_COLOR.rock, (a - 0.5) * 0.1),
    });
  }
}

/**
 * A lode, split open. Dark chunks with bright metal in the break.
 *
 * The mining designations the survey lays down are what the colony acts on; this
 * is so that a player looking at the map a week later can see why there is a
 * hole in the ridge over there.
 */
function oreFace(site: Site, shards: Piece[]): void {
  for (let i = 0; i < 5; i++) {
    const a = hash(site.id, 31 + i * 1.7);
    const b = hash(site.id, 41 + i * 1.7);
    const r = 0.2 + a * 0.16;
    shards.push({
      x: site.x + (a - 0.5) * 1.1,
      y: r * 0.6,
      z: site.y + (b - 0.5) * 1.1,
      rx: a * 3,
      ry: b * 3,
      rz: (a + b) * 2,
      sx: r * 2,
      sy: r * 1.6,
      sz: r * 2,
      color: shade(TERRAIN_COLOR.rock, -0.06 + (b - 0.5) * 0.08),
    });
  }
  // The metal itself: small, bright, and sitting in the broken faces. Three is
  // enough to catch the eye from the isometric camera without the outcrop
  // turning into a pile of treasure.
  for (let i = 0; i < 3; i++) {
    const a = hash(site.id, 51 + i * 2.3);
    const b = hash(site.id, 61 + i * 2.3);
    shards.push({
      x: site.x + (a - 0.5) * 0.8,
      y: 0.24 + b * 0.16,
      z: site.y + (b - 0.5) * 0.8,
      rx: a * 3,
      ry: b * 3,
      rz: a * 2,
      sx: 0.16,
      sy: 0.2,
      sz: 0.16,
      color: shade(RESOURCE_COLOR.steel, 0.05),
    });
  }
}

/** Where a survivor was living: a burnt-out fire and the lean-to they slept under. */
function coldCamp(site: Site, blocks: Piece[], stones: Piece[]): void {
  const turn = hash(site.id, 7.7) * Math.PI * 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + turn;
    const j = hash(site.id, 71 + i);
    stones.push({
      x: site.x + Math.cos(a) * 0.42,
      y: 0.07,
      z: site.y + Math.sin(a) * 0.42,
      rx: j * 3,
      ry: a,
      rz: j * 2,
      sx: 0.18,
      sy: 0.13,
      sz: 0.18,
      color: shade(TERRAIN_COLOR.rock, -0.1 + j * 0.1),
    });
  }
  // Two spent sticks across the ring, charred rather than timber-coloured: the
  // fire went out a long time before anybody walked up to it.
  for (let i = 0; i < 2; i++) {
    blocks.push({
      x: site.x,
      y: 0.09,
      z: site.y,
      rx: 0,
      ry: turn + i * 1.2,
      rz: 0.12,
      sx: 0.62,
      sy: 0.07,
      sz: 0.07,
      color: 0x3a3229,
    });
  }
  // The lean-to: one panel propped at an angle. Knee high, like everything else
  // out here, so it is scenery you can see over and not cover you cannot use.
  blocks.push({
    x: site.x + Math.cos(turn + 1.6) * 0.62,
    y: 0.3,
    z: site.y + Math.sin(turn + 1.6) * 0.62,
    rx: 0,
    ry: turn,
    rz: 0.9,
    sx: 0.9,
    sy: 0.07,
    sz: 0.72,
    color: shade(BUILDING_COLOR.fence, -0.08),
  });
}

function instanced(geo: THREE.BufferGeometry, count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The set is small and scattered over the whole map, so per-mesh culling would
  // only ever cull all of it or none of it.
  mesh.frustumCulled = false;
  return mesh;
}

function fill(mesh: THREE.InstancedMesh, pieces: Piece[]): void {
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  // Capacity is sized off the site count at construction, which is the count for
  // the life of the map. The clamp is here so a save with more finds in it than
  // this build expected loses a stone rather than throwing in the render loop.
  // `mesh.count` is the number drawn and moves every rebuild; the allocation is
  // the attribute's length, which does not.
  const n = Math.min(pieces.length, mesh.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const p = pieces[i]!;
    v.set(p.x, p.y, p.z);
    e.set(p.rx, p.ry, p.rz);
    q.setFromEuler(e);
    s.set(p.sx, p.sy, p.sz);
    m.compose(v, q, s);
    mesh.setMatrixAt(i, m);
    c.setHex(p.color);
    mesh.setColorAt(i, c);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Lighten or darken a palette colour without leaving its hue. */
function shade(hex: number, by: number): number {
  return new THREE.Color(hex).offsetHSL(0, 0, by).getHex();
}

function hash(id: number, salt: number): number {
  const n = Math.sin(id * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
