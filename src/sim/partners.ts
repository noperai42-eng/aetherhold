/**
 * Who a settler comes home to.
 *
 * `social.ts` gave the colony opinions, and opinions turned out to be the thing
 * players actually remember about a run — not the twelve raids, but that Sorrel
 * and Pell were inseparable from the second week. This file is what happens when
 * an opinion goes all the way: two settlers who have spent months in each
 * other's company stop being two settlers who get on and become a pair, and the
 * colony has a good day about it.
 *
 * Three rules keep it honest.
 *
 * **It is earned, never rolled.** No dice anywhere in this file. A pair forms
 * when their bond crosses a line *and stays there* for ten days — the second half
 * of that is not decoration, it is the whole guarantee. Measuring sixty days of a
 * real colony showed the top bonds pinned at the cap by the second week, so the
 * threshold on its own was a fortnight of sitting at the same table, not the
 * season this file claims to be about. A clock on the far side of the line is
 * what makes the claim true. It also costs the story stream nothing and cannot
 * shift a seed.
 *
 * **It is small, like everything else that touches mood.** A partner is worth
 * about as much morale as a warm room. It does not make a colony survive a
 * winter it would otherwise lose. What it does is make the loss of one specific
 * person land differently from the loss of a pair of hands — which is the whole
 * reason the social layer exists.
 *
 * **It says nothing about who anybody is.** A pair is two settlers with a very
 * high opinion of each other and no other partner. There is no sex, no
 * orientation and no compatibility table in this file, because the game has no
 * business modelling any of that and the feature is better without it: whoever
 * your colony spent its winter with is who it spent its winter with.
 *
 * Dependencies run one way, the same way `social.ts` does: this file reads bonds
 * and writes `pawn.partnerMood`, and `needs.ts` picks that up on the next tick
 * alongside `socialMood` and `roomMood`. Nothing here imports `needs.ts`.
 */

import { remember } from './lifelog';
import { bondBetween, bondKey } from './social';
import { TICKS_PER_DAY } from './types';
import type { Pawn, World } from './types';
import { livingColonists, msg } from './world';

/**
 * The opinion at which two settlers become a pair.
 *
 * Exactly the line the inspector calls `inseparable`, and that is deliberate:
 * the precondition for the rarest thing in the social model should be a word the
 * player can already read on the panel, not a hidden number ten points past the
 * end of the visible vocabulary.
 *
 * It used to be eighty, chosen when a bond could reach a hundred in a week. Once
 * `social.ts` learned diminishing returns that number stopped existing. Ninety
 * days of three ordinary colonies were run and every bond in them recorded: the
 * best any pair ever reached was 74, 80 and 74, and the count of pairings formed
 * was zero, zero and zero. A threshold above the top of the achievable range is
 * not a demanding threshold, it is an unreachable one, and it takes the whole
 * feature down with it — no partners means no partner mood, no widowing, no
 * mourning, none of which would have failed a test.
 *
 * Seventy is the floor of where the top handful of bonds in those colonies
 * settle (68-74, 71-74, 65-73), so one or two pairs per colony clear it and the
 * rest of the crew sit just under. The band is only six points wide, which would
 * make any line inside it a knife edge on its own — that is what `COURT_TICKS`
 * below is for. The measured bonds wander ten points over a month, so surviving
 * ten days above the line is a much stronger claim than touching it.
 */
export const PAIR_BOND = 70;

/**
 * And how long they have to still be there.
 *
 * The threshold alone was not the season the comment above once claimed it was.
 * Running sixty days of an ordinary colony and reading the bonds off the end
 * settled it: the top four were pinned at the cap of a hundred and the first pair
 * formed on day twelve, day seven, day three. The line was never the hard part.
 *
 * So the line is a starting gun, not a finish. A bond has to *hold* above it for
 * ten days before anything is announced, and any dip below cancels the clock. A
 * peak is one good fortnight; ten days on the far side of a peak that two other
 * people never reach is a choice being made repeatedly, which is the thing the
 * feature claims to be about. Adding the clock alone moved the first pairing to
 * day 22, 16 and 23 on the same three seeds — worth having, and still not the
 * fix, because the bonds underneath it were as saturated as ever. Both changes
 * were needed and they do different jobs: the falloff decides how high a bond
 * can climb, this decides how long it has to stay there.
 */
export const COURT_TICKS = 10 * TICKS_PER_DAY;

/**
 * How far a courting bond may slip without losing its clock.
 *
 * "Any dip below cancels the clock" was the rule for one day, and it was wrong
 * for a reason worth writing down: the line it cancelled against is 70, and the
 * bonds that reach 70 wander about ten points over a month. So the clock was
 * being reset by the ordinary weather of the number it was watching. Three
 * ninety-day colonies at that setting produced one pairing between them, on day
 * 70, while the other two ended the run with pairs sitting on 71 and 73 and a
 * clock that had never survived ten consecutive days.
 *
 * This is the standard fix for a latch on a noisy signal, and the same one
 * `fishing.ts` uses to decide whether the lake is shut: two lines instead of
 * one. Crossing 70 starts the clock; only falling below 62 stops it. Eight
 * points is wider than the wander and far narrower than a real falling-out — a
 * bond that is actually collapsing loses more than that in a couple of days,
 * because the souring half of `social.ts` has no diminishing returns on it at
 * all.
 *
 * The clock surviving a dip is not the same as pairing during one: the
 * announcement still requires the bond to be at or above `PAIR_BOND` on the day
 * it happens. Ten days of closeness *and* close right now.
 */
export const COURT_KEEP = PAIR_BOND - 8;

/**
 * How far a bond has to fall before a pair is no longer a pair.
 *
 * Well below the threshold that formed them, on purpose. A pairing that
 * dissolved the first quiet fortnight would be a bond meter with a label on it,
 * and the player would learn to ignore both. This is the point at which the two
 * of them genuinely are not close any more — below `friend` — and even then the
 * game says so plainly rather than pretending it did not happen.
 */
export const PART_BOND = 24;

/**
 * What having them around is worth, per tick, to morale.
 *
 * The same order as a pleasant room or a colony full of friends — see the ceiling
 * in `social.ts`. Small enough that it never decides a run, large enough that a
 * colony that has paired off is visibly steadier than one that has not.
 */
export const PARTNER_MOOD = 0.05;

/**
 * And what it is worth while they are hurt.
 *
 * Not a penalty for being partnered — a partner who is down is a partner who is
 * still alive, so the lift shrinks rather than inverting. A settler whose partner
 * is bleeding in a medbed is worried, not worse off than somebody who never had
 * anyone.
 */
export const PARTNER_HURT = 0.01;

/**
 * How much heavier a death lands on the one who is left, in the moment.
 *
 * On top of the friendship scaling `grieve` already applies. Its real job is to
 * guarantee the survivor takes the full blow — `moodOffset` is clamped at 0.3
 * and a partner's grief should always arrive at that ceiling, even if the two of
 * them had been apart for a month and the bond had slipped.
 *
 * What it explicitly is *not* is the feature. See `MOURN_MOOD` — the ceiling
 * means a big enough multiplier stops being felt, so the difference between
 * burying a friend and burying your person cannot live in the size of the spike.
 */
export const WIDOW_GRIEF = 1.6;

/**
 * The weight of the empty half of the bed.
 *
 * This is the part that actually distinguishes the loss, and it took getting the
 * spike wrong to see why. `moodOffset` is clamped at ±0.3 and decays at a flat
 * rate, so a settler who lost a close friend and a settler who lost their
 * partner both land on the ceiling and both climb out of it on the same
 * afternoon. Multiplying harder changes nothing; the clamp eats it.
 *
 * So the difference is duration, not depth. The same field that paid them for
 * having somebody charges them for not having them — a small standing term, the
 * size of a cold room, that expires on its own. A grieving settler is a settler
 * who breaks a little sooner all week, which is what the loss should cost and
 * what a one-tick spike can never say.
 */
export const MOURN_MOOD = -0.06;

/** How long the shadow lasts. Long enough to be a season in their life. */
export const MOURN_TICKS = 6 * TICKS_PER_DAY;

/** The pairs, both directions, so a lookup is one read. Created on first use. */
export function partners(world: World): Record<number, number> {
  if (!world.partners) world.partners = {};
  return world.partners;
}

/** Who is on the clock, and since when. Created on first use. */
export function courting(world: World): Record<string, number> {
  if (!world.courting) world.courting = {};
  return world.courting;
}

/**
 * How long these two have been holding a pairing bond, in ticks, or zero.
 *
 * Exposed for the inspector, which is the only place a player can find out that
 * something is happening before the day it is announced. A courtship the game
 * never mentions until it is over is a coin flip with a long fuse.
 */
export function courtedFor(world: World, a: number, b: number): number {
  const since = world.courting?.[bondKey(a, b)];
  return since === undefined ? 0 : Math.max(0, world.tick - since);
}

/** Who this settler is paired with, if they are still alive and in the colony. */
export function partnerOf(world: World, pawn: Pawn): Pawn | null {
  const id = world.partners?.[pawn.id];
  if (id === undefined) return null;
  const other = world.pawns.find((p) => p.id === id);
  // A dead partner is not a partner — but the pairing is deliberately left in
  // the map, because `partnerLost` needs to know there was one, and because a
  // widowed settler pairing off again on the same day they buried somebody is
  // the one outcome nobody wants to read in the log.
  if (!other || other.dead || other.faction !== 'colony') return null;
  return other;
}

/** True if this id is spoken for, whether or not that person is still alive. */
export function isPartnered(world: World, id: number): boolean {
  return world.partners?.[id] !== undefined;
}

/**
 * The one who is left, at the moment the other one dies.
 *
 * Called from `needs.ts` on the death pass, before the pairing is cleared, so
 * the grief multiplier and the memory both know there was somebody. Returns null
 * for the ordinary case — most deaths are not this.
 */
export function partnerLost(world: World, lost: Pawn): Pawn | null {
  const id = world.partners?.[lost.id];
  if (id === undefined) return null;
  const left = world.pawns.find((p) => p.id === id);
  if (!left || left.dead || left.faction !== 'colony') return null;
  return left;
}

/**
 * Break a pairing because one of them died.
 *
 * The map entries go — a headstone is not a partner — but the survivor keeps the
 * memory, which is the part that matters. They can pair again later; the bond
 * threshold means it will not be soon.
 */
export function widow(world: World, lost: Pawn, left: Pawn): void {
  const map = partners(world);
  delete map[lost.id];
  delete map[left.id];
  left.mourning = MOURN_TICKS;
  remember(world, left, `lost ${lost.name}`);
  msg(world, `${left.name} has lost ${lost.name}, who they had made a life with.`, 'bad', {
    headline: true,
  });
}

/** How often the pairing pass runs. Once a minute of game time is plenty. */
const PAIR_INTERVAL = 200;

/**
 * Form the pairs, dissolve the ones that have gone cold, and price the rest.
 *
 * The forming half is deliberately greedy and deterministic: of the pairs that
 * have held the line for ten days, take the strongest, pair those two, and stop
 * for the day. One at a time because a colony where three couples announce
 * themselves in the same minute reads as a system firing, not as something that
 * happened — and strongest-of-the-waiting means the pairing the player has been
 * watching build is the pairing they get, rather than whichever pair the loop
 * reached first.
 */
export function tickPartners(world: World, _rng?: unknown): void {
  const all = livingColonists(world);
  if (world.tick % PAIR_INTERVAL === 0) reshuffle(world, all);

  // Priced last and every tick, like `socialMood`. Last on purpose: the pass
  // that pairs two settlers is the pass they feel it in, and a partner going
  // down is felt this tick rather than up to a minute later.
  for (const p of all) {
    // Mourning first, and it wins outright. A widowed settler who pairs off
    // again inside the week would be reading the shadow and the new lift out of
    // the same slot, and the arithmetic of that is grotesque — so grief is a
    // state the settler is in, not a number added to another number.
    if (p.mourning) {
      p.mourning = p.mourning > 1 ? p.mourning - 1 : 0;
      p.partnerMood = MOURN_MOOD;
      continue;
    }
    const mate = partnerOf(world, p);
    p.partnerMood = !mate ? 0 : mate.downed || mate.hp < mate.maxHp * 0.6 ? PARTNER_HURT : PARTNER_MOOD;
  }
}

/** The once-a-minute half: who parted, and who is new. */
function reshuffle(world: World, all: Pawn[]): void {
  const map = partners(world);

  // Dissolutions first, so two people who drifted apart are both free to be
  // considered in the same pass that might pair one of them with somebody else.
  for (const p of all) {
    const mate = partnerOf(world, p);
    if (!mate || mate.id < p.id) continue; // each pair once, from the lower id
    if (bondBetween(world, p.id, mate.id) >= PART_BOND) continue;
    delete map[p.id];
    delete map[mate.id];
    msg(world, `${p.name} and ${mate.name} have gone their separate ways.`, 'info');
  }

  // Everyone above the line gets a clock; everyone who has slipped below it, or
  // who is no longer free to be considered, loses theirs. Started and cleared in
  // the same pass so the map can never outlive the fact it records — a stale
  // stamp would let a bond that collapsed in week two pair in week three off a
  // number nobody has looked at since.
  const clocks = courting(world);
  const held: string[] = [];
  const free = all.filter((p) => !isPartnered(world, p.id) && !p.mourning);
  const live = new Set<string>();
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i]!;
      const b = free[j]!;
      const key = bondKey(a.id, b.id);
      const bond = bondBetween(world, a.id, b.id);
      const started = clocks[key] !== undefined;
      // Two lines, not one. Reaching 70 starts a clock; only falling to 62
      // stops it. See `COURT_KEEP` — one line was being reset by the ordinary
      // wander of the number it watched, and the clock never survived a
      // fortnight.
      if (bond < (started ? COURT_KEEP : PAIR_BOND)) continue;
      live.add(key);
      if (!started) clocks[key] = world.tick;
      // Held long enough *and* close today. The clock is allowed to run through
      // a bad week; the announcement is not allowed to land in one.
      else if (world.tick - clocks[key]! >= COURT_TICKS && bond >= PAIR_BOND) held.push(key);
    }
  }
  for (const key of Object.keys(clocks)) if (!live.has(key)) delete clocks[key];

  let bestA: Pawn | null = null;
  let bestB: Pawn | null = null;
  let bestBond = -Infinity;
  for (const key of held) {
    // The strongest of the ones that have waited, not the strongest overall: a
    // pair three days into a hundred-point bond has not shown the game anything
    // that a pair ten days into an eighty-point one has not shown it twice.
    const [ai, bi] = key.split(':').map(Number) as [number, number];
    const bond = bondBetween(world, ai, bi);
    // Strictly greater, so the pair that reached the line first wins the tie
    // rather than whichever pair has the lower ids.
    if (bond <= bestBond) continue;
    bestBond = bond;
    bestA = all.find((p) => p.id === ai) ?? null;
    bestB = all.find((p) => p.id === bi) ?? null;
  }
  if (!bestA || !bestB) return;
  delete clocks[bondKey(bestA.id, bestB.id)];

  map[bestA.id] = bestB.id;
  map[bestB.id] = bestA.id;
  remember(world, bestA, `made a life with ${bestB.name}`);
  remember(world, bestB, `made a life with ${bestA.name}`);
  msg(world, `${bestA.name} and ${bestB.name} have made a life together.`, 'good', {
    headline: true,
    at: bestA,
  });
}
