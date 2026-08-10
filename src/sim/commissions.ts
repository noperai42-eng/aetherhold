/**
 * The neighbours ask for something back.
 *
 * `settlements.ts` gave the colony a road it could choose to walk. This is the
 * other half of a relationship: somebody over the ridge is short of something,
 * they know the colony has it, and they have sent word. It exists because of a
 * gap in the mid-game — once the walls are up and the granary is deep, the road
 * is a thing the player *may* use rather than a thing the world ever asks for,
 * and a neighbour who only ever stands at a counter is not a neighbour.
 *
 * Three rules it is built on, all of them the difference between a commission
 * and a chore:
 *
 * - **It asks for exactly one pack.** The amount is the pack size the road panel
 *   already ships, so answering is one click on a row that is already there and
 *   nobody has to do arithmetic to find out whether they can.
 * - **It never asks for what the colony has not got.** A letter that cannot be
 *   answered is not a decision, it is a scolding. Nobody writes unless the
 *   colony is already most of the way to the pack.
 * - **It cannot be farmed.** The bonus tops the deal up to `RATE_CAP` and stops
 *   there — the same ceiling every other quote in the game is clamped to — so
 *   the whole no-arbitrage promise in `settlements.ts` survives untouched. What
 *   a commission actually pays is *standing*, and standing is the one thing on
 *   this map that no amount of hauling will buy.
 *
 * Import direction is one-way on purpose: this file reads `settlements.ts` and
 * `settlements.ts` has never heard of it. That is why fulfilment is detected
 * from the caravan's own `dealtTick` rather than by reaching into `tickCaravan`
 * — see the note on `tickCommissions`.
 */

import { Rng } from './rng';
import {
  PACK_SIZES,
  RATE_CAP,
  RELATIONS_MAX,
  VALUE,
  legTicks,
  rateOf,
  settlementById,
  settlementsOf,
  withinRange,
} from './settlements';
import { gainSkill } from './skills';
import { TICKS_PER_DAY } from './types';
import type { Commission, ResourceKind, Settlement, World } from './types';
import { countResource, livingColonists, msg } from './world';

/**
 * How often anybody thinks to write, in ticks.
 *
 * A day and a half, and most windows pass in silence because the conditions
 * below rarely all hold at once. Stateless on purpose — the cadence is read off
 * the world clock rather than stored in a countdown, so there is no new field to
 * migrate and a save cannot come back holding a timer that never fires.
 */
export const COMMISSION_EVERY = Math.round(TICKS_PER_DAY * 1.5);

/**
 * Days on top of the walk.
 *
 * The deadline is the road out plus this, never the round trip: they want the
 * goods, not the courier home. Two days is enough to finish what is on the
 * bench and load up, and short enough that a three-day town is a real
 * commitment rather than something to get round to.
 */
export const COMMISSION_SLACK = Math.round(TICKS_PER_DAY * 2);

/**
 * The smallest colony anybody asks.
 *
 * The same floor `caravanAllowed` uses, and for the same reason: a colony of
 * three that sends one away is a colony of two, so asking one is asking it to
 * choose between the letter and the wall.
 */
export const COMMISSION_MIN_COLONISTS = 4;

/**
 * How much of the pack the colony must already have before anybody writes.
 *
 * Well short of the whole thing — the point is a stretch, not a formality — but
 * far enough along that the answer is a decision about priorities rather than a
 * fortnight of mining.
 */
const COMMISSION_HAVE = 0.35;

/** Standing for answering one. Three ordinary visits' worth. */
export const RELATIONS_PER_COMMISSION = 18;

/**
 * Standing lost when the clock runs out.
 *
 * Deliberately smaller than a single visit's gain: nobody agreed to anything,
 * and a game that punishes a player for a letter they were never asked to open
 * teaches them to dread the panel. It is disappointment, not betrayal.
 */
export const RELATIONS_PER_LAPSE = 4;

/** Extra social for the traveller who answered one. On top of the trip's own. */
export const SOCIAL_PER_COMMISSION = 0.7;

/**
 * Why they are short, by what they are short of.
 *
 * Flavour, and load-bearing flavour: "Ashfen needs 70 rawfood" is a fetch
 * quest, "Ashfen's seed store came up mouldy and they are eating next spring's
 * grain" is a place with a bad year. One is a number, the other is somewhere
 * that exists when the player is not looking at it.
 */
const REASONS: Record<ResourceKind, string[]> = {
  wood: [
    'a winter storm took the roof off half their row',
    'their coppice came up blighted and they are burning furniture',
    'the sawpit flooded and everything in it is green',
  ],
  steel: [
    'their smith cracked the anvil and there is nothing to draw new tools from',
    'a raid stripped the forge and they are farming with wooden blades',
    'the seam they were cutting ran out into dead rock',
  ],
  rawfood: [
    'their seed store came up mouldy and they are eating next spring’s grain',
    'a blight went through the long field and took two thirds of it',
    'the river shifted and the low plots are under a foot of silt',
  ],
  meal: [
    'both their cooks are down with the same fever',
    'they have taken in refugees they cannot feed',
    'the kitchen burned and they are eating raw grain',
  ],
  medicine: [
    'a fever went through the children and the shelf is bare',
    'their herbalist died in the spring and nobody was taught',
    'a mine collapse left nine hurt and nothing to dress them with',
  ],
  hide: [
    'the herds moved off their range and the tannery has stopped',
    'they have thirty people and eleven coats going into the cold',
    'rot got into the store and every skin in it went green',
  ],
};

/**
 * A letter's own dice, seeded off the map and the tick it was written.
 *
 * The same argument as `caravanRng` and `grantRng`: any draw from a shared
 * stream re-rolls every storyteller roll after it, so a system that turns up
 * once a day would quietly re-tune every seed in the test suite. Two letters
 * cannot be written on the same tick, so the tick is a sufficient salt.
 */
function letterRng(world: World, tick: number): Rng {
  let h = (0x811c9dc5 ^ world.seed) >>> 0;
  h = Math.imul(h ^ tick, 0x01000193) >>> 0;
  h = Math.imul(h ^ (tick >>> 13), 0x01000193) >>> 0;
  return new Rng(h >>> 0);
}

/** The open request, or null. Backfills nothing — no letter is a valid state. */
export function commissionOf(world: World): Commission | null {
  return world.commission ?? null;
}

/** Days left on the clock, for the panel. Negative never shows: it lapses first. */
export function commissionDaysLeft(world: World, com: Commission): number {
  return Math.max(0, (com.dueTick - world.tick) / TICKS_PER_DAY);
}

/**
 * Does this pack, walked to this place, settle the open request?
 *
 * Exported because the road panel marks the matching row before the player
 * commits — a commission the player has to cross-reference by hand against four
 * towns and six pack sizes is a puzzle about the interface rather than about the
 * colony.
 */
export function satisfies(
  com: Commission | null,
  settlementId: number,
  give: { kind: ResourceKind; amount: number },
): boolean {
  if (!com) return false;
  return (
    com.settlementId === settlementId && give.kind === com.kind && give.amount >= com.amount
  );
}

/**
 * What they add on top for answering when it mattered.
 *
 * The whole payment — the ordinary quote plus this — comes out at exactly
 * `RATE_CAP`, which is the ceiling `settlements.ts` clamps every quote to and
 * the one number the no-loop guarantee actually rests on. So the bonus is
 * biggest for a colony nobody knows, which is when a good price changes what is
 * possible, and fades to nothing for one that is already everybody's best
 * friend — by which point the standing is what they came for anyway.
 */
export function commissionBonus(
  s: Settlement,
  social: number,
  give: { kind: ResourceKind; amount: number },
): number {
  const gap = Math.max(0, RATE_CAP - rateOf(s, social, give.kind));
  const worth = VALUE[give.kind] * give.amount * gap;
  return Math.max(0, Math.floor(worth / VALUE[s.sells]));
}

/**
 * What the colony keeps back no matter who is asking.
 *
 * Only the *autonomous* foreman consults this. A player who wants to send the
 * last of the meals to Ashfen has decided that, and the game's business is to
 * let them find out — but a colony answering its post unsupervised must never
 * walk its own winter over the ridge to be liked. Set at roughly a fortnight of
 * the thing, which is the horizon at which a shortfall is a problem the colony
 * can still solve.
 */
const COMMISSION_KEEP: Record<ResourceKind, number> = {
  wood: 60,
  steel: 40,
  rawfood: 90,
  meal: 40,
  medicine: 10,
  hide: 20,
};

/**
 * The pack that answers the open letter, if the colony can spare it.
 *
 * Returns null when there is no letter, when the goods are not there, or when
 * sending them would cut into the reserve above — in which case the foreman
 * falls through to its ordinary surplus run and the letter simply lapses. That
 * is the honest outcome: a colony that cannot afford a favour has not failed at
 * anything, and the standing it loses is smaller than one visit's worth.
 */
export function answerable(
  world: World,
): { settlementId: number; kind: ResourceKind; amount: number } | null {
  const com = world.commission ?? null;
  if (!com) return null;
  if (world.tick > com.dueTick) return null;
  if (countResource(world, com.kind) < com.amount + COMMISSION_KEEP[com.kind]) return null;
  return { settlementId: com.settlementId, kind: com.kind, amount: com.amount };
}

/**
 * Is there anybody worth writing to, and about what?
 *
 * Ranked rather than rolled among the ones that qualify: the town that is
 * furthest along the colony's ability to help is the one whose letter is a
 * decision rather than a shrug. The dice pick the flavour, not the target,
 * which keeps the same colony on the same seed getting the same letter.
 */
function pickRequest(world: World): { s: Settlement; kind: ResourceKind } | null {
  let best: { s: Settlement; kind: ResourceKind } | null = null;
  let bestShare = COMMISSION_HAVE;
  for (const s of settlementsOf(world)) {
    // A place the colony cannot get to does not write to it. Partly because a
    // stranger ten days out who has never met anybody from the valley has no
    // reason to, and partly because the alternative is a letter that cannot be
    // answered: it would hold the one commission slot for its whole fortnight,
    // and the foreman — which puts an open letter ahead of an ordinary surplus
    // run — would spend that fortnight declining to trade at all.
    if (!withinRange(world, s).ok) continue;
    const kind = s.buys;
    const want = PACK_SIZES[kind];
    if (want <= 0) continue;
    const share = countResource(world, kind) / want;
    // Already sitting on several packs of it: they would be asking for something
    // the colony would throw at them unprompted, which is not a favour.
    if (share > 3) continue;
    if (share <= bestShare) continue;
    best = { s, kind };
    bestShare = share;
  }
  return best;
}

/**
 * One pass of the post.
 *
 * Runs immediately after `tickCaravan`, and that ordering is the contract this
 * file is built on: a deal struck on the road sets `dealtTick` to the current
 * tick, and this reads it on the same tick and settles up. The alternative was
 * to have `settlements.ts` call in here, which would close an import cycle
 * between the two — see the note at the top.
 */
export function tickCommissions(world: World): void {
  if (world.gameOver) return;

  const com = world.commission ?? null;
  if (com) {
    settleOrLapse(world, com);
    return;
  }
  if (world.tick % COMMISSION_EVERY !== 0) return;
  if (livingColonists(world).length < COMMISSION_MIN_COLONISTS) return;
  // Not while the yard is full of raiders. Word arriving mid-siege is a message
  // the player will scroll past, and the clock would be running through the one
  // stretch of the game where nobody can be spared for anything.
  if (world.storyteller.raidActive) return;
  const pick = pickRequest(world);
  if (!pick) return;

  const rng = letterRng(world, world.tick);
  const reasons = REASONS[pick.kind];
  const reason = reasons[rng.int(reasons.length)] ?? 'they are short and they are asking';
  const amount = PACK_SIZES[pick.kind];
  world.commission = {
    settlementId: pick.s.id,
    kind: pick.kind,
    amount,
    reason,
    postedTick: world.tick,
    dueTick: world.tick + legTicks(pick.s) + COMMISSION_SLACK,
  };
  const days = (legTicks(pick.s) + COMMISSION_SLACK) / TICKS_PER_DAY;
  msg(
    world,
    `A runner comes in from ${pick.s.name}: ${reason}. They are asking for ${amount} ${pick.kind}, ` +
      `walked to their door inside ${days.toFixed(0)} days.`,
    'info',
    { headline: true },
  );
}

/** Pay it off if the pack got there, drop it if the clock ran out. */
function settleOrLapse(world: World, com: Commission): void {
  const s = settlementById(world, com.settlementId);
  if (!s) {
    world.commission = null;
    return;
  }

  const c = world.caravan ?? null;
  if (c && c.dealtTick === world.tick && satisfies(com, c.settlementId, c.give) && c.take) {
    const bonus = commissionBonus(s, c.pawn.skills?.social ?? 0, c.give);
    c.take.amount += bonus;
    s.relations = Math.min(RELATIONS_MAX, s.relations + RELATIONS_PER_COMMISSION);
    gainSkill(world, c.pawn, 'social', SOCIAL_PER_COMMISSION);
    world.stats.commissions = (world.stats.commissions ?? 0) + 1;
    world.commission = null;
    msg(
      world,
      bonus > 0
        ? `${s.name} has what it needed. They add ${bonus} ${c.take.kind} on top and will not forget who walked it.`
        : `${s.name} has what it needed. There is nothing they can add to the price that would say it.`,
      'good',
      { headline: true },
    );
    return;
  }

  if (world.tick <= com.dueTick) return;
  // Somebody is on the road with the right pack: the clock stops when they can
  // see them coming over the ridge. Anything else is a colony punished for the
  // length of a walk it was told to make.
  if (c && c.phase === 'outbound' && satisfies(com, c.settlementId, c.give)) return;

  s.relations = Math.max(-100, s.relations - RELATIONS_PER_LAPSE);
  world.commission = null;
  msg(world, `${s.name} stopped waiting on the ${com.kind}. They made do.`, 'bad');
}
