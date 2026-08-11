/**
 * What this colony knows how to make, and telling the player when that changes.
 *
 * `crafting.ts` makes a promise in its own header: a skill gate is a gate on a
 * *person*, so "a colony of six might have exactly one person who can brew balm,
 * and losing them is losing the recipe." That is the most interesting sentence
 * in the file and until now nothing said it out loud. A raid took the herbalist,
 * the workbench quietly started refusing balm, and the only way to find out was
 * to walk over and read a greyed row — days later, usually while looking for
 * something else.
 *
 * So the colony watches its own capabilities and reports three moments:
 *
 * - **Learned.** Somebody levelled into a trade nobody here had, or a project
 *   finished and now there is a hand for it. This is the payoff for the whole
 *   research-and-skills arc and it deserves a headline.
 * - **Lost.** Nobody left can make a thing the colony could make yesterday, and
 *   the message names the gate so the player knows what to go and fix — grow
 *   somebody into it, or buy the goods from a neighbour who has one.
 * - **Down to one.** Still fine, but one bad afternoon from not fine. This is
 *   the warning that makes a player put their only doctor behind the wall.
 *
 * ## What it deliberately does not report
 *
 * A settler on the road is not a settler lost. `settlements.ts` moves a caravan
 * pawn out of `world.pawns` for the round trip, so the colony's hands genuinely
 * drop while they are away and come back when they return — diffing across that
 * would announce a lost recipe every time anybody walked to Ashfen and a
 * recovered one four days later. The pass simply holds still while a caravan is
 * out; if the traveller never comes home, the loss is reported then, which is
 * also when it became true.
 *
 * Downed settlers still count, because `bestCrafter` counts them: an unconscious
 * doctor is a bed problem, not a trade the colony has forgotten.
 *
 * Draws no rng, by construction. Every seed's weather and herds have to stay
 * exactly where they were.
 */

import { CRAFT_DEFS, RECIPE_ORDER, bestCrafter, colonyCanCraft, gateWords, pawnQualified } from './crafting';
import { caravansOf } from './settlements';
import { msg, livingColonists } from './world';
import type { CraftRecipe, World } from './types';
import { remember } from './lifelog';

/** How often the colony takes stock. Cheap — four recipes against a handful of people. */
export const KNOWHOW_INTERVAL = 40;

function handsFor(world: World, recipe: CraftRecipe): number {
  let n = 0;
  for (const p of livingColonists(world)) if (pawnQualified(p, recipe)) n++;
  return n;
}

/**
 * The colony's standing on every recipe right now.
 *
 * Exported because the tests want to state the before and after in the same
 * terms the pass does, rather than reaching into `world.knowhow` and trusting
 * that it was written when they think it was.
 */
export function knowhowNow(world: World): {
  hands: Partial<Record<CraftRecipe, number>>;
  can: Partial<Record<CraftRecipe, boolean>>;
} {
  const hands: Partial<Record<CraftRecipe, number>> = {};
  const can: Partial<Record<CraftRecipe, boolean>> = {};
  for (const r of RECIPE_ORDER) {
    hands[r] = handsFor(world, r);
    can[r] = colonyCanCraft(world, r);
  }
  return { hands, can };
}

/**
 * One pass of the colony noticing what it can and cannot do.
 *
 * The first call on any world — new, or loaded from a save written before this
 * existed — only records. A colony that has just been read off a disk has not
 * learned anything, and announcing four recipes at once on load would be the
 * loudest possible way of saying nothing happened.
 */
export function tickKnowhow(world: World): void {
  if (world.tick % KNOWHOW_INTERVAL !== 0) return;
  // Somebody is on the road with a pack. Hold still; see the header. Any party
  // at all, not the first one — the reason to wait is that goods in transit are
  // goods the colony does not have yet, and a second pack is more of that, not
  // less.
  if (caravansOf(world).length > 0) return;

  const now = knowhowNow(world);
  const prev = world.knowhow;
  if (!prev) {
    world.knowhow = now;
    return;
  }

  for (const r of RECIPE_ORDER) {
    const def = CRAFT_DEFS[r];
    const wasHands = prev.hands[r] ?? 0;
    const wasCan = prev.can[r] ?? false;
    const hands = now.hands[r] ?? 0;
    const can = now.can[r] ?? false;

    // `trade` and not `verb`: the verb is the E-key prompt and is written at the
    // settler holding the mouse — "Make yourself a rifle". These are sentences
    // about somebody else, so they want the third person the neighbour blurbs
    // already use, and "nobody here makes rifles any more" agrees with it too.
    if (can && !wasCan) {
      const who = bestCrafter(world, r);
      // `label` and not `trade` here, because a life-log line is past tense and
      // `trade` is present ("brews healing balm"). The noun takes the tense out
      // of the recipe's hands: "became the first here who could make healing
      // balm." Nothing is written on the pass that only records, so a colony that
      // starts able to brew balm has nobody who *became* anything — which is
      // right, they always could.
      if (who) remember(world, who, `became the first here who could make ${def.label}`);
      msg(
        world,
        who ? `${who.name} ${def.trade} now. Nobody here could before.` : `Somebody here ${def.trade} now.`,
        'good',
        { headline: true },
      );
    } else if (!can && wasCan) {
      // Name the gate, not the absence. "Nobody can brew balm" is a fact the
      // player can do nothing with; "it wants a herbalist at 5 or a doctor at 4"
      // is a thing to grow somebody into or buy from a neighbour who has one.
      //
      // Always the skill gate, never the research one: research is monotonic, so
      // a recipe the colony could make yesterday has its project done for good
      // and the only thing that can have gone is the people.
      msg(world, `Nobody here ${def.trade} any more — it wants ${gateWords(r)}.`, 'bad', { headline: true });
    } else if (can && hands === 1 && wasHands > 1) {
      const who = bestCrafter(world, r);
      if (who) msg(world, `${who.name} is the only one here who ${def.trade}.`, 'info');
    }
  }

  world.knowhow = now;
}
