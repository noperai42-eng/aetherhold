/**
 * Scouting — the reason to leave the yard.
 *
 * Before this, a settler with nothing to do stood in the cabin doorway and the
 * other three thousand cells of the map were scenery raiders walked in across.
 * Everything the colony needed was within ten cells of the door, so the map had
 * no *outside*. These tests cover the three things that make an expedition worth
 * the walk: that the seed actually buries something out there, that a settler
 * only sets out when leaving is survivable, and that what they bring home lands
 * in systems the colony already knows how to work.
 */

import { describe, expect, it } from 'vitest';

import { stewardTick } from '../src/eval/steward';
import { isWalkable } from '../src/sim/grid';
import { assignJob } from '../src/sim/jobs';
import { findPath } from '../src/sim/path';
import { Rng } from '../src/sim/rng';
import {
  SCOUT_COOLDOWN,
  surveyTicks,
  findScoutSite,
  resolveSite,
  scoutOverdue,
  scoutingAllowed,
  tickScoutItch,
} from '../src/sim/scout';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import type { Pawn, Site, World } from '../src/sim/types';
import { DESIG_HARVEST, TICKS_PER_DAY, packCell, terrainAt } from '../src/sim/types';
import { itemsAt, livingColonists, msg } from '../src/sim/world';
import { CABIN, SITE_MIN_RANGE, createWorld, makePawn } from '../src/sim/worldgen';

const SEEDS = [20260729, 7, 1312, 99001, 424242, 555];

/** The cabin's middle — the point worldgen measures a site's range from. */
const HOME = { x: Math.round((CABIN.x0 + CABIN.x1) / 2), y: Math.round((CABIN.y0 + CABIN.y1) / 2) };

/** A world parked mid-morning on a quiet day, with one settler free to go. */
function ready(seed = 20260729): { world: World; pawn: Pawn } {
  const world = createWorld(seed);
  const pawn = livingColonists(world)[0]!;
  pawn.needs.food = 0.9;
  pawn.needs.rest = 0.9;
  return { world, pawn };
}

/**
 * The same world with the work board cleared to one column.
 *
 * A fresh colony always has meals to cook and a wall to finish, and scouting is
 * bottom of the board on purpose — so the only way to watch the *scouting*
 * decision is to take the rest of the day's work off the table.
 */
function onlyScouting(seed = 20260729): { world: World; pawn: Pawn } {
  const { world, pawn } = ready(seed);
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      p.priorities[w] = w === 'scout' ? 1 : 0;
    }
  }
  return { world, pawn };
}

function siteOf(world: World, kind: Site['kind']): Site {
  const s = world.sites.find((q) => q.kind === kind);
  if (!s) throw new Error(`no ${kind} on this map`);
  return s;
}

describe('what the seed buries out on the map', () => {
  it('puts finds on every map, out past the home ground', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      // Enough that the map has an outside worth several trips, not one errand.
      expect(world.sites.length).toBeGreaterThanOrEqual(6);
      for (const s of world.sites) {
        // Past the ground the colony already works. A "site" inside the yard is
        // just a resource drop with extra steps.
        expect(Math.hypot(s.x - HOME.x, s.y - HOME.y)).toBeGreaterThanOrEqual(SITE_MIN_RANGE);
        expect(s.found).toBe(false);
      }
    }
  });

  it('never buries a find somewhere nobody can walk to', () => {
    // The stranded-arrival bug in reverse: worldgen fences parts of the map off
    // in rock, and a cache inside one of those pockets is a job that can never
    // finish — the settler walks to the edge of the rock and stands there.
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      for (const s of world.sites) {
        expect(isWalkable(world, s.x, s.y)).toBe(true);
        const path = findPath(world, HOME.x, HOME.y, s.x, s.y, {
          maxExpansions: 20000,
        });
        expect(path, `seed ${seed} site ${s.id} (${s.x},${s.y}) is unreachable`).not.toBeNull();
      }
    }
  });

  it('spreads them out, so one walk does not stumble over three', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      for (const a of world.sites) {
        for (const b of world.sites) {
          if (a.id === b.id) continue;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(9);
        }
      }
    }
  });

  it('sits ore seams on ground that actually has ore in it', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      for (const s of world.sites.filter((q) => q.kind === 'lode')) {
        let rock = 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (terrainAt(world, s.x + dx, s.y + dy) === 'rock') rock++;
          }
        }
        expect(rock, `seed ${seed} lode at (${s.x},${s.y}) has no rock`).toBeGreaterThan(0);
      }
    }
  });

  it('says what is in a cache before anyone opens it, so the seed is the seed', () => {
    const a = createWorld(4242);
    const b = createWorld(4242);
    expect(a.sites).toEqual(b.sites);
    for (const s of a.sites.filter((q) => q.kind === 'cache')) {
      expect(s.resource).toBeDefined();
      expect(s.amount!).toBeGreaterThan(0);
    }
  });
});

describe('when a settler is willing to leave', () => {
  it('goes on a quiet morning with food in them', () => {
    const { world, pawn } = ready();
    expect(scoutingAllowed(world, pawn)).toBe(true);
  });

  it('will not walk out into the dark', () => {
    const { world, pawn } = ready();
    world.tick = Math.round(TICKS_PER_DAY * 0.95); // ~22:48
    expect(scoutingAllowed(world, pawn)).toBe(false);
  });

  it('will not leave with raiders on the map', () => {
    const { world, pawn } = ready();
    makePawn(world, new Rng(1), 'raider', 4, 4, { weapon: 'club' });
    expect(scoutingAllowed(world, pawn)).toBe(false);
  });

  it('will not leave with trouble due before they could get home', () => {
    const { world, pawn } = ready();
    world.storyteller.nextThreat = Math.round(TICKS_PER_DAY * 0.2);
    expect(scoutingAllowed(world, pawn)).toBe(false);
  });

  it('will not leave the colony to burn', () => {
    const { world, pawn } = ready();
    world.fires.push({ id: 9001, x: 10, y: 10, size: 0.4 });
    expect(scoutingAllowed(world, pawn)).toBe(false);
  });

  it('will not set out hungry or short of sleep', () => {
    // The round trip is minutes of walking. The ordinary hungry/tired thresholds
    // are for somebody standing next to the pantry; a scout has to still be on
    // their feet on the way back.
    const { world, pawn } = ready();
    pawn.needs.food = 0.5;
    expect(scoutingAllowed(world, pawn)).toBe(false);
    pawn.needs.food = 0.9;
    pawn.needs.rest = 0.4;
    expect(scoutingAllowed(world, pawn)).toBe(false);
  });

  it('sends one party, not the whole colony', () => {
    const { world } = ready();
    const settlers = livingColonists(world);
    for (const p of settlers) {
      p.needs.food = 0.9;
      p.needs.rest = 0.9;
    }
    world.jobs.push({
      id: 12345,
      kind: 'scout',
      pawnId: settlers[0]!.id,
      stage: 'goto',
      tx: world.sites[0]!.x,
      ty: world.sites[0]!.y,
      progress: 0,
      age: 0,
    });
    expect(scoutingAllowed(world, settlers[1]!)).toBe(false);
  });

  it('waits out the quiet between expeditions', () => {
    const { world, pawn } = ready();
    world.storyteller.nextScout = 400;
    expect(scoutingAllowed(world, pawn)).toBe(false);
  });
});

describe('picking somewhere to go', () => {
  it('heads for the nearest place nobody has looked at yet', () => {
    const { world, pawn } = ready();
    const nearest = [...world.sites].sort(
      (a, b) => Math.hypot(a.x - pawn.x, a.y - pawn.y) - Math.hypot(b.x - pawn.x, b.y - pawn.y),
    )[0]!;
    expect(findScoutSite(world, pawn)?.id).toBe(nearest.id);
  });

  it('does not walk back to somewhere already surveyed', () => {
    const { world, pawn } = ready();
    const first = findScoutSite(world, pawn)!;
    first.found = true;
    expect(findScoutSite(world, pawn)?.id).not.toBe(first.id);
  });

  it('gives up rather than pretending, when the map is picked clean', () => {
    const { world, pawn } = ready();
    for (const s of world.sites) s.found = true;
    expect(findScoutSite(world, pawn)).toBeNull();
    expect(scoutingAllowed(world, pawn)).toBe(true); // willing — just nowhere to go
  });
});

describe('what comes of getting there', () => {
  it('leaves a cache on the ground for the haulers, not in the bank', () => {
    const { world, pawn } = ready();
    const site = siteOf(world, 'cache');
    resolveSite(world, pawn, site);

    const stack = itemsAt(world, site.x, site.y).find((s) => s.kind === site.resource);
    expect(stack, 'the cache should be a real stack somebody has to carry home').toBeDefined();
    expect(stack!.amount).toBe(site.amount);
    expect(site.found).toBe(true);
    expect(world.stats.sitesScouted).toBe(1);
  });

  it('marks an ore seam for the miners', () => {
    const { world, pawn } = ready();
    const site = siteOf(world, 'lode');
    resolveSite(world, pawn, site);

    let marked = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (world.cellDesig[packCell(world, site.x + dx, site.y + dy)] === DESIG_HARVEST) marked++;
      }
    }
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThanOrEqual(10);
  });

  it('brings a survivor into the colony, hurt but able to walk home', () => {
    const { world, pawn } = ready();
    const before = livingColonists(world).length;
    const site = siteOf(world, 'survivor');
    resolveSite(world, pawn, site);

    const after = livingColonists(world);
    expect(after.length).toBe(before + 1);
    const found = after[after.length - 1]!;
    // Rough enough to be a rescue, not so rough they die of the walk back — a
    // survivor who starves on the road home is a worse story than no survivor.
    expect(found.hp).toBeLessThan(found.maxHp);
    expect(found.downed).toBe(false);
    expect(found.needs.food).toBeGreaterThan(0.2);
    expect(Math.hypot(found.x - site.x, found.y - site.y)).toBeLessThanOrEqual(6);
  });

  it('arms the quiet from the find, so a trip called off costs nothing', () => {
    const { world, pawn } = onlyScouting();
    expect(world.storyteller.nextScout).toBe(0);
    // Setting out does not start the clock...
    assignJob(world, pawn);
    expect(world.jobs.find((j) => j.kind === 'scout')).toBeDefined();
    expect(world.storyteller.nextScout).toBe(0);
    // ...arriving does.
    resolveSite(world, pawn, siteOf(world, 'cache'));
    expect(world.storyteller.nextScout).toBe(SCOUT_COOLDOWN);
  });
});

describe('a settler deciding to go, on their own', () => {
  it('picks scouting up when there is nothing left at home to do', () => {
    const { world, pawn } = onlyScouting();
    assignJob(world, pawn);
    const job = world.jobs.find((j) => j.id === pawn.jobId);
    expect(job?.kind).toBe('scout');
    // Aimed at a real find, and announced — an expedition the player never hears
    // about is a settler who wandered off.
    expect(world.sites.some((s) => s.x === job!.tx && s.y === job!.ty)).toBe(true);
    expect(world.messages.some((m) => /sets out to have a look/.test(m.text))).toBe(true);
  });

  it('never at the cost of work at home', () => {
    // Scouting is bottom of the board on purpose. A day-one colony has meals to
    // cook, a wall to finish and supplies on the floor; none of that should lose
    // to sightseeing, even when scouting sits at the same priority.
    const { world, pawn } = ready();
    for (const w of Object.keys(pawn.priorities) as Array<keyof typeof pawn.priorities>) {
      pawn.priorities[w] = 1;
    }
    assignJob(world, pawn);
    expect(pawn.jobId).not.toBeNull();
    expect(world.jobs.find((j) => j.id === pawn.jobId)!.kind).not.toBe('scout');
  });
});

describe('the itch', () => {
  /**
   * Bottom of the board turned out to mean never. A colony that is building
   * anything has a crate on the floor every hour of every day, hauling sits one
   * slot above scouting, and sixteen days of a real colony produced ninety-four
   * quiet moments where somebody could have walked out — and none of them did.
   * These are the tests for the counter that eventually says go.
   */

  it('counts only the afternoons the colony could have gone', () => {
    const { world } = ready();
    const before = world.storyteller.scoutItch ?? 0;
    // A raid on is not a missed chance; it is a colony with better things to do.
    world.storyteller.raidActive = true;
    tickScoutItch(world);
    expect(world.storyteller.scoutItch ?? 0).toBe(before);

    world.storyteller.raidActive = false;
    tickScoutItch(world);
    expect(world.storyteller.scoutItch ?? 0).toBe(before + 1);
  });

  it('takes half a day of them before it outranks anything', () => {
    const { world } = ready();
    expect(scoutOverdue(world)).toBe(false);
    for (let i = 0; i < TICKS_PER_DAY * 0.5 - 1; i++) tickScoutItch(world);
    expect(scoutOverdue(world)).toBe(false);
    tickScoutItch(world);
    expect(scoutOverdue(world)).toBe(true);
  });

  it('sends a settler who would otherwise have found one more crate to move', () => {
    // The regression this exists for: every work type on, a yard full of loose
    // goods, and a settler who will pick up a crate every time forever.
    const { world, pawn } = ready();
    for (const w of Object.keys(pawn.priorities) as Array<keyof typeof pawn.priorities>) {
      pawn.priorities[w] = 1;
    }
    for (let i = 0; i < TICKS_PER_DAY; i++) tickScoutItch(world);
    assignJob(world, pawn);
    expect(world.jobs.find((j) => j.id === pawn.jobId)!.kind).toBe('scout');
  });

  it('is spent by the find, so the colony goes back to its work', () => {
    const { world, pawn } = ready();
    for (let i = 0; i < TICKS_PER_DAY; i++) tickScoutItch(world);
    expect(scoutOverdue(world)).toBe(true);
    resolveSite(world, pawn, world.sites[0]!);
    expect(scoutOverdue(world)).toBe(false);
    // And it cannot start climbing again until the cooldown is spent.
    tickScoutItch(world);
    expect(world.storyteller.scoutItch).toBe(0);
  });
});

describe('an expedition, end to end', () => {
  // The experience test: nobody possessed, nobody ordered. A settler with a quiet
  // afternoon walks off the edge of the home ground, and something the colony can
  // use comes back with them.
  const world = createWorld(4242);
  const streams = makeStreams(world);
  const sitesBefore = world.sites.length;
  for (let i = 0; i < TICKS_PER_DAY * 16; i++) {
    stepWorld(world, streams);
    stewardTick(world, world.tick);
  }

  it('sends somebody out and they find something', () => {
    expect(world.stats.sitesScouted).toBeGreaterThan(0);
  });

  it('turns the find into work the colony already knows how to do', () => {
    const found = world.sites.filter((s) => s.found);
    expect(found.length).toBe(world.stats.sitesScouted);
    // Whatever was found landed as a stack, a designation or a person — never as
    // a number quietly added to a total.
    const payoff = found.some((s) => {
      if (s.kind === 'cache') return true;
      if (s.kind === 'lode') return true;
      return livingColonists(world).length > 3;
    });
    expect(payoff).toBe(true);
  });

  it('does not loot the whole map in an afternoon', () => {
    // The cooldown is what stops eight discoveries arriving as one supply drop
    // and leaving nothing out there for the rest of the game.
    expect(world.stats.sitesScouted).toBeLessThanOrEqual(
      Math.ceil((TICKS_PER_DAY * 16) / SCOUT_COOLDOWN) + 1,
    );
    expect(world.sites.length).toBe(sitesBefore); // finds are the seed's, not rolled on arrival
  });

  it('leaves nobody stranded out on the map', () => {
    for (const p of livingColonists(world)) {
      expect(p.dead).toBe(false);
    }
    // No expedition wedged: a scout job older than the survey plus a long walk is
    // a settler standing in a field forever.
    for (const j of world.jobs.filter((q) => q.kind === 'scout')) {
      expect(j.age).toBeLessThan(20 * 90);
      expect(j.progress).toBeLessThanOrEqual(surveyTicks(world));
    }
  });
});

describe('a scout caught out when the horizon changes', () => {
  it('turns back the moment raiders land', () => {
    const { world, pawn } = onlyScouting();
    assignJob(world, pawn);
    const job = world.jobs.find((j) => j.kind === 'scout')!;
    // Well out of the yard, still walking, when it happens.
    stepWorldN(world, makeStreams(world), 200);
    expect(world.jobs.some((j) => j.id === job.id)).toBe(true);

    makePawn(world, new Rng(3), 'raider', 4, 4, { weapon: 'rifle' });
    world.storyteller.raidActive = true;
    msg(world, 'raid');
    stepWorldN(world, makeStreams(world), 5);

    expect(world.jobs.some((j) => j.id === job.id)).toBe(false);
    expect(pawn.jobId).not.toBe(job.id);
  });
});
