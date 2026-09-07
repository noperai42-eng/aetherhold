/**
 * What the colony does about its dead.
 *
 * The functional half pins the bookkeeping: who counts as unburied, which grave
 * a hauler is allowed to use, what burial does to a body, and that a body nobody
 * comes for eventually stops existing rather than accumulating forever. The
 * experience half plays it the way it will actually happen — somebody dies, a
 * grave is standing, and the colony gets on with it — and checks the two things
 * a player would notice: the mood stops hurting once the body is in the ground,
 * and nobody strolls into a firefight to fetch one.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { addBuilding, msg } from '../src/sim/world';
import { createJob, isBuildingTargeted } from '../src/sim/jobs';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { alerts } from '../src/sim/alerts';
import {
  bury,
  buriableDead,
  freeGrave,
  freeGraves,
  GRAVE_INTERVAL,
  isCarried,
  needsBurial,
  occupantOf,
  ROT_TICKS,
  tickGraves,
  unburiedDead,
} from '../src/sim/graves';
import { bonds, bondKey, CORPSE_MOOD_LIMIT, moodFromBonds } from '../src/sim/social';
import { blocksSight, isSolid, isWalkable } from '../src/sim/grid';
import { defOf, SHOOT_OVER_HEIGHT } from '../src/sim/buildings';
import { TICKS_PER_DAY, type Building, type Pawn, type World } from '../src/sim/types';

function settlers(world: World): Pawn[] {
  return world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
}

/** Kill somebody the way the sim does, without dragging the combat pass in. */
function fell(pawn: Pawn): Pawn {
  pawn.dead = true;
  pawn.downed = true;
  pawn.activity = 'dead';
  pawn.hp = 0;
  pawn.jobId = null;
  pawn.path = null;
  return pawn;
}

/**
 * A grave on the nearest clear cell to where you asked for one.
 *
 * Worldgen scatters trees and rock across the map and every one of them is a
 * building, so a hard-coded pair of coordinates is a coin flip on whether
 * `addBuilding` returns anything at all. Searching outward is what makes a test
 * about burial a test about burial.
 */
function digGrave(world: World, nearX: number, nearY: number): Building {
  for (let r = 0; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(nearX) + dx;
        const y = Math.round(nearY) + dy;
        if (!isWalkable(world, x, y)) continue;
        const g = addBuilding(world, 'grave', x, y, true);
        if (g) return g;
      }
    }
  }
  throw new Error('nowhere to dig a grave');
}

describe('a body is a problem you can fix', () => {
  it('counts the dead who are still lying out, and nobody else', () => {
    const world = createWorld(11);
    const [a, b] = settlers(world);
    expect(unburiedDead(world)).toHaveLength(0);

    fell(a!);
    expect(unburiedDead(world).map((p) => p.id)).toEqual([a!.id]);

    // The living are not corpses, and a buried one has stopped being one.
    expect(unburiedDead(world)).not.toContain(b!);
    a!.buried = true;
    expect(unburiedDead(world)).toHaveLength(0);
  });

  it('leaves dead animals out of it', () => {
    const world = createWorld(12);
    const deer = world.pawns.find((p) => p.faction === 'fauna');
    expect(deer).toBeDefined();
    fell(deer!);
    // A colony that had to bury its livestock would spend the whole game digging.
    expect(unburiedDead(world)).toHaveLength(0);
    expect(needsBurial(world)).toBe(false);
  });

  it('does not offer a body that somebody already has over their shoulder', () => {
    const world = createWorld(13);
    const [carrier, victim] = settlers(world);
    fell(victim!);
    expect(buriableDead(world).map((p) => p.id)).toEqual([victim!.id]);

    carrier!.carryingPawnId = victim!.id;
    // There is no back-pointer on the corpse, so this has to be found by a scan.
    expect(isCarried(world, victim!.id)).toBe(true);
    expect(buriableDead(world)).toHaveLength(0);
    // Still a problem, though — being carried is on the way to being fixed, not fixed.
    expect(unburiedDead(world)).toHaveLength(1);
  });

  it('hands out empty graves and skips the full ones', () => {
    const world = createWorld(14);
    expect(freeGrave(world)).toBeNull();

    const one = digGrave(world, 20, 20);
    const two = digGrave(world, 21, 20);
    expect(freeGraves(world)).toHaveLength(2);

    const dead = fell(settlers(world)[0]!);
    bury(world, dead, one);
    expect(freeGraves(world).map((g) => g.id)).toEqual([two.id]);
    expect(freeGrave(world)!.id).toBe(two.id);
  });

  it('will not use a grave that is still a blueprint', () => {
    const world = createWorld(15);
    addBuilding(world, 'grave', 22, 22, false);
    expect(freeGrave(world)).toBeNull();
  });

  it('burial moves the body into the grave and names who is in it', () => {
    const world = createWorld(16);
    const grave = digGrave(world, 24, 24);
    const dead = fell(settlers(world)[0]!);
    dead.x = 4;
    dead.y = 4;

    bury(world, dead, grave);

    expect(dead.buried).toBe(true);
    expect(dead.x).toBe(grave.x);
    expect(dead.y).toBe(grave.y);
    expect(grave.occupant).toBe(dead.id);
    expect(occupantOf(world, grave)!.id).toBe(dead.id);
    // The body stays in the world — the whole point of a grave is that you can
    // come back and read the name off it.
    expect(world.pawns.some((p) => p.id === dead.id)).toBe(true);
    expect(world.messages.at(-1)!.text).toContain(dead.name);
  });

  it('a body nobody comes for rots away, and frees the grave it was promised', () => {
    const world = createWorld(17);
    const dead = fell(settlers(world)[0]!);
    const before = world.pawns.length;

    // Just short of the deadline: still there, still counting.
    world.tick = 0;
    for (let i = 0; i < Math.floor(ROT_TICKS / GRAVE_INTERVAL) - 1; i++) {
      world.tick += GRAVE_INTERVAL;
      tickGraves(world);
    }
    expect(world.pawns).toHaveLength(before);
    expect(unburiedDead(world)).toHaveLength(1);

    world.tick += GRAVE_INTERVAL;
    tickGraves(world);
    expect(world.pawns).toHaveLength(before - 1);
    expect(world.pawns.some((p) => p.id === dead.id)).toBe(false);
    expect(world.messages.some((m: { text: string }) => m.text.includes('Nothing is left'))).toBe(true);
  });

  it('a buried body never rots — that is what burying it was for', () => {
    const world = createWorld(18);
    const grave = digGrave(world, 26, 26);
    const dead = fell(settlers(world)[0]!);
    bury(world, dead, grave);
    const before = world.pawns.length;

    world.tick = 0;
    for (let i = 0; i < Math.ceil((ROT_TICKS * 2) / GRAVE_INTERVAL); i++) {
      world.tick += GRAVE_INTERVAL;
      tickGraves(world);
    }
    expect(world.pawns).toHaveLength(before);
    expect(grave.occupant).toBe(dead.id);
  });

  it('a shouldered body does not rot while it is being carried', () => {
    const world = createWorld(19);
    const [carrier, victim] = settlers(world);
    fell(victim!);
    carrier!.carryingPawnId = victim!.id;

    world.tick = 0;
    for (let i = 0; i < Math.ceil((ROT_TICKS * 1.5) / GRAVE_INTERVAL); i++) {
      world.tick += GRAVE_INTERVAL;
      tickGraves(world);
    }
    // Otherwise the corpse evaporates out of the arms of the settler carrying it
    // to the grave, which is the one moment the player is watching.
    expect(world.pawns.some((p) => p.id === victim!.id)).toBe(true);
  });

  // A job whose owner is not in `world.pawns` can never be worked and can never
  // be taken off them, so the thing it claims is claimed forever. Measured on
  // seed 7: a rotted settler's queued `build` held one fence frame from day 11 to
  // day 33, `boardClear` stayed false the whole time, and every Steward ambition
  // below `yard` — the turret above all — never ran once on 158 unspent steel.
  it('takes a rotted settler’s claims with them', () => {
    const world = createWorld(21);
    const [dead, alive] = settlers(world);
    const frame = addBuilding(world, 'fence', Math.round(alive!.x) + 2, Math.round(alive!.y), false)!;
    const job = createJob(world, fell(dead!), 'build', frame.x, frame.y, { buildingId: frame.id });
    expect(isBuildingTargeted(world, frame.id)).toBe(true);

    world.tick = 0;
    for (let i = 0; i < Math.ceil((ROT_TICKS * 1.5) / GRAVE_INTERVAL); i++) {
      world.tick += GRAVE_INTERVAL;
      tickGraves(world);
    }

    expect(world.pawns.some((p) => p.id === dead!.id)).toBe(false);
    expect(world.jobs.some((j) => j.id === job.id)).toBe(false);
    // The point of all of it: somebody still living can pick the frame back up.
    expect(isBuildingTargeted(world, frame.id)).toBe(false);
  });

  // The control. Rot is not a licence to tidy up other people's work — a body
  // going cold on the far side of the map must not cancel the job of the settler
  // standing over it.
  it('leaves the living settler’s claim exactly where it was', () => {
    const world = createWorld(22);
    const [dead, alive] = settlers(world);
    const frame = addBuilding(world, 'fence', Math.round(alive!.x) + 2, Math.round(alive!.y), false)!;
    const job = createJob(world, alive!, 'build', frame.x, frame.y, { buildingId: frame.id });
    fell(dead!);

    world.tick = 0;
    for (let i = 0; i < Math.ceil((ROT_TICKS * 1.5) / GRAVE_INTERVAL); i++) {
      world.tick += GRAVE_INTERVAL;
      tickGraves(world);
    }

    expect(world.jobs.some((j) => j.id === job.id)).toBe(true);
    expect(isBuildingTargeted(world, frame.id)).toBe(true);
  });

  it('only runs on its interval', () => {
    const world = createWorld(20);
    const dead = fell(settlers(world)[0]!);
    world.tick = GRAVE_INTERVAL + 1;
    tickGraves(world);
    expect(dead.rot ?? 0).toBe(0);
    world.tick = GRAVE_INTERVAL * 2;
    tickGraves(world);
    expect(dead.rot).toBe(GRAVE_INTERVAL);
  });

  it('empties a grave whose occupant has left the world', () => {
    const world = createWorld(21);
    const grave = digGrave(world, 28, 28);
    const dead = fell(settlers(world)[0]!);
    bury(world, dead, grave);

    // The only way this happens today is a save edited by hand — but a dangling
    // id would mean a grave nobody could ever use again.
    world.pawns = world.pawns.filter((p) => p.id !== dead.id);
    world.tick = GRAVE_INTERVAL;
    tickGraves(world);
    expect(grave.occupant).toBeNull();
    expect(freeGrave(world)!.id).toBe(grave.id);
  });

  it('loads a save written before graves existed', () => {
    const world = createWorld(22);
    const dead = fell(settlers(world)[0]!);
    // Exactly what an old save deserialises to: neither field present at all.
    delete dead.buried;
    delete dead.rot;

    world.tick = GRAVE_INTERVAL;
    expect(() => tickGraves(world)).not.toThrow();
    expect(unburiedDead(world).map((p) => p.id)).toEqual([dead.id]);
    expect(dead.rot).toBe(GRAVE_INTERVAL);
  });
});

describe('what the colony feels about it', () => {
  it('a body in the yard costs everyone mood until it is buried', () => {
    const world = createWorld(31);
    const [mourner, victim] = settlers(world);
    const calm = moodFromBonds(world, mourner!);

    fell(victim!);
    const grim = moodFromBonds(world, mourner!);
    expect(grim).toBeLessThan(calm);

    const grave = digGrave(world, 30, 30);
    bury(world, victim!, grave);
    // Burying them is what ends it. That is the whole contract: this penalty is
    // charged continuously precisely because the player can stop it.
    expect(moodFromBonds(world, mourner!)).toBeCloseTo(calm, 6);
  });

  it('a friend left lying out hurts more than a stranger does', () => {
    const world = createWorld(32);
    const [mourner, friend, stranger] = settlers(world);
    bonds(world)[bondKey(mourner!.id, friend!.id)] = 100;
    const calm = moodFromBonds(world, mourner!);

    fell(stranger!);
    const forStranger = moodFromBonds(world, mourner!);
    stranger!.buried = true;

    fell(friend!);
    const forFriend = moodFromBonds(world, mourner!);

    // Measured against the same colony with nobody dead in it, because the living
    // half of this number is not what is under test. Both bodies cost something,
    // and the one they knew costs more — and the friendship itself has already
    // stopped counting, which is why `forFriend` is not simply `calm` minus a bit.
    expect(forStranger).toBeLessThan(calm);
    expect(forFriend).toBeLessThan(forStranger);
  });

  it('a bad night does not by itself break the colony', () => {
    const world = createWorld(33);
    const mourner = settlers(world)[0]!;
    const calm = moodFromBonds(world, mourner);
    const map = bonds(world);
    // Ten bodies, every one of them a close friend, which is as bad as a night
    // can possibly get. Uncapped this would be six times a mental break on its
    // own; capped, it is a heavy but survivable day. That cap is the guard
    // against one raid ending the game through mood alone.
    for (let i = 0; i < 10; i++) {
      const body = fell({ ...mourner, id: 5000 + i, name: `Body ${i}` });
      world.pawns.push(body);
      map[bondKey(mourner.id, body.id)] = 100;
    }
    expect(unburiedDead(world)).toHaveLength(10);
    expect(moodFromBonds(world, mourner)).toBeCloseTo(calm - CORPSE_MOOD_LIMIT, 6);
  });

  it('nobody is charged for their own corpse', () => {
    const world = createWorld(34);
    const dead = fell(settlers(world)[0]!);
    expect(moodFromBonds(world, dead)).toBe(0);
  });

  it('says so in the alerts panel, with a different answer once a grave exists', () => {
    const world = createWorld(35);
    fell(settlers(world)[0]!);

    const dig = alerts(world).find((a) => a.id === 'unburied');
    expect(dig).toBeDefined();
    expect(dig!.text).toContain('1 unburied body');
    expect(dig!.hint).toContain('Build a grave');

    digGrave(world, 32, 32);
    const haul = alerts(world).find((a) => a.id === 'unburied');
    expect(haul!.hint).toContain('Haul');

    // And it goes away when the problem does, rather than scrolling off like a log line.
    const grave = freeGrave(world)!;
    bury(world, unburiedDead(world)[0]!, grave);
    expect(alerts(world).some((a) => a.id === 'unburied')).toBe(false);
  });

  it('a colony with a grave standing buries its own dead unprompted', () => {
    const world = createWorld(36);
    const streams = makeStreams(world);
    // Let them settle into the day first, so the loop below is testing burial and
    // not the opening scramble for food and beds.
    stepWorldN(world, streams, 120);

    const crew = settlers(world);
    const victim = crew[crew.length - 1]!;
    const grave = digGrave(world, Math.round(victim.x) + 2, Math.round(victim.y) + 2);
    fell(victim);
    msg(world, 'test: body is out', 'info');

    let buriedAt = -1;
    for (let i = 0; i < TICKS_PER_DAY && buriedAt < 0; i++) {
      stepWorld(world, streams);
      if (victim.buried) buriedAt = i;
    }

    expect(buriedAt).toBeGreaterThanOrEqual(0);
    expect(grave.occupant).toBe(victim.id);
    expect(occupantOf(world, grave)!.name).toBe(victim.name);
    // And the carrier put them down: nobody is still walking around with a body.
    expect(world.pawns.some((p) => p.carryingPawnId === victim.id)).toBe(false);
    expect(world.messages.some((m: { text: string }) => m.text.includes('laid to rest'))).toBe(true);
  });

  it('nobody walks into a live firefight to fetch a body', () => {
    const world = createWorld(37);
    const streams = makeStreams(world);
    stepWorldN(world, streams, 60);

    const crew = settlers(world);
    const victim = fell(crew[crew.length - 1]!);
    digGrave(world, Math.round(victim.x) + 2, Math.round(victim.y) + 2);

    // A raider on the map, alive and hostile: the dead will keep for a minute.
    const raider = world.pawns.find((p) => p.faction === 'raider' && !p.dead);
    if (!raider) {
      const source = crew[0]!;
      const stand: Pawn = { ...source, id: 90210, faction: 'raider', jobId: null, path: null };
      stand.x = source.x + 6;
      stand.y = source.y + 6;
      world.pawns.push(stand);
    }

    stepWorldN(world, streams, 200);
    expect(world.jobs.some((j) => j.kind === 'bury')).toBe(false);
    expect(victim.buried).not.toBe(true);
  });

  it('a graveyard is never a fortification', () => {
    const world = createWorld(41);
    const grave = digGrave(world, 30, 30);
    const def = defOf('grave');

    // The marker was made taller once already, because at ankle height a plot
    // read from the manager camera as a scorch mark. The next person to reach
    // for that dial has to stop below the threshold where a row of headstones
    // would start stopping bullets — four wood is the cheapest thing in the
    // game and a wall is not supposed to be.
    expect(def.solid).toBe(false);
    expect(def.height).toBeLessThan(SHOOT_OVER_HEIGHT);
    expect(isSolid(world, grave.x, grave.y)).toBe(false);
    expect(blocksSight(world, grave.x, grave.y)).toBe(false);
    // And it has to stay walkable, or the hauler cannot reach the hole they are
    // carrying somebody to.
    expect(isWalkable(world, grave.x, grave.y)).toBe(true);
  });

  it('a week with no graves leaves no pile of bodies behind', () => {
    const world = createWorld(38);
    const streams = makeStreams(world);
    const start = world.pawns.length;

    stepWorldN(world, streams, TICKS_PER_DAY * 7);

    // Nothing here asserts the colony survived. The claim is narrower and it is
    // the one that matters for a long game: `world.pawns` does not grow without
    // bound, because every body either goes in the ground or goes away.
    expect(world.pawns.length).toBeLessThanOrEqual(start + 40);
    for (const p of unburiedDead(world)) expect(p.rot ?? 0).toBeLessThan(ROT_TICKS);
  });
});
