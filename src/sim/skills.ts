/**
 * Skills — one place that knows how a settler gets better at something.
 *
 * Every job in the game used to hand out its own experience inline, as
 * `pawn.skills.cooking = Math.min(20, pawn.skills.cooking + 0.2)`, in fifteen
 * places. That worked, and it was invisible: a settler crossed from four to five
 * without a word, so the one number that decides who is worth sending to the
 * bench moved only when the player happened to open a card and read it. A skill
 * nobody is told about is a stat, not a story.
 *
 * So the award goes through here instead. Same clamp, same amounts — this is not
 * a balance change on its own — but crossing a whole number now says so, and
 * crafting can ask for the second way to learn a trade: not by grinding out the
 * fraction, but by working something out at the bench.
 *
 * ## Why the breakthrough does not draw from the random streams
 *
 * The three shared streams are load-bearing. `makePawn` is handed worldgen's,
 * wildlife's and the storyteller's, and one extra draw taken inside a loop that
 * runs per body silently re-rolls every map, every herd and every deal the
 * trader ever offered — the trap `backfillTraits` and `backfillSkills` were both
 * written to get out of. A craft finishing is exactly that shape of event: it
 * happens on some ticks and not others, depending on how the colony is doing.
 *
 * So the chance is not drawn at all. It is *hashed* — from the map seed, the
 * settler, the tick and the skill — which is a pure function of state the caller
 * already has. The same colony on the same seed gets the same breakthroughs, no
 * stream advances, and the balance sweeps stay comparable across the change.
 */

import { learnRateScale } from './research';
import type { Pawn, SkillName, World } from './types';
import { msg } from './world';

/** Nobody gets better than this. Every award site in the sim agreed on it already. */
export const SKILL_CAP = 20;

/**
 * What somebody who is good at this is *called*.
 *
 * For messages only — the settler card prints the bare skill name, because a
 * column of nouns does not line up and does not sort. But "Dara is now a level 5
 * herbalist" is a sentence, and "Dara is now level 5 plants" is a spreadsheet.
 */
export const SKILL_TITLE: Record<SkillName, string> = {
  construction: 'builder',
  cooking: 'cook',
  plants: 'herbalist',
  mining: 'miner',
  shooting: 'shot',
  medicine: 'doctor',
  research: 'researcher',
  social: 'talker',
};

/** A settler's level in something, tolerating a save written before it existed. */
export function skillOf(pawn: Pawn, skill: SkillName): number {
  return pawn.skills?.[skill] ?? 0;
}

/**
 * The odds a finished craft teaches a whole level outright.
 *
 * Small on purpose. The fraction is still the main road — this is the settler
 * who has been at the bench all week and finally sees how the thing goes
 * together, which should be a moment the player remembers rather than a tick of
 * the same clock. At one in twenty-five, a colony doing steady bench work sees
 * one every few days, and it is never the plan.
 */
export const BREAKTHROUGH_CHANCE = 0.04;

/**
 * A number in [0, 1) from state the caller already has.
 *
 * Deliberately *not* a random draw — see the note at the top of this file. FNV-ish
 * over the four inputs, then a final avalanche so neighbouring ticks do not give
 * neighbouring answers; without it, consecutive crafts by the same settler come
 * out as a slowly rising ramp and the breakthrough arrives on a timer.
 */
function roll(world: World, pawn: Pawn, skill: SkillName, salt: number): number {
  let h = 2166136261 ^ world.seed;
  h = Math.imul(h ^ pawn.id, 16777619);
  h = Math.imul(h ^ world.tick, 16777619);
  h = Math.imul(h ^ salt, 16777619);
  for (let i = 0; i < skill.length; i++) h = Math.imul(h ^ skill.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * How much somebody *cares* about a trade. 0 nothing, 1 interested, 2 burning.
 *
 * The single biggest thing missing from skills before this: a settler was a row
 * of eight numbers that all moved at the same speed, so the colony's cook was
 * whoever happened to stand at the stove first and stayed there. Nobody had a
 * calling. Passion is what makes a settler's card worth reading before you decide
 * who does what — the miner who is *interested* in medicine is a doctor waiting
 * for the colony to notice.
 *
 * Rolled once, off the seed and the settler, and never stored. See
 * `passionRoll` for why it is a hash and not a draw.
 */
export type Passion = 0 | 1 | 2;

/** What each passion multiplies learning by. */
const PASSION_RATE: Record<Passion, number> = { 0: 1, 1: 1.5, 2: 2.2 };

/** What the card calls it. Empty for the common case, which prints nothing. */
export const PASSION_LABEL: Record<Passion, string> = { 0: '', 1: 'interested', 2: 'burning' };

/** Odds of each, from the top down: burning first, then interested. */
const BURNING_AT = 0.12;
const INTERESTED_AT = 0.34;

/**
 * A settler's passion for a trade — stable for their whole life, on every load.
 *
 * Hashed rather than drawn, and hashed *without the tick*, which is the whole
 * difference between this and `roll` below. Same reasoning as the breakthrough
 * (see the header) plus one more: this is asked by the settler card, which the
 * player can open at any moment, and a passion that came out of a stream would
 * both re-roll every map and change depending on when somebody clicked.
 *
 * Nothing needs backfilling for an old save, because nothing is stored.
 */
function passionRoll(seed: number, pawnId: number, skill: SkillName): number {
  let h = 2166136261 ^ seed;
  h = Math.imul(h ^ pawnId, 16777619);
  h = Math.imul(h ^ 0x9e37, 16777619);
  for (let i = 0; i < skill.length; i++) h = Math.imul(h ^ skill.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function passionOf(world: World, pawn: Pawn, skill: SkillName): Passion {
  const r = passionRoll(world.seed, pawn.id, skill);
  if (r < BURNING_AT) return 2;
  if (r < INTERESTED_AT) return 1;
  return 0;
}

/** Every trade this settler has a passion for, best first. For the card. */
export function passionsOf(
  world: World,
  pawn: Pawn,
  skills: SkillName[],
): { skill: SkillName; passion: Passion }[] {
  return skills
    .map((skill) => ({ skill, passion: passionOf(world, pawn, skill) }))
    .filter((p) => p.passion > 0)
    .sort((a, b) => b.passion - a.passion);
}

/**
 * How much harder each level is than the last.
 *
 * Learning used to be flat: the same two-tenths from level 1 to 2 as from 19 to
 * 20, which meant every long-lived colony converged on the same six people with
 * the same maxed-out card. Nobody was *the* doctor because everybody was.
 *
 * The curve is `1 / (1 + max(0, level − 3) × 0.15)`, deliberately flat over the
 * first four levels: every craft gate in the game sits at 3 to 9, and slowing a
 * colony's climb to its first doctor would have been a difficulty change wearing
 * a depth change's coat. It bites afterwards — a settler at 8 learns at a bit
 * over half rate, at 20 at a quarter — so the top of a skill is somewhere a
 * settler arrives with help, from a passion or from a research project, rather
 * than somewhere everybody ends up by outliving the problem.
 */
const LEARN_FALLOFF = 0.15;
const LEARN_FLAT_UNTIL = 3;

export function levelFalloff(level: number): number {
  return 1 / (1 + Math.max(0, level - LEARN_FLAT_UNTIL) * LEARN_FALLOFF);
}

/**
 * Everything that decides how fast this settler learns this trade right now.
 *
 * Passion (who they are) × falloff (how far they have come) × Apprenticeship
 * (what the colony has worked out). Exported because the settler card shows it,
 * and because a number the player cannot see is a number they cannot plan
 * around.
 */
export function learnScale(world: World, pawn: Pawn, skill: SkillName): number {
  return (
    PASSION_RATE[passionOf(world, pawn, skill)] *
    levelFalloff(skillOf(pawn, skill)) *
    learnRateScale(world)
  );
}

export interface GainOptions {
  /**
   * Odds this award also teaches a whole level, on top of the fraction. Only
   * crafting passes it: a settler who has made the thing has understood the
   * thing, and that is the difference between a bench and a treadmill.
   */
  breakthrough?: number;
  /** Say nothing when a level is crossed. For bodies nobody is watching. */
  quiet?: boolean;
  /**
   * Award the amount exactly as given, with no passion, falloff or project
   * multiplier on it.
   *
   * For the two callers that are handing out a *result* rather than practice —
   * a tutor from another settlement, a level bought outright — where scaling it
   * by how fast the settler learns would be double-counting.
   */
  raw?: boolean;
}

/**
 * Award experience, and tell the player if it was enough to matter.
 *
 * Returns the new level, floored — callers that care (the bench, mostly) use it
 * to decide whether the settler has just unlocked something.
 *
 * The message fires on crossing a whole number, not on every award, because the
 * whole number is the only part of a skill that changes what a settler can do:
 * it is what the recipe book tests against and what the work board sorts by. A
 * settler going from 4.9 to 5.0 is news. Going from 4.1 to 4.3 is Tuesday.
 */
export function gainSkill(
  world: World,
  pawn: Pawn,
  skill: SkillName,
  amount: number,
  opts: GainOptions = {},
): number {
  if (!pawn.skills) return 0;
  const before = skillOf(pawn, skill);
  if (before >= SKILL_CAP) return SKILL_CAP;

  // The one choke point every award site in the sim already goes through, which
  // is why passion and the falloff curve could be added without touching any of
  // them: a settler practising anywhere learns at their own rate, not the
  // caller's.
  let next = before + amount * (opts.raw ? 1 : learnScale(world, pawn, skill));
  let insight = false;
  if (opts.breakthrough && Math.floor(next) < SKILL_CAP) {
    // Salted with the amount so two different awards on the same tick — which the
    // bench can produce when two settlers finish together — do not share a roll.
    if (roll(world, pawn, skill, Math.round(amount * 1000)) < opts.breakthrough) {
      next = Math.floor(next) + 1;
      insight = true;
    }
  }
  next = Math.min(SKILL_CAP, next);
  pawn.skills[skill] = next;

  const level = Math.floor(next);
  if (level > Math.floor(before) && !opts.quiet && pawn.faction === 'colony') {
    const title = SKILL_TITLE[skill];
    msg(
      world,
      insight
        ? `${pawn.name} works something out at last — a level ${level} ${title} now.`
        : `${pawn.name} is now a level ${level} ${title}.`,
      'good',
    );
  }
  return level;
}
