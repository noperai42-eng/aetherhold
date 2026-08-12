/**
 * The three endings, and the long expensive thing you do to reach one.
 *
 * `victory.ts` is the exam and `roads.ts` is where a founded colony goes next.
 * This is the far end of all three roads: **the ship** you build, **the berths**
 * you buy, **the dominion** you keep. `ENDGAME.md` fixes the fictions and this
 * file is only the mechanism — but the mechanism is where an ending goes wrong,
 * so it is worth saying what it is and is not.
 *
 * **An ending is a commitment, not a threshold.** The founding is the precedent
 * and it is the right one: the tense part was never meeting five charters, it
 * was holding them together for three days while the valley tried to take one
 * back. `victory.ts` rejected by name the version where a win lands on the tick
 * a number ticks over — *"the most dramatic moment in the run is a number
 * quietly ticking over"* — and an ending that fired the moment a rung was
 * reached would be that same mistake one act later and three times over. So
 * each ending here is something the colony **commits to, pays for, and then has
 * to survive**. Nothing lands on its own.
 *
 * **The gate is the top rung of its own road.** The ship needs Machinists, the
 * berths need House, dominion needs Warlords — the last rung of science,
 * economy and warfare respectively. Not a fourth set of conditions: the ladders
 * in `roads.ts` are already derived from the founding's bars, the shape of the
 * tree and the size of the map, so a fourth ring or a fourth tier moves these
 * gates on its own and nobody edits a second file.
 *
 * **Three bills in three different units**, for the same reason there are three
 * ladders at all. Three endings that all cost steel would be one ending printed
 * three times:
 *
 * - The **ship** is *built*, so it is paid in goods off the yard, day by day,
 *   as a hull is. Its bill is the whole of the research tree's materials over
 *   again — everything the foundry ever made, made once more.
 * - The **berths** are *bought*, so they are paid in worth handed out through
 *   the caravans, which is a tally of the whole run rather than of the terminal.
 *   Somebody else built that ship; what the colony spent is the road it walked
 *   to afford it. The price is what the ship costs, at the same `VALUE`
 *   yardstick every quote in the game is already priced against — the same
 *   ship, in the other currency.
 * - The **dominion** buys nothing at all. Its unit is ground, and ground is
 *   kept rather than spent: the bill is that every holding is still yours when
 *   the clock runs out.
 *
 * **The days are shared and the bills are not**, which is the same division of
 * labour. Three different day counts would be a fourth thing to balance and
 * would say nothing three different bills do not already say better.
 *
 * **Landing takes a record and does not stop the world.** The colony goes on —
 * the ship leaves and the valley is still there with whoever stayed — so the
 * tally the ending is about is copied on the tick it lands rather than read
 * later off a world that has moved on. See `EndingRecord`. It is the same
 * argument as the bill being paid by the day: the moment is the unit, and
 * anything read off "now" instead is a different colony wearing the same name.
 *
 * **What this file does not touch: `world.gameOver`.** It means *nobody is
 * left*, nine passes read it that way, and `victory.ts` documents at length the
 * slice where a founding set it and the prize for winning was that the foreman
 * switched off. An ending is its own field.
 */

import { dayNumber } from './clock';
import { HOLDING_COUNT, heldCount } from './holdings';
import { RESEARCH, RESEARCH_ORDER } from './research';
import { ROAD_IDS, ROAD_RUNGS, type RoadId, roadRungs } from './roads';
import { VALUE } from './settlements';
import {
  SKILL_NAMES,
  TICKS_PER_DAY,
  type EndingRecord,
  type EndingState,
  type ManifestEntry,
  type ResourceKind,
  type World,
} from './types';
import { HOLD_DAYS, charters } from './victory';
import { livingColonists, msg, spendableResource, takeResource } from './world';

export type EndingId = 'ship' | 'berths' | 'dominion';

/**
 * How long a terminal takes, once committed.
 *
 * The founding's own hold, once for every rung of the road that got you here.
 * Derived rather than picked for the usual reason — a hand-written number here
 * would be a fourth thing to balance — and the ratio is the argument: the first
 * act asks the colony to hold together for three days, and the last act asks
 * for one of those per rung it climbed.
 */
export const ENDING_DAYS = HOLD_DAYS * ROAD_RUNGS;
export const ENDING_TICKS = TICKS_PER_DAY * ENDING_DAYS;

/**
 * What the ship costs: every materials bill in the research tree, summed.
 *
 * A multiple would have been a number somebody chose. This is the tree over
 * again — the colony builds the ship out of exactly as much steel, parts and
 * machinery as the foundry consumed getting to the point where it could build
 * one — and it moves on its own the day a fourth tier lands.
 */
export const SHIP_BILL: Partial<Record<ResourceKind, number>> = (() => {
  const bill: Partial<Record<ResourceKind, number>> = {};
  for (const id of RESEARCH_ORDER) {
    const m = RESEARCH[id].materials;
    if (!m) continue;
    for (const [kind, want] of Object.entries(m) as Array<[ResourceKind, number]>) {
      bill[kind] = (bill[kind] ?? 0) + want;
    }
  }
  return bill;
})();

/** Anything measured in worth is measured against this — one table, no arbitrage. */
export function worthOf(goods: Partial<Record<ResourceKind, number>>): number {
  let worth = 0;
  for (const [kind, n] of Object.entries(goods) as Array<[ResourceKind, number]>) {
    worth += VALUE[kind] * n;
  }
  return worth;
}

/**
 * What the berths cost: the ship, priced at the yardstick.
 *
 * The fiction is that somebody else built it and the colony is buying passage,
 * so the two numbers being the same number is the point rather than a
 * coincidence — and it means the economy ending cannot drift away from the
 * science one when the tree grows, because there is only one bill underneath
 * them both.
 */
export const BERTHS_WORTH = Math.round(worthOf(SHIP_BILL));

/** Per-day instalment on the hull, rounded up so the last day is the short one. */
const shipInstalment = (kind: ResourceKind): number =>
  Math.ceil((SHIP_BILL[kind] ?? 0) / ENDING_DAYS);

/*
 * `EndingState` itself lives in `types.ts`, beside `Holding` and `WarParty` and
 * for the same reason: the world owns its own shape, and a module that reads a
 * field is not the module that gets to define it. Two things about it are worth
 * saying here rather than there.
 *
 * `since` is reset rather than cleared on a stumble, exactly like the founding
 * clock — falling out of the running costs the days, not the goods.
 *
 * `lastWorked` is counted off the world clock and not off `since`, because
 * `since` resets and a hull that stopped being added to until the clock caught
 * back up would be paying twice for one bad afternoon.
 */

interface Terminal {
  id: EndingId;
  road: RoadId;
  /** One word for a panel row. */
  title: string;
  /** What it is, in one sentence. */
  blurb: string;
  /** Where the work is. A terminal with no answer is a countdown. */
  hint: string;
  /** One day's work. Only the ship has any; the other two are paid elsewhere. */
  work(world: World, st: EndingState): void;
  /** Where the bill stands, in this terminal's own unit. */
  bill(world: World, st: EndingState): { at: number; of: number; count: string };
}

const TERMINALS: readonly Terminal[] = [
  {
    id: 'ship',
    road: 'science',
    title: 'The ship',
    blurb: 'Build it yourself, out of everything the foundry ever learned to make.',
    hint: 'Keep steel, parts and machinery in the yard. The hull takes a bite every day.',
    work(world, st) {
      for (const [kind, want] of Object.entries(SHIP_BILL) as Array<[ResourceKind, number]>) {
        const owed = want - (st.paid[kind] ?? 0);
        if (owed <= 0) continue;
        // What it can get, up to today's instalment and never past the bill.
        // Partial delivery is credited rather than refused — a hull is a thing
        // you add to, and the all-or-nothing rule `research.ts` uses is there to
        // stop a *stalled* bench burning stock it never gets credit for. Here
        // every plate taken is a plate in the ship.
        const take = Math.min(owed, shipInstalment(kind), spendableResource(world, kind));
        if (take <= 0) continue;
        st.paid[kind] = (st.paid[kind] ?? 0) + takeResource(world, kind, take);
      }
    },
    bill(_world, st) {
      const at = Math.round(worthOf(st.paid));
      const of = Math.round(worthOf(SHIP_BILL));
      return { at, of, count: `${at} / ${of} of worth in the hull` };
    },
  },
  {
    id: 'berths',
    road: 'economy',
    title: 'The berths',
    blurb: "Somebody else's ship, your passage, paid for out of what the road earned.",
    hint: 'The road. Every pack handed over out there counts toward the fare.',
    work() {
      // Nothing. The fare was paid on the road, over the whole run, and reading
      // it here as a running total is what makes this ending the economy's
      // rather than a second bench with a different label on it.
    },
    bill(world) {
      const at = Math.round(world.stats.tradedWorth ?? 0);
      return { at, of: BERTHS_WORTH, count: `${at} / ${BERTHS_WORTH} of worth traded away` };
    },
  },
  {
    id: 'dominion',
    road: 'warfare',
    title: 'The dominion',
    blurb: 'You never leave. The moor is yours, and you are the ones who launch.',
    hint: 'Hold what you took. Every holding, every day, to the end of the count.',
    work() {
      // Nothing is bought. The gate below is the whole of it, held.
    },
    bill(world) {
      const at = heldCount(world);
      return { at, of: HOLDING_COUNT, count: `${at} / ${HOLDING_COUNT} holdings kept` };
    },
  },
];

/** In road order, so the panel and the grid read them the same way round. */
export const ENDING_IDS: readonly EndingId[] = TERMINALS.map((t) => t.id);

function terminalOf(id: EndingId): Terminal {
  return TERMINALS.find((t) => t.id === id)!;
}

/** What an ending is called, for a line of prose that is not a panel. */
export function endingTitle(id: EndingId): string {
  return terminalOf(id).title;
}

export interface EndingOffer {
  id: EndingId;
  road: RoadId;
  title: string;
  blurb: string;
  hint: string;
  /** The bill as it would read on the day of the commitment. */
  bill: { at: number; of: number; count: string };
}

/**
 * What an ending is and what it costs, before anybody has committed to it.
 *
 * The bill is priced against a state that has paid nothing, which is the truth
 * for the hull and deliberately not the truth for the other two: the fare and
 * the moor are both partly paid by the time the road that opens them is at its
 * top rung, and a panel that hid that would be quoting a price the colony has
 * already met. It is the numbers that cross the wall and not the words for
 * them — `RESOURCE_LABEL` lives in the client, and a second copy in here would
 * be two places to rename a resource.
 */
export function endingOffer(world: World, id: EndingId): EndingOffer {
  const t = terminalOf(id);
  const unpaid: EndingState = {
    id,
    committed: 0,
    since: null,
    paid: {},
    lastWorked: null,
    landed: null,
  };
  return {
    id: t.id,
    road: t.road,
    title: t.title,
    blurb: t.blurb,
    hint: t.hint,
    bill: t.bill(world, unpaid),
  };
}

/**
 * Is the road that opens this ending standing at its top rung right now?
 *
 * Read live rather than latched, and that is the whole reason dominion has a
 * bill of its own at all: a colony that took the moor and lost a piece of it
 * mid-terminal is not holding the moor, and an ending gated on a latch would
 * let it leave anyway.
 */
export function endingOpen(world: World, id: EndingId): boolean {
  const rungs = roadRungs(world);
  const i = ROAD_IDS.indexOf(terminalOf(id).road);
  return (rungs[i] ?? 0) >= ROAD_RUNGS;
}

/** The endings the colony could commit to today, in road order. */
export function endingsOpen(world: World): EndingId[] {
  return ENDING_IDS.filter((id) => endingOpen(world, id));
}

/**
 * Commit. One at a time, and no going back except by hand.
 *
 * Refused rather than queued when the road is short or another terminal is
 * already running — a colony that could commit to all three at once would be
 * playing a checklist, and the choice of which road to finish is most of what
 * the three roads are for.
 */
export function commitEnding(world: World, id: EndingId): boolean {
  if (world.ending) return false;
  if (!endingOpen(world, id)) return false;
  const t = terminalOf(id);
  world.ending = {
    id,
    committed: world.tick,
    since: null,
    paid: {},
    lastWorked: null,
    landed: null,
  };
  msg(world, `${t.title}. ${t.blurb} ${ENDING_DAYS} days, and the colony has to hold.`, 'good', {
    headline: true,
  });
  return true;
}

/**
 * Give it up. The goods already in the hull stay in the hull and are not
 * refunded — that is what committing meant — and the colony is free to commit
 * again, to this ending or another one.
 */
export function abandonEnding(world: World): boolean {
  const st = world.ending;
  if (!st || st.landed !== null) return false;
  world.ending = undefined;
  msg(world, `${terminalOf(st.id).title} is abandoned. What went into it is gone.`, 'bad', {
    headline: true,
  });
  return true;
}

export interface EndingProgress {
  id: EndingId;
  title: string;
  blurb: string;
  hint: string;
  /** Days left on the clock, or the full count while the colony is out of the running. */
  daysLeft: number;
  /** False while the road has slipped or the colony is short a charter. */
  running: boolean;
  /** Why the clock is stopped, when it is. */
  stalled: string | null;
  bill: { at: number; of: number; count: string };
  /** 0..1 over the two halves together — the days and the bill. */
  progress: number;
  landed: boolean;
}

/**
 * Why the clock is not running, or null when it is.
 *
 * Two ways to fall out, and they are deliberately the two the rest of the game
 * already has words for. The road can slip — the gate is read live — and the
 * colony can stop being a colony, which is the founding's own five charters
 * read a second time. No new conditions: an ending the player has to satisfy a
 * sixth bar for is a sixth bar to balance, and "still a colony" is a thing this
 * game already knows how to say.
 */
function stalledBy(world: World, st: EndingState): string | null {
  if (!endingOpen(world, st.id)) {
    const t = terminalOf(st.id);
    return `the ${t.road} road has slipped below its last rung`;
  }
  const short = charters(world).find((c) => !c.met);
  return short ? short.title.toLowerCase() : null;
}

/** Where the ending stands, for a panel. Pure — safe to call every frame. */
export function endingProgress(world: World): EndingProgress | null {
  const st = world.ending;
  if (!st) return null;
  const t = terminalOf(st.id);
  const bill = t.bill(world, st);
  const stalled = st.landed === null ? stalledBy(world, st) : null;
  const held = st.since === null ? 0 : world.tick - st.since;
  const days = Math.max(0, ENDING_TICKS - held) / TICKS_PER_DAY;
  const clock = Math.max(0, Math.min(1, held / ENDING_TICKS));
  const paid = Math.max(0, Math.min(1, bill.of === 0 ? 1 : bill.at / bill.of));
  return {
    id: st.id,
    title: t.title,
    blurb: t.blurb,
    hint: t.hint,
    daysLeft: st.landed === null ? days : 0,
    running: st.landed === null && stalled === null,
    stalled,
    bill,
    progress: st.landed === null ? (clock + paid) / 2 : 1,
    landed: st.landed !== null,
  };
}

/** True when this run ended in an ending rather than a founding or a wipe. */
export function hasEnded(world: World): boolean {
  return world.ending !== undefined && world.ending.landed !== null;
}

/**
 * The roll, by name, on the tick the ending landed.
 *
 * Everyone the colony still has a body for — the ones standing and the ones in
 * the ground — because *who did not come* is half of what a manifest is for and
 * the valley is where they stayed. Prisoners are not on it: they are their own
 * faction and this is a list of the colony's people, not of everyone who was
 * inside the wall that day.
 *
 * Bodies that rotted away before the ending are not on it either, and that is
 * the one gap worth naming out loud. `world.pawns` drops a corpse nobody buried
 * after `ROT_TICKS`, so a colony that lost somebody early and left them lying
 * has no record of them here. The alternative is a second list kept from day
 * one against the chance of an ending that most runs never reach, which is a
 * cost every colony pays for a card two in fifteen ever see. A grave is how a
 * colony remembers somebody, and this reads what the colony kept.
 */
function takeManifest(world: World, id: EndingId): ManifestEntry[] {
  const leaving = id !== 'dominion';
  return world.pawns
    .filter((p) => p.faction === 'colony')
    .map((p) => {
      // The raw pairing rather than `partnerOf`, which drops a partner who is
      // dead — see `ManifestEntry.partner`. Somebody boarding alone who did not
      // arrive alone is the line this record exists to still have in fifty days.
      const mate = world.partners?.[p.id];
      const with_ = mate === undefined ? null : world.pawns.find((o) => o.id === mate);
      return {
        id: p.id,
        name: p.name,
        fate: p.dead ? 'lost' : leaving ? 'left' : 'held',
        // Floored, because a level is what the game means by a level everywhere
        // else — the inspector, the job gates, the message when somebody makes
        // one. Writing 4.83 here would be recording the practice rather than the
        // person, and it would put settlers on the roll at "cooking 0".
        skills: SKILL_NAMES.map((skill) => ({ skill, level: Math.floor(p.skills[skill] ?? 0) }))
          .filter((s) => s.level > 0)
          .sort((a, b) => b.level - a.level),
        traits: [...(p.traits ?? [])],
        weapon: p.weapon,
        apparel: p.apparel,
        gear: p.gear,
        hurt: p.maxHp > 0 ? Math.max(0, Math.min(1, 1 - p.hp / p.maxHp)) : 1,
        partner: with_?.name ?? null,
      } satisfies ManifestEntry;
    });
}

/** The numbers, frozen. Taken on the tick it lands and not a tick later. */
function takeTally(world: World): EndingRecord {
  return {
    day: dayNumber(world),
    standing: livingColonists(world).length,
    stats: { ...world.stats },
  };
}

/**
 * The whole record: the numbers and the names.
 *
 * The ending's id is handed in rather than read off `world.ending`, because the
 * caller already holds it and a default here would be a fourth ending nobody
 * ever reaches — the manifest asks it whether these people left or stayed.
 */
function takeRecord(world: World, id: EndingId): EndingRecord {
  return { ...takeTally(world), manifest: takeManifest(world, id) };
}

/**
 * The record of a landed ending, or null while there is nothing to record.
 *
 * The fallback is for one case and it is a narrow one: a save written between
 * the ending landing and the record existing. Reading the world now is the only
 * honest answer available there — the moment was not kept, and the numbers on
 * that card are the numbers today. Everything since is the frozen tally.
 *
 * It is a **tally and no roll**, and the asymmetry is the point. A stale number
 * is a number that has drifted; a roll read twenty days late is a different list
 * of people, with settlers on it who walked in after the ship sailed and without
 * the ones who were on board. There is no honest way to answer *who left* out of
 * a world that has moved, so it does not answer.
 */
export function endingRecord(world: World): EndingRecord | null {
  const st = world.ending;
  if (!st || st.landed === null) return null;
  return st.record ?? takeTally(world);
}

/**
 * One check of the terminal, on the same once-a-second cadence as the exam.
 *
 * The order matters and is the same order `tickVictory` uses: fall out first,
 * then start the clock, then work, then land. A colony that pays its instalment
 * on the tick it loses a charter has paid for a day that does not count, which
 * is the wrong way round — the goods should follow the clock, not lead it.
 */
export function tickEndings(world: World): void {
  if (world.gameOver) return;
  if (world.tick % 20 !== 0) return;
  const st = world.ending;
  if (!st || st.landed !== null) return;

  const stalled = stalledBy(world, st);
  if (stalled) {
    if (st.since !== null) {
      st.since = null;
      msg(world, `${terminalOf(st.id).title} falters — ${stalled}.`, 'bad', { headline: true });
    }
    return;
  }

  if (st.since === null) {
    // Only ever announced as a *resumption*, because the start was already
    // announced by the commitment a fraction of a second earlier and two
    // headlines about the same decision is the log telling the player something
    // happened twice. `lastWorked` is the discriminator: null means this
    // terminal has not yet seen a day, so this is the first one.
    if (st.lastWorked !== null) {
      msg(world, `Work resumes on ${terminalOf(st.id).title.toLowerCase()}.`, 'good');
    }
    st.since = world.tick;
  }

  const t = terminalOf(st.id);
  const today = Math.floor(world.tick / TICKS_PER_DAY);
  if (st.lastWorked !== today) {
    st.lastWorked = today;
    t.work(world, st);
  }

  const bill = t.bill(world, st);
  if (world.tick - st.since < ENDING_TICKS) return;
  if (bill.at < bill.of) return;
  st.landed = world.tick;
  st.record = takeRecord(world, st.id);
  msg(world, `${t.title}. ${t.blurb}`, 'good', { headline: true });
}
