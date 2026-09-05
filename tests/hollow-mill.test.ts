/**
 * Sect Iter 1 — mortal hollow mill.
 *
 * The loop is the slice: walk, optional talk, clear the jam without qi. The
 * kit is the dressing, and the budget numbers live on the kit so a later
 * cottage cannot quietly blow the pocket's draw call cap.
 */

import { describe, expect, it } from 'vitest';

import {
  HOLLOW,
  HOLLOW_WALK,
  blocked,
  createHollowState,
  hollowFocus,
  hollowInteract,
  hollowPrompt,
  hollowWalk,
  inReach,
  pocketFromSearch,
} from '../src/client/scene/hollow-loop';
import { BUDGET, buildHollowKit, disposeHollowKit, kitBudgetOk } from '../src/client/worldkit/kit';
import { MATERIAL_ROLES } from '../src/client/worldkit/materials';

function walkToward(
  from: ReturnType<typeof createHollowState>,
  target: { x: number; z: number },
  seconds: number,
): ReturnType<typeof createHollowState> {
  let s = from;
  const dt = 1 / 20;
  for (let t = 0; t < seconds; t += dt) {
    const dx = target.x - s.x;
    const dz = target.z - s.z;
    if (dx * dx + dz * dz < 0.16) break;
    s = hollowWalk(s, dx, dz, dt, false);
  }
  return s;
}

/** The race sits south of the mill house; a straight line from spawn hits timber. */
function walkToJam(from: ReturnType<typeof createHollowState>) {
  return walkToward(walkToward(from, { x: 4.2, z: -3.8 }, 10), HOLLOW.jam, 6);
}

describe('the hollow opens from a query, not from the sim', () => {
  it('reads ?pocket=hollow and ignores anything else', () => {
    expect(pocketFromSearch('?pocket=hollow')).toBe('hollow');
    expect(pocketFromSearch('pocket=hollow&foo=1')).toBe('hollow');
    expect(pocketFromSearch('?hollow=1')).toBe('hollow');
    expect(pocketFromSearch('?pocket=colony')).toBeNull();
    expect(pocketFromSearch('')).toBeNull();
  });
});

describe('the mortal verbs', () => {
  it('starts jammed, silent, and too far from the race to cheat', () => {
    const s = createHollowState();
    expect(s.jammed).toBe(true);
    expect(s.cleared).toBe(false);
    expect(s.talked).toBe(false);
    expect(hollowFocus(s)).toBeNull();
    expect(inReach(s, HOLLOW.jam, HOLLOW.jam.reach)).toBe(false);
    const still = hollowInteract(s);
    expect(still.jammed).toBe(true);
    expect(still.cleared).toBe(false);
  });

  it('lets you talk to the headman without clearing the mill', () => {
    const at = walkToward(createHollowState(), HOLLOW.headman, 8);
    expect(hollowFocus(at)).toBe('headman');
    expect(hollowPrompt(at)).toBe('Talk to the headman');
    const spoken = hollowInteract(at);
    expect(spoken.talked).toBe(true);
    expect(spoken.jammed).toBe(true);
    expect(spoken.line).toMatch(/gate-lever/);
    expect(spoken.line.toLowerCase()).not.toMatch(/\bqi\b/);
  });

  it('clears the jam by walking there and using your hands', () => {
    const at = walkToJam(createHollowState());
    expect(hollowFocus(at)).toBe('jam');
    expect(hollowPrompt(at)).toBe('Clear the mill jam');
    const done = hollowInteract(at);
    expect(done.jammed).toBe(false);
    expect(done.cleared).toBe(true);
    expect(done.line).toMatch(/gate-lever/);
    expect(done.line).toMatch(/shoulder/);
    expect(done.line.toLowerCase()).not.toMatch(/\bqi\b|\bspirit\b|\btechnique\b/);
    expect(hollowPrompt(done)).toBe('The mill is turning.');
  });

  it('will not walk through the mill house', () => {
    const s = { ...createHollowState(), x: 3.8, z: 0.55 };
    const into = hollowWalk(s, 8, 0, 0.5, false);
    expect(into.x).toBeLessThan(HOLLOW.millHouse.x);
    expect(blocked(HOLLOW.millHouse.x, HOLLOW.millHouse.z)).toBe(true);
  });

  it('walks at a mortal pace, not a cultivation dash', () => {
    const s = createHollowState();
    const step = hollowWalk(s, 1, 0, 1, false);
    expect(step.x - s.x).toBeCloseTo(HOLLOW_WALK, 5);
    expect(step.x - s.x).toBeLessThan(4);
  });
});

describe('the village kit budget', () => {
  it('stays inside the pocket caps', () => {
    const kit = buildHollowKit();
    try {
      expect(kit.budget.roles).toBe(MATERIAL_ROLES.length);
      expect(kit.budget.roles).toBeLessThanOrEqual(BUDGET.materials);
      expect(kit.budget.materials).toBeLessThanOrEqual(BUDGET.materials);
      expect(kit.budget.draws).toBeLessThanOrEqual(BUDGET.draws);
      expect(kit.budget.tris).toBeLessThanOrEqual(BUDGET.tris);
      expect(kitBudgetOk(kit.budget)).toBe(true);
      expect(kit.wheel.parent).toBe(kit.group);
      expect(kit.debris.parent).toBe(kit.group);
    } finally {
      disposeHollowKit(kit);
    }
  });
});
