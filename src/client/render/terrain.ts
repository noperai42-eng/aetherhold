/**
 * Ground and rock. One non-indexed quad per cell, coloured at its corners rather
 * than its middle so neighbouring ground bleeds together instead of tiling, plus
 * instanced blocks for rock — which is solid terrain, so it has to look like
 * something you cannot walk through, because you cannot. The block is a faceted,
 * flat-topped boulder rather than a crate, but it is still sized and placed as a
 * crate: everything that has to clear a rock or stand on one reads the crate,
 * and the boulder is built to stay inside it and to reach its lid.
 */

import * as THREE from 'three';

import { ICE_STEPS, SEASON_STEPS, SNOW_STEPS, TERRAIN_COLOR, groundColor } from './palette';
import { yearPhase } from '../../sim/seasons';
import { holdsSnow, snowDepth } from '../../sim/snowpack';
import { BEARING, iceDepth } from '../../sim/ice';
import { TERRAIN_LIST, isFloor, packCell, terrainAt } from '../../sim/types';
import type { Terrain, World } from '../../sim/types';

/**
 * How far a full pack lifts the ground it is lying on.
 *
 * Thirteen centimetres on a one-metre cell, which is the number that makes snow
 * read as a *layer* rather than as a repaint. Colour alone cannot do it: a white
 * field and a white floor are the same white, and the eye has nothing to tell it
 * which one has depth. Thirteen centimetres does three things at once. It catches
 * the light on the slope where the pack runs down to a path, so a plank walk in
 * deep snow sits in a visible trench. It laps up the foot of every wall, crate
 * and tree, because those are drawn from the ground plane and do not move. And it
 * puts a settler's boots *in* it — ankle deep on a 1.7 m body, which is what
 * makes the yard look cold rather than bleached.
 *
 * Deliberately far too shallow to stand on. Nothing in the sim knows this number
 * and nothing should: the snow that matters is one field on `World`, and this is
 * the renderer's opinion about how to draw it. Collision never consults it, so
 * there is nothing here for the visuals and the collision to disagree about.
 */
const SNOW_LIFT = 0.13;

/**
 * How far the lake bed drops below the bank it sits in.
 *
 * The same corner lattice that lifts snow sinks water, and it is the averaging
 * that does the work: a corner in open water is surrounded by four wet cells and
 * takes the full drop, while a corner on the shore is only half wet and takes
 * half of it. So the middle of the lake comes out flat at the bottom of the
 * bowl, and the one-cell ring around it is a bank sloping down into the water,
 * without a single line about shorelines anywhere in the mesh.
 *
 * Forty-two centimetres is chosen against `ROCK_SINK`, not against anything about
 * water: a boulder only sinks fifteen, so a cliff standing on a corner this deep
 * would show daylight under its own base. Worldgen keeps a cell of dry ground
 * between the lake and every rock precisely so that corner never exists — which
 * is why this number is allowed to be big enough to see.
 */
const WATER_SINK = 0.42;

/** How much darker open water is than the shallows at its edge. */
const WATER_SHADE = 0.22;

/** The tallest a rock block gets. Anything that must clear every rock uses this. */
export const ROCK_HEIGHT = 2.45;
const ROCK_MIN_HEIGHT = 1.55;
/** How far a block sinks into the ground, so no cliff floats above its own seam. */
const ROCK_SINK = 0.15;
/**
 * Tilt range in radians, on top of the quarter turn every block gets. Small,
 * because a block still has to cover its own cell.
 */
const ROCK_TILT = 0.07;
/**
 * How much of the block's height is cap, as a fraction of that height.
 *
 * A fraction rather than a length because the block is a unit mesh stretched to
 * its height per instance, so this is what the cap can be. It comes out between
 * forty and sixty-five centimetres on a real block — a bevelled shoulder and a
 * plateau, not a chamfer. That size is the point: a cliff with a straight top
 * edge is a wall of crates however well its corners are sanded, and only a top
 * that has no straight edge at all reads as rock from the manager view.
 * Everything above the shoulder is above every neighbour of the same height, so
 * the cap costs nothing in coverage.
 */
const ROCK_DOME = 0.26;
/**
 * The cap's profile, ring by ring, from the shoulder up: [how far up the cap,
 * how much of the base outline the ring keeps, how far it has gone from rounded
 * square to circle]. Hand-set rather than a curve, because the shape wanted is
 * not a curve: a steep bevel off the shoulder, then a broad plateau that only
 * rises a few centimetres more to the peak. A dome sanded from a superellipse
 * was a cushion — the same slope everywhere, so nothing on it read as a face —
 * and stone is faces. The first step is big enough to crease against the
 * vertical side (`ROCK_CREASE`); the ones above it are shallow enough not to,
 * so the plateau is lit as one plate with a hard rim.
 */
const ROCK_CAP: readonly [number, number, number][] = [
  [0.25, 0.88, 0.2],
  [0.54, 0.72, 0.5],
  [0.87, 0.5, 0.85],
];
/**
 * Where the plateau peaks, as a fraction of the block's width from the cell
 * centre.
 *
 * Off-centre so the lump is lopsided, and lopsided so that the quarter turn a
 * cell gets is a different silhouette and not the same one again: one mesh is
 * drawn thousands of times, and the peak's four positions are what stop a cliff
 * reading as a grid of identical humps.
 */
const ROCK_PEAK_X = 0.11;
const ROCK_PEAK_Z = -0.06;
/**
 * How far the vertical edges of the base are rounded off, as a fraction of the
 * block's width.
 *
 * Small on purpose. Every centimetre here is a centimetre the block has to be
 * wider to keep covering its cell (`ROCK_COVER`), and that width is what a mined
 * corridor loses on each side. The rounding the eye wants comes from the cap,
 * which is free, not from the base, which is not.
 */
export const ROCK_EDGE = 0.08;
/**
 * The deepest a dent in the block's side can go, as a fraction of its width.
 *
 * The sides are the part of the boulder that neighbours and corridors see, and
 * every dent in them is paid for in `ROCK_COVER`, so they are only ever dented
 * inward and only this far. The cap is dented far more (`ROCK_LUMP`): it stands
 * clear of everything, so its noise is free.
 */
export const ROCK_JITTER = 0.04;
/**
 * How far the cap's skin wanders, in or out, as a fraction of the block's width.
 * Low-frequency, so the result is a lump with a few bulges rather than a rough
 * one — roughness is the material's job, and at this triangle count it would
 * only read as grain.
 */
const ROCK_LUMP = 0.11;
/**
 * How far the plateau's skin wanders, at the top ring and the peak. A fraction
 * of the flanks', so the top of a block is a plate that tips a few degrees and
 * not a second lump on the first.
 */
const ROCK_PLATEAU_LUMP = 0.025;
/**
 * How much of the skin's displacement is per-vertex rather than per-bulge.
 *
 * The smooth noise moves neighbouring vertices together, which bends a face;
 * this much of it is a hash of the vertex alone, which moves each corner of a
 * face its own way and so tips the whole face. Tipped faces are what make the
 * block angular: a few of them land past the crease angle and are lit flat,
 * and the rest are a skin that undulates instead of one that ripples.
 */
const ROCK_FACET = 0.4;
/**
 * The angle between two faces past which they stop sharing a normal, so the edge
 * between them lights as an edge.
 *
 * Below it the skin is one smooth surface, which is what the bulges want; above
 * it the shading breaks, which is what the shoulder and the tipped facets want.
 * Thirty-four degrees is set to fall between the two: the first step of the cap
 * leans further than that off the vertical side and creases, the steps above it
 * lean less than that off each other and do not, and only the facets the noise
 * has tipped hardest join the shoulder as hard edges.
 */
export const ROCK_CREASE = THREE.MathUtils.degToRad(34);
/**
 * How dark the block is at its buried base, as a multiplier of its colour that
 * rises to one by the shoulder.
 *
 * The block's own contact shadow, painted into the mesh: the ground corners
 * already darken toward a cliff (`AO_PER_ROCK`), and this is the other half of
 * that meeting, so the foot of a cliff is dark on both sides of the seam rather
 * than a bright wall standing on a dark floor.
 */
const ROCK_UNDER = 0.62;
/** How much one facet's tint may differ from the next, so a plate is not one flat grey. */
const ROCK_FACET_TINT = 0.08;
/**
 * Stone that is not the palette's rock: what a warm block leans toward, what a
 * cool one leans toward, and the lichen that grows on the ones that get it.
 *
 * The palette owns the one true rock colour, and everything that has to agree
 * with a rock — the mined stone, the walls built from it — reads that. These
 * are deviations from it, not colours of their own, which is why they live here
 * with the block and are only ever reached by a lerp of `ROCK_TINT` or less.
 */
const ROCK_WARM = new THREE.Color(0x6e6559);
const ROCK_COOL = new THREE.Color(0x505a6b);
const ROCK_LICHEN = new THREE.Color(0x66754d);
/** How far a block goes toward its warm or cool stone, at the most it ever does. */
const ROCK_TINT = 0.35;
/** The share of blocks that carry lichen, and how green the greenest of them gets. */
const ROCK_LICHEN_SHARE = 0.3;
const ROCK_LICHEN_MAX = 0.45;
/** Vertices around one ring of the boulder. Rings times this is the triangle budget. */
const ROCK_AROUND = 18;
/**
 * How much wider a block has to be than the square it is covering, now that its
 * corners are rounded and its sides are dented.
 *
 * A square with corners of radius r is cut in on the diagonal by r(1 − 1/√2), and
 * a dent can cut any side in by the jitter. Each is charged twice, once per side,
 * and the dent is charged at its full depth rather than its diagonal share, which
 * is more than the corner strictly needs and is the simpler number to defend.
 */
const ROCK_COVER = 1 / (1 - 2 * ROCK_EDGE * (1 - Math.SQRT1_2) - 2 * ROCK_JITTER);
/** How much a corner darkens per touching rock cell — the shadow a cliff casts on its own foot. */
const AO_PER_ROCK = 0.12;
/**
 * Micro-relief in the ground's colour, and only its colour: the lattice heights
 * are what the snowpack, the ice and the lake are measured against, and none of
 * this touches them.
 *
 * Six things ride the same corner lattice, so a corner shared by two cells is
 * still the same colour in both. A luminance patch moves whole handfuls of cells
 * together — the only one of the six that survives the manager camera, and the
 * reason the rest were never going to be enough on their own. A clod breaks that
 * patch up every two or three cells: too coarse for the camera to average away
 * and too fine to be a patch of its own, which is the band the ground was empty
 * in and the reason a mottle that measured wide enough still looked airbrushed.
 * A grain hashes each corner alone, which is the texture a body's-height view
 * finds and the manager view averages away. A speckle darkens a share of corners
 * again: a pebble or a bare scrape close up, grit from above. A hue drift pushes
 * the hue and the saturation with it, so two stretches of the same grass are two
 * greens. And wear pulls patches of living ground toward bare earth, which is the
 * one of the six that says what the variation *is*.
 *
 * All of them are scaled back on water and under snow, and the last two right
 * out: neither has a hue worth drifting, nothing wears through a lake, and a
 * saturated corner of ice would be a stain.
 */
/**
 * The speckle: what share of corners carry grit, how far the grittiest darkens,
 * and how far the same hash frays the edge of a worn patch.
 *
 * Graded from the threshold rather than switched at it, so grit thins out
 * instead of stopping, and one hash does both jobs: the corners that darken are
 * also the corners that go earliest to earth, because a speckle of bare soil and
 * a scrape of bare soil are the same thing seen at two distances. That coupling
 * is what puts something *in* the boundary between grass and trodden ground —
 * `GROUND_DRY_FRAY` is worth a seventh of the noise it frays, which breaks the
 * threshold into a gritty margin a few corners deep rather than the clean
 * gradient it drew before.
 */
const GROUND_SPECKLE_SHARE = 0.2;
const GROUND_SPECKLE = 0.07;
const GROUND_DRY_FRAY = 0.14;
/**
 * Wavelength of the luminance patch and of the hue drift, in cells per noise
 * cell, and how hard the patch is pushed toward its own ends.
 *
 * The hue drift was set at nine cells, which is wider than half the manager
 * view: a camera twenty cells across sat inside two noise cells and saw one flat
 * tint, so the variation was there in the buffer and invisible on the screen.
 * The hue and the wear are moved to four cells, which is four or five patches to
 * a screen.
 *
 * The luminance patch is the one that stays wide — eight cells — and that is not
 * a compromise, it is what the corner lattice can afford. A corner's luminance
 * is charged twice: it is the tone of a patch, and it is also one of four
 * numbers that have to agree well enough for a cell to read as flat ground
 * rather than as its own tile. A short wavelength spends the whole swing inside
 * one cell and every cell becomes a facet; a long one spends it between cells,
 * which is where the eye is looking. So luminance varies slowly and hue varies
 * quickly, and the fine detail the ground has close up is a change of green
 * rather than a change of brightness.
 */
const GROUND_PATCH_SCALE = 0.12;
const GROUND_PATCH_GAIN = 3.2;
/**
 * The clod: its wavelength in cells per noise cell, how hard it is pushed toward
 * its own ends, and how far it moves a corner's luminance.
 *
 * Three cells — the shortest wavelength that still spends most of its swing
 * *between* cells rather than inside one, which is the whole constraint on
 * luminance here. The patch says where the ground is dark; the clod says the
 * dark is made of lumps. Without it the ground is one soft airbrushed blob at
 * every zoom, because eight cells is wider than anything the eye reads as soil
 * and a corner-sized grain is finer than anything the manager camera keeps.
 *
 * It is added to the patch's *relief* rather than mixed into its noise, and that
 * is the whole trick: the patch is bent through a power curve that is nearly
 * flat across the middle of its range, so a clod folded in upstream survives
 * only inside the darkest patches and vanishes from the mid-tone the map is
 * mostly made of — which is exactly where the airbrushed look lived. Added
 * afterwards it is the same lump everywhere, at the one amplitude chosen for it,
 * and being symmetric it costs the field's mean nothing.
 */
const GROUND_CLOD_SCALE = 0.34;
const GROUND_CLOD_GAIN = 2.6;
const GROUND_CLOD_AMP = 0.1;
const GROUND_DRIFT_SCALE = 0.26;
const GROUND_DRIFT_HUE = 0.045;
const GROUND_DRIFT_SAT = 0.2;
/**
 * How much of the corner's luminance mottle is per-corner grain rather than
 * patch.
 *
 * An eleventh, for the same reason the patch is wide: grain is the part that
 * lands entirely inside one cell, so every point of it is paid for out of the
 * cell's own flatness. It used to be a seventh; the clod and the speckle both
 * spend from the same budget and both give more back at the manager camera than
 * white noise on a corner does, so the grain gave some of it up to them. What is
 * left is still a texture you find standing in the grass and cannot see from
 * above, which is exactly what grain is for.
 */
const GROUND_GRAIN = 0.09;
/**
 * The luminance mottle's shape: how far it may darken a corner, how sharply the
 * darkening comes on, how far it may lighten one, and the lift that puts the
 * mean back.
 *
 * Lopsided, because the ground is allowed to be much darker than the colour the
 * palette chose for it and barely allowed to be brighter — a meadow has shade
 * and worn ground in it, and nothing in it is a highlight the sun did not put
 * there. So the down side runs to two thirds and the up side to a twentieth,
 * and the power curve is what makes that survivable: at 1.6 the darkening is
 * almost nothing across the middle of the range and only bites in the last
 * third, so the map is its own colour with dark patches in it rather than a dark
 * map. The lift is the mean those patches cost, handed back to every corner —
 * measured over the whole lattice, not guessed — so the valley comes out at the
 * brightness it had before any of this and with three times the spread.
 */
const GROUND_MOTTLE_DOWN = 0.62;
const GROUND_MOTTLE_POW = 1.6;
const GROUND_MOTTLE_UP = 0.05;
const GROUND_MOTTLE_LIFT = 0.068;
/**
 * How much of the mottle survives on covered ground.
 *
 * A fifth. The mottle is a story about living ground drying out and wearing
 * through, and neither the lake nor a snowfield has that story: a drift with
 * two-thirds shadow in it is a dirty drift, and a pond with one is a pond with a
 * stain. What is left is about what the old flat jitter was, which is enough to
 * keep a white field from reading as paper without pretending there is anything
 * under it.
 */
const GROUND_MOTTLE_COVERED = 0.2;
/**
 * The bare-earth mottling: its wavelength, how much of the map it touches, and
 * how far the driest corner goes.
 *
 * The tone is not a colour of its own — it is the map's own dirt, seasoned in
 * the same month — so a dry patch in a meadow and the packed ground a cabin
 * stands on are the same earth at two strengths, and the boundary between them
 * comes out as a gradient of patches instead of one airbrushed blob. Half the
 * corners are dry to some degree and the driest go nearly half the way, which is
 * a long way in hue — green to olive to bare soil — and almost nothing in
 * luminance. That trade is the point: hue is the axis with room left in it once
 * the season tint has spent most of the luminance the ground had to spend.
 *
 * The tone is pushed a little off the palette's dirt before any of that: warmer
 * by a fiftieth of the wheel and a third again as saturated, which is the far end
 * of a lerp nothing else in the game reads, so it costs the mined stone and the
 * built floors nothing. It is spent on the one thing this mottle is for — a
 * worn corner has to be able to read as *earth* and not as grass that has been
 * turned down, and green to olive was still green.
 */
const GROUND_DRY_SCALE = 0.26;
const GROUND_DRY_SHARE = 0.5;
const GROUND_DRY_MAX = 0.46;
const GROUND_EARTH_HUE = -0.02;
const GROUND_EARTH_SAT = 0.14;
/**
 * The grain: the one part of the ground's variation that does not ride the
 * corner lattice, because it is the one part the lattice cannot carry.
 *
 * Everything above is a number per corner, and a number per corner is not grain
 * whatever its amplitude: it is ramped bilinearly across a whole cell — two
 * hundred pixels wide from a body's height — and averaged with its neighbours
 * before that. Six rounds of raising those constants said so with a
 * measurement: fit a plane to every 32-pixel tile of a frame and the residual
 * on flat ground stayed at a fifth of one grey level while the speckle share,
 * the speckle depth and the mottle lift all went up. The instrument was wrong,
 * not the numbers. So the grain moves off the lattice and into the fragment
 * shader, where the smallest thing that can vary is a pixel and not a metre.
 *
 * Four octaves, each [cycles per metre, share of the amplitude]: a lump most of
 * a metre across that the manager camera still resolves, down to a speck a
 * thumb wide that only a first-person view ever finds. They are hashed on world
 * position, so the grain belongs to the ground and not to the screen and
 * nothing swims when the camera pans; each fades out by its own screen
 * footprint before a pixel is wide enough to alias it, so pulling back retires
 * the fine ones quietly instead of boiling them; and the whole thing multiplies
 * the corner colour by one plus a symmetric noise, so it costs the field's mean
 * exactly nothing and the lift measured for the mottle above still pays for
 * what the mottle above spends.
 *
 * A fifth, and a peak rather than a typical one: four octaves this size only
 * rarely agree. Set by the measurement that failed for six rounds, taken on a
 * lit terrain-only frame at both cameras — the plane-fit residual on flat
 * ground goes from a fifteenth of a grey level to seven tenths at a body's
 * height, and from a third to one and a third from above, while the mean
 * luminance of the same ground moves by a tenth of a percent. Grain that costs
 * the mean nothing is the whole reason it is allowed to be this loud.
 */
const GROUND_GRAIN_AMP = 0.2;
const GROUND_GRAIN_OCTAVES: readonly [number, number][] = [
  [1.3, 0.34],
  [3.2, 0.26],
  [8.5, 0.22],
  [22, 0.18],
];
/**
 * How much of the grain survives on covered ground, on exactly the argument
 * `GROUND_MOTTLE_COVERED` makes about the mottle: grain is a story about soil, a
 * drift stippled with it is a dirty drift and a pond with it is a stained one.
 * It rides a per-vertex weight off the same corner lattice as the colour, so a
 * shore fades out of its grain over the cell the water fades into it.
 */
const GROUND_GRAIN_COVERED = 0.2;
/**
 * How the grain is shared out between the channels.
 *
 * Red moves least and blue moves most, which tilts the dark half of the noise
 * warm and the bright half cool: a dark speck is damp soil showing through and
 * a bright one is grit catching the sky, and that is the difference between
 * ground with something in it and ground with static on it. Symmetric per
 * channel, so no channel's mean moves either.
 */
const GROUND_GRAIN_TINT: readonly [number, number, number] = [0.85, 1, 1.15];
const UP = new THREE.Vector3(0, 1, 0);

/**
 * How high a bridge deck stands over the bank it leaves, and how thick it is.
 *
 * Six centimetres is a step up onto boards, not a climb: high enough that the deck
 * has a lit edge against the water it crosses, low enough that a settler walking
 * out onto it does not appear to levitate. Nothing in the sim reads either number —
 * a bridge cell is walkable at ground height like every other floor, and this is
 * only the renderer's account of what that looks like.
 */
const DECK_Y = 0.06;
const DECK_H = 0.12;
/** Handrail height above the deck, and how thick a rail is. */
const RAIL_H = 0.26;
const RAIL_T = 0.08;

/** One rock block's deterministic deviation from a plain unit crate. */
export interface RockShape {
  height: number;
  /** Yaw in radians: a quarter turn chosen per cell, plus a small tilt. */
  rot: number;
  /** Horizontal scale. Never less than the tilt costs. */
  scale: number;
  /** Lightness offset, so a cliff face is not one flat grey. */
  shade: number;
  /** In [−1, 1]: how far the block leans toward cool stone or warm. */
  warmth: number;
  /** In [0, 1]: how much lichen the block carries; zero on most of them. */
  lichen: number;
}

/**
 * The shape of the rock on a given cell.
 *
 * Pure and position-seeded: the same cell is the same block every session, and
 * mining one neighbour never reshuffles the cliff around it.
 */
export function rockShapeAt(x: number, y: number): RockShape {
  const a = hash(x, y, 3.71);
  const b = hash(x, y, 9.13);
  const c = hash(x, y, 17.29);
  const l = hash(x, y, 53.9);
  // A quarter turn per cell, because every block is the same lopsided lump and
  // four ways round is four different boulders; the tilt on top is what keeps
  // the four from lining up into rows.
  const rot = Math.floor(hash(x, y, 29.7) * 4) * (Math.PI / 2) + (b - 0.5) * 2 * ROCK_TILT;
  return {
    height: ROCK_MIN_HEIGHT + a * (ROCK_HEIGHT - ROCK_MIN_HEIGHT),
    rot,
    // A square turned by `rot` needs |cos|+|sin| of that angle just to cover
    // the ground it started on, and a square with its corners rounded off and
    // its sides dented needs `ROCK_COVER` of that again. Anything less opens a
    // seam you can see through and still cannot walk through — so the tilt and
    // the dents pay for themselves before the extra.
    scale: (Math.abs(Math.cos(rot)) + Math.abs(Math.sin(rot))) * ROCK_COVER + c * 0.05,
    shade: (c - 0.5) * 0.11,
    // Warmth and lichen are hashed apart from the shade, so a light block can be
    // cool or warm and a dark one can be green: three axes of variety on a cliff
    // rather than one, which is what stops the eye finding the repeat.
    warmth: (hash(x, y, 41.3) - 0.5) * 2,
    // Graded, not switched: the greenest block is the one furthest past the
    // threshold, and the ones just past it carry a trace, so lichen reads as
    // something that spreads rather than a second kind of rock.
    lichen: l > 1 - ROCK_LICHEN_SHARE ? (l - (1 - ROCK_LICHEN_SHARE)) / ROCK_LICHEN_SHARE : 0,
  };
}

/** Top surface of the rock block on this cell, in world units. */
export function rockTopAt(x: number, y: number): number {
  return rockShapeAt(x, y).height - ROCK_SINK;
}

/**
 * How far the drawn ground at the centre of a cell sits off the y = 0 plane:
 * up under the snowpack, down in the lake bed.
 *
 * Anything laid *on* the ground from outside this file — zone paint, a mark, the
 * selection ring — is built a few centimetres above y = 0 and needs to know the
 * ground is no longer there. A full pack lifts a field by `SNOW_LIFT`, which is
 * more than any of those ride, so without this a stockpile in January is paint
 * under thirteen centimetres of white and the player's zones vanish for the
 * winter. The centre of a cell is the average of its four lattice corners, and
 * each corner follows exactly the rule `rebuildCorners` uses to place the mesh
 * — rock left out, water and laid floor counted as bare, the bed sinking by how
 * wet the corner is and rising again as the ice thickens — restated here as a
 * pure function so a caller can ask without holding the view.
 */
export function groundLiftAt(world: World, x: number, y: number): number {
  const depth = snowDepth(world);
  const submerged = Math.max(0, 1 - iceDepth(world) / BEARING);
  const { width, height } = world;
  let lift = 0;
  for (let cy = y; cy <= y + 1; cy++) {
    for (let cx = x; cx <= x + 1; cx++) {
      let lying = 0;
      let wet = 0;
      let open = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const kind = terrainAt(world, nx, ny);
          if (kind === 'rock') continue;
          if (holdsSnow(kind)) lying++;
          if (kind === 'water' || kind === 'bridge') wet++;
          open++;
        }
      }
      if (open === 0) continue;
      lift += depth * SNOW_LIFT * (lying / open) - WATER_SINK * (wet / open) * submerged;
    }
  }
  return lift / 4;
}

export class TerrainView {
  readonly group = new THREE.Group();
  private readonly colors: Float32Array;
  private readonly positions: Float32Array;
  /** How much grain each ground vertex takes — see `GROUND_GRAIN_COVERED`. */
  private readonly grain: Float32Array;
  /** Corner colours on a (w+1)×(h+1) lattice — each one shared by up to four cells. */
  private readonly corners: Float32Array;
  /** Snow height on the same lattice, so neighbouring cells cannot open a crack. */
  private readonly cornerLift: Float32Array;
  /** Grain weight on the same lattice again, so it fades where the colour does. */
  private readonly cornerGrain: Float32Array;
  private readonly cornerStride: number;
  private readonly ground: THREE.Mesh;
  private readonly rocks: THREE.InstancedMesh;
  private readonly rockCapacity: number;
  /** Bridge decks: one slab per bridge cell, standing over the water it covers. */
  private readonly decks: THREE.InstancedMesh;
  /** Handrails: up to two per deck cell, on whichever sides face open water. */
  private readonly rails: THREE.InstancedMesh;
  private readonly deckCapacity: number;
  private checksum = -1;

  constructor(world: World) {
    const { width, height } = world;
    const cells = width * height;
    const positions = new Float32Array(cells * 18);
    this.positions = positions;
    this.colors = new Float32Array(cells * 18);
    this.grain = new Float32Array(cells * 6);
    this.cornerStride = width + 1;
    this.corners = new Float32Array(this.cornerStride * (height + 1) * 3);
    this.cornerLift = new Float32Array(this.cornerStride * (height + 1));
    this.cornerGrain = new Float32Array(this.cornerStride * (height + 1));

    let p = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x0 = x - 0.5;
        const x1 = x + 0.5;
        const y0 = y - 0.5;
        const y1 = y + 0.5;
        // Two triangles, wound counter-clockwise when seen from above.
        const quad = [x0, 0, y0, x0, 0, y1, x1, 0, y1, x0, 0, y0, x1, 0, y1, x1, 0, y0];
        for (let i = 0; i < 18; i++) positions[p + i] = quad[i]!;
        p += 18;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('grain', new THREE.BufferAttribute(this.grain, 1));
    geo.computeVertexNormals();

    this.ground = new THREE.Mesh(geo, groundMaterial());
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    this.rockCapacity = Math.max(1, countRock(world));
    this.rocks = new THREE.InstancedMesh(
      rockGeometry(),
      // White, because the real colour rides per instance — a cliff of one hex
      // reads as a wall of crates however well it is lit — and per vertex under
      // that, for the dark of the base and the tint of each facet, which the
      // instance colour multiplies rather than replaces. Smooth-shaded: the
      // creases the block wants are already in its normals, and flat shading
      // would put one on every triangle and hand the cushion back as a crate.
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true }),
      this.rockCapacity,
    );
    this.rocks.castShadow = true;
    this.rocks.receiveShadow = true;
    this.rocks.frustumCulled = false;
    this.group.add(this.rocks);

    // A deck is drawn rather than painted on, because the cell under it stays
    // lake: the bed goes on sinking, the water goes on shading dark, and when
    // winter comes the ice closes in under the boards. A bridge that were only a
    // colour on the ground would have filled the hole in instead, and the lake
    // would have healed over wherever anybody crossed it.
    this.deckCapacity = Math.max(1, countWater(world));
    this.decks = new THREE.InstancedMesh(
      // A shade under a full cell, so two decks laid side by side show a seam
      // and a causeway reads as boards rather than as one long slab.
      new THREE.BoxGeometry(0.96, DECK_H, 0.96),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }),
      this.deckCapacity,
    );
    this.decks.castShadow = true;
    this.decks.receiveShadow = true;
    this.decks.frustumCulled = false;
    this.group.add(this.decks);

    // Rails are what make it a bridge and not a raft. At manager range the deck
    // is a brown line on blue and could be anything; two rails give it sides, and
    // the sides are what say "you can walk here" from three screens away.
    this.rails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, RAIL_H, RAIL_T),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }),
      this.deckCapacity * 2,
    );
    this.rails.castShadow = true;
    this.rails.receiveShadow = false;
    this.rails.frustumCulled = false;
    this.group.add(this.rails);

    this.rebuild(world);
  }

  /**
   * Cheap change detector: mining is the only thing that edits terrain — and the
   * year, which repaints the same terrain a different colour, and the snow lying
   * on top of both.
   *
   * The season is folded in at 64 steps a year rather than continuously, because
   * a continuous read would rebuild thirty-seven thousand cells on every frame for a
   * colour change too small to see. Sixty-four steps is a repaint about every
   * seventy-five seconds of play and a gradient nobody can find the stairs in.
   * The pack gets its own coarser quantum for the same reason and a different
   * clock — see `SNOW_STEPS`.
   */
  sync(world: World): void {
    const step = Math.floor(yearPhase(world) * SEASON_STEPS);
    let sum =
      step * 7919 +
      Math.floor(snowDepth(world) * SNOW_STEPS) * 104729 +
      Math.floor(iceDepth(world) * ICE_STEPS) * 15485863;
    const t = world.terrain;
    for (let i = 0; i < t.length; i++) sum = (sum + t[i]! * (i + 1)) | 0;
    if (sum === this.checksum) return;
    this.checksum = sum;
    this.rebuild(world);
  }

  private rebuild(world: World): void {
    this.rebuildCorners(world);

    const { width, height } = world;
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let rockCount = 0;
    let deckCount = 0;
    let railCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Corner (cx, cy) sits at world (cx - 0.5, cy - 0.5); this order has to
        // match the quad wound in the constructor, vertex for vertex.
        const base = packCell(world, x, y) * 18;
        const here = terrainAt(world, x, y);
        // A bridge is the one floor that does not take the flat-floor branch: its
        // cell is still lake, and it wants the corner average — the dark of the
        // deep, the lift as the ice comes in — exactly as if the boards were not
        // there. The boards are a separate mesh standing over the top.
        if (isFloor(here) && here !== 'bridge') {
          // A laid floor is the one ground a person made, so it is the one ground
          // that does not bleed into its neighbours: all four corners take the
          // same colour, which gives the boards a straight edge against the grass
          // and makes a half-finished corridor read as half-finished.
          col.setHex(TERRAIN_COLOR[here]).offsetHSL(0, 0, floorShade(here, x, y));
          for (let i = 0; i < 18; i += 3) {
            this.colors[base + i] = col.r;
            this.colors[base + i + 1] = col.g;
            this.colors[base + i + 2] = col.b;
          }
        } else {
          this.writeCorner(base, x, y);
          this.writeCorner(base + 3, x, y + 1);
          this.writeCorner(base + 6, x + 1, y + 1);
          this.writeCorner(base + 9, x, y);
          this.writeCorner(base + 12, x + 1, y + 1);
          this.writeCorner(base + 15, x + 1, y);
        }

        // Height comes off the same lattice for *every* cell, floors included.
        // That is not a detail: two neighbouring cells are separate triangles
        // with no shared vertices, so they only stay welded because they read
        // the same corner and land on the same number. Lift a snowy cell without
        // lifting the path beside it and you open a slot straight through the
        // world, which from inside a body is a hole in the floor.
        this.writeLift(base, x, y);
        this.writeLift(base + 3, x, y + 1);
        this.writeLift(base + 6, x + 1, y + 1);
        this.writeLift(base + 9, x, y);
        this.writeLift(base + 12, x + 1, y + 1);
        this.writeLift(base + 15, x + 1, y);

        // And the grain weight off the same corners, floors included: the one
        // colour a person laid is still ground, and a flagstone with no grain on
        // it is the same lino the rest of this file is about. What it must not
        // be on is snow and water, and those it reads corner by corner like
        // everything else here — see `GROUND_GRAIN_COVERED`.
        const vert = packCell(world, x, y) * 6;
        this.writeGrain(vert, x, y);
        this.writeGrain(vert + 1, x, y + 1);
        this.writeGrain(vert + 2, x + 1, y + 1);
        this.writeGrain(vert + 3, x, y);
        this.writeGrain(vert + 4, x + 1, y + 1);
        this.writeGrain(vert + 5, x + 1, y);

        if (here === 'bridge' && deckCount < this.deckCapacity) {
          // The deck sits at a fixed height whatever the lattice under it is
          // doing. That is the point of drawing it separately: the corner beneath
          // is halfway down a bowl in July and level with the bank in January, and
          // a deck that followed it would sag into the lake in summer and lie flat
          // on the ice in winter. A bridge is a rigid thing on piles; it stays put
          // and the water moves around it.
          v.set(x, DECK_Y, y);
          q.identity();
          s.set(1, 1, 1);
          m.compose(v, q, s);
          this.decks.setMatrixAt(deckCount, m);
          // Board-to-board variation, position-seeded like everything else here,
          // so a long causeway is planks of slightly different timber rather than
          // one extruded ribbon.
          col.setHex(TERRAIN_COLOR.bridge).offsetHSL(0, 0, (hash(x, y, 61.3) - 0.5) * 0.09);
          this.decks.setColorAt(deckCount, col);
          deckCount++;

          // One rail per side that faces open water. A deck between two other
          // decks gets none, so the rails run down the flanks of a causeway and
          // stop where it meets the bank — which is also where you want to be
          // able to step off it.
          const sides: [number, number, number][] = [
            [0, -1, 0],
            [0, 1, 0],
            [-1, 0, Math.PI / 2],
            [1, 0, Math.PI / 2],
          ];
          col.setHex(TERRAIN_COLOR.bridge).offsetHSL(0, 0, 0.06);
          for (const [dx, dy, rot] of sides) {
            if (railCount >= this.deckCapacity * 2) break;
            if (!openWaterAt(world, x + dx, y + dy)) continue;
            v.set(x + dx * 0.46, DECK_Y + DECK_H / 2 + RAIL_H / 2, y + dy * 0.46);
            q.setFromAxisAngle(UP, rot);
            s.set(1, 1, 1);
            m.compose(v, q, s);
            this.rails.setMatrixAt(railCount, m);
            this.rails.setColorAt(railCount, col);
            railCount++;
          }
        }

        if (here === 'rock' && rockCount < this.rockCapacity) {
          const sh = rockShapeAt(x, y);
          v.set(x, sh.height / 2 - ROCK_SINK, y);
          q.setFromAxisAngle(UP, sh.rot);
          s.set(sh.scale, sh.height, sh.scale);
          m.compose(v, q, s);
          this.rocks.setMatrixAt(rockCount, m);
          // Toward warm or cool stone first, then the lichen over that, then the
          // lightness on top of all of it. Lerps rather than a hue offset because
          // the palette's rock is nearly grey, and turning the hue of a grey turns
          // nothing: the block has to be pulled toward a colour that has one.
          col.setHex(TERRAIN_COLOR.rock);
          if (sh.warmth > 0) col.lerp(ROCK_WARM, sh.warmth * ROCK_TINT);
          else col.lerp(ROCK_COOL, -sh.warmth * ROCK_TINT);
          if (sh.lichen > 0) col.lerp(ROCK_LICHEN, sh.lichen * ROCK_LICHEN_MAX);
          col.offsetHSL(0, 0, sh.shade);
          this.rocks.setColorAt(rockCount, col);
          rockCount++;
        }
      }
    }
    // Park unused instances at zero scale rather than leaving stale rocks behind.
    m.makeScale(0, 0, 0);
    for (let i = rockCount; i < this.rockCapacity; i++) this.rocks.setMatrixAt(i, m);
    this.rocks.count = this.rockCapacity;
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
    // Decks and rails, same treatment and for a sharper reason: a bridge is the
    // one thing here that gets *built* mid-game, so the tail of this pool is
    // whatever the last rebuild left in it.
    for (let i = deckCount; i < this.deckCapacity; i++) this.decks.setMatrixAt(i, m);
    for (let i = railCount; i < this.deckCapacity * 2; i++) this.rails.setMatrixAt(i, m);
    this.decks.count = this.deckCapacity;
    this.rails.count = this.deckCapacity * 2;
    this.decks.instanceMatrix.needsUpdate = true;
    this.rails.instanceMatrix.needsUpdate = true;
    if (this.decks.instanceColor) this.decks.instanceColor.needsUpdate = true;
    if (this.rails.instanceColor) this.rails.instanceColor.needsUpdate = true;
    (this.ground.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.ground.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.ground.geometry.getAttribute('grain') as THREE.BufferAttribute).needsUpdate = true;
    // The whole reason the lift is worth having: normals off the new surface, so
    // the sun finds the slope where the pack runs down into a path and the drift
    // has a lit face and a shaded one. Flat per-triangle, because the geometry is
    // non-indexed — and a drift is a few facets of white either way; the smoothing
    // that matters is on the boulders standing on it.
    this.ground.geometry.computeVertexNormals();

    // Deep snow is a slightly less matte surface than wet grass. One number on
    // one material, and it is what stops a white field reading as paper.
    const depth = snowDepth(world);
    (this.ground.material as THREE.MeshStandardMaterial).roughness = 0.95 - depth * 0.2;
  }

  /**
   * Every lattice corner, once.
   *
   * A corner is the average of the up-to-four cells that meet there, so grass
   * fades into sand the way ground does instead of stopping at a tile edge, and
   * it darkens for each rock cell touching it — a free contact shadow at the foot
   * of every cliff, with no second light and no shadow map.
   */
  private rebuildCorners(world: World): void {
    const c = new THREE.Color();
    const phase = yearPhase(world);
    const depth = snowDepth(world);
    // The dry tone, once for the whole map: it is `dirt` as the year has left it
    // this month, asked for without any pack on it, because the pack is already
    // accounted for corner by corner in `bare`. Hoisted because it is the same
    // colour at every corner and this loop runs thirty-seven thousand times.
    const dry = groundColor(new THREE.Color(), 'dirt', phase, 0).offsetHSL(
      GROUND_EARTH_HUE,
      GROUND_EARTH_SAT,
      0,
    );
    /**
     * How much of the lake bed's drop is still a drop.
     *
     * One over `BEARING` rather than one over one, so the surface comes up level
     * with the bank at the exact thickness the sim starts letting people walk on
     * it — not a moment before, when there would be a shelf of ice standing over
     * open water nobody can cross, and not a moment after, when a settler would be
     * standing in mid-air over a hole. The picture and the collision reach the same
     * conclusion on the same tick because they are reading the same number.
     */
    const submerged = Math.max(0, 1 - iceDepth(world) / BEARING);
    const { width, height } = world;
    for (let cy = 0; cy <= height; cy++) {
      for (let cx = 0; cx <= width; cx++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        let rock = 0;
        let lying = 0;
        let wet = 0;
        let open = 0;
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const kind = terrainAt(world, x, y);
            if (kind === 'rock') {
              rock++;
            } else {
              // Rock is left out of the height entirely rather than counted as
              // bare, so the pack runs up to the foot of a cliff at full depth
              // instead of dipping into it — which is where drifts actually
              // pile, and the blocks sink further into the ground than the snow
              // ever lifts, so nothing floats. Water and laid floor do count,
              // as zero: the pond stays a flat hole in the white, and a path is
              // a trench with the snow sloping down into it.
              if (holdsSnow(kind)) lying++;
              // A decked cell counts as wet, because it is: the boards are held up
              // over the lake, not laid on a filled-in one. Count it dry and the
              // bed would rise into a hump under every bridge and the water would
              // pale out around it, as though crossing the lake had drained it.
              if (kind === 'water' || kind === 'bridge') wet++;
              open++;
            }
            groundColor(c, kind, phase, depth, iceDepth(world));
            r += c.r;
            g += c.g;
            b += c.b;
            n++;
          }
        }
        const i = (cy * this.cornerStride + cx) * 3;
        if (n === 0) continue;
        // A little deterministic mottling so the whole map does not read as lino, and
        // a darkening with depth so the lake reads as something with a bottom
        // rather than as blue paint. The shading is free: the same count that
        // sinks the bed shades it, so the dark and the deep can never disagree —
        // and when the ice comes in, the one factor that raises the bowl is the
        // one that lifts the gloom out of it, so a frozen lake cannot come out
        // flat and still shadowed like a hole.
        const deep = (open === 0 ? 0 : wet / open) * submerged;
        // One hash, drawn once and spent twice — on the grit at this corner and,
        // further down, on how far this corner is dragged past the edge of a worn
        // patch. See `GROUND_SPECKLE_SHARE`.
        const grit = hash(cx, cy, 71.7);
        const speckle =
          grit > 1 - GROUND_SPECKLE_SHARE
            ? ((grit - (1 - GROUND_SPECKLE_SHARE)) / GROUND_SPECKLE_SHARE) * GROUND_SPECKLE
            : 0;
        // How much of this corner is living ground the weather can get at, which
        // is what the mottle, the hue drift and the wear are all stories about.
        // A corner in open water or under a full pack keeps the one colour the
        // palette gave it.
        const bare = (1 - (open === 0 ? 0 : wet / open)) * (1 - depth);
        const mottle = groundMottle(cx, cy);
        // The grit goes in with the mottle rather than after it, so it is scaled
        // back on covered ground with everything else — a drift stippled with
        // dark corners is a dirty drift — and so the one lift pays for both
        // means at once.
        const relief =
          GROUND_MOTTLE_LIFT -
          speckle +
          groundClod(cx, cy) * GROUND_CLOD_AMP +
          (mottle < 0
            ? -Math.pow(-mottle, GROUND_MOTTLE_POW) * GROUND_MOTTLE_DOWN
            : mottle * GROUND_MOTTLE_UP);
        const k = Math.max(
          0.15,
          1 -
            rock * AO_PER_ROCK -
            deep * WATER_SHADE +
            relief * THREE.MathUtils.lerp(GROUND_MOTTLE_COVERED, 1, bare),
        );
        c.setRGB((r / n) * k, (g / n) * k, (b / n) * k);
        // The hue drift and the dry patches, on bare living ground only. The hue
        // moves first and the earth goes over the top of it, in that order
        // because a patch of trodden ground is earth showing through the grass
        // rather than grass that has turned the colour of earth: the drift is
        // what the living cover is doing, and where the cover has worn away
        // there is less of it left to do anything.
        if (bare > 0) {
          const noise = valueNoise(cx * GROUND_DRIFT_SCALE + 5.5, cy * GROUND_DRIFT_SCALE + 2.5, 0.5);
          const drift = (noise - 0.5) * 2 * bare;
          c.offsetHSL(drift * GROUND_DRIFT_HUE, drift * GROUND_DRIFT_SAT, 0);
          const wear =
            valueNoise(cx * GROUND_DRY_SCALE + 19.7, cy * GROUND_DRY_SCALE + 13.1, 3.5) +
            (grit - 0.5) * GROUND_DRY_FRAY;
          if (wear > 1 - GROUND_DRY_SHARE) {
            // Clamped, because the fray can push a corner past the top of the
            // noise's own range and the driest corner is a number the palette
            // was chosen against, not one the grit gets to raise.
            const dryness = Math.min(1, (wear - (1 - GROUND_DRY_SHARE)) / GROUND_DRY_SHARE);
            c.lerp(dry, dryness * GROUND_DRY_MAX * bare);
          }
        }
        this.corners[i] = c.r;
        this.corners[i + 1] = c.g;
        this.corners[i + 2] = c.b;
        this.cornerLift[cy * this.cornerStride + cx] =
          open === 0 ? 0 : depth * SNOW_LIFT * (lying / open) - WATER_SINK * deep;
        // `bare` again, which is already the answer to "how much of this corner
        // is ground the weather can get at" — the grain is the same question
        // asked at a finer scale, so it is the same number and not a second one
        // that could drift out of step with it.
        this.cornerGrain[cy * this.cornerStride + cx] = THREE.MathUtils.lerp(
          GROUND_GRAIN_COVERED,
          1,
          bare,
        );
      }
    }
  }

  private writeCorner(dst: number, cx: number, cy: number): void {
    const i = (cy * this.cornerStride + cx) * 3;
    this.colors[dst] = this.corners[i]!;
    this.colors[dst + 1] = this.corners[i + 1]!;
    this.colors[dst + 2] = this.corners[i + 2]!;
  }

  private writeLift(dst: number, cx: number, cy: number): void {
    this.positions[dst + 1] = this.cornerLift[cy * this.cornerStride + cx]!;
  }

  private writeGrain(dst: number, cx: number, cy: number): void {
    this.grain[dst] = this.cornerGrain[cy * this.cornerStride + cx]!;
  }

  dispose(): void {
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.rocks.geometry.dispose();
    (this.rocks.material as THREE.Material).dispose();
    this.decks.geometry.dispose();
    (this.decks.material as THREE.Material).dispose();
    this.rails.geometry.dispose();
    (this.rails.material as THREE.Material).dispose();
  }
}

/**
 * The ground's material, and the grain that is drawn in it rather than in the
 * mesh.
 *
 * Standard, vertex-coloured and matte as it always was; everything added here
 * happens after `color_fragment`, which is the line where the corner colour
 * becomes the fragment's colour. The grain multiplies that, so it is a change of
 * how bright this square millimetre of a cell is and never a change of what
 * colour the cell is — the seams, the season, the wear and the mean the tests
 * measure all belong to the lattice and none of them can be moved from here.
 *
 * The noise is sampled on the ground's own world position, passed down as a
 * varying: a hash of where the mesh *is*, not of where it landed on the screen,
 * so panning and turning move the camera across a grain that stays where it is.
 * Each octave is faded out by `fwidth` of that position — how much world one
 * pixel covers — before the pixel is wide enough to undersample it, which is
 * what stops the fine octaves crawling as the manager camera pulls back and
 * what leaves the coarse one, most of a metre across, still doing its job there.
 * The per-vertex `grain` weight scales the lot, and it is what keeps all of this
 * off the snow and out of the lake.
 *
 * The hash and the smoothstep-blended value noise are the same pair the rest of
 * this file mottles with, transcribed into GLSL, so a corner and the pixels
 * inside it are grained by one family of numbers rather than two.
 */
function groundMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  const octaves = GROUND_GRAIN_OCTAVES.map(
    ([freq, share]) =>
      `groundGrain += ${share.toFixed(3)} * groundOctave(vGroundXZ, ${freq.toFixed(3)}, groundFootprint);`,
  ).join('\n      ');
  const [tr, tg, tb] = GROUND_GRAIN_TINT;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        /* glsl */ `
        attribute float grain;
        varying float vGrain;
        varying vec2 vGroundXZ;
        void main() {
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vGrain = grain;
        vGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
        `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `
        varying float vGrain;
        varying vec2 vGroundXZ;

        float groundHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float groundNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = p - i;
          f = f * f * (3.0 - 2.0 * f);
          float a = groundHash(i);
          float b = groundHash(i + vec2(1.0, 0.0));
          float c = groundHash(i + vec2(0.0, 1.0));
          float d = groundHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        // One octave, in [-1, 1], faded by how much of it lands inside one
        // pixel: full while a pixel spans under a quarter of a cycle, gone by
        // half of one, which is where undersampling turns grain into a shimmer.
        float groundOctave(vec2 p, float freq, float footprint) {
          float fade = 1.0 - smoothstep(0.25, 0.5, footprint * freq);
          if (fade <= 0.0) return 0.0;
          return (groundNoise(p * freq) - 0.5) * 2.0 * fade;
        }

        void main() {
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
      #include <color_fragment>
      float groundFootprint = max(fwidth(vGroundXZ.x), fwidth(vGroundXZ.y));
      float groundGrain = 0.0;
      ${octaves}
      diffuseColor.rgb *= 1.0 + groundGrain * vGrain * ${GROUND_GRAIN_AMP.toFixed(3)} *
        vec3(${tr.toFixed(3)}, ${tg.toFixed(3)}, ${tb.toFixed(3)});
      `,
      );
  };
  return mat;
}

/**
 * Grain on a laid floor.
 *
 * Boards run one way and are cut to slightly different tones; paving is laid in
 * a chequer. Both are position-seeded, so the pattern is stable while the colony
 * grows over it instead of shuffling every time a cell is added.
 */
function floorShade(kind: Terrain, x: number, y: number): number {
  const grain = (hash(x, y, kind === 'plank' ? 5.17 : 23.4) - 0.5) * 0.05;
  if (kind === 'plank') return (y % 2 === 0 ? 0.035 : -0.035) + grain;
  return ((x + y) % 2 === 0 ? 0.03 : -0.03) + grain;
}

/**
 * How far the ground at a lattice corner wants to move off its terrain's own
 * luminance, in [−1, 1]: a patch a manager camera can find, with the per-corner
 * grain a first-person one can, laid over it. The clod that goes between the two
 * is applied further downstream — see `GROUND_CLOD_SCALE`.
 *
 * The patch is opened out with a tanh, the same trick and for the same reason as
 * the boulder's skin: value noise huddles round its middle, so a field built
 * straight off it is nearly all mid-tone with a rare light or dark corner, which
 * is the one distribution that reads as flat. The tanh spends most of the range
 * near the ends, so a patch is light or dark and the ground between two patches
 * is where the middle goes.
 */
function groundMottle(x: number, y: number): number {
  const patch = valueNoise(x * GROUND_PATCH_SCALE + 11.3, y * GROUND_PATCH_SCALE + 7.9, 0.5);
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  const grain = (n - Math.floor(n)) * 2 - 1;
  return THREE.MathUtils.clamp(
    Math.tanh((patch - 0.5) * GROUND_PATCH_GAIN) * (1 - GROUND_GRAIN) + grain * GROUND_GRAIN,
    -1,
    1,
  );
}

/**
 * The lumps the patch is made of, in [−1, 1]: one more octave of the same value
 * noise, three cells wide, opened out with the same tanh.
 *
 * Kept apart from `groundMottle` because it is applied apart from it — see
 * `GROUND_CLOD_SCALE` for why the power curve is the reason.
 */
function groundClod(x: number, y: number): number {
  const clod = valueNoise(x * GROUND_CLOD_SCALE + 3.1, y * GROUND_CLOD_SCALE + 27.4, 8.5);
  return Math.tanh((clod - 0.5) * GROUND_CLOD_GAIN);
}

function hash(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt) * 43758.5453;
  return n - Math.floor(n);
}

/** Hash on the integer lattice `lumpNoise` interpolates over. */
function hash3(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Smooth value noise: the lattice hash, blended across each cell with a
 * smoothstep so the surface has no creases at the cell walls. In [0, 1].
 */
function valueNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = THREE.MathUtils.smoothstep(x - ix, 0, 1);
  const fy = THREE.MathUtils.smoothstep(y - iy, 0, 1);
  const fz = THREE.MathUtils.smoothstep(z - iz, 0, 1);
  const lerp = THREE.MathUtils.lerp;
  const x00 = lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx);
  const x10 = lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx);
  const x01 = lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx);
  const x11 = lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

/**
 * How far the skin at a point wants to bulge, in [−1, 1] and deterministic, so
 * the same block comes out every session.
 *
 * Two octaves of value noise at a wavelength of about half the block, which is
 * one or two bulges across a face — the scale of a lump, not of grain. The
 * vertical axis is sampled faster because the unit mesh is stretched to about
 * twice its width when it is drawn, and a bulge that was round on the unit
 * block would come out as a stripe.
 */
function lumpNoise(x: number, y: number, z: number): number {
  const a = valueNoise(x * 2.1 + 3.3, y * 3.6 + 1.7, z * 2.1 + 9.2);
  const b = valueNoise(x * 4.7 + 7.1, y * 8.0 + 5.9, z * 4.7 + 2.4);
  // Value noise huddles round its middle; a tanh opens it out to fill the range
  // without the hard plateau a clamp would leave on the biggest bulges.
  return Math.tanh((0.7 * a + 0.3 * b - 0.5) * 6);
}

/**
 * How far the outline of the block's base reaches along a direction, for a
 * square of half-width ½ whose corners are rounded to `ROCK_EDGE`.
 */
function baseReach(c: number, s: number): number {
  const a = Math.abs(c);
  const b = Math.abs(s);
  const h = 0.5;
  const r = ROCK_EDGE;
  const side = h / Math.max(a, b);
  if (side * Math.min(a, b) <= h - r) return side;
  // In a corner: the ray meets the quarter circle centred (h − r, h − r).
  const k = h - r;
  const dot = (a + b) * k;
  return dot + Math.sqrt(dot * dot - 2 * k * k + r * r);
}

/**
 * The block every rock instance draws.
 *
 * One boulder, built once and shared: the per-cell height, yaw, width and shade
 * all ride in the instance matrix, so the mesh only has to be a convincing lump
 * inside the unit crate it replaced. Three things hold that contract. The highest
 * point sits exactly at +½, so `rockTopAt` and the clearance height mean what
 * they did. Nothing reaches past ±½ sideways, so `scale` is still the footprint.
 * And the base ring at −½ is the full rounded square, so a block meets the block
 * beside it and the ground under it without a seam — the base is buried fifteen
 * centimetres under ground that never sinks near a rock, so it needs no floor.
 *
 * The form is a straight-sided stump with a bevelled cap on it. The stump is the
 * base outline carried up to the shoulder; above the shoulder `ROCK_CAP` steps
 * the rings in toward a peak that is deliberately off-centre, and each ring's
 * outline blends from the rounded square to a circle on the way up so no corner
 * of the base runs up the cap as a ridge. Then the skin is displaced along its
 * normals by noise that is part bulge and part per-vertex facet: inward only on
 * the stump, and only as deep as `ROCK_COVER` has paid for; in or out on the cap,
 * out only as far as the crate wall allows, so no dent can be clamped into a
 * flat spot. The whole thing is rescaled so the highest vertex is at the lid,
 * wherever the noise put it. It is one indexed mesh, welded everywhere except
 * where two faces meet past `ROCK_CREASE`: there, and only there, the vertex is
 * split so the edge lights as an edge — the shoulder rim, and the facets the
 * noise tipped hardest. Everywhere else the normals bend and the skin is one
 * continuous surface.
 */
function rockGeometry(): THREE.BufferGeometry {
  const shoulder = 0.5 - ROCK_DOME;
  // Each ring is [height, how much of the base outline it keeps, how far it has
  // gone from rounded square to circle]. The stump first — a ring in the middle
  // of it, so the side noise has a vertex to dent — then the cap, then the peak.
  const rings: [number, number, number][] = [];
  for (const y of [-0.5, -0.2, 0.04, shoulder]) rings.push([y, 1, 0]);
  for (const [u, w, round] of ROCK_CAP) rings.push([shoulder + u * ROCK_DOME, w, round]);

  const n = ROCK_AROUND;
  const pos: number[] = [];
  for (const [y, w, round] of rings) {
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const r = baseReach(c, s) * (1 - round) + 0.5 * round;
      pos.push(ROCK_PEAK_X + (c * r - ROCK_PEAK_X) * w, y, ROCK_PEAK_Z + (s * r - ROCK_PEAK_Z) * w);
    }
  }
  const peak = pos.length / 3;
  pos.push(ROCK_PEAK_X, 0.5, ROCK_PEAK_Z);

  const idx: number[] = [];
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i;
      const b = j * n + ((i + 1) % n);
      idx.push(a, a + n, b, b, a + n, b + n);
    }
  }
  const top = (rings.length - 1) * n;
  for (let i = 0; i < n; i++) idx.push(top + i, peak, top + ((i + 1) % n));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  let lid = -0.5;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    // Nothing at the buried base, the full side dent by the shoulder, the full
    // lump on the flanks of the cap, and only a trace of it again on the plateau
    // — windowed, because the plateau is the one part that has to stay a plate:
    // give its ring the flanks' noise and the fan to the peak comes back as a
    // cone, creased on every face. The stump can only go inward, so its noise is
    // folded to one sign rather than half of it thrown away at the wall — a face
    // that is dented in places is a face; one that is dented or flat is a crate
    // with damage. The fold eases off up the cap, where there is room to bulge.
    const t = (y - shoulder) / ROCK_DOME;
    const amp =
      y <= shoulder
        ? (ROCK_JITTER * (y + 0.5)) / (shoulder + 0.5)
        : THREE.MathUtils.lerp(ROCK_PLATEAU_LUMP, ROCK_LUMP, Math.sin(Math.PI * t) ** 1.5);
    const fold = y <= shoulder ? 1 : 1 - t;
    const noise = lumpNoise(x, y, z) * (1 - ROCK_FACET) + facetNoise(x, y, z) * ROCK_FACET;
    // The peak is nudged straight up by its whole amplitude rather than rolled
    // for: it is the one vertex whose height is a promise, and it can only keep
    // it by being the lid the rest is measured against.
    let d = i === peak ? amp : ((noise - fold) / (1 + fold)) * amp;
    if (d > 0) {
      // Outward, only as far as the crate wall it is heading for.
      let room = Infinity;
      if (nx * x > 0) room = Math.min(room, (0.5 - Math.abs(x)) / Math.abs(nx));
      if (nz * z > 0) room = Math.min(room, (0.5 - Math.abs(z)) / Math.abs(nz));
      d = Math.min(d, room);
    }
    const ny2 = y + ny * d;
    lid = Math.max(lid, ny2);
    p.setXYZ(
      i,
      THREE.MathUtils.clamp(x + nx * d, -0.5, 0.5),
      ny2,
      THREE.MathUtils.clamp(z + nz * d, -0.5, 0.5),
    );
  }
  // The lid is a promise to everything that clears a rock, so the highest point
  // is put exactly on it: the base stays at −½ and the rest is stretched or
  // squashed to fit, which is a change of a centimetre or two nobody sees.
  for (let i = 0; i < p.count; i++) p.setY(i, -0.5 + (p.getY(i) + 0.5) / (lid + 0.5));
  geo.dispose();
  return creased(idx, p, shoulder);
}

/**
 * The finished block, with its normals broken at the creases and its colour
 * painted on.
 *
 * `computeVertexNormals` averages every face that meets at a vertex, which is
 * right for a bulge and wrong for an edge: the shoulder rim would be a soft
 * roll and the tipped facets would be smeared back into the skin. So the normal
 * is built per face corner instead, from only the neighbouring faces that lie
 * within `ROCK_CREASE` of this one, and a vertex whose corners disagree is split
 * — once per distinct normal, so a vertex on a smooth stretch stays one vertex
 * and a vertex on a hard rim becomes two. The index survives, the triangle count
 * does not change, and a split only ever appears where there is a crease to
 * show for it.
 *
 * The colour goes on here because it is per split vertex: the dark of the base
 * that rises to the shoulder, and a tint per facet that is hashed from the
 * normal as well as the position, so the two sides of a crease are two tones.
 */
function creased(idx: number[], p: THREE.BufferAttribute, shoulder: number): THREE.BufferGeometry {
  const faces = idx.length / 3;
  const faceN = new Float32Array(faces * 3);
  const touching: number[][] = Array.from({ length: p.count }, () => []);
  for (let f = 0; f < faces; f++) {
    const [a, b, c] = [idx[f * 3]!, idx[f * 3 + 1]!, idx[f * 3 + 2]!];
    const ax = p.getX(a);
    const ay = p.getY(a);
    const az = p.getZ(a);
    const ux = p.getX(b) - ax;
    const uy = p.getY(b) - ay;
    const uz = p.getZ(b) - az;
    const vx = p.getX(c) - ax;
    const vy = p.getY(c) - ay;
    const vz = p.getZ(c) - az;
    // Left as the cross product, so a bigger face weighs more in the average.
    faceN[f * 3] = uy * vz - uz * vy;
    faceN[f * 3 + 1] = uz * vx - ux * vz;
    faceN[f * 3 + 2] = ux * vy - uy * vx;
    touching[a]!.push(f);
    touching[b]!.push(f);
    touching[c]!.push(f);
  }
  const unit = (f: number): [number, number, number] => {
    const x = faceN[f * 3]!;
    const y = faceN[f * 3 + 1]!;
    const z = faceN[f * 3 + 2]!;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  };
  const cosCrease = Math.cos(ROCK_CREASE);

  const outPos: number[] = [];
  const outNrm: number[] = [];
  const outCol: number[] = [];
  const outIdx = new Array<number>(idx.length);
  for (let v = 0; v < p.count; v++) {
    const fs = touching[v]!;
    // Smoothing groups round this vertex: two faces that share an edge here and
    // lie within the crease angle of each other smooth together, and the groups
    // are the connected runs of those. Grouping by adjacency rather than by
    // each face's own view of its neighbours matters on the plateau, where the
    // fan's faces span more than the crease angle end to end but no two beside
    // each other do — judged one face at a time that is a peak split eighteen
    // ways with nearly the same normal on all of them; judged as a run it is
    // one vertex, which is what the eye sees and what the budget can afford.
    const group = fs.map((_, i) => i);
    const find = (i: number): number => {
      while (group[i] !== i) i = group[i]!;
      return i;
    };
    for (let i = 0; i < fs.length; i++) {
      const [ax, ay, az] = unit(fs[i]!);
      for (let j = i + 1; j < fs.length; j++) {
        if (!shareEdge(idx, fs[i]!, fs[j]!, v)) continue;
        const [bx, by, bz] = unit(fs[j]!);
        if (ax * bx + ay * by + az * bz < cosCrease) continue;
        group[find(i)] = find(j);
      }
    }
    const out = new Map<number, number>();
    for (let i = 0; i < fs.length; i++) {
      const root = find(i);
      let o = out.get(root);
      if (o === undefined) {
        let nx = 0;
        let ny = 0;
        let nz = 0;
        for (let j = 0; j < fs.length; j++) {
          if (find(j) !== root) continue;
          nx += faceN[fs[j]! * 3]!;
          ny += faceN[fs[j]! * 3 + 1]!;
          nz += faceN[fs[j]! * 3 + 2]!;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        o = outPos.length / 3;
        out.set(root, o);
        const x = p.getX(v);
        const y = p.getY(v);
        const z = p.getZ(v);
        outPos.push(x, y, z);
        outNrm.push(nx, ny, nz);
        const under = THREE.MathUtils.smoothstep(y, -0.5, shoulder);
        const tint = 1 + (hash3(x + nx * 3, y + ny * 3, z + nz * 3) - 0.5) * ROCK_FACET_TINT;
        const shade = THREE.MathUtils.lerp(ROCK_UNDER, 1, under) * tint;
        outCol.push(shade, shade, shade);
      }
      const f = fs[i]!;
      for (let k = 0; k < 3; k++) if (idx[f * 3 + k] === v) outIdx[f * 3 + k] = o;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(outNrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
  geo.setIndex(outIdx);
  return geo;
}

/**
 * The per-vertex half of the skin's displacement, in [−1, 1]: a hash of the
 * vertex's own position, so it shares nothing with the vertices beside it and
 * a face whose three corners drew different numbers is tipped rather than bent.
 */
function facetNoise(x: number, y: number, z: number): number {
  return hash3(x * 17.3 + 1.1, y * 23.9 + 4.7, z * 19.1 + 8.3) * 2 - 1;
}

/** Do faces `f` and `g`, which both touch vertex `v`, meet along an edge out of it? */
function shareEdge(idx: number[], f: number, g: number, v: number): boolean {
  for (let a = 0; a < 3; a++) {
    const va = idx[f * 3 + a]!;
    if (va === v) continue;
    for (let b = 0; b < 3; b++) if (idx[g * 3 + b] === va) return true;
  }
  return false;
}

function countRock(world: World): number {
  const rockIdx = TERRAIN_LIST.indexOf('rock' as Terrain);
  let n = 0;
  for (const t of world.terrain) if (t === rockIdx) n++;
  return n;
}

/**
 * How many decks this map could ever need.
 *
 * Water at worldgen, counted once. Rock only ever gets mined away, so its pool can
 * be sized from what is standing; bridges only ever go *up*, so theirs has to be
 * sized from what they could cover — and a bridge can only be laid on water, which
 * nothing in the game ever creates. So this is a real ceiling rather than a guess,
 * and a lake nobody bridges costs a few hundred parked instances and no draw time.
 */
function countWater(world: World): number {
  const waterIdx = TERRAIN_LIST.indexOf('water' as Terrain);
  const bridgeIdx = TERRAIN_LIST.indexOf('bridge' as Terrain);
  let n = 0;
  for (const t of world.terrain) if (t === waterIdx || t === bridgeIdx) n++;
  return n;
}

/**
 * Is the cell beside a deck open water — i.e. does this edge of the boards need a
 * rail?
 *
 * Bounds are checked here rather than trusted to `terrainAt`, which indexes a flat
 * array without them: one cell off the left edge is the far end of the row above,
 * and a lake there would hang a rail down the wrong side of a bridge on the other
 * side of the map.
 */
function openWaterAt(world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return terrainAt(world, x, y) === 'water';
}
