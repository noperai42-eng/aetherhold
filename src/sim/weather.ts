/**
 * Weather.
 *
 * The colony already had a day and a night; what it did not have was a reason
 * for one afternoon to feel different from the next. Weather is that reason, and
 * it earns its place by changing decisions rather than only pixels: rain doubles
 * the rate a plot ripens and drowns a fire that would otherwise eat the cabin,
 * fog makes every shot worse, and a storm is a window where nothing comes out of
 * the treeline. A player who notices the sky and plants, or drafts, or waits, is
 * playing the weather.
 *
 * A front does not know what month it is; the thermometer decides what comes out
 * of it. The same low that brings rain in July arrives in January as snow, and
 * that is not a repaint — snow waters nothing and barely touches a fire, so the
 * two most useful things about bad weather are gone in the season you need them.
 *
 * It is plain data on the World, rolled by the sim, and every consumer — farming,
 * fires, combat, the storyteller, both cameras — reads the same three numbers.
 * Nothing here touches three.js.
 */

import type { Rng } from './rng';
import { outdoorTemp } from './temperature';
import { TICKS_PER_DAY, type WeatherKind, type WeatherState, type World } from './types';
import { msg } from './world';

/** How long a front lasts, in ticks: [min, max]. */
const DURATION: Record<WeatherKind, [number, number]> = {
  clear: [TICKS_PER_DAY * 0.5, TICKS_PER_DAY * 1.2],
  cloudy: [TICKS_PER_DAY * 0.3, TICKS_PER_DAY * 0.8],
  rain: [TICKS_PER_DAY * 0.2, TICKS_PER_DAY * 0.5],
  storm: [TICKS_PER_DAY * 0.12, TICKS_PER_DAY * 0.28],
  fog: [TICKS_PER_DAY * 0.15, TICKS_PER_DAY * 0.35],
};

/**
 * What can follow what, and how likely.
 *
 * Chained rather than uniform, because a sky that jumps clear → storm → clear is
 * weather as a dice roll. Rain arrives through cloud and leaves through cloud;
 * fog burns off into clear. Clear is the most common resting state so the game
 * spends most of its time in the light a player can plan in.
 */
const TRANSITIONS: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [
    ['clear', 0.34],
    ['cloudy', 0.42],
    ['fog', 0.16],
    ['rain', 0.08],
  ],
  cloudy: [
    ['clear', 0.38],
    ['rain', 0.34],
    ['cloudy', 0.14],
    ['storm', 0.14],
  ],
  rain: [
    ['cloudy', 0.5],
    ['storm', 0.2],
    ['clear', 0.2],
    ['fog', 0.1],
  ],
  storm: [
    ['rain', 0.55],
    ['cloudy', 0.35],
    ['clear', 0.1],
  ],
  fog: [
    ['clear', 0.55],
    ['cloudy', 0.3],
    ['rain', 0.15],
  ],
};

/** How fast a front fades in and out. A front takes about half a minute to settle. */
const BLEND_PER_TICK = 1 / 90;

const ARRIVAL: Record<WeatherKind, string | null> = {
  clear: 'The clouds break — clear skies over Aetherhold.',
  cloudy: 'Cloud rolls in off the ridge.',
  rain: 'Rain sweeps across the clearing. The plots drink it up.',
  storm: 'A storm breaks. Thunder over the treeline — nothing will march in this.',
  fog: 'Fog settles thick in the hollow. You can barely see the treeline.',
};

/** What the same two fronts are called when the air is below freezing. */
const ARRIVAL_COLD: Partial<Record<WeatherKind, string>> = {
  rain: 'Snow starts falling over the clearing. It settles on the plots and does nothing for them.',
  storm: 'A blizzard closes in. The treeline is gone, and so is anyone who was thinking of crossing it.',
};

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  storm: 'Storm',
  fog: 'Fog',
};

/**
 * The air temperatures precipitation changes state between: all water at or
 * above `RAIN_ALL`, all snow at or below `SNOW_ALL`, sleet in between.
 *
 * A band rather than a line at zero, for a reason that is both physical and
 * practical. Real precipitation does not flip on a knife edge — it goes through
 * sleet — and a knife edge here would put a colony sitting at exactly 0 °C into
 * a flicker between two different skies every time the wind offset wobbled.
 */
const SNOW_ALL = -1;
const RAIN_ALL = 2;

/** How much of what is coming down is frozen: 0 rain, 1 snow, between is sleet. */
export function snowShare(world: World): number {
  const t = outdoorTemp(world);
  return Math.max(0, Math.min(1, (RAIN_ALL - t) / (RAIN_ALL - SNOW_ALL)));
}

/**
 * What the sky is called right now.
 *
 * The kind on the World is what the front *is* — a low-pressure system does not
 * know what the thermometer says — and this is what it looks like from the
 * ground. Deliberately derived rather than stored: a front that arrives as rain
 * at dusk and is still going at 3 a.m. has turned to snow by then, and the HUD
 * should say so without anything having to notice and rewrite the state.
 */
export function weatherLabel(world: World): string {
  const kind = world.weather.kind;
  if (kind !== 'rain' && kind !== 'storm') return WEATHER_LABEL[kind];
  const share = snowShare(world);
  if (share >= 0.9) return kind === 'storm' ? 'Blizzard' : 'Snow';
  if (share >= 0.35) return 'Sleet';
  return WEATHER_LABEL[kind];
}

export function makeWeather(rng: Rng): WeatherState {
  return {
    kind: 'clear',
    // The first day opens clear and stays that way long enough to learn the game.
    ticksLeft: Math.round(TICKS_PER_DAY * (0.9 + rng.range(0, 0.4))),
    blend: 1,
    strikeTick: -9999,
  };
}

function roll(rng: Rng, from: WeatherKind): WeatherKind {
  const table = TRANSITIONS[from];
  let r = rng.range(0, 1);
  for (const [kind, weight] of table) {
    r -= weight;
    if (r <= 0) return kind;
  }
  return table[table.length - 1]![0];
}

function duration(rng: Rng, kind: WeatherKind): number {
  const [lo, hi] = DURATION[kind];
  return Math.round(rng.range(lo, hi));
}

/**
 * One tick of sky.
 *
 * Also the only place lightning happens. A strike during a storm can start a
 * fire, which sounds cruel next to rain that puts fires out — it is not: the
 * rain is exactly what keeps a strike from being a colony-ender, so the two
 * rules together produce a scare rather than a wipe.
 */
export function tickWeather(world: World, rng: Rng, ignite: (x: number, y: number) => void): void {
  const w = world.weather;
  w.ticksLeft--;
  w.blend = Math.min(1, w.blend + BLEND_PER_TICK);

  if (w.ticksLeft <= 0) {
    const next = roll(rng, w.kind);
    w.ticksLeft = duration(rng, next);
    if (next !== w.kind) {
      w.kind = next;
      w.blend = 0;
      const line = (snowShare(world) >= 0.5 ? ARRIVAL_COLD[next] : undefined) ?? ARRIVAL[next];
      if (line) msg(world, line, next === 'storm' ? 'threat' : 'info');
    }
  }

  if (w.kind === 'storm' && w.blend > 0.5 && rng.chance(1 / 260)) {
    w.strikeTick = world.tick;
    const x = 1 + rng.int(world.width - 2);
    const y = 1 + rng.int(world.height - 2);
    ignite(x, y);
  }
}

/** 0 when dry, 1 in the heaviest fall — water or snow, before the two are told apart. */
export function precipitation(world: World): number {
  const w = world.weather;
  if (w.kind === 'rain') return 0.7 * w.blend;
  if (w.kind === 'storm') return w.blend;
  return 0;
}

/**
 * 0 when dry, 1 in the heaviest downpour. Everything wet-related scales off this.
 *
 * Water only. Snow is not rain that happens to be white: it does not soak into
 * frozen ground, so it does not water a plot, and it does not run into a fire, so
 * it does not put one out the way a downpour does. Both of those fall out of this
 * one line rather than being written down twice — the callers already ask "how
 * wet is it", and in February the honest answer is "not".
 */
export function rainfall(world: World): number {
  return precipitation(world) * (1 - snowShare(world));
}

/** 0 when nothing frozen is falling, 1 in a whiteout. */
export function snowfall(world: World): number {
  return precipitation(world) * snowShare(world);
}

/**
 * How hard the sky is fighting your fire, 0..1.
 *
 * Snow counts, but at a quarter: falling snow smothers a flame slowly where rain
 * drowns it. That gap is the whole reason this is a separate number and not just
 * `rainfall` — a fire in a winter storm is a genuinely worse problem than the
 * same fire in a summer one, and the player should find that out by fighting it
 * rather than by reading it here.
 *
 * A quarter and not the third it started as, because a third put a full blizzard
 * at exactly the wetness `events.ts` stops a fire spreading at, and landing on a
 * threshold in another file is not a balance decision — it is a coincidence that
 * would have handed winter the same firebreak summer rain gets. At a quarter a
 * blizzard leaves a fire growing, slowly, and still spreading, which is the whole
 * thing this number exists to say.
 */
const SNOW_DOUSE = 0.25;

export function douse(world: World): number {
  return rainfall(world) + snowfall(world) * SNOW_DOUSE;
}

/** 0 under open sky, 1 under the thickest overcast. Dims the sun, greys the sky. */
export function cloudiness(world: World): number {
  const w = world.weather;
  const target =
    w.kind === 'storm' ? 0.92 : w.kind === 'rain' ? 0.72 : w.kind === 'cloudy' ? 0.45 : w.kind === 'fog' ? 0.55 : 0;
  return target * w.blend;
}

/** 1 when you can see clean across the map, down to ~0.4 in thick fog. */
export function visibility(world: World): number {
  const w = world.weather;
  if (w.kind === 'fog') return 1 - 0.6 * w.blend;
  if (w.kind === 'storm') return 1 - 0.25 * w.blend;
  if (w.kind === 'rain') return 1 - 0.12 * w.blend;
  return 1;
}

/** How hard the wind is pushing, 0..1. Drives the grass sway and the rain slant. */
export function windStrength(world: World): number {
  const w = world.weather;
  const base = w.kind === 'storm' ? 1 : w.kind === 'rain' ? 0.5 : w.kind === 'cloudy' ? 0.3 : 0.12;
  return base * w.blend + 0.12 * (1 - w.blend);
}

/**
 * Extra bullet spread from the weather, as a multiplier on the base cone.
 *
 * Rain and fog make a rifle worse for everyone — including the raiders, which is
 * why a storm is a defensible window rather than a straight penalty.
 */
export function spreadMultiplier(world: World): number {
  return 1 + (1 - visibility(world)) * 1.4;
}

/** Crop growth multiplier. Rain is the only thing in the game that speeds a plot up. */
export function growthMultiplier(world: World): number {
  return 1 + rainfall(world) * 0.9;
}

/** True while it is coming down hard enough that raiders wait it out. */
export function isStormbound(world: World): boolean {
  return world.weather.kind === 'storm' && world.weather.blend > 0.4;
}

/** Frames since the last lightning strike are what both views flash on. */
export function strikeFlash(world: World): number {
  const age = world.tick - world.weather.strikeTick;
  if (age < 0 || age > 8) return 0;
  return 1 - age / 8;
}
