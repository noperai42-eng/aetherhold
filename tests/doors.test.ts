/**
 * The pen that holds: a door is a wall to anything that cannot work a latch.
 *
 * For most of this game's life a door was `solid: false` and that was the end of
 * it, so anything with legs walked through one. It made the two systems either
 * side of it quietly worthless. A walled, gated pen was worth exactly as much
 * against a fenwolf as an open field — the only answer to a pack was a settler
 * with a rifle and a spare afternoon — and a grazing mossback could let itself
 * into somebody's bedroom, which is the sort of thing a player sees once and
 * stops trusting the rest of the simulation over.
 *
 * The rule is one line on the single solidity gate, and the reason it is *there*
 * rather than in the animal code is the promise `grid.ts` makes: a route, a pair
 * of legs, the collision capsule the player is standing in and every raider's
 * approach all get the same answer about the same cell on the same tick. So the
 * functional half of this file is mostly about the two halves agreeing — that
 * what A\* refuses to route through, collision also refuses to walk through, and
 * that the door on screen does not swing open for something the grid is about to
 * stop. A wolf that pathed round a gate and then slid through it anyway would be
 * a lie the player can watch happening.
 *
 * The experience half is the thing the player actually built it for: put a goat
 * in a walled pen, hang a gate, and send wolves at it. And the control that makes
 * that claim mean anything — leave one cell of the wall out, and they get in.
 */

import { describe, expect, it } from 'vitest';

import { tickMaulings } from '../src/sim/combat';
import { startPredatorPack } from '../src/sim/encounters';
import { buildingAt, canStep, isDoor, isSolid, isWalkable, nearestWalkable } from '../src/sim/grid';
import { moveWithCollision, opensDoors, tickDoors } from '../src/sim/movement';
import { findPath } from '../src/sim/path';
import { bondPet, tickPets } from '../src/sim/pets';
import { tickAlarm, tickPackLeaving } from '../src/sim/predators';
import { Rng } from '../src/sim/rng';
import { TRAP_DAMAGE_MIN, tickTraps } from '../src/sim/traps';
import type { AnimalKind, Building, Pawn, World } from '../src/sim/types';
import { unpackX, unpackY } from '../src/sim/types';
import { ANIMALS, tickWildlife } from '../src/sim/wildlife';
import { addBuilding, livingColonists } from '../src/sim/world';
import { CABIN, createWorld, makePawn } from '../src/sim/worldgen';

/** A world with the wild herds cleared out, so a test places exactly what it means. */
function emptyRange(seed = 20260729): World {
  const world = createWorld(seed);
  world.pawns = world.pawns.filter((p) => p.faction !== 'fauna');
  return world;
}

/** The bottom-left corner of a clear block of open ground — see `predators.test.ts`. */
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
 * A walled square with one gate in the middle of its south side.
 *
 * Returns the gate cell, the middle of the floor, and a cell of open ground in
 * front of the gate, because every test below wants those three: something
 * stands inside, something else stands outside, and the only way between them is
 * the door. `gap` leaves one wall cell out on the north side — that is the
 * control, and the only difference between the pen that holds and the pen that
 * does not.
 *
 * The clearing is asked for three rows taller than the pen and the pen is set at
 * the top of it, so the approach in front of the gate is guaranteed open ground.
 * Without that margin the pen lands hard against the edge of the map and the
 * "outside" cell is border rock, which does not fail as a wrong answer — it fails
 * as no route and as bodies teleporting out of the geometry they started in.
 */
function walledPen(
  world: World,
  w: number,
  h: number,
  opts: { gap?: boolean } = {},
): {
  gate: { x: number; y: number };
  inside: { x: number; y: number };
  outside: { x: number; y: number };
} {
  const at = clearing(world, w + 2, h + 5);
  const x0 = at.x;
  const y0 = at.y + 3;
  const x1 = x0 + w + 1;
  const y1 = y0 + h + 1;
  const gate = { x: x0 + Math.floor((w + 1) / 2), y: y0 };
  const hole = { x: x0 + Math.floor((w + 1) / 2), y: y1 };
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      if (x === gate.x && y === gate.y) continue;
      if (opts.gap && x === hole.x && y === hole.y) continue;
      expect(addBuilding(world, 'wall', x, y, true)).not.toBeNull();
    }
  }
  expect(addBuilding(world, 'door', gate.x, gate.y, true)).not.toBeNull();
  return {
    gate,
    inside: { x: x0 + Math.floor((w + 1) / 2), y: y0 + Math.floor((h + 1) / 2) },
    outside: { x: gate.x, y: gate.y - 2 },
  };
}

/** Run the animals only — see the note in `predators.test.ts`. */
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

/** Open ground as far from anything `clearing` will hand out as the map allows. */
function farCorner(world: World): { x: number; y: number } {
  return (
    nearestWalkable(world, world.width - 4, world.height - 4, 20) ?? {
      x: world.width - 4,
      y: world.height - 4,
    }
  );
}

/**
 * Everybody out of the way, so nothing wanders into the middle of the test.
 *
 * "Out of the way" is the far corner of the valley rather than a fixed cell, and
 * that is a scar. It was (6,6) for as long as (6,6) was rim rock nobody could be
 * handed; the map grew, the rim moved out, and (6,6) became ordinary open ground —
 * which is to say the first ground `clearing` hands out. So the yard was being
 * cleared *into* the test: a settler stood one cell from the door the next line
 * was about to prove nothing was standing at, the door swung for them, and the
 * failure read as the door rule being broken. `clearing` searches up from the low
 * corner, so the opposite corner is the one place it will never return.
 */
function clearTheYard(world: World, except?: Pawn): void {
  const away = farCorner(world);
  for (const p of livingColonists(world)) {
    if (except && p.id === except.id) continue;
    p.x = away.x;
    p.y = away.y;
    p.path = null;
  }
}

describe('what a door is, and to whom', () => {
  it('knows a finished door from a blueprint and from a wall', () => {
    const world = emptyRange();
    const at = clearing(world, 4, 4);
    addBuilding(world, 'door', at.x, at.y, true);
    addBuilding(world, 'door', at.x + 1, at.y, false);
    addBuilding(world, 'wall', at.x + 2, at.y, true);
    expect(isDoor(world, at.x, at.y)).toBe(true);
    // A blueprint is not a door yet. Settlers have to be able to stand where they
    // build, and until the frame is up there is nothing there to stop anything.
    expect(isDoor(world, at.x + 1, at.y)).toBe(false);
    expect(isDoor(world, at.x + 2, at.y)).toBe(false);
  });

  it('is a hole to anything with hands and a wall to anything without', () => {
    const world = emptyRange();
    const at = clearing(world, 4, 4);
    addBuilding(world, 'door', at.x, at.y, true);
    expect(isSolid(world, at.x, at.y)).toBe(false);
    expect(isSolid(world, at.x, at.y, false)).toBe(true);
    expect(isWalkable(world, at.x, at.y, false)).toBe(false);
  });

  it('changes nothing about a wall, a rock or open ground', () => {
    const world = emptyRange();
    const at = clearing(world, 4, 4);
    addBuilding(world, 'wall', at.x, at.y, true);
    // The flag is about doors and only about doors: everything else has to give
    // the same answer either way, or a wild animal would be walking a different
    // map from the one the player is looking at.
    expect(isSolid(world, at.x, at.y, false)).toBe(isSolid(world, at.x, at.y));
    expect(isSolid(world, at.x + 1, at.y, false)).toBe(isSolid(world, at.x + 1, at.y));
    expect(isSolid(world, -1, 0, false)).toBe(isSolid(world, -1, 0));
  });

  it('refuses the step as well as the cell, diagonals included', () => {
    const world = emptyRange();
    const at = clearing(world, 4, 4);
    addBuilding(world, 'door', at.x + 1, at.y + 1, true);
    expect(canStep(world, at.x, at.y + 1, at.x + 1, at.y + 1)).toBe(true);
    expect(canStep(world, at.x, at.y + 1, at.x + 1, at.y + 1, false)).toBe(false);
    // And it counts as a corner for the no-clipping rule, so nothing squeezes
    // diagonally past a doorway it was refused head-on.
    addBuilding(world, 'wall', at.x + 1, at.y + 2, true);
    expect(canStep(world, at.x, at.y + 1, at.x + 1, at.y + 2, false)).toBe(false);
  });

  it('says who can work one', () => {
    const world = emptyRange();
    const at = clearing(world, 4, 4);
    const settler = livingColonists(world)[0]!;
    const wolf = putAnimal(world, 'fenwolf', at.x, at.y);
    const goat = putTame(world, 'mossback', at.x + 1, at.y);
    const deer = putAnimal(world, 'mossback', at.x + 2, at.y);
    expect(opensDoors(settler)).toBe(true);
    // Tame is the exemption, and not as a kindness: a goat that could not follow
    // its handler back through the pen gate would be shut out of the pen the
    // handler had just walked it into.
    expect(opensDoors(goat)).toBe(true);
    expect(opensDoors(wolf)).toBe(false);
    expect(opensDoors(deer)).toBe(false);
  });
});

describe('routing round a gate', () => {
  it('finds a way in for a settler and none for a wolf', () => {
    const world = emptyRange();
    const { inside, outside } = walledPen(world, 5, 5);
    expect(findPath(world, outside.x, outside.y, inside.x, inside.y)).not.toBeNull();
    expect(findPath(world, outside.x, outside.y, inside.x, inside.y, { latch: false })).toBeNull();
  });

  it('finds one for both the moment a wall cell is missing', () => {
    // The control for every claim in this file. If this passes and the one above
    // passes, the pen is doing the work — not the clearing, not the map, not the
    // expansion budget running out.
    const world = emptyRange();
    const { inside, outside } = walledPen(world, 5, 5, { gap: true });
    expect(findPath(world, outside.x, outside.y, inside.x, inside.y, { latch: false })).not.toBeNull();
  });

  it('stops the legs where it stopped the route', () => {
    const world = emptyRange();
    const { gate } = walledPen(world, 5, 5);
    // Standing on the doorstep, one step from being through it.
    const wolf = putAnimal(world, 'fenwolf', gate.x, gate.y - 1);
    for (let i = 0; i < 40; i++) moveWithCollision(world, wolf, 0, 0.1, false);
    expect(wolf.y).toBeLessThan(gate.y - 0.5);
    // And the same push with a latch goes straight through, so the difference is
    // the rule and not the geometry.
    const goat = putTame(world, 'mossback', gate.x, gate.y - 1);
    for (let i = 0; i < 40; i++) moveWithCollision(world, goat, 0, 0.1, true);
    expect(goat.y).toBeGreaterThan(gate.y + 0.5);
  });
});

describe('the door on screen', () => {
  it('swings for a settler and stays shut for a wolf', () => {
    const world = emptyRange();
    const at = clearing(world, 6, 6);
    const door = addBuilding(world, 'door', at.x + 2, at.y + 2, true) as Building;
    clearTheYard(world);
    const wolf = putAnimal(world, 'fenwolf', at.x + 2, at.y + 1);
    for (let i = 0; i < 30; i++) tickDoors(world);
    // Shut, and it has to be: a door that swung open for a fenwolf would be
    // showing the player the opposite of what the grid is about to tell it.
    expect(door.open ?? 0).toBe(0);

    const away = farCorner(world);
    wolf.x = away.x;
    wolf.y = away.y;
    const settler = livingColonists(world)[0]!;
    settler.x = at.x + 2;
    settler.y = at.y + 1;
    for (let i = 0; i < 30; i++) tickDoors(world);
    expect(door.open ?? 0).toBeGreaterThan(0.9);
  });

  it('swings for a goat, because the colony is answerable for it', () => {
    const world = emptyRange();
    const at = clearing(world, 6, 6);
    const door = addBuilding(world, 'door', at.x + 2, at.y + 2, true) as Building;
    clearTheYard(world);
    putTame(world, 'mossback', at.x + 2, at.y + 1);
    for (let i = 0; i < 30; i++) tickDoors(world);
    expect(door.open ?? 0).toBeGreaterThan(0.9);
  });
});

describe('a deadfall and what walks over it', () => {
  it('catches a wolf', () => {
    const world = emptyRange();
    const at = clearing(world, 4, 4);
    const trap = addBuilding(world, 'trap', at.x, at.y, true) as Building;
    const wolf = putAnimal(world, 'fenwolf', at.x, at.y);
    tickTraps(world, new Rng(7));
    // A deadfall is 55 at its softest and a fenwolf has 44 hit points, so the
    // pack pays for a trap line in full — which is the point of building one at
    // the pen gate rather than a second rifle.
    expect(TRAP_DAMAGE_MIN).toBeGreaterThan(ANIMALS.fenwolf.hp);
    expect(wolf.dead || wolf.downed).toBe(true);
    // And it is a blueprint again, not a corpse: the cell never stops being a trap.
    expect(trap.built).toBe(false);
  });

  it('lets the herd walk over it', () => {
    const world = emptyRange();
    const at = clearing(world, 4, 4);
    addBuilding(world, 'trap', at.x, at.y, true);
    const deer = putAnimal(world, 'mossback', at.x, at.y);
    const goat = putTame(world, 'mossback', at.x, at.y);
    tickTraps(world, new Rng(7));
    // A grazing mossback is not attacking anything, and a trap that fired on one
    // would turn every trap line into something the player has to disarm before
    // the map is allowed to have deer on it.
    expect(deer.hp).toBe(ANIMALS.mossback.hp);
    expect(goat.hp).toBe(ANIMALS.mossback.hp);
  });

  it('still catches a raider, and still spares a settler', () => {
    const world = emptyRange();
    const at = clearing(world, 4, 4);
    addBuilding(world, 'trap', at.x, at.y, true);
    const settler = livingColonists(world)[0]!;
    settler.x = at.x;
    settler.y = at.y;
    tickTraps(world, new Rng(7));
    expect(settler.hp).toBe(settler.maxHp);

    const raider = makePawn(world, new Rng(3), 'raider', at.x, at.y, { name: 'Kesk' });
    tickTraps(world, new Rng(7));
    expect(raider.hp).toBeLessThan(raider.maxHp);
  });
});

describe('a pen the pack cannot get into', () => {
  it('keeps the goat alive with three wolves outside the gate', () => {
    const world = emptyRange();
    clearTheYard(world);
    const { gate, inside } = walledPen(world, 5, 5);
    const goat = putTame(world, 'mossback', inside.x, inside.y);
    const pack: Pawn[] = [];
    for (let i = 0; i < 3; i++) pack.push(putAnimal(world, 'fenwolf', gate.x - 1 + i, gate.y - 3));

    walkAnimals(world, 900);

    expect(goat.dead).toBe(false);
    expect(goat.hp).toBe(ANIMALS.mossback.hp);
    // Not "they wandered off" — they are still on it. The pack works the fence
    // line for as long as it is in the valley, which is what makes a wall read as
    // holding rather than as having scared anything away.
    for (const wolf of pack) {
      expect(wolf.dead).toBe(false);
      expect(isSolid(world, Math.round(wolf.x), Math.round(wolf.y), false)).toBe(false);
    }
    const closest = Math.min(...pack.map((w) => Math.hypot(w.x - goat.x, w.y - goat.y)));
    expect(closest).toBeGreaterThan(1.5);
  });

  it('loses the goat through one missing wall cell', () => {
    // The same pen, the same wolves, the same nine hundred ticks — one cell of
    // wall short. Without this the test above would pass just as well if wolves
    // had quietly stopped hunting altogether.
    const world = emptyRange();
    clearTheYard(world);
    const { gate, inside } = walledPen(world, 5, 5, { gap: true });
    const goat = putTame(world, 'mossback', inside.x, inside.y);
    for (let i = 0; i < 3; i++) putAnimal(world, 'fenwolf', gate.x - 1 + i, gate.y - 3);

    walkAnimals(world, 900);

    expect(goat.dead).toBe(true);
  });

  it('still sends the pack when every settler is indoors', () => {
    // The regression the door rule very nearly shipped with. The arrival used to
    // route at a settler, which was fine while a door was a hole and became "no
    // pack tonight" the moment it was not — a settler is usually asleep, a bed is
    // behind a door, and a colony would have quietly stopped seeing wolves at
    // exactly the point it got good enough to have beds. The route aims at the
    // yard now, so being indoors changes nothing about whether they come.
    const world = createWorld(4041);
    const cabin = livingColonists(world).map((p) => {
      p.x = CABIN.x0 + 2;
      p.y = CABIN.y0 + 2;
      p.path = null;
      return p;
    });
    expect(cabin.length).toBeGreaterThan(0);
    // Indoors for real, or the test proves nothing: there must be no way to the
    // settler that does not go through a door.
    expect(
      findPath(world, 4, 4, Math.round(cabin[0]!.x), Math.round(cabin[0]!.y), { latch: false }),
    ).toBeNull();

    // Who was already out there, so the assertions below are about the pack that
    // was sent and not about the moor's own wolves. A valley this size is stocked
    // with four of them on tick one, standing where they were laid down with no
    // route and no reason to have one, and "every wolf on the map is holding a
    // route to the yard" quietly became a different and false claim the day the
    // map got big enough to have residents.
    const resident = new Set(world.pawns.filter((p) => p.hunts === true).map((p) => p.id));

    expect(startPredatorPack(world, new Rng(77))).toBe(true);
    const pack = world.pawns.filter((p) => p.hunts === true && !p.dead && !resident.has(p.id));
    expect(pack.length).toBeGreaterThan(0);
    for (const wolf of pack) {
      expect(wolf.path).not.toBeNull();
      // And the route they were handed is one they can actually walk: every cell
      // of it standable by something that cannot work a latch. A route that ended
      // at a doorstep would be a pack that arrived by standing still in a field.
      for (const cell of wolf.path!) {
        expect(isWalkable(world, unpackX(world, cell), unpackY(world, cell), false)).toBe(true);
      }
    }
  });

  it('lets a pet follow its person in through the gate', () => {
    // The exemption, played. A pet that could not come through a doorway after
    // its owner would stand against it until it starved, and the first thing the
    // player would ever see it do is fail to follow them indoors.
    const world = emptyRange();
    clearTheYard(world);
    const { gate, inside } = walledPen(world, 5, 5);
    const owner = livingColonists(world)[0]!;
    owner.x = inside.x;
    owner.y = inside.y;
    owner.path = null;
    const pet = putTame(world, 'dunhare', gate.x, gate.y - 3);
    expect(bondPet(world, owner, pet)).toBe(true);

    walkAnimals(world, 400);

    expect(pet.y).toBeGreaterThan(gate.y);
    expect(Math.hypot(pet.x - owner.x, pet.y - owner.y)).toBeLessThan(4);
  });
});
