/**
 * A pen that pays.
 *
 * Before this, every tame animal in the game was a carcass the player had not
 * got round to yet: taming cost a handler's afternoon and a painted zone, and
 * returned exactly what a bullet returned, later. These tests pin the properties
 * that make livestock a real second answer instead:
 *
 *  - it ripens on a clock, it is collected without killing anything, and the
 *    clock starts again — so a pen is a supply and not a stock;
 *  - the payout lands in `rawfood` and `hide`, the two currencies hunting pays
 *    in, because the whole decision is "shoot it now or milk it forever" and
 *    that is only a decision if both sides spend the same money;
 *  - nothing accrues per tick and nothing needs a save migration — an animal
 *    with no clock is one nobody has looked at yet.
 *
 * The last block builds a colony with a real pen and runs it for two days, and
 * watches the hide pile go up without the herd going down. "The counter resets"
 * and "the colony is better off for having built a pen" are not the same claim.
 */

import { describe, expect, it } from 'vitest';

import {
  GATHER_WORK,
  HUSBANDRY_INTERVAL,
  YIELDS,
  collectFrom,
  isRipe,
  readyLivestock,
  tickHusbandry,
  ticksUntilRipe,
  yieldOf,
} from '../src/sim/husbandry';
import { assignJob } from '../src/sim/jobs';
import { inPen, penCapacity } from '../src/sim/livestock';
import { markTamePawn, paintPenZone } from '../src/sim/orders';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import type { AnimalKind, Pawn, ResourceKind, World, WorkType } from '../src/sim/types';
import { TICKS_PER_DAY } from '../src/sim/types';
import { countResource, livingColonists } from '../src/sim/world';
import { ANIMALS, spawnAnimal } from '../src/sim/wildlife';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';

/**
 * Every scrap of a resource anywhere in the colony.
 *
 * Deliberately the total rather than what is lying on the ground: down dropped
 * at the animal's feet is hauled away within the minute, and a test that only
 * counted loose stacks would report the pen as having paid nothing the moment
 * the hauler picked it up.
 */
function held(world: World, kind: ResourceKind): number {
  return countResource(world, kind);
}

/**
 * A pen big enough for `head` animals, painted on open ground near the colony.
 *
 * Painting is done through `paintPenZone` rather than by pushing a zone object
 * into the world, because the containment rule lives in the painter — a test
 * that fabricated its own zone would be testing a pen the game cannot make.
 */
function paintPen(world: World, cx: number, cy: number, head: number): number {
  let painted = 0;
  const want = head * 6 + 6;
  for (let r = 0; r < 8 && painted < want; r++) {
    for (let dy = -r; dy <= r && painted < want; dy++) {
      for (let dx = -r; dx <= r && painted < want; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (paintPenZone(world, cx + dx, cy + dy)) painted++;
      }
    }
  }
  return painted;
}

/** Drop a tame animal of this species into the pen and hand it its first clock. */
function penAnimal(world: World, kind: AnimalKind, x: number, y: number): Pawn {
  const beast = spawnAnimal(world, makeStreams(world).main, kind, x, y);
  if (!beast) throw new Error('nowhere to put the animal');
  beast.tame = true;
  beast.tameTarget = false;
  beast.hunted = false;
  beast.x = x;
  beast.y = y;
  const spec = yieldOf(beast);
  if (spec) beast.ripeAt = world.tick + spec.every;
  return beast;
}

/** A world with a painted pen and nothing else changed. */
function penned(seed = 4242): { world: World; cx: number; cy: number } {
  const world = createWorld(seed);
  const home = livingColonists(world)[0]!;
  const cx = Math.round(home.x);
  const cy = Math.round(home.y);
  const cells = paintPen(world, cx, cy, 4);
  expect(cells).toBeGreaterThan(18);
  return { world, cx, cy };
}

/** Find a walkable pen cell, so an animal placed there is actually contained. */
function penSpot(world: World, cx: number, cy: number, skip = 0): { x: number; y: number } {
  let seen = 0;
  for (let r = 0; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!inPen(world, x, y)) continue;
        if (seen++ < skip) continue;
        return { x, y };
      }
    }
  }
  throw new Error('the pen has no cells');
}

describe('what a penned animal is worth', () => {
  it('pays out in the same currencies hunting pays in', () => {
    // The point of the feature. A new resource kind would have made livestock a
    // parallel economy; paying in food and hide makes it an alternative to the
    // rifle, which is the decision the pen exists to offer.
    const kinds = Object.values(YIELDS).map((y) => y.kind);
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect(['rawfood', 'hide']).toContain(k);
  });

  it('gives every species a player can pen something to give', () => {
    // A tameable animal with no yield is a pen the player builds and then
    // watches do nothing, with no way to find out why. The claim is not "every
    // species has a yield" — a fenwolf never will, and neither will a
    // brambletail — it is that the set of animals the game *lets you tame* and
    // the set with something to collect are the same set.
    //
    // So the question is put to `markTamePawn` rather than to a filter written
    // here. A filter would be this test's guess at the rule; the gate is the
    // rule, and it is the one thing a new species has to get past before it can
    // become somebody's silent pen. Add a species with no yield and forget to
    // refuse it and this fails, which is the entire point.
    let tameable = 0;
    for (const kind of Object.keys(ANIMALS) as AnimalKind[]) {
      const world = createWorld(30003);
      const beast = spawnAnimal(world, makeStreams(world).main, kind, HOME_X, HOME_Y);
      if (!beast) throw new Error(`nowhere to put a ${kind}`);
      if (!markTamePawn(world, beast.id, true)) continue;
      tameable++;
      expect(YIELDS[kind], `${kind} can be tamed and has no yield`).toBeTruthy();
    }
    // And the gate has not quietly closed on everything, which would pass the
    // loop above by never entering it.
    expect(tameable).toBeGreaterThan(0);
  });

  it('is slower than shooting the animal, so hunting stays the fast answer', () => {
    // A mossback is 34 meat in the hand today. If the pen matched that inside a
    // day there would never be a reason to hunt anything again.
    const m = YIELDS.mossback!;
    expect(m.amount).toBeLessThan(ANIMALS.mossback.meat);
    expect(m.every).toBeGreaterThan(TICKS_PER_DAY * 0.5);
  });

  it('pays for the animal it replaces, given long enough', () => {
    // And the other half of the same trade: a pen that never caught up with the
    // bullet would be a strictly worse choice dressed up as a strategy.
    const m = YIELDS.mossback!;
    const daysToBreakEven = (ANIMALS.mossback.meat / m.amount) * (m.every / TICKS_PER_DAY);
    expect(daysToBreakEven).toBeLessThan(6);
  });
});

describe('the clock on one animal', () => {
  it('starts a fresh animal one full cycle out, not ready on the spot', () => {
    // Taming an animal and milking it the same afternoon would collapse the
    // whole shape of livestock-as-the-slow-answer.
    const { world, cx, cy } = penned();
    const spot = penSpot(world, cx, cy);
    const beast = penAnimal(world, 'mossback', spot.x, spot.y);
    expect(isRipe(world, beast)).toBe(false);
    expect(ticksUntilRipe(world, beast)).toBe(YIELDS.mossback!.every);
  });

  it('ripens when its clock runs out', () => {
    const { world, cx, cy } = penned();
    const spot = penSpot(world, cx, cy);
    const beast = penAnimal(world, 'dunhare', spot.x, spot.y);
    world.tick += YIELDS.dunhare!.every;
    expect(isRipe(world, beast)).toBe(true);
    expect(readyLivestock(world).map((a) => a.id)).toContain(beast.id);
  });

  it('starts again after a collection, and the animal is still alive', () => {
    // The entire difference between livestock and hunting.
    const { world, cx, cy } = penned();
    const spot = penSpot(world, cx, cy);
    const beast = penAnimal(world, 'mossback', spot.x, spot.y);
    world.tick += YIELDS.mossback!.every;

    let paid = 0;
    collectFrom(world, beast, (y) => {
      paid = y.amount;
    });
    expect(paid).toBe(YIELDS.mossback!.amount);
    expect(beast.dead).toBeFalsy();
    expect(beast.hp).toBe(ANIMALS.mossback.hp);
    expect(isRipe(world, beast)).toBe(false);
    expect(ticksUntilRipe(world, beast)).toBe(YIELDS.mossback!.every);
  });

  it('will not be collected from outside the pen', () => {
    // A strayed animal is already walking home under `penTarget`; a handler
    // chasing it across the map to milk it is a job that outlasts the walk.
    const { world, cx, cy } = penned();
    const spot = penSpot(world, cx, cy);
    const beast = penAnimal(world, 'mossback', spot.x, spot.y);
    world.tick += YIELDS.mossback!.every;
    expect(isRipe(world, beast)).toBe(true);

    let out = { x: cx, y: cy };
    for (let d = 1; d < 40; d++) {
      if (!inPen(world, cx + d, cy)) {
        out = { x: cx + d, y: cy };
        break;
      }
    }
    beast.x = out.x;
    beast.y = out.y;
    expect(isRipe(world, beast)).toBe(false);
  });

  it('will not be collected from an animal marked for the table', () => {
    // The butcher is already on the way; two jobs fighting over one body is the
    // expensive way to lose the milk.
    const { world, cx, cy } = penned();
    const spot = penSpot(world, cx, cy);
    const beast = penAnimal(world, 'dunhare', spot.x, spot.y);
    world.tick += YIELDS.dunhare!.every;
    expect(isRipe(world, beast)).toBe(true);
    beast.hunted = true;
    expect(isRipe(world, beast)).toBe(false);
  });

  it('leaves wild animals alone entirely', () => {
    const { world, cx, cy } = penned();
    const spot = penSpot(world, cx, cy);
    const beast = penAnimal(world, 'mossback', spot.x, spot.y);
    beast.tame = false;
    world.tick += YIELDS.mossback!.every * 3;
    expect(isRipe(world, beast)).toBe(false);
    expect(ticksUntilRipe(world, beast)).toBeNull();
  });
});

describe('an old save, and a herd that grows', () => {
  it('gives a clock to livestock that has never had one', () => {
    // Which is what a save written before husbandry existed looks like: tame
    // animals, no `ripeAt`. No migration, no version bump.
    const { world, cx, cy } = penned();
    const spot = penSpot(world, cx, cy);
    const beast = penAnimal(world, 'mossback', spot.x, spot.y);
    delete beast.ripeAt;
    expect(isRipe(world, beast)).toBe(false);

    world.tick += HUSBANDRY_INTERVAL - (world.tick % HUSBANDRY_INTERVAL);
    tickHusbandry(world);
    expect(beast.ripeAt).toBe(world.tick + YIELDS.mossback!.every);
  });

  it('makes an old animal wait its turn rather than paying out at once', () => {
    // The tempting bug: treat a missing clock as "ready now" and every pen in
    // every old save dumps a week of milk on the morning the player loads it.
    const { world, cx, cy } = penned();
    const spot = penSpot(world, cx, cy);
    const beast = penAnimal(world, 'mossback', spot.x, spot.y);
    delete beast.ripeAt;
    world.tick += HUSBANDRY_INTERVAL - (world.tick % HUSBANDRY_INTERVAL);
    tickHusbandry(world);
    expect(isRipe(world, beast)).toBe(false);
  });

  it('staggers the herd, because animals arrive on different days', () => {
    // Six animals ripening on the same tick is six jobs at once and then a day
    // of nothing. They stagger for free off their arrival ticks — no rng, which
    // matters because an extra draw would re-roll every map in the game.
    const { world, cx, cy } = penned();
    const a = penAnimal(world, 'mossback', penSpot(world, cx, cy).x, penSpot(world, cx, cy).y);
    world.tick += 300;
    const s2 = penSpot(world, cx, cy, 1);
    const b = penAnimal(world, 'mossback', s2.x, s2.y);
    expect(b.ripeAt! - a.ripeAt!).toBe(300);
  });
});

describe('a colony with a pen', () => {
  /**
   * A four-person colony, a pen full of hares, and farm work to do.
   *
   * Hares rather than mossbacks because down is hide, and hide is the one
   * material the colony cannot grow — so the pile going up is unambiguous
   * evidence the pen paid rather than a crop being harvested somewhere.
   */
  function hareColony(): { world: World; herd: Pawn[] } {
    const { world, cx, cy } = penned(90210);
    for (const p of livingColonists(world)) {
      for (const w of Object.keys(p.priorities) as WorkType[]) {
        p.priorities[w] = w === 'farm' || w === 'haul' ? 1 : 0;
      }
    }
    const herd: Pawn[] = [];
    for (let i = 0; i < 3; i++) {
      const spot = penSpot(world, cx, cy, i);
      herd.push(penAnimal(world, 'dunhare', spot.x, spot.y));
    }
    expect(penCapacity(world)).toBeGreaterThanOrEqual(3);
    return { world, herd };
  }

  it('sends a farmhand out to a ripe animal', () => {
    const { world, herd } = hareColony();
    world.tick += YIELDS.dunhare!.every;
    const hand = livingColonists(world)[0]!;
    hand.jobId = null;
    // Fed and rested, or they would quite rightly go and deal with that first —
    // the pen round is work, and work comes after keeping yourself alive.
    hand.needs.food = 1;
    hand.needs.rest = 1;
    hand.needs.recreation = 1;
    assignJob(world, hand);
    const job = world.jobs.find((j) => j.id === hand.jobId);
    expect(job?.kind).toBe('gatherAnimal');
    expect(herd.map((a) => a.id)).toContain(job!.targetPawnId);
  });

  it('collects the down and leaves the herd standing', () => {
    const { world, herd } = hareColony();
    const before = held(world, 'hide');
    const streams = makeStreams(world);
    // Two days: long enough for the first cycle to come round and for the walk,
    // the work and the haul to all happen at 20 Hz like they would in play.
    stepWorldN(world, streams, Math.round(TICKS_PER_DAY * 2.2));

    expect(held(world, 'hide')).toBeGreaterThan(before);
    for (const a of herd) expect(a.dead).toBeFalsy();
  });

  it('keeps paying, so the pen is a supply and not a one-off', () => {
    const { world } = hareColony();
    const streams = makeStreams(world);
    stepWorldN(world, streams, Math.round(TICKS_PER_DAY * 1.7));
    const firstDay = held(world, 'hide');
    stepWorldN(world, streams, Math.round(TICKS_PER_DAY * 1.7));
    expect(held(world, 'hide')).toBeGreaterThan(firstDay);
  });

  it('does not stall the rest of the farm', () => {
    // The pen round is farm work, and farm work is a queue. A pen that starved
    // the crops would be a feature that broke the colony to feed itself.
    const { world } = hareColony();
    const streams = makeStreams(world);
    stepWorldN(world, streams, Math.round(TICKS_PER_DAY * 1.2));
    for (const p of livingColonists(world)) {
      const job = world.jobs.find((j) => j.id === p.jobId);
      // Nobody wedged on a pen job they can never finish.
      if (job?.kind === 'gatherAnimal') expect(job.age).toBeLessThan(GATHER_WORK * 12);
    }
    expect(world.jobs.filter((j) => j.kind === 'gatherAnimal').length).toBeLessThan(6);
  });

  it('runs a colony with no pen exactly as before', () => {
    // The regression that matters most: three quarters of games never paint a
    // pen, and none of them should notice this shipped.
    const world = createWorld(7777);
    const streams = makeStreams(world);
    for (let i = 0; i < 400; i++) stepWorld(world, streams);
    expect(readyLivestock(world)).toEqual([]);
    expect(world.jobs.some((j) => j.kind === 'gatherAnimal')).toBe(false);
  });
});
