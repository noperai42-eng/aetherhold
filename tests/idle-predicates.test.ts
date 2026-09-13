/**
 * Unit tests for the three predicates `src/eval/run.ts` counts
 * `idleBoardTicks`/`idleTakeableTicks` from: `isIdlePawn`, `boardOpen`, and
 * `hasTakeableWork`. Each is a one-way-door contract (a grid column), so this
 * file exercises the exclusions and the disjuncts directly rather than only
 * through a whole-colony run — a change to any one of them should fail here
 * before it ever reaches a thirty-day grid.
 *
 * Fixtures are built from a real `createWorld` and real sim helpers
 * (`addBuilding`, `createJob`) rather than hand-rolled objects, matching this
 * file's neighbours: the shape a `Building` or `Job` has to have is a detail
 * of the sim, not of the test.
 */

import { describe, expect, it } from 'vitest';
import { boardOpen, hasTakeableWork, isIdlePawn } from '../src/eval/run';
import { createWorld } from '../src/sim/worldgen';
import { addBuilding, livingColonists } from '../src/sim/world';
import { createJob } from '../src/sim/jobs';
import { DESIG_HARVEST, DESIG_NONE, DESIG_TILL, packCell } from '../src/sim/types';

/** A fresh colony with its board and designations cleared, for a controlled read. */
function bareWorld() {
  const world = createWorld(1);
  world.buildings = world.buildings.filter((b) => b.built);
  world.cellDesig.fill(DESIG_NONE);
  world.research.current = null;
  const pawn = livingColonists(world)[0]!;
  for (const w of Object.keys(pawn.priorities) as (keyof typeof pawn.priorities)[]) {
    pawn.priorities[w] = 0;
  }
  return { world, pawn };
}

describe('isIdlePawn', () => {
  it('is idle with no job and every exclusion clear', () => {
    const { world, pawn } = bareWorld();
    expect(pawn.jobId).toBeNull();
    expect(isIdlePawn(world, pawn)).toBe(true);
  });

  it('is not idle dead, downed, drafted, hand-driven, asleep or breaking', () => {
    const { world, pawn } = bareWorld();
    pawn.dead = true;
    expect(isIdlePawn(world, pawn)).toBe(false);
    pawn.dead = false;
    pawn.downed = true;
    expect(isIdlePawn(world, pawn)).toBe(false);
    pawn.downed = false;
    pawn.drafted = true;
    expect(isIdlePawn(world, pawn)).toBe(false);
    pawn.drafted = false;
    pawn.manual = true;
    expect(isIdlePawn(world, pawn)).toBe(false);
    pawn.manual = false;
    pawn.activity = 'sleeping';
    expect(isIdlePawn(world, pawn)).toBe(false);
  });

  it('is not idle off the colony faction, even with no job', () => {
    const { world, pawn } = bareWorld();
    pawn.faction = 'raider';
    expect(isIdlePawn(world, pawn)).toBe(false);
  });

  it('is idle on their own recreation, and not idle on any other job', () => {
    const { world, pawn } = bareWorld();
    createJob(world, pawn, 'recreate', pawn.x, pawn.y);
    expect(isIdlePawn(world, pawn)).toBe(true);
    pawn.jobId = null;
    createJob(world, pawn, 'mine', pawn.x, pawn.y);
    expect(isIdlePawn(world, pawn)).toBe(false);
  });

  it('is not idle holding a job id the job list cannot find', () => {
    const { world, pawn } = bareWorld();
    pawn.jobId = 999999;
    expect(isIdlePawn(world, pawn)).toBe(false);
  });
});

describe('boardOpen', () => {
  it('is closed with nothing built, nothing designated and no bill', () => {
    const { world } = bareWorld();
    expect(boardOpen(world)).toBe(false);
  });

  it('opens on an unbuilt blueprint', () => {
    const { world, pawn } = bareWorld();
    addBuilding(world, 'wall', Math.round(pawn.x) + 4, Math.round(pawn.y), false);
    expect(boardOpen(world)).toBe(true);
  });

  it('opens on a designated cell', () => {
    const { world, pawn } = bareWorld();
    world.cellDesig[packCell(world, Math.round(pawn.x) + 4, Math.round(pawn.y))] = DESIG_HARVEST;
    expect(boardOpen(world)).toBe(true);
  });

  it('opens on a stalled bill, taken as given rather than re-derived', () => {
    const { world } = bareWorld();
    expect(boardOpen(world, true)).toBe(true);
    expect(boardOpen(world, false)).toBe(false);
  });
});

describe('hasTakeableWork', () => {
  it('is false with the board open but every work type switched off', () => {
    const { world, pawn } = bareWorld();
    const b = addBuilding(world, 'wall', Math.round(pawn.x) + 1, Math.round(pawn.y), false)!;
    b.have = { ...b.needs };
    expect(hasTakeableWork(world, pawn, false)).toBe(false);
  });

  it('takes a reachable, supplied, unreserved blueprint once construct is on', () => {
    const { world, pawn } = bareWorld();
    const b = addBuilding(world, 'wall', Math.round(pawn.x) + 1, Math.round(pawn.y), false)!;
    b.have = { ...b.needs };
    pawn.priorities.construct = 1;
    expect(hasTakeableWork(world, pawn, false)).toBe(true);
  });

  it('is false on a blueprint that is not supplied yet', () => {
    const { world, pawn } = bareWorld();
    addBuilding(world, 'wall', Math.round(pawn.x) + 1, Math.round(pawn.y), false);
    pawn.priorities.construct = 1;
    expect(hasTakeableWork(world, pawn, false)).toBe(false);
  });

  it('is false on a blueprint another job already has a claim on', () => {
    const { world, pawn } = bareWorld();
    const b = addBuilding(world, 'wall', Math.round(pawn.x) + 1, Math.round(pawn.y), false)!;
    b.have = { ...b.needs };
    pawn.priorities.construct = 1;
    const other = livingColonists(world)[1]!;
    createJob(world, other, 'build', b.x, b.y, { buildingId: b.id });
    expect(hasTakeableWork(world, pawn, false)).toBe(false);
  });

  it('does not claim a harvest designation sitting on non-rock terrain', () => {
    // `hasTakeableWork`'s mine branch is gated on `terrainAt(...) === 'rock'`;
    // the pawn's own doorstep is cleared grass by construction, so a harvest
    // designation dropped there must never read as takeable mine work.
    const { world, pawn } = bareWorld();
    world.cellDesig[packCell(world, Math.round(pawn.x) + 1, Math.round(pawn.y))] = DESIG_HARVEST;
    pawn.priorities.mine = 1;
    expect(hasTakeableWork(world, pawn, false)).toBe(false);
  });

  it('takes a designated till cell once farm is on, not when it is off', () => {
    const { world, pawn } = bareWorld();
    // `canTill` refuses bare 'dirt' (the worn path right at spawn) and any
    // cell a building already stands on; step off to open grass instead.
    const x = Math.round(pawn.x) - 6;
    const y = Math.round(pawn.y) - 6;
    world.cellDesig[packCell(world, x, y)] = DESIG_TILL;
    expect(hasTakeableWork(world, pawn, false)).toBe(false);
    pawn.priorities.farm = 1;
    expect(hasTakeableWork(world, pawn, false)).toBe(true);
  });

  it('is false on a stalled bill when hauling is switched off', () => {
    const { world, pawn } = bareWorld();
    expect(hasTakeableWork(world, pawn, true)).toBe(false);
  });
});
