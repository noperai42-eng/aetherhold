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
import { describe, expect, it } from 'vitest';

import { BuildingsView } from '../src/client/render/buildings';
import { BUILDING_COLOR, RESOURCE_COLOR } from '../src/client/render/palette';
import { groundLiftAt } from '../src/client/render/terrain';
import { BUILD_MENU, defOf } from '../src/sim/buildings';
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
