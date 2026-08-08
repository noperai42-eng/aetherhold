/**
 * Mining, from both views onto the one simulation.
 *
 * Steel comes out of rock and nowhere else, so mining is the whole metal economy.
 * The manager view could always order it; first person could not, because rock is
 * terrain and the E-key target scan only ever looked at buildings — a settler could
 * fell a tree by hand but stood in front of a cliff with no prompt at all. These
 * tests pin the fix and the reachability feedback that goes with it.
 */

import { describe, expect, it } from 'vitest';

import { adjacentStandCells } from '../src/sim/grid';
import { describeTarget, interact } from '../src/sim/interact';
import { possess, unreachableRock } from '../src/sim/orders';
import { reachable } from '../src/sim/jobs';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { DESIG_HARVEST, packCell, terrainAt } from '../src/sim/types';
import type { Pawn, World } from '../src/sim/types';
import { itemsAt, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

interface Face {
  rock: { x: number; y: number };
  stand: { x: number; y: number };
}

/** The nearest rock face this settler could actually walk up to and swing at. */
function nearestFace(world: World, pawn: Pawn): Face {
  let best: Face | null = null;
  let bestD = Infinity;
  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      if (terrainAt(world, x, y) !== 'rock') continue;
      const d = Math.hypot(x - pawn.x, y - pawn.y);
      if (d >= bestD) continue;
      const stand = adjacentStandCells(world, x, y)[0];
      if (!stand) continue;
      if (!reachable(world, pawn, x, y, true)) continue;
      best = { rock: { x, y }, stand };
      bestD = d;
    }
  }
  if (!best) throw new Error('worldgen produced no reachable rock face');
  return best;
}

/** Stand the body on the working cell, looking at the rock, as a walk there would. */
function faceUp(pawn: Pawn, f: Face): void {
  pawn.x = f.stand.x;
  pawn.y = f.stand.y;
  pawn.facing = Math.atan2(f.rock.y - pawn.y, f.rock.x - pawn.x);
}

describe('the E-key prompt at a rock face', () => {
  it('offers to mine the rock in front of you', () => {
    const world = createWorld(20260729);
    const pawn = possess(world, livingColonists(world)[0]!.id)!;
    const f = nearestFace(world, pawn);
    faceUp(pawn, f);

    const t = describeTarget(world, pawn);
    expect(t?.type).toBe('rock');
    expect(t?.verb).toBe('Mine this rock');
  });

  it('says so when the cell is already marked, rather than reading as a fresh order', () => {
    const world = createWorld(20260729);
    const pawn = possess(world, livingColonists(world)[0]!.id)!;
    const f = nearestFace(world, pawn);
    faceUp(pawn, f);
    world.cellDesig[packCell(world, f.rock.x, f.rock.y)] = DESIG_HARVEST;

    expect(describeTarget(world, pawn)?.verb).toBe('Keep mining');
  });

  it('does not offer rock you are not standing next to', () => {
    const world = createWorld(20260729);
    const pawn = possess(world, livingColonists(world)[0]!.id)!;
    const f = nearestFace(world, pawn);
    faceUp(pawn, f);
    // Aim at the same rock from two cells further back: arm's reach, not line of sight.
    pawn.x = f.stand.x + (f.stand.x - f.rock.x) * 2;
    pawn.y = f.stand.y + (f.stand.y - f.rock.y) * 2;

    const t = describeTarget(world, pawn);
    expect(t?.type).not.toBe('rock');
  });
});

describe('pressing E on rock', () => {
  it('creates the same mine job the manager would have ordered', () => {
    const world = createWorld(20260729);
    const pawn = possess(world, livingColonists(world)[0]!.id)!;
    const f = nearestFace(world, pawn);
    faceUp(pawn, f);

    expect(interact(world, pawn)).toBe('Mining.');
    const job = world.jobs.find((j) => j.id === pawn.jobId);
    expect(job?.kind).toBe('mine');
    expect({ x: job!.tx, y: job!.ty }).toEqual(f.rock);
    // Marked as well as queued, so the order survives the player wandering off and
    // shows up in the manager view like any other designation.
    expect(world.cellDesig[packCell(world, f.rock.x, f.rock.y)]).toBe(DESIG_HARVEST);
  });
});

describe('digging out a wall by hand', () => {
  // The experience test: possess a settler, walk them to the cliff, hold the swing,
  // and the map itself changes. No manager order was ever issued.
  const world = createWorld(20260729);
  const pawn = possess(world, livingColonists(world)[0]!.id)!;
  const f = nearestFace(world, pawn);
  faceUp(pawn, f);
  interact(world, pawn);
  const before = pawn.skills.mining;
  stepWorldN(world, makeStreams(world), 400);

  it('turns the rock into floor', () => {
    expect(terrainAt(world, f.rock.x, f.rock.y)).toBe('stone');
  });

  it('leaves steel on the ground where the wall was', () => {
    const steel = itemsAt(world, f.rock.x, f.rock.y).find((s) => s.kind === 'steel');
    expect(steel).toBeDefined();
    expect(steel!.amount).toBeGreaterThanOrEqual(12);
  });

  it('teaches the miner something and clears the mark', () => {
    expect(pawn.skills.mining).toBeGreaterThan(before);
    expect(world.cellDesig[packCell(world, f.rock.x, f.rock.y)]).toBe(0);
  });
});

describe('rock nobody can get a pick to', () => {
  it('is counted so the harvest tool can say why nothing happened', () => {
    const world = createWorld(20260729);
    const pawn = livingColonists(world)[0]!;
    const face = nearestFace(world, pawn);

    // A blob interior: rock with no walkable neighbour at all. Every map has some,
    // and marking one is the case that used to look like a broken tool.
    let interior: { x: number; y: number } | null = null;
    for (let y = 1; y < world.height - 1 && !interior; y++) {
      for (let x = 1; x < world.width - 1; x++) {
        if (terrainAt(world, x, y) !== 'rock') continue;
        if (adjacentStandCells(world, x, y).length > 0) continue;
        interior = { x, y };
        break;
      }
    }
    expect(interior).not.toBeNull();

    expect(unreachableRock(world, [face.rock])).toBe(0);
    expect(unreachableRock(world, [interior!])).toBe(1);
    expect(unreachableRock(world, [face.rock, interior!])).toBe(1);
    // Cells that are not rock are not the harvest tool's problem.
    expect(unreachableRock(world, [face.stand])).toBe(0);
  });
});
