// Element-agnostic combat and world sounds: footsteps per surface, the body/weapon layers of a
// hit, hit-confirm layers for the local player, death and ring-out, respawn, teleports,
// shatter/pop, the health rune, thunder.

import { G, P, S, R, X } from '../kit';
import type { DefMap, SoundDef } from '../bank';
import { rel, big, small, loop, whoosh, boom, debris, LV } from './common';

export const SURFACES = ['grass', 'rock', 'snow', 'ice', 'stone', 'wood'] as const;
export type SurfaceName = (typeof SURFACES)[number];
export const STEP_VARIANTS = 4;

// ---------------------------------------------------------------------------------- footsteps
function footBody(g: G, surf: SurfaceName, w: number): void {
  const r = g.rng.range(0.9, 1.12);
  switch (surf) {
    case 'grass':
      g.thump(0, 95 * r, 50, 0.07 * w, 0.6 * w);
      g.nz('white', 'bandpass', X(0, 0.09, 3400 * r, 2000), 0.9, P(0, 0.008, 0.09 * w, 0.6));
      g.ticks({ n: Math.round(4 * w), from: 0.005, to: 0.1 * w, f: [2500, 5000], q: 2, len: [0.004, 0.012], g: 0.35 });
      break;
    case 'rock':
      g.click(0, 2100 * r, 0.8);
      g.thump(0, 150, 80, 0.05 * w, 0.5 * w);
      g.modal(0, [[380 * r, 1, 0.04], [910 * r, 0.5, 0.03]], 0.3);
      g.ticks({ n: Math.round(4 * w), from: 0.01, to: 0.09 * w, f: [2500, 6000], q: 2.5, len: [0.003, 0.01], g: 0.35 });
      break;
    case 'snow':
      g.ticks({ n: Math.round(16 * w), from: 0, to: 0.11 * w, f: [900, 3400], q: 2, len: [0.004, 0.014], g: 1, bias: 1.2, groups: 3 });
      g.nz('pink', 'bandpass', X(0, 0.12 * w, 1400 * r, 600), 2, P(0, 0.01, 0.12 * w, 0.6));
      g.thump(0, 80, 50, 0.06, 0.25 * w);
      break;
    case 'ice':
      g.click(0, 3600 * r, 1, undefined, 0.008, 2);
      g.modal(0, [[2300 * r, 1, 0.05], [4100 * r, 0.5, 0.035], [6400, 0.25, 0.02]], 0.25);
      g.thump(0, 170, 100, 0.03, 0.2 * w);
      g.nz('white', 'highpass', 5000, 0.7, P(0.005, 0.004, 0.05 * w, 0.25));
      break;
    case 'stone':
      g.thump(0, 125 * r, 68, 0.06 * w, 0.7 * w);
      g.click(0, 1300 * r, 0.7, undefined, 0.014);
      g.modal(0, [[240 * r, 1, 0.05], [610 * r, 0.4, 0.035]], 0.3);
      g.nz('pink', 'lowpass', 900, 0.7, P(0, 0.003, 0.05, 0.4));
      break;
    default: // wood: a hollow plank
      g.modal(0, [[165 * r, 1, 0.11], [392 * r, 0.6, 0.08], [730 * r, 0.3, 0.05], [1220, 0.12, 0.03]], 0.35 * w);
      g.click(0, 950 * r, 0.6, undefined, 0.012);
      g.thump(0, 110, 70, 0.05, 0.35 * w);
  }
}

function footDefs(): DefMap {
  const d: DefMap = {};
  const base: Partial<SoundDef> = { ref: 3.5, range: 34, pri: 0, vary: 1.2 };
  for (const s of SURFACES) {
    for (let v = 0; v < STEP_VARIANTS; v++) d[`step.${s}.${v}`] = { dur: 0.2, lvl: LV.foot, build: (g) => footBody(g, s, 1), ...base };
    d[`jump.${s}`] = {
      dur: 0.24, lvl: LV.foot * 0.95, ...base,
      build: (g) => { footBody(g, s, 0.7); g.nz('white', 'bandpass', X(0, 0.12, 900, 2600), 1.2, P(0, 0.012, 0.12, 0.45)); },
    };
    d[`land.${s}`] = {
      dur: 0.36, lvl: LV.foot * 1.7, ...base, range: 42, pri: 0.5,
      build: (g) => { footBody(g, s, 1.7); g.thump(0, 90, 40, 0.14, 0.8); g.nz('pink', 'bandpass', 700, 0.8, P(0.01, 0.01, 0.13, 0.3)); },
    };
  }
  return d;
}

// ---------------------------------------------------------------------------------- hits
const METAL: [number, number, number][] = [[1, 1, 0.18], [2.41, 0.6, 0.14], [3.87, 0.4, 0.1], [5.2, 0.25, 0.08], [7.3, 0.12, 0.05]];

function hitDefs(): DefMap {
  const d: DefMap = {};
  for (let v = 0; v < 3; v++) {
    d[`hit.body.l${v}`] = {
      dur: 0.22, lvl: LV.hit, ref: 6, range: 70, pri: 3, vary: 1.2,
      build: (g) => {
        const r = g.rng.range(0.88, 1.14);
        g.thump(0, 170 * r, 70, 0.1, 0.8);
        g.nz('pink', 'bandpass', 900 * r, 1, P(0, 0.002, 0.07, 0.9));
        g.click(0, 2800 * r, 0.7);
        g.nz('white', 'highpass', 2200, 0.7, P(0, 0.001, 0.03, 0.5));
        g.nz('pink', 'bandpass', 500, 0.8, P(0.02, 0.01, 0.14, 0.25));
      },
    };
    d[`hit.body.h${v}`] = {
      dur: 0.5, lvl: LV.hitHeavy, ref: 8, range: 110, pri: 4, vary: 1, heavy: true,
      build: (g) => {
        const r = g.rng.range(0.88, 1.14);
        g.thump(0, 130 * r, 40, 0.3, 1);
        g.nz('brown', 'lowpass', 200, 0.7, P(0, 0.004, 0.25, 0.6));
        g.nz('pink', 'bandpass', 700 * r, 0.9, P(0, 0.002, 0.12, 1));
        g.click(0, 2400 * r, 0.8);
        g.nz('white', 'highpass', 1800, 0.7, P(0, 0.001, 0.05, 0.6));
        g.ticks({ n: 6, from: 0.02, to: 0.25, f: [1800, 4500], q: 3, len: [0.004, 0.012], g: 0.35, bias: 1.5 });
        g.nz('white', 'bandpass', X(0, 0.2, 1500, 500), 1, P(0, 0.004, 0.2, 0.3));
      },
    };
  }
  for (let v = 0; v < 2; v++) {
    // steel / iron-bound haft striking: the weapon layer of a melee hit
    d[`hit.weapon.${v}`] = {
      dur: 0.3, lvl: LV.hit * 0.8, ref: 6, range: 70, pri: 2, vary: 1.5,
      build: (g) => { g.modal(0, METAL, 0.2, undefined, { mul: v ? 870 : 660 }); g.click(0, 4200, 0.7, undefined, 0.006); },
    };
  }
  d['hit.crit'] = {
    dur: 0.45, lvl: LV.hit, ref: 8, range: 90, pri: 4, vary: 0.5,
    build: (g) => {
      g.modal(0, [[2093, 1, 0.35], [3136, 0.5, 0.25], [4699, 0.3, 0.18]], 0.25);
      g.click(0, 6000, 1, undefined, 0.006);
      g.nz('white', 'highpass', 4000, 0.7, P(0, 0.001, 0.05, 0.8));
      g.thump(0, 90, 45, 0.15, 0.4);
    },
  };
  // ---- non-positional layers for the local player: the hit you FEEL
  d['hit.confirm.l'] = {
    dur: 0.16, lvl: 0.12, vary: 0.8,
    build: (g) => {
      g.thump(0, 220, 90, 0.07, 0.9);
      g.click(0, 3200, 0.8);
      g.modal(0, [[640, 1, 0.05], [1480, 0.5, 0.04]], 0.3);
      g.click(0.001, 5200, 0.4, undefined, 0.005);
    },
  };
  d['hit.confirm.h'] = {
    dur: 0.42, lvl: 0.17, vary: 0.6,
    build: (g) => {
      g.thump(0, 150, 45, 0.22, 1);
      g.nz('brown', 'lowpass', 160, 0.7, P(0, 0.003, 0.2, 0.5));
      g.click(0, 2600, 0.9);
      g.modal(0, [[420, 1, 0.08], [990, 0.5, 0.06]], 0.3);
      g.tone('sine', 1760, P(0, 0.002, 0.18, 0.1));
    },
  };
  d['hit.taken.l'] = {
    dur: 0.36, lvl: 0.14, vary: 0.8,
    build: (g) => {
      g.thump(0, 120, 55, 0.14, 1);
      g.nz('pink', 'lowpass', 500, 0.7, P(0, 0.003, 0.1, 0.8));
      g.tone('sine', 2637, P(0, 0.01, 0.25, 0.04));
    },
  };
  d['hit.taken.h'] = {
    dur: 0.95, lvl: 0.2, vary: 0.5,
    build: (g) => {
      g.thump(0, 100, 32, 0.4, 1.1);
      g.nz('brown', 'lowpass', 180, 0.7, P(0, 0.004, 0.35, 0.7));
      g.nz('pink', 'lowpass', 700, 0.7, P(0, 0.003, 0.15, 0.8));
      // ears ringing: two tones beating
      g.tone('sine', 3136, P(0, 0.02, 0.8, 0.05));
      g.tone('sine', 3150, P(0, 0.02, 0.8, 0.04));
    },
  };
  // a weapon biting into terrain
  d['fx.melee'] = {
    dur: 0.32, lvl: LV.hit * 0.8, ref: 5, range: 60, pri: 1.5, vary: 1.5,
    build: (g) => {
      g.modal(0, METAL.slice(0, 3), 0.2, undefined, { mul: 520, decay: 0.6 });
      g.thump(0, 140, 70, 0.08, 0.5);
      g.click(0, 2400, 0.8);
      g.ticks({ n: 6, from: 0.01, to: 0.22, f: [1500, 5000], q: 2.5, len: [0.004, 0.014], g: 0.5, bias: 1.5 });
    },
  };
  return d;
}

// ---------------------------------------------------------------------------------- the rest
const RUNE: [number, number, number][] = [[1, 1, 1], [2, 0.35, 0.7], [3, 0.12, 0.45], [4.02, 0.06, 0.3]];
const rune = (g: G, at: number, f: number, gain: number, decay = 0.6): void => g.modal(at, RUNE, gain * 0.22, undefined, { mul: f, decay });

function worldDefs(): DefMap {
  return {
    // ---- death
    'death.body': big(0.85, (g) => {
      g.thump(0, 110, 40, 0.3, 1);
      g.nz('pink', 'bandpass', 600, 0.8, P(0, 0.004, 0.2, 0.7));
      g.thump(0.24, 90, 45, 0.2, 0.6);
      g.nz('pink', 'lowpass', 800, 0.7, P(0.24, 0.004, 0.14, 0.4));
      g.ticks({ n: 12, from: 0.04, to: 0.6, f: [1500, 4200], q: 3, len: [0.004, 0.014], g: 0.45, bias: 1.3 });
    }, { lvl: LV.hitHeavy, ref: 7, range: 90, pri: 4 }),
    'death.soul': rel(1.6, (g) => {
      // what leaves: a breath going up, one low toll underneath
      g.modal(0, [[1, 1, 1.4], [1.48, 0.5, 1.1], [2.09, 0.3, 0.8]], 0.25, undefined, { mul: 147 });
      g.nz('white', 'bandpass', X(0, 1.3, 500, 3400), 3, S(0, 1.5, 1, 0.55));
      g.tone('sine', X(0, 1.4, 220, 660), S(0, 1.5, 0.08, 0.6));
      g.tone('sine', X(0, 1.4, 331, 990), S(0, 1.5, 0.05, 0.6));
    }, { ref: 8, range: 100, pri: 3, vary: 0 }),
    'death.fall': rel(2.7, (g) => {
      // ring-out: a long whoosh falling away into the cloud sea, a far-off thud of nothing
      g.nz('white', 'bandpass', X(0, 2.5, 3200, 220), 2.5, [[0, 0], [0.15, 1], [2.0, 0.45], [2.65, 0]]);
      g.nz('pink', 'lowpass', X(0, 2.5, 1800, 200), 1, [[0, 0], [0.2, 0.6], [1.6, 0.4], [2.65, 0]]);
      g.tone('sine', X(0, 2.4, 1500, 170), [[0, 0], [0.1, 0.07], [1.8, 0.04], [2.5, 0]]);
      g.tone('sine', X(0, 2.4, 1508, 174), [[0, 0], [0.1, 0.05], [1.8, 0.03], [2.5, 0]]);
      g.thump(2.15, 62, 30, 0.4, 0.3);
    }, { ref: 12, range: 170, pri: 4, vary: 0.4 }),
    'death.local': {
      dur: 1.9, lvl: 0.2, vary: 0,
      build: (g) => {
        g.tone('sine', X(0, 1.2, 160, 30), P(0, 0.01, 1.4, 1));
        g.modal(0, [[1, 1, 1.5], [1.48, 0.6, 1.2], [2.09, 0.4, 0.9]], 0.3, undefined, { mul: 65.4 });
        g.nz('pink', 'lowpass', X(0, 1.5, 2000, 150), 1, P(0, 0.01, 1.5, 0.6));
      },
    },
    'death.local.fall': {
      dur: 1.9, lvl: 0.18,
      build: (g) => {
        // air tearing past as the island shrinks above you
        g.nz('white', 'bandpass', X(0, 1.6, 500, 2800), 1.5, [[0, 0], [1.55, 1], [1.75, 0]]);
        g.nz('pink', 'lowpass', X(0, 1.6, 400, 1400), 1, [[0, 0], [1.55, 0.7], [1.75, 0]]);
        g.tone('sine', X(0, 1.6, 300, 90), [[0, 0], [0.3, 0.15], [1.6, 0.2], [1.75, 0]]);
      },
    },
    'kill.confirm': {
      dur: 0.8, lvl: 0.15, vary: 0,
      build: (g) => {
        g.thump(0, 140, 55, 0.2, 0.8);
        rune(g, 0, 587.3, 1, 0.5);
        rune(g, 0.005, 880, 0.8, 0.5);
        rune(g, 0.09, 1174.7, 0.9, 0.6);
        g.blips(6, 0.1, 0.6, [3000, 6000], 1.02, [0.02, 0.05], 0.06);
      },
    },
    // ---- respawn
    'respawn': rel(1.2, (g) => {
      g.tone('sine', X(0, 0.6, 147, 587), R(0, 0.62, 0.12));
      g.tone('sine', X(0, 0.6, 220, 880), R(0, 0.62, 0.08));
      g.nz('white', 'bandpass', X(0, 0.6, 600, 4200), 2.5, R(0, 0.62, 0.9));
      g.thump(0.6, 130, 55, 0.2, 0.5);
      rune(g, 0.6, 587.3, 1, 0.8);
      rune(g, 0.6, 880, 0.7, 0.7);
      rune(g, 0.64, 1174.7, 0.5, 0.6);
      g.blips(8, 0.62, 1.1, [2500, 6000], 1.02, [0.02, 0.06], 0.06, undefined, 1.5);
    }, { lvl: LV.rel * 0.85, ref: 7, range: 80, vary: 0 }),
    // ---- teleports
    'tp.deploy.out': rel(1.0, (g) => {
      // stepping off the Skygate: a breath, then the wind takes you
      g.nz('white', 'bandpass', X(0, 0.9, 2600, 420), 1.5, S(0, 0.95, 1, 0.2));
      g.nz('pink', 'lowpass', X(0, 0.9, 1500, 300), 1, S(0, 0.95, 0.6, 0.2));
      g.tone('sine', X(0, 0.8, 440, 110), S(0, 0.9, 0.08, 0.15));
      rune(g, 0, 587.3, 0.5, 0.5);
    }, { vary: 0 }),
    'tp.deploy.in': big(1.3, (g) => {
      // arriving out of the sky: the event marks the landing, so the weight comes first
      boom(g, 0, 105, 36, 0.5, 1);
      g.nz('white', 'bandpass', X(0, 0.35, 2600, 500), 1.6, P(0, 0.004, 0.36, 0.8));
      g.nz('pink', 'lowpass', X(0, 0.4, 1400, 300), 1, P(0, 0.004, 0.4, 0.6));
      debris(g, 0.03, 1.1, 12, [300, 1600], 0.4);
      rune(g, 0, 293.7, 0.8, 1);
      rune(g, 0.02, 440, 0.6, 0.9);
    }, { lvl: LV.hitHeavy, ref: 9, range: 120, pri: 3, vary: 0 }),
    'tp.generic.out': small(0.3, (g) => { whoosh(g, 0, 0.28, [3000, 1200, 500], 1, 1.5, undefined, 0.1); }),
    'tp.generic.in': small(0.35, (g) => { whoosh(g, 0, 0.2, [500, 2600, 1200], 1, 1.5, undefined, 0.7); g.thump(0.14, 150, 70, 0.12, 0.4); }),
    // ---- pops
    'pop.freeze': big(1.05, (g) => {
      // a frozen body shattered: one hard crack, a great many fragments
      g.click(0, 3800, 1, undefined, 0.01, 1.5);
      g.click(0.002, 7000, 0.8, undefined, 0.006, 2);
      g.thump(0, 220, 90, 0.12, 0.45);
      g.ticks({ n: 64, from: 0, to: 0.7, f: [2500, 9000], q: 3, len: [0.003, 0.02], g: 0.9, bias: 2, groups: 3 });
      for (const [f, t] of [[1319, 0], [1976, 0.01], [2637, 0.03], [3520, 0.06], [2217, 0.1], [4186, 0.15]] as const) g.modal(t, [[1, 1, 0.5], [2.32, 0.6, 0.36], [3.85, 0.4, 0.26], [5.63, 0.25, 0.18]], 0.16, undefined, { mul: f });
      g.nz('white', 'highpass', 5200, 0.7, P(0, 0.004, 0.6, 0.3));
      g.ticks({ n: 8, from: 0.1, to: 0.8, f: [700, 1800], q: 2, len: [0.01, 0.04], g: 0.35, bias: 1.5, kind: 'pink' });
    }, { lvl: LV.big, ref: 9, range: 130 }),
    'pop.bubble': rel(0.75, (g) => {
      const b = g.bus(undefined, g.lp(5200, 0.8));
      g.click(0, 1600, 1, b, 0.012, 2);
      g.tone('sine', X(0, 0.05, 1000, 300), P(0, 0.001, 0.07, 0.6), b);
      g.nz('white', 'lowpass', X(0, 0.4, 5000, 700), 1.2, P(0, 0.004, 0.42, 1), b);
      g.ticks({ n: 14, from: 0.08, to: 0.65, f: [1600, 4200], q: 2.5, len: [0.004, 0.014], g: 0.5, bias: 1.3, dest: b });
      g.blips(6, 0.1, 0.6, [400, 1200], 1.5, [0.02, 0.05], 0.12, b);
    }, { lvl: LV.hit, pri: 3 }),
    // ---- health rune
    'pickup': rel(1.1, (g) => {
      // warmth: a rising figure D - F# - A - D over a soft bloom
      const notes = [587.3, 740, 880, 1174.7];
      notes.forEach((f, i) => rune(g, i * 0.065, f, 1 - i * 0.1, 0.7));
      g.tone('sine', 146.8, P(0, 0.03, 0.6, 0.25));
      g.tone('sine', 220, P(0, 0.03, 0.5, 0.12));
      g.blips(10, 0.2, 1.0, [3000, 7000], 1.02, [0.02, 0.06], 0.05, undefined, 1.4);
    }, { lvl: LV.rel * 0.8, ref: 6, range: 60, pri: 3, vary: 0 }),
    'ent.healrune.spawn': small(0.9, (g) => {
      rune(g, 0, 880, 0.8, 0.8);
      rune(g, 0.12, 1174.7, 0.8, 0.8);
      g.nz('white', 'bandpass', X(0, 0.5, 2000, 6000), 3, S(0, 0.6, 0.4, 0.4));
    }, { range: 40, vary: 0 }),
    'ent.healrune.loop': loop((g) => {
      const t1 = g.trem(0.5, 0.7), t2 = g.trem(1, 0.7), t3 = g.trem(1.5, 0.8);
      t1.connect(g.out); t2.connect(g.out); t3.connect(g.out);
      g.tone('sine', 293.5, 0.3, t1);
      g.tone('sine', 440, 0.22, t2);
      g.tone('sine', 587.5, 0.16, t3);
      g.tone('sine', 2349, 0.03, t3);
      g.tone('sine', 3520, 0.02, t2);
    }, { lvl: 0.035, range: 18, ref: 3, pri: 0.5, vary: 0 }),
    'ent.healrune.fade': small(0.6, (g) => {
      rune(g, 0, 880, 0.7, 0.5);
      rune(g, 0.1, 587.3, 0.7, 0.5);
    }, { lvl: LV.tick, range: 30, vary: 0 }),
    // ---- thunder (non-positional; the engine picks and filters by distance)
    'thunder.near': {
      dur: 3.4, lvl: 0.3,
      build: (g) => {
        g.nz('white', 'highpass', 1200, 0.7, P(0, 0.001, 0.12, 1));
        g.ticks({ n: 10, from: 0, to: 0.5, f: [600, 3000], q: 1, len: [0.02, 0.09], g: 0.9, bias: 1.5 });
        g.thump(0.02, 80, 28, 1.2, 1);
        g.nz('brown', 'lowpass', 140, 0.7, [[0, 0], [0.05, 1], [0.5, 0.5], [0.9, 0.8], [1.4, 0.4], [1.9, 0.55], [3.3, 0]]);
        g.nz('pink', 'bandpass', X(0.05, 2.5, 500, 120), 0.7, P(0.05, 0.02, 2.6, 0.7));
      },
    },
    'thunder.mid': {
      dur: 4.2, lvl: 0.22,
      build: (g) => {
        g.nz('pink', 'lowpass', X(0, 3, 420, 160), 0.7, [[0, 0], [0.12, 1], [0.6, 0.45], [1.0, 0.8], [1.6, 0.35], [2.2, 0.5], [4.1, 0]]);
        g.nz('brown', 'lowpass', 110, 0.7, [[0, 0], [0.2, 0.8], [0.8, 0.5], [1.2, 0.9], [2.0, 0.4], [2.6, 0.6], [4.1, 0]]);
        g.thump(0.1, 60, 26, 1.5, 0.5);
      },
    },
    'thunder.far': {
      dur: 4.8, lvl: 0.15,
      build: (g) => {
        g.nz('brown', 'lowpass', 85, 0.7, [[0, 0], [0.5, 0.7], [1.1, 0.4], [1.7, 0.9], [2.5, 0.35], [3.2, 0.5], [4.7, 0]]);
        g.nz('pink', 'lowpass', 190, 0.7, [[0, 0], [0.6, 0.4], [1.8, 0.5], [4.5, 0]]);
      },
    },
  };
}

export function coreDefs(): DefMap {
  return { ...hitDefs(), ...worldDefs() };
}
export function footstepDefs(): DefMap {
  return footDefs();
}
