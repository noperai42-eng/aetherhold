/**
 * The colony's long game.
 *
 * Everything else in Aetherhold is a loop that returns to where it started: you
 * chop the wood, you build the wall, you eat the meal, the day rolls over. That
 * is fine for an hour and thin for an evening, because nothing the colony does on
 * day nine is any different from what it did on day one. Research is the one axis
 * that only goes forward — points spent are permanently spent, and the colony that
 * comes out the other side of a project is measurably better at something than it
 * was.
 *
 * It is deliberately a *tree with a fork*, not a queue. There is no order that is
 * simply correct: a colony being ground down by raids wants Rifling, a colony
 * losing people to infection wants Field Medicine, and a colony that is fine wants
 * Toolmaking so everything after it arrives sooner. Choosing wrong costs a day,
 * which is what makes choosing a decision.
 *
 * Every tuning number lives here, including the effects — the systems that read
 * them (`jobs`, `combat`, `needs`) each call one function and stay ignorant of
 * what a project is. That is what stops "how much does Toolmaking give you" from
 * ending up spelled out in four files that drift apart.
 */

import type { BuildingKind, ResourceKind, World } from './types';
import { spendableResource, takeResource } from './world';

export type ResearchId =
  | 'toolmaking'
  | 'stonecutting'
  | 'fieldmedicine'
  | 'preserves'
  | 'rifling'
  | 'autoloaders'
  | 'soilbeds'
  | 'cartography'
  | 'machining'
  | 'plating'
  | 'solarcells'
  | 'tanning'
  | 'apprenticeship'
  | 'weaving'
  | 'plateworks'
  | 'foundry'
  | 'freighting'
  | 'instruments'
  | 'waystations';

export interface ResearchDef {
  id: ResearchId;
  label: string;
  /**
   * Work points.
   *
   * These were first sized on the assumption that a settler applies about one
   * point a tick and reaches the bench for maybe a quarter of the day — a
   * thousand points to the day. The thirty-day sweep said otherwise: a colony
   * with a dedicated researcher finished the entire tree before the end of day
   * three, because a settler at the bench is not interrupted the way a miner is
   * and their skill climbs the whole time they sit there. The numbers below are
   * sized against what that sweep actually measures — roughly four to five
   * thousand points of research in a day the colony can spare someone, so the
   * first project lands in the opening week and the last one is a month's work.
   */
  cost: number;
  /** Projects that must be finished first. */
  needs: ResearchId[];
  /**
   * Goods the project eats on the day it lands, on top of the points.
   *
   * Absent on everything up to and including the second tier, where a project is
   * purely a settler's afternoons and the only thing it can be short of is time.
   * The third tier is where the tree stops being free, and the bill is
   * deliberately in two parts that do different jobs:
   *
   * The *steel* line is a constant, and it is a constant on purpose. Its job is
   * to be a sink. The sixty-day grid had the quiet valley finishing the whole
   * tree on day thirty-seven and then sitting on nine hundred to thirteen
   * hundred steel with nothing left in the game to spend it on, and a sink only
   * works if it is big enough to notice. It is only ever reached by colonies the
   * same grid shows are holding that much, which is what makes a fixed number
   * safe here and nowhere else.
   *
   * The *components* line is the one that actually paces the tier, and it is not
   * denominated in a resource at all. Nothing in this valley makes a component;
   * they come off a middle-ring workshop's shelf, one pack per round trip, and
   * the pack is paid for with whatever the colony happens to have spare that
   * week. So the real price of a project is *a settler on the road for eleven
   * days* — the same price on a quiet valley as on hard country, which is
   * exactly what a fixed material cost could never be.
   */
  materials?: Partial<Record<ResourceKind, number>>;
  /** Player-facing, and the only place the effect is described in words. */
  blurb: string;
}

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  toolmaking: {
    id: 'toolmaking',
    label: 'Toolmaking',
    cost: 6000,
    needs: [],
    blurb: 'Better axes and picks. Every tree and every rock face gives half again as much.',
  },
  fieldmedicine: {
    id: 'fieldmedicine',
    label: 'Field medicine',
    cost: 9000,
    needs: [],
    blurb: 'Treatment closes wounds far faster, and a dose of medicine goes further.',
  },
  preserves: {
    id: 'preserves',
    label: 'Preserved rations',
    cost: 11000,
    needs: [],
    blurb: 'Salted and sealed. Meals fill a settler up by a third more and keep twice as long.',
  },
  stonecutting: {
    id: 'stonecutting',
    label: 'Stonecutting',
    cost: 13000,
    needs: ['toolmaking'],
    blurb: 'Unlocks the stone wall: three times the punishment of timber, and it will not burn.',
  },
  rifling: {
    id: 'rifling',
    label: 'Rifling',
    cost: 16000,
    needs: ['toolmaking'],
    blurb: 'Cut barrels. Your settlers shoot like veterans without the years.',
  },
  autoloaders: {
    id: 'autoloaders',
    label: 'Autoloaders',
    cost: 24000,
    needs: ['rifling'],
    blurb: 'Belt-fed turrets. Nearly twice the rate of fire from the same emplacement.',
  },

  // Second tier. A colony that gets this far has more hands than it has work for
  // them, which is exactly when the tree should have somewhere left to go — the
  // first sweep with research in it finished all six openers by day thirteen and
  // then spent a fortnight with a settler standing at an idle bench.
  soilbeds: {
    id: 'soilbeds',
    label: 'Raised soil beds',
    cost: 15000,
    needs: ['toolmaking'],
    blurb: 'Banked, turned and drained. The plot ripens half again as fast.',
  },
  cartography: {
    id: 'cartography',
    label: 'Cartography',
    cost: 17000,
    needs: ['toolmaking'],
    blurb: 'Charts of the valley. Scouts read a site in half the time.',
  },
  machining: {
    id: 'machining',
    label: 'Machining',
    cost: 22000,
    needs: ['stonecutting'],
    blurb: 'Jigs and dies at the workbench. A rifle or a course of medicine costs a third less.',
  },
  solarcells: {
    id: 'solarcells',
    label: 'Solar cells',
    cost: 26000,
    needs: ['machining'],
    blurb: 'Unlocks the solar panel: 200 W of daylight for no wood at all.',
  },
  plating: {
    id: 'plating',
    label: 'Composite plating',
    cost: 30000,
    needs: ['autoloaders'],
    blurb: 'Layered facings on walls and emplacements. Everything you build takes a third less punishment.',
  },

  // The clothing line. Nothing else on the tree spends hides, and nothing else
  // makes a settler personally better off — every project above this one is
  // something the *colony* owns. That is why it starts at the root with no
  // prerequisite: a colony that has hunted anything at all should be able to get
  // its people into coats without first inventing the pickaxe.
  tanning: {
    id: 'tanning',
    label: 'Tanning',
    cost: 7000,
    needs: [],
    blurb: 'Racks, ash and patience. Turns hides into leather — jerkins, toolbelts and a doctor’s bag.',
  },
  weaving: {
    id: 'weaving',
    label: 'Furriery',
    cost: 15000,
    needs: ['tanning'],
    blurb: 'Lined and double-stitched. Unlocks the fur parka, which is most of a winter night.',
  },
  /**
   * The one project that changes the settlers rather than the colony.
   *
   * Deliberately mid-tree and deliberately expensive for what it does, because
   * its value is entirely in *when* you take it: at day five it is most of a
   * second doctor by the end of the month, and at day forty it is nothing at all.
   * A project that is worth the same on any day is a project with no decision in
   * it.
   */
  apprenticeship: {
    id: 'apprenticeship',
    label: 'Apprenticeship',
    cost: 14000,
    needs: ['toolmaking'],
    blurb: 'Trades taught instead of stumbled into. Everybody here learns a third faster, at everything.',
  },
  plateworks: {
    id: 'plateworks',
    label: 'Plateworks',
    cost: 24000,
    needs: ['machining'],
    blurb: 'Beaten, quenched and strapped. Unlocks steel plate: two of every five hits stopped outright.',
  },

  // Third tier — the industrial base, and the first projects in the game that
  // cost something other than time.
  //
  // Everything above this point a colony can reach alone: put somebody at a
  // bench for a month and the whole second tier lands whether or not anyone has
  // ever walked over the ridge. That is why the tree ran out. The valley is a
  // closed system with a ceiling, and a closed system finishes.
  //
  // These four do not open on their own. Each wants a crate of milled parts that
  // only exists five days' walk away, so the tier is paced by how often the
  // colony can put somebody on a road and get them home — which is a clock the
  // valley does not control. It is also why what they *do* is roads, carts and
  // instruments rather than another point of armour: this is the tier where the
  // colony stops being a farm with a wall round it and starts being somewhere
  // that trades, and everything past it is built on being able to reach further.
  foundry: {
    id: 'foundry',
    label: 'Foundry',
    cost: 34000,
    needs: ['plateworks'],
    materials: { steel: 180, components: 12 },
    blurb:
      'A crucible line, a proper furnace and a set of patterns bought from people who use them. ' +
      'Everything the workbench makes costs a third less again.',
  },
  freighting: {
    id: 'freighting',
    label: 'Freighting',
    cost: 40000,
    needs: ['foundry'],
    materials: { steel: 220, components: 18 },
    blurb: 'Braced handcarts and axles that survive a ford. Every party that leaves here carries half again as much.',
  },
  instruments: {
    id: 'instruments',
    label: 'Precision instruments',
    cost: 46000,
    needs: ['foundry'],
    materials: { steel: 200, components: 22 },
    blurb: 'Calipers, gauges and tables somebody else spent a lifetime compiling. The bench studies half again as fast.',
  },
  waystations: {
    id: 'waystations',
    label: 'Waystations',
    cost: 52000,
    needs: ['freighting'],
    materials: { steel: 260, components: 28 },
    blurb: 'A shed, a cache and a name at every ford between here and the far country. The long roads stop eating parties.',
  },
};

/** Display order for the research panel: roughly cheapest-first, forks together. */
export const RESEARCH_ORDER: ResearchId[] = [
  'toolmaking',
  'tanning',
  'fieldmedicine',
  'preserves',
  'stonecutting',
  'apprenticeship',
  'weaving',
  'rifling',
  'autoloaders',
  'soilbeds',
  'cartography',
  'machining',
  'plateworks',
  'solarcells',
  'plating',
  // The third tier last, and in dependency order rather than by price. The
  // Steward takes the first thing this list offers it, so the order here is also
  // the order an unattended colony works the tier in — foundry opens the two
  // branches, the cheaper branch first, and the road project last because it is
  // the one worth having only once there is somewhere far enough to use it.
  'foundry',
  'freighting',
  'instruments',
  'waystations',
];

export interface ResearchState {
  /** Finished projects, in the order they landed. */
  done: ResearchId[];
  /** What the bench is working on, or null when nobody has chosen. */
  current: ResearchId | null;
  /** Points applied to `current`. Lives on the world, not the job, so a settler
   *  who is called away to eat does not throw away an afternoon's work. */
  progress: number;
}

export function makeResearch(): ResearchState {
  return { done: [], current: null, progress: 0 };
}

export function hasResearch(world: World, id: ResearchId): boolean {
  return world.research.done.includes(id);
}

/** Prerequisites met and not already finished — what the player may choose next. */
export function available(world: World): ResearchDef[] {
  return RESEARCH_ORDER.map((id) => RESEARCH[id]).filter(
    (def) => !hasResearch(world, def.id) && def.needs.every((n) => hasResearch(world, n)),
  );
}

/**
 * Point the bench at a project. Switching mid-way is allowed and costs the
 * progress — a colony that keeps changing its mind gets nothing, which is the
 * only pressure that makes the choice worth thinking about.
 */
export function setProject(world: World, id: ResearchId | null): boolean {
  if (id === null) {
    world.research.current = null;
    world.research.progress = 0;
    return true;
  }
  if (hasResearch(world, id)) return false;
  if (!RESEARCH[id].needs.every((n) => hasResearch(world, n))) return false;
  if (world.research.current !== id) {
    world.research.current = id;
    world.research.progress = 0;
  }
  return true;
}

/**
 * What the current project still wants that the colony has not got.
 *
 * Empty when the bench is idle, when the project is free, or when the goods are
 * already in the yard. Answered against what the colony could actually *pay* —
 * not the headline count, which includes the crate in a hauler's arms and would
 * have the panel promising a project the bench then refuses to finish.
 *
 * Deliberately answered from the moment the project is chosen rather than from
 * the moment the points run out. A colony that waits until the bench is at a
 * hundred per cent before it thinks about sending for the parts has volunteered
 * for a fortnight of standing still; a colony that reads this on day one puts
 * somebody on the road while it studies and finishes the two together. Both the
 * panel and the foreman read it, which is what makes the second of those the
 * behaviour an unattended colony actually has.
 */
export function researchNeeds(world: World): Array<{ kind: ResourceKind; amount: number }> {
  const id = world.research.current;
  const bill = id === null ? undefined : RESEARCH[id].materials;
  if (!bill) return [];
  const short: Array<{ kind: ResourceKind; amount: number }> = [];
  for (const [kind, want] of Object.entries(bill) as Array<[ResourceKind, number]>) {
    const gap = want - spendableResource(world, kind);
    if (gap > 0) short.push({ kind, amount: gap });
  }
  return short;
}

/**
 * The bench has done everything it can and is waiting on a delivery.
 *
 * A distinct state from "studying" and from "idle", and worth its own name
 * because it is the one the player has to be able to see: a bar sitting at full
 * with nothing happening is a bug unless the game says why.
 */
export function researchStalled(world: World): boolean {
  const id = world.research.current;
  if (id === null) return false;
  return world.research.progress >= RESEARCH[id].cost && researchNeeds(world).length > 0;
}

/**
 * Pay a project's bill, or pay none of it.
 *
 * All-or-nothing on purpose. A bill with two lines that took the steel, found
 * the parts short and left the project unfinished would quietly burn the
 * colony's stock every tick it stood there waiting — the worst kind of bug,
 * because the symptom is a number going down for no visible reason.
 */
function payMaterials(world: World, def: ResearchDef): boolean {
  const bill = def.materials;
  if (!bill) return true;
  const lines = Object.entries(bill) as Array<[ResourceKind, number]>;
  for (const [kind, want] of lines) {
    if (spendableResource(world, kind) < want) return false;
  }
  for (const [kind, want] of lines) takeResource(world, kind, want);
  return true;
}

/**
 * Apply a tick of study. Returns the project that just finished, if one did, so
 * the caller can say so out loud — this module never touches the message log.
 */
export function addResearchPoints(world: World, points: number): ResearchDef | null {
  const id = world.research.current;
  if (id === null) return null;
  const def = RESEARCH[id];
  // Clamped rather than accumulated. A project held up a fortnight waiting on a
  // crate would otherwise bank two weeks of study it never needed and hand the
  // overflow to whatever the colony chose next, which would make the stall pay
  // — and a stall that pays is not a reason to go anywhere.
  world.research.progress = Math.min(def.cost, world.research.progress + points);
  if (world.research.progress < def.cost) return null;
  if (!payMaterials(world, def)) return null;
  world.research.done.push(id);
  world.research.current = null;
  world.research.progress = 0;
  return def;
}

/** 0..1 through the current project, for the HUD bar. */
export function researchFraction(world: World): number {
  const id = world.research.current;
  if (id === null) return 0;
  return Math.min(1, world.research.progress / RESEARCH[id].cost);
}

// --- Effects -----------------------------------------------------------------
// One function per thing a project changes. The callers pass their base number
// through and never learn which project (or how many) was responsible.

/** Multiplier on wood from a felled tree and steel from a mined cell. */
export function toolYield(world: World): number {
  return hasResearch(world, 'toolmaking') ? 1.5 : 1;
}

/** Multiplier on how much a single treatment heals. */
export function treatmentPotency(world: World): number {
  return hasResearch(world, 'fieldmedicine') ? 1.9 : 1;
}

/** Multiplier on how far a cooked meal moves the food need. */
export function mealValueScale(world: World): number {
  return hasResearch(world, 'preserves') ? 1.35 : 1;
}

/**
 * How fast cooked meals go off once salting and sealing are understood.
 *
 * Half rate, which makes a meal keep roughly as long as the raw food it came
 * from. This is the project's second half and the reason for its name: before it,
 * cooking ahead is a gamble; after it, a kitchen can work a day in front of the
 * table. It deliberately does nothing for raw food — the answer to a sack of
 * turnips is a cold room, not a recipe.
 */
export function mealSpoilScale(world: World): number {
  return hasResearch(world, 'preserves') ? 0.5 : 1;
}

/**
 * Effective shooting skill added to a colonist taking a shot.
 *
 * Expressed in skill points rather than raw accuracy because that is the number
 * the combat code already has in hand, and because it means Rifling helps a
 * fresh recruit and a veteran by the same visible amount.
 */
export function riflingBonus(world: World): number {
  return hasResearch(world, 'rifling') ? 6 : 0;
}

/** Multiplier on turret reload time — smaller is faster. */
export function turretCooldownScale(world: World): number {
  return hasResearch(world, 'autoloaders') ? 0.58 : 1;
}

/** Multiplier on how fast a sown cell ripens. */
export function cropGrowthScale(world: World): number {
  return hasResearch(world, 'soilbeds') ? 1.5 : 1;
}

/** Multiplier on the ticks a scout spends surveying a site — smaller is faster. */
export function surveyScale(world: World): number {
  return hasResearch(world, 'cartography') ? 0.5 : 1;
}

/**
 * Multiplier on how fast every settler here picks a trade up.
 *
 * Applied inside `gainSkill`, so it covers the fraction, the bench and every one
 * of the fifteen award sites at once — including ones written after this. It
 * deliberately does *not* touch the breakthrough odds: Apprenticeship is a
 * colony that teaches, and a flash of insight at the bench is not something a
 * curriculum hands out.
 */
export function learnRateScale(world: World): number {
  return hasResearch(world, 'apprenticeship') ? 1.35 : 1;
}

/**
 * Multiplier on the materials a workbench recipe consumes.
 *
 * Two projects, and they multiply rather than each setting the number, so the
 * second one is worth taking whether or not the first already landed. Machining
 * is jigs on the bench you have; the Foundry is not having to buy the stock in
 * the first place. Together 0.45, which is a rifle for sixteen steel instead of
 * thirty-five — a large number, and it is meant to be: it is the first thing the
 * third tier hands back, and the tier costs more steel than it saves for a long
 * while yet.
 */
export function recipeCostScale(world: World): number {
  return (hasResearch(world, 'machining') ? 0.67 : 1) * (hasResearch(world, 'foundry') ? 0.67 : 1);
}

/**
 * Multiplier on points a settler puts into the bench.
 *
 * The one project that makes the rest of the tree cheaper, and therefore the one
 * whose value is entirely in when it lands — the same argument as
 * Apprenticeship, one tier up. Taken as the first thing past the Foundry it pays
 * for itself across the two projects behind it; taken last it is a trophy.
 */
export function benchRateScale(world: World): number {
  return hasResearch(world, 'instruments') ? 1.5 : 1;
}

/**
 * Multiplier on the load a trading party walks out with.
 *
 * Half again on every road, near and far, which on the middle ring is three
 * hundred of something becoming four hundred and fifty. Written as a load rather
 * than as a rate because the rate is the one number in the trade system nothing
 * is allowed to touch: a better price would be a thumb on the exchange, whereas
 * a bigger cart is the colony having built something.
 */
export function packScale(world: World): number {
  return hasResearch(world, 'freighting') ? 1.5 : 1;
}

/**
 * Points off the chance a road goes badly, as a fraction.
 *
 * Subtracted from the raw figure before it is clamped, so it works on the far
 * ring — which is the only place it matters. Every far road sits pinned to the
 * thirty per cent cap and standing barely moves it; this is the one thing in the
 * game that gets a party off that cap, and it takes the worst road on the board
 * from three trips in ten going wrong to about two.
 */
export function roadSafety(world: World): number {
  return hasResearch(world, 'waystations') ? 0.09 : 0;
}

/**
 * Multiplier on damage dealt to a building — smaller is tougher.
 *
 * Applied where the damage lands rather than to each building's hit points, so
 * it covers bullets, fire and the raider swinging at a wall alike, and so a
 * structure that was already standing when the project finished gets the benefit
 * without anyone having to rebuild it.
 */
export function structureDamageScale(world: World): number {
  return hasResearch(world, 'plating') ? 0.67 : 1;
}

/**
 * Structures that do not exist until somebody works out how to make them.
 *
 * Only ever *adds* to the menu. Nothing the colony could build on day one is
 * gated behind a project — taking away a turret the player already knows how to
 * place would read as a bug, not as progression.
 */
export const LOCKED_BUILDINGS: Partial<Record<BuildingKind, ResearchId>> = {
  stonewall: 'stonecutting',
  solar: 'solarcells',
  // Machining had no structure behind it — a project that only made the bench
  // better, which is a thin thing to spend twenty-two thousand on. A geared
  // wheel is exactly what jigs and dies are for, and hanging it here rather than
  // on a new node keeps the tree the shape every seeded test already expects.
  watermill: 'machining',
};

export function buildingUnlocked(world: World, kind: BuildingKind): boolean {
  const gate = LOCKED_BUILDINGS[kind];
  return gate === undefined || hasResearch(world, gate);
}
