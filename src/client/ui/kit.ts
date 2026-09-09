/**
 * What one piece of kit would do for one settler.
 *
 * The complaint this answers is that the settler card names the thing and stops.
 * There are five wearable pieces in this game and their entire interest is a set
 * of tradeoffs — plate is the only real armour and charges eight per cent of
 * everything that settler will ever do, for life, plus a cold penalty that makes
 * the wearer worse at the one season the parka exists for — and none of that has
 * ever reached the screen. The player is asked to choose between five items on
 * the strength of their names.
 *
 * Facts only, on the same terms as `cell.ts` and `board.ts`: the words live in
 * `hud.ts`, so an axis comes back as `'insulation'` and a number comes back as a
 * number rather than as a sentence. One vocabulary, in one file.
 *
 * The numbers are asked of the simulation rather than recomputed here, which is
 * the rule the whole card hangs on. A presentation layer that does its own
 * arithmetic is a second implementation of the rules, and the day it disagrees
 * with the first one it is the player who is lied to. So "what would they be at"
 * is answered by putting the piece on a copy of the settler and asking the same
 * four accessors the game asks — `equip` only ever writes two scalar fields, so
 * a shallow copy is a real answer and not an approximation of one.
 */

import {
  EQUIP,
  apparelOf,
  armourOf,
  equip,
  gearOf,
  gearTreatmentScale,
  gearWorkScale,
  insulationOf,
  isUpgrade,
} from '../../sim/gear';
import type { EquipKind, Pawn } from '../../sim/types';

/** The four things a piece of kit can move, in the order the card prints them. */
export type Axis = 'armour' | 'insulation' | 'work' | 'treatment';

export interface AxisDelta {
  axis: Axis;
  /** Where this settler stands now. */
  now: number;
  /** Where they would stand with the piece on. */
  next: number;
  /**
   * True where the axis is a multiplier on a rate (work, treatment) rather than
   * a fraction taken off a hit or comfort points against the weather. The card
   * prints the two differently and must not have to guess which is which.
   */
  scale: boolean;
}

export interface KitFacts {
  kind: EquipKind;
  /** The settler this was read for, by name — pawns carry no pronoun. */
  who: string;
  /** What comes off if this goes on. Null for an empty slot. */
  replaces: EquipKind | null;
  /** Every axis either piece touches, including the ones that get worse. */
  axes: AxisDelta[];
  /**
   * The axis the work board ranks this settler along, and the fact that decides
   * it. This is the choice the game has always made silently on the player's
   * behalf: `isUpgrade` picks one axis with `wantsArmour` and compares one
   * number, and a player who is never told which axis cannot disagree with it.
   */
  line: 'armour' | 'insulation';
  /** Why that line — a rifle in their hands, or the absence of one. */
  armed: boolean;
  /** The bench's own verdict, so the card and the work board cannot drift apart. */
  upgrade: boolean;
}

/** Every axis the two pieces touch between them, in a fixed order. */
const AXES: readonly { axis: Axis; scale: boolean; read: (p: Pawn) => number }[] = [
  { axis: 'armour', scale: false, read: armourOf },
  { axis: 'insulation', scale: false, read: insulationOf },
  { axis: 'work', scale: true, read: gearWorkScale },
  { axis: 'treatment', scale: true, read: gearTreatmentScale },
];

export function kitFacts(pawn: Pawn, kind: EquipKind): KitFacts {
  const def = EQUIP[kind];
  const replaces = def.slot === 'apparel' ? apparelOf(pawn) : gearOf(pawn);

  // A copy, put through the game's own `equip`. See the note at the top of the
  // file: the alternative is arithmetic that can disagree with the simulation.
  const after = { ...pawn } as Pawn;
  equip(after, kind);

  const axes: AxisDelta[] = [];
  for (const a of AXES) {
    const now = a.read(pawn);
    const next = a.read(after);
    // An axis neither piece touches is a row that says nothing. Kept when it
    // moves in either direction — a card that hides what got worse is worse
    // than one that says nothing, because it has taken a side.
    if (now !== next) axes.push({ axis: a.axis, now, next, scale: a.scale });
  }

  const armed = pawn.weapon === 'rifle';
  return {
    kind,
    who: pawn.name,
    replaces,
    axes,
    line: armed ? 'armour' : 'insulation',
    armed,
    upgrade: isUpgrade(pawn, kind),
  };
}

/** One axis a piece touches, and by how much. */
export interface AxisValue {
  axis: Axis;
  value: number;
  scale: boolean;
}

/**
 * What a piece is doing for whoever has it on.
 *
 * Read straight off the definition rather than off the settler, and that is
 * exact rather than a shortcut: there is one apparel slot and one gear slot, so
 * a worn piece's numbers *are* the settler's numbers on the axes it touches —
 * `armourOf` is `EQUIP[worn].armour` and nothing else. The one axis two pieces
 * can both reach is work, where plate and a toolbelt multiply; each line still
 * says what its own piece is worth, which is the question a line under a name
 * is being asked.
 */
export function kitEffect(kind: EquipKind): AxisValue[] {
  const def = EQUIP[kind];
  const out: AxisValue[] = [];
  if (def.armour !== undefined) out.push({ axis: 'armour', value: def.armour, scale: false });
  if (def.insulation !== undefined) out.push({ axis: 'insulation', value: def.insulation, scale: false });
  if (def.work !== undefined) out.push({ axis: 'work', value: def.work, scale: true });
  if (def.treatment !== undefined) out.push({ axis: 'treatment', value: def.treatment, scale: true });
  return out;
}
