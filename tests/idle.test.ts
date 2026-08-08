/**
 * "Why isn't anybody building my wall?"
 *
 * The one question this game could not answer. A settler with no work said
 * `idle`, which is the question restated, and the player's only recourse was to
 * guess: wrong priority? no wood? walled off? All three are already knowable from
 * state, and `sim/idle.ts` is the sentence that says which.
 *
 * What is pinned here is *honesty*, not wording. Every branch makes a claim about
 * the world — "short twelve wood", "cannot reach" — and a wrong claim is worse
 * than the silence it replaced, because the player will act on it. So the
 * mechanical block below builds each situation and checks the sentence names the
 * real cause, and the last block plays it as a player would live it: an
 * unaffordable blueprint, a colony standing about, the game saying why, the
 * player fixing it, and the wall going up.
 */

import { describe, expect, it } from 'vitest';

import { isWalkable } from '../src/sim/grid';
import { idleReason } from '../src/sim/idle';
import { makeStreams, stepWorldN } from '../src/sim/tick';
import { WORK_TYPES, type Pawn, type World } from '../src/sim/types';
import { addBuilding, addItem, livingColonists } from '../src/sim/world';
import { HOME_X, HOME_Y, createWorld } from '../src/sim/worldgen';

/**
 * A square of clear ground with room to work in, found rather than assumed.
 *
 * `r` is the half-width: `clearSpot(world, 1)` finds a cell whose whole 3×3 is
 * walkable and building-free. Searched outward from the cabin so the answer is
 * near the colonists but never on top of them, and it throws rather than
 * returning a bad cell — a test that quietly places its wall inside the lake is
 * a test that fails for a reason nobody can read.
 */
function clearSpot(world: World, r: number): { x: number; y: number } {
  for (let ring = 12; ring < 60; ring++) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const cx = HOME_X + dx * ring;
      const cy = HOME_Y + dy * ring;
      let ok = true;
      for (let y = cy - r; y <= cy + r && ok; y++) {
        for (let x = cx - r; x <= cx + r && ok; x++) {
          if (!isWalkable(world, x, y)) ok = false;
          if (world.buildings.some((b) => b.x === x && b.y === y)) ok = false;
        }
      }
      if (ok) return { x: cx, y: cy };
    }
  }
  throw new Error('no clear ground near the cabin');
}

/** A settler on the work board with nothing in their hands: the case this is for. */
function freeSettler(world: World): Pawn {
  const p = livingColonists(world)[0]!;
  p.jobId = null;
  p.drafted = false;
  p.manual = false;
  p.activity = 'idle';
  return p;
}

/** Switch every kind of work off, so a test can turn back on only what it means. */
function allOff(pawn: Pawn): void {
  for (const w of WORK_TYPES) pawn.priorities[w] = 0;
}

describe('why a settler has nothing to do', () => {
  it('says nothing about a settler who is already busy or already explained', () => {
    const world = createWorld(4242);
    const p = freeSettler(world);

    p.jobId = 7;
    expect(idleReason(world, p)).toBeNull();

    p.jobId = null;
    p.drafted = true;
    expect(idleReason(world, p)).toBeNull();

    p.drafted = false;
    p.manual = true;
    expect(idleReason(world, p)).toBeNull();

    p.manual = false;
    p.activity = 'sleeping';
    expect(idleReason(world, p)).toBeNull();

    // And never about the wild or the raid — this is a settler card feature.
    p.activity = 'idle';
    const beast = world.pawns.find((q) => q.faction === 'fauna');
    if (beast) expect(idleReason(world, beast)).toBeNull();
  });

  it('still speaks for the settler the empty board sent to sit down', () => {
    const world = createWorld(4249);
    const p = freeSettler(world);
    p.priorities.construct = 2;
    world.items = [];
    const spot = clearSpot(world, 0);
    expect(addBuilding(world, 'wall', spot.x, spot.y, false)).not.toBeNull();
    // What `assignJob` does with an empty board: a seat, rather than standing in
    // the yard losing morale over work that does not exist.
    world.jobs.push({
      id: 9001,
      kind: 'recreate',
      pawnId: p.id,
      stage: 'goto',
      tx: p.x,
      ty: p.y,
      progress: 0,
      age: 0,
    });
    p.jobId = 9001;
    expect(idleReason(world, p)).toBe('the blueprints are short 5 wood.');

    // But only for claims about the colony. With the board clear there is no
    // longer any way to know whether this settler is at the table because there
    // was nothing to do or because they had earned it, so it says nothing.
    world.buildings = world.buildings.filter((b) => b.built);
    expect(idleReason(world, p)).toBeNull();

    // Anything that is not a seat is work, and work is not silence's business.
    world.jobs[world.jobs.length - 1]!.kind = 'haulToStockpile';
    expect(idleReason(world, p)).toBeNull();
  });

  it('names the Work tab when every job is switched off', () => {
    const world = createWorld(4243);
    const p = freeSettler(world);
    allOff(p);
    expect(idleReason(world, p)).toBe('every kind of work is switched off in their Work tab.');
  });

  it('names the switch before it names the colony, when both are true', () => {
    const world = createWorld(4244);
    const p = freeSettler(world);
    const spot = clearSpot(world, 0);
    // Unaffordable *and* switched off. The colony being out of wood is true of
    // everybody; construction being off is true of the settler the player has
    // open, and that is the one they can fix from the card in front of them.
    world.items = [];
    expect(addBuilding(world, 'wall', spot.x, spot.y, false)).not.toBeNull();
    p.priorities.construct = 0;
    expect(idleReason(world, p)).toBe('1 blueprint is up, but building is switched off for them.');

    p.priorities.construct = 2;
    expect(idleReason(world, p)).toBe('the blueprints are short 5 wood.');
  });

  it('counts the shortfall across every blueprint, against every stack on the map', () => {
    const world = createWorld(4245);
    const p = freeSettler(world);
    p.priorities.construct = 2;
    world.items = [];
    const spot = clearSpot(world, 1);
    for (let i = 0; i < 3; i++) {
      expect(addBuilding(world, 'wall', spot.x + i - 1, spot.y, false)).not.toBeNull();
    }
    // Fifteen wanted, none held.
    expect(idleReason(world, p)).toBe('the blueprints are short 15 wood.');

    // Wood in a hauler's arms is wood the colony has. Counting only free stacks
    // here would tell the player to go and cut trees while a settler walked past
    // them carrying the last of it to the very blueprint in question.
    const carried = addItem(world, 'wood', 9, spot.x + 4, spot.y)!;
    carried.carriedBy = p.id;
    carried.reservedBy = 99;
    expect(idleReason(world, p)).toBe('the blueprints are short 6 wood.');

    addItem(world, 'wood', 6, spot.x + 4, spot.y + 1);
    expect(idleReason(world, p)).not.toContain('short');
  });

  it('says walled off only when the walls are really in the way', () => {
    const world = createWorld(4246);
    const p = freeSettler(world);
    p.priorities.construct = 2;
    const spot = clearSpot(world, 2);
    const bp = addBuilding(world, 'wall', spot.x, spot.y, false)!;
    // Delivered, so the material branch above cannot answer for this one — an
    // empty `needs` is what the sim itself calls a satisfied blueprint.
    bp.needs = {};
    p.x = spot.x + 6;
    p.y = spot.y + 6;
    expect(idleReason(world, p)).not.toContain('reach');

    // Now ring it. Nothing can stand next to it, so no settler can ever work it,
    // and the only cell left in its region is the blueprint's own.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        expect(addBuilding(world, 'wall', spot.x + dx, spot.y + dy, true)).not.toBeNull();
      }
    }
    expect(idleReason(world, p)).toBe(
      'they cannot reach any of the blueprints from where they are standing.',
    );

    // A settler standing inside a wall has a bigger problem than the blueprint,
    // and "you cannot reach it" would be answering the wrong question.
    p.x = spot.x + 1;
    p.y = spot.y + 1;
    expect(idleReason(world, p)).not.toContain('reach');
  });

  it('reads back a narrow work list, and falls through to the board when it is wide', () => {
    const world = createWorld(4247);
    const p = freeSettler(world);
    allOff(p);
    p.priorities.cook = 1;
    p.priorities.doctor = 1;
    // Read back in board order, not the order the test set them: the list is a
    // readout of the Work tab and has to agree with it.
    expect(idleReason(world, p)).toBe('only doctoring and cooking are switched on for them.');

    p.priorities.haul = 1;
    expect(idleReason(world, p)).toBe(
      'only doctoring, cooking and hauling are switched on for them.',
    );

    // Wide open and nothing standing: the honest answer is that the colony has
    // run out of things to want, which is an instruction to the player.
    for (const w of WORK_TYPES) p.priorities[w] = 2;
    expect(idleReason(world, p)).toBe(
      'nothing on the board they can take — put up a blueprint, or set a bill at a bench.',
    );
  });
});

describe('living through it', () => {
  /**
   * The whole loop, as a player meets it: put up a wall the colony cannot pay
   * for, watch everybody stand about, read why, fix it, watch the wall go up.
   *
   * The colony is narrowed to construction on purpose. A real colony with an
   * unaffordable blueprint goes and chops trees instead — which is the right
   * behaviour and is why the message is rare — and a test that waited for
   * genuine idleness would be waiting on the woodcutting AI rather than on this.
   * Switching the rest of the board off produces the same standing-about the
   * player sees when they have run their colony into a corner, in ten seconds.
   */
  it('tells the colony why the wall is not going up, and stops once it is', () => {
    const world = createWorld(20260801);
    const streams = makeStreams(world);
    const spot = clearSpot(world, 1);
    world.items = world.items.filter((s) => s.kind !== 'wood');
    for (const p of livingColonists(world)) {
      allOff(p);
      p.priorities.construct = 1;
    }
    const bp = addBuilding(world, 'wall', spot.x, spot.y, false)!;

    stepWorldN(world, streams, 200);
    const said = livingColonists(world)
      .map((p) => idleReason(world, p))
      .filter((s): s is string => s !== null);
    expect(said.length).toBeGreaterThan(0);
    expect(said.every((s) => s === 'the blueprints are short 5 wood.')).toBe(true);
    expect(bp.built).toBe(false);

    // The player does the thing the sentence told them to.
    addItem(world, 'wood', 20, spot.x + 1, spot.y + 1);
    expect(
      livingColonists(world)
        .map((p) => idleReason(world, p))
        .every((s) => s === null || !s.includes('short')),
    ).toBe(true);

    stepWorldN(world, streams, 1200);
    expect(bp.built).toBe(true);
    // And with the wall up and the board bare, the card stops talking about wood
    // and starts talking about the only switch left on — which is the truth.
    for (const p of livingColonists(world)) {
      const why = idleReason(world, p);
      if (why !== null) expect(why).toBe('only building is switched on for them.');
    }
  });
});
