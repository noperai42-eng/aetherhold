/**
 * The lake is a larder.
 *
 * Two claims are pinned here. The first is that the lake is genuinely a *third*
 * food supply — not a farm with a different label. It runs on its own stock, it
 * empties, it comes back, and it charges more once the ice is on it. The second
 * is the one that decides whether any of that is worth having: that a colony
 * with an empty pantry and a plank stage on the shore feeds itself out of the
 * water, through the same job board, the same hauling and the same cooking that
 * already existed, without a private food path bolted on beside them.
 *
 * The stock arithmetic is asked of no seed in particular because it belongs to
 * no seed in particular: `fishing.ts` draws no randomness, so every map fishes
 * the same lake. The end-to-end runs use the pinned seed for the same reason the
 * rest of the suite does — a colony that feeds itself is a claim about a
 * specific valley, and a claim about a specific valley has to name it.
 */

import { describe, expect, it } from 'vitest';

import { defOf } from '../src/sim/buildings';
import {
  CATCH_WORK,
  ICE_WORK_SCALE,
  catchWork,
  catchYield,
  fishStock,
  lakeHasFish,
  onShore,
  takeFish,
  tickFishing,
} from '../src/sim/fishing';
import { buildingAt, isWalkable } from '../src/sim/grid';
import { BEARING } from '../src/sim/ice';
import { describeTarget, interact } from '../src/sim/interact';
import { canPlace } from '../src/sim/orders';
import { defaultCamera, deserialize, serialize } from '../src/sim/save';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { TERRAIN_LIST, TICKS_PER_DAY, packCell, terrainAt } from '../src/sim/types';
import type { Pawn, World } from '../src/sim/types';
import { addBuilding, addItem, countResource, livingColonists, removeItem } from '../src/sim/world';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';

/** Four game days of regrowth, the same number `fishing.ts` refills over. */
const REFILL_TICKS = 4 * TICKS_PER_DAY;

/** The nearest place to the cabin a stage could actually stand. */
function shoreCell(world: World): { x: number; y: number } {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      if (!onShore(world, x, y) || !isWalkable(world, x, y)) continue;
      if (buildingAt(world, x, y)) continue;
      const d = (x - HOME_X) ** 2 + (y - HOME_Y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  if (!best) throw new Error('no shoreline on this map');
  return best;
}

/** Empty the pantry, which is what makes anybody consider the lake. */
function emptyLarder(world: World): void {
  for (const s of [...world.items]) {
    if (s.kind === 'rawfood' || s.kind === 'meal') removeItem(world, s);
  }
}

/** One work column open, everyone fed and rested, so a decision is observable. */
function onlyFishing(world: World): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      p.priorities[w] = w === 'hunt' || w === 'haul' ? 1 : 0;
    }
    p.needs.food = 0.9;
    p.needs.rest = 0.9;
  }
}

/** A colony standing on the shore with a finished stage and nothing to eat. */
function fishingColony(seed = 20260729): {
  world: World;
  streams: ReturnType<typeof makeStreams>;
  stage: { x: number; y: number };
} {
  const world = createWorld(seed);
  const streams = makeStreams(world);
  const stage = shoreCell(world);
  addBuilding(world, 'fishhole', stage.x, stage.y, true);
  emptyLarder(world);
  onlyFishing(world);
  return { world, streams, stage };
}

// ---------------------------------------------------------------- functional

describe('the stock in the lake', () => {
  it('reads a save from before anybody fished as a full one', () => {
    const world = createWorld(3);
    delete world.fish;
    delete world.fishOut;
    expect(fishStock(world)).toBe(1);
    expect(lakeHasFish(world)).toBe(true);
    // And a full catch, so an old colony's first cast is not mysteriously thin.
    expect(catchYield(world, 0)).toBe(6);
  });

  it('empties in twenty-five catches and never goes below nothing', () => {
    const world = createWorld(3);
    for (let i = 0; i < 25; i++) takeFish(world);
    expect(fishStock(world)).toBeCloseTo(0, 6);
    // Past empty is still empty. A negative stock would come back through the
    // refill as a lake that takes longer than four days the more you abused it,
    // which is a rule nobody was told.
    for (let i = 0; i < 20; i++) takeFish(world);
    expect(fishStock(world)).toBe(0);
  });

  it('shuts at the low line, opens at the high one, and says each once', () => {
    // The band is the whole reason there are two numbers. One line would put the
    // colony back on the shore the moment the stock crept a hair over it — where
    // a single catch costs more than half a day of regrowth — so the lake would
    // be fished under again on the same trip, forever, and the player would be
    // told the bad news every few seconds for the rest of the game.
    const world = createWorld(3);
    world.pawns.length = 0;
    while (lakeHasFish(world)) takeFish(world);
    expect(world.fishOut).toBe(true);
    const closed = world.messages.filter((m) => m.text.includes('fished out')).length;
    expect(closed).toBe(1);

    // Creeping back over the low line changes nothing: still shut.
    while (fishStock(world) < 0.3) tickFishing(world);
    expect(lakeHasFish(world), 'the lake reopened inside the band').toBe(false);

    let ticks = 0;
    while (!lakeHasFish(world) && ticks < REFILL_TICKS * 2) {
      tickFishing(world);
      ticks++;
    }
    expect(lakeHasFish(world), 'the lake never came back').toBe(true);
    expect(world.messages.filter((m) => m.text.includes('fish are back')).length).toBe(1);
    // And it reopened with something in it — enough catches that the trip is
    // worth the walk, rather than one cast and shut again.
    expect(fishStock(world)).toBeGreaterThan(0.33);
  });

  it('comes back over about four days, and stops when it is full', () => {
    const world = createWorld(3);
    world.pawns.length = 0;
    world.fish = 0;
    for (let t = 0; t < REFILL_TICKS; t++) tickFishing(world);
    expect(fishStock(world)).toBeCloseTo(1, 3);
    // Long past full is still full: no reservoir of hidden fish to spend.
    for (let t = 0; t < REFILL_TICKS; t++) tickFishing(world);
    expect(fishStock(world)).toBe(1);
  });

  it('spends no randomness, on either half of the year', () => {
    // The same contract the ice signs. One roll here would re-seed every map in
    // the game, and the suite is full of tests tuned to specific valleys.
    const world = createWorld(3);
    world.pawns.length = 0;
    const before = world.rng.main;
    world.fish = 0.5;
    for (let t = 0; t < TICKS_PER_DAY; t++) tickFishing(world);
    for (let i = 0; i < 10; i++) takeFish(world);
    catchYield(world, 7);
    expect(world.rng.main).toBe(before);
  });

  it('survives a save and a reload with the lake exactly as it was left', () => {
    const world = createWorld(3);
    world.fish = 0.42;
    world.fishOut = true;
    const view = { mode: 'manager' as const, possessedId: null, camera: defaultCamera(world) };
    const res = deserialize(serialize(world, view, 1, 0));
    expect(res.ok).toBe(true);
    const loaded = (res as { ok: true; save: { world: World } }).save.world;
    expect(fishStock(loaded)).toBeCloseTo(0.42, 6);
    // The latch too, or a shut lake reopens itself every time the player reloads.
    expect(lakeHasFish(loaded)).toBe(false);
  });
});

describe('what a catch is worth', () => {
  it('thins out as the lake does, and never comes up empty-handed', () => {
    const world = createWorld(3);
    world.fish = 1;
    const full = catchYield(world, 0);
    world.fish = 0.4;
    const thin = catchYield(world, 0);
    expect(thin).toBeLessThan(full);
    // A settler who walked to the shore and worked for a minute goes home with
    // something. A job that can finish with nothing to show reads as broken.
    world.fish = 0.001;
    expect(catchYield(world, 0)).toBeGreaterThanOrEqual(1);
    expect(catchYield(world, 20)).toBeGreaterThanOrEqual(1);
  });

  it('pays a practised hand more than a beginner', () => {
    const world = createWorld(3);
    world.fish = 1;
    expect(catchYield(world, 10)).toBeGreaterThan(catchYield(world, 0));
  });
});

describe('the ice charges for it', () => {
  it('costs the same work as the lake is open, and more once it bears', () => {
    const world = createWorld(3);
    world.ice = 0;
    expect(catchWork(world)).toBe(CATCH_WORK);
    // The threshold is `iceBears` and nothing else, so the day the crossing
    // opens is the day fishing gets slow — one fact about the lake, not two.
    world.ice = BEARING - 0.0001;
    expect(catchWork(world)).toBe(CATCH_WORK);
    world.ice = BEARING;
    expect(catchWork(world)).toBeCloseTo(CATCH_WORK * ICE_WORK_SCALE, 6);
    // Dearer, but never a refusal: the whole point of the lake in winter is that
    // it still feeds you.
    expect(catchWork(world)).toBeLessThan(CATCH_WORK * 3);
  });
});

describe('where a stage may stand', () => {
  it('goes on the water’s edge and nowhere else', () => {
    const world = createWorld(3);
    const shore = shoreCell(world);
    expect(canPlace(world, 'fishhole', shore.x, shore.y)).toBe('ok');
    // The cabin's own doorstep is as far from a lake as the map gets.
    expect(canPlace(world, 'fishhole', HOME_X, HOME_Y)).toBe('shore');
    // And nothing else in the build menu picked up the restriction on the way
    // past — this is one building's rule, not a new rule for everybody.
    expect(canPlace(world, 'wall', HOME_X, HOME_Y)).toBe('ok');
  });

  it('reaches straight out, not diagonally past a headland', () => {
    const world = createWorld(3);
    const w = world.width;
    const water = TERRAIN_LIST.indexOf('water');
    const grass = TERRAIN_LIST.indexOf('grass');
    // A dry cell with water only at its corner. A line cast over that corner is
    // a line cast over dry land, whatever the fisher is standing on.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) world.terrain[packCell(world, 20 + dx, 20 + dy)] = grass;
    }
    world.terrain[packCell(world, 21, 21)] = water;
    expect(onShore(world, 20, 20)).toBe(false);
    world.terrain[packCell(world, 21, 20)] = water;
    expect(onShore(world, 20, 20)).toBe(true);
    expect(w).toBeGreaterThan(21);
  });

  it('does not read the far edge of the map as its own shoreline', () => {
    // `terrainAt` indexes a flat array with no bounds check, so asking for x − 1
    // in column 0 answers with the last cell of the row above. Without the guard
    // a stage on the west bank of nothing at all would happily fish a lake on
    // the east side of the valley, and the player would watch a settler cast a
    // line into a wheat field.
    const world = createWorld(3);
    const water = TERRAIN_LIST.indexOf('water');
    const grass = TERRAIN_LIST.indexOf('grass');
    const y = 30;
    for (const [x, yy] of [
      [0, y],
      [1, y],
      [0, y - 1],
      [0, y + 1],
    ] as const) {
      world.terrain[packCell(world, x, yy)] = grass;
    }
    // The cell `terrainAt(world, -1, y)` would wrap onto, and the one on the
    // opposite edge of the same row.
    world.terrain[packCell(world, world.width - 1, y - 1)] = water;
    world.terrain[packCell(world, world.width - 1, y)] = water;
    expect(onShore(world, 0, y)).toBe(false);
    // The build menu never gets that far — column 0 is out of bounds for
    // anything, so the guard is the second lock rather than the only one. It is
    // still worth having: `onShore` is a predicate other code will reach for,
    // and the day something asks it about the map edge for its own reasons, a
    // wrapped read is a bug nobody would think to look for here.
    expect(canPlace(world, 'fishhole', 0, y)).toBe('bounds');
  });

  it('is a deck, so the fisher stands on it', () => {
    // Not a workbench you stand beside. It means the catch lands on the plank
    // where a hauler can reach it, rather than in the lake.
    const def = defOf('fishhole');
    expect(def.solid).toBe(false);
    expect(def.needsShore).toBe(true);
    expect(def.buildable).toBe(true);
    const world = createWorld(3);
    const shore = shoreCell(world);
    addBuilding(world, 'fishhole', shore.x, shore.y, true);
    expect(isWalkable(world, shore.x, shore.y)).toBe(true);
  });
});

// --------------------------------------------------------------- experience

describe('a colony feeds itself out of the lake', () => {
  it('empties the pantry, walks to the shore and comes back with food', () => {
    const { world, streams } = fishingColony();
    expect(countResource(world, 'rawfood')).toBe(0);
    expect(countResource(world, 'meal')).toBe(0);

    // Half a day. Long enough for the walk out and a catch from anywhere on a
    // 96-cell map, short enough that a colony this idle cannot have eaten its
    // way through the delivery.
    for (let i = 0; i < TICKS_PER_DAY / 2; i++) stepWorld(world, streams);

    expect(
      world.messages.some((m) => m.text.includes('lands') && m.text.includes('fish')),
      'nobody ever landed a fish',
    ).toBe(true);
    expect(countResource(world, 'rawfood'), 'the catch never became food').toBeGreaterThan(0);
    // It came out of the lake rather than out of thin air.
    expect(fishStock(world)).toBeLessThan(1);
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });

  it('leaves the lake alone once the larder is full again', () => {
    // The brake that makes the stock mean anything. A colony that fished every
    // idle minute would keep the lake permanently flat and the fish would never
    // be there on the day they mattered.
    const { world, streams, stage } = fishingColony();
    for (const p of livingColonists(world)) p.priorities.hunt = 1;
    // A month of food in the stores, which is what a good autumn looks like.
    addItem(world, 'rawfood', livingColonists(world).length * 400, HOME_X, HOME_Y);

    world.fish = 1;
    for (let i = 0; i < TICKS_PER_DAY / 2; i++) stepWorld(world, streams);
    expect(fishStock(world), 'a fed colony still fished the lake down').toBe(1);
    expect(buildingAt(world, stage.x, stage.y)?.kind).toBe('fishhole');
  });

  it('cuts through the ice in winter, slower, and says so', () => {
    // The winter promise: the lake is still the answer in January, it is just a
    // dearer one. If this ever stops working, the hardest season in the game
    // loses the only food supply a player can reach for *during* the emergency.
    const { world, streams } = fishingColony();
    world.tick = 13 * TICKS_PER_DAY;
    world.ice = 1;
    for (let i = 0; i < TICKS_PER_DAY; i++) stepWorld(world, streams);

    expect(
      world.messages.some((m) => m.text.includes('up through the ice')),
      'nobody fished through the ice all winter',
    ).toBe(true);
    expect(countResource(world, 'rawfood')).toBeGreaterThan(0);
  });

  it('can be over-fished, and tells the player before it goes quiet', () => {
    const { world, streams } = fishingColony();
    world.fish = 0.2;
    for (let i = 0; i < TICKS_PER_DAY / 2; i++) {
      stepWorld(world, streams);
      if (world.fishOut === true) break;
    }
    expect(world.fishOut, 'the lake never ran out under a hungry colony').toBe(true);
    expect(world.messages.some((m) => m.text.includes('fished out'))).toBe(true);
    // And the stage goes quiet rather than handing out jobs that cannot finish.
    expect(lakeHasFish(world)).toBe(false);
  });
});

describe('a settler in first person', () => {
  /** Put a body on the deck, which is the cell the prompt reads. */
  function onTheDeck(world: World, stage: { x: number; y: number }): Pawn {
    const pawn = livingColonists(world)[0]!;
    pawn.x = stage.x;
    pawn.y = stage.y;
    pawn.path = null;
    return pawn;
  }

  it('is offered a line in summer and a hole in winter', () => {
    const { world, stage } = fishingColony();
    const pawn = onTheDeck(world, stage);

    world.ice = 0;
    expect(describeTarget(world, pawn)?.verb).toBe('Cast a line');
    world.ice = 1;
    expect(describeTarget(world, pawn)?.verb).toBe('Cut a hole and fish');
  });

  it('is told plainly when there is nothing biting', () => {
    const { world, stage } = fishingColony();
    const pawn = onTheDeck(world, stage);
    world.fish = 0.05;
    world.fishOut = true;
    expect(describeTarget(world, pawn)?.verb).toBe('The water here is fished out');
    expect(interact(world, pawn)).toContain('Nothing biting');
    expect(world.jobs.some((j) => j.kind === 'fish')).toBe(false);
  });

  it('turns a keypress into the same job the manager would have queued', () => {
    // One simulation, two views. Pressing E on the shore does not run a private
    // fishing routine — it puts a `fish` job on the same board the work loop
    // reads, which is why the catch, the skill and the stock all behave the same
    // whichever camera the player is looking through.
    const { world, streams, stage } = fishingColony();
    const pawn = onTheDeck(world, stage);
    world.ice = 0;
    expect(interact(world, pawn)).toBe('Fishing.');
    const job = world.jobs.find((j) => j.kind === 'fish');
    expect(job).toBeDefined();
    expect(job!.pawnId).toBe(pawn.id);

    for (let i = 0; i < 1200; i++) {
      stepWorld(world, streams);
      if (!world.jobs.some((j) => j.id === job!.id)) break;
    }
    expect(countResource(world, 'rawfood')).toBeGreaterThan(0);
    expect(terrainAt(world, stage.x, stage.y)).not.toBe('water');
  });
});
