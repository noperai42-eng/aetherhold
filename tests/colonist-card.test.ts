import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * The colonist card is built in the browser, and this suite runs in node, so
 * these read the source the way tests/phone-layout.test.ts reads the
 * stylesheet: the guarantee worth holding is that no bar can reach the card
 * without a word beside it, and that is a property of the two files.
 */
const HUD = readFileSync(new URL('../src/client/ui/hud.ts', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/client/ui/style.css', import.meta.url), 'utf8');

/** The `['key', 'Label']` pairs of the NEEDS table, in source order. */
function needs(): Array<[string, string]> {
  const block = HUD.slice(HUD.indexOf('const NEEDS'), HUD.indexOf('class ColonistRow'));
  return [...block.matchAll(/\['(\w+)', '([A-Za-z]+)'\]/g)].map((m) => [m[1]!, m[2]!]);
}

describe('colonist card needs (functional)', () => {
  it('labels every bar the card draws', () => {
    expect(needs().map(([k]) => k)).toEqual(['hp', 'food', 'rest', 'rec', 'mood']);
    for (const [, label] of needs()) expect(label).toMatch(/^[A-Z][a-z]+$/);
  });

  it('has a label for every bar update() fills, and fills every bar it labels', () => {
    // A key added to one side and not the other is a bar with no word or a
    // word with no bar; both are the bug this card just had.
    const filled = [...HUD.matchAll(/this\.bars\.(\w+)!\.style\.width/g)].map((m) => m[1]!);
    expect(filled.sort()).toEqual(needs().map(([k]) => k).sort());
  });

  it('builds each row from the table rather than a second hardcoded list', () => {
    expect(HUD).toMatch(/for \(const \[key, label\] of NEEDS\)/);
    expect(HUD).toMatch(/bars\.append\(el\('span', 'barlabel', \{\}, label\), b\)/);
  });
});

describe('colonist card needs (experience)', () => {
  it('lays the labels in their own column beside the bars', () => {
    const bars = CSS.slice(CSS.indexOf('.bars {'), CSS.indexOf('.bar {'));
    expect(bars).toMatch(/display:\s*grid/);
    expect(bars).toMatch(/grid-template-columns:\s*auto 1fr/);
  });

  it('styles the label so it reads as a caption, not as a second value', () => {
    expect(CSS).toMatch(/\.barlabel \{[^}]*color: var\(--dim\)/s);
  });

  it('keeps the labels out of the queue pips, which are already captioned', () => {
    // pip() deliberately reuses .bar without the label column.
    expect(HUD).toMatch(/el\('div', `bar \$\{kind\} bd-pip`\)/);
  });
});
