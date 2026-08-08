/**
 * The year.
 *
 * Ranked by what it would cost a player if it broke. Worst by a distance is the
 * landfall invariant: every constant in `temperature.ts`, every food number in
 * `farming.ts` and every balance test in this directory was tuned against a
 * thirteen-degree day one, so a season curve that quietly moved day one would
 * re-tune the whole game behind its own back and the failure would show up as
 * "colonies starve now" in a file that has nothing to do with seasons. Next is
 * winter not actually being winter — a season that costs nothing is a label. Then
 * the greenhouse, which is the only durable answer to winter the game offers and
 * is worthless if it does not work. Then the calendar arithmetic, and last the
 * announcements, which are how a player finds out any of this is happening.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createWorld, GARDEN, CABIN } from '../src/sim/worldgen';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { CROP_NONE, cropAt, seasonScale, tickCrops } from '../src/sim/farming';
import { outdoorTemp, seasonMeanTemp } from '../src/sim/temperature';
import { alerts } from '../src/sim/alerts';
import { addBuilding, addItem } from '../src/sim/world';
import { roomAt } from '../src/sim/rooms';
import { TERRAIN_COLOR, seasonTint } from '../src/client/render/palette';
import {
  DAYS_PER_SEASON,
  DAYS_PER_YEAR,
  SEASONS,
  dayOfSeason,
  daysUntilWinter,
  seasonOf,
  seasonOffsetAt,
  yearNumber,
} from '../src/sim/seasons';
import { TICKS_PER_DAY, packCell } from '../src/sim/types';
import type { World } from '../src/sim/types';

/** A world parked on a given day of the year, without simulating its way there. */
function onDay(day: number, seed = 4242): World {
  const world = createWorld(seed);
  world.tick = (day - 1) * TICKS_PER_DAY;
  return world;
}

/** The mean of `outdoorTemp` over one whole day, which is what a season moves. */
function dayMean(world: World): number {
  const start = world.tick;
  let sum = 0;
  const step = 60;
  for (let t = 0; t < TICKS_PER_DAY; t += step) {
    world.tick = start + t;
    sum += outdoorTemp(world);
  }
  world.tick = start;
  return sum / (TICKS_PER_DAY / step);
}

/**
 * Eat the starting stores. A new colony lands with about ten days of food, which
 * is enough to cover a winter on its own — so a test about the *warning* has to
 * take that away first or it is testing the pantry, not the season.
 */
function emptyPantry(world: World): void {
  world.items = world.items.filter((s) => s.kind !== 'meal' && s.kind !== 'rawfood');
}

/** Noon on the given day, which is when a crop is doing most of its growing. */
function noonOf(day: number): World {
  const world = onDay(day);
  world.tick += Math.round(TICKS_PER_DAY * 0.5);
  return world;
}

describe('the day the colony lands', () => {
  it('is exactly the weather the rest of the game was balanced in', () => {
    // Thirteen is the number `temperature.ts` calls LANDFALL_TEMP, and this is
    // the assertion that stops anyone tuning SEASON_SWING from moving it. If
    // this fails, the fix is in the baseline, never in this expectation.
    const origin = createWorld(4242);
    origin.tick = 0;
    expect(seasonMeanTemp(origin)).toBeCloseTo(13, 6);
    // And the year adds no heat of its own: the offset over a whole year sums
    // to nothing, so a colony on day 400 is living in the same climate as one on
    // day 4. Landfall is warm because it sits partway up the summer slope, not
    // because the curve is lopsided.
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += seasonOffsetAt(i / 1000);
    expect(sum / 1000).toBeCloseTo(0, 6);

    // A new colony does not actually open on tick 0 — worldgen starts it at
    // 07:12 so the first morning is a morning — so the temperature it really
    // lands in is a third of a day up the summer slope. Half a degree, against
    // an eleven-degree day swing: the balance the rest of the suite was tuned
    // against is intact, and this pins that the gap stays that small.
    const world = createWorld(4242);
    expect(world.tick).toBeGreaterThan(0);
    expect(Math.abs(seasonMeanTemp(world) - 13)).toBeLessThan(1);
  });

  it('leaves a summer plot growing at full speed', () => {
    const world = createWorld(4242);
    // Not "roughly full" — exactly 1. The growth band's ceiling sits below the
    // coldest summer mean on purpose, so the season is invisible until autumn.
    expect(seasonScale(world, GARDEN.x0, GARDEN.y0)).toBe(1);
    world.tick = TICKS_PER_DAY * 4;
    expect(seasonScale(world, GARDEN.x0, GARDEN.y0)).toBe(1);
  });

  it('starts in summer and gets warmer before it gets colder', () => {
    expect(seasonOf(createWorld(4242))).toBe('summer');
    const landfall = dayMean(onDay(1));
    const midsummer = dayMean(onDay(3));
    const midwinter = dayMean(onDay(13));
    expect(midsummer).toBeGreaterThan(landfall);
    expect(midwinter).toBeLessThan(landfall);
  });
});

describe('winter is winter', () => {
  it('runs below freezing', () => {
    const mean = dayMean(onDay(13));
    // Not a chilly afternoon: the mean itself is under zero, so the night is
    // deep into the range `health.ts` calls COLD_WORST and standing outside all
    // day is a decision with a cost.
    expect(mean).toBeLessThan(0);
    expect(mean).toBeGreaterThan(-8);
  });

  it('is the coldest season and summer the warmest', () => {
    const means = SEASONS.map((_, i) => dayMean(onDay(i * DAYS_PER_SEASON + 3)));
    const summer = means[SEASONS.indexOf('summer')]!;
    const winter = means[SEASONS.indexOf('winter')]!;
    expect(Math.max(...means)).toBe(summer);
    expect(Math.min(...means)).toBe(winter);
    // Autumn and spring are the same weather walked in opposite directions. Not
    // to six places: these sample the *start* of the third day of each season,
    // which is half a day off the point the curve is actually symmetric about,
    // so the two land a few hundredths apart. Half a degree is the honest claim.
    expect(means[SEASONS.indexOf('autumn')]).toBeCloseTo(means[SEASONS.indexOf('spring')]!, 0);
  });

  it('stops an outdoor plot dead, for the whole season', () => {
    for (let d = 0; d < DAYS_PER_SEASON; d++) {
      const world = noonOf(SEASONS.indexOf('winter') * DAYS_PER_SEASON + 1 + d);
      expect(seasonScale(world, GARDEN.x0, GARDEN.y0)).toBe(0);
    }
  });

  it('takes autumn down gradually rather than at a cliff', () => {
    const first = seasonScale(noonOf(6), GARDEN.x0, GARDEN.y0);
    const middle = seasonScale(noonOf(8), GARDEN.x0, GARDEN.y0);
    const last = seasonScale(noonOf(10), GARDEN.x0, GARDEN.y0);
    expect(first).toBe(1);
    expect(middle).toBeLessThan(first);
    expect(middle).toBeGreaterThan(0);
    expect(last).toBeLessThan(middle);
  });

  it('costs a plot most of a winter’s worth of food', () => {
    const grown = (day: number): number => {
      const world = onDay(day);
      world.crops.fill(CROP_NONE);
      const cell = packCell(world, GARDEN.x0, GARDEN.y0);
      world.crops[cell] = 0;
      for (let i = 0; i < TICKS_PER_DAY * 3; i++) {
        world.tick++;
        tickCrops(world);
      }
      return cropAt(world, GARDEN.x0, GARDEN.y0);
    };
    // Three days is the ripening time, so summer comes out ripe. The same three
    // days in midwinter is what the player is being asked to plan around.
    expect(grown(1)).toBeGreaterThan(0.9);
    expect(grown(12)).toBeLessThan(0.1);
  });
});

describe('a greenhouse beats the season', () => {
  it('keeps a heated indoor plot growing through midwinter', () => {
    const world = onDay(12);
    const x = CABIN.x0 + 1;
    const y = CABIN.y0 + 1;
    expect(roomAt(world, x, y)).not.toBeNull();
    addBuilding(world, 'heater', CABIN.x0 + 2, CABIN.y0 + 1, true);
    for (const b of world.buildings) if (b.kind === 'heater') b.powered = true;

    // Let the room's air catch up with the heater running in it. Thermal lag is
    // the point of that pass — a greenhouse is not warm the tick it is switched on.
    stepWorldN(world, makeStreams(world), 400);

    const inside = seasonScale(world, x, y);
    const outside = seasonScale(world, GARDEN.x0, GARDEN.y0);
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(0.5);
  });

  it('does not keep an unheated shed growing', () => {
    const world = onDay(12);
    const x = CABIN.x0 + 1;
    const y = CABIN.y0 + 1;
    stepWorldN(world, makeStreams(world), 400);
    // A roof is worth a few degrees against a midwinter mean of about -2, and a
    // few degrees is not a growing season. Walls alone must not be the answer,
    // or the heater and the power to run it are decoration.
    expect(seasonScale(world, x, y)).toBeLessThan(0.5);
  });
});

describe('the valley changes colour', () => {
  /** Grass, put through the year. */
  const grassAt = (phase: number): THREE.Color =>
    seasonTint(new THREE.Color(TERRAIN_COLOR.grass), phase);
  /** Mid-season phases: the quarter points of the year, offset to each middle. */
  const mid = (i: number): number => (i + 0.5) / SEASONS.length;

  it('leaves high summer exactly the colour the game was drawn in', () => {
    // The peak of the curve is the one point with no tint at all, and it has to
    // be: every other colour in the palette was picked to sit against this green.
    const peak = grassAt(0.125);
    const raw = new THREE.Color(TERRAIN_COLOR.grass);
    expect(peak.getHex()).toBe(raw.getHex());
  });

  it('turns the ground gold through autumn and green again in spring', () => {
    const summer = grassAt(mid(SEASONS.indexOf('summer')));
    const autumn = grassAt(mid(SEASONS.indexOf('autumn')));
    const spring = grassAt(mid(SEASONS.indexOf('spring')));
    // Gold is red rising and blue falling away from it — the same green with the
    // brightness turned up would be a bug that this catches.
    expect(autumn.r).toBeGreaterThan(summer.r);
    expect(autumn.b).toBeLessThan(summer.b + 0.02);
    expect(spring.g).toBeGreaterThan(summer.g);
    expect(spring.r).toBeLessThan(autumn.r);
  });

  it('washes midwinter out toward frost', () => {
    const summer = grassAt(mid(SEASONS.indexOf('summer')));
    const winter = grassAt(mid(SEASONS.indexOf('winter')));
    const spread = (c: THREE.Color): number =>
      Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    // Brighter and less saturated, which is what snow light does to a colour.
    expect(winter.r + winter.g + winter.b).toBeGreaterThan(summer.r + summer.g + summer.b);
    expect(spread(winter)).toBeLessThan(spread(summer));
    expect(winter.b).toBeGreaterThan(winter.r);
  });

  it('moves every step of the way, never in four jumps', () => {
    // A season boundary must not be where the colour changes. Sampled around the
    // whole year, no single step may be much bigger than its neighbours — which
    // is the difference between a valley turning and a valley being swapped out.
    const steps: number[] = [];
    let prev = grassAt(0);
    for (let i = 1; i <= 80; i++) {
      const next = grassAt(i / 80);
      steps.push(Math.abs(next.r - prev.r) + Math.abs(next.g - prev.g) + Math.abs(next.b - prev.b));
      prev = next;
    }
    const biggest = Math.max(...steps);
    const typical = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(biggest).toBeLessThan(typical * 3);
  });
});

describe('the calendar', () => {
  it('gives each season the same number of days, in order', () => {
    for (let i = 0; i < SEASONS.length; i++) {
      for (let d = 1; d <= DAYS_PER_SEASON; d++) {
        const world = onDay(i * DAYS_PER_SEASON + d);
        expect(seasonOf(world)).toBe(SEASONS[i]);
        expect(dayOfSeason(world)).toBe(d);
      }
    }
  });

  it('rolls into a second year and starts it in summer again', () => {
    expect(yearNumber(onDay(DAYS_PER_YEAR))).toBe(1);
    const next = onDay(DAYS_PER_YEAR + 1);
    expect(yearNumber(next)).toBe(2);
    expect(seasonOf(next)).toBe('summer');
    expect(dayOfSeason(next)).toBe(1);
  });

  it('counts down to winter and reads zero once it is here', () => {
    const winterStarts = SEASONS.indexOf('winter') * DAYS_PER_SEASON + 1;
    expect(daysUntilWinter(onDay(1))).toBe(winterStarts - 1);
    expect(daysUntilWinter(onDay(winterStarts - 1))).toBe(1);
    expect(daysUntilWinter(onDay(winterStarts))).toBe(0);
    expect(daysUntilWinter(onDay(winterStarts + 2))).toBe(0);
    // And past winter it is counting toward the *next* one, not backwards.
    const spring = SEASONS.indexOf('spring') * DAYS_PER_SEASON + 1;
    expect(daysUntilWinter(onDay(spring))).toBe(DAYS_PER_YEAR - DAYS_PER_SEASON);
  });
});

describe('being told about it', () => {
  it('announces a season the tick it turns, once', () => {
    const world = createWorld(4242);
    const streams = makeStreams(world);
    // Parked two ticks short of the turn rather than simulated there: the turn
    // is wired to an absolute tick, and five days of sim to reach it would only
    // buy the same two ticks of evidence at a hundred times the cost.
    world.tick = DAYS_PER_SEASON * TICKS_PER_DAY - 2;
    const before = world.messages.length;
    stepWorld(world, streams);
    stepWorld(world, streams);
    const said = world.messages.slice(before).filter((m) => /Autumn\./.test(m.text));
    expect(said.length).toBe(1);
    // Twenty more ticks and it is still one — the turn is an edge, not a state.
    stepWorldN(world, streams, 20);
    expect(world.messages.filter((m) => /Autumn\./.test(m.text)).length).toBe(1);
  });

  it('says nothing on the first tick of the game', () => {
    const world = createWorld(4242);
    stepWorld(world, makeStreams(world));
    expect(world.messages.some((m) => /Summer\./.test(m.text))).toBe(false);
  });

  it('warns about winter in time to do something about it', () => {
    const winterStarts = SEASONS.indexOf('winter') * DAYS_PER_SEASON + 1;
    const early = alerts(onDay(winterStarts - 4)).find((a) => a.id === 'winter');
    const late = alerts(onDay(winterStarts - 2)).find((a) => a.id === 'winter');
    // Not all autumn — only once it is close enough that sowing one more round
    // is still a decision the player can make and see the end of.
    expect(early).toBeUndefined();
    expect(late).toBeDefined();
    expect(late!.text).toMatch(/Winter in 2 days/);
    // A colony with no fire at all is told about the fire first.
    expect(late!.hint).toMatch(/heater|campfire/);
  });

  it('names the harvest instead once there is something to stand at', () => {
    const world = onDay(SEASONS.indexOf('winter') * DAYS_PER_SEASON - 1);
    emptyPantry(world);
    addBuilding(world, 'campfire', CABIN.x0 + 1, CABIN.y0 + 1, true);
    const alert = alerts(world).find((a) => a.id === 'winter')!;
    expect(alert.hint).toMatch(/Harvest/);
  });

  it('says nothing to a colony that is already warm and fed', () => {
    const world = onDay(SEASONS.indexOf('winter') * DAYS_PER_SEASON - 1);
    addBuilding(world, 'campfire', CABIN.x0 + 1, CABIN.y0 + 1, true);
    emptyPantry(world);
    // Both halves are required, and the test says so twice: heat without food
    // and food without heat are each still a warning, because they are each
    // still a way to lose a colony over a winter.
    expect(alerts(world).some((a) => a.id === 'winter')).toBe(true);
    // Enough cooked meals to eat all winter and out the other side. An alert
    // that stays up after the problem is solved is the one that teaches a player
    // to scroll past the strip.
    addItem(world, 'meal', 200, CABIN.x0 + 2, CABIN.y0 + 2);
    expect(alerts(world).some((a) => a.id === 'winter')).toBe(false);

    const noFire = onDay(SEASONS.indexOf('winter') * DAYS_PER_SEASON - 1);
    addItem(noFire, 'meal', 200, CABIN.x0 + 2, CABIN.y0 + 2);
    expect(alerts(noFire).some((a) => a.id === 'winter')).toBe(true);
  });
});
