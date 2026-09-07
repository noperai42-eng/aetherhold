/**
 * World mutation helpers. Everything that changes the shape of the world
 * (buildings, item stacks, zones, messages) goes through here so the
 * cell-index caches (`cellBuilding`, `cellZone`) never drift from the arrays.
 */

import { defOf, isBed } from './buildings';
import { removeFromQueue } from './queue';
import type {
  Building,
  BuildingKind,
  Faction,
  ItemStack,
  Message,
  ResourceKind,
  World,
  Zone,
  ZoneKind,
} from './types';
import { DESIG_NONE, DESIG_TILL, inBounds, markBuildingsChanged, packCell } from './types';

export const MAX_STACK = 75;

export function nextId(world: World): number {
  return world.nextId++;
}

/** How many lines of the work log the player can scroll back through. */
const LOG_KEEP = 80;
/**
 * How many story beats the chronicle keeps. Deliberately an order of magnitude
 * longer than the log and still bounded: at the rate headlines are actually
 * raised this is several in-game years, and a colony left running overnight
 * should not be able to grow its save file without limit.
 */
const CHRONICLE_KEEP = 500;

/**
 * Say something happened.
 *
 * The fourth argument is what separates a headline from the work log. Ordinary
 * lines go to `world.messages`, which is a *window*: the last eighty, older ones
 * dropped, which is what you want from a panel that answers "what is the crew
 * doing right now".
 *
 * A message raised with `headline: true` gets two things more. It is thrown up
 * over the world as a card the player has to look at, and it is copied into
 * `world.chronicle`, which is a *history* and keeps five hundred. That second
 * list exists because the first one silently ate the colony's past: a death in
 * the spring was gone by the summer, scrolled off the end by eighty lines of
 * somebody finishing a wall, and there was nowhere left in the game that
 * remembered it had happened.
 *
 * Attach `at` whenever the event has a place; it costs nothing and it turns "a
 * fire has started" into somewhere to go.
 */
export function msg(
  world: World,
  text: string,
  kind: Message['kind'] = 'info',
  extra?: { at?: { x: number; y: number }; headline?: boolean },
): void {
  const m: Message = { tick: world.tick, text, kind };
  // Set only when given, so a save of an ordinary line stays the three fields it
  // has always been.
  if (extra?.at) m.at = { x: Math.round(extra.at.x), y: Math.round(extra.at.y) };
  if (extra?.headline) m.headline = true;
  world.messages.push(m);
  if (world.messages.length > LOG_KEEP) {
    world.messages.splice(0, world.messages.length - LOG_KEEP);
  }
  if (!m.headline) return;
  // A copy, not the same object. The log trims out from under the chronicle, and
  // a shared reference would have the two lists silently aliasing entries that
  // one of them is about to forget.
  const c = (world.chronicle ??= []);
  c.push({ ...m });
  if (c.length > CHRONICLE_KEEP) c.splice(0, c.length - CHRONICLE_KEEP);
}

export function addBuilding(
  world: World,
  kind: BuildingKind,
  x: number,
  y: number,
  built: boolean,
): Building | null {
  if (!inBounds(world, x, y)) return null;
  const idx = packCell(world, x, y);
  if (world.cellBuilding[idx]! >= 0) return null;
  const def = defOf(kind);
  const b: Building = {
    id: nextId(world),
    kind,
    x,
    y,
    built,
    work: 0,
    workLeft: def.work,
    needs: built ? {} : { ...def.cost },
    have: {},
    hp: built ? def.hp : Math.max(1, Math.round(def.hp * 0.25)),
    maxHp: def.hp,
    seed: (x * 73856093) ^ (y * 19349663),
  };
  if (kind === 'door') b.open = 0;
  if (isBed(kind)) b.occupant = null;
  if (kind === 'turret') b.cooldown = 0;
  world.buildings.push(b);
  markBuildingsChanged(world);
  world.cellBuilding[idx] = b.id;
  // A wall over a cell somebody painted for the shovel rubs the order out. Not
  // tidiness — `canTill` refuses any cell with a building on it, so the marker
  // left behind is an instruction that can never be carried out, and the only
  // code that used to clear one was a settler *arriving* with the till job in
  // hand. That worked while tilling was the farm's fallback work. It stopped
  // working the day foraging went in ahead of it: while there is fruit on the
  // moor nobody ever takes the till job, so nobody ever arrives, so the marker
  // sits glowing under the wall for the rest of the game.
  //
  // Only tilling. Floors deliberately go *under* what is already standing on
  // the cell — you floor a bedroom without dragging the bed out — so wiping a
  // floor order here would delete half a painted room the moment a bed was
  // finished in it. And a deconstruct order can't be reached at all: the cell
  // already had a building, and this function turned back at the door.
  if (world.cellDesig[idx] === DESIG_TILL) world.cellDesig[idx] = DESIG_NONE;
  return b;
}

export function removeBuilding(world: World, b: Building): void {
  const idx = packCell(world, b.x, b.y);
  if (world.cellBuilding[idx] === b.id) world.cellBuilding[idx] = -1;
  const i = world.buildings.indexOf(b);
  if (i >= 0) world.buildings.splice(i, 1);
  markBuildingsChanged(world);
  // Release anyone who was sleeping in it and cancel jobs that referenced it.
  for (const p of world.pawns) {
    if (p.activity === 'sleeping') {
      const bedGone = Math.floor(p.x) === b.x && Math.floor(p.y) === b.y;
      if (bedGone) p.activity = 'idle';
    }
  }
  for (const j of world.jobs.slice()) {
    if (j.buildingId === b.id) cancelJob(world, j.id);
  }
}

export function cancelJob(world: World, jobId: number): void {
  const i = world.jobs.findIndex((j) => j.id === jobId);
  if (i < 0) return;
  const job = world.jobs[i]!;
  const pawn = world.pawns.find((p) => p.id === job.pawnId);
  // A job can be cancelled while it is still waiting its turn on the control
  // stack — a blueprint the player rubs out, a tree somebody else fells. Taking
  // it out of the stack here rather than at the call sites is the whole reason
  // the stack can hold real jobs safely: this function is the one door out.
  if (pawn) removeFromQueue(pawn, jobId);
  if (pawn && pawn.jobId === jobId) {
    pawn.jobId = null;
    pawn.path = null;
    if (pawn.activity !== 'downed' && pawn.activity !== 'dead') pawn.activity = 'idle';
    if (pawn.carryingItemId !== null) {
      const it = world.items.find((s) => s.id === pawn.carryingItemId);
      if (it) {
        it.carriedBy = null;
        it.reservedBy = null;
        it.x = Math.round(pawn.x);
        it.y = Math.round(pawn.y);
      }
      pawn.carryingItemId = null;
    }
    // A shouldered captive gets put down where the carrier stands, rather than
    // staying welded to a warden who has moved on to something else. They are
    // still a downed raider, so the next warden free can pick the job back up.
    if (pawn.carryingPawnId != null) {
      const captive = world.pawns.find((p) => p.id === pawn.carryingPawnId);
      if (captive) {
        captive.x = pawn.x;
        captive.y = pawn.y;
      }
      pawn.carryingPawnId = null;
    }
  }
  for (const it of world.items) if (it.reservedBy === jobId) it.reservedBy = null;
  // A sleeper claims the mattress; cancelling has to hand it back. Otherwise walking
  // out of bed in first person (or getting drafted mid-nap) leaves a bed whose
  // occupant never wakes, and nobody — including you — can use it again.
  const claimed = findBuilding(world, job.buildingId);
  if (claimed && isBed(claimed.kind) && claimed.occupant === job.pawnId) claimed.occupant = null;
  world.jobs.splice(i, 1);
}

export function itemsAt(world: World, x: number, y: number): ItemStack[] {
  return world.items.filter((s) => s.carriedBy === null && s.x === x && s.y === y);
}

/**
 * Fold `amount` units at freshness `rot` into a stack, weighting by amount.
 *
 * Every place two stacks become one has to call this, or spoilage becomes a
 * laundering exercise: tip one unit of month-old wheat onto a fresh sack and the
 * whole pile takes the fresh clock, and a player who noticed would (correctly)
 * never let a stack go off again. Weighting by amount means the pile ages at the
 * rate its contents actually are.
 */
export function mergeRot(dest: ItemStack, amount: number, rot: number): void {
  const total = dest.amount + amount;
  if (total <= 0) return;
  dest.rot = ((dest.rot ?? 0) * dest.amount + rot * amount) / total;
}

/** Drop resources on the ground, merging into an existing compatible stack. */
export function addItem(
  world: World,
  kind: ResourceKind,
  amount: number,
  x: number,
  y: number,
): ItemStack | null {
  if (amount <= 0) return null;
  let left = amount;
  let last: ItemStack | null = null;
  for (const s of itemsAt(world, x, y)) {
    if (s.kind !== kind || s.amount >= MAX_STACK) continue;
    const room = MAX_STACK - s.amount;
    const put = Math.min(room, left);
    // Newly created goods are fresh, so this always makes the existing pile
    // younger — by exactly the share of it that just arrived.
    mergeRot(s, put, 0);
    s.amount += put;
    left -= put;
    last = s;
    if (left <= 0) return last;
  }
  while (left > 0) {
    const put = Math.min(MAX_STACK, left);
    const s: ItemStack = {
      id: nextId(world),
      kind,
      amount: put,
      x,
      y,
      carriedBy: null,
      reservedBy: null,
    };
    world.items.push(s);
    left -= put;
    last = s;
  }
  return last;
}

export function removeItem(world: World, item: ItemStack): void {
  const i = world.items.indexOf(item);
  if (i >= 0) world.items.splice(i, 1);
  for (const p of world.pawns) if (p.carryingItemId === item.id) p.carryingItemId = null;
}

/** Total of a resource anywhere on the map (ground + carried). Drives the HUD. */
export function countResource(world: World, kind: ResourceKind): number {
  let n = 0;
  for (const s of world.items) if (s.kind === kind) n += s.amount;
  return n;
}

/**
 * Whether `takeResource` would be willing to spend this stack.
 *
 * Loose stock always; stock a job has merely spoken for as long as nobody has
 * set off towards it; never stock in somebody's arms. Extracted so the two
 * places that need the rule — spending it, and asking first whether it is there
 * — cannot come to different conclusions.
 */
function spendableStack(world: World, s: ItemStack, kind: ResourceKind): boolean {
  if (s.kind !== kind || s.carriedBy !== null) return false;
  if (s.reservedBy === null) return true;
  const job = world.jobs.find((j) => j.id === s.reservedBy);
  if (!job) return false;
  const owner = world.pawns.find((p) => p.id === job.pawnId);
  // A reservation whose owner is no longer on the map — buried, or a raider who
  // ran — is left alone rather than swept up. It looks like free stock and it is
  // not obviously wrong to take it, but the sweeper for a dangling job belongs
  // wherever jobs are reaped, not in the middle of paying a bill. Written as
  // `owner !== undefined` on purpose: the truthiness version quietly changed this
  // rule when this predicate was lifted out of `takeResource`.
  return owner !== undefined && owner.jobId !== job.id;
}

/**
 * What the colony could actually pay out of stock right now.
 *
 * The honest counterpart to `countResource`, which counts every stack on the map
 * including the one in a builder's arms and is therefore the right number for a
 * readout and the wrong one for a decision. Anything that has to know *before*
 * it spends — a bill with more than one line on it, where paying half and
 * failing on the rest would be worse than not starting — asks this instead.
 */
export function spendableResource(world: World, kind: ResourceKind): number {
  let n = 0;
  for (const s of world.items) if (spendableStack(world, s, kind)) n += s.amount;
  return n;
}

/**
 * Spend loose colony stock. Returns how much it actually got.
 *
 * Only stacks nobody is holding and nobody has reserved: a settler halfway to
 * the wall with the last of the steel is building something, and taking it out
 * of their arms is how you get a job that finishes into nothing. That is also
 * why this can come up short of a total the HUD showed — the readout counts
 * every stack on the map, this only spends the free ones.
 *
 * Shared by the two systems that consume without a settler carrying anything:
 * the caravan, which takes payment, and the generator, which burns fuel.
 */
export function takeResource(world: World, kind: ResourceKind, amount: number): number {
  const free = world.items.filter(
    (s) => s.kind === kind && s.carriedBy === null && s.reservedBy === null,
  );
  let left = amount;
  for (const s of free) {
    if (left <= 0) break;
    const put = Math.min(s.amount, left);
    s.amount -= put;
    left -= put;
    if (s.amount <= 0) removeItem(world, s);
  }
  if (left <= 0) return amount;

  // Nothing loose left, so fall back on stock that is only *spoken for*: a pile
  // reserved by a job sitting on somebody's control stack, which nobody has yet
  // walked a step towards. Earmarked is not spent — a hauler who was going to
  // tidy that pile away can be told to do something else, and the alternative is
  // a colony that cannot pay a caravan or fuel a generator out of three hundred
  // logs because every one of them is on a to-do list. Cancelling releases the
  // claim, which is why this reads `reservedBy` again on the way past.
  // The job in a settler's hands is off limits — they are on their way there —
  // which is one of the rules `spendableStack` keeps.
  const waiting: ItemStack[] = [];
  for (const s of world.items) {
    if (s.reservedBy !== null && spendableStack(world, s, kind)) waiting.push(s);
  }
  for (const s of waiting) {
    if (left <= 0) break;
    if (s.reservedBy !== null) cancelJob(world, s.reservedBy);
    const put = Math.min(s.amount, left);
    s.amount -= put;
    left -= put;
    if (s.amount <= 0) removeItem(world, s);
  }
  return amount - left;
}

export function addZone(world: World, kind: ZoneKind, accepts: ResourceKind[]): Zone {
  const z: Zone = { id: nextId(world), kind, cells: [], accepts };
  world.zones.push(z);
  return z;
}

export function zoneAt(world: World, x: number, y: number): Zone | null {
  if (!inBounds(world, x, y)) return null;
  const id = world.cellZone[packCell(world, x, y)]!;
  if (id < 0) return null;
  return world.zones.find((z) => z.id === id) ?? null;
}

export function addCellToZone(world: World, z: Zone, x: number, y: number): void {
  if (!inBounds(world, x, y)) return;
  const idx = packCell(world, x, y);
  const prev = world.cellZone[idx]!;
  if (prev === z.id) return;
  if (prev >= 0) {
    const pz = world.zones.find((q) => q.id === prev);
    if (pz) pz.cells = pz.cells.filter((c) => c !== idx);
  }
  world.cellZone[idx] = z.id;
  z.cells.push(idx);
}

export function removeZoneCell(world: World, x: number, y: number): void {
  if (!inBounds(world, x, y)) return;
  const idx = packCell(world, x, y);
  const id = world.cellZone[idx]!;
  if (id < 0) return;
  world.cellZone[idx] = -1;
  const z = world.zones.find((q) => q.id === id);
  if (z) {
    z.cells = z.cells.filter((c) => c !== idx);
    if (z.cells.length === 0) world.zones = world.zones.filter((q) => q.id !== z.id);
  }
}

export function findPawn(world: World, id: number | null) {
  if (id === null) return null;
  return world.pawns.find((p) => p.id === id) ?? null;
}

export function findBuilding(world: World, id: number | undefined) {
  if (id === undefined) return null;
  return world.buildings.find((b) => b.id === id) ?? null;
}

export function findItem(world: World, id: number | null | undefined) {
  if (id === null || id === undefined) return null;
  return world.items.find((s) => s.id === id) ?? null;
}

export function livingColonists(world: World) {
  return world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
}

/**
 * Settlers who are alive and yours but not on the map.
 *
 * There are two ways off the map and for nine rounds the sim only knew about
 * one. A caravan lifts its party out of `world.pawns` so nothing can path to,
 * feed or shoot a body that is four days away, and every counter that had to
 * care wrote `caravansOf(world).filter((c) => !c.pawn.dead).length` inline.
 * Then `joinWarParty` started doing the same lift for the same reason, into
 * `world.war` instead, and none of those inline sums learned about it — so the
 * one question the game must never get wrong got it wrong: a colony whose home
 * is wiped while three settlers are on the moor printed "Aetherhold has fallen.
 * No settlers remain." with three settlers alive and walking back to it, and
 * the founding charter dropped from 8/8 to 5/8 on the afternoon a player
 * ordered the march the warfare road spends four rungs teaching them to want.
 *
 * So the sum lives here, once, and takes both kinds. The name is the invariant:
 * anybody who adds a third way to be off the map has one place to add it, and a
 * counter written against this helper picks it up without being found first.
 *
 * Deliberately *not* used by `colonySize`, and that is not an oversight —
 * `settlements.ts` says why at the definition.
 */
export function awayCount(world: World): number {
  const travelling = (world.caravans ?? []).filter((c) => !c.pawn.dead).length;
  const marching = (world.war?.pawns ?? []).filter((p) => !p.dead).length;
  return travelling + marching;
}

export function hostiles(world: World) {
  // `fauna` is deliberately excluded: a deer in the yard is not a raid, and every
  // caller here is asking "is the colony under attack" — job panic, wanderer
  // arrivals, scouting, turret aim and the raid-is-over check.
  // `trader` is excluded for the same reason: a pedlar in the yard must not put
  // the colony at arms, stop the wanderers arriving or call the scouts home.
  // `prisoner` likewise — a raid is not still running because you kept one of
  // them alive in a bunk, and a colony holding prisoners must still be able to
  // farm, scout and take in wanderers.
  const NEUTRAL: Faction[] = ['colony', 'fauna', 'trader', 'prisoner'];
  return world.pawns.filter((p) => !NEUTRAL.includes(p.faction) && !p.dead && !p.downed);
}
