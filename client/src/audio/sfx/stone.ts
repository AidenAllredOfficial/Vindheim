// STONE — deep thuds, grinding, rubble. Everything lives below 1 kHz and takes its time.

import { G, P, S, R, X } from '../kit';
import type { DefMap } from '../bank';
import { tell, rel, big, small, loop, hitLight, hitHeavy, hitTick, boom, rumble, debris, LV } from './common';

/** Rock dragging on rock: low noise chopped by a stick-slip sawtooth. */
function grind(g: G, at: number, dur: number, gain: number, rate = 31, pos = 0.5, f = 520): void {
  const t = g.trem(rate, 0.85, 'sawtooth');
  t.connect(g.out);
  g.nz('pink', 'lowpass', f, 0.9, S(at, dur, gain, pos), t);
  g.nz('brown', 'bandpass', 180, 1.2, S(at, dur, gain * 0.5, pos), t);
}

/** A dull rock-on-rock knock. */
function knock(g: G, at: number, gain: number, f = 420): void {
  g.modal(at, [[1, 1, 0.07], [1.83, 0.5, 0.05], [2.9, 0.3, 0.035]], gain * 0.3, undefined, { mul: f });
  g.click(at, f * 3.2, gain * 0.6, undefined, 0.01, 1);
}

const rubble = (g: G, from: number, to: number, n: number, gain: number, bias = 1.7): void => debris(g, from, to, n, [180, 1300], gain, undefined, bias);

export function stoneDefs(): DefMap {
  return {
    // ---- Hammerfall
    'cs.stone_melee': tell(0.44, (g) => {
      // the hammer goes up: a slow heavy creak of effort and gathering grit
      grind(g, 0, 0.43, 1, 23, 0.85, 420);
      g.tone('sine', X(0, 0.42, 58, 96), R(0, 0.43, 0.3));
      rubble(g, 0.1, 0.4, 5, 0.3, 0.6);
    }),
    'cr.stone_melee': rel(0.6, (g) => {
      g.nz('pink', 'bandpass', [[0, 260], [0.14, 900, 'e'], [0.26, 300, 'e']], 1, S(0, 0.28, 1.2, 0.55));
      boom(g, 0.16, 105, 38, 0.36, 0.9);
      knock(g, 0.16, 0.8, 300);
      rubble(g, 0.2, 0.58, 8, 0.4);
    }),
    // ---- Boulder Toss
    'cs.boulder': tell(0.38, (g) => {
      grind(g, 0, 0.37, 1, 37, 0.7, 600);
      knock(g, 0.02, 0.5, 260);
      knock(g, 0.2, 0.6, 330);
      g.tone('sine', X(0, 0.36, 70, 120), R(0, 0.37, 0.25));
    }),
    'cr.boulder': rel(0.55, (g) => {
      g.nz('pink', 'bandpass', [[0, 200], [0.2, 700, 'e'], [0.5, 240, 'e']], 0.9, S(0, 0.52, 1.2, 0.3));
      g.thump(0, 120, 50, 0.22, 0.5);
      rubble(g, 0.02, 0.4, 5, 0.3);
    }),
    'ent.boulder.loop': loop((g) => {
      // the tumbling rush of something heavy through the air
      const t = g.trem(5, 0.6);
      t.connect(g.out);
      g.nz('pink', 'bandpass', 300, 0.8, 1, t);
      g.nz('brown', 'lowpass', 150, 0.7, 0.4, t);
      g.nz('white', 'bandpass', 900, 1.2, 0.12, t);
    }, { range: 50, ref: 4, lvl: LV.loop * 0.9 }),
    'ent.boulder.smash': big(1.2, (g) => {
      boom(g, 0, 100, 32, 0.6, 1);
      knock(g, 0, 1, 240);
      g.nz('pink', 'lowpass', X(0, 0.3, 2400, 400), 0.7, P(0, 0.002, 0.32, 0.9));
      rubble(g, 0.03, 1.1, 30, 0.7);
      rumble(g, 0.02, 0.9, 110, 0.4);
    }, { lvl: LV.big, ref: 9, range: 140 }),
    // ---- Rampart
    'cs.rampart': tell(0.32, (g) => {
      rumble(g, 0, 0.31, 130, 0.8, undefined, 0.9);
      grind(g, 0, 0.31, 0.9, 29, 0.9, 480);
      g.tone('sine', X(0, 0.3, 44, 78), R(0, 0.31, 0.35));
    }),
    'cr.rampart': rel(0.4, (g) => {
      g.thump(0, 90, 40, 0.25, 0.7);
      knock(g, 0, 0.7, 210);
      rubble(g, 0.02, 0.36, 6, 0.4);
    }),
    'ent.rampart.rise': big(1.3, (g) => {
      // 0.25 s of rock tearing upward, a thud as it seats, then settling grit
      grind(g, 0, 0.34, 1.2, 43, 0.6, 700);
      g.tone('sine', X(0, 0.26, 40, 92), [[0, 0], [0.05, 0.5], [0.25, 0.6], [0.32, 0]]);
      g.nz('pink', 'bandpass', X(0, 0.28, 240, 900), 0.8, S(0, 0.3, 0.8, 0.8));
      boom(g, 0.26, 88, 34, 0.5, 0.9);
      knock(g, 0.26, 0.8, 190);
      rubble(g, 0.05, 1.2, 28, 0.6, 1.3);
      rumble(g, 0.2, 1.0, 100, 0.35);
    }, { lvl: LV.big, ref: 9, range: 140, vary: 0.3 }),
    'ent.rampart.crumble': big(1.5, (g) => {
      grind(g, 0, 0.9, 0.8, 19, 0.2, 520);
      rubble(g, 0, 1.4, 46, 0.9, 1.4);
      boom(g, 0.12, 80, 36, 0.4, 0.5);
      boom(g, 0.4, 70, 34, 0.35, 0.35);
      rumble(g, 0, 1.3, 120, 0.4, undefined, 0.2);
    }, { lvl: LV.hitHeavy, ref: 8, range: 110, pri: 3 }),
    'ent.rampart.shatter': big(1.5, (g) => {
      // burst apart by its owner's hammer
      g.click(0, 2200, 1, undefined, 0.02, 0.8);
      boom(g, 0, 115, 34, 0.6, 1);
      knock(g, 0, 1, 280);
      knock(g, 0.03, 0.8, 410);
      g.nz('pink', 'lowpass', X(0, 0.4, 3600, 500), 0.7, P(0, 0.002, 0.4, 1));
      rubble(g, 0.02, 1.4, 54, 0.9, 2);
      rumble(g, 0.03, 1.2, 120, 0.4);
    }, { lvl: LV.huge, ref: 9, range: 170, pri: 4 }),
    'ent.rockshard.hit': small(0.3, (g) => {
      knock(g, 0, 1, g.rng.xrange(380, 620));
      g.thump(0, 150, 80, 0.06, 0.3);
      rubble(g, 0.01, 0.26, 5, 0.5);
    }, { vary: 2.5, range: 55 }),
    // ---- Earthshatter
    'cs.earthshatter': tell(0.57, (g) => {
      // long, unmistakable: the ground itself groans before it breaks
      rumble(g, 0, 0.56, 110, 0.9, undefined, 0.92);
      grind(g, 0, 0.56, 0.9, 17, 0.92, 380);
      g.tone('sine', X(0, 0.55, 36, 70), R(0, 0.56, 0.5));
      g.tone('triangle', X(0, 0.55, 72, 140), R(0, 0.56, 0.12));
      rubble(g, 0.15, 0.54, 8, 0.3, 0.5);
    }),
    'cr.earthshatter': rel(0.5, (g) => {
      boom(g, 0, 95, 30, 0.42, 1);
      knock(g, 0, 1, 170);
      g.nz('pink', 'lowpass', X(0, 0.2, 1800, 300), 0.7, P(0, 0.002, 0.2, 0.7));
    }),
    'fx.earthshatter': big(2.0, (g) => {
      // the shockwave rolling outward for seven metres
      boom(g, 0, 78, 24, 1.1, 1.1);
      g.nz('pink', 'bandpass', X(0, 0.7, 900, 150), 0.7, P(0, 0.006, 0.9, 1));
      grind(g, 0, 0.9, 0.9, 27, 0.15, 620);
      knock(g, 0.01, 0.9, 150);
      rubble(g, 0.05, 1.9, 60, 0.8, 1.5);
      rumble(g, 0.02, 1.9, 95, 0.6, undefined, 0.1);
    }, { lvl: LV.huge, ref: 10, range: 220, pri: 5 }),
    // ---- Seismic Leap
    'cs.seismicleap': tell(0.13, (g) => {
      g.thump(0, 70, 130, 0.1, 0.6);
      knock(g, 0, 0.6, 230);
      g.nz('pink', 'lowpass', 700, 0.7, R(0, 0.125, 0.6));
    }),
    'cr.seismicleap': rel(0.6, (g) => {
      boom(g, 0, 110, 44, 0.3, 0.8);
      g.nz('pink', 'bandpass', [[0, 300], [0.25, 1100, 'e'], [0.55, 500, 'e']], 1, S(0, 0.56, 0.9, 0.3));
      rubble(g, 0.02, 0.45, 9, 0.5);
    }),
    'fx.leapslam': big(1.3, (g) => {
      boom(g, 0, 92, 30, 0.7, 1.1);
      knock(g, 0, 1, 200);
      g.nz('pink', 'lowpass', X(0, 0.3, 2600, 350), 0.7, P(0, 0.002, 0.34, 1));
      rubble(g, 0.03, 1.2, 34, 0.75);
      rumble(g, 0.02, 1.1, 105, 0.45);
    }, { lvl: LV.big, ref: 10, range: 150 }),
    // ---- hit layers
    'hit.stone.l': hitLight(0.34, (g) => {
      g.thump(0, 150, 62, 0.14, 0.7);
      knock(g, 0, 0.9, 330);
      rubble(g, 0.01, 0.3, 5, 0.4);
    }),
    'hit.stone.h': hitHeavy(0.8, (g) => {
      boom(g, 0, 110, 34, 0.5, 1);
      knock(g, 0, 1, 250);
      g.nz('pink', 'lowpass', X(0, 0.25, 2200, 380), 0.7, P(0, 0.002, 0.26, 0.8));
      rubble(g, 0.02, 0.75, 16, 0.6);
    }),
    'hit.stone.t': hitTick(0.14, (g) => {
      knock(g, 0, 1, 460);
      rubble(g, 0, 0.12, 3, 0.5);
    }),
  };
}
