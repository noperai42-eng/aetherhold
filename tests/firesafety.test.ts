/**
 * Nobody burns to death in their sleep.
 *
 * The bug these assertions exist to stop, from a twenty-four day headless run of
 * seed 1337: a fire reached the bunk room after midnight on day twenty-one and
 * four settlers — two of them in the sickbay with flu — burned where they lay.
 * None of them woke. The log showed each going `is down!` then `is dead. (fire)`
 * a few seconds later, while the survivors hit morale breaks and nobody fought
 * the fire. It was the only thing in twenty-four days that hurt that colony.
 *
 * The last test in this file is the one that would have caught it: a hut, four
 * sleepers, and a fire in the middle of them. Everything above it is the
 * behaviour that test depends on, asserted one piece at a time so a failure
 * names which piece broke.
 */

import { describe, expect, it } from 'vitest';

import { igniteFire } from '../src/sim/events';
import { tickFireSafety } from '../src/sim/firesafety';
import { FIRE_CLEAR, buildingAt, fireAt } from '../src/sim/grid';
import { createJob } from '../src/sim/jobs';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { addBuilding } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { terrainAt, type Job, type Pawn, type World } from '../src/sim/types';
import { createWorld, makePawn } from '../src/sim/worldgen';

function game(seed = 1337) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

/** Open ground, three cells clear every way, well away from the cabin. */
function clearing(world: World, from = 8): { x: number; y: number } {
  for (let y = from; y < world.height - 8; y++) {
    for (let x = from; x < world.width - 8; x++) {
      let clear = true;
      for (let dy = -3; dy <= 3 && clear; dy++) {
        for (let dx = -3; dx <= 3 && clear; dx++) {
          if (buildingAt(world, x + dx, y + dy)) clear = false;
          else if (terrainAt(world, x + dx, y + dy) === 'rock') clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no clearing on this map');
}

/**
 * A settler standing exactly here, with nothing else going on.
 *
 * Made rather than borrowed from the starting six: worldgen's settlers spawn
 * with their own opinions about where to be, and a test that has to fight the
 * job system for control of its subject is a test about the job system.
 */
function settler(world: World, x: number, y: number): Pawn {
  // Seeded off the roster so each one gets a different name — a log line reading
  // "Tibb runs for Tibb" is not evidence of anything.
  const p = makePawn(world, new Rng(7 + world.pawns.length), 'colony', x, y);
  p.x = x;
  p.y = y;
  p.jobId = null;
  p.path = null;
  p.activity = 'idle';
  return p;
}

/**
 * Put a settler on the floor the way a bullet or a fever does.
 *
 * The bleed counter is the load-bearing part: the combat pass stands a downed
 * pawn back up the moment they have stopped bleeding and have a third of their
 * health, so a test that only sets `downed = true` is testing a settler who is
 * on their feet again one tick later.
 */
function down(p: Pawn): void {
  p.downed = true;
  p.activity = 'downed';
  p.hp = p.maxHp * 0.5;
  p.bleed = 20 * 45;
}

function jobOf(world: World, pawn: Pawn): Job | null {
  return world.jobs.find((j) => j.id === pawn.jobId) ?? null;
}

describe('a settler who can walk', () => {
  it('is given a way out of the fire they are standing in', () => {
    const { world } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    igniteFire(world, spot.x, spot.y);

    tickFireSafety(world);

    const job = jobOf(world, p);
    expect(job?.kind).toBe('flee');
    // Somewhere genuinely clear, not merely the next cell over: a fire spreads
    // to its neighbours, so stopping one step out is stopping in the fire's way.
    expect(fireAt(world, job!.tx, job!.ty, FIRE_CLEAR)).toBe(false);
  });

  it('wakes up to do it', () => {
    const { world } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    p.activity = 'sleeping';
    igniteFire(world, spot.x, spot.y);

    tickFireSafety(world);

    // The whole of the original bug in one assertion. A settler still marked
    // asleep is a settler both cameras draw lying down, and one the sim never
    // moves.
    expect(p.activity).not.toBe('sleeping');
    expect(jobOf(world, p)?.kind).toBe('flee');
    expect(world.messages[world.messages.length - 1]!.text).toContain('wakes with the bed alight');
  });

  it('drops the work it was doing to do it', () => {
    const { world } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    createJob(world, p, 'research', spot.x + 4, spot.y);
    igniteFire(world, spot.x, spot.y);

    tickFireSafety(world);

    expect(jobOf(world, p)?.kind).toBe('flee');
    // Cancelled, not merely orphaned: a job left in the list is a job another
    // settler is told is already taken.
    expect(world.jobs.filter((j) => j.kind === 'research')).toHaveLength(0);
  });

  it('is not told to run twice', () => {
    const { world } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    igniteFire(world, spot.x, spot.y);

    tickFireSafety(world);
    const first = p.jobId;
    tickFireSafety(world);
    tickFireSafety(world);

    // Re-issuing every tick would reset the path every tick, and a settler who
    // recomputes their escape forever never takes a step of it.
    expect(p.jobId).toBe(first);
    expect(world.jobs.filter((j) => j.kind === 'flee')).toHaveLength(1);
  });

  it('actually gets out, and stops when it is out', () => {
    const { world, streams } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    igniteFire(world, spot.x, spot.y);

    stepWorldN(world, streams, 60);

    expect(fireAt(world, p.x, p.y)).toBe(false);
    expect(p.dead).toBe(false);
    // The job ends rather than hanging on — they are back on the colony's work
    // list. A settler permanently mid-flight never goes back to work, which is a
    // slower version of the same bug.
    expect(jobOf(world, p)?.kind).not.toBe('flee');
  });

  it('is left alone when there is no fire near them', () => {
    const { world } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    igniteFire(world, spot.x + 9, spot.y + 9);

    tickFireSafety(world);

    expect(p.jobId).toBeNull();
  });
});

describe('the exceptions', () => {
  it('moves a drafted settler with an order, not a job', () => {
    const { world } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    p.drafted = true;
    igniteFire(world, spot.x, spot.y);

    tickFireSafety(world);

    // Drafted settlers are driven by the combat pass, which never looks at
    // jobs — a flee job would sit on them unexecuted while they burned.
    expect(p.jobId).toBeNull();
    expect(p.orderX).not.toBeNull();
    expect(fireAt(world, p.orderX!, p.orderY!, FIRE_CLEAR)).toBe(false);
  });

  it('leaves a drafted settler already heading somewhere safe alone', () => {
    const { world } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    p.drafted = true;
    p.orderX = spot.x + 6;
    p.orderY = spot.y;
    igniteFire(world, spot.x, spot.y);

    tickFireSafety(world);

    // Overwriting a standing order every tick is how you pin a soldier in place
    // — and the player may have picked that corner for a reason.
    expect(p.orderX).toBe(spot.x + 6);
  });

  it('never takes the controls off the player', () => {
    const { world } = game();
    const spot = clearing(world);
    const p = settler(world, spot.x, spot.y);
    p.playerControlled = true;
    igniteFire(world, spot.x, spot.y);

    tickFireSafety(world);

    // They are standing in it in first person with the log telling them so.
    // Walking their body out from under them is a worse bug than the one this
    // module fixes.
    expect(p.jobId).toBeNull();
  });

  it('leaves raiders to burn', () => {
    const { world } = game();
    const spot = clearing(world);
    const r = makePawn(world, new Rng(8), 'raider', spot.x, spot.y);
    r.x = spot.x;
    r.y = spot.y;
    igniteFire(world, spot.x, spot.y);

    tickFireSafety(world);

    expect(r.jobId).toBeNull();
  });
});

describe('a settler who cannot walk', () => {
  /** A downed settler on a burning cell, and one able colleague nearby. */
  function sickbay(seed = 1337) {
    const { world, streams } = game(seed);
    const spot = clearing(world);
    // The starting six are stood down, so the tests below name exactly who is
    // available and the answer is not "whoever worldgen happened to spawn
    // nearest the clearing".
    for (const p of world.pawns) p.priorities.firefight = 0;
    const patient = settler(world, spot.x, spot.y);
    down(patient);
    const helper = settler(world, spot.x + 3, spot.y);
    igniteFire(world, spot.x, spot.y);
    return { world, streams, patient, helper, spot };
  }

  it('has somebody sent for them', () => {
    const { world, patient, helper } = sickbay();

    tickFireSafety(world);

    const job = jobOf(world, helper);
    expect(job?.kind).toBe('rescue');
    expect(job?.targetPawnId).toBe(patient.id);
    expect(fireAt(world, job!.tx, job!.ty, FIRE_CLEAR)).toBe(false);
  });

  it('has one person sent, not everybody', () => {
    const { world, spot } = sickbay();
    settler(world, spot.x + 4, spot.y);
    settler(world, spot.x + 5, spot.y);

    tickFireSafety(world);
    tickFireSafety(world);

    // Three settlers converging on one body is three settlers standing in a
    // fire, and the colony loses the lot.
    expect(world.jobs.filter((j) => j.kind === 'rescue')).toHaveLength(1);
  });

  it('is not fetched by somebody the player keeps away from fires', () => {
    const { world, helper } = sickbay();
    helper.priorities.firefight = 0;

    tickFireSafety(world);

    expect(world.jobs.filter((j) => j.kind === 'rescue')).toHaveLength(0);
  });

  it('is not fetched by somebody who is in the fire themselves', () => {
    const { world, spot } = sickbay();
    // Only candidate, and standing in the flames: their own way out first.
    for (const p of world.pawns) {
      if (p.faction === 'colony' && !p.downed) {
        p.x = spot.x;
        p.y = spot.y;
      }
    }

    tickFireSafety(world);

    expect(world.jobs.filter((j) => j.kind === 'rescue')).toHaveLength(0);
  });

  it('is carried clear, and put down when they are', () => {
    const { world, streams, patient, helper } = sickbay();

    stepWorldN(world, streams, 80);

    expect(fireAt(world, patient.x, patient.y)).toBe(false);
    expect(patient.dead).toBe(false);
    // Shouldered on the way, on the ground at the end. A patient left flagged as
    // carried is a patient who teleports after their carrier forever.
    expect(helper.carryingPawnId ?? null).toBeNull();
    expect(world.messages.some((m) => m.text.includes('clear of the fire'))).toBe(true);
  });

  it('travels with their carrier rather than sliding along the floor', () => {
    const { world, streams, patient, helper } = sickbay();

    // Far enough in for the pick-up, not so far that the trip is over.
    let carried = false;
    for (let i = 0; i < 80 && !carried; i++) {
      stepWorld(world, streams);
      carried = helper.carryingPawnId === patient.id;
    }

    expect(carried).toBe(true);
    // One more tick: the pick-up and the first step happen in that order, so
    // the frame the shoulder is taken on is the one frame the two bodies are
    // legitimately apart.
    stepWorld(world, streams);

    expect(patient.x).toBe(helper.x);
    expect(patient.y).toBe(helper.y);
  });

  it('is left where they are once they get back on their feet', () => {
    const { world, streams, patient, helper } = sickbay();

    stepWorld(world, streams);
    expect(jobOf(world, helper)?.kind).toBe('rescue');
    patient.downed = false;

    stepWorld(world, streams);

    // They can run now. A rescuer still crossing the yard for somebody who is
    // already up is a rescuer not fighting the fire.
    expect(jobOf(world, helper)?.kind).not.toBe('rescue');
  });
});

describe('the bunk room on day twenty-one', () => {
  /**
   * A hut with four beds and four sleepers, and a fire in the middle of it.
   *
   * Deliberately built rather than replayed from the seed: reproducing the
   * original run means waiting twenty-one days for a storyteller to roll the
   * same fire, which is a test that takes minutes and stops being about fire
   * the first time the storyteller's odds change. The shape is what mattered —
   * unconscious or asleep, indoors, on a burning cell.
   */
  function bunkRoom() {
    const { world, streams } = game();
    const spot = clearing(world, 10);
    const sleepers: Pawn[] = [];
    for (let i = 0; i < 4; i++) {
      const x = spot.x + (i % 2);
      const y = spot.y + Math.floor(i / 2);
      addBuilding(world, 'bed', x, y, true);
      const p = settler(world, x, y);
      p.activity = 'sleeping';
      sleepers.push(p);
    }
    // Two of the four were flu patients who could not have moved themselves.
    down(sleepers[2]!);
    down(sleepers[3]!);
    // Someone awake in the next room to pull them out.
    settler(world, spot.x + 4, spot.y);
    settler(world, spot.x + 5, spot.y);
    igniteFire(world, spot.x, spot.y);
    igniteFire(world, spot.x + 1, spot.y);
    return { world, streams, sleepers };
  }

  it('empties before it kills anybody', () => {
    const { world, streams, sleepers } = bunkRoom();

    // Twenty seconds of sim. Before this module a settler on a burning cell was
    // dead inside that window and had not moved a step.
    stepWorldN(world, streams, 400);

    for (const p of sleepers) {
      expect(`${p.name}: ${p.dead ? 'dead' : 'alive'}`).toBe(`${p.name}: alive`);
      expect(fireAt(world, p.x, p.y)).toBe(false);
    }
    expect(world.messages.some((m) => m.text.includes('(fire)'))).toBe(false);
  });

  it('does not leave the survivors standing in the yard forever', () => {
    const { world, streams, sleepers } = bunkRoom();

    stepWorldN(world, streams, 900);

    // The fire is out or has moved on, and the colony went back to work. A
    // permanent flee state would be a colony that never eats again.
    const stuck = sleepers.filter((p) => !p.dead && jobOf(world, p)?.kind === 'flee');
    expect(stuck).toEqual([]);
  });
});
