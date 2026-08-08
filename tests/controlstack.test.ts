/**
 * The control stack — what a settler is doing, what they are doing next, and who
 * decides.
 *
 * Two features share one mechanism here, which is why they share a file.
 *
 * **The readout.** A settler used to be a black box holding exactly one job. The
 * stack makes the next one visible, and the way it does that is the thing worth
 * testing: a queued entry is a real `Job` on `world.jobs`, so it holds its
 * reservations from the moment it is queued. That is what stops two settlers
 * walking to the same tree, and it is also the thing that could quietly wreck the
 * colony — claimed work is work nobody else can take, and a settler who queues
 * three jobs while a colleague stands in the yard has stolen that colleague's
 * afternoon. Half these tests are about that hazard.
 *
 * **The switch.** Manual is not the draft. A drafted settler stops working and
 * holds a position; a manual settler still works, still eats, still sleeps — the
 * colony has simply stopped choosing *which* work. The player does, one order at
 * a time, from the manager view, without possessing anybody.
 */

import { describe, expect, it } from 'vitest';

import { ManagerCamera } from '../src/client/manager/camera';
import { ManagerController } from '../src/client/manager/controller';
import type { Input } from '../src/client/input/input';
import { canPlace, cancelStackEntry, orderJob, placeBlueprint, setManual } from '../src/sim/orders';
import { LOOKAHEAD, STACK_MAX, controlStack, queuedJobs, stackRoom } from '../src/sim/queue';
import {
  clearQueue,
  isBuildingTargeted,
  isCellTargeted,
  planAhead,
  queueJob,
  reachable,
  startQueued,
} from '../src/sim/jobs';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { HUNGRY, TIRED } from '../src/sim/needs';
import { DESIG_HARVEST, packCell, terrainAt } from '../src/sim/types';
import type { Building, Pawn, World, WorkType } from '../src/sim/types';
import { cancelJob, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

const SEED = 20260729;

function colony(): World {
  return createWorld(SEED);
}

/** Everyone but `keep` put out of the running, so the work board is theirs alone. */
function soloWorker(world: World): Pawn {
  const all = livingColonists(world);
  const keep = all[0]!;
  for (const p of all) if (p.id !== keep.id) p.manual = true;
  return keep;
}

/** A tree this settler can get to, marked for felling. */
function markedTree(world: World, pawn: Pawn): Building {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if (b.kind !== 'tree' || !b.built) continue;
    const d = Math.hypot(b.x - pawn.x, b.y - pawn.y);
    if (d >= bestD || d < 2) continue;
    if (!reachable(world, pawn, b.x, b.y, true)) continue;
    best = b;
    bestD = d;
  }
  if (!best) throw new Error('worldgen produced no reachable tree');
  world.cellDesig[packCell(world, best.x, best.y)] = DESIG_HARVEST;
  return best;
}

/** A rock face this settler can get to, marked for mining. */
function markedRock(world: World, pawn: Pawn): { x: number; y: number } {
  for (let r = 3; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(pawn.x) + dx;
        const y = Math.round(pawn.y) + dy;
        if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) continue;
        if (terrainAt(world, x, y) !== 'rock') continue;
        if (world.cellDesig[packCell(world, x, y)] !== 0) continue;
        if (!reachable(world, pawn, x, y, true)) continue;
        world.cellDesig[packCell(world, x, y)] = DESIG_HARVEST;
        return { x, y };
      }
    }
  }
  throw new Error('worldgen produced no reachable rock');
}

/**
 * Narrow a settler down to the listed work types at the listed priorities.
 *
 * The rank rules are about *ordering*, so a test of them has to control the whole
 * order rather than one end of it: leave the other twelve work types switched on
 * and the settler plans something nobody asked about.
 */
function onlyWorks(pawn: Pawn, levels: Partial<Record<WorkType, number>>): Pawn {
  for (const w of Object.keys(pawn.priorities) as WorkType[]) pawn.priorities[w] = 0;
  for (const [w, level] of Object.entries(levels)) pawn.priorities[w as WorkType] = level!;
  return pawn;
}

/**
 * Two ticks: the one the job in hand finishes on, and the one the next entry is
 * taken off the stack on. Returns what they ended up holding.
 */
function handover(world: World, streams: ReturnType<typeof makeStreams>, pawn: Pawn): number | null {
  stepWorld(world, streams);
  stepWorld(world, streams);
  return pawn.jobId;
}

/** A walkable cell some way off, for a move order that takes a few seconds. */
function farCell(world: World, pawn: Pawn): { x: number; y: number } {
  for (let r = 6; r < 20; r++) {
    for (const [dx, dy] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ]) {
      const x = Math.round(pawn.x) + dx;
      const y = Math.round(pawn.y) + dy;
      if (x < 2 || y < 2 || x >= world.width - 2 || y >= world.height - 2) continue;
      if (terrainAt(world, x, y) === 'rock' || terrainAt(world, x, y) === 'water') continue;
      if (world.cellBuilding[packCell(world, x, y)]! >= 0) continue;
      if (reachable(world, pawn, x, y, false)) return { x, y };
    }
  }
  throw new Error('nowhere to walk to');
}

// ---------------------------------------------------------------------------
// what a queued job is
// ---------------------------------------------------------------------------

describe('a job waiting its turn', () => {
  it('is a real job, claimed by the settler who queued it, that nobody else can take', () => {
    const world = colony();
    const pawn = soloWorker(world);
    const tree = markedTree(world, pawn);
    // Give them something in hand first, so the order lands on the stack rather
    // than in their hands.
    queueJob(world, pawn, 'moveTo', Math.round(pawn.x), Math.round(pawn.y));
    const job = queueJob(world, pawn, 'chop', tree.x, tree.y, { buildingId: tree.id });

    expect(world.jobs.some((j) => j.id === job.id)).toBe(true);
    expect(job.pawnId).toBe(pawn.id);
    expect(queuedJobs(world, pawn).map((j) => j.id)).toEqual([job.id]);
    // The claim is what makes the stack safe: the colony's own picker asks these
    // two questions before it offers anybody anything.
    expect(isBuildingTargeted(world, tree.id)).toBe(true);
  });

  it('gives its claim back when it is cancelled, and leaves the stack with it', () => {
    const world = colony();
    const pawn = soloWorker(world);
    const tree = markedTree(world, pawn);
    queueJob(world, pawn, 'moveTo', Math.round(pawn.x), Math.round(pawn.y));
    const job = queueJob(world, pawn, 'chop', tree.x, tree.y, { buildingId: tree.id });

    cancelJob(world, job.id);

    expect(isBuildingTargeted(world, tree.id)).toBe(false);
    expect(queuedJobs(world, pawn)).toEqual([]);
    expect(pawn.queue).toEqual([]);
  });

  it('is picked up the tick after the job in hand finishes, in the order it was queued', () => {
    const world = colony();
    const streams = makeStreams(world);
    const pawn = soloWorker(world);
    const here = { x: Math.round(pawn.x), y: Math.round(pawn.y) };
    const first = queueJob(world, pawn, 'moveTo', here.x, here.y);
    const second = queueJob(world, pawn, 'moveTo', here.x, here.y);
    const third = queueJob(world, pawn, 'moveTo', here.x, here.y);
    expect(pawn.jobId).toBe(first.id);
    expect(pawn.queue).toEqual([second.id, third.id]);

    // Standing where they are told to stand, so each order finishes on arrival:
    // one tick to finish, one tick to take the next off the stack. Two ticks is
    // a tenth of a second, and the point of the number is that it is *fixed* —
    // it does not wait for the twelve-tick assignment cadence the way an idle
    // settler looking for fresh work does.
    expect(handover(world, streams, pawn)).toBe(second.id);
    expect(handover(world, streams, pawn)).toBe(third.id);
    expect(handover(world, streams, pawn)).toBe(null);
  });

  it('is skipped rather than stalled on if the job behind it went away', () => {
    const world = colony();
    const streams = makeStreams(world);
    const pawn = soloWorker(world);
    const here = { x: Math.round(pawn.x), y: Math.round(pawn.y) };
    const live = queueJob(world, pawn, 'moveTo', here.x, here.y);
    const doomed = queueJob(world, pawn, 'moveTo', here.x, here.y);
    const good = queueJob(world, pawn, 'moveTo', here.x, here.y);
    expect(pawn.jobId).toBe(live.id);

    // Cancelled by hand leaves no id behind, so forge the nastier case: an id on
    // the stack naming a job that is simply gone.
    world.jobs = world.jobs.filter((j) => j.id !== doomed.id);
    expect(pawn.queue).toContain(doomed.id);

    expect(handover(world, streams, pawn)).toBe(good.id);
  });
});

// ---------------------------------------------------------------------------
// the hazard: claimed work is work nobody else can take
// ---------------------------------------------------------------------------

describe('the colony planning one job ahead', () => {
  it('will not line anything up while somebody else is standing in the yard', () => {
    const world = colony();
    const all = livingColonists(world);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const worker = all[0]!;
    const idler = all[1]!;
    for (const p of all.slice(2)) p.manual = true;
    const tree = markedTree(world, worker);
    queueJob(world, worker, 'chop', tree.x, tree.y, { buildingId: tree.id });
    idler.jobId = null;
    idler.activity = 'idle';
    worker.needs.food = 0.9;
    worker.needs.rest = 0.9;

    planAhead(world, worker);

    expect(worker.queue ?? []).toEqual([]);
  });

  it('lines up exactly one, and no more, when everybody is busy', () => {
    const world = colony();
    const all = livingColonists(world);
    const worker = all[0]!;
    for (const p of all.slice(1)) p.manual = true;
    const tree = markedTree(world, worker);
    queueJob(world, worker, 'chop', tree.x, tree.y, { buildingId: tree.id });
    worker.needs.food = 0.9;
    worker.needs.rest = 0.9;

    planAhead(world, worker);
    const after = (worker.queue ?? []).length;
    planAhead(world, worker);

    expect(after).toBeLessThanOrEqual(LOOKAHEAD);
    expect((worker.queue ?? []).length).toBe(after);
    expect(LOOKAHEAD).toBeLessThan(STACK_MAX);
  });

  it('lines nothing up behind a settler who is about to stop for a meal or a bed', () => {
    const world = colony();
    const all = livingColonists(world);
    const worker = all[0]!;
    for (const p of all.slice(1)) p.manual = true;
    const tree = markedTree(world, worker);
    queueJob(world, worker, 'chop', tree.x, tree.y, { buildingId: tree.id });

    worker.needs.food = HUNGRY - 0.01;
    worker.needs.rest = 0.9;
    planAhead(world, worker);
    expect(worker.queue ?? []).toEqual([]);

    worker.needs.food = 0.9;
    worker.needs.rest = TIRED - 0.01;
    planAhead(world, worker);
    expect(worker.queue ?? []).toEqual([]);
  });

  it('never lets a full week of it starve anybody — needs outrank the stack', () => {
    // The regression this guards is exact: with work always lined up, a settler
    // is never idle, and the need check only ever ran on an idle settler. Seed
    // 20260729 went to food 0 the first time this was wired up.
    const world = colony();
    const streams = makeStreams(world);
    let worst = 1;
    for (let i = 0; i < 20 * 240 * 5; i++) {
      stepWorld(world, streams);
      if (i % 20 !== 0) continue;
      for (const p of livingColonists(world)) worst = Math.min(worst, p.needs.food);
    }
    expect(worst).toBeGreaterThan(0.02);
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });

  it('hands the plan back when the board has moved on to better work', () => {
    // The other half of the same hazard, and the one that cost the most. A plan
    // is made while the settler's hands are full and started when they are empty,
    // and in between a raider goes down, a prisoner stops eating, a roof catches.
    // Starting it regardless means the stack quietly outranks the work board:
    // seed 1312 stopped recruiting and lost half its people to it.
    const world = colony();
    const worker = onlyWorks(soloWorker(world), { chop: 4, mine: 1 });
    const tree = markedTree(world, worker);
    const inHand = queueJob(world, worker, 'moveTo', Math.round(worker.x), Math.round(worker.y));
    worker.needs.food = 0.9;
    worker.needs.rest = 0.9;

    // Nothing to mine yet, so felling is the best thing going and the look-ahead
    // lines it up.
    planAhead(world, worker);
    const planned = queuedJobs(world, worker)[0];
    expect(planned?.kind).toBe('chop');
    expect(planned?.rank).toBeDefined();

    // Then the board moves: a rock face is marked, and mining sits two whole
    // priority levels above felling.
    const rock = markedRock(world, worker);
    cancelJob(world, inHand.id);
    expect(startQueued(world, worker)).toBe(true);

    const now = world.jobs.find((j) => j.id === worker.jobId);
    expect(now?.kind).toBe('mine');
    expect(now?.tx).toBe(rock.x);
    // Given up, not thrown away: the tree is still theirs and still next.
    expect(worker.queue).toEqual([planned!.id]);
    expect(isBuildingTargeted(world, tree.id)).toBe(true);
  });

  it('never second-guesses an order the player gave', () => {
    // Being told is the point. The same is true of a stack loaded from a save
    // written before jobs carried a rank at all — an unranked entry is an order.
    const world = colony();
    const worker = onlyWorks(soloWorker(world), { chop: 4, mine: 1 });
    const tree = markedTree(world, worker);
    const inHand = queueJob(world, worker, 'moveTo', Math.round(worker.x), Math.round(worker.y));
    const ordered = queueJob(world, worker, 'chop', tree.x, tree.y, { buildingId: tree.id });
    expect(ordered.rank).toBeUndefined();

    markedRock(world, worker);
    cancelJob(world, inHand.id);
    expect(startQueued(world, worker)).toBe(true);

    expect(worker.jobId).toBe(ordered.id);
    expect(worker.queue).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the switch
// ---------------------------------------------------------------------------

describe('a settler taking orders directly', () => {
  it('keeps the job in hand but gives the colony its look-ahead back', () => {
    const world = colony();
    const pawn = soloWorker(world);
    const tree = markedTree(world, pawn);
    const inHand = queueJob(world, pawn, 'moveTo', Math.round(pawn.x), Math.round(pawn.y));
    const lined = queueJob(world, pawn, 'chop', tree.x, tree.y, { buildingId: tree.id });

    setManual(world, pawn.id, true);

    expect(pawn.manual).toBe(true);
    expect(pawn.jobId).toBe(inHand.id);
    expect(pawn.queue).toEqual([]);
    // Given back properly, not just forgotten about.
    expect(world.jobs.some((j) => j.id === lined.id)).toBe(false);
    expect(isBuildingTargeted(world, tree.id)).toBe(false);
  });

  it('is never given work by the colony again until it is switched off', () => {
    const world = colony();
    const streams = makeStreams(world);
    const pawn = livingColonists(world)[0]!;
    setManual(world, pawn.id, true);
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    clearQueue(world, pawn);
    pawn.needs.food = 0.9;
    pawn.needs.rest = 0.9;
    pawn.needs.recreation = 0.9;

    for (let i = 0; i < 200; i++) {
      stepWorld(world, streams);
      pawn.needs.food = 0.9;
      pawn.needs.rest = 0.9;
      pawn.needs.recreation = 0.9;
      expect(pawn.jobId).toBe(null);
    }
  });

  it('still eats — off the work board is not a licence to starve', () => {
    const world = colony();
    const streams = makeStreams(world);
    const pawn = livingColonists(world)[0]!;
    setManual(world, pawn.id, true);
    pawn.needs.food = 0.1;

    let ate = false;
    for (let i = 0; i < 600 && !ate; i++) {
      stepWorld(world, streams);
      const job = world.jobs.find((j) => j.id === pawn.jobId);
      if (job && job.kind === 'eat') ate = true;
    }
    expect(ate).toBe(true);
  });

  it('is not the draft: they are never taken off the map into the combat pass', () => {
    const world = colony();
    const pawn = livingColonists(world)[0]!;
    setManual(world, pawn.id, true);
    expect(pawn.drafted).toBe(false);
    setManual(world, pawn.id, false);
    expect(pawn.manual).toBe(false);
    expect(pawn.drafted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the orders themselves
// ---------------------------------------------------------------------------

describe('an order given by hand from the manager', () => {
  it('works out what the cell means: a tree is felled, rock is mined, bare ground is walked to', () => {
    const world = colony();
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);

    const tree = markedTree(world, pawn);
    expect(orderJob(world, pawn.id, tree.x, tree.y)).toBe('ok');
    expect(world.jobs.find((j) => j.id === pawn.jobId)!.kind).toBe('chop');

    const spot = farCell(world, pawn);
    expect(orderJob(world, pawn.id, spot.x, spot.y)).toBe('ok');
    const walking = queuedJobs(world, pawn).at(-1)!;
    expect(walking.kind).toBe('moveTo');
    expect({ x: walking.tx, y: walking.ty }).toEqual(spot);
  });

  it('marks no designation and needs none — the click is the order', () => {
    const world = colony();
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    const tree = markedTree(world, pawn);
    world.cellDesig[packCell(world, tree.x, tree.y)] = 0;

    expect(orderJob(world, pawn.id, tree.x, tree.y)).toBe('ok');
    expect(world.jobs.find((j) => j.id === pawn.jobId)!.kind).toBe('chop');
    // The rest of the grove is left alone, which is the whole difference between
    // ordering one settler and painting a designation.
    expect(world.cellDesig[packCell(world, tree.x, tree.y)]).toBe(0);
  });

  it('refuses what somebody else has already claimed, and says which', () => {
    const world = colony();
    const all = livingColonists(world);
    const first = all[0]!;
    const second = all[1]!;
    const tree = markedTree(world, first);
    queueJob(world, first, 'chop', tree.x, tree.y, { buildingId: tree.id });

    expect(orderJob(world, second.id, tree.x, tree.y)).toBe('taken');
  });

  it('takes three and then says it is full', () => {
    const world = colony();
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    const spot = farCell(world, pawn);

    const results: string[] = [];
    for (let i = 0; i < STACK_MAX + 1; i++) results.push(orderJob(world, pawn.id, spot.x, spot.y));

    expect(results.slice(0, STACK_MAX)).toEqual(Array(STACK_MAX).fill('ok'));
    expect(results.at(-1)).toBe('full');
    expect(controlStack(world, pawn).length).toBe(STACK_MAX);
    expect(stackRoom(world, pawn)).toBe(0);
  });

  it('will not fight the combat pass for a drafted body', () => {
    const world = colony();
    const pawn = livingColonists(world)[0]!;
    pawn.drafted = true;
    const spot = farCell(world, pawn);
    expect(orderJob(world, pawn.id, spot.x, spot.y)).toBe('blocked');
  });

  it('is carried out, in order, with nobody drafted and nobody possessed', () => {
    const world = colony();
    const streams = makeStreams(world);
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    clearQueue(world, pawn);
    pawn.needs.food = 0.9;
    pawn.needs.rest = 0.9;

    const spot = farCell(world, pawn);
    expect(orderJob(world, pawn.id, spot.x, spot.y)).toBe('ok');
    const tree = markedTree(world, pawn);
    expect(orderJob(world, pawn.id, tree.x, tree.y)).toBe('ok');
    expect(controlStack(world, pawn).map((j) => j.kind)).toEqual(['moveTo', 'chop']);

    let walked = false;
    for (let i = 0; i < 20 * 90; i++) {
      stepWorld(world, streams);
      pawn.needs.food = 0.9;
      pawn.needs.rest = 0.9;
      if (!walked && Math.round(pawn.x) === spot.x && Math.round(pawn.y) === spot.y) walked = true;
      if (walked && !world.buildings.some((b) => b.id === tree.id)) break;
    }

    expect(walked).toBe(true);
    expect(world.buildings.some((b) => b.id === tree.id)).toBe(false);
    expect(pawn.drafted).toBe(false);
    expect(pawn.playerControlled).toBe(false);
  });

  it('lets a blueprint be handed to one named settler', () => {
    const world = colony();
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);

    const at = farCell(world, pawn);
    expect(canPlace(world, 'wall', at.x, at.y)).toBe('ok');
    placeBlueprint(world, 'wall', at.x, at.y);

    expect(orderJob(world, pawn.id, at.x, at.y)).toBe('ok');
    const job = world.jobs.find((j) => j.id === pawn.jobId)!;
    expect(['build', 'haulToBlueprint']).toContain(job.kind);
  });

  it('can be rubbed out one entry at a time, and only by its owner', () => {
    const world = colony();
    const all = livingColonists(world);
    const pawn = all[0]!;
    const other = all[1]!;
    setManual(world, pawn.id, true);
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    clearQueue(world, pawn);

    const spot = farCell(world, pawn);
    orderJob(world, pawn.id, spot.x, spot.y);
    orderJob(world, pawn.id, spot.x, spot.y);
    const stack = controlStack(world, pawn);
    expect(stack.length).toBe(2);

    expect(cancelStackEntry(world, other.id, stack[1]!.id)).toBe(false);
    expect(controlStack(world, pawn).length).toBe(2);

    expect(cancelStackEntry(world, pawn.id, stack[1]!.id)).toBe(true);
    expect(controlStack(world, pawn).map((j) => j.id)).toEqual([stack[0]!.id]);
  });

  it('leaves a settler standing where they were sent, with nothing else picked up', () => {
    const world = colony();
    const streams = makeStreams(world);
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    clearQueue(world, pawn);
    pawn.needs.food = 0.9;
    pawn.needs.rest = 0.9;
    pawn.needs.recreation = 0.9;

    const spot = farCell(world, pawn);
    orderJob(world, pawn.id, spot.x, spot.y);
    for (let i = 0; i < 20 * 60; i++) {
      stepWorld(world, streams);
      pawn.needs.food = 0.9;
      pawn.needs.rest = 0.9;
      pawn.needs.recreation = 0.9;
      if (pawn.jobId === null && Math.round(pawn.x) === spot.x) break;
    }
    expect({ x: Math.round(pawn.x), y: Math.round(pawn.y) }).toEqual(spot);
    expect(pawn.jobId).toBe(null);

    stepWorldN(world, streams, 60);
    expect(pawn.jobId).toBe(null);
    expect({ x: Math.round(pawn.x), y: Math.round(pawn.y) }).toEqual(spot);
  });
});

// ---------------------------------------------------------------------------
// saves
// ---------------------------------------------------------------------------

describe('a colony saved before any of this existed', () => {
  it('loads with an empty stack and nobody on manual', () => {
    const world = colony();
    const pawn = livingColonists(world)[0]!;
    delete pawn.queue;
    delete pawn.manual;

    // Every reader has to treat "absent" as "empty", or an old save throws on the
    // first tick after loading.
    expect(queuedJobs(world, pawn)).toEqual([]);
    expect(stackRoom(world, pawn)).toBeGreaterThan(0);
    expect(isCellTargeted(world, 0, 0)).toBe(false);

    const streams = makeStreams(world);
    stepWorldN(world, streams, 40);
    expect(pawn.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the manager's own hands
// ---------------------------------------------------------------------------

/**
 * The manager as the render loop drives it: a real camera, a real controller, and
 * `update` called once per frame with the one input field the gesture sets.
 *
 * Called directly, `orderJob` has been proved to work by everything above. What
 * this block adds is the wiring — a command surface nothing routes a click into
 * is a command surface the player does not have.
 */
function manager(world: World): { cam: ManagerCamera; ctl: ManagerController } {
  const cam = new ManagerCamera(world, {
    targetX: 32,
    targetY: 32,
    distance: 34,
    yaw: 0.8,
    pitch: 0.95,
  });
  cam.resize(1024 / 768);
  return { cam, ctl: new ManagerController(cam, { possess: () => {} }) };
}

/** Only the fields the controller reads. Cast, so a real Input change breaks this. */
function fakeInput(opts: Partial<Record<string, unknown>> = {}): Input {
  return {
    down: new Set<string>(),
    mouseButtons: new Set<number>(),
    wheel: 0,
    ndcX: 0,
    ndcY: 0,
    moveX: 0,
    moveY: 0,
    locked: false,
    touchSeen: false,
    tapped: false,
    dragging: false,
    dragStarted: false,
    dragEnded: false,
    dragAborted: false,
    panX: 0,
    panY: 0,
    zoomScale: 1,
    pressed: () => false,
    held: () => false,
    clicked: () => false,
    released: () => false,
    ...opts,
  } as unknown as Input;
}

/** Put the camera on a cell so the middle of the screen picks it, and prove it did. */
function aim(cam: ManagerCamera, x: number, y: number): void {
  cam.focusOn(x, y);
  const hit = cam.pickCell(0, 0);
  if (!hit || hit.x !== x || hit.y !== y) {
    throw new Error(`the centre of the screen is on ${hit?.x},${hit?.y}, not ${x},${y}`);
  }
}

const RIGHT_CLICK = { clicked: (b: number) => b === 2 };

describe('giving orders from the manager', () => {
  it('still sends a settler on the work board walking, and drafts them to do it', () => {
    const world = colony();
    const pawn = soloWorker(world);
    const spot = farCell(world, pawn);
    const { cam, ctl } = manager(world);
    ctl.selection = { type: 'pawn', id: pawn.id };
    aim(cam, spot.x, spot.y);

    ctl.update(world, fakeInput(RIGHT_CLICK), 0.05);

    // Unchanged behaviour, asserted because the new branch sits directly on top of
    // it: a settler the colony is still running has one meaning for a right-click,
    // and it is the one it has always had.
    expect(pawn.drafted).toBe(true);
    expect(pawn.orderX).toBe(spot.x);
    expect(pawn.orderY).toBe(spot.y);
  });

  it('sets a settler you have taken over to work on what you point at', () => {
    const world = colony();
    const pawn = soloWorker(world);
    const tree = markedTree(world, pawn);
    setManual(world, pawn.id, true);
    const { cam, ctl } = manager(world);
    ctl.selection = { type: 'pawn', id: pawn.id };
    aim(cam, tree.x, tree.y);

    ctl.update(world, fakeInput(RIGHT_CLICK), 0.05);

    const stack = controlStack(world, pawn);
    expect(stack.map((j) => j.kind)).toEqual(['chop']);
    expect(stack[0]!.buildingId).toBe(tree.id);
    // The whole point of the switch: this is work, not the draft, and the player
    // never left the manager view to give it.
    expect(pawn.drafted).toBe(false);
    expect(pawn.playerControlled).toBe(false);
  });

  it('says why when the stack will not take another order', () => {
    const world = colony();
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    for (let i = 0; i < STACK_MAX; i++) {
      const spot = farCell(world, pawn);
      queueJob(world, pawn, 'moveTo', spot.x + i, spot.y);
    }
    const spot = farCell(world, pawn);
    const { cam, ctl } = manager(world);
    ctl.selection = { type: 'pawn', id: pawn.id };
    aim(cam, spot.x, spot.y);
    const before = world.messages.length;

    ctl.update(world, fakeInput(RIGHT_CLICK), 0.05);

    // A refused order that says nothing is how a player concludes the feature is
    // broken; the stack is capped at three and the cap has to be legible.
    expect(world.messages.length).toBeGreaterThan(before);
    expect(world.messages.at(-1)!.text).toMatch(/three orders/);
    expect(controlStack(world, pawn).length).toBe(STACK_MAX);
  });

  it('takes the order off a tap, so a tablet can give it too', () => {
    const world = colony();
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    const spot = farCell(world, pawn);
    const { cam, ctl } = manager(world);
    ctl.selection = { type: 'pawn', id: pawn.id };
    aim(cam, spot.x, spot.y);

    ctl.update(world, fakeInput({ tapped: true, touchSeen: true }), 0.05);

    // There is no right button on a tablet, so the tap has to carry both meanings.
    expect(controlStack(world, pawn).length).toBe(1);
    expect(ctl.selection).toEqual({ type: 'pawn', id: pawn.id });
  });

  it('still changes who you are looking at when the tap lands on a person', () => {
    const world = colony();
    const pawn = soloWorker(world);
    setManual(world, pawn.id, true);
    const other = livingColonists(world).find((p) => p.id !== pawn.id)!;
    const { cam, ctl } = manager(world);
    ctl.selection = { type: 'pawn', id: pawn.id };
    aim(cam, Math.round(other.x), Math.round(other.y));

    ctl.update(world, fakeInput({ tapped: true, touchSeen: true }), 0.05);

    // The exception that makes tap-to-order usable: without it, selecting anybody
    // else on a tablet would first require putting this one back on the board.
    expect(ctl.selection).toEqual({ type: 'pawn', id: other.id });
    expect(controlStack(world, pawn).length).toBe(0);
  });
});
