/**
 * What the settler cards say a settler is doing.
 *
 * This line is on screen more than any other sentence in the game: three cards
 * on the desk, a whole sheet of them on the phone, rewritten every time somebody
 * sets off across the yard. It had no test at all, and it showed — a settler
 * carrying supper to the store was described as "walking to 4 meal", and one
 * fetching turnips as "walking to 51 rawfood". Both are the internal key printed
 * straight into an English sentence.
 *
 * `resourceWord` was written for exactly this and its own comment says so: "the
 * same vocabulary, in the middle of a sentence", one table rather than a second
 * one that can drift out of step with the first. The drift happened anyway,
 * because a call site simply did not use it. So the vocabulary is asserted here
 * over every resource the colony has, rather than over the two that were caught,
 * and the sentence is asserted through the function the card actually calls.
 */

import { describe, expect, it } from 'vitest';

import { errandLine, resourceWord } from '../src/client/ui/hud';
import { RESOURCE_KINDS } from '../src/sim/types';
import { createWorld } from '../src/sim/worldgen';
import type { ItemStack, Job, Pawn, ResourceKind, World } from '../src/sim/types';

/** The resources you count one of, as against the ones you weigh. */
const COUNTABLE: ResourceKind[] = ['meal', 'medicine', 'hide', 'components', 'assemblies'];

describe('a resource named in the middle of a sentence', () => {
  it('is a word a person would say, for every resource in the game', () => {
    for (const kind of RESOURCE_KINDS) {
      const word = resourceWord(kind);
      // No key escapes into prose. The one that was caught is named because it
      // was caught; the rule is the loop around it.
      expect(word).not.toBe('rawfood');
      expect(word).toMatch(/^[a-z]+( [a-z]+)?$/);
    }
    expect(resourceWord('rawfood')).toBe('raw food');
  });

  it('is plural for the things you can count and bare for the things you cannot', () => {
    // "4 meals" and "169 wood" are both right, and they are right for the same
    // reason the headings above the resource strip are: you count meals and you
    // weigh wood.
    for (const kind of COUNTABLE) expect(resourceWord(kind)).toMatch(/s$/);
    expect(resourceWord('wood')).toBe('wood');
    expect(resourceWord('steel')).toBe('steel');
    expect(resourceWord('rawfood')).toBe('raw food');
  });
});

/**
 * A settler on their feet, carrying a named stack somewhere. The world is a real
 * one from `worldgen`, so the zone lookup and the item index behave the way they
 * do in a game; only the job, the stack and the settler's feet are set by hand,
 * because those are the three things the sentence is built out of.
 */
function hauling(kind: ResourceKind, amount: number): { world: World; pawn: Pawn } {
  const world = createWorld(4242);
  const pawn = world.pawns.find((p) => p.faction === 'colony' && !p.dead)!;
  const item: ItemStack = {
    id: 9001,
    kind,
    amount,
    x: pawn.x + 3,
    y: pawn.y + 3,
    carriedBy: null,
    reservedBy: null,
  };
  world.items.push(item);
  const job: Job = {
    id: 9002,
    kind: 'haulToStockpile',
    pawnId: pawn.id,
    stage: 'goto',
    tx: item.x,
    ty: item.y,
    itemId: item.id,
    progress: 0,
    age: 0,
  };
  world.jobs.push(job);
  pawn.jobId = job.id;
  // The live path is what `errandLine` tests for, rather than `activity`, which
  // still reads "walking" for a tick or two after the last step lands.
  pawn.path = [item.y * world.width + item.x];
  return { world, pawn };
}

describe('the line on a settler card', () => {
  it('says four meals and not four meal', () => {
    const { world, pawn } = hauling('meal', 4);
    const line = errandLine(world, pawn);
    expect(line).toContain('4 meals');
    expect(line).toMatch(/^walking to /);
  });

  it('says raw food and not rawfood', () => {
    const { world, pawn } = hauling('rawfood', 51);
    expect(errandLine(world, pawn)).toContain('51 raw food');
  });

  it('leaves a mass noun alone', () => {
    // The failure mode of a careless pluralisation, pinned so a later fix that
    // reaches for a trailing "s" fails here rather than shipping "169 woods".
    const { world, pawn } = hauling('wood', 169);
    const line = errandLine(world, pawn);
    expect(line).toContain('169 wood');
    expect(line).not.toContain('169 woods');
  });

  it('never prints an internal key on a card, for any resource', () => {
    // The sweep. Every resource the colony can pick up, walked past the card.
    for (const kind of RESOURCE_KINDS) {
      const { world, pawn } = hauling(kind, 3);
      const line = errandLine(world, pawn);
      expect(line).toContain(`3 ${resourceWord(kind)}`);
      expect(line).not.toContain('rawfood');
    }
  });
});
