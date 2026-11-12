// Numeric verification of generated audio (used by the dev harness, since nobody can listen to
// a headless browser): level, spectrum and seam measurements plus small canvas renderers.

import { peakOf, rmsOf } from './dsp';

export interface Stats {
  /** Seconds. */
  dur: number;
  peak: number;
  rms: number;
  /** Magnitude-weighted mean frequency in Hz. */
  centroid: number;
  /** Percentage of samples at full scale. */
  clipPct: number;
  dc: number;
  /** Energy per octave band in dB relative to the total (BAND_EDGES). */
  bands: number[];
}

export const BAND_EDGES = [22, 45, 90, 180, 355, 710, 1400, 2800, 5600, 11200, 16000];
export const BAND_LABELS = ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '14k'];

/** In-place radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>();
function hann(n: number): Float64Array {
  let w = hannCache.get(n);
  if (!w) { w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); hannCache.set(n, w); }
  return w;
}

/** Average power spectrum (size/2 bins). */
export function powerSpectrum(d: Float32Array, size = 2048): Float64Array {
  const out = new Float64Array(size / 2), w = hann(size), re = new Float64Array(size), im = new Float64Array(size);
  let frames = 0;
  const hop = size >> 1;
  for (let i = 0; i === 0 || i + size <= d.length; i += hop) {
    for (let k = 0; k < size; k++) { re[k] = (i + k < d.length ? d[i + k] : 0) * w[k]; im[k] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) out[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  for (let k = 0; k < out.length; k++) out[k] /= frames;
  return out;
}

export function analyze(d: Float32Array, sr: number): Stats {
  const n = d.length;
  let clip = 0, sum = 0;
  for (let i = 0; i < n; i++) { if (Math.abs(d[i]) >= 0.999) clip++; sum += d[i]; }
  const ps = powerSpectrum(d);
  const binHz = sr / 2 / ps.length;
  let num = 0, den = 0, total = 0;
  const band = new Array<number>(BAND_EDGES.length - 1).fill(0);
  for (let k = 1; k < ps.length; k++) {
    const f = k * binHz, mag = Math.sqrt(ps[k]);
    num += f * mag; den += mag; total += ps[k];
    for (let b = 0; b < band.length; b++) if (f >= BAND_EDGES[b] && f < BAND_EDGES[b + 1]) { band[b] += ps[k]; break; }
  }
  return {
    dur: n / sr, peak: peakOf(d), rms: rmsOf(d), centroid: den > 0 ? num / den : 0,
    clipPct: (100 * clip) / Math.max(1, n), dc: sum / Math.max(1, n),
    bands: band.map((e) => 10 * Math.log10(e / (total || 1) + 1e-9)),
  };
}

export const db = (v: number): number => 20 * Math.log10(Math.max(v, 1e-9));

/**
 * How well a loop closes. `jump` is the sample step across the seam relative to the 99th
 * percentile of ordinary sample-to-sample steps nearby (about 1 = indistinguishable, a click is
 * far above); `levelDb` compares the 80 ms before the loop end with the 80 ms after its start.
 */
export function loopSeam(d: Float32Array, sr: number, loopStart: number, loopEnd: number): { jump: number; levelDb: number } {
  const s = Math.round(loopStart * sr), e = Math.min(d.length, Math.round(loopEnd * sr));
  const w = Math.min(Math.round(0.08 * sr), (e - s) >> 2);
  const steps: number[] = [];
  for (let i = 1; i < w; i++) { steps.push(Math.abs(d[e - i] - d[e - i - 1])); steps.push(Math.abs(d[s + i] - d[s + i - 1])); }
  steps.sort((a, b) => a - b);
  const typical = steps[Math.floor(steps.length * 0.99)] || 1e-9;
  const jump = Math.abs(d[s] - d[e - 1]) / Math.max(typical, 1e-9);
  return { jump, levelDb: db(rmsOf(d, e - w, e)) - db(rmsOf(d, s, s + w)) };
}

/** RMS distance in dB between two band profiles, ignoring bands that are empty in both. */
export function bandDistance(a: number[], b: number[]): number {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Math.max(a[i], -50), y = Math.max(b[i], -50);
    if (x <= -49 && y <= -49) continue;
    s += (x - y) * (x - y); n++;
  }
  return Math.sqrt(s / Math.max(1, n));
}

/** RMS envelope in dB, one value per `hop` seconds. */
export function envelope(d: Float32Array, sr: number, hop = 0.5): number[] {
  const out: number[] = [], w = Math.round(hop * sr);
  for (let i = 0; i + w <= d.length; i += w) out.push(db(rmsOf(d, i, i + w)));
  return out;
}

// ------------------------------------------------------------------------------------------
// drawing
// ------------------------------------------------------------------------------------------

export function drawWave(c: CanvasRenderingContext2D, d: Float32Array, x: number, y: number, w: number, h: number, color = '#e8c36a'): void {
  c.fillStyle = '#0d1420';
  c.fillRect(x, y, w, h);
  c.fillStyle = color;
  const per = d.length / w;
  for (let px = 0; px < w; px++) {
    let lo = 1, hi = -1;
    const i0 = Math.floor(px * per), i1 = Math.max(i0 + 1, Math.floor((px + 1) * per));
    for (let i = i0; i < i1 && i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    if (hi < lo) continue;
    const y0 = y + (h / 2) * (1 - hi), y1 = y + (h / 2) * (1 - lo);
    c.fillRect(x + px, y0, 1, Math.max(1, y1 - y0));
  }
}

/** Log-frequency spectrogram (60 Hz .. Nyquist), 70 dB of range. */
export function drawSpectrogram(c: CanvasRenderingContext2D, d: Float32Array, sr: number, x: number, y: number, w: number, h: number): void {
  const size = 1024, win = hann(size), re = new Float64Array(size), im = new Float64Array(size);
  const img = c.createImageData(w, h);
  const fLo = 60, fHi = sr / 2;
  const rowBin = new Int32Array(h);
  for (let r = 0; r < h; r++) rowBin[r] = Math.min(size / 2 - 1, Math.max(1, Math.round((fLo * Math.pow(fHi / fLo, 1 - r / (h - 1)) / (sr / 2)) * (size / 2))));
  for (let px = 0; px < w; px++) {
    const centre = Math.floor(((px + 0.5) / w) * d.length), i0 = centre - size / 2;
    for (let k = 0; k < size; k++) { const i = i0 + k; re[k] = (i >= 0 && i < d.length ? d[i] : 0) * win[k]; im[k] = 0; }
    fft(re, im);
    for (let r = 0; r < h; r++) {
      const k = rowBin[r];
      const v = Math.max(0, Math.min(1, (10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12) + 30) / 70));
      const o = (r * w + px) * 4;
      // deep blue -> teal -> amber -> white
      img.data[o] = Math.round(255 * Math.min(1, Math.max(0, v * 2.2 - 0.9)));
      img.data[o + 1] = Math.round(255 * Math.min(1, Math.max(0, v * 1.5 - 0.25)));
      img.data[o + 2] = Math.round(255 * Math.min(1, 0.12 + v * 0.9 - Math.max(0, v - 0.55) * 1.2));
      img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, x, y);
}
