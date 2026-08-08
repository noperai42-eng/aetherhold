/**
 * Getting better at something.
 *
 * Fifteen job sites used to clamp and increment a skill inline, and every one of
 * them was silent — the number that decides who is worth sending to the bench
 * moved only when the player happened to open a card. `gainSkill` is the one door
 * they all go through now, so this file is about the three things that door has to
 * get right: the clamp, the announcement, and the breakthrough.
 *
 * The breakthrough is the one worth reading twice. It is a chance, and it does not
 * come from the random streams — `makePawn` is handed those, and one extra draw
 * per body silently re-rolls every map and every trader deal on every seed. So it
 * is hashed from state the caller already has, and the test for that is not "is it
 * random" but "is it the same twice, and different across settlers".
 */

import { describe, expect, it } from 'vitest';

import {
  BREAKTHROUGH_CHANCE,
  SKILL_CAP,
  gainSkill,
  learnScale,
  levelFalloff,
  passionOf,
  skillOf,
} from '../src/sim/skills';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import type { Pawn, World } from '../src/sim/types';
import { SKILL_NAMES } from '../src/sim/types';

function fresh(seed = 20260729): { world: World; pawn: Pawn } {
  const world = createWorld(seed);
  const pawn = livingColonists(world)[0]!;
  world.messages.length = 0;
  return { world, pawn };
}

/** Everything the log has said since it was last cleared. */
function said(world: World): string[] {
  return world.messages.map((m) => m.text);
}

describe('awarding experience', () => {
  it('adds the fraction and says nothing about it', () => {
    const { world, pawn } = fresh();
    pawn.skills.cooking = 4.1;

    // `raw` because this test is about the bookkeeping, not the rate: passion and
    // the level falloff scale every ordinary award, and they have their own tests.
    expect(gainSkill(world, pawn, 'cooking', 0.2, { raw: true })).toBe(4);
    expect(pawn.skills.cooking).toBeCloseTo(4.3);
    expect(said(world)).toEqual([]);
  });

  it('announces the whole number, because that is the part that changes what they can do', () => {
    const { world, pawn } = fresh();
    pawn.skills.plants = 4.9;

    expect(gainSkill(world, pawn, 'plants', 0.2)).toBe(5);
    expect(said(world)).toEqual([`${pawn.name} is now a level 5 herbalist.`]);
  });

  it('says it once, not on every award after it', () => {
    const { world, pawn } = fresh();
    pawn.skills.plants = 4.9;
    gainSkill(world, pawn, 'plants', 0.2);
    gainSkill(world, pawn, 'plants', 0.2);
    gainSkill(world, pawn, 'plants', 0.2);

    expect(said(world)).toHaveLength(1);
  });

  it('stops at the cap and does not go on announcing it', () => {
    const { world, pawn } = fresh();
    pawn.skills.mining = SKILL_CAP;

    expect(gainSkill(world, pawn, 'mining', 5)).toBe(SKILL_CAP);
    expect(pawn.skills.mining).toBe(SKILL_CAP);
    expect(said(world)).toEqual([]);
  });

  it('never overshoots the cap on the way to it', () => {
    const { world, pawn } = fresh();
    pawn.skills.mining = 19.9;
    gainSkill(world, pawn, 'mining', 3, { breakthrough: 1 });

    expect(pawn.skills.mining).toBe(SKILL_CAP);
  });

  it('keeps quiet about people the player is not watching', () => {
    const { world } = fresh();
    const raider = world.pawns.find((p) => p.faction === 'raider');
    // Raiders learn to shoot the same way settlers do, and the log is the
    // colony's, not the map's.
    const body = raider ?? { ...livingColonists(world)[0]!, faction: 'raider' as const };
    body.skills.shooting = 3.95;
    gainSkill(world, body, 'shooting', 0.1);

    expect(said(world)).toEqual([]);
  });

  it('honours quiet for the settlers too', () => {
    const { world, pawn } = fresh();
    pawn.skills.cooking = 5.9;
    gainSkill(world, pawn, 'cooking', 0.2, { quiet: true, raw: true });

    expect(pawn.skills.cooking).toBeCloseTo(6.1);
    expect(said(world)).toEqual([]);
  });
});

describe('what somebody cares about', () => {
  /**
   * Passion is not stored anywhere. It is hashed from the seed and the settler's
   * id, for the same reason the breakthrough is: one extra draw inside `makePawn`
   * re-rolls every map, herd and trader deal on every seed. So these tests are
   * about the two properties a hash has to have to stand in for a saved field —
   * it never changes for a given settler, and it is not the same for everybody.
   */

  it('is the same every time you ask, on every load', () => {
    const { world, pawn } = fresh();
    const first = passionOf(world, pawn, 'cooking');
    stepWorldN(world, makeStreams(world), 500);
    expect(passionOf(world, pawn, 'cooking')).toBe(first);
    // A reload is a fresh world object with the same seed and the same ids.
    const again = createWorld(20260729);
    const same = again.pawns.find((p) => p.id === pawn.id)!;
    expect(passionOf(again, same, 'cooking')).toBe(first);
  });

  it('gives one settler different feelings about different trades', () => {
    const { world, pawn } = fresh();
    const seen = new Set(SKILL_NAMES.map((s) => passionOf(world, pawn, s)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('leaves most trades cold, across a hundred settlers', () => {
    // The distribution is the design: burning is meant to be a reason to send
    // *that* settler to the bench, which it stops being if everyone has one.
    const world = createWorld(4242);
    const counts = [0, 0, 0];
    for (let id = 0; id < 100; id++) {
      const body = { ...livingColonists(world)[0]!, id };
      for (const s of SKILL_NAMES) counts[passionOf(world, body, s)]!++;
    }
    const total = counts[0]! + counts[1]! + counts[2]!;
    expect(counts[2]! / total).toBeGreaterThan(0.05);
    expect(counts[2]! / total).toBeLessThan(0.2);
    expect(counts[0]! / total).toBeGreaterThan(0.5);
  });

  it('learns faster the more they care', () => {
    const { world, pawn } = fresh();
    const cold = SKILL_NAMES.find((s) => passionOf(world, pawn, s) === 0)!;
    const hot = SKILL_NAMES.find((s) => passionOf(world, pawn, s) === 2);
    if (!hot) return; // this settler is not the one to ask; the test above covers the spread
    pawn.skills[cold] = 0;
    pawn.skills[hot] = 0;
    expect(learnScale(world, pawn, hot)).toBeGreaterThan(learnScale(world, pawn, cold));
  });
});

describe('the long climb', () => {
  it('is flat for the first few levels and slows after', () => {
    // Level 1 should feel like progress; level 15 should feel like mastery. The
    // flat stretch is what stops a new settler's first afternoon being a slog.
    expect(levelFalloff(0)).toBe(1);
    expect(levelFalloff(3)).toBe(1);
    expect(levelFalloff(8)).toBeLessThan(1);
    expect(levelFalloff(16)).toBeLessThan(levelFalloff(8));
    expect(levelFalloff(20)).toBeGreaterThan(0);
  });

  it('is what makes the tenth level cost more than the first', () => {
    const { world, pawn } = fresh();
    const skill = SKILL_NAMES.find((s) => passionOf(world, pawn, s) === 0)!;
    pawn.skills[skill] = 1;
    gainSkill(world, pawn, skill, 1, { quiet: true });
    const early = pawn.skills[skill] - 1;
    pawn.skills[skill] = 14;
    gainSkill(world, pawn, skill, 1, { quiet: true });
    const late = pawn.skills[skill] - 14;
    expect(late).toBeLessThan(early);
  });

  it('leaves `raw` awards exactly as given, whoever they are', () => {
    // The one door out: a fixed award — a taught level, a scripted gift — should
    // not quietly become 2.2× because the settler happens to love the work.
    const { world, pawn } = fresh();
    for (const s of SKILL_NAMES) {
      pawn.skills[s] = 0;
      gainSkill(world, pawn, s, 0.5, { quiet: true, raw: true });
      expect(pawn.skills[s]).toBeCloseTo(0.5);
    }
  });
});

describe('the breakthrough', () => {
  it('teaches a whole level and says which kind of good news it was', () => {
    const { world, pawn } = fresh();
    pawn.skills.construction = 5.2;

    expect(gainSkill(world, pawn, 'construction', 0.2, { breakthrough: 1 })).toBe(6);
    expect(said(world)).toEqual([
      `${pawn.name} works something out at last — a level 6 builder now.`,
    ]);
  });

  it('is the same twice on the same seed, tick and settler', () => {
    const a = fresh();
    const b = fresh();
    a.pawn.skills.cooking = 3.5;
    b.pawn.skills.cooking = 3.5;
    gainSkill(a.world, a.pawn, 'cooking', 0.2, { breakthrough: BREAKTHROUGH_CHANCE });
    gainSkill(b.world, b.pawn, 'cooking', 0.2, { breakthrough: BREAKTHROUGH_CHANCE });

    expect(a.pawn.skills.cooking).toBe(b.pawn.skills.cooking);
  });

  it('draws nothing from the shared streams', () => {
    // The guard the whole design exists for. Two identical worlds, one of which
    // hands out a hundred awards before either is stepped: if the award touched a
    // stream, the two maps would part company by the first raid.
    const plain = createWorld(4242);
    const taught = createWorld(4242);
    const pupil = livingColonists(taught)[0]!;
    for (let i = 0; i < 100; i++) {
      gainSkill(taught, pupil, 'cooking', 0.05, { breakthrough: BREAKTHROUGH_CHANCE, quiet: true });
    }
    // Put the skill back so the two colonies work at the same rate, and the only
    // difference left is whatever the awards did to the streams.
    pupil.skills.cooking = livingColonists(plain)[0]!.skills.cooking;

    stepWorldN(plain, makeStreams(plain), 600);
    stepWorldN(taught, makeStreams(taught), 600);

    const snapshot = (w: World): string =>
      livingColonists(w)
        .map((p) => `${p.id}:${p.x.toFixed(3)},${p.y.toFixed(3)}:${p.hp.toFixed(2)}`)
        .join('|');
    expect(snapshot(taught)).toBe(snapshot(plain));
  });

  it('does not fire on settlers who are already at the cap', () => {
    const { world, pawn } = fresh();
    pawn.skills.shooting = SKILL_CAP;
    gainSkill(world, pawn, 'shooting', 0.2, { breakthrough: 1 });

    expect(skillOf(pawn, 'shooting')).toBe(SKILL_CAP);
    expect(said(world)).toEqual([]);
  });
});
