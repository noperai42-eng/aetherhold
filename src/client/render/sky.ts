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

const SKY_RADIUS = 400;
const WHITE = new THREE.Color(0xffffff);
/** Point lights are expensive; only the nearest few lamps and fires get one. */
const MAX_POINT_LIGHTS = 7;

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform float uExponent;
  varying vec3 vWorld;
  void main() {
    float h = normalize(vWorld).y;
    float t = pow(max(h, 0.0), uExponent);
    gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);
  }
`;

/** The softest a shadow ever gets. Below this the colony reads as unlit, not shaded. */
export const SHADOW_FLOOR = 0.38;
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
  private readonly overcast = new THREE.Color();
  private readonly lightCol = new THREE.Color();

  constructor(world: World, settings: QualitySettings) {
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(SKY_DAY) },
        uBottom: { value: new THREE.Color(HORIZON_DAY) },
        uExponent: { value: 0.7 },
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
    cam.left = -26;
    cam.right = 26;
    cam.top = 26;
    cam.bottom = -26;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.03;
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
    this.ambient = new THREE.AmbientLight(0x4d5f80, 0.35);
    this.group.add(this.ambient);

    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(9, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }),
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
    (this.domeMat.uniforms.uTop!.value as THREE.Color).copy(this.skyTop);
    (this.domeMat.uniforms.uBottom!.value as THREE.Color).copy(this.skyBottom);
    this.dome.position.set(focusX, 0, focusY);

    const up = Math.max(0, Math.sin(elev + 0.02));
    const dir = new THREE.Vector3(Math.cos(azi) * Math.cos(elev), Math.sin(elev), Math.sin(azi) * Math.cos(elev));

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
      this.lightCol.copy(SUN_DUSK).lerp(SUN_DAY, Math.min(1, up * 2.2));
      // The sun no longer climbs to the zenith, so `up` never reaches 1; the
      // coefficient keeps noon as bright as it was before the curve flattened.
      // Cloud takes most of the direct sun away — which is precisely what makes
      // an overcast colony read as flat, so the ambient below is raised to match.
      this.sun.intensity = (0.25 + up * 2.9) * (1 - cloud * 0.78);
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
    this.fill.color.copy(this.skyTop).lerp(WHITE, 0.45);
    // Overcast is all fill and no sun: the light stops coming from one place and
    // starts coming from the whole sky, so the fill takes over what the sun lost.
    //
    // But only while there is a sun to scatter. Cloud after dark has nothing to
    // spread around and simply shuts the moon out, so the same factor has to go
    // negative at night — otherwise a midnight storm renders brighter than a
    // clear midnight, which is exactly backwards.
    const cloudLift = 1 + cloud * (day * 1.15 - 0.3);
    this.fill.intensity = (0.06 + day * 0.62) * cloudLift;

    // At night the sky tint is nearly black, and a hemisphere light that colour
    // contributes nothing. Lerping it toward white as the day fades keeps the
    // sky half of the bounce alive after dark without washing out midday.
    this.hemi.color.copy(this.skyTop).lerp(WHITE, (1 - day) * 0.4);
    this.hemi.intensity = (0.24 + day * 0.62) * Math.max(0.6, cloudLift * 0.85);

    // Ambient is the readability floor and works in the opposite direction to
    // everything else: strongest at night, when it is nearly all there is, and
    // pulled back at midday so the sun still carves shape into the colony. Cloud
    // and lightning both push it back up — the point of an overcast day is soft
    // light everywhere, not a dark colony.
    this.ambient.intensity = (2.2 - day * 1.9) * Math.max(0.62, cloudLift) + flash * 1.6;

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

  /** Fog matches the horizon so the map edge dissolves instead of ending. */
  fogColor(): THREE.Color {
    return this.skyBottom;
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

  dispose(): void {
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.sunDisc.geometry.dispose();
    (this.sunDisc.material as THREE.Material).dispose();
    this.moonDisc.geometry.dispose();
    (this.moonDisc.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
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
