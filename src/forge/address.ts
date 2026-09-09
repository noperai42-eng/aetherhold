/**
 * A recipe as text, in the two shapes it needs to be text in.
 *
 * The bench without this is a viewer. You can move eleven sliders until a tree
 * looks right, and then the afternoon ends and the only thing that survives it
 * is a memory of a shape. Stage 3 of [FORGING.md](../../FORGING.md) is the two
 * small things that close the loop:
 *
 * - **The address.** Every field round-trips through the query string, so a
 *   frame has a URL and a round note can link the exact thing it is arguing
 *   about rather than describing it. Every field, including the ones still at
 *   their default — a shorter URL that omits them would silently change meaning
 *   on the afternoon somebody moves a constant in `decor.ts`, and a link in a
 *   round note that quietly shows a different rock than it did when it was
 *   written is worse than no link.
 * - **The paste.** The whole recipe, including the lathe profiles that are not
 *   on any slider, in a block you copy back into `decor.ts` or `buildings.ts`.
 *
 * The block is real JSON and its keys are quoted for that reason: a test can
 * parse it back and prove that what the page offers you is what the page is
 * drawing, which is the only way the done-criterion — *the frame after the paste
 * matches the frame on the bench* — is checkable by anything but an eye.
 * TypeScript accepts quoted keys in an object literal, so it still pastes.
 *
 * Two things about a paste are worth knowing before it is made, and are said
 * here rather than found out: `TREE_DEFAULT` writes some of its fields as named
 * constants (`rootReach: ROOT_REACH`), and a wholesale paste replaces those
 * names with their values; and the profiles come out as numbers, so the reasons
 * for them stay in the comments above the table where they were argued for.
 */

import type { Bench, Knobs } from './recipes';

/**
 * The knobs a query string asks for, over the ones the colony builds from.
 *
 * A field the URL does not mention keeps its default. A field it mentions
 * badly — `lump=x`, or `lump=` with nothing after it — becomes `NaN` rather
 * than quietly falling back, because `boundsProblems` has a sentence for a
 * value that is not a number and no sentence at all for a bench that showed
 * you the default rock when you had asked it for a particular one. `Number('')`
 * is zero, which is the trap this is careful about.
 */
export function knobsFromSearch(bench: Bench, params: URLSearchParams): Knobs {
  const out: Record<string, number> = { ...bench.defaults };
  for (const f of bench.fields) {
    const raw = params.get(f.key);
    if (raw === null) continue;
    out[f.key] = raw.trim() === '' ? Number.NaN : Number(raw);
  }
  return out;
}

/**
 * The address of what is on the bench, ready for `history.replaceState`.
 *
 * `String(n)` rather than anything rounded: a double survives its own decimal
 * form exactly, and a value that came back from a link a hair different from
 * the one that was photographed is a difference nobody would ever think to
 * look for.
 */
export function searchOf(bench: Bench, k: Knobs): string {
  const p = new URLSearchParams();
  p.set('model', bench.name);
  for (const f of bench.fields) p.set(f.key, String(k[f.key] ?? ''));
  return `?${p}`;
}

/**
 * JSON, except that a pair of numbers stays on the line it belongs to.
 *
 * `JSON.stringify(r, null, 2)` puts every number of every profile on a line of
 * its own, which turns the tree's forty radius-and-height pairs into a hundred
 * and sixty lines of column. The recipe is a thing to read and paste, so a
 * point on a profile is printed the way it is written in `buildings.ts` — one
 * line, two numbers — and everything else is stringified the ordinary way.
 */
function print(v: unknown, indent: string): string {
  if (Array.isArray(v)) {
    if (v.every((e) => typeof e === 'number')) return `[${v.map((e) => JSON.stringify(e)).join(', ')}]`;
    const inner = `${indent}  `;
    return `[\n${v.map((e) => inner + print(e, inner)).join(',\n')}\n${indent}]`;
  }
  if (v && typeof v === 'object') {
    const inner = `${indent}  `;
    const rows = Object.entries(v).map(([key, val]) => `${inner}${JSON.stringify(key)}: ${print(val, inner)}`);
    return `{\n${rows.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(v);
}

/** The whole recipe these knobs describe, as the block under the sliders. */
export function recipeText(bench: Bench, k: Knobs): string {
  return print(bench.recipe(k), '');
}
