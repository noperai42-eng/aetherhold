/**
 * Traits: the difference between "settler #4" and Wren Ashdown, who is tough as
 * boots and eats like a horse.
 *
 * Skills already made settlers unequal, but they made them unequal along one
 * axis the player mostly reads as a number going up. Nobody remembers that
 * somebody had mining 9. They remember the one who kept working through a bad
 * week, or the marksman who held the gate, or the glutton who ate the winter
 * stores. That is what this is for.
 *
 * The rule every trait here obeys: it does exactly one thing, and that one thing
 * is a number some existing system already reads. No trait introduces a new
 * mechanic, gets its own branch in the job loop, or needs the player to learn a
 * rule. `hardworking` moves `workRate`, which construction and mining and cooking
 * and research all already go through; `tough` moves `maxHp`, which combat and
 * starvation and the doctor all already read. That is why ten traits cost six
 * one-line hooks instead of ten new code paths, and why adding an eleventh is
 * cheap.
 *
 * The other rule: no trait may be strictly bad to the point of being a dud
 * colonist, and none may be so good the player rerolls for it. The pairs are
 * deliberately symmetrical — every gift has a matching cost somewhere in the
 * table — so a colony of eight averages out to roughly the colony you had before
 * traits existed, and the interest is in *which* eight you got.
 */

import { Rng } from './rng';
import type { Pawn } from './types';

export type TraitName =
  | 'hardworking'
  | 'slothful'
  | 'tough'
  | 'frail'
  | 'optimist'
  | 'pessimist'
  | 'crackshot'
  | 'kindhearted'
  | 'ironstomach'
  | 'glutton';

export interface Trait {
  name: TraitName;
  label: string;
  /** One line, written to be read in the inspector by somebody mid-game. */
  blurb: string;
  /** Multiplier on how much work this settler gets done per tick. */
  work?: number;
  /**
   * Multiplier on how many jobs of one trade they will do in a row before they
   * want a change — see `tedium.ts`. Separate from `work` because they are
   * genuinely different complaints: one settler is slow, another is quick and
   * bored by Tuesday.
   */
  stint?: number;
  /** Multiplier on maximum hit points, applied once when the body is made. */
  body?: number;
  /** Flat shift on mood, applied before the clamp. */
  mood?: number;
  /**
   * Extra effective levels of shooting — the same currency the skill itself is
   * in, so it narrows the rifle's cone and steadies a club swing without either
   * path needing to know a trait was involved.
   */
  aim?: number;
  /** Multiplier on how fast this settler gets hungry. */
  appetite?: number;
  /** Resistance a prisoner loses per sitting when this settler does the talking. */
  persuasion?: number;
  /**
   * Opinion points this settler adds to every conversation they are in — how
   * easy they are to get along with. Read by `social.ts`, and by nothing else.
   */
  warmth?: number;
}

export const TRAITS: Record<TraitName, Trait> = {
  hardworking: {
    name: 'hardworking',
    label: 'Hardworking',
    blurb: 'Cannot sit still while there is anything left on the board.',
    work: 1.15,
    stint: 1.6,
  },
  slothful: {
    name: 'slothful',
    label: 'Slothful',
    blurb: 'Gets there eventually. Sees no reason to hurry.',
    work: 0.85,
    stint: 0.7,
  },
  tough: {
    name: 'tough',
    label: 'Tough',
    blurb: 'Takes a great deal of killing.',
    body: 1.3,
  },
  frail: {
    name: 'frail',
    label: 'Frail',
    blurb: 'Does not take much of a hit before going down.',
    body: 0.75,
  },
  optimist: {
    name: 'optimist',
    label: 'Optimist',
    blurb: 'Finds the bright side of a bad winter.',
    mood: 0.1,
    warmth: 0.6,
  },
  pessimist: {
    name: 'pessimist',
    label: 'Pessimist',
    blurb: 'Was expecting this, and says so.',
    mood: -0.1,
    warmth: -0.6,
  },
  crackshot: {
    name: 'crackshot',
    label: 'Crackshot',
    blurb: 'Puts them down with the first one more often than not.',
    aim: 6,
  },
  kindhearted: {
    name: 'kindhearted',
    label: 'Kindhearted',
    blurb: 'Talks a prisoner round twice as fast, whatever kind of week they are having.',
    persuasion: 2,
    warmth: 0.9,
  },
  ironstomach: {
    name: 'ironstomach',
    label: 'Iron stomach',
    blurb: 'Gets by on very little, and does not complain about it.',
    appetite: 0.75,
  },
  glutton: {
    name: 'glutton',
    label: 'Glutton',
    blurb: 'Eats a third again what anybody else does.',
    appetite: 1.3,
  },
};

/**
 * Traits that cannot land on the same person.
 *
 * Not a general "conflicts" graph, just the four opposed pairs — a settler who
 * is both hardworking and slothful is not an interesting edge case, it is a bug
 * the player would rightly report.
 */
const EXCLUSIVE: TraitName[][] = [
  ['hardworking', 'slothful'],
  ['tough', 'frail'],
  ['optimist', 'pessimist'],
  ['ironstomach', 'glutton'],
];

const ALL: TraitName[] = Object.keys(TRAITS) as TraitName[];

function conflicts(have: TraitName[], candidate: TraitName): boolean {
  const group = EXCLUSIVE.find((g) => g.includes(candidate));
  if (!group) return false;
  return have.some((t) => group.includes(t));
}

/**
 * One or two traits, never two that fight.
 *
 * Two is the interesting case — a tough glutton is a character — so it is the
 * common one, but a plain settler with a single trait keeps the table from
 * reading as a slot machine where everyone is remarkable.
 */
export function rollTraits(rng: Rng): TraitName[] {
  const want = rng.chance(0.45) ? 1 : 2;
  const out: TraitName[] = [];
  // Bounded rather than "loop until we have enough": with four exclusive pairs a
  // rejection loop always terminates, but a bounded one cannot be made to hang by
  // a later edit to the table, and coming back with one trait is a fine outcome.
  for (let attempt = 0; attempt < 12 && out.length < want; attempt++) {
    const pick = rng.pick(ALL);
    if (out.includes(pick) || conflicts(out, pick)) continue;
    out.push(pick);
  }
  return out;
}

/**
 * The traits a pawn actually has, as table entries.
 *
 * Tolerates a name that is no longer in the table, because a save written by an
 * older build is allowed to name a trait that has since been cut, and losing a
 * colony to that would be absurd.
 */
export function traitsOf(pawn: Pawn): Trait[] {
  const names = pawn.traits;
  if (!names || names.length === 0) return [];
  const out: Trait[] = [];
  for (const n of names) {
    const t = TRAITS[n];
    if (t) out.push(t);
  }
  return out;
}

export function hasTrait(pawn: Pawn, name: TraitName): boolean {
  return pawn.traits?.includes(name) ?? false;
}

/**
 * Body multiplier for a set of names, before there is a pawn to ask.
 *
 * Separate because `makePawn` has to know how big to build the body while it is
 * still assembling it, and handing it a half-built pawn to query would be worse
 * than one small function.
 */
export function bodyMultiplierOf(names: TraitName[]): number {
  let m = 1;
  for (const n of names) m *= TRAITS[n]?.body ?? 1;
  return m;
}

/** Product of every multiplier of one kind. 1 when the pawn has none. */
function product(pawn: Pawn, key: 'work' | 'appetite' | 'stint'): number {
  let m = 1;
  for (const t of traitsOf(pawn)) {
    const v = t[key];
    if (v !== undefined) m *= v;
  }
  return m;
}

/** Sum of every flat modifier of one kind. 0 when the pawn has none. */
function sum(pawn: Pawn, key: 'mood' | 'aim' | 'warmth'): number {
  let s = 0;
  for (const t of traitsOf(pawn)) {
    const v = t[key];
    if (v !== undefined) s += v;
  }
  return s;
}

export function workMultiplier(pawn: Pawn): number {
  return product(pawn, 'work');
}

export function bodyMultiplier(pawn: Pawn): number {
  return bodyMultiplierOf(pawn.traits ?? []);
}

export function appetiteMultiplier(pawn: Pawn): number {
  return product(pawn, 'appetite');
}

/** How much longer than average this settler will stay on one trade. */
export function stintMultiplier(pawn: Pawn): number {
  return product(pawn, 'stint');
}

export function moodBonus(pawn: Pawn): number {
  return sum(pawn, 'mood');
}

export function aimBonus(pawn: Pawn): number {
  return sum(pawn, 'aim');
}

/** How much easier than average this settler is to get along with. */
export function warmthOf(pawn: Pawn): number {
  return sum(pawn, 'warmth');
}

/**
 * Backfill for a pawn loaded from a save written before traits existed.
 *
 * Rolled off the pawn's own id and colour seed rather than a live stream, so the
 * settler the player has been running for twenty days becomes the *same* person
 * every time that save is opened, on every machine. The alternative — leaving old
 * colonists blank — would have made the inspector say nothing about exactly the
 * people the player cares most about.
 *
 * The body multiplier is applied here too, with current hit points scaled to
 * match, because a `tough` settler whose `maxHp` never moved would be a label
 * that lies.
 */
export function backfillTraits(pawn: Pawn): void {
  if (pawn.traits) return;
  pawn.traits = rollTraits(new Rng(pawn.id * 31 + pawn.colorSeed + 1));
  const body = bodyMultiplier(pawn);
  if (body === 1) return;
  const share = pawn.maxHp > 0 ? pawn.hp / pawn.maxHp : 1;
  pawn.maxHp = Math.round(pawn.maxHp * body);
  pawn.hp = Math.round(pawn.maxHp * share);
}
