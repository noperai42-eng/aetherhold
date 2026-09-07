/**
 * The one WebGL renderer and the one scene. Both views draw the same scene with
 * different cameras — that is the structural reason the two views can never
 * disagree about what exists.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'high' | 'medium' | 'low';

export interface QualitySettings {
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  /** Extra decorative geometry (grass tufts, fire sparks) is skipped on low. */
  decor: boolean;
  /**
   * An environment map for the standard materials to reflect. A smooth surface
   * only reads as smooth when something specular lands on it — a bevel lit by
   * three directional lights alone is a bevel with three highlights and nothing
   * between them, which is exactly the faceted look this is here to remove.
   * Costs a handful of texture lookups per fragment, so low goes without.
   */
  environment: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  high: { maxPixelRatio: 2, shadows: true, shadowMapSize: 2048, antialias: true, decor: true, environment: true },
  medium: { maxPixelRatio: 1.5, shadows: true, shadowMapSize: 1024, antialias: true, decor: true, environment: true },
  low: { maxPixelRatio: 1, shadows: false, shadowMapSize: 512, antialias: false, decor: false, environment: false },
};

/** Layer 0 is drawn by both cameras. These are view-specific overlays. */
export const LAYER_ALL = 0;
export const LAYER_MANAGER = 1;
export const LAYER_FPS = 2;

export function guessQuality(): Quality {
  const dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores <= 4 || dpr > 2.5) return 'medium';
  if (cores >= 8) return 'high';
  return 'medium';
}

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  quality: Quality;
  private settings: QualitySettings;
  /** The prefiltered environment, built once and kept until quality drops it. */
  private environment: THREE.Texture | null = null;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.settings = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.settings.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    // PCFSoft is the filter that gives a shadow a soft edge; `shadow.radius` is
    // read only by the plain PCF and VSM filters, so it is deliberately not set.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x223040, 40, 130);
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.settings;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.maxPixelRatio));
    this.renderer.shadowMap.enabled = s.shadows;
    this.applyEnvironment();
  }

  /**
   * The environment is a neutral, softly lit room — one broad light overhead
   * and pale walls — prefiltered into the mip chain the standard materials
   * sample for reflections. A room rather than the sky dome on purpose: the
   * dome is one smooth gradient and reflects as one smooth nothing, while the
   * room's light puts a highlight where a bevel turns and the walls put a
   * gentle sheen everywhere else, which is what makes a rounded edge read as
   * rounded at both camera distances.
   *
   * Built once. Its *strength* is not set here: it is the sky's to drive, hour
   * by hour, because an environment held at a daytime level would light a
   * midnight colony from every direction at once. See `SkyView.sync`.
   */
  private applyEnvironment(): void {
    if (!this.settings.environment) {
      this.environment?.dispose();
      this.environment = null;
      this.scene.environment = null;
      return;
    }
    if (this.environment) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment;
  }

  /**
   * Antialiasing is fixed when the GL context is created, so switching quality
   * changes resolution, shadows and decor but not MSAA. Said plainly rather than
   * silently pretending the switch is complete.
   */
  setQuality(q: Quality): QualitySettings {
    this.quality = q;
    this.settings = QUALITY[q];
    this.applySettings();
    this.renderer.shadowMap.needsUpdate = true;
    return this.settings;
  }

  get config(): QualitySettings {
    return this.settings;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  /**
   * Compile every shader before the first interactive frame so the first swing of
   * the camera does not stutter while the driver links programs.
   */
  prewarm(cameras: THREE.Camera[]): void {
    for (const cam of cameras) this.renderer.compile(this.scene, cam);
  }

  dispose(): void {
    this.environment?.dispose();
    this.environment = null;
    this.scene.environment = null;
    this.renderer.dispose();
  }
}
