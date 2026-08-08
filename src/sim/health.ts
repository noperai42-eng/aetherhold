/**
 * Illness: the race between severity and immunity.
 *
 * A wound that nobody washes goes septic. A cold night gives somebody the flu.
 * A settler who eats a raw turnip because the meals ran out spends a day being
 * sick behind the cabin. All three are the same object — an ailment with two
 * numbers climbing towards 1, and whichever gets there first decides what
 * happens. Immunity wins and they shrug it off; severity wins and they die.
 *
 * The rates are deliberately set so that *doing nothing sensible* is what kills
 * people, not bad luck. A settler who is fed, in a bed and tended recovers from
 * everything in this file. A settler left standing in the rain on an empty
 * stomach loses. That is the whole design: the illness is not the threat, the
 * neglect is.
 */

import { TICKS_PER_DAY } from './types';
import { grieve, nudgeMood } from './needs';
import { cellTemp } from './temperature';
import { insulationOf } from './gear';
import { cancelJob, msg } from './world';
import type { Ailment, AilmentKind, Building, Pawn, World } from './types';
import type { Rng } from './rng';
import { eulogyFor } from './lifelog';

/** Per-day rates, converted once. Everything below is per tick. */
const perTick = (perDay: number): number => perDay / TICKS_PER_DAY;

export interface AilmentDef {
  /** How the HUD and the message log name it. */
  label: string;
  /** Severity gained per day when nobody has tended it. */
  severityPerDay: number;
  /**
   * Immunity gained per day by a settler who is fed and up and about. Bed rest
   * and a doctor multiply this; hunger and exhaustion divide it.
   */
  immunityPerDay: number;
  /**
   * Ceiling on severity. Below `DOWN_AT` an ailment can never put anyone in a
   * bunk, which is how food poisoning stays a bad afternoon rather than a
   * funeral.
   */
  maxSeverity: number;
  /** Mood cost per day while it is running. */
  moodPerDay: number;
}

export const AILMENTS: Record<AilmentKind, AilmentDef> = {
  // Fastest of the three and the only one you bring on yourself, by leaving the
  // wounded lying where they fell.
  infection: { label: 'an infection', severityPerDay: 0.62, immunityPerDay: 0.95, maxSeverity: 1, moodPerDay: 0.5 },
  flu: { label: 'the flu', severityPerDay: 0.44, immunityPerDay: 0.82, maxSeverity: 1, moodPerDay: 0.4 },
  // Never lethal: it caps below the threshold that puts anyone down.
  foodPoisoning: { label: 'food poisoning', severityPerDay: 1.4, immunityPerDay: 2.6, maxSeverity: 0.5, moodPerDay: 1.1 },
};

/** Severity at which a settler is too ill to work and takes to a bed. */
export const REST_AT = 0.26;
/** Severity at which they stop being able to stand at all. */
export const DOWN_AT = 0.62;

/** Tending slows severity to this share of its usual climb. It never reverses it. */
const TENDED_SEVERITY = 0.34;
/** How long one round of treatment holds before the wound needs looking at again. */
export const TEND_TICKS = Math.round(TICKS_PER_DAY * 0.5);

/** Immunity multipliers. In a bed you fight it off; on your feet you mostly do not. */
const IMMUNITY_IN_BED = 1.0;
const IMMUNITY_MEDBED = 1.3;
const IMMUNITY_ON_FEET = 0.5;
/** A body with nothing in it cannot build antibodies. */
const IMMUNITY_STARVING = 0.45;
const HUNGRY_BELOW = 0.3;
/** Nor can one that is spending everything it has on staying warm. */
const IMMUNITY_COLD = 0.7;
/**
 * Exported so the settler card can call somebody "cold" at exactly the point
 * their immune system starts paying for it, rather than at a number the HUD
 * picked for itself.
 */
export const COLD_BELOW = -0.35;
/** Being tended is worth this much on top, scaled by the doctor's quality. */
const IMMUNITY_TENDED = 0.45;

/**
 * Chance per day that an untended wound goes septic. Rolled every tick against
 * a per-tick slice, so the pressure is smooth rather than a cliff at midnight.
 */
const INFECTION_PER_DAY = 0.55;
/** Wounds this shallow do not fester — otherwise every bruise is a coin flip. */
export const WOUND_BELOW = 0.55;

/** How long shaking something off keeps the next thing off. See `afflict`. */
const CONVALESCENCE = TICKS_PER_DAY;

/** Chance a settler who eats uncooked food spends the next day regretting it. */
export const RAW_FOOD_POISON_CHANCE = 0.11;

/**
 * Where the air stops being pleasant and starts being a problem, and where it
 * gets as bad as this game lets it get. A clear night outdoors is around 2°C —
 * unpleasant, not dangerous. A storm night, or standing in your own cold store,
 * is where the number bites.
 */
const COLD_EDGE = 8;
const COLD_WORST = -5;
const HOT_EDGE = 28;
const HOT_WORST = 38;
/**
 * Bodies have thermal mass. Comfort chases the air rather than snapping to it,
 * so a settler crossing the yard to fetch a log does not briefly count as
 * hypothermic — about ten game-minutes to close the gap.
 */
const COMFORT_ADAPT = 1 / 200;
/**
 * How cold you have to have been before the cold is what makes you ill, and the
 * chance per day of catching the flu while as cold as this game gets.
 *
 * Half a point of chill is about 1.5°C of air — a storm night in the open, or
 * standing in your own cold store. An unheated cabin holds around 11°C on the
 * worst night the weather has, which scores zero: the walls alone are enough to
 * keep everybody out of this roll, and that is deliberate. It costs a night in
 * the rain, not a night indoors. A settler caught outside for a whole storm
 * night runs about a one-in-four chance, and the flu is survivable in a bed.
 */
const COLD_ILL_AT = 0.5;
const FLU_FROM_COLD_PER_DAY = 1.2;

/**
 * The same air, through what they are wearing.
 *
 * Insulation only ever moves the number *towards* comfortable and never past it:
 * a parka does not make a freezing night pleasant, it makes it survivable, and a
 * settler in one standing in a warm room is exactly as comfortable as a settler
 * in shirtsleeves. The clamp is the whole of that, and it is also what stops the
 * coat from quietly reversing the sign and reading as "too hot" in the mood
 * breakdown.
 *
 * A negative insulation — plate, which is cold metal — is the same rule read
 * backwards: it deepens a cold day and it makes a hot one worse.
 */
export function dressedFor(pawn: Pawn, raw: number): number {
  const ins = insulationOf(pawn);
  if (ins === 0 || raw === 0) return raw;
  return raw < 0 ? Math.min(0, raw + ins) : Math.max(0, raw - ins);
}

/** −1 dangerously cold, 0 comfortable, +1 dangerously hot. */
export function comfortAt(temp: number): number {
  if (temp < COLD_EDGE) return -Math.min(1, (COLD_EDGE - temp) / (COLD_EDGE - COLD_WORST));
  if (temp > HOT_EDGE) return Math.min(1, (temp - HOT_EDGE) / (HOT_WORST - HOT_EDGE));
  return 0;
}

/**
 * How the air where somebody is standing feels, and what it costs them.
 *
 * Deliberately no HP damage: the failure mode this colony has is being cold and
 * miserable and then catching something in a bed nobody warmed, not freezing
 * solid in the yard. Cold takes mood (via `computeMood`), it slows the immune
 * system down (via `immunityScale`), and past the halfway mark it starts
 * handing out the flu. That is the whole cost.
 */
function tickComfort(world: World, pawn: Pawn, rng: Rng): void {
  const target = dressedFor(pawn, comfortAt(cellTemp(world, Math.round(pawn.x), Math.round(pawn.y))));
  const now = pawn.comfort ?? target;
  pawn.comfort = now + (target - now) * COMFORT_ADAPT;

  const chill = -pawn.comfort;
  if (chill <= COLD_ILL_AT || hasAilment(pawn, 'flu')) return;
  const bite = (chill - COLD_ILL_AT) / (1 - COLD_ILL_AT);
  if (rng.chance(perTick(FLU_FROM_COLD_PER_DAY * bite))) afflict(world, pawn, 'flu');
}

/**
 * Roll for a bad turnip. Hashed from who ate and when rather than drawn from a
 * stream, because the eating happens inside the job pass — which is handed the
 * combat rng, and a settler chewing a carrot must not shift where the next
 * bullet lands.
 */
export function maybeFoodPoisoning(world: World, pawn: Pawn): boolean {
  let h = (Math.imul(pawn.id, 0x9e3779b1) ^ Math.imul(world.tick, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0;
  if ((h >>> 8) / 0x1000000 >= RAW_FOOD_POISON_CHANCE) return false;
  return afflict(world, pawn, 'foodPoisoning');
}

export function ailmentsOf(pawn: Pawn): Ailment[] {
  return pawn.ailments ?? [];
}

/** The one that matters: highest severity, ties broken by kind for determinism. */
export function worstAilment(pawn: Pawn): Ailment | null {
  let worst: Ailment | null = null;
  for (const a of ailmentsOf(pawn)) {
    if (!worst || a.severity > worst.severity) worst = a;
  }
  return worst;
}

export function hasAilment(pawn: Pawn, kind: AilmentKind): boolean {
  return ailmentsOf(pawn).some((a) => a.kind === kind);
}

/** True when a settler should be in bed rather than at work. */
export function needsBedRest(pawn: Pawn): boolean {
  const worst = worstAilment(pawn);
  return worst !== null && worst.severity >= REST_AT;
}

/**
 * Give somebody an ailment. Returns false if they already have it — two
 * infections at once is just one infection with a worse number.
 */
export function afflict(world: World, pawn: Pawn, kind: AilmentKind, announce = true): boolean {
  if (pawn.dead || hasAilment(pawn, kind)) return false;
  if (pawn.faction !== 'colony' && pawn.faction !== 'prisoner') return false;
  // Just got over something. Without this the wound that caused the infection is
  // still an open wound the tick after the infection clears, so the same roll
  // comes up again immediately — measured at forty ticks between "has shaken off
  // an infection" and "has come down with an infection", for the same settler,
  // twice. Read as a bug by anybody watching the log, and it is one: it makes
  // recovery meaningless. A day of convalescence is what the immunity they just
  // built is worth.
  if (world.tick < (pawn.wellUntil ?? 0)) return false;
  if (!pawn.ailments) pawn.ailments = [];
  pawn.ailments.push({ kind, severity: 0.05, immunity: 0, tendedUntil: 0, tendQuality: 0 });
  if (announce) msg(world, `${pawn.name} has come down with ${AILMENTS[kind].label}.`, 'bad');
  return true;
}

/** Clear one ailment. Used by treatment that cures outright and by tests. */
export function cure(pawn: Pawn, kind: AilmentKind): void {
  if (!pawn.ailments) return;
  pawn.ailments = pawn.ailments.filter((a) => a.kind !== kind);
}

/**
 * Record a round of treatment. `quality` is 0..1 — the doctor's skill and
 * whether they had real medicine in their hands.
 *
 * Tending does not cure anything. It buys time: severity climbs at a third of
 * its usual rate while the dressing is fresh, and immunity climbs faster. A
 * doctor who keeps showing up wins the race; one who tends once and wanders off
 * does not.
 */
export function tendAilments(world: World, pawn: Pawn, quality: number): boolean {
  // Stamped on the body, not only on the ailments: a doctor who dresses a plain
  // bullet wound leaves no ailment behind to write on, and that dressing is
  // precisely what stops the wound going septic. Recording it per-ailment alone
  // meant a settler could be bandaged every half day and still catch an
  // infection through the bandage.
  pawn.tendedUntil = world.tick + TEND_TICKS;
  let tended = false;
  for (const a of ailmentsOf(pawn)) {
    a.tendedUntil = world.tick + TEND_TICKS;
    a.tendQuality = Math.max(0, Math.min(1, quality));
    tended = true;
  }
  return tended;
}

/** The bed this pawn is lying in, if any. */
export function bedOf(world: World, pawn: Pawn): Building | null {
  for (const b of world.buildings) {
    if (b.occupant === pawn.id && b.built) return b;
  }
  return null;
}

/** Is this settler doing the one thing that actually helps? */
function immunityScale(world: World, pawn: Pawn): number {
  const bed = pawn.activity === 'sleeping' || pawn.downed ? bedOf(world, pawn) : null;
  let scale = bed ? (bed.kind === 'medbed' ? IMMUNITY_MEDBED : IMMUNITY_IN_BED) : IMMUNITY_ON_FEET;
  // A downed settler on the floor is still off their feet, just not comfortable.
  if (!bed && pawn.downed) scale = IMMUNITY_IN_BED * 0.8;
  // The same exemption the mending rule makes, for the same reason — see the note
  // above the heal in `needs.ts`. A settler on their feet who is starving chose
  // it, or their colony did; a settler on the floor cannot walk to the pantry, and
  // somebody has to carry a meal out to them. When *everybody* is on the floor
  // there is nobody to carry it, so food falls to zero and stays there, and the
  // penalty stops being a consequence and becomes a second clock running against a
  // colony that already has no way to touch it. Untended and starving, immunity
  // climbed at 0.34 a day against a septic wound's 0.62: seed 20 healed both
  // survivors from 2% to 39% over two days, never got either off the floor, and
  // buried them at dawn on the third — a timer with no decision in it, which is
  // the exact shape the heal rule was fixed for. Exempt, it is 0.76 against 0.62:
  // they beat the fever by a hair on the second day and get up on hit points.
  // Still ugly, still lost if the wolves come back first, but lost to something.
  if (pawn.needs.food < HUNGRY_BELOW && !pawn.downed) scale *= IMMUNITY_STARVING;
  // A cold bed is barely better than no bed: this is what makes a heater a
  // medical building as much as a comfort one.
  if ((pawn.comfort ?? 0) < COLD_BELOW) scale *= IMMUNITY_COLD;
  return scale;
}

function tickAilment(world: World, pawn: Pawn, a: Ailment): 'running' | 'cured' | 'killed' {
  const def = AILMENTS[a.kind];
  const tended = world.tick < a.tendedUntil;
  const severityRate = tended ? TENDED_SEVERITY + (1 - TENDED_SEVERITY) * (1 - a.tendQuality) * 0.6 : 1;
  a.severity = Math.min(def.maxSeverity, a.severity + perTick(def.severityPerDay) * severityRate);

  let gain = immunityScale(world, pawn);
  if (tended) gain += IMMUNITY_TENDED * a.tendQuality;
  a.immunity += perTick(def.immunityPerDay) * gain;

  if (a.immunity >= 1) return 'cured';
  if (a.severity >= 1) return 'killed';
  return 'running';
}

/**
 * One pass over everybody who can get ill.
 *
 * Ordered after the fighting so a wound taken this tick is already on the books,
 * and before the settler loop so somebody who has just taken a turn for the
 * worse goes to bed on this tick rather than the next one.
 */
export function tickHealth(world: World, rng: Rng): void {
  for (const pawn of world.pawns) {
    if (pawn.dead) continue;
    if (pawn.faction !== 'colony' && pawn.faction !== 'prisoner') continue;

    tickComfort(world, pawn, rng);

    // An open wound nobody has washed. The roll is per tick so the risk scales
    // with how long they are left lying there, which is the lever the player
    // actually has: get the stretcher out.
    if (pawn.hp < pawn.maxHp * WOUND_BELOW && !hasAilment(pawn, 'infection')) {
      const dressed = world.tick < (pawn.tendedUntil ?? 0);
      if (!dressed && rng.chance(perTick(INFECTION_PER_DAY))) {
        afflict(world, pawn, 'infection');
      }
    }

    const list = pawn.ailments;
    if (!list || list.length === 0) continue;

    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i]!;
      const outcome = tickAilment(world, pawn, a);
      nudgeMood(pawn, -perTick(AILMENTS[a.kind].moodPerDay) * (0.4 + a.severity));

      if (outcome === 'cured') {
        list.splice(i, 1);
        pawn.wellUntil = world.tick + CONVALESCENCE;
        msg(world, `${pawn.name} has shaken off ${AILMENTS[a.kind].label}.`, 'good');
        continue;
      }
      if (outcome === 'killed') {
        list.splice(i, 1);
        killByIllness(world, pawn, a.kind);
        break;
      }
      // Too ill to stand. Downing rather than killing outright is the point of
      // the threshold: it hands the colony a last, loud chance to do something.
      // Getting back up is the combat pass's job — it already owns that decision
      // for the wounded, and two systems standing the same body up would fight.
      if (a.severity >= DOWN_AT && !pawn.downed) {
        pawn.downed = true;
        pawn.activity = 'downed';
        if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
        pawn.path = null;
        msg(world, `${pawn.name} has collapsed — ${AILMENTS[a.kind].label} is winning.`, 'bad', {
          at: pawn,
          headline: true,
        });
      }
    }
  }
}

/**
 * Read by the combat pass before it stands a downed body back up, and by the
 * doctor before they declare somebody patched. Healed skin is not the same as a
 * broken fever.
 */
export function tooIllToStand(pawn: Pawn): boolean {
  return ailmentsOf(pawn).some((a) => a.severity >= DOWN_AT);
}

function killByIllness(world: World, pawn: Pawn, kind: AilmentKind): void {
  pawn.hp = 0;
  pawn.dead = true;
  pawn.downed = false;
  pawn.activity = 'dead';
  if (pawn.jobId !== null) cancelJob(world, pawn.jobId);
  pawn.path = null;
  msg(world, `${pawn.name} died of ${AILMENTS[kind].label}.`, 'bad', {
    at: pawn,
    headline: true,
  });
  if (pawn.faction === 'colony') {
    world.stats.colonistsLost++;
    // Same two lines as a death in the yard (`combat.ts`): the fact, then who it
    // was. An illness kills slowly enough that the player has usually been
    // watching this one for days, which is exactly when it lands hardest.
    const eulogy = eulogyFor(world, pawn);
    if (eulogy) msg(world, eulogy, 'bad');
    grieve(world, pawn);
  }
}
