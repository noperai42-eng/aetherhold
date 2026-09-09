/**
 * The body on the ground.
 *
 * "Should also be able to click on dead bodies and see what they are doing and
 * strip the bodies of clothes and items they are wearing." Half of that ask is a
 * simulation change and is not here. This is the other half, and it had two
 * defects rather than one: the click never reached a corpse, and even if it had,
 * the panel behind it was the living settler's card.
 *
 * Ranked by what a wrong answer costs. Worst is the click that still lands on
 * nothing, because that is the complaint verbatim. Next is the click that lands
 * on a body when the player was aiming at the doctor kneeling over it — a fix
 * that made the dead outrank the living would be worse than the bug, since the
 * living are the ones you can still give orders to. Then what the card says: a
 * corpse that reports no parka on a corpse in a parka is the readout the player
 * would have walked out there on. Last is what the card does *not* say, which is
 * every row that stopped having an answer when they died.
 */

import { describe, expect, it } from 'vitest';

import { ManagerCamera } from '../src/client/manager/camera';
import { ManagerController } from '../src/client/manager/controller';
import type { Input } from '../src/client/input/input';
import { corpsePanel } from '../src/client/ui/hud';
import { sceneByName } from '../src/review/scenes';
import { equip } from '../src/sim/gear';
import { remember } from '../src/sim/lifelog';
import { damagePawn } from '../src/sim/combat';
import { TICKS_PER_DAY, type Pawn, type World } from '../src/sim/types';
import { ROT_TICKS } from '../src/sim/graves';
import { createWorld } from '../src/sim/worldgen';

/** Only the fields the controller reads, as `tests/touch.test.ts` fakes them. */
function fakeInput(opts: Partial<Record<string, unknown>> = {}): Input {
  return {
    down: new Set<string>(),
    mouseButtons: new Set<number>(),
    wheel: 0,
    clientX: 0,
    clientY: 0,
    ndcX: 0,
    ndcY: 0,
    moveX: 0,
    moveY: 0,
    locked: false,
    touchSeen: false,
    tapped: false,
    dragging: false,
    dragStarted: false,
    dragEnded: false,
    dragAborted: false,
    panX: 0,
    panY: 0,
    zoomScale: 1,
    pressed: () => false,
    held: () => false,
    clicked: () => false,
    released: () => false,
    ...opts,
  } as unknown as Input;
}

function game(seed = 7): { world: World; cam: ManagerCamera; ctl: ManagerController } {
  const world = createWorld(seed);
  const cam = new ManagerCamera(world, { targetX: 32, targetY: 32, distance: 34, yaw: 0.8, pitch: 0.95 });
  cam.resize(1024 / 768);
  const ctl = new ManagerController(cam, { possess: () => {} });
  return { world, cam, ctl };
}

/** A mouse click at the centre of the screen: down on one frame, up on the next. */
function click(world: World, ctl: ManagerController): void {
  ctl.update(world, fakeInput({ clicked: (b: number) => b === 0 }), 0.05);
  ctl.update(world, fakeInput({ released: (b: number) => b === 0 }), 0.05);
}

/**
 * Stand somebody on the square the camera is pointed at.
 *
 * The click resolves against world coordinates, so the reliable way to aim one
 * at a specific person is to move the person under the crosshair rather than to
 * hunt for a camera angle that happens to contain them.
 */
function moveUnderCrosshair(cam: ManagerCamera, pawns: Pawn[]): { x: number; y: number } {
  const hit = cam.pickCell(0, 0);
  if (!hit) throw new Error('the camera is not looking at the ground');
  for (const p of pawns) {
    p.x = hit.x;
    p.y = hit.y;
  }
  return { x: hit.x, y: hit.y };
}

/** A settler off a fixture world, fitted and then killed. */
function corpse(fit: (world: World, p: Pawn) => void = () => {}): Pawn {
  const world = createWorld(20260729);
  const p = world.pawns[0];
  if (!p) throw new Error('fixture world landed no settlers');
  fit(world, p);
  damagePawn(world, p, 9999, 'a test');
  if (!p.dead) throw new Error('the fixture survived nine thousand damage');
  return p;
}

describe('clicking a body (experience)', () => {
  it('selects a dead colonist the player clicks on', () => {
    const { world, cam, ctl } = game();
    const dead = world.pawns.find((p) => p.faction === 'colony');
    if (!dead) throw new Error('fixture world landed no colonists');
    // Everybody else out of the way first, so the click has one candidate and a
    // pass is not an accident of who happened to be standing nearby.
    for (const p of world.pawns) {
      p.x = 1;
      p.y = 1;
    }
    moveUnderCrosshair(cam, [dead]);
    damagePawn(world, dead, 9999, 'a test');
    click(world, ctl);
    expect(ctl.selection).toEqual({ type: 'pawn', id: dead.id });
  });

  it('gives the click to the living one when a body is lying in the same place', () => {
    const { world, cam, ctl } = game();
    const [dead, alive] = world.pawns.filter((p) => p.faction === 'colony' && !p.animal);
    if (!dead || !alive) throw new Error('fixture world landed fewer than two colonists');
    for (const p of world.pawns) {
      p.x = 1;
      p.y = 1;
    }
    // Both on the same square, which is what the ward floor looks like while
    // somebody is being worked on. The doctor must not lose the click to the
    // patient who is past helping.
    moveUnderCrosshair(cam, [dead, alive]);
    damagePawn(world, dead, 9999, 'a test');
    click(world, ctl);
    expect(ctl.selection).toEqual({ type: 'pawn', id: alive.id });
  });
});

describe('what a body still has on (functional)', () => {
  it('names the person and says they are dead', () => {
    const p = corpse();
    const html = corpsePanel(p);
    expect(html).toContain(p.name);
    expect(html).toContain('dead');
  });

  it('lists the apparel and the gear that are still on them', () => {
    const p = corpse((_w, x) => {
      equip(x, 'parka');
      equip(x, 'toolbelt');
    });
    const html = corpsePanel(p);
    expect(html).toContain('fur parka');
    expect(html).toContain('toolbelt');
  });

  it('says so plainly when there is nothing on the body', () => {
    const p = corpse((_w, x) => {
      x.weapon = 'none';
    });
    expect(corpsePanel(p)).toContain('nothing');
  });

  it('prints the weapon only when they were carrying one', () => {
    const armed = corpse((_w, x) => void (x.weapon = 'rifle'));
    const unarmed = corpse((_w, x) => void (x.weapon = 'none'));
    expect(corpsePanel(armed)).toContain('rifle');
    expect(corpsePanel(unarmed)).not.toContain('weapon');
  });

  it('says where they are lying, so the player knows where to send somebody', () => {
    const p = corpse();
    p.x = 41.4;
    p.y = 17.6;
    expect(corpsePanel(p)).toContain('41, 18');
  });

  it('puts a clock on the kit, because that is what makes it a decision', () => {
    const p = corpse((_w, x) => void equip(x, 'plate'));
    // Nobody has touched the body yet, so the player has the whole four days.
    expect(p.rot ?? 0).toBe(0);
    expect(corpsePanel(p)).toContain('rots away in');
    // Days while there are days. "about 96 hours" is the same fact in a unit
    // nobody decides in.
    expect(corpsePanel(p)).toContain('4 days');
  });

  it('counts down in hours once the body is into its last day', () => {
    const p = corpse((_w, x) => void equip(x, 'plate'));
    p.rot = ROT_TICKS - Math.round(TICKS_PER_DAY / 8);
    const html = corpsePanel(p);
    expect(html).toContain('hours');
    expect(html).not.toContain('1 day');
  });

  it('takes the clock away once they are in the ground', () => {
    const p = corpse();
    p.buried = true;
    const html = corpsePanel(p);
    expect(html).not.toContain('rots away');
    expect(html).toContain('buried');
  });

  it('keeps their story, which is the one thing death does not take away', () => {
    const p = corpse((w, x) => remember(w, x, 'went out to the treeline when the shooting started'));
    expect(corpsePanel(p)).toContain('went out to the treeline when the shooting started');
  });
});

describe('what a body no longer has (experience)', () => {
  /*
   * The point of the card is as much what it leaves out as what it prints. A
   * corpse with a mood bar at zero and an empty errand line is not information,
   * it is the settler card with the person taken out of it, and it says
   * something false about somebody the player spent twenty days caring about.
   */
  const p = corpse((w, x) => {
    x.weapon = 'rifle';
    equip(x, 'plate');
    remember(w, x, 'came down with the founding');
  });
  const html = corpsePanel(p);

  for (const row of ['mood', 'rest', 'recreation', 'hunger', 'skills', 'bonds', 'sick of']) {
    it(`does not print a ${row} row on somebody who is dead`, () => {
      expect(html).not.toContain(row);
    });
  }

  it('offers nothing that only a living settler could do', () => {
    for (const act of ['Draft', 'Take over', 'Possess']) {
      expect(html).not.toContain(act);
    }
  });
});

describe('corpse review scenes (functional)', () => {
  it('stages a body that is still wearing something', () => {
    const scene = sceneByName('corpse-with-kit');
    if (!scene) throw new Error('the corpse scene is not registered');
    const html = scene.render();
    expect(html).toContain('fur parka');
    expect(html).toContain('toolbelt');
    expect(html).toContain('dead');
  });

  it('stages the empty case, and it is still worth opening', () => {
    const scene = sceneByName('corpse-stripped');
    if (!scene) throw new Error('the stripped corpse scene is not registered');
    const html = scene.render();
    expect(html).toContain('nothing');
    expect(html).toContain('dead');
  });

  it('draws the same frame twice, which is what the look loop compares', () => {
    const scene = sceneByName('corpse-with-kit');
    if (!scene) throw new Error('the corpse scene is not registered');
    expect(scene.render()).toBe(scene.render());
  });
});
