/**
 * The colony manager's hands. Every mutation it performs goes through `orders.ts`,
 * the same command surface the first-person view uses — the manager has no private
 * powers over the world beyond the ones a player standing in the base would have.
 */

import { BUILD_MENU, defOf } from '../../sim/buildings';
import { canSow, canTill } from '../../sim/farming';
import {
  DESIG_DECONSTRUCT,
  DESIG_HARVEST,
  DESIG_NONE,
  DESIG_TILL,
  terrainAt,
} from '../../sim/types';
import { FLOOR_DEFS, canFloor, canRemoveFloor, desigForFloor } from '../../sim/floors';
import type { FloorKind } from '../../sim/types';
import { buildingAt, dist, isWalkable } from '../../sim/grid';
import {
  cancelAt,
  canPlace,
  designate,
  eraseZone,
  orderJob,
  orderMove,
  paintGrowingZone,
  paintPenZone,
  paintStockpile,
  placeBlueprint,
  markHunt,
  markTame,
  setDrafted,
  unreachableRock,
} from '../../sim/orders';
import { PEN_CELLS_PER_HEAD, hasPen, penCapacity } from '../../sim/livestock';
import { buildingUnlocked } from '../../sim/research';
import { summonPicky } from '../../sim/pickies';
import { countResource, findPawn, livingColonists, msg } from '../../sim/world';
import type { BuildingKind, World } from '../../sim/types';
import type { Input } from '../input/input';
import type { ManagerCamera } from './camera';

export type Tool =
  | 'select'
  | 'build'
  | 'stockpile'
  | 'grow'
  | 'pen'
  | 'till'
  | 'floorPlank'
  | 'floorPaved'
  | 'floorBridge'
  | 'harvest'
  | 'hunt'
  | 'tame'
  | 'deconstruct'
  | 'cancel'
  | 'picky';

/**
 * What the player has clicked on.
 *
 * `cell` is the one that has no id, and it is the reason this is a union rather
 * than the pair it used to be: a click that landed on grass, on a woodpile or on
 * a furrow used to resolve to nothing at all, so the panel went away and the
 * player learned that most of the map is not a thing. A square is a thing.
 */
export type Selection =
  | { type: 'pawn'; id: number }
  | { type: 'building'; id: number }
  | { type: 'cell'; x: number; y: number };

interface Hooks {
  possess(pawnId: number): void;
}

const PAN_SPEED = 0.55; // cells per second per unit of camera distance
const ORBIT_SPEED = 1.5;
/**
 * Pixels of travel a left press may have and still count as a click rather than
 * a drag of the map. A hand on a mouse is never perfectly still, and a couple of
 * pixels of shake should not cost the player the square they aimed at.
 */
const CLICK_SLOP = 6;

/**
 * Which floor each floor tool lays.
 *
 * One table rather than a ternary repeated at three call sites — the preview, the
 * drag, and the message afterwards all have to agree about what the player is
 * painting, and a two-way ternary silently became wrong the moment there were
 * three of them.
 */
const FLOOR_TOOL: Partial<Record<Tool, FloorKind>> = {
  floorPlank: 'plank',
  floorPaved: 'paved',
  floorBridge: 'bridge',
};

export class ManagerController {
  selection: Selection | null = null;
  tool: Tool = 'select';
  buildKind: BuildingKind | null = null;
  /** Cells the pending drag would affect, for the rectangle preview. */
  preview: { x: number; y: number; valid: boolean }[] = [];
  hoverCell: { x: number; y: number } | null = null;

  private dragStart: { x: number; y: number } | null = null;
  /** Where the left button went down with the select tool armed, until it comes up. */
  private pressed: { x: number; y: number; wx: number; wy: number } | null = null;
  /** How far the mouse has travelled since it did, in pixels. */
  private pressTravel = 0;
  /** Held shift at drag start: paints in reverse (erase zone cells). */
  private eraseDrag = false;
  private readonly cam: ManagerCamera;
  private readonly hooks: Hooks;

  constructor(cam: ManagerCamera, hooks: Hooks) {
    this.cam = cam;
    this.hooks = hooks;
  }

  setTool(tool: Tool, kind: BuildingKind | null = null): void {
    this.tool = tool;
    this.buildKind = kind;
    this.dragStart = null;
    this.pressed = null;
    this.preview = [];
  }

  update(world: World, input: Input, dt: number): void {
    this.moveCamera(input, dt);
    this.hotkeys(world, input);

    const hit = this.cam.pickCell(input.ndcX, input.ndcY);
    this.hoverCell = hit ? { x: hit.x, y: hit.y } : null;

    // Middle-drag pans; that is muscle memory from every strategy game.
    if (input.mouseButtons.has(1) && (input.moveX || input.moveY)) {
      const k = this.cam.state.distance * 0.0018;
      this.cam.pan(-input.moveX * k, input.moveY * k);
    }

    this.touch(world, input, hit);

    if (input.clicked(0) && hit) {
      if (this.tool === 'select') {
        // Held, not acted on. Whether this press was a click or the start of a
        // drag is not known until the mouse either moves or comes back up, and
        // selecting on the way down is what made dragging the map re-select a
        // different square of grass every few pixels.
        this.pressed = { x: hit.x, y: hit.y, wx: hit.wx, wy: hit.wy };
        this.pressTravel = 0;
      } else {
        this.dragStart = { x: hit.x, y: hit.y };
        this.eraseDrag = input.held('ShiftLeft') || input.held('ShiftRight');
      }
    }

    // Left-drag pans, which is the first thing anybody tries and the one the
    // select tool had no use for — there is no rubber-band rectangle here, so
    // the button was doing nothing between press and release.
    if (this.pressed && input.mouseButtons.has(0)) {
      this.pressTravel += Math.abs(input.moveX) + Math.abs(input.moveY);
      if (input.moveX || input.moveY) {
        const k = this.cam.state.distance * 0.0018;
        this.cam.pan(-input.moveX * k, input.moveY * k);
      }
    }

    if (input.released(0) && this.pressed) {
      // A press that stayed put is a click on that square. A press that
      // travelled was the player moving the map, and moving the map is not an
      // opinion about what is under the cursor when they let go.
      if (this.pressTravel <= CLICK_SLOP) {
        const at = this.pressed;
        this.selectAt(world, at.x, at.y, at.wx, at.wy);
      }
      this.pressed = null;
    }

    if (this.dragStart && hit) {
      this.preview = this.rect(world, this.dragStart, hit);
    } else if (this.tool !== 'select' && hit) {
      this.preview = this.rect(world, hit, hit);
    } else {
      this.preview = [];
    }

    if (input.released(0) && this.dragStart) {
      const end = hit ?? this.dragStart;
      this.applyTool(world, this.dragStart, end);
      this.dragStart = null;
      this.preview = [];
    }

    if (input.clicked(2)) {
      if (this.tool !== 'select') {
        this.setTool('select');
      } else if (hit && this.selection?.type === 'pawn') {
        this.rightClickPawn(world, this.selection.id, hit.x, hit.y);
      }
    }
  }

  /**
   * Right-click with a settler selected: send them, or set them to work.
   *
   * The split is who is choosing the work. A settler on the colony's work board
   * gets a *move* order, which drafts them — that has always meant "stop what you
   * are doing and stand there", and it is the only thing a right-click can safely
   * mean for somebody the picker will otherwise re-task in twelve ticks. A settler
   * the player has taken over gets a *work* order instead: point at a tree and
   * they fell it, at a rock and they mine it, at nothing in particular and they
   * walk there. That is the manager-side answer to "issue commands without going
   * into first person".
   *
   * Drafted is the exception on both sides, because the combat pass drives that
   * body by position and would fight the job system for the same legs.
   */
  private rightClickPawn(world: World, pawnId: number, x: number, y: number): void {
    const p = findPawn(world, pawnId);
    if (!p || p.dead || p.faction !== 'colony') return;
    if (!(p.manual ?? false) || p.drafted) {
      orderMove(world, p.id, x, y);
      return;
    }
    // Every refusal is a sentence. An order that silently does nothing is how a
    // player concludes the feature is broken and stops using it.
    switch (orderJob(world, p.id, x, y)) {
      case 'ok':
        break;
      case 'full':
        msg(world, `${p.name} already has three orders — cancel one first.`, 'bad');
        break;
      case 'taken':
        msg(world, 'Somebody is already on that.', 'bad');
        break;
      case 'unreachable':
        msg(world, `${p.name} cannot get there.`, 'bad');
        break;
      default:
        msg(world, `Nothing there for ${p.name} to do.`, 'info');
        break;
    }
  }

  /**
   * What a hand on the glass means, which is the one thing `Input` cannot know:
   * it depends on which tool is armed.
   *
   * Two fingers are always the camera — drag to pan, pinch to zoom, twist to
   * turn — so there is a way to move the map that never changes meaning. One finger is the tool: a
   * tap is a click, and a drag is the rectangle drag, except with the select tool
   * where there is no rectangle to drag and the finger pans instead. That is the
   * same split a mouse has (left button acts, middle button moves), reached with
   * the one button a finger has.
   */
  private touch(
    world: World,
    input: Input,
    hit: { x: number; y: number; wx: number; wy: number } | null,
  ): void {
    if (input.panX || input.panY) {
      const k = this.cam.state.distance * 0.0018;
      this.cam.pan(-input.panX * k, input.panY * k);
    }
    // Spreading the fingers pulls the map closer, which is the opposite sign to
    // the distance the camera keeps.
    if (input.zoomScale !== 1) this.cam.zoom(1 / input.zoomScale);
    // Twisting turns the valley under the fingers rather than turning the camera
    // around it, so the sign is flipped the way the pan's is: the ground follows
    // the hand. This is Q and E reached with two fingers — the last camera
    // control that had no gesture, and the one a player misses first, because an
    // isometric view puts a wall in front of whatever you are trying to look at.
    if (input.twist) this.cam.orbit(-input.twist, 0);

    if (this.tool === 'select') {
      if (input.dragging && (input.moveX || input.moveY)) {
        const k = this.cam.state.distance * 0.0018;
        this.cam.pan(-input.moveX * k, input.moveY * k);
      }
      if (input.tapped && hit) {
        if (!this.orderOnTap(world, hit.x, hit.y, hit.wx, hit.wy)) {
          this.selectAt(world, hit.x, hit.y, hit.wx, hit.wy);
        }
      }
      return;
    }

    if (input.tapped && hit) {
      // A tap with a tool armed is a one-cell drag. Going through applyTool keeps
      // the confirmation message and the "nobody can do this work" warnings that
      // a drag gets — a silent tap is how a tool reads as broken.
      this.applyTool(world, hit, hit);
      return;
    }
    if (input.dragStarted && hit) {
      this.dragStart = { x: hit.x, y: hit.y };
      // Shift-to-erase has no finger equivalent. The Cancel tool in the Orders
      // tab rubs out zones, blueprints and designations, so a tablet is not
      // missing the ability — only the shortcut.
      this.eraseDrag = false;
    }
    if (input.dragEnded && this.dragStart) {
      this.applyTool(world, this.dragStart, hit ?? this.dragStart);
      this.dragStart = null;
      this.preview = [];
    } else if (input.dragAborted) {
      this.dragStart = null;
      this.preview = [];
    }
  }

  private moveCamera(input: Input, dt: number): void {
    const k = PAN_SPEED * dt * this.cam.state.distance * 0.06;
    let right = 0;
    let fwd = 0;
    if (input.held('ArrowLeft')) right -= 1;
    if (input.held('ArrowRight')) right += 1;
    if (input.held('ArrowUp')) fwd += 1;
    if (input.held('ArrowDown')) fwd -= 1;
    // WASD pans too, but only in the manager: in first person those keys walk.
    if (input.held('KeyA')) right -= 1;
    if (input.held('KeyD')) right += 1;
    if (input.held('KeyW')) fwd += 1;
    if (input.held('KeyS')) fwd -= 1;
    if (right || fwd) this.cam.pan(right * k, fwd * k);

    if (input.held('KeyQ')) this.cam.orbit(-ORBIT_SPEED * dt, 0);
    if (input.held('KeyE')) this.cam.orbit(ORBIT_SPEED * dt, 0);
    if (input.held('KeyR')) this.cam.orbit(0, ORBIT_SPEED * dt * 0.6);
    if (input.held('KeyF')) this.cam.orbit(0, -ORBIT_SPEED * dt * 0.6);
    if (input.wheel) this.cam.zoom(input.wheel > 0 ? 1.12 : 1 / 1.12);
  }

  private hotkeys(world: World, input: Input): void {
    // Keyed off the digit each building *declares*, not off its slot in the menu.
    // Indexing the menu meant inserting one entry silently re-bound every key
    // after it while the tiles carried on printing the old numbers.
    for (const kind of BUILD_MENU) {
      const key = defOf(kind).hotkey;
      if (key && input.pressed(`Digit${key}`) && buildingUnlocked(world, kind)) {
        this.setTool('build', kind);
      }
    }
    if (input.pressed('KeyZ')) this.setTool('stockpile');
    if (input.pressed('KeyB')) this.setTool('grow');
    // N for "new ground" — P is the work-priorities tab, and every other letter
    // with a claim on the word (till, soil, dig, plough) is already spoken for.
    if (input.pressed('KeyN')) this.setTool('till');
    // U, I and O sit in a row on the keyboard because the three floors sit in a
    // row in the menu — every letter with a claim on "floor", "plank", "board",
    // "pave" or "bridge" was already spoken for, so the hand position is the
    // mnemonic instead of the letter.
    if (input.pressed('KeyU')) this.setTool('floorBridge');
    if (input.pressed('KeyI')) this.setTool('floorPlank');
    if (input.pressed('KeyO')) this.setTool('floorPaved');
    if (input.pressed('KeyC')) this.setTool('harvest');
    if (input.pressed('KeyH')) this.setTool('hunt');
    // Y for "yard" and K for "keep": P, E, N and T were all spoken for long before
    // the animals turned up, and a tile prints its own key anyway.
    if (input.pressed('KeyY')) this.setTool('pen');
    if (input.pressed('KeyK')) this.setTool('tame');
    if (input.pressed('KeyX')) this.setTool('deconstruct');
    // Backquote, because every letter on the board was spoken for long before the
    // goblins turned up — and because ` is where every game in the last thirty
    // years has put the thing you press when you want to know why the game is
    // doing that. A Picky is exactly that key's job.
    if (input.pressed('Backquote')) this.setTool('picky');
    if (input.pressed('Backspace') || input.pressed('Delete')) this.setTool('cancel');
    if (input.pressed('Escape')) {
      if (this.tool !== 'select') this.setTool('select');
      else this.selection = null;
    }
    if (input.pressed('KeyT') && this.selection?.type === 'pawn') {
      const p = findPawn(world, this.selection.id);
      if (p && p.faction === 'colony' && !p.dead) setDrafted(world, p.id, !p.drafted);
    }
    if (input.pressed('KeyG') && this.selection?.type === 'pawn') {
      this.hooks.possess(this.selection.id);
    }
    if (input.pressed('Tab')) this.cycleColonist(world);
  }

  private cycleColonist(world: World): void {
    const cs = world.pawns.filter((p) => p.faction === 'colony' && !p.dead);
    if (cs.length === 0) return;
    const sel = this.selection;
    const at = sel?.type === 'pawn' ? cs.findIndex((p) => p.id === sel.id) : -1;
    const next = cs[(at + 1) % cs.length]!;
    this.selection = { type: 'pawn', id: next.id };
    this.cam.focusOn(next.x, next.y);
  }

  private selectAt(world: World, cx: number, cy: number, wx: number, wy: number): void {
    const hit = pawnAt(world, wx, wy);
    if (hit !== null) {
      this.selection = { type: 'pawn', id: hit };
      return;
    }
    const b = buildingAt(world, cx, cy);
    // Never null. A click that finds no settler and no building has still found
    // ground — with a stack on it, a crop coming up in it, an order painted over
    // it or none of those, all of which are answers, and all of which used to be
    // the same silence as clicking the sky.
    this.selection = b ? { type: 'building', id: b.id } : { type: 'cell', x: cx, y: cy };
  }

  /**
   * A tap, on a tablet, while a settler the player has taken over is selected.
   *
   * The mouse gives work orders with the right button, which is a button a finger
   * has not got, so the tap has to carry both meanings. The split that keeps them
   * apart: a tap on another person still selects that person — that is how you
   * change who you are looking at — and a tap on anything else is the order.
   * Returns whether it took the tap.
   */
  private orderOnTap(world: World, cx: number, cy: number, wx: number, wy: number): boolean {
    if (this.selection?.type !== 'pawn') return false;
    const p = findPawn(world, this.selection.id);
    if (!p || p.dead || p.faction !== 'colony' || !(p.manual ?? false) || p.drafted) return false;
    if (pawnAt(world, wx, wy) !== null) return false;
    this.rightClickPawn(world, p.id, cx, cy);
    return true;
  }

  /** Cells in the drag rectangle, each flagged with whether the tool can act there. */
  private rect(
    world: World,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): { x: number; y: number; valid: boolean }[] {
    const out: { x: number; y: number; valid: boolean }[] = [];
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    // A drag is capped so a stray sweep across the map cannot queue 4000 blueprints.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return out;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        out.push({ x, y, valid: this.validFor(world, x, y) });
      }
    }
    return out;
  }

  private validFor(world: World, x: number, y: number): boolean {
    switch (this.tool) {
      case 'build':
        return this.buildKind ? canPlace(world, this.buildKind, x, y) === 'ok' : false;
      case 'stockpile':
        return !buildingAt(world, x, y);
      case 'grow':
        // Mirrors farming.ts's own rule, so the preview never shows green on soil
        // the growers would refuse.
        return canSow(world, x, y);
      case 'pen':
        // Anywhere a settler could walk is somewhere an animal can stand. A pen
        // over a growing zone is the player asking their livestock to eat the crop,
        // which is their business — but a pen inside a wall is not a pen.
        return isWalkable(world, x, y) && !buildingAt(world, x, y);
      case 'tame':
        // Same live preview as the hunt tool, minus the animals already brought in.
        return world.pawns.some(
          (p) =>
            p.faction === 'fauna' &&
            !p.dead &&
            p.tame !== true &&
            Math.round(p.x) === x &&
            Math.round(p.y) === y,
        );
      case 'till':
        // Mirrors farming.ts's rule. Ground that is already dirt reads as invalid,
        // which is exactly right: there is nothing left there to break.
        return canTill(world, x, y);
      case 'floorPlank':
      case 'floorPaved':
      case 'floorBridge':
        return canFloor(world, x, y, FLOOR_TOOL[this.tool]!);
      case 'harvest':
        // Mirrors designate()'s own rule (orders.ts): a tree building or bare rock terrain,
        // never a second, drifting definition of what counts as harvestable.
        return buildingAt(world, x, y)?.kind === 'tree' || terrainAt(world, x, y) === 'rock';
      case 'hunt':
        // Green wherever a grazing animal is standing right now. The preview is
        // recomputed every frame, so it tracks the herd as it moves.
        return world.pawns.some(
          (p) => p.faction === 'fauna' && !p.dead && Math.round(p.x) === x && Math.round(p.y) === y,
        );
      case 'deconstruct': {
        // Green over a laid floor as well as a standing building, because the
        // tool takes the top off a cell and the boards are the top once the bed
        // is gone. Without this the preview greys out over a paved yard and the
        // player concludes floors are permanent — which they were, until now.
        const b = buildingAt(world, x, y);
        if (b) return b.built && b.kind !== 'tree';
        return canRemoveFloor(world, x, y);
      }
      case 'cancel':
        return !!buildingAt(world, x, y);
      case 'picky':
        // Green everywhere on the map, including the cells nothing can reach.
        // That is not an oversight: a tool that greyed out over unreachable ground
        // would already be answering the question you summoned it to ask.
        return true;
      default:
        return false;
    }
  }

  private applyTool(world: World, a: { x: number; y: number }, b: { x: number; y: number }): void {
    // One Picky per gesture, aimed wherever the drag ended. A rectangle of them is
    // not a diagnostic, it is a crowd — and the cap would swallow the rest anyway,
    // leaving a screenful of refusals in the log to show for it.
    if (this.tool === 'picky') {
      summonPicky(world, { kind: 'reach', x: b.x, y: b.y });
      return;
    }
    const cells = this.rect(world, a, b);
    let done = 0;
    let treesMarked = 0;
    let floorsMarked = 0;
    let wildMarked = 0;
    let doorwaysSpared = 0;
    const rockMarked: Array<{ x: number; y: number }> = [];
    const erase = this.eraseDrag;
    for (const c of cells) {
      switch (this.tool) {
        case 'build':
          if (!this.buildKind) break;
          if (placeBlueprint(world, this.buildKind, c.x, c.y)) done++;
          // A cell that greys out for no visible reason is a bug report. This one
          // has a reason worth saying out loud, because the alternative is a
          // player sealing their own settlers into the cabin and never finding
          // out why the colony stopped.
          else if (canPlace(world, this.buildKind, c.x, c.y) === 'doorway') doorwaysSpared++;
          break;
        case 'stockpile':
          if (erase) eraseZone(world, c.x, c.y);
          else if (paintStockpile(world, c.x, c.y)) done++;
          break;
        case 'grow':
          if (erase) eraseZone(world, c.x, c.y);
          else if (paintGrowingZone(world, c.x, c.y)) done++;
          break;
        case 'pen':
          if (erase) eraseZone(world, c.x, c.y);
          else if (paintPenZone(world, c.x, c.y)) done++;
          break;
        case 'tame':
          done += markTame(world, c.x, c.y, !erase);
          break;
        case 'till':
          if (designate(world, c.x, c.y, erase ? DESIG_NONE : DESIG_TILL)) done++;
          break;
        case 'floorPlank':
        case 'floorPaved':
        case 'floorBridge': {
          const desig = desigForFloor(FLOOR_TOOL[this.tool]!);
          if (designate(world, c.x, c.y, erase ? DESIG_NONE : desig)) done++;
          break;
        }
        case 'harvest':
          if (erase) {
            if (designate(world, c.x, c.y, DESIG_NONE)) done++;
          } else if (designate(world, c.x, c.y, DESIG_HARVEST)) {
            done++;
            if (buildingAt(world, c.x, c.y)?.kind === 'tree') treesMarked++;
            else if (terrainAt(world, c.x, c.y) === 'rock') rockMarked.push({ x: c.x, y: c.y });
          }
          break;
        case 'hunt': {
          const n = markHunt(world, c.x, c.y, !erase);
          done += n;
          // Same order, two different words for it: marking the herd out on the
          // grass is a hunt, marking the goat in your own pen is a slaughter.
          if (n > 0 && world.pawns.some((p) => p.faction === 'fauna' && !p.dead && p.tame !== true && Math.round(p.x) === c.x && Math.round(p.y) === c.y)) {
            wildMarked += n;
          }
          break;
        }
        case 'deconstruct': {
          // Asked before the order is given: afterwards the cell is marked either
          // way, and the two are only distinguishable by what is standing on it.
          const onlyFloor = !erase && buildingAt(world, c.x, c.y) === null;
          if (designate(world, c.x, c.y, erase ? DESIG_NONE : DESIG_DECONSTRUCT)) {
            done++;
            if (onlyFloor) floorsMarked++;
          }
          break;
        }
        case 'cancel':
          if (cancelAt(world, c.x, c.y)) done++;
          else if (designate(world, c.x, c.y, DESIG_NONE)) done++;
          break;
        default:
          break;
      }
    }
    // A silent drag reads as a broken tool, so every designation kind gets its own
    // one-line confirmation — the same contract the build branch already honoured.
    if (this.tool === 'build' && this.buildKind && done > 0) {
      const def = defOf(this.buildKind);
      msg(world, `${done} × ${def.label} planned.`, 'info');
      if (doorwaysSpared > 0) {
        msg(world, `${doorwaysSpared} skipped — they would have blocked a doorway.`, 'info');
      }
    } else if (this.tool === 'build' && doorwaysSpared > 0) {
      msg(world, 'That would block a doorway — leave the step in front of a door clear.', 'bad');
    } else if (this.tool === 'harvest' && !erase && done > 0) {
      msg(world, harvestMessage(done - treesMarked, treesMarked), 'info');
      const walled = unreachableRock(world, rockMarked);
      if (walled >= rockMarked.length && walled > 0) {
        msg(world, 'Nobody can reach that rock yet — mine in from the outside face.', 'bad');
      } else if (walled > 0) {
        msg(world, `${walled} of those cells are walled in; the outer face has to come down first.`, 'info');
      }
    } else if (this.tool === 'hunt' && done > 0) {
      msg(
        world,
        erase
          ? `${done} animal${done === 1 ? '' : 's'} called off.`
          : `${done} animal${done === 1 ? '' : 's'} marked for ${wildMarked > 0 ? 'hunting' : 'slaughter'}.`,
        'info',
      );
      // Marking with nobody able to take the shot is a silent no-op otherwise —
      // the player would watch the marker sit there and conclude hunting is broken.
      // Livestock is the exception: a penned animal stands still to be slaughtered,
      // so a colony with no rifle can still butcher its own herd.
      if (!erase && wildMarked > 0 && !livingColonists(world).some((p) => p.weapon === 'rifle')) {
        msg(world, 'Nobody has a rifle — a hunt needs a ranged weapon.', 'bad');
      }
    } else if (this.tool === 'tame' && done > 0) {
      msg(
        world,
        erase
          ? `${done} animal${done === 1 ? '' : 's'} left wild.`
          : `${done} animal${done === 1 ? '' : 's'} marked to be brought in.`,
        'info',
      );
      // Both of these are silent no-ops otherwise: the mark sits on the animal and
      // nobody ever walks out to it, which reads as the tool being broken.
      if (!erase && !hasPen(world)) {
        msg(world, 'There is no pen yet — press Y and paint one, or nobody will go.', 'bad');
      } else if (!erase && !livingColonists(world).some((p) => p.priorities.farm > 0)) {
        msg(world, 'Nobody is set to farm work — handling animals is farm duty.', 'bad');
      }
    } else if (this.tool === 'pen' && !erase && done > 0) {
      msg(world, `${done} cell${done === 1 ? '' : 's'} zoned as a pen.`, 'info');
      const cap = penCapacity(world);
      msg(
        world,
        cap > 0
          ? `Room for ${cap} head. Mark a wild animal with K and a farmer will bring it in.`
          : `Too small to keep anything yet — a pen needs ${PEN_CELLS_PER_HEAD} cells per animal.`,
        cap > 0 ? 'info' : 'bad',
      );
    } else if (this.tool === 'deconstruct' && !erase && done > 0) {
      msg(world, removalMessage(done - floorsMarked, floorsMarked), 'info');
    } else if (this.tool === 'stockpile' && !erase && done > 0) {
      msg(world, `${done} cell${done === 1 ? '' : 's'} marked for stockpile.`, 'info');
    } else if (this.tool === 'grow' && !erase && done > 0) {
      msg(world, `${done} cell${done === 1 ? '' : 's'} zoned for crops.`, 'info');
    } else if (FLOOR_TOOL[this.tool] && !erase && done > 0) {
      const kind: FloorKind = FLOOR_TOOL[this.tool]!;
      const def = FLOOR_DEFS[kind];
      msg(world, `${done} cell${done === 1 ? '' : 's'} marked for ${def.label}.`, 'info');
      // The same silence the till tool used to have: a floor order with nothing to
      // build it from sits on the ground looking like a broken tool.
      const stock = countResource(world, def.cost);
      const need = done * def.amount;
      if (stock < need) {
        msg(
          world,
          `That needs ${need} ${def.cost} and there is ${stock} — the rest will wait.`,
          'bad',
        );
      } else if (!livingColonists(world).some((p) => p.priorities.construct > 0)) {
        msg(world, 'Nobody is set to construction work — the boards will not go down.', 'bad');
      }
    } else if (this.tool === 'till' && !erase && done > 0) {
      msg(world, `${done} cell${done === 1 ? '' : 's'} marked to be broken for soil.`, 'info');
      // Tilling is the farm's idle work, so a colony with nobody on farm duty —
      // or with a plot still ripening — will look like it is ignoring the order.
      if (!livingColonists(world).some((p) => p.priorities.farm > 0)) {
        msg(world, 'Nobody is set to farm work — the ground will sit unbroken.', 'bad');
      }
    }
  }
}

/**
 * Nearest body within grabbing distance of a world point, or null.
 *
 * The dead are included, and for a long time they were not — `if (p.dead)
 * continue` meant the settler who had just died was the one thing on the map
 * with nothing to say, at the exact moment the player most wanted to ask. A
 * grave answers "who" and the panel answered nothing.
 *
 * The living win ties regardless of distance, which is the whole of the care
 * this needs: a body on the floor of the ward must not take the click meant for
 * the doctor kneeling over it, and after a fight the two are in the same square
 * often enough that first-past-the-post would feel broken.
 */
function pawnAt(world: World, wx: number, wy: number): number | null {
  let best: { id: number; d: number; dead: boolean } | null = null;
  for (const p of world.pawns) {
    const d = dist(p.x, p.y, wx, wy);
    if (d >= 0.85) continue;
    const dead = !!p.dead;
    const better = !best || (best.dead && !dead) || (best.dead === dead && d < best.d);
    if (better) best = { id: p.id, d, dead };
  }
  return best ? best.id : null;
}

/** Phrases a harvest drag the way a player would say it: rock is mined, trees are felled. */
/**
 * One drag of the X tool can cover both, so the line has to be able to say both.
 * Named separately from the buildings for the same reason the chop/mine line is:
 * "12 things marked for deconstruction" tells a player nothing about whether they
 * just ordered their yard paving lifted along with the shed.
 */
function removalMessage(buildings: number, floors: number): string {
  if (floors === 0) return `${buildings} building${buildings === 1 ? '' : 's'} marked for deconstruction.`;
  if (buildings === 0) return `${floors} floor cell${floors === 1 ? '' : 's'} marked to be taken up.`;
  return `${buildings} building${buildings === 1 ? '' : 's'} and ${floors} floor cell${floors === 1 ? '' : 's'} marked for removal.`;
}

function harvestMessage(rocks: number, trees: number): string {
  if (trees === 0) return `${rocks} rock${rocks === 1 ? '' : 's'} marked for mining.`;
  if (rocks === 0) return `${trees} tree${trees === 1 ? '' : 's'} marked for felling.`;
  return `${rocks} rock${rocks === 1 ? '' : 's'} and ${trees} tree${trees === 1 ? '' : 's'} marked for harvest.`;
}
