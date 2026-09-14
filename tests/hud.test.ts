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

import { escapeHtml, promptHtml, selfPanelHtml } from '../src/client/ui/hud';
import { createWorld } from '../src/sim/worldgen';
import { livingColonists, nextId } from '../src/sim/world';
import type { ItemStack, Pawn, ResourceKind, World } from '../src/sim/types';

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

/**
 * Puts a stack of `kind` in the pawn's hands, the way a haul job would. Built
 * directly rather than through `addItem`, which merges into whatever is already
 * lying on the cell and would hand back a stack of the wrong kind.
 */
function carried(world: World, p: Pawn, kind: ResourceKind, amount: number): ItemStack {
  const stack: ItemStack = {
    id: nextId(world),
    kind,
    amount,
    x: p.x,
    y: p.y,
    carriedBy: p.id,
    reservedBy: null,
  };
  world.items.push(stack);
  p.carryingItemId = stack.id;
  return stack;
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
    p.carryingItemId = null;

    const html = selfPanelHtml(world, p);

    expect(html).toContain('<div class="who"><b>Corwin Verrow</b><span class="wep">none</span></div>');
    expect(html).toContain('class="bar hp"');
    expect(html).toContain('class="bar food"');
    expect(html).toContain('class="bar rest"');
    expect(html).toContain('class="bar rec"');
    // The bottom row too, in full. Leaving it out is how the carrying branch
    // below went unasserted in the first place: five `toContain` calls that
    // all landed above it read as coverage of the whole panel.
    expect(html).toContain(
      '<div class="kv" style="margin-top:5px;color:var(--dim);font-size:11px">idle</div>',
    );
  });

  // --------------------------------------------------- the carrying branch

  it('names what an ordinary pawn is carrying', () => {
    const world = createWorld(7);
    const p = livingColonists(world)[0]!;
    const stack = carried(world, p, 'wood', 12);

    expect(stack.carriedBy).toBe(p.id);
    expect(selfPanelHtml(world, p)).toContain(
      '<div class="kv" style="margin-top:5px;color:var(--dim);font-size:11px">carrying 12 wood</div>',
    );
  });

  it('renders a carried stack whose kind is markup as text, not as an element', () => {
    const world = createWorld(7);
    const p = livingColonists(world)[0]!;
    // `importColony` (`sim/transfer.ts`) deserializes a pasted colony code with
    // no validation, so `kind` is only a `ResourceKind` to TypeScript. At run
    // time it is whatever the save said.
    carried(world, p, '<img src=x onerror=alert(1)>' as ResourceKind, 3);

    const html = selfPanelHtml(world, p);
    const frag = parseFragment(html);

    expect(html).not.toContain('<img');
    expect(contains(frag, 'img')).toBe(false);
    expect(textOf(frag)).toContain('carrying 3 <img src=x onerror=alert(1)>');
  });
});

// ------------------------------------------------------------- promptHtml

describe('promptHtml', () => {
  it('wraps an ordinary verb in the key hint', () => {
    expect(promptHtml('Open the door')).toBe('<kbd>E</kbd>Open the door');
  });

  it('renders a verb carrying a markup-named pawn as text, not as an element', () => {
    // `describeTarget` builds `Tend ${p.name}` for a downed ally
    // (`sim/interact.ts`), so a settler's name reaches the prompt whole.
    const html = promptHtml('Tend <b>x</b>');
    const frag = parseFragment(html);

    expect(html).toBe('<kbd>E</kbd>Tend &lt;b&gt;x&lt;/b&gt;');
    expect(contains(frag, 'b')).toBe(false);
    expect(textOf(frag)).toBe('ETend <b>x</b>');
  });
});
