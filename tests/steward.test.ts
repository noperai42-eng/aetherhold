/**
 * The colony building itself out.
 *
 * The functional half pins the four guards that keep the Steward a help rather
 * than a hijack: it waits for a clear board, it stops while there is shooting, it
 * sleeps at night, and it never spends the colony's float. The experience half
 * leaves a colony alone for two days and checks that the yard actually changes —
 * boards down, a fence line staked out, and every one of it built by ordinary
 * settlers doing ordinary work, because everything the Steward produces is a
 * blueprint and nothing here builds anything itself.
 */

import { describe, expect, it } from 'vitest';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';
import { canSow, growingCells } from '../src/sim/farming';
import { buildingAt, isWalkable } from '../src/sim/grid';
import { regionAt } from '../src/sim/regions';
import { indoors, roomAt } from '../src/sim/rooms';
import { addBuilding, addItem, countResource, livingColonists, removeBuilding } from '../src/sim/world';
import { isBed } from '../src/sim/buildings';
import { unhoused } from '../src/sim/quarters';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { makePawn } from '../src/sim/pawn';
import { Rng } from '../src/sim/rng';
import { isSleepHours } from '../src/sim/clock';
import { foodDays } from '../src/sim/alerts';
import { freeGraves, unburiedDead } from '../src/sim/graves';
import { damageBuilding } from '../src/sim/combat';
import { tickRebuild } from '../src/sim/rebuild';
import { DRAW, GENERATOR_OUTPUT, conducts, isElectrical, isSource, powerNetworks } from '../src/sim/power';
import { REC_SPOTS } from '../src/sim/recreation';
import { RESEARCH_ORDER, available, setProject } from '../src/sim/research';
import {
  DESIG_HARVEST,
  DESIG_NONE,
  DESIG_FLOOR_PLANK,
  TICKS_PER_DAY,
  markBuildingsChanged,
  packCell,
  unpackX,
  unpackY,
} from '../src/sim/types';
import {
  AMBITIONS,
  GRID_HEADROOM,
  MAX_GENERATORS,
  MAX_PLOT,
  RESERVE,
  STEWARD_INTERVAL,
  YARD_MARGIN,
  boardClear,
  playerClear,
  stewardLoad,
  HARVEST_RADIUS,
  STEEL_FLOOR,
  WOOD_FLOOR,
  boundsOf,
  heart,
  pickProject,
  researchReasons,
  researchWants,
  setSteward,
  stewardOn,
  tickSteward,
  yardRing,
} from '../src/sim/steward';
import type { Building, Pawn, ResourceKind, World } from '../src/sim/types';

/** A daytime tick the Steward actually wakes on. */
const NOON = 2400;
/** A night tick it wakes on, for the one test about not laying fence at 11pm. */
const NIGHT = 4620;

/** Kill somebody the way the sim does, without dragging the combat pass in. */
function fell(pawn: Pawn): Pawn {
  pawn.dead = true;
  pawn.downed = true;
  pawn.activity = 'dead';
  pawn.hp = 0;
  pawn.jobId = null;
  pawn.path = null;
  return pawn;
}

/**
 * Set the colony's stock of one resource to exactly this much, at their feet.
 *
 * "At their feet" was the literal cell (33,33) for a long time, which was the
 * yard of a 96-wide valley and is forty cells out into the country of a 128-wide
 * one — rock, on some seeds. Stock nobody can walk to is not stock, and it fails
 * as something else entirely: the fence test raised its first batch of eight
 * posts out of what was already lying around the cabin and then stopped, which
 * reads exactly like a Steward that plans once instead of a pile in a boulder
 * field.
 */
function setStock(world: World, kind: ResourceKind, amount: number): void {
  for (let i = world.items.length - 1; i >= 0; i--) {
    if (world.items[i]!.kind === kind) world.items.splice(i, 1);
  }
  if (amount <= 0) return;
  const home = livingColonists(world)[0]!;
  addItem(world, kind, amount, Math.round(home.x), Math.round(home.y));
}

/** Somewhere the Steward can definitely afford everything it wants. */
function wellStocked(world: World): void {
  setStock(world, 'wood', 400);
  setStock(world, 'steel', 300);
}

/**
 * Give everybody somewhere to sleep, which is the one thing the ward waits on.
 *
 * Where the bunks stand does not matter to `sickbay` — it counts them — and
 * putting them out of the hall on purpose leaves the room's own wall line free
 * for the ward bed the test is actually looking for.
 */
function bunkEveryone(world: World): void {
  let short = livingColonists(world).length - world.buildings.filter((b) => isBed(b.kind) && b.built).length;
  for (let y = HOME_Y - 10; short > 0 && y < HOME_Y + 10; y++) {
    for (let x = HOME_X - 10; short > 0 && x < HOME_X + 10; x++) {
      if (indoors(world, x, y)) continue;
      if (addBuilding(world, 'bed', x, y, true)) short--;
    }
  }
  expect(short).toBe(0);
}

/**
 * A small walled room with a door, standing on ground the test cleared first.
 *
 * Built by hand for the same reason `annex.test.ts` builds its hall by hand: the
 * cases here are about *what the Steward puts in an empty room*, and a room
 * taken off a seed comes with whatever that seed happened to leave in it.
 */
/**
 * Give one settler a room of their own, which is what `cells` waits on.
 *
 * The colony has to have proved it can carve a room and given the first one away
 * before it walls one for a prisoner — so a fixture that skips this is a colony
 * with a cell block and everybody still in the barracks.
 */
function someoneHoused(world: World, x0: number, y0: number): void {
  const inside = spareRoom(world, x0, y0);
  const bed = addBuilding(world, 'bed', inside.x, inside.y, true);
  expect(bed).not.toBeNull();
  bed!.ownerId = livingColonists(world)[0]!.id;
  markBuildingsChanged(world);
  expect(unhoused(world).length).toBeLessThan(livingColonists(world).length);
}

function gunOnTheWall(world: World): void {
  // Well away from the cabin, and both halves of that matter. Dropped on
  // `HOME + 4` first, which is the cabin floor on most seeds, so `addBuilding`
  // refused it and the colony had no gun. Clearing that patch first was worse:
  // `clearPatch` takes down whatever is standing, so it opened the hall's own
  // wall, the cabin stopped being a room, and `heart` fell through to the 3×3
  // box this file had just built for the prisoner — which `bedlessRooms` skips,
  // because the heart is the hall. Twice the test failed for a reason that had
  // nothing to do with cells.
  clearPatch(world, HOME_X + 15, HOME_Y + 15, HOME_X + 17, HOME_Y + 17);
  const turret = addBuilding(world, 'turret', HOME_X + 16, HOME_Y + 16, true);
  expect(turret).not.toBeNull();
}

/**
 * A generator with headroom, standing well clear of anything that matters.
 *
 * The cellar refuses to plug a cooler into a grid that cannot hold it — the shed
 * order drops coolers before turrets, so an unsupported one thaws on exactly the
 * night the guns are firing. Every cellar test therefore needs watts before it
 * needs anything else.
 */
function powerToSpare(world: World, x: number, y: number): Building {
  clearPatch(world, x - 1, y - 1, x + 1, y + 1);
  const gen = addBuilding(world, 'generator', x, y, true);
  expect(gen).not.toBeNull();
  gen!.fuel = 10_000;
  markBuildingsChanged(world);
  return gen!;
}

function spareRoom(world: World, x0: number, y0: number): { x: number; y: number } {
  const x1 = x0 + 2;
  const y1 = y0 + 2;
  clearPatch(world, x0 - 2, y0 - 2, x1 + 2, y1 + 2);
  const door = { x: x0 + 1, y: y1 + 1 };
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    addBuilding(world, 'wall', x, y0 - 1, true);
    // The doorway is left open in the wall line rather than walled and then
    // doored over: `addBuilding` will not put a door on an occupied cell, so
    // laying the wall first gave a sealed box, and `planBlueprint` refuses every
    // cell of a room no settler can walk into — which is exactly how it refuses
    // the caves this map generates, and why it took three passes to notice the
    // test's room was one of them.
    if (x !== door.x) addBuilding(world, 'wall', x, y1 + 1, true);
  }
  for (let y = y0; y <= y1; y++) {
    addBuilding(world, 'wall', x0 - 1, y, true);
    addBuilding(world, 'wall', x1 + 1, y, true);
  }
  expect(addBuilding(world, 'door', door.x, door.y, true)).not.toBeNull();
  markBuildingsChanged(world);
  return { x: x0 + 1, y: y0 + 1 };
}

/**
 * A colony with nothing pressing: fed for a season, stocked, whole and warm,
 * and nobody has ever shot at it.
 *
 * The research tests below need this because the Steward now studies what the
 * colony is short of. A fixture that says nothing about food or wounds is not
 * neutral — it is a *starving* one, and it will pick the pantry every time. This
 * is the fixture that asks "what does it do when there is no pressure", and the
 * answer has to be the old behaviour: work down the tree in order.
 */
function atEase(world: World): void {
  wellStocked(world);
  setStock(world, 'meal', 300);
  for (const p of livingColonists(world)) {
    p.comfort = 0;
    p.ailments = [];
  }
}

/**
 * Take the trees and boulders out of a box so a fixture can build in it.
 *
 * Worldgen scatters both, and they are buildings like any other — so a test that
 * names bare coordinates is really testing where seed 22 happened to put a pine.
 * Clearing first makes the geometry the fixture's own. Terrain it cannot help
 * with, which is why the boxes below sit in open valley floor.
 */
function clearPatch(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (const b of world.buildings.slice()) {
    if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
    removeBuilding(world, b);
  }
}

/**
 * Is this thing on a network with something feeding it?
 *
 * The question every wiring test is really asking. "There is conduit between the
 * two" is not the same question and has been true on runs where the turret was
 * dark for forty days — a run that stops one cell short looks identical from the
 * outside and conducts nothing.
 */
function onLiveGrid(world: World, building: { id: number }): boolean {
  for (const net of powerNetworks(world)) {
    if (!net.some((b) => b.id === building.id)) continue;
    return net.some((b) => isSource(b.kind));
  }
  return false;
}

/** How many things are marked but not yet standing. */
function blueprints(world: World): number {
  return world.buildings.filter((b) => !b.built).length;
}

function designations(world: World): number {
  let n = 0;
  for (const d of world.cellDesig) if (d !== DESIG_NONE) n++;
  return n;
}

/** Run one Steward pass on a world set up for it, and say what it marked. */
function pass(world: World): { blueprints: number; designations: number; ambition?: string } {
  const before = blueprints(world) + designations(world);
  tickSteward(world);
  return {
    blueprints: blueprints(world),
    designations: designations(world),
    ambition: blueprints(world) + designations(world) > before ? world.stewardLast : undefined,
  };
}

describe('what the colony decides to do next', () => {
  it('waits for a clear board: the player plan always comes first', () => {
    const world = createWorld(11);
    world.tick = NOON;
    wellStocked(world);
    expect(boardClear(world)).toBe(true);

    // One blueprint of the player's is enough to make the colony keep its hands
    // in its pockets — it must never compete with them for wood.
    addBuilding(world, 'wall', 20, 20, false);
    expect(boardClear(world)).toBe(false);
    expect(pass(world).ambition).toBeUndefined();

    world.buildings = world.buildings.filter((b) => b.built);
    world.cellBuilding[packCell(world, 20, 20)] = -1;
    expect(boardClear(world)).toBe(true);

    // And a painted floor counts as a plan just as much as a blueprint does.
    world.cellDesig[packCell(world, 22, 22)] = DESIG_FLOOR_PLANK;
    expect(boardClear(world)).toBe(false);
    expect(pass(world).ambition).toBeUndefined();
  });

  it('marks nothing while there is anything hostile on the map', () => {
    const world = createWorld(12);
    world.tick = NOON;
    wellStocked(world);

    const raider = makePawn(world, new Rng(4), 'raider', 40, 40);
    expect(pass(world).ambition).toBeUndefined();

    // A blueprint marked mid-raid is a settler sent out to stand in the open and
    // hammer it. Once the raider is down, the plans come back out.
    raider.dead = true;
    expect(pass(world).ambition).toBeDefined();
  });

  it('sleeps at night', () => {
    const world = createWorld(13);
    wellStocked(world);

    world.tick = NIGHT;
    expect(isSleepHours(world)).toBe(true);
    expect(world.tick % STEWARD_INTERVAL).toBe(0);
    expect(pass(world).ambition).toBeUndefined();

    world.tick = NOON;
    expect(isSleepHours(world)).toBe(false);
    expect(pass(world).ambition).toBeDefined();
  });

  it('keeps a float back so it is never why the player cannot afford a wall', () => {
    const world = createWorld(14);
    world.tick = NOON;
    // Exactly the reserve and not a stick more. Every ambition that *spends*
    // checks the float first, so none of them may mark — the only thing a colony
    // this poor is allowed to do is go and get more, which costs it nothing.
    setStock(world, 'wood', RESERVE.wood);
    setStock(world, 'steel', RESERVE.steel);
    const broke = pass(world);
    expect(broke.ambition).toBe('stores');
    expect(broke.blueprints).toBe(0);
    expect(countResource(world, 'wood')).toBe(RESERVE.wood);

    // A fresh world for the other side of it: the same colony with money marks
    // something. (It has to be fresh, because the pass above left designations on
    // the board and the Steward waits for a clear one.)
    const rich = createWorld(14);
    rich.tick = NOON;
    wellStocked(rich);
    expect(pass(rich).ambition).toBeDefined();
  });

  it('is one thing at a time, and the next thing on the pass after', () => {
    const world = createWorld(15);
    world.tick = NOON;
    wellStocked(world);

    const first = pass(world);
    expect(first.ambition).toBeDefined();

    // Done, and off the board. The colony does not start a second thing while
    // its own first is still standing, so a pass with that frame still up marks
    // nothing and there is no second rung to look at. Which rung it picks up on
    // is the question here, not whether it picks one up at all.
    for (const b of [...world.buildings]) if (!b.built) removeBuilding(world, b);

    // A pass stops at the first ambition that answers and comes back for the
    // rest sixty ticks later, so the list is read a rung at a time and never top
    // to bottom in one go. What used to decide where the reading resumed was the
    // top of the list, every time, so `yard` answered and answered and nothing
    // below it was ever asked. The cursor decides it now: the second pass names
    // a *different* ambition.
    const second = pass(world);
    expect(second.ambition).toBeDefined();
    expect(second.ambition).not.toBe(first.ambition);

    // And the cursor is left one rung past whichever one answered, which is what
    // makes the pass after this one the next rung down and not this one again.
    const i = AMBITIONS.findIndex((a) => a.id === second.ambition);
    expect(world.stewardCursor).toBe((i + 1) % AMBITIONS.length);
  });

  it('puts a bed under anyone sleeping on the floor before anything else', () => {
    const world = createWorld(16);
    world.tick = NOON;
    wellStocked(world);
    const bed = world.buildings.find((b) => b.kind === 'bed')!;
    removeBuilding(world, bed);
    expect(world.buildings.filter((b) => b.kind === 'bed').length).toBeLessThan(
      livingColonists(world).length,
    );

    expect(pass(world).ambition).toBe('beds');
    const marked = world.buildings.find((b) => !b.built)!;
    expect(marked.kind).toBe('bed');
  });

  it('digs a grave when there is a body and nowhere to put it', () => {
    const world = createWorld(31);
    world.tick = NOON;
    wellStocked(world);
    expect(freeGraves(world)).toHaveLength(0);
    fell(livingColonists(world)[0]!);

    expect(pass(world).ambition).toBe('graves');
    const dug = world.buildings.filter((b) => !b.built && b.kind === 'grave');
    // One body, one grave: the ambition digs what is needed and does not turn the
    // yard into a cemetery on the strength of a single casualty.
    expect(dug).toHaveLength(1);

    // Out of the house and inside the fence line — a graveyard belongs at the
    // bottom of the garden, and a hauler with a body over their shoulder should
    // not need the gate open to get to it.
    const b = boundsOf(world, heart(world)!);
    const g = dug[0]!;
    expect(g.x < b.x0 || g.x > b.x1 || g.y < b.y0 || g.y > b.y1).toBe(true);
    expect(g.x).toBeGreaterThanOrEqual(b.x0 - YARD_MARGIN);
    expect(g.x).toBeLessThanOrEqual(b.x1 + YARD_MARGIN);
    expect(g.y).toBeGreaterThanOrEqual(b.y0 - YARD_MARGIN);
    expect(g.y).toBeLessThanOrEqual(b.y1 + YARD_MARGIN);
  });

  it('stops digging once there is a grave waiting for every body', () => {
    const world = createWorld(31);
    world.tick = NOON;
    wellStocked(world);
    const dead = fell(livingColonists(world)[0]!);
    const b = boundsOf(world, heart(world)!);
    addBuilding(world, 'grave', b.x1 + 2, b.y1 + 2, true);
    expect(freeGraves(world)).toHaveLength(1);

    // A grave standing empty is somewhere for this body to go, so the ambition
    // has nothing to say and the colony gets on with the rest of the list.
    expect(pass(world).ambition).not.toBe('graves');
    expect(world.buildings.filter((x) => !x.built && x.kind === 'grave')).toHaveLength(0);
    // And it is the *free* graves that count, not the ones already occupied: fill
    // this one and the colony digs again. The cursor goes back to the top of the
    // list first, because the pass above moved it on and the question here is
    // whether `graves` speaks up at all — not which rung the round-robin happens
    // to be standing on when it is asked.
    world.buildings.find((x) => x.kind === 'grave')!.occupant = dead.id;
    for (const x of world.buildings.filter((y) => !y.built)) removeBuilding(world, x);
    world.cellDesig.fill(DESIG_NONE);
    world.stewardCursor = 0;
    expect(pass(world).ambition).toBe('graves');
  });

  it('only ever marks blueprints — nothing here raises anything', () => {
    const world = createWorld(17);
    world.tick = NOON;
    wellStocked(world);
    const standing = world.buildings.filter((b) => b.built).length;

    for (let i = 0; i < AMBITIONS.length; i++) {
      tickSteward(world);
      // Clear the board by hand rather than by building, so every ambition in the
      // list gets a turn in one test.
      for (const b of world.buildings.filter((x) => !x.built)) removeBuilding(world, b);
      world.cellDesig.fill(DESIG_NONE);
    }

    // Same buildings standing as when we started: the Steward never built a thing.
    expect(world.buildings.filter((b) => b.built).length).toBe(standing);
  });

  it('draws the yard as a ring around the cabin, inside the map', () => {
    const world = createWorld(18);
    const room = heart(world)!;
    const b = boundsOf(world, room);
    const ring = yardRing(world, room);
    expect(ring.length).toBeGreaterThan(20);

    // The line sits at least YARD_MARGIN out on every side, and is a rectangle:
    // every cell is on one of the four extremes it actually reached.
    const x0 = Math.min(...ring.map((c) => c.x));
    const x1 = Math.max(...ring.map((c) => c.x));
    const y0 = Math.min(...ring.map((c) => c.y));
    const y1 = Math.max(...ring.map((c) => c.y));
    expect(x0).toBeLessThanOrEqual(b.x0 - YARD_MARGIN);
    expect(x1).toBeGreaterThanOrEqual(b.x1 + YARD_MARGIN);
    expect(y0).toBeLessThanOrEqual(b.y0 - YARD_MARGIN);
    expect(y1).toBeGreaterThanOrEqual(b.y1 + YARD_MARGIN);

    for (const c of ring) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.y).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(world.width - 1);
      expect(c.y).toBeLessThan(world.height - 1);
      const onX = c.x === x0 || c.x === x1;
      const onY = c.y === y0 || c.y === y1;
      expect(onX || onY).toBe(true);
    }
    // And it is a boundary, not a field: nothing inside it is on it.
    const inside = ring.filter((c) => c.x > b.x0 && c.x < b.x1 && c.y > b.y0 && c.y < b.y1);
    expect(inside).toHaveLength(0);
  });

  /**
   * The bug this pins cost a colony half its kitchen garden in every game.
   *
   * The starter garden is laid down exactly YARD_MARGIN cells behind the cabin,
   * which is precisely where a ring drawn at a fixed margin goes — so around day
   * two the Steward fenced its own back row, and a fence post makes a cell
   * unwalkable, and an unwalkable cell can never be sown again. The line has to
   * give way to the soil, not the other way round.
   */
  it('routes the fence around the garden instead of through it', () => {
    const world = createWorld(18);
    const room = heart(world)!;
    const soil = new Set(growingCells(world));
    expect(soil.size).toBeGreaterThan(0);

    for (const c of yardRing(world, room)) {
      expect(soil.has(packCell(world, c.x, c.y))).toBe(false);
    }
  });

  /**
   * The gate is decided before the ring closes, not after.
   *
   * `gate` returns 0 until the line is eighty per cent walled, so it costs
   * nothing sitting above `yard`; below it, it was unreachable, because `yard`
   * keeps returning a number for as long as it has posts left to lay. The colony
   * therefore hung its gate one tick after it had already shut itself in.
   */
  it('hangs the gate while there are still posts left to lay', () => {
    const world = createWorld(18);
    world.tick = NOON;
    wellStocked(world);
    const room = heart(world)!;
    const ring = yardRing(world, room);
    // Nine tenths of a fence: past the gate's threshold, and still short of a
    // closed ring, which is the exact window that used to be unreachable.
    const gaps = Math.floor(ring.length * 0.1);
    for (const c of ring.slice(gaps)) addBuilding(world, 'fence', c.x, c.y, true);
    expect(ring.filter((c) => buildingAt(world, c.x, c.y)?.kind === 'fence').length).toBeGreaterThan(0);

    let door: Building | undefined;
    for (let i = 0; i < AMBITIONS.length * 2 && !door; i++) {
      tickSteward(world);
      door = world.buildings.find((b) => b.kind === 'door' && !b.built);
      if (door) break;
      for (const b of world.buildings.filter((x) => !x.built)) removeBuilding(world, b);
      world.cellDesig.fill(DESIG_NONE);
    }
    expect(door).toBeDefined();
    // On the ring, where a post used to be — not on the cabin.
    expect(ring.some((c) => c.x === door!.x && c.y === door!.y)).toBe(true);
    // And there is still fence left to lay, which is the whole point.
    expect(ring.some((c) => !buildingAt(world, c.x, c.y))).toBe(true);
  });

  /**
   * The control. Promoting `gate` must not make it jump the gun: a gate in a
   * fence with three posts in it is a door standing in a field, and the colony
   * should still be laying fence.
   */
  it('will not hang a gate in a line that is barely started', () => {
    const world = createWorld(18);
    world.tick = NOON;
    wellStocked(world);
    const room = heart(world)!;
    const ring = yardRing(world, room);
    for (const c of ring.slice(0, Math.floor(ring.length * 0.3))) addBuilding(world, 'fence', c.x, c.y, true);

    for (let i = 0; i < AMBITIONS.length * 2; i++) {
      tickSteward(world);
      // On the ring, and nowhere else. The claim here is about `gate` jumping the
      // gun, and reading *every* unbuilt door as that failure was only ever right
      // while nothing below `yard` could answer at all: a colony that now gets
      // round the whole list in one pass has other reasons to want a door, and
      // measured on this seed it is `cellar` hanging one on a cold store forty
      // cells from the fence line, on the third pass. That is not a gate standing
      // in a field, and calling it one tests the scan order rather than the gun.
      expect(
        world.buildings.some(
          (b) => b.kind === 'door' && !b.built && ring.some((c) => c.x === b.x && c.y === b.y),
        ),
      ).toBe(false);
      for (const b of world.buildings.filter((x) => !x.built)) removeBuilding(world, b);
      world.cellDesig.fill(DESIG_NONE);
    }
  });

  /**
   * Played out: the colony finishes its fence and is still able to walk out of it.
   *
   * This is the failure as it actually happened on seed 1312 at harsh. On day 38
   * the last post went in, and all seven settlers spent three days inside a
   * sixty-four cell pocket — fifty-four walls, thirteen posts, no door — while
   * the twenty-seven thousand cells they had been chopping and hunting that
   * morning sat on the other side of it. Nothing in the sim told them; they just
   * stopped being able to do anything outdoors.
   *
   * So the assertion is the one a player would make: build the whole ring out,
   * and check that the settlers can still reach the map.
   */
  it('finishes the fence without shutting the settlers inside it', () => {
    const world = createWorld(18);
    world.tick = NOON;
    wellStocked(world);
    const outside = { x: 4, y: 4 };
    const reach = () =>
      livingColonists(world).some((p) => regionAt(world, Math.round(p.x), Math.round(p.y)) === regionAt(world, outside.x, outside.y));
    expect(reach()).toBe(true);

    // Run the Steward and actually raise what it plans, which is the only way the
    // ring ever closes — and the only way the trap ever sprang.
    for (let i = 0; i < AMBITIONS.length * 6; i++) {
      wellStocked(world);
      tickSteward(world);
      for (const b of world.buildings.filter((x) => !x.built)) b.built = true;
      markBuildingsChanged(world);
      world.cellDesig.fill(DESIG_NONE);
      expect(reach()).toBe(true);
    }

    // The fence really did go up — otherwise this passes by never building one.
    const room = heart(world)!;
    const ring = yardRing(world, room);
    const posts = ring.filter((c) => buildingAt(world, c.x, c.y)?.kind === 'fence').length;
    expect(posts).toBeGreaterThan(ring.length * 0.5);
    expect(ring.some((c) => buildingAt(world, c.x, c.y)?.kind === 'door')).toBe(true);
  });

  /** A post already standing in the soil comes out, so old saves heal themselves. */
  it('pulls out a fence post left standing in the garden', () => {
    const world = createWorld(18);
    world.tick = NOON;
    wellStocked(world);
    const room = heart(world)!;
    const ring = new Set(yardRing(world, room).map((c) => packCell(world, c.x, c.y)));
    const stranded = growingCells(world).find((p) => !ring.has(p))!;
    const x = unpackX(world, stranded);
    const y = unpackY(world, stranded);
    const post = addBuilding(world, 'fence', x, y, true)!;

    // Run until the yard ambition gets its turn — it is not the first in the list.
    let pulled = false;
    for (let i = 0; i < AMBITIONS.length * 2 && !pulled; i++) {
      tickSteward(world);
      pulled = !world.buildings.includes(post);
      for (const b of world.buildings.filter((x2) => !x2.built)) removeBuilding(world, b);
      world.cellDesig.fill(DESIG_NONE);
    }
    expect(pulled).toBe(true);
    expect(world.messages.some((m) => /fence post is pulled out/i.test(m.text))).toBe(true);
  });

  /**
   * A twelve-cell garden feeds three settlers and the same twelve feed nine, so a
   * Steward that never grows the plot is a Steward that starves the colony it
   * built. Four cells a head is the winter-storing ration.
   */
  it('grows the plot as the colony grows, and stops at MAX_PLOT', () => {
    const world = createWorld(18);
    world.tick = NOON;
    wellStocked(world);
    const sowable = () => growingCells(world).filter((p) => canSow(world, unpackX(world, p), unpackY(world, p))).length;
    const before = sowable();

    // Ten mouths want forty cells — well past what the starter garden covers.
    const home = livingColonists(world)[0]!;
    while (livingColonists(world).length < 10) {
      world.pawns.push(
        makePawn(world, new Rng(world.pawns.length + 1), 'colony', home.x, home.y),
      );
    }
    const fields = AMBITIONS.find((a) => a.id === 'fields')!;
    for (let i = 0; i < 40; i++) if (fields.mark(world) === 0) break;

    const after = sowable();
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(MAX_PLOT);
    // Ten mouths at four cells each, and it stops there rather than zoning the
    // whole valley.
    expect(after).toBeGreaterThanOrEqual(36);
    expect(fields.mark(world)).toBe(0);
  });

  /** Zoned soil is not fenced, floored or built on by anything that comes after. */
  it('never zones a growing cell it has already put something on', () => {
    const world = createWorld(21);
    world.tick = NOON;
    wellStocked(world);
    for (let i = 0; i < 30; i++) {
      tickSteward(world);
      world.tick += STEWARD_INTERVAL;
    }
    for (const packed of growingCells(world)) {
      const b = buildingAt(world, unpackX(world, packed), unpackY(world, packed));
      expect(b === null || !b.built).toBe(true);
    }
  });

  /**
   * Raiders arrive on a schedule the colony cannot opt out of, so a foreman that
   * only ever builds beds and fences is handing the map over on day eight. Power
   * comes first, because an unwired turret is a steel statue.
   */
  it('builds a generator before it builds a turret', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    for (const b of world.buildings.filter((x) => isSource(x.kind))) removeBuilding(world, b);
    const defence = AMBITIONS.find((a) => a.id === 'defence')!;

    expect(defence.mark(world)).toBe(1);
    const marked = world.buildings.filter((b) => !b.built);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.kind).toBe('generator');
  });

  it('sets turrets outside the cabin, and caps them by headcount', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    addBuilding(world, 'generator', HOME_X + 3, HOME_Y + 3, true);
    const defence = AMBITIONS.find((a) => a.id === 'defence')!;

    // Three settlers want two guns: 1 + floor(3 / 3).
    expect(livingColonists(world).length).toBeLessThanOrEqual(4);
    let raised = 0;
    for (let i = 0; i < 8; i++) {
      if (defence.mark(world) === 0) break;
      for (const b of world.buildings.filter((x) => !x.built)) {
        expect(b.kind).toBe('turret');
        expect(indoors(world, b.x, b.y)).toBe(false);
        b.built = true;
        raised++;
      }
    }
    expect(raised).toBeGreaterThan(0);
    expect(raised).toBeLessThanOrEqual(4);
    // And it knows when to stop.
    expect(defence.mark(world)).toBe(0);
  });

  /**
   * The ward was the last thing in the sim that nobody could reach.
   *
   * A medbed multiplies immunity gain by 1.3 where a bunk gives 1.0, and
   * `findFreeBed` has always steered the ill towards one and the well away — but
   * no ambition ever planned one and worldgen places none, so on forty days of
   * seed 7 not a single hour of illness was spent in a ward bed, because there
   * was no ward bed in the world to spend it in.
   */
  it('builds a ward bed once every settler has a bunk', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    const sickbay = AMBITIONS.find((a) => a.id === 'sickbay')!;
    // Everybody housed, which is the precondition the ward waits on.
    bunkEveryone(world);

    expect(sickbay.mark(world)).toBe(1);
    const marked = world.buildings.filter((b) => !b.built);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.kind).toBe('medbed');
    // Indoors, with the doctor and the pantry — a ward in the yard is a bed in
    // the rain.
    expect(indoors(world, marked[0]!.x, marked[0]!.y)).toBe(true);
  });

  /**
   * The control, and the reason the gate is there at all: `SICKBAY_PULL` keeps
   * healthy settlers out of the ward, so a ward built while somebody is sleeping
   * on the floor is a bed that helps nobody.
   */
  it('will not build a ward while somebody is still on the floor', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    const sickbay = AMBITIONS.find((a) => a.id === 'sickbay')!;
    for (const b of world.buildings.filter((x) => isBed(x.kind))) removeBuilding(world, b);

    expect(sickbay.mark(world)).toBe(0);
    expect(world.buildings.some((b) => b.kind === 'medbed')).toBe(false);
  });

  it('stops at two ward beds however big the colony gets', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    const sickbay = AMBITIONS.find((a) => a.id === 'sickbay')!;
    // Twelve settlers: one ward bed per four would want three, and the cap says
    // two. A third is thirty-two of the colony's materials standing empty for
    // the nine days in ten that nobody is ill.
    const home = livingColonists(world)[0]!;
    while (livingColonists(world).length < 12) {
      world.pawns.push(makePawn(world, new Rng(world.pawns.length + 1), 'colony', home.x, home.y));
    }
    bunkEveryone(world);

    let raised = 0;
    for (let i = 0; i < 8; i++) {
      if (sickbay.mark(world) === 0) break;
      for (const b of world.buildings.filter((x) => !x.built)) {
        expect(b.kind).toBe('medbed');
        b.built = true;
        raised++;
      }
    }
    expect(raised).toBe(2);
    expect(sickbay.mark(world)).toBe(0);
  });

  /**
   * The prison was the other half of the sim nobody could reach.
   *
   * One built prisonbed is the whole condition on the warden's capture path, and
   * nothing ever built one — so capture, prisoner meals, the resistance clock and
   * recruitment were all live code that never ran. Seed 7 left eighteen raiders
   * lying on the ground alive over forty days.
   */
  it('puts the prison bunk in a room of its own', () => {
    const world = createWorld(26);
    world.tick = NOON;
    wellStocked(world);
    bunkEveryone(world);
    gunOnTheWall(world);
    someoneHoused(world, HOME_X + 10, HOME_Y + 10);
    const inside = spareRoom(world, HOME_X + 10, HOME_Y + 16);
    const cells = AMBITIONS.find((a) => a.id === 'cells')!;

    expect(cells.mark(world)).toBe(1);
    const marked = world.buildings.filter((b) => !b.built);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.kind).toBe('prisonbed');
    // In the spare room, not in the corner of the hall — the isolation is the
    // point, exactly as it is for the sick.
    expect(roomAt(world, marked[0]!.x, marked[0]!.y)?.id).toBe(roomAt(world, inside.x, inside.y)?.id);
  });

  /**
   * A cell is an invitation to hold somebody who wants out. A colony that cannot
   * win the fight it is already in has no business starting a second one indoors.
   */
  it('will not wall a cell before there is a gun on the wall', () => {
    const world = createWorld(26);
    world.tick = NOON;
    wellStocked(world);
    bunkEveryone(world);
    someoneHoused(world, HOME_X + 10, HOME_Y + 10);
    spareRoom(world, HOME_X + 10, HOME_Y + 16);
    for (const b of world.buildings.filter((x) => x.kind === 'turret')) removeBuilding(world, b);
    const cells = AMBITIONS.find((a) => a.id === 'cells')!;

    expect(cells.mark(world)).toBe(0);
    expect(world.buildings.some((b) => b.kind === 'prisonbed')).toBe(false);
  });

  /**
   * The fairness rule, stated as a condition rather than left to the running
   * order. `cells` used to sit below `quarters` and lean on it returning 0 —
   * which it does, in principle, once nobody is unhoused. Over forty harsh days
   * `quarters` never got there: seed 7 finished with three settlers still without
   * a room, so the cell block was a feature no colony could ever reach.
   */
  it('will not wall a cell while nobody has a room of their own', () => {
    const world = createWorld(26);
    world.tick = NOON;
    wellStocked(world);
    bunkEveryone(world);
    gunOnTheWall(world);
    spareRoom(world, HOME_X + 10, HOME_Y + 16);
    const cells = AMBITIONS.find((a) => a.id === 'cells')!;

    expect(unhoused(world).length).toBe(livingColonists(world).length);
    expect(cells.mark(world)).toBe(0);
    expect(world.buildings.some((b) => b.kind === 'prisonbed')).toBe(false);
  });

  /**
   * `isBed` says a prison bunk is not a bed, which is true and was nearly a bug:
   * `bedlessRooms` reads "no bed in it" as "nobody has claimed it", so the cell
   * block the Steward had just walled came back up as a spare bedroom and the
   * next settler was given a bunk beside the raider.
   */
  it('does not hand the cell block out as somebody’s bedroom', () => {
    const world = createWorld(26);
    world.tick = NOON;
    wellStocked(world);
    const inside = spareRoom(world, HOME_X + 10, HOME_Y + 16);
    addBuilding(world, 'prisonbed', inside.x, inside.y, true);
    markBuildingsChanged(world);
    // By position, never by a captured id: `markBuildingsChanged` renumbers the
    // rooms, so an id held across a rebuild names a different room or none.
    const cell = () => roomAt(world, inside.x, inside.y)?.id;
    expect(cell()).toBeDefined();
    const quarters = AMBITIONS.find((a) => a.id === 'quarters')!;

    // Somebody wants a room, so `quarters` is looking for one to give them.
    expect(unhoused(world).length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) {
      quarters.mark(world);
      for (const b of world.buildings.filter((x) => !x.built)) {
        expect(roomAt(world, b.x, b.y)?.id).not.toBe(cell());
        b.built = true;
      }
      markBuildingsChanged(world);
    }
    expect(world.buildings.some((b) => b.kind === 'bed' && roomAt(world, b.x, b.y)?.id === cell())).toBe(false);
  });

  /**
   * The old cap was "three pieces of furniture and you are done", and the starter
   * cabin ships with two — so a colony of nine had a foreman who believed it had
   * furnished itself after building one table. Seats are counted against people
   * now, so somewhere to sit keeps up with who is sitting.
   */
  it('keeps adding somewhere to sit as the colony fills up', () => {
    const world = createWorld(25);
    world.tick = NOON;
    wellStocked(world);
    const comfort = AMBITIONS.find((a) => a.id === 'comfort')!;
    const seats = (): number =>
      world.buildings.reduce((n, b) => n + (b.built ? (REC_SPOTS[b.kind]?.seats ?? 0) : 0), 0);

    // The cabin it lands with already seats everybody aboard.
    expect(seats()).toBeGreaterThanOrEqual(livingColonists(world).length + 1);
    expect(comfort.mark(world)).toBe(0);

    // Twelve settlers is more than the two tables hold.
    const home = livingColonists(world)[0]!;
    while (livingColonists(world).length < 12) {
      world.pawns.push(
        makePawn(world, new Rng(world.pawns.length + 1), 'colony', home.x, home.y),
      );
    }
    expect(comfort.mark(world)).toBe(1);

    // And once there is a seat for everybody it stops, rather than paving the
    // valley in tables.
    for (let i = 0; i < 12; i++) {
      for (const b of world.buildings.filter((x) => !x.built)) b.built = true;
      if (comfort.mark(world) === 0) break;
    }
    for (const b of world.buildings.filter((x) => !x.built)) b.built = true;
    expect(seats()).toBeGreaterThanOrEqual(13);
    expect(comfort.mark(world)).toBe(0);
  });

  /**
   * Nothing on the ambitions list used to mark either bench, so a ninety-day
   * colony on three seeds finished with `bench:0 lab:0` and a tech tree it had
   * never touched. The workbench comes first because it is cheaper and because
   * most of what the research bench unlocks is recipes that need one.
   */
  it('makes room for a workbench, then a research bench, then stops', () => {
    const world = createWorld(31);
    world.tick = NOON;
    wellStocked(world);
    const knowhow = AMBITIONS.find((a) => a.id === 'knowhow')!;

    expect(knowhow.mark(world)).toBe(1);
    const first = world.buildings.filter((b) => !b.built);
    expect(first).toHaveLength(1);
    expect(first[0]!.kind).toBe('bench');
    // Indoors, where a bench belongs and where the settlers already are.
    expect(indoors(world, first[0]!.x, first[0]!.y)).toBe(true);
    first[0]!.built = true;

    expect(knowhow.mark(world)).toBe(1);
    const second = world.buildings.filter((b) => !b.built);
    expect(second).toHaveLength(1);
    expect(second[0]!.kind).toBe('lab');
    second[0]!.built = true;

    // Two benches is enough for anyone.
    expect(knowhow.mark(world)).toBe(0);
  });

  it('will not spend the float on a bench either', () => {
    const world = createWorld(32);
    world.tick = NOON;
    // Enough to raise a workbench outright, but not without dipping into the
    // reserve the player is owed.
    setStock(world, 'wood', RESERVE.wood + 19);
    setStock(world, 'steel', 300);
    const knowhow = AMBITIONS.find((a) => a.id === 'knowhow')!;
    expect(knowhow.mark(world)).toBe(0);

    setStock(world, 'wood', RESERVE.wood + 20);
    expect(knowhow.mark(world)).toBe(1);
  });

  it('puts a project on the bench, because nothing else in the game ever did', () => {
    const world = createWorld(33);
    // Nothing pressing, on purpose: tree order is now the *tiebreak* rather than
    // the rule, and this is the case that pins it still being the tiebreak. A
    // colony with a want behind it is the test below.
    atEase(world);
    // No bench, no project: a chosen project with nowhere to work on it is a HUD
    // bar that never moves.
    expect(pickProject(world)).toBe(false);
    expect(world.research.current).toBeNull();

    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    expect(pickProject(world)).toBe(true);
    // The order the tree was designed in, prerequisites already filtered.
    expect(world.research.current).toBe(available(world)[0]!.id);
    expect(world.messages.at(-1)!.text).toMatch(/research bench/i);
  });

  it('never takes the player’s own project off the bench', () => {
    const world = createWorld(34);
    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    // Something other than what the Steward would have picked.
    const mine = available(world).find((d) => d.id !== available(world)[0]!.id)!;
    setProject(world, mine.id);
    world.research.progress = 40;

    expect(pickProject(world)).toBe(false);
    expect(world.research.current).toBe(mine.id);
    expect(world.research.progress).toBe(40);
  });

  /**
   * The one thing on this module that is deliberately not gated on a clear
   * board. Everything else here spends materials and would be competing with
   * the player's own queue; choosing what to study competes with nothing, and a
   * colony with a fortnight of building marked should still be learning
   * something while it hammers.
   */
  it('chooses what to study even while the player has a queue up', () => {
    const world = createWorld(35);
    world.tick = NOON;
    wellStocked(world);
    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    // The player's plan, in the way.
    addBuilding(world, 'wall', HOME_X + 6, HOME_Y + 6, false);
    expect(boardClear(world)).toBe(false);

    const before = blueprints(world) + designations(world);
    tickSteward(world);
    // Nothing marked — the board rule still holds for everything that spends.
    expect(blueprints(world) + designations(world)).toBe(before);
    // But the bench is working.
    expect(world.research.current).not.toBeNull();
  });

  it('takes up the next project on its own once one lands', () => {
    const world = createWorld(36);
    world.tick = NOON;
    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    tickSteward(world);
    const first = world.research.current!;
    expect(first).not.toBeNull();

    // Finished. `addResearchPoints` clears `current` the same way.
    world.research.done.push(first);
    world.research.current = null;
    world.research.progress = 0;

    world.tick += STEWARD_INTERVAL;
    tickSteward(world);
    expect(world.research.current).not.toBeNull();
    expect(world.research.current).not.toBe(first);
  });

  it('studies the pantry before the tree, when the pantry is the problem', () => {
    const world = createWorld(37);
    atEase(world);
    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    // Toolmaking behind them, so the next thing on the list is Tanning — which
    // has nothing whatever to do with the reason this colony is in trouble.
    world.research.done.push('toolmaking');
    expect(available(world)[0]!.id).toBe('tanning');

    setStock(world, 'meal', 0);
    setStock(world, 'rawfood', 0);

    expect(pickProject(world)).toBe(true);
    expect(world.research.current).toBe('preserves');
    // The player is told the pressure, not the project — the project is on the
    // HUD already, and the reason is the thing that was missing.
    expect(world.messages.at(-1)!.text).toMatch(/pantry/i);
  });

  /**
   * The half that makes need-driven picking work at all.
   *
   * Almost every answer to an emergency sits two or three projects deep, and a
   * colony that could only study what it wants *today* would find the answer
   * unavailable and go back to working down the list — for ever, while the thing
   * it needed stayed one rung out of reach.
   */
  it('takes the first step of a road it cannot walk yet', () => {
    const world = createWorld(38);
    atEase(world);
    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    // Everybody is cold. The answer is Weaving, and Weaving is not on offer: it
    // sits behind Tanning, which nothing in this colony is asking for.
    for (const p of livingColonists(world)) p.comfort = -1;
    expect(available(world).some((d) => d.id === 'weaving')).toBe(false);

    expect(pickProject(world)).toBe(true);
    expect(world.research.current).toBe('tanning');
    // And the line names the cold, not the hides, because the cold is why.
    expect(world.messages.at(-1)!.text).toMatch(/cold/i);
    expect(world.messages.at(-1)!.text).toMatch(/Tanning/);
  });

  /**
   * The bill for getting the previous test wrong.
   *
   * The first version of the cold want asked whether anybody was below
   * *comfortable*, and every colony ever founded is below comfortable on its
   * first night out — nobody owns a coat yet. So the want read 1.0 on day eight
   * of every game, the road to parkas is twenty-two thousand points and the axe
   * that speeds every job in the colony is six thousand, and two seeds in the
   * sixty-day grid stopped founding at all. A want that fires in every game is
   * not a pressure, and this is the pin that says so: a cold night on its own is
   * weather, and the colony gets on with the tree.
   */
  it('does not chase coats on the first cold night of every colony ever founded', () => {
    const world = createWorld(38);
    atEase(world);
    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    // A clear night outdoors with nothing on: unpleasant, and nothing worse.
    // Below zero, and above the line health.ts starts charging anybody at.
    for (const p of livingColonists(world)) p.comfort = -0.2;

    expect(pickProject(world)).toBe(true);
    expect(world.research.current).toBe(available(world)[0]!.id);
    expect(world.research.current).not.toBe('tanning');
  });

  /**
   * The second bill, from the same round, and the deeper of the two.
   *
   * A want bids against `available[0]`, which has no want on it — it is there
   * because the tree is ordered. So with no floor under the scores, *any*
   * reading above nothing took the bench. calm/99001 spent day eight at
   * thirteen days of food with nobody hurt and nobody cold, scored the pantry at
   * five percent, and bought eleven thousand points of salting with it; three
   * days later two percent bought fifteen thousand points of raised beds. It
   * finished sixty days on five projects against sixteen and one trade party
   * past the near ring against ten, having never once been in trouble.
   *
   * So: a pressure the colony would not change its plans over does not change
   * its plans. One settler in three is the line, and a pantry a fortnight less a
   * day is nowhere near it.
   */
  it('does not rebuild the curriculum around a pantry that is merely not full', () => {
    const world = createWorld(41);
    atEase(world);
    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    // Toolmaking behind them, so the tree's own answer is Tanning — and
    // Preserves is sitting right there for anything that reads the pantry.
    world.research.done.push('toolmaking');
    expect(available(world)[0]!.id).toBe('tanning');

    setStock(world, 'rawfood', 0);
    setStock(world, 'meal', 52);
    // Thinner than full and thicker than a worry: about thirteen days, against a
    // fortnight's horizon. The colony notices; it does not reorganise.
    expect(foodDays(world)).toBeGreaterThan(11);
    expect(foodDays(world)).toBeLessThan(15);

    expect(pickProject(world)).toBe(true);
    expect(world.research.current).toBe('tanning');
    // And nothing is offered as a reason, because there was not one.
    expect(researchReasons(world).get('preserves')).toBeUndefined();
  });

  /**
   * What the research panel reads. The log line is written once, on the morning
   * the Steward takes the work up, and it is gone by lunch — a player who opens
   * the panel that evening and finds Tanning on the bench while the colony
   * freezes needs the reason to still be there.
   */
  it('can say why any project is worth having, in the colony’s own words', () => {
    const world = createWorld(40);
    atEase(world);
    for (const p of livingColonists(world)) p.comfort = -1;

    const why = researchReasons(world);
    // On the project the colony actually wants...
    expect(why.get('weaving')).toMatch(/cold/i);
    // ...and on the one it has to go through to get there, in the same words,
    // because that is the sentence that explains the choice it is making today.
    expect(why.get('tanning')).toBe(why.get('weaving'));
    // Nothing whatever to do with the cold, so it is absent rather than blank.
    expect(why.has('cartography')).toBe(false);
  });

  it('scores nothing at all when nothing is wrong', () => {
    const world = createWorld(39);
    atEase(world);
    const wants = researchWants(world);
    // Every project in the tree, including the twelve no want ever names.
    expect(wants.size).toBe(RESEARCH_ORDER.length);
    const pressing = [...wants].filter(([, w]) => w.score > 0).map(([id]) => id);
    expect(pressing).toEqual([]);
  });

  it('can be stood down, and says so', () => {
    const world = createWorld(19);
    world.tick = NOON;
    wellStocked(world);
    // Absent reads as on, so an older save's colony still has a foreman.
    expect(world.steward).toBeUndefined();
    expect(stewardOn(world)).toBe(true);

    setSteward(world, false);
    expect(stewardOn(world)).toBe(false);
    expect(world.messages.at(-1)!.text).toMatch(/stands down/i);
    expect(pass(world).ambition).toBeUndefined();

    setSteward(world, true);
    expect(pass(world).ambition).toBeDefined();
  });

  it('sends people out for timber before it spends any', () => {
    const world = createWorld(23);
    world.tick = NOON;
    // A colony under the float that still has plenty of everything else. There
    // are beds to build and a fence to lay, and it must do neither: an ambition
    // list that only knows how to spend runs the woodpile to nothing and then
    // watches the freezer go off.
    setStock(world, 'wood', WOOD_FLOOR - 1);
    setStock(world, 'steel', 300);

    const first = pass(world);
    expect(first.ambition).toBe('stores');
    expect(first.blueprints).toBe(0);
    // Whole trees, marked for felling, near enough that nobody spends the day
    // walking. Batch-sized, so the yard is not stripped in one pass.
    expect(first.designations).toBeGreaterThan(0);
    expect(first.designations).toBeLessThanOrEqual(8);
    const room = heart(world)!;
    const b = boundsOf(world, room);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    for (let i = 0; i < world.cellDesig.length; i++) {
      if (world.cellDesig[i] !== DESIG_HARVEST) continue;
      const x = i % world.width;
      const y = Math.floor(i / world.width);
      expect(Math.hypot(x - cx, y - cy)).toBeLessThan(HARVEST_RADIUS);
    }
  });

  it('leaves the woods alone once the shed is full', () => {
    const world = createWorld(23);
    world.tick = NOON;
    setStock(world, 'wood', WOOD_FLOOR + 1);
    setStock(world, 'steel', STEEL_FLOOR + 1);
    // Above the floor on both, so the colony gets on with building instead of
    // felling every tree it can see. A Steward that always chops is as bad as one
    // that never does — the map goes bald and the yard stays empty.
    expect(pass(world).ambition).not.toBe('stores');
  });

  it('the heart of the colony is the biggest room it has', () => {
    const world = createWorld(20);
    const room = heart(world)!;
    expect(room.size).toBeGreaterThan(50);
    const b = boundsOf(world, room);
    expect(b.x1).toBeGreaterThan(b.x0);
    expect(b.y1).toBeGreaterThan(b.y0);
  });
});

/**
 * The colony getting as far as the second thing on its list.
 *
 * `boardClear` was all-or-nothing: one mark anywhere on the map — a frame, or a
 * tree the colony had marked for felling itself — and every ambition stopped,
 * including the twenty-five below the one that had just answered. Measured over
 * thirty-four days on three seeds: the board was never once completely clear on
 * forty-three of the hundred and two days, `yard` answered fifty of those
 * day-samples on its own, and `quarters`, `wiring`, `statue` and `fields`
 * answered none at all. A colony that fenced a paddock for three weeks and never
 * built a second room.
 *
 * Two things move it. The gate asks whose work it is, and the chop orders the
 * colony painted itself are not the player's queue; and the list is read from
 * one past whoever last answered rather than from the top, so `yard` cannot hold
 * the front of it. What the gate still will not do is let the colony start a
 * second thing while its own first is standing half-built. That was tried, at
 * two dozen frames at once, and it stopped the settlers putting anything away
 * anywhere for the rest of the run — `construct` outranks `haul`, so a frame
 * open somewhere on the map is a pair of hands that never reaches a sack. The
 * gate in `steward.ts` has the numbers.
 */
describe('a colony that gets past its own first idea', () => {
  /** A built generator outside, so `defence` buys guns and not power. */
  function powerOn(world: World): void {
    for (let r = 4; r < 16; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of [-r, r]) {
          const x = HOME_X + dx;
          const y = HOME_Y + dy;
          if (indoors(world, x, y)) continue;
          if (!isWalkable(world, x, y) || buildingAt(world, x, y)) continue;
          if (addBuilding(world, 'generator', x, y, true)) return;
        }
      }
    }
    throw new Error('nowhere to stand a generator');
  }

  it('stands down for the player and not for itself', () => {
    const world = createWorld(43);
    world.tick = NOON;
    // Under the float, so the first thing the colony does is send people out for
    // timber. That paints cells and raises nothing, which is the case the whole
    // split turns on.
    setStock(world, 'wood', WOOD_FLOOR - 1);
    setStock(world, 'steel', 300);
    expect(playerClear(world)).toBe(true);

    const first = pass(world);
    expect(first.ambition).toBe('stores');
    expect(first.designations).toBeGreaterThan(0);

    // Its own chop orders are standing, so `boardClear` is false and the old rule
    // stopped the whole list right here — for a fortnight at a time, on the
    // numbers above. Nothing is half-built, so there is nothing to finish.
    expect(boardClear(world)).toBe(false);
    expect(playerClear(world)).toBe(true);
    expect(stewardLoad(world)).toBe(0);

    // The player's plan is a different matter and always was: it must never
    // compete with them for the wood.
    clearPatch(world, HOME_X + 12, HOME_Y + 12, HOME_X + 14, HOME_Y + 14);
    const theirs = addBuilding(world, 'wall', HOME_X + 13, HOME_Y + 13, false);
    expect(theirs).toBeTruthy();
    expect(playerClear(world)).toBe(false);
    expect(pass(world).ambition).toBeUndefined();

    // Their wall taken back, the colony's own chop orders still down and the
    // shed restocked: it gets on with the next thing. That is the whole of the
    // fix — the marks it made itself are not a queue it has to wait on.
    removeBuilding(world, theirs!);
    setStock(world, 'wood', 400);
    expect(playerClear(world)).toBe(true);
    expect(pass(world).blueprints).toBeGreaterThan(0);
  });

  it('never annexes the player floor plan, however long it plans around its own', () => {
    const world = createWorld(47);
    world.tick = NOON;
    wellStocked(world);

    // Telling the two apart means keeping a list, and the list is taken by
    // sweeping the whole grid and calling everything on it the colony's. That is
    // only true underneath the guard that has just said so, and a claim that
    // slips above the guard is silent: the colony reads the player's floor back
    // as its own, decides the board is clear, and starts spending their wood.
    const spot = packCell(world, HOME_X + 11, HOME_Y + 11);
    world.cellDesig[spot] = DESIG_FLOOR_PLANK;
    expect(playerClear(world)).toBe(false);

    for (let i = 0; i < 20; i++) tickSteward(world);
    expect(playerClear(world)).toBe(false);
    expect(world.stewardDesig ?? []).not.toContain(spot);
  });

  it('finishes what it starts before it starts anything else', () => {
    const world = createWorld(45);
    world.tick = NOON;
    setStock(world, 'wood', 4000);
    setStock(world, 'steel', 4000);

    // Rich enough to want most of the list at once, which is the colony that
    // marked out the whole valley on the first afternoon.
    let passes = 0;
    while (stewardLoad(world) === 0 && passes < 80) {
      tickSteward(world);
      passes++;
    }
    expect(stewardLoad(world)).toBeGreaterThan(0);

    // Nothing built in between, so its own frame is still up — and while it is,
    // the colony marks nothing further. Not out of tidiness: `construct` outranks
    // `haul`, so every extra frame is a settler who will never reach a sack, and
    // a colony that always has one is a colony that never puts its food away.
    expect(playerClear(world)).toBe(true);
    const before = blueprints(world) + designations(world);
    for (let i = 0; i < 10; i++) tickSteward(world);
    expect(blueprints(world) + designations(world)).toBe(before);
  });

  it('never marks a frame it has not got the materials for', () => {
    const world = createWorld(49);
    world.tick = NOON;
    // Sixty spendable wood over the float, and a batch of fence is forty of it.
    // Rich enough that the colony keeps wanting to mark and poor enough that two
    // batches is already more than it owns, which is the window the bill has to
    // be read in — `wellStocked` has four hundred and would let it mark the whole
    // ceiling without ever being asked the question.
    setStock(world, 'wood', RESERVE.wood + 60);
    setStock(world, 'steel', RESERVE.steel + 40);

    // Passes, not days: nothing is hauled and nothing is burned, so the sums are
    // exact and the only thing moving the numbers is the colony marking. Over a
    // running colony the same arithmetic drifts — a firebox eats the float
    // whether or not anybody marked anything — and the promise is about what the
    // Steward commits to, not about what the weather does to the woodpile after.
    const owed = (k: ResourceKind): number => {
      let n = 0;
      for (const b of world.buildings) {
        if (b.built) continue;
        n += Math.max(0, (b.needs[k] ?? 0) - (b.have[k] ?? 0));
      }
      return n;
    };

    for (let i = 0; i < 60; i++) {
      tickSteward(world);
      for (const k of ['wood', 'steel'] as ResourceKind[]) {
        const spare = countResource(world, k) - RESERVE[k] - owed(k);
        expect({ i, k, affordable: spare >= 0 }).toEqual({ i, k, affordable: true });
      }
    }
    // Not vacuous: it did commit to something out of that float.
    expect(world.buildings.some((b) => !b.built && b.bySteward)).toBe(true);
  });

  it('counts the guns it has already marked, not only the ones standing', () => {
    const world = createWorld(41);
    world.tick = NOON;
    wellStocked(world);
    setStock(world, 'steel', 500);
    powerOn(world);

    // The first run after the ceiling went in built nineteen turrets against a
    // want of two. Every cap in this module was written when only one frame could
    // ever be outstanding, so counting what stood was the same as counting what
    // was coming; the gun was marked, the count still read nothing, and the next
    // turn round the list marked another. This is that, asked twenty times with
    // nothing built in between — which is exactly the run the scheduler now makes.
    const defence = AMBITIONS.find((a) => a.id === 'defence')!;
    const want = Math.min(4, 1 + Math.floor(livingColonists(world).length / 3));
    for (let i = 0; i < 20; i++) defence.mark(world);

    const guns = world.buildings.filter((b) => b.kind === 'turret');
    expect(guns.length).toBe(want);
    expect(guns.some((g) => g.built)).toBe(false);
    expect(defence.mark(world)).toBe(0);
  });

  it('is not stood down for good by the walls a raid knocks out', () => {
    const world = createWorld(51);
    world.tick = NOON;
    wellStocked(world);
    expect(pass(world).ambition).toBeDefined();

    // The cabin the colony was founded in was never a blueprint anybody laid, so
    // its walls carry no mark of whose work they are. Knock four of them out —
    // a quiet afternoon, by raid standards — and `rebuild.ts` puts a frame back
    // on every cell. Those frames are the colony's own work going back up, and
    // an unstamped one reads as a plan the player queued: the Steward stands
    // down for those, and there is nothing in the game that ever takes the frame
    // away again. Measured on seed 4242 that was forty of them on day thirty-one
    // and the rest of the run spent fetching firewood past its own flat walls.
    const walls = world.buildings.filter((b) => b.built && b.kind === 'wall').slice(0, 4);
    expect(walls).toHaveLength(4);
    for (const w of walls) damageBuilding(world, w.id, w.maxHp * 10);
    tickRebuild(world);
    expect(world.buildings.filter((b) => !b.built && b.kind === 'wall').length).toBeGreaterThan(0);

    // The stamp is the whole of it. Stripped, these read as a plan the player
    // queued and the gate shuts; stamped, it stays open and the colony is only
    // waiting for its own walls, the way it waits for anything of its own.
    expect(playerClear(world)).toBe(true);
    for (const b of world.buildings) if (!b.built) delete b.bySteward;
    expect(playerClear(world)).toBe(false);
    for (const b of world.buildings) if (!b.built) b.bySteward = true;

    // And the walls back up, it gets on with the next thing — which is the part
    // that never came on seed 4242, because nothing takes an unstamped frame off
    // the board again.
    for (const b of [...world.buildings]) if (!b.built) removeBuilding(world, b);
    const before = blueprints(world) + designations(world);
    for (let i = 0; i < 5; i++) tickSteward(world);
    expect(blueprints(world) + designations(world)).toBeGreaterThan(before);
  });
});

describe('two days in a colony nobody is watching', () => {
  it('stakes out a yard fence and raises it, without being asked', () => {
    const world = createWorld(21);
    wellStocked(world);
    const room = heart(world)!;
    const ring = yardRing(world, room);
    const onRing = () =>
      ring.filter((c) => {
        const b = world.buildings.find((x) => x.built && x.kind === 'fence' && x.x === c.x && x.y === c.y);
        return b !== undefined;
      }).length;
    expect(onRing()).toBe(0);

    // Two days, which is what the block above always claimed and what this line
    // finally spends. It ran a single day for a long time and got away with it on
    // a 96-cell valley, where a batch of eight posts was most of an afternoon's
    // work for three settlers with nothing else on. It is not any more: the
    // valley is 128 cells square, the walk to the woodpile is a third longer, and
    // the day now has a stranded settler to fetch home, a caravan to load and a
    // newcomer to find a bed for in it. Measured on this seed the ring reaches
    // exactly eight by dusk on day one and twenty-four by dusk on day two, so a
    // one-day budget was not testing the loop turning over, it was testing
    // whether the first batch happened to finish before the light went.
    //
    // Stepped in blocks so the log can be read as it goes. `world.messages` keeps
    // the last eighty lines and drops the rest (`LOG_KEEP`, `world.ts`), and two
    // days of a colony this size is several hundred lines — the Steward announces
    // the fence on the first morning and it is long gone by dusk on the second.
    // Reading the log once at the end asked "is the fence line still on the last
    // page", which is a claim about how quiet the colony was afterwards. A block
    // is 400 ticks, twenty seconds of colony, and nothing this settlement does
    // fills eighty lines inside that. `stepWorldN` is a bare loop over
    // `stepWorld`, so these are the same two days, tick for tick.
    const streams = makeStreams(world);
    let announced = false;
    for (let t = 0; t < 9600; t += 400) {
      stepWorldN(world, streams, 400);
      announced ||= world.messages.some((m) => /colony stakes out a fence/i.test(m.text));
    }

    // More than one batch of eight, which is the part that matters: the board
    // cleared and the Steward marked again, so this is a loop that turns over
    // rather than one plan that happened to land. And every post was hauled and
    // raised by an ordinary settler on an ordinary construction job — the Steward
    // only ever marked them.
    expect(onRing()).toBeGreaterThan(8);

    // The Steward said it out loud, which is the durable evidence that the yard
    // was its own plan and not something that fell out of another one.
    //
    // Not `stewardLast`, which this used to read. `stewardLast` is the most recent
    // ambition, not the set of them, and over two days a colony this size has more
    // than one: measured here the ring reaches thirty-two posts, the fence line is
    // announced, and then a newcomer needs somewhere to sleep and the last thing on
    // the field is `beds`. Asserting on the last one turns "did it fence the yard"
    // into "did it fence the yard *most recently*", which is a claim about how busy
    // the colony was on the second afternoon.
    expect(announced).toBe(true);
  });

  it('buries somebody it lost, start to finish, without being told', () => {
    const world = createWorld(23);
    // Wood on the ground before anything else happens: a grave that never gets
    // dug because there was nothing to dig it with is a failure about stock, not
    // about whether the colony buries its dead.
    const home = livingColonists(world)[0]!;
    addItem(world, 'wood', 200, Math.round(home.x), Math.round(home.y));
    const dead = fell(livingColonists(world)[1]!);
    expect(world.buildings.some((b) => b.kind === 'grave')).toBe(false);

    stepWorldN(world, makeStreams(world), 4800);

    // The whole chain the colony has to run on its own: the Steward noticed the
    // body, marked a grave, a settler hauled the wood and dug it, another
    // shouldered the body and laid them in it. Before this the colony had no way
    // to plan a grave at all, so a corpse sat in the yard costing everyone mood
    // until it rotted on the fourth day — a penalty with no answer to it.
    expect(dead.buried).toBe(true);
    expect(unburiedDead(world)).toHaveLength(0);
    const grave = world.buildings.find((b) => b.kind === 'grave' && b.built);
    expect(grave).toBeDefined();
    expect(grave!.occupant).toBe(dead.id);
    expect(world.messages.some((m) => /digs graves/i.test(m.text))).toBe(true);
    expect(world.messages.some((m) => new RegExp(`${dead.name} has been laid to rest`).test(m.text))).toBe(true);
  });

  it('goes looking for stone after timber failed to keep a raid out', () => {
    const world = createWorld(41);
    world.tick = NOON;
    atEase(world);
    addBuilding(world, 'lab', HOME_X + 1, HOME_Y + 1, true);
    // The cabin is timber, which is the colony's own evidence about what its
    // walls are made of — worldgen raises forty-three wall segments and not one
    // block of stone.
    expect(world.buildings.some((b) => b.built && b.kind === 'wall')).toBe(true);
    // And a raid has been through and cost somebody. `unbloodied` is the run of
    // raids that hurt nobody, so zero is "the last one drew blood".
    world.storyteller.threatsFired = 1;
    world.storyteller.unbloodied = 0;
    // Toolmaking behind them, so left to the tree this colony would spend the
    // next fortnight learning to cure hides.
    world.research.done.push('toolmaking');
    expect(available(world)[0]!.id).toBe('tanning');

    // Three in-game hours of ordinary colony, nothing marked by a player. The
    // next threat on this seed is nine thousand ticks out, so the bench is being
    // chosen in peacetime — the colony is acting on a memory, not a siege.
    stepWorldN(world, makeStreams(world), 600);

    expect(world.research.current).toBe('stonecutting');
    expect(world.messages.some((m) => /timber did not hold/i.test(m.text))).toBe(true);
  });

  it('restocks its own woodpile instead of burning the last of it', () => {
    const world = createWorld(22);
    // A colony living hand to mouth, with a generator quietly eating the pile.
    // Left to itself this is the third-week failure: the wood runs out, the
    // cooler stops, and the winter's food goes off in a freezer nobody switched
    // off. Nothing below is designated by a player — it is all the colony's idea.
    setStock(world, 'wood', RESERVE.wood + 10);
    const start = countResource(world, 'wood');
    expect(start).toBeLessThan(WOOD_FLOOR);

    // Watched across two days rather than read off the end of one.
    //
    // This asked for a pile over the floor at a single instant, and that instant
    // was four in the morning on the first night — measured here the colony holds
    // 63 there, 84 by the next afternoon, 66 that evening, 53 the morning after
    // and 146 by the third day. A colony that spends what it cuts *should*
    // oscillate; the number at any one hour says which hour was picked. The claim
    // in the title is a claim about the whole run, so the whole run is what is
    // sampled: it got back over the floor, and it never burned down to nothing.
    const streams = makeStreams(world);
    let peak = start;
    let trough = start;
    for (let t = 0; t < TICKS_PER_DAY * 2; t += 240) {
      stepWorldN(world, streams, 240);
      const wood = countResource(world, 'wood');
      peak = Math.max(peak, wood);
      trough = Math.min(trough, wood);
    }

    expect({ what: 'restocked', wood: peak > WOOD_FLOOR }).toEqual({ what: 'restocked', wood: true });
    expect({ what: 'never ran dry', wood: trough > 0 }).toEqual({ what: 'never ran dry', wood: true });
    expect(world.messages.some((m) => /stores are down/i.test(m.text))).toBe(true);
    // And it went and got it: stumps in the yard, not a gift from the sky.
    expect(world.buildings.filter((b) => b.built && b.kind === 'tree').length).toBeLessThan(
      createWorld(22).buildings.filter((b) => b.built && b.kind === 'tree').length,
    );
  });

  it('leaves the place exactly as it found it when it is stood down', () => {
    const world = createWorld(21);
    wellStocked(world);
    setSteward(world, false);
    const before = world.buildings.length;
    const floorBefore = world.terrain.slice();

    stepWorldN(world, makeStreams(world), 2400);

    // Nothing the colony chose to add — the only buildings that could have
    // appeared are the player's, and there is no player here.
    expect(world.buildings.filter((b) => !b.built)).toHaveLength(0);
    expect(world.buildings.length).toBeLessThanOrEqual(before);
    expect(world.terrain).toEqual(floorBefore);
    expect(world.stewardLast).toBeUndefined();
  });

  it('does not spend the colony into a corner', () => {
    const world = createWorld(22);
    // A poor colony: enough to live on, nothing spare.
    setStock(world, 'wood', RESERVE.wood + 10);
    setStock(world, 'steel', RESERVE.steel + 5);

    // What the Steward is actually promising, and it is worth separating from two
    // things it is not.
    //
    // It is not "the pile stays above the float". A firebox burns wood whether or
    // not anybody marked anything, so a colony can be underneath its float having
    // committed to nothing at all, and this fixture is under it by the second
    // night. And it is not a reading taken at the end: measured over two days the
    // margin here runs 13, 34, 56, 53 and 146, and which of those a single
    // `stepWorldN` lands on is a fact about the length of the call.
    //
    // The promise is that the colony can always finish what it started. Every
    // frame standing half-built is a bill still to pay — what it needs less what
    // has already been carried into it — and the loose stock on the map has to
    // cover the lot. An unstarted blueprint is fine, that is a queue; a blueprint
    // the colony cannot afford to finish is a plank it should never have
    // committed, and it stands in the yard as a ghost for the rest of the game.
    // So it is checked the whole way along rather than once at the end.
    const owed = (k: ResourceKind): number => {
      let n = 0;
      for (const b of world.buildings) {
        if (b.built) continue;
        n += Math.max(0, (b.needs[k] ?? 0) - (b.have[k] ?? 0));
      }
      return n;
    };

    const streams = makeStreams(world);
    for (let t = 0; t < TICKS_PER_DAY * 2; t += 240) {
      stepWorldN(world, streams, 240);
      for (const k of ['wood', 'steel'] as ResourceKind[]) {
        expect({ t, k, payable: countResource(world, k) - owed(k) >= 0 }).toEqual({ t, k, payable: true });
      }
    }

    // And it spent. Without this the test has a second way to pass, which is the
    // way it used to: a colony that marks nothing owes nothing and is trivially
    // solvent. Measured on the rule this replaced that is exactly what happened
    // here — not one frame in the whole two days and two hundred and forty wood
    // piled in the yard, because a single marked tree held the board and stopped
    // every ambition under it. A Steward that cannot spend passes the solvency
    // assertion perfectly, and is the bug it was written to catch the far side of.
    //
    // Counted as buildings the colony marked *and finished*, which is the only
    // number that cannot be got by marking harder. Measured at twenty-five here;
    // the rule that froze raised none at all, so the bar is set where it
    // separates spending from not spending rather than where it pins a seed.
    const raised = world.buildings.filter((b) => b.built && b.bySteward).length;
    expect({ what: 'raised', enough: raised >= 10, raised }).toMatchObject({ what: 'raised', enough: true });
  });
});

/**
 * A turret nobody plugged in.
 *
 * The 30-day sweeps kept ending with "the turret at (43, 54) is not wired to
 * anything" in the log: forty steel standing in the yard doing nothing, which a
 * player reads as a broken turret rather than as an errand they forgot. The
 * colony now runs its own cable out to it.
 */
describe('the colony wires up what it has built', () => {
  /**
   * Every wire and every electrical thing off the map, so the only orphan on it
   * is the one the test is about. The starting cabin ships with a lamp and a
   * cooler of its own, and a fixture that leaves them standing is testing
   * whichever of them the building list happens to reach first.
   */
  function onlyThePair(world: World): void {
    wellStocked(world);
    for (const b of world.buildings.filter((o) => conducts(o.kind) || isElectrical(o.kind))) {
      removeBuilding(world, b);
    }
  }

  /** A generator and, eight cells east of it, a turret on its own. */
  function orphanTurret(world: World): void {
    onlyThePair(world);
    addBuilding(world, 'generator', 30, 40, true);
    addBuilding(world, 'turret', 38, 40, true);
  }

  const wiring = AMBITIONS.find((a) => a.id === 'wiring')!;

  it('lays conduit from an unpowered turret toward the generator', () => {
    const world = createWorld(22);
    orphanTurret(world);

    const n = wiring.mark(world);

    expect(n).toBeGreaterThan(0);
    const laid = world.buildings.filter((b) => b.kind === 'conduit' && !b.built);
    expect(laid.length).toBe(n);
    // On the line between the two, not scattered round the map.
    for (const c of laid) {
      expect(c.y).toBe(40);
      expect(c.x).toBeGreaterThanOrEqual(30);
      expect(c.x).toBeLessThanOrEqual(38);
    }
  });

  it('says nothing when there is no power source to reach', () => {
    const world = createWorld(22);
    onlyThePair(world);
    addBuilding(world, 'turret', 38, 40, true);
    // A cable to nowhere is worse than no cable: it costs wood and the turret is
    // just as dark at the end of it.
    expect(wiring.mark(world)).toBe(0);
  });

  it('leaves a turret alone once it is on the grid', () => {
    const world = createWorld(22);
    orphanTurret(world);
    for (let x = 31; x <= 37; x++) addBuilding(world, 'conduit', x, 40, true);
    expect(wiring.mark(world)).toBe(0);
  });

  /**
   * The regression that cost three of four turrets on every seed, twice over.
   *
   * The colony fences its own yard, and a fence does not conduct — deliberately,
   * because a paddock rail that silently powered a turret would be a rule nobody
   * could see. A fence is also a *ring*, so a cable that only knows how to go
   * straight never gets out of one, and a cable that follows a footpath cuts
   * corners that current cannot. Both were shipped and both left the guns dark.
   */
  /** Mark, then stand everything up, until the gun is lit or the patience runs out. */
  function runCable(world: World, turret: { id: number }, passes = 6): void {
    for (let i = 0; i < passes && !onLiveGrid(world, turret); i++) {
      wiring.mark(world);
      for (const b of world.buildings) if (!b.built) b.built = true;
    }
  }

  it('gets the cable out through the gate in a ring of fence', () => {
    const world = createWorld(22);
    onlyThePair(world);
    clearPatch(world, 38, 38, 52, 52);
    addBuilding(world, 'generator', 43, 45, true);
    for (let x = 40; x <= 46; x++) {
      for (let y = 42; y <= 48; y++) {
        if (x !== 40 && x !== 46 && y !== 42 && y !== 48) continue;
        addBuilding(world, 'fence', x, y, true);
      }
    }
    // The gate. A door conducts and a fence does not, so this cell is the only
    // way current gets out of the yard — the same one the haulers walk through.
    removeBuilding(world, buildingAt(world, 46, 45)!);
    addBuilding(world, 'door', 46, 45, true);
    const turret = addBuilding(world, 'turret', 50, 45, true)!;

    runCable(world, turret);

    expect(onLiveGrid(world, turret)).toBe(true);
    // Through the rail, not over it: every post still standing but the gate.
    expect(world.buildings.filter((b) => b.kind === 'fence').length).toBe(23);
  });

  /** Conduit only conducts to its four neighbours, so a run of it may not cut a corner. */
  it('lays a run whose cells actually touch each other', () => {
    const world = createWorld(22);
    onlyThePair(world);
    clearPatch(world, 38, 38, 52, 52);
    addBuilding(world, 'generator', 40, 40, true);
    const turret = addBuilding(world, 'turret', 46, 46, true)!;

    runCable(world, turret);

    expect(onLiveGrid(world, turret)).toBe(true);
  });
});

/**
 * Nobody was minding the meter.
 *
 * Measured over forty unattended days on three seeds: `generator:1` at every
 * checkpoint on every one of them — the single generator worldgen puts down. The
 * foreman would build four turrets and a cooler's worth of lamps and never once
 * ask where the watts were coming from, and on seed 4242 the colony's larder
 * duly thawed on day twenty-eight, because `SHED_ORDER` correctly keeps the guns
 * lit and puts the freezer out to pay for them.
 */
describe('the colony sizes its own grid', () => {
  const power = AMBITIONS.find((a) => a.id === 'power')!;

  /**
   * A bare grid: no wires, no machines, nothing but what this test puts down.
   *
   * The cabin stays up. Walls conduct, so the obvious sweep — remove everything
   * that conducts — takes the roof off, and the ambition places against `heart`:
   * a colony with no biggest room has nowhere to put a generator and every one of
   * these tests passes for the wrong reason.
   */
  function bareGrid(world: World): void {
    wellStocked(world);
    clearPatch(world, 38, 38, 52, 52);
    for (const b of world.buildings.filter((o) => isElectrical(o.kind) || o.kind === 'conduit')) {
      removeBuilding(world, b);
    }
  }

  function planned(world: World, kind: string): number {
    return world.buildings.filter((b) => b.kind === kind && !b.built).length;
  }

  it('does nothing at all until something is plugged in', () => {
    const world = createWorld(22);
    bareGrid(world);
    // No load, no reason to own a generator. The one thing on this list that
    // costs thirty wood for a colony that has not lit a lamp yet.
    expect(power.mark(world)).toBe(0);
  });

  it('buys a second generator once the load plus headroom passes the first', () => {
    const world = createWorld(22);
    bareGrid(world);
    addBuilding(world, 'generator', 40, 40, true);
    // Two turrets and a cooler: 180 W, which one generator carries — but not
    // with a cooler's worth of room over it, which is the whole point of the
    // margin. The next machine anyone plugs in is the one that browns it out.
    addBuilding(world, 'turret', 42, 40, true);
    addBuilding(world, 'turret', 44, 40, true);
    addBuilding(world, 'cooler', 46, 40, true);
    expect(DRAW.turret! * 2 + DRAW.cooler! + GRID_HEADROOM).toBeGreaterThan(GENERATOR_OUTPUT);

    expect(power.mark(world)).toBe(1);
    expect(planned(world, 'generator')).toBe(1);
  });

  it('stops at the cap instead of turning the yard into a power station', () => {
    const world = createWorld(22);
    bareGrid(world);
    for (let i = 0; i < MAX_GENERATORS; i++) addBuilding(world, 'generator', 30 + i * 2, 40, true);
    for (let i = 0; i < 8; i++) addBuilding(world, 'turret', 40 + i, 44, true);
    // 360 W of guns wants two more fireboxes it is never going to get. Past the
    // cap the grid is the player's problem, which is the right place for it.
    expect(power.mark(world)).toBe(0);
  });

  it('measures the floor in generators only, because a panel is dark at night', () => {
    const world = createWorld(22);
    bareGrid(world);
    world.research.done.push('solarcells');
    addBuilding(world, 'generator', 40, 40, true);
    for (let i = 0; i < 4; i++) addBuilding(world, 'solar', 30 + i * 2, 44, true);
    addBuilding(world, 'turret', 42, 40, true);
    addBuilding(world, 'turret', 44, 40, true);
    addBuilding(world, 'cooler', 46, 40, true);

    // 800 W of panels standing right there, and the answer is still a firebox:
    // the night the grid is short is the night the sun is not up.
    expect(power.mark(world)).toBe(1);
    expect(planned(world, 'generator')).toBe(1);
    expect(planned(world, 'solar')).toBe(0);
  });

  it('waits for something that must not go out before it buys a battery', () => {
    const world = createWorld(22);
    bareGrid(world);
    addBuilding(world, 'generator', 40, 40, true);
    addBuilding(world, 'lamp', 42, 40, true);
    // A lamp and one generator: the grid is sized, solar is unresearched, and a
    // bank is twenty-five steel to bridge a gap whose worst cost is a dark room.
    expect(power.mark(world)).toBe(0);

    addBuilding(world, 'cooler', 43, 40, true);
    // Now there is food behind that gap, and 102 W still fits inside one firebox
    // with room over, so the bank is the next thing worth owning.
    expect(power.mark(world)).toBe(1);
    expect(planned(world, 'battery')).toBe(1);
  });

  it('puts the generator floor up before it buys the bank', () => {
    const world = createWorld(22);
    bareGrid(world);
    addBuilding(world, 'generator', 40, 40, true);
    addBuilding(world, 'cooler', 42, 40, true);
    for (let i = 0; i < 4; i++) addBuilding(world, 'turret', 44 + i, 40, true);

    // 270 W on one firebox. A battery bridges the twenty minutes between the sun
    // going and the firebox catching; it does nothing at all for a grid that is
    // short at noon, so the watts come first even with a freezer standing there.
    expect(power.mark(world)).toBe(1);
    expect(planned(world, 'generator')).toBe(1);
    expect(planned(world, 'battery')).toBe(0);
  });

  it('never puts a firebox in the house', () => {
    const world = createWorld(22);
    bareGrid(world);
    addBuilding(world, 'generator', 40, 40, true);
    addBuilding(world, 'cooler', 42, 40, true);
    for (let i = 0; i < 4; i++) addBuilding(world, 'turret', 44 + i, 40, true);

    expect(power.mark(world)).toBe(1);
    const gen = world.buildings.find((b) => b.kind === 'generator' && !b.built)!;
    // `fumes.ts` exists because a firebox in a one-room cabin fills it with
    // exhaust, which is the mistake players actually make and not one the colony
    // should be making on their behalf.
    expect(indoors(world, gen.x, gen.y)).toBe(false);
  });
});

/**
 * The other half of the clear-board gate.
 *
 * `boardClear` is right to stop the Steward from starting a second thing while
 * the first is still standing half-built — but it used to stop it from fetching
 * the timber the first one is waiting for, too, and that is the same gate closing
 * on the only hand that can open it. Measured on seed 99001 at forty days:
 * thirty-five frames up, not one plank anywhere on the map, no designations, and
 * five of the six settlers idle in the yard for the last six days of the run.
 *
 * So: over a dirty board, `stores` may run and nothing else may.
 */
describe('a board stuck on something the colony has not got', () => {
  /** A cell near the cabin nothing is standing on and anybody can walk to. */
  function freeCell(world: World): { x: number; y: number } {
    for (let r = 3; r < 20; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of [-r, r]) {
          const x = HOME_X + dx;
          const y = HOME_Y + dy;
          if (isWalkable(world, x, y) && !buildingAt(world, x, y)) return { x, y };
        }
      }
    }
    throw new Error('nowhere to put a fence post');
  }

  it('sends people out for wood when a frame is waiting on wood there is none of', () => {
    const world = createWorld(31);
    world.tick = NOON;
    setStock(world, 'wood', 0);
    setStock(world, 'steel', 300);
    const spot = freeCell(world);
    addBuilding(world, 'fence', spot.x, spot.y, false);
    expect(boardClear(world)).toBe(false);

    const stuck = pass(world);
    // Trees marked, and not one new blueprint: going and getting it costs the
    // colony nothing and competes with the player's queue for nothing, which is
    // exactly why it is the one ambition allowed down here.
    expect(stuck.ambition).toBe('stores');
    expect(stuck.designations).toBeGreaterThan(0);
    expect(stuck.blueprints).toBe(1);
  });

  it('keeps its hands in its pockets when the wood is there and simply undelivered', () => {
    const world = createWorld(31);
    world.tick = NOON;
    wellStocked(world);
    const spot = freeCell(world);
    addBuilding(world, 'fence', spot.x, spot.y, false);

    // Four hundred wood on the ground. Nobody has carried it to the post yet,
    // which is a haul waiting to happen and not a colony that needs an axe — the
    // old gate is still the right answer here.
    expect(pass(world).ambition).toBeUndefined();
  });

  it('does not mark a second woodlot while somebody is already out with an axe', () => {
    const world = createWorld(31);
    world.tick = NOON;
    setStock(world, 'wood', 0);
    const spot = freeCell(world);
    addBuilding(world, 'fence', spot.x, spot.y, false);

    const first = pass(world);
    expect(first.ambition).toBe('stores');
    const marked = first.designations;

    // The board is moving. An outstanding designation is a settler already
    // walking to a tree, and eight more marks on top of that is the Steward
    // talking over itself.
    const second = pass(world);
    expect(second.designations).toBe(marked);
  });

  it('still refuses every ambition that would spend, over a dirty board', () => {
    const world = createWorld(31);
    world.tick = NOON;
    setStock(world, 'wood', 0);
    setStock(world, 'steel', 0);
    const spot = freeCell(world);
    addBuilding(world, 'fence', spot.x, spot.y, false);

    pass(world);
    // One frame in, one frame out. Beds, graves, the yard, the grid — everything
    // below the gate stays below it; the hatch is for the axe only.
    expect(blueprints(world)).toBe(1);
    expect(world.stewardLast).toBe('stores');
  });

  it('marks timber round the people when the heart room is a cupboard nobody is in', () => {
    const world = createWorld(31);
    world.tick = NOON;
    setStock(world, 'wood', 0);

    // The shape a raid leaves behind, built by hand. Take the roof off the
    // colony — every wall and door it owns — so the cabin stops being an
    // enclosed room at all, and leave one sealed one-cell pocket standing on the
    // far side of the valley with a lamp in it. `heart` wants the biggest
    // enclosed room with something built inside, and now the pocket is the only
    // one there is. This is seed 99001 at forty days, in miniature: the heart was
    // a three-cell room at (108,45), the six settlers were a hundred cells away
    // at (98,95), and the region test threw away all two thousand four hundred
    // and seventy-one trees in the valley for not connecting to a cupboard.
    for (const b of world.buildings.slice()) {
      if (b.built && (b.kind === 'wall' || b.kind === 'door')) removeBuilding(world, b);
    }
    let box: { x: number; y: number } | null = null;
    for (let r = 24; r < 50 && !box; r += 2) {
      const x = HOME_X - r;
      const y = HOME_Y + r;
      clearPatch(world, x - 2, y - 2, x + 2, y + 2);
      const ring = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: x + dx, y: y + dy })));
      if (ring.every((c) => isWalkable(world, c.x, c.y))) box = { x, y };
    }
    expect(box).not.toBeNull();
    for (const c of [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: box!.x + dx, y: box!.y + dy })))) {
      if (c.x === box!.x && c.y === box!.y) continue;
      addBuilding(world, 'wall', c.x, c.y, true);
    }
    addBuilding(world, 'lamp', box!.x, box!.y, true);

    const room = heart(world)!;
    const b = boundsOf(world, room);
    const heartRegion = regionAt(world, Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2));
    // Nobody is in it, and nobody can get into it — which is the whole problem.
    expect(livingColonists(world).some((p) => regionAt(world, Math.round(p.x), Math.round(p.y)) === heartRegion)).toBe(false);

    const spot = freeCell(world);
    addBuilding(world, 'fence', spot.x, spot.y, false);

    // Trees marked anyway, because fetching is about where the people are.
    const stuck = pass(world);
    expect(stuck.ambition).toBe('stores');
    expect(stuck.designations).toBeGreaterThan(0);
  });

  it('gets itself out of the hole: the axes are out before the morning is over', () => {
    const world = createWorld(31);
    setStock(world, 'wood', 0);
    setStock(world, 'steel', 300);
    setStock(world, 'meal', 200);
    const spot = freeCell(world);
    // A firebox rather than a fence post, because thirty wood and ten steel is a
    // frame this colony cannot pay for by accident — the board stays dirty for
    // the whole of this run, which is the condition being tested.
    const gen = addBuilding(world, 'generator', spot.x, spot.y, false)!;
    expect(countResource(world, 'wood')).toBe(0);

    // Forty minutes of colony, nobody touching it. Measured on this seed: six
    // trees marked and five settlers on chop jobs inside the first four hundred
    // ticks, a hundred and thirteen wood on the ground by eight hundred. Without
    // the hatch the same eight hundred ticks are a firebox frame, an empty
    // valley floor and six people finding something else to do.
    const streams = makeStreams(world);
    for (let t = 0; t < 800; t += 400) stepWorldN(world, streams, 400);

    expect(gen.built).toBe(false);
    expect(countResource(world, 'wood')).toBeGreaterThan(0);
    expect(world.messages.some((m) => /sends people out for timber/i.test(m.text))).toBe(true);
  });
});

describe('the cold store', () => {
  /**
   * The last mechanic in the sim with no door into it.
   *
   * `spoilage.ts` states the bargain in its own header — "grow what you eat, or
   * build a room cold enough to keep the rest" — and every moving part was
   * already wired: a hard zero spoil rate below freezing, one cooler chilling a
   * small sealed room hard because the term is `q / room.size`, and
   * `findStockpileCell` carrying perishables to a freezing cell "however far it
   * is". What was missing was an ambition that ordered one. Measured on seed 7
   * over forty harsh days before this existed: 268 food spoiled, the larder sat
   * at 11C, and not one unit was ever frozen.
   */
  it('puts a cooler in a walled room once the grid can carry it', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    powerToSpare(world, HOME_X + 15, HOME_Y + 15);
    spareRoom(world, HOME_X + 8, HOME_Y + 8);
    const cellar = AMBITIONS.find((a) => a.id === 'cellar')!;

    expect(cellar.mark(world)).toBe(1);
    const marked = world.buildings.filter((b) => !b.built);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.kind).toBe('cooler');
    // Indoors, and that is the whole mechanic rather than a nicety: `roomTargets`
    // only counts a device that is standing in a room, so a cooler in the yard
    // chills the sky. Its own blurb says "useless outdoors".
    expect(indoors(world, marked[0]!.x, marked[0]!.y)).toBe(true);
  });

  /**
   * The control on the gate above. A cooler is 90 W and `SHED_ORDER` drops
   * coolers before turrets, so one plugged into a grid with no headroom is a
   * freezer that goes off the moment the colony needs its guns.
   */
  it('will not plug a cooler into a grid that cannot carry it', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    spareRoom(world, HOME_X + 8, HOME_Y + 8);
    const cellar = AMBITIONS.find((a) => a.id === 'cellar')!;

    // Every generator in the world stopped. Worldgen ships one, so this is a
    // removal rather than an omission.
    for (const b of world.buildings.filter((q) => q.kind === 'generator')) removeBuilding(world, b);
    markBuildingsChanged(world);

    expect(cellar.mark(world)).toBe(0);
    expect(world.buildings.some((b) => b.kind === 'cooler')).toBe(false);
  });

  /**
   * A cold room the food does not know about is a cold room full of nothing.
   * `findStockpileCell` only prefers a freezing cell if a stockpile is painted on
   * one, so the zone is exactly as load-bearing as the cooler.
   */
  it('paints a food stockpile in the cold store once the cooler stands', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    powerToSpare(world, HOME_X + 15, HOME_Y + 15);
    const inside = spareRoom(world, HOME_X + 8, HOME_Y + 8);
    expect(addBuilding(world, 'cooler', inside.x, inside.y, true)).not.toBeNull();
    markBuildingsChanged(world);
    const cellar = AMBITIONS.find((a) => a.id === 'cellar')!;

    expect(cellar.mark(world)).toBeGreaterThan(0);
    const room = roomAt(world, inside.x, inside.y)!;
    const zone = world.zones.find(
      (z) => z.kind === 'stockpile' && z.cells.some((c) => roomAt(world, unpackX(world, c), unpackY(world, c))?.id === room.id),
    );
    expect(zone).toBeDefined();
    expect(zone!.accepts).toContain('rawfood');
    expect(zone!.accepts).toContain('meal');
    // Food and nothing else. A cellar that took timber would fill with building
    // material and have no room left for the harvest it was cut for.
    expect(zone!.accepts).not.toContain('wood');
  });

  /**
   * The same trap the cell block fell into, and the reason `bedlessRooms` grew a
   * second clause. That list means "rooms nobody has claimed"; a cooler is not a
   * bed, so without the extra check the cold store reads as empty and `quarters`
   * puts somebody's bunk in the freezer.
   */
  it('does not hand the cold store out as somebody\'s bedroom', () => {
    const world = createWorld(24);
    world.tick = NOON;
    wellStocked(world);
    powerToSpare(world, HOME_X + 15, HOME_Y + 15);
    const inside = spareRoom(world, HOME_X + 8, HOME_Y + 8);
    expect(addBuilding(world, 'cooler', inside.x, inside.y, true)).not.toBeNull();
    markBuildingsChanged(world);

    // Read by position rather than by id: `markBuildingsChanged` renumbers rooms,
    // so an id captured before the cooler went in names a different room after.
    const cold = () => roomAt(world, inside.x, inside.y)?.id;
    const before = cold();
    const quarters = AMBITIONS.find((a) => a.id === 'quarters')!;
    quarters.mark(world);

    for (const b of world.buildings) {
      if (!isBed(b.kind)) continue;
      expect(roomAt(world, b.x, b.y)?.id).not.toBe(before);
    }
  });
});
