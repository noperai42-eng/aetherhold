/**
 * The ground scatter.
 *
 * It is decoration, so the bar is not "does it look nice" — it is "does it stay
 * off everything that matters": no grass through a stove, no stones on a sown
 * plot, and the same blade in the same place every session, in both views.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  DecorView,
  bladeGeometry,
  foldedBladeGeometry,
  scatterChecksum,
} from '../src/client/render/decor';
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

  it('gives every tuft on a cell its own height, bearing and tone', () => {
    // Three tufts a cell drawn at one height, one bearing and one green is one
    // stamp printed three times, and a map of that reads as a texture laid over
    // the ground rather than as ground. The three on a cell have to differ in
    // all three, and the map as a whole has to take many values of each — a
    // handful of them would be a pattern the eye finds in a second.
    const world = meadow();
    const { tufts } = meshes(new DecorView(world));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const c = new THREE.Color();
    const heights = new Set<string>();
    const bearings = new Set<string>();
    const tones = new Set<number>();
    for (let i = 0; i < 3; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), q, scale);
      heights.add(scale.y.toFixed(4));
      bearings.add(`${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)}`);
      tufts.getColorAt(i, c);
      tones.add(c.getHex());
    }
    expect(heights.size).toBe(3);
    expect(bearings.size).toBe(3);
    expect(tones.size).toBe(3);
    for (let i = 0; i < 300; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), q, scale);
      heights.add(scale.y.toFixed(4));
      tufts.getColorAt(i, c);
      tones.add(c.getHex());
    }
    expect(heights.size).toBeGreaterThan(100);
    expect(tones.size).toBeGreaterThan(100);
  });

  it('thins the grass where the ground around it has gone bare', () => {
    // Turf does not stop at a line. Grass drawn at full height right up to the
    // edge of a trampled yard was the tell that it was a texture and not a
    // place — so a tuft with cleared ground around it stands lower, and the
    // later tufts on that cell nearly not at all. What must *not* change is how
    // many there are: the pool is sized at three a cell and so is every count
    // in this file, and bare ground is meant to read as bare because almost
    // nothing is standing on it.
    const world = meadow();
    for (let y = 20; y < 24; y++) {
      for (let x = 20; x < 24; x++) world.cellBuilding[packCell(world, x, y)] = 1;
    }
    const { tufts } = meshes(new DecorView(world));
    expect(tufts.count).toBe((world.width * world.height - 16) * 3);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let yard = 0;
    let yardN = 0;
    let open = 0;
    let openN = 0;
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, m);
      m.decompose(pos, new THREE.Quaternion(), scale);
      const d = Math.max(Math.abs(pos.x - 21.5), Math.abs(pos.z - 21.5));
      if (d < 3) {
        yard += scale.y;
        yardN++;
      } else if (d > 8) {
        open += scale.y;
        openN++;
      }
    }
    expect(yardN).toBeGreaterThan(0);
    expect(yard / yardN).toBeLessThan((open / openN) * 0.9);
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

  it('gives a tuft a footprint from straight overhead, not just from the side', () => {
    // The manager camera looks almost straight down, and a clump of upright
    // blades seen from there is three lines meeting at a point: no matter how
    // the tuft is turned, the cell under it reads as bare. The blades have to
    // fall away from the root on bearings far apart, so that whichever third of
    // the compass the eye comes from, something is spread out under it. Read as
    // the furthest any vertex gets from the root in each third of the circle.
    const view = new DecorView(meadow());
    const p = meshes(view).tufts.geometry.getAttribute('position');
    const reach = [0, 0, 0];
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const third = Math.min(2, Math.floor((a + Math.PI) / ((Math.PI * 2) / 3)));
      reach[third] = Math.max(reach[third]!, Math.hypot(p.getX(i), p.getZ(i)));
    }
    for (const r of reach) expect(r).toBeGreaterThan(0.3);
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

  it('creases a blade down its middle, so its two halves cannot take one light', () => {
    // A flat strip has one plane and so one normal, and from the manager camera
    // looking straight down that is what made a tuft read as folded paper: the
    // light could not tell one half of a leaf from the other. The crease is what
    // gives a blade a cross-section — the midline has to stand off the chord
    // between its own edges, and the two halves have to lean opposite ways, or
    // the geometry is a strip with extra vertices in it.
    const geo = foldedBladeGeometry(0.5, 0.34, 0.8);
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    let left = -1;
    let right = -1;
    let mid = -1;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) <= 0 || p.getY(i) >= 1) continue;
      if (Math.abs(p.getX(i)) < 1e-6) mid = i;
      else if (p.getX(i) < 0) left = i;
      else right = i;
    }
    expect(Math.min(left, right, mid)).toBeGreaterThanOrEqual(0);
    // Both edges of the crease sit at one height, so "off the chord" is the one
    // number: how far the midline is pushed out of their plane.
    expect(p.getY(left)).toBeCloseTo(p.getY(right), 6);
    expect(p.getZ(mid) - p.getZ(left)).toBeGreaterThan(Math.abs(p.getX(left)) * 0.25);
    expect(n.getX(left)).toBeGreaterThan(0.2);
    expect(n.getX(right)).toBeLessThan(-0.2);
    geo.dispose();
  });

  it('keeps a creased blade to five triangles, since three of them share one tuft', () => {
    // The crease costs a row of vertices, and the grass is instanced tens of
    // thousands of times, so where that row goes is decided by arithmetic: three
    // blades inside sixteen triangles leaves five each and nothing spare. A
    // blade that grew another row would still merge and still draw; what it
    // would stop doing is fitting, and this is where that shows.
    const blade = foldedBladeGeometry(0.5, 0.34, 0.8);
    expect(triangles(blade)).toBe(5);
    const view = new DecorView(meadow());
    expect(triangles(meshes(view).tufts.geometry)).toBe(triangles(blade) * 3);
    blade.dispose();
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
