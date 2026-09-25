/**
 * The chain after the scene (`src/client/render/post.ts`), judged without a GPU.
 *
 * What a player gets from it — objects that touch the ground, darks that are
 * dark — is judged by the frames (LOOK.md, round r24). What these hold is the
 * contract around it, the parts a later change could break without any frame
 * looking different on the day:
 *
 * - low quality keeps drawing straight to the canvas, so a weak card never
 *   pays for a half-float target and the passes after it;
 * - the scene is drawn once, into the chain's own target, and `renderer.info`
 *   still says what that one draw cost — the Cost line every look round reads
 *   would otherwise move for no change in the colony;
 * - the occlusion reads that target's depth and never draws the colony again,
 *   and runs on a quarter of the pixels, which is what brought it from 8.5 ms
 *   of a 14 ms frame down to something a frame can carry;
 * - the levels curve spreads the frame the way r23's histogram said it must.
 *
 * The renderer is a stub: the chain only asks it for sizes, a target and a
 * draw. The occlusion's and the final pass's own `render`, the parts that need
 * a real context, are replaced with ones that draw a known amount.
 */

import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { describe, expect, it } from 'vitest';

import { AO, GRADE, PostChain, levels } from '../src/client/render/post';
import { QUALITY } from '../src/client/render/renderer';

interface Stub {
  renderer: THREE.WebGLRenderer;
  /** Every scene `render` call, with the target that was bound when it ran. */
  draws: { target: THREE.WebGLRenderTarget | null }[];
  info: { calls: number; triangles: number; points: number; lines: number; frame: number };
  size: { w: number; h: number; ratio: number };
}

function stubRenderer(w: number, h: number, ratio = 1): Stub {
  const info = { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 };
  const draws: Stub['draws'] = [];
  const size = { w, h, ratio };
  let bound: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    info: { render: info },
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.3,
    outputColorSpace: THREE.SRGBColorSpace,
    getPixelRatio: () => size.ratio,
    getSize: (v: THREE.Vector2) => v.set(size.w, size.h),
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(size.w * size.ratio, size.h * size.ratio),
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      bound = t;
    },
    getRenderTarget: () => bound,
    render: () => {
      draws.push({ target: bound });
      // What the colony's scene draw costs, as far as these tests care.
      info.calls = 900;
      info.triangles = 8_300_000;
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, draws, info, size };
}

type Internals = {
  sceneTarget: THREE.WebGLRenderTarget;
  gtao: {
    camera: THREE.Camera;
    output: number;
    _renderGBuffer: boolean;
    depthTexture: THREE.Texture;
    pdRenderTarget: THREE.WebGLRenderTarget;
    render: (...a: unknown[]) => void;
  };
  final: { render: (...a: unknown[]) => void };
  finalMaterial: THREE.RawShaderMaterial;
};
const inside = (chain: PostChain) => chain as unknown as Internals;

/**
 * The chain with the two GPU-only steps replaced: each full-screen pass is a
 * draw call and two triangles, and resets `info` the way a real `render` does.
 */
function chainOn(stub: Stub): PostChain {
  const chain = new PostChain(stub.renderer, new THREE.Scene(), true);
  const pass = () => {
    stub.info.calls = 1;
    stub.info.triangles = 2;
  };
  inside(chain).gtao.render = pass;
  inside(chain).final.render = pass;
  return chain;
}

describe('which machines pay for the post chain', () => {
  it('runs on high and medium, and low draws the scene straight to the canvas', () => {
    expect(QUALITY.high.post).toBe(true);
    expect(QUALITY.medium.post).toBe(true);
    // Low is the card that cannot afford a half-float screen and the passes after it.
    expect(QUALITY.low.post).toBe(false);
  });
});

describe('building the chain', () => {
  it('builds, resizes and disposes without a frame in between', () => {
    // GTAOPass in three 0.180 throws from its constructor, `setSize` and
    // `dispose` when handed a depth texture up front — the first r24 shoot was
    // a black page reading "Cannot read properties of undefined (reading
    // 'depthTexture')". Every one of the three is walked here.
    const stub = stubRenderer(1280, 800);
    const chain = new PostChain(stub.renderer, new THREE.Scene(), true);
    expect(() => chain.setSize()).not.toThrow();
    expect(() => chain.dispose()).not.toThrow();
  });

  it('refuses a renderer whose curve it would be applying in the wrong place', () => {
    // The final pass applies ACESFilmic and sRGB itself. A renderer switched to
    // another curve would be drawn with this one, silently.
    const stub = stubRenderer(1280, 800);
    (stub.renderer as unknown as { toneMapping: THREE.ToneMapping }).toneMapping = THREE.AgXToneMapping;
    expect(() => new PostChain(stub.renderer, new THREE.Scene(), true)).toThrow(/ACESFilmic/);
  });

  it('reads the scene target’s depth rather than drawing the colony a second time for it', () => {
    const chain = chainOn(stubRenderer(1280, 800));
    const { gtao, sceneTarget } = inside(chain);
    // A G-buffer of its own is a second pass over eight million triangles.
    expect(gtao._renderGBuffer).toBe(false);
    expect(gtao.depthTexture).toBe(sceneTarget.depthTexture);
  });

  it('multiplies the occlusion in the final pass instead of in two more full-screen passes', () => {
    const chain = chainOn(stubRenderer(1280, 800));
    const { gtao, sceneTarget, finalMaterial } = inside(chain);
    // GTAO's own output copies the scene and blends over the copy, two passes
    // at full resolution; off, it only leaves its denoised buffer behind.
    expect(gtao.output).toBe(GTAOPass.OUTPUT.Off);
    expect(finalMaterial.uniforms.tDiffuse.value).toBe(sceneTarget.texture);
    expect(finalMaterial.uniforms.tAO.value).toBe(gtao.pdRenderTarget.texture);
  });
});

describe('what the chain does with one frame', () => {
  it('draws the scene exactly once, into its own target and not the canvas', () => {
    const stub = stubRenderer(1280, 800);
    const chain = chainOn(stub);
    chain.render(new THREE.PerspectiveCamera());
    expect(stub.draws).toHaveLength(1);
    expect(stub.draws[0].target).toBe(inside(chain).sceneTarget);
  });

  it('leaves renderer.info saying what the scene cost, not the passes after it', () => {
    const stub = stubRenderer(1280, 800);
    chainOn(stub).render(new THREE.PerspectiveCamera());
    // The last pass reset the counters to its own one call; the Cost line must
    // read the colony, or every look round after this one reads a frame of two
    // triangles.
    expect(stub.info.calls).toBe(900);
    expect(stub.info.triangles).toBe(8_300_000);
  });

  it('gives the occlusion the camera that drew the depth it is reading', () => {
    const chain = chainOn(stubRenderer(1280, 800));
    const eye = new THREE.PerspectiveCamera();
    const overhead = new THREE.PerspectiveCamera();
    chain.render(eye);
    expect(inside(chain).gtao.camera).toBe(eye);
    // Views switch mid-session; a stale camera reconstructs normals from the
    // wrong projection and paints occlusion on open ground.
    chain.render(overhead);
    expect(inside(chain).gtao.camera).toBe(overhead);
  });
});

describe('the occlusion runs on a quarter of the pixels', () => {
  it('sizes its buffer to half the drawing buffer on each side, at any pixel ratio', () => {
    for (const [w, h, ratio] of [
      [1280, 800, 1],
      [1280, 800, 1.5],
      [390, 844, 3],
    ]) {
      const chain = chainOn(stubRenderer(w, h, ratio));
      const ao = inside(chain).gtao.pdRenderTarget;
      expect(ao.width).toBe(Math.round(w * ratio * AO.scale2d));
      expect(ao.height).toBe(Math.round(h * ratio * AO.scale2d));
      // The scene itself stays at full resolution; only the occlusion is halved.
      expect(inside(chain).sceneTarget.width).toBe(w * ratio);
    }
  });

  it('follows a resize rather than keeping the size it was built at', () => {
    const stub = stubRenderer(1280, 800);
    const chain = chainOn(stub);
    stub.size.w = 640;
    chain.setSize();
    expect(inside(chain).sceneTarget.width).toBe(640);
    expect(inside(chain).gtao.pdRenderTarget.width).toBe(320);
  });
});

describe('the levels grade', () => {
  it('puts the shader the numbers the curve here is written with', () => {
    const u = inside(chainOn(stubRenderer(1280, 800))).finalMaterial.uniforms;
    expect(u.black.value).toBe(GRADE.black);
    expect(u.white.value).toBe(GRADE.white);
    expect(u.gamma.value).toBe(GRADE.gamma);
    expect(u.toe.value).toBe(GRADE.toe);
  });

  it('spreads the middle of the r23 colony frame instead of lifting it', () => {
    // r23's colony frame: p5 119, median 194, p95 214 of 255. Compression, not
    // a missing black, and an S-curve through mid-grey made it worse — it lifts
    // a median that already sits above the middle. So the curve must open the
    // p5–p95 span by at least a third and bring the median down, not up.
    const [p5, p50, p95] = [119, 194, 214].map((g) => g / 255);
    expect(levels(p95) - levels(p5)).toBeGreaterThan((p95 - p5) * 1.33);
    expect(levels(p50)).toBeLessThan(p50);
  });

  it('keeps black black and white white', () => {
    expect(levels(0)).toBe(0);
    expect(levels(GRADE.white)).toBe(1);
    expect(levels(1)).toBe(1);
  });

  it('takes nothing that was not black to black', () => {
    // r25 took the dusk grass blades from 42 grey levels to 3. The black point
    // alone maps everything under it to zero; the toe is what stops that.
    for (const g of [8, 20, 31, 42]) expect(levels(g / 255) * 255).toBeGreaterThanOrEqual(g * GRADE.toe - 1e-9);
    expect(levels(42 / 255) * 255).toBeGreaterThan(12);
  });

  it('never reverses two values: a darker input stays darker', () => {
    let last = -1;
    for (let i = 0; i <= 255; i++) {
      const out = levels(i / 255);
      expect(out).toBeGreaterThanOrEqual(last);
      last = out;
    }
  });
});
