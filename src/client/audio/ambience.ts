/**
 * The ambient bed, synthesised on the fly — same rule as sfx.ts: no audio assets,
 * no CDN, everything built from oscillators, filtered noise and LFOs.
 *
 * Where sfx.ts fires short envelopes for discrete events, this module builds one
 * graph that stays connected for the life of the session and is *steered* every
 * frame by ramping gains and filter cutoffs toward the current world state. A bed
 * that snaps to a new value on a stepped assignment is audible as a click, so every
 * continuous voice here is driven through setTargetAtTime rather than a bare
 * `.value =` — the caller hands us a smoothly-changing world (wind, rain, weather
 * fronts fading in over minutes) and the least we owe it is a smooth ear.
 */

/** Everything the bed needs to know about the world, precomputed by the caller. */
export interface AmbienceState {
  /** 0 = midnight, 0.5 = noon, wraps at 1. */
  timeOfDay: number;
  /** 0..1 sun above the horizon — already accounts for cloud. */
  daylight: number;
  /** 0..1 rainfall. */
  rain: number;
  /** 0..1 wind strength. */
  wind: number;
  /** 0..1 how much danger is on the map right now (raiders near the colony, fire). */
  threat: number;
  /** True while the possessed colonist is under a roof. */
  indoors: boolean;
  /** True in first-person, false in the isometric manager view. */
  firstPerson: boolean;
}

/** Supplies the next random sample in [0, 1). Injectable so tests can pin chorus timing. */
export type RandomFn = () => number;

// Ramp time constant for every weather-driven glide — "a few hundred ms" so a front
// arriving reads as a change in the wind, not a splice in the recording.
const RAMP_TC = 0.35;

// Peak gain each continuous layer contributes at driver = 1, before the first-person
// / manager-view scalar below. Kept well under the stingers' ~0.5 peak (see sfx.ts) —
// this is a bed, not a track — and small enough that even every layer maxed at once
// still sits under the view scalar's own ceiling.
const WIND_PEAK = 0.035;
const RAIN_PEAK = 0.04;
const NIGHT_PEAK = 0.02;
const THREAT_PEAK = 0.05;
const CHIRP_PEAK = 0.04;

// The overall bed is louder and more present in first-person (you are standing in
// the world) and sits back in the manager view (you are looking down on it).
const VIEW_GAIN = { first: 0.8, manager: 0.5 };

// Indoors mutes the outside world: a lower lowpass cutoff for the muffle, plus a
// duck on top so walking into a building is an audible reward, not just a filter.
const OUTDOOR_CUTOFF = { open: 8000, indoors: 900 };
const OUTDOOR_DUCK = { open: 1, indoors: 0.55 };

// Day-chorus chirps are sparse and irregular on purpose — a fixed interval reads as
// a metronome, not a bird.
const CHIRP_MIN_GAP = 0.4;
const CHIRP_MAX_GAP = 2.6;
const DAY_GATE = 0.15; // below this daylight the birds stop and the night chorus owns the space

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Every continuous change goes through here — never a raw `.value =` after start(). */
function ramp(param: AudioParam, target: number, now: number): void {
  param.setTargetAtTime(target, now, RAMP_TC);
}

export class Ambience {
  enabled = true;

  private ctx: AudioContext | null = null;
  private started = false;

  // Final stage: the view scalar, then the shared indoor duck + muffle filter that
  // every outdoor layer routes through before reaching it.
  private master: GainNode | null = null;
  private outdoorDuck: GainNode | null = null;
  private outdoorFilter: BiquadFilterNode | null = null;

  // Wind: the base layer, always running underneath everything else.
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  // Rain: a second, brighter noise voice, silent until the weather calls for it.
  private rainSource: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;

  // Night chorus: a tremoloed high sine standing in for crickets, crossfaded against
  // the day chorus by daylight rather than switched.
  private nightOsc: OscillatorNode | null = null;
  private nightLfo: OscillatorNode | null = null;
  private nightGain: GainNode | null = null;

  // Threat drone: a detuned pair that bypasses the indoor duck — danger should reach
  // the player whether they're inside or out.
  private threatOscA: OscillatorNode | null = null;
  private threatOscB: OscillatorNode | null = null;
  private threatGain: GainNode | null = null;

  // Seconds until the day chorus is next eligible to chirp.
  private dayTimer = 0;

  private readonly rand: RandomFn;

  constructor(rand: RandomFn = Math.random) {
    this.rand = rand;
  }

  /** Build the graph. `bus` is a GainNode already connected to the destination. */
  start(ctx: AudioContext, bus: GainNode): void {
    if (this.started) return;
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = VIEW_GAIN.manager;
    master.connect(bus);

    const outdoorDuck = ctx.createGain();
    outdoorDuck.gain.value = OUTDOOR_DUCK.open;
    outdoorDuck.connect(master);

    const outdoorFilter = ctx.createBiquadFilter();
    outdoorFilter.type = 'lowpass';
    outdoorFilter.frequency.value = OUTDOOR_CUTOFF.open;
    outdoorFilter.connect(outdoorDuck);

    // One shared noise buffer, reused by both weather voices (see sfx.ts's noise
    // burst buffer for the same trick) — only the filtering and gain differ.
    const noise = this.makeNoiseBuffer(ctx);

    const windSource = ctx.createBufferSource();
    windSource.buffer = noise;
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 150;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSource.connect(windFilter).connect(windGain).connect(outdoorFilter);
    windSource.start(ctx.currentTime);

    const rainSource = ctx.createBufferSource();
    rainSource.buffer = noise;
    rainSource.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 3200;
    rainFilter.Q.value = 0.5;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSource.connect(rainFilter).connect(rainGain).connect(outdoorFilter);
    rainSource.start(ctx.currentTime);

    const nightOsc = ctx.createOscillator();
    nightOsc.type = 'sine';
    nightOsc.frequency.value = 4200;
    const nightLfo = ctx.createOscillator();
    nightLfo.type = 'sine';
    nightLfo.frequency.value = 22;
    const nightLfoDepth = ctx.createGain();
    nightLfoDepth.gain.value = 0.5;
    const nightTremolo = ctx.createGain();
    nightTremolo.gain.value = 0.5; // static bias the LFO wobbles around, set once at build time
    nightLfo.connect(nightLfoDepth).connect(nightTremolo.gain); // audio-rate modulation, not a JS write
    const nightGain = ctx.createGain();
    nightGain.gain.value = 0;
    nightOsc.connect(nightTremolo).connect(nightGain).connect(outdoorFilter);
    nightOsc.start(ctx.currentTime);
    nightLfo.start(ctx.currentTime);

    const threatOscA = ctx.createOscillator();
    threatOscA.type = 'sawtooth';
    threatOscA.frequency.value = 55;
    const threatOscB = ctx.createOscillator();
    threatOscB.type = 'sawtooth';
    threatOscB.frequency.value = 55 * 1.015; // slight detune for the beating unease
    const threatGain = ctx.createGain();
    threatGain.gain.value = 0;
    threatOscA.connect(threatGain);
    threatOscB.connect(threatGain);
    threatGain.connect(master); // bypasses the outdoor duck: a raid is felt indoors too
    threatOscA.start(ctx.currentTime);
    threatOscB.start(ctx.currentTime);

    this.master = master;
    this.outdoorDuck = outdoorDuck;
    this.outdoorFilter = outdoorFilter;
    this.windSource = windSource;
    this.windFilter = windFilter;
    this.windGain = windGain;
    this.rainSource = rainSource;
    this.rainGain = rainGain;
    this.nightOsc = nightOsc;
    this.nightLfo = nightLfo;
    this.nightGain = nightGain;
    this.threatOscA = threatOscA;
    this.threatOscB = threatOscB;
    this.threatGain = threatGain;
    this.dayTimer = 0; // the birds are ready to sing the instant daylight allows it
    this.started = true;
  }

  /** Called once per animation frame (~60 Hz). Must be cheap and allocation-free. */
  update(s: AmbienceState, dt: number): void {
    if (!this.started) return;
    const ctx = this.ctx;
    const master = this.master;
    const outdoorDuck = this.outdoorDuck;
    const outdoorFilter = this.outdoorFilter;
    const windGain = this.windGain;
    const windFilter = this.windFilter;
    const rainGain = this.rainGain;
    const nightGain = this.nightGain;
    const threatGain = this.threatGain;
    if (
      !ctx ||
      !master ||
      !outdoorDuck ||
      !outdoorFilter ||
      !windGain ||
      !windFilter ||
      !rainGain ||
      !nightGain ||
      !threatGain
    ) {
      return;
    }

    const t = ctx.currentTime;
    const gate = this.enabled ? 1 : 0;

    // View: first-person stands inside the world, the manager view looks down on it.
    ramp(master.gain, s.firstPerson ? VIEW_GAIN.first : VIEW_GAIN.manager, t);

    // Indoors muffles and ducks everything routed through the shared outdoor stage.
    ramp(outdoorFilter.frequency, s.indoors ? OUTDOOR_CUTOFF.indoors : OUTDOOR_CUTOFF.open, t);
    ramp(outdoorDuck.gain, s.indoors ? OUTDOOR_DUCK.indoors : OUTDOOR_DUCK.open, t);

    // Wind: the base layer, always the first thing you hear and the last to leave.
    ramp(windGain.gain, gate * s.wind * WIND_PEAK, t);
    ramp(windFilter.frequency, 150 + s.wind * 500, t);

    // Rain: silent on a clear day, brighter and busier the harder it falls.
    ramp(rainGain.gain, gate * s.rain * RAIN_PEAK, t);

    // Threat: the drone that tips the player off before the raid is on screen.
    ramp(threatGain.gain, gate * s.threat * THREAT_PEAK, t);

    // Night chorus rises as daylight falls — a crossfade against the day chorus's
    // chirp rate below, not a hard switch at some fixed hour.
    const night = clamp01(1 - s.daylight);
    ramp(nightGain.gain, gate * night * NIGHT_PEAK, t);

    // Day chorus: sparse, irregular chirps, gated by daylight and spaced by dayTimer.
    this.dayTimer -= dt;
    if (gate && s.daylight >= DAY_GATE) {
      if (this.dayTimer <= 0) {
        this.chirp(s.daylight);
        this.dayTimer = CHIRP_MIN_GAP + this.rand() * (CHIRP_MAX_GAP - CHIRP_MIN_GAP);
      }
    } else if (this.dayTimer < 0) {
      this.dayTimer = 0; // hold at the gate so the birds start the instant dawn allows them
    }
  }

  stop(): void {
    if (!this.started) return;
    const sources = [this.windSource, this.rainSource, this.nightOsc, this.nightLfo, this.threatOscA, this.threatOscB];
    for (const node of sources) node?.stop();
    this.master?.disconnect();

    this.started = false;
    this.ctx = null;
    this.master = null;
    this.outdoorDuck = null;
    this.outdoorFilter = null;
    this.windSource = null;
    this.windFilter = null;
    this.windGain = null;
    this.rainSource = null;
    this.rainGain = null;
    this.nightOsc = null;
    this.nightLfo = null;
    this.nightGain = null;
    this.threatOscA = null;
    this.threatOscB = null;
    this.threatGain = null;
  }

  /** One short frequency-swept blip, in the voice of sfx.ts's tone(). */
  private chirp(daylight: number): void {
    const ctx = this.ctx;
    const outdoorFilter = this.outdoorFilter;
    if (!ctx || !outdoorFilter) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    const base = 1800 + this.rand() * 1600;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, base * (0.7 + this.rand() * 0.6)), t + 0.09);
    g.gain.setValueAtTime(0, t);
    // Brighter chirps on a brighter day — a dawn chorus should read as more alive than dusk stragglers.
    g.gain.linearRampToValueAtTime(CHIRP_PEAK * (0.4 + 0.6 * daylight), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(outdoorFilter);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** One second of seeded white noise, looped by both weather voices. */
  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 90125; // fixed seed — the texture doesn't need to vary, only its gain and filtering do
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = seed / 0x3fffffff - 1;
    }
    return buffer;
  }
}
