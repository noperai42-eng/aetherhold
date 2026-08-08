/**
 * Orders — the command surface. Every player action from EITHER view goes
 * through these functions: the manager's drag-designate, the first-person body's
 * E-interact, the draft toggle. Nothing mutates the world behind their back,
 * which is why the two views can never disagree about what was ordered.
 */

import { defOf, isBed } from './buildings';
import { clearBushAt } from './berries';
import { CROP_NONE, canSow, canTill, cropAt } from './farming';
import { onShore } from './fishing';
import { canFloor, canRemoveFloor, floorForDesig } from './floors';
import { adjacentStandCells, buildingAt, isWalkable, nearestWalkable, wouldBlockDoorway } from './grid';
import {
  blueprintReady,
  clearQueue,
  findStack,
  findStockpileCell,
  isBuildingTargeted,
  isCellTargeted,
  isFloorTargeted,
  missingResource,
  queueJob,
  reachable,
} from './jobs';
import { stackRoom } from './queue';
import { forgetRebuild } from './rebuild';
import { buildingUnlocked } from './research';
import type { BuildingKind, Pawn, ResourceKind, WorkType, World, Zone } from './types';
import { isPet, keeperOf, petName } from './pets';
import { isBrowser } from './wildlife';
import {
  DESIG_DECONSTRUCT,
  DESIG_HARVEST,
  DESIG_NONE,
  DESIG_TILL,
  inBounds,
  packCell,
  terrainAt,
} from './types';
import {
  addBuilding,
  addCellToZone,
  addItem,
  addZone,
  cancelJob,
  findPawn,
  itemsAt,
  livingColonists,
  msg,
  removeBuilding,
  removeZoneCell,
  zoneAt,
} from './world';

export type PlaceResult = 'ok' | 'occupied' | 'terrain' | 'bounds' | 'unresearched' | 'doorway' | 'shore';

export function canPlace(world: World, kind: BuildingKind, x: number, y: number): PlaceResult {
  if (!inBounds(world, x, y) || x === 0 || y === 0 || x === world.width - 1 || y === world.height - 1) {
    return 'bounds';
  }
  const t = terrainAt(world, x, y);
  if (t === 'water' || t === 'rock') return 'terrain';
  if (world.cellBuilding[packCell(world, x, y)]! >= 0) return 'occupied';
  // The menu already hides what the colony has not worked out, but the check
  // belongs here too: this is the one door every blueprint goes through, and a
  // saved game reloaded mid-project must not be able to keep placing stone.
  if (!buildingUnlocked(world, kind)) return 'unresearched';
  // Nothing solid on a doorstep — see wouldBlockDoorway. The check sits here so
  // the drag preview greys the cell out before the player commits to it, and so
  // that the colony's own planners, which all ask this same question before they
  // place anything, cannot wall their settlers out of the cabin.
  if (defOf(kind).solid && wouldBlockDoorway(world, x, y)) return 'doorway';
  // A fishing stage has to have something to fish in. The check lives here for
  // the same reason the research gate does: this is the one door every blueprint
  // goes through, so the drag preview greys out the whole map except the
  // shoreline without the UI knowing anything about lakes.
  if (defOf(kind).needsShore && !onShore(world, x, y)) return 'shore';
  return 'ok';
}

/** Queue a blueprint. Settlers will haul materials to it and build it. */
export function placeBlueprint(world: World, kind: BuildingKind, x: number, y: number): boolean {
  if (canPlace(world, kind, x, y) !== 'ok') return false;
  const b = addBuilding(world, kind, x, y, false);
  if (!b) return false;
  world.cellDesig[packCell(world, x, y)] = DESIG_NONE;
  return true;
}

/** Right-click / cancel tool: removes a blueprint, or clears a designation. */
export function cancelAt(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y)) return false;
  const idx = packCell(world, x, y);
  if (world.cellDesig[idx] !== DESIG_NONE) {
    world.cellDesig[idx] = DESIG_NONE;
    return true;
  }
  const b = buildingAt(world, x, y);
  if (b && !b.built) {
    // Refund whatever was already hauled in.
    for (const k of Object.keys(b.have) as ResourceKind[]) {
      const n = b.have[k] ?? 0;
      if (n > 0) addItem(world, k, n, b.x, b.y);
    }
    removeBuilding(world, b);
    // Cancelling the blueprint cancels the intent behind it as well, or the very
    // next tick would lay the same blueprint down again.
    forgetRebuild(world, x, y);
    return true;
  }
  // Nothing on the cell to rub out, but the colony may still be *meaning* to put
  // something here — a wall that burnt down and is waiting for the fire to die.
  // The cancel tool is how the player says "leave the gap".
  return forgetRebuild(world, x, y);
}

export function designate(world: World, x: number, y: number, desig: number): boolean {
  if (!inBounds(world, x, y)) return false;
  const idx = packCell(world, x, y);
  if (desig === DESIG_NONE) {
    world.cellDesig[idx] = DESIG_NONE;
    return true;
  }
  if (desig === DESIG_HARVEST) {
    const b = buildingAt(world, x, y);
    const isTree = b !== null && b.kind === 'tree';
    const isRock = terrainAt(world, x, y) === 'rock';
    if (!isTree && !isRock) return false;
    world.cellDesig[idx] = DESIG_HARVEST;
    return true;
  }
  if (desig === DESIG_DECONSTRUCT) {
    // One order, two things it can mean, and which one is decided by what is
    // actually on the cell rather than by which tool the player picked. The X
    // tool takes the topmost thing off a square: the bed, and then — click it
    // again — the floorboards it was standing on. That is one tool fewer to
    // learn for a job the player already knows the verb for, and it falls out of
    // the fact that a building and a floor can never both be the top of a cell.
    const b = buildingAt(world, x, y);
    if (b) {
      if (!b.built || b.kind === 'tree') return false;
      world.cellDesig[idx] = DESIG_DECONSTRUCT;
      return true;
    }
    if (!canRemoveFloor(world, x, y)) return false;
    world.cellDesig[idx] = DESIG_DECONSTRUCT;
    return true;
  }
  if (desig === DESIG_TILL) {
    if (!canTill(world, x, y)) return false;
    world.cellDesig[idx] = DESIG_TILL;
    return true;
  }
  const floor = floorForDesig(desig);
  if (floor) {
    if (!canFloor(world, x, y, floor)) return false;
    world.cellDesig[idx] = desig;
    return true;
  }
  return false;
}

/**
 * Mark (or unmark) every grazing animal standing on a cell for the hunters.
 *
 * The flag lives on the animal rather than the cell because the quarry walks off
 * the moment it is spooked — a designation painted on the ground would point at
 * empty grass a second later. Returns how many animals changed, so the caller can
 * phrase its own confirmation.
 */
export function markHunt(world: World, x: number, y: number, on: boolean): number {
  let n = 0;
  for (const p of world.pawns) {
    if (p.faction !== 'fauna' || p.dead) continue;
    if (Math.round(p.x) !== x || Math.round(p.y) !== y) continue;
    if (markHuntPawn(world, p.id, on)) n++;
  }
  return n;
}

/** Mark one animal by id — what the inspector's Hunt button calls. */
export function markHuntPawn(world: World, pawnId: number, on: boolean): boolean {
  const p = findPawn(world, pawnId);
  if (!p || p.faction !== 'fauna' || p.dead) return false;
  // Nobody marks somebody's animal. Refused here rather than in the panel because
  // this is the one door both ways in — the inspector's button and a drag of the
  // hunt tool across a yard full of livestock — and a rule enforced in only one of
  // those is a rule the player finds the hole in by accident. `pets.ts` says why
  // the bond has to be worth something.
  if (on && isPet(p)) {
    msg(world, `${petName(p)} is ${keeperOf(world, p)?.name ?? 'somebody'}'s. Let them go first.`, 'bad');
    return false;
  }
  if (!!p.hunted === on) return false;
  p.hunted = on;
  if (!on) {
    // Drop any hunt already under way, or the hunter keeps shooting at an animal
    // the player just called off.
    for (const j of world.jobs) {
      if (j.kind === 'hunt' && j.targetPawnId === p.id) cancelJob(world, j.id);
    }
  }
  return true;
}

/** Paint a stockpile cell, merging into an adjacent stockpile when there is one. */
export function paintStockpile(world: World, x: number, y: number): boolean {
  if (!inBounds(world, x, y) || !isWalkable(world, x, y)) return false;
  // The frozen lake is a road and never real estate. `isWalkable` says yes to it
  // in January and is right to — but a stockpile painted out there is a pile of
  // steel floating in a lake come April, and the terrain check is the only thing
  // between the player and that. Same reason `canPlace` refuses water outright.
  if (terrainAt(world, x, y) === 'water') return false;
  const existing = zoneAt(world, x, y);
  if (existing && existing.kind === 'stockpile') return true;
  let zone: Zone | null = null;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const z = zoneAt(world, x + dx, y + dy);
    if (z && z.kind === 'stockpile') {
      zone = z;
      break;
    }
  }
  if (!zone) zone = addZone(world, 'stockpile', ['wood', 'steel', 'rawfood', 'meal', 'medicine']);
  addCellToZone(world, zone, x, y);
  return true;
}

/**
 * Paint a growing-zone cell, merging into an adjacent plot when there is one.
 *
 * Same shape as `paintStockpile` but it also refuses cells a crop could never
 * live in, so the player never paints soil the farm AI will silently skip.
 */
export function paintGrowingZone(world: World, x: number, y: number): boolean {
  if (!canSow(world, x, y)) return false;
  const existing = zoneAt(world, x, y);
  if (existing && existing.kind === 'growing') return true;
  let zone: Zone | null = null;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const z = zoneAt(world, x + dx, y + dy);
    if (z && z.kind === 'growing') {
      zone = z;
      break;
    }
  }
  if (!zone) zone = addZone(world, 'growing', []);
  addCellToZone(world, zone, x, y);
  // A wild bramble standing on the new furrow comes out. Leaving it would give
  // the farm board two jobs on one cell that each undo the other's reason to
  // exist — a sow and a forage, forever.
  clearBushAt(world, x, y);
  return true;
}

/**
 * Paint a pen cell. Same merge-with-a-neighbour rule as the other two zones, so a
 * player who drags a pen in two passes ends up with one pen and not two.
 */
export function paintPenZone(world: World, x: number, y: number): boolean {
  // Anything a settler can walk on. A pen over a growing zone would be the player
  // asking their livestock to eat the crop, which is their business — but a pen on
  // rock or water is an order nobody can carry out — including the frozen lake,
  // which is walkable for six days a year and a drowned herd for the other
  // fourteen.
  if (!inBounds(world, x, y) || !isWalkable(world, x, y)) return false;
  if (terrainAt(world, x, y) === 'water') return false;
  const existing = zoneAt(world, x, y);
  if (existing && existing.kind === 'pen') return true;
  let zone: Zone | null = null;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const z = zoneAt(world, x + dx, y + dy);
    if (z && z.kind === 'pen') {
      zone = z;
      break;
    }
  }
  if (!zone) zone = addZone(world, 'pen', []);
  addCellToZone(world, zone, x, y);
  return true;
}

/** Mark every animal standing on this cell for taming — the drag-tool entry point. */
export function markTame(world: World, x: number, y: number, on: boolean): number {
  let n = 0;
  for (const p of world.pawns) {
    if (p.faction !== 'fauna' || p.dead) continue;
    if (Math.round(p.x) !== x || Math.round(p.y) !== y) continue;
    if (markTamePawn(world, p.id, on)) n++;
  }
  return n;
}

/** Mark one animal by id — what the inspector's Tame button calls. */
export function markTamePawn(world: World, pawnId: number, on: boolean): boolean {
  const p = findPawn(world, pawnId);
  if (!p || p.faction !== 'fauna' || p.dead) return false;
  // Already livestock. Nothing left to coax.
  if (p.tame === true) return false;
  // And nothing coaxes a fenwolf. This is the one choke point — every path into
  // taming, from the drag-select above to the inspector button to the job the
  // handler picks up, goes through `tameTarget`, and `isTameable` will not look
  // at an animal that has not been marked. A pack that could be turned into pets
  // would answer the whole feature with a bag of feed.
  if (p.hunts === true) return false;
  // And nothing pens a brambletail either, for the opposite reason. It is not
  // dangerous, it is worthless: three meat, no hide, and nothing a pen could
  // ever collect from it. A player who could mark one would build the fence,
  // feed it, and stand there waiting for a yield that does not exist, with the
  // game saying nothing. Refused at the same choke point as the wolf so both
  // answers are given before the fence goes up rather than after.
  //
  // Which leaves the species doing exactly what it is on the map for: eating
  // fruit where the player can see it, and being eaten.
  if (isBrowser(p)) return false;
  if (!!p.tameTarget === on) return false;
  p.tameTarget = on;
  if (on) {
    // The two orders contradict each other, and the player just gave the second
    // one. Marking to tame calls off the hunt rather than leaving a hunter walking
    // out with a rifle behind the handler walking out with a handful of feed.
    markHuntPawn(world, pawnId, false);
  } else {
    for (const j of world.jobs) {
      if (j.kind === 'tame' && j.targetPawnId === p.id) cancelJob(world, j.id);
    }
  }
  return true;
}

export function eraseZone(world: World, x: number, y: number): void {
  // Un-painting a plot pulls the plants with it. Clearing here rather than
  // sweeping for orphans in tickCrops keeps the per-tick cost at "cells in a
  // zone" instead of "cells on the map".
  const z = zoneAt(world, x, y);
  if (z && z.kind === 'growing') world.crops[packCell(world, x, y)] = CROP_NONE;
  removeZoneCell(world, x, y);
}

export function setStockpileFilter(world: World, zoneId: number, kind: ResourceKind, on: boolean): void {
  const z = world.zones.find((q) => q.id === zoneId);
  if (!z) return;
  if (on && !z.accepts.includes(kind)) z.accepts.push(kind);
  if (!on) z.accepts = z.accepts.filter((k) => k !== kind);
}

export function setPriority(world: World, pawnId: number, work: WorkType, level: number): void {
  const p = findPawn(world, pawnId);
  if (!p) return;
  p.priorities[work] = Math.max(0, Math.min(4, level));
  // Re-evaluate immediately so the change is visible, not felt 15 ticks later.
  if (p.jobId !== null) {
    const job = world.jobs.find((j) => j.id === p.jobId);
    if (job && p.priorities[work] === 0) cancelJob(world, job.id);
  }
}

export function setDrafted(world: World, pawnId: number, on: boolean): void {
  const p = findPawn(world, pawnId);
  if (!p || p.dead || p.downed) return;
  if (p.drafted === on) return;
  p.drafted = on;
  p.orderX = null;
  p.orderY = null;
  p.path = null;
  if (on) {
    if (p.jobId !== null) cancelJob(world, p.jobId);
    p.activity = 'idle';
    msg(world, `${p.name} is drafted.`, 'info');
  } else {
    p.activity = 'idle';
    msg(world, `${p.name} stands down.`, 'info');
  }
}

/** Manager click-to-move for a drafted settler. */
export function orderMove(world: World, pawnId: number, x: number, y: number): boolean {
  const p = findPawn(world, pawnId);
  if (!p || p.dead || p.downed) return false;
  const spot = nearestWalkable(world, x, y, 8);
  if (!spot) return false;
  p.orderX = spot.x;
  p.orderY = spot.y;
  p.path = null;
  if (!p.drafted) {
    // Undrafted settlers keep working; a move order drafts them implicitly.
    setDrafted(world, pawnId, true);
    p.orderX = spot.x;
    p.orderY = spot.y;
  }
  return true;
}

/**
 * Take a settler off the work board, or put them back on it.
 *
 * Manual is not the draft. A drafted settler stops being a worker at all — they
 * hold a position and shoot at things. A manual settler is still a worker; the
 * colony has simply stopped choosing *which* work, and the player does it
 * instead, one order at a time. They still eat, still sleep, still run from a
 * fire, because taking somebody off the board is not a licence to starve them.
 */
export function setManual(world: World, pawnId: number, on: boolean): void {
  const p = findPawn(world, pawnId);
  if (!p || p.faction !== 'colony' || p.dead) return;
  if ((p.manual ?? false) === on) return;
  p.manual = on;
  if (on) {
    // The look-ahead goes back on the board. It was the colony's guess at what
    // this settler should do after the current job, and the entire point of the
    // switch is that the guess is now the player's to make. The job *in hand*
    // stays: a settler who drops a sack of steel in the yard the instant you
    // click the button is a worse surprise than one more task finishing.
    clearQueue(world, p);
    msg(world, `${p.name} is taking orders directly.`, 'info');
  } else {
    // Orders the player already gave are left standing — they were deliberate,
    // and the colony will pick its own work back up once they run out.
    msg(world, `${p.name} is back on the work board.`, 'info');
  }
}

/**
 * What came of a hand-issued order.
 *
 * A string union rather than a boolean for the same reason `PlaceResult` is one:
 * the HUD says something different for each, and "nothing happened" is the least
 * useful thing a command surface can tell a player.
 */
export type OrderResult = 'ok' | 'full' | 'taken' | 'unreachable' | 'blocked' | 'none';

/**
 * Order one settler to deal with one cell.
 *
 * This is the manager-side counterpart to first person's E: the player points at
 * something and the settler works out what "deal with it" means there. The
 * resolution order below is the colony's own priority order read off
 * `tryWorkType`, minus the designation checks — a click *is* the designation, so
 * an unmarked tree can be felled by hand without marking the whole grove.
 *
 * Every case asks the same claim questions the colony's picker asks, because the
 * job this creates is an ordinary job on `world.jobs` and two settlers walking to
 * the same rock is exactly as broken however the second one was sent.
 *
 * The fallback is always a walk. Pointing at empty ground has to mean something,
 * and "stand there" is the one order that never needs a target worth working on.
 */
export function orderJob(world: World, pawnId: number, x: number, y: number): OrderResult {
  const p = findPawn(world, pawnId);
  if (!p || p.faction !== 'colony' || p.dead || p.downed) return 'none';
  // A drafted settler is under the combat pass, which drives them by position and
  // would fight this for control of the same body. The manager sends them with
  // `orderMove` instead.
  if (p.drafted) return 'blocked';
  if (!inBounds(world, x, y)) return 'none';
  if (stackRoom(world, p) <= 0) return 'full';

  const b = buildingAt(world, x, y);
  const desig = world.cellDesig[packCell(world, x, y)]!;

  if (b && !b.built) {
    if (isBuildingTargeted(world, b.id)) return 'taken';
    if (!reachable(world, p, b.x, b.y, true)) return 'unreachable';
    if (blueprintReady(b)) {
      queueJob(world, p, 'build', b.x, b.y, { buildingId: b.id });
      return 'ok';
    }
    const missing = missingResource(b)!;
    const stack = findStack(world, p, missing.kind);
    if (!stack) return 'none';
    const job = queueJob(world, p, 'haulToBlueprint', stack.x, stack.y, {
      buildingId: b.id,
      itemId: stack.id,
      resource: missing.kind,
      amount: missing.amount,
    });
    stack.reservedBy = job.id;
    return 'ok';
  }

  if (b && b.kind === 'tree') {
    if (isBuildingTargeted(world, b.id)) return 'taken';
    if (!reachable(world, p, b.x, b.y, true)) return 'unreachable';
    queueJob(world, p, 'chop', b.x, b.y, { buildingId: b.id });
    return 'ok';
  }

  // A standing building is only ever torn down on purpose, so this one case does
  // still want the designation: clicking your own bunkhouse should walk you to
  // it, not demolish it.
  if (b && desig === DESIG_DECONSTRUCT) {
    if (isBuildingTargeted(world, b.id)) return 'taken';
    if (!reachable(world, p, b.x, b.y, true)) return 'unreachable';
    queueJob(world, p, 'deconstruct', b.x, b.y, { buildingId: b.id });
    return 'ok';
  }

  // Same clause one layer down. The designation is what says the player meant to
  // take this up — clicking a paved cell to send somebody to stand on it is by
  // far the commoner thing to want, and it stays the default.
  if (!b && desig === DESIG_DECONSTRUCT && canRemoveFloor(world, x, y)) {
    // `isFloorTargeted` rather than the generic cell check, because a floor job
    // keeps the cell it is working in `floorX`/`floorY` — `tx`/`ty` is wherever
    // the settler is walking this stage, which for a floor being *laid* is the
    // woodpile. Same predicate the colony's own picker claims with.
    if (isFloorTargeted(world, x, y)) return 'taken';
    // Levered up from alongside for a bridge — see `removeFloorJob`.
    const adjacent = terrainAt(world, x, y) === 'bridge';
    if (!reachable(world, p, x, y, !adjacent)) return 'unreachable';
    queueJob(world, p, 'deconstruct', x, y, { floorX: x, floorY: y });
    return 'ok';
  }

  if (!b && terrainAt(world, x, y) === 'rock') {
    if (isCellTargeted(world, x, y)) return 'taken';
    if (!reachable(world, p, x, y, true)) return 'unreachable';
    queueJob(world, p, 'mine', x, y);
    return 'ok';
  }

  const zone = zoneAt(world, x, y);
  if (!b && zone && zone.kind === 'growing') {
    const g = cropAt(world, x, y);
    if (g >= 1 && !isCellTargeted(world, x, y)) {
      if (!reachable(world, p, x, y, true)) return 'unreachable';
      queueJob(world, p, 'harvestCrop', x, y);
      return 'ok';
    }
    if (g === CROP_NONE && canSow(world, x, y) && !isCellTargeted(world, x, y)) {
      if (!reachable(world, p, x, y, true)) return 'unreachable';
      queueJob(world, p, 'sow', x, y);
      return 'ok';
    }
  }

  if (!b && desig === DESIG_TILL && canTill(world, x, y) && !isCellTargeted(world, x, y)) {
    if (!reachable(world, p, x, y, true)) return 'unreachable';
    queueJob(world, p, 'till', x, y);
    return 'ok';
  }

  // Loose goods. Only ones nobody has spoken for, and only when there is
  // somewhere for them to go — a haul job with no destination walks a settler to
  // a crate and then stands them over it.
  for (const s of itemsAt(world, x, y)) {
    if (s.reservedBy !== null) continue;
    if (!findStockpileCell(world, s.kind, s)) continue;
    if (!reachable(world, p, s.x, s.y, false)) return 'unreachable';
    const job = queueJob(world, p, 'haulToStockpile', s.x, s.y, { itemId: s.id });
    s.reservedBy = job.id;
    return 'ok';
  }

  const spot = nearestWalkable(world, x, y, 8);
  if (!spot) return 'unreachable';
  if (!reachable(world, p, spot.x, spot.y, false)) return 'unreachable';
  queueJob(world, p, 'moveTo', spot.x, spot.y);
  return 'ok';
}

/**
 * Rub one entry off a settler's control stack.
 *
 * Goes through `cancelJob` like every other cancellation, which is what hands
 * back the reservations the entry has been holding since it was queued. The
 * ownership check is not paranoia — the HUD sends job ids straight off the panel,
 * and a stale one from a settler who died mid-click must not cancel somebody
 * else's work.
 */
export function cancelStackEntry(world: World, pawnId: number, jobId: number): boolean {
  const p = findPawn(world, pawnId);
  if (!p) return false;
  const job = world.jobs.find((j) => j.id === jobId);
  if (!job || job.pawnId !== p.id) return false;
  cancelJob(world, jobId);
  return true;
}

export function possess(world: World, pawnId: number): Pawn | null {
  const p = findPawn(world, pawnId);
  if (!p || p.dead) return null;
  for (const q of world.pawns) q.playerControlled = false;
  p.playerControlled = true;
  p.path = null;
  if (p.activity === 'sleeping') {
    const bed = buildingAt(world, Math.round(p.x), Math.round(p.y));
    if (bed && isBed(bed.kind)) bed.occupant = null;
    p.activity = 'idle';
  }
  if (p.jobId !== null) cancelJob(world, p.jobId);
  return p;
}

export function releasePossession(world: World): void {
  for (const q of world.pawns) q.playerControlled = false;
}

export function possessedPawn(world: World): Pawn | null {
  return world.pawns.find((p) => p.playerControlled) ?? null;
}

/**
 * The first of these candidates that is a body you can actually step into,
 * falling back to any settler still standing.
 *
 * `V` used to hand the view swap whatever the manager had selected, which was
 * fine while every selectable pawn was a settler. Once animals became selectable
 * it started offering up a deer, possession refused it, and the view simply did
 * not switch — the key looked broken. The filter belongs here, where both the key
 * and the possess button read it.
 */
export function inhabitableId(world: World, ...candidates: Array<number | null>): number | null {
  for (const id of candidates) {
    if (id === null) continue;
    const p = findPawn(world, id);
    if (p && !p.dead && p.faction === 'colony') return id;
  }
  return livingColonists(world)[0]?.id ?? null;
}

/**
 * How many of these rock cells no settler can get a pick to.
 *
 * A rock blob's interior has no walkable neighbour until its face comes down, so
 * marking a whole cliff and watching nothing happen is correct behaviour that looks
 * exactly like a broken tool. The neighbour test is free; the path test costs a
 * search each, so it is capped — marked rock is contiguous, and a sample of the
 * cells that do have a face is enough to tell "walled in" from "not started yet".
 */
export function unreachableRock(world: World, cells: Array<{ x: number; y: number }>): number {
  const digger = livingColonists(world).find((p) => !p.downed) ?? null;
  let walled = 0;
  let probes = 0;
  for (const c of cells) {
    if (terrainAt(world, c.x, c.y) !== 'rock') continue;
    if (adjacentStandCells(world, c.x, c.y).length === 0) {
      walled++;
      continue;
    }
    if (digger && probes < 20) {
      probes++;
      if (!reachable(world, digger, c.x, c.y, true)) walled++;
    }
  }
  return walled;
}
