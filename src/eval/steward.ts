/**
 * The Steward — a colony manager that plays itself.
 *
 * It issues only orders a human has in the manager view: designations,
 * blueprints, work priorities, drafting and move orders. It never writes pawn
 * state and never conjures resources, so a colony the Steward keeps alive is a
 * colony a player could have kept alive. That is what makes it usable as the
 * balance instrument behind `npm run eval` — if the Steward starves, the
 * economy is broken, not the player.
 *
 * Every decision is derived from the world, so calling it twice in a row is
 * harmless and it needs no memory of its own.
 */

import { CABIN, GARDEN } from '../sim/worldgen';
import { canSow, canTill, growingCells } from '../sim/farming';
import { buildingAt, dist, isWalkable } from '../sim/grid';
import { missingResource } from '../sim/jobs';
import { PEN_CELLS_PER_HEAD, livestock, penCapacity, penCells } from '../sim/livestock';
import { isPet } from '../sim/pets';
import { DRAW, conducts, isProducer, isSource, powerNetworks } from '../sim/power';
import {
  canPlace,
  designate,
  markHuntPawn,
  markTamePawn,
  paintGrowingZone,
  paintPenZone,
  setDrafted,
  setPriority,
  orderMove,
} from '../sim/orders';
import { planBlueprint } from '../sim/stranded';
import { available, setProject } from '../sim/research';
import { ANIMALS } from '../sim/wildlife';
import type { ResearchId } from '../sim/research';
import { acceptOffer, currentTrader, tradeState } from '../sim/trade';
import { addCellToZone, addZone, countResource, hostiles, livingColonists, zoneAt } from '../sim/world';
import { HUNGRY } from '../sim/needs';
import type { AnimalKind, Cell, Pawn, World, Zone } from '../sim/types';
import { DESIG_HARVEST, DESIG_NONE, DESIG_TILL, terrainAt, unpackX, unpackY } from '../sim/types';

/** Ticks between decisions. Fast enough to react to a raid, cheap enough to ignore. */
export const STEWARD_INTERVAL = 20;

/** Below this much wood or steel in store, mark more of it for harvest. */
const WOOD_FLOOR = 80;
const STEEL_FLOOR = 70;
/** How many cells the Steward is willing to have outstanding at once. */
const MAX_OUTSTANDING = 8;
/** Only harvest what is close to home; a long walk is a colonist not working. */
const HARVEST_RADIUS = 22;
/**
 * Cultivated cells per settler. Six cells on a three-day cycle at four raw food a
 * cell is about twice one settler's appetite — the slack is what survives a fire,
 * a raid across the plot, or a week where the cook is busy being shot at.
 */
const PLOT_CELLS_PER_COLONIST = 6;
/** Ceiling, so a big colony does not turn the whole yard into farmland. */
const MAX_PLOT_CELLS = 48;
/** How far from the original plot the Steward will expand. */
const PLOT_MAX_RADIUS = 5;

const HOME_X = Math.round((CABIN.x0 + CABIN.x1) / 2);
const HOME_Y = Math.round((CABIN.y0 + CABIN.y1) / 2);

export function stewardTick(world: World, tick: number): void {
  if (world.gameOver) return;
  if (tick % STEWARD_INTERVAL !== 0) return;

  const colonists = livingColonists(world);
  if (colonists.length === 0) return;

  if (liveThreats(world).length > 0) {
    answerThreats(world, colonists);
    recallWorkers(world);
    // Nothing below matters mid-fight: the drafted settlers ignore work orders
    // and queueing chores only sends the unarmed ones into the open.
    return;
  }
  standDown(world, colonists);

  assignWork(world, colonists);
  keepTheGardenGrowing(world, colonists.length);
  breakGroundInThePlot(world);
  keepAHerd(world, colonists);
  keepMaterialsComing(world);
  keepEveryoneABed(world, colonists.length);
  keepASickbay(world, colonists.length);
  keepABunkForCaptives(world, colonists.length);
  keepTheCabinWarm(world);
  keepAWorkbench(world);
  keepThePowerOn(world);
  buildDefences(world);
  keepAColdStore(world);
  keepResearchGoing(world, colonists);
  dealWithCaravans(world, colonists.length);
}

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

/**
 * What the Steward will not sell down past. A trade that leaves the colony
 * unable to build the next turret is a worse deal than no deal, whatever the
 * rate — the caravan is a way to spend a surplus, never a way to raise cash.
 */
const TRADE_KEEP: Record<string, number> = {
  steel: 220,
  wood: 160,
  rawfood: 140,
  meal: 24,
  medicine: 18,
};

/**
 * And what it counts as short. Above these it has enough and a swap would just
 * be churn; below, it is genuinely worth paying a bad rate for.
 */
const TRADE_WANT: Record<string, number> = {
  steel: 200,
  wood: 180,
  rawfood: 150,
  meal: 30,
  medicine: 30,
};

/** Buy a settler only once the colony can clearly feed one. */
const HIRE_FOOD_FLOOR = 120;

/**
 * Take the deals a careful player would take.
 *
 * The rule is one line: sell only out of a genuine surplus, buy only what the
 * colony is actually short of. That is deliberately conservative — the point of
 * putting this in the balance instrument is to find out whether trade *helps* a
 * colony that is already doing well, not to let the Steward gamble its way out
 * of trouble on rates that are stacked against it.
 */
function dealWithCaravans(world: World, colonists: number): void {
  if (!currentTrader(world)) return;
  for (const offer of [...tradeState(world).offers]) {
    if (offer.taken) continue;
    const stock = countResource(world, offer.give.kind);
    if (stock - offer.give.amount < (TRADE_KEEP[offer.give.kind] ?? 0)) continue;

    if ('hire' in offer.take) {
      // Another mouth is only an asset if there is something in the pantry for
      // it. Bought late, a hand is three days of mining; bought hungry, it is a
      // death and a mood hit for everyone who watched.
      if (colonists >= 6) continue;
      if (countResource(world, 'rawfood') + countResource(world, 'meal') * 2 < HIRE_FOOD_FLOOR) continue;
      acceptOffer(world, offer.id);
      continue;
    }

    if (countResource(world, offer.take.kind) >= (TRADE_WANT[offer.take.kind] ?? 0)) continue;
    acceptOffer(world, offer.id);
  }
}

// ---------------------------------------------------------------------------
// Threat response
// ---------------------------------------------------------------------------

/**
 * Draft everyone who can still hold a weapon and pull them to the cabin door.
 * Fighting from inside the walls means raiders have to come through one gap
 * instead of shooting three scattered haulers in the open — the same thing a
 * player does the first time they lose someone to a field ambush.
 */
function answerThreats(world: World, colonists: Pawn[]): void {
  const line = firingLine(world);
  let slot = 0;
  for (const p of colonists) {
    if (p.downed) continue;
    if (p.weapon === 'none') continue;
    // Nobody holds a line on an empty stomach. A drafted settler takes no jobs,
    // so keeping a hungry one on the wall trades a raider for a settler.
    if (p.needs.food < HUNGRY) {
      if (p.drafted) setDrafted(world, p.id, false);
      continue;
    }
    if (!p.drafted) setDrafted(world, p.id, true);
    // One post each. Everybody used to get the same cell, and pawns do not
    // collide with each other, so the whole colony fought the raid standing on a
    // single tile: raiders three cells away shot the pile down one settler at a
    // time, and the eval runs read "all five down" for every raid after day 11.
    const post = line[slot % line.length]!;
    slot++;
    // Re-issue the post only when they have drifted off it, so the order does
    // not cancel the shot they are lining up every single decision tick.
    if (dist(p.x, p.y, post.x, post.y) > 1.4 && p.orderX === null) {
      orderMove(world, p.id, post.x, post.y);
    }
  }
}

/**
 * Only hostiles that are actually coming for the colony count. A lone raider
 * loitering in the far corner, or one that broke off and is walking to the map
 * edge, must not hold the whole colony at arms for the rest of the week — that
 * is how a won fight turns into a colony that starved standing up.
 */
const THREAT_RADIUS = 26;

function liveThreats(world: World): Pawn[] {
  return hostiles(world).filter((h) => dist(h.x, h.y, HOME_X, HOME_Y) < THREAT_RADIUS);
}

/** The field is clear — put everyone back to work. */
function standDown(world: World, colonists: Pawn[]): void {
  for (const p of colonists) if (p.drafted) setDrafted(world, p.id, false);
}

/**
 * Wipe outstanding harvest orders the moment a fight starts. An unarmed settler
 * walking out to a marked tree during a raid is a corpse, and a player watching
 * that happen would cancel the order — so the Steward does. Peacetime re-marks
 * them a few seconds later, which costs nothing.
 */
function recallWorkers(world: World): void {
  for (let i = 0; i < world.cellDesig.length; i++) {
    if (world.cellDesig[i] !== DESIG_HARVEST) continue;
    const x = i % world.width;
    const y = Math.floor(i / world.width);
    if (dist(x, y, HOME_X, HOME_Y) < 6) continue;
    designate(world, x, y, DESIG_NONE);
  }
}

/**
 * One firing post per settler, each behind its own piece of hard cover.
 *
 * Posts sit one cell inward of the sandbag line, so a sandbag stands between the
 * settler and the lane the raiders walk up — cover is directional, so which side
 * of the settler it is on decides whether it stops anything — and the turrets two
 * cells further in shoot over their heads. Posts whose sandbag is not built yet
 * are still handed out: standing spread along the line beats standing in a heap
 * even with nothing to hide behind.
 */
function firingLine(world: World): Cell[] {
  const y = CABIN.doorY + OUTWARD * 3;
  const covered: Cell[] = [];
  const bare: Cell[] = [];
  for (const bag of sandbagSpots()) {
    if (!isWalkable(world, bag.x, y)) continue;
    const b = buildingAt(world, bag.x, bag.y);
    if (b && b.kind === 'sandbag' && b.built) covered.push({ x: bag.x, y });
    else bare.push({ x: bag.x, y });
  }
  const line = [...covered, ...bare];
  return line.length > 0 ? line : [rallyPoint(world)];
}

/** Just inside the cabin door: cover at your back, one line of fire out. */
function rallyPoint(world: World): { x: number; y: number } {
  const inward = CABIN.doorY === CABIN.y1 ? -2 : 2;
  const y = CABIN.doorY + inward;
  if (isWalkable(world, CABIN.doorX, y)) return { x: CABIN.doorX, y };
  return { x: HOME_X, y: HOME_Y };
}

// ---------------------------------------------------------------------------
// Peacetime
// ---------------------------------------------------------------------------

/**
 * Put each settler on the work they are best at. Work priorities are the one
 * manager control that pays off compoundingly, so the Steward uses them the way
 * the tooltip tells a player to: the best miner mines, the best cook cooks.
 */
function assignWork(world: World, colonists: Pawn[]): void {
  const bestAt = (skill: 'mining' | 'cooking' | 'construction' | 'plants'): number => {
    let best = colonists[0]!;
    for (const p of colonists) if (p.skills[skill] > best.skills[skill]) best = p;
    return best.id;
  };
  const miner = bestAt('mining');
  const cook = bestAt('cooking');
  const builder = bestAt('construction');
  const grower = bestAt('plants');
  for (const p of colonists) {
    setPriority(world, p.id, 'mine', p.id === miner ? 2 : 3);
    setPriority(world, p.id, 'cook', p.id === cook ? 2 : 3);
    setPriority(world, p.id, 'construct', p.id === builder ? 2 : 3);
    // Everyone farms. The plot is the difference between a colony that eats in
    // week three and one that does not, and a ripe cell nobody picks rots into
    // the same starvation the eval runs kept measuring.
    setPriority(world, p.id, 'farm', p.id === grower ? 2 : 3);
  }
}

/**
 * Keep enough soil under cultivation to outrun the colony's appetite.
 *
 * Worldgen ships a twelve-cell plot, which feeds three. Every extra mouth needs
 * more, and a plot trampled by a raid or paved over by a wall has to be replaced,
 * so the Steward tops the acreage up rather than assuming day-one geometry holds.
 */
function keepTheGardenGrowing(world: World, colonists: number): void {
  const target = Math.min(MAX_PLOT_CELLS, colonists * PLOT_CELLS_PER_COLONIST);
  const have = growingCells(world).length;
  if (have >= target) return;

  let budget = target - have;
  // Grow outward from the existing plot in rings, so the walk from the cabin
  // stays short and the new soil stays inside the defended yard.
  const cx = Math.round((GARDEN.x0 + GARDEN.x1) / 2);
  const cy = Math.round((GARDEN.y0 + GARDEN.y1) / 2);
  for (let r = 0; r <= PLOT_MAX_RADIUS && budget > 0; r++) {
    for (let y = cy - r; y <= cy + r && budget > 0; y++) {
      for (let x = cx - r; x <= cx + r && budget > 0; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        if (!canSow(world, x, y)) continue;
        // Skip any cell that already belongs to a zone: growing ones are already
        // counted, and stealing a stockpile cell would pave the pantry.
        if (zoneAt(world, x, y)) continue;
        if (paintGrowingZone(world, x, y)) budget--;
      }
    }
  }
}

/**
 * Break the ground under the plot, a few cells at a time.
 *
 * Tilling is the farm's idle work, so this can safely mark the whole plot without
 * ever delaying a harvest — but a settler who finishes one till job and finds the
 * next one three cells away walks less than one who is sent across the yard, so
 * the marks go on in a small batch that trails the plot rather than all at once.
 * Cells with a crop already on them count: a farmhand works the beds around the
 * rows, and refusing them would deadlock — a bare cell is always sown first, so
 * "only till bare soil" would mean never tilling anything.
 */
export const TILL_BATCH = 6;

export function breakGroundInThePlot(world: World): void {
  let outstanding = 0;
  for (const d of world.cellDesig) if (d === DESIG_TILL) outstanding++;
  let budget = TILL_BATCH - outstanding;
  if (budget <= 0) return;
  for (const c of growingCells(world)) {
    if (budget <= 0) return;
    const x = unpackX(world, c);
    const y = unpackY(world, c);
    if (!canTill(world, x, y)) continue;
    if (designate(world, x, y, DESIG_TILL)) budget--;
  }
}

/** Mark trees and rock for harvest whenever the stores run thin. */
function keepMaterialsComing(world: World): void {
  const outstanding = countDesignated(world);
  if (outstanding >= MAX_OUTSTANDING) return;
  let budget = MAX_OUTSTANDING - outstanding;

  if (countResource(world, 'wood') < WOOD_FLOOR) {
    budget -= markTrees(world, budget);
  }
  if (budget > 0 && countResource(world, 'steel') < STEEL_FLOOR) {
    markRock(world, budget);
  }
}

function countDesignated(world: World): number {
  let n = 0;
  for (const d of world.cellDesig) if (d === DESIG_HARVEST) n++;
  return n;
}

function markTrees(world: World, budget: number): number {
  const trees = world.buildings
    .filter((b) => b.kind === 'tree' && b.built && dist(b.x, b.y, HOME_X, HOME_Y) < HARVEST_RADIUS)
    .sort((a, b) => dist(a.x, a.y, HOME_X, HOME_Y) - dist(b.x, b.y, HOME_X, HOME_Y));
  let done = 0;
  for (const t of trees) {
    if (done >= budget) break;
    if (designate(world, t.x, t.y, DESIG_HARVEST)) done++;
  }
  return done;
}

/**
 * Rock only counts if a settler can stand next to it — the middle of a boulder
 * field is a job nobody can start, and a designation nobody can start is a
 * player wondering why mining is broken.
 */
function markRock(world: World, budget: number): number {
  const cells: Array<{ x: number; y: number; d: number }> = [];
  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      if (terrainAt(world, x, y) !== 'rock') continue;
      const d = dist(x, y, HOME_X, HOME_Y);
      if (d > HARVEST_RADIUS) continue;
      if (!hasWalkableNeighbour(world, x, y)) continue;
      cells.push({ x, y, d });
    }
  }
  cells.sort((a, b) => a.d - b.d);
  let done = 0;
  for (const c of cells) {
    if (done >= budget) break;
    if (designate(world, c.x, c.y, DESIG_HARVEST)) done++;
  }
  return done;
}

// ---------------------------------------------------------------------------
// Livestock
// ---------------------------------------------------------------------------

/** Three head at six cells each — a breeding pair and one to eat. */
const PEN_TARGET_CELLS = PEN_CELLS_PER_HEAD * 3;
/** How far from the pen's corner the Steward will look for room. */
const PEN_MAX_RADIUS = 6;
/** A herd is a good-times investment: taming is a day of a farmhand's life. */
const HERD_FOOD_FLOOR = 150;
/** Below this the breeding pair itself goes on the table — a famine has no next month. */
const HERD_SLAUGHTER_FLOOR = 60;
/** Otherwise never eaten past this many of a kind. Two is what refills the pen. */
const BREEDING_STOCK = 2;
/** Nobody keeps animals with three pairs of hands and a wall half-built. */
const HERD_MIN_COLONISTS = 4;

/**
 * Keep a herd — the one food store that grows while nobody is watching it.
 *
 * The plot feeds the colony on a three-day clock and stops the moment the grower
 * is shot at or the ground freezes; a pen keeps producing through both. So the
 * Steward stocks it in the good weeks and eats into it in the bad ones, which is
 * the trade the feature exists to offer: painting more pen buys a bigger larder,
 * at the price of the handler time it takes to fill.
 *
 * It culls the surplus above a breeding pair as a matter of course, because a pen
 * at capacity has stopped breeding — the extra head is meat standing there
 * refusing to become more meat. Only an actual famine gets the pair itself.
 */
function keepAHerd(world: World, colonists: Pawn[]): void {
  const food = countResource(world, 'rawfood') + countResource(world, 'meal') * 2;
  cullSurplus(world, food);
  if (colonists.length < HERD_MIN_COLONISTS) return;
  if (food < HERD_FOOD_FLOOR) return;
  if (penCells(world).length < PEN_TARGET_CELLS) paintAPen(world);
  markStockForTaming(world);
}

/**
 * A pen beside the cabin, on the far side from the gate.
 *
 * The defences all face the door, so the yard behind the cabin is the one patch
 * of ground a raid does not walk over, and an animal that strays off its zone
 * walks back through cover rather than across the firing lane.
 */
function paintAPen(world: World): void {
  let budget = PEN_TARGET_CELLS - penCells(world).length;
  const cx = CABIN.x0 - 4;
  const cy = HOME_Y;
  for (let r = 0; r <= PEN_MAX_RADIUS && budget > 0; r++) {
    for (let y = cy - r; y <= cy + r && budget > 0; y++) {
      for (let x = cx - r; x <= cx + r && budget > 0; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        if (!isWalkable(world, x, y)) continue;
        if (buildingAt(world, x, y)) continue;
        // Zoned ground is spoken for, and the doorstep has to stay clear — a pen
        // across the threshold is livestock standing in the only way out.
        if (zoneAt(world, x, y)) continue;
        if (onTheDoorstep(x, y)) continue;
        if (paintPenZone(world, x, y)) budget--;
      }
    }
  }
}

function onTheDoorstep(x: number, y: number): boolean {
  return x >= CABIN.x0 - 1 && x <= CABIN.x1 + 1 && y >= CABIN.y0 - 1 && y <= CABIN.y1 + 1;
}

/**
 * Mark one more animal to bring in, if the pen has room left in it.
 *
 * One at a time: every mark is a farmhand walking out of the plot, and a Steward
 * that marked the whole meadow at once would empty the fields to fill the pen.
 */
function markStockForTaming(world: World): void {
  const herd = livestock(world);
  let spoken = herd.length;
  for (const p of world.pawns) {
    if (p.faction !== 'fauna' || p.dead || p.tame === true || p.tameTarget !== true) continue;
    // An animal a handler could find no way to is not livestock — it is a slot in
    // the pen being held open for nothing. Call the order off and use the slot.
    if (p.unreachable !== undefined) {
      markTamePawn(world, p.id, false);
      continue;
    }
    spoken++;
  }
  if (spoken >= penCapacity(world)) return;

  // Stick to one species while the herd is small. Animals only breed with their
  // own kind, so a pen holding one of each is a pen that never fills itself — and
  // the orders already out count towards that, or the first three marks would all
  // be placed before a single animal had walked in and the pen would fill with
  // whatever happened to be nearest.
  const want = commonestKind([...herd, ...world.pawns.filter((p) => p.tameTarget === true && !p.dead)]);
  let best: Pawn | null = null;
  let bestScore = -Infinity;
  for (const p of world.pawns) {
    if (p.faction !== 'fauna' || p.dead) continue;
    if (p.tame === true || p.tameTarget === true || p.hunted === true) continue;
    // Once anyone has failed to reach it, the Steward is done with it: the ground
    // between here and there does not usually change, and re-marking it would
    // spend the same fruitless search again every minute.
    if (p.unreachable !== undefined) continue;
    if (want && p.animal !== want) continue;
    const d = dist(p.x, p.y, HOME_X, HOME_Y);
    if (d > HARVEST_RADIUS) continue;
    // Coaxing in a mossback costs exactly what coaxing in a dunhare costs and
    // returns nearly four times the meat, so the walk is worth taking for the
    // bigger animal — but not right across the map for it.
    const score = ANIMALS[p.animal ?? 'dunhare'].meat - d * 2;
    if (score <= bestScore) continue;
    best = p;
    bestScore = score;
  }
  if (best) markTamePawn(world, best.id, true);
}

function commonestKind(herd: Pawn[]): AnimalKind | null {
  const count = new Map<AnimalKind, number>();
  for (const a of herd) {
    if (!a.animal) continue;
    count.set(a.animal, (count.get(a.animal) ?? 0) + 1);
  }
  let best: AnimalKind | null = null;
  let bestN = 0;
  for (const [kind, n] of count) {
    if (n > bestN) {
      best = kind;
      bestN = n;
    }
  }
  return best;
}

/**
 * Send a butcher out for the head the pen can spare.
 *
 * One at a time, because two orders on the same day is the whole herd gone on a
 * bad one — and never past a breeding pair of a species unless the pantry is
 * genuinely empty, in which case next month's herd is not the problem.
 */
function cullSurplus(world: World, food: number): void {
  const herd = livestock(world);
  if (herd.some((a) => a.hunted === true)) return;
  const count = new Map<AnimalKind, number>();
  for (const a of herd) {
    if (!a.animal) continue;
    count.set(a.animal, (count.get(a.animal) ?? 0) + 1);
  }
  const full = herd.length >= penCapacity(world);
  const spare = (a: Pawn): boolean => {
    // A famine has no next month: at that point every head is dinner.
    if (food < HERD_SLAUGHTER_FLOOR) return true;
    const n = count.get(a.animal!) ?? 0;
    if (n > BREEDING_STOCK) return true;
    // And the odd one out. A lone animal cannot breed with anything, so in a full
    // pen it is not breeding stock — it is the reason the pair that could breed
    // has nowhere to put a calf.
    return full && n < BREEDING_STOCK;
  };

  let pick: Pawn | null = null;
  let pickD = Infinity;
  for (const a of herd) {
    if (!a.animal || !spare(a)) continue;
    // Somebody's animal is not surplus, whatever the arithmetic says. `orders.ts`
    // refuses the mark anyway, so leaving this out did not butcher anyone's dog —
    // it did something quieter and worse: the nearest spare head was a pet, so
    // every pass picked it, was refused, and printed the refusal, and the pen
    // never got culled again while that animal lived. A picker that can choose
    // what it is not allowed to have does not fail, it stalls.
    if (isPet(a)) continue;
    const d = dist(a.x, a.y, HOME_X, HOME_Y);
    if (d >= pickD) continue;
    pick = a;
    pickD = d;
  }
  if (pick) markHuntPawn(world, pick.id, true);
}

function hasWalkableNeighbour(world: World, x: number, y: number): boolean {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (isWalkable(world, x + dx, y + dy)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

/**
 * Generators the Steward will run at once.
 *
 * Three is where the wood bill starts to matter: a firebox eats a log every
 * forty-five seconds it is lit, so a fourth one running through the night costs
 * about as much timber as a settler can fell in a day. Past that the answer is
 * solar, not another furnace.
 */
const MAX_GENERATORS = 3;
/**
 * How far it will run wire to reach one machine. Beyond this the cheaper answer
 * is a generator standing next to the thing, not fifteen cells of conduit
 * crossing the yard where a raider can shoot it.
 */
const WIRE_RANGE = 12;

/**
 * Keep the machines fed.
 *
 * Two failures, in the order they hurt: a turret nobody wired is a steel box,
 * and a grid that is short shuts off the cooler with a fortnight of food in it.
 * So this runs above the defences — there is no point buying a fourth gun when
 * the three that exist are dark.
 */
/**
 * Is there building work outstanding that the colony can actually finish?
 *
 * Everything the Steward spends materials on waits behind this, so the colony
 * finishes one project before starting the next. The trap was in what
 * "outstanding" meant: *any* unbuilt frame, including one waiting on steel
 * nobody has mined and nobody is about to. That frame never completes, so the
 * answer stayed true for the rest of the game and the Steward never placed
 * another blueprint again — no replacement stove after the fire, no turret
 * after one was shot out, no bunk, no bench. In the thirty-day sweeps it showed
 * up as a `built` count frozen flat from the middle of the second week and a
 * colony that quietly stopped doing anything but cook.
 *
 * So a frame counts as work in progress only while there is material on the map
 * to move it forward. One the colony cannot supply is not a queue to wait
 * behind; it is scenery, until the miners get back to it.
 */
function stillBuilding(world: World): boolean {
  return world.buildings.some((b) => {
    if (b.built) return false;
    const missing = missingResource(b);
    return missing === null || countResource(world, missing.kind) >= missing.amount;
  });
}

function keepThePowerOn(world: World): void {
  // Same one-project-at-a-time rule as everything else that spends materials.
  if (stillBuilding(world)) return;
  if (wireUpStrandedMachines(world)) return;
  // `shed` is the honest signal: it counts the machines the grid actually
  // switched off this tick, whether that was for want of watts or want of wood.
  if ((world.power?.shed ?? 0) === 0) return;
  addAGenerator(world);
}

/**
 * Run conduit from anything that wants watts to the nearest live network.
 *
 * Returns true if it laid any, so the caller can stop there and let the colony
 * finish the wiring before it commits materials to anything else.
 */
function wireUpStrandedMachines(world: World): boolean {
  const live = new Set<number>();
  for (const net of powerNetworks(world)) {
    if (!net.some((b) => isSource(b.kind))) continue;
    for (const b of net) live.add(cellKey(world, b.x, b.y));
  }
  // Nothing is making power anywhere, so there is nothing to wire *to*. That is
  // a generator problem, and the caller handles it.
  if (live.size === 0) return false;

  for (const b of world.buildings) {
    if (!b.built || DRAW[b.kind] === undefined) continue;
    if (live.has(cellKey(world, b.x, b.y))) continue;
    const run = routeConduit(world, b.x, b.y, live);
    if (run === null) continue;
    let laid = false;
    for (const c of run) if (planBlueprint(world, 'conduit', c.x, c.y)) laid = true;
    if (laid) return true;
  }
  return false;
}

/**
 * The shortest line of free cells from `(x, y)` to something already on the
 * grid, or null if there is no route inside `WIRE_RANGE`.
 *
 * Breadth-first over cells conduit can legally go on, which is not the same as
 * cells a colonist can walk on — wire lies flat and is happy under a doorway or
 * across a growing zone.
 */
function routeConduit(world: World, x: number, y: number, live: Set<number>): Cell[] | null {
  const start = cellKey(world, x, y);
  const came = new Map<number, number>();
  const cells = new Map<number, Cell>([[start, { x, y }]]);
  let front: Cell[] = [{ x, y }];

  for (let step = 0; step < WIRE_RANGE && front.length > 0; step++) {
    const next: Cell[] = [];
    for (const c of front) {
      for (const [dx, dy] of ORTHOGONAL) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        const k = cellKey(world, nx, ny);
        // Touching the live grid: the cell we came *from* is the last one that
        // needs wire, because a conduit beside a wall is a conduit on the wall's
        // network.
        if (live.has(k)) return backtrack(cells, came, start, cellKey(world, c.x, c.y));
        if (cells.has(k)) continue;
        if (canPlace(world, 'conduit', nx, ny) !== 'ok') continue;
        cells.set(k, { x: nx, y: ny });
        came.set(k, cellKey(world, c.x, c.y));
        next.push({ x: nx, y: ny });
      }
    }
    front = next;
  }
  return null;
}

/**
 * The cells from the machine out to `end`, in the order they should be laid.
 *
 * Null when `end` is the machine's own cell — which means it was already sitting
 * next to the grid and the flood fill should never have been asked.
 */
function backtrack(
  cells: Map<number, Cell>,
  came: Map<number, number>,
  start: number,
  end: number,
): Cell[] | null {
  const run: Cell[] = [];
  let k = end;
  while (k !== start) {
    run.push(cells.get(k)!);
    const prev = came.get(k);
    if (prev === undefined) return null;
    k = prev;
  }
  return run.length > 0 ? run.reverse() : null;
}

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function cellKey(world: World, x: number, y: number): number {
  return y * world.width + x;
}

/**
 * Another firebox, against the outside of the cabin wall.
 *
 * Outside on purpose. A generator is flammable and the cabin is made of wood, so
 * a machine that catches inside takes the roof, the beds and the pantry with it;
 * one standing in the yard burns alone. It loses nothing by being out there,
 * because walls conduct — a generator with its back to the cabin is on the same
 * network as every lamp inside it without a single cell of wire.
 */
function addAGenerator(world: World): void {
  if (world.buildings.filter((b) => b.kind === 'generator').length >= MAX_GENERATORS) return;
  // The build cost is thirty wood; the running cost is the rest of the woodpile.
  // Building one out of the colony's last logs just moves the blackout a day.
  if (countResource(world, 'wood') < 30 + WOOD_FLOOR) return;
  if (countResource(world, 'steel') < 10 + DEFENCE_STEEL_RESERVE) return;

  for (const c of againstTheOutsideWall()) {
    if (buildingAt(world, c.x, c.y)) continue;
    if (!hasConductingNeighbour(world, c.x, c.y)) continue;
    if (canPlace(world, 'generator', c.x, c.y) !== 'ok') continue;
    if (planBlueprint(world, 'generator', c.x, c.y)) return;
  }
}

/** The ring of ground one cell outside the cabin, minus the door column. */
function againstTheOutsideWall(): Cell[] {
  const cells: Cell[] = [];
  for (let x = CABIN.x0 - 1; x <= CABIN.x1 + 1; x++) {
    cells.push({ x, y: CABIN.y0 - 1 }, { x, y: CABIN.y1 + 1 });
  }
  for (let y = CABIN.y0; y <= CABIN.y1; y++) {
    cells.push({ x: CABIN.x0 - 1, y }, { x: CABIN.x1 + 1, y });
  }
  // The cell in front of the door is the only way in or out of the colony, and a
  // machine parked on it is a queue every time a raid starts.
  return cells.filter((c) => c.x !== CABIN.doorX);
}

function hasConductingNeighbour(world: World, x: number, y: number): boolean {
  for (const [dx, dy] of ORTHOGONAL) {
    const n = buildingAt(world, x + dx, y + dy);
    if (n && n.built && conducts(n.kind)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Defence
// ---------------------------------------------------------------------------

/**
 * Steel held back from defence work. A colony that spends its last ingot on a
 * turret and then cannot rebuild a burnt stove has lost anyway.
 */
const DEFENCE_STEEL_RESERVE = 20;
/** Wood held back the same way: a burnt wall has to be rebuildable. */
const WOOD_RESERVE = 20;
/**
 * Defence scales with the raids, because the raids scale.
 *
 * Two turrets and a gate hold the opening weeks; the 30-day sweeps showed the
 * same two turrets still standing alone against rifle-armed bands on day 25,
 * with 130 steel sitting unspent in the pantry — the colony was losing settlers
 * it had the materials to protect. Spot lists cap these: four turret positions
 * flank the lane and eight sandbag positions form the gate.
 */
function turretTarget(world: World): number {
  return Math.min(4, 2 + Math.floor(world.storyteller.threatsFired / 4));
}

function sandbagTarget(world: World): number {
  return Math.min(8, 6 + Math.floor(world.storyteller.threatsFired / 5));
}

/**
 * A killbox, such as it is. Every raider paths to the nearest settler and the
 * cabin has exactly one door, so anything that wants them has to come up the
 * lane outside it. Turrets flank that lane — 13.5 cells of range covers the
 * whole approach — and sandbags narrow it into hard cover the drafted settlers
 * can fight from. The gate is left deliberately open: seal the lane and the
 * raiders just chew through the walls somewhere the turrets are not pointing.
 */
function buildDefences(world: World): void {
  // One project at a time. Three half-built blueprints defend nothing, and
  // materials committed to a blueprint are materials the colony cannot spend.
  if (stillBuilding(world)) return;
  const steel = countResource(world, 'steel');

  if (world.buildings.filter((b) => b.kind === 'turret').length < turretTarget(world)) {
    if (steel >= 30 + DEFENCE_STEEL_RESERVE && place(world, 'turret', turretSpots())) return;
  }
  if (world.buildings.filter((b) => b.kind === 'sandbag').length < sandbagTarget(world)) {
    if (steel >= 4 + DEFENCE_STEEL_RESERVE) place(world, 'sandbag', sandbagSpots());
  }
}

function place(world: World, kind: 'turret' | 'sandbag', spots: Cell[]): boolean {
  for (const s of spots) {
    if (buildingAt(world, s.x, s.y)) continue;
    if (canPlace(world, kind, s.x, s.y) !== 'ok') continue;
    if (planBlueprint(world, kind, s.x, s.y)) return true;
  }
  return false;
}

/** Which way is "away from the cabin" from the door. */
const OUTWARD = CABIN.doorY === CABIN.y1 ? 1 : -1;

/** Flanking the door, far enough out to see past the wall corners. */
function turretSpots(): Cell[] {
  const y = CABIN.doorY + OUTWARD * 2;
  return [
    { x: CABIN.doorX - 3, y },
    { x: CABIN.doorX + 3, y },
    { x: CABIN.doorX - 4, y },
    { x: CABIN.doorX + 4, y },
  ];
}

/** Two stubs of cover with a three-wide gate between them. */
function sandbagSpots(): Cell[] {
  const y = CABIN.doorY + OUTWARD * 4;
  return [-2, 2, -3, 3, -4, 4, -5, 5].map((dx) => ({ x: CABIN.doorX + dx, y }));
}

/**
 * A workbench, as soon as the colony can spare the steel for one.
 *
 * It is the only route to a rifle or a course of medicine, and the 30-day sweeps
 * ended with settlers still swinging clubs at rifle-armed bands and no medicine
 * since about day 20, while steel piled up with nothing left to spend it on. A
 * player builds this the first time they lose someone to a fight they could have
 * won; the Steward builds it the moment the materials are there.
 */
function keepAWorkbench(world: World): void {
  if (world.buildings.some((b) => b.kind === 'bench')) return;
  // Same one-project-at-a-time rule as the defences: materials committed to a
  // blueprint are materials nothing else can use.
  if (stillBuilding(world)) return;
  if (countResource(world, 'steel') < 15 + DEFENCE_STEEL_RESERVE) return;
  if (countResource(world, 'wood') < 20 + WOOD_RESERVE) return;
  placeAtTheBackOfTheCabin(world, 'bench');
}

/**
 * Something to sit round.
 *
 * A cabin with no heat source tracks the weather, and a settler who sleeps a
 * storm night at four degrees wakes up miserable and fighting off the flu at
 * seven tenths the usual rate. Twenty wood fixes that, which makes the hearth
 * the cheapest medicine in the game — so it goes in early, ahead of the bench.
 * The heater comes later and only once there is a grid to run it on: it costs
 * steel the turrets want, and its whole advantage is that nobody has to carry
 * wood to it.
 */
function keepTheCabinWarm(world: World): void {
  if (stillBuilding(world)) return;

  if (!world.buildings.some((b) => b.kind === 'campfire')) {
    if (countResource(world, 'wood') < 20 + WOOD_RESERVE) return;
    placeNearTheHeartOfTheCabin(world, 'campfire');
    return;
  }
  if (world.buildings.some((b) => b.kind === 'heater')) return;
  if (!world.buildings.some((b) => isProducer(b.kind) && b.built)) return;
  if (countResource(world, 'steel') < 22 + DEFENCE_STEEL_RESERVE) return;
  if (countResource(world, 'wood') < 8 + WOOD_RESERVE) return;
  placeNearTheHeartOfTheCabin(world, 'heater');
}

/**
 * The free cell closest to the middle of the cabin, skipping the door column and
 * anything walled off as a pantry — a fire in the cold store would be a joke the
 * simulation would take seriously.
 */
function placeNearTheHeartOfTheCabin(world: World, kind: 'campfire' | 'heater'): void {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let y = CABIN.y0 + 1; y < CABIN.y1; y++) {
    for (let x = CABIN.x0 + 1; x < CABIN.x1; x++) {
      if (x === CABIN.doorX) continue;
      if (reservedForTheLarder(x, y)) continue;
      if (buildingAt(world, x, y)) continue;
      if (canPlace(world, kind, x, y) !== 'ok') continue;
      const d = dist(x, y, HOME_X, HOME_Y);
      if (d < bestD) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  if (best) planBlueprint(world, kind, best.x, best.y);
}

/**
 * Put the surplus somewhere cold, once there is a surplus worth keeping.
 *
 * The trigger is deliberately a store level and not a day number: a colony with
 * three days of food in hand has nothing to preserve and every ingot it owns is
 * wanted by the turret line, while one sitting on a fortnight of turnips is
 * losing the tail of them to the yard every week. Below the bench and the
 * defences in priority for the same reason — you cannot eat a cold room while
 * being shot at.
 */
function keepAColdStore(world: World): void {
  if (stillBuilding(world)) return;
  if (countResource(world, 'rawfood') + countResource(world, 'meal') < COLD_STORE_FOOD_FLOOR) return;

  if (shellIsUp(world)) {
    fitOutTheLarder(world);
    return;
  }
  if (world.buildings.some((b) => b.kind === 'cooler')) return;
  if (countResource(world, 'wood') < LARDER_WOOD + WOOD_RESERVE) return;
  raiseALarder(world);
}

/** Food in store before a cold room is worth 28 steel. About a fortnight for four. */
const COLD_STORE_FOOD_FLOOR = 170;

/** Four walls and a door. */
const LARDER_WOOD = 4 * 5 + 8;

/**
 * A pantry partitioned out of the south-west corner of the cabin.
 *
 * A cooler holds a room, not a radius, so the Steward has to build the room —
 * and the smaller the room, the colder the same machine takes it. Six cells is
 * the point: a cooler set loose in the ninety-nine-cell cabin takes it down a
 * few uncomfortable degrees and freezes nothing, while these six go below zero
 * and stay there.
 *
 * The corner is not a free choice. Two of its walls are the cabin's own, the
 * starter colony's skirting conduit runs along y=32 and its second lamp sits at
 * (34,33), so the bottom two rows of the west end are the only block of cabin
 * floor wide enough that nothing already built has to be torn out for it.
 */
const LARDER = (() => {
  const x0 = CABIN.x0 + 1;
  const y0 = CABIN.y1 - 2;
  const wallX = x0 + 3;
  const interior: Cell[] = [];
  const shell: Cell[] = [];
  for (let x = x0; x < x0 + 3; x++) shell.push({ x, y: y0 - 1 });
  for (let y = y0; y < CABIN.y1; y++) {
    for (let x = x0; x < x0 + 3; x++) interior.push({ x, y });
  }
  shell.push({ x: wallX, y: y0 + 1 });
  return {
    interior,
    shell,
    door: { x: wallX, y: y0 } as Cell,
    // Furthest corner from the door: the machine goes where the food does not.
    cooler: { x: x0, y: y0 + 1 } as Cell,
  };
})();

/** Cells inside the cabin that the pantry has first claim on, built or not. */
function reservedForTheLarder(x: number, y: number): boolean {
  return [...LARDER.interior, ...LARDER.shell, LARDER.door].some((c) => c.x === x && c.y === y);
}

function shellIsUp(world: World): boolean {
  const door = buildingAt(world, LARDER.door.x, LARDER.door.y);
  if (!door || door.kind !== 'door' || !door.built) return false;
  return LARDER.shell.every((c) => {
    const b = buildingAt(world, c.x, c.y);
    return b !== null && b.kind === 'wall' && b.built;
  });
}

function raiseALarder(world: World): void {
  for (const c of [...LARDER.shell, LARDER.door, ...LARDER.interior]) {
    if (buildingAt(world, c.x, c.y) || !isWalkable(world, c.x, c.y)) return;
  }
  // The whole shell in one go. Half a cold room is a wall in the middle of the
  // cabin, and the one-project-at-a-time gate above means the next pass would
  // not come back to finish it until this one is done anyway.
  for (const c of LARDER.shell) planBlueprint(world, 'wall', c.x, c.y);
  planBlueprint(world, 'door', LARDER.door.x, LARDER.door.y);
}

function fitOutTheLarder(world: World): void {
  const l = LARDER;
  const cooler = buildingAt(world, l.cooler.x, l.cooler.y);
  if (!cooler) {
    if (countResource(world, 'steel') < 28 + DEFENCE_STEEL_RESERVE) return;
    if (countResource(world, 'wood') < 12 + WOOD_RESERVE) return;
    if (canPlace(world, 'cooler', l.cooler.x, l.cooler.y) === 'ok') {
      planBlueprint(world, 'cooler', l.cooler.x, l.cooler.y);
    }
    return;
  }
  if (!cooler.built) return;

  // Food only. A pantry full of planks is eight cells of freezer doing nothing,
  // and the haulers already prefer a cold cell for anything that rots.
  let zone: Zone | null = null;
  for (const c of l.interior) {
    const z = zoneAt(world, c.x, c.y);
    if (z && z.kind === 'stockpile') {
      zone = z;
      break;
    }
  }
  for (const c of l.interior) {
    if (buildingAt(world, c.x, c.y)) continue;
    if (zoneAt(world, c.x, c.y)) continue;
    if (!zone) zone = addZone(world, 'stockpile', ['rawfood', 'meal']);
    addCellToZone(world, zone, c.x, c.y);
  }
}

/**
 * Somewhere inside the cabin for a work station, filled from the door end back,
 * skipping the door column — a solid block there narrows the only way out, and
 * the cells nearest the far wall are the ones the beds want.
 */
function placeAtTheBackOfTheCabin(world: World, kind: 'bench' | 'lab'): void {
  for (let y = CABIN.y1 - 1; y > CABIN.y0; y--) {
    for (let x = CABIN.x0 + 1; x < CABIN.x1; x++) {
      if (x === CABIN.doorX) continue;
      // The workstations fill these rows from the west end, which is exactly
      // where the pantry has to go. It gets the corner; they take the next cell.
      if (reservedForTheLarder(x, y)) continue;
      if (buildingAt(world, x, y)) continue;
      if (canPlace(world, kind, x, y) !== 'ok') continue;
      if (planBlueprint(world, kind, x, y)) return;
    }
  }
}

/**
 * The order a colony that has to survive would work the tree out.
 *
 * Toolmaking first because it pays for itself: every tree and rock face after it
 * is worth half again as much, which is the same as a fourth pair of hands on the
 * harvest. Then medicine, because the thing that actually kills these colonies is
 * a raid nobody recovers from, and soil beds, because the plot is what the whole
 * colony eats off. Guns before turrets: settlers fight from day one and an
 * emplacement only exists once there is steel to spare. Everything after that is
 * a colony with more hands than problems, so it goes cheapest-first.
 *
 * Tanning is third and Apprenticeship fifth for the same reason Toolmaking is
 * first: both are multipliers on everything after them. A colony that hunts is
 * already sitting on a hide pile it has no use for, and the toolbelt that pile
 * buys is fifteen per cent off every job the colony will ever do; the teaching
 * that follows is a third off every skill it will ever raise. Paid once, early,
 * and compounding for the rest of the game.
 */
const RESEARCH_PLAN: ResearchId[] = [
  'toolmaking',
  'fieldmedicine',
  'tanning',
  'soilbeds',
  'apprenticeship',
  'rifling',
  'autoloaders',
  // The coat before the wall: settlers work through a winter or they do not, and
  // a turret does not help with either.
  'weaving',
  'plating',
  'preserves',
  'stonecutting',
  'machining',
  'plateworks',
  'cartography',
];

/**
 * Build the bench, then keep a project on it.
 *
 * The bench waits behind the workbench and the defences on purpose: a colony that
 * researches before it can shoot back does not live long enough to finish the
 * project. Once it is up, research is downtime work — the Steward promotes one
 * settler to it only while the stores are comfortable, so the bench never pulls
 * anyone off a harvest the colony is actually short of.
 */
function keepResearchGoing(world: World, colonists: Pawn[]): void {
  const bench = world.buildings.find((b) => b.kind === 'lab');
  if (!bench) {
    if (!world.buildings.some((b) => b.kind === 'bench' && b.built)) return;
    if (stillBuilding(world)) return;
    if (countResource(world, 'steel') < 20 + DEFENCE_STEEL_RESERVE) return;
    if (countResource(world, 'wood') < 25 + WOOD_RESERVE) return;
    placeAtTheBackOfTheCabin(world, 'lab');
    return;
  }

  if (world.research.current === null) {
    const open = new Set(available(world).map((d) => d.id));
    const next = RESEARCH_PLAN.find((id) => open.has(id));
    if (next) setProject(world, next);
  }

  const comfortable =
    countResource(world, 'wood') >= WOOD_FLOOR && countResource(world, 'steel') >= STEEL_FLOOR;
  let scientist = colonists[0]!;
  for (const p of colonists) if (p.skills.research > scientist.skills.research) scientist = p;
  for (const p of colonists) {
    setPriority(world, p.id, 'research', comfortable && p.id === scientist.id ? 2 : 3);
  }
}

/** One bed per settler, or someone sleeps on the floor and wakes up miserable. */
function keepEveryoneABed(world: World, colonists: number): void {
  const beds = world.buildings.filter((b) => b.kind === 'bed').length;
  if (beds >= colonists) return;
  for (let y = CABIN.y0 + 1; y < CABIN.y1; y++) {
    for (let x = CABIN.x0 + 1; x < CABIN.x1; x++) {
      if (buildingAt(world, x, y)) continue;
      if (canPlace(world, 'bed', x, y) !== 'ok') continue;
      if (planBlueprint(world, 'bed', x, y)) return;
    }
  }
}

/**
 * A sickbay.
 *
 * One hospital bed to start with, a second once there are six settlers, and never
 * more: an empty one is steel that is not a turret. The Steward builds them inside
 * the cabin like any other bed — indoors is where the warmth is, and a patient
 * shivering in the yard loses the race however well they are tended.
 */
function keepASickbay(world: World, colonists: number): void {
  const want = colonists >= 6 ? 2 : 1;
  if (world.buildings.filter((b) => b.kind === 'medbed').length >= want) return;
  if (countResource(world, 'wood') < 20 + WOOD_FLOOR) return;
  if (countResource(world, 'steel') < 12 + DEFENCE_STEEL_RESERVE) return;
  if (stillBuilding(world)) return;
  for (let y = CABIN.y0 + 1; y < CABIN.y1; y++) {
    for (let x = CABIN.x0 + 1; x < CABIN.x1; x++) {
      if (buildingAt(world, x, y)) continue;
      if (canPlace(world, 'medbed', x, y) !== 'ok') continue;
      if (planBlueprint(world, 'medbed', x, y)) return;
    }
  }
}

/**
 * Bunks to put captured raiders in.
 *
 * The Steward is deliberately unambitious about this: one bunk for a small
 * colony, a second once there are enough people to spare a warden, and no more.
 * Every prisoner is a mouth eating out of the same pantry as the settlers, and a
 * colony that captures faster than it recruits starves — which is the failure
 * mode the sweeps exist to catch, so the AI must not be the thing hiding it.
 *
 * They go outside the cabin proper. A cell in the middle of the bedrooms is a
 * pathing knot, and the point of building one at the edge is that a warden can
 * reach it without walking through everyone's sleep.
 */
const BUNK_CAP = 2;

function keepABunkForCaptives(world: World, colonists: number): void {
  const want = colonists >= 6 ? BUNK_CAP : 1;
  const bunks = world.buildings.filter((b) => b.kind === 'prisonbed').length;
  if (bunks >= want) return;
  // Behind the food, not in front of it: bunks are what you build once the
  // colony is fed and walled, never instead of that.
  if (countResource(world, 'wood') < 16 + WOOD_FLOOR) return;
  if (countResource(world, 'steel') < 8 + DEFENCE_STEEL_RESERVE) return;
  if (stillBuilding(world)) return;
  for (let y = CABIN.y1 + 1; y <= CABIN.y1 + 3; y++) {
    for (let x = CABIN.x0; x <= CABIN.x1; x++) {
      if (buildingAt(world, x, y)) continue;
      if (canPlace(world, 'prisonbed', x, y) !== 'ok') continue;
      if (planBlueprint(world, 'prisonbed', x, y)) return;
    }
  }
}
