/**
 * The map of the valley.
 *
 * Ranked by what it would cost a player if it broke. Worst is a minimap that
 * draws things standing on ground the colony has not seen: the shroud in the 3D
 * view hides a raider completely, so a dot here would be the interface quietly
 * overruling the game, and every reason to send anybody scouting would go with
 * it. Next is a click landing on the wrong cell, because a map you cannot trust
 * to take you where you pointed is worse than no map. Then the change detector,
 * since the whole panel is redrawn off one number and a signature that stopped
 * moving would freeze the map on the morning the colony landed. Then the
 * colours, which are the only thing tying this drawing to the world it is a
 * drawing of.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/sim/worldgen';
import { makeStreams, stepWorld, stepWorldN } from '../src/sim/tick';
import { isSeen, revealAround } from '../src/sim/explore';
import { livingColonists } from '../src/sim/world';
import * as THREE from 'three';
import { TERRAIN_LIST, TICKS_PER_DAY } from '../src/sim/types';
import { yearPhase } from '../src/sim/seasons';
import { BUILDING_COLOR, TERRAIN_COLOR, groundColor } from '../src/client/render/palette';
import {
  MARK_COLOR,
  UNSEEN,
  cellAt,
  mapBuffer,
  mapSignature,
  marksOf,
  paintMap,
} from '../src/client/ui/minimap';
import { ManagerCamera } from '../src/client/manager/camera';
import type { Terrain, World } from '../src/sim/types';

/** The colour actually written at a cell, as one number. */
function pixelAt(world: World, buf: Uint8ClampedArray, x: number, y: number): number {
  const p = (y * world.width + x) * 4;
  return (buf[p]! << 16) | (buf[p + 1]! << 8) | buf[p + 2]!;
}

function painted(world: World): Uint8ClampedArray {
  const buf = mapBuffer(world);
  paintMap(world, buf);
  return buf;
}

function opened(seed: number, ticks = 1): World {
  const world = createWorld(seed);
  stepWorldN(world, makeStreams(world), ticks);
  return world;
}

/** A cell the colony has never laid eyes on, hunted from the far corner inward. */
function darkCell(world: World): { x: number; y: number } {
  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      if (!isSeen(world, x, y)) return { x, y };
    }
  }
  throw new Error('the whole map is lit');
}

describe('the ground the map draws', () => {
  it('gives every cell an opaque pixel', () => {
    const world = opened(31);
    const buf = painted(world);
    expect(buf.length).toBe(world.width * world.height * 4);
    for (let i = 3; i < buf.length; i += 4) {
      if (buf[i] !== 255) throw new Error(`cell ${(i - 3) / 4} was left transparent`);
    }
  });

  it('draws walked ground in the terrain colour and unwalked ground in neither', () => {
    const world = opened(31);
    const buf = painted(world);

    const home = livingColonists(world)[0]!;
    const hx = Math.round(home.x);
    const hy = Math.round(home.y);
    const ground = TERRAIN_COLOR[TERRAIN_LIST[world.terrain[hy * world.width + hx]!]!];
    // Lifted for legibility on a dark panel, so it is not the palette entry
    // exactly — but it is that colour and not some other, which is what the
    // player is entitled to: greener than it is red, and brighter than raw.
    const lit = pixelAt(world, buf, hx, hy);
    expect(lit).not.toBe(ground);
    expect(brightness(lit)).toBeGreaterThan(brightness(ground));
    expect(hueOrder(lit)).toEqual(hueOrder(ground));

    const dark = darkCell(world);
    const unseen = pixelAt(world, buf, dark.x, dark.y);
    const there = TERRAIN_COLOR[TERRAIN_LIST[world.terrain[dark.y * world.width + dark.x]!]!];
    expect(unseen).not.toBe(there);
    // Every unwalked cell is the same colour, whatever is underneath it. That is
    // the point: the haze is the absence of information, not a darker rendering
    // of information the player is not supposed to have.
    const second = darkerCells(world, buf, dark);
    expect(second).toBe(unseen);
  });

  it('shows what the colony has built, and shows plans differently', () => {
    const world = opened(31);
    const wall = world.buildings.find((b) => b.built && b.kind !== 'tree')!;
    const buf = painted(world);
    expect(pixelAt(world, buf, wall.x, wall.y)).toBe(lift(BUILDING_COLOR[wall.kind]));

    // A blueprint is half the ground it stands on, so a base full of plans reads
    // as a base full of plans rather than as a base.
    wall.built = false;
    const after = painted(world);
    const drawn = pixelAt(world, after, wall.x, wall.y);
    expect(drawn).not.toBe(lift(BUILDING_COLOR[wall.kind]));
    expect(drawn).not.toBe(pixelAt(world, buf, wall.x + 3, wall.y + 3));
  });

  it('leaves a building standing in the dark out of the picture', () => {
    const world = opened(31);
    const dark = darkCell(world);
    const tree = world.buildings.find((b) => b.kind === 'tree')!;
    tree.x = dark.x;
    tree.y = dark.y;

    const buf = painted(world);
    // Same colour as every other unwalked cell — no shape leaking through.
    expect(pixelAt(world, buf, dark.x, dark.y)).toBe(darkerCells(world, buf, dark));
  });
});

describe('the year on the map', () => {
  /** Put a known terrain at a known cell and light it, so colours compare like for like. */
  function litCell(world: World, x: number, y: number, kind: Terrain): void {
    world.terrain[y * world.width + x] = TERRAIN_LIST.indexOf(kind);
    revealAround(world, x, y, 2);
  }

  function mapOn(day: number): { grass: number; stone: number } {
    const world = createWorld(31);
    world.tick = (day - 1) * TICKS_PER_DAY;
    litCell(world, 10, 10, 'grass');
    litCell(world, 14, 10, 'stone');
    const buf = painted(world);
    return { grass: pixelAt(world, buf, 10, 10), stone: pixelAt(world, buf, 14, 10) };
  }

  it('turns the living ground with the season and leaves the rock alone', () => {
    const summer = mapOn(3);
    const winter = mapOn(13);

    // The whole point of the change: a player glancing at the corner in November
    // sees a different valley from the one they landed in.
    expect(winter.grass).not.toBe(summer.grass);
    expect(brightness(winter.grass)).toBeGreaterThan(brightness(summer.grass));
    // A boulder has no season. If stone drifted too, the map would be reading as
    // a global colour wash — a display fault — rather than as the ground living.
    expect(winter.stone).toBe(summer.stone);

    // Autumn and spring are the same temperature and must not be the same colour,
    // because "which way is the year going" is the thing the player needs to know.
    const autumn = mapOn(8);
    const spring = mapOn(18);
    expect(autumn.grass).not.toBe(spring.grass);
    // `hueOrder` ranks the channels, so [0] is 0 for red and 1 for green: an
    // October pixel is more red than anything else, an April one still moss.
    expect(hueOrder(autumn.grass)[0]).toBe(0);
    expect(hueOrder(spring.grass)[0]).toBe(1);
  });

  it('paints the same colour the 3D valley is painting', () => {
    // The one assertion that keeps the two drawings from forking. Not a repeat of
    // the tint's own tests: this pins that the map goes through `groundColor` at
    // all, so a change to the season palette can never move one view and not the
    // other. Lifted, because a dark panel needs it — but lifted from the tinted
    // colour, not from the palette entry.
    const world = createWorld(31);
    world.tick = 12 * TICKS_PER_DAY;
    // With snow down, so the fork this guards against covers the pack as well as
    // the season — the map in the corner has to go white on the same day the
    // valley does, for the same reason it has to go gold on the same day.
    world.snow = 0.7;
    litCell(world, 10, 10, 'grass');
    const wanted = groundColor(new THREE.Color(), 'grass', yearPhase(world), 0.7).getHex();
    expect(pixelAt(world, painted(world), 10, 10)).toBe(lift(wanted));
  });

  it('redraws the panel as the year moves, and not on every frame', () => {
    const world = createWorld(31);
    const landed = mapSignature(world);

    // Far enough into winter to be a different colour, so the panel must repaint.
    world.tick = 12 * TICKS_PER_DAY;
    expect(mapSignature(world)).not.toBe(landed);

    // One tick later it is the same sixty-fourth of the year, and repainting nine
    // thousand pixels to draw exactly what is already there is the cost this
    // number exists to avoid.
    const winter = mapSignature(world);
    world.tick += 1;
    expect(mapSignature(world)).toBe(winter);
  });
});

describe('what the colony has not seen is not on the map', () => {
  it('does not put a body on ground nobody has walked to', () => {
    const world = opened(31);
    const dark = darkCell(world);
    const beast = world.pawns.find((p) => p.faction === 'fauna' && !p.dead)!;
    beast.x = dark.x;
    beast.y = dark.y;

    expect(markAt(world, dark)).toBeUndefined();
    // And the moment somebody has eyes on that ground, there it is.
    revealAround(world, dark.x, dark.y, 3);
    expect(markAt(world, dark)).toBeDefined();
  });

  it('does not put a landmark on the map before it has been sighted', () => {
    const world = opened(31);
    const site = world.sites.find((s) => !isSeen(world, s.x, s.y))!;
    expect(markAt(world, site)).toBeUndefined();

    revealAround(world, site.x, site.y, 2);
    const mark = markAt(world, site)!;
    // Amber while it is still an invitation; drab once somebody has read it.
    expect(mark.color).toBe(MARK_COLOR.site);
    site.found = true;
    expect(markAt(world, site)!.color).toBe(MARK_COLOR.siteRead);
  });
});

describe('the dots', () => {
  it('gives every settler one, and says which are down', () => {
    const world = opened(31);
    const people = livingColonists(world).filter((p) => !p.animal);
    const marks = marksOf(world, null);
    expect(people.length).toBeGreaterThan(0);
    for (const p of people) {
      const at = marks.filter((m) => m.x === Math.round(p.x) && m.y === Math.round(p.y));
      expect(at.some((m) => m.color === MARK_COLOR.settler)).toBe(true);
    }

    const hurt = people[0]!;
    hurt.downed = true;
    const after = marksOf(world, null).filter(
      (m) => m.x === Math.round(hurt.x) && m.y === Math.round(hurt.y),
    );
    expect(after.some((m) => m.color === MARK_COLOR.downed)).toBe(true);
  });

  it('draws the fire over the settler fighting it', () => {
    const world = opened(31);
    const p = livingColonists(world)[0]!;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    world.fires.push({ id: 9001, x, y, size: 0.5 });

    const marks = marksOf(world, null);
    const person = marks.findIndex((m) => m.color === MARK_COLOR.settler && m.x === x && m.y === y);
    const fire = marks.findIndex((m) => m.color === MARK_COLOR.fire);
    expect(person).toBeGreaterThanOrEqual(0);
    // Later in the list is later onto the canvas. The thing the player has to act
    // on must never end up underneath the person already acting on it.
    expect(fire).toBeGreaterThan(person);
  });

  it('puts the body the player is inside on top of everything', () => {
    const world = opened(31);
    const p = livingColonists(world)[0]!;
    const marks = marksOf(world, p.id);
    const last = marks[marks.length - 1]!;
    expect(last.color).toBe(MARK_COLOR.self);
    expect(last.size).toBe(3);
    expect(last.x).toBe(Math.round(p.x));
    // Exactly one white dot: the possessed body is not also drawn as a settler.
    expect(marks.filter((m) => m.color === MARK_COLOR.self).length).toBe(1);
  });

  it('leaves the dead off it', () => {
    const world = opened(31);
    const p = livingColonists(world)[0]!;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    p.dead = true;
    const marks = marksOf(world, null).filter((m) => m.x === x && m.y === y);
    expect(marks.some((m) => m.color === MARK_COLOR.settler)).toBe(false);
  });
});

describe('the number the panel redraws off', () => {
  it('is the same for the same colony and moves when the map opens up', () => {
    const a = opened(4242, 600);
    const b = opened(4242, 600);
    expect(mapSignature(a)).toBe(mapSignature(b));

    const before = mapSignature(a);
    revealAround(a, 4, 4, 5);
    expect(mapSignature(a)).not.toBe(before);
  });

  it('moves when a plan turns into a building', () => {
    const world = opened(31);
    const b = world.buildings.find((one) => one.built && one.kind !== 'tree')!;
    const before = mapSignature(world);
    b.built = false;
    expect(mapSignature(world)).not.toBe(before);
  });

  it('moves when the colony lays a floor', () => {
    const world = opened(31);
    const before = mapSignature(world);
    const i = world.height * 40 + 40;
    world.terrain[i] = TERRAIN_LIST.indexOf('plank');
    expect(mapSignature(world)).not.toBe(before);
  });
});

describe('pointing at the map', () => {
  it('lands on the cell under the thumb', () => {
    const world = createWorld(1);
    expect(cellAt(world, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(cellAt(world, 0.5, 0.5)).toEqual({ x: world.width / 2, y: world.height / 2 });
    // Fractions come from a bounding rectangle, so the far edge is exactly 1 and
    // has to resolve to the last cell rather than to one past the end.
    expect(cellAt(world, 1, 1)).toEqual({ x: world.width - 1, y: world.height - 1 });
  });

  it('takes a thumb that slipped off the edge as the nearest cell', () => {
    const world = createWorld(1);
    expect(cellAt(world, -0.02, 0.5)).toEqual({ x: 0, y: world.height / 2 });
    expect(cellAt(world, 1.4, 2)).toEqual({ x: world.width - 1, y: world.height - 1 });
  });
});

describe('the rectangle showing where the colony camera is looking', () => {
  const world = createWorld(1);

  it('is four corners of ground with the camera target inside it', () => {
    const cam = new ManagerCamera(world, {
      targetX: 48,
      targetY: 48,
      distance: 30,
      yaw: 0.6,
      pitch: 1.0,
    });
    const quad = cam.viewQuad()!;
    expect(quad).toHaveLength(4);
    for (const p of quad) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // The camera looks at its target, so the target is the middle of the screen.
    // A quad that did not contain it would be drawn somewhere the player is not.
    expect(inside(quad, 48, 48)).toBe(true);
  });

  it('grows when the camera pulls back', () => {
    const near = new ManagerCamera(world, {
      targetX: 48,
      targetY: 48,
      distance: 12,
      yaw: 0,
      pitch: 1.2,
    });
    const far = new ManagerCamera(world, {
      targetX: 48,
      targetY: 48,
      distance: 60,
      yaw: 0,
      pitch: 1.2,
    });
    expect(area(far.viewQuad()!)).toBeGreaterThan(area(near.viewQuad()!) * 3);
  });

  it('turns with the camera', () => {
    const a = new ManagerCamera(world, {
      targetX: 48,
      targetY: 48,
      distance: 30,
      yaw: 0,
      pitch: 1.0,
    });
    const b = new ManagerCamera(world, {
      targetX: 48,
      targetY: 48,
      distance: 30,
      yaw: Math.PI / 2,
      pitch: 1.0,
    });
    const qa = a.viewQuad()!;
    const qb = b.viewQuad()!;
    expect(qa[0]!.x).not.toBeCloseTo(qb[0]!.x, 1);
    // A quarter turn is a rotation, not a resize.
    expect(area(qa)).toBeCloseTo(area(qb), 1);
  });

  it('still answers the same cell the player clicked', () => {
    const cam = new ManagerCamera(world, {
      targetX: 30,
      targetY: 62,
      distance: 25,
      yaw: 0.9,
      pitch: 1.1,
    });
    // The middle of the screen is what the camera is pointed at, and `pickCell`
    // now goes through the same plane hit the viewport rectangle does.
    expect(cam.pickCell(0, 0)).toEqual({ x: 30, y: 62, wx: expect.closeTo(30, 4), wy: expect.closeTo(62, 4) });
    // And the two picks part company in exactly one place, on purpose. Pulled
    // out and tipped over, the top of the screen shows ground well past the edge
    // of the world: the viewport rectangle has to be drawn out there or it would
    // claim the player sees less than they do, and a click out there is still
    // not an order.
    const wide = new ManagerCamera(world, {
      targetX: 48,
      targetY: 48,
      distance: 60,
      yaw: 0,
      pitch: 0.42,
    });
    const horizon = wide.groundAt(0, 1)!;
    expect(horizon.x).toBeLessThan(0);
    expect(wide.pickCell(0, 1)).toBe(null);
  });
});

describe('a map of a colony that has been played', () => {
  it('opens up as the colony works and never redraws for nothing', () => {
    const world = createWorld(20260802);
    const streams = makeStreams(world);
    stepWorld(world, streams);

    const first = painted(world);
    const litAtDawn = countLit(world, first);
    stepWorldN(world, streams, 4800 * 2);
    const later = painted(world);
    expect(countLit(world, later)).toBeGreaterThan(litAtDawn);

    // Two paints of the same unchanged world are the same picture, which is what
    // makes the signature safe to skip a redraw on.
    const again = painted(world);
    expect(Array.from(again)).toEqual(Array.from(later));
    expect(mapSignature(world)).toBe(mapSignature(world));
  });
});

// ------------------------------------------------------------------- helpers

function lift(color: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * 1.25));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * 1.25));
  const b = Math.min(255, Math.round((color & 255) * 1.25));
  return (r << 16) | (g << 8) | b;
}

function brightness(c: number): number {
  return ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
}

/** Which channel is biggest, then next — enough to say "still the same colour". */
function hueOrder(c: number): number[] {
  const ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  return ch
    .map((v, i) => [v, i] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
}

/** Some other unwalked cell, so two of them can be compared. */
function darkerCells(world: World, buf: Uint8ClampedArray, not: { x: number; y: number }): number {
  for (let y = world.height - 2; y > 0; y--) {
    for (let x = world.width - 2; x > 0; x--) {
      if (x === not.x && y === not.y) continue;
      if (!isSeen(world, x, y)) return pixelAt(world, buf, x, y);
    }
  }
  throw new Error('needed a second unwalked cell and there was only one');
}

function markAt(world: World, at: { x: number; y: number }) {
  return marksOf(world, null).find((m) => m.x === at.x && m.y === at.y);
}

function countLit(world: World, buf: Uint8ClampedArray): number {
  let n = 0;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) if (pixelAt(world, buf, x, y) !== UNSEEN) n++;
  }
  return n;
}

function area(quad: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % quad.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function inside(quad: { x: number; y: number }[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const a = quad[i]!;
    const b = quad[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
