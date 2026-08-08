/**
 * Generator exhaust.
 *
 * The functional half pins the three claims the module makes on its own terms —
 * outdoors is free, a tighter room is worse, and the mood it writes comes back off
 * a settler who walks out of it. The experience half asks the question a player
 * asks: I put the generator in the cabin because the wire was shorter, so what
 * does the game tell me, and does it tell me what to do about it?
 *
 * The awkward part of the fixture is that a generator only burns fuel while
 * something is drawing on the grid. So every case here has to plug a lamp in and
 * leave loose wood on the floor, exactly like a player, or the engine sits cold
 * and the air stays clean for entirely the wrong reason.
 */

import { describe, expect, it } from 'vitest';

import {
  EXHAUST,
  FUMES_CHOKING,
  FUMES_INTERVAL,
  FUMES_STUFFY,
  fumesAt,
  isRunning,
  roomFumes,
  tickFumes,
} from '../src/sim/fumes';
import { CABIN, HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';
import { addBuilding, addItem, removeBuilding } from '../src/sim/world';
import { computeMood } from '../src/sim/needs';
import { tickPower } from '../src/sim/power';
import { roomAt } from '../src/sim/rooms';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import type { Pawn, World } from '../src/sim/types';

/** Middle of the starter cabin — nine cells clear of every wall. */
const INSIDE = { x: HOME_X - 1, y: HOME_Y - 1 };

/**
 * Take the starter engine out of the yard, so the one under test is the only
 * supply on the grid.
 *
 * `tickPower` shuts a generator down the instant the grid is satisfied, and the
 * one worldgen leaves outside the north wall satisfies a single lamp on its own.
 * Leave it standing and the indoor engine sits cold — a fixture that proves
 * nothing while looking like it proves everything. Taking it out is also the
 * player's own move: they moved the generator inside because the wire was shorter.
 */
function soleEngine(world: World): void {
  for (const g of world.buildings.filter((b) => b.kind === 'generator')) removeBuilding(world, g);
}

/**
 * An engine indoors with something to power, and fuel to do it with.
 *
 * The lamp is not decoration: `tickPower` shuts a generator down the moment the
 * grid is satisfied, so a test that builds an engine and no load is testing a cold
 * firebox. The wood pile is the same story one step further back.
 */
function engineInTheCabin(world: World): void {
  soleEngine(world);
  expect(addBuilding(world, 'generator', CABIN.x0 + 1, CABIN.y0 + 1, true)).not.toBeNull();
  expect(addBuilding(world, 'lamp', CABIN.x0 + 3, CABIN.y0 + 1, true)).not.toBeNull();
  addItem(world, 'wood', 200, INSIDE.x, INSIDE.y);
  tickPower(world);
}

/**
 * A one-cell shed in the yard with the engine shut inside it.
 *
 * It stands in the cleared yard just west of the cabin rather than at some cell
 * that happened to be bare on a 64-wide map: worldgen guarantees this strip is
 * grass and treeless, so the shed can always be built.
 *
 * Nine walls, no door, and the middle cell is the whole room — which is the worst
 * case the game can produce and the reason the damage term exists. Returns the
 * interior cell.
 */
function sealedShed(world: World, cx = CABIN.x0 - 2, cy = CABIN.y0 + 2): { x: number; y: number } {
  soleEngine(world);
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      if (x === cx && y === cy) continue;
      expect(addBuilding(world, 'wall', x, y, true)).not.toBeNull();
    }
  }
  expect(addBuilding(world, 'generator', cx, cy, true)).not.toBeNull();
  // The lamp goes just outside the shell rather than in the cabin, because power
  // is per-network: walls conduct, so a lamp against the shed wall is on the
  // engine's grid, and one across the map is on somebody else's.
  expect(addBuilding(world, 'lamp', cx, cy - 2, true)).not.toBeNull();
  addItem(world, 'wood', 200, cx, cy - 2);
  tickPower(world);
  return { x: cx, y: cy };
}

/** Somebody standing exactly here, and nowhere near a job that moves them. */
function park(world: World, x: number, y: number): Pawn {
  const p = world.pawns.find((q) => q.faction === 'colony' && !q.dead)!;
  p.x = x;
  p.y = y;
  p.path = null;
  p.jobId = null;
  return p;
}

describe('fumes — functional', () => {
  it('costs nothing when the generator is in the yard', () => {
    const world = createWorld(20260729);
    // Worldgen puts the starter engine against the outside of the north wall,
    // which is the arrangement this whole module is trying to teach.
    const gen = world.buildings.find((b) => b.kind === 'generator')!;
    expect(roomAt(world, gen.x, gen.y)).toBeNull();

    addItem(world, 'wood', 200, INSIDE.x, INSIDE.y);
    expect(addBuilding(world, 'lamp', 28, 27, true)).not.toBeNull();
    tickPower(world);
    expect(isRunning(gen)).toBe(true);

    expect(roomFumes(world).size).toBe(0);
    expect(fumesAt(world, INSIDE.x, INSIDE.y)).toBe(0);
  });

  it('thickens the air once the same engine is indoors', () => {
    const world = createWorld(20260729);
    engineInTheCabin(world);

    const c = fumesAt(world, INSIDE.x, INSIDE.y);
    expect(c).toBeGreaterThan(FUMES_STUFFY);
    // Ninety-nine cells of cabin: unpleasant and obvious, nowhere near choking.
    // If this ever reads above the line, the starter colony is losing settlers to
    // a mistake it is allowed to make once.
    expect(c).toBeLessThan(FUMES_CHOKING);
    // One engine spread over the room it is shut into, discounted by the door it
    // leaks through — the same shape the heating pass uses, multiplied where that
    // one divides.
    const room = roomAt(world, INSIDE.x, INSIDE.y)!;
    expect(room.doorEdges).toBeGreaterThan(0);
    expect(c).toBeLessThan(EXHAUST / room.size);
  });

  it('is worse in a tighter room, not better', () => {
    const roomy = createWorld(20260729);
    engineInTheCabin(roomy);
    const inCabin = fumesAt(roomy, INSIDE.x, INSIDE.y);

    const cramped = createWorld(20260729);
    const shed = sealedShed(cramped);
    const inShed = fumesAt(cramped, shed.x, shed.y);

    // The intuition a player brings from heaters is that sealing a room helps.
    // For exhaust it is exactly inverted, and the gap has to be big enough that
    // nobody reads it as noise.
    expect(inShed).toBeGreaterThan(inCabin * 10);
    expect(inShed).toBeGreaterThan(FUMES_CHOKING);
  });

  it('stops charging a settler who walks out of it', () => {
    const world = createWorld(20260729);
    engineInTheCabin(world);
    const p = park(world, INSIDE.x, INSIDE.y);

    world.tick = FUMES_INTERVAL * 10;
    tickFumes(world);
    expect(p.fumesMood ?? 0).toBeLessThan(0);

    // Out of the door and into the yard. A cached mood field that is only ever
    // written when it is bad is a field that never comes back.
    park(world, HOME_X - 1, HOME_Y - 12);
    world.tick += FUMES_INTERVAL;
    tickFumes(world);
    expect(p.fumesMood).toBe(0);
  });

  it('hurts in a sealed shed but never kills', () => {
    const world = createWorld(20260729);
    const shed = sealedShed(world);
    const p = park(world, shed.x, shed.y);
    // A pawn standing on the generator's own cell is standing in its room, which
    // is the only cell the shed has.
    const before = p.hp;

    for (let i = 0; i < 400; i++) {
      world.tick += FUMES_INTERVAL;
      tickPower(world);
      tickFumes(world);
    }

    expect(p.hp).toBeLessThan(before);
    // The floor, out loud: bad air takes somebody out of the day, it does not
    // bury them. A player who never opens the power panel still has a colony.
    expect(p.hp).toBeGreaterThanOrEqual(1);
    expect(p.dead).toBe(false);
  });
});

describe('fumes — experience', () => {
  it('makes everyone miserable and says how to fix it', () => {
    const clean = createWorld(20260729);
    const dirty = createWorld(20260729);
    engineInTheCabin(dirty);

    stepWorldN(clean, makeStreams(clean), 200);
    stepWorldN(dirty, makeStreams(dirty), 200);

    const alert = dirty.messages.find((m) => m.text.includes('generator exhaust'));
    expect(alert).toBeDefined();
    // The complaint is only worth writing if it carries the fix, and the fix is
    // one the player can act on without reading a wiki: the wall conducts.
    expect(alert!.text).toContain('Move the generator outside');
    expect(alert!.kind).toBe('bad');
    expect(clean.messages.some((m) => m.text.includes('generator exhaust'))).toBe(false);

    // And it is not merely a line in the log: it shows up where the player looks
    // when they wonder why nobody will work.
    const indoorsNow = dirty.pawns.filter((p) => p.faction === 'colony' && !p.dead && (p.fumesMood ?? 0) < 0);
    expect(indoorsNow.length).toBeGreaterThan(0);
    for (const p of indoorsNow) {
      const twin = clean.pawns.find((q) => q.id === p.id);
      if (!twin) continue;
      expect(computeMood(p)).toBeLessThan(computeMood(twin));
    }
  });

  it('clears the alert when the engine comes back out', () => {
    const world = createWorld(20260729);
    engineInTheCabin(world);
    park(world, INSIDE.x, INSIDE.y);

    world.tick = FUMES_INTERVAL * 10;
    tickFumes(world);
    expect(world.fumesTold).toBe(true);

    // The one indoors, not the starter engine worldgen leaves outside the north
    // wall — both sit on the cabin's west line, and only the interior one is the subject here.
    const gen = world.buildings.find((b) => b.kind === 'generator' && b.x === CABIN.x0 + 1 && b.y === CABIN.y0 + 1)!;
    gen.built = false;
    gen.powered = false;
    world.tick += FUMES_INTERVAL;
    tickFumes(world);

    expect(world.fumesTold).toBe(false);
    expect(world.messages.some((m) => m.text === 'The air indoors clears.')).toBe(true);
  });
});
