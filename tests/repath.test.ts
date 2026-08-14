/**
 * A wall raised across a route somebody is already walking.
 *
 * `followPath` drops the path the moment the next cell stops being walkable, and
 * the line that drops it says what is supposed to happen next:
 *
 *     // A wall built across a live path invalidates it; re-path rather than tunnel.
 *
 * Dropping was the whole of it. `walkTo` lays a path once a tick and had already
 * laid this one, so it saw the drop as a missing path and returned `'blocked'` —
 * and every job site in `jobs.ts` reads `'blocked'` as `cancelJob`. The re-path
 * the comment promises had nowhere to happen. A settler four cells short of a
 * one-cell wall, on ground five cells deep, gave up the errand rather than
 * stepping round it.
 *
 * That is a nuisance for a woodpile and a death sentence for a meal. Walking sixty
 * harsh days a tick at a time and recording how each emergency feeding ended, the
 * residual bucket — carrier alive and upright, meal still in the world, patient
 * still on the floor and still starving — was the *usual* ending, not the rare
 * one: on seed 99001, 145 errands ended that way against 32 that reached a mouth.
 * The colony was not short of food or of hands. It kept putting the plate down.
 *
 * The functional half is the mechanism both ways round. A route with a detour has
 * to take the detour; a route with none has to still be given up, because
 * `'blocked'` is what thirty callers use to end a job that cannot be done, and a
 * job that can never be given up is worse than one given up too easily.
 *
 * The experience half is the errand that made it worth fixing: one settler on the
 * floor at zero food, one meal in somebody's hands, and a wall going up between
 * them.
 */

import { describe, expect, it } from 'vitest';

import { buildingAt } from '../src/sim/grid';
import { createJob } from '../src/sim/jobs';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { Rng } from '../src/sim/rng';
import { addBuilding, addItem } from '../src/sim/world';
import { terrainAt, unpackX, unpackY, type Pawn, type World } from '../src/sim/types';
import { createWorld, makePawn } from '../src/sim/worldgen';

interface Sim {
  world: World;
  streams: ReturnType<typeof makeStreams>;
}

/**
 * A world with nobody in it and nothing on the ground.
 *
 * The starting six walk their own errands across the same map, and a wall raised
 * on one settler's route is a wall on everybody's.
 */
function empty(seed = 1337): Sim {
  const world = createWorld(seed);
  const streams = makeStreams(world);
  world.pawns.length = 0;
  world.jobs.length = 0;
  world.items.length = 0;
  return { world, streams };
}

/**
 * A run of open ground `want` cells long with two clear cells either side of it.
 *
 * The depth is the point of the test rather than scenery: a wall dropped in the
 * middle of this leaves a detour two steps long, so a settler who gives up has
 * given up on a route that was plainly there.
 */
function corridor(world: World, want: number): { x: number; y: number } {
  for (let y = 10; y < world.height - 10; y++) {
    for (let x = 10; x < world.width - 10 - want; x++) {
      let clear = true;
      for (let dx = -1; dx <= want + 1 && clear; dx++) {
        for (let dy = -2; dy <= 2 && clear; dy++) {
          if (buildingAt(world, x + dx, y + dy)) clear = false;
          else if (terrainAt(world, x + dx, y + dy) === 'rock') clear = false;
          else if (terrainAt(world, x + dx, y + dy) === 'water') clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no corridor on this map');
}

/** A settler standing exactly here, fed, willing, and idle. */
function settler(world: World, x: number, y: number): Pawn {
  const p = makePawn(world, new Rng(7 + world.pawns.length), 'colony', x, y);
  p.x = x;
  p.y = y;
  p.jobId = null;
  p.path = null;
  p.activity = 'idle';
  p.needs.food = 0.9;
  p.priorities.doctor = 3;
  return p;
}

/**
 * On the floor and out of food. The bleed counter is load-bearing — the combat
 * pass stands a downed settler back up the moment they stop bleeding.
 */
function starving(p: Pawn): Pawn {
  p.downed = true;
  p.activity = 'downed';
  p.hp = p.maxHp * 0.5;
  p.bleed = 20 * 45;
  p.needs.food = 0;
  return p;
}

/** Step until `stop` says so. Returns the tick it happened on, or -1. */
function run(sim: Sim, limit: number, stop: () => boolean): number {
  for (let i = 0; i < limit; i++) {
    stepWorld(sim.world, sim.streams);
    if (stop()) return i + 1;
  }
  return -1;
}

/**
 * The cell `ahead` steps along this settler's live route.
 *
 * Read off `pawn.path` rather than guessed from the geometry, because a wall
 * beside the route is not a wall across it and that difference is the test.
 */
function onRoute(world: World, pawn: Pawn, ahead: number): { x: number; y: number } {
  const path = pawn.path;
  expect(path && path.length > 0).toBe(true);
  const packed = path![Math.min(ahead, path!.length - 1)]!;
  return { x: unpackX(world, packed), y: unpackY(world, packed) };
}

describe('a settler already walking', () => {
  it('steps round a wall raised across the route and finishes the errand', () => {
    const sim = empty();
    const home = corridor(sim.world, 18);
    const hauler = settler(sim.world, home.x, home.y);
    const wood = addItem(sim.world, 'wood', 20, home.x + 18, home.y)!;
    const job = createJob(sim.world, hauler, 'haulToStockpile', wood.x, wood.y, {
      itemId: wood.id,
    });

    // Let the route exist before building across it.
    expect(run(sim, 20, () => (hauler.path?.length ?? 0) > 4)).toBeGreaterThan(0);
    const cut = onRoute(sim.world, hauler, 3);
    expect(addBuilding(sim.world, 'wall', cut.x, cut.y, true)).not.toBeNull();

    // Long enough to walk the detour twice over, so a pass here is arrival and
    // not a job that merely has not been cancelled yet.
    const reached = run(sim, 400, () => hauler.carryingItemId !== null);
    expect(sim.world.jobs.some((j) => j.id === job.id)).toBe(true);
    expect(reached).toBeGreaterThan(0);
  });

  it('gives the errand up when the wall leaves no way round at all', () => {
    const sim = empty();
    const home = corridor(sim.world, 18);
    const hauler = settler(sim.world, home.x, home.y);
    const wood = addItem(sim.world, 'wood', 20, home.x + 18, home.y)!;
    const job = createJob(sim.world, hauler, 'haulToStockpile', wood.x, wood.y, {
      itemId: wood.id,
    });

    expect(run(sim, 20, () => (hauler.path?.length ?? 0) > 4)).toBeGreaterThan(0);
    // Wall the woodpile in on all eight sides. The pile is still standing on
    // ground a settler could stand on, so this is a routing question and not a
    // question about the target cell.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        addBuilding(sim.world, 'wall', wood.x + dx, wood.y + dy, true);
      }
    }

    const dropped = run(sim, 400, () => !sim.world.jobs.some((j) => j.id === job.id));
    expect(dropped).toBeGreaterThan(0);
    expect(hauler.carryingItemId).toBeNull();
  });
});

describe('a settler starving on the floor', () => {
  it('is still fed when a wall goes up between them and the meal', () => {
    const sim = empty();
    const home = corridor(sim.world, 20);
    // patient — carrier — meal, left to right, so the errand walks the row twice
    // and the wall lands on the leg that has the meal in hand.
    const patient = starving(settler(sim.world, home.x, home.y));
    const carrier = settler(sim.world, home.x + 8, home.y);
    addItem(sim.world, 'meal', 4, home.x + 20, home.y);

    const errand = (): number | null => {
      const j = sim.world.jobs.find(
        (k) => k.kind === 'feedPatient' && k.targetPawnId === patient.id,
      );
      return j ? j.id : null;
    };

    expect(run(sim, 200, () => errand() !== null)).toBeGreaterThan(0);
    expect(
      run(sim, 2000, () => {
        const j = sim.world.jobs.find((k) => k.id === errand());
        return !!j && j.stage === 'carry';
      }),
    ).toBeGreaterThan(0);
    const id = errand()!;
    // The pick-up tick leaves the path null; `walkTo` lays the carry route on the
    // next one.
    expect(run(sim, 20, () => (carrier.path?.length ?? 0) > 4)).toBeGreaterThan(0);

    const cut = onRoute(sim.world, carrier, 3);
    expect(addBuilding(sim.world, 'wall', cut.x, cut.y, true)).not.toBeNull();

    // The meal that was already in hand is the one that arrives. Watching only
    // for a fed patient would pass on the broken behaviour too: the errand is
    // cancelled, the meal lands on the floor at the carrier's feet, and the next
    // sweep picks it straight back up — a delivery, several hours late, that the
    // patient's food level alone cannot tell from this one.
    let dropped = false;
    const fed = run(sim, 400, () => {
      if (!sim.world.jobs.some((j) => j.id === id) && patient.needs.food <= 0.01) dropped = true;
      return patient.needs.food > 0.01;
    });
    expect(dropped).toBe(false);
    expect(fed).toBeGreaterThan(0);
  });
});
