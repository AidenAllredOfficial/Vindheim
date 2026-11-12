// The mix: buses, reverb sends, ducking and the master chain. Built against any
// BaseAudioContext so the offline analysis runs through exactly the same processing.
//
//   world (positional sfx) ┐
//   local (2D sfx) ────────┴► sfx ──┬──────────────────────────► duck ─► pre ─► comp ─► trim ─► limiter ─► master ─► out
//                                   ├► hall send ─► hall IR ─┐    ▲       ▲
//                                   └► air send ──► air IR ──┴────┤       │
//   ambience ─────────────────────────────────────────────────────┤       │
//   music ─────────────────────────────────────────────────────────┤       │
//   music wet ─► hall IR ───────────────────────────────────────────┘       │
//   ui, stingers ────────────────────────────────────────────────────────────┘   (never ducked)

import { makeImpulse, shaperCurve, clamp, clamp01 } from './dsp';

/**
 * Static bus trims, set from the offline loudness measurements. They define the mix as heard at
 * the DEFAULT volume settings; the sliders then scale each bus relative to that.
 */
export const TRIM = { music: 0.58, sfx: 0.8, amb: 0.3, ui: 0.32, sting: 0.75, post: 1.25 };
const HALL_SEND = 0.42, AIR_SEND = 0.26;

// Every node of the mix is pinned to two channels. Left to themselves, nodes follow their input
// (mono until the first panned voice or reverb tail arrives), and a compressor or convolver whose
// channel count changes is rebuilt from scratch mid-stream: the compressors then clamp down for
// 200 ms and the reverbs drop their tails.
const stereoize = <T extends AudioNode>(n: T): T => { n.channelCount = 2; n.channelCountMode = 'explicit'; n.channelInterpretation = 'speakers'; return n; };

/** The dynamics section of the master chain: glue compressor into a fast limiter. */
function dynamics(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const glue = stereoize(ctx.createDynamicsCompressor());
  glue.threshold.value = -12; glue.knee.value = 10; glue.ratio.value = 2.5; glue.attack.value = 0.012; glue.release.value = 0.25;
  const limiter = stereoize(ctx.createDynamicsCompressor());
  limiter.threshold.value = -4; limiter.knee.value = 2; limiter.ratio.value = 16; limiter.attack.value = 0.002; limiter.release.value = 0.09;
  glue.connect(limiter);
  return { input: glue, output: limiter };
}

// Browsers apply their own make-up gain inside DynamicsCompressorNode, and not all the same
// amount. Rather than guess, measure what the dynamics section does to a quiet signal on this
// browser and cancel it, so the chain is exactly unity below the threshold everywhere.
let chainGain = 1;
let calibration: Promise<number> | null = null;
export function calibrateChain(): Promise<number> {
  return (calibration ??= (async () => {
    try {
      const sr = 32000, ctx = new OfflineAudioContext(1, sr * 0.6, sr);
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const lvl = ctx.createGain();
      lvl.gain.value = 0.02;
      const dyn = dynamics(ctx);
      osc.connect(lvl); lvl.connect(dyn.input); dyn.output.connect(ctx.destination);
      osc.start();
      const d = (await ctx.startRendering()).getChannelData(0);
      let s = 0;
      const from = Math.floor(sr * 0.35);
      for (let i = from; i < d.length; i++) s += d[i] * d[i];
      const out = Math.sqrt(s / (d.length - from)), expect = 0.02 / Math.SQRT2;
      if (out > 1e-5) chainGain = clamp(out / expect, 0.25, 4);
    } catch { /* keep unity */ }
    return chainGain;
  })());
}

export interface Mix {
  ctx: BaseAudioContext;
  /** Positional world sounds. */
  world: GainNode;
  /** Non-positional gameplay sounds (the local player's own). */
  local: GainNode;
  ambience: GainNode;
  music: GainNode;
  /** Input for the score's reverb sends. */
  musicWet: GainNode;
  ui: GainNode;
  stinger: GainNode;
  master: GainNode;
  analyser: AnalyserNode | null;
  /** Cross-fade the reverbs: 0 open mountain air .. 1 deep in the timber hall. */
  setIndoors(v: number, t: number): void;
  /**
   * Volumes as gains relative to the designed mix (1 = as designed). `master` drives the whole mix
   * INTO the limiter, so turning it up can never clip the output.
   */
  setVolumes(v: { master: number; music: number; sfx: number; ambience: number }, t: number): void;
  /** Fade the output out / in (tab hidden). */
  setMuted(muted: boolean, t: number): void;
  /** Momentary low-pass and dip of everything but UI and stingers. `at` defaults to now. */
  duck(seconds: number, depth: number, at?: number): void;
}

export function buildMix(ctx: BaseAudioContext, dest: AudioNode, withAnalyser = false): Mix {
  const gain = (v = 1): GainNode => { const g = stereoize(ctx.createGain()); g.gain.value = v; return g; };

  // ---- master chain: a gentle glue compressor, a fast limiter, and a soft clipper as the last
  // line of defence (it is transparent below 0.72 and can never exceed full scale)
  const master = gain(1);
  const clip = stereoize(ctx.createWaveShaper());
  clip.curve = shaperCurve('soft', 0.72) as Float32Array<ArrayBuffer>;
  const post = gain(TRIM.post / chainGain);
  void calibrateChain().then((k) => { post.gain.value = TRIM.post / k; });
  const dyn = dynamics(ctx);
  const pre = gain(1);
  pre.connect(dyn.input); dyn.output.connect(post); post.connect(clip); clip.connect(master); master.connect(dest);
  // A compressor that has never processed signal starts fully clamped down and takes ~200 ms to
  // open (in Firefox it does not even start running until the first non-silent block arrives, so
  // the first sound after start-up would be crushed by 12 dB). Keep the chain awake from the first
  // sample with a tone 120 dB below full scale.
  const awake = ctx.createOscillator();
  awake.frequency.value = 30;
  const awakeLevel = gain(1e-6);
  awake.connect(awakeLevel); awakeLevel.connect(pre);
  awake.start();
  let analyser: AnalyserNode | null = null;
  if (withAnalyser) {
    analyser = stereoize(ctx.createAnalyser());
    analyser.fftSize = 2048;
    master.connect(analyser);
  }

  // ---- duck stage
  const open = Math.min(20000, ctx.sampleRate * 0.45);
  const duckLP = stereoize(ctx.createBiquadFilter());
  duckLP.type = 'lowpass'; duckLP.frequency.value = open; duckLP.Q.value = 0.5;
  const duckGain = gain(1);
  duckLP.connect(duckGain); duckGain.connect(pre);

  // ---- reverbs
  const hallIR = stereoize(ctx.createConvolver());
  hallIR.buffer = makeImpulse('hall', ctx.sampleRate);
  const airIR = stereoize(ctx.createConvolver());
  airIR.buffer = makeImpulse('air', ctx.sampleRate);
  const reverbReturn = gain(1);
  hallIR.connect(reverbReturn); airIR.connect(reverbReturn); reverbReturn.connect(duckLP);

  // ---- buses
  const sfx = gain(TRIM.sfx), world = gain(1), local = gain(1);
  // A source exactly to one side would be silent in the other ear with equal-power panning, which
  // is tiring on headphones: bleed a little of each side into the other (caps the level difference
  // between the ears at ~13 dB, about what a real head does).
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  const stereo = gain(1);
  world.connect(stereo); stereo.connect(split);
  const bleed = 0.22;
  for (let c = 0; c < 2; c++) {
    split.connect(merge, c, c);
    const x = gain(bleed);
    split.connect(x, c); x.connect(merge, 0, 1 - c);
  }
  merge.connect(sfx); local.connect(sfx); sfx.connect(duckLP);
  const hallSend = gain(0), airSend = gain(AIR_SEND);
  sfx.connect(hallSend); hallSend.connect(hallIR);
  sfx.connect(airSend); airSend.connect(airIR);

  const ambience = gain(TRIM.amb);
  ambience.connect(duckLP);

  const music = gain(TRIM.music), musicWet = gain(TRIM.music);
  music.connect(duckLP);
  musicWet.connect(hallIR);

  const ui = gain(TRIM.ui), stinger = gain(TRIM.sting);
  ui.connect(pre); stinger.connect(pre);

  return {
    ctx, world, local, ambience, music, musicWet, ui, stinger, master, analyser,
    setIndoors(v, t) {
      v = clamp01(v);
      hallSend.gain.setTargetAtTime(HALL_SEND * v, t, 0.25);
      airSend.gain.setTargetAtTime(AIR_SEND * (1 - v), t, 0.25);
    },
    setVolumes(v, t) {
      pre.gain.setTargetAtTime(v.master, t, 0.04);
      music.gain.setTargetAtTime(TRIM.music * v.music, t, 0.04);
      musicWet.gain.setTargetAtTime(TRIM.music * v.music, t, 0.04);
      sfx.gain.setTargetAtTime(TRIM.sfx * v.sfx, t, 0.04);
      ui.gain.setTargetAtTime(TRIM.ui * v.sfx, t, 0.04);
      stinger.gain.setTargetAtTime(TRIM.sting * v.sfx, t, 0.04);
      ambience.gain.setTargetAtTime(TRIM.amb * v.ambience, t, 0.04);
    },
    setMuted(muted, t) {
      master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.05);
    },
    duck(seconds, depth, at) {
      depth = clamp01(depth);
      if (seconds <= 0 || depth <= 0) return;
      const now = at ?? ctx.currentTime, hold = seconds * 0.5, rel = Math.max(0.03, seconds * 0.22);
      const f = open * Math.pow(380 / open, depth), g = 1 - 0.5 * depth;
      for (const [p, v, rest] of [[duckLP.frequency, f, open], [duckGain.gain, g, 1]] as [AudioParam, number, number][]) {
        p.cancelScheduledValues(now);
        p.setTargetAtTime(v, now, 0.012);
        p.setTargetAtTime(rest, now + 0.03 + hold, rel);
      }
    },
  };
}

// ----------------------------------------------------------------------------------------------
// Spatial voice pieces (shared by the live engine and the offline spatial tests)
// ----------------------------------------------------------------------------------------------

/** Air absorbs the top end: gentle for most sounds, stronger for heavy impacts (a far rumble). */
export function distanceCutoff(d: number, heavy: boolean): number {
  return clamp(22000 * Math.exp(-d / (heavy ? 26 : 48)), heavy ? 480 : 1400, 20000);
}
/** Beyond this distance a positional voice gets a low-pass at all. */
export const LOWPASS_FROM = 14;

/** Level of a source at distance d for a given reference distance (the panner's inverse law). */
export const distanceGain = (d: number, ref: number): number => ref / (ref + Math.max(0, d - ref));

/** Equal-power panner with inverse distance roll-off, sized for a ~125 m arena. */
export function makePanner(ctx: BaseAudioContext, pos: { x: number; y: number; z: number }, ref: number): PannerNode {
  const pan = ctx.createPanner();
  pan.panningModel = 'equalpower';
  pan.distanceModel = 'inverse';
  pan.refDistance = ref;
  pan.rolloffFactor = 1;
  pan.maxDistance = 10000;
  if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; }
  else (pan as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
  return pan;
}
