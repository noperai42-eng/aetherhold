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
import { SKIN_TONES } from '../src/client/render/palette';
import { HAIR_TONES, PawnsView } from '../src/client/render/pawns';
import { PickiesView } from '../src/client/render/pickies';
import { SETTLER_LEG } from '../src/client/gait';
import { POOF_TICKS, summonPicky } from '../src/sim/pickies';
import {
  SHADOW_FLOOR,
  SkyView,
  environmentStrength,
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
    view.sync(world, 0, null);
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
    const { view } = bodies();
    const box = new THREE.Box3();
    let limbs = 0;
    view.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.position.y !== SETTLER_LEG) return;
      // A leg: its own geometry's top is the pivot, and its length is the gait's.
      o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox!);
      expect(box.max.y, 'leg pivots at its top').toBeCloseTo(0, 6);
      expect(box.min.y, 'leg reaches the floor').toBeCloseTo(-SETTLER_LEG, 6);
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
    view.sync(world, 0, null);
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
