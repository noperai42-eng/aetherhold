/**
 * Bonded animals.
 *
 * Taming used to end in a pen, which meant the only thing a tame animal was ever
 * *for* was being eaten later. A bonded animal is the other ending: it picks a
 * person, it gets a name, it walks at their heel across the whole map, and the
 * colony does not eat it. Three of those four are promises the sim has to keep on
 * its own, every tick, or the bond is a label on a goat.
 *
 * So the functional half is mostly about the ways a pet must stop behaving like
 * livestock — not leashed to a pen, not markable for the table, not counted
 * against the pen's carrying capacity, not butchered where it falls — plus the
 * one scar this feature could easily have re-opened: naming an animal must not
 * spend the world's dice, because the seed contract is what every other test on
 * this map stands on.
 *
 * The experience half asks the four questions a player actually asks. Does the
 * person who tamed it keep it? Does it follow me? Does it come through the door
 * after me — the first thing anyone tries, and the one that fails if the follow
 * is aimed rather than routed? And when it dies, does the colony notice?
 */

import { describe, expect, it } from 'vitest';

import { isWalkable, buildingAt, dist } from '../src/sim/grid';
import { BREED_INTERVAL, animalSex, penTarget } from '../src/sim/livestock';
import type { Sex } from '../src/sim/livestock';
import { tickDoors } from '../src/sim/movement';
import { computeMood, moodBreakdown } from '../src/sim/needs';
import { markHuntPawn, markTamePawn, paintPenZone } from '../src/sim/orders';
import {
  PET_HEEL,
  PET_MOOD,
  PET_STRETCH,
  PET_TROT,
  bondPet,
  isPet,
  keeperOf,
  petHeel,
  petName,
  petOf,
  petPace,
  releasePet,
  tickPets,
} from '../src/sim/pets';
import { Rng } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import type { AnimalKind, Pawn, World } from '../src/sim/types';
import { ANIMALS, tickBreeding, tickWildlife } from '../src/sim/wildlife';
import { itemsAt, livingColonists } from '../src/sim/world';
import { CABIN, createWorld, makePawn } from '../src/sim/worldgen';

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
  return beast;
}

function putTame(world: World, kind: AnimalKind, x: number, y: number): Pawn {
  const beast = putAnimal(world, kind, x, y);
  beast.tame = true;
  return beast;
}

/**
 * A tame animal of the sex the test needs — the same helper `livestock.test.ts`
 * keeps, and for the same reason: sex is a hash of the pawn id, so the only way to
 * ask for a female is to keep taming animals until one falls that way and throw
 * the rejects off the map.
 *
 * Worth saying why it is needed *here*. The breeding test below used to put down
 * two mossbacks and trust that two consecutive ids would come out one of each. On
 * a small map they did. On a valley this size worldgen lays down enough fauna
 * before the test strips them that the counter starts two and a half thousand
 * higher, both mossbacks hashed male, and the pen could not pair — which reads
 * exactly like the pet being counted against the pen's capacity, the one thing the
 * test exists to rule out. A test that can fail for the reason it is meant to
 * detect *and* for a coin flip is not testing either.
 */
function putSexed(world: World, kind: AnimalKind, sex: Sex, x: number, y: number): Pawn {
  for (let i = 0; i < 64; i++) {
    const beast = putTame(world, kind, x, y);
    if (animalSex(beast) === sex) return beast;
    world.pawns = world.pawns.filter((p) => p !== beast);
  }
  throw new Error(`no id in 64 tries was ${sex}`);
}

/** One settler and one animal already bonded, standing on top of each other. */
function pair(world: World, kind: AnimalKind = 'mossback'): { keeper: Pawn; pet: Pawn } {
  const keeper = livingColonists(world)[0]!;
  const pet = putTame(world, kind, keeper.x + 1, keeper.y);
  expect(bondPet(world, keeper, pet)).toBe(true);
  return { keeper, pet };
}

/** Clear the work board down to one column, so a decision is observable. */
function onlyWork(world: World, keep: 'farm' | 'hunt'): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      p.priorities[w] = w === keep ? 1 : 0;
    }
  }
}

/**
 * Run the animals only, with nobody else moving.
 *
 * The follow tests are about where the pet ends up, and a full `stepWorld` would
 * have the keeper wander off to a job halfway through and turn the assertion into
 * a coin toss. Doors are ticked because a pet coming indoors needs one open.
 */
function walkAnimals(world: World, ticks: number): void {
  const rng = new Rng(11);
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickWildlife(world, rng);
    tickPets(world);
    tickDoors(world);
  }
}

// ---------------------------------------------------------------- functional

describe('bonding', () => {
  it('gives the animal a name, a person, and keeps its species readable', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    expect(isPet(pet)).toBe(true);
    expect(pet.bondedTo).toBe(keeper.id);
    expect(keeperOf(world, pet)).toBe(keeper);
    expect(petOf(world, keeper)).toBe(pet);
    // Named, but still a mossback: the species is stored beside the pet name and
    // not over it, which is what lets letting-go be one deleted field.
    expect(petName(pet)).not.toBe('Mossback');
    expect(pet.name).toBe('Mossback');
    expect(pet.animal).toBe('mossback');
  });

  it('is one apiece, in both directions', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    const second = putTame(world, 'dunhare', keeper.x + 2, keeper.y);
    expect(bondPet(world, keeper, second)).toBe(false);
    expect(isPet(second)).toBe(false);

    const other = livingColonists(world)[1]!;
    expect(bondPet(world, other, pet)).toBe(false);
    expect(keeperOf(world, pet)).toBe(keeper);
  });

  it('refuses anything that is not a live tame animal, and anyone who is not alive', () => {
    const world = emptyRange();
    const keeper = livingColonists(world)[0]!;
    const wild = putAnimal(world, 'dunhare', keeper.x + 1, keeper.y);
    expect(bondPet(world, keeper, wild)).toBe(false);

    const dead = putTame(world, 'dunhare', keeper.x + 2, keeper.y);
    dead.dead = true;
    expect(bondPet(world, keeper, dead)).toBe(false);

    const alive = putTame(world, 'dunhare', keeper.x + 3, keeper.y);
    const ghost = livingColonists(world)[1]!;
    ghost.dead = true;
    expect(bondPet(world, ghost, alive)).toBe(false);
    expect(isPet(alive)).toBe(false);
  });

  it('picks a name nothing else in the colony already answers to', () => {
    const world = emptyRange();
    const keepers = livingColonists(world);
    const names = new Set<string>();
    for (const [i, keeper] of keepers.entries()) {
      const beast = putTame(world, 'dunhare', keeper.x, keeper.y + i + 1);
      expect(bondPet(world, keeper, beast)).toBe(true);
      names.add(petName(beast));
    }
    expect(names.size).toBe(keepers.length);
    for (const keeper of keepers) expect(names.has(keeper.name)).toBe(false);
  });

  it('names it without spending the dice the whole map is built on', () => {
    // The scar: this map's whole test suite stands on `createWorld(seed)` landing
    // on a pinned rng state, and `nextId` is a shared stream too — wildlife
    // staggers its wander cadence by `(tick + id)`. A name drawn from either would
    // move the weather every time a player tamed something.
    const world = emptyRange();
    const before = JSON.stringify(world.rng);
    const ids = world.nextId;
    const keeper = livingColonists(world)[0]!;
    const beast = putTame(world, 'mossback', keeper.x + 1, keeper.y);
    const spent = world.nextId;
    expect(bondPet(world, keeper, beast)).toBe(true);
    expect(JSON.stringify(world.rng)).toBe(before);
    expect(world.nextId).toBe(spent);
    expect(spent).toBeGreaterThan(ids); // the animal itself cost one, as it must
  });
});

describe('a pet is not livestock', () => {
  it('is not leashed to the pen the rest of the herd lives in', () => {
    const world = emptyRange();
    const at = pen(world, 4, 3);
    const keeper = livingColonists(world)[0]!;
    const beast = putTame(world, 'mossback', at.x + 12, at.y);
    // The same animal, in the same place, on both sides of the bond.
    expect(penTarget(world, beast)).not.toBeNull();
    expect(bondPet(world, keeper, beast)).toBe(true);
    expect(penTarget(world, beast)).toBeNull();
  });

  it('cannot be marked for the table, and says whose it is', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    expect(markHuntPawn(world, pet.id, true)).toBe(false);
    expect(pet.hunted).not.toBe(true);
    const last = world.messages[world.messages.length - 1]!;
    expect(last.text).toContain(petName(pet));
    expect(last.text).toContain(keeper.name);
    // And once it is nobody's again, it is an animal like any other.
    releasePet(world, pet);
    expect(markHuntPawn(world, pet.id, true)).toBe(true);
  });

  it('does not eat into the pen it never stands in', () => {
    const world = emptyRange();
    const at = pen(world, 6, 3); // 18 cells: room for three head
    putSexed(world, 'mossback', 'f', at.x + 1, at.y + 1);
    putSexed(world, 'mossback', 'm', at.x + 2, at.y + 1);
    // A third tame animal — but somebody's, and off across the map at their heel.
    const keeper = livingColonists(world)[0]!;
    const own = putTame(world, 'dunhare', keeper.x + 1, keeper.y);
    expect(bondPet(world, keeper, own)).toBe(true);

    const rng = new Rng(7);
    for (let i = 0; i < BREED_INTERVAL * 6; i++) tickBreeding(world, rng);
    // Three head of tame animal on the map, and the pen still calved: the pet was
    // not one of the three it was counting.
    expect(world.pawns.filter((p) => p.faction === 'fauna' && p.tame === true).length).toBe(4);
  });

  it('is not butchered where it falls', () => {
    const world = emptyRange();
    const { pet } = pair(world);
    const cell = { x: Math.round(pet.x), y: Math.round(pet.y) };
    const gathered = world.stats.rawGathered ?? 0;
    pet.hp = 0;
    pet.dead = true;
    walkAnimals(world, 1);
    expect(world.pawns.some((p) => p.id === pet.id)).toBe(false);
    expect(itemsAt(world, cell.x, cell.y).some((s) => s.kind === 'rawfood')).toBe(false);
    expect(itemsAt(world, cell.x, cell.y).some((s) => s.kind === 'hide')).toBe(false);
    expect(world.stats.rawGathered ?? 0).toBe(gathered);

    // The control: an animal of the same species that belonged to nobody does
    // still feed the colony, so this is the bond doing it and not a broken drop.
    const spare = putTame(world, 'mossback', livingColonists(world)[1]!.x + 1, livingColonists(world)[1]!.y);
    spare.hp = 0;
    spare.dead = true;
    walkAnimals(world, 1);
    expect(world.stats.rawGathered ?? 0).toBeGreaterThan(gathered);
  });
});

describe('following', () => {
  it('has nowhere to be while it is already at their heel', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    pet.x = keeper.x + 1;
    pet.y = keeper.y;
    expect(petHeel(world, pet)).toBeNull();
    pet.x = keeper.x + PET_HEEL + 3;
    const want = petHeel(world, pet);
    expect(want).not.toBeNull();
    expect(want!.x).toBeCloseTo(keeper.x, 6);
    expect(want!.y).toBeCloseTo(keeper.y, 6);
  });

  it('has nowhere to be at all once there is nobody to follow', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    pet.x = keeper.x + 9;
    keeper.dead = true;
    expect(petHeel(world, pet)).toBeNull();
  });

  it('trots faster than it grazes, and runs when it has been left behind', () => {
    for (const kind of ['mossback', 'dunhare'] as AnimalKind[]) {
      const graze = ANIMALS[kind].speed;
      const near = petPace(graze, 1);
      const far = petPace(graze, PET_STRETCH + 4);
      // Both species graze slower than a settler walks, so without a floor a pet
      // would simply never arrive.
      expect(near).toBeGreaterThanOrEqual(PET_TROT);
      expect(near).toBeGreaterThan(graze);
      expect(far).toBeGreaterThan(near);
    }
  });
});

describe('what it is worth', () => {
  it('counts on the mood, and the card says which row it is', () => {
    const world = emptyRange();
    const p = livingColonists(world)[0]!;
    p.petMood = 0;
    const without = computeMood(p);
    p.petMood = PET_MOOD;
    expect(computeMood(p) - without).toBeCloseTo(PET_MOOD, 6);
    const row = moodBreakdown(p).find((f) => f.label === 'their animal');
    expect(row).toBeDefined();
    expect(row!.amount).toBeCloseTo(PET_MOOD, 6);
  });

  it('is paid while it is alive and stops when it is gone', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    tickPets(world);
    expect(keeper.petMood).toBeCloseTo(PET_MOOD, 6);
    pet.hp = 0;
    pet.dead = true;
    walkAnimals(world, 1);
    expect(keeper.petMood).toBe(0);
    // Never negative afterwards: the loss is charged once, as grief.
    expect(computeMood(keeper)).toBeLessThanOrEqual(computeMood({ ...keeper, petMood: PET_MOOD }));
  });
});

describe('when it ends', () => {
  it('does not outlive the person it chose', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    const name = petName(pet);
    keeper.dead = true;
    tickPets(world);
    expect(pet.bondedTo).toBeUndefined();
    expect(pet.petName).toBeUndefined();
    expect(isPet(pet)).toBe(false);
    expect(world.messages.some((m) => m.text.includes(name))).toBe(true);
    // Back to being an animal: the herd can have it, and so can the table.
    expect(petName(pet)).toBe('Mossback');
  });

  it('can be let go, which gives the name back and costs a little', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    keeper.moodOffset = 0;
    expect(releasePet(world, pet)).toBe(true);
    expect(isPet(pet)).toBe(false);
    expect(petName(pet)).toBe('Mossback');
    expect(keeper.moodOffset).toBeLessThan(0);
    tickPets(world);
    expect(keeper.petMood).toBe(0);
    // And the door swings the other way: they can take another one.
    const next = putTame(world, 'dunhare', keeper.x + 1, keeper.y);
    expect(bondPet(world, keeper, next)).toBe(true);
  });
});

// ---------------------------------------------------------------- experience

describe('a colonist and their animal', () => {
  it('the handler walks away from a taming with a friend', () => {
    const world = emptyRange();
    onlyWork(world, 'farm');
    pen(world, 4, 3);
    const farmer = livingColonists(world)[0]!;
    const deer = putAnimal(world, 'mossback', farmer.x + 3, farmer.y);
    markTamePawn(world, deer.id, true);
    const streams = makeStreams(world);
    stepWorldN(world, streams, 900);

    expect(deer.tame).toBe(true);
    // Nobody had to click anything else: whoever did the work has the animal.
    expect(isPet(deer)).toBe(true);
    const keeper = keeperOf(world, deer);
    expect(keeper).not.toBeNull();
    expect(petOf(world, keeper!)).toBe(deer);
    expect(world.messages.some((m) => m.text.includes(petName(deer)))).toBe(true);
  });

  it('follows them across open ground', () => {
    const world = emptyRange();
    const at = clearing(world, 16, 3);
    const keeper = livingColonists(world)[0]!;
    keeper.x = at.x + 1;
    keeper.y = at.y + 1;
    const pet = putTame(world, 'mossback', at.x + 14, at.y + 1);
    expect(bondPet(world, keeper, pet)).toBe(true);
    const opened = dist(pet.x, pet.y, keeper.x, keeper.y);
    expect(opened).toBeGreaterThan(PET_STRETCH);

    walkAnimals(world, 600);
    expect(dist(pet.x, pet.y, keeper.x, keeper.y)).toBeLessThan(PET_HEEL + 1);
  });

  it('comes through the door after them', () => {
    const world = emptyRange();
    const keeper = livingColonists(world)[0]!;
    // Everybody else out of the cabin, so the doorway is the pet's problem and
    // not a queue.
    for (const p of livingColonists(world)) {
      if (p === keeper) continue;
      p.x = CABIN.x0 - 12;
      p.y = CABIN.y0 - 12;
    }
    keeper.x = CABIN.doorX;
    keeper.y = CABIN.doorY - 3;

    const start = { x: CABIN.doorX, y: CABIN.doorY + 3 };
    expect(isWalkable(world, start.x, start.y)).toBe(true);
    const pet = putTame(world, 'dunhare', start.x, start.y);
    expect(bondPet(world, keeper, pet)).toBe(true);

    walkAnimals(world, 900);
    // Inside the four walls, which from out there is only reachable through the
    // one door on the south side.
    expect(pet.x).toBeGreaterThan(CABIN.x0);
    expect(pet.x).toBeLessThan(CABIN.x1);
    expect(pet.y).toBeGreaterThan(CABIN.y0);
    expect(pet.y).toBeLessThan(CABIN.y1);
    expect(dist(pet.x, pet.y, keeper.x, keeper.y)).toBeLessThan(PET_HEEL + 1);
  });

  it('the day it dies, the colony reads about it', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    const name = petName(pet);
    keeper.moodOffset = 0;
    const before = world.messages.length;

    pet.hp = 0;
    pet.dead = true;
    walkAnimals(world, 1);

    const said = world.messages.slice(before);
    const obit = said.find((m) => m.text.includes(name) && m.text.includes(keeper.name));
    expect(obit).toBeDefined();
    expect(obit!.kind).toBe('bad');
    expect(obit!.headline).toBe(true);
    // It is felt, and it is remembered.
    expect(keeper.moodOffset).toBeLessThan(0);
    expect((keeper.memories ?? []).some((m) => m.text === `lost ${name}`)).toBe(true);
  });

  it('is still theirs after a save and a load', () => {
    const world = emptyRange();
    const { keeper, pet } = pair(world);
    tickPets(world);
    const name = petName(pet);

    const round = deserialize(
      serialize(world, { mode: 'manager', possessedId: null, camera: { targetX: 0, targetY: 0, distance: 20, yaw: 0, pitch: 1 } }, 1, 0),
    );
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    const back = round.save.world;

    const loadedPet = back.pawns.find((p) => p.id === pet.id)!;
    const loadedKeeper = back.pawns.find((p) => p.id === keeper.id)!;
    expect(isPet(loadedPet)).toBe(true);
    expect(petName(loadedPet)).toBe(name);
    expect(keeperOf(back, loadedPet)).toBe(loadedKeeper);
    expect(petOf(back, loadedKeeper)).toBe(loadedPet);
    tickPets(back);
    expect(loadedKeeper.petMood).toBeCloseTo(PET_MOOD, 6);
  });
});
