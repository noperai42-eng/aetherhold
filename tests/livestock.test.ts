/**
 * Pens — the colony's third food supply, and the only one that grows on its own.
 *
 * Crops run on the season and hunting runs on the herd: both are supplies you
 * spend. Livestock is the one loop that pays back more than it took, so the tests
 * here are mostly about the ways it must NOT pay back — a herd that breeds past
 * its pen, or breeds from a single animal, or feeds a colony that never painted
 * anywhere to keep it, is a food problem the player no longer has to think about,
 * which is the same as the feature not existing.
 *
 * The two experience tests at the bottom are the ones that would have caught the
 * design errors this shipped with: an animal that stays wary while a handler
 * closes on it can never be tamed, and an animal that bolts when hurt can never be
 * slaughtered. Both are jobs that run to their timeout with nothing to show, and
 * neither shows up in a unit test of the pieces.
 */

import { describe, expect, it } from 'vitest';

import { buildingAt, dist, isWalkable } from '../src/sim/grid';
import {
  BREED_INTERVAL,
  CALF_YIELD,
  MATURE_TICKS,
  PEN_CELLS_PER_HEAD,
  TAME_WORK,
  animalSex,
  bodyScale,
  hasPen,
  inPen,
  isAdult,
  isTameable,
  livestock,
  maturity,
  penCapacity,
  penCells,
  penTarget,
} from '../src/sim/livestock';
import type { Sex } from '../src/sim/livestock';
import { markHuntPawn, markTame, markTamePawn, paintPenZone } from '../src/sim/orders';
import { Rng } from '../src/sim/rng';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import {
  ANIMALS,
  settleAnimal,
  tickBreeding,
  tickHerdHint,
  tickWildlife,
} from '../src/sim/wildlife';
import type { AnimalKind, Pawn, World } from '../src/sim/types';
import { TICKS_PER_DAY } from '../src/sim/types';
import { itemsAt, livingColonists } from '../src/sim/world';
import { createWorld, makePawn } from '../src/sim/worldgen';

/** A world with the wild herds cleared out, so a test places exactly what it means. */
function emptyRange(seed = 20260729): World {
  const world = createWorld(seed);
  world.pawns = world.pawns.filter((p) => p.faction !== 'fauna');
  return world;
}

/**
 * The bottom-left corner of a clear block of open ground.
 *
 * Hard-coding a corner would work today and break the first time worldgen moves a
 * tree, so the tests ask the map where there is room instead.
 */
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

/** One animal, already in the herd, standing where it is put. */
function putTame(world: World, kind: AnimalKind, x: number, y: number): Pawn {
  const beast = putAnimal(world, kind, x, y);
  beast.tame = true;
  return beast;
}

/**
 * A tame animal of the sex the test needs.
 *
 * Sex is derived from the id rather than stored, so a test cannot simply set it —
 * it has to keep asking for animals until one falls the right way, and throw the
 * rejects back off the map. Which is the honest thing anyway: it means these
 * tests exercise the same `animalSex` the game does rather than a field they
 * wrote themselves.
 */
function putSexed(world: World, kind: AnimalKind, sex: Sex, x: number, y: number): Pawn {
  for (let i = 0; i < 64; i++) {
    const beast = putTame(world, kind, x, y);
    if (animalSex(beast) === sex) return beast;
    world.pawns = world.pawns.filter((p) => p !== beast);
  }
  throw new Error(`no id in 64 tries was ${sex}`);
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

// ---------------------------------------------------------------- functional

describe('painting a pen', () => {
  it('starts empty and reads as a pen once painted', () => {
    const world = emptyRange();
    expect(hasPen(world)).toBe(false);
    const p = pen(world, 3, 3);
    expect(hasPen(world)).toBe(true);
    expect(penCells(world)).toHaveLength(9);
    expect(inPen(world, p.x, p.y)).toBe(true);
    expect(inPen(world, p.x - 1, p.y - 1)).toBe(false);
  });

  it('merges into one zone rather than one zone per cell', () => {
    const world = emptyRange();
    pen(world, 4, 2);
    expect(world.zones.filter((z) => z.kind === 'pen')).toHaveLength(1);
  });

  it('refuses ground nothing can stand on', () => {
    const world = emptyRange();
    // Every map has an edge, and the edge is out of bounds.
    expect(paintPenZone(world, -1, 4)).toBe(false);
    expect(hasPen(world)).toBe(false);
  });

  it('carries one head per six cells, rounded down', () => {
    const world = emptyRange();
    pen(world, 4, 3);
    expect(penCapacity(world)).toBe(Math.floor(12 / PEN_CELLS_PER_HEAD));
    expect(penCapacity(world)).toBe(2);
  });

  it('a pen too small to hold anything holds nothing', () => {
    const world = emptyRange();
    pen(world, 2, 2);
    expect(penCapacity(world)).toBe(0);
  });
});

describe('marking an animal', () => {
  it('needs a pen before anybody will go out to it', () => {
    const world = emptyRange();
    const deer = putAnimal(world, 'mossback', 20, 20);
    markTamePawn(world, deer.id, true);
    expect(deer.tameTarget).toBe(true);
    expect(isTameable(world, deer), 'nowhere to put it').toBe(false);
    pen(world, 3, 3);
    expect(isTameable(world, deer)).toBe(true);
  });

  it('taming an animal marked for the hunters calls the hunt off', () => {
    const world = emptyRange();
    const deer = putAnimal(world, 'mossback', 20, 20);
    markHuntPawn(world, deer.id, true);
    expect(deer.hunted).toBe(true);
    markTamePawn(world, deer.id, true);
    expect(deer.hunted, 'the player just gave the contradicting order').toBe(false);
    expect(deer.tameTarget).toBe(true);
  });

  it('will not re-mark something already in the herd', () => {
    const world = emptyRange();
    const goat = putTame(world, 'dunhare', 20, 20);
    expect(markTamePawn(world, goat.id, true)).toBe(false);
    expect(goat.tameTarget).not.toBe(true);
  });

  it('marks by cell the way the drag tool does, and never a settler', () => {
    const world = emptyRange();
    const deer = putAnimal(world, 'mossback', 22, 22);
    const settler = livingColonists(world)[0]!;
    expect(markTame(world, 22, 22, true)).toBe(1);
    expect(deer.tameTarget).toBe(true);
    expect(markTame(world, Math.round(settler.x), Math.round(settler.y), true)).toBe(0);
    expect(settler.tameTarget).toBeUndefined();
  });

  it('settling clears every other mark it was carrying', () => {
    const world = emptyRange();
    const deer = putAnimal(world, 'mossback', 20, 20);
    deer.tameTarget = true;
    deer.fleeUntil = world.tick + 200;
    settleAnimal(world, deer);
    expect(deer.tame).toBe(true);
    expect(deer.tameTarget).toBe(false);
    expect(deer.hunted).toBe(false);
    expect(deer.fleeUntil).toBe(0);
    expect(livestock(world)).toHaveLength(1);
  });
});

describe('the pen holds what is in it', () => {
  it('leashes livestock that wandered out, and leaves everything else alone', () => {
    const world = emptyRange();
    const p = pen(world, 3, 3);
    const inside = putTame(world, 'mossback', p.x + 1, p.y + 1);
    const strayed = putTame(world, 'mossback', p.x + 9, p.y + 9);
    const wild = putAnimal(world, 'mossback', p.x + 9, p.y + 9);
    expect(penTarget(world, inside), 'already home').toBeNull();
    expect(penTarget(world, wild), 'not ours to move').toBeNull();
    const home = penTarget(world, strayed);
    expect(home).not.toBeNull();
    expect(inPen(world, home!.x, home!.y)).toBe(true);
  });

  it('a strayed animal actually walks back', () => {
    const world = emptyRange();
    const p = pen(world, 4, 4);
    const strayed = putTame(world, 'mossback', p.x + 8, p.y + 8);
    const before = dist(strayed.x, strayed.y, p.x + 1.5, p.y + 1.5);
    const rng = new Rng(4);
    for (let i = 0; i < 400; i++) tickWildlife(world, rng);
    const after = dist(strayed.x, strayed.y, p.x + 1.5, p.y + 1.5);
    expect(after).toBeLessThan(before);
    expect(inPen(world, strayed.x, strayed.y), 'and it gets there').toBe(true);
  });

  it('with no pen at all, livestock simply graze free', () => {
    const world = emptyRange();
    const goat = putTame(world, 'dunhare', 20, 20);
    expect(penTarget(world, goat)).toBeNull();
  });
});

describe('breeding', () => {
  /** Roll the breeding check often enough that a 1-in-BREED_INTERVAL chance lands. */
  function breedFor(world: World, ticks: number): void {
    const rng = new Rng(7);
    for (let i = 0; i < ticks; i++) tickBreeding(world, rng);
  }

  it('a pair in a pen with room produces a calf', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3); // 18 cells: room for three head, two standing in it
    putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1);
    putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1);
    breedFor(world, BREED_INTERVAL * 6);
    expect(livestock(world).length).toBeGreaterThan(2);
    expect(livestock(world).every((a) => a.tame === true)).toBe(true);
  });

  it('one animal on its own never breeds', () => {
    const world = emptyRange();
    const p = pen(world, 4, 3);
    putTame(world, 'mossback', p.x + 1, p.y + 1);
    breedFor(world, BREED_INTERVAL * 8);
    expect(livestock(world)).toHaveLength(1);
  });

  it('two different species in one pen never breed', () => {
    const world = emptyRange();
    // Room for three, so a failure here is the species check and not the cap.
    const p = pen(world, 6, 3);
    putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1);
    putSexed(world, 'dunhare', 'm', p.x + 2, p.y + 1);
    breedFor(world, BREED_INTERVAL * 8);
    expect(livestock(world)).toHaveLength(2);
  });

  it('stops at the pen it has, so a herd cannot outgrow its ground', () => {
    const world = emptyRange();
    const p = pen(world, 4, 3); // capacity 2
    putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1);
    putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1);
    breedFor(world, BREED_INTERVAL * 40);
    expect(penCapacity(world)).toBe(2);
    expect(livestock(world)).toHaveLength(2);
  });

  it('animals standing outside the pen do not breed in it', () => {
    const world = emptyRange();
    // Room for three, so a failure here is the "standing in it" check, not the cap.
    const p = pen(world, 6, 3);
    const a = putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1);
    const b = putSexed(world, 'mossback', 'm', p.x + 20, p.y);
    expect(a.tame && b.tame).toBe(true);
    breedFor(world, BREED_INTERVAL * 8);
    expect(livestock(world)).toHaveLength(2);
  });

  it('a herd with no pen at all does not multiply', () => {
    const world = emptyRange();
    putSexed(world, 'mossback', 'f', 20, 20);
    putSexed(world, 'mossback', 'm', 21, 20);
    breedFor(world, BREED_INTERVAL * 8);
    expect(livestock(world)).toHaveLength(2);
  });
});

describe('sex', () => {
  it('is the same answer every time it is asked', () => {
    const world = emptyRange();
    const beast = putTame(world, 'mossback', 20, 20);
    const first = animalSex(beast);
    for (let i = 0; i < 50; i++) expect(animalSex(beast)).toBe(first);
  });

  it('splits about evenly across the ids a long colony hands out', () => {
    let females = 0;
    for (let id = 1; id <= 4000; id++) {
      if (animalSex({ id } as Pawn) === 'f') females++;
    }
    // A pen is two or three head, so a 60/40 world would be a game where the
    // player's first pair is routinely barren for reasons they cannot see.
    expect(females).toBeGreaterThan(1700);
    expect(females).toBeLessThan(2300);
  });

  it('is not the low bit of the id, which would make every pair fertile', () => {
    // Ids are handed out in sequence. `id & 1` splits perfectly evenly and is
    // still wrong: it alternates, so any two animals tamed one after the other
    // would always be a breeding pair and the sex would never once cost anybody
    // anything. What we want is a coin, and a coin repeats about half the time.
    let same = 0;
    for (let id = 1; id < 400; id++) {
      if (animalSex({ id } as Pawn) === animalSex({ id: id + 1 } as Pawn)) same++;
    }
    expect(same).toBeGreaterThan(120);
  });
});

describe('growing up', () => {
  it('anything without a birthday was already grown when we met it', () => {
    const world = emptyRange();
    const wild = putAnimal(world, 'mossback', 20, 20);
    expect(wild.born).toBeUndefined();
    expect(maturity(world, wild)).toBe(1);
    expect(isAdult(world, wild)).toBe(true);
    expect(bodyScale(world, wild)).toBe(1);
  });

  it('runs from nothing at birth to grown three days later', () => {
    const world = emptyRange();
    const calf = putTame(world, 'mossback', 20, 20);
    calf.born = world.tick;
    expect(maturity(world, calf)).toBe(0);
    expect(isAdult(world, calf)).toBe(false);
    world.tick += MATURE_TICKS / 2;
    expect(maturity(world, calf)).toBeCloseTo(0.5, 6);
    expect(isAdult(world, calf)).toBe(false);
    world.tick += MATURE_TICKS / 2;
    expect(maturity(world, calf), 'grown on the tick, not the tick after').toBe(1);
    expect(isAdult(world, calf)).toBe(true);
    world.tick += MATURE_TICKS * 10;
    expect(maturity(world, calf), 'and never more than grown').toBe(1);
  });

  it('is worth a quarter of a body at birth and a whole one grown', () => {
    const world = emptyRange();
    const calf = putTame(world, 'mossback', 20, 20);
    calf.born = world.tick;
    expect(bodyScale(world, calf)).toBe(CALF_YIELD);
    world.tick += MATURE_TICKS;
    expect(bodyScale(world, calf)).toBe(1);
  });
});

// ---------------------------------------------------------------- experience

describe('a colony that keeps animals', () => {
  it('sends a farmer out, and the animal is in the herd when they are done', () => {
    const world = emptyRange();
    onlyWork(world, 'farm');
    pen(world, 4, 3);
    const farmer = livingColonists(world)[0]!;
    const deer = putAnimal(world, 'mossback', farmer.x + 3, farmer.y);
    markTamePawn(world, deer.id, true);

    const streams = makeStreams(world);
    stepWorldN(world, streams, 900);

    expect(deer.dead, 'nobody was supposed to shoot it').toBe(false);
    expect(deer.tame).toBe(true);
    expect(livestock(world)).toHaveLength(1);
  });

  it('a handler can close on the animal at all — it does not back away forever', () => {
    const world = emptyRange();
    pen(world, 4, 3);
    const farmer = livingColonists(world)[0]!;
    const deer = putAnimal(world, 'mossback', farmer.x + 5, farmer.y + 5);
    markTamePawn(world, deer.id, true);
    const rng = new Rng(9);
    const before = dist(farmer.x, farmer.y, deer.x, deer.y);
    // The animal moving on its own, with the person standing still: wariness would
    // have opened this gap, which is what made the job unfinishable.
    for (let i = 0; i < 200; i++) tickWildlife(world, rng);
    expect(dist(farmer.x, farmer.y, deer.x, deer.y)).toBeLessThanOrEqual(before + 0.5);
  });

  it('taming takes real work, not a lucky roll', () => {
    const world = emptyRange();
    onlyWork(world, 'farm');
    pen(world, 4, 3);
    const farmer = livingColonists(world)[0]!;
    const deer = putAnimal(world, 'mossback', farmer.x + 1.2, farmer.y);
    markTamePawn(world, deer.id, true);

    const streams = makeStreams(world);
    // Standing right next to it, a fraction of the work in: still wild.
    stepWorldN(world, streams, Math.floor(TAME_WORK / 4));
    expect(deer.tame).not.toBe(true);
    stepWorldN(world, streams, TAME_WORK * 3);
    expect(deer.tame).toBe(true);
  });

  it('a gunshot loses the work: a frightened animal cannot be talked round', () => {
    const world = emptyRange();
    onlyWork(world, 'farm');
    pen(world, 4, 3);
    const farmer = livingColonists(world)[0]!;
    const deer = putAnimal(world, 'mossback', farmer.x + 1.2, farmer.y);
    markTamePawn(world, deer.id, true);

    const streams = makeStreams(world);
    stepWorldN(world, streams, 40);
    expect(world.jobs.some((j) => j.kind === 'tame')).toBe(true);
    deer.fleeUntil = world.tick + 200;
    stepWorldN(world, streams, 5);
    expect(world.jobs.some((j) => j.kind === 'tame'), 'the job is dropped').toBe(false);
    expect(deer.tame).not.toBe(true);
  });

  it('livestock can be slaughtered by hand — no rifle needed', () => {
    const world = emptyRange();
    onlyWork(world, 'hunt');
    const p = pen(world, 4, 3);
    const butcher = livingColonists(world)[0]!;
    butcher.x = p.x + 3;
    butcher.y = p.y + 3;
    butcher.weapon = 'club';
    for (const c of livingColonists(world)) if (c.id !== butcher.id) c.priorities.hunt = 0;
    const goat = putTame(world, 'dunhare', p.x + 1, p.y + 1);
    markHuntPawn(world, goat.id, true);

    const streams = makeStreams(world);
    stepWorldN(world, streams, 900);

    expect(goat.dead || !world.pawns.some((q) => q.id === goat.id)).toBe(true);
    // The meat is on the ground where it fell, through the same path a hunt uses.
    let meat = 0;
    for (let y = p.y - 2; y < p.y + p.h + 2; y++) {
      for (let x = p.x - 2; x < p.x + p.w + 2; x++) {
        for (const s of itemsAt(world, x, y)) if (s.kind === 'rawfood') meat += s.amount;
      }
    }
    expect(meat).toBeGreaterThan(0);
  });

  it('nobody hunts the herd off their own back', () => {
    const world = emptyRange();
    onlyWork(world, 'hunt');
    const p = pen(world, 4, 3);
    const goat = putTame(world, 'dunhare', p.x + 1, p.y + 1);
    const streams = makeStreams(world);
    stepWorldN(world, streams, 600);
    expect(goat.dead).toBe(false);
    expect(world.jobs.some((j) => j.kind === 'hunt')).toBe(false);
  });
});

describe('a herd that will not grow', () => {
  /** Breed with the clock actually running, so calves can grow up mid-test. */
  function breedDays(world: World, ticks: number): void {
    const rng = new Rng(7);
    for (let i = 0; i < ticks; i++) {
      world.tick++;
      tickBreeding(world, rng);
    }
  }

  it('two of the same sex are a pen that never pays', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3); // room for three
    putSexed(world, 'mossback', 'm', p.x + 1, p.y + 1);
    putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1);
    breedDays(world, BREED_INTERVAL * 10);
    expect(livestock(world)).toHaveLength(2);
  });

  it('says so, once, rather than leaving the player to wonder', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3);
    putSexed(world, 'mossback', 'm', p.x + 1, p.y + 1);
    putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1);

    const said = (): number =>
      world.messages.filter((m) => m.text.includes('no calves')).length;
    tickHerdHint(world);
    expect(said(), 'not the instant they are penned').toBe(0);
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.tick++;
      tickHerdHint(world);
    }
    expect(said(), 'once in the first day').toBe(1);
    expect(world.messages.some((m) => m.text.includes('female'))).toBe(true);
    // And not again every tick for the rest of the colony.
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.tick++;
      tickHerdHint(world);
    }
    expect(said()).toBe(2);
  });

  it('goes quiet the moment a female joins them', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3);
    putSexed(world, 'mossback', 'm', p.x + 1, p.y + 1);
    putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1);
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      world.tick++;
      tickHerdHint(world);
    }
    const before = world.messages.length;
    putSexed(world, 'mossback', 'f', p.x + 3, p.y + 1);
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) {
      world.tick++;
      tickHerdHint(world);
    }
    expect(world.messages).toHaveLength(before);
  });

  it('a calf is not a breeding animal until it is grown', () => {
    const world = emptyRange();
    const p = pen(world, 6, 3); // room for three
    putSexed(world, 'mossback', 'f', p.x + 1, p.y + 1);
    const calf = putSexed(world, 'mossback', 'm', p.x + 2, p.y + 1);
    calf.born = world.tick;
    // Longer than the breeding interval, so a grown pair would have calved twice
    // over — the only thing holding the herd at two is the sire being a calf.
    breedDays(world, MATURE_TICKS - 2);
    expect(livestock(world)).toHaveLength(2);
    breedDays(world, BREED_INTERVAL * 8);
    expect(livestock(world).length).toBeGreaterThan(2);
  });
});

describe('what a body is worth', () => {
  it('a calf taken the day it is born is a quarter of a mossback', () => {
    const world = emptyRange();
    const grown = putTame(world, 'mossback', 20, 20);
    const calf = putTame(world, 'mossback', 30, 30);
    calf.born = world.tick;
    grown.dead = true;
    calf.dead = true;
    tickWildlife(world, new Rng(3));

    const meatAt = (x: number, y: number): number => {
      let n = 0;
      for (const s of itemsAt(world, x, y)) if (s.kind === 'rawfood') n += s.amount;
      return n;
    };
    const whole = meatAt(20, 20);
    const quarter = meatAt(30, 30);
    expect(whole).toBe(ANIMALS.mossback.meat);
    expect(quarter).toBe(Math.round(ANIMALS.mossback.meat * CALF_YIELD));
    expect(quarter).toBeLessThan(whole);
    // Never nothing, though: a body on the ground that yields zero food reads as
    // the butchering being broken rather than as a lesson about waiting.
    expect(quarter).toBeGreaterThan(0);
  });

  it('and is worth the whole animal once it has grown', () => {
    const world = emptyRange();
    const calf = putTame(world, 'mossback', 30, 30);
    calf.born = world.tick;
    world.tick += MATURE_TICKS;
    calf.dead = true;
    tickWildlife(world, new Rng(3));
    let meat = 0;
    for (const s of itemsAt(world, 30, 30)) if (s.kind === 'rawfood') meat += s.amount;
    expect(meat).toBe(ANIMALS.mossback.meat);
  });
});
