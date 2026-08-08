/**
 * Snow that lies.
 *
 * Falling snow is weather — it is gone the moment the front moves on. Snow on
 * the ground is a *state the valley is in*, and it is the difference between a
 * winter you watch and a winter you live in. It arrives over hours, it stays for
 * days after the sky clears, and it goes only when the thaw comes, so a player
 * reading the manager camera can tell what month it is without looking at the
 * clock.
 *
 * One number for the whole map, not nine thousand.
 *
 * A per-cell depth field would let you plough a path and leave the rest white,
 * which sounds better until you price it: it is 9216 more floats in every save,
 * a per-cell write every tick, and a new chore for a colony that already has
 * more jobs than settlers. A single depth buys the whole readable effect — the
 * valley goes white, the drifts slow everyone down, the thaw takes it away —
 * for one field and no save-format change. The player's answer to it is the one
 * they already have: **lay a floor**. Boards and paving are the ground somebody
 * made, and they are the ground the snow does not settle on, which turns a path
 * from a small speed bonus into the thing that keeps the colony moving in
 * February.
 *
 * Plain data and plain arithmetic. No randomness is drawn here — the same seed
 * has the same winter.
 */

import { outdoorTemp, seasonMeanTemp } from './temperature';
import { type Terrain, type World, terrainAt, terrainSpeed } from './types';
import { snowfall } from './weather';
import { msg } from './world';

/**
 * Ticks of unbroken blizzard to bury the valley from bare to full.
 *
 * Half a game day. Long enough that a passing squall leaves a dusting rather
 * than a whiteout — a front only lasts a fifth to a quarter of a day — so deep
 * snow means the weather has genuinely been at it, and it is a fortnight of
 * winter that piles it up rather than any one storm.
 */
const COVER_TICKS = 2400;

/**
 * How warm it has to get before the pack starts going.
 *
 * Two degrees rather than zero, because snow does not vanish the instant the air
 * touches freezing, and because zero is where the sky is already deciding
 * between rain and snow — putting the melt on the same line would make a colony
 * sitting at 0 °C flicker between covered and clear all afternoon.
 */
const MELT_ABOVE = 2;

/** Ticks to strip a full pack at ten degrees over that. */
const MELT_TICKS_AT_TEN = 12000;

/**
 * How cold the *ground* has to be before what lands on it stays there.
 *
 * The air can go below freezing for three hours before dawn in the middle of
 * July — a summer storm drops it far enough that sleet genuinely falls — and
 * without this the valley wakes up white in high summer, which is not a season
 * this game has. Snow landing on warm earth melts as it lands, and the earth's
 * temperature is the month's, not the hour's, so this is read off the season
 * mean rather than off the thermometer. It puts the settling window at roughly
 * the back half of autumn through to the front of spring, which is precisely
 * where a player expects to be shovelling.
 */
const SETTLE_ALL = 4;
const SETTLE_NONE = 12;

function settleShare(world: World): number {
  const ground = seasonMeanTemp(world);
  return Math.max(0, Math.min(1, (SETTLE_NONE - ground) / (SETTLE_NONE - SETTLE_ALL)));
}

/**
 * How much of your speed the deepest snow takes, on ground nobody has floored.
 *
 * A third, and no more. This multiplies every haul, every trip to the stove and
 * every walk to a burning cabin for a quarter of the year, so it has to be
 * something a colony feels and plans around rather than something that quietly
 * strangles it — deep snow at a third is about a day's worth of lost work over a
 * winter, and a paved road through the base gives most of it back.
 */
const SNOW_DRAG = 0.35;

/**
 * What a cell of snow costs A*, derived rather than typed.
 *
 * Losing a third of your speed and taking half again as long are the same fact
 * said twice, so this is `SNOW_DRAG` rearranged and not a second opinion about
 * it. It matters that they cannot drift apart: the pathfinder picking the route
 * and the legs walking it have to agree about which way home is quicker, or a
 * settler ploughs across the yard past a swept road because the planner never
 * heard about the weather.
 *
 * Note what is *not* exaggerated here. `moveCost` overstates the floor discount
 * on purpose — A* has to want a road enough to give up a diagonal for it — and
 * the snow term rides on top of that, so a plain reading of the true slowdown is
 * already amplified where it lands. Overstating it twice would send settlers on
 * absurd detours to reach three cells of paving.
 */
export const SNOW_PATH_COST = 1 / (1 - SNOW_DRAG) - 1;

/**
 * The ground snow settles on.
 *
 * Grass, soil, sand and stone: everything the valley made itself. Not water,
 * which does its own thing and is not walked on anyway; not rock, because a
 * cliff face is vertical and a white boulder reads as a rendering fault; and
 * emphatically not a laid floor. That last exclusion is the whole design: the
 * one ground with no snow on it is the ground a settler built, which is why the
 * inside of a floored cabin stays clear and why paving the yard is worth doing
 * before the first front rather than after it.
 */
export const SNOW_GROUND: ReadonlySet<Terrain> = new Set<Terrain>(['grass', 'dirt', 'sand', 'stone']);

/** Does snow settle on this ground at all? The one place that decides. */
export function holdsSnow(kind: Terrain): boolean {
  return SNOW_GROUND.has(kind);
}

/** How deep the pack is, 0 bare to 1 buried. Absent on an old save reads as bare. */
export function snowDepth(world: World): number {
  return world.snow ?? 0;
}

/** How much snow is lying on a kind of ground — the pack, or nothing at all. */
export function snowCover(world: World, kind: Terrain): number {
  return holdsSnow(kind) ? snowDepth(world) : 0;
}

/** How much snow is lying on a cell. */
export function snowAt(world: World, x: number, y: number): number {
  return snowCover(world, terrainAt(world, x, y));
}

/**
 * How fast anything walks over a cell *today*, snow included.
 *
 * The one function anything that moves should ask, and the reason the drag is
 * here rather than at the call sites: a settler and the body the player is
 * standing in have to be slowed by the same drift, or the first-person view
 * stops being a window onto the same simulation and becomes a second opinion
 * about it. `tests/architecture.test.ts` holds the seam shut — nothing outside
 * this file may read `terrainSpeed` directly.
 */
export function groundSpeed(world: World, x: number, y: number): number {
  return terrainSpeed(world, x, y) * (1 - snowAt(world, x, y) * SNOW_DRAG);
}

/** Deep enough to be worth saying out loud, and shallow enough to call it gone. */
const LYING = 0.15;
const GONE = 0.02;

/**
 * One tick of snowpack.
 *
 * Both halves run every tick rather than one or the other, because sleet is
 * real: at +1 °C snow is falling *and* the pack is not quite melting, and at
 * +4 °C it can be coming down and going away at once. Adding both and clamping
 * is the honest version and it is one line shorter than the branch.
 */
export function tickSnowpack(world: World): void {
  const before = snowDepth(world);
  const fall = (snowfall(world) * settleShare(world)) / COVER_TICKS;
  const melt = Math.max(0, outdoorTemp(world) - MELT_ABOVE) / 10 / MELT_TICKS_AT_TEN;
  const after = Math.max(0, Math.min(1, before + fall - melt));
  world.snow = after;

  if (before < LYING && after >= LYING) {
    msg(world, 'Snow is lying on the ground. Bare earth is slow going until the thaw.', 'info');
  } else if (before > GONE && after <= GONE) {
    msg(world, 'The thaw has taken the last of the snow off the ground.', 'good');
  }
}
