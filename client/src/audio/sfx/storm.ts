// STORM — zaps, buzz, sharp thunder cracks. Harsh, broadband, instant.

import { G, P, S, R, H, X } from '../kit';
import type { DefMap } from '../bank';
import { tell, rel, big, small, loop, hitLight, hitHeavy, hitTick, boom, rumble, LV } from './common';

/** Electric path: folded, high-passed, edgy. */
const arc = (g: G, fold = 1.6, lo = 600): GainNode => g.bus(undefined, g.shaper(fold, 'fold'), g.hp(lo));

/** Jittering discharge. */
function zap(g: G, from: number, to: number, gain: number, dest: AudioNode, f: [number, number] = [260, 3400], rate = 170): void {
  const d = to - from;
  g.sh('sawtooth', from, to, rate, f, H(from, 0.002, d * 0.55, d * 0.45 - 0.002, gain * 0.5), dest);
  g.sh('square', from, to, rate * 0.63, [f[0] * 1.5, f[1] * 1.3], H(from, 0.002, d * 0.4, d * 0.6 - 0.002, gain * 0.25), dest);
  // the thrum of current under the crackle (straight to the output: the arc path is high-passed)
  g.pipe(g.out, g.osc('sawtooth', 110, { at: from, end: to }), g.lp(420), g.gain(H(from, 0.004, d * 0.5, d * 0.5 - 0.004, gain * 0.34)));
  g.pipe(g.out, g.osc('square', 55.5, { at: from, end: to }), g.lp(300), g.gain(H(from, 0.004, d * 0.5, d * 0.5 - 0.004, gain * 0.2)));
}

/** Loose sparks. */
const sparks = (g: G, from: number, to: number, n: number, gain: number, bias = 1): void => {
  g.ticks({ n, from, to, f: [3000, 9000], q: 1.5, len: [0.0015, 0.007], g: gain, bias, groups: 3, type: 'highpass' });
};

/** The crack of a thunderbolt: a hard broadband snap. */
function thunderCrack(g: G, at: number, gain: number): void {
  g.nz('white', 'highpass', 1400, 0.7, P(at, 0.0008, 0.09, gain));
  g.nz('white', 'bandpass', X(at, 0.2, 2600, 500), 0.8, P(at, 0.001, 0.22, gain * 0.8));
  g.click(at, 5200, gain, undefined, 0.006, 1);
}

/** Mains-like hum with a rasp. */
function buzz(g: G, at: number, dur: number, f: number, gain: number, dest: AudioNode): void {
  g.tone('sawtooth', f, H(at, 0.01, dur - 0.04, 0.03, gain * 0.4), dest);
  g.tone('square', f * 2.01, H(at, 0.01, dur - 0.04, 0.03, gain * 0.16), dest);
}

export function stormDefs(): DefMap {
  return {
    // ---- Static Jab
    'cs.storm_melee': tell(0.2, (g) => {
      const b = arc(g);
      g.sh('sawtooth', 0, 0.19, 240, [500, 2600], R(0, 0.195, 0.4), b);
      sparks(g, 0, 0.18, 9, 0.7, 0.6);
    }),
    'cr.storm_melee': rel(0.3, (g) => {
      const b = arc(g, 1.8);
      zap(g, 0, 0.16, 1, b, [400, 4200], 260);
      g.nz('white', 'bandpass', X(0, 0.14, 3800, 1500), 1.6, P(0, 0.002, 0.16, 0.9));
      g.click(0, 6000, 0.9, undefined, 0.005);
      sparks(g, 0.02, 0.28, 8, 0.5, 1.6);
    }),
    // ---- Arc Bolt
    'cs.arcbolt': tell(0.13, (g) => {
      const b = arc(g);
      g.sh('square', 0, 0.12, 300, [900, 3600], R(0, 0.125, 0.35), b);
      g.tone('sine', X(0, 0.12, 1800, 5200), R(0, 0.125, 0.12));
    }),
    'cr.arcbolt': rel(0.26, (g) => {
      g.click(0, 4500, 1, undefined, 0.008);
      g.nz('white', 'highpass', 2600, 0.7, P(0, 0.001, 0.1, 0.8));
      sparks(g, 0.01, 0.24, 8, 0.5, 1.6);
    }, { lvl: LV.small * 1.2 }),
    'fx.arcbolt': rel(0.5, (g) => {
      const b = arc(g, 2);
      thunderCrack(g, 0, 1);
      zap(g, 0, 0.3, 1, b, [220, 5200], 300);
      g.thump(0, 190, 70, 0.1, 0.3);
      sparks(g, 0.05, 0.46, 14, 0.5, 1.5);
    }, { lvl: LV.hitHeavy * 0.95, ref: 8, range: 110, pri: 3, vary: 1.2 }),
    'fx.arcbolt.end': small(0.32, (g) => {
      const b = arc(g, 1.5, 1200);
      zap(g, 0, 0.14, 0.8, b, [900, 5000], 320);
      sparks(g, 0, 0.3, 14, 0.8, 1.6);
    }, { vary: 2 }),
    // ---- Ball Lightning
    'cs.balllightning': tell(0.26, (g) => {
      const b = arc(g, 1.3, 300);
      buzz(g, 0, 0.25, 98, 0.9, b);
      g.tone('sawtooth', X(0, 0.24, 196, 392), R(0, 0.25, 0.25), b);
      sparks(g, 0.03, 0.24, 10, 0.5, 0.5);
    }),
    'cr.balllightning': rel(0.55, (g) => {
      const b = arc(g, 1.5, 250);
      buzz(g, 0, 0.5, 110, 0.9, b);
      g.tone('sine', X(0, 0.3, 300, 110), P(0, 0.004, 0.4, 0.5));
      zap(g, 0, 0.2, 0.7, b);
      sparks(g, 0.02, 0.5, 12, 0.5, 1.4);
    }),
    'ent.balllightning.loop': loop((g) => {
      // a hum you can locate, with restless crackle riding on it
      const b = arc(g, 1.25, 180);
      const t = g.trem(6, 0.4), t2 = g.trem(13.5, 0.5, 'sawtooth');
      t.connect(b); t2.connect(b);
      g.tone('sawtooth', 110, 0.34, t);
      g.tone('square', 220.5, 0.1, t);
      g.tone('sawtooth', 331, 0.1, t2);
      g.nz('white', 'bandpass', 3600, 2, 0.5, t2);
      g.sh('square', 0, 2.5, 46, [1200, 4200], 0.045, b);
      sparks(g, 0.5, 2.46, 30, 0.55);
    }, { range: 60, ref: 5, pri: 3, lvl: LV.loop * 1.1 }),
    'ent.balllightning.detonate': big(0.95, (g) => {
      const b = arc(g, 2);
      thunderCrack(g, 0, 1);
      boom(g, 0, 120, 42, 0.4, 0.8);
      zap(g, 0, 0.42, 0.9, b, [200, 4600], 240);
      sparks(g, 0.05, 0.9, 26, 0.6, 1.6);
    }, { lvl: LV.hitHeavy, ref: 8, range: 120 }),
    'ent.balllightning.overload': big(2.2, (g) => {
      // far bigger: a double crack, a deep roll, arcs raining down
      const b = arc(g, 2.4);
      thunderCrack(g, 0, 1);
      thunderCrack(g, 0.07, 0.8);
      boom(g, 0, 100, 28, 1.0, 1.1);
      rumble(g, 0.05, 2.1, 140, 0.6, undefined, 0.12);
      zap(g, 0, 0.7, 1, b, [160, 5600], 220);
      zap(g, 0.25, 0.9, 0.5, b, [500, 3000], 120);
      sparks(g, 0.05, 1.9, 50, 0.7, 1.7);
    }, { lvl: LV.huge, ref: 10, range: 220, pri: 5 }),
    'ent.balllightning.fizz': small(0.5, (g) => {
      const b = arc(g, 1.3, 400);
      g.tone('sawtooth', X(0, 0.4, 110, 55), P(0, 0.01, 0.4, 0.5), b);
      sparks(g, 0, 0.45, 16, 0.8, 1.8);
    }),
    // ---- Thunderstrike
    'cs.thunderstrike': tell(0.32, (g) => {
      const b = arc(g, 1.5, 500);
      g.sh('sawtooth', 0, 0.3, 140, [300, 1800], R(0, 0.31, 0.4), b);
      g.tone('sine', X(0, 0.3, 700, 2800), R(0, 0.31, 0.14));
      sparks(g, 0.04, 0.3, 14, 0.6, 0.5);
    }),
    'cr.thunderstrike': rel(0.5, (g) => {
      const b = arc(g, 1.4, 500);
      g.nz('white', 'bandpass', X(0, 0.4, 900, 5200), 2, S(0, 0.45, 1, 0.3));
      zap(g, 0, 0.22, 0.6, b, [500, 4000], 200);
      g.thump(0, 160, 70, 0.15, 0.35);
    }),
    'ent.thunderstrike.charge': tell(0.75, (g) => {
      // the air sizzles and tightens over the mark until the bolt lands
      const b = arc(g, 1.4, 900);
      g.sh('sawtooth', 0, 0.74, 200, [700, 3800], R(0, 0.75, 0.3, 0.015), b);
      g.nz('white', 'bandpass', X(0, 0.74, 2000, 7000), 3, R(0, 0.75, 1, 0.015));
      g.tone('sine', X(0, 0.74, 900, 3600), R(0, 0.75, 0.1, 0.015));
      g.ticks({ n: 36, from: 0.05, to: 0.74, f: [3500, 9000], q: 2, len: [0.002, 0.006], g: 0.6, bias: 0.45, type: 'highpass' });
    }, { lvl: LV.rel * 0.9, ref: 9, range: 100, pri: 4, vary: 0 }),
    'ent.thunderstrike.bolt': big(2.0, (g) => {
      const b = arc(g, 2.2);
      thunderCrack(g, 0, 1.1);
      g.nz('white', 'highpass', 900, 0.7, P(0.012, 0.001, 0.05, 0.6));
      boom(g, 0, 105, 30, 0.8, 1);
      zap(g, 0, 0.36, 0.9, b, [200, 6000], 320);
      rumble(g, 0.04, 1.9, 150, 0.55, undefined, 0.1);
      g.nz('pink', 'bandpass', X(0.05, 1.5, 700, 180), 0.7, P(0.05, 0.02, 1.5, 0.5));
      sparks(g, 0.06, 1.2, 24, 0.5, 1.8);
    }, { lvl: LV.huge, ref: 10, range: 220, pri: 5 }),
    // ---- Thunderstep
    'cs.thunderstep': tell(0.07, (g) => {
      const b = arc(g, 1.4, 1200);
      g.sh('square', 0, 0.06, 500, [1500, 5000], P(0, 0.002, 0.06, 0.5), b);
    }, { lvl: LV.small }),
    'cr.thunderstep': rel(0.22, (g) => {
      g.nz('white', 'bandpass', X(0, 0.18, 1200, 6000), 1.4, P(0, 0.004, 0.18, 1));
      sparks(g, 0, 0.2, 8, 0.6, 1.5);
    }, { lvl: LV.small * 1.2 }),
    'fx.staticburst': rel(0.6, (g) => {
      const b = arc(g, 1.8, 700);
      zap(g, 0, 0.3, 1, b, [300, 4400], 210);
      g.nz('white', 'bandpass', X(0, 0.35, 5000, 1400), 1.2, P(0, 0.002, 0.35, 0.9));
      g.thump(0, 150, 60, 0.14, 0.3);
      sparks(g, 0.03, 0.55, 28, 0.7, 1.4);
    }, { lvl: LV.hit, pri: 3 }),
    'tp.thunderstep.out': rel(0.4, (g) => {
      // air collapsing into the place where someone was
      g.nz('white', 'bandpass', X(0, 0.2, 5000, 700), 1.5, P(0, 0.002, 0.24, 1));
      g.tone('sine', X(0, 0.15, 900, 120), P(0, 0.002, 0.16, 0.3));
      sparks(g, 0.02, 0.36, 12, 0.6, 1.6);
    }),
    'tp.thunderstep.in': big(1.1, (g) => {
      const b = arc(g, 2);
      thunderCrack(g, 0, 1);
      boom(g, 0, 130, 46, 0.4, 0.8);
      zap(g, 0, 0.2, 0.7, b, [300, 5000], 300);
      rumble(g, 0.03, 1.0, 160, 0.4, undefined, 0.1);
      sparks(g, 0.04, 0.6, 12, 0.5, 1.6);
    }, { lvl: LV.hitHeavy, ref: 8, range: 120, pri: 4 }),
    // ---- hit layers
    'hit.storm.l': hitLight(0.3, (g) => {
      const b = arc(g, 1.8, 800);
      zap(g, 0, 0.14, 1, b, [500, 4800], 300);
      g.click(0, 5500, 0.9, undefined, 0.006);
      g.nz('white', 'highpass', 2800, 0.7, P(0, 0.001, 0.07, 0.7));
      sparks(g, 0.02, 0.28, 10, 0.5, 1.6);
    }),
    'hit.storm.h': hitHeavy(0.8, (g) => {
      const b = arc(g, 2.2);
      thunderCrack(g, 0, 1);
      boom(g, 0, 125, 44, 0.35, 0.7);
      zap(g, 0, 0.32, 0.9, b, [240, 5200], 260);
      sparks(g, 0.04, 0.75, 22, 0.6, 1.7);
    }),
    'hit.storm.t': hitTick(0.14, (g) => {
      const b = arc(g, 1.5, 1500);
      g.sh('square', 0, 0.08, 420, [1500, 5200], P(0, 0.001, 0.08, 0.4), b);
      sparks(g, 0, 0.12, 6, 0.9);
    }),
  };
}
