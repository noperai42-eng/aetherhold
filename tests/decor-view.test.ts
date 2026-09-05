/**
 * The ground scatter.
 *
 * It is decoration, so the bar is not "does it look nice" — it is "does it stay
 * off everything that matters": no grass through a stove, no stones on a sown
 * plot, and the same blade in the same place every session, in both views.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { DecorView, scatterChecksum } from '../src/client/render/decor';
import { createWorld } from '../src/sim/worldgen';
import { TERRAIN_LIST, packCell, terrainAt } from '../src/sim/types';
import type { Terrain, World } from '../src/sim/types';

const SEED = 20260729;

function setTerrain(world: World, x: number, y: number, kind: Terrain): void {
  world.terrain[packCell(world, x, y)] = TERRAIN_LIST.indexOf(kind);
}

/** Every live instance of a mesh, as the cell it sits on. */
function occupiedCells(mesh: THREE.InstancedMesh): { x: number; y: number }[] {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    pos.setFromMatrixPosition(m);
    out.push({ x: Math.round(pos.x), y: Math.round(pos.z) });
  }
  return out;
}

function meshes(view: DecorView): { tufts: THREE.InstancedMesh; stones: THREE.InstancedMesh } {
  return {
    tufts: view.group.children[0] as THREE.InstancedMesh,
    stones: view.group.children[1] as THREE.InstancedMesh,
  };
}

/** Flat grass with nothing on it — the simplest map to count against. */
function meadow(): World {
  const world = createWorld(SEED);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) setTerrain(world, x, y, 'grass');
  }
  world.cellBuilding.fill(-1);
  world.zones.length = 0;
  return world;
}

describe('what the scatter notices changing', () => {
  it('changes when the ground is mined out', () => {
    const world = createWorld(SEED);
    const before = scatterChecksum(world);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (terrainAt(world, x, y) === 'rock') {
          setTerrain(world, x, y, 'stone');
          break;
        }
      }
    }
    expect(scatterChecksum(world)).not.toBe(before);
  });

  it('changes when something is built on a cell', () => {
    const world = meadow();
    const before = scatterChecksum(world);
    world.cellBuilding[packCell(world, 30, 30)] = 7;
    expect(scatterChecksum(world)).not.toBe(before);
  });

  it('changes when a plot is sown', () => {
    const world = meadow();
    const before = scatterChecksum(world);
    world.zones.push({ id: 1, kind: 'growing', cells: [packCell(world, 12, 12)], accepts: [] });
    expect(scatterChecksum(world)).not.toBe(before);
  });

  it('says nothing changed when nothing did', () => {
    const world = createWorld(SEED);
    expect(scatterChecksum(world)).toBe(scatterChecksum(world));
  });
});

describe('where the scatter lands', () => {
  it('puts three blades on every clear patch of turf', () => {
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    expect(tufts.count).toBe(world.width * world.height * 3);
  });

  it('keeps grass out of buildings and off sown plots', () => {
    const world = meadow();
    const built = packCell(world, 30, 30);
    const sown = packCell(world, 12, 12);
    world.cellBuilding[built] = 7;
    world.zones.push({ id: 1, kind: 'growing', cells: [sown], accepts: [] });

    const view = new DecorView(world);
    const cells = occupiedCells(meshes(view).tufts);
    expect(cells.some((c) => c.x === 30 && c.y === 30)).toBe(false);
    expect(cells.some((c) => c.x === 12 && c.y === 12)).toBe(false);
    expect(cells.some((c) => c.x === 31 && c.y === 30)).toBe(true);
    view.dispose();
  });

  it('never puts a blade of grass on rock, water or bare stone', () => {
    const world = createWorld(SEED);
    const view = new DecorView(world);
    for (const c of occupiedCells(meshes(view).tufts)) {
      expect(terrainAt(world, c.x, c.y)).toBe('grass');
    }
    view.dispose();
  });

  it('scatters stones only on the bare ground that would have them', () => {
    const world = createWorld(SEED);
    const view = new DecorView(world);
    const stones = occupiedCells(meshes(view).stones);
    expect(stones.length).toBeGreaterThan(0);
    for (const c of stones) {
      expect(['dirt', 'stone', 'sand']).toContain(terrainAt(world, c.x, c.y));
    }
    view.dispose();
  });

  it('stands every blade above ground and under knee height', () => {
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let i = 0; i < Math.min(tufts.count, 500); i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(pos, new THREE.Quaternion(), scale);
      expect(pos.y).toBeCloseTo(0, 6);
      expect(scale.y).toBeGreaterThan(0.2);
      expect(scale.y).toBeLessThan(0.6);
    }
  });

  it('puts the same blades in the same places every time', () => {
    const a = occupiedCells(meshes(new DecorView(meadow())).tufts);
    const b = occupiedCells(meshes(new DecorView(meadow())).tufts);
    expect(a).toEqual(b);
  });
});

describe('what a blade and a stone are made of', () => {
  it('keeps a blade cheap, rooted at the origin and one unit tall', () => {
    // The blade is instanced once per tuft across the whole map, so a few extra
    // triangles here is tens of thousands on screen. And the instance matrix
    // scales y straight to the blade's height: a geometry whose roots drifted
    // off the origin or whose tip was not at y = 1 would plant every tuft in the
    // wrong place and lie to the knee-height check above.
    const view = new DecorView(meadow());
    const geo = meshes(view).tufts.geometry;
    expect(triangles(geo)).toBeLessThanOrEqual(16);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(1, 6);
    expect(Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z)).toBeLessThan(1);
    view.dispose();
  });

  it('lights grass and stones as curved surfaces, seen from either side', () => {
    // Flat shading is what makes a pebble read as a die and a blade as a spike:
    // one normal per facet. A blade is also a sheet with no back, so it has to
    // draw from both sides or it vanishes for half a turn in first person.
    const view = new DecorView(meadow());
    const { tufts, stones } = meshes(view);
    const grass = tufts.material as THREE.MeshLambertMaterial;
    const rock = stones.material as THREE.MeshLambertMaterial;
    expect(grass.flatShading).toBe(false);
    expect(grass.side).toBe(THREE.DoubleSide);
    expect(rock.flatShading).toBe(false);
    // A stone whose corners were never welded would still be facets under a
    // smooth material — every triangle carrying its own three vertices.
    expect(stones.geometry.index).not.toBeNull();
    expect(stones.geometry.getAttribute('position').count).toBeLessThan(triangles(stones.geometry) * 3);
    expect(triangles(stones.geometry)).toBeLessThanOrEqual(200);
    view.dispose();
  });
});

function triangles(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}

describe('the scatter keeping up with the colony', () => {
  it('clears the turf under a wall the moment it goes up', () => {
    const world = meadow();
    const view = new DecorView(world);
    const before = meshes(view).tufts.count;

    world.cellBuilding[packCell(world, 30, 30)] = 7;
    view.sync(world, 100);

    const { tufts } = meshes(view);
    expect(tufts.count).toBe(before - 3);
    expect(occupiedCells(tufts).some((c) => c.x === 30 && c.y === 30)).toBe(false);
    view.dispose();
  });

  it('does no work at all when nothing has moved', () => {
    const world = meadow();
    const view = new DecorView(world);
    const { tufts } = meshes(view);
    view.sync(world, 20);
    const version = tufts.instanceMatrix.version;
    view.sync(world, 40);
    expect(tufts.instanceMatrix.version).toBe(version);
    view.dispose();
  });

  it('leaves the whole scatter hidden on low quality', () => {
    const world = meadow();
    const view = new DecorView(world);
    view.setDecor(false);
    expect(view.group.visible).toBe(false);
    view.setDecor(true);
    expect(view.group.visible).toBe(true);
    view.dispose();
  });
});
