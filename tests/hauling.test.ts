/**
 * Fetching, and how many times a settler has to do it.
 *
 * This file exists because of a measurement rather than a bug report. Bucket three
 * days of a founding colony by what each settler is doing and it reads 28 123 ticks
 * walking against 4 730 working — six to one. Bucket the *walking* by the job it
 * belongs to and over half of it is hauling: 7 896 ticks to the stockpile and 6 476
 * to blueprints, neither of which books a single tick of work. The colony was not
 * short of hands, it was short of legs, and the two changes pinned here are the two
 * places the legs were being wasted:
 *
 *   - A hauler sent for one pile walked past the piles touching it. Measured over
 *     three seeds, a settler standing on a pickup could have taken more than twice
 *     what they were sent for without moving a step.
 *   - A frame was supplied with exactly what it was short of, so a ten-segment wall
 *     was ten round trips to the same woodpile.
 *
 * A third has since joined them, for the same reason and from the same kind of
 * measurement, once the valley grew to 192 and the sum stopped working:
 *
 *   - A hauler crossed the moor for whatever was nearest, however little of it
 *     there was. Nearest-haulable was standing in for worth-hauling, which are the
 *     same thing only on a map with no far corner.
 *
 * The end of the file is the one that matters to a player: the colony is up and
 * building inside its first week, on every seed measured.
 */

import { describe, expect, it } from 'vitest';

import { buildingAt, dist, isWalkable } from '../src/sim/grid';
import { setPriority } from '../src/sim/orders';
import { assignJob } from '../src/sim/jobs';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';
import { TERRAIN_LIST, TICKS_PER_DAY, WORK_TYPES, packCell } from '../src/sim/types';
import type { Cell, JobKind, Pawn, World } from '../src/sim/types';
import { addBuilding, addItem, itemsAt, livingColonists, removeBuilding } from '../src/sim/world';

/**
 * The starter world with the ground swept: these tests count stacks by hand, and
 * worldgen's scatter would put wood in the answer that nobody put there.
 */
function swept(seed = 20260729): World {
  const world = createWorld(seed);
  world.items.length = 0;
  for (const p of world.pawns) p.carryingItemId = null;
  return world;
}

/** One settler, awake, with a single kind of work on their board and nothing else. */
function soleWorker(world: World, work: (typeof WORK_TYPES)[number]): Pawn {
  const crew = livingColonists(world);
  for (const p of crew) for (const w of WORK_TYPES) setPriority(world, p.id, w, 0);
  const hand = crew[0]!;
  setPriority(world, hand.id, work, 1);
  return hand;
}

/**
 * Open ground `d` cells out from the hearth, walking round the compass until it
 * finds some. Written as a search rather than as coordinates because the valley
 * has grown once already and a hard-coded cell forty paces out lands in rock on
 * plenty of seeds — see the note in `stockpile.test.ts` about exactly that.
 */
function openAt(world: World, d: number, skip = 0): Cell {
  let seen = 0;
  for (let a = 0; a < 16; a++) {
    const x = HOME_X + Math.round(d * Math.cos((a * Math.PI) / 8));
    const y = HOME_Y + Math.round(d * Math.sin((a * Math.PI) / 8));
    if (!isWalkable(world, x, y)) continue;
    if (!isWalkable(world, x + 1, y) || !isWalkable(world, x, y + 1)) continue;
    if (seen++ < skip) continue;
    return { x, y };
  }
  throw new Error(`no open ground ${d} cells out`);
}

/** Step the world, counting how many jobs of one kind were ever started. */
function runCounting(world: World, ticks: number, kind: JobKind): number {
  const streams = makeStreams(world);
  const seen = new Set<number>();
  let n = 0;
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, streams);
    for (const j of world.jobs) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      if (j.kind === kind) n++;
    }
  }
  return n;
}

/**
 * The wood still lying on a cell.
 *
 * These tests ask what left the heap rather than what arrived in the stockpile,
 * and the reason is worth a line: the starter generator burns wood. Counting the
 * pile at the end of a day reads six short every time, and none of those six went
 * missing — they went up the chimney. What the feature promises is a hauler who
 * clears the ground in one trip, so that is what gets measured.
 */
function woodAt(world: World, c: Cell): number {
  let n = 0;
  for (const s of itemsAt(world, c.x, c.y)) if (s.kind === 'wood') n += s.amount;
  return n;
}

describe('an armful, not a handful', () => {
  it('sweeps up the piles beside the one it was sent for, in a single trip', () => {
    // Three heaps of wood touching each other, the length of the yard away. The
    // old hauler made this three round trips because the job it was given named
    // one stack; the point of the change is that a settler already stood over a
    // felled tree can see the rest of it.
    const world = swept();
    const spot = openAt(world, 12);
    addItem(world, 'wood', 15, spot.x, spot.y);
    addItem(world, 'wood', 15, spot.x + 1, spot.y);
    addItem(world, 'wood', 15, spot.x, spot.y + 1);
    soleWorker(world, 'haul');

    const trips = runCounting(world, TICKS_PER_DAY, 'haulToStockpile');

    expect(trips).toBe(1);
    // One trip, and all three heaps went with it.
    expect(woodAt(world, spot)).toBe(0);
    expect(woodAt(world, { x: spot.x + 1, y: spot.y })).toBe(0);
    expect(woodAt(world, { x: spot.x, y: spot.y + 1 })).toBe(0);
  });

  it('leaves alone what another settler has already claimed', () => {
    // The guard that keeps two haulers from both loading up for the same pile.
    // Without it the second settler arrives at a heap that has walked off.
    const world = swept();
    const spot = openAt(world, 12);
    addItem(world, 'wood', 15, spot.x, spot.y);
    const spoken = addItem(world, 'wood', 15, spot.x + 1, spot.y)!;
    spoken.reservedBy = 999_999;
    soleWorker(world, 'haul');

    runCounting(world, TICKS_PER_DAY, 'haulToStockpile');

    // Still lying where it was, still whole — while the heap beside it went.
    expect(spoken.amount).toBe(15);
    expect(spoken.carriedBy).toBeNull();
    expect(woodAt(world, { x: spot.x + 1, y: spot.y })).toBe(15);
    expect(woodAt(world, spot)).toBe(0);
  });

  it('does not reach over a wall', () => {
    // The whole feature is "a settler stoops and sweeps up what is beside them",
    // and the failure mode is that it becomes "a settler collects from wherever
    // they can see". Five cells of wall, a heap on each side, and the far heap is
    // two cells away in a straight line but a long walk round the end. Nothing on
    // the far side may move.
    //
    // The wall runs north-south with the far heap *outside* it, which used to be
    // east-west with the far heap to the north and is the difference between this
    // test working and only appearing to. `openAt(world, 14)` returns ground due
    // east of the hearth, so a heap two cells north of it is fourteen paces from
    // home and the heap it is meant to be hidden behind is fourteen paces from
    // home, and which one a hauler walks to first is down to the seed. On the 128
    // map they went for the near one; at 192 they went for the far one, took it
    // home, came back for the near one — perfectly correct hauling — and the test
    // read the far heap sitting in the stockpile and called it reaching over a
    // wall. Put the wall between the colony and the far heap and the order is not
    // in question: the near heap is on the way and the far one is behind it.
    const world = swept();
    const spot = openAt(world, 14);
    const grass = TERRAIN_LIST.indexOf('grass');
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = 0; dx <= 2; dx++) {
        world.terrain[packCell(world, spot.x + dx, spot.y + dy)] = grass;
        const there = buildingAt(world, spot.x + dx, spot.y + dy);
        if (there) removeBuilding(world, there);
      }
    }
    for (let dy = -2; dy <= 2; dy++) addBuilding(world, 'wall', spot.x + 1, spot.y + dy, true);
    addItem(world, 'wood', 15, spot.x, spot.y);
    const beyond = addItem(world, 'wood', 15, spot.x + 2, spot.y)!;
    soleWorker(world, 'haul');

    // The clock stops when the near heap leaves the ground, because that instant
    // *is* the sweep and what is lying on the far side of the wall at that moment
    // is the whole question.
    //
    // This used to run half a day and then look, which passed for a year and was
    // never testing what it says. Give a hauler half a day and they finish the
    // trip, walk round the end of a five-cell wall and come back for the far heap
    // — which is right, and says nothing whatever about reaching over a wall. On
    // the 128 map the walk round happened not to fit in the budget; at 192 the
    // heaps land somewhere the walk does fit, and a test of the sweep went red
    // over a settler doing exactly the correct thing.
    const streams = makeStreams(world);
    let swung = 0;
    for (let t = 1; t <= TICKS_PER_DAY / 2 && swung === 0; t++) {
      stepWorld(world, streams);
      if (woodAt(world, spot) === 0) swung = t;
    }
    expect(swung, 'nobody ever came for the near heap').toBeGreaterThan(0);

    expect(beyond.amount).toBe(15);
    expect(beyond.x).toBe(spot.x + 2);
    expect(beyond.y).toBe(spot.y);
  });
});

describe('a supply run, not a shuttle', () => {
  it('carries enough for the whole run of frames in one trip', () => {
    // Four wall frames in a line — twenty wood between them — and one woodpile.
    // The old builder fetched five, laid it down, and walked back for the next
    // five, which is the shape of every wall anybody has ever ordered in this
    // game. One trip is the whole claim.
    const world = swept();
    const line = openAt(world, 10);
    for (let i = 0; i < 4; i++) addBuilding(world, 'wall', line.x, line.y + i, false);
    addItem(world, 'wood', 60, HOME_X + 2, HOME_Y);
    soleWorker(world, 'construct');

    const trips = runCounting(world, TICKS_PER_DAY, 'haulToBlueprint');

    expect(trips).toBe(1);
    // And the run actually landed: every frame has its wood.
    for (const b of world.buildings) {
      if (b.kind !== 'wall' || b.built) continue;
      if (b.x !== line.x) continue;
      expect(b.have.wood ?? 0).toBe(5);
    }
  });

  it('puts the surplus down when the run ends rather than carrying it about', () => {
    // A settler who has supplied the last frame is holding whatever is left over.
    // Keeping hold of it is the bug this guards: the wood is then invisible to
    // every other job in the colony for as long as that settler lives.
    const world = swept();
    const line = openAt(world, 10);
    addBuilding(world, 'wall', line.x, line.y, false);
    addItem(world, 'wood', 60, HOME_X + 2, HOME_Y);
    const hand = soleWorker(world, 'construct');

    runCounting(world, TICKS_PER_DAY, 'haulToBlueprint');

    expect(hand.carryingItemId).toBeNull();
  });
});

/**
 * Why a frame wanting wood still beats a frame that could go up now.
 *
 * `tryWorkType`'s `construct` branch walks the frames nearest-first and takes the
 * first one it can do *anything* about — fetch for it or raise it, whichever that
 * frame happens to need. Round 3c tried to rank the two errands instead, on
 * `probe-dispatch`'s finding that haul time met or beat build time in eighteen of
 * the nineteen ambitions the Steward ever opened, `floors` at 60% hauling against
 * no build time at all, and hauling taking 17.91% of every colony day.
 *
 * Both ways of ranking them measured worse than not ranking them, on the full
 * suite:
 *
 *   - Raising above fetching outright, nine failures: `roomsPerDay` fell from 0.03
 *     to nothing on harsh/99001, and on the three-week 20260729 eval the colony
 *     raised 6.14 buildings a day, finished no turret at all and ended two of six
 *     standing. The Steward's fence stopped at its first batch of eight where it
 *     reaches twenty-four, and a month-old colony had no wood left anywhere. A
 *     settler who will cross the map for any supplied frame stops finishing the
 *     cluster in front of them, so walls go up scattered and no enclosure closes.
 *   - Raising only when it is the shorter walk — the frame against the
 *     stack-and-back round trip — gave the enclosures and the turrets back
 *     (`roomsPerDay` 0.03 again, the wood back on the map) and still cut
 *     `builtPerDay` from 4.8 to 2.8. Six failures rather than nine.
 *
 * Because the ratio was never a dispatch defect. A wall costs its wood and one
 * build action, so several trips per raising is arithmetic, and labour moved off
 * fetching is labour moved off the thing actually gating the build. 3b had already
 * said so from the other side: `idleTakeableShare` 1.02%, and the assignment
 * cadence declining 83% of the times it fired because there was genuinely nothing
 * for that settler to take. The board is empty, not mis-ordered.
 *
 * So these two pin the rule that survived, and each one fails under one of the
 * alternatives above. Nearest first, and what that frame needs is not a tiebreak.
 */
describe('the nearest frame wins, whichever of the two errands it wants', () => {
  /** Only the frames a test puts down, so worldgen's own are not in the answer. */
  function onlyPlantedFrames(world: World): void {
    for (const b of [...world.buildings]) if (!b.built) removeBuilding(world, b);
  }

  /**
   * Bare ground about `want` cells out, with its eastern neighbour bare too so a
   * pile can go down beside a frame. `openAt` above only asks whether a cell can
   * be walked on, and four cells from the hearth that is true of ground the
   * starter cabin is already standing on — `addBuilding` returns null there.
   */
  function bareAt(world: World, want: number): Cell {
    for (let r = want; r < want + 8; r++) {
      for (let a = 0; a < 32; a++) {
        const x = HOME_X + Math.round(r * Math.cos((a * Math.PI) / 16));
        const y = HOME_Y + Math.round(r * Math.sin((a * Math.PI) / 16));
        if (!isWalkable(world, x, y) || buildingAt(world, x, y)) continue;
        if (!isWalkable(world, x + 1, y) || buildingAt(world, x + 1, y)) continue;
        return { x, y };
      }
    }
    throw new Error(`no bare ground about ${want} cells out`);
  }

  /** One settler at the hearth with construct work, no need pressing. */
  function builderAtHome(world: World): Pawn {
    const hand = soleWorker(world, 'construct');
    hand.needs.food = 1;
    hand.needs.rest = 1;
    hand.needs.recreation = 1;
    hand.x = HOME_X;
    hand.y = HOME_Y;
    return hand;
  }

  it('fetches for the near frame rather than raise a supplied one across the yard', () => {
    const world = swept();
    onlyPlantedFrames(world);
    const hand = builderAtHome(world);

    const near = bareAt(world, 4);
    const far = bareAt(world, 20);
    const wanting = addBuilding(world, 'wall', near.x, near.y, false);
    const supplied = addBuilding(world, 'wall', far.x, far.y, false);
    expect(wanting).not.toBeNull();
    expect(supplied).not.toBeNull();
    supplied!.have = { ...supplied!.needs };
    addItem(world, 'wood', 20, near.x + 1, near.y);

    assignJob(world, hand);

    // Ranking raising above fetching sent the settler out to the far frame here,
    // and that is what emptied the neighbourhood the enclosures were being closed
    // in.
    const job = world.jobs.find((j) => j.id === hand.jobId);
    expect(job?.kind).toBe('haulToBlueprint');
    expect(job?.buildingId).toBe(wanting!.id);
  });

  it('fetches for the near frame even when the wood is the longer walk', () => {
    const world = swept();
    onlyPlantedFrames(world);
    const hand = builderAtHome(world);

    const near = bareAt(world, 4);
    const mid = bareAt(world, 10);
    const pile = bareAt(world, 18);
    const wanting = addBuilding(world, 'wall', near.x, near.y, false);
    const supplied = addBuilding(world, 'wall', mid.x, mid.y, false);
    expect(wanting).not.toBeNull();
    expect(supplied).not.toBeNull();
    supplied!.have = { ...supplied!.needs };
    addItem(world, 'wood', 20, pile.x, pile.y);

    // The wood for the near frame is out past the supplied one, so fetching is by
    // some way the longer walk — which is the case the shorter-walk rule was built
    // to catch, and it is still the fetch the colony wants. The trips are what the
    // raising is waiting on.
    const raiseWalk = dist(hand.x, hand.y, supplied!.x, supplied!.y);
    const fetchWalk =
      dist(hand.x, hand.y, pile.x, pile.y) + dist(pile.x, pile.y, wanting!.x, wanting!.y);
    expect(raiseWalk).toBeLessThan(fetchWalk);

    assignJob(world, hand);

    const job = world.jobs.find((j) => j.id === hand.jobId);
    expect(job?.kind).toBe('haulToBlueprint');
    expect(job?.buildingId).toBe(wanting!.id);
  });
});

describe('what it is worth to the colony', () => {
  it('has a colony up and building by the end of the first week', () => {
    // The measurement the whole file is for, and the only one a player would ever
    // notice. Nothing is set up here: it is the ordinary opening of the game on
    // the ordinary seed.
    //
    // Before the two changes this seed finished 37 buildings in three days and its
    // settlers spent 28 280 ticks walking. After, 66 and 22 576 — a fifth less
    // legwork and most of half again as much colony, and the floor went in at 50.
    //
    // It is a week now rather than three days, and the reason is that the floor
    // had quietly stopped meaning what it says. Three days on this seed reads 34
    // at 192 and 49 at 128 — so the same code cannot clear 50 on the map the
    // number was set against either, and most of the loss is a year of balance
    // changes rather than the map: wildlife, predators, a food chain to hunt, and
    // settlers who now stop to eat and to sit by a fire. A floor that only passes
    // on the build it was born in is a changelog, not a test.
    //
    // So it asks the thing it was always for — that the colony is *working*, and
    // that the two hauling levers are still plugged in — over a span long enough
    // that a bad day does not decide it. Six days reads 82, 75 and 71 on seeds
    // 20260729, 424242 and 1337, so 55 is a floor with room under it rather than
    // a number to come and update. There is no ceiling: "built more than expected"
    // is not a bug anybody wants a red suite for.
    const world = createWorld(20260729);
    const streams = makeStreams(world);
    for (let t = 0; t < TICKS_PER_DAY * 6; t++) stepWorld(world, streams);

    expect(world.stats.built).toBeGreaterThan(55);
  });
});
