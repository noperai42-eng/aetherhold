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
import {
  ANIMAL_COLOR,
  FACTION_COLOR,
  HORIZON_DAY,
  HORIZON_NIGHT,
  HORIZON_WARM,
  OVERCAST_DAY,
  SKIN_TONES,
  SKY_DAY,
  SKY_DUSK,
  SKY_NIGHT,
  SUN_DAY,
  SUN_DUSK,
  pawnTint,
} from '../src/client/render/palette';
import { HAIR_TONES, PawnsView, hideTint, sleeveOf } from '../src/client/render/pawns';
import { PickiesView } from '../src/client/render/pickies';
import { SETTLER_LEG } from '../src/client/gait';
import { POOF_TICKS, summonPicky } from '../src/sim/pickies';
import {
  SHADOW_FLOOR,
  SkyView,
  TONE_EXPOSURE,
  environmentStrength,
  radianceFor,
  shadowNormalBias,
  shadowStrength,
} from '../src/client/render/sky';
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
 * CIE L*: luminance on the scale where equal steps look equal. Linear
 * luminance crushes the darks — a soot black at 0.009 and a deep brown at
 * 0.041 are a hair apart as numbers and twenty steps apart to the eye.
 */
function lightness(c: THREE.Color): number {
  const y = luminance(c);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
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

  /**
   * The other side of that rescue, and the round-8 photograph.
   *
   * 17:24, sun 8° up, a colony wall two and a half metres tall standing on open
   * grass: it threw nothing. Not a soft shadow — nothing. The reason was not the
   * floor, it was what the floor multiplies. A shadow can only take away the
   * light the sun was putting there, and the sun at that hour was worth 21% of
   * what fell on the grass (the hemisphere, the fill and the night-time ambient
   * floor supplied the rest), so 0.38 × 0.21 left a shadow 8% darker than the
   * ground beside it, which is nothing at all after ACES.
   *
   * So this asserts the *cause*, not the symptom: at a low sun the one light
   * that casts still has to lead the ones that cannot. Everything else about the
   * evening follows from it.
   */
  it('keeps the low sun leading the sky terms, so there is something to take away', () => {
    for (const frac of [0.3, 0.7, 0.725]) {
      const { sky } = rigAt(frac);
      const skyOnly = shadowed(sky, UP);
      const direct = irradiance(sky, UP) - skyOnly;
      expect(direct, `${hhmm(frac)} direct vs sky-only`).toBeGreaterThan(skyOnly);
    }
  });

  it('throws a shadow you can see an hour before sundown — that was the photograph', () => {
    // 17:24, the frame the harness takes. Pre-fix this was 0.921: the wall's
    // shadow was 8% darker than the grass and invisible. It is bounded from
    // below three tests up; this is the bound from above that was missing.
    const { sky } = rigAt(0.725);
    expect(shadedRatio(sky, UP)).toBeLessThan(0.8);
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

  it('keeps the environment map from lighting midnight like noon', () => {
    // The environment is the one light that comes from everywhere at once, and
    // it lives on the renderer where none of the irradiance above can see it.
    // Left at a daytime level it would fill every shadow on the map after dark,
    // which is the flat night that this whole describe exists to prevent.
    const noon = environmentStrength(1, 0);
    const midnight = environmentStrength(0, 0);
    expect(noon).toBeGreaterThan(0.25);
    expect(noon).toBeLessThan(0.45);
    expect(midnight).toBeGreaterThan(0);
    expect(midnight).toBeLessThan(noon * 0.25);
    // Overcast dims it, never brightens it: the room's small bright light is the
    // one thing a cloudy sky has not got.
    expect(environmentStrength(1, 1)).toBeLessThan(noon);
  });
});

/**
 * The shadow map's own artefacts. The colony's surfaces are now bevelled and
 * capsuled rather than boxed, and a smooth surface is where self-shadowing
 * stripes show up first: it grazes through dozens of shadow texels where a flat
 * wall is squarely in or out of one.
 */
describe('what the shadow map must not do to a smooth surface', () => {
  it('sizes the normal bias to the texel, so a coarser map is not an acned one', () => {
    // 0.03 was tuned by eye against the 2048 map; the formula has to land on it.
    expect(shadowNormalBias(QUALITY.high.shadowMapSize)).toBeCloseTo(0.03, 2);
    // Halving the map doubles the texel, and the bias must follow or medium
    // quality gets stripes that high never showed.
    expect(shadowNormalBias(QUALITY.medium.shadowMapSize)).toBeCloseTo(
      shadowNormalBias(QUALITY.high.shadowMapSize) * 2,
      6,
    );
  });

  it('re-tunes the bias when quality changes, not only when the rig is built', () => {
    const { sky } = rigAt(0.5);
    sky.applyQuality(QUALITY.medium);
    expect(sky.sun.shadow.normalBias).toBeCloseTo(shadowNormalBias(QUALITY.medium.shadowMapSize), 6);
    sky.applyQuality(QUALITY.high);
    expect(sky.sun.shadow.normalBias).toBeCloseTo(shadowNormalBias(QUALITY.high.shadowMapSize), 6);
  });

  it('keeps low quality cheap: no environment map, no shadows', () => {
    expect(QUALITY.low.environment).toBe(false);
    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.high.environment).toBe(true);
  });
});

/**
 * What colour the day is.
 *
 * The frames from the real GPU came back neutral-to-green at noon, with a sky
 * that was one blue from the zenith to the ground. None of the irradiance above
 * can see that, because it measures luminance and throws the hue away. So these
 * read the hue: the key is warm, the shade is cool, the sky has a horizon, and
 * the fog is the colour of it — read off the scene graph and the dome's uniforms,
 * the way `irradiance` reads the lights.
 */
describe('what colour the day is', () => {
  /** The dome, found the way the renderer finds it: the one mesh with a shader on it. */
  const domeMeshOf = (sky: SkyView): THREE.Mesh =>
    sky.group.children.find(
      (o) => o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial,
    ) as THREE.Mesh;
  const domeOf = (sky: SkyView): THREE.ShaderMaterial => domeMeshOf(sky).material as THREE.ShaderMaterial;
  const colorU = (mat: THREE.ShaderMaterial, name: string): THREE.Color =>
    mat.uniforms[name]!.value as THREE.Color;

  it('puts a warm key over a cool shade at noon — the grey picture was the two averaging out', () => {
    const { sky } = rigAt(0.5);
    // The sun is amber-side of white: red over green over blue.
    expect(sky.sun.color.r).toBeGreaterThan(sky.sun.color.g);
    expect(sky.sun.color.g).toBeGreaterThan(sky.sun.color.b);
    // What a shadow gets — every light but the sun, on open ground — is blue-side.
    const shade = new THREE.Color(0, 0, 0);
    const l = new THREE.Vector3();
    const term = new THREE.Color();
    for (const obj of sky.group.children) {
      if (obj === sky.sun) continue;
      if (obj instanceof THREE.DirectionalLight) {
        l.copy(obj.position).sub(obj.target.position).normalize();
        shade.add(term.copy(obj.color).multiplyScalar(obj.intensity * Math.max(0, UP.dot(l))));
      } else if (obj instanceof THREE.HemisphereLight) {
        shade.add(term.copy(obj.color).multiplyScalar(obj.intensity));
      } else if (obj instanceof THREE.AmbientLight) {
        shade.add(term.copy(obj.color).multiplyScalar(obj.intensity));
      }
    }
    expect(shade.b).toBeGreaterThan(shade.r * 1.15);
  });

  it('gives the sky a horizon by day and takes it away at night', () => {
    const noon = domeOf(rigAt(0.5).sky);
    const top = colorU(noon, 'uTop');
    const horizon = colorU(noon, 'uHorizon');
    // The band is warmer and lighter than the zenith, and strong enough to see:
    // a band you cannot see is the one-colour sky the frames showed.
    expect(horizon.r - horizon.b).toBeGreaterThan(top.r - top.b);
    expect(horizon.r + horizon.g + horizon.b).toBeGreaterThan(top.r + top.g + top.b);
    expect(noon.uniforms.uBand!.value as number).toBeGreaterThan(0.4);
    // After dark the band all but goes: a warm horizon at midnight is a town
    // over the hill, and the stars have to sit on something black.
    const midnight = domeOf(rigAt(0).sky);
    expect(midnight.uniforms.uBand!.value as number).toBeLessThan(0.15);
    expect(colorU(midnight, 'uHorizon').r).toBeLessThan(0.15);
  });

  /**
   * Put the noon frame beside the dusk frame and the colour barely moved: the
   * same flat green, no warmth on the lit faces, no sun colour reaching the
   * ground. The sky had a dusk colour all along — the dome computes one, and the
   * sun's own light was already amber by then — but the *surfaces* never saw it,
   * because at 8° the sun was a fifth of the light landing on them and a cool
   * ambient floor was most of the rest. So it is not enough to check that the
   * sun goes orange. What has to be checked is that its orange arrives.
   */
  it('makes the evening reach the ground, not just the sky', () => {
    const noon = rigAt(0.5).sky;
    const dusk = rigAt(0.725).sky;
    // The light itself goes warmer as it goes down. This half was already true.
    expect(dusk.sun.color.r - dusk.sun.color.b).toBeGreaterThan(noon.sun.color.r - noon.sun.color.b);
    // And this half is the one that was not: everything arriving on open ground,
    // sun and sky together, is warmer at 17:24 than at midday by a margin an eye
    // reads as a different hour rather than as the same hour slightly dimmer.
    const onGround = (sky: SkyView): THREE.Color => {
      const total = new THREE.Color(0, 0, 0);
      const l = new THREE.Vector3();
      const term = new THREE.Color();
      for (const obj of sky.group.children) {
        if (obj instanceof THREE.DirectionalLight) {
          l.copy(obj.position).sub(obj.target.position).normalize();
          total.add(term.copy(obj.color).multiplyScalar(obj.intensity * Math.max(0, UP.dot(l))));
        } else if (obj instanceof THREE.HemisphereLight) {
          total.add(term.copy(obj.color).multiplyScalar(obj.intensity));
        } else if (obj instanceof THREE.AmbientLight) {
          total.add(term.copy(obj.color).multiplyScalar(obj.intensity));
        }
      }
      return total;
    };
    const day = onGround(noon);
    const evening = onGround(dusk);
    expect(evening.r / evening.b).toBeGreaterThan((day.r / day.b) * 1.15);
  });

  it('fogs the map edge in the colour the dome shows at the horizon, round the clock', () => {
    let mesh!: THREE.Mesh;
    // Midnight, dawn, noon, dusk: the four states the band passes through.
    for (let i = 0; i < 24; i += 6) {
      const { sky } = rigAt(i / 24);
      mesh = domeMeshOf(sky);
      const dome = mesh.material as THREE.ShaderMaterial;
      // The shader at h = 0: bottom mixed with the band by uBand. The fog has to
      // land on this exactly, or the last cells sit against a seam of sky.
      const want = colorU(dome, 'uBottom').clone().lerp(colorU(dome, 'uHorizon'), dome.uniforms.uBand!.value as number);
      const fog = sky.fogColor();
      const hh = `${String(i).padStart(2, '0')}:00`;
      expect(fog.r, `${hh} r`).toBeCloseTo(want.r, 6);
      expect(fog.g, `${hh} g`).toBeCloseTo(want.g, 6);
      expect(fog.b, `${hh} b`).toBeCloseTo(want.b, 6);
    }
    // And the dome itself is inside the first-person far plane, not sitting on
    // it: a sky that clips at its own vertices is a sky with holes in it.
    mesh.geometry.computeBoundingSphere();
    expect(mesh.geometry.boundingSphere!.radius).toBeLessThan(400);
  });

  it('settles a scene fog on the sky it was drawn under, not on whatever was left in it', () => {
    // The bug behind this is not a wrong colour, it is a caller that never asks.
    // `Viewport`'s constructor leaves a fixed slate-blue fog in every scene it
    // makes, for whoever draws into that scene to overwrite each frame; the
    // world view always did and the forge bench never did, so for seven rounds
    // every model on the bench was photographed at noon against a distance
    // hazing toward night. Both go through `applyFog` now, and this is the one
    // place that can say all four of its fields move off the slate.
    //
    // The colours are the horizon round the clock, which the test above pins
    // against the dome; what this adds is that they reach the fog at all, and
    // that the reach comes with them. 40 and 339 are a clear day on a 192-cell
    // map: see just past the middle of it, fade out past its far corner.
    const rows = [0, 6, 12, 18].map((i) => {
      const { sky, world } = rigAt(i / 24);
      const fog = new THREE.Fog(0x223040, 40, 130);
      sky.applyFog(fog, world);
      return [`${String(i).padStart(2, '0')}:00`, fog.color.getHexString(), fog.near, Math.round(fog.far * 100) / 100];
    });
    expect(rows).toEqual([
      ['00:00', '0d1117', 40, 339.41],
      ['06:00', '633421', 40, 339.41],
      ['12:00', 'b6a18f', 40, 339.41],
      ['18:00', '633421', 40, 339.41],
    ]);
  });
});

/**
 * Whether the sky is in the same colour space as the colony standing in it.
 *
 * The dome and the precipitation are the only two things in the game that write
 * `gl_FragColor` by hand, and for a long time they wrote it and stopped — no
 * tone curve, no encode, their linear numbers going into an sRGB framebuffer to
 * be shown as though they had already been converted. Photographed, that is a
 * sky whose pixels are the palette's *linear* components: `r9b-4-firstperson`
 * runs 0x567ba3 at the top of the frame to about 0x99acbb at the ground, and the
 * palette calls those two ends 0x7fa6c9 and 0xcfdce6.
 *
 * That is a bug with no type error, no console line and no failing test: a
 * shader is a string, and a missing `#include` at the end of one looks exactly
 * like a colour somebody chose. So the strings are read as text, the way
 * `phone-layout.test.ts` reads the stylesheet, and the arithmetic either side of
 * them is measured.
 */
describe('what space the sky is in', () => {
  const SRC = import.meta.glob('../src/client/render/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const source = (name: string): string => {
    const hit = Object.entries(SRC).find(([p]) => p.endsWith(`/${name}`));
    expect(hit, `${name} has moved out of src/client/render`).toBeDefined();
    return hit![1];
  };

  /**
   * ACES and the sRGB encode, forwards — what the frame actually shows for a
   * radiance, as code values 0..1.
   *
   * Transcribed from three's `tonemapping_pars_fragment` and
   * `colorspace_pars_fragment` rather than borrowed from `radianceFor`, because
   * a test that inverts the code under test with the code under test agrees with
   * it about everything, including being wrong. These are the numbers the GPU
   * will run; if three ever changes them this fails, which is correct — the
   * whole claim below is that the sky and the frame use the same curve.
   */
  const ACES_IN = new THREE.Matrix3().set(
    0.59719, 0.35458, 0.04823,
    0.076, 0.90834, 0.01566,
    0.0284, 0.13383, 0.83777,
  );
  const ACES_OUT = new THREE.Matrix3().set(
    1.60475, -0.53108, -0.07367,
    -0.10208, 1.10813, -0.00605,
    -0.00327, -0.07276, 1.07602,
  );
  const fit = (v: number): number =>
    (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const encode = (x: number): number =>
    x <= 0.0031308 ? x * 12.92 : Math.pow(Math.max(0, x), 0.41666) * 1.055 - 0.055;
  /** Code values 0..255, which is the scale a tolerance in this file means something on. */
  function shown(radiance: THREE.Color): number[] {
    const v = new THREE.Vector3(radiance.r, radiance.g, radiance.b)
      .multiplyScalar(TONE_EXPOSURE / 0.6)
      .applyMatrix3(ACES_IN);
    v.set(fit(v.x), fit(v.y), fit(v.z)).applyMatrix3(ACES_OUT);
    return [v.x, v.y, v.z].map((x) => encode(Math.min(1, Math.max(0, x))) * 255);
  }

  const dome = (sky: SkyView): THREE.ShaderMaterial =>
    (
      sky.group.children.find(
        (o) => o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial,
      ) as THREE.Mesh
    ).material as THREE.ShaderMaterial;

  /**
   * The dome's fragment shader, on the CPU: what it draws `deg` above the
   * horizon, as the frame will show it. The gradient, the haze band, the warm
   * band — the glow is left out, because it is the one term that depends on
   * where the sun is in the frame rather than on how high up you look.
   */
  function skyAt(sky: SkyView, deg: number): number[] {
    const m = dome(sky);
    const u = (n: string): THREE.Color => m.uniforms[n]!.value as THREE.Color;
    const h = Math.sin((deg * Math.PI) / 180);
    const col = u('uBottom')
      .clone()
      .lerp(u('uTop'), Math.pow(Math.max(h, 0), m.uniforms.uExponent!.value as number));
    col.lerp(u('uBottom'), Math.exp(-Math.max(h, 0) * 9) * 0.35);
    col.lerp(u('uHorizon'), Math.exp(-Math.max(h, 0) * 12) * (m.uniforms.uBand!.value as number));
    return shown(col);
  }

  it('ends both hand-written shaders with the tail every other material gets', () => {
    const sky = source('sky.ts');
    const skyWrite = sky.indexOf('gl_FragColor = vec4(col, 1.0);');
    const skyTone = sky.indexOf('#include <tonemapping_fragment>');
    const skySpace = sky.indexOf('#include <colorspace_fragment>');
    expect(skyWrite, 'the sky dome no longer writes gl_FragColor from `col`').toBeGreaterThan(0);
    expect(skyTone, 'the sky dome writes gl_FragColor and never tone maps it').toBeGreaterThan(skyWrite);
    expect(skySpace, 'the sky dome tone maps but never encodes — it is still raw linear in an sRGB frame').toBeGreaterThan(skyTone);

    const rain = source('weather-view.ts');
    const rainFog = rain.indexOf('#include <fog_fragment>');
    const rainTone = rain.indexOf('#include <tonemapping_fragment>');
    const rainSpace = rain.indexOf('#include <colorspace_fragment>');
    expect(rainFog, 'the streaks no longer take fog').toBeGreaterThan(0);
    // Fog is something the air does to light on the way here, so it has to land
    // while the value is still light. Encode first and the fog is mixed into a
    // number that is no longer light, which reads as rain that goes flat in the
    // distance instead of fading into it.
    expect(rainTone, 'the streaks are fogged but never tone mapped').toBeGreaterThan(rainFog);
    expect(rainSpace, 'the streaks are tone mapped but never encoded').toBeGreaterThan(rainTone);
  });

  it('tone maps at the exposure the renderer is actually set to', () => {
    const renderer = source('renderer.ts');
    const set = /toneMappingExposure\s*=\s*([\d.]+)/.exec(renderer);
    expect(set, 'renderer.ts no longer sets toneMappingExposure at all').not.toBeNull();
    // sky.ts has to carry its own copy of this number, because it runs the curve
    // backwards to decide what to hand the dome and there is nothing to import.
    // Two copies of a number is a number that drifts, so this is the guard.
    expect(
      Number(set![1]),
      'sky.ts TONE_EXPOSURE and renderer.ts toneMappingExposure have drifted apart — the sky is now being converted for an exposure the frame is not using',
    ).toBe(TONE_EXPOSURE);
    expect(renderer, 'the curve sky.ts inverts is ACES; renderer.ts has been switched to another').toContain(
      'ACESFilmicToneMapping',
    );
  });

  it('hands the dome the light that shows the colour the palette names', () => {
    const palette = {
      SKY_DAY,
      SKY_NIGHT,
      SKY_DUSK,
      HORIZON_DAY,
      HORIZON_NIGHT,
      HORIZON_WARM,
      OVERCAST_DAY,
      SUN_DAY,
      SUN_DUSK,
    };
    for (const [name, look] of Object.entries(palette)) {
      const got = shown(radianceFor(look, new THREE.Color()));
      // The palette's sky colours are display values — the pixels the dome came
      // out as before it had a tail — so their own components are the target.
      const want = [look.r, look.g, look.b].map((x) => Math.min(1, Math.max(0, x)) * 255);
      for (let i = 0; i < 3; i++) {
        expect(got[i]!, `${name} channel ${'rgb'[i]}`).toBeCloseTo(want[i]!, 0);
      }
    }
  });

  /**
   * And the sky the player meets, at the two hours the look round photographs.
   *
   * Pinned as code values on the 0..255 scale a screenshot is read on, so a
   * tolerance here means what it means in the frames: two counts is invisible,
   * ten is a different sky. The zenith and the last two degrees above the ground
   * are the two ends the dome is tuned between, and `r9b-4-firstperson` is the
   * photograph they were tuned against — its sky runs 0x567ba3 down to about
   * 0x99acbb, and the noon row below sits inside that.
   *
   * The mid-gradient sample is here because it is the one that is allowed to
   * have moved: the haze and the warm band are mixed inside the shader, which is
   * now radiance rather than swatch, and lerping light is not lerping paint. It
   * came out about sixteen counts lighter in red at twenty degrees. That is the
   * price of the sky being in the frame's space and it is pinned so the next
   * person pays it once.
   */
  it('keeps noon and dusk the sky they were photographed as', () => {
    const noon = rigAt(0.5).sky;
    const dusk = rigAt(0.725).sky;
    const rows: [string, number[], number[]][] = [
      ['noon zenith', skyAt(noon, 90), [54, 97, 149]],
      ['noon 20°', skyAt(noon, 20), [128, 156, 184]],
      ['noon horizon', skyAt(noon, 2), [194, 188, 187]],
      ['dusk zenith', skyAt(dusk, 90), [49, 40, 49]],
      ['dusk 20°', skyAt(dusk, 20), [74, 53, 53]],
      ['dusk horizon', skyAt(dusk, 2), [92, 62, 55]],
    ];
    for (const [where, got, want] of rows) {
      for (let i = 0; i < 3; i++) {
        expect(
          Math.abs(got[i]! - want[i]!),
          `${where}: ${got.map((v) => Math.round(v)).join(',')} against ${want.join(',')}`,
        ).toBeLessThan(3);
      }
    }
  });
});

/**
 * What a body is made of.
 *
 * The settlers and the herds went from boxes to capsules, lathes and rounded
 * boxes in one pass, and the things that pass can break are not things the
 * screen tells you about until somebody is standing at eye level: a limb that
 * pivots somewhere other than the joint the gait was tuned against, a sole that
 * hovers or sinks, a part left flat-shaded among smooth ones, or a rig that
 * quietly costs three times the triangles it was budgeted. These live here
 * because this is the render suite that runs without a GPU — it reads the scene
 * graph, exactly as `irradiance` above reads the light rig.
 */
describe('what a body is made of', () => {
  function bodies(): { view: PawnsView; world: World; rigs: Map<number, THREE.Group> } {
    const world = createWorld(SEED);
    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 0, null, 0);
    const rigs = new Map<number, THREE.Group>();
    for (const g of view.group.children) rigs.set(g.id, g as THREE.Group);
    return { view, world, rigs };
  }

  /** Every mesh under a rig that would actually be drawn. */
  function drawn(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible) out.push(o);
    });
    return out;
  }

  const triangles = (m: THREE.Mesh): number =>
    (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;


  it('leaves no part flat-shaded — one faceted piece on a smooth body is the whole regression', () => {
    const { view } = bodies();
    for (const m of drawn(view.group)) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        expect((mat as THREE.MeshStandardMaterial).flatShading ?? false, mat.type).toBe(false);
      }
    }
    view.dispose();
  });

  it('stays inside its triangle budget: ~3,000 for a settler, ~2,500 for an animal wearing everything it can', () => {
    const { view, world } = bodies();
    const byId = new Map(world.pawns.map((p) => [p.id, p]));
    let settlers = 0;
    let animals = 0;
    for (const rig of view.group.children) {
      // Every animal the map starts with is wild, so its collar, tag and hunt
      // mark are hidden and a count of what is drawn never meets them. It
      // did not: a bonded mossback in the pen drew seven hundred over the
      // budget this test said it kept. Show them all, the way a marked pen
      // animal that somebody loves would draw, and count that.
      rig.traverse((o) => {
        if (o instanceof THREE.Mesh && ['collar', 'tag', 'mark'].includes(o.name)) o.visible = true;
      });
      const total = drawn(rig).reduce((n, m) => n + triangles(m), 0);
      // The rig groups are added in pawn order, so pair them back up by position.
      const pawn = world.pawns.find((p) => byId.has(p.id) && p.x === rig.position.x && p.y === rig.position.z);
      expect(pawn, 'every rig stands on a pawn').toBeDefined();
      if (pawn!.animal) {
        animals++;
        expect(total, `${pawn!.animal} rig`).toBeLessThanOrEqual(2500);
      } else {
        settlers++;
        expect(total, `settler rig (${pawn!.weapon})`).toBeLessThanOrEqual(3000);
      }
    }
    expect(settlers).toBeGreaterThan(0);
    expect(animals).toBeGreaterThan(0);
    view.dispose();
  });

  it('keeps every sole on the floor: no body floats and none sinks, at either size', () => {
    const { view, world } = bodies();
    const box = new THREE.Box3();
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.dead || pawn.downed || pawn.activity === 'sleeping') continue;
      box.setFromObject(rig);
      const sole = box.min.y - rig.position.y;
      // A walking body bobs up to 0.035 off the ground; a standing one does not.
      // Downward, a leg pivots at the hip and its toe sweeps an arc, so mid-swing
      // the tip of a boot dips about a centimetre into the grass — as the old
      // box feet did — and that is not the sinking this guards against.
      expect(sole, `${pawn.animal ?? 'settler'} sole`).toBeGreaterThan(-0.02);
      expect(sole, `${pawn.animal ?? 'settler'} sole`).toBeLessThan(0.04);
    }
    view.dispose();
  });

  it('pivots every limb at the joint, exactly where the gait was tuned', () => {
    // The stride arithmetic in `gait.ts` assumes a leg hangs from the hip and
    // reaches `SETTLER_LEG` below it. A limb whose geometry starts above or
    // below its pivot would swing about the wrong point and scrub its foot.
    //
    // The leg is two since r28: a thigh from the hip and a shin from the knee,
    // halfway down. So the length the gait assumes is the chain's, not one
    // mesh's — the knee where the thigh says, and the shin reaching from there
    // into the boot, which carries the sole the last two centimetres.
    const { view } = bodies();
    const box = new THREE.Box3();
    let limbs = 0;
    view.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.name !== 'shin') return;
      const thigh = o.parent as THREE.Mesh;
      expect(thigh.position.y, 'the thigh hangs from the hip').toBe(SETTLER_LEG);
      thigh.geometry.computeBoundingBox();
      box.copy(thigh.geometry.boundingBox!);
      expect(box.max.y, 'thigh pivots at its top').toBeCloseTo(0, 6);
      expect(box.min.y, 'thigh runs past the knee, so the joint is covered').toBeLessThan(o.position.y);
      expect(o.position.y, 'the knee is halfway down the leg').toBeCloseTo(-SETTLER_LEG / 2, 6);
      o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox!);
      expect(box.max.y, 'shin pivots at its top').toBeCloseTo(0, 6);
      const reach = o.position.y + box.min.y;
      expect(reach, 'the shin stops short of the floor').toBeGreaterThan(-SETTLER_LEG);
      expect(reach, 'and inside the boot, two centimetres up').toBeCloseTo(-SETTLER_LEG + 0.02, 6);
      limbs++;
    });
    expect(limbs).toBeGreaterThan(0);
    view.dispose();
  });

  /** The named part under a rig, which is how the tests below find a neck or a head. */
  function part(root: THREE.Object3D, name: string): THREE.Mesh {
    let found: THREE.Mesh | null = null;
    root.traverse((o) => {
      if (!found && o instanceof THREE.Mesh && o.name === name) found = o;
    });
    expect(found, `${name} on the rig`).not.toBeNull();
    return found!;
  }

  /**
   * The top of everything this animal is actually drawn with, in the rig's own
   * space — the space the hunt marker's height is set in, so it survives a
   * carcass lying on its side. The marker itself is left out, because the thing
   * being measured is how far the marker stands over the animal.
   *
   * The barrel is not this. A mossback's antlers stand forty-one centimetres
   * over the crown of its back, and a marker hung off the barrel's height
   * landed inside the head.
   *
   * Measured with the head up, which is the pose the rig itself measures and the
   * tallest one the animal takes: a standing animal grazes, and its nose is in
   * the grass for most of every cycle. Hanging the marker off whatever the head
   * happens to be doing would make it bob, and an order that bobs reads as part
   * of the animation rather than as an order.
   */
  function crest(rig: THREE.Object3D): number {
    const head = rig.getObjectByName('head');
    const nod = head?.rotation.x ?? 0;
    if (head) head.rotation.x = 0;
    rig.updateMatrixWorld(true);
    const toRig = new THREE.Matrix4().copy(rig.matrixWorld).invert();
    const local = new THREE.Matrix4();
    const box = new THREE.Box3();
    const one = new THREE.Box3();
    rig.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return;
      if (o.name === 'mark' || o.name === 'mark-inner') return;
      o.geometry.computeBoundingBox();
      box.union(one.copy(o.geometry.boundingBox!).applyMatrix4(local.multiplyMatrices(toRig, o.matrixWorld)));
    });
    if (head) {
      head.rotation.x = nod;
      rig.updateMatrixWorld(true);
    }
    return box.max.y;
  }

  it("ends the settler's neck inside the skull, upright and nodding — a rim that shows is a shelf under the chin", () => {
    // The neck flares up into the head to fill the crease where a straight
    // tube met the sphere. The flare only works if its rim stays buried: a rim
    // that clears the skin is the step it was built to remove, and the working
    // nod is the one pitch the head takes, so the rim is checked through it.
    const { view, world } = bodies();
    const v = new THREE.Vector3();
    let settlers = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      settlers++;
      const neck = part(rig, 'neck');
      const head = part(rig, 'head');
      // The head is a scaled sphere, so its bounding box's half-extents are the
      // ellipsoid's axes: a point is inside it when its normalised radius is < 1.
      head.geometry.computeBoundingBox();
      const axes = head.geometry.boundingBox!.max;
      neck.geometry.computeBoundingBox();
      const rimY = neck.geometry.boundingBox!.max.y;
      const pos = neck.geometry.attributes.position!;
      for (const nod of [0, 0.3]) {
        head.rotation.x = nod;
        rig.updateMatrixWorld(true);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (v.y < rimY - 1e-6) continue;
          head.worldToLocal(neck.localToWorld(v));
          const r = Math.hypot(v.x / axes.x, v.y / axes.y, v.z / axes.z);
          expect(r, `neck rim inside the skull at nod ${nod}`).toBeLessThan(1);
        }
      }
    }
    expect(settlers).toBeGreaterThan(0);
    view.dispose();
  });

  it("ends every animal's neck inside its head — the fenwolf's stood clear of the lowered skull and hung behind the ears", () => {
    // A hunter carries its head low, and the neck used to be pitched flatter
    // from the same root: its top centre landed a hand's width above and behind
    // the skull, a stub in the air that the manager camera read as withers and
    // the first-person one read as a mistake. The top of the neck belongs
    // inside the head, for every species, before the head pitches at all.
    const { view, world } = bodies();
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const kinds = new Set<string>();
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (!pawn.animal) continue;
      kinds.add(pawn.animal);
      const neck = part(rig, 'neck');
      const head = part(rig, 'head');
      head.rotation.x = 0;
      rig.updateMatrixWorld(true);
      head.geometry.computeBoundingBox();
      box.copy(head.geometry.boundingBox!);
      neck.geometry.computeBoundingBox();
      v.set(0, neck.geometry.boundingBox!.max.y, 0);
      head.worldToLocal(neck.localToWorld(v));
      expect(box.containsPoint(v), `${pawn.animal}'s neck ends inside its head`).toBe(true);
    }
    expect(kinds.has('fenwolf'), 'the map has a hunter to check').toBe(true);
    view.dispose();
  });

  it('keeps the collar and tag under a thousand triangles — a pen is full of them, and the budget above allows one of each', () => {
    // Both are hidden on every wild animal, and until the budget check above
    // learned to show them a strap that cost half a wolf got through it. It
    // did: sixteen segments round the tube was a thousand triangles on its own.
    // The pair is held here too, because the budget has room for one collar
    // and one tag beside the body and no more.
    const { view } = bodies();
    let animals = 0;
    for (const rig of view.group.children) {
      let collar: THREE.Mesh | null = null;
      let tag: THREE.Mesh | null = null;
      rig.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name === 'collar') collar = o;
        if (o instanceof THREE.Mesh && o.name === 'tag') tag = o;
      });
      if (!collar || !tag) continue;
      animals++;
      expect(triangles(collar) + triangles(tag)).toBeLessThanOrEqual(1000);
    }
    expect(animals).toBeGreaterThan(0);
    view.dispose();
  });

  it("stands the dunhare's ears taller than its head — two sticks on a round head was a small dog", () => {
    // Four species used to be one body at four sizes, and the hare was the one
    // that suffered most: nothing about it said hare but the size. The ears are
    // the tell, and they only tell if they are longer than the skull they stand
    // on — measured along the ear's own axis against the head's full height.
    const { view, world } = bodies();
    let hares = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal !== 'dunhare') continue;
      hares++;
      const head = part(rig, 'head');
      head.geometry.computeBoundingBox();
      const skull = head.geometry.boundingBox!.max.y - head.geometry.boundingBox!.min.y;
      const ears = head.children.filter((c) => c instanceof THREE.Mesh && c.position.y > 0.05 && Math.abs(c.position.x) > 0.03);
      expect(ears.length, 'a pair of ears on the skull').toBe(2);
      for (const ear of ears as THREE.Mesh[]) {
        ear.geometry.computeBoundingBox();
        expect(ear.geometry.boundingBox!.max.y, 'ear longer than the head is tall').toBeGreaterThan(skull * 1.5);
      }
    }
    expect(hares).toBeGreaterThan(0);
    view.dispose();
  });

  /** The ears on a skull: the crowns that carry a lining. An antler carries none. */
  function ears(rig: THREE.Object3D): THREE.Mesh[] {
    return part(rig, 'head').children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.children.length > 0,
    );
  }

  /** One of every species, so a per-species check runs once rather than per animal. */
  function oneOfEach(view: PawnsView, world: World): Map<string, THREE.Object3D> {
    const out = new Map<string, THREE.Object3D>();
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal && !out.has(pawn.animal)) out.set(pawn.animal, rig);
    }
    expect(out.size, 'every species on the map').toBe(4);
    return out;
  }

  it("leaves daylight between an animal's ears and gives each one a blade's width — a thin dark pair rooted a finger apart was one stick through the head", () => {
    // The photograph that started this round: a dunhare at a metre and a half,
    // its two ears collapsed into a single sliver angled off the skull. Three
    // things did it, and this holds two of them for every species. Each ear was
    // a capsule squashed to under half its width, which is a stick at any range
    // a settler can walk to; and the roots sat close enough that the pair never
    // showed a gap the eye could put a background through. A blade less than a
    // quarter as wide as it is long is the first fault; a pair whose gap is
    // narrower than half an ear is the second.
    const { view, world } = bodies();
    const v = new THREE.Vector3();
    for (const [kind, rig] of oneOfEach(view, world)) {
      const pair = ears(rig);
      expect(pair.length, `${kind} wears a pair of ears`).toBe(2);
      for (const e of pair) {
        e.updateMatrix();
        const pos = e.geometry.attributes.position!;
        // How close this ear comes to the skull's midline, over its real
        // vertices: the box round a raked blade reaches places the blade does not.
        let inner = Infinity;
        for (let i = 0; i < pos.count; i++) {
          inner = Math.min(inner, Math.abs(v.fromBufferAttribute(pos, i).applyMatrix4(e.matrix).x));
        }
        e.geometry.computeBoundingBox();
        const box = e.geometry.boundingBox!;
        const width = box.max.x - box.min.x;
        expect(2 * inner, `${kind}'s ears leave a gap between them`).toBeGreaterThan(0.4 * width);
        expect(width, `${kind}'s ear is a blade, not a stick`).toBeGreaterThan(0.25 * (box.max.y - box.min.y));
      }
    }
    view.dispose();
  });

  it('lines every ear on its inner face in a lighter tone, proud of the front and inside the outline — a dark blade on both faces is a horn', () => {
    // The third thing that made the hare's pair read as one object: both faces
    // were the coat's darkest tone, so nothing told the front of an ear from
    // its back and two of them overlapping were one shape. The lining is the
    // fix and it has to sit exactly so — lighter than the blade or it says
    // nothing; standing out through the front face or it is invisible; and
    // inside the blade's outline in every other direction, or it pokes out of
    // the back of the ear and the two surfaces fight for the same pixels.
    const { view, world } = bodies();
    const hsl = { h: 0, s: 0, l: 0 };
    for (const [kind, rig] of oneOfEach(view, world)) {
      for (const e of ears(rig)) {
        const lining = e.children[0] as THREE.Mesh;
        (e.material as THREE.MeshStandardMaterial).color.getHSL(hsl);
        const back = hsl.l;
        (lining.material as THREE.MeshStandardMaterial).color.getHSL(hsl);
        expect(hsl.l, `${kind}'s inner ear is lighter than its back`).toBeGreaterThan(back);
        e.geometry.computeBoundingBox();
        lining.geometry.computeBoundingBox();
        const blade = e.geometry.boundingBox!;
        const inside = lining.geometry.boundingBox!;
        expect(inside.max.z, `${kind}'s lining stands out of the front of the ear`).toBeGreaterThan(blade.max.z);
        expect(inside.min.z, `${kind}'s lining stays out of the back of the ear`).toBeGreaterThan(blade.min.z);
        expect(inside.max.x, `${kind}'s lining stays inside the ear's outline`).toBeLessThanOrEqual(blade.max.x);
        expect(inside.max.y, `${kind}'s lining stops short of the ear's tip`).toBeLessThan(blade.max.y);
      }
    }
    view.dispose();
  });

  it("cuts each animal's collar to the neck it rings — one width for all four hung off a hare like a hoop with daylight all round it", () => {
    // The collar is one buffer shared by every species, and it was cut to the
    // widest throat on the map. On a mossback it lay on the neck; on the other
    // three it was a ring floating clear of one, which from a settler's eye
    // height is a hoop somebody has thrown over the animal. The strap has to
    // straddle the hide: the neck's own radius where the collar crosses it must
    // fall inside the tube, which is what wearing a collar means.
    const { view, world } = bodies();
    for (const [kind, rig] of oneOfEach(view, world)) {
      const neck = part(rig, 'neck');
      const collar = part(rig, 'collar');
      collar.geometry.computeBoundingBox();
      const box = collar.geometry.boundingBox!;
      // The torus lies in the neck's cross-section, so its half-height is the
      // strap's thickness and its half-width is that plus the ring's radius.
      const tube = box.max.y * collar.scale.y;
      const ring = (box.max.x - box.max.y) * collar.scale.x;
      // The neck is a lathe: rings of vertices at the profile's own heights.
      // Take the two that bracket the collar and read the radius between them.
      const pos = neck.geometry.attributes.position!;
      const rings = new Map<number, number>();
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const y = Math.round(v.y * 1e5) / 1e5;
        rings.set(y, Math.max(rings.get(y) ?? 0, Math.hypot(v.x, v.z)));
      }
      const levels = [...rings.entries()].sort((a, b) => a[0] - b[0]);
      const above = levels.findIndex(([y]) => y >= collar.position.y);
      expect(above, `${kind}'s collar sits on the neck, not past the end of it`).toBeGreaterThan(0);
      const [y0, r0] = levels[above - 1]!;
      const [y1, r1] = levels[above]!;
      const hide = r0 + ((r1 - r0) * (collar.position.y - y0)) / (y1 - y0);
      expect(Math.abs(ring - hide), `${kind}'s collar straddles its neck`).toBeLessThan(tube);
    }
    view.dispose();
  });

  it('puts a hoof on every animal leg with its sole at the sole of the leg — a cap that floats is a ring round the ankle', () => {
    // The hoof is a separate mesh in a darker tone, parented to the leg so it
    // swings from the hip with it. It stands on its own origin and is set at
    // the foot, so the two soles coincide by construction; this is what keeps
    // that true when someone changes a leg's length in one place and not the
    // other. The leg's own pivot is checked the way the settlers' are — at
    // its top, reaching its full length below.
    const { view } = bodies();
    const box = new THREE.Box3();
    let hooves = 0;
    view.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.name !== 'hoof') return;
      const leg = o.parent as THREE.Mesh;
      expect(leg.name).toBe('leg');
      leg.geometry.computeBoundingBox();
      box.copy(leg.geometry.boundingBox!);
      expect(box.max.y, 'leg pivots at its top').toBeCloseTo(0, 6);
      expect(box.min.y, 'leg reaches its full length').toBeCloseTo(-leg.position.y, 6);
      o.geometry.computeBoundingBox();
      expect(o.position.y + o.geometry.boundingBox!.min.y, 'hoof sole at the leg sole').toBeCloseTo(box.min.y, 6);
      expect(o.geometry.boundingBox!.max.x, 'hoof wider than the leg').toBeGreaterThan(box.max.x);
      hooves++;
    });
    expect(hooves).toBeGreaterThan(0);
    view.dispose();
  });

  it("hangs the hunt marker's point just over the animal's back, and keeps it narrow — it was a red disc wider than the hare under it", () => {
    // The marker is the one thing on an animal drawn for the player rather than
    // for the world, so it is the one thing that can shout. It did: a capped cone
    // a third of a cell across, hung at one height for every species, floated a
    // body-length over a hare and filled the middle of the first-person frame
    // while the animal itself sat below it, out of shot. Its point is its own
    // origin now, so what is checked is where the point hangs: above the back it
    // marks — never buried in it — and near enough that the eye joins the two.
    const { view, world } = bodies();
    const marked = new Set<string>();
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (!pawn.animal) continue;
      marked.add(pawn.animal);
      const mark = part(rig, 'mark');
      mark.geometry.computeBoundingBox();
      const shape = mark.geometry.boundingBox!;
      expect(shape.min.y, 'the marker points at its own origin').toBeCloseTo(0, 6);
      expect(shape.max.x - shape.min.x, 'the marker is under a quarter of a cell across').toBeLessThan(0.25);
      // Measured off the whole animal rather than off the barrel. This read the
      // crown of the barrel for a long time, which is the same proxy the rig
      // itself used, and both were wrong the same way: on the one species whose
      // head stands well over its back the marker cleared the barrel by a
      // comfortable margin and sat on the neck. The bounds below are unchanged;
      // what they are measured from is the top of the silhouette, which is at or
      // above the barrel on every species and higher on three of the four.
      const back = crest(rig);
      expect(mark.position.y, `${pawn.animal}'s marker clears it`).toBeGreaterThan(back);
      expect(mark.position.y - back, `${pawn.animal}'s marker hangs close over it`).toBeLessThan(0.3);
    }
    expect(marked.size, 'every species carries a marker').toBe(4);
    view.dispose();
  });

  it("puts a tone darker than the coat over the dunhare's back — from overhead a sand hare on sand grass was a pale lump", () => {
    // The manager camera sees the top of an animal and nothing else. The hare's
    // top was all coat, at the grass's own lightness, and the pale belly and scut
    // that make it read as a hare in first person are underneath where that
    // camera never looks. The saddle is what it has instead: the coat's own
    // colour gone deeper, riding proud of the crown of the back — so what has to
    // hold is that something darker than the coat stands above it.
    const { view, world } = bodies();
    const coat = { h: 0, s: 0, l: 0 };
    const patch = { h: 0, s: 0, l: 0 };
    let hares = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal !== 'dunhare') continue;
      hares++;
      const barrel = part(rig, 'body');
      barrel.geometry.computeBoundingBox();
      (barrel.material as THREE.MeshStandardMaterial).color.getHSL(coat);
      const over = (barrel.parent as THREE.Object3D).children.filter((o) => {
        if (!(o instanceof THREE.Mesh) || o === barrel) return false;
        (o.material as THREE.MeshStandardMaterial).color.getHSL(patch);
        if (patch.l >= coat.l - 0.05) return false;
        o.geometry.computeBoundingBox();
        return o.geometry.boundingBox!.max.y > barrel.geometry.boundingBox!.max.y;
      });
      expect(over.length, 'a darker tone stands above the coat on the hare').toBeGreaterThan(0);
    }
    expect(hares).toBeGreaterThan(0);
    view.dispose();
  });

  it("keeps a back marking in the coat's own value and on the coat's own surface — a patch that takes none of the light the hide takes reads as a hole", () => {
    // Round 4 gave the mossback a stripe and the hare a cap so the manager
    // camera could tell them apart from overhead, and both were built as their
    // own solid laid across the back: a tube along the spine, an egg sunk into
    // the barrel. At a settler's eye height that failed twice. The tube met the
    // back at a tangent, so its normals faced sideways and down and it stayed
    // dark whatever the sun did — a near-black shape that shaded independently
    // of the animal reads as a hole burnt through the shoulder. And both were
    // painted in the tone a hoof is, three or four times deeper than the hide,
    // which is a value no marking in a coat has.
    //
    // So a marking now has to be hide: cut from the body's own surface, offset
    // outward, which gives it the body's normals and the body's light; and one
    // step down from the coat rather than off the bottom of it. Both are
    // measurable here — the shade against the coat and against the hoof, and
    // that no vertex of it looks at the ground the way the tube's underside did.
    const { view, world } = bodies();
    const marked = new Set<string>();
    const n = new THREE.Vector3();
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (!pawn.animal || marked.has(pawn.animal)) continue;
      const saddles: THREE.Mesh[] = [];
      rig.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name === 'saddle') saddles.push(o);
      });
      if (saddles.length === 0) continue;
      marked.add(pawn.animal);
      const saddle = saddles[0]!;
      const hide = lightness((part(rig, 'body').material as THREE.MeshStandardMaterial).color);
      const shade = lightness((saddle.material as THREE.MeshStandardMaterial).color);
      const horn = lightness((part(rig, 'hoof').material as THREE.MeshStandardMaterial).color);
      expect(shade, `${pawn.animal}'s saddle is darker than its coat`).toBeLessThan(hide - 2);
      expect(shade, `${pawn.animal}'s saddle is the coat gone deeper, not a hole`).toBeGreaterThan(hide - 20);
      expect(shade, `${pawn.animal}'s saddle is hide and not the tone a hoof is`).toBeGreaterThan(horn + 5);
      const normals = saddle.geometry.attributes.normal!;
      let lowest = Infinity;
      for (let i = 0; i < normals.count; i++) {
        lowest = Math.min(lowest, n.fromBufferAttribute(normals, i).y);
      }
      expect(lowest, `${pawn.animal}'s saddle lies along the back and never turns under it`).toBeGreaterThan(0);
    }
    expect(marked.size, 'the two species that carry a back marking still carry one').toBe(2);
    view.dispose();
  });

  it("hangs a tail off the mossback's rump that leaves the body, falls, and is coloured like hide — the stub that was there read as a hole", () => {
    // The colony camera holds an animal at its back end more often than at any
    // other angle, and what was back there was a nine-sided capsule stub with a
    // ring in each cap: from behind, the cap and nothing else, a flat polygon
    // set into the rump. A tail cannot be read as a tail from the one angle it
    // is usually seen from unless it actually leaves the body, so that is what
    // is measured — it reaches past the rump the barrel ends at, and it hangs
    // well below where it is rooted rather than sticking out level.
    const { view, world } = bodies();
    let moss = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal !== 'mossback') continue;
      moss++;
      const tail = part(rig, 'tail');
      const barrel = part(rig, 'body');
      tail.geometry.computeBoundingBox();
      barrel.geometry.computeBoundingBox();
      const shape = tail.geometry.boundingBox!;
      expect(shape.min.z, 'the tail reaches out past the rump').toBeLessThan(
        barrel.geometry.boundingBox!.min.z,
      );
      expect(shape.max.y - shape.min.y, 'the tail hangs rather than sticking out level').toBeGreaterThan(0.12);
      // And it is hair, so it is painted in the coat's own value gone a step
      // deeper. In the tone a hoof is — which is where it was — a shape that
      // leaves the body only makes the hole bigger.
      const hide = lightness((barrel.material as THREE.MeshStandardMaterial).color);
      const worn = lightness((tail.material as THREE.MeshStandardMaterial).color);
      const horn = lightness((part(rig, 'hoof').material as THREE.MeshStandardMaterial).color);
      expect(worn, "the tail is the coat gone deeper, not the tone a hoof is").toBeGreaterThan(horn + 5);
      expect(worn, 'and it is deeper than the coat, so the rump has an outline').toBeLessThan(hide);
    }
    expect(moss, 'the map starts with a mossback to check').toBeGreaterThan(0);
    view.dispose();
  });

  it('narrows that tail to a turned tip — a blunt end of constant width shows the camera its cap, and a cap is what read as a hole', () => {
    // The bug this part exists to undo was never the shape of the tail so much
    // as its end: a stub as thick where it stopped as where it started, closed
    // with a cap of few enough sides to be a polygon. Both halves of that are
    // checkable without a picture. It has to taper, so there is little left at
    // the end to present; and the little that is left has to be turned, so its
    // normals sweep round the dome instead of facing one way together.
    const { view, world } = bodies();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let moss = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal !== 'mossback') continue;
      moss++;
      const tail = part(rig, 'tail');
      const pos = tail.geometry.attributes.position!;
      const normals = tail.geometry.attributes.normal!;
      tail.geometry.computeBoundingBox();
      const { min, max } = tail.geometry.boundingBox!;
      // The last fifth of the tail, which is all a camera behind the animal sees.
      const end = min.z + (max.z - min.z) * 0.2;
      const tip: number[] = [];
      let root = 0;
      let stub = 0;
      for (let i = 0; i < pos.count; i++) {
        root = Math.max(root, Math.abs(pos.getX(i)));
        if (pos.getZ(i) > end) continue;
        tip.push(i);
        stub = Math.max(stub, Math.abs(pos.getX(i)));
      }
      expect(stub, 'the tail is a fraction of its own thickness by the time it ends').toBeLessThan(root * 0.4);
      let widest = 0;
      for (const i of tip) {
        a.fromBufferAttribute(normals, i);
        for (const j of tip) widest = Math.max(widest, a.angleTo(b.fromBufferAttribute(normals, j)));
      }
      expect(tip.length, 'the tail has an end to look at').toBeGreaterThan(4);
      expect(widest, 'the normals turn through the tip rather than facing one way').toBeGreaterThan(1.5);
    }
    expect(moss, 'the map starts with a mossback to check').toBeGreaterThan(0);
    view.dispose();
  });

  it('rolls the hunt marker over its own rim and halves its footprint — near the camera it was the largest flat colour in the frame', () => {
    // The marker is drawn unlit on purpose: a hunt order has to read the same at
    // three in the morning as at noon. That costs it the one cue that tells an
    // eye how big something is, so a funnel a quarter of a cell across parked
    // between the player and the animal was a sheet of orange with a hole in it.
    // Two things answer that and both are measured here: it is smaller, and its
    // top edge is a rolled lip rather than the hard circle a cone ends on —
    // which means the widest ring is no longer the last one.
    const { view } = bodies();
    const mark = part(view.group, 'mark');
    mark.geometry.computeBoundingBox();
    const shape = mark.geometry.boundingBox!;
    expect(shape.max.x - shape.min.x, 'the marker is under a sixth of a cell across').toBeLessThan(0.16);
    expect(shape.max.y, 'and no taller than it is wide, twice over').toBeLessThan(0.21);
    const pos = mark.geometry.attributes.position!;
    let widest = 0;
    let atTop = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      widest = Math.max(widest, r);
      if (pos.getY(i) > shape.max.y - 1e-6) atTop = Math.max(atTop, r);
    }
    expect(atTop, 'the rim turns back inward above its widest point').toBeLessThan(widest - 0.004);
    view.dispose();
  });

  it('gives every species the same air under its marker, and opens the point — a red drop resting on a grey shoulder is a wound, not an order', () => {
    // The clearance above was a number in the animal's own body space, and the
    // rig multiplied it by the species' size on the way out, so the air under
    // the marker shrank with the animal: a hand's width of it over a mossback,
    // under three centimetres over a brambletail, which at any zoom is contact.
    // A shape lying on the hide, filled with one flat red-orange and tapering to
    // a point at the bottom, is the silhouette of a drop of blood — the frame it
    // was caught in read as an injury the animal took rather than as an order
    // somebody gave. The marker is drawn for the player, so it is hung in the
    // player's units: the same gap for every species. And the tip that made it a
    // drop is a ring now, wide enough to show ground through the middle of it.
    const { view, world } = bodies();
    const gaps: number[] = [];
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (!pawn.animal) continue;
      // Off the silhouette, not off the barrel: see the note in the test above.
      gaps.push(part(rig, 'mark').position.y - crest(rig));
    }
    expect(gaps.length, 'there are marked animals to measure').toBeGreaterThan(0);
    expect(
      Math.max(...gaps) - Math.min(...gaps),
      'a hare gets as much air under its marker as a mossback does',
    ).toBeLessThan(0.01);
    const mark = part(view.group, 'mark');
    mark.geometry.computeBoundingBox();
    const pos = mark.geometry.attributes.position!;
    const floor = mark.geometry.boundingBox!.min.y;
    let mouth = 0;
    let widest = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      widest = Math.max(widest, r);
      if (pos.getY(i) < floor + 1e-6) mouth = Math.max(mouth, r);
    }
    expect(mouth, 'the point is an opening, not the tip of a drop').toBeGreaterThan(widest * 0.35);
    view.dispose();
  });

  it("gives a settler's hand a thumb and turns it toward the midline — two pale ovals on the ends of the arms are not hands", () => {
    // The overhead camera is close enough to count fingers and the hand was a
    // sphere, so it read as a blob rather than as the end of an arm. A thumb is
    // the cheapest thing that fixes it, but only if it is on the inside: a
    // hand is cut with its thumb toward -X and the left arm wears the same
    // buffer mirrored, so both thumbs face the body. Get the mirror wrong and
    // one settler in every pair has a thumb growing off the wrong edge — which
    // no frame makes obvious and this does. The outline is measured off the
    // geometry (the thumb is what makes the box lopsided across X) and its
    // direction in the rig's own frame, where the midline is x = 0.
    const { view, world } = bodies();
    const tip = new THREE.Vector3();
    let settlers = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      settlers++;
      const hands: THREE.Mesh[] = [];
      rig.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name === 'hand') hands.push(o);
      });
      expect(hands.length, 'a settler has two hands').toBe(2);
      const mirrored = new Set<number>();
      for (const hand of hands) {
        hand.geometry.computeBoundingBox();
        const box = hand.geometry.boundingBox!;
        expect(-box.min.x, 'the thumb stands well out past the palm').toBeGreaterThan(box.max.x * 1.3);
        mirrored.add(Math.sign(hand.scale.x));
        tip.set(box.min.x, 0, 0);
        hand.localToWorld(tip);
        rig.worldToLocal(tip);
        // The hand rides the forearm, which hangs from the elbow on the arm's
        // own axis; the shoulder's offset from the midline is on the upper arm.
        const arm = hand.parent!.parent as THREE.Object3D;
        expect(Math.abs(tip.x), 'the thumb points in toward the body, not out').toBeLessThan(Math.abs(arm.position.x));
      }
      expect(mirrored.size, 'the two hands are mirrored, so both thumbs face in').toBe(2);
    }
    expect(settlers).toBeGreaterThan(0);
    view.dispose();
  });

  it('hangs the hand past the end of the cuff and wider than it — a palm inside the sleeve is an arm ending in nothing', () => {
    // The thumb above was shipped and nobody could see it. The sleeve ran to the
    // fingertips and the palm was narrower across than the cloth, so the whole
    // hand lived inside the arm and the closest camera the game has framed a
    // blue tube ending bluntly at the wrist. Neither half of that shows in a
    // triangle count or in the thumb's direction, so both are measured here: the
    // hand has to reach past the cuff by most of its own length, which is what
    // makes skin the thing the arm ends in, and it has to be deeper than the
    // sleeve is thick, which is what puts it in the silhouette as well as in the
    // colour.
    const { view, world } = bodies();
    let settlers = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      settlers++;
      // The cuff is the end of the forearm since the arm was jointed at the elbow.
      const arm = part(rig, 'forearm');
      const hand = part(arm, 'hand');
      arm.geometry.computeBoundingBox();
      hand.geometry.computeBoundingBox();
      const sleeve = arm.geometry.boundingBox!;
      const palm = hand.geometry.boundingBox!;
      const proud = sleeve.min.y - (hand.position.y + palm.min.y);
      expect(proud, 'most of the hand hangs below the cuff').toBeGreaterThan((palm.max.y - palm.min.y) * 0.5);
      expect(palm.max.z, 'and it is deeper than the sleeve, so it breaks the outline').toBeGreaterThan(sleeve.max.z);
    }
    expect(settlers).toBeGreaterThan(0);
    view.dispose();
  });

  it("leaves no square corner on the rifle's steel — the receiver and the sight were the last boxes on a settler", () => {
    // A body of capsules and lathes with two boxes left in it, on the one thing
    // a colonist holds out away from the silhouette at exactly the height the
    // manager camera looks hardest at. A box catches the sun on three flats at
    // once and keeps its corners at every zoom, which is the read the whole
    // rebuild existed to lose. Both are read off the vertices. The receiver's
    // flanks are the only part of the steel that reaches out past the barrel, and
    // on a rounded box they stop a corner radius short of its full height where
    // a box's run the whole way. And the highest thing on the rifle is the
    // sight: a post ends in a pole, a box in the four corners of a flat roof.
    const { view } = bodies();
    const steel = part(view.group, 'action');
    const pos = steel.geometry.attributes.position!;
    let across = 0;
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      across = Math.max(across, Math.abs(pos.getX(i)));
      top = Math.max(top, pos.getY(i));
    }
    const spanY = (keep: (absX: number) => boolean): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (!keep(Math.abs(pos.getX(i)))) continue;
        lo = Math.min(lo, pos.getY(i));
        hi = Math.max(hi, pos.getY(i));
      }
      return hi - lo;
    };
    expect(spanY((x) => x > across - 1e-6), "the receiver's flank stops short of its own corners").toBeLessThan(
      spanY((x) => x > across * 0.8) * 0.7,
    );
    const roof = new THREE.Box3();
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > top - 1e-6) roof.expandByPoint(new THREE.Vector3(pos.getX(i), 0, pos.getZ(i)));
    }
    expect(
      Math.max(roof.max.x - roof.min.x, roof.max.z - roof.min.z),
      'the sight ends in a point, not in a flat roof',
    ).toBeLessThan(0.002);
    view.dispose();
  });

  it('shapes a boot with a heel behind the ankle and a toe in front of it — a capsule the same at both ends is a peg', () => {
    // A foot is not symmetric and the eye knows it: the toe runs further ahead
    // of the ankle than the heel runs behind, and the widest part of the sole
    // is the ball, not the heel. The boot is one capsule tapered along its
    // length to get both, which costs no triangles, and both properties are
    // read straight off the vertices — the box for the reach, the widest
    // vertex on either side of the ankle for the spread.
    const { view, world } = bodies();
    const v = new THREE.Vector3();
    let boots = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      const boot = part(rig, 'boot');
      boots++;
      boot.geometry.computeBoundingBox();
      const box = boot.geometry.boundingBox!;
      expect(box.max.z, 'the toe reaches further forward than the heel reaches back').toBeGreaterThan(-box.min.z * 1.05);
      const pos = boot.geometry.attributes.position!;
      let heel = 0;
      let ball = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.z < 0) heel = Math.max(heel, Math.abs(v.x));
        else if (v.z > 0) ball = Math.max(ball, Math.abs(v.x));
      }
      expect(ball, 'the sole is widest across the ball, not across the heel').toBeGreaterThan(heel);
    }
    expect(boots).toBeGreaterThan(0);
    view.dispose();
  });

  it("keeps every species' hide in its own hue on every seed — the tint built for cloth turned the fenwolf lavender", () => {
    // `pawnTint` swings a hue up to a fifth of the way round the wheel, which
    // is what makes a crew's shirts differ and what turned a cold grey wolf
    // purple and an olive mossback green. Hides go through `hideTint`, and it
    // has to hold each species to its own hue — within a few degrees — and
    // hold the wolf to a grey, whatever the seed.
    const base = { h: 0, s: 0, l: 0 };
    const got = { h: 0, s: 0, l: 0 };
    for (const kind of Object.keys(ANIMAL_COLOR) as (keyof typeof ANIMAL_COLOR)[]) {
      new THREE.Color(ANIMAL_COLOR[kind]).getHSL(base);
      for (let seed = 0; seed < 4096; seed++) {
        hideTint(ANIMAL_COLOR[kind], seed).getHSL(got);
        const drift = Math.abs(got.h - base.h);
        expect(Math.min(drift, 1 - drift), `${kind} hue on seed ${seed}`).toBeLessThan(0.02);
        if (kind === 'fenwolf') expect(got.s, `fenwolf stays grey on seed ${seed}`).toBeLessThan(0.3);
      }
    }
  });

  it('gives every hair tone a clear step in lightness from every skin tone — a blond on a tan face was a bald head from overhead', () => {
    // The hair and the skin are drawn on a seed's bits independently, so every
    // pairing happens in a colony of any size. A pairing that matches in
    // lightness is one pale sphere from the manager camera — hue does not
    // survive the sun and shadow at that distance, lightness does. Seven L*
    // is three times a just-noticeable step and the widest margin the gaps
    // between six skin tones leave room for.
    expect(HAIR_TONES.length).toBeGreaterThan(0);
    for (const h of HAIR_TONES) {
      for (const s of SKIN_TONES) {
        const gap = Math.abs(lightness(new THREE.Color(h)) - lightness(new THREE.Color(s)));
        expect(gap, `hair ${h.toString(16)} on skin ${s.toString(16)}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('hangs the fringe to the brow and no lower — hair over the eyes is a helmet, hair above them is a hairline', () => {
    // The face has to show below the hair for the head to read as a head with
    // hair on it, and the eyes are the face. The fringe's hem sits at the
    // brow, above the top of both eyes and below the crown, on both crops —
    // which the map's seed does not promise to deal out, so bit twelve of the
    // seed, the crop, is set by hand on every other settler before the bodies
    // are built.
    const world = createWorld(SEED);
    world.pawns.filter((p) => !p.animal).forEach((p, i) => {
      p.colorSeed = (p.colorSeed & ~0x1000) | (i & 1 ? 0x1000 : 0);
    });
    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 0, null, 0);
    const v = new THREE.Vector3();
    const crops = new Set<THREE.BufferGeometry>();
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      const head = part(rig, 'head');
      const hair = part(rig, 'hair');
      crops.add(hair.geometry);
      const eyes = head.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.name === 'eye');
      expect(eyes).toHaveLength(2);
      let brow = -Infinity;
      for (const eye of eyes) {
        eye.geometry.computeBoundingSphere();
        brow = Math.max(brow, eye.position.y + eye.geometry.boundingSphere!.radius);
      }
      // The hem over the face: the lowest hair vertex on the front of the head
      // within the eyes' span, in the head's own frame — the hair is its child.
      const pos = hair.geometry.attributes.position!;
      let hem = Infinity;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.z > 0.08 && Math.abs(v.x) < 0.08) hem = Math.min(hem, v.y);
      }
      expect(hem, 'fringe clears the eyes').toBeGreaterThan(brow);
      head.geometry.computeBoundingBox();
      expect(hem, 'fringe comes down the forehead').toBeLessThan(head.geometry.boundingBox!.max.y * 0.5);
    }
    expect(crops.size, 'the map has both crops to check').toBe(2);
    view.dispose();
  });

  it('breaks the settler into four bands — shirt, trousers, belt and boots are four colours, the leather darker than the cloth', () => {
    // At the manager zoom a settler is a few dozen pixels tall, and what it is
    // wearing is the only thing it can say about itself. One cloth from neck
    // to sole was a column; a shirt over trousers, split by a dark belt and
    // ending in darker boots, is a person dressed. Lightness is the measure
    // for the same reason it is for the hair.
    const { view, world } = bodies();
    let settlers = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      settlers++;
      const colour = (name: string): THREE.Color => (part(rig, name).material as THREE.MeshStandardMaterial).color;
      const shirt = colour('torso');
      const trousers = colour('leg');
      const belt = colour('belt');
      const boot = colour('boot');
      expect(trousers.getHex(), 'trousers are not the shirt').not.toBe(shirt.getHex());
      expect(belt.getHex(), 'belt is not the boots').not.toBe(boot.getHex());
      for (const cloth of [shirt, trousers]) {
        for (const leather of [belt, boot]) {
          expect(lightness(leather), 'leather darker than cloth').toBeLessThan(lightness(cloth) - 5);
        }
      }
    }
    expect(settlers).toBeGreaterThan(0);
    view.dispose();
  });

  it('dyes every sleeve a clear step below its shirt, for every faction and every seed, without dropping one through the floor', () => {
    // The arms and the torso wore one material, and at the zoom the colony is
    // played at that is half a settler in a single value. The step has a floor
    // and a ceiling and both were measured off a frame, which is why they are
    // written here as numbers rather than as whatever the constant happens to
    // say: below about nine the shoulder does not read (a colonist at a bench
    // had five points of shading valley there and it was not enough — the arm
    // ran on out of the torso as one slab), and above about fourteen the sleeve
    // falls onto the trousers it crosses at the thigh, which had fifteen points
    // of room and no more. A test that only asked "is the sleeve darker" would
    // pass on a step of one and on a step that painted the arms black.
    for (const base of Object.values(FACTION_COLOR)) {
      for (let seed = 0; seed < 4096; seed++) {
        const shirt = pawnTint(base, seed);
        const sleeve = sleeveOf(shirt);
        const drop = lightness(shirt) - lightness(sleeve);
        expect(drop, `shirt ${shirt.getHexString()} seed ${seed}`).toBeGreaterThanOrEqual(9);
        expect(drop, `shirt ${shirt.getHexString()} seed ${seed}`).toBeLessThanOrEqual(14);
        // The same floor every material in the colony is held to: under it the
        // sun, the sky and the ground bounce all land in the same few codes and
        // a sleeve stops being cloth and starts being a hole in the settler.
        expect(luminance(sleeve), `sleeve ${sleeve.getHexString()}`).toBeGreaterThan(0.025);
      }
    }
    // And it is the shirt in another tone, not another garment: the same dye
    // with less light on it, which is one scalar across the linear channels.
    // Hue survives that, and so do the ratios between the channels — the
    // property actually worth pinning, because a sleeve *mixed* toward black
    // rather than dimmed would drift off the faction's hue by a different
    // amount in every tint and the arms would stop saying who this is.
    //
    // sRGB's HSL saturation is the wrong question to ask of it and is left
    // unasserted on purpose: the transfer curve is not linear, so a colour that
    // is honestly the same dye at less light reads about a tenth less
    // "saturated" there. Asserting it would pin the encoding, not the cloth.
    const shirt = new THREE.Color(FACTION_COLOR.colony);
    const sleeve = sleeveOf(shirt);
    const a = { h: 0, s: 0, l: 0 };
    const b = { h: 0, s: 0, l: 0 };
    shirt.getHSL(a, THREE.SRGBColorSpace);
    sleeve.getHSL(b, THREE.SRGBColorSpace);
    expect(b.h, 'the sleeve keeps the shirt hue').toBeCloseTo(a.h, 3);
    const share = sleeve.b / shirt.b;
    expect(share, 'the sleeve is the shirt with less light on it').toBeLessThan(1);
    expect(sleeve.r / shirt.r, 'red falls by the share blue did').toBeCloseTo(share, 6);
    expect(sleeve.g / shirt.g, 'green falls by the share blue did').toBeCloseTo(share, 6);
  });

  it('hangs the arms out of the body, so the sleeve has ground behind it and not the shirt', () => {
    // Plumb arms on this body are pressed against the cloth: the shoulder is at
    // 0.27 across, the sleeve is 0.065 round and the torso is 0.20 across at the
    // waist, which leaves five millimetres — under a pixel from eleven cells up,
    // so the arm and the shirt shared one outline with no notch in it. The roll
    // is a constant at the shoulder and the pose table only ever writes
    // `rotation.x`, so the clearance below is the same in the walk, at the bench
    // and lying down: `rotation.x` cannot move a point's x. The elbow is a
    // `rotation.x` too, so the forearm keeps the roll the shoulder gave it;
    // the chest's twist is the one yaw, and only a walking settler takes it.
    const { view, world } = bodies();
    let arms = 0;
    view.group.updateMatrixWorld(true);
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      const sleeves = drawn(rig).filter((m) => m.name === 'arm');
      expect(sleeves, 'two arms').toHaveLength(2);
      for (const sleeve of sleeves) {
        const hand = part(sleeve, 'hand'); // on the forearm, below the elbow
        // In the rig's own frame, where +X is the settler's left-to-right.
        const wrist = rig.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
        expect(Math.sign(wrist.x), 'the wrist stays on its own side').toBe(Math.sign(sleeve.position.x));
        expect(
          Math.abs(wrist.x) - Math.abs(sleeve.position.x),
          'the wrist stands outboard of the shoulder',
        ).toBeGreaterThan(0.05);
        arms++;
      }
    }
    expect(arms).toBeGreaterThan(0);
    view.dispose();
  });

  it('keeps a settler at a bench from reading as one slab — overhead, the shoulder and the sleeve take the same light and only the dye can separate them', () => {
    // This is the frame the round was briefed from: a colonist working inside
    // the wall, seen from the camera the game is actually played at. Its torso
    // measured L* 33 and the arm held out of it measured 28 at the shoulder and
    // ran smoothly up to 49 at the wrist — a gradient with no edge in it, so the
    // eye joined the two and read a signpost bolted to a body.
    //
    // The reason no amount of lighting was ever going to fix that is measured
    // here rather than asserted: at a bench the sleeve's crown and the top of
    // the shoulder present very nearly the same normal, so a sun overhead lands
    // on both within a tenth of the same strength — about two points of L* at
    // the luminances a settler wears. Two points is under a just-noticeable
    // step. Whatever separates a shoulder from an arm has to be in the cloth,
    // and this test fails the day it stops being.
    const world = createWorld(SEED);
    for (const p of world.pawns) {
      if (p.animal) continue;
      p.activity = 'working';
      p.animPhase = 0; // the pose table's swing at rest, so the angle is the table's own
    }
    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 0, null, 0);
    view.group.updateMatrixWorld(true);

    const q = new THREE.Quaternion();
    const torsoBox = new THREE.Box3();
    const armBox = new THREE.Box3();
    let checked = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      const torso = part(rig, 'torso');
      for (const sleeve of drawn(rig).filter((m) => m.name === 'arm')) {
        // The two really do meet: a value step across a boundary that is not
        // there would prove nothing.
        torsoBox.setFromObject(torso);
        armBox.setFromObject(sleeve);
        expect(torsoBox.intersectsBox(armBox), 'the sleeve meets the shirt').toBe(true);

        // The shoulder's crown is the torso's own +Y — the rig is only ever
        // yawed, and yaw does not tip it. The sleeve's is the point on the tube
        // that faces most nearly up: up with its component along the tube taken
        // out, which is what a cylinder's topmost surface normal is.
        const shoulderUp = new THREE.Vector3(0, 1, 0).applyQuaternion(torso.getWorldQuaternion(q));
        const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(sleeve.getWorldQuaternion(q));
        const sleeveUp = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y);
        expect(sleeveUp.length(), 'the arm is not straight up, so it has a crown').toBeGreaterThan(0.2);
        sleeveUp.normalize();

        // What a sun straight overhead can make of that difference, in the
        // units the eye counts in: the same cloth at the two normals, through
        // three's own diffuse term, converted to L*. The arm at a bench sits
        // about thirty degrees off the vertical, which is a tenth of the light,
        // and a tenth of the light is between two and five points on the
        // brightest shirt any faction wears — under the step it takes to read
        // as an edge. That is the whole reason this could never have been fixed
        // in the light rig, and it is measured here rather than asserted.
        const shirt = (torso.material as THREE.MeshStandardMaterial).color;
        const cuff = (sleeve.material as THREE.MeshStandardMaterial).color;
        const overhead = new THREE.Vector3(0, 1, 0);
        const lstarOf = (y: number): number => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);
        const lit = (n: THREE.Vector3): number => lstarOf(luminance(shirt) * Math.max(0, n.dot(overhead)));
        const bySun = lit(shoulderUp) - lit(sleeveUp);
        expect(bySun, `${pawn.faction} shoulder against sleeve, by light alone`).toBeLessThan(5);

        // So the dye must, by more than three just-noticeable steps — the same
        // margin the hair is held above the skin for the same reason — and by
        // more than the sun manages on its own, so the edge belongs to the
        // cloth and not to which way the arm happens to be swung.
        const byDye = lightness(shirt) - lightness(cuff);
        expect(byDye, `${pawn.faction} sleeve`).toBeGreaterThanOrEqual(9);
        expect(byDye, `${pawn.faction} sleeve against its own shading`).toBeGreaterThan(bySun);
        checked++;
      }
    }
    expect(checked, 'a settler at a bench to look at').toBeGreaterThan(0);
    view.dispose();
  });

  it("gives every species seven separate hides across the seed's lightness steps — the guard against mud held five of the mossback's seven at one colour", () => {
    // `hideTint` reads and writes HSL, and three's HSL follows the working
    // colour space unless it is told otherwise. `ColorManagement` is on here and
    // the working space is linear-sRGB, so every number in that function — a
    // lightness step of 0.025, a floor of 0.15 — was being applied on a scale
    // where a mid brown sits near 0.1 rather than near 0.35. The floor, written
    // so that no hide could fall into mud, stood above five of the mossback's
    // seven lightness steps and six of the fenwolf's and clamped every one of
    // them to the same colour: a herd of mossbacks was a herd of one mossback,
    // and the animal drawn on the darkest seed came out lighter than the one
    // drawn on the middle seed.
    //
    // The seeds below share a hue index and a saturation index and differ only
    // in the lightness index, so what is measured is the lightness step alone.
    // They are searched for rather than written down, because the bit layout
    // they depend on lives in `hideTint` and should only have to be right once.
    const ladder = new Map<number, number>();
    for (let seed = 0; seed < 4096 && ladder.size < 7; seed++) {
      if (seed % 7 !== 6 || (seed >> 3) % 5 !== 3) continue;
      const step = (seed >> 6) % 7;
      if (!ladder.has(step)) ladder.set(step, seed);
    }
    expect(ladder.size, 'seven seeds that differ only in the lightness step').toBe(7);
    const steps = [...ladder.entries()].sort((a, b) => a[0] - b[0]).map(([, seed]) => seed);

    for (const kind of Object.keys(ANIMAL_COLOR) as (keyof typeof ANIMAL_COLOR)[]) {
      const hides = steps.map((seed) => hideTint(ANIMAL_COLOR[kind], seed));
      for (const [i, hide] of hides.entries()) {
        // Nothing on an animal may be the value at which a surface stops being a
        // colour: the same floor the building materials are held to.
        expect(luminance(hide), `${kind} hide on lightness step ${i}`).toBeGreaterThan(0.025);
        if (i === 0) continue;
        // A just-noticeable step is about one point of L*. The smallest of these
        // measures 2.11 (the dunhare's) and the largest 2.83 (the mossback's);
        // under the working-space arithmetic the mossback's first five steps and
        // the fenwolf's first six measured 0.00 apart.
        expect(
          lightness(hide) - lightness(hides[i - 1]!),
          `${kind} steps up in lightness from seed step ${i - 1} to ${i}`,
        ).toBeGreaterThan(1.5);
      }
    }
  });

  it("sets a settler's eyes into the face instead of onto it — two beads standing off a skull are a face pressed against glass", () => {
    // The head is a sphere of 0.13 drawn a touch tall, and the eye was a sphere
    // of 0.022 seated on the skin at a point 0.135 from the skull's centre. The
    // skull's own surface along that ray is at 0.131, so the outermost point of
    // the eye stood 26 millimetres clear of it — a fifth of the head's radius,
    // enough to show on the outline of the head from the manager camera, which
    // is the one distance at which a settler is a silhouette and nothing else.
    // What breaks a silhouette is not the size of the bead, it is how far it
    // stands off, so what is pinned is the standing off.
    const { view, world } = bodies();
    let settlers = 0;
    for (const rig of view.group.children) {
      const pawn = world.pawns.find((p) => p.x === rig.position.x && p.y === rig.position.z)!;
      if (pawn.animal) continue;
      settlers++;
      const head = part(rig, 'head');
      head.geometry.computeBoundingBox();
      const axes = head.geometry.boundingBox!.max;
      for (const eye of head.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name === 'eye')) {
        eye.geometry.computeBoundingBox();
        const r = eye.geometry.boundingBox!.max.x;
        const p = eye.position;
        // Where the ellipsoid's surface cuts the ray the eye sits on: a point is
        // on it when its coordinates over the half-extents sum to one, squared.
        const t = p.length() / Math.hypot(p.x / axes.x, p.y / axes.y, p.z / axes.z);
        expect(p.length() + r - t, 'the eye stands off the skin').toBeLessThan(0.021);
        expect(p.length() + r - t, 'and still stands off it, or it is a painted dot').toBeGreaterThan(0.01);
      }
    }
    expect(settlers).toBeGreaterThan(0);
    view.dispose();
  });

  it('keeps every tone on an animal off the floor and in its order — a hoof was a hole cut in a leg, on all four species and every seed', () => {
    // The tones under the coat are the coat moved, and they were moved with
    // `offsetHSL`, which cannot be told a colour space and so did its arithmetic
    // over linear channels. An offset of -0.14 in lightness is a step down on a
    // dark coat in sRGB and a fall through the bottom of it in linear: measured
    // over every seed the `dark` tone bottomed out at 0.0065 of luminance, a
    // quarter of the floor below which a surface stops returning a colour at
    // all. A scanline across the fenwolf's far ear read 34,32,27 32,31,31
    // 17,17,17 13,13,13 against grass at 181,180,138 on both sides, and the
    // mossback's four hooves were solid black caps on tan legs.
    //
    // Every kind is checked on the seed that gives it its darkest possible coat,
    // because that is the seed the old arithmetic died on and the one a herd of
    // any size will contain. A calf is checked too: it is its dam's palette on a
    // smaller body, and a growth factor that reached the materials would show up
    // here as a calf shading differently from the animal beside it.
    const world = createWorld(SEED);
    const kinds = Object.keys(ANIMAL_COLOR) as (keyof typeof ANIMAL_COLOR)[];
    let nextId = Math.max(...world.pawns.map((p) => p.id)) + 1;
    const cases = new Map<number, string>();
    for (const kind of kinds) {
      const stock = world.pawns.find((p) => p.animal === kind);
      expect(stock, `the map carries a ${kind} to copy`).toBeDefined();
      let worst = 0;
      for (let seed = 1; seed < 4096; seed++) {
        if (luminance(hideTint(ANIMAL_COLOR[kind], seed)) < luminance(hideTint(ANIMAL_COLOR[kind], worst))) worst = seed;
      }
      for (const born of [undefined, world.tick]) {
        const copy = { ...stock!, id: nextId++, colorSeed: worst, born };
        cases.set(copy.id, `${kind}${born === undefined ? '' : ' calf'} on its darkest seed`);
        world.pawns.push(copy);
      }
    }

    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 0, null, 0);
    // Rigs are added in pawn order on the first sync, which is how a cloned pawn
    // is found again without giving it a position on the map to stand at.
    const live = world.pawns.filter((p) => !p.buried);
    expect(view.group.children.length, 'a rig for every pawn').toBe(live.length);

    let checked = 0;
    for (const [i, pawn] of live.entries()) {
      if (!pawn.animal) continue;
      const rig = view.group.children[i]!;
      const who = cases.get(pawn.id) ?? pawn.animal;
      const colour = (m: THREE.Mesh): THREE.Color => (m.material as THREE.MeshStandardMaterial).color;
      const hide = colour(part(rig, 'body'));
      const dark = colour(part(rig, 'hoof'));
      // The inside of an ear is the pale tone, and every species wears a pair.
      const lining = ears(rig)[0]!.children[0] as THREE.Mesh;
      const pale = colour(lining);
      // A back marking, where the species has one: the two that carry a saddle.
      const patch = rig.getObjectByName('saddle') as THREE.Mesh | undefined;

      for (const [name, c] of [['hide', hide], ['dark', dark], ['pale', pale]] as const) {
        expect(luminance(c), `${who}: ${name}`).toBeGreaterThan(0.025);
      }
      expect(lightness(pale), `${who}: the inside of an ear is lighter than the coat`).toBeGreaterThan(lightness(hide));
      expect(lightness(dark), `${who}: a hoof is darker than the coat`).toBeLessThan(lightness(hide));
      if (patch) {
        const shade = colour(patch);
        expect(luminance(shade), `${who}: shade`).toBeGreaterThan(0.025);
        expect(lightness(shade), `${who}: a back marking is darker than the coat`).toBeLessThan(lightness(hide));
        expect(lightness(shade), `${who}: a back marking is lighter than a hoof`).toBeGreaterThan(lightness(dark));
      }
      checked++;
    }
    expect(checked, 'every species and every calf measured').toBeGreaterThanOrEqual(kinds.length * 2);
    view.dispose();
  });

  it('holds a trader, a raider and a prisoner to the settler budget — a trader drew 3,568 against 3,000 and nothing on the map could see it', () => {
    // The budget test above sweeps the pawns the map starts with, and on turn one
    // every one of them is a colonist. A trader carries a bundle and three
    // crates that nobody else does — 624 triangles, all of it bought with
    // rounded boxes: the bundle's second bevel segment alone cost more than a
    // settler's head. So the one body on the map that could break the budget was
    // the one body the budget was never measured on. The other two factions cost
    // nothing extra today and are here so that the next thing hung off a faction
    // is measured the day it lands.
    const world = createWorld(SEED);
    const settler = world.pawns.find((p) => !p.animal && p.faction === 'colony');
    expect(settler, 'the map starts with a colonist to copy').toBeDefined();
    let nextId = Math.max(...world.pawns.map((p) => p.id)) + 1;
    const cases = new Map<number, string>();
    for (const faction of ['trader', 'raider', 'prisoner'] as const) {
      const copy = { ...settler!, id: nextId++, faction };
      cases.set(copy.id, faction);
      world.pawns.push(copy);
    }

    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 0, null, 0);
    const live = world.pawns.filter((p) => !p.buried);
    expect(view.group.children.length, 'a rig for every pawn').toBe(live.length);

    const counts = new Map<string, number>();
    for (const [i, pawn] of live.entries()) {
      const rig = view.group.children[i]!;
      const total = drawn(rig).reduce((n, m) => n + triangles(m), 0);
      const who = cases.get(pawn.id);
      if (who) counts.set(who, total);
      if (!pawn.animal) expect(total, `${who ?? 'settler'} rig (${pawn.weapon})`).toBeLessThanOrEqual(3000);
    }
    expect([...counts.keys()].sort(), 'all three factions drawn').toEqual(['prisoner', 'raider', 'trader']);
    // And the trader is really carrying the freight — otherwise the budget above
    // is measuring a settler in a different coat and proving nothing.
    expect(counts.get('trader')!, 'a trader draws its load').toBeGreaterThan(counts.get('raider')! + 100);
    view.dispose();
  });

  it("paints the inside of the hunt marker darker than the outside — one flat colour on both walls is a hole in the frame, not a funnel", () => {
    // The marker is unlit on purpose, so a hunt order reads the same at three in
    // the morning as at noon. That costs it every cue a shape normally gets from
    // the light, and drawn double-sided in one colour it had none left: at a
    // settler's eye height it was fifteen thousand pixels of one value, a shape
    // with no inside and no outside, which the eye resolves as a hole rather
    // than as a cone. Two shells on the one buffer instead, and the only thing
    // that can tell them apart is the value they are painted.
    const { view } = bodies();
    const mark = part(view.group, 'mark');
    const inner = part(view.group, 'mark-inner');
    expect(inner.parent, 'the inner wall rides the marker').toBe(mark);
    expect(inner.geometry, 'and shares its buffer').toBe(mark.geometry);
    const outerMat = mark.material as THREE.MeshBasicMaterial;
    const innerMat = inner.material as THREE.MeshBasicMaterial;
    expect(outerMat.side, 'the outer shell draws its front faces').toBe(THREE.FrontSide);
    expect(innerMat.side, 'the inner shell draws its back faces').toBe(THREE.BackSide);
    // Ten points of L* is the step that survives at a glance against a moving
    // background; these measure twenty-two apart.
    expect(
      lightness(outerMat.color) - lightness(innerMat.color),
      'the throat of the funnel is a clear step darker than its outside',
    ).toBeGreaterThan(10);
    view.dispose();
  });

  it("hangs the hunt marker over the top of the animal itself, calf or grown — on a mossback it rode the neck and read as a red collar", () => {
    // The clearance was measured off a height each species declared, and all four
    // declared the crown of the barrel. On three species the barrel is the top of
    // the animal and the marker floated correctly; on the mossback the head, the
    // ears and the antlers stand up to forty-one centimetres above it, so the
    // marker's point hung at 1.19 against a silhouette that reaches 1.36 and the
    // marker was inside the animal. The rig measures the body it has just built
    // now, so what is asserted is the thing that was actually wanted: the point
    // stands clear of the whole animal, by the same air on every species and at
    // either size, because a calf is not owed less warning than its dam.
    const world = createWorld(SEED);
    let nextId = Math.max(...world.pawns.map((p) => p.id)) + 1;
    const calves = new Set<number>();
    for (const kind of Object.keys(ANIMAL_COLOR) as (keyof typeof ANIMAL_COLOR)[]) {
      const stock = world.pawns.find((p) => p.animal === kind);
      expect(stock, `the map carries a ${kind} to copy`).toBeDefined();
      const copy = { ...stock!, id: nextId++, born: world.tick, hunted: true };
      calves.add(copy.id);
      world.pawns.push(copy);
    }
    const view = new PawnsView();
    view.onTick(world);
    view.sync(world, 0, null, 0);
    const live = world.pawns.filter((p) => !p.buried);
    const gaps: number[] = [];
    const kinds = new Set<string>();
    for (const [i, pawn] of live.entries()) {
      if (!pawn.animal || pawn.dead) continue;
      const rig = view.group.children[i]!;
      const top = crest(rig);
      const mark = part(rig, 'mark');
      const who = `${pawn.animal}${calves.has(pawn.id) ? ' calf' : ''}`;
      expect(mark.position.y, `${who}'s marker clears the top of it`).toBeGreaterThan(top);
      expect(mark.position.y - top, `${who}'s marker hangs close over it`).toBeLessThan(0.3);
      gaps.push(mark.position.y - top);
      kinds.add(who);
    }
    expect(kinds.size, 'every species and every calf carries one').toBeGreaterThanOrEqual(8);
    expect(
      Math.max(...gaps) - Math.min(...gaps),
      'a brambletail calf gets as much air over it as a grown mossback',
    ).toBeLessThan(0.01);
    view.dispose();
  });
});

/**
 * What a Picky is made of.
 *
 * The same pass took the goblins from boxes and cones to capsules and leaves,
 * and they have their own view, their own trot and their own scale, so none of
 * the settler checks above ever look at one. The three things that pass can
 * break silently are the same three: a faceted part among smooth ones, a rig
 * that outgrows its budget — there are six of them at most, and they were
 * allowed twelve hundred triangles each — and a sole that hovers, which at
 * knee height is a body standing on nothing.
 */
describe('what a Picky is made of', () => {
  /** One fully-grown Picky, mid-stride at phase zero: legs straight, no bounce. */
  function goblin(): { view: PickiesView; rig: THREE.Group } {
    const world = createWorld(SEED);
    const picky = summonPicky(world, { kind: 'reach', x: 1, y: 1 })!;
    expect(picky, 'the map has somewhere for a Picky to stand').toBeTruthy();
    // Born a full pop ago, so the arrival has finished playing and the body is
    // at its true size rather than a sliver of it lifting off the ground.
    picky.born = world.tick - POOF_TICKS;
    const view = new PickiesView();
    view.onTick(world);
    view.sync(world, 0);
    expect(view.group.children).toHaveLength(1);
    return { view, rig: view.group.children[0] as THREE.Group };
  }

  /** Every mesh under a rig that would actually be drawn. */
  function drawn(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible) out.push(o);
    });
    return out;
  }

  const triangles = (m: THREE.Mesh): number =>
    (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;

  it('is smooth all over and stays under twelve hundred triangles', () => {
    const { view, rig } = goblin();
    let total = 0;
    for (const m of drawn(rig)) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        expect((mat as THREE.MeshStandardMaterial).flatShading ?? false, `${m.name} ${mat.type}`).toBe(false);
      }
      total += triangles(m);
    }
    expect(total).toBeLessThanOrEqual(1200);
    view.dispose();
  });

  it('stands on the floor with its legs hung from the hip — no sole hovers, no hip is inside a knee', () => {
    const { view, rig } = goblin();
    const box = new THREE.Box3();
    // The leg's reach is the hip's height: with the leg straight the sole is on
    // the ground, and the joint end sits above the pivot, inside the torso, so
    // the swing never opens a gap. The first capsules took the proud end out of
    // the reach and every Picky stood three centimetres in the air.
    const legs = drawn(rig).filter((m) => m.name === 'leg');
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      leg.geometry.computeBoundingBox();
      box.copy(leg.geometry.boundingBox!);
      expect(box.max.y, 'joint end proud of the pivot').toBeGreaterThan(0);
      expect(box.min.y, 'leg reaches the floor').toBeCloseTo(-leg.position.y, 6);
    }
    box.setFromObject(rig);
    const sole = box.min.y - rig.position.y;
    expect(sole).toBeGreaterThan(-0.005);
    expect(sole).toBeLessThan(0.005);
    view.dispose();
  });

  it('lets go of every buffer it made when it is torn down — a Picky pops, and so must its geometry', () => {
    const { view, rig } = goblin();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const m of drawn(rig)) {
      geometries.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
    }
    const freed = new Set<object>();
    for (const o of [...geometries, ...materials]) {
      const real = o.dispose.bind(o);
      o.dispose = () => {
        freed.add(o);
        real();
      };
    }
    view.dispose();
    for (const o of geometries) expect(freed.has(o), `geometry ${o.type}`).toBe(true);
    for (const o of materials) expect(freed.has(o), `material ${o.type}`).toBe(true);
  });
});

