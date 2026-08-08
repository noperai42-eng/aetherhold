/**
 * Pickies — the little pink goblins you send out to find out why nobody is going
 * somewhere.
 *
 * Three claims, and only the first is about goblins.
 *
 * 1. **A Picky answers the same question a job asks.** It walks through the same
 *    `findPath`, the same `isWalkable` and the same `moveWithCollision` a settler
 *    does, and it stands *on* a cell it could stand on and *beside* one it could
 *    not — which is exactly the distinction every job in the game makes. If a
 *    Picky says it cannot get there, no settler could have either. That is the
 *    entire value of the feature, and it is one `Walker` interface away from
 *    being a lie.
 *
 * 2. **Watching a colony must not change it.** A Picky spends none of the world's
 *    randomness, does no work, holds no job, is not a colonist, and never reveals
 *    ground. The strongest form of that claim is a twin: run one colony with six
 *    Pickies scampering across it and one without, and every number that matters
 *    has to come out identical — the rng cursors, the pantry, the map the colony
 *    has seen, where each settler is standing. Anything less and the diagnostic
 *    is a variable.
 *
 * 3. **It always leaves.** A Meeseeks that cannot do the thing does not hang
 *    around. Every path out of `tickPickies` ends in a countdown, including the
 *    ones nobody planned for, so a Picky is gone inside its patience no matter
 *    what the map does to it.
 *
 * The experience half is the two sentences a player actually reads: it got
 * there, or nothing joins that cell to the colony.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_PICKIES,
  PICKY_PATIENCE,
  POOF_TICKS,
  ROUNDS_STOPS,
  summonPicky,
} from '../src/sim/pickies';
import { isWalkable } from '../src/sim/grid';
import { defaultCamera, deserialize, serialize } from '../src/sim/save';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { packCell, unpackX, unpackY } from '../src/sim/types';
import type { Picky, World } from '../src/sim/types';
import { addBuilding, addCellToZone, addItem, addZone, livingColonists } from '../src/sim/world';
import { createWorld } from '../src/sim/worldgen';

function game(seed = 20260729) {
  const world = createWorld(seed);
  return { world, streams: makeStreams(world) };
}

/** Where the colony is standing, which is where every Picky starts. */
function home(world: World): { x: number; y: number } {
  const p = livingColonists(world)[0]!;
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * A walkable cell a good way from the colony, so a `reach` errand is a real walk
 * rather than a step sideways. Scanned outward so it never depends on the map
 * having a particular shape at a particular offset.
 */
function faraway(world: World, minDist: number): { x: number; y: number } {
  const h = home(world);
  for (let r = minDist; r < 40; r++) {
    for (let a = 0; a < 32; a++) {
      const x = Math.round(h.x + Math.cos((a / 32) * Math.PI * 2) * r);
      const y = Math.round(h.y + Math.sin((a / 32) * Math.PI * 2) * r);
      if (isWalkable(world, x, y)) return { x, y };
    }
  }
  throw new Error('no walkable cell out there');
}

/**
 * Wall a cell in on all eight sides and hand back the cell inside.
 *
 * This is the whole point of the feature in miniature: a cell that is perfectly
 * walkable, in plain sight, on ground the colony has already explored, that
 * nothing can get to. Nothing in the log would ever say so.
 */
function sealedCell(world: World): { x: number; y: number } {
  const c = faraway(world, 12);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      addBuilding(world, 'wall', c.x + dx, c.y + dy, true);
    }
  }
  return c;
}

/** Run until every Picky has popped, or give up after `limit` ticks. */
function untilEmpty(world: World, streams: ReturnType<typeof makeStreams>, limit: number): number {
  for (let t = 0; t < limit; t++) {
    stepWorldN(world, streams, 1);
    if ((world.pickies ?? []).length === 0) return t;
  }
  return -1;
}

function lastText(world: World, match: RegExp): string | undefined {
  return world.messages.filter((m) => match.test(m.text)).at(-1)?.text;
}

describe('summoning one', () => {
  it('puts a Picky on the ground where the colony is standing', () => {
    const { world } = game();
    const target = faraway(world, 10);
    const p = summonPicky(world, { kind: 'reach', x: target.x, y: target.y });
    expect(p).not.toBeNull();
    expect(world.pickies).toHaveLength(1);
    expect(isWalkable(world, Math.round(p!.x), Math.round(p!.y))).toBe(true);
    // Not "somewhere on the map" — beside the people. The answer to "can we get
    // there" is only worth anything if the question started where the colony is.
    const h = home(world);
    expect(Math.hypot(p!.x - h.x, p!.y - h.y)).toBeLessThanOrEqual(10);
  });

  it('is not a colonist, and does not join the work board', () => {
    const { world } = game();
    const people = livingColonists(world).length;
    const pawns = world.pawns.length;
    const jobs = world.jobs.length;
    summonPicky(world, { kind: 'reach', ...faraway(world, 10) });
    expect(livingColonists(world)).toHaveLength(people);
    expect(world.pawns).toHaveLength(pawns);
    expect(world.jobs).toHaveLength(jobs);
  });

  it('says out loud where it is going', () => {
    const { world } = game();
    const t = faraway(world, 10);
    summonPicky(world, { kind: 'reach', x: t.x, y: t.y });
    expect(lastText(world, /Picky/)).toContain(`(${t.x}, ${t.y})`);
  });

  it('refuses the seventh, in a sentence rather than a silence', () => {
    const { world } = game();
    const t = faraway(world, 10);
    for (let i = 0; i < MAX_PICKIES; i++) summonPicky(world, { kind: 'reach', ...t });
    expect(world.pickies).toHaveLength(MAX_PICKIES);
    const before = world.messages.length;
    expect(summonPicky(world, { kind: 'reach', ...t })).toBeNull();
    expect(world.pickies).toHaveLength(MAX_PICKIES);
    expect(world.messages.length).toBeGreaterThan(before);
    expect(lastText(world, /too many Pickies/)).toBeDefined();
  });

  it('will not be sent off the edge of the map', () => {
    const { world } = game();
    expect(summonPicky(world, { kind: 'reach', x: -3, y: 4 })).toBeNull();
    expect(summonPicky(world, { kind: 'reach', x: 4, y: world.height + 2 })).toBeNull();
    expect(world.pickies ?? []).toHaveLength(0);
  });
});

describe('the rounds errand', () => {
  it('picks its whole itinerary when it is summoned, so the same seed walks the same round', () => {
    const a = game().world;
    const b = game().world;
    const pa = summonPicky(a, { kind: 'rounds' })!;
    const pb = summonPicky(b, { kind: 'rounds' })!;
    expect(pa.task.kind).toBe('rounds');
    if (pa.task.kind !== 'rounds' || pb.task.kind !== 'rounds') throw new Error('wrong task');
    expect(pa.task.stops).toEqual(pb.task.stops);
  });

  it('visits real, finished buildings, each at most once', () => {
    const { world } = game();
    const p = summonPicky(world, { kind: 'rounds' })!;
    if (p.task.kind !== 'rounds') throw new Error('wrong task');
    expect(p.task.stops.length).toBeGreaterThan(0);
    expect(p.task.stops.length).toBeLessThanOrEqual(ROUNDS_STOPS);
    expect(new Set(p.task.stops).size).toBe(p.task.stops.length);
    for (const packed of p.task.stops) {
      const x = unpackX(world, packed);
      const y = unpackY(world, packed);
      const b = world.buildings.find((v) => v.x === x && v.y === y);
      expect(b?.built).toBe(true);
      expect(b?.kind).not.toBe('tree');
    }
  });
});

describe('the doors errand', () => {
  it('goes to doors and only doors', () => {
    const { world } = game();
    const h = home(world);
    for (let i = 0; i < 3; i++) addBuilding(world, 'door', h.x + 3 + i * 2, h.y + 4, true);
    const p = summonPicky(world, { kind: 'doors' })!;
    if (p.task.kind !== 'doors') throw new Error('wrong task');
    expect(p.task.stops.length).toBeGreaterThan(0);
    expect(p.task.stops.length).toBeLessThanOrEqual(ROUNDS_STOPS);
    for (const packed of p.task.stops) {
      const b = world.buildings.find(
        (v) => v.x === unpackX(world, packed) && v.y === unpackY(world, packed),
      );
      expect(b?.kind).toBe('door');
    }
  });

  it('stands *on* each door rather than beside it — which is what tries it', () => {
    // A door is walkable, so `route` walks *to* it. That distinction is the whole
    // errand: standing next to a door proves nothing about whether it opens.
    const { world, streams } = game();
    const p = summonPicky(world, { kind: 'doors' })!;
    if (p.task.kind !== 'doors') throw new Error('wrong task');
    const doors = new Set(p.task.stops);
    expect(doors.size).toBeGreaterThan(0);

    let stoodOnOne = false;
    for (let t = 0; t < PICKY_PATIENCE; t++) {
      stepWorldN(world, streams, 1);
      const live = (world.pickies ?? [])[0];
      if (live && doors.has(packCell(world, Math.round(live.x), Math.round(live.y)))) {
        stoodOnOne = true;
      }
      if ((world.pickies ?? []).length === 0) break;
    }
    expect(stoodOnOne).toBe(true);
    expect(lastText(world, /doors and every one of them opened/)).toBeDefined();
  });

  it('says so and pops at once when the colony has no doors', () => {
    const { world, streams } = game();
    for (const b of world.buildings) if (b.kind === 'door') b.kind = 'wall';
    const p = summonPicky(world, { kind: 'doors' })!;
    expect(p.poof).not.toBeNull();
    expect(lastText(world, /finds not one in the whole colony/)).toBeDefined();
    expect(untilEmpty(world, streams, POOF_TICKS + 10)).toBeGreaterThan(0);
  });
});

describe('the hauling errand', () => {
  it('walks the stack, then the store that would take it', () => {
    const { world } = game();
    const h = home(world);
    const drop = { x: h.x + 6, y: h.y + 6 };
    const pile = { x: h.x - 5, y: h.y - 5 };
    // Clear the field so the sampled stack is the one this test put down, and the
    // store it picks is this one rather than the cabin's own.
    world.items.length = 0;
    world.zones.length = 0;
    addItem(world, 'wood', 20, drop.x, drop.y);
    const z = addZone(world, 'stockpile', ['wood']);
    addCellToZone(world, z, pile.x, pile.y);

    const p = summonPicky(world, { kind: 'fetch' })!;
    if (p.task.kind !== 'fetch') throw new Error('wrong task');
    expect(p.task.stops).toHaveLength(2);
    expect(unpackX(world, p.task.stops[0]!)).toBe(drop.x);
    expect(unpackY(world, p.task.stops[0]!)).toBe(drop.y);
    expect(unpackX(world, p.task.stops[1]!)).toBe(pile.x);
    expect(p.task.what).toContain('wood');
  });

  it('will not send a Picky after something with nowhere to put it', () => {
    const { world } = game();
    world.items.length = 0;
    world.zones.length = 0;
    addItem(world, 'wood', 20, home(world).x + 6, home(world).y);
    const p = summonPicky(world, { kind: 'fetch' })!;
    if (p.task.kind !== 'fetch') throw new Error('wrong task');
    expect(p.task.stops).toHaveLength(0);
    expect(p.poof).not.toBeNull();
    expect(lastText(world, /finds nowhere to put it/)).toBeDefined();
  });
});

describe('surprise me', () => {
  it('only ever picks an errand the colony can actually supply', () => {
    // Nothing built, nothing loose, no store: the only honest errand left is to
    // go and stand somewhere. A goblin that rolled "try the doors" here would
    // have wasted the click, which is the one thing a surprise must not do.
    const { world } = game();
    world.buildings.length = 0;
    world.items.length = 0;
    world.zones.length = 0;
    for (let i = 0; i < MAX_PICKIES; i++) {
      const p = summonPicky(world, { kind: 'surprise' })!;
      expect(p.task.kind).toBe('reach');
    }
  });

  it('decides the same thing twice from the same colony and seed', () => {
    const a = summonPicky(game().world, { kind: 'surprise' })!;
    const b = summonPicky(game().world, { kind: 'surprise' })!;
    expect(a.task).toEqual(b.task);
  });

  it('whatever it picks, it goes, reports and leaves', () => {
    const { world, streams } = game();
    summonPicky(world, { kind: 'surprise' });
    expect(untilEmpty(world, streams, PICKY_PATIENCE + POOF_TICKS + 60)).toBeGreaterThan(0);
    // Two lines and no more: what it decided to do, and how it went.
    expect(world.messages.filter((m) => /Picky/.test(m.text))).toHaveLength(2);
  });
});

describe('every Picky leaves', () => {
  it('reaches somewhere reachable and pops', () => {
    const { world, streams } = game();
    const t = faraway(world, 12);
    summonPicky(world, { kind: 'reach', x: t.x, y: t.y });
    const took = untilEmpty(world, streams, PICKY_PATIENCE + POOF_TICKS + 60);
    expect(took).toBeGreaterThan(0);
    expect(world.pickies).toHaveLength(0);
  });

  it('gives up on somewhere it cannot reach, and pops anyway', () => {
    const { world, streams } = game();
    const c = sealedCell(world);
    summonPicky(world, { kind: 'reach', x: c.x, y: c.y });
    const took = untilEmpty(world, streams, PICKY_PATIENCE + POOF_TICKS + 60);
    expect(took).toBeGreaterThan(0);
    expect(world.pickies).toHaveLength(0);
  });

  it('is gone inside its patience however the map treats it', () => {
    // Sent at a wall in the middle of a rock face — reachable-looking, standable
    // beside, and the kind of errand that could plausibly loop for ever if the
    // timeout were only wired into one of the failure paths.
    const { world, streams } = game();
    const c = sealedCell(world);
    for (const spot of [c, faraway(world, 20), home(world)]) {
      summonPicky(world, { kind: 'reach', x: spot.x, y: spot.y });
    }
    summonPicky(world, { kind: 'rounds' });
    stepWorldN(world, streams, PICKY_PATIENCE + POOF_TICKS + 40);
    expect(world.pickies).toHaveLength(0);
  });
});

describe('watching a colony does not change it', () => {
  it('spends none of the world randomness and moves nothing the colony owns', () => {
    // The twin. One colony gets six Pickies running all over it for a hundred
    // seconds; the other is left alone. If a single roll, a single settler or a
    // single revealed cell differs, the diagnostic is a variable and every answer
    // it has ever given is suspect.
    const watched = game();
    const alone = game();

    const t = faraway(watched.world, 14);
    for (let i = 0; i < MAX_PICKIES - 1; i++) {
      summonPicky(watched.world, { kind: 'reach', x: t.x, y: t.y });
    }
    summonPicky(watched.world, { kind: 'rounds' });
    expect(watched.world.pickies).toHaveLength(MAX_PICKIES);

    stepWorldN(watched.world, watched.streams, 2000);
    stepWorldN(alone.world, alone.streams, 2000);

    expect(watched.world.rng).toEqual(alone.world.rng);
    expect(watched.world.stats).toEqual(alone.world.stats);
    // The id counter counts as randomness. It reads as a bookkeeping detail, but
    // `tickWildlife` staggers wandering by `(tick + id)`, so a Picky that had
    // spent an id would move every animal born after it. This assertion is the
    // whole reason Pickies number themselves — see `World.pickyIds`.
    expect(watched.world.nextId).toBe(alone.world.nextId);
    expect(
      watched.world.pawns.map((p) => `${p.id}:${p.x.toFixed(4)},${p.y.toFixed(4)},${p.hp}`),
    ).toEqual(alone.world.pawns.map((p) => `${p.id}:${p.x.toFixed(4)},${p.y.toFixed(4)},${p.hp}`));
    expect(watched.world.items.map((i) => `${i.kind}:${i.amount}`).sort()).toEqual(
      alone.world.items.map((i) => `${i.kind}:${i.amount}`).sort(),
    );
    expect(watched.world.buildings.length).toBe(alone.world.buildings.length);
    // And it did in fact run — a twin test that passes because nothing happened
    // proves nothing.
    expect(watched.world.messages.some((m) => /Picky/.test(m.text))).toBe(true);
  });

  it('never reveals ground: the haze lifts in exactly the same places either way', () => {
    // Send one across half the map, through ground no settler has laid eyes on,
    // and compare the whole fog array against a twin nobody watched. Cell-by-cell
    // rather than by the explored counter, because a count can match while the
    // map differs. Settlers light plenty of ground in 600 ticks — the claim is
    // that they light exactly the same ground with a goblin running past them.
    const watched = game();
    const alone = game();
    const far = faraway(watched.world, 24);
    summonPicky(watched.world, { kind: 'reach', x: far.x, y: far.y });

    const TICKS = 600;
    stepWorldN(watched.world, watched.streams, TICKS);
    stepWorldN(alone.world, alone.streams, TICKS);

    expect(watched.world.seen).toEqual(alone.world.seen);
    // Non-vacuity: there was fog to lift, and the Picky really did go out into it.
    expect((watched.world.seen ?? []).some((v) => v !== 1)).toBe(true);
    expect(watched.world.messages.some((m) => /Picky/.test(m.text))).toBe(true);
  });
});

describe('a Picky mid-errand survives a save', () => {
  it('comes back on the same errand, on the same leg', () => {
    const { world, streams } = game();
    const t = faraway(world, 16);
    summonPicky(world, { kind: 'reach', x: t.x, y: t.y });
    summonPicky(world, { kind: 'rounds' });
    stepWorldN(world, streams, 40);
    const before = (world.pickies ?? []).map((p) => ({ ...p }));
    expect(before.length).toBe(2);

    const text = serialize(
      world,
      { mode: 'manager', possessedId: null, camera: defaultCamera(world) },
      1,
      0,
    );
    const res = deserialize(text);
    if (!res.ok) throw new Error(res.detail);
    const back = res.save.world;

    expect(back.pickies).toHaveLength(2);
    for (const [i, p] of (back.pickies as Picky[]).entries()) {
      const was = before[i]!;
      expect(p.id).toBe(was.id);
      expect(p.task).toEqual(was.task);
      expect(p.leg).toBe(was.leg);
      expect(p.seed).toBe(was.seed);
      expect(p.x).toBeCloseTo(was.x, 6);
    }
    // And it carries on rather than standing there: the reloaded colony still
    // ends up with an empty field.
    const s2 = makeStreams(back);
    expect(untilEmpty(back, s2, PICKY_PATIENCE + POOF_TICKS + 60)).toBeGreaterThan(0);
  });

  it('a colony saved before Pickies existed loads with none out', () => {
    const { world } = game();
    delete world.pickies;
    const text = serialize(
      world,
      { mode: 'manager', possessedId: null, camera: defaultCamera(world) },
      1,
      0,
    );
    const res = deserialize(text);
    if (!res.ok) throw new Error(res.detail);
    expect(res.save.world.pickies).toBeUndefined();
    // And stepping it does not throw on the missing field.
    const s = makeStreams(res.save.world);
    stepWorldN(res.save.world, s, 40);
    expect(res.save.world.pickies ?? []).toHaveLength(0);
  });
});

describe('what the player actually reads', () => {
  it('a Picky sent across the colony arrives and says so', () => {
    const { world, streams } = game();
    const t = faraway(world, 12);
    summonPicky(world, { kind: 'reach', x: t.x, y: t.y });
    untilEmpty(world, streams, PICKY_PATIENCE + POOF_TICKS + 60);
    const line = lastText(world, /Picky reached/);
    expect(line).toBeDefined();
    expect(line).toContain(`(${t.x}, ${t.y})`);
    expect(world.messages.find((m) => m.text === line)?.kind).toBe('good');
  });

  it('a Picky sent into a sealed room says nothing joins it to the colony', () => {
    const { world, streams } = game();
    const c = sealedCell(world);
    summonPicky(world, { kind: 'reach', x: c.x, y: c.y });
    untilEmpty(world, streams, PICKY_PATIENCE + POOF_TICKS + 60);
    const line = lastText(world, /nothing joins it/);
    expect(line).toBeDefined();
    expect(line).toContain(`(${c.x}, ${c.y})`);
    expect(world.messages.find((m) => m.text === line)?.kind).toBe('bad');
  });

  it('the failure names the building when there is one, not just a pair of numbers', () => {
    // A wall nobody can get near: the sealed cell's own ring. "The wall at
    // (34, 51)" is a thing the player can find; "(34, 51)" is homework.
    const { world, streams } = game();
    const c = sealedCell(world);
    // Bury the ring one deeper so even standing beside it is impossible.
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        addBuilding(world, 'wall', c.x + dx, c.y + dy, true);
      }
    }
    summonPicky(world, { kind: 'reach', x: c.x + 1, y: c.y });
    untilEmpty(world, streams, PICKY_PATIENCE + POOF_TICKS + 60);
    expect(lastText(world, /nothing joins it/)).toMatch(/^The wall at \(/);
  });

  it('a rounds Picky reports once at the end, not once a stop', () => {
    const { world, streams } = game();
    summonPicky(world, { kind: 'rounds' });
    untilEmpty(world, streams, PICKY_PATIENCE + POOF_TICKS + 60);
    const spoken = world.messages.filter((m) => /Picky/.test(m.text));
    // Summoned, and one verdict. Six lines of good news is not news.
    expect(spoken).toHaveLength(2);
    expect(spoken.at(-1)!.text).toMatch(/reached every one|nothing joins it|never got there/);
  });
});
