/**
 * The ground scatter.
 *
 * It is decoration, so the bar is not "does it look nice" — it is "does it stay
 * off everything that matters": no grass through a stove, no stones on a sown
 * plot, and the same blade in the same place every session, in both views.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { DecorView, bladeGeometry, scatterChecksum } from '../src/client/render/decor';
import { TERRAIN_COLOR } from '../src/client/render/palette';
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

  it('keeps every blade below the knee, never up at the waist', () => {
    // The looser cap above is what "knee height" tolerates; this is what the
    // first-person camera needs. At 1.6 m off the ground a blade over forty
    // centimetres fills the lower third of the frame and makes the settler
    // beside it look a metre tall. Every tuft on the map, not a sample — the
    // one outlier is the one the player walks past.
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    let tallest = 0;
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      tallest = Math.max(tallest, scale.y);
    }
    expect(tallest).toBeLessThanOrEqual(0.4);
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

  it('plants a clump of slim blades on one root, not a single shard', () => {
    // From the manager camera one blade is a chevron; three leaning out of the
    // same root are grass. Every root vertex sits at y = 0 and within a blade's
    // width of the origin, which is what "sharing one root" means — and the
    // count of them is the count of blades, since a strip has two.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    let roots = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i)) > 1e-6) continue;
      roots++;
      expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThan(0.3);
    }
    expect(roots).toBeGreaterThanOrEqual(6);
    view.dispose();
  });

  it('lights a blade from turf-green at the root to a paler tip', () => {
    // Blades darker than the lawn they stand on peppered every overhead frame
    // with black shards. The gradient is baked into the geometry — the shader
    // multiplies it with the per-tuft tint — so it has to be there, the root
    // must be no darker than the ground's own green, and the tip lighter still
    // so the top of a tuft catches light instead of going black.
    const view = new DecorView(meadow());
    const { tufts } = meshes(view);
    expect((tufts.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    const geo = tufts.geometry;
    const p = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    expect(col).toBeDefined();
    // Lightness is judged in sRGB — the space the palette is written in —
    // since three keeps every colour linear-light once it is set.
    const hsl = { h: 0, s: 0, l: 0 };
    const turf = new THREE.Color(TERRAIN_COLOR.grass).getHSL(hsl, THREE.SRGBColorSpace).l;
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const l = c.fromBufferAttribute(col, i).getHSL(hsl, THREE.SRGBColorSpace).l;
      if (Math.abs(p.getY(i)) < 1e-6) expect(l).toBeGreaterThanOrEqual(turf);
      if (Math.abs(p.getY(i) - 1) < 1e-6) expect(l).toBeGreaterThan(turf + 0.1);
    }
    view.dispose();
  });

  it('keeps the tip of a blade green, not straw', () => {
    // A yellow-green tip caught the light, and nine thousand of them turned the
    // wide frames the colour of hay. The tip has to stay in the green band —
    // paler than the root, but the same leaf. Hue is read in sRGB like the
    // lightness test above; the band is 83° to 130°, yellow-green through to
    // blue-green, with straw (below 75°) outside it.
    const view = new DecorView(meadow());
    const geo = meshes(view).tufts.geometry;
    const p = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    const c = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    let tips = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - 1) > 1e-6) continue;
      tips++;
      const { h } = c.fromBufferAttribute(col, i).getHSL(hsl, THREE.SRGBColorSpace);
      expect(h).toBeGreaterThan(0.23);
      expect(h).toBeLessThan(0.36);
    }
    expect(tips).toBeGreaterThan(0);
    view.dispose();
  });

  it('lights a stone off the sky as well as the sun', () => {
    // Lambert takes the sun and nothing else, and a pebble nearly the colour of
    // the dirt it lies on is then a flat disc. A standard material reads the
    // scene's environment map and puts a rim along the lump's upper edge, which
    // is the one cue that says "this is a thing sitting on the ground". Rough
    // enough to stay stone and not wet plastic.
    const view = new DecorView(meadow());
    const rock = meshes(view).stones.material as THREE.MeshStandardMaterial;
    expect(rock.isMeshStandardMaterial).toBe(true);
    expect(rock.roughness).toBeGreaterThanOrEqual(0.7);
    expect(rock.roughness).toBeLessThanOrEqual(0.9);
    view.dispose();
  });

  it('colours every stone a mid tone, and no two fields of them alike', () => {
    // A loose stone in the cliff's navy grey came out as a black dot on lit
    // dirt from overhead. Every instance has to stay in the middle of the range
    // — never near black, never blown out — and they must not all be the one
    // colour, or the scatter reads as a stamp.
    const world = createWorld(SEED);
    const view = new DecorView(world);
    const { stones } = meshes(view);
    expect(stones.count).toBeGreaterThan(1);
    const c = new THREE.Color();
    const seen = new Set<number>();
    for (let i = 0; i < stones.count; i++) {
      stones.getColorAt(i, c);
      const { l } = c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
      expect(l).toBeGreaterThan(0.38);
      expect(l).toBeLessThan(0.62);
      seen.add(c.getHex());
    }
    expect(seen.size).toBeGreaterThan(1);
    view.dispose();
  });

  it('ends a blade in one tip, at the height and the bow the callers hang things on', () => {
    // The blade is not only grass: the crops in `fx.ts` build their leaves,
    // sprouts and stalks out of it, and a headed plant hangs a cluster of grain
    // on the *tip* of a stalk. That caller has to be able to say where the tip
    // is without reading this geometry, and the answer is (0, 1, bend) — one
    // vertex, at full height, carrying the whole of the forward bow. A head
    // placed on a tip that had quietly moved floats off the end of its stalk.
    const bend = 0.3;
    const geo = bladeGeometry(0.2, 3, bend);
    const p = geo.getAttribute('position');
    let tips = 0;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - 1) > 1e-6) continue;
      tips++;
      expect(p.getX(i)).toBeCloseTo(0, 6);
      expect(p.getZ(i)).toBeCloseTo(bend, 6);
    }
    expect(tips).toBe(1);
    geo.dispose();
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
