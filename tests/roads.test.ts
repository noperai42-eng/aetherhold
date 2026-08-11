/**
 * The three roads out of the valley.
 *
 * `roads.ts` deliberately holds no state of its own — every rung is read off
 * world the colony was already keeping — so the thing worth pinning here is not
 * arithmetic but the three rules the module set itself, each of which is a way
 * the file could quietly stop being a road and become a scoreboard.
 *
 * **They have to be three roads.** If all three tallies move together, the
 * player's choice of ending is a choice between synonyms. The grid checks that
 * across whole colonies (`the-three-roads-are-three-roads`); what is checked
 * here is the mechanism underneath it — that each ladder reads its own corner of
 * the world and is deaf to the other two.
 *
 * **They have to still be ahead of somebody.** A ladder is only a ladder while
 * there is a rung left, and the top rungs point at stages the game has not
 * built. `no-road-is-already-finished` watches the grid for that; here it is the
 * cheaper half — that a colony on its first morning has walked none of it.
 *
 * **They must never have to be saved.** A road counter written into the save is
 * a second copy of a number, and a second copy is a number that can drift. A
 * colony round-tripped through `serialize` reads exactly what it read before,
 * because there is nothing about roads in the file at all.
 */

import { describe, expect, it } from 'vitest';

import { CLEAN_PER_STEP, STANDING_BAND } from '../src/sim/events';
import { makePawn } from '../src/sim/pawn';
import { RESEARCH, RESEARCH_ORDER } from '../src/sim/research';
import { Rng } from '../src/sim/rng';
import { ROAD_IDS, ROAD_RUNGS, roadRungs, roads } from '../src/sim/roads';
import { deserialize, serialize } from '../src/sim/save';
import { NEIGHBOUR_COUNT, PER_RING, settlementsOf } from '../src/sim/settlements';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { TICKS_PER_DAY, type World } from '../src/sim/types';
import { HOLD_TICKS, NEED_PEOPLE, NEED_RELATIONS, NEED_RESEARCH, hasWon } from '../src/sim/victory';
import { addBuilding, addItem, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

const SEED = 20260729;

const VIEW = {
  mode: 'manager' as const,
  camera: { targetX: 32, targetY: 32, distance: 40, yaw: 0.8, pitch: 0.9 },
  possessedId: null,
};

/** The road by name, so a reordering of `LADDERS` cannot silently swap two assertions. */
function road(world: World, id: string) {
  const found = roads(world).find((r) => r.id === id);
  if (!found) throw new Error(`no road called ${id}`);
  return found;
}

/** Finish `n` projects, whichever they are — the science road counts them, not which. */
function projects(world: World, n: number): void {
  world.research.done = RESEARCH_ORDER.slice(0, n).slice();
}

/** Bring `n` places up to charter standing. */
function friends(world: World, n: number): void {
  const places = settlementsOf(world);
  for (let i = 0; i < places.length; i++) {
    places[i]!.relations = i < n ? NEED_RELATIONS : 0;
  }
}

/**
 * The same fixture the founding tests use: a colony that qualifies on every axis
 * with the storyteller told to stay away, so what lands mid-hold is the test's
 * business rather than the seed's.
 *
 * It grants its projects and its standing directly, which is the shortcut
 * `victory.test.ts` takes for the same reason — the founding takes six charters
 * and a bench takes a week, and neither of those is what this file is about. The
 * one thing it does *not* touch is the kill count: that stays whatever the
 * colony actually earned, which on a valley nobody attacks is nothing.
 */
function founded(seed = 4242): World {
  const world = createWorld(seed);
  const rng = new Rng(99);
  while (livingColonists(world).length < NEED_PEOPLE) makePawn(world, rng, 'colony', 30, 30);
  addItem(world, 'meal', 400, 31, 34);
  for (const at of [
    { x: 24, y: 30 },
    { x: 24, y: 32 },
  ]) {
    let up = false;
    for (let r = 0; r < 12 && !up; r++) {
      for (let dy = -r; dy <= r && !up; dy++) {
        for (let dx = -r; dx <= r && !up; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          up = !!addBuilding(world, 'turret', at.x + dx, at.y + dy, true);
        }
      }
    }
    if (!up) throw new Error(`nowhere to stand a turret near ${at.x},${at.y}`);
  }
  projects(world, NEED_RESEARCH);
  friends(world, 1);
  world.storyteller.nextThreat = TICKS_PER_DAY * 60;
  world.storyteller.nextScout = TICKS_PER_DAY * 60;
  world.storyteller.nextOutbreak = TICKS_PER_DAY * 60;
  const streams = makeStreams(world);
  for (let i = 0; i < HOLD_TICKS + TICKS_PER_DAY && !hasWon(world); i++) {
    stepWorldN(world, streams, 1);
  }
  return world;
}

describe('where the colony stands', () => {
  it('has a fresh colony at the foot of all three', () => {
    const world = createWorld(SEED);
    expect(roadRungs(world)).toEqual([0, 0, 0]);
    for (const r of roads(world)) {
      // Nothing behind them, something ahead of them, and a bar that has not
      // moved. The `next` is the point: a road with no named next rung on the
      // first morning is a road that reads as finished before it is started.
      expect(r.standing).toBe(null);
      expect(r.next).not.toBe(null);
      expect(r.rung).toBe(0);
      expect(r.progress).toBe(0);
      expect(r.at).toBe(0);
    }
  });

  it('moves one road when the colony does one kind of thing', () => {
    const world = createWorld(SEED);
    projects(world, NEED_RESEARCH);
    // The whole design in one assertion: a colony that has only ever done
    // science has walked the science road and neither of the others. If this
    // ever reads [1, 1, 1] then the three ladders are one measurement wearing
    // three hats, which is the failure `the-three-roads-are-three-roads` is
    // there to catch across a whole grid and this catches for free.
    expect(roadRungs(world)).toEqual([1, 0, 0]);

    friends(world, 1);
    expect(roadRungs(world)).toEqual([1, 1, 0]);

    world.stats.raidersKilled = STANDING_BAND;
    expect(roadRungs(world)).toEqual([1, 1, 1]);
  });

  it('takes its boundaries from the numbers the rest of the game is balanced on', () => {
    const world = createWorld(SEED);

    // Science starts where the first act stopped — the founding's own bar.
    projects(world, NEED_RESEARCH - 1);
    expect(road(world, 'science').rung).toBe(0);
    projects(world, NEED_RESEARCH);
    expect(road(world, 'science').rung).toBe(1);
    // …and it ends at the whole tree, not a round number near it.
    projects(world, RESEARCH_ORDER.length);
    expect(road(world, 'science').rung).toBe(ROAD_RUNGS);

    // Economy is measured in *places*, so a ring's worth is a rung and the last
    // one is everywhere on the map.
    friends(world, PER_RING);
    expect(road(world, 'economy').rung).toBe(2);
    friends(world, NEIGHBOUR_COUNT);
    expect(road(world, 'economy').rung).toBe(ROAD_RUNGS);

    // Warfare compounds by the storyteller's own patience, so each rung is the
    // last one three times over rather than a hand-picked step.
    world.stats.raidersKilled = STANDING_BAND * CLEAN_PER_STEP - 1;
    expect(road(world, 'warfare').rung).toBe(1);
    world.stats.raidersKilled = STANDING_BAND * CLEAN_PER_STEP;
    expect(road(world, 'warfare').rung).toBe(2);
  });

  it('draws the bar across the leg being walked rather than the whole road', () => {
    const world = createWorld(SEED);
    // Standing on a rung is nought toward the next one, not "most of the way to
    // the top". A bar measured against the far boundary would sit near empty for
    // most of a run and stop reading as progress at all, which is the mistake
    // the milestone panel made once and fixed the same way.
    projects(world, NEED_RESEARCH);
    const foot = road(world, 'science');
    expect(foot.rung).toBe(1);
    expect(foot.progress).toBe(0);
    expect(foot.of).toBeGreaterThan(NEED_RESEARCH);

    const free = RESEARCH_ORDER.filter((id) => !RESEARCH[id].materials).length;
    projects(world, Math.round((NEED_RESEARCH + free) / 2));
    const mid = road(world, 'science');
    expect(mid.rung).toBe(1);
    expect(mid.progress).toBeGreaterThan(0.4);
    expect(mid.progress).toBeLessThan(0.6);
  });

  it('stops asking for more from a road that is finished', () => {
    const world = createWorld(SEED);
    friends(world, NEIGHBOUR_COUNT);
    const top = road(world, 'economy');
    expect(top.rung).toBe(ROAD_RUNGS);
    expect(top.next).toBe(null);
    expect(top.standing).not.toBe(null);
    expect(top.progress).toBe(1);
    // A count still reading `12 / 12 places` on a finished road invites the
    // player to keep going somewhere there is nowhere to go.
    expect(top.count).not.toContain('/');
  });

  it('reports the rungs the grid samples in the order the grid reads them', () => {
    const world = createWorld(SEED);
    projects(world, NEED_RESEARCH);
    world.stats.raidersKilled = STANDING_BAND;
    // Two functions, one answer. The panel and the balance column disagreeing
    // about where a colony stands is the kind of bug that survives a long time,
    // because each of them looks right on its own.
    expect(roadRungs(world)).toEqual(roads(world).map((r) => r.rung));
    expect(roads(world).map((r) => r.id)).toEqual([...ROAD_IDS]);
  });

  it('counts one place as a place', () => {
    const world = createWorld(SEED);
    // The one boundary in the game that is a single anything. `0 / 1 places` is
    // the sort of thing nobody notices until it is on screen for an hour.
    expect(road(world, 'economy').count).toBe('0 / 1 place');
    friends(world, 2);
    expect(road(world, 'economy').count).toBe('2 / 4 places');
  });
});

describe('a colony that has actually played', () => {
  it('shows a founded colony the roads it has already started', () => {
    const world = founded();
    expect(hasWon(world)).toBe(true);
    // The panel this drives only appears at the founding, and what it says on
    // that first morning is a summary of the first act: six projects and one
    // neighbour who takes their calls. Both roads are started, neither is more
    // than a step in, and there is a named next rung on each.
    const science = road(world, 'science');
    const economy = road(world, 'economy');
    expect(science.rung).toBe(1);
    expect(science.next).not.toBe(null);
    expect(economy.rung).toBe(1);
    expect(economy.next).not.toBe(null);
  });

  it('gives a colony that fought nobody none of the warfare road', () => {
    const world = founded();
    // Winning the founding is not a fight, and the road that ends in taking the
    // ground must not be handed to a colony for surviving quietly. This is the
    // assertion that would fail if warfare were ever wired to something the
    // first act hands out — days lived, settlers, buildings.
    expect(world.stats.raidersKilled).toBe(0);
    expect(road(world, 'warfare').rung).toBe(0);
    expect(road(world, 'warfare').standing).toBe(null);
  });

  it('has no road anywhere near finished on the morning it is founded', () => {
    const world = founded();
    // The cheap half of `no-road-is-already-finished`. A founded colony is at
    // the *start* of the end game; if the founding itself topped a ladder out,
    // the ladder was measuring the first act.
    for (const r of roads(world)) expect(r.rung).toBeLessThan(ROAD_RUNGS);
  });

  it('reads the same rungs out of a save as it read before writing one', () => {
    const world = founded();
    world.stats.raidersKilled = STANDING_BAND * CLEAN_PER_STEP;
    friends(world, PER_RING);
    const before = roads(world);
    const r = deserialize(serialize(world, VIEW, 1, 1_700_000_000_000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = roads(r.save.world);
    // Nothing about the roads is in the save file, which is exactly why this
    // passes — and why it is worth a test. The day somebody caches a rung on the
    // world to save recomputing three integers, this is what fails.
    expect(after.map((r) => r.rung)).toEqual(before.map((r) => r.rung));
    expect(after.map((r) => r.count)).toEqual(before.map((r) => r.count));
  });
});
