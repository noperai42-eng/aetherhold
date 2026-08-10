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
import { packScale, researchNeeds, roadSafety } from './research';
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
  /**
   * Milled parts. Set from the road, and set twice — the first derivation was
   * measured against a pack the colony does not own on the day it needs one.
   *
   * That reasoning went: a middle-ring road walks a pack of three hundred steel,
   * five hundred and seventy of worth, quoted to a stranger at about 0.74 — call
   * it four hundred and twenty of parts a trip, so fourteen apiece buys thirty,
   * and a tier wanting sixty costs the two round trips it is meant to. Every
   * step of that is true about `packLimit`. None of it is true about the load.
   * The foreman does not ship a road's limit; he ships `spareGoods`, which is
   * what is left after `SURPLUS` and then six tenths of that. A quiet valley
   * unlocks this tier holding about three hundred and twenty steel, so what
   * actually walks out of the gate is fifty. Seventy of worth. Five components.
   *
   * The probe, on the calm map that ended at fifteen projects of nineteen:
   * `d40 STALL needs componentsx12` · `d41 DEPART sells=components give=steelx50`
   * · `d53 PARTS 0 -> 5`. Twelve days of walking for five of a bill of twelve,
   * against a tier that opens with twenty days left on the clock — sixteen trips
   * where the design said two or three.
   *
   * So it is derived from the load instead: seventy of worth a trip at the
   * moment the tier opens. At five and a half that first walk comes home with
   * twelve, which is the foundry's bill exactly, and a colony that has let its
   * pile grow to seven hundred spares two hundred and seventy-six and clears
   * the rest of the tier in one more. That last part is the point rather than a
   * side effect: what a colony can buy here scales with the steel it has spare,
   * which is the only way a fixed bill can be neither a sink on the quiet valley
   * nor a wall on hard country.
   *
   * Nothing on the map makes it, so unlike every other line here this number
   * cannot open a loop by being wrong — there is no second route to a component
   * to arbitrage against. What it sets is purely how much road a project costs.
   */
  components: 5.5,
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

/**
 * Standing gained by walking a pack to somebody's door, by ring.
 *
 * A longer road is a bigger commitment and the people at the far end of it know
 * that: six days out with a pack on your back buys more goodwill than a stroll to
 * the next valley. The same argument as `RING_PACK` — distance is the cost the
 * whole trade system is denominated in, so it is what the rewards scale on.
 *
 * It is also what makes the far country reachable inside a run. The first grid
 * that shipped the rings paid a flat six everywhere, so the middle ring wanted
 * three visits to vouch — thirty-odd days of walking against a window with
 * forty-two in it, and only three runs in ten ever got out there. They did not run
 * out of goods, they ran out of calendar. At ten a visit the middle ring vouches
 * after two, which is the difference between a road most colonies walk and a road
 * most colonies hear about.
 */
const RING_STANDING: readonly number[] = [6, 10, 14];

/** Standing gained by walking a pack to the near ring, which is the baseline. */
export const RELATIONS_PER_VISIT = RING_STANDING[0]!;
export const RELATIONS_MAX = 100;

/** What one visit here is worth, which is what the road here cost. */
export function relationsPerVisit(s: Settlement): number {
  return RING_STANDING[ringOf(s)] ?? RELATIONS_PER_VISIT;
}

/** Social levelled by one completed round trip. Four or five runs is a specialist. */
export const SOCIAL_PER_TRIP = 0.9;

/**
 * The names over the ridge, in two pools.
 *
 * The split is load-bearing rather than flavour. The near ring draws from the
 * first list exactly as it always did — same eight names, same draw, same order
 * of dice — so every seed ever played still meets the four neighbours it met
 * before the world had any depth to it. The country past them draws from its
 * own list, which holds eight names for eight places and is therefore a
 * shuffling rather than a choice.
 */
const NEAR_NAMES = [
  'Ashfen',
  'Marrow Deep',
  'Kell Hollow',
  'Sarn Crossing',
  'Ondways',
  'Bitterfold',
  'Greyreach',
  'Ninefold',
];

/** The country past the near ring. Eight names for the eight places out there. */
const FAR_NAMES = [
  'Fallowmere',
  'Stonewake',
  'Duskmoor',
  'Harrowgate',
  'Coldwater',
  'Emberfall',
  'Longbarrow',
  'Saltmarch',
];

/** Everything a settlement might be short of. Depth changes what they sell, never what they want. */
const KINDS: ResourceKind[] = ['wood', 'steel', 'rawfood', 'meal', 'medicine'];

/** How many places sit in each ring. Four is one per quarter of the compass. */
const PER_RING = 4;

/**
 * The world, in rings.
 *
 * Distance was always the entire cost of dealing with somebody, so distance is
 * what the depth is made of. The near ring is today's four, unchanged down to
 * the list of things they might be sitting on: every number on the setup card
 * was calibrated against those four, and quietly moving them would recalibrate
 * the game while claiming to have added to it. The middle ring is five or six
 * days out and is where the workshops are — it sells what somebody made rather
 * than what somebody dug up. The far ring is nine or ten days out, deals only in
 * the dense stuff worth carrying that far, and is not somewhere a young colony
 * goes at all.
 */
const RINGS: ReadonlyArray<{ days: readonly number[]; sells: readonly ResourceKind[] }> = [
  { days: [1, 2, 2, 3], sells: KINDS },
  { days: [5, 5, 6, 6], sells: ['components', 'meal', 'medicine', 'steel'] },
  { days: [9, 9, 10, 10], sells: ['steel', 'medicine'] },
];

/**
 * Make sure somebody out in the middle country sells parts.
 *
 * Every town draws its stock one at a time and always has — five things it might
 * have too much of, four places to have it, and whether anybody within a day's
 * walk sells medicine this run is exactly the kind of thing a seed is allowed to
 * decide. Nothing is gated on the near ring, so a bad draw there is colour.
 *
 * The middle ring is the only place in the world that sells components, and a
 * straight per-town draw leaves better than three maps in ten — (3/4)⁴, about
 * 32 % — with no parts anywhere on them. A colony that walked two vouches out to
 * the workshops and found four towns all selling steel has been shut out of the
 * last tier of the tree by a coin, and would have no way of knowing that is what
 * happened.
 *
 * So this repairs the draw instead of replacing it, and that distinction is the
 * whole point. The first version dealt the ring from a shuffled bag: guaranteed,
 * elegant, and it moved every die after it. Measured on the sixty-day grid, that
 * cost eight foundings out of fifteen down to four, and the far gate open on
 * seven maps in ten down to three — not because dealing is worse, but because a
 * different draw order is a different world, and the fourteen maps that already
 * had a parts town were re-rolled for nothing. Repairing touches only the two in
 * three that need it, spends no dice at all, and leaves every other seed's
 * bearings, names and stock exactly where they were.
 *
 * Which town gets converted is the *second* seller of whatever the ring has most
 * of, because with four towns drawing from four kinds a ring missing components
 * must be doubled up somewhere. That is what keeps this from taking away the only
 * medicine in the middle country to hand out parts.
 */
export function ensureParts(ring: Settlement[]): void {
  if (ring.some((s) => s.sells === 'components')) return;
  const count = new Map<ResourceKind, number>();
  for (const s of ring) count.set(s.sells, (count.get(s.sells) ?? 0) + 1);
  let most: ResourceKind | null = null;
  for (const [kind, n] of count) {
    if (most === null || n > count.get(most)!) most = kind;
  }
  const doubled = ring.filter((s) => s.sells === most);
  const victim = doubled[doubled.length - 1];
  if (!victim) return;
  victim.sells = 'components';
  // `buys` is left alone and is still right. It was drawn from everything the
  // town was not sitting on, and a parts town is short of all five ordinary
  // goods — so whatever it wanted before, it still wants. `craft` has to be
  // re-derived and comes back null: nothing on the map makes components, so a
  // parts town is a place that mills rather than a place with a workshop.
  victim.craft = craftFor('components', victim.id);
}

/** Every settlement on a map, near ring first. */
const NEIGHBOUR_COUNT = RINGS.length * PER_RING;

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
  const known = world.settlements;
  if (known && known.length >= NEIGHBOUR_COUNT) return known;
  const rng = new Rng((world.seed ^ 0x5bf03635) >>> 0);
  const near = [...NEAR_NAMES];
  const far = [...FAR_NAMES];
  const made: Settlement[] = [];
  for (let ring = 0; ring < RINGS.length; ring++) {
    const { days, sells: stock } = RINGS[ring]!;
    const names = ring === 0 ? near : far;
    const first = made.length;
    for (let i = 0; i < PER_RING; i++) {
      const name = names.splice(rng.int(names.length), 1)[0]!;
      // One per quarter of the compass, jittered inside it. Four places all out
      // past the same treeline would make "which way is Ashfen" a question with
      // no answer, and the bearing is most of what makes them feel like places.
      // Each ring is turned a sixth of a quarter against the one inside it, so
      // the far country reads as being *behind* the near country rather than
      // hidden directly under it.
      const bearing = (i * Math.PI) / 2 + (ring * Math.PI) / 6 + rng.range(-0.5, 0.5);
      const sells = stock[rng.int(stock.length)]!;
      // Never short of the thing they are drowning in. A parts town is short of
      // all five ordinary goods, because it does not produce any of them — which
      // is the right answer and falls straight out of `components` not being on
      // the list of things anybody trades *for*.
      const wants = KINDS.filter((k) => k !== sells);
      const id = made.length + 1;
      made.push({
        id,
        name,
        bearing,
        days: days[i] ?? 2,
        sells,
        buys: wants[rng.int(wants.length)]!,
        craft: craftFor(sells, id),
        ring: ring as 0 | 1 | 2,
        relations: 0,
        visits: 0,
      });
    }
    // After the ring is drawn, never during it — a repair that ran inside the
    // loop would have to guess at towns that do not exist yet.
    if (ring === 1) ensureParts(made.slice(first));
  }
  // A save from before the world had depth already knows its near ring, and that
  // ring is who the colony has been trading with — so it is kept, standing and
  // all, and only the country past it is new. The draw above reproduces those
  // four exactly for the seed, so this is a splice rather than a merge.
  if (known) made.splice(0, known.length, ...known);
  world.settlements = made;
  return made;
}

/**
 * How deep this place sits, tolerating a save written before the world had
 * rings. Read off the distance, which is what the ring *is*.
 */
export function ringOf(s: Settlement): 0 | 1 | 2 {
  if (s.ring === undefined) s.ring = s.days <= 3 ? 0 : s.days <= 6 ? 1 : 2;
  return s.ring;
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
 *
 * The per-day figure is 0.035 and not 0.06 because of where the cap landed. At
 * 0.06 a five-day road computes 0.30 and a six-day road 0.36, so both
 * middle-ring roads sat exactly on the cap — and so did every far-ring road.
 * Three rings, one risk. The cap was written for the far country and caught the
 * middle country by accident, and it flattened the distance term at precisely
 * the distance where the ring structure starts.
 *
 * What that cost is not a matter of taste. A robbed party turns back on the
 * outbound leg and earns no standing, a vouch costs two arrivals, and two trips
 * both landing against a capped thirty per cent is 0.72² — a hair over half. So
 * the far country was behind a coin flip, and the sixty-day grid read exactly
 * that: of the runs that sent two parties past the near ring one opened it, and
 * of the runs that sent three or four, four did.
 *
 * At 0.035 the rings are three different roads again — about 4 to 10 per cent
 * near, 18 to 21 in the middle, and the far ring still pinned to the cap, which
 * is where the cap was always meant to bind and nowhere else.
 */
export function mishapChance(s: Settlement, pawn: Pawn, world?: World): number {
  const raw =
    0.035 * s.days -
    Math.max(0, s.relations) * 0.0004 -
    (pawn.skills?.shooting ?? 0) * 0.004 -
    // Sheds and caches, subtracted before the cap rather than after it. After
    // the cap it would be worth nothing on the far ring, which is pinned there
    // and is the only road anyone would build waystations for.
    (world ? roadSafety(world) : 0);
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

/**
 * Meals the pantry has to hold, per day of road, before a party sets out.
 *
 * A readiness test rather than a toll: the goods are not taken, because the
 * traveller has always eaten out of their own pack and turning that into a
 * second withdrawal would make one trip cost two packs. What it says is that a
 * colony living hand to mouth has no business sending anybody over the horizon,
 * and — because it is denominated in the colony's own cooking rather than in a
 * constant — it asks the same question of Hard country that it asks of the quiet
 * valley, at the scale each of them actually runs at.
 */
const ROAD_MEALS_PER_DAY = 2;

/**
 * Standing somebody one ring in will want before they see a stranger past their
 * own gate. Three ordinary visits, or one answered letter and a bit.
 *
 * This is the whole of why the far ring is *earned* rather than unlocked. There
 * is no counter that ticks up on its own: reaching the middle ring means having
 * dealt with the near one until they know your face, and reaching the far ring
 * means having done the same again with somebody five days out — which cannot
 * happen until the middle ring is open, so the depth is walked rather than
 * waited out.
 */
export const PASSAGE_RELATIONS = 18;

/**
 * Settlers who have to stay home while a party is on this ring's road.
 *
 * Counted as who is *left*, not as a headcount, because that is the sentence a
 * player reads and the two differ by the traveller. The colony is founded with
 * three, which is deliberately just enough for the middle ring and not enough
 * for the far one: the near ring asks nothing, the middle ring asks that the
 * valley is not emptied, and the far ring — a party gone the better part of
 * three weeks — asks that the colony has actually grown since the founding.
 *
 * Kept low on purpose. The gate that is supposed to be interesting is the
 * standing one; if headcount bound first, the far country would be a population
 * counter wearing a trade system's clothes.
 */
const ESCORT_FLOOR = [1, 2, 4];

/**
 * How much one party carries, as a multiple of a settler's pack, by ring.
 *
 * Not a fudge for the far ring's arithmetic — it *is* the far ring's arithmetic.
 * `pickDestination` scores worth against days, so a nine-day place carrying a
 * one-settler pack loses to the neighbour up the valley by five to one no matter
 * what it pays, and a road nothing ever walks is not a road. A party going over
 * the horizon for three weeks goes with handcarts and more than one back, which
 * is the same reason the colony has to be able to spare the hands and feed them.
 * The no-arbitrage guarantee does not notice: every quote is still worth times a
 * rate below `RATE_CAP`, and multiplying both sides of that does not make steel
 * out of steel.
 */
const RING_PACK = [1, 2, 4];

/** How many settlers' worth of load this road takes. */
export function packMultiple(s: Settlement): number {
  return RING_PACK[ringOf(s)] ?? 1;
}

/**
 * The largest pack that goes out on this road.
 *
 * Takes a world because Freighting makes every cart on the board bigger, and is
 * tolerant of not being given one: `PACK_CEILING` and the panel's pack sizes are
 * asked about roads in the abstract, before anybody has chosen a destination or,
 * in the ceiling's case, before there is a colony at all.
 */
export function packLimit(s: Settlement, world?: World): number {
  return Math.floor(PACK_MAX * packMultiple(s) * (world ? packScale(world) : 1));
}

export type Reach = { ok: true } | { ok: false; text: string };

/**
 * Can the colony put a party on the road to this place at all?
 *
 * Distance is the gate, and this is what the gate is made of: food for the road,
 * hands to spare for it, and somebody nearer who will vouch for you. Every
 * refusal is a sentence for the same reason `planCaravan`'s are — a locked road
 * that does not say what would unlock it has taught the player that the far
 * country is decoration.
 */
export function withinRange(world: World, s: Settlement): Reach {
  const ring = ringOf(s);
  if (ring === 0) return { ok: true };

  const inside = settlementsOf(world).filter((o) => ringOf(o) === ring - 1);
  const vouch = inside.reduce((best, o) => Math.max(best, o.relations), 0);
  if (vouch < PASSAGE_RELATIONS) {
    const nearest = inside.reduce(
      (best: Settlement | null, o) => (best === null || o.relations > best.relations ? o : best),
      null,
    );
    return {
      ok: false,
      text: nearest
        ? `Nobody on this road will vouch for you yet — ${nearest.name} stands at ${Math.round(nearest.relations)} of ${PASSAGE_RELATIONS}.`
        : 'There is nobody nearer who could see you past their own gate.',
    };
  }

  const needed = ROAD_MEALS_PER_DAY * 2 * s.days;
  const meals = countResource(world, 'meal');
  if (meals < needed) {
    return { ok: false, text: `${needed} meals feed that road there and back. The pantry holds ${meals}.` };
  }

  const floor = ESCORT_FLOOR[ring] ?? 1;
  const staying = livingColonists(world).length - 1;
  if (staying < floor) {
    return {
      ok: false,
      text: `A party gone ${s.days * 2} days wants ${floor} left holding the valley. There would be ${Math.max(0, staying)}.`,
    };
  }

  return { ok: true };
}

/** Is any place in this ring reachable right now? What the far-ring principle reads. */
export function ringOpen(world: World, ring: number): boolean {
  return settlementsOf(world).some((s) => ringOf(s) === ring && withinRange(world, s).ok);
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
  // Range is checked before the pack, because "you cannot get there" is the
  // answer that stands however much wood is in the yard.
  const reach = withinRange(world, s);
  if (!reach.ok) return { ok: false, text: reach.text };
  if (give.amount > packLimit(s, world)) {
    return { ok: false, text: `That is more than one party carries to ${s.name}.` };
  }
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
    if (rng.chance(mishapChance(s, c.pawn, world))) {
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
      s.relations = Math.min(RELATIONS_MAX, s.relations + relationsPerVisit(s));
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
  /**
   * Never. A colony does not have spare components.
   *
   * Every one of them was walked here across five days of open country to be
   * spent at the bench, and the foreman sending them back out because the pile
   * looked large would be undoing the last three weeks of its own work. The
   * number is above anything the tier can ask for rather than merely large, so
   * "the foreman will not trade these away" is a fact about the table and not a
   * bet on how much the colony happens to be holding.
   *
   * The player may still load a crate of them onto somebody's back from the
   * panel and walk it to a town that will take it. They will be quoted for it
   * like anything else and they will lose on the deal, which is the honest
   * answer to selling a thing back to the people who make it.
   */
  components: 100000,
};

/** The most they will load, and the least worth walking for. */
const PACK_MAX = 150;
const PACK_MIN = 40;

/**
 * The biggest pack any road on the board takes, before anybody has built a cart.
 * What "spare" is measured against, since what is spare is known before the road
 * is chosen.
 */
export const PACK_CEILING = PACK_MAX * Math.max(...RING_PACK);

/**
 * The same ceiling for a colony that has done some reading.
 *
 * Freighting is worth nothing if the foreman goes on measuring what it can spare
 * against the cart it used to have: it would fill the old load, find the new one
 * half empty, and the project would have bought a bigger sack nobody puts
 * anything in.
 */
export function packCeiling(world: World): number {
  return Math.floor(PACK_CEILING * packScale(world));
}

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
  // Sixteen, which is within a third of the worth of every other pack here —
  // the rule this table is built on, re-struck when `VALUE.components` was.
  // It exists so the panel can offer the button; the foreman never reaches for
  // it, for the reason in `SURPLUS`.
  components: 16,
};

/**
 * What the colony can spare, or null if it can spare nothing.
 *
 * `limit` is the biggest pack anywhere on the board rather than the biggest one
 * this trip will take — the destination is picked *after* this, out of what is
 * spare, and each road then clamps the load to what a party walks it with. Asked
 * for the near ring's limit it answers exactly what it always did.
 */
export function spareGoods(
  world: World,
  limit: number = PACK_MAX,
): { kind: ResourceKind; amount: number } | null {
  let best: { kind: ResourceKind; amount: number } | null = null;
  for (const kind of Object.keys(SURPLUS) as ResourceKind[]) {
    const over = countResource(world, kind) - SURPLUS[kind];
    if (over < PACK_MIN) continue;
    const amount = Math.min(limit, Math.floor(over * 0.6));
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
 * What a trip is worth over and above the crate it carries, when the trip is
 * what opens the next ring.
 *
 * Left to plain worth-over-distance the foreman is a throughput machine and the
 * map collapses to one town: the closest neighbour turns a pack around five
 * times while a nine-day road turns it once, so it wins every comparison, and
 * every trip raises its standing, which raises its rate, which makes it win by
 * more. Thirty-five runs to the same gate and eleven places nobody has ever
 * seen. That is correct arithmetic and a dead world, and it is self-sealing:
 * standing is only bought by showing up, so a colony that never goes anywhere
 * never earns the vouch, and the far country stays shut not because it is far
 * but because nothing ever went anywhere.
 *
 * The fix is not to make the long road pay better — it does not, and pretending
 * otherwise would be a thumb on the exchange rate. It is that a road, once
 * opened, stays open, and the colony knows it. A crate sold at the gate is worth
 * a crate. A crate sold to the one household five days out who will vouch for
 * you is worth a crate *and the country behind them*, and a colony weighs it
 * that way until the vouch is in hand — then stops, because the road is open and
 * a crate is a crate again.
 *
 * Five, and the first grid to measure trade traffic is why it is not two.
 *
 * Two was derived from throughput — the near ring turns a pack round about twice
 * as fast as the middle one *when both are carrying a full load*. They almost
 * never are. `carried` is `min(spare, packLimit)`, and a colony has to be sitting
 * on more than a whole near-ring pack before the middle ring's double pack is
 * anything but decoration: about six hundred and forty meals against a reserve of
 * a hundred and forty. Below that both roads carry the same crate, the load falls
 * out of the comparison entirely, and what is left is bare distance — one day
 * against five or six, which is a factor of three that a bonus of two cannot
 * close. So the number was right about a regime the game is hardly ever in.
 *
 * What it has to beat, taken from the constants above rather than from feel: the
 * best a near town can quote is `RATE_BASE + RATE_WANTED + RATE_CRAFT_OUTPUT`
 * plus a run's worth of standing, a shade under 0.9, at one day out — call it
 * 0.9/2. A middle-ring town the colony has never visited quotes 0.74 at five days
 * out, so it needs 0.74/6 × bonus to clear 0.45, which wants a shade over three
 * and a half. Four would be an eleven per cent edge, which is inside the noise of
 * which good happens to be spare that morning; five leaves the decision no room
 * to wobble.
 *
 * It is still deliberately a cliff rather than a slope: the moment a place
 * vouches, the reason to keep walking there is gone. The cliff is what keeps a
 * bonus this size from distorting anything — it can only ever buy the two trips
 * that open the road, and it is unreachable again the moment they are made.
 */
const GATE_BONUS = 5;

/**
 * Worth this place, if it sells something the bench is waiting on.
 *
 * The third tier of the research tree is bought with milled parts, and nothing
 * in this valley makes a milled part — the only way one arrives is that somebody
 * walked to a town that sells them. But `pickDestination` scores by what a pack
 * is *worth*, and worth knows nothing about what comes home in exchange. Without
 * this the foreman would carry steel to the best-paying neighbour forever and
 * the last four projects would sit at a hundred per cent, unfinishable, with the
 * player watching a bar that never moves. So: a town that stocks the thing the
 * bench is short of is worth more than the price it quotes.
 *
 * Three, from the same arithmetic as `GATE_BONUS` and to be beaten by it. A near
 * neighbour quoting its best at one day out scores about a hundred and thirty; a
 * middle-ring town nobody here has met quotes 0.74 on a double pack five days
 * out and scores about seventy. That is a gap of one and eight tenths, so two
 * would flip the choice and leave it wobbling on whichever good happened to be
 * spare that morning. Three clears it with room and still loses to a trip that
 * opens a ring — which is the right order, because parts cannot be fetched from
 * behind a gate that is still shut.
 *
 * A cliff, and self-cancelling like the gate one: `researchNeeds` returns only
 * the *shortfall*, so the moment the crates are in the yard this is 1 again and
 * the foreman goes back to trading on price. When the bench wants nothing — which
 * is every project below the third tier, and so every run the grid has measured
 * so far — it is 1 for every town on the map and this changes nothing.
 */
const NEED_BONUS = 3;

/**
 * Where an unasked trade run would go, or null if none is worth making.
 *
 * Nearest first among the ones that want what the colony has spare, then nearest
 * outright: the walk is the cost, so the colony pays as little of it as it can.
 */
export function pickDestination(
  world: World,
  give: ResourceKind,
  amount: number = PACK_MAX,
): Settlement | null {
  // Used to be "nearest town that wants it", which was fine while every
  // neighbour was interchangeable. Now that some of them have workshops, the
  // nearest buyer is often the wrong answer: a crate of balm is worth twice as
  // much four days out at the place with no brewer as it is two days out at the
  // place that brews its own. So rank by what comes home, discounted by the
  // walk, and let the specialty earn the extra days.
  let best: Settlement | null = null;
  let bestScore = -1;
  // Which rings are still shut, worked out once rather than per candidate —
  // `ringOpen` walks the settlement list and counts the pantry, and asking it
  // twelve times over would make choosing a destination cost more than walking
  // to one. Index is the ring being *entered*, so [0] is meaningless and only
  // the two outer rings are gates: there is nothing past the far one to open.
  const shut = [false, !ringOpen(world, 1), !ringOpen(world, 2)];
  // What the bench is waiting on, asked once for the same reason as `shut`.
  // Usually empty, and empty means every multiple below is 1.
  const wanted = new Set(researchNeeds(world).map((n) => n.kind));
  for (const s of settlementsOf(world)) {
    // A road the colony cannot walk is not a choice it gets to weigh. Checked
    // here as well as in `planCaravan` because the foreman never goes near the
    // panel, and a caravan job created for somewhere out of reach would be a
    // settler who walks to the map edge and turns round.
    if (!withinRange(world, s).ok) continue;
    // What actually comes home, not what one crate is worth: the far ring goes
    // with handcarts, and a score that ignored the size of the load would rank
    // three weeks of road against an afternoon's and never once pick the road.
    const carried = Math.min(amount, packLimit(s, world));
    const worth = VALUE[give] * carried * rateOf(s, 0, give);
    // Worth this place, if walking to it is also what opens the ring behind it.
    const opens = shut[ringOf(s) + 1] === true && s.relations < PASSAGE_RELATIONS;
    // The larger of the two reasons, not both multiplied together. They are
    // independent facts about the same trip and a town that is both would score
    // fifteen times its neighbours — a cliff that steep stops being a tiebreak
    // and starts being the only decision the foreman ever makes. Taking the
    // larger picks the same destination in every case that matters and leaves
    // the rest of the ranking recognisable.
    const bonus = Math.max(opens ? GATE_BONUS : 1, wanted.has(s.sells) ? NEED_BONUS : 1);
    const score = (worth / (s.days + 1)) * bonus;
    // Ties break toward the nearer town, which is also the old behaviour when
    // nothing on the map has a workshop.
    if (score > bestScore || (score === bestScore && best !== null && s.days < best.days)) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}
