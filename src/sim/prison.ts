/**
 * Prisoners: what happens to a raider who goes down in your yard and does not
 * die there.
 *
 * Before this, a downed raider had exactly two futures — bleed out, or heal up
 * and start shooting again. Both of them threw away the one thing a colony this
 * small actually needs, which is people. So: a warden carries them to a bunk,
 * the doctor patches them up because they are now a body in your care rather
 * than a body in your way, somebody brings them meals, and somebody sits with
 * them until they decide this is a better place to be than the band that sent
 * them. That last part is the whole point — a colonist you *earned* off a raid
 * you survived reads differently from one the storyteller handed you.
 *
 * The costs are real and deliberate. A prisoner eats out of the same pantry the
 * settlers do, cannot work while they are a prisoner, and occupies a bunk that
 * had to be built out of wood and steel before the raid arrived. Capturing more
 * than you can feed is a way to lose a colony, and it should be.
 *
 * What this module owns: the bunk bookkeeping, the prisoner's own clock (needs,
 * healing, starving) and the arithmetic of persuasion. The *jobs* that carry,
 * feed and talk live in jobs.ts with every other job, because a warden queueing
 * work is not a special case of anything.
 */

import { FOOD_DRAIN, REST_DRAIN, REST_GAIN_BED, STARVE_DAMAGE, celebrate } from './needs';
import { traitsOf } from './traits';
import { msg } from './world';
import { gainSkill } from './skills';
import { remember } from './lifelog';
import { TICKS_PER_DAY } from './types';
import type { Building, Pawn, World } from './types';

/**
 * How many sittings it takes to talk somebody round, low and high.
 *
 * Tuned against `TALK_WORK` below so a determined warden converts a prisoner in
 * roughly two to four colony days. Much faster and a raid becomes a recruitment
 * drive with no downside; much slower and the player never sees the payoff, so
 * the bunks read as a tax rather than an investment.
 */
export const RESISTANCE_MIN = 5;
export const RESISTANCE_MAX = 10;

/** Work units in one sitting. `workRate` on a settler is roughly 1 per tick. */
export const TALK_WORK = 110;

/**
 * Ticks a prisoner is left alone between sittings — a little over half a day.
 *
 * The gap is the whole of the pacing, and the first build shipped without one:
 * a warden simply sat there talking, a raider joined up inside an afternoon, and
 * across twenty-one days the eval colony grew from four settlers to eighteen on
 * captures alone. Capturing became strictly better than fighting and every other
 * way of getting people — wanderers, the caravan's hires — stopped mattering.
 * Sized against the two resistance rolls it has to bracket: a soft raider worked
 * by a cheerful warden gives in after three sittings, a stubborn one facing a
 * miserable warden takes ten. At 0.6 days a sitting that is a floor of about two
 * days and a ceiling of six — long enough that the food a prisoner eats is a
 * real bill, short enough that the player sees the payoff of the bunk they paid
 * for.
 */
export const TALK_GAP = Math.round(TICKS_PER_DAY * 0.6);

/** Below this a prisoner is hungry enough for a warden to fetch a meal. */
export const FEED_PRISONER_BELOW = 0.6;

/**
 * A prisoner eats at ordinary settler rates but burns nothing on work, so their
 * upkeep is real without being punitive: one prisoner costs about the same as
 * one more mouth at the table, which is exactly what they are about to become.
 */
const PRISONER_FOOD_DRAIN = FOOD_DRAIN * 0.8;

export function prisoners(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'prisoner' && !p.dead);
}

/** Bunks that are built and hold nobody. */
export function freeBunk(world: World): Building | null {
  const taken = new Set(prisoners(world).map((p) => p.bunkId));
  return (
    world.buildings.find((b) => b.kind === 'prisonbed' && b.built && !taken.has(b.id)) ?? null
  );
}

/**
 * Raiders on the ground who could be carried in.
 *
 * `wildlife` is deliberately not here: the maddened beast the storyteller sends
 * is an animal, and a cell is not an answer to it. Neither is a dead one, or one
 * somebody is already on their way to fetch.
 */
export function capturable(world: World): Pawn[] {
  return world.pawns.filter(
    (p) =>
      p.faction === 'raider' &&
      !p.dead &&
      p.downed &&
      !world.jobs.some((j) => j.kind === 'capture' && j.targetPawnId === p.id),
  );
}

/**
 * Lay a captive in a bunk and make them a prisoner.
 *
 * Resistance is rolled from the pawn's own id rather than a random stream so it
 * survives a save/load round trip and so the same raider is the same person
 * however many times the tick that captures them is replayed.
 */
export function imprison(world: World, captive: Pawn, bunk: Building): void {
  captive.faction = 'prisoner';
  captive.bunkId = bunk.id;
  captive.resistance = RESISTANCE_MIN + ((captive.id * 7 + captive.colorSeed) % (RESISTANCE_MAX - RESISTANCE_MIN + 1));
  captive.x = bunk.x;
  captive.y = bunk.y;
  captive.path = null;
  captive.drafted = false;
  captive.targetPawnId = null;
  captive.orderX = null;
  captive.orderY = null;
  // Their gear does not come into the cell with them. It is also the only loot a
  // capture yields, which is what makes killing and capturing different choices
  // rather than the same choice with a delay.
  captive.weapon = 'none';
  world.stats.captured = (world.stats.captured ?? 0) + 1;
  // Their story starts the moment they stop being a raider. A prisoner who never
  // joins is never read, and one who does joins with a first line the colony did
  // not write for them — which is the point of keeping it.
  remember(world, captive, 'came here with a raid and ended up in a bunk');
  msg(world, `${captive.name} is locked in a bunk. A warden can try to talk them round.`, 'good');
}

/**
 * One sitting's worth of persuasion. Returns true if that was the last one.
 *
 * A warden's own morale does the talking: somebody who is themself miserable is
 * not going to make a convincing case for staying, and it gives the player a
 * reason to keep the colony pleasant beyond the mood bars themselves.
 */
export function persuade(world: World, warden: Pawn, prisoner: Pawn): boolean {
  // Kindhearted wardens get the good rate whatever sort of week they are having;
  // for everyone else it is their own morale doing the talking.
  const kind = Math.max(0, ...traitsOf(warden).map((t) => t.persuasion ?? 0));
  // Deliberately no `social` term here, even though social is exactly the skill
  // this is. It already pays: the talking job runs at `workRate(pawn, 'social')`
  // (`jobs.ts`), so a good talker gets through a conversation in half the time
  // and comes back round sooner. Putting the skill in the *chunk* as well would
  // charge the same skill twice and turn one good trader into a recruiter
  // nothing can resist — and it would make resistance fractional, which is a
  // number the player reads off the prisoner's card.
  const per = Math.max(kind, warden.mood > 0.7 ? 2 : 1);
  const left = (prisoner.resistance ?? RESISTANCE_MAX) - per;
  prisoner.resistance = Math.max(0, left);
  prisoner.talkCooldown = world.tick + TALK_GAP;
  // Levelled by doing it, like the road. This is the half of the skill a colony
  // that never sends a caravan can still grow.
  gainSkill(world, warden, 'social', 0.25);
  if (left > 0) {
    msg(
      world,
      `${warden.name} talks with ${prisoner.name}. ${Math.ceil(left)} left to break through.`,
      'info',
    );
    return false;
  }
  recruit(world, prisoner);
  return true;
}

/** A prisoner joins up. Also used by tests and by anything that skips the talking. */
export function recruit(world: World, prisoner: Pawn): void {
  prisoner.faction = 'colony';
  prisoner.resistance = 0;
  prisoner.bunkId = undefined;
  prisoner.talkCooldown = undefined;
  prisoner.activity = prisoner.downed ? 'downed' : 'idle';
  // Arriving with an empty stomach and no sleep is a rough first day, but they
  // arrive at whatever state they were kept in — which is the argument for
  // feeding your prisoners.
  world.stats.recruited = (world.stats.recruited ?? 0) + 1;
  remember(world, prisoner, 'threw in with the colony');
  msg(world, `${prisoner.name} throws in with the colony.`, 'good');
  celebrate(world);
}

/**
 * The prisoner's own clock, run for every prisoner once a tick.
 *
 * They do not take jobs, do not path anywhere and do not think — the whole of a
 * prisoner's existence is lying in the bunk getting hungrier while somebody
 * decides what to do about them. What they *do* have is the same starvation
 * arithmetic everyone else does, so a colony that captures four raiders it
 * cannot feed will watch them die one at a time and be told about it.
 */
export function tickPrisoners(world: World): void {
  for (const p of world.pawns) {
    if (p.faction !== 'prisoner' || p.dead) continue;

    // The bunk they were laid in got deconstructed or burned down out from under
    // them. They stay a prisoner — they are in no state to walk out — but the
    // player should be told, because it is now their problem.
    const bunk = world.buildings.find((b) => b.id === p.bunkId && b.built);
    if (!bunk) {
      p.bunkId = undefined;
    } else {
      // Pinned rather than pathed. A prisoner has no AI at all, and the one way
      // out of the bunk is to stop being a prisoner.
      p.x = bunk.x;
      p.y = bunk.y;
    }

    const n = p.needs;
    n.food = Math.max(0, n.food - PRISONER_FOOD_DRAIN);
    n.rest = Math.min(1, n.rest - REST_DRAIN + (bunk ? REST_GAIN_BED : 0));
    p.activity = p.downed ? 'downed' : n.rest < 0.55 ? 'sleeping' : 'idle';

    if (n.food <= 0) {
      p.hp -= STARVE_DAMAGE;
      if (world.tick % Math.round(TICKS_PER_DAY / 2) === 0) {
        msg(world, `${p.name} is starving in the bunk.`, 'bad');
      }
      if (p.hp <= 0) {
        p.hp = 0;
        p.dead = true;
        p.downed = false;
        p.activity = 'dead';
        msg(world, `${p.name} starved to death in your care.`, 'bad');
        continue;
      }
      if (!p.downed && p.hp < p.maxHp * 0.2) {
        p.downed = true;
        p.activity = 'downed';
      }
    } else if (p.hp < p.maxHp) {
      // Fed and off their feet: wounds close at the rate a sleeping settler's do.
      // A prisoner has to be conscious before anybody can talk to them, so this
      // is also the clock the whole feature runs on.
      p.hp = Math.min(p.maxHp, p.hp + STARVE_DAMAGE * 0.5);
    }
  }
}
