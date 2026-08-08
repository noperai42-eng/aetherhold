/**
 * The neighbours, and the road to them.
 *
 * Trade until now was a pedlar who walks *in*: the colony stands still and the
 * world comes to it. This is the other direction — somebody from here loads a
 * pack, walks off the edge of the map, and is gone for days. It exists for three
 * reasons, in order of how much they matter:
 *
 *  - **It makes a settler cost something.** Every other decision in the game
 *    spends materials. This one spends a *person*: the colony has to get through
 *    a week without their hands, their rifle and their cooking, and the pay-off
 *    lands after the risk rather than before it.
 *  - **It gives a skill somewhere to go.** `social` is levelled by doing this and
 *    is most of the difference between a good price and a bad one, so "who do we
 *    send" is a real question with a wrong answer.
 *  - **It is the first thing on the map that is bigger than the colony.** Four
 *    named places with their own shortages and their own opinion of you is what
 *    turns a survival sandbox into somewhere.
 *
 * Two properties this is built to keep, both tested:
 *
 * - **No loop.** Every quote is priced off one value table (`VALUE`) at a rate
 *   strictly below 1, and the pedlar's book in `trade.ts` prices below 1 on the
 *   same table. So no sequence of deals across *either* system — or both, in any
 *   order — turns steel into more steel. That is why the table lives here and why
 *   `tests/settlements.test.ts` checks the pedlar's own deals against it.
 * - **Nobody dies off-screen.** The road can go badly and usually costs the
 *   goods; it never kills. A settler lost to dice the player could not see, on a
 *   map they could not look at, is a story the game cannot tell them.
 */

import { isSleepHours } from './clock';
import { nearestWalkable } from './grid';
import { HUNGRY, TIRED } from './needs';
import { regionAt } from './regions';
import { Rng } from './rng';
import { CRAFT_DEFS, RECIPE_ORDER, outputKind } from './crafting';
import { gainSkill } from './skills';
import { TICKS_PER_DAY } from './types';
import type { Caravan, CraftRecipe, Pawn, ResourceKind, Settlement, World } from './types';
import {
  addItem,
  cancelJob,
  countResource,
  hostiles,
  livingColonists,
  msg,
  takeResource,
} from './world';

/**
 * What a unit of each thing is worth, on one scale.
 *
 * Not a price — a *yardstick*. Both trade systems quote against this, which is
 * the only reason the game can promise there is no arbitrage between them. The
 * numbers were solved for rather than chosen: they are the value vector that
 * makes every one of the pedlar's eight standing deals in `trade.ts` come out at
 * a rate at or below 1, with as little slack as that constraint allows.
 */
export const VALUE: Record<ResourceKind, number> = {
  wood: 1,
  steel: 1.9,
  rawfood: 1.35,
  meal: 2.8,
  medicine: 12.5,
  // Hides appear in none of the pedlar's standing deals, so this sets no rate
  // and can be chosen on its merits: scarce, hunted, and the only thing a coat is
  // made of. Between steel and a cooked meal, which is what a hunter's afternoon
  // is worth against a cook's.
  hide: 2.6,
};

/**
 * The best rate anybody will ever quote.
 *
 * Strictly below 1, which is the whole no-loop guarantee in one number. It is
 * also comfortably above the pedlar's best deal (0.952), because a colony that
 * walked somebody four days each way and got a worse price than the man in the
 * yard has been told a lie about what the walk was for.
 */
export const RATE_CAP = 0.98;

/** What a stranger with nothing to recommend them gets quoted. */
const RATE_BASE = 0.62;
/** Bonus for turning up with the thing they are short of. */
const RATE_WANTED = 0.12;
/** Per point of `social`, up to +0.24 across the whole skill. */
const RATE_PER_SOCIAL = 0.012;
/** Per point of standing, up to +0.08 at allied. */
const RATE_PER_RELATION = 0.0008;
/**
 * Bonus for bringing a workshop town the thing its workshop eats.
 *
 * A place known for brewing balm is a place that never has enough raw food, and
 * it pays like it. This is on top of `RATE_WANTED` rather than instead of it —
 * the two are different facts about a settlement and a town that both makes balm
 * and is short of food should be the best customer on the map. Still under
 * `RATE_CAP`, which is where the no-arbitrage promise actually lives, so no
 * amount of stacking opens a loop.
 */
const RATE_CRAFT_INPUT = 0.06;
/**
 * Bonus for bringing a town something it cannot make for itself.
 *
 * The other half of `RATE_CRAFT_INPUT`, and the reason a colony bothers to put a
 * herbalist on a bench rather than selling the raw food she started from. A
 * place with its own brewer shrugs at a crate of balm; a place with no brewer
 * within four days' walk does not. Capped like everything else, so the premium
 * is a reason to manufacture, never a loop.
 */
const RATE_CRAFT_OUTPUT = 0.07;

/**
 * The resources somebody has to have made. Built from the recipe book so a new
 * recipe is worth carrying without anybody editing this line.
 */
const MADE_GOODS: ReadonlySet<ResourceKind> = new Set(
  RECIPE_ORDER.map((r) => outputKind(CRAFT_DEFS[r])).filter((k): k is ResourceKind => k !== null),
);

/** Standing gained by walking a pack to somebody's door. */
export const RELATIONS_PER_VISIT = 6;
export const RELATIONS_MAX = 100;

/** Social levelled by one completed round trip. Four or five runs is a specialist. */
export const SOCIAL_PER_TRIP = 0.9;

/** The names over the ridge. Four of these end up on any one map. */
const NEIGHBOUR_NAMES = [
  'Ashfen',
  'Marrow Deep',
  'Kell Hollow',
  'Sarn Crossing',
  'Ondways',
  'Bitterfold',
  'Greyreach',
  'Ninefold',
];

/** How many neighbours a map has. Four is one per quarter of the compass. */
const NEIGHBOUR_COUNT = 4;

/** Days of walking, one way, in the order the four are laid out. */
const DISTANCES = [1, 2, 2, 3];

/**
 * The neighbours of this map.
 *
 * Built on first use rather than in `createWorld`, for the reason written at the
 * top of worldgen: anything that draws an id before the settlers are made
 * re-rolls who those settlers are. This needs no ids and no world state beyond
 * the seed, so it costs nothing to defer and a save written before any of this
 * existed meets exactly the same four people when it loads.
 */
export function settlementsOf(world: World): Settlement[] {
  if (world.settlements) return world.settlements;
  const rng = new Rng((world.seed ^ 0x5bf03635) >>> 0);
  const names = [...NEIGHBOUR_NAMES];
  const kinds: ResourceKind[] = ['wood', 'steel', 'rawfood', 'meal', 'medicine'];
  const made: Settlement[] = [];
  for (let i = 0; i < NEIGHBOUR_COUNT; i++) {
    const name = names.splice(rng.int(names.length), 1)[0]!;
    // One per quarter of the compass, jittered inside it. Four places all out
    // past the same treeline would make "which way is Ashfen" a question with no
    // answer, and the bearing is most of what makes them feel like places.
    const bearing = (i * Math.PI) / 2 + rng.range(-0.5, 0.5);
    const sells = kinds[rng.int(kinds.length)]!;
    // Never short of the thing they are drowning in.
    const wants = kinds.filter((k) => k !== sells);
    made.push({
      id: i + 1,
      name,
      bearing,
      days: DISTANCES[i] ?? 2,
      sells,
      buys: wants[rng.int(wants.length)]!,
      craft: craftFor(sells, i + 1),
      relations: 0,
      visits: 0,
    });
  }
  world.settlements = made;
  return made;
}

export function settlementById(world: World, id: number): Settlement | null {
  return settlementsOf(world).find((s) => s.id === id) ?? null;
}

/**
 * Which recipes turn out each resource, in book order.
 *
 * Built from the recipe table rather than written out, so a recipe added to
 * `crafting.ts` gives some neighbour a workshop without anybody remembering to
 * come back here.
 */
const MAKERS = ((): Partial<Record<ResourceKind, CraftRecipe[]>> => {
  const out: Partial<Record<ResourceKind, CraftRecipe[]>> = {};
  for (const id of RECIPE_ORDER) {
    const kind = outputKind(CRAFT_DEFS[id]);
    if (!kind) continue;
    (out[kind] ??= []).push(id);
  }
  return out;
})();

/**
 * The trade a settlement is known for, given what it has too much of.
 *
 * Derived, not rolled — deliberately. Every draw taken while building the
 * neighbours shifts the ones after it, and this file's rng is the only thing
 * standing between "add a field to a settlement" and "every map's neighbours are
 * different people now". Keyed off the settlement's own id instead, so a colony
 * that has been played for twenty days meets exactly the towns it always met and
 * simply learns what they do for a living.
 *
 * A place whose surplus is something you dig up — wood, steel, a full granary —
 * gets nothing here, and that is the honest answer: they are producers, not
 * makers, and half the map being workshops would make a workshop unremarkable.
 */
function craftFor(sells: ResourceKind, id: number): CraftRecipe | null {
  const makers = MAKERS[sells];
  if (!makers || makers.length === 0) return null;
  return makers[id % makers.length] ?? null;
}

/**
 * What this place is known for, or null if they only dig things up.
 *
 * Backfills on read, for saves written before neighbours had trades.
 */
export function specialty(s: Settlement): CraftRecipe | null {
  if (s.craft === undefined) s.craft = craftFor(s.sells, s.id);
  return s.craft;
}

/** Ticks of walking, one way. */
export function legTicks(s: Settlement): number {
  return Math.round(s.days * TICKS_PER_DAY);
}

/** A settler's social skill, tolerating a save written before the skill existed. */
export function socialOf(pawn: Pawn): number {
  return pawn.skills?.social ?? 0;
}

/**
 * The rate this settler would be quoted by this settlement, as a fraction of
 * what the goods are worth.
 *
 * Exported because the panel shows it before the player commits — the whole
 * decision is "is this worth a week of somebody", and that is not a question you
 * can ask about a number you cannot see.
 */
export function rateFor(s: Settlement, pawn: Pawn, give: ResourceKind): number {
  return rateOf(s, socialOf(pawn), give);
}

/**
 * The rate, with the settler's charm passed in as a number.
 *
 * Split out because the foreman has to compare four towns before it has decided
 * who is walking, and social is the same addition at every one of them — so the
 * ranking is the same whether it is asked with a talker or with nobody.
 *
 * Exported for `commissions.ts`, which needs the same number with no pawn in
 * hand: a letter is priced against whoever ends up walking it, and at the moment
 * it is written nobody has been chosen.
 */
export function rateOf(s: Settlement, social: number, give: ResourceKind): number {
  const trade = specialty(s);
  const feedsTheirWorkshop = trade !== null && CRAFT_DEFS[trade].input.kind === give;
  // They pay up for manufactured goods unless their own workshop turns out the
  // same thing, in which case a crate of it is the last thing they need.
  const cannotMakeIt =
    MADE_GOODS.has(give) && !(trade !== null && outputKind(CRAFT_DEFS[trade]) === give);
  const rate =
    RATE_BASE +
    (give === s.buys ? RATE_WANTED : 0) +
    (feedsTheirWorkshop ? RATE_CRAFT_INPUT : 0) +
    (cannotMakeIt ? RATE_CRAFT_OUTPUT : 0) +
    social * RATE_PER_SOCIAL +
    Math.max(0, s.relations) * RATE_PER_RELATION;
  return Math.min(RATE_CAP, rate);
}

/**
 * Why this town is quoting what it is quoting, in the order it matters.
 *
 * The rate is one number and the panel shows it, but a number without a reason
 * teaches nothing — a player who reads "they cannot make this" once knows for
 * the rest of the game why the herbalist is worth keeping on the bench.
 */
export function rateReasons(s: Settlement, give: ResourceKind): string[] {
  const trade = specialty(s);
  const out: string[] = [];
  if (give === s.buys) out.push('they want this');
  if (trade !== null && CRAFT_DEFS[trade].input.kind === give) out.push('feeds their workshop');
  if (MADE_GOODS.has(give) && !(trade !== null && outputKind(CRAFT_DEFS[trade]) === give)) {
    out.push('they cannot make this');
  }
  return out;
}

/**
 * What they will hand over for a pack of goods.
 *
 * Always paid in the thing they have too much of — that is what a settlement
 * with a specialty *is*, and it means the interesting question is which
 * neighbour to walk to rather than which button to press when you get there.
 */
export function quote(
  s: Settlement,
  pawn: Pawn,
  give: { kind: ResourceKind; amount: number },
): { kind: ResourceKind; amount: number } {
  const worth = VALUE[give.kind] * give.amount * rateFor(s, pawn, give.kind);
  return { kind: s.sells, amount: Math.max(1, Math.floor(worth / VALUE[s.sells])) };
}

/**
 * Odds the road goes badly, as a fraction.
 *
 * Distance is most of it, standing and a rifle are the rest. Floored at 1% so
 * the safest run is still a run, and capped so the worst one is still worth
 * considering.
 */
export function mishapChance(s: Settlement, pawn: Pawn): number {
  const raw = 0.06 * s.days - Math.max(0, s.relations) * 0.0004 - (pawn.skills?.shooting ?? 0) * 0.004;
  return Math.min(0.3, Math.max(0.01, raw));
}

/** Where the road out to this settlement leaves the map. */
export function roadHead(world: World, s: Settlement, from: Pawn): { x: number; y: number } | null {
  const cx = world.width / 2;
  const cy = world.height / 2;
  const home = regionAt(world, Math.round(from.x), Math.round(from.y));
  // Walk out along the bearing until the edge, then take the nearest cell
  // somebody can actually stand on. Tried at a few angles either side, because a
  // bearing that runs into the lake is a road that does not exist.
  for (const wobble of [0, 0.25, -0.25, 0.5, -0.5, 0.9, -0.9]) {
    const a = s.bearing + wobble;
    const reach = Math.max(world.width, world.height);
    const ex = Math.round(Math.min(world.width - 2, Math.max(1, cx + Math.cos(a) * reach)));
    const ey = Math.round(Math.min(world.height - 2, Math.max(1, cy + Math.sin(a) * reach)));
    const spot = nearestWalkable(world, ex, ey, 8);
    if (!spot) continue;
    if (home >= 0 && regionAt(world, spot.x, spot.y) !== home) continue;
    return spot;
  }
  return null;
}

export type CaravanPlan =
  | { ok: true; settlement: Settlement; head: { x: number; y: number } }
  | { ok: false; text: string };

/**
 * Can this settler walk this pack to this place, and where do they leave from?
 *
 * Validation only — it does not create the job, because jobs belong to
 * `jobs.ts` and this module must stay below it in the import order. `jobs.ts`
 * wraps this as `orderCaravan`, which is what the panel calls. Every refusal
 * comes back as a sentence rather than a boolean: the panel's only job is to
 * repeat it.
 */
export function planCaravan(
  world: World,
  pawn: Pawn,
  settlementId: number,
  give: { kind: ResourceKind; amount: number },
): CaravanPlan {
  const s = settlementById(world, settlementId);
  if (!s) return { ok: false, text: 'There is nowhere by that name.' };
  if (world.caravan) return { ok: false, text: 'There is already a party on the road.' };
  if (world.jobs.some((j) => j.kind === 'caravan')) {
    return { ok: false, text: 'Somebody is already loading up.' };
  }
  if (pawn.dead || pawn.downed) return { ok: false, text: `${pawn.name} is in no state to walk it.` };
  if (pawn.playerControlled) {
    return { ok: false, text: 'Step out of them first — you cannot walk yourself off the map.' };
  }
  // Two, not four: the autonomous gate wants a colony that can spare somebody,
  // but a player who has decided to send their second-to-last settler out has
  // decided that, and the game's business is to let them find out.
  if (livingColonists(world).length < 2) {
    return { ok: false, text: 'There is nobody who can be spared.' };
  }
  if (give.amount <= 0) return { ok: false, text: 'A pack with nothing in it is a walk.' };
  if (countResource(world, give.kind) < give.amount) {
    return { ok: false, text: `Not enough ${give.kind} for that pack.` };
  }
  const head = roadHead(world, s, pawn);
  if (!head) return { ok: false, text: `There is no way out of the valley towards ${s.name}.` };
  return { ok: true, settlement: s, head };
}

/**
 * They have reached the edge. Take the pack and lift them off the map.
 *
 * Returns false when the colony has spent the goods out from under them while
 * they walked — the run is called off rather than leaving with an empty pack,
 * because a settler who is away for a week and brings back one plank is a bug
 * the player will read as the trade system being broken.
 */
export function departCaravan(
  world: World,
  pawn: Pawn,
  s: Settlement,
  give: { kind: ResourceKind; amount: number },
): boolean {
  const paid = takeResource(world, give.kind, give.amount);
  if (paid <= 0) {
    msg(world, `${pawn.name} gets to the road and finds the pack was spent. They turn back.`, 'bad');
    return false;
  }
  const pack = { kind: give.kind, amount: paid };
  const caravan: Caravan = {
    settlementId: s.id,
    pawn,
    give: pack,
    take: null,
    x: Math.round(pawn.x),
    y: Math.round(pawn.y),
    dueTick: world.tick + legTicks(s),
    phase: 'outbound',
  };
  // Everything they were holding goes back on the board before they go. A
  // control stack keeps its claims — that is what makes it safe — so a tree this
  // settler had lined up would otherwise stay reserved to somebody who is a week
  // down the road, and nobody left in the valley could touch it.
  for (const j of world.jobs.slice()) if (j.pawnId === pawn.id) cancelJob(world, j.id);
  world.pawns = world.pawns.filter((p) => p.id !== pawn.id);
  world.caravan = caravan;
  msg(world, `${pawn.name} walks out of the valley towards ${s.name}. ${s.days * 2} days there and back.`, 'info');
  return true;
}

/** The party on the road, if there is one. */
export function caravanOf(world: World): Caravan | null {
  return world.caravan ?? null;
}

/**
 * Days left before they are home, for the panel. Counts the whole round trip
 * while they are still outbound, because that is the number the player is
 * actually waiting on.
 */
export function caravanDaysLeft(world: World): number {
  const c = world.caravan;
  if (!c) return 0;
  const s = settlementById(world, c.settlementId);
  const legs = c.phase === 'outbound' && s ? legTicks(s) : 0;
  return Math.max(0, (c.dueTick - world.tick + legs) / TICKS_PER_DAY);
}

/**
 * One tick of the road.
 *
 * Deliberately not inside the pawn loop — the traveller is not on the map, and
 * giving the road its own pass is cheaper than teaching six other passes to skip
 * a body that is not there.
 */
export function tickCaravan(world: World): void {
  const c = world.caravan;
  if (!c) return;
  if (world.tick < c.dueTick) return;
  const s = settlementById(world, c.settlementId);
  if (!s) {
    world.caravan = null;
    return;
  }

  if (c.phase === 'outbound') {
    // Its own dice, seeded off the map and the visit, so the same colony taking
    // the same run gets the same luck twice and no other system moves.
    const rng = new Rng((world.seed ^ ((s.id * 733 + s.visits + 1) * 0x9e3779b9)) >>> 0);
    s.visits++;
    if (rng.chance(mishapChance(s, c.pawn))) {
      // Robbed. The pack is gone and so is the trip; they are hurt but walking,
      // because the alternative is a settler who dies where nobody can see it.
      c.take = null;
      c.pawn.hp = Math.max(12, Math.round(c.pawn.maxHp * 0.35));
      msg(
        world,
        `${c.pawn.name} is set upon on the road to ${s.name}. The pack is gone; they are walking home hurt.`,
        'bad',
      );
    } else {
      c.take = quote(s, c.pawn, c.give);
      // Stamped so `commissions.ts` can settle up on this same tick without this
      // file having to know that commissions exist. See the note at the top of
      // that one: the import runs one way and this is the whole of the seam.
      c.dealtTick = world.tick;
      s.relations = Math.min(RELATIONS_MAX, s.relations + RELATIONS_PER_VISIT);
      msg(
        world,
        `${c.pawn.name} reaches ${s.name} and deals: ${c.give.amount} ${c.give.kind} for ${c.take.amount} ${c.take.kind}.`,
        'good',
      );
    }
    c.phase = 'inbound';
    c.dueTick = world.tick + legTicks(s);
    return;
  }

  // Home. Put them back where they left, drop the goods at their feet, and let
  // the haulers who were going to fetch them anyway fetch them.
  const spot = nearestWalkable(world, c.x, c.y, 8) ?? { x: c.x, y: c.y };
  const pawn = c.pawn;
  pawn.x = spot.x;
  pawn.y = spot.y;
  pawn.jobId = null;
  pawn.path = null;
  pawn.activity = 'idle';
  pawn.carryingItemId = null;
  pawn.drafted = false;
  pawn.orderX = null;
  pawn.orderY = null;
  // A week on the road. Not empty — they ate out of the pack — but they want a
  // meal and a bed, and the colony gets to see the cost written on them.
  pawn.needs.food = Math.min(pawn.needs.food, 0.35);
  pawn.needs.rest = Math.min(pawn.needs.rest, 0.3);
  gainSkill(world, pawn, 'social', SOCIAL_PER_TRIP);
  world.pawns.push(pawn);
  world.caravan = null;

  if (c.take) {
    if (c.take.kind === 'rawfood') {
      world.stats.rawGathered = (world.stats.rawGathered ?? 0) + c.take.amount;
    }
    addItem(world, c.take.kind, c.take.amount, spot.x, spot.y);
    world.stats.caravans = (world.stats.caravans ?? 0) + 1;
    msg(world, `${pawn.name} is back from ${s.name} with ${c.take.amount} ${c.take.kind}.`, 'good');
  } else {
    msg(world, `${pawn.name} limps back in from the ${s.name} road with nothing.`, 'bad');
  }
}

/**
 * The surplus a colony has to be sitting on before it sends somebody out
 * unasked, by resource.
 *
 * Well above anything the colony needs to hand: this is the pile that has
 * stopped being a safety margin and started being a stack of wood in the rain.
 */
const SURPLUS: Record<ResourceKind, number> = {
  wood: 260,
  steel: 240,
  rawfood: 300,
  meal: 140,
  medicine: 40,
  // Low, because a colony that has dressed everybody has no further use for
  // hides at all and the pile only grows from there.
  hide: 120,
};

/** The most they will load, and the least worth walking for. */
const PACK_MAX = 150;
const PACK_MIN = 40;

/**
 * One pack of each thing, for the panel.
 *
 * A player ordering a caravan picks a *place*, not an amount: the sizes are
 * fixed at roughly what one settler can carry and are within a third of each
 * other in worth, so "which pack" is a question about what the colony can spare
 * rather than arithmetic. Anything that wants a custom amount can call
 * `orderCaravan` with one.
 */
export const PACK_SIZES: Record<ResourceKind, number> = {
  wood: 80,
  steel: 50,
  rawfood: 70,
  meal: 30,
  medicine: 8,
  hide: 40,
};

/** What the colony can spare, or null if it can spare nothing. */
export function spareGoods(world: World): { kind: ResourceKind; amount: number } | null {
  let best: { kind: ResourceKind; amount: number } | null = null;
  for (const kind of Object.keys(SURPLUS) as ResourceKind[]) {
    const over = countResource(world, kind) - SURPLUS[kind];
    if (over < PACK_MIN) continue;
    const amount = Math.min(PACK_MAX, Math.floor(over * 0.6));
    if (amount < PACK_MIN) continue;
    // Measured in worth, not in units, so a hundred wood does not beat forty
    // medicine just because a hundred is the bigger number.
    if (!best || amount * VALUE[kind] > best.amount * VALUE[best.kind]) best = { kind, amount };
  }
  return best;
}

/**
 * The colony's own best talker.
 *
 * The trip is levelled by doing it, so this concentrates the skill in one person
 * rather than spreading it thin across everybody — which is the point. A colony
 * with a trader has something a colony with six amateurs does not.
 */
export function bestTalker(world: World): Pawn | null {
  let best: Pawn | null = null;
  for (const p of livingColonists(world)) {
    if (p.downed || p.playerControlled) continue;
    if (!best || socialOf(p) > socialOf(best)) best = p;
  }
  return best;
}

/**
 * Fit to set off — not "carrying days of reserve", which is what these numbers
 * used to mean and never actually bought.
 *
 * They were written as if the traveller's needs ran while they walked. They do
 * not: `departCaravan` lifts the pawn off the map, the road is abstracted to a
 * tick count, and whatever they left with they come home on 0.35 food and 0.3
 * rest by the clamp above. So a settler who set out stuffed and one who set out
 * peckish arrive in exactly the same state, and the old 0.6/0.5 was buying the
 * colony nothing at all.
 *
 * What it cost was the feature. The gate is a snapshot of a value that swings
 * from 1 down to `HUNGRY` and back every day, and it is only ever read on the
 * handful of ticks a settler is between jobs — and on a map this size the best
 * talker is between jobs about five times a day. A whole day of seed 90210 with
 * an open letter, the goods in the barn and every other condition met produced
 * one such moment, and even that one went to a rec break: the letter lapsed
 * with nobody having decided anything. A rule that fires by coincidence is not
 * a rule, it is a bug with a comment on it.
 *
 * So the honest question at the gate is the one a person would ask — am I
 * hungry, am I tired — and it is asked in exactly those terms so the two can
 * never drift from what the words mean elsewhere. The margin above each is one
 * bad afternoon's worth: enough that somebody who is *about* to want a meal
 * eats it before loading the pack rather than on the road.
 */
const ROAD_FOOD = HUNGRY + 0.06;
const ROAD_REST = TIRED + 0.06;

/**
 * May this settler load a pack and go?
 *
 * The same shape as `scoutingAllowed`, and stricter in every term: this is the
 * same decision as scouting with the stakes multiplied by the length of the
 * road.
 */
export function caravanAllowed(world: World, pawn: Pawn): boolean {
  if (world.gameOver) return false;
  if (world.caravan) return false;
  if (world.jobs.some((j) => j.kind === 'caravan')) return false;
  if (isSleepHours(world)) return false;
  if (world.storyteller.raidActive || hostiles(world).length > 0) return false;
  if (world.fires.length > 0) return false;
  // A colony of three that sends one away is a colony of two, and two people
  // cannot hold a wall. Four is the first number where this is a decision rather
  // than a gamble.
  if (livingColonists(world).length < 4) return false;
  if (pawn.needs.food <= ROAD_FOOD || pawn.needs.rest <= ROAD_REST) return false;
  // Whoever talks best goes. Anyone else walking it is the colony throwing away
  // the only thing that makes the price good.
  return bestTalker(world)?.id === pawn.id;
}

/**
 * Where an unasked trade run would go, or null if none is worth making.
 *
 * Nearest first among the ones that want what the colony has spare, then nearest
 * outright: the walk is the cost, so the colony pays as little of it as it can.
 */
export function pickDestination(world: World, give: ResourceKind): Settlement | null {
  // Used to be "nearest town that wants it", which was fine while every
  // neighbour was interchangeable. Now that some of them have workshops, the
  // nearest buyer is often the wrong answer: a crate of balm is worth twice as
  // much four days out at the place with no brewer as it is two days out at the
  // place that brews its own. So rank by what comes home, discounted by the
  // walk, and let the specialty earn the extra days.
  let best: Settlement | null = null;
  let bestScore = -1;
  for (const s of settlementsOf(world)) {
    const worth = VALUE[give] * rateOf(s, 0, give);
    const score = worth / (s.days + 1);
    // Ties break toward the nearer town, which is also the old behaviour when
    // nothing on the map has a workshop.
    if (score > bestScore || (score === bestScore && best !== null && s.days < best.days)) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}
