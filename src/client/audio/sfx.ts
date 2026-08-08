/**
 * Web Audio stingers, synthesised on the fly — the build ships no sound files.
 *
 * The context is created on the first user gesture (browsers refuse otherwise) and
 * every sound is a short oscillator or noise burst through its own gain envelope,
 * so nothing accumulates and nothing needs preloading.
 */

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /**
   * A second bus, for the ambient bed. Deliberately not a child of `master`: the
   * stingers sit at 0.35 because a gunshot has to cut, and the bed sits two orders
   * of magnitude below that because it must never be *noticed*. One gain for both
   * would mean tuning one of them wrong.
   */
  private ambientBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Safe to call repeatedly; only the first call inside a gesture does anything. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);

    this.ambientBus = this.ctx.createGain();
    this.ambientBus.gain.value = 1;
    this.ambientBus.connect(this.ctx.destination);

    // One second of white noise, reused by every percussive sound.
    const len = Math.floor(this.ctx.sampleRate);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 1337;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff - 1) * 0.7;
    }
  }

  private tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    endFreq = freq,
  ): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, gain: number, freq: number, q = 1): void {
    if (!this.ctx || !this.master || !this.noise || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  shot(): void {
    this.burst(0.16, 0.5, 1500, 0.9);
    this.tone(180, 0.1, 0.16, 'square', 70);
  }

  melee(): void {
    this.burst(0.1, 0.35, 420, 1.4);
  }

  hurt(): void {
    this.tone(220, 0.18, 0.22, 'triangle', 120);
  }

  /** A structure finished. */
  built(): void {
    this.tone(520, 0.09, 0.16, 'triangle');
    setTimeout(() => this.tone(780, 0.14, 0.14, 'triangle'), 80);
  }

  /** Orders accepted / UI blips. */
  click(): void {
    this.tone(660, 0.05, 0.09, 'square');
  }

  deny(): void {
    this.tone(190, 0.12, 0.12, 'sawtooth', 140);
  }

  /** Raid, fire, anything the storyteller throws at you. */
  threat(): void {
    this.tone(150, 0.7, 0.22, 'sawtooth', 95);
    setTimeout(() => this.tone(112, 0.9, 0.18, 'sawtooth', 74), 220);
  }

  good(): void {
    this.tone(600, 0.1, 0.12, 'sine');
    setTimeout(() => this.tone(900, 0.16, 0.1, 'sine'), 90);
  }

  bad(): void {
    this.tone(300, 0.3, 0.16, 'triangle', 150);
  }

  /** Door opened, interaction landed. */
  interact(): void {
    this.burst(0.13, 0.2, 700, 2.2);
  }

  /** Switching between the two views: a short whoosh so the change reads. */
  swap(up: boolean): void {
    this.tone(up ? 320 : 700, 0.22, 0.14, 'sine', up ? 760 : 300);
  }

  /**
   * The live context and the bed's bus, or null until the player's first gesture
   * has unlocked audio. The ambient bed asks each frame rather than being handed
   * them once, because "audio exists yet" is not knowable at construction time.
   */
  ambientOutput(): { ctx: AudioContext; bus: GainNode } | null {
    if (!this.ctx || !this.ambientBus) return null;
    return { ctx: this.ctx, bus: this.ambientBus };
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.ambientBus = null;
  }
}
