/**
 * `escapeHtml` guards every string sink in this file except one:
 * `HudChrome.syncFps` (the first-person panel) built its markup by
 * interpolating `target.verb`, `p.name`, `p.weapon` and the carried/job
 * label straight into `innerHTML`. All four of those trace back to a
 * settler's name — `p.name` directly, `target.verb` via `Tend ${p.name}`
 * on a downed ally (`sim/interact.ts`) — and a name is not the player's to
 * trust: it arrives from a save, and `importColony` (`sim/transfer.ts`)
 * will deserialize a pasted colony code with no validation. A pawn named
 * `<img src=x onerror=…>` ran script on the origin every saved colony
 * lives on.
 *
 * There is no jsdom in this suite (see `tests/touch.test.ts`'s `FakeEl` for
 * the same reason), so the tiny fragment parser below is the DOM that gets
 * faked here — just enough to ask the two questions that matter: what text
 * a browser would show, and whether one tag ended up nested inside another
 * with the same name.
 */

import { describe, expect, it } from 'vitest';

import { escapeHtml, selfPanelHtml } from '../src/client/ui/hud';
import { createWorld } from '../src/sim/worldgen';
import { livingColonists } from '../src/sim/world';

// ------------------------------------------------------- the fragment parser

interface Frag {
  tag: string;
  kids: (Frag | string)[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Parses the simple always-closed markup this file emits — no attributes read, no self-closing tags. */
function parseFragment(html: string): Frag {
  const root: Frag = { tag: '#root', kids: [] };
  const stack: Frag[] = [root];
  for (const tok of html.match(/<\/?[a-zA-Z][^>]*>|[^<]+/g) ?? []) {
    if (tok[0] !== '<') {
      stack[stack.length - 1]!.kids.push(decodeEntities(tok));
    } else if (tok.startsWith('</')) {
      if (stack.length > 1) stack.pop();
    } else {
      const name = /^<([a-zA-Z0-9]+)/.exec(tok)![1]!;
      const node: Frag = { tag: name, kids: [] };
      stack[stack.length - 1]!.kids.push(node);
      stack.push(node);
    }
  }
  return root;
}

function textOf(f: Frag | string): string {
  return typeof f === 'string' ? f : f.kids.map(textOf).join('');
}

function contains(node: Frag, tag: string): boolean {
  return node.kids.some((k) => typeof k !== 'string' && (k.tag === tag || contains(k, tag)));
}

/** `'outer inner'`-style descendant selectors only — the one shape used below. */
function query(f: Frag, selector: string): Frag | null {
  const [outer, inner] = selector.trim().split(/\s+/);
  const find = (node: Frag): Frag | null => {
    if (node.tag === outer && inner && contains(node, inner)) return node;
    for (const k of node.kids) {
      if (typeof k !== 'string') {
        const hit = find(k);
        if (hit) return hit;
      }
    }
    return null;
  };
  return find(f);
}

// ------------------------------------------------------------- escapeHtml

describe('escapeHtml', () => {
  it('replaces each of the four HTML-significant characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
  });

  // Deliberately not escaped — see the note beside `escapeHtml` in `hud.ts`.
  // Every call site in this file puts its argument in a text node or a
  // double-quoted attribute, where an apostrophe is inert, and escaping it
  // would re-encode strings this file already ships raw (`EQUIP['medkit']`'s
  // "doctor's bag", pinned character-for-character by the frozen
  // `tests/kit-card.test.ts`).
  it('leaves an apostrophe alone', () => {
    expect(escapeHtml("doctor's bag")).toBe("doctor's bag");
  });

  it('leaves a string with nothing to escape unchanged', () => {
    expect(escapeHtml('Corwin Verrow')).toBe('Corwin Verrow');
    expect(escapeHtml('')).toBe('');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
});

// --------------------------------------------------------- selfPanelHtml

describe('selfPanelHtml', () => {
  it('renders a pawn named with markup as text, not as a nested element', () => {
    const world = createWorld(7);
    const p = livingColonists(world)[0]!;
    p.name = '<b>x</b>';

    const frag = parseFragment(selfPanelHtml(world, p));

    // Shows as the literal the player typed...
    expect(textOf(frag)).toContain('<b>x</b>');
    // ...never as a second <b> nested inside the one the template already wraps the name in.
    expect(query(frag, 'b b')).toBeNull();
  });

  it('changes nothing about an ordinary pawn — same rows, same order', () => {
    const world = createWorld(7);
    const p = livingColonists(world)[0]!;
    p.name = 'Corwin Verrow';
    p.weapon = 'none';
    p.drafted = false;

    const html = selfPanelHtml(world, p);

    expect(html).toContain('<div class="who"><b>Corwin Verrow</b><span class="wep">none</span></div>');
    expect(html).toContain('class="bar hp"');
    expect(html).toContain('class="bar food"');
    expect(html).toContain('class="bar rest"');
    expect(html).toContain('class="bar rec"');
  });
});
