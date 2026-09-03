/**
 * Where the compound puts another room.
 *
 * The functional half pins the geometry: an annex is the promised size, it
 * leans on a wall that is really there, its own shell is complete bar one door,
 * and it never lands on ground something is already standing on. The experience
 * half takes the world the game actually starts with and checks that a room can
 * be sited against the starter cabin at all — the whole point of the primitive
 * is that a colony on day one has somewhere to grow.
 */

import { describe, expect, it } from 'vitest';
import { ANNEX_DEEP, ANNEX_WIDE, PARTITION_DEEP, planAnnex, planPartition } from '../src/sim/annex';
import { createWorld } from '../src/sim/worldgen';
import { heart } from '../src/sim/steward';
import { buildingAt } from '../src/sim/grid';
import { canPlace } from '../src/sim/orders';
import { ROOM_WALL_HEIGHT, roomAt, roomIndex } from '../src/sim/rooms';
import { defOf } from '../src/sim/buildings';
import { terrainAt } from '../src/sim/types';
import { addBuilding, livingColonists } from '../src/sim/world';
import { QUARTERS_INTERVAL, hasPrivacy, privateBeds, tickQuarters, unhoused } from '../src/sim/quarters';

function world() {
  return createWorld(4242);
}

/**
 * Is this cell part of the annex's own shell, rather than the host's?
 *
 * Asked on **height**, the way `rooms.ts` asks it, and not on `solid`. A fence is
 * solid and waist-high: the room index reads straight over the top of it, so a
 * box whose fourth side is fence is not a room however solid it feels. Getting
 * this wrong in the source cost a colony every south-facing bedroom it ever
 * planned, and a test helper that stayed wrong would have agreed with it.
 */
function encloses(w: ReturnType<typeof world>, x: number, y: number): boolean {
  const b = buildingAt(w, x, y);
  if (b) {
    const def = defOf(b.kind);
    return def.buildable && def.height >= ROOM_WALL_HEIGHT;
  }
  return terrainAt(w, x, y) === 'rock';
}

describe('annex geometry (functional)', () => {
  it('plans a room of exactly the advertised size', () => {
    const w = world();
    const room = heart(w)!;
    const a = planAnnex(w, room)!;
    expect(a).not.toBeNull();
    expect(a.floor).toHaveLength(ANNEX_WIDE * ANNEX_DEEP);
  });

  it('puts every floor cell on ground that is free to build on', () => {
    const w = world();
    const a = planAnnex(w, heart(w)!)!;
    for (const c of a.floor) expect(canPlace(w, 'bed', c.x, c.y)).toBe('ok');
  });

  it('puts every wall cell on ground that is free to build on', () => {
    const w = world();
    const a = planAnnex(w, heart(w)!)!;
    for (const c of a.walls) expect(canPlace(w, 'wall', c.x, c.y)).toBe('ok');
    expect(canPlace(w, 'door', a.door.x, a.door.y)).toBe('ok');
  });

  it('leaves exactly one gap in its own shell, and that gap is the door', () => {
    const w = world();
    const a = planAnnex(w, heart(w)!)!;
    // The shell is the ring around the floor. Every cell of it is either a wall
    // this plan raises, the door, or a host wall that was already standing.
    const wall = new Set(a.walls.map((c) => `${c.x},${c.y}`));
    const floor = new Set(a.floor.map((c) => `${c.x},${c.y}`));
    let gaps = 0;
    for (const c of a.floor) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k = `${c.x + dx},${c.y + dy}`;
        if (floor.has(k) || wall.has(k)) continue;
        if (c.x + dx === a.door.x && c.y + dy === a.door.y) continue;
        if (encloses(w, c.x + dx, c.y + dy)) continue;
        gaps++;
      }
    }
    expect(gaps, 'an annex with a hole in it is not a room').toBe(0);
  });

  it('never overlaps its own floor with its own walls', () => {
    const w = world();
    const a = planAnnex(w, heart(w)!)!;
    const floor = new Set(a.floor.map((c) => `${c.x},${c.y}`));
    for (const c of a.walls) expect(floor.has(`${c.x},${c.y}`)).toBe(false);
    expect(floor.has(`${a.door.x},${a.door.y}`)).toBe(false);
  });

  it('is shallow enough to leave the fence a lane', () => {
    // Floor plus its own outer wall, against `YARD_MARGIN` of 4 — and it has to
    // be strictly less, not equal, because the fence ring is laid *at* the
    // margin. At two of floor the outer wall landed exactly on the fence line and
    // `canPlace` refused every span on every side the fields had not already
    // pushed outward: seed 4242 built one bedroom in forty days and then reported
    // nowhere to put another.
    expect(ANNEX_DEEP + 1).toBeLessThan(4);
  });

  it('returns the same plan twice running, so a half-built room is finished', () => {
    const w = world();
    const a = planAnnex(w, heart(w)!)!;
    const b = planAnnex(w, heart(w)!)!;
    expect(b.side).toBe(a.side);
    expect(b.door).toEqual(a.door);
  });
});

describe('annex on the world the game starts with (experience)', () => {
  it('finds a wall on the starter cabin to lean a room against', () => {
    const w = world();
    const a = planAnnex(w, heart(w)!);
    expect(a, 'the colony must be able to grow a room on day one').not.toBeNull();
    expect(['north', 'south', 'east', 'west']).toContain(a!.side);
  });

  it('sites the room outside the cabin it leans on, not inside it', () => {
    const w = world();
    const idx = roomIndex(w);
    const room = heart(w)!;
    const a = planAnnex(w, room)!;
    for (const c of a.floor) {
      expect(idx.cellRoom[c.y * w.width + c.x]).not.toBe(room.id);
    }
  });

  it('leans on ground the host really has walled', () => {
    const w = world();
    const a = planAnnex(w, heart(w)!)!;
    // Step from each floor cell back towards the host: the far side of the
    // annex's own depth must be something solid.
    const floor = new Set(a.floor.map((c) => `${c.x},${c.y}`));
    const wall = new Set(a.walls.map((c) => `${c.x},${c.y}`));
    let leaned = 0;
    for (const c of a.floor) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k = `${c.x + dx},${c.y + dy}`;
        if (floor.has(k) || wall.has(k)) continue;
        if (encloses(w, c.x + dx, c.y + dy)) leaned++;
      }
    }
    expect(leaned, 'the shared wall is what makes an annex cheaper than a hut').toBeGreaterThan(0);
  });
});

/**
 * A hall with room to spare, and nothing in it but what the test puts there.
 *
 * Built by hand rather than taken from a seed, because the interesting cases are
 * about *what is standing in the corner* — a stove, one bunk, two — and a
 * generated cabin gives you whichever of those it happens to have.
 */
function hall(w: ReturnType<typeof world>, x0: number, y0: number, x1: number, y1: number): void {
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    addBuilding(w, 'wall', x, y0 - 1, true);
    addBuilding(w, 'wall', x, y1 + 1, true);
  }
  for (let y = y0; y <= y1; y++) {
    addBuilding(w, 'wall', x0 - 1, y, true);
    addBuilding(w, 'wall', x1 + 1, y, true);
  }
  addBuilding(w, 'door', x0 + Math.floor((x1 - x0) / 2), y1 + 1, true);
}

/** A patch of open map far from anything the world generator put down. */
function clearing(w: ReturnType<typeof world>, need: number): { x: number; y: number } {
  for (let y = 12; y < w.height - 12; y++) {
    for (let x = 12; x < w.width - 12; x++) {
      let ok = true;
      for (let dy = -1; dy <= need && ok; dy++) {
        for (let dx = -1; dx <= need && ok; dx++) {
          if (buildingAt(w, x + dx, y + dy)) ok = false;
          else {
            const t = terrainAt(w, x + dx, y + dy);
            if (t === 'rock' || t === 'water') ok = false;
          }
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no clearing big enough on this map');
}

/** The room the hall became, by id, so a plan can be checked against it. */
function hallRoom(w: ReturnType<typeof world>, x: number, y: number) {
  const room = roomAt(w, x, y);
  if (!room) throw new Error('the hall did not come out as a room');
  return room;
}

describe('partitioning the hall (functional)', () => {
  it('cuts a room of exactly the advertised size', () => {
    const w = world();
    const o = clearing(w, 10);
    hall(w, o.x, o.y, o.x + 9, o.y + 8);
    const p = planPartition(w, hallRoom(w, o.x, o.y))!;
    expect(p, 'a hall of ninety cells has somewhere to put a bedroom').not.toBeNull();
    expect(p.floor).toHaveLength(ANNEX_WIDE * PARTITION_DEEP);
  });

  it('keeps every cell it touches inside the hall it is cutting', () => {
    // The one rule that makes the cut safe: it cannot reach through the hall's
    // shell, cannot spill into the yard, and cannot land past a door.
    const w = world();
    const o = clearing(w, 10);
    hall(w, o.x, o.y, o.x + 9, o.y + 8);
    const room = hallRoom(w, o.x, o.y);
    const cells = new Set(room.cells);
    const p = planPartition(w, room)!;
    for (const c of p.floor) {
      expect(cells.has(c.y * w.width + c.x), `floor ${c.x},${c.y} is not hall floor`).toBe(true);
    }
    for (const c of p.walls) {
      // A side face flush with a corner lands on the hall's own wall, which is
      // not floor and is not ours to raise. Anything else must be hall floor.
      if (encloses(w, c.x, c.y)) continue;
      expect(cells.has(c.y * w.width + c.x), `wall ${c.x},${c.y} is not hall floor`).toBe(true);
    }
  });

  it('leaves the hall enough floor to still be a hall', () => {
    const w = world();
    const o = clearing(w, 6);
    // Five by four is twenty cells; a cut takes six of floor and nine of wall.
    hall(w, o.x, o.y, o.x + 4, o.y + 3);
    expect(planPartition(w, hallRoom(w, o.x, o.y)), 'carved the hall away to nothing').toBeNull();
  });

  it('walls one existing bunk in rather than refusing the corner', () => {
    // The measured failure: `beds` lines the hall's walls with bunks long before
    // anything walls a room, so a cut that demanded bare floor found nowhere to
    // go. A corner with one bed in it is a bedroom already — it only wants a door.
    const w = world();
    const o = clearing(w, 10);
    hall(w, o.x, o.y, o.x + 9, o.y + 8);
    addBuilding(w, 'bed', o.x, o.y, true);
    const p = planPartition(w, hallRoom(w, o.x + 5, o.y + 4));
    expect(p).not.toBeNull();
    const floor = new Set(p!.floor.map((c) => `${c.x},${c.y}`));
    expect(floor.has(`${o.x},${o.y}`), 'the corner with the bunk in it was skipped').toBe(true);
  });

  it('refuses a corner the hall is using for something that is not a bed', () => {
    const w = world();
    const o = clearing(w, 6);
    hall(w, o.x, o.y, o.x + 5, o.y + 4);
    // Every candidate cut on this hall covers one of these four cells.
    for (const [dx, dy] of [
      [0, 0],
      [5, 0],
      [0, 4],
      [5, 4],
    ] as const) {
      addBuilding(w, 'stove', o.x + dx, o.y + dy, true);
    }
    expect(planPartition(w, hallRoom(w, o.x + 2, o.y + 2))).toBeNull();
  });

  it('opens a doorway in the partition and nowhere else', () => {
    const w = world();
    const o = clearing(w, 10);
    hall(w, o.x, o.y, o.x + 9, o.y + 8);
    const p = planPartition(w, hallRoom(w, o.x, o.y))!;
    const wall = new Set(p.walls.map((c) => `${c.x},${c.y}`));
    const floor = new Set(p.floor.map((c) => `${c.x},${c.y}`));
    expect(wall.has(`${p.door.x},${p.door.y}`), 'the door is a gap, not a wall').toBe(false);
    let gaps = 0;
    for (const c of p.floor) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const k = `${c.x + dx},${c.y + dy}`;
        if (floor.has(k) || wall.has(k)) continue;
        if (c.x + dx === p.door.x && c.y + dy === p.door.y) continue;
        if (encloses(w, c.x + dx, c.y + dy)) continue;
        gaps++;
      }
    }
    expect(gaps, 'a bedroom with a hole in it is not a room').toBe(0);
  });

  it('proposes the same cut again once its door is standing', () => {
    // The Steward marks the door alone and the walls on a later pass, so the plan
    // has to survive its own first course. It used to not: a door is a boundary,
    // so its cell stopped being hall floor, the cut was refused, a different
    // corner was proposed, and the colony planted doors round the hall one
    // abandoned bedroom at a time.
    const w = world();
    const o = clearing(w, 10);
    hall(w, o.x, o.y, o.x + 9, o.y + 8);
    const first = planPartition(w, hallRoom(w, o.x, o.y))!;
    addBuilding(w, 'door', first.door.x, first.door.y, true);
    const again = planPartition(w, hallRoom(w, o.x + 5, o.y + 4))!;
    expect(again, 'the half-built room was abandoned').not.toBeNull();
    expect(again.door).toEqual(first.door);
  });
});

describe('a hall the colony can actually live in (experience)', () => {
  it('carves a second room once the first one is finished', () => {
    // One bedroom is a curiosity; the promise is that everybody gets one
    // eventually. Cutting the first room must not use up the hall's only site.
    const w = world();
    const o = clearing(w, 12);
    hall(w, o.x, o.y, o.x + 11, o.y + 10);
    const first = planPartition(w, hallRoom(w, o.x, o.y))!;
    for (const c of first.walls) addBuilding(w, 'wall', c.x, c.y, true);
    addBuilding(w, 'door', first.door.x, first.door.y, true);
    addBuilding(w, 'bed', first.floor[0]!.x, first.floor[0]!.y, true);

    const hallNow = hallRoom(w, o.x + 6, o.y + 5);
    const second = planPartition(w, hallNow);
    expect(second, 'the hall had room for one bedroom and no more').not.toBeNull();
    const taken = new Set(first.floor.map((c) => `${c.x},${c.y}`));
    for (const c of second!.floor) {
      expect(taken.has(`${c.x},${c.y}`), 'the second room was cut on top of the first').toBe(false);
    }
  });

  it('makes a real room that one settler owns', () => {
    // The whole chain, end to end: cut the corner, stand the walls, hang the
    // door, put a bunk in it — and the colony works out by itself whose room it
    // is. Nothing here declares an owner.
    const w = world();
    const o = clearing(w, 12);
    hall(w, o.x, o.y, o.x + 11, o.y + 10);
    const p = planPartition(w, hallRoom(w, o.x, o.y))!;
    for (const c of p.walls) addBuilding(w, 'wall', c.x, c.y, true);
    addBuilding(w, 'door', p.door.x, p.door.y, true);
    const bed = addBuilding(w, 'bed', p.floor[0]!.x, p.floor[0]!.y, true)!;

    const pawn = livingColonists(w)[0]!;
    w.tick = QUARTERS_INTERVAL;
    tickQuarters(w);

    expect(privateBeds(w).map((b) => b.id), 'the carved room is not counted private').toContain(bed.id);
    expect(bed.ownerId, 'nobody moved into the room the colony built').not.toBeUndefined();
    expect(unhoused(w).map((q) => q.id)).not.toContain(bed.ownerId);
    expect(hasPrivacy(w, pawn) || bed.ownerId !== pawn.id).toBe(true);
  });
});
