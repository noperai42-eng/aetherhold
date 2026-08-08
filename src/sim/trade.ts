/**
 * The trader.
 *
 * Every few days a pedlar walks in from the treeline, stands in the yard for
 * half a day with a string of pack-beasts, and offers a handful of straight
 * swaps: so much steel for so much medicine, wood for food, coin-in-kind for a
 * pair of hands. Then they leave.
 *
 * This exists because the thirty-day sweeps all end the same way — every project
 * researched by day twenty-one, every turret built, and four to six hundred
 * steel sitting in the yard with nothing on the board that wants it. A colony
 * that has won has nothing left to decide, and a game with nothing left to
 * decide is over whether or not the settlers are still walking about. Trade
 * turns a surplus back into a choice.
 *
 * Two rules the deals are built to keep:
 *
 * - No loop. Every swap loses value in one direction, so there is no sequence of
 *   trades that makes something out of nothing. Per-visit variation scales both
 *   halves of a deal together, which means the ratio — the only thing that could
 *   open a loop — never moves.
 * - Nothing here needs a new behaviour bolted onto the colony. A trade puts the
 *   goods on the ground at the trader's feet, and the haulers who were going to
 *   fetch them anyway fetch them.
 */

import { addItem, countResource, livingColonists, msg, nextId, takeResource } from './world';
import { findPath } from './path';
import { nearestWalkable } from './grid';
import { makePawn } from './pawn';
import { Rng } from './rng';
import { TICKS_PER_DAY } from './types';
import type { Pawn, ResourceKind, TradeOffer, TradeState, World } from './types';
import { remember } from './lifelog';

/** First caravan. Late enough that the colony has something to trade with. */
const FIRST_VISIT = Math.round(TICKS_PER_DAY * 4);
/** Between caravans. */
export const VISIT_GAP = Math.round(TICKS_PER_DAY * 5);
/** How long they wait around once they arrive. */
export const STAY = Math.round(TICKS_PER_DAY * 0.45);
/** Warning before they pack up, so a player who was mid-decision gets told. */
const LEAVING_WARN = Math.round(TICKS_PER_DAY * 0.1);
/** A caravan will not walk into a colony this big to sell it a labourer. */
export const HIRE_CAP = 8;
/** Steel for a hired hand. About three days of a good colony's mining. */
export const HIRE_STEEL = 150;
/** Offers on the board per visit. */
export const OFFER_COUNT = 4;

/**
 * The deal book.
 *
 * Read each row as "the colony gives the first, gets the second". The margins
 * are wide on purpose — a trader who deals at cost is a vending machine, and
 * the point of the wide margin is that hauling your own ore is still the better
 * plan, with trade for the thing you cannot make fast enough.
 *
 * Exported for one reason: `settlements.ts` prices the trade *road* off a value
 * table (`VALUE`), and the promise both systems make together is that no
 * sequence of deals across either of them turns steel into more steel. That
 * promise is only checkable if the test can see this book, so it can — see
 * `tests/settlements.test.ts`.
 */
export const DEALS: Array<{ give: ResourceKind; giveAmount: number; take: ResourceKind; takeAmount: number }> = [
  { give: 'steel', giveAmount: 60, take: 'medicine', takeAmount: 8 },
  { give: 'steel', giveAmount: 45, take: 'rawfood', takeAmount: 60 },
  { give: 'steel', giveAmount: 70, take: 'wood', takeAmount: 120 },
  { give: 'wood', giveAmount: 80, take: 'steel', takeAmount: 40 },
  { give: 'wood', giveAmount: 60, take: 'meal', takeAmount: 20 },
  { give: 'rawfood', giveAmount: 90, take: 'medicine', takeAmount: 6 },
  { give: 'medicine', giveAmount: 10, take: 'steel', takeAmount: 60 },
  { give: 'rawfood', giveAmount: 70, take: 'wood', takeAmount: 90 },
];

export function tradeState(world: World): TradeState {
  if (!world.trade) {
    world.trade = { nextVisit: FIRST_VISIT, traderId: null, leaveAt: 0, offers: [], visits: 0 };
  }
  return world.trade;
}

/**
 * How soon a summoned caravan turns up. Long enough to be a walk, not a spawn.
 *
 * A pack train that materialises in the yard the instant a milestone lands reads
 * as a cheat code. Most of a day out means the player hears that one is coming,
 * has time to decide what they are willing to part with, and sees it arrive the
 * way every other caravan arrives.
 */
export const SUMMONED_VISIT = Math.round(TICKS_PER_DAY * 0.4);

/**
 * Bring the next pack train forward, because word has got around.
 *
 * Deliberately not an *extra* caravan: it moves the clock on the visit that was
 * already coming. Conjuring a second trader would put two stalls in the yard the
 * first time two milestones landed near each other, and would make the reward
 * something a colony could farm rather than something it earned once.
 *
 * Returns false when there is already somebody at the stall, or when the one on
 * the road is closer than this would put them — in both cases there is nothing
 * to give, and the caller sends nothing rather than lying about it.
 */
export function summonCaravan(world: World): boolean {
  if (currentTrader(world)) return false;
  const st = tradeState(world);
  if (st.nextVisit <= SUMMONED_VISIT) return false;
  st.nextVisit = SUMMONED_VISIT;
  msg(
    world,
    'Word of what the colony has banked is out. A pack train is already on the road.',
    'good',
    { headline: true },
  );
  return true;
}

/** The trader currently in the yard, if there is one. */
export function currentTrader(world: World): Pawn | null {
  const st = world.trade;
  if (!st || st.traderId === null) return null;
  const p = world.pawns.find((q) => q.id === st.traderId);
  return p && !p.dead ? p : null;
}

/**
 * A caravan's own dice.
 *
 * Deliberately not one of the three shared streams. Every draw from those
 * shifts the weather, the storyteller and the herds for the rest of the run, so
 * adding a system to them re-rolls every seed the balance sweeps are tuned
 * against. Seeded off the map and the visit number instead: the same colony
 * always meets the same traders, and nothing else in the sim moves.
 */
function caravanRng(world: World, visit: number): Rng {
  return new Rng((world.seed ^ ((visit + 1) * 0x9e3779b9)) >>> 0);
}

function rollOffers(world: World, rng: Rng): TradeOffer[] {
  const pool = [...DEALS];
  const offers: TradeOffer[] = [];
  for (let i = 0; i < OFFER_COUNT && pool.length > 0; i++) {
    const deal = pool.splice(rng.int(pool.length), 1)[0]!;
    // One scale for both halves: the caravan is bigger or smaller this week, but
    // the rate it deals at is fixed, so no combination of visits is a loop.
    const scale = 0.8 + rng.int(6) * 0.1;
    offers.push({
      id: nextId(world),
      give: { kind: deal.give, amount: Math.round(deal.giveAmount * scale) },
      take: { kind: deal.take, amount: Math.round(deal.takeAmount * scale) },
      taken: false,
    });
  }
  if (livingColonists(world).length < HIRE_CAP) {
    offers.push({
      id: nextId(world),
      give: { kind: 'steel', amount: HIRE_STEEL },
      take: { hire: true },
      taken: false,
    });
  }
  return offers;
}

/** Where the caravan stands: beside the colony, not inside anybody's bedroom. */
function stallSpot(world: World, rng: Rng): { x: number; y: number } | null {
  const anchor = livingColonists(world)[0];
  if (!anchor) return null;
  const hx = Math.round(anchor.x);
  const hy = Math.round(anchor.y);
  for (let attempt = 0; attempt < 12; attempt++) {
    const ang = rng.range(0, Math.PI * 2);
    const r = 5 + rng.int(4);
    const spot = nearestWalkable(world, Math.round(hx + Math.cos(ang) * r), Math.round(hy + Math.sin(ang) * r), 6);
    if (!spot) continue;
    // Reachable both ways: a caravan the haulers cannot walk to is a panel that
    // takes goods and gives nothing back you can pick up.
    if (findPath(world, spot.x, spot.y, hx, hy) === null) continue;
    return spot;
  }
  return null;
}

function arrive(world: World, st: TradeState): void {
  const rng = caravanRng(world, st.visits);
  const spot = stallSpot(world, rng);
  if (!spot) {
    // Nowhere to stand. Try again in a day rather than skipping the visit.
    st.nextVisit = TICKS_PER_DAY;
    return;
  }
  const p = makePawn(world, rng, 'trader', spot.x, spot.y, { weapon: 'club' });
  st.traderId = p.id;
  st.leaveAt = world.tick + STAY;
  st.offers = rollOffers(world, rng);
  st.visits++;
  p.activity = 'idle';
  msg(world, `${p.name} walks in with a pack train and lays out goods. Press M to trade.`, 'good', {
    at: spot,
    headline: true,
  });
}

function depart(world: World, st: TradeState, why: string): void {
  const trader = currentTrader(world);
  if (trader) {
    world.pawns = world.pawns.filter((p) => p.id !== trader.id);
    msg(world, `${trader.name} ${why}`, 'info');
  }
  st.traderId = null;
  st.offers = [];
  st.nextVisit = VISIT_GAP;
}

/**
 * One tick of the caravan.
 *
 * Kept out of `tickCombat`'s pawn loop entirely — a trader is the one body on
 * the map that neither fights nor takes jobs, and giving it its own pass is
 * cheaper than teaching two other passes to skip it.
 */
export function tickTrade(world: World, playerPawnId: number | null): void {
  const st = tradeState(world);
  const trader = currentTrader(world);

  if (trader) {
    // Killed in a raid, or standing in a colony that has fallen: the caravan is
    // over either way.
    if (world.gameOver || livingColonists(world).length === 0) {
      depart(world, st, 'sees how it is here and does not stay.');
      return;
    }
    if (world.tick === st.leaveAt - LEAVING_WARN) {
      msg(world, `${trader.name} starts loading the pack train. Trade now or not at all.`, 'info');
    }
    if (world.tick >= st.leaveAt) {
      depart(world, st, 'shoulders the packs and walks back into the trees.');
      return;
    }
    // Faces whoever is nearest, so the stall reads as attended rather than as a
    // statue somebody left in the yard.
    const near = nearestColonist(world, trader, playerPawnId);
    if (near) trader.facing = Math.atan2(near.y - trader.y, near.x - trader.x);
    return;
  }

  st.nextVisit--;
  if (st.nextVisit > 0) return;
  st.nextVisit = VISIT_GAP;
  // Not into a firefight and not into a wipe.
  if (world.gameOver || livingColonists(world).length === 0) return;
  if (world.pawns.some((p) => p.faction === 'raider' && !p.dead && !p.downed)) return;
  arrive(world, st);
}

function nearestColonist(world: World, from: Pawn, playerPawnId: number | null): Pawn | null {
  let best: Pawn | null = null;
  let bestD = 64;
  for (const p of world.pawns) {
    if (p.faction !== 'colony' || p.dead) continue;
    const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
    if (d < bestD) {
      best = p;
      bestD = d;
    }
    if (p.id === playerPawnId && d < 100) return p;
  }
  return best;
}

export type TradeResult = { ok: true; text: string } | { ok: false; text: string };

/**
 * Take a deal.
 *
 * Everything is checked here rather than in the panel, because the panel is one
 * caller and the sim is the thing that has to stay honest — a trade the HUD
 * thought was affordable a frame ago must still fail cleanly.
 */
export function acceptOffer(world: World, offerId: number): TradeResult {
  const st = tradeState(world);
  const trader = currentTrader(world);
  if (!trader) return { ok: false, text: 'There is nobody here to trade with.' };
  const offer = st.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, text: 'That deal is not on the board.' };
  if (offer.taken) return { ok: false, text: 'That deal has already been struck.' };

  const stock = countResource(world, offer.give.kind);
  if (stock < offer.give.amount) {
    return { ok: false, text: `Not enough ${offer.give.kind}: ${stock} of ${offer.give.amount}.` };
  }

  if ('hire' in offer.take && livingColonists(world).length >= HIRE_CAP) {
    return { ok: false, text: 'There is no room here for another pair of hands.' };
  }

  const paid = takeResource(world, offer.give.kind, offer.give.amount);
  if (paid < offer.give.amount) {
    // Reachable if the stock is all in a settler's arms mid-haul. Put back what
    // was taken rather than half-charging for a deal that did not happen.
    if (paid > 0) addItem(world, offer.give.kind, paid, Math.round(trader.x), Math.round(trader.y));
    return { ok: false, text: `The ${offer.give.kind} is not all to hand. Try again in a moment.` };
  }

  offer.taken = true;
  world.stats.trades = (world.stats.trades ?? 0) + 1;
  const tx = Math.round(trader.x);
  const ty = Math.round(trader.y);

  if ('hire' in offer.take) {
    const spot = nearestWalkable(world, tx, ty, 5) ?? { x: tx, y: ty };
    const rng = caravanRng(world, st.visits + offer.id);
    const hand = makePawn(world, rng, 'colony', spot.x, spot.y, { skillBias: 'mining' });
    remember(world, hand, "took the caravan's coin and stayed");
    msg(world, `${hand.name} takes the coin and stays. That is ${livingColonists(world).length} of you now.`, 'good');
    return { ok: true, text: `${hand.name} joins the colony.` };
  }

  if (offer.take.kind === 'rawfood') {
    world.stats.rawGathered = (world.stats.rawGathered ?? 0) + offer.take.amount;
  }
  addItem(world, offer.take.kind, offer.take.amount, tx, ty);
  msg(
    world,
    `Traded ${offer.give.amount} ${offer.give.kind} for ${offer.take.amount} ${offer.take.kind}. It is stacked by the pack train.`,
    'good',
  );
  return { ok: true, text: 'Done.' };
}

/** Ticks until the caravan packs up, for the panel's countdown. */
export function ticksLeft(world: World): number {
  const st = world.trade;
  if (!st || st.traderId === null) return 0;
  return Math.max(0, st.leaveAt - world.tick);
}
