/**
 * Putting back what the colony loses.
 *
 * A building that burns down or is shot to pieces used to simply vanish, with no
 * message and nothing left behind. In a twenty-four day headless run on seed 1337
 * the wood generator caught fire on day four; the colony never noticed, never
 * rebuilt it, and spent the remaining twenty days in the dark with a cooler full
 * of rotting meat. A player watching the screen would have seen it. A colony that
 * has to be babysat for every wall a raider knocks out is not a colony sim.
 *
 * So: anything the colony finished building and then lost to damage leaves an
 * intent behind — a plan to put it back. The plan becomes an ordinary blueprint
 * the moment it is safe to stand there, and from that point on it is exactly the
 * same object as one the player placed by hand: it needs the same materials, it
 * is picked up by the same construct work type, and `Backspace` cancels it.
 *
 * Two reasons a plan waits rather than materialising at once, and both are bugs
 * that the waiting fixes:
 *
 *   - **Fire.** A blueprint dropped onto a cell that is still burning is damaged
 *     by the same pass that just destroyed the wall, and blueprints start at a
 *     quarter of their hit points. It would be destroyed within a tick or two —
 *     and because a destroyed *blueprint* plans nothing (see `planRebuild`), the
 *     colony would quietly lose the intent it had just formed.
 *   - **Raiders.** A settler will walk to the nearest blueprint and stand in the
 *     open working on it. Materialising a wall the instant a raider blows it open
 *     sends an unarmed carpenter into the breach, in the middle of the firefight,
 *     to patch it while being shot at.
 *
 * Deliberately *not* covered: deconstruction and the cancel tool. Both go
 * straight to `removeBuilding` without passing through `damageBuilding`, so a
 * building the player took down on purpose stays down. That separation is the
 * whole safety property here, and it is why this hangs off the damage path
 * rather than off removal.
 */

import { defOf } from './buildings';
import { buildingAt, dist } from './grid';
import { addBuilding, hostiles, msg } from './world';
import type { Building, RebuildPlan, World } from './types';

/**
 * How close a live raider has to be before the colony leaves the gap alone. Eight
 * cells is a little over the range at which a raider will open up on a settler, so
 * the carpenter is sent in once the fight has moved on rather than while it is on
 * top of them.
 */
const DANGER_RADIUS = 8;

/**
 * A ceiling on outstanding intent. A firestorm through a big colony can take out
 * more than a hundred cells, and every one of them is a blueprint somebody has to
 * haul wood to. Past this the oldest plans are dropped: the colony rebuilds what
 * it lost most recently and forgets the rest, which is the same thing a player
 * does when they come back to a burnt-out wing.
 */
const MAX_PLANS = 150;

export function rebuildPlans(world: World): RebuildPlan[] {
  // Optional on `World` so a colony saved before this existed still loads; it is
  // filled in on the first tick after the load, same as the trade state.
  return (world.rebuilds ??= []);
}

/**
 * Called from `damageBuilding` the moment a building's hit points run out, while
 * it is still standing in the world. Records the colony's intent to put it back.
 */
export function planRebuild(world: World, b: Building): void {
  // A blueprint that is destroyed is not planned again. It is the loop-breaker
  // for the burning-cell case above, and it is also just correct: the colony did
  // not lose a building, it lost an intention, and re-forming it every tick while
  // the fire is still on the cell would be an infinite supply of wasted timber.
  if (!b.built) return;
  // Trees and rock faces are buildings to the collision code and to nobody else.
  if (!defOf(b.kind).buildable) return;
  const plans = rebuildPlans(world);
  if (plans.some((p) => p.x === b.x && p.y === b.y)) return;
  plans.push({ kind: b.kind, x: b.x, y: b.y, tick: world.tick });
  if (plans.length > MAX_PLANS) plans.splice(0, plans.length - MAX_PLANS);
  // A row of five burning walls collapsing on the same tick is one event to a
  // player, not five. Consecutive identical lines are folded rather than counted,
  // which is enough: the interesting case is always "the same thing, repeatedly".
  const text = `${defOf(b.kind).label} destroyed — it will be rebuilt.`;
  const last = world.messages[world.messages.length - 1];
  if (!last || last.text !== text) msg(world, text, 'bad');
}

/** Forget the colony's intent to rebuild this cell. The cancel tool's other half. */
export function forgetRebuild(world: World, x: number, y: number): boolean {
  const plans = rebuildPlans(world);
  const i = plans.findIndex((p) => p.x === x && p.y === y);
  if (i < 0) return false;
  plans.splice(i, 1);
  return true;
}

/**
 * Turn whatever intent is now safe to act on into real blueprints. Runs after the
 * fire pass so a cell that stopped burning this tick is already clear.
 */
export function tickRebuild(world: World): void {
  const plans = rebuildPlans(world);
  if (plans.length === 0) return;
  const threats = hostiles(world).filter((p) => !p.downed);
  for (let i = plans.length - 1; i >= 0; i--) {
    const plan = plans[i]!;
    // Somebody got there first — the player put something else on the cell, or
    // rebuilt it by hand. Either way the colony has no outstanding intent here.
    if (buildingAt(world, plan.x, plan.y)) {
      plans.splice(i, 1);
      continue;
    }
    if (world.fires.some((f) => f.x === plan.x && f.y === plan.y)) continue;
    if (threats.some((p) => dist(p.x, p.y, plan.x, plan.y) < DANGER_RADIUS)) continue;
    // `built: false` — the colony pays for it again in materials and in work.
    // Losing a generator should cost something; this is where it costs.
    if (addBuilding(world, plan.kind, plan.x, plan.y, false)) plans.splice(i, 1);
  }
}
