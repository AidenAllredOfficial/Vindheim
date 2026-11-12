// The synthesis kit: a thin, terse layer over Web Audio nodes used by every sound recipe.
// A `G` is one sound being built inside some BaseAudioContext (offline for pre-rendered sounds,
// but nothing here assumes that): all times are seconds relative to the start of the sound.

import { Rng, noiseBuffer, shaperCurve, makeImpulse, type NoiseKind, type ShapeKind, type ImpulseKind } from './dsp';

/** Breakpoint [time, value, curve]: 'l' linear ramp (default), 'e' exponential ramp, 's' step. */
export type Pt = [number, number] | [number, number, 'l' | 'e' | 's'];
/** A constant or a breakpoint envelope. */
export type Env = number | Pt[];

// ---- envelope shorthands ---------------------------------------------------------------------
/** Percussive: attack `a`, exponential decay `d`. */
export const P = (at: number, a: number, d: number, peak = 1): Pt[] => [[at, 0], [at + a, peak], [at + a + d, peak * 0.001, 'e'], [at + a + d + 0.004, 0]];
/** Swell: rise to the peak at `pos` (0..1 of dur) then fall. */
export const S = (at: number, dur: number, peak = 1, pos = 0.5): Pt[] => [[at, 0], [at + dur * pos, peak], [at + dur, 0]];
/** Reverse-style: exponential rise, abrupt end. */
export const R = (at: number, dur: number, peak = 1, cut = 0.02): Pt[] => [[at, 0], [at + 0.003, peak * 0.004], [at + dur - cut, peak, 'e'], [at + dur, 0]];
/** Hold: attack, sustain, release. */
export const H = (at: number, a: number, hold: number, r: number, peak = 1): Pt[] => [[at, 0], [at + a, peak], [at + a + hold, peak], [at + a + hold + r, 0]];
/** Exponential sweep from v0 to v1. */
export const X = (at: number, dur: number, v0: number, v1: number): Pt[] => [[at, v0], [at + dur, v1, 'e']];
/** Linear sweep. */
export const L = (at: number, dur: number, v0: number, v1: number): Pt[] => [[at, v0], [at + dur, v1]];
/** Scale an envelope's values. */
export const mulEnv = (e: Env, k: number): Env => (typeof e === 'number' ? e * k : e.map((p) => [p[0], p[1] * k, p[2] ?? 'l'] as Pt));

export interface TickOpts {
  n: number; from: number; to: number;
  kind?: NoiseKind; type?: BiquadFilterType;
  /** Filter frequency or [lo, hi] spread across the groups. */
  f: number | [number, number];
  q?: number;
  /** Tick length range in seconds. */
  len?: [number, number];
  g?: number;
  /** >1 crowds ticks toward the start, <1 toward the end. */
  bias?: number;
  /** Amplitude over normalised time 0..1. */
  amp?: (u: number) => number;
  groups?: number;
  dest?: AudioNode;
}

export class G {
  readonly ctx: BaseAudioContext;
  /** Where the sound goes. */
  out: AudioNode;
  /** Context time of the sound's start. */
  readonly t0: number;
  /** Length in seconds; sources are stopped here. */
  readonly dur: number;
  readonly rng: Rng;

  constructor(ctx: BaseAudioContext, out: AudioNode, t0: number, dur: number, rng: Rng) {
    this.ctx = ctx; this.out = out; this.t0 = t0; this.dur = dur; this.rng = rng;
  }

  // ---- parameters ----------------------------------------------------------------------------
  env(p: AudioParam, e: Env | undefined, mul = 1): void {
    if (e === undefined) return;
    if (typeof e === 'number') { p.value = e * mul; return; }
    let pv = e[0][1] * mul, pt = e[0][0];
    p.value = pv;
    p.setValueAtTime(pv, this.t0 + pt);
    for (let i = 1; i < e.length; i++) {
      const c = e[i][2];
      let v = e[i][1] * mul;
      const t = Math.max(e[i][0], pt + 1e-4);
      if (c === 'e') {
        if (Math.abs(pv) < 1e-5) { pv = v < 0 ? -1e-4 : 1e-4; p.setValueAtTime(pv, this.t0 + pt); }
        if (Math.abs(v) < 1e-5) v = pv < 0 ? -1e-4 : 1e-4;
        p.exponentialRampToValueAtTime(v, this.t0 + t);
      } else if (c === 's') p.setValueAtTime(v, this.t0 + t);
      else p.linearRampToValueAtTime(v, this.t0 + t);
      pv = v; pt = t;
    }
  }

  // ---- sources -------------------------------------------------------------------------------
  osc(type: OscillatorType, f: Env, o: { det?: Env; at?: number; end?: number; mul?: number } = {}): OscillatorNode {
    const n = this.ctx.createOscillator();
    n.type = type;
    this.env(n.frequency, f, o.mul ?? 1);
    if (o.det !== undefined) this.env(n.detune, o.det);
    n.start(this.t0 + (o.at ?? 0));
    n.stop(this.t0 + Math.min(o.end ?? this.dur, this.dur) + 0.02);
    return n;
  }

  noise(kind: NoiseKind = 'white', o: { rate?: Env; at?: number; end?: number } = {}): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = noiseBuffer(kind);
    n.loop = true;
    if (o.rate !== undefined) this.env(n.playbackRate, o.rate);
    n.start(this.t0 + (o.at ?? 0), this.rng.range(0, 1.9));
    n.stop(this.t0 + Math.min(o.end ?? this.dur, this.dur) + 0.02);
    return n;
  }

  // ---- processors ----------------------------------------------------------------------------
  gain(e: Env = 1): GainNode {
    const n = this.ctx.createGain();
    this.env(n.gain, e);
    return n;
  }

  bq(type: BiquadFilterType, f: Env, q: Env = 0.707, gainDb = 0): BiquadFilterNode {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    this.env(n.frequency, f);
    this.env(n.Q, q);
    n.gain.value = gainDb;
    return n;
  }
  lp(f: Env, q: Env = 0.707): BiquadFilterNode { return this.bq('lowpass', f, q); }
  hp(f: Env, q: Env = 0.707): BiquadFilterNode { return this.bq('highpass', f, q); }
  bp(f: Env, q: Env = 1): BiquadFilterNode { return this.bq('bandpass', f, q); }

  shaper(amount: number, kind: ShapeKind = 'tanh'): WaveShaperNode {
    const n = this.ctx.createWaveShaper();
    n.curve = shaperCurve(kind, amount) as Float32Array<ArrayBuffer>;
    return n;
  }

  delay(time: Env, max = 1): DelayNode {
    const n = this.ctx.createDelay(max);
    this.env(n.delayTime, time);
    return n;
  }

  /** A baked reverb tail. Returns [input, wet-level gain already connected to dest]. */
  reverb(kind: ImpulseKind, wet: number, dest: AudioNode = this.out): GainNode {
    const input = this.ctx.createGain();
    const c = this.ctx.createConvolver();
    c.buffer = makeImpulse(kind, this.ctx.sampleRate);
    const w = this.ctx.createGain();
    w.gain.value = wet;
    input.connect(c); c.connect(w); w.connect(dest);
    return input;
  }

  /** LFO whose output can be connected to a parameter. */
  lfo(rate: Env, depth: Env, type: OscillatorType = 'sine'): GainNode {
    const o = this.osc(type, rate);
    const g = this.gain(depth);
    o.connect(g);
    return g;
  }

  /** Tremolo stage: gain wobbling between (1 - depth) and 1 at `rate` Hz. */
  trem(rate: Env, depth: number, type: OscillatorType = 'sine'): GainNode {
    const g = this.gain(1 - depth / 2);
    this.lfo(rate, depth / 2, type).connect(g.gain);
    return g;
  }

  // ---- wiring --------------------------------------------------------------------------------
  /** Connect nodes[0] -> nodes[1] -> ... -> dest. */
  pipe(dest: AudioNode | AudioParam, ...nodes: AudioNode[]): void {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    const last = nodes[nodes.length - 1];
    if (dest instanceof AudioParam) last.connect(dest); else last.connect(dest);
  }
  /** Connect a chain to the sound's output. */
  send(...nodes: AudioNode[]): void { this.pipe(this.out, ...nodes); }

  /** A sub-mix: returns an input whose signal runs through `fx` into dest (default: output). */
  bus(dest: AudioNode | undefined, ...fx: AudioNode[]): GainNode {
    const input = this.ctx.createGain();
    this.pipe(dest ?? this.out, input, ...fx);
    return input;
  }

  // ---- voices --------------------------------------------------------------------------------
  /** Oscillator with a frequency and an amplitude envelope. */
  tone(type: OscillatorType, f: Env, e: Env, dest: AudioNode = this.out, det?: Env): GainNode {
    const g = this.gain(e);
    this.pipe(dest, this.osc(type, f, { det }), g);
    return g;
  }

  /** Filtered noise with an amplitude envelope. */
  nz(kind: NoiseKind, type: BiquadFilterType, f: Env, q: Env, e: Env, dest: AudioNode = this.out): GainNode {
    const g = this.gain(e);
    this.pipe(dest, this.noise(kind), this.bq(type, f, q), g);
    return g;
  }

  /** Noise confined between a high-pass and a low-pass. */
  band(kind: NoiseKind, lo: Env, hi: Env, e: Env, dest: AudioNode = this.out): GainNode {
    const g = this.gain(e);
    this.pipe(dest, this.noise(kind), this.hp(lo), this.lp(hi), g);
    return g;
  }

  /** Body thump: a sine dropping from f0 to f1. */
  thump(at: number, f0: number, f1: number, dur: number, gain = 1, dest: AudioNode = this.out): void {
    this.tone('sine', [[at, f0], [at + dur * 0.6, f1, 'e']], P(at, 0.003, dur, gain), dest);
  }

  /** Very short filtered-noise transient. */
  click(at: number, f: number, gain = 1, dest: AudioNode = this.out, len = 0.012, q = 1.2): void {
    this.nz('white', 'bandpass', f, q, P(at, 0.0008, len, gain), dest);
  }

  /** A scatter of tiny filtered-noise ticks: crackle, sparks, rubble, grit, drips. */
  ticks(o: TickOpts): void {
    const groups = o.groups ?? 2;
    const [f0, f1] = typeof o.f === 'number' ? [o.f, o.f] : o.f;
    const [l0, l1] = o.len ?? [0.004, 0.02];
    const span = o.to - o.from;
    for (let gi = 0; gi < groups; gi++) {
      const count = Math.max(1, Math.round(o.n / groups));
      const times: number[] = [];
      for (let k = 0; k < count; k++) times.push(Math.pow(this.rng.next(), o.bias ?? 1));
      times.sort((a, b) => a - b);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      for (let k = 0; k < count; k++) {
        const u = times[k], t = this.t0 + o.from + u * span;
        const next = k + 1 < count ? this.t0 + o.from + times[k + 1] * span : this.t0 + o.to + l1;
        const len = Math.min(this.rng.range(l0, l1), next - t - 0.0012);
        if (len < 0.0015) continue;
        const amp = (o.g ?? 1) * this.rng.range(0.25, 1) * (o.amp ? o.amp(u) : 1);
        if (amp < 1e-4) continue;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.0007);
        g.gain.exponentialRampToValueAtTime(amp * 0.002, t + len);
        g.gain.setValueAtTime(0, t + len + 0.0003);
      }
      const f = groups === 1 ? Math.sqrt(f0 * f1) : f0 * Math.pow(f1 / f0, gi / (groups - 1));
      this.pipe(o.dest ?? this.out, this.noise(o.kind ?? 'white'), this.bq(o.type ?? 'bandpass', f, o.q ?? 2), g);
    }
  }

  /** Decaying sine partials [freq, gain, t60]: bells, glass, metal, wood. */
  modal(at: number, parts: readonly (readonly [number, number, number])[], gain = 1, dest: AudioNode = this.out, o: { mul?: number; attack?: number; type?: OscillatorType; decay?: number } = {}): void {
    const mul = o.mul ?? 1, attack = o.attack ?? 0.0015;
    for (const [f, a, t60] of parts) {
      const fr = f * mul;
      if (fr > this.ctx.sampleRate * 0.46) continue;
      this.tone(o.type ?? 'sine', fr, P(at, attack, t60 * (o.decay ?? 1), a * gain), dest);
    }
  }

  /** Two-operator FM voice. `index` is the modulation index. */
  fm(fc: Env, ratio: number, index: Env, e: Env, dest: AudioNode = this.out, o: { ctype?: OscillatorType; mtype?: OscillatorType } = {}): GainNode {
    const base = typeof fc === 'number' ? fc : fc[0][1];
    const car = this.osc(o.ctype ?? 'sine', fc);
    const mod = this.osc(o.mtype ?? 'sine', fc, { mul: ratio });
    const mg = this.gain(mulEnv(index, base * ratio));
    mod.connect(mg); mg.connect(car.frequency);
    const g = this.gain(e);
    this.pipe(dest, car, g);
    return g;
  }

  /** Sample-and-hold oscillator: random pitch steps at `rate` Hz (electric zaps, glitches). */
  sh(type: OscillatorType, from: number, to: number, rate: number, f: [number, number], e: Env, dest: AudioNode = this.out): GainNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = this.rng.xrange(f[0], f[1]);
    for (let t = from; t < to; t += this.rng.range(0.6, 1.4) / rate) o.frequency.setValueAtTime(this.rng.xrange(f[0], f[1]), this.t0 + t);
    o.start(this.t0 + from);
    o.stop(this.t0 + Math.min(to, this.dur) + 0.02);
    const g = this.gain(e);
    this.pipe(dest, o, g);
    return g;
  }

  /** A run of sine chirps on one oscillator: bubbles, drips, chirrups. `up` is the pitch ratio of each glide. */
  blips(n: number, from: number, to: number, f: [number, number], up: number, len: [number, number], gain = 1, dest: AudioNode = this.out, bias = 1): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    const g = this.ctx.createGain();
    g.gain.value = 0;
    const times: number[] = [];
    for (let k = 0; k < n; k++) times.push(from + Math.pow(this.rng.next(), bias) * (to - from));
    times.sort((a, b) => a - b);
    o.frequency.value = f[0];
    for (let k = 0; k < n; k++) {
      const t = this.t0 + times[k];
      const next = k + 1 < n ? this.t0 + times[k + 1] : this.t0 + to + len[1];
      const l = Math.min(this.rng.range(len[0], len[1]), next - t - 0.002);
      if (l < 0.004) continue;
      const fr = this.rng.xrange(f[0], f[1]), a = gain * this.rng.range(0.35, 1);
      o.frequency.setValueAtTime(fr, t);
      o.frequency.exponentialRampToValueAtTime(fr * up, t + l);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + Math.min(0.004, l * 0.3));
      g.gain.exponentialRampToValueAtTime(a * 0.003, t + l);
      g.gain.setValueAtTime(0, t + l + 0.0005);
    }
    o.start(this.t0 + from);
    o.stop(this.t0 + Math.min(to + len[1] + 0.05, this.dur) + 0.02);
    this.pipe(dest, o, g);
  }

  /** Parallel band-pass formants [freq, Q, gain] fed from `input`. */
  formants(input: AudioNode, bands: readonly (readonly [number, number, number])[], dest: AudioNode = this.out): void {
    for (const [f, q, a] of bands) {
      const b = this.bp(f, q), g = this.gain(a);
      input.connect(b); b.connect(g); g.connect(dest);
    }
  }
}
