/**
 * What happened to this one.
 *
 * The colony has a message log and it is a good one, but it is a log of the
 * *colony*: everything that happens to everybody, in one column, scrolling away.
 * Open a settler card twenty days in and you get a snapshot of a stranger — eight
 * skill numbers, a mood bar, a list of who they get on with — and nothing at all
 * about how they got here or what they have been through. Which is the whole
 * difference between a unit and a person, and this game is built on the promise
 * that you can walk around inside it as one of them.
 *
 * So every settler keeps a short list of the handful of things that would come up
 * if somebody asked about them. Not a diary. Six or eight lines, ever, for a
 * settler who lives a hundred days — the bar for an entry is "would a player
 * retell this", and "hauled forty wood" does not clear it.
 *
 * ## Clauses, not sentences
 *
 * An entry is written as a bare past-tense clause with no name and no pronoun:
 * `'came out of the trees, hurt and asking to stay'`. Two reasons. The card
 * prints them under a name that is already at the top of the panel, so repeating
 * it in every row is nine words of noise; and the eulogy composes them into a
 * sentence of its own, which it cannot do with a fragment that has already picked
 * its own subject. Nothing here ever guesses at a settler's pronouns — the
 * clauses are written to not need one, and "they" where one is unavoidable.
 *
 * ## The first line is not evictable
 *
 * The list is capped, and a plain queue drops the oldest first — which is exactly
 * the line worth keeping. Where somebody came from is the thing that makes the
 * rest of it mean anything, and a settler who has been through eight things is
 * precisely the settler whose origin you have forgotten. So the cap evicts the
 * *second* entry and leaves the first alone.
 *
 * Draws no rng, by construction: every entry is written from an event the sim had
 * already decided on. See the note at the top of `skills.ts` for why that matters
 * — one extra draw inside a per-body loop silently re-rolls every map in the game.
 */

import { dayNumber } from './clock';
import type { Memory, Pawn, World } from './types';

export type { Memory };

/**
 * How many lines a settler carries.
 *
 * Eight is about as much as anybody would say about somebody in one go, and it
 * is a cap on the *panel* as much as on the memory — a settler card is read at a
 * glance in a 234px column, and a life story you have to scroll through is one
 * nobody reads. (The panel scrolls anyway, because a long-lived settler with
 * eight skills, three bonds and an illness runs past the bottom of the window
 * with or without this; see `#inspector` in `style.css`. The cap is what keeps
 * that the exception.)
 */
export const MEMORY_CAP = 8;

/** Their story so far, oldest first. Safe on a save written before any of this. */
export function memoriesOf(pawn: Pawn): Memory[] {
  return pawn.memories ?? [];
}

/**
 * Write a line into a settler's story.
 *
 * Colony and prisoners only. A prisoner keeps one because they might throw in
 * with the colony later, and "came here with a raid and stayed" is the best line
 * in the game — a raider going down in the yard we shot has no story to tell.
 *
 * Silently ignores a repeat of the line already at the end, because several of
 * the callers sit on passes that can fire twice on one event (an illness that
 * relapses in the same hour, a settler downed a second time before they are up).
 */
export function remember(world: World, pawn: Pawn, text: string): void {
  if (pawn.faction !== 'colony' && pawn.faction !== 'prisoner') return;
  const list = (pawn.memories ??= []);
  const last = list[list.length - 1];
  if (last && last.text === text) return;
  list.push({ day: dayNumber(world), text });
  // Evict the second, never the first: see the header. `splice` over `shift`
  // is the whole of the difference, and it is the difference between a settler
  // with a past and a settler who has always just been here.
  if (list.length > MEMORY_CAP) list.splice(1, list.length - MEMORY_CAP);
}

/**
 * Write a line, but only the first time this *sort* of thing happens to them.
 *
 * `tag` is a prefix of `text`, deliberately — the kind of event and the wording
 * of it stay in one place, so a caller that rewrites the line cannot forget to
 * rewrite the key that suppresses it. Going down to gunfire is a story the first
 * time and a status effect the fourth; the same is true of burying somebody. The
 * cap is what makes this matter: without it a settler who fights ten raids ends
 * up with eight identical lines and no life.
 */
export function rememberFirst(world: World, pawn: Pawn, tag: string, text: string): void {
  if (memoriesOf(pawn).some((m) => m.text.startsWith(tag))) return;
  remember(world, pawn, text);
}

/**
 * The line the colony says over somebody.
 *
 * A death message is `${name} is dead. (a bear)` and that is the right first
 * line — it says what happened and where to look. It is not, however, a reason
 * to care, and this game spends twenty days making the player care and then
 * spends one line spending it. So the eulogy follows: how long they were here,
 * and the thing they are actually remembered for.
 *
 * Which is the *origin* plus at most one later line, not the whole list. A
 * recital of eight things is a database dump wearing a black armband; two
 * clauses is how somebody actually gets described. The later line is the last
 * one that is not the origin, because the most recent memorable thing is what
 * anybody would reach for.
 *
 * Returns null for a settler with nothing written down — a founder who died in
 * the first hour has no story, and inventing one for them would be the same lie
 * as the eight-line version.
 */
export function eulogyFor(world: World, pawn: Pawn): string | null {
  const list = memoriesOf(pawn);
  if (list.length === 0) return null;
  const days = Math.max(0, dayNumber(world) - list[0]!.day);
  const here =
    days === 0
      ? `${pawn.name} was here less than a day.`
      : `${pawn.name} was here ${days} day${days === 1 ? '' : 's'}.`;
  const origin = list[0]!.text;
  const last = list.length > 1 ? list[list.length - 1]!.text : null;
  // "They came out of the trees, and buried a friend." The comma-and is doing
  // real work: without it the two clauses read as one run-on event.
  return last ? `${here} They ${origin}, and ${last}.` : `${here} They ${origin}.`;
}
