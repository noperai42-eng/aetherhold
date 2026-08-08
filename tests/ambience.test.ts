/**
 * Ambience drives a real Web Audio graph in the browser, but nothing here needs
 * real audio hardware — only that the graph is wired the way `update()` promises
 * and that gain automation behaves. This fake implements exactly the AudioNode
 * surface Ambience touches (createGain, createOscillator, createBufferSource,
 * createBiquadFilter, createBuffer, currentTime, sampleRate); anything beyond
 * that would be untested surface, not a fixture.
 *
 * The fake's AudioParam distinguishes *scheduled automation* (setTargetAtTime,
 * setValueAtTime, ramps — all fine, all recorded) from a bare `.value =` write
 * (recorded separately) so a test can prove no continuous voice was ever stepped.
 *
 * Every driver in every test here is a fixed number or a deterministic function
 * of a loop index — never Math.random() — and chorus spacing is pinned via the
 * class's injectable RandomFn so chirp timing can't make a run flaky.
 */

import { describe, expect, it } from 'vitest';

import { Ambience, type AmbienceState } from '../src/client/audio/ambience';

// ---------------------------------------------------------------- fake Web Audio

interface RampCall {
  target: number;
  time: number;
}

class FakeParam {
  private v = 0;
  readonly ramps: RampCall[] = [];

  constructor(private readonly rawWriteLog: number[]) {}

  get value(): number {
    return this.v;
  }

  /** A bare assignment — exactly the click-on-a-continuous-voice bug these tests pin. */
  set value(x: number) {
    this.rawWriteLog.push(x);
    this.v = x;
  }

  setTargetAtTime(target: number, time: number, _timeConstant: number): FakeParam {
    this.ramps.push({ target, time });
    this.v = target;
    return this;
  }

  setValueAtTime(value: number, time: number): FakeParam {
    this.ramps.push({ target: value, time });
    this.v = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeParam {
    this.ramps.push({ target: value, time });
    this.v = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, _time: number): FakeParam {
    this.v = value;
    return this;
  }
}

class FakeGainNode {
  readonly gain: FakeParam;
  constructor(log: number[]) {
    this.gain = new FakeParam(log);
  }
  connect<T>(dest: T): T {
    return dest;
  }
  disconnect(): void {}
}

class FakeBiquadFilterNode {
  type = 'lowpass';
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  constructor(log: number[]) {
    this.frequency = new FakeParam(log);
    this.Q = new FakeParam(log);
  }
  connect<T>(dest: T): T {
    return dest;
  }
  disconnect(): void {}
}

class FakeOscillatorNode {
  type = 'sine';
  readonly frequency: FakeParam;
  stopped = false;
  constructor(log: number[]) {
    this.frequency = new FakeParam(log);
  }
  connect<T>(dest: T): T {
    return dest;
  }
  disconnect(): void {}
  start(_when?: number): void {}
  stop(_when?: number): void {
    this.stopped = true;
  }
}

class FakeBufferSourceNode {
  buffer: unknown = null;
  loop = false;
  stopped = false;
  connect<T>(dest: T): T {
    return dest;
  }
  disconnect(): void {}
  start(_when?: number): void {}
  stop(_when?: number): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  /** Every bare `.value =` write across every param this context has handed out. */
  readonly rawWrites: number[] = [];
  readonly created = {
    gains: [] as FakeGainNode[],
    oscillators: [] as FakeOscillatorNode[],
    bufferSources: [] as FakeBufferSourceNode[],
    filters: [] as FakeBiquadFilterNode[],
    buffers: 0,
  };

  createGain(): FakeGainNode {
    const node = new FakeGainNode(this.rawWrites);
    this.created.gains.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode(this.rawWrites);
    this.created.oscillators.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.created.bufferSources.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const node = new FakeBiquadFilterNode(this.rawWrites);
    this.created.filters.push(node);
    return node;
  }

  createBuffer(_channels: number, length: number, _sampleRate: number): { getChannelData: (ch: number) => Float32Array } {
    this.created.buffers++;
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

// The cast points: Ambience is typed against the real DOM interfaces, so the fake
// has to cross an `unknown` bridge rather than structurally match dozens of members
// (automationRate, defaultValue, ...) it never touches. This is the standard shape
// for a hand-written Web Audio test double, not a loophole.
function asCtx(ctx: FakeAudioContext): AudioContext {
  return ctx as unknown as AudioContext;
}
function asGain(node: FakeGainNode): GainNode {
  return node as unknown as GainNode;
}

// ---------------------------------------------------------------- test helpers

/** Chirp spacing is the only randomness Ambience has; pin it so runs are repeatable. */
const noRandomness = (): number => 0;

function baseState(overrides: Partial<AmbienceState> = {}): AmbienceState {
  return {
    timeOfDay: 0.5,
    daylight: 1,
    rain: 0,
    wind: 0,
    threat: 0,
    indoors: false,
    firstPerson: true,
    ...overrides,
  };
}

function isStrictlyIncreasing(xs: number[]): boolean {
  return xs.length > 1 && xs.every((x, i) => i === 0 || x > xs[i - 1]);
}

/**
 * Gain nodes belonging to a continuous voice get exactly one ramp per update()
 * call. A one-shot chirp's envelope also happens to ramp upward for one segment,
 * but it only ever gets two ramp calls total regardless of how long a test runs
 * update() for — so requiring "one ramp per touch" is what separates the layer
 * we're sweeping from a chirp that happened to fire during the same test.
 */
function risingContinuousGains(ctx: FakeAudioContext, touches: number): FakeGainNode[] {
  return ctx.created.gains.filter(
    (g) => g.gain.ramps.length === touches && isStrictlyIncreasing(g.gain.ramps.map((r) => r.target)),
  );
}

function lastTarget(param: FakeParam): number {
  return param.ramps.length > 0 ? param.ramps[param.ramps.length - 1].target : param.value;
}

function totalNodes(ctx: FakeAudioContext): number {
  return (
    ctx.created.gains.length +
    ctx.created.oscillators.length +
    ctx.created.bufferSources.length +
    ctx.created.filters.length +
    ctx.created.buffers
  );
}

function totalRampCalls(ctx: FakeAudioContext): number {
  let n = 0;
  for (const g of ctx.created.gains) n += g.gain.ramps.length;
  for (const f of ctx.created.filters) n += f.frequency.ramps.length + f.Q.ramps.length;
  for (const o of ctx.created.oscillators) n += o.frequency.ramps.length;
  return n;
}

function startedAmbience(): { ctx: FakeAudioContext; amb: Ambience } {
  const ctx = new FakeAudioContext();
  const amb = new Ambience(noRandomness);
  amb.start(asCtx(ctx), asGain(ctx.createGain()));
  return { ctx, amb };
}

// ---------------------------------------------------------------- functional

describe('Ambience — signal shaping', () => {
  it('ramps the wind gain smoothly up with the wind driver, and reaches true silence at zero', () => {
    const { ctx, amb } = startedAmbience();
    for (const wind of [0, 0.25, 0.5, 0.75, 1]) {
      amb.update(baseState({ wind, rain: 0, threat: 0, daylight: 1, indoors: false }), 1 / 60);
    }
    // Rain, threat and daylight never moved, so exactly one gain node should have
    // tracked the sweep — the wind voice.
    const risers = risingContinuousGains(ctx, 5);
    expect(risers).toHaveLength(1);
    expect(risers[0].gain.ramps[0].target).toBe(0); // dead calm is genuinely silent
  });

  it('ramps the rain gain smoothly up with the rain driver, and reaches true silence at zero', () => {
    const { ctx, amb } = startedAmbience();
    for (const rain of [0, 0.25, 0.5, 0.75, 1]) {
      amb.update(baseState({ rain, wind: 0, threat: 0, daylight: 1, indoors: false }), 1 / 60);
    }
    const risers = risingContinuousGains(ctx, 5);
    expect(risers).toHaveLength(1);
    // This is the regression a stray "+ floor" constant in the gain formula would
    // trip: a clear day (rain = 0) must be free of rain noise, not just quieter.
    expect(risers[0].gain.ramps[0].target).toBe(0);
  });

  it('raises the threat drone as threat climbs, so a raid is felt before it is seen', () => {
    const { ctx, amb } = startedAmbience();
    for (const threat of [0, 0.25, 0.5, 0.75, 1]) {
      amb.update(baseState({ threat, wind: 0, rain: 0, daylight: 1, indoors: false }), 1 / 60);
    }
    const risers = risingContinuousGains(ctx, 5);
    expect(risers).toHaveLength(1);
    expect(risers[0].gain.ramps[0].target).toBe(0);
    expect(lastTarget(risers[0].gain)).toBeGreaterThan(0);
  });

  it('crossfades the night chorus in as daylight fades, rather than switching', () => {
    const { ctx, amb } = startedAmbience();
    for (const daylight of [1, 0.75, 0.5, 0.25, 0]) {
      amb.update(baseState({ daylight, wind: 0, rain: 0, threat: 0, indoors: false }), 1 / 60);
    }
    // A hard switch would show up as flat-then-jump (equal, equal, jump), which
    // fails "strictly increasing" — only a genuine glide passes every step.
    const risers = risingContinuousGains(ctx, 5);
    expect(risers).toHaveLength(1);
    expect(risers[0].gain.ramps[0].target).toBe(0); // full daylight: crickets are silent
  });

  it('drops the outdoor filter cutoff — and only that filter — when the colonist steps indoors', () => {
    const { ctx, amb } = startedAmbience();
    const steps = [false, false, true, true];
    for (const indoors of steps) {
      amb.update(baseState({ wind: 0.6, rain: 0, threat: 0, daylight: 1, indoors }), 1 / 60);
    }
    const dropped = ctx.created.filters.filter((f) => {
      const targets = f.frequency.ramps.map((r) => r.target);
      return targets.length === steps.length && targets[2] < targets[1];
    });
    // The wind bandpass frequency tracks wind (held constant here), not indoors, so
    // only the shared outdoor lowpass should show a drop at the indoors transition.
    expect(dropped).toHaveLength(1);
    expect(dropped[0].frequency.ramps[3].target).toBeLessThan(dropped[0].frequency.ramps[0].target);
  });

  it('never assigns a continuous voice directly — every change after start() is a ramp', () => {
    const { ctx, amb } = startedAmbience();
    const staticWrites = ctx.rawWrites.length; // start() sets initial values directly; that's construction, not automation

    for (let i = 0; i < 30; i++) {
      amb.update(
        baseState({
          wind: Math.abs(Math.sin(i)),
          rain: Math.abs(Math.cos(i)),
          threat: (i % 10) / 10,
          daylight: 1 - (i % 20) / 20,
          indoors: i % 2 === 0,
          firstPerson: i % 3 === 0,
        }),
        1 / 60,
      );
    }

    expect(ctx.rawWrites.length).toBe(staticWrites);
  });

  it('silences every weather-driven layer when disabled, without touching the view scalar', () => {
    const ctxOn = new FakeAudioContext();
    const ambOn = new Ambience(noRandomness);
    ambOn.start(asCtx(ctxOn), asGain(ctxOn.createGain()));

    const ctxOff = new FakeAudioContext();
    const ambOff = new Ambience(noRandomness);
    ambOff.enabled = false;
    ambOff.start(asCtx(ctxOff), asGain(ctxOff.createGain()));

    const drive = { wind: 1, rain: 1, threat: 1, daylight: 0, indoors: false, firstPerson: true };
    for (let i = 0; i < 10; i++) {
      ambOn.update(baseState(drive), 1 / 60);
      ambOff.update(baseState(drive), 1 / 60);
    }

    // Both graphs are built by the identical code path, so nodes line up index for
    // index — no need to know which node is "the wind gain" to compare them.
    let anyDiffered = false;
    for (let i = 0; i < ctxOn.created.gains.length; i++) {
      const on = lastTarget(ctxOn.created.gains[i].gain);
      const off = lastTarget(ctxOff.created.gains[i].gain);
      if (on !== off) {
        anyDiffered = true;
        expect(off).toBe(0); // disabled means muted, not merely quieter
      }
    }
    expect(anyDiffered).toBe(true);
  });

  it('fires sparse day-chorus chirps only while the sun is up, and stays quiet at night', () => {
    const day = new FakeAudioContext();
    const dayAmb = new Ambience(noRandomness);
    dayAmb.start(asCtx(day), asGain(day.createGain()));
    const dayBaseline = day.created.oscillators.length; // threat x2, cricket, cricket LFO
    for (let i = 0; i < 120; i++) dayAmb.update(baseState({ daylight: 1 }), 1 / 60); // two seconds of broad daylight
    expect(day.created.oscillators.length).toBeGreaterThan(dayBaseline);

    const night = new FakeAudioContext();
    const nightAmb = new Ambience(noRandomness);
    nightAmb.start(asCtx(night), asGain(night.createGain()));
    const nightBaseline = night.created.oscillators.length;
    for (let i = 0; i < 120; i++) nightAmb.update(baseState({ daylight: 0 }), 1 / 60);
    expect(night.created.oscillators.length).toBe(nightBaseline);
  });
});

// ---------------------------------------------------------------- experience

describe('Ambience — the lifecycle the caller drives', () => {
  it('does nothing before start() — never throws, never builds', () => {
    const amb = new Ambience(noRandomness);
    expect(() => amb.update(baseState(), 1 / 60)).not.toThrow();
  });

  it('builds exactly one graph even if start() is called again before stop()', () => {
    const ctx = new FakeAudioContext();
    const amb = new Ambience(noRandomness);
    const bus = asGain(ctx.createGain());

    amb.start(asCtx(ctx), bus);
    const first = totalNodes(ctx);
    expect(first).toBeGreaterThan(0);

    amb.start(asCtx(ctx), bus); // the second call, mid-session, after a later user gesture
    expect(totalNodes(ctx)).toBe(first);
  });

  it('survives a full simulated day of drifting weather at 60 Hz without throwing or producing bad gains', () => {
    const { ctx, amb } = startedAmbience();

    const run = (): void => {
      const frames = 2000; // a compressed "day" — enough drift to cover every branch, fast to run
      for (let i = 0; i < frames; i++) {
        const phase = i / frames;
        amb.update(
          {
            timeOfDay: phase,
            daylight: (Math.sin(phase * Math.PI * 2) + 1) / 2,
            rain: Math.max(0, Math.sin(phase * Math.PI * 6)),
            wind: (Math.sin(phase * Math.PI * 4) + 1) / 2,
            threat: (Math.sin(phase * Math.PI * 3) + 1) / 2,
            indoors: i % 200 < 40,
            firstPerson: i % 300 < 150,
          },
          1 / 60,
        );
      }
    };

    expect(run).not.toThrow();

    for (const g of ctx.created.gains) {
      for (const r of g.gain.ramps) {
        expect(Number.isFinite(r.target)).toBe(true);
        expect(r.target).toBeGreaterThanOrEqual(0);
        expect(r.target).toBeLessThanOrEqual(1); // generous ceiling — real values sit far below the stingers' 0.5 peak
      }
    }
    for (const f of ctx.created.filters) {
      expect(Number.isFinite(f.frequency.value)).toBe(true);
      expect(f.frequency.value).toBeGreaterThan(0);
    }
  });

  it('goes silent for good after stop() — the continuous voices actually stop, and update() afterward is inert', () => {
    const { ctx, amb } = startedAmbience();
    amb.update(baseState({ daylight: 0 }), 1 / 60); // night: no chirp to add a stray oscillator
    amb.stop();

    for (const osc of ctx.created.oscillators) expect(osc.stopped).toBe(true);
    for (const src of ctx.created.bufferSources) expect(src.stopped).toBe(true);

    const rampsBeforeMore = totalRampCalls(ctx);
    expect(() => amb.update(baseState(), 1 / 60)).not.toThrow();
    expect(totalRampCalls(ctx)).toBe(rampsBeforeMore); // no automation was scheduled once stopped
  });
});
