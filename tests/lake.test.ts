/**
 * The lake.
 *
 * Two things are being pinned here and they are different in kind. The first is
 * that a lake shows up at all and looks like one — that is a claim about the
 * generator, and it is allowed to be a claim about a *sample* of seeds, because
 * a generator that retries six times and then gives up is honestly describing a
 * map that can run out of room.
 *
 * The second is the set of invariants the rest of the build now leans on: no
 * water in the yard, no water touching rock, a sand ring all the way round, and
 * nothing the colony needs cut off behind it. Those are absolute, per-seed, and
 * a failure in any of them is a broken map rather than an unlucky one — the rock
 * margin in particular is load-bearing for the renderer, which sinks the lake bed
 * far enough that a cliff sharing a corner with it would float.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { TerrainView } from '../src/client/render/terrain';
import { createWorld, HOME_X, HOME_Y, MAP_H, MAP_W } from '../src/sim/worldgen';
import { isWalkable } from '../src/sim/grid';
import { findPath } from '../src/sim/path';
import { packCell, terrainAt, type World } from '../src/sim/types';

const SEEDS = [1, 2, 3, 4, 5, 7, 13, 31, 42, 77, 101, 99001];

function waterCells(world: World): number[] {
  const out: number[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (terrainAt(world, x, y) === 'water') out.push(packCell(world, x, y));
    }
  }
  return out;
}

/** Every in-bounds neighbour of a cell, diagonals included. */
function around(world: World, x: number, y: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}

describe('the lake', () => {
  it('fills a real basin on every seed, not a puddle', () => {
    const sizes = SEEDS.map((seed) => waterCells(createWorld(seed)).length);
    for (let i = 0; i < SEEDS.length; i++) {
      expect(sizes[i], `seed ${SEEDS[i]} came out dry`).toBeGreaterThanOrEqual(45);
    }
    // And it stays a feature of the valley rather than becoming the valley.
    // Written as a share of the ground rather than a cell count, because the
    // count is a fact about the map size and this assertion is not: 400 was two
    // and a half percent of the 128 map and became a bound the 192 map broke
    // just by being bigger, with nothing about the lake having changed.
    const ceiling = MAP_W * MAP_H * 0.025;
    for (let i = 0; i < SEEDS.length; i++) {
      expect(sizes[i], `seed ${SEEDS[i]} flooded the map`).toBeLessThan(ceiling);
    }
  });

  it('never floods the yard the colony wakes up in', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      for (let y = HOME_Y - 9; y <= HOME_Y + 9; y++) {
        for (let x = HOME_X - 9; x <= HOME_X + 9; x++) {
          expect(terrainAt(world, x, y), `seed ${seed} put water at ${x},${y}`).not.toBe('water');
        }
      }
    }
  });

  it('keeps a cell of dry ground between the water and every rock', () => {
    // This one is not cosmetic. `WATER_SINK` in the terrain view drops a lake-bed
    // corner far below what `ROCK_SINK` buries a boulder by, so a cliff standing
    // on a corner shared with open water would show daylight underneath it. The
    // generator's margin is what makes that corner impossible, and the renderer
    // is allowed to assume it because of this test.
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      for (const cell of waterCells(world)) {
        const x = cell % world.width;
        const y = (cell - x) / world.width;
        for (const n of around(world, x, y)) {
          expect(terrainAt(world, n.x, n.y), `seed ${seed}: rock touches water at ${x},${y}`).not.toBe(
            'rock',
          );
        }
      }
    }
  });

  it('lays a beach all the way round', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      for (const cell of waterCells(world)) {
        const x = cell % world.width;
        const y = (cell - x) / world.width;
        for (const n of around(world, x, y)) {
          const t = terrainAt(world, n.x, n.y);
          if (t === 'water') continue;
          expect(t, `seed ${seed}: bare ${t} at the water's edge ${n.x},${n.y}`).toBe('sand');
        }
      }
    }
  });

  it('strands nothing the colony has to reach', () => {
    // The generator drains a lake that costs the colony anything, so the claim
    // worth checking here is the one the player would feel: every place worth
    // walking to is still walkable to. Sites are the long trips, and rock is the
    // steel every build order in the game is eventually waiting on.
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      for (const site of world.sites) {
        const path = findPath(world, HOME_X, HOME_Y, site.x, site.y, { maxExpansions: 40000 });
        expect(path, `seed ${seed}: site at ${site.x},${site.y} is cut off`).not.toBeNull();
      }
      let minable = 0;
      for (let y = 1; y < world.height - 1 && minable === 0; y++) {
        for (let x = 1; x < world.width - 1 && minable === 0; x++) {
          if (terrainAt(world, x, y) !== 'rock') continue;
          const standing = around(world, x, y).find((n) => isWalkable(world, n.x, n.y));
          if (!standing) continue;
          if (findPath(world, HOME_X, HOME_Y, standing.x, standing.y, { maxExpansions: 40000 })) minable++;
        }
      }
      expect(minable, `seed ${seed}: no rock the colony can walk to and swing at`).toBeGreaterThan(0);
    }
  });

  it('is water the colony cannot walk into', () => {
    const world = createWorld(3);
    for (const cell of waterCells(world)) {
      const x = cell % world.width;
      const y = (cell - x) / world.width;
      expect(isWalkable(world, x, y), `walked into the lake at ${x},${y}`).toBe(false);
    }
  });
});

describe('the lake has a bottom', () => {
  function groundOf(view: TerrainView): THREE.Mesh {
    const mesh = view.group.children.find(
      (c) => (c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh,
    );
    return mesh as THREE.Mesh;
  }

  function heightsOf(view: TerrainView): Float32Array {
    const attr = groundOf(view).geometry.getAttribute('position') as THREE.BufferAttribute;
    return attr.array as Float32Array;
  }

  function cellHeights(world: World, pos: Float32Array, x: number, y: number): number[] {
    const base = packCell(world, x, y) * 18;
    return [0, 3, 6, 9, 12, 15].map((o) => pos[base + o + 1]!);
  }

  it('sinks open water below the bank and leaves the bank between', () => {
    const world = createWorld(3);
    const view = new TerrainView(world);
    view.sync(world);
    const pos = heightsOf(view);

    // An interior water cell — one whose eight neighbours are all water — sits at
    // the bottom of the bowl on all four corners, which is what makes the middle
    // of the lake flat instead of dished.
    let interior: { x: number; y: number } | null = null;
    for (const cell of waterCells(world)) {
      const x = cell % world.width;
      const y = (cell - x) / world.width;
      if (around(world, x, y).every((n) => terrainAt(world, n.x, n.y) === 'water')) {
        interior = { x, y };
        break;
      }
    }
    expect(interior, 'seed 3 has no water cell away from its own shore').not.toBeNull();
    const deep = cellHeights(world, pos, interior!.x, interior!.y);
    expect(Math.min(...deep)).toBeCloseTo(Math.max(...deep), 5);
    expect(Math.max(...deep), 'open water is not below the bank').toBeLessThan(-0.3);

    // And the beach beside the lake is above the water and below the dry ground,
    // so there is a bank to walk down rather than a step to fall off.
    const shore = waterCells(world)
      .map((cell) => {
        const x = cell % world.width;
        const y = (cell - x) / world.width;
        return around(world, x, y).find((n) => terrainAt(world, n.x, n.y) === 'sand');
      })
      .find(Boolean)!;
    const bank = cellHeights(world, pos, shore.x, shore.y);
    expect(Math.min(...bank), 'the beach is not sloping into the water').toBeLessThan(0);
    expect(Math.max(...bank), 'the beach is under the lake').toBeGreaterThan(Math.max(...deep));
  });

  it('never opens a crack between the bank and the ground beside it', () => {
    // Same guarantee the snow lift has to hold, for the same reason: neighbouring
    // cells are separate triangles that only stay welded because they read the
    // same corner. A lake is a much bigger height change than snow, so this is
    // where it would show.
    const world = createWorld(3);
    const view = new TerrainView(world);
    view.sync(world);
    const pos = heightsOf(view);

    const seen = new Map<string, number>();
    let checked = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const key = `${pos[i]!.toFixed(3)},${pos[i + 2]!.toFixed(3)}`;
      const y = pos[i + 1]!;
      const had = seen.get(key);
      if (had === undefined) seen.set(key, y);
      else expect(y, `two heights at ${key}`).toBeCloseTo(had, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(world.width * world.height);
  });
});
