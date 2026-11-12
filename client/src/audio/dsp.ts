// Low-level, context-free DSP helpers: deterministic random numbers, loopable noise tables,
// generated impulse responses, wave-shaper curves, a few pure-JS synthesis routines (plucked
// strings) and the post-processing applied to every pre-rendered sound (loop seams, loudness).

/** Sample rate every procedural sound is rendered at (resampled by the live context on playback). */
export const SR = 32000;

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  /** 0 <= v < 1 */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** Exponentially distributed between a and b (for frequencies). */
  xrange(a: number, b: number): number { return a * Math.pow(b / a, this.next()); }
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  sign(): number { return this.next() < 0.5 ? -1 : 1; }
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// ------------------------------------------------------------------------------------------
// Noise tables. Each is exactly NOISE_SECONDS long and loops without a seam (the coloured ones
// are filtered circularly), so anything built from them with periodic modulation is periodic.
// ------------------------------------------------------------------------------------------

export type NoiseKind = 'white' | 'pink' | 'brown';
export const NOISE_SECONDS = 2;
const noiseCache: Partial<Record<NoiseKind, Float32Array>> = {};

export function noiseData(kind: NoiseKind): Float32Array {
  const hit = noiseCache[kind];
  if (hit) return hit;
  const n = SR * NOISE_SECONDS;
  const rng = new Rng(kind === 'white' ? 1337 : kind === 'pink' ? 7331 : 4242);
  const white = new Float32Array(n);
  for (let i = 0; i < n; i++) white[i] = rng.next() * 2 - 1;
  let out = white;
  if (kind === 'pink') {
    // Paul Kellet's economy pink filter, run twice around the buffer so its state is periodic.
    out = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const w = white[i];
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
    }
  } else if (kind === 'brown') {
    out = new Float32Array(n);
    let y = 0;
    const k = Math.exp(-2 * Math.PI * 18 / SR); // leaky integrator, corner ~18 Hz
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) { y = k * y + white[i] * 0.05; out[i] = y; }
    }
  }
  // normalise to a peak of ~0.95
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.95 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  noiseCache[kind] = out;
  return out;
}

export function makeBuffer(channels: Float32Array[], sampleRate = SR): AudioBuffer {
  const buf = new AudioBuffer({ length: Math.max(1, channels[0].length), numberOfChannels: channels.length, sampleRate });
  for (let c = 0; c < channels.length; c++) buf.getChannelData(c).set(channels[c]);
  return buf;
}

const noiseBufCache: Partial<Record<NoiseKind, AudioBuffer>> = {};
export function noiseBuffer(kind: NoiseKind): AudioBuffer {
  return (noiseBufCache[kind] ??= makeBuffer([noiseData(kind)]));
}

// ------------------------------------------------------------------------------------------
// Wave-shaper curves
// ------------------------------------------------------------------------------------------

export type ShapeKind = 'tanh' | 'fold' | 'hard' | 'soft';
const curveCache = new Map<string, Float32Array>();
export function shaperCurve(kind: ShapeKind, amount: number): Float32Array {
  const key = kind + ':' + amount.toFixed(3);
  let c = curveCache.get(key);
  if (c) return c;
  const n = 2049;
  c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y: number;
    switch (kind) {
      case 'tanh': y = Math.tanh(x * amount) / Math.tanh(amount); break;
      case 'fold': y = Math.sin(x * amount * Math.PI * 0.5); break;
      case 'hard': y = clamp(x * amount, -1, 1); break;
      default: {
        // 'soft': transparent below the knee, smoothly saturating to +-1 above it (master limiter)
        const knee = amount, a = Math.abs(x);
        y = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
      }
    }
    c[i] = y;
  }
  curveCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------------------------------
// Tiny offline filters (used by the impulse-response and pluck generators)
// ------------------------------------------------------------------------------------------

export class OnePole {
  private a: number; private y = 0;
  constructor(cutoff: number, sr: number) { this.a = 1 - Math.exp(-2 * Math.PI * cutoff / sr); }
  lp(x: number): number { this.y += this.a * (x - this.y); return this.y; }
  hp(x: number): number { this.y += this.a * (x - this.y); return x - this.y; }
}

export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(type: 'lowpass' | 'highpass' | 'bandpass' | 'peaking', f: number, q: number, sr: number, gainDb = 0) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { const A = Math.pow(10, gainDb / 40); b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// ------------------------------------------------------------------------------------------
// Generated impulse responses
// ------------------------------------------------------------------------------------------

export type ImpulseKind = 'hall' | 'air' | 'big';
const irCache = new Map<string, AudioBuffer>();

/**
 * 'hall' – the warm wooden long-hall: dense early reflections, ~1.3 s, highs die fast.
 * 'air'  – wide open mountain air: almost no early energy, smeared cliff echoes, a long thin tail.
 * 'big'  – a smooth large space baked into stingers.
 */
export function makeImpulse(kind: ImpulseKind, sampleRate: number): AudioBuffer {
  const key = kind + '@' + sampleRate;
  const hit = irCache.get(key);
  if (hit) return hit;
  const sr = sampleRate;
  const seconds = kind === 'hall' ? 1.5 : kind === 'air' ? 3.2 : 2.6;
  const n = Math.floor(seconds * sr);
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = new Rng(hashStr(kind) + ch * 977);
    const d = new Float32Array(n);
    // three bands of noise, each with its own decay time
    const rt = kind === 'hall' ? [1.45, 1.05, 0.42] : kind === 'air' ? [3.0, 2.4, 1.1] : [2.6, 2.2, 1.2];
    const lvl = kind === 'hall' ? [1.0, 0.8, 0.55] : kind === 'air' ? [0.7, 0.55, 0.22] : [0.9, 0.8, 0.55];
    const onset = kind === 'hall' ? 0.006 : kind === 'air' ? 0.09 : 0.02;
    const lo = new OnePole(380, sr), hi = new OnePole(2600, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr, w = rng.next() * 2 - 1;
      const l = lo.lp(w), h = hi.hp(w), m = w - l - h;
      const rise = 1 - Math.exp(-t / onset);
      d[i] = rise * (l * 2.2 * lvl[0] * Math.exp(-6.91 * t / rt[0]) + m * lvl[1] * Math.exp(-6.91 * t / rt[1]) + h * lvl[2] * Math.exp(-6.91 * t / rt[2]));
    }
    if (kind === 'hall' || kind === 'big') {
      // discrete early reflections off timber walls and roof
      const taps = kind === 'hall' ? 9 : 6;
      for (let k = 0; k < taps; k++) {
        const t = (kind === 'hall' ? 0.007 : 0.018) + Math.pow(rng.next(), 1.4) * (kind === 'hall' ? 0.07 : 0.11);
        const a = (0.75 - 0.5 * (t / 0.12)) * rng.sign();
        const i0 = Math.floor(t * sr);
        for (let j = 0; j < 5 && i0 + j < n; j++) d[i0 + j] += a * [0.3, 1, 0.6, 0.25, 0.1][j];
      }
    } else {
      // smeared echoes from far cliffs, alternating sides
      const echoes: [number, number, number][] = [[0.19, 0.5, 0], [0.33, 0.42, 1], [0.49, 0.28, 0], [0.72, 0.2, 1], [1.06, 0.12, 0], [1.5, 0.07, 1]];
      const elp = new OnePole(1800, sr);
      for (const [t, a, side] of echoes) {
        const amp = a * (side === ch ? 1 : 0.35), width = 0.028 + t * 0.03;
        const i0 = Math.floor((t + (ch ? 0.011 : 0)) * sr), len = Math.floor(width * sr);
        for (let j = 0; j < len && i0 + j < n; j++) {
          const u = j / len, win = Math.sin(Math.PI * u) ** 2;
          d[i0 + j] += elp.lp(rng.next() * 2 - 1) * win * amp * 3;
        }
      }
    }
    // tone shaping: roll off the top, remove mud
    const top = new OnePole(kind === 'hall' ? 5200 : kind === 'air' ? 3600 : 6500, sr);
    const mud = new OnePole(kind === 'air' ? 160 : 110, sr);
    for (let i = 0; i < n; i++) d[i] = mud.hp(top.lp(d[i]));
    // fade the very end so the tail never truncates audibly
    const f = Math.floor(0.08 * sr);
    for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
    chans.push(d);
  }
  const buf = makeBuffer(chans, sr);
  irCache.set(key, buf);
  return buf;
}

// ------------------------------------------------------------------------------------------
// Plucked string (extended Karplus–Strong), rendered in plain JS because Web Audio feedback
// delays cannot be shorter than one render quantum.
// ------------------------------------------------------------------------------------------

export function pluckString(freq: number, seconds: number, sr: number, rng: Rng, o: { t60?: number; bright?: number; damp?: number; pos?: number; body?: boolean } = {}): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const t60 = o.t60 ?? 2, s = o.damp ?? 0.5, bright = o.bright ?? 4200, pos = o.pos ?? 0.22;
  const strings = [0, 4.5]; // cents: a double-strung course gives a gentle chorus
  for (let si = 0; si < strings.length; si++) {
    const f = freq * Math.pow(2, strings[si] / 1200);
    const delay = sr / f - s;
    const N = Math.floor(delay), frac = delay - N;
    const line = new Float32Array(N + 2);
    // excitation: low-passed noise, combed by the pluck position
    const lp = new OnePole(bright, sr);
    const ex = new Float32Array(N + 2);
    for (let i = 0; i < N + 2; i++) ex[i] = lp.lp(rng.next() * 2 - 1);
    const off = Math.max(1, Math.floor(N * pos));
    for (let i = 0; i < N + 2; i++) line[i] = ex[i] - 0.9 * ex[(i + off) % (N + 2)];
    const rho = Math.pow(10, -3 / (f * t60));
    let w = 0, prev = 0;
    const L = N + 1;
    for (let i = 0; i < n; i++) {
      const r0 = line[w], r1 = line[(w + 1) % L];
      const x = r1 * (1 - frac) + r0 * frac;      // fractional read: total delay N + frac samples
      const y = rho * ((1 - s) * x + s * prev);   // loop low-pass + loss
      prev = x;
      line[w] = y;
      w = (w + 1) % L;
      out[i] += x * (si === 0 ? 0.6 : 0.45);
    }
  }
  if (o.body !== false) {
    // a small wooden sound-box: two resonances and a little high cut
    const b1 = new Biquad('peaking', 290, 2.2, sr, 5), b2 = new Biquad('peaking', 560, 2.8, sr, 3.5), top = new Biquad('lowpass', 5200, 0.7, sr), dc = new OnePole(40, sr);
    for (let i = 0; i < n; i++) out[i] = dc.hp(top.run(b2.run(b1.run(out[i]))));
  }
  // soften the very first samples and close the tail
  const a = Math.floor(0.0015 * sr);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  const r = Math.floor(0.05 * sr);
  for (let i = 0; i < r; i++) out[n - 1 - i] *= i / r;
  return out;
}

// ------------------------------------------------------------------------------------------
// Post-processing of rendered sounds
// ------------------------------------------------------------------------------------------

export function peakOf(d: Float32Array): number {
  let p = 0;
  for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > p) p = a; }
  return p;
}

export function rmsOf(d: Float32Array, from = 0, to = d.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Loudest short-term RMS (a workable stand-in for perceived loudness of a one-shot). */
export function shortTermRms(d: Float32Array, sr: number, win = 0.06): number {
  const w = Math.max(16, Math.floor(win * sr));
  if (d.length <= w) return rmsOf(d);
  const hop = w >> 1;
  let best = 0;
  for (let i = 0; i + w <= d.length; i += hop) { const r = rmsOf(d, i, i + w); if (r > best) best = r; }
  return best;
}

export function removeDc(d: Float32Array): void {
  let m = 0;
  for (let i = 0; i < d.length; i++) m += d[i];
  m /= d.length || 1;
  if (Math.abs(m) < 1e-6) return;
  for (let i = 0; i < d.length; i++) d[i] -= m;
}

/**
 * Turn `src` (which contains `pre` samples of run-in followed by at least `len` samples) into a
 * seamless loop: the last `xf` samples of the loop region are cross-faded into the run-in that
 * precedes the region, so the loop end flows into the loop start exactly as the audio did.
 */
export function seamLoop(src: Float32Array, pre: number, len: number, xf: number, law: 'lin' | 'pow'): void {
  xf = Math.min(xf, pre, len >> 1);
  for (let i = 0; i < xf; i++) {
    const t = (i + 1) / (xf + 1);
    const a = law === 'pow' ? Math.cos(t * Math.PI * 0.5) : 1 - t;
    const b = law === 'pow' ? Math.sin(t * Math.PI * 0.5) : t;
    const idx = pre + len - xf + i;
    src[idx] = src[idx] * a + src[pre - xf + i] * b;
  }
}
