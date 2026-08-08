/**
 * Nobody wants to do the same job all day.
 *
 * The work board is a strict ranking, and a strict ranking has one failure mode
 * that nothing else in the sim catches: a settler whose top priority is farming
 * farms, and farms, and farms, from the morning they arrive until the day they
 * die. It is optimal, it is what the player asked for, and it makes the colony
 * read as a spreadsheet rather than as ten people.
 *
 * So work gets a second axis: how long somebody will stay on one trade before
 * they want a change of scene. A settler with no feeling for a trade will do
 * about three of its jobs and then go and do something — anything — else for a
 * while; somebody with a passion for it will work a run three times that long
 * and be glad of it. The colony still gets the work done, because the break is
 * short and because a settler with nothing else on the board goes straight back
 * to it (see `pickWorkJob` — the skip is a preference, never a refusal).
 *
 * ## Why a run and not a tally
 *
 * The counter is a *stint*: consecutive jobs of one work type. Take a job of
 * some other type and the run resets. That is the whole rule, and it has the
 * property a decaying tally does not — a settler already alternating between
 * two trades never gets bored of either, because they are already doing the
 * thing this system exists to make them do. The mechanic only ever bites the
 * grind it was written for.
 *
 * ## Where it is called from
 *
 * `bore` runs at the one place that knows both the settler and the *work type*
 * they just took — `pickWorkJob`'s successful `tryWorkType`. Not at job
 * completion: `finishJob` sees a `JobKind`, and the map from a job kind back to
 * the board column it came off does not exist (a haul-to-blueprint is
 * construction work, a haul to a stockpile is not).
 */

import { nudgeMood } from './needs';
import { type Passion, passionOf } from './skills';
import { stintMultiplier } from './traits';
import { TICKS_PER_DAY, type Pawn, type SkillName, type World, type WorkType } from './types';

/**
 * The trade each column of the board draws on, for the one question this module
 * asks of it: does this settler care about the work?
 *
 * Partial on purpose. Hauling crates and standing a fire line are nobody's
 * craft — they have no skill, no passion, and everybody tires of them at the
 * same base rate, which is the correct answer rather than a missing one.
 * Crafting is filed under construction because eight of the nine recipes gate
 * on it; the exception is the doctor's bag, and a settler who is sick of the
 * bench is sick of the bench.
 */
const WORK_SKILL: Partial<Record<WorkType, SkillName>> = {
  doctor: 'medicine',
  warden: 'social',
  cook: 'cooking',
  farm: 'plants',
  construct: 'construction',
  craft: 'construction',
  mine: 'mining',
  chop: 'plants',
  research: 'research',
  hunt: 'shooting',
  caravan: 'social',
};

/**
 * How many jobs in a row before they have had enough, by how they feel about it.
 *
 * Three for a trade they have no feeling for is the number the whole mechanic
 * is tuned around: long enough that a field gets planted and a wall gets built
 * in one visit, short enough that the player watching one settler for a minute
 * sees them change their mind about something.
 */
const STINT: Record<Passion, number> = { 0: 3, 1: 5, 2: 9 };

/**
 * Emergencies. A burning roof is not a matter of taste, and neither is the
 * settler bleeding out in the yard — these three are never skipped and never
 * counted, so a long night of surgery does not leave the colony's only doctor
 * fed up with medicine on the morning of the raid.
 */
const ALWAYS: ReadonlySet<WorkType> = new Set<WorkType>(['firefight', 'doctor', 'warden']);

/**
 * How long a settler stays off a trade once they have had their fill.
 *
 * Short — under an hour of colony time. This is "I'll do something else for a
 * bit", not a strike. Long enough that they genuinely get a different job in
 * between, short enough that a one-farmer colony loses nothing that matters.
 */
export const RESPITE = Math.round(TICKS_PER_DAY * 0.06);

/** What being made to do it anyway costs them, per job. */
const IRRITATION = -0.012;

/** How many of these in a row this settler has in them. */
export function stintFor(world: World, pawn: Pawn, work: WorkType): number {
  const skill = WORK_SKILL[work];
  const base = STINT[skill ? passionOf(world, pawn, skill) : 0];
  return Math.max(1, Math.round(base * stintMultiplier(pawn)));
}

/** Have they had enough of this one for now? */
export function boredOf(world: World, pawn: Pawn, work: WorkType): boolean {
  if (ALWAYS.has(work)) return false;
  return (pawn.tedium?.[work] ?? 0) > world.tick;
}

/**
 * Book one job of this work type against the settler who just took it.
 *
 * Also the place the irritation lands: if they were already fed up with this
 * and the board handed it back to them anyway — because there was nothing else
 * to do — that is a bad shift, and it should show up on the card as one.
 *
 * Going back to it ends the bout. Partly because it is true — they are doing
 * the work, so "off it for a while" is over — and partly because it is what
 * keeps the grievance bounded: a settler in a one-job colony is charged once
 * per run rather than once per crate, which decays faster than it accrues. The
 * version that charged every job walked a hauler into a morale break for
 * hauling, which is a punishment for the *player's* empty board.
 */
export function bore(world: World, pawn: Pawn, work: WorkType): void {
  if (ALWAYS.has(work)) return;
  if (boredOf(world, pawn, work)) {
    nudgeMood(pawn, IRRITATION);
    delete pawn.tedium?.[work];
  }

  if (pawn.stint?.work === work) pawn.stint.count++;
  else pawn.stint = { work, count: 1 };

  if (pawn.stint.count < stintFor(world, pawn, work)) return;
  // Had their fill. Off it for a while, and the run starts again from nothing
  // when they come back to it.
  (pawn.tedium ??= {})[work] = world.tick + RESPITE;
  pawn.stint = null;
}

/** What they are sick of right now, for the inspector. Empty for most settlers. */
export function tediumOf(world: World, pawn: Pawn): WorkType[] {
  const t = pawn.tedium;
  if (!t) return [];
  return (Object.keys(t) as WorkType[]).filter((w) => (t[w] ?? 0) > world.tick);
}
