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
  ROCK_CREASE,
  ROCK_EDGE,
  ROCK_HEIGHT,
  ROCK_JITTER,
  TerrainView,
  rockShapeAt,
  rockTopAt,
} from '../src/client/render/terrain';
import { TERRAIN_COLOR, groundColor } from '../src/client/render/palette';
import { yearPhase } from '../src/sim/seasons';
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

/** The same world with nothing in it but grass: the mottle on its own, no seams. */
function meadow(): World {
  const world = createWorld(SEED);
  const grass = TERRAIN_LIST.indexOf('grass' as Terrain);
  for (let i = 0; i < world.terrain.length; i++) world.terrain[i] = grass;
  return world;
}

/**
 * One corner of every cell in a field, and how far the four corners of each cell
 * disagree — the two scales the ground's colour varies at, measured apart.
 */
function fieldLuma(view: TerrainView, world: World): { corners: number[]; cellSpread: number[] } {
  const corners: number[] = [];
  const cellSpread: number[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const cell = cellColors(view, world, x, y).map(luma);
      corners.push(cell[0]!);
      cellSpread.push(Math.max(...cell) - Math.min(...cell));
    }
  }
  return { corners, cellSpread };
}

function spreadOf(v: number[]): number {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
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
   * turned by θ needs |cos θ| + |sin θ| of its own width to still cover the
   * original, whichever quarter turn the tilt is sitting on.
   */
  it('always covers the cell it stands on, tilt and all', () => {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        const sh = rockShapeAt(x, y);
        const needed = Math.abs(Math.cos(sh.rot)) + Math.abs(Math.sin(sh.rot));
        expect(sh.scale).toBeGreaterThanOrEqual(needed);
      }
    }
  });

  /**
   * Every cell draws the same lopsided lump, so the only variety a cliff has
   * beyond height and shade is which way round each lump faces. If the hash
   * ever collapsed to one quadrant, the peaks would all lean the same way and
   * the cliff would be a grid of the same hump again.
   */
  it('turns the lump all four ways across a cliff', () => {
    const quadrants = new Set<number>();
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        quadrants.add(Math.round(rockShapeAt(x, y).rot / (Math.PI / 2)) % 4);
      }
    }
    expect(quadrants.size).toBe(4);
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
        const needed = Math.abs(Math.cos(sh.rot)) + Math.abs(Math.sin(sh.rot));
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

  /**
   * The lid is one point, not a plate. A block whose top ring sat at the lid
   * would still pass the crate test and still be a crate from the manager view —
   * a straight top edge on every cell is exactly the stacked-cube look the dome
   * exists to lose. So only a peak may touch the lid, and the top must fall away
   * from it: anything nearly half a cell from the peak is well below.
   */
  it('has a domed top that only its peak brings up to the lid', () => {
    const { geo, view } = boulder();
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    let peakX = 0;
    let peakZ = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) >= 0.5 - 1e-6) {
        peakX = p.getX(i);
        peakZ = p.getZ(i);
      }
    }
    let atLid = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.5 - 0.01) atLid++;
      if (Math.hypot(p.getX(i) - peakX, p.getZ(i) - peakZ) > 0.45) {
        expect(p.getY(i)).toBeLessThan(0.5 - 0.05);
      }
    }
    expect(atLid).toBeLessThan(p.count * 0.05);
    view.dispose();
  });

  /**
   * The base is what tiles. Two rock cells side by side are two of these meshes
   * with overlapping footprints, and it is the full-width ring at the bottom that
   * closes the seam between them and against the ground; a lump that narrowed at
   * its foot would show daylight under every cliff.
   */
  it('meets the ground at the full width of its cell', () => {
    const { geo, view } = boulder();
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    let reachX = 0;
    let reachZ = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > -0.5 + 1e-6) continue;
      reachX = Math.max(reachX, Math.abs(p.getX(i)));
      reachZ = Math.max(reachZ, Math.abs(p.getZ(i)));
    }
    expect(reachX).toBeCloseTo(0.5, 6);
    expect(reachZ).toBeCloseTo(0.5, 6);
    view.dispose();
  });

  /**
   * A dented skin can fold a normal back on itself, and a normal facing into the
   * rock lights that patch as a hole — from inside a body, a cave mouth in the
   * cliff that nobody can enter. Every normal has to face away from the block's
   * axis, wherever the noise put its vertex.
   */
  it('faces outward everywhere, so no dent lights as a cave', () => {
    const { geo, view } = boulder();
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const out = n.getX(i) * p.getX(i) + n.getY(i) * p.getY(i) + n.getZ(i) * p.getZ(i);
      expect(out).toBeGreaterThan(0);
    }
    view.dispose();
  });

  /**
   * Smooth is not the same as soft. A skin whose normals bend everywhere is a
   * cushion, and a cliff of cushions is the rolled mattress the boulder was
   * meant to replace. Stone has a rim where its sides meet its top, and the rim
   * is nothing but a split vertex: one position, two normals, the angle between
   * them past the crease. So the shoulder ring must be split all the way round
   * — and only where there is an edge to show for it, since every split is a
   * vertex on every one of thousands of instances.
   */
  it('keeps a hard rim where the sides meet the cap, so a cliff reads as stone', () => {
    const { geo, view } = boulder();
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    const at = new Map<string, number[]>();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
      if (!at.has(key)) at.set(key, []);
      at.get(key)!.push(i);
    }
    let rim = 0;
    for (const ids of at.values()) {
      if (ids.length < 2) continue;
      // A side normal and a cap normal on the same point is the shoulder.
      const side = ids.some((i) => Math.abs(n.getY(i)) < 0.25);
      const cap = ids.some((i) => n.getY(i) > 0.45);
      if (side && cap) rim++;
      // And any two normals on one point must be further apart than the crease,
      // or the split bought nothing and cost a vertex.
      for (const a of ids) {
        for (const b of ids) {
          if (a >= b) continue;
          const dot = n.getX(a) * n.getX(b) + n.getY(a) * n.getY(b) + n.getZ(a) * n.getZ(b);
          expect(Math.acos(Math.min(1, dot))).toBeGreaterThan(ROCK_CREASE / 2);
        }
      }
    }
    expect(rim).toBeGreaterThanOrEqual(12);
    expect(p.count).toBeLessThan(at.size * 1.6);
    view.dispose();
  });

  /**
   * The ground darkens toward a cliff, and the cliff has to darken toward the
   * ground, or the seam between them is a bright wall standing on a dark
   * floor. That is a colour attribute on the mesh, and a material that reads
   * it: either one missing and the base is as bright as the plateau.
   */
  it('is darker at its foot than on its plateau', () => {
    const { geo, mat, view } = boulder();
    expect(mat.vertexColors).toBe(true);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const c = geo.getAttribute('color') as THREE.BufferAttribute;
    let foot = 0;
    let feet = 0;
    let top = 0;
    let tops = 0;
    for (let i = 0; i < p.count; i++) {
      const l = luma([c.getX(i), c.getY(i), c.getZ(i)]);
      if (p.getY(i) < -0.45) {
        foot += l;
        feet++;
      } else if (p.getY(i) > 0.4) {
        top += l;
        tops++;
      }
    }
    expect(feet).toBeGreaterThan(0);
    expect(tops).toBeGreaterThan(0);
    expect(foot / feet).toBeLessThan((top / tops) * 0.8);
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

  /**
   * Light and dark is one axis, and the eye finds the repeat in one axis from
   * across the map. A cliff wants blocks that lean warm, blocks that lean cool
   * and blocks with lichen on them, all in the same face, so there is no
   * single grey for the pattern to be a pattern of. Each is a lerp toward a
   * colour that has a hue, so each shows up as a sign in the channels.
   */
  it('leans its blocks warm, cool and green, not only light and dark', () => {
    const world = createWorld(SEED);
    const view = new TerrainView(world);
    const rocks = view.group.children[1] as THREE.InstancedMesh;
    const c = new THREE.Color();
    let warm = 0;
    let cool = 0;
    let lichen = 0;
    for (let i = 0; i < Math.min(80, rockCells(world).length); i++) {
      rocks.getColorAt(i, c);
      if (c.r > c.b) warm++;
      if (c.b > c.r + 0.02) cool++;
      if (c.g > c.r && c.g > c.b) lichen++;
    }
    expect(warm).toBeGreaterThan(0);
    expect(cool).toBeGreaterThan(0);
    expect(lichen).toBeGreaterThan(0);
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

  /**
   * The manager camera is where the ground is most of the frame, and it is the
   * camera that averages away everything finer than a cell. A field whose
   * corners all sit within a few percent of one another is one flat tint there,
   * however carefully that tint was chosen — grass came out as a single green
   * for four rounds because the only variation it had was three percent of
   * luminance hashed per corner, which is under a level of the two hundred and
   * fifty-six the screen has and disappears the moment two corners share a
   * pixel. Nine percent, spread across whole handfuls of cells, is a meadow with
   * light and dark in it.
   */
  it('spreads a field of one terrain wide enough to see from the manager camera', () => {
    const world = meadow();
    const view = new TerrainView(world);
    const { corners } = fieldLuma(view, world);
    const mean = corners.reduce((a, b) => a + b, 0) / corners.length;
    expect(spreadOf(corners) / mean).toBeGreaterThan(0.07);
    view.dispose();
  });

  /**
   * And spends nothing to get it. The mottle darkens patches and lifts what is
   * left over to pay for them, which is only honest if the two cancel: a valley
   * that came out darker or brighter than the palette meant it to would be a
   * repaint of every ground colour in the game, made here, in a renderer, where
   * nobody would think to look for it.
   */
  it('leaves the field at the brightness the palette chose for it', () => {
    const world = meadow();
    const view = new TerrainView(world);
    const { corners } = fieldLuma(view, world);
    const mean = corners.reduce((a, b) => a + b, 0) / corners.length;
    const own = groundColor(new THREE.Color(), 'grass', yearPhase(world), 0);
    const ratio = mean / luma([own.r, own.g, own.b]);
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.03);
    view.dispose();
  });

  /**
   * Where that variation is allowed to live. A cell is four corners of one quad,
   * and the whole point of colouring ground at its corners is that neighbouring
   * cells bleed together; a cell whose own corners disagree as loudly as the map
   * does has stopped bleeding and started reading as a tile, which is the seam
   * test above failing for the opposite reason. So the mottle is spent between
   * cells and not inside them — a statement about its wavelength, and the reason
   * the luminance patch is eight cells wide while the hue drift, which costs the
   * cell nothing, is four.
   */
  it('varies between cells rather than inside one, so a seam is still a seam', () => {
    const world = meadow();
    const view = new TerrainView(world);
    const { corners, cellSpread } = fieldLuma(view, world);
    const sorted = [...cellSpread].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)]!;
    expect(spreadOf(corners)).toBeGreaterThan(typical * 1.5);
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
