// EMBER — roar, crackle, whoosh. Low-mid distorted noise bodies with bright crackling on top.

import { G, P, S, R, X } from '../kit';
import type { DefMap } from '../bank';
import { tell, rel, big, small, loop, hitLight, hitHeavy, hitTick, whoosh, rumble, boom, LV } from './common';

/** Everything fiery runs through a little saturation. */
const fire = (g: G, drive = 2.4, top = 5200): GainNode => g.bus(undefined, g.shaper(drive), g.lp(top));

function roar(g: G, at: number, dur: number, f0: number, f1: number, gain: number, dest: AudioNode, pos = 0.25): void {
  g.nz('pink', 'bandpass', X(at, dur, f0, f1), 0.6, S(at, dur, gain, pos), dest);
  g.nz('brown', 'lowpass', 280, 0.7, S(at, dur, gain * 0.45, pos), dest);
}

function crackle(g: G, from: number, to: number, n: number, gain: number, dest?: AudioNode, bias = 1): void {
  g.ticks({ n, from, to, f: [2000, 8500], q: 2.5, len: [0.003, 0.016], g: gain * 1.25, bias, groups: 3, dest });
}

export function emberDefs(): DefMap {
  return {
    // ---- Brand Cleave
    'cs.ember_melee': tell(0.28, (g) => {
      // the axe comes back: iron ringing as the brand catches
      const b = fire(g);
      roar(g, 0.04, 0.23, 260, 760, 0.8, b, 0.85);
      g.modal(0, [[1, 1, 0.16], [2.41, 0.5, 0.12], [3.87, 0.3, 0.08]], 0.16, undefined, { mul: 930 });
      g.click(0, 3600, 0.5, undefined, 0.006);
      crackle(g, 0.05, 0.26, 8, 0.5, undefined, 0.7);
    }),
    'cr.ember_melee': rel(0.52, (g) => {
      const b = fire(g);
      whoosh(g, 0, 0.2, [500, 2600, 700], 1.1, 1.5);
      roar(g, 0.02, 0.44, 720, 220, 1, b, 0.15);
      crackle(g, 0.05, 0.48, 12, 0.55, undefined, 1.5);
    }),
    // ---- Fireball
    'cs.fireball': tell(0.17, (g) => {
      const b = fire(g, 2);
      g.nz('pink', 'bandpass', X(0, 0.16, 500, 1900), 1.2, R(0, 0.165, 1), b);
      crackle(g, 0, 0.14, 5, 0.6);
    }),
    'cr.fireball': rel(0.55, (g) => {
      const b = fire(g);
      g.thump(0, 150, 58, 0.22, 0.5, b);
      roar(g, 0, 0.5, 900, 260, 1, b, 0.08);
      whoosh(g, 0, 0.3, [1200, 3200, 900], 0.5, 1.2, undefined, 0.2);
      crackle(g, 0.02, 0.4, 8, 0.4, undefined, 1.6);
    }),
    // ---- Flame Wave
    'cs.flamewave': tell(0.3, (g) => {
      // a great indrawn breath: the low end swells and flutters, air is sucked in over the top
      const b = fire(g, 3);
      const flutter = g.trem(28, 0.7, 'sawtooth');
      flutter.connect(b);
      g.nz('pink', 'bandpass', X(0, 0.28, 110, 360), 0.8, R(0, 0.29, 1.2), flutter);
      g.nz('brown', 'lowpass', 200, 0.7, R(0, 0.29, 0.7), flutter);
      g.tone('sine', X(0, 0.28, 55, 118), R(0, 0.29, 0.5));
      g.nz('white', 'highpass', X(0, 0.28, 6000, 2500), 0.7, R(0, 0.29, 0.22));
    }),
    'cr.flamewave': rel(0.42, (g) => {
      whoosh(g, 0, 0.3, [350, 2000, 500], 1.2, 1.1, undefined, 0.3);
      g.thump(0, 130, 50, 0.2, 0.5);
      crackle(g, 0, 0.3, 8, 0.4, undefined, 1.4);
    }),
    'fx.flamewave': big(1.0, (g) => {
      const b = fire(g, 3.2, 4600);
      roar(g, 0, 0.95, 1100, 240, 1.1, b, 0.1);
      g.nz('pink', 'bandpass', X(0, 0.7, 380, 180), 1.5, S(0, 0.8, 0.9, 0.15), b);
      crackle(g, 0.03, 0.9, 30, 0.6, undefined, 1.5);
      boom(g, 0, 110, 42, 0.4, 0.5, b);
    }, { lvl: LV.big, ref: 8, range: 110 }),
    // ---- Meteor
    'cs.meteor': tell(0.44, (g) => {
      const b = fire(g, 2.5);
      roar(g, 0, 0.43, 120, 420, 0.9, b, 0.9);
      g.tone('sine', X(0, 0.42, 320, 960), R(0, 0.43, 0.16));
      g.tone('sine', X(0, 0.42, 484, 1450), R(0, 0.43, 0.07));
      crackle(g, 0.05, 0.4, 10, 0.45, undefined, 0.6);
    }),
    'cr.meteor': rel(0.7, (g) => {
      const b = fire(g);
      g.thump(0, 110, 44, 0.3, 0.55, b);
      whoosh(g, 0, 0.6, [300, 1800, 3600], 0.9, 1.3, undefined, 0.35);
      roar(g, 0, 0.5, 500, 200, 0.6, b, 0.1);
    }),
    'ent.meteor.fall': tell(1.15, (g) => {
      // a whistle falling out of the sky and a roar that grows until the fuse ends
      const b = fire(g, 3);
      g.tone('sine', X(0, 1.13, 2300, 420), [[0, 0], [0.12, 0.06], [1.05, 0.2], [1.15, 0]]);
      g.nz('white', 'bandpass', X(0, 1.13, 3800, 700), 5, [[0, 0], [0.2, 0.5], [1.08, 1.6], [1.15, 0]]);
      g.nz('pink', 'bandpass', X(0, 1.13, 240, 620), 0.6, R(0, 1.15, 1.1, 0.03), b);
      g.nz('brown', 'lowpass', 220, 0.7, R(0, 1.15, 0.5, 0.03), b);
      crackle(g, 0.3, 1.1, 16, 0.4, undefined, 0.5);
    }, { lvl: LV.rel, ref: 10, range: 110, pri: 4, vary: 0 }),
    'ent.meteor.impact': big(1.9, (g) => {
      const b = fire(g, 3.5, 4200);
      boom(g, 0, 95, 30, 0.9, 1, b);
      g.thump(0, 180, 60, 0.18, 0.6, b);
      roar(g, 0, 1.6, 1400, 160, 1.1, b, 0.04);
      g.click(0, 2800, 1, undefined, 0.03);
      rumble(g, 0.05, 1.8, 120, 0.5, undefined, 0.1);
      crackle(g, 0.05, 1.5, 44, 0.7, undefined, 1.8);
      g.ticks({ n: 14, from: 0.1, to: 1.4, f: [300, 1200], q: 1.5, len: [0.02, 0.07], g: 0.6, bias: 1.6, kind: 'pink' });
    }, { lvl: LV.huge, ref: 10, range: 220, pri: 5 }),
    // ---- lingering fire
    'ent.firepatch.spawn': rel(0.6, (g) => {
      const b = fire(g);
      g.thump(0, 120, 55, 0.2, 0.35, b);
      roar(g, 0, 0.55, 300, 800, 1, b, 0.2);
      crackle(g, 0.02, 0.55, 14, 0.6);
    }, { lvl: LV.small * 1.3 }),
    'ent.firepatch.loop': loop((g) => {
      const b = fire(g, 2);
      const f1 = g.trem(7, 0.45), f2 = g.trem(4.5, 0.35);
      f1.connect(b); f2.connect(b);
      g.nz('brown', 'lowpass', 320, 0.7, 0.4, f1);
      g.nz('pink', 'bandpass', 720, 0.7, 0.9, f2);
      g.nz('white', 'bandpass', 2600, 0.8, 0.14, f1);
      crackle(g, 0.5, 2.46, 36, 0.9);
      g.ticks({ n: 5, from: 0.5, to: 2.4, f: [500, 950], q: 2, len: [0.02, 0.05], g: 0.8, kind: 'pink', groups: 1 });
    }, { range: 40, ref: 4 }),
    'ent.firepatch.end': small(0.7, (g) => {
      g.nz('white', 'highpass', X(0, 0.65, 2200, 5200), 0.7, P(0, 0.02, 0.62, 1));
      g.nz('pink', 'bandpass', X(0, 0.5, 700, 300), 0.8, P(0, 0.01, 0.4, 0.6));
      crackle(g, 0, 0.4, 6, 0.4, undefined, 2);
    }),
    'ent.cindertrail.spawn': small(0.3, (g) => {
      const b = fire(g, 2);
      g.nz('pink', 'bandpass', X(0, 0.25, 600, 1500), 1, P(0, 0.02, 0.26, 1), b);
      crackle(g, 0, 0.25, 6, 0.6);
    }),
    // ---- Cinder Dash
    'cs.cinderdash': tell(0.1, (g) => {
      g.click(0, 3400, 1, undefined, 0.02);
      g.nz('pink', 'bandpass', X(0, 0.09, 700, 2200), 1.5, P(0, 0.004, 0.085, 0.8));
    }, { lvl: LV.small }),
    'cr.cinderdash': rel(0.75, (g) => {
      const b = fire(g, 2.8);
      whoosh(g, 0, 0.26, [400, 3400, 900], 1.3, 1.2, undefined, 0.35);
      roar(g, 0, 0.7, 900, 300, 0.9, b, 0.12);
      g.thump(0, 140, 60, 0.15, 0.4, b);
      crackle(g, 0.08, 0.7, 20, 0.6, undefined, 1.2);
    }),
    // ---- fireball in flight and its ends
    'ent.fireball.loop': loop((g) => {
      const b = fire(g, 2.2);
      const f = g.trem(23, 0.55), f2 = g.trem(17, 0.6);
      f.connect(b); f2.connect(b);
      g.nz('pink', 'bandpass', 460, 0.7, 1, f);
      g.nz('white', 'bandpass', 2300, 1, 0.3, f2);
      g.nz('brown', 'lowpass', 200, 0.7, 0.3, f);
      crackle(g, 0.5, 2.45, 22, 0.5);
    }, { range: 55, ref: 4, lvl: LV.loop * 0.9 }),
    'ent.fireball.burst': big(1.0, (g) => {
      const b = fire(g, 3, 4800);
      boom(g, 0, 130, 46, 0.4, 0.8, b);
      roar(g, 0, 0.85, 1500, 240, 1, b, 0.05);
      g.click(0, 3000, 0.9, undefined, 0.02);
      crackle(g, 0.03, 0.85, 26, 0.6, undefined, 1.8);
    }, { lvl: LV.hitHeavy, ref: 7, range: 110, pri: 3 }),
    'ent.fireball.fizz': small(0.35, (g) => {
      g.nz('white', 'highpass', X(0, 0.3, 1800, 4800), 0.7, P(0, 0.01, 0.3, 1));
      crackle(g, 0, 0.2, 5, 0.5, undefined, 2);
    }),
    // ---- hit layers
    'hit.ember.l': hitLight(0.34, (g) => {
      const b = fire(g, 2.6);
      g.nz('pink', 'bandpass', X(0, 0.25, 1300, 420), 0.8, P(0, 0.003, 0.26, 1), b);
      g.nz('white', 'highpass', 2400, 0.7, P(0, 0.002, 0.12, 0.5));
      crackle(g, 0.01, 0.3, 8, 0.5, undefined, 1.8);
    }),
    'hit.ember.h': hitHeavy(0.7, (g) => {
      const b = fire(g, 3.2, 4600);
      boom(g, 0, 120, 44, 0.32, 0.7, b);
      roar(g, 0, 0.62, 1500, 260, 1, b, 0.05);
      g.nz('white', 'highpass', 2600, 0.7, P(0, 0.002, 0.14, 0.5));
      crackle(g, 0.02, 0.6, 18, 0.55, undefined, 1.8);
    }),
    'hit.ember.t': hitTick(0.16, (g) => {
      g.nz('white', 'bandpass', X(0, 0.12, 3600, 2000), 1.2, P(0, 0.003, 0.12, 1));
      crackle(g, 0, 0.12, 4, 0.7);
    }),
  };
}
