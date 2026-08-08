/**
 * The caravan.
 *
 * Trade is the one system in this game that can quietly destroy the economy, and
 * it can do it two ways. The obvious one is a loop — some sequence of swaps that
 * turns steel into more steel — because a colony that has found one never needs
 * to mine, farm or build again and every other system on the map becomes
 * decoration. The subtler one is a trade that spends resources a settler was
 * already holding for a job, which turns a finished blueprint into a half-built
 * wall nobody will ever complete.
 *
 * So the functional half of this file is mostly about what a trade must *not* do:
 * no arbitrage cycle at any exchange rate the caravan will ever offer, no taking
 * goods out of a settler's arms, no charging for a deal that then fails. The
 * experience half drives the real twenty-hertz loop and checks the thing a player
 * actually sees — somebody walks in, you swap steel for medicine, one of your own
 * settlers carries the medicine indoors, and the trader leaves on schedule.
 */

import { describe, expect, it } from 'vitest';

import { isHostileTo } from '../src/sim/combat';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { spawnRaid } from '../src/sim/events';
import {
  acceptOffer,
  currentTrader,
  HIRE_CAP,
  HIRE_STEEL,
  OFFER_COUNT,
  STAY,
  tickTrade,
  ticksLeft,
  tradeState,
  VISIT_GAP,
} from '../src/sim/trade';
import { addItem, countResource, hostiles, livingColonists, removeItem } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import type { ResourceKind, TradeOffer, World } from '../src/sim/types';

function colony(seed = 20260729): World {
  return createWorld(seed);
}

/** Bring a caravan in right now rather than waiting out the four-day clock. */
function summon(world: World): void {
  const st = tradeState(world);
  st.nextVisit = 1;
  tickTrade(world, null);
}

/** Send the one standing in the yard away. */
function dismiss(world: World): void {
  const st = tradeState(world);
  st.leaveAt = world.tick;
  tickTrade(world, null);
}

/** The plain goods-for-goods offers on the current board. */
function goodsOffers(world: World): Array<TradeOffer & { take: { kind: ResourceKind; amount: number } }> {
  return tradeState(world).offers.filter((o) => !('hire' in o.take)) as Array<
    TradeOffer & { take: { kind: ResourceKind; amount: number } }
  >;
}

/** Enough of `kind` on the ground to cover anything the board asks for. */
function stock(world: World, kind: ResourceKind, amount: number): void {
  for (const s of [...world.items]) if (s.kind === kind) removeItem(world, s);
  let left = amount;
  let x = 4;
  while (left > 0) {
    const put = Math.min(60, left);
    // Spread along a row so nothing collides, and out of the cabin so the stacks
    // are loose rather than reserved by a job the moment they land.
    if (addItem(world, kind, put, x, 4)) left -= put;
    x++;
    if (x > 40) break;
  }
}

describe('the deal book', () => {
  it('has no cycle that turns a resource into more of itself', () => {
    // Forty caravans is every deal in the book at every scale it varies over. A
    // loop that only opens on one rare combination of rates is still a loop, so
    // the check is over the best rate ever seen for each direction rather than
    // the average — the player would find the good week and use it.
    const world = colony();
    const best = new Map<string, number>();
    const kinds = new Set<ResourceKind>();
    for (let visit = 0; visit < 40; visit++) {
      summon(world);
      for (const o of goodsOffers(world)) {
        kinds.add(o.give.kind);
        kinds.add(o.take.kind);
        const key = `${o.give.kind}>${o.take.kind}`;
        const rate = o.take.amount / o.give.amount;
        best.set(key, Math.max(best.get(key) ?? 0, rate));
      }
      dismiss(world);
      world.tick++;
    }
    expect(best.size).toBeGreaterThan(4);

    // Max-product shortest path. After this, rate[a][a] is the most a unit of `a`
    // can ever become by any route back to itself.
    const list = [...kinds];
    const rate = new Map<string, number>(best);
    const get = (a: string, b: string) => rate.get(`${a}>${b}`) ?? 0;
    for (const via of list) {
      for (const a of list) {
        for (const b of list) {
          const through = get(a, via) * get(via, b);
          if (through > get(a, b)) rate.set(`${a}>${b}`, through);
        }
      }
    }
    for (const a of list) {
      expect(get(a, a)).toBeLessThan(1);
    }
  });

  it('varies the size of a caravan without varying the rate it deals at', () => {
    // This is what keeps the loop shut. If a good week moved the ratio rather
    // than the volume, two visits at different ratios would be an arbitrage.
    const world = colony();
    const seen = new Map<string, Set<number>>();
    const lo = new Map<string, number>();
    const hi = new Map<string, number>();
    for (let visit = 0; visit < 25; visit++) {
      summon(world);
      for (const o of goodsOffers(world)) {
        const key = `${o.give.kind}>${o.take.kind}`;
        if (!seen.has(key)) seen.set(key, new Set());
        seen.get(key)!.add(o.give.amount);
        const rate = o.take.amount / o.give.amount;
        lo.set(key, Math.min(lo.get(key) ?? rate, rate));
        hi.set(key, Math.max(hi.get(key) ?? rate, rate));
      }
      dismiss(world);
      world.tick++;
    }
    const varied = [...seen.values()].filter((s) => s.size > 1).length;
    expect(varied).toBeGreaterThan(0);
    // Not bit-identical: goods come in whole units, and rounding a six-unit
    // parcel of medicine up or down is worth a few per cent of its rate. What
    // matters is that the wobble is an order of magnitude smaller than the
    // margin every deal carries, which is why no cycle above can close.
    for (const [key, top] of hi) {
      // Paired with the key so a failure names the deal rather than a bare number.
      expect([key, top / lo.get(key)! < 1.12]).toEqual([key, true]);
    }
  });
});

describe('a caravan arriving', () => {
  it('puts a trader on the map with a board of offers and a departure time', () => {
    const world = colony();
    expect(currentTrader(world)).toBeNull();
    summon(world);
    const trader = currentTrader(world);
    expect(trader).not.toBeNull();
    expect(trader!.faction).toBe('trader');
    expect(trader!.dead).toBe(false);
    expect(goodsOffers(world).length).toBe(OFFER_COUNT);
    expect(ticksLeft(world)).toBe(STAY);
  });

  it('is nobody anyone shoots at', () => {
    // A caravan cut down by its own customers' turrets is not a trade route, and
    // the raid machinery keys off `hostiles` — a trader counted there would also
    // stall the wanderers and call the scouts home.
    const world = colony();
    summon(world);
    expect(hostiles(world).length).toBe(0);
    expect(isHostileTo('colony', 'trader')).toBe(false);
    expect(isHostileTo('raider', 'trader')).toBe(false);
    expect(isHostileTo('trader', 'colony')).toBe(false);
  });

  it('does not walk into a firefight', () => {
    const world = colony();
    spawnRaid(world, makeStreams(world).combat, 2);
    expect(world.pawns.some((p) => p.faction === 'raider' && !p.dead)).toBe(true);
    const st = tradeState(world);
    st.nextVisit = 1;
    tickTrade(world, null);
    expect(currentTrader(world)).toBeNull();
    // And does not lose its turn for it: the clock is reset, not skipped.
    expect(st.nextVisit).toBe(VISIT_GAP);
  });

  it('packs up on schedule and clears the board behind it', () => {
    const world = colony();
    summon(world);
    const st = tradeState(world);
    for (let i = 0; i < STAY; i++) {
      world.tick++;
      tickTrade(world, null);
    }
    expect(currentTrader(world)).toBeNull();
    expect(world.pawns.some((p) => p.faction === 'trader')).toBe(false);
    expect(st.offers.length).toBe(0);
    expect(st.nextVisit).toBe(VISIT_GAP);
  });

  it('offers a hired hand to a small colony and not to a full one', () => {
    const small = colony();
    summon(small);
    expect(tradeState(small).offers.some((o) => 'hire' in o.take)).toBe(true);

    const full = colony();
    const rng = makeStreams(full).main;
    while (livingColonists(full).length < HIRE_CAP) {
      const seed = livingColonists(full)[0]!;
      full.pawns.push({ ...seed, id: 9000 + full.pawns.length, name: `Extra${full.pawns.length}` });
      void rng;
    }
    summon(full);
    expect(tradeState(full).offers.some((o) => 'hire' in o.take)).toBe(false);
  });
});

describe('striking a deal', () => {
  it('takes the goods, gives the goods, and counts the trade', () => {
    const world = colony();
    summon(world);
    const offer = goodsOffers(world)[0]!;
    stock(world, offer.give.kind, offer.give.amount + 20);
    const before = countResource(world, offer.take.kind);
    const r = acceptOffer(world, offer.id);
    expect(r.ok).toBe(true);
    expect(countResource(world, offer.give.kind)).toBe(20);
    expect(countResource(world, offer.take.kind)).toBe(before + offer.take.amount);
    expect(offer.taken).toBe(true);
    expect(world.stats.trades).toBe(1);
  });

  it('lands the goods on the ground beside the stall, not in a menu', () => {
    // The whole reason a trade needs no new colonist behaviour: goods appear as
    // an ordinary stack and the haulers who were going to fetch stacks fetch it.
    const world = colony();
    summon(world);
    const trader = currentTrader(world)!;
    const offer = goodsOffers(world)[0]!;
    stock(world, offer.give.kind, offer.give.amount);
    acceptOffer(world, offer.id);
    const dropped = world.items.filter(
      (s) => s.kind === offer.take.kind && Math.abs(s.x - trader.x) < 2 && Math.abs(s.y - trader.y) < 2,
    );
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.reduce((n, s) => n + s.amount, 0)).toBe(offer.take.amount);
  });

  it('refuses a deal the colony cannot cover, and charges nothing for the refusal', () => {
    const world = colony();
    summon(world);
    const offer = goodsOffers(world)[0]!;
    stock(world, offer.give.kind, offer.give.amount - 1);
    const before = countResource(world, offer.give.kind);
    const r = acceptOffer(world, offer.id);
    expect(r.ok).toBe(false);
    expect(countResource(world, offer.give.kind)).toBe(before);
    expect(offer.taken).toBe(false);
    expect(world.stats.trades ?? 0).toBe(0);
  });

  it('refuses the same deal twice', () => {
    const world = colony();
    summon(world);
    const offer = goodsOffers(world)[0]!;
    stock(world, offer.give.kind, offer.give.amount * 2);
    expect(acceptOffer(world, offer.id).ok).toBe(true);
    const after = countResource(world, offer.give.kind);
    expect(acceptOffer(world, offer.id).ok).toBe(false);
    expect(countResource(world, offer.give.kind)).toBe(after);
  });

  it('refuses a deal with nobody standing there', () => {
    const world = colony();
    summon(world);
    const offer = goodsOffers(world)[0]!;
    stock(world, offer.give.kind, offer.give.amount);
    dismiss(world);
    expect(acceptOffer(world, offer.id).ok).toBe(false);
    expect(acceptOffer(world, 999999).ok).toBe(false);
  });

  it('will not take stock out of a working settler’s arms', () => {
    // A settler carrying the last of the steel is halfway to a blueprint. Spend
    // it and the job finishes into nothing, which is a bug the player experiences
    // as a wall that never gets built.
    const world = colony();
    summon(world);
    const offer = goodsOffers(world)[0]!;
    stock(world, offer.give.kind, offer.give.amount);
    const hauler = livingColonists(world)[0]!;
    const carried = world.items.filter((s) => s.kind === offer.give.kind);
    for (const s of carried) s.carriedBy = hauler.id;

    const r = acceptOffer(world, offer.id);
    expect(r.ok).toBe(false);
    // Nothing spent, nothing conjured: the stacks are still in their arms.
    expect(countResource(world, offer.give.kind)).toBe(offer.give.amount);
    expect(world.items.every((s) => s.kind !== offer.give.kind || s.carriedBy === hauler.id)).toBe(true);
    expect(offer.taken).toBe(false);
  });

  it('leaves a reserved stack alone and hands back what it did take', () => {
    const world = colony();
    summon(world);
    const offer = goodsOffers(world)[0]!;
    // Two stacks: one loose, one already promised to a job. The board says the
    // colony can afford it — the sim finds out it cannot, and must undo cleanly.
    stock(world, offer.give.kind, 0);
    addItem(world, offer.give.kind, Math.ceil(offer.give.amount / 2), 5, 5);
    // A big parcel lands as several stacks — MAX_STACK is 75 — so reserve by
    // position rather than by whatever addItem happened to hand back.
    addItem(world, offer.give.kind, offer.give.amount, 7, 5);
    const held = world.items.filter((s) => s.kind === offer.give.kind && s.x >= 7);
    expect(held.length).toBeGreaterThan(0);
    for (const s of held) s.reservedBy = livingColonists(world)[0]!.id;
    const reserved = held.reduce((n, s) => n + s.amount, 0);
    const total = countResource(world, offer.give.kind);

    const r = acceptOffer(world, offer.id);
    expect(r.ok).toBe(false);
    expect(countResource(world, offer.give.kind)).toBe(total);
    expect(held.reduce((n, s) => n + s.amount, 0)).toBe(reserved);
    expect(offer.taken).toBe(false);
  });

  it('turns steel into a settler who stays', () => {
    const world = colony();
    summon(world);
    const hire = tradeState(world).offers.find((o) => 'hire' in o.take)!;
    expect(hire.give.amount).toBe(HIRE_STEEL);
    stock(world, 'steel', HIRE_STEEL);
    const before = livingColonists(world).length;
    const r = acceptOffer(world, hire.id);
    expect(r.ok).toBe(true);
    expect(livingColonists(world).length).toBe(before + 1);
    expect(countResource(world, 'steel')).toBe(0);

    // And they are a colonist like any other — the caravan leaving does not take
    // them with it.
    dismiss(world);
    expect(livingColonists(world).length).toBe(before + 1);
  });
});

describe('a save written before trade existed', () => {
  it('loads and grows a caravan clock on the next tick', () => {
    const world = colony();
    delete world.trade;
    const st = tradeState(world);
    expect(st.traderId).toBeNull();
    expect(st.visits).toBe(0);
    expect(st.nextVisit).toBeGreaterThan(0);
    // And a second call does not reset a clock that is already running.
    st.nextVisit = 17;
    expect(tradeState(world).nextVisit).toBe(17);
  });
});

// --------------------------------------------------------------- experience

describe('what a player actually sees', () => {
  it('a pedlar walks in, you swap steel for medicine, and a settler carries it indoors', () => {
    const world = colony();
    const streams = makeStreams(world);
    // Four days is the real wait; the clock is the part being short-circuited,
    // not the arrival, which still happens inside the twenty-hertz loop.
    tradeState(world).nextVisit = 3;
    for (let i = 0; i < 5 && !currentTrader(world); i++) stepWorld(world, streams);
    const trader = currentTrader(world);
    expect(trader).not.toBeNull();
    expect(world.messages.some((l) => l.text.includes('pack train'))).toBe(true);

    const offer = goodsOffers(world)[0]!;
    stock(world, offer.give.kind, offer.give.amount);
    expect(acceptOffer(world, offer.id).ok).toBe(true);
    const dropX = Math.round(trader!.x);
    const dropY = Math.round(trader!.y);

    // Long enough for somebody to notice the pile and walk over. Nothing new was
    // taught to anybody: this is the ordinary hauling job doing ordinary work.
    let moved = false;
    for (let i = 0; i < 1400 && !moved; i++) {
      stepWorld(world, streams);
      moved = world.items.some(
        (s) => s.kind === offer.take.kind && (s.carriedBy !== null || Math.abs(s.x - dropX) + Math.abs(s.y - dropY) > 2),
      );
    }
    expect(moved).toBe(true);
    expect(countResource(world, offer.take.kind)).toBeGreaterThanOrEqual(offer.take.amount);
  });

  it('gives fair warning and then goes, without ever hurting anybody', () => {
    const world = colony();
    const streams = makeStreams(world);
    tradeState(world).nextVisit = 3;
    for (let i = 0; i < 5 && !currentTrader(world); i++) stepWorld(world, streams);
    expect(currentTrader(world)).not.toBeNull();

    // By id, because a wanderer can join during the half-day the caravan is here
    // and a colony that grew is not a colony that got hurt.
    const before = new Map(livingColonists(world).map((p) => [p.id, p.hp]));
    const traderId = currentTrader(world)!.id;
    let warned = false;
    let traderHurt = false;
    for (let i = 0; i < STAY + 4; i++) {
      stepWorld(world, streams);
      if (world.messages.some((l) => l.text.includes('loading the pack train'))) warned = true;
      const t = currentTrader(world);
      if (t && t.hp < t.maxHp) traderHurt = true;
    }
    expect(warned).toBe(true);
    expect(traderHurt).toBe(false);
    expect(world.pawns.some((p) => p.id === traderId && p.dead)).toBe(false);
    expect(currentTrader(world)).toBeNull();
    expect(world.messages.some((l) => l.text.includes('back into the trees'))).toBe(true);
    // Nobody who was here when they arrived took a scratch while they stood in
    // the yard: the caravan is not an event the colony has to survive.
    for (const p of livingColonists(world)) {
      if (before.has(p.id)) expect([p.name, p.hp]).toEqual([p.name, before.get(p.id)]);
    }
  });
});
