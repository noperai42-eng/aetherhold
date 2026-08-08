/**
 * Peaceful wildlife: the herds that graze the map, and the meat they leave.
 *
 * This is deliberately *not* the `wildlife` faction — that one is the maddened
 * thornback the storyteller sends to eat somebody. These are `fauna`: nothing in
 * the game is hostile to them and they are hostile to nothing, so a turret does
 * not waste steel on a passing hare and a settler does not break off cooking to
 * shoot at one. The only way an animal takes damage is a hunter who was told to
 * take it, which is what makes the food loop a decision rather than an event.
 *
 * Why they exist at all: before this, food came from crops and only from crops.
 * That is one loop, on one clock, that a fire or a bad growing patch stops dead.
 * Hunting is a second food supply with a different shape — it costs a bullet and
 * a walk instead of a season, and it hands the drafted-combat skills a use in
 * peacetime.
 */

import {
  bushAt,
  bushCell,
  ensureBushes,
  isRipeBush,
  nearestRipeBush,
  ripeBushes,
  stripBush,
} from './berries';
import { dist, hasLineOfSight, isWalkable, nearestWalkable } from './grid';
import {
  animalSex,
  bodyScale,
  BREED_INTERVAL,
  inPen,
  isAdult,
  livestock,
  MATURE_TICKS,
  penCapacity,
  penTarget,
} from './livestock';
import { followPath, moveWithCollision, opensDoors, setPathTo, WALK_SPEED } from './movement';
import { isPet, mournPet, PET_REPATH, petHeel, petPace } from './pets';
import {
  BITE_REACH,
  CHASE_REPATH,
  isFed,
  isHunter,
  nearestHunter,
  preyFor,
  PREY_ALARM,
} from './predators';
import { wildRegionAt } from './regions';
import { Rng } from './rng';
import { addItem, msg } from './world';
import { makePawn } from './pawn';
import type { AnimalKind, Pawn, World } from './types';
import { TICKS_PER_DAY, unpackX, unpackY } from './types';

export interface AnimalDef {
  label: string;
  hp: number;
  /** Raw food dropped where it falls. */
  meat: number;
  /**
   * Hides dropped alongside the meat.
   *
   * Deliberately a smaller number than the meat and a much scarcer one across the
   * map: a colony can eat a dunhare a day and still take most of a week to dress
   * one settler, which is what makes a mossback worth crossing the valley for and
   * what keeps the wardrobe a thing the colony works towards rather than a thing
   * it has.
   */
  hide: number;
  /** Cells per tick while wandering. Fleeing is this times `FLEE_SPEEDUP`. */
  speed: number;
  /** How close a person gets before it starts backing away. */
  wary: number;
  /** Render scale, and how big it reads on the ground. */
  size: number;
  /**
   * Ticks from birth to old age taking it, whatever else does not.
   *
   * A year here is twenty days, so these are lives measured in years the way a
   * player would measure them: a mossback makes two, a dunhare barely one. Long
   * enough that nobody watches a clock, short enough that a colony which plays
   * out a few years buries the herd it started with and eats the herd that herd
   * bred — which is the only way keeping animals becomes a thing you tend rather
   * than a number that goes up.
   */
  life: number;
  /** It eats the other three. Absent on everything that is somebody's dinner. */
  hunts?: boolean;
  /**
   * It eats the bramblebushes, and starves when it cannot find one.
   *
   * The only species with a food supply of its own. Mossbacks and dunhares are
   * assumed to be eating grass, which is to say they are assumed — nothing in the
   * game models it, their numbers answer to a cap and a respawn clock and nothing
   * else. A browser's numbers answer to how many bushes are in fruit, which is
   * what turns three species standing near each other into a chain: see
   * `berries.ts`.
   */
  browses?: boolean;
}

export const ANIMALS: Record<AnimalKind, AnimalDef> = {
  // Big, slow, worth the walk. One mossback is most of a week of meals, which is
  // what makes marking one a real decision instead of free food.
  mossback: {
    label: 'Mossback',
    hp: 58,
    meat: 34,
    hide: 9,
    speed: WALK_SPEED * 0.42,
    wary: 4.5,
    size: 1,
    life: TICKS_PER_DAY * 40,
  },
  // Small and quick. Not worth a rifle on its own, but they are everywhere, and
  // a colony that is one day from empty can always find one.
  dunhare: {
    label: 'Dunhare',
    hp: 16,
    meat: 9,
    hide: 2,
    speed: WALK_SPEED * 0.72,
    wary: 7,
    size: 0.45,
    life: TICKS_PER_DAY * 22,
  },
  // Barely worth shooting, and that is the point of it. Three raw food is a
  // quarter of a settler's day, so nobody sends a hunter after one — a
  // brambletail matters because of what it does to the brambles and what the
  // wolves do to it, not because of the meat. It is the one animal on the map a
  // player watches rather than harvests.
  //
  // Sixteen days is short even for an animal that lives a year in twenty, and it
  // has to be: this is the species whose numbers are supposed to visibly answer
  // to how much fruit is on the moor, and a population that takes a month to
  // notice a bad season is a population the player never connects to the cause.
  // It shipped at twelve for one afternoon, which turned out to be shorter than
  // the species could outbreed — the opening eleven arrive aged across the first
  // half of their lives, so at twelve days every one of them is gone inside eight
  // and the moor empties out with nothing having eaten anything.
  brambletail: {
    label: 'Brambletail',
    hp: 6,
    meat: 3,
    hide: 0,
    speed: WALK_SPEED * 0.85,
    wary: 9,
    size: 0.3,
    life: TICKS_PER_DAY * 16,
    browses: true,
  },
  // The one that is not food. Faster than anything it eats and unbothered by
  // people — `wary: 0` is not an oversight, it is the whole character of the
  // animal: it walks past a settler to get at what it came for. Worth killing,
  // though: a wolf is a coat and a couple of days of meals, which is what makes
  // "go out and deal with it" a decision rather than a chore.
  fenwolf: {
    label: 'Fenwolf',
    hp: 44,
    meat: 12,
    hide: 6,
    speed: WALK_SPEED * 1.05,
    wary: 0,
    size: 0.7,
    life: TICKS_PER_DAY * 30,
    hunts: true,
  },
};

/** How much faster a frightened animal moves than a grazing one. */
const FLEE_SPEEDUP = 3.4;
/**
 * Ticks of that full sprint before the animal is winded.
 *
 * Without this a hunt could not end. A bolting mossback moves at 1.4× a person's
 * walk, so the first bullet opened a gap the hunter could never close again and
 * the job ran to its timeout with the deer still standing. Prey outsprints a
 * human and loses to one over distance; the burst is the whole of that, and it is
 * what turns a hunt into a pursuit with an ending.
 */
const FLEE_BURST = 70;
/** What a winded animal trots at — under a walk, so a hunter gains on it. */
const WINDED_SPEED = WALK_SPEED * 0.7;
/** Ticks an animal keeps running after the last thing that scared it. */
export const FLEE_TICKS = 220;
/** Ticks between re-rolls of a wandering animal's heading. */
const WANDER_INTERVAL = 45;

/**
 * How many animals the map carries, at the density the 96×96 valley had.
 *
 * A cap rather than a target: above it nothing new walks in, which is what stops a
 * colony that never hunts from ending up knee-deep in deer. Density rather than a
 * flat number, because a bigger map with the same fourteen animals is not a bigger
 * wilderness — it is the same wilderness with longer walks between the parts of it
 * worth walking to.
 */
const ANIMALS_PER_CELL = 14 / (96 * 96);

export function populationCap(world: World): number {
  return Math.max(8, Math.round(world.width * world.height * ANIMALS_PER_CELL));
}
/** Average ticks between arrivals while under the cap (~35 s at 20 Hz). */
const RESPAWN_INTERVAL = 700;

/** How long one stripped bush keeps a brambletail going. */
const BROWSE_FULL = Math.round(TICKS_PER_DAY * 0.75);
/**
 * Ticks of empty after that before it dies of it.
 *
 * The down-slope of the food chain, and the reason a colony that shoots every
 * wolf in the valley does not simply end up with more brambletails forever: the
 * ones with nothing left to eat go, quietly and off-screen, exactly like the ones
 * age takes. Two days is long enough that a brambletail crosses most of the map
 * looking first — a starving population visibly spreads out before it thins,
 * which is the part the player can actually watch happen.
 */
const BROWSE_STARVE = TICKS_PER_DAY * 2;
/** How far a hungry one will look for fruit. Most of a valley, over two days. */
const BROWSE_RANGE = 60;
/** Close enough to have its head in it. */
const BROWSE_REACH = 0.9;
/** Ticks between re-routes while walking to a bush that something else may take first. */
const BROWSE_REPATH = 90;
/**
 * Ticks an animal waits before re-asking for a route it has already been refused.
 *
 * A successful A* stops the moment it touches the destination. A *failed* one is
 * the most expensive call in the sim: it has no choice but to expand every cell it
 * can reach before it can honestly say there is no way through. On a hundred and
 * twenty-eight cells square that is about eight milliseconds — and an animal whose
 * quarry is across the lake asks for that route again on the very next tick, and
 * the tick after that, forever.
 *
 * Measured, not guessed: a five-wolf pack with brambletails scattered over the far
 * bank cost forty milliseconds a tick between them, against eight for the entire
 * rest of the valley. Four fifths of the tick budget spent re-proving the lake is
 * still there. Backing the retry off to once every fifteen ticks costs nothing a
 * player can see — the fallback lean is already carrying the animal at the thing
 * it wants while it waits — and gives the frame back.
 *
 * Deliberately not a "give up" flag. The lake does not move, but gates open, walls
 * come down and the prey itself walks; anything that remembered a refusal would
 * eventually be wrong about the map, and being wrong here means an animal standing
 * still forever within sight of the thing it is starving for.
 */
export const REROUTE_RETRY = 15;
/**
 * Mean ticks between litters for a brambletail that has been eating.
 *
 * Fast — a fed pair doubles in under a week — and it has to be, because this is
 * the term that pushes back. Slow breeding would make wolves a strict tax on the
 * bushes; at this rate a valley with no predators in it fills up with browsers
 * inside a season and eats the moor bare, which is the outcome the whole slice
 * exists to make possible.
 *
 * Two days rather than the three this shipped as, and the correction came from
 * running the moor rather than from reading it. Three days is about two litters
 * across a female's prime, which is bare replacement on paper and well under it in
 * a valley — mates have to *find* each other — so a moor left entirely alone went
 * from eleven brambletails to one in eight days, killed by nothing but the
 * calendar. A chain whose middle link dies out on its own is not a chain, and the
 * wolves in it are decoration.
 */
const BROWSE_LITTER = TICKS_PER_DAY * 2;
/**
 * How far apart a pair can be and still breed.
 *
 * Twenty and not the eight a penned herd uses, because a pen is a pen and this is
 * a hundred and twenty-eight cells of moor. Eight is a rounding error out here:
 * two brambletails on the same bramble patch are routinely twelve cells apart, and
 * a radius that says they have never met is a radius that quietly sterilises the
 * species.
 *
 * Still twenty on a map half again as wide, and deliberately: the answer to a
 * bigger moor is `MATE_SEEK_RANGE` below, not a bigger number here. A radius is a
 * statement about how close two animals have to be to breed, which is a fact about
 * the animals; stretching it to cover a map is using it to say something about the
 * map instead, and it stops being either.
 */
const BROWSE_MATE_RANGE = 20;

/**
 * How far a fed animal will walk to find one of its own kind to breed with.
 *
 * The term the whole food chain was missing, and the 192-cell moor is what made
 * that impossible to keep ignoring. Breeding is a pair rule — a fed prime female
 * needs a prime male inside `BROWSE_MATE_RANGE` — and until now nothing in the
 * game ever *arranged* for that to be true. A hungry brambletail walks to fruit; a
 * fed one re-rolls its heading every couple of seconds and drifts. Pairing was
 * left to two random walks happening to coincide.
 *
 * Which works, quietly and by luck, while the valley is small and full. Twenty
 * cells is a twelfth of a 128-cell map and there are fourteen animals on it, so
 * somebody is usually near somebody. Widen the map to 192 and the same radius
 * covers three per cent of it with four animals scattered over the rest, and the
 * arithmetic falls off a cliff: measured over a thousand colony-free days, the
 * species sat between two and six against a food supply that would carry
 * thirty-four, with ninety per cent of the moor's fruit standing untouched. Not
 * starving — the doc above spent a paragraph on starving and starving was not what
 * was happening. They were dying of old age at sixteen days having never met.
 * Every brambletail alive on day 500 had walked in off the map edge under the
 * stranded-respawn trickle, which is a species on life support, not a population.
 *
 * So a fed adult with nobody in range goes looking. Ninety cells is most of the
 * moor's half-width — far enough that two animals anywhere in the same region find
 * each other inside a day or two, which is well inside a sixteen-day life. It
 * lands below `browse` in the ladder on purpose: hunger first, always. An animal
 * that walked past fruit to court would starve on the way, and the population
 * would answer to loneliness instead of to the berry count, which is precisely the
 * link this file exists to keep honest.
 *
 * It applies to wolves for the same reason and with the same shape — see
 * `wildBreeder`. Two species, one behaviour, because "a fed adult that cannot find
 * a mate goes looking for one" is not a fact about squirrels.
 */
const MATE_SEEK_RANGE = 90;
/**
 * Ticks between re-aims at a mate, which is itself walking about.
 *
 * Slack, and it can be: two animals converging do not need either route to be
 * right, only to be roughly toward the other. Half a minute of stale heading costs
 * a few cells of overshoot and saves a search per animal per tick.
 */
const MATE_REPATH = 120;

/**
 * Route an animal to a cell, on two clocks, remembering refusals.
 *
 * The three cases the callers below all have and none of them should spell out:
 *
 * - It has a route and this is not a refresh tick. Leave it alone.
 * - It has no route and was not just refused one. Ask now — this is an animal
 *   coming off the mark, and hesitating would read as it noticing late.
 * - It has no route because the last ask *failed*. Wait `REROUTE_RETRY`.
 *
 * The third case is the whole point, and it is the same bug `chargeRaider` already
 * carries a `pathFailedAt` for: a failed search leaves `path` null, which reads to
 * the next tick as "has not looked yet", so it looks again immediately and forever.
 * Structured the same way here on purpose — one failure mode should not have two
 * shapes in one codebase.
 *
 * Exported for the test that pins it, because the property is invisible from
 * outside — a wolf that re-asks every tick and one that backs off look identical
 * and cost eight times differently.
 */
export function routeTo(
  world: World,
  animal: Pawn,
  tx: number,
  ty: number,
  every: number,
  latch: boolean,
): void {
  if (animal.path) {
    if ((world.tick + animal.id) % every !== 0) return;
  } else if (
    animal.pathFailedAt !== undefined &&
    world.tick - animal.pathFailedAt < REROUTE_RETRY
  ) {
    return;
  }
  animal.path = null;
  animal.pathFailedAt = setPathTo(world, animal, tx, ty, latch) ? undefined : world.tick;
}

/** It lives on the bushes. */
export function isBrowser(pawn: Pawn): boolean {
  return pawn.animal !== undefined && ANIMALS[pawn.animal]?.browses === true;
}

/**
 * How many wild browsers the moor will carry, in bushes.
 *
 * A browser strips one bush every three quarters of a day and a bush needs six to
 * come back, so the moor feeds one animal per eight bushes and starvation does the
 * rest. Breeding stops a little under that on purpose — at exactly the ceiling the
 * population sits where every berry is eaten the hour it ripens, which is a valley
 * with no fruit in it for either the colony or the player to find. Ten bushes an
 * animal leaves a standing crop.
 *
 * This is where the whole feature's balance actually lives, and it reads off the
 * fruit rather than off the map: a rocky valley the generator could only fit forty
 * bushes into carries four squirrels, and nobody has to keep a second constant in
 * step with the first. `populationCap` still caps it as the runaway backstop.
 */
const BUSHES_PER_BROWSER = 10;

function browserCap(world: World): number {
  return Math.max(2, Math.min(populationCap(world), Math.round(ensureBushes(world).length / BUSHES_PER_BROWSER)));
}

/**
 * Is there a pair of wild browsers left — one of each, both grown, neither past it.
 *
 * The distinction this draws is the whole reason the species stopped coming back.
 * The old guard asked whether any were *left*, and the answer was yes. Measured
 * over forty days on three seeds, the population overshoots its fruit in the second
 * week, starves down, and then sits at **exactly one** for the rest of the run while
 * the brambles ripen back to ninety per cent and nothing touches them. One
 * brambletail is not a population, it is a survivor: it cannot pair, so it cannot
 * breed, so the valley is as finished with the species as if the last one had gone.
 * The only difference is that the old guard could see it standing there and called
 * the matter settled.
 *
 * So this asks the question that actually decides it. A lone animal, three males,
 * and a moor of half-grown kits all read the same way here, because they all end
 * the same way. Same rule as the litter check below — grown, in season, and not the
 * same animal twice — so the two cannot drift into disagreeing about whether a
 * species has a future.
 */
function browsersCanBreed(world: World): boolean {
  let male = false;
  let female = false;
  for (const p of world.pawns) {
    if (p.dead || p.faction !== 'fauna' || p.tame === true) continue;
    if (!isBrowser(p) || !canBreed(world, p)) continue;
    if (animalSex(p) === 'm') male = true;
    else female = true;
    if (male && female) return true;
  }
  return false;
}

/**
 * A browser population that cannot come back on its own, on a moor that could feed
 * one if it did.
 *
 * Ordered for the tick loop rather than for the sentence: the pair check walks the
 * pawn list only until it has found one of each, which on a healthy valley is a
 * handful of comparisons, and the two counts behind it — the fruit's ceiling and
 * whether any of it is standing — are only paid once that has already come back
 * empty. This runs every tick of the game, and a valley in good health should pay
 * almost nothing to be told so.
 */
function strandedBrowsers(world: World, browsers: number): boolean {
  if (browsersCanBreed(world)) return false;
  return browsers < browserCap(world) && ripeBushes(world).length > 0;
}

/**
 * An animal whose numbers are supposed to come from this valley rather than from
 * the respawn clock: a wild browser, or a wild predator.
 *
 * The grazers are not on this list and that is the design, not an omission. A
 * mossback answers to `populationCap` and to animals walking in off the edge —
 * it is the moor's *supply*, deliberately steady, and a deer herd that bred and
 * starved on its own clock would make the one number the colony plans its winter
 * around jump about for reasons no player could see. Two species breed out here,
 * and both of them are links in the chain rather than the ground it stands on.
 */
function wildBreeder(pawn: Pawn): boolean {
  if (pawn.faction !== 'fauna' || pawn.dead || pawn.tame === true) return false;
  return isBrowser(pawn) || isHunter(pawn);
}

/**
 * The nearest one of its own kind worth walking to, or null if it should stay put.
 *
 * Null in three quite different situations, and collapsing them is the point:
 * there is nobody, or there is somebody and they are already close enough to
 * breed, or this animal is not the sort that goes looking. All three mean "carry
 * on grazing", and the caller should not have to know which.
 *
 * Deliberately not "the nearest mate" — it is the nearest mate *outside*
 * `BROWSE_MATE_RANGE`. An animal already standing next to one has nothing to walk
 * to, and a seeker that kept walking at a partner it had already reached would
 * shove the pair across the map together and never let either of them eat.
 *
 * O(n) over the pawn list, and it runs for the handful of animals that are fed,
 * grown and alone — never for a hungry one, a penned one, or a herd of deer. On a
 * full valley that is a few animals against a hundred and fifty pawns a tick,
 * which is cheaper than one of the A\* searches it saves by giving them somewhere
 * definite to be.
 */
function mateFor(world: World, animal: Pawn): Pawn | null {
  if (!wildBreeder(animal) || !canBreed(world, animal)) return null;
  const sex = animalSex(animal);
  let best: Pawn | null = null;
  let bestD = MATE_SEEK_RANGE;
  for (const p of world.pawns) {
    if (p.id === animal.id || p.animal !== animal.animal) continue;
    if (!wildBreeder(p) || !canBreed(world, p) || animalSex(p) === sex) continue;
    const d = dist(animal.x, animal.y, p.x, p.y);
    // Somebody is already in range: there is nothing to walk to, whatever else is
    // out there. Returned rather than skipped, so a valley with a pair standing
    // together in it stops looking the moment it finds them.
    if (d < BROWSE_MATE_RANGE) return null;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * How much meat has to be walking about the valley to keep one wolf in it.
 *
 * Meat and not head count, and the difference is the whole reason the first
 * version of this died out. Counting animals makes a brambletail worth a mossback,
 * and a brambletail is three raw food against thirty-four — so the ceiling rose
 * with every squirrel boom, the wolves bred into the slack, the boom broke a
 * fortnight later as it is designed to, and a population sized to a hundred and
 * thirty squirrels found itself sized to nine. Measured: six wolves on day ten,
 * four on twenty, one on forty, none on fifty, and none for the hundred and fifty
 * days after that. The prey count had not moved much. Its composition had, and a
 * cap that could not see the difference tracked the noisiest term in it.
 *
 * Weighted, it reads off the deer — which is the steady term, held near
 * `populationCap` by the respawn clock — and the squirrels move it by a few per
 * cent instead of by half. Two hundred and sixty is about eight mossbacks, and it
 * puts five wolves on a full 192-cell moor against the three-to-six that come down
 * in an encounter. That comparison is the intended one: the residents are the
 * weather, and a pack arriving is still an event.
 */
const MEAT_PER_WOLF = 260;
/**
 * How far from the middle of the map a wolf den has to be seeded.
 *
 * Forty cells is past the open ground the colony lands in and short of the rim,
 * so the residents are somewhere a scout finds them rather than somewhere the
 * opening walks into. It is a worldgen rule and nothing else: nothing stops a
 * wolf walking to the fence on day nine, which is the point of having them.
 */
const DEN_KEEPOUT = 40;
/**
 * Mean ticks between litters for a wolf that has been eating.
 *
 * Read against `GORGE_TICKS` rather than against the calendar, because unlike a
 * brambletail — which is fed almost all the time once it finds a hedge — a wolf is
 * only fertile for the half-day after a kill. Eight days looks slower than a
 * squirrel's two and is in fact about a fifth of that once the fed window is taken
 * into account: it worked out at roughly one litter per female per lifetime, which
 * is a species going quietly extinct on paper. Three days puts it near two, which
 * is a population, and still leaves killing the wolves off a valley worth most of a
 * season to the player who does it.
 */
const WOLF_LITTER = TICKS_PER_DAY * 3;
/**
 * Ticks without a kill before the moor takes a wolf.
 *
 * Three times a brambletail's grace, because a wolf's food runs away and a bush
 * does not. This is the term that closes the loop: thin the herd and the wolves
 * that were living on it go too, so a valley the player has hunted bare is a
 * valley with nothing hunting them either — and both sides come back together, in
 * that order, when it recovers.
 *
 * Six days, and the three it shipped as is a good illustration of why a mean is
 * the wrong thing to size a grace period against. Instrumented over three weeks,
 * a resident wolf on a full moor ate about every two and a half days — comfortably
 * inside four — and the population still went five, four, three, two, one, none
 * between day eight and day nineteen. Every one of those deaths but the last was
 * starvation. The mean was never the problem: prey bolts, chases fail, and a wolf
 * that draws two bad hunts in a row is at three and a half days with nothing wrong
 * with it. A limit set near the average kills the unlucky quarter of the
 * population every fortnight, which no birth rate at this cap can cover. Six is
 * two and a half average gaps, so a wolf has to genuinely be somewhere with
 * nothing in it to die of hunger.
 */
const WOLF_STARVE = TICKS_PER_DAY * 6;

/**
 * How many wolves the moor's own prey will carry.
 *
 * Reads off the animals actually standing on the map, exactly as `browserCap`
 * reads off the fruit, and for the same reason: the chain has to be one number a
 * step down from the one under it or it is not a chain, it is three populations
 * with a story about them. `browserCap` gets to count bushes because every bush is
 * the same bush; this one has to weigh, because the things it counts differ by a
 * factor of eleven — see `MEAT_PER_WOLF`.
 *
 * Tame animals are counted, and calves at a calf's share. A pen is prey, and a
 * colony that fills a paddock with goats has made the valley better at feeding
 * wolves — which it should have to find out, ideally the hard way.
 */
export function wolfCap(world: World): number {
  let meat = 0;
  for (const p of world.pawns) {
    if (p.faction !== 'fauna' || p.dead || p.hunts === true) continue;
    meat += ANIMALS[p.animal ?? 'dunhare'].meat * bodyScale(world, p);
  }
  return Math.floor(meat / MEAT_PER_WOLF);
}

/**
 * Is there a breeding pair of wild wolves left — one of each, both grown?
 *
 * Word for word the question `browsersCanBreed` asks, one link up the chain, and
 * it is here for the same reason that one is: a species is finished the moment it
 * cannot pair, not the moment the last of it dies, and the gap between those two
 * events is a fortnight of a valley that looks fine and has already ended.
 */
function wolvesCanBreed(world: World): boolean {
  let male = false;
  let female = false;
  for (const p of world.pawns) {
    if (!isHunter(p) || !wildBreeder(p) || !canBreed(world, p)) continue;
    if (animalSex(p) === 'm') male = true;
    else female = true;
    if (male && female) return true;
  }
  return false;
}

/**
 * The valley can feed wolves and has no pair left to make them.
 *
 * The same escape hatch `strandedBrowsers` opens, and the run that proved it was
 * needed reads almost identically: five wolves on day eight, none on day nineteen,
 * and none for the two hundred and eighty days after that, on a moor carrying
 * enough deer for five the whole time. Nothing was wrong on day nineteen — a
 * species had simply been rolled out of existence by ordinary bad luck, and there
 * was no way back onto the map because wolves, unlike deer, had no arrivals.
 *
 * So they get some, on the strictest terms in the file: only when there is no pair
 * left, and only when the herd would carry one. A trickle any looser would make
 * the wolf count a reading of the respawn clock rather than of the herd, which is
 * precisely the mistake the brambletail comment upstairs spends a paragraph
 * refusing to make.
 */
function strandedWolves(world: World, wolves: number): boolean {
  if (wolvesCanBreed(world)) return false;
  return wolves < wolfCap(world);
}

export function livingAnimals(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'fauna' && !p.dead);
}

/** Marked for the hunters, still alive, and not already somebody's job. */
export function isHuntable(pawn: Pawn): boolean {
  return pawn.faction === 'fauna' && !pawn.dead && pawn.hunted === true;
}

export function animalDef(pawn: Pawn): AnimalDef {
  return ANIMALS[pawn.animal ?? 'dunhare'];
}

/**
 * How much of its life a wild animal has already spent when it walks onto the map.
 *
 * Not zero, because a valley where every animal was born the day the colony
 * noticed it is a valley with no history — the first winter would kill the entire
 * population at once and then nothing would die again for two years. Not more than
 * this either: an arrival is somewhere between newly grown and middle-aged, never
 * one that is about to drop, so the herd on the map at hour one behaves exactly as
 * it did before any of this existed.
 */
export const ARRIVES_AGED = 0.45;

/**
 * The fraction of a life after which nothing more is bred.
 *
 * The pen's real clock. Without it a tamed pair is a permanent engine and the only
 * question left is how much pen to paint; with it, a herd is something you have to
 * replace yourself, out of its own calves, before the pair that started it stops.
 */
export const BREEDS_UNTIL = 0.75;

/**
 * A stable number in `[0, span)` off an id, for spreading ages without rolling.
 *
 * Same argument as `animalSex`: worldgen spends one shared stream in order and a
 * draw here would move every seed in the game. Different constants from the sex
 * mix on purpose — an animal's age must not be a function of its sex, or every
 * male on the map would be the older one.
 */
function ageSpread(id: number, span: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 2246822507);
  h = Math.imul(h ^ (h >>> 15), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) % Math.max(1, Math.floor(span));
}

/** Give an animal the birthday it must have had to be walking around today. */
function stampBirthday(world: World, animal: Pawn): void {
  const def = animalDef(animal);
  animal.born = world.tick - MATURE_TICKS - ageSpread(animal.id, def.life * ARRIVES_AGED);
}

/** Ticks lived. Anything with no birthday reads as newly grown — see `livestock.ts`. */
export function ageOf(world: World, animal: Pawn): number {
  return world.tick - (animal.born ?? world.tick - MATURE_TICKS);
}

/** Where in its life it is, in the three words a player needs. */
export function lifeStage(world: World, animal: Pawn): 'calf' | 'prime' | 'old' {
  if (!isAdult(world, animal)) return 'calf';
  return ageOf(world, animal) >= animalDef(animal).life * BREEDS_UNTIL ? 'old' : 'prime';
}

/** Grown, and not yet past it. */
export function canBreed(world: World, animal: Pawn): boolean {
  return lifeStage(world, animal) === 'prime';
}

export function spawnAnimal(
  world: World,
  rng: Rng,
  kind: AnimalKind,
  x: number,
  y: number,
): Pawn | null {
  const spot = nearestWalkable(world, x, y, 8);
  if (!spot) return null;
  const def = ANIMALS[kind];
  const beast = makePawn(world, rng, 'fauna', spot.x, spot.y, {
    name: def.label,
    weapon: 'none',
  });
  beast.animal = kind;
  beast.hp = def.hp;
  beast.maxHp = def.hp;
  // Copied onto the pawn rather than looked up through the species table every
  // time, which is what lets `predators.ts` be written without knowing what a
  // fenwolf is. See the note on `Pawn.hunts`.
  if (def.hunts) beast.hunts = true;
  // A browser arrives having just eaten. Without this every brambletail on the
  // map would start its life two days from starving, and a valley seeded at dusk
  // would lose the lot of them before the first bush the colony ever saw ripened.
  if (def.browses) beast.fed = world.tick + BROWSE_FULL;
  // A wolf arrives hungry — `world.tick`, not `world.tick + something`. That reads
  // as "last ate exactly now", which `isFed` sees as empty (it wants `fed` strictly
  // ahead of the clock) and the starvation check sees as a fresh clock. Both halves
  // matter and they pull opposite ways: leaving it undefined is the same "empty" to
  // `isFed` but reads as zero elapsed to the starve check forever, which is a wolf
  // that never dies; filling it in like a browser puts the pack that just walked in
  // at your pens to sleep for half a day, which is the encounter not happening.
  if (def.hunts) beast.fed = world.tick;
  // Everything that walks onto the map has already lived some of its life. The pen
  // overwrites this on a calf, which is the one animal in the game whose birthday
  // is a fact rather than an inference — see `tickBreeding`.
  stampBirthday(world, beast);
  // Animals have no jobs, no needs and no skills that matter. Zeroing shooting
  // keeps them out of any "who is the best shot" query that walks every pawn.
  beast.skills.shooting = 0;
  return beast;
}

/**
 * Seed the map with herds. Called from worldgen with its own derived stream, so
 * adding wildlife did not shift a single terrain roll on any existing seed.
 */
export function spawnInitialFauna(world: World, rng: Rng): void {
  // Scaled off the same density as the cap, so the valley the player lands in is
  // as full as the map is big rather than as full as the 96×96 map used to be.
  const scale = (world.width * world.height) / (96 * 96);
  // Mossbacks in small groups (a herd reads as a herd), hares scattered singly.
  for (let herd = 0; herd < Math.round(3 * scale); herd++) {
    const hx = 6 + rng.int(world.width - 12);
    const hy = 6 + rng.int(world.height - 12);
    for (let i = 0; i < 2 + rng.int(2); i++) {
      spawnAnimal(world, rng, 'mossback', hx + rng.int(5) - 2, hy + rng.int(5) - 2);
    }
  }
  for (let i = 0; i < Math.round(5 * scale); i++) {
    spawnAnimal(world, rng, 'dunhare', 4 + rng.int(world.width - 8), 4 + rng.int(world.height - 8));
  }
  // Brambletails on the bushes rather than anywhere, because a squirrel standing
  // in the middle of a stone field is a squirrel with nothing to do but starve —
  // and because the first one a player sees should be sitting in the fruit, which
  // is the entire explanation of what it eats delivered without a word of UI.
  const bushes = ensureBushes(world);
  for (let i = 0; i < Math.round(6 * scale) && bushes.length > 0; i++) {
    const b = rng.pick(bushes);
    spawnAnimal(world, rng, 'brambletail', unpackX(world, b.c), unpackY(world, b.c));
  }
  // And the thing that eats all of the above.
  //
  // Until this line the only fenwolf that ever existed was the one the storyteller
  // sent at the colony, which meant the valley's food chain had a top link that
  // was not in the valley — it was in `encounters.ts`, aimed at the player, and it
  // went home afterwards. A thousand colony-free days confirmed the obvious
  // reading: no colony, no wolves, ever, and the moor ran as two grazer species
  // that nothing on the map could touch.
  //
  // So a few live here. Not a pack — a pack is still an event, still arrives, still
  // leaves — but a resident population that breeds off what it kills and starves
  // when it cannot, sitting at whatever `wolfCap` says the herd will carry. In
  // pairs, because a lone wolf on a 192-cell moor is a wolf that dies without
  // issue, and seeding a species with no future is the same bug this file already
  // fixed once for brambletails.
  //
  // Spawned last on purpose. Everything above it is what it eats, so the count
  // that decides how many is already standing on the map by the time this runs.
  //
  // And out on the moor, never in the yard. `DEN_KEEPOUT` is the one rule about
  // where: a pair that happens to roll the middle of the map is a colony that
  // lands on turn one inside somebody's larder with no rifle built yet, which is
  // not an opening, it is a coin toss. Rerolled rather than nudged, because
  // sliding a den to the edge of the keep-out ring would put every map's wolves
  // on the same circle.
  const packs = Math.max(1, Math.round(scale / 2));
  const hx = world.width / 2;
  const hy = world.height / 2;
  for (let pack = 0; pack < packs; pack++) {
    let wx = 0;
    let wy = 0;
    for (let tries = 0; tries < 40; tries++) {
      wx = 6 + rng.int(world.width - 12);
      wy = 6 + rng.int(world.height - 12);
      if (dist(wx, wy, hx, hy) >= DEN_KEEPOUT) break;
    }
    for (let i = 0; i < 2; i++) {
      spawnAnimal(world, rng, 'fenwolf', wx + rng.int(5) - 2, wy + rng.int(5) - 2);
    }
  }
}

/**
 * An animal walks in from off the map to replace one that was taken.
 *
 * `stranded` says the valley's browsers can no longer breed themselves back (see
 * `strandedBrowsers`); `herdRoom` says the grazers are still under the ground's own
 * ceiling. At least one of the two is true or this is not called at all.
 */
function respawn(world: World, rng: Rng, stranded: boolean, herdRoom: boolean, lone: boolean): void {
  // A wolf, if the moor has room for one and nothing left to breed it. Checked
  // first and taken unconditionally, because the gate is the narrowest in the file
  // — no pair anywhere and prey standing to feed it — and losing that turn of the
  // clock to a coin flip against a deer is losing the only way the species has of
  // getting back onto a map it has been rolled off.
  //
  // In from an edge like everything else, and singly. It will find the other one:
  // a fed wolf with nobody in range goes looking, which is `MATE_SEEK_RANGE`, and
  // ninety cells covers most of the moor.
  if (lone) {
    const edge = rng.int(4);
    const run = 5 + rng.int(world.height - 10);
    const across = 5 + rng.int(world.width - 10);
    spawnAnimal(
      world,
      rng,
      'fenwolf',
      edge === 0 ? 2 : edge === 1 ? world.width - 3 : across,
      edge === 0 || edge === 1 ? run : edge === 2 ? 2 : world.height - 3,
    );
    return;
  }
  // Brambletails do not commute. Their numbers are supposed to be a reading of
  // this valley's fruit, and a steady trickle of them wandering in off the edge
  // would wash that out — the population would track the respawn clock like
  // everything else does and the chain would go back to being decoration.
  //
  // The one exception is a population that cannot come back on its own, which is
  // not a state the map should be able to get stuck in: a valley whose last pair
  // was broken in week two would leave a player with brambles nothing touches for
  // the rest of the run, and no way to tell that from the feature being broken. So
  // when there is no pair left and there is fruit standing, some find their way
  // back.
  //
  // And when the grazers are at their ceiling, the arrival can *only* be one of
  // those, because the gate was opened for them and for nothing else. Rolling a
  // mossback there would push the herd over a cap the rest of the file is written
  // to respect, and would leave the squirrels stranded for another turn of the
  // clock — which, when the deer sit at the cap for weeks at a time, means forever.
  const kind: AnimalKind =
    stranded && (!herdRoom || rng.chance(0.4))
      ? 'brambletail'
      : rng.chance(0.45)
        ? 'mossback'
        : 'dunhare';
  const side = rng.int(4);
  const along = 5 + rng.int(world.width - 10);
  const x = side === 0 ? 2 : side === 1 ? world.width - 3 : along;
  const y = side === 0 || side === 1 ? along : side === 2 ? 2 : world.height - 3;
  spawnAnimal(world, rng, kind, x, y);
}

/**
 * The animal gives in and joins the colony.
 *
 * Called from the tame job when the handler has stood with it long enough. It
 * stays `fauna` rather than becoming `colony` on purpose: a goat has no mood, no
 * skills and no vote on the work board, and promoting it to the colony faction
 * would quietly hand it all three.
 */
export function settleAnimal(world: World, animal: Pawn): void {
  animal.tame = true;
  animal.tameTarget = false;
  // A tamed animal is not a hunt target any more, whatever was marked before.
  animal.hunted = false;
  animal.fleeUntil = 0;
  // And it is not going anywhere. Coaxing one out of a passing herd is the whole
  // reason to send a handler out to meet one, and an animal that walked off the
  // map the evening after it was tamed would make that a waste of a day.
  animal.migrateTo = undefined;
  animal.path = null;
  msg(world, `${animalDef(animal).label} is tame — it joins the herd.`, 'good');
}

/**
 * Livestock in a pen with room in it occasionally produce a calf.
 *
 * Needs a grown male and a grown female of the same species standing inside the
 * pen. It used to need any two of a species, which made a pen a machine with one
 * input — tame two of anything and wait — and made the answer to "how big is the
 * herd" a function of nothing but how much pen had been painted. A pair is the
 * smallest rule that turns taming into a decision with a wrong answer, and the
 * one every player already expects to be true.
 *
 * The cap is still the pen's carrying capacity, so growing the herd also means
 * painting more pen. Both costs are real and neither substitutes for the other.
 */
export function tickBreeding(world: World, rng: Rng): void {
  const cap = penCapacity(world);
  if (cap <= 0) return;
  // Pets are not counted against the pen's carrying capacity. They do not eat its
  // grass — they are off across the map at somebody's heel — and charging the pen
  // for them would mean a player who bonded three animals quietly stopped getting
  // calves and had nothing on any panel to tell them why.
  const herd = livestock(world).filter((a) => !isPet(a));
  if (herd.length >= cap) return;

  // Calves and old animals count against the cap — they eat the same grass — but
  // neither can be half of the pair. A pen where the only female is a week-old
  // calf has to wait; a pen where she is fifteen years old has to be replaced.
  // That is the whole point of an age: it runs out at both ends.
  const inside = herd.filter((a) => inPen(world, a.x, a.y) && canBreed(world, a));
  const bySpecies = new Map<AnimalKind, Pawn[]>();
  for (const a of inside) {
    const kind = a.animal ?? 'dunhare';
    const list = bySpecies.get(kind);
    if (list) list.push(a);
    else bySpecies.set(kind, [a]);
  }

  for (const [kind, pair] of bySpecies) {
    const dam = pair.find((a) => animalSex(a) === 'f');
    if (!dam || !pair.some((a) => animalSex(a) === 'm')) continue;
    if (!rng.chance(1 / BREED_INTERVAL)) continue;
    const calf = spawnAnimal(world, rng, kind, Math.round(dam.x), Math.round(dam.y));
    if (!calf) continue;
    calf.tame = true;
    // The one place in the game anything is born, and so the one place a birthday
    // is written. Everything else on the map walked in grown.
    calf.born = world.tick;
    msg(world, `A ${ANIMALS[kind].label.toLowerCase()} calf is born in the pen.`, 'good');
    // One birth per tick at most: two pens calving on the same frame would read as
    // a glitch, and the interval is long enough that it never actually matters.
    return;
  }
}

/**
 * How long a herd stands one sex short before the colony says so out loud.
 *
 * A pair rule without this is a trap: the player tames two mossbacks, paints a
 * pen, waits a week, gets nothing, and has no way to learn why except by reading
 * the source. Half a game day of it standing true, then one line, then quiet for
 * a day — long enough that it is never the answer to "I just tamed something",
 * short enough that nobody waits a week.
 */
const PAIR_HINT_AFTER = TICKS_PER_DAY / 2;
const PAIR_HINT_GAP = TICKS_PER_DAY;

/**
 * Tell the player when their pen cannot breed for a reason they cannot see.
 *
 * Only for a species with two or more grown animals penned that still cannot
 * make a pair — all one sex, or all past their years, or both. That is precisely
 * the case where the pen looks like it should be working and is not. One of
 * anything is obviously not a pair and needs no explanation; a full pen has a
 * different message already.
 */
export function tickHerdHint(world: World): void {
  if (penCapacity(world) <= 0) return;
  const herd = livestock(world).filter((a) => !isPet(a));
  if (herd.length >= penCapacity(world)) return;
  const bySpecies = new Map<AnimalKind, Pawn[]>();
  for (const a of herd) {
    if (!inPen(world, a.x, a.y) || !isAdult(world, a)) continue;
    const kind = a.animal ?? 'dunhare';
    const list = bySpecies.get(kind);
    if (list) list.push(a);
    else bySpecies.set(kind, [a]);
  }
  for (const [kind, pen] of bySpecies) {
    if (pen.length < 2) continue;
    const breeders = pen.filter((a) => canBreed(world, a));
    const males = breeders.filter((a) => animalSex(a) === 'm').length;
    if (breeders.length >= 2 && males !== 0 && males !== breeders.length) {
      // This species is fine. Reset its clock so a herd that loses its only bull
      // next month gets told again rather than staying quiet on an old stamp.
      world.pairSince = undefined;
      return;
    }
    if (world.pairSince === undefined) {
      world.pairSince = world.tick;
      return;
    }
    if (world.tick - world.pairSince < PAIR_HINT_AFTER) return;
    const label = ANIMALS[kind].label.toLowerCase();
    // Three ways a grown herd fails to be a pair, and the player can see none of
    // them from the outside. The last one is the herd that had it right for a
    // year and let the years do the rest — the sentence has to say that plainly,
    // because the fix is new blood, not more pen.
    const needs = males === breeders.length ? 'female' : 'male';
    msg(
      world,
      breeders.length === 0
        ? `Every ${label} in the pen is past breeding — this herd will not grow again without new blood.`
        : pen.every((a) => animalSex(a) === 'm')
          ? `Every ${label} in the pen is male — there will be no calves until a female joins them.`
          : pen.every((a) => animalSex(a) === 'f')
            ? `Every ${label} in the pen is female — there will be no calves until a male joins them.`
            : `No ${needs} ${label} in the pen is young enough to breed — there will be no calves until one joins them.`,
      'info',
    );
    world.pairSince = world.tick + PAIR_HINT_GAP;
    return;
  }
  world.pairSince = undefined;
}

/** Nearest person, if one is close enough to be worth running from. */
function nearestPerson(world: World, animal: Pawn, within: number): Pawn | null {
  let best: Pawn | null = null;
  let bestD = within;
  for (const p of world.pawns) {
    if (p.dead || p.faction === 'fauna') continue;
    const d = dist(animal.x, animal.y, p.x, p.y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * Move the herds, and turn anything that died into meat on the ground.
 *
 * Runs on the `main` stream, which the tick loop otherwise never touches — so
 * wildlife cannot perturb the weather, the storyteller or a single bullet.
 */
export function tickWildlife(world: World, rng: Rng): void {
  let alive = 0;
  let travelling = 0;
  const carcasses: number[] = [];
  const departed: number[] = [];
  /** Wild animals old age caught up with, taken off the map without a word. */
  const aged: number[] = [];
  /** Browsers that ran out of fruit. Same silent exit as old age, same reason. */
  const starved: number[] = [];
  /**
   * Where a wild litter is due, spawned after the sweep rather than mid-iteration.
   *
   * Carries its species now that two of them breed out here. It could have been
   * inferred from the ground — a litter on a bramble patch is a brambletail — and
   * that would be wrong the first time a wolf whelped in the fruit.
   */
  const litters: Array<{ x: number; y: number; kind: AnimalKind }> = [];
  /**
   * Wild browsers alive right now, for the litter cap.
   *
   * Counted up front rather than as the sweep goes, because a running total is
   * whatever fraction of the population happens to sit ahead of this animal in the
   * pawn list — so the first female checked always reads the moor as empty and the
   * ceiling only ever binds on the last few. One extra pass over thirty-odd pawns
   * is cheaper than a cap that means something different depending on spawn order.
   */
  let browsers = world.pawns.filter((p) => p.faction === 'fauna' && !p.dead && p.tame !== true && isBrowser(p)).length;
  /** Wild predators alive right now, for their own litter cap. Same argument. */
  let wolves = world.pawns.filter((p) => p.faction === 'fauna' && !p.dead && p.tame !== true && isHunter(p)).length;
  // Read once, before anything is eaten. A cap that fell as the sweep killed things
  // would mean the wolves at the front of the pawn list bred against a fuller moor
  // than the ones at the back, which is spawn order deciding the population again.
  const wolfRoom = wolfCap(world);

  for (const animal of world.pawns) {
    if (animal.faction !== 'fauna') continue;
    if (animal.dead) {
      // Somebody's, and so nobody's dinner. Bonding an animal is giving up the
      // meat on it — decided once, on the day it was tamed — and a colony that
      // ate a settler's companion and called it four raw food would be telling
      // the player the bond was never real. See `pets.ts`.
      if (isPet(animal)) {
        mournPet(world, animal);
        carcasses.push(animal.id);
        continue;
      }
      // A wolf had it, and a wolf leaves nothing. Without this a pack in the yard
      // is free food and the player's correct move is to sit and watch — see
      // `predators.ts`. Said nowhere here: `feast` already announced the kill.
      if (animal.eaten === true) {
        carcasses.push(animal.id);
        continue;
      }
      // Dropped where it fell, so the hauling loop that already exists carries it
      // home. No butchering step: one more work type between a kill and a meal
      // would be busywork, not a decision.
      const def = animalDef(animal);
      // A calf is a quarter of an animal and grows into a whole one. Without this
      // the fastest meat in the game would be breeding a calf and killing it the
      // same afternoon, which is a pen used as a button rather than a herd.
      const grown = bodyScale(world, animal);
      // Nobody eats a beast that died of itself. The hide is still a hide, so the
      // loss is the meat and only the meat — which is exactly the cost of having
      // left it too long, and the reason an old animal in the pen is a decision
      // rather than a number on a card.
      const meat = animal.aged === true ? 0 : Math.max(1, Math.round(def.meat * grown));
      const hide = def.hide > 0 ? Math.max(1, Math.round(def.hide * grown)) : 0;
      if (meat > 0) {
        world.stats.rawGathered = (world.stats.rawGathered ?? 0) + meat;
        addItem(world, 'rawfood', meat, Math.round(animal.x), Math.round(animal.y));
      }
      // Dropped on the same cell as the meat, so one hauling trip fetches both and
      // a colony that hunts for food ends up with a hide pile whether it meant to
      // or not — which is how the wardrobe gets started without a second job type.
      if (hide > 0) addItem(world, 'hide', hide, Math.round(animal.x), Math.round(animal.y));
      // Nothing said for an animal age took: it already got its own line, on the
      // tick it died, and a second one reading "0 raw food" would land like a bug.
      if (animal.aged !== true) {
        msg(
          world,
          `${grown < 1 ? `${def.label} calf` : def.label} down — ${meat} raw food and ${hide} hide on the ground.`,
          'good',
        );
      }
      carcasses.push(animal.id);
      continue;
    }

    // A herd that is passing through either passes through or gives up trying.
    // Reaching the far side is the whole event ending; the deadline is the
    // fallback for an animal that got itself wedged behind a rock face on the
    // way, which then simply lives here now — see `Pawn.migrateTo`.
    if (animal.migrateTo) {
      if (dist(animal.x, animal.y, animal.migrateTo.x, animal.migrateTo.y) < 2.5) {
        departed.push(animal.id);
        continue;
      }
      if (world.tick > animal.migrateTo.until) {
        animal.migrateTo = undefined;
        animal.path = null;
      } else travelling++;
    }

    // Age, and then the end of it. A save written before animals had one, and any
    // animal worldgen placed before this existed, gets the birthday it must have
    // had; everything the game spawns from here already carries its own.
    if (animal.born === undefined) stampBirthday(world, animal);
    if (ageOf(world, animal) >= animalDef(animal).life) {
      if (animal.tame === true) {
        // In the pen it is a death, because the pen is where the player knows the
        // animal. `aged` is what the carcass sweep reads to leave the meat out of
        // it: nobody eats a beast that died of itself, and an old animal that paid
        // out its full slaughter would make old age free.
        animal.dead = true;
        animal.aged = true;
        // Bonded animals get their own headline from `mournPet` when the sweep
        // picks them up, and it is a better one than this. Two lines about the
        // same death would make the smaller one look like a duplicate bug.
        if (!isPet(animal)) {
          msg(
            world,
            `Old age takes the ${animalDef(animal).label.toLowerCase()} in the pen — a hide, and nothing anyone will eat.`,
            'bad',
          );
        }
        continue;
      }
      // Out on the moor it is not a death anybody sees. Scattering full carcasses
      // across the map would turn the wilderness into a pantry a colony could
      // walk out and find, which is the opposite of what hunting is for. The herd
      // simply thins, and the respawn clock brings the next one in.
      aged.push(animal.id);
      continue;
    }

    // Hunger, for the one species that has any. Wild only: a penned animal is the
    // colony's problem and livestock have never eaten in this game, so starving
    // the goats now would be a food-supply feature smuggled in under a squirrel.
    //
    // Taken off the map rather than killed, exactly like old age out on the moor
    // — a valley strewn with the bodies of things nobody shot would read as a bug,
    // and a colony that could walk out and collect free meat from a famine among
    // the wildlife would be getting paid for the thing that is supposed to cost it.
    // The same two clauses one link up the chain: a wolf that has not killed
    // anything in four days goes, and one that has been eating has cubs. Written
    // out rather than shared with the browser block below because the two are only
    // the same shape, not the same rule — a browser's ceiling is the fruit, a
    // wolf's is the herd, and folding them into one loop over "wild breeders"
    // would put a `kind === ...` in the middle of it and make both harder to read
    // than either is now.
    //
    // An encounter pack falls in here too, which is right on both counts. They eat
    // constantly, so the starve clock never bites inside their day and a half; and
    // `wolfRoom` is the moor's ceiling, so a pack that arrives on a full valley
    // simply does not breed while it is here. It leaves, and the residents are
    // where they were.
    if (isHunter(animal) && animal.tame !== true) {
      if (world.tick - (animal.fed ?? world.tick) > WOLF_STARVE) {
        starved.push(animal.id);
        wolves--;
        continue;
      }
      if (
        animalSex(animal) === 'f' &&
        canBreed(world, animal) &&
        isFed(world, animal) &&
        wolves + litters.length < wolfRoom &&
        rng.chance(1 / WOLF_LITTER) &&
        world.pawns.some(
          (m) =>
            m.id !== animal.id &&
            !m.dead &&
            m.animal === animal.animal &&
            m.tame !== true &&
            animalSex(m) === 'm' &&
            canBreed(world, m) &&
            dist(m.x, m.y, animal.x, animal.y) < BROWSE_MATE_RANGE,
        )
      ) {
        litters.push({ x: Math.round(animal.x), y: Math.round(animal.y), kind: animal.animal! });
      }
    }

    if (isBrowser(animal) && animal.tame !== true) {
      if (world.tick - (animal.fed ?? world.tick) > BROWSE_STARVE) {
        starved.push(animal.id);
        browsers--;
        continue;
      }
      // Fed, grown, and standing near a grown male of its own kind: a litter.
      //
      // This is the only breeding in the game that happens outside a pen, and the
      // condition that makes it worth having is `fed`. A brambletail that has been
      // eating multiplies; one that is crossing the moor looking for fruit does
      // not. That single clause is what makes the bush count and the squirrel
      // count the same number one step apart, and it is why shooting the wolves
      // eventually costs the player their berries.
      //
      // Same pair rule as the pen and for the same reason — a population that
      // grew off one animal would make the wolves' effect on it arithmetic rather
      // than a real thinning — but at moor range rather than pen range. The roll
      // comes first and the neighbour scan second, so the O(n²) only runs a few
      // times a minute.
      if (
        animalSex(animal) === 'f' &&
        canBreed(world, animal) &&
        (animal.fed ?? 0) > world.tick &&
        browsers + litters.length < browserCap(world) &&
        rng.chance(1 / BROWSE_LITTER) &&
        world.pawns.some(
          (m) =>
            m.id !== animal.id &&
            !m.dead &&
            m.animal === animal.animal &&
            m.tame !== true &&
            animalSex(m) === 'm' &&
            canBreed(world, m) &&
            dist(m.x, m.y, animal.x, animal.y) < BROWSE_MATE_RANGE,
        )
      ) {
        litters.push({ x: Math.round(animal.x), y: Math.round(animal.y), kind: animal.animal! });
      }
    }

    // Browsers are not counted against the herd's carrying capacity, and this one
    // line is the whole reason a valley with squirrels in it still has deer in it.
    // `populationCap` is the number of animals the moor round the fence should
    // feel like it holds, and it was measured with mossbacks and hares in mind —
    // a squirrel is a tenth the size of a mossback and is not a hunting resource
    // at all, so charging one against that budget would quietly delete a third of
    // the deer on every map to make room for something nobody shoots. They answer
    // to `browserCap` instead, which reads off the fruit rather than the ground.
    // And neither is a wolf, now that some of them live here. `populationCap` is a
    // count of what the moor *feeds*, and the wolves are the other end of that
    // sentence — charging them against it would mean every cub born quietly
    // stopped a deer from walking in, so a valley that got better at predation
    // would get worse at prey by exactly the same number and the whole chain would
    // flatten into one constant. They answer to `wolfCap`, which is the herd.
    if (!isBrowser(animal) && !isHunter(animal)) alive++;

    const def = animalDef(animal);
    // Decided once, before anything moves, and then handed to every route and
    // every step this animal takes below. A door is a wall to the wild and a
    // doorway to anything the colony keeps — see `opensDoors`. Reading it here
    // rather than at each call site is what stops the two halves drifting apart
    // and letting something route round a gate and then slide through it.
    const latch = opensDoors(animal);
    const scared = (animal.fleeUntil ?? 0) > world.tick;
    // A hunted animal is not yet a frightened one — it only bolts once a shot
    // lands. Being wary of people at all is what makes hunting take a stalk.
    let threat: Pawn | null = null;
    if (isHunter(animal)) {
      // A wolf minds nobody until somebody puts a bullet in it. `wary: 0` would
      // do the same thing through `nearestPerson`, but saying it here is what
      // stops the next person from "fixing" the zero.
      if (scared) threat = nearestPerson(world, animal, 14);
    } else if (animal.tame === true) {
      // Livestock never bolt from people, hurt or not. A goat has nowhere to run
      // to, and a slaughter the animal can outrun at 3.4× a walk is a job that
      // never ends. From a wolf it bolts like anything else — a pen that stood
      // still and watched would not read as animals at all.
      threat = nearestHunter(world, animal, PREY_ALARM);
    } else if (animal.tameTarget === true && !scared) {
      // Being coaxed in: it holds still for the handler. Without this a handler
      // could never close the last four cells, because wariness would push the
      // animal out of reach exactly as fast as they walked in — the tame job
      // would have been a job nobody could finish. Not for a wolf, though: the
      // one thing that will make an animal break off a taming is being eaten.
      threat = nearestHunter(world, animal, PREY_ALARM);
    } else {
      threat =
        nearestPerson(world, animal, scared ? 14 : def.wary) ??
        nearestHunter(world, animal, PREY_ALARM);
    }

    // A crossing is not called off by the sight of something, only by being shot
    // at. The migrate branch below already says so — "a herd under fire still
    // bolts" — and under fire is `scared`; shying is the other thing, and it is
    // what an animal does when it lives here and has all day.
    //
    // Handing a *travelling* animal both rules is a pair of opposed forces with no
    // memory between them, and they settle exactly where you would expect. Seed
    // 17's herd crossed a hundred and eighty cells and then stopped dead thirty-
    // seven short of the far edge, in open grass, for eight thousand ticks: two
    // fenwolves stood at 6.99 and 7.10 cells away and `PREY_ALARM` is 7. Tick one,
    // inside the ring, shy back at 1.5x and drop the route. Tick two, outside it,
    // re-path and walk in at 1.2x. Net zero, twice a tick, until the patience
    // deadline expired and seven mossbacks decided they lived here now.
    //
    // Nothing registers as wrong while it happens, which is the part worth saying:
    // `stuck` counts steps that were *refused*, and neither of these was — both
    // moved, in full, in opposite directions. Any pair of rules that pull opposite
    // ways across a radius will do this; the deadlock is not the radius.
    //
    // So the herd walks past the wolves. If one of them wants a mossback it can
    // take it, and the bite is what turns the crossing into a bolt.
    if (threat && !scared && animal.migrateTo) threat = null;

    let dx = 0;
    let dy = 0;
    const heel = petHeel(world, animal);
    const leash = penTarget(world, animal);
    const quarry = isHunter(animal) ? preyFor(world, animal) : null;
    // Where the nearest fruit is, if this animal lives on fruit and is out of it.
    // A cell rather than the bush itself, because arriving is a distance question
    // and everything below deals in cells.
    //
    // Filtered to fruit on this animal's own side of the walls, under the rule it
    // actually walks by — a door is a wall to everything out here. The straight
    // line does not know about the colony's barn, so before this a brambletail
    // would fix on the nearest hedge, find the shortest way to it ran through a
    // shut door, and spend the rest of the day leaning on the outside of it while
    // an identical hedge stood forty cells the other way. Now it picks the hedge
    // it can get to. `wildRegionAt` is a stored flood fill, so this is an array
    // read per candidate, not a search.
    let browse: { x: number; y: number } | null = null;
    if (isBrowser(animal) && (animal.fed ?? 0) <= world.tick) {
      const here = wildRegionAt(world, Math.round(animal.x), Math.round(animal.y));
      const b = nearestRipeBush(
        world,
        animal.x,
        animal.y,
        BROWSE_RANGE,
        // A negative label means the animal is standing somewhere nothing can
        // stand — shoved inside a wall by a collision. It gets the old, unfiltered
        // answer and walks itself out; a filter keyed on `-1` would match nothing
        // and quietly stop it eating.
        here < 0 ? undefined : (bx, by) => wildRegionAt(world, bx, by) === here,
      );
      if (b) browse = bushCell(world, b);
    }
    // And who it would go looking for, if it is fed, grown, and the nearest one of
    // its own is too far off to breed with. Only asked when the animal has nothing
    // more pressing on — a hungry browser has `browse` set and takes that branch
    // long before this one, a hungry wolf has `quarry` — so the scan is paid for by
    // the small set of animals that would otherwise be standing about grazing.
    const mate = !browse && !quarry && !heel && !leash && !animal.migrateTo ? mateFor(world, animal) : null;
    if (threat) {
      const ang = Math.atan2(animal.y - threat.y, animal.x - threat.x);
      // Every fresh wound restarts the sprint, so a hunt reads as bursts of ground
      // opening up and then closing again rather than one flat footrace.
      const bolting = (animal.fleeUntil ?? 0) - world.tick > FLEE_TICKS - FLEE_BURST;
      const speed = scared
        ? bolting
          ? def.speed * FLEE_SPEEDUP
          : WINDED_SPEED
        : def.speed * 1.5;
      dx = Math.cos(ang) * speed;
      dy = Math.sin(ang) * speed;
      animal.facing = ang;
      animal.activity = 'walking';
      // Bolting takes it off the herd's track. Whatever it does next, it does not
      // do it by resuming a route from wherever it was standing a minute ago.
      if (animal.migrateTo) animal.path = null;
    } else if (quarry) {
      // Running something down. Below the flee branch, so a wolf with a bullet in
      // it drops the chase and goes — a pack the colony can drive off is a pack
      // worth walking out to meet.
      //
      // Routed rather than aimed, for the same reason the pet's follow is: prey
      // bolts through doorways and round rock shoulders, and a wolf that could
      // only walk straight lines would lose every chase it ever started. Re-aimed
      // twice as often as a pet re-aims, because what it is following jinks.
      const away = dist(animal.x, animal.y, quarry.x, quarry.y);
      animal.activity = 'walking';
      if (away <= BITE_REACH) {
        // In among it. Standing still and facing the thing — the bite itself is
        // `tickMaulings`, which runs after every animal has moved, so a kill is
        // never decided from a position half the map has not caught up to yet.
        animal.facing = Math.atan2(quarry.y - animal.y, quarry.x - animal.x);
        animal.path = null;
      } else {
        routeTo(world, animal, Math.round(quarry.x), Math.round(quarry.y), CHASE_REPATH, latch);
        if (animal.path) {
          followPath(world, animal, def.speed, latch);
          animal.animPhase += def.speed * 9;
        } else {
          // No route to it — which, for a wolf, now usually means the thing it
          // wants is behind a shut gate. Aimed straight at it anyway, and left to
          // collision to stop: what the player sees is the pack working along the
          // fence line trying to find a way in, which is both the truth and the
          // best possible advertisement for the wall they just paid for. It is
          // also why this stays a fallback rather than becoming "give up": a wolf
          // that lost interest at the fence would make a pen look like it had
          // scared them off, when what it did was hold.
          const ang = Math.atan2(quarry.y - animal.y, quarry.x - animal.x);
          dx = Math.cos(ang) * def.speed;
          dy = Math.sin(ang) * def.speed;
          animal.facing = ang;
        }
      }
    } else if (heel) {
      // Following its person. Above the leash on purpose: a pet is not livestock
      // and `penTarget` already refuses to hand one a pen, so these two can never
      // both be set — the ordering is here to say which one wins if that ever
      // stops being true.
      //
      // Routed rather than aimed, unlike the leash. A strayed goat walking home
      // across open grass can afford to push at a rock face for a minute; a pet
      // has to be able to come through the door after you, or the first thing the
      // player ever sees it do is fail to follow them indoors.
      const away = dist(animal.x, animal.y, heel.x, heel.y);
      const pace = petPace(def.speed, away);
      // Re-aimed on a stagger, so eight pets do not all re-path on the same tick.
      if (!animal.path || (world.tick + animal.id) % PET_REPATH === 0) {
        animal.path = null;
        setPathTo(world, animal, Math.round(heel.x), Math.round(heel.y), latch);
      }
      animal.activity = 'walking';
      if (animal.path) {
        followPath(world, animal, pace, latch);
        animal.animPhase += pace * 9;
      } else {
        // No route at all — the keeper is across water, or behind a wall that has
        // not been holed yet. Lean towards them anyway rather than stand still:
        // it reads as an animal that wants to get to somebody, and it recovers on
        // its own the moment a way opens.
        const ang = Math.atan2(heel.y - animal.y, heel.x - animal.x);
        dx = Math.cos(ang) * pace;
        dy = Math.sin(ang) * pace;
        animal.facing = ang;
      }
    } else if (leash) {
      // Outside its pen: walk home. Not a hard teleport and not a wall — a strayed
      // animal is visibly on its way back, which is the only way a player can tell
      // "the pen is working" from "the pen does nothing".
      const ang = Math.atan2(leash.y - animal.y, leash.x - animal.x);
      dx = Math.cos(ang) * def.speed * 1.3;
      dy = Math.sin(ang) * def.speed * 1.3;
      animal.facing = ang;
      animal.activity = 'walking';
    } else if (animal.migrateTo) {
      // Crossing, not living here: it walks the route the herd was given, a little
      // faster than grazing pace. Below the flee branch on purpose — a herd under
      // fire still bolts, and picks the crossing up again once it has calmed down,
      // which is why the route is re-found here rather than assumed to survive.
      //
      // A crossing that cannot be walked is not a crossing. Rather than push at
      // the rock for two days, the animal simply lives here now: the same ending
      // the patience deadline gives, arrived at the moment it becomes true.
      if (!animal.path && !setPathTo(world, animal, animal.migrateTo.x, animal.migrateTo.y, latch)) {
        animal.migrateTo = undefined;
      } else {
        animal.activity = 'walking';
        followPath(world, animal, def.speed * 1.2, latch);
      }
    } else if (browse) {
      // Hungry, and there is fruit somewhere. Below every other errand so a
      // brambletail still bolts from a wolf and a tame one still goes home to its
      // pen — an animal that starved rather than break off dinner would be the
      // one thing on this ladder that ignored being eaten.
      //
      // Routed rather than aimed, because the bushes are scattered across the far
      // side of woods and rock the straight line does not go through, and the
      // whole shape of the behaviour is an animal crossing the valley to get to
      // food. Re-routed on a stagger: the bush it set out for may have been
      // stripped by something else, or picked, while it was walking.
      if (dist(animal.x, animal.y, browse.x, browse.y) <= BROWSE_REACH) {
        const bush = bushAt(world, browse.x, browse.y);
        // Something got here first — the ripeness is checked again on arrival
        // rather than trusted from when it set off. Falling through to a fresh
        // target next tick is the whole of the recovery.
        if (bush && isRipeBush(bush)) {
          stripBush(bush);
          animal.fed = world.tick + BROWSE_FULL;
          animal.path = null;
        }
        animal.activity = 'idle';
        animal.facing = Math.atan2(browse.y - animal.y, browse.x - animal.x) || animal.facing;
      } else {
        routeTo(world, animal, browse.x, browse.y, BROWSE_REPATH, latch);
        animal.activity = 'walking';
        if (animal.path) {
          followPath(world, animal, def.speed, latch);
          animal.animPhase += def.speed * 9;
        } else {
          // No route to it: the fruit is across the lake, or behind a wall the
          // colony put up. Lean that way and let collision sort it out, the same
          // fallback the wolf's chase takes — an animal that gave up here would
          // stand still and starve within sight of a hedge full of berries.
          const ang = Math.atan2(browse.y - animal.y, browse.x - animal.x);
          dx = Math.cos(ang) * def.speed;
          dy = Math.sin(ang) * def.speed;
          animal.facing = ang;
        }
      }
    } else if (mate) {
      // Fed, grown, and alone. It goes to find one of its own — the branch that
      // turns two species from respawn-fed populations into breeding ones.
      //
      // Below `browse` and below the wolf's chase, which is the ordering the whole
      // behaviour depends on: an animal that courted while hungry would starve
      // holding a heading, and the numbers out here would stop being a reading of
      // the food. Hunger first, company second, grazing third.
      //
      // Routed, and with the same lean-at-it fallback every other errand here
      // takes. Two brambletails on opposite banks of the lake should visibly try
      // and visibly fail — that is a real fact about the valley, and a species
      // split by water genuinely is two species until somebody bridges it.
      routeTo(world, animal, Math.round(mate.x), Math.round(mate.y), MATE_REPATH, latch);
      animal.activity = 'walking';
      if (animal.path) {
        followPath(world, animal, def.speed, latch);
        animal.animPhase += def.speed * 9;
      } else {
        const ang = Math.atan2(mate.y - animal.y, mate.x - animal.x);
        dx = Math.cos(ang) * def.speed;
        dy = Math.sin(ang) * def.speed;
        animal.facing = ang;
      }
    } else if ((world.tick + animal.id) % WANDER_INTERVAL === 0) {
      // Re-roll the heading occasionally and graze the rest of the time, which is
      // what makes a herd drift across the map over a day instead of jittering.
      animal.facing = rng.range(0, Math.PI * 2);
      animal.activity = rng.chance(0.45) ? 'walking' : 'idle';
    } else if (animal.activity === 'walking') {
      dx = Math.cos(animal.facing) * def.speed;
      dy = Math.sin(animal.facing) * def.speed;
    }

    if (dx !== 0 || dy !== 0) {
      const before = animal.x + animal.y;
      moveWithCollision(world, animal, dx, dy, latch);
      // Walked into something: turn rather than grind against it for a minute.
      if (Math.abs(animal.x + animal.y - before) < 1e-4) animal.facing = rng.range(0, Math.PI * 2);
      animal.animPhase += Math.hypot(dx, dy) * 9;
    }
  }

  // Carcasses leave the world once their meat is on the ground. A body that
  // lingered would keep drawing hunt jobs and rendering as a lump on the grass.
  if (carcasses.length > 0) {
    world.pawns = world.pawns.filter((p) => !carcasses.includes(p.id));
  }

  // The herd walks off the far edge. Said once, when the last of them goes,
  // rather than seven times: the player needs to know the window has closed, and
  // does not need a line per animal to be told it.
  if (departed.length > 0) {
    world.pawns = world.pawns.filter((p) => !departed.includes(p.id));
    if (travelling === 0) msg(world, 'The last of the herd passes out of the valley.', 'info');
  }

  // And the ones age took, on their own list so they cannot trip the line above.
  // "The last of the herd passes out of the valley" said because a hare somewhere
  // got old would be the game reporting an event that did not happen.
  if (aged.length > 0) {
    world.pawns = world.pawns.filter((p) => !aged.includes(p.id));
  }

  // And the ones that ran out of fruit. Silent, on their own list for the same
  // reason: nothing about a squirrel starving on the far side of the valley is an
  // event the colony witnessed.
  if (starved.length > 0) {
    world.pawns = world.pawns.filter((p) => !starved.includes(p.id));
  }

  // Litters last, after every removal, so a kit is never born into a pawn list
  // that is about to be filtered out from under it. Silent as well — the player
  // finds out there are more brambletails by there being more brambletails.
  for (const spot of litters) {
    const kit = spawnAnimal(world, rng, spot.kind, spot.x, spot.y);
    if (kit) kit.born = world.tick;
  }

  // Migrating animals do not hold the map's carrying capacity down: a herd that
  // is halfway across is not the map's wildlife, it is weather. Counting them
  // would mean a colony that hunted its resident deer flat stayed empty for the
  // two days a herd took to cross.
  const herdRoom = alive - travelling < populationCap(world);
  // Browsers are deliberately not counted in `alive` — they answer to the fruit
  // rather than to the ground, see the note by the `alive++` above — and that is
  // exactly why the line above cannot speak for them. On a map whose deer are
  // sitting at their cap it never opens, and the one clause inside `respawn` that
  // was meant to bring brambletails back was parked behind it. Which is how a
  // valley reaches day forty with a hundred and twenty ripe bushes on it and one
  // squirrel: two separate guards, each correct about the herd, and neither of
  // them asking about the species that was actually gone. Stranded browsers get
  // their own way in.
  const stranded = strandedBrowsers(world, browsers);
  // And the same third door for the wolves, opened by the same argument. A moor
  // that can feed predators and has none left to breed is a map stuck in a state
  // it cannot leave, which is the one thing none of these caps are allowed to be.
  const lone = strandedWolves(world, wolves);
  if ((herdRoom || stranded || lone) && rng.chance(1 / RESPAWN_INTERVAL)) {
    respawn(world, rng, stranded, herdRoom, lone);
  }
}

/**
 * Where a hunter should stand to take the shot.
 *
 * A place to *shoot from*, not merely a place to stand. The obvious version — walk
 * to the midpoint and fire — sends the hunter to a cell with a stand of trees
 * between them and the deer, where the shot is never taken; the pair then drift
 * around the wood together until the job times out. So the candidates are every
 * walkable cell inside weapon range of the animal that can see it, and the pick is
 * whichever of those is the shortest walk from where the hunter is now.
 */
export function shootingSpot(world: World, animal: Pawn, from: Pawn, range: number): {
  x: number;
  y: number;
} {
  const ax = Math.round(animal.x);
  const ay = Math.round(animal.y);
  // Stop short of the weapon's limit: standing at the very edge means one step of
  // drift puts the animal back out of range again.
  const reach = Math.max(2, Math.min(range - 1.5, 9));
  const r = Math.ceil(reach);

  const candidates: Array<{ x: number; y: number; walk: number }> = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const away = Math.hypot(dx, dy);
      if (away > reach || away < 1) continue;
      const x = ax + dx;
      const y = ay + dy;
      if (!isWalkable(world, x, y)) continue;
      candidates.push({ x, y, walk: dist(from.x, from.y, x, y) });
    }
  }
  // Nearest first, then the line-of-sight test — which is the expensive half — runs
  // only until the closest workable cell turns up.
  candidates.sort((a, b) => a.walk - b.walk);
  for (const c of candidates) {
    if (hasLineOfSight(world, c.x, c.y, animal.x, animal.y)) return { x: c.x, y: c.y };
  }
  // Nowhere in range can see it: close on the animal instead. Adjacent always has
  // line of sight, so walking in is the fallback that cannot fail to resolve.
  return nearestWalkable(world, ax, ay, 6) ?? { x: ax, y: ay };
}
