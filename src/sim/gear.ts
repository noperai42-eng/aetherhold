/**
 * What a settler wears, and what they carry to work with.
 *
 * For a long time the only thing a colonist could own was a rifle. Everything
 * else the player built went into the ground or onto a wall — which meant that
 * twenty days in, the six people you had spent twenty days caring about were
 * mechanically identical to the six who walked off the pod, give or take a skill
 * number. A colony got richer; the colonists never did.
 *
 * So there are two slots, and only two:
 *
 * - **Apparel** is the torso. Armour against what the raiders bring, or
 *   insulation against what the weather brings, and never both at once.
 * - **Gear** is the hands. A toolbelt or a doctor's bag — the quality-of-life
 *   half, which changes what a settler is *good at* rather than what they can
 *   survive.
 *
 * ## One slot each, which is the whole design
 *
 * A settler in a parka is not wearing plate. That is deliberate and it is the
 * only reason any of this is a decision: with four slots the answer is always
 * "wear everything", and the crafting queue becomes a checklist. With one, the
 * colony has to choose who is the one in armour and who is the one who can stand
 * outside in a storm, and those are different people on purpose.
 *
 * The numbers are tuned so no piece is strictly better than another:
 *
 * | | armour | insulation | work | treatment |
 * |---|---|---|---|---|
 * | jerkin  | 0.15 | 0.20 | — | — |
 * | parka   | 0.05 | 0.85 | — | — |
 * | plate   | 0.40 | −0.15 | ×0.92 | — |
 * | toolbelt | — | — | ×1.15 | — |
 * | medkit  | — | — | — | ×1.4 |
 *
 * Plate is the clearest of these: it stops nearly half of everything and it is
 * cold, heavy and slow. A colony that puts its whole workforce in it will hold
 * the wall and starve behind it.
 *
 * ## Everything reads through here
 *
 * `armourOf`, `insulationOf`, `gearWorkScale` and `gearTreatmentScale` are the
 * entire public surface, and each has exactly one caller — `combat.damagePawn`,
 * `health.tickComfort`, `jobs.workRate` and the doctor's arm of `jobs`. Nothing
 * else in the sim knows what a jerkin is. That is what stops "how much does plate
 * stop" from ending up written down in four files that drift apart, and it is why
 * both fields are optional and always read through a function: a save from before
 * any of this existed answers 0 to all four questions without a migration.
 */

import type { ApparelKind, EquipKind, GearKind, Pawn } from './types';

export interface EquipDef {
  /** Lower case, for a sentence. The card capitalises. */
  label: string;
  /** Which slot it occupies. */
  slot: 'apparel' | 'gear';
  /** Fraction of incoming damage stopped. 0..1, and never near 1. */
  armour?: number;
  /**
   * Comfort points of insulation against cold, and (negative) how much worse it
   * makes a hot day. In the same units as `pawn.comfort`, where −1 is as cold as
   * this game gets — so a parka at 0.85 is most of a winter night.
   */
  insulation?: number;
  /** Multiplier on how fast they work at everything. */
  work?: number;
  /** Multiplier on how much one treatment heals. */
  treatment?: number;
}

export const EQUIP: Record<EquipKind, EquipDef> = {
  /**
   * The first thing a colony makes out of hide, and the one everybody can wear.
   *
   * Modest at both jobs on purpose: it is the piece you put on the four settlers
   * you are not making a decision about, so that the decisions are plate and
   * parka.
   */
  jerkin: { label: 'leather jerkin', slot: 'apparel', armour: 0.15, insulation: 0.2 },
  /**
   * The answer to the `cold` line on a settler's mood card.
   *
   * Sized against `comfortAt`: 0.85 turns the worst night this weather has into
   * something survivable in the open, which is what makes a parka the difference
   * between a colony that can work a winter and one that sits indoors through it.
   * It stops almost nothing — a settler in a parka meeting a raider is a settler
   * in a coat.
   */
  parka: { label: 'fur parka', slot: 'apparel', armour: 0.05, insulation: 0.85 },
  /**
   * Late, expensive, and the only real armour in the game.
   *
   * Forty per cent off every bullet, club and mandible, paid for in steel, in
   * warmth and in an eight per cent tax on everything that settler does for the
   * rest of their life. It is the piece you make two of.
   */
  plate: { label: 'steel plate', slot: 'apparel', armour: 0.4, insulation: -0.15, work: 0.92 },
  /**
   * Quality of life, literally: the same colony, fifteen per cent more of it.
   *
   * Cheap, early, and it stacks with nothing — which is the point of putting it
   * in the *other* slot from the armour. A colony can be both well dressed and
   * well equipped; it just has to make twice as much.
   */
  toolbelt: { label: 'toolbelt', slot: 'gear', work: 1.15 },
  /**
   * A bag with the right things in it. Multiplies the doctor, not the medicine —
   * so it is worth most in the hands of the colony's best, which is the opposite
   * of how the medicine shelf works and gives a good doctor something to want.
   */
  medkit: { label: "doctor's bag", slot: 'gear', treatment: 1.4 },
};

/** Display order: apparel by how much of it a colony makes, then the two bags. */
export const EQUIP_ORDER: EquipKind[] = ['jerkin', 'parka', 'plate', 'toolbelt', 'medkit'];

/** What they are wearing, or null. Safe on a save written before apparel existed. */
export function apparelOf(pawn: Pawn): ApparelKind | null {
  return pawn.apparel ?? null;
}

/** What they are carrying, or null. Same contract. */
export function gearOf(pawn: Pawn): GearKind | null {
  return pawn.gear ?? null;
}

function apparelDef(pawn: Pawn): EquipDef | null {
  const kind = apparelOf(pawn);
  return kind ? EQUIP[kind] : null;
}

/**
 * Fraction of incoming damage this settler's clothes stop.
 *
 * Deliberately a fraction rather than flat points off. Flat armour is the classic
 * way to make a game unbalanceable at both ends at once: subtract 4 from every
 * hit and a club (5) becomes a rounding error while a raid volley (14) barely
 * notices. A fraction is worth the same proportion of a bad day as a good one.
 */
export function armourOf(pawn: Pawn): number {
  return apparelDef(pawn)?.armour ?? 0;
}

/**
 * Comfort points of protection from the cold — positive helps in a freeze and
 * costs the same amount in a heatwave, because a coat does both.
 */
export function insulationOf(pawn: Pawn): number {
  return apparelDef(pawn)?.insulation ?? 0;
}

/** Multiplier on this settler's work rate, from both slots. */
export function gearWorkScale(pawn: Pawn): number {
  const gear = gearOf(pawn);
  return (apparelDef(pawn)?.work ?? 1) * (gear ? (EQUIP[gear].work ?? 1) : 1);
}

/** Multiplier on how much one of this settler's treatments heals. */
export function gearTreatmentScale(pawn: Pawn): number {
  const gear = gearOf(pawn);
  return gear ? (EQUIP[gear].treatment ?? 1) : 1;
}

/**
 * Put it on, and say what came off.
 *
 * Returns the piece that was displaced, if there was one, so the caller can tell
 * the player — a settler quietly binning the plate they spent forty steel on
 * because they got round to making a coat is exactly the sort of thing a colony
 * sim should say out loud rather than leave in a number somewhere.
 */
export function equip(pawn: Pawn, kind: EquipKind): EquipKind | null {
  const def = EQUIP[kind];
  if (def.slot === 'apparel') {
    const old = pawn.apparel ?? null;
    pawn.apparel = kind as ApparelKind;
    return old;
  }
  const old = pawn.gear ?? null;
  pawn.gear = kind as GearKind;
  return old;
}

/**
 * Which of the two lines this settler is for.
 *
 * The one who carries the rifle is the one who wears the plate; everybody else
 * is the one who has to stand outside in a storm. That is the sentence at the
 * top of this file, and this is where it is actually decided.
 *
 * A rifle rather than a skill number because it has to be *stable*: `isUpgrade`
 * is asked once a second for the life of the colony, and a signal that wobbles
 * turns the bench into a loop — a settler who crosses shooting 4 and back makes
 * a parka, a plate, a parka, forever, twenty-eight hides at a time. A rifle is
 * permanent, so the answer changes at most once in a settler's life, on the day
 * they are handed one, and one swap is exactly what should happen then.
 */
function wantsArmour(pawn: Pawn): boolean {
  return pawn.weapon === 'rifle';
}

/** The bag that suits them: the colony's doctors want the bag, everyone else the belt. */
function wantedGear(pawn: Pawn): GearKind {
  const doctor = pawn.priorities.doctor > 0 && (pawn.skills.medicine ?? 0) >= 4;
  return doctor ? 'medkit' : 'toolbelt';
}

/**
 * Is this piece an upgrade on what they have already got?
 *
 * The work board's question, and the whole of what stops the bench from looping.
 * Without it a settler with a parka makes a jerkin, then makes a parka again,
 * forever, because "does the colony want apparel" is always yes for somebody.
 *
 * Ranked along the settler's own line rather than by an absolute best. Ranking
 * everybody by armour reads as the safe choice and quietly kills half the tree:
 * a jerkin is cheap and early and stops more than a parka, so once the colony
 * has hides nobody ever wants a coat again, and Furriery unlocks a garment that
 * is never made. Along a line the order is total and one-way — jerkin then
 * plate for the riflemen, jerkin then parka for everyone else — so the bench
 * still cannot loop, and both halves of the tree get worn.
 */
export function isUpgrade(pawn: Pawn, kind: EquipKind): boolean {
  const def = EQUIP[kind];
  if (def.slot === 'apparel') {
    const worn = apparelDef(pawn);
    if (!worn) return true;
    const axis = (d: EquipDef) => (wantsArmour(pawn) ? (d.armour ?? 0) : (d.insulation ?? 0));
    return axis(def) > axis(worn);
  }
  return gearOf(pawn) !== wantedGear(pawn);
}
