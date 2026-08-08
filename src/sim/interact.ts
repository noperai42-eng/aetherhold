/**
 * First-person interaction. Pressing E does not run a parallel mini-simulation:
 * it creates a REAL job on the possessed settler, exactly the kind the manager
 * view would have queued. The body then auto-follows that job until the player
 * overrides it with movement input.
 *
 * `describeTarget` and `interact` share one target-finding function, so the HUD
 * prompt can never advertise something E will not do.
 */

import { defOf } from './buildings';
import { buildingAt, dist } from './grid';
import {
  benchRecipe,
  benchRefusal,
  blueprintReady,
  createJob,
  findStockpileCell,
  lockedRecipe,
  wantedRecipe,
} from './jobs';
import { CRAFT_DEFS } from './crafting';
import { lakeHasFish } from './fishing';
import { iceBears } from './ice';
import { RESEARCH } from './research';
import type { Building, ItemStack, Job, Pawn, ResourceKind, World } from './types';
import { DESIG_HARVEST, packCell, terrainAt } from './types';
import { MAX_STACK, cancelJob, findItem, itemsAt, msg, removeItem } from './world';

const REACH = 1.8;
const ARC = 1.15; // radians either side of facing

export type InteractTarget =
  | { type: 'building'; building: Building; label: string; verb: string }
  | { type: 'item'; item: ItemStack; label: string; verb: string }
  | { type: 'pawn'; pawn: Pawn; label: string; verb: string }
  | { type: 'fire'; x: number; y: number; label: string; verb: string }
  | { type: 'rock'; x: number; y: number; label: string; verb: string }
  | { type: 'drop'; label: string; verb: string }
  | null;

function inArc(pawn: Pawn, x: number, y: number): boolean {
  const d = dist(pawn.x, pawn.y, x, y);
  if (d > REACH) return false;
  if (d < 0.4) return true;
  const ang = Math.atan2(y - pawn.y, x - pawn.x);
  let diff = ang - pawn.facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= ARC;
}

function verbForBuilding(world: World, pawn: Pawn, b: Building): string | null {
  if (!b.built) {
    return blueprintReady(b) ? `Build ${defOf(b.kind).label.toLowerCase()}` : `Fetch materials for ${defOf(b.kind).label.toLowerCase()}`;
  }
  switch (b.kind) {
    case 'bed':
      if (b.occupant !== null && b.occupant !== pawn.id) return null;
      return 'Sleep';
    case 'table': {
      const food = world.items.find((s) => s.carriedBy === null && (s.kind === 'meal' || s.kind === 'rawfood'));
      return food ? 'Eat at table' : 'Sit and unwind';
    }
    case 'stove': {
      const raw = world.items.find((s) => s.carriedBy === null && s.kind === 'rawfood' && s.amount >= 8);
      return raw ? 'Cook a batch of meals' : null;
    }
    case 'bench': {
      // Same chooser the work AI uses, so the prompt cannot offer something a
      // settler at the same bench would refuse to start. Stock totals only — this
      // runs every frame the player is looking at a bench, and finding the actual
      // stack to spend costs a path search.
      const recipe = wantedRecipe(world, pawn);
      if (recipe) return CRAFT_DEFS[recipe].verb;
      // Locked, not empty: the colony wants one of these and this settler is not
      // allowed to make it. Keep the prompt, change the verb — E answers with the
      // reason, which is the only way a skill gate is ever discovered in first
      // person. A bench with nothing wanted at all still says nothing.
      return lockedRecipe(world, pawn) ? 'Look over the recipes' : null;
    }
    case 'lab': {
      const id = world.research.current;
      return id === null ? null : `Work on ${RESEARCH[id].label}`;
    }
    case 'fishhole':
      // The lake being empty is worth saying out loud rather than going quiet on.
      // A player standing on a plank they built, pressing E at nothing, has no
      // other way to find out that the reason is under the water.
      if (!lakeHasFish(world)) return 'The water here is fished out';
      return iceBears(world) ? 'Cut a hole and fish' : 'Cast a line';
    case 'tree':
      return 'Chop this tree';
    default:
      return null;
  }
}

/**
 * The rock face you are standing at, if any.
 *
 * Rock is terrain, not a building, so the building scan above walks straight past
 * it — which is why a settler in first person could chop a tree but not touch a
 * cliff. Steel only comes out of rock, so that hole meant the whole mining half of
 * the economy was manager-only. Neighbours only: you mine what you can reach.
 */
function rockAhead(pawn: Pawn, world: World): { x: number; y: number } | null {
  const px = Math.round(pawn.x);
  const py = Math.round(pawn.y);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = px + dx;
      const y = py + dy;
      if (terrainAt(world, x, y) !== 'rock') continue;
      if (!inArc(pawn, x, y)) continue;
      const d = dist(pawn.x, pawn.y, x, y);
      if (d < bestD) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  return best;
}

/** What would E do right now? Used by the FPS prompt and by `interact`. */
export function describeTarget(world: World, pawn: Pawn): InteractTarget {
  const px = Math.round(pawn.x);
  const py = Math.round(pawn.y);

  // Downed allies come first — you notice a body at your feet.
  for (const p of world.pawns) {
    if (p.id === pawn.id || p.dead || !p.downed || p.faction !== 'colony') continue;
    if (inArc(pawn, p.x, p.y)) {
      return { type: 'pawn', pawn: p, label: p.name, verb: `Tend ${p.name}` };
    }
  }
  for (const f of world.fires) {
    if (inArc(pawn, f.x, f.y)) {
      return { type: 'fire', x: f.x, y: f.y, label: 'Fire', verb: 'Beat out the flames' };
    }
  }
  if (pawn.carryingItemId !== null) {
    const it = findItem(world, pawn.carryingItemId);
    if (it) return { type: 'drop', label: `${it.amount} ${it.kind}`, verb: `Drop ${it.kind}` };
  }

  // Buildings: the cell in front, then the cell underfoot.
  const ahead: Array<[number, number]> = [
    [px + Math.round(Math.cos(pawn.facing)), py + Math.round(Math.sin(pawn.facing))],
    [px, py],
  ];
  for (const [bx, by] of ahead) {
    const b = buildingAt(world, bx, by);
    if (!b) continue;
    if (!inArc(pawn, b.x, b.y) && !(bx === px && by === py)) continue;
    const verb = verbForBuilding(world, pawn, b);
    if (verb) return { type: 'building', building: b, label: defOf(b.kind).label, verb };
  }

  const rock = rockAhead(pawn, world);
  if (rock) {
    const marked = world.cellDesig[packCell(world, rock.x, rock.y)] === DESIG_HARVEST;
    return {
      type: 'rock',
      x: rock.x,
      y: rock.y,
      label: 'Rock',
      verb: marked ? 'Keep mining' : 'Mine this rock',
    };
  }

  // Ground items within reach.
  let bestItem: ItemStack | null = null;
  let bestD = Infinity;
  for (const s of world.items) {
    if (s.carriedBy !== null) continue;
    if (!inArc(pawn, s.x, s.y)) continue;
    const d = dist(pawn.x, pawn.y, s.x, s.y);
    if (d < bestD) {
      bestItem = s;
      bestD = d;
    }
  }
  if (bestItem) {
    const edible = bestItem.kind === 'meal' || bestItem.kind === 'rawfood';
    return {
      type: 'item',
      item: bestItem,
      label: `${bestItem.amount} ${bestItem.kind}`,
      verb: edible ? `Eat ${bestItem.kind}` : `Pick up ${bestItem.kind}`,
    };
  }
  return null;
}

function pickUpByHand(world: World, pawn: Pawn, item: ItemStack): string {
  if (item.reservedBy !== null) {
    const other = world.jobs.find((j) => j.id === item.reservedBy);
    if (other) cancelJob(world, other.id);
  }
  item.carriedBy = pawn.id;
  item.reservedBy = null;
  pawn.carryingItemId = item.id;
  return `Picked up ${item.amount} ${item.kind}.`;
}

function dropByHand(world: World, pawn: Pawn): string {
  const it = findItem(world, pawn.carryingItemId);
  pawn.carryingItemId = null;
  if (!it) return 'Nothing to drop.';
  it.carriedBy = null;
  it.reservedBy = null;
  const x = Math.round(pawn.x);
  const y = Math.round(pawn.y);
  const merge = itemsAt(world, x, y).find((s) => s.id !== it.id && s.kind === it.kind && s.amount < MAX_STACK);
  if (merge) {
    const put = Math.min(MAX_STACK - merge.amount, it.amount);
    merge.amount += put;
    it.amount -= put;
    if (it.amount <= 0) {
      removeItem(world, it);
      return `Stacked ${put} ${merge.kind}.`;
    }
  }
  it.x = x;
  it.y = y;
  return `Dropped ${it.amount} ${it.kind}.`;
}

/**
 * Run the interaction. Returns a short line for the HUD, or null if there was
 * nothing to do. Most branches create a job — the same data a manager order makes.
 */
export function interact(world: World, pawn: Pawn): string | null {
  const t = describeTarget(world, pawn);
  if (!t) return null;

  const cancelCurrent = () => {
    if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
  };

  switch (t.type) {
    case 'drop': {
      // Drop first: cancelling the job would put the stack down for us, and then
      // there would be nothing left in hand to report.
      const line = dropByHand(world, pawn);
      cancelCurrent();
      return line;
    }

    case 'fire':
      cancelCurrent();
      createJob(world, pawn, 'firefight', t.x, t.y);
      return 'Beating out the flames.';

    case 'rock': {
      cancelCurrent();
      // Mark it as well as queue it, so the mark shows in the manager view and any
      // settler can finish the hole if the player wanders off mid-swing.
      world.cellDesig[packCell(world, t.x, t.y)] = DESIG_HARVEST;
      createJob(world, pawn, 'mine', t.x, t.y);
      return 'Mining.';
    }

    case 'pawn':
      cancelCurrent();
      createJob(world, pawn, 'doctor', Math.round(t.pawn.x), Math.round(t.pawn.y), {
        targetPawnId: t.pawn.id,
        stage: 'carry',
      });
      return `Tending ${t.pawn.name}.`;

    case 'item': {
      const it = t.item;
      if (it.kind === 'meal' || it.kind === 'rawfood') {
        cancelCurrent();
        const job = createJob(world, pawn, 'eat', it.x, it.y, { itemId: it.id, stage: 'goto' });
        it.reservedBy = job.id;
        return `Eating ${it.kind}.`;
      }
      if (pawn.carryingItemId !== null) {
        const line = dropByHand(world, pawn);
        cancelCurrent();
        return line;
      }
      cancelCurrent();
      const line = pickUpByHand(world, pawn, it);
      // If a stockpile wants it, queue the delivery leg so the body finishes the haul.
      const dest = findStockpileCell(world, it.kind, pawn);
      if (dest) {
        const job = createJob(world, pawn, 'haulToStockpile', dest.x, dest.y, {
          itemId: it.id,
          stage: 'deliver',
        });
        it.reservedBy = job.id;
      }
      return line;
    }

    case 'building': {
      const b = t.building;
      if (!b.built) {
        cancelCurrent();
        if (blueprintReady(b)) {
          createJob(world, pawn, 'build', b.x, b.y, { buildingId: b.id });
          return `Building the ${defOf(b.kind).label.toLowerCase()}.`;
        }
        const missing = (Object.keys(b.needs) as ResourceKind[]).find(
          (k) => (b.have[k] ?? 0) < (b.needs[k] ?? 0),
        );
        if (!missing) return null;
        const stack = world.items.find(
          (s) => s.kind === missing && s.carriedBy === null && s.reservedBy === null,
        );
        if (!stack) return `No ${missing} anywhere on the map.`;
        const job: Job = createJob(world, pawn, 'haulToBlueprint', stack.x, stack.y, {
          buildingId: b.id,
          itemId: stack.id,
          resource: missing,
          amount: (b.needs[missing] ?? 0) - (b.have[missing] ?? 0),
        });
        stack.reservedBy = job.id;
        return `Fetching ${missing}.`;
      }
      switch (b.kind) {
        case 'bed':
        case 'medbed':
          cancelCurrent();
          createJob(world, pawn, 'sleep', b.x, b.y, { buildingId: b.id });
          return 'Lying down.';
        case 'table': {
          cancelCurrent();
          const food = world.items.find(
            (s) => s.carriedBy === null && s.reservedBy === null && (s.kind === 'meal' || s.kind === 'rawfood'),
          );
          if (food) {
            const job = createJob(world, pawn, 'eat', food.x, food.y, { itemId: food.id });
            food.reservedBy = job.id;
            return 'Fetching a meal.';
          }
          createJob(world, pawn, 'recreate', b.x, b.y, { buildingId: b.id });
          return 'Taking a break.';
        }
        case 'stove': {
          cancelCurrent();
          const raw = world.items.find(
            (s) => s.kind === 'rawfood' && s.carriedBy === null && s.reservedBy === null && s.amount >= 8,
          );
          if (!raw) return 'No raw food to cook.';
          const job = createJob(world, pawn, 'cook', raw.x, raw.y, {
            itemId: raw.id,
            buildingId: b.id,
          });
          raw.reservedBy = job.id;
          return 'Cooking.';
        }
        case 'bench': {
          cancelCurrent();
          const plan = benchRecipe(world, pawn);
          if (!plan) return benchRefusal(world, pawn);
          const job = createJob(world, pawn, 'craft', plan.stack.x, plan.stack.y, {
            itemId: plan.stack.id,
            buildingId: b.id,
            recipe: plan.recipe,
            amount: plan.cost,
          });
          plan.stack.reservedBy = job.id;
          return `Making ${CRAFT_DEFS[plan.recipe].label}.`;
        }
        case 'lab': {
          const id = world.research.current;
          if (id === null) return 'Nothing chosen to study — pick a project first.';
          cancelCurrent();
          createJob(world, pawn, 'research', b.x, b.y, { buildingId: b.id });
          return `Studying ${RESEARCH[id].label}.`;
        }
        case 'fishhole': {
          if (!lakeHasFish(world)) return 'Nothing biting — the lake needs a few days.';
          cancelCurrent();
          createJob(world, pawn, 'fish', b.x, b.y, { buildingId: b.id });
          return iceBears(world) ? 'Cutting through the ice.' : 'Fishing.';
        }
        case 'tree': {
          cancelCurrent();
          world.cellDesig[packCell(world, b.x, b.y)] = DESIG_HARVEST;
          createJob(world, pawn, 'chop', b.x, b.y, { buildingId: b.id });
          return 'Chopping.';
        }
        default:
          return null;
      }
    }
  }
}

/** Hand-carry a resource straight into a blueprint you are standing next to. */
export function depositCarriedIntoBlueprint(world: World, pawn: Pawn): string | null {
  const it = findItem(world, pawn.carryingItemId);
  if (!it) return null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const b = buildingAt(world, Math.round(pawn.x) + dx, Math.round(pawn.y) + dy);
      if (!b || b.built) continue;
      const need = (b.needs[it.kind] ?? 0) - (b.have[it.kind] ?? 0);
      if (need <= 0) continue;
      const put = Math.min(need, it.amount);
      b.have[it.kind] = (b.have[it.kind] ?? 0) + put;
      it.amount -= put;
      if (it.amount <= 0) {
        pawn.carryingItemId = null;
        removeItem(world, it);
      }
      msg(world, `${pawn.name} delivered ${put} ${it.kind}.`);
      return `Delivered ${put} ${it.kind}.`;
    }
  }
  return null;
}

/** Drop whatever the body is holding — used when possession ends. */
export function dropAll(world: World, pawn: Pawn): void {
  if (pawn.carryingItemId === null) return;
  dropByHand(world, pawn);
}
