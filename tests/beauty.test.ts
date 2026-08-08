/**
 * What it is like to live here.
 *
 * The functional half pins the arithmetic that decides whether a room is worth
 * looking at: which buildings count, that it is an average over the floor rather
 * than a total, that a laid floor is worth something per cell, and that the
 * outdoors scores exactly nothing rather than scoring badly. The experience half
 * furnishes a cabin the way a player would and checks the two things they would
 * actually notice — everybody in it cheers up a little, and the statue they put
 * in the doorway did not quietly turn their hall into two cold rooms.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { addBuilding } from '../src/sim/world';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { layFloor } from '../src/sim/floors';
import { roomAt, ROOM_WALL_HEIGHT, type Room } from '../src/sim/rooms';
import { defOf, BUILD_GROUPS, SHOOT_OVER_HEIGHT } from '../src/sim/buildings';
import { computeMood } from '../src/sim/needs';
import { isWalkable } from '../src/sim/grid';
import {
  BEAUTY,
  BEAUTY_INTERVAL,
  BEAUTY_MOOD,
  BEAUTY_SCALE,
  CORPSE_BEAUTY,
  FLOOR_BEAUTY,
  beautyLabel,
  beautyMood,
  roomBeauty,
  surroundings,
  tickBeauty,
} from '../src/sim/beauty';
import type { Pawn, World } from '../src/sim/types';

/** The room the settlers start in. Found through the starter bed, never guessed. */
function cabin(world: World): Room {
  const bed = world.buildings.find((b) => b.kind === 'bed');
  if (!bed) throw new Error('no starter bed');
  const room = roomAt(world, bed.x, bed.y);
  if (!room) throw new Error('the starter bed is not in a room');
  return room;
}

/** Cells of a room with nothing standing on them, nearest the middle first. */
function clearCells(world: World, room: Room): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const packed of room.cells) {
    const x = packed % world.width;
    const y = (packed - x) / world.width;
    if (world.cellBuilding[packed] >= 0) continue;
    if (!isWalkable(world, x, y)) continue;
    out.push({ x, y });
  }
  return out;
}

/** Stand somebody in the middle of a room, wherever that room is. */
function standIn(world: World, pawn: Pawn, room: Room): Pawn {
  const cell = clearCells(world, room)[0];
  if (!cell) throw new Error('nowhere to stand');
  pawn.x = cell.x;
  pawn.y = cell.y;
  pawn.path = null;
  return pawn;
}

function settlers(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
}

/** Kill somebody where they stand, without dragging the combat pass in. */
function fell(pawn: Pawn): Pawn {
  pawn.dead = true;
  pawn.downed = true;
  pawn.activity = 'dead';
  pawn.hp = 0;
  pawn.jobId = null;
  pawn.path = null;
  return pawn;
}

describe('what a room is worth', () => {
  it('counts what stands in the room and divides by its floor', () => {
    const world = createWorld(21);
    const room = cabin(world);
    const before = roomBeauty(world, room);

    const cell = clearCells(world, room)[0]!;
    const statue = addBuilding(world, 'statue', cell.x, cell.y, true);
    expect(statue).not.toBeNull();

    // An average, not a total: the same statue is a grand gesture in a bedroom
    // and a decoration in a hall, and the arithmetic has to say so or the winning
    // move is one enormous room with forty lamps in it.
    const after = roomBeauty(world, cabin(world));
    expect(after - before).toBeCloseTo((BEAUTY.statue! * BEAUTY_SCALE) / room.size, 6);
  });

  it('ignores anything standing in a different room, or in no room at all', () => {
    const world = createWorld(22);
    const room = cabin(world);
    const before = roomBeauty(world, room);

    // Out in the field somewhere that is definitely not the cabin.
    let placed = false;
    for (let r = 12; r < 30 && !placed; r++) {
      for (const [dx, dy] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ]) {
        const x = Math.round(world.pawns[0]!.x) + dx;
        const y = Math.round(world.pawns[0]!.y) + dy;
        if (roomAt(world, x, y)) continue;
        if (!isWalkable(world, x, y)) continue;
        if (addBuilding(world, 'statue', x, y, true)) {
          placed = true;
          break;
        }
      }
    }
    expect(placed).toBe(true);
    expect(roomBeauty(world, cabin(world))).toBeCloseTo(before, 6);
  });

  it('pays for a laid floor by the cell', () => {
    const world = createWorld(23);
    const room = cabin(world);
    const before = roomBeauty(world, room);

    const cells = clearCells(world, room).slice(0, 8);
    expect(cells.length).toBe(8);
    for (const c of cells) layFloor(world, c.x, c.y, 'plank');

    const after = roomBeauty(world, cabin(world));
    expect(after - before).toBeCloseTo((FLOOR_BEAUTY.plank! * 8 * BEAUTY_SCALE) / room.size, 6);
  });

  it('charges for a body left lying on the floor of the room', () => {
    const world = createWorld(24);
    const room = cabin(world);
    const before = roomBeauty(world, room);

    standIn(world, fell(settlers(world)[0]!), cabin(world));

    const after = roomBeauty(world, cabin(world));
    expect(after - before).toBeCloseTo((CORPSE_BEAUTY * BEAUTY_SCALE) / room.size, 6);
    // And it is the largest single thing on the list: a corpse in the kitchen
    // should outweigh anything a player could have built to make up for it.
    expect(Math.abs(CORPSE_BEAUTY)).toBeGreaterThan(Math.abs(BEAUTY.grave!));
  });

  it('scores the outdoors at nothing at all, rather than badly', () => {
    const world = createWorld(25);
    const outside = settlers(world)[0]!;
    // Somewhere with sky over it.
    for (let r = 10; r < 40; r++) {
      const x = Math.round(outside.x) + r;
      const y = Math.round(outside.y);
      if (isWalkable(world, x, y) && !roomAt(world, x, y)) {
        outside.x = x;
        outside.y = y;
        break;
      }
    }
    expect(roomAt(world, Math.round(outside.x), Math.round(outside.y))).toBeNull();
    expect(surroundings(world, outside)).toBeNull();

    outside.roomMood = -99;
    world.tick = BEAUTY_INTERVAL * 5;
    tickBeauty(world);
    // Not "a bad room" — no room. A settler who walks into a field must not be
    // charged for the field being undecorated.
    expect(outside.roomMood).toBe(0);
  });

  it('clamps the mood a room can be worth, in both directions', () => {
    expect(beautyMood(0)).toBe(0);
    expect(beautyMood(BEAUTY_SCALE * 40)).toBeCloseTo(BEAUTY_MOOD, 6);
    expect(beautyMood(-BEAUTY_SCALE * 40)).toBeCloseTo(-BEAUTY_MOOD, 6);
    // Half the scale is half the mood — linear in between, so a player who adds
    // a second statue sees the same size of step as the first.
    expect(beautyMood(BEAUTY_SCALE / 2)).toBeCloseTo(BEAUTY_MOOD / 2, 6);
  });

  it('names a score in words a player can act on', () => {
    expect(beautyLabel(-20)).toBe('grim');
    expect(beautyLabel(0)).toBe('plain');
    expect(beautyLabel(20)).toBe('beautiful');
    // Every score has a word, including the ones between the bands.
    for (let s = -30; s <= 30; s += 0.5) expect(beautyLabel(s).length).toBeGreaterThan(0);
  });

  it('only runs its pass on the interval', () => {
    const world = createWorld(26);
    const who = standIn(world, settlers(world)[0]!, cabin(world));

    who.roomMood = -99;
    world.tick = BEAUTY_INTERVAL * 3 + 1;
    tickBeauty(world);
    expect(who.roomMood).toBe(-99);

    world.tick = BEAUTY_INTERVAL * 3;
    tickBeauty(world);
    expect(who.roomMood).not.toBe(-99);
  });

  it('loads a save that has never heard of roomMood', () => {
    const world = createWorld(27);
    const who = settlers(world)[0]!;
    delete who.roomMood;
    // The mood maths has to survive the field being absent, because every save
    // written before this module existed has it absent.
    expect(Number.isFinite(computeMood(who))).toBe(true);
  });
});

describe('living somewhere nice', () => {
  it('lifts everybody standing in a room you furnished', () => {
    const world = createWorld(31);
    const room = cabin(world);
    const inside = settlers(world).slice(0, 2);
    for (const p of inside) standIn(world, p, cabin(world));
    // Two settlers, two different cells.
    inside[1]!.x = clearCells(world, cabin(world))[1]!.x;
    inside[1]!.y = clearCells(world, cabin(world))[1]!.y;

    world.tick = BEAUTY_INTERVAL * 4;
    tickBeauty(world);
    const before = inside.map((p) => computeMood(p));

    const cells = clearCells(world, room);
    for (const c of cells.slice(0, 12)) layFloor(world, c.x, c.y, 'plank');
    // Not on the two cells the settlers are standing on — a statue is solid, and
    // a test should never build one on top of somebody.
    expect(addBuilding(world, 'statue', cells[8]!.x, cells[8]!.y, true)).not.toBeNull();
    expect(addBuilding(world, 'statue', cells[9]!.x, cells[9]!.y, true)).not.toBeNull();

    world.tick = BEAUTY_INTERVAL * 5;
    tickBeauty(world);
    const after = inside.map((p) => computeMood(p));

    // Measured against their own earlier mood, not against zero — hunger and
    // company are in that same number and neither of them is what this tests.
    for (let i = 0; i < inside.length; i++) {
      expect(after[i]!).toBeGreaterThan(before[i]!);
      expect(after[i]! - before[i]!).toBeLessThanOrEqual(BEAUTY_MOOD * 2 + 1e-9);
    }
  });

  it('turns on a room somebody is buried in', () => {
    const world = createWorld(32);
    const room = cabin(world);
    const before = roomBeauty(world, room);
    const cell = clearCells(world, room)[0]!;
    addBuilding(world, 'grave', cell.x, cell.y, true);
    // Under your own roof only. Out in the graveyard a grave is in no room and
    // nobody is charged for it, which is the whole reason the cemetery goes
    // outside the walls.
    expect(roomBeauty(world, cabin(world))).toBeLessThan(before);
  });

  it('writes the term through the real tick, not just when called by hand', () => {
    const world = createWorld(33);
    const streams = makeStreams(world);
    for (const p of settlers(world)) delete p.roomMood;
    stepWorldN(world, streams, BEAUTY_INTERVAL * 2 + 3);
    // Somebody, somewhere, has an opinion about where they are standing. Which
    // settler is up to the job scheduler; that any of them got the field written
    // is the thing this is checking.
    expect(settlers(world).some((p) => p.roomMood !== undefined)).toBe(true);
  });

  it('never lets a statue cut a room in half or stop being furniture', () => {
    const world = createWorld(34);
    const room = cabin(world);
    const size = room.size;
    const def = defOf('statue');

    // Head height and solid, so you walk round it and it stops a shot — but
    // under the wall threshold, or a line of statues down a hall would silently
    // become two rooms with two temperatures.
    expect(def.solid).toBe(true);
    expect(def.height).toBeGreaterThan(SHOOT_OVER_HEIGHT);
    expect(def.height).toBeLessThan(ROOM_WALL_HEIGHT);

    // Prove it rather than trusting the number: a row of them across the cabin
    // must leave the cabin one room.
    const cells = clearCells(world, room);
    for (const c of cells.slice(0, Math.min(6, cells.length))) {
      addBuilding(world, 'statue', c.x, c.y, true);
    }
    const after = cabin(world);
    expect(after.size).toBe(size);

    // And it is somewhere a player will find it: the Comfort tab, beside the
    // other thing you build only because the people here are people, and priced
    // in steel so it is never the cheap way to build a wall.
    const comfort = BUILD_GROUPS.find((g) => g.name === 'Comfort');
    expect(comfort?.kinds).toContain('statue');
    expect(def.cost.steel ?? 0).toBeGreaterThan(defOf('wall').cost.wood ?? 0);
  });
});
