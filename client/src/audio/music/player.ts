// Plays the conductor's notes on the sampled instruments. Works against any BaseAudioContext,
// so the same score can be performed live or rendered offline for analysis.
//
// Signal path:  note (buffer source -> gain) -> channel (level, pan, reverb send)
//               -> layer bus -> scene bus -> output

import type { SoundBank } from '../bank';
import { midiHz } from '../dsp';
import { INSTRUMENTS, sampleKey, type InstrName } from './instruments';

export type SceneName = 'title' | 'hall' | 'arena' | 'results';

/** Where a note is played: which scene / layer bus, and the instrument's seat in the stereo field. */
export interface Chan {
  scene: SceneName;
  layer: string;
  name: string;
  /** Channel level. */
  gain: number;
  /** -1 left .. 1 right. */
  pan: number;
  /** Reverb send 0..1. */
  send: number;
}

export interface NoteOpts {
  /** Attack and release in seconds (sustained instruments). */
  a?: number;
  r?: number;
  /** Fine tuning in cents. */
  cents?: number;
}

/** What the conductor needs from a performer. */
export interface MusicSink {
  note(ch: Chan, instr: InstrName, midi: number, t: number, dur: number, vel: number, o?: NoteOpts): void;
  /** One-shot sample by key (percussion, swells). `offset` starts part-way through. */
  hit(ch: Chan, key: string, t: number, vel: number, o?: { rate?: number; offset?: number }): void;
  setLayer(scene: SceneName, layer: string, value: number, t: number, tau: number): void;
  setScene(scene: SceneName, value: number, t: number, tau: number): void;
}

interface Bus { dry: GainNode; wet: GainNode | null }

export class MusicPlayer implements MusicSink {
  private readonly ctx: BaseAudioContext;
  private readonly bank: SoundBank;
  private readonly out: AudioNode;
  private readonly reverb: AudioNode | null;
  private scenes = new Map<string, Bus>();
  private layers = new Map<string, Bus>();
  private chans = new Map<string, GainNode>();
  private live = new Set<AudioBufferSourceNode>();
  /** Notes currently sounding (diagnostics / CPU budget checks). */
  get voices(): number { return this.live.size; }
  /** Total notes started. */
  started = 0;

  private readonly maxVoices: number;
  /** Ringing one-shots (drums, plucks, short strokes), oldest first: the first to go when over budget. */
  private ringing: { src: AudioBufferSourceNode; g: GainNode; at: number }[] = [];

  /** `maxVoices` caps simultaneous notes on a live context (0 = unlimited, for offline rendering). */
  constructor(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode, reverb: AudioNode | null, maxVoices = 0) {
    this.ctx = ctx; this.bank = bank; this.out = out; this.reverb = reverb; this.maxVoices = maxVoices;
  }

  // Every fader exists twice, dry and wet, so reverb sends follow the layer and scene levels.
  private bus(value: number, dryTo: AudioNode, wetTo: AudioNode | null): Bus {
    const dry = this.ctx.createGain();
    dry.gain.value = value;
    dry.connect(dryTo);
    let wet: GainNode | null = null;
    if (wetTo) {
      wet = this.ctx.createGain();
      wet.gain.value = value;
      wet.connect(wetTo);
    }
    return { dry, wet };
  }

  private sceneBus(scene: SceneName): Bus {
    let b = this.scenes.get(scene);
    if (!b) { b = this.bus(0, this.out, this.reverb); this.scenes.set(scene, b); }
    return b;
  }

  private layerBus(scene: SceneName, layer: string): Bus {
    const key = scene + '/' + layer;
    let b = this.layers.get(key);
    if (!b) {
      const sb = this.sceneBus(scene);
      b = this.bus(scene === 'arena' ? 0 : 1, sb.dry, sb.wet); // arena layers are faded in by the conductor
      this.layers.set(key, b);
    }
    return b;
  }

  private chan(ch: Chan): GainNode {
    const key = ch.scene + '/' + ch.layer + '/' + ch.name;
    let input = this.chans.get(key);
    if (!input) {
      input = this.ctx.createGain();
      input.gain.value = ch.gain;
      const lb = this.layerBus(ch.scene, ch.layer);
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = ch.pan;
      input.connect(pan);
      pan.connect(lb.dry);
      if (lb.wet && ch.send > 0) {
        const send = this.ctx.createGain();
        send.gain.value = ch.send;
        pan.connect(send);
        send.connect(lb.wet);
      }
      this.chans.set(key, input);
    }
    return input;
  }

  private fade(b: Bus, value: number, t: number, tau: number): void {
    b.dry.gain.setTargetAtTime(value, t, tau);
    if (b.wet) b.wet.gain.setTargetAtTime(value, t, tau);
  }

  setLayer(scene: SceneName, layer: string, value: number, t: number, tau: number): void {
    this.fade(this.layerBus(scene, layer), value, t, tau);
  }

  setScene(scene: SceneName, value: number, t: number, tau: number): void {
    this.fade(this.sceneBus(scene), value, t, tau);
  }

  private track(src: AudioBufferSourceNode, g: GainNode, at: number, oneShot: boolean): void {
    this.live.add(src);
    this.started++;
    src.onended = () => { this.live.delete(src); src.disconnect(); g.disconnect(); };
    if (!this.maxVoices) return;
    if (oneShot) this.ringing.push({ src, g, at });
    // over budget: let go of the oldest tails (never a note whose attack is still sounding)
    const now = this.ctx.currentTime;
    while (this.live.size > this.maxVoices && this.ringing.length) {
      const v = this.ringing[0];
      if (!this.live.has(v.src)) { this.ringing.shift(); continue; }
      if (v.at > now - 0.14) break;
      this.ringing.shift();
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(0, now, 0.015);
      try { v.src.stop(now + 0.08); } catch { /* already stopped */ }
      this.live.delete(v.src);
    }
    if (this.ringing.length > 256) this.ringing = this.ringing.filter((v) => this.live.has(v.src));
  }

  note(ch: Chan, instr: InstrName, midi: number, t: number, dur: number, vel: number, o: NoteOpts = {}): void {
    const info = INSTRUMENTS[instr];
    let root = info.roots[0], best = 1e9;
    for (const r of info.roots) { const d = Math.abs(r - midi); if (d < best) { best = d; root = r; } }
    const s = this.bank.get(sampleKey(instr, root));
    if (!s || vel <= 0.001) return;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = (midiHz(midi) * Math.pow(2, (o.cents ?? 0) / 1200)) / (s.def.hz ?? midiHz(root));
    const g = this.ctx.createGain();
    src.connect(g); g.connect(this.chan(ch));
    t = Math.max(t, this.ctx.currentTime);
    if (info.sustained) {
      const a = Math.min(o.a ?? 0.06, dur * 0.8), r = o.r ?? 0.2;
      src.loop = true;
      src.loopStart = s.loopStart;
      src.loopEnd = s.loopEnd;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + a);
      g.gain.setValueAtTime(vel, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + r);
      // slow entries skip the sample's own attack and start somewhere inside the loop,
      // which also keeps repeated notes from sounding identical
      const offset = a > 0.25 ? s.loopStart + ((midi * 0.37 + t * 0.61) % 1) * (s.loopEnd - s.loopStart) * 0.9 : 0;
      src.start(t, offset);
      src.stop(t + dur + r + 0.03);
    } else {
      g.gain.setValueAtTime(vel, t);
      const len = s.buffer.duration / src.playbackRate.value;
      if (dur > 0 && dur < len - 0.05) {
        // damp the string
        const r = o.r ?? 0.12;
        g.gain.setValueAtTime(vel, t + dur);
        g.gain.linearRampToValueAtTime(0, t + dur + r);
        src.start(t);
        src.stop(t + dur + r + 0.03);
      } else src.start(t);
    }
    this.track(src, g, t, !info.sustained);
  }

  hit(ch: Chan, key: string, t: number, vel: number, o: { rate?: number; offset?: number } = {}): void {
    const s = this.bank.get(key);
    if (!s || vel <= 0.001) return;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = this.ctx.createGain();
    g.gain.value = vel;
    src.connect(g); g.connect(this.chan(ch));
    t = Math.max(t, this.ctx.currentTime);
    src.start(t, Math.max(0, o.offset ?? 0));
    this.track(src, g, t, true);
  }

  /** Silence everything quickly (dispose / scene reset). */
  stopAll(): void {
    for (const s of this.live) { try { s.stop(); } catch { /* already stopped */ } }
    this.live.clear();
    this.ringing = [];
  }
}
