/** In-game clock derived from the tick counter. Pure functions — both views read the same numbers. */

import type { World } from './types';
import { TICKS_PER_DAY } from './types';

/** 0 = midnight, 0.5 = noon. */
export function timeOfDay(world: World): number {
  return (world.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
}

export function dayNumber(world: World): number {
  return Math.floor(world.tick / TICKS_PER_DAY) + 1;
}

export function hourOfDay(world: World): number {
  return timeOfDay(world) * 24;
}

export function clockString(world: World): string {
  const h = hourOfDay(world);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Sun elevation in radians: negative at night, peaks at noon.
 *
 * The peak is deliberately well short of overhead. A sun at the zenith strikes
 * every wall, tree and rock face edge-on, so vertical surfaces get almost no
 * direct light and a colony at midday reads as black slabs with lit roofs. A
 * raking noon sun costs nothing and gives every building a lit side and a shaded
 * one. Sunrise and sunset are unaffected — the zero crossings are set by the
 * phase, not the amplitude.
 */
export function sunElevation(world: World): number {
  const t = timeOfDay(world);
  return Math.sin((t - 0.25) * Math.PI * 2) * (Math.PI / 2) * 0.58;
}

export function sunAzimuth(world: World): number {
  return timeOfDay(world) * Math.PI * 2 + Math.PI * 0.35;
}

/** 0 at deep night .. 1 at midday. Drives both the sky and the "is it dark" logic. */
export function daylight(world: World): number {
  const e = Math.sin((timeOfDay(world) - 0.25) * Math.PI * 2);
  return Math.max(0, Math.min(1, (e + 0.18) / 0.9));
}

export function isNight(world: World): boolean {
  return daylight(world) < 0.16;
}

/** Settlers head to bed in this window (late evening → early morning). */
export function isSleepHours(world: World): boolean {
  const h = hourOfDay(world);
  return h >= 21.5 || h < 6.5;
}
