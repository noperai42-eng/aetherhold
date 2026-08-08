/**
 * The year.
 *
 * Until now the colony lived in one long temperate afternoon: day 40 was day 4
 * with more walls. Every climate system in the game — the heater, the cooler, the
 * sealed room, the food that ages at the temperature of the cell it sits on —
 * was built and then never really pressed, because the weather could take five
 * degrees off an afternoon and nothing more. A year fixes that with no new
 * mechanics at all. It just moves the number those systems already read.
 *
 * Twenty days: five each of summer, autumn, winter and spring, and the colony
 * lands on the first morning of summer. That ordering is the whole design. The
 * player gets ten days of grace to learn the game in weather that forgives, then
 * five days of visible warning as the plots slow and the nights bite, and then
 * winter — which is not an event the storyteller sends, it is simply a fact of
 * the calendar that has been coming since the first minute and can be prepared
 * for exactly.
 *
 * Nothing here draws a random number and nothing here is saved. The season is a
 * pure function of `world.tick`, which means an old save opens into the right
 * month of the right year without a migration, and two colonies on the same seed
 * are still the same colony.
 */

import { TICKS_PER_DAY } from './types';
import type { World } from './types';

/** In calendar order from landfall. The colony arrives on the first day of summer. */
export const SEASONS = ['summer', 'autumn', 'winter', 'spring'] as const;
export type Season = (typeof SEASONS)[number];

export const DAYS_PER_SEASON = 5;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;
const TICKS_PER_SEASON = DAYS_PER_SEASON * TICKS_PER_DAY;
const TICKS_PER_YEAR = DAYS_PER_YEAR * TICKS_PER_DAY;

/**
 * How far the year's mean temperature swings either side of the annual mean, in °C.
 *
 * Nine, which sounds mild next to the eleven-degree day/night swing it sits on
 * top of, and is not: they compound. Midwinter runs about -2 °C mean, so a night
 * outdoors is -13 and the warmest hour of the day is +9. That puts an outdoor
 * settler past `COLD_WORST` for most of the day and holds the growing
 * temperature under the floor for the whole season, which is the point. Bigger
 * numbers than this stop being a season and start being a hazard the player
 * cannot build their way out of in the ten days they are given.
 */
const SEASON_SWING = 9;

/**
 * Where the warmest point of the year sits, as a fraction of it.
 *
 * The middle of summer, not the start — a solstice calendar would make the first
 * morning of the game the hottest it ever gets and every day after it colder,
 * and the colony would spend its entire first season in decline. This way the
 * year opens on the up-slope.
 */
const PEAK_PHASE = 0.125;

const WINTER_START = SEASONS.indexOf('winter') / SEASONS.length;

/** 0 on the first tick of summer, approaching 1 at the end of spring. */
export function yearPhase(world: World): number {
  return (world.tick % TICKS_PER_YEAR) / TICKS_PER_YEAR;
}

/** 1 for the first year, and the number the tally screen prints. */
export function yearNumber(world: World): number {
  return Math.floor(world.tick / TICKS_PER_YEAR) + 1;
}

export function seasonOf(world: World): Season {
  return SEASONS[Math.floor(yearPhase(world) * SEASONS.length)] ?? 'summer';
}

/** 1-based, so the bar can say "day 2 of 5". */
export function dayOfSeason(world: World): number {
  return (Math.floor(world.tick / TICKS_PER_DAY) % DAYS_PER_SEASON) + 1;
}

/** Whole days until winter's first morning — 0 once it is already here. */
export function daysUntilWinter(world: World): number {
  if (seasonOf(world) === 'winter') return 0;
  const t = world.tick % TICKS_PER_YEAR;
  const start = WINTER_START * TICKS_PER_YEAR;
  const away = t < start ? start - t : TICKS_PER_YEAR - t + start;
  return Math.ceil(away / TICKS_PER_DAY);
}

/** True on the exact tick a season turns over, and never on tick 0. */
export function seasonTurned(world: World): boolean {
  return world.tick > 0 && world.tick % TICKS_PER_SEASON === 0;
}

/**
 * What the season adds to the outdoor mean, in °C.
 *
 * Split from `seasonTempOffset` so `temperature.ts` can ask what the offset is
 * at landfall without a world to ask it about — it needs that number to set its
 * own baseline, and a baseline that drifted from this curve would move the
 * temperature of day one, which is the day every other constant in that file was
 * balanced against.
 */
export function seasonOffsetAt(phase: number): number {
  return SEASON_SWING * warmthAt(phase);
}

/**
 * Where the year is, as two numbers between -1 and 1.
 *
 * `warmthAt` is +1 at the height of summer and -1 at the depth of winter, and it
 * is the curve the temperature rides. `turningAt` is its slope: +1 in the middle
 * of autumn when the year is falling fastest, -1 in the middle of spring when it
 * is climbing, and 0 at both extremes where it is doing neither.
 *
 * The second one exists because autumn and spring are the same *temperature* and
 * do not look remotely alike. A valley in October is gold and a valley in April
 * is green, and the only thing that separates them is which way the year is
 * going — so the renderer asks for the slope and paints the ground with it.
 */
export function warmthAt(phase: number): number {
  return Math.cos((phase - PEAK_PHASE) * Math.PI * 2);
}

export function turningAt(phase: number): number {
  return Math.sin((phase - PEAK_PHASE) * Math.PI * 2);
}

export function seasonTempOffset(world: World): number {
  return seasonOffsetAt(yearPhase(world));
}

/** "Autumn" — the season, capitalised, for a bar or a sentence. */
export function seasonLabel(world: World): string {
  const name = seasonOf(world);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** What the log says on the morning a season turns. */
export const SEASON_NEWS: Record<Season, string> = {
  summer: 'Summer. The plots are growing as fast as they ever will.',
  autumn: 'Autumn. The nights are drawing in — five days of growing weather left.',
  winter: 'Winter. Nothing will grow outdoors until spring. Keep everyone warm and fed.',
  spring: 'Spring. The ground is thawing and the plots are worth sowing again.',
};
