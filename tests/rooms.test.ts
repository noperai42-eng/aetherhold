/**
 * Rooms and warmth.
 *
 * The functional half pins the flood fill: what counts as a wall, what a room's
 * boundary tally says, and the two traps that would quietly wreck it — a stand of
 * trees pinching the outdoors into pockets, and the map's own rock rim making the
 * whole world one enormous well-sealed room.
 *
 * The experience half asks the questions a player asks. Does a fire warm the room
 * it stands in? Does leaving the door off cost me that warmth? Is a cold night
 * outdoors how somebody catches the flu — and, the balance guard, does a settler
 * sleeping in an ordinary unheated cabin get through the night unharmed?
 */

import { describe, expect, it } from 'vitest';

import { buildingAt, isWalkable } from '../src/sim/grid';
import { MAX_ROOM_CELLS, indoors, roomAt, roomIndex, roomOf } from '../src/sim/rooms';
import {
  CAMPFIRE_LIGHT_BELOW,
  cellTemp,
  outdoorTemp,
  sealOf,
  tickTemperature,
} from '../src/sim/temperature';
import { CABIN, createWorld } from '../src/sim/worldgen';
import { addBuilding, addItem, countResource, removeBuilding } from '../src/sim/world';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { seasonOf } from '../src/sim/seasons';
import { comfortAt } from '../src/sim/health';
import { hasAilment } from '../src/sim/health';
import { TICKS_PER_DAY, markBuildingsChanged, setTerrain } from '../src/sim/types';
import type { Cell, World } from '../src/sim/types';

function game(seed = 90210) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

const middle: Cell = {
  x: Math.round((CABIN.x0 + CABIN.x1) / 2),
  y: Math.round((CABIN.y0 + CABIN.y1) / 2),
};

/** A cell of open yard near the cabin — walkable, roofless, nothing built on it. */
function openYard(world: World): Cell {
  for (let r = 6; r < 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = middle.x + dx;
        const y = middle.y + dy;
        if (!isWalkable(world, x, y) || buildingAt(world, x, y)) continue;
        if (roomAt(world, x, y)) continue;
        return { x, y };
      }
    }
  }
  throw new Error('no open yard on this map');
}

/** Park the world at a known hour so the outdoor curve stops moving under a test. */
function atHour(world: World, fraction: number): void {
  world.tick = Math.round(TICKS_PER_DAY * fraction);
}

function calm(world: World): void {
  world.weather.kind = 'clear';
  world.weather.blend = 1;
}

/** Run the temperature pass long enough that lag stops being the answer. */
function settleFor(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickTemperature(world);
  }
}

// ---------------------------------------------------------------------------
// Functional: the flood fill
// ---------------------------------------------------------------------------

describe('room detection', () => {
  it('finds the starter cabin and counts its walls and its door', () => {
    const { world } = game();
    const room = roomAt(world, middle.x, middle.y);
    expect(room).not.toBeNull();
    // 11 by 9 of floor inside a 13 by 11 shell.
    expect(room!.size).toBe(99);
    // 40 boundary edges, one of which swings.
    expect(room!.wallEdges).toBe(39);
    expect(room!.doorEdges).toBe(1);
    expect(sealOf(room!)).toBeCloseTo(39 / 42, 5);
  });

  it('calls the open map outdoors however much rock rims it', () => {
    const { world } = game();
    expect(roomAt(world, 31, 20)).toBeNull();
    expect(indoors(world, 31, 20)).toBe(false);
    expect(indoors(world, middle.x, middle.y)).toBe(true);
    // The rim closes the outdoors into a region of its own, so the cap is the
    // only thing standing between "the map" and "one very well insulated hall".
    for (const room of roomIndex(world).rooms.values()) {
      expect(room.size).toBeLessThanOrEqual(MAX_ROOM_CELLS);
    }
  });

  it('does not let a stand of trees enclose anything', () => {
    const { world } = game();
    const spot: Cell = { x: 31, y: 20 };
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      addBuilding(world, 'tree', spot.x + dx, spot.y + dy, true);
    }
    // Four solid, 4.5 m tall things around a cell is a thicket, not a room. The
    // old four-ray shelter test called this indoors and heated it.
    expect(roomAt(world, spot.x, spot.y)).toBeNull();
  });

  it('splits one room into two the moment the partition closes', () => {
    const { world } = game();
    const x0 = CABIN.x0 + 1;
    const y0 = CABIN.y1 - 2;
    for (let x = x0; x < x0 + 3; x++) addBuilding(world, 'wall', x, y0 - 1, true);
    addBuilding(world, 'wall', x0 + 3, y0 + 1, true);

    // One wall short of sealed: still one room, because the fill leaks through
    // the gap the door has not filled yet.
    expect(roomAt(world, x0, y0)!.size).toBe(99 - 4);

    addBuilding(world, 'door', x0 + 3, y0, true);
    const pantry = roomAt(world, x0, y0)!;
    const cabin = roomAt(world, middle.x, middle.y)!;
    expect(pantry.size).toBe(6);
    expect(cabin.size).toBe(99 - 6 - 5);
    expect(pantry.id).not.toBe(cabin.id);
    // Its one door is the leak, and a smaller room is a tighter room.
    expect(pantry.doorEdges).toBe(1);
    expect(sealOf(pantry)).toBeLessThan(sealOf(cabin));
  });

  it('reopens a room when its wall comes down', () => {
    const { world } = game();
    const wall = world.buildings.find(
      (b) => b.kind === 'wall' && b.y === CABIN.y0 && b.x === middle.x,
    )!;
    world.buildings = world.buildings.filter((b) => b.id !== wall.id);
    world.cellBuilding[wall.y * world.width + wall.x] = -1;
    // A hole in the north wall is not a smaller room, it is the yard.
    expect(roomAt(world, middle.x, middle.y)).toBeNull();
  });

  // These three pin the cache's invalidation rather than the flood fill, and they
  // exist because the fingerprint stopped being self-evidently correct.
  //
  // It used to hash every wall on the map on every query, which cannot go stale by
  // construction — and cost more than the rebuild it was avoiding once temperature
  // and crop growth started asking per cell. At 192² that walk was the largest
  // single line in the profile, and taking it out cut the whole tick from 1.69 ms
  // to 1.04 ms, measured back to back on the same day of the same seed.
  //
  // What replaces it is a counter, and a counter is only right if it is *bumped*.
  // So the property that used to be free is now a thing that can be broken by a
  // line of code somewhere else entirely, and these are the tests that would catch
  // that. One per way the enclosing layout can move.
  it('reopens a room the moment its wall is properly removed', () => {
    const { world } = game();
    const wall = world.buildings.find(
      (b) => b.kind === 'wall' && b.y === CABIN.y0 && b.x === middle.x,
    )!;
    expect(roomAt(world, middle.x, middle.y)).not.toBeNull();
    removeBuilding(world, wall);
    expect(roomAt(world, middle.x, middle.y)).toBeNull();
  });

  it('does not count a half-built wall, and counts it the tick it is finished', () => {
    const { world } = game();
    const x0 = CABIN.x0 + 1;
    const y0 = CABIN.y1 - 2;
    for (let x = x0; x < x0 + 3; x++) addBuilding(world, 'wall', x, y0 - 1, true);
    addBuilding(world, 'wall', x0 + 3, y0 + 1, true);
    // The last cell of the partition, laid as a blueprint rather than a wall.
    const frame = addBuilding(world, 'door', x0 + 3, y0, false)!;

    // A frame is not a door. Nothing is sealed, so the fill still leaks past it.
    expect(roomAt(world, x0, y0)!.size).toBe(99 - 4);

    // This is the case the counter is load-bearing for and the only one the
    // building count cannot cover for it: the settler drives the last nail and
    // the map's list of buildings does not change at all. Nothing about the
    // world's shape says the room closed except the flag, so the flag has to say
    // so — `jobs.ts` bumps it on this exact line.
    frame.built = true;
    markBuildingsChanged(world);
    expect(roomAt(world, x0, y0)!.size).toBe(6);
  });

  it('reopens a room when the rock enclosing it is mined out', () => {
    const { world } = game();
    // A pocket in the rock rim is a room like a cabin is a room, so the ground
    // moving has to invalidate the index the same way a wall coming down does.
    const wall = world.buildings.find(
      (b) => b.kind === 'wall' && b.y === CABIN.y0 && b.x === middle.x,
    )!;
    setTerrain(world, wall.x, wall.y, 'rock');
    removeBuilding(world, wall);
    // Rock is wall: the cabin is still sealed, by stone instead of timber.
    expect(roomAt(world, middle.x, middle.y)).not.toBeNull();
    setTerrain(world, wall.x, wall.y, 'dirt');
    expect(roomAt(world, middle.x, middle.y)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Functional: what a room does with the weather
// ---------------------------------------------------------------------------

describe('room temperature', () => {
  it('holds a walled room above a cold night without any heat at all', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.1); // coldest hour
    settleFor(world, 400);

    const out = outdoorTemp(world);
    const inside = cellTemp(world, middle.x, middle.y);
    expect(inside).toBeGreaterThan(out + 5);
    // The balance guard behind that number: an ordinary night in an ordinary
    // cabin is uncomfortable at worst. Nobody freezes for not having built a
    // heater yet.
    expect(comfortAt(inside)).toBeGreaterThan(-0.5);
  });

  it('lags rather than snapping when the target moves', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.6);
    settleFor(world, 400);
    const warm = cellTemp(world, middle.x, middle.y);

    // Jump the clock to the small hours. The air outside has already changed;
    // the room has not, and that is the point of thermal mass.
    atHour(world, 0.1);
    world.tick++;
    tickTemperature(world);
    const oneTickLater = cellTemp(world, middle.x, middle.y);
    expect(Math.abs(oneTickLater - warm)).toBeLessThan(0.5);

    settleFor(world, 600);
    expect(cellTemp(world, middle.x, middle.y)).toBeLessThan(warm - 2);
  });

  it('warms the room a fire is in and burns wood doing it', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.1);
    settleFor(world, 400);
    const cold = cellTemp(world, middle.x, middle.y);
    expect(cold).toBeLessThan(CAMPFIRE_LIGHT_BELOW);

    const fire = addBuilding(world, 'campfire', middle.x, middle.y - 1, true)!;
    addItem(world, 'wood', 200, middle.x, middle.y + 1);
    const wood = countResource(world, 'wood');

    settleFor(world, 600);
    expect(cellTemp(world, middle.x, middle.y)).toBeGreaterThan(cold + 4);
    expect(fire.fuel ?? 0).toBeGreaterThan(0);
    expect(countResource(world, 'wood')).toBeLessThan(wood);
  });

  it('does not warm the room next door', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.1);
    const x0 = CABIN.x0 + 1;
    const y0 = CABIN.y1 - 2;
    for (let x = x0; x < x0 + 3; x++) addBuilding(world, 'wall', x, y0 - 1, true);
    addBuilding(world, 'wall', x0 + 3, y0 + 1, true);
    addBuilding(world, 'door', x0 + 3, y0, true);
    addBuilding(world, 'campfire', x0, y0 + 1, true);
    addItem(world, 'wood', 200, middle.x, middle.y);

    settleFor(world, 800);
    const pantry = cellTemp(world, x0 + 1, y0 + 1);
    const cabin = cellTemp(world, middle.x, middle.y);
    expect(pantry).toBeGreaterThan(cabin + 5);
  });

  it('reads the room a building stands in', () => {
    const { world } = game();
    const stove = world.buildings.find((b) => b.kind === 'stove')!;
    expect(roomOf(world, stove)?.size).toBe(99);
    // And a machine in the yard is in no room at all, which is what the HUD
    // tells the player when they park a cooler outside. The cell is searched for
    // rather than written down: it was the literal (31,20) until the valley grew
    // and the cabin — which is measured from the middle of the map — walked away
    // from it, leaving the test parking a cooler in rim rock and reading the null
    // that came back as a room.
    const spot = openYard(world);
    const yard = addBuilding(world, 'cooler', spot.x, spot.y, true)!;
    expect(roomOf(world, yard)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Experience: what the cold does to people
// ---------------------------------------------------------------------------

describe('cold, played', () => {
  it('scores comfort from pleasant through uncomfortable to dangerous', () => {
    expect(comfortAt(20)).toBe(0);
    expect(comfortAt(8)).toBe(0);
    expect(comfortAt(2)).toBeLessThan(0);
    expect(comfortAt(2)).toBeGreaterThan(-0.6);
    expect(comfortAt(-5)).toBe(-1);
    expect(comfortAt(-40)).toBe(-1);
    expect(comfortAt(30)).toBeGreaterThan(0);
    expect(comfortAt(60)).toBe(1);
  });

  it('leaves a settler in a heated cabin comfortable through a storm night', () => {
    const { world, streams } = game(4242);
    addBuilding(world, 'campfire', middle.x, middle.y - 1, true);
    addItem(world, 'wood', 400, middle.x, middle.y + 1);

    // Same held storm as the test below, so the two are the same night with and
    // without a fire in it.
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.weather.kind = 'storm';
      world.weather.blend = 1;
      stepWorldN(world, streams, 1);
    }

    for (const p of world.pawns) {
      if (p.faction !== 'colony' || p.dead) continue;
      // Nobody who slept by a fire wakes up ill from the weather, and nobody is
      // hurt by it: cold costs mood and immunity, never hit points.
      expect(hasAilment(p, 'flu')).toBe(false);
      expect(p.downed).toBe(false);
      // Not `toBe(maxHp)`, and the reason is worth writing down. A storm held at
      // full blend for a whole day is also a day of lightning, and a settler who
      // beat out a strike in the fence line and walked away with a scorch is not
      // a settler the cold hurt — the claim here is about warmth, and a burn is a
      // different system answering a different question. What warmth has to buy
      // is that nobody comes out of the night in any trouble.
      expect(p.hp).toBeGreaterThan(p.maxHp * 0.9);
      // Not a threshold on the illness roll — that would be a claim about where
      // one settler happened to be standing at midnight, and a working colony
      // spends its storm day outdoors on purpose. What a fire and four walls buy
      // is that nobody ends the night anywhere near the dangerous floor
      // (`comfortAt` bottoms out at −1), which is exactly the band the crew
      // pinned in the open below falls into.
      expect(p.comfort ?? 0).toBeGreaterThan(-0.75);
    }
  });

  it('makes a crew that sleeps out in the storms come down with something', () => {
    const { world, streams } = game(101);
    const crew = world.pawns.filter((p) => p.faction === 'colony');
    const yard: Cell[] = [
      { x: 31, y: 20 },
      { x: 32, y: 20 },
      { x: 33, y: 20 },
      { x: 31, y: 21 },
    ];
    for (const c of yard) expect(indoors(world, c.x, c.y)).toBe(false);

    // Midwinter, said out loud rather than inherited from whatever season a fresh
    // world starts in. The claim here is that cold with no shelter in it makes
    // people ill, and the sim only says that past `COLD_ILL_AT` — half of the way
    // to `comfortAt`'s floor. A held storm on a summer day is 4°C at dawn and 12°C
    // by noon: comfort bottoms out around −0.4, the roll is never reached, and the
    // test sat there for four sim-days waiting for a fever the rules had already
    // ruled out. Which is the sim being right — a wet night in June is a bad night,
    // not a sickbed — and the test asking the wrong month.
    world.tick = TICKS_PER_DAY * 12;
    expect(seasonOf(world)).toBe('winter');

    // Pinned in the open, under weather that never lets up: no roof, no fire,
    // nothing to walk back to. This is the shape of the failure, not a normal day
    // — the whole point of the roll is that four walls take you out of it.
    //
    // The storm is re-asserted every tick because the sim's own weather pass owns
    // that field and rolls it forward; setting it once before the loop buys one
    // tick of storm and then whatever the storyteller felt like.
    let caught = false;
    for (let i = 0; i < TICKS_PER_DAY * 4 && !caught; i++) {
      crew.forEach((p, n) => {
        p.x = yard[n % yard.length]!.x;
        p.y = yard[n % yard.length]!.y;
      });
      world.weather.kind = 'storm';
      world.weather.blend = 1;
      stepWorldN(world, streams, 1);
      caught = crew.some((p) => hasAilment(p, 'flu'));
    }
    expect(caught).toBe(true);
    // And it is an illness, not an execution: cold never takes hit points.
    expect(crew.every((p) => !p.dead)).toBe(true);
  });
});
