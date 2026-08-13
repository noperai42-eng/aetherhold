/**
 * Somebody drops what they are doing and carries the meal over.
 *
 * The defect these assertions exist to stop was measured, not imagined. A probe
 * walked three harsh seeds a tick at a time and asked, on every tick where a
 * downed settler sat at zero food, why each other settler was not the one
 * carrying a meal. Seed 1312's 88.2 hours split four ways: 49.6 h with the whole
 * colony on the floor, 31.0 h with a meal already walking over, 0.3 h of
 * assignment cadence — and 7.2 h where every settler still on their feet was
 * mid-job. `assignJob` and `assignNeedsOnly` both return early on a settler who
 * already has a job, so from the floor a colony that is merely busy is
 * indistinguishable from one that is unconscious.
 *
 * The first block is the gate list, one assertion each, so a failure names which
 * gate moved. The last block is the whole thing running inside `stepWorld` with
 * nobody touching it: the measured shape of the failure, and the patient eats.
 */

import { describe, expect, it } from 'vitest';

import { buildingAt } from '../src/sim/grid';
import { createJob, sendSomebodyToFeed } from '../src/sim/jobs';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { addItem } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { terrainAt, type Job, type Pawn, type World } from '../src/sim/types';
import { createWorld, makePawn } from '../src/sim/worldgen';

/**
 * A world with nobody in it.
 *
 * The starting six have their own opinions about where to stand and what to
 * carry, and `sendSomebodyToFeed` picks the *nearest* eligible pair of hands —
 * so a test that leaves them in place is a test about where worldgen put them.
 */
function empty(seed = 1337): { world: World; streams: ReturnType<typeof makeStreams> } {
  const world = createWorld(seed);
  const streams = makeStreams(world);
  world.pawns.length = 0;
  world.jobs.length = 0;
  // The starting stores go too, so "the pantry is empty" is a thing a test can
  // say. Worldgen lands the colony with meals on the ground, and a test that
  // leaves them there is asserting against worldgen's larder.
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
 * On the floor and out of food.
 *
 * The bleed counter is load-bearing: the combat pass stands a downed pawn back
 * up the moment they have stopped bleeding and hold a third of their health, so
 * a patient who is only `downed = true` is on their feet again a tick later.
 */
function starving(p: Pawn): Pawn {
  p.downed = true;
  p.activity = 'downed';
  p.hp = p.maxHp * 0.5;
  p.bleed = 20 * 45;
  p.needs.food = 0;
  return p;
}

/** Put this settler in the middle of something. */
function busyWith(world: World, p: Pawn, kind: Job['kind'] = 'haulToStockpile'): Job {
  const job = createJob(world, p, kind, Math.round(p.x) + 1, Math.round(p.y));
  job.stage = 'work';
  return job;
}

function feedJobs(world: World): Job[] {
  return world.jobs.filter((j) => j.kind === 'feedPatient');
}

describe('a settler starving on the floor', () => {
  it('gets a meal even when the only hands in the colony are mid-job', () => {
    const { world } = empty();
    const spot = clearing(world);
    const patient = starving(settler(world, spot.x, spot.y));
    const worker = settler(world, spot.x + 2, spot.y);
    const job = busyWith(world, worker);
    addItem(world, 'meal', 5, spot.x + 1, spot.y);

    sendSomebodyToFeed(world);

    // The old job is gone and the new one is a meal for this patient. Both
    // halves matter: cancelling without assigning would be a settler who
    // stopped working for nothing.
    expect(world.jobs.some((j) => j.id === job.id)).toBe(false);
    const feeds = feedJobs(world);
    expect(feeds).toHaveLength(1);
    expect(feeds[0].targetPawnId).toBe(patient.id);
    expect(worker.jobId).toBe(feeds[0].id);
  });

  it('is left alone when a meal is already on the way', () => {
    const { world } = empty();
    const spot = clearing(world);
    const patient = starving(settler(world, spot.x, spot.y));
    const carrier = settler(world, spot.x + 2, spot.y);
    const spare = settler(world, spot.x + 3, spot.y);
    const carrying = createJob(world, carrier, 'feedPatient', spot.x, spot.y, {
      targetPawnId: patient.id,
    });
    const spareJob = busyWith(world, spare);
    addItem(world, 'meal', 5, spot.x + 1, spot.y);

    sendSomebodyToFeed(world);

    // One meal per patient. A second runner would be two settlers off the work
    // board for one lunch, and the first one gets there first anyway.
    expect(feedJobs(world).map((j) => j.id)).toEqual([carrying.id]);
    expect(spare.jobId).toBe(spareJob.id);
  });

  it('costs nobody their half-built wall when the pantry is empty', () => {
    const { world } = empty();
    const spot = clearing(world);
    starving(settler(world, spot.x, spot.y));
    const worker = settler(world, spot.x + 2, spot.y);
    const job = busyWith(world, worker);

    sendSomebodyToFeed(world);

    // An empty larder is a different failure and it should not also cost the
    // colony the work in progress. The order inside the function is the
    // assertion: food is looked for before anything is cancelled.
    expect(worker.jobId).toBe(job.id);
    expect(feedJobs(world)).toHaveLength(0);
  });

  it('does not pull anybody out of a fire, or off a march', () => {
    for (const kind of ['flee', 'rescue', 'caravan', 'campaign'] as const) {
      const { world } = empty();
      const spot = clearing(world);
      starving(settler(world, spot.x, spot.y));
      const worker = settler(world, spot.x + 2, spot.y);
      const job = busyWith(world, worker, kind);
      addItem(world, 'meal', 5, spot.x + 1, spot.y);

      sendSomebodyToFeed(world);

      // Swapping one rescue for another loses a life rather than saving one,
      // and calling a trade party home cancels the trip for everybody.
      expect(worker.jobId, `${kind} was interrupted`).toBe(job.id);
      expect(feedJobs(world), `${kind} was interrupted`).toHaveLength(0);
    }
  });

  it('leaves alone every settler the player has already spoken for', () => {
    const cases: Array<[string, (p: Pawn) => void]> = [
      ['drafted', (p) => (p.drafted = true)],
      ['taken off the board by hand', (p) => (p.manual = true)],
      ['possessed', (p) => (p.playerControlled = true)],
      ['doctoring switched off', (p) => (p.priorities.doctor = 0)],
      ['asleep', (p) => (p.activity = 'sleeping')],
      ['running on empty themselves', (p) => (p.needs.food = 0.2)],
      ['on the floor themselves', (p) => starving(p)],
    ];
    for (const [what, make] of cases) {
      const { world } = empty();
      const spot = clearing(world);
      starving(settler(world, spot.x, spot.y));
      const worker = settler(world, spot.x + 2, spot.y);
      const job = busyWith(world, worker);
      make(worker);
      addItem(world, 'meal', 5, spot.x + 1, spot.y);

      sendSomebodyToFeed(world);

      // Each of these is an answer the player or the sim has already given, and
      // an emergency lane that overrides them is a lane that takes the colony
      // away from whoever is playing it.
      expect(worker.jobId, `${what} was overridden`).toBe(job.id);
      expect(feedJobs(world), `${what} was overridden`).toHaveLength(0);
    }
  });

  it('sends the nearer of two, and only one of them', () => {
    const { world } = empty();
    const spot = clearing(world);
    starving(settler(world, spot.x, spot.y));
    const near = settler(world, spot.x + 2, spot.y);
    const far = settler(world, spot.x + 5, spot.y);
    const nearJob = busyWith(world, near);
    const farJob = busyWith(world, far);
    addItem(world, 'meal', 5, spot.x + 1, spot.y);

    sendSomebodyToFeed(world);

    expect(world.jobs.some((j) => j.id === nearJob.id)).toBe(false);
    expect(far.jobId).toBe(farJob.id);
    expect(feedJobs(world)).toHaveLength(1);
  });

  it('is not noticed at all while they still have something to eat on', () => {
    const { world } = empty();
    const spot = clearing(world);
    const patient = starving(settler(world, spot.x, spot.y));
    // Above the emergency line but below the ordinary one: the doctor lane can
    // pick this up in its own time, and nobody is dragged off a job for it.
    patient.needs.food = 0.3;
    const worker = settler(world, spot.x + 2, spot.y);
    const job = busyWith(world, worker);
    addItem(world, 'meal', 5, spot.x + 1, spot.y);

    sendSomebodyToFeed(world);

    expect(worker.jobId).toBe(job.id);
    expect(feedJobs(world)).toHaveLength(0);
  });
});

describe('the colony left to run itself', () => {
  it('feeds the settler on the floor while every other settler is working', () => {
    const { world, streams } = empty();
    const spot = clearing(world);
    const patient = starving(settler(world, spot.x, spot.y));
    // Three settlers, all mid-job, which is the measured shape of the failure:
    // hands available, none of them idle, and the two assignment entry points
    // both returning early on every one of them.
    for (let i = 0; i < 3; i++) busyWith(world, settler(world, spot.x + 2 + i, spot.y + 1));
    addItem(world, 'meal', 20, spot.x + 1, spot.y);

    stepWorldN(world, streams, 900);

    // Nobody was told to do this by the test. The pass runs inside `stepWorld`,
    // between the fire pass and the per-pawn loop, and the job it writes is
    // carried out on the same tick it is written.
    expect(patient.dead).toBe(false);
    expect(patient.needs.food).toBeGreaterThan(0.2);
  });
});
