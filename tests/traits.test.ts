/**
 * Traits: does each one actually move the number it claims to, and does a
 * colony made of them play differently from a colony without them?
 *
 * The functional half asserts one effect per test against the system that reads
 * it — `workRate` for work, `computeMood` for temperament, `tickNeeds` for
 * appetite, `persuade` for kindness — because a trait whose only evidence is a
 * chip in the inspector is decoration, not a mechanic. The experience half runs
 * whole colonies and checks the difference shows up in the play.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { makePawn } from '../src/sim/pawn';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { Rng } from '../src/sim/rng';
import { computeMood, tickNeeds } from '../src/sim/needs';
import { workRate } from '../src/sim/jobs';
import { persuade, imprison } from '../src/sim/prison';
import { WEAPONS, fireWeapon } from '../src/sim/combat';
import { deserialize, serialize } from '../src/sim/save';
import { addBuilding } from '../src/sim/world';
import {
  TRAITS,
  backfillTraits,
  bodyMultiplierOf,
  hasTrait,
  rollTraits,
  traitsOf,
} from '../src/sim/traits';
import type { TraitName } from '../src/sim/traits';
import { SAVE_VERSION, TICKS_PER_DAY } from '../src/sim/types';
import type { Pawn, World } from '../src/sim/types';

/** A settler with exactly the traits named, and nothing else different. */
function settler(world: World, traits: TraitName[], name = 'Subject'): Pawn {
  const p = makePawn(world, new Rng(11), 'colony', 30, 30, { name });
  p.traits = traits;
  const body = bodyMultiplierOf(traits);
  p.maxHp = Math.round(100 * body);
  p.hp = p.maxHp;
  return p;
}

describe('the trait table', () => {
  it('never rolls two traits that contradict each other', () => {
    // Every seed, not a sampled few: the pairs are the one invariant the table
    // has, and "hardworking and slothful" is a bug a player would screenshot.
    const opposed: TraitName[][] = [
      ['hardworking', 'slothful'],
      ['tough', 'frail'],
      ['optimist', 'pessimist'],
      ['ironstomach', 'glutton'],
    ];
    for (let seed = 0; seed < 400; seed++) {
      const rolled = rollTraits(new Rng(seed));
      expect(rolled.length).toBeGreaterThanOrEqual(1);
      expect(rolled.length).toBeLessThanOrEqual(2);
      expect(new Set(rolled).size).toBe(rolled.length);
      for (const pair of opposed) {
        expect(rolled.filter((t) => pair.includes(t)).length).toBeLessThan(2);
      }
    }
  });

  it('gives every trait a label and a blurb the inspector can show', () => {
    for (const [name, t] of Object.entries(TRAITS)) {
      expect(t.name).toBe(name);
      expect(t.label.length).toBeGreaterThan(2);
      expect(t.blurb.length).toBeGreaterThan(10);
      // No silent duds: a trait with no numeric effect anywhere is a chip that
      // lies about mattering.
      const effects = [t.work, t.body, t.mood, t.aim, t.appetite, t.persuasion];
      expect(effects.some((v) => v !== undefined)).toBe(true);
    }
  });

  it('balances the table so a colony of eight is not a colony of supermen', () => {
    // Each opposed pair has to cancel, or the average settler drifts and every
    // number tuned before traits existed is quietly wrong.
    expect(TRAITS.hardworking.work! * TRAITS.slothful.work!).toBeCloseTo(0.9775, 3);
    expect(TRAITS.optimist.mood! + TRAITS.pessimist.mood!).toBeCloseTo(0, 6);
    expect(TRAITS.tough.body! * TRAITS.frail.body!).toBeCloseTo(0.975, 3);
    expect(TRAITS.ironstomach.appetite! * TRAITS.glutton.appetite!).toBeCloseTo(0.975, 3);
  });

  it('ignores a trait name that is no longer in the table', () => {
    // A save from a build that shipped a trait since cut must load, not crash.
    const world = createWorld(4);
    const p = settler(world, ['tough']);
    p.traits = ['tough', 'wolfblooded' as TraitName];
    expect(traitsOf(p).map((t) => t.name)).toEqual(['tough']);
  });
});

describe('what each trait actually does', () => {
  it('makes a hardworking settler get more done than a slothful one', () => {
    const world = createWorld(5);
    const keen = settler(world, ['hardworking'], 'Keen');
    const idle = settler(world, ['slothful'], 'Idle');
    // Same skill, same mood — the trait is the only difference left.
    for (const p of [keen, idle]) {
      p.skills.construction = 6;
      p.mood = 0.8;
    }
    const a = workRate(keen, 'construction');
    const b = workRate(idle, 'construction');
    expect(a / b).toBeCloseTo(TRAITS.hardworking.work! / TRAITS.slothful.work!, 5);
    expect(a).toBeGreaterThan(b);
  });

  it('builds a tough settler a bigger body and a frail one a smaller', () => {
    const world = createWorld(6);
    const rng = new Rng(2);
    let tough: Pawn | null = null;
    let frail: Pawn | null = null;
    // Rolled, not hand-set: this is the one effect applied at creation, so it has
    // to be right in `makePawn` rather than only in the helper above.
    for (let i = 0; i < 300 && (!tough || !frail); i++) {
      const p = makePawn(world, rng, 'colony', 30, 30);
      if (!tough && hasTrait(p, 'tough')) tough = p;
      if (!frail && hasTrait(p, 'frail')) frail = p;
    }
    expect(tough).not.toBeNull();
    expect(frail).not.toBeNull();
    expect(tough!.maxHp).toBeGreaterThan(100);
    expect(frail!.maxHp).toBeLessThan(100);
    expect(tough!.hp).toBe(tough!.maxHp);
  });

  it('shifts an optimist and a pessimist apart on identical circumstances', () => {
    const world = createWorld(7);
    const up = settler(world, ['optimist'], 'Up');
    const down = settler(world, ['pessimist'], 'Down');
    for (const p of [up, down]) {
      p.needs.food = 0.5;
      p.needs.rest = 0.5;
      p.needs.recreation = 0.5;
    }
    const gap = computeMood(up) - computeMood(down);
    expect(gap).toBeCloseTo(TRAITS.optimist.mood! - TRAITS.pessimist.mood!, 5);
  });

  it('eats a glutton through the stores faster than an iron stomach', () => {
    const world = createWorld(8);
    const big = settler(world, ['glutton'], 'Big');
    const small = settler(world, ['ironstomach'], 'Small');
    for (const p of [big, small]) p.needs.food = 1;
    for (let t = 0; t < 200; t++) {
      tickNeeds(world, big);
      tickNeeds(world, small);
    }
    const eaten = (p: Pawn) => 1 - p.needs.food;
    expect(eaten(big)).toBeGreaterThan(eaten(small));
    expect(eaten(big) / eaten(small)).toBeCloseTo(
      TRAITS.glutton.appetite! / TRAITS.ironstomach.appetite!,
      4,
    );
  });

  it('lets a kindhearted warden talk a prisoner round on a bad day', () => {
    const world = createWorld(9);
    const bunk = addBuilding(world, 'prisonbed', 28, 38, true)!;
    const kind = settler(world, ['kindhearted'], 'Kind');
    const plain = settler(world, [], 'Plain');
    // Both miserable: without the trait a miserable warden makes one point of
    // headway a sitting, which is the whole thing the trait is buying past.
    kind.mood = 0.3;
    plain.mood = 0.3;

    const capA = makePawn(world, new Rng(1), 'raider', 29, 38, { name: 'A' });
    const capB = makePawn(world, new Rng(2), 'raider', 29, 38, { name: 'B' });
    imprison(world, capA, bunk);
    imprison(world, capB, bunk);
    capA.resistance = 6;
    capB.resistance = 6;

    persuade(world, kind, capA);
    persuade(world, plain, capB);
    expect(capA.resistance).toBe(4);
    expect(capB.resistance).toBe(5);
  });

  it('steadies a crackshot even at the same shooting skill', () => {
    const world = createWorld(10);
    const sharp = settler(world, ['crackshot'], 'Sharp');
    const plain = settler(world, [], 'Plain');
    for (const p of [sharp, plain]) {
      p.skills.shooting = 4;
      p.weapon = 'rifle';
    }
    // Fired through the real projectile path so this measures the cone the game
    // actually uses, not a formula copied into the test.
    const spread = (shooter: Pawn): number => {
      let worst = 0;
      for (let i = 0; i < 400; i++) {
        const before = world.projectiles.length;
        const rng = new Rng(1000 + i);
        let aim = 0;
        for (const t of traitsOf(shooter)) aim += t.aim ?? 0;
        fireWeapon(world, shooter, 1, 0, WEAPONS.rifle, rng, shooter.skills.shooting + aim);
        const shot = world.projectiles[before];
        if (!shot) continue;
        worst = Math.max(worst, Math.abs(Math.atan2(shot.vy, shot.vx)));
      }
      return worst;
    };
    const wide = spread(plain);
    const tight = spread(sharp);
    expect(tight).toBeLessThan(wide);
  });
});

describe('traits across a save', () => {
  it('keeps a settler the same person through save and load', () => {
    const world = createWorld(11);
    const p = world.pawns.find((q) => q.faction === 'colony')!;
    const before = [...(p.traits ?? [])];
    expect(before.length).toBeGreaterThan(0);
    const text = serialize(world, { mode: 'manager', possessedId: null, camera: { targetX: 0, targetY: 0, distance: 30, yaw: 0, pitch: 1 } }, 1, 0);
    const res = deserialize(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.save.world.pawns.find((q) => q.id === p.id)!;
    expect(after.traits).toEqual(before);
  });

  it('gives an old save\'s settlers traits instead of leaving them blank', () => {
    const world = createWorld(12);
    // A save written before the table existed: pawns with no `traits` key at all.
    for (const p of world.pawns) delete p.traits;
    const text = JSON.stringify({
      v: SAVE_VERSION,
      savedAt: 0,
      world,
      view: { mode: 'manager', possessedId: null, camera: { targetX: 0, targetY: 0, distance: 30, yaw: 0, pitch: 1 } },
      speed: 1,
    });
    const first = deserialize(text);
    const second = deserialize(text);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    for (const p of first.save.world.pawns) {
      if (p.faction === 'fauna' || p.faction === 'wildlife') continue;
      expect(p.traits!.length).toBeGreaterThan(0);
    }
    // Same file, same people, both times — a settler who changes character every
    // time the player reloads is worse than one who never had any.
    const names = (w: World) => w.pawns.map((p) => `${p.id}:${(p.traits ?? []).join('+')}`);
    expect(names(first.save.world)).toEqual(names(second.save.world));
  });

  it('scales a backfilled tough settler\'s body without healing or hurting them', () => {
    const world = createWorld(13);
    const p = world.pawns.find((q) => q.faction === 'colony')!;
    delete p.traits;
    p.maxHp = 100;
    p.hp = 50;
    backfillTraits(p);
    // Whatever they rolled, they are still exactly half dead — to the nearest
    // whole hit point, which is all an integer body can promise. A ratio check
    // used to stand here and it was quietly leaning on seed luck: it read 0.5000
    // while this settler rolled a multiplier that halved evenly, and 0.5067 the
    // first time one rolled 0.75 and turned 50 hp out of 100 into 38 out of 75.
    expect(p.hp).toBe(Math.round(p.maxHp * 0.5));
    expect(p.maxHp).toBe(Math.round(100 * bodyMultiplierOf(p.traits!)));
  });

  it('leaves the herds alone', () => {
    const world = createWorld(14);
    const beasts = world.pawns.filter((p) => p.faction === 'fauna' || p.faction === 'wildlife');
    expect(beasts.length).toBeGreaterThan(0);
    for (const b of beasts) expect(b.traits).toBeUndefined();
  });
});

describe('a colony that has traits in it', () => {
  it('runs a normal day with everyone characterised', () => {
    const world = createWorld(20260729);
    const streams = makeStreams(world);
    for (const p of world.pawns) {
      if (p.faction !== 'colony') continue;
      expect((p.traits ?? []).length).toBeGreaterThan(0);
    }
    for (let t = 0; t < TICKS_PER_DAY; t++) stepWorld(world, streams);
    const alive = world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
    expect(alive.length).toBeGreaterThan(0);
    // Nobody's body drifted, nobody's traits evaporated over a day of play.
    for (const p of alive) {
      expect(p.traits!.length).toBeGreaterThan(0);
      expect(p.maxHp).toBe(Math.round(100 * bodyMultiplierOf(p.traits!)));
      expect(p.hp).toBeLessThanOrEqual(p.maxHp);
    }
  });

  it('gets through the same board in less time at the workface than a slothful one', () => {
    // The point of the whole table: it has to show up in the play, not just in a
    // unit test of the multiplier. Same seed, same world, same jobs — the only
    // difference is who the settlers are.
    //
    // What it measures is time at the workface, and that took some finding out.
    // For a long time this test counted standing buildings and asserted the keen
    // crew had more of them, and for a long time it passed. It stopped the day the
    // valley went from 96 cells square to 128, and the reason is worth writing
    // down because it is a fact about the game and not about the test.
    //
    // Bucket a settler's three days by what they are doing and a founding colony
    // reads, on this seed: 28 123 ticks walking against 4 730 working. Six to one.
    // A settler's day is a walk to a job, a short burst of work, and a walk to the
    // next one — and a work-rate trait only touches the burst. Fifteen per cent
    // either side of a term worth a seventh of the loop is two per cent of
    // throughput, and two per cent is far inside the swing between seeds: measured
    // over six of them the keen crew finished more buildings on three and fewer on
    // three, which is a coin, not a signal. Making the valley bigger did not just
    // invalidate the tick budget, it invalidated every claim that had been leaning
    // on how far a settler has to walk.
    //
    // So ask the question the multiplier can actually answer. The keen crew and
    // the slothful one get through much the same board — the colony is limited by
    // legwork, so both are handed the same amount to do — but the keen crew is
    // stood at it for a quarter less time. That is the trait, in the play, with
    // the walking held constant instead of drowning it. The second assertion is
    // the guard that keeps the first honest, because "spent less time working" is
    // also what you would see from a crew that simply did less.
    //
    // Three valleys, not one, and the totals added up before either question is
    // asked — which is the part that took a second lesson to learn. Pinned to a
    // single seed this read 0.91 against a 0.9 alarm and failed, and the build
    // guard was a hair from failing with it at 32 against 32.8. Nothing was
    // broken: measured across six seeds the ratio swings 0.62 to 0.91 because
    // three days is short enough that one raid, or one settler who happened to
    // draw a long haul, moves it several points. A one-seed sample of a quantity
    // that noisy is a coin flip wearing an assertion's clothes, and the honest
    // fix is more sample rather than a looser threshold — loosening would have
    // bought the pass by giving up the ability to notice the trait going dark.
    // Pooled over these three the numbers are 0.74 and 147 against 118, both with
    // room, and the whole thing costs about ninety seconds.
    const SEEDS = [20260729, 21, 7];
    const run = (trait: TraitName): { working: number; built: number } => {
      let working = 0;
      let built = 0;
      for (const seed of SEEDS) {
        const world = createWorld(seed);
        const streams = makeStreams(world);
        for (const p of world.pawns) {
          if (p.faction !== 'colony') continue;
          p.traits = [trait];
        }
        for (let t = 0; t < TICKS_PER_DAY * 3; t++) {
          stepWorld(world, streams);
          for (const p of world.pawns) {
            if (p.faction === 'colony' && !p.dead && p.activity === 'working') working++;
          }
        }
        built += world.stats.built;
      }
      return { working, built };
    };
    const keen = run('hardworking');
    const idle = run('slothful');
    // Measured at 0.74 across the three. The alarm is loose on purpose: it is
    // here to catch the trait being unplugged, not to pin a number that every
    // balance change would have to come and update.
    expect(keen.working).toBeLessThan(idle.working * 0.9);
    // And they were not idling: the same board got built either way.
    expect(keen.built).toBeGreaterThan(idle.built * 0.8);
  });
});
