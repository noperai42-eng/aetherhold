/**
 * The finds on the map, as things you can see.
 *
 * The bar here is that the picture and the simulation never disagree about what
 * the colony knows. A marker over a site somebody already surveyed is a to-do
 * the player cannot clear; a site with nothing on it at all is the bug this
 * whole module exists to fix — eighteen buried caches and ore seams that the map
 * never once mentioned.
 *
 * The other half is that it stays cheap and stays put: four draw calls for the
 * whole set however many finds a map holds, and a cairn that does not move when
 * something across the map changes.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { LandmarkView } from '../src/client/render/landmarks';
import { createWorld } from '../src/sim/worldgen';
import type { World } from '../src/sim/types';

const SEED = 20260729;

/** Every drawn instance of a mesh, as a world position. */
function placed(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(new THREE.Vector3().setFromMatrixPosition(m));
  }
  return out;
}

/** The four instanced meshes, in the order the view adds them. */
function meshes(view: LandmarkView): THREE.InstancedMesh[] {
  return view.group.children.filter(
    (c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh === true,
  );
}

function pins(view: LandmarkView): THREE.InstancedMesh {
  const all = meshes(view);
  return all[all.length - 1]!;
}

/** Ground pieces — everything except the markers. */
function ground(view: LandmarkView): THREE.Vector3[] {
  const all = meshes(view);
  return all.slice(0, -1).flatMap(placed);
}

function view(world: World): LandmarkView {
  const v = new LandmarkView(world);
  v.sync(world, world.tick);
  return v;
}

describe('what the map shows about what is out there', () => {
  it('marks every site nobody has been to yet', () => {
    const world = createWorld(SEED);
    expect(world.sites.length).toBeGreaterThan(0);
    const v = view(world);
    expect(pins(v).count).toBe(world.sites.length);
    v.dispose();
  });

  it('puts each marker over its own site', () => {
    const world = createWorld(SEED);
    const v = view(world);
    const at = placed(pins(v)).map((p) => `${Math.round(p.x)},${Math.round(p.z)}`).sort();
    const want = world.sites.map((s) => `${s.x},${s.y}`).sort();
    expect(at).toEqual(want);
    v.dispose();
  });

  it('floats the marker clear of the ground it stands on', () => {
    // Not decoration and not an obstacle: it hangs where nothing in the world
    // hangs, which is the only thing telling the player it is a marker and not a
    // post they are meant to walk round. Nothing here is collidable.
    const world = createWorld(SEED);
    const v = view(world);
    for (const p of placed(pins(v))) expect(p.y).toBeGreaterThan(1.5);
    // The ground pieces are the opposite promise: knee high at the very most, so
    // walking through one in first person is not a thing you notice.
    for (const g of ground(v)) expect(g.y).toBeLessThan(0.8);
    v.dispose();
  });

  it('takes the marker down once a settler has read the site', () => {
    const world = createWorld(SEED);
    const v = view(world);
    const before = pins(v).count;
    world.sites[0]!.found = true;
    v.sync(world, world.tick + 1);
    // A marker still standing over a surveyed site is a to-do the player cannot
    // clear — the one failure that would make the whole map read as noise.
    expect(pins(v).count).toBe(before - 1);
    const near = placed(pins(v)).some(
      (p) => Math.round(p.x) === world.sites[0]!.x && Math.round(p.z) === world.sites[0]!.y,
    );
    expect(near).toBe(false);
    v.dispose();
  });

  it('leaves the find itself behind where the marker was', () => {
    const world = createWorld(SEED);
    const site = world.sites[0]!;
    const v = view(world);
    site.found = true;
    v.sync(world, world.tick + 1);
    // Whatever kind it was, something is standing on that cell afterwards: the
    // crate, the split seam or the cold camp. Where the colony has been is meant
    // to stay legible a week later.
    const here = ground(v).filter(
      (p) => Math.abs(p.x - site.x) < 1.5 && Math.abs(p.z - site.y) < 1.5,
    );
    expect(here.length).toBeGreaterThan(0);
    v.dispose();
  });

  it('draws every find on the map in four calls', () => {
    // One mesh per primitive rather than one per rock. Eighteen sites of loose
    // stones and sticks would otherwise add more draw calls than the entire
    // rest of the colony has.
    const world = createWorld(SEED);
    const v = view(world);
    expect(meshes(v).length).toBe(4);
    expect(v.group.children.length).toBe(4);
    v.dispose();
  });

  it('does not move a cairn when something unrelated is surveyed', () => {
    const world = createWorld(SEED);
    const v = view(world);
    const before = placed(pins(v))
      .map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)
      .sort();
    world.sites[world.sites.length - 1]!.found = true;
    v.sync(world, world.tick + 1);
    const after = placed(pins(v))
      .map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`)
      .sort();
    // Placement is seeded off the site's own id, so the rest of the map holds
    // still while one find resolves.
    expect(after).toEqual(before.filter((s) => after.includes(s)));
    expect(after.length).toBe(before.length - 1);
    v.dispose();
  });

  it('bobs the marker on the sim clock, so a paused game holds still', () => {
    const world = createWorld(SEED);
    const v = view(world);
    const still = placed(pins(v))[0]!.y;
    v.sync(world, world.tick);
    expect(placed(pins(v))[0]!.y).toBe(still);
    v.sync(world, world.tick + 30);
    expect(placed(pins(v))[0]!.y).not.toBe(still);
    v.dispose();
  });

  it('rounds every ground piece off without letting it grow or go flat', () => {
    // The pieces are placed by radius — a cairn stone bites into the one below
    // because their centres are less than two radii apart, a crate lid leans off
    // a crate edge. A rounded shape that had swelled past its unit would float
    // those overlaps apart; one lit flat would be back to the die it replaced.
    // And they draw once per rock across the map, so each stays under budget.
    const world = createWorld(SEED);
    const v = view(world);
    for (const mesh of meshes(v).slice(0, -1)) {
      const mat = mesh.material as THREE.MeshLambertMaterial;
      expect(mat.flatShading).toBe(false);
      const geo = mesh.geometry;
      const tris = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
      expect(tris).toBeLessThanOrEqual(200);
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(box.min[axis]).toBeGreaterThanOrEqual(-0.56);
        expect(box.max[axis]).toBeLessThanOrEqual(0.56);
      }
    }
    v.dispose();
  });

  it('copes with a map that has no finds on it at all', () => {
    const world = createWorld(SEED);
    world.sites.length = 0;
    const v = view(world);
    expect(pins(v).count).toBe(0);
    expect(ground(v).length).toBe(0);
    v.dispose();
  });
});
