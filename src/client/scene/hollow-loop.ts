/**
 * Mortal hollow pocket — the verbs, not the meshes.
 *
 * This is the whole of Iter 1's game: walk the bowl, optionally talk to the
 * headman, clear the jam in the mill race with a lever and two hands. No qi,
 * no second colony sim. The Three.js kit reads these numbers so a test can
 * clear the jam without a canvas, and so a later sect slice can swap the
 * dressing without rewriting the loop.
 */

export type PocketView = 'manager' | 'inhabit';

export interface HollowVec {
  x: number;
  z: number;
}

export interface HollowBox {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export interface HollowState {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  view: PocketView;
  talked: boolean;
  jammed: boolean;
  cleared: boolean;
  line: string;
}

/** Layout the kit and the loop both stand on. Metres, origin at the bowl's heart. */
export const HOLLOW = {
  walkRadius: 13.6,
  spawn: { x: -1.6, z: 8.2, yaw: -0.72 },
  headman: { x: -3.1, z: 2.6, reach: 1.8 },
  jam: { x: 5.05, z: -1.75, reach: 2.1 },
  millHouse: { x: 6.35, z: 0.55, hx: 1.7, hz: 1.35 } satisfies HollowBox,
  cottages: [
    { x: -7.4, z: 1.2, hx: 1.35, hz: 1.15 },
    { x: -5.6, z: 5.4, hx: 1.2, hz: 1.05 },
    { x: -9.0, z: 4.6, hx: 1.15, hz: 1.05 },
  ] satisfies HollowBox[],
  well: { x: -4.6, z: 3.5, hx: 0.55, hz: 0.55 } satisfies HollowBox,
} as const;

export const HOLLOW_WALK = 3.15;
export const HOLLOW_RUN = 5.05;
export const HOLLOW_RADIUS = 0.38;
export const HOLLOW_EYE = 1.62;
export const HOLLOW_MAX_PITCH = 1.35;

const TALK =
  'Old Wen nods at the race. "Wheel\'s fouled. Throw the gate-lever and haul the snag — no need for charms."';
const CLEAR =
  'You slack the race with the gate-lever, then shoulder the wet timber free of the paddles. The wheel takes the water.';
const NOTHING = '';

export function createHollowState(): HollowState {
  return {
    x: HOLLOW.spawn.x,
    z: HOLLOW.spawn.z,
    yaw: HOLLOW.spawn.yaw,
    pitch: 0,
    view: 'inhabit',
    talked: false,
    jammed: true,
    cleared: false,
    line: 'A cold hollow. The mill is silent.',
  };
}

export function hollowSolids(): HollowBox[] {
  return [HOLLOW.millHouse, HOLLOW.well, ...HOLLOW.cottages];
}

export function dist2(a: HollowVec, b: HollowVec): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function inReach(pos: HollowVec, target: HollowVec, reach: number): boolean {
  return dist2(pos, target) <= reach * reach;
}

export type HollowFocus = 'headman' | 'jam' | null;

export function hollowFocus(s: HollowState): HollowFocus {
  const self = { x: s.x, z: s.z };
  const jamNear = s.jammed && inReach(self, HOLLOW.jam, HOLLOW.jam.reach);
  const talkNear = inReach(self, HOLLOW.headman, HOLLOW.headman.reach);
  // The jam wins when both are in reach, because that is the verb the slice is for.
  if (jamNear) return 'jam';
  if (talkNear) return 'headman';
  return null;
}

export function hollowPrompt(s: HollowState): string {
  const focus = hollowFocus(s);
  if (focus === 'jam') return 'Clear the mill jam';
  if (focus === 'headman') return s.talked ? 'Listen again' : 'Talk to the headman';
  if (s.cleared) return 'The mill is turning.';
  return '';
}

/**
 * E. Talk is optional colour. Clearing the jam is a mortal job: gate-lever,
 * then the wet timber, no qi. One press does both because the competence is
 * knowing the order, not a minigame.
 */
export function hollowInteract(s: HollowState): HollowState {
  const focus = hollowFocus(s);
  if (focus === 'jam') {
    return { ...s, jammed: false, cleared: true, line: CLEAR };
  }
  if (focus === 'headman') {
    return { ...s, talked: true, line: TALK };
  }
  return { ...s, line: NOTHING };
}

export function hollowLook(s: HollowState, dyaw: number, dpitch: number): HollowState {
  let yaw = s.yaw + dyaw;
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  const pitch = clamp(s.pitch + dpitch, -HOLLOW_MAX_PITCH, HOLLOW_MAX_PITCH);
  return { ...s, yaw, pitch };
}

export function setHollowView(s: HollowState, view: PocketView): HollowState {
  return { ...s, view };
}

/**
 * Walk the body. `wishX` / `wishZ` are already world XZ (the view converts
 * keys through camera or facing). Collision is circle-vs-box plus the bowl
 * rim — the same solids the kit builds.
 */
export function hollowWalk(
  s: HollowState,
  wishX: number,
  wishZ: number,
  dt: number,
  run: boolean,
): HollowState {
  const speed = (run ? HOLLOW_RUN : HOLLOW_WALK) * dt;
  if (speed === 0 || (wishX === 0 && wishZ === 0)) return s;
  const len = Math.hypot(wishX, wishZ) || 1;
  const dx = (wishX / len) * speed;
  const dz = (wishZ / len) * speed;
  const solids = hollowSolids();
  const x = slide(s.x, s.z, dx, 0, solids);
  const z = slide(x, s.z, 0, dz, solids);
  return { ...s, x, z };
}

function slide(x: number, z: number, dx: number, dz: number, solids: HollowBox[]): number {
  const nx = x + dx;
  const nz = z + dz;
  if (!insideBowl(nx, nz)) return dx !== 0 ? x : z;
  if (blocked(nx, nz, solids)) return dx !== 0 ? x : z;
  return dx !== 0 ? nx : nz;
}

export function insideBowl(x: number, z: number): boolean {
  return x * x + z * z <= HOLLOW.walkRadius * HOLLOW.walkRadius;
}

export function blocked(x: number, z: number, solids: HollowBox[] = hollowSolids()): boolean {
  const r = HOLLOW_RADIUS;
  for (const b of solids) {
    const dx = Math.abs(x - b.x);
    const dz = Math.abs(z - b.z);
    if (dx < b.hx + r && dz < b.hz + r) return true;
  }
  return false;
}

export function pocketFromSearch(search: string): 'hollow' | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const q = new URLSearchParams(raw);
  if (q.get('pocket') === 'hollow') return 'hollow';
  if (q.get('hollow') === '1' || q.get('hollow') === 'true') return 'hollow';
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
