/**
 * Nobody burns to death in their sleep.
 *
 * The bug this exists to close, from a twenty-four day headless run of seed 1337:
 * a storm-lit fire reached the bunk room a little after midnight on day twenty-one
 * and four settlers — two of them in the sickbay with flu — burned where they lay.
 * Each one went from full health to `is down!` to `is dead. (fire)` inside five
 * seconds of real time, having never woken up. The colony went from six to three
 * in under a minute, and it was the only thing in twenty-four days that hurt it.
 *
 * The sim already believed that danger gets you out of bed — the sleep job checks
 * for hostiles within twelve cells every tick and wakes the sleeper. Fire was
 * simply not counted as danger. So this is less a new mechanic than the missing
 * half of one, and it comes in two parts, because there are two ways to be in a
 * fire:
 *
 *   - **You can walk.** Then you wake up, drop whatever you were doing, and run
 *     for the nearest ground that is not alight. That is `flee`, and it outranks
 *     everything, including the work priorities the player set: no priority
 *     column means "stand in the fire".
 *   - **You cannot.** A downed settler has no way out on their own, and this is
 *     exactly the case the sickbay put two people in. Somebody comes and carries
 *     them out. That is `rescue`.
 *
 * Both are pushed from here rather than pulled from `assignJob`, and that is the
 * load-bearing decision in the file. Settlers re-evaluate their work every twelve
 * ticks, staggered by id; a downed settler at the fire's damage rate has about
 * four seconds of life left. Waiting for the next scheduled think is waiting too
 * long, so the fire interrupts them instead.
 *
 * Deliberately out of scope: prisoners. A conscious captive who ran from a fire
 * would be escaping, which is a mechanic this game does not have, and inventing
 * it here — inside a fire — is not the place to start.
 */

import { FIRE_CLEAR, dist, fireAt, nearestSafeCell } from './grid';
import { createJob, reachable } from './jobs';
import { cancelJob, msg } from './world';
import type { Job, Pawn, World } from './types';

function jobOf(world: World, pawn: Pawn): Job | null {
  if (pawn.jobId === null) return null;
  return world.jobs.find((j) => j.id === pawn.jobId) ?? null;
}

export function tickFireSafety(world: World): void {
  if (world.fires.length === 0) return;
  for (const pawn of world.pawns) {
    if (pawn.dead || pawn.faction !== 'colony') continue;
    if (!fireAt(world, pawn.x, pawn.y)) continue;
    if (pawn.downed) {
      sendSomebody(world, pawn);
      continue;
    }
    // Somebody over their shoulder: keep going. The rescue job already re-routes
    // around flames that get in front of it, and putting a body down in a fire
    // to save yourself kills the body — the one outcome this module exists to
    // prevent.
    if (pawn.carryingPawnId != null) continue;
    // The player's own body is not steered out of anything. They can see the
    // flames from inside it and the log has already said the place is alight;
    // taking the controls away would be a worse bug than the one this fixes.
    if (pawn.playerControlled) continue;
    getOut(world, pawn);
  }
}

/** Wake up, drop everything, and run. */
function getOut(world: World, pawn: Pawn): void {
  const current = jobOf(world, pawn);
  if (current?.kind === 'flee') return;
  const spot = nearestSafeCell(world, pawn.x, pawn.y);
  // Nowhere within reach is any better. Standing still beats running deeper in.
  if (!spot) return;

  // A drafted settler belongs to the combat pass, which never looks at jobs — so
  // a flee job would sit on them and never run. They take a move order instead,
  // which is the same instruction in the language that pass speaks, and they
  // keep shooting on the way out because that is what `draftedColonist` does
  // with a settler who has somewhere to be.
  if (pawn.drafted) {
    const heading =
      pawn.orderX !== null && pawn.orderY !== null && !fireAt(world, pawn.orderX, pawn.orderY, FIRE_CLEAR);
    if (heading) return;
    pawn.orderX = spot.x;
    pawn.orderY = spot.y;
    pawn.path = null;
    msg(world, `${pawn.name} breaks off — the ground is burning.`, 'bad');
    return;
  }

  const asleep = pawn.activity === 'sleeping';
  if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
  // Set before the job, because `finishJob` leaves a sleeping settler asleep —
  // it has to, or every completed job would wake the colony up — and a settler
  // who arrives at the far end of the yard still marked `sleeping` is a settler
  // both cameras draw lying down in the grass.
  pawn.activity = 'walking';
  createJob(world, pawn, 'flee', spot.x, spot.y, { stage: 'goto' });
  msg(
    world,
    asleep ? `${pawn.name} wakes with the bed alight.` : `${pawn.name} is caught in the fire.`,
    'bad',
  );
}

/** Somebody who cannot walk is in the flames. Send the nearest pair of hands. */
function sendSomebody(world: World, patient: Pawn): void {
  // One rescuer is enough. Any *other* job aimed at this pawn is called off:
  // a doctor walking over to kneel and treat somebody where they lie is walking
  // into a fire to do first aid on a burning patient, and the two jobs would
  // fight over the same body. Getting them out comes first, treatment after.
  const stale: number[] = [];
  for (const j of world.jobs) {
    if (j.targetPawnId !== patient.id) continue;
    if (j.kind === 'rescue') return;
    stale.push(j.id);
  }
  for (const id of stale) cancelJob(world, id);

  let best: Pawn | null = null;
  let bestD = Infinity;
  for (const p of world.pawns) {
    if (p.id === patient.id || p.dead || p.downed) continue;
    if (p.faction !== 'colony' || p.playerControlled || p.drafted) continue;
    // A player who set this column to zero has said they want this settler kept
    // away from fires. That answer covers running into one for somebody else.
    if (p.priorities.firefight <= 0) continue;
    // In the fire themselves, or already running from it: their own way out
    // comes first, and a rescuer who collapses on the way has cost two lives.
    if (fireAt(world, p.x, p.y)) continue;
    const busy = jobOf(world, p);
    if (busy?.kind === 'flee' || busy?.kind === 'rescue') continue;
    const d = dist(p.x, p.y, patient.x, patient.y);
    if (d >= bestD) continue;
    if (!reachable(world, p, Math.round(patient.x), Math.round(patient.y), true)) continue;
    best = p;
    bestD = d;
  }
  if (!best) return;

  const spot = nearestSafeCell(world, patient.x, patient.y);
  if (!spot) return;
  if (best.jobId !== null) cancelJob(world, best.jobId);
  best.activity = 'walking';
  createJob(world, best, 'rescue', spot.x, spot.y, { targetPawnId: patient.id, stage: 'goto' });
  msg(world, `${best.name} runs for ${patient.name}, who is down in the fire.`, 'threat');
}
