/**
 * The holdings, and the war parties sent to take them.
 *
 * The third road is the only one that can lose. Science is a bench that either
 * has the projects or does not, the trade road pays out or the traveller comes
 * home with the pack they left with — but a campaign puts three settlers off the
 * map for a week and can hand them back wrecked with nothing. So this file is
 * organised around the three things that go wrong with that, in the order they
 * would hurt:
 *
 * **The arithmetic.** Every number in `holdings.ts` is bought from a number that
 * already existed, and the whole argument for the stage rests on that: a garrison
 * is `raiderBand` at the difficulty the colony is already playing, a walk is the
 * caravan's walk, tribute is a pack. The first block holds each of those to the
 * constant it was derived from, so the day somebody tunes a holding by typing a
 * new literal into this file, a test says where that literal was supposed to come
 * from.
 *
 * **The party half-lifted off the map.** Three settlers out of `world.pawns` is
 * the same body-in-an-unexpected-place problem the trade road has, three at a
 * time, and with a muster in front of it that can be called off mid-walk. The
 * second block is every way a march can end early — a raid, a muster that never
 * fills, a settler the player takes over — and the one thing they all have to do:
 * put everybody back where the rest of the sim can find them.
 *
 * **The bill.** A war is meant to cost. The third block is the fight's branches
 * and what each writes down: the win that takes the ground and raises the
 * storyteller's next visit, the loss that comes home hurt but whole, and the
 * tribute that makes holding it worth having gone.
 */

import { describe, expect, it } from 'vitest';

import { CLEAN_PER_STEP, escalation, raiderBand } from '../src/sim/events';
import {
  HOLDING_COUNT,
  WAR_PARTY,
  garrisonSize,
  heldCount,
  holdingById,
  holdingsOf,
  joinWarParty,
  planCampaign,
  tickWar,
  tributeOf,
  tributeTicks,
  warDaysLeft,
  warPartyOf,
} from '../src/sim/holdings';
import { orderCampaign } from '../src/sim/jobs';
import { makePawn } from '../src/sim/pawn';
import { Rng } from '../src/sim/rng';
import {
  CAN_SPARE_ONE,
  NEIGHBOUR_COUNT,
  PACK_MIN,
  PER_RING,
  roundTripDays,
  settlementsOf,
} from '../src/sim/settlements';
import { deserialize, serialize } from '../src/sim/save';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { Holding, Pawn, World } from '../src/sim/types';
import { addItem, countResource, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

const SEED = 20260729;

const VIEW = {
  mode: 'manager' as const,
  camera: { targetX: 32, targetY: 32, distance: 40, yaw: 0.8, pitch: 0.9 },
  possessedId: null,
};

/** The line `combat.ts` puts a settler on the floor at. */
const DOWNED = 0.22;

/**
 * A colony big enough to march, with the storyteller told to stay away.
 *
 * Seven on their feet is the bar `planCampaign` sets and there is no point
 * testing the refusal in a fixture meant for the acceptance — so the fixture
 * clears it by one, which is also the interesting number: a colony at exactly
 * `CAN_SPARE_ONE + WAR_PARTY` can field one party and not a man more.
 */
function marchable(seed = SEED, extra = 0): World {
  const world = createWorld(seed);
  const rng = new Rng(99);
  while (livingColonists(world).length < CAN_SPARE_ONE + WAR_PARTY + extra) {
    makePawn(world, rng, 'colony', 30, 30);
  }
  for (const p of livingColonists(world)) {
    p.weapon = 'rifle';
    p.hp = p.maxHp;
  }
  addItem(world, 'meal', 400, 31, 34);
  world.storyteller.nextThreat = TICKS_PER_DAY * 60;
  world.storyteller.nextScout = TICKS_PER_DAY * 60;
  world.storyteller.nextOutbreak = TICKS_PER_DAY * 60;
  return world;
}

/** The near holding — ring 0, the one every colony can reach the day it can spare the hands. */
function doorway(world: World): Holding {
  const h = holdingsOf(world).find((o) => o.ring === 0);
  if (!h) throw new Error('no holding on the near ring');
  return h;
}

/**
 * Put a party in front of a holding with the fight one tick away.
 *
 * Skips the muster on purpose: whether three settlers can cross their own yard is
 * the job system's question and it is asked further down. What this sets up is the
 * assault, which is the part that has branches.
 */
function atTheWalls(world: World, h: Holding, party: Pawn[]): void {
  for (const p of party) world.pawns = world.pawns.filter((o) => o.id !== p.id);
  world.war = {
    holdingId: h.id,
    pawns: party,
    x: 4,
    y: 4,
    dueTick: world.tick,
    phase: 'outbound',
  };
}

/** Arm the party for the fight this test wants to see. */
function arm(party: Pawn[], weapon: Pawn['weapon'], shooting: number, hp = 1): void {
  for (const p of party) {
    p.weapon = weapon;
    p.skills.shooting = shooting;
    p.hp = p.maxHp * hp;
  }
}

// ---------------------------------------------------------------------------
// the arithmetic
// ---------------------------------------------------------------------------

describe('a stage that invents no numbers of its own', () => {
  it('puts one holding behind each ring of neighbours', () => {
    const world = createWorld(SEED);
    const holdings = holdingsOf(world);
    expect(HOLDING_COUNT).toBe(NEIGHBOUR_COUNT / PER_RING);
    expect(holdings).toHaveLength(HOLDING_COUNT);
    // One per ring and no ring twice, which is what makes "the far one" a place
    // rather than a difficulty setting: every holding is behind a ring the colony
    // has already had to earn its way into.
    expect(holdings.map((h) => h.ring)).toEqual([0, 1, 2]);
    expect(new Set(holdings.map((h) => h.name)).size).toBe(HOLDING_COUNT);
    expect(new Set(holdings.map((h) => h.id)).size).toBe(HOLDING_COUNT);
  });

  it('sends one fewer than the colony must keep at home', () => {
    // The bar the whole road hangs off. If `CAN_SPARE_ONE` ever moves, the party
    // moves with it and the seven-settler gate moves with both — this is the
    // assertion that stops the three drifting apart.
    expect(WAR_PARTY).toBe(CAN_SPARE_ONE - 1);
    expect(CAN_SPARE_ONE + WAR_PARTY).toBe(7);
  });

  it('never puts an even fight at the doorway', () => {
    expect([0, 1, 2].map(garrisonSize)).toEqual([2, 3, 4]);
    // The near garrison is deliberately one short of the party, because the
    // defenders shoot first: level numbers plus an opening volley is a holding
    // nobody takes, which would make the first rung of the road unreachable
    // rather than expensive. The far one is one over, and that is the whole
    // difficulty curve of the road.
    expect(garrisonSize(0)).toBe(WAR_PARTY - 1);
    expect(garrisonSize(1)).toBe(WAR_PARTY);
    expect(garrisonSize(2)).toBe(WAR_PARTY + 1);
  });

  it('scales the garrison by the difficulty and the ladder without knowing either exists', () => {
    // `holdings.ts` never reads a difficulty or an escalation rung; it rolls
    // `raiderBand`, which reads both. This is that promise stated as a test: the
    // same holding is defended by tougher men on a harsher board.
    const calm = createWorld(SEED, 'calm');
    const harsh = createWorld(SEED, 'harsh');
    const roll = (w: World) => raiderBand(w, new Rng(7)).hp;
    expect(roll(harsh)).toBeGreaterThan(roll(calm));
    // And by the rung the colony has climbed, on one board — which is the same
    // streak a won campaign adds to, so a colony that takes a holding is
    // defending the next one against its own success.
    const climbed = createWorld(SEED, 'settler');
    const before = raiderBand(climbed, new Rng(7)).hp;
    climbed.storyteller.unbloodied = CLEAN_PER_STEP * 2;
    expect(escalation(climbed)).toBeGreaterThan(escalation(createWorld(SEED, 'settler')));
    expect(raiderBand(climbed, new Rng(7)).hp).toBeGreaterThan(before);
  });

  it('pays a pack per ring, on the cadence of that ring', () => {
    const world = createWorld(SEED);
    for (const h of holdingsOf(world)) {
      expect(tributeOf(h)).toBe(PACK_MIN * (h.ring + 1));
      expect(tributeTicks(h)).toBe(Math.round(roundTripDays(h.ring) * TICKS_PER_DAY));
    }
    expect(holdingsOf(world).map(tributeOf)).toEqual([40, 80, 120]);
  });

  it('does not make the far holding richer, only dearer', () => {
    // The rate is what has to match, not the delivery: a far holding pays three
    // packs but pays them a third as often. If the far one out-earned the near
    // one there would be no decision on this road at all — every colony would
    // walk past the doorway and go straight to the end of the map.
    const world = createWorld(SEED);
    const perDay = holdingsOf(world).map((h) => tributeOf(h) / roundTripDays(h.ring));
    const best = Math.max(...perDay);
    const worst = Math.min(...perDay);
    expect(best / worst).toBeLessThan(1.2);
    // What the far one buys is the rung and the walk it takes to get there.
    expect(roundTripDays(2)).toBeGreaterThan(roundTripDays(0));
  });

  it('grows the same holdings on the same seed and leaves nothing else moved', () => {
    // The `settlementsOf` rule, restated: built off a salted stream of this
    // module's own, so shipping holdings did not deal a different card to any
    // system that was already drawing. Two worlds on one seed must agree, and a
    // world asked for its holdings must be the same world afterwards.
    const a = createWorld(SEED);
    const b = createWorld(SEED);
    holdingsOf(a);
    expect(holdingsOf(a).map((h) => h.name)).toEqual(holdingsOf(b).map((h) => h.name));
    expect(holdingsOf(a).map((h) => Math.round(h.bearing * 1e6))).toEqual(
      holdingsOf(b).map((h) => Math.round(h.bearing * 1e6)),
    );
    expect(settlementsOf(a).map((s) => s.name)).toEqual(settlementsOf(b).map((s) => s.name));
    // Memoised, not re-rolled: a second call must hand back the same objects, or
    // taking a holding would be forgotten by whoever asked next.
    expect(holdingsOf(a)[0]).toBe(holdingsOf(a)[0]);
  });

  it('grows holdings on a save that was written before they existed', () => {
    const world = marchable();
    delete (world as { holdings?: unknown }).holdings;
    const r = deserialize(serialize(world, VIEW, 1, 1_700_000_000_000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // An old save is a colony that has taken nothing, which is the honest reading
    // of a save from a build where there was nothing out there to take.
    expect(holdingsOf(r.save.world)).toHaveLength(HOLDING_COUNT);
    expect(heldCount(r.save.world)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// the party half-lifted off the map
// ---------------------------------------------------------------------------

describe('whether the colony may march', () => {
  it('turns down a colony that cannot leave four behind', () => {
    const world = createWorld(SEED);
    const plan = planCampaign(world, doorway(world).id);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    // Every refusal is the sentence the panel prints, and this one has to carry
    // both halves of the arithmetic — how many go and how many stay — because
    // "you need seven" without the reason is a rule the player has to guess at.
    expect(plan.text).toContain(String(CAN_SPARE_ONE + WAR_PARTY));
    expect(plan.text).toContain(String(WAR_PARTY));
    expect(plan.text).toContain(String(CAN_SPARE_ONE));
  });

  it('counts who is standing here, not who is on the books', () => {
    const world = marchable();
    expect(planCampaign(world, doorway(world).id).ok).toBe(true);
    // One on the floor and the colony is a man short — the headcount is read off
    // the map rather than off `colonySize` precisely so that a settler who cannot
    // hold a wall does not count as one who can.
    livingColonists(world)[0]!.downed = true;
    expect(planCampaign(world, doorway(world).id).ok).toBe(false);
  });

  it('will not send anybody out with raiders in the yard', () => {
    const world = marchable();
    world.storyteller.raidActive = true;
    const plan = planCampaign(world, doorway(world).id);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.text).toMatch(/raiders/i);
  });

  it('fields one army at a time and will not send it twice', () => {
    const world = marchable();
    expect(orderCampaign(world, doorway(world).id).ok).toBe(true);
    const second = planCampaign(world, doorway(world).id);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.text).toMatch(/already in the field/i);
  });

  it('will not march on ground the colony has never been past', () => {
    const world = marchable();
    const far = holdingsOf(world).find((h) => h.ring === 2)!;
    for (const s of settlementsOf(world)) s.relations = 0;
    const plan = planCampaign(world, far.id);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    // The trade road's own gate, reused rather than reinvented: a colony that has
    // not dealt with a ring has no idea what is behind it.
    expect(plan.text).toContain(far.name);
  });

  it('refuses ground the colony is already standing on', () => {
    const world = marchable();
    const h = doorway(world);
    h.held = true;
    const plan = planCampaign(world, h.id);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.text).toContain(h.name);
    expect(planCampaign(world, 999).ok).toBe(false);
  });

  it('sends the ones with the guns', () => {
    const world = marchable(SEED, 3);
    const all = livingColonists(world);
    for (const p of all) p.weapon = 'none';
    const armed = all.slice(0, WAR_PARTY);
    for (const p of armed) p.weapon = 'rifle';
    const plan = planCampaign(world, doorway(world).id);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Fit to fight before fit to walk, because a war party is the one errand
    // where who goes is a decision the colony would actually make that way. The
    // panel leans on this: it names the three who would go before the player
    // commits to anything.
    expect(plan.party).toHaveLength(WAR_PARTY);
    expect(plan.party.map((p) => p.id).sort()).toEqual(armed.map((p) => p.id).sort());
  });
});

describe('a march called off before it starts', () => {
  it('books the whole round trip the moment it says go', () => {
    const world = marchable();
    const h = doorway(world);
    expect(orderCampaign(world, h.id).ok).toBe(true);
    // Booked at the muster and not at the homecoming, which is the difference
    // between `no-holding-falls-for-free` measuring what a holding cost and it
    // reading every holding as free for the days between taking it and standing
    // down. Three settlers, there and back.
    expect(world.stats.campaigns).toBe(1);
    expect(world.stats.warPawnDays).toBe(WAR_PARTY * roundTripDays(h.ring));
    expect(world.stats.holdingsTaken ?? 0).toBe(0);
    expect(warPartyOf(world)?.phase).toBe('mustering');
    // A party still crossing its own yard is not yet away, so there is no
    // homecoming to count down to.
    expect(warDaysLeft(world)).toBe(0);
    expect(world.jobs.filter((j) => j.kind === 'campaign')).toHaveLength(WAR_PARTY);
  });

  it('puts everybody back when the valley is attacked mid-muster', () => {
    const world = marchable();
    const before = livingColonists(world).length;
    expect(orderCampaign(world, doorway(world).id).ok).toBe(true);
    // Two at the treeline, one still walking — the state that has to survive
    // being cancelled, because a party half off the map is the one thing nothing
    // else in the sim knows how to read.
    const plan = planCampaign(world, doorway(world).id);
    expect(plan.ok).toBe(false);
    const walking = world.war!.pawns;
    expect(walking).toHaveLength(0);
    joinWarParty(world, livingColonists(world)[0]!);
    expect(world.war!.pawns).toHaveLength(1);
    expect(livingColonists(world)).toHaveLength(before - 1);

    world.storyteller.raidActive = true;
    tickWar(world);
    expect(world.war).toBe(null);
    expect(livingColonists(world)).toHaveLength(before);
    // The jobs go with the party. A `campaign` job outliving the muster would
    // walk somebody to the treeline to join nobody.
    expect(world.jobs.filter((j) => j.kind === 'campaign')).toHaveLength(0);
    expect(new Set(world.pawns.map((p) => p.id)).size).toBe(world.pawns.length);
  });

  it('gives up on a muster that never fills', () => {
    const world = marchable();
    const before = livingColonists(world).length;
    expect(orderCampaign(world, doorway(world).id).ok).toBe(true);
    joinWarParty(world, livingColonists(world)[0]!);
    // A day at the edge is all the colony will wait for three people to turn up.
    world.tick = world.war!.dueTick;
    tickWar(world);
    expect(world.war).toBe(null);
    expect(livingColonists(world)).toHaveLength(before);
    // And the ground is untouched: a muster that never left is not an attempt.
    expect(doorway(world).attempts).toBe(0);
    expect(world.stats.holdingsTaken ?? 0).toBe(0);
  });

  it('leaves on the third settler and not before', () => {
    const world = marchable();
    const h = doorway(world);
    expect(orderCampaign(world, h.id).ok).toBe(true);
    for (let i = 0; i < WAR_PARTY; i++) {
      expect(world.war!.phase).toBe('mustering');
      joinWarParty(world, livingColonists(world)[0]!);
    }
    expect(world.war!.phase).toBe('outbound');
    // Half a round trip out, the same walk the caravans take to that ring.
    const legDays = (world.war!.dueTick - world.tick) / TICKS_PER_DAY;
    expect(legDays).toBeCloseTo(roundTripDays(h.ring) / 2, 3);
    expect(warDaysLeft(world)).toBeCloseTo(legDays, 3);
    // Off the map entirely — nothing can path to them, feed them or shoot them.
    expect(world.war!.pawns).toHaveLength(WAR_PARTY);
    for (const away of world.war!.pawns) {
      expect(world.pawns.some((p) => p.id === away.id)).toBe(false);
    }
  });

  it('carries a party in the field through a save and back', () => {
    const world = marchable();
    const h = doorway(world);
    expect(orderCampaign(world, h.id).ok).toBe(true);
    for (let i = 0; i < WAR_PARTY; i++) joinWarParty(world, livingColonists(world)[0]!);
    const away = world.war!.pawns.map((p) => p.id);
    const home = livingColonists(world).length;

    const r = deserialize(serialize(world, VIEW, 1, 1_700_000_000_000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const loaded = r.save.world;
    expect(loaded.war?.phase).toBe('outbound');
    expect(loaded.war?.pawns.map((p) => p.id)).toEqual(away);
    expect(loaded.war?.dueTick).toBe(world.war!.dueTick);
    expect(livingColonists(loaded)).toHaveLength(home);
    // The failure this is really watching for: a settler who exists twice. The
    // load's backfills walk `world.pawns`, and the three on the moor are not in
    // it — a backfill that "fixed" them by pushing them back would hand the
    // colony three copies the moment the party came home.
    for (const id of away) expect(loaded.pawns.some((p) => p.id === id)).toBe(false);
    expect(new Set(loaded.pawns.map((p) => p.id)).size).toBe(loaded.pawns.length);
  });
});

// ---------------------------------------------------------------------------
// the bill
// ---------------------------------------------------------------------------

describe('the assault', () => {
  it('takes the ground when the party is the better armed side', () => {
    const world = marchable();
    const h = doorway(world);
    const party = livingColonists(world).slice(0, WAR_PARTY);
    arm(party, 'rifle', 20);
    atTheWalls(world, h, party);
    tickWar(world);

    expect(h.held).toBe(true);
    expect(h.attempts).toBe(1);
    expect(world.stats.holdingsTaken).toBe(1);
    expect(heldCount(world)).toBe(1);
    // Every man in the garrison, because standing on it is the win condition and
    // a holding with one defender left in it is not taken.
    expect(world.stats.raidersKilled).toBe(garrisonSize(h.ring));
    // The price of the war is the war: taking ground counts as a clean campaign
    // on the streak the storyteller was already keeping, so what comes over the
    // treeline next is worse. One dial, not two.
    expect(world.storyteller.unbloodied).toBe(1);
    // And the first delivery is a full cadence away, not waiting on the doorstep.
    expect(h.takenTick).toBe(world.tick);
    expect(h.dueTick).toBe(world.tick + tributeTicks(h));
    expect(world.war!.phase).toBe('inbound');
  });

  it('throws back a party that came with clubs', () => {
    const world = marchable();
    const h = holdingsOf(world).find((o) => o.ring === 2)!;
    const party = livingColonists(world).slice(0, WAR_PARTY);
    arm(party, 'club', 0, 0.65);
    atTheWalls(world, h, party);
    tickWar(world);

    expect(h.held).toBe(false);
    expect(h.attempts).toBe(1);
    expect(world.stats.holdingsTaken ?? 0).toBe(0);
    expect(heldCount(world)).toBe(0);
    // A club counts for the share of the fight it can reach and no more. Off-map
    // there are no cells to close, so the range difference is paid as a fraction
    // of the exchange — which is what makes "we have three bodies" not an answer
    // to "they have four rifles".
    expect(world.war!.won).toBe(false);
    expect(world.war!.phase).toBe('inbound');
  });

  it('brings the beaten party home wrecked and alive', () => {
    const world = marchable();
    const h = holdingsOf(world).find((o) => o.ring === 2)!;
    const party = livingColonists(world).slice(0, WAR_PARTY);
    arm(party, 'club', 0, 0.65);
    const ids = party.map((p) => p.id);
    atTheWalls(world, h, party);
    tickWar(world);
    // Nobody dies off-screen. The rule `settlements.ts` states and a war is
    // exactly where a reader would expect the exception — so this is the test
    // that says the exception was not taken. Three settlers ruined for a week is
    // a story the game can tell; a funeral for dice nobody watched is not.
    for (const p of world.war!.pawns) {
      expect(p.hp).toBeGreaterThan(p.maxHp * DOWNED);
      expect(p.downed).toBeFalsy();
    }
    world.tick = world.war!.dueTick;
    tickWar(world);
    expect(world.war).toBe(null);
    for (const id of ids) {
      const back = world.pawns.find((p) => p.id === id);
      expect(back).toBeTruthy();
      // On their feet, hungry and tired and off whatever they were doing a week
      // ago — the homecoming does not have to reproduce bleeding, rescue and a
      // doctor's queue for bodies that were never on the map to be carried.
      expect(back!.downed).toBeFalsy();
      expect(back!.jobId).toBe(null);
      expect(back!.drafted).toBe(false);
    }
    expect(new Set(world.pawns.map((p) => p.id)).size).toBe(world.pawns.length);
  });

  it('deals the next card to a colony that comes back for a second try', () => {
    // A holding is not a fresh copy of itself. `attempts` salts the dice, exactly
    // as the trade road's mishaps do, so a colony that was thrown back is trying
    // the place again rather than re-rolling the same afternoon until it wins.
    const outcomes = new Set<string>();
    for (let attempt = 0; attempt < 4; attempt++) {
      const world = marchable();
      const h = holdingsOf(world).find((o) => o.ring === 1)!;
      h.attempts = attempt;
      const party = livingColonists(world).slice(0, WAR_PARTY);
      arm(party, 'club', 4, 0.9);
      atTheWalls(world, h, party);
      tickWar(world);
      outcomes.add(`${world.war!.won ? 'w' : 'l'}:${world.war!.killed}`);
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('sends a cart down off the moor on the cadence the holding was taken with', () => {
    const world = marchable();
    const h = doorway(world);
    const steel = countResource(world, 'steel');
    h.held = true;
    h.dueTick = world.tick;
    tickWar(world);
    expect(countResource(world, 'steel')).toBe(steel + tributeOf(h));
    // …and again, on the same cadence, because a holding that paid once is a
    // reward and a holding that keeps paying is a road worth walking.
    expect(h.dueTick).toBe(world.tick + tributeTicks(h));
    world.tick = h.dueTick!;
    tickWar(world);
    expect(countResource(world, 'steel')).toBe(steel + tributeOf(h) * 2);
  });

  it('is paid nothing by ground it does not hold', () => {
    const world = marchable();
    const steel = countResource(world, 'steel');
    for (const h of holdingsOf(world)) h.dueTick = world.tick;
    tickWar(world);
    expect(countResource(world, 'steel')).toBe(steel);
  });
});

// ---------------------------------------------------------------------------
// the whole road, walked
// ---------------------------------------------------------------------------

describe('a colony that actually marches', () => {
  it('musters, walks out, fights and comes home through the ordinary tick', () => {
    const world = marchable(SEED, 2);
    const h = doorway(world);
    for (const p of livingColonists(world)) p.skills.shooting = 18;
    const streams = makeStreams(world);
    const plan = planCampaign(world, h.id);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const marchers = plan.party.map((p) => p.id);
    expect(orderCampaign(world, h.id).ok).toBe(true);

    // Long enough for three settlers to cross the yard, walk to the moor, storm a
    // holding and walk back — with slack, because the route out goes round the
    // lake on some seeds and a fixed tick count is a test that fails on the map
    // rather than on the code.
    const ceiling = Math.round(roundTripDays(h.ring) * TICKS_PER_DAY * 1.5);
    let away = false;
    for (let t = 0; t < ceiling && world.war; t += 60) {
      stepWorldN(world, streams, 60);
      if (world.war?.phase === 'outbound' || world.war?.phase === 'inbound') away = true;
    }
    // The party genuinely left. If this fails the march never got past the yard,
    // and everything below would pass for the wrong reason.
    expect(away).toBe(true);
    expect(world.war).toBe(null);
    expect(h.attempts).toBe(1);
    expect(world.stats.campaigns).toBe(1);
    // Everybody who went is back on the map, once each. Counted by name rather
    // than by headcount because the trade road is running too — a colony this
    // size sends caravans out on its own, and a settler who is off selling wood
    // is not a settler the war lost.
    for (const id of marchers) {
      expect(world.pawns.filter((p) => p.id === id)).toHaveLength(1);
      expect(world.pawns.find((p) => p.id === id)!.dead).toBeFalsy();
    }
    expect(new Set(world.pawns.map((p) => p.id)).size).toBe(world.pawns.length);
    // Seven rifles against two, and the doorway falls — which is the promise the
    // near holding makes to a colony that got its house in order first.
    expect(h.held).toBe(true);
    expect(heldCount(world)).toBe(1);
    expect(holdingById(world, h.id)?.held).toBe(true);

    // And then it pays, without anybody being sent to collect.
    //
    // Watched for the cart rather than measured off the steel pile. The pile is
    // not the payment: a colony whose board is moving spends steel on whatever
    // frame is standing while the cart is still coming down off the moor, and a
    // pile that is no bigger afterwards then reads as a holding that never paid.
    // Measured here, ninety-three steel before and ninety-three after, with a
    // cart in the log in between and a turret frame drinking the difference.
    const due = h.dueTick!;
    let paid = false;
    for (let t = world.tick; t < due + 60; t += 60) {
      stepWorldN(world, streams, 60);
      paid ||= world.messages.some((m) => /comes down off the moor/i.test(m.text));
    }
    expect(paid).toBe(true);
    // And the next cart is already on the books, which is the line that makes it
    // a tribute rather than a one-off.
    expect(h.dueTick).toBeGreaterThan(due);
  });
});
