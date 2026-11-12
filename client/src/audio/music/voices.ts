// Synthesised instrument voices. Each function plays ONE note of an instrument into a `G`.
// They are used twice: to render the multi-sampled instruments of the score (where every
// frequency is quantised so the sustain loops exactly) and to write the announcer's stingers.
//
// Conventions: `at` start time, `dur` held length (a release tail follows it), `f` Hz.
// The sustain portion of every voice is perfectly steady so it can be looped.

import { G, P, X, type Env } from '../kit';

/** Chorus offset in Hz: about 7 cents, in half-hertz steps so 2 s loops stay periodic. */
const detOf = (f: number): number => Math.max(0.5, Math.round(f * 0.008) / 2);

// ------------------------------------------------------------------------------------- lur
/** Deep bronze horn: saws through a filter that opens with the breath, a blatty attack. */
export function horn(g: G, at: number, dur: number, f: number, gain: number, dest: AudioNode = g.out, o: { bright?: number; scoop?: boolean; attack?: number } = {}): void {
  const bright = o.bright ?? 1, det = detOf(f), a = o.attack ?? 0.07, r = 0.16, end = at + dur;
  const body = g.bus(dest, g.bq('peaking', 480, 1.4, 5), g.bq('peaking', 1250, 2, 3), g.lp(4400));
  const peak = Math.min(3600, f * 7 * bright + 400), sus = Math.min(2500, f * 4.2 * bright + 300);
  const filt = g.lp([[at, 220], [at + a, peak, 'e'], [at + a + 0.22, sus, 'e'], [end, sus], [end + r, 240, 'e']], 1.1);
  const amp = g.gain([[at, 0], [at + a, gain], [at + a + 0.2, gain * 0.86], [end, gain * 0.86], [end + r, 0]]);
  g.pipe(body, filt, amp);
  const fq = (x: number): Env => (o.scoop === false ? x : [[at, x * 0.955], [at + 0.06, x, 'e']]);
  g.pipe(filt, g.osc('sawtooth', fq(f), { at, end: end + r + 0.05 }), g.gain(0.5));
  g.pipe(filt, g.osc('sawtooth', fq(f + det), { at, end: end + r + 0.05 }), g.gain(0.34));
  g.pipe(filt, g.osc('square', fq(f - det), { at, end: end + r + 0.05 }), g.gain(0.1));
  g.nz('pink', 'bandpass', 900, 1, [[at, 0], [at + 0.03, gain * 0.5], [at + 0.2, gain * 0.07], [end, gain * 0.07], [end + r, 0]], body);
}

// ------------------------------------------------------------------------------------- choir
export type Vowel = 'ah' | 'mm' | 'oo';
const FORMANTS: Record<Vowel, [number, number, number][]> = {
  ah: [[720, 5, 1], [1180, 6, 0.55], [2650, 8, 0.2], [3300, 9, 0.08]],
  oo: [[360, 5, 1], [820, 6, 0.3], [2500, 8, 0.06]],
  mm: [[270, 3, 1], [1050, 5, 0.07], [2300, 6, 0.02]],
};

/** Wordless voices: four singers per note, each with their own vibrato, through vowel formants. */
export function choir(g: G, at: number, dur: number, f: number, gain: number, vowel: Vowel = 'ah', dest: AudioNode = g.out, o: { attack?: number; release?: number } = {}): void {
  const a = o.attack ?? 0.12, r = o.release ?? 0.3, end = at + dur, det = detOf(f);
  const amp = g.gain([[at, 0], [at + a, gain], [end, gain], [end + r, 0]]);
  amp.connect(dest);
  const pre = g.lp(vowel === 'mm' ? 900 : 5200);
  g.formants(pre, FORMANTS[vowel], amp);
  const singers: [number, number, number][] = [[0, 5, 0.34], [det, 5.5, 0.28], [-det, 4.5, 0.28], [det * 2, 6, 0.16]];
  for (const [d, rate, lvl] of singers) {
    const osc = g.osc('sawtooth', f + d, { at, end: end + r + 0.05 });
    g.lfo(rate, f * 0.0045).connect(osc.frequency);
    g.pipe(pre, osc, g.gain(lvl));
  }
  g.pipe(pre, g.noise('pink', { at, end: end + r + 0.05 }), g.gain(vowel === 'mm' ? 0.015 : 0.05));
}

// ------------------------------------------------------------------------------------- strings
/** A section of low strings: detuned saws with vibrato through a wooden body. */
export function strings(g: G, at: number, dur: number, f: number, gain: number, dest: AudioNode = g.out, o: { bright?: number; attack?: number; release?: number; trem?: number } = {}): void {
  const a = o.attack ?? 0.14, r = o.release ?? 0.25, end = at + dur, det = detOf(f);
  const amp = g.gain([[at, 0], [at + a, gain], [end, gain], [end + r, 0]]);
  let out: AudioNode = dest;
  if (o.trem) { const t = g.trem(o.trem, 0.75, 'triangle'); t.connect(dest); out = t; }
  amp.connect(out);
  const body = g.bus(amp, g.bq('peaking', 250, 1, 4), g.bq('peaking', 700, 1.4, 2.5), g.lp(Math.min(5200, (1700 + f * 4) * (o.bright ?? 1)), 0.7));
  const players: [number, number, number][] = [[0, 5, 0.3], [det, 5.5, 0.25], [-det, 4.5, 0.25], [det * 2, 6, 0.2]];
  for (const [d, rate, lvl] of players) {
    const osc = g.osc('sawtooth', f + d, { at, end: end + r + 0.05 });
    g.lfo(rate, f * 0.003).connect(osc.frequency);
    g.pipe(body, osc, g.gain(lvl));
  }
  g.nz('pink', 'bandpass', Math.min(4000, f * 3), 0.8, [[at, 0], [at + a, 0.07], [end, 0.07], [end + r, 0]], body);
}

/** A short, biting stroke for ostinatos. */
export function spicc(g: G, at: number, f: number, gain: number, dest: AudioNode = g.out): void {
  const det = detOf(f);
  const filt = g.lp(X(at, 0.25, Math.min(5200, f * 14), f * 3), 1);
  const amp = g.gain(P(at, 0.012, 0.32, gain));
  const body = g.bus(dest, g.bq('peaking', 250, 1, 4), g.bq('peaking', 700, 1.4, 2.5));
  g.pipe(body, filt, amp);
  for (const [d, lvl] of [[0, 0.4], [det, 0.3], [-det, 0.3]] as const) g.pipe(filt, g.osc('sawtooth', f + d, { at, end: at + 0.45 }), g.gain(lvl));
  g.nz('white', 'bandpass', 2500, 1, P(at, 0.004, 0.04, gain * 0.3), body);
}

// ------------------------------------------------------------------------------------- tagelharpa
/** Bowed horsehair lyre: nasal, raspy, alive with bow pressure. */
export function tagel(g: G, at: number, dur: number, f: number, gain: number, dest: AudioNode = g.out, o: { attack?: number; release?: number } = {}): void {
  const a = o.attack ?? 0.1, r = o.release ?? 0.2, end = at + dur, det = detOf(f);
  const amp = g.gain([[at, 0], [at + a, gain], [end, gain], [end + r, 0]]);
  // slow unevenness of the bow
  const w1 = g.trem(3, 0.16), w2 = g.trem(4.5, 0.1);
  g.pipe(dest, amp, w1, w2);
  const rasp = g.bus(amp, g.shaper(1.6), g.hp(120));
  const pre = g.gain(1);
  g.formants(pre, [[420, 3, 1], [1150, 4, 0.7], [2400, 5, 0.35]], rasp);
  g.pipe(rasp, pre, g.lp(900), g.gain(0.5));
  const o1 = g.osc('sawtooth', f, { at, end: end + r + 0.05 });
  g.lfo(5.5, f * 0.004).connect(o1.frequency);
  g.pipe(pre, o1, g.gain(0.5));
  g.pipe(pre, g.osc('square', f + det, { at, end: end + r + 0.05 }), g.gain(0.18));
  g.pipe(pre, g.osc('sawtooth', f * 2 - det, { at, end: end + r + 0.05 }), g.gain(0.1));
  // rosin: noise gated at the string's own frequency
  const grit = g.trem(f, 0.9, 'sawtooth');
  g.pipe(amp, g.noise('white', { at, end: end + r + 0.05 }), g.bp(3000, 0.8), g.gain(0.1), grit);
}

// ------------------------------------------------------------------------------------- drums
/** Great war drum: a hide a metre across. `hard` 0..1 is how hard it was struck. */
export function warDrum(g: G, at: number, gain: number, dest: AudioNode = g.out, o: { f?: number; hard?: number; len?: number } = {}): void {
  const f = o.f ?? 62, hard = o.hard ?? 0.7, len = o.len ?? 1;
  g.tone('sine', [[at, f * (1.8 + hard)], [at + 0.045, f, 'e']], P(at, 0.003, 0.95 * len, gain), dest);
  g.tone('sine', [[at, f * 1.59 * 1.3], [at + 0.04, f * 1.59, 'e']], P(at, 0.003, 0.42 * len, gain * 0.45), dest);
  g.tone('sine', f * 2.14, P(at, 0.003, 0.24 * len, gain * 0.25), dest);
  g.tone('triangle', f * 2.65, P(at, 0.003, 0.14 * len, gain * 0.12), dest);
  g.nz('pink', 'bandpass', 190, 1, P(at, 0.003, 0.22, gain * 0.8), dest);
  g.nz('white', 'lowpass', 900 + hard * 2600, 0.7, P(at, 0.001, 0.035 + hard * 0.02, gain * (0.5 + hard * 0.7)), dest);
}

/** Hand-held frame drum: 'dum' open centre, 'tak' sharp rim, 'ka' soft muted finger. */
export function frameDrum(g: G, at: number, gain: number, kind: 'dum' | 'tak' | 'ka', dest: AudioNode = g.out, tune = 1): void {
  if (kind === 'dum') {
    const f = 104 * tune;
    g.tone('sine', [[at, f * 1.8], [at + 0.03, f, 'e']], P(at, 0.002, 0.34, gain), dest);
    g.tone('sine', f * 1.59, P(at, 0.002, 0.16, gain * 0.4), dest);
    g.tone('sine', f * 2.3, P(at, 0.002, 0.09, gain * 0.2), dest);
    g.nz('pink', 'lowpass', 1400, 0.7, P(at, 0.001, 0.03, gain * 0.8), dest);
  } else if (kind === 'tak') {
    g.modal(at, [[420, 1, 0.08], [980, 0.6, 0.06], [1650, 0.3, 0.04]], gain * 0.5, dest, { mul: tune });
    g.nz('white', 'highpass', 2000, 0.7, P(at, 0.0008, 0.04, gain * 0.9), dest);
    g.click(at, 1800 * tune, gain, dest, 0.01);
  } else {
    g.tone('sine', [[at, 260 * tune], [at + 0.02, 170 * tune, 'e']], P(at, 0.002, 0.07, gain * 0.7), dest);
    g.nz('pink', 'bandpass', 800 * tune, 1.2, P(at, 0.001, 0.03, gain * 0.9), dest);
  }
}

// ------------------------------------------------------------------------------------- metal
const BRONZE: [number, number, number][] = [[0.5, 0.6, 1], [1, 1, 0.9], [1.19, 0.5, 0.7], [1.5, 0.35, 0.6], [2, 0.5, 0.5], [2.74, 0.25, 0.35], [3, 0.2, 0.3], [4.07, 0.12, 0.2]];
/** Cast bronze bell with a hum tone and a minor-third partial. */
export function bell(g: G, at: number, f: number, gain: number, t60 = 3, dest: AudioNode = g.out): void {
  g.modal(at, BRONZE, gain * 0.22, dest, { mul: f, decay: t60 });
  g.click(at, Math.min(7000, f * 6), gain * 0.5, dest, 0.008, 1);
}

const IRON: [number, number, number][] = [[1, 1, 0.5], [1.47, 0.7, 0.4], [2.09, 0.5, 0.35], [2.56, 0.4, 0.3], [3.18, 0.3, 0.2], [4.3, 0.2, 0.15]];
/** Hammer on an anvil. */
export function anvil(g: G, at: number, gain: number, dest: AudioNode = g.out, tune = 1): void {
  g.modal(at, IRON, gain * 0.22, dest, { mul: 1900 * tune });
  g.click(at, 5000, gain, dest, 0.006, 1);
  g.tone('sine', [[at, 320], [at + 0.03, 210, 'e']], P(at, 0.001, 0.06, gain * 0.5), dest);
}
