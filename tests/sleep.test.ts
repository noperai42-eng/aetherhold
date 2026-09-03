/**
 * Nobody sleeps through starving to death.
 *
 * Measured, not imagined. `scripts/probe-upright.ts` on harsh/424242 put the
 * whole of the grid's on-their-feet starvation column — 102.1 h — under one
 * reason, `is asleep`, with free food standing reachable the entire time.
 * `scripts/probe-sleep.ts` then named it exactly: three spells of sleeping rough,
 * 197.5 h between them, **100 % of it lying on a bed**, rest frozen at 0.00 →
 * 0.00 across five days. One settler was still asleep when the run ended.
 *
 * A settler in a bed is in a `sleep` *job*, which ticks their rest and gets them
 * up for a raid or an empty stomach. `tryNeedJob` also lets a settler drop where
 * they stand when they are past `rest < 0.12` and every bunk is taken — no job,
 * just `activity = 'sleeping'` — and that case is ticked by `tickGroundSleep`.
 * It used to hand anybody lying on a bed cell back to "the sleep job", which at
 * that call site does not exist: `tick.ts` only reaches it with `jobId === null`.
 * So a settler who collapsed onto an occupied bunk had their rest ticked by
 * nothing, never reached `0.9`, and was never looked at by the need pass either,
 * because `tick.ts` sends a sleeper straight there and `continue`s.
 *
 * First block is the waking rules one assertion at a time, so a failure names
 * which one moved. The last is the measured shape of the failure running inside
 * `stepWorld` with nobody touching it: asleep on a bunk, no food in them, a meal
 * on the ground — and they wake up and eat it.
 */

import { describe, expect, it } from 'vitest';

import { tickGroundSleep } from '../src/sim/jobs';
import { buildingAt } from '../src/sim/grid';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { addBuilding, addItem } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { terrainAt, type Pawn, type World } from '../src/sim/types';
import { createWorld, makePawn } from '../src/sim/worldgen';

/**
 * A stream for the exposure roll. Fixed, because these tests are about rest and
 * a settler catching the flu mid-assertion would make them about the weather.
 */
function sleepRng(): Rng {
  return new Rng(99);
}

/** A world with nobody in it and nothing lying about — see `tests/feeding.test.ts`. */
function empty(seed = 1337): { world: World; streams: ReturnType<typeof makeStreams> } {
  const world = createWorld(seed);
  const streams = makeStreams(world);
  world.pawns.length = 0;
  world.jobs.length = 0;
  world.items.length = 0;
  return { world, streams };
}

/** Open ground, three cells clear every way, well away from the cabin. */
function clearing(world: World, from = 8): { x: number; y: number } {
  for (let y = from; y < world.height - 8; y++) {
    for (let x = from; x < world.width - 8; x++) {
      let clear = true;
      for (let dy = -3; dy <= 3 && clear; dy++) {
        for (let dx = -3; dx <= 3 && clear; dx++) {
          if (buildingAt(world, x + dx, y + dy)) clear = false;
          else if (terrainAt(world, x + dx, y + dy) === 'rock') clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no clearing on this map');
}

/**
 * Asleep where they stand, with no job — what `tryNeedJob` leaves behind when
 * there is nowhere to lie down.
 */
function sleepingRough(world: World, x: number, y: number, rest: number, food = 0.9): Pawn {
  const p = makePawn(world, new Rng(7 + world.pawns.length), 'colony', x, y);
  p.x = x;
  p.y = y;
  p.jobId = null;
  p.path = null;
  p.activity = 'sleeping';
  p.needs.rest = rest;
  p.needs.food = food;
  return p;
}

describe('a settler asleep with no job', () => {
  it('is still resting when they dropped onto a bed', () => {
    // The measured case, and the reason the bed check is gone: this settler was
    // ticked by nothing at all, because the guard handed them to a job that does
    // not exist at this call site.
    const { world } = empty();
    const spot = clearing(world);
    addBuilding(world, 'bed', spot.x, spot.y, true);
    const p = sleepingRough(world, spot.x, spot.y, 0.0);

    tickGroundSleep(world, p, sleepRng());

    expect(p.needs.rest, 'rest stood still on the bunk').toBeGreaterThan(0);
  });

  it('rests on bare ground the same as on a bunk', () => {
    const { world } = empty();
    const spot = clearing(world);
    const onBed = sleepingRough(world, spot.x, spot.y, 0.0);
    addBuilding(world, 'bed', spot.x, spot.y, true);
    const onGround = sleepingRough(world, spot.x + 2, spot.y, 0.0);

    tickGroundSleep(world, onBed, sleepRng());
    tickGroundSleep(world, onGround, sleepRng());

    expect(onBed.needs.rest).toBe(onGround.needs.rest);
  });

  it('wakes when they have slept enough', () => {
    const { world } = empty();
    const spot = clearing(world);
    const p = sleepingRough(world, spot.x, spot.y, 0.9);

    tickGroundSleep(world, p, sleepRng());

    expect(p.activity).toBe('idle');
  });

  it('wakes on an empty stomach once they can walk to the pantry', () => {
    const { world } = empty();
    const spot = clearing(world);
    const p = sleepingRough(world, spot.x, spot.y, 0.6, 0.0);

    tickGroundSleep(world, p, sleepRng());

    expect(p.activity).toBe('idle');
  });

  it('stays down when they are hungry and have nothing left to walk on', () => {
    // The `rest > 0.5` half of the rule. Waking somebody at zero rest sends them
    // straight back down, and a settler yo-yoing between the bunk and the pantry
    // gets neither.
    const { world } = empty();
    const spot = clearing(world);
    const p = sleepingRough(world, spot.x, spot.y, 0.2, 0.0);

    tickGroundSleep(world, p, sleepRng());

    expect(p.activity).toBe('sleeping');
  });

  it('is left to sleep when they are merely peckish', () => {
    const { world } = empty();
    const spot = clearing(world);
    const p = sleepingRough(world, spot.x, spot.y, 0.6, 0.5);

    tickGroundSleep(world, p, sleepRng());

    expect(p.activity).toBe('sleeping');
  });

  it('takes the mood hit for a rough night once, on waking', () => {
    const { world } = empty();
    const spot = clearing(world);
    const p = sleepingRough(world, spot.x, spot.y, 0.2, 0.0);
    const before = p.mood;

    tickGroundSleep(world, p, sleepRng()); // too spent to get up yet — no wake, no charge
    const asleep = p.mood;
    p.needs.rest = 0.6;
    tickGroundSleep(world, p, sleepRng());

    expect(asleep, 'charged while they were still asleep').toBe(before);
    expect(p.mood, 'a rough night cost them nothing').toBeLessThan(before);
  });
});

describe('the colony left to run itself', () => {
  it('does not leave a settler starving asleep on somebody else’s bunk', () => {
    const { world, streams } = empty();
    const spot = clearing(world);
    // The measured shape: collapsed onto a bunk with nothing in the tank, which
    // used to freeze their rest and hide them from the need pass for good.
    addBuilding(world, 'bed', spot.x, spot.y, true);
    const p = sleepingRough(world, spot.x, spot.y, 0.0, 0.0);
    addItem(world, 'meal', 20, spot.x + 2, spot.y);

    // Long enough to rest up to the point they can walk, get up, and cross two
    // cells — and far short of the five days they used to lie there.
    stepWorldN(world, streams, 2400);

    expect(p.activity, 'still asleep half a day later').not.toBe('sleeping');
    expect(p.needs.food, 'woke up and still did not eat').toBeGreaterThan(0.1);
  });
});
