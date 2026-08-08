/**
 * The valley with nobody in it.
 *
 * Every other harness in `src/eval` asks whether a colony survives. This one asks
 * the question underneath that: does the *moor* survive, on its own, with no
 * settlers in it at all? Bushes fruit, brambletails strip them, wolves thin the
 * brambletails, and the whole arrangement is supposed to sit in a band rather than
 * run away in either direction — a chain that quietly ends in its own first season
 * is scenery, not a chain, and the only way to tell those apart is to run it for
 * long enough that a slow drift has somewhere to show up.
 *
 * It runs the real loop. `stepWorld` and nothing else — the same tick the browser
 * runs, with the colonists taken out of it rather than the simulation swapped for
 * a cheaper one. A model of the food chain would agree with itself forever; the
 * point is to catch the day the actual code does not.
 *
 * Then it puts the colony back. `disrupt` settles an empty valley for a season or
 * two, splices the landing party back in where worldgen left them, and keeps
 * counting — so what the numbers show afterwards is what the settlers did to a
 * moor that had already found its own level, and not what a colony and a wilderness
 * starting from scratch together happen to do.
 */

import { ensureBushes } from '../sim/berries';
import { makeStreams, stepWorld } from '../sim/tick';
import { markBuildingsChanged, TICKS_PER_DAY } from '../sim/types';
import type { AnimalKind, Building, ItemStack, Pawn, World, Zone } from '../sim/types';
import { populationCap } from '../sim/wildlife';
import { createWorld } from '../sim/worldgen';

/** The four wild animals, in food-chain order: two grazers, a browser, a wolf. */
export const WILD_KINDS: readonly AnimalKind[] = ['mossback', 'dunhare', 'brambletail', 'fenwolf'];

export interface EcoSample {
  day: number;
  /** Wild animals only — a tamed goat is livestock, not wildlife. */
  counts: Record<AnimalKind, number>;
  animals: number;
  bushes: number;
  ripe: number;
  colonists: number;
}

export interface EcoRun {
  seed: number;
  width: number;
  height: number;
  /** What the sim thinks the valley carries, for reading the samples against. */
  cap: number;
  /** The day the colony was spliced in, or undefined if it never was. */
  landedOn?: number;
  samples: EcoSample[];
}

/**
 * Everything the colony is, lifted out of a world in one piece.
 *
 * Trees stay. They are buildings like a wall is a building, and a moor with every
 * tree taken out of it is not an empty valley — it is a different valley, with
 * different regions, different cover and different routes through it.
 */
interface Landing {
  pawns: Pawn[];
  buildings: Building[];
  items: ItemStack[];
  zones: Zone[];
}

/** Strip a freshly generated world back to moor, keeping what the moor made. */
export function clearColony(world: World): Landing {
  const landing: Landing = {
    pawns: world.pawns.filter((p) => p.faction !== 'fauna'),
    buildings: world.buildings.filter((b) => b.kind !== 'tree'),
    items: world.items.slice(),
    zones: world.zones.slice(),
  };
  world.pawns = world.pawns.filter((p) => p.faction === 'fauna');
  world.buildings = world.buildings.filter((b) => b.kind === 'tree');
  markBuildingsChanged(world);
  world.items = [];
  world.zones = [];
  world.jobs = [];
  return landing;
}

/** Put it back, exactly where worldgen left it. */
export function landColony(world: World, landing: Landing): void {
  world.pawns.push(...landing.pawns);
  world.buildings.push(...landing.buildings);
  markBuildingsChanged(world);
  world.items.push(...landing.items);
  world.zones.push(...landing.zones);
}

function census(world: World, day: number): EcoSample {
  const counts: Record<AnimalKind, number> = {
    mossback: 0,
    dunhare: 0,
    brambletail: 0,
    fenwolf: 0,
  };
  let animals = 0;
  let colonists = 0;
  for (const p of world.pawns) {
    if (p.dead) continue;
    if (p.faction === 'colony' && p.animal === undefined) colonists++;
    if (p.faction !== 'fauna' || p.animal === undefined) continue;
    counts[p.animal]++;
    animals++;
  }
  const bushes = ensureBushes(world);
  let ripe = 0;
  for (const b of bushes) if (b.ripe >= 1) ripe++;
  return { day, counts, animals, bushes: bushes.length, ripe, colonists };
}

export interface EcoOptions {
  seed: number;
  days: number;
  /** Splice the colony back in at the end of this day. Omit to leave the moor empty. */
  landOn?: number;
  /** Called after each day's census, for progress output on the long runs. */
  onDay?: (sample: EcoSample) => void;
}

export function runEcosystem({ seed, days, landOn, onDay }: EcoOptions): EcoRun {
  const world = createWorld(seed);
  const landing = clearColony(world);
  const streams = makeStreams(world);
  const samples: EcoSample[] = [];

  for (let day = 1; day <= days; day++) {
    for (let i = 0; i < TICKS_PER_DAY; i++) stepWorld(world, streams);
    const sample = census(world, day);
    samples.push(sample);
    onDay?.(sample);
    if (landOn === day) landColony(world, landing);
  }

  return {
    seed,
    width: world.width,
    height: world.height,
    cap: populationCap(world),
    landedOn: landOn,
    samples,
  };
}

/** Samples from `from` to `to` inclusive, in days. */
export function window(run: EcoRun, from: number, to: number): EcoSample[] {
  return run.samples.filter((s) => s.day >= from && s.day <= to);
}

export interface KindStats {
  min: number;
  max: number;
  mean: number;
  first: number;
  last: number;
  /** Days on which there were none of this kind alive. */
  zeroDays: number;
  /** The longest unbroken run of those, in days. */
  longestGap: number;
}

export function statsFor(samples: EcoSample[], kind: AnimalKind): KindStats {
  let min = Infinity;
  let max = 0;
  let sum = 0;
  let zeroDays = 0;
  let gap = 0;
  let longestGap = 0;
  for (const s of samples) {
    const n = s.counts[kind];
    if (n < min) min = n;
    if (n > max) max = n;
    sum += n;
    if (n === 0) {
      zeroDays++;
      gap++;
      if (gap > longestGap) longestGap = gap;
    } else {
      gap = 0;
    }
  }
  return {
    min: min === Infinity ? 0 : min,
    max,
    mean: samples.length === 0 ? 0 : sum / samples.length,
    first: samples[0]?.counts[kind] ?? 0,
    last: samples[samples.length - 1]?.counts[kind] ?? 0,
    zeroDays,
    longestGap,
  };
}

/** Mean fraction of the moor's bushes standing in fruit across these samples. */
export function meanRipeFraction(samples: EcoSample[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s.bushes === 0 ? 0 : s.ripe / s.bushes;
  return sum / samples.length;
}

/** One line per sampled day, for reading a run by eye. */
export function formatRun(run: EcoRun, everyDays = 25): string {
  const head = `${run.width}x${run.height} seed ${run.seed} cap ${run.cap}${
    run.landedOn === undefined ? ' (no colony)' : ` (colony lands d${run.landedOn})`
  }`;
  const rows = run.samples
    .filter((s) => s.day % everyDays === 0 || s.day === run.samples.length)
    .map(
      (s) =>
        `d${String(s.day).padStart(4)} ` +
        WILD_KINDS.map((k) => `${k.slice(0, 5)}=${String(s.counts[k]).padStart(3)}`).join(' ') +
        ` | all ${String(s.animals).padStart(3)} | ripe ${String(s.ripe).padStart(3)}/${s.bushes}` +
        (s.colonists > 0 ? ` | colonists ${s.colonists}` : ''),
    );
  return [head, ...rows].join('\n');
}
