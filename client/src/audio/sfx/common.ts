// Shared building blocks and loudness classes for the sound-effect recipes.

import { G, P, S } from '../kit';
import type { SoundDef, LoopSpec } from '../bank';
import type { NoiseKind } from '../dsp';

/** Loudness targets (loudest 60 ms RMS; overall RMS for loops). */
export const LV = { tick: 0.07, foot: 0.04, ui: 0.085, small: 0.11, tell: 0.16, loop: 0.1, rel: 0.19, hit: 0.2, hitHeavy: 0.26, big: 0.3, huge: 0.34 };

type Build = (g: G) => void;
type Extra = Partial<SoundDef>;

/** A wind-up tell: must carry, must be short. */
export const tell = (dur: number, build: Build, x: Extra = {}): SoundDef => ({ dur, build, lvl: LV.tell, ref: 9, range: 75, pri: 3, vary: 0.35, ...x });
/** A release / launch / swing. */
export const rel = (dur: number, build: Build, x: Extra = {}): SoundDef => ({ dur, build, lvl: LV.rel, ref: 6, range: 80, pri: 2, vary: 0.6, ...x });
/** A heavy area impact heard across the island. */
export const big = (dur: number, build: Build, x: Extra = {}): SoundDef => ({ dur, build, lvl: LV.big, ref: 8, range: 150, pri: 4, heavy: true, vary: 0.5, ...x });
/** A minor detail sound. */
export const small = (dur: number, build: Build, x: Extra = {}): SoundDef => ({ dur, build, lvl: LV.small, ref: 4, range: 48, pri: 1, vary: 1.2, ...x });
/** A seamless loop (2 s unless stated; keep modulation rates at multiples of 1/dur). */
export const loop = (build: Build, x: Extra = {}, dur = 2, spec: LoopSpec = {}): SoundDef => ({ dur, build, lvl: LV.loop, loop: { pre: 0.5, xf: 0.03, law: 'lin', ...spec }, ref: 5, range: 55, pri: 2, ...x });
/** Element layer of a hit. */
export const hitLight = (dur: number, build: Build, x: Extra = {}): SoundDef => ({ dur, build, lvl: LV.hit, ref: 6, range: 75, pri: 3, vary: 1, ...x });
export const hitHeavy = (dur: number, build: Build, x: Extra = {}): SoundDef => ({ dur, build, lvl: LV.hitHeavy, ref: 8, range: 110, pri: 4, heavy: true, vary: 0.8, ...x });
export const hitTick = (dur: number, build: Build, x: Extra = {}): SoundDef => ({ dur, build, lvl: LV.tick, ref: 4, range: 35, pri: 0.5, vary: 1.5, ...x });

/** Band-passed noise sweeping f[0] -> f[1] (at `pos`) -> f[2] under a swell. */
export function whoosh(g: G, at: number, dur: number, f: [number, number, number], gain = 1, q = 1.3, dest?: AudioNode, pos = 0.5, kind: NoiseKind = 'white'): void {
  g.nz(kind, 'bandpass', [[at, f[0]], [at + dur * pos, f[1], 'e'], [at + dur, f[2], 'e']], q, S(at, dur, gain, pos), dest);
}

/** Low brown-noise rumble under a swell. */
export function rumble(g: G, at: number, dur: number, f: number, gain = 1, dest?: AudioNode, pos = 0.15): void {
  g.nz('brown', 'lowpass', f, 0.7, S(at, dur, gain, pos), dest);
}

/** Sine thump plus a burst of low noise: the body of an explosion or a heavy landing. */
export function boom(g: G, at: number, f0: number, f1: number, dur: number, gain = 1, dest?: AudioNode): void {
  g.thump(at, f0, f1, dur, gain, dest);
  g.nz('brown', 'lowpass', f0 * 2.4, 0.7, P(at, 0.004, dur * 0.8, gain * 0.8), dest);
}

/** Tumbling chunks: thunky, irregular, thinning out. */
export function debris(g: G, from: number, to: number, n: number, f: [number, number], gain = 1, dest?: AudioNode, bias = 1.7): void {
  g.ticks({ n, from, to, f, q: 1.4, len: [0.012, 0.06], g: gain, bias, groups: 3, dest, kind: 'pink' });
}
