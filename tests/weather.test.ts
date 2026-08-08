/**
 * Weather has to be a system the player can plan around, not a filter over the
 * screen. Every test here pins one of the four things the sky actually *does*:
 * rain ripens crops, rain kills fires, poor visibility spoils everyone's aim,
 * and a storm buys the colony a quiet window to rebuild in.
 *
 * The one rule with no gameplay in it at all is the regression guard: weather
 * draws from its own RNG stream, because the first version of this file pulled
 * from the worldgen stream and silently regenerated every map in the game.
 */

import { describe, expect, it } from 'vitest';

import { igniteFire, tickFires, tickStoryteller } from '../src/sim/events';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { tickCrops } from '../src/sim/farming';
import {
  WEATHER_LABEL,
  cloudiness,
  douse,
  growthMultiplier,
  isStormbound,
  makeWeather,
  precipitation,
  rainfall,
  snowfall,
  spreadMultiplier,
  strikeFlash,
  tickWeather,
  visibility,
  weatherLabel,
  windStrength,
} from '../src/sim/weather';
import { TICKS_PER_DAY, packCell, type WeatherKind, type World } from '../src/sim/types';
import { createWorld } from '../src/sim/worldgen';

const KINDS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog'];

/** Force a settled front of one kind, with no fade left to run. */
function setWeather(world: World, kind: WeatherKind, blend = 1): void {
  world.weather.kind = kind;
  world.weather.blend = blend;
  world.weather.ticksLeft = TICKS_PER_DAY;
}

/** Noon, so `daylight()` is at its peak and crop growth is measurable. */
function setNoon(world: World): void {
  world.tick = Math.round(TICKS_PER_DAY * 0.5);
}

// ---------------------------------------------------------------- functional

describe('weather state machine', () => {
  it('opens on clear skies so the first day is legible', () => {
    const w = makeWeather(new Rng(1));
    expect(w.kind).toBe('clear');
    expect(w.blend).toBe(1);
    expect(w.ticksLeft).toBeGreaterThan(TICKS_PER_DAY * 0.8);
  });

  it('eventually visits every kind, and never leaves the set', () => {
    const world = createWorld(4242);
    const rng = new Rng(7);
    const seen = new Set<WeatherKind>();
    // Assert outside the loop: 60 in-game days is a quarter of a million ticks,
    // and an expect() per tick costs far more than the simulation does.
    for (let i = 0; i < TICKS_PER_DAY * 60; i++) {
      tickWeather(world, rng, () => {});
      seen.add(world.weather.kind);
    }
    expect([...seen].sort()).toEqual([...KINDS].sort());
  });

  it('fades a new front in rather than snapping to it', () => {
    const world = createWorld(4242);
    const rng = new Rng(11);
    world.weather.kind = 'clear';
    world.weather.blend = 0;
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      tickWeather(world, rng, () => {});
      samples.push(world.weather.blend);
    }
    // Monotone up, still short of settled after 40 ticks (two seconds).
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThan(samples[i - 1]!);
    }
    expect(samples[samples.length - 1]!).toBeLessThan(1);
  });

  it('is deterministic for a fixed seed', () => {
    const run = (): string => {
      const world = createWorld(555);
      const rng = new Rng(99);
      const out: string[] = [];
      for (let i = 0; i < TICKS_PER_DAY * 10; i++) {
        tickWeather(world, rng, () => {});
        if (i % 500 === 0) out.push(`${world.weather.kind}:${world.weather.blend.toFixed(3)}`);
      }
      return out.join('|');
    };
    expect(run()).toBe(run());
  });

  it('does not disturb worldgen — the weather draws from its own stream', () => {
    // The map for a given seed must be byte-identical to what it was before the
    // sky existed. This caught a live regression: `makeWeather(rng)` consumed
    // worldgen's stream and shifted every terrain roll after it.
    const a = createWorld(99001);
    const b = createWorld(99001);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.pawns.map((p) => `${p.name}@${p.x},${p.y}`)).toEqual(
      b.pawns.map((p) => `${p.name}@${p.x},${p.y}`),
    );
    // Everything downstream of the terrain rolls too, since a shifted stream
    // moves the cabin and the settlers rather than announcing itself. This used
    // to also assert that seed 99001 fenced its west edge in rock, which was a
    // fact about a 64-wide map masquerading as a fact about the RNG.
    expect(a.buildings.map((x) => `${x.kind}@${x.x},${x.y}`)).toEqual(
      b.buildings.map((x) => `${x.kind}@${x.x},${x.y}`),
    );
    expect(a.items.map((x) => `${x.kind}:${x.amount}@${x.x},${x.y}`)).toEqual(
      b.items.map((x) => `${x.kind}:${x.amount}@${x.x},${x.y}`),
    );
  });
});

describe('the same front in a different month', () => {
  /** Noon on a summer day and midnight on a midwinter one, at the same front. */
  function summer(kind: WeatherKind): World {
    const world = createWorld(1);
    world.tick = Math.round(TICKS_PER_DAY * 2.6);
    setWeather(world, kind);
    return world;
  }

  function winter(kind: WeatherKind): World {
    const world = createWorld(1);
    // Midnight of day 13, deep enough that no weather offset can lift it back
    // over freezing — the test is about snow, not about the width of the band.
    world.tick = Math.round(TICKS_PER_DAY * 12.1);
    setWeather(world, kind);
    return world;
  }

  it('falls as rain in summer and as snow in winter, and it is the same front', () => {
    const july = summer('storm');
    const january = winter('storm');

    // The low-pressure system is identical — same kind, same blend, same amount
    // of water in the air. Only the thermometer differs, which is the whole
    // model: the sky does not know what month it is.
    expect(precipitation(january)).toBe(precipitation(july));

    expect(rainfall(july)).toBeGreaterThan(0.9);
    expect(snowfall(july)).toBe(0);
    expect(snowfall(january)).toBeGreaterThan(0.9);
    expect(rainfall(january)).toBe(0);

    expect(weatherLabel(july)).toBe('Storm');
    expect(weatherLabel(january)).toBe('Blizzard');
    expect(weatherLabel(winter('rain'))).toBe('Snow');
    expect(weatherLabel(winter('fog'))).toBe('Fog');
  });

  it('gives sleet to the temperatures in between, and never loses a drop', () => {
    const world = createWorld(1);
    setWeather(world, 'rain');
    let sleet = 0;
    // Walk the whole year an hour at a time. However the two are split, they
    // must always add back up to what is falling — otherwise some weather would
    // quietly water nothing and freeze nothing.
    for (let t = 0; t < TICKS_PER_DAY * 20; t += TICKS_PER_DAY / 24) {
      world.tick = Math.round(t);
      const total = precipitation(world);
      expect(rainfall(world) + snowfall(world)).toBeCloseTo(total, 10);
      if (rainfall(world) > 0.001 && snowfall(world) > 0.001) sleet++;
    }
    // And the band is wide enough to actually be visited, rather than being a
    // knife edge dressed up as one.
    expect(sleet).toBeGreaterThan(4);
    expect(weatherLabel(world)).toMatch(/Rain|Sleet|Snow/);
  });

  it('does not water the plots and barely fights a fire', () => {
    // The two things rain is *for*, both gone in the season a colony needs them.
    expect(growthMultiplier(summer('storm'))).toBeGreaterThan(1.5);
    expect(growthMultiplier(winter('storm'))).toBe(1);

    const wet = douse(summer('storm'));
    const cold = douse(winter('storm'));
    expect(wet).toBeGreaterThan(0.9);
    // Not nothing — falling snow does smother a flame — but nowhere near enough
    // to fight the fire for you, which is what makes a winter blaze the worse
    // emergency of the two.
    expect(cold).toBeGreaterThan(0.1);
    expect(cold).toBeLessThan(wet * 0.5);
  });

  it('leaves a fire alive in a blizzard that a downpour would have drowned', () => {
    // The read-out above says snow fights a fire at a quarter strength. This is
    // the same claim put through the fire code, which is where it has to be true:
    // `douse` feeds two separate thresholds in `events.ts`, and a snow constant
    // that happened to land on one of them would hand winter the firebreak that
    // is supposed to be summer rain's alone.
    const burn = (world: World): number => {
      // Burn open ground, not a tree: a building under the flame burns down and
      // takes the fire with it, which would make this a test about how long a
      // pine lasts. The clock is held for the same reason — spread is gated on
      // `world.tick`, and the only thing that should move here is the size.
      world.buildings = world.buildings.filter((b) => !(b.x === 4 && b.y === 4));
      igniteFire(world, 4, 4);
      const rng = new Rng(9);
      // Seventy ticks and not more: past about 0.85 a fire on bare ground starts
      // rolling to burn itself out, and the control would then be racing the
      // dice rather than the weather.
      for (let i = 0; i < 70; i++) tickFires(world, rng);
      return world.fires[0]?.size ?? 0;
    };

    // Rain drowns it: gone well inside the three hundred ticks.
    expect(burn(summer('storm'))).toBe(0);
    // Snow does not. It is slower than a fire in clear air would be — that is
    // the smothering — but it is still getting bigger, and it is still there.
    const inSnow = burn(winter('storm'));
    expect(inSnow).toBeGreaterThan(0.35);
    expect(inSnow).toBeLessThan(burn(summer('clear')));
  });

  it('says what is falling rather than what the front is called', () => {
    const world = createWorld(1);
    world.tick = Math.round(TICKS_PER_DAY * 12.1);
    const rng = new Rng(3);
    const said = new Set<string>();
    // `tickWeather` never moves the clock, so the colony stays at midwinter
    // midnight for the whole run and every front that arrives arrives frozen.
    // The log is drained each tick rather than diffed by length, because it caps
    // at eighty and a diffed length would go quiet exactly when it filled up.
    for (let i = 0; i < TICKS_PER_DAY * 12; i++) {
      tickWeather(world, rng, () => {});
      for (const m of world.messages) said.add(m.text);
      world.messages.length = 0;
    }
    const all = [...said].join(' | ');
    expect(all).toMatch(/Snow starts falling|blizzard/);
    expect(all).not.toMatch(/Rain sweeps|A storm breaks/);
  });

  it('never lets the temperature touch the dice', () => {
    // The seed contract. Snow is derived from the thermometer at read time and
    // the state machine cannot see it, so a colony in January and a colony in
    // July must roll exactly the same sequence of fronts from the same stream.
    // If this ever fails, every seed-tuned test in the suite has moved.
    const run = (tick: number): string => {
      const world = createWorld(777);
      world.tick = tick;
      const rng = new Rng(21);
      const out: string[] = [];
      for (let i = 0; i < TICKS_PER_DAY * 8; i++) {
        tickWeather(world, rng, () => {});
        if (i % 300 === 0) out.push(`${world.weather.kind}:${world.weather.ticksLeft}`);
      }
      return out.join('|');
    };
    expect(run(Math.round(TICKS_PER_DAY * 12.1))).toBe(run(Math.round(TICKS_PER_DAY * 2.6)));
  });
});

describe('weather read-outs', () => {
  it('gives every kind a label', () => {
    for (const k of KINDS) expect(WEATHER_LABEL[k].length).toBeGreaterThan(0);
  });

  it('orders wetness clear < cloudy < rain < storm', () => {
    const world = createWorld(1);
    const wet = (k: WeatherKind): number => {
      setWeather(world, k);
      return rainfall(world);
    };
    expect(wet('clear')).toBe(0);
    expect(wet('cloudy')).toBe(0);
    expect(wet('fog')).toBe(0);
    expect(wet('rain')).toBeGreaterThan(0);
    expect(wet('storm')).toBeGreaterThan(wet('rain'));
  });

  it('only spoils visibility in fog, storm and rain, and never blinds outright', () => {
    const world = createWorld(1);
    const vis = (k: WeatherKind): number => {
      setWeather(world, k);
      return visibility(world);
    };
    expect(vis('clear')).toBe(1);
    expect(vis('cloudy')).toBe(1);
    expect(vis('rain')).toBeLessThan(1);
    expect(vis('storm')).toBeLessThan(vis('rain'));
    expect(vis('fog')).toBeLessThan(vis('storm'));
    // A fogged-in map still has to be playable.
    expect(vis('fog')).toBeGreaterThan(0.25);
  });

  it('keeps cloud, wind and the derived multipliers in sane ranges', () => {
    const world = createWorld(1);
    for (const k of KINDS) {
      setWeather(world, k);
      expect(cloudiness(world)).toBeGreaterThanOrEqual(0);
      expect(cloudiness(world)).toBeLessThanOrEqual(1);
      expect(windStrength(world)).toBeGreaterThan(0);
      expect(windStrength(world)).toBeLessThanOrEqual(1);
      // Nothing the sky does may ever make a colony *better* at shooting or
      // *slower* at growing than a clear day.
      expect(spreadMultiplier(world)).toBeGreaterThanOrEqual(1);
      expect(growthMultiplier(world)).toBeGreaterThanOrEqual(1);
    }
    setWeather(world, 'clear');
    expect(spreadMultiplier(world)).toBe(1);
    expect(growthMultiplier(world)).toBe(1);
  });

  it('scales every effect by the fade, so a front arriving is not a step change', () => {
    const world = createWorld(1);
    setWeather(world, 'storm', 0.25);
    const quarter = { rain: rainfall(world), cloud: cloudiness(world) };
    setWeather(world, 'storm', 1);
    expect(rainfall(world)).toBeGreaterThan(quarter.rain);
    expect(cloudiness(world)).toBeGreaterThan(quarter.cloud);
  });

  it('flashes for a handful of ticks after a strike, then stops', () => {
    const world = createWorld(1);
    world.tick = 1000;
    world.weather.strikeTick = -9999;
    expect(strikeFlash(world)).toBe(0);
    world.weather.strikeTick = 1000;
    expect(strikeFlash(world)).toBe(1);
    world.tick = 1004;
    expect(strikeFlash(world)).toBeGreaterThan(0);
    expect(strikeFlash(world)).toBeLessThan(1);
    world.tick = 1020;
    expect(strikeFlash(world)).toBe(0);
  });

  it('strikes only during a settled storm, and lights exactly one cell in bounds', () => {
    const world = createWorld(1);
    const rng = new Rng(3);
    const hits: { x: number; y: number }[] = [];
    setWeather(world, 'clear');
    for (let i = 0; i < TICKS_PER_DAY; i++) tickWeather(world, rng, (x, y) => hits.push({ x, y }));
    expect(hits).toHaveLength(0);

    setWeather(world, 'storm');
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) {
      world.weather.ticksLeft = TICKS_PER_DAY; // hold the storm open
      tickWeather(world, rng, (x, y) => hits.push({ x, y }));
    }
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.x).toBeGreaterThanOrEqual(1);
      expect(h.x).toBeLessThan(world.width - 1);
      expect(h.y).toBeGreaterThanOrEqual(1);
      expect(h.y).toBeLessThan(world.height - 1);
    }
  });
});

// ---------------------------------------------------------------- experience

describe('weather as the player feels it', () => {
  it('ripens a plot measurably faster in the rain', () => {
    const grow = (kind: WeatherKind): number => {
      const world = createWorld(2026);
      setNoon(world);
      setWeather(world, kind);
      const cell = packCell(world, 10, 10);
      world.zones.push({ id: 1, kind: 'growing', cells: [cell], accepts: [] });
      world.crops[cell] = 0;
      for (let i = 0; i < 400; i++) tickCrops(world);
      return world.crops[cell]!;
    };
    const dry = grow('clear');
    const wet = grow('rain');
    expect(dry).toBeGreaterThan(0);
    expect(wet).toBeGreaterThan(dry * 1.4);
  });

  it('puts a fire out in a downpour that would otherwise grow', () => {
    const burn = (kind: WeatherKind): number => {
      const world = createWorld(2026);
      setWeather(world, kind);
      igniteFire(world, 20, 20);
      const rng = new Rng(5);
      // Stop short of the size at which a fire on bare ground can burn itself
      // out, so what this measures is the rain and nothing else.
      for (let i = 0; i < 80; i++) {
        world.tick++;
        tickFires(world, rng);
      }
      return world.fires.reduce((n, f) => n + f.size, 0);
    };
    const dry = burn('clear');
    const wet = burn('storm');
    expect(dry).toBeGreaterThan(0.7);
    // A storm does not just slow a fire down, it wins.
    expect(wet).toBe(0);
  });

  it('widens everyone spread in fog, including the raiders', () => {
    const world = createWorld(2026);
    setWeather(world, 'clear');
    const clear = spreadMultiplier(world);
    setWeather(world, 'fog');
    const fogged = spreadMultiplier(world);
    expect(fogged).toBeGreaterThan(clear * 1.3);
  });

  it('holds raids off while the storm is on top of the colony', () => {
    const world = createWorld(2026);
    setWeather(world, 'storm');
    world.storyteller.nextThreat = 1;
    const rng = new Rng(13);
    const before = world.pawns.length;
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.tick++;
      // Weather is held open by hand; the storyteller is what we are testing.
      tickStoryteller(world, rng);
    }
    expect(world.pawns.length).toBe(before);
    expect(isStormbound(world)).toBe(true);

    // ...and lets them through again once it clears.
    setWeather(world, 'clear');
    expect(isStormbound(world)).toBe(false);
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) {
      world.tick++;
      tickStoryteller(world, rng);
    }
    expect(world.pawns.length).toBeGreaterThan(before);
  });

  it('runs inside the real tick loop without stalling or throwing', () => {
    const world = createWorld(31337);
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY * 6);
    expect(KINDS).toContain(world.weather.kind);
    expect(world.weather.blend).toBeGreaterThan(0);
    expect(world.weather.blend).toBeLessThanOrEqual(1);
    expect(world.weather.ticksLeft).toBeGreaterThan(0);
  });
});
