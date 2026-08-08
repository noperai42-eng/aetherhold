/**
 * Pickies — small pink goblins you summon to answer one question about the map.
 *
 * The colony has a lot of quiet ways to go wrong that all look the same from the
 * outside: a settler stops going somewhere. Maybe the last door got walled up,
 * maybe the bridge is one cell short, maybe the bed is fine and the *stockpile*
 * is the thing nobody can reach. The log will not tell you which, because from
 * the work board's side of it there is simply no job to hand out.
 *
 * So you send a Picky. It pops into existence next to a settler, scampers off
 * toward whatever you pointed it at, and then says out loud what happened: it got
 * there, or nothing joins that cell to here, or it spent a minute failing. Then
 * it vanishes. It cannot carry, build, fight or be recruited, and it is not a
 * colonist — it is a question with legs.
 *
 * Two rules make it worth anything at all:
 *
 * 1. It walks through the *same* pathfinder and the *same* collision a settler
 *    does (`Walker`, in `movement.ts`). A tester with its own movement code would
 *    answer a question about the tester.
 * 2. It never touches the world's randomness. Every Picky carries its own seed,
 *    so summoning one — or ten — cannot shift a single roll of the weather, the
 *    raids or the crops. Watching a colony must not change it.
 */

import { defOf } from './buildings';
import { isWalkable, nearestWalkable } from './grid';
import { followPath, setPathAdjacentTo, setPathTo } from './movement';
import { Rng } from './rng';
import type { Picky, PickyTask, World } from './types';
import { TICKS_PER_SECOND, inBounds, packCell, unpackX, unpackY } from './types';
import { livingColonists, msg } from './world';

/** Cells per tick. A shade quicker than a settler at a dead run — they are eager. */
export const PICKY_SPEED = 0.26;

/**
 * How many can be out at once.
 *
 * Low on purpose. The cap is not about cost — six more bodies is nothing — it is
 * about what the answer is worth. Twenty Pickies shouting at once is noise, and
 * the whole point of the thing is one clear sentence about one cell.
 */
export const MAX_PICKIES = 6;

/** Ticks a Picky will keep trying before it gives up and says so. One minute. */
export const PICKY_PATIENCE = 60 * TICKS_PER_SECOND;

/** How long the vanishing takes, so the player sees it happen. */
export const POOF_TICKS = 14;

/** How many of the colony's own buildings a `rounds` Picky checks. */
export const ROUNDS_STOPS = 6;

/** What the player asked for. The stored `PickyTask` is built from this. */
export type PickyOrder =
  | { kind: 'reach'; x: number; y: number }
  | { kind: 'rounds' }
  | { kind: 'doors' }
  | { kind: 'fetch' }
  /**
   * "Do what you can." The Picky picks its own errand.
   *
   * The point of this one is that you are not asking about a cell you already
   * suspect — you are asking the colony to be checked, and letting the goblin
   * decide how. It rolls on its *own* seed, so a surprise Picky is still not a
   * die drawn from the world.
   */
  | { kind: 'surprise' };

/**
 * Summon one. Returns it, or null with a line in the log saying why not.
 *
 * The refusals are all sentences rather than silent nulls for the usual reason:
 * a button that sometimes does nothing is a button the player stops pressing.
 */
export function summonPicky(world: World, order: PickyOrder): Picky | null {
  const list = (world.pickies ??= []);
  if (list.length >= MAX_PICKIES) {
    msg(world, `${MAX_PICKIES} Pickies is already too many Pickies. Wait for one to pop.`, 'bad');
    return null;
  }
  if (order.kind === 'reach' && !inBounds(world, order.x, order.y)) return null;

  const stand = spawnCell(world);
  if (!stand) {
    msg(world, 'There is nowhere for a Picky to stand.', 'bad');
    return null;
  }

  // Its own counter, running negative — not `nextId`. See `World.pickyIds`: the
  // id counter is a shared stream too, and spending it moves wildlife about.
  const id = -(world.pickyIds = (world.pickyIds ?? 0) + 1);
  // Derived from the id and the tick rather than drawn from a stream — see the
  // second rule at the top of this file. Two Pickies summoned on the same tick
  // still differ, because ids never repeat.
  const seed = (Math.imul(id, 2654435761) ^ Math.imul(world.tick + 1, 40503)) >>> 0;

  const task = plan(world, order, seed);
  const p: Picky = {
    id,
    x: stand.x,
    y: stand.y,
    path: null,
    stuck: 0,
    facing: 0,
    animPhase: 0,
    task,
    born: world.tick,
    target: null,
    leg: 0,
    poof: null,
    seed,
    colorSeed: (seed >>> 7) & 0xffff,
  };
  list.push(p);

  if (task.kind === 'reach') {
    msg(world, `Ooh — a Picky! It scampers off toward (${task.x}, ${task.y}).`, 'info', {
      at: { x: task.x, y: task.y },
    });
  } else if (task.stops.length === 0) {
    // Nothing to go and look at. Say so now rather than let it stand there
    // looking broken for a tick and then pop.
    msg(world, `Ooh — a Picky! ${NOTHING_TO_DO[task.kind]}`, 'info');
    p.poof = POOF_TICKS;
  } else {
    msg(world, `Ooh — a Picky! ${setsOff(task)}`, 'info', { at: { x: stand.x, y: stand.y } });
  }
  return p;
}

/** What a Picky says when the errand it drew has nothing in it to check. */
const NOTHING_TO_DO: Record<'rounds' | 'doors' | 'fetch', string> = {
  rounds: 'It looks around for something built, finds nothing, and pops.',
  doors: 'It looks around for a door, finds not one in the whole colony, and pops.',
  fetch: 'It looks for something lying about to carry somewhere, finds nowhere to put it, and pops.',
};

/** What a Picky says as it leaves. */
function setsOff(task: Extract<PickyTask, { stops: number[] }>): string {
  if (task.kind === 'rounds') {
    return `It sets off to check the colony can still reach ${task.stops.length} of its own buildings.`;
  }
  if (task.kind === 'doors') {
    return `It sets off to try ${task.stops.length} of the colony's doors.`;
  }
  return `It spots ${task.what} lying about and sets off to see whether it could be carried to a store.`;
}

/** What a Picky says when it has walked every stop it set out to walk. */
function allDone(task: Extract<PickyTask, { stops: number[] }>): string {
  if (task.kind === 'rounds') {
    return `A Picky walked round ${task.stops.length} of the colony's buildings and reached every one. It pops, satisfied.`;
  }
  if (task.kind === 'doors') {
    return `A Picky tried ${task.stops.length} doors and every one of them opened for it. It pops, satisfied.`;
  }
  return `A Picky carried nothing at all from ${task.what} to a store, but it could have. It pops, satisfied.`;
}

/**
 * Turn the player's request into the errand the Picky actually carries.
 *
 * Every itinerary is fixed here, at summon time, rather than chosen a stop at a
 * time. That is what makes a Picky reproducible: the same colony and the same
 * seed always walk the same round, so a player who sees a failure can send
 * another one and watch it fail in the same place. The `Rng` is the Picky's own —
 * see the second rule at the top of this file.
 */
function plan(world: World, order: PickyOrder, seed: number): PickyTask {
  const rng = new Rng(seed);
  const kind = order.kind === 'surprise' ? pickErrand(world, rng) : order.kind;

  if (kind === 'reach') {
    // A `surprise` that lands on `reach` has to choose its own cell. Anywhere
    // walkable on the whole map, deliberately including ground the colony has
    // never seen: "somewhere out there you cannot get to" is exactly the answer
    // worth having, and refusing to ask about the dark would hide it.
    if (order.kind === 'reach') return { kind: 'reach', x: order.x, y: order.y };
    for (let i = 0; i < 200; i++) {
      const x = rng.int(world.width);
      const y = rng.int(world.height);
      if (isWalkable(world, x, y)) return { kind: 'reach', x, y };
    }
    return { kind: 'rounds', stops: [] };
  }

  if (kind === 'doors') {
    const doors = world.buildings.filter((b) => b.built && b.kind === 'door');
    return { kind: 'doors', stops: sample(world, doors, rng) };
  }

  if (kind === 'fetch') return planFetch(world, rng);

  const built = world.buildings.filter((b) => b.built && b.kind !== 'tree');
  return { kind: 'rounds', stops: sample(world, built, rng) };
}

/** Up to `ROUNDS_STOPS` of them, in a random order, each at most once. */
function sample(world: World, from: { x: number; y: number }[], rng: Rng): number[] {
  const pool = from.slice();
  const stops: number[] = [];
  while (stops.length < ROUNDS_STOPS && pool.length > 0) {
    const b = pool.splice(rng.int(pool.length), 1)[0]!;
    stops.push(packCell(world, b.x, b.y));
  }
  return stops;
}

/**
 * The hauling chain, as two stops: a stack on the ground, then the nearest
 * stockpile cell that would actually take it.
 *
 * Nearest by straight-line distance rather than by path, on purpose — asking the
 * pathfinder here would answer the question the Picky is being sent to answer,
 * and it would answer it silently.
 */
function planFetch(world: World, rng: Rng): PickyTask {
  const loose = world.items.filter((i) => i.carriedBy === null);
  if (loose.length === 0) return { kind: 'fetch', stops: [], what: 'nothing' };
  const item = loose[rng.int(loose.length)]!;

  let best: number | null = null;
  let bestD = Infinity;
  for (const z of world.zones) {
    if (z.kind !== 'stockpile' || !z.accepts.includes(item.kind)) continue;
    for (const cell of z.cells) {
      const d = Math.hypot(unpackX(world, cell) - item.x, unpackY(world, cell) - item.y);
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
  }
  const what = `the ${item.kind} at (${Math.round(item.x)}, ${Math.round(item.y)})`;
  if (best === null) return { kind: 'fetch', stops: [], what };
  return { kind: 'fetch', stops: [packCell(world, Math.round(item.x), Math.round(item.y)), best], what };
}

/**
 * What a `surprise` Picky decides to do.
 *
 * Only errands the colony can actually supply — a goblin that rolls "try the
 * doors" in a colony with no doors has wasted the player's click, and the whole
 * value of a surprise is that it went and found something you had not thought to
 * ask about.
 */
function pickErrand(world: World, rng: Rng): 'reach' | 'rounds' | 'doors' | 'fetch' {
  const menu: ('reach' | 'rounds' | 'doors' | 'fetch')[] = ['reach'];
  if (world.buildings.some((b) => b.built && b.kind !== 'tree')) menu.push('rounds');
  if (world.buildings.some((b) => b.built && b.kind === 'door')) menu.push('doors');
  if (world.items.some((i) => i.carriedBy === null) && world.zones.some((z) => z.kind === 'stockpile')) {
    menu.push('fetch');
  }
  return menu[rng.int(menu.length)]!;
}

/**
 * Where a Picky appears: beside a settler.
 *
 * This is load-bearing, not flavour. "Can the colony reach that cell" is a
 * question about a *starting point*, and the honest starting point is wherever
 * the colony's own people are standing. Popping in at the map's centre would
 * answer a question nobody asked. With nobody left alive it falls back to the
 * middle of the map, which is the only defensible answer for a dead colony.
 */
function spawnCell(world: World): { x: number; y: number } | null {
  const people = livingColonists(world);
  const anchor = people[0];
  const cx = anchor ? Math.round(anchor.x) : Math.floor(world.width / 2);
  const cy = anchor ? Math.round(anchor.y) : Math.floor(world.height / 2);
  return nearestWalkable(world, cx, cy, 10);
}

/**
 * Every Picky takes its step, delivers its verdict, or finishes vanishing.
 *
 * Walked backwards because a Picky whose countdown runs out is spliced out of
 * the list on the spot. It runs after the settlers so a Picky sees the map as the
 * colony left it this tick, and before `tickExplore` so it can never reveal
 * ground — a Picky is a spectator; what it walks past does not become something
 * the colony has seen.
 */
export function tickPickies(world: World): void {
  const list = world.pickies;
  if (!list || list.length === 0) return;

  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]!;

    if (p.poof !== null) {
      p.poof--;
      if (p.poof <= 0) list.splice(i, 1);
      continue;
    }

    if (world.tick - p.born > PICKY_PATIENCE) {
      msg(world, `${where(world, p)} — a Picky tried for a minute and never got there. It pops anyway.`, 'bad', {
        at: aimAt(world, p) ?? { x: p.x, y: p.y },
      });
      p.poof = POOF_TICKS;
      continue;
    }

    if (p.target === null && !nextLeg(world, p)) continue;
    if (p.target === null) continue;

    // No path yet, or the one it had was invalidated under it — a wall raised
    // across the route, a bridge deconstructed. Ask again before concluding
    // anything: "the way closed behind me" is a different answer from "there was
    // never a way", and both are worth hearing.
    if (!p.path && !route(world, p)) continue;

    if (followPath(world, p, PICKY_SPEED)) arrive(world, p);
  }
}

/**
 * Line up the next place to go. False means the Picky is finished and popping.
 */
function nextLeg(world: World, p: Picky): boolean {
  if (p.task.kind === 'reach') {
    if (p.leg > 0) return false;
    p.target = packCell(world, p.task.x, p.task.y);
    return true;
  }
  const stop = p.task.stops[p.leg];
  if (stop === undefined) {
    msg(world, allDone(p.task), 'good');
    p.poof = POOF_TICKS;
    return false;
  }
  p.target = stop;
  return true;
}

/**
 * Ask the pathfinder. False means it has just delivered a verdict and is popping.
 *
 * A cell you can stand on is walked *to*; anything else — a wall, a bed, a rock —
 * is walked *beside*, which is the same distinction every settler's job makes. So
 * "unreachable" here means exactly what it means for a job, which is the whole
 * reason the answer is worth anything.
 */
function route(world: World, p: Picky): boolean {
  const tx = unpackX(world, p.target!);
  const ty = unpackY(world, p.target!);
  const ok = isWalkable(world, tx, ty)
    ? setPathTo(world, p, tx, ty)
    : setPathAdjacentTo(world, p, tx, ty);
  if (ok) return true;
  msg(world, `${where(world, p)} — nothing joins it to where the colony is standing. The Picky wails, and pops.`, 'bad', {
    at: { x: tx, y: ty },
  });
  p.poof = POOF_TICKS;
  return false;
}

/** It got there. Report, then either take the next leg or vanish. */
function arrive(world: World, p: Picky): void {
  p.target = null;
  p.leg++;
  if (p.task.kind === 'reach') {
    const secs = Math.max(1, Math.round((world.tick - p.born) / TICKS_PER_SECOND));
    msg(world, `A Picky reached (${p.task.x}, ${p.task.y}) in ${secs}s — the colony can get there. It grins, and pops.`, 'good', {
      at: { x: p.task.x, y: p.task.y },
    });
    p.poof = POOF_TICKS;
  }
  // A `rounds` Picky says nothing at each stop — six lines of good news is not
  // news. It reports once, at the end, or the moment it hits one it cannot reach.
}

/** The cell a Picky is currently trying for, or null if it has none. */
function aimAt(world: World, p: Picky): { x: number; y: number } | null {
  if (p.target === null) return null;
  return { x: unpackX(world, p.target), y: unpackY(world, p.target) };
}

/** How to name whatever a Picky is currently pointed at, for a message. */
function where(world: World, p: Picky): string {
  const at = aimAt(world, p);
  if (!at) return 'Somewhere out there';
  const b = world.buildings.find((x) => x.built && x.x === at.x && x.y === at.y);
  const what = b ? `The ${defOf(b.kind).label.toLowerCase()} at` : 'Cell';
  return `${what} (${at.x}, ${at.y})`;
}
