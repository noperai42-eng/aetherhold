/**
 * The lake as a power station.
 *
 * Two claims. The first is arithmetic: a watermill is the only source on the
 * grid that does not care what time it is, and the only one that stops for a
 * season. Everything the player plans around it — build a mill instead of a
 * third generator, keep the generator anyway for February — falls out of those
 * two facts, so both are pinned here rather than left to the power pass to
 * imply.
 *
 * The second is that it is genuinely the *same* grid. The mill conducts, sheds,
 * charges batteries and shows up in the meter through the machinery that was
 * already there; nothing about it is a special case with its own wires. The
 * regression that made that worth a test is in `keeps the foreman off a
 * mill-fed network`: four separate places in the codebase listed the power
 * sources by name, and a new source added without touching all four is not a
 * new source — it is a machine the colony's own planners cannot see.
 *
 * No seed is named for the arithmetic, because `millOutput` draws no randomness
 * and asks the map nothing except whether the ice is bearing. The end-to-end
 * runs name the pinned seed for the reason the rest of the suite does.
 */

import { describe, expect, it } from 'vitest';

import { defOf } from '../src/sim/buildings';
import { buildingAt, isWalkable } from '../src/sim/grid';
import { BEARING } from '../src/sim/ice';
import { onShore } from '../src/sim/fishing';
import { canPlace } from '../src/sim/orders';
import {
  BATTERY_CAPACITY,
  MILL_OUTPUT,
  conducts,
  isElectrical,
  isProducer,
  isSource,
  millOutput,
  networkOf,
  tickPower,
} from '../src/sim/power';
import { buildingUnlocked } from '../src/sim/research';
import { defaultCamera, deserialize, serialize } from '../src/sim/save';
import { TICKS_PER_DAY, type Building, type World } from '../src/sim/types';
import { addBuilding, countResource, removeBuilding, takeResource } from '../src/sim/world';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';

/** The nearest cell to the cabin a mill could actually stand on. */
function shoreCell(world: World): { x: number; y: number } {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      if (!onShore(world, x, y) || !isWalkable(world, x, y)) continue;
      if (buildingAt(world, x, y)) continue;
      const d = (x - HOME_X) ** 2 + (y - HOME_Y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  if (!best) throw new Error('no shoreline on this map');
  return best;
}

/** `addBuilding`, but loud: a null here would void every assertion under it. */
function put(world: World, kind: Building['kind'], x: number, y: number): Building {
  const b = addBuilding(world, kind, x, y, true);
  expect(b, `could not place ${kind} at ${x},${y}`).not.toBeNull();
  return b!;
}

/**
 * A mill on the shore with a lamp wired to it and nothing else on the grid.
 *
 * The cabin's own generator and both its lamps are torn out, because the point
 * of every test below is what the *mill* is doing: a colony that ships with a
 * generator would quietly answer for it, and two cabin lamps left behind on a
 * network with nothing feeding it would put two stranded machines into every
 * reading the meter takes.
 */
function millColony(seed = 20260729): { world: World; mill: Building; lamp: Building } {
  const world = createWorld(seed);
  for (const b of [...world.buildings]) {
    if (b.kind === 'generator' || b.kind === 'lamp') removeBuilding(world, b);
  }
  const at = shoreCell(world);
  const mill = put(world, 'watermill', at.x, at.y);
  // Straight onto the mill's own cell-neighbourhood: every machine conducts
  // through its own cell, so a lamp beside the mill needs no conduit at all.
  const lamp = putBeside(world, 'lamp', mill);
  return { world, mill, lamp };
}

/** Put `kind` on the first free walkable cell orthogonally next to `b`. */
function putBeside(world: World, kind: Building['kind'], b: Building): Building {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const x = b.x + dx;
    const y = b.y + dy;
    if (!isWalkable(world, x, y) || buildingAt(world, x, y)) continue;
    return put(world, kind, x, y);
  }
  throw new Error(`nowhere to put a ${kind} beside ${b.kind}`);
}

/** Both flags a mill reads, set the way winter sets them. */
function freeze(world: World): void {
  world.ice = 1;
}

function thaw(world: World): void {
  world.ice = 0;
}

// ---------------------------------------------------------------- functional

describe('what a watermill makes', () => {
  it('makes the same watts at midnight as at noon', () => {
    const world = createWorld(5);
    thaw(world);
    // Every hour of one game day. A solar panel would trace an arc through this
    // loop; the mill is a flat line, which is the entire argument for building
    // one, and a flat line is easy to check and easy to break.
    for (let h = 0; h < 24; h++) {
      world.tick = Math.round((h / 24) * TICKS_PER_DAY);
      expect(millOutput(world), `hour ${h}`).toBe(MILL_OUTPUT);
    }
  });

  it('makes nothing at all once the ice bears', () => {
    const world = createWorld(5);
    world.ice = BEARING - 0.01;
    expect(millOutput(world)).toBe(MILL_OUTPUT);
    // The same threshold a settler walks on. There is deliberately no half-frozen
    // wheel: two opinions about how hard the lake is would drift apart by a tick
    // and leave somebody standing on water the grid still thought was running.
    world.ice = BEARING;
    expect(millOutput(world)).toBe(0);
    world.ice = 1;
    expect(millOutput(world)).toBe(0);
  });

  it('makes nothing under a flare, wheel or no wheel', () => {
    const world = createWorld(5);
    thaw(world);
    world.storyteller.flareUntil = world.tick + 60;
    // The check lives in `millOutput` rather than in `tickPower` for the reason
    // the panel's does: the inspector reads this function, and a wheel visibly
    // turning must not report watts into wires that are carrying nothing.
    expect(millOutput(world)).toBe(0);
  });

  it('spends no randomness deciding any of it', () => {
    const world = createWorld(5);
    const before = world.rng.main;
    for (let i = 0; i < 200; i++) {
      world.tick = i * 37;
      world.ice = (i % 20) / 20;
      millOutput(world);
    }
    expect(world.rng.main).toBe(before);
  });
});

describe('a watermill on the grid', () => {
  it('is a source, conducts, and counts as electrical', () => {
    // The predicates rather than the behaviour, because these are what the rest
    // of the codebase asks. A source that conducts but does not read as a source
    // is a network the foreman thinks is dead.
    expect(isProducer('watermill')).toBe(true);
    expect(isSource('watermill')).toBe(true);
    expect(isElectrical('watermill')).toBe(true);
    expect(conducts('watermill')).toBe(true);
    // And the three it must not be confused with.
    expect(isProducer('battery')).toBe(false);
    expect(isSource('battery')).toBe(true);
    expect(isProducer('lamp')).toBe(false);
  });

  it('lights a lamp beside it with no conduit and no fuel', () => {
    const { world, mill, lamp } = millColony();
    thaw(world);
    const wood = countResource(world, 'wood');
    tickPower(world);
    expect(networkOf(world, lamp)?.some((b) => b.id === mill.id)).toBe(true);
    expect(mill.powered).toBe(true);
    expect(lamp.powered).toBe(true);
    expect(world.power?.supply).toBe(MILL_OUTPUT);
    expect(world.power?.shed).toBe(0);
    // The whole difference from a generator: it burned nothing to do that.
    expect(countResource(world, 'wood')).toBe(wood);
  });

  it('drops the lamp when the lake sets, without calling it unwired', () => {
    const { world, mill, lamp } = millColony();
    thaw(world);
    tickPower(world);
    expect(lamp.powered).toBe(true);

    freeze(world);
    tickPower(world);
    expect(mill.powered).toBe(false);
    expect(lamp.powered).toBe(false);
    // The distinction the player acts on. "Not wired" means run conduit, and a
    // frozen mill is not a wiring fault — the machine is connected to a source
    // that is having a bad month. Sending somebody out with cable would be the
    // wrong answer told confidently.
    expect(lamp.unwired).toBe(false);
    expect(world.power?.unwired ?? 0).toBe(0);
    expect(world.power?.shed).toBe(1);
    expect(world.power?.demand).toBe(12);
  });

  it('charges a battery in autumn and lets it carry the lamp in January', () => {
    const { world, mill, lamp } = millColony();
    thaw(world);
    const batt = putBeside(world, 'battery', mill);
    batt.charge = 0;
    for (let i = 0; i < 20; i++) tickPower(world);
    expect((batt.charge ?? 0) > 0).toBe(true);

    batt.charge = BATTERY_CAPACITY;
    freeze(world);
    tickPower(world);
    // A bank is exactly the answer to a seasonal source, so the lamp has to
    // survive the freeze on stored charge — otherwise the mill is a trap.
    expect(lamp.powered).toBe(true);
    expect((batt.charge ?? 0) < BATTERY_CAPACITY).toBe(true);
  });

  it('leaves a network with only a frozen mill on it still wired', () => {
    const { world, lamp } = millColony();
    freeze(world);
    tickPower(world);
    // A frozen mill still counts as something on the network, which is what
    // keeps this out of the "nothing here makes or holds a watt" branch. The
    // player gets "the grid is short", which is true, instead of "not wired to
    // anything", which would send them out with conduit in the snow.
    expect(lamp.unwired).toBe(false);
    expect(world.messages.some((m) => m.text.includes('not wired'))).toBe(false);
  });
});

describe('the wheel latch', () => {
  it('says so once when the lake sets and once when it goes out', () => {
    const { world } = millColony();
    thaw(world);
    tickPower(world);
    freeze(world);
    for (let i = 0; i < 40; i++) tickPower(world);
    const froze = world.messages.filter((m) => m.text.includes('set solid'));
    // Once. A latch rather than a reading, because "the lake is hard" is true
    // for two thousand ticks and only the first of them is news.
    expect(froze).toHaveLength(1);
    expect(froze[0]!.kind).toBe('bad');

    thaw(world);
    for (let i = 0; i < 40; i++) tickPower(world);
    const gone = world.messages.filter((m) => m.text.includes('gone out'));
    expect(gone).toHaveLength(1);
    expect(gone[0]!.kind).toBe('good');
  });

  it('collapses three mills freezing on one tick into one line', () => {
    const { world, mill } = millColony();
    thaw(world);
    world.research.done.push('machining');
    // Two more on the same shoreline. Three separate sentences would read as
    // three separate disasters when it is one lake doing one thing.
    let placed = 1;
    for (let y = 1; y < world.height - 1 && placed < 3; y++) {
      for (let x = 1; x < world.width - 1 && placed < 3; x++) {
        if (x === mill.x && y === mill.y) continue;
        if (canPlace(world, 'watermill', x, y) !== 'ok') continue;
        put(world, 'watermill', x, y);
        placed++;
      }
    }
    expect(placed).toBe(3);
    tickPower(world);
    freeze(world);
    tickPower(world);
    expect(world.messages.filter((m) => m.text.includes('set solid'))).toHaveLength(1);
    expect(world.messages.find((m) => m.text.includes('set solid'))!.text).toContain('3 watermills');
  });

  it('does not announce a freeze to a mill built into a frozen lake', () => {
    const { world, mill } = millColony();
    freeze(world);
    expect(mill.iced).toBeUndefined();
    tickPower(world);
    // The lake set in December; this mill went up in February. Reporting the
    // freeze as it finished would be a true fact filed as a fresh event, which
    // is how a log stops being worth reading.
    expect(mill.iced).toBe(true);
    expect(world.messages.some((m) => m.text.includes('set solid'))).toBe(false);

    // But the thaw is real news to it, because it is a change it will live through.
    thaw(world);
    tickPower(world);
    expect(world.messages.filter((m) => m.text.includes('gone out'))).toHaveLength(1);
  });

  it('does not mistake a flare for a freeze', () => {
    const { world, mill } = millColony();
    thaw(world);
    tickPower(world);
    world.storyteller.flareUntil = world.tick + 600;
    for (let i = 0; i < 20; i++) tickPower(world);
    // The wheel is still turning in the water; it is the wires that are dead,
    // and the flare has its own line in the log. A mill reporting that it had
    // frozen solid in the middle of June is the bug this pins.
    expect(mill.powered).toBe(false);
    expect(mill.iced).toBe(false);
    expect(world.messages.some((m) => m.text.includes('set solid'))).toBe(false);
  });

  it('carries the latch through a save without re-announcing anything', () => {
    const { world } = millColony();
    freeze(world);
    tickPower(world);
    thaw(world);
    tickPower(world);
    const view = { mode: 'manager' as const, possessedId: null, camera: defaultCamera(world) };
    const res = deserialize(serialize(world, view, 1, 0));
    expect(res.ok).toBe(true);
    const back = (res as { ok: true; save: { world: World } }).save.world;
    const mill = back.buildings.find((b) => b.kind === 'watermill')!;
    expect(mill.iced).toBe(false);
    const before = back.messages.length;
    tickPower(back);
    // Nothing changed across the save, so nothing is news on the other side.
    expect(back.messages).toHaveLength(before);
  });
});

describe('where a mill may stand', () => {
  it('wants the water and the research, in that order', () => {
    const world = createWorld(20260729);
    const at = shoreCell(world);
    expect(world.research.done).not.toContain('machining');
    // Unresearched comes first on purpose: a player who has not done Machining
    // should be told they cannot build one at all before being told where.
    expect(canPlace(world, 'watermill', at.x, at.y)).toBe('unresearched');
    expect(canPlace(world, 'watermill', HOME_X, HOME_Y)).toBe('unresearched');

    world.research.done.push('machining');
    expect(buildingUnlocked(world, 'watermill')).toBe(true);
    expect(canPlace(world, 'watermill', at.x, at.y)).toBe('ok');
    // And still nowhere near the cabin, which is the trade: the free power is
    // out at the water, and the wire back is the player's problem.
    expect(canPlace(world, 'watermill', HOME_X, HOME_Y)).toBe('shore');
  });

  it('is a solid building with a real price behind a real project', () => {
    const def = defOf('watermill');
    expect(def.solid).toBe(true);
    expect(def.needsShore).toBe(true);
    expect(def.buildable).toBe(true);
    // Steel is what keeps it out of the opening week — a colony can cut fifty-five
    // wood on day two, and a source that good should not be free that early.
    expect((def.cost.steel ?? 0) > 0).toBe(true);
    expect((def.cost.wood ?? 0) > 0).toBe(true);
  });
});

// --------------------------------------------------------------- experience

describe('a colony run off the lake', () => {
  it('keeps the lights on all night without touching the woodpile', () => {
    const { world, lamp } = millColony();
    thaw(world);
    const wood = countResource(world, 'wood');
    let dark = 0;
    // A whole day, hour by hour. A solar panel would leave this colony dark for
    // half of it and a generator would have eaten about five wood; the mill is
    // the option that does neither, and that is the sentence the player is
    // being sold when they pay twenty steel for it.
    for (let h = 0; h < 24; h++) {
      world.tick = Math.round((h / 24) * TICKS_PER_DAY);
      tickPower(world);
      if (lamp.powered !== true) dark++;
    }
    expect(dark).toBe(0);
    expect(countResource(world, 'wood')).toBe(wood);
  });

  it('hands the load back to a generator when the lake sets', () => {
    const { world, mill, lamp } = millColony();
    thaw(world);
    const gen = putBeside(world, 'generator', mill);
    tickPower(world);
    // While the wheel turns the firebox stays cold: generators only light when
    // the grid is still short, so a mill is a fuel saving as much as a supply.
    expect(gen.powered).toBe(false);
    expect(mill.powered).toBe(true);

    freeze(world);
    tickPower(world);
    expect(mill.powered).toBe(false);
    expect(gen.powered).toBe(true);
    expect(lamp.powered).toBe(true);
    expect((gen.fuel ?? 0) > 0).toBe(true);
  });

  it('runs the lake dry of wood rather than of watts, and says why', () => {
    const { world, mill, lamp } = millColony();
    thaw(world);
    putBeside(world, 'generator', mill);
    tickPower(world);
    freeze(world);
    takeResource(world, 'wood', countResource(world, 'wood'));
    tickPower(world);
    // Frozen mill, empty woodpile: the lamp is out. What matters is that the log
    // gives the player the reason that is actually actionable — the lake has set
    // — rather than only the symptom.
    expect(lamp.powered).toBe(false);
    expect(world.messages.some((m) => m.text.includes('set solid'))).toBe(true);
  });

  it('keeps the foreman off a mill-fed network', () => {
    const { world, lamp } = millColony();
    thaw(world);
    tickPower(world);
    const before = world.buildings.filter((b) => b.kind === 'conduit').length;
    // The colony's own planners ask "is there a source on this network?" in
    // three places, and every one of them used to answer by name. A mill is a
    // source; a lamp lit by one is not stranded; nobody should be walking cable
    // out to it. This is the test that would have caught the fourth site.
    const net = networkOf(world, lamp)!;
    expect(net.some((b) => isSource(b.kind))).toBe(true);
    expect(world.buildings.filter((b) => b.kind === 'conduit').length).toBe(before);
  });
});
