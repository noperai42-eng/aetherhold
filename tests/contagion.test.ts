/**
 * Catching it off somebody else, and the room as the only thing that stops it.
 *
 * The flu is the one thing in `health.ts` that passes between people. Everything
 * a colony can do about an outbreak comes out of a single rule — two settlers
 * share air if they are standing in the same enclosed room — and the point of
 * these tests is that the rule really is the only one. A hall is eight people
 * breathing on each other all night. A room of one's own is one person in a
 * room, with nobody to catch it from. The yard is not a room at all.
 *
 * The functional half pins that rule from four sides. The experience half runs a
 * real colony with one sick settler in it and watches the difference the doors
 * make: measured on seed 4242, twelve days, the shared hall reached every
 * settler in the colony and the same colony with its bunks moved into rooms held
 * the outbreak at the one who arrived with it.
 */

import { describe, expect, it } from 'vitest';

import { CONTAGION_INTERVAL, afflict, hasAilment, tickContagion } from '../src/sim/health';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { addBuilding, addItem, livingColonists } from '../src/sim/world';
import { createWorld, makePawn } from '../src/sim/worldgen';
import { buildingAt } from '../src/sim/grid';
import { roomAt } from '../src/sim/rooms';
import { heart } from '../src/sim/steward';
import { planBunkhouse } from '../src/sim/annex';
import { Rng } from '../src/sim/rng';
import type { Pawn, World } from '../src/sim/types';

/** A world with nobody in it — see `tests/feeding.test.ts`. */
function empty(seed = 1337): World {
  const w = createWorld(seed);
  w.pawns.length = 0;
  w.jobs.length = 0;
  w.items.length = 0;
  return w;
}

/** Wall a box in the yard and hand back a cell inside it. */
function box(w: World, x0: number, y0: number, wide = 2, deep = 2): { x: number; y: number } {
  for (let x = x0 - 1; x <= x0 + wide; x++) {
    for (let y = y0 - 1; y <= y0 + deep; y++) {
      const inside = x >= x0 && x < x0 + wide && y >= y0 && y < y0 + deep;
      if (inside || buildingAt(w, x, y)) continue;
      addBuilding(w, 'wall', x, y, true);
    }
  }
  if (!roomAt(w, x0, y0)) throw new Error('the box did not enclose');
  return { x: x0, y: y0 };
}

function stand(w: World, x: number, y: number): Pawn {
  const p = makePawn(w, new Rng(7 + w.pawns.length), 'colony', x, y);
  p.x = x;
  p.y = y;
  p.jobId = null;
  p.path = null;
  return p;
}

/**
 * Roll the pass `days` worth of times. Only the contagion pass runs: a full
 * `stepWorld` would have them wander off, get hungry and cure each other, and
 * the thing under test would be the colony rather than the rule.
 */
function share(w: World, rng: Rng, days: number): void {
  const rolls = Math.round((2400 / CONTAGION_INTERVAL) * days);
  for (let i = 0; i < rolls; i++) {
    w.tick += CONTAGION_INTERVAL;
    tickContagion(w, rng);
  }
}

describe('sharing a room (functional)', () => {
  it('passes it to somebody standing in the same room', () => {
    const w = empty();
    const spot = box(w, 20, 20, 2, 2);
    const sick = stand(w, spot.x, spot.y);
    const well = stand(w, spot.x + 1, spot.y);
    afflict(w, sick, 'flu', false);

    share(w, new Rng(5), 20);

    expect(hasAilment(well, 'flu'), 'twenty days beside it and never caught it').toBe(true);
  });

  it('leaves somebody who has a room to themselves alone', () => {
    // The whole point of a door, and the reason the private room stopped being
    // a mood and became the thing that keeps a colony on its feet.
    const w = empty();
    const a = box(w, 20, 20, 2, 2);
    const b = box(w, 30, 20, 2, 2);
    const sick = stand(w, a.x, a.y);
    const well = stand(w, b.x, b.y);
    afflict(w, sick, 'flu', false);

    share(w, new Rng(5), 20);

    expect(hasAilment(well, 'flu'), 'it got through a wall').toBe(false);
  });

  it('does not spread across the open yard', () => {
    // Standing outside is not a room. A colony working in the fields all day is
    // not infecting itself while it works — what the yard does to a settler is
    // the weather's business, and that is priced in `maybeExposureFlu`.
    const w = empty();
    const sick = stand(w, 40, 40);
    const well = stand(w, 41, 40);
    afflict(w, sick, 'flu', false);

    share(w, new Rng(5), 20);

    expect(hasAilment(well, 'flu')).toBe(false);
  });

  it('does not hand it straight back to somebody just over it', () => {
    // `wellUntil` is the convalescence, and without this the settler who shook
    // it off in the sickbed catches it again on their way out of the room.
    const w = empty();
    const spot = box(w, 20, 20, 2, 2);
    const sick = stand(w, spot.x, spot.y);
    const mending = stand(w, spot.x + 1, spot.y);
    afflict(w, sick, 'flu', false);
    mending.wellUntil = w.tick + 2400 * 30;

    share(w, new Rng(5), 20);

    expect(hasAilment(mending, 'flu')).toBe(false);
  });

  it('spreads faster the more of the room is already ill', () => {
    // Rate is per sick person in the room, so a hall that is half down is a
    // worse place to sleep than a hall with one cough in it.
    //
    // Counted over thirty separate rooms rather than watched in one, and the
    // first cut of this test is the reason. Four well settlers in a room for a
    // day is a sample of four: three sick neighbours caught two of them and one
    // sick neighbour caught three, which is not the rule failing, it is dice.
    // Each trial here is its own world and its own stream, and what is compared
    // is how many of thirty rooms lost their one well settler.
    function caughtIn(sickCount: number): number {
      let caught = 0;
      for (let trial = 0; trial < 30; trial++) {
        // The same map every trial — only the dice change, so what is being
        // compared is the rule and not thirty different pieces of ground.
        const w = empty();
        const spot = box(w, 20, 20, 4, 3);
        for (let i = 0; i < sickCount; i++) {
          afflict(w, stand(w, spot.x + i, spot.y), 'flu', false);
        }
        const well = stand(w, spot.x, spot.y + 1);
        share(w, new Rng(11 + trial), 0.25);
        if (hasAilment(well, 'flu')) caught++;
      }
      return caught;
    }
    expect(caughtIn(3)).toBeGreaterThan(caughtIn(1));
  });
});

describe('an outbreak in a real colony (experience)', () => {
  /** Wall `n` rooms off the cabin and carry a hall bunk into each. */
  function house(w: World, n: number): number {
    let made = 0;
    const hosts = [heart(w)!];
    for (let i = 0; i < n; i++) {
      const plan = planBunkhouse(w, hosts);
      if (!plan) break;
      for (const c of plan.walls) if (!buildingAt(w, c.x, c.y)) addBuilding(w, 'wall', c.x, c.y, true);
      if (!buildingAt(w, plan.door.x, plan.door.y)) {
        addBuilding(w, 'door', plan.door.x, plan.door.y, true);
      }
      const spot = plan.floor[0]!;
      const room = roomAt(w, spot.x, spot.y);
      if (!room) break;
      const hall = heart(w)!;
      const bunk = w.buildings.find(
        (b) => b.built && b.kind === 'bed' && roomAt(w, b.x, b.y)?.id === hall.id,
      );
      if (bunk) {
        w.buildings.splice(w.buildings.indexOf(bunk), 1);
        w.cellBuilding[bunk.y * w.width + bunk.x] = -1;
        addBuilding(w, 'bed', spot.x, spot.y, true);
      }
      hosts.unshift(room);
      made++;
    }
    return made;
  }

  /** One settler comes home with it. How far does it get in twelve days? */
  function outbreak(rooms: number): { peak: number; of: number } {
    const w = createWorld(4242);
    const streams = makeStreams(w);
    const home = livingColonists(w)[0]!;
    addItem(w, 'wood', 900, Math.round(home.x) + 3, Math.round(home.y));
    if (rooms > 0) expect(house(w, rooms), 'nowhere to put the rooms').toBeGreaterThan(3);
    afflict(w, livingColonists(w)[0]!, 'flu', false);
    let peak = 0;
    let of = livingColonists(w).length;
    for (let d = 0; d < 12; d++) {
      stepWorldN(w, streams, 2400);
      const ill = livingColonists(w).filter((p) => hasAilment(p, 'flu')).length;
      if (ill > peak) peak = ill;
      of = Math.max(of, livingColonists(w).length);
    }
    return { peak, of };
  }

  it('runs through a shared hall and stops at the door of a private room', () => {
    const hall = outbreak(0);
    const rooms = outbreak(6);
    expect(hall.peak, 'the hall shrugged it off').toBeGreaterThan(rooms.peak);
    expect(rooms.peak, 'a door did not hold it at all').toBeLessThan(hall.of);
  });
});
