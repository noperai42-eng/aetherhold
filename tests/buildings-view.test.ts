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
import { BUILD_MENU, defOf } from '../src/sim/buildings';
import { addBuilding } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import type { BuildingKind, World } from '../src/sim/types';

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
