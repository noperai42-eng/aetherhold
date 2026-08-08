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
 * thin part: two canvases and a pointer handler.
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
import type { Pawn, Terrain, World } from '../../sim/types';

/**
 * Ground the colony has never laid eyes on.
 *
 * Not black. A black square in a dark panel has no edge, and the player would
 * lose track of where the map stops and the interface starts — which is the one
 * thing a minimap absolutely must not do. This is dark enough to read as "no
 * information" and light enough to have a shape.
 */
export const UNSEEN = 0x141a22;

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
 * nine thousand pixels every frame to discover that nothing moved is work the
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

/** How wide the map is drawn, in CSS pixels. Square, because the map is. */
const FACE = 200;
/** Marks, in CSS pixels, indexed by `MiniMark.size`. */
const MARK_PX = [0, 3, 4, 6];
const MAX_DPR = 2;

/**
 * The panel. One offscreen canvas at one pixel a cell, scaled up with smoothing
 * off — which is the whole trick: the browser does the nearest-neighbour blit in
 * one call, so the cost of drawing the map is the cost of painting it, and the
 * map is only repainted when `mapSignature` says something moved.
 */
export class Minimap {
  readonly el: HTMLElement;
  private readonly base = document.createElement('canvas');
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly face = document.createElement('canvas');
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
  private dpr = 0;

  constructor(onFocus: (x: number, y: number) => void) {
    this.baseCtx = this.base.getContext('2d')!;

    this.face.style.width = `${FACE}px`;
    this.face.style.height = `${FACE}px`;
    this.face.style.display = 'block';
    this.ctx = this.face.getContext('2d')!;

    this.el = document.createElement('div');
    this.el.className = 'panel';
    this.el.id = 'minimap';
    this.el.append(this.face);

    // Drag as well as tap: scrubbing a thumb across the valley and watching the
    // colony view follow is how a player finds a place they cannot name.
    let held = false;
    const jump = (e: PointerEvent) => {
      const world = this.world;
      const r = this.face.getBoundingClientRect();
      if (!world || r.width === 0 || r.height === 0) return;
      const cell = cellAt(world, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      onFocus(cell.x, cell.y);
    };
    this.face.addEventListener('pointerdown', (e) => {
      held = true;
      this.face.setPointerCapture(e.pointerId);
      jump(e);
      e.preventDefault();
    });
    this.face.addEventListener('pointermove', (e) => {
      if (held) jump(e);
    });
    const release = (e: PointerEvent) => {
      held = false;
      if (this.face.hasPointerCapture(e.pointerId)) this.face.releasePointerCapture(e.pointerId);
    };
    this.face.addEventListener('pointerup', release);
    this.face.addEventListener('pointercancel', release);
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

    const sig = mapSignature(world);
    if (sig !== this.sig) {
      this.sig = sig;
      paintMap(world, buffer);
      pixels.data.set(buffer);
      this.baseCtx.putImageData(pixels, 0, 0);
    }

    const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.face.width = Math.round(FACE * dpr);
      this.face.height = Math.round(FACE * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, FACE, FACE);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, FACE, FACE);

    const scale = FACE / world.width;
    for (const m of marksOf(world, possessed ? possessed.id : null)) {
      const px = MARK_PX[m.size]!;
      ctx.fillStyle = hex(m.color);
      ctx.fillRect((m.x + 0.5) * scale - px / 2, (m.y + 0.5) * scale - px / 2, px, px);
    }

    if (quad) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1;
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
      const reach = MARK_PX[3]! * 1.8;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(possessed.facing) * reach, y + Math.sin(possessed.facing) * reach);
      ctx.stroke();
    }
  }
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
