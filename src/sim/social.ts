/**
 * Who your settlers like, and who they cannot stand.
 *
 * Traits made a settler *someone*; this makes the colony a *place*. Nobody
 * remembers that the colony survived twelve raids. They remember that Sorrel and
 * Pell had been inseparable since the second week, and that Sorrel was the one
 * still standing when the raid was over.
 *
 * It obeys the same two rules the trait table does, for the same reasons.
 *
 * **One number, already read by something.** A bond is an integer from −100 to
 * +100 and it does exactly two things: it writes `pawn.socialMood`, which
 * `computeMood` adds up alongside `comfort` and the three need bars, and it
 * scales the grief a death costs the people who are left. There is no social
 * job, no new activity, no branch in the job loop. Settlers form opinions of
 * whoever happens to be standing near them while they do the work they were
 * already doing.
 *
 * **Bounded, so it cannot decide a run.** Every friend the colony has is worth
 * at most six points of mood between them — about a third of what going hungry
 * costs. A colony of people who hate each other is a colony that breaks a little
 * sooner under the same pressure, not one that starves.
 *
 * The dependency runs one way on purpose: `needs.ts` imports `bondBetween` from
 * here, and this file imports nothing from `needs.ts`. It never writes `mood`
 * either — it writes `socialMood` and lets the needs pass pick it up on the next
 * tick, which is the same contract `temperature.ts` has with `comfort`.
 */

import { dist, hasLineOfSight } from './grid';
import { unburiedDead } from './graves';
import { warmthOf } from './traits';
import type { Pawn, World } from './types';
import { livingColonists, msg } from './world';

/** How often opinions move, in ticks. Once every second and a half. */
export const SOCIAL_INTERVAL = 30;

/**
 * How close two settlers have to be to be in the same conversation.
 *
 * Two cells and a bit. Wide enough that a pair working the same field or eating
 * at the same table qualify without having to be told to, narrow enough that a
 * settler crossing the yard does not befriend everybody on the way past.
 */
export const TALK_RANGE = 2.6;

/** Opinion at which the log says something. Symmetrical on the other side. */
export const FRIEND = 30;
export const RIVAL = -30;

/** Hard stop on an opinion in either direction. */
const BOND_LIMIT = 100;

/**
 * What a conversation is worth, before traits.
 *
 * The window is deliberately lopsided. People who work together mostly get on —
 * if the average exchange were neutral, a colony would drift to nobody having an
 * opinion of anybody, which is the same as not having this file. The negative
 * tail is what makes a rivalry possible, and it is narrow enough that one takes
 * a while to build.
 */
const CHAT_LOW = -1.2;
const CHAT_HIGH = 2.6;

/**
 * Multiplier when both of them are off the clock.
 *
 * A shared meal or an evening at the table is worth more than passing each other
 * with an armful of steel, and this is the only line in the file that says so.
 */
const LEISURE = 1.9;
const LEISURE_ACTIVITIES = new Set<Pawn['activity']>(['relaxing', 'eating']);

/**
 * How much of an opinion survives a day of not seeing each other.
 *
 * Applied to every bond on every social tick, which works out at about eight
 * percent a day: a friendship is something the two of them have to keep up.
 *
 * It is not, on its own, what keeps the colony off the ceiling — this comment
 * used to claim it was, and measurement said otherwise. Eight percent a day is
 * nothing against a pair who meet a hundred and sixty times in that day. See the
 * falloff in `tickSocial`; the decay is what makes an opinion fade when the two
 * of them stop meeting, and that is all it was ever doing.
 */
const DECAY = 0.9995;
/** Below this an opinion is not worth storing, so it is dropped. */
const FORGET = 0.5;

/** Mood one maxed-out friendship is worth, and the ceiling on the total. */
const MOOD_PER_BOND = 0.03;
const MOOD_LIMIT = 0.06;

/**
 * What a body left lying out costs everyone who can still walk.
 *
 * Flat part first, for any corpse at all, then up to as much again on top for
 * one you were close to. Deliberately larger per body than a friendship is worth
 * — a friend is a slow background warmth, a corpse in the yard is a thing you
 * are supposed to go and deal with today — and deliberately capped, because six
 * dead raiders after a bad night must not by themselves break the colony that
 * survived them. The cap is roughly a third of `BREAK_MOOD`: enough that you
 * feel it, not enough that it decides anything on its own.
 */
export const CORPSE_MOOD = 0.025;
export const CORPSE_MOOD_FRIEND = 0.05;
export const CORPSE_MOOD_LIMIT = 0.09;

/** Stable key for a pair, smaller id first, so a bond is one entry not two. */
export function bondKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** The bonds map, created on first use. Sparse: only pairs who have met. */
export function bonds(world: World): Record<string, number> {
  if (!world.bonds) world.bonds = {};
  return world.bonds;
}

/** What these two think of each other. Zero for strangers, and for a pawn and itself. */
export function bondBetween(world: World, a: number, b: number): number {
  if (a === b) return 0;
  return world.bonds?.[bondKey(a, b)] ?? 0;
}

/** Everyone this settler has an opinion about, strongest first. */
export function bondsOf(world: World, pawn: Pawn): Array<{ pawn: Pawn; bond: number }> {
  const out: Array<{ pawn: Pawn; bond: number }> = [];
  const map = world.bonds;
  if (!map) return out;
  for (const other of world.pawns) {
    if (other.id === pawn.id || other.faction !== 'colony') continue;
    const v = map[bondKey(pawn.id, other.id)];
    if (v === undefined || Math.abs(v) < FORGET) continue;
    out.push({ pawn: other, bond: v });
  }
  out.sort((p, q) => Math.abs(q.bond) - Math.abs(p.bond));
  return out;
}

/** What to call an opinion of this size, for the inspector and the log. */
export function bondLabel(bond: number): string {
  if (bond >= 70) return 'inseparable';
  if (bond >= FRIEND) return 'friend';
  if (bond > 8) return 'friendly';
  if (bond > -8) return 'knows';
  if (bond > RIVAL) return 'wary';
  if (bond > -70) return 'rival';
  return 'cannot stand';
}

/** Announcements already made, so a friendship is news once and not every day. */
function told(world: World): string[] {
  if (!world.bondsTold) world.bondsTold = [];
  return world.bondsTold;
}

function announce(world: World, a: Pawn, b: Pawn, key: string, bond: number): void {
  const mark = bond >= FRIEND ? `${key}+` : `${key}-`;
  const list = told(world);
  if (list.includes(mark)) return;
  list.push(mark);
  if (bond >= FRIEND) msg(world, `${a.name} and ${b.name} have become friends.`, 'good');
  else msg(world, `${a.name} and ${b.name} cannot stand each other.`, 'bad');
}

/** Awake, upright, and in the colony — the only people who talk to anybody. */
function sociable(p: Pawn): boolean {
  return (
    p.faction === 'colony' &&
    !p.dead &&
    !p.downed &&
    p.activity !== 'sleeping' &&
    p.activity !== 'dead' &&
    p.activity !== 'downed'
  );
}

/**
 * Move every opinion in the colony on by one step, and cache what it is worth.
 *
 * Runs on a timer rather than every tick because it is the one pass in the game
 * that is quadratic in settlers, and because an opinion that moved twenty times
 * a second would be at the ceiling before lunch. At a dozen settlers this is
 * sixty-six distance checks a second and a line-of-sight test on the handful
 * that are actually near each other.
 */
export function tickSocial(world: World, rng: { range(lo: number, hi: number): number }): void {
  if (world.tick % SOCIAL_INTERVAL !== 0) return;
  const map = bonds(world);

  // Everything fades a little, whether or not the two of them met today. Done
  // first so a pair who *did* meet this tick keeps the whole of what they gained.
  for (const key of Object.keys(map)) {
    const faded = map[key] * DECAY;
    if (Math.abs(faded) < FORGET) delete map[key];
    else map[key] = faded;
  }

  const all = livingColonists(world);
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (!sociable(a)) continue;
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      if (!sociable(b)) continue;
      if (dist(a.x, a.y, b.x, b.y) > TALK_RANGE) continue;
      // A wall between them is not a conversation, however close the two cells
      // are. Cheap here because only pairs already within two cells reach it.
      if (!hasLineOfSight(world, Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)))
        continue;

      let delta = rng.range(CHAT_LOW, CHAT_HIGH) + warmthOf(a) + warmthOf(b);
      if (LEISURE_ACTIVITIES.has(a.activity) && LEISURE_ACTIVITIES.has(b.activity)) delta *= LEISURE;

      const key = bondKey(a.id, b.id);
      const before = map[key] ?? 0;
      // Diminishing returns, and the scale does not survive without them.
      //
      // Sixty days of an ordinary colony were run and the bonds read off the end:
      // the top four sat at exactly 100, on every seed, and two settlers reached
      // the cap on the *third day*. The arithmetic is not subtle once you look at
      // it — this pass runs 160 times a day, so a pair who share a room gain over
      // a hundred points a day against a decay worth eight. Every number in this
      // file below the cap was unreachable in practice and every pair in the
      // colony was labelled `inseparable` by the end of the first week, which is
      // the same as the file printing one word.
      //
      // Squared falloff fixes the shape rather than the constants: raising the
      // decay or dropping `CHAT_HIGH` would have moved the ceiling everyone
      // arrives at without making arriving there mean anything. This way the top
      // of the range is bought by *being together*, and a pair who cross the yard
      // twice a day settle around forty while a pair who share every meal push
      // eighty. Deliberately one-directional: only movement away from neutral is
      // damped, so two close settlers who fall out fall out at full speed. It is
      // becoming somebody's closest friend that is meant to be hard, not ceasing
      // to be one.
      if (delta * before > 0) {
        const room = 1 - Math.abs(before) / BOND_LIMIT;
        delta *= room * room;
      }
      const after = Math.max(-BOND_LIMIT, Math.min(BOND_LIMIT, before + delta));
      map[key] = after;
      if ((before < FRIEND && after >= FRIEND) || (before > RIVAL && after <= RIVAL))
        announce(world, a, b, key, after);
    }
  }

  for (const p of all) p.socialMood = moodFromBonds(world, p);
}

/**
 * What the people around them are worth to this settler's morale.
 *
 * Two halves, each on its own clamp, because they are different in kind.
 *
 * The living, which is the friendships and the feuds. A friend who *died* is
 * grief, which `needs.ts` charges once and then lets decay — charging it again
 * here, every tick, forever, would turn one bad raid into a colony that never
 * recovers.
 *
 * The unburied, which is not grief and is not about who they were. It is the
 * body still lying in the yard, and it is charged continuously precisely because
 * the player can end it: dig a grave, send a hauler, and the penalty stops. That
 * is the one thing grief must never be. A friend's body out in the open weighs
 * more than a stranger's, but a stranger's still weighs — nobody wants to eat
 * their supper next to a dead raider either.
 */
export function moodFromBonds(world: World, pawn: Pawn): number {
  const map = world.bonds;
  let sum = 0;
  if (map) {
    for (const other of world.pawns) {
      if (other.id === pawn.id || other.faction !== 'colony' || other.dead) continue;
      const v = map[bondKey(pawn.id, other.id)];
      if (v === undefined) continue;
      sum += (v / BOND_LIMIT) * MOOD_PER_BOND;
    }
  }
  const living = Math.max(-MOOD_LIMIT, Math.min(MOOD_LIMIT, sum));

  let grim = 0;
  for (const body of unburiedDead(world)) {
    if (body.id === pawn.id) continue;
    grim -= CORPSE_MOOD;
    if (body.faction !== 'colony') continue;
    // Only positive opinion counts here: a settler does not enjoy the sight of a
    // rival lying in the mud, they just mind it a little less than a friend.
    const bond = Math.max(0, bondBetween(world, pawn.id, body.id));
    grim -= (bond / BOND_LIMIT) * CORPSE_MOOD_FRIEND;
  }
  return living + Math.max(-CORPSE_MOOD_LIMIT, grim);
}

/**
 * The closest surviving friend of somebody who has just died, if they had one.
 *
 * Read by `grieve()` so the log can name the person the colony should be worried
 * about tonight, rather than reporting a death as an event that happened to
 * everybody equally.
 */
export function closestFriendOf(world: World, lost: Pawn): Pawn | null {
  let best: Pawn | null = null;
  let bestBond = FRIEND;
  for (const other of livingColonists(world)) {
    if (other.id === lost.id) continue;
    const v = bondBetween(world, lost.id, other.id);
    if (v > bestBond) {
      bestBond = v;
      best = other;
    }
  }
  return best;
}
