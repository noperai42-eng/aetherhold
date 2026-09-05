/**
 * The ground and the cliffs, as geometry.
 *
 * None of this needs a GPU: TerrainView builds buffers and matrices, and every
 * claim worth making about how the map looks — that grass fades into sand, that a
 * cliff darkens the ground at its foot, that no rock block leaves a gap you can
 * see through but not walk through — is a claim about numbers in those buffers.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  ROCK_EDGE,
  ROCK_HEIGHT,
  ROCK_JITTER,
  TerrainView,
  rockShapeAt,
  rockTopAt,
} from '../src/client/render/terrain';
import { TERRAIN_COLOR } from '../src/client/render/palette';
import { createWorld } from '../src/sim/worldgen';
import { TERRAIN_LIST, packCell, terrainAt } from '../src/sim/types';
import type { Terrain, World } from '../src/sim/types';

/** The sim writes terrain by index; the tests need the same door. */
function setTerrain(world: World, x: number, y: number, kind: Terrain): void {
  world.terrain[packCell(world, x, y)] = TERRAIN_LIST.indexOf(kind);
}

const SEED = 20260729;

/** The six ground vertices of one cell, as [r,g,b] triples. */
function cellColors(view: TerrainView, world: World, x: number, y: number): number[][] {
  const ground = view.group.children[0] as THREE.Mesh;
  const attr = ground.geometry.getAttribute('color') as THREE.BufferAttribute;
  const base = packCell(world, x, y) * 18;
  const out: number[][] = [];
  for (let i = 0; i < 6; i++) {
    out.push([attr.array[base + i * 3]!, attr.array[base + i * 3 + 1]!, attr.array[base + i * 3 + 2]!]);
  }
  return out;
}

function luma(rgb: number[]): number {
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

function rockCells(world: World): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) if (terrainAt(world, x, y) === 'rock') out.push({ x, y });
  }
  return out;
}

/** A small world with one deliberate grass/sand seam and one lone rock. */
function striped(): World {
  const world = createWorld(SEED);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) setTerrain(world, x, y, x < 20 ? 'grass' : 'sand');
  }
  setTerrain(world, 5, 5, 'rock');
  return world;
}

describe('the shape of a rock block', () => {
  it('is the same block every time it is asked', () => {
    for (const [x, y] of [
      [0, 0],
      [13, 41],
      [63, 63],
    ] as const) {
      expect(rockShapeAt(x, y)).toEqual(rockShapeAt(x, y));
    }
  });

  it('gives neighbouring cells different blocks', () => {
    const a = rockShapeAt(10, 10);
    const b = rockShapeAt(11, 10);
    const c = rockShapeAt(10, 11);
    expect(a.height).not.toBeCloseTo(b.height, 3);
    expect(a.height).not.toBeCloseTo(c.height, 3);
  });

  it('never grows past the height everything else clears', () => {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        const sh = rockShapeAt(x, y);
        expect(sh.height).toBeGreaterThan(1);
        expect(sh.height).toBeLessThanOrEqual(ROCK_HEIGHT);
      }
    }
  });

  /**
   * The one invariant that is not cosmetic. Rock is impassable, so if a tilted
   * block does not cover the whole cell it stood on, the player sees through a
   * corner they can never walk into — visuals disagreeing with collision. A square
   * turned by θ needs cos θ + sin θ of its own width to still cover the original.
   */
  it('always covers the cell it stands on, tilt and all', () => {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        const sh = rockShapeAt(x, y);
        const needed = Math.cos(sh.rot) + Math.abs(Math.sin(sh.rot));
        expect(sh.scale).toBeGreaterThanOrEqual(needed);
      }
    }
  });

  /**
   * The same invariant, now that the block is a boulder. Rounding a square's
   * corners cuts its diagonal in by r(1 − 1/√2), and a dent in its skin can cut
   * any side in by the jitter; the block has to be wide enough to pay for both
   * on top of the tilt, or the bevel opens the very seam the tilt was made to
   * close.
   */
  it('still covers the cell once its corners are rounded and its skin is dented', () => {
    const inset = 2 * ROCK_EDGE * (1 - Math.SQRT1_2) + 2 * ROCK_JITTER;
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        const sh = rockShapeAt(x, y);
        const needed = Math.cos(sh.rot) + Math.abs(Math.sin(sh.rot));
        expect(sh.scale * (1 - inset)).toBeGreaterThanOrEqual(needed);
      }
    }
  });

  it('reports a top that sits just under the block height', () => {
    const sh = rockShapeAt(7, 9);
    expect(rockTopAt(7, 9)).toBeCloseTo(sh.height - 0.15, 6);
    expect(rockTopAt(7, 9)).toBeLessThan(sh.height);
  });
});

describe('the boulder every block draws', () => {
  function boulder(): { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; view: TerrainView } {
    const view = new TerrainView(createWorld(SEED));
    const rocks = view.group.children[1] as THREE.InstancedMesh;
    return { geo: rocks.geometry, mat: rocks.material as THREE.MeshStandardMaterial, view };
  }

  /**
   * Everything that clears a rock or stands on one reads the crate, not the
   * mesh: `rockTopAt` is the crate's lid, `ROCK_HEIGHT` is its tallest lid, and
   * `scale` is its footprint. So the boulder must never leave the crate — a
   * vertex above the lid would poke through a floor built to clear it, and one
   * past the sides would grow the block past the width that was paid for.
   */
  it('stays inside the unit crate it replaced, and reaches its lid', () => {
    const { geo, view } = boulder();
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.max.y).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(box.max.y).toBeGreaterThan(0.5 - 1e-6);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.5 - 1e-6);
    expect(box.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(box.min.x).toBeGreaterThanOrEqual(-0.5 - 1e-6);
    expect(box.max.z).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(box.min.z).toBeGreaterThanOrEqual(-0.5 - 1e-6);
    view.dispose();
  });

  /**
   * Smooth is a property of the buffers, not of the lighting: the faces must
   * share their vertices across the seams, the normals must actually bend round
   * the bevel, and the material must not undo it all with flat shading. And
   * every one of those costs triangles on every one of thousands of instances,
   * so the count is part of the same bargain.
   */
  it('is one welded, smooth-shaded skin within the per-block triangle budget', () => {
    const { geo, mat, view } = boulder();
    expect(mat.flatShading).toBe(false);
    expect(geo.index).not.toBeNull();
    expect(geo.index!.count / 3).toBeLessThanOrEqual(300);

    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    let bent = 0;
    for (let i = 0; i < n.count; i++) {
      const ny = Math.abs(n.getY(i));
      if (ny > 0.15 && ny < 0.85) bent++;
    }
    // A crate has no normal that is neither flat nor upright; a boulder's shoulder is nothing else.
    expect(bent).toBeGreaterThan(0);
    view.dispose();
  });
});

describe('the ground as it is built', () => {
  it('puts one instance on every rock cell and parks the rest', () => {
    const world = createWorld(SEED);
    const view = new TerrainView(world);
    const rocks = view.group.children[1] as THREE.InstancedMesh;
    const expected = rockCells(world).length;

    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    let live = 0;
    for (let i = 0; i < rocks.count; i++) {
      rocks.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      if (scale.x > 0) live++;
    }
    expect(live).toBe(expected);
    view.dispose();
  });

  it('stands every block on its own cell at its own height', () => {
    const world = createWorld(SEED);
    const view = new TerrainView(world);
    const rocks = view.group.children[1] as THREE.InstancedMesh;
    const cells = rockCells(world);

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    // Instances are written in row-major cell order, so they line up with the scan.
    for (let i = 0; i < cells.length; i++) {
      rocks.getMatrixAt(i, m);
      m.decompose(pos, new THREE.Quaternion(), scale);
      const cell = cells[i]!;
      expect(pos.x).toBeCloseTo(cell.x, 6);
      expect(pos.z).toBeCloseTo(cell.y, 6);
      expect(scale.y).toBeCloseTo(rockShapeAt(cell.x, cell.y).height, 6);
      // Base buried, top exactly where the overlays are told it is.
      expect(pos.y - scale.y / 2).toBeLessThan(0);
      expect(pos.y + scale.y / 2).toBeCloseTo(rockTopAt(cell.x, cell.y), 6);
    }
    view.dispose();
  });

  it('gives each block its own shade rather than one flat grey', () => {
    const world = createWorld(SEED);
    const view = new TerrainView(world);
    const rocks = view.group.children[1] as THREE.InstancedMesh;
    expect(rocks.instanceColor).not.toBeNull();

    const c = new THREE.Color();
    const seen = new Set<string>();
    for (let i = 0; i < Math.min(40, rockCells(world).length); i++) {
      rocks.getColorAt(i, c);
      seen.add(c.getHexString());
    }
    expect(seen.size).toBeGreaterThan(10);
    view.dispose();
  });

  it('rebuilds when mining changes the terrain, and not otherwise', () => {
    const world = createWorld(SEED);
    const view = new TerrainView(world);
    const rocks = view.group.children[1] as THREE.InstancedMesh;
    const before = rockCells(world).length;

    view.sync(world);
    const target = rockCells(world)[0]!;
    setTerrain(world, target.x, target.y, 'stone');
    view.sync(world);

    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    let live = 0;
    for (let i = 0; i < rocks.count; i++) {
      rocks.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      if (scale.x > 0) live++;
    }
    expect(live).toBe(before - 1);
    view.dispose();
  });
});

describe('how the ground reads', () => {
  /**
   * The point of colouring corners instead of cells: at a seam, the two vertices
   * on the grass side and the two on the sand side must differ, or the map is
   * still a grid of flat tiles with hard edges.
   */
  it('blends one terrain into the next across a seam', () => {
    const world = striped();
    const view = new TerrainView(world);
    const seam = cellColors(view, world, 19, 30);
    const inland = cellColors(view, world, 10, 30);

    const seamSpread = Math.max(...seam.map(luma)) - Math.min(...seam.map(luma));
    const inlandSpread = Math.max(...inland.map(luma)) - Math.min(...inland.map(luma));
    expect(seamSpread).toBeGreaterThan(inlandSpread * 2);

    // And the blend goes the right way: the sand-side corners are the brighter ones.
    const grassSide = luma(seam[0]!);
    const sandSide = luma(seam[2]!);
    expect(sandSide).toBeGreaterThan(grassSide);
    view.dispose();
  });

  it('keeps a corner shared by two cells identical in both', () => {
    const world = striped();
    const view = new TerrainView(world);
    // Cell (10,30)'s +X corners are cell (11,30)'s -X corners.
    const left = cellColors(view, world, 10, 30);
    const right = cellColors(view, world, 11, 30);
    expect(left[5]).toEqual(right[0]);
    expect(left[2]).toEqual(right[1]);
    view.dispose();
  });

  it('darkens the ground at the foot of a cliff', () => {
    const world = striped();
    const view = new TerrainView(world);
    const touching = cellColors(view, world, 4, 4);
    const clear = cellColors(view, world, 10, 10);
    // The corner of (4,4) that meets the rock at (5,5) is its far corner.
    expect(luma(touching[2]!)).toBeLessThan(luma(clear[2]!) * 0.92);
    view.dispose();
  });

  it('mottles flat ground without banding it', () => {
    const world = striped();
    const view = new TerrainView(world);
    const pure = new THREE.Color(TERRAIN_COLOR.grass);
    const samples: number[] = [];
    for (let x = 8; x < 16; x++) samples.push(luma(cellColors(view, world, x, 30)[0]!));

    const spread = Math.max(...samples) - Math.min(...samples);
    expect(spread).toBeGreaterThan(0.001);
    // Mottling, not a repaint: every sample stays near the terrain's own colour.
    for (const s of samples) expect(Math.abs(s - luma([pure.r, pure.g, pure.b]))).toBeLessThan(0.05);
    view.dispose();
  });
});
