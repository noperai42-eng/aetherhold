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
import { buildingAt } from '../src/sim/grid';
import { indoors } from '../src/sim/rooms';
import { addBuilding, addItem, countResource, livingColonists, removeBuilding } from '../src/sim/world';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { makePawn } from '../src/sim/pawn';
import { Rng } from '../src/sim/rng';
import { isSleepHours } from '../src/sim/clock';
import { freeGraves, unburiedDead } from '../src/sim/graves';
import { DRAW, GENERATOR_OUTPUT, conducts, isElectrical, isSource, powerNetworks } from '../src/sim/power';
import { REC_SPOTS } from '../src/sim/recreation';
import { available, setProject } from '../src/sim/research';
import {
  DESIG_HARVEST,
  DESIG_NONE,
  DESIG_FLOOR_PLANK,
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
  HARVEST_RADIUS,
  STEEL_FLOOR,
  WOOD_FLOOR,
  boundsOf,
  heart,
  pickProject,
  setSteward,
  stewardOn,
  tickSteward,
  yardRing,
} from '../src/sim/steward';
import type { Pawn, ResourceKind, World } from '../src/sim/types';

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

  it('is one thing at a time: a second pass on the same tick adds nothing', () => {
    const world = createWorld(15);
    world.tick = NOON;
    wellStocked(world);

    const first = pass(world);
    expect(first.ambition).toBeDefined();
    const marked = first.blueprints + first.designations;

    // The board is no longer clear, which is the same guard that keeps it out of
    // the player's way — so the colony works on what it just marked.
    const second = pass(world);
    expect(second.blueprints + second.designations).toBe(marked);
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
    // this one and the next pass digs again.
    world.buildings.find((x) => x.kind === 'grave')!.occupant = dead.id;
    for (const x of world.buildings.filter((y) => !y.built)) removeBuilding(world, x);
    world.cellDesig.fill(DESIG_NONE);
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

  it('restocks its own woodpile instead of burning the last of it', () => {
    const world = createWorld(22);
    // A colony living hand to mouth, with a generator quietly eating the pile.
    // Left to itself this is the third-week failure: the wood runs out, the
    // cooler stops, and the winter's food goes off in a freezer nobody switched
    // off. Nothing below is designated by a player — it is all the colony's idea.
    setStock(world, 'wood', RESERVE.wood + 10);
    const start = countResource(world, 'wood');
    expect(start).toBeLessThan(WOOD_FLOOR);

    stepWorldN(world, makeStreams(world), 2400);

    expect(countResource(world, 'wood')).toBeGreaterThan(WOOD_FLOOR);
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
    // A poor colony: enough to live on, nothing spare. Two days later it should
    // still have its float, because every ambition checks before it marks.
    setStock(world, 'wood', RESERVE.wood + 10);
    setStock(world, 'steel', RESERVE.steel + 5);

    stepWorldN(world, makeStreams(world), 2400);

    // Chopping raises the number and building lowers it, so the stock on its own
    // says nothing. What must hold is that everything the Steward has committed
    // to is still payable *out of the spendable half* — stock above the float.
    // An unstarted blueprint is fine, that is a queue; an unstarted blueprint the
    // colony cannot afford to finish is a plank it should never have committed,
    // and it sits in the yard as a ghost for the rest of the game.
    const owed: Record<string, number> = { wood: 0, steel: 0 };
    for (const b of world.buildings) {
      if (b.built) continue;
      for (const k of Object.keys(b.needs)) owed[k] = (owed[k] ?? 0) + (b.needs[k as ResourceKind] ?? 0);
    }
    for (const k of ['wood', 'steel'] as ResourceKind[]) {
      expect({ k, spare: countResource(world, k) - RESERVE[k] - owed[k]! >= 0 }).toEqual({ k, spare: true });
    }
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
