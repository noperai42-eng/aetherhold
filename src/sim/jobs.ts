/**
 * The job system: how work gets chosen and how it gets done.
 *
 * A job is plain data on `world.jobs`. Each tick every idle settler looks for the
 * best job it is allowed to take (needs first, then work types in the priority
 * order the player set), and every settler with a job advances one stage of it.
 *
 * Multi-leg jobs (fetch → carry → work) reuse one walk/carry primitive, so
 * cooking, tending and building all behave the same way when interrupted.
 */

import { defOf, isBed } from './buildings';
import { isSleepHours } from './clock';
import { FORAGE_WORK, bushAt, isRipeBush, pickBush, ripeBushes } from './berries';
import {
  CROP_NONE,
  CROP_YIELD,
  HARVEST_WORK,
  SOW_WORK,
  TILL_WORK,
  canSow,
  canTill,
  growingCells,
} from './farming';
import { WEAPONS, huntStrike, isHostileTo } from './combat';
import { catchWork, catchYield, lakeHasFish, takeFish } from './fishing';
import { chopYield } from './forest';
import { iceBears } from './ice';
import {
  FIRE_CLEAR,
  adjacentStandCells,
  dist,
  fireAt,
  isWalkable,
  nearestSafeCell,
  wouldBlockDoorway,
} from './grid';
import { animalDef, isHuntable, settleAnimal, shootingSpot } from './wildlife';
import { TAME_REACH, TAME_WORK, isTameable } from './livestock';
import { GATHER_REACH, GATHER_WORK, collectFrom, isRipe } from './husbandry';
import type { Rng } from './rng';
import {
  BORED,
  celebrate,
  FOOD_VALUE,
  HUNGRY,
  isBreaking,
  MOOD_ATE_AT_TABLE,
  MOOD_ATE_COOKED,
  MOOD_ATE_RAW,
  MOOD_SLEPT_OUTSIDE,
  MOOD_SLEPT_ROUGH,
  moraleScale,
  nudgeMood,
  REC_GAIN_TABLE,
  REST_GAIN_BED,
  REST_GAIN_GROUND,
  TIRED,
} from './needs';
import { indoors } from './rooms';
import { bedlessTarget, emptyQuarters, sharedBunks } from './quarters';
import { partnerOf } from './partners';
import { bondPet } from './pets';
import {
  ailmentsOf,
  maybeExposureFlu,
  maybeFoodPoisoning,
  needsBedRest,
  tendAilments,
  tooIllToStand,
} from './health';
import { answerable } from './commissions';
import { abandonMuster, joinWarParty, musterWarParty, planCampaign } from './holdings';
import { findPath } from './path';
import { forgetRebuild } from './rebuild';
import { regionAt } from './regions';
import {
  caravanAllowed,
  departCaravan,
  packCeiling,
  packLimit,
  pickDestination,
  planCaravan,
  withinRange,
  roadHead,
  settlementById,
  shoppingRun,
  spareGoods,
} from './settlements';
import { SPOIL_DAYS } from './spoilage';
import { FREEZING, cellTemp } from './temperature';
import {
  FEED_PRISONER_BELOW,
  TALK_WORK,
  capturable,
  freeBunk,
  imprison,
  persuade,
  prisoners,
} from './prison';
import { followPath, STUCK_LIMIT, WALK_SPEED } from './movement';
import {
  addResearchPoints,
  benchRateScale,
  mealValueScale,
  recipeCostScale,
  researchStalled,
  toolYield,
  treatmentPotency,
} from './research';
import {
  CRAFT_DEFS,
  RECIPE_ORDER,
  canCraft,
  craftBlocker,
  craftSkill,
  equipPhrase,
  recipeResearched,
  yieldPhrase,
} from './crafting';
import { equip, gearTreatmentScale, gearWorkScale, isUpgrade } from './gear';
import { rememberFirst } from './lifelog';
import { BREAKTHROUGH_CHANCE, gainSkill } from './skills';
import {
  findScoutSite,
  resolveSite,
  scoutOverdue,
  scoutingAllowed,
  siteAt,
  surveyTicks,
} from './scout';
import { bore, boredOf } from './tedium';
import { bury, buriableDead, freeGraves } from './graves';
import { bestSpot, isRecSpot, recRate } from './recreation';
import { workMultiplier } from './traits';
import { LOOKAHEAD, queueOf } from './queue';
import {
  FLOOR_DEFS,
  canFloor,
  canRemoveFloor,
  floorAt,
  floorForDesig,
  layFloor,
  removeFloor,
} from './floors';
import type {
  Building,
  Cell,
  CraftRecipe,
  FloorKind,
  ItemStack,
  Job,
  JobKind,
  Pawn,
  ResourceKind,
  SkillName,
  World,
  WorkType,
} from './types';
import {
  DESIG_DECONSTRUCT,
  DESIG_HARVEST,
  DESIG_NONE,
  DESIG_TILL,
  WORK_TYPES,
  markBuildingsChanged,
  packCell,
  terrainAt,
  unpackX,
  unpackY,
  setTerrain,
} from './types';
import {
  MAX_STACK,
  addBuilding,
  addItem,
  cancelJob,
  countResource,
  findBuilding,
  findItem,
  findPawn,
  hostiles,
  itemsAt,
  livingColonists,
  mergeRot,
  msg,
  nextId,
  removeBuilding,
  removeItem,
  zoneAt,
} from './world';

/** Work applied per tick by a pawn of a given skill. */
export function workRate(pawn: Pawn, skill: SkillName): number {
  // Morale is a multiplier on the whole rate rather than a bonus on the skill,
  // so a master carpenter loses more to a bad week than an apprentice does —
  // which is the version that makes a player go and build the table.
  // Traits multiply the whole rate for the same reason morale does: a trait is a
  // fact about the person, not about the trade, so `hardworking` should show up
  // in the woodpile and the research bench alike.
  // Kit multiplies the whole rate too, for the third time and the same reason: a
  // toolbelt is a fact about the settler, not about the job, so it shows up in
  // the woodpile and at the research bench alike — and so does the weight of the
  // plate they insisted on wearing to go and dig turnips.
  return (
    (0.5 + 0.11 * (pawn.skills[skill] ?? 0)) *
    moraleScale(pawn) *
    workMultiplier(pawn) *
    gearWorkScale(pawn)
  );
}

export const MEAL_RAWFOOD_COST = 8;
export const MEALS_PER_BATCH = 4;
const JOB_TIMEOUT = 20 * 90; // 90 seconds of sim time

/**
 * Is some job already aimed at this?
 *
 * Exported because the player's own orders have to ask the same question the
 * colony's picker asks. A hand-issued job that ignored these would put two
 * settlers on one tree, and the second would arrive at a stump.
 */
export function isBuildingTargeted(world: World, id: number): boolean {
  return world.jobs.some((j) => j.buildingId === id);
}

function isPawnTargeted(world: World, id: number): boolean {
  return world.jobs.some((j) => j.targetPawnId === id);
}

/** Job kinds that claim a *cell* rather than a building, item or pawn. */
const CELL_JOBS: ReadonlySet<JobKind> = new Set<JobKind>([
  'mine',
  'firefight',
  'sow',
  'harvestCrop',
  'scout',
  // Tilling claims a cell too — without this two settlers walk to the same
  // square and one of them breaks ground that is already broken.
  'till',
]);

/** @see isBuildingTargeted */
export function isCellTargeted(world: World, x: number, y: number): boolean {
  return world.jobs.some((j) => CELL_JOBS.has(j.kind) && j.tx === x && j.ty === y);
}

/**
 * While set, `createJob` files what it makes onto this settler's control stack
 * instead of putting it in their hands.
 *
 * Module state, which wants justifying. The look-ahead planner runs the *whole*
 * job picker — thirty-odd `createJob` calls across a dozen work types, half of
 * them followed by a reservation written against the returned job's id — and the
 * one thing it wants to change is where the finished job lands. Threading a
 * parameter through all of that would mean touching every one of those call
 * sites to carry a flag none of them care about, and every future one would have
 * to remember. One variable, set and cleared by a single function with a
 * `finally`, is the smaller lie.
 */
let planningFor: Pawn | null = null;

/** Create a job and attach it to `pawn`. Also the entry point for E-interact. */
export function createJob(
  world: World,
  pawn: Pawn,
  kind: JobKind,
  tx: number,
  ty: number,
  extra: Partial<Job> = {},
): Job {
  const job: Job = {
    id: nextId(world),
    kind,
    pawnId: pawn.id,
    stage: 'goto',
    tx,
    ty,
    progress: 0,
    age: 0,
    ...extra,
  };
  world.jobs.push(job);
  if (planningFor?.id === pawn.id) {
    queueOf(pawn).push(job.id);
  } else {
    pawn.jobId = job.id;
    pawn.path = null;
  }
  return job;
}

/**
 * Create a job for `pawn` and put it wherever there is room: in their hands if
 * they are free, otherwise on the back of the control stack.
 *
 * The player's entry point. Nothing here decides whether the order makes sense —
 * `orders.ts` has already done that — this only decides where it lands, and the
 * distinction matters because an order given to an idle settler should start on
 * the spot rather than wait a tick for the stack to be read.
 */
export function queueJob(
  world: World,
  pawn: Pawn,
  kind: JobKind,
  tx: number,
  ty: number,
  extra: Partial<Job> = {},
): Job {
  if (pawn.jobId === null && pawn.activity !== 'sleeping') {
    return createJob(world, pawn, kind, tx, ty, extra);
  }
  const prev = planningFor;
  planningFor = pawn;
  try {
    return createJob(world, pawn, kind, tx, ty, extra);
  } finally {
    planningFor = prev;
  }
}

/**
 * Take the next entry off the control stack and start it. True if one started.
 *
 * The entry is already a live job holding its reservations, so there is nothing
 * to validate and nothing to claim — it only changes hands. `age` is left alone
 * because only `tickJob` advances it, and nothing has ticked this one.
 *
 * What does get asked, for a job the colony planned rather than one the player
 * ordered, is whether it is still the right thing to do. A plan is made while the
 * settler's hands are full and started when they are empty, and in between a
 * raider goes down, a prisoner stops eating, a roof catches. Without this the
 * stack quietly outranks the work board: the colony that fed its prisoners and
 * dragged the wounded indoors between chores stops doing either, because there is
 * no longer a moment between chores. It cost seed 1312 sixteen of its people.
 */
export function startQueued(world: World, pawn: Pawn): boolean {
  const q = pawn.queue;
  if (!q) return false;
  while (q.length > 0) {
    const job = world.jobs.find((j) => j.id === q[0]);
    if (!job) {
      q.shift();
      continue;
    }
    // Better work found: it goes in their hands and the plan keeps its place at
    // the front of the stack, to be asked again when this one is done.
    if (job.rank !== undefined && pickWorkJob(world, pawn, job.rank)) return true;
    q.shift();
    // Now it is a shift worked rather than a plan, so it counts against the run
    // they are on. The rank is the board position it came off — level above,
    // column below — which is the only record of *which* work type this was.
    if (job.rank !== undefined) {
      const w = WORK_TYPES[job.rank % 100];
      if (w) bore(world, pawn, w);
    }
    pawn.jobId = job.id;
    pawn.path = null;
    return true;
  }
  return false;
}

/**
 * Give up every entry waiting behind the job in hand.
 *
 * Through `cancelJob` rather than by emptying the array, because the entries own
 * reservations — a stack dropped on the floor is a sack of steel nobody can ever
 * pick up again.
 */
export function clearQueue(world: World, pawn: Pawn): void {
  const q = pawn.queue;
  if (!q) return;
  for (const id of q.slice()) cancelJob(world, id);
  pawn.queue = [];
}

/**
 * Is anybody standing around with nothing to do?
 *
 * The gate on planning ahead. Claimed work is work nobody else can take, so a
 * settler who queues a second job while a colleague is idle has not made the
 * colony faster — they have taken that colleague's job and left them in the
 * yard. When everyone is busy the claim costs nothing, because nobody was going
 * to take it, and it buys a settler who steps straight from one task to the next
 * instead of standing still for the assignment tick.
 */
function anyoneIdle(world: World, except: Pawn): boolean {
  for (const p of world.pawns) {
    if (p.id === except.id || p.faction !== 'colony') continue;
    if (p.dead || p.downed || p.drafted || p.manual || p.playerControlled) continue;
    if (p.jobId === null && p.activity !== 'sleeping') return true;
  }
  return false;
}

/**
 * Line up the settler's next job behind the one they are doing.
 *
 * Only ordinary work is planned, never a need: eating and sleeping are answers to
 * how a settler feels *now*, and a meal queued up an hour ago is a settler
 * walking to the pantry because they were once hungry.
 */
export function planAhead(world: World, pawn: Pawn): void {
  if (pawn.manual || pawn.drafted || pawn.playerControlled) return;
  if (pawn.dead || pawn.downed || pawn.jobId === null) return;
  if (pawn.activity === 'sleeping' || isBreaking(pawn)) return;
  // Nothing is queued behind a settler who is about to stop for something. The
  // stack holds its claims while they eat and while they sleep, so a job lined up
  // at dusk is a tree nobody can fell until morning — and a settler who steps off
  // to bed with work in hand should be leaving it for whoever is still awake.
  if (pawn.needs.food < HUNGRY + 0.12 || pawn.needs.rest < TIRED + 0.12) return;
  if (queueOf(pawn).length >= LOOKAHEAD) return;
  if (anyoneIdle(world, pawn)) return;

  const q = queueOf(pawn);
  planningFor = pawn;
  try {
    if (!pickWorkJob(world, pawn)) return;
  } finally {
    planningFor = null;
  }
  const planned = world.jobs.find((j) => j.id === q[q.length - 1]);
  if (planned && !stableToHold(world, planned)) cancelJob(world, planned.id);
}

/**
 * Is this a job the colony can safely sit on for a while before starting it?
 *
 * The look-ahead's one real cost is that a queued job holds its claims from the
 * moment it is queued, and two kinds of claim are not safe to hold:
 *
 * **A sack of goods**, because goods are fungible. A tree can only be felled by
 * one person, so whoever claims it first the colony loses nothing — but a settler
 * who reserves the woodpile for a haul they have not started yet has taken that
 * wood off *everybody*, and a yard full of builders will stand around a hundred
 * logs waiting for one person to finish chopping. That was measured, not feared:
 * the Steward's fence came in two posts short with hauls in the queue.
 *
 * **An expedition**, because the colony allows exactly one at a time and a scout
 * job turns itself back when the weather or the horizon changes. Nothing ticks a
 * queued job, so a scout that never starts never turns back either — it just sits
 * there and no one else in the colony can ever go out.
 *
 * Everything else claims a specific tree, rock, blueprint or patch of ground:
 * single-worker targets whose worth does not decay while somebody walks to them.
 *
 * `PLAN_NEVER` keeps whole work types away from the planner so it rarely gets
 * this far, but a work type is the wrong grain for the last word: hauling to a
 * blueprint is construction, and it reserves a sack like any other haul. This is
 * the check that looks at the job actually built.
 */
function stableToHold(world: World, job: Job): boolean {
  if (job.kind === 'scout') return false;
  if (job.itemId !== undefined) return false;
  return !world.items.some((s) => s.reservedBy === job.id);
}

// ---------------------------------------------------------------------------
// Target finding
// ---------------------------------------------------------------------------

/**
 * Can this pawn get to the cell — or, with `adjacent`, to somewhere it can work
 * the cell from? Exported because it is the authority on "is this job startable",
 * and the map-coverage test has to ask the same question the job system asks
 * rather than a lookalike that could drift from it.
 */
/**
 * Carry a spare bunk out of the hall into a finished room that has none.
 *
 * Nearest room to the settler, and then the nearest spare bunk to *that room* —
 * not to the settler. The walk that matters is the loaded one, and a colony that
 * picked the bunk nearest the carrier would have somebody shoulder a bed at the
 * near end of the hall and walk it the length of the compound.
 */
function moveBedJob(world: World, pawn: Pawn): boolean {
  // Bunks first, and the order is the cheap guard: `sharedBunks` is one pass
  // over the buildings, `emptyQuarters` walks every cell of every small room.
  // A colony whose beds are all in rooms of their own — the state this whole
  // feature is trying to reach — pays only the first of those.
  const bunks = sharedBunks(world);
  if (bunks.length === 0) return false;
  const rooms = emptyQuarters(world);
  if (rooms.length === 0) return false;

  let best: { bed: Building; x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const spot of rooms) {
    if (isCellTargeted(world, spot.x, spot.y)) continue;
    if (!reachable(world, pawn, spot.x, spot.y, false)) continue;
    for (const bed of bunks) {
      if (isBuildingTargeted(world, bed.id)) continue;
      // Not out from under a sleeper — they would wake on the floor of a room
      // they have never been in. Re-checked on arrival too; somebody can lie
      // down while the carrier is walking over.
      if (world.pawns.some((q) => q.activity === 'sleeping' && Math.floor(q.x) === bed.x && Math.floor(q.y) === bed.y)) continue;
      if (!reachable(world, pawn, bed.x, bed.y, true)) continue;
      const d = dist(bed.x, bed.y, spot.x, spot.y) + dist(pawn.x, pawn.y, bed.x, bed.y) * 0.25;
      if (d >= bestD) continue;
      bestD = d;
      best = { bed, x: spot.x, y: spot.y };
    }
  }
  if (!best) return false;
  createJob(world, pawn, 'moveBed', best.x, best.y, { buildingId: best.bed.id });
  return true;
}

export function reachable(world: World, pawn: Pawn, tx: number, ty: number, adjacent: boolean): boolean {
  const sx = Math.round(pawn.x);
  const sy = Math.round(pawn.y);
  const here = regionAt(world, sx, sy);
  if (here < 0) return false;
  if (adjacent) {
    for (const c of adjacentStandCells(world, tx, ty)) {
      if (regionAt(world, c.x, c.y) === here) return true;
    }
    return isWalkable(world, tx, ty) && regionAt(world, tx, ty) === here;
  }
  return isWalkable(world, tx, ty) && regionAt(world, tx, ty) === here;
}

/** Nearest unreserved ground stack of one of `kinds`. */
function findFoodStack(world: World, pawn: Pawn): ItemStack | null {
  let best: ItemStack | null = null;
  let bestScore = Infinity;
  for (const s of world.items) {
    if (s.carriedBy !== null || s.reservedBy !== null) continue;
    if (s.kind !== 'meal' && s.kind !== 'rawfood') continue;
    const d = dist(pawn.x, pawn.y, s.x, s.y);
    // Strongly prefer cooked meals, but do not starve next to raw food. Then, all
    // else being close, eat the oldest thing first — worth up to eight cells of
    // walking, which is enough to empty the pantry in the right order without
    // sending anybody across the base for a slightly staler sack.
    const score = d + (s.kind === 'meal' ? 0 : 22) - (s.rot ?? 0) * 8;
    if (score < bestScore && reachable(world, pawn, s.x, s.y, false)) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** The nearest unclaimed stack of `kind` this settler can reach, or null. */
export function findStack(world: World, pawn: Pawn, kind: ResourceKind): ItemStack | null {
  let best: ItemStack | null = null;
  let bestD = Infinity;
  for (const s of world.items) {
    if (s.carriedBy !== null || s.reservedBy !== null) continue;
    if (s.kind !== kind) continue;
    const d = dist(pawn.x, pawn.y, s.x, s.y);
    if (d < bestD && reachable(world, pawn, s.x, s.y, false)) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * Is somebody already working this cell's floor — laying one, or taking one up?
 *
 * A floor job's `tx`/`ty` is wherever the settler is going *this stage* — the
 * woodpile at first — so the generic cell check cannot see it. The cell being
 * floored lives in `floorX`/`floorY` and that is what has to be compared, or two
 * settlers each carry three boards to the same square and one set is wasted.
 *
 * Matched on the field rather than on the job kind, so removal is covered by the
 * same line. Two settlers levering up one plank waste no wood, but the second one
 * arrives to bare grass and cancels, having walked there for nothing.
 */
export function isFloorTargeted(world: World, x: number, y: number): boolean {
  return world.jobs.some((j) => j.floorX === x && j.floorY === y);
}

/**
 * Take the nearest painted floor cell this settler can actually finish.
 *
 * "Actually finish" is the whole job of this function: a floor order needs
 * material in the same way a blueprint does, and a settler who walks to the cell
 * first and discovers there is no wood standing over it looking useful. So the
 * material is found and reserved here, before the job exists — the same shape
 * the craft job uses, for the same reason.
 */
function assignFloor(world: World, pawn: Pawn): boolean {
  let best: { x: number; y: number; kind: FloorKind } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < world.cellDesig.length; i++) {
    const kind = floorForDesig(world.cellDesig[i]!);
    if (!kind) continue;
    const x = i % world.width;
    const y = Math.floor(i / world.width);
    if (!canFloor(world, x, y, kind)) {
      // The ground changed under the order — somebody built a wall on it, or
      // laid the same floor from the other end. Rub the order out rather than
      // leaving a cell nobody will ever come back to.
      world.cellDesig[i] = DESIG_NONE;
      continue;
    }
    if (isFloorTargeted(world, x, y)) continue;
    const d = dist(pawn.x, pawn.y, x, y);
    // A bridge cell is water until the moment it is decked, so "can you stand on
    // it" is the wrong question — the right one is "can you stand next to it and
    // reach". That single flag is what makes a painted line across the lake build
    // itself outward from the bank: only the cell touching dry land (or the last
    // plank laid) passes, and finishing it is what admits the next one.
    const adjacent = kind === 'bridge';
    if (d >= bestD || !reachable(world, pawn, x, y, adjacent)) continue;
    best = { x, y, kind };
    bestD = d;
  }
  if (!best) return false;
  const def = FLOOR_DEFS[best.kind];
  const stack = findStack(world, pawn, def.cost);
  if (!stack) return false;
  const job = createJob(world, pawn, 'floor', stack.x, stack.y, {
    itemId: stack.id,
    resource: def.cost,
    amount: Math.min(def.amount, stack.amount),
    floorX: best.x,
    floorY: best.y,
    floorKind: best.kind,
  });
  stack.reservedBy = job.id;
  return true;
}

/**
 * Take the nearest floor the player has painted for removal.
 *
 * The mirror of `assignFloor` and deliberately the simpler of the two: taking a
 * floor up needs no material, so there is nothing to find, reserve, or carry, and
 * the settler simply walks over and levers the boards off. Reuses the
 * `deconstruct` job rather than inventing a kind for it — the queue the player
 * reads off a colonist already says "deconstructing", and it is the same verb for
 * the same reason, which is that both of them are the X tool taking the top off a
 * cell.
 *
 * A removal job carries `floorX`/`floorY` and no `buildingId`; that pair is what
 * the two branches downstream are told apart by.
 */
function removeFloorJob(world: World, pawn: Pawn): boolean {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < world.cellDesig.length; i++) {
    if (world.cellDesig[i] !== DESIG_DECONSTRUCT) continue;
    const x = i % world.width;
    const y = Math.floor(i / world.width);
    // Buildings are handled by the loop above, and a cell holding one is that
    // building's order rather than its floor's — so this is not "no floor here",
    // it is "not this cell's turn". Leave the designation alone either way.
    if (!canRemoveFloor(world, x, y)) continue;
    if (isFloorTargeted(world, x, y)) continue;
    const d = dist(pawn.x, pawn.y, x, y);
    // Levered up from alongside for a bridge, the same way it was laid: the deck
    // becomes lake the instant it comes off, and a settler standing on the cell
    // they just removed is a settler in the water.
    const adjacent = floorAt(world, x, y) === 'bridge';
    if (d >= bestD || !reachable(world, pawn, x, y, adjacent)) continue;
    best = { x, y };
    bestD = d;
  }
  if (!best) return false;
  createJob(world, pawn, 'deconstruct', best.x, best.y, { floorX: best.x, floorY: best.y });
  return true;
}

/**
 * How much further a settler will walk to reach the right kind of bed. Sick
 * people cross the colony for a hospital bunk; well people stay out of it, so
 * that the sickbay is empty on the night somebody needs it.
 */
const SICKBAY_PULL = 40;

/**
 * And how much further they will walk to bunk near the person they came home to.
 *
 * Smaller than `SICKBAY_PULL`, because this is a preference and that is a rule:
 * a colony with one warm room and one cold one should still fill the warm one.
 * Six cells is about a bunkhouse across, which is the distance at which "we
 * sleep in the same room" stops being true.
 *
 * Only ever measured against a partner who is *already asleep*. Two settlers
 * each pulling toward wherever the other happens to be standing would be a
 * feedback loop with no fixed point and both of them wandering; one of them
 * settles first and the other comes to bed. Which is also how it works.
 */
const PARTNER_PULL = 6;

/**
 * And how much further still to sleep in their own room rather than a spare bunk.
 *
 * Larger than `PARTNER_PULL` because this is the whole point of having built the
 * room, and smaller than `SICKBAY_PULL` because a settler with a fever belongs
 * in the ward whoever owns what. It reads both ways off one number: their own
 * bed pulls this much closer, and somebody else's pushes this much further, so a
 * colony with a bed each never has two people fighting over one room while a
 * made bed stands empty next door.
 */
const OWN_ROOM_PULL = 30;

function findFreeBed(world: World, pawn: Pawn): Building | null {
  const ill = needsBedRest(pawn);
  const mate = partnerOf(world, pawn);
  const settled = mate && mate.activity === 'sleeping' ? mate : null;
  let best: Building | null = null;
  let bestScore = Infinity;
  for (const b of world.buildings) {
    if (!isBed(b.kind) || !b.built) continue;
    if (b.occupant !== null && b.occupant !== pawn.id) continue;
    if (isBuildingTargeted(world, b.id)) continue;
    const medical = b.kind === 'medbed';
    const near = settled && dist(b.x, b.y, settled.x, settled.y) <= PARTNER_PULL;
    // Somebody else's room is a last resort, not a forbidden one: a settler who
    // would otherwise sleep on the floor takes the spare bunk. See `quarters.ts`.
    const owned = b.ownerId === undefined ? 0 : b.ownerId === pawn.id ? -OWN_ROOM_PULL : OWN_ROOM_PULL;
    const score =
      dist(pawn.x, pawn.y, b.x, b.y) + (medical === ill ? 0 : SICKBAY_PULL) - (near ? PARTNER_PULL : 0) + owned;
    if (score < bestScore && reachable(world, pawn, b.x, b.y, false)) {
      best = b;
      bestScore = score;
    }
  }
  return best;
}

function findBuildingOfKind(world: World, pawn: Pawn, kind: Building['kind']): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if (b.kind !== kind || !b.built) continue;
    const d = dist(pawn.x, pawn.y, b.x, b.y);
    if (d < bestD && reachable(world, pawn, b.x, b.y, true)) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/**
 * How far out of their way a hauler will go to top up a pile that already exists
 * rather than start a new one. Roughly a stockpile's own width, which is the
 * range the rule is for: consolidating one zone, not walking the map.
 */
const TOPUP_DETOUR = 8;

/**
 * A stockpile cell that will accept `kind` and has room.
 *
 * Nearest wins, with two exceptions:
 *
 *   - Anything that rots goes to a cell below freezing first, however far it is.
 *     That is the whole payoff of building a cold room — a player who walls one
 *     and paints a stockpile in it gets their meals carried there instead of
 *     onto the nearest heap, without having to say so.
 *   - Otherwise a cell that already holds a stack of this kind with room in it
 *     wins over an empty cell within `TOPUP_DETOUR`. Nearest-wins alone is what
 *     put 101 steel into five piles of 16/32/14/9/30 on adjacent cells in a
 *     headless run of seed 1337: every miner dropped on whichever cell was
 *     closest to the vein they had just come from, stacks only ever merge
 *     within one cell, and a rifle needs thirty-five from a *single* stack. The
 *     colony had the steel, the bench, and the priority set, and stood there
 *     unarmed for twenty days because no pile ever reached the threshold.
 */
function dropPools(
  world: World,
  kind: ResourceKind,
  from?: { x: number; y: number },
): { cold: DropCell[]; rest: DropCell[] } {
  const perishable = SPOIL_DAYS[kind] !== undefined;
  const cold: DropCell[] = [];
  const rest: DropCell[] = [];
  for (const z of world.zones) {
    if (z.kind !== 'stockpile' || !z.accepts.includes(kind)) continue;
    for (const packed of z.cells) {
      const x = packed % world.width;
      const y = Math.floor(packed / world.width);
      if (!isWalkable(world, x, y)) continue;
      const here = itemsAt(world, x, y);
      let fill = 0;
      for (const s of here) if (s.kind === kind && s.amount < MAX_STACK) fill = Math.max(fill, s.amount);
      if (here.length > 0 && fill === 0) continue;
      const cell = { x, y, fill, d: from ? dist(from.x, from.y, x, y) : 0 };
      if (perishable && cellTemp(world, x, y) <= FREEZING) cold.push(cell);
      else rest.push(cell);
    }
  }
  return { cold, rest };
}

export function findStockpileCell(world: World, kind: ResourceKind, from?: { x: number; y: number }): { x: number; y: number } | null {
  const { cold, rest } = dropPools(world, kind, from);
  return pickDropCell(cold.length > 0 ? cold : rest);
}

/**
 * Is there a below-freezing stockpile cell with room in it for `kind`?
 *
 * The question `needsHauling` asks about food that is already put away, and it is
 * deliberately about *room* and not merely about a cold room existing. A full
 * cellar is not somewhere to put anything, so the sack in the cabin stays in the
 * cabin — which is the fallback the colony wants and, just as importantly, the
 * thing that stops a hauler picking a sack up, finding nowhere cold to set it
 * down, and putting it back where it started for ever.
 *
 * Memoised on the tick because the haul scan asks it once per sack per settler
 * and the answer cannot change between two sacks in the same pass: the walk over
 * every cell of every stockpile taking each one's temperature is the same walk
 * `findStockpileCell` is careful to do only once per kind.
 */
let coldSeen: { tick: number; world: World; by: Map<ResourceKind, boolean> } | null = null;

export function coldStoreOpen(world: World, kind: ResourceKind): boolean {
  if (SPOIL_DAYS[kind] === undefined) return false;
  if (!coldSeen || coldSeen.tick !== world.tick || coldSeen.world !== world) {
    coldSeen = { tick: world.tick, world, by: new Map() };
  }
  const known = coldSeen.by.get(kind);
  if (known !== undefined) return known;
  const open = dropPools(world, kind).cold.length > 0;
  coldSeen.by.set(kind, open);
  return open;
}

type DropCell = { x: number; y: number; fill: number; d: number };

/**
 * Nearest of a pool, unless topping up a pile is a short enough detour — and of
 * the piles in reach, the fullest.
 *
 * Fullest rather than nearest, because the point of the rule is to get *one*
 * pile over a recipe's threshold. Feeding whichever heap happens to be closest
 * to this particular delivery keeps five heaps growing in step, and five heaps
 * of twenty still cannot make a thirty-five steel rifle.
 */
function pickDropCell(pool: DropCell[]): { x: number; y: number } | null {
  let near: DropCell | null = null;
  for (const c of pool) if (!near || c.d < near.d) near = c;
  if (!near) return null;
  const reach = near.d + TOPUP_DETOUR;
  let pile: DropCell | null = null;
  for (const c of pool) {
    if (c.fill === 0 || c.d > reach) continue;
    if (!pile || c.fill > pile.fill || (c.fill === pile.fill && c.d < pile.d)) pile = c;
  }
  const use = pile ?? near;
  return { x: use.x, y: use.y };
}

function needsHauling(world: World, s: ItemStack): boolean {
  if (s.carriedBy !== null || s.reservedBy !== null) return false;
  const z = zoneAt(world, s.x, s.y);
  if (z && z.kind === 'stockpile' && z.accepts.includes(s.kind)) {
    // Put away is not the same as put away *properly*. Food in a warm store is
    // still on the clock — `spoilFactor` is `temp / 20` above freezing and a hard
    // zero below it — so a sack of meat in the cabin with a cold cellar standing
    // empty across the yard is in the wrong place, and the colony should move it
    // rather than wait for the next harvest to be routed there while this one
    // rots. Measured on seed 7 over forty days: 268 food spoiled and not one unit
    // was ever frozen.
    //
    // Only ever *towards* the cold. If there is nowhere cold with room — no
    // cellar yet, or a full one — this returns false and the sack stays where it
    // is, which is both the fallback the colony wants and what stops two warm
    // cells passing the same sack back and forth for ever.
    if (cellTemp(world, s.x, s.y) <= FREEZING) return false;
    return coldStoreOpen(world, s.kind);
  }
  return true;
}

/**
 * Free walking, and what each unit in the sack buys on top of it.
 *
 * A settler will cross the yard and a bit beyond for anything at all, and will go
 * further the more there is to bring back. Full stack, and the allowance is past
 * the width of the map — which is the intent: nobody should ever refuse to fetch
 * seventy-five steel.
 */
const HAUL_FREE = 26;
const HAUL_PER_UNIT = 1.6;

/**
 * Is this sack worth the trip it would cost?
 *
 * `trip` is the whole errand — out to the sack and on to the store — because that
 * is what the colony actually spends, and hauling is where it spends most. Three
 * days of the opening on the ordinary seed: 32 908 ticks walking against 10 576
 * working, and 13 710 of the walking was hauling. Not one settler was idle and
 * nothing was stuck; they were simply crossing the moor for three raw food.
 *
 * That was invisible while the valley was small. A 64-cell map has no corner far
 * enough away for the walk to be the wrong answer, so "nearest haulable sack"
 * doubled as "sack worth hauling" and nobody had to say which one they meant. At
 * 192 the two come apart: a wolf kills a hare eighty cells out, the meat lands in
 * the grass, and the nearest sack in the world to a settler with nothing else on
 * is that hare. They fetch it. It costs them the better part of a working day and
 * the colony gets nine meat, and the whole time the fence they were meant to be
 * raising sits with its wood four cells from the frame.
 *
 * So the load pays for the walk. Nine meat buys forty cells of errand and a felled
 * tree buys the length of the map, which puts the herds and the far seams back to
 * being somewhere you send somebody *for a reason* rather than a tidy-up chore
 * that grew with the world. Loose scatter out on the moor stays where it is until
 * a settler is out there anyway, which is also how it looks to a player: the moor
 * has things lying in it, and the yard is kept.
 *
 * Six days, three seeds, rule on against rule off: 82/75/71 buildings against
 * 77/72/71, on 44 355/45 897/41 801 ticks of walking against 55 368/52 000/43 439.
 * A fifth less legwork for the same colony or a slightly better one — the settlers
 * did not gain time so much as stop losing it, and what they spent it on instead
 * was chopping and hunting, which is the work the walking was displacing.
 */
function worthFetching(s: ItemStack, trip: number): boolean {
  return trip <= HAUL_FREE + s.amount * HAUL_PER_UNIT;
}

// ---------------------------------------------------------------------------
// Job selection
// ---------------------------------------------------------------------------

function tryNeedJob(world: World, pawn: Pawn): boolean {
  const n = pawn.needs;

  if (n.food < HUNGRY) {
    const food = findFoodStack(world, pawn);
    if (food) {
      const job = createJob(world, pawn, 'eat', food.x, food.y, { itemId: food.id });
      food.reservedBy = job.id;
      return true;
    }
  }
  // Bed rest outranks being tired, and outranks being bored: somebody running a
  // fever who keeps hauling logs is the settler this whole system exists to
  // stop. It sits below food on purpose — an empty stomach beats an illness.
  if (n.rest < TIRED || (isSleepHours(world) && n.rest < 0.82) || needsBedRest(pawn)) {
    const bed = findFreeBed(world, pawn);
    if (bed) {
      createJob(world, pawn, 'sleep', bed.x, bed.y, { buildingId: bed.id });
      return true;
    }
    if (n.rest < 0.12) {
      // Nowhere to sleep — drop where you stand rather than walk until you die.
      pawn.activity = 'sleeping';
      return true;
    }
  }
  if (n.recreation < BORED) {
    // Not "the nearest table" any more. `recreation.ts` weighs how good a spot
    // is against how far it is and who is already sitting there, which is what
    // makes the colony gather round one fire in the evening instead of each
    // settler taking a private turn at the same table.
    if (takeABreak(world, pawn)) return true;
  }
  return false;
}

/**
 * Send a settler to the best seat they can reach, if there is one.
 *
 * Shared by the need pass, which uses it at `BORED`, and by the idle pass, which
 * uses it far earlier — see `IDLE_REC`.
 */
function takeABreak(world: World, pawn: Pawn): boolean {
  const spot = bestSpot(world, pawn, (x, y) => reachable(world, pawn, x, y, true));
  if (!spot) return false;
  createJob(world, pawn, 'recreate', spot.x, spot.y, { buildingId: spot.id });
  return true;
}

/**
 * Recreation a settler will go and get when the colony has nothing for them.
 *
 * `BORED` is the level at which recreation outranks *work* — deliberately low,
 * because a colony where everyone downs tools at the first yawn builds nothing.
 * It is the wrong number for a settler with no work to down. Measured over twenty
 * days on three seeds, settlers were idle for between a third and seven eighths
 * of their waking hours once the build-out finished, and stood in the yard
 * through all of it at about half recreation — which is a standing -0.12 on
 * morale, every day, for want of sitting at a table nobody was using.
 *
 * So: nothing to do means go and enjoy yourself. The gap to the 0.9 the job
 * finishes at is the hysteresis — without it a settler would re-take the seat on
 * the tick after standing up.
 */
const IDLE_REC = 0.75;

/**
 * Somebody ill whose last dressing has expired (or who never had one). The
 * doctor pass uses this alongside the wounded check, so one work type covers
 * both bullets and fevers.
 */
function wantsTending(world: World, pawn: Pawn): boolean {
  return ailmentsOf(pawn).some((a) => world.tick >= a.tendedUntil);
}

/** A patient this hungry is fed before anyone reaches for the medicine. */
const FEED_PATIENT_BELOW = 0.55;

/**
 * A patient at (or near) zero food is dying, not merely hungry: `tickNeeds` stops
 * healing them and takes hit points off instead, so every tick without a meal is
 * damage. This is the threshold at which fetching them one jumps the queue.
 */
export const PATIENT_EMERGENCY_FOOD = 0.14;

/**
 * How little a would-be rescuer can have left and still be sent.
 *
 * The same line, deliberately: a settler is excused from carrying a meal exactly
 * when they are the person somebody should be carrying one *to*. It used to be
 * `HUNGRY`, and the comments defending that said a settler who is themself
 * starving deals with that first or two die instead of one — which is true, and
 * 0.34 is not starving. At `FOOD_DRAIN` it is most of a working day in hand, the
 * errand begins at the food stack, and nothing takes hit points off until zero.
 *
 * Measured before it was moved, on the three unmanaged harsh seeds the starvation
 * principles name: of 6036 settler-ticks where the feeding pass looked at an
 * upright colonist and declined to send them to somebody lying at 0.00, **6035
 * declined on this gate**. One tick in six thousand was anything else. The pass
 * was working; it was being asked the wrong question.
 */
const RESCUER_KEEPS = PATIENT_EMERGENCY_FOOD;

/** Is somebody bleeding out from hunger on the floor right now? */
export function dyingPatient(world: World, exceptId: number): boolean {
  return world.pawns.some(
    (p) =>
      p.id !== exceptId &&
      !p.dead &&
      p.downed &&
      p.faction === 'colony' &&
      p.needs.food <= PATIENT_EMERGENCY_FOOD,
  );
}

/**
 * Put the work down and go and eat, if that is what this settler should do.
 *
 * Needs only ever jumped the queue for an **idle** settler: `assignJob` returns at
 * its first line when `pawn.jobId !== null`, so a settler already on a job was
 * never asked whether they were hungry until that job ended. `tick.ts` fixed the
 * near half of this a round ago — a settler with a job *queued* steps straight
 * from one task to the next and is never idle, and that starved seed 20260729 flat
 * to zero. The far half is a single job that simply runs for a long time.
 *
 * Measured on settler/7: Pell Verrow (#2605) stood at zero food for twelve hours
 * and eighteen minutes, ending day 35, with a mean of a hundred and five units of
 * food in the larder the whole time. Not drafted, not asleep, no path problem —
 * `probe-upright` names the first blocking reason per tick, and 2906 of them were
 * `is mid-job (hunt)`. A hunt is allowed `JOB_TIMEOUT * 2`, so those 2906 ticks
 * were one hunt comfortably inside its own allowance, and that spell alone is the
 * whole of the `on-their-feet-at-zero-is-a-walk-home` break: 12.3 h against a
 * twelve-hour bar. The colony was not short of food. It was short of a rule that
 * lets a hunter stop hunting.
 *
 * Two gates, and both are load-bearing.
 *
 * `PATIENT_EMERGENCY_FOOD` rather than `HUNGRY`, by the argument that already
 * moved `RESCUER_KEEPS` onto it: 0.34 is a settler who would like lunch, and
 * interrupting real work for lunch is how a colony gets nothing done. 0.14 is
 * where `tickNeeds` stops healing them and starts taking hit points off. Below it
 * the job is no longer the most important thing this person is doing.
 *
 * And the errand has to actually exist. `findFoodStack` is the same call
 * `tryNeedJob` makes one tick later, so a cancel here is only ever paid for by an
 * `eat` job there — never by a settler standing in the yard. It is also the safety
 * of the whole rule: **a colony with an empty larder needs its hunters hunting**,
 * and an ungated version would cancel, every tick, the only work that ends the
 * famine.
 *
 * `NEVER_INTERRUPTED` is honoured rather than restated, because the colony should
 * not hold two opinions about which errands survive an emergency. It already says
 * a fire, a rescue and a march outrank fetching a meal for somebody on the floor,
 * and none of those arguments get weaker when the hungry person is the one
 * carrying. Everything else is work, and work waits.
 *
 * A third gate, and it cost three colonies their founding to find. `cancelJob`
 * does not pause a job, it undoes one: cargo goes on the ground where the settler
 * stands, unreserved, and the timber that was two steps from a blueprint has to
 * be walked all over again by whoever picks it up next. Preempting a hauler is
 * therefore not a small delay but a refund, and the founding is gated on things
 * that get built — `calm/1312` and `settler/20260729` both stop founding inside
 * sixty days on this alone, and both come back when it is gated. A haul is
 * bounded by `JOB_TIMEOUT`; they finish it and the need pass has them next tick.
 *
 * Food already in their hands is the one case the drop was always right for: put
 * it down and it is a stack they can eat, which is the errand. That also stands
 * in for `findFoodStack`, which cannot see it — it skips carried stacks, so a
 * settler starving with a meal in their arms would otherwise fail the gate that
 * asks whether there is anything to eat.
 *
 * A shouldered person is nobody's cargo and is never put down for a meal; the
 * warden carrying them is under `rescue` anyway, which `NEVER_INTERRUPTED`
 * already covers, so this is the belt to that brace.
 */
export function putDownWorkToEat(world: World, pawn: Pawn): boolean {
  if (pawn.needs.food > PATIENT_EMERGENCY_FOOD) return false;
  const job = world.jobs.find((j) => j.id === pawn.jobId);
  if (!job || job.kind === 'eat') return false;
  if (NEVER_INTERRUPTED.includes(job.kind)) return false;
  if (pawn.carryingPawnId != null) return false;
  const held =
    pawn.carryingItemId === null
      ? null
      : (world.items.find((s) => s.id === pawn.carryingItemId) ?? null);
  const holdingFood = held !== null && (held.kind === 'meal' || held.kind === 'rawfood');
  if (held !== null && !holdingFood) return false;
  if (!holdingFood && !findFoodStack(world, pawn)) return false;
  cancelJob(world, job.id);
  return true;
}

function tryFeedPatient(world: World, pawn: Pawn): boolean {
  let worst: Pawn | null = null;
  for (const p of world.pawns) {
    if (p.id === pawn.id || p.dead || p.faction !== 'colony') continue;
    if (!p.downed) continue;
    if (p.needs.food >= FEED_PATIENT_BELOW) continue;
    // Only another *meal* run claims a patient. Treating them does not: a doctor
    // walking over with medicine used to lock the patient against being fed, so a
    // settler could starve while being bandaged.
    if (world.jobs.some((j) => j.kind === 'feedPatient' && j.targetPawnId === p.id)) continue;
    if (worst && worst.needs.food <= p.needs.food) continue;
    if (!reachable(world, pawn, Math.round(p.x), Math.round(p.y), true)) continue;
    worst = p;
  }
  if (!worst) return false;
  const food = findFoodStack(world, pawn);
  if (!food) return false;
  const job = createJob(world, pawn, 'feedPatient', food.x, food.y, {
    targetPawnId: worst.id,
    itemId: food.id,
    stage: 'goto',
  });
  food.reservedBy = job.id;
  return true;
}

/**
 * Jobs a settler is not pulled off, whatever is happening at home.
 *
 * Two kinds. Getting out of a fire and carrying somebody else out of one are
 * already the emergency — swapping one rescue for another loses a life rather
 * than saving one. And a trade party or a war party is not in the colony: their
 * job is a march that has already been paid for in packed goods, and calling one
 * of them back to fetch a meal cancels the trip for everybody.
 */
export const NEVER_INTERRUPTED: JobKind[] = ['flee', 'rescue', 'feedPatient', 'caravan', 'campaign'];

/**
 * Somebody is dying of hunger on the floor and nobody is idle enough to notice.
 *
 * `assignJob` has had an emergency lane above the work board for a long time, and
 * its comment says rescue outranks comfort. It does — for a settler who is
 * *between jobs*. Both entry points return early on `pawn.jobId !== null`, so a
 * colony where everybody happens to be carrying something reads, from the floor,
 * exactly like a colony where everybody is unconscious.
 *
 * Measured before it was written, on the three harsh seeds the starvation
 * principle names: of 88 hours that seed 1312 spent with a settler starving on
 * the floor, 49.6 were a colony that was *itself* entirely floored, 31.0 already
 * had a meal walking over, 0.3 was the assignment cadence — and **7.2 hours were
 * settlers on their feet, every one of them mid-job**. That last slice is the
 * only part of the total that is a decision the colony got wrong, and it is the
 * only part this changes.
 *
 * Colony-level rather than per-settler for the same reason `sendSomebody` in
 * `firesafety.ts` is: "who goes" is one decision with one answer, and asking it
 * once from above is not the same question as thirteen settlers each asking what
 * to do next. This is modelled on that function deliberately, down to cancelling
 * the chosen settler's job — the precedent for interrupting work to save a life
 * is already in the codebase, and it is a fire.
 */
export function sendSomebodyToFeed(world: World): void {
  // The common case by an enormous margin, and it costs one pass over the pawns.
  // Everything below only runs on a tick where somebody is actually dying.
  if (!dyingPatient(world, -1)) return;

  let patient: Pawn | null = null;
  for (const p of world.pawns) {
    if (p.dead || !p.downed || p.faction !== 'colony') continue;
    if (p.needs.food > PATIENT_EMERGENCY_FOOD) continue;
    // Already claimed. One meal per patient, and the settler carrying it is not
    // pulled off by the next tick asking the same question.
    if (world.jobs.some((j) => j.kind === 'feedPatient' && j.targetPawnId === p.id)) continue;
    if (patient && patient.needs.food <= p.needs.food) continue;
    patient = p;
  }
  if (!patient) return;

  let best: Pawn | null = null;
  let bestD = Infinity;
  for (const p of world.pawns) {
    if (p.id === patient.id || p.dead || p.downed || p.drafted) continue;
    if (p.faction !== 'colony' || p.playerControlled) continue;
    // Every gate the idle lane applies, applied identically. A player who
    // switched doctoring off, or took this settler off the board by hand, has
    // answered this question already; a settler who is themself running on empty
    // deals with that first, or two die instead of one — and `RESCUER_KEEPS` is
    // where "running on empty" actually starts, which is not where this gate used
    // to stand.
    if (p.manual || p.priorities.doctor <= 0 || p.needs.food <= RESCUER_KEEPS) continue;
    // Asleep is deliberately left out of the interruptible set. Nobody is woken
    // for this: the probe found not one tick in three seeds where the only hands
    // available were in bed, so waking them buys nothing and costs the rest need
    // a night — and `firesafety.ts` wakes people because the bed is on fire.
    if (p.activity === 'sleeping') continue;
    const busy = world.jobs.find((j) => j.id === p.jobId);
    if (busy && NEVER_INTERRUPTED.includes(busy.kind)) continue;
    const d = dist(p.x, p.y, patient.x, patient.y);
    if (d >= bestD) continue;
    if (!reachable(world, p, Math.round(patient.x), Math.round(patient.y), true)) continue;
    best = p;
    bestD = d;
  }
  if (!best) return;
  // Nothing to carry. Checked before the job is cancelled, so a colony with an
  // empty pantry does not also lose whatever the settler was in the middle of —
  // that is a different failure and it should not cost a half-built wall.
  if (!findFoodStack(world, best)) return;

  if (best.jobId !== null) cancelJob(world, best.jobId);
  if (tryFeedPatient(world, best)) {
    msg(world, `${best.name} drops everything to get food to ${patient.name}.`, 'bad');
  }
}

/**
 * Raw food per settler above which nobody bothers re-sowing. Ripe cells are still
 * picked — the plot is not the problem, the walk is: a settler turning soil for a
 * pantry that already holds a fortnight of dinners is a settler not mining, and
 * the stockpile would only refuse the delivery anyway.
 */
const SOW_CEILING_PER_COLONIST = 45;

/**
 * How far a settler will walk for a bramblebush.
 *
 * A cap, and the reason there is one is the bigger valley: the bushes are spread
 * at a fixed density, so on a 128-cell map there is always *a* ripe one somewhere
 * and an uncapped search would send a farmhand sixty cells out and sixty back for
 * two raw food. That is not foraging, it is a settler removed from the colony for
 * half a day. Twenty-six cells is a walk out and back inside an afternoon, and it
 * holds a dozen or so bushes at the density `berries.ts` scatters them — enough
 * that the near ones being picked does not immediately end foraging, and few
 * enough that the colony can visibly exhaust its own neighbourhood.
 */
const FORAGE_RANGE = 26;

/**
 * And how far from the colony's own store the bush is allowed to be.
 *
 * `FORAGE_RANGE` is measured from the settler, which caps one errand and does not
 * cap where the errands go. Picking a bush leaves the settler standing at the edge
 * of their own range with a fresh twenty-six cells in front of them, so the board
 * hands them the next bush out, and the next: on the 192 map a farmhand set to
 * forage on the first morning ended the day eighty-six cells from the hearth, one
 * bush at a time, each individual step of it inside the cap and the walk home
 * three quarters of an hour. The comment above `FORAGE_RANGE` says the colony can
 * visibly exhaust its own neighbourhood, and it could not: it just kept walking.
 *
 * So there are two ranges, because there are two questions. How far will a settler
 * walk for a bush — that is `FORAGE_RANGE`, and it is about the afternoon. How far
 * out does the colony forage at all — that is this one, and it is about the map.
 * Beyond it the moor keeps its fruit until somebody is sent for it.
 */
const FORAGE_HOME_RANGE = 40;

/**
 * Raw food per settler below which the colony walks the moor.
 *
 * Its own line rather than the sowing ceiling, and far under it, because the two
 * are not the same question. Sowing compounds: a settler turns soil once and the
 * cell pays four food every three days for the rest of the year, so it is worth
 * doing on a comfortable pantry. Foraging compounds nothing — it is a walk out
 * and a walk back for two food off a plant that then takes six days to fruit
 * again. It is what a colony does because it is short, not because it would like
 * more.
 *
 * Sharing the sowing line is what broke it, and it broke quietly because the
 * number never changed — the map did. At ten patches per cell brambles were a
 * garnish; at thirty, on thirty-seven thousand cells, there are about seventeen
 * bushes inside forage range at any hour and a founding colony sits three times
 * under the sowing ceiling, so there was always another bush and always a reason
 * to go. Measured over one day on seed 21: 4 120 colonist-ticks foraging against
 * 708 building — forty-four per cent of the colony's waking life spent picking
 * berries. The Steward staked out a fence, four posts of eight went up, the board
 * never cleared, so it never marked another batch. A corpse lay in the yard
 * unburied for a day. And seed 424242 starved a settler to nothing *while its
 * settlers were out gathering food*, which is the whole failure in one line: an
 * errand that never runs out had eaten the finite work that actually feeds
 * people.
 *
 * Twelve is about four and a half days a head — three settlers burn eight raw
 * food a day between them. A colony that lands with forty-five gets on with the
 * plot and the walls and starts walking the moor on the second evening, when the
 * crate is visibly going and the first harvest is not in yet. That is the week
 * the brambles were put in the game for.
 */
const FORAGE_CEILING_PER_COLONIST = 12;

function livingColonyCount(world: World): number {
  let n = 0;
  for (const p of world.pawns) if (p.faction === 'colony' && !p.dead) n++;
  return n;
}

function sowingWanted(world: World): boolean {
  return countResource(world, 'rawfood') < livingColonyCount(world) * SOW_CEILING_PER_COLONIST;
}

function foragingWanted(world: World): boolean {
  return countResource(world, 'rawfood') < livingColonyCount(world) * FORAGE_CEILING_PER_COLONIST;
}

/**
 * What the bench costs and yields lives in `crafting.ts`, with the gates. What is
 * left here is the *demand* side: not "may this settler make it" but "is it worth
 * anybody's afternoon right now", which is a work-board question about stock
 * levels and reads the same way as every other entry on the board.
 *
 * The two reserves below exist because the 30-day sweeps found the same two dead
 * ends. Raids escalate to rifle-armed bands while settlers who wandered in still
 * carry clubs — and 70 to 210 steel sat unspent once turrets and sandbags capped
 * out, because rock was the only sink in the game. Medicine ran to zero by about
 * day 20 in every seed, with no source anywhere on the map, so a bad fight got
 * worse every time it happened.
 */
/** Steel held back for a turret, so arming a settler never disarms the wall. */
const DEFENCE_STEEL_KEEP = 30;
/** Raw food held back from the medicine pot: two cook batches' worth. */
const MEDICINE_FOOD_KEEP = 16;
/**
 * Raw food held back from the ration press.
 *
 * Far deeper than the medicine reserve, because rations are a *surplus* sink and
 * medicine is a necessity. A colony should press rations out of the harvest it
 * cannot eat before it rots, never out of the pantry — the stove is the thing
 * that answers hunger, and a bench that competed with it for the same sacks would
 * make a colony starve with a workshop running.
 */
const RATIONS_FOOD_KEEP = 60;

/**
 * How thin the larder has to get before somebody picks up a rod.
 *
 * Counted in raw food and meals together and measured per head, because the
 * question fishing answers is "are we going to run out", and a pantry of meals
 * answers it exactly as well as a pantry of sacks does. Eight per settler is a
 * couple of days' eating — late enough that a colony with a working farm never
 * bothers, and early enough that the first trip to the shore happens while there
 * is still food to walk out on.
 */
const FISH_WHEN_BELOW = 8;

/**
 * Send this settler to the shore, if the colony needs it and the lake has it.
 *
 * The larder gate is what keeps the lake from being a food printer: a colony that
 * is fed leaves it alone, the stock climbs back, and the fish are there on the
 * day the crops fail. Without it every idle settler in summer would stand on the
 * plank until the water was empty, and the one season the lake exists for would
 * be the one season it had nothing in it.
 */
function startFishing(world: World, pawn: Pawn): boolean {
  if (!lakeHasFish(world)) return false;
  const mouths = livingColonists(world).length;
  let food = 0;
  for (const s of world.items) {
    if (s.carriedBy !== null) continue;
    if (s.kind === 'rawfood') food += s.amount;
    else if (s.kind === 'meal') food += s.amount * MEAL_RAWFOOD_COST;
  }
  if (food >= mouths * FISH_WHEN_BELOW) return false;
  // Nearest free stage. Two settlers on one plank is not a crash, but it is a
  // picture the player would report as one, and a colony that built two stages
  // did so because it wanted two people fishing.
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if (b.kind !== 'fishhole' || !b.built) continue;
    if (isBuildingTargeted(world, b.id)) continue;
    const d = dist(pawn.x, pawn.y, b.x, b.y);
    if (d < bestD && reachable(world, pawn, b.x, b.y, true)) {
      best = b;
      bestD = d;
    }
  }
  if (!best) return false;
  createJob(world, pawn, 'fish', best.x, best.y, { buildingId: best.id });
  return true;
}

/** Unreserved ground stock — what a crafter could actually pick up right now. */
function freeStock(world: World, kind: ResourceKind): number {
  let n = 0;
  for (const s of world.items) {
    if (s.kind !== kind || s.carriedBy !== null || s.reservedBy !== null) continue;
    n += s.amount;
  }
  return n;
}

/**
 * The nearest stack of `kind` this settler could fetch, with at least `least` in it.
 *
 * Sorted before the reachability probe rather than after: a probe is a path search,
 * and taking the first stack that answers yes costs one search in the common case
 * instead of one per stack that happens to be closer than the last winner.
 */
function freeStack(world: World, pawn: Pawn, kind: ResourceKind, least: number): ItemStack | null {
  const near = world.items
    .filter((s) => s.kind === kind && s.carriedBy === null && s.reservedBy === null && s.amount >= least)
    .sort((a, b) => dist(pawn.x, pawn.y, a.x, a.y) - dist(pawn.x, pawn.y, b.x, b.y));
  for (const s of near) {
    if (reachable(world, pawn, s.x, s.y, false)) return s;
  }
  return null;
}

/** What one of these costs to start, after Machining's discount. */
export function recipeCost(world: World, recipe: CraftRecipe): number {
  // Rounds up, so the discount can never make a recipe free and it is still a
  // whole number of planks the player watches leave the stockpile.
  return Math.ceil(CRAFT_DEFS[recipe].input.cost * recipeCostScale(world));
}

/**
 * Is there a reason to make this right now, stock aside from who could do it?
 *
 * Every arm of this is a shortage the colony can see: an unarmed settler, a
 * medicine shelf below one course a head, a harvest bigger than the pantry. None
 * of them mention skill or research — that is `canCraft`'s job, asked separately
 * in `wantedRecipes`, and keeping the two apart is what lets the workbench panel
 * say "you could make this if you had a doctor" rather than silently showing
 * nothing.
 */
function recipeWanted(world: World, pawn: Pawn, recipe: CraftRecipe): boolean {
  const cost = recipeCost(world, recipe);
  switch (recipe) {
    // Made by the settler who needs one — you keep what you build, which is why
    // nobody has to haul a weapon across the map to arm somebody else.
    case 'rifle':
      return pawn.weapon !== 'rifle' && freeStock(world, 'steel') >= cost + DEFENCE_STEEL_KEEP;
    // Stocked to one course per settler plus two spares — a fever wants tending
    // again every half day, so the shelf empties faster than a raid does — and
    // only ever out of food the pantry can spare.
    case 'medicine':
    case 'balm':
      return (
        countResource(world, 'medicine') < livingColonists(world).length + 2 &&
        freeStock(world, 'rawfood') >= cost + MEDICINE_FOOD_KEEP
      );
    // The glut sink. Only ever from food the colony has more of than it can cook
    // through, and never past a fortnight of meals on the shelf.
    case 'rations':
      return (
        countResource(world, 'meal') < livingColonists(world).length * 8 &&
        freeStock(world, 'rawfood') >= cost + RATIONS_FOOD_KEEP
      );
    // Kit is wanted by the settler who would wear it and nobody else, which is
    // the whole of the demand question — `isUpgrade` is what stops a settler in
    // a parka from making a jerkin, then a parka, then a jerkin, forever.
    //
    // Plate keeps the turret's steel back for the same reason the rifle does:
    // a colony that armours its carpenter and then cannot afford the emplacement
    // has spent forty-five steel making the raid worse.
    case 'jerkin':
    case 'parka':
    case 'toolbelt':
    case 'medkit':
      return isUpgrade(pawn, recipe) && freeStock(world, 'hide') >= cost;
    case 'plate':
      return isUpgrade(pawn, 'plate') && freeStock(world, 'steel') >= cost + DEFENCE_STEEL_KEEP;
  }
}

/**
 * What this settler should make at the bench, best first, or empty for nothing.
 *
 * Rifle ahead of everything because an unarmed settler is the shortage that ends
 * colonies, and medicine ahead of balm because a colony that has earned the
 * better recipe should be using it — the fallback is a fallback, not a choice.
 */
export function wantedRecipes(world: World, pawn: Pawn): CraftRecipe[] {
  return RECIPE_ORDER.filter((r) => canCraft(world, pawn, r) && recipeWanted(world, pawn, r));
}

/** The first thing on that list — what the E-key prompt names, before any walking. */
export function wantedRecipe(world: World, pawn: Pawn): CraftRecipe | null {
  return wantedRecipes(world, pawn)[0] ?? null;
}

/**
 * The same decision plus the stack to spend on it — the part that costs a path
 * search, so only the caller that is actually about to start work pays for it.
 *
 * Walks the list rather than taking the head of it, because "wanted" and "makeable"
 * are different questions: a recipe wants the colony's *total* free stock, and it
 * spends a single stack. Ninety steel in three heaps of thirty wants a rifle and
 * cannot make one — and when this took only the first answer, that impossible
 * rifle stood in front of the medicine the colony could have made all along.
 */
export function benchRecipe(
  world: World,
  pawn: Pawn,
): { recipe: CraftRecipe; stack: ItemStack; cost: number } | null {
  for (const recipe of wantedRecipes(world, pawn)) {
    const cost = recipeCost(world, recipe);
    const stack = freeStack(world, pawn, CRAFT_DEFS[recipe].input.kind, cost);
    if (stack) return { recipe, stack, cost };
  }
  return null;
}

/**
 * Why this settler cannot start anything here, as a sentence for the player.
 *
 * Only ever called after `benchRecipe` has already said no, and its whole job is
 * to turn that no into something actionable. "Nothing worth making" is the truth
 * about a colony with a full medicine shelf and is a lie about a colony whose only
 * doctor is asleep — and the second one is the case where the player has a
 * decision to make, so it is the one worth spending a sentence on.
 */
export function benchRefusal(world: World, pawn: Pawn): string {
  let shortOfMaterial: CraftRecipe | null = null;
  let near: string | null = null;
  let far: string | null = null;
  for (const recipe of RECIPE_ORDER) {
    if (!recipeWanted(world, pawn, recipe)) continue;
    const why = craftBlocker(world, pawn, recipe);
    if (!why) {
      shortOfMaterial ??= recipe;
      continue;
    }
    // Nearest first. Balm and medicine both end up as medicine on the shelf, and
    // "nobody here is a herbalist at 5" is a thing the colony can fix this week;
    // "needs Field Medicine", on top of a doctor at 6, is two things away and not
    // the useful answer to the same question.
    const sentence = `You cannot make ${CRAFT_DEFS[recipe].label}: it ${why}.`;
    if (recipeResearched(world, recipe)) near ??= sentence;
    else far ??= sentence;
  }
  // A stack that is merely too small beats every gate: it is the one the colony
  // fixes by carrying something, and it is why the hauler exists.
  if (shortOfMaterial) {
    const def = CRAFT_DEFS[shortOfMaterial];
    return `No single stack of ${def.input.kind} big enough for ${def.label}.`;
  }
  if (near ?? far) return (near ?? far)!;
  return 'Nothing worth making here right now.';
}

/**
 * The first thing the colony wants made here that this settler may not make.
 *
 * The bench is the only station in the game that can refuse a qualified-looking
 * settler, and a station that goes quiet is indistinguishable from a broken one.
 * So the prompt uses this to keep talking when the recipe list is locked — see
 * `describeTarget`.
 */
export function lockedRecipe(world: World, pawn: Pawn): CraftRecipe | null {
  for (const recipe of RECIPE_ORDER) {
    if (!recipeWanted(world, pawn, recipe)) continue;
    if (canCraft(world, pawn, recipe)) continue;
    return recipe;
  }
  return null;
}

function tryWorkType(world: World, pawn: Pawn, work: WorkType): boolean {
  switch (work) {
    case 'firefight': {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const f of world.fires) {
        if (isCellTargeted(world, f.x, f.y)) continue;
        const d = dist(pawn.x, pawn.y, f.x, f.y);
        if (d < bestD && reachable(world, pawn, f.x, f.y, true)) {
          best = { x: f.x, y: f.y };
          bestD = d;
        }
      }
      if (best) {
        createJob(world, pawn, 'firefight', best.x, best.y, { stage: 'goto' });
        return true;
      }
      return false;
    }
    case 'doctor': {
      // Feeding comes before medicine. A downed settler cannot walk to the
      // pantry, so without this they starve to death beside a full stockpile —
      // and a colony that loses everyone to a fight it survived is not a
      // difficulty setting, it is a hole in the simulation.
      if (tryFeedPatient(world, pawn)) return true;

      let best: Pawn | null = null;
      let bestD = Infinity;
      for (const p of world.pawns) {
        if (p.id === pawn.id || p.dead) continue;
        // Prisoners get the same medicine settlers do. They arrived shot to
        // pieces, they cannot be talked round while unconscious, and a colony
        // that lets its captives die in the bunk gets nothing for the bunk.
        if (p.faction !== 'colony' && p.faction !== 'prisoner') continue;
        // Downed settlers first, but standing wounded get treated too — and so
        // does anybody running a fever whose dressing has gone stale. Re-tending
        // is the whole treatment for an illness: one visit buys half a day.
        if (!p.downed && p.hp >= p.maxHp * 0.7 && !wantsTending(world, p)) continue;
        if (isPawnTargeted(world, p.id)) continue;
        const d = dist(pawn.x, pawn.y, p.x, p.y);
        if (d < bestD && reachable(world, pawn, Math.round(p.x), Math.round(p.y), true)) {
          best = p;
          bestD = d;
        }
      }
      if (best) {
        const med = findStack(world, pawn, 'medicine');
        if (med) {
          const job = createJob(world, pawn, 'doctor', med.x, med.y, {
            targetPawnId: best.id,
            itemId: med.id,
            stage: 'goto',
          });
          med.reservedBy = job.id;
        } else {
          createJob(world, pawn, 'doctor', Math.round(best.x), Math.round(best.y), {
            targetPawnId: best.id,
            stage: 'carry',
          });
        }
        return true;
      }
      return false;
    }
    case 'warden': {
      const captives = prisoners(world);
      // The overwhelmingly common case, and every idle settler asks it every time
      // they look for work: no bunk was ever built and nobody is in one. Answer it
      // with two scans instead of the three pawn filters and a pathfind below.
      if (captives.length === 0 && !world.buildings.some((b) => b.kind === 'prisonbed' && b.built)) {
        return false;
      }

      // Capture first, and only capture while the shooting has stopped. A
      // settler who walks into a live firefight to pick a body up is a settler
      // you are about to lose, and the bodies will still be there in a minute.
      if (hostiles(world).length === 0) {
        const bunk = freeBunk(world);
        if (bunk) {
          let best: Pawn | null = null;
          let bestD = Infinity;
          for (const c of capturable(world)) {
            const d = dist(pawn.x, pawn.y, c.x, c.y);
            if (d >= bestD) continue;
            if (!reachable(world, pawn, Math.round(c.x), Math.round(c.y), true)) continue;
            best = c;
            bestD = d;
          }
          if (best) {
            createJob(world, pawn, 'capture', Math.round(best.x), Math.round(best.y), {
              targetPawnId: best.id,
              buildingId: bunk.id,
              stage: 'goto',
            });
            return true;
          }
        }
      }

      // Then meals. A prisoner cannot go and get one, so this is the whole of
      // their food supply — skip it and they starve in the bunk.
      let hungriest: Pawn | null = null;
      for (const p of captives) {
        if (p.needs.food >= FEED_PRISONER_BELOW) continue;
        if (isPawnTargeted(world, p.id)) continue;
        if (hungriest && hungriest.needs.food <= p.needs.food) continue;
        if (!reachable(world, pawn, Math.round(p.x), Math.round(p.y), true)) continue;
        hungriest = p;
      }
      if (hungriest) {
        const food = findFoodStack(world, pawn);
        if (food) {
          const job = createJob(world, pawn, 'feedPrisoner', food.x, food.y, {
            targetPawnId: hungriest.id,
            itemId: food.id,
            stage: 'goto',
          });
          food.reservedBy = job.id;
          return true;
        }
      }

      // And last, the talking — which needs them awake, and needs them to have
      // eaten recently enough that the conversation is about joining rather than
      // about dinner.
      for (const p of captives) {
        if (p.downed || (p.resistance ?? 0) <= 0) continue;
        if (world.tick < (p.talkCooldown ?? 0)) continue;
        if (p.needs.food < FEED_PRISONER_BELOW) continue;
        if (isPawnTargeted(world, p.id)) continue;
        if (!reachable(world, pawn, Math.round(p.x), Math.round(p.y), true)) continue;
        createJob(world, pawn, 'recruit', Math.round(p.x), Math.round(p.y), {
          targetPawnId: p.id,
          stage: 'goto',
        });
        return true;
      }
      return false;
    }
    case 'cook': {
      // Counted where the cook is standing, not across the whole map. A meal on
      // the far side of a locked door is not dinner, and a full larder the cooks
      // cannot walk to used to be enough to stop the kitchen for good: the count
      // was satisfied, so nobody cooked, so the people who could not reach the
      // larder ate off the ground until they stopped getting up. Region labels
      // are already maintained for the reachability checks below, so asking
      // costs an array read per stack.
      const here = regionAt(world, Math.round(pawn.x), Math.round(pawn.y));
      const mine = (x: number, y: number): boolean => here < 0 || regionAt(world, Math.round(x), Math.round(y)) === here;
      const colonists = world.pawns.filter(
        (p) => p.faction === 'colony' && !p.dead && mine(p.x, p.y),
      ).length;
      let meals = 0;
      for (const s of world.items) if (s.kind === 'meal' && mine(s.x, s.y)) meals += s.amount;
      if (meals >= colonists * 4 + 4) return false;
      const stove = findBuildingOfKind(world, pawn, 'stove');
      if (!stove) return false;
      // Every sack that will make a batch, oldest first — and then the first of
      // those the cook can actually walk to. Picking the single oldest sack and
      // giving up when it turned out to be unreachable shut the kitchen for good:
      // one sack behind a wall, or dropped out in a pen, stayed the oldest sack on
      // the map forever, so the cooks asked about that one every time and never
      // looked at the full larder standing behind them. Worse on a tie, which is
      // the common case — two fresh sacks, and whichever happened to be created
      // first won, so a colony could starve because of item ordering. Same shape
      // as the blueprint fix below: walk the ranking, take the first that is
      // actually workable, rather than committing to the head of the list.
      const sacks: ItemStack[] = [];
      for (const s of world.items) {
        if (s.kind !== 'rawfood' || s.carriedBy !== null || s.reservedBy !== null) continue;
        if (s.amount < MEAL_RAWFOOD_COST) continue;
        sacks.push(s);
      }
      sacks.sort((a, b) => (b.rot ?? 0) - (a.rot ?? 0));
      const raw = sacks.find((s) => reachable(world, pawn, s.x, s.y, false));
      if (!raw) return false;
      const job = createJob(world, pawn, 'cook', raw.x, raw.y, {
        itemId: raw.id,
        buildingId: stove.id,
        stage: 'goto',
      });
      raw.reservedBy = job.id;
      return true;
    }
    case 'craft': {
      // Stock totals first: the bench and stack lookups are path searches, and
      // most scans of this work type happen when there is nothing to make.
      if (!wantedRecipe(world, pawn)) return false;
      const bench = findBuildingOfKind(world, pawn, 'bench');
      if (!bench) return false;
      const plan = benchRecipe(world, pawn);
      if (!plan) return false;
      const job = createJob(world, pawn, 'craft', plan.stack.x, plan.stack.y, {
        itemId: plan.stack.id,
        buildingId: bench.id,
        recipe: plan.recipe,
        amount: plan.cost,
        stage: 'goto',
      });
      plan.stack.reservedBy = job.id;
      return true;
    }
    case 'farm': {
      // Ripe first: food in hand beats soil turned over, and a cell cannot be
      // re-sown until it has been picked anyway.
      let ripe: { x: number; y: number } | null = null;
      let bare: { x: number; y: number } | null = null;
      let ripeD = Infinity;
      let bareD = Infinity;
      for (const c of growingCells(world)) {
        const x = c % world.width;
        const y = Math.floor(c / world.width);
        const g = world.crops[c] ?? CROP_NONE;
        if (g < 0 && !sowingWanted(world)) continue;
        if (isCellTargeted(world, x, y)) continue;
        const d = dist(pawn.x, pawn.y, x, y);
        if (g >= 1) {
          if (d >= ripeD || !reachable(world, pawn, x, y, true)) continue;
          ripe = { x, y };
          ripeD = d;
        } else if (g < 0) {
          if (d >= bareD || !canSow(world, x, y)) continue;
          if (!reachable(world, pawn, x, y, true)) continue;
          bare = { x, y };
          bareD = d;
        }
      }
      if (ripe) {
        createJob(world, pawn, 'harvestCrop', ripe.x, ripe.y);
        return true;
      }
      // Then the animals. Ahead of sowing because a marked animal walks away and a
      // bare cell does not — the window on taming closes on its own.
      let quarry: Pawn | null = null;
      let quarryD = Infinity;
      for (const a of world.pawns) {
        if (!isTameable(world, a)) continue;
        if (isPawnTargeted(world, a.id)) continue;
        const d = dist(pawn.x, pawn.y, a.x, a.y);
        if (d >= quarryD) continue;
        if (!reachable(world, pawn, Math.round(a.x), Math.round(a.y), true)) {
          // Stamped so the next settler to go looking for work skips it instead of
          // searching the whole map again. Said out loud once, because an order
          // nobody is carrying out and nobody explained is the worst kind.
          if (a.unreachable === undefined) {
            msg(world, `Nobody can find a way to the ${animalDef(a).label.toLowerCase()}.`, 'bad');
          }
          a.unreachable = world.tick;
          continue;
        }
        quarry = a;
        quarryD = d;
      }
      if (quarry) {
        createJob(world, pawn, 'tame', Math.round(quarry.x), Math.round(quarry.y), {
          targetPawnId: quarry.id,
        });
        return true;
      }
      // Then the pen round. Behind taming because a marked animal wanders off and
      // a full udder does not — a ripe animal keeps until somebody gets to it, so
      // it is the farm job that can always wait one more sweep. Still ahead of
      // sowing, because it is work the colony has already paid for.
      let ripeBeast: Pawn | null = null;
      let ripeBeastD = Infinity;
      for (const a of world.pawns) {
        if (!isRipe(world, a)) continue;
        if (isPawnTargeted(world, a.id)) continue;
        const d = dist(pawn.x, pawn.y, a.x, a.y);
        if (d >= ripeBeastD) continue;
        if (!reachable(world, pawn, Math.round(a.x), Math.round(a.y), true)) continue;
        ripeBeast = a;
        ripeBeastD = d;
      }
      if (ripeBeast) {
        createJob(world, pawn, 'gatherAnimal', Math.round(ripeBeast.x), Math.round(ripeBeast.y), {
          targetPawnId: ripeBeast.id,
        });
        return true;
      }
      if (bare) {
        createJob(world, pawn, 'sow', bare.x, bare.y);
        return true;
      }
      // Then broken ground. Below every ripe thing above it, because tilling has
      // no deadline and a crop does — it must never be the reason a plot stood
      // unharvested — but *above* the wild fruit, and that ordering was learned
      // the hard way.
      //
      // It used to sit last, on the reasoning that two raw food in hand this
      // afternoon beats soil that pays off next season. True of any one
      // afternoon, and wrong over a week: the bushes are scenery. They ripen
      // again on their own, all over a map a hundred and twenty-eight cells
      // square, so "pick the nearest ripe one" is work that never runs out and
      // a till order painted by hand simply never came up. The player drew a
      // field and watched settlers walk past it into the brambles for two days.
      // Tilling is finite and somebody asked for it; foraging is infinite and
      // nobody did. Finite explicit work goes first or it starves.
      let till: { x: number; y: number } | null = null;
      let tillD = Infinity;
      for (let i = 0; i < world.cellDesig.length; i++) {
        if (world.cellDesig[i] !== DESIG_TILL) continue;
        const x = i % world.width;
        const y = Math.floor(i / world.width);
        if (!canTill(world, x, y)) continue;
        if (isCellTargeted(world, x, y)) continue;
        const d = dist(pawn.x, pawn.y, x, y);
        if (d >= tillD || !reachable(world, pawn, x, y, true)) continue;
        till = { x, y };
        tillD = d;
      }
      if (till) {
        createJob(world, pawn, 'till', till.x, till.y);
        return true;
      }
      // Last, the wild fruit — the farm's true idle work. Below sowing because a
      // plot compounds and a bush does not, and a settler who picked berries
      // instead of re-sowing would be trading a week of dinners for one.
      //
      // On its own appetite test, and a much hungrier one than sowing's: this is
      // the only entry on the whole board that can never run out, and an errand
      // that never runs out will eat every finite job behind it if you let it.
      // See `FORAGE_CEILING_PER_COLONIST` for what that cost when the two shared
      // a line.
      if (foragingWanted(world)) {
        // Where the picked fruit is going, which is what "how far out does the
        // colony forage" is measured from. No store for it and there is no
        // neighbourhood to be inside — the settler's own range is the only cap
        // there can be.
        const larder = findStockpileCell(world, 'rawfood', pawn);
        let berry: { x: number; y: number } | null = null;
        let berryD = FORAGE_RANGE;
        for (const b of ripeBushes(world)) {
          const x = unpackX(world, b.c);
          const y = unpackY(world, b.c);
          if (isCellTargeted(world, x, y)) continue;
          const d = dist(pawn.x, pawn.y, x, y);
          if (d >= berryD) continue;
          if (larder && dist(x, y, larder.x, larder.y) > FORAGE_HOME_RANGE) continue;
          if (!reachable(world, pawn, x, y, true)) continue;
          berry = { x, y };
          berryD = d;
        }
        if (berry) {
          createJob(world, pawn, 'forage', berry.x, berry.y);
          return true;
        }
      }
      return false;
    }
    case 'construct': {
      // Deconstruction first: the player asked for it explicitly.
      for (const b of world.buildings) {
        if (!b.built || b.kind === 'tree') continue;
        if (world.cellDesig[packCell(world, b.x, b.y)] !== DESIG_DECONSTRUCT) continue;
        if (isBuildingTargeted(world, b.id)) continue;
        if (!reachable(world, pawn, b.x, b.y, true)) continue;
        createJob(world, pawn, 'deconstruct', b.x, b.y, { buildingId: b.id });
        return true;
      }
      // A bunk out of the hall and into a room that has none. Above the
      // blueprints on purpose: the room is already standing and empty, and a
      // colony that leaves it empty while it raises the next shell has built
      // somewhere nobody lives. It is also the cheaper of the two ways to fill
      // it — the alternative is twenty planks for a second bed.
      if (moveBedJob(world, pawn)) return true;
      // Then the same order painted on bare floor, which is the other half of
      // what the X tool means. Walked over the designation array rather than over
      // a list of floors, because there is no list of floors — a floor is a cell,
      // and the designations are the only place the intent lives.
      if (removeFloorJob(world, pawn)) return true;
      // Nearest first, but not nearest only. A frame whose steel is not on the
      // map yet cannot be worked on, and the settler used to commit to it purely
      // because it was closest and then go home — so one blueprint nobody could
      // supply stopped every other blueprint on the map from ever being touched,
      // permanently, while the wood for them sat in the pile. Walk outwards and
      // take the first frame there is actually something to do about.
      const frames: Building[] = [];
      for (const b of world.buildings) {
        if (b.built) continue;
        if (isBuildingTargeted(world, b.id)) continue;
        frames.push(b);
      }
      frames.sort((a, b) => dist(pawn.x, pawn.y, a.x, a.y) - dist(pawn.x, pawn.y, b.x, b.y));
      for (const b of frames) {
        if (!reachable(world, pawn, b.x, b.y, true)) continue;
        const missing = missingResource(b);
        if (!missing) {
          createJob(world, pawn, 'build', b.x, b.y, { buildingId: b.id });
          return true;
        }
        const stack = findStack(world, pawn, missing.kind);
        if (!stack) continue;
        const job = createJob(world, pawn, 'haulToBlueprint', stack.x, stack.y, {
          buildingId: b.id,
          itemId: stack.id,
          resource: missing.kind,
          amount: missing.amount,
        });
        stack.reservedBy = job.id;
        return true;
      }
      // Floors come last of the construct work on purpose: they are the job that
      // has no deadline, so a floor order must never be the reason a half-built
      // wall stood open through a raid.
      return assignFloor(world, pawn);
    }
    case 'mine': {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let i = 0; i < world.cellDesig.length; i++) {
        if (world.cellDesig[i] !== DESIG_HARVEST) continue;
        const x = i % world.width;
        const y = Math.floor(i / world.width);
        if (terrainAt(world, x, y) !== 'rock') continue;
        if (isCellTargeted(world, x, y)) continue;
        const d = dist(pawn.x, pawn.y, x, y);
        if (d < bestD && reachable(world, pawn, x, y, true)) {
          best = { x, y };
          bestD = d;
        }
      }
      if (best) {
        createJob(world, pawn, 'mine', best.x, best.y);
        return true;
      }
      return false;
    }
    case 'chop': {
      let best: Building | null = null;
      let bestD = Infinity;
      for (const b of world.buildings) {
        if (b.kind !== 'tree' || !b.built) continue;
        if (world.cellDesig[packCell(world, b.x, b.y)] !== DESIG_HARVEST) continue;
        if (isBuildingTargeted(world, b.id)) continue;
        const d = dist(pawn.x, pawn.y, b.x, b.y);
        if (d < bestD && reachable(world, pawn, b.x, b.y, true)) {
          best = b;
          bestD = d;
        }
      }
      if (best) {
        createJob(world, pawn, 'chop', best.x, best.y, { buildingId: best.id });
        return true;
      }
      return false;
    }
    case 'research': {
      // Nothing chosen means nothing to do. This is the cheap test and it is the
      // usual answer, so it goes before the bench search — which is a path probe.
      if (world.research.current === null) return false;
      // A project that has run out of points and is waiting on a crate of parts
      // is not work. Standing at it would tie up the colony's best researcher
      // for the fortnight it takes somebody to walk to the workshops and back —
      // and that somebody is quite likely to be them.
      if (researchStalled(world)) return false;
      const lab = findBuildingOfKind(world, pawn, 'lab');
      if (!lab) return false;
      // One settler at a time. Two people pushing the same project would double
      // the rate for free, and the bench is one bench.
      if (isBuildingTargeted(world, lab.id)) return false;
      createJob(world, pawn, 'research', lab.x, lab.y, { buildingId: lab.id });
      return true;
    }
    case 'haul': {
      // Bodies before boxes. Hauling is the work type that means "move a thing
      // somewhere it belongs", and a corpse in the yard is the most expensive
      // misplaced thing in the colony — it is costing everyone mood for as long
      // as it lies there, which a crate of steel never does.
      //
      // Not during a fight, for the same reason the warden does not capture
      // during one: a settler who walks out into gunfire to fetch a body is
      // about to become one. The dead will keep for a minute.
      if (hostiles(world).length === 0) {
        // Not one another hauler is already walking a body towards: a grave is
        // only marked taken at the moment somebody is laid in it, so until then
        // the claim lives on the job.
        const grave = freeGraves(world).find((g) => !isBuildingTargeted(world, g.id));
        if (grave) {
          let body: Pawn | null = null;
          let bodyD = Infinity;
          for (const d of buriableDead(world)) {
            if (isPawnTargeted(world, d.id)) continue;
            const gap = dist(pawn.x, pawn.y, d.x, d.y);
            if (gap >= bodyD) continue;
            if (!reachable(world, pawn, Math.round(d.x), Math.round(d.y), true)) continue;
            body = d;
            bodyD = gap;
          }
          if (body) {
            createJob(world, pawn, 'bury', Math.round(body.x), Math.round(body.y), {
              targetPawnId: body.id,
              buildingId: grave.id,
              stage: 'goto',
            });
            return true;
          }
        }
      }

      // Asked once per kind, not once per sack. `findStockpileCell` walks every
      // cell of every stockpile that takes the kind and takes the temperature of
      // each one, and the answer wanted here is only *whether* there is anywhere
      // to put it — which cell does not depend on where the sack is standing. A
      // yard with forty loose stacks was paying for that search forty times over,
      // every twelve ticks, for every settler.
      const somewhereToPutIt = new Map<ResourceKind, { x: number; y: number } | null>();
      const store = (kind: ResourceKind): { x: number; y: number } | null => {
        let known = somewhereToPutIt.get(kind);
        if (known === undefined) {
          known = findStockpileCell(world, kind, pawn);
          somewhereToPutIt.set(kind, known);
        }
        return known;
      };

      let best: ItemStack | null = null;
      let bestD = Infinity;
      for (const s of world.items) {
        if (!needsHauling(world, s)) continue;
        const d = dist(pawn.x, pawn.y, s.x, s.y);
        if (d >= bestD) continue;
        const drop = store(s.kind);
        if (!drop) continue;
        if (!worthFetching(s, d + dist(s.x, s.y, drop.x, drop.y))) continue;
        if (!reachable(world, pawn, s.x, s.y, false)) continue;
        best = s;
        bestD = d;
      }
      if (best) {
        const job = createJob(world, pawn, 'haulToStockpile', best.x, best.y, { itemId: best.id });
        best.reservedBy = job.id;
        return true;
      }
      return false;
    }
    case 'hunt': {
      // A club is no use on something that bolts at 1.4× a walk: the first swing
      // lands and then the animal is gone for good. Hunting is rifle work — but
      // slaughtering livestock is not hunting. A tame animal stands there and lets
      // you walk up to it, so anyone can do it with whatever is in their hands.
      const armed = !WEAPONS[pawn.weapon].melee;
      // The nearest marked animal nobody else has claimed. No reachability probe:
      // the quarry is walking, so a path found now is stale by the time anyone
      // gets there — the job itself re-paths every tick and gives up on a timeout.
      let best: Pawn | null = null;
      let bestD = Infinity;
      for (const q of world.pawns) {
        if (!isHuntable(q)) continue;
        if (!armed && q.tame !== true) continue;
        if (isPawnTargeted(world, q.id)) continue;
        const d = dist(pawn.x, pawn.y, q.x, q.y);
        if (d < bestD) {
          best = q;
          bestD = d;
        }
      }
      if (best) {
        createJob(world, pawn, 'hunt', Math.round(best.x), Math.round(best.y), {
          targetPawnId: best.id,
        });
        return true;
      }
      // Nothing marked to shoot. Fishing lives at the bottom of the same work
      // type because it is the same instinct — go and get food that is not on the
      // farm — and because giving it a column of its own would have added a
      // fifteenth switch to the priorities panel for a job most colonies do for
      // one season a year. Below the hunt, always: a marked animal is a standing
      // order the player typed, and the lake is the colony's own idea.
      return startFishing(world, pawn);
    }
    case 'scout': {
      if (!scoutingAllowed(world, pawn)) return false;
      const site = findScoutSite(world, pawn);
      if (!site) return false;
      createJob(world, pawn, 'scout', site.x, site.y);
      msg(world, `${pawn.name} sets out to have a look at the country to the ${bearing(pawn, site)}.`);
      return true;
    }
    case 'caravan': {
      if (!caravanAllowed(world, pawn)) return false;
      // An open letter outranks a surplus run. It is worth three visits' standing
      // and it has a clock on it, whereas a pile of wood in the rain will still be
      // a pile of wood next week — and `answerable` has already checked that the
      // pack can go without eating into the colony's own reserve.
      const asked = answerable(world);
      // Whether the letter can still be answered, which is not the same question
      // as whether it could be answered when it arrived. `pickRequest` will not
      // write from a place the colony cannot reach, but a letter runs a fortnight
      // and that is long enough for the pantry to fall under the road it needs or
      // for the escort to be buried. Falling through to an ordinary surplus run is
      // what `answerable` already promises for a letter the colony cannot afford,
      // and a stale letter deserves the same treatment: a colony that answers
      // being asked a favour by refusing to trade at all for two weeks has been
      // made poorer by having been asked.
      const at = asked ? settlementById(world, asked.settlementId) : null;
      // ...and a bench with an unpaid bill outranks the letter in turn.
      //
      // This colony has one party. Every day it spends carrying somebody else's
      // grain is a day the last tier of the tree does not move, and unlike the
      // pile of wood in the rain an unfinished project is not still there next
      // week — it is the rest of the game, not waiting for it. The letter runs a
      // fortnight; the tier runs to the end of the clock.
      //
      // It took the sixty-day grid to see this, because it is invisible on any
      // run that never reaches the third tier: below it `researchNeeds` is empty
      // on every project and this clause is false on every tick. The runs that
      // did reach it were standing still for up to twenty-two days each while
      // the only settler on the road carried meal to a neighbour, and the parts
      // town five days out went unvisited for the whole of it.
      //
      // Asked of the bill and not of the stall, which is the difference between
      // a colony that finishes the tier and one that watches the clock run out
      // holding a full bar. `researchNeeds` is answered from the moment the
      // project is chosen — its own comment says why — and a third-tier project
      // is three weeks of study, against a round trip of ten or twelve days.
      // Reading it here means the crates and the last point arrive together;
      // reading `researchStalled` here instead means the walk starts on the day
      // the bar fills and the tier costs a fortnight of standing still. The
      // first cut of this rule made that mistake and calm/1312 duly sent its
      // party for parts on day fifty-five of sixty.
      //
      // Self-cancelling, like the bonuses in `settlements.ts`: the shortfall
      // goes empty the moment the crates are in the yard, and the letter after
      // that is answered as normal. It can also fire before the third tier — for
      // any project that costs materials — which is the same behaviour and not a
      // special case; there are four such projects and they are all up there.
      //
      // Both halves of it are `shoppingRun`'s to answer — whether there is an
      // open road that ends at the thing the bench is short of, and which one —
      // for the reasons written over it. A colony whose only parts town is
      // behind a shut ring gets `null` and goes back to answering letters, which
      // is right: refusing them there would leave it standing still *and*
      // trading away the standing that is its one way onto that road.
      //
      // Weighed only once there is something to carry. A colony with an empty
      // barn has no shopping trip to prefer, and turning the letter down on the
      // strength of a run it cannot make would cost the standing and buy nothing
      // — the settler stays home either way.
      //
      // What is spare is found before the road is chosen, so it is measured
      // against the biggest pack anywhere on the board and clamped below to what
      // the road actually chosen will carry.
      //
      // And when there is no surplus, the pack the letter asked for is what the
      // party carries — to wherever it is going. `answerable` and `spareGoods`
      // ask the same question against two different reserves, `COMMISSION_KEEP`
      // and the much higher `SURPLUS`, so there is a wide and ordinary band of
      // stores in which a colony can afford to give a neighbour a pack and
      // cannot afford to spend the same pack on itself. Left that way the
      // stricter test guards the trip that *helps* this colony, which is exactly
      // backwards, and calm/424242 spent day forty-two to day fifty-three
      // walking eight medicine out to a meal town while the bench it could have
      // been shopping for waited on steel the letter's own neighbour sells.
      // These are the colony's goods either way; the only question is which
      // errand they buy.
      const spare = spareGoods(world, packCeiling(world));
      const load = spare ?? asked;
      if (!load) return false;
      const errand = shoppingRun(world, load.kind);
      // Split from `honour` so the sentence below can tell "turned a neighbour
      // down" from "there was no neighbour to turn down". `answerable`
      // (`commissions.ts`) gates a letter on the due date and on the pantry and
      // never on range, so `at` can name a town the colony had no way of reaching
      // — and in the days before that letter lapses, a message keyed on `at`
      // alone apologises to somebody who was never going to be visited.
      const couldHonour = at !== null && withinRange(world, at).ok;
      const honour = couldHonour && errand === null;
      const give = honour ? (asked ?? load) : load;
      const dest = honour ? at : (errand ?? pickDestination(world, load.kind, load.amount));
      if (!dest) return false;
      const head = roadHead(world, dest, pawn);
      if (!head) return false;
      const amount = Math.min(give.amount, packLimit(dest, world));
      createJob(world, pawn, 'caravan', head.x, head.y, {
        settlementId: dest.id,
        resource: give.kind,
        amount,
      });
      msg(
        world,
        honour
          ? `${pawn.name} loads the ${amount} ${give.kind} ${dest.name} asked for and sets out.`
          : // Named, because from the outside the two look identical — a settler
            // walking off with a pack — and one of them is the colony deciding to
            // leave a neighbour waiting. A player who is about to lose standing
            // at a town is owed the sentence that explains it.
            errand !== null && couldHonour && at !== null
            ? // "needs", not "is waiting on": most of the time this trip leaves
              // while the bench is still studying, which is the whole point of
              // it, and a sentence that said the work had stopped when it had
              // not would teach the player to distrust the log.
              `${pawn.name} loads ${amount} ${give.kind} for ${dest.name}: the bench needs what they sell, ` +
              `and ${at.name} will have to keep.`
            : `${pawn.name} loads ${amount} ${give.kind} and sets out for ${dest.name}.`,
        'info',
      );
      return true;
    }
  }
}

/**
 * Send a named settler to a named neighbour with a named pack — the panel's
 * entry point, and the player-ordered half of the trade road.
 *
 * Lives here rather than in `settlements.ts` only because creating a job is this
 * module's business; every rule about whether the trip is allowed is over there,
 * in `planCaravan`, so the two ways to start a caravan cannot drift apart.
 *
 * The goods are deliberately not taken yet. They are taken at the map edge, by
 * `departCaravan` — so calling the trip off halfway costs the colony the walk
 * and nothing else, and a pack the colony ate while its carrier was crossing the
 * yard turns them round instead of leaving with an empty sack.
 */
export function orderCaravan(
  world: World,
  pawn: Pawn,
  settlementId: number,
  give: { kind: ResourceKind; amount: number },
): { ok: boolean; text: string } {
  const plan = planCaravan(world, pawn, settlementId, give);
  if (!plan.ok) return { ok: false, text: plan.text };
  if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
  createJob(world, pawn, 'caravan', plan.head.x, plan.head.y, {
    settlementId: plan.settlement.id,
    resource: give.kind,
    amount: give.amount,
  });
  msg(world, `${pawn.name} loads a pack for ${plan.settlement.name} — ${give.amount} ${give.kind}.`, 'info');
  return { ok: true, text: `${pawn.name} sets out for ${plan.settlement.name}.` };
}

/**
 * Send the war party — the panel's other entry point, and the only way one is
 * ever raised. The colony's own job picker never plans a war.
 *
 * Same shape as `orderCaravan` and for the same reason: every rule about whether
 * the march may happen lives in `planCampaign`, and the jobs that carry three
 * settlers to the treeline are this module's business.
 */
export function orderCampaign(world: World, holdingId: number): { ok: boolean; text: string } {
  const plan = planCampaign(world, holdingId);
  if (!plan.ok) return { ok: false, text: plan.text };
  musterWarParty(world, plan);
  for (const pawn of plan.party) {
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
    createJob(world, pawn, 'campaign', plan.head.x, plan.head.y, { holdingId: plan.holding.id });
  }
  return { ok: true, text: `The war party forms up for ${plan.holding.name}.` };
}

/** Rough compass direction from a settler to somewhere, for the message log. */
function bearing(pawn: Pawn, to: { x: number; y: number }): string {
  const dx = to.x - pawn.x;
  const dy = to.y - pawn.y;
  const ns = dy < 0 ? 'north' : 'south';
  const ew = dx < 0 ? 'west' : 'east';
  if (Math.abs(dx) > Math.abs(dy) * 2) return ew;
  if (Math.abs(dy) > Math.abs(dx) * 2) return ns;
  return `${ns}-${ew}`;
}

/** What a blueprint is still short of, or null when it has everything. */
export function missingResource(b: Building): { kind: ResourceKind; amount: number } | null {
  for (const key of Object.keys(b.needs) as ResourceKind[]) {
    const need = b.needs[key] ?? 0;
    const have = b.have[key] ?? 0;
    if (have < need) return { kind: key, amount: need - have };
  }
  return null;
}

export function blueprintReady(b: Building): boolean {
  return missingResource(b) === null;
}

/**
 * How far a supply run will carry on before going back to the pile.
 *
 * Frames come in runs — a wall is ten of them in a line, a room is four walls and
 * a door — and a run is the shape this number is cut to. Measured on three seeds,
 * the unclaimed demand for the same resource near a frame is the same at three
 * cells as it is at ten, which says frames cluster tightly and a supply run does
 * not need to wander to find its next stop.
 */
const SUPPLY_RADIUS = 4;

/**
 * The other frames one trip to the woodpile could serve.
 *
 * Fetching exactly what one frame is short of is what turns a ten-segment wall
 * into ten round trips to the same pile, and hauling to blueprints is the second
 * largest slice of a settler's walking after hauling to the stockpile. Both the
 * pickup and the relay ask this: the pickup to size the armful, the delivery to
 * find where to take the surplus.
 *
 * `isBuildingTargeted` is what keeps two settlers from both loading up for the
 * same frame — a frame somebody else has claimed is somebody else's errand, and
 * carrying wood for it only means carrying it home again.
 */
function frameNeed(
  world: World,
  from: Building,
  kind: ResourceKind,
  pawn: Pawn | null,
): { total: number; nearest: Building | null } {
  let total = 0;
  let nearest: Building | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if (b.built || b.id === from.id) continue;
    if (Math.abs(b.x - from.x) > SUPPLY_RADIUS || Math.abs(b.y - from.y) > SUPPLY_RADIUS) continue;
    const need = (b.needs[kind] ?? 0) - (b.have[kind] ?? 0);
    if (need <= 0) continue;
    if (isBuildingTargeted(world, b.id)) continue;
    if (pawn && !reachable(world, pawn, b.x, b.y, true)) continue;
    total += need;
    const d = dist(from.x, from.y, b.x, b.y);
    if (d < bestD) {
      bestD = d;
      nearest = b;
    }
  }
  return { total, nearest };
}

/**
 * Push loose goods out from under a wall that has just closed over them.
 *
 * The sibling of the rule below it, and it was missing for the whole of this
 * game's life. A stack is picked up by standing *on* it — `findStack` asks
 * `reachable(..., false)` — so the moment a solid building finishes on a cell
 * holding items, those items stop existing for every purpose except counting.
 * `countResource` still sees them, which is the part that makes it a trap rather
 * than a loss: the colony believes it has the wood, so nothing goes out for more.
 *
 * That is not a hypothetical. On seed 1312 the colony walled and fenced over four
 * woodpiles — forty-nine wood on grass and dirt, under two walls and a fence —
 * and from day twenty-four it never built another thing. Twenty frames standing,
 * eight settlers healthy, fed, unbroken and idle nineteen thousand ticks a day,
 * because every one of those frames wanted wood and the only wood was under a
 * wall. `boardClear` then froze the Steward on top of it, so the colony could not
 * even order the trees cut that would have got it out.
 *
 * Nearest standable cell, and the stack keeps its reservation: a hauler already
 * walking to it finds it one square over, which the pickup handles, and the
 * alternative — dropping the claim — is a stack that two settlers then race for.
 * Only for buildings that are actually solid. A bed or a lamp over a sack of
 * wheat buries nothing, because somebody can still stand there and lift it.
 */
export function shoveItemsClear(world: World, b: Building): void {
  if (!defOf(b.kind).solid) return;
  const here = itemsAt(world, b.x, b.y);
  if (here.length === 0) return;
  const spot = adjacentStandCells(world, b.x, b.y).find((c) => isWalkable(world, c.x, c.y));
  // Nowhere to put it down is a stack in the middle of a sealed wall, which the
  // doorway check above has already refused to build. Leave it rather than
  // teleport it across the map — a settler can always take the wall back down.
  if (!spot) return;
  for (const s of here) {
    s.x = spot.x;
    s.y = spot.y;
  }
}

/** Pick a job for an idle settler. Needs jump the queue; then player priorities. */
export function assignJob(world: World, pawn: Pawn): void {
  if (pawn.jobId !== null || pawn.dead || pawn.downed || pawn.drafted) return;
  if (pawn.activity === 'sleeping') return;
  // Rescue outranks comfort. Without this, settlers who won the fight ate, went to
  // bed and then played darts while the settler who took the hits for them bled out
  // on the floor at zero food — the colony survives the raid and loses someone to a
  // game of darts. It does not outrank the rescuer's *own* crisis: a settler who is
  // themself starving deals with that first, or two die instead of one. Exhaustion
  // is not in that class: an empty rest need costs mood, never consciousness, so
  // carrying one meal across the room before bed is always the better trade.
  //
  // Hunger is not in that class either, until it is nearly the same crisis. This
  // read `> HUNGRY` for a long time and excused a settler at 0.33 — most of a day
  // in hand — from an errand for somebody at 0.00. See `RESCUER_KEEPS`.
  const canRescue = pawn.priorities.doctor > 0 && pawn.needs.food > RESCUER_KEEPS;
  if (canRescue && dyingPatient(world, pawn.id) && tryFeedPatient(world, pawn)) return;
  if (tryNeedJob(world, pawn)) return;
  // A settler on a morale break still looks after themselves — the need jobs
  // above are exactly what gets them back on their feet — but does nothing for
  // anyone else until they do.
  if (isBreaking(pawn)) return;
  pickWorkJob(world, pawn);
  // Nothing on the board. A settler stood in the yard is a settler losing morale
  // for no reason the player can act on — the work is genuinely finished — so an
  // empty board sends them to a seat instead. Work always wins: this only runs
  // once `pickWorkJob` has had its answer and come back with nothing.
  if (pawn.jobId === null && pawn.needs.recreation < IDLE_REC) takeABreak(world, pawn);
}

/**
 * Food, bed and a break — and nothing the colony wanted doing.
 *
 * What a hand-driven settler gets. Taking somebody off the work board says "do
 * what I tell you", not "starve at my convenience": a player who parks a settler
 * on a wall for the afternoon and comes back to a corpse has been punished for
 * using the feature. Everything the colony would have had them do is skipped, so
 * an empty control stack really does mean they stand there.
 */
export function assignNeedsOnly(world: World, pawn: Pawn): boolean {
  if (pawn.jobId !== null || pawn.dead || pawn.downed || pawn.drafted) return false;
  if (pawn.activity === 'sleeping') return false;
  // The rescue that outranks a settler's own comfort in `assignJob` outranks the
  // control stack too. A settler with work lined up is still on the work board,
  // and a stack is not a reason to step over somebody bleeding out on the way to
  // the next tree. Hand-driven settlers are the exception on purpose: the player
  // took them off the board, and a rescue is work like any other.
  if (
    !pawn.manual &&
    pawn.priorities.doctor > 0 &&
    pawn.needs.food > RESCUER_KEEPS &&
    dyingPatient(world, pawn.id) &&
    tryFeedPatient(world, pawn)
  ) {
    return true;
  }
  // The return value matters to the caller in `tick.ts`: true means "they are
  // looking after themselves now", which covers both the job this creates and
  // the settler who had nowhere to sleep and lay down where they stood.
  return tryNeedJob(world, pawn);
}

/**
 * The work board, in the order the player set: the best job this settler is
 * allowed to take, ignoring their needs and whether they already have one.
 *
 * Split out of `assignJob` so the look-ahead planner can ask the same question
 * the assignment tick asks. There is exactly one ranking of work in this game and
 * both callers have to be looking at it, or the stack would show a plan the
 * colony has no intention of following.
 *
 * `ceiling` narrows the question to "anything better than this", which is what
 * `startQueued` asks before honouring a plan. The rank it compares against is the
 * position in these two loops flattened to a number — level first, because a
 * level-2 doctor is not a level-1 anything — and it is stamped on the planned job
 * here, at the one place that knows both halves of it.
 */
function pickWorkJob(world: World, pawn: Pawn, ceiling = Infinity): boolean {
  const planning = planningFor?.id === pawn.id;
  // The one thing that outranks the player's ordering, and only after the colony
  // has spent half a day of quiet afternoons not taking the chance — see
  // `tickScoutItch` for why the bottom of a board this long is otherwise the
  // same as off it. Never while planning ahead: an expedition is exactly the
  // unstable, minutes-long claim `PLAN_NEVER` exists to keep out of the stack.
  if (!planning && ceiling === Infinity && pawn.priorities.scout > 0 && scoutOverdue(world)) {
    if (tryWorkType(world, pawn, 'scout')) {
      bore(world, pawn, 'scout');
      return true;
    }
  }
  // Two passes over the board, and only when this is the real question rather
  // than the planner's or `startQueued`'s "anything better than this?": the
  // first skips whatever they have had their fill of, the second ignores
  // tedium entirely. Nobody ever idles out of sulking — a settler with nothing
  // else to do goes back to the thing they are sick of, and `bore` charges them
  // the irritation for it. See `tedium.ts`.
  const choosy = !planning && ceiling === Infinity;
  for (let pass = 0; pass < (choosy ? 2 : 1); pass++) {
    for (let level = 1; level <= 4; level++) {
      for (let i = 0; i < WORK_TYPES.length; i++) {
        const w = WORK_TYPES[i]!;
        if (pawn.priorities[w] !== level) continue;
        // The two loops walk the ranking in order, so the first rank that fails
        // the ceiling is the last one worth asking about.
        const rank = level * 100 + i;
        if (rank >= ceiling) return false;
        if (planning && PLAN_NEVER.has(w)) continue;
        if (choosy && pass === 0 && boredOf(world, pawn, w)) continue;
        if (tryWorkType(world, pawn, w)) {
          if (planning) {
            const q = queueOf(pawn);
            const planned = world.jobs.find((j) => j.id === q[q.length - 1]);
            if (planned) planned.rank = rank;
          } else {
            // Planned work is booked when it is actually started, in
            // `startQueued` — a plan is not a shift worked.
            bore(world, pawn, w);
          }
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Work the look-ahead will not line up, whatever the priorities say.
 *
 * These are the three whose claims `stableToHold` would throw away anyway, and
 * skipping them here rather than cancelling afterwards is the difference between
 * a planner that finds the next *stable* job and one that finds a haul, claims
 * it, drops it, and queues nothing. In a colony with a yard full of loose goods
 * — which is most colonies, most of the time — the second one never plans
 * anything at all while paying for a full board scan to discover that.
 *
 * `stableToHold` stays as the net behind this, because a work type being
 * plannable does not make every job it produces plannable: hauling to a
 * blueprint is construction work, and it reserves a stack like any other haul.
 */
const PLAN_NEVER: ReadonlySet<WorkType> = new Set<WorkType>(['haul', 'scout', 'caravan']);

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

type WalkResult = 'arrived' | 'walking' | 'blocked';

/**
 * Lay a route to the cell, or to somewhere a body can stand beside it.
 *
 * `'blocked'` from here is the real thing: either there is nowhere to aim — the
 * cell is solid and the caller wanted to stand on it, or nothing around it can be
 * stood on — or there is nowhere to walk. Thirty job sites read that as the end of
 * the errand, so nothing else may return it.
 */
function layPath(world: World, pawn: Pawn, tx: number, ty: number, exact: boolean): WalkResult {
  const goals = new Set<number>();
  if (exact) {
    if (!isWalkable(world, tx, ty)) return 'blocked';
    goals.add(packCell(world, tx, ty));
  } else {
    for (const c of adjacentStandCells(world, tx, ty)) goals.add(packCell(world, c.x, c.y));
    if (isWalkable(world, tx, ty)) goals.add(packCell(world, tx, ty));
    if (goals.size === 0) return 'blocked';
  }
  const p = findPath(world, Math.round(pawn.x), Math.round(pawn.y), tx, ty, { goals });
  if (!p) return 'blocked';
  if (p.length === 0) return 'arrived';
  pawn.path = p;
  return 'walking';
}

function walkTo(world: World, pawn: Pawn, tx: number, ty: number, exact: boolean): WalkResult {
  const px = Math.round(pawn.x);
  const py = Math.round(pawn.y);
  const atExact = px === tx && py === ty && Math.hypot(pawn.x - tx, pawn.y - ty) < 0.25;
  const atAdj = Math.max(Math.abs(px - tx), Math.abs(py - ty)) <= 1;
  if (exact ? atExact : atAdj) {
    pawn.path = null;
    pawn.facing = Math.atan2(ty - pawn.y, tx - pawn.x) || pawn.facing;
    return 'arrived';
  }
  if (!pawn.path) {
    const laid = layPath(world, pawn, tx, ty, exact);
    if (laid !== 'walking') return laid;
  }
  pawn.activity = 'walking';
  // Read before the step, because the counter is reset by the very branch that
  // needs identifying — see below.
  const wedged = pawn.stuck;
  const done = followPath(world, pawn, WALK_SPEED);
  if (done) return 'arrived';
  if (pawn.path) return 'walking';
  // `followPath` has thrown the route away, and only it knows which of its two
  // reasons applied. They want opposite things, so this has to tell them apart.
  //
  // A wall went up across the route. The line that drops it says what should
  // happen next — *re-path rather than tunnel* — and this is the only place that
  // can happen: `walkTo` lays a path once a tick and has already laid this one,
  // so without asking again here the drop leaves the caller holding a settler
  // with no route, which every job in this file reads as the end of the errand.
  // A settler four cells short of a one-cell wall used to give up rather than
  // step round it.
  //
  // Or the body spent twenty-five ticks going nowhere, which is the backstop for
  // a settler wedged on a corner that pathfinding is perfectly happy with. Here a
  // re-path is not a second chance, it is a loop: the search returns the same
  // route into the same corner, the body wedges again, and the pair of them
  // trade a full A* every twenty-six ticks until `JOB_TIMEOUT` calls it off
  // ~1800 ticks later. Measured rather than reasoned about — re-pathing both
  // drops took `tests/forest.test.ts` from 522s to past a 600s ceiling it never
  // reached, and timed out ten files that were green before.
  //
  // `stuck` is read before the step because the wedge branch zeroes it on the way
  // out; the wall branch returns before ever touching it. So a non-zero count
  // here is the wedge, and only the wedge, giving up the errand as it always did.
  if (wedged >= STUCK_LIMIT) return 'blocked';
  return layPath(world, pawn, tx, ty, exact);
}

function pickUp(world: World, pawn: Pawn, item: ItemStack, amount?: number): ItemStack | null {
  if (item.carriedBy !== null) return null;
  let target = item;
  if (amount !== undefined && amount < item.amount) {
    item.amount -= amount;
    target = {
      id: nextId(world),
      kind: item.kind,
      amount,
      x: item.x,
      y: item.y,
      carriedBy: null,
      reservedBy: item.reservedBy,
      // Splitting a pile does not refresh it. Without this, hauling a stack to a
      // stockpile one armful at a time would reset the clock on every trip.
      rot: item.rot,
    };
    world.items.push(target);
  }
  target.carriedBy = pawn.id;
  pawn.carryingItemId = target.id;
  return target;
}

/**
 * How far a hauler reaches around the cell they are standing on to fill their arms.
 *
 * Two, and not more, because the rule has to stay legible from the isometric view:
 * a settler stoops over a pile and sweeps up what is lying beside it. Three starts
 * looking like they are collecting from across the clearing without moving.
 */
const GATHER_RADIUS = 2;

/**
 * Every cell within `steps` steps of one, walking only on ground a settler could
 * stand on. Diagonals count as one step, the same way `followPath` walks them.
 */
function stepsFrom(world: World, x: number, y: number, steps: number): Set<number> {
  const seen = new Set<number>([packCell(world, x, y)]);
  let edge: Cell[] = [{ x, y }];
  for (let d = 0; d < steps; d++) {
    const next: Cell[] = [];
    for (const c of edge) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = c.x + dx;
          const ny = c.y + dy;
          if (!isWalkable(world, nx, ny)) continue;
          const key = packCell(world, nx, ny);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ x: nx, y: ny });
        }
      }
    }
    edge = next;
  }
  return seen;
}

/**
 * An armful, not a handful.
 *
 * A settler who has just walked out to a felled tree picks up the stack they were
 * sent for and then gathers whatever else of the same kind is lying within reach,
 * up to what one person can carry. Everything about this is about the legs. Bucket
 * three days of a founding colony by activity and it reads six ticks walking to
 * every one worked, and hauling to the stockpile is the single largest slice of
 * that walk — pure transit, no work ticks at all. Measured over three seeds, a
 * hauler standing on a pickup could take **rather more than twice** what they were
 * sent for without taking a step: 12.0 in the arms and 15.6 more within two cells
 * on seed 20260729, 15.2 and 18.4 on seed 21. Sending them home with one handful
 * and then sending them back out for the next is the colony spending its day on
 * the same walk twice.
 *
 * The three guards are what keep it honest rather than a teleport. It only takes
 * what genuinely wants hauling — `needsHauling`, so a pile already sitting in a
 * stockpile that accepts it is left alone — never anything another settler has
 * claimed, and never anything more than two *steps* away.
 *
 * Steps, and not distance, and that distinction is the whole difference between
 * stooping and reaching through a wall. A region check is not enough here: a free
 * standing wall in open country has the same region on both sides, so "can they
 * get there eventually" answers yes to a heap they would have to walk round the
 * end of the wall to touch. The flood below only walks cells a settler could
 * actually stand on, so what it reaches is what an arm reaches.
 *
 * Candidates are collected before any are emptied because `removeItem` splices
 * `world.items`, and mutating it inside its own loop would skip a stack.
 */
function gatherArmful(world: World, pawn: Pawn): void {
  const held = findItem(world, pawn.carryingItemId);
  if (!held) return;
  let room = MAX_STACK - held.amount;
  if (room <= 0) return;
  const cx = Math.round(pawn.x);
  const cy = Math.round(pawn.y);
  const within = stepsFrom(world, cx, cy, GATHER_RADIUS);
  const near: ItemStack[] = [];
  for (const s of world.items) {
    if (s.id === held.id || s.kind !== held.kind) continue;
    if (Math.abs(s.x - cx) > GATHER_RADIUS || Math.abs(s.y - cy) > GATHER_RADIUS) continue;
    if (!within.has(packCell(world, s.x, s.y))) continue;
    if (!needsHauling(world, s)) continue;
    near.push(s);
  }
  for (const s of near) {
    if (room <= 0) break;
    const put = Math.min(room, s.amount);
    mergeRot(held, put, s.rot ?? 0);
    held.amount += put;
    s.amount -= put;
    room -= put;
    if (s.amount <= 0) removeItem(world, s);
  }
}

function dropCarried(world: World, pawn: Pawn, x: number, y: number): void {
  const it = findItem(world, pawn.carryingItemId);
  pawn.carryingItemId = null;
  if (!it) return;
  it.carriedBy = null;
  it.reservedBy = null;
  const existing = itemsAt(world, x, y).find((s) => s.kind === it.kind && s.amount < MAX_STACK && s.id !== it.id);
  if (existing) {
    const room = MAX_STACK - existing.amount;
    const put = Math.min(room, it.amount);
    mergeRot(existing, put, it.rot ?? 0);
    existing.amount += put;
    it.amount -= put;
    if (it.amount <= 0) {
      removeItem(world, it);
      return;
    }
  }
  it.x = x;
  it.y = y;
}

function finishJob(world: World, pawn: Pawn, job: Job): void {
  pawn.jobId = null;
  pawn.path = null;
  if (pawn.activity !== 'sleeping' && pawn.activity !== 'downed' && pawn.activity !== 'dead') {
    pawn.activity = 'idle';
  }
  const i = world.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) world.jobs.splice(i, 1);
  for (const s of world.items) if (s.reservedBy === job.id) s.reservedBy = null;
}

/**
 * Advance one settler's current job by one tick.
 *
 * `rng` is the combat stream: hunting is the one job that resolves a weapon, and
 * it deliberately rolls on the same stream a firefight does rather than growing
 * a private source of randomness.
 */
export function tickJob(world: World, pawn: Pawn, rng: Rng): void {
  const job = world.jobs.find((j) => j.id === pawn.jobId);
  if (!job) {
    pawn.jobId = null;
    return;
  }
  job.age++;
  // A hunt is a pursuit, not a chore: stalking something through woodland and
  // then wearing it down takes minutes, and the ordinary timeout — which exists
  // to unstick a settler wedged against a wall — was cutting kills off a few
  // seconds before they landed.
  if (job.age > (job.kind === 'hunt' ? JOB_TIMEOUT * 2 : JOB_TIMEOUT)) {
    cancelJob(world, job.id);
    return;
  }

  switch (job.kind) {
    case 'haulToStockpile': {
      const item = findItem(world, job.itemId);
      if (!item) return cancelJob(world, job.id);
      if (job.stage === 'goto') {
        const r = walkTo(world, pawn, item.x, item.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pickUp(world, pawn, item);
          // Fill the arms before choosing where to put them down: the destination
          // is picked for what is being carried, and the armful is now bigger.
          gatherArmful(world, pawn);
          const dest = findStockpileCell(world, item.kind, pawn);
          if (!dest) {
            dropCarried(world, pawn, Math.round(pawn.x), Math.round(pawn.y));
            return cancelJob(world, job.id);
          }
          job.tx = dest.x;
          job.ty = dest.y;
          job.stage = 'deliver';
        }
        return;
      }
      if (job.stage === 'deliver') {
        const r = walkTo(world, pawn, job.tx, job.ty, true);
        if (r === 'blocked') {
          dropCarried(world, pawn, Math.round(pawn.x), Math.round(pawn.y));
          return cancelJob(world, job.id);
        }
        if (r === 'arrived') {
          dropCarried(world, pawn, job.tx, job.ty);
          return finishJob(world, pawn, job);
        }
      }
      return;
    }

    case 'haulToBlueprint': {
      const b = findBuilding(world, job.buildingId);
      if (!b || b.built) return cancelJob(world, job.id);
      if (job.stage === 'goto') {
        const item = findItem(world, job.itemId);
        if (!item) return cancelJob(world, job.id);
        const r = walkTo(world, pawn, item.x, item.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          // Enough for this frame and for whatever else is going up beside it, so
          // a wall is one trip to the woodpile rather than one per segment.
          const spare = job.resource ? frameNeed(world, b, job.resource, pawn).total : 0;
          const want = Math.min(item.amount, MAX_STACK, (job.amount ?? item.amount) + spare);
          pickUp(world, pawn, item, want);
          job.stage = 'deliver';
          job.tx = b.x;
          job.ty = b.y;
        }
        return;
      }
      if (job.stage === 'deliver') {
        const r = walkTo(world, pawn, b.x, b.y, false);
        if (r === 'blocked') {
          dropCarried(world, pawn, Math.round(pawn.x), Math.round(pawn.y));
          return cancelJob(world, job.id);
        }
        if (r === 'arrived') {
          const it = findItem(world, pawn.carryingItemId);
          if (it && job.resource) {
            const need = (b.needs[job.resource] ?? 0) - (b.have[job.resource] ?? 0);
            const put = Math.max(0, Math.min(need, it.amount));
            b.have[job.resource] = (b.have[job.resource] ?? 0) + put;
            it.amount -= put;
            if (it.amount <= 0) {
              pawn.carryingItemId = null;
              removeItem(world, it);
            } else {
              // Still holding some, and this frame is full: walk it to the next
              // one in the run rather than putting it down and fetching it again.
              // The job carries on rather than a new one being assigned, because
              // the settler is already loaded and the work board would have them
              // start the errand from the pile. `age` resets because a delivery
              // landed — the timeout is there to unstick somebody wedged against
              // a wall, and a frame that just got its wood is the opposite of
              // stuck.
              const next = frameNeed(world, b, job.resource, pawn).nearest;
              if (next) {
                job.buildingId = next.id;
                job.tx = next.x;
                job.ty = next.y;
                job.age = 0;
                return;
              }
              dropCarried(world, pawn, Math.round(pawn.x), Math.round(pawn.y));
            }
          }
          return finishJob(world, pawn, job);
        }
      }
      return;
    }

    case 'build': {
      const b = findBuilding(world, job.buildingId);
      if (!b || b.built) return cancelJob(world, job.id);
      if (!blueprintReady(b)) return cancelJob(world, job.id);
      const r = walkTo(world, pawn, b.x, b.y, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(b.y - pawn.y, b.x - pawn.x) || pawn.facing;
      pawn.animPhase += 0.35;
      b.work += workRate(pawn, 'construction');
      if (b.work >= b.workLeft) {
        // The map is not what it was when this frame was pegged out. A door may
        // have gone up next to it since, or the wall the door sits in may only
        // just have closed — and a frame that was harmless on Monday seals the
        // cabin on Thursday. Placement is where the colony *intends*; this is
        // where it becomes true, so the question gets asked once more here.
        if (defOf(b.kind).solid && wouldBlockDoorway(world, b.x, b.y)) {
          for (const k of Object.keys(b.have) as ResourceKind[]) {
            const n = b.have[k] ?? 0;
            if (n > 0) addItem(world, k, n, b.x, b.y);
          }
          removeBuilding(world, b);
          forgetRebuild(world, b.x, b.y);
          msg(world, `${pawn.name} left the doorway at ${b.x},${b.y} open.`, 'bad');
          return cancelJob(world, job.id);
        }
        b.built = true;
        markBuildingsChanged(world);
        b.work = b.workLeft;
        b.hp = b.maxHp;
        b.needs = {};
        world.stats.built++;
        gainSkill(world, pawn, 'construction', 0.12);
        msg(world, `${pawn.name} finished a ${defOf(b.kind).label.toLowerCase()}.`, 'good');
        // And a wall raised over the woodpile must not bury it.
        shoveItemsClear(world, b);
        // A wall raised under a body must not trap it.
        for (const p of world.pawns) {
          if (p.dead) continue;
          if (Math.round(p.x) === b.x && Math.round(p.y) === b.y && defOf(b.kind).solid) {
            const spot = adjacentStandCells(world, b.x, b.y)[0];
            if (spot) {
              p.x = spot.x;
              p.y = spot.y;
              p.path = null;
            }
          }
        }
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'deconstruct': {
      // Two jobs wearing one name. A building order carries `buildingId`; a floor
      // order carries `floorX`/`floorY` and nothing else, because the cell is the
      // thing being removed and there is no object to point at.
      if (job.floorX !== undefined && job.floorY !== undefined) {
        const fx = job.floorX;
        const fy = job.floorY;
        const kind = floorAt(world, fx, fy);
        // Re-checked on arrival for the same reason tilling is: between the order
        // and the walk somebody may have built on the cell, or laid a wall over
        // it, or another settler may have got here first.
        if (kind === null || !canRemoveFloor(world, fx, fy)) {
          world.cellDesig[packCell(world, fx, fy)] = DESIG_NONE;
          return cancelJob(world, job.id);
        }
        const r = walkTo(world, pawn, fx, fy, kind !== 'bridge');
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r !== 'arrived') return;
        pawn.activity = 'working';
        pawn.facing = Math.atan2(fy - pawn.y, fx - pawn.x) || pawn.facing;
        pawn.animPhase += 0.35;
        job.progress += workRate(pawn, 'construction') * 1.8;
        const fdef = FLOOR_DEFS[kind];
        if (job.progress >= fdef.work) {
          // Half back, the same rate a deconstructed building pays. Boards come
          // off a floor in better shape than a wall comes down, but a rule the
          // player already knows is worth more than a rule that is fairer.
          const refund = Math.floor(fdef.amount * 0.5);
          if (refund > 0) addItem(world, fdef.cost, refund, fx, fy);
          removeFloor(world, fx, fy);
          world.cellDesig[packCell(world, fx, fy)] = DESIG_NONE;
          return finishJob(world, pawn, job);
        }
        return;
      }
      const b = findBuilding(world, job.buildingId);
      if (!b || !b.built) return cancelJob(world, job.id);
      const r = walkTo(world, pawn, b.x, b.y, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.animPhase += 0.35;
      job.progress += workRate(pawn, 'construction') * 1.8;
      if (job.progress >= defOf(b.kind).work) {
        const def = defOf(b.kind);
        for (const k of Object.keys(def.cost) as ResourceKind[]) {
          const refund = Math.floor((def.cost[k] ?? 0) * 0.5);
          if (refund > 0) addItem(world, k, refund, b.x, b.y);
        }
        world.cellDesig[packCell(world, b.x, b.y)] = 0;
        removeBuilding(world, b);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'till': {
      // Re-checked on arrival, because between the order and the walk somebody
      // may have raised a wall on the cell or already broken it.
      if (!canTill(world, job.tx, job.ty)) {
        world.cellDesig[packCell(world, job.tx, job.ty)] = DESIG_NONE;
        return cancelJob(world, job.id);
      }
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(job.ty - pawn.y, job.tx - pawn.x) || pawn.facing;
      pawn.animPhase += 0.35;
      job.progress += workRate(pawn, 'plants');
      if (job.progress >= TILL_WORK) {
        setTerrain(world, job.tx, job.ty, 'dirt');
        world.cellDesig[packCell(world, job.tx, job.ty)] = DESIG_NONE;
        gainSkill(world, pawn, 'plants', 0.12);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'floor': {
      const kind = job.floorKind;
      const fx = job.floorX;
      const fy = job.floorY;
      if (!kind || fx === undefined || fy === undefined) return cancelJob(world, job.id);
      if (!canFloor(world, fx, fy, kind)) {
        world.cellDesig[packCell(world, fx, fy)] = DESIG_NONE;
        dropCarried(world, pawn, Math.round(pawn.x), Math.round(pawn.y));
        return cancelJob(world, job.id);
      }
      const def = FLOOR_DEFS[kind];
      if (job.stage === 'goto') {
        const mat = findItem(world, job.itemId);
        if (!mat) return cancelJob(world, job.id);
        const r = walkTo(world, pawn, mat.x, mat.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pickUp(world, pawn, mat, Math.min(job.amount ?? def.amount, mat.amount));
          job.stage = 'carry';
          job.tx = fx;
          job.ty = fy;
        }
        return;
      }
      if (job.stage === 'carry') {
        // Every other floor is laid standing on it. A bridge is laid standing at
        // the end of the one before it, leaning out over the water — same reason
        // `assignFloor` let this cell through in the first place, and the two have
        // to agree or a settler walks all the way out with six boards and finds
        // the cell they were sent to is still lake.
        const r = walkTo(world, pawn, fx, fy, kind !== 'bridge');
        if (r === 'blocked') {
          dropCarried(world, pawn, Math.round(pawn.x), Math.round(pawn.y));
          return cancelJob(world, job.id);
        }
        if (r === 'arrived') job.stage = 'work';
        return;
      }
      if (job.stage === 'work') {
        pawn.activity = 'working';
        pawn.animPhase += 0.32;
        job.progress += workRate(pawn, 'construction');
        if (job.progress >= def.work) {
          // The boards are consumed whole. A settler who fetched a short stack
          // still lays the floor — the shortfall came out of the woodpile the
          // colony had, which is the honest version of running low.
          const carried = findItem(world, pawn.carryingItemId);
          if (carried) {
            pawn.carryingItemId = null;
            removeItem(world, carried);
          }
          layFloor(world, fx, fy, kind);
          world.cellDesig[packCell(world, fx, fy)] = DESIG_NONE;
          gainSkill(world, pawn, 'construction', 0.1);
          return finishJob(world, pawn, job);
        }
      }
      return;
    }

    case 'mine': {
      if (terrainAt(world, job.tx, job.ty) !== 'rock') {
        world.cellDesig[packCell(world, job.tx, job.ty)] = 0;
        return cancelJob(world, job.id);
      }
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(job.ty - pawn.y, job.tx - pawn.x) || pawn.facing;
      pawn.animPhase += 0.4;
      job.progress += workRate(pawn, 'mining');
      if (job.progress >= 150) {
        setTerrain(world, job.tx, job.ty, 'stone');
        world.cellDesig[packCell(world, job.tx, job.ty)] = 0;
        addItem(
          world,
          'steel',
          Math.round((12 + pawn.skills.mining * 0.6) * toolYield(world)),
          job.tx,
          job.ty,
        );
        gainSkill(world, pawn, 'mining', 0.15);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'craft': {
      const bench = findBuilding(world, job.buildingId);
      if (!bench || !bench.built) return cancelJob(world, job.id);
      const recipe = job.recipe ?? 'medicine';
      if (job.stage === 'goto') {
        const mat = findItem(world, job.itemId);
        if (!mat) return cancelJob(world, job.id);
        const r = walkTo(world, pawn, mat.x, mat.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pickUp(world, pawn, mat, Math.min(job.amount ?? mat.amount, mat.amount));
          job.stage = 'carry';
          job.tx = bench.x;
          job.ty = bench.y;
        }
        return;
      }
      if (job.stage === 'carry') {
        const r = walkTo(world, pawn, bench.x, bench.y, false);
        if (r === 'blocked') {
          dropCarried(world, pawn, Math.round(pawn.x), Math.round(pawn.y));
          return cancelJob(world, job.id);
        }
        if (r === 'arrived') job.stage = 'work';
        return;
      }
      if (job.stage === 'work') {
        const def = CRAFT_DEFS[recipe];
        // Whichever trade this settler brought to the bench — see `craftSkill`.
        const trade = craftSkill(pawn, recipe);
        pawn.activity = 'working';
        pawn.facing = Math.atan2(bench.y - pawn.y, bench.x - pawn.x) || pawn.facing;
        pawn.animPhase += 0.3;
        job.progress += workRate(pawn, trade);
        if (job.progress >= def.work) {
          const carried = findItem(world, pawn.carryingItemId);
          if (carried) {
            pawn.carryingItemId = null;
            removeItem(world, carried);
          }
          if ('weapon' in def.output) {
            pawn.weapon = def.output.weapon;
            msg(world, `${pawn.name} finished a rifle at the bench.`, 'good');
          } else if ('equip' in def.output) {
            // Worn on the spot. The displaced piece is named out loud rather than
            // quietly binned — forty-five steel leaving the colony's only suit of
            // plate because somebody got round to a coat is a decision, and the
            // player should get to see it go.
            const shed = equip(pawn, def.output.equip);
            msg(
              world,
              shed
                ? `${pawn.name} finished ${def.label} — and set aside ${equipPhrase(shed)}.`
                : `${pawn.name} finished ${def.label} at the bench.`,
              'good',
            );
            // Plate only, and once. A settler who beat out the colony's first
            // suit of armour is a thing you would say about them; a settler who
            // owns a toolbelt is not, and eight lines is the whole of a life.
            if (def.output.equip === 'plate') {
              rememberFirst(world, pawn, 'beat out', 'beat out a suit of steel plate and wore it');
            }
          } else {
            const spot = adjacentStandCells(world, bench.x, bench.y)[0] ?? {
              x: Math.round(pawn.x),
              y: Math.round(pawn.y),
            };
            addItem(world, def.output.kind, def.output.amount, spot.x, spot.y);
            // Both halves named, because they are not the same thing: balm is a
            // recipe and what comes out of it is medicine, and a player who is
            // watching their medicine count has to be able to connect the two.
            msg(
              world,
              `${pawn.name} finished a batch of ${def.label} — ${yieldPhrase(def.output.kind, def.output.amount)}.`,
              'good',
            );
          }
          // The one place in the sim that pays a breakthrough. Making the thing is
          // how you come to understand the thing, and a settler who has spent all
          // week at the bench should occasionally walk away a whole level better
          // rather than one two-tenths richer.
          gainSkill(world, pawn, trade, def.xp, { breakthrough: BREAKTHROUGH_CHANCE });
          return finishJob(world, pawn, job);
        }
      }
      return;
    }

    case 'chop': {
      const b = findBuilding(world, job.buildingId);
      if (!b || b.kind !== 'tree') return cancelJob(world, job.id);
      const r = walkTo(world, pawn, b.x, b.y, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(b.y - pawn.y, b.x - pawn.x) || pawn.facing;
      pawn.animPhase += 0.4;
      job.progress += workRate(pawn, 'construction');
      if (job.progress >= 110) {
        const { x, y } = b;
        world.cellDesig[packCell(world, x, y)] = 0;
        removeBuilding(world, b);
        addItem(world, 'wood', chopYield(world, b), x, y);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'research': {
      const lab = findBuilding(world, job.buildingId);
      if (!lab || lab.kind !== 'lab' || !lab.built) return cancelJob(world, job.id);
      // The player can change their mind while somebody is standing at the bench.
      // Stalling counts as being finished with for now, for the same reason it is
      // not offered in the first place: there is nothing left here to do until a
      // party gets back.
      if (world.research.current === null || researchStalled(world)) {
        return finishJob(world, pawn, job);
      }
      const r = walkTo(world, pawn, lab.x, lab.y, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(lab.y - pawn.y, lab.x - pawn.x) || pawn.facing;
      pawn.animPhase += 0.16;
      // Straight onto the world, not onto `job.progress`. A research job runs for
      // days of colony time and will be interrupted by every meal and every raid;
      // banking the points as they are earned is what makes those interruptions
      // cost an afternoon instead of the whole project.
      const done = addResearchPoints(world, workRate(pawn, 'research') * benchRateScale(world));
      // Every other skill is awarded per finished piece of work — a rock mined,
      // a meal cooked. Research has no such unit, so it pays out every tick, and
      // at the rate the other skills use that took a settler from novice to
      // master inside a minute of game time and tripled their output with them.
      // Slow enough that mastery is about three uninterrupted days at the bench.
      gainSkill(world, pawn, 'research', 0.0015);
      if (done) {
        msg(world, `${pawn.name} worked out ${done.label}. ${done.blurb}`, 'good');
        // The whole colony hears about it. Small, but it is the one lift in the
        // game that comes from a thing the player chose rather than a thing they
        // maintained, and a month-long project should be felt when it lands.
        celebrate(world);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'hunt': {
      const quarry = world.pawns.find((p) => p.id === job.targetPawnId);
      // Gone means killed and swept, or the save was loaded past it. Either way
      // the meat (if any) is already on the ground and this job is done.
      if (!quarry || quarry.dead || quarry.faction !== 'fauna') {
        return finishJob(world, pawn, job);
      }
      if (huntStrike(world, pawn, quarry, rng)) {
        pawn.activity = 'fighting';
        pawn.path = null;
        return;
      }

      // The quarry moves, so a plan made a second ago is already wrong: pick a
      // fresh place to shoot from and re-path to it. Once a second rather than
      // every tick, because choosing that spot searches for line of sight, and
      // because a hunter who re-thinks every 50 ms never gets anywhere.
      const melee = WEAPONS[pawn.weapon].melee;
      if (job.age % 20 === 0 || pawn.path === null) {
        // A club has no standoff to find — `shootingSpot` would happily hand back
        // a cell two away, which is outside a 1.6-cell swing, and the butcher
        // would stand there re-picking the cell it was already on. Walk right up.
        const spot = melee
          ? { x: Math.round(quarry.x), y: Math.round(quarry.y) }
          : shootingSpot(world, quarry, pawn, WEAPONS[pawn.weapon].range);
        job.tx = spot.x;
        job.ty = spot.y;
        pawn.path = null;
      }
      const r = walkTo(world, pawn, job.tx, job.ty, melee);
      if (r === 'blocked') return cancelJob(world, job.id);
      pawn.activity = 'walking';
      return;
    }

    case 'tame': {
      const beast = world.pawns.find((p) => p.id === job.targetPawnId);
      if (!beast || beast.dead || beast.tame === true || beast.tameTarget !== true) {
        return finishJob(world, pawn, job);
      }
      // A gunshot undoes an afternoon's work. This is the only way taming can fail
      // — the player is never shown a percentage, they are shown a bolting animal —
      // so taming during a raid is the mistake rather than the dice being unkind.
      if ((beast.fleeUntil ?? 0) > world.tick) {
        if (job.progress > 0) {
          msg(world, `The ${animalDef(beast).label.toLowerCase()} bolts — ${pawn.name} loses the thread.`, 'bad');
        }
        return cancelJob(world, job.id);
      }

      const d = dist(pawn.x, pawn.y, beast.x, beast.y);
      if (d > TAME_REACH) {
        // The animal drifts while grazing, so re-aim at where it is now.
        if (job.age % 10 === 0 || pawn.path === null) {
          job.tx = Math.round(beast.x);
          job.ty = Math.round(beast.y);
          pawn.path = null;
        }
        const r = walkTo(world, pawn, job.tx, job.ty, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        pawn.activity = 'walking';
        return;
      }

      pawn.path = null;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(beast.y - pawn.y, beast.x - pawn.x) || pawn.facing;
      pawn.animPhase += 0.14;
      job.progress += workRate(pawn, 'plants');
      if (job.progress >= TAME_WORK) {
        settleAnimal(world, beast);
        // The handler keeps what they tame, and this is the only place in the game
        // that knows who the handler was — a sweep run a tick later would have to
        // guess from who is standing nearest, which on a busy day is whoever
        // happened to walk past. Refuses on its own when this settler already has
        // an animal, so the bond stays one apiece. See `pets.ts`.
        bondPet(world, pawn, beast);
        gainSkill(world, pawn, 'plants', 0.35);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'gatherAnimal': {
      const stock = world.pawns.find((p) => p.id === job.targetPawnId);
      // Re-checked rather than trusted: the walk out takes long enough for the
      // animal to have been slaughtered, to have strayed out of the pen, or —
      // most often — for somebody nearer to have got there first.
      if (!stock || !isRipe(world, stock)) return finishJob(world, pawn, job);

      const d = dist(pawn.x, pawn.y, stock.x, stock.y);
      if (d > GATHER_REACH) {
        // It grazes while you cross the pen, same as a tame target does.
        if (job.age % 10 === 0 || pawn.path === null) {
          job.tx = Math.round(stock.x);
          job.ty = Math.round(stock.y);
          pawn.path = null;
        }
        const r = walkTo(world, pawn, job.tx, job.ty, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        pawn.activity = 'walking';
        return;
      }

      pawn.path = null;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(stock.y - pawn.y, stock.x - pawn.x) || pawn.facing;
      pawn.animPhase += 0.14;
      job.progress += workRate(pawn, 'plants');
      if (job.progress >= GATHER_WORK) {
        collectFrom(world, stock, (y) => {
          addItem(world, y.kind, y.amount, Math.round(stock.x), Math.round(stock.y));
          msg(world, `${pawn.name} ${y.verb} the ${animalDef(stock).label.toLowerCase()}.`, 'good');
        });
        gainSkill(world, pawn, 'plants', 0.12);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'cook': {
      const stove = findBuilding(world, job.buildingId);
      if (!stove || !stove.built) return cancelJob(world, job.id);
      if (job.stage === 'goto') {
        const raw = findItem(world, job.itemId);
        if (!raw) return cancelJob(world, job.id);
        const r = walkTo(world, pawn, raw.x, raw.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pickUp(world, pawn, raw, Math.min(MEAL_RAWFOOD_COST, raw.amount));
          job.stage = 'carry';
          job.tx = stove.x;
          job.ty = stove.y;
        }
        return;
      }
      if (job.stage === 'carry') {
        const r = walkTo(world, pawn, stove.x, stove.y, false);
        if (r === 'blocked') {
          dropCarried(world, pawn, Math.round(pawn.x), Math.round(pawn.y));
          return cancelJob(world, job.id);
        }
        if (r === 'arrived') job.stage = 'work';
        return;
      }
      if (job.stage === 'work') {
        pawn.activity = 'working';
        pawn.facing = Math.atan2(stove.y - pawn.y, stove.x - pawn.x) || pawn.facing;
        pawn.animPhase += 0.25;
        job.progress += workRate(pawn, 'cooking');
        if (job.progress >= 170) {
          const carried = findItem(world, pawn.carryingItemId);
          if (carried) {
            pawn.carryingItemId = null;
            removeItem(world, carried);
          }
          const spot = adjacentStandCells(world, stove.x, stove.y)[0] ?? { x: Math.round(pawn.x), y: Math.round(pawn.y) };
          addItem(world, 'meal', MEALS_PER_BATCH, spot.x, spot.y);
          world.stats.mealsCooked += MEALS_PER_BATCH;
          gainSkill(world, pawn, 'cooking', 0.2);
          msg(world, `${pawn.name} cooked ${MEALS_PER_BATCH} meals.`, 'good');
          return finishJob(world, pawn, job);
        }
      }
      return;
    }

    case 'sow': {
      const cell = packCell(world, job.tx, job.ty);
      // The plot can be un-painted, walled over or already sown by someone else
      // between the job being created and the settler arriving.
      if (world.crops[cell] !== CROP_NONE || !canSow(world, job.tx, job.ty)) {
        return cancelJob(world, job.id);
      }
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(job.ty - pawn.y, job.tx - pawn.x) || pawn.facing;
      pawn.animPhase += 0.3;
      job.progress += workRate(pawn, 'plants');
      if (job.progress >= SOW_WORK) {
        world.crops[cell] = 0;
        gainSkill(world, pawn, 'plants', 0.08);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'fish': {
      const stage = findBuilding(world, job.buildingId);
      if (!stage || !stage.built) return cancelJob(world, job.id);
      // The stage is walkable — it is a deck, not a workbench — so the fisher
      // stands *on* it rather than beside it, which is why this asks to arrive at
      // the cell itself. It also means the catch lands on the plank, where a
      // hauler can reach it without stepping in the lake.
      const r = walkTo(world, pawn, stage.x, stage.y, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(stage.y - pawn.y, stage.x - pawn.x) || pawn.facing;
      // Slower than the cook's hands and the harvester's: a line in the water is
      // mostly waiting, and the animation should look like waiting.
      pawn.animPhase += 0.12;
      job.progress += workRate(pawn, 'plants');
      if (job.progress >= catchWork(world)) {
        const through = iceBears(world);
        const yielded = catchYield(world, pawn.skills.plants ?? 0);
        takeFish(world);
        world.stats.rawGathered = (world.stats.rawGathered ?? 0) + yielded;
        addItem(world, 'rawfood', yielded, stage.x, stage.y);
        gainSkill(world, pawn, 'plants', 0.14);
        msg(
          world,
          through
            ? `${pawn.name} pulls ${yielded} fish up through the ice.`
            : `${pawn.name} lands ${yielded} fish.`,
          'good',
        );
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'harvestCrop': {
      const cell = packCell(world, job.tx, job.ty);
      // Fire, a wall, or a raider trampling the plot can un-ripen the cell.
      if ((world.crops[cell] ?? CROP_NONE) < 1) return cancelJob(world, job.id);
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(job.ty - pawn.y, job.tx - pawn.x) || pawn.facing;
      pawn.animPhase += 0.3;
      job.progress += workRate(pawn, 'plants');
      if (job.progress >= HARVEST_WORK) {
        // Back to bare soil, not straight to a seedling: re-sowing is its own job,
        // so a player who erases the zone actually stops the loop.
        world.crops[cell] = CROP_NONE;
        const yielded = CROP_YIELD + Math.floor(pawn.skills.plants * 0.3);
        world.stats.rawGathered = (world.stats.rawGathered ?? 0) + yielded;
        addItem(world, 'rawfood', yielded, job.tx, job.ty);
        gainSkill(world, pawn, 'plants', 0.16);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'forage': {
      const bush = bushAt(world, job.tx, job.ty);
      // Gone, or something ate it while the settler was walking. A brambletail
      // strips a bush in a tick and the walk out can be a minute, so this is not
      // the rare case it looks like — it is the food chain being felt from the
      // colony's side, and the right response is to quietly go and find another.
      if (!bush || !isRipeBush(bush)) return cancelJob(world, job.id);
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(job.ty - pawn.y, job.tx - pawn.x) || pawn.facing;
      pawn.animPhase += 0.3;
      job.progress += workRate(pawn, 'plants');
      if (job.progress >= FORAGE_WORK) {
        const yielded = pickBush(bush, pawn.skills.plants);
        world.stats.rawGathered = (world.stats.rawGathered ?? 0) + yielded;
        addItem(world, 'rawfood', yielded, job.tx, job.ty);
        // A third of what a crop pays, because it is a third of the work and none
        // of the judgement. Enough that a colony's first plants levels come off
        // the moor before the plot is in, which is the right first job for the
        // settler who is going to end up farming.
        gainSkill(world, pawn, 'plants', 0.05);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'eat': {
      if (job.stage === 'goto') {
        const food = findItem(world, job.itemId);
        if (!food) return cancelJob(world, job.id);
        const r = walkTo(world, pawn, food.x, food.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pickUp(world, pawn, food, 1);
          const table = findBuildingOfKind(world, pawn, 'table');
          if (table && dist(pawn.x, pawn.y, table.x, table.y) < 26) {
            job.stage = 'carry';
            job.tx = table.x;
            job.ty = table.y;
            job.buildingId = table.id;
          } else {
            job.stage = 'work';
          }
        }
        return;
      }
      if (job.stage === 'carry') {
        const r = walkTo(world, pawn, job.tx, job.ty, false);
        if (r === 'arrived' || r === 'blocked') job.stage = 'work';
        return;
      }
      if (job.stage === 'work') {
        pawn.activity = 'eating';
        job.progress += 1;
        if (job.progress >= 55) {
          const food = findItem(world, pawn.carryingItemId);
          if (food) {
            const value =
              (FOOD_VALUE[food.kind] ?? 0.25) * (food.kind === 'meal' ? mealValueScale(world) : 1);
            pawn.needs.food = Math.min(1, pawn.needs.food + value);
            pawn.needs.recreation = Math.min(1, pawn.needs.recreation + (job.buildingId ? 0.08 : 0));
            // What they ate and where. Both small, both entirely inside the
            // player's control, which is the whole point of putting mood on them.
            nudgeMood(pawn, food.kind === 'meal' ? MOOD_ATE_COOKED : MOOD_ATE_RAW);
            if (job.buildingId) nudgeMood(pawn, MOOD_ATE_AT_TABLE);
            // Uncooked food is a gamble, which is the point of owning a stove.
            if (food.kind !== 'meal') maybeFoodPoisoning(world, pawn);
            food.amount -= 1;
            pawn.carryingItemId = null;
            if (food.amount <= 0) removeItem(world, food);
            else {
              food.carriedBy = null;
              food.reservedBy = null;
              food.x = Math.round(pawn.x);
              food.y = Math.round(pawn.y);
            }
          }
          return finishJob(world, pawn, job);
        }
      }
      return;
    }

    case 'sleep': {
      const bed = findBuilding(world, job.buildingId);
      if (!bed || !bed.built) return cancelJob(world, job.id);
      if (job.stage === 'goto') {
        const r = walkTo(world, pawn, bed.x, bed.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          job.stage = 'work';
          bed.occupant = pawn.id;
          pawn.x = bed.x;
          pawn.y = bed.y;
        }
        return;
      }
      if (job.stage === 'work') {
        pawn.activity = 'sleeping';
        bed.occupant = pawn.id;
        pawn.needs.rest = Math.min(1, pawn.needs.rest + REST_GAIN_BED);
        // Anything *hostile* nearby, not merely anything that is not a settler:
        // a mossback grazing outside the window is not a reason to get out of bed,
        // and reading it as one cost the colony every night's sleep it ever had.
        const threatNear = world.pawns.some(
          (p) =>
            isHostileTo('colony', p.faction) &&
            !p.dead &&
            !p.downed &&
            dist(p.x, p.y, pawn.x, pawn.y) < 12,
        );
        // A patient stays in the bunk after they are rested — that is what bed
        // rest *is*, and it is where their immunity climbs fastest. They still
        // get up for a raid or an empty stomach.
        const wellRested = pawn.needs.rest > 0.985 && !needsBedRest(pawn);
        if (wellRested || threatNear || (pawn.needs.food < 0.12 && pawn.needs.rest > 0.5)) {
          bed.occupant = null;
          pawn.activity = 'idle';
          return finishJob(world, pawn, job);
        }
      }
      return;
    }

    case 'recreate': {
      const spot = findBuilding(world, job.buildingId);
      // A fire that has burnt out stops being somewhere to sit, so the check is
      // `isRecSpot` rather than `built` — otherwise a settler sits in the dark
      // at a ring of cold stones getting full marks for it.
      if (!spot || !isRecSpot(spot)) return cancelJob(world, job.id);
      const r = walkTo(world, pawn, spot.x, spot.y, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'relaxing';
      pawn.facing = Math.atan2(spot.y - pawn.y, spot.x - pawn.x) || pawn.facing;
      pawn.needs.recreation = Math.min(
        1,
        pawn.needs.recreation + REC_GAIN_TABLE * recRate(world, pawn, spot),
      );
      if (pawn.needs.recreation > 0.9) return finishJob(world, pawn, job);
      return;
    }

    case 'doctor': {
      const patient = findPawn(world, job.targetPawnId ?? null);
      if (!patient || patient.dead) return cancelJob(world, job.id);
      if (!patient.downed && patient.hp >= patient.maxHp && !wantsTending(world, patient)) {
        return cancelJob(world, job.id);
      }
      if (job.stage === 'goto') {
        const med = findItem(world, job.itemId);
        if (!med) {
          job.stage = 'carry';
          return;
        }
        const r = walkTo(world, pawn, med.x, med.y, true);
        if (r === 'blocked') {
          job.stage = 'carry';
          return;
        }
        if (r === 'arrived') {
          pickUp(world, pawn, med, 1);
          job.stage = 'carry';
        }
        return;
      }
      if (job.stage === 'carry') {
        const r = walkTo(world, pawn, Math.round(patient.x), Math.round(patient.y), false);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') job.stage = 'work';
        return;
      }
      if (job.stage === 'work') {
        pawn.activity = 'working';
        job.progress += workRate(pawn, 'medicine');
        if (job.progress >= 90) {
          const med = findItem(world, pawn.carryingItemId);
          const potency = med ? 1.8 : 1;
          if (med) {
            med.amount -= 1;
            pawn.carryingItemId = null;
            if (med.amount <= 0) removeItem(world, med);
            else {
              med.carriedBy = null;
              med.reservedBy = null;
              med.x = Math.round(pawn.x);
              med.y = Math.round(pawn.y);
            }
          }
          patient.bleed = 0;
          const wasDowned = patient.downed;
          patient.hp = Math.min(
            patient.maxHp,
            patient.hp +
              (18 * potency + pawn.skills.medicine) *
                treatmentPotency(world) *
                gearTreatmentScale(pawn),
          );
          // Dressings and fever. Quality is the doctor's skill plus whether they
          // brought real medicine, and it decides both how far the illness is
          // slowed and how fast the patient's own body catches up.
          const quality = Math.min(1, (med ? 0.45 : 0.15) + pawn.skills.medicine * 0.035);
          const tended = tendAilments(world, patient, quality);
          if (wasDowned && patient.hp > patient.maxHp * 0.35 && !tooIllToStand(patient)) {
            patient.downed = false;
            patient.activity = 'idle';
            msg(world, `${pawn.name} patched ${patient.name} back up.`, 'good');
          } else if (!wasDowned) {
            const what = tended && patient.hp >= patient.maxHp ? 'fever' : 'wounds';
            msg(world, `${pawn.name} treated ${patient.name}'s ${what}.`, 'good');
          }
          gainSkill(world, pawn, 'medicine', 0.25);
          return finishJob(world, pawn, job);
        }
      }
      return;
    }

    case 'feedPatient': {
      const patient = findPawn(world, job.targetPawnId ?? null);
      if (!patient || patient.dead) return cancelJob(world, job.id);
      // They got back up, or somebody else got there first.
      if (!patient.downed || patient.needs.food >= 0.95) return cancelJob(world, job.id);
      if (job.stage === 'goto') {
        const food = findItem(world, job.itemId);
        if (!food) return cancelJob(world, job.id);
        const r = walkTo(world, pawn, food.x, food.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pickUp(world, pawn, food, 1);
          job.stage = 'carry';
        }
        return;
      }
      if (job.stage === 'carry') {
        const r = walkTo(world, pawn, Math.round(patient.x), Math.round(patient.y), false);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') job.stage = 'work';
        return;
      }
      pawn.activity = 'working';
      job.progress += 1;
      if (job.progress >= 40) {
        const food = findItem(world, pawn.carryingItemId);
        if (!food) return cancelJob(world, job.id);
        patient.needs.food = Math.min(1, patient.needs.food + (FOOD_VALUE[food.kind] ?? 0.25));
        food.amount -= 1;
        pawn.carryingItemId = null;
        if (food.amount <= 0) removeItem(world, food);
        else {
          food.carriedBy = null;
          food.reservedBy = null;
          food.x = Math.round(pawn.x);
          food.y = Math.round(pawn.y);
        }
        msg(world, `${pawn.name} fed ${patient.name}.`, 'good');
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'capture': {
      const captive = findPawn(world, job.targetPawnId ?? null);
      const bunk = findBuilding(world, job.buildingId);
      // The captive died on the way, got back on their feet, or the bunk burned
      // down while the warden was walking to them. All three end the job the
      // same way — and `cancelJob` is what puts a shouldered body back down.
      if (!captive || captive.dead || !bunk || !bunk.built) return cancelJob(world, job.id);
      if (pawn.carryingPawnId !== captive.id && !captive.downed) return cancelJob(world, job.id);

      if (job.stage === 'goto') {
        const r = walkTo(world, pawn, Math.round(captive.x), Math.round(captive.y), true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pawn.carryingPawnId = captive.id;
          job.stage = 'carry';
        }
        return;
      }
      // Shouldered: the captive's position is written from the carrier every
      // tick, so there is one body being carried rather than two bodies walking
      // through each other. Both views read the same numbers.
      captive.x = pawn.x;
      captive.y = pawn.y;
      captive.facing = pawn.facing;
      captive.path = null;
      const r = walkTo(world, pawn, bunk.x, bunk.y, true);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r === 'arrived') {
        pawn.carryingPawnId = null;
        imprison(world, captive, bunk);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'bury': {
      const body = findPawn(world, job.targetPawnId ?? null);
      const grave = findBuilding(world, job.buildingId);
      // The grave burned down, somebody else got there first, or — the one that
      // actually happens — the body rotted away while the hauler was walking to
      // it. `cancelJob` is what puts a shouldered body back down.
      if (!body || !body.dead || body.buried) return cancelJob(world, job.id);
      if (!grave || !grave.built || grave.kind !== 'grave') return cancelJob(world, job.id);
      if (grave.occupant !== undefined && grave.occupant !== null && grave.occupant !== body.id) {
        return cancelJob(world, job.id);
      }
      // Somebody else shouldered this one first. Two haulers carrying the same
      // corpse would both write its position every tick and both bury it.
      if (
        pawn.carryingPawnId !== body.id &&
        world.pawns.some((q) => q !== pawn && q.carryingPawnId === body.id)
      ) {
        return cancelJob(world, job.id);
      }

      if (job.stage === 'goto') {
        const r = walkTo(world, pawn, Math.round(body.x), Math.round(body.y), true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pawn.carryingPawnId = body.id;
          job.stage = 'carry';
        }
        return;
      }
      // Shouldered, and the body's position is written from the carrier every
      // tick — the same contract `capture` uses, so both views show one person
      // carrying another rather than two bodies walking through each other.
      body.x = pawn.x;
      body.y = pawn.y;
      body.facing = pawn.facing;
      body.path = null;
      const r = walkTo(world, pawn, grave.x, grave.y, true);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r === 'arrived') {
        pawn.carryingPawnId = null;
        bury(world, body, grave);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'moveBed': {
      // Taking the bunk out of the hall, not building a second one.
      //
      // The colony starts with every bed in the main building, which is the
      // right way to start — a roof is what keeps people alive and eight bunks
      // under one is a colony that has solved that. What it is not is somewhere
      // to live, and the answer is not to fell another twenty planks for a
      // second bed the moment a room exists. The bed already exists. Somebody
      // picks it up and carries it next door.
      //
      // **The bed is never off the map.** It stands in the hall for the whole
      // walk and moves the instant the carrier arrives, rather than being
      // removed on uproot and rebuilt on delivery. That is a lie about the
      // furniture and a deliberate one: a bed held in a settler's arms is a bed
      // that vanishes for good the moment the job is cancelled — a raid, a
      // collapse, a path that stopped existing — and a colony that loses a bunk
      // every time somebody is interrupted mid-errand is worse off than one
      // whose wardrobe teleports the last two cells.
      const bed = findBuilding(world, job.buildingId);
      if (!bed || !bed.built || bed.kind !== 'bed') return cancelJob(world, job.id);
      // Re-checked on arrival like every other job that walks somewhere: between
      // the order and the walk the room may have been given a bed by somebody
      // else, or walled in, or stopped being a room at all.
      if (!bedlessTarget(world, job.tx, job.ty)) return cancelJob(world, job.id);
      // Not out from under a sleeper. They would wake up on the floor of a room
      // they have never been in.
      if (world.pawns.some((q) => q.activity === 'sleeping' && Math.floor(q.x) === bed.x && Math.floor(q.y) === bed.y)) {
        return cancelJob(world, job.id);
      }

      if (job.stage === 'goto') {
        const r = walkTo(world, pawn, bed.x, bed.y, false);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r !== 'arrived') return;
        pawn.activity = 'working';
        pawn.animPhase += 0.35;
        // Half what taking it apart would cost. Lifting a bunk off the floor is
        // not deconstruction, and charging the full work would make moving it
        // dearer than the planks it saves.
        job.progress += workRate(pawn, 'construction') * 1.8;
        if (job.progress >= defOf('bed').work * 0.5) job.stage = 'carry';
        return;
      }

      const r = walkTo(world, pawn, job.tx, job.ty, true);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      const owner = bed.ownerId;
      removeBuilding(world, bed);
      const moved = addBuilding(world, 'bed', job.tx, job.ty, true);
      // The claim travels with the bunk. `tickQuarters` would hand the room out
      // again within the half-second anyway, but not to the same settler
      // necessarily, and somebody who has just carried their own bed across the
      // yard should not find a neighbour asleep in it.
      if (moved && owner !== undefined) moved.ownerId = owner;
      return finishJob(world, pawn, job);
    }

    case 'feedPrisoner': {
      const prisoner = findPawn(world, job.targetPawnId ?? null);
      if (!prisoner || prisoner.dead || prisoner.faction !== 'prisoner') {
        return cancelJob(world, job.id);
      }
      if (prisoner.needs.food >= 0.95) return cancelJob(world, job.id);
      if (job.stage === 'goto') {
        const food = findItem(world, job.itemId);
        if (!food) return cancelJob(world, job.id);
        const r = walkTo(world, pawn, food.x, food.y, true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pickUp(world, pawn, food, 1);
          job.stage = 'carry';
        }
        return;
      }
      if (job.stage === 'carry') {
        const r = walkTo(world, pawn, Math.round(prisoner.x), Math.round(prisoner.y), true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') job.stage = 'work';
        return;
      }
      pawn.activity = 'working';
      job.progress += 1;
      if (job.progress >= 40) {
        const food = findItem(world, pawn.carryingItemId);
        if (!food) return cancelJob(world, job.id);
        prisoner.needs.food = Math.min(1, prisoner.needs.food + (FOOD_VALUE[food.kind] ?? 0.25));
        food.amount -= 1;
        pawn.carryingItemId = null;
        if (food.amount <= 0) removeItem(world, food);
        else {
          food.carriedBy = null;
          food.reservedBy = null;
          food.x = Math.round(pawn.x);
          food.y = Math.round(pawn.y);
        }
        msg(world, `${pawn.name} took a meal to ${prisoner.name}.`, 'info');
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'recruit': {
      const prisoner = findPawn(world, job.targetPawnId ?? null);
      if (!prisoner || prisoner.dead || prisoner.faction !== 'prisoner') {
        return cancelJob(world, job.id);
      }
      // Nobody argues with an unconscious man, and nobody argues with one who is
      // about to pass out from hunger either.
      if (prisoner.downed || (prisoner.resistance ?? 0) <= 0) return cancelJob(world, job.id);
      // Somebody else got to them first while this warden was walking over.
      if (world.tick < (prisoner.talkCooldown ?? 0)) return cancelJob(world, job.id);
      if (job.stage === 'goto') {
        const r = walkTo(world, pawn, Math.round(prisoner.x), Math.round(prisoner.y), true);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') job.stage = 'work';
        return;
      }
      pawn.activity = 'working';
      pawn.facing = Math.atan2(prisoner.y - pawn.y, prisoner.x - pawn.x);
      // This used to borrow `medicine`, because talking was not a skill the game
      // had. It is now: the same one that gets a good price on the road is the
      // one that gets a prisoner talking, and it is levelled by both.
      job.progress += workRate(pawn, 'social');
      if (job.progress >= TALK_WORK) {
        persuade(world, pawn, prisoner);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'firefight': {
      const fire = world.fires.find((f) => f.x === job.tx && f.y === job.ty);
      if (!fire) return finishJob(world, pawn, job);
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.animPhase += 0.5;
      fire.size -= 0.035;
      if (fire.size <= 0) {
        world.fires = world.fires.filter((f) => f !== fire);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'scout': {
      const site = siteAt(world, job.tx, job.ty);
      if (!site || site.found) return finishJob(world, pawn, job);
      // Turn back the moment the horizon changes. The gate in `scoutingAllowed`
      // only covers the decision to set out; a raid that lands while a settler
      // is twenty cells out has to send them home, or the colony fights it one
      // defender short and the scout fights it alone.
      if (world.storyteller.raidActive || hostiles(world).length > 0) {
        return cancelJob(world, job.id);
      }
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      pawn.activity = 'working';
      pawn.facing = Math.atan2(job.ty - pawn.y, job.tx - pawn.x) || pawn.facing;
      pawn.animPhase += 0.25;
      job.progress++;
      if (job.progress >= surveyTicks(world)) {
        resolveSite(world, pawn, site);
        return finishJob(world, pawn, job);
      }
      return;
    }

    case 'caravan': {
      const dest = settlementById(world, job.settlementId ?? 0);
      if (!dest) return cancelJob(world, job.id);
      // Same turn-back rule as scouting, and for a stronger reason: a settler who
      // walks off the edge of the map during a raid does not come back for days.
      if (world.storyteller.raidActive || hostiles(world).length > 0) {
        msg(world, `${pawn.name} drops the pack — the road can wait.`, 'bad');
        return cancelJob(world, job.id);
      }
      // Possessed halfway to the edge. Lifting this body off the map would take
      // the camera with it, so the trip is off — the player is standing in them
      // and has plainly decided to do something else.
      if (pawn.playerControlled) {
        msg(world, `${pawn.name} sets the pack down.`, 'info');
        return cancelJob(world, job.id);
      }
      pawn.activity = 'walking';
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r !== 'arrived') return;
      // The edge. `departCaravan` takes the goods and lifts them off the map;
      // it refuses if the colony has spent the pack while they walked, and then
      // this is just a long walk to nowhere and back.
      const give = { kind: job.resource ?? 'wood', amount: job.amount ?? 0 };
      // Closed out first, while they are still a settler on a map. Once
      // `departCaravan` has taken them off it, nothing in the tick may reach
      // them again — including the job table.
      finishJob(world, pawn, job);
      departCaravan(world, pawn, dest, give);
      return;
    }

    case 'campaign': {
      // Everything that calls a march off before it starts goes through
      // `abandonMuster`, which puts back whoever already reached the treeline —
      // so these three branches cancel the *muster*, not just this settler's
      // walk. One settler dropping out of a war party is the party.
      if (world.storyteller.raidActive || hostiles(world).length > 0) {
        return abandonMuster(world, 'The war party turns back — there are raiders in the yard.');
      }
      if (pawn.playerControlled) {
        return abandonMuster(world, `${pawn.name} breaks off, and the march is off with them.`);
      }
      pawn.activity = 'walking';
      const r = walkTo(world, pawn, job.tx, job.ty, false);
      if (r === 'blocked') {
        return abandonMuster(world, `${pawn.name} cannot get out of the valley. The march is off.`);
      }
      if (r !== 'arrived') return;
      // Closed out while they are still a settler on a map: once `joinWarParty`
      // has lifted them off it, nothing in the tick may reach them again.
      finishJob(world, pawn, job);
      joinWarParty(world, pawn);
      return;
    }

    case 'moveTo': {
      // Exact, and for the same reason `flee` is: "go and stand there" is a
      // command about a cell, and stopping one step short of the cell the player
      // pointed at is how a move order reads as ignored. `orderJob` has already
      // moved the target to the nearest cell somebody can actually stand on, so
      // this cannot ask for the impossible.
      pawn.activity = 'walking';
      const r = walkTo(world, pawn, job.tx, job.ty, true);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r === 'arrived') return finishJob(world, pawn, job);
      return;
    }

    case 'flee': {
      // Out of it. `FIRE_CLEAR` rather than `FIRE_TOUCH`, so they do not stop
      // one step off the burning cell and stand there while it spreads onto
      // them again.
      if (!fireAt(world, pawn.x, pawn.y, FIRE_CLEAR)) return finishJob(world, pawn, job);
      // The bolt-hole caught while they were running to it. Drop the job and let
      // the safety pass pick somewhere else on the next tick. Alight, not merely
      // close to something alight: when a settler is ringed by fire the safety
      // pass deliberately settles for a cell inside the clear margin, and
      // cancelling that on arrival would send them back to the flames.
      if (fireAt(world, job.tx, job.ty)) return cancelJob(world, job.id);
      pawn.activity = 'walking';
      // Exact. Every other job in the game walks *next to* its target, because
      // every other target is a thing you reach — a tree, a bed, a stack. Safe
      // ground is a thing you stand on, and "adjacent to safe" is the burning
      // cell they are already on: `walkTo` reported arrival without a step, the
      // job closed, the safety pass re-opened it next tick, and a settler stood
      // in a fire for twenty seconds logging "is caught in the fire" twenty
      // times a second while their health went down.
      const r = walkTo(world, pawn, job.tx, job.ty, true);
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r === 'arrived') return finishJob(world, pawn, job);
      return;
    }

    case 'rescue': {
      const patient = findPawn(world, job.targetPawnId ?? null);
      if (!patient || patient.dead) return cancelJob(world, job.id);
      // Called off before they were picked up: they got back on their feet, or
      // somebody else reached them first. Once shouldered the trip is finished
      // regardless — putting a body down halfway is worse than either.
      if (
        pawn.carryingPawnId !== patient.id &&
        (!patient.downed || !fireAt(world, patient.x, patient.y))
      ) {
        return cancelJob(world, job.id);
      }

      if (job.stage === 'goto') {
        // Alongside, not on top of — the difference from the warden's capture,
        // which walks right onto its captive. The patient is standing in a fire
        // by definition, and a rescuer who steps into it is a rescuer the safety
        // pass pulls straight back out again, dropping this job as they go. They
        // reach in from the next cell instead.
        const r = walkTo(world, pawn, Math.round(patient.x), Math.round(patient.y), false);
        if (r === 'blocked') return cancelJob(world, job.id);
        if (r === 'arrived') {
          pawn.carryingPawnId = patient.id;
          job.stage = 'carry';
        }
        return;
      }

      // The fire followed them. Pick a new corner to run for rather than
      // carrying somebody into it.
      if (fireAt(world, job.tx, job.ty, FIRE_CLEAR)) {
        const spot = nearestSafeCell(world, pawn.x, pawn.y);
        if (!spot) return cancelJob(world, job.id);
        job.tx = spot.x;
        job.ty = spot.y;
        pawn.path = null;
      }
      const r = walkTo(world, pawn, job.tx, job.ty, true);
      // Shouldered: the body's position is written from the carrier, so there is
      // one thing moving rather than two walking through each other. Written
      // after the step rather than before it — the warden's capture does it the
      // other way round and the captive trails a fifth of a cell behind all the
      // way to the bunk, which is exactly the kind of thing you only see once
      // you are standing next to it in first person.
      patient.x = pawn.x;
      patient.y = pawn.y;
      patient.facing = pawn.facing;
      patient.path = null;
      if (r === 'blocked') return cancelJob(world, job.id);
      if (r === 'arrived') {
        pawn.carryingPawnId = null;
        msg(world, `${pawn.name} pulls ${patient.name} clear of the fire.`, 'good');
        return finishJob(world, pawn, job);
      }
      return;
    }
  }
}

/** Rest recovery for a settler asleep on the bare ground (no bed available). */
/**
 * A settler who has downed tools, for the ticks they are not eating or sleeping.
 *
 * They walk. Not far and not anywhere in particular — the point is that the
 * player can *see* which settler stopped, from the isometric view, without
 * opening a panel, because a broken settler standing perfectly still among four
 * working ones is invisible.
 */
export function tickMoraleBreak(world: World, pawn: Pawn, rng: Rng): void {
  pawn.activity = 'breaking';
  if (pawn.path) {
    if (followPath(world, pawn, WALK_SPEED * 0.6)) pawn.path = null;
    return;
  }
  // Only re-roll now and then, or they judder on the spot re-pathing every tick.
  if ((world.tick + pawn.id) % 40 !== 0) return;
  const px = Math.round(pawn.x);
  const py = Math.round(pawn.y);
  const tx = px + rng.int(11) - 5;
  const ty = py + rng.int(11) - 5;
  if (!isWalkable(world, tx, ty)) return;
  pawn.path = findPath(world, px, py, tx, ty, { goals: new Set([packCell(world, tx, ty)]) });
}

/**
 * A settler asleep with no job: not tucked into a bunk, just stopped.
 *
 * Both callers reach this with `pawn.jobId === null`, which is the whole reason
 * it exists — a settler in a bed is in a `sleep` *job*, and that job ticks their
 * rest and decides when they get up. This is the other case: `tryNeedJob` sets
 * `activity = 'sleeping'` where they stand when they are past `rest < 0.12` and
 * there is no free bed, because walking on is how a settler dies of tiredness.
 *
 * It used to hand a sleeper lying on a bed cell back to "the sleep job", which
 * there is none of at this call site. A settler who dropped on a bunk somebody
 * else was already in therefore had their rest ticked by nothing at all: it never
 * moved, so the `0.9` wake never came, and `tick.ts` sends a sleeping settler
 * straight here and `continue`s, so the need pass never looked at them either.
 * Asleep, at zero food, on a bed, until the run ended. On harsh/424242 that was
 * 126.7 h for one settler and the whole of the grid's on-their-feet starvation
 * column — a colony with a full pantry and a settler quietly starving in it.
 *
 * The stomach clause is the one the `sleep` job already has, and it is here for
 * the same reason: sleeping through starvation is not a decision a settler would
 * make. `rest > 0.5` keeps it from yo-yoing somebody straight back off their feet
 * — they get up hungry once they have enough in them to walk to the pantry.
 */
export function tickGroundSleep(world: World, pawn: Pawn, rng: Rng): void {
  pawn.needs.rest = Math.min(1, pawn.needs.rest + REST_GAIN_GROUND);

  // Sleeping on a floor is a bad night. Sleeping in the open is the colony
  // failing to house somebody, and it is priced in health rather than mood: the
  // weather roll in `tickComfort` only bites once a settler is properly chilled,
  // which a summer night in the yard never is, so a colony with no beds could
  // put people outside all season for a mood point a night. Eight hours lying
  // still in the weather is not that, and the fix is a roof, which is exactly
  // what the Steward's `quarters` ambition builds.
  const exposed = !indoors(world, Math.round(pawn.x), Math.round(pawn.y));
  if (exposed) maybeExposureFlu(world, pawn, rng);

  if (pawn.needs.rest > 0.9 || (pawn.needs.food < 0.12 && pawn.needs.rest > 0.5)) {
    pawn.activity = 'idle';
    // Charged on waking rather than per tick on the floor, so it is one night
    // rough rather than a mood that sinks the longer they manage to sleep.
    nudgeMood(pawn, exposed ? MOOD_SLEPT_OUTSIDE : MOOD_SLEPT_ROUGH);
  }
}
