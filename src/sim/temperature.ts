/**
 * Air temperature, per room.
 *
 * This used to be a cooler with a radius and a guess at what "indoors" meant. It
 * is now a property of the room you built: a sealed room holds its heat, a room
 * with a door on it leaks, a big room takes an hour to come round and a small one
 * takes twenty minutes. Put a cooler in a nine-cell larder and it is a freezer;
 * put the same cooler in the cabin and the cabin gets chilly, which is the lesson
 * teaching itself rather than a rule anybody had to write down.
 *
 * Three consumers now, not one:
 *  - spoilage, which is what temperature was originally for;
 *  - comfort, in health.ts — cold feeds mood and immunity;
 *  - the HUD, which prints the number on every card.
 *
 * Still deliberately NOT modelled: nothing takes damage from ordinary cold. The
 * player's first balance complaint was people going down for reasons they could
 * not see, and an invisible frost drain is exactly that. Cold makes you miserable
 * and it makes you catch things; only standing in your own freezer hurts.
 *
 * The lag matters as much as the numbers. Rooms carry their temperature between
 * ticks and chase a target, so lighting a fire is something you watch work, and
 * leaving the freezer door open costs you the afternoon rather than the frame.
 */

import { timeOfDay } from './clock';
import { roomAt, roomIndex, type Room, type RoomIndex } from './rooms';
import { seasonOffsetAt, seasonTempOffset } from './seasons';
import type { Building, World } from './types';
import { takeResource } from './world';

/** Below this, nothing rots at all. */
export const FREEZING = 0;

/**
 * Mean outdoor temperature on the day the colony lands, in °C.
 *
 * Thirteen is the number every other constant in this file was balanced against
 * — how cold a night in an unsealed cabin is, how fast a heater has to work, how
 * long a meal keeps on a shelf. The year moves the mean around now, so the
 * baseline is derived rather than stated: whatever the season curve is worth on
 * the first tick, subtract it, and landfall comes out at exactly thirteen again.
 * Change `SEASON_SWING` and the first day of the game does not move.
 */
const LANDFALL_TEMP = 13;

/** The year's mean, chosen so the season curve puts landfall on `LANDFALL_TEMP`. */
const BASE_TEMP = LANDFALL_TEMP - seasonOffsetAt(0);

/** Half the outdoor day/night spread. Clear noon ~24 °C, clear pre-dawn ~2 °C. */
const DAY_SWING = 11;

/**
 * When the day peaks, as a fraction of the day.
 *
 * Mid-afternoon rather than noon, because ground that has been in the sun all
 * morning is still giving heat back at 2pm. It also means the hottest hour is one
 * a player is usually awake and working through, rather than one their settlers
 * spend asleep.
 */
const PEAK_HOUR = 0.6;

/** What each front takes off the top, at full blend. */
const WEATHER_OFFSET: Record<World['weather']['kind'], number> = {
  clear: 0,
  cloudy: -2,
  rain: -4.5,
  storm: -6.5,
  fog: -3,
};

/** What a perfectly sealed room settles toward with nothing running in it. */
const INDOOR_MEAN = 16;
const MAX_INSULATION = 0.72;

/**
 * How many wall edges one door is worth losing.
 *
 * The starter cabin is 39 wall and one door, so it seals at 0.93 and a night
 * indoors is survivable without a fire. Knock three more doorways in it and the
 * seal falls to 0.81 and you will feel it. Doors do not have to be *open* to
 * leak: this is the draught, not the swing, which keeps the number stable while
 * settlers come and go all day.
 */
const DOOR_LEAK = 3;

/**
 * What a device can shift a room by, in °C times cells.
 *
 * Dividing by room size is the whole design. A cooler is 700, so it takes a
 * nine-cell larder to −5 °C and change, and the ninety-nine-cell cabin down by
 * about seven — chilly, food keeps a little better, nobody freezes in their bed.
 * A player who wants a freezer has to build a freezer.
 */
const COOLER_DROP = 700;
const HEATER_LIFT = 800;
const CAMPFIRE_LIFT = 520;
const GENERATOR_LIFT = 340;

/** Devices stop pushing here, however small the room is. */
const HEATER_TARGET = 22;
const COOLER_TARGET = -5;

/**
 * Thermal lag, in ticks, as a function of room size: a nine-cell larder settles
 * with a time constant of about 70 ticks (three and a half game minutes), the
 * cabin about 200 (an hour). Small rooms respond, big rooms brood.
 */
const TAU_BASE = 60;
const TAU_PER_CELL = 1.4;

/**
 * The outdoor mean for the day the world is currently on: the season, and
 * nothing that happens within the day.
 *
 * This is the temperature a *plant* answers to. Deliberately without the day
 * swing, because a crop does not stop growing at dawn and start again at noon,
 * and deliberately without the weather, because a shower is not a season — and
 * because rain is the one thing in this game that makes a plot ripen faster, so
 * charging it four and a half degrees would have it fighting itself.
 */
export function seasonMeanTemp(world: World): number {
  return BASE_TEMP + seasonTempOffset(world);
}

/** Outdoor air, anywhere on the map, right now. */
export function outdoorTemp(world: World): number {
  const phase = (timeOfDay(world) - PEAK_HOUR) * Math.PI * 2;
  const w = world.weather;
  return seasonMeanTemp(world) + Math.cos(phase) * DAY_SWING + (WEATHER_OFFSET[w.kind] ?? 0) * w.blend;
}

/**
 * How much heat this building is putting into (or pulling out of) its room.
 *
 * `powered === true` rather than `!== false` on purpose, for both electricals: a
 * machine the power pass has never looked at is a machine nothing is feeding, and
 * a larder that quietly works for free is the exact hole the running cost exists
 * to close. A campfire answers to its own firebox instead.
 */
function heatOf(b: Building): number {
  if (!b.built) return 0;
  if (b.kind === 'cooler') return b.powered === true ? -COOLER_DROP : 0;
  if (b.kind === 'heater') return b.powered === true ? HEATER_LIFT : 0;
  if (b.kind === 'campfire') return (b.fuel ?? 0) > 0 ? CAMPFIRE_LIFT : 0;
  // A generator is a firebox with a crank on it, so a room with one running in it
  // gets warm whether or not that is what anybody wanted. Less than a campfire
  // for the same reason it is not a heater — waste heat off an engine block, not
  // an open hearth — and like every other lift it stops at HEATER_TARGET, because
  // the cost of shutting an engine indoors is what it does to the air, not the
  // thermometer. See `fumes.ts`.
  if (b.kind === 'generator') return (b.fuel ?? 0) > 0 && b.powered === true ? GENERATOR_LIFT : 0;
  return 0;
}

/** Fraction of this room's boundary that actually holds heat in. */
export function sealOf(room: Room): number {
  const leak = room.wallEdges + room.doorEdges * DOOR_LEAK;
  return leak > 0 ? room.wallEdges / leak : 1;
}

/**
 * The temperature every room is heading for, right now.
 *
 * One pass over the building list rather than one per room: a colony with three
 * rooms and four hundred buildings should not scan the list three times.
 */
export function roomTargets(world: World): Map<number, number> {
  const idx = roomIndex(world);
  const outside = outdoorTemp(world);
  const heat = new Map<number, number>();
  for (const b of world.buildings) {
    const q = heatOf(b);
    if (q === 0) continue;
    const id = idx.cellRoom[b.y * world.width + b.x];
    // A stove in the yard warms the sky. Devices only count where there is a
    // room to hold what they make.
    if (id === undefined || id < 0) continue;
    heat.set(id, (heat.get(id) ?? 0) + q);
  }

  const out = new Map<number, number>();
  for (const room of idx.rooms.values()) {
    const seal = sealOf(room);
    const passive = outside + (INDOOR_MEAN - outside) * MAX_INSULATION * seal;
    const q = heat.get(room.id) ?? 0;
    if (q === 0) {
      out.set(room.id, passive);
      continue;
    }
    // The seal is spent twice, and it should be: a leaky room is both worse at
    // keeping what the weather gives it and worse at keeping what you paid for.
    const target = passive + (q / room.size) * seal;
    out.set(
      room.id,
      q > 0
        ? Math.min(target, Math.max(passive, HEATER_TARGET))
        : Math.max(target, Math.min(passive, COOLER_TARGET)),
    );
  }
  return out;
}

/** How long one log keeps a campfire going. Six per game day, at 240 s a day. */
export const CAMPFIRE_BURN_TICKS = 800;

/** A campfire lights itself when its room falls below this. */
export const CAMPFIRE_LIGHT_BELOW = 15;

/**
 * Campfires feed themselves out of the loose wood, one log at a time.
 *
 * There is no hauling job for it, exactly as there is none for the generator's
 * firebox: a fire that needs a settler to walk a log to it is a fire that goes
 * out at 3am while everybody is asleep, which is the one hour it was built for.
 * It only takes a log when the room has actually gone cold, so a fire in a warm
 * cabin in high summer costs nothing and the woodpile is spent on nights.
 */
function tickCampfires(world: World): void {
  const idx = roomIndex(world);
  for (const b of world.buildings) {
    if (b.kind !== 'campfire' || !b.built) continue;
    if ((b.fuel ?? 0) > 0) {
      b.fuel = (b.fuel ?? 0) - 1;
      continue;
    }
    b.fuel = 0;
    const id = idx.cellRoom[b.y * world.width + b.x];
    if (id === undefined || id < 0) continue;
    const room = idx.rooms.get(id);
    // NaN on a room nobody has settled yet reads as "not cold", and the settle on
    // the next read fixes it — better than burning a log on a guess.
    if (!room || !(room.temp < CAMPFIRE_LIGHT_BELOW)) continue;
    if (takeResource(world, 'wood', 1) < 1) continue;
    b.fuel = CAMPFIRE_BURN_TICKS;
  }
}

/**
 * Step every room toward its target. Called once per tick from stepWorld, after
 * the power pass (a heater that lost its watts this tick is already cold) and
 * before spoilage (which is the oldest customer).
 */
export function tickTemperature(world: World): void {
  tickCampfires(world);
  const idx = roomIndex(world);
  const targets = roomTargets(world);
  for (const room of idx.rooms.values()) {
    const target = targets.get(room.id) ?? outdoorTemp(world);
    if (!Number.isFinite(room.temp)) {
      room.temp = target;
      continue;
    }
    room.temp += (target - room.temp) / (TAU_BASE + room.size * TAU_PER_CELL);
  }
  idx.tempTick = world.tick;
  remember(world, idx);
}

/**
 * Copy the rooms' heat onto the world so a save carries it.
 *
 * The index is a WeakMap off the world object and dies with the tab; the rooms
 * are rebuilt from the walls on load, but how warm they were is not derivable
 * from anything. Without this, loading a save puts every fire out and brings the
 * freezer back to room temperature — invisible for a second, then the meat rots.
 * Keyed by each room's lowest cell so the key survives a rebuild.
 */
function remember(world: World, idx: RoomIndex): void {
  const out: Record<string, number> = {};
  for (const room of idx.rooms.values()) {
    if (Number.isFinite(room.temp)) out[room.cells[0]!] = room.temp;
  }
  world.roomTemps = out;
}

/**
 * Bring the rooms up to date if nothing has ticked them on this tick.
 *
 * This is what keeps every other entry point honest: a freshly generated world,
 * a save the player just loaded, a test that jumped the clock by hand, and the
 * HUD drawing a frame before the first tick all read a settled room rather than
 * a room that is still at absolute zero because nobody had stepped it yet.
 */
function settle(world: World): void {
  const idx = roomIndex(world);
  const stepped = idx.tempTick === world.tick;
  let targets: Map<number, number> | null = null;
  for (const room of idx.rooms.values()) {
    // A room that has already been stepped this tick keeps its lag — that is the
    // thermal mass, and it is why walling a pantry off does not freeze it
    // instantly. A room that has never held a temperature at all is a different
    // matter: it was built this tick, and reading NaN off it would put NaN°C on
    // the card and NaN rot on everything standing in it.
    if (stepped && Number.isFinite(room.temp)) continue;
    targets ??= roomTargets(world);
    room.temp = targets.get(room.id) ?? outdoorTemp(world);
  }
  idx.tempTick = world.tick;
  remember(world, idx);
}

/** Air temperature in one cell: its room's air, or the sky if it has no room. */
export function cellTemp(world: World, x: number, y: number): number {
  const room = roomAt(world, x, y);
  if (!room) return outdoorTemp(world);
  settle(world);
  return room.temp;
}

/**
 * The temperature the crop on this cell is living at: its room's air if it is
 * under a roof, otherwise the season's.
 *
 * The room half is what makes a heated indoor plot worth the walls, the heater
 * and the power to run it — a greenhouse keeps producing through a winter that
 * has stopped everything outside, which is the one durable answer to the season
 * rather than a bigger pantry.
 */
export function growingTemp(world: World, x: number, y: number): number {
  const room = roomAt(world, x, y);
  if (!room) return seasonMeanTemp(world);
  settle(world);
  return room.temp;
}

/** "-4°C" / "17°C" — what both the top bar and the inspector print. */
export function tempLabel(t: number): string {
  return `${Math.round(t)}°C`;
}
