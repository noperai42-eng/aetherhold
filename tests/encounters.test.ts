/**
 * The beats that are not a raid.
 *
 * Each of the three has a way of going wrong that is quiet rather than loud, and
 * that is what most of this file is about. A refugee can arrive somewhere they
 * cannot walk home from and starve within sight of the larder. An encounter that
 * spawns hostiles can leave `raidActive` set after the last of them falls, which
 * stops every wanderer arriving for the rest of the game and looks like nothing
 * at all. A flare can drain the batteries it was only supposed to silence, so the
 * colony wakes up to a second disaster it never saw happen. None of those print a
 * message. All three are asserted below.
 */

import { describe, expect, it } from 'vitest';

import { alerts } from '../src/sim/alerts';
import {
  startHerdMigration,
  startRefugeeFlight,
  startSolarFlare,
  tickEncounters,
} from '../src/sim/encounters';
import { tickStoryteller } from '../src/sim/events';
import { dist } from '../src/sim/grid';
import { isElectrical, tickPower } from '../src/sim/power';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TICKS_PER_DAY, flareActive, type Pawn, type World } from '../src/sim/types';
import { settleAnimal, tickWildlife } from '../src/sim/wildlife';
import { addBuilding, hostiles, livingColonists } from '../src/sim/world';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';

/**
 * A colony with the storyteller told to stay away.
 *
 * Every test here fires exactly one beat on purpose and then watches it. A raid
 * landing in the middle because the clock happened to come due would not make any
 * of these fail honestly — it would make them fail about something else.
 */
function game(seed = 4242): { world: World; streams: ReturnType<typeof makeStreams> } {
  const world = createWorld(seed);
  const st = world.storyteller;
  st.nextThreat = TICKS_PER_DAY * 60;
  st.nextArrival = TICKS_PER_DAY * 60;
  st.nextScout = TICKS_PER_DAY * 60;
  st.nextOutbreak = TICKS_PER_DAY * 60;
  return { world, streams: makeStreams(world) };
}

/** A panel, a bank and a lamp in a row — one network, one thing to switch off. */
function grid(world: World): { lamp: number } {
  const y = HOME_Y + 6;
  addBuilding(world, 'solar', HOME_X + 4, y, true);
  addBuilding(world, 'battery', HOME_X + 5, y, true);
  const lamp = addBuilding(world, 'lamp', HOME_X + 6, y, true);
  if (!lamp) throw new Error('nowhere to stand the test grid');
  return { lamp: lamp.id };
}

function buildingById(world: World, id: number) {
  const b = world.buildings.find((q) => q.id === id);
  if (!b) throw new Error(`building ${id} is gone`);
  return b;
}

function said(world: World, fragment: string): boolean {
  return world.messages.some((m) => m.text.includes(fragment));
}

describe('the solar flare', () => {
  it('declines at a colony with nothing electrical to knock out', () => {
    const { world } = game(7);
    // A colony starts with a generator and two lamps, so this is the shape of a
    // settlement that has *lost* its grid — burned out, or stripped for parts.
    world.buildings = world.buildings.filter((b) => !isElectrical(b.kind));
    // Nothing to lose is not a threat, it is a paragraph. The storyteller sends
    // a fire instead, which is why this returns a verdict rather than just
    // quietly doing nothing.
    expect(startSolarFlare(world, new Rng(1))).toBe(false);
    expect(flareActive(world)).toBe(false);
  });

  it('lasts the best part of a day and then gives the grid back', () => {
    const { world, streams } = game(8);
    const { lamp } = grid(world);
    expect(startSolarFlare(world, new Rng(2))).toBe(true);

    const left = world.storyteller.flareUntil! - world.tick;
    // Long enough to be a night, short enough to be survivable.
    expect(left).toBeGreaterThanOrEqual(Math.round(TICKS_PER_DAY * 0.8));
    expect(left).toBeLessThanOrEqual(Math.round(TICKS_PER_DAY * 1.4));

    // Shortened so the arc runs in a second. The length itself is asserted
    // above; what is being watched here is the grid going down and coming back.
    world.storyteller.flareUntil = world.tick + 60;
    stepWorldN(world, streams, 20);
    expect(flareActive(world)).toBe(true);
    expect(buildingById(world, lamp).powered).toBe(false);
    expect(world.power!.supply).toBe(0);

    stepWorldN(world, streams, 60);
    expect(flareActive(world)).toBe(false);
    expect(said(world, 'aurora fades')).toBe(true);
    expect(buildingById(world, lamp).powered).toBe(true);
  });

  it('silences the banks without draining them', () => {
    const { world } = game(9);
    grid(world);
    const bank = world.buildings.find((b) => b.kind === 'battery')!;
    bank.charge = 9000;

    startSolarFlare(world, new Rng(3));
    for (let i = 0; i < 40; i++) tickPower(world);

    // The whole point of the merciful reading: a colony that banked power against
    // a bad night still has it when the sky clears. If this ever starts draining,
    // a flare becomes two disasters — the day it took, and the buffer it ate on
    // the way out, which the player never sees happen.
    expect(bank.charge).toBe(9000);
    expect(bank.powered).toBe(false);
  });

  it('a panel reports nothing while it is making nothing', () => {
    const { world } = game(10);
    grid(world);
    startSolarFlare(world, new Rng(4));
    tickPower(world);
    // The inspector reads `solarOutput` directly. A dead panel that still claims
    // two hundred watts is worse than no reading at all: it tells the player the
    // cooler thawing is somebody else's fault.
    const panel = world.buildings.find((b) => b.kind === 'solar')!;
    expect(panel.powered).toBe(false);
    expect(world.power!.supply).toBe(0);
  });

  it('says why the grid is dead, instead of how to fix a shortage', () => {
    const { world } = game(101);
    grid(world);
    startSolarFlare(world, new Rng(31));
    tickPower(world);

    const list = alerts(world);
    const flare = list.find((a) => a.id === 'flare');
    expect(flare).toBeDefined();
    expect(flare!.text).toMatch(/more hours?$/);
    // And not both. "Fuel or build a generator" is advice that burns the wood the
    // colony needs on the other side of the flare, into a wire that is not
    // carrying — the two alerts look the same on the meter and want opposite
    // things, so the flare has to take the row rather than sit above it.
    expect(list.some((a) => a.id === 'power')).toBe(false);
  });

  it('an old save loads with a quiet sky', () => {
    const { world } = game(11);
    // Exactly what a colony written before flares existed looks like.
    delete world.storyteller.flareUntil;
    expect(flareActive(world)).toBe(false);
    tickEncounters(world);
    expect(said(world, 'aurora fades')).toBe(false);
  });
});

describe('the refugee', () => {
  function refugeeOf(world: World, before: number[]): Pawn {
    const fresh = world.pawns.filter((p) => p.faction === 'colony' && !before.includes(p.id));
    expect(fresh).toHaveLength(1);
    return fresh[0]!;
  }

  it('arrives hurt, a long way out, with slavers on their heels', () => {
    const { world } = game(12);
    const before = world.pawns.map((p) => p.id);
    expect(startRefugeeFlight(world, new Rng(5))).toBe(true);

    const runner = refugeeOf(world, before);
    // Hurt, because they have been running. A refugee who turns up at full
    // strength is a free settler with scenery attached.
    expect(runner.hp).toBeLessThan(runner.maxHp);
    expect(runner.hp).toBeGreaterThan(0);
    expect(runner.downed).toBe(false);

    // Far enough out that going to meet them is a decision and not a formality.
    expect(dist(runner.x, runner.y, HOME_X, HOME_Y)).toBeGreaterThan(20);

    const chasers = world.pawns.filter((p) => p.faction === 'raider' && !p.dead);
    expect(chasers.length).toBeGreaterThan(0);
    for (const thug of chasers) {
      // Behind the runner, not on top of them, and armed with what a rescue can
      // beat — the band is deliberately off the raid escalation curve.
      expect(dist(thug.x, thug.y, runner.x, runner.y)).toBeGreaterThan(1);
      expect(dist(thug.x, thug.y, runner.x, runner.y)).toBeLessThan(14);
      expect(thug.weapon).toBe('club');
    }
    expect(world.storyteller.raidActive).toBe(true);
    expect(said(world, 'running for the colony')).toBe(true);
  });

  it('declines when there is no colony left to run to', () => {
    const { world } = game(13);
    for (const p of world.pawns) if (p.faction === 'colony') p.dead = true;
    expect(startRefugeeFlight(world, new Rng(6))).toBe(false);
    expect(world.pawns.some((p) => p.faction === 'raider')).toBe(false);
  });

  it('the runner can actually get home', () => {
    const { world, streams } = game(14);
    const before = world.pawns.map((p) => p.id);
    expect(startRefugeeFlight(world, new Rng(7))).toBe(true);
    const runner = refugeeOf(world, before);
    // The chase is not what is on trial here. Seed 99001 once walked a wanderer
    // into a rock pocket where every job in the colony was unreachable; she stood
    // still with no job at all and starved two days later while the colony sat on
    // three weeks of food. A refugee spawns further out than any wanderer, so it
    // is the same bug with more map to hide in.
    for (const p of world.pawns) if (p.faction === 'raider') p.dead = true;
    const started = dist(runner.x, runner.y, HOME_X, HOME_Y);

    stepWorldN(world, streams, 900);
    expect(runner.dead).toBe(false);
    expect(dist(runner.x, runner.y, HOME_X, HOME_Y)).toBeLessThan(started - 8);
  });

  it('closes cleanly when the slavers are put down', () => {
    const { world, streams } = game(15);
    expect(startRefugeeFlight(world, new Rng(8))).toBe(true);
    expect(world.storyteller.raidActive).toBe(true);

    for (const p of world.pawns) if (p.faction === 'raider') p.dead = true;
    stepWorldN(world, streams, 40);

    // An encounter that spawns hostiles and forgets to notice they are gone
    // leaves `raidActive` set forever, which silently stops every wanderer from
    // arriving for the rest of the run and reads on screen as nothing whatsoever.
    expect(hostiles(world)).toHaveLength(0);
    expect(world.storyteller.raidActive).toBe(false);
    expect(said(world, 'clearing is quiet')).toBe(true);
  });
});

describe('the herd', () => {
  it('arrives as a herd, headed somewhere off the map', () => {
    const { world } = game(16);
    expect(startHerdMigration(world, new Rng(9))).toBe(true);

    const herd = world.pawns.filter((p) => p.migrateTo !== undefined);
    expect(herd.length).toBeGreaterThanOrEqual(5);
    for (const beast of herd) {
      expect(beast.faction).toBe('fauna');
      expect(beast.animal).toBe('mossback');
      const to = beast.migrateTo!;
      // Out at the rim — the far side of the map, not a nearby field. Not the
      // border cell exactly: the clamped corner is often rock, so the exit is
      // snapped to the nearest cell an animal can actually stand on.
      const toEdge = Math.min(to.x, to.y, world.width - 1 - to.x, world.height - 1 - to.y);
      expect(toEdge).toBeLessThanOrEqual(15);
      // And a genuine crossing rather than a stroll: in one side, out the other.
      expect(dist(beast.x, beast.y, to.x, to.y)).toBeGreaterThan(world.width / 2);
      expect(to.until).toBeGreaterThan(world.tick);
    }
    expect(said(world, 'crossing the valley')).toBe(true);
  });

  it('crosses the valley and then it is gone', () => {
    const { world } = game(17);
    expect(startHerdMigration(world, new Rng(10))).toBe(true);
    const herd = world.pawns.filter((p) => p.migrateTo !== undefined);
    const exit = herd[0]!.migrateTo!;
    const started = herd.map((p) => dist(p.x, p.y, exit.x, exit.y));
    const toGo = (): number[] =>
      herd.map((p) => (world.pawns.includes(p) ? dist(p.x, p.y, exit.x, exit.y) : 0));
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

    // Wildlife only. The rest of the sim is not what makes a herd walk, and a
    // thousand full ticks of a ninety-six-cell map to prove it would be a slow
    // way to assert one branch.
    const rng = new Rng(11);
    for (let i = 0; i < 400; i++) {
      world.tick++;
      tickWildlife(world, rng);
    }
    // The herd, not each animal: the line runs past the cabin on purpose, and
    // fleeing outranks travelling on purpose too, so one that gets spooked by a
    // settler standing in the way can lose ground for a couple of hundred ticks.
    // What must not happen is the group grazing in a circle with a label on it.
    expect(mean(toGo())).toBeLessThan(mean(started) - 15);

    for (let i = 0; i < 13000 && world.pawns.some((p) => p.migrateTo !== undefined); i++) {
      world.tick++;
      tickWildlife(world, rng);
    }
    // Either they walked off the map or they gave up and live here now. Nothing
    // is still trying: a herd that never resolves is a pawn pushing at a rock
    // for the rest of the game.
    expect(world.pawns.some((p) => p.migrateTo !== undefined)).toBe(false);
    const left = herd.filter((p) => !world.pawns.includes(p)).length;
    expect(left).toBeGreaterThan(herd.length / 2);
    expect(said(world, 'passes out of the valley')).toBe(true);
  });

  it('can stage a crossing on almost any map', () => {
    // The route has to be walkable end to end or the beat declines, and a beat
    // that declines on most maps is a feature that exists in the changelog only.
    // Six maps, because worldgen lays the rock differently every seed.
    let staged = 0;
    for (const seed of [101, 202, 303, 404, 505, 606]) {
      const world = createWorld(seed);
      if (startHerdMigration(world, new Rng(seed))) staged++;
    }
    expect(staged).toBeGreaterThanOrEqual(5);
  });

  it('one coaxed out of the herd stays behind', () => {
    const { world } = game(18);
    startHerdMigration(world, new Rng(12));
    const beast = world.pawns.find((p) => p.migrateTo !== undefined)!;
    settleAnimal(world, beast);

    // A handler spends the better part of a day standing with an animal to tame
    // it. One that walked off the map that evening because it still had somewhere
    // to be would make that day a waste and the feature a joke.
    expect(beast.migrateTo).toBeUndefined();
    const rng = new Rng(13);
    for (let i = 0; i < 300; i++) {
      world.tick++;
      tickWildlife(world, rng);
    }
    expect(world.pawns).toContain(beast);
  });

  it('a stuck animal settles here instead of shoving at a wall forever', () => {
    const { world } = game(19);
    startHerdMigration(world, new Rng(14));
    const beast = world.pawns.find((p) => p.migrateTo !== undefined)!;
    beast.migrateTo = { ...beast.migrateTo!, until: world.tick + 5 };

    const rng = new Rng(15);
    for (let i = 0; i < 10; i++) {
      world.tick++;
      tickWildlife(world, rng);
    }
    // Not removed — it lives here now. The deadline exists so that an animal
    // wedged against a rock face on the way through stops being a migration
    // rather than becoming a pawn that pushes at stone for the rest of the game.
    expect(world.pawns).toContain(beast);
    expect(beast.migrateTo).toBeUndefined();
  });
});

describe('the storyteller', () => {
  it('every beat it fires lands as something', () => {
    const { world } = game(20);
    // Eligible for all six outcomes: something electrical for the flare, room in
    // the colony for a refugee.
    grid(world);
    const rng = new Rng(21);
    let fired = 0;

    const print = (): string =>
      [
        world.pawns.length,
        world.fires.length,
        world.storyteller.flareUntil ?? 0,
        world.pawns.filter((p) => p.migrateTo !== undefined).length,
      ].join('/');

    for (let beat = 0; beat < 80; beat++) {
      const st = world.storyteller;
      // Back to the same colony every time. Nothing here ticks combat or fire, so
      // without this the map silts up with corpses and burning cells until a raid
      // has nowhere to land and a fire relights a cell that is already alight —
      // which would read as the storyteller falling silent when it is only the
      // fixture running out of room.
      world.pawns = world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
      world.fires = [];
      st.flareUntil = undefined;
      st.raidActive = false;
      st.nextArrival = TICKS_PER_DAY * 60;
      st.nextThreat = 1;

      const wasFired = st.threatsFired;
      const was = print();
      world.tick++;
      tickStoryteller(world, rng);
      if (st.threatsFired === wasFired) continue; // postponed by a storm
      fired++;
      // Whatever the roll chose, and however it fell back, the world is different
      // afterwards. A beat that declines and does not hand off is a threat clock
      // that ticked over into silence — the storyteller's one unforgivable bug.
      expect(print()).not.toBe(was);
    }

    expect(fired).toBeGreaterThan(50);
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });
});
