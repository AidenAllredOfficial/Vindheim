// FROST — glassy chimes, cracks, crystalline shatter. Thin, high, brittle; almost no low end.

import { G, P, S, R, X } from '../kit';
import type { DefMap } from '../bank';
import { tell, rel, big, small, loop, hitLight, hitHeavy, hitTick, whoosh, LV } from './common';

/** Inharmonic partials of a struck sheet of ice / glass: [ratio, gain, t60]. */
const GLASS: [number, number, number][] = [[1, 1, 0.5], [2.32, 0.6, 0.36], [3.85, 0.42, 0.26], [5.63, 0.26, 0.18], [7.9, 0.14, 0.12]];
const CHIME: [number, number, number][] = [[1, 1, 0.9], [2.76, 0.45, 0.6], [5.4, 0.2, 0.3]];

const glass = (g: G, at: number, f: number, gain: number, decay = 1, dest?: AudioNode): void => g.modal(at, GLASS, gain * 0.22, dest, { mul: f, decay });
const chime = (g: G, at: number, f: number, gain: number, decay = 1, dest?: AudioNode): void => g.modal(at, CHIME, gain * 0.22, dest, { mul: f, decay });

/** A dry snap of ice. */
function crack(g: G, at: number, gain: number, dest?: AudioNode): void {
  g.click(at, 3800, gain, dest, 0.01, 1.5);
  g.click(at + 0.002, 7000, gain * 0.7, dest, 0.006, 2);
  g.ticks({ n: 4, from: at, to: at + 0.035, f: [3200, 8200], q: 3, len: [0.002, 0.008], g: gain * 0.7, dest });
}

/** Many fragments scattering. */
function shatter(g: G, at: number, dur: number, n: number, gain: number, dest?: AudioNode): void {
  g.ticks({ n, from: at, to: at + dur, f: [2600, 9000], q: 3, len: [0.003, 0.02], g: gain, bias: 2, groups: 3, dest });
  const k = Math.max(2, Math.round(n / 10));
  for (let i = 0; i < k; i++) glass(g, at + g.rng.range(0, dur * 0.5) * (i / k), g.rng.xrange(1700, 4300), gain * g.rng.range(0.4, 1), 0.6, dest);
}

/** Cold breath: thin hiss. */
const hiss = (g: G, at: number, dur: number, gain: number, pos = 0.4): void => { g.nz('white', 'highpass', 5200, 0.7, S(at, dur, gain, pos)); };

export function frostDefs(): DefMap {
  return {
    // ---- Rime Cleave
    'cs.frost_melee': tell(0.3, (g) => {
      chime(g, 0, 2093, 0.6, 0.35);
      g.tone('sine', X(0, 0.28, 1400, 2800), R(0, 0.29, 0.1));
      g.nz('white', 'bandpass', X(0, 0.28, 3000, 6500), 3, R(0, 0.29, 1));
      g.ticks({ n: 5, from: 0.08, to: 0.27, f: [4000, 8000], q: 3, len: [0.002, 0.007], g: 0.5, bias: 0.6 });
    }),
    'cr.frost_melee': rel(0.5, (g) => {
      whoosh(g, 0, 0.2, [1800, 5200, 2400], 1.2, 2);
      crack(g, 0.05, 0.7);
      glass(g, 0.05, 2637, 0.6, 0.7);
      hiss(g, 0.02, 0.45, 0.35, 0.2);
    }),
    // ---- Ice Shards
    'cs.iceshards': tell(0.15, (g) => {
      chime(g, 0, 3136, 0.8, 0.14);
      chime(g, 0.05, 3951, 0.6, 0.12);
      g.nz('white', 'highpass', 6000, 0.7, R(0, 0.145, 0.6));
    }),
    'cr.iceshards': rel(0.38, (g) => {
      hiss(g, 0, 0.36, 0.9, 0.12);
      whoosh(g, 0, 0.28, [2600, 5000, 3000], 0.6, 2.5, undefined, 0.2);
      chime(g, 0, 1568, 0.35, 0.3);
    }, { lvl: LV.small * 1.2 }),
    'ent.iceshard.spawn': rel(0.26, (g) => {
      crack(g, 0, 0.8);
      glass(g, 0, 3520, 0.8, 0.3);
      whoosh(g, 0.005, 0.22, [5200, 3200, 2200], 0.9, 3, undefined, 0.15);
    }, { lvl: LV.rel * 0.85, vary: 1.5 }),
    'ent.iceshard.break': small(0.3, (g) => {
      crack(g, 0, 1);
      shatter(g, 0.005, 0.2, 12, 0.6);
    }, { vary: 2 }),
    // ---- Glacial Spikes
    'cs.glacialspikes': tell(0.36, (g) => {
      g.tone('triangle', X(0, 0.34, 520, 1040), R(0, 0.35, 0.16));
      g.tone('sine', X(0, 0.34, 1560, 3120), R(0, 0.35, 0.1));
      g.nz('white', 'bandpass', X(0, 0.34, 2200, 7000), 4, R(0, 0.35, 1));
      g.ticks({ n: 9, from: 0.06, to: 0.34, f: [3000, 7000], q: 3, len: [0.003, 0.01], g: 0.6, bias: 0.5 });
    }),
    'cr.glacialspikes': rel(0.4, (g) => {
      g.thump(0, 170, 80, 0.12, 0.25);
      crack(g, 0, 1);
      glass(g, 0, 1397, 0.7, 0.6);
      hiss(g, 0, 0.35, 0.4, 0.1);
    }),
    'ent.spikes.erupt': big(1.15, (g) => {
      // the front races away: a staccato run of cracks rising in pitch, then ringing ice
      const n = 9;
      for (let i = 0; i < n; i++) {
        const t = 0.01 + (i / n) * 0.46;
        crack(g, t, 0.9 - i * 0.04);
        glass(g, t, 1200 * Math.pow(1.11, i) * g.rng.range(0.97, 1.03), 0.55, 0.45);
        g.thump(t, 240, 120, 0.05, 0.12);
      }
      g.nz('white', 'bandpass', X(0, 0.5, 2400, 6400), 2, S(0, 0.55, 0.6, 0.8));
      hiss(g, 0.3, 0.8, 0.3, 0.3);
    }, { lvl: LV.hitHeavy, ref: 9, range: 120, vary: 0.3 }),
    'ent.spikes.crumble': rel(0.8, (g) => {
      shatter(g, 0, 0.6, 46, 0.8);
      g.ticks({ n: 10, from: 0, to: 0.6, f: [700, 1800], q: 2, len: [0.01, 0.04], g: 0.4, bias: 1.6, kind: 'pink' });
      hiss(g, 0, 0.75, 0.3, 0.1);
    }),
    // ---- Rime Rune
    'cs.rimerune': tell(0.32, (g) => {
      // a blade scratching a rune into ice, ending on a faint ting
      g.nz('white', 'bandpass', [[0, 4200], [0.1, 6200], [0.16, 3600], [0.3, 7000]], 5, [[0, 0], [0.02, 1], [0.12, 0.5], [0.16, 1], [0.3, 0.2], [0.32, 0]]);
      g.ticks({ n: 12, from: 0, to: 0.3, f: [5000, 9000], q: 4, len: [0.002, 0.006], g: 0.6 });
      chime(g, 0.24, 2349, 0.5, 0.1);
    }),
    'cr.rimerune': rel(0.55, (g) => {
      chime(g, 0, 1175, 0.7, 0.5);
      chime(g, 0.03, 1760, 0.5, 0.45);
      hiss(g, 0, 0.5, 0.4, 0.1);
      g.nz('white', 'bandpass', X(0, 0.4, 5000, 1800), 3, P(0, 0.01, 0.4, 0.5));
    }, { lvl: LV.small * 1.2, range: 40 }),
    'ent.rimerune.spawn': small(0.9, (g) => {
      // settles, then a soft "armed" ting near the end of the arm time
      g.nz('white', 'highpass', 6500, 0.7, P(0, 0.01, 0.5, 0.5));
      g.ticks({ n: 10, from: 0, to: 0.7, f: [4500, 9000], q: 4, len: [0.002, 0.006], g: 0.4, bias: 1.5 });
      chime(g, 0.76, 3520, 0.5, 0.12);
    }, { lvl: LV.tick, range: 16, ref: 3, vary: 0.3 }),
    'ent.rimerune.loop': loop((g) => {
      // the faint shimmer an attentive ear can catch near a hidden rune
      const t1 = g.trem(1.5, 0.8), t2 = g.trem(2.5, 0.8), t3 = g.trem(0.5, 0.6);
      g.pipe(g.out, g.osc('sine', 4186), g.gain(0.1), t1);
      g.pipe(g.out, g.osc('sine', 5274), g.gain(0.07), t2);
      g.pipe(g.out, g.osc('sine', 6272), g.gain(0.05), t3);
      g.nz('white', 'highpass', 7000, 0.7, 0.12, t2);
    }, { lvl: 0.03, range: 11, ref: 2.5, pri: 0.5 }),
    'ent.rimerune.trigger': rel(0.3, (g) => {
      crack(g, 0, 1);
      g.thump(0, 300, 140, 0.06, 0.2);
      glass(g, 0, 1976, 0.9, 0.4);
      glass(g, 0.01, 2960, 0.6, 0.3);
    }, { pri: 3 }),
    'ent.rimerune.fade': small(0.5, (g) => {
      chime(g, 0, 2794, 0.5, 0.3);
      g.nz('white', 'highpass', 6000, 0.7, P(0, 0.02, 0.4, 0.4));
    }, { lvl: LV.tick, range: 14 }),
    'fx.rimeburst': big(1.2, (g) => {
      // freezing nova: an inrush of cold, a glassy bloom, then settling frost
      g.nz('white', 'bandpass', X(0, 0.5, 7000, 1500), 1.6, P(0, 0.006, 0.5, 1));
      g.thump(0, 200, 70, 0.2, 0.35);
      for (const [f, t] of [[1047, 0], [1568, 0.01], [2093, 0.02], [3136, 0.035], [4186, 0.05]] as const) glass(g, t, f, 0.8, 1.6);
      shatter(g, 0.03, 0.5, 24, 0.5);
      hiss(g, 0.05, 1.1, 0.4, 0.15);
      g.ticks({ n: 16, from: 0.4, to: 1.1, f: [5000, 9000], q: 4, len: [0.002, 0.007], g: 0.3 });
    }, { lvl: LV.hitHeavy, ref: 8, range: 110 }),
    // ---- Glacier Glide
    'cs.glacierglide': tell(0.1, (g) => {
      crack(g, 0, 0.9);
      chime(g, 0, 2637, 0.6, 0.08);
    }, { lvl: LV.small }),
    'cr.glacierglide': rel(1.6, (g) => {
      // skating scrape: a narrow hiss that sings as the ice forms under the blade
      g.nz('white', 'bandpass', [[0, 2400], [0.15, 5200, 'e'], [1.2, 4400], [1.55, 2600, 'e']], 6, [[0, 0], [0.08, 2.2], [1.25, 1.6], [1.58, 0]]);
      g.nz('white', 'highpass', 7000, 0.7, [[0, 0], [0.1, 0.35], [1.3, 0.25], [1.58, 0]]);
      g.tone('sine', [[0, 1800], [0.2, 2500, 'e'], [1.5, 2200]], [[0, 0], [0.1, 0.05], [1.3, 0.04], [1.55, 0]]);
      g.ticks({ n: 30, from: 0.05, to: 1.5, f: [3500, 8500], q: 4, len: [0.002, 0.008], g: 0.5 });
      crack(g, 0, 0.6);
    }, { vary: 0.3 }),
    'ent.icetrail.spawn': small(0.3, (g) => {
      g.ticks({ n: 12, from: 0, to: 0.22, f: [3500, 8000], q: 3.5, len: [0.002, 0.008], g: 0.9, bias: 1.4 });
      chime(g, 0.01, g.rng.xrange(2800, 4200), 0.3, 0.2);
    }, { lvl: LV.tick, range: 30, vary: 2.5 }),
    'ent.icetrail.end': small(0.35, (g) => {
      g.ticks({ n: 14, from: 0, to: 0.3, f: [2500, 6500], q: 3, len: [0.003, 0.012], g: 0.8, bias: 1.5 });
    }, { lvl: LV.tick * 0.8, range: 22, vary: 2.5 }),
    // ---- hit layers
    'hit.frost.l': hitLight(0.34, (g) => {
      crack(g, 0, 1);
      glass(g, 0, 2489, 0.9, 0.5);
      shatter(g, 0.005, 0.2, 10, 0.5);
    }),
    'hit.frost.h': hitHeavy(0.75, (g) => {
      crack(g, 0, 1);
      g.thump(0, 260, 110, 0.1, 0.3);
      glass(g, 0, 1661, 1, 1.1);
      glass(g, 0.008, 2217, 0.7, 0.9);
      shatter(g, 0.01, 0.5, 34, 0.75);
      hiss(g, 0, 0.6, 0.3, 0.05);
    }),
    'hit.frost.t': hitTick(0.14, (g) => {
      g.ticks({ n: 5, from: 0, to: 0.08, f: [4000, 8500], q: 3, len: [0.002, 0.008], g: 1 });
      chime(g, 0, 3729, 0.4, 0.1);
    }),
  };
}
