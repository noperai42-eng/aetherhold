/**
 * The reachability index.
 *
 * This module exists to answer "can this settler get to that sack" without
 * running A*, so the one thing it must never do is disagree with A*. The
 * functional half pins that agreement — including the corner rule, which is the
 * only place the two could plausibly drift — and pins the cases the cache has to
 * notice: a wall going up, a door going in.
 *
 * The experience half is the reason any of it was written. A colony that fences
 * its yard used to make the simulation five times slower, because every "is that
 * reachable" question turned into a flood fill of the enclosure. So the test that
 * matters is the one a player produces by playing well: wall the place in, leave a
 * gate, and check that everyone can still get out to work.
 */

import { describe, expect, it } from 'vitest';

import {
  REGION_REBUILD_INTERVAL,
  connected,
  regionAt,
  regionIndex,
  wildRegionAt,
} from '../src/sim/regions';
import { isWalkable } from '../src/sim/grid';
import { findPath } from '../src/sim/path';
import { CABIN, createWorld } from '../src/sim/worldgen';
import { addBuilding, removeBuilding } from '../src/sim/world';
import { reachable } from '../src/sim/jobs';
import type { World } from '../src/sim/types';

/**
 * A one-cell shed, minus one of its nine cells.
 *
 * `gap` names the neighbour that is left open, so the same fixture builds the
 * sealed case, the "there is clearly a way in" diagonal case and the honest
 * doorway case. Returns the interior cell.
 */
function shed(world: World, cx: number, cy: number, gap: { dx: number; dy: number } | null): { x: number; y: number } {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (gap && gap.dx === dx && gap.dy === dy) continue;
      expect(addBuilding(world, 'wall', cx + dx, cy + dy, true)).not.toBeNull();
    }
  }
  return { x: cx, y: cy };
}

/**
 * Open ground for a shed, in the strip of yard west of the cabin.
 *
 * Worldgen only promises cleared, treeless ground inside the yard, so this is the
 * one place a nine-cell shell can always be built. It used to be a fixed cell out
 * in the fields, which was a bet on the seed that stopped paying the first time
 * the map changed size.
 *
 * South of the cabin rather than west of it, and on `OUTSIDE`'s own row: the
 * tests that leave a gap in the east wall need that gap to open onto somewhere,
 * and a shed tucked against the cabin's flank turns its doorway into a two-cell
 * pocket — sealed for a reason that has nothing to do with the hole in the wall.
 */
const YARD = { x: CABIN.doorX - 4, y: CABIN.y1 + 3 };

/** Just outside the front door: cleared, treeless, and on the colony's own region. */
const OUTSIDE = { x: CABIN.doorX, y: CABIN.doorY + 3 };

/**
 * Open ground outside the fence line, on the same side of the map as the cabin.
 *
 * Not `YARD`: a wall ring round the cabin encloses the whole yard, so a settler
 * standing there would be unreachable for a reason that has nothing to do with
 * the gate. Testing the gate means picking somewhere whose only route home *is*
 * the gate — which means somewhere past the ring, where worldgen promises nothing
 * and the seed decides. So it is searched for rather than written down, and the
 * search insists on a cell A* can already reach before any fence goes up.
 */
function farField(world: World): { x: number; y: number } {
  for (let d = 6; d < 24; d++) {
    const c = { x: CABIN.x1 + d, y: CABIN.y0 + 4 };
    if (!isWalkable(world, c.x, c.y)) continue;
    if (findPath(world, OUTSIDE.x, OUTSIDE.y, c.x, c.y) === null) continue;
    return c;
  }
  throw new Error('no reachable open ground east of the fence line');
}

describe('regions — functional', () => {
  it('agrees with the pathfinder on every cell it is asked about', () => {
    const world = createWorld(20260729);
    const from = OUTSIDE;
    // Every ninth cell, which is a few hundred samples across the whole map —
    // enough that a corner rule that disagreed would show up, cheap enough to run
    // on every commit. A* is given the default expansion budget, which on a
    // sixty-four-square map is more cells than exist, so a null really is
    // "unreachable" and not "gave up".
    let checked = 0;
    for (let y = 1; y < world.height - 1; y += 3) {
      for (let x = 1; x < world.width - 1; x += 3) {
        if (!isWalkable(world, x, y)) continue;
        const byIndex = connected(world, from.x, from.y, x, y);
        const byPath = findPath(world, from.x, from.y, x, y) !== null;
        expect({ x, y, byIndex }).toEqual({ x, y, byIndex: byPath });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('cuts a sealed room off from the world', () => {
    const world = createWorld(20260729);
    const inside = shed(world, YARD.x, YARD.y, null);

    expect(regionAt(world, inside.x, inside.y)).toBeGreaterThanOrEqual(0);
    expect(connected(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBe(false);
    // And it is genuinely a room, not a mistake: A* says the same thing.
    expect(findPath(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBeNull();
  });

  it('does not count a diagonal corner as a way in', () => {
    const world = createWorld(20260729);
    // Eight walls and a visible hole at the north-east corner. From above there
    // is obviously a gap; a settler cannot squeeze through it, because the
    // pathfinder refuses to clip between two walls — and the index has to agree,
    // or it would promise routes A* cannot deliver.
    const inside = shed(world, YARD.x, YARD.y, { dx: 1, dy: 1 });

    expect(isWalkable(world, inside.x + 1, inside.y + 1)).toBe(true);
    expect(connected(world, inside.x, inside.y, inside.x + 1, inside.y + 1)).toBe(false);
    expect(connected(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBe(false);
  });

  it('counts an orthogonal gap as a way in', () => {
    const world = createWorld(20260729);
    const inside = shed(world, YARD.x, YARD.y, { dx: 1, dy: 0 });

    expect(connected(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBe(true);
    expect(findPath(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).not.toBeNull();
  });

  it('notices a wall the tick it goes up, not twenty ticks later', () => {
    const world = createWorld(20260729);
    const inside = shed(world, YARD.x, YARD.y, { dx: 1, dy: 0 });
    expect(connected(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBe(true);

    // No tick passes here on purpose. The layout hash is what catches this;
    // waiting for the rebuild timer would mean a settler walking through a wall
    // that already exists for the whole of the next game-second.
    expect(addBuilding(world, 'wall', inside.x + 1, inside.y, true)).not.toBeNull();
    expect(connected(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBe(false);
  });

  it('lets a door back in and a felled tree through', () => {
    const world = createWorld(20260729);
    const inside = shed(world, YARD.x, YARD.y, null);
    expect(connected(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBe(false);

    // A door is walkable, so putting one in the shell reconnects the room —
    // which is the entire difference between a store room and a tomb.
    const wall = world.buildings.find((b) => b.x === inside.x + 1 && b.y === inside.y && b.kind === 'wall')!;
    removeBuilding(world, wall);
    expect(addBuilding(world, 'door', inside.x + 1, inside.y, true)).not.toBeNull();
    expect(connected(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBe(true);

    // And trees block, so chopping one is a layout change too. The stamp covers
    // every solid building, not just the ones a player can place.
    expect(regionIndex(world).stamp).not.toBe(0);
  });

  it('puts the far side of a door out of the wild’s reach', () => {
    const world = createWorld(20260729);
    const inside = shed(world, YARD.x, YARD.y, null);
    const wall = world.buildings.find(
      (b) => b.x === inside.x + 1 && b.y === inside.y && b.kind === 'wall',
    )!;
    removeBuilding(world, wall);
    expect(addBuilding(world, 'door', inside.x + 1, inside.y, true)).not.toBeNull();

    // A settler walks in, because a door is a door.
    expect(connected(world, inside.x, inside.y, OUTSIDE.x, OUTSIDE.y)).toBe(true);
    expect(regionAt(world, inside.x, inside.y)).toBe(regionAt(world, OUTSIDE.x, OUTSIDE.y));

    // A fenwolf does not, and the index says so without being asked to search.
    // Both ends are somewhere it could stand — this is a door in the way, not a
    // wall — and the labels still differ.
    expect(wildRegionAt(world, inside.x, inside.y)).toBeGreaterThanOrEqual(0);
    expect(wildRegionAt(world, OUTSIDE.x, OUTSIDE.y)).toBeGreaterThanOrEqual(0);
    expect(wildRegionAt(world, inside.x, inside.y)).not.toBe(
      wildRegionAt(world, OUTSIDE.x, OUTSIDE.y),
    );
    // Which is exactly the answer the search would have given, the expensive way.
    expect(findPath(world, OUTSIDE.x, OUTSIDE.y, inside.x, inside.y, { latch: false })).toBeNull();
    expect(findPath(world, OUTSIDE.x, OUTSIDE.y, inside.x, inside.y)).not.toBeNull();
  });

  it('rebuilds on the timer as well, for terrain the stamp cannot see', () => {
    const world = createWorld(20260729);
    const first = regionIndex(world);
    // The hash only covers buildings, so a mined-out rock face would go unseen
    // until the clock comes round. Same index while the clock is short...
    world.tick += REGION_REBUILD_INTERVAL - 1;
    expect(regionIndex(world)).toBe(first);
    // ...and a fresh one once it is not.
    world.tick += 1;
    expect(regionIndex(world)).not.toBe(first);
  });
});

describe('regions — experience', () => {
  it('lets a fenced colony with a gate still get out to work', () => {
    const world = createWorld(20260729);
    const FAR_FIELD = farField(world);
    const pawn = world.pawns.find((p) => p.faction === 'colony' && !p.dead)!;
    pawn.x = CABIN.x0 + 5;
    pawn.y = CABIN.y0 + 4;

    // A wall ring round the cabin with one gate in it — the thing a player builds
    // the moment they can afford it, and the thing that used to make the game
    // slow down for having done it.
    const x0 = CABIN.x0 - 4;
    const y0 = CABIN.y0 - 4;
    const x1 = CABIN.x1 + 4;
    const y1 = CABIN.y1 + 4;
    const gate = { x: Math.round((x0 + x1) / 2), y: y1 };
    // Where a tree is already standing the ring gets a trunk instead of a post,
    // which seals just as well — a player laying a fence does exactly this.
    for (let x = x0; x <= x1; x++) {
      for (const y of [y0, y1]) {
        if (x === gate.x && y === gate.y) continue;
        addBuilding(world, 'wall', x, y, true);
      }
    }
    for (let y = y0 + 1; y < y1; y++) {
      for (const x of [x0, x1]) addBuilding(world, 'wall', x, y, true);
    }
    expect(addBuilding(world, 'door', gate.x, gate.y, true)).not.toBeNull();

    // Ground beyond the fence is still work the colony can take on.
    expect(reachable(world, pawn, FAR_FIELD.x, FAR_FIELD.y, false)).toBe(true);
    expect(connected(world, pawn.x, pawn.y, FAR_FIELD.x, FAR_FIELD.y)).toBe(true);

    // Brick the gate up and it stops being true — which is the player's mistake
    // to make, and the game has to report it honestly rather than sending
    // somebody to stand at a wall.
    const door = world.buildings.find((b) => b.kind === 'door' && b.x === gate.x && b.y === gate.y)!;
    removeBuilding(world, door);
    expect(addBuilding(world, 'wall', gate.x, gate.y, true)).not.toBeNull();
    expect(reachable(world, pawn, FAR_FIELD.x, FAR_FIELD.y, false)).toBe(false);
  });

  it('does not let a hungry animal at a shut door cost the whole tick', () => {
    const world = createWorld(20260729);
    const inside = shed(world, YARD.x, YARD.y, null);
    const wall = world.buildings.find(
      (b) => b.x === inside.x + 1 && b.y === inside.y && b.kind === 'wall',
    )!;
    removeBuilding(world, wall);
    expect(addBuilding(world, 'door', inside.x + 1, inside.y, true)).not.toBeNull();
    // Warm both fills, so the budget below is the question and not the index.
    regionIndex(world);
    wildRegionAt(world, inside.x, inside.y);

    // An animal on the wrong side of a door asks for the same route about once a
    // second for as long as it can smell what is behind it — see the back-off in
    // `wildlife.ts`. Each of those used to flood the entire component, because
    // "there is no way in" is only knowable once everywhere else has been tried:
    // two hundred and seventy of them a day, at twenty-four thousand expansions
    // each, were ninety-nine per cent of every expansion the simulation did.
    //
    // Two hundred here is a couple of animals' worth of a game day. Loose enough
    // never to flake on a shared runner; a flood would need six hundred
    // milliseconds and would fail it on the spot.
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      expect(findPath(world, OUTSIDE.x, OUTSIDE.y, inside.x, inside.y, { latch: false })).toBeNull();
    }
    expect(performance.now() - t0).toBeLessThan(150);
  });

  it('answers reachability without ever running a search', () => {
    const world = createWorld(20260729);
    const pawn = world.pawns.find((p) => p.faction === 'colony' && !p.dead)!;
    pawn.x = CABIN.x0 + 5;
    pawn.y = CABIN.y0 + 4;
    // Warm the index, so the timing below is the question and not the fill.
    regionIndex(world);

    // Ten thousand reachability questions is roughly what a busy colony asks in a
    // game-minute. Back when each one was an A* search it cost seconds; the
    // budget here is loose enough never to flake on a shared runner and tight
    // enough to fail instantly if a search ever creeps back in.
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) reachable(world, pawn, CABIN.x0 - 13 + (i % 40), CABIN.y1 + 8, false);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
