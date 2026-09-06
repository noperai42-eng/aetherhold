/**
 * The overlays, and the ground they are painted on.
 *
 * Zone paint, designation marks, the selection ring and the drag preview are
 * all built a few centimetres over y = 0. The terrain is not at y = 0: a full
 * snowpack lifts it thirteen centimetres and the lake bed drops forty-two, both
 * further than any overlay rides. The bar here is that an overlay is always on
 * the surface as drawn — a stockpile does not vanish for the winter — and that
 * the number the overlays read is the number the terrain mesh actually used.
 *
 * `FxView` itself paints a sprite on a canvas at construction and cannot be
 * built without a DOM, so the promise is checked through the two pure helpers
 * the view places everything with.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  CROP_STAGES,
  berryClusterGeometry,
  bushGeometry,
  cropGeometry,
  cropStage,
  markHeight,
  strippedBushGeometry,
  tilledSoilGeometry,
} from '../src/client/render/fx';
import { TerrainView, groundLiftAt, rockTopAt } from '../src/client/render/terrain';
import { createWorld } from '../src/sim/worldgen';
import { terrainAt } from '../src/sim/types';
import type { World } from '../src/sim/types';

const SEED = 20260729;

/** The drawn height at a cell's centre: the mean of its four lattice corners. */
function drawnCentre(view: TerrainView, world: World, x: number, y: number): number {
  const ground = view.group.children[0] as THREE.Mesh;
  const p = ground.geometry.getAttribute('position');
  const base = (y * world.width + x) * 6;
  // The six vertices are two triangles over four corners; 0, 1, 2 and 5 are
  // each corner once (3 and 4 repeat 0 and 2).
  return (p.getY(base) + p.getY(base + 1) + p.getY(base + 2) + p.getY(base + 5)) / 4;
}

/** A grass cell with grass on every side, well inside the map. */
function openTurf(world: World): { x: number; y: number } {
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 2; x++) {
      let clear = true;
      for (let dy = -1; dy <= 1 && clear; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (terrainAt(world, x + dx, y + dy) !== 'grass') clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no open turf on this map');
}

describe('what the overlays stand on', () => {
  it('reads the same ground height the terrain mesh was built with', () => {
    // The helper restates the corner rule rather than sharing the view's
    // lattice, so this is the test that keeps the two from drifting: every cell
    // on the map, under a snowpack, over the lake, and with the ice half in.
    const world = createWorld(SEED);
    world.snow = 0.8;
    world.ice = 0.3;
    const view = new TerrainView(world);
    view.sync(world);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (terrainAt(world, x, y) === 'rock') continue;
        expect(groundLiftAt(world, x, y)).toBeCloseTo(drawnCentre(view, world, x, y), 6);
      }
    }
    view.dispose();
  });

  it('lifts every overlay clear of a full snowpack', () => {
    // The bug: paint at two centimetres, marks at five, the preview at six, all
    // under thirteen centimetres of snow. Whatever an overlay's own clearance,
    // it has to end up above the drawn surface.
    const world = createWorld(SEED);
    const { x, y } = openTurf(world);
    world.snow = 1;
    const surface = groundLiftAt(world, x, y);
    expect(surface).toBeGreaterThan(0.1);
    for (const lift of [0.02, 0.04, 0.05, 0.06]) {
      expect(markHeight(world, x, y, lift)).toBeCloseTo(surface + lift, 6);
    }
    world.snow = 0;
    expect(markHeight(world, x, y, 0.05)).toBeCloseTo(0.05, 6);
  });

  it('still rides the top of a rock block rather than the snow beside it', () => {
    const world = createWorld(SEED);
    world.snow = 1;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (terrainAt(world, x, y) !== 'rock') continue;
        expect(markHeight(world, x, y, 0.05)).toBeGreaterThan(rockTopAt(x, y));
        return;
      }
    }
    throw new Error('no rock on this map');
  });
});

function triangles(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}

describe('what a plant and a bush are made of', () => {
  it('grows a sown cell through three different shapes, each rooted in its cell', () => {
    // Growth used to scale one rosette, and from twenty cells up a seedling
    // scaled up is a seedling: the stages have to differ in shape, which here
    // means in vertex count, not just in the matrix. Each is built in
    // "one plant tall" units with its roots at the origin, so `syncCrops`'s
    // scale is a height, and reaches under half a cell so a full field never
    // pokes across the path beside it. Under three hundred triangles, since a
    // field is instanced per cell.
    const counts = new Set<number>();
    for (const stage of CROP_STAGES) {
      const geo = cropGeometry(stage);
      expect(triangles(geo)).toBeLessThanOrEqual(300);
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      expect(box.min.y).toBeGreaterThan(-1e-6);
      expect(box.max.y).toBeLessThanOrEqual(1.05);
      expect(Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z)).toBeLessThan(0.5);
      counts.add(geo.getAttribute('position').count);
      geo.dispose();
    }
    expect(counts.size).toBe(CROP_STAGES.length);
    expect(cropStage(0.15)).toBe(0);
    expect(cropStage(0.6)).toBe(1);
    expect(cropStage(1)).toBe(2);
  });

  it('shades a bush darker at the root than the crown, and keeps it in its cell', () => {
    // A bush that is one colour top to bottom is a ball; the inside of a
    // thicket is in shade. The gradient is a vertex-colour multiplier on the
    // instance tint, so it has to be there, under one at the ground and one at
    // the crown. The bush sits on the ground (nothing below y = 0, so the
    // squashed lobes never sink into the turf) and inside its cell at full
    // size, where a neighbour's berries may be a cell away.
    const geo = bushGeometry();
    expect(triangles(geo)).toBeLessThanOrEqual(300);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.y).toBeGreaterThan(-1e-6);
    expect(Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z)).toBeLessThan(0.5);
    const p = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    let lowest = 1;
    let highest = 0;
    for (let i = 0; i < p.count; i++) {
      lowest = Math.min(lowest, col.getX(i));
      highest = Math.max(highest, col.getX(i));
    }
    expect(lowest).toBeLessThan(0.6);
    expect(highest).toBeCloseTo(1, 6);
    geo.dispose();
  });

  it('keeps the canes of a stripped bush under its leaves, never caged over them', () => {
    // A picked-over bush is a plant that has lost its fruit, and a stem lives
    // under its own canopy. Drawn crossing over the leaves the dark wood reads
    // from the manager camera as a cage built round the foliage rather than as
    // the plant that carries it — which is exactly what the frames showed. So
    // every cane vertex sits below every leaf, and the wood is then seen only
    // where the canopy is gappy, which is where a branch is seen on a real bush.
    // The two parts are told apart by what they are painted: the canes are the
    // one part of the plant with the green taken out of them.
    const geo = strippedBushGeometry();
    expect(triangles(geo)).toBeLessThanOrEqual(300);
    const p = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    let wood = -1;
    let leaf = 1;
    for (let i = 0; i < p.count; i++) {
      if (col.getZ(i) < 0.8) wood = Math.max(wood, p.getY(i));
      else leaf = Math.min(leaf, p.getY(i));
    }
    expect(wood).toBeGreaterThan(0);
    expect(wood).toBeLessThan(leaf);
    geo.dispose();
  });

  it('grows a stripped bush lopsided rather than as a compass rose', () => {
    // Leaves evenly spaced round a centre are the loudest tell that a plant was
    // generated rather than grown — from overhead it is a rosette stamped on the
    // ground, and no bush is radially symmetric. Read as how far the plant
    // reaches in each eighth of the circle: a compass rose reaches the same
    // distance in all eight, and a bush that grew towards the light on one side
    // does not. It still has to stay inside its cell, where the next bush along
    // may be a cell away.
    const geo = strippedBushGeometry();
    const p = geo.getAttribute('position');
    const reach = new Array<number>(8).fill(0);
    for (let i = 0; i < p.count; i++) {
      const a = (Math.atan2(p.getX(i), p.getZ(i)) + Math.PI * 2) % (Math.PI * 2);
      const oct = Math.min(7, Math.floor(a / (Math.PI / 4)));
      reach[oct] = Math.max(reach[oct]!, Math.hypot(p.getX(i), p.getZ(i)));
    }
    expect(Math.max(...reach)).toBeGreaterThan(Math.min(...reach) * 1.4);
    expect(Math.max(...reach)).toBeLessThan(0.5);
    geo.dispose();
  });

  it('hangs every berry on the upper skin of the bush', () => {
    // The fruit is the ripeness signal, so a berry the bush hides is a signal
    // lost: none below the bush's waist, none outside the bush's footprint,
    // and all of it cheap enough to instance once per ripe bush.
    const berries = berryClusterGeometry();
    expect(triangles(berries)).toBeLessThanOrEqual(300);
    berries.computeBoundingBox();
    const box = berries.boundingBox!;
    expect(box.min.y).toBeGreaterThan(0.15);
    expect(Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z)).toBeLessThan(0.5);
    berries.dispose();
  });

  it('draws tilled earth flat in the cell, with furrows that are not all one shade', () => {
    // The overlay is lifted by `markHeight` like the other paint, so the
    // geometry itself has to be flat at y = 0 or it would ride at the wrong
    // height under the harvest mark. The furrows are two shades of vertex
    // colour on one geometry; if they were all one, the plot would be the pale
    // square nobody could find.
    const soil = tilledSoilGeometry();
    soil.computeBoundingBox();
    const box = soil.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(0, 6);
    expect(Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z)).toBeLessThan(0.5);
    const col = soil.getAttribute('color');
    const shades = new Set<number>();
    for (let i = 0; i < col.count; i++) shades.add(col.getX(i));
    expect(shades.size).toBe(2);
    soil.dispose();
  });
});
