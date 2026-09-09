/**
 * Nobody gets walled in.
 *
 * Functional: the doorway rule, at placement and at the moment a frame is
 * finished. Experience: seed 99001 played forward past the day the colony used
 * to cut itself in half, checked the way a player would notice it — is everybody
 * still in the same world, and did the kitchen keep running.
 */

import { describe, expect, it } from 'vitest';

import { defOf } from '../src/sim/buildings';
import { stewardTick } from '../src/eval/steward';
import { assignJob, createJob } from '../src/sim/jobs';
import { buildingAt, isWalkable, wouldBlockDoorway } from '../src/sim/grid';
import { canPlace, placeBlueprint, setPriority } from '../src/sim/orders';
import { CONNECTIVITY_INTERVAL, tickConnectivity, wouldSealColony } from '../src/sim/connectivity';
import { roomAt } from '../src/sim/rooms';
import { planBlueprint } from '../src/sim/stranded';
import { regionAt } from '../src/sim/regions';
import { makeStreams, stepWorld } from '../src/sim/tick';
import {
  DESIG_DECONSTRUCT,
  DESIG_NONE,
  TERRAIN_LIST,
  TICKS_PER_DAY,
  WORK_TYPES,
  packCell,
} from '../src/sim/types';
import type { World } from '../src/sim/types';
import { addBuilding, addItem, countResource, livingColonists, takeResource } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

/** Bare grass with nothing standing on it, so the test is about the rule. */
function clear(world: World, x0: number, y0: number, x1: number, y1: number): void {
  const grass = TERRAIN_LIST.indexOf('grass');
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const b = buildingAt(world, x, y);
      if (b) {
        world.cellBuilding[packCell(world, x, y)] = -1;
        world.buildings = world.buildings.filter((o) => o.id !== b.id);
      }
      world.terrain[packCell(world, x, y)] = grass;
      world.cellDesig[packCell(world, x, y)] = DESIG_NONE;
    }
  }
}

/**
 * A one-cell room at (20,20) with its only door at (20,21) facing south.
 *
 *      # # #        y=19
 *      # . #        y=20   <- the room
 *      # D #        y=21   <- the door
 *            (22)          y=22 is open ground
 */
function roomWithDoor(world: World): void {
  clear(world, 17, 17, 24, 24);
  for (const [x, y] of [
    [19, 19],
    [20, 19],
    [21, 19],
    [19, 20],
    [21, 20],
    [19, 21],
    [21, 21],
  ] as const) {
    addBuilding(world, 'wall', x, y, true);
  }
  addBuilding(world, 'door', 20, 21, true);
}

describe('doorways stay open', () => {
  it('refuses a solid building on the open side of a door', () => {
    const world = createWorld(1234);
    roomWithDoor(world);
    // 20,22 is the doorstep: block it and the door leads nowhere.
    expect(wouldBlockDoorway(world, 20, 22)).toBe(true);
    expect(canPlace(world, 'sandbag', 20, 22)).toBe('doorway');
    expect(canPlace(world, 'wall', 20, 22)).toBe('doorway');
    expect(placeBlueprint(world, 'sandbag', 20, 22)).toBe(false);
  });

  it('allows everything that is not actually in the way', () => {
    const world = createWorld(1234);
    roomWithDoor(world);
    // One cell further out, and either side of the doorstep: all fine.
    expect(canPlace(world, 'sandbag', 20, 23)).toBe('ok');
    expect(canPlace(world, 'sandbag', 19, 22)).toBe('ok');
    expect(canPlace(world, 'sandbag', 21, 22)).toBe('ok');
    // And a non-solid thing on the doorstep itself is not blocking anything —
    // the rule is about what you can walk through, not about what is there.
    expect(defOf('conduit').solid).toBe(false);
    expect(canPlace(world, 'conduit', 20, 22)).toBe('ok');
  });

  it('does not fence off a free-standing door', () => {
    const world = createWorld(1234);
    clear(world, 17, 17, 24, 24);
    addBuilding(world, 'door', 20, 21, true);
    // A door in the open has four ways round it; taking one is not sealing it.
    expect(wouldBlockDoorway(world, 20, 22)).toBe(false);
    expect(canPlace(world, 'sandbag', 20, 22)).toBe('ok');
  });

  it('cancels a frame that became a doorstep after it was pegged out', () => {
    const world = createWorld(1234);
    clear(world, 17, 17, 24, 24);
    // Legal when it is placed: there is no door yet.
    expect(placeBlueprint(world, 'wall', 20, 22)).toBe(true);
    const frame = buildingAt(world, 20, 22)!;
    frame.have = { ...frame.needs };
    // Now the room goes up around it, and finishing the frame would seal the door.
    roomWithDoorAround(world);
    const pawn = livingColonists(world)[0]!;
    pawn.x = 20;
    pawn.y = 23;
    pawn.path = null;
    finishFrame(world, frame.id);
    expect(buildingAt(world, 20, 22)).toBe(null);
    expect(isWalkable(world, 20, 22)).toBe(true);
    // The steel does not evaporate with the order.
    expect(world.items.some((i) => i.x === 20 && i.y === 22)).toBe(true);
  });
});

/** The room from `roomWithDoor`, laid around an existing frame at 20,22. */
function roomWithDoorAround(world: World): void {
  for (const [x, y] of [
    [19, 19],
    [20, 19],
    [21, 19],
    [19, 20],
    [21, 20],
    [19, 21],
    [21, 21],
  ] as const) {
    addBuilding(world, 'wall', x, y, true);
  }
  addBuilding(world, 'door', 20, 21, true);
}

/** Run the frame's own completion path rather than flipping `built` by hand. */
function finishFrame(world: World, id: number): void {
  const b = world.buildings.find((o) => o.id === id)!;
  // One swing short of done, so the very next tick of the real job pass lands on
  // the completion branch — which is the branch under test.
  b.work = b.workLeft - 0.01;
  const pawn = livingColonists(world)[0]!;
  createJob(world, pawn, 'build', b.x, b.y, { buildingId: b.id });
  const streams = makeStreams(world);
  for (let i = 0; i < 8 && world.buildings.some((o) => o.id === id && !o.built); i++) {
    stepWorld(world, streams);
  }
}

/**
 * A sealed box from (10,10) to (30,30) with a wall straight down x=20 — two
 * rooms with no way between them and no way out, which is the shape of the bug:
 * settlers on both sides of something nobody meant to build.
 */
function dividedBox(world: World): void {
  for (let y = 10; y <= 30; y++) {
    addBuilding(world, 'wall', 10, y, true);
    addBuilding(world, 'wall', 20, y, true);
    addBuilding(world, 'wall', 30, y, true);
  }
  for (let x = 10; x <= 30; x++) {
    if (!buildingAt(world, x, 10)) addBuilding(world, 'wall', x, 10, true);
    if (!buildingAt(world, x, 30)) addBuilding(world, 'wall', x, 30, true);
  }
}

describe('the connectivity watchdog', () => {
  it('marks the wall between two groups of settlers for removal', () => {
    const world = createWorld(1234);
    clear(world, 10, 10, 30, 30);
    dividedBox(world);
    const colonists = livingColonists(world);
    expect(colonists.length).toBeGreaterThanOrEqual(3);
    colonists.forEach((p, i) => {
      p.x = i === 0 ? 15 : 25;
      p.y = 20;
      p.path = null;
      p.jobId = null;
    });
    // A stove and a bed on the big group's side of the divide. The box seals the
    // colony's own kitchen and bunks off from everybody, and the essentials pass
    // would (correctly) start knocking holes in the outer wall to get to them —
    // which is a different rule, tested below, and would leave this test with
    // three marked cells and two reasons to fail.
    addBuilding(world, 'stove', 25, 22, true);
    addBuilding(world, 'bed', 26, 22, true);
    // The two halves are only separated if the region index says so.
    expect(regionAt(world, 15, 20)).not.toBe(regionAt(world, 25, 20));

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    // Something on the boundary is now marked to come down, and it is on the
    // wall between them rather than somewhere arbitrary.
    const marked: Array<{ x: number; y: number }> = [];
    for (let y = 10; y <= 30; y++) {
      for (let x = 10; x <= 30; x++) {
        if (world.cellDesig[packCell(world, x, y)] === DESIG_DECONSTRUCT) marked.push({ x, y });
      }
    }
    expect(marked.length).toBe(1);
    expect(marked[0]!.x).toBe(20);
    expect(world.messages.some((m) => m.text.includes('walled off'))).toBe(true);
  });

  it('says nothing while everybody can reach everybody', () => {
    const world = createWorld(1234);
    const before = world.messages.length;
    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);
    expect(world.messages.length).toBe(before);
    let marked = 0;
    for (let i = 0; i < world.cellDesig.length; i++) {
      if (world.cellDesig[i] === DESIG_DECONSTRUCT) marked++;
    }
    expect(marked).toBe(0);
  });

  it('pulls the wall down and puts the colony back together', () => {
    const world = createWorld(1234);
    clear(world, 10, 10, 30, 30);
    dividedBox(world);
    const colonists = livingColonists(world);
    colonists.forEach((p, i) => {
      p.x = i === 0 ? 15 : 25;
      p.y = 20;
      p.path = null;
      p.jobId = null;
      p.drafted = false;
    });
    const streams = makeStreams(world);
    // Long enough for the watchdog to notice and for somebody to walk over and
    // do the work — no hand-placed jobs, the ordinary assignment pass finds it.
    for (let i = 0; i < 20 * 90 && regionAt(world, 15, 20) !== regionAt(world, 25, 20); i++) {
      stepWorld(world, streams);
    }
    expect(regionAt(world, 15, 20)).toBe(regionAt(world, 25, 20));
  });
});

/** Take every one of a kind off the map, so the fixture is the only one there is. */
function stripKind(world: World, keep: (kind: string) => boolean): void {
  for (const b of world.buildings.filter((o) => !keep(o.kind))) {
    world.cellBuilding[packCell(world, b.x, b.y)] = -1;
  }
  world.buildings = world.buildings.filter((o) => keep(o.kind));
}

/** A sealed 3×3 room at 40..44 with one thing standing in the middle of it. */
function sealedRoom(world: World, kind: 'stove' | 'bed'): void {
  clear(world, 36, 36, 56, 56);
  for (let i = 40; i <= 44; i++) {
    addBuilding(world, 'wall', i, 40, true);
    addBuilding(world, 'wall', i, 44, true);
    addBuilding(world, 'wall', 40, i, true);
    addBuilding(world, 'wall', 44, i, true);
  }
  addBuilding(world, kind, 42, 42, true);
}

/** Everybody stood outside the room, idle, so the watchdog is the only actor. */
function outside(world: World): void {
  livingColonists(world).forEach((p, i) => {
    p.x = 50 + i;
    p.y = 50;
    p.path = null;
    p.jobId = null;
  });
}

function deconstructCount(world: World): number {
  let n = 0;
  for (let i = 0; i < world.cellDesig.length; i++) {
    if (world.cellDesig[i] === DESIG_DECONSTRUCT) n++;
  }
  return n;
}

/**
 * The stove standing *in* the wall rather than behind it: a three-cell pocket
 * along y=42, sealed by two courses of wall on every side but the east, where the
 * only thing between the pocket and the yard is the stove.
 *
 * Two courses is the whole fixture. `openTheWay` prefers a cell that touches both
 * halves at once and finishes the job in one order, and with a single course
 * there is always such a cell, so the stove is never the shortest way through.
 * Seal it twice and no one-cell crossing exists anywhere, which drops the pass
 * back to its other rule — the piece of the boundary nearest the people on the
 * other side — and the stove, sitting in the near face, is nearest. That is the
 * shape seed 99001 built for itself on day ten with a fence line.
 */
function stoveInTheGap(world: World): void {
  clear(world, 36, 36, 56, 56);
  for (let x = 39; x <= 46; x++) {
    for (const y of [40, 41, 43, 44]) addBuilding(world, 'wall', x, y, true);
  }
  addBuilding(world, 'wall', 39, 42, true);
  addBuilding(world, 'wall', 40, 42, true);
  addBuilding(world, 'wall', 45, 42, true);
  addBuilding(world, 'stove', 44, 42, true);
}

describe('the colony can always reach its own stove and beds', () => {
  it('opens a way to a stove that has been sealed in', () => {
    const world = createWorld(1234);
    stripKind(world, (k) => k !== 'stove');
    sealedRoom(world, 'stove');
    outside(world);

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    expect(deconstructCount(world)).toBe(1);
    expect(world.messages.some((m) => m.text.includes('The stove is walled off'))).toBe(true);
  });

  it('does not take the stove apart to reach the stove', () => {
    const world = createWorld(1234);
    stripKind(world, (k) => k !== 'stove');
    stoveInTheGap(world);
    livingColonists(world).forEach((p, i) => {
      p.x = 50 + i;
      p.y = 42;
      p.path = null;
      p.jobId = null;
    });

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    // It still sees the kitchen is cut off and still opens a way in.
    expect(world.messages.some((m) => m.text.includes('The stove is walled off'))).toBe(true);
    // Through the wall, not through the stove. The nearest removable thing to the
    // settlers is the stove itself, and the pass used to take it: a deconstruct
    // leaves no rebuild plan and nothing in the game ever plans a stove, so a
    // repair carried out on the colony's behalf cost it its kitchen for the rest
    // of the run. Seed 99001 grew this exact shape on day ten and starved on day
    // twenty-seven with two hundred units of raw food in the larder.
    expect(buildingAt(world, 44, 42)?.kind, 'the stove itself was marked').toBe('stove');
    expect(world.cellDesig[packCell(world, 44, 42)]).toBe(DESIG_NONE);
    const down = world.buildings.filter((b) => world.cellDesig[packCell(world, b.x, b.y)] === DESIG_DECONSTRUCT);
    expect(down.map((b) => b.kind)).toEqual(['wall']);
  });

  it('says nothing when one bed is stranded and the others are not', () => {
    const world = createWorld(1234);
    stripKind(world, (k) => k !== 'bed' && k !== 'medbed');
    sealedRoom(world, 'bed');
    // A second bed out in the open — the colony has somewhere to sleep, so the
    // one in the half-built wing is the player's business, not an emergency.
    addBuilding(world, 'bed', 50, 52, true);
    outside(world);
    const before = world.messages.length;

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    expect(deconstructCount(world)).toBe(0);
    expect(world.messages.length).toBe(before);
  });

  it('does not go to work when there is no stove at all', () => {
    const world = createWorld(1234);
    stripKind(world, (k) => k !== 'stove' && k !== 'bed' && k !== 'medbed');
    outside(world);

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    expect(deconstructCount(world)).toBe(0);
  });
});

/**
 * A fenced yard from (14,14) to (30,30) with the colony, a stove and a bed inside
 * it, and nothing else on the map — so the stove and bed rules are satisfied and
 * the only thing left to notice is the fence itself. `gate` lists the cells left
 * out of the southern run.
 */
function fencedYard(world: World, gate: number[] = []): void {
  stripKind(world, () => false);
  clear(world, 10, 10, 36, 36);
  for (let i = 14; i <= 30; i++) {
    if (!buildingAt(world, i, 14)) addBuilding(world, 'fence', i, 14, true);
    if (!gate.includes(i) && !buildingAt(world, i, 30)) addBuilding(world, 'fence', i, 30, true);
    if (!buildingAt(world, 14, i)) addBuilding(world, 'fence', 14, i, true);
    if (!buildingAt(world, 30, i)) addBuilding(world, 'fence', 30, i, true);
  }
  addBuilding(world, 'stove', 18, 18, true);
  addBuilding(world, 'bed', 20, 18, true);
  livingColonists(world).forEach((p, i) => {
    p.x = 20 + (i % 4);
    p.y = 22;
    p.path = null;
    p.jobId = null;
    p.drafted = false;
  });
}

/**
 * The same yard, with the colony's cold store set into the west side of it.
 *
 * The shape the Steward built for itself on seed 4242, and the reason there is a
 * fourth question in `openTheWay`. A pantry cut into the perimeter has an outer
 * wall that is two things at once: the shell holding a week of food at minus five,
 * and the shortest crossing between the settlers and the rest of the map. Nearest
 * wins, so nearest is what the pass took.
 *
 * Walled and not fenced, because a fence is 1.15 m and encloses nothing — put one
 * round a cooler and there is no room, no cold, and nothing here to prefer.
 *
 *      13   14   15   16          x
 *   21  .   f    W    .           <- pantry north wall
 *   22  .   W    .    D           <- outer wall, floor, door onto the yard
 *   23  .   W    C    W           <- outer wall, the cooler, wall
 *   24  .   f    W    .           <- pantry south wall
 */
function coldStoreInTheFence(world: World): void {
  fencedYard(world);
  clear(world, 14, 22, 14, 23);
  for (const [x, y] of [
    [14, 22],
    [14, 23],
    [15, 21],
    [15, 24],
    [16, 23],
  ]) {
    addBuilding(world, 'wall', x!, y!, true);
  }
  addBuilding(world, 'door', 16, 22, true);
  addBuilding(world, 'cooler', 15, 23, true);
}

describe('the colony can always reach the rest of the map', () => {
  it('opens a way out of a yard with no gate in it', () => {
    const world = createWorld(1234);
    fencedYard(world);
    // Everybody together, warm, fed and in a box: every other rule in this file
    // is satisfied, which is exactly how seed 424242 stood still for nineteen days.
    expect(new Set(livingColonists(world).map((p) => regionAt(world, Math.round(p.x), Math.round(p.y)))).size).toBe(1);

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    expect(deconstructCount(world)).toBe(1);
    expect(world.messages.some((m) => m.text.includes('sealed in'))).toBe(true);
  });

  it('leaves a yard that has a gate in it alone', () => {
    const world = createWorld(1234);
    fencedYard(world, [21, 22, 23]);
    const before = world.messages.length;

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    expect(deconstructCount(world)).toBe(0);
    expect(world.messages.length).toBe(before);
  });

  it('does not knock a hole in the wall in the middle of a raid', () => {
    const world = createWorld(1234);
    fencedYard(world);
    // Shutting the gate and sitting behind it is a real answer to a raid. Helping
    // with that by opening the wall is not help.
    world.pawns.push({ ...livingColonists(world)[0]!, id: 99001, faction: 'raider' as const, x: 40, y: 40 });

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    expect(deconstructCount(world)).toBe(0);
  });

  it('opens the yard somewhere other than the wall of the cold store', () => {
    const world = createWorld(1234);
    coldStoreInTheFence(world);
    // The fixture says nothing unless the pantry is a room. A cooler standing in
    // the open holds no air, and a preference over a shell that does not exist
    // would pass this test by accident on the day the fix was removed.
    expect(roomAt(world, 15, 22)).not.toBeNull();
    expect(roomAt(world, 15, 22)!.id).toBe(roomAt(world, 15, 23)!.id);

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    expect(deconstructCount(world)).toBe(1);
    expect(world.messages.some((m) => m.text.includes('sealed in'))).toBe(true);
    // Both faces of the freezer left standing — (14,22) is the nearest cell on
    // the whole boundary to where the settlers are stood, and it is the one the
    // pass used to take.
    expect(world.cellDesig[packCell(world, 14, 22)]).toBe(DESIG_NONE);
    expect(world.cellDesig[packCell(world, 14, 23)]).toBe(DESIG_NONE);
    expect(world.cellDesig[packCell(world, 15, 21)]).toBe(DESIG_NONE);
    expect(world.cellDesig[packCell(world, 15, 24)]).toBe(DESIG_NONE);
    // What came down instead: a plain fence further along the same wall, one more
    // twenty-second pass away and worth every second of it.
    const marked = [...world.cellDesig].findIndex((d) => d !== DESIG_NONE);
    expect(buildingAt(world, marked % world.width, Math.floor(marked / world.width))!.kind).toBe('fence');
  });

  it('takes the cold store apart anyway when its shell is the only way out', () => {
    const world = createWorld(1234);
    stripKind(world, () => false);
    clear(world, 36, 36, 56, 56);
    // Everyone shut inside the freezer itself, so every cell of the boundary is
    // the shell. A preference that were secretly a refusal would leave them in
    // there for good, which is worse than a thawed larder by some distance.
    for (let i = 40; i <= 44; i++) {
      addBuilding(world, 'wall', i, 40, true);
      addBuilding(world, 'wall', i, 44, true);
      addBuilding(world, 'wall', 40, i, true);
      addBuilding(world, 'wall', 44, i, true);
    }
    addBuilding(world, 'cooler', 42, 42, true);
    livingColonists(world).forEach((p, i) => {
      p.x = 41 + (i % 3);
      p.y = 41;
      p.path = null;
      p.jobId = null;
      p.drafted = false;
    });
    expect(roomAt(world, 42, 41)).not.toBeNull();

    world.tick = CONNECTIVITY_INTERVAL;
    tickConnectivity(world);

    expect(deconstructCount(world)).toBe(1);
    expect(world.messages.some((m) => m.text.includes('sealed in'))).toBe(true);
  });

  it('refuses the planner the last cell of a box', () => {
    const world = createWorld(1234);
    fencedYard(world, [21, 22, 23]);
    // The seed 424242 shape exactly: a three-cell gate, and a defence line one row
    // further out. Nothing here is next to a door, so `wouldBlockDoorway` — which
    // is the only guard on the placement path — has nothing to say about any of it.
    addBuilding(world, 'sandbag', 21, 31, true);
    addBuilding(world, 'sandbag', 22, 31, true);
    expect(wouldBlockDoorway(world, 23, 31)).toBe(false);
    expect(canPlace(world, 'sandbag', 23, 31)).toBe('ok');

    // The third one closes it: the gate cells stay walkable, but every way out of
    // them is a diagonal between the fence and a sandbag, which nothing can cut.
    expect(wouldSealColony(world, 23, 31)).toBe(true);
    expect(planBlueprint(world, 'sandbag', 23, 31)).toBe(false);
    // Out in the open, well clear of the gate, the same building is fine.
    expect(wouldSealColony(world, 26, 33)).toBe(false);
    expect(planBlueprint(world, 'sandbag', 26, 33)).toBe(true);
  });

  it('still lets the player build it', () => {
    const world = createWorld(1234);
    fencedYard(world, [21, 22, 23]);
    addBuilding(world, 'sandbag', 21, 31, true);
    addBuilding(world, 'sandbag', 22, 31, true);
    // The reaper's rule, one level up: a player who walls themselves in has done
    // something, and the watchdog will come and open it again. A planner that does
    // it has only made a mistake.
    expect(placeBlueprint(world, 'sandbag', 23, 31)).toBe(true);
  });
});

/**
 * A cook stood next to a stove and a full sack, with `walledRot` sealed away in
 * the 3×3 room at 40..44 — or nothing sealed away at all when it is null.
 *
 * Cook or nothing on every settler's board, so the answer to "did the kitchen
 * open" is the job kind and not a guess about what outranked what.
 */
function kitchenWithSackWalledIn(walledRot: number | null): string | null {
  const world = createWorld(1234);
  world.items = world.items.filter((s) => s.kind !== 'rawfood' && s.kind !== 'meal');
  clear(world, 36, 36, 56, 56);
  if (walledRot !== null) {
    for (let i = 40; i <= 44; i++) {
      addBuilding(world, 'wall', i, 40, true);
      addBuilding(world, 'wall', i, 44, true);
      addBuilding(world, 'wall', 40, i, true);
      addBuilding(world, 'wall', 44, i, true);
    }
    addItem(world, 'rawfood', 40, 42, 42)!.rot = walledRot;
  }

  const cook = livingColonists(world)[0]!;
  for (const p of livingColonists(world)) {
    for (const w of WORK_TYPES) setPriority(world, p.id, w, p === cook && w === 'cook' ? 1 : 0);
  }
  cook.x = 50;
  cook.y = 50;
  cook.path = null;
  cook.jobId = null;
  cook.needs.food = 1;
  cook.needs.rest = 1;
  cook.needs.recreation = 1;

  addBuilding(world, 'stove', 50, 51, true);
  addItem(world, 'rawfood', 40, 50, 52)!.rot = 0;

  assignJob(world, cook);
  return world.jobs.find((j) => j.id === cook.jobId)?.kind ?? null;
}

describe('a sack nobody can reach', () => {
  // The cooks work the pantry oldest-first so it is eaten in the order it will
  // go off in. Asking only about the oldest sack meant one sack behind a wall —
  // or dropped out in a pen, which is where livestock leaves it — was the oldest
  // sack on the map forever, and the kitchen went quiet with a full larder two
  // steps from the stove. It is not a rot-only bug either: sacks tie at fresh,
  // and on a tie the first one created won, so item order alone could do it.
  it('does not stop the kitchen when it is the oldest food on the map', () => {
    expect(kitchenWithSackWalledIn(0.6)).toBe('cook');
  });

  it('does not stop the kitchen when it merely ties with the reachable food', () => {
    expect(kitchenWithSackWalledIn(0)).toBe('cook');
  });

  it('is the only difference from a kitchen with nothing walled in at all', () => {
    expect(kitchenWithSackWalledIn(null)).toBe('cook');
  });
});

describe('seed 99001 keeps its colony in one piece', () => {
  it('never splits the settlers, and the kitchen keeps working', () => {
    const world = createWorld(99001);
    const streams = makeStreams(world);
    let worstSplit = 1;
    let mealsAtDay14 = 0;
    for (let day = 1; day <= 20; day++) {
      for (let i = 0; i < TICKS_PER_DAY; i++) {
        stepWorld(world, streams);
        stewardTick(world, world.tick);
      }
      const regions = new Set<number>();
      for (const p of livingColonists(world)) {
        const r = regionAt(world, Math.round(p.x), Math.round(p.y));
        if (r >= 0) regions.add(r);
      }
      worstSplit = Math.max(worstSplit, regions.size);
      if (day === 14) {
        // Take the cooked food away before starting the clock on the kitchen.
        //
        // Without this the assertion below is really asking whether the colony
        // *felt like* cooking, and by day 14 a good harvest can leave it sitting
        // on a fortnight of meals with no reason to light the stove — which is a
        // colony working, not a colony wedged, and it moves with every balance
        // change that touches the harvest. An empty pantry and two hundred units
        // of raw food is the question this test means to ask: can you still get
        // from the stove to the food?
        takeResource(world, 'meal', countResource(world, 'meal'));
        mealsAtDay14 = world.stats.mealsCooked;
      }
    }
    // Day 18 is where the sandbag used to go up outside the cabin door. The
    // watchdog is allowed to catch a split and fix it — what it may not do is
    // leave one standing at the end of a day.
    expect(worstSplit).toBeLessThanOrEqual(2);
    expect(new Set(livingColonists(world).map((p) => regionAt(world, Math.round(p.x), Math.round(p.y)))).size).toBe(1);
    // The symptom a player would actually see: cooking stopped dead on day 14
    // and never restarted, because the meals were on the far side of the wall.
    expect(world.stats.mealsCooked).toBeGreaterThan(mealsAtDay14);
    // Twenty days of full simulation is the most expensive test in the repo, and
    // it runs alongside fifty other files on the same cores — two minutes on its
    // own becomes five under contention. The budget is for the machine, not the
    // test: it is deliberately far looser than the run needs, because a number
    // tight enough to catch a slowdown here would go red every time somebody adds
    // a test file, which is a worse signal than none. The sim's actual speed
    // alarm is `tests/colony-run.test.ts`, which measures ms/tick on a quiet
    // world and holds it under 2 ms.
  }, 600_000);
});
