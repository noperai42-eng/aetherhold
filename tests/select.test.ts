/**
 * Clicking on the map.
 *
 * The complaint, twice over: "I still can't select every square", then "even
 * items in the house are not selectable, or planted areas and such". The manager
 * resolved a click to a settler or a building and to nothing else, so a woodpile
 * on the floorboards, a furrow with wheat coming up in it, a rock somebody had
 * marked to mine and the bare yard all answered the same way — the panel went
 * away. Most of a colony is ground, and ground was not a thing you could ask
 * about.
 *
 * Ranked by what a wrong answer costs. Worst is the click that still lands on
 * nothing, because that is the bug itself. Next is the click that lands on the
 * wrong thing — a settler or a building the player aimed at losing to the grass
 * underneath would be a fix that broke everything that already worked. Then the
 * facts themselves: a square that reports no wood on a square with wood on it is
 * a readout nobody can trust twice. Last is the drag, which is the other half of
 * the same gesture — a press that moves the map must not also pick whatever it
 * happened to start on.
 */

import { describe, expect, it } from 'vitest';

import { ManagerCamera } from '../src/client/manager/camera';
import { ManagerController } from '../src/client/manager/controller';
import type { Input } from '../src/client/input/input';
import { cellFacts, type CellFacts } from '../src/client/ui/cell';
import { groundPanel } from '../src/client/ui/hud';
import { CROP_NONE, canSow } from '../src/sim/farming';
import { buildingAt } from '../src/sim/grid';
import { designate } from '../src/sim/orders';
import { addBuilding, addCellToZone, addItem, addZone, livingColonists } from '../src/sim/world';
import { DESIG_HARVEST, packCell, setTerrain, terrainAt, type World } from '../src/sim/types';
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

/** Point the camera at a cell and hand back the cell the centre of the screen now picks. */
function aim(cam: ManagerCamera, x: number, y: number): { x: number; y: number } {
  cam.focusOn(x, y);
  const hit = cam.pickCell(0, 0);
  if (!hit) throw new Error('the camera is not looking at the ground');
  return { x: hit.x, y: hit.y };
}

/**
 * A mouse click at the centre of the screen: down on one frame, up on the next.
 *
 * Two frames because that is the shape of the fix — the press is only held, and
 * nothing is chosen until the button comes back up and the travel is known.
 */
function click(world: World, ctl: ManagerController, moveX = 0): void {
  ctl.update(world, fakeInput({ clicked: (b: number) => b === 0 }), 0.05);
  if (moveX) {
    ctl.update(world, fakeInput({ mouseButtons: new Set([0]), moveX }), 0.05);
  }
  ctl.update(world, fakeInput({ released: (b: number) => b === 0 }), 0.05);
}

/** Open ground the camera can look straight at: no building, nothing lying on it. */
function bareGround(world: World, cam: ManagerCamera): { x: number; y: number } {
  for (let r = 2; r < 30; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r]] as const) {
      const x = Math.floor(world.width / 2) + dx;
      const y = Math.floor(world.height / 2) + dy;
      if (x < 2 || y < 2 || x > world.width - 3 || y > world.height - 3) continue;
      const at = aim(cam, x, y);
      if (buildingAt(world, at.x, at.y)) continue;
      if (!canSow(world, at.x, at.y)) continue;
      if (world.items.some((s) => s.x === at.x && s.y === at.y)) continue;
      if (world.pawns.some((p) => Math.round(p.x) === at.x && Math.round(p.y) === at.y)) continue;
      return at;
    }
  }
  throw new Error('nowhere on this map is bare');
}

describe('clicking on the map', () => {
  it('selects the square under a click on bare ground', () => {
    const { world, cam, ctl } = game();
    const at = bareGround(world, cam);

    click(world, ctl);

    // The whole bug in one assertion: this used to be null.
    expect(ctl.selection).toEqual({ type: 'cell', x: at.x, y: at.y });
  });

  it('still picks the settler and the building over the ground they stand on', () => {
    const { world, cam, ctl } = game();
    const pawn = livingColonists(world)[0]!;
    aim(cam, Math.round(pawn.x), Math.round(pawn.y));
    click(world, ctl);
    expect(ctl.selection).toEqual({ type: 'pawn', id: pawn.id });

    // A cell selection that shadowed the panels that already worked would be a
    // fix costing more than the thing it fixed.
    const spot = bareGround(world, cam);
    const wall = addBuilding(world, 'wall', spot.x, spot.y, true)!;
    aim(cam, spot.x, spot.y);
    click(world, ctl);
    expect(ctl.selection).toEqual({ type: 'building', id: wall.id });
  });

  it('moves the map on a drag, and picks nothing when it stops', () => {
    const { world, cam, ctl } = game();
    bareGround(world, cam);
    const before = { x: cam.state.targetX, y: cam.state.targetY };

    click(world, ctl, 120);

    expect(Math.hypot(cam.state.targetX - before.x, cam.state.targetY - before.y)).toBeGreaterThan(1);
    // Dragging the map is not an opinion about the square the hand started on.
    // Now that every square is selectable, a press that selected on the way down
    // would repaint the panel on every pan.
    expect(ctl.selection).toBe(null);
  });
});

describe('what a square says about itself', () => {
  it('reports the ground under an empty cell, and nothing it has not got', () => {
    const { world, cam } = game();
    const at = bareGround(world, cam);

    const c = cellFacts(world, at.x, at.y)!;
    expect(c.terrain).toBe(terrainAt(world, at.x, at.y));
    expect(c.walkable).toBe(true);
    expect(c.items).toEqual([]);
    expect(c.zone).toBeNull();
    expect(c.crop).toBeNull();
  });

  it('names what is lying there, biggest heap first, and ignores what is being carried', () => {
    const { world, cam } = game();
    const at = bareGround(world, cam);
    addItem(world, 'wood', 12, at.x, at.y);
    addItem(world, 'steel', 30, at.x, at.y);
    // In somebody's arms, standing on the same square. A hauler crossing the
    // yard is not a yard with steel in it, and a panel that counts them is a
    // panel that empties itself when they walk on.
    const carried = addItem(world, 'medicine', 5, at.x, at.y)!;
    carried.carriedBy = livingColonists(world)[0]!.id;

    const c = cellFacts(world, at.x, at.y)!;
    expect(c.items.map((s) => s.kind)).toEqual(['steel', 'wood']);
    expect(c.items[0]!.amount).toBe(30);
    expect(c.items.some((s) => s.kind === 'medicine')).toBe(false);
  });

  it('says whether a furrow is sown, how far on it is, and when it is ready', () => {
    const { world, cam } = game();
    const at = bareGround(world, cam);
    const z = addZone(world, 'growing', []);
    addCellToZone(world, z, at.x, at.y);

    const empty = cellFacts(world, at.x, at.y)!;
    expect(empty.zone).toEqual({ kind: 'growing', cells: 1 });
    // Nothing planted yet is a different sentence from nothing will ever grow
    // here, and the plot panel cannot tell the player which cell is which.
    expect(empty.crop).toBeNull();
    expect(empty.sowable).toBe(true);

    world.crops[packCell(world, at.x, at.y)] = 0.4;
    expect(cellFacts(world, at.x, at.y)!.crop).toBeCloseTo(0.4, 5);
    world.crops[packCell(world, at.x, at.y)] = 1;
    expect(cellFacts(world, at.x, at.y)!.crop).toBe(1);
  });

  it('admits when ground inside a field will never grow anything', () => {
    const { world, cam } = game();
    const at = bareGround(world, cam);
    const z = addZone(world, 'growing', []);
    addCellToZone(world, z, at.x, at.y);
    addBuilding(world, 'wall', at.x, at.y, true);

    const c = cellFacts(world, at.x, at.y)!;
    // A wall raised across a plot takes those cells out of production silently.
    // "Nothing sown yet" would be a panel waiting patiently for a crop that
    // cannot come, forever.
    expect(c.sowable).toBe(false);
    expect(c.walkable).toBe(false);
  });

  it('carries the order standing on a cell, and refuses cells that are not there', () => {
    const { world } = game();
    const rock = { x: -1, y: -1 };
    for (let y = 0; y < world.height && rock.x < 0; y++) {
      for (let x = 0; x < world.width; x++) {
        if (terrainAt(world, x, y) !== 'rock') continue;
        rock.x = x;
        rock.y = y;
        break;
      }
    }
    expect(rock.x).toBeGreaterThanOrEqual(0);
    expect(designate(world, rock.x, rock.y, DESIG_HARVEST)).toBe(true);
    // A rock is the case that made the complaint literal: it is neither a
    // settler nor a building, so clicking one used to say nothing at all — not
    // even that somebody had already been told to mine it.
    expect(cellFacts(world, rock.x, rock.y)!.desig).toBe(DESIG_HARVEST);
    expect(cellFacts(world, -1, 4)).toBeNull();
    expect(cellFacts(world, 4, world.height + 2)).toBeNull();
  });
});

/**
 * The panel's own words, which the facts above do not cover.
 *
 * "Why does something that is clearly growing some plants report as bare soil,
 * even though it shows crop 100% ripe, and it doesn't tell me what crop it is."
 * Every fact behind that panel was already right and already pinned — `crop` was
 * 1, `terrain` was dirt — and the player was still told the wrong thing, because
 * the reading of those facts was the part nobody had ever tested. So these read
 * the rendered panel, not the struct: they are the only pins in the suite that
 * can fail on a sentence.
 */
describe('what the panel says out loud', () => {
  /**
   * A furrow of the colony's crop, grown to `ripeness`.
   *
   * On dirt on purpose: "Bare soil" is the label the complaint names, and worked
   * ground is where a player meets it. Grass would pass the same assertions
   * against a different word and prove less.
   */
  function furrow(ripeness: number): { world: World; c: CellFacts } {
    const { world, cam } = game();
    const at = bareGround(world, cam);
    setTerrain(world, at.x, at.y, 'dirt');
    const z = addZone(world, 'growing', []);
    addCellToZone(world, z, at.x, at.y);
    world.crops[packCell(world, at.x, at.y)] = ripeness;
    return { world, c: cellFacts(world, at.x, at.y)! };
  }

  it('heads a ripe furrow with the crop, not with the dirt under it', () => {
    const { world, c } = furrow(1);
    const html = groundPanel(world, c);

    // The bug, exactly as reported: the title said "Bare soil" while the third
    // row of the same panel said the crop was ready to pull.
    expect(html).toContain('<h3>Fieldroot</h3>');
    expect(html, 'the ground took the title back off the crop').not.toContain('<h3>Bare soil</h3>');
    // The ground has not stopped being true — it moved to the sub line, which is
    // where a stack has always pushed it.
    expect(html).toContain('on bare soil');
    expect(html).toContain('ripe — ready to pull');
  });

  it('names the crop while it is still coming up', () => {
    const { world, c } = furrow(0.61);
    const html = groundPanel(world, c);
    expect(html).toContain('<h3>Fieldroot</h3>');
    // The label column carries the name, so the row reads as a fact about a
    // fieldroot rather than about the abstraction "crop".
    expect(html).toContain('<span>fieldroot</span>');
    expect(html).toContain('61% grown');
  });

  it('gives the title back to the ground when nothing is sown', () => {
    const { world, c } = furrow(0);
    // A cell inside a plot with no crop in it: `crops` holds 0 for sown, so an
    // unsown cell is CROP_NONE and `cellFacts` reports null.
    world.crops[packCell(world, c.x, c.y)] = CROP_NONE;
    const html = groundPanel(world, cellFacts(world, c.x, c.y)!);

    expect(html).toContain('<h3>Bare soil</h3>');
    expect(html).not.toContain('Fieldroot');
    // Nothing to name, so the label stays the abstraction.
    expect(html).toContain('<span>crop</span>');
    expect(html).toContain('nothing sown yet');
  });

  it('lets the harvest on the furrow take the title, and still names what grew there', () => {
    const { world, c } = furrow(1);
    addItem(world, 'rawfood', 8, c.x, c.y);
    const html = groundPanel(world, cellFacts(world, c.x, c.y)!);

    // One square, one answer, and a heap somebody just dropped is the newer
    // news. The crop is not lost with the title: the label column still has it,
    // which is the reason the name lives there and not only in the heading.
    expect(html).toContain('<h3>8 raw food</h3>');
    expect(html).toContain('<span>fieldroot</span>');
  });
});

describe('the square the player clicks', () => {
  it('answers with the woodpile on the floor of the house', () => {
    // The experience half, in the words of the complaint: items in the house
    // were not selectable. Put a stack down where somebody would put one, click
    // it the way a player clicks it, and read what comes back.
    const { world, cam, ctl } = game();
    const at = bareGround(world, cam);
    addItem(world, 'wood', 24, at.x, at.y);

    click(world, ctl);

    expect(ctl.selection?.type).toBe('cell');
    const sel = ctl.selection as { type: 'cell'; x: number; y: number };
    const c = cellFacts(world, sel.x, sel.y)!;
    expect(c.items[0]).toMatchObject({ kind: 'wood', amount: 24 });
  });
});
