/**
 * Moving in, rather than building a second bed.
 *
 * A colony starts with every bunk in the main building, which is the right way
 * to start: a roof is what keeps people alive, and eight beds under one is a
 * colony that has solved that problem. What it has not got is anywhere to live,
 * and the answer when the first room goes up is not to fell twenty more planks.
 * The bed already exists. Somebody picks it up and carries it next door.
 *
 * The functional half pins the three rules that make that safe — a bunk with
 * two neighbours may go, a bunk alone in a room may not, and nobody is moved out
 * from under a sleeper — plus the one deliberate lie in the implementation: the
 * bed is never off the map, so an interrupted errand cannot lose it. The
 * experience half runs the colony and watches a settler do it unprompted.
 */

import { describe, expect, it } from 'vitest';

import { makeStreams, stepWorldN } from '../src/sim/tick';
import { addBuilding, addItem, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import { roomAt } from '../src/sim/rooms';
import { bedlessTarget, emptyQuarters, sharedBunks } from '../src/sim/quarters';
import { heart } from '../src/sim/steward';
import { planBunkhouse } from '../src/sim/annex';
import { buildingAt } from '../src/sim/grid';
import type { World } from '../src/sim/types';

function world(): World {
  return createWorld(4242);
}

/** Wall in one bunkhouse room off the cabin and hand back the room it made. */
function addRoom(w: World): { x: number; y: number } {
  const plan = planBunkhouse(w, [heart(w)!]);
  if (!plan) throw new Error('nowhere to put a room on this map');
  for (const c of plan.walls) if (!buildingAt(w, c.x, c.y)) addBuilding(w, 'wall', c.x, c.y, true);
  if (!buildingAt(w, plan.door.x, plan.door.y)) addBuilding(w, 'door', plan.door.x, plan.door.y, true);
  const spot = plan.floor[0]!;
  if (!roomAt(w, spot.x, spot.y)) throw new Error('the shell did not enclose');
  return spot;
}

describe('which bunk may be carried (functional)', () => {
  it('counts a bunk with a neighbour as spare', () => {
    const w = world();
    // The hall already has the colony's beds in it; that is the shared room.
    expect(sharedBunks(w).length, 'the starting cabin has no shared bunks').toBeGreaterThan(1);
  });

  it('leaves a bunk that is alone in a room where it is', () => {
    // The one rule this module has, read backwards: a bed alone in a room is
    // already somebody's bedroom, and carrying it off is evicting them.
    const w = world();
    const spot = addRoom(w);
    addBuilding(w, 'bed', spot.x, spot.y, true);
    const bunk = buildingAt(w, spot.x, spot.y)!;
    expect(sharedBunks(w).some((b) => b.id === bunk.id)).toBe(false);
  });

  it('offers an empty room as somewhere a bed could go', () => {
    const w = world();
    const spot = addRoom(w);
    const room = roomAt(w, spot.x, spot.y)!;
    const offered = emptyQuarters(w).filter((c) => roomAt(w, c.x, c.y)?.id === room.id);
    expect(offered).toHaveLength(1);
    expect(bedlessTarget(w, offered[0]!.x, offered[0]!.y)).toBe(true);
  });

  it('stops offering it the moment it has a bed', () => {
    const w = world();
    const spot = addRoom(w);
    const room = roomAt(w, spot.x, spot.y)!;
    addBuilding(w, 'bed', spot.x, spot.y, true);
    expect(emptyQuarters(w).filter((c) => roomAt(w, c.x, c.y)?.id === room.id)).toHaveLength(0);
    expect(bedlessTarget(w, spot.x, spot.y)).toBe(false);
  });

  it('will not send a settler to a cell that stopped being a room', () => {
    // The re-check on arrival. A room can be given a bed by somebody else, or
    // walled in, or opened up, while a bunk is being carried across the yard.
    const w = world();
    const h = heart(w)!;
    const c = h.cells[0]!;
    const x = c % w.width;
    const y = (c - x) / w.width;
    // The hall is far too big to be anybody's quarters.
    expect(bedlessTarget(w, x, y)).toBe(false);
  });
});

describe('the colony left to run itself (experience)', () => {
  it('moves a bunk into a room it has finished rather than building a second one', () => {
    const w = world();
    const streams = makeStreams(w);
    const home = livingColonists(w)[0]!;
    addItem(w, 'wood', 400, Math.round(home.x) + 3, Math.round(home.y));
    const before = w.buildings.filter((b) => b.built && b.kind === 'bed').length;
    const spot = addRoom(w);

    // Long enough for somebody to notice the empty room, walk over, lift the
    // bunk and carry it. Short enough that the colony has not had time to fell
    // the timber for a new one.
    stepWorldN(w, streams, 2400 * 2);

    const bed = buildingAt(w, spot.x, spot.y);
    expect(bed?.kind, 'nobody moved in').toBe('bed');
    const after = w.buildings.filter((b) => b.built && b.kind === 'bed').length;
    expect(after, 'the colony built a bed instead of moving one').toBe(before);
  });
});
