/**
 * Segment 1a-feel-trace: instrument first, move no knob.
 *
 * This file changes nothing under `src/`. It drives the exact frame loop
 * `app.ts` runs — `pace()`/`alphaOf()` feeding `FpsController.applyTick`, a
 * `PawnsView`-style prev/curr snapshot lerp, then `updateCamera` — at three
 * real frame rates (30, 60, 144 fps) over one scripted walk: stand, walk,
 * Shift-run, release, turn 90°, lie down, stand back up. Every number this
 * file asserts is a literal pinned at a named sample (a tick or a frame
 * index, plus the wall-clock millisecond that frame landed on), so a later
 * segment that changes the eye-ease, the bob or the interpolation itself
 * inherits a trace it cannot quietly redefine to flatter its own change
 * (LOOK.md: a trace has to be able to carry the frequencies it judges).
 *
 * `app.ts:349` passes `updateCamera` a hardcoded `1 / 60` regardless of the
 * real frame rate — not fixed here, only traced. That single literal is why
 * the eye-ease transient below takes the same number of *frames* to settle
 * at every rate but three different amounts of *wall time*: "the eye gap".
 */

import { describe, expect, it } from 'vitest';

import { alphaOf, pace } from '../src/client/pace';
import { FpsController } from '../src/client/fps/controller';
import { settlerBob } from '../src/client/render/pawns';
import { buildingAt, isWalkable } from '../src/sim/grid';
import { PLAYER_RUN, PLAYER_WALK } from '../src/sim/movement';
import { possess } from '../src/sim/orders';
import { Rng } from '../src/sim/rng';
import { groundSpeed } from '../src/sim/snowpack';
import { makeStreams, stepWorld } from '../src/sim/tick';
import { createWorld } from '../src/sim/worldgen';
import type { Input } from '../src/client/input/input';
import type { Pawn, World } from '../src/sim/types';

/** Only the fields the controller reads. Cast, so a real Input change breaks this. */
function fakeInput(
  opts: { held?: string[]; locked?: boolean; buttons?: number[]; moveX?: number; moveY?: number } = {},
): Input {
  const down = new Set(opts.held ?? []);
  return {
    down,
    mouseButtons: new Set(opts.buttons ?? []),
    locked: opts.locked ?? false,
    moveX: opts.moveX ?? 0,
    moveY: opts.moveY ?? 0,
    held: (code: string) => down.has(code),
  } as unknown as Input;
}

function bodyIn(world: World): Pawn {
  const pawn = world.pawns[0]!;
  possess(world, pawn.id);
  return pawn;
}

/**
 * A cell whose next `CLEAR_CELLS` neighbours to the east are all open ground
 * with no building on them — the walk, the run and the 90° turn together
 * cross about 17.4 cells, and a building would carry a nonzero `standHeight`
 * that breaks this file's premise (flat ground, `wanted` stays `EYE_HEIGHT`
 * for the whole walk, so the eye-ease term is identically zero until the
 * pawn lies down). `fps-view.test.ts`'s three-cell `clearRun` is too short
 * for that distance; this one asks for the whole corridor up front.
 */
const CLEAR_CELLS = 24;
function clearRun(world: World): { x: number; y: number } {
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - CLEAR_CELLS - 3; x++) {
      let ok = true;
      for (let d = 0; d <= CLEAR_CELLS; d++) {
        if (!isWalkable(world, x + d, y) || buildingAt(world, x + d, y)) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('worldgen produced no open corridor');
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * A `PawnsView`-style prev/curr snapshot, plus the two things a future
 * interpolation candidate (segment 1e-feel-interp-phase) needs and today's
 * renderer doesn't have: a snap rule for a teleport, and a dead-reckoning
 * `truth` line that no candidate can tune itself to match.
 *
 * `interpolated` is today's shape: `prev + (curr - prev) * alpha`, one tick
 * of lag baked in by construction. `truth` is `curr + (curr - prev) * alpha`
 * — the position dead reckoning would show with the same two samples — so
 * `truth - interpolated` is `curr - prev` exactly, a constant independent of
 * alpha. That relationship is what the metrics below pin.
 */
const SNAP_CELLS = 2;
class TraceView {
  prev = new Map<number, { x: number; y: number; f: number }>();
  curr = new Map<number, { x: number; y: number; f: number }>();
  onTick(world: World): void {
    for (const p of world.pawns) {
      const c = this.curr.get(p.id);
      if (c) {
        const jump = Math.hypot(p.x - c.x, p.y - c.y);
        const pr = this.prev.get(p.id) ?? { x: c.x, y: c.y, f: c.f };
        if (jump > SNAP_CELLS) {
          // Teleport: prev snaps to the new curr instead of lerping across
          // the gap, so the render never sweeps through the space between.
          pr.x = p.x;
          pr.y = p.y;
          pr.f = p.facing;
        } else {
          pr.x = c.x;
          pr.y = c.y;
          pr.f = c.f;
        }
        this.prev.set(p.id, pr);
        c.x = p.x;
        c.y = p.y;
        c.f = p.facing;
      } else {
        this.curr.set(p.id, { x: p.x, y: p.y, f: p.facing });
        this.prev.set(p.id, { x: p.x, y: p.y, f: p.facing });
      }
    }
  }
  interpolated(id: number, alpha: number): { x: number; y: number; f: number } {
    const c = this.curr.get(id)!;
    const pr = this.prev.get(id) ?? c;
    return { x: pr.x + (c.x - pr.x) * alpha, y: pr.y + (c.y - pr.y) * alpha, f: pr.f + shortestAngle(pr.f, c.f) * alpha };
  }
  truth(id: number, alpha: number): { x: number; y: number; f: number } {
    const c = this.curr.get(id)!;
    const pr = this.prev.get(id) ?? c;
    return { x: c.x + (c.x - pr.x) * alpha, y: c.y + (c.y - pr.y) * alpha, f: c.f + shortestAngle(pr.f, c.f) * alpha };
  }
}

// The script, in ticks. On flat, building-free ground `wanted` is
// `EYE_HEIGHT` the whole walk — the eye-ease term is zero the entire time —
// so the transient traced below is deliberately placed AFTER the walk, at
// the sleep/wake activity change, which is the only place on this corridor
// `wanted` actually moves (EYE_HEIGHT 1.62 -> PRONE_EYE 0.42 -> 1.62).
const STAND = 10;
const WALK = 40;
const RUN = 40;
const RELEASE = 20;
const TURN_TICK = STAND + WALK + RUN + RELEASE; // 110
const SLEEP = 20;
const WAKE = 20;
const SCRIPT_TICKS = TURN_TICK + 1 + SLEEP + WAKE; // 151

function keysForTick(tick: number): string[] {
  if (tick < STAND) return [];
  if (tick < STAND + WALK) return ['KeyW'];
  if (tick < STAND + WALK + RUN) return ['KeyW', 'ShiftLeft'];
  return [];
}

interface Sample {
  frame: number;
  wallMs: number;
  tick: number;
  x: number;
  y: number;
  f: number;
  /** `camera.position.y` — the eased eye height PLUS the walking bob. */
  eye: number;
  /** The eased eye height alone (`eye` minus this frame's bob), so the
   *  ease transient can be read without the bob riding on top of it. */
  eyeOnly: number;
  activity: string;
  bob: number;
  truthX: number;
  truthY: number;
  truthF: number;
}

interface RunResult {
  fps: number;
  samples: Sample[];
  world: World;
  pawn: Pawn;
  controller: FpsController;
  view: TraceView;
  spot: { x: number; y: number };
}

/** Reproduces `app.ts`'s frame loop exactly, including the literal `1 / 60`
 *  `app.ts:349` passes `updateCamera` regardless of the real frame rate. */
function run(fps: number): RunResult {
  const world = createWorld(77);
  const streams = makeStreams(world);
  const spot = clearRun(world);
  const pawn = bodyIn(world);
  pawn.x = spot.x;
  pawn.y = spot.y;

  const controller = new FpsController();
  controller.attach(pawn);
  controller.yaw = 0;

  const view = new TraceView();
  view.onTick(world); // seed prev === curr, as app.ts does before the first frame

  const dt = 1 / fps;
  let accumulator = 0;
  let wallMs = 0;
  let tick = 0;
  let frame = 0;
  const samples: Sample[] = [];
  const combatRng = new Rng(1);

  while (tick < SCRIPT_TICKS) {
    const owed = pace(accumulator, dt, 1);
    accumulator = owed.left;
    for (let s = 0; s < owed.steps; s++) {
      if (tick === TURN_TICK) controller.turn(Math.PI / 2, 0);
      if (tick === TURN_TICK + 1) pawn.activity = 'sleeping';
      if (tick === TURN_TICK + 1 + SLEEP) pawn.activity = 'idle';
      const held = keysForTick(tick);
      controller.applyTick(world, pawn, fakeInput({ held, locked: true }), combatRng);
      stepWorld(world, streams);
      view.onTick(world);
      tick++;
    }
    const alpha = alphaOf(owed, 1);
    const at = view.interpolated(pawn.id, alpha);
    const truthAt = view.truth(pawn.id, alpha);
    controller.updateCamera(world, pawn, at.x, at.y, 1 / 60);
    const bobNow = pawn.activity === 'walking' ? settlerBob(pawn.animPhase) : 0;
    samples.push({
      frame,
      wallMs,
      tick,
      x: at.x,
      y: at.y,
      f: at.f,
      eye: controller.camera.position.y,
      eyeOnly: controller.camera.position.y - bobNow,
      activity: pawn.activity,
      bob: bobNow,
      truthX: truthAt.x,
      truthY: truthAt.y,
      truthF: truthAt.f,
    });
    wallMs += dt * 1000;
    frame++;
  }

  return { fps, samples, world, pawn, controller, view, spot };
}

describe('the walk premise: flat, building-free ground holds groundSpeed at 1 and wanted at EYE_HEIGHT throughout', () => {
  it('the chosen corridor has groundSpeed 1 and no building underfoot for the whole 17.4-cell walk+run+turn', () => {
    const world = createWorld(77);
    const spot = clearRun(world);
    expect(groundSpeed(world, Math.round(spot.x), Math.round(spot.y))).toBe(1);
    for (let d = 0; d <= 18; d++) {
      expect(buildingAt(world, spot.x + d, spot.y)).toBeNull();
    }
  });

  it('eyeOnly never moves off EYE_HEIGHT (1.62) from tick 0 through the turn — the ease term is zero without the sleep/wake transient', () => {
    for (const fps of [30, 60, 144]) {
      const r = run(fps);
      const beforeSleep = r.samples.filter((s) => s.tick <= TURN_TICK + 1);
      for (const s of beforeSleep) {
        expect(s.eyeOnly).toBeCloseTo(1.62, 9);
      }
    }
  });
});

describe('per-tick speed is a step function: ticks-to-top = 1, ticks-to-stop = 1', () => {
  it('walk speed is full PLAYER_WALK on the walk\'s first tick (10), run speed is full PLAYER_RUN on the run\'s first tick (50), and displacement is exactly zero on the first tick after release (90) — no ramp either way', () => {
    const world = createWorld(77);
    const streams = makeStreams(world);
    const spot = clearRun(world);
    const pawn = bodyIn(world);
    pawn.x = spot.x;
    pawn.y = spot.y;
    const controller = new FpsController();
    controller.attach(pawn);
    controller.yaw = 0;
    const combatRng = new Rng(1);

    let xBefore = pawn.x;
    for (let tick = 0; tick < STAND + WALK + RUN + 2; tick++) {
      const held = keysForTick(tick);
      controller.applyTick(world, pawn, fakeInput({ held, locked: true }), combatRng);
      stepWorld(world, streams);
      const delta = pawn.x - xBefore;
      if (tick === STAND) expect(delta).toBeCloseTo(PLAYER_WALK, 9); // tick 10
      if (tick === STAND + WALK) expect(delta).toBeCloseTo(PLAYER_RUN, 9); // tick 50
      if (tick === STAND + WALK + RUN) expect(delta).toBeCloseTo(0, 9); // tick 90
      xBefore = pawn.x;
    }
  });
});

describe('shown position at named frames, per fps — literal x-from-spot, facing, wall ms', () => {
  it('30 fps', () => {
    const r = run(30);
    const pins: Array<{ tick: number; frame: number; wallMs: number; xSpot: number; f: number }> = [
      { tick: 0, frame: 1, wallMs: 33.333, xSpot: 0.0, f: 0.797365 },
      { tick: 10, frame: 16, wallMs: 533.333, xSpot: 0.055, f: 0.0 },
      { tick: 50, frame: 76, wallMs: 2533.333, xSpot: 6.69, f: 0.0 },
      { tick: 90, frame: 136, wallMs: 4533.333, xSpot: 17.4, f: 0.0 },
      { tick: 110, frame: 166, wallMs: 5533.333, xSpot: 17.4, f: 0.523599 },
    ];
    for (const p of pins) {
      const s = r.samples[p.frame]!;
      expect(s.tick).toBeGreaterThan(p.tick);
      expect(s.wallMs).toBeCloseTo(p.wallMs, 2);
      expect(s.x - r.spot.x).toBeCloseTo(p.xSpot, 3);
      expect(s.f).toBeCloseTo(p.f, 5);
    }
  });

  it('60 fps', () => {
    const r = run(60);
    const pins: Array<{ tick: number; frame: number; wallMs: number; xSpot: number; f: number }> = [
      { tick: 0, frame: 2, wallMs: 33.333, xSpot: 0.0, f: 1.196047 },
      { tick: 10, frame: 32, wallMs: 533.333, xSpot: 0.0, f: 0.0 },
      { tick: 50, frame: 152, wallMs: 2533.333, xSpot: 6.6, f: 0.0 },
      { tick: 90, frame: 272, wallMs: 4533.333, xSpot: 17.4, f: 0.0 },
      { tick: 110, frame: 332, wallMs: 5533.333, xSpot: 17.4, f: 0.0 },
    ];
    for (const p of pins) {
      const s = r.samples[p.frame]!;
      expect(s.tick).toBeGreaterThan(p.tick);
      expect(s.wallMs).toBeCloseTo(p.wallMs, 2);
      expect(s.x - r.spot.x).toBeCloseTo(p.xSpot, 3);
      expect(s.f).toBeCloseTo(p.f, 5);
    }
  });

  it('144 fps', () => {
    const r = run(144);
    const pins: Array<{ tick: number; frame: number; wallMs: number; xSpot: number; f: number }> = [
      { tick: 0, frame: 7, wallMs: 48.611, xSpot: 0.0, f: 1.063153 },
      { tick: 10, frame: 79, wallMs: 548.611, xSpot: 0.018333, f: 0.0 },
      { tick: 50, frame: 367, wallMs: 2548.611, xSpot: 6.63, f: 0.0 },
      { tick: 90, frame: 655, wallMs: 4548.611, xSpot: 17.4, f: 0.0 },
      { tick: 110, frame: 799, wallMs: 5548.611, xSpot: 17.4, f: 0.174533 },
    ];
    for (const p of pins) {
      const s = r.samples[p.frame]!;
      expect(s.tick).toBeGreaterThan(p.tick);
      expect(s.wallMs).toBeCloseTo(p.wallMs, 2);
      expect(s.x - r.spot.x).toBeCloseTo(p.xSpot, 3);
      expect(s.f).toBeCloseTo(p.f, 5);
    }
  });
});

describe('the eye gap: the stand-up/lie-down transient takes the same 14 frames at every rate, and three different wall times', () => {
  // `updateCamera` eases with `Math.min(1, dt * 9)` where `dt` is the hardcoded
  // `1 / 60` from `app.ts:349` — a fixed 0.85 decay factor per FRAME, not per
  // second, regardless of the real refresh rate. 0.85^14 ≈ 0.1028 is the first
  // power under the 10%-of-gap (0.12 of a 1.2 gap) convergence bar; 0.85^13 ≈
  // 0.1209 just misses it. That closed form is why the frame COUNT to 90% is
  // identical at 30/60/144 fps while the wall-clock TIME it takes is not: a
  // frame is 33.33 ms at 30 fps and 6.94 ms at 144 fps, so the same 14-frame
  // transient plays out in 466.667 ms at 30 fps and 97.222 ms at 144 fps.
  it('wake (sleeping -> idle at tick 131): onset and 90%-converged frames, 30/60/144 fps', () => {
    const wakeTick = TURN_TICK + 1 + SLEEP; // 131
    const cases = [
      { fps: 30, onsetFrame: 198, onsetWallMs: 6600.0, onsetEye: 0.607783, convFrame: 212, convWallMs: 7066.667 },
      { fps: 60, onsetFrame: 395, onsetWallMs: 6583.333, onsetEye: 0.600059, convFrame: 409, convWallMs: 6816.667 },
      { fps: 144, onsetFrame: 950, onsetWallMs: 6597.222, onsetEye: 0.6, convFrame: 964, convWallMs: 6694.444 },
    ];
    for (const c of cases) {
      const r = run(c.fps);
      const onset = r.samples[c.onsetFrame]!;
      expect(onset.tick).toBeGreaterThan(wakeTick);
      expect(onset.wallMs).toBeCloseTo(c.onsetWallMs, 2);
      expect(onset.eyeOnly).toBeCloseTo(c.onsetEye, 5);

      const conv = r.samples[c.convFrame]!;
      expect(conv.wallMs).toBeCloseTo(c.convWallMs, 2);
      expect(Math.abs(1.62 - conv.eyeOnly)).toBeLessThanOrEqual(0.12); // within 10% of the 1.2 gap
      expect(Math.abs(1.62 - r.samples[c.convFrame - 1]!.eyeOnly)).toBeGreaterThan(0.12); // not yet, one frame earlier

      expect(c.convFrame - c.onsetFrame).toBe(14); // same frame count at every rate
    }
  });

  it('sleep (idle -> sleeping at tick 111): onset and 90%-converged frames, 30/60/144 fps', () => {
    const sleepTick = TURN_TICK + 1; // 111
    const cases = [
      { fps: 30, onsetFrame: 168, onsetWallMs: 5600.0, convFrame: 182, convWallMs: 6066.667 },
      { fps: 60, onsetFrame: 335, onsetWallMs: 5583.333, convFrame: 349, convWallMs: 5816.667 },
      { fps: 144, onsetFrame: 806, onsetWallMs: 5597.222, convFrame: 820, convWallMs: 5694.444 },
    ];
    for (const c of cases) {
      const r = run(c.fps);
      const onset = r.samples[c.onsetFrame]!;
      expect(onset.tick).toBeGreaterThan(sleepTick);
      expect(onset.wallMs).toBeCloseTo(c.onsetWallMs, 2);
      expect(onset.eyeOnly).toBeCloseTo(1.44, 6); // exactly one 15%-of-gap step down from 1.62

      const conv = r.samples[c.convFrame]!;
      expect(conv.wallMs).toBeCloseTo(c.convWallMs, 2);
      expect(Math.abs(0.42 - conv.eyeOnly)).toBeLessThanOrEqual(0.12);

      expect(c.convFrame - c.onsetFrame).toBe(14); // same frame count as the wake transient, both directions
    }
  });

  it('the three wake wall-time deltas are 466.667 ms / 233.333 ms / 97.222 ms — same 14 frames, three different clocks', () => {
    const deltas = [30, 60, 144].map((fps) => {
      const r = run(fps);
      const onsetFrame = r.samples.findIndex((s) => s.tick > TURN_TICK + 1 + SLEEP);
      let convFrame = onsetFrame;
      for (let i = onsetFrame; i < r.samples.length; i++) {
        if (Math.abs(1.62 - r.samples[i]!.eyeOnly) <= 0.12) {
          convFrame = i;
          break;
        }
      }
      return r.samples[convFrame]!.wallMs - r.samples[onsetFrame]!.wallMs;
    });
    expect(deltas[0]).toBeCloseTo(466.667, 2);
    expect(deltas[1]).toBeCloseTo(233.333, 2);
    expect(deltas[2]).toBeCloseTo(97.222, 2);
  });
});

describe('the bob staircase: raw animPhase bob changes once per completed sim tick, so it steps once every ~2/3, ~1/3, ~1/7 frames', () => {
  it('30 fps: bob changes on 79 of 119 frame-to-frame steps while walking (~2/3)', () => {
    const r = run(30);
    const walking = r.samples.filter((s) => s.activity === 'walking');
    let changes = 0;
    for (let i = 1; i < walking.length; i++) if (walking[i]!.bob !== walking[i - 1]!.bob) changes++;
    expect(walking.length).toBe(120);
    expect(changes).toBe(79);
    expect(changes / (walking.length - 1)).toBeCloseTo(2 / 3, 1);
  });

  it('60 fps: bob changes on 79 of 239 frame-to-frame steps while walking (~1/3)', () => {
    const r = run(60);
    const walking = r.samples.filter((s) => s.activity === 'walking');
    let changes = 0;
    for (let i = 1; i < walking.length; i++) if (walking[i]!.bob !== walking[i - 1]!.bob) changes++;
    expect(walking.length).toBe(240);
    expect(changes).toBe(79);
    expect(changes / (walking.length - 1)).toBeCloseTo(1 / 3, 1);
  });

  it('144 fps: bob changes on 79 of 575 frame-to-frame steps while walking (~1/7)', () => {
    const r = run(144);
    const walking = r.samples.filter((s) => s.activity === 'walking');
    let changes = 0;
    for (let i = 1; i < walking.length; i++) if (walking[i]!.bob !== walking[i - 1]!.bob) changes++;
    expect(walking.length).toBe(576);
    expect(changes).toBe(79);
    expect(changes / (walking.length - 1)).toBeCloseTo(1 / 7, 1);
  });
});

describe('today\'s interpolation against an independent truth line (curr + v·alpha) — four metrics, each with a tolerance', () => {
  // `truth - interpolated === curr - prev` exactly, so the peak gap is the
  // largest single-tick displacement — PLAYER_RUN, 0.27 — and it recurs every
  // tick of the run, not just once, so mean error sits well under the peak.
  it.each([30, 60, 144])('fps %i: mean/max positional error, steady-run jitter, max heading error', (fps) => {
    const r = run(fps);
    let sumErr = 0;
    let maxErr = 0;
    let maxHeadErr = 0;
    for (const s of r.samples) {
      const e = Math.hypot(s.truthX - s.x, s.truthY - s.y);
      sumErr += e;
      maxErr = Math.max(maxErr, e);
      maxHeadErr = Math.max(maxHeadErr, Math.abs(shortestAngle(s.f, s.truthF)));
    }
    const meanErr = sumErr / r.samples.length;

    expect(meanErr).toBeGreaterThan(0.1);
    expect(meanErr).toBeLessThan(0.12); // tolerance band; exact value drifts a few thousandths with fps due to sampling alignment
    expect(maxErr).toBeCloseTo(PLAYER_RUN, 6); // exactly one run tick's displacement
    expect(maxHeadErr).toBeCloseTo(Math.PI / 2, 6); // exactly the 90° turn's own magnitude

    // Jitter: frame-to-frame speed of the RENDERED (interpolated) position
    // during the steady run (ticks 60..85, clear of the run's own onset).
    const steady = r.samples.filter((s) => s.tick >= 60 && s.tick <= 85);
    const speeds: number[] = [];
    for (let i = 1; i < steady.length; i++) {
      speeds.push(Math.hypot(steady[i]!.x - steady[i - 1]!.x, steady[i]!.y - steady[i - 1]!.y) / (1 / fps));
    }
    const meanSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const variance = speeds.reduce((a, b) => a + (b - meanSpeed) ** 2, 0) / speeds.length;
    expect(meanSpeed).toBeCloseTo(5.4, 6); // PLAYER_RUN * TICKS_PER_SECOND
    expect(Math.sqrt(variance)).toBeCloseTo(0, 9); // today's lerp of constant-velocity motion is itself constant velocity: zero jitter
  });

  it.each([
    { fps: 30, latencyMs: 33.333 },
    { fps: 60, latencyMs: 16.667 },
    { fps: 144, latencyMs: 6.944 },
  ])('fps $fps: latency from release (tick 90) to the first zero-delta frame is one render frame ($latencyMs ms)', ({ fps, latencyMs }) => {
    const r = run(fps);
    const releaseTick = STAND + WALK + RUN; // 90
    const releaseIdx = r.samples.findIndex((s) => s.tick > releaseTick);
    let stopIdx = -1;
    for (let i = releaseIdx; i < r.samples.length - 1; i++) {
      const d = Math.hypot(r.samples[i + 1]!.x - r.samples[i]!.x, r.samples[i + 1]!.y - r.samples[i]!.y);
      if (d < 1e-9) {
        stopIdx = i + 1;
        break;
      }
    }
    expect(stopIdx).toBeGreaterThan(releaseIdx);
    expect(r.samples[stopIdx]!.wallMs - r.samples[releaseIdx]!.wallMs).toBeCloseTo(latencyMs, 2);
  });
});

describe('speed ×3 fast-forward: pace() compresses wall time without skipping or double-counting a tick', () => {
  it('at 30 fps, reaching tick 50 (end of the walk) takes 25 frames / 833.333 ms at speed=3 vs 76 frames / 2533.333 ms at speed=1', () => {
    function walkToTick50(speed: number): { frames: number; wallMs: number; tick: number; accumulator: number; xSpot: number } {
      const world = createWorld(77);
      const streams = makeStreams(world);
      const spot = clearRun(world);
      const pawn = bodyIn(world);
      pawn.x = spot.x;
      pawn.y = spot.y;
      const controller = new FpsController();
      controller.attach(pawn);
      controller.yaw = 0;
      const combatRng = new Rng(1);

      const dt = 1 / 30;
      let accumulator = 0;
      let tick = 0;
      let frame = 0;
      let wallMs = 0;
      while (tick < STAND + WALK) {
        const owed = pace(accumulator, dt, speed);
        accumulator = owed.left;
        for (let s = 0; s < owed.steps && tick < STAND + WALK; s++) {
          const held = keysForTick(tick);
          controller.applyTick(world, pawn, fakeInput({ held, locked: true }), combatRng);
          stepWorld(world, streams);
          tick++;
        }
        wallMs += dt * 1000;
        frame++;
      }
      return { frames: frame, wallMs, tick, accumulator, xSpot: pawn.x - spot.x };
    }

    const fast = walkToTick50(3);
    expect(fast.frames).toBe(25);
    expect(fast.wallMs).toBeCloseTo(833.333, 2);
    expect(fast.tick).toBe(50);
    expect(fast.accumulator).toBeCloseTo(0, 9); // 1/30 * 3 == 2 * TICK_DT exactly, so nothing is ever owed
    expect(fast.xSpot).toBeCloseTo(PLAYER_WALK * WALK, 9);

    const real = walkToTick50(1);
    // 50 ticks * TICK_DT is 2.5s of simulated time, which real-number math puts
    // at 75 frames of 1/30 s — but summing the double `1/30` seventy-five times
    // lands a hair under 2.5s (binary can't hold a thirtieth exactly), so
    // `pace`'s strict `left >= TICK_DT` doesn't award the 50th tick until one
    // frame later. 76, not 75, is what the accumulator actually does, pinned
    // rather than rounded to the number real-number math would suggest.
    expect(real.frames).toBe(76);
    expect(real.wallMs).toBeCloseTo(2533.333, 2);
    expect(real.tick).toBe(50);
    expect(real.xSpot).toBeCloseTo(fast.xSpot, 9); // same sim outcome, ~3x the wall time
  });
});

describe('a >2-cell teleport snaps instead of lerping across the gap', () => {
  it.each([30, 60, 144])('fps %i: interpolated(0) === interpolated(1) === the new position, not a lerp toward it', (fps) => {
    const r = run(fps);
    const beforeX = r.pawn.x;
    r.pawn.x += 10; // 10 cells, well past SNAP_CELLS (2)
    const naiveHalfway = beforeX + (r.pawn.x - beforeX) * 0.5; // what a lerp WITHOUT the snap rule would show
    r.view.onTick(r.world);

    const atStart = r.view.interpolated(r.pawn.id, 0);
    const atMid = r.view.interpolated(r.pawn.id, 0.5);
    const atEnd = r.view.interpolated(r.pawn.id, 1);

    expect(atStart.x).toBeCloseTo(r.pawn.x, 6);
    expect(atMid.x).toBeCloseTo(r.pawn.x, 6);
    expect(atEnd.x).toBeCloseTo(r.pawn.x, 6);
    expect(Math.abs(naiveHalfway - r.pawn.x)).toBeCloseTo(5, 6); // the naive lerp this rule replaces would sit 5 cells short
  });
});
