/**
 * Buildings you can see.
 *
 * The sim decides what is solid; this view decides what is on screen. When those
 * two disagree the player walks into an empty cell and calls it a bug — which is
 * exactly what a fence did until this file existed: real cost, real collision, no
 * mesh. So the bar here is mechanical rather than aesthetic — every kind the build
 * menu offers has to put geometry on the ground where the sim says it stands.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { describe, expect, it } from 'vitest';

import {
  BuildingsView,
  COMPRESSOR_DEFAULT,
  COOLER_DEFAULT,
  GEN_DEFAULT,
  LOUVRE_DEFAULT,
  SHELL_DEFAULT,
  GAME_DEFAULT,
  STOVE_DEFAULT,
  TABLE_DEFAULT,
  WALL_DEFAULT,
  gameBoardGeometry,
  gamePiecesGeometry,
  gameStoolsGeometry,
  compressorGeometry,
  coolerLidGeometry,
  genOutletGeometry,
  genStacksGeometry,
  louvreGeometry,
  shellBodyGeometry,
  shellLidGeometry,
  stoveDoorGeometry,
  stoveFeetGeometry,
  stoveFlueGeometry,
  stovePlateGeometry,
  tableLegsGeometry,
  tableTopGeometry,
  wallBodyGeometry,
  wallCapGeometry,
  wallPlinthGeometry,
} from '../src/client/render/buildings';
import { AO_FLOOR } from '../src/client/render/occlusion';
import { BUILDING_COLOR, RESOURCE_COLOR } from '../src/client/render/palette';
import { groundLiftAt } from '../src/client/render/terrain';
import { BUILD_MENU, defOf } from '../src/sim/buildings';
import { defaultCamera } from '../src/sim/save';
import { addBuilding, addItem, removeBuilding } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import type { BuildingKind, ResourceKind, World } from '../src/sim/types';

const SEED = 20260729;

/** Every live instance in the view, as the cell its matrix sits on. */
function instancesAt(view: BuildingsView, x: number, y: number): number {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  let n = 0;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m);
      if (Math.round(pos.x) === x && Math.round(pos.z) === y) n++;
    }
  });
  return n;
}

/** The tallest point of any instance standing on a cell. */
function heightAt(view: BuildingsView, x: number, y: number): number {
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  let top = 0;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      if (Math.round(pos.x) !== x || Math.round(pos.z) !== y) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(m);
      top = Math.max(top, box.max.y);
    }
  });
  return top;
}

/** How far any instance on a cell reaches from the cell's centre, on the ground plane. */
function reachAt(view: BuildingsView, x: number, y: number): number {
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  let reach = 0;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      if (Math.round(pos.x) !== x || Math.round(pos.z) !== y) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(m);
      reach = Math.max(reach, box.max.x - x, x - box.min.x, box.max.z - y, y - box.min.z);
    }
  });
  return reach;
}

/**
 * Which building's palette entry tints each family of pools, by the prefix of the
 * key the view builds them under. The wood is deliberately absent: a tree's parts
 * are tinted with bark and with the season rather than with `BUILDING_COLOR.tree`,
 * so the arithmetic below would be checking the wrong multiplication.
 */
const TINTED_BY: Record<string, BuildingKind> = {
  wall: 'wall',
  stone: 'stonewall',
  lab: 'lab',
  door: 'door',
  bed: 'bed',
  med: 'medbed',
  prison: 'prisonbed',
  table: 'table',
  game: 'gametable',
  stove: 'stove',
  bench: 'bench',
  fish: 'fishhole',
  mill: 'watermill',
  cooler: 'cooler',
  fire: 'campfire',
  heat: 'heater',
  turret: 'turret',
  trap: 'trap',
  sandbag: 'sandbag',
  grave: 'grave',
  statue: 'statue',
  fence: 'fence',
  lamp: 'lamp',
  gen: 'generator',
  conduit: 'conduit',
  batt: 'battery',
  solar: 'solar',
};

/** The darkest per-channel vertex colour in a geometry, or white where it has none. */
function darkestDye(g: THREE.BufferGeometry): [number, number, number] {
  const c = g.attributes.color;
  if (!c) return [1, 1, 1];
  const out: [number, number, number] = [Infinity, Infinity, Infinity];
  for (let k = 0; k < c.count; k++) {
    out[0] = Math.min(out[0], c.getX(k));
    out[1] = Math.min(out[1], c.getY(k));
    out[2] = Math.min(out[2], c.getZ(k));
  }
  return out;
}

/** Triangles in a geometry, indexed or not — what the GPU actually draws per instance. */
function triangles(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

/** A cell nothing already stands on — worldgen scatters trees over most of the map. */
function clearCell(world: World): { x: number; y: number } {
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 2; x++) {
      if (world.cellBuilding[y * world.width + x] === -1) return { x, y };
    }
  }
  throw new Error('no clear cell');
}

/** The start of a run of `n` clear cells stepping by (dx, dy) — somewhere to build a wall. */
function clearRun(world: World, dx: number, dy: number, n: number): { x: number; y: number } {
  for (let y = 2; y < world.height - 2 - Math.abs(dy) * n; y++) {
    for (let x = 2; x < world.width - 2 - Math.abs(dx) * n; x++) {
      let clear = true;
      for (let i = 0; i < n; i++) {
        if (world.cellBuilding[(y + dy * i) * world.width + (x + dx * i)] !== -1) clear = false;
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no clear run');
}

function place(world: World, kind: BuildingKind, x: number, y: number): void {
  const b = addBuilding(world, kind, x, y, true);
  expect(b, `${kind} could not be placed at ${x},${y}`).not.toBeNull();
}

describe('the buildings view', () => {
  it('draws something for every kind the build menu offers', () => {
    for (const kind of BUILD_MENU) {
      const world = createWorld(SEED);
      const view = new BuildingsView();
      const { x, y } = clearCell(world);
      view.sync(world);
      const before = instancesAt(view, x, y);
      place(world, kind, x, y);
      view.sync(world);
      expect(instancesAt(view, x, y), `${kind} draws nothing`).toBeGreaterThan(before);
      view.dispose();
    }
  });

  it('draws a blueprint for every kind before it is built', () => {
    for (const kind of BUILD_MENU) {
      const world = createWorld(SEED);
      const view = new BuildingsView();
      const { x, y } = clearCell(world);
      addBuilding(world, kind, x, y, false);
      view.sync(world);
      expect(instancesAt(view, x, y), `${kind} has no blueprint`).toBeGreaterThan(0);
      view.dispose();
    }
  });

  it('stands each building as tall as the sim says it is', () => {
    // The one number a player checks without meaning to: a wall they cannot see
    // over and a fence they can are different buildings, and the difference is
    // `def.height`. Sandbags are the deliberate exception — the sim treats the
    // stack as low cover and the mesh is two courses of bags, not a slab.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    for (const kind of ['wall', 'stonewall', 'fence', 'door'] as const) {
      const { x, y } = clearCell(world);
      place(world, kind, x, y);
      view.sync(world);
      const top = heightAt(view, x, y);
      const want = defOf(kind).height;
      expect(Math.abs(top - want), `${kind} is ${top} tall, sim says ${want}`).toBeLessThan(0.25);
    }
    view.dispose();
  });

  it('shades nothing flat, because a faceted cylinder is a polygon with a light on it', () => {
    // Smoothness is a property of the materials and the segment counts, not of
    // the camera, so it can be checked without one. A single pool left with
    // `flatShading` on would put one faceted thing in a colony of smooth ones,
    // and the eye finds the odd one out before it finds anything else.
    const view = new BuildingsView();
    view.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.flatShading, `${mesh.geometry.type} pool is flat-shaded`).toBe(false);
    });
    view.dispose();
  });

  it('keeps the parts drawn by the hundred cheap', () => {
    // Walls, fences, conduits and trees are what a colony is mostly made of, and
    // each of their parts is instanced a few hundred times. Detail on those is
    // paid for on every cell of the perimeter and every tree in the wood, so a
    // pool sized for that many instances has a triangle ceiling per part, and
    // the ceiling is what lets the furniture spend more.
    const view = new BuildingsView();
    view.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const capacity = mesh.instanceMatrix.count;
      if (capacity < 256) return;
      expect(triangles(mesh.geometry), `a ${capacity}-instance pool draws ${triangles(mesh.geometry)} triangles`).toBeLessThanOrEqual(400);
    });
    view.dispose();
  });

  it('keeps furniture inside its own cell', () => {
    // A bed that pokes into the next cell is a bed a settler walks through, and
    // a stove whose flue stands in the corridor is a stove you cannot get past
    // in first person. Only the things built to reach out are exempt: a fence's
    // rails, a conduit's arms, a turret's barrel, the rod and the wheel that
    // hang over the water, the door on its swing and the crown of a tree.
    const reaching = new Set<BuildingKind>(['fence', 'conduit', 'turret', 'fishhole', 'watermill', 'door', 'tree']);
    const world = createWorld(SEED);
    const view = new BuildingsView();
    for (const kind of BUILD_MENU) {
      if (reaching.has(kind)) continue;
      const { x, y } = clearCell(world);
      place(world, kind, x, y);
      view.sync(world);
      expect(reachAt(view, x, y), `${kind} reaches ${reachAt(view, x, y)} from its centre`).toBeLessThanOrEqual(0.56);
    }
    view.dispose();
  });

  it('leaves no part dark enough to be a hole in the ground at noon', () => {
    // A pool's material colour is a *multiplier* on the palette entry the
    // instance is tinted with, and that is the trap this test exists for. Round
    // 9's frames had the lamp reading as a flat black bowl at midday, on the one
    // surface in the colony the sun is directly above; the shade was not wound
    // inside out and the lighting had not failed — dark iron (0x3c3835) stated as
    // a multiplier on warm brass (0xb9a06a) is nine parts in a thousand of
    // reflectance, and no amount of sun rescues that. Twenty other parts were the
    // same arithmetic, all of them accents on machines. So the check is on the
    // product, not on either factor: whatever the palette does and whatever a
    // part is toned, what the sun actually lands on has to stay above the floor
    // where a surface stops having a colour and starts being a silhouette.
    //
    // Grass is about 0.2 in these units and the darkest thing the colony is
    // allowed to own is a bed's dark timber frame, at 0.033. The floor sits just
    // under that: every one of the parts round 9 caught came out between 0.001
    // and 0.023, so this is the line that has them all on the wrong side of it
    // and nothing that was ever meant to be dark.
    const FLOOR = 0.025;
    const view = new BuildingsView();
    let darkest = Infinity;
    let worst = '';
    view.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const kind = TINTED_BY[mesh.geometry.name.split('.')[0]];
      if (!kind) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      // A part that makes its own light is exempt: an ember or a lit globe is
      // read off its emissive, and its base colour is deliberately near-black.
      // But the exemption has to be "bright enough to actually be read off",
      // not "carries any emissive at all". Stated the loose way it let the
      // stove's hotplates through on eight thousandths of glow over four
      // thousandths of albedo — the darkest surface in the colony, facing
      // straight up, and a member of the very class this test exists to catch.
      // The seven parts that genuinely make light sit between 0.046 and 0.897,
      // nowhere near this line, so the tighter rule costs nothing real.
      const glow = 0.2126 * mat.emissive.r + 0.7152 * mat.emissive.g + 0.0722 * mat.emissive.b;
      if (glow > FLOOR) return;
      // A pool that dyes its vertices carries a third multiplier, and the part
      // that matters is the darkest tone in it — a wheel's spokes, a wall's
      // darkest board.
      const dye = darkestDye(mesh.geometry);
      const tint = new THREE.Color().setHex(BUILDING_COLOR[kind]);
      const lit =
        (1 - mat.metalness) *
        (0.2126 * mat.color.r * tint.r * dye[0] + 0.7152 * mat.color.g * tint.g * dye[1] + 0.0722 * mat.color.b * tint.b * dye[2]);
      if (lit < darkest) {
        darkest = lit;
        worst = `${mesh.geometry.name} under ${kind}`;
      }
    });
    expect(darkest, `${worst} comes out at ${darkest.toFixed(4)}`).toBeGreaterThan(FLOOR);
    view.dispose();
  });

  it('lays a conduit down on the floor instead of standing beads on it', () => {
    // A conduit is the one building whose whole job is to be under everything
    // else, and round 9's frames had it as the loudest thing in a room of beds
    // and tables — a blue rod with round beads threaded on it. A capsule puts its
    // brightest highlight on top, which is exactly where the manager camera is,
    // and the beads read before the line does. Both parts have to stay flatter
    // than they are wide and low enough that a settler's boot would clear them.
    const view = new BuildingsView();
    for (const key of ['conduit.pad', 'conduit.arm']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      // Strictly under, not at: the capsule this test was written against stood
      // exactly 0.06 off the floor, so the loose comparison passed on the one
      // shape it was written to reject and only the aspect check below caught it.
      expect(b.max.y, `${key} stands ${b.max.y} off the floor`).toBeLessThan(0.06);
      expect(b.max.z - b.min.z, `${key} is no wider across than it is tall`).toBeGreaterThan(3 * (b.max.y - b.min.y));
    }
    view.dispose();
  });
});

/** One part of one building, by the key the view built it under. */
function partGeometry(view: BuildingsView, key: string): THREE.BufferGeometry {
  let found: THREE.BufferGeometry | null = null;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (mesh.isInstancedMesh && mesh.geometry.name === key) found = mesh.geometry;
  });
  expect(found, `no pool called ${key}`).not.toBeNull();
  return found!;
}

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

/**
 * How many faces a ray crosses through one part — a headless probe of where a
 * piece of furniture is solid and where it is air. A bounding box cannot tell a
 * frame from a slab and a vertex count cannot either, because a rounded box
 * keeps all its vertices at its corners; a ray through the middle can.
 */
function crossings(g: THREE.BufferGeometry, from: THREE.Vector3, dir: THREE.Vector3): number {
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.updateMatrixWorld();
  const n = new THREE.Raycaster(from, dir, 0, 4).intersectObject(mesh).length;
  mat.dispose();
  return n;
}

/**
 * Every triangle of a part within `depth` metres of the ground, as the area it
 * covers, the outward normal it turns, and how far above the horizontal that
 * normal stands. Optionally through an instance matrix, because the thing the
 * player sees is the prototype after the view has scaled and leaned it, and a
 * non-uniform scale tilts a face rather than carrying it: the normals are taken
 * from the transformed corners for that reason, not transformed themselves.
 */
function footFaces(
  g: THREE.BufferGeometry,
  depth: number,
  m?: THREE.Matrix4,
): { area: number; elev: number; normal: THREE.Vector3 }[] {
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const out: { area: number; elev: number; normal: THREE.Vector3 }[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    const k = [0, 1, 2].map((j) => (idx ? idx.getX(i + j) : i + j));
    a.fromBufferAttribute(pos, k[0]!);
    b.fromBufferAttribute(pos, k[1]!);
    c.fromBufferAttribute(pos, k[2]!);
    if (m) {
      a.applyMatrix4(m);
      b.applyMatrix4(m);
      c.applyMatrix4(m);
    }
    // The cell's ground, which a tree stands on at y = 0 in either space.
    if (Math.max(a.y, b.y, c.y) > depth) continue;
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    const area = normal.length() / 2;
    if (area === 0) continue;
    normal.divideScalar(area * 2);
    out.push({ area, elev: (Math.asin(Math.abs(normal.y)) * 180) / Math.PI, normal });
  }
  return out;
}

/** Every live instance matrix in one pool. */
function matricesOf(view: BuildingsView, key: string): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.geometry.name !== key) return;
    for (let i = 0; i < mesh.count; i++) {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      out.push(m);
    }
  });
  return out;
}

describe('a bed', () => {
  it('has its mattress top at the height the sim lays a sleeper', () => {
    // `standHeight` is where the pawn view draws a body lying in this bed. The
    // sim owns that number; the mesh is built down from it. A mattress two
    // centimetres too high buries the sleeper's shoulders in the ticking, and
    // two centimetres too low leaves them lying on air, and both were true of
    // a bed drawn to a height someone eyeballed. Three beds, one sleeper.
    const view = new BuildingsView();
    for (const [kind, prefix] of [
      ['bed', 'bed'],
      ['medbed', 'med'],
      ['prisonbed', 'prison'],
    ] as const) {
      const g = partGeometry(view, `${prefix}.mattress`);
      g.computeBoundingBox();
      const top = g.boundingBox!.max.y;
      const want = defOf(kind).standHeight;
      expect(Math.abs(top - want), `${kind} mattress tops out at ${top}, sleeper lies at ${want}`).toBeLessThan(0.005);
    }
    view.dispose();
  });

  it('stands on legs with daylight under it, rather than on a slab', () => {
    // From the manager camera a dormitory is read at a glance, and what says
    // "bed" rather than "brown tile with a paler tile on it" is the space: legs
    // at the corners, rails round the edge, floor visible between them. The
    // carcass used to be one solid block the size of the cell, which is the
    // silhouette of a rug. So a ray fired along the bed at ankle height, down
    // the middle where the legs are not, must pass clean through — and the same
    // ray at the rail line must not. A slab fails the first; four legs with no
    // rails between them fail the second. Whichever bed it is.
    const view = new BuildingsView();
    for (const prefix of ['bed', 'med', 'prison']) {
      const g = partGeometry(view, `${prefix}.frame`);
      expect(crossings(g, new THREE.Vector3(-1, 0.08, 0), X), `the ${prefix} bed is solid under its own mattress`).toBe(0);
      expect(crossings(g, new THREE.Vector3(-1, 0.24, 0), X), `the ${prefix} bed has no rails to lie on`).toBeGreaterThan(0);
    }
    view.dispose();
  });
});

/** `box` as `buildings.ts` writes it, for the parts that are not eased. */
function goldenBox(w: number, h: number, d: number, y: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y, 0);
  return g;
}

/** `rbox` as `buildings.ts` writes it, so a golden is built the same way. */
function golden(w: number, h: number, d: number, y: number, r: number): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 2, r);
  g.translate(0, y, 0);
  return g;
}

describe('a table', () => {
  it('carries an apron under its top and tapers its legs toward the floor', () => {
    // A top on four posts has nothing between the underside of the top and the
    // floor, so from above the top floats and the legs read as its shadow. A
    // real table has a frame the legs are jointed into immediately under the
    // top, and that band of timber is what closes the silhouette: a ray fired
    // across the table at that height crosses it, and the same ray halfway down
    // the legs crosses nothing. The taper is the other half — the two radii
    // were the wrong way round, thin at the top and thick at the foot, which is
    // a stool leg — so the legs must be at their widest where they meet the
    // apron.
    const view = new BuildingsView();
    const g = partGeometry(view, 'table.legs');
    expect(crossings(g, new THREE.Vector3(0, 0.76, -1), Z), 'nothing bridges the table legs under the top').toBeGreaterThan(0);
    expect(crossings(g, new THREE.Vector3(0, 0.4, -1), Z), 'the table is boxed in below the apron').toBe(0);
    const pos = g.attributes.position;
    let atFloor = 0;
    let atApron = 0;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      const r = Math.abs(pos.getX(k));
      if (y < 0.02) atFloor = Math.max(atFloor, r);
      if (y > 0.8) atApron = Math.max(atApron, r);
    }
    expect(atApron, `a leg ${atFloor} wide at the floor and ${atApron} at the apron`).toBeGreaterThan(atFloor);
    view.dispose();
  });

  /**
   * The two `rbox` calls the tops were lifted out of: width, thickness, depth,
   * centre height and eased edge. Copied out by hand and frozen, because a
   * recipe checked against the code that reads it agrees with itself whatever
   * either of them says.
   */
  const TOPS_BEFORE: Record<string, [number, number, number, number, number]> = {
    table: [0.98, 0.08, 0.98, 0.86, 0.035],
    game: [0.74, 0.08, 0.74, 0.77, 0.035],
  };

  it('builds both tops byte-identical to the calls they were lifted out of', () => {
    // The dining table and the games table were drawn as separate objects and
    // are one object at two sizes, and the value of saying so in a recipe rests
    // entirely on it having changed nothing on screen. The recipe reaches the
    // slab's centre by arithmetic — `surface - thickness / 2` — where the calls
    // had 0.86 and 0.77 written down, so this asks for the same words, not for
    // close-enough.
    for (const [kind, want] of Object.entries(TOPS_BEFORE)) {
      const a = golden(...want).attributes.position.array as Float32Array;
      const b = tableTopGeometry(TABLE_DEFAULT[kind]!).attributes.position.array as Float32Array;
      expect(b.length, `${kind}.top vertex count`).toBe(a.length);
      let differing = 0;
      for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) differing++;
      expect(differing, `${kind}.top words differing from the shipped buffer`).toBe(0);
    }
  });

  it('stands both sets of legs in exactly the box the frozen calls stood them in', () => {
    // `legs` is private, so there is no golden to build here the way there is
    // for a top; what there is instead is the box the four legs and their apron
    // occupy, which pins every number the recipe hands over. The half-widths are
    // the leg pitch plus the radius at the apron — 0.4 + 0.055 and 0.28 + 0.048
    // — and the top of the box is the leg height, which is the underside of the
    // slab.
    //
    // The floor of the box is the interesting one, and it is why these are
    // `toBe` and not `toBeCloseTo`. The recipe walks down to the leg height in
    // two steps, through the middle of the slab, and the obvious single step of
    // `surface - thickness` gives a number one unit in the last place higher:
    // 0.8200000000000001. At the top of the leg that difference is far below
    // what a float32 can hold apart and nothing moves. At the foot it is not,
    // because the foot sits at zero, where a float32's steps are some eight
    // orders finer than they are at a metre — and the vertices there come out
    // 3.5762788286319847e-9 instead. Fold the derivation and this goes red,
    // which is the whole reason it is written the long way.
    const WANT: Record<string, { half: number; top: number; floor: number }> = {
      table: { half: 0.45500001311302185, top: 0.8199999928474426, floor: 3.5762786065873797e-9 },
      game: { half: 0.328000009059906, top: 0.7300000190734863, floor: -9.53674295089968e-9 },
    };
    for (const [kind, want] of Object.entries(WANT)) {
      const g = tableLegsGeometry(TABLE_DEFAULT[kind]!);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.max.x, `${kind} legs reach x`).toBe(want.half);
      expect(b.min.x, `${kind} legs reach -x`).toBe(-want.half);
      expect(b.max.z, `${kind} legs reach z`).toBe(want.half);
      expect(b.min.z, `${kind} legs reach -z`).toBe(-want.half);
      expect(b.max.y, `${kind} legs meet the underside of the top`).toBe(want.top);
      expect(b.min.y, `${kind} legs stand on the floor`).toBe(want.floor);
    }
  });

  it('holds the two recipes at the numbers the two tables were drawn at', () => {
    // Literal numbers, because a table checked against itself is not a check.
    // Three of these are the reason the two are one family rather than two
    // things that happen to be tables: the slab is the same thickness and the
    // same eased edge on both, and the legs stand the same distance inside the
    // top's edge on both. What differs is a size and a taper.
    expect(TABLE_DEFAULT.table).toEqual({
      width: 0.98, surface: 0.9, thickness: 0.08, round: 0.035, inset: 0.09, legTop: 0.055, legFoot: 0.034,
    });
    expect(TABLE_DEFAULT.game).toEqual({
      width: 0.74, surface: 0.81, thickness: 0.08, round: 0.035, inset: 0.09, legTop: 0.048, legFoot: 0.03,
    });
    expect(Object.keys(TABLE_DEFAULT).sort()).toEqual(['game', 'table']);
  });

  it('still pools a top and legs for both tables', () => {
    // Four `pool` calls rewired, and the way that goes wrong with nothing else
    // noticing is a part quietly ceasing to be pooled: the colony would draw a
    // table top floating over nothing and nothing would throw.
    const view = new BuildingsView();
    for (const key of ['table.top', 'table.legs', 'game.top', 'game.legs']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y, `${key} has height`).toBeGreaterThan(0);
    }
    view.dispose();
  });
});

describe("the games table's trim", () => {
  const box3 = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };

  it('stands all three exactly where the frozen calls stood them', () => {
    // The three parts as they were written before they knew where the table
    // was: a board at 0.825, a piece at 0.852, the stools at 0.38. `merge` and
    // `cylinder` are private, so there is no golden buffer to build here the
    // way there is for a top; the box each part occupies pins every number the
    // recipe hands over, and it is asked for as words rather than as closeness
    // for the same reason the table legs are — a lift that claims to have moved
    // nothing should be made to say so exactly.
    const WANT: Record<string, [number, number, number]> = {
      // max x, min y, max y
      board: [0.25, 0.8100000023841858, 0.8399999737739563],
      pieces: [0.1850000023841858, 0.8399999737739563, 0.8640000224113464],
      stools: [0.5099999904632568, -1.7881393032936899e-9, 0.3400000035762787],
    };
    const built: Record<string, THREE.Box3> = {
      board: box3(gameBoardGeometry(TABLE_DEFAULT.game, GAME_DEFAULT)),
      pieces: box3(gamePiecesGeometry(TABLE_DEFAULT.game, GAME_DEFAULT)),
      stools: box3(gameStoolsGeometry(TABLE_DEFAULT.game, GAME_DEFAULT)),
    };
    for (const [part, [maxX, minY, maxY]] of Object.entries(WANT)) {
      const b = built[part]!;
      expect(b.max.x, `${part} reaches x`).toBe(maxX);
      expect(b.min.x, `${part} reaches -x`).toBe(-maxX);
      expect(b.min.y, `${part} sits at`).toBe(minY);
      expect(b.max.y, `${part} reaches up to`).toBe(maxY);
    }
    // And the one relation that survives float32 exactly: a piece's underside
    // is the same word as the top of the board it stands on.
    expect(built.pieces!.min.y, 'a piece stands on the board and not above it').toBe(built.board!.max.y);
  });

  it('holds the recipe at the numbers the games table was drawn at', () => {
    // Literal numbers, and the six spots are the finding: they were written
    // -0.15, 0.05, 0.15 and -0.05 on a board half a metre across, which is
    // exactly six tenths and two tenths of its half-width, both ways round.
    expect(GAME_DEFAULT).toEqual({
      board: { width: 0.5, thickness: 0.03, round: 0.01 },
      piece: {
        radius: 0.035,
        height: 0.024,
        spots: [
          [-0.6, -0.6],
          [0.2, -0.6],
          [0.6, 0.2],
          [-0.2, 0.2],
          [-0.6, 0.6],
          [0.6, -0.2],
        ],
      },
      stool: { radiusTop: 0.13, radiusFoot: 0.11, height: 0.34, clear: 0.01 },
    });
  });

  it('keeps the table together when the table is a different table', () => {
    // The reason this recipe exists. Every other decorated building in the file
    // places its trim in world coordinates that merely happen to line up with
    // the body underneath — the stove's firebox door sits at z = 0.44 because
    // the stove's body half-depth is 0.43, and nothing says so. Drag a width on
    // one of those and the trim stays put while the body moves out from under
    // it. That is what stops a building being given a bench knob.
    //
    // So this is the pin that a golden cannot be: not "the parts are where they
    // were", which the test above already says, but "the parts still meet each
    // other on a table that was never drawn". A taller, wider table with a
    // thicker slab, none of whose numbers appear anywhere in the trim.
    const turned = { ...TABLE_DEFAULT.game, width: 1.16, surface: 1.05, thickness: 0.12 };
    const board = box3(gameBoardGeometry(turned, GAME_DEFAULT));
    const pieces = box3(gamePiecesGeometry(turned, GAME_DEFAULT));
    const stools = box3(gameStoolsGeometry(turned, GAME_DEFAULT));

    expect(board.min.y, 'the board lies on the new surface').toBeCloseTo(turned.surface, 6);
    expect(pieces.min.y, 'the pieces stand on the board').toBeCloseTo(board.max.y, 6);
    expect(pieces.max.x, 'no piece hangs off the board').toBeLessThanOrEqual(board.max.x);
    expect(pieces.min.x, 'no piece hangs off the board').toBeGreaterThanOrEqual(board.min.x);
    expect(stools.min.y, 'the stools still stand on the ground').toBeCloseTo(0, 6);
    expect(stools.max.x - GAME_DEFAULT.stool.radiusTop, 'a stool clears the wider top').toBeCloseTo(
      turned.width / 2 + GAME_DEFAULT.stool.clear,
      6,
    );
  });

  it('moves the pieces with the board, because a piece is only ever on the board', () => {
    // The spots are fractions for this reason alone. Held as the offsets they
    // used to be, a board twice the size would leave all six huddled in the
    // middle of it.
    const wide = { ...GAME_DEFAULT, board: { ...GAME_DEFAULT.board, width: 1 } };
    const board = box3(gameBoardGeometry(TABLE_DEFAULT.game, wide));
    const pieces = box3(gamePiecesGeometry(TABLE_DEFAULT.game, wide));
    expect(board.max.x).toBeCloseTo(0.5, 6);
    // 0.6 of the new half-width, plus the piece's own radius.
    expect(pieces.max.x).toBeCloseTo(0.6 * 0.5 + GAME_DEFAULT.piece.radius, 6);
  });

  it('still pools a board, pieces and stools', () => {
    const view = new BuildingsView();
    for (const key of ['game.board', 'game.pieces', 'game.stools']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y, `${key} has height`).toBeGreaterThan(0);
    }
    view.dispose();
  });
});

describe("a stove's ironwork", () => {
  /**
   * Every height in a part, once each, low to high.
   *
   * A bounding box would not do here. The stove's feet are four legs and two
   * rails, and the rails live entirely inside the legs' span: move a rail and
   * the box does not change by a millimetre. The set of heights sees it,
   * because the rail's underside is one of the three heights there are.
   */
  const heights = (g: THREE.BufferGeometry) => {
    const a = g.attributes.position.array as Float32Array;
    const set = new Set<number>();
    for (let i = 1; i < a.length; i += 3) set.add(a[i]);
    return [...set].sort((p, q) => p - q);
  };

  const plan = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    return [b.min.x, b.max.x, b.min.z, b.max.z];
  };

  const stove = SHELL_DEFAULT.stove;

  it('stands all three at exactly the heights the frozen calls stood them at', () => {
    // The calls as they were before they knew where the shell was: legs of
    // 0.14 at 0.07, rails at 0.11, a flue whose pipe started at 1.29, hotplates
    // at 1.05. `merge` and `cylinder` are private, so there is no golden buffer
    // to build here, and these are asked for as words rather than as closeness
    // for the reason the table's legs were — a lift that claims to have moved
    // nothing can be made to say so exactly. It was also checked the other way
    // before this test existed: the three merged buffers came out of the
    // recipe byte for byte as they came out of the literals, fifteen thousand
    // words with none differing.
    expect(heights(stoveFeetGeometry(stove, STOVE_DEFAULT))).toEqual([
      -2.98023217215615e-10, 0.07999999821186066, 0.14000000059604645,
    ]);
    expect(heights(stoveFlueGeometry(stove, STOVE_DEFAULT))).toEqual([
      1.0399999618530273, 1.0750000476837158, 1.125, 1.4500000476837158,
      1.4900000095367432, 1.5299999713897705, 1.5399999618530273, 1.590000033378601,
    ]);
    expect(heights(stovePlateGeometry(stove, STOVE_DEFAULT))).toEqual([1.037500023841858, 1.0625]);

    expect(plan(stoveFeetGeometry(stove, STOVE_DEFAULT))).toEqual([
      -0.38999998569488525, 0.38999998569488525, -0.38499999046325684, 0.38499999046325684,
    ]);
    expect(plan(stoveFlueGeometry(stove, STOVE_DEFAULT))).toEqual([
      -0.36000001430511475, -0.1599999964237213, -0.36000001430511475, -0.1599999964237213,
    ]);
    expect(plan(stovePlateGeometry(stove, STOVE_DEFAULT))).toEqual([
      -0.3400000035762787, 0.3400000035762787, -0.03999999910593033, 0.23999999463558197,
    ]);
  });

  it('holds the recipe at the numbers the stove was drawn at', () => {
    expect(STOVE_DEFAULT.feet).toEqual({
      radiusTop: 0.06,
      radiusFoot: 0.085,
      spread: 0.3,
      railWidth: 0.78,
      railHeight: 0.06,
      railDepth: 0.1,
    });
    expect(STOVE_DEFAULT.flue).toEqual({
      offset: 0.26,
      radiusTop: 0.07,
      radiusFoot: 0.075,
      height: 0.5,
      collarRadius: 0.095,
      collarHeight: 0.05,
      collarRise: 0.06,
      bandRadius: 0.095,
      bandHeight: 0.04,
      bandDrop: 0.07,
      capRadiusTop: 0.1,
      capRadiusFoot: 0.085,
      capHeight: 0.06,
      capRise: 0.02,
    });
    expect(STOVE_DEFAULT.plate).toEqual({
      radius: 0.14,
      thickness: 0.025,
      rise: 0.01,
      spread: 0.2,
      forward: 0.1,
    });
  });

  it('takes the flue out of the roof, and not out of where the roof used to be', () => {
    // The strongest shape a pin here can take: no number at all, just two
    // things built and asked whether they touch. The flue's lowest word is the
    // body's highest word, and it stays so when the body is a different body —
    // which is the whole of what the old `1.29` could not say.
    for (const shell of [stove, { ...stove, height: 1.4 }, { ...stove, stand: 0.31 }]) {
      const roof = heights(shellBodyGeometry(shell)).at(-1);
      expect(heights(stoveFlueGeometry(shell, STOVE_DEFAULT))[0]).toBe(roof);
    }
  });

  it('cuts the legs and the rails to the gap the shell stands over, whatever that gap is', () => {
    // Raise the shell on a taller plinth and the legs have to grow with it, or
    // the stove is held up by nothing. Three heights again: the ground, the
    // underside of the rails a rail's thickness below the top, and the top,
    // which is the shell's floor.
    const taller = { ...stove, stand: 0.22 };
    expect(heights(stoveFeetGeometry(taller, STOVE_DEFAULT))).toEqual([
      5.9604643443123e-10, 0.1599999964237213, 0.2199999988079071,
    ]);

    // The legs reach the floor the body actually has. Not to the word, though:
    // the two arrive at the same height along different arithmetic — the legs
    // out of `stand / 2` doubled, the body out of `stand + height / 2` less
    // half its height — and land one float32 step apart. A leg that had not
    // followed `stand` at all would be out by eight centimetres, not by
    // fifteen billionths.
    const floor = heights(shellBodyGeometry(taller))[0];
    const top = heights(stoveFeetGeometry(taller, STOVE_DEFAULT)).at(-1)!;
    expect(Math.abs(top - floor)).toBeLessThan(2e-8);
  });

  it('keeps the hotplates bedded in the roof rather than floating above where it was', () => {
    // A hotplate is let into the iron: its underside is below the roof and its
    // face above it, which is why it reads as part of the stove and not as a
    // disc resting on one. That has to survive the roof moving.
    const taller = { ...stove, height: 1.4 };
    const roof = heights(shellBodyGeometry(taller)).at(-1)!;
    const plate = heights(stovePlateGeometry(taller, STOVE_DEFAULT));
    expect(plate).toEqual([1.537500023841858, 1.5625]);
    expect(plate[0]).toBeLessThan(roof);
    expect(plate.at(-1)!).toBeGreaterThan(roof);
  });

  it('still pools feet, a flue and hotplates', () => {
    const view = new BuildingsView();
    for (const key of ['stove.feet', 'stove.flue', 'stove.plate']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y, `${key} has height`).toBeGreaterThan(0);
    }
    view.dispose();
  });
});
describe("a stove's face", () => {
  const stove = SHELL_DEFAULT.stove;

  const b3 = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };
  const axis = (g: THREE.BufferGeometry, k: number) => {
    const a = g.attributes.position.array as Float32Array;
    const set = new Set<number>();
    for (let i = k; i < a.length; i += 3) set.add(a[i]);
    return [...set].sort((p, q) => p - q);
  };
  const door = (shell = stove, recipe = STOVE_DEFAULT) => stoveDoorGeometry(shell, recipe);
  const vents = (shell = stove) => louvreGeometry(shell, LOUVRE_DEFAULT.stove, 'front');

  it('stands the door and the vents exactly where the frozen calls stood them', () => {
    // The calls as they were before they knew where the face was: a surround at
    // z=0.44, a leaf at 0.475, hinges at 0.46, a handle at 0.5275, a louvre
    // plate at 0.425. Checked the other way too, before this test existed — the
    // two merged buffers came out of the recipe byte for byte as they came out
    // of the literals, 10,116 words with none differing.
    const d = b3(door());
    expect([d.min.x, d.max.x]).toEqual([-0.3199999928474426, 0.3199999928474426]);
    expect([d.min.y, d.max.y]).toEqual([0.33000001311302185, 0.8299999833106995]);
    expect([d.min.z, d.max.z]).toEqual([0.41999998688697815, 0.5550000071525574]);

    // A box does not see this door. The hinges are inside the surround's span in
    // all three axes, and so are the leaf and the handle's bar: every one of
    // them could move without the box changing. So the four planes the chain is
    // actually built on are asked for by name.
    const z = axis(door(), 2);
    expect(z, 'the surround, bedded into the face').toContain(0.41999998688697815);
    expect(z, 'its front, which the hinges stand on').toContain(0.46000000834465027);
    expect(z, "the leaf's back, lapped inside that front").toContain(0.44999998807907104);
    expect(z, "the leaf's front, which the handle starts on").toContain(0.5);

    // The vents are small enough to write out whole, so they are.
    expect(axis(vents(), 0)).toEqual([
      -0.25999999046325684, -0.2199999988079071, 0.2199999988079071, 0.25999999046325684,
    ]);
    expect(axis(vents(), 1)).toEqual([
      0.14785748720169067, 0.1599999964237213, 0.17261755466461182, 0.18738245964050293,
      0.20285747945308685, 0.21214252710342407, 0.227617546916008, 0.2423824518918991,
      0.25785747170448303, 0.26714253425598145, 0.2826175391674042, 0.2973824441432953,
      0.3199999928474426, 0.32214251160621643,
    ]);
    expect(axis(vents(), 2)).toEqual([
      0.402643620967865, 0.41499999165534973, 0.41958290338516235, 0.4350000023841858,
      0.46041712164878845, 0.4773563742637634,
    ]);
  });

  it('holds the recipe at the numbers the stove was drawn at', () => {
    expect(STOVE_DEFAULT.door).toEqual({
      surround: { width: 0.64, height: 0.5, depth: 0.04 },
      bed: 0.01,
      leaf: { width: 0.5, height: 0.38, depth: 0.05 },
      lap: 0.01,
      drop: -0.01,
      round: 0.015,
      hinge: { radius: 0.032, height: 0.09, x: -0.27, rise: 0.13 },
      handle: { radius: 0.018, length: 0.055, x: 0.19, barWidth: 0.1, barSize: 0.03, barStand: 0.035 },
    });
  });

  it('beds the door into the face, wherever the face has got to', () => {
    // The headline breakage: at 0.44 on a shell grown to 1.06 deep the whole
    // door is six centimetres inside a box, invisible. It has to straddle the
    // face — back inside it, front proud of it — at any depth.
    for (const depth of [0.86, 1.06, 0.6]) {
      const shell = { ...stove, depth };
      const front = b3(shellBodyGeometry(shell)).max.z;
      const d = b3(door(shell));
      expect(d.min.z, `bedded in at depth ${depth}`).toBeLessThan(front);
      expect(d.max.z, `and proud at depth ${depth}`).toBeGreaterThan(front);
      expect(front - d.min.z, `by a centimetre at depth ${depth}`).toBeCloseTo(0.01, 6);
    }
    // The vents go with it: the plate's middle sits behind the face and only
    // its front edge shows, which is what makes it read as recessed.
    for (const depth of [0.86, 1.06]) {
      const shell = { ...stove, depth };
      const front = b3(shellBodyGeometry(shell)).max.z;
      const v = b3(vents(shell));
      expect(v.min.z, `plate set back at depth ${depth}`).toBeLessThan(front);
      expect(v.max.z, `blades proud at depth ${depth}`).toBeGreaterThan(front);
    }
  });

  it("hangs the door on the shell's own middle, not on where the middle used to be", () => {
    for (const shell of [stove, { ...stove, height: 1.4, stand: 0.22 }, { ...stove, stand: 0.31 }]) {
      const body = b3(shellBodyGeometry(shell));
      const d = b3(door(shell));
      const middle = (body.min.y + body.max.y) / 2;
      expect(middle - (d.min.y + d.max.y) / 2, 'a centimetre low').toBeCloseTo(0.01, 6);
    }
  });

  it("hangs the louvres off the shell's own floor", () => {
    // The plate is seated two centimetres up from the floor, and the lowest
    // blade hangs below its own seat, because a blade is tipped and its front
    // corner drops under the line it sits on. That overhang is the shadow the
    // louvre is drawn for, so the assembly's lowest word is a blade corner and
    // not the plate at all — which is why this asks for the seat by the floor
    // it is measured from rather than by picking the first height off the list.
    const seats = [];
    const drops = [];
    for (const stand of [0.14, 0.22, 0.31]) {
      const shell = { ...stove, stand };
      const floor = b3(shellBodyGeometry(shell)).min.y;
      const v = axis(vents(shell), 1);
      seats.push(v.some((h) => Math.abs(h - (floor + 0.02)) < 2e-7));
      drops.push(v[0] - floor);
    }
    expect(seats, 'a plate seat a plateRise above the floor at every stand').toEqual([true, true, true]);
    // And the overhang below that floor is the same overhang wherever the floor
    // has got to. A plate written at an absolute 0.16 would keep this constant
    // at one stand and break it at the other two.
    expect(drops[1]).toBeCloseTo(drops[0], 6);
    expect(drops[2]).toBeCloseTo(drops[0], 6);
    expect(drops[0], 'and the lowest blade hangs under the seat').toBeLessThan(0.02);
  });

  it('carries the leaf, the hinges and the handle out with the surround they hang on', () => {
    // The chain, asserted as a chain. Thicken the surround by two centimetres
    // and its front moves out by one; everything hung on that front has to move
    // out by one with it, so the door's outermost word — the tip of the handle,
    // three links downstream — moves by exactly that. A leaf written at an
    // absolute 0.475 would not budge.
    const D = STOVE_DEFAULT.door;
    const thicker = {
      ...STOVE_DEFAULT,
      door: { ...D, surround: { ...D.surround, depth: D.surround.depth + 0.02 } },
    };
    const before = b3(door());
    const after = b3(door(stove, thicker));
    expect(after.max.z - before.max.z, 'the handle rode out with it').toBeCloseTo(0.01, 6);
    expect(after.min.z - before.min.z, 'and the surround grew inwards too').toBeCloseTo(-0.01, 6);
  });

  it('moves only what is downstream of the lap', () => {
    // The other half of the same claim. Lap the leaf a centimetre deeper into
    // the surround and the leaf and the handle come back with it, while the
    // surround and the hinges — which are upstream — do not move at all.
    const D = STOVE_DEFAULT.door;
    const lapped = { ...STOVE_DEFAULT, door: { ...D, lap: D.lap + 0.01 } };
    const before = b3(door());
    const after = b3(door(stove, lapped));
    expect(after.max.z - before.max.z, 'the handle came back').toBeCloseTo(-0.01, 6);
    expect(after.min.z, 'the surround did not move').toBe(before.min.z);
  });

  it('still pools a door and vents', () => {
    const view = new BuildingsView();
    for (const key of ['stove.door', 'stove.vents']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y, `${key} has height`).toBeGreaterThan(0);
    }
    view.dispose();
  });
});

describe('a louvre', () => {
  // Four machines have one, and until it was lifted all four built it out of
  // world coordinates that merely happened to line up with the shell behind
  // them. Two numbers were the same in all four and none of the four said so.
  const MACHINES = [
    ['stove', 'front'],
    ['cooler', 'front'],
    ['gen', 'front'],
    ['batt', 'left'],
    ['batt', 'right'],
  ] as const;

  const cut = (name: string, face: 'front' | 'left' | 'right', shell = SHELL_DEFAULT[name]) =>
    louvreGeometry(shell, LOUVRE_DEFAULT[name], face);
  const bounds = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };
  /** How far out of the face a word stands, with out being out on either flank. */
  const reach = (g: THREE.BufferGeometry, face: 'front' | 'left' | 'right', plane: number) => {
    const a = g.attributes.position.array as Float32Array;
    const k = face === 'front' ? 2 : 0;
    const sign = face === 'left' ? -1 : 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < a.length; i += 3) {
      const d = sign * a[i + k] - plane;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return [lo, hi];
  };
  const planeOf = (s: (typeof SHELL_DEFAULT)[string], face: string) =>
    face === 'front' ? s.depth / 2 : s.width / 2;

  it('holds the four louvres at the numbers they were drawn at', () => {
    expect(LOUVRE_DEFAULT.stove).toEqual({
      plate: { across: 0.52, height: 0.16, thick: 0.02 },
      plateSet: 0.005,
      plateRise: 0.02,
      blade: { across: 0.44, height: 0.03, thick: 0.07 },
      bladeTilt: -0.6,
      bladeRise: 0.02,
      bladePitch: 0.055,
      bladeCount: 3,
      bladeStand: 0.01,
    });
    expect(LOUVRE_DEFAULT.cooler).toEqual({
      plate: { across: 0.54, height: 0.3, thick: 0.02 },
      plateSet: 0.005,
      plateRise: 0.15,
      blade: { across: 0.46, height: 0.03, thick: 0.07 },
      bladeTilt: -0.6,
      bladeRise: 0.04,
      bladePitch: 0.075,
      bladeCount: 4,
      bladeStand: 0.01,
    });
    expect(LOUVRE_DEFAULT.gen).toEqual({
      plate: { across: 0.5, height: 0.34, thick: 0.02 },
      plateSet: 0.005,
      plateRise: 0.54,
      blade: { across: 0.42, height: 0.028, thick: 0.07 },
      bladeTilt: -0.6,
      bladeRise: 0.06,
      bladePitch: 0.075,
      bladeCount: 4,
      bladeStand: 0.01,
    });
    expect(LOUVRE_DEFAULT.batt).toEqual({
      plate: { across: 0.56, height: 0.36, thick: 0.02 },
      plateSet: 0.01,
      plateRise: 0.12,
      blade: { across: 0.52, height: 0.028, thick: 0.06 },
      bladeTilt: -0.6,
      bladeRise: 0.08,
      bladePitch: 0.09,
      bladeCount: 3,
      bladeStand: 0.01,
    });

    // The two numbers that were written out four times over. Asserted against
    // each other rather than against 0.005 and 0.01, because the claim is that
    // the four agree, not what they agree on: retune one and this says so.
    const all = [LOUVRE_DEFAULT.stove, LOUVRE_DEFAULT.cooler, LOUVRE_DEFAULT.gen, LOUVRE_DEFAULT.batt];
    expect(all.map((r) => r.bladeStand), 'all four stand their blades equally proud').toEqual([
      all[0].bladeStand, all[0].bladeStand, all[0].bladeStand, all[0].bladeStand,
    ]);
    expect(all.map((r) => r.bladeTilt), 'and tip them by the same angle').toEqual([
      all[0].bladeTilt, all[0].bladeTilt, all[0].bladeTilt, all[0].bladeTilt,
    ]);
    // Three of the four; the battery's plate is flush with its flank rather
    // than proud of it, which is a drawing decision and is pinned as one.
    expect([LOUVRE_DEFAULT.stove, LOUVRE_DEFAULT.cooler, LOUVRE_DEFAULT.gen].map((r) => r.plateSet)).toEqual([
      0.005, 0.005, 0.005,
    ]);
    expect(LOUVRE_DEFAULT.batt.plateSet).toBe(LOUVRE_DEFAULT.batt.plate.thick / 2);
  });

  it('stands all five exactly where the frozen calls stood them', () => {
    // The calls as they were before they knew which face they were cut into.
    // Checked the other way too, before this test existed: five louvres out of
    // the recipe byte for byte as they came out of the literals, 6,804 words
    // with none differing, and the four pools they belong to unchanged except
    // the generator's, whose plate moved three parts along to sit with its own
    // blades — a permutation of 936 triangles, not one of them moved.
    const box = (name: string, face: 'front' | 'left' | 'right') => {
      const b = bounds(cut(name, face));
      return [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z];
    };
    expect(box('stove', 'front')).toEqual([
      -0.25999999046325684, 0.25999999046325684, 0.14785748720169067, 0.32214251160621643,
      0.402643620967865, 0.4773563742637634,
    ]);
    expect(box('cooler', 'front')).toEqual([
      -0.27000001072883606, 0.27000001072883606, 0.25, 0.550000011920929,
      0.402643620967865, 0.4773563742637634,
    ]);
    expect(box('gen', 'front')).toEqual([
      -0.25, 0.25, 0.6600000262260437, 1, 0.3832082450389862, 0.4567917287349701,
    ]);
    expect(box('batt', 'left')).toEqual([
      -0.47266507148742676, -0.40733492374420166, 0.2199999988079071, 0.5799999833106995,
      -0.2800000011920929, 0.2800000011920929,
    ]);
    expect(box('batt', 'right')).toEqual([
      0.40733492374420166, 0.47266507148742676, 0.2199999988079071, 0.5799999833106995,
      -0.2800000011920929, 0.2800000011920929,
    ]);
  });

  it('cuts every one of them into the face its own shell actually has', () => {
    // The headline breakage, and the reason the round exists: the cooler's
    // grille sat at z = 0.425 because the cooler's half-depth was 0.43, and
    // nothing in the code said so. Grow the shell and the grille is inside it.
    for (const [name, face] of MACHINES) {
      const base = SHELL_DEFAULT[name];
      const turned = [base, { ...base, depth: base.depth + 0.2 }, { ...base, width: base.width + 0.2 }];
      const reaches = turned.map((shell) => reach(cut(name, face, shell), face, planeOf(shell, face)));
      for (const [lo, hi] of reaches) {
        expect(lo, `${name}.${face} beds into the face`).toBeLessThan(0);
        expect(hi, `${name}.${face} stands blades proud of it`).toBeGreaterThan(0);
      }
      // And by the same amount whatever the shell has become. A louvre written
      // in world coordinates keeps this at one shell and breaks it at the rest.
      expect(reaches[1][1], `${name}.${face} follows a deeper shell`).toBeCloseTo(reaches[0][1], 6);
      expect(reaches[2][1], `${name}.${face} follows a wider shell`).toBeCloseTo(reaches[0][1], 6);
      expect(reaches[1][0]).toBeCloseTo(reaches[0][0], 6);
      expect(reaches[2][0]).toBeCloseTo(reaches[0][0], 6);
    }
  });

  it('hangs every one of them off the floor its own shell actually stands on', () => {
    for (const [name, face] of MACHINES) {
      const base = SHELL_DEFAULT[name];
      const heights = [base.stand, base.stand + 0.12, base.stand + 0.3].map((stand) => {
        const shell = { ...base, stand };
        const floor = bounds(shellBodyGeometry(shell)).min.y;
        return bounds(cut(name, face, shell)).min.y - floor;
      });
      expect(heights[1], `${name}.${face} rides a taller plinth`).toBeCloseTo(heights[0], 6);
      expect(heights[2]).toBeCloseTo(heights[0], 6);
    }
  });

  it('makes the left flank the right one mirrored', () => {
    // Not vertex for vertex — mirroring reverses a box's winding, so the two
    // buffers list their corners in different orders. The assembly is the
    // mirror, and that is what is asked.
    const l = bounds(cut('batt', 'left'));
    const r = bounds(cut('batt', 'right'));
    expect(l.min.x).toBe(-r.max.x);
    expect(l.max.x).toBe(-r.min.x);
    expect([l.min.y, l.max.y, l.min.z, l.max.z]).toEqual([r.min.y, r.max.y, r.min.z, r.max.z]);
  });

  it('tips the blades with their outer edge up', () => {
    // Written down backwards the first time this louvre was documented, which
    // is why it is pinned now: a rotation sign is the easiest thing in a file
    // like this to get wrong and the hardest to see in a frame. On the stove
    // the blades are what reach highest and lowest, so the assembly's own
    // extremes answer it — the highest word stands proud of the face and the
    // lowest lies behind it, which is a blade leaning back and not forward.
    const shell = SHELL_DEFAULT.stove;
    const face = shell.depth / 2;
    const edges = (g: THREE.BufferGeometry) => {
      const a = g.attributes.position.array as Float32Array;
      let lo = Infinity;
      let hi = -Infinity;
      let loZ = 0;
      let hiZ = 0;
      for (let i = 0; i < a.length; i += 3) {
        if (a[i + 1] < lo) { lo = a[i + 1]; loZ = a[i + 2]; }
        if (a[i + 1] > hi) { hi = a[i + 1]; hiZ = a[i + 2]; }
      }
      return [loZ, hiZ];
    };
    const [loZ, hiZ] = edges(cut('stove', 'front'));
    expect(hiZ, 'the high edge is the outer one').toBeGreaterThan(face);
    expect(loZ, 'and the low edge the inner one').toBeLessThan(face);

    // Reverse the tilt and the two swap, which is what says the sign is doing
    // the work rather than the order the corners happen to be listed in.
    const [loZ2, hiZ2] = edges(louvreGeometry(shell, { ...LOUVRE_DEFAULT.stove, bladeTilt: 0.6 }, 'front'));
    expect(hiZ2, 'flipped, the high edge is the inner one').toBeLessThan(face);
    expect(loZ2, 'and the low edge the outer one').toBeGreaterThan(face);
  });

  it('leans every blade back as it rises, on a flank as much as on a front', () => {
    // The stove's test above cannot speak for the other four, because on them
    // the plate reaches higher and lower than any blade and owns both extremes.
    // Worse, a blade is a symmetric box: tilt it either way and its bounding
    // box is the same to the bit, so no golden anywhere can see which way a
    // flank's blades lean. This was found by a mutation that turned the right
    // flank the way a naive lift would turn it and was caught by nothing.
    //
    // What does see it is the height of the corner that reaches furthest out
    // of the face. Tipping the outer end up swings the blade's outer-bottom
    // corner forward and lifts it, so the furthest-out word ends up above the
    // blade's own middle; flip the tilt and it ends up below. That holds on
    // every face, and it is asked of all five. The direction was measured and
    // not reasoned out — the first draft of this line asserted the opposite,
    // which is the same mistake in the same place as the comment that prompted
    // the test, and is why it is written as a comparison against a flipped
    // twin rather than as a number somebody has to believe.
    const furthest = (g: THREE.BufferGeometry, face: 'front' | 'left' | 'right') => {
      const a = g.attributes.position.array as Float32Array;
      const k = face === 'front' ? 2 : 0;
      const sign = face === 'left' ? -1 : 1;
      let out = -Infinity;
      let y = 0;
      for (let i = 0; i < a.length; i += 3) {
        const d = sign * a[i + k];
        if (d > out) { out = d; y = a[i + 1]; }
      }
      return y;
    };
    for (const [name, face] of MACHINES) {
      const leaning = furthest(cut(name, face), face);
      const flipped = louvreGeometry(
        SHELL_DEFAULT[name],
        { ...LOUVRE_DEFAULT[name], bladeTilt: -LOUVRE_DEFAULT[name].bladeTilt },
        face,
      );
      expect(leaning, `${name}.${face} leads with its lifted edge`).toBeGreaterThan(furthest(flipped, face));
    }
  });

  it('still pools a louvre on all four machines', () => {
    const view = new BuildingsView();
    for (const key of ['stove.vents', 'cooler.vent', 'gen.trim', 'batt.trim']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y, `${key} has height`).toBeGreaterThan(0);
    }
    view.dispose();
  });
});

describe("a cooler's lid", () => {
  // The louvre above answers to the shell. This answers to the *lid*, which
  // itself answers to the shell — so every number here is two steps from
  // anything a bench could turn, and until it was lifted all of it was written
  // in world coordinates that had quietly agreed with a lid nobody consulted.
  const shell = SHELL_DEFAULT.cooler;
  const lid = shell.lid!;
  const iron = (s = shell, r = COOLER_DEFAULT) => coolerLidGeometry(s, r);
  const bounds = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };
  const axis = (g: THREE.BufferGeometry, k: number) => {
    const a = g.attributes.position.array as Float32Array;
    const s = new Set<number>();
    for (let i = k; i < a.length; i += 3) s.add(a[i]);
    return [...s].sort((p, q) => p - q);
  };

  it("holds the cooler's ironwork at the numbers it was drawn at", () => {
    expect(COOLER_DEFAULT).toEqual({
      seal: { inset: 0.01, thickness: 0.05, round: 0.01 },
      latch: { width: 0.16, height: 0.05, depth: 0.04, drop: 0.02, stand: 0.01 },
      handle: {
        postRadius: 0.025,
        postHeight: 0.06,
        postSpread: 0.18,
        postForward: 0.16,
        postBed: 0.01,
        barWidth: 0.44,
        barHeight: 0.05,
        barDepth: 0.07,
        barRise: 0.055,
        barRound: 0.02,
      },
      stubs: { radius: 0.035, length: 0.18, spread: 0.26, drop: 0.01, behind: 0.01 },
    });
  });

  it('stands every piece exactly where the frozen calls stood it', () => {
    const b = bounds(iron());
    expect([b.min.x, b.max.x]).toEqual([-0.44999998807907104, 0.44999998807907104]);
    expect([b.min.y, b.max.y]).toEqual([1.184999942779541, 1.5]);
    expect([b.min.z, b.max.z]).toEqual([-0.4749999940395355, 0.49000000953674316]);

    // Six pieces sit inside each other's envelope in at least one axis, so the
    // box above sees almost none of them move. The height of every word in the
    // assembly does, and height is the axis all four of the lid's knobs turn.
    expect(axis(iron(), 1)).toEqual([
      1.184999942779541, 1.1879289150238037, 1.189226508140564, 1.1950000524520874,
      1.225000023841858, 1.2307734489440918, 1.232071042060852, 1.2350000143051147,
      1.274999976158142, 1.3250000476837158, 1.375, 1.3776642084121704,
      1.3852512836456299, 1.3966060876846313, 1.409999966621399, 1.423393964767456,
      1.4347487688064575, 1.4423357248306274, 1.4450000524520874, 1.4500000476837158,
      1.4558578729629517, 1.4584529399871826, 1.4700000286102295, 1.4800000190734863,
      1.4915469884872437, 1.4941421747207642, 1.5,
    ]);

    // And the four faces the box cannot reach, because something else in the
    // merge stands further out on the same axis.
    const xs = new Set(axis(iron(), 0));
    const zs = new Set(axis(iron(), 2));
    expect(zs.has(0.44999998807907104), "the latch's back, bedded into the lid's front").toBe(true);
    expect(xs.has(0.3499999940395355), "a stub's outer end").toBe(true);
    expect(zs.has(0.125) && zs.has(0.19499999284744263), "the bar's two faces").toBe(true);
    expect(zs.has(0.13500000536441803) && zs.has(0.1850000023841858), "a post's two faces").toBe(true);
  });

  it('carries all of it up when the shell it stands on grows taller', () => {
    // The whole assembly is furniture on a lid, and the lid rides the body's
    // top. Nothing here should know how tall the body is except through that.
    const base = bounds(iron());
    const taller = bounds(iron({ ...shell, height: shell.height + 0.2 }));
    expect(taller.min.y - base.min.y).toBeCloseTo(0.2, 6);
    expect(taller.max.y - base.max.y).toBeCloseTo(0.2, 6);
    expect([taller.min.z, taller.max.z]).toEqual([base.min.z, base.max.z]);
  });

  it('raises only what stands on the lid when the lid gets thicker', () => {
    // The other half of the same relation, and the one a single golden would
    // miss: the seal bridges the joint *below* the lid, so a taller lid lifts
    // the handle and leaves the seal exactly where it was. A version that hung
    // everything off the lid's top would pass the test above and fail this one.
    const base = bounds(iron());
    const thick = bounds(iron({ ...shell, lid: { ...lid, height: lid.height + 0.1 } }));
    expect(thick.max.y - base.max.y).toBeCloseTo(0.1, 6);
    expect(thick.min.y).toBe(base.min.y);

    // A deeper seat lifts the lid bodily, so the handle takes the whole of it
    // while the seal — sitting in the middle of that gap — takes half.
    const seated = bounds(iron({ ...shell, lid: { ...lid, seat: lid.seat + 0.03 } }));
    expect(seated.max.y - base.max.y).toBeCloseTo(0.03, 6);
    expect(seated.min.y - base.min.y).toBeCloseTo(0.015, 6);
  });

  it('beds the seal into both the body and the lid it bridges', () => {
    // Literal-free, because what matters is not where the seal is but that it
    // is thicker than the gap it covers and centred on it. A seal exactly as
    // thick as the seat would be flush with both and would show a seam.
    const g = iron();
    const ys = axis(g, 1);
    const seat = shell.stand + shell.height;
    const gap = lid.seat;
    const middle = seat + gap / 2;
    expect(ys[0], 'the seal reaches below the body top it beds into').toBeLessThan(seat);

    // Its far face is asked for as the reflection of its near one, which is
    // both the centring and the thickness in one line and needs no number of
    // its own. Reached for by name rather than by picking the first word above
    // the joint: the seal's corners are eased, so several words sit between
    // its two faces and the lowest of them is an arc and not the face.
    const far = 2 * middle - ys[0];
    expect(ys.some((y) => Math.abs(y - far) < 1e-6), 'the seal is not centred on the seat').toBe(true);
    expect(far, 'the seal reaches above the lid underside it beds into').toBeGreaterThan(seat + gap);
  });

  it('beds the handle posts into the lid rather than perching them on it', () => {
    // The posts live wholly inside the bar's and the stubs' height, so every
    // box in this block is blind to them: a mutation freezing them at the world
    // coordinate they were drawn at was caught by nothing above. What sees them
    // is a window in z that holds the handle and nothing else — the latch is
    // further forward, the seal and the stubs are further back — and the lowest
    // word in it, which is a post's foot and is *below* the lid's top, because
    // a post that merely touched the lid would show daylight under it.
    const foot = (s = shell) => {
      const g = iron(s);
      const a = g.attributes.position.array as Float32Array;
      let y = Infinity;
      for (let i = 0; i < a.length; i += 3) {
        if (a[i + 2] > 0.1 && a[i + 2] < 0.2 && a[i + 1] < y) y = a[i + 1];
      }
      return y;
    };
    const top = shell.stand + shell.height + lid.seat + lid.height;
    expect(foot(), 'the posts stand on the lid instead of biting into it').toBeLessThan(top);

    const thick = { ...shell, lid: { ...lid, height: lid.height + 0.1 } };
    const seated = { ...shell, lid: { ...lid, seat: lid.seat + 0.03 } };
    expect(foot(thick) - foot(), 'a thicker lid leaves the posts behind').toBeCloseTo(0.1, 6);
    expect(foot(seated) - foot(), 'a deeper seat leaves the posts behind').toBeCloseTo(0.03, 6);

    // And the bar rides them: the gap between a post's foot and the bar's own
    // underside is the same however the lid is turned.
    const under = (s = shell) => {
      const g = iron(s);
      const a = g.attributes.position.array as Float32Array;
      let y = Infinity;
      for (let i = 0; i < a.length; i += 3) {
        if (a[i + 2] > 0.12 && a[i + 2] < 0.13 && a[i + 1] < y) y = a[i + 1];
      }
      return y;
    };
    expect(under(thick) - foot(thick)).toBeCloseTo(under() - foot(), 6);
  });

  it('takes the stubs from the body behind and the latch from the lid in front', () => {
    // The mixed anchor the recipe writes down. The stubs were drawn a
    // centimetre behind the *body's* back face at a height only the lid has,
    // and the overhang is what tells the two apart: widen it and the latch
    // walks forward with the lid's front while the stubs do not move at all.
    const base = bounds(iron());
    const wide = bounds(iron({ ...shell, lid: { ...lid, overhang: lid.overhang + 0.1 } }));
    expect(wide.max.z - base.max.z, 'the latch follows the lid it is fixed to').toBeCloseTo(0.05, 6);
    expect(wide.min.z, 'the stubs stay on the body they were hung off').toBe(base.min.z);

    // And the height they do share, so this is a mixed anchor and not simply
    // an assembly that ignores the lid.
    const thick = bounds(iron({ ...shell, lid: { ...lid, height: lid.height + 0.1 } }));
    const back = (b: THREE.Box3) => b.min.z;
    expect(back(thick)).toBe(back(base));
    const stubTop = (s: (typeof SHELL_DEFAULT)[string]) => {
      const g = iron(s);
      const a = g.attributes.position.array as Float32Array;
      let y = -Infinity;
      for (let i = 0; i < a.length; i += 3) if (a[i + 2] < -shell.depth / 2 && a[i + 1] > y) y = a[i + 1];
      return y;
    };
    expect(stubTop({ ...shell, lid: { ...lid, height: lid.height + 0.1 } }) - stubTop(shell)).toBeCloseTo(0.1, 6);
  });

  it("still pools the cooler's lid furniture", () => {
    const view = new BuildingsView();
    const g = partGeometry(view, 'cooler.vent');
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y, 'the handle stands above the lid').toBeGreaterThan(1.4);
    view.dispose();
  });
});

describe("a cooler's back", () => {
  // The first trim in this file to hang off the face *behind* a machine. Every
  // anchor before it has been a front or a flank, and the back turns out to
  // want a different one: the compressor and its fins answer to the shell, and
  // the cable answers to the ground.
  const shell = SHELL_DEFAULT.cooler;
  const body = COMPRESSOR_DEFAULT.body;
  const iron = (s = shell, r = COMPRESSOR_DEFAULT) => compressorGeometry(s, r);
  const bounds = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };
  const spine = shell.stand + body.rise + body.height / 2;
  /**
   * The furthest-back word above the body's middle. No cable reaches that high
   * — the vertical run tops out well below it — so this sees the fins when
   * there are fins and the body's own back face when there are none, which is
   * what lets the straddle be asked without a number.
   */
  const behind = (s = shell, r = COMPRESSOR_DEFAULT) => {
    const a = iron(s, r).attributes.position.array as Float32Array;
    let z = Infinity;
    const middle = s.stand + r.body.rise + r.body.height / 2;
    for (let i = 0; i < a.length; i += 3) if (a[i + 1] > middle && a[i + 2] < z) z = a[i + 2];
    return z;
  };
  const finless = (r = COMPRESSOR_DEFAULT) => ({ ...r, fins: { ...r.fins, count: 0 } });

  it('holds the compressor at the numbers it was drawn at', () => {
    expect(COMPRESSOR_DEFAULT).toEqual({
      body: { across: 0.5, height: 0.32, thick: 0.1, round: 0.03, bed: 0.03, rise: 0.12 },
      fins: { across: 0.42, height: 0.02, thick: 0.04, pitch: 0.08, count: 3 },
      cable: {
        flank: 0.01,
        downRadius: 0.028,
        downLength: 0.22,
        downRise: 0.17,
        downSet: 0.03,
        runRadius: 0.026,
        runLength: 0.14,
        runLift: 0.03,
      },
    });
  });

  it('stands every piece exactly where the frozen calls stood it', () => {
    const b = bounds(iron());
    expect([b.min.x, b.max.x]).toEqual([-0.25, 0.2879999876022339]);
    expect([b.min.y, b.max.y]).toEqual([0.003999999258667231, 0.5400000214576721]);
    expect([b.min.z, b.max.z]).toEqual([-0.5260000228881836, -0.33399999141693115]);

    // The body is interior in z — the cable's ground run reaches further back
    // and further forward than any of it — so the box above cannot see the one
    // face that matters most, the front one buried in the shell. Every plane
    // the assembly is built on is written out instead.
    const a = iron().attributes.position.array as Float32Array;
    const zs = new Set<number>();
    for (let i = 2; i < a.length; i += 3) zs.add(a[i]);
    expect([...zs].sort((p, q) => p - q)).toEqual([
      -0.5260000228881836, -0.5199999809265137, -0.5183847546577454, -0.5,
      -0.49799999594688416, -0.49121320247650146, -0.48979899287223816,
      -0.48732051253318787, -0.48399999737739563, -0.47999998927116394,
      -0.4699999988079071, -0.4560000002384186, -0.45020100474357605,
      -0.44200000166893005, -0.4300000071525574, -0.4126794934272766,
      -0.408786803483963, -0.4000000059604645, -0.36000001430511475,
      -0.341615229845047, -0.33399999141693115,
    ]);
  });

  it('beds the compressor into whatever back face its shell actually has', () => {
    // Turn the depth and the whole of it walks back by half of it — the cable's
    // ground run included, because that run lies on the shell's own back plane
    // and is the only piece here that touches it exactly.
    const b = bounds(iron());
    const deep = bounds(iron({ ...shell, depth: shell.depth + 0.2 }));
    expect(deep.min.z - b.min.z).toBeCloseTo(-0.1, 6);
    expect(deep.max.z - b.max.z).toBeCloseTo(-0.1, 6);

    // And the body's front face is buried by the bed it was given, asked of a
    // shell that was never drawn so no world coordinate can satisfy it.
    const other = { ...shell, depth: 1.3 };
    const front = (s: typeof shell) => {
      const a = iron(s, finless()).attributes.position.array as Float32Array;
      let z = -Infinity;
      const middle = s.stand + body.rise + body.height / 2;
      for (let i = 0; i < a.length; i += 3) if (a[i + 1] > middle && a[i + 2] > z) z = a[i + 2];
      return z;
    };
    expect(front(other) - -other.depth / 2).toBeCloseTo(body.bed, 6);
  });

  it('straddles every fin on the compressor’s own back, half in and half out', () => {
    // Literal-free both ways: the fins reach exactly half their thickness
    // behind the back face of a body built without them, and when that body
    // gets thicker they follow it back by the whole of the change. A version
    // that sat the fins *on* the back instead of across it passes neither.
    expect(behind(shell, finless()) - behind()).toBeCloseTo(COMPRESSOR_DEFAULT.fins.thick / 2, 6);

    const thick = {
      ...COMPRESSOR_DEFAULT,
      body: { ...body, thick: body.thick + 0.06 },
    };
    expect(behind(shell, thick) - behind()).toBeCloseTo(-0.06, 6);
    expect(behind(shell, finless(thick)) - behind(shell, finless())).toBeCloseTo(-0.06, 6);
  });

  it('centres the fins on the compressor’s own middle', () => {
    // The band of heights behind the body's back face and above everything the
    // cable reaches: with three fins it is the outer two, with one it is that
    // one, and either way it is centred on the body's middle rather than on a
    // height somebody typed.
    const band = (r = COMPRESSOR_DEFAULT) => {
      const a = iron(shell, r).attributes.position.array as Float32Array;
      const floor = behind(shell, finless(r));
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < a.length; i += 3) {
        if (a[i + 2] < floor && a[i + 1] > r.cable.runLift + r.cable.runRadius) {
          lo = Math.min(lo, a[i + 1]);
          hi = Math.max(hi, a[i + 1]);
        }
      }
      return [lo, hi];
    };
    const { fins } = COMPRESSOR_DEFAULT;
    const [lo, hi] = band();
    expect((lo + hi) / 2).toBeCloseTo(spine, 6);
    expect(hi - lo).toBeCloseTo((fins.count - 1) * fins.pitch + fins.height, 6);

    const [one, onetop] = band({ ...COMPRESSOR_DEFAULT, fins: { ...fins, count: 1 } });
    expect((one + onetop) / 2).toBeCloseTo(spine, 6);
    expect(onetop - one).toBeCloseTo(fins.height, 6);
  });

  it('lifts the compressor with the plinth and leaves the cable on the ground', () => {
    // The finding this round exists for. Every other piece of trim in this file
    // answers to the shell all the way down; the cable does not, because both
    // its runs are measured from the ground they lie on. Raise the plinth and
    // the compressor climbs while the cable stays exactly where it was — which
    // is also why a tall enough plinth would lift the machine off its own lead,
    // and that is a look judgement rather than a broken contract.
    const b = bounds(iron());
    const tall = bounds(iron({ ...shell, stand: shell.stand + 0.3 }));
    expect(tall.max.y - b.max.y, 'the compressor rides the plinth').toBeCloseTo(0.3, 6);
    expect(tall.min.y, 'the cable stays on the ground').toBe(b.min.y);

    // And nothing back here answers to the roof, only to the floor.
    const high = bounds(iron({ ...shell, height: shell.height + 0.4 }));
    expect([high.min.y, high.max.y]).toEqual([b.min.y, b.max.y]);
  });

  it('runs the cable clear of the flank, and only down one of them', () => {
    // The body reaches the same distance either side; the cable stands outside
    // it on the right and nothing balances it on the left, which is deliberate
    // and is the kind of asymmetry a symmetric golden would happily lose.
    const b = bounds(iron());
    const { cable } = COMPRESSOR_DEFAULT;
    expect(b.max.x - body.across / 2).toBeCloseTo(cable.flank + cable.downRadius, 6);
    expect(b.min.x).toBeCloseTo(-body.across / 2, 6);
  });

  it("still pools the cooler's compressor", () => {
    const view = new BuildingsView();
    const g = partGeometry(view, 'cooler.vent');
    g.computeBoundingBox();
    expect(g.boundingBox!.min.z, 'the cable reaches out behind the machine').toBeLessThan(-0.5);
    view.dispose();
  });
});

describe("a generator's stacks and outlet", () => {
  // The last pool on this machine still in world coordinates. Its back repeats
  // the shape the cooler's compressor settled a round earlier and deliberately
  // does not share its recipe — two is not three — so what is asked here is
  // whether the same *relation* holds on different numbers.
  const shell = SHELL_DEFAULT.gen;
  const { stacks, outlet } = GEN_DEFAULT;
  const bounds = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };
  const stacksAt = (s = shell) => bounds(genStacksGeometry(s, GEN_DEFAULT));
  const outletAt = (s = shell) => bounds(genOutletGeometry(s, GEN_DEFAULT));
  const values = (g: THREE.BufferGeometry, k: number) => {
    const a = g.attributes.position.array as Float32Array;
    const set = new Set<number>();
    for (let i = k; i < a.length; i += 3) set.add(a[i]);
    return [...set].sort((p, q) => p - q);
  };
  /** Both halves as one list of numbers, which is all a knob has to disturb. */
  const merged = (...gs: THREE.BufferGeometry[]) =>
    gs.flatMap((g) => [...(g.attributes.position.array as Float32Array)]);

  it("holds the generator's ironwork at the numbers it was drawn at", () => {
    expect(GEN_DEFAULT).toEqual({
      stacks: { radius: 0.04, height: 0.1, seg: 10, bed: 0.01, centre: 0.26, spread: 0.06, forward: 0.25 },
      outlet: {
        width: 0.14,
        height: 0.12,
        thick: 0.06,
        bed: 0.02,
        rise: 0.24,
        beside: 0.28,
        downRadius: 0.03,
        downLength: 0.28,
        downRise: 0.22,
        downSet: 0.01,
        runRadius: 0.028,
        runLength: 0.16,
        runLift: 0.04,
        runSet: 0.01,
      },
    });
  });

  it('stands both pieces exactly where the frozen calls stood them', () => {
    const s = stacksAt();
    expect([s.min.x, s.max.x]).toEqual([0.1619577407836914, 0.35804226994514465]);
    expect([s.min.y, s.max.y]).toEqual([1.1699999570846558, 1.2699999809265137]);
    expect([s.min.z, s.max.z]).toEqual([0.21000000834465027, 0.28999999165534973]);

    const o = outletAt();
    expect([o.min.x, o.max.x]).toEqual([0.20999999344348907, 0.3499999940395355]);
    expect([o.min.y, o.max.y]).toEqual([0.011999999172985554, 0.47999998927116394]);
    expect([o.min.z, o.max.z]).toEqual([-0.5080000162124634, -0.2919999957084656]);

    // The outlet box is interior in z between the lead's two runs, exactly as
    // the compressor was, so the box above cannot see the face it is bedded on.
    expect(values(genOutletGeometry(shell, GEN_DEFAULT), 2)).toEqual([
      -0.5080000162124634, -0.499798983335495, -0.47999998927116394,
      -0.4699999988079071, -0.46121320128440857, -0.45500001311302185,
      -0.44999998807907104, -0.4399999976158142, -0.42500001192092896,
      -0.41878679394721985, -0.4099999964237213, -0.39000001549720764,
      -0.3199999928474426, -0.3002009987831116, -0.2919999957084656,
    ]);
  });

  it('beds the stacks into whatever roof the lid actually makes', () => {
    // All three of the numbers that decide where a lid's top ends up move them,
    // and by the whole of the change: the plinth under the body, the body, and
    // the lid itself. Before this lift the stacks sat at 1.22 through all three.
    const b = stacksAt();
    for (const [name, s, want] of [
      ['a taller body', { ...shell, height: shell.height + 0.3 }, 0.3],
      ['a thicker lid', { ...shell, lid: { ...shell.lid!, height: shell.lid!.height + 0.1 }, }, 0.1],
      ['a taller plinth', { ...shell, stand: shell.stand + 0.2 }, 0.2],
      ['a deeper seat', { ...shell, lid: { ...shell.lid!, seat: shell.lid!.seat + 0.05 } }, 0.05],
    ] as const) {
      const t = stacksAt(s);
      expect(t.min.y - b.min.y, `${name} leaves the stacks behind`).toBeCloseTo(want, 6);
      expect(t.max.y - b.max.y, `${name} stretches the stacks`).toBeCloseTo(want, 6);
    }

    // And the foot is buried, asked of a machine that was never drawn so that
    // no frozen height can satisfy it. A stack merely resting on the lid would
    // show a seam at exactly the height a roof meets the sky.
    const other = { ...shell, height: 1.7, lid: { ...shell.lid!, height: 0.3, seat: 0.04 } };
    const top = other.stand + other.height + other.lid.seat + other.lid.height;
    expect(top - stacksAt(other).min.y).toBeCloseTo(stacks.bed, 6);
  });

  it('stands the pair off to one side of the roof rather than across it', () => {
    // Held as drawn, not tidied. The two stacks straddle a middle of their own
    // that is nowhere near the machine's, and the whole pair is on the right of
    // it — which a golden written as a symmetric span would quietly lose.
    const b = stacksAt();
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(stacks.centre, 6);
    expect(b.min.x, 'the pair has crossed the middle of the roof').toBeGreaterThan(0);

    // Nothing about the plan reaches them: they are offsets from the machine's
    // middle and not fractions of its roof, which is how they were drawn.
    for (const s of [
      { ...shell, depth: shell.depth + 0.2 },
      { ...shell, width: shell.width + 0.2 },
    ]) {
      const t = stacksAt(s);
      expect([t.min.x, t.max.x, t.min.z, t.max.z]).toEqual([b.min.x, b.max.x, b.min.z, b.max.z]);
    }
  });

  it('beds the outlet into whatever back face its shell actually has', () => {
    const b = outletAt();
    const deep = outletAt({ ...shell, depth: shell.depth + 0.2 });
    expect(deep.min.z - b.min.z).toBeCloseTo(-0.1, 6);
    expect(deep.max.z - b.max.z).toBeCloseTo(-0.1, 6);

    // Asked of a shell never drawn: the box's front face is buried by its bed.
    // Reached for by name because the lead runs behind it and in front of it,
    // so the outlet owns neither end of the assembly's own span.
    const other = { ...shell, depth: 1.24 };
    const a = genOutletGeometry(other, GEN_DEFAULT).attributes.position.array as Float32Array;
    let front = -Infinity;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 1] > other.stand + outlet.rise && a[i + 2] > front) front = a[i + 2];
    }
    expect(front - -other.depth / 2).toBeCloseTo(outlet.bed, 6);

    // Nothing back here answers to the roof, only to the floor — which is the
    // opposite of the stacks, on the same machine, out of the same recipe.
    for (const s of [
      { ...shell, height: shell.height + 0.3 },
      { ...shell, lid: { ...shell.lid!, height: shell.lid!.height + 0.1 } },
    ]) {
      const t = outletAt(s);
      expect([t.min.y, t.max.y]).toEqual([b.min.y, b.max.y]);
    }
  });

  it('lifts the outlet with the plinth and leaves the lead on the ground', () => {
    // The cooler's finding, arrived at again from different numbers, which is
    // the whole reason these two were not folded into one recipe: the relation
    // repeats and the values do not. Raise the plinth and the box climbs while
    // the lead stays exactly where it was lying.
    const b = outletAt();
    const tall = { ...shell, stand: shell.stand + 0.2 };
    expect(outletAt(tall).max.y - b.max.y, 'the outlet rides the plinth').toBeCloseTo(0.2, 6);
    expect(outletAt(tall).min.y, 'the run stays on the ground').toBe(b.min.y);

    // The box above speaks for the ground run, which owns the bottom of the
    // span, and for nothing else. The vertical lead is interior in height — it
    // tops out inside the outlet's own band — so a version that raised it with
    // the plinth and left the ground run alone moves no extreme at all and was
    // caught by the frozen golden only. Its top is reached for behind the
    // outlet's back face and above everything lying on the floor, which is the
    // lead and nothing else.
    const leadTop = (sh: typeof shell) => {
      const a = genOutletGeometry(sh, GEN_DEFAULT).attributes.position.array as Float32Array;
      const behind = -sh.depth / 2 + outlet.bed - outlet.thick;
      let y = -Infinity;
      for (let i = 0; i < a.length; i += 3) {
        if (a[i + 2] < behind && a[i + 1] > outlet.runLift + outlet.runRadius) y = Math.max(y, a[i + 1]);
      }
      return y;
    };
    expect(leadTop(tall), 'the lead was pulled up off the ground by the plinth').toBe(leadTop(shell));
  });

  it('turns every number it exposes, so the bench has no dead knob', () => {
    // A recipe field that nothing reads is worse than a literal: it says on the
    // bench that a number is adjustable and then ignores the adjustment. Most
    // of the pins above reach the recipe through the shell, which cannot see a
    // field the shell has no opinion about — the stacks' own centre and spread
    // are two, and freezing them back to 0.26 and 0.06 was invisible to every
    // other test in this block. So each number is turned in turn and the buffer
    // has to notice.
    const build = (r: typeof GEN_DEFAULT) =>
      merged(genStacksGeometry(shell, r), genOutletGeometry(shell, r));
    const before = build(GEN_DEFAULT);
    for (const group of ['stacks', 'outlet'] as const) {
      const fields = GEN_DEFAULT[group] as unknown as Record<string, number>;
      for (const field of Object.keys(fields)) {
        // A segment count is a whole number and the geometry rounds it, so a
        // fraction of one is not a turn of that knob — it is the test failing
        // to turn it. Integers move by one.
        const was = fields[field];
        const turned = {
          ...GEN_DEFAULT,
          [group]: { ...fields, [field]: Number.isInteger(was) ? was + 1 : was + 0.017 },
        };
        expect(build(turned), `${group}.${field} is a knob that does nothing`).not.toEqual(before);
      }
    }
  });

  it("still pools the generator's trim", () => {
    const view = new BuildingsView();
    const g = partGeometry(view, 'gen.trim');
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y, 'the stacks stand above the lid').toBeGreaterThan(1.2);
    expect(g.boundingBox!.min.z, 'the lead reaches out behind the machine').toBeLessThan(-0.5);
    view.dispose();
  });
});

describe('a machine', () => {
  it('stands on feet, because a shell run into the turf is a box somebody dropped', () => {
    // The one thing every machine in the colony had in common from the manager
    // camera was the line where it met the ground: no gap, no shadow, no
    // shortening as the light moves — which is what a decal on a box looks
    // like and not what an object standing on grass looks like. So each of
    // them has a foot, a skid or a rack under it that touches the ground, and
    // a shell that starts a hand's width above it. The two halves are checked
    // together on purpose: feet with the shell still down in the grass are
    // ornament, and a lifted shell with nothing under it floats.
    const view = new BuildingsView();
    const stands: ReadonlyArray<readonly [string, string]> = [
      ['stove.feet', 'stove.body'],
      ['cooler.feet', 'cooler.body'],
      ['gen.skid', 'gen.body'],
      ['batt.rack', 'batt.body'],
      ['heat.feet', 'heat.body'],
    ];
    for (const [feet, shell] of stands) {
      const f = partGeometry(view, feet);
      const s = partGeometry(view, shell);
      f.computeBoundingBox();
      s.computeBoundingBox();
      expect(f.boundingBox!.min.y, `${feet} never reaches the ground`).toBeLessThan(0.01);
      expect(s.boundingBox!.min.y, `${shell} sits flush on the grass`).toBeGreaterThanOrEqual(0.09);
    }
    view.dispose();
  });

  /**
   * The nine `rbox` calls as they stood before the shells were lifted into a
   * recipe: width, height, depth, centre height and eased edge. Copied out by
   * hand and frozen, because a recipe checked against the code that reads it
   * agrees with itself whatever either of them says.
   */
  const BEFORE: Record<string, { body: number[]; lid: number[] | null }> = {
    stove: { body: [0.88, 0.9, 0.86, 0.59, 0.06], lid: null },
    cooler: { body: [0.92, 1.1, 0.86, 0.65, 0.06], lid: [0.98, 0.2, 0.92, 1.32, 0.07] },
    heat: { body: [0.78, 1.04, 0.64, 0.62, 0.06], lid: [0.86, 0.12, 0.72, 1.19, 0.05] },
    gen: { body: [0.9, 0.9, 0.82, 0.57, 0.06], lid: [0.96, 0.16, 0.88, 1.1, 0.06] },
    batt: { body: [0.86, 0.6, 0.78, 0.4, 0.06], lid: [0.92, 0.12, 0.84, 0.76, 0.05] },
  };

  it('builds every shell byte-identical to the call it was lifted out of', () => {
    // These five are the first of the twenty-six buildings to be built from a
    // recipe rather than from numbers typed into a `pool` call, and the whole
    // value of that move rests on it having changed nothing.
    //
    // Not "close to", either. The recipe reaches its numbers by arithmetic
    // where the calls had them written down — a body's centre is `stand +
    // height / 2` rather than 0.59 — and in double precision those two answers
    // differ by one or two units in the last place. A vertex buffer is
    // `Float32Array`, and two hundredths of a femtometre on a metre-wide box is
    // some eight orders of magnitude under what a float32 can hold apart, so
    // the two round to the same word. Equality is therefore the honest
    // assertion here, and a tolerance would be the test quietly giving up the
    // claim its own recipe makes.
    for (const [kind, want] of Object.entries(BEFORE)) {
      const recipe = SHELL_DEFAULT[kind]!;
      const built = [shellBodyGeometry(recipe), shellLidGeometry(recipe)];
      const expected = [
        golden(...(want.body as [number, number, number, number, number])),
        want.lid ? golden(...(want.lid as [number, number, number, number, number])) : null,
      ];
      for (let i = 0; i < 2; i++) {
        const a = expected[i];
        const b = built[i];
        if (!a) {
          expect(b, `${kind} has no lid`).toBeNull();
          continue;
        }
        const pa = a.attributes.position!.array as Float32Array;
        const pb = b!.attributes.position!.array as Float32Array;
        expect(pb.length, `${kind}[${i}] vertex count`).toBe(pa.length);
        let differing = 0;
        for (let j = 0; j < pa.length; j++) if (pa[j] !== pb[j]) differing++;
        expect(differing, `${kind}[${i}] words differing from the shipped buffer`).toBe(0);
      }
    }
  });

  it('holds the five recipes at the numbers the five machines were drawn at', () => {
    // Literal numbers, because a table checked against itself is not a check.
    // Two of these are the reason the five are one family rather than five
    // shapes that happen to be boxes. Every lid overhangs its body by the same
    // amount in width as in depth — one number, four times over — and every
    // body stands within four centimetres of the same height off the ground,
    // which is the `stands on feet` test above expressed as a field.
    //
    // What the five do not agree on is `seat`, and those four values are the
    // measurement that says it has to stay a field rather than be derived: see
    // the recipe's own note for what fills the cooler's two centimetres and
    // what the heater's minus one is holding shut.
    expect(SHELL_DEFAULT.stove).toEqual({
      width: 0.88, depth: 0.86, height: 0.9, stand: 0.14, round: 0.06, lid: null,
    });
    expect(SHELL_DEFAULT.cooler).toEqual({
      width: 0.92, depth: 0.86, height: 1.1, stand: 0.1, round: 0.06,
      lid: { height: 0.2, overhang: 0.06, seat: 0.02, round: 0.07 },
    });
    expect(SHELL_DEFAULT.heat).toEqual({
      width: 0.78, depth: 0.64, height: 1.04, stand: 0.1, round: 0.06,
      lid: { height: 0.12, overhang: 0.08, seat: -0.01, round: 0.05 },
    });
    expect(SHELL_DEFAULT.gen).toEqual({
      width: 0.9, depth: 0.82, height: 0.9, stand: 0.12, round: 0.06,
      lid: { height: 0.16, overhang: 0.06, seat: 0, round: 0.06 },
    });
    expect(SHELL_DEFAULT.batt).toEqual({
      width: 0.86, depth: 0.78, height: 0.6, stand: 0.1, round: 0.06,
      lid: { height: 0.12, overhang: 0.06, seat: 0, round: 0.05 },
    });
    expect(Object.keys(SHELL_DEFAULT).sort()).toEqual(['batt', 'cooler', 'gen', 'heat', 'stove']);
  });

  it('still pools a body for each of the five and a lid for the four that have one', () => {
    // The lift is nine `pool` calls rewired, and the way that goes wrong with
    // nothing else noticing is a part quietly ceasing to be pooled: the colony
    // would draw a cooler with no lid on it and nothing would throw. So this
    // asks a real view for each key rather than asking the recipe.
    const view = new BuildingsView();
    for (const key of ['stove.body', 'cooler.body', 'cooler.lid', 'heat.body', 'heat.cap',
      'gen.body', 'gen.hood', 'batt.body', 'batt.lid']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y, `${key} has height`).toBeGreaterThan(0);
    }
    view.dispose();
  });
});

describe('a grave and a deadfall', () => {
  it('stands both of them up off the turf, because a shape lying flat on the ground is a decal', () => {
    // From the manager camera the round-7 grave was a rectangle lying in the
    // grass and the round-7 trap was a plate lying beside it: two marks on the
    // floor, either of which could have been a patch of dirt. What makes a
    // grave read as a grave from up there is a heap of turned earth with a
    // marker standing clear of it, and arms on the marker long enough to be a
    // crossbar rather than a dot; what makes a trap read as a mechanism is the
    // jaws standing proud of the frame with the pan up between them. Each is
    // measured for the one thing that was missing, at the part that carries
    // the meaning: how far off the ground it gets.
    const view = new BuildingsView();

    const mound = partGeometry(view, 'grave.mound');
    const marker = partGeometry(view, 'grave.stone');
    mound.computeBoundingBox();
    marker.computeBoundingBox();
    expect(mound.boundingBox!.max.y, 'the grave is level with the ground it was dug out of').toBeGreaterThan(0.2);
    expect(
      marker.boundingBox!.max.y - mound.boundingBox!.max.y,
      'the marker is lost in the mound it stands at the head of',
    ).toBeGreaterThan(0.25);
    // The arms of the marker, taken at the height they cross the post: a bar
    // several times longer than it is thick reads as a cross from directly
    // overhead, where a peg of the same height reads as a speck.
    const pos = marker.attributes.position;
    let xMin = Infinity;
    let xMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < 0.44 || pos.getY(k) > 0.56) continue;
      xMin = Math.min(xMin, pos.getX(k));
      xMax = Math.max(xMax, pos.getX(k));
      zMin = Math.min(zMin, pos.getZ(k));
      zMax = Math.max(zMax, pos.getZ(k));
    }
    expect((xMax - xMin) / (zMax - zMin), 'the marker is as thick as it is wide, which is a post').toBeGreaterThan(3);

    const frame = partGeometry(view, 'trap.plate');
    const jaws = partGeometry(view, 'trap.jaws');
    const trigger = partGeometry(view, 'trap.trigger');
    frame.computeBoundingBox();
    jaws.computeBoundingBox();
    trigger.computeBoundingBox();
    expect(
      jaws.boundingBox!.max.y - frame.boundingBox!.max.y,
      'the jaws are folded down flush with the frame, where nobody would see them',
    ).toBeGreaterThan(0.15);
    expect(
      trigger.boundingBox!.max.y,
      'the pan is bedded level with the frame, so the trap has no visible trigger',
    ).toBeGreaterThan(frame.boundingBox!.max.y);
    view.dispose();
  });

  it('breaks the mound out of the ellipse it was turned on', () => {
    // Round 9 called the mound a smooth chocolate loaf at manager zoom: the clods
    // were there, but they sat on the crown where the heap is flattest, so each
    // one stood a couple of centimetres proud of a surface already facing the sun
    // and threw no shadow anybody could see from twenty cells up. The fix cannot
    // be height — the marker has to keep its clearance over the mound, which the
    // test above measures — so it has to be plan. What separates turned ground
    // from a dome at that distance is a ragged outline, and the heap's own skirt
    // is a clean ellipse of 0.352 by 0.42. So the check is for earth *outside*
    // that ellipse and low down, which is the only place a silhouette is made.
    const view = new BuildingsView();
    const mound = partGeometry(view, 'grave.mound');
    const pos = mound.attributes.position;
    let outside = 0;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) > 0.2) continue;
      const u = pos.getX(k) / 0.352;
      const v = pos.getZ(k) / 0.42;
      if (u * u + v * v > 1.16) outside++;
    }
    expect(outside, 'every crumb of the mound is inside the ellipse, which is a dome').toBeGreaterThan(60);
    view.dispose();
  });
});

describe('a statue', () => {
  it('carries something with shoulders and a pose, because a mass on a plinth is a rock', () => {
    // A statue is a hundred pixels tall from the manager camera and every one
    // of them is silhouette: there is no room for a face, but there is room
    // for the two things that say "figure" at that size — a body that narrows
    // at the waist and widens at the shoulders, and an arm held away from the
    // line of the body. The round-7 statue had neither and read as a boulder
    // somebody had set on a block. Both are checked from the outline alone,
    // which is all the camera gets.
    const view = new BuildingsView();
    const pos = partGeometry(view, 'statue.figure').attributes.position;
    const halfWidth = (lo: number, hi: number): number => {
      let w = 0;
      for (let k = 0; k < pos.count; k++) {
        if (pos.getY(k) >= lo && pos.getY(k) <= hi) w = Math.max(w, Math.abs(pos.getX(k)));
      }
      return w;
    };
    expect(
      halfWidth(1.5, 1.6) / halfWidth(1.1, 1.25),
      'the figure is as broad at the waist as it is across the shoulders',
    ).toBeGreaterThan(1.6);
    // Above the shoulders there is a head on the axis and a fist out at arm's
    // length on one side of it. A lump would be even about the axis; a raised
    // arm throws the whole of that band off to one side, which is the pose.
    let reach = -Infinity;
    let back = Infinity;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < 1.8) continue;
      reach = Math.max(reach, pos.getX(k));
      back = Math.min(back, pos.getX(k));
    }
    expect(reach, 'nothing is held out above the shoulders, so both arms hang').toBeGreaterThan(0.25);
    expect(reach + back, 'the mass above the shoulders is even about the axis, which is a head and no pose').toBeGreaterThan(0.2);
    view.dispose();
  });
});

describe('a wood', () => {
  it('gives every skirt an outline of its own, so a crown from overhead is not a set of rings', () => {
    // The round-6 crown was lobed, and from directly overhead it still read as
    // concentric circles — because the lobes were one fixed mix of waves with a
    // phase per skirt, and turning an outline does not change it. Four copies
    // of one gentle oval, stacked and rotated, are rings. So the depth of the
    // waves as well as their phase is hashed per skirt: how far a skirt runs
    // out has to differ meridian to meridian by a good third, and the side each
    // skirt runs furthest out on has to differ from its neighbours' — which is
    // what stops the four rims from nesting.
    const view = new BuildingsView();
    const widest: number[] = [];
    for (const key of ['tree.lower', 'tree.mid', 'tree.upper', 'tree.top']) {
      const g = partGeometry(view, key) as THREE.LatheGeometry;
      const { points, segments } = g.parameters;
      const P = points.length;
      const pos = g.attributes.position;
      // Measured from the skirt's own axis: the leader is hung off centre.
      g.computeBoundingBox();
      const cx = (g.boundingBox!.max.x + g.boundingBox!.min.x) / 2;
      const cz = (g.boundingBox!.max.z + g.boundingBox!.min.z) / 2;
      const rim: number[] = [];
      for (let m = 0; m <= segments; m++) {
        let r = 0;
        for (let j = 0; j < P; j++) {
          const k = m * P + j;
          r = Math.max(r, Math.hypot(pos.getX(k) - cx, pos.getZ(k) - cz));
        }
        rim.push(r);
      }
      const hi = Math.max(...rim);
      const lo = Math.min(...rim);
      expect(hi / lo, `${key} reaches ${hi} on its longest bough and ${lo} on its shortest`).toBeGreaterThan(1.35);
      widest.push(rim.indexOf(hi) % segments);
    }
    expect(new Set(widest).size, 'every skirt of the crown is widest on the same side').toBeGreaterThanOrEqual(3);
    view.dispose();
  });

  it('has crowns with a lobed rim, not a circle turned on a lathe', () => {
    // The tell of a stacked-cone tree is the rim of each tier: a clean
    // horizontal circle where the profile is widest, with every vertex on it
    // at the same radius and the same height. A crown that has been rumpled
    // with low-frequency lobes has only a few vertices out at its full reach
    // and the rest tucked in, and the rim rises and falls as it goes round. So
    // the vertices within a few percent of the maximum radius must be fewer
    // than a full ring — sixteen segments plus the seam copy — and the widest
    // point of each sector round the crown must sit at its own height rather
    // than all of them lying in one plane.
    const view = new BuildingsView();
    const SECTORS = 16;
    for (const key of ['tree.lower', 'tree.upper', 'tree.top']) {
      const pos = partGeometry(view, key).attributes.position;
      let rMax = 0;
      let onRim = 0;
      const widest = new Array<number>(SECTORS).fill(0);
      const rimY = new Array<number>(SECTORS).fill(0);
      for (let k = 0; k < pos.count; k++) rMax = Math.max(rMax, Math.hypot(pos.getX(k), pos.getZ(k)));
      for (let k = 0; k < pos.count; k++) {
        const r = Math.hypot(pos.getX(k), pos.getZ(k));
        if (r >= rMax * 0.96) onRim++;
        const sector = Math.floor(((Math.atan2(pos.getZ(k), pos.getX(k)) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;
        if (r > widest[sector]) {
          widest[sector] = r;
          rimY[sector] = pos.getY(k);
        }
      }
      expect(onRim, `${key} has a full ring of ${onRim} vertices at its widest`).toBeLessThan(17);
      expect(Math.max(...rimY) - Math.min(...rimY), `${key}'s rim is a horizontal circle`).toBeGreaterThan(0.05);
    }
    view.dispose();
  });

  it('breaks its rim at the scale of a branch, and grows more than one crown', () => {
    // Round 7 rumpled a skirt with two to six waves at a quarter of its
    // radius, and from directly overhead that is broccoli: three or four fat
    // limbs, the same three or four on every tree, because one set of skirts
    // turned by a twist is one outline however you spin it. So the waves run
    // three to eight and a sixth as deep, and there are two crowns to draw
    // from. A rim that crosses its own mean radius six times has at least
    // three bulges in it rather than one limb and a dent; two crowns that
    // part company by a fifth of the radius somewhere round the rim cannot be
    // read as the same tree turned to face another way.
    const view = new BuildingsView();
    const rimOf = (key: string): number[] => {
      const g = partGeometry(view, key) as THREE.LatheGeometry;
      const { points, segments } = g.parameters;
      const P = points.length;
      const pos = g.attributes.position;
      g.computeBoundingBox();
      const cx = (g.boundingBox!.max.x + g.boundingBox!.min.x) / 2;
      const cz = (g.boundingBox!.max.z + g.boundingBox!.min.z) / 2;
      const rim: number[] = [];
      // The seam meridian is a duplicate of the first, so it is left off: it
      // would count as a crossing that is not there.
      for (let m = 0; m < segments; m++) {
        let r = 0;
        for (let j = 0; j < P; j++) {
          const k = m * P + j;
          r = Math.max(r, Math.hypot(pos.getX(k) - cx, pos.getZ(k) - cz));
        }
        rim.push(r);
      }
      return rim;
    };
    for (const key of ['tree.lower', 'tree.mid', 'tree.upper', 'tree.top']) {
      for (const crown of [key, `${key}.b`]) {
        const rim = rimOf(crown);
        const mean = rim.reduce((a, b) => a + b, 0) / rim.length;
        let breaks = 0;
        for (let i = 0; i < rim.length; i++) {
          const here = rim[i]! - mean;
          const next = rim[(i + 1) % rim.length]! - mean;
          if (here <= 0 !== next <= 0) breaks++;
        }
        expect(breaks, `${crown} runs in and out of its own girth only ${breaks} times`).toBeGreaterThanOrEqual(6);
      }
      const a = rimOf(key);
      const b = rimOf(`${key}.b`);
      let apart = 0;
      for (let i = 0; i < a.length; i++) apart = Math.max(apart, Math.abs(a[i]! - b[i]!) / a[i]!);
      expect(apart, `both crowns hang ${key} on the same outline`).toBeGreaterThan(0.2);
    }
    view.dispose();
  });

  it('is not a row of clones', () => {
    // Worldgen scatters a few hundred trees, and from inside a body a treeline
    // of identical, vertical, equal-height crowns reads as a plantation of
    // cutouts however smooth each one is. Each tree draws its own size and lean
    // out of the cell it stands on, so a sample of the wood must show several
    // sizes and at least one trunk off the vertical — and none leaning further
    // than a tree that is still standing up.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    view.sync(world);
    const trunks = matricesOf(view, 'tree.trunk');
    expect(trunks.length).toBeGreaterThan(20);
    const sizes = new Set<number>();
    const up = new THREE.Vector3();
    let leaning = 0;
    for (const m of trunks) {
      const s = new THREE.Vector3().setFromMatrixScale(m);
      sizes.add(Math.round(s.x * 1000));
      up.set(0, 1, 0).transformDirection(m);
      const lean = Math.acos(Math.min(1, up.y));
      expect(lean, `a tree leans ${lean} rad`).toBeLessThan(0.08);
      if (lean > 0.008) leaning++;
    }
    expect(sizes.size, `only ${sizes.size} tree sizes in the wood`).toBeGreaterThanOrEqual(4);
    expect(leaning, 'every tree in the wood stands dead vertical').toBeGreaterThan(0);
    view.dispose();
  });

  it('carries its crown on a length of bare trunk', () => {
    // A crown that starts a metre off the ground is a bush with a stump under
    // it, and from inside a body that is what a wood of them read as. A pine
    // is a third bare bole: the lowest tier must clear that, the trunk must
    // taper from root to tip rather than stand as a post, and it must run on
    // up inside the crown so no tier can show daylight underneath it.
    const view = new BuildingsView();
    const lower = partGeometry(view, 'tree.lower');
    const trunk = partGeometry(view, 'tree.trunk');
    lower.computeBoundingBox();
    trunk.computeBoundingBox();
    const height = defOf('tree').height;
    expect(lower.boundingBox!.min.y, 'the crown starts too low for a trunk to show').toBeGreaterThanOrEqual(height / 3);
    expect(trunk.boundingBox!.max.y, 'the trunk stops short of the crown').toBeGreaterThan(lower.boundingBox!.min.y + 0.5);
    const pos = trunk.attributes.position;
    let root = 0;
    let tip = 0;
    for (let k = 0; k < pos.count; k++) {
      const r = Math.hypot(pos.getX(k), pos.getZ(k));
      if (pos.getY(k) < 0.01) root = Math.max(root, r);
      if (pos.getY(k) > trunk.boundingBox!.max.y - 0.01) tip = Math.max(tip, r);
    }
    expect(tip, 'the trunk is a post, not a taper').toBeLessThan(root * 0.4);
    view.dispose();
  });

  it('meets the turf with faces that stand up rather than with a saucer that lies down', () => {
    // Round 10's frames had a bright red-brown ellipse lying on the grass under
    // every tree, reading as a terracotta pot the tree had been stood in, and it
    // was the trunk's own root flare: a frustum from 0.44 m at the ground to
    // 0.30 at 0.18, lying 37.5 degrees back from the vertical on the flat
    // triangles the lathe draws and 37.9 on the normals it shades them with.
    // Every one of the 0.5255 m² the trunk carried below a quarter of a metre
    // was over thirty degrees from vertical, and averaged over camera yaw that
    // band presented 0.2547 m² — 48.5 % of its own area, against a ceiling of
    // 50 % for any solid of revolution. There was no angle from which it was not
    // showing the manager its full face, and none from which the crown could
    // shade it either: the lowest boughs hang at 1.7 m and reach 0.86 m out, so
    // at any sun high enough to be called day their shadow clears a foot 0.44 m
    // in radius.
    //
    // So the line is drawn at what the camera can do rather than at a number
    // that looked right. `MIN_PITCH` is 0.42 radians — 24.1 degrees — the
    // shallowest the manager camera tilts, and a face whose normal stands lower
    // than that is one no camera the player is allowed to have can look square
    // down. Everything at the foot must be under it, so the tree's foot is a
    // thing the player sees edge-on however they move.
    const view = new BuildingsView();
    const trunk = partGeometry(view, 'tree.trunk');
    let band = 0;
    let lying = 0;
    let worst = 0;
    for (const face of footFaces(trunk, 0.25)) {
      band += face.area;
      if (face.elev <= 25) continue;
      lying += face.area;
      worst = Math.max(worst, face.elev);
    }
    expect(band, 'the trunk has no foot below a quarter of a metre at all').toBeGreaterThan(0.2);
    expect(lying, `${lying.toFixed(4)} m² of the foot lies back as far as ${worst.toFixed(1)}°`).toBe(0);
    view.dispose();
  });

  it('carries the foot on roots, so the ring at the turf is not a circle turned on a lathe', () => {
    // The flare that read as a saucer was not only shallow, it was a solid of
    // revolution: a perfect bright circle 0.88 m across against the grass, which
    // is the shape of a thing that was turned rather than grown. Pulling it in
    // is only half the answer, because the girth it was carrying is what stops
    // the trunk being a stick — and a trunk that ends in a hard cylindrical edge
    // on the grass is the bug the flare was added to fix in the first place.
    //
    // So the girth comes back as buttresses. Both halves are pinned here because
    // either alone is the old bug: a ring that is wide and round is the saucer,
    // and a ring that is lobed but no wider than the shaft is the cut-off pipe.
    // Five roots off two waves a little out of step give a ring that crosses its
    // own mean ten times and runs 0.300 to 0.450, and the widest of them stands
    // 2.14 times the 0.210 shaft a metre up.
    const view = new BuildingsView();
    const pos = partGeometry(view, 'tree.trunk').attributes.position;
    const ring: number[] = [];
    let shaft = 0;
    for (let k = 0; k < pos.count; k++) {
      const r = Math.hypot(pos.getX(k), pos.getZ(k));
      if (pos.getY(k) < 0.001) ring.push(r);
      if (Math.abs(pos.getY(k) - 1) < 0.001) shaft = Math.max(shaft, r);
    }
    // The lathe keeps two copies of its first meridian, and counting the wrap
    // from the last back to the first would count that duplicate as a crossing.
    ring.pop();
    const mean = ring.reduce((s, v) => s + v, 0) / ring.length;
    let crossings = 0;
    for (let i = 0; i < ring.length; i++) {
      if (ring[i]! - mean <= 0 !== ring[(i + 1) % ring.length]! - mean <= 0) crossings++;
    }
    const widest = Math.max(...ring);
    expect(crossings, `the ring at the turf runs in and out of its own girth only ${crossings} times`).toBeGreaterThanOrEqual(8);
    expect(widest / Math.min(...ring), 'the roots are all the same length, which is a rim').toBeGreaterThan(1.35);
    expect(widest / shaft, `the foot reaches ${widest.toFixed(3)} against a ${shaft.toFixed(3)} shaft, which is a pipe cut off at the grass`).toBeGreaterThan(1.8);
    view.dispose();
  });

  it('lets the contact bake reach its floor where the trunk enters the ground', () => {
    // The other half of why the flare read as a pot is that nothing could darken
    // it. The bake casts a hemisphere at every vertex and puts the ground in as a
    // blocker, and what a face loses to the ground is (1 − cos θ) / 2 for a
    // normal θ off the vertical — so the old flare's 37.9-degree face gave up a
    // fifth of its sky and came out between 0.875 and 0.9375, brighter than the
    // shaded trunk above it. A face that stands up loses half its sky instead,
    // which is past `AO_FLOOR` and lands on it.
    //
    // This is a consequence of the geometry rather than a second knob, and that
    // is exactly why it is worth pinning: it is the cheapest possible check that
    // the foot really is vertical where it touches, measured through the bake
    // rather than through the profile it was built from.
    const view = new BuildingsView();
    view.bakeOcclusion();
    const trunk = partGeometry(view, 'tree.trunk');
    const pos = trunk.attributes.position;
    const col = trunk.attributes.color;
    let darkest = 1;
    let brightest = 0;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) >= 0.001) continue;
      darkest = Math.min(darkest, col.getX(k));
      brightest = Math.max(brightest, col.getX(k));
    }
    expect(darkest, 'not one vertex at the turf is shaded down to the floor').toBeCloseTo(AO_FLOOR, 5);
    expect(brightest, `the brightest vertex at the turf sits at ${brightest.toFixed(4)}`).toBeLessThan(0.9);
    view.dispose();
  });

  it('shows the manager camera no saucer at the foot of any tree in the wood', () => {
    // The prototype is not what the player sees. Girth is hashed per tree and
    // goes on x and z only, so a squat wide tree is the same profile stretched
    // sideways — which tilts every face at the foot *flatter*, not steeper — and
    // the lean adds up to four degrees more on the downhill side. Measured
    // against the whole wood the old flare's 37.5-degree prototype face came out
    // at 44.7 on the squattest tree in it, and 0.1773 m² of that tree's foot
    // faced the default manager camera within twenty-five degrees of square-on.
    // A probe that only ever looked at the prototype would have been blind to
    // both, and would have reported the flare a few degrees better than it was.
    //
    // So this is the same question asked of every tree worldgen actually put on
    // the ground, through the matrix the view actually pushes, against the
    // camera the player actually starts with: at the foot of a tree, is there
    // any surface turned to face the manager square on. Nowhere in the wood may
    // there be one, because that surface is the saucer.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    view.sync(world);
    const trunk = partGeometry(view, 'tree.trunk');
    const cam = defaultCamera(world);
    // Where the camera stands, seen from the ground: `ManagerCamera.apply` puts
    // it at this offset from its target, and a face presents square on when its
    // normal points along it.
    const toCam = new THREE.Vector3(
      Math.cos(cam.yaw) * Math.cos(cam.pitch),
      Math.sin(cam.pitch),
      Math.sin(cam.yaw) * Math.cos(cam.pitch),
    ).normalize();
    const square = Math.cos((25 * Math.PI) / 180);
    const trees = matricesOf(view, 'tree.trunk');
    expect(trees.length, 'no wood to look at').toBeGreaterThan(20);
    let worst = 0;
    let facing = 0;
    for (const m of trees) {
      let towards = 0;
      for (const face of footFaces(trunk, 0.25, m)) {
        if (Math.abs(face.normal.dot(toCam)) > square) towards += face.area;
      }
      if (towards > facing) {
        facing = towards;
        worst = m.elements[12]!;
      }
    }
    expect(facing, `the tree at x=${worst} turns ${facing.toFixed(4)} m² of its foot flat at the camera`).toBe(0);
    view.dispose();
  });

  it('hangs each skirt of boughs rather than standing it in a bowl', () => {
    // What made a crown read as a stack of party hats from the manager camera
    // was not the number of tiers but which way each one sloped: the widest
    // point sat above where the tier met the trunk, so its underside faced up
    // and out and every tier was a cone standing on its point. A conifer's
    // boughs come out of the trunk and droop, which means the lowest thing
    // about a skirt is its rim — out at nearly its full reach — rather than
    // the joint at the trunk. So the lowest vertex of each skirt must be a
    // long way out from the axis, which is false for a bowl and true for
    // anything that hangs.
    const view = new BuildingsView();
    for (const key of ['tree.lower', 'tree.mid', 'tree.upper', 'tree.top']) {
      const pos = partGeometry(view, key).attributes.position;
      // Measured from the skirt's own axis, not the tree's: the leader is hung
      // off centre on purpose, and a radius taken from the trunk would read
      // that offset as reach.
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      const cx = (g.boundingBox!.max.x + g.boundingBox!.min.x) / 2;
      const cz = (g.boundingBox!.max.z + g.boundingBox!.min.z) / 2;
      let rMax = 0;
      let lowest = Infinity;
      let rAtLowest = 0;
      for (let k = 0; k < pos.count; k++) rMax = Math.max(rMax, Math.hypot(pos.getX(k) - cx, pos.getZ(k) - cz));
      for (let k = 0; k < pos.count; k++) {
        if (pos.getY(k) >= lowest) continue;
        lowest = pos.getY(k);
        rAtLowest = Math.hypot(pos.getX(k) - cx, pos.getZ(k) - cz);
      }
      expect(rAtLowest, `${key} bottoms out at ${rAtLowest} from the trunk, of ${rMax}`).toBeGreaterThan(rMax * 0.5);
    }
    view.dispose();
  });

  it('varies girth and height apart, so a stand is not one tree at four sizes', () => {
    // Scaling one tree up and down gives a wood of the same tree photographed
    // at several distances — which from the manager camera, where every crown
    // is seen from one angle at one range, is exactly the row of stamps the
    // wood read as. Height and girth are hashed separately and girth goes on
    // the ground plane only, so the wood holds tall thin trees and squat wide
    // ones. The ratio of the two is what carries that, and the growth scale
    // divides out of it, so it is the ratio that is counted.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    view.sync(world);
    const shapes = new Set<number>();
    for (const m of matricesOf(view, 'tree.trunk')) {
      const s = new THREE.Vector3().setFromMatrixScale(m);
      shapes.add(Math.round((s.x / s.y) * 100));
    }
    expect(shapes.size, `only ${shapes.size} trunk proportions in the whole wood`).toBeGreaterThanOrEqual(4);
    view.dispose();
  });
});

describe('a blueprint', () => {
  it('marks the cell rather than standing a glass block on it', () => {
    // Four planned walls in a row used to be four full-height boxes at a third
    // opaque, and from inside a body they stacked into one cyan slab across a
    // third of the frame. A ghost is a mark on the ground: knee-high at most,
    // faint, and never written into the depth buffer — so a row of them stays
    // a row of cells, and a settler walking over one is drawn over it rather
    // than cut off at the shin.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    addBuilding(world, 'wall', x, y, false);
    view.sync(world);
    expect(heightAt(view, x, y), 'the ghost of a wall stands as tall as the wall').toBeLessThanOrEqual(0.3);
    let ghosts = 0;
    view.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat.transparent) return;
      ghosts++;
      expect(mat.opacity, 'a ghost dense enough to hide what is behind it').toBeLessThanOrEqual(0.15);
      expect(mat.depthWrite, 'a ghost that cuts into the settlers walking over it').toBe(false);
    });
    expect(ghosts, 'no translucent pool to draw a blueprint with').toBe(1);
    view.dispose();
  });
});

/** How many instances of one part stand on a cell. */
function partsAt(view: BuildingsView, key: string, x: number, y: number): number {
  const pos = new THREE.Vector3();
  let n = 0;
  for (const m of matricesOf(view, key)) {
    pos.setFromMatrixPosition(m);
    if (Math.round(pos.x) === x && Math.round(pos.z) === y) n++;
  }
  return n;
}

describe('the two walls', () => {
  /**
   * The five calls the walls were lifted out of, copied by hand and frozen. A
   * body is a plain box (width, height, depth, centre); a coping and a plinth
   * are eased, and carry their radius last.
   */
  type BoxArgs = [number, number, number, number];
  type RboxArgs = [number, number, number, number, number];
  const BEFORE: Record<string, { body: BoxArgs; cap: RboxArgs; plinth: RboxArgs | null }> = {
    wall: {
      body: [1, 2.44, 1, 1.22],
      cap: [1.06, 0.18, 1.06, 2.51, 0.06],
      plinth: null,
    },
    stone: {
      body: [0.94, 2.2, 0.94, 1.44],
      cap: [1.1, 0.2, 1.1, 2.62, 0.05],
      plinth: [1.04, 0.34, 1.04, 0.17, 0.03],
    },
  };

  it('builds both walls byte-identical to the calls they were lifted out of', () => {
    // The timber wall and the stone wall are one column with two hats, and the
    // whole value of saying so in a recipe is that it changed nothing. The
    // recipe reaches the stone body's centre as `stand + height / 2`, which is
    // 1.4400000000000002 in a double against the 1.44 that was written down —
    // and unlike the table legs, whose foot sits at zero where a float32's
    // steps are tiny, nothing on a wall is near the origin, so that last bit
    // has nowhere to show. Checked rather than assumed, which is the only
    // reason it can be said.
    for (const [kind, want] of Object.entries(BEFORE)) {
      const r = WALL_DEFAULT[kind]!;
      const pairs: [string, THREE.BufferGeometry, THREE.BufferGeometry | null][] = [
        [`${kind}.body`, goldenBox(...want.body), wallBodyGeometry(r)],
        [`${kind}.cap`, golden(...want.cap), wallCapGeometry(r)],
      ];
      if (want.plinth) {
        pairs.push([`${kind}.plinth`, golden(...want.plinth), wallPlinthGeometry(r)]);
      } else {
        expect(wallPlinthGeometry(r), `${kind} draws no plinth`).toBeNull();
      }
      for (const [name, a, b] of pairs) {
        const pa = a.attributes.position.array as Float32Array;
        const pb = b!.attributes.position.array as Float32Array;
        expect(pb.length, `${name} vertex count`).toBe(pa.length);
        let differing = 0;
        for (let j = 0; j < pa.length; j++) if (pa[j] !== pb[j]) differing++;
        expect(differing, `${name} words differing from the shipped buffer`).toBe(0);
      }
    }
  });

  it('laps both copings two centimetres down over the body rather than resting them on it', () => {
    // This is the measurement that says the two are a family and not two
    // columns that happen to have hats. They were drawn separately, they agree
    // on nothing else — different widths, different heights, one with a plinth
    // and one without, copings that overhang by 0.06 and 0.16 — and both bury
    // the coping exactly two centimetres into the top of the column. A coping
    // set down flush would leave a joint at the one height a wall is seen
    // against the sky.
    //
    // Read off the built geometry rather than off the field, because the field
    // agreeing with itself proves nothing; and asked for closeness rather than
    // for words, because this is a distance between two float32 buffers and not
    // a claim that a buffer did not move.
    for (const kind of ['wall', 'stone']) {
      const body = wallBodyGeometry(WALL_DEFAULT[kind]!);
      const cap = wallCapGeometry(WALL_DEFAULT[kind]!);
      body.computeBoundingBox();
      cap.computeBoundingBox();
      const lap = body.boundingBox!.max.y - cap.boundingBox!.min.y;
      expect(lap, `${kind} laps its coping`).toBeCloseTo(0.02, 6);
      expect(cap.boundingBox!.max.y, `${kind} coping clears the body`).toBeGreaterThan(body.boundingBox!.max.y);
    }
  });

  it('stands the stone body on exactly the plinth it draws, and the timber body on the ground', () => {
    // `stand` is one field doing two jobs: it is how high the body is lifted,
    // and it is the plinth's height. The two cannot drift apart because there
    // is only one of them — which is worth a test precisely because it would be
    // so easy to add a second number later and not notice the day they stop
    // agreeing.
    const stone = wallPlinthGeometry(WALL_DEFAULT.stone)!;
    const stoneBody = wallBodyGeometry(WALL_DEFAULT.stone);
    stone.computeBoundingBox();
    stoneBody.computeBoundingBox();
    expect(stone.boundingBox!.min.y, 'the plinth starts at the ground').toBeCloseTo(0, 6);
    expect(stone.boundingBox!.max.y, 'the plinth reaches the underside of the body').toBeCloseTo(
      stoneBody.boundingBox!.min.y,
      6,
    );
    const timber = wallBodyGeometry(WALL_DEFAULT.wall);
    timber.computeBoundingBox();
    expect(timber.boundingBox!.min.y, 'the timber wall stands on the ground').toBeCloseTo(0, 6);
  });

  it('holds the two recipes at the numbers the two walls were drawn at', () => {
    // Literal numbers, because a table checked against itself is not a check.
    expect(WALL_DEFAULT.wall).toEqual({
      width: 1, height: 2.44, stand: 0,
      cap: { height: 0.18, overhang: 0.06, seat: -0.02, round: 0.06 },
      plinth: null,
    });
    expect(WALL_DEFAULT.stone).toEqual({
      width: 0.94, height: 2.2, stand: 0.34,
      cap: { height: 0.2, overhang: 0.16, seat: -0.02, round: 0.05 },
      plinth: { overhang: 0.1, round: 0.03 },
    });
    expect(Object.keys(WALL_DEFAULT).sort()).toEqual(['stone', 'wall']);
  });

  it('still pools a body and a coping for both walls, and a plinth for the stone', () => {
    // Five `pool` calls rewired, and the way that goes wrong unnoticed is a
    // part quietly ceasing to be pooled: a perimeter would lose its coping line
    // and nothing would throw.
    const view = new BuildingsView();
    for (const key of ['wall.body', 'wall.cap', 'stone.plinth', 'stone.body', 'stone.cap']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y, `${key} has height`).toBeGreaterThan(0);
    }
    view.dispose();
  });
});

describe('a wall', () => {
  it('posts its outside corners and not its length', () => {
    // A corner is where the eye decides whether a building is a building or a
    // row of cubes, and a framed wall has a post there. The middle of a run
    // has no outside corner, so a post there would chop the run back into
    // cells; the end of a run has two; a lone cell, four. The count is what
    // the draw works out from the neighbours, so it is the count that is
    // checked.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'wall', x, y);
    view.sync(world);
    expect(partsAt(view, 'wall.post', x, y), 'a lone wall has a post at each corner').toBe(4);

    place(world, 'wall', x + 1, y);
    place(world, 'wall', x + 2, y);
    view.sync(world);
    expect(partsAt(view, 'wall.post', x + 1, y), 'a post in the middle of a run').toBe(0);
    expect(partsAt(view, 'wall.post', x, y), 'the end of a run has a pair of posts').toBe(2);
    expect(partsAt(view, 'wall.post', x + 2, y), 'the end of a run has a pair of posts').toBe(2);
    view.dispose();
  });

  it('breaks the joints of one course of planking against the next', () => {
    // Five courses of boards with their vertical joints all at the cell's
    // edges is a filing cabinet — a face of identical drawers — and that is
    // what a wall was from inside a body. A carpenter breaks bond: where the
    // boards of one course end is not where the boards of the next do. So
    // the set of vertical board ends on the +z face must change from each
    // course to the one above it, while the boards stay inside the coping's
    // footprint so the wall is still the box the sim collides with.
    //
    // The number of courses is checked as a range rather than a number,
    // because it is a read and not a constant: at five, a block over a
    // two-and-a-half-metre wall is very nearly half a metre tall and the wall
    // reads as breeze block; past eight the courses close up into a stripe at
    // the distance the manager camera watches from.
    const view = new BuildingsView();
    const g = partGeometry(view, 'wall.planks');
    const pos = g.attributes.position;
    const cap = partGeometry(view, 'wall.cap');
    cap.computeBoundingBox();
    // Every board of a course shares the course's two heights, so the sorted
    // levels are the courses in pairs — bottom, top, bottom, top — and that is
    // how many courses there are without the test knowing the pitch.
    const ends = new Map<number, Set<number>>();
    let reach = 0;
    for (let k = 0; k < pos.count; k++) {
      reach = Math.max(reach, Math.abs(pos.getX(k)), Math.abs(pos.getZ(k)));
      // Only the boards on the +z face, and on those only the vertices out on
      // the weather side: the ones behind are the board's thickness, not its
      // ends. The face itself is at 0.52 and the back of a board at 0.485.
      if (pos.getZ(k) < 0.5) continue;
      const level = Math.round(pos.getY(k) * 1000);
      if (!ends.has(level)) ends.set(level, new Set());
      ends.get(level)!.add(Math.round(pos.getX(k) * 100));
    }
    const rows = [...ends.keys()].sort((a, b) => a - b);
    const courses = rows.length / 2;
    expect(courses, `${courses} courses of planking`).toBeGreaterThanOrEqual(6);
    expect(courses, `${courses} courses of planking`).toBeLessThanOrEqual(8);
    for (let c = 0; c + 1 < courses; c++) {
      const below = [...ends.get(rows[c * 2]!)!].sort().join(',');
      const above = [...ends.get(rows[c * 2 + 2]!)!].sort().join(',');
      expect(above, `course ${c + 1} has its joints where course ${c} has them`).not.toBe(below);
    }
    // The joint between two courses is a shadow line, not a black one: a
    // six-centimetre groove three deep read as mortar at eye level, and mortar
    // that wide is what made the wall breeze block rather than timber.
    for (let c = 0; c + 1 < courses; c++) {
      const joint = (rows[c * 2 + 2]! - rows[c * 2 + 1]!) / 1000;
      expect(joint, `a joint ${joint} wide is a line, not a shadow`).toBeLessThanOrEqual(0.04);
    }
    expect(reach, 'the planking stands out past the coping').toBeLessThanOrEqual(cap.boundingBox!.max.x);
    view.dispose();
  });

  it('dyes one board off another, because a face at one tone is a painted plane', () => {
    // A pool has one material, so the only place a difference between two
    // boards of the same wall can live is in the vertices. Without it a run of
    // wall is one flat brown from any distance and the bond might as well be
    // printed on; with it every board catches the light as its own board.
    const view = new BuildingsView();
    const g = partGeometry(view, 'wall.planks');
    const col = g.attributes.color;
    expect(col, 'the planking carries no vertex colours').toBeDefined();
    const tones = new Set<number>();
    for (let k = 0; k < col.count; k++) tones.add(Math.round(col.getX(k) * 100));
    expect(tones.size, 'every board of the wall is the same timber').toBeGreaterThanOrEqual(3);
    view.dispose();
  });

  it('closes its courses onto the wall next door, and onto a doorway not at all', () => {
    // The one place the bond used to break down was the jamb. A run of wall
    // that stops has every course stopping in the same place, so beside a door
    // the vertical joints stacked into one unbroken column the full height of
    // the wall — the filing cabinet again, in the one spot a settler stands
    // closest to. The two-board courses are held back from the cell's edge now
    // and closed by a part of their own, pushed only where the planking really
    // does run on: so a wall between two walls is closed both ways, a wall
    // beside a door is closed on the wall side only, and at the opening the
    // closed courses end short of the unclosed ones with the alternation
    // intact.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'wall', x, y);
    place(world, 'wall', x + 1, y);
    place(world, 'wall', x + 2, y);
    place(world, 'door', x + 3, y);
    view.sync(world);
    expect(partsAt(view, 'wall.closer', x + 1, y), 'a wall between two walls closes both ways').toBe(2);
    expect(partsAt(view, 'wall.closer', x, y), 'the far end of a run closes onto nothing').toBe(1);
    expect(partsAt(view, 'wall.closer', x + 2, y), 'the wall beside a door closes onto the doorway').toBe(1);
    view.dispose();
  });
});

describe('a door', () => {
  it('is hung across the run of wall it is set in, not along it', () => {
    // Every part of a door — the jambs, the hinge the leaf swings on, the
    // handle on the far stile — is built along the x axis, and it used to be
    // drawn that way whatever it was hung in. So a door in a wall running north
    // to south stood broadside to it: jambs across the opening, a lintel lying
    // along the wall instead of over the gap, and a leaf that swung into the
    // wall beside it. The frame is twice as wide as it is deep, so which way
    // round it is hung is a question its bounding box answers, and it has to
    // come out the other way round in the other run.
    const span = (dx: number, dy: number): THREE.Vector3 => {
      const world = createWorld(SEED);
      const view = new BuildingsView();
      const { x, y } = clearRun(world, dx, dy, 3);
      place(world, 'wall', x, y);
      place(world, 'door', x + dx, y + dy);
      place(world, 'wall', x + dx * 2, y + dy * 2);
      view.sync(world);
      const g = partGeometry(view, 'door.frame');
      g.computeBoundingBox();
      // Worldgen hangs doors of its own in the starting cabin, so it is the
      // frame standing on this cell that is measured, not the first one found.
      const pos = new THREE.Vector3();
      const hung = matricesOf(view, 'door.frame').find((m) => {
        pos.setFromMatrixPosition(m);
        return Math.round(pos.x) === x + dx && Math.round(pos.z) === y + dy;
      });
      const box = new THREE.Box3().copy(g.boundingBox!).applyMatrix4(hung!);
      view.dispose();
      return box.getSize(new THREE.Vector3());
    };
    const eastWest = span(1, 0);
    const northSouth = span(0, 1);
    expect(eastWest.x, 'a door in an east-west wall stands along the wall').toBeGreaterThan(eastWest.z);
    expect(northSouth.z, 'a door in a north-south wall stands across the wall').toBeGreaterThan(northSouth.x);
  });
});

describe('a stockpile', () => {
  it('draws each kind of stack as its own thing, and none of them under the ground', () => {
    // Five of the six kinds were the same bevelled cube in different colours,
    // and a yard of cubes is a yard the player has to click to read. Each
    // kind has its own shape now — logs, ingots, a heap, a crate, a case, a
    // roll — and each shape is two colours at least, carried in the vertices
    // since a pool has one material. And every one of them rests on the
    // plane: a part that reaches under it is a part in the turf.
    const view = new BuildingsView();
    const shapes = new Set<string>();
    let pools = 0;
    view.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || !mesh.geometry.name.startsWith('stack.')) return;
      pools++;
      const g = mesh.geometry;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.vertexColors, `${g.name} has one colour`).toBe(true);
      expect(g.attributes.color, `${g.name} carries no vertex colours`).toBeDefined();
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.y, `${g.name} reaches ${b.min.y} under the ground`).toBeGreaterThanOrEqual(-0.001);
      expect(b.max.y, `${g.name} stands ${b.max.y} tall on a cell nothing else can share`).toBeLessThanOrEqual(0.4);
      shapes.add(`${triangles(g)}:${b.max.y.toFixed(2)}:${(b.max.x - b.min.x).toFixed(2)}:${(b.max.z - b.min.z).toFixed(2)}`);
    });
    const kinds = Object.keys(RESOURCE_COLOR) as ResourceKind[];
    expect(pools, 'a kind of resource with no stack to draw').toBe(kinds.length);
    expect(shapes.size, 'two kinds of stack share a shape').toBe(kinds.length);
    view.dispose();
  });

  it('draws a handful smaller than a load', () => {
    // The pile only started to rise at twenty-five, so one log and ten of
    // them were the same object on the ground. A stack is scaled for what is
    // in it: a handful at seven tenths, full size by ten.
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    addItem(world, 'wood', 3, x, y);
    addItem(world, 'wood', 10, x + 1, y);
    view.sync(world);
    const scaleAt = (cx: number): number => {
      const pos = new THREE.Vector3();
      for (const m of matricesOf(view, 'stack.wood')) {
        pos.setFromMatrixPosition(m);
        if (Math.round(pos.x) === cx && Math.round(pos.z) === y) return new THREE.Vector3().setFromMatrixScale(m).x;
      }
      throw new Error(`no wood drawn at ${cx},${y}`);
    };
    expect(scaleAt(x + 1), 'a load of ten is not drawn at full size').toBeCloseTo(1, 5);
    expect(scaleAt(x), 'a handful is drawn as big as a load').toBeLessThan(0.8);
    expect(scaleAt(x), 'a handful shrinks to nothing').toBeGreaterThan(0.5);
    view.dispose();
  });

  it('rests a stack on the snowpack rather than in it', () => {
    // The drawn ground is not the y = 0 plane: a full pack lifts a field by
    // more than a third of a stack's height, and a stack drawn at zero under
    // it was a lid flush with the snow. The sim knows nothing of the lift —
    // it is the renderer's — so it is the renderer's job to sit on it.
    const world = createWorld(SEED);
    world.snow = 1;
    let cell: { x: number; y: number } | null = null;
    for (let y = 2; y < world.height - 2 && !cell; y++) {
      for (let x = 2; x < world.width - 2; x++) {
        if (world.cellBuilding[y * world.width + x] === -1 && groundLiftAt(world, x, y) > 0.05) {
          cell = { x, y };
          break;
        }
      }
    }
    expect(cell, 'no clear cell under snow to drop a stack on').not.toBeNull();
    const { x, y } = cell!;
    addItem(world, 'steel', 10, x, y);
    const view = new BuildingsView();
    view.sync(world);
    const pos = new THREE.Vector3();
    const m = matricesOf(view, 'stack.steel').find((one) => {
      pos.setFromMatrixPosition(one);
      return Math.round(pos.x) === x && Math.round(pos.z) === y;
    });
    expect(m, `no steel drawn at ${x},${y}`).toBeDefined();
    pos.setFromMatrixPosition(m!);
    expect(pos.y, `the stack sits at ${pos.y} under ${groundLiftAt(world, x, y)} of snow`).toBeGreaterThanOrEqual(groundLiftAt(world, x, y) - 1e-6);
    view.dispose();
  });
});

describe('a stone wall', () => {
  it('lays its masonry between the plinth and the coping, and not at one depth', () => {
    // The blocks stand proud of the body but inside the coping's footprint,
    // and between the top of the plinth and the underside of the cap, so the
    // wall's outline is still the box the sim collides with. And they stand
    // proud by different amounts: a face of blocks all at one depth is a face
    // with lines drawn on it, and the per-block offset is what makes it stone.
    const view = new BuildingsView();
    const plinth = partGeometry(view, 'stone.plinth');
    const cap = partGeometry(view, 'stone.cap');
    plinth.computeBoundingBox();
    cap.computeBoundingBox();
    for (const key of ['stone.courses', 'stone.bond']) {
      const g = partGeometry(view, key);
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.y, `${key} sinks into the plinth`).toBeGreaterThanOrEqual(plinth.boundingBox!.max.y);
      expect(b.max.y, `${key} rises into the coping`).toBeLessThanOrEqual(cap.boundingBox!.min.y);
      expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z), `${key} stands out past the coping`).toBeLessThanOrEqual(cap.boundingBox!.max.x);
      const depths = new Set<number>();
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) if (pos.getZ(k) > 0.47) depths.add(Math.round(pos.getZ(k) * 1000));
      expect(depths.size, `${key} has every block on its +z face at the same depth`).toBeGreaterThanOrEqual(3);
    }
    view.dispose();
  });
});

describe('a fence line', () => {
  it('rails towards its neighbours and not into open ground', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'fence', x, y);
    view.sync(world);
    const alone = instancesAt(view, x, y);

    place(world, 'fence', x + 1, y);
    place(world, 'fence', x + 2, y);
    view.sync(world);
    const middle = instancesAt(view, x + 1, y);
    const end = instancesAt(view, x, y);

    // A lone fence is a lone post. The middle of a run reaches both ways, the end
    // reaches once — which is what makes three cells read as one rail rather than
    // three crosses.
    expect(middle).toBeGreaterThan(end);
    expect(end).toBeGreaterThan(alone);
  });

  it('joins onto a wall, because a gate in a paddock is still the paddock', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'fence', x, y);
    view.sync(world);
    const alone = instancesAt(view, x, y);

    place(world, 'wall', x + 1, y);
    view.sync(world);
    expect(instancesAt(view, x, y)).toBeGreaterThan(alone);
  });

  it('ignores a blueprint next door until it is actually built', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    place(world, 'fence', x, y);
    addBuilding(world, 'fence', x + 1, y, false);
    view.sync(world);
    const withGhost = instancesAt(view, x, y);

    const world2 = createWorld(SEED);
    const view2 = new BuildingsView();
    place(world2, 'fence', x, y);
    view2.sync(world2);
    expect(withGhost).toBe(instancesAt(view2, x, y));
  });
});


/** Every pooled mesh in the view, the empty ones included — they are half the point below. */
function pooledMeshes(view: BuildingsView): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (mesh.isInstancedMesh) out.push(mesh);
  });
  return out;
}

/** One pool, by the key its geometry was named with when the view built it. */
function poolOf(view: BuildingsView, key: string): THREE.InstancedMesh {
  let found: THREE.InstancedMesh | null = null;
  view.group.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (mesh.isInstancedMesh && mesh.geometry.name === key) found = mesh;
  });
  expect(found, `no pool called ${key}`).not.toBeNull();
  return found!;
}

/**
 * How far the furthest instance in a pool sticks out past the sphere the renderer
 * culls that pool by, in world units. Zero or less is right. Anything above zero is
 * geometry the frustum test does not know is there, and the moment the camera pans
 * so the sphere leaves the screen while that instance has not, the instance stops
 * being drawn — a wall gone from the edge of the picture with the sim still
 * insisting it is solid, which is the failure this whole family of tests exists to
 * make impossible. Measured the way three measures it: the geometry's own sphere
 * carried through each instance matrix, which is exactly what `computeBoundingSphere`
 * unions and therefore what a stale union will be missing.
 */
function overhang(mesh: THREE.InstancedMesh): number {
  expect(mesh.boundingSphere, `${mesh.geometry.name} has no bounding sphere at all`).not.toBeNull();
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const proto = mesh.geometry.boundingSphere!;
  const hull = mesh.boundingSphere!;
  const reach = new THREE.Sphere();
  const m = new THREE.Matrix4();
  let worst = -Infinity;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    reach.copy(proto).applyMatrix4(m);
    worst = Math.max(worst, hull.center.distanceTo(reach.center) + reach.radius - hull.radius);
  }
  return worst;
}

/** The frustum three would cull against, given a camera. */
function frustumOf(cam: THREE.PerspectiveCamera): THREE.Frustum {
  cam.updateMatrixWorld(true);
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
  );
}

/**
 * What the renderer is allowed to skip.
 *
 * Pools were drawn unconditionally for nine rounds — `frustumCulled = false` on
 * every one of them — because an InstancedMesh whose bounding sphere is never
 * recomputed after `setMatrixAt` will cull instances that are plainly on screen.
 * The sphere is now rebuilt at the end of every rebuild, which is what makes
 * culling safe, and an empty pool is dropped from the render list rather than
 * binding a program twice a frame to draw nothing. Both of those trade a picture
 * that is definitely right for a picture that is cheaper, so the tests below are
 * the ones that have to hold: the cheapest possible frame is the one that draws
 * nothing at all.
 */
describe('what the renderer is allowed to skip', () => {
  it('gives every pool a sphere that reaches its own furthest instance', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    // The starting valley already spreads a pool's instances across the map — the
    // cabin at the middle, trees from one edge to the other in the same wood pools —
    // which is the arrangement a sphere sized from the prototype geometry gets wrong.
    view.sync(world);
    for (const mesh of pooledMeshes(view)) {
      if (mesh.count === 0) continue;
      expect(overhang(mesh), `${mesh.geometry.name} reaches past its own bounding sphere`).toBeLessThanOrEqual(1e-6);
    }
    view.dispose();
  });

  it('grows that sphere when the next rebuild puts an instance further out', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    view.sync(world);
    const first = poolOf(view, 'wall.body').boundingSphere!.clone();

    // A wall in the far corner of a 192-cell map, with the cabin's walls in the
    // middle of it. Asserted rather than assumed: if the second wall happened to
    // stand inside the sphere the first sync computed, this test would pass on a
    // view that never recomputes anything, and prove nothing at all.
    const far = clearCell(world);
    expect(
      first.containsPoint(new THREE.Vector3(far.x, 1.22, far.y)),
      'the second wall has to stand outside the first sphere or this test is blind',
    ).toBe(false);
    place(world, 'wall', far.x, far.y);
    view.sync(world);

    const wall = poolOf(view, 'wall.body');
    expect(wall.boundingSphere!.radius).toBeGreaterThan(first.radius);
    expect(overhang(wall), 'the sphere is the one the previous rebuild computed').toBeLessThanOrEqual(1e-6);
    view.dispose();
  });

  it('leaves its pools culled, which only the two above make safe', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    view.sync(world);
    for (const mesh of pooledMeshes(view)) {
      expect(mesh.frustumCulled, `${mesh.geometry.name} is drawn whatever the camera is looking at`).toBe(true);
    }
    view.dispose();
  });

  it('takes an emptied pool out of the render list and puts it back when it refills', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    const { x, y } = clearCell(world);
    const b = addBuilding(world, 'gametable', x, y, true);
    expect(b, 'a gametable could not be placed').not.toBeNull();
    view.sync(world);
    // A gametable is the one thing in the pool, so removing it empties the pool
    // rather than merely shrinking it — the state the whole colony is in for most
    // of a game, sixty-odd kinds of building nobody has built yet.
    expect(poolOf(view, 'game.board').visible).toBe(true);

    removeBuilding(world, b!);
    view.sync(world);
    const emptied = poolOf(view, 'game.board');
    expect(emptied.count).toBe(0);
    expect(emptied.visible, 'an empty pool is still binding a program every frame').toBe(false);

    place(world, 'gametable', x, y);
    view.sync(world);
    const refilled = poolOf(view, 'game.board');
    expect(refilled.count).toBe(1);
    expect(refilled.visible, 'a pool that refilled never came back').toBe(true);
    view.dispose();
  });

  it('still draws a demolished and rebuilt cabin, from a camera pointed at it', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    view.sync(world);
    const walls = world.buildings.filter((b) => b.kind === 'wall');
    expect(walls.length, 'the starting valley has no cabin to knock down').toBeGreaterThan(4);
    const cells = walls.map((b) => ({ x: b.x, y: b.y }));
    const before = cells.map((c) => instancesAt(view, c.x, c.y));

    // Down and up again, which is what a player does to move a wall a cell over,
    // and what a season change does to the pools that hold a crop. The pool is
    // emptied to nothing in between, so if a rebuild ever failed to restore either
    // the count or the sphere, this is where it would show.
    for (const b of walls) removeBuilding(world, b);
    view.sync(world);
    expect(poolOf(view, 'wall.body').visible).toBe(false);

    for (const c of cells) place(world, 'wall', c.x, c.y);
    view.sync(world);
    cells.forEach((c, i) => {
      expect(instancesAt(view, c.x, c.y), `the wall at ${c.x},${c.y} came back thinner`).toBe(before[i]);
    });

    // And the renderer agrees it is on screen: the manager camera looking down on
    // the cabin from a couple of dozen cells up, which is roughly frame 3 of the
    // look harness, has to keep the wall pool in the draw list.
    const wall = poolOf(view, 'wall.body');
    expect(overhang(wall)).toBeLessThanOrEqual(1e-6);
    view.group.updateMatrixWorld(true);
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
    cam.position.set(cells[0].x, 24, cells[0].y + 24);
    cam.lookAt(cells[0].x, 0, cells[0].y);
    expect(frustumOf(cam).intersectsObject(wall), 'the cabin walls are culled from a camera aimed at them').toBe(true);
    view.dispose();
  });

  it('skips a pool the camera has its back to, so the saving is real', () => {
    const world = createWorld(SEED);
    const view = new BuildingsView();
    view.sync(world);
    view.group.updateMatrixWorld(true);
    const wall = poolOf(view, 'wall.body');
    expect(wall.boundingSphere, 'nothing has computed a sphere to cull the walls by').not.toBeNull();
    const s = wall.boundingSphere!;

    // Standing beyond the cabin looking away from it. Every assertion above is
    // about culling never removing something visible; this one is the other half,
    // because a bounding sphere big enough to always intersect would satisfy all of
    // them and save nothing.
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    cam.position.set(s.center.x, s.center.y, s.center.z + s.radius + 150);
    cam.lookAt(s.center.x, s.center.y, s.center.z + s.radius + 250);
    expect(frustumOf(cam).intersectsObject(wall)).toBe(false);
    view.dispose();
  });
});
