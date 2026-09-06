/**
 * The whole valley, at one pixel a cell.
 *
 * The map is ninety-six cells square and the colony camera shows about thirty of
 * them, so nine tenths of the world is off screen at any moment — and now that
 * the rest of it starts under haze, "where have we been and where have we not"
 * is a question the player asks constantly and had no way to answer without
 * flying the camera around. That is what this is for. It is not a second view of
 * the game; it is the index to the one that already exists.
 *
 * Split in two on purpose. `paintMap`, `marksOf`, `mapSignature` and `cellAt`
 * are pure functions over the world — no canvas, no document — because the test
 * environment is node and the decisions worth pinning down (what colour is
 * unwalked ground, does a raider in the dark show up, does a click land on the
 * cell under the thumb) are all decisions rather than pixels. `Minimap` is the
 * thin part: three canvases and a pointer handler.
 *
 * Two rules hold the thing honest:
 *
 * The ground is painted in the world's own palette, imported rather than
 * restated, so the minimap can never drift away from the 3D view it indexes.
 * Marks are the opposite — they are symbols, sized and coloured to survive at
 * two pixels on a dark panel, which is why the red on a raider here is hotter
 * than the red on a raider's coat.
 *
 * And nothing is drawn on ground the colony has not seen. Not the terrain, not
 * the buildings, and above all not the bodies: the shroud in the 3D view stands
 * three metres tall at 88% opacity and swallows a raider whole, so a minimap
 * that showed the raid coming would be handing the player something the game had
 * decided they could not see. Lifting the haze is what buys early warning.
 */

import * as THREE from 'three';
import { TERRAIN_LIST } from '../../sim/types';
import { isSeen } from '../../sim/explore';
import { yearPhase } from '../../sim/seasons';
import { snowDepth } from '../../sim/snowpack';
import { BUILDING_COLOR, SEASON_STEPS, SNOW_STEPS, groundColor } from '../render/palette';
import { isPhoneLayout } from './layout-mode';
import type { Pawn, Terrain, World } from '../../sim/types';

/**
 * Ground the colony has never laid eyes on.
 *
 * Not black, and — this is the part that was wrong for a long time — not the
 * panel either. The old value was 0x141a22, and a pixel dropper on the shipped
 * frame finds the chrome around this panel sitting at exactly that: 20, 26, 34.
 * So on day one, when the colony has walked a twentieth of the valley and the
 * rest is haze, there was no edge anywhere between the map and the frame around
 * it. The whole top left corner read as one dead rectangle with a stamp of
 * colour floating in the middle of it, which is what a widget that failed to
 * load looks like, and it was the highest-contrast edge on a lit screen — so it
 * was also the first thing the eye went to.
 *
 * This is the panel's own solid, #0e131a, carried a sixth of the way toward the
 * dim grey the HUD writes its quiet labels in. Far enough off black that the
 * face of the map is a surface the player can see the shape of, and still far
 * enough under everything it borders that no unwalked cell could be mistaken
 * for walked: the darkest thing that can ever stand on seen ground is a tree,
 * and a tree comes out seventy per cent brighter than this.
 */
export const UNSEEN = 0x262b33;

/**
 * How much the terrain is lifted before it is drawn.
 *
 * The palette holds albedo — the colour a surface *is* — and everything in the 3D
 * view is then lit by a sun. Painting raw albedo onto a dark panel gives a
 * minimap noticeably darker than the game it is a map of, and the player has to
 * work to tell moss from slate. One multiplier applied to every terrain equally
 * keeps every relationship between them intact; it is a display gamma, not a
 * recolour, which is why it can be a single number here and not a second palette.
 */
const LIFT = 1.25;

/** Blueprints, blended this far over the ground they are pegged out on. */
const PLAN_MIX = 0.45;

/**
 * The mark palette. Symbols, not materials — see the note at the top of the file.
 */
export const MARK_COLOR = {
  /** The body the player is standing inside. The only pure white on the map. */
  self: 0xffffff,
  /** Brighter than the blue on a settler's coat, which vanishes at this size. */
  settler: 0x7fb3e8,
  /** A settler on the ground. The colour the HUD uses for everything gone wrong. */
  downed: 0xe0745f,
  /** Raiders and predators. Hotter than raider cloth: this one has to be found fast. */
  threat: 0xff6a52,
  trader: 0xc8a13a,
  prisoner: 0x8d8478,
  /** Livestock — warmer than the game it was tamed from, so a pen reads as a pen. */
  livestock: 0xb59a63,
  /** Wild game. Worth seeing: this is most of what scouting the far valley pays. */
  game: 0x8a7a55,
  /** An animal the player has marked — to hunt, or to coax in. */
  marked: 0xd8a24a,
  fire: 0xff8a3d,
  /** A landmark seen but not yet walked to. The same amber as the pin in the world. */
  site: 0xd8a24a,
  /** A landmark somebody already read. Still on the map, no longer an invitation. */
  siteRead: 0x6f6250,
} as const;

export interface MiniMark {
  x: number;
  y: number;
  color: number;
  /** 1 small, 2 a body worth finding, 3 the body the player is inside. */
  size: 1 | 2 | 3;
}

/** A buffer the right shape for `paintMap`, so no caller has to work it out. */
export function mapBuffer(world: World): Uint8ClampedArray {
  return new Uint8ClampedArray(world.width * world.height * 4);
}

/**
 * What has changed that would make the map look different.
 *
 * The same trick `TerrainView.sync` uses, and for the same reason: repainting
 * thirty-seven thousand pixels every frame to discover that nothing moved is work the
 * game can spend on the world instead. Four things can change the picture — the
 * ground itself (floors get laid, soil gets tilled), how much of it the colony
 * has seen, the buildings standing on it, the snow lying over the lot, and what
 * the year is doing to the colour of all of it. Buildings are keyed on id rather
 * than kind so that a wall raised on the stump of a felled tree, at the same
 * index of the same array, cannot come out to the same number.
 */
export function mapSignature(world: World): number {
  let s =
    (world.stats.explored ?? 0) +
    Math.floor(yearPhase(world) * SEASON_STEPS) * 7919 +
    Math.floor(snowDepth(world) * SNOW_STEPS) * 104729;
  const t = world.terrain;
  for (let i = 0; i < t.length; i++) s = (s + t[i]! * (i + 1)) | 0;
  const b = world.buildings;
  for (let i = 0; i < b.length; i++) {
    const one = b[i]!;
    s = (s + (one.id * 31 + one.x * 7 + one.y + (one.built ? 3 : 1)) * (i + 1)) | 0;
  }
  return s;
}

/**
 * Fill `out` with one RGBA pixel per cell, row by row from the north-west corner
 * — the same order the sim packs its own grids in, so a cell's index is a cell's
 * index everywhere in the codebase.
 */
export function paintMap(world: World, out: Uint8ClampedArray): void {
  const cells = world.width * world.height;
  if (out.length < cells * 4) return;

  const ground = groundPalette(world);
  for (let i = 0; i < cells; i++) {
    const p = i * 4;
    const seen = world.seen?.[i] === 1;
    const color = seen ? ground[TERRAIN_LIST[world.terrain[i]!] ?? 'grass'] : UNSEEN;
    out[p] = (color >> 16) & 255;
    out[p + 1] = (color >> 8) & 255;
    out[p + 2] = color & 255;
    out[p + 3] = 255;
  }

  for (const b of world.buildings) {
    if (!isSeen(world, b.x, b.y)) continue;
    const p = (b.y * world.width + b.x) * 4;
    const color = lifted(BUILDING_COLOR[b.kind]);
    const mix = b.built ? 1 : PLAN_MIX;
    out[p] = blend(out[p]!, (color >> 16) & 255, mix);
    out[p + 1] = blend(out[p + 1]!, (color >> 8) & 255, mix);
    out[p + 2] = blend(out[p + 2]!, color & 255, mix);
  }
}

/**
 * Everything worth a dot, in the order it should be drawn.
 *
 * Painter's order, so the list reads as a priority list: landmarks are scenery
 * and go down first, then bodies, then fires — a settler standing in a burning
 * kitchen must not hide the fire, because the fire is the thing the player has
 * to act on — and last of all the body the player is inside, which is never
 * allowed to be covered by anything.
 */
export function marksOf(world: World, possessedId: number | null): MiniMark[] {
  const out: MiniMark[] = [];

  for (const site of world.sites) {
    if (!isSeen(world, site.x, site.y)) continue;
    out.push({
      x: site.x,
      y: site.y,
      color: site.found ? MARK_COLOR.siteRead : MARK_COLOR.site,
      size: 1,
    });
  }

  let self: MiniMark | null = null;
  for (const p of world.pawns) {
    if (p.dead) continue;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (!isSeen(world, x, y)) continue;
    if (p.id === possessedId) {
      self = { x, y, color: MARK_COLOR.self, size: 3 };
      continue;
    }
    const mark = markFor(p, x, y);
    if (mark) out.push(mark);
  }

  for (const f of world.fires) {
    const x = Math.round(f.x);
    const y = Math.round(f.y);
    if (!isSeen(world, x, y)) continue;
    out.push({ x, y, color: MARK_COLOR.fire, size: 2 });
  }

  if (self) out.push(self);
  return out;
}

function markFor(p: Pawn, x: number, y: number): MiniMark | null {
  switch (p.faction) {
    case 'colony':
      return { x, y, color: p.downed ? MARK_COLOR.downed : MARK_COLOR.settler, size: 2 };
    case 'raider':
    case 'wildlife':
      return { x, y, color: MARK_COLOR.threat, size: 2 };
    case 'trader':
      return { x, y, color: MARK_COLOR.trader, size: 2 };
    case 'prisoner':
      return { x, y, color: MARK_COLOR.prisoner, size: 1 };
    case 'fauna':
      if (p.hunted || p.tameTarget) return { x, y, color: MARK_COLOR.marked, size: 1 };
      return { x, y, color: p.tame ? MARK_COLOR.livestock : MARK_COLOR.game, size: 1 };
  }
}

/**
 * A point on the face of the map, as fractions of its width and height, to the
 * cell under it. Clamped rather than refused: a thumb on a tablet lands half a
 * pixel off the edge often enough that "nothing happened" would read as a broken
 * control, and the nearest cell is always what was meant.
 */
export function cellAt(world: World, fx: number, fy: number): { x: number; y: number } {
  const x = Math.floor(fx * world.width);
  const y = Math.floor(fy * world.height);
  return {
    x: Math.max(0, Math.min(world.width - 1, x)),
    y: Math.max(0, Math.min(world.height - 1, y)),
  };
}

/**
 * Every terrain's colour as it stands today, lifted and ready to write.
 *
 * Eight entries built once a repaint rather than a lerp per cell, which is the
 * only reason the season can ride along in a nine-thousand-pixel loop for free.
 * The tint comes from `groundColor` rather than being restated here, so the map
 * in the corner goes gold on the same day the valley does — a minimap that is
 * still summer-green in November is worse than one that never changed, because
 * the player would read the difference as the map being wrong about the ground.
 */
function groundPalette(world: World): Record<Terrain, number> {
  const phase = yearPhase(world);
  const depth = snowDepth(world);
  const c = new THREE.Color();
  const out = {} as Record<Terrain, number>;
  for (const kind of TERRAIN_LIST) out[kind] = lifted(groundColor(c, kind, phase, depth).getHex());
  return out;
}

function lifted(color: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * LIFT));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * LIFT));
  const b = Math.min(255, Math.round((color & 255) * LIFT));
  return (r << 16) | (g << 8) | b;
}

function blend(under: number, over: number, mix: number): number {
  return Math.round(under + (over - under) * mix);
}

// ------------------------------------------------------------------ the canvas

/**
 * How wide the map is drawn, in CSS pixels. Square, because the map is.
 *
 * Two numbers, because the map is drawn at the size it is actually shown at
 * rather than drawn big and handed to the stylesheet to shrink. Shrinking was
 * fine for the terrain — a nearest-neighbour blit of a one-pixel-a-cell bitmap
 * does not care what it is stretched to — and ruinous for everything drawn on
 * top of it: a settler specified as three pixels of a two-hundred pixel face
 * arrives on a phone as one and a half real pixels, and a camera outline one
 * pixel wide arrives as half of one. What the player actually got was a map of
 * the ground with no people on it, no raiders on it, and no rectangle saying
 * where they were looking — which is the one thing the instrument exists to say.
 */
const FACE_DESK = 200;
const FACE_PHONE = 96;
/** Marks, in CSS pixels of the desk face, indexed by `MiniMark.size`. */
const MARK_PX = [0, 3, 4, 6];
/**
 * The smallest a mark may come out, in real pixels of whichever face it lands
 * on, indexed the same way.
 *
 * Three is where a square stops reading as a dot and starts reading as dirt on
 * the screen, so nothing is allowed below it however small the face gets. The
 * three numbers are graduated rather than one flat floor because the ranking is
 * the information: a landmark, a body worth finding and the body you are
 * standing in have to stay tellable apart, and a floor that flattened all three
 * to the same square would trade one kind of illegibility for another. Each
 * stays under its desk size, so applying the floor changes nothing on a desk.
 */
const MARK_MIN_PX = [0, 3, 4, 5];
const MAX_DPR = 2;

/**
 * The ink everything drawn on the haze is made of — the same grey the HUD writes
 * its quiet labels in, kept as a colour and spent as an alpha.
 *
 * One ink for both the lattice and the frontier, because the two are saying the
 * same thing in different ways: this is interface, not valley. A second colour
 * would invite the player to read a difference between them that is not there.
 */
const FOG_INK = 0x9aa3ad;

/**
 * The lattice on the haze, which is there so that unwalked ground reads as a
 * surface rather than as a void, and which pays for itself twice by saying how
 * big the valley is while it does it.
 *
 * Sixteen cells to a square, and the colony camera shows about thirty — so one
 * square is half a screenful, which is the unit a player actually thinks in
 * when they wonder how far it is to the far ridge. On a phone that square would
 * come out sixteen pixels across and the lattice would be closer to a texture
 * than to a grid, so the spacing doubles until the square clears twenty-four
 * pixels: the desk gets sixteen cells at thirty-three pixels, the phone gets
 * thirty-two at thirty-two. The same graticule, one step coarser for the
 * smaller face — which is what any map does when you zoom out of it, and it
 * keeps the scale reading honest instead of shrinking it into mud.
 *
 * Nine hundredths of the ink is the whole budget. At a tenth the lines start
 * competing with the painted ground for the eye, and the ground is the thing
 * the player came to look at; below about seven they stop arriving at all on a
 * dim laptop panel. This is a lattice you find when you look for it and stop
 * seeing the moment you look at the colony.
 */
const GRID_INK_ALPHA = 0.09;
const GRID_CELLS = 16;
const GRID_MIN_PX = 24;

/**
 * The frontier: how far the haze thins where it meets ground the colony knows,
 * and how much it thins by.
 *
 * Without it the edge of the explored patch is a cut — a hard stamp of colour
 * dropped on a dark field, which reads as two unrelated pictures sharing a
 * panel. A soft light spilling outward off the shape says the other thing
 * instead, the true one: this is where knowing stops, and it is growing. Ten
 * pixels of blur is a little under five cells at the desk size, wide enough to
 * be a gradient rather than an outline; scaled with the face so the phone gets
 * the same fraction of the map and not the same fraction of the screen. A third
 * of the ink is where the rim is unmistakable at arm's length without turning
 * into a halo around a selected object.
 */
const FRONTIER_ALPHA = 0.34;
const FRONTIER_BLUR = 10;

/**
 * Which face this device gets, asked fresh rather than remembered.
 *
 * `hud.ts` reads the layout exactly once and never again, deliberately: panels
 * that rearrange themselves mid-game move the button out from under the thumb
 * already reaching for it. This is not that. The face is a resolution, not an
 * arrangement, and it belongs next to the device-pixel-ratio read in `update`
 * for exactly the reason that one is taken every frame — it is a property of
 * the display, and a display can change under a game that is already running.
 */
function faceSize(): number {
  return isPhoneLayout() ? FACE_PHONE : FACE_DESK;
}

/**
 * A mark's side, on a face `k` times the size of the desk's: scaled with the
 * face, then floored, so it shrinks as far as it can still be seen and no
 * further.
 */
function markPx(size: MiniMark['size'], k: number): number {
  return Math.max(MARK_MIN_PX[size]!, MARK_PX[size]! * k);
}

/**
 * The panel. Three canvases, and the reason there are three is that only the
 * last of them is allowed to cost anything per frame.
 *
 * `base` is the map itself at one pixel a cell, painted only when
 * `mapSignature` says something moved. `page` is what the map is drawn on, at
 * the size it is shown: the haze, the lattice on it, the frontier where the
 * haze meets known ground, and the map laid over the lot. It is rebuilt on
 * exactly the same beat as `base`, plus whenever the face changes size, because
 * every one of its ingredients is a function of those two things and nothing
 * else. And `canvas` is the face the player looks at, which every frame clears,
 * blits the finished page onto in one call, and then draws the moving parts —
 * the bodies and the camera rectangle — over the top.
 *
 * Which means the frame cost of all of this is what it was before any of it
 * existed: one blit and a handful of small rectangles. A blur and a lattice
 * that ran every frame would be a real per-pixel loop sixty times a second to
 * redraw something that changes when a settler walks past a hedge.
 */
export class Minimap {
  readonly el: HTMLElement;
  private readonly base = document.createElement('canvas');
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly page = document.createElement('canvas');
  private readonly pageCtx: CanvasRenderingContext2D;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private pixels: ImageData | null = null;
  private buffer: Uint8ClampedArray | null = null;
  /**
   * Whichever colony is being played. Held rather than passed in at construction
   * because loading a save and restarting both hand the app a different world
   * object, and a minimap still pointing at the old one would send the camera to
   * cells out of a game nobody is playing any more.
   */
  private world: World | null = null;
  private sig = NaN;
  /** The face the canvas is currently sized for, in CSS pixels. */
  private face = 0;
  private dpr = 0;

  constructor(onFocus: (x: number, y: number) => void) {
    this.baseCtx = this.base.getContext('2d')!;
    this.pageCtx = this.page.getContext('2d')!;

    this.canvas.style.display = 'block';
    this.ctx = this.canvas.getContext('2d')!;
    this.sizeFace(faceSize(), Math.min(devicePixelRatio || 1, MAX_DPR));

    this.el = document.createElement('div');
    this.el.className = 'panel';
    this.el.id = 'minimap';
    this.el.append(this.canvas);

    // Drag as well as tap: scrubbing a thumb across the valley and watching the
    // colony view follow is how a player finds a place they cannot name.
    let held = false;
    const jump = (e: PointerEvent) => {
      const world = this.world;
      const r = this.canvas.getBoundingClientRect();
      if (!world || r.width === 0 || r.height === 0) return;
      const cell = cellAt(world, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      onFocus(cell.x, cell.y);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      held = true;
      this.canvas.setPointerCapture(e.pointerId);
      jump(e);
      e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (held) jump(e);
    });
    const release = (e: PointerEvent) => {
      held = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  /**
   * Give the canvas a face of `face` CSS pixels backed by `dpr` device pixels to
   * each one, and remember both.
   *
   * The two always move together, because a canvas whose backing store and CSS
   * size disagree is a blurry canvas, and the size is written onto the element
   * here rather than left to the stylesheet so that this module and the panel
   * can never be looking at different numbers.
   */
  private sizeFace(face: number, dpr: number): void {
    this.face = face;
    this.dpr = dpr;
    this.canvas.style.width = `${face}px`;
    this.canvas.style.height = `${face}px`;
    this.canvas.width = Math.round(face * dpr);
    this.canvas.height = Math.round(face * dpr);
    // The page is never shown, so it has no CSS size to keep in step — only the
    // same backing store, because it is blitted onto the face one for one and a
    // page a different size would arrive resampled and soft.
    this.page.width = this.canvas.width;
    this.page.height = this.canvas.height;
  }

  /**
   * Draw the haze, the lattice, the frontier and the map onto the page.
   *
   * The order is the whole idea. The haze goes down first as a flat field of
   * `UNSEEN`, the lattice is ruled across all of it, and then the map is laid
   * over the top with its unwalked cells lifted out — so the lattice is not
   * masked to the haze by any arithmetic, it is simply underneath the map and
   * shows through where there is no map. Ruled as one path — five lines each way
   * on a desk, two on a phone — rather than as a cached tile: at that count the
   * strokes cost less than a pattern would cost to build, and far less than one
   * would cost to keep correct across two face sizes.
   *
   * The frontier arrives as the blitted map's own shadow — offset nowhere, so
   * it is a glow rather than a drop, and drawn under the map so only the half
   * of it that falls on haze is ever seen. That is exactly the half that is
   * wanted, and it costs one property instead of an outline nobody has to trace.
   */
  private drawPage(face: number, dpr: number, cells: number): void {
    const ctx = this.pageCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = hex(UNSEEN);
    ctx.fillRect(0, 0, face, face);

    let step = GRID_CELLS;
    while ((step / cells) * face < GRID_MIN_PX) step *= 2;
    const gap = (step / cells) * face;
    ctx.strokeStyle = rgba(FOG_INK, GRID_INK_ALPHA);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let at = gap; at < face - 0.5; at += gap) {
      ctx.moveTo(at, 0);
      ctx.lineTo(at, face);
      ctx.moveTo(0, at);
      ctx.lineTo(face, at);
    }
    ctx.stroke();

    ctx.imageSmoothingEnabled = false;
    ctx.shadowColor = rgba(FOG_INK, FRONTIER_ALPHA);
    ctx.shadowBlur = FRONTIER_BLUR * (face / FACE_DESK);
    ctx.drawImage(this.base, 0, 0, face, face);
    ctx.shadowBlur = 0;
  }

  /**
   * `quad` is what the colony camera can see, or null in first person — where
   * there is no ground rectangle to draw and a heading off the possessed body is
   * the thing that actually helps, because being lost is the price of the view.
   */
  update(
    world: World,
    quad: { x: number; y: number }[] | null,
    possessed: Pawn | null,
  ): void {
    this.world = world;
    if (this.base.width !== world.width || this.base.height !== world.height) {
      this.base.width = world.width;
      this.base.height = world.height;
      this.pixels = this.baseCtx.createImageData(world.width, world.height);
      this.buffer = mapBuffer(world);
      this.sig = NaN;
    }
    const pixels = this.pixels;
    const buffer = this.buffer;
    if (!pixels || !buffer) return;

    // Both halves of the cache, and the one flag that says the page built off
    // them is out of date. The map moving and the panel changing size are
    // different events with the same consequence, and either one alone leaves a
    // page drawn from something that is no longer true.
    let stale = false;
    const sig = mapSignature(world);
    if (sig !== this.sig) {
      this.sig = sig;
      paintMap(world, buffer);
      pixels.data.set(buffer);
      liftUnseen(world, pixels.data);
      this.baseCtx.putImageData(pixels, 0, 0);
      stale = true;
    }

    const face = faceSize();
    const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
    if (face !== this.face || dpr !== this.dpr) {
      this.sizeFace(face, dpr);
      stale = true;
    }
    if (stale) this.drawPage(face, dpr, world.width);

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, face, face);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.page, 0, 0, face, face);

    // How much of a desk face this one is. Everything above the terrain is drawn
    // through it, because a symbol that kept its desk size on a face less than
    // half as wide would cover four times as much valley as it means to.
    const k = face / FACE_DESK;
    const scale = face / world.width;
    for (const m of marksOf(world, possessed ? possessed.id : null)) {
      const px = markPx(m.size, k);
      ctx.fillStyle = hex(m.color);
      ctx.fillRect((m.x + 0.5) * scale - px / 2, (m.y + 0.5) * scale - px / 2, px, px);
    }

    if (quad) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      // Divided by the scale rather than multiplied, alone on this panel. Every
      // mark is a symbol standing on a cell and shrinks with the ground it
      // stands on; this rectangle is the answer to "where am I looking", it is
      // the largest and by far the thinnest thing drawn here, and a hairline of
      // seventy per cent white over terrain is not an answer anybody can read at
      // arm's length. On a phone it comes out at two pixels, on purpose.
      ctx.lineWidth = Math.max(1, 1 / k);
      ctx.beginPath();
      for (let i = 0; i < quad.length; i++) {
        const p = quad[i]!;
        const x = (p.x + 0.5) * scale;
        const y = (p.y + 0.5) * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (possessed) {
      const x = (possessed.x + 0.5) * scale;
      const y = (possessed.y + 0.5) * scale;
      // Off the dot rather than off the table, so the stub stays the same length
      // relative to the body it comes out of once the floor has had its say.
      const reach = markPx(3, k) * 1.8;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(possessed.facing) * reach, y + Math.sin(possessed.facing) * reach);
      ctx.stroke();
    }
  }
}

/**
 * Take the alpha off every cell the colony has not seen, so the page under the
 * map can show through where there is no map.
 *
 * `paintMap` writes an opaque `UNSEEN` pixel for those cells and goes on doing
 * so, because it is a pure function over the world and its answer to "what
 * colour is this cell" has to stand on its own — the tests read it that way and
 * so would anything else that ever wants a picture of the valley without a
 * canvas to put it on. The canvas wants the same picture with holes in it, and
 * that is a property of the canvas, so it is punched here rather than there.
 * The colour lost is the colour the page is already painted in, from the same
 * constant, so the two can never disagree about what haze looks like.
 *
 * A pass over nine thousand cells, on the same beat as the paint it follows —
 * which is to say when the map changes, not when the frame does.
 */
function liftUnseen(world: World, data: Uint8ClampedArray): void {
  const cells = world.width * world.height;
  const seen = world.seen;
  for (let i = 0; i < cells; i++) if (seen?.[i] !== 1) data[i * 4 + 3] = 0;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** The same colour, spent as a wash. */
function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
}
