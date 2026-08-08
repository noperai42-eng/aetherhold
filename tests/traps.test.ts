/**
 * Deadfall traps — the defence a colony can afford on day one.
 *
 * The functional half pins the two rules the whole feature rests on: only a
 * hostile springs one, and a sprung one is a blueprint rather than a ruin. Both
 * are the kind of rule that is easy to write and easy to get backwards, and
 * getting either backwards is invisible until a raid — the first turns the
 * player's own killbox into a hazard for their haulers, the second quietly
 * deletes every trap in the colony after its first raid.
 *
 * The experience half is the only two questions a player asks: did the thing I
 * built stop the man walking at me, and do I have to re-draw the corridor
 * afterwards.
 */

import { describe, expect, it } from 'vitest';

import { TRAP_DAMAGE_MAX, TRAP_DAMAGE_MIN, tickTraps, trapArmed } from '../src/sim/traps';
import { defOf } from '../src/sim/buildings';
import { blocksSight, isSolid, isWalkable } from '../src/sim/grid';
import { WALK_SPEED, followPath, setPathTo } from '../src/sim/movement';
import { setPriority } from '../src/sim/orders';
import { Rng } from '../src/sim/rng';
import { deserialize, serialize } from '../src/sim/save';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import type { Building, Pawn, World } from '../src/sim/types';
import { addBuilding, addItem, findBuilding } from '../src/sim/world';
import { createWorld, makePawn } from '../src/sim/worldgen';

function game(seed = 4242) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

/** Open ground clear of worldgen's cabin, boulders and trees. */
/**
 * Open ground of the given size — the nearest patch to the cabin, not the first
 * one a corner-up scan trips over. Most of these tests stand a raider on the trap
 * by hand and do not care where it is; one sends settlers out to re-arm it, and
 * from the top-left corner of a valley this wide that is a hundred and thirty
 * cells each way before any work starts. The walk is not what the test is about.
 *
 * `minFromHome` pushes the patch back out again, for the one test that needs the
 * opposite thing. A corridor test is about a raider walking onto a deadfall, and
 * laid at the cabin's feet the raider never reaches it: three settlers with rifles
 * are standing right there and put him down six cells short. That is the colony
 * working correctly and the test measuring nothing.
 */
function clearing(
  world: World,
  w: number,
  h: number,
  minFromHome = 0,
): { x: number; y: number } {
  const hx = Math.round(world.width / 2);
  const hy = Math.round(world.height / 2);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 4; y < world.height - h - 4; y++) {
    scan: for (let x = 4; x < world.width - w - 4; x++) {
      const d = Math.hypot(x + w / 2 - hx, y + h / 2 - hy);
      if (d < minFromHome || d >= bestD) continue;
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (!isWalkable(world, x + dx, y + dy)) continue scan;
          if (world.cellBuilding[(y + dy) * world.width + x + dx]! >= 0) continue scan;
        }
      }
      best = { x, y };
      bestD = d;
    }
  }
  if (!best) throw new Error('no clearing on this seed');
  return best;
}

/** An armed trap on open ground, and the cell it sits on. */
function armed(world: World): { trap: Building; x: number; y: number } {
  const c = clearing(world, 1, 1);
  const trap = addBuilding(world, 'trap', c.x, c.y, true)!;
  expect(trapArmed(trap)).toBe(true);
  return { trap, x: c.x, y: c.y };
}

function stand(pawn: Pawn, x: number, y: number): void {
  pawn.x = x;
  pawn.y = y;
}

/** Everyone on construction and nothing else, so re-arming is the work on offer. */
function buildersOnly(world: World): void {
  for (const p of world.pawns) {
    if (p.faction !== 'colony') continue;
    for (const w of Object.keys(p.priorities) as Array<keyof typeof p.priorities>) {
      setPriority(world, p.id, w, w === 'construct' ? 3 : 0);
    }
  }
}

describe('what a deadfall is on the grid', () => {
  it('is walkable — a raider has to be able to step onto it', () => {
    const { world } = game();
    const t = armed(world);
    expect(isSolid(world, t.x, t.y)).toBe(false);
    expect(isWalkable(world, t.x, t.y)).toBe(true);
    expect(blocksSight(world, t.x, t.y)).toBe(false);
  });

  it('is not cover — standing on a trap buys a raider nothing', () => {
    // `coverFor` counts a building only when it is solid and under the shoot-over
    // line. A trap fails the first test, which is what keeps a killbox from
    // accidentally handing the attacker a firing position.
    const def = defOf('trap');
    expect(def.solid).toBe(false);
    expect(def.buildable).toBe(true);
  });

  it('counts as armed only once it is finished', () => {
    const { world } = game();
    const c = clearing(world, 1, 1);
    const blueprint = addBuilding(world, 'trap', c.x, c.y, false)!;
    expect(trapArmed(blueprint)).toBe(false);
    blueprint.built = true;
    expect(trapArmed(blueprint)).toBe(true);
  });
});

describe('who sets one off', () => {
  it('catches a raider standing on it, and spends itself doing so', () => {
    const { world } = game();
    const t = armed(world);
    const rng = new Rng(3);
    const raider = makePawn(world, rng, 'raider', t.x, t.y, { name: 'Stepper', weapon: 'club' });
    const before = raider.hp;

    tickTraps(world, rng);

    expect(raider.hp).toBeLessThan(before);
    expect(t.trap.built).toBe(false);
    expect(trapArmed(t.trap)).toBe(false);
  });

  it('ignores the settlers who built it', () => {
    const { world } = game();
    const t = armed(world);
    const rng = new Rng(3);
    const settler = makePawn(world, rng, 'colony', t.x, t.y, { name: 'Hauler', weapon: 'none' });
    const before = settler.hp;

    tickTraps(world, rng);

    expect(settler.hp).toBe(before);
    expect(trapArmed(t.trap)).toBe(true);
  });

  it('ignores a downed raider lying on it — that one is being carried', () => {
    const { world } = game();
    const t = armed(world);
    const rng = new Rng(3);
    const raider = makePawn(world, rng, 'raider', t.x, t.y, { name: 'Limp', weapon: 'club' });
    raider.downed = true;
    const before = raider.hp;

    tickTraps(world, rng);

    expect(raider.hp).toBe(before);
    expect(trapArmed(t.trap)).toBe(true);
  });

  it('fires once, not every tick the raider stands there', () => {
    const { world } = game();
    const t = armed(world);
    const rng = new Rng(3);
    const raider = makePawn(world, rng, 'raider', t.x, t.y, { name: 'Loiterer', weapon: 'club' });
    raider.maxHp = 10_000;
    raider.hp = 10_000;

    tickTraps(world, rng);
    const afterFirst = raider.hp;
    for (let i = 0; i < 40; i++) tickTraps(world, rng);

    expect(raider.hp).toBe(afterFirst);
  });

  it('asks for its timber back once it has sprung', () => {
    const { world } = game();
    const t = armed(world);
    const rng = new Rng(3);
    makePawn(world, rng, 'raider', t.x, t.y, { name: 'Stepper', weapon: 'club' });

    tickTraps(world, rng);

    expect(t.trap.needs).toEqual(defOf('trap').cost);
    expect(t.trap.have).toEqual({});
    expect(t.trap.work).toBe(0);
    expect(t.trap.workLeft).toBe(defOf('trap').work);
  });

  it('hits inside the band it advertises', () => {
    // A trap that could roll a zero would read to the player as "sometimes it
    // just does not work", and one that could roll a hundred would make the
    // 12-wood build the only defence worth having.
    const { world } = game();
    const rng = new Rng(17);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 60; i++) {
      const c = clearing(world, 1, 1);
      const trap = addBuilding(world, 'trap', c.x, c.y, true)!;
      const raider = makePawn(world, rng, 'raider', c.x, c.y, { name: `R${i}`, weapon: 'club' });
      raider.maxHp = 10_000;
      raider.hp = 10_000;
      tickTraps(world, rng);
      const dealt = 10_000 - raider.hp;
      lo = Math.min(lo, dealt);
      hi = Math.max(hi, dealt);
      raider.dead = true; // out of the way so the next clearing is a fresh cell
      trap.built = false;
    }
    expect(lo).toBeGreaterThanOrEqual(TRAP_DAMAGE_MIN);
    expect(hi).toBeLessThanOrEqual(TRAP_DAMAGE_MAX);
    // And the roll is actually a roll, not a constant dressed up as one.
    expect(hi - lo).toBeGreaterThan(10);
  });

  it('survives a save and reloads still armed', () => {
    const { world } = game();
    const t = armed(world);
    const text = serialize(
      world,
      {
        mode: 'manager',
        possessedId: null,
        camera: { targetX: 0, targetY: 0, distance: 10, yaw: 0, pitch: 1 },
      },
      1,
      0,
    );
    const res = deserialize(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const same = findBuilding(res.save.world, t.trap.id)!;
    expect(same.kind).toBe('trap');
    expect(trapArmed(same)).toBe(true);
  });
});

describe('the corridor, played', () => {
  it('breaks a raider walking at the colony', () => {
    // The whole build, end to end: a settler to walk at, a club raider six cells
    // out who has to close to reach them, and one deadfall on the ground between.
    // Nothing steers the raider onto it — the trap is simply on the shortest way in.
    const { world, streams } = game();
    const lane = clearing(world, 1, 8, 30); // out of the colony's firing line
    const rng = new Rng(5);
    const target = makePawn(world, rng, 'colony', lane.x, lane.y, {
      name: 'Bait',
      weapon: 'none',
    });
    target.maxHp = 10_000;
    target.hp = 10_000;
    const trap = addBuilding(world, 'trap', lane.x, lane.y + 3, true)!;
    const raider = makePawn(world, rng, 'raider', lane.x, lane.y + 6, {
      name: 'Closer',
      weapon: 'club',
    });
    const before = raider.hp;

    for (let t = 0; t < 200 && trapArmed(trap); t++) {
      stand(target, lane.x, lane.y); // pinned, so this measures the trap and not a chase
      stepWorldN(world, streams, 1);
    }

    expect(trapArmed(trap)).toBe(false);
    expect(raider.hp).toBeLessThan(before);
  });

  it('lets the colony re-arm one without the player re-drawing it', () => {
    const { world, streams } = game();
    const t = armed(world);
    const rng = new Rng(3);
    const raider = makePawn(world, rng, 'raider', t.x, t.y, { name: 'Stepper', weapon: 'club' });
    tickTraps(world, rng);
    raider.dead = true;
    expect(t.trap.built).toBe(false);

    buildersOnly(world);
    addItem(world, 'wood', 60, t.x + 2, t.y);
    stepWorldN(world, streams, 1200);

    // Same building, same cell — the corridor the player drew is still the
    // corridor they drew, and it is dangerous again.
    expect(t.trap.built).toBe(true);
    expect(trapArmed(t.trap)).toBe(true);
    expect(world.cellBuilding[t.y * world.width + t.x]).toBe(t.trap.id);
  });

  it('lets a settler walk their own killbox unharmed', () => {
    const { world } = game();
    const lane = clearing(world, 1, 6);
    const trap = addBuilding(world, 'trap', lane.x, lane.y + 3, true)!;
    const rng = new Rng(3);
    const settler = makePawn(world, rng, 'colony', lane.x, lane.y, {
      name: 'Hauler',
      weapon: 'none',
    });
    const before = settler.hp;
    expect(setPathTo(world, settler, lane.x, lane.y + 5)).toBe(true);

    let crossed = false;
    for (let i = 0; i < 400; i++) {
      const done = followPath(world, settler, WALK_SPEED);
      if (Math.round(settler.x) === trap.x && Math.round(settler.y) === trap.y) crossed = true;
      tickTraps(world, rng);
      if (done) break;
    }

    expect(crossed).toBe(true); // otherwise the test proved nothing
    expect(settler.hp).toBe(before);
    expect(trapArmed(trap)).toBe(true);
  });
});
