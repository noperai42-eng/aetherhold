/**
 * Test helper: hand a settler the trade a recipe asks for.
 *
 * Recipes are gated on research the colony has done and skill the settler has —
 * see `sim/crafting.ts`. Most of the bench tests are about something else
 * entirely (which recipe the chooser picks, whether a stack is big enough, what
 * Machining does to the bill), and were written when anyone could make anything.
 * Rather than water those tests down to the day-one skill floor, this gives their
 * fixture settler the qualification and leaves the assertions saying what they
 * always said.
 *
 * Used by the tests that are *not* about the gates. The ones that are set the
 * skills by hand, so a change to a gate shows up there as a failure rather than
 * being silently papered over here.
 */

import { CRAFT_DEFS } from '../src/sim/crafting';
import type { CraftRecipe, Pawn, World } from '../src/sim/types';

/** Grant the projects and the skill floors these recipes need. */
export function qualify(world: World, pawn: Pawn, ...recipes: CraftRecipe[]): Pawn {
  for (const recipe of recipes) {
    const def = CRAFT_DEFS[recipe];
    if (def.research && !world.research.done.includes(def.research)) {
      world.research.done.push(def.research);
    }
    pawn.skills[def.gate.skill] = Math.max(pawn.skills[def.gate.skill], def.gate.level);
  }
  return pawn;
}

/** The same, for everybody still standing — for tests the work board drives. */
export function qualifyAll(world: World, ...recipes: CraftRecipe[]): void {
  for (const p of world.pawns) {
    if (p.faction === 'colony' && !p.dead) qualify(world, p, ...recipes);
  }
}
