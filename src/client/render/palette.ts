/**
 * One palette for the whole game. Aetherhold's register: cold blue-grey dusk,
 * warm lamplight, moss and slate. Kept in one file so the manager view and the
 * first-person view are lit by the same colours.
 */

import * as THREE from 'three';
import { turningAt, warmthAt } from '../../sim/seasons';
import { holdsSnow } from '../../sim/snowpack';
import type { BuildingKind, ResourceKind, Terrain } from '../../sim/types';

export const TERRAIN_COLOR: Record<Terrain, number> = {
  grass: 0x4a6b45,
  dirt: 0x6b5a44,
  stone: 0x6e6f72,
  rock: 0x585b61,
  water: 0x2c4a63,
  sand: 0x8f8163,
  // Laid floors are the one terrain a person made, so they are the one terrain
  // with a warm, even tone — a swept board room reads as *indoors* from the
  // manager camera even before the walls are up around it.
  plank: 0x9c7c4f,
  paved: 0x8d9199,
  // Darker and greyer than the plank floor it is made of — timber that lives in
  // the water, matched to the fishing stage standing further down the same shore.
  // In the 3D view this is the deck's colour; on the minimap it is the thing that
  // has to read, at one pixel a cell, as a line drawn *across* the lake.
  bridge: 0x7a6144,
};

/** The three things a year does to living ground, and how far each one goes. */
const FROST = new THREE.Color(0xccd6e2);
const AMBER = new THREE.Color(0xc08a3e);
const VERDURE = new THREE.Color(0x7fbf5f);
const FROST_MAX = 0.5;
const AMBER_MAX = 0.45;
const VERDURE_MAX = 0.2;

/**
 * Push a living colour — grass, leaves, moss — to where it should be this month.
 *
 * The top bar can say "Winter 2/5" all it likes; if the valley outside is the
 * same green it was in July, the season is a label on a clock rather than a
 * thing happening to the place. This is what makes it a thing happening to the
 * place, and it costs one lerp per corner.
 *
 * Continuous in `phase`, never stepped per season, for two reasons. Nine
 * thousand cells changing colour between one frame and the next is a pop, and
 * more importantly the *slow* version is the warning: a player who notices the
 * plots going gold has been told winter is coming by the ground itself, several
 * days before the alert strip says it in words.
 *
 * Mutates and returns `c`, so a caller can chain it onto a `setHex`. Untouched
 * by anything a person built: a plank floor and a stone wall are the same colour
 * in February as in June, which is exactly the contrast that makes the ground
 * around them read as alive.
 */
export function seasonTint(c: THREE.Color, phase: number): THREE.Color {
  const warmth = warmthAt(phase);
  const turning = turningAt(phase);
  // Gold first, then snow over the top of it: an autumn that runs late is a gold
  // valley going white, not a white valley going gold.
  if (turning > 0) c.lerp(AMBER, turning * AMBER_MAX);
  else c.lerp(VERDURE, -turning * VERDURE_MAX);
  if (warmth < 0) c.lerp(FROST, -warmth * FROST_MAX);
  return c;
}

/**
 * Ground the year can get at.
 *
 * Stone, rock and water look the same in February as in July — a boulder does
 * not have a season — and a laid floor is the work of a person and does not move
 * at all. That is the point of the exclusion rather than an oversight in it: a
 * settlement stays its own colour while the valley around it turns, which is
 * what makes the turning legible.
 */
export const LIVING_GROUND: ReadonlySet<Terrain> = new Set<Terrain>(['grass', 'dirt', 'sand']);

/**
 * Distinct ground colours the ground passes through in a year.
 *
 * Both things that draw ground cache it and repaint only when a checksum moves,
 * so the year has to enter that checksum as a whole number or nothing ever
 * changes. Sixty-four steps is a repaint every seventy-five seconds of play,
 * which is far below the threshold where an eye reads it as a step.
 */
export const SEASON_STEPS = 64;

/**
 * And the same trick for the snowpack, for the same reason.
 *
 * Coarser than the year at a third the range, because the pack moves in hours
 * where the seasons move in days: a blizzard buries the valley in half a game
 * day, and thirty-two steps across that is a repaint every forty seconds or so.
 */
export const SNOW_STEPS = 32;

/**
 * And once more for the ice, which is the slowest of the three.
 *
 * The lake takes a day and a half to make a surface and about as long to lose it,
 * so twenty-four steps is a repaint roughly every four seconds of that — finer
 * than the season and coarser than the pack, which is exactly where its clock
 * sits.
 */
export const ICE_STEPS = 24;

/**
 * Ice on the lake, and how far the frozen surface goes.
 *
 * Paler and colder than the water under it, and short of the snow lying on the
 * fields around it — a frozen lake in a white valley has to read as a *different*
 * white, or the one flat road across the map disappears into the ground on either
 * side of it exactly when it starts mattering. The blue that is left is the water
 * showing through, which is what stops it looking like a hole somebody filled in.
 */
const ICE = new THREE.Color(0xa8c4d8);
const ICE_MAX = 0.8;

/**
 * Lying snow, and how far the deepest of it goes.
 *
 * Not pure white and not far off it. Snow on the ground has to be the brightest
 * thing in the valley — brighter than the frost tint the year already puts on
 * dead grass, or a covered February and a bare one look the same from the
 * manager camera and the whole layer is invisible. The faint blue keeps it from
 * reading as a blown-out highlight under the low winter sun.
 */
const SNOW_LYING = new THREE.Color(0xe8eef6);
const SNOW_LYING_MAX = 0.85;

/**
 * `TERRAIN_COLOR` moved to where the year has got to, under however much snow is
 * lying on it. Mutates and returns `c`.
 *
 * The one place that decides what a cell of ground looks like today, because two
 * things draw ground — the 3D terrain mesh and the minimap — and a valley that
 * goes gold in one of them and stays green in the other is worse than one that
 * never changed at all.
 *
 * `depth` is the whole map's pack; which ground it actually settles on is
 * `snowpack.ts`'s call and not restated here, so what you see white is exactly
 * what a settler wades through. Snow goes on last, over the season: a late
 * autumn under a blizzard is gold ground going white, and when the thaw takes
 * the white away the gold is still there underneath it.
 */
export function groundColor(
  c: THREE.Color,
  kind: Terrain,
  phase: number,
  depth: number,
  ice = 0,
): THREE.Color {
  c.setHex(TERRAIN_COLOR[kind]);
  if (LIVING_GROUND.has(kind)) seasonTint(c, phase);
  if (depth > 0 && holdsSnow(kind)) c.lerp(SNOW_LYING, depth * SNOW_LYING_MAX);
  if (ice > 0 && kind === 'water') c.lerp(ICE, ice * ICE_MAX);
  return c;
}

export const BUILDING_COLOR: Record<BuildingKind, number> = {
  wall: 0x8a7a63,
  // Cool grey against timber's warm tan, so at a glance across the colony you can
  // see which stretch of the perimeter has been rebuilt in stone and which has not.
  stonewall: 0x7b7d80,
  lab: 0x5c6b74,
  door: 0x9a7f52,
  bed: 0x7d5f4a,
  // Clean linen against the bedroom's warm timber, so the sickbay reads as the
  // one scrubbed room in a colony made of mud and logs.
  medbed: 0xc3cbc8,
  table: 0x8b6f4e,
  // Paler ash than the dining table it sits beside, so two tables of the same
  // silhouette never read as the same object — and pale enough that the dark
  // green board laid on top has somewhere to show up against.
  gametable: 0xcbb083,
  stove: 0x59595f,
  bench: 0x8b7248,
  // Grey, water-stained timber — darker and colder than any plank in the colony,
  // because this is the one that has been standing in a lake. It also has to hold
  // up against three backgrounds the other buildings never sit on: summer water,
  // winter ice and the sand ring between them.
  fishhole: 0x6e6a5c,
  turret: 0x6a6f78,
  sandbag: 0x7d7458,
  // Darker than any floor it will ever be laid on. A deadfall is flat and knee-low,
  // so colour is the only thing that separates it from the ground at manager range
  // — and a player has to be able to count their own traps at a glance.
  trap: 0x4c4237,
  // Paler and greyer than a wall — weathered rail rather than fresh timber, which
  // keeps a fence line reading as a boundary and not as half-built defences.
  fence: 0xa2926f,
  lamp: 0xb9a06a,
  // Bleaker than the bed it copies: cold grey against the bedroom's warm timber,
  // so a glance across the base tells you which block is quarters and which is
  // the cell without having to click anything.
  prisonbed: 0x6d6a66,
  // The one cold colour on any building. A larder should read as frost from the
  // isometric camera, and pale blue-white is the only thing in the palette that
  // says "cold" without a label.
  cooler: 0x9fbcc6,
  // The two warm ones, deliberately at the other end of the palette from the
  // cooler: sooty fieldstone for the fire pit, and a rust-warm casing for the
  // heater so the machine that makes heat never reads as the machine that takes
  // it away, even at the isometric camera's distance.
  campfire: 0x6b5f57,
  heater: 0xb07348,
  // Weathered marker timber. The mound multiplies this down to turned earth in
  // the renderer, so one entry gives the plot two tones: a dark rectangle you can
  // count from the manager camera and a pale marker standing at the head of it.
  grave: 0x9a8c78,
  // Pale dressed stone — the only cold, bright thing a colony builds, which is
  // the point of it. Everything else in the base is timber, soil or iron, so a
  // statue reads from across the map as the one object nobody needed.
  statue: 0xc9c4b6,
  // The grid. Machined steel and oiled iron, one family so a glance picks the
  // powered things out of a base as a set — the generator warmest because it is
  // the one with a fire in it, the panel darkest because it is glass.
  generator: 0x8a6f52,
  conduit: 0x5f6a72,
  battery: 0x6f7a6a,
  solar: 0x3d4a5e,
  // Wet timber rather than machined steel: the mill is the one thing on the grid
  // that is mostly carpentry, and it wants to read as belonging to the water it
  // stands in rather than to the row of iron boxes up by the cabin.
  watermill: 0x6a5236,
  tree: 0x33502f,
};

export const RESOURCE_COLOR: Record<ResourceKind, number> = {
  wood: 0x8a5f36,
  steel: 0x8d949c,
  rawfood: 0x7f9c46,
  meal: 0xc9a13f,
  medicine: 0xd8dde2,
  hide: 0xc08a5a,
};

export const SKY_DAY = new THREE.Color(0x7fa6c9);
export const SKY_NIGHT = new THREE.Color(0x0f1723);
export const SKY_DUSK = new THREE.Color(0xc4784a);
export const HORIZON_DAY = new THREE.Color(0xcfdce6);
export const HORIZON_NIGHT = new THREE.Color(0x1b2634);
/**
 * The flat grey a fully overcast noon sky lerps toward. Slightly blue rather than
 * neutral: a pure grey dome reads as a rendering failure, a cool one reads as cloud.
 */
export const OVERCAST_DAY = new THREE.Color(0x9fa8b2);

export const SUN_DAY = new THREE.Color(0xfff2d8);
export const SUN_DUSK = new THREE.Color(0xff9d5c);
export const MOON = new THREE.Color(0x8ea8cc);

export const FACTION_COLOR = {
  colony: 0x5f8fbf,
  raider: 0xa8443c,
  wildlife: 0x7a6438,
  fauna: 0x8a7a55,
  // Deliberately the one saturated colour on a body. A caravan is on the map for
  // half a day and the player has to spot it from the isometric camera without
  // being told twice.
  trader: 0xc8a13a,
  // Washed-out and colourless — the raider red drained out of them. Reads as
  // "not a threat, not yet one of yours", which is exactly what they are.
  prisoner: 0x8d8478,
} as const;

/** Hide colours for the grazing herds. Warmer and duller than anything wearing cloth. */
export const ANIMAL_COLOR = {
  mossback: 0x6f6244,
  dunhare: 0x9c8a68,
  // Rust, against the two dun browns and the grey. A brambletail is the smallest
  // thing on the map — three tenths of a mossback — so it cannot rely on shape to
  // be picked out of grass at manager zoom, and a player who is meant to notice
  // that the moor has more of them this month than last has to be able to count
  // them at a glance. The colour is doing the work the silhouette cannot.
  brambletail: 0xa4552c,
  // Cold where the other two are warm. A fenwolf has to read as *not one of the
  // herd* from across the map at manager zoom, before its shape resolves at all,
  // because the whole decision it asks for is "is that thing in my pen mine".
  fenwolf: 0x494551,
} as const;

/** A stable per-pawn clothing tint from their colorSeed, so bodies read apart. */
export function pawnTint(base: number, seed: number): THREE.Color {
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + (seed % 17) / 90) % 1,
    Math.min(0.85, hsl.s + ((seed >> 3) % 5) * 0.04),
    Math.max(0.2, Math.min(0.72, hsl.l + (((seed >> 6) % 7) - 3) * 0.035)),
  );
  return c;
}

export const SKIN_TONES = [0xd7ab86, 0xb98a63, 0x8d6144, 0x6a4630, 0xecc8a6, 0x4d3324];
