/**
 * Somebody drops what they are doing and carries the meal over.
 *
 * The defect these assertions exist to stop was measured, not imagined. A probe
 * walked the run a tick at a time and asked, on every tick where a downed settler
 * sat at zero food, why each other settler was not the one carrying a meal.
 * `assignJob` and `assignNeedsOnly` both return early on a settler who already
 * has a job, so from the floor a colony that is merely busy was
 * indistinguishable from one that is unconscious.
 *
 * The numbers that first justified this file came off a probe that was driving
 * the steward, and the fifteen sweep runs the grid reports are unmanaged — a
 * different colony living a different sixty days. Re-measured with it off, on the
 * three harsh seeds the starvation principles name:
 *
 *     seed        total   colony floored   meal moving   all mid-job   free
 *     20260729   222.9 h          168.3 h        35.2 h        17.7 h  0.8 h
 *     7           94.2 h           70.7 h        19.8 h         2.1 h  0.6 h
 *     424242     118.0 h           95.4 h        13.5 h         8.8 h  0.1 h
 *
 * `sendSomebodyToFeed` closed the mid-job column, and then the probe said what
 * was left: of 6036 settler-ticks where the pass looked at somebody upright and
 * declined to send them, **6035 declined because the rescuer was hungry**. One
 * tick in six thousand was anything else. See `RESCUER_KEEPS`.
 *
 * The first block is the gate list, one assertion each, so a failure names which
 * gate moved. The last block is the whole thing running inside `stepWorld` with
 * nobody touching it: the measured shape of both failures, and the patient eats.
 */

import { describe, expect, it } from 'vitest';

import { buildingAt } from '../src/sim/grid';
import { NEVER_INTERRUPTED, createJob, putDownWorkToEat, sendSomebodyToFeed } from '../src/sim/jobs';
import { ANIMALS } from '../src/sim/wildlife';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { addItem } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import {
  TICKS_PER_DAY,
  terrainAt,
  type ItemStack,
  type Job,
  type Pawn,
  type ResourceKind,
  type World,
} from '../src/sim/types';
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
      // 0.2 until the round that measured this gate. It was standing in for
      // "running on empty" against a bar of `HUNGRY`, which is 0.34 — most of a
      // working day still in hand — and on three unmanaged sixty-day seeds that
      // bar was the reason 6035 of 6036 declined settler-ticks declined. The bar
      // is `RESCUER_KEEPS` now, so the number here has to mean what the label
      // says: 0.1 is a settler somebody should be fetching a meal *to*.
      ['running on empty themselves', (p) => (p.needs.food = 0.1)],
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

  it('is worth a hungry settler’s lunch break, because the errand starts at the pantry', () => {
    const { world } = empty();
    const spot = clearing(world);
    const patient = starving(settler(world, spot.x, spot.y));
    const worker = settler(world, spot.x + 2, spot.y);
    // Hungry by the ordinary bar and nowhere near the emergency one. This settler
    // used to work straight through a colleague at 0.00, and the reason given was
    // that they would deal with their own crisis first — but they have most of a
    // day in hand, and the job they are being sent on begins by picking up food.
    worker.needs.food = 0.3;
    const job = busyWith(world, worker);
    addItem(world, 'meal', 5, spot.x + 1, spot.y);

    sendSomebodyToFeed(world);

    expect(world.jobs.some((j) => j.id === job.id), 'kept working').toBe(false);
    const feeds = feedJobs(world);
    expect(feeds, 'nobody was sent').toHaveLength(1);
    expect(feeds[0].targetPawnId).toBe(patient.id);
  });

  it('is not worth the lunch break of a settler who is nearly the next patient', () => {
    const { world } = empty();
    const spot = clearing(world);
    starving(settler(world, spot.x, spot.y));
    const worker = settler(world, spot.x + 2, spot.y);
    // Exactly on the line. The gate is `<=`, so this settler stays put: below it
    // they are inside the band the sim already calls an emergency, and sending
    // them is the trade the old comment warned about — two down instead of one.
    worker.needs.food = 0.14;
    const job = busyWith(world, worker);
    addItem(world, 'meal', 5, spot.x + 1, spot.y);

    sendSomebodyToFeed(world);

    expect(worker.jobId).toBe(job.id);
    expect(feedJobs(world)).toHaveLength(0);
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

/**
 * The reflexive case, and the one this file did not cover.
 *
 * Everything above is about somebody *else* dropping what they are doing. The
 * same early return sits in front of the settler's own stomach: `assignJob` quits
 * at its first line on a settler who already has a job, so needs only ever jumped
 * the queue for an idle one. `tick.ts` closed the near half of that a round ago —
 * a settler with a job *queued* is never idle, and that starved seed 20260729 flat
 * to zero. This is the far half: one job that simply runs a long time.
 *
 * Measured on settler/7, sixty days, unmanaged. Pell Verrow (#2605) stood at zero
 * food for twelve hours and eighteen minutes ending day 35, with a mean of a
 * hundred and five units of food in the larder throughout. `probe-upright` asks,
 * of every upright settler at zero, what the first thing stopping them eating is,
 * in the need pass's own order — 2906 of those ticks answered `is mid-job (hunt)`.
 * A hunt is allowed `JOB_TIMEOUT * 2`, so that was one hunt well inside its own
 * allowance, and that single spell is the whole of the
 * `on-their-feet-at-zero-is-a-walk-home` break: 12.3 h against a twelve-hour bar.
 */
describe('a settler starving on their feet', () => {
  it('puts the hunt down when there is food at home to walk to', () => {
    const { world } = empty();
    const spot = clearing(world);
    const hunter = settler(world, spot.x, spot.y);
    hunter.needs.food = 0;
    const job = busyWith(world, hunter, 'hunt');
    addItem(world, 'meal', 5, spot.x + 1, spot.y);

    expect(putDownWorkToEat(world, hunter)).toBe(true);

    // Idle, not eating. The rule hands the settler back to the need pass rather
    // than writing the meal itself, so there is one place that decides what a
    // hungry settler eats and it is `tryNeedJob`.
    expect(world.jobs.some((j) => j.id === job.id)).toBe(false);
    expect(hunter.jobId).toBe(null);
  });

  it('keeps hunting when the larder is empty, because that is what ends the famine', () => {
    const { world } = empty();
    const spot = clearing(world);
    const hunter = settler(world, spot.x, spot.y);
    hunter.needs.food = 0;
    const job = busyWith(world, hunter, 'hunt');

    // No meal anywhere. This is the safety of the whole rule: ungated it would
    // cancel, every tick, the only work in the colony that produces food — and a
    // cancel that buys no lunch is a settler standing in the yard starving.
    expect(putDownWorkToEat(world, hunter)).toBe(false);
    expect(hunter.jobId).toBe(job.id);
  });

  it('finishes the job when they are merely hungry', () => {
    const { world } = empty();
    const spot = clearing(world);
    const hunter = settler(world, spot.x, spot.y);
    // Above the emergency line and below the ordinary one — the band where a
    // settler would like lunch. `HUNGRY` is 0.34 and would have stopped the work
    // here; the line is `PATIENT_EMERGENCY_FOOD`, where `tickNeeds` stops healing
    // them and starts taking hit points off. Interrupting real work for lunch is
    // how a colony gets nothing done.
    hunter.needs.food = 0.3;
    const job = busyWith(world, hunter, 'hunt');
    addItem(world, 'meal', 5, spot.x + 1, spot.y);

    expect(putDownWorkToEat(world, hunter)).toBe(false);
    expect(hunter.jobId).toBe(job.id);
  });

  it('does not walk out of a fire, or off a march, to find lunch', () => {
    for (const kind of NEVER_INTERRUPTED) {
      const { world } = empty();
      const spot = clearing(world);
      const worker = settler(world, spot.x, spot.y);
      worker.needs.food = 0;
      const job = busyWith(world, worker, kind);
      addItem(world, 'meal', 5, spot.x + 1, spot.y);

      // The same list, honoured and not restated. The colony already holds that a
      // fire, a rescue and a march outrank fetching somebody a meal, and none of
      // those arguments get weaker when the hungry one is doing the carrying.
      expect(putDownWorkToEat(world, worker), kind).toBe(false);
      expect(worker.jobId, kind).toBe(job.id);
    }
  });

  it('does not put the meal down to go and get the meal', () => {
    const { world } = empty();
    const spot = clearing(world);
    const eater = settler(world, spot.x, spot.y);
    eater.needs.food = 0;
    addItem(world, 'meal', 5, spot.x + 2, spot.y);
    const job = busyWith(world, eater, 'eat');

    // Without this the settler cancels the walk to the pantry every tick, is
    // re-sent to the pantry every tick, and never arrives — starving with their
    // hand on the door.
    expect(putDownWorkToEat(world, eater)).toBe(false);
    expect(eater.jobId).toBe(job.id);
  });

  /**
   * What a cancel costs when the settler's hands are full.
   *
   * The rule shipped without this gate and cost three colonies their founding.
   * `cancelJob` does not pause a job, it undoes one: cargo goes on the ground
   * where they stand, unreserved. A hauler two steps from a blueprint who dips
   * below the line puts the timber down in the yard, and the delivery is not
   * delayed but refunded — somebody walks it again from wherever it landed.
   * `calm/1312` and `settler/20260729` both founded inside sixty days with the
   * rule backed out and never founded with it in, and both come back once the
   * gate is here. Founding is gated on things that get built.
   */
  function holding(world: World, p: Pawn, kind: ResourceKind): ItemStack {
    const stack = addItem(world, kind, 5, Math.round(p.x), Math.round(p.y))!;
    stack.carriedBy = p.id;
    p.carryingItemId = stack.id;
    return stack;
  }

  it('finishes the delivery it is already carrying rather than dropping it in the yard', () => {
    const { world } = empty();
    const spot = clearing(world);
    const hauler = settler(world, spot.x, spot.y);
    hauler.needs.food = 0;
    const job = busyWith(world, hauler, 'haulToBlueprint');
    const timber = holding(world, hauler, 'wood');
    addItem(world, 'meal', 5, spot.x + 3, spot.y);

    expect(putDownWorkToEat(world, hauler)).toBe(false);
    expect(hauler.jobId).toBe(job.id);
    // The timber is the point: still in their hands, still spoken for, still on
    // its way somewhere. A test that only checked `jobId` would pass against a
    // version that cancelled and re-issued.
    expect(hauler.carryingItemId).toBe(timber.id);
    expect(timber.carriedBy).toBe(hauler.id);
  });

  it('does put down food it is carrying, because that is the errand', () => {
    const { world } = empty();
    const spot = clearing(world);
    const hauler = settler(world, spot.x, spot.y);
    hauler.needs.food = 0;
    busyWith(world, hauler, 'haulToStockpile');
    const meal = holding(world, hauler, 'meal');

    // Deliberately the only food in the colony, and `findFoodStack` cannot see
    // it — that call skips carried stacks. Without carried food standing in for
    // the errand, a settler starving with a meal in their arms fails the gate
    // that asks whether there is anything to eat, which is the wrong answer to
    // the most literal version of the question.
    expect(putDownWorkToEat(world, hauler)).toBe(true);
    expect(hauler.carryingItemId).toBe(null);
    expect(meal.carriedBy).toBe(null);
    expect(meal.reservedBy).toBe(null);
    expect(meal.x).toBe(Math.round(hauler.x));
  });

  it('does not put a person down to go and eat', () => {
    const { world } = empty();
    const spot = clearing(world);
    const warden = settler(world, spot.x, spot.y);
    warden.needs.food = 0;
    const captive = settler(world, spot.x, spot.y);
    warden.carryingPawnId = captive.id;
    // `haulToStockpile`, not `rescue`: `NEVER_INTERRUPTED` would answer this one
    // on its own and the gate would never be reached. The pin is for the shoulder
    // itself, whatever job put somebody on it.
    const job = busyWith(world, warden, 'haulToStockpile');
    addItem(world, 'meal', 5, spot.x + 3, spot.y);

    expect(putDownWorkToEat(world, warden)).toBe(false);
    expect(warden.jobId).toBe(job.id);
    expect(warden.carryingPawnId).toBe(captive.id);
  });
});

describe('the colony left to run itself', () => {
  it('eats mid-hunt rather than starving upright with a full larder', () => {
    const { world, streams } = empty();
    const spot = clearing(world);
    const hunter = settler(world, spot.x, spot.y);
    hunter.needs.food = 0;
    // The measured shape: a real quarry, so the hunt is a job that genuinely runs
    // for hours rather than a job that finishes on its first tick. Placed well
    // off, and healthy, so nothing about this test depends on the hunt going well.
    const quarry = makePawn(world, new Rng(9), 'fauna', spot.x + 12, spot.y + 12, {
      name: ANIMALS.mossback.label,
      weapon: 'none',
    });
    quarry.animal = 'mossback';
    quarry.hp = ANIMALS.mossback.hp;
    quarry.maxHp = ANIMALS.mossback.hp;
    createJob(world, hunter, 'hunt', quarry.x, quarry.y, { targetPawnId: quarry.id });
    addItem(world, 'meal', 20, spot.x + 1, spot.y);

    // How soon, not whether — the hunt ends eventually and the settler eats after
    // it either way, so a test that only asks whether they ever ate passes on both
    // sides of this change and pins nothing. The window is the twelve hours
    // `on-their-feet-at-zero-is-a-walk-home` allows a settler upright at zero, and
    // the bar inside it is measured on this exact colony: **767 ticks before the
    // rule, 68 after** — nearly four hours against twenty minutes. Two hours sits
    // between them and is near neither.
    const HOUR = TICKS_PER_DAY / 24;
    let ateAt = -1;
    for (let t = 0; t < 12 * HOUR && ateAt < 0; t++) {
      stepWorld(world, streams);
      if (hunter.needs.food > 0.2) ateAt = t;
    }

    expect(hunter.dead, 'starved upright beside a full larder').toBe(false);
    expect(ateAt, 'never ate at all inside the twelve-hour bar').toBeGreaterThanOrEqual(0);
    expect(ateAt, 'finished the hunt first, which is the defect').toBeLessThan(2 * HOUR);
  });


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

  it('feeds the settler on the floor in a colony where everybody is hungry', () => {
    const { world, streams } = empty();
    const spot = clearing(world);
    const patient = starving(settler(world, spot.x, spot.y));
    // The measured shape of the *second* failure, and the one the busy-hands fix
    // could not reach: a hard winter where nobody is comfortable. Every hand is
    // between the emergency line and the ordinary one — upright, working, hours
    // in reserve — and under the old bar not one of them qualified to carry a
    // meal twenty paces. The patient is at zero the whole time.
    for (let i = 0; i < 3; i++) {
      const p = settler(world, spot.x + 2 + i, spot.y + 1);
      p.needs.food = 0.25;
      busyWith(world, p);
    }
    addItem(world, 'meal', 20, spot.x + 1, spot.y);

    // How soon, not whether. Given long enough the old colony got there too — the
    // workers ate, cleared the bar, and *then* noticed the floor — so a test that
    // only asks whether the patient was ever fed passes on both sides of this
    // change and pins nothing. Every tick at zero is hit points off, and the
    // measured gap is the whole finding: 176 ticks before, 49 after, on this
    // exact colony. A hundred sits between them and is not near either.
    let fedAt = -1;
    for (let t = 0; t < 900 && fedAt < 0; t++) {
      stepWorld(world, streams);
      if (patient.needs.food > 0.2) fedAt = t;
    }

    expect(patient.dead, 'died in a colony with meals and hands').toBe(false);
    expect(fedAt, 'never fed at all').toBeGreaterThanOrEqual(0);
    expect(fedAt, 'nobody was sent while it still mattered').toBeLessThan(100);
  });
});
