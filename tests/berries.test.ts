/**
 * The food chain: brambles, brambletails, and the wolves that eat them.
 *
 * Two categories, and the split matters more here than usual. The functional half
 * pins the plant — where it may root, how fast it fruits, what winter does to it —
 * in isolation, with no animals and no colony anywhere near it. The experience
 * half runs the actual moor and asks the only question the feature exists to
 * answer: does what eats what actually show up in the numbers.
 *
 * The second half is the reason this file is not just `farming.test.ts` with a
 * different constant. A chain that is only a table of species is decoration; a
 * chain is real when removing one link measurably moves another, and that is a
 * claim you can only make by running the valley twice with one thing changed.
 */

import { describe, expect, it } from 'vitest';

import {
  BUSH_YIELD,
  bushAt,
  ensureBushes,
  isRipeBush,
  nearestRipeBush,
  pickBush,
  ripeBushes,
  stripBush,
  tickBushes,
} from '../src/sim/berries';
import { ANIMALS, isBrowser, populationCap, spawnAnimal, tickWildlife } from '../src/sim/wildlife';
import { isHunter } from '../src/sim/predators';
import { CABIN, GARDEN, HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';
import { CROP_NONE, growingCells } from '../src/sim/farming';
import { addBuilding, countResource, livingColonists } from '../src/sim/world';
import { eraseZone, paintGrowingZone, setPriority } from '../src/sim/orders';
import { isWalkable } from '../src/sim/grid';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { tickMaulings } from '../src/sim/combat';
import { Rng } from '../src/sim/rng';
import { TICKS_PER_DAY, packCell, terrainAt, unpackX, unpackY } from '../src/sim/types';
import type { Pawn, World } from '../src/sim/types';

describe('where brambles grow', () => {
  const world = createWorld(4242);
  const bushes = ensureBushes(world);

  it('puts fruit on the map at all', () => {
    // A density, so the count scales with the valley. What is being guarded is
    // that the generator actually placed some: `scatterBushes` takes one try per
    // patch and silently drops the ones that land in water or rock, so "a few"
    // and "none at all" are the same code path with different luck.
    expect(bushes.length).toBeGreaterThan(20);
  });

  it('roots only in ground a bush could live in', () => {
    for (const b of bushes) {
      const x = unpackX(world, b.c);
      const y = unpackY(world, b.c);
      expect(isWalkable(world, x, y)).toBe(true);
      expect(['grass', 'dirt']).toContain(terrainAt(world, x, y));
    }
  });

  it('keeps out of the yard and out of the plot', () => {
    for (const b of bushes) {
      const x = unpackX(world, b.c);
      const y = unpackY(world, b.c);
      // Foraging has to be a reason to leave the homestead. A bush against the
      // cabin wall would make it one more thing that happens in the same fifteen
      // cells as everything else.
      expect(Math.hypot(x - HOME_X, y - HOME_Y)).toBeGreaterThanOrEqual(9);
      // And never on soil the colony has claimed — a cell that is both a furrow
      // and a bramble is a cell the farm board queues two contradictory jobs on.
      expect(world.cellZone[packCell(world, x, y)]).toBe(-1);
    }
  });

  it('lands the odd one within a settler’s afternoon of home', () => {
    // The forage job will not walk further than 26 cells. If every bush on the
    // map were out past that the work type would exist and never fire, which is
    // the failure mode that looks exactly like "nobody wants to forage today".
    const near = bushes.filter(
      (b) => Math.hypot(unpackX(world, b.c) - HOME_X, unpackY(world, b.c) - HOME_Y) <= 26,
    );
    expect(near.length).toBeGreaterThan(0);
  });

  it('lands them in patches rather than one at a time', () => {
    // A patch reads as a place worth walking to; singles read as noise. Measured
    // as "most bushes have a neighbour within the patch radius", which is what
    // clustering means to a player looking at the moor.
    const withNeighbour = bushes.filter((b) =>
      bushes.some(
        (o) =>
          o !== b &&
          Math.hypot(unpackX(world, o.c) - unpackX(world, b.c), unpackY(world, o.c) - unpackY(world, b.c)) <= 4,
      ),
    );
    expect(withNeighbour.length / bushes.length).toBeGreaterThan(0.7);
  });

  it('regrows the same valley’s bushes on a save that never had any', () => {
    // The load path for every colony saved before brambles existed. It must not
    // hand them a different moor from the one their seed describes — the bushes
    // come off a stream derived from `world.seed`, so this is the same map either
    // way, and a mismatch here would mean an old save quietly became a new world.
    const fresh = createWorld(4242);
    const old = createWorld(4242);
    old.bushes = undefined;
    const regrown = ensureBushes(old);
    expect(regrown.map((b) => b.c)).toEqual(ensureBushes(fresh).map((b) => b.c));
  });

  it('grubs a bush out when a plot is painted over it', () => {
    const w = createWorld(4242);
    // Somewhere clear, south of the cabin — the one patch worldgen promises is
    // treeless — with a bush planted on it by hand so the case is certain.
    const x = CABIN.doorX;
    const y = CABIN.y1 + 3;
    ensureBushes(w).push({ c: packCell(w, x, y), ripe: 1 });
    expect(bushAt(w, x, y)).not.toBeNull();
    expect(paintGrowingZone(w, x, y)).toBe(true);
    expect(bushAt(w, x, y)).toBeNull();
  });
});

describe('how brambles fruit', () => {
  /** A world with one bush on it and nothing else, for measuring the curve. */
  function oneBush(ripe = 0): { world: World; cell: number } {
    const world = createWorld(4242);
    const cell = packCell(world, GARDEN.x0 + 12, GARDEN.y0 + 12);
    world.bushes = [{ c: cell, ripe }];
    return { world, cell };
  }

  it('takes about six days of daylight to come into fruit', () => {
    const { world } = oneBush();
    let ticks = 0;
    const limit = TICKS_PER_DAY * 12;
    while (!isRipeBush(world.bushes![0]!) && ticks < limit) {
      world.tick++;
      tickBushes(world);
      ticks++;
    }
    expect(isRipeBush(world.bushes![0]!)).toBe(true);
    const days = ticks / TICKS_PER_DAY;
    // Six is the design target, and the band around it is real slack rather than
    // sloppiness: the rate is derived from a mean-daylight constant, and rain
    // speeds growth, so the honest claim is "most of a week" — days, not hours,
    // and not the fortnight that would make foraging pointless.
    expect(days).toBeGreaterThan(3);
    expect(days).toBeLessThan(9);
  });

  it('stalls at night', () => {
    const { world } = oneBush(0.3);
    world.tick = 0;
    const before = world.bushes![0]!.ripe;
    for (let i = 0; i < 300; i++) tickBushes(world);
    expect(world.bushes![0]!.ripe).toBe(before);

    world.tick = Math.round(TICKS_PER_DAY * 0.5);
    for (let i = 0; i < 300; i++) tickBushes(world);
    expect(world.bushes![0]!.ripe).toBeGreaterThan(before);
  });

  it('all but stops in winter, which is what makes it a summer income', () => {
    // A bramble a colony could live off in January would mean never needing the
    // plot. Measured against high summer at the same hour rather than against
    // zero, because the season curve is continuous — the claim worth pinning is
    // the ratio, not a hard floor that a tenth of a degree could move.
    const noon = Math.round(TICKS_PER_DAY * 0.5);

    const summer = oneBush(0.4).world;
    summer.tick = TICKS_PER_DAY * 2 + noon;
    for (let i = 0; i < 600; i++) tickBushes(summer);
    const summerGain = summer.bushes![0]!.ripe - 0.4;

    const winter = oneBush(0.4).world;
    winter.tick = TICKS_PER_DAY * 12 + noon;
    for (let i = 0; i < 600; i++) tickBushes(winter);
    const winterGain = winter.bushes![0]!.ripe - 0.4;

    expect(summerGain).toBeGreaterThan(0);
    expect(winterGain).toBeLessThan(summerGain * 0.1);
  });

  it('holds at ripe instead of over-fruiting', () => {
    const { world } = oneBush(0.99);
    world.tick = Math.round(TICKS_PER_DAY * 0.5);
    for (let i = 0; i < 4000; i++) tickBushes(world);
    expect(world.bushes![0]!.ripe).toBe(1);
  });
});

describe('taking the fruit off it', () => {
  it('pays out and leaves the plant standing', () => {
    const world = createWorld(4242);
    world.bushes = [{ c: packCell(world, 20, 20), ripe: 1 }];
    const bush = world.bushes[0]!;
    expect(pickBush(bush)).toBe(BUSH_YIELD);
    expect(bush.ripe).toBe(0);
    // Still there. A bush that vanished when picked would read as the plant
    // dying, and the reason to come back in six days is knowing it did not.
    expect(bushAt(world, 20, 20)).not.toBeNull();
  });

  it('pays a skilled forager more', () => {
    const world = createWorld(4242);
    world.bushes = [{ c: packCell(world, 20, 20), ripe: 1 }];
    expect(pickBush(world.bushes[0]!, 12)).toBeGreaterThan(BUSH_YIELD);
  });

  it('pays nothing for a bush that is not in fruit', () => {
    const world = createWorld(4242);
    world.bushes = [{ c: packCell(world, 20, 20), ripe: 0.9 }];
    expect(pickBush(world.bushes[0]!)).toBe(0);
    // And it did not get set back — a failed pick must not cost the plant six
    // days, or two settlers racing for the same bush would reset each other.
    expect(world.bushes[0]!.ripe).toBe(0.9);
  });

  it('an animal stripping it takes the fruit and pays nobody', () => {
    const world = createWorld(4242);
    world.bushes = [{ c: packCell(world, 20, 20), ripe: 1 }];
    const before = countResource(world, 'rawfood');
    stripBush(world.bushes[0]!);
    expect(world.bushes[0]!.ripe).toBe(0);
    expect(countResource(world, 'rawfood')).toBe(before);
  });

  it('finds the nearest fruit and ignores the bare ones', () => {
    const world = createWorld(4242);
    world.bushes = [
      { c: packCell(world, 30, 30), ripe: 0.5 },
      { c: packCell(world, 34, 30), ripe: 1 },
      { c: packCell(world, 50, 30), ripe: 1 },
    ];
    expect(nearestRipeBush(world, 30, 30, 40)!.c).toBe(packCell(world, 34, 30));
    // And nothing at all past the reach it was given.
    expect(nearestRipeBush(world, 30, 30, 3)).toBeNull();
  });

  it('hands the caller the nearest fruit its own rules will accept', () => {
    const world = createWorld(4242);
    world.bushes = [
      { c: packCell(world, 34, 30), ripe: 1 },
      { c: packCell(world, 50, 30), ripe: 1 },
    ];
    // Straight-line distance says the near one, every time.
    expect(nearestRipeBush(world, 30, 30, 40)!.c).toBe(packCell(world, 34, 30));
    // Unless the caller knows something this does not — which is the whole reason
    // the reachability test lives out there and not in here. A settler and a
    // squirrel standing on the same cell get different answers about the same
    // hedge, and neither of them is wrong.
    const notNear = (bx: number): boolean => bx !== 34;
    expect(nearestRipeBush(world, 30, 30, 40, notNear)!.c).toBe(packCell(world, 50, 30));
    // And a caller that refuses everything gets nothing rather than a fallback,
    // because "there is fruit but you cannot have it" is a different fact from
    // "there is fruit" and the branch above it reads them differently.
    expect(nearestRipeBush(world, 30, 30, 40, () => false)).toBeNull();
  });
});

/**
 * Run the wilderness and nothing else.
 *
 * The colony comes off the map entirely: no settlers means no foraging, no
 * hunting and no jobs, so whatever moves in these numbers moved because one
 * animal ate another or ate a bush. That isolation is the point — with a colony
 * on the map every one of these claims would be confounded by a farmhand who
 * happened to walk past a bramble.
 *
 * The deer and hares come off too. They eat nothing, so they can only add
 * pathfinding to the bill, and this loop is A\* on sixteen thousand cells at
 * twenty hertz — the difference between a minute a run and a quarter of an hour.
 */
function runMoor(world: World, days: number): void {
  const rng = new Rng(0x5eed21);
  world.pawns = world.pawns.filter((p) => p.faction === 'fauna' && (isBrowser(p) || isHunter(p)));
  for (let i = 0; i < TICKS_PER_DAY * days; i++) {
    tickBushes(world);
    tickWildlife(world, rng);
    tickMaulings(world);
    world.tick++;
  }
}

function browsers(world: World): Pawn[] {
  return world.pawns.filter((p) => !p.dead && isBrowser(p));
}

/** Wolves, spread out, because nothing in worldgen puts a predator on the map. */
function releaseWolves(world: World, n: number): void {
  const rng = new Rng(0xf00d);
  for (let i = 0; i < n; i++) {
    const x = 8 + Math.round(((world.width - 16) * i) / n);
    spawnAnimal(world, rng, 'fenwolf', x, Math.round(world.height * (i % 2 === 0 ? 0.3 : 0.7)));
  }
}

describe('the chain, as the valley plays it out', () => {
  const SEED = 4242;
  const DAYS = 6;

  // The same valley three times, with exactly one link changed in each. Built
  // once at describe scope and shared, because each is minutes of real sim — and
  // because the comparison is only worth anything if all three came off one seed.
  const bare = createWorld(SEED);
  bare.pawns = bare.pawns.filter((p) => !isBrowser(p));
  runMoor(bare, DAYS);

  const grazed = createWorld(SEED);
  runMoor(grazed, DAYS);

  const hunted = createWorld(SEED);
  releaseWolves(hunted, 6);
  runMoor(hunted, DAYS);

  it('leaves the moor in fruit when nothing is eating it', () => {
    // The control, and the most important test in the file: six days is a bush's
    // whole cycle, so a valley with no browsers in it ends up almost entirely
    // ripe. If this ever fails, every comparison below is quietly measuring the
    // growth curve instead of the chain and all of them would still pass.
    const all = ensureBushes(bare).length;
    expect(all).toBeGreaterThan(80);
    expect(ripeBushes(bare).length / all).toBeGreaterThan(0.8);
  });

  it('brambletails visibly eat the valley down', () => {
    // The middle link doing its job. Same seed, same bushes, same six days — the
    // only difference is that this valley has squirrels in it. Not "slightly
    // fewer" either: the moor should be visibly worked over, or a player would
    // never connect the bare patches to the animals standing in them.
    expect(ripeBushes(grazed).length).toBeLessThan(ripeBushes(bare).length * 0.75);
  });

  it('carries a population rather than watching one die out', () => {
    // Aging, starving and breeding have to end up in rough balance, and this is
    // the assertion that says so. It shipped for one afternoon at a twelve-day
    // life and a three-day litter, which looks balanced written down and took the
    // moor from eleven brambletails to one in eight days with nothing hunting
    // them — the middle link dying of the calendar, and every predator claim
    // below still passing, because one is fewer than seven.
    expect(browsers(grazed).length).toBeGreaterThan(3);
  });

  it('breeds in the wild, which is the only thing that pushes back', () => {
    // A born kit, not a surviving adult: ids, so deaths cannot fake it. Without
    // this the population is a number that only goes down, and "the wolves keep
    // them in check" is a claim about nothing — there is no growth to check.
    const before = new Set(browsers(createWorld(SEED)).map((p) => p.id));
    expect(browsers(grazed).some((p) => !before.has(p.id))).toBe(true);
  });

  it('wolves thin them, and the fruit comes back', () => {
    // The whole slice in two lines. A valley with predators in it carries fewer
    // browsers and therefore more berries than the same valley without — which is
    // what makes clearing every wolf off the map a decision with a cost rather
    // than free safety.
    expect(browsers(hunted).length).toBeLessThan(browsers(grazed).length);
    expect(ripeBushes(hunted).length).toBeGreaterThan(ripeBushes(grazed).length);
  });
});

/**
 * The state the valley actually arrives at, which none of the runs above reach.
 *
 * Everything in `the chain, as the valley plays it out` is six days long, and the
 * failure this block is about does not happen until the second week. Played out to
 * forty days on three seeds, the browsers overshoot their fruit, starve down, and
 * then sit at *exactly one* for the rest of the run while the brambles ripen back
 * to ninety per cent and nothing touches them. A hundred and twenty ripe bushes and
 * one squirrel, on every seed, for ever.
 *
 * Two guards were each correct about the herd and neither was asking about the
 * species that had gone. The escape hatch tested for *extinction* — none left — and
 * one is not none, so it never opened; and the hatch was parked inside the arrival
 * gate, which counts grazers against the ground's carrying capacity and deliberately
 * does not count browsers at all, so on a map whose deer are at their cap it never
 * opened either.
 *
 * `runMoor` above cannot see any of this, and the reason is worth keeping: it
 * deletes every pawn that is not a browser or a wolf. There are no deer in those
 * valleys, so the gate is always open, so the bug that only bites when the moor is
 * full has nowhere to bite. The harness was hiding it by simplifying exactly the
 * thing that caused it.
 */
describe('a species that cannot come back on its own', () => {
  const SEED = 4242;

  /** Leave one browser standing, which is where a played valley ends up. */
  function lastOfItsKind(world: World): Pawn {
    const kept = browsers(world)[0]!;
    world.pawns = world.pawns.filter((p) => !isBrowser(p) || p.id === kept.id);
    return kept;
  }

  /**
   * Deer up to the ground's own ceiling.
   *
   * This is the half of the setup that matters. A moor with room on it recovers
   * either way; the state the game gets stuck in is a moor that is full of the
   * wrong animal, and that is the only state that tells the two guards apart.
   */
  function fillTheHerd(world: World): void {
    const rng = new Rng(0x9ea2d);
    const grazing = () =>
      world.pawns.filter((p) => p.faction === 'fauna' && !p.dead && !isBrowser(p)).length;
    for (let guard = 0; grazing() < populationCap(world) && guard < 80; guard++) {
      spawnAnimal(world, rng, 'mossback', 8 + rng.int(world.width - 16), 8 + rng.int(world.height - 16));
    }
  }

  /** `runMoor`, but the deer stay — see the note above about why that is the point. */
  function runValley(world: World, days: number): void {
    const rng = new Rng(0x5eed21);
    world.pawns = world.pawns.filter((p) => p.faction === 'fauna');
    for (let i = 0; i < TICKS_PER_DAY * days; i++) {
      tickBushes(world);
      tickWildlife(world, rng);
      tickMaulings(world);
      world.tick++;
    }
  }

  it('refills a valley left with one of them, with the moor already full of deer', () => {
    const world = createWorld(SEED);
    lastOfItsKind(world);
    fillTheHerd(world);
    expect(browsers(world).length).toBe(1);

    runValley(world, 8);

    // Past two, and the exact number is the point rather than pedantry. Two would
    // be satisfied by a single arrival, which leaves the species just as finished
    // if it happens to be the same sex as the survivor. Immigration stops the
    // moment a pair exists — this is a way out of a dead end, not a trickle off the
    // map edge — so *anything past two was born here*, which is precisely the thing
    // the valley could not do on its own.
    //
    // Measured over twelve days on three seeds it climbs one → four or five inside
    // the week and then oscillates between three and five, which is a population
    // living off its fruit rather than a number the respawn clock is holding up.
    expect(browsers(world).length).toBeGreaterThan(2);
  });

  it('does not refill one that has nothing left to eat', () => {
    // The other half of the promise, and the reason this is not simply a trickle of
    // squirrels off the map edge. Their numbers are meant to be a reading of the
    // valley's fruit; importing animals onto a stripped moor would make them a
    // reading of the respawn clock instead, and would be importing them to starve.
    const world = createWorld(SEED);
    lastOfItsKind(world);
    fillTheHerd(world);
    for (const b of ensureBushes(world)) b.ripe = 0;

    runValley(world, 4);

    expect(browsers(world).length).toBeLessThan(2);
  });
});

describe('foraging, as a colony experiences it', () => {
  it('sends settlers out for wild fruit when there is no plot', () => {
    const world = createWorld(11);
    const streams = makeStreams(world);
    // Erase the starting plot. This is the colony that lands and has not dug in
    // yet — the whole case brambles exist for — and without them their only food
    // is the crate they arrived with.
    for (const c of growingCells(world)) {
      eraseZone(world, unpackX(world, c), unpackY(world, c));
    }
    expect(growingCells(world).every((c) => (world.crops[c] ?? CROP_NONE) < 0)).toBe(true);
    for (const p of livingColonists(world)) setPriority(world, p.id, 'farm', 1);

    const startGathered = world.stats.rawGathered ?? 0;
    let sawForage = false;
    for (let t = 0; t < TICKS_PER_DAY * 5; t++) {
      stepWorld(world, streams);
      if (world.jobs.some((j) => j.kind === 'forage')) sawForage = true;
    }

    // Somebody went out for berries, unprompted, off nothing but a work priority.
    expect(sawForage).toBe(true);
    // And it landed in the pantry. `rawGathered` is the ledger's only source
    // term, so with no crops on the map this rise is foraged fruit and hunted
    // meat and nothing else — and nobody was told to hunt.
    expect(world.stats.rawGathered ?? 0).toBeGreaterThan(startGathered);
    expect(world.gameOver).toBe(false);
  }, 240_000);

  it('does not send them across the valley for two raw food', () => {
    // The range cap. Without it the bigger map turns every idle farmhand into a
    // hiker: there is always a ripe bush *somewhere*, so an uncapped search
    // removes a settler from the colony for half a day to fetch a snack.
    const world = createWorld(11);
    const streams = makeStreams(world);
    for (const p of livingColonists(world)) setPriority(world, p.id, 'farm', 1);
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      stepWorld(world, streams);
      for (const j of world.jobs) {
        if (j.kind !== 'forage') continue;
        expect(Math.hypot(j.tx - HOME_X, j.ty - HOME_Y)).toBeLessThan(60);
      }
    }
  }, 120_000);
});

/**
 * A clear run of open ground: three cells tall at its west end for a nine-cell
 * shell, and fourteen long for something to walk along.
 *
 * Searched for rather than written down. Worldgen only promises cleared ground
 * inside the yard, and every fixed cell out on the moor in this suite's history
 * has eventually turned out to be a bet on the seed that stopped paying the day
 * the map changed size.
 */
function openStrip(world: World): { x: number; y: number } {
  const arms = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let r = 14; r < 60; r++) {
    for (const [sx, sy] of arms) {
      const x = HOME_X + sx * r;
      const y = HOME_Y + sy * r;
      let ok = true;
      for (let dx = -1; dx <= 14 && ok; dx++) {
        for (let dy = -1; dy <= 1 && ok; dy++) {
          const cx = x + dx;
          const cy = y + dy;
          ok = isWalkable(world, cx, cy) && world.cellBuilding[packCell(world, cx, cy)]! < 0;
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no clear strip of open ground on this map');
}

describe('the brambletail itself', () => {
  it('is not worth hunting, which is the point of it', () => {
    // Three raw food against a mossback's thirty-four. If this ever crept up to
    // where a hunter would bother, the species would stop being a population the
    // player watches and become another thing to shoot.
    expect(ANIMALS.brambletail.meat).toBeLessThan(ANIMALS.dunhare.meat);
    expect(ANIMALS.brambletail.hide).toBe(0);
  });

  it('is somebody else’s dinner, not a hunter', () => {
    // `predators.ts` eats anything `fauna` that does not itself hunt, so this one
    // flag is the entire wiring between the middle link and the top one.
    expect(ANIMALS.brambletail.hunts).toBeUndefined();
    expect(ANIMALS.brambletail.browses).toBe(true);
  });

  it('starves when the fruit runs out', () => {
    // The down-slope. Without it a valley the colony cleared of wolves would fill
    // with brambletails that eat nothing and never die, and the chain would only
    // run one way.
    const world = createWorld(4242);
    const started = browsers(world).length;
    expect(started).toBeGreaterThan(0);
    // A moor with no fruit on it at all, and none coming.
    world.bushes = [];
    runMoor(world, 4);
    // Browsers specifically, not the pawn list: an emptying valley pulls deer and
    // hares in to fill it, so counting bodies would read a famine as a boom.
    expect(browsers(world).length).toBeLessThan(started);
  }, 300_000);

  it('eats, and what it eats is the bush', () => {
    // The single tick of coupling, isolated: a hungry brambletail standing in the
    // fruit strips it. Everything else in this file is downstream of this line.
    const world = createWorld(4242);
    world.pawns = world.pawns.filter((p) => p.faction === 'fauna' && isBrowser(p));
    const beast = world.pawns[0]!;
    world.bushes = [{ c: packCell(world, Math.round(beast.x), Math.round(beast.y)), ripe: 1 }];
    // Hungry as of now.
    beast.fed = world.tick;
    const rng = new Rng(3);
    for (let i = 0; i < 10 && isRipeBush(world.bushes[0]!); i++) {
      tickWildlife(world, rng);
      world.tick++;
    }
    expect(isRipeBush(world.bushes[0]!)).toBe(false);
    expect(beast.fed).toBeGreaterThan(world.tick);
  });

  it('goes to the hedge it can get to, not the one behind a shut door', () => {
    const world = createWorld(4242);
    const spot = openStrip(world);
    // A barn at the west end of the strip: nine cells of shell with a door in the
    // east face. A settler walks in and out of it all day. Nothing wild does —
    // see `opensDoors` in `movement.ts`.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const kind = dx === 1 && dy === 0 ? 'door' : 'wall';
        expect(addBuilding(world, kind, spot.x + dx, spot.y + dy, true)).not.toBeNull();
      }
    }

    // Fruit inside the barn, and more of it out along the open strip.
    const inside = packCell(world, spot.x, spot.y);
    const outside = packCell(world, spot.x + 11, spot.y);
    world.bushes = [
      { c: inside, ripe: 1 },
      { c: outside, ripe: 1 },
    ];

    // One hungry brambletail, standing two cells off the barn door. Nobody else on
    // the map, so anything that gets eaten was eaten by it.
    world.pawns = [];
    const rng = new Rng(11);
    const beast = spawnAnimal(world, rng, 'brambletail', spot.x + 3, spot.y)!;
    beast.fed = world.tick;

    // The straight line says the barn, and that is the whole trap: the fruit it can
    // smell is nearer than the fruit it can reach. An animal that took this answer
    // spent the day with its nose against a door it cannot work while an identical
    // hedge stood eight cells the other way.
    expect(nearestRipeBush(world, beast.x, beast.y, 60)!.c).toBe(inside);

    for (let i = 0; i < 3000 && isRipeBush(world.bushes[1]!); i++) {
      tickWildlife(world, rng);
      world.tick++;
    }

    expect(isRipeBush(world.bushes[1]!)).toBe(false);
    // And it never got the walled fruit, because it never could have.
    expect(isRipeBush(world.bushes[0]!)).toBe(true);
    // It is out along the strip, not leaning on the barn.
    expect(beast.x).toBeGreaterThan(spot.x + 7);
  });
});
