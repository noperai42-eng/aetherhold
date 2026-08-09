/**
 * The haze over ground the colony has never walked.
 *
 * One translucent block per unseen cell, tall enough to swallow a cliff and to
 * leave a treetop showing above it. That last part is the whole reason this is a
 * volume rather than a flat dark tile laid over the ground: from the isometric
 * camera a flat tile leaves lit rock tops and lit pine crowns floating on a
 * black field, which reads as a rendering fault. A block that comes up to about
 * chest height on a tree reads as weather.
 *
 * It is *translucent* on purpose, and that is a design call rather than a
 * technical one. Opaque black would be the honest thing — the colony genuinely
 * knows nothing out there — but it would also delete the eighteen site markers
 * that are the only thing telling a new player there is any reason to leave the
 * yard. At this alpha the markers survive as smudges: enough to make somebody
 * point the camera east, not enough to save them the walk.
 *
 * `transparent` with `depthWrite` left on, which is unusual and is the point:
 * every block is the same colour and the same alpha, so the sorting artefact
 * that normally forces depth-writes off — a near surface drawn early hiding a
 * far one — is invisible here, while the depth write buys the thing that
 * actually matters on an iPad, which is that a hundred blocks stacked along the
 * view ray blend exactly once instead of a hundred times.
 *
 * This draws only. It never decides what is hidden: `sim/explore.ts` owns that,
 * both cameras read the same flags, and there is no second answer anywhere.
 */

import * as THREE from 'three';

import type { World } from '../../sim/types';

/**
 * How tall the haze stands, in world units. Rock blocks top out at 2.45 and a
 * pine at about 4, so this covers the cliff and clips the tree — which is the
 * silhouette that makes an unexplored ridge read as a treeline in fog.
 */
const HAZE_HEIGHT = 3.0;

/** The colour it settles to at night, when there is no sky left to borrow from. */
const NIGHT = new THREE.Color(0x0a0f16);
/** How far the haze is allowed to take the sky's own colour. */
const SKY_MIX = 0.4;

export class ShroudView {
  readonly group = new THREE.Group();
  private readonly haze: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  /** 1 where a block is currently placed on that cell. Mirrors the sim's flags, inverted. */
  private readonly placed: Uint8Array;
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly block = new THREE.Matrix4();
  private readonly tint = new THREE.Color();
  /** The last explored count this was built against. The whole change detector. */
  private explored = -1;

  constructor(world: World) {
    const cells = world.width * world.height;
    this.placed = new Uint8Array(cells);

    const geo = new THREE.BoxGeometry(1, HAZE_HEIGHT, 1);
    // Base on the ground, so the instance translation is a cell and nothing has
    // to remember half a height.
    geo.translate(0, HAZE_HEIGHT / 2, 0);

    this.material = new THREE.MeshBasicMaterial({
      color: NIGHT.clone(),
      transparent: true,
      opacity: 0.88,
      depthWrite: true,
    });

    this.haze = new THREE.InstancedMesh(geo, this.material, cells);
    // Haze does not take part in the light: it is not lit, it does not shade
    // what is under it, and a shadow cast by the edge of the known world would
    // be a black bar lying across ground the player *can* see.
    this.haze.castShadow = false;
    this.haze.receiveShadow = false;
    this.haze.frustumCulled = false;
    this.haze.count = cells;
    this.group.add(this.haze);

    this.rebuild(world);
  }

  /**
   * `sky` is the sky's own fog colour. Borrowing most of the way to it is what
   * keeps the haze from reading as a hole in the map at midday and as a light
   * grey tarp at midnight — it is the same weather the rest of the scene is in.
   */
  setTint(sky: THREE.Color): void {
    this.tint.copy(NIGHT).lerp(sky, SKY_MIX);
    if (!this.material.color.equals(this.tint)) this.material.color.copy(this.tint);
  }

  /**
   * Ground only ever gets revealed, never re-hidden, so this only ever takes
   * blocks away — and it does not run at all unless the colony discovered
   * something, which on a settled colony is almost never. The scan itself is
   * thirty-seven thousand byte compares; the matrix work is one write per cell that
   * actually changed.
   */
  sync(world: World): void {
    const explored = world.stats.explored ?? 0;
    if (explored === this.explored) return;
    const seen = world.seen;
    if (!seen || seen.length !== this.placed.length) return;
    this.explored = explored;

    let lifted = 0;
    for (let i = 0; i < this.placed.length; i++) {
      if (this.placed[i] === 0 || seen[i] !== 1) continue;
      this.placed[i] = 0;
      this.haze.setMatrixAt(i, this.hidden);
      lifted++;
    }
    if (lifted > 0) this.haze.instanceMatrix.needsUpdate = true;
  }

  private rebuild(world: World): void {
    const seen = world.seen;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const i = y * world.width + x;
        // No flags yet means the first tick has not run. Everything is hazed
        // until it says otherwise, which is the right way round: a frame that
        // renders before the sim has looked around shows an unknown map rather
        // than briefly showing the whole thing.
        if (seen && seen[i] === 1) {
          this.haze.setMatrixAt(i, this.hidden);
          continue;
        }
        this.placed[i] = 1;
        this.block.makeTranslation(x, 0, y);
        this.haze.setMatrixAt(i, this.block);
      }
    }
    this.haze.instanceMatrix.needsUpdate = true;
    this.explored = world.stats.explored ?? 0;
  }

  dispose(): void {
    this.haze.geometry.dispose();
    this.material.dispose();
  }
}
