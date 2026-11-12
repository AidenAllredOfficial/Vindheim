// Ambience beds. All are seamless loops whose slow modulation is periodic in the loop length;
// the engine layers them and drives their levels / pitch from the weather every frame.

import { G, P, S, X } from '../kit';
import type { DefMap, SoundDef } from '../bank';
import { loop } from './common';

const bed = (dur: number, lvl: number, build: (g: G) => void): SoundDef => loop(build, { lvl }, dur, { pre: 1, xf: 0.05 });

export const CREAK_VARIANTS = 4;

export function ambienceDefs(): DefMap {
  const d: DefMap = {
    // the body of the wind: weight without pitch
    'amb.windLow': bed(8, 0.1, (g) => {
      const t1 = g.trem(0.25, 0.5), t2 = g.trem(0.375, 0.45);
      g.pipe(g.out, t1, t2);
      g.nz('brown', 'lowpass', 260, 0.7, 0.6, t1);
      const bp = g.bp(330, 0.8);
      g.lfo(0.125, 120).connect(bp.frequency);
      g.pipe(t1, g.noise('pink'), bp, g.gain(0.9));
    }),
    // the voice of the wind: a wandering whistle through rock and timber
    'amb.windHigh': bed(8, 0.08, (g) => {
      const t = g.trem(0.5, 0.35);
      t.connect(g.out);
      const b1 = g.bp(1100, 3);
      g.lfo(0.25, 350).connect(b1.frequency);
      g.lfo(0.625, 150).connect(b1.frequency);
      g.pipe(t, g.noise('white'), b1, g.gain(1));
      const b2 = g.bp(2400, 5);
      g.lfo(0.375, 600).connect(b2.frequency);
      g.pipe(t, g.noise('white'), b2, g.gain(0.45));
      g.band('white', 500, 3000, 0.1, t);
    }),
    // blizzard: the moan of wind forced through a gap
    'amb.howl': bed(8, 0.09, (g) => {
      const t1 = g.trem(0.125, 0.75), t2 = g.trem(0.25, 0.65);
      t1.connect(g.out); t2.connect(g.out);
      const b1 = g.bp(430, 20);
      g.lfo(0.25, 90).connect(b1.frequency);
      g.lfo(0.875, 30).connect(b1.frequency);
      g.pipe(t1, g.noise('white'), b1, g.gain(1));
      const b2 = g.bp(640, 22);
      g.lfo(0.375, 120).connect(b2.frequency);
      g.pipe(t2, g.noise('white'), b2, g.gain(0.7));
      const b3 = g.bp(860, 24);
      g.lfo(0.125, 160).connect(b3.frequency);
      g.pipe(t1, g.noise('white'), b3, g.gain(0.35));
    }),
    // falling snow: the hush that swallows everything else
    'amb.snow': bed(4, 0.035, (g) => {
      const t = g.trem(0.25, 0.25);
      t.connect(g.out);
      g.nz('white', 'highpass', 6500, 0.7, 0.5, t);
      g.nz('white', 'bandpass', 4500, 0.5, 0.35, t);
    }),
    // a storm somewhere below the horizon
    'amb.rumble': bed(8, 0.1, (g) => {
      const t1 = g.trem(0.125, 0.85), t2 = g.trem(0.375, 0.7), t3 = g.trem(0.25, 0.6);
      g.pipe(g.out, t1, t2);
      t3.connect(g.out);
      g.nz('brown', 'lowpass', 80, 0.7, 1, t1);
      g.nz('pink', 'lowpass', 170, 0.7, 0.5, t3);
    }),
    // the cloud sea: a huge, soft, almost pitched breath from below
    'amb.clouds': bed(8, 0.06, (g) => {
      const t1 = g.trem(0.125, 0.5), t2 = g.trem(0.25, 0.5), t3 = g.trem(0.375, 0.5);
      t1.connect(g.out); t2.connect(g.out); t3.connect(g.out);
      g.tone('sine', 55, 0.12, t1);
      g.tone('sine', 82.5, 0.07, t2);
      g.nz('pink', 'bandpass', 220, 0.7, 0.5, t3);
      g.nz('white', 'bandpass', 700, 0.6, 0.08, t1);
    }),
    // aurora: thin glass tones that fade in and out of each other
    'amb.aurora': bed(8, 0.03, (g) => {
      const notes: [number, number, number][] = [[1174.5, 0.375, 1], [1760, 0.625, 0.8], [2637, 0.875, 0.55], [2960, 0.5, 0.4], [3520, 1.125, 0.3]];
      for (const [f, rate, a] of notes) {
        const t = g.trem(rate, 0.92);
        t.connect(g.out);
        const o = g.osc('sine', f);
        g.lfo(0.25, 3).connect(o.frequency);
        g.pipe(t, o, g.gain(a * 0.2));
      }
      const t = g.trem(0.75, 0.8);
      t.connect(g.out);
      g.nz('white', 'highpass', 8000, 0.7, 0.05, t);
    }),
    // the long fire of the hall
    'amb.fire': bed(4, 0.11, (g) => {
      const b = g.bus(undefined, g.shaper(2), g.lp(5200));
      const f1 = g.trem(6, 0.4), f2 = g.trem(4, 0.35);
      f1.connect(b); f2.connect(b);
      g.nz('brown', 'lowpass', 350, 0.7, 0.45, f1);
      g.nz('pink', 'bandpass', 650, 0.7, 0.9, f2);
      g.nz('white', 'bandpass', 2400, 0.8, 0.1, f1);
      g.ticks({ n: 70, from: 1, to: 4.94, f: [1500, 5200], q: 2.5, len: [0.003, 0.018], g: 0.9, groups: 3 });
      g.ticks({ n: 9, from: 1, to: 4.9, f: [500, 1000], q: 2, len: [0.02, 0.05], g: 0.9, kind: 'pink', groups: 1 });
    }),
  };
  // old timber settling: stick-slip through the resonances of a beam
  for (let v = 0; v < CREAK_VARIANTS; v++) {
    const dur = [0.7, 1.1, 0.55, 0.9][v];
    d[`amb.creak.${v}`] = {
      dur, lvl: 0.07, ref: 5, range: 40, pri: 0.2, vary: 1.5,
      build: (g) => {
        const f0 = g.rng.range(52, 90), f1 = f0 * g.rng.range(0.7, 1.35);
        const src = g.gain(S(0, dur - 0.05, 1, g.rng.range(0.3, 0.7)));
        g.pipe(src, g.osc('sawtooth', [[0, f0], [dur * 0.5, f1], [dur - 0.05, f0 * 0.9]]));
        const tune = g.rng.range(0.85, 1.2);
        g.formants(src, [[310 * tune, 12, 1], [680 * tune, 14, 0.7], [1250 * tune, 16, 0.4]]);
        g.ticks({ n: 3, from: 0.05, to: dur - 0.1, f: [300, 800], q: 3, len: [0.01, 0.03], g: 0.5, kind: 'pink', groups: 1 });
        g.nz('pink', 'bandpass', X(0, dur, 500, 400), 3, P(0, 0.02, dur * 0.6, 0.15));
      },
    };
  }
  return d;
}
