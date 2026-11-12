// DAWN — bright shimmering tones, bells, a searing beam. Pure, harmonic, high; light made audible.

import { G, P, S, R, H, X, type Env } from '../kit';
import type { DefMap } from '../bank';
import { tell, rel, big, small, loop, hitLight, hitHeavy, hitTick, LV } from './common';

const BELL: [number, number, number][] = [[1, 1, 1], [2, 0.5, 0.75], [3.01, 0.3, 0.55], [4.2, 0.18, 0.4], [5.43, 0.1, 0.28]];
const bell = (g: G, at: number, f: number, gain: number, decay = 1, dest?: AudioNode): void => g.modal(at, BELL, gain * 0.2, dest, { mul: f, decay });

/** A pure harmonic ray: a stack of sines sharing one envelope. */
function ray(g: G, f: number | [number, number], e: Env, gain: number, at = 0, dur = 0.3, dest?: AudioNode): void {
  const amps = [1, 0.5, 0.33, 0.22, 0.12];
  const mix = g.gain(e);
  mix.connect(dest ?? g.out);
  amps.forEach((a, i) => {
    const h = i + 1;
    const fr = typeof f === 'number' ? f * h : X(at, dur, f[0] * h, f[1] * h);
    g.pipe(mix, g.osc('sine', fr), g.gain(a * gain * 0.3));
  });
}

/** Shimmer: a bright chord whose members flicker at different rates. */
function shimmer(g: G, at: number, dur: number, base: number, gain: number, pos = 0.3, dest?: AudioNode): void {
  const ratios = [1, 1.5, 2, 3, 4], rates = [9, 11, 13, 7, 15];
  ratios.forEach((r, i) => {
    const t = g.trem(rates[i], 0.85);
    t.connect(dest ?? g.out);
    g.tone('sine', base * r, S(at, dur, gain * 0.16 / (1 + i * 0.35), pos), t);
  });
}

/** Sparkle: tiny high pings. */
const sparkle = (g: G, from: number, to: number, n: number, gain: number, bias = 1): void => g.blips(n, from, to, [3000, 7000], 1.02, [0.02, 0.06], gain * 0.2, undefined, bias);

/** The searing core of a beam. */
function sear(g: G, at: number, dur: number, gain: number, f = 880, dest?: AudioNode): void {
  const b = g.bus(dest, g.hp(1100), g.shaper(2.2), g.lp(7600));
  const e = H(at, 0.01, dur * 0.55, dur * 0.45 - 0.01, gain * 0.3);
  g.tone('sawtooth', f, e, b);
  g.tone('sawtooth', f * 1.498, e, b, 7);
  g.tone('sawtooth', f * 2.003, e, b, -6);
  g.band('white', 4200, 9000, H(at, 0.005, dur * 0.5, dur * 0.5 - 0.005, gain * 0.5), dest);
}

export function dawnDefs(): DefMap {
  return {
    // ---- Sun Lance (thrust)
    'cs.dawn_melee': tell(0.32, (g) => {
      ray(g, [660, 1320], R(0, 0.31, 1), 1, 0, 0.3);
      shimmer(g, 0, 0.3, 1320, 0.6, 0.9);
    }),
    'cr.dawn_melee': rel(0.45, (g) => {
      g.nz('white', 'bandpass', X(0, 0.14, 2600, 7000), 2, P(0, 0.004, 0.16, 1));
      bell(g, 0, 1760, 0.9, 0.35);
      ray(g, 1320, P(0, 0.003, 0.3, 1), 0.7);
      sparkle(g, 0.03, 0.4, 6, 0.6, 1.5);
    }),
    // ---- Glint
    'cs.glint': tell(0.15, (g) => {
      ray(g, [1760, 2640], R(0, 0.145, 1), 1, 0, 0.14);
    }),
    'cr.glint': rel(0.32, (g) => {
      bell(g, 0, 2637, 1, 0.28);
      g.nz('white', 'highpass', 5000, 0.7, P(0, 0.001, 0.05, 0.6));
      g.tone('sine', X(0, 0.2, 5274, 2637), P(0, 0.002, 0.2, 0.12));
    }),
    'ent.glint.spawn': small(0.2, (g) => {
      g.tone('sine', X(0, 0.16, 6000, 3000), P(0, 0.002, 0.16, 0.3));
      g.nz('white', 'bandpass', X(0, 0.14, 7000, 4000), 4, P(0, 0.002, 0.15, 0.8));
    }, { lvl: LV.tick, vary: 1.5 }),
    'ent.glint.hit': small(0.3, (g) => {
      bell(g, 0, 3520, 0.9, 0.2);
      g.click(0, 6000, 0.8, undefined, 0.006);
      sparkle(g, 0.01, 0.26, 6, 0.8, 1.6);
    }, { vary: 2 }),
    // ---- Solar Flare
    'cs.solarflare': tell(0.3, (g) => {
      ray(g, [392, 784], R(0, 0.29, 1), 1, 0, 0.28);
      shimmer(g, 0, 0.29, 1568, 0.7, 0.92);
      g.nz('white', 'highpass', 5200, 0.7, R(0, 0.29, 0.3));
    }),
    'cr.solarflare': rel(0.4, (g) => {
      bell(g, 0, 1175, 1, 0.35);
      g.nz('white', 'bandpass', X(0, 0.2, 6500, 2000), 1.4, P(0, 0.002, 0.22, 0.8));
    }),
    'fx.solarflare': big(1.4, (g) => {
      // a ring of light bursting outward: bell-bright attack, a rush, a glittering fall-off
      bell(g, 0, 587, 1, 1.2);
      bell(g, 0, 880, 0.8, 1.0);
      bell(g, 0.01, 1175, 0.7, 0.9);
      sear(g, 0, 0.5, 1, 587);
      g.nz('white', 'bandpass', X(0, 0.6, 8000, 1500), 1.1, P(0, 0.003, 0.6, 1));
      g.thump(0, 180, 70, 0.2, 0.4);
      shimmer(g, 0.05, 1.3, 1760, 0.8, 0.1);
      sparkle(g, 0.1, 1.3, 22, 0.7, 1.4);
    }, { lvl: LV.big, ref: 9, range: 130 }),
    // ---- Sunlance
    'cs.sunlance': tell(0.5, (g) => {
      // the first breath of the charge: everyone on the island should know what is coming
      bell(g, 0, 880, 1, 0.5);
      bell(g, 0.09, 1320, 0.8, 0.45);
      bell(g, 0.18, 1760, 0.7, 0.4);
      ray(g, 440, S(0, 0.48, 0.6, 0.3), 1);
    }, { ref: 12, range: 140, pri: 4 }),
    'ent.sunlance.loop': loop((g) => {
      // the gathering light: the engine bends its pitch and level upward over the charge
      const b = g.bus(undefined, g.lp(6800));
      const amps = [1, 0.6, 0.42, 0.3, 0.2, 0.12];
      amps.forEach((a, i) => {
        const t = g.trem([12, 9, 15, 7, 11, 13][i], 0.5);
        t.connect(b);
        g.tone('sine', 440 * (i + 1), a * 0.2, t);
        g.tone('sine', 440 * (i + 1) + 1.5, a * 0.1, t);
      });
      g.tone('sawtooth', 220, 0.05, b);
      g.band('white', 5000, 9000, 0.2, b);
    }, { range: 150, ref: 12, pri: 4, lvl: LV.loop * 1.3 }),
    'cr.sunlance': rel(0.5, (g) => {
      g.click(0, 5000, 1, undefined, 0.01);
      bell(g, 0, 440, 1, 0.5);
      g.thump(0, 150, 50, 0.3, 0.6);
    }, { lvl: LV.hit }),
    'fx.sunlance': big(1.8, (g) => {
      // the colossal beam: a crack of light, a searing column held for 0.4 s, a long golden ring-out
      g.nz('white', 'highpass', 2000, 0.7, P(0, 0.001, 0.07, 1));
      g.thump(0, 160, 38, 0.6, 0.9);
      g.nz('brown', 'lowpass', 300, 0.7, P(0, 0.005, 0.7, 0.6));
      sear(g, 0, 0.62, 1.2, 440);
      sear(g, 0, 0.55, 0.7, 660);
      ray(g, 220, H(0, 0.005, 0.4, 0.5, 1), 1);
      bell(g, 0, 440, 1, 1.6);
      bell(g, 0.005, 660, 0.8, 1.4);
      bell(g, 0.01, 1320, 0.6, 1.2);
      shimmer(g, 0.3, 1.45, 1760, 0.8, 0.12);
      sparkle(g, 0.4, 1.7, 26, 0.6, 1.3);
    }, { lvl: LV.huge, ref: 12, range: 260, pri: 5, vary: 0.2 }),
    // ---- Lightray
    'cs.lightray': tell(0.08, (g) => {
      g.tone('sine', X(0, 0.07, 1800, 5400), P(0, 0.004, 0.07, 0.4));
    }, { lvl: LV.small }),
    'cr.lightray': rel(0.4, (g) => {
      ray(g, [880, 3520], P(0, 0.004, 0.2, 1), 1, 0, 0.16);
      g.nz('white', 'bandpass', X(0, 0.18, 2500, 8000), 2, P(0, 0.004, 0.2, 1));
      sparkle(g, 0.05, 0.36, 8, 0.6, 1.4);
    }),
    'fx.raydash': rel(0.5, (g) => {
      // the streak itself
      g.nz('white', 'bandpass', X(0, 0.16, 1800, 8500), 1.6, P(0, 0.003, 0.2, 1));
      ray(g, [660, 2640], P(0, 0.003, 0.24, 1), 0.9, 0, 0.16);
      sparkle(g, 0.04, 0.46, 12, 0.6, 1.3);
    }, { vary: 0.8 }),
    'fx.raydash.end': rel(0.75, (g) => {
      // the dazzling flare where it ends
      bell(g, 0, 1175, 1, 0.6);
      bell(g, 0.004, 1760, 0.8, 0.5);
      g.nz('white', 'bandpass', X(0, 0.3, 7500, 2400), 1.2, P(0, 0.002, 0.3, 0.9));
      g.thump(0, 170, 70, 0.14, 0.3);
      shimmer(g, 0.02, 0.7, 2349, 0.7, 0.1);
    }, { lvl: LV.hit, pri: 3 }),
    // ---- hit layers
    'hit.dawn.l': hitLight(0.36, (g) => {
      bell(g, 0, 1568, 1, 0.3);
      g.click(0, 5200, 0.8, undefined, 0.006);
      g.nz('white', 'bandpass', X(0, 0.12, 7000, 3000), 1.5, P(0, 0.002, 0.12, 0.7));
      sparkle(g, 0.02, 0.32, 5, 0.6, 1.6);
    }),
    'hit.dawn.h': hitHeavy(0.9, (g) => {
      bell(g, 0, 784, 1, 0.8);
      bell(g, 0.004, 1175, 0.8, 0.7);
      sear(g, 0, 0.3, 0.9, 784);
      g.thump(0, 170, 60, 0.22, 0.5);
      g.nz('white', 'bandpass', X(0, 0.3, 8000, 2200), 1.2, P(0, 0.002, 0.3, 0.8));
      sparkle(g, 0.05, 0.85, 14, 0.6, 1.5);
    }),
    'hit.dawn.t': hitTick(0.16, (g) => {
      g.tone('sine', 3136, P(0, 0.002, 0.12, 0.3));
      g.tone('sine', 4699, P(0, 0.002, 0.08, 0.15));
    }),
  };
}
