/**
 * Why is that settler standing there?
 *
 * The single most common thing a player says out loud at this game is "why isn't
 * anybody building my wall". The colony already knows the answer — it is sitting
 * in `pawn.priorities`, in `blueprint.needs`, in the region index — but until now
 * the card said `idle`, which is a description of the problem restated as a fact.
 * A settler doing nothing is the one state where the game owes the player a
 * sentence, because it is the only state they cannot diagnose by watching.
 *
 * Pure, and derived rather than recorded, exactly like `alerts.ts`: nothing here
 * writes game state, and a reason exists for precisely as long as the thing
 * causing it. It is deliberately *not* a log of what `pickWorkJob` tried. A
 * transcript of fourteen work types that each came back empty is a debugger's
 * artefact; what the player needs is the one sentence that names the thing they
 * can go and change.
 *
 * The rules of the place:
 *
 * - **Only ever say something provable.** Every branch below is a claim about
 *   state that is true at the moment it is read — "short 12 wood" means the map
 *   holds twelve less wood than the standing blueprints ask for, counted. A
 *   plausible guess is worse than `idle`, because the player will act on it.
 * - **Per-settler before per-colony.** Two things can be true at once — the
 *   colony is out of wood *and* this settler has construction switched off — and
 *   the one that explains why *this* body is idle wins, because that is the one
 *   the player clicked on.
 * - **Say nothing when nothing is wrong.** A drafted settler, a sleeping one, one
 *   the player took off the board by hand, one whose mood has given out: all of
 *   those already read correctly on the card, and a second sentence explaining
 *   them is noise.
 */

import { NEIGHBOURS_8, isWalkable } from './grid';
import { isBreaking } from './needs';
import { regionAt } from './regions';
import { WORK_TYPES, inBounds, type Building, type Pawn, type ResourceKind, type World, type WorkType } from './types';
import { countResource } from './world';

/**
 * How few switched-on work types counts as "they are barely on the board".
 *
 * Three of fourteen. A settler set to cook, doctor and nothing else is idle for a
 * reason the player chose on purpose and may well have forgotten, and naming the
 * three is the difference between "the game is broken" and "ah, that one is my
 * medic". Above three the list stops being a sentence and starts being the Work
 * tab, which the player can already read.
 */
const NARROW = 3;

/** Human-facing names for the work types, where the id is not the word. */
const WORK_WORD: Partial<Record<WorkType, string>> = {
  construct: 'building',
  farm: 'farming',
  cook: 'cooking',
  doctor: 'doctoring',
  haul: 'hauling',
  mine: 'mining',
  chop: 'woodcutting',
  craft: 'crafting',
  hunt: 'hunting',
  research: 'research',
  scout: 'scouting',
  caravan: 'trade runs',
  warden: 'warden work',
  firefight: 'firefighting',
};

function word(w: WorkType): string {
  return WORK_WORD[w] ?? w;
}

/** "a", "a and b", "a, b and c" — the way a person says a short list. */
function listOf(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Standing blueprints, which are the only work the player puts up by hand. */
function blueprints(world: World): Building[] {
  return world.buildings.filter((b) => !b.built);
}

/**
 * Everything the standing blueprints still want, minus everything on the map.
 *
 * Counted against `countResource`, which is every stack anywhere including the
 * one in a hauler's arms, so a shortfall here is a real shortfall: no amount of
 * walking about will produce the missing wood. The looser question — "is the
 * wood *free*" — deliberately is not asked, because a stack reserved by the next
 * blueprint along is not missing, it is thirty seconds away.
 */
function shortfall(world: World, bps: Building[]): { kind: ResourceKind; n: number } | null {
  const want = new Map<ResourceKind, number>();
  for (const b of bps) {
    for (const [kind, n] of Object.entries(b.needs) as [ResourceKind, number][]) {
      if (n > 0) want.set(kind, (want.get(kind) ?? 0) + n);
    }
  }
  let worst: { kind: ResourceKind; n: number } | null = null;
  for (const [kind, n] of want) {
    const gap = n - countResource(world, kind);
    if (gap > 0 && (worst === null || gap > worst.n)) worst = { kind, n: gap };
  }
  return worst;
}

/**
 * Can this settler get to a cell they could work this blueprint from?
 *
 * The same question `findPathAdjacent` asks, answered off the stored flood fill
 * instead of by searching: a builder stands beside the thing, so the goal is the
 * blueprint's own cell if anything can stand on it plus its eight neighbours,
 * and one of those has to carry the settler's region label. Two labels mean no
 * route exists — the fill is built from the same `canStep` A* walks by — which
 * is the one honest way to say "walled off" without running fourteen searches
 * every time the player opens a card.
 */
function canWork(world: World, here: number, b: Building): boolean {
  if (isWalkable(world, b.x, b.y) && regionAt(world, b.x, b.y) === here) return true;
  for (const [dx, dy] of NEIGHBOURS_8) {
    const nx = b.x + dx;
    const ny = b.y + dy;
    if (!inBounds(world, nx, ny)) continue;
    if (isWalkable(world, nx, ny) && regionAt(world, nx, ny) === here) return true;
  }
  return false;
}

/**
 * One sentence for why this settler has no work, or null when the card is
 * already telling the truth without help.
 *
 * Null covers both "they are busy" and "they are idle for a reason the player
 * can see" — drafted, asleep, hand-driven, or stopped by their own mood. What is
 * left is the case the game used to have no words for: a settler on the work
 * board, willing, with an empty board in front of them.
 */
export function idleReason(world: World, pawn: Pawn): string | null {
  if (pawn.faction !== 'colony' || pawn.dead || pawn.downed) return null;
  if (pawn.drafted || pawn.manual) return null;
  if (pawn.activity === 'sleeping' || isBreaking(pawn)) return null;

  // A settler with an empty board in front of them does not stand in the yard —
  // `assignJob` sends them to a seat, deliberately, because losing morale over
  // work that does not exist is a punishment for nothing. So "playing darts" is
  // the *common* face of this problem and the one the player is looking at when
  // they ask why the wall is not going up; excluding it would leave the feature
  // firing only in the seconds before somebody sat down.
  //
  // At a price, and the price is what `resting` buys back below: a settler can
  // also be at that table because their own recreation ran out while there was
  // plenty to do. Every branch that follows is a claim about the colony — a
  // shortfall, a switch, a wall — and stays true either way. The last one is a
  // claim about *this settler's* board being empty, which is exactly the thing
  // that is no longer knowable once they have a job in hand, so it is withheld.
  let resting = false;
  if (pawn.jobId !== null) {
    const job = world.jobs.find((j) => j.id === pawn.jobId);
    // A job this cannot identify is a job: silence is the safe answer, and the
    // one thing worse than no sentence is a sentence about a settler who is
    // busy doing something the panel could not name.
    if (job === undefined || job.kind !== 'recreate') return null;
    resting = true;
  }

  const on = WORK_TYPES.filter((w) => (pawn.priorities[w] ?? 0) > 0);
  if (on.length === 0) return 'every kind of work is switched off in their Work tab.';

  const bps = blueprints(world);
  if (bps.length > 0) {
    // Their own switch first. The colony being out of wood is true of everybody;
    // this is true of the settler the player is looking at, and it is the one
    // they can fix from the card that is already open.
    if ((pawn.priorities.construct ?? 0) === 0) {
      return `${bps.length} blueprint${bps.length === 1 ? ' is' : 's are'} up, but building is switched off for them.`;
    }
    const short = shortfall(world, bps);
    if (short) return `the blueprints are short ${Math.ceil(short.n)} ${short.kind}.`;
    const here = regionAt(world, Math.round(pawn.x), Math.round(pawn.y));
    // A negative label is a settler standing somewhere nothing can stand — shoved
    // inside a wall, or a wall raised on top of them. They have a much larger
    // problem than the blueprint and the reachability answer would be a lie.
    if (here >= 0 && !bps.some((b) => canWork(world, here, b))) {
      return 'they cannot reach any of the blueprints from where they are standing.';
    }
  }

  if (on.length <= NARROW) {
    return `only ${listOf(on.map(word))} ${on.length === 1 ? 'is' : 'are'} switched on for them.`;
  }
  if (resting) return null;
  return 'nothing on the board they can take — put up a blueprint, or set a bill at a bench.';
}
