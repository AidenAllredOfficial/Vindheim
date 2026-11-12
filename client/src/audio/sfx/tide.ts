// TIDE — splashes, gurgles, rushing water. Round, wet, resonant; rolls rather than cracks.

import { G, P, S, R, X } from '../kit';
import type { DefMap } from '../bank';
import { tell, rel, big, small, loop, hitLight, hitHeavy, hitTick, rumble, LV } from './common';

/** Everything wet goes through a gentle roll-off: water has no hard edges. */
const wet = (g: G, top = 4200): GainNode => g.bus(undefined, g.lp(top, 0.8));

/** A slap of water: bright burst that sinks quickly. */
function splash(g: G, at: number, dur: number, gain: number, dest: AudioNode): void {
  g.nz('white', 'lowpass', X(at, dur, 5200, 700), 1.2, P(at, 0.004, dur, gain), dest);
  g.nz('pink', 'bandpass', X(at, dur * 0.8, 1500, 500), 1.5, P(at, 0.008, dur * 0.8, gain * 0.9), dest);
  g.ticks({ n: Math.round(dur * 30), from: at + 0.02, to: at + dur, f: [1800, 4200], q: 2, len: [0.004, 0.015], g: gain * 0.5, bias: 1.6, dest });
}

/** Bubbles rising: sine chirps. */
const gurgle = (g: G, from: number, to: number, n: number, gain: number, dest?: AudioNode, f: [number, number] = [260, 900]): void => g.blips(n, from, to, f, 1.55, [0.025, 0.07], gain * 0.3, dest);

/** Moving water: a resonant sweep through pink noise. */
function rush(g: G, at: number, dur: number, f0: number, f1: number, gain: number, dest: AudioNode, pos = 0.4, q = 2.5): void {
  g.nz('pink', 'lowpass', X(at, dur, f0, f1), q, S(at, dur, gain, pos), dest);
  g.nz('white', 'bandpass', X(at, dur, f0 * 1.8, f1 * 1.8), 1, S(at, dur, gain * 0.35, pos), dest);
}

export function tideDefs(): DefMap {
  const defs: DefMap = {
    // ---- Undertow Hook
    'cs.tide_melee': tell(0.29, (g) => {
      const b = wet(g);
      rush(g, 0, 0.28, 300, 1300, 1, b, 0.9);
      gurgle(g, 0.02, 0.24, 6, 0.8);
    }),
    'cr.tide_melee': rel(0.55, (g) => {
      const b = wet(g);
      rush(g, 0, 0.3, 1600, 500, 1.1, b, 0.3, 3);
      splash(g, 0.08, 0.4, 0.9, b);
      gurgle(g, 0.1, 0.5, 5, 0.5);
    }),
    // ---- Water Jet
    'cs.waterjet': tell(0.16, (g) => {
      const b = wet(g, 5000);
      g.nz('white', 'bandpass', X(0, 0.15, 700, 2800), 3, R(0, 0.155, 1), b);
      gurgle(g, 0, 0.13, 4, 0.9, undefined, [400, 1200]);
    }),
    'cr.waterjet': rel(0.4, (g) => {
      const b = wet(g, 5200);
      splash(g, 0, 0.36, 1, b);
      g.thump(0, 140, 70, 0.12, 0.3, b);
    }),
    'ent.waterjet.loop': loop((g) => {
      // pressurised: a hard hiss with the churn of water behind it
      const b = wet(g, 5600);
      const t = g.trem(14, 0.3), t2 = g.trem(5, 0.4);
      t.connect(b); t2.connect(b);
      g.band('white', 1400, 5200, 0.9, t);
      g.nz('pink', 'lowpass', 900, 2.5, 0.8, t2);
      const bp = g.bp(2100, 6);
      g.lfo(3, 400).connect(bp.frequency);
      g.pipe(t, g.noise('white'), bp, g.gain(0.9));
      g.blips(26, 0.5, 2.44, [300, 1100], 1.5, [0.02, 0.05], 0.12, b);
    }, { range: 65, ref: 6, pri: 3, lvl: LV.loop * 1.2 }),
    'ent.waterjet.end': small(0.6, (g) => {
      const b = wet(g);
      g.nz('white', 'lowpass', X(0, 0.4, 3600, 600), 1, P(0, 0.005, 0.42, 1), b);
      gurgle(g, 0.02, 0.5, 9, 0.9);
      g.ticks({ n: 9, from: 0.1, to: 0.55, f: [1500, 3600], q: 3, len: [0.004, 0.012], g: 0.5, bias: 1.3, dest: b });
    }),
    // ---- Bubble Prison
    'cs.bubble': tell(0.32, (g) => {
      const b = wet(g);
      g.tone('sine', X(0, 0.3, 180, 520), R(0, 0.31, 0.3), b);
      gurgle(g, 0, 0.3, 9, 0.9, undefined, [300, 1000]);
      rush(g, 0, 0.3, 400, 900, 0.5, b, 0.9);
    }),
    'cr.bubble': rel(0.5, (g) => {
      const b = wet(g);
      // "bloop"
      g.tone('sine', [[0, 160], [0.12, 520, 'e'], [0.3, 300, 'e']], P(0, 0.01, 0.4, 0.6), b);
      g.tone('sine', [[0, 320], [0.12, 1040, 'e'], [0.3, 600, 'e']], P(0, 0.01, 0.25, 0.15), b);
      rush(g, 0, 0.3, 800, 400, 0.5, b, 0.2);
      gurgle(g, 0.05, 0.45, 5, 0.5);
    }),
    'ent.bubble.loop': loop((g) => {
      // a wobbling skin of water: soft, pitched, a little comical
      const b = wet(g, 3000);
      const w = g.osc('sine', 290);
      g.lfo(3, 46).connect(w.frequency);
      g.pipe(b, w, g.gain(0.22), g.trem(6, 0.5));
      const w2 = g.osc('sine', 437);
      g.lfo(2, 60).connect(w2.frequency);
      g.pipe(b, w2, g.gain(0.1), g.trem(4.5, 0.6));
      g.nz('pink', 'lowpass', 700, 3, 0.4, b);
      g.blips(12, 0.5, 2.44, [500, 1400], 1.4, [0.02, 0.05], 0.1, b);
    }, { range: 40, ref: 4, lvl: LV.loop * 0.8 }),
    'ent.bubble.catch': rel(0.7, (g) => {
      const b = wet(g);
      // swallowed: a downward gulp, then the muffled wobble of being inside
      g.tone('sine', X(0, 0.2, 620, 150), P(0, 0.006, 0.26, 0.6), b);
      rush(g, 0, 0.35, 2000, 400, 0.8, b, 0.15, 4);
      g.tone('sine', [[0.2, 220], [0.4, 300], [0.65, 200]], [[0.2, 0], [0.3, 0.3], [0.68, 0]], b);
      gurgle(g, 0.1, 0.65, 10, 0.7);
    }, { pri: 3 }),
    'ent.bubble.pop': small(0.4, (g) => {
      const b = wet(g, 5200);
      g.click(0, 1800, 1, b, 0.012, 2);
      g.tone('sine', X(0, 0.05, 900, 300), P(0, 0.001, 0.06, 0.5), b);
      splash(g, 0.005, 0.32, 0.6, b);
    }),
    // ---- Tidal Wave
    'cs.tidalwave': tell(0.47, (g) => {
      // water drawing back and heaping up
      const b = wet(g, 3600);
      rush(g, 0, 0.46, 220, 1000, 1, b, 0.92, 2);
      rumble(g, 0, 0.46, 130, 0.5, undefined, 0.9);
      g.tone('sine', X(0, 0.45, 60, 110), R(0, 0.46, 0.3));
      gurgle(g, 0.05, 0.42, 8, 0.6, undefined, [200, 600]);
    }),
    'cr.tidalwave': rel(0.7, (g) => {
      const b = wet(g);
      rush(g, 0, 0.6, 1400, 500, 1, b, 0.15, 2);
      splash(g, 0, 0.5, 0.7, b);
      g.thump(0, 100, 46, 0.3, 0.5);
    }),
    'ent.tidalwave.loop': loop((g) => {
      // a wall of water on the move: low roar, churning foam
      const b = wet(g, 4600);
      const t = g.trem(3, 0.35), t2 = g.trem(9, 0.3);
      t.connect(b); t2.connect(b);
      g.nz('brown', 'lowpass', 240, 0.8, 0.5, t);
      g.nz('pink', 'lowpass', 1100, 1.6, 1, t);
      g.band('white', 1500, 4600, 0.4, t2);
      g.ticks({ n: 40, from: 0.5, to: 2.45, f: [1600, 4200], q: 2, len: [0.005, 0.02], g: 0.4, dest: b });
      g.blips(18, 0.5, 2.44, [220, 800], 1.5, [0.03, 0.07], 0.1, b);
    }, { range: 85, ref: 8, pri: 3, lvl: LV.loop * 1.4 }),
    'ent.tidalwave.crash': big(1.6, (g) => {
      const b = wet(g, 5200);
      g.thump(0, 95, 36, 0.5, 0.8);
      g.nz('brown', 'lowpass', 260, 0.7, P(0, 0.006, 0.6, 0.7));
      splash(g, 0, 1.2, 1.1, b);
      rush(g, 0, 1.4, 2400, 300, 0.9, b, 0.08, 1.5);
      gurgle(g, 0.2, 1.5, 16, 0.5);
    }, { lvl: LV.big, ref: 10, range: 150 }),
    'ent.tidalwave.spawn': rel(0.6, (g) => {
      const b = wet(g);
      rush(g, 0, 0.55, 300, 1500, 1, b, 0.6, 2);
      splash(g, 0.1, 0.45, 0.6, b);
    }),
    // ---- Riptide Surge
    'cs.riptide': tell(0.1, (g) => {
      const b = wet(g);
      g.nz('white', 'lowpass', X(0, 0.09, 800, 3000), 3, P(0, 0.01, 0.085, 1), b);
    }, { lvl: LV.small }),
    'cr.riptide': rel(0.85, (g) => {
      const b = wet(g, 5000);
      rush(g, 0, 0.6, 500, 1900, 1.1, b, 0.35, 3);
      splash(g, 0, 0.3, 0.6, b);
      splash(g, 0.5, 0.33, 0.7, b);
      gurgle(g, 0.05, 0.8, 12, 0.5);
    }),
    // ---- hit layers
    'hit.tide.l': hitLight(0.36, (g) => {
      const b = wet(g, 5200);
      g.click(0, 1500, 0.9, b, 0.015, 1.5);
      splash(g, 0, 0.3, 1, b);
      g.tone('sine', X(0, 0.08, 500, 200), P(0, 0.002, 0.1, 0.3), b);
    }),
    'hit.tide.h': hitHeavy(0.85, (g) => {
      const b = wet(g, 5200);
      g.thump(0, 120, 44, 0.3, 0.7);
      splash(g, 0, 0.7, 1.1, b);
      rush(g, 0, 0.6, 2200, 400, 0.6, b, 0.08, 2);
      gurgle(g, 0.1, 0.8, 8, 0.5);
    }),
    'hit.tide.t': hitTick(0.16, (g) => {
      const b = wet(g);
      g.blips(3, 0, 0.1, [500, 1300], 1.5, [0.02, 0.04], 0.5, b);
      g.nz('white', 'lowpass', 3000, 1, P(0, 0.003, 0.08, 0.5), b);
    }),
  };
  // water is round: a resonant belly around 350 Hz and a soft ceiling on everything
  for (const d of Object.values(defs)) {
    const build = d.build!;
    d.build = (g) => {
      const top = g.lp(3400, 0.7), belly = g.bq('peaking', 350, 0.9, 5);
      top.connect(belly); belly.connect(g.out);
      g.out = top;
      build(g);
    };
  }
  return defs;
}
