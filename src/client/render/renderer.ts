/**
 * The one WebGL renderer and the one scene. Both views draw the same scene with
 * different cameras — that is the structural reason the two views can never
 * disagree about what exists.
 */

import * as THREE from 'three';

export type Quality = 'high' | 'medium' | 'low';

export interface QualitySettings {
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  /** Extra decorative geometry (grass tufts, fire sparks) is skipped on low. */
  decor: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  high: { maxPixelRatio: 2, shadows: true, shadowMapSize: 2048, antialias: true, decor: true },
  medium: { maxPixelRatio: 1.5, shadows: true, shadowMapSize: 1024, antialias: true, decor: true },
  low: { maxPixelRatio: 1, shadows: false, shadowMapSize: 512, antialias: false, decor: false },
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.applySettings();

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x223040, 40, 130);
  }

  private applySettings(): void {
    const s = this.settings;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.maxPixelRatio));
    this.renderer.shadowMap.enabled = s.shadows;
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
    this.renderer.dispose();
  }
}
