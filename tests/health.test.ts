/**
 * Illness.
 *
 * Every number in `health.ts` exists to make one promise: nobody dies of bad
 * luck. A settler who is fed, in a bed and looked at by a doctor beats anything
 * in the file; a settler left standing in the rain on an empty stomach does not.
 * That promise is not something you can read off the constants — it is the
 * *outcome* of a race between two rates, four multipliers and a tending window,
 * and it is exactly the kind of thing a plausible-looking balance tweak breaks
 * silently. So the race is run here, end to end, and asserted on who wins.
 *
 * The other half of the file guards the seams: food poisoning must never be able
 * to put anyone in a bunk, a fever must not be undone by the combat pass
 * standing the body back up, and a hospital bed must be handed back when its
 * patient gets out of it.
 */

import { describe, expect, it } from 'vitest';

import {
  AILMENTS,
  DOWN_AT,
  REST_AT,
  TEND_TICKS,
  WOUND_BELOW,
  afflict,
  cure,
  hasAilment,
  needsBedRest,
  tendAilments,
  tickHealth,
  tooIllToStand,
  worstAilment,
} from '../src/sim/health';
import { isBed } from '../src/sim/buildings';
import { tickCombat } from '../src/sim/combat';
import { isWalkable } from '../src/sim/grid';
import { assignJob, tickJob } from '../src/sim/jobs';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { TICKS_PER_DAY, type Building, type Pawn, type World } from '../src/sim/types';
import { addBuilding, findBuilding } from '../src/sim/world';
import { stewardTick } from '../src/eval/steward';
import { CABIN, createWorld } from '../src/sim/worldgen';

/** The settlers, in id order, so a test always picks the same body. */
function colonists(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'colony' && !p.dead).sort((a, b) => a.id - b.id);
}

/** A settler with nothing else going wrong: full belly, rested, unhurt, awake. */
function healthy(pawn: Pawn): Pawn {
  pawn.needs.food = 1;
  pawn.needs.rest = 1;
  pawn.hp = pawn.maxHp;
  pawn.downed = false;
  pawn.dead = false;
  pawn.activity = 'idle';
  return pawn;
}

/**
 * Run the illness pass alone, without the rest of the tick.
 *
 * The race is what is under test; jobs, hunger and raiders are not. `tickHealth`
 * is the only thing in the sim that moves severity, so running it on its own is
 * the whole system and nothing else.
 */
function runIllness(world: World, ticks: number, keep: (world: World) => void = () => {}): void {
  const rng = new Rng(99);
  for (let t = 0; t < ticks; t++) {
    keep(world);
    world.tick++;
    tickHealth(world, rng);
  }
}

/** A free cell inside the cabin, for putting a bed in. */
function cabinCell(world: World): { x: number; y: number } {
  for (let y = CABIN.y0 + 1; y < CABIN.y1; y++) {
    for (let x = CABIN.x0 + 1; x < CABIN.x1; x++) {
      if (!isWalkable(world, x, y)) continue;
      if (world.buildings.some((b) => b.x === x && b.y === y)) continue;
      return { x, y };
    }
  }
  throw new Error('no free cabin cell');
}

/** Put a settler in a bed the way the sleep job does. */
function tuckIn(pawn: Pawn, bed: Building): void {
  bed.occupant = pawn.id;
  pawn.x = bed.x;
  pawn.y = bed.y;
  pawn.activity = 'sleeping';
}

describe('the race between severity and immunity', () => {
  it('lets a fed settler in a bed beat the flu without a doctor', () => {
    const world = createWorld();
    const spot = cabinCell(world);
    const bed = addBuilding(world, 'bed', spot.x, spot.y, true)!;
    const pawn = healthy(colonists(world)[0]!);
    expect(afflict(world, pawn, 'flu')).toBe(true);
    tuckIn(pawn, bed);

    // 0.44 severity a day against 0.82 immunity a day at full bed-rest scale:
    // the body wins with room to spare, and it does so without any medicine in
    // the colony at all. Bed rest alone has to be a real answer, or the player
    // has no move on day one.
    runIllness(world, TICKS_PER_DAY * 2, () => healthy(pawn) && tuckIn(pawn, bed));
    expect(hasAilment(pawn, 'flu')).toBe(false);
    expect(pawn.dead).toBe(false);
    expect(world.messages.some((m) => m.text.includes('shaken off'))).toBe(true);
  });

  it('kills the same settler if they keep working on an empty stomach', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    afflict(world, pawn, 'flu');

    // On their feet (×0.5) and starving (×0.45) is immunity at 0.18 a day
    // against severity at 0.44. Nothing about this is bad luck: it is four days
    // of a player watching a settler stagger around and doing nothing.
    runIllness(world, TICKS_PER_DAY * 5, () => {
      pawn.needs.food = 0.1;
      pawn.activity = 'idle';
    });
    expect(pawn.dead).toBe(true);
    expect(world.messages.some((m) => m.text.includes('died of the flu'))).toBe(true);
    expect(world.stats.colonistsLost).toBeGreaterThan(0);
  });

  it('downs them before it kills them, so the colony gets a last warning', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    afflict(world, pawn, 'flu');
    let downedAt = -1;
    let killedAt = -1;
    runIllness(world, TICKS_PER_DAY * 6, () => {
      pawn.needs.food = 0.1;
      if (downedAt < 0 && pawn.downed) downedAt = world.tick;
      if (killedAt < 0 && pawn.dead) killedAt = world.tick;
      if (!pawn.dead) pawn.activity = pawn.downed ? 'downed' : 'idle';
    });
    expect(downedAt).toBeGreaterThan(0);
    expect(killedAt).toBeGreaterThan(downedAt);
    // Hours of warning, not one tick of it. A collapse the player cannot react
    // to is the same as a death with no collapse.
    expect(killedAt - downedAt).toBeGreaterThan(TICKS_PER_DAY * 0.5);
    expect(world.messages.some((m) => m.text.includes('has collapsed'))).toBe(true);
  });

  it('makes tending flip a losing race into a winning one', () => {
    const losing = (tend: boolean): boolean => {
      const world = createWorld();
      const pawn = healthy(colonists(world)[0]!);
      afflict(world, pawn, 'infection');
      runIllness(world, TICKS_PER_DAY * 4, () => {
        pawn.needs.food = 1;
        pawn.activity = 'idle';
        // A doctor who keeps coming back — which is what the job actually does,
        // because the patient stays on the target list until the dressing is
        // fresh again.
        if (tend && world.tick % TEND_TICKS === 0) tendAilments(world, pawn, 0.8);
      });
      return pawn.dead;
    };
    // Same settler, same infection, same four days on their feet. The only
    // difference is whether anybody looked at it.
    expect(losing(false)).toBe(true);
    expect(losing(true)).toBe(false);
  });

  it('gives a hospital bed a real edge over an ordinary one', () => {
    const immunityAfter = (kind: 'bed' | 'medbed'): number => {
      const world = createWorld();
      const spot = cabinCell(world);
      const bed = addBuilding(world, kind, spot.x, spot.y, true)!;
      const pawn = healthy(colonists(world)[0]!);
      afflict(world, pawn, 'infection');
      runIllness(world, 200, () => healthy(pawn) && tuckIn(pawn, bed));
      return worstAilment(pawn)?.immunity ?? 1;
    };
    // 1.3× against 1.0×. Small enough that a plain bed is not useless, big
    // enough that the steel is worth spending before the raid that wounds
    // somebody.
    expect(immunityAfter('medbed')).toBeGreaterThan(immunityAfter('bed') * 1.2);
  });
});

describe('food poisoning', () => {
  it('is miserable and never lethal', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    afflict(world, pawn, 'foodPoisoning');
    const moodBefore = pawn.mood;

    // Worst case the sim can hand it: starving, on their feet, nobody tending.
    runIllness(world, TICKS_PER_DAY * 3, () => {
      pawn.needs.food = 0.05;
      pawn.activity = 'idle';
    });
    expect(pawn.dead).toBe(false);
    expect(pawn.downed).toBe(false);
    // The cap is what guarantees it: below the threshold that puts anyone down,
    // so eating a raw turnip can cost you an afternoon and never a settler.
    expect(AILMENTS.foodPoisoning.maxSeverity).toBeLessThan(DOWN_AT);
    expect(pawn.mood).toBeLessThan(moodBefore);
  });

  it('still sends them to bed, which is the point of it', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    afflict(world, pawn, 'foodPoisoning');
    runIllness(world, Math.round(TICKS_PER_DAY * 0.3), () => healthy(pawn));
    expect(worstAilment(pawn)!.severity).toBeGreaterThan(REST_AT);
    expect(needsBedRest(pawn)).toBe(true);
  });
});

describe('infection from a wound', () => {
  it('only threatens wounds deep enough to matter', () => {
    const world = createWorld();
    const [shallow, deep] = colonists(world);
    healthy(shallow!);
    healthy(deep!);
    shallow!.hp = shallow!.maxHp * (WOUND_BELOW + 0.05);
    deep!.hp = deep!.maxHp * 0.2;

    runIllness(world, TICKS_PER_DAY * 2, () => {
      shallow!.hp = shallow!.maxHp * (WOUND_BELOW + 0.05);
      deep!.hp = deep!.maxHp * 0.2;
      shallow!.needs.food = 1;
      deep!.needs.food = 1;
    });
    // A graze is a graze. If every scratch were a coin flip for sepsis the
    // player would learn to fear combat itself rather than fear neglecting it.
    expect(hasAilment(shallow!, 'infection')).toBe(false);
    expect(hasAilment(deep!, 'infection')).toBe(true);
  });

  it('stops rolling once somebody has tended the wound', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    pawn.hp = pawn.maxHp * 0.2;
    afflict(world, pawn, 'flu', false);
    runIllness(world, TICKS_PER_DAY * 2, () => {
      pawn.hp = pawn.maxHp * 0.2;
      pawn.needs.food = 1;
      // One ailment kept permanently fresh: the wound is dressed, so it cannot
      // fester underneath the dressing.
      tendAilments(world, pawn, 1);
    });
    expect(hasAilment(pawn, 'infection')).toBe(false);
  });
});

/**
 * A cure with no grace period is not a cure.
 *
 * An open wound rolls for infection every day it is open, and beating the
 * infection does not close the wound — so before convalescence, "has shaken off
 * the infection" and "has come down with an infection" were measured forty ticks
 * apart on the same settler, over and over, for the rest of the game. Nothing in
 * the log looked broken; the colony just never got better.
 */
describe('convalescence', () => {
  it('gives a settler a clear day after they beat something', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    pawn.hp = pawn.maxHp * 0.2;
    afflict(world, pawn, 'infection', false);
    // On the last lap of the race: a few passes and they are over it.
    pawn.ailments![0]!.immunity = 0.9999;
    runIllness(world, 20, () => {
      pawn.hp = pawn.maxHp * 0.2;
      pawn.needs.food = 1;
    });
    expect(hasAilment(pawn, 'infection')).toBe(false);
    expect(pawn.wellUntil).toBeGreaterThan(world.tick);

    // Same open wound, the rest of the day of rolls: nothing takes hold.
    runIllness(world, TICKS_PER_DAY - 24, () => {
      pawn.hp = pawn.maxHp * 0.2;
      pawn.needs.food = 1;
    });
    expect(pawn.ailments).toHaveLength(0);
  });

  it('lets them fall ill again once the window has passed', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    pawn.wellUntil = world.tick + 10;
    expect(afflict(world, pawn, 'flu', false)).toBe(false);

    world.tick += 11;
    expect(afflict(world, pawn, 'flu', false)).toBe(true);
  });

  it('does not shield anyone who never got better', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    expect(pawn.wellUntil).toBeUndefined();
    expect(afflict(world, pawn, 'flu', false)).toBe(true);
  });
});

describe('a fever and the combat pass', () => {
  it('keeps a downed settler down until the fever breaks, not until the skin closes', () => {
    const world = createWorld();
    const pawn = healthy(colonists(world)[0]!);
    afflict(world, pawn, 'infection', false);
    worstAilment(pawn)!.severity = DOWN_AT + 0.05;
    pawn.downed = true;
    pawn.activity = 'downed';
    pawn.hp = pawn.maxHp; // fully healed: combat's own revive test passes

    expect(tooIllToStand(pawn)).toBe(true);
    const rng = new Rng(4);
    for (let t = 0; t < 60; t++) {
      world.tick++;
      tickCombat(world, rng, null);
    }
    // Without the gate, combat.ts stands anybody over 35% hp back up — which
    // would have quietly undone the entire illness system every single tick.
    expect(pawn.downed).toBe(true);

    cure(pawn, 'infection');
    for (let t = 0; t < 60; t++) {
      world.tick++;
      tickCombat(world, rng, null);
    }
    expect(pawn.downed).toBe(false);
  });
});

describe('a colonist who falls ill on a live map', () => {
  it('takes to a bed, stays in it, and hands it back when the fever breaks', () => {
    const world = createWorld();
    const spot = cabinCell(world);
    const bed = addBuilding(world, 'medbed', spot.x, spot.y, true)!;
    const pawn = colonists(world)[0]!;
    // Everyone else out of the way, so the bed under test is claimed by the
    // patient and not by whoever happened to get tired first.
    for (const other of colonists(world)) {
      if (other.id !== pawn.id) other.dead = true;
    }
    healthy(pawn);
    afflict(world, pawn, 'flu');
    worstAilment(pawn)!.severity = REST_AT + 0.05;
    expect(needsBedRest(pawn)).toBe(true);

    // The whole tick, not just the illness pass: jobs, pathing, sleeping.
    const streams = makeStreams(world);
    let inBed = -1;
    for (let t = 0; t < TICKS_PER_DAY * 3 && (inBed < 0 || hasAilment(pawn, 'flu')); t++) {
      pawn.needs.food = 1;
      stepWorld(world, streams);
      if (inBed < 0 && bed.occupant === pawn.id && pawn.activity === 'sleeping') inBed = world.tick;
    }
    // Found the sickbay on their own — no order, no player click.
    expect(inBed).toBeGreaterThan(0);
    expect(hasAilment(pawn, 'flu')).toBe(false);
    expect(pawn.dead).toBe(false);

    // And got out of it. A hospital bed that is never released is a bed the
    // colony owns once; three of the four sites that hand a mattress back only
    // tested `kind === 'bed'` when the medbed shipped.
    for (let t = 0; t < TICKS_PER_DAY && bed.occupant !== null; t++) stepWorld(world, streams);
    expect(bed.occupant).toBeNull();
    expect(isBed('medbed')).toBe(true);
  });

  it('is treated by a doctor who tends the fever, not just the bullet hole', () => {
    const world = createWorld();
    const patient = colonists(world)[0]!;
    const doctor = colonists(world)[1]!;
    healthy(patient);
    healthy(doctor);
    doctor.skills.medicine = 8;
    afflict(world, patient, 'infection');
    patient.hp = patient.maxHp; // nothing to stitch: only the fever is left
    expect(worstAilment(patient)!.tendedUntil).toBe(0);

    const rng = new Rng(7);
    let tended = false;
    for (let t = 0; t < TICKS_PER_DAY && !tended; t++) {
      world.tick++;
      patient.needs.food = 1;
      doctor.needs.food = 1;
      doctor.needs.rest = 1;
      for (const p of colonists(world)) if (p.jobId === null) assignJob(world, p);
      for (const p of colonists(world)) tickJob(world, p, rng);
      tended = world.tick < (worstAilment(patient)?.tendedUntil ?? 0);
    }
    // Before this slice a doctor only looked at people who were bleeding, so an
    // untended fever in a full-health body was invisible to the whole colony.
    expect(tended).toBe(true);
    expect(worstAilment(patient)!.tendQuality).toBeGreaterThan(0.4);
    expect(world.messages.some((m) => m.text.includes("fever"))).toBe(true);
  });
});

describe('the outbreak', () => {
  it('arrives on its own clock and picks the settler already having a bad week', () => {
    const world = createWorld();
    for (const p of colonists(world)) healthy(p);
    const worn = colonists(world)[2]!;
    for (const p of colonists(world)) p.needs.rest = 0.9;
    worn.needs.rest = 0.15;

    world.storyteller.nextOutbreak = 1;
    const streams = makeStreams(world);
    let ill: Pawn | null = null;
    for (let t = 0; t < 40 && !ill; t++) {
      stepWorld(world, streams);
      ill = colonists(world).find((p) => hasAilment(p, 'flu')) ?? null;
    }
    // Not a die roll across the roster: the flu takes whoever the player has
    // been running into the ground, which turns a random event into a
    // consequence of how the colony has been run.
    expect(ill?.id).toBe(worn.id);
    // And it re-arms rather than firing again on the next tick.
    expect(world.storyteller.nextOutbreak).toBeGreaterThan(TICKS_PER_DAY * 2);
  });
});

describe('the sickbay the Steward builds', () => {
  it('is inside the cabin, gets finished, and nobody dies of a cold', () => {
    const world = createWorld(20260729);
    const streams = makeStreams(world);
    for (let t = 0; t < TICKS_PER_DAY * 8; t++) {
      stepWorld(world, streams);
      stewardTick(world, world.tick);
    }
    // Two more days before the roll-call. On day eight this colony has its ward
    // bed standing and a *second* one a few hours old, laid the moment the cold
    // store freed the board — and a bed laid yesterday failing "is it built" is
    // the fixture catching the Steward mid-stride, not an abandoned blueprint,
    // which is the thing the assertion below is actually for.
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
      stepWorld(world, streams);
      stewardTick(world, world.tick);
    }
    const medbeds = world.buildings.filter((b) => b.kind === 'medbed');
    expect(medbeds.length).toBeGreaterThan(0);
    for (const b of medbeds) {
      expect(b.x).toBeGreaterThan(CABIN.x0);
      expect(b.x).toBeLessThan(CABIN.x1);
      expect(b.y).toBeGreaterThan(CABIN.y0);
      expect(b.y).toBeLessThan(CABIN.y1);
      // Started is not good enough. A blueprint the Steward lays and never
      // finishes is a bed that does not exist on the night it is needed.
      expect(findBuilding(world, b.id)?.built).toBe(true);
    }
    // Eight days with outbreaks running and a competent manager: illness is
    // pressure, not attrition. If this ever goes red the rates are wrong, not
    // the test.
    expect(world.messages.filter((m) => m.text.includes('died of'))).toHaveLength(0);
  });
});
