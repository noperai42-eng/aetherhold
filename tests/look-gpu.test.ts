/**
 * `2a-frame-gpu-timer` — the GPU reducer, judged without a GPU.
 *
 * Everything here is about the one rule the instrument serves: **degrade in the
 * product, fail in the measurement.** A renderer dropping to a slower path is being
 * kind; an instrument reporting a number it did not measure is lying, and every later
 * look round compares against that number. So most of these tests are about the ways
 * the reducer must refuse, not the one way it succeeds.
 *
 * One of those refusals is the whole finding of the round. This box lists
 * `EXT_disjoint_timer_query_webgl2`, reports 64 counter bits, answers every query and
 * flags no disjoint batch — and overstates the frame by about five times (see the
 * header of `scripts/look/gpu.mjs` for the measurement). So `'timer'` is not a method
 * the reducer will take, and the test below is what keeps it from quietly coming back.
 *
 * No browser, no GPU, no puppeteer: `scripts/look/gpu.mjs` imports nothing, which is
 * what lets a vitest worker load it without dragging `scripts/look/node_modules` in.
 */

import { describe, expect, it } from 'vitest';

import { MIN_VALID_SAMPLES, formatGpu, reduceGpu } from '../scripts/look/gpu.mjs';

/** `n` samples around `ms`, deterministic — a real card's spread, not random. */
function samples(n: number, ms: number, spread = 0.4): number[] {
  return Array.from({ length: n }, (_, i) => ms + ((i % 5) - 2) * spread);
}

describe('the GPU reducer reports what it measured, or nothing (2a-frame-gpu-timer)', () => {
  it('reduces a clean batch to a median and a max, and says which method took it', () => {
    const r = reduceGpu({ method: 'finish', samples: samples(12, 4.0), spoiled: 0 });
    expect(r.method).toBe('finish');
    expect(r.valid).toBe(12);
    // The helper's offsets cycle -0.8 .. +0.8 around 4.0, so twelve samples land
    // three-at-3.2 up to two-at-4.8 and the median falls between 3.6 and 4.0.
    expect(r.median).toBeCloseTo(3.8, 10);
    expect(r.max).toBeCloseTo(4.8, 10);
    expect(r.reason).toBeNull();

    // The method is never dropped from the line. It says what claim the number is:
    // not the card's own counter for the draw, but the wall time from submitting the
    // frame to the queue standing empty again.
    expect(formatGpu(r)).toBe('gpu 3.8/4.8 ms (finish)');
  });

  it('refuses a timer-query batch outright, however clean it looks', () => {
    // The round's finding, pinned. On this box the extension is listed, answers with
    // 64 counter bits, never flags a disjoint batch, and reports about five times the
    // frame's real cost — measured against a gl.finish() stall on the same draws, and
    // against itself at 1, 2 and 4 renders inside one window. A wrong number that
    // looks this healthy is worse than no number, so it is not a method at all.
    const r = reduceGpu({ method: 'timer', samples: samples(24, 8.7), spoiled: 0 } as never);
    expect(r.method).toBe('n/a');
    expect(r.median).toBeNull();
    expect(r.max).toBeNull();
    expect(r.reason).toBe('no method');
    expect(formatGpu(r)).toBe('gpu n/a');

    // And the same for the rAF-polled fence the brief designed: it resolves to one
    // display frame, ten times coarser than the frame it would measure.
    expect(reduceGpu({ method: 'fence', samples: samples(24, 4.0) } as never).method).toBe('n/a');
  });

  it('refuses a batch that is one sample short of the floor, rather than reporting a thinner number', () => {
    const short = reduceGpu({
      method: 'finish',
      samples: samples(MIN_VALID_SAMPLES - 1, 4.0),
      spoiled: 0,
    });
    expect(short.method).toBe('n/a');
    expect(short.median).toBeNull();
    expect(short.max).toBeNull();
    expect(short.reason).toBe(`only ${MIN_VALID_SAMPLES - 1} of ${MIN_VALID_SAMPLES} samples`);
    expect(formatGpu(short)).toBe('gpu n/a');

    // And takes it at exactly the floor, so the boundary is pinned on both sides.
    const exact = reduceGpu({
      method: 'finish',
      samples: samples(MIN_VALID_SAMPLES, 4.0),
      spoiled: 0,
    });
    expect(exact.method).toBe('finish');
    expect(exact.valid).toBe(MIN_VALID_SAMPLES);
  });

  it('calls an all-zero batch n/a, because a stall that did not wait and a free frame look identical', () => {
    const zero = reduceGpu({ method: 'finish', samples: new Array(20).fill(0), spoiled: 0 });
    expect(zero.method).toBe('n/a');
    expect(zero.reason).toBe('clock never moved');
    expect(zero.valid).toBe(20);
    expect(formatGpu(zero)).toBe('gpu n/a');
  });

  it('drops a broken reading rather than averaging it in, and then judges what is left', () => {
    // A negative or non-finite reading is a broken clock, not a fast frame. Twelve
    // samples with two rotten ones leaves ten, which is exactly the floor.
    const withRot = [...samples(10, 4.0), -1, Number.NaN];
    const r = reduceGpu({ method: 'finish', samples: withRot, spoiled: 0 });
    expect(r.method).toBe('finish');
    expect(r.valid).toBe(10);

    // One fewer good sample and the same rot takes it under the floor.
    const under = reduceGpu({
      method: 'finish',
      samples: [...samples(9, 4.0), -1, Number.NaN],
      spoiled: 0,
    });
    expect(under.method).toBe('n/a');
  });

  it('carries the spoiled count through so the note can say how much was thrown away', () => {
    // A frame in which the app drew nothing is not a cheap frame, it is not a frame.
    // The page drops those before they become samples; this number is the only
    // evidence left that they happened, and a run with many of them is a run whose
    // median is worth less even though it is a real median.
    const r = reduceGpu({ method: 'finish', samples: samples(14, 4.0), spoiled: 6 });
    expect(r.method).toBe('finish');
    expect(r.spoiled).toBe(6);
    expect(r.valid).toBe(14);
  });

  it('says n/a for every shape of nothing, and never throws on one', () => {
    // The page returns null when there is no app or no context, and the harness must
    // print a line either way — a look round that dies on its own instrument has lost
    // the frames too.
    for (const raw of [null, undefined, {}, { method: 'finish' }, { method: 'nonsense', samples: samples(12, 4) }]) {
      const r = reduceGpu(raw as never);
      expect(r.method).toBe('n/a');
      expect(r.median).toBeNull();
      expect(formatGpu(r)).toBe('gpu n/a');
    }
    expect(formatGpu(null as never)).toBe('gpu n/a');
  });

  it('never formats a bare number, under any reduction it can produce', () => {
    // The standing rule in one assertion: whatever comes out of the reducer, the
    // printed line either names the method or says n/a. Nothing in between.
    const shapes = [
      { method: 'finish', samples: samples(12, 4.0), spoiled: 0 },
      { method: 'finish', samples: samples(12, 16.7), spoiled: 3 },
      { method: 'finish', samples: samples(3, 4.0), spoiled: 0 },
      { method: 'finish', samples: new Array(12).fill(0), spoiled: 0 },
      { method: 'timer', samples: samples(24, 8.7), spoiled: 0 },
      null,
    ];
    for (const s of shapes) {
      const line = formatGpu(reduceGpu(s as never));
      expect(line === 'gpu n/a' || /^gpu \d+\.\d+\/\d+\.\d+ ms \(finish\)$/.test(line)).toBe(true);
      expect(line).not.toBe('gpu 0.0/0.0 ms (finish)');
    }
  });
});
