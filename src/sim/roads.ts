/**
 * The three roads out of the valley, and where the colony stands on each.
 *
 * `objectives.ts` is the curriculum and `victory.ts` is the exam. Both stop at
 * the founding, which is the end of the first act and — until this file — the
 * end of everything the game was willing to say about where a colony was going.
 * A founded colony kept playing with nothing on screen that moved, which is the
 * same problem the game had before there was a founding at all, one act later.
 *
 * Three roads, from `ENDGAME.md`: **science** builds the ship, **economy** buys
 * the berths, **warfare** takes the ground. Each is a ladder of four rungs and
 * each rung is a thing the colony did, not a number that ticked over.
 *
 * Three rules this file holds itself to, because a scoreboard is easy and a road
 * is not:
 *
 * - **No new simulation.** Every tally here is read off state the world already
 *   keeps — finished projects, standing with the neighbours, raiders put down.
 *   There is no road counter to save, to load, or to drift out of step with the
 *   thing it claims to count, and a colony saved before this file existed reads
 *   its rungs correctly the first time it is opened.
 * - **No rung the game cannot deliver.** Every top rung is somewhere a colony
 *   can actually stand today. The endings those roads point at are stages 4 and
 *   5 and are not built; showing a rung that needs them would be the ladder
 *   promising something the game does not have, which is worse than a short
 *   ladder. `no-road-is-already-finished` is the principle that keeps the other
 *   half of that honest — a road anybody has *finished* is a road that has
 *   stopped being one.
 * - **Every boundary is derived.** The rung counts come from constants the rest
 *   of the game already balances against — the founding's own bars, the shape of
 *   the research tree, the size of a standing band. A ladder with hand-picked
 *   numbers in it is a fourth thing to balance, and it would go stale the first
 *   time the tree or the map grew.
 */

/**
 * `STANDING_BAND` and `CLEAN_PER_STEP` are imported rather than restated: the
 * warfare ladder is measured in bands put down, so a band has to mean the same
 * thing here as it does to the storyteller that sends them.
 */
import { CLEAN_PER_STEP, STANDING_BAND } from './events';
import { RESEARCH, RESEARCH_ORDER } from './research';
import { NEIGHBOUR_COUNT, PER_RING, settlementsOf } from './settlements';
import type { World } from './types';
import { NEED_RELATIONS, NEED_RESEARCH } from './victory';

export type RoadId = 'science' | 'economy' | 'warfare';

/** Rungs per road. Four, on all three, so the panel draws one shape. */
export const ROAD_RUNGS = 4;

/**
 * Projects with no materials bill — the tree a colony can finish without ever
 * leaving the valley. Derived rather than counted, because the third tier is
 * defined by having a bill and the day somebody adds a fourth tier this number
 * should move on its own.
 */
const FREE_PROJECTS = RESEARCH_ORDER.filter((id) => !RESEARCH[id].materials).length;

/** The whole tree. */
const TREE = RESEARCH_ORDER.length;

export interface Road {
  id: RoadId;
  /** One word, for a panel row. */
  title: string;
  /** What this road ends in. The reason to walk it, in one sentence. */
  ending: string;
  /** 0..ROAD_RUNGS — how far along. Zero is a colony that has not started. */
  rung: number;
  /** The name of the rung the colony is standing on, or null below the first. */
  standing: string | null;
  /** The name of the rung it is walking toward, or null at the top. */
  next: string | null;
  /** The tally itself, and the boundary it is measured against next. */
  at: number;
  of: number;
  /** 0..1 toward the next rung — full at the top. */
  progress: number;
  /** The numbers behind the bar, e.g. `17 / 19 projects`. */
  count: string;
  /** Where the work is. A road with no answer is a scoreboard. */
  hint: string;
}

interface Ladder {
  id: RoadId;
  title: string;
  ending: string;
  hint: string;
  /** Four names, low to high. */
  rungs: readonly string[];
  /** Four boundaries, ascending — the tally each rung needs. */
  needs: readonly number[];
  /** Singular — the economy road's first boundary is one place, not one places. */
  unit: string;
  at(world: World): number;
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * The science road: the research tree, read at its own joints.
 *
 * The boundaries are the tree's structure rather than four evenly spaced
 * numbers. `NEED_RESEARCH` is the founding's own science bar, so the first rung
 * is the one a colony has already cleared on the day it is founded and the road
 * starts where the first act stopped. The second is the free tree finished. The
 * third is the foundry branch, which is the first thing in the game that cannot
 * be had without a road. The fourth is everything.
 */
const SCIENCE: Ladder = {
  id: 'science',
  title: 'Science',
  ending: 'Build the ship, and leave on something you made.',
  hint: 'The bench. Pick the next project in the research panel.',
  rungs: ['Schooled', 'Toolmakers', 'Foundrymen', 'Machinists'],
  needs: [NEED_RESEARCH, FREE_PROJECTS, FREE_PROJECTS + 2, TREE],
  unit: 'project',
  at: (w) => w.research.done.length,
};

/**
 * The economy road: how many places out there deal with this colony as a matter
 * of course.
 *
 * Counted in *places at charter standing* rather than in standing summed, and
 * the difference is the whole design. A colony can walk the same near neighbour
 * twenty times and cap out at one friend; the road asks for breadth, which is
 * what "wealth and standing across the whole world and not just the near ridge"
 * meant. The boundaries are one place — the founding's own bar again — then a
 * ring's worth, then two rings, then everywhere. All four come off the map's own
 * shape, so a fourth ring moves the top rung without anybody editing this line.
 */
const ECONOMY: Ladder = {
  id: 'economy',
  title: 'Economy',
  ending: "Buy the berths. Somebody else's ship, your passage, paid for.",
  hint: 'The road. Standing climbs a little with every party that arrives.',
  rungs: ['Friend', 'Circuit', 'Reach', 'House'],
  needs: [1, PER_RING, PER_RING * 2, NEIGHBOUR_COUNT],
  unit: 'place',
  at: (w) => settlementsOf(w).filter((s) => s.relations >= NEED_RELATIONS).length,
};

/**
 * The warfare road: raiders put down, counted in bands.
 *
 * A band is what the storyteller sends, and `CLEAN_PER_STEP` is what it counts
 * before it decides a colony is a pattern rather than a lucky one — so the
 * ladder compounds by three: a band, three bands, nine, twenty-seven. That last
 * is far past anything a sixty-day colony reaches, and deliberately: this is the
 * road that stage 4 turns into off-map campaigning, and a top rung a valley can
 * touch by holding its doorway would have to move the day holdings exist.
 *
 * Put down rather than *repelled*, because a raid that wanders off is a raid the
 * colony survived and not a fight it won, and the difference is the road.
 */
const WARFARE: Ladder = {
  id: 'warfare',
  title: 'Warfare',
  ending: 'Take the ground. You never leave — you become the ones who launch.',
  hint: 'The valley. Hold the line, and hold it again.',
  rungs: ['Blooded', 'Defenders', 'Feared', 'Warlords'],
  needs: [
    STANDING_BAND,
    STANDING_BAND * CLEAN_PER_STEP,
    STANDING_BAND * CLEAN_PER_STEP * CLEAN_PER_STEP,
    STANDING_BAND * CLEAN_PER_STEP * CLEAN_PER_STEP * CLEAN_PER_STEP,
  ],
  unit: 'raider',
  at: (w) => w.stats.raidersKilled,
};

const LADDERS: readonly Ladder[] = [SCIENCE, ECONOMY, WARFARE];

/**
 * The roads in the order everything reports them — the order `roadRungs` returns
 * and the order the grid's `science/economy/warfare` column reads in. Exported
 * so nobody downstream has to write that order down a second time and be wrong
 * about it later.
 */
export const ROAD_IDS: readonly RoadId[] = LADDERS.map((l) => l.id);

/** How many of a ladder's boundaries a tally has cleared. */
function rungOf(l: Ladder, at: number): number {
  let n = 0;
  for (const need of l.needs) if (at >= need) n++;
  return n;
}

/**
 * Where the colony stands on each road, in ladder order. Pure — safe to call
 * from the HUD every frame, same as `charters`.
 */
export function roads(world: World): Road[] {
  return LADDERS.map((l) => {
    const at = l.at(world);
    const rung = rungOf(l, at);
    const top = rung >= ROAD_RUNGS;
    // The bar measures the leg being walked, not the whole road: from the rung
    // underfoot to the next one. A bar drawn against the top boundary is nearly
    // empty for most of a run and stops moving in a way the player can see,
    // which is the failure `objectives.ts` already had and solved the same way.
    const from = rung === 0 ? 0 : l.needs[rung - 1]!;
    const of = top ? l.needs[ROAD_RUNGS - 1]! : l.needs[rung]!;
    return {
      id: l.id,
      title: l.title,
      ending: l.ending,
      rung,
      standing: rung === 0 ? null : (l.rungs[rung - 1] ?? null),
      next: top ? null : (l.rungs[rung] ?? null),
      at,
      of,
      progress: top ? 1 : Math.max(0, Math.min(1, (at - from) / Math.max(1, of - from))),
      count: top ? plural(at, l.unit) : `${at} / ${plural(of, l.unit)}`,
      hint: l.hint,
    };
  });
}

/**
 * Just the rungs, in ladder order — what the balance grid samples.
 *
 * Separate from `roads` so the eval never builds three strings a day it is only
 * going to throw away, and so the column the principles read is a list of small
 * integers rather than a shape that changes whenever the panel's wording does.
 */
export function roadRungs(world: World): number[] {
  return LADDERS.map((l) => rungOf(l, l.at(world)));
}
