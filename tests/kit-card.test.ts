import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { kitEffect, kitFacts } from '../src/client/ui/kit';
import { kitPanel, kitRows } from '../src/client/ui/hud';
import { SCENES, sceneByName } from '../src/review/scenes';
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
import type { Pawn } from '../src/sim/types';
import { createWorld } from '../src/sim/worldgen';

/*
 * The card that compares, and the promise it makes.
 *
 * The promise is not that the numbers are pretty. It is that they are the
 * simulation's own: a presentation layer that does its own arithmetic is a
 * second implementation of the rules, and the day the two disagree it is the
 * player who is lied to. So the first suite below re-derives every number the
 * card prints by putting the piece on a real settler with the game's own
 * `equip` and asking the game's own accessors, and asserts the card said that.
 *
 * The second suite is about what a person reads. Its one load-bearing test is
 * that a piece which makes something *worse* says so — steel plate is the whole
 * apparel tree in one item, and a card that showed the forty per cent and not
 * the eight per cent tax would be advertising rather than informing.
 */

/** A settler off a fixture world, fitted as the case under test needs. */
function settler(fit: (p: Pawn) => void): Pawn {
  const p = createWorld(20260729).pawns[0];
  if (!p) throw new Error('fixture world landed no settlers');
  fit(p);
  return p;
}

/** Every state a settler's two slots can be in, which is what the card is read against. */
const FITTINGS: Array<{ what: string; fit: (p: Pawn) => void }> = [
  { what: 'empty-handed', fit: () => {} },
  { what: 'in a jerkin', fit: (p) => void equip(p, 'jerkin') },
  { what: 'in a parka', fit: (p) => void equip(p, 'parka') },
  { what: 'in plate', fit: (p) => void equip(p, 'plate') },
  { what: 'with a toolbelt', fit: (p) => void equip(p, 'toolbelt') },
  { what: 'with a bag', fit: (p) => void equip(p, 'medkit') },
  {
    what: 'a rifleman in a jerkin',
    fit: (p) => {
      p.weapon = 'rifle';
      equip(p, 'jerkin');
    },
  },
];

describe('kit card facts (functional)', () => {
  it('never prints a number the simulation would not', () => {
    // The whole contract. Every axis, every fitting, every piece: the card's
    // "after" has to equal what the settler actually becomes.
    for (const { fit } of FITTINGS) {
      for (const kind of EQUIP_ORDER) {
        const before = settler(fit);
        const after = settler(fit);
        equip(after, kind);
        const facts = kitFacts(before, kind);
        const truth: Record<string, [number, number]> = {
          armour: [armourOf(before), armourOf(after)],
          insulation: [insulationOf(before), insulationOf(after)],
          work: [gearWorkScale(before), gearWorkScale(after)],
          treatment: [gearTreatmentScale(before), gearTreatmentScale(after)],
        };
        for (const a of facts.axes) {
          expect([a.now, a.next], `${kind} ${a.axis}`).toEqual(truth[a.axis]);
        }
      }
    }
  });

  it('lists every axis that moves and no axis that does not', () => {
    for (const { fit } of FITTINGS) {
      for (const kind of EQUIP_ORDER) {
        const before = settler(fit);
        const after = settler(fit);
        equip(after, kind);
        const moved = (
          [
            ['armour', armourOf],
            ['insulation', insulationOf],
            ['work', gearWorkScale],
            ['treatment', gearTreatmentScale],
          ] as const
        )
          .filter(([, read]) => read(before) !== read(after))
          .map(([axis]) => axis);
        expect(kitFacts(before, kind).axes.map((a) => a.axis).sort()).toEqual([...moved].sort());
      }
    }
  });

  it('reads the settler without changing them', () => {
    // The card is drawn on hover. If asking what a piece would do put it on,
    // moving the mouse would dress the colony.
    for (const kind of EQUIP_ORDER) {
      const p = settler((q) => void equip(q, 'jerkin'));
      kitFacts(p, kind);
      expect(p.apparel).toBe('jerkin');
      expect(p.gear).toBeUndefined();
    }
  });

  it('gives the same verdict as the bench, for every settler and every piece', () => {
    // Two answers to "is this an upgrade" is the drift this card exists to
    // prevent, so it does not have its own answer.
    for (const { fit } of FITTINGS) {
      for (const kind of EQUIP_ORDER) {
        const p = settler(fit);
        expect(kitFacts(p, kind).upgrade).toBe(isUpgrade(p, kind));
      }
    }
  });

  it('names the axis the bench actually ranked them along', () => {
    const armed = settler((p) => void (p.weapon = 'rifle'));
    const unarmed = settler((p) => void (p.weapon = 'none'));
    expect(kitFacts(armed, 'plate').line).toBe('armour');
    expect(kitFacts(armed, 'plate').armed).toBe(true);
    expect(kitFacts(unarmed, 'plate').line).toBe('insulation');
    expect(kitFacts(unarmed, 'plate').armed).toBe(false);
  });
});

describe('kit card words (experience)', () => {
  const plateOnRifleman = () =>
    kitPanel(
      kitFacts(
        settler((p) => {
          p.weapon = 'rifle';
          equip(p, 'jerkin');
        }),
        'plate',
      ),
    );

  it('shows the cost of the best armour in the game, not only its benefit', () => {
    // The test this card was written for. Plate is +25 points of armour, minus
    // a third of a coat, minus eight per cent of that settler's whole working
    // life. A card that printed the first and not the other two would be the
    // reason nobody understood the apparel tree.
    const html = plateOnRifleman();
    expect(html).toMatch(/armour<\/span><b class="good">15% → 40%/);
    expect(html).toMatch(/work<\/span><b class="bad">100% → 92%/);
    expect(html).toMatch(/warmth<\/span><b>\+0\.20 → −0\.15/);
  });

  it('puts a before and an after on every row, never a bare specification', () => {
    for (const kind of EQUIP_ORDER) {
      const p = settler((q) => void equip(q, 'jerkin'));
      const facts = kitFacts(p, kind);
      const html = kitPanel(facts);
      const arrows = [...html.matchAll(/→/g)].length;
      expect(arrows, kind).toBe(facts.axes.length);
    }
  });

  it('leaves warmth uncoloured, because a coat is not a one-way trade', () => {
    // Insulation helps in a freeze and costs the same in a heatwave. A green
    // arrow on it would be a claim the weather code does not make.
    const html = kitPanel(kitFacts(settler((p) => void equip(p, 'jerkin')), 'parka'));
    expect(html).toMatch(/warmth<\/span><b>/);
  });

  it('says the slot is empty rather than comparing against nothing', () => {
    const html = kitPanel(kitFacts(settler(() => {}), 'toolbelt'));
    expect(html).toMatch(/comes off<\/span><b>nothing/);
  });

  it('says why the bench ranked them that way, on both sides of the rule', () => {
    // The same coat offered to two settlers who differ in one thing, both
    // already in a jerkin — which is what makes the ranking bite at all. An
    // empty slot is an upgrade for anybody, so a settler with nothing on tests
    // nothing about the line they are on.
    const inJerkin = (weapon: Pawn['weapon']) => (p: Pawn) => {
      p.weapon = weapon;
      equip(p, 'jerkin');
    };
    const rifle = kitPanel(kitFacts(settler(inJerkin('rifle')), 'parka'));
    const not = kitPanel(kitFacts(settler(inJerkin('none')), 'parka'));
    expect(rifle).toContain('armour — carries a rifle');
    expect(not).toContain('warmth — no rifle');
    // One coat, two verdicts. This pair is the whole of `wantsArmour` as a
    // player can ever see it, and the refusal is the half that had no way out.
    expect(rifle).toContain('will not make this');
    expect(not).toContain('calls this an upgrade');
  });

  it('escapes the settler name rather than pasting it into the markup', () => {
    const html = kitPanel(kitFacts(settler((p) => void (p.name = '<script>')), 'toolbelt'));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('what a settler has on (experience)', () => {
  it('says what the kit is doing, not only what it is called', () => {
    // The whole complaint. For as long as apparel has existed this block
    // printed two names, and a name is the one thing about a piece of kit the
    // player could already guess.
    const html = kitRows('plate', 'toolbelt');
    expect(html).toContain('steel plate');
    expect(html).toContain('40% armour');
    expect(html).toContain('115% work');
  });

  it('prints the cold plate costs its wearer, with the sign on it', () => {
    // The most surprising number in the table, and the one a player who has
    // just armoured their best shot needs before winter rather than after.
    expect(kitRows('plate', null)).toContain('−0.15 warmth');
    expect(kitRows('parka', null)).toContain('+0.85 warmth');
  });

  it('gives every piece in the game a line that says something', () => {
    for (const kind of EQUIP_ORDER) {
      const slot = kind === 'toolbelt' || kind === 'medkit';
      const html = slot ? kitRows(null, kind) : kitRows(kind, null);
      expect(html, kind).toContain(EQUIP[kind].label);
      // A name row and a caption under it. A piece whose caption came out
      // empty would read as a blank line under a name.
      expect([...html.matchAll(/class="kv"/g)].length, kind).toBe(1);
      expect(html, kind).toMatch(/class="kiteffect">(<i>[^<]+<\/i>)+<\/div>/);
    }
  });

  it('stays silent on a settler with nothing on', () => {
    // A line reading "wearing — nothing" on every settler for the first ten
    // days is ten days of teaching the player to skip this part of the card.
    expect(kitRows(null, null)).toBe('');
  });

  it('never claims a piece touches an axis its definition leaves alone', () => {
    for (const kind of EQUIP_ORDER) {
      const def = EQUIP[kind];
      const axes = kitEffect(kind).map((v) => v.axis);
      expect(axes.includes('armour'), kind).toBe(def.armour !== undefined);
      expect(axes.includes('insulation'), kind).toBe(def.insulation !== undefined);
      expect(axes.includes('work'), kind).toBe(def.work !== undefined);
      expect(axes.includes('treatment'), kind).toBe(def.treatment !== undefined);
    }
  });
});

describe('review scenes (functional)', () => {
  it('registers each name once, in the shape a query string can carry', () => {
    const names = SCENES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n, n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('answers to every name it registers, and to no other', () => {
    // A renamed scene has to fail here rather than 404 quietly in the look loop.
    for (const s of SCENES) expect(sceneByName(s.name)).toBe(s);
    expect(sceneByName('no-such-scene')).toBeNull();
  });

  it('draws something for every registered scene', () => {
    for (const s of SCENES) {
      const html = s.render();
      expect(html.length, s.name).toBeGreaterThan(0);
      expect(html, s.name).toContain('<');
      expect(s.title.length, s.name).toBeGreaterThan(0);
      expect(s.note.length, s.name).toBeGreaterThan(0);
    }
  });

  it('draws the same frame twice, which is what the look loop compares', () => {
    for (const s of SCENES) expect(s.render(), s.name).toBe(s.render());
  });
});

describe('review page (experience)', () => {
  it('keeps the dependency running one way, out of the game and into the room', () => {
    // src/review/ may read the game. Nothing in the game may read src/review/,
    // or the review harness has become part of what ships.
    const game = ['src/client', 'src/sim'];
    const offenders: string[] = [];
    for (const dir of game) {
      const out = readAll(dir);
      for (const [file, text] of out) if (/from '.*review\//.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

/** Every .ts file under a directory, with its text. */
function readAll(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const path = `${d}/${e.name}`;
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith('.ts')) out.push([path, readFileSync(path, 'utf8')]);
    }
  };
  walk(fileURLToPath(new URL(`../${dir}`, import.meta.url)));
  return out;
}
