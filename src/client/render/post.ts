/**
 * What happens to the frame after the scene is drawn: ambient occlusion, then
 * the tone map and a levels grade in one pass to the canvas.
 *
 * The scene is drawn once, into a target this file owns, and everything after
 * it is screen space. That is the whole cost model, and it is deliberate: GTAO
 * left to itself redraws every mesh with a normal material to get a G-buffer,
 * which on this colony is a second pass over eight million triangles and a
 * second render of the shadow map. Handed a depth texture instead, it rebuilds
 * normals from depth (`GTAOPass.setGBuffer`, `NORMAL_VECTOR_TYPE 0`) and never
 * touches the scene.
 *
 * Why each step, in the order they run:
 *
 * - **GTAO, at half resolution** — the one that matters. Without it nothing in
 *   this colony touches the ground: a bed, a table, a settler's feet sit on the
 *   grass with no darkening where they meet it, so every object reads as
 *   hovering. Occlusion is also the only darkening inside a room, where the
 *   sun's shadow has nothing to say. At full resolution it was 8.5 ms of a
 *   14 ms frame (r24); occlusion is soft by nature and a quarter of the pixels
 *   carry it. GTAO's own output is switched off: it would copy the scene into
 *   a second full-screen buffer and multiply the occlusion over it in a third
 *   pass, and the final pass can do that multiply for the price of one lookup.
 * - **Output and grade, one pass** — the tone map and sRGB that the renderer
 *   applies when it draws to the canvas (a render target is drawn linear, so
 *   they move here), then levels in display space. The frame's trouble is
 *   compression, not a missing black: r23's colony frame runs from 119 to 214
 *   grey levels across its middle ninety per cent with the median at 194, so
 *   a black point, a white point and a gamma that pulls the middle down are
 *   what spread it. The lights are left alone on purpose — `SHADOW_FLOOR` and
 *   the fill terms in `sky.ts` are held by `tests/lighting.test.ts` against a
 *   photograph of a shadow that buried the colony, and levels can open the
 *   range without reopening that argument.
 *
 * Tried in r24 and taken out, so nobody puts them back without new evidence:
 * a bloom (at any threshold that spares a sunlit white statue, the amber lamp
 * heads at 1.6 never reach it — brighter emissives are a model change) and a
 * tilt-shift (three's nine-tap kernel ramps from the centre line with no band
 * in focus, so half the colony was mush, and its sparse taps stippled every
 * blurred wall).
 */

import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** The numbers the frames set. Exported so the tests can say them back. */
export const GRADE = {
  /** Display value mapped to black. */
  black: 0.12,
  /** Display value mapped to white. The brightest ground never reached it. */
  white: 0.92,
  /** Above 1 pulls the middle down and leaves black and white where they are. */
  gamma: 1.35,
  /**
   * The floor under the curve, as a fraction of the value going in. Without
   * it the black point and the gamma took r23's dusk grass blades (about 42
   * grey levels) to 3, a flat black: nothing that was not black comes out so.
   */
  toe: 0.35,
  /** 1 is none: the gamma above already deepens every colour, and r26 at 1.1 went neon. */
  saturation: 1.0,
  /** How much the corners lose, 0 .. 1. */
  vignette: 0.22,
};

export const AO = {
  /** World units — a cell is a metre, so this is the reach of a contact shadow. */
  radius: 0.9,
  distanceExponent: 1.4,
  thickness: 1.2,
  scale: 1.1,
  samples: 16,
  /** The denoise's own taps. Four is where r24's probe stopped paying for more. */
  denoiseSamples: 4,
  /** How much of the occlusion is multiplied into the picture. */
  blend: 1.0,
  /** The occlusion buffer is this fraction of the screen along each side. */
  scale2d: 0.5,
};

/** Levels on one display value, the curve the final pass applies per channel. */
export function levels(v: number): number {
  const t = Math.min(1, Math.max(0, (v - GRADE.black) / (GRADE.white - GRADE.black)));
  return Math.max(Math.pow(t, GRADE.gamma), v * GRADE.toe);
}

const FinalShader = {
  name: 'PostFinalShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tAO: { value: null as THREE.Texture | null },
    aoIntensity: { value: AO.blend },
    toneMappingExposure: { value: 1 },
    black: { value: GRADE.black },
    white: { value: GRADE.white },
    gamma: { value: GRADE.gamma },
    toe: { value: GRADE.toe },
    saturation: { value: GRADE.saturation },
    vignette: { value: GRADE.vignette },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tAO;
    uniform float aoIntensity;
    uniform float black;
    uniform float white;
    uniform float gamma;
    uniform float toe;
    uniform float saturation;
    uniform float vignette;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      // GTAO's own blend (GTAOBlendShader), in linear light before the curve.
      src.rgb *= mix(vec3(1.0), texture2D(tAO, vUv).rgb, aoIntensity);
      // The renderer's own curve and transfer, exactly as OutputPass applies them.
      vec4 c = vec4(ACESFilmicToneMapping(src.rgb), src.a);
      c = sRGBTransferOETF(c);
      vec3 g = pow(clamp((c.rgb - black) / (white - black), 0.0, 1.0), vec3(gamma));
      g = max(g, c.rgb * toe);
      float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
      g = mix(vec3(l), g, saturation);
      float d = distance(vUv, vec2(0.5));
      g *= 1.0 - vignette * smoothstep(0.3, 0.8, d);
      gl_FragColor = vec4(clamp(g, 0.0, 1.0), c.a);
    }
  `,
};

export class PostChain {
  /** Off draws the scene straight to the screen, exactly as before this file. */
  enabled = true;

  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly gtao: GTAOPass;
  private readonly final: FullScreenQuad;
  private readonly finalMaterial: THREE.RawShaderMaterial;
  private readonly size = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    antialias: boolean,
  ) {
    // The final pass is written for the renderer this repo builds; a different
    // curve would be applied silently wrong rather than not at all.
    if (renderer.toneMapping !== THREE.ACESFilmicToneMapping || renderer.outputColorSpace !== THREE.SRGBColorSpace) {
      throw new Error('PostChain applies ACESFilmic and sRGB itself; the renderer must be set to both');
    }
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);

    // Half float so the tone map has the scene's full range to work on; four
    // samples because the context's own MSAA only applies to the canvas.
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: antialias ? 4 : 0,
      depthTexture: new THREE.DepthTexture(w, h),
    });

    // Built the default way and then handed the depth, not handed it in the
    // constructor: in 0.180 `setGBuffer`, `setSize` and `dispose` all reach for
    // `normalRenderTarget`, which only the default path creates, so a depth
    // passed at construction throws before the first frame. The target it
    // leaves behind is never bound once `_renderGBuffer` is false (only the
    // debug output mode reads it), and a target is allocated on first bind.
    this.gtao = new GTAOPass(scene, new THREE.PerspectiveCamera(), w, h);
    this.gtao.setGBuffer(this.sceneTarget.depthTexture ?? undefined);
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.gtao.updateGtaoMaterial({
      radius: AO.radius,
      distanceExponent: AO.distanceExponent,
      thickness: AO.thickness,
      scale: AO.scale,
      samples: AO.samples,
    });
    this.gtao.updatePdMaterial({ samples: AO.denoiseSamples });

    this.finalMaterial = new THREE.RawShaderMaterial({
      name: FinalShader.name,
      uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms),
      vertexShader: FinalShader.vertexShader,
      fragmentShader: FinalShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.finalMaterial.uniforms.tDiffuse.value = this.sceneTarget.texture;
    this.finalMaterial.uniforms.tAO.value = this.gtao.pdRenderTarget.texture;
    this.final = new FullScreenQuad(this.finalMaterial);

    this.setSize();
  }

  /** Follow the renderer's drawing-buffer size, which the viewport owns. */
  setSize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    this.sceneTarget.setSize(w, h);
    this.gtao.setSize(Math.max(1, Math.round(w * AO.scale2d)), Math.max(1, Math.round(h * AO.scale2d)));
  }

  /**
   * Draw the frame.
   *
   * `renderer.info` is left saying what it said before this file existed: the
   * scene's draw calls and triangles, shadow pass excluded. The passes after
   * the scene are a handful of full-screen triangles; counting them would move
   * the colony's number every round for no change in the colony, and the
   * millisecond the look harness takes across `Viewport.render` already
   * includes every one of them.
   */
  render(camera: THREE.Camera): void {
    const r = this.renderer;
    r.setRenderTarget(this.sceneTarget);
    r.render(this.scene, camera);
    const scene = { ...r.info.render };

    this.gtao.camera = camera;
    this.gtao.render(r, this.sceneTarget, this.sceneTarget, 0, false);

    this.finalMaterial.uniforms.toneMappingExposure.value = r.toneMappingExposure;
    r.setRenderTarget(null);
    this.final.render(r);

    Object.assign(r.info.render, scene);
  }

  dispose(): void {
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    this.gtao.dispose();
    this.finalMaterial.dispose();
    this.final.dispose();
  }
}
