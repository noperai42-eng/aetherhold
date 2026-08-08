/**
 * What a settler wears and carries.
 *
 * Two slots, and that is the whole design: one thing on the body, one thing in
 * the hands. A single slot each is what turns a wardrobe into a decision —
 * steel plate stops the raider and costs you the winter; a parka is most of a
 * cold night and almost no armour at all. If every piece stacked, the answer
 * would always be "wear everything" and there would be nothing to think about.
 *
 * Every effect in `gear.ts` has exactly one caller in the sim, so these tests
 * come in pairs: the number is right, and the one place that reads it reads it.
 */

import { describe, expect, it } from 'vitest';

import { damagePawn } from '../src/sim/combat';
import { CRAFT_DEFS, RECIPE_ORDER, outputEquip, recipeForEquip } from '../src/sim/crafting';
import {
  EQUIP,
  EQUIP_ORDER,
  armourOf,
  equip,
  gearTreatmentScale,
  gearWorkScale,
  insulationOf,
  isUpgrade,
} from '../src/sim/gear';
import { dressedFor } from '../src/sim/health';
import { RESEARCH } from '../src/sim/research';
import { livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import type { EquipKind, Pawn, World } from '../src/sim/types';

function fresh(): { world: World; pawn: Pawn } {
  const world = createWorld(20260729);
  const pawn = livingColonists(world)[0]!;
  world.messages.length = 0;
  return { world, pawn };
}

describe('the two slots', () => {
  it('starts everybody in the clothes they arrived in — nothing', () => {
    const { pawn } = fresh();
    expect(armourOf(pawn)).toBe(0);
    expect(insulationOf(pawn)).toBe(0);
    expect(gearWorkScale(pawn)).toBe(1);
    expect(gearTreatmentScale(pawn)).toBe(1);
  });

  it('replaces what was in the slot and says what came off', () => {
    const { pawn } = fresh();
    expect(equip(pawn, 'jerkin')).toBe(null);
    expect(equip(pawn, 'parka')).toBe('jerkin');
    expect(pawn.apparel).toBe('parka');
    // The other slot is untouched by any of it: this is a coat, not a toolbelt.
    expect(equip(pawn, 'toolbelt')).toBe(null);
    expect(pawn.apparel).toBe('parka');
    expect(pawn.gear).toBe('toolbelt');
  });

  it('never asks anybody to make the thing they are already wearing', () => {
    // The loop this prevents: a settler crafts a jerkin, wants a jerkin, crafts
    // another, for ever — twelve hides a time, at the bench, all winter.
    const { pawn } = fresh();
    for (const kind of EQUIP_ORDER.filter((k) => EQUIP[k].slot === 'apparel')) {
      equip(pawn, kind);
      expect(isUpgrade(pawn, kind)).toBe(false);
    }
  });

  it('walks each line one way and then stops', () => {
    // Both lines have to terminate, or the bench loops for ever. Rifleman:
    // nothing, jerkin, plate, done. Everyone else: nothing, jerkin, parka, done.
    const armed = fresh().pawn;
    armed.weapon = 'rifle';
    expect(isUpgrade(armed, 'jerkin')).toBe(true);
    equip(armed, 'jerkin');
    expect(isUpgrade(armed, 'plate')).toBe(true);
    expect(isUpgrade(armed, 'parka')).toBe(false);
    equip(armed, 'plate');
    for (const kind of ['jerkin', 'parka', 'plate'] as const) {
      expect(isUpgrade(armed, kind)).toBe(false);
    }

    const cold = fresh().pawn;
    cold.weapon = 'club';
    equip(cold, 'jerkin');
    expect(isUpgrade(cold, 'parka')).toBe(true);
    expect(isUpgrade(cold, 'plate')).toBe(false);
    equip(cold, 'parka');
    for (const kind of ['jerkin', 'parka', 'plate'] as const) {
      expect(isUpgrade(cold, kind)).toBe(false);
    }
  });

  it('keeps the fur parka from being dead content', () => {
    // The bug this is here for: rank everybody by armour and a jerkin — cheap,
    // early, and better armour than a coat — means nobody ever wants a parka,
    // and the Furriery research unlocks a garment the colony never makes.
    const { pawn } = fresh();
    pawn.weapon = 'club';
    equip(pawn, 'jerkin');
    expect(isUpgrade(pawn, 'parka')).toBe(true);
  });

  it('swaps a settler onto the other line the day they are handed a rifle', () => {
    const { pawn } = fresh();
    pawn.weapon = 'club';
    equip(pawn, 'parka');
    expect(isUpgrade(pawn, 'plate')).toBe(false);
    pawn.weapon = 'rifle';
    expect(isUpgrade(pawn, 'plate')).toBe(true);
  });

  it('gives the doctor the bag and everybody else the belt', () => {
    const { pawn } = fresh();
    pawn.priorities.doctor = 2;
    pawn.skills.medicine = 6;
    expect(isUpgrade(pawn, 'medkit')).toBe(true);
    equip(pawn, 'medkit');
    expect(isUpgrade(pawn, 'toolbelt')).toBe(false);

    const hand = fresh().pawn;
    hand.skills.medicine = 0;
    expect(isUpgrade(hand, 'toolbelt')).toBe(true);
    equip(hand, 'toolbelt');
    expect(isUpgrade(hand, 'medkit')).toBe(false);
  });
});

describe('armour, where it lands', () => {
  it('takes its cut off every hit, in the one place damage is dealt', () => {
    const { world, pawn } = fresh();
    const before = pawn.hp;
    damagePawn(world, pawn, 10, 'a club');
    const bare = before - pawn.hp;

    const { world: w2, pawn: p2 } = fresh();
    equip(p2, 'plate');
    const before2 = p2.hp;
    damagePawn(w2, p2, 10, 'a club');
    const plated = before2 - p2.hp;

    expect(plated).toBeCloseTo(bare * (1 - EQUIP.plate.armour!));
    expect(plated).toBeLessThan(bare);
  });

  it('is a fraction, not a shield — plate still bleeds', () => {
    const { world, pawn } = fresh();
    equip(pawn, 'plate');
    const before = pawn.hp;
    damagePawn(world, pawn, 20, 'a club');
    expect(pawn.hp).toBeLessThan(before);
  });
});

describe('insulation, where it lands', () => {
  it('takes the edge off the cold without ever flipping it to hot', () => {
    // A parka is 0.85 of comfort; a night at -0.4 must come out at 0, not +0.45.
    const worn = { apparel: 'parka' } as Pawn;
    expect(dressedFor(worn, -0.4)).toBe(0);
    expect(dressedFor(worn, -1)).toBeCloseTo(-0.15);
  });

  it('works the same way in a heatwave, and plate makes one worse', () => {
    const worn = { apparel: 'jerkin' } as Pawn;
    expect(dressedFor(worn, 0.5)).toBeCloseTo(0.3);
    expect(dressedFor(worn, 0.1)).toBe(0);
    // Steel in the sun: negative insulation, so the number moves the wrong way.
    const plated = { apparel: 'plate' } as Pawn;
    expect(dressedFor(plated, -0.5)).toBeLessThan(-0.5);
  });

  it('leaves a bare settler exactly as the weather found them', () => {
    const bare = {} as Pawn;
    expect(dressedFor(bare, -0.7)).toBe(-0.7);
    expect(dressedFor(bare, 0)).toBe(0);
  });
});

describe('the quality-of-life half', () => {
  it('makes a toolbelt worth the hides at every bench', () => {
    const { pawn } = fresh();
    equip(pawn, 'toolbelt');
    expect(gearWorkScale(pawn)).toBeCloseTo(EQUIP.toolbelt.work!);
  });

  it("charges plate's weight against the same number", () => {
    // The trade-off that stops plate being a strict upgrade for everybody: the
    // colony's best builder in a steel suit is a slower builder.
    const { pawn } = fresh();
    equip(pawn, 'plate');
    expect(gearWorkScale(pawn)).toBeLessThan(1);
    equip(pawn, 'toolbelt');
    expect(gearWorkScale(pawn)).toBeCloseTo(EQUIP.plate.work! * EQUIP.toolbelt.work!);
  });

  it("puts the doctor's bag on treatment and nowhere else", () => {
    const { pawn } = fresh();
    equip(pawn, 'medkit');
    expect(gearTreatmentScale(pawn)).toBeCloseTo(EQUIP.medkit.treatment!);
    expect(gearWorkScale(pawn)).toBe(1);
  });
});

describe('how any of it gets made', () => {
  it('has a recipe for every piece, and a piece for every equipment recipe', () => {
    for (const kind of EQUIP_ORDER) {
      const recipe = recipeForEquip(kind);
      expect(recipe).not.toBe(null);
      expect(RECIPE_ORDER).toContain(recipe!);
      expect(outputEquip(CRAFT_DEFS[recipe!])).toBe(kind);
    }
  });

  it('gates every piece behind research the colony has to go and do', () => {
    for (const kind of EQUIP_ORDER) {
      const def = CRAFT_DEFS[recipeForEquip(kind)!];
      expect(def.research).toBeDefined();
      expect(RESEARCH[def.research!]).toBeDefined();
    }
  });

  it('asks for a skilled pair of hands as well as the knowledge', () => {
    // Research is the colony's; the gate is the settler's. A colony that knows
    // how to beat plate still needs somebody who can beat it.
    for (const kind of EQUIP_ORDER) {
      const def = CRAFT_DEFS[recipeForEquip(kind)!];
      expect(def.gate).toBeDefined();
      expect(def.gate!.level).toBeGreaterThan(0);
    }
  });

  it('costs more for more protection', () => {
    const cost = (kind: EquipKind) => CRAFT_DEFS[recipeForEquip(kind)!].work;
    expect(cost('plate')).toBeGreaterThan(cost('parka'));
    expect(cost('parka')).toBeGreaterThan(cost('jerkin'));
  });
});
