// UMBRA — dark reversed swells, whispers, hollow thumps. Sound that is sucked inward, then stops.

import { G, P, S, R, X } from '../kit';
import type { DefMap } from '../bank';
import { tell, rel, big, small, loop, hitLight, hitHeavy, hitTick, LV } from './common';

/** A dull, inharmonic toll: the "bell" every reversed swell is made from. */
const DARK: [number, number, number][] = [[1, 1, 1], [1.48, 0.6, 0.8], [2.09, 0.42, 0.6], [2.93, 0.2, 0.4], [4.2, 0.1, 0.25]];
const dark = (g: G, at: number, f: number, gain: number, decay = 1, dest?: AudioNode): void => g.modal(at, DARK, gain * 0.25, dest, { mul: f, decay });

/** Shadow path: closed-in, with a hollow resonance. */
const murk = (g: G, top = 1500): GainNode => g.bus(undefined, g.bq('peaking', 240, 2, 6), g.lp(top));

/** Source material for a reversed swell: a toll and a puff of dark noise, both dying away. */
function swellSrc(g: G, dur: number, f: number, noiseHz = 900): void {
  const b = murk(g, 2200);
  dark(g, 0, f, 1, dur * 1.1, b);
  g.nz('pink', 'bandpass', X(0, dur, noiseHz * 2, noiseHz * 0.5), 1.2, P(0, 0.004, dur * 0.9, 0.9), b);
  g.nz('white', 'bandpass', X(0, dur * 0.6, 3200, 1500), 3, P(0, 0.004, dur * 0.5, 0.25), b);
}

/** Unintelligible voices: slow, breathy syllables through wandering formants. */
function whisper(g: G, from: number, to: number, gain: number, dest?: AudioNode, rate = 8): void {
  g.ticks({ n: Math.max(2, Math.round((to - from) * rate)), from, to, f: [1100, 3000], q: 5, len: [0.05, 0.13], g: gain * 2.2, groups: 3, dest });
  g.nz('white', 'bandpass', [[from, 1700], [(from + to) / 2, 2400], [to, 1500]], 3, S(from, to - from, gain * 0.25, 0.5), dest);
}

/** Hollow thump: a blow landing on something with nothing inside. */
function hollow(g: G, at: number, gain: number, dest?: AudioNode, f = 118): void {
  g.thump(at, f, f * 0.42, 0.22, gain * 0.8, dest);
  g.tone('triangle', X(at, 0.12, f * 1.9, f * 1.5), P(at, 0.002, 0.14, gain * 0.35), dest);
  g.nz('pink', 'bandpass', 300, 3.5, P(at, 0.002, 0.09, gain * 0.9), dest);
}

export function umbraDefs(): DefMap {
  return {
    // ---- Dusk Fang
    'cs.umbra_melee': tell(0.23, (g) => { whisper(g, 0.02, 0.2, 0.25, undefined, 14); }, { revLayer: { dur: 0.23, build: (g) => swellSrc(g, 0.23, 196, 1100), gain: 3 } }),
    'cr.umbra_melee': rel(0.34, (g) => {
      const b = murk(g, 2600);
      g.nz('white', 'bandpass', X(0, 0.12, 2600, 700), 2.2, P(0, 0.003, 0.13, 1), b);
      hollow(g, 0.03, 0.6, b, 150);
      whisper(g, 0.05, 0.3, 0.3, undefined, 12);
    }),
    // ---- Night Daggers
    'cs.daggers': tell(0.15, (g) => { g.nz('white', 'bandpass', 2400, 4, R(0, 0.145, 0.3)); }, { revLayer: { dur: 0.15, build: (g) => swellSrc(g, 0.15, 294, 1600), gain: 3 } }),
    'cr.daggers': rel(0.3, (g) => {
      const b = murk(g, 3000);
      g.nz('white', 'bandpass', X(0, 0.2, 3000, 900), 2, P(0, 0.003, 0.2, 1), b);
      g.tone('triangle', X(0, 0.1, 330, 160), P(0, 0.002, 0.12, 0.25), b);
    }, { lvl: LV.small * 1.2 }),
    'ent.dagger.spawn': rel(0.22, (g) => {
      const b = murk(g, 3200);
      g.nz('white', 'bandpass', X(0, 0.18, 3400, 1100), 3, P(0, 0.002, 0.18, 1), b);
      g.tone('sine', X(0, 0.15, 520, 240), P(0, 0.002, 0.15, 0.2), b);
    }, { lvl: LV.rel * 0.7, vary: 2 }),
    'ent.dagger.hit': small(0.22, (g) => {
      const b = murk(g, 2400);
      hollow(g, 0, 0.7, b, 190);
      g.click(0, 1500, 0.6, b, 0.008, 2);
    }, { vary: 2 }),
    // ---- Shadow Snare
    'cs.snare': tell(0.31, (g) => { whisper(g, 0.03, 0.28, 0.3, undefined, 12); }, { revLayer: { dur: 0.31, build: (g) => swellSrc(g, 0.31, 131, 700), gain: 3 } }),
    'cr.snare': rel(0.55, (g) => {
      const b = murk(g, 1800);
      hollow(g, 0, 0.9, b, 96);
      g.nz('pink', 'bandpass', X(0, 0.5, 900, 250), 1.5, P(0, 0.01, 0.5, 0.8), b);
      whisper(g, 0.05, 0.5, 0.3);
    }),
    'ent.snare.spawn': rel(0.9, (g) => {
      // the pool opens, and half a second later it is hungry
      const b = murk(g, 1600);
      g.nz('pink', 'bandpass', X(0, 0.5, 300, 900), 1.6, R(0, 0.5, 0.8, 0.04), b);
      dark(g, 0.5, 98, 0.9, 0.5, b);
      hollow(g, 0.5, 0.6, b, 90);
      whisper(g, 0.1, 0.85, 0.35);
    }, { lvl: LV.rel * 0.8, vary: 0.3 }),
    'ent.snare.loop': loop((g) => {
      // a low unsteady drone with voices in it
      const b = murk(g, 1400);
      const t = g.trem(0.5, 0.5), t2 = g.trem(1.5, 0.6);
      t.connect(b); t2.connect(b);
      g.tone('sawtooth', 65.5, 0.2, t);
      g.tone('sawtooth', 69.5, 0.14, t2);          // a minor second above, beating
      g.tone('triangle', 98, 0.12, t);
      g.nz('pink', 'bandpass', 320, 2.5, 0.5, t2);
      whisper(g, 0.5, 2.42, 0.42, undefined, 7);
    }, { range: 45, ref: 5, pri: 2.5, lvl: LV.loop * 0.95 }),
    'ent.snare.end': rel(0.7, (g) => { g.nz('pink', 'bandpass', 500, 2, P(0.6, 0.004, 0.08, 0.2)); }, { revLayer: { dur: 0.62, build: (g) => swellSrc(g, 0.62, 147, 600), gain: 5 }, lvl: LV.small * 1.2 }),
    // ---- Dusk Step
    'cs.duskstep': tell(0.19, (g) => { whisper(g, 0.02, 0.17, 0.2, undefined, 16); }, { revLayer: { dur: 0.19, build: (g) => swellSrc(g, 0.19, 233, 1300), gain: 3 } }),
    'cr.duskstep': rel(0.4, (g) => {
      const b = murk(g, 2400);
      g.nz('pink', 'bandpass', X(0, 0.3, 1800, 500), 1.6, P(0, 0.004, 0.32, 1), b);
      g.tone('sawtooth', X(0, 0.3, 147, 73), P(0, 0.005, 0.32, 0.25), b);
      whisper(g, 0, 0.36, 0.3, undefined, 12);
    }),
    'ent.shade.loop': loop((g) => {
      // something thrown that moans as it flies
      const b = murk(g, 2400);
      const t = g.trem(5.5, 0.6);
      t.connect(b);
      const o = g.osc('sawtooth', 147);
      g.lfo(5.5, 9).connect(o.frequency);
      g.pipe(t, o, g.bp(600, 3), g.gain(0.9));
      const o2 = g.osc('sawtooth', 220.5);
      g.pipe(t, o2, g.bp(900, 4), g.gain(0.5));
      g.nz('white', 'bandpass', 1900, 4, 0.7, t);
    }, { range: 55, ref: 4, lvl: LV.loop * 0.9 }),
    'ent.shade.hit': rel(0.45, (g) => {
      const b = murk(g, 2000);
      hollow(g, 0, 1, b, 130);
      dark(g, 0, 175, 0.6, 0.35, b);
      whisper(g, 0.02, 0.4, 0.3, undefined, 14);
    }, { pri: 3 }),
    'ent.shade.fade': small(0.5, (g) => {
      const b = murk(g, 2000);
      g.nz('pink', 'bandpass', X(0, 0.45, 1200, 350), 1.5, P(0, 0.01, 0.45, 1), b);
      whisper(g, 0, 0.45, 0.4);
    }),
    'tp.duskstep.out': rel(0.5, (g) => { g.nz('pink', 'bandpass', 400, 2, P(0.44, 0.003, 0.05, 0.15)); }, { revLayer: { dur: 0.45, build: (g) => swellSrc(g, 0.45, 165, 900), gain: 6 } }),
    'tp.duskstep.in': rel(0.7, (g) => {
      const b = murk(g, 2200);
      hollow(g, 0, 1, b, 104);
      dark(g, 0, 131, 0.7, 0.6, b);
      g.nz('pink', 'bandpass', X(0, 0.5, 1500, 300), 1.3, P(0, 0.004, 0.5, 0.7), b);
      whisper(g, 0.05, 0.65, 0.35, undefined, 10);
    }, { lvl: LV.hit, pri: 3 }),
    // ---- Shadowmeld
    'cs.shadowmeld': tell(0.1, (g) => {
      const b = murk(g, 1800);
      g.nz('pink', 'bandpass', X(0, 0.09, 1400, 500), 2, P(0, 0.004, 0.09, 1), b);
    }, { lvl: LV.small * 0.8 }),
    'cr.shadowmeld': rel(0.95, (g) => {
      // the world's sound closing over someone: an inhale that ends in near-silence
      whisper(g, 0.3, 0.9, 0.25, undefined, 9);
      g.nz('pink', 'lowpass', X(0.4, 0.5, 900, 200), 1, P(0.42, 0.01, 0.45, 0.4));
    }, { revLayer: { dur: 0.45, build: (g) => swellSrc(g, 0.45, 110, 700), gain: 2.5 }, lvl: LV.small * 1.3, range: 45 }),
    // ---- hit layers
    'hit.umbra.l': hitLight(0.34, (g) => {
      const b = murk(g, 2400);
      hollow(g, 0, 1, b, 160);
      g.click(0, 1700, 0.7, b, 0.008, 2);
      whisper(g, 0.03, 0.3, 0.25, undefined, 14);
    }),
    'hit.umbra.h': hitHeavy(0.85, (g) => {
      const b = murk(g, 2000);
      hollow(g, 0, 1.1, b, 100);
      dark(g, 0, 123, 0.8, 0.7, b);
      g.nz('pink', 'bandpass', X(0, 0.6, 1400, 260), 1.4, P(0, 0.003, 0.6, 0.8), b);
      whisper(g, 0.05, 0.8, 0.35, undefined, 10);
    }),
    'hit.umbra.t': hitTick(0.16, (g) => {
      const b = murk(g, 1800);
      g.nz('pink', 'bandpass', 700, 3, P(0, 0.003, 0.12, 1), b);
      g.tone('triangle', 196, P(0, 0.002, 0.1, 0.2), b);
    }),
    // a second, deeper toll used under the biggest shadow moments (backstabs land with it)
    'hit.umbra.backstab': big(0.9, (g) => {
      const b = murk(g, 1800);
      hollow(g, 0, 1.1, b, 88);
      dark(g, 0, 82, 1, 0.8, b);
      g.nz('white', 'bandpass', X(0, 0.1, 3000, 900), 2, P(0, 0.002, 0.1, 0.5), b);
    }, { lvl: LV.hitHeavy, ref: 8, range: 100 }),
  };
}
