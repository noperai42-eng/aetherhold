/**
 * Precipitation — the visible half of `sim/weather.ts`.
 *
 * Rain is one `LineSegments` of a few thousand streaks that never changes on the
 * CPU: the fall, the sideways drift and the wrapping all happen in the vertex
 * shader from a single time uniform. Snow is the same buffer with five uniforms
 * moved — slower, whiter, barely streaked and wandering — so a January storm
 * costs exactly what a July one costs, and sleet, which is genuinely half of
 * each, is a lerp between them rather than a third thing to maintain. That
 * matters for two reasons. It costs one
 * draw call whether it is drizzling or pouring, and — because the time uniform is
 * the *sim* clock — the rain freezes when the player pauses, exactly like the
 * grass and the pawns do. A weather effect that kept animating through a pause
 * would be the loudest possible lie about what the simulation is doing.
 *
 * The box of drops is anchored to the world and wrapped around the camera rather
 * than parented to it, so walking through a storm does not drag the storm along.
 */

import * as THREE from 'three';

import { precipitation, snowShare, windStrength } from '../../sim/weather';
import type { QualitySettings } from './renderer';
import type { World } from '../../sim/types';

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Width and depth of the box of drops, in cells. Beyond this the fog hides it. */
const BOX_SIZE = 38;
/** Height of the box. Tall enough that an iso camera never sees the ceiling. */
const BOX_HEIGHT = 26;

const MAX_DROPS = 7000;

/**
 * The two things falling out of the same sky, and what tells them apart.
 *
 * A flake is not a white raindrop. It falls at about a sixth the speed, it is
 * barely a streak at all, it wanders on the way down, and it is very nearly
 * white where rain is blue-grey. All four have to move together or the result
 * reads as rain with the colour picker turned up. Every value here is a uniform
 * rather than a second particle system, so sleet — which is genuinely half of
 * each — is a lerp and not a special case.
 */
const RAIN_COLOR = 0xb6c9dc;
const SNOW_COLOR = 0xeef3fa;
const RAIN_SPEED = 20;
const SNOW_SPEED = 3.4;
/** How much of the per-drop streak length survives. A flake is a stub. */
const SNOW_STREAK = 0.22;
/** Sideways wander, in cells. Rain has none: it goes where the wind points it. */
const SNOW_SWAY = 0.55;
/** Allocated once — `sync` runs every frame and must not make garbage. */
const SNOW_TINT = new THREE.Color(SNOW_COLOR);

const RAIN_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFocus;
  uniform vec2 uSlant;
  uniform float uSpeed;
  uniform float uStreak;
  uniform float uSway;
  /** x: 0 = head, 1 = tail. y: per-drop speed jitter. z: streak length. */
  attribute vec3 aParam;

  #include <fog_pars_vertex>

  void main() {
    float speed = uSpeed * aParam.y;
    float travel = uTime * speed;

    // Fall and wrap inside the box height.
    float y = mod(position.y - travel, ${BOX_HEIGHT.toFixed(1)});
    // Drift sideways by the same distance travelled, so wind tilts the whole
    // column of rain rather than just the streaks.
    float x = position.x + uSlant.x * travel;
    float z = position.z + uSlant.y * travel;

    // Snow tumbles. The sway is seeded off the drop's own start position so no
    // two flakes are in phase, which is the whole difference between snow and
    // white rain — and it is zero for rain, which falls where it is pointed.
    x += uSway * sin(travel * 0.7 + position.x * 2.3 + position.z);
    z += uSway * cos(travel * 0.5 + position.z * 1.9 - position.x) * 0.8;

    // Wrap horizontally around the viewer. GLSL mod() is floor-based, so this is
    // correct for negative coordinates too.
    // Not "half": that is a reserved word in GLSL ES and the shader silently
    // fails to compile, which looks exactly like rain that renders nothing.
    float halfBox = ${(BOX_SIZE / 2).toFixed(1)};
    x = mod(x - uFocus.x + halfBox, ${BOX_SIZE.toFixed(1)}) - halfBox + uFocus.x;
    z = mod(z - uFocus.z + halfBox, ${BOX_SIZE.toFixed(1)}) - halfBox + uFocus.z;

    // The tail trails up-wind of the head, which is what makes a streak read as
    // motion rather than as a floating stick.
    vec3 world = vec3(x, y, z) + aParam.x * aParam.z * uStreak * vec3(uSlant.x, 1.0, uSlant.y);

    vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const RAIN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  #include <fog_pars_fragment>

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
    #include <fog_fragment>
  }
`;

export class WeatherView {
  readonly group = new THREE.Group();

  private readonly rain: THREE.LineSegments;
  private readonly uniforms: {
    uTime: { value: number };
    uFocus: { value: THREE.Vector3 };
    uSlant: { value: THREE.Vector2 };
    uSpeed: { value: number };
    uStreak: { value: number };
    uSway: { value: number };
    uColor: { value: THREE.Color };
    uOpacity: { value: number };
  };
  private budget = MAX_DROPS;
  /**
   * Wind phase is integrated rather than read from the clock: the gust speed
   * changes with the weather, and driving frequency straight off the tick would
   * snap the whole field sideways the moment a front arrived.
   */
  private phase = 0;
  private lastTick = -1;

  constructor() {
    this.group.name = 'weather';

    const pos = new Float32Array(MAX_DROPS * 2 * 3);
    const param = new Float32Array(MAX_DROPS * 2 * 3);
    // Deterministic scatter: the same drops every session, so a screenshot of a
    // storm is reproducible and nothing depends on Math.random at load.
    let s = 0x9e3779b9;
    const rand = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < MAX_DROPS; i++) {
      const x = (rand() - 0.5) * BOX_SIZE;
      const y = rand() * BOX_HEIGHT;
      const z = (rand() - 0.5) * BOX_SIZE;
      const speed = 0.75 + rand() * 0.5;
      const len = 0.6 + rand() * 0.8;
      for (let v = 0; v < 2; v++) {
        const o = (i * 2 + v) * 3;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        param[o] = v;
        param[o + 1] = speed;
        param[o + 2] = len;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aParam', new THREE.BufferAttribute(param, 3));

    this.uniforms = {
      uTime: { value: 0 },
      uFocus: { value: new THREE.Vector3() },
      uSlant: { value: new THREE.Vector2(0.18, 0.06) },
      uSpeed: { value: 26 },
      uStreak: { value: 1 },
      uSway: { value: 0 },
      uColor: { value: new THREE.Color(RAIN_COLOR) },
      uOpacity: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.uniforms]),
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    // UniformsUtils.merge clones, so re-point at the objects we actually mutate.
    Object.assign(mat.uniforms, this.uniforms);

    this.rain = new THREE.LineSegments(geo, mat);
    // Positions are computed in the shader, so the CPU-side bounding box is a lie.
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 2;
    this.group.add(this.rain);
  }

  applyQuality(settings: QualitySettings): void {
    this.budget = settings.decor ? MAX_DROPS : Math.round(MAX_DROPS * 0.3);
  }

  /**
   * `t` is the interpolated sim tick, so rain stops dead on pause. `focus` is the
   * camera target on the ground plane.
   */
  sync(world: World, t: number, focus: { x: number; y: number }): void {
    const fall = precipitation(world);
    if (fall <= 0.01) {
      this.group.visible = false;
      this.lastTick = t;
      return;
    }
    this.group.visible = true;

    const wind = windStrength(world);
    const frozen = snowShare(world);
    const dt = this.lastTick < 0 ? 0 : Math.min(4, Math.max(0, t - this.lastTick));
    this.lastTick = t;
    this.phase += dt / 20;

    this.uniforms.uTime.value = this.phase;
    this.uniforms.uFocus.value.set(focus.x, 0, focus.y);
    // A storm blows nearly sideways; drizzle falls close to straight down. Snow
    // takes far longer to reach the ground, so the same wind carries it much
    // further and the whole field leans harder.
    const lean = 1 + frozen * 1.6;
    this.uniforms.uSlant.value.set((0.1 + wind * 0.7) * lean, (0.04 + wind * 0.22) * lean);
    this.uniforms.uSpeed.value = mix(RAIN_SPEED + wind * 22, SNOW_SPEED + wind * 3.2, frozen);
    this.uniforms.uStreak.value = mix(1, SNOW_STREAK, frozen);
    this.uniforms.uSway.value = SNOW_SWAY * frozen;
    this.uniforms.uColor.value.setHex(RAIN_COLOR).lerp(SNOW_TINT, frozen);
    // Snow hangs in the air rather than falling through it, so the same amount
    // of weather reads as much thicker — which is what makes a blizzard feel
    // like one without spending a single extra drop on it.
    this.uniforms.uOpacity.value = mix(0.18 + fall * 0.42, 0.34 + fall * 0.5, frozen);

    const drops = Math.round(this.budget * (0.35 + fall * 0.65));
    this.rain.geometry.setDrawRange(0, drops * 2);
  }

  dispose(): void {
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
  }
}
