/**
 * Animals get old, and then they stop.
 *
 * The pen used to be a machine with no moving parts: tame a pair, paint enough
 * ground, and the herd grew forever off two animals that were exactly as good on
 * day two hundred as on day one. A lifespan is what turns that into husbandry —
 * the pair you started with runs out, and the only thing that carries the herd
 * past them is the calves you kept instead of eating.
 *
 * Two things here are load-bearing and neither is obvious from the code. Old age
 * must not feed anybody: a beast that died of itself leaves a hide and nothing
 * else, or "let them all die of old age" becomes a free meat schedule with no
 * work in it. And a wild animal must go quietly — scattering full carcasses
 * across the moor every time a hare turned three would make the wilderness a
 * pantry a colony could walk out and find, which is the opposite of hunting.
 *
 * The experience tests at the bottom are the ones that would have caught the two
 * design errors this shipped with: a pen that silently stops paying with nothing
 * on any panel to say why, and a bonded companion getting two death notices.
 */

import { describe, expect, it } from 'vitest';

import { buildingAt, isWalkable } from '../src/sim/grid';
import { BREED_INTERVAL, MATURE_TICKS, animalSex, isAdult, livestock } from '../src/sim/livestock';
import type { Sex } from '../src/sim/livestock';
import { paintPenZone } from '../src/sim/orders';
import { bondPet, petName } from '../src/sim/pets';
import { Rng } from '../src/sim/rng';
import type { AnimalKind, Pawn, World } from '../src/sim/types';
import { TICKS_PER_DAY } from '../src/sim/types';
import {
  ANIMALS,
  ARRIVES_AGED,
  BREEDS_UNTIL,
  ageOf,
  canBreed,
  lifeStage,
  spawnAnimal,
  tickBreeding,
  tickHerdHint,
  tickWildlife,
} from '../src/sim/wildlife';
import { livingColonists } from '../src/sim/world';
import { createWorld, makePawn } from '../src/sim/worldgen';

/** A world with the wild herds cleared out, so a test places exactly what it means. */
function emptyRange(seed = 20260729): World {
  const world = createWorld(seed);
  world.pawns = world.pawns.filter((p) => p.faction !== 'fauna');
  return world;
}

/** The bottom-left corner of a clear block of open ground. */
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

/** Paint a rectangular pen and hand back its cells. */
function pen(world: World, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const at = clearing(world, w, h);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      expect(paintPenZone(world, at.x + dx, at.y + dy)).toBe(true);
    }
  }
  return { ...at, w, h };
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

/** A tame animal of the sex the test needs — sex is derived from the id, not stored. */
function putSexed(world: World, kind: AnimalKind, sex: Sex, x: number, y: number): Pawn {
  for (let i = 0; i < 64; i++) {
    const beast = putTame(world, kind, x, y);
    if (animalSex(beast) === sex) return beast;
    world.pawns = world.pawns.filter((p) => p !== beast);
  }
  throw new Error(`no id in 64 tries was ${sex}`);
}

/** Back-date a birthday so an animal is however many ticks old the test needs. */
function ageTo(world: World, animal: Pawn, ticks: number): Pawn {
  animal.born = world.tick - ticks;
  return animal;
}

/**
 * Everything of one kind loose on the ground, anywhere on the map.
 *
 * Read as a difference across the thing being tested, never as an absolute — the
 * colony lands with a food pile already on the grass, so "is there raw food on
 * the map" is true before any animal has died.
 */
function onGround(world: World, kind: string): number {
  let n = 0;
  for (const s of world.items) if (s.carriedBy === null && s.kind === kind) n += s.amount;
  return n;
}

function said(world: World, text: string): number {
  return world.messages.filter((m) => m.text.includes(text)).length;
}

function wildDays(world: World, ticks: number, seed = 11): void {
  const rng = new Rng(seed);
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickWildlife(world, rng);
  }
}

function breedDays(world: World, ticks: number): void {
  const rng = new Rng(7);
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickBreeding(world, rng);
  }
}

const KINDS: AnimalKind[] = ['mossback', 'dunhare', 'fenwolf'];

describe('a life has a length', () => {
  it('every species has one, measured in game years', () => {
    for (const kind of KINDS) {
      // A year here is twenty days. Anything under one is an animal that dies
      // before a player could plausibly notice it existed.
      expect(ANIMALS[kind].life, kind).toBeGreaterThan(TICKS_PER_DAY * 20);
    }
  });

  it('an animal with no birthday reads as newly grown, not newborn and not old', () => {
    // Which is what every animal in a save written before this existed looks like.
    // Reading them as newborn would freeze a whole herd back into calves; reading
    // them as aged would kill the player's entire pen on the tick they loaded.
    const world = emptyRange();
    const beast = putTame(world, 'mossback', 30, 30);
    expect(beast.born).toBeUndefined();
    expect(ageOf(world, beast)).toBe(MATURE_TICKS);
    expect(isAdult(world, beast)).toBe(true);
    expect(lifeStage(world, beast)).toBe('prime');
  });

  it('the stages run calf, prime, old, and breeding covers only the middle one', () => {
    const world = emptyRange();
    const life = ANIMALS.mossback.life;
    const beast = putTame(world, 'mossback', 30, 30);

    ageTo(world, beast, MATURE_TICKS - 1);
    expect(lifeStage(world, beast)).toBe('calf');
    expect(canBreed(world, beast)).toBe(false);

    ageTo(world, beast, MATURE_TICKS);
    expect(lifeStage(world, beast), 'grown on the tick, not the tick after').toBe('prime');
    expect(canBreed(world, beast)).toBe(true);

    ageTo(world, beast, Math.ceil(life * BREEDS_UNTIL) - 1);
    expect(lifeStage(world, beast)).toBe('prime');

    ageTo(world, beast, Math.ceil(life * BREEDS_UNTIL));
    expect(lifeStage(world, beast)).toBe('old');
    expect(canBreed(world, beast), 'past it, and still alive for a while yet').toBe(false);
  });

  it('an animal that walks onto the map is never a calf and never about to drop', () => {
    // The whole early game rests on this. If arrivals could be spawned old, the
    // player's first hunt would sometimes yield a hide and nothing else, for
    // reasons nothing on the screen could explain.
    const world = emptyRange();
    const rng = new Rng(99);
    for (const kind of KINDS) {
      for (let i = 0; i < 24; i++) {
        const beast = spawnAnimal(world, rng, kind, 30 + (i % 8), 30);
        expect(beast, kind).not.toBeNull();
        expect(lifeStage(world, beast!), `${kind} #${i}`).toBe('prime');
        expect(ageOf(world, beast!)).toBeGreaterThanOrEqual(MATURE_TICKS);
        expect(ageOf(world, beast!)).toBeLessThan(
          MATURE_TICKS + ANIMALS[kind].life * ARRIVES_AGED,
        );
      }
    }
  });

  it('and the arrivals are spread across their years rather than all one age', () => {
    const world = emptyRange();
    const rng = new Rng(4);
    const ages: number[] = [];
    for (let i = 0; i < 60; i++) {
      const beast = spawnAnimal(world, rng, 'mossback', 30 + (i % 10), 30 + ((i / 10) | 0));
      if (beast) ages.push(ageOf(world, beast));
    }
    const span = ANIMALS.mossback.life * ARRIVES_AGED;
    expect(Math.min(...ages)).toBeLessThan(MATURE_TICKS + span * 0.25);
    expect(Math.max(...ages)).toBeGreaterThan(MATURE_TICKS + span * 0.75);
  });

  it('and age is not a function of sex — the two hashes are independent', () => {
    // Sharing a hash would make every male on the map the older one, which is the
    // kind of pattern a player notices long before anybody finds the bug.
    const world = emptyRange();
    const rng = new Rng(5);
    const bySex: Record<Sex, number[]> = { m: [], f: [] };
    for (let i = 0; i < 120; i++) {
      const beast = spawnAnimal(world, rng, 'mossback', 30 + (i % 10), 30 + ((i / 10) | 0));
      if (beast) bySex[animalSex(beast)].push(ageOf(world, beast) - MATURE_TICKS);
    }
    const span = ANIMALS.mossback.life * ARRIVES_AGED;
    for (const sex of ['m', 'f'] as Sex[]) {
      expect(bySex[sex].length, sex).toBeGreaterThan(20);
      expect(Math.min(...bySex[sex]), `young ${sex}`).toBeLessThan(span * 0.3);
      expect(Math.max(...bySex[sex]), `old ${sex}`).toBeGreaterThan(span * 0.7);
    }
  });
});

describe('old age in the pen', () => {
  it('kills the animal where the player can see it, and says what it cost', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3);
    const beast = putTame(world, 'mossback', p.x + 1, p.y + 1);
    ageTo(world, beast, ANIMALS.mossback.life);

    wildDays(world, 2);
    expect(world.pawns.some((a) => a.id === beast.id), 'body cleared').toBe(false);
    expect(said(world, 'Old age takes')).toBe(1);
  });

  it('and leaves a hide, and no meat at all', () => {
    // The entire cost of having left it too long. Without this, old age is a
    // slaughter that happens on its own and the pen never needs managing.
    const world = emptyRange();
    const p = pen(world, 6, 3);
    ageTo(world, putTame(world, 'mossback', p.x + 1, p.y + 1), ANIMALS.mossback.life);
    const food = onGround(world, 'rawfood');
    const hides = onGround(world, 'hide');

    wildDays(world, 2);
    expect(
      onGround(world, 'rawfood') - food,
      'nobody eats a beast that died of itself',
    ).toBe(0);
    expect(onGround(world, 'hide') - hides).toBeGreaterThan(0);
    // And not a second line reading "0 raw food", which is what the kill message
    // would have said if it had been left to fire on this path.
    expect(said(world, 'raw food and')).toBe(0);
  });

  it('a slaughtered animal of the same age still feeds the colony', () => {
    // The control for the test above: it is dying of itself that costs the meat,
    // not being old. Otherwise the rule would read as "old animals are worthless"
    // and the correct play would be to kill everything at three days.
    const world = emptyRange();
    const p = pen(world, 6, 3);
    const beast = putTame(world, 'mossback', p.x + 1, p.y + 1);
    ageTo(world, beast, ANIMALS.mossback.life - 10);
    beast.dead = true;
    const food = onGround(world, 'rawfood');

    wildDays(world, 1);
    expect(onGround(world, 'rawfood') - food).toBe(ANIMALS.mossback.meat);
    expect(said(world, 'raw food and')).toBe(1);
  });

  it('a companion gets one goodbye, not two', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3);
    const beast = putTame(world, 'mossback', p.x + 1, p.y + 1);
    const keeper = livingColonists(world)[0]!;
    expect(bondPet(world, keeper, beast)).toBe(true);
    const name = petName(beast);
    ageTo(world, beast, ANIMALS.mossback.life);

    wildDays(world, 2);
    expect(said(world, `${name} is dead`), 'the one that mentions the person').toBe(1);
    expect(said(world, 'Old age takes'), 'and not the livestock line as well').toBe(0);
  });
});

describe('old age out on the moor', () => {
  it('is not a windfall — the animal is simply gone', () => {
    const world = emptyRange();
    const beast = putAnimal(world, 'dunhare', 30, 30);
    ageTo(world, beast, ANIMALS.dunhare.life);
    const food = onGround(world, 'rawfood');
    const hides = onGround(world, 'hide');

    wildDays(world, 1);
    expect(world.pawns.some((a) => a.id === beast.id)).toBe(false);
    expect(onGround(world, 'rawfood') - food, 'the moor is not a pantry').toBe(0);
    expect(onGround(world, 'hide') - hides).toBe(0);
  });

  it('and it does not fire the line that belongs to a herd leaving', () => {
    // Different lists on purpose: a hare somewhere turning old must not report an
    // event — the migration ending — that did not happen.
    const world = emptyRange();
    for (let i = 0; i < 4; i++) {
      ageTo(world, putAnimal(world, 'dunhare', 30 + i, 30), ANIMALS.dunhare.life);
    }
    wildDays(world, 2);
    expect(said(world, 'passes out of the valley')).toBe(0);
    expect(said(world, 'Old age takes'), 'nor the pen line, for animals nobody owned').toBe(0);
  });

  it('and an animal in its prime is not touched by any of it', () => {
    const world = emptyRange();
    const beast = putAnimal(world, 'mossback', 30, 30);
    wildDays(world, TICKS_PER_DAY);
    expect(world.pawns.some((a) => a.id === beast.id)).toBe(true);
    expect(beast.born, 'given the birthday it must have had').toBeDefined();
    expect(lifeStage(world, beast)).toBe('prime');
  });
});

describe('a herd has to replace itself', () => {
  it('a pair past their years never calves again', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3); // room for three
    const life = ANIMALS.mossback.life;
    ageTo(world, putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1), Math.ceil(life * BREEDS_UNTIL));
    ageTo(world, putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1), Math.ceil(life * BREEDS_UNTIL));

    breedDays(world, BREED_INTERVAL * 10);
    expect(livestock(world)).toHaveLength(2);
  });

  it('and the pen says why, rather than quietly paying nothing', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3);
    const life = ANIMALS.mossback.life;
    ageTo(world, putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1), Math.ceil(life * BREEDS_UNTIL));
    ageTo(world, putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1), Math.ceil(life * BREEDS_UNTIL));

    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.tick++;
      tickHerdHint(world);
    }
    expect(said(world, 'past breeding')).toBe(1);
    // And not the sex line, which would send the player off to tame the wrong
    // animal — they have a bull and a cow, and neither is the problem.
    expect(said(world, 'is male')).toBe(0);
    expect(said(world, 'is female')).toBe(0);
  });

  it('and names the half that is missing when only one of them is past it', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3);
    ageTo(
      world,
      putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1),
      Math.ceil(ANIMALS.mossback.life * BREEDS_UNTIL),
    );
    putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1);

    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.tick++;
      tickHerdHint(world);
    }
    expect(said(world, 'No female mossback in the pen is young enough')).toBe(1);
  });

  it('a herd that kept its calves outlives the pair that started it', () => {
    // The whole point of the feature in one test: the founders run out, and what
    // carries the colony past them is the calf it did not eat.
    const world = emptyRange();
    const p = pen(world, 8, 4); // room for five
    const dam = putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1);
    const sire = putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1);

    breedDays(world, BREED_INTERVAL * 8);
    const calves = livestock(world).filter((a) => a.id !== dam.id && a.id !== sire.id);
    expect(calves.length, 'the pair bred while they could').toBeGreaterThan(0);

    ageTo(world, dam, ANIMALS.mossback.life);
    ageTo(world, sire, ANIMALS.mossback.life);
    wildDays(world, 2);

    expect(world.pawns.some((a) => a.id === dam.id || a.id === sire.id)).toBe(false);
    expect(livestock(world).length, 'the herd goes on').toBeGreaterThan(0);
  });
});
