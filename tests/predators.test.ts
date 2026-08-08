/**
 * The fenwolf pack.
 *
 * Every animal on this map used to be food. A pen was a supply of meat with no
 * risk attached to it, which is the same as a supply of meat with no decision in
 * it — you painted the zone, you tamed a mossback, and from then on the pen was
 * a number that only went up. The pack is what makes keeping animals a thing you
 * can be bad at.
 *
 * It is also, deliberately, not a raid. The whole feature is defined by what it
 * refuses to do: it does not come for the settlers, it does not leave a pile of
 * free meat where it kills, it cannot be tamed into a solution, and it does not
 * stay. Each of those four is one line of code away from collapsing back into a
 * beat the game already had, so each of them is a test here.
 *
 * The functional half pins the machinery — who is prey, who is preferred, what a
 * bite costs, what a kill leaves behind, when the pack goes home. The experience
 * half is the night itself: wolves come down off the moor, they cross the map,
 * they take an animal out of a pen, the colony is told without anybody having to
 * be looking at the right corner, and the survivors walk off the edge. Including
 * the one that actually hurts — they can take the animal that had a name.
 */

import { describe, expect, it } from 'vitest';

import { isWalkable, buildingAt, dist } from '../src/sim/grid';
import { damagePawn, tickMaulings } from '../src/sim/combat';
import { startPredatorPack } from '../src/sim/encounters';
import { tickDoors } from '../src/sim/movement';
import { computeMood } from '../src/sim/needs';
import { markTamePawn, paintPenZone } from '../src/sim/orders';
import { bondPet, isPet, petName, tickPets } from '../src/sim/pets';
import {
  BITE_DAMAGE,
  BITE_INTERVAL,
  GORGE_TICKS,
  HUNT_REACH,
  PACK_MIN,
  PACK_STAY,
  biteReady,
  feast,
  hunters,
  isFed,
  isHunter,
  nearestHunter,
  preyFor,
  tickAlarm,
  tickPackLeaving,
} from '../src/sim/predators';
import { Rng } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import type { AnimalKind, Pawn, World } from '../src/sim/types';
import { ANIMALS, REROUTE_RETRY, routeTo, spawnAnimal, tickWildlife } from '../src/sim/wildlife';
import { itemsAt, livingColonists, msg } from '../src/sim/world';
import { createWorld, makePawn } from '../src/sim/worldgen';

const VIEW = {
  mode: 'manager' as const,
  possessedId: null,
  camera: { targetX: 0, targetY: 0, distance: 20, yaw: 0, pitch: 1 },
};

/** A world with the wild herds cleared out, so a test places exactly what it means. */
function emptyRange(seed = 20260729): World {
  const world = createWorld(seed);
  world.pawns = world.pawns.filter((p) => p.faction !== 'fauna');
  return world;
}

/** The bottom-left corner of a clear block of open ground — see `livestock.test.ts`. */
function clearing(world: World, w: number, h: number): { x: number; y: number } {
  for (let y = 3; y < world.height - h - 3; y++) {
    for (let x = 3; x < world.width - w - 3; x++) {
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) {
        for (let dx = 0; dx < w && ok; dx++) {
          ok = isWalkable(world, x + dx, y + dy) && !buildingAt(world, x + dx, y + dy);
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no clearing on this map');
}

function pen(world: World, w: number, h: number): { x: number; y: number } {
  const at = clearing(world, w, h);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      expect(paintPenZone(world, at.x + dx, at.y + dy)).toBe(true);
    }
  }
  return at;
}

function putAnimal(world: World, kind: AnimalKind, x: number, y: number): Pawn {
  const def = ANIMALS[kind];
  const beast = makePawn(world, new Rng(world.pawns.length + 1), 'fauna', x, y, {
    name: def.label,
    weapon: 'none',
  });
  beast.animal = kind;
  beast.hp = def.hp;
  beast.maxHp = def.hp;
  if (def.hunts) beast.hunts = true;
  return beast;
}

function putTame(world: World, kind: AnimalKind, x: number, y: number): Pawn {
  const beast = putAnimal(world, kind, x, y);
  beast.tame = true;
  return beast;
}

/**
 * Run the animals only, with nobody else moving.
 *
 * The chase tests are about where a wolf ends up and what it does when it gets
 * there. A full `stepWorld` would send the settlers off to jobs, start weather
 * and fire the storyteller, any of which can move an animal for reasons that have
 * nothing to do with the thing under test.
 */
function walkAnimals(world: World, ticks: number): void {
  const rng = new Rng(11);
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickWildlife(world, rng);
    tickMaulings(world);
    tickAlarm(world);
    tickPackLeaving(world);
    tickPets(world);
    tickDoors(world);
  }
}

/** Somewhere far from anything, so a wolf placed here is alone with its prey. */
function far(world: World): { x: number; y: number } {
  return clearing(world, 6, 6);
}

/**
 * A long open run, which is what a chase needs and a six-cell pocket is not.
 *
 * Written down because it cost an afternoon: the first version of the kill test
 * put the wolf ten cells east of a 5×5 clearing, `spawnAnimal` slid it to the
 * nearest walkable cell, and that cell was inside a rock pocket. The wolf spent
 * fourteen hundred ticks failing to path out of it while the goat grazed, and the
 * test read as "predators do not work" rather than "the fixture put it in a hole".
 */
function run(world: World): { x: number; y: number } {
  return clearing(world, 18, 6);
}

/** Paint a pen into a corner of a clearing that has already been chosen. */
function penAt(world: World, at: { x: number; y: number }, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      expect(paintPenZone(world, at.x + dx, at.y + dy)).toBe(true);
    }
  }
}

/** Everybody out of the way, so nothing walks into the middle of a chase. */
function clearTheYard(world: World, except?: Pawn): void {
  for (const p of livingColonists(world)) {
    if (except && p.id === except.id) continue;
    p.x = 6;
    p.y = 6;
  }
}

describe('what a fenwolf is', () => {
  it('is fauna, and hunts, and says so on the pawn rather than in a lookup', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    expect(wolf.faction).toBe('fauna');
    expect(wolf.hunts).toBe(true);
    expect(isHunter(wolf)).toBe(true);
    // And the identity is the field, not the species — which is the whole reason
    // `predators.ts` can be imported by the module that owns the species table.
    const goat = putAnimal(world, 'mossback', at.x + 2, at.y);
    expect(isHunter(goat)).toBe(false);
    goat.hunts = true;
    expect(isHunter(goat)).toBe(true);
  });

  it('is faster than a winded mossback and slower than a fresh one', () => {
    // This is the arithmetic that makes a kill a chase with an ending rather than
    // either a formality or an impossibility. A frightened grazer bursts away at
    // 3.4× a walk, and then it is winded at 0.7×; the wolf runs at a flat 1.05×
    // the whole way. It loses the first ten seconds and wins the minute.
    const wolf = ANIMALS.fenwolf.speed;
    const prey = ANIMALS.mossback.speed;
    expect(wolf).toBeGreaterThan(prey * 0.7);
    expect(wolf).toBeLessThan(prey * 3.4);
  });

  it('cannot be tamed, by any of the ways a player can ask', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    expect(markTamePawn(world, wolf.id, true)).toBe(false);
    expect(wolf.tameTarget).toBeUndefined();
    // And the reason a single choke point is enough: nothing downstream will look
    // at an animal that was never marked.
    const goat = putAnimal(world, 'mossback', at.x + 2, at.y);
    expect(markTamePawn(world, goat.id, true)).toBe(true);
  });
});

describe('what it goes for', () => {
  it('picks the nearest animal and ignores the people', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    const hare = putAnimal(world, 'dunhare', at.x + 3, at.y);
    const settler = livingColonists(world)[0]!;
    settler.x = at.x + 1;
    settler.y = at.y;
    const prey = preyFor(world, wolf);
    expect(prey?.id).toBe(hare.id);
    // The settler is a cell away and is not on the menu. That is the feature.
    expect(prey?.faction).toBe('fauna');
  });

  it('prefers the pen even when the pen is further', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    putAnimal(world, 'dunhare', at.x + 10, at.y);
    const goat = putTame(world, 'mossback', at.x + 16, at.y);
    expect(preyFor(world, wolf)?.id).toBe(goat.id);
  });

  it('does not eat other wolves, or itself', () => {
    const world = emptyRange();
    const at = far(world);
    const rng = new Rng(3);
    const wolf = spawnAnimal(world, rng, 'fenwolf', at.x, at.y)!;
    spawnAnimal(world, rng, 'fenwolf', at.x + 2, at.y);
    expect(preyFor(world, wolf)).toBeNull();
  });

  it('stops looking once it is full, and starts again when it is hungry', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    putAnimal(world, 'dunhare', at.x + 3, at.y);
    expect(preyFor(world, wolf)).not.toBeNull();

    wolf.fed = world.tick + GORGE_TICKS;
    expect(isFed(world, wolf)).toBe(true);
    expect(preyFor(world, wolf)).toBeNull();

    world.tick += GORGE_TICKS + 1;
    expect(isFed(world, wolf)).toBe(false);
    expect(preyFor(world, wolf)).not.toBeNull();
  });

  it('stops looking once it is leaving', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    putAnimal(world, 'dunhare', at.x + 3, at.y);
    wolf.migrateTo = { x: 2, y: 2, until: world.tick + 1000 };
    expect(preyFor(world, wolf)).toBeNull();
  });

  it('does not see across the whole map', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    const goat = putTame(world, 'mossback', at.x, at.y + HUNT_REACH + 4);
    expect(preyFor(world, wolf)).toBeNull();
    // Even weighted by the pen pull, which is a weight and not a telescope.
    goat.y = at.y + HUNT_REACH - 2;
    expect(preyFor(world, wolf)?.id).toBe(goat.id);
  });
});

describe('the bite', () => {
  it('only lands in reach, and only on its own beat', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    const goat = putTame(world, 'mossback', at.x + 5, at.y);
    expect(biteReady(world, wolf, goat)).toBe(false);

    goat.x = at.x + 1;
    let bites = 0;
    for (let i = 0; i < BITE_INTERVAL * 4; i++) {
      world.tick++;
      if (biteReady(world, wolf, goat)) bites++;
    }
    // Exactly one per interval — a pack does not chew in unison, and one wolf
    // does not subtract a mossback in a single tick.
    expect(bites).toBe(4);
  });

  it('takes several bites and a chase to bring a mossback down', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    const goat = putTame(world, 'mossback', at.x + 1, at.y);
    expect(Math.ceil(ANIMALS.mossback.hp / BITE_DAMAGE)).toBeGreaterThan(2);

    let bites = 0;
    for (let i = 0; i < BITE_INTERVAL * 12 && !goat.dead; i++) {
      world.tick++;
      goat.x = wolf.x + 1;
      goat.y = wolf.y;
      tickMaulings(world);
      if (goat.hp < goat.maxHp - bites * BITE_DAMAGE * 0.99) bites++;
    }
    expect(goat.dead).toBe(true);
    expect(bites).toBeGreaterThanOrEqual(3);
  });

  it('leaves nothing on the grass', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    const goat = putTame(world, 'mossback', at.x + 1, at.y);
    const cell = { x: Math.round(goat.x), y: Math.round(goat.y) };

    damagePawn(world, goat, goat.hp, 'test');
    expect(goat.dead).toBe(true);
    feast(world, wolf, goat);
    expect(goat.eaten).toBe(true);

    // The carcass pass runs next tick and must clear the body without butchering
    // it. A pack that left thirty-four meat a night in the yard would be the best
    // thing that ever happened to the colony.
    walkAnimals(world, 2);
    expect(world.pawns.some((p) => p.id === goat.id)).toBe(false);
    expect(itemsAt(world, cell.x, cell.y)).toHaveLength(0);
  });

  it('feeds the whole pack off one kill', () => {
    const world = emptyRange();
    const at = far(world);
    const rng = new Rng(3);
    const a = spawnAnimal(world, rng, 'fenwolf', at.x, at.y)!;
    const b = spawnAnimal(world, rng, 'fenwolf', at.x + 2, at.y)!;
    const goat = putTame(world, 'mossback', at.x + 1, at.y);
    damagePawn(world, goat, goat.hp, 'test');
    feast(world, a, goat);
    // Otherwise six wolves take six animals in the same minute and a pen is gone
    // before the player has read the first message.
    expect(isFed(world, a)).toBe(true);
    expect(isFed(world, b)).toBe(true);
  });

  it('says which animal it was, and shouts when it had a name', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    const keeper = livingColonists(world)[0]!;
    const goat = putTame(world, 'mossback', at.x + 1, at.y);
    expect(bondPet(world, keeper, goat)).toBe(true);

    damagePawn(world, goat, goat.hp, 'test');
    feast(world, wolf, goat);
    const line = world.messages.at(-1)!;
    expect(line.text).toContain(petName(goat));
    expect(line.kind).toBe('bad');
    expect(line.headline).toBe(true);
  });
});

describe('when the pack goes home', () => {
  it('walks off the map once its stay is up', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    wolf.packUntil = world.tick + 50;

    tickPackLeaving(world);
    expect(wolf.migrateTo).toBeUndefined();

    world.tick += 60;
    tickPackLeaving(world);
    expect(wolf.migrateTo).toBeDefined();
    // Out the nearest border, not back the way it came.
    const edge = wolf.migrateTo!;
    const onEdge =
      edge.x < 6 || edge.y < 6 || edge.x > world.width - 7 || edge.y > world.height - 7;
    expect(onEdge).toBe(true);
  });

  it('drops the hunt mark on its way out', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    wolf.hunted = true;
    wolf.packUntil = world.tick;
    tickPackLeaving(world);
    // Chasing a wolf that is already leaving is a settler walking forty cells for
    // nothing, and the hunt job would keep them out there all night.
    expect(wolf.hunted).toBe(false);
  });

  it('leaves a wolf with no clock alone', () => {
    const world = emptyRange();
    const at = far(world);
    // The maddened-thornback path spawns fauna with no `packUntil` at all, and
    // one undefined read away this pass would deport every animal on the map.
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    world.tick += 5000;
    tickPackLeaving(world);
    expect(wolf.migrateTo).toBeUndefined();
  });
});

describe('the colony noticing', () => {
  it('marks a wolf that comes in among the buildings, without anybody clicking', () => {
    const world = emptyRange();
    const settler = livingColonists(world)[0]!;
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', settler.x + 3, settler.y)!;
    expect(wolf.hunted).toBeUndefined();

    tickAlarm(world);
    expect(wolf.hunted).toBe(true);
    const line = world.messages.at(-1)!;
    expect(line.kind).toBe('threat');
    expect(line.at).toBeDefined();
  });

  it('marks a wolf standing in a pen even with nobody near it', () => {
    const world = emptyRange();
    const at = pen(world, 4, 4);
    for (const p of livingColonists(world)) {
      p.x = 6;
      p.y = 6;
    }
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x + 1, at.y + 1)!;
    tickAlarm(world);
    expect(wolf.hunted).toBe(true);
  });

  it('says it once, not once a tick', () => {
    const world = emptyRange();
    const settler = livingColonists(world)[0]!;
    spawnAnimal(world, new Rng(3), 'fenwolf', settler.x + 3, settler.y);
    const before = world.messages.length;
    for (let i = 0; i < 40; i++) tickAlarm(world);
    expect(world.messages.length).toBe(before + 1);
  });

  it('leaves the far treeline quiet', () => {
    const world = emptyRange();
    const at = far(world);
    for (const p of livingColonists(world)) {
      p.x = world.width - 4;
      p.y = world.height - 4;
    }
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    tickAlarm(world);
    // A wolf nobody could have seen is not an alert. The alarm is for the corner
    // of the map the player is not looking at, not for the whole map.
    expect(wolf.hunted).toBeUndefined();
  });
});

describe('a night with wolves in the valley', () => {
  it('runs down a penned animal and eats it', () => {
    const world = emptyRange();
    const at = run(world);
    penAt(world, at, 6, 6);
    clearTheYard(world);
    const goat = putTame(world, 'mossback', at.x + 2, at.y + 3);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x + 15, at.y + 3)!;
    wolf.packUntil = world.tick + PACK_STAY;
    const larder = world.stats.rawGathered ?? 0;

    // Thirteen cells of open ground, one wolf, one goat that bolts the moment it
    // sees it. This is the whole event in miniature and it has to actually end —
    // a chase that never closes is a pack that costs the player nothing.
    walkAnimals(world, 900);

    expect(world.pawns.some((p) => p.id === goat.id && !p.dead)).toBe(false);
    expect(isFed(world, wolf)).toBe(true);
    expect(world.messages.some((m) => m.text.includes('brought down'))).toBe(true);
    // And it left nothing. Counted off the colony's own ledger rather than off a
    // cell, because the kill lands wherever the chase ended.
    expect(world.stats.rawGathered ?? 0).toBe(larder);
  });

  it('the animal that had a name can be the one it takes', () => {
    const world = emptyRange();
    const at = run(world);
    const keeper = livingColonists(world)[0]!;
    clearTheYard(world, keeper);
    keeper.x = at.x + 2;
    keeper.y = at.y + 3;
    const pet = putTame(world, 'dunhare', keeper.x + 1, keeper.y);
    expect(bondPet(world, keeper, pet)).toBe(true);
    const name = petName(pet);
    // Priced once before anything happens, so the drop below is the wolf and not
    // the pet mood arriving for the first time.
    tickPets(world);
    const before = computeMood(keeper);

    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x + 15, at.y + 3)!;
    wolf.packUntil = world.tick + PACK_STAY;
    walkAnimals(world, 900);

    expect(world.pawns.some((p) => p.id === pet.id && !p.dead)).toBe(false);
    // Two messages, and both of them matter: the kill, which names it, and the
    // grief, which is the colony's side of the same event.
    expect(world.messages.some((m) => m.text.includes(name))).toBe(true);
    expect(computeMood(keeper)).toBeLessThan(before);
    expect(isPet(pet)).toBe(false);
  });

  it('a settler standing in the middle of it is never touched', () => {
    const world = emptyRange();
    const at = run(world);
    const settler = livingColonists(world)[0]!;
    clearTheYard(world, settler);
    settler.x = at.x + 9;
    settler.y = at.y + 3;
    const hp = settler.hp;
    const rng = new Rng(3);
    for (let i = 0; i < 4; i++) {
      const wolf = spawnAnimal(world, rng, 'fenwolf', at.x + 14 + (i % 2), at.y + 2 + (i % 3))!;
      wolf.packUntil = world.tick + PACK_STAY;
    }
    // Something worth crossing the yard for, so they walk right past them.
    putTame(world, 'mossback', at.x + 1, at.y + 3);

    walkAnimals(world, 900);
    // The one promise the whole feature rests on. If a wolf ever bites a person
    // this is a raid with a different mesh, and the beat is gone.
    expect(settler.hp).toBe(hp);
    expect(settler.dead).toBe(false);
  });

  /**
   * The cost of a chase, which is a gameplay property and not a test-suite one.
   *
   * A* is cheap when it succeeds and ruinous when it fails: a refusal has to expand
   * every cell it can reach before it can say no, which on this map is about eight
   * milliseconds. A wolf that asked again every tick — because its brambletail was
   * across the lake — cost eight milliseconds a tick on its own, and a five-wolf
   * pack cost forty of the fifty the whole sim gets at 20 Hz. The pack arrived and
   * the frame rate left with it.
   *
   * So the rule is stated here rather than left to a stopwatch: an animal with no
   * route does not ask for one twice running. The fallback lean already walks it at
   * whatever it wants while it waits, so nothing a player can see depends on the
   * difference.
   */
  it('never re-asks the pathfinder for a route it was just refused', () => {
    const world = createWorld(4041);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', 20, 20)!;
    // Off the map, so the refusal is certain and owes nothing to the seed.
    const nowhere = { x: -5, y: -5 };
    const REFRESH = 90;

    world.tick = 1000;
    routeTo(world, wolf, nowhere.x, nowhere.y, REFRESH, false);
    expect(wolf.path).toBeNull();
    expect(wolf.pathFailedAt).toBe(1000);

    // The tick after a refusal, and every tick up to the backoff: it does not ask
    // again. `pathFailedAt` standing still is exactly that — a fresh ask that
    // failed would restamp it.
    for (let t = 1001; t < 1000 + REROUTE_RETRY; t++) {
      world.tick = t;
      routeTo(world, wolf, nowhere.x, nowhere.y, REFRESH, false);
      expect(wolf.pathFailedAt).toBe(1000);
    }

    // And then it tries again, because the lake does not move but gates open.
    world.tick = 1000 + REROUTE_RETRY;
    routeTo(world, wolf, nowhere.x, nowhere.y, REFRESH, false);
    expect(wolf.pathFailedAt).toBe(1000 + REROUTE_RETRY);
  });

  it('goes after something it can reach at once, and keeps the route', () => {
    // The other half, and the reason the backoff is not just "ask less often": an
    // animal coming off the mark must move on the tick it decides to, or a wolf
    // reads as noticing its dinner four seconds late.
    const world = createWorld(4041);
    // `run(world)`, not a literal corner — the note above `run` is about exactly
    // this test. A hardcoded (20, 20) was open ground on a 128-cell map and is a
    // three-cell rock pocket on a 192-cell one, so the wolf could not path to a
    // cell it was standing next to and the test read as a routing bug.
    const at = run(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    const near = { x: wolf.x + 3, y: wolf.y };
    const REFRESH = 90;

    world.tick = 1000;
    routeTo(world, wolf, Math.round(near.x), Math.round(near.y), REFRESH, false);
    expect(wolf.path).not.toBeNull();
    expect(wolf.pathFailedAt).toBeUndefined();

    // Having one, it is on the freshness clock and not the retry clock: the route
    // it is holding is not thrown away and rebuilt fifteen ticks later.
    const held = wolf.path;
    for (let t = 1001; t < 1000 + REROUTE_RETRY + 2; t++) {
      world.tick = t;
      if ((t + wolf.id) % REFRESH === 0) continue;
      routeTo(world, wolf, Math.round(near.x), Math.round(near.y), REFRESH, false);
      expect(wolf.path).toBe(held);
    }
  });

  it('comes down off the moor, crosses the map and leaves again', () => {
    const world = createWorld(4041);
    const rng = new Rng(77);
    const anchor = livingColonists(world)[0]!;
    // The valley has its own wolves in it now — `spawnInitialFauna` puts a couple
    // of pairs out on the moor and they live there. So "the pack" is not "every
    // fenwolf on the map" any more, and the thing that tells them apart is the one
    // that matters: `packUntil` is the visit's clock, and a resident has none.
    const residents = hunters(world).map((w) => w.id);
    expect(residents.length).toBeGreaterThan(0);
    expect(startPredatorPack(world, rng)).toBe(true);

    const pack = hunters(world).filter((w) => !residents.includes(w.id));
    expect(pack.length).toBeGreaterThanOrEqual(PACK_MIN);
    // They arrive hungry and a long way off — an ambush in the pen would be a
    // notification, not a decision.
    for (const w of pack) {
      expect(isFed(world, w)).toBe(false);
      expect(w.path).not.toBeNull();
      expect(w.packUntil).toBeDefined();
      expect(w.migrateTo).toBeUndefined();
    }
    const startedAway = dist(pack[0]!.x, pack[0]!.y, anchor.x, anchor.y);
    expect(startedAway).toBeGreaterThan(20);
    expect(world.messages.some((m) => m.text.includes('Fenwolves'))).toBe(true);

    // Two days at 20 Hz. Their stay is a day and a half, so this covers the walk
    // in, the hunting and the walk back out.
    const streams = makeStreams(world);
    stepWorldN(world, streams, 9600);

    // Every wolf that came down is gone. The ones that were already here are still
    // here, and that is the difference between weather and an event.
    const packIds = pack.map((w) => w.id);
    expect(hunters(world).filter((w) => packIds.includes(w.id))).toHaveLength(0);
    expect(world.pawns.some((p) => p.hunts === true && packIds.includes(p.id) && !p.dead)).toBe(false);
    // And the colony survived it, because it was never about them.
    expect(livingColonists(world).length).toBeGreaterThan(0);
  });

  it('survives a save in the middle of the night', () => {
    const world = emptyRange();
    const at = far(world);
    const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x, at.y)!;
    wolf.packUntil = world.tick + PACK_STAY;
    wolf.fed = world.tick + 40;
    wolf.hunted = true;
    putTame(world, 'mossback', at.x + 4, at.y);

    const round = deserialize(serialize(world, VIEW, 1, 0));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    const back = round.save.world.pawns.find((p) => p.id === wolf.id)!;
    expect(back.hunts).toBe(true);
    expect(back.packUntil).toBe(wolf.packUntil);
    expect(back.fed).toBe(wolf.fed);
    // And it is still a predator to the code, not just to the renderer. `fed`
    // came back with it, so it is full — wind the clock on and it hunts again.
    expect(isHunter(back)).toBe(true);
    round.save.world.tick += 60;
    expect(preyFor(round.save.world, back)).not.toBeNull();
  });
});

describe('what the herd does about it', () => {
  it('livestock bolt from a wolf, though they never bolt from a person', () => {
    // Two identical yards, one with a wolf three cells off and one with a settler
    // in exactly the same spot, and the measurement is how far the goat walks.
    // Distance to the wolf would be the wrong yardstick — the wolf is faster, so
    // the gap closes whether the goat runs or not.
    const travelled = (withWolf: boolean): number => {
      const world = emptyRange();
      const at = run(world);
      penAt(world, at, 8, 6);
      clearTheYard(world);
      const goat = putTame(world, 'mossback', at.x + 3, at.y + 3);
      if (withWolf) {
        const wolf = spawnAnimal(world, new Rng(3), 'fenwolf', at.x + 6, at.y + 3)!;
        expect(nearestHunter(world, goat, 8)?.id).toBe(wolf.id);
      } else {
        const settler = livingColonists(world)[0]!;
        settler.x = at.x + 6;
        settler.y = at.y + 3;
        expect(nearestHunter(world, goat, 8)).toBeNull();
      }
      let walked = 0;
      for (let i = 0; i < 60; i++) {
        const px = goat.x;
        const py = goat.y;
        walkAnimals(world, 1);
        walked += dist(px, py, goat.x, goat.y);
      }
      return walked;
    };

    // A pen that stood still and watched a wolf walk in would not read as animals
    // at all. A pen that scattered from the handler would make slaughter a job
    // nobody could ever finish — which is why the second number has to stay flat.
    expect(travelled(true)).toBeGreaterThan(2);
    expect(travelled(false)).toBeLessThan(1);
  });

  it('says nothing about the pack when there is no pack', () => {
    // The quiet case, and worth pinning: none of these passes may cost a message,
    // an rng draw or a wandering animal on the ninety-nine nights out of a hundred
    // when there is nothing on the moor.
    const world = emptyRange();
    putTame(world, 'mossback', 40, 40);
    msg(world, 'marker');
    const before = world.messages.length;
    const dice = JSON.stringify(world.rng);
    walkAnimals(world, 200);
    expect(world.messages.length).toBe(before);
    expect(JSON.stringify(world.rng)).toBe(dice);
  });
});
