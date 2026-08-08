/**
 * Deadfall traps: the defence you build before you can afford a turret.
 *
 * A trap is a normal building with `solid: false`, so it changes nothing about
 * the grid — raiders walk over it because it is the cheapest route, not because
 * anything steered them onto it. That is the whole design: the player shapes
 * where an attack has to walk (a corridor, a gate, the one gap in a fence) and
 * then makes that ground expensive.
 *
 * Two rules do all the work:
 *
 * 1. **Only hostiles spring one.** The colony built the things and knows where
 *    they are, so a settler hauling wood across their own killbox steps over the
 *    trigger. The alternative — a chance to maim your own people, and an A\* that
 *    has to know which faction is asking — buys a failure mode the player cannot
 *    see coming and cannot plan around, in exchange for no decision they would
 *    make differently. The price of a trap is the wood, the labour, and the fact
 *    that it fires exactly once.
 *
 * 2. **A sprung trap is a blueprint again**, not a corpse. `built = false` hands
 *    it straight back to the job system, which hauls fresh timber out and re-arms
 *    it, and the cell never stops being a trap — so a player who lined a corridor
 *    once does not have to re-draw it after every raid.
 */

import { damagePawn, isHostileTo } from './combat';
import { defOf } from './buildings';
import { msg } from './world';
import type { Rng } from './rng';
import type { Building, Pawn, World } from './types';
import { markBuildingsChanged } from './types';

/** What a deadfall does to whoever walked under it. Enough to matter, short of a kill. */
export const TRAP_DAMAGE_MIN = 55;
export const TRAP_DAMAGE_MAX = 85;

export function isTrap(b: Building): boolean {
  return b.kind === 'trap';
}

/** Armed means built: an unfinished or sprung trap is a blueprint and harmless. */
export function trapArmed(b: Building): boolean {
  return b.kind === 'trap' && b.built;
}

/**
 * Spring every armed trap a hostile is standing on.
 *
 * Runs immediately after the combat pass, which is where raiders move, so a
 * raider who stepped onto the trigger this tick is hit on this tick rather than
 * getting a free tick of shooting first.
 */
/**
 * Whose weight sets one off: anything that came to take something from you.
 *
 * Rule 1 above says "only hostiles", and a fenwolf is not hostile — the fauna
 * faction is at war with nobody, which is what keeps a turret from wasting steel
 * on a passing hare. But the reason for the rule is not the faction table, it is
 * that the colony knows where its own traps are and the things it built them for
 * do not. A pack coming down the fence line for the goats is squarely the second
 * category, and a player who lined the pen gate with deadfalls and then watched
 * six wolves stroll over them would be right to think the traps were broken.
 *
 * `hunts` rather than `faction === 'fauna'`, so it stays the pack and not the
 * herd: a mossback grazing across a killbox is not attacking anything, and a
 * deadfall that fired on one would turn every trap line into a thing the player
 * has to disarm before the map can have deer on it.
 */
function springsFor(p: Pawn): boolean {
  return isHostileTo(p.faction, 'colony') || p.hunts === true;
}

export function tickTraps(world: World, rng: Rng): void {
  // Traps are rare compared to pawns, so walk them and look up who is standing
  // there rather than asking every pawn whether it is on one.
  for (const b of world.buildings) {
    if (!trapArmed(b)) continue;
    for (const p of world.pawns) {
      if (p.dead || p.downed) continue; // a body being carried does not set it off
      if (!springsFor(p)) continue;
      if (Math.round(p.x) !== b.x || Math.round(p.y) !== b.y) continue;
      spring(world, b, p, rng);
      break;
    }
  }
}

function spring(world: World, b: Building, victim: Pawn, rng: Rng): void {
  const def = defOf('trap');
  b.built = false;
  markBuildingsChanged(world);
  b.work = 0;
  b.workLeft = def.work;
  b.needs = { ...def.cost };
  b.have = {};
  b.hp = Math.max(1, Math.round(def.hp * 0.25));
  damagePawn(world, victim, rng.range(TRAP_DAMAGE_MIN, TRAP_DAMAGE_MAX), 'deadfall trap');
  // Only worth a line when it did not already produce one. `damagePawn` announces
  // a downing and a death itself, and three messages for one thud reads as noise.
  if (!victim.dead && !victim.downed) msg(world, `A deadfall catches ${victim.name}.`, 'good');
}
