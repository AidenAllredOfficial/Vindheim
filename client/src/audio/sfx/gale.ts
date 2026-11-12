// GALE — airy whooshes and whistles. Band-passed air that is always moving; no impact weight.

import { G, P, S, R, X } from '../kit';
import type { DefMap } from '../bank';
import { tell, rel, small, loop, hitLight, hitHeavy, hitTick, whoosh, LV } from './common';

/** A singing whistle: very narrow noise plus a breath of pure tone. */
function whistle(g: G, at: number, dur: number, f0: number, f1: number, gain: number, pos = 0.5): void {
  g.nz('white', 'bandpass', X(at, dur, f0, f1), 18, S(at, dur, gain * 3.2, pos));
  g.tone('sine', X(at, dur, f0, f1), S(at, dur, gain * 0.06, pos));
}

/** Soft broadband air. */
const air = (g: G, at: number, dur: number, gain: number, pos = 0.4, lo = 900, hi = 5200): void => { g.band('white', lo, hi, S(at, dur, gain, pos)); };

export function galeDefs(): DefMap {
  const defs: DefMap = {
    // ---- Tempest Kick
    'cs.gale_melee': tell(0.24, (g) => {
      g.nz('white', 'bandpass', X(0, 0.22, 3800, 900), 2, R(0, 0.23, 1));
      whistle(g, 0, 0.22, 1300, 2500, 0.3, 0.85);
    }),
    'cr.gale_melee': rel(0.46, (g) => {
      whoosh(g, 0, 0.26, [700, 4600, 1200], 1.3, 1.6, undefined, 0.4);
      whoosh(g, 0.03, 0.4, [400, 1500, 500], 0.7, 1, undefined, 0.3);
      whistle(g, 0.02, 0.24, 2800, 1500, 0.35, 0.3);
    }),
    // ---- Gust Blade
    'cs.gustblade': tell(0.17, (g) => {
      g.nz('white', 'bandpass', X(0, 0.16, 1200, 4200), 3, R(0, 0.165, 1));
      whistle(g, 0, 0.16, 1700, 3000, 0.3, 0.9);
    }),
    'cr.gustblade': rel(0.42, (g) => {
      whoosh(g, 0, 0.2, [1500, 6000, 2200], 1.3, 2.4, undefined, 0.25);
      whistle(g, 0, 0.36, 3300, 1700, 0.45, 0.15);
      air(g, 0, 0.38, 0.4, 0.15);
    }),
    'ent.gustblade.loop': loop((g) => {
      // a crescent of air cutting past: fluttering, whistling
      const t = g.trem(19, 0.7), t2 = g.trem(8.5, 0.4);
      t.connect(g.out); t2.connect(g.out);
      g.nz('white', 'bandpass', 2600, 2.2, 1, t);
      g.nz('white', 'bandpass', 3300, 16, 2.4, t2);
      g.nz('white', 'bandpass', 1100, 1.2, 0.4, t2);
    }, { range: 55, ref: 4 }),
    'ent.gustblade.end': small(0.36, (g) => {
      whoosh(g, 0, 0.34, [3000, 1400, 600], 1, 1.4, undefined, 0.15);
      air(g, 0, 0.3, 0.4, 0.1);
    }),
    // ---- Cyclone
    'cs.cyclone': tell(0.36, (g) => {
      whoosh(g, 0, 0.35, [350, 1800, 2400], 1, 1.4, undefined, 0.9);
      whistle(g, 0, 0.35, 700, 1900, 0.4, 0.9);
      g.nz('pink', 'bandpass', X(0, 0.34, 180, 500), 1, R(0, 0.35, 0.8));
    }),
    'cr.cyclone': rel(0.8, (g) => {
      whoosh(g, 0, 0.75, [500, 2400, 900], 1.2, 1.2, undefined, 0.25);
      whistle(g, 0, 0.7, 1500, 2300, 0.4, 0.3);
      g.nz('pink', 'bandpass', [[0, 300], [0.3, 700], [0.75, 350]], 1, S(0, 0.78, 0.8, 0.25));
    }),
    'ent.cyclone.loop': loop((g) => {
      // a funnel turning: the roar comes round twice a second while a howl rides the top
      const turn = g.trem(2, 0.55), wob = g.trem(3.5, 0.5);
      turn.connect(g.out); wob.connect(g.out);
      g.nz('pink', 'bandpass', 420, 0.8, 1, turn);
      g.nz('brown', 'lowpass', 190, 0.7, 0.3, turn);
      const bp = g.bp(1500, 9);
      g.lfo(2, 320).connect(bp.frequency);
      g.pipe(wob, g.noise('white'), bp, g.gain(1.8));
      const hi = g.bp(2900, 3);
      g.lfo(1.5, 700).connect(hi.frequency);
      g.pipe(turn, g.noise('white'), hi, g.gain(0.35));
    }, { range: 75, ref: 7, pri: 3, lvl: LV.loop * 1.25 }),
    'ent.cyclone.end': rel(1.0, (g) => {
      whoosh(g, 0, 0.95, [1600, 700, 250], 1.1, 1.1, undefined, 0.12);
      whistle(g, 0, 0.8, 2100, 600, 0.35, 0.1);
      air(g, 0, 0.9, 0.4, 0.1, 500, 3000);
    }),
    // ---- Jetstream
    'cs.jetstream': tell(0.22, (g) => {
      g.nz('white', 'bandpass', X(0, 0.2, 5000, 1500), 1.5, R(0, 0.21, 1));
      g.nz('pink', 'bandpass', X(0, 0.2, 900, 300), 1, R(0, 0.21, 0.7));
      whistle(g, 0, 0.2, 2600, 1300, 0.25, 0.9);
    }),
    'cr.jetstream': rel(0.5, (g) => {
      whoosh(g, 0, 0.45, [500, 3200, 1600], 1.3, 1.1, undefined, 0.2);
      air(g, 0, 0.48, 0.6, 0.15);
    }),
    'ent.jetstream.loop': loop((g) => {
      // a howling river of wind held in one direction
      const t = g.trem(11, 0.3), t2 = g.trem(4, 0.35);
      t.connect(g.out); t2.connect(g.out);
      g.band('white', 600, 4200, 0.8, t);
      const bp = g.bp(1250, 11);
      g.lfo(1.5, 180).connect(bp.frequency);
      g.pipe(t2, g.noise('white'), bp, g.gain(2));
      const bp2 = g.bp(2500, 14);
      g.lfo(2.5, 300).connect(bp2.frequency);
      g.pipe(t2, g.noise('white'), bp2, g.gain(1.1));
      g.nz('pink', 'bandpass', 380, 0.9, 0.5, t);
    }, { range: 70, ref: 7, pri: 3, lvl: LV.loop * 1.3 }),
    'ent.jetstream.end': rel(0.75, (g) => {
      // the final blast that throws them clear
      whoosh(g, 0, 0.5, [900, 5200, 800], 1.4, 1.3, undefined, 0.18);
      g.thump(0, 130, 60, 0.16, 0.3);
      whistle(g, 0, 0.6, 3000, 900, 0.4, 0.1);
      air(g, 0.05, 0.68, 0.5, 0.2);
    }, { lvl: LV.hit }),
    // ---- Zephyr Soar
    'cs.zephyrsoar': tell(0.1, (g) => {
      g.nz('white', 'bandpass', X(0, 0.09, 900, 3200), 2, P(0, 0.01, 0.085, 1));
    }, { lvl: LV.small }),
    'cr.zephyrsoar': rel(2.4, (g) => {
      // an updraft that lifts, then thins into the gliding hush under a cloak
      whoosh(g, 0, 0.7, [400, 3400, 1800], 1.3, 1.2, undefined, 0.25);
      whistle(g, 0, 0.9, 900, 2600, 0.4, 0.4);
      g.band('white', 1200, 4800, [[0, 0], [0.4, 0.5], [1.4, 0.3], [2.35, 0]]);
      const flut = g.trem(7, 0.5);
      flut.connect(g.out);
      g.nz('pink', 'bandpass', 700, 1, [[0.4, 0], [0.9, 0.5], [1.8, 0.35], [2.35, 0]], flut);
    }, { vary: 0.3 }),
    // ---- hit layers (a buffet of air more than a blow)
    'hit.gale.l': hitLight(0.36, (g) => {
      whoosh(g, 0, 0.3, [3600, 1600, 700], 1.2, 1.3, undefined, 0.08);
      g.nz('white', 'bandpass', 2200, 0.8, P(0, 0.002, 0.07, 0.9));
      whistle(g, 0, 0.26, 2400, 1300, 0.3, 0.1);
    }),
    'hit.gale.h': hitHeavy(0.8, (g) => {
      g.nz('white', 'bandpass', 1800, 0.7, P(0, 0.002, 0.1, 1));
      whoosh(g, 0, 0.7, [4200, 1400, 400], 1.3, 1.1, undefined, 0.08);
      g.thump(0, 150, 60, 0.18, 0.4);
      whistle(g, 0.02, 0.6, 3200, 800, 0.4, 0.1);
      air(g, 0, 0.75, 0.5, 0.1, 500, 3600);
    }),
    'hit.gale.t': hitTick(0.16, (g) => {
      g.nz('white', 'bandpass', X(0, 0.14, 3000, 1400), 2, P(0, 0.005, 0.13, 1));
    }),
  };
  // wind has no edge: every gale sound is rounded off above ~4.5 kHz and given a little chest
  for (const d of Object.values(defs)) {
    const build = d.build!;
    d.build = (g) => {
      const top = g.lp(4400, 0.6), body = g.bq('peaking', 700, 0.8, 4);
      top.connect(body); body.connect(g.out);
      g.out = top;
      build(g);
    };
  }
  return defs;
}
