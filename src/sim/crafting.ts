/**
 * The recipe book — what a bench can make, and who is allowed to make it.
 *
 * Crafting used to be two hardcoded branches: anyone could make a rifle, anyone
 * could make medicine, and the only thing that varied was how fast. That is a
 * production queue, not a trade. It meant every colony on every seed could make
 * everything from the first hour, which quietly removed the reason to talk to
 * anybody — a neighbour four days' walk away is only worth the walk if they can
 * do something you cannot.
 *
 * So every recipe is now behind two different kinds of gate, and they fail in
 * different ways on purpose:
 *
 * - **Research** is a gate on the *colony*. It is a wall until it is gone, and
 *   then it is gone for good. Nobody can make field medicine until somebody has
 *   worked out how; after that, everybody can.
 * - **Skill** is a gate on the *person*. It is never gone: it moves around as
 *   settlers grow, get shot, and walk off to Ashfen with a pack. A colony of six
 *   might have exactly one person who can brew balm, and losing them is losing
 *   the recipe.
 *
 * That second one is what makes two colonies on the same seed different. Skills
 * are rolled per settler, so the colony that starts with a herbalist is a
 * medicine exporter and the one that starts with three miners is buying it from
 * strangers at a bad rate until somebody levels up. Neither is a worse colony;
 * they are colonies with different problems, which is the whole point.
 *
 * ## Two ways to qualify
 *
 * `alt` exists for one recipe and one reason. Healing balm is a poultice: you
 * either know medicine or you know plants, and a doctor who has never grown
 * anything and a herbalist who has never treated anybody can both make it. A
 * single skill floor would have made "can this colony make balm" a question
 * about one number, and the interesting version is that there are two doors into
 * the same room and most colonies have one of them.
 *
 * ## Where the gates are *not*
 *
 * Nothing here can take away something the colony could already do — the same
 * promise `LOCKED_BUILDINGS` makes in `research.ts`. The two recipes that existed
 * before this file did are the two whose gates are cheapest: rifles want
 * Toolmaking, which is the first project on the tree and has no prerequisites,
 * and medicine has a herbal fallback with no project at all. A colony that never
 * opens the research panel can still arm itself and still treat its wounded; it
 * just does both worse than one that does.
 */

import { EQUIP } from './gear';
import { hasResearch, RESEARCH, type ResearchId } from './research';
import { skillOf, SKILL_TITLE } from './skills';
import type { CraftRecipe, EquipKind, Pawn, ResourceKind, SkillName, World } from './types';
import { livingColonists } from './world';

/** A skill floor: this much of this, to be allowed to start. */
export interface SkillGate {
  skill: SkillName;
  level: number;
}

export interface CraftDef {
  id: CraftRecipe;
  /** What the thing is called, in a sentence. Lower case; callers capitalise. */
  label: string;
  /** The verb the E-key prompt uses. "Brew healing balm". */
  verb: string;
  /** What a settlement known for this is known *for*. "brews healing balm". */
  trade: string;
  /** What it eats, and how much before Machining's discount. */
  input: { kind: ResourceKind; cost: number };
  /** Work units at rate 1. `workRate` scales it by skill and mood. */
  work: number;
  /** The skill the work is done with, levelled by finishing it, and gated on. */
  gate: SkillGate;
  /** A second way to qualify, for recipes two trades both know. */
  alt?: SkillGate;
  /** The project that has to be done first, if any. */
  research?: ResearchId;
  /**
   * What comes out. A stack on the floor, or the maker walks away holding it —
   * the two shapes crafting has ever had, now written down instead of branched on.
   */
  output: { kind: ResourceKind; amount: number } | { weapon: 'rifle' } | { equip: EquipKind };
  /** Experience for one finished piece. */
  xp: number;
}

/**
 * Every recipe, in the order a colony meets them.
 *
 * The numbers are the ones the thirty-day sweeps were balanced against, moved as
 * little as the gates allowed. Rifles and medicine kept their old costs, work and
 * yields exactly; only the permission to make them is new.
 */
export const CRAFT_DEFS: Record<CraftRecipe, CraftDef> = {
  /**
   * The herbal road to medicine, and the only recipe with no project behind it.
   *
   * It exists so that gating the medicine kit does not simply delete a colony's
   * ability to treat wounds on day one — see the note at the top of this file. It
   * is deliberately the worse deal: more raw food per unit, and two out instead of
   * three. What it buys is that *somebody* can almost always make it.
   */
  balm: {
    id: 'balm',
    label: 'healing balm',
    verb: 'Brew healing balm',
    trade: 'brews healing balm',
    input: { kind: 'rawfood', cost: 12 },
    work: 170,
    gate: { skill: 'plants', level: 5 },
    alt: { skill: 'medicine', level: 4 },
    output: { kind: 'medicine', amount: 2 },
    xp: 0.3,
  },
  /**
   * The proper article. Behind Field Medicine and a genuine doctor, and worth
   * both: half again the yield of balm on less raw food.
   */
  medicine: {
    id: 'medicine',
    label: 'medicine',
    verb: 'Make medicine',
    trade: 'mixes proper medicine',
    input: { kind: 'rawfood', cost: 10 },
    work: 200,
    gate: { skill: 'medicine', level: 6 },
    research: 'fieldmedicine',
    output: { kind: 'medicine', amount: 3 },
    xp: 0.2,
  },
  /**
   * Toolmaking is the cheapest project on the tree and needs nothing before it,
   * so this is a gate measured in hours rather than days — which is the right
   * weight for the thing that stops raids escalating past the colony.
   */
  rifle: {
    id: 'rifle',
    label: 'a rifle',
    verb: 'Make yourself a rifle',
    trade: 'makes rifles',
    input: { kind: 'steel', cost: 35 },
    work: 300,
    gate: { skill: 'construction', level: 5 },
    research: 'toolmaking',
    output: { weapon: 'rifle' },
    xp: 0.2,
  },
  /**
   * Packed rations. Exactly the stove's conversion — twenty raw for ten meals,
   * same as five batches — and that is deliberate: a recipe that turned food into
   * *more* food than cooking does would be a loop the trade systems spend a lot of
   * care not to have. What it saves is a cook's afternoon, at three hundred work
   * for ten meals against the stove's eight-fifty, which is what the project paid
   * for.
   */
  rations: {
    id: 'rations',
    label: 'packed rations',
    verb: 'Pack rations',
    trade: 'packs rations',
    input: { kind: 'rawfood', cost: 20 },
    work: 300,
    gate: { skill: 'cooking', level: 6 },
    research: 'preserves',
    output: { kind: 'meal', amount: 10 },
    xp: 0.25,
  },

  // The wardrobe. Every one of these is worn by the settler who made it — the
  // rifle's contract, for the rifle's reason: nobody should have to haul a coat
  // across the map to put it on somebody else, and "you keep what you build" is
  // a rule the player learns once.
  //
  // The gates are split across two trades on purpose. Leatherwork is a builder's
  // job here and a forager's second trade; the parka is the other way round,
  // because lining and stitching a coat is closer to what a herbalist does with
  // their hands than to what a carpenter does. Which means the colony that can
  // armour itself and the colony that can dress for winter are often not the
  // same colony — the same fork `balm` and `medicine` opened, one tier up.
  jerkin: {
    id: 'jerkin',
    label: 'a leather jerkin',
    verb: 'Cut yourself a jerkin',
    trade: 'cuts leather jerkins',
    input: { kind: 'hide', cost: 16 },
    work: 220,
    gate: { skill: 'construction', level: 3 },
    alt: { skill: 'plants', level: 5 },
    research: 'tanning',
    output: { equip: 'jerkin' },
    xp: 0.25,
  },
  parka: {
    id: 'parka',
    label: 'a fur parka',
    verb: 'Stitch yourself a parka',
    trade: 'stitches fur parkas',
    input: { kind: 'hide', cost: 28 },
    work: 300,
    gate: { skill: 'plants', level: 6 },
    alt: { skill: 'construction', level: 7 },
    research: 'weaving',
    output: { equip: 'parka' },
    xp: 0.3,
  },
  plate: {
    id: 'plate',
    label: 'a suit of steel plate',
    verb: 'Beat out a suit of plate',
    trade: 'beats out steel plate',
    input: { kind: 'steel', cost: 45 },
    work: 420,
    gate: { skill: 'construction', level: 9 },
    research: 'plateworks',
    output: { equip: 'plate' },
    xp: 0.35,
  },

  // The other slot. Both are cheap, both are early, and neither is worth an
  // afternoon during a raid — which is exactly the shape a quality-of-life item
  // should have: something the colony makes on a quiet day and is quietly better
  // at everything for.
  toolbelt: {
    id: 'toolbelt',
    label: 'a toolbelt',
    verb: 'Make yourself a toolbelt',
    trade: 'makes toolbelts',
    input: { kind: 'hide', cost: 12 },
    work: 200,
    gate: { skill: 'construction', level: 4 },
    research: 'tanning',
    output: { equip: 'toolbelt' },
    xp: 0.2,
  },
  medkit: {
    id: 'medkit',
    label: "a doctor's bag",
    verb: 'Put together a doctor’s bag',
    trade: 'puts together doctor’s bags',
    input: { kind: 'hide', cost: 10 },
    work: 240,
    gate: { skill: 'medicine', level: 5 },
    research: 'tanning',
    output: { equip: 'medkit' },
    xp: 0.25,
  },
};

/**
 * The order the bench considers them, and the order the player reads them.
 *
 * Rifle first because an unarmed settler is the shortage that ends colonies, and
 * that was the order the work board used before recipes had gates — worth keeping
 * exactly, so the sweeps stay comparable across this change. Medicine ahead of
 * balm so a colony which has earned the better recipe uses it: the herbal one is
 * a fallback, not a choice. Rations last; they are what a colony does with a
 * harvest it cannot eat.
 */
export const RECIPE_ORDER: CraftRecipe[] = [
  'rifle',
  'medicine',
  'balm',
  // Armour above the bags, and both above rations: a settler who is cold or
  // unarmoured is a settler the colony is about to lose, and the ration press is
  // what somebody does with a harvest. Plate last of the three because it is the
  // one a colony makes deliberately, not the one the work board should reach for
  // the moment forty-five steel is lying about.
  'jerkin',
  'parka',
  'toolbelt',
  'medkit',
  'plate',
  'rations',
];

/** What a finished piece puts into the world, as a resource, if it is one. */
export function outputKind(def: CraftDef): ResourceKind | null {
  return 'kind' in def.output ? def.output.kind : null;
}

/** What a finished piece equips the maker with, if it is one of those. */
export function outputEquip(def: CraftDef): EquipKind | null {
  return 'equip' in def.output ? def.output.equip : null;
}

/** The recipe that makes this piece of kit, if any. The card's "how do I get one". */
export function recipeForEquip(kind: EquipKind): CraftRecipe | null {
  return RECIPE_ORDER.find((r) => outputEquip(CRAFT_DEFS[r]) === kind) ?? null;
}

/**
 * What one of these is, as a phrase for a message: "a fur parka".
 *
 * Reads the equipment book rather than the recipe label so the two can never
 * disagree about what the thing is called — the recipe's label is a *recipe*
 * name and is allowed to be the verb-ish version.
 */
export function equipPhrase(kind: EquipKind): string {
  return EQUIP[kind].label;
}

/**
 * "10 meals", "2 medicine".
 *
 * Only `meal` counts in the plural; the rest are mass nouns and "3 medicines"
 * reads like a pharmacy. Worth the four lines: the finished-craft message names
 * both the recipe and what actually landed on the floor, and those are different
 * things — balm is a recipe, and what you get out of it is medicine.
 */
export function yieldPhrase(kind: ResourceKind, amount: number): string {
  return `${amount} ${kind === 'meal' && amount !== 1 ? 'meals' : kind}`;
}

/**
 * Which skill this settler actually works this recipe with.
 *
 * The recipe's own skill, unless they came through the other door and are better
 * at that one — a doctor brewing balm works at their medicine and gets better at
 * medicine, because that is what they are doing. Gating on either skill while
 * paying out in only one would have quietly told every doctor in the game to take
 * up gardening.
 */
export function craftSkill(pawn: Pawn, recipe: CraftRecipe): SkillName {
  const def = CRAFT_DEFS[recipe];
  if (!def.alt) return def.gate.skill;
  const primary = skillOf(pawn, def.gate.skill) >= def.gate.level;
  const alt = skillOf(pawn, def.alt.skill) >= def.alt.level;
  if (primary && alt) {
    return skillOf(pawn, def.alt.skill) > skillOf(pawn, def.gate.skill) ? def.alt.skill : def.gate.skill;
  }
  return alt ? def.alt.skill : def.gate.skill;
}

/** Has the colony worked out how to do this at all? */
export function recipeResearched(world: World, recipe: CraftRecipe): boolean {
  const gate = CRAFT_DEFS[recipe].research;
  return gate === undefined || hasResearch(world, gate);
}

/** Does this settler know the trade? Either door counts. */
export function pawnQualified(pawn: Pawn, recipe: CraftRecipe): boolean {
  const def = CRAFT_DEFS[recipe];
  if (skillOf(pawn, def.gate.skill) >= def.gate.level) return true;
  return def.alt !== undefined && skillOf(pawn, def.alt.skill) >= def.alt.level;
}

/** Research done *and* this settler qualified. What the work board asks. */
export function canCraft(world: World, pawn: Pawn, recipe: CraftRecipe): boolean {
  return recipeResearched(world, recipe) && pawnQualified(pawn, recipe);
}

/**
 * The colony's best hand for a recipe, or null if nobody here can make it.
 *
 * Downed settlers count. Losing the only doctor to a raid should read as "we
 * cannot make medicine until she is back up", not as the recipe vanishing off
 * the board — the player needs to be able to tell the difference between a gap
 * they can fix with a bed and one they can only fix with a caravan.
 */
export function bestCrafter(world: World, recipe: CraftRecipe): Pawn | null {
  const def = CRAFT_DEFS[recipe];
  let best: Pawn | null = null;
  let bestLevel = -1;
  for (const p of livingColonists(world)) {
    if (!pawnQualified(p, recipe)) continue;
    const level = Math.max(
      skillOf(p, def.gate.skill),
      def.alt ? skillOf(p, def.alt.skill) : -1,
    );
    if (level > bestLevel) {
      best = p;
      bestLevel = level;
    }
  }
  return best;
}

/**
 * Can this colony make this thing at all, today, with the people it has?
 *
 * The question the trade panel asks, and the reason a caravan is worth loading:
 * a colony that answers no to `balm` is a colony that buys medicine.
 */
export function colonyCanCraft(world: World, recipe: CraftRecipe): boolean {
  return recipeResearched(world, recipe) && bestCrafter(world, recipe) !== null;
}

function gateText(gate: SkillGate): string {
  return `a ${SKILL_TITLE[gate.skill]} at ${gate.level}`;
}

/**
 * The skill floor a recipe wants, as a bare phrase: "a herbalist at 5 or a
 * doctor at 4".
 *
 * `craftBlocker` wraps this in "nobody here is …" because a greyed row is
 * answering "why not". A caller reporting that the colony has *lost* a trade
 * already said "nobody here" in its own sentence and only wants the gate.
 */
export function gateWords(recipe: CraftRecipe): string {
  const def = CRAFT_DEFS[recipe];
  return def.alt ? `${gateText(def.gate)} or ${gateText(def.alt)}` : gateText(def.gate);
}

/**
 * Why this recipe is not available, as a sentence, or null if it is.
 *
 * Every refusal in this game comes back as prose the panel can repeat verbatim —
 * the same contract `planCaravan` keeps. A greyed-out row that does not say why
 * is a bug report waiting to happen, and "needs a doctor at 6" is a thing the
 * player can go and do something about.
 *
 * Pass a settler to ask about them specifically; pass null to ask about the
 * colony, which is the question the workbench panel wants.
 */
export function craftBlocker(world: World, pawn: Pawn | null, recipe: CraftRecipe): string | null {
  const def = CRAFT_DEFS[recipe];
  if (def.research && !hasResearch(world, def.research)) {
    return `needs ${RESEARCH[def.research].label}`;
  }
  const doors = gateWords(recipe);
  if (pawn) return pawnQualified(pawn, recipe) ? null : `needs ${doors}`;
  return bestCrafter(world, recipe) ? null : `nobody here is ${doors}`;
}

/**
 * What a project puts on the workbench, as a phrase for the research panel.
 *
 * A gate nobody can see is a bug wearing a feature's coat: without this the
 * player reads "Toolmaking — better axes and picks", spends six thousand points
 * on it, and only finds out it was also the thing standing between them and a
 * rifle by walking a settler to the bench afterwards. Derived from the recipe
 * book, so a recipe that changes its prerequisite cannot leave a stale promise
 * behind in a hand-written blurb.
 */
export function unlockedBy(id: ResearchId): string | null {
  const made = RECIPE_ORDER.filter((r) => CRAFT_DEFS[r].research === id).map(
    (r) => CRAFT_DEFS[r].label,
  );
  if (made.length === 0) return null;
  const list =
    made.length === 1 ? made[0]! : `${made.slice(0, -1).join(', ')} and ${made[made.length - 1]!}`;
  return `Unlocks ${list} at the workbench.`;
}
