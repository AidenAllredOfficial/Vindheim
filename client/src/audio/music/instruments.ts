// The orchestra of the score, as multi-sampled instruments rendered from the voices in
// voices.ts. Sustained instruments are stored as a short attack followed by an exactly periodic
// 2-second loop (every oscillator and LFO is quantised to 0.5 Hz; the player corrects the tuning
// with playbackRate). Percussion, lyre and bells are plain one-shots.

import { G, P, R, X } from '../kit';
import { midiHz, pluckString, lerp, clamp01 } from '../dsp';
import type { DefMap, SoundDef } from '../bank';
import { horn, choir, strings, spicc, tagel, warDrum, frameDrum, bell, anvil } from './voices';

export type InstrName = 'tagel' | 'str' | 'trem' | 'horn' | 'ah' | 'mm' | 'spicc' | 'lyre' | 'bell';

const range = (from: number, to: number, step: number): number[] => { const a: number[] = []; for (let m = from; m <= to; m += step) a.push(m); return a; };

/** MIDI roots sampled for each instrument, and whether it sustains (loops). */
export const INSTRUMENTS: Record<InstrName, { roots: number[]; sustained: boolean }> = {
  tagel: { roots: [36, 38, 41, 43, 45, 48, 50, 54, 58, 62, 66, 70, 74], sustained: true },
  str: { roots: range(26, 61, 5), sustained: true },
  trem: { roots: [62, 67, 72, 77], sustained: true },
  horn: { roots: range(38, 65, 3), sustained: true },
  ah: { roots: range(50, 77, 3), sustained: true },
  mm: { roots: range(45, 69, 3), sustained: true },
  spicc: { roots: range(38, 63, 5), sustained: false },
  lyre: { roots: range(50, 86, 3), sustained: false },
  bell: { roots: [62, 69, 74], sustained: false },
};

export const sampleKey = (instr: InstrName, root: number): string => `m.${instr}.${root}`;

const PRE = 0.5, LOOP = 2;
/** Quantise to 0.5 Hz so the tone is periodic in the 2 s loop. */
const q = (f: number): number => Math.max(0.5, Math.round(f * 2) / 2);

/**
 * `lean`: the chorus of a voice is not symmetric about its nominal frequency (the detuned players
 * sit a little sharp on average). It is expressed as a fraction of the detune step and folded into
 * the root frequency the player tunes from, so sections are in tune as heard — it matters in the
 * bass, where a half-hertz is several cents.
 */
function sustained(root: number, lvl: number, lean: number, voice: (g: G, f: number) => void): SoundDef {
  const f = q(midiHz(root)), det = Math.max(0.5, Math.round(f * 0.008) / 2);
  return { dur: LOOP, lvl, hz: f + lean * det, loop: { pre: PRE, xf: 0.02, law: 'lin', keepPre: true }, build: (g) => voice(g, f) };
}

export function musicDefs(): DefMap {
  const d: DefMap = {};
  const HOLD = 20; // far longer than the slot: the voice is still sustaining when the slot ends

  for (const m of INSTRUMENTS.tagel.roots) d[sampleKey('tagel', m)] = sustained(m, 0.12, 0.17, (g, f) => tagel(g, 0, HOLD, f, 1));
  for (const m of INSTRUMENTS.str.roots) d[sampleKey('str', m)] = sustained(m, 0.12, 0.4, (g, f) => strings(g, 0, HOLD, f, 1));
  for (const m of INSTRUMENTS.trem.roots) d[sampleKey('trem', m)] = sustained(m, 0.1, 0.4, (g, f) => strings(g, 0, HOLD, f, 1, undefined, { trem: 11, bright: 1.3, attack: 0.08 }));
  for (const m of INSTRUMENTS.horn.roots) d[sampleKey('horn', m)] = sustained(m, 0.12, 0.25, (g, f) => horn(g, 0, HOLD, f, 1));
  for (const m of INSTRUMENTS.ah.roots) d[sampleKey('ah', m)] = sustained(m, 0.12, 0.3, (g, f) => choir(g, 0, HOLD, f, 1, 'ah'));
  for (const m of INSTRUMENTS.mm.roots) d[sampleKey('mm', m)] = sustained(m, 0.12, 0.3, (g, f) => choir(g, 0, HOLD, f, 1, 'mm'));

  for (const m of INSTRUMENTS.spicc.roots) {
    const hz = midiHz(m);
    d[sampleKey('spicc', m)] = { dur: 0.5, lvl: 0.2, hz, build: (g) => spicc(g, 0, hz, 1) };
  }
  for (const m of INSTRUMENTS.lyre.roots) {
    const hz = midiHz(m), u = clamp01((m - 50) / 36);
    const t60 = lerp(2.7, 1.3, u);
    d[sampleKey('lyre', m)] = { dur: t60 + 0.2, lvl: 0.2, hz, js: (sr, rng) => pluckString(hz, t60 + 0.2, sr, rng, { t60, bright: lerp(3000, 5600, u) }) };
  }
  for (const m of INSTRUMENTS.bell.roots) {
    const hz = midiHz(m);
    d[sampleKey('bell', m)] = { dur: 3.6, lvl: 0.18, hz, fadeOut: 0.3, build: (g) => bell(g, 0, hz, 1, 3.2) };
  }

  // ---- percussion
  [[60, 0.3], [64, 0.4]].forEach(([f, hard], i) => { d[`m.war.s${i}`] = { dur: 1.2, lvl: 0.2, fadeOut: 0.1, build: (g) => warDrum(g, 0, 1, undefined, { f, hard, len: 0.9 }) }; });
  [[58, 0.85], [62, 1], [66, 0.9]].forEach(([f, hard], i) => { d[`m.war.h${i}`] = { dur: 1.4, lvl: 0.26, fadeOut: 0.1, build: (g) => warDrum(g, 0, 1, undefined, { f, hard }) }; });
  [1, 1.07].forEach((tune, i) => {
    d[`m.frame.dum${i}`] = { dur: 0.45, lvl: 0.2, build: (g) => frameDrum(g, 0, 1, 'dum', undefined, tune) };
    d[`m.frame.tak${i}`] = { dur: 0.2, lvl: 0.17, build: (g) => frameDrum(g, 0, 1, 'tak', undefined, tune) };
    d[`m.frame.ka${i}`] = { dur: 0.14, lvl: 0.12, build: (g) => frameDrum(g, 0, 1, 'ka', undefined, tune) };
    d[`m.anvil${i}`] = { dur: 0.75, lvl: 0.16, fadeOut: 0.1, build: (g) => anvil(g, 0, 1, undefined, i ? 1.12 : 1) };
    d[`m.rattle${i}`] = { dur: 0.09, lvl: 0.1, build: (g) => { g.ticks({ n: 4, from: 0, to: 0.035, f: [2500 * tune, 6000], q: 3, len: [0.004, 0.012], g: 1 }); } };
    d[`m.stick${i}`] = { dur: 0.1, lvl: 0.12, build: (g) => { g.modal(0, [[700, 1, 0.05], [1650, 0.5, 0.035], [2900, 0.25, 0.02]], 0.4, undefined, { mul: tune }); g.click(0, 2600 * tune, 0.6, undefined, 0.006); } };
  });
  // the whole drum line landing together
  d['m.hit'] = {
    dur: 2.4, lvl: 0.3, fadeOut: 0.3,
    build: (g) => {
      warDrum(g, 0, 1, undefined, { f: 48, hard: 1, len: 1.4 });
      warDrum(g, 0.006, 0.8, undefined, { f: 58, hard: 1 });
      warDrum(g, 0.012, 0.6, undefined, { f: 70, hard: 0.9 });
      g.nz('white', 'lowpass', X(0, 0.3, 5000, 600), 0.7, P(0, 0.002, 0.35, 0.6));
      g.nz('brown', 'lowpass', 120, 0.7, P(0, 0.01, 1.6, 0.5));
    },
  };
  // a heartbeat on a slack hide: lub-dub
  d['m.heart'] = {
    dur: 0.6, lvl: 0.2,
    build: (g) => {
      const b = g.bus(undefined, g.lp(240));
      warDrum(g, 0, 1, b, { f: 50, hard: 0.1, len: 0.35 });
      warDrum(g, 0.17, 0.65, b, { f: 44, hard: 0, len: 0.35 });
    },
  };
  // a three-second swell that stops dead on a bar line
  d['m.riser'] = {
    dur: 3, lvl: 0.2, fadeOut: 0.02,
    build: (g) => {
      g.nz('white', 'bandpass', X(0, 3, 300, 4200), 1.5, R(0, 3, 1, 0.03));
      g.nz('pink', 'lowpass', X(0, 3, 200, 1500), 1, R(0, 3, 0.7, 0.03));
      g.tone('sine', X(0, 3, 73.4, 146.8), R(0, 3, 0.3, 0.03));
      const t = g.trem(X(0, 3, 6, 18), 0.8);
      t.connect(g.out);
      g.tone('sawtooth', 293.7, R(0, 3, 0.07, 0.03), t);
      g.tone('sawtooth', 440, R(0, 3, 0.05, 0.03), t);
    },
  };
  // the deep bloom that marks an arrival
  d['m.boom'] = {
    dur: 3.2, lvl: 0.24, fadeOut: 0.4,
    build: (g) => {
      g.thump(0, 74, 33, 2.6, 1);
      g.nz('brown', 'lowpass', 130, 0.7, P(0, 0.01, 1.8, 0.6));
      g.nz('pink', 'lowpass', X(0, 0.5, 2000, 300), 0.7, P(0, 0.004, 0.5, 0.4));
    },
  };
  return d;
}
