/**
 * The ending card's roll, turned from a record into rows.
 *
 * `EndingRecord.manifest` is deliberately complete — every skill above zero,
 * every trait, on everybody the colony still had a body for. A card is not
 * complete; a card is what a person reads in the ten seconds after their ship
 * leaves. This is the half of that decision the client owes, and it lives in its
 * own module for the reason `overlays.ts` does: `hud.ts` cannot be loaded
 * outside a browser, so anything asserted only in there is asserted in a comment
 * rather than proved.
 *
 * It returns rows and not HTML. The tags, the escaping and the classes belong
 * with the rest of the HUD's markup; what belongs here is the part with an
 * opinion in it — who is grouped with whom, what each row is allowed to say, and
 * in what order.
 */

import { EQUIP } from '../sim/gear';
import { TRAITS } from '../sim/traits';
import type { EndingRecord, ManifestEntry } from '../sim/types';

/**
 * How many skills a row gets.
 *
 * Three, because a settler with eight of them is a settler nobody reads. The
 * record keeps all of them for whoever wants them later; the card is a list of
 * people, and three numbers is where a name stops being a name and starts being
 * a table row.
 */
const TRADES_SHOWN = 3;

/** Wounds worth a word. Below the first, a settler walked off whole enough. */
const HURT_NOTED = 0.05;
const HURT_BAD = 0.5;

/** One person, as one line of the card. */
export interface RollLine {
  name: string;
  /** Their best few, already written out: `shooting 8 · cooking 5`. May be empty. */
  trade: string;
  /** Traits, kit, partner, wounds — everything else worth saying. May be empty. */
  notes: string;
}

/** One heading and the people under it. */
export interface RollSection {
  title: string;
  lines: RollLine[];
}

/**
 * The roll, grouped and written out. Empty when there is nothing honest to show.
 *
 * A record written before the manifest existed has a tally and no roll, and the
 * answer to that is no section at all rather than an empty list — an empty list
 * under a heading reads as *the colony was nobody*, which is the one thing it
 * definitely was not.
 */
export function manifestSections(rec: EndingRecord): RollSection[] {
  const roll = rec.manifest;
  if (!roll || roll.length === 0) return [];
  const out: RollSection[] = [];
  const gone = roll.filter((m) => m.fate !== 'lost');
  const lost = roll.filter((m) => m.fate === 'lost');
  // Everybody on the first list has the same fate, because a manifest is written
  // by one ending — so the heading can carry the difference between sailing and
  // staying, and the rows do not have to repeat it nine times.
  if (gone.length > 0) {
    out.push({ title: gone[0].fate === 'held' ? 'Who held it' : 'Who left', lines: gone.map(line) });
  }
  // Second, always. The dead are the reason the record keeps them at all: a
  // manifest whose only names are the survivors' is a list of who was lucky.
  if (lost.length > 0) out.push({ title: 'Who stayed in the valley', lines: lost.map(line) });
  return out;
}

function line(m: ManifestEntry): RollLine {
  return {
    name: m.name,
    trade: m.skills
      .slice(0, TRADES_SHOWN)
      .map((s) => `${s.skill} ${s.level}`)
      .join(' · '),
    notes: notes(m).join(' · '),
  };
}

/**
 * Everything about somebody that is not a number.
 *
 * Traits first because they are the part a player will recognise the settler by,
 * then what they had on them, then who they had. Wounds last and only on the
 * living: a corpse is at full damage by arithmetic, and *badly hurt* under a
 * headstone is a card telling the player something they worked out already.
 */
function notes(m: ManifestEntry): string[] {
  const out = m.traits.filter((t) => TRAITS[t]).map((t) => TRAITS[t].label);
  if (m.weapon !== 'none') out.push(m.weapon);
  if (m.apparel) out.push(EQUIP[m.apparel].label);
  if (m.gear) out.push(EQUIP[m.gear].label);
  if (m.partner) out.push(`with ${m.partner}`);
  if (m.fate !== 'lost' && m.hurt >= HURT_BAD) out.push('badly hurt');
  else if (m.fate !== 'lost' && m.hurt > HURT_NOTED) out.push('hurt');
  return out;
}
