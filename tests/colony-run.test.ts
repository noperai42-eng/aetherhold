/**
 * Experience tests: the colony as a player experiences it, driven only through
 * the same order functions the UI calls. No mocks — real pathfinding, real jobs,
 * real combat, thousands of real ticks.
 *
 * These are the tests that would fail if any of it were decoration.
 */

import { describe, expect, it } from 'vitest';

import { CROP_NONE, growingCells } from '../src/sim/farming';
import { MEALS_PER_BATCH, MEAL_RAWFOOD_COST, blueprintReady } from '../src/sim/jobs';
import { countResource, findBuilding, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import { describeTarget, interact } from '../src/sim/interact';
import { forceThreat, igniteFire } from '../src/sim/events';
import { hostiles } from '../src/sim/world';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { orderMove, placeBlueprint, possess, releasePossession, setDrafted } from '../src/sim/orders';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { World } from '../src/sim/types';
import type { Streams } from '../src/sim/tick';

function game(seed = 4242) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

/** Step until `pred` holds, or fail after `limit` ticks. Returns ticks taken. */
function runUntil(world: World, streams: Streams, limit: number, pred: () => boolean): number {
  for (let i = 0; i < limit; i++) {
    if (pred()) return i;
    stepWorld(world, streams);
  }
  return pred() ? limit : -1;
}

describe('three days in the colony, unattended', () => {
  const { world, streams } = game();
  const startRaw = countResource(world, 'rawfood');
  const startMeals = countResource(world, 'meal');
  const looseAtStart = world.items.filter((s) => s.x === 24 && s.y === 39).length;
  let sleptInBed = false;
  let ateSomething = false;
  let workedAJob = false;

  // One long run, observed as it goes — the assertions below all read from it.
  // Three days, not two: the storyteller's opening quiet is 2.5 days (events.ts),
  // and a run that stops before the first beat never proves the colony survives one.
  for (let t = 0; t < TICKS_PER_DAY * 3; t++) {
    stepWorld(world, streams);
    for (const p of livingColonists(world)) {
      if (p.activity === 'sleeping') {
        const bed = world.buildings.find((b) => b.kind === 'bed' && b.occupant === p.id);
        if (bed) sleptInBed = true;
      }
      if (p.activity === 'eating') ateSomething = true;
      if (p.jobId !== null) workedAJob = true;
    }
  }

  it('keeps its settlers alive without a single player order', () => {
    expect(world.gameOver).toBe(false);
    expect(livingColonists(world).length).toBeGreaterThanOrEqual(1);
  });

  it('settlers feed themselves', () => {
    expect(ateSomething).toBe(true);
    for (const p of livingColonists(world)) {
      // Nobody should still be starving after three days with food on the map.
      expect(p.needs.food).toBeGreaterThan(0.05);
    }
  });

  it('settlers sleep in real beds', () => {
    expect(sleptInBed).toBe(true);
  });

  it('settlers cook, turning raw food into meals', () => {
    expect(world.stats.mealsCooked).toBeGreaterThan(0);
  });

  it('settlers haul loose resources into the stockpile', () => {
    expect(workedAJob).toBe(true);
    const stillLoose = world.items.filter((s) => s.x === 24 && s.y === 39).length;
    expect(stillLoose).toBeLessThan(looseAtStart + 1);
    const stock = world.zones.find((z) => z.kind === 'stockpile')!;
    const inStock = world.items.filter((s) => stock.cells.includes(s.y * world.width + s.x));
    expect(inStock.length).toBeGreaterThan(0);
  });

  it('the storyteller fires a threat beat and the colony is still standing', () => {
    expect(world.storyteller.threatsFired).toBeGreaterThan(0);
    expect(world.messages.some((m) => m.kind === 'threat')).toBe(true);
  });

  it('never leaks jobs, and no settler is stuck holding a phantom item', () => {
    for (const j of world.jobs) {
      const owner = world.pawns.find((p) => p.id === j.pawnId);
      expect(owner).toBeDefined();
      // Every job is either the one in their hands or the one lined up behind it
      // on their control stack. A job that is neither is a leak: it holds its
      // reservations for ever and nothing will ever tick it.
      expect(owner!.jobId === j.id || (owner!.queue ?? []).includes(j.id)).toBe(true);
    }
    for (const p of world.pawns) {
      if (p.carryingItemId === null) continue;
      const it = world.items.find((s) => s.id === p.carryingItemId);
      expect(it).toBeDefined();
      expect(it!.carriedBy).toBe(p.id);
    }
    for (const s of world.items) {
      if (s.carriedBy === null) continue;
      expect(world.pawns.find((p) => p.id === s.carriedBy)!.carryingItemId).toBe(s.id);
    }
  });

  it('consumed resources rather than conjuring them', () => {
    // Raw food is renewable now (farming.ts), so the pantry can end a run fuller
    // than it started. The ledger is what has to balance: everything that puts
    // raw food into the world counts itself into `rawGathered`, and cooking is
    // the one thing that takes it away in a known quantity, so the pantry can
    // never end above what was landed with plus what was grown, shot or bought,
    // less what went into the pot. Anything higher is food from nowhere.
    expect(world.stats.mealsCooked).toBeGreaterThan(0);
    expect(countResource(world, 'meal')).toBeLessThan(startMeals + world.stats.mealsCooked);
    const gathered = world.stats.rawGathered ?? 0;
    expect(gathered).toBeGreaterThan(0);
    const eatenByTheStove = (world.stats.mealsCooked / MEALS_PER_BATCH) * MEAL_RAWFOOD_COST;
    expect(countResource(world, 'rawfood')).toBeLessThanOrEqual(startRaw + gathered - eatenByTheStove);
    const zoned = new Set(growingCells(world));
    for (let i = 0; i < world.crops.length; i++) {
      if ((world.crops[i] ?? CROP_NONE) >= 0) expect(zoned.has(i)).toBe(true);
    }
  });
});

describe('acceptance 3: place a wall blueprint and a settler builds it', () => {
  it('goes from designation to finished wall on its own', () => {
    const { world, streams } = game(99);
    const x = 30;
    const y = 24; // just outside the cabin's north wall, inside the cleared yard
    expect(placeBlueprint(world, 'wall', x, y)).toBe(true);
    const bp = world.buildings.find((b) => b.x === x && b.y === y)!;
    const woodBefore = countResource(world, 'wood');

    // A settler picks the job up promptly.
    const claimed = runUntil(world, streams, 400, () =>
      world.jobs.some((j) => j.buildingId === bp.id),
    );
    expect(claimed).toBeGreaterThanOrEqual(0);

    // Materials arrive, then it gets built.
    const ready = runUntil(world, streams, 2500, () => blueprintReady(bp));
    expect(ready).toBeGreaterThanOrEqual(0);
    const done = runUntil(world, streams, 2500, () => (findBuilding(world, bp.id)?.built ?? false));
    expect(done).toBeGreaterThanOrEqual(0);

    expect(world.stats.built).toBeGreaterThan(0);
    expect(countResource(world, 'wood')).toBeLessThan(woodBefore);
  });
});

describe('acceptance 4+5: the first-person body acts, the manager sees it', () => {
  it('E on a bed makes the possessed settler actually sleep in it', () => {
    const { world, streams } = game(7);
    const p = livingColonists(world)[0]!;
    possess(world, p.id);
    p.needs.rest = 0.2;

    const bed = world.buildings.find((b) => b.kind === 'bed' && b.occupant === null)!;
    p.x = bed.x;
    p.y = bed.y + 1;
    p.facing = -Math.PI / 2;

    const prompt = describeTarget(world, p);
    expect(prompt).not.toBeNull();
    expect(prompt!.verb).toBe('Sleep');

    expect(interact(world, p)).toBe('Lying down.');
    // The interaction produced a real job on the real pawn — not a private FPS state.
    expect(p.jobId).not.toBeNull();
    expect(world.jobs.find((j) => j.id === p.jobId)!.kind).toBe('sleep');

    const restBefore = p.needs.rest;
    const asleep = runUntil(world, streams, 400, () => p.activity === 'sleeping');
    expect(asleep).toBeGreaterThanOrEqual(0);
    stepWorldN(world, streams, 300);

    // The manager view reads exactly this state: same bed, same occupant, more rest.
    expect(findBuilding(world, bed.id)!.occupant).toBe(p.id);
    expect(p.needs.rest).toBeGreaterThan(restBefore);
  });

  it('E on a food stack feeds the possessed settler', () => {
    const { world, streams } = game(8);
    const p = livingColonists(world)[1]!;
    possess(world, p.id);
    p.needs.food = 0.2;
    const meal = world.items.find((s) => s.kind === 'meal' && s.carriedBy === null)!;
    p.x = meal.x + 1;
    p.y = meal.y;
    p.facing = Math.PI;

    const t = describeTarget(world, p);
    expect(t).not.toBeNull();
    expect(t!.verb).toContain('Eat');
    expect(interact(world, p)).toContain('Eating');

    const foodBefore = p.needs.food;
    const fed = runUntil(world, streams, 900, () => p.needs.food > foodBefore + 0.2);
    expect(fed).toBeGreaterThanOrEqual(0);
  });

  it('picking up a stack by hand carries it, and dropping it puts it back on the ground', () => {
    const { world } = game(11);
    const p = livingColonists(world)[0]!;
    possess(world, p.id);
    const pile = world.items.find((s) => s.kind === 'wood' && s.carriedBy === null)!;
    p.x = pile.x;
    p.y = pile.y;

    expect(interact(world, p)).toContain('Picked up');
    expect(p.carryingItemId).toBe(pile.id);
    expect(pile.carriedBy).toBe(p.id);

    p.x = pile.x + 3;
    expect(describeTarget(world, p)!.verb).toBe('Drop wood');
    expect(interact(world, p)).toContain('Dropped');
    expect(p.carryingItemId).toBeNull();
    expect(pile.carriedBy).toBeNull();
    expect(pile.x).toBe(Math.round(p.x));
  });

  it('releasing possession hands the body back to the AI, which resumes working', () => {
    const { world, streams } = game(12);
    const p = livingColonists(world)[2]!;
    possess(world, p.id);
    stepWorldN(world, streams, 60);
    releasePossession(world);
    expect(p.playerControlled).toBe(false);
    const busy = runUntil(world, streams, 600, () => p.jobId !== null || p.activity === 'sleeping');
    expect(busy).toBeGreaterThanOrEqual(0);
  });

  it('possession never leaves two bodies under player control', () => {
    const { world } = game(13);
    const cs = livingColonists(world);
    possess(world, cs[0]!.id);
    possess(world, cs[1]!.id);
    possess(world, cs[2]!.id);
    expect(world.pawns.filter((q) => q.playerControlled).length).toBe(1);
  });
});

describe('acceptance 7: a threat beat is playable', () => {
  it('a raid arrives, drafted settlers fight, and it resolves one way or the other', () => {
    const { world, streams } = game(31);
    forceThreat(world, streams.story, 'raid');
    expect(hostiles(world).length).toBeGreaterThan(0);

    for (const p of livingColonists(world)) {
      setDrafted(world, p.id, true);
      orderMove(world, p.id, 31, 33);
    }

    const resolved = runUntil(
      world,
      streams,
      TICKS_PER_DAY,
      () => hostiles(world).length === 0 || world.gameOver,
    );
    expect(resolved).toBeGreaterThanOrEqual(0);
    // Shots were actually exchanged, not just proximity theatre. A raid resolves
    // when nobody hostile is left standing, and since nobody finishes off the
    // fallen any more (combat.ts), the bodies on the ground are the evidence —
    // the kill count only catches up when they bleed out a minute later.
    const downedRaiders = world.pawns.filter((p) => p.faction !== 'colony' && (p.dead || p.downed));
    expect(downedRaiders.length + world.stats.colonistsLost).toBeGreaterThan(0);
    // Projectiles all resolved — none left orbiting forever.
    stepWorldN(world, streams, 120);
    expect(world.projectiles.length).toBe(0);
  });

  it('a fire spreads, hurts, and gets put out by firefighters', () => {
    const { world, streams } = game(32);
    const target = world.buildings.find((b) => b.kind === 'table' && b.built)!;
    igniteFire(world, target.x, target.y);
    expect(world.fires.length).toBe(1);
    const out = runUntil(world, streams, TICKS_PER_DAY, () => world.fires.length === 0);
    expect(out).toBeGreaterThanOrEqual(0);
    expect(world.gameOver).toBe(false);
  });

  it('losing every settler ends the game with a message, not a silent freeze', () => {
    const { world, streams } = game(33);
    for (const p of world.pawns) {
      if (p.faction === 'colony') {
        p.dead = true;
        p.downed = false;
      }
    }
    stepWorld(world, streams);
    expect(world.gameOver).toBe(true);
    expect(world.messages.some((m) => m.kind === 'bad')).toBe(true);
  });
});

describe('the sim stays cheap enough for 20 Hz', () => {
  it('simulates a day far faster than that day takes to play', () => {
    const { world, streams } = game(55);
    const t0 = performance.now();
    stepWorldN(world, streams, TICKS_PER_DAY);
    const ms = performance.now() - t0;
    // 4800 ticks = 240 s of game time. The real budget is 50 ms per tick.
    expect(ms).toBeLessThan(4800 * 50);
    // And the tripwire, which is stated as a *ratio to real time* rather than a
    // raw millisecond count — that is the scar. It used to read `< 2` ms/tick,
    // which was true and stayed true right up until it wasn't measuring the sim
    // any more. This box is an Apple M5: four performance cores and six
    // efficiency ones. Vitest runs `availableParallelism() - 1` files at once, so
    // nine or ten forks go out to ten cores and at least five of them land on an
    // efficiency core, where the same work takes three to four times as long. Run
    // on its own this loop measures 1.05 ms/tick — profiled, not guessed. Run
    // beside the rest of the suite the identical code measures 2.8, and the
    // assertion went red without a line of the sim having changed. A number that
    // reports which core the OS handed you is not a number about the simulation.
    //
    // So the claim is the one that actually matters to a player: a day of game
    // time must cost less than a quarter of the wall clock that day would take to
    // live through. Clean that is 5 s against 240 s — about 48× real time; even
    // starved on an efficiency core it is 13 s, still 18×. The alarm fires below
    // 4×, which is where 20 Hz starts to be in genuine danger on a weaker
    // machine than this one, and no scheduler decision can drag it there.
    expect(ms / 4800).toBeLessThan(12.5);
  });
});
