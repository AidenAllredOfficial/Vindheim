// The sound bank: every one-shot, loop and instrument sample in the game is described by a
// SoundDef (a graph-building recipe), rendered once through an OfflineAudioContext, levelled
// numerically and cached as an AudioBuffer. Playing a sound live is then just a buffer source.
//
// Sounds are registered in named groups; a group is rendered in a few offline contexts, each
// holding several sounds laid end to end on one timeline and sliced apart afterwards.

import { G } from './kit';
import { Rng, SR, hashStr, makeBuffer, peakOf, rmsOf, shortTermRms, seamLoop, removeDc } from './dsp';

export interface LoopSpec {
  /** Run-in rendered before the loop region so filters and envelopes have settled (seconds). */
  pre?: number;
  /** Cross-fade length at the seam (seconds). */
  xf?: number;
  /** 'lin' for periodic (correlated) material, 'pow' for free-running noise. */
  law?: 'lin' | 'pow';
  /** Keep the run-in in the buffer as an attack; the loop region starts after it (instrument samples). */
  keepPre?: boolean;
}

export interface SoundDef {
  /** Length in seconds (for loops: the length of the loop region). */
  dur: number;
  /** Build the Web Audio graph for the sound. */
  build?: (g: G) => void;
  /** Or: synthesise it directly in JS. */
  js?: (sr: number, rng: Rng) => Float32Array;
  /** Target loudness: the loudest 60 ms RMS for one-shots, overall RMS for loops. */
  lvl?: number;
  loop?: LoopSpec | true;
  /** Play the rendered sound backwards. */
  reverse?: boolean;
  /** An extra layer rendered separately, reversed, and mixed in so that it ENDS at `end` seconds. */
  revLayer?: { dur: number; build: (g: G) => void; end?: number; gain?: number };
  /** Fade at the end of the slot (default 12 ms). */
  fadeOut?: number;
  /** Fundamental frequency actually rendered (instrument samples; the player retunes from it). */
  hz?: number;

  // ---- playback hints used by the engine
  /** Do not play at all beyond this distance (metres). */
  range?: number;
  /** Distance at which the sound is at full level. */
  ref?: number;
  /** Voice priority (higher survives stealing). */
  pri?: number;
  /** Random pitch variation in semitones (+-). */
  vary?: number;
  /** Heavy impact: gets a stronger distance low-pass. */
  heavy?: boolean;
}

export interface Sound {
  key: string;
  def: SoundDef;
  buffer: AudioBuffer;
  /** Loop points in seconds (loops only). */
  loopStart: number;
  loopEnd: number;
  isLoop: boolean;
  peak: number;
  rms: number;
}

export type DefMap = Record<string, SoundDef>;

interface Slot { key: string; def: SoundDef; start: number; len: number; rev: boolean; build?: (g: G) => void }

const MAX_CHUNK_SECONDS = 7;
const MAX_CHUNK_SOUNDS = 10;
const GAP = 0.04;

function loopSpec(def: SoundDef): Required<LoopSpec> | null {
  if (!def.loop) return null;
  const l = def.loop === true ? {} : def.loop;
  return { pre: l.pre ?? 0.5, xf: l.xf ?? 0.03, law: l.law ?? 'lin', keepPre: l.keepPre ?? false };
}

async function renderChunk(slots: Slot[], total: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(total * SR), SR);
  for (const s of slots) {
    if (!s.build) continue;
    const loop = !s.rev && !!s.def.loop;
    const master = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 22; hp.Q.value = 0.5;
    hp.connect(master); master.connect(ctx.destination);
    if (!loop) {
      const fade = Math.min(s.def.fadeOut ?? 0.012, s.len * 0.5);
      master.gain.setValueAtTime(1, s.start + s.len - fade);
      master.gain.linearRampToValueAtTime(0, s.start + s.len);
    } else {
      master.gain.setValueAtTime(1, s.start + s.len);
      master.gain.linearRampToValueAtTime(0, s.start + s.len + 0.004);
    }
    s.build(new G(ctx, hp, s.start, s.len, new Rng(hashStr(s.key + (s.rev ? '~' : '')))));
  }
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

function finish(key: string, def: SoundDef, data: Float32Array): Sound {
  const ls = loopSpec(def);
  let loopStart = 0, loopEnd = 0;
  if (ls) {
    const pre = Math.round(ls.pre * SR), len = Math.round(def.dur * SR);
    seamLoop(data, pre, len, Math.round(ls.xf * SR), ls.law);
    if (ls.keepPre) {
      data = data.slice(0, pre + len);
      loopStart = pre / SR; loopEnd = (pre + len) / SR;
      // soften the very start of the attack
      const a = Math.min(64, pre);
      for (let i = 0; i < a; i++) data[i] *= i / a;
    } else {
      data = data.slice(pre, pre + len);
      loopStart = 0; loopEnd = len / SR;
    }
  } else {
    removeDc(data);
    if (def.reverse) data.reverse();
    // guarantee click-free edges whatever the recipe did
    const a = Math.min(48, data.length >> 2), r = Math.min(Math.round(0.006 * SR), data.length >> 2);
    for (let i = 0; i < a; i++) data[i] *= i / a;
    for (let i = 0; i < r; i++) data[data.length - 1 - i] *= i / r;
  }
  // level: aim for the target loudness. A sound whose transient would overshoot full scale is
  // not turned down as a whole (that would leave its body far too quiet); instead up to 9 dB of
  // the spike is rounded off by a soft clipper, which on a few milliseconds of attack is inaudible.
  const target = def.lvl ?? 0.2;
  const loud = ls ? rmsOf(data, Math.round(loopStart * SR)) : shortTermRms(data, SR);
  const peak = peakOf(data);
  let k = loud > 1e-7 ? target / loud : 1;
  const limit = 0.97 / (peak || 1);
  if (k > limit) k = ls ? limit : Math.min(k, limit * 2.8);
  const KNEE = 0.62, CEIL = 0.97, span = CEIL - KNEE;
  for (let i = 0; i < data.length; i++) {
    let x = data[i] * k;
    const ax = x < 0 ? -x : x;
    if (ax > KNEE && !ls) x = (x < 0 ? -1 : 1) * (KNEE + span * Math.tanh((ax - KNEE) / span));
    data[i] = x;
  }
  const outPeak = peakOf(data);
  return { key, def, buffer: makeBuffer([data]), loopStart, loopEnd, isLoop: !!ls, peak: outPeak, rms: rmsOf(data) };
}

/** Render a set of definitions. Exposed for the analysis harness. */
export async function renderDefs(defs: DefMap): Promise<Map<string, Sound>> {
  const out = new Map<string, Sound>();
  const raw = new Map<string, Float32Array>();
  const revRaw = new Map<string, Float32Array>();
  let slots: Slot[] = [], t = 0.02;

  const flush = async () => {
    if (!slots.length) return;
    const data = await renderChunk(slots, t + 0.02);
    for (const s of slots) {
      const i0 = Math.round(s.start * SR), n = Math.round(s.len * SR);
      (s.rev ? revRaw : raw).set(s.key, data.slice(i0, i0 + n));
    }
    slots = []; t = 0.02;
  };
  const add = async (s: Slot) => {
    if (slots.length && (t + s.len > MAX_CHUNK_SECONDS || slots.length >= MAX_CHUNK_SOUNDS)) await flush();
    s.start = t;
    slots.push(s);
    t += s.len + GAP + (s.def.loop && !s.rev ? 0.01 : 0);
  };

  for (const key of Object.keys(defs)) {
    const def = defs[key];
    if (def.js) {
      raw.set(key, def.js(SR, new Rng(hashStr(key))));
    } else {
      const ls = loopSpec(def);
      await add({ key, def, start: 0, len: def.dur + (ls ? ls.pre : 0), rev: false, build: def.build });
    }
    if (def.revLayer) await add({ key, def, start: 0, len: def.revLayer.dur, rev: true, build: def.revLayer.build });
  }
  await flush();

  for (const key of Object.keys(defs)) {
    const def = defs[key];
    let data = raw.get(key)!;
    const rv = def.revLayer && revRaw.get(key);
    if (def.revLayer && rv) {
      rv.reverse();
      // close the (now leading) edge of the reversed layer
      const r = Math.min(Math.round(0.004 * SR), rv.length >> 1);
      for (let i = 0; i < r; i++) rv[rv.length - 1 - i] *= i / r;
      const end = Math.round((def.revLayer.end ?? def.revLayer.dur) * SR), start = end - rv.length, gn = def.revLayer.gain ?? 1;
      const pk = peakOf(data) || 1, rpk = peakOf(rv) || 1, scale = gn * pk / rpk;
      if (start < 0) { const grown = new Float32Array(data.length - start); grown.set(data, -start); data = grown; }
      const off = Math.max(0, start);
      if (off + rv.length > data.length) { const grown = new Float32Array(off + rv.length); grown.set(data); data = grown; }
      for (let i = 0; i < rv.length; i++) data[off + i] += rv[i] * scale;
    }
    out.set(key, finish(key, def, data));
  }
  return out;
}

type Factory = () => DefMap;

/** Lazily rendered, de-duplicated store of every sound in the game. */
export class SoundBank {
  private factories = new Map<string, Factory>();
  private defs = new Map<string, DefMap>();
  private loading = new Map<string, Promise<void>>();
  private loaded = new Set<string>();
  private keyGroup = new Map<string, string>();
  private chain: Promise<void> = Promise.resolve();
  readonly sounds = new Map<string, Sound>();
  /** Milliseconds each group took to render (diagnostics). */
  readonly timings: Record<string, number> = {};

  register(group: string, factory: Factory): void {
    if (!this.factories.has(group)) this.factories.set(group, factory);
  }
  groups(): string[] { return [...this.factories.keys()]; }
  isLoaded(group: string): boolean { return this.loaded.has(group); }

  defsOf(group: string): DefMap {
    let d = this.defs.get(group);
    if (!d) {
      const f = this.factories.get(group);
      if (!f) throw new Error('unknown sound group ' + group);
      d = f();
      this.defs.set(group, d);
      for (const k of Object.keys(d)) this.keyGroup.set(k, group);
    }
    return d;
  }

  /** Which group defines a key (only known once the group's defs were instantiated). */
  groupOf(key: string): string | undefined { return this.keyGroup.get(key); }

  /** Render a group (once). Renders are serialised so the device is never flooded. */
  load(group: string): Promise<void> {
    let p = this.loading.get(group);
    if (p) return p;
    p = this.chain.then(async () => {
      const t = performance.now();
      const defs = this.defsOf(group);
      const res = await renderDefs(defs);
      for (const [k, s] of res) this.sounds.set(k, s);
      this.loaded.add(group);
      this.timings[group] = Math.round(performance.now() - t);
    });
    this.loading.set(group, p);
    this.chain = p.catch((e) => { console.error('[audio] failed to render sound group', group, e); });
    return p;
  }

  async loadAll(order: string[]): Promise<void> {
    for (const g of order) await this.load(g);
  }

  get(key: string): Sound | undefined { return this.sounds.get(key); }
  has(key: string): boolean { return this.sounds.has(key); }
}
