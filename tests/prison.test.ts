/**
 * Prisoners.
 *
 * The feature exists to turn a raid you survived into a colonist, and every way
 * it can go wrong is a way it turns into something worse than nothing. The
 * headline risk is the faction flip: a `prisoner` who is still treated as an
 * enemy somewhere in the sim means turrets shooting into your own bunkhouse, a
 * raid that never reports itself as over, and a colony that quietly stops
 * farming and taking in wanderers because it believes it is under attack. So the
 * functional half here is mostly about what a prisoner must *not* be — not a
 * hostile, not an AI, not somebody the game will shoot at.
 *
 * The other risk is the carry. A captive is a whole pawn being moved by another
 * pawn, and a job that dies mid-walk (the bunk burns, the captive dies, the
 * warden gets drafted) must put the body down rather than leave it welded to a
 * carrier who has moved on.
 *
 * The experience half drives the real twenty-hertz loop end to end: a raid comes
 * in, somebody goes down, nobody is told to do anything, and a settler who was
 * shooting at them ten minutes ago walks them to a bunk, feeds them, talks them
 * round, and the colony is one person bigger than it was.
 */

import { describe, expect, it } from 'vitest';

import { isHostileTo } from '../src/sim/combat';
import { cancelJob, addBuilding, addItem, hostiles, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld } from '../src/sim/tick';
import {
  FEED_PRISONER_BELOW,
  RESISTANCE_MAX,
  TALK_GAP,
  RESISTANCE_MIN,
  capturable,
  freeBunk,
  imprison,
  persuade,
  prisoners,
  recruit,
  tickPrisoners,
} from '../src/sim/prison';
import { makePawn } from '../src/sim/pawn';
import { Rng } from '../src/sim/rng';
import { nearestWalkable } from '../src/sim/grid';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { Building, Pawn, World } from '../src/sim/types';

function colony(seed = 20260729): World {
  return createWorld(seed);
}

/** A built bunk on open ground near the middle of the map. */
function bunk(world: World, x = 30, y = 30): Building {
  const spot = nearestWalkable(world, x, y)!;
  const b = addBuilding(world, 'prisonbed', spot.x, spot.y, true);
  expect(b).not.toBeNull();
  return b!;
}

/** A raider lying face-down where a warden can reach them. */
function downedRaider(world: World, x = 32, y = 30): Pawn {
  const spot = nearestWalkable(world, x, y)!;
  const p = makePawn(world, new Rng(7), 'raider', spot.x, spot.y, { weapon: 'club' });
  p.downed = true;
  p.activity = 'downed';
  p.hp = 12;
  return p;
}

// ---------------------------------------------------------------------------
// Functional
// ---------------------------------------------------------------------------

describe('a captive becomes a prisoner', () => {
  it('changes faction, takes a bunk and gets a finite amount of fight left', () => {
    const world = colony();
    const cell = bunk(world);
    const raider = downedRaider(world);

    imprison(world, raider, cell);

    expect(raider.faction).toBe('prisoner');
    expect(raider.bunkId).toBe(cell.id);
    expect(raider.x).toBe(cell.x);
    expect(raider.y).toBe(cell.y);
    // A prisoner who talks forever is a prisoner the player learns to ignore.
    expect(raider.resistance).toBeGreaterThanOrEqual(RESISTANCE_MIN);
    expect(raider.resistance).toBeLessThanOrEqual(RESISTANCE_MAX);
    expect(world.stats.captured).toBe(1);
  });

  it('takes their weapon, so capturing and killing are different choices', () => {
    const world = colony();
    const raider = downedRaider(world);
    raider.weapon = 'rifle';
    imprison(world, raider, bunk(world));
    expect(raider.weapon).toBe('none');
  });

  it('is hostile to nobody and appears in no hostile scan', () => {
    const world = colony();
    const raider = downedRaider(world);
    imprison(world, raider, bunk(world));
    raider.downed = false; // back on their feet: the dangerous case

    // The whole argument for a faction rather than a flag. Every one of these is
    // a separate call site that would otherwise have needed auditing.
    expect(isHostileTo('colony', 'prisoner')).toBe(false);
    expect(isHostileTo('prisoner', 'colony')).toBe(false);
    expect(isHostileTo('raider', 'prisoner')).toBe(false);
    expect(hostiles(world).some((p) => p.id === raider.id)).toBe(false);
  });

  it('never runs raider AI, even standing and healthy inside the colony', () => {
    const world = colony();
    const raider = downedRaider(world);
    imprison(world, raider, bunk(world));
    raider.downed = false;
    raider.hp = raider.maxHp;
    raider.needs.food = 1;

    const streams = makeStreams(world);
    const before = livingColonists(world).length;
    for (let i = 0; i < 400; i++) stepWorld(world, streams);

    // Pinned to the bunk, no target, and nobody hurt.
    expect(raider.targetPawnId).toBeNull();
    expect(Math.round(raider.x)).toBe(world.buildings.find((b) => b.id === raider.bunkId)!.x);
    expect(livingColonists(world).length).toBe(before);
  });
});

describe('bunks are the cap on how many you can hold', () => {
  it('reports no free bunk once every one is occupied', () => {
    const world = colony();
    const a = bunk(world, 30, 30);
    expect(freeBunk(world)?.id).toBe(a.id);
    imprison(world, downedRaider(world, 32, 30), a);
    expect(freeBunk(world)).toBeNull();

    const b = bunk(world, 30, 33);
    expect(freeBunk(world)?.id).toBe(b.id);
  });

  it('does not count a blueprint that has not been built yet', () => {
    const world = colony();
    const spot = nearestWalkable(world, 30, 30)!;
    addBuilding(world, 'prisonbed', spot.x, spot.y, false);
    expect(freeBunk(world)).toBeNull();
  });

  it('only offers raiders who are down and not already spoken for', () => {
    const world = colony();
    const standing = makePawn(world, new Rng(3), 'raider', 20, 20, { weapon: 'club' });
    const down = downedRaider(world, 32, 30);
    expect(capturable(world).map((p) => p.id)).toEqual([down.id]);

    world.jobs.push({
      id: 9999,
      kind: 'capture',
      pawnId: livingColonists(world)[0]!.id,
      stage: 'goto',
      tx: down.x,
      ty: down.y,
      targetPawnId: down.id,
      progress: 0,
      age: 0,
    });
    expect(capturable(world)).toHaveLength(0);
    expect(standing.downed).toBe(false);
  });
});

describe('persuasion', () => {
  it('counts down and converts on the last talk', () => {
    const world = colony();
    const raider = downedRaider(world);
    imprison(world, raider, bunk(world));
    raider.resistance = 2;
    const warden = livingColonists(world)[0]!;
    warden.mood = 0.5; // one point a sitting
    // Whoever this settler happens to be, they are not kindhearted for the
    // length of this test: the rule under examination is the mood one.
    warden.traits = [];

    expect(persuade(world, warden, raider)).toBe(false);
    expect(raider.resistance).toBe(1);
    expect(raider.faction).toBe('prisoner');

    expect(persuade(world, warden, raider)).toBe(true);
    expect(raider.faction).toBe('colony');
    expect(world.stats.recruited).toBe(1);
  });

  it('goes twice as fast when the warden is in good spirits', () => {
    const world = colony();
    const raider = downedRaider(world);
    imprison(world, raider, bunk(world));
    raider.resistance = 6;
    const warden = livingColonists(world)[0]!;
    warden.mood = 0.9;
    warden.traits = []; // the good spirits are doing this, not a trait
    persuade(world, warden, raider);
    expect(raider.resistance).toBe(4);
  });

  it('makes the warden wait between sittings', () => {
    // The pacing is the balance. Without the gap a warden talks continuously and
    // a raider joins up inside an afternoon, which makes capturing strictly
    // better than fighting — the eval colony went from four settlers to eighteen
    // on captures alone before this existed.
    const world = colony();
    const raider = downedRaider(world);
    imprison(world, raider, bunk(world));
    raider.resistance = 4;
    const warden = livingColonists(world)[0]!;

    persuade(world, warden, raider);
    expect(raider.talkCooldown).toBe(world.tick + TALK_GAP);
    // Half a day at minimum: three sittings is the fastest any prisoner breaks,
    // and three sittings must still add up to more than an afternoon.
    expect(TALK_GAP).toBeGreaterThan(TICKS_PER_DAY / 2);
  });

  it('takes days rather than an afternoon, end to end', () => {
    const world = colony();
    const streams = makeStreams(world);
    const cell = bunk(world, 30, 30);
    addItem(world, 'meal', 60, cell.x + 2, cell.y + 2);
    const raider = downedRaider(world, cell.x + 3, cell.y);
    imprison(world, raider, cell);
    raider.resistance = 6;
    raider.hp = raider.maxHp;
    raider.downed = false;
    const start = world.tick;

    for (let i = 0; i < 30_000 && raider.faction === 'prisoner'; i++) stepWorld(world, streams);

    expect(raider.faction).toBe('colony');
    const days = (world.tick - start) / TICKS_PER_DAY;
    // Six resistance is three sittings for a cheerful warden and six for a flat
    // one, so the honest window is wide — what matters is that it is days.
    expect(days).toBeGreaterThan(1.2);
    expect(days).toBeLessThan(6);
  });

  it('hands the bunk back when they join up', () => {
    const world = colony();
    const cell = bunk(world);
    const raider = downedRaider(world);
    imprison(world, raider, cell);
    expect(freeBunk(world)).toBeNull();

    recruit(world, raider);

    expect(raider.faction).toBe('colony');
    expect(raider.bunkId).toBeUndefined();
    expect(freeBunk(world)?.id).toBe(cell.id);
    expect(livingColonists(world).some((p) => p.id === raider.id)).toBe(true);
  });
});

describe('a prisoner is a mouth to feed', () => {
  it('gets hungry, and starves to death if nobody brings a meal', () => {
    const world = colony();
    const raider = downedRaider(world);
    imprison(world, raider, bunk(world));
    raider.needs.food = 0.02;
    raider.hp = 20;

    let died = false;
    for (let i = 0; i < 4800 && !died; i++) {
      world.tick++;
      tickPrisoners(world);
      died = raider.dead;
    }
    expect(died).toBe(true);
    // And the player was told, rather than finding an empty bunk later.
    expect(world.messages.some((m) => m.text.includes('starved'))).toBe(true);
  });

  it('heals in the bunk while they are being fed', () => {
    const world = colony();
    const raider = downedRaider(world);
    imprison(world, raider, bunk(world));
    raider.hp = 20;

    for (let i = 0; i < 600; i++) {
      world.tick++;
      raider.needs.food = 1; // as if a warden kept up with the meals
      tickPrisoners(world);
    }
    expect(raider.hp).toBeGreaterThan(20);
    expect(raider.dead).toBe(false);
  });

  it('stays at the bunk and stays a prisoner even if the bunk is destroyed', () => {
    const world = colony();
    const cell = bunk(world);
    const raider = downedRaider(world);
    imprison(world, raider, cell);
    world.buildings = world.buildings.filter((b) => b.id !== cell.id);

    world.tick++;
    tickPrisoners(world);
    expect(raider.faction).toBe('prisoner');
    expect(raider.bunkId).toBeUndefined();
  });
});

describe('a cancelled capture puts the body down', () => {
  it('releases the captive where the carrier stood', () => {
    const world = colony();
    const warden = livingColonists(world)[0]!;
    const captive = downedRaider(world, 40, 40);
    warden.x = 12;
    warden.y = 14;
    warden.carryingPawnId = captive.id;
    const job = {
      id: 5000,
      kind: 'capture' as const,
      pawnId: warden.id,
      stage: 'carry' as const,
      tx: 0,
      ty: 0,
      targetPawnId: captive.id,
      progress: 0,
      age: 0,
    };
    world.jobs.push(job);
    warden.jobId = job.id;

    cancelJob(world, job.id);

    expect(warden.carryingPawnId).toBeNull();
    expect(captive.x).toBe(12);
    expect(captive.y).toBe(14);
    // Still a downed raider, so the next warden free picks the job back up.
    expect(captive.faction).toBe('raider');
    expect(capturable(world).map((p) => p.id)).toContain(captive.id);
  });
});

// ---------------------------------------------------------------------------
// Experience — the real loop, nobody told to do anything
// ---------------------------------------------------------------------------

describe('a raid becomes a colonist', () => {
  it('captures, feeds and recruits on its own, and the colony grows', () => {
    const world = colony();
    const streams = makeStreams(world);
    const started = livingColonists(world).length;

    // A bunk waiting, food in the pantry, and a raider on the ground outside.
    const cell = bunk(world, 30, 30);
    addItem(world, 'meal', 40, cell.x + 2, cell.y + 2);
    const raider = downedRaider(world, cell.x + 4, cell.y);
    // Hungry enough that a meal run has to happen before any talking can.
    raider.needs.food = FEED_PRISONER_BELOW - 0.1;

    let captured = false;
    let fed = false;
    // Seven days, not the two and a half this used to run for. Resistance is
    // rolled from the captive's own id, so which end of the 5..10 range this
    // particular raider lands on is not something the test controls — and the
    // stubborn end of that range facing a warden having an ordinary week is ten
    // sittings, which prison.ts documents as about six days. The old budget
    // covered the lucky roll and nothing else, and duly went red the day an
    // unrelated change to worldgen shifted every id along by ten. The budget now
    // brackets the ceiling the design actually claims.
    for (let i = 0; i < 34_000; i++) {
      stepWorld(world, streams);
      if (!captured && raider.faction === 'prisoner') captured = true;
      if (captured && raider.needs.food > FEED_PRISONER_BELOW) fed = true;
      if (raider.faction === 'colony') break;
    }

    expect(captured).toBe(true);
    expect(fed).toBe(true);
    expect(raider.faction).toBe('colony');
    expect(raider.dead).toBe(false);
    // Greater-or-equal, not exactly one more: two and a half days is long enough
    // for the storyteller to have walked a wanderer in as well, and pinning the
    // count exactly would make this test fail for something it is not about.
    expect(livingColonists(world).length).toBeGreaterThan(started);
    expect(livingColonists(world).some((p) => p.id === raider.id)).toBe(true);
    expect(world.stats.captured).toBeGreaterThanOrEqual(1);
    expect(world.stats.recruited).toBeGreaterThanOrEqual(1);
    // And they arrive able to work rather than as a body on the floor.
    expect(prisoners(world)).toHaveLength(0);
    expect(raider.weapon).toBe('none');
  });

  it('leaves the raiders alone while the fight is still going', () => {
    const world = colony();
    const streams = makeStreams(world);
    bunk(world, 30, 30);
    const down = downedRaider(world, 32, 30);
    // A live raider still on the map: the shooting has not stopped.
    const shooter = makePawn(world, new Rng(11), 'raider', 34, 30, { weapon: 'rifle' });
    shooter.hp = shooter.maxHp;

    for (let i = 0; i < 120; i++) {
      stepWorld(world, streams);
      if (shooter.dead || shooter.downed) break;
      expect(world.jobs.some((j) => j.kind === 'capture')).toBe(false);
      expect(down.faction).toBe('raider');
    }
  });
});
