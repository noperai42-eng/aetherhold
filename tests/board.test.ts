/**
 * The work board — what the colony has outstanding, and who is on it.
 *
 * Ranked by what a wrong answer costs the player. Worst is a frame the colony
 * cannot supply reading the same as one it can: `stranded` is the only row on
 * this panel that is a decision rather than a wait, and losing that distinction
 * turns the whole thing back into the silence it was written to break. Next is
 * the plot reading empty on a colony that is farming, because that is the exact
 * complaint — every part of the farm was running and nothing on screen said so.
 * Then the season term, which is the one factor that goes to zero, and a field
 * frozen for a week with no reason given is a bug report waiting to happen. Then
 * the ordering, since a board that shuffles its rows every tick cannot be read
 * at all.
 *
 * All of it is a readout over a world the sim already owns, so these tests build
 * the world and never touch the panel: what `hud.ts` does with these facts is
 * words, and words are not what breaks.
 */

import { describe, expect, it } from 'vitest';
import { buildQueue, plotStatus, shortfall } from '../src/client/ui/board';
import { addBuilding, addCellToZone, addItem, addZone, findPawn, livingColonists } from '../src/sim/world';
import { canPlace } from '../src/sim/orders';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { setSteward } from '../src/sim/steward';
import { TICKS_PER_DAY, type Building, type BuildingKind, type World } from '../src/sim/types';
import { createWorld } from '../src/sim/worldgen';

/** A colony with no help from the Steward, so nothing is planned but what a test plans. */
function quiet(seed = 7): World {
  const world = createWorld(seed);
  setSteward(world, false);
  return world;
}

/** Put a frame down on the first cell that will take one, and hand it back. */
function frame(world: World, kind: BuildingKind, fromY = 18): Building {
  for (let y = fromY; y < world.height - 2; y++) {
    for (let x = 4; x < world.width - 2; x++) {
      if (canPlace(world, kind, x, y) !== 'ok') continue;
      const b = addBuilding(world, kind, x, y, false);
      if (b) return b;
    }
  }
  throw new Error(`nowhere on this map to put a ${kind}`);
}

/** Take every stack of one resource off the map. */
function strip(world: World, kind: 'wood' | 'steel' | 'stone'): void {
  for (const it of world.items) if (it.kind === kind) it.amount = 0;
}

describe('the build queue', () => {
  it('says a frame is stranded when the colony has none of what it needs', () => {
    const world = quiet();
    // The player's only move on a stranded frame is to go and get some, which is
    // why the row has to read differently from one that is merely waiting a turn.
    strip(world, 'wood');
    const b = frame(world, 'wall');

    const stranded = buildQueue(world).find((r) => r.buildingId === b.id);
    expect(stranded?.standing).toBe('stranded');
    expect(stranded?.missing?.kind).toBe('wood');
    expect(stranded?.missing?.inStore).toBe(0);

    // The same frame with wood on the ground is a different sentence.
    addItem(world, 'wood', 50, b.x + 2, b.y);
    const short = buildQueue(world).find((r) => r.buildingId === b.id);
    expect(short?.standing).toBe('short');
    expect(short?.missing?.inStore).toBe(50);
  });

  it('leaves finished buildings off it', () => {
    const world = quiet();
    const before = buildQueue(world).length;
    const b = frame(world, 'wall');
    expect(buildQueue(world).length).toBe(before + 1);
    b.built = true;
    expect(buildQueue(world).map((r) => r.buildingId)).not.toContain(b.id);
  });

  it('groups by standing and keeps the order the player placed them in', () => {
    const world = quiet();
    strip(world, 'wood');
    for (let i = 0; i < 4; i++) frame(world, 'wall', 18 + i * 2);
    const rows = buildQueue(world);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    // Within one standing the ids only ever climb — the panel is read top to
    // bottom while the player is still placing, and rows that reshuffle under
    // the cursor cannot be read at all.
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]!;
      const b = rows[i]!;
      if (a.standing === b.standing) expect(b.buildingId).toBeGreaterThan(a.buildingId);
    }
  });

  it('names the settler who is on it, and nobody when nobody is', () => {
    const world = createWorld(7);
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY);
    for (const r of buildQueue(world)) {
      if (r.standing === 'working' || r.standing === 'fetching') {
        expect(livingColonists(world).some((p) => p.name === r.who)).toBe(true);
      } else {
        expect(r.who).toBeNull();
      }
    }
  });
});

describe('the plot', () => {
  it('reports the field a colony starts with, rather than nothing at all', () => {
    // The complaint that started this: a player saw no planting and no field.
    // Worldgen lays a growing zone on the first tick, so a null here would be
    // the panel agreeing with a report the measurement already disproved.
    const plot = plotStatus(quiet());
    expect(plot).not.toBeNull();
    expect(plot!.cells).toBeGreaterThan(0);
  });

  it('is null when there is no growing ground, which is a different problem', () => {
    const world = quiet();
    world.zones = world.zones.filter((z) => z.kind !== 'growing');
    world.cellZone.fill(-1);
    expect(plotStatus(world)).toBeNull();
  });

  it('counts what is sown and what is ripe, and a ripe cell is also a sown one', () => {
    const world = quiet();
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY * 4);
    const plot = plotStatus(world)!;
    expect(plot.sown).toBeGreaterThan(0);
    expect(plot.sown).toBeLessThanOrEqual(plot.cells);
    expect(plot.ripe).toBeLessThanOrEqual(plot.sown);
    // Four days in, with `RIPEN_DAYS` at three, something on the plot has got
    // somewhere. This is the assertion that fails if growth ever stops moving.
    expect(plot.best).toBeGreaterThan(0);
  });

  it('drops the growth rate to zero in the cold, and says so through the season', () => {
    // Not a bug — `farming.ts` stops growth below four degrees on purpose, and
    // this panel is what turns a week of nothing happening into a reason.
    // Measured with `scripts/probe-growth.ts`: the season term holds at 1.000
    // through day 7, falls to 0.066 on day 8 and sits at 0.000 from day 9, so
    // a fortnight is twice the room it needs and the run stays affordable.
    //
    // Deliberately not conditioned on anything being sown. Nobody plants in the
    // frost, so a plot that has been picked clean reads as `sown: 0` — and a
    // test that waited for a sown *and* frozen plot would wait out the winter
    // for a state the colony has no reason to be in.
    const world = quiet();
    const streams = makeStreams(world);
    let warmest = 0;
    let frozen = null as ReturnType<typeof plotStatus>;
    for (let day = 0; day < 14 && !frozen; day++) {
      stepWorldN(world, streams, TICKS_PER_DAY);
      const p = plotStatus(world)!;
      warmest = Math.max(warmest, p.season);
      if (p.season < 0.05) frozen = p;
    }
    // It fell, rather than having been zero all along — otherwise this passes on
    // a `seasonScale` that is simply broken, which is the opposite of the point.
    expect(warmest).toBeGreaterThan(0.5);
    expect(frozen).not.toBeNull();
    expect(frozen!.rate).toBeLessThan(0.05);
  });

  it('points at the middle of the ground, not at one end of it', () => {
    // The panel's "The field" heading takes the camera here, and the whole
    // reason it exists is a player who could not find the plot on the map. An
    // L of cells whose centre came out as its first cell would send them to a
    // corner and call the question answered.
    const world = quiet();
    world.zones = world.zones.filter((z) => z.kind !== 'growing');
    world.cellZone.fill(-1);
    const z = addZone(world, 'growing', []);
    for (let x = 20; x <= 30; x++) addCellToZone(world, z, x, 20);
    for (let y = 21; y <= 30; y++) addCellToZone(world, z, 20, y);
    const plot = plotStatus(world)!;
    expect(plot.x).toBeGreaterThan(20);
    expect(plot.y).toBeGreaterThan(20);
    expect(plot.x).toBeLessThan(30);
    expect(plot.y).toBeLessThan(30);
  });

  it('counts the hands on it', () => {
    const world = quiet();
    expect(plotStatus(world)!.hands).toBe(0);
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY * 2);
    const live = world.jobs.filter((j) => j.kind === 'sow' || j.kind === 'harvestCrop').length;
    expect(plotStatus(world)!.hands).toBe(live);
  });
});

describe('the shortfall', () => {
  it('adds the gap up across every frame rather than reporting it one at a time', () => {
    const world = quiet();
    strip(world, 'wood');
    const a = frame(world, 'wall', 18);
    const b = frame(world, 'wall', 22);
    const need = (a.needs.wood ?? 0) + (b.needs.wood ?? 0);
    expect(shortfall(world).find((n) => n.kind === 'wood')?.amount).toBe(need);
  });

  it('says nothing about a resource the colony can already cover', () => {
    const world = quiet();
    const b = frame(world, 'wall');
    addItem(world, 'wood', (b.needs.wood ?? 0) * 10, b.x + 2, b.y);
    expect(shortfall(world).some((n) => n.kind === 'wood')).toBe(false);
  });

  it('discounts what has already been carried to the frame', () => {
    const world = quiet();
    strip(world, 'wood');
    const b = frame(world, 'wall');
    const full = shortfall(world).find((n) => n.kind === 'wood')!.amount;
    b.have.wood = 1;
    expect(shortfall(world).find((n) => n.kind === 'wood')!.amount).toBe(full - 1);
  });
});

describe('the board as the player meets it', () => {
  it('a colony left alone for a week has a field, a queue and no lies in either', () => {
    // The experience half: no hand-placed props, no emptied stockpiles. Play a
    // colony the way it ships and read the panel off it.
    const world = createWorld(1312);
    const streams = makeStreams(world);
    stepWorldN(world, streams, TICKS_PER_DAY * 7);

    const plot = plotStatus(world);
    expect(plot).not.toBeNull();
    expect(plot!.sown).toBeGreaterThan(0);

    for (const row of buildQueue(world)) {
      // Every row names a real unbuilt building, and a reason that matches its
      // own facts — the row is what the player acts on, so a `stranded` that is
      // really a `short` sends them across the map for nothing.
      expect(world.buildings.some((b) => b.id === row.buildingId && !b.built)).toBe(true);
      if (row.standing === 'working' || row.standing === 'fetching') {
        const job = world.jobs.find((j) => j.buildingId === row.buildingId);
        expect(findPawn(world, job?.pawnId ?? null)?.name).toBe(row.who);
      } else {
        expect(row.who).toBeNull();
      }
      if (row.standing === 'stranded') expect(row.missing!.inStore).toBe(0);
      if (row.standing === 'short') expect(row.missing!.inStore).toBeGreaterThan(0);
      expect(row.progress).toBeGreaterThanOrEqual(0);
      expect(row.progress).toBeLessThanOrEqual(1);
    }
  });

  it('a field the player paints themselves shows up on the panel', () => {
    const world = quiet();
    const before = plotStatus(world)!.cells;
    const z = addZone(world, 'growing', []);
    for (let x = 40; x < 44; x++) addCellToZone(world, z, x, 40);
    expect(plotStatus(world)!.cells).toBeGreaterThan(before);
  });
});
