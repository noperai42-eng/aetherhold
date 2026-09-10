/**
 * Sky, sun, moon, stars and every light in the world — one coupled system, because
 * sky colour, light colour, fog and exposure only look right when they move
 * together. Everything here is driven by `clock.ts`, so the same tick produces the
 * same light in the manager view and in first person.
 */

import * as THREE from 'three';

import {
  HORIZON_DAY,
  HORIZON_NIGHT,
  HORIZON_WARM,
  MOON,
  OVERCAST_DAY,
  SKY_DAY,
  SKY_DUSK,
  SKY_NIGHT,
  SUN_DAY,
  SUN_DUSK,
} from './palette';
import { daylight, sunAzimuth, sunElevation, timeOfDay } from '../../sim/clock';
import { cloudiness, strikeFlash, visibility } from '../../sim/weather';
import type { QualitySettings } from './renderer';
import type { World } from '../../sim/types';

/**
 * Inside the first-person camera's far plane (400), not on it. The dome is
 * centred on the viewer, so at 400 every vertex of it sat exactly at the clip
 * distance and survived only because the faces between them are chords, a little
 * nearer than the sphere they approximate. The disc and stars are at 300 and 340
 * and have to stay inside it.
 */
const SKY_RADIUS = 360;
const WHITE = new THREE.Color(0xffffff);

/**
 * The renderer's exposure, which this file has to know because the dome and the
 * rain write `gl_FragColor` themselves and so carry their own copy of the
 * frame's tail. It is set on the one `WebGLRenderer` in `renderer.ts`, and
 * `tests/lighting.test.ts` reads both files and fails if the two ever disagree,
 * because a shader that tone maps at the wrong exposure looks like a colour the
 * artist chose rather than like a bug.
 */
export const TONE_EXPOSURE = 1.3;

/**
 * The two matrices ACES runs a colour through, inverted once at load.
 *
 * These are three's own, copied out of `tonemapping_pars_fragment` — the very
 * chunk the fragment shader will use on the way out — so a reader can check them
 * against it a line at a time. They look transposed against that chunk because
 * `Matrix3.set` takes rows where GLSL's `mat3` constructor takes columns.
 * Inverting them here rather than pasting a hand-computed inverse keeps the only
 * ACES numbers in this file three's numbers.
 */
const ACES_IN_INV = new THREE.Matrix3()
  .set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777)
  .invert();
const ACES_OUT_INV = new THREE.Matrix3()
  .set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602)
  .invert();

/**
 * The most radiance a sky colour is ever asked for. ACES flattens as it nears
 * white, so the light behind a white pixel is unbounded: a lightning flash asks
 * for about twelve, and the exact white the curve only approaches would ask for
 * infinity. Anything at or above this is the same white on the screen.
 */
const RADIANCE_CEILING = 64;

/** ACES's rational fit, run backwards — the quadratic it turns into. See `radianceFor`. */
function unfit(y: number): number {
  const a = 1 - 0.983729 * y;
  const b = 0.0245786 - 0.432951 * y;
  const c = -(0.000090537 + 0.238081 * y);
  if (a <= 1e-6) return RADIANCE_CEILING;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return 0;
  return Math.max(0, (-b + Math.sqrt(disc)) / (2 * a));
}

const RADIANCE_SCRATCH = new THREE.Vector3();

/**
 * The light that has to arrive for the frame to *show* this colour: the tone
 * curve and the sRGB encode, run backwards.
 *
 * Everything else in the game hands the renderer an albedo and lets three's own
 * fragment tail decide what reaches the screen — ACES at `TONE_EXPOSURE`, then
 * the encode into the sRGB framebuffer. The dome and the precipitation write
 * `gl_FragColor` themselves, and until now they wrote it and stopped: their
 * linear values went into that framebuffer with no encode at all and were shown
 * as though they had already had one. That is not a subtle error and it is not a
 * guess. In `.look/shots/r9b/r9b-4-firstperson.png` the sky runs from 0x567ba3
 * at the top of the frame to about 0x99acbb where the ground cuts it off, and
 * the palette's own hexes for those two ends are 0x7fa6c9 and 0xcfdce6 — nowhere
 * near. What the photograph is showing is those hexes' *linear* components,
 * 0x366194 and 0x9fb7ca, printed straight out as pixels. Read one of them off:
 * the pixel twenty degrees above the horizon measures (110, 142, 176) and the
 * gradient's arithmetic for twenty degrees comes to (110, 142, 177).
 *
 * So the palette's sky colours are not radiances and never were. They are the
 * pixels the sky came out as, tuned by eye against a dome with no tail on it.
 * Now that the dome has the tail, handing it those same numbers would light the
 * sky far too brightly — `SKY_DAY` alone would go from (54, 97, 149) to
 * (168, 196, 215), a deep blue turning to milk. This converts instead: it reads
 * the palette colour as the pixel it is and returns the light that lands on that
 * pixel once the frame's tail has had it. The sky keeps the colour it was
 * photographed with, and it keeps it *in the frame's own space*, which is the
 * point — the fog it has to match, the sun disc drawn on it and the rain drawn
 * through it are all finally the same arithmetic.
 *
 * Writes into `out` and returns it. `sync` runs every frame and must not litter.
 */
export function radianceFor(look: THREE.Color, out: THREE.Color): THREE.Color {
  // The palette colour's components *are* the pixel, so read them as one: the
  // sRGB code values they were tuned as, decoded to the light that pixel emits.
  out.setRGB(look.r, look.g, look.b, THREE.SRGBColorSpace);
  const v = RADIANCE_SCRATCH.set(out.r, out.g, out.b).applyMatrix3(ACES_OUT_INV);
  v.set(unfit(v.x), unfit(v.y), unfit(v.z))
    .applyMatrix3(ACES_IN_INV)
    .multiplyScalar(0.6 / TONE_EXPOSURE);
  return out.setRGB(
    Math.min(RADIANCE_CEILING, Math.max(0, v.x)),
    Math.min(RADIANCE_CEILING, Math.max(0, v.y)),
    Math.min(RADIANCE_CEILING, Math.max(0, v.z)),
    THREE.LinearSRGBColorSpace,
  );
}

/**
 * What the sky bounce lerps toward by day where it lights shade. The dome's
 * own blue is right for the dome, but as the colour of every surface the sun
 * cannot reach it is too grey to read as sky: a shadow lit by it and by the warm
 * ground bounce averages to neutral. A cooler, more saturated blue here is what
 * makes a shadow read as a shadow of a sunny day rather than as a dim patch.
 */
const SHADE_BLUE = new THREE.Color(0x6a92cf);
/** Point lights are expensive; only the nearest few lamps and fires get one. */
const MAX_POINT_LIGHTS = 7;

/**
 * The dome is centred on the player and never rotated, so a vertex's object-space
 * position *is* its direction from the viewer. It used to be read back out of
 * world space, which quietly folded the dome's offset into the gradient: on a
 * 192-wide map the horizon sat a few degrees lower on one side of the sky than
 * the other and drifted as the camera panned.
 */
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

/**
 * Three things on top of the gradient, all cheap — a few `pow`s per fragment
 * of a 24×16 dome, no post-processing. A haze band just above the horizon, so
 * the sky does not run straight from sky-blue into ground colour with nothing
 * in between. A second, warmer band inside the first few degrees of that,
 * `uHorizon`, mixed in by `uBand`: this is the light cream a clear sky thins to
 * at the horizon, and it is what stops the dome being one colour from eye level
 * — `uBand` is the mix at the horizon itself, which is exactly the colour the
 * fog has to be (see `fogColor`). And the glow around the sun, in three widths.
 * The corona is a few degrees across and softens the drawn disc's edge into the
 * sky; the halo is the tens of degrees the eye reads as "the sky is lit by
 * this", wide enough that at noon, with the sun 52° up and out of a level
 * first-person frame, the top of that frame still brightens toward it; the
 * bloom is the whole quadrant lifting toward the sun's colour. Tight and pale
 * at noon, wide and warm as it goes down.
 *
 * The two chunks at the end are the frame's tail, and they are not optional: a
 * shader that writes `gl_FragColor` and stops has opted out of the tone curve
 * and the sRGB encode that every other surface in the scene goes through, which
 * leaves the sky in a different colour space from the colony standing in front
 * of it. The uniforms arrive as radiance (see `radianceFor`) precisely so that
 * these two lines can be here. Order matters — tone map, then encode.
 */
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uHorizon;
  uniform float uBand;
  uniform float uExponent;
  uniform vec3 uSunDir;
  uniform vec3 uGlow;
  uniform float uGlowStrength;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float t = pow(max(h, 0.0), uExponent);
    vec3 col = mix(uBottom, uTop, t);
    float haze = exp(-max(h, 0.0) * 9.0) * 0.35;
    col = mix(col, uBottom, haze);
    float band = exp(-max(h, 0.0) * 12.0);
    col = mix(col, uHorizon, band * uBand);
    float s = max(dot(d, uSunDir), 0.0);
    float corona = pow(s, 320.0) * 0.9;
    float halo = pow(s, 24.0) * 0.5 + pow(s, 5.0) * 0.22;
    float bloom = pow(s, 1.5) * 0.12;
    col = mix(col, uGlow, min(1.0, (corona + halo + bloom) * uGlowStrength));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The softest a shadow ever gets. Below this the colony reads as unlit, not shaded.
 *
 * What the eye reads is not this number, it is this number times the sun's share
 * of the light falling on the cell — a shadow can only take away what the sun was
 * putting there. It was 0.38, chosen when the low sun was worth a fifth of the
 * light on open ground: 0.38 × 0.21 is eight per cent, and eight per cent, once
 * ACES has had it, is nothing at all. Measured at 17:24 on the dusk frame, a
 * shadowed cell kept 92% of the light of the grass beside it, which is why a wall
 * two and a half metres tall threw nothing across that grass.
 *
 * The share is fixed below and the floor moves with it. The guard that matters is
 * still the one the black-wedge photograph set — a long shadow must leave at least
 * 60% of the light — and the product now takes 37% of it at sixteen degrees and
 * 32% at eight, where it used to take 16% and 8%. That guard is what caps the
 * floor: 0.59 is the most that clears it at sixteen degrees with room to spare.
 * See `tests/lighting.test.ts`, "what a shadow leaves you".
 */
export const SHADOW_FLOOR = 0.59;
/** Elevation below which the sun is treated as grazing, in radians (~3.4°). */
const GRAZING = 0.06;

/**
 * How hard the sun's shadows land, 0 (none) .. 1 (full), from its elevation.
 *
 * Keyed on shadow *length* — `1/tan(elevation)` — rather than on elevation or
 * daylight, because length is the thing that decides whether a shadow trims a
 * building or buries a colony. Full strength from about 45° up, fading to the
 * floor by about 20°, which on this clock is the first and last two hours of
 * daylight. See the call site for the photograph that set the numbers.
 *
 * Takes `|elev|` so the night half comes out right too: the moon is placed on the
 * opposite side of the sky, so a sun 40° below the horizon is a moon 40° above it.
 */
export function shadowStrength(elev: number): number {
  const len = 1 / Math.tan(Math.max(GRAZING, Math.abs(elev)));
  return Math.max(SHADOW_FLOOR, Math.min(1, 1.25 - len * 0.3));
}

/** Half the width of the sun's shadow frustum, in cells, either side of the focus. */
const SHADOW_HALF = 26;

/**
 * How far along its normal a surface is pushed before it looks the shadow map up,
 * for a map of this many texels across.
 *
 * Shadow acne is a surface shadowing itself because its depth and the map's
 * disagree by less than one texel, and it is worst exactly where the surface is
 * smooth: a flat wall is either in or out of one texel, a bevel or a capsule
 * grazes through dozens of them. The cure is to step the lookup one texel or so
 * off the surface, which has to be *in world units*, so it has to scale with the
 * texel — the 0.03 that was tuned by eye against the 2048 map is a hair over one
 * of its texels, and was left in place when the map halved at medium quality,
 * which is where the stripes on the round things came from.
 */
export function shadowNormalBias(mapSize: number): number {
  return ((SHADOW_HALF * 2) / mapSize) * 1.2;
}

/**
 * How brightly the environment map lights the colony, 0 .. 1, from daylight and
 * cloud. It is the only light that comes from every direction at once, so it is
 * the one that would flatten a night if it were left at a daytime level: three
 * tenths by day, which is enough to put a highlight on a bevel and not enough
 * to fill a shadow, falling to a trace after dark so the moon still has a face
 * to glint off. Cloud pulls it down too — the room's light is a small bright
 * source, and a small bright source is the one thing an overcast sky lacks.
 *
 * Squared in daylight rather than linear, and for the same reason the ambient
 * floor below is cubed: half a day's light is not half a day's *sky*, and an
 * omnidirectional term held up through the evening is the one that quietly
 * cancels a low sun. Noon and midnight are exactly where they were; the hour
 * before sundown gets nine hundredths instead of sixteen.
 */
export function environmentStrength(day: number, cloud: number): number {
  return (0.05 + day * day * 0.3) * (1 - cloud * 0.4);
}

export class SkyView {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  /**
   * Skylight, standing in for the light the sky throws back from the other side.
   * It casts no shadow and is deliberately weak, but without it every surface the
   * sun cannot reach falls to whatever ambient is left, which is not enough to
   * see by — a wall in shade reads as a hole in the world.
   */
  readonly fill: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly sunDisc: THREE.Mesh;
  private readonly moonDisc: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly lamps: THREE.PointLight[] = [];
  private readonly skyTop = new THREE.Color();
  private readonly skyBottom = new THREE.Color();
  /** The warm band at the horizon, and the colour the dome actually shows there. */
  private readonly horizon = new THREE.Color();
  private readonly fogCol = new THREE.Color();
  private readonly overcast = new THREE.Color();
  private readonly lightCol = new THREE.Color();
  private readonly glowCol = new THREE.Color();

  constructor(world: World, settings: QualitySettings) {
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(SKY_DAY) },
        uBottom: { value: new THREE.Color(HORIZON_DAY) },
        uHorizon: { value: new THREE.Color(HORIZON_WARM) },
        uBand: { value: 0 },
        uExponent: { value: 0.7 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uGlow: { value: new THREE.Color(SUN_DAY) },
        uGlowStrength: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 16), this.domeMat);
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    this.sun = new THREE.DirectionalLight(SUN_DAY.getHex(), 2.1);
    this.sun.castShadow = settings.shadows;
    this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 160;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = shadowNormalBias(settings.shadowMapSize);
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0xbcd2ea, 0.5);
    this.fill.castShadow = false;
    this.group.add(this.fill);
    this.group.add(this.fill.target);

    // The ground half is a warm bounce off dirt and grass, not a black floor:
    // it is the only light reaching the undersides of things.
    this.hemi = new THREE.HemisphereLight(SKY_DAY.getHex(), 0x5a4c34, 0.55);
    this.group.add(this.hemi);
    // The floor under every other light. Cool and blue so that what it alone
    // lights reads as night rather than as an unlit surface. Measured on the
    // real renderer: the intensity barely moves the picture on its own — it is
    // this colour, once converted to linear, that decides how dark night gets.
    // Nudged bluer at the same luminance: by day it is a third of what a shadow
    // gets, and a shadow should be the cool thing in a picture with a warm key.
    this.ambient = new THREE.AmbientLight(0x47608c, 0.35);
    this.group.add(this.ambient);

    // Eleven at three hundred is a disc a little over four degrees across —
    // eight times the real sun, which is the size that reads as a sun from a
    // game camera rather than as a stray bright pixel. Its hard edge is
    // softened by the dome's corona, which is centred on the same direction.
    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(11, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3d2, fog: false }),
    );
    this.sunDisc.frustumCulled = false;
    this.group.add(this.sunDisc);

    this.moonDisc = new THREE.Mesh(
      new THREE.SphereGeometry(6, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xd8e4f4, fog: false }),
    );
    this.moonDisc.frustumCulled = false;
    this.group.add(this.moonDisc);

    this.stars = makeStars();
    this.group.add(this.stars);

    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffb765, 0, 9, 2);
      l.visible = false;
      this.lamps.push(l);
      this.group.add(l);
    }

    this.sync(world, world.width / 2, world.height / 2);
  }

  applyQuality(settings: QualitySettings): void {
    this.sun.castShadow = settings.shadows;
    this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    // The bias is sized in texels, and the texel just changed size with the map.
    this.sun.shadow.normalBias = shadowNormalBias(settings.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /**
   * `focusX/focusY` is where the player is looking from — the shadow frustum and the
   * sky dome follow it so a 192×192 map still gets crisp shadows from one light.
   */
  sync(world: World, focusX: number, focusY: number): void {
    const day = daylight(world);
    const elev = sunElevation(world);
    const azi = sunAzimuth(world);
    const t = timeOfDay(world);
    const cloud = cloudiness(world);
    const flash = strikeFlash(world);

    // Dusk and dawn get their own colour, strongest as the sun crosses the horizon.
    const twilight = Math.max(0, 1 - Math.abs(elev) * 3.4);
    this.skyTop.copy(SKY_NIGHT).lerp(SKY_DAY, day).lerp(SKY_DUSK, twilight * 0.45);
    this.skyBottom.copy(HORIZON_NIGHT).lerp(HORIZON_DAY, day).lerp(SKY_DUSK, twilight * 0.75);
    // Overcast pulls the whole dome toward a flat grey. Toward, not to: a storm
    // at noon still has to read as noon, or the clock stops meaning anything.
    if (cloud > 0) {
      this.overcast.copy(OVERCAST_DAY).multiplyScalar(0.16 + day * 0.56);
      this.skyTop.lerp(this.overcast, cloud * 0.92);
      this.skyBottom.lerp(this.overcast, cloud * 0.72);
    }
    // Lightning: a whole-sky flash, brief enough to startle and short enough that
    // it never leaves the colony washed out. Both views see the same frames of it.
    if (flash > 0) {
      this.skyTop.lerp(WHITE, flash * 0.75);
      this.skyBottom.lerp(WHITE, flash * 0.6);
    }
    // The warm band at the horizon: cream by day, the dusk colour as the sun
    // crosses, and nothing after dark — a warm horizon at midnight is a city
    // over the hill. Cloud takes it away too, since it is the low sun's light
    // through clear air that makes it. `band` is the mix at the horizon itself.
    this.horizon.copy(HORIZON_NIGHT).lerp(HORIZON_WARM, day).lerp(SKY_DUSK, twilight * 0.6);
    if (cloud > 0) this.horizon.lerp(this.overcast, cloud * 0.8);
    if (flash > 0) this.horizon.lerp(WHITE, flash * 0.6);
    const band = (0.1 + day * 0.55) * (1 - cloud * 0.7);
    // Every mix above happened in the colours the palette names, which is where
    // they were tuned — an hour is two thirds of the way to dusk on the swatch,
    // not on the sensor. The conversion to radiance is the last step before the
    // shader, so the gradient keeps the shape it was photographed with.
    radianceFor(this.skyTop, this.domeMat.uniforms.uTop!.value as THREE.Color);
    const bottom = radianceFor(this.skyBottom, this.domeMat.uniforms.uBottom!.value as THREE.Color);
    const warm = radianceFor(this.horizon, this.domeMat.uniforms.uHorizon!.value as THREE.Color);
    this.domeMat.uniforms.uBand!.value = band;
    // What the dome shows where it meets the ground, which is what the fog has
    // to be: the same mix the shader makes at h = 0, off the same two uniforms.
    //
    // Taken from the converted pair rather than from the palette pair, because
    // `THREE.Fog`'s colour is mixed into a surface *before* three's tail runs on
    // it — it is radiance, exactly as the dome's uniforms now are. It was not,
    // and the two could not agree on screen at any tuning: at noon both sides
    // held the same number and the dome drew it as (199, 192, 175) while a fully
    // fogged surface an inch in front of it drew it as (227, 226, 223), a warm
    // haze against a neutral one with a seam down the middle.
    this.fogCol.copy(bottom).lerp(warm, band);
    this.dome.position.set(focusX, 0, focusY);

    const up = Math.max(0, Math.sin(elev + 0.02));
    const dir = new THREE.Vector3(Math.cos(azi) * Math.cos(elev), Math.sin(elev), Math.sin(azi) * Math.cos(elev));

    // The glow around the sun: warm and wide through twilight, pale and tight
    // by noon, and gone once the sun is well below the horizon or behind cloud.
    // The disc itself is drawn separately; this is the sky around it.
    (this.domeMat.uniforms.uSunDir!.value as THREE.Vector3).copy(dir);
    this.glowCol.copy(SUN_DAY).lerp(SUN_DUSK, twilight);
    // The corona is where the old path came closest to right and still missed.
    // `SUN_DAY`'s red is already at the top of the range, so writing it raw put
    // 255 on the screen and looked correct; its green and blue went in as 0.855
    // and 0.578 and came out as 218 and 147, where the palette asks for 238 and
    // 200. A white-hot sun with an orange cast, and the drawn disc — an ordinary
    // material, so tone mapped like everything else — sitting in the middle of
    // it. It costs 2.02 in red to put that corona back, which is why the
    // conversion has to allow a value above one at all.
    radianceFor(this.glowCol, this.domeMat.uniforms.uGlow!.value as THREE.Color);
    const glowUp = Math.max(0, Math.min(1, (elev + 0.12) / 0.2));
    this.domeMat.uniforms.uGlowStrength!.value = glowUp * (0.7 + twilight * 0.9) * (1 - cloud * 0.85);

    // The environment map is the renderer's, but the hour is the sky's, and the
    // scene this rig hangs in is the scene whose environment that map is. Set
    // here rather than in the view so that the one file that decides how bright
    // the world is at 03:00 is still this one. Nothing to do until the rig has
    // been hung, which is how the lighting tests run it.
    const scene = this.group.parent;
    if (scene instanceof THREE.Scene) scene.environmentIntensity = environmentStrength(day, cloud);

    // How hard the sun's shadows land, as a function of how long they are.
    //
    // Shadow length runs as 1/tan(elevation), so it is not linear in anything
    // else here: at midday a wall darkens the cell beside it, and at eight in the
    // morning the treeline west of the colony throws thirteen cells of shadow
    // straight across the yard. Photographed at 07:20 on seed 20260729, the whole
    // inside of the cabin was a black wedge with a razor edge through it and the
    // settlers in it were silhouettes — for a quarter of every day, over the one
    // part of the map the player never stops looking at.
    //
    // Nothing about the light rig was wrong; the sky half of it still puts 56% of
    // the open-ground irradiance into that shadow. It is the *shadow map* that is
    // absolute, and a physically correct shadow that covers everything you own is
    // an unplayable one. So the shadow's own strength falls with the sun: crisp
    // and full while shadows are short and carve shape into the colony, softened
    // to a wash once they are long enough to swallow it. They never switch off —
    // a colony with no shadows at all reads as flat, which is the bug on the other
    // side of this one.
    this.sun.shadow.intensity = shadowStrength(elev);

    if (elev > -0.05) {
      // How much of the sun is left, and what colour it has gone.
      //
      // The strength used to be `up` itself, the sine of the elevation. That is
      // the right factor for how much of the sun a *horizontal* surface catches,
      // and the shading maths already applies it: using it here as well applied
      // it twice, and the sun at eight degrees came out worth a fifth of the
      // light on open ground (0.207 of it, measured at 17:24) with the hemisphere
      // and the ambient floor supplying the other four fifths. A key light worth
      // a fifth is not a key light, and it casts a shadow nobody can see.
      //
      // Air does not work that way round. It takes the low sun's blue long before
      // it takes its power: an hour before sundown the sun is still the brightest
      // thing in the sky by a wide margin, and it has gone orange. So the strength
      // falls slowly — a fifth root of the sine, near flat until the last degrees
      // — and the *colour* carries the hour. `up` never reaches 1, since the sun
      // no longer climbs to the zenith, so the coefficient is set to leave noon
      // exactly where it was photographed.
      //
      // Cloud takes most of the direct sun away — which is precisely what makes
      // an overcast colony read as flat, so the ambient below is raised to match.
      const key = Math.pow(up, 0.2);
      this.sun.intensity = (0.15 + key * 2.536) * (1 - cloud * 0.78);
      // And the colour holds the dusk end far longer than it did. The old mix
      // reached halfway to daylight by six degrees, so the one hour of the day
      // with a colour of its own spent it looking like a slightly dim noon.
      this.lightCol.copy(SUN_DUSK).lerp(SUN_DAY, Math.min(1, Math.max(0, (up - 0.1) / 0.62)));
      this.sun.color.copy(this.lightCol).lerp(WHITE, cloud * 0.5);
    } else {
      // Moonlight: dim, cold, and coming from the opposite side of the sky. Dim
      // enough that lamps matter, bright enough that the map is still readable —
      // a colony you cannot see at all is not atmospheric, it is unplayable.
      dir.set(-dir.x, Math.max(0.35, -dir.y), -dir.z);
      this.sun.color.copy(MOON);
      this.sun.intensity = 0.7 * (1 - cloud * 0.6);
    }

    this.sun.position.set(focusX + dir.x * 60, dir.y * 60 + 6, focusY + dir.z * 60);
    this.sun.target.position.set(focusX, 0, focusY);
    this.sun.target.updateMatrixWorld();

    // Opposite side of the sky and low down, so it rakes exactly the faces the
    // sun is missing and adds almost nothing to ground already facing the sun.
    const fillAzi = azi + Math.PI;
    this.fill.position.set(focusX + Math.cos(fillAzi) * 44, 20, focusY + Math.sin(fillAzi) * 44);
    this.fill.target.position.set(focusX, 0, focusY);
    this.fill.target.updateMatrixWorld();
    // Cooled back off the twilight tint that `skyTop` carries. The fill stands on
    // the opposite side of the sky from the sun, and at sundown that half of the
    // sky is the blue one — a fill that goes orange with the sunset is a second
    // sun behind you, and it cancels exactly the warm-against-cool split the
    // evening is made of.
    this.fill.color.copy(this.skyTop).lerp(SHADE_BLUE, twilight * 0.5).lerp(WHITE, 0.45);
    // Overcast is all fill and no sun: the light stops coming from one place and
    // starts coming from the whole sky, so the fill takes over what the sun lost.
    //
    // But only while there is a sun to scatter. Cloud after dark has nothing to
    // spread around and simply shuts the moon out, so the same factor has to go
    // negative at night — otherwise a midnight storm renders brighter than a
    // clear midnight, which is exactly backwards.
    const cloudLift = 1 + cloud * (day * 1.15 - 0.3);
    // And all three sky terms step back together in the last degrees before
    // sundown.
    //
    // `twilight` is the only factor in this file concentrated exactly there — one
    // at the horizon, gone by seventeen degrees — and those are the degrees where
    // the arithmetic goes wrong. A sun eight degrees up puts little on flat
    // ground no matter how strong it is, because the ground is nearly edge-on to
    // it; the sky terms, sized for the rest of the day, then supply most of what
    // lands there, and a shadow can only take away what the sun was putting.
    // Two thirds of them at eight degrees, and within three per cent of untouched
    // by sixteen, so the morning the black-wedge photograph was taken in is not
    // disturbed. Midday and midnight are outside the window entirely.
    const lowSun = 1 - twilight * 0.62;
    this.fill.intensity = (0.06 + day * 0.62) * cloudLift * lowSun;

    // At night the sky tint is nearly black, and a hemisphere light that colour
    // contributes nothing. Lerping it toward white as the day fades keeps the
    // sky half of the bounce alive after dark without washing out midday. By
    // day it goes the other way, toward a cooler blue than the dome's: this is
    // the light in every shadow, and it is the key's warmth against this that
    // makes noon read as sunlit rather than as evenly grey.
    //
    // Squared, though, because it is a night rescue and the evening is not night:
    // held linear it lifted the sky bounce a quarter of the way to white with the
    // sun still up, which is a second ambient term in the one hour that most needs
    // the sun to be doing the work. Midnight and midday are untouched by the change.
    const lateLift = (1 - day) * (1 - day) * 0.4;
    this.hemi.color.copy(this.skyTop).lerp(SHADE_BLUE, day * 0.5).lerp(WHITE, lateLift);
    this.hemi.intensity = (0.24 + day * 0.62) * Math.max(0.6, cloudLift * 0.85) * lowSun;

    // Ambient is the readability floor and works in the opposite direction to
    // everything else: strongest at night, when it is nearly all there is, and
    // pulled back at midday so the sun still carves shape into the colony. Cloud
    // and lightning both push it back up — the point of an overcast day is soft
    // light everywhere, not a dark colony.
    //
    // Cubed in the dark rather than linear in the daylight, which is the same two
    // endpoints and a completely different evening. Linear, it was already at
    // 1.49 with the sun eight degrees up and still worth 0.72 — the floor built
    // for a moonless colony was outshouting the sun two to one, from every
    // direction at once, and that is what made the dusk frame read as an
    // overcast noon. Cubed it is 0.77 there and unchanged at both ends of the day.
    const dark = 1 - day;
    this.ambient.intensity = (0.3 + 1.9 * dark * dark * dark) * Math.max(0.62, cloudLift) * lowSun + flash * 1.6;

    this.sunDisc.position.set(
      focusX + Math.cos(azi) * Math.cos(elev) * 300,
      Math.sin(elev) * 300,
      focusY + Math.sin(azi) * Math.cos(elev) * 300,
    );
    this.sunDisc.visible = elev > -0.12;
    const mAzi = azi + Math.PI;
    const mElev = -elev;
    this.moonDisc.position.set(
      focusX + Math.cos(mAzi) * Math.cos(mElev) * 300,
      Math.sin(mElev) * 300,
      focusY + Math.sin(mAzi) * Math.cos(mElev) * 300,
    );
    this.moonDisc.visible = mElev > -0.12;

    const starMat = this.stars.material as THREE.PointsMaterial;
    starMat.opacity = Math.max(0, 1 - day * 2.6);
    this.stars.visible = starMat.opacity > 0.01;
    this.stars.position.set(focusX, 0, focusY);
    this.stars.rotation.y = t * Math.PI * 2 * 0.25;

    this.syncPointLights(world, focusX, focusY, day);
  }

  /** Lamps light up at night; fires always do. Nearest to the player wins the slot. */
  private syncPointLights(world: World, focusX: number, focusY: number, day: number): void {
    const cands: { x: number; y: number; z: number; intensity: number; color: number; range: number }[] = [];
    const lampOn = Math.max(0, 1 - day * 1.8);
    if (lampOn > 0.02) {
      for (const b of world.buildings) {
        // Powered lamps only. The grid going short is meant to be something you
        // notice as the room going dark, not something you read in the log.
        if (b.kind !== 'lamp' || !b.built || b.powered !== true) continue;
        cands.push({ x: b.x, y: b.y, z: 1.62, intensity: 6.5 * lampOn, color: 0xffb765, range: 9 });
      }
    }
    // A lit campfire, day or night. It is not lighting because it is dark, it is
    // lighting because it is on fire — and a room with a fire in it should look
    // like one from the doorway at noon as well as at midnight.
    for (const b of world.buildings) {
      if (b.kind !== 'campfire' || !b.built || (b.fuel ?? 0) <= 0) continue;
      const flick = 1 + Math.sin(world.tick * 0.29 + b.id) * 0.12;
      cands.push({ x: b.x, y: b.y, z: 0.55, intensity: 5.2 * flick, color: 0xff8a3a, range: 8 });
    }
    for (const f of world.fires) {
      cands.push({ x: f.x, y: f.y, z: 0.5, intensity: 3 + f.size * 7, color: 0xff7a2a, range: 7 });
    }
    cands.sort(
      (a, b) =>
        (a.x - focusX) ** 2 + (a.y - focusY) ** 2 - ((b.x - focusX) ** 2 + (b.y - focusY) ** 2),
    );
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i]!;
      const c = cands[i];
      if (!c) {
        l.visible = false;
        continue;
      }
      l.visible = true;
      l.position.set(c.x, c.z, c.y);
      l.intensity = c.intensity;
      l.color.setHex(c.color);
      l.distance = c.range;
    }
  }

  /**
   * Fog matches the horizon so the map edge dissolves instead of ending. The
   * horizon, not the lower sky: the dome shows `skyBottom` mixed with the warm
   * band where it meets the ground, and fog of the plain lower-sky colour would
   * put a cool grey seam between the last cells and the sky behind them.
   */
  fogColor(): THREE.Color {
    return this.fogCol;
  }

  /**
   * How far you can see, in world units.
   *
   * Clear weather fades out past the far corner of the map, so fog is scenery
   * rather than an obstruction: whatever the manager camera can frame at full
   * zoom-out, it can also see. That used to be the flat 130 that a 64×64 map
   * made true by accident, and on a wider map it stopped being true without
   * anything looking broken — the colony still read fine, and the frontier the
   * scouts walk to sat under a grey wash at the edge of the screen.
   *
   * Thick fog pulls it in to about a third of that regardless of map size, which
   * is close enough to hide the treeline and make a raid genuinely harder to
   * read, and still far enough that a possessed settler can see where they are
   * walking.
   */
  fogRange(world: World): { near: number; far: number } {
    const vis = visibility(world);
    const reach = Math.max(130, Math.hypot(world.width, world.height) * 1.25);
    return { near: 8 + 32 * vis, far: 34 + (reach - 34) * vis };
  }

  /**
   * Settle a scene's fog on this sky.
   *
   * Both of the things that put this game on a screen have to do it — the world
   * view every frame, the forge bench once per model — because `Viewport`'s
   * constructor leaves a fixed slate-blue fog in the scene for whoever draws
   * into it to overwrite, and a caller that never overwrites it photographs noon
   * against a distance hazing toward night. It is one call rather than the same
   * four lines in two files for the reason the bench may not build its own
   * assemblies: a bench keeping its own copy of the game's lighting is a bench
   * whose frames are not the game's frames.
   *
   * After `sync`, which is what works the colour and the visibility out.
   */
  applyFog(fog: THREE.Fog, world: World): void {
    fog.color.copy(this.fogCol);
    const range = this.fogRange(world);
    fog.near = range.near;
    fog.far = range.far;
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.sunDisc.geometry.dispose();
    (this.sunDisc.material as THREE.Material).dispose();
    this.moonDisc.geometry.dispose();
    (this.moonDisc.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    // The shadow map is the largest thing this view owns — a 2048-square depth
    // texture at high quality, next to which every geometry above is a rounding
    // error — and it was the one thing not handed back. `applyQuality` already
    // knew to drop it when the map size changes; teardown did not.
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}

function makeStars(): THREE.Points {
  const count = 420;
  const pos = new Float32Array(count * 3);
  // Deterministic scatter over the upper hemisphere — the sky is the same every night.
  for (let i = 0; i < count; i++) {
    const a = frac(Math.sin(i * 12.9898) * 43758.5453) * Math.PI * 2;
    const h = 0.08 + frac(Math.sin(i * 78.233) * 12345.6789) * 0.92;
    const r = Math.sqrt(1 - h * h);
    pos[i * 3] = Math.cos(a) * r * 340;
    pos[i * 3 + 1] = h * 340;
    pos[i * 3 + 2] = Math.sin(a) * r * 340;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xdce8ff,
    size: 2.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

function frac(n: number): number {
  return n - Math.floor(n);
}
