/**
 * How hard the valley bites.
 *
 * Until now every colony landed in the same valley on the same terms, and the
 * only thing a player could change about a run was the seed under it. That is a
 * problem at both ends of the table: the ten-year-old who wants to build a farm
 * loses it to the third raid and stops playing, and the player who has founded
 * Aetherhold once has nothing left to prove by doing it again.
 *
 * So: one setting, three settings' worth of run.
 *
 * **Three axes, each honestly named.** For a while this was one axis — threat —
 * and the note here said it deliberately touched nothing else, because a "kind"
 * difficulty that quietly fed the colony would make the larder charter
 * meaningless and the balance untestable. Half of that was right and half of it
 * was an excuse. It was true that an unstated, unmeasured hand on the food
 * supply would be dishonest; it did not follow that the food supply had to be
 * untouchable. What was actually missing was an instrument, and the balance grid
 * is that instrument, so the charter is now the stricter and more useful thing:
 *
 *   - `respite`, `band`, `bite`, `tech`, `grace` — **the treeline**. How often
 *     something comes, how many, how hard they hit, how well armed.
 *   - `larder` — **what the valley hands you on day one**, and nothing else.
 *   - `upkeep` — **how fast a settler burns through food, sleep and patience**.
 *
 * The rule that replaces "one axis" is that every one of these is declared, is
 * measured on the grid, and is bounded against the others: `principles.ts`
 * asserts that difficulty moves the treeline by multiples while it moves the
 * larder by a fraction. A player choosing Hard country is choosing a harder
 * valley, not a valley that lies to them about what a wall costs — the price of
 * everything on the board is still the price of everything on the board.
 *
 * The grid also found the reason this had to change. All three settings used to
 * start on the same larder, and harsh *still* ended thirty days on a third less
 * food than calm, because a settler who is shooting is not farming. Scarcity was
 * already a difficulty axis; it was just an undeclared one. `larder` makes it
 * something the setup card can be held to.
 *
 * **The middle setting is exactly the old game.** Every multiplier on `settler`
 * is 1, and every call site multiplies *after* it draws, so the same seed on the
 * default difficulty produces the identical run it produced before this file
 * existed — same numbers, same raids, same map. That is not tidiness: the eval
 * sweeps, the survival harness and the seed contract in `tests/hunting.test.ts`
 * are all measured against that run, and a difficulty setting that shifted it by
 * a rounding would have silently invalidated the lot.
 *
 * **The opening beat is the same on all three.** One club-armed straggler, on
 * every difficulty, because that raid is a tutorial — it teaches drafting and
 * costs a bandage. Hard country gets it sooner and everything after it is worse.
 */

import type { Difficulty, World } from './types';

export interface DifficultyDef {
  id: Difficulty;
  /** What the setup card calls it. */
  label: string;
  /** One sentence, in the player's terms, about what they are choosing. */
  blurb: string;
  /**
   * Multiplier on the days of quiet between threat beats. Bigger is kinder.
   *
   * This is the lever that matters most, and the reason is `steward.ts`: nearly
   * everything a colony does — a wall, a field, a research project, a round trip
   * over the ridge — is measured in days, so doubling the gap between raids does
   * not halve the danger, it doubles how much colony there is to defend by the
   * time the next one lands.
   */
  respite: number;
  /** Multiplier on how many raiders come. Rounded, and never below one. */
  band: number;
  /** Multiplier on raider health and marksmanship. */
  bite: number;
  /**
   * Multiplier on the odds a raider carries a rifle rather than a club.
   *
   * Split out of `bite` because it is the one threat dial the player can watch
   * land. Health and aim are felt as a fight going badly; a rifle is read off
   * the screen the moment the band breaks the treeline, and it changes what the
   * player should *do* — a club mob can be met in the open, and riflemen have to
   * be fought from behind something. Scaling it with the rest meant the setting
   * that most needed to change that decision moved it the least.
   */
  tech: number;
  /** Multiplier on the quiet before the very first beat. */
  grace: number;
  /**
   * Multiplier on the supplies stacked in the stockpile on day one.
   *
   * Deliberately the *stores* and not the map. The ore, the woods, the water and
   * the soil are the same on all three settings, so a seed is still a place, and
   * the eval harness can still compare two settings on one valley and know the
   * ground under them is identical. What changes is how long the colony can live
   * off what the last lot left behind before it has to feed itself.
   */
  larder: number;
  /**
   * Multiplier on how fast settlers burn food, rest and recreation.
   *
   * This is the "how tightly must I manage this" dial. Threat is answered by
   * drafting once every day or two; upkeep is answered by the schedule, the
   * kitchen and the number of beds, and it is felt continuously rather than in
   * beats. It is the smallest number in the table on purpose — needs feed
   * mood, mood feeds breaks, and breaks feed the next raid, so a little of it
   * travels a long way.
   */
  upkeep: number;
}

/**
 * The three valleys.
 *
 * Three rather than five because every one of them has to be worth playing, and
 * a five-step slider is four steps of "slightly more of the same" around one
 * real choice. These are three different games: one you build in, one you hold,
 * and one you lose.
 */
export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  calm: {
    id: 'calm',
    label: 'Quiet valley',
    blurb:
      'Trouble comes about half as often, in smaller bands, mostly with clubs, and hits softer. ' +
      'You start with a fuller store and eat through it more slowly. The valley still bites — it ' +
      'just gives you time to get a wall up first.',
    respite: 1.9,
    band: 0.6,
    bite: 0.8,
    tech: 0.5,
    grace: 1.8,
    larder: 1.35,
    upkeep: 0.85,
  },
  settler: {
    id: 'settler',
    label: 'Settler',
    blurb:
      'The valley as it was written. Something comes out of the treeline every day or two, and ' +
      'what comes grows as you do.',
    respite: 1,
    band: 1,
    bite: 1,
    tech: 1,
    grace: 1,
    larder: 1,
    upkeep: 1,
  },
  harsh: {
    id: 'harsh',
    label: 'Hard country',
    blurb:
      'They come sooner, in greater numbers, and better armed — expect rifles early. You land ' +
      'with a thinner store and your settlers wear through it faster. For a colony that has ' +
      'already held one valley and wants to know whether it was luck.',
    respite: 0.68,
    band: 1.4,
    bite: 1.18,
    tech: 1.4,
    grace: 0.6,
    larder: 0.75,
    upkeep: 1.12,
  },
};

/** Kindest first, so the setup card reads left to right as "harder". */
export const DIFFICULTY_ORDER: Difficulty[] = ['calm', 'settler', 'harsh'];

/**
 * What this colony is being played on.
 *
 * Absent means `settler`, which covers both a save written before there was a
 * setting and every world the tests and the eval harness build — so the default
 * path through this function is the old game, exactly.
 */
export function difficultyOf(world: World): DifficultyDef {
  return DIFFICULTIES[world.difficulty ?? 'settler'];
}
