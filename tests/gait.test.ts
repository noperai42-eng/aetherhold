/**
 * The walk, in numbers.
 *
 * Nothing here can be seen, which is the point: "it reads as skating" is a
 * feeling, and a feeling cannot fail a build. Foot scrub is a distance, in the
 * same cells the sim moves bodies through, so it can be asserted at zero and
 * stay there.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PHASE_PER_CELL,
  SETTLER_LEG,
  SETTLER_PHASE,
  SETTLER_SWING,
  footScrub,
  phaseScale,
  stepsPerSecond,
  strideCells,
} from '../src/client/gait';
import { RUN_SPEED, WALK_SPEED } from '../src/sim/movement';
import { TICKS_PER_SECOND } from '../src/sim/types';

/** Legs and swing of a calf, which is the smallest body that still has to walk. */
const CALF_SCALE = 0.45;
const ANIMAL_LEG = 0.56;
const ANIMAL_SWING = 0.55;

describe('the number the sim and the renderer both have to hold', () => {
  it('still matches the literal in followPath', () => {
    // `PHASE_PER_CELL` is a copy, because exporting the real one would edit
    // `src/sim/**` and cost a sixty-day grid re-run to say what it already
    // says. A copy is only safe while something fails when it drifts, and this
    // is that something.
    const source = readFileSync(new URL('../src/sim/movement.ts', import.meta.url), 'utf8');
    const written = source.match(/animPhase \+= step \* ([0-9.]+)/);
    expect(written).not.toBeNull();
    expect(Number(written![1])).toBe(PHASE_PER_CELL);
  });
});

describe('a foot that stays where it was put', () => {
  it('measures a stride as the ground one full swing covers', () => {
    // Foot reaches leg·sin(swing) ahead of the hip and the same behind it, so a
    // step spans twice that and a cycle — left, then right — spans four.
    const reach = SETTLER_LEG * Math.sin(SETTLER_SWING);
    expect(reach).toBeCloseTo(0.43, 2);
    expect(strideCells(SETTLER_LEG, SETTLER_SWING)).toBeCloseTo(reach * 4, 10);
  });

  it('leaves a settler no scrub at all', () => {
    expect(footScrub(SETTLER_LEG, SETTLER_SWING, SETTLER_PHASE)).toBeCloseTo(0, 10);
  });

  it('records what the old fixed swing cost, so a revert cannot pass quietly', () => {
    // The bug, in cells: the planted foot slid backwards across the ground by
    // about the length of the step it had just taken — 0.86 of foot against
    // 0.42 of ground, better than twice as fast as the world went by.
    expect(footScrub(SETTLER_LEG, SETTLER_SWING, 1)).toBeCloseTo(0.441, 3);
    expect(SETTLER_PHASE).toBeCloseTo(0.4871, 4);
  });

  it('calls scissoring too fast a skate and scissoring too slow a moonwalk', () => {
    expect(footScrub(SETTLER_LEG, SETTLER_SWING, SETTLER_PHASE * 1.5)).toBeGreaterThan(0);
    expect(footScrub(SETTLER_LEG, SETTLER_SWING, SETTLER_PHASE * 0.5)).toBeLessThan(0);
  });

  it('holds for any legs and any swing, not just the settler’s', () => {
    for (const leg of [0.2, 0.56, 0.74, 1.3]) {
      for (const swing of [0.2, 0.55, 0.62, 1.1]) {
        expect(footScrub(leg, swing, phaseScale(leg, swing))).toBeCloseTo(0, 10);
      }
    }
  });
});

describe('bodies of different sizes on the same ground', () => {
  it('makes a calf take more steps than its dam, which is what short legs do', () => {
    const dam = phaseScale(ANIMAL_LEG, ANIMAL_SWING);
    const calf = phaseScale(ANIMAL_LEG * CALF_SCALE, ANIMAL_SWING);
    expect(calf).toBeGreaterThan(dam);
    // Exactly as much more as she is smaller: half the leg, twice the steps.
    expect(calf / dam).toBeCloseTo(1 / CALF_SCALE, 10);
    expect(footScrub(ANIMAL_LEG * CALF_SCALE, ANIMAL_SWING, calf)).toBeCloseTo(0, 10);
  });

  it('stands a body with no legs still rather than scissoring at infinity', () => {
    // A newborn scaled to nothing, or a rig mid-vanish. Dividing by that stride
    // would be a division by zero and a limb spinning at the frame rate.
    expect(phaseScale(0, ANIMAL_SWING)).toBe(0);
    expect(phaseScale(ANIMAL_LEG, 0)).toBe(0);
    expect(phaseScale(Number.POSITIVE_INFINITY, ANIMAL_SWING)).toBe(0);
    expect(footScrub(ANIMAL_LEG, ANIMAL_SWING, 0)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('the cadence planting the foot leaves behind', () => {
  // Fixing a scrub by slowing the legs is only a fix while the legs still look
  // like legs. A cell is a metre and a tick is a twentieth of a second, so
  // these are steps per second and can be held against a real gait.
  const cadence = (cellsPerTick: number): number =>
    stepsPerSecond(cellsPerTick * TICKS_PER_SECOND, SETTLER_LEG, SETTLER_SWING);

  it('walks at a rate a person walks at', () => {
    expect(cadence(WALK_SPEED)).toBeGreaterThan(3);
    expect(cadence(WALK_SPEED)).toBeLessThan(4.5);
  });

  it('quickens into a run rather than staying a walk played faster', () => {
    expect(cadence(RUN_SPEED)).toBeGreaterThan(cadence(WALK_SPEED));
    expect(cadence(RUN_SPEED)).toBeLessThan(6);
  });

  it('was a sprint at every speed before, which is the thing that read as skating', () => {
    // The old rig turned one full sin cycle per 2π of phase with no conversion,
    // so a settler ambling across the yard took seven and a half steps a second.
    const old = (WALK_SPEED * TICKS_PER_SECOND) / (Math.PI / PHASE_PER_CELL);
    expect(old).toBeGreaterThan(7);
    expect(old / cadence(WALK_SPEED)).toBeCloseTo(1 / SETTLER_PHASE, 6);
  });
});
