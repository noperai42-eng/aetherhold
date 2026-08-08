/**
 * The grid.
 *
 * Power is the first system in this colony that can take another system away:
 * an unlit lamp is cosmetic, but a cooler that loses its watts loses a fortnight
 * of food, and a turret that loses its watts loses the colony. So the rules are
 * pinned here rather than inferred from the systems downstream — what carries
 * current, what a generator costs to run, and above all the order things go dark
 * in, because that order is the only thing standing between a brownout and a
 * wipe.
 */

import { describe, expect, it } from 'vitest';

import { tickCombat } from '../src/sim/combat';
import { stewardTick } from '../src/eval/steward';
import { isWalkable } from '../src/sim/grid';
import {
  BATTERY_CAPACITY,
  GENERATOR_OUTPUT,
  SOLAR_OUTPUT,
  WOOD_BURN_TICKS,
  networkOf,
  powerLabel,
  powerNetworks,
  solarOutput,
  tickPower,
} from '../src/sim/power';
import { Rng } from '../src/sim/rng';
import { cellTemp, outdoorTemp } from '../src/sim/temperature';
import { TICKS_PER_DAY, type Building, type World } from '../src/sim/types';
import { addBuilding, countResource, takeResource } from '../src/sim/world';
import { CABIN, createWorld, makePawn } from '../src/sim/worldgen';

/** Open ground `w` by `h`, well clear of the cabin, its rocks and its trees. */
function clearing(world: World, w: number, h: number): { x: number; y: number } {
  for (let y = 4; y < world.height - h - 4; y++) {
    for (let x = 4; x < world.width - w - 4; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w && ok; dx++) {
          if (!isWalkable(world, x + dx, y + dy)) ok = false;
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no clearing');
}

/** `addBuilding`, but loud about it: a null here silently voids the test below it. */
function put(world: World, kind: Building['kind'], x: number, y: number): Building {
  const b = addBuilding(world, kind, x, y, true);
  expect(b, `could not place ${kind} at ${x},${y}`).not.toBeNull();
  return b!;
}

/** Every lamp, cooler and turret in the world, by cell, for the shed assertions. */
function lit(world: World, kind: Building['kind']): Building[] {
  return world.buildings.filter((b) => b.kind === kind && b.built).sort((a, b) => a.id - b.id);
}

describe('the starting grid', () => {
  it('lights the cabin on the first tick', () => {
    const world = createWorld();
    tickPower(world);
    // Nobody should have to read a wiring diagram to find out why their new
    // colony is dark. If a stray edit ever drops the worldgen generator or one
    // of its conduit runs, this is the test that goes red.
    for (const lamp of lit(world, 'lamp')) expect(lamp.powered).toBe(true);
    expect(world.power?.shed).toBe(0);
    expect(world.power?.supply).toBe(GENERATOR_OUTPUT);
  });

  it('carries current through the cabin walls', () => {
    const world = createWorld();
    tickPower(world);
    const lamp = lit(world, 'lamp')[0]!;
    const net = networkOf(world, lamp);
    // The whole point of walls conducting: a machine in the corner of a room is
    // wired to everything else in that room without a single cell of conduit.
    expect(net?.some((b) => b.kind === 'generator')).toBe(true);
    expect(net?.some((b) => b.kind === 'wall')).toBe(true);
  });

  it('leaves the two lamps on one network, not two', () => {
    const world = createWorld();
    const nets = powerNetworks(world).filter((n) => n.some((b) => b.kind === 'lamp'));
    expect(nets).toHaveLength(1);
    expect(nets[0]!.filter((b) => b.kind === 'lamp')).toHaveLength(2);
  });
});

describe('a generator', () => {
  it('burns a log to cover the load, and only while there is load to cover', () => {
    const world = createWorld();
    const before = countResource(world, 'wood');
    // A full burn plus one tick: the firebox lights, runs down, and asks for the
    // next log. Two logs, not one per tick — the fuel is what makes a generator
    // a decision rather than free electricity.
    for (let t = 0; t < WOOD_BURN_TICKS + 1; t++) tickPower(world);
    expect(before - countResource(world, 'wood')).toBe(2);

    // Take the load away and the wood stops going anywhere at all.
    for (const lamp of lit(world, 'lamp')) lamp.built = false;
    const idle = countResource(world, 'wood');
    for (let t = 0; t < WOOD_BURN_TICKS * 2; t++) tickPower(world);
    expect(countResource(world, 'wood')).toBe(idle);
    expect(world.buildings.find((b) => b.kind === 'generator')?.powered).toBe(false);
  });

  it('goes cold when the woodpile is empty, and takes the lamps with it', () => {
    const world = createWorld();
    tickPower(world);
    expect(lit(world, 'lamp')[0]!.powered).toBe(true);

    takeResource(world, 'wood', 10_000);
    expect(countResource(world, 'wood')).toBe(0);
    // The log already in the firebox keeps burning; what it cannot do is find
    // another. Run past the end of it.
    for (let t = 0; t < WOOD_BURN_TICKS + 2; t++) tickPower(world);

    for (const lamp of lit(world, 'lamp')) expect(lamp.powered).toBe(false);
    expect(world.power!.shed).toBeGreaterThan(0);
    // The meter still says what the colony wanted. Reporting only the load that
    // survived made the top bar read `0 / 0 W` and then hide itself completely
    // at the exact moment the player needed it — a blackout that erased its own
    // instrument.
    expect(world.power!.supply).toBe(0);
    expect(world.power!.demand).toBeGreaterThan(0);
    expect(powerLabel(world.power)).toBe('0 / 24 W');
    // And the colony is told, rather than being left to notice the dark.
    expect(world.messages.some((m) => m.text.includes('grid is short'))).toBe(true);
  });
});

describe('a short grid', () => {
  it('sheds lamps before coolers, and coolers before turrets', () => {
    const world = createWorld();
    // Two rows, and the second one is the fix rather than a tidy-up: this asked
    // for a 6x1 strip and then built the whole appliance row on `spot.y - 1`,
    // which is a row `clearing` never looked at. It was open on the 128 map and
    // has a boulder on it at 192, and the failure reads "could not place turret"
    // — a power test going red over worldgen.
    const spot = clearing(world, 6, 2);
    // 282 W of appetite on 240 W of generator, arranged along one conduit run so
    // it is unambiguously a single network.
    const gen = put(world, 'generator', spot.x, spot.y + 1);
    for (let i = 1; i <= 5; i++) put(world, 'conduit', spot.x + i, spot.y + 1);
    const lamp = put(world, 'lamp', spot.x + 1, spot.y);
    const coolerA = put(world, 'cooler', spot.x + 2, spot.y);
    const coolerB = put(world, 'cooler', spot.x + 3, spot.y);
    const turretA = put(world, 'turret', spot.x + 4, spot.y);
    const turretB = put(world, 'turret', spot.x + 5, spot.y);
    tickPower(world);

    expect(gen.powered).toBe(true);
    // The lamp is the thing a colony can live without, so it is the thing that
    // goes first. Guns last, always: the shed order is a survival order.
    expect(lamp.powered).toBe(false);
    expect(turretA.powered).toBe(true);
    expect(turretB.powered).toBe(true);
    // One cooler covers the rest of the gap. The newer one is the one that
    // stops, because the colony built the older one for a reason.
    expect(coolerB.powered).toBe(false);
    expect(coolerA.powered).toBe(true);
  });

  it('counts the cabin lamps separately from a network of its own', () => {
    const world = createWorld();
    const spot = clearing(world, 2, 1);
    // An isolated turret with nothing feeding it is off, and being off does not
    // reach across the map and darken a cabin that is perfectly well supplied.
    const stranded = put(world, 'turret', spot.x, spot.y);
    tickPower(world);
    expect(stranded.powered).toBe(false);
    for (const lamp of lit(world, 'lamp')) expect(lamp.powered).toBe(true);
  });

  it('calls a machine nobody wired unwired, not short', () => {
    const world = createWorld();
    const spot = clearing(world, 2, 1);
    const heater = put(world, 'heater', spot.x, spot.y);
    tickPower(world);

    // Two different problems with two different fixes: a shed machine wants
    // another generator, this one wants a conduit. Before the split, dropping a
    // heater in the middle of a room said "the grid is short" while the meter
    // beside it showed 240 W made against 84 W drawn — the log and the
    // instrument contradicting each other over a grid that was perfectly fine.
    expect(heater.powered).toBe(false);
    expect(heater.unwired).toBe(true);
    expect(world.power!.shed).toBe(0);
    expect(world.power!.unwired).toBe(1);
    // And it is not on the meter at all, because it is not asking the grid for
    // anything: the cabin's two lamps are the only load there is.
    expect(powerLabel(world.power)).toBe(`${GENERATOR_OUTPUT} / 24 W`);
    const said = world.messages.map((m) => m.text).join('\n');
    expect(said).toContain('not wired');
    expect(said).not.toContain('grid is short');
  });

  it('stops calling it unwired the moment a conduit reaches it', () => {
    const world = createWorld();
    // Against the cabin's west wall but one cell out, so the fix is exactly the
    // one the message asks for: a single conduit between the two.
    const heater = put(world, 'heater', CABIN.x0 - 2, CABIN.y0 + 4);
    tickPower(world);
    expect(heater.unwired).toBe(true);

    put(world, 'conduit', CABIN.x0 - 1, CABIN.y0 + 4);
    tickPower(world);
    expect(heater.unwired).toBe(false);
    expect(heater.powered).toBe(true);
  });
});

describe('a battery', () => {
  it('charges off the surplus', () => {
    const world = createWorld();
    const batt = put(world, 'battery', CABIN.x0 + 1, CABIN.y0 + 4);
    // Against the cabin's west wall, so it is on the starter network without
    // wire — the same trick the starter generator uses.
    expect(networkOf(world, batt)?.some((b) => b.kind === 'generator')).toBe(true);
    for (let t = 0; t < 60; t++) tickPower(world);
    expect(batt.charge!).toBeGreaterThan(0);
    expect(batt.charge!).toBeLessThanOrEqual(BATTERY_CAPACITY);
  });

  it('carries the load when nothing is making power', () => {
    const world = createWorld();
    const spot = clearing(world, 3, 1);
    const batt = put(world, 'battery', spot.x, spot.y);
    put(world, 'conduit', spot.x + 1, spot.y);
    const lamp = put(world, 'lamp', spot.x + 2, spot.y);
    batt.charge = 5_000;
    tickPower(world);

    // No generator, no sun, and the lamp is still lit — which is what a bank is
    // for. The charge pays for it.
    expect(lamp.powered).toBe(true);
    expect(batt.charge).toBeLessThan(5_000);

    batt.charge = 0;
    tickPower(world);
    expect(lamp.powered).toBe(false);
  });
});

describe('a solar panel', () => {
  it('makes nothing at midnight and its full output at noon', () => {
    const world = createWorld();
    // A new colony starts mid-morning, so midnight has to be asked for.
    world.tick = 0;
    expect(solarOutput(world)).toBe(0);
    world.tick = TICKS_PER_DAY / 2;
    expect(solarOutput(world)).toBe(SOLAR_OUTPUT);
  });

  it('runs a lamp by day and drops it by night', () => {
    const world = createWorld();
    const spot = clearing(world, 3, 1);
    const panel = put(world, 'solar', spot.x, spot.y);
    put(world, 'conduit', spot.x + 1, spot.y);
    const lamp = put(world, 'lamp', spot.x + 2, spot.y);

    world.tick = TICKS_PER_DAY / 2;
    tickPower(world);
    expect(panel.powered).toBe(true);
    expect(lamp.powered).toBe(true);

    world.tick = TICKS_PER_DAY;
    tickPower(world);
    expect(panel.powered).toBe(false);
    expect(lamp.powered).toBe(false);
  });
});

describe('a fence', () => {
  it('does not carry power', () => {
    const world = createWorld();
    const spot = clearing(world, 3, 1);
    put(world, 'generator', spot.x, spot.y);
    put(world, 'fence', spot.x + 1, spot.y);
    const lamp = put(world, 'lamp', spot.x + 2, spot.y);
    tickPower(world);
    // Deliberate: a pen rail is a rail. If stock fencing quietly carried current
    // the whole yard would be one network and conduit would be decoration.
    expect(lamp.powered).toBe(false);
  });
});

describe('the Steward', () => {
  it('wires a turret it finds standing off the grid', () => {
    const world = createWorld();
    // Where its own killbox puts them: two cells out from the door, which is
    // one cell of conduit away from the cabin's back wall.
    const turret = put(world, 'turret', CABIN.doorX - 3, CABIN.doorY + 2);
    tickPower(world);
    expect(turret.powered).toBe(false);

    // The Steward only ever has one project outstanding, and on a fresh colony
    // the queue ahead of the wiring is beds. So this stands each blueprint up as
    // the colony would have and lets it get to the turret in its own time.
    const before = world.buildings.filter((b) => b.kind === 'conduit').length;
    for (let pass = 0; pass < 20; pass++) {
      stewardTick(world, pass * 20);
      for (const b of world.buildings) b.built = true;
      if (world.buildings.filter((b) => b.kind === 'conduit').length > before) break;
    }
    expect(world.buildings.filter((b) => b.kind === 'conduit').length).toBeGreaterThan(before);

    tickPower(world);
    expect(turret.powered).toBe(true);
  });
});

describe('the machines on the end of it', () => {
  it('will not let an unpowered turret fire', () => {
    const world = createWorld();
    const spot = clearing(world, 1, 8);
    const turret = put(world, 'turret', spot.x, spot.y);
    tickPower(world);
    expect(turret.powered).toBe(false);

    const rng = new Rng(9);
    const raider = makePawn(world, rng, 'raider', spot.x, spot.y + 6, {
      name: 'Unbothered',
      weapon: 'club',
    });
    const before = raider.hp;
    // Pinned on their mark, exactly as in the defence tests, so the only
    // difference between this and a raider being shot to pieces is the watts.
    const mark = { x: raider.x, y: raider.y };
    for (let t = 0; t < 200; t++) {
      raider.x = mark.x;
      raider.y = mark.y;
      tickCombat(world, rng, null);
    }
    expect(raider.hp).toBe(before);
  });

  it('will not let an unpowered cooler chill a room, and will once it is wired', () => {
    const world = createWorld();
    const cooler = put(world, 'cooler', CABIN.x0 + 5, CABIN.y0 + 4);
    tickPower(world);
    // Indoors, built, and useless: four walls were never the whole story.
    expect(cooler.powered).toBe(false);
    const warm = cellTemp(world, CABIN.x0 + 5, CABIN.y0 + 4);

    // Four cells of conduit west to the cabin wall — the run a player would draw
    // and the run the Steward's router finds.
    for (let x = CABIN.x0 + 4; x >= CABIN.x0 + 1; x--) put(world, 'conduit', x, CABIN.y0 + 4);
    tickPower(world);
    expect(cooler.powered).toBe(true);

    // Temperature is a per-tick thing, so the switch does not take effect until
    // the clock moves — the same one tick the player waits.
    world.tick++;
    expect(cellTemp(world, CABIN.x0 + 5, CABIN.y0 + 4)).toBeLessThan(warm);
    // And the yard is not part of the deal. A cooler cools its room; outside
    // that room the number is whatever the sky says it is.
    expect(cellTemp(world, 31, 20)).toBe(outdoorTemp(world));
  });
});
