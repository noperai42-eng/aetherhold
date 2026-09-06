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

import { markHeight } from '../src/client/render/fx';
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
