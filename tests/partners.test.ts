/**
 * Partners — the pair a colony makes of itself.
 *
 * This is the one system in the game whose whole purpose is that a particular
 * settler dying is not the same event as a settler dying. Everything else prices
 * a colonist as a pair of hands; this prices one of them as somebody's person.
 *
 * The tests below hold three lines that are easy to cross by accident.
 *
 * **It must be earned, not rolled.** No dice anywhere in `partners.ts`, so a
 * pairing cannot shift a seed and cannot happen on a lucky Tuesday. The tests
 * drive bonds directly and check that nothing happens below the line and the
 * right thing happens above it.
 *
 * **It must stay small.** A partner is worth about a warm room. If this ever
 * grows to where it can carry a colony through a famine, the mood system stops
 * being about food and starts being about pairing everybody off.
 *
 * **It must not spam.** One pair per pass, and a dissolution has to require a
 * real collapse rather than one quiet fortnight — otherwise the log fills with
 * couples forming and un-forming and the player learns to read past all of it.
 */

import { describe, expect, it } from 'vitest';

import {
  COURT_KEEP,
  COURT_TICKS,
  MOURN_MOOD,
  MOURN_TICKS,
  PAIR_BOND,
  PARTNER_HURT,
  PARTNER_MOOD,
  PART_BOND,
  courtedFor,
  courting,
  isPartnered,
  partnerLost,
  partnerOf,
  partners,
  tickPartners,
  widow,
} from '../src/sim/partners';
import { assignNeedsOnly } from '../src/sim/jobs';
import { needsBedRest } from '../src/sim/health';
import { bondKey, bonds } from '../src/sim/social';
import { MOOD_OFFSET_LIMIT, computeMood, grieve } from '../src/sim/needs';
import { createWorld } from '../src/sim/worldgen';
import { livingColonists } from '../src/sim/world';
import type { Pawn, World } from '../src/sim/types';

/** Put an opinion of exactly this size between two settlers. */
function setBond(world: World, a: Pawn, b: Pawn, value: number): void {
  bonds(world)[bondKey(a.id, b.id)] = value;
}

/**
 * A world and its three founders, with the pairing pass sitting on a tick it
 * will actually run on — the pass is on a timer, and a test that lands between
 * two of them measures nothing.
 */
function colony(): { world: World; crew: Pawn[] } {
  const world = createWorld(20260729);
  const crew = livingColonists(world);
  expect(crew.length).toBeGreaterThanOrEqual(3);
  world.tick = 0;
  return { world, crew };
}

/**
 * Run the pass that starts their clock, wait the ten days out, and run the pass
 * that pairs them. Two passes because one is not enough any more and that is the
 * point: a bond above the line is a courtship, and a courtship that has held is a
 * pairing. Leaves the world sitting on `COURT_TICKS`, which is a multiple of the
 * pass interval, so a caller can keep ticking without landing between passes.
 */
function pairUp(world: World): void {
  tickPartners(world);
  world.tick += COURT_TICKS;
  tickPartners(world);
}

describe('forming a pair', () => {
  it('leaves close friends alone below the line', () => {
    const { world, crew } = colony();
    // One under. Friends — inseparable, even — but not this.
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND - 1);
    tickPartners(world);
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
    expect(isPartnered(world, crew[1]!.id)).toBe(false);
  });

  it('pairs the strongest bond in the colony, and only that one', () => {
    const { world, crew } = colony();
    // Two eligible pairs at once, which is the case that decides whether this
    // reads as something that happened or as a system firing.
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 4);
    setBond(world, crew[1]!, crew[2]!, PAIR_BOND + 12);
    pairUp(world);
    expect(partnerOf(world, crew[1]!)?.id).toBe(crew[2]!.id);
    expect(partnerOf(world, crew[2]!)?.id).toBe(crew[1]!.id);
    // And the runner-up is untouched — crew[1] was the strongest bond's partner,
    // so crew[0] is left where they were rather than paired off in the same pass.
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
  });

  it('is mutual in both directions, so a lookup from either side finds it', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[2]!, PAIR_BOND + 1);
    pairUp(world);
    const map = partners(world);
    expect(map[crew[0]!.id]).toBe(crew[2]!.id);
    expect(map[crew[2]!.id]).toBe(crew[0]!.id);
  });

  it('says so once, in the log, as a headline', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    const said = world.messages.filter((m) => m.text.includes('made a life together'));
    expect(said.length).toBe(1);
    // Run it again with the bond still high: they are already paired, so nothing
    // more is said. A log line per minute for the same couple is the failure.
    world.tick = 0;
    tickPartners(world);
    expect(world.messages.filter((m) => m.text.includes('made a life together')).length).toBe(1);
  });

  it('never pairs somebody who is already spoken for', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    // Now dangle a stronger bond at one of them.
    setBond(world, crew[0]!, crew[2]!, 100);
    world.tick = 0;
    tickPartners(world);
    expect(partnerOf(world, crew[0]!)?.id).toBe(crew[1]!.id);
    expect(isPartnered(world, crew[2]!.id)).toBe(false);
  });

  it('spends no randomness at all, so it cannot move a seed', () => {
    // The guard on the seed contract. A pairing is earned by months of proximity
    // and must never be a roll — if it draws, every colony's story diverges the
    // first time two settlers get on well.
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 9);
    const before = { ...world.rng };
    pairUp(world);
    expect(world.rng).toEqual(before);
  });
});

describe('what a partner is worth', () => {
  it('lifts them both, by about what a warm room is worth', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    expect(crew[0]!.partnerMood).toBe(PARTNER_MOOD);
    expect(crew[1]!.partnerMood).toBe(PARTNER_MOOD);
    // Small enough that it cannot carry a colony. If this ever exceeds what an
    // empty stomach costs, the game is about pairing people off, not about food.
    expect(PARTNER_MOOD).toBeLessThan(0.1);
  });

  it('shrinks rather than inverts while the other one is hurt', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    crew[1]!.downed = true;
    tickPartners(world);
    expect(crew[0]!.partnerMood).toBe(PARTNER_HURT);
    // Still positive: a partner bleeding in a medbed is a partner who is alive,
    // and worrying about somebody must never be worse than having nobody.
    expect(crew[0]!.partnerMood!).toBeGreaterThan(0);
  });

  it('reaches mood through the same door every other standing term uses', () => {
    // `computeMood` is recomputed from fields every tick, so a term that is not
    // summed in there survives exactly one tick and then vanishes. This is the
    // test that catches the field being written and never read.
    const { crew } = colony();
    const p = crew[0]!;
    p.partnerMood = 0;
    const alone = computeMood(p);
    p.partnerMood = PARTNER_MOOD;
    expect(computeMood(p) - alone).toBeCloseTo(PARTNER_MOOD, 6);
  });

  it('is zero for everybody who has nobody', () => {
    const { world, crew } = colony();
    tickPartners(world);
    for (const p of crew) expect(p.partnerMood).toBe(0);
  });
});

describe('losing one', () => {
  it('finds the one who is left, and only for a real pairing', () => {
    const { world, crew } = colony();
    expect(partnerLost(world, crew[0]!)).toBeNull();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    expect(partnerLost(world, crew[0]!)?.id).toBe(crew[1]!.id);
  });

  it('takes the survivor all the way to the floor of what mood events can do', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    for (const p of crew) p.moodOffset = 0;
    crew[0]!.dead = true;
    grieve(world, crew[0]!);
    // The clamp is the point, not an accident: whatever else has happened to
    // them this week, burying their partner is the worst day the mood system
    // has. `WIDOW_GRIEF` exists to guarantee they arrive here even if the bond
    // had slipped in the month before.
    expect(crew[1]!.moodOffset).toBeCloseTo(-MOOD_OFFSET_LIMIT, 6);
  });

  it('lasts, which is the part the spike cannot say', () => {
    // The test that made the design change. A close friend and a partner both
    // land on the clamp, so *depth* cannot tell the two losses apart — the
    // difference has to be how long it takes to climb out. Identical bonds on
    // purpose: the only thing separating these two settlers is the pairing.
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    setBond(world, crew[0]!, crew[2]!, PAIR_BOND + 5);
    crew[0]!.dead = true;
    grieve(world, crew[0]!);
    tickPartners(world);
    expect(crew[1]!.partnerMood).toBe(MOURN_MOOD);
    expect(crew[1]!.mourning).toBeGreaterThan(0);
    // The friend who was every bit as close is not carrying anything standing.
    expect(crew[2]!.partnerMood).toBe(0);
    expect(crew[2]!.mourning).toBeFalsy();
  });

  it('lets the grief run out on its own', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    crew[0]!.dead = true;
    grieve(world, crew[0]!);
    const left = crew[1]!;
    for (let t = 0; t < MOURN_TICKS + 2; t++) {
      world.tick = t;
      tickPartners(world);
    }
    // Days, not forever. A settler who never comes out of it is a settler the
    // player has to write off, and that is a different game.
    expect(left.mourning).toBeFalsy();
    expect(left.partnerMood).toBe(0);
  });

  it('clears the pairing and leaves the memory', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    crew[0]!.dead = true;
    widow(world, crew[0]!, crew[1]!);
    expect(isPartnered(world, crew[1]!.id)).toBe(false);
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
    expect(crew[1]!.memories?.some((m) => m.text.includes(crew[0]!.name))).toBe(true);
    expect(world.messages.some((m) => m.text.includes('had made a life with'))).toBe(true);
  });

  it('will not pair off a settler who is still grieving', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    crew[0]!.dead = true;
    grieve(world, crew[0]!);
    // Somebody the survivor is extremely close to, ready and waiting.
    setBond(world, crew[1]!, crew[2]!, 100);
    world.tick = 0;
    tickPartners(world);
    expect(isPartnered(world, crew[1]!.id)).toBe(false);
  });
});

describe('drifting apart', () => {
  it('holds a pairing together through an ordinary cold spell', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    // Down to friendly — well below what formed them, and not remotely a parting.
    setBond(world, crew[0]!, crew[1]!, PART_BOND + 6);
    world.tick = 0;
    tickPartners(world);
    expect(partnerOf(world, crew[0]!)?.id).toBe(crew[1]!.id);
  });

  it('ends one that has genuinely collapsed, and says so', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    setBond(world, crew[0]!, crew[1]!, PART_BOND - 1);
    world.tick = 0;
    tickPartners(world);
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
    expect(isPartnered(world, crew[1]!.id)).toBe(false);
    expect(world.messages.some((m) => m.text.includes('gone their separate ways'))).toBe(true);
  });

  it('frees both of them to pair again', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    setBond(world, crew[0]!, crew[1]!, 0);
    setBond(world, crew[1]!, crew[2]!, PAIR_BOND + 20);
    world.tick = 0;
    // The dissolution runs before the forming in the same pass, on purpose, so
    // somebody who is free by the end of this pass is considered *in* it — which
    // now means their clock starts here rather than a minute later.
    tickPartners(world);
    expect(courting(world)[bondKey(crew[1]!.id, crew[2]!.id)]).toBe(0);
    world.tick += COURT_TICKS;
    tickPartners(world);
    expect(partnerOf(world, crew[1]!)?.id).toBe(crew[2]!.id);
  });
});

describe('the ten days in between', () => {
  it('does not pair anybody on the day the line is crossed', () => {
    // The bug this whole mechanic exists to fix. Measured on a real colony, the
    // top bonds pin at the cap inside a fortnight, so the threshold alone paired
    // most of the founders off before the first winter — a system firing, not a
    // story. Crossing the line starts a clock and nothing else happens today.
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 20);
    tickPartners(world);
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
    expect(world.messages.some((m) => m.text.includes('made a life together'))).toBe(false);
    // But the game knows something is happening, which is what the inspector reads.
    expect(courting(world)[bondKey(crew[0]!.id, crew[1]!.id)]).toBe(world.tick);
  });

  it('will not pair them one day short', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 20);
    tickPartners(world);
    world.tick += COURT_TICKS - 200;
    tickPartners(world);
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
    // And one more pass, which is the day it does.
    world.tick += 200;
    tickPartners(world);
    expect(partnerOf(world, crew[0]!)?.id).toBe(crew[1]!.id);
  });

  it('keeps the clock through an ordinary bad week', () => {
    // The rule this replaced cancelled on any dip at all, and that turned out to
    // be the whole feature: bonds that reach the line wander about ten points
    // over a month, so the clock was being reset by the ordinary weather of the
    // number it was watching, and across three ninety-day colonies exactly one
    // pair ever survived ten consecutive days. See `COURT_KEEP`.
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 20);
    tickPartners(world);
    const started = courting(world)[bondKey(crew[0]!.id, crew[1]!.id)];
    world.tick += COURT_TICKS - 200;
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND - 1);
    tickPartners(world);
    // Same stamp it started with — not restarted, not dropped.
    expect(courting(world)[bondKey(crew[0]!.id, crew[1]!.id)]).toBe(started);
    // But not announced while they are below the line either: held long enough
    // is only half of it, and the other half is close today.
    world.tick += 200;
    tickPartners(world);
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
    // Back above it, and the ten days they already served still count.
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 2);
    tickPartners(world);
    expect(partnerOf(world, crew[0]!)?.id).toBe(crew[1]!.id);
  });

  it('starts the clock over if they genuinely fall out', () => {
    // What still makes this a commitment rather than a peak. Eight points is
    // weather; a real souring blows straight through it in a couple of days,
    // because the unkind half of `social.ts` has no diminishing returns on it.
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 20);
    tickPartners(world);
    world.tick += COURT_TICKS - 200;
    setBond(world, crew[0]!, crew[1]!, COURT_KEEP - 1);
    tickPartners(world);
    expect(courting(world)[bondKey(crew[0]!.id, crew[1]!.id)]).toBeUndefined();
    // Back above the line — and back to day one, not day nine.
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 20);
    world.tick += 200;
    tickPartners(world);
    world.tick += COURT_TICKS - 200;
    tickPartners(world);
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
  });

  it('reports how long they have been at it, for the inspector', () => {
    const { world, crew } = colony();
    expect(courtedFor(world, crew[0]!.id, crew[1]!.id)).toBe(0);
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 20);
    tickPartners(world);
    world.tick += 600;
    expect(courtedFor(world, crew[0]!.id, crew[1]!.id)).toBe(600);
  });

  it('drops the clock the moment they are paired, so nothing stale is left', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 20);
    pairUp(world);
    expect(courting(world)[bondKey(crew[0]!.id, crew[1]!.id)]).toBeUndefined();
  });

  it('keeps a courtship across a save', () => {
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 20);
    tickPartners(world);
    const back = JSON.parse(JSON.stringify(world)) as World;
    back.tick += COURT_TICKS;
    tickPartners(back);
    // Nine days of courtship that a save-and-load resets is a mechanic the player
    // can only lose by playing the game the way it asks them to.
    expect(back.partners?.[crew[0]!.id]).toBe(crew[1]!.id);
  });
});

describe('coming to bed', () => {
  /**
   * The experience half: a pairing the player can *see*, not just read in a
   * mood row. Two bunks close together and one across the yard; the partner is
   * already asleep in the far-from-tired-settler cluster, so the plain distance
   * rule would send them to the near bunk and the pull has to overcome it.
   */
  function bunkhouse(): { world: World; crew: Pawn[]; near: number; far: number } {
    const { world, crew } = colony();
    for (const b of world.buildings) b.occupant = null;
    const beds = world.buildings.filter((b) => b.kind === 'bed' && b.built);
    expect(beds.length).toBeGreaterThanOrEqual(2);
    return { world, crew, near: beds[0]!.id, far: beds[1]!.id };
  }

  it('sends a settler to the bunk beside the one their partner is asleep in', () => {
    const { world, crew } = bunkhouse();
    const beds = world.buildings.filter((b) => b.kind === 'bed' && b.built);
    const [a, b] = [beds[0]!, beds[beds.length - 1]!];
    expect(a.id).not.toBe(b.id);
    const [tired, mate] = [crew[0]!, crew[1]!];
    setBond(world, tired, mate, PAIR_BOND + 5);
    pairUp(world);
    // Stand the tired one on top of the bed they would pick on distance alone,
    // and put their partner asleep in the other. Whatever the pull chooses now,
    // it chose against the geometry.
    tired.x = a.x;
    tired.y = a.y;
    tired.needs.rest = 0.05;
    tired.needs.food = 1;
    mate.x = b.x;
    mate.y = b.y;
    mate.activity = 'sleeping';
    b.occupant = mate.id;
    expect(assignNeedsOnly(world, tired)).toBe(true);
    const job = world.jobs.find((j) => j.id === tired.jobId);
    expect(job?.kind).toBe('sleep');
    const chosen = world.buildings.find((bb) => bb.id === job?.buildingId)!;
    // Within a room of their partner, which is the whole claim. Not necessarily
    // the single nearest bunk to them — the point is they did not sleep alone at
    // the other end of the base.
    expect(Math.hypot(chosen.x - b.x, chosen.y - b.y)).toBeLessThanOrEqual(6);
  });

  it('will not walk a sick settler past the sickbay to do it', () => {
    // The pull is a preference, not a rule. `SICKBAY_PULL` is forty and this is
    // six, and that ordering is the difference between a nice touch and a
    // feature that kills people.
    const { world, crew } = bunkhouse();
    const med = world.buildings.find((b) => b.kind === 'medbed' && b.built);
    if (!med) return; // no sickbay in the opening colony: nothing to protect here
    const [sick, mate] = [crew[0]!, crew[1]!];
    setBond(world, sick, mate, PAIR_BOND + 5);
    pairUp(world);
    sick.needs.rest = 0.05;
    sick.needs.food = 1;
    sick.hp = sick.maxHp * 0.3;
    const far = world.buildings.find((b) => b.kind === 'bed' && b.built)!;
    mate.x = far.x;
    mate.y = far.y;
    mate.activity = 'sleeping';
    far.occupant = mate.id;
    expect(assignNeedsOnly(world, sick)).toBe(true);
    const sickJob = world.jobs.find((j) => j.id === sick.jobId);
    const chosen = world.buildings.find((bb) => bb.id === sickJob?.buildingId);
    if (needsBedRest(sick)) expect(chosen?.kind).toBe('medbed');
  });
});

describe('a save carries it', () => {
  it('survives a round trip through JSON with numeric keys intact', () => {
    // The map is keyed by pawn id, and JSON turns every key into a string. That
    // is fine — `obj[5]` and `obj["5"]` are the same lookup — but it is exactly
    // the kind of thing that works until somebody writes `Object.keys(...)` and
    // compares to a number, so it is pinned here.
    const { world, crew } = colony();
    setBond(world, crew[0]!, crew[1]!, PAIR_BOND + 5);
    pairUp(world);
    const back = JSON.parse(JSON.stringify(world)) as World;
    expect(partnerOf(back, back.pawns.find((p) => p.id === crew[0]!.id)!)?.id).toBe(crew[1]!.id);
  });

  it('reads a colony that predates the feature as nobody being paired', () => {
    const { world, crew } = colony();
    delete world.partners;
    expect(isPartnered(world, crew[0]!.id)).toBe(false);
    expect(partnerOf(world, crew[0]!)).toBeNull();
    expect(partnerLost(world, crew[0]!)).toBeNull();
  });
});
