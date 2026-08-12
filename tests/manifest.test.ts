/**
 * The roll, as a card says it.
 *
 * `endings.ts` writes the record and `tests/endings.test.ts` holds it honest.
 * This is the other half: the record is deliberately complete — every skill
 * above zero, every trait, everybody the colony had a body for — and a card is
 * what a person reads in the ten seconds after their ship leaves. Everything
 * with an opinion in it lives in `client/manifest.ts` for the reason
 * `client/overlays.ts` does: `hud.ts` cannot be loaded outside a browser, so a
 * rule about what a card is allowed to say would otherwise only be asserted in
 * a comment.
 *
 * The failures this file is aimed at are quiet ones. A roll with the dead
 * silently dropped still renders; a roll with the headings the wrong way round
 * still renders; a save from before the manifest existed renders an empty list
 * under a heading, which reads as *the colony was nobody*.
 */

import { describe, expect, it } from 'vitest';

import { manifestSections } from '../src/client/manifest';
import type { EndingRecord, ManifestEntry } from '../src/sim/types';

let nextId = 1;

function person(over: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    id: nextId++,
    name: 'Bren',
    fate: 'left',
    skills: [],
    traits: [],
    weapon: 'none',
    hurt: 0,
    partner: null,
    ...over,
  };
}

function record(manifest?: ManifestEntry[]): EndingRecord {
  return { day: 41, standing: 8, stats: {} as EndingRecord['stats'], manifest };
}

describe('the roll on the ending card', () => {
  it('shows nothing at all for a record that was written without one', () => {
    // A save from the stage between the tally and the manifest. No heading, not
    // an empty list under one — the second reads as a colony with nobody in it.
    expect(manifestSections(record())).toEqual([]);
    expect(manifestSections(record([]))).toEqual([]);
  });

  it('puts the dead in their own list, under the living', () => {
    const out = manifestSections(
      record([
        person({ name: 'Bren', fate: 'left' }),
        person({ name: 'Sarrow', fate: 'lost' }),
        person({ name: 'Idra', fate: 'left' }),
      ]),
    );
    expect(out.map((s) => s.title)).toEqual(['Who left', 'Who stayed in the valley']);
    expect(out[0]!.lines.map((l) => l.name)).toEqual(['Bren', 'Idra']);
    expect(out[1]!.lines.map((l) => l.name)).toEqual(['Sarrow']);
  });

  it('says which kind of ending it was in the heading and not in every row', () => {
    // The whole roll of one ending has one fate, so the difference between
    // sailing and staying belongs at the top rather than nine times down the
    // card.
    const held = manifestSections(record([person({ fate: 'held' })]));
    expect(held.map((s) => s.title)).toEqual(['Who held it']);
    expect(held[0]!.lines[0]!.notes).toBe('');
  });

  it('names the valley list even when nobody walked away from it', () => {
    // A colony that lost everybody cannot land an ending, but a record can be
    // read out of any save, and a roll of nothing but the dead must not come
    // back headed *Who left*.
    const out = manifestSections(record([person({ name: 'Sarrow', fate: 'lost' })]));
    expect(out.map((s) => s.title)).toEqual(['Who stayed in the valley']);
  });

  it('shows the three they were best at and keeps the rest in the record', () => {
    const skills: ManifestEntry['skills'] = [
      { skill: 'shooting', level: 9 },
      { skill: 'medicine', level: 6 },
      { skill: 'cooking', level: 3 },
      { skill: 'mining', level: 2 },
    ];
    const out = manifestSections(record([person({ skills })]));
    // Three, because a settler with eight numbers after their name is a table
    // row and not a person. The fourth is still in the record — this is the
    // card's decision, not the sim's.
    expect(out[0]!.lines[0]!.trade).toBe('shooting 9 · medicine 6 · cooking 3');
    expect(skills).toHaveLength(4);
  });

  it('leaves the line empty for somebody who never picked up a trade', () => {
    // A settler who walked in last week. The honest shape is their name and
    // nothing after it: filling the gap with a judgement the record does not
    // make would be the card inventing something.
    const out = manifestSections(record([person({ skills: [] })]));
    expect(out[0]!.lines[0]!.trade).toBe('');
    expect(out[0]!.lines[0]!.name).toBe('Bren');
  });

  it('reads traits, kit and a partner into one line, in that order', () => {
    const out = manifestSections(
      record([
        person({
          traits: ['tough', 'ironstomach'],
          weapon: 'rifle',
          apparel: 'parka',
          gear: 'toolbelt',
          partner: 'Idra',
        }),
      ]),
    );
    // Traits first because they are what a player recognises the settler by,
    // then what they had on them, then who they had.
    expect(out[0]!.lines[0]!.notes).toBe(
      'Tough · Iron stomach · rifle · fur parka · toolbelt · with Idra',
    );
  });

  it('says nothing about an unarmed settler with nothing on', () => {
    // `weapon: 'none'` is the default state of everybody for the first hour of
    // a game. A row reading `none` on eight settlers is eight rows of noise.
    expect(manifestSections(record([person()]))[0]!.lines[0]!.notes).toBe('');
  });

  it('notes the wounds of the living and says nothing about the dead', () => {
    const out = manifestSections(
      record([
        person({ name: 'Whole', hurt: 0 }),
        person({ name: 'Scratched', hurt: 0.04 }),
        person({ name: 'Hurt', hurt: 0.3 }),
        person({ name: 'Carried', hurt: 0.8 }),
        person({ name: 'Sarrow', fate: 'lost', hurt: 1 }),
      ]),
    );
    expect(out[0]!.lines.map((l) => l.notes)).toEqual(['', '', 'hurt', 'badly hurt']);
    // The dead are at full damage by arithmetic rather than by a special case,
    // and *badly hurt* under a headstone is a card telling the player something
    // they worked out already.
    expect(out[1]!.lines[0]!.notes).toBe('');
  });

  it('survives a trait the build no longer has', () => {
    // A save is a contract with every version that comes after it. A trait
    // renamed in a later build must cost that settler one word, not the card.
    const out = manifestSections(
      record([person({ traits: ['tough', 'wolfblooded' as ManifestEntry['traits'][number]] })]),
    );
    expect(out[0]!.lines[0]!.notes).toBe('Tough');
  });
});
