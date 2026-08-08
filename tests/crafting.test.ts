/**
 * The workbench — the colony's answer to escalation.
 *
 * The 30-day sweeps found two dead ends that no amount of mining fixed. Raids
 * escalate to rifle-armed bands while settlers who wandered in still carry clubs,
 * and medicine drains to zero by about day 20 with no source anywhere on the map.
 * Meanwhile steel piled up once turrets and sandbags capped out, because rock was
 * the only sink in the game. The bench turns that surplus into the two things the
 * colony cannot mine, grow or scavenge — so these tests are about the *choice* it
 * makes as much as the work it does.
 */

import { describe, expect, it } from 'vitest';

import { isWalkable } from '../src/sim/grid';
import { describeTarget, interact } from '../src/sim/interact';
import { benchRecipe, benchRefusal } from '../src/sim/jobs';
import {
  CRAFT_DEFS,
  RECIPE_ORDER,
  bestCrafter,
  canCraft,
  colonyCanCraft,
  craftBlocker,
  craftSkill,
  pawnQualified,
  unlockedBy,
} from '../src/sim/crafting';
import { RESEARCH_ORDER } from '../src/sim/research';
import { possess, setPriority } from '../src/sim/orders';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import type { Pawn, World } from '../src/sim/types';
import { addBuilding, addItem, countResource, livingColonists } from '../src/sim/world';
import { CABIN, createWorld } from '../src/sim/worldgen';
import { qualifyAll } from './qualify';

/**
 * A world with an empty floor and a built bench next to the first settler.
 *
 * Worldgen ships starting supplies, and the recipe chooser reads free stock, so
 * every test here starts from a known pantry rather than day-one leftovers.
 *
 * Everybody is qualified for rifles and medicine, because the blocks below this
 * are about what the bench *chooses* and what the work does. Whether they are
 * allowed to choose at all is the gate block at the bottom of the file, which
 * sets its own skills.
 */
function benched(seed = 20260729): { world: World; pawn: Pawn; bench: { x: number; y: number } } {
  const b = benchedRaw(seed);
  qualifyAll(b.world, 'rifle', 'medicine');
  return b;
}

/** The same bench, with nobody granted anything — for the tests about the gates. */
function benchedRaw(seed = 20260729): { world: World; pawn: Pawn; bench: { x: number; y: number } } {
  const world = createWorld(seed);
  world.items.length = 0;
  for (const p of world.pawns) p.carryingItemId = null;
  // Nobody goes looking for a second pantry either. A scout who finds a cache
  // drops steel or raw food onto the map, which these exact-accounting tests
  // would read as materials appearing out of thin air.
  for (const p of world.pawns) p.priorities.scout = 0;

  const pawn = livingColonists(world)[0]!;
  const spot = freeCabinCell(world, 0);
  const bench = addBuilding(world, 'bench', spot.x, spot.y, true)!;
  // Stand the settler next to their bench: these tests are about the recipe and
  // the work, not about the walk.
  const stand = freeCabinCell(world, 1);
  pawn.x = stand.x;
  pawn.y = stand.y;
  pawn.facing = Math.atan2(bench.y - pawn.y, bench.x - pawn.x);
  return { world, pawn, bench: { x: bench.x, y: bench.y } };
}

/** The nth empty walkable cell inside the cabin, scanning from the door end. */
function freeCabinCell(world: World, skip: number): { x: number; y: number } {
  let seen = 0;
  for (let y = CABIN.y1 - 1; y > CABIN.y0; y--) {
    for (let x = CABIN.x0 + 1; x < CABIN.x1; x++) {
      if (!isWalkable(world, x, y)) continue;
      if (seen++ < skip) continue;
      return { x, y };
    }
  }
  throw new Error('cabin has no room for a bench');
}

describe('what the bench offers to make', () => {
  it('arms a settler who is still carrying a club', () => {
    const { world, pawn } = benched();
    pawn.weapon = 'club';
    addItem(world, 'steel', 70, pawn.x, pawn.y);

    expect(benchRecipe(world, pawn)?.recipe).toBe('rifle');
  });

  it('will not strip the wall of its next turret to do it', () => {
    const { world, pawn } = benched();
    pawn.weapon = 'club';
    // 60 steel is a rifle and change — but a turret costs 30, and a colony that
    // arms one settler by giving up the emplacement has traded down.
    addItem(world, 'steel', 60, pawn.x, pawn.y);

    expect(benchRecipe(world, pawn)).toBeNull();
  });

  it('does not re-arm somebody who already has a rifle', () => {
    const { world, pawn } = benched();
    pawn.weapon = 'rifle';
    addItem(world, 'steel', 200, pawn.x, pawn.y);

    expect(benchRecipe(world, pawn)).toBeNull();
  });

  it('makes medicine when the shelf is short and the pantry can spare the food', () => {
    const { world, pawn } = benched();
    pawn.weapon = 'rifle';
    addItem(world, 'rawfood', 40, pawn.x, pawn.y);

    expect(benchRecipe(world, pawn)?.recipe).toBe('medicine');
  });

  it('leaves the pantry two cook batches before it takes any', () => {
    const { world, pawn } = benched();
    pawn.weapon = 'rifle';
    addItem(world, 'rawfood', 20, pawn.x, pawn.y);

    expect(benchRecipe(world, pawn)).toBeNull();
  });

  it('stops once there is a course of medicine per settler and two spares', () => {
    const { world, pawn } = benched();
    pawn.weapon = 'rifle';
    addItem(world, 'rawfood', 40, pawn.x, pawn.y);
    // Two spares rather than one: a fever wants tending again every half day, so
    // illness empties the shelf faster than raids ever did.
    addItem(world, 'medicine', livingColonists(world).length + 2, pawn.x, pawn.y);

    expect(benchRecipe(world, pawn)).toBeNull();
  });

  it('arms the settler before it stocks the shelf', () => {
    const { world, pawn } = benched();
    pawn.weapon = 'club';
    addItem(world, 'steel', 90, pawn.x, pawn.y);
    addItem(world, 'rawfood', 40, pawn.x, pawn.y);

    // Both are available; a colony with clubs against rifles needs the rifle first.
    expect(benchRecipe(world, pawn)?.recipe).toBe('rifle');
  });
});

describe('the E-key prompt at a bench', () => {
  it('names what this settler would make, and starts it', () => {
    const { world, bench } = benched();
    const pawn = possess(world, livingColonists(world)[0]!.id)!;
    pawn.weapon = 'club';
    pawn.x = bench.x;
    pawn.y = bench.y - 1;
    pawn.facing = Math.atan2(bench.y - pawn.y, bench.x - pawn.x);
    const steel = addItem(world, 'steel', 70, pawn.x, pawn.y)!;

    expect(describeTarget(world, pawn)?.verb).toBe('Make yourself a rifle');
    expect(interact(world, pawn)).toBe('Making a rifle.');

    const job = world.jobs.find((j) => j.id === pawn.jobId);
    expect(job?.kind).toBe('craft');
    expect(job?.recipe).toBe('rifle');
    // The steel is claimed, so a hauler cannot walk off with it mid-job.
    expect(steel.reservedBy).toBe(job!.id);
  });

  it('says nothing when there is nothing worth making', () => {
    const { world, bench } = benched();
    const pawn = possess(world, livingColonists(world)[0]!.id)!;
    pawn.weapon = 'rifle';
    pawn.x = bench.x;
    pawn.y = bench.y - 1;
    pawn.facing = Math.atan2(bench.y - pawn.y, bench.x - pawn.x);

    // An empty floor: no steel, no raw food. The prompt must not offer a recipe
    // the settler would immediately refuse to start.
    expect(describeTarget(world, pawn)?.type).not.toBe('building');
  });
});

describe('making yourself a rifle, by hand', () => {
  // The experience test: possess a settler holding a club, walk them to the bench,
  // and they finish holding a rifle. No manager order was ever issued.
  const { world, bench } = benched();
  const pawn = possess(world, livingColonists(world)[0]!.id)!;
  pawn.weapon = 'club';
  pawn.x = bench.x;
  pawn.y = bench.y - 1;
  pawn.facing = Math.atan2(bench.y - pawn.y, bench.x - pawn.x);
  addItem(world, 'steel', 90, bench.x, bench.y - 2);
  const steelBefore = countResource(world, 'steel');
  interact(world, pawn);
  stepWorldN(world, makeStreams(world), 900);

  it('leaves the settler holding a rifle', () => {
    expect(pawn.weapon).toBe('rifle');
  });

  it('spends the steel, and only the steel it quoted', () => {
    expect(countResource(world, 'steel')).toBe(steelBefore - 35);
  });

  it('finishes the job rather than leaving it hanging', () => {
    expect(pawn.jobId).toBeNull();
    expect(world.jobs.some((j) => j.kind === 'craft')).toBe(false);
  });
});

describe('a colony stocking its own medicine', () => {
  // Nobody possessed: the work AI has to notice the empty medicine shelf, pick the
  // bench up as a job, and put three courses on the floor.
  const { world, bench } = benched(7);
  for (const p of livingColonists(world)) {
    p.weapon = 'rifle'; // take the rifle recipe off the table
    setPriority(world, p.id, 'craft', 1);
  }
  addItem(world, 'rawfood', 60, bench.x, bench.y - 1);
  stepWorldN(world, makeStreams(world), 1200);

  it('has medicine it did not start with', () => {
    expect(countResource(world, 'medicine')).toBeGreaterThanOrEqual(3);
  });

  it('paid for it out of the raw food, not out of thin air', () => {
    expect(countResource(world, 'rawfood')).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
// The gates: research is a wall in front of the colony, skill is a door in
// front of the person. Both have to hold, and both have to say why they did.
// ---------------------------------------------------------------------------

describe('who is allowed to make what', () => {
  it('lets a herbalist brew balm and a doctor brew the same balm', () => {
    const { world, pawn } = benchedRaw();
    const herbalist = { ...pawn, skills: { ...pawn.skills, plants: 5, medicine: 0 } };
    const doctor = { ...pawn, skills: { ...pawn.skills, plants: 0, medicine: 4 } };

    expect(pawnQualified(herbalist, 'balm')).toBe(true);
    expect(pawnQualified(doctor, 'balm')).toBe(true);
    // Neither of them can make the proper article — that wants a real doctor.
    expect(pawnQualified(herbalist, 'medicine')).toBe(false);
    expect(pawnQualified(doctor, 'medicine')).toBe(false);
    expect(world.research.done).not.toContain('fieldmedicine');
  });

  it('turns away the farmhand who is one level short of either door', () => {
    const { pawn } = benchedRaw();
    pawn.skills.plants = 4;
    pawn.skills.medicine = 3;

    expect(pawnQualified(pawn, 'balm')).toBe(false);
  });

  it('works the recipe with whichever trade the settler brought to it', () => {
    const { pawn } = benchedRaw();
    const skills = { ...pawn.skills };

    // Through the plants door only, through the medicine door only, and — when
    // both are open — whichever hand is actually steadier.
    expect(craftSkill({ ...pawn, skills: { ...skills, plants: 7, medicine: 0 } }, 'balm')).toBe('plants');
    expect(craftSkill({ ...pawn, skills: { ...skills, plants: 0, medicine: 6 } }, 'balm')).toBe('medicine');
    expect(craftSkill({ ...pawn, skills: { ...skills, plants: 5, medicine: 9 } }, 'balm')).toBe('medicine');
    expect(craftSkill({ ...pawn, skills: { ...skills, plants: 9, medicine: 5 } }, 'balm')).toBe('plants');
  });

  it('holds the research wall in front of the whole colony, however good they are', () => {
    const { world, pawn } = benchedRaw();
    pawn.skills.medicine = 20;

    expect(pawnQualified(pawn, 'medicine')).toBe(true);
    expect(canCraft(world, pawn, 'medicine')).toBe(false);
    expect(craftBlocker(world, pawn, 'medicine')).toBe('needs Field medicine');

    world.research.done.push('fieldmedicine');
    expect(canCraft(world, pawn, 'medicine')).toBe(true);
    expect(craftBlocker(world, pawn, 'medicine')).toBeNull();
  });

  it('names both doors when it turns somebody away', () => {
    const { world, pawn } = benchedRaw();
    pawn.skills.plants = 1;
    pawn.skills.medicine = 1;

    expect(craftBlocker(world, pawn, 'balm')).toBe('needs a herbalist at 5 or a doctor at 4');
  });

  it('answers for the colony, not the settler, when nobody is named', () => {
    const { world } = benchedRaw();
    for (const p of livingColonists(world)) {
      p.skills.plants = 1;
      p.skills.medicine = 1;
    }
    expect(craftBlocker(world, null, 'balm')).toBe('nobody here is a herbalist at 5 or a doctor at 4');
    expect(colonyCanCraft(world, 'balm')).toBe(false);

    // One settler learns the trade and the whole colony can suddenly make it —
    // which is exactly what makes two colonies on one seed different.
    livingColonists(world)[0]!.skills.plants = 5;
    expect(craftBlocker(world, null, 'balm')).toBeNull();
    expect(colonyCanCraft(world, 'balm')).toBe(true);
    expect(bestCrafter(world, 'balm')?.id).toBe(livingColonists(world)[0]!.id);
  });

  it('keeps a downed doctor on the books', () => {
    const { world } = benchedRaw();
    for (const p of livingColonists(world)) p.skills.plants = 1;
    const doc = livingColonists(world)[0]!;
    doc.skills.medicine = 6;
    doc.downed = true;

    // "We cannot make it until she is back up" is a different problem from "we
    // cannot make it at all", and only one of them is solved by a caravan.
    expect(colonyCanCraft(world, 'balm')).toBe(true);
  });
});

describe('what the bench says when it will not do it', () => {
  it('offers the prompt anyway, and answers with the reason', () => {
    const { world, bench } = benchedRaw();
    const pawn = possess(world, livingColonists(world)[0]!.id)!;
    pawn.weapon = 'rifle'; // rifles off the table; this is about the shelf
    for (const p of livingColonists(world)) {
      p.skills.plants = 2;
      p.skills.medicine = 2;
    }
    pawn.x = bench.x;
    pawn.y = bench.y - 1;
    pawn.facing = Math.atan2(bench.y - pawn.y, bench.x - pawn.x);
    addItem(world, 'rawfood', 60, pawn.x, pawn.y);

    // A silent bench is indistinguishable from a broken one, so the prompt stays.
    expect(describeTarget(world, pawn)?.verb).toBe('Look over the recipes');
    expect(interact(world, pawn)).toBe(
      'You cannot make healing balm: it needs a herbalist at 5 or a doctor at 4.',
    );
    expect(world.jobs.some((j) => j.kind === 'craft')).toBe(false);
  });

  it('points at the door that is one thing away, not two', () => {
    const { world, pawn } = benchedRaw();
    pawn.weapon = 'rifle';
    for (const p of livingColonists(world)) {
      p.skills.plants = 2;
      p.skills.medicine = 2;
    }
    addItem(world, 'rawfood', 60, pawn.x, pawn.y);

    // Both roads to medicine are shut. Balm's is shut by one skill; the kit's is
    // shut by a project *and* a skill. The useful sentence is the first one.
    expect(benchRefusal(world, pawn)).toContain('healing balm');
  });

  it('blames the stack when the stack is the problem', () => {
    const { world, pawn } = benched();
    pawn.weapon = 'rifle';
    for (let i = 0; i < 4; i++) addItem(world, 'rawfood', 15, pawn.x + i, pawn.y);

    // Sixty raw food, no stack of ten in one place. Nothing is locked; a hauler
    // fixes this, and the message has to say so rather than blaming a skill.
    expect(benchRefusal(world, pawn)).toBe('No single stack of rawfood big enough for medicine.');
  });
});

// ---------------------------------------------------------------------------
// Experience: a herbalist who has never treated anybody makes the medicine.
// ---------------------------------------------------------------------------

describe('the herbalist, played', () => {
  const { world, bench } = benchedRaw(1312);
  const pawn = possess(world, livingColonists(world)[0]!.id)!;
  pawn.weapon = 'rifle';
  for (const p of livingColonists(world)) {
    p.skills.plants = 1;
    p.skills.medicine = 1;
  }
  // One settler who knows plants, and nothing else about the colony has changed:
  // no research, no doctor, no caravan.
  pawn.skills.plants = 6;
  pawn.x = bench.x;
  pawn.y = bench.y - 1;
  pawn.facing = Math.atan2(bench.y - pawn.y, bench.x - pawn.x);
  addItem(world, 'rawfood', 60, bench.x, bench.y - 2);

  const foodBefore = countResource(world, 'rawfood');
  const plantsBefore = pawn.skills.plants;
  const said = interact(world, pawn);
  stepWorldN(world, makeStreams(world), 900);

  it('takes the job the gate lets them have', () => {
    expect(said).toBe('Making healing balm.');
  });

  it('puts medicine on the shelf a colony with no doctor could not otherwise get', () => {
    expect(countResource(world, 'medicine')).toBeGreaterThanOrEqual(2);
  });

  it('pays for it out of the pantry', () => {
    // At least the twelve the recipe quoted. Not exactly twelve: five settlers
    // eat out of the same pantry across the same nine hundred ticks, and pinning
    // the total would make this a test of appetite.
    expect(countResource(world, 'rawfood')).toBeLessThanOrEqual(foodBefore - 12);
  });

  it('leaves them better at the trade they actually used', () => {
    expect(pawn.skills.plants).toBeGreaterThan(plantsBefore);
    expect(pawn.skills.medicine).toBe(1);
  });
});

describe('what the research panel promises', () => {
  it('names the recipe a project opens, for every project that opens one', () => {
    // Derived from the recipe book rather than written out, so this is really a
    // test that no recipe can acquire a prerequisite in silence.
    for (const recipe of RECIPE_ORDER) {
      const need = CRAFT_DEFS[recipe].research;
      if (!need) continue;
      expect(unlockedBy(need)).toContain(CRAFT_DEFS[recipe].label);
    }
  });

  it('says nothing about a project that only makes the colony better at things', () => {
    // Plating is a straight buff with no bench recipe behind it. A panel that
    // said "Unlocks" under every line would teach the player to stop reading it.
    expect(unlockedBy('plating')).toBeNull();
  });

  it('reads as one sentence when a project opens more than one recipe', () => {
    const many = RESEARCH_ORDER.map((id) => unlockedBy(id)).filter(
      (s): s is string => s !== null && s.includes(' and '),
    );
    for (const s of many) expect(s.endsWith('at the workbench.')).toBe(true);
  });
});
