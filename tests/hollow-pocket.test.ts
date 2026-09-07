/**
 * What a pocket scene borrows, and what it has to give back.
 *
 * `tests/hollow-mill.test.ts` covers the slice's verbs and its draw-call budget,
 * and all seven of its tests passed on a hollow whose ground did not render at
 * all. That is the gap this file is for: the pocket's two contact points with a
 * working game — the geometry the player stands on, and the valley the renderer
 * is handed back — neither of which any assertion touched.
 *
 * Three defects, all of them shipped green:
 *
 * The bowl, the mountain collar and the mill race were wound so that
 * `computeVertexNormals` pointed them at the centre of the earth: 703 ground
 * vertices, none facing up, 629 facing down. Materials are `FrontSide`, so all
 * of it was back-face culled and the player arrived in a grey void with three
 * cottages floating in it. The boxes were wound correctly, which is why it read
 * as "the buildings float" rather than as a broken renderer.
 *
 * `WorldView.setVisible` wrote ten `.visible` flags, two of which the quality
 * preset owns. Coming back from the pocket therefore switched decor on behind
 * the preset's back, leaving `enabled` false — so it drew and never rebuilt:
 * 1.6M triangles of stale grass standing inside walls, on the machine that had
 * asked for Low. Nothing healed it afterwards.
 *
 * And the pocket's sun casts, so it owns a shadow render target that
 * `scene.remove` does not free. The dispose walk tested `isMesh`, and a light is
 * not a mesh.
 */

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { buildBowl } from '../src/client/worldkit/bowl';
import { buildHollowKit, disposeHollowKit } from '../src/client/worldkit/kit';
import { disposeMaterials, makeVillageMaterials } from '../src/client/worldkit/materials';
import { WorldView } from '../src/client/render/world-view';
import { QUALITY } from '../src/client/render/renderer';
import { createWorld } from '../src/sim/worldgen';
import type { QualitySettings, Viewport } from '../src/client/render/renderer';

const SEED = 20260729;


/** Which way the faces of one mesh point, counted rather than sampled. */
function facing(geom: THREE.BufferGeometry): { up: number; down: number } {
  const n = geom.getAttribute('normal');
  if (!n) throw new Error('a surface with no normals can be neither lit nor culled');
  let up = 0;
  let down = 0;
  for (let i = 0; i < n.count; i++) {
    const y = n.getY(i);
    if (y > 0.5) up++;
    else if (y < -0.5) down++;
  }
  return { up, down };
}

/**
 * Whether the player would actually see this, which is not the same question as
 * `group.visible`: three walks the graph, so one `false` anywhere above hides
 * everything below it. Asking it this way is what lets the assertion outlive the
 * fix — it was true of ten flags and it is true of one root, and a third
 * implementation would have to answer it too.
 */
function onScreen(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

/** Enough of a 2D canvas for the one sprite `FxView` draws at construction. */
class FakeCanvas {
  width = 0;
  height = 0;
  getContext(): unknown {
    return {
      fillStyle: '' as unknown,
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillRect: () => {},
    };
  }
}

/**
 * `radialTexture` in `fx.ts` is the render layer's only reach for `document`,
 * and the suite runs on the node environment. Saved and restored around the
 * body in the shape `minimap.test.ts` established, so a view test cannot leak a
 * global into whatever file the runner picks up next.
 */
function withCanvas<T>(fn: () => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = 'document' in g;
  const old = g.document;
  g.document = { createElement: () => new FakeCanvas() };
  try {
    return fn();
  } finally {
    if (had) g.document = old;
    else delete g.document;
  }
}

/** A scene and a preset, which is all `WorldView` asks of a viewport. */
function view(config: QualitySettings): WorldView {
  return new WorldView(
    { scene: new THREE.Scene(), config } as unknown as Viewport,
    createWorld(SEED),
  );
}

// ---------------------------------------------------------------- functional

describe('the ground the hollow is standing on', () => {
  it('faces the sky on every swept surface, so that a front-facing material draws it', () => {
    // Reached through `buildBowl` rather than by scanning the assembled kit for
    // the ground colour: the baked static merge contains a box that also wears
    // that material, and a box is entitled to a bottom face. The three surfaces
    // swept here are not — they are the floor, the wall around it and the water
    // between, and each is a single sheet with one side to it. Roles, so that
    // the water race is covered too; it carried the third reversed winding and
    // a colour scan looking for earth would have walked straight past it.
    const mats = makeVillageMaterials();
    const bowl = buildBowl(mats);
    expect(bowl.meshes.map((m) => m.role).sort()).toEqual(['ground', 'mountain', 'water']);

    for (const { role, mesh } of bowl.meshes) {
      const { up, down } = facing(mesh.geometry);
      // Not `up > down`: a sheet has no business owning a single downward face,
      // and the defect produced exactly zero upward ones on all three.
      expect(up, `${role} presents no face to the sky`).toBeGreaterThan(0);
      expect(down, `${role} presents ${down} faces to the earth`).toBe(0);
    }
    disposeMaterials(mats);
  });

  it('is drawn by materials that cull back faces, which is what makes the winding matter', () => {
    // The pair to the test above, and the reason it is a pair: flipping these
    // to DoubleSide would make the frame look right and this file go green
    // while leaving the geometry inside out. The next mesh that needed a real
    // front face would be wrong again and nothing would say so.
    const mats = makeVillageMaterials();
    const bowl = buildBowl(mats);
    for (const { mesh } of bowl.meshes) {
      expect((mesh.material as THREE.Material).side).toBe(THREE.FrontSide);
    }
    disposeMaterials(mats);
  });
});

describe('what the pocket gives back when it is disposed', () => {
  it('frees the light that casts, not only the meshes that are cast on', () => {
    const kit = buildHollowKit();
    const lights: THREE.Light[] = [];
    kit.group.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight) lights.push(l);
    });
    expect(lights.length).toBeGreaterThan(0);
    // A shadow map is a GPU render target, so its freeing is not observable
    // from node — there is no renderer here to have allocated one. The spy is
    // the honest instrument: the defect was that `dispose` was never reached at
    // all, and that is exactly what this can see.
    const spies = lights.map((l) => vi.spyOn(l, 'dispose'));

    disposeHollowKit(kit);

    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- experience

describe('a colony that has lent the renderer to a pocket', () => {
  it('comes back exactly as the quality preset left it, on the setting that cannot afford otherwise', () => {
    withCanvas(() => {
      // Low is the case that matters: it is the only preset that asks for decor
      // to be off, so it is the only one where "visible again" and "as it was"
      // are different states.
      const v = view(QUALITY.low);
      expect(v.decor.group.visible).toBe(false);

      v.setVisible(false);
      v.setVisible(true);

      // The defect: this came back `true`, and `DecorView.sync` returns early
      // on `!enabled`, so whatever was drawn from here on was never rebuilt.
      expect(v.decor.group.visible).toBe(false);
      v.dispose();
    });
  });

  it('shows the valley again on a machine that was drawing all of it', () => {
    withCanvas(() => {
      // The other half, and the reason the test above is not merely
      // `expect(false)`: a `setVisible` that had quietly stopped touching
      // anything at all would satisfy that one on its own. Asked of the frame
      // rather than of the flag, because after the fix the flag never moves.
      const v = view(QUALITY.high);

      v.setVisible(false);
      const hidden = onScreen(v.terrain.group);
      v.setVisible(true);

      expect(hidden).toBe(false);
      expect(onScreen(v.terrain.group)).toBe(true);
      expect(onScreen(v.decor.group)).toBe(true);
      v.dispose();
    });
  });

  it('hides and shows the whole valley without writing a single subsystem flag', () => {
    withCanvas(() => {
      // The invariant behind both, stated once: a pocket may switch the valley
      // off, and it may not hold an opinion about any part of it. Ten flags
      // with two owners is what produced the bug; a parent that nobody else
      // writes is the fix, and this is the assertion that keeps it.
      const v = view(QUALITY.low);
      const parts = [
        v.terrain, v.decor, v.buildings, v.landmarks, v.pawns,
        v.pickies, v.shroud, v.sky, v.fx, v.weather,
      ];
      const before = parts.map((p) => p.group.visible);

      v.setVisible(false);
      const during = parts.map((p) => p.group.visible);
      v.setVisible(true);

      expect(during).toEqual(before);
      expect(parts.map((p) => p.group.visible)).toEqual(before);
      v.dispose();
    });
  });
});
