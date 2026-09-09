/**
 * Temperature and spoilage.
 *
 * The functional half pins the two curves in isolation — what the air does over a
 * day, and how fast a sack of turnips gives up at a given temperature. The
 * experience half asks the only question the player asks: does building a cold
 * store actually keep the food, and does leaving it in the yard actually lose it.
 *
 * The laundering cases exist because rot lives on the stack, and three separate
 * places in the job code merge stacks. Without the weighted merge, a hauler
 * tipping one fresh armful onto a fortnight-old pile would reset its clock, and
 * the whole system would quietly do nothing.
 */

import { describe, expect, it } from 'vitest';

import { FREEZING, cellTemp, outdoorTemp, tickTemperature } from '../src/sim/temperature';
import { SPOIL_DAYS, freshness, spoilFactor, tickSpoilage } from '../src/sim/spoilage';
import { buildingAt, isWalkable } from '../src/sim/grid';
import { CABIN, createWorld } from '../src/sim/worldgen';
import { addBuilding, addCellToZone, addItem, addZone, countResource, mergeRot } from '../src/sim/world';
import { coldStoreOpen, findStockpileCell } from '../src/sim/jobs';
import { MAX_STACK } from '../src/sim/world';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import type { Streams } from '../src/sim/tick';
import { setPriority } from '../src/sim/orders';
import { indoors, roomAt } from '../src/sim/rooms';
import { tickPower } from '../src/sim/power';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { Cell, ItemStack, World } from '../src/sim/types';

function game(seed = 90210) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

/** A cell well inside the starter cabin — walls on every side, so `indoors`. */
function indoorCell(): Cell {
  return { x: Math.round((CABIN.x0 + CABIN.x1) / 2), y: Math.round((CABIN.y0 + CABIN.y1) / 2) };
}

/**
 * A cell of open yard. Not just "not in the cabin" — the map's rocky border closes
 * the outdoors into a region of its own, so an outdoor cell has to come from the
 * middle of the map rather than the edge of it, and it has to be ground a cooler
 * can actually be built on.
 *
 * It used to be the literal (31,20), which is a way of writing "seventeen west and
 * twenty-eight south of the cabin" and then not writing it down. The cabin is
 * measured from the middle of the map; the constant was not. When the valley grew
 * from 96 to 128 that cell became rim rock — still outdoors, so most of the tests
 * here carried on passing, and the one that parks a cooler in the yard started
 * getting null back from `addBuilding`. Searching out from the cabin says what
 * every caller actually means.
 */
function openCell(world: World): Cell {
  const from = indoorCell();
  for (let r = 6; r < 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = from.x + dx;
        const y = from.y + dy;
        if (!isWalkable(world, x, y) || buildingAt(world, x, y)) continue;
        if (indoors(world, x, y)) continue;
        return { x, y };
      }
    }
  }
  throw new Error('no open yard on this map');
}

/**
 * The bottom two rows of the cabin's west end, walled off into a pantry — the
 * same six cells the Steward partitions, for the same reason.
 *
 * A cooler holds a room now, not a radius, and the room is the whole decision: it
 * takes the ninety-nine-cell cabin down a few degrees and these six below zero.
 * So a spoilage test cannot just drop a cooler indoors and expect frost; it has
 * to build the small room first, exactly like a player.
 */
const LARDER = { x: CABIN.x0 + 1, y: CABIN.y1 - 2 };

/** The walls, the door, and nothing else. Returns a free cell inside. */
function larderShell(world: World): Cell {
  for (let x = LARDER.x; x < LARDER.x + 3; x++) {
    expect(addBuilding(world, 'wall', x, LARDER.y - 1, true)).not.toBeNull();
  }
  expect(addBuilding(world, 'wall', LARDER.x + 3, LARDER.y + 1, true)).not.toBeNull();
  expect(addBuilding(world, 'door', LARDER.x + 3, LARDER.y, true)).not.toBeNull();
  return { x: LARDER.x + 1, y: LARDER.y + 1 };
}

/**
 * That pantry with a cooler in it, plugged in the way a player would plug it in.
 *
 * The flag a cooler reads is set by the power pass, so a test that pokes
 * `powered = true` by hand gets it switched straight back off on the next tick of
 * the real loop. The cabin's own walls conduct and the generator sits against
 * them, so the machine only has to touch one — and the woodpile is topped up so
 * that which day the generator runs dry is never the thing under test here.
 */
function coldStore(world: World): Cell {
  const spot = larderShell(world);
  const cooler = addBuilding(world, 'cooler', LARDER.x, LARDER.y + 1, true);
  expect(cooler).not.toBeNull();
  addItem(world, 'wood', 400, CABIN.x0 + 4, CABIN.y0 + 4);
  tickPower(world);
  expect(cooler!.powered).toBe(true);
  return spot;
}

/** Park the world at a known hour so the outdoor curve stops moving under a test. */
function atHour(world: World, fraction: number): void {
  world.tick = Math.round(TICKS_PER_DAY * fraction);
}

/** Clear weather, so the weather offset contributes nothing. */
function calm(world: World): void {
  world.weather.kind = 'clear';
  world.weather.blend = 1;
}

/**
 * Let the machine run.
 *
 * A room carries its heat, so one that has just been partitioned off starts at
 * whatever the cabin was and works down from there — a cooler switched on this
 * tick has not chilled anything yet, exactly as a player sees it. Three hundred
 * ticks is about four game-hours, comfortably past the six-cell time constant.
 */
function settleFor(world: World, ticks = 300): void {
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickTemperature(world);
  }
}

// ---------------------------------------------------------------------------
// Functional: the temperature model
// ---------------------------------------------------------------------------

describe('outdoor temperature', () => {
  it('peaks in the afternoon and bottoms before dawn', () => {
    const { world } = game();
    calm(world);

    atHour(world, 0.6);
    const peak = outdoorTemp(world);
    atHour(world, 0.1);
    const trough = outdoorTemp(world);

    expect(peak).toBeGreaterThan(trough);
    // The swing has to be big enough that the day/night cycle is the dominant
    // term in spoilage, not a rounding error on it.
    expect(peak - trough).toBeGreaterThan(12);
    // ...and small enough that an unremarkable afternoon is not lethal weather.
    expect(peak).toBeLessThan(30);
    expect(trough).toBeGreaterThan(-10);
  });

  it('is colder under rain than under clear sky at the same hour', () => {
    const { world } = game();
    atHour(world, 0.5);

    calm(world);
    const clear = outdoorTemp(world);
    world.weather.kind = 'rain';
    world.weather.blend = 1;
    const wet = outdoorTemp(world);

    expect(wet).toBeLessThan(clear);
  });

  it('scales the weather offset by how far the front has moved in', () => {
    const { world } = game();
    atHour(world, 0.5);
    world.weather.kind = 'storm';

    world.weather.blend = 0;
    const none = outdoorTemp(world);
    world.weather.blend = 0.5;
    const half = outdoorTemp(world);
    world.weather.blend = 1;
    const full = outdoorTemp(world);

    expect(half).toBeLessThan(none);
    expect(full).toBeLessThan(half);
  });
});

describe('cell temperature', () => {
  it('treats a walled room as indoors and the open map as outdoors', () => {
    const { world } = game();
    const inside = indoorCell();
    const out = openCell(world);
    expect(indoors(world, inside.x, inside.y)).toBe(true);
    expect(indoors(world, out.x, out.y)).toBe(false);
    // And the cabin is one room of the size it looks: 11 by 9 of floor.
    expect(roomAt(world, inside.x, inside.y)?.size).toBe(99);
  });

  it('damps the day swing indoors instead of tracking it', () => {
    const { world } = game();
    calm(world);
    const inside = indoorCell();
    const out = openCell(world);

    atHour(world, 0.6);
    const dayIn = cellTemp(world, inside.x, inside.y);
    const dayOut = cellTemp(world, out.x, out.y);
    atHour(world, 0.1);
    const nightIn = cellTemp(world, inside.x, inside.y);
    const nightOut = cellTemp(world, out.x, out.y);

    // Warmer than the yard at night, cooler than the yard at the peak: that is
    // what "indoors" means, and it is the whole reason a larder is a room.
    expect(nightIn).toBeGreaterThan(nightOut);
    expect(dayIn).toBeLessThan(dayOut);
    expect(dayIn - nightIn).toBeLessThan(dayOut - nightOut);
  });

  it('freezes the small room a built cooler stands in, and nothing outdoors', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.6); // hottest hour, so the drop is unambiguous
    const inside = indoorCell();

    const warm = cellTemp(world, inside.x, inside.y);
    expect(warm).toBeGreaterThan(FREEZING);

    const shelf = coldStore(world);
    settleFor(world);
    expect(cellTemp(world, shelf.x, shelf.y)).toBeLessThan(FREEZING);

    // A cooler standing in the open yard is a very expensive ornament.
    const out = openCell(world);
    const outdoor = addBuilding(world, 'cooler', out.x, out.y, true);
    expect(outdoor).not.toBeNull();
    settleFor(world);
    expect(cellTemp(world, out.x, out.y)).toBeGreaterThan(FREEZING);
  });

  it('leaves the rest of the cabin liveable while the pantry freezes', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.1); // coldest hour: the worst case for the people in the beds
    const shelf = coldStore(world);
    const inside = indoorCell();
    settleFor(world);

    // The failure this pins is a freezer that takes the bedroom with it. Six
    // cells go below zero; the ninety-three the settlers sleep in do not, and
    // stay well clear of the temperature that starts costing them mood.
    expect(cellTemp(world, shelf.x, shelf.y)).toBeLessThan(FREEZING);
    expect(cellTemp(world, inside.x, inside.y)).toBeGreaterThan(8);
    expect(roomAt(world, shelf.x, shelf.y)?.size).toBe(6);
    expect(roomAt(world, inside.x, inside.y)?.size).toBe(99 - 6 - 5);
  });

  it('does not cool while it is still a blueprint', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.6);
    const shelf = larderShell(world);

    addBuilding(world, 'cooler', LARDER.x, LARDER.y + 1, false);
    settleFor(world);
    expect(cellTemp(world, shelf.x, shelf.y)).toBeGreaterThan(FREEZING);
  });

  it('does not cool with no power behind it', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.6);
    const shelf = larderShell(world);

    // Built, indoors, and unplugged: a cooler off the grid is a cupboard.
    const cooler = addBuilding(world, 'cooler', LARDER.x, LARDER.y + 1, true)!;
    cooler.powered = false;
    settleFor(world);
    expect(cellTemp(world, shelf.x, shelf.y)).toBeGreaterThan(FREEZING);
  });
});

// ---------------------------------------------------------------------------
// Functional: the spoilage curve
// ---------------------------------------------------------------------------

describe('spoil factor', () => {
  it('stops dead at freezing', () => {
    expect(spoilFactor(FREEZING)).toBe(0);
    expect(spoilFactor(-12)).toBe(0);
  });

  it('is the reference rate at room temperature and rises with heat', () => {
    expect(spoilFactor(20)).toBeCloseTo(1, 5);
    expect(spoilFactor(30)).toBeGreaterThan(spoilFactor(20));
    // Capped, so a freak hot day cannot delete a whole pantry in an afternoon.
    expect(spoilFactor(200)).toBeLessThanOrEqual(2.2);
  });
});

describe('freshness', () => {
  it('reports non-perishables as fresh whatever their rot field says', () => {
    expect(freshness('steel', 0.9)).toBe(1);
    expect(freshness('wood', undefined)).toBe(1);
  });

  it('reads an absent rot field as untouched', () => {
    expect(freshness('rawfood', undefined)).toBe(1);
    expect(freshness('meal', 0.25)).toBeCloseTo(0.75, 5);
  });

  it('rots meals faster than the raw food they are made from', () => {
    // So "cook the lot the moment it lands" is not simply the right answer.
    expect(SPOIL_DAYS.meal!).toBeLessThan(SPOIL_DAYS.rawfood!);
  });
});

describe('rot arithmetic', () => {
  it('weights a merge by amount', () => {
    const dest = { amount: 30, rot: 0.8 } as ItemStack;
    mergeRot(dest, 10, 0);
    // 30 old units and 10 fresh ones: three quarters of the pile is still old.
    expect(dest.rot).toBeCloseTo(0.6, 5);
  });

  it('will not let one fresh unit launder a big old pile', () => {
    const dest = { amount: 70, rot: 0.95 } as ItemStack;
    mergeRot(dest, 1, 0);
    expect(dest.rot!).toBeGreaterThan(0.93);
  });

  it('leaves a fresh stack fresh', () => {
    const dest = { amount: 20 } as ItemStack;
    mergeRot(dest, 20, 0);
    expect(dest.rot).toBe(0);
  });

  it('ages a stockpile only in proportion to what was already there', () => {
    const { world } = game();
    const first = addItem(world, 'rawfood', 20, 6, 6)!;
    first.rot = 0.5;
    addItem(world, 'rawfood', 20, 6, 6);
    // Same cell, same kind: addItem merged, so the pile is half as far gone.
    expect(world.items.filter((s) => s.x === 6 && s.y === 6).length).toBe(1);
    expect(first.amount).toBe(40);
    expect(first.rot).toBeCloseTo(0.25, 5);
  });
});

describe('tickSpoilage', () => {
  it('writes off an open-air sack of raw food in about a fortnight', () => {
    const { world } = game();
    const out = openCell(world);
    const stack = addItem(world, 'rawfood', 40, out.x, out.y)!;
    // Clear sky, real clock, nothing else running: this measures the spoilage
    // curve integrated over an actual day/night cycle and nothing else.
    calm(world);

    let ticks = 0;
    const limit = TICKS_PER_DAY * 40;
    while (world.items.includes(stack) && ticks < limit) {
      world.tick++;
      tickSpoilage(world);
      ticks++;
    }
    const days = ticks / TICKS_PER_DAY;
    // The reference is ten days at 20°C; the outdoor mean at landfall is 13°C,
    // so the yard starts at about two-thirds rate. Three weeks rather than a
    // fortnight because this sack lives long enough to reach winter: from day
    // eleven the yard is below freezing at night and near it by day, which all
    // but stops the clock, and the run only finishes once spring thaws it. That
    // is the model being consistent — cold keeps food, and a sack left out over
    // winter really is in a cold store. The band is wide enough to survive a
    // tuning nudge to the swing, tight enough to catch an order-of-magnitude slip.
    expect(days).toBeGreaterThan(11);
    expect(days).toBeLessThan(28);
  });

  it('never touches a stack that is frozen solid', () => {
    const { world } = game();
    calm(world);
    const shelf = coldStore(world);
    const stack = addItem(world, 'rawfood', 40, shelf.x, shelf.y)!;

    for (let i = 0; i < TICKS_PER_DAY * 30; i++) {
      world.tick++;
      tickSpoilage(world);
    }
    expect(world.items).toContain(stack);
    expect(stack.rot ?? 0).toBe(0);
  });

  it('halves the rate meals go off at once Preserved rations is done', () => {
    const rot = (researched: boolean): number => {
      const { world } = game();
      const out = openCell(world);
      calm(world);
      if (researched) world.research.done.push('preserves');
      const stack = addItem(world, 'meal', 20, out.x, out.y)!;
      for (let i = 0; i < TICKS_PER_DAY; i++) {
        world.tick++;
        tickSpoilage(world);
      }
      return stack.rot ?? 0;
    };

    const plain = rot(false);
    const salted = rot(true);
    expect(plain).toBeGreaterThan(0);
    expect(salted).toBeCloseTo(plain / 2, 5);
    // And the project does nothing at all for a sack of turnips.
    expect(SPOIL_DAYS.rawfood).toBe(10);
  });

  it('leaves steel and wood alone forever', () => {
    const { world } = game();
    const steel = addItem(world, 'steel', 50, 7, 7)!;
    const wood = addItem(world, 'wood', 50, 8, 8)!;

    for (let i = 0; i < TICKS_PER_DAY * 60; i++) {
      world.tick++;
      tickSpoilage(world);
    }
    expect(steel.rot).toBeUndefined();
    expect(wood.rot).toBeUndefined();
  });

  it('tells the player when a pile is written off', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.6);
    const out = openCell(world);
    const stack = addItem(world, 'rawfood', 12, out.x, out.y)!;
    stack.rot = 0.995;

    const before = world.messages.length;
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.tick++;
      tickSpoilage(world);
    }
    expect(world.items).not.toContain(stack);
    expect(world.messages.length).toBeGreaterThan(before);
    expect(world.messages.some((m) => m.text.includes('spoiled'))).toBe(true);
  });

  it('does not spoil what a settler is carrying', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.6);
    const out = openCell(world);
    const stack = addItem(world, 'rawfood', 12, out.x, out.y)!;
    stack.rot = 0.999;
    stack.carriedBy = world.pawns[0]!.id;

    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.tick++;
      tickSpoilage(world);
    }
    // An armful in transit is about to be dropped somewhere; deleting it out of
    // a settler's hands is the kind of thing that reads as a bug.
    expect(world.items).toContain(stack);
  });
});

// ---------------------------------------------------------------------------
// Experience: does the cold store earn its steel?
// ---------------------------------------------------------------------------

describe('the larder, played', () => {
  /**
   * Mark a pile as already claimed. `reservedBy` holds a job id, and no job will
   * ever be numbered this high, so the settlers walk past it for good — which is
   * what this test needs, because three people eating for a fortnight would empty
   * both piles long before either had a chance to go off. Spoilage itself does
   * not look at reservations, so the two piles are treated identically.
   *
   * A reservation stops a pile being *taken* and does nothing to stop one being
   * added to. `dropCarried` looks for a stack on the cell of the same kind with
   * `amount < MAX_STACK` and tips the armful into it; it never reads
   * `reservedBy`, and `mergeRot` then averages the two clocks. Measured on seed
   * 4242: on day three a settler put five units of yard food away in the cold
   * store, the shelf pile went 60 to 65, and its rot went 0.0000 to 0.0177 —
   * the colony doing exactly the right thing with warm food, and reading here as
   * the freezer failing. `downToolsOnFood` cannot close it either, however often
   * it is called: it reaches the settlers standing there at the time, and an
   * arrival has the rest of the day with hauling on.
   *
   * So the other half of untouchable is a full stack. The merge needs somewhere
   * to put the armful and a pile already at the ceiling has none — a property of
   * the pile itself rather than of anybody's priorities, which is what makes it
   * hold for a fortnight. Both piles and not only the one on the shelf, because
   * the yard is the control, and a control that keeps on different terms from
   * the thing it is controlling for is not one.
   */
  function untouchable(stack: ItemStack): ItemStack {
    stack.reservedBy = 1e9;
    return stack;
  }

  /**
   * Hold the storyteller off for the length of the run.
   *
   * Twenty-eight days is long enough that this test was quietly staking its
   * result on the colony surviving a month of raids, fires and fevers intact —
   * and on seed 4242 it does not: a fire on day 21 takes the cabin, the
   * generator, the cooler and a settler with it, the larder thaws, and the
   * failure reads as a spoilage bug when it is a burnt-down colony. Worse, which
   * way that day goes turns on how a raid on day nine happened to play out, so
   * *any* change to combat re-rolls it, and this test starts failing for reasons
   * that have nothing to do with food. Peace is the honest fixture: the claim
   * here is about a cold store, not about firefighting.
   */
  function peacetime(world: World): void {
    world.storyteller.nextThreat = TICKS_PER_DAY * 400;
  }

  /** Stop everyone hauling the test piles into a stockpile and merging them away. */
  function downToolsOnFood(world: World): void {
    for (const p of world.pawns) {
      if (p.faction !== 'colony') continue;
      setPriority(world, p.id, 'haul', 0);
      setPriority(world, p.id, 'cook', 0);
    }
  }

  /**
   * A fortnight with the crew's hands kept off the food, day by day.
   *
   * `downToolsOnFood` only reaches the settlers standing there when it is called,
   * and a colony that survives a fortnight takes in new ones — five of them here,
   * arriving with hauling on. Once the Steward learnt to wall a cold store it also
   * paints a stockpile over it, so those arrivals cheerfully carried warm food onto
   * the shelf and `mergeRot` averaged their rot into a pile this test needs
   * untouched: the larder came out of the run at 75 units and 0.08 rot, both of
   * them the colony's doing rather than the freezer's.
   */
  function quietFortnight(world: World, streams: Streams): void {
    for (let d = 0; d < 14; d++) {
      downToolsOnFood(world);
      stepWorldN(world, streams, TICKS_PER_DAY);
    }
  }

  it('loses an open-air surplus over a fortnight and keeps the cold-stored one', () => {
    // A month of the real loop, so the colony has to keep its grid up as well as
    // its walls: at seed 1337 a fire takes the generator out on day four and the
    // larder thaws, which is the game working rather than the freezer failing.
    // The `powered` assertion at the end is what tells the two apart.
    const { world, streams } = game(4242);
    downToolsOnFood(world);
    peacetime(world);
    const out = openCell(world);
    const shelf = coldStore(world);
    const cooler = world.buildings.find((b) => b.kind === 'cooler')!;

    const yard = untouchable(addItem(world, 'rawfood', MAX_STACK, out.x, out.y)!);
    const larder = untouchable(addItem(world, 'rawfood', MAX_STACK, shelf.x, shelf.y)!);

    quietFortnight(world, streams);

    // A fortnight in, the yard pile is visibly going and the larder has not moved.
    expect(yard.rot ?? 0).toBeGreaterThan(0.45);
        expect(larder.rot ?? 0).toBe(0);

    quietFortnight(world, streams);

    expect(world.items).not.toContain(yard);
    expect(world.items).toContain(larder);
    expect(larder.amount).toBe(MAX_STACK);
    expect(larder.rot ?? 0).toBe(0);
    // The precondition, stated out loud: a freezer is only a freezer while the
    // wattage holds.
    expect(cooler.powered).toBe(true);
    // Twenty-eight days is 134 400 ticks of the real loop, which is about seventy
    // seconds on its own and rather more when the rest of the suite is running
    // beside it. The default budget is for tests that should be quick; this one is
    // deliberately not, so it says so rather than failing as a timeout.
    //
    // "Rather more" turned out to be the whole story. The suite now spends close
    // to forty minutes of CPU inside a six-minute wall clock, so the longest runs
    // in it are contending with seventy-odd other files and take three to five
    // times what they take alone — 240 s was comfortable when this was written and
    // is not any more. Raised rather than shortened on purpose: the twenty-eight
    // days *is* the claim, and trimming it to fit a clock would quietly stop
    // testing the thing the test is named after.
    //
    // Raised a second time, and the reason is one worth remembering: making the
    // colony *better* made this test slower. The hauling levers (see
    // `tests/hauling.test.ts`) roughly doubled how much a colony gets built, and a
    // colony with twice the base is a colony with more standing buildings, more
    // power grid and more jobs to price every tick. Measured outside vitest this
    // run is now 111 s of solid CPU, not seventy; it burnt 487 s of the 480 s
    // budget under suite load. Every gameplay win of that shape lands here as a
    // clock, so the budget is set with room for the next one rather than to the
    // last measurement.
    //
    // Raised a third time, and by now the pattern has a name: this number tracks
    // the size of the world, not the state of the code. The map went from 96×96
    // to 192×192 to give the wildlife somewhere to live, which is four times the
    // cells for every per-cell scan in the loop, and this run went from 111 s to
    // 531 s measured alone — near enough the same four. Six workers on four
    // performance cores then turn 531 s of CPU into more than 900 s of clock and
    // the file fails as a timeout with nothing wrong in it.
    //
    // So: 1 800 s, which is three and a half times a measurement rather than a
    // guess on top of the last guess. If the map grows again, expect to be back
    // here, and multiply rather than add — the cost is per-cell.
  }, 1_800_000);

  it('does not spoil anything in a colony that eats what it grows', () => {
    // The balance guard. A player who plays normally for a week should never see
    // a spoil message — the rule is meant to punish hoarding, not eating.
    const { world, streams } = game(20260729);
    const before = countResource(world, 'rawfood') + countResource(world, 'meal');
    expect(before).toBeGreaterThan(0);

    stepWorldN(world, streams, TICKS_PER_DAY * 7);

    expect(world.messages.some((m) => m.text.includes('spoiled'))).toBe(false);
  });

  it('survives fourteen days of the real loop without breaking anything', () => {
    const { world, streams } = game(777);
    const shelf = coldStore(world);
    addItem(world, 'rawfood', 40, shelf.x, shelf.y);

    stepWorldN(world, streams, TICKS_PER_DAY * 14);

    // No negative or NaN stacks anywhere, which is the failure mode a weighted
    // average introduces if a merge ever runs with a zero total.
    for (const s of world.items) {
      expect(Number.isFinite(s.amount)).toBe(true);
      expect(s.amount).toBeGreaterThan(0);
      const rot = s.rot ?? 0;
      expect(Number.isFinite(rot)).toBe(true);
      expect(rot).toBeGreaterThanOrEqual(0);
      expect(rot).toBeLessThan(1);
    }
  });
});


// ---------------------------------------------------------------------------
// Moving what is already put away
// ---------------------------------------------------------------------------

/**
 * A stockpile painted over the cold room, taking food and nothing else.
 *
 * This is what the `cellar` ambition paints, done by hand so the hauling rules
 * can be tested without running the Steward.
 */
function coldLarder(world: World, at: Cell): void {
  const z = addZone(world, 'stockpile', ['rawfood', 'meal']);
  addCellToZone(world, z, at.x, at.y);
}

describe('food already in a warm store', () => {
  /**
   * Put away is not the same as put away properly.
   *
   * Before this, `needsHauling` answered "is it in a stockpile that takes it",
   * which is true of a sack of meat sitting two cells from the stove — so the
   * heap the colony started with stayed in the cabin and rotted while every new
   * harvest was routed correctly past it into the cellar. Measured on seed 7 over
   * forty harsh days: 268 food spoiled and not one unit was ever frozen.
   */
  it('is somewhere to move it to once a cold shelf has room', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.6);
    const shelf = coldStore(world);
    settleFor(world);
    expect(cellTemp(world, shelf.x, shelf.y)).toBeLessThan(FREEZING);

    coldLarder(world, shelf);
    expect(coldStoreOpen(world, 'rawfood')).toBe(true);
    // And the drop cell the colony would choose for it is the cold one, which is
    // the half of this that was already working.
    const drop = findStockpileCell(world, 'rawfood');
    expect(drop).not.toBeNull();
    expect(cellTemp(world, drop!.x, drop!.y)).toBeLessThan(FREEZING);
  });

  /**
   * The guard that stops the colony carrying the same sack back and forth for
   * ever. A full cellar is not somewhere to put anything, so the answer has to be
   * about *room* and not merely about a cold room existing — and the cabin is
   * then the fallback, which is what the colony wants.
   */
  it('stays where it is when the cold shelf is full', () => {
    const { world } = game();
    calm(world);
    atHour(world, 0.6);
    const shelf = coldStore(world);
    settleFor(world);
    coldLarder(world, shelf);

    addItem(world, 'rawfood', MAX_STACK, shelf.x, shelf.y);
    expect(coldStoreOpen(world, 'rawfood')).toBe(false);
    // Not "nowhere at all" — the warm larder still takes it. A colony whose
    // cellar is full must still have somewhere to put the harvest.
    expect(findStockpileCell(world, 'rawfood')).not.toBeNull();
  });

  it('has nowhere colder to be before anybody builds a cellar', () => {
    const { world } = game();
    calm(world);
    expect(coldStoreOpen(world, 'rawfood')).toBe(false);
    // Steel does not care how warm it is, and must never start a haul on this
    // account.
    expect(coldStoreOpen(world, 'steel')).toBe(false);
  });

  /**
   * The experience half: leave the colony alone with a cold room standing and a
   * warm heap in the cabin, and the settlers move the food themselves. No orders,
   * no player input — just the ordinary haul work type doing its round.
   */
  it('gets carried into the cellar by settlers left to their own devices', () => {
    const { world, streams } = game();
    calm(world);
    const shelf = coldStore(world);
    settleFor(world);
    coldLarder(world, shelf);

    // A sack in the warm cabin larder — already in a stockpile that accepts it,
    // which is precisely the case the old rule called "done".
    const warm = indoorCell();
    const zone = addZone(world, 'stockpile', ['rawfood', 'meal']);
    addCellToZone(world, zone, warm.x, warm.y);
    addItem(world, 'rawfood', 40, warm.x, warm.y);
    expect(cellTemp(world, warm.x, warm.y)).toBeGreaterThan(FREEZING);

    const before = countResource(world, 'rawfood');
    for (const p of world.pawns) setPriority(world, p.id, 'haul', 4);
    // Wind the clock to the middle of the working day first. Settlers do not haul
    // in their sleep, and a run that starts at the default hour spends most of
    // twelve hundred ticks in bed and moves nothing.
    atHour(world, 0.4);
    stepWorldN(world, streams, 1200);

    // Nothing was eaten into oblivion or lost on the way — it moved.
    expect(countResource(world, 'rawfood')).toBeGreaterThan(0);
    let frozen = 0;
    for (const s of world.items) {
      if (s.kind !== 'rawfood' || s.carriedBy !== null) continue;
      if (cellTemp(world, s.x, s.y) <= FREEZING) frozen += s.amount;
    }
    // The sack that started warm in the cabin is now standing in the freezer,
    // which is the whole of what the colony was asked to do. Not every crumb on
    // the map moves in twelve hundred ticks — the far heaps are somebody else's
    // errand — so this asserts the journey happened, not that the map is tidy.
    expect(frozen).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });
});
