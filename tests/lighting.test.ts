/**
 * The light rig.
 *
 * This exists because the colony once rendered as black slabs at noon: the sun
 * climbed almost to the zenith, so every wall face was edge-on to the only real
 * light in the scene and the fill behind it was far too weak to carry a vertical
 * surface. Nothing caught it, because nothing here was measured — "it looks
 * fine" was the whole test.
 *
 * So these tests measure. The functional half pins the sun curve. The experience
 * half reconstructs the irradiance three itself would compute for a surface at a
 * given normal, and asserts the properties a player actually needs: a wall you
 * can see, a lit side that differs from a shaded side, and a night that is dark
 * without being blind.
 *
 * The caveat, stated rather than buried: this model is three's shading maths, not
 * three's renderer. It knows nothing of tone mapping, fog, shadow maps or the
 * baked corner AO in the terrain. It is a guard against the rig regressing to
 * "vertical faces get nothing", not a substitute for looking at the screen.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { QUALITY } from '../src/client/render/renderer';
import { SHADOW_FLOOR, SkyView, shadowStrength } from '../src/client/render/sky';
import { daylight, sunElevation } from '../src/sim/clock';
import { createWorld } from '../src/sim/worldgen';
import { TICKS_PER_DAY } from '../src/sim/types';
import type { World } from '../src/sim/types';

const SEED = 20260729;

/** Set the clock to a fraction of the day without disturbing the day number. */
function atTime(world: World, frac: number): World {
  world.tick = Math.floor(world.tick / TICKS_PER_DAY) * TICKS_PER_DAY + Math.round(TICKS_PER_DAY * frac);
  return world;
}

const UP = new THREE.Vector3(0, 1, 0);
const CARDINALS: Record<string, THREE.Vector3> = {
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  east: new THREE.Vector3(1, 0, 0),
  west: new THREE.Vector3(-1, 0, 0),
};

/** Rec. 709 luminance — how bright a colour reads, not how big its numbers are. */
function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Irradiance arriving at a surface with this normal, following three's own
 * model: directional lights contribute `color * intensity * max(0, N·L)`,
 * hemisphere lights blend ground to sky by `N·up`, ambient is unconditional.
 * Lights are read off the scene graph rather than the class fields so the test
 * measures what the renderer would see.
 */
function irradiance(sky: SkyView, normal: THREE.Vector3): number {
  const total = new THREE.Color(0, 0, 0);
  const l = new THREE.Vector3();
  const term = new THREE.Color();

  for (const obj of sky.group.children) {
    if (obj instanceof THREE.DirectionalLight) {
      l.copy(obj.position).sub(obj.target.position).normalize();
      const dotNL = Math.max(0, normal.dot(l));
      if (dotNL <= 0) continue;
      total.add(term.copy(obj.color).multiplyScalar(obj.intensity * dotNL));
    } else if (obj instanceof THREE.HemisphereLight) {
      const mix = normal.dot(UP) * 0.5 + 0.5;
      term.copy(obj.groundColor).lerp(obj.color, mix).multiplyScalar(obj.intensity);
      total.add(term);
    } else if (obj instanceof THREE.AmbientLight) {
      total.add(term.copy(obj.color).multiplyScalar(obj.intensity));
    }
  }
  return luminance(total);
}

/** The rig as it stands at a given fraction of the day, focused on the map centre. */
function rigAt(frac: number): { sky: SkyView; world: World } {
  const world = atTime(createWorld(SEED), frac);
  const sky = new SkyView(world, QUALITY.high);
  sky.sync(world, world.width / 2, world.height / 2);
  return { sky, world };
}

function verticalFaces(sky: SkyView): number[] {
  return Object.values(CARDINALS).map((n) => irradiance(sky, n));
}

/**
 * The same surface with the sun taken away — what a cell inside a shadow gets.
 *
 * The sun is the only light in the rig that casts, so "in shadow" is exactly
 * "every light except that one". Same caveat as `irradiance`: this is three's
 * shading maths, not its renderer, and it is a guard against the sky half of the
 * rig going to nothing, not a substitute for looking at the screen.
 */
function shadowed(sky: SkyView, normal: THREE.Vector3): number {
  const total = new THREE.Color(0, 0, 0);
  const l = new THREE.Vector3();
  const term = new THREE.Color();

  for (const obj of sky.group.children) {
    if (obj === sky.sun) continue;
    if (obj instanceof THREE.DirectionalLight) {
      l.copy(obj.position).sub(obj.target.position).normalize();
      const dotNL = Math.max(0, normal.dot(l));
      if (dotNL <= 0) continue;
      total.add(term.copy(obj.color).multiplyScalar(obj.intensity * dotNL));
    } else if (obj instanceof THREE.HemisphereLight) {
      const mix = normal.dot(UP) * 0.5 + 0.5;
      term.copy(obj.groundColor).lerp(obj.color, mix).multiplyScalar(obj.intensity);
      total.add(term);
    } else if (obj instanceof THREE.AmbientLight) {
      total.add(term.copy(obj.color).multiplyScalar(obj.intensity));
    }
  }
  return luminance(total);
}

describe('sun curve', () => {
  it('peaks well short of the zenith, so vertical surfaces are never edge-on to it', () => {
    const noon = sunElevation(atTime(createWorld(SEED), 0.5));
    const deg = (noon * 180) / Math.PI;
    // Below 40° the shadows sprawl and midday stops reading as midday; above 60°
    // walls start losing their lit face again, which is the bug this guards.
    expect(deg).toBeGreaterThan(40);
    expect(deg).toBeLessThan(60);
  });

  it('keeps sunrise and sunset where they were — the amplitude moved, the phase did not', () => {
    expect(sunElevation(atTime(createWorld(SEED), 0.25))).toBeCloseTo(0, 5);
    expect(sunElevation(atTime(createWorld(SEED), 0.75))).toBeCloseTo(0, 5);
  });

  it('puts the sun up by day and down by night', () => {
    expect(sunElevation(atTime(createWorld(SEED), 0.5))).toBeGreaterThan(0);
    expect(sunElevation(atTime(createWorld(SEED), 0))).toBeLessThan(0);
    expect(daylight(atTime(createWorld(SEED), 0.5))).toBeGreaterThan(0.9);
    expect(daylight(atTime(createWorld(SEED), 0))).toBe(0);
  });
});

describe('what a wall receives', () => {
  it('lights the dimmest wall face to a usable fraction of the open ground at noon', () => {
    const { sky } = rigAt(0.5);
    const ground = irradiance(sky, UP);
    const dimmest = Math.min(...verticalFaces(sky));
    // Pre-fix this ratio was 0.073 — a wall was effectively unlit next to the
    // floor beside it, which is what made the cabin read as a black slab.
    expect(dimmest / ground).toBeGreaterThan(0.15);
  });

  it('still gives a building a lit side and a shaded side', () => {
    const { sky } = rigAt(0.5);
    const faces = verticalFaces(sky);
    const brightest = Math.max(...faces);
    const dimmest = Math.min(...faces);
    // The fix must not be "flood everything with ambient": form comes from the
    // difference between faces, and a ratio near 1 would mean we lost it.
    expect(brightest / dimmest).toBeGreaterThan(1.6);
  });

  it('never leaves a face at zero, at any hour', () => {
    for (let i = 0; i < 24; i++) {
      const { sky } = rigAt(i / 24);
      for (const [name, normal] of Object.entries(CARDINALS)) {
        const lit = irradiance(sky, normal);
        expect(lit, `${String(i).padStart(2, '0')}:00 ${name} face`).toBeGreaterThan(0.01);
      }
    }
  });
});

/**
 * How much of the open ground's light a cell inside the sun's shadow still gets,
 * *after* the shadow map's own strength is taken into account.
 *
 * `shadowed()` is the fully-occluded case, i.e. `shadow.intensity === 1`. Three
 * lerps between the two by that value, so the cell a player actually sees is
 * `shadowed + (1 - intensity) * direct`. This is the number the eye reads.
 */
function shadedRatio(sky: SkyView, normal: THREE.Vector3): number {
  const lit = irradiance(sky, normal);
  const skyOnly = shadowed(sky, normal);
  const direct = lit - skyOnly;
  return (skyOnly + direct * (1 - sky.sun.shadow.intensity)) / lit;
}

/**
 * The cabin's own yard, every dawn and every dusk.
 *
 * Measured on the real renderer at 07:20 and photographed: the yard was a
 * near-black wedge with a razor-straight edge through it and the settlers in it
 * were silhouettes. Nothing in the rig was wrong — the treeline is 4.5 tall, the
 * sun was 16° up, and thirteen cells of shadow is exactly what that geometry
 * casts. It was ruled out as a rig fault first: `castShadow = false` removed the
 * wedge, widening the shadow camera to ±90 did not, raising `normalBias` did not,
 * and the sky half of the rig still puts 56% of the open-ground light into that
 * shadow. The shadow *map* is what is absolute.
 *
 * So the lever is the shadow's own strength, and it is keyed on shadow *length*
 * (`1/tan(elevation)`), because length is what decides whether a shadow trims a
 * building or buries a colony. The property to hold: the longest shadows of the
 * day are the softest, and none of them ever go away.
 */
describe('what a shadow leaves you', () => {
  /** Daylight only — a shadow at midnight is just night, and night is tested below. */
  const DAY_HOURS = [0.28, 0.3, 0.33, 0.35, 0.4, 0.5, 0.6, 0.65, 0.67, 0.7, 0.72];
  const hhmm = (frac: number) =>
    `${String(Math.floor(frac * 24)).padStart(2, '0')}:${String(Math.round((frac * 24 % 1) * 60)).padStart(2, '0')}`;

  it('lands full strength when the sun is high and shadows are short', () => {
    const noon = sunElevation(atTime(createWorld(SEED), 0.5));
    expect(shadowStrength(noon)).toBe(1);
    expect(shadowStrength(Math.PI / 4)).toBeGreaterThan(0.9);
  });

  it('softens to the floor by the time shadows are long, and never past it', () => {
    // 16° is the photographed case: ~3.5 cells of shadow per cell of height, so
    // the treeline reaches clear across the yard.
    expect(shadowStrength((16 * Math.PI) / 180)).toBe(SHADOW_FLOOR);
    // Sun on the horizon, and sun below it — a colony with no shadows at all
    // reads as flat, which is the bug on the other side of this one.
    expect(shadowStrength(0)).toBe(SHADOW_FLOOR);
    expect(shadowStrength(-1)).toBeGreaterThan(0);
    expect(SHADOW_FLOOR).toBeGreaterThan(0.2);
  });

  it('never gets harder as the sun gets lower', () => {
    let prev = 1.01;
    for (let deg = 90; deg >= 0; deg -= 2) {
      const s = shadowStrength((deg * Math.PI) / 180);
      expect(s, `${deg}°`).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it('is actually applied to the rig, at every hour of the day', () => {
    for (let i = 0; i < 24; i++) {
      const { sky, world } = rigAt(i / 24);
      const want = shadowStrength(sunElevation(world));
      expect(sky.sun.shadow.intensity, `${String(i).padStart(2, '0')}:00`).toBeCloseTo(want, 6);
      expect(sky.sun.shadow.intensity).toBeGreaterThan(0);
    }
  });

  it('keeps a shadowed cell readable against the lit ground beside it', () => {
    for (const frac of DAY_HOURS) {
      const { sky } = rigAt(frac);
      // Pre-fix the worst of these was 0.20 — a shadow five times darker than the
      // ground beside it, which after tone mapping is a black hole.
      expect(shadedRatio(sky, UP), `${hhmm(frac)} shaded/lit`).toBeGreaterThan(0.17);
    }
  });

  it('still lets a shadow read as a shadow', () => {
    // The fix must not be "turn the sun off": if this ever approaches 1 the
    // colony has no shadows left and the whole scene goes flat.
    for (const frac of DAY_HOURS) {
      const { sky } = rigAt(frac);
      expect(shadedRatio(sky, UP), `${hhmm(frac)} shaded/lit`).toBeLessThan(0.97);
    }
  });

  it('rescues the long-shadow hours specifically — that was the photograph', () => {
    // 07:12 and 16:48, sun at 16°. This is the frame that was black.
    for (const frac of [0.3, 0.7]) {
      const { sky } = rigAt(frac);
      expect(shadedRatio(sky, UP), `${hhmm(frac)} shaded/lit`).toBeGreaterThan(0.6);
    }
  });

  it('leaves midday alone — the softening is for the low sun only', () => {
    const { sky } = rigAt(0.5);
    // Noon was tuned by eye against the real renderer and photographed. Whatever
    // rescues dawn must be worth nothing at all by the time the sun is overhead.
    expect(sky.sun.shadow.intensity).toBe(1);
    expect(sky.fill.intensity).toBeCloseTo(0.68, 2);
    expect(shadedRatio(sky, UP)).toBeLessThan(0.3);
  });
});

describe('day and night stay different', () => {
  it('makes midnight far dimmer than noon', () => {
    const noon = irradiance(rigAt(0.5).sky, UP);
    const midnight = irradiance(rigAt(0).sky, UP);
    expect(midnight).toBeLessThan(noon * 0.25);
  });

  it('leaves enough at midnight to read the ground by', () => {
    const noon = irradiance(rigAt(0.5).sky, UP);
    const midnight = irradiance(rigAt(0).sky, UP);
    // A colony you cannot see at all is not atmosphere, it is a black screen —
    // lamps should feel worth building, not be the only way to see anything.
    expect(midnight).toBeGreaterThan(noon * 0.04);
  });

  it('brightens and dims monotonically through the morning', () => {
    const morning = [0.25, 0.32, 0.4, 0.5].map((f) => irradiance(rigAt(f).sky, UP));
    for (let i = 1; i < morning.length; i++) {
      expect(morning[i]).toBeGreaterThan(morning[i - 1]);
    }
  });
});
