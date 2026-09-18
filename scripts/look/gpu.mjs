/**
 * What a frame cost the card, reduced from raw samples to one honest line.
 *
 * The wall clock this harness has taken for ten rounds is the swap interval and
 * nothing else: it is measured across `requestAnimationFrame` callbacks, which the
 * display pins to its own 60 Hz, so every frame that fits the budget reads 17 ms and
 * so does every other one. The change that first ran under it took the colony frame
 * from 189 draw calls to 123 without moving the millisecond at all. This file is the
 * other half of that number — how long the GPU was actually busy — and its whole job
 * is to refuse to guess when it does not know.
 *
 * Nothing is imported here on purpose. `tests/look-gpu.test.ts` reaches into
 * `scripts/look/` to unit-test this reducer, and an import would drag
 * `scripts/look/node_modules` (puppeteer and its tree) into a vitest worker that has
 * no business loading it. The browser-side collection lives in `shot.mjs`, where the
 * page is; everything that can be tested without a GPU lives here, where it can.
 *
 * The rule the whole file serves, from the vault scar: **degrade in the product, fail
 * in the measurement.** A renderer that quietly drops to a slower path is being kind;
 * an instrument that quietly reports a number it did not measure is lying, and a lying
 * instrument is worse than no instrument because every later round compares against
 * it. So there is no fallback value anywhere below. Too few samples, every sample
 * spoiled, a counter that reports zero — each comes back `n/a`, and `n/a` is printed
 * as `n/a`.
 *
 * ## Why there is only one method, and why it is not the timer query
 *
 * `2a`'s brief expected ANGLE-Metal to expose no timestamp queries at all — the
 * documented macOS history — and designed a fence around that. Measured on this box
 * on 2026-09-18, the opposite is true and it is worse than absence:
 * `EXT_disjoint_timer_query_webgl2` is listed, reports 64 counter bits, answers every
 * query, never flags a disjoint batch, moves its counter with the load — and is wrong
 * by about five times. Rendering the same frame N times inside one measured window:
 *
 *     N    gl.finish()   per render     TIME_ELAPSED_EXT   per render
 *     1      1.8 ms         1.8            5.479 ms           5.5
 *     2      3.2 ms         1.6           17.229 ms           8.6
 *     4      6.8 ms         1.7           34.946 ms           8.7
 *
 * The stall is linear in the work — `1.7·N + 0.1`, a real per-frame cost with about a
 * tenth of a millisecond of overhead. The timer query is not proportional to anything:
 * it sits near 8.7 ms a render however many renders are in the window, takes a
 * different ratio at N=1, and is not even repeatable with itself (7.40 ms and then
 * 5.06 ms for the identical frame at the identical size). A number that large cannot
 * be the frame's GPU time in any case: `gl.finish` bounds the same draws at 1.8 ms,
 * and elapsed time on the card cannot exceed a wall-clock window that opens before the
 * commands are recorded and closes after every one of them has completed.
 *
 * So the extension is not used. Not as a primary, not as a fallback, not printed
 * beside the real number — a plausible wrong number in a log is how a later round
 * gets sent after a regression that never happened. The rAF-polled fence the brief
 * designed is not used either, for a quieter reason: it resolves to one display frame,
 * about 16.7 ms, which is ten times coarser than the 1.7 ms it would have to measure.
 * That is what `--disable-gpu-vsync` was in the brief to rescue, and it is why that
 * flag is not adopted — the stall does not poll on frames, so there is nothing for the
 * flag to buy.
 */

/** Below this many clean samples the spread is noise, so no number is reported. */
export const MIN_VALID_SAMPLES = 10;

/**
 * The reading is in milliseconds and a real frame of this game is milliseconds.
 * Anything at or under this is the instrument telling us it did not actually time
 * anything — a measurement that always answers zero looks exactly like a frame that
 * cost nothing, and one of those two is not possible.
 */
export const ZERO_MS = 1e-6;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Raw samples in, a verdict out. `raw` is what the page collected:
 *
 *   `{ method: 'finish', samples: number[], spoiled: number }`
 *
 * `samples` are milliseconds of submit-to-drained wall time around one `render`, and
 * `spoiled` is how many candidate frames the page threw away before they became
 * samples — a frame in which the app drew nothing is not a cheap frame, it is not a
 * frame, and averaging it in would drag the median toward a number no player ever
 * waited for. It is carried through only so the round note can say how much was
 * discarded. `null` means the page could not measure at all: no context, no app.
 *
 * Returns `{ method, median, max, valid, spoiled, reason }` with `method` either
 * `finish` or `n/a`. When it is `n/a`, `median` and `max` are `null` — not 0, which is
 * a number a caller could print.
 */
export function reduceGpu(raw) {
  const none = (reason, extra = {}) => ({
    method: 'n/a',
    median: null,
    max: null,
    valid: 0,
    spoiled: 0,
    reason,
    ...extra,
  });

  if (!raw || typeof raw !== 'object') return none('nothing measured');
  const { method, samples, spoiled = 0 } = raw;
  if (method !== 'finish') return none('no method', { spoiled });
  if (!Array.isArray(samples)) return none('no samples', { spoiled });

  // A negative or non-finite reading is a broken clock, not a fast frame.
  const clean = samples.filter((s) => typeof s === 'number' && Number.isFinite(s) && s >= 0);

  // Every reading at zero means the stall returned without waiting for anything.
  // Reporting `gpu 0.0/0.0 ms` there would be the exact failure this file exists to
  // prevent, so it fails instead.
  if (clean.length && clean.every((s) => s <= ZERO_MS)) {
    return none('clock never moved', { valid: clean.length, spoiled });
  }

  if (clean.length < MIN_VALID_SAMPLES) {
    return none(`only ${clean.length} of ${MIN_VALID_SAMPLES} samples`, {
      valid: clean.length,
      spoiled,
    });
  }

  return {
    method,
    median: median(clean),
    max: Math.max(...clean),
    valid: clean.length,
    spoiled,
    reason: null,
  };
}

/**
 * The line that goes beside the draw calls. Always carries how it was measured, so
 * that a later round reading `gpu 1.7 ms` in a note knows what claim it is: not the
 * card's own counter for the draw — that counter was measured to be wrong here and is
 * not used — but the wall time from submitting one frame's commands to the queue
 * standing empty again, which the stall makes an upper bound and the measurement above
 * shows to be within about a tenth of a millisecond of the real per-frame cost.
 */
export function formatGpu(reduced) {
  if (!reduced || reduced.method === 'n/a') return 'gpu n/a';
  const { median: med, max, method } = reduced;
  return `gpu ${med.toFixed(1)}/${max.toFixed(1)} ms (${method})`;
}
