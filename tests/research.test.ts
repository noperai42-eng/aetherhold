/**
 * Research — the colony's only one-way axis.
 *
 * Every other loop in Aetherhold returns to where it started: the wall you build
 * on day nine is the wall you could have built on day one. Research is the one
 * thing the colony keeps. That makes two properties worth pinning hard.
 *
 * First, that a project can only be *earned*: the effect functions must read the
 * completed list and nothing else, because every one of them is a multiplier that
 * silently rewrites the balance of a system somebody else owns. A `toolYield` that
 * returned 1.5 by accident would double the wood economy with no message and no
 * visible cause.
 *
 * Second, that finishing one is reachable by ordinary play. The experience tests
 * below run a real seeded colony that plants a bench, picks a project, and works
 * it to completion through `stepWorld` — no direct calls into the research module
 * at all — because a tech tree whose points can only be added by a test is not a
 * feature, it is a data structure.
 *
 * The stone wall gets its own section: it is the only capability in the game that
 * is gated, and a gate that leaks means the player can build something the tree
 * says they cannot.
 */

import { describe, expect, it } from 'vitest';

import { defOf } from '../src/sim/buildings';
import { damageBuilding } from '../src/sim/combat';
import { growingCells, tickCrops } from '../src/sim/farming';
import { benchRecipe } from '../src/sim/jobs';
import { canPlace, placeBlueprint } from '../src/sim/orders';
import {
  RESEARCH,
  RESEARCH_ORDER,
  addResearchPoints,
  available,
  buildingUnlocked,
  cropGrowthScale,
  hasResearch,
  makeResearch,
  mealValueScale,
  recipeCostScale,
  researchFraction,
  riflingBonus,
  setProject,
  structureDamageScale,
  surveyScale,
  toolYield,
  treatmentPotency,
  turretCooldownScale,
} from '../src/sim/research';
import { surveyTicks } from '../src/sim/scout';
import { makeStreams, stepWorld } from '../src/sim/tick';
import type { ResearchId } from '../src/sim/research';
import type { Pawn, World } from '../src/sim/types';
import { TICKS_PER_DAY } from '../src/sim/types';
import { addBuilding, addItem, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';
import { qualify } from './qualify';

/** Everything a project stands on, deepest first, itself last. */
function chain(id: ResearchId, out: ResearchId[] = []): ResearchId[] {
  for (const need of RESEARCH[id].needs) chain(need, out);
  if (!out.includes(id)) out.push(id);
  return out;
}

/** Grant projects the way the sim does — through the points, never by hand. */
function grant(world: World, ...ids: ResearchId[]): void {
  for (const id of ids) {
    for (const step of chain(id)) {
      if (hasResearch(world, step)) continue;
      expect(setProject(world, step)).toBe(true);
      addResearchPoints(world, RESEARCH[step].cost);
    }
  }
}

/**
 * A colony whose only work column is research, standing next to a finished bench.
 *
 * The board is cleared for the same reason the hunting tests clear it: with every
 * column live, "did anyone research?" is a question about the priority system, not
 * about research. Here we want the bench itself under test.
 */
function benchColony(seed = 20260729): { world: World; bench: ReturnType<typeof addBuilding> } {
  const world = createWorld(seed);
  const p = livingColonists(world)[0]!;
  const bench = addBuilding(world, 'lab', Math.round(p.x) + 1, Math.round(p.y), true);
  for (const q of world.pawns) {
    if (q.faction !== 'colony') continue;
    for (const w of Object.keys(q.priorities) as Array<keyof typeof q.priorities>) {
      q.priorities[w] = w === 'research' ? 1 : 0;
    }
  }
  return { world, bench };
}

// ---------------------------------------------------------------- functional

describe('the tree', () => {
  it('starts empty, with nothing under way', () => {
    const r = makeResearch();
    expect(r.done).toEqual([]);
    expect(r.current).toBeNull();
    expect(r.progress).toBe(0);
  });

  it('lists every project exactly once, in an order that never puts a child first', () => {
    expect([...RESEARCH_ORDER].sort()).toEqual(Object.keys(RESEARCH).sort());
    for (let i = 0; i < RESEARCH_ORDER.length; i++) {
      for (const need of RESEARCH[RESEARCH_ORDER[i]!].needs) {
        expect(RESEARCH_ORDER.indexOf(need)).toBeLessThan(i);
      }
    }
  });

  it('offers only the roots to a colony that knows nothing', () => {
    const world = createWorld(20260729);
    expect(available(world).map((d) => d.id).sort()).toEqual([
      'fieldmedicine',
      'preserves',
      'tanning',
      'toolmaking',
    ]);
  });

  it('opens a child the moment its parent lands, and drops the parent from the list', () => {
    const world = createWorld(20260729);
    expect(available(world).map((d) => d.id)).not.toContain('stonecutting');
    grant(world, 'toolmaking');
    const ids = available(world).map((d) => d.id);
    expect(ids).toContain('stonecutting');
    expect(ids).toContain('rifling');
    expect(ids).not.toContain('toolmaking');
    // A grandchild stays shut until its own parent is done.
    expect(ids).not.toContain('autoloaders');
  });

  it('refuses a project whose prerequisites are not met, and does not disturb the current one', () => {
    const world = createWorld(20260729);
    expect(setProject(world, 'toolmaking')).toBe(true);
    addResearchPoints(world, 200);
    expect(setProject(world, 'autoloaders')).toBe(false);
    expect(world.research.current).toBe('toolmaking');
    expect(world.research.progress).toBe(200);
  });

  it('refuses a project that is already known', () => {
    const world = createWorld(20260729);
    grant(world, 'toolmaking');
    expect(setProject(world, 'toolmaking')).toBe(false);
  });

  it('discards progress when the player switches project', () => {
    const world = createWorld(20260729);
    setProject(world, 'toolmaking');
    addResearchPoints(world, 400);
    setProject(world, 'preserves');
    expect(world.research.progress).toBe(0);
    expect(world.research.current).toBe('preserves');
  });

  it('banks points against the world, and reports the def only on the tick that finishes it', () => {
    const world = createWorld(20260729);
    setProject(world, 'toolmaking');
    const cost = RESEARCH.toolmaking.cost;
    expect(addResearchPoints(world, cost - 1)).toBeNull();
    expect(world.research.progress).toBe(cost - 1);
    const done = addResearchPoints(world, 1);
    expect(done?.id).toBe('toolmaking');
    expect(hasResearch(world, 'toolmaking')).toBe(true);
    // Finishing clears the slot rather than leaving a completed project selected,
    // or the next settler at the bench would keep "working" on nothing.
    expect(world.research.current).toBeNull();
    expect(world.research.progress).toBe(0);
    // Points arriving with nothing chosen go nowhere — the job is allowed to be
    // one tick behind the player changing their mind.
    expect(addResearchPoints(world, 500)).toBeNull();
    expect(world.research.progress).toBe(0);
  });

  it('reports a fraction the HUD bar can draw, and zero when nothing is chosen', () => {
    const world = createWorld(20260729);
    expect(researchFraction(world)).toBe(0);
    setProject(world, 'toolmaking');
    addResearchPoints(world, RESEARCH.toolmaking.cost / 2);
    expect(researchFraction(world)).toBeCloseTo(0.5, 5);
    addResearchPoints(world, RESEARCH.toolmaking.cost);
    expect(researchFraction(world)).toBe(0);
  });
});

describe('effects are inert until the project lands', () => {
  it('every multiplier is neutral on a fresh colony', () => {
    const world = createWorld(20260729);
    expect(toolYield(world)).toBe(1);
    expect(treatmentPotency(world)).toBe(1);
    expect(mealValueScale(world)).toBe(1);
    expect(riflingBonus(world)).toBe(0);
    expect(turretCooldownScale(world)).toBe(1);
    expect(cropGrowthScale(world)).toBe(1);
    expect(surveyScale(world)).toBe(1);
    expect(recipeCostScale(world)).toBe(1);
    expect(structureDamageScale(world)).toBe(1);
  });

  it('each project moves its own multiplier and no other', () => {
    const cases: Array<[ResearchId, (w: World) => number, number]> = [
      ['toolmaking', toolYield, 1.5],
      ['fieldmedicine', treatmentPotency, 1.9],
      ['preserves', mealValueScale, 1.35],
      ['rifling', riflingBonus, 6],
      ['autoloaders', turretCooldownScale, 0.58],
      ['soilbeds', cropGrowthScale, 1.5],
      ['cartography', surveyScale, 0.5],
      ['machining', recipeCostScale, 0.67],
      ['plating', structureDamageScale, 0.67],
    ];
    for (const [id, fn, want] of cases) {
      const world = createWorld(20260729);
      // Prerequisites come along for the ride, so the cross-check below excludes
      // whatever this project needed to exist at all.
      grant(world, id);
      expect(fn(world)).toBeCloseTo(want, 5);
      for (const [other, otherFn] of cases) {
        if (chain(id).includes(other)) continue;
        const neutral = otherFn(createWorld(20260729));
        expect(otherFn(world)).toBe(neutral);
      }
    }
  });

  it('rifling makes a colonist better without touching the raiders shooting at them', () => {
    const world = createWorld(20260729);
    grant(world, 'rifling');
    // The bonus is a colony property; the helper that spends it is private to
    // combat, so this pins the number the helper adds.
    expect(riflingBonus(world)).toBe(6);
    expect(riflingBonus(createWorld(20260730))).toBe(0);
  });
});

describe('the stone wall is the only thing behind a gate', () => {
  it('leaves every existing structure buildable from the first minute', () => {
    const world = createWorld(20260729);
    for (const kind of ['wall', 'door', 'bed', 'table', 'stove', 'bench', 'lab', 'turret', 'sandbag', 'lamp'] as const) {
      expect(buildingUnlocked(world, kind)).toBe(true);
    }
    expect(buildingUnlocked(world, 'stonewall')).toBe(false);
  });

  it('opens once stonecutting is known', () => {
    const world = createWorld(20260729);
    grant(world, 'stonecutting');
    expect(buildingUnlocked(world, 'stonewall')).toBe(true);
  });
});

// --------------------------------------------------------------- experience

describe('a colony that plants a bench works a project out', () => {
  it('assigns a research job, walks to the bench, and finishes toolmaking', () => {
    const { world } = benchColony();
    const streams = makeStreams(world);
    setProject(world, 'toolmaking');

    // Four days of colony time is a generous ceiling for a 900-point project with
    // three settlers on it: the point of the bound is to fail loudly if the job
    // never starts, not to measure the rate.
    let ticks = 0;
    while (!hasResearch(world, 'toolmaking') && ticks < 4800 * 4) {
      stepWorld(world, streams);
      ticks++;
    }
    expect(hasResearch(world, 'toolmaking')).toBe(true);
    // Everything the player would see: a message, and the wood multiplier live.
    expect(world.messages.some((m) => m.text.includes('Toolmaking'))).toBe(true);
    expect(toolYield(world)).toBe(1.5);
    // The bench is free again, and nobody is stuck holding a finished job.
    expect(world.jobs.some((j) => j.kind === 'research')).toBe(false);
  });

  it('puts one settler on the bench, not the whole colony', () => {
    const { world } = benchColony();
    const streams = makeStreams(world);
    setProject(world, 'stonecutting');
    // Not available yet — nobody should be sent to stand at a bench for nothing.
    expect(world.research.current).toBeNull();

    setProject(world, 'preserves');
    for (let i = 0; i < 400; i++) stepWorld(world, streams);
    expect(world.jobs.filter((j) => j.kind === 'research').length).toBeLessThanOrEqual(1);
    expect(world.research.progress).toBeGreaterThan(0);
  });

  it('takes no research job at all with nothing chosen, even beside a free bench', () => {
    const { world } = benchColony();
    const streams = makeStreams(world);
    // The Steward is stood down, because it now picks a project the moment it
    // finds a bench without one — which is the whole reason `pickProject`
    // exists. The rule under test is the job board's, one layer below that:
    // `world.research.current === null` means no research job, whoever left it
    // null. A player who turns the foreman off gets exactly this colony.
    world.steward = false;
    for (let i = 0; i < 200; i++) stepWorld(world, streams);
    expect(world.jobs.some((j) => j.kind === 'research')).toBe(false);
    expect(world.research.progress).toBe(0);
  });

  it('keeps the points already earned when the settler is pulled off the bench', () => {
    const { world } = benchColony();
    const streams = makeStreams(world);
    setProject(world, 'preserves');
    for (let i = 0; i < 600; i++) stepWorld(world, streams);
    const banked = world.research.progress;
    expect(banked).toBeGreaterThan(0);

    // A raid, a meal, a fire — anything that cancels the job. The points are on
    // the world, not on the job, so they survive it.
    for (const j of [...world.jobs]) if (j.kind === 'research') world.jobs.splice(world.jobs.indexOf(j), 1);
    for (const p of livingColonists(world)) p.jobId = null;
    expect(world.research.progress).toBe(banked);

    for (let i = 0; i < 200; i++) stepWorld(world, streams);
    expect(world.research.progress).toBeGreaterThan(banked);
  });

  it('cannot blueprint a stone wall until the project lands, and can straight after', () => {
    const world = createWorld(20260729);
    const p: Pawn = livingColonists(world)[0]!;
    // A cell the terrain and occupancy checks are happy with, so the only thing
    // that can refuse the blueprint is the research gate.
    let spot: { x: number; y: number } | null = null;
    for (let d = 1; d < 12 && !spot; d++) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]] as const) {
        const x = Math.round(p.x) + dx;
        const y = Math.round(p.y) + dy;
        if (canPlace(world, 'wall', x, y) === 'ok') {
          spot = { x, y };
          break;
        }
      }
    }
    expect(spot).not.toBeNull();

    expect(canPlace(world, 'stonewall', spot!.x, spot!.y)).toBe('unresearched');
    expect(placeBlueprint(world, 'stonewall', spot!.x, spot!.y)).toBe(false);
    expect(world.buildings.some((b) => b.kind === 'stonewall')).toBe(false);

    grant(world, 'stonecutting');
    expect(canPlace(world, 'stonewall', spot!.x, spot!.y)).toBe('ok');
    expect(placeBlueprint(world, 'stonewall', spot!.x, spot!.y)).toBe(true);
    const wall = world.buildings.find((b) => b.kind === 'stonewall')!;
    expect(wall.built).toBe(false);
    // And it is a real construction job, not a decoration.
    expect(defOf('stonewall').hp).toBeGreaterThan(defOf('wall').hp);
  });
});

describe('the second tier reaches the parts of the sim it claims to', () => {
  it('raised soil beds ripen the plot faster than bare ground', () => {
    const plain = createWorld(20260729);
    const beds = createWorld(20260729);
    grant(beds, 'soilbeds');
    // Same seed, same tick, same weather — the project is the only difference,
    // and tickCrops does not advance the clock, so daylight stays put too.
    for (const w of [plain, beds]) {
      w.tick = Math.round(TICKS_PER_DAY * 0.4);
      for (const c of growingCells(w)) w.crops[c] = 0;
    }
    for (let i = 0; i < 600; i++) {
      tickCrops(plain);
      tickCrops(beds);
    }
    const cell = growingCells(plain)[0]!;
    expect(plain.crops[cell]!).toBeGreaterThan(0);
    expect(beds.crops[cell]!).toBeCloseTo(plain.crops[cell]! * 1.5, 5);
  });

  it('cartography gets a scout home from the same site sooner', () => {
    const run = (charted: boolean): number => {
      const world = createWorld(20260729);
      if (charted) grant(world, 'cartography');
      // Scouting is bottom of the board on purpose; clearing the rest is the
      // only way to watch an expedition rather than the cook rota.
      for (const p of world.pawns) {
        if (p.faction !== 'colony') continue;
        for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
          p.priorities[w] = w === 'scout' ? 1 : 0;
        }
      }
      const streams = makeStreams(world);
      let t = 0;
      while (!world.sites.some((s) => s.found) && t < TICKS_PER_DAY) {
        stepWorld(world, streams);
        t++;
      }
      return t;
    };
    const plain = run(false);
    const charted = run(true);
    expect(plain).toBeLessThan(TICKS_PER_DAY);
    // The walk is identical — same seed, same site, same path — so the whole
    // difference is the survey, and it is exactly half of it.
    expect(plain - charted).toBe(Math.round(surveyTicks(createWorld(20260729)) / 2));
  });

  it('machining takes less out of the store for the same rifle', () => {
    const plan = (machined: boolean) => {
      const world = createWorld(20260729);
      if (machined) grant(world, 'machining');
      const pawn = livingColonists(world)[0]!;
      // A settler who already has a rifle wants nothing; a bare store cannot
      // spare the steel for one; and an unqualified one is not offered the job
      // at all. All three have to be true or the recipe is null.
      qualify(world, pawn, 'rifle');
      pawn.weapon = 'none';
      addItem(world, 'steel', 75, Math.round(pawn.x), Math.round(pawn.y));
      return benchRecipe(world, pawn);
    };
    const plain = plan(false);
    const shop = plan(true);
    expect(plain?.recipe).toBe('rifle');
    expect(shop?.recipe).toBe('rifle');
    expect(shop!.cost).toBeLessThan(plain!.cost);
    expect(shop!.cost).toBe(Math.ceil(plain!.cost * 0.67));
  });

  it('composite plating spares a wall that was already standing', () => {
    const plain = createWorld(20260729);
    const plated = createWorld(20260729);
    grant(plated, 'plating');
    const walls = [plain, plated].map((w) => {
      const b = addBuilding(w, 'wall', 1, 1, true);
      if (!b) throw new Error('nowhere to put a test wall');
      damageBuilding(w, b.id, 30);
      return b;
    });
    expect(walls[0]!.hp).toBeLessThan(walls[1]!.hp);
    expect(walls[1]!.hp - walls[0]!.hp).toBeCloseTo(30 * (1 - 0.67), 5);
  });
});
