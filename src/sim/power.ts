/**
 * The grid.
 *
 * Until this file existed the colony's machines ran on nothing: a cooler held a
 * month of food at no cost, a turret never ran dry, and the two lamps in the
 * starting cabin burned for a year on eight steel. Power is the cost side of all
 * three, and it is deliberately the *only* thing it is — no heat, no noise, no
 * breakdowns. One number per network, supply against demand, and a visible
 * failure when demand wins.
 *
 * Three rules carry the whole system, and each is one sentence a player can be
 * told once:
 *
 * 1. **Power runs through walls and conduit.** Everything electrical conducts
 *    through its own cell, and so do walls and doors — the wires are in the
 *    walls. So a generator touching your cabin lights the whole shell of it, and
 *    conduit is for crossing open ground to a lamp in the middle of a room or a
 *    turret out on the line. Networks are just the connected blobs of that.
 * 2. **A generator only burns wood when the grid is short.** Solar first, then
 *    the firebox. A sunny day costs nothing, and a generator with a half-burnt
 *    log in it keeps the rest for tonight.
 * 3. **When the grid cannot feed everything, the last thing you built goes dark
 *    first, and lamps go before coolers, and coolers before turrets.** Losing
 *    light is annoying, losing a larder is expensive, losing a gun is fatal.
 *
 * What is deliberately NOT here: no per-building wire runs to trace, no
 * transformers, no voltage. The interesting decisions are fuel, buffer and what
 * you sacrifice at 3am — not topology puzzles.
 */

import { defOf } from './buildings';
import { daylight } from './clock';
import { buildingAt } from './grid';
import { iceBears } from './ice';
import { msg, takeResource } from './world';
import { flareActive } from './types';
import type { Building, BuildingKind, PowerReport, World } from './types';

/** Watts each consumer pulls while it is switched on. */
export const DRAW: Partial<Record<BuildingKind, number>> = {
  lamp: 12,
  // The dearest thing on the grid, because it is the one that replaces a whole
  // job: a cooler is a larder that never needs a settler to walk to it.
  cooler: 90,
  turret: 45,
  // Cheaper than the cooler it is the mirror of, because a colony that cannot
  // afford to be warm at night is a colony that stops playing.
  heater: 60,
};

/**
 * The order the grid gives up on things.
 *
 * Read it as a sentence about what a colony can stand to lose: the dark, then
 * the food, then the guns. Within one kind the newest goes first — the thing you
 * added last is the thing your grid could not afford, and switching *that* off
 * is the answer a player can act on.
 *
 * Warmth sits between the dark and the food: a cold room is miserable and it is
 * how people catch things, but the meals going off is how a colony starves, and
 * losing the meals hurts longer than losing the night.
 */
const SHED_ORDER: BuildingKind[] = ['lamp', 'heater', 'cooler', 'turret'];

/** Watts from one wood generator while it is lit. */
export const GENERATOR_OUTPUT = 240;

/** Watts from one solar panel at midday, scaled by daylight the rest of the time. */
export const SOLAR_OUTPUT = 200;

/**
 * Watts from one watermill, every tick of the day, until the lake sets.
 *
 * Below the generator's 240 and below the panel's midday 200 on purpose: what a
 * mill sells is not the peak but the flat line under it. A panel averaged over a
 * whole day is worth less than this and a generator costs five wood a day to
 * match it, so the mill wins on the night shift and loses on the burst — which
 * is the trade that makes a colony build all three rather than one of them.
 */
export const MILL_OUTPUT = 150;

/**
 * Run time from one unit of wood, in ticks.
 *
 * 900 ticks is three quarters of a game-hour, so a generator running flat out
 * costs about five wood a day — a couple of trees a week. Enough that a colony
 * with no forestry notices; nowhere near enough to make wood the whole game.
 */
export const WOOD_BURN_TICKS = 900;

/** Watt-ticks one battery bank holds. 24000 ≈ four game-hours of lamplight. */
export const BATTERY_CAPACITY = 24000;

/** The most one bank will take in or give out per tick, in watts. */
export const BATTERY_RATE = 400;

/** Ticks between brownout warnings, so a flickering grid does not spam the log. */
const WARN_INTERVAL = 900;

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Things power flows through.
 *
 * Every machine conducts through its own cell, which is what lets a battery sat
 * beside a generator work with no wire between them. Walls and doors conduct
 * because a colony that has to run conduit around the outside of its own cabin
 * is a colony doing paperwork. A fence does not: it is a boundary for animals,
 * not a structure, and a paddock rail that silently powered a turret would be a
 * rule nobody could see.
 */
const CONDUCTS = new Set<BuildingKind>([
  'conduit',
  'wall',
  'stonewall',
  'door',
  'generator',
  'solar',
  'battery',
  'lamp',
  'cooler',
  'heater',
  'turret',
  'watermill',
]);

export function conducts(kind: BuildingKind): boolean {
  return CONDUCTS.has(kind);
}

/**
 * Does this kind put watts *into* the grid?
 *
 * A predicate rather than a list spelled out at each site, because the list was
 * spelled out at four of them and adding the watermill would have quietly turned
 * a mill-fed network into "not wired to anything" in the foreman's eyes — it
 * would have run conduit across the map away from a working power source.
 */
export function isProducer(kind: BuildingKind): boolean {
  return kind === 'generator' || kind === 'solar' || kind === 'watermill';
}

/** Can this kind supply a network — either making watts or holding them? */
export function isSource(kind: BuildingKind): boolean {
  return isProducer(kind) || kind === 'battery';
}

/** Does this kind make or spend watts — i.e. does `powered` mean anything on it? */
export function isElectrical(kind: BuildingKind): boolean {
  return isSource(kind) || DRAW[kind] !== undefined;
}

/**
 * Connected runs of conducting buildings.
 *
 * Exported because the inspector wants to answer "what is this thing plugged
 * into" without re-deriving the rule, and because a test that cannot see the
 * networks can only check the outcome, not the wiring.
 */
export function powerNetworks(world: World): Building[][] {
  const seen = new Set<number>();
  const nets: Building[][] = [];
  for (const start of world.buildings) {
    if (!start.built || !conducts(start.kind) || seen.has(start.id)) continue;
    const group: Building[] = [];
    const stack: Building[] = [start];
    seen.add(start.id);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const [dx, dy] of NEIGHBOURS) {
        const n = buildingAt(world, cur.x + dx, cur.y + dy);
        if (!n || !n.built || seen.has(n.id) || !conducts(n.kind)) continue;
        seen.add(n.id);
        stack.push(n);
      }
    }
    // By id, so the order a network is walked in never depends on which cell the
    // flood fill happened to start from. Everything below — which generator
    // lights first, which lamp goes dark — reads this order, and a sim whose
    // answers move when a building list is reordered is a sim that desyncs.
    group.sort((a, b) => a.id - b.id);
    nets.push(group);
  }
  return nets;
}

/** The network a given building sits on, or null if it does not conduct. */
export function networkOf(world: World, b: Building): Building[] | null {
  if (!b.built || !conducts(b.kind)) return null;
  for (const net of powerNetworks(world)) {
    if (net.some((n) => n.id === b.id)) return net;
  }
  return null;
}

/**
 * Watts a solar panel is making right now. Nothing at night, by design, and
 * nothing at all under a flare.
 *
 * The flare check is here rather than in `tickPower` because the inspector panel
 * reads this function too: without it a dead panel would sit in a dark colony
 * cheerfully reporting two hundred watts while the cooler beside it thawed.
 */
export function solarOutput(world: World): number {
  if (flareActive(world)) return 0;
  return Math.round(SOLAR_OUTPUT * daylight(world));
}

/**
 * Watts one watermill is making right now: all of them, or none.
 *
 * There is no half-frozen wheel. `iceBears` is already the one place that
 * decides whether the lake is hard, and a mill that trailed off as the ice
 * thickened would be a second opinion on the same question — the sort of thing
 * that drifts apart by a tick and leaves a settler walking on water the grid
 * still thinks is running.
 *
 * Same reason as `solarOutput` for keeping the flare check in here: the
 * inspector reads this function, and a wheel visibly turning in an unfrozen lake
 * must not report watts into wires that are carrying nothing.
 */
export function millOutput(world: World): number {
  if (flareActive(world) || iceBears(world)) return 0;
  return MILL_OUTPUT;
}

/**
 * One tick of the whole grid.
 *
 * Runs before spoilage and before the guns, because both ask a question this
 * pass answers: is the cooler cold, and is the turret live.
 */
export function tickPower(world: World): void {
  const report: PowerReport = {
    supply: 0,
    demand: 0,
    stored: 0,
    capacity: 0,
    shed: 0,
    unwired: 0,
    warnTick: world.power?.warnTick ?? -WARN_INTERVAL,
  };
  const wasShort = (world.power?.shed ?? 0) > 0;
  const wasUnwired = (world.power?.unwired ?? 0) > 0;
  let stranded: Building | null = null;
  // Counted across every network and spent on one line at the end. Three mills
  // on the same lake all set on the same tick, and three copies of the same
  // sentence would read as three separate disasters.
  let froze = 0;
  let thawed = 0;
  const sun = solarOutput(world);
  const mill = millOutput(world);
  const locked = iceBears(world);
  // A flare does not stop a firebox turning or a cell holding charge — it stops
  // the wires carrying either anywhere. So the generators bank their fuel rather
  // than burning it into a dead grid, and the banks keep what they have, which is
  // why the lights come straight back on when the sky settles instead of the
  // colony waking up to empty batteries as well as a wasted day.
  const flare = flareActive(world);

  for (const net of powerNetworks(world)) {
    const gens: Building[] = [];
    const batts: Building[] = [];
    const loads: Building[] = [];
    let panels = 0;
    let supply = 0;
    for (const b of net) {
      if (b.kind === 'generator') gens.push(b);
      else if (b.kind === 'battery') batts.push(b);
      else if (b.kind === 'solar') {
        b.powered = sun > 0;
        panels++;
        supply += sun;
      } else if (b.kind === 'watermill') {
        // A frozen mill is still a source as far as the network is concerned:
        // it is wired, it is built, it is simply making nothing this month. That
        // distinction is the whole message — "the grid is short" is a problem
        // the player can answer with a generator, "not wired to anything" is a
        // problem they answer with conduit, and a winter lake is the first.
        b.powered = mill > 0;
        panels++;
        supply += mill;
        // The latch follows the ice and nothing else. A flare stops the watts
        // too, but it is not a freeze and it already has its own line in the
        // log — hanging the message on `powered` would have had a mill report
        // that it had frozen solid in the middle of June.
        //
        // The first tick a mill is ever seen is never an event, whichever way
        // the lake is: one finished in February was built into a frozen lake
        // rather than caught by one, and a save from before there were mills
        // has no business announcing a freeze that happened in January. After
        // that the latch is a real `false`, so the next crossing does report.
        if (b.iced !== undefined && locked !== b.iced) {
          if (locked) froze++;
          else thawed++;
        }
        b.iced = locked;
      } else if (DRAW[b.kind] !== undefined) {
        b.powered = true;
        b.unwired = false;
        loads.push(b);
      }
    }

    // A network with nothing on it that makes or holds a watt is not a grid
    // having a bad night — it is a machine somebody set down out of reach of the
    // wires. Heaters make this the common mistake: they belong in the middle of a
    // room, which is exactly where the walls are not. Counting these as shed made
    // the log say the grid was short while the meter beside it showed spare
    // watts, which is the sort of contradiction that teaches a player to ignore
    // both. They are left out of the meter entirely: they are not asking the grid
    // for anything, because they are not attached to it.
    if (gens.length === 0 && batts.length === 0 && panels === 0) {
      for (const b of loads) {
        b.powered = false;
        b.unwired = true;
      }
      report.unwired = (report.unwired ?? 0) + loads.length;
      stranded ??= loads[0] ?? null;
      continue;
    }

    let demand = loads.reduce((n, b) => n + DRAW[b.kind]!, 0);
    // What the colony asked for, kept aside before the shedding starts.
    // `demand` below is the load the grid settles on, which is the number the
    // battery maths needs; the meter needs the other one. Reporting the
    // settled figure made the top-bar reading fall to `0 / 0 W` at the exact
    // moment the lights went out, and then hide itself entirely.
    const asked = demand;

    // Generators, one at a time, only while the grid is still short. A firebox
    // with fuel left in it keeps burning that; an empty one takes a fresh log
    // out of the colony's loose wood, and if there is none it sits cold.
    for (const g of gens) {
      if (flare || supply >= demand) {
        g.powered = false;
        continue;
      }
      if ((g.fuel ?? 0) <= 0) {
        if (takeResource(world, 'wood', 1) < 1) {
          g.fuel = 0;
          g.powered = false;
          continue;
        }
        g.fuel = WOOD_BURN_TICKS;
      }
      g.fuel = (g.fuel ?? 0) - 1;
      g.powered = true;
      supply += GENERATOR_OUTPUT;
    }

    let stored = 0;
    let room = 0;
    for (const b of batts) {
      b.charge = clamp(b.charge ?? 0, 0, BATTERY_CAPACITY);
      b.powered = !flare && b.charge > 0;
      stored += b.charge;
      room += BATTERY_CAPACITY - b.charge;
    }
    const canDischarge = flare ? 0 : Math.min(stored, batts.length * BATTERY_RATE);

    // Shed until what is left fits inside what the grid can actually deliver.
    // Batteries count towards that: a bank exists precisely so a cooler rides
    // out the twenty minutes between sunset and somebody lighting the generator.
    const available = supply + canDischarge;
    for (const kind of SHED_ORDER) {
      if (demand <= available) break;
      const of = loads.filter((b) => b.kind === kind).sort((a, b) => b.id - a.id);
      for (const b of of) {
        if (demand <= available) break;
        b.powered = false;
        demand -= DRAW[kind]!;
        report.shed++;
      }
    }
    if (demand > supply) {
      let need = Math.min(demand - supply, canDischarge);
      for (const b of batts) {
        if (need <= 0) break;
        const out = Math.min(b.charge ?? 0, BATTERY_RATE, need);
        b.charge = (b.charge ?? 0) - out;
        need -= out;
      }
    } else if (supply > demand && room > 0) {
      let spare = supply - demand;
      for (const b of batts) {
        if (spare <= 0) break;
        const put = Math.min(BATTERY_CAPACITY - (b.charge ?? 0), BATTERY_RATE, spare);
        b.charge = (b.charge ?? 0) + put;
        spare -= put;
      }
    }

    report.supply += supply;
    report.demand += asked;
    for (const b of batts) {
      report.stored += b.charge ?? 0;
      report.capacity += BATTERY_CAPACITY;
    }
  }

  // Anything electrical the flood fill never reached is off the grid entirely —
  // a blueprint, or a machine somebody unplugged by deconstructing the wall it
  // was hanging off. Say so rather than leaving last tick's answer standing.
  for (const b of world.buildings) {
    if (!isElectrical(b.kind)) continue;
    if (!b.built) b.powered = false;
  }

  // Not held behind `quiet`. The brownout warning is throttled because a grid on
  // the edge flickers; a lake sets once a year and goes out once a year, and a
  // player who misses that line loses a hundred and fifty watts without ever
  // being told why. It cannot repeat, because the latch has already flipped.
  if (froze > 0) {
    msg(
      world,
      froze === 1
        ? 'The lake has set solid — the watermill is stopped until the thaw.'
        : `The lake has set solid — ${froze} watermills are stopped until the thaw.`,
      'bad',
    );
  }
  if (thawed > 0) {
    msg(
      world,
      thawed === 1
        ? 'The ice has gone out — the watermill is turning again.'
        : `The ice has gone out — ${thawed} watermills are turning again.`,
      'good',
    );
  }

  const quiet = world.tick - report.warnTick > WARN_INTERVAL;
  if (report.shed > 0 && !wasShort && quiet) {
    report.warnTick = world.tick;
    msg(
      world,
      report.shed === 1
        ? 'The grid is short — something has switched itself off.'
        : `The grid is short — ${report.shed} machines have switched themselves off.`,
      'bad',
    );
  } else if (stranded && !wasUnwired && quiet) {
    // Named and placed, because the fix is somewhere specific: the player has to
    // walk a conduit from the wall to that cell.
    report.warnTick = world.tick;
    const n = report.unwired ?? 0;
    const what = `The ${defOf(stranded.kind).label.toLowerCase()} at (${stranded.x}, ${stranded.y})`;
    msg(
      world,
      n === 1
        ? `${what} is not wired to anything — run conduit to it.`
        : `${what} and ${n - 1} other machines are not wired to anything.`,
      'bad',
    );
  }
  world.power = report;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** "240 / 190 W" — what the top bar prints. */
export function powerLabel(report: PowerReport | undefined): string {
  if (!report) return '—';
  return `${Math.round(report.supply)} / ${Math.round(report.demand)} W`;
}

/** Battery charge as a percentage, or null when the colony has no banks. */
export function batteryPercent(report: PowerReport | undefined): number | null {
  if (!report || report.capacity <= 0) return null;
  return Math.round((report.stored / report.capacity) * 100);
}
