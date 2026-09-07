/**
 * Two ways to be off the map, and every counter has to know about both.
 *
 * There is one question this game must never get wrong, and it is "is everyone
 * dead". It got it wrong. A settler who leaves with a caravan is lifted out of
 * `world.pawns` so that nothing can path to, feed or shoot a body four days
 * away, and the counters that ask about the colony rather than about the yard
 * each wrote the correction inline: `caravansOf(world).filter(alive).length`.
 * Then `joinWarParty` began doing the same lift, into `world.war`, and none of
 * those inline sums learned about it. So a colony whose home was wiped while
 * three settlers were on the moor printed "Aetherhold has fallen. No settlers
 * remain." — with three settlers alive and walking back to it — and a player who
 * merely *ordered* the march the warfare road spends four rungs teaching them to
 * want watched the founding banner fall from 8/8 to 5/8 the same afternoon,
 * resetting any committed ending's twelve-day clock.
 *
 * The fix is one helper, `awayCount`, and the reason it is a helper rather than
 * a third inline sum is this file: a fourth way to be off the map has one place
 * to be added and these tests pick it up without being edited.
 *
 * The other half of the invariant is the one place that deliberately does *not*
 * use it, which is the harder half to keep. `colonySize` feeds `roadsAllowed`,
 * which asks "how many can this colony do without" rather than "how many of us
 * are there" — and a body already at war is already being done without. Counting
 * them there would let a colony of eight field three at war, earn a second road
 * on the strength of the three it no longer has, send two more, and hold the
 * valley with three. That asymmetry looks like an oversight to anybody tidying
 * up, so the last test here pins it as a decision.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { checkGameOver } from '../src/sim/events';
import { holdingsOf, joinWarParty, musterWarParty, WAR_PARTY } from '../src/sim/holdings';
import { colonySize, roadsAllowed } from '../src/sim/settlements';
import { charters } from '../src/sim/victory';
import { awayCount, livingColonists } from '../src/sim/world';
import type { Pawn, World } from '../src/sim/types';

const SEED = 4242;

/** How many settlers the founding charter currently says the colony has. */
function hearth(world: World): number {
  const row = charters(world).find((c) => c.id === 'hearth');
  if (!row) throw new Error('the hearth charter has been renamed — this file is measuring nothing');
  return row.at;
}

/**
 * Sends `n` settlers over the ridge, through the sim's own two entry points.
 *
 * `planCampaign` is skipped on purpose and it is the only thing skipped: it is
 * the gate (seven on their feet, the ring walked, no raid in the yard), and a
 * gate is not what these tests are about. `musterWarParty` and `joinWarParty`
 * are, because between them they are what actually takes a settler off the map,
 * and a test that assembled `world.war` by hand would keep passing on the day
 * that lift changed.
 */
function march(world: World, n: number): Pawn[] {
  const holding = holdingsOf(world)[0];
  if (!holding) throw new Error('the valley has no neighbours to march on');
  const party = livingColonists(world).slice(0, n);
  expect(party.length).toBe(n);
  musterWarParty(world, { ok: true, holding, head: { x: 1, y: 1 }, party });
  for (const p of party) joinWarParty(world, p);
  return party;
}

// ---------------------------------------------------------------- functional

describe('awayCount, on its own', () => {
  it('counts nobody in a colony that has sent nobody anywhere', () => {
    expect(awayCount(createWorld(SEED))).toBe(0);
  });

  it('counts the war party', () => {
    const world = createWorld(SEED);
    const party = march(world, WAR_PARTY);
    expect(awayCount(world)).toBe(party.length);
  });

  it('stops counting a marcher who is killed out there', () => {
    const world = createWorld(SEED);
    const party = march(world, WAR_PARTY);
    party[0]!.dead = true;
    // Not `toBeGreaterThan`: the whole defect was a count that was wrong by a
    // specific number of people, so the assertion is the number.
    expect(awayCount(world)).toBe(party.length - 1);
  });

  it('survives a world that has never had a caravan or a war party', () => {
    // Both fields are lazily created, and a save written before either existed
    // loads without them. A head count that throws on an old save is a worse
    // bug than the one this file is about.
    const world = createWorld(SEED);
    delete (world as { caravans?: unknown }).caravans;
    world.war = null;
    expect(awayCount(world)).toBe(0);
  });
});

// ---------------------------------------------------------------- experience

describe('a colony with everybody out on the moor', () => {
  it('is not over', () => {
    const world = createWorld(SEED);
    // The whole colony marches, so `world.pawns` holds no living colonist at
    // all — the exact state that read as a total loss.
    const party = march(world, livingColonists(world).length);
    expect(livingColonists(world).length).toBe(0);
    expect(party.length).toBeGreaterThan(0);

    checkGameOver(world);

    expect(world.gameOver).toBe(false);
    expect(world.messages.some((m) => m.text.includes('Aetherhold has fallen'))).toBe(false);
  });

  it('is over when they die out there, because the game still has to be losable', () => {
    // The failure mode of the fix, and the reason this test sits next to the one
    // above: a helper that counted bodies rather than living people would make a
    // colony that lost its last three settlers at the walls of a holding
    // immortal, and nothing else in the sim would ever say otherwise.
    const world = createWorld(SEED);
    const party = march(world, livingColonists(world).length);
    for (const p of party) p.dead = true;

    checkGameOver(world);

    expect(world.gameOver).toBe(true);
    expect(world.messages.some((m) => m.text.includes('Aetherhold has fallen'))).toBe(true);
  });

  it('keeps its founding charter, because ordering the march is not losing people', () => {
    const world = createWorld(SEED);
    const before = hearth(world);
    expect(before).toBeGreaterThanOrEqual(WAR_PARTY);

    march(world, WAR_PARTY);

    expect(hearth(world)).toBe(before);
  });
});

describe('the one counter that deliberately does not count them', () => {
  it('does not let a colony earn a road on the strength of the settlers it sent to war', () => {
    const world = createWorld(SEED);
    const world2 = createWorld(SEED);
    march(world2, WAR_PARTY);

    // `colonySize` asks how many the colony can do without, so a marcher is
    // already spent and must not appear. If a later tidy-up routes this through
    // `awayCount` for consistency, these two numbers become equal and the road
    // gate quietly loosens on the afternoon a player commits to a campaign.
    expect(colonySize(world2)).toBe(colonySize(world) - WAR_PARTY);
    expect(roadsAllowed(world2)).toBeLessThanOrEqual(roadsAllowed(world));

    // And the two questions really are different questions, in the same world at
    // the same moment: the charter still counts the marchers, the road does not.
    expect(hearth(world2)).toBe(hearth(world));
  });
});
