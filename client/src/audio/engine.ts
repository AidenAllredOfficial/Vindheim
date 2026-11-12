// The live audio engine: implements the AudioEngine contract on top of the pre-rendered sound
// bank, the mix graph, the ambience manager and the score.
//
// Nothing here creates an AudioContext until unlock() is called from a user gesture. Sounds are
// rendered by OfflineAudioContexts (which need no gesture) as soon as the engine exists, so by
// the time the player clicks, the interface, the title music and most of the combat bank are ready.

import type { AudioEngine, AudioPos, MusicState, UiSound } from '../contracts';
import type { World } from '@shared/world';
import type { Weather } from '@shared/weather';
import { ELEMENTS, type ElementId, type EntityKind } from '@shared/elements';
import type { EntityState, AnnounceKind } from '@shared/types';
import { settings, DEFAULT_SETTINGS, IS_TOUCH } from '../settings';
import { bank, GROUP_ORDER, ENTITY, FX, TELEPORT, TELEPORT_DEFAULT, type EntSpec } from './catalog';
import type { Sound } from './bank';
import { buildMix, calibrateChain, distanceCutoff, distanceGain, makePanner, LOWPASS_FROM, type Mix } from './mix';
import { Ambience, setPannerPos } from './ambience';
import { MusicPlayer } from './music/player';
import { Conductor } from './music/conductor';
import { SURFACES, STEP_VARIANTS, type SurfaceName } from './sfx/core';
import { clamp, clamp01, lerp, smoothstep } from './dsp';

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: PannerNode | null;
  lp: BiquadFilterNode | null;
  sound: Sound;
  /** Importance: voices with the lowest score are stolen first. */
  score: number;
  born: number;
  /** Base level (before any loop envelope). */
  level: number;
  loop: boolean;
  done: boolean;
}

interface EntLoop {
  /** Null while the entity is out of earshot or no voice could be spared; retried as it moves. */
  voice: Voice | null;
  kind: EntityKind;
  spec: EntSpec;
  x: number; y: number; z: number;
  born: number;
  life: number;
  rate: number;
  /** One-shot tied to the entity (a fuse) rather than a true loop. */
  fuse: boolean;
}

interface PlayOpts {
  pos?: AudioPos;
  /** The local player's own sound: centred, never culled, top priority. */
  local?: boolean;
  /** Positional, but it involves the local player: protect it from voice stealing. */
  boost?: boolean;
  gain?: number;
  rate?: number;
  delay?: number;
  bus?: 'world' | 'ui' | 'stinger' | 'ambience';
  /** Fixed low-pass (thunder). */
  lowpass?: number;
  loop?: boolean;
  /** Start part-way into the buffer (seconds). */
  offset?: number;
}

const MAX_VOICES = IS_TOUCH ? 22 : 36;
const MAX_ENT_LOOPS = IS_TOUCH ? 8 : 12;
const MAX_MUSIC_VOICES = IS_TOUCH ? 30 : 46;
const DEFAULT_RANGE = 80, DEFAULT_REF = 5;
/**
 * Volume sliders: a square-law (perceptual) curve, expressed relative to the slider's default
 * position — the mix is balanced for the default settings, and a slider at its default is unity.
 */
const vol = (v: number, dflt: number): number => { const x = clamp01(v) / (dflt > 0.05 ? dflt : 1); return x * x; };

export class Engine implements AudioEngine {
  unlocked = false;
  private ctx: AudioContext | null = null;
  private mix: Mix | null = null;
  private voices: Voice[] = [];
  private entLoops = new Map<number, EntLoop>();
  private ambience: Ambience | null = null;
  private player: MusicPlayer | null = null;
  private conductor: Conductor | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private musicState: MusicState = { scene: 'title', intensity: 0, danger: 0 };
  private lis = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 };
  private indoors = 0;
  private hidden = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private rr = 0;
  private lastStep = -1;
  private lpTick = 0;
  private lastPlay = new Map<string, number>();
  private endBurstAt = -1;
  private endBurst = 0;

  constructor(_world: World) {
    // Render the sound bank in the background right away (offline contexts need no gesture).
    for (const g of GROUP_ORDER) bank.defsOf(g);
    void bank.loadAll(GROUP_ORDER);
    void calibrateChain();
    this.unsubscribe = settings.subscribe((_s, changed) => {
      if (changed.some((k) => k === 'masterVolume' || k === 'musicVolume' || k === 'sfxVolume' || k === 'ambienceVolume' || k === 'muteWhenHidden')) this.applySettings();
    });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ==========================================================================================
  // lifecycle
  // ==========================================================================================

  unlock(): void {
    if (this.disposed) return;
    if (this.ctx) {
      if (this.ctx.state !== 'running' && !this.silenced()) void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.mix = buildMix(ctx, ctx.destination, true);
    this.unlocked = true;
    this.hidden = typeof document !== 'undefined' && document.hidden;
    this.applySettings();
    void ctx.resume();
    ctx.addEventListener('statechange', this.onState);

    this.ambience = new Ambience(ctx, bank, this.mix.ambience, (variant, pos) => { this.play(`amb.creak.${variant}`, { pos, bus: 'ambience' }); });
    this.player = new MusicPlayer(ctx, bank, this.mix.music, this.mix.musicWet, MAX_MUSIC_VOICES);
    this.conductor = new Conductor(this.player, (Date.now() ^ 0x5bd1e995) >>> 0);
    this.conductor.setState(this.musicState);
    void bank.load('music').then(() => {
      if (this.disposed || !this.conductor || !this.ctx) return;
      this.conductor.start(this.ctx.currentTime + 0.12);
      this.pump();
    });
    this.timer = setInterval(this.pump, 50);
  }

  /** Should the engine be silent right now (tab hidden and the player asked for that)? */
  private silenced(): boolean { return this.hidden && settings.get().muteWhenHidden; }

  private pump = (): void => {
    const ctx = this.ctx, c = this.conductor;
    if (!ctx || !c || ctx.state !== 'running') return;
    c.resync(ctx.currentTime);
    // background tabs only get a timer tick per second: schedule further ahead there
    c.advance(ctx.currentTime + (this.hidden ? 2.6 : 0.35), ctx.currentTime);
  };

  private onState = (): void => {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    // iOS interrupts contexts (calls, the lock screen): pick up again on the next touch
    if (ctx.state !== 'running' && !this.silenced()) {
      const again = (): void => { window.removeEventListener('pointerdown', again); window.removeEventListener('keydown', again); if (this.ctx && !this.silenced()) void this.ctx.resume(); };
      window.addEventListener('pointerdown', again, { once: true });
      window.addEventListener('keydown', again, { once: true });
    }
  };

  private onVisibility = (): void => {
    this.hidden = document.hidden;
    const ctx = this.ctx, mix = this.mix;
    if (!ctx || !mix) return;
    if (this.suspendTimer) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
    if (this.silenced()) {
      // fade out, then stop the clock entirely so nothing piles up while away
      mix.setMuted(true, ctx.currentTime);
      this.suspendTimer = setTimeout(() => { if (this.ctx && this.silenced()) void this.ctx.suspend(); }, 320);
    } else {
      void ctx.resume().then(() => {
        if (!this.ctx || !this.mix) return;
        this.conductor?.resync(this.ctx.currentTime);
        this.applySettings();
        this.pump();
      });
    }
  };

  applySettings(): void {
    const ctx = this.ctx, mix = this.mix;
    if (!ctx || !mix) return;
    const s = settings.get();
    const d = DEFAULT_SETTINGS;
    mix.setVolumes({ master: vol(s.masterVolume, d.masterVolume), music: vol(s.musicVolume, d.musicVolume), sfx: vol(s.sfxVolume, d.sfxVolume), ambience: vol(s.ambienceVolume, d.ambienceVolume) }, ctx.currentTime);
    mix.setMuted(this.silenced(), ctx.currentTime);
    if (!this.silenced() && ctx.state === 'suspended' && this.unlocked) void ctx.resume();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.unsubscribe?.();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    for (const v of this.voices) { try { v.src.stop(); } catch { /* never started */ } }
    this.voices = [];
    this.entLoops.clear();
    this.player?.stopAll();
    this.ambience?.dispose();
    if (this.ctx) { this.ctx.removeEventListener('statechange', this.onState); void this.ctx.close(); }
    this.ctx = null; this.mix = null; this.ambience = null; this.player = null; this.conductor = null;
    this.unlocked = false;
  }

  // ==========================================================================================
  // per frame
  // ==========================================================================================

  update(dt: number, listenerPos: AudioPos, listenerForward: AudioPos, weather: Weather, indoors: number): void {
    const L = this.lis;
    L.x = listenerPos.x; L.y = listenerPos.y; L.z = listenerPos.z;
    const fl = Math.hypot(listenerForward.x, listenerForward.y, listenerForward.z) || 1;
    L.fx = listenerForward.x / fl; L.fy = listenerForward.y / fl; L.fz = listenerForward.z / fl;
    this.indoors = clamp01(indoors);
    const ctx = this.ctx, mix = this.mix;
    if (!ctx || !mix || ctx.state !== 'running') return;
    const now = ctx.currentTime, al = ctx.listener;
    // keep the listener's up vector well-defined even when looking straight up or down
    const fy = clamp(L.fy, -0.98, 0.98);
    if (al.positionX) {
      al.positionX.setTargetAtTime(L.x, now, 0.02); al.positionY.setTargetAtTime(L.y, now, 0.02); al.positionZ.setTargetAtTime(L.z, now, 0.02);
      al.forwardX.setTargetAtTime(L.fx, now, 0.02); al.forwardY.setTargetAtTime(fy, now, 0.02); al.forwardZ.setTargetAtTime(L.fz, now, 0.02);
      al.upX.value = 0; al.upY.value = 1; al.upZ.value = 0;
    } else {
      const legacy = al as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void };
      legacy.setPosition(L.x, L.y, L.z);
      legacy.setOrientation(L.fx, fy, L.fz, 0, 1, 0);
    }
    mix.setIndoors(this.indoors, now);
    this.ambience?.update(dt, weather, this.indoors, listenerPos, listenerForward);

    // entity loops: range fade, charge swell, distance filter (the filter only every few frames)
    const doLp = (this.lpTick = (this.lpTick + 1) % 6) === 0;
    let sounding = 0;
    for (const e of this.entLoops.values()) if (e.voice && !e.voice.done) sounding++;
    for (const [id, e] of this.entLoops) {
      if (e.fuse) { if (!e.voice || e.voice.done) this.entLoops.delete(id); continue; }
      // forget entities whose despawn never reached us
      if (e.life > 0 && now - e.born > e.life + 6) { if (e.voice) this.stopVoice(e.voice, 0.1); this.entLoops.delete(id); continue; }
      const d = this.dist(e);
      if (e.voice && e.voice.done) e.voice = null;
      if (!e.voice) {
        // came into earshot (or a voice has become free): start its loop now
        if (doLp && sounding < MAX_ENT_LOOPS && e.spec.loop && !this.mergedAway(e, id)) {
          e.voice = this.play(e.spec.loop, { pos: e, loop: true, gain: e.spec.loopGain ?? 1, rate: e.spec.loopRate ?? 1 });
          if (e.voice) { e.rate = e.voice.src.playbackRate.value; sounding++; }
        }
        continue;
      }
      const v = e.voice;
      const range = v.sound.def.range ?? DEFAULT_RANGE;
      if (d > range * 1.15) { this.stopVoice(v, 0.1); e.voice = null; continue; }
      let g = v.level * (1 - smoothstep(range * 0.75, range, d));
      if (e.spec.swell) {
        const u = clamp01((now - e.born) / Math.max(0.1, e.life));
        g *= 0.3 + 0.9 * u * u;
        v.src.playbackRate.setTargetAtTime(e.rate * lerp(0.75, 1.5, u), now, 0.05);
      }
      v.gain.gain.setTargetAtTime(g, now, 0.06);
      if (doLp && v.lp) v.lp.frequency.setTargetAtTime(distanceCutoff(d, !!v.sound.def.heavy), now, 0.1);
    }
  }

  setMusicState(s: MusicState): void {
    this.musicState = { scene: s.scene, intensity: clamp01(s.intensity), danger: clamp01(s.danger) };
    this.conductor?.setState(this.musicState);
  }

  // ==========================================================================================
  // voices
  // ==========================================================================================

  private dist(p: AudioPos): number {
    const L = this.lis;
    return Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z);
  }

  private release(v: Voice): void {
    if (v.done) return;
    v.done = true;
    try { v.src.disconnect(); v.gain.disconnect(); v.lp?.disconnect(); v.pan?.disconnect(); } catch { /* already gone */ }
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Fade a voice out and stop it. */
  private stopVoice(v: Voice, fade = 0.03): void {
    const ctx = this.ctx;
    if (!ctx || v.done) return;
    const now = ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, fade / 3);
    try { v.src.stop(now + fade + 0.02); } catch { /* not started yet */ }
    // drop it from the budget immediately; the node cleans itself up on 'ended'
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Make room for a voice of the given importance. False if it is not worth a slot. */
  private reserve(score: number): boolean {
    if (this.voices.length < MAX_VOICES) return true;
    const now = this.ctx!.currentTime;
    let worst: Voice | null = null, ws = Infinity;
    for (const v of this.voices) {
      // old one-shots matter less and less; loops keep their rank
      const s = v.score - (v.loop ? 0 : (now - v.born) * 0.6);
      if (s < ws) { ws = s; worst = v; }
    }
    if (!worst || ws >= score) return false;
    this.stopVoice(worst, 0.025);
    return true;
  }

  private play(key: string, o: PlayOpts = {}): Voice | null {
    const ctx = this.ctx, mix = this.mix;
    if (!ctx || !mix || ctx.state !== 'running' || this.silenced()) return null;
    const s = bank.get(key);
    if (!s) return null;
    const def = s.def, now = ctx.currentTime;
    const positional = !!o.pos && !o.local;
    const ref = def.ref ?? DEFAULT_REF;
    let d = 0;
    if (positional) {
      d = this.dist(o.pos!);
      if (d > (def.range ?? DEFAULT_RANGE)) return null;
    }
    const level = o.gain ?? 1;
    const heard = level * (positional ? distanceGain(d, ref) : 1);
    if (heard < 0.004) return null;
    const bus = o.bus ?? 'world';
    // loops outrank one-shots of the same class: a one-shot that is dropped is gone in a moment,
    // a loop that never starts leaves a cyclone silent for its whole life
    const score = (def.pri ?? 1) + heard * 2 + (o.local ? 12 : o.boost ? 8 : 0) + (o.loop ? 5 : 0) + (bus === 'ui' || bus === 'stinger' ? 20 : 0);
    if (!this.reserve(score)) return null;

    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    // interface chimes and announcer horns are in the key of the score: never detune them
    const vary = bus === 'ui' || bus === 'stinger' ? 0 : def.vary ?? 0.6;
    src.playbackRate.value = (o.rate ?? 1) * Math.pow(2, ((Math.random() * 2 - 1) * vary) / 12);
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(gain);
    let tail: AudioNode = gain, lp: BiquadFilterNode | null = null, pan: PannerNode | null = null;
    const cutoff = o.lowpass ?? (positional && d > LOWPASS_FROM ? distanceCutoff(d, !!def.heavy) : 0);
    if (cutoff > 0 || (o.loop && positional)) {
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.5;
      lp.frequency.value = cutoff > 0 ? cutoff : 20000;
      tail.connect(lp); tail = lp;
    }
    if (positional) {
      pan = makePanner(ctx, o.pos!, ref);
      tail.connect(pan); tail = pan;
    }
    tail.connect(bus === 'ui' ? mix.ui : bus === 'stinger' ? mix.stinger : bus === 'ambience' ? mix.ambience : positional ? mix.world : mix.local);

    const v: Voice = { src, gain, pan, lp, sound: s, score, born: now, level, loop: !!o.loop, done: false };
    if (o.loop) {
      src.loop = true;
      src.loopStart = s.loopStart;
      src.loopEnd = s.loopEnd;
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(level, now, 0.04);
      src.start(now + (o.delay ?? 0), s.loopStart + Math.random() * (s.loopEnd - s.loopStart));
    } else src.start(now + (o.delay ?? 0), o.offset ?? 0);
    src.onended = () => this.release(v);
    this.voices.push(v);
    return v;
  }

  /** Drop a sound if the same key just played very close by (volleys, trails). */
  private fresh(key: string, window = 0.05): boolean {
    const now = this.ctx ? this.ctx.currentTime : 0, last = this.lastPlay.get(key);
    if (last !== undefined && now - last < window) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  // ==========================================================================================
  // combat
  // ==========================================================================================

  private abilityKey(el: ElementId, slot: number, key: string, prefix: 'cs.' | 'cr.'): string {
    if (bank.groupOf(prefix + key)) return prefix + key;
    const a = ELEMENTS[el]?.abilities[clamp(slot | 0, 0, 4)];
    return prefix + (a ? a.key : key);
  }

  castStart(el: ElementId, slot: number, abilityKey: string, pos: AudioPos, isLocal: boolean): void {
    this.play(this.abilityKey(el, slot, abilityKey, 'cs.'), { pos, local: isLocal, gain: isLocal ? 0.8 : 1 });
  }

  castRelease(el: ElementId, slot: number, abilityKey: string, pos: AudioPos, isLocal: boolean): void {
    this.play(this.abilityKey(el, slot, abilityKey, 'cr.'), { pos, local: isLocal, gain: isLocal ? 0.85 : 1 });
  }

  /** Where an entity's one-shots should sound: its position, or the middle of its line. */
  private entPos(e: EntityState, spec: EntSpec): AudioPos {
    if (!spec.line) return e;
    const l = Math.hypot(e.vx, e.vz) || 1, half = (e.p || 0) * 0.5;
    return { x: e.x + (e.vx / l) * half, y: e.y, z: e.z + (e.vz / l) * half };
  }

  entitySpawn(e: EntityState): void {
    const spec = ENTITY[e.k];
    if (!spec || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.endEntity(e.id, 0.03);
    if (spec.spawn) {
      const delay = spec.stagger ? Math.random() * spec.stagger : 0;
      if (spec.fuse) {
        // the fuse sound is exactly as long as the delay: if we join late, skip ahead
        const s = bank.get(spec.spawn);
        const fuse = e.p > 0 ? e.p : e.life;
        const offset = s ? clamp(s.buffer.duration - (fuse - e.age), 0, s.buffer.duration) : 0;
        const v = this.play(spec.spawn, { pos: e, offset });
        if (v) this.entLoops.set(e.id, { voice: v, kind: e.k, spec, x: e.x, y: e.y, z: e.z, born: now, life: e.life, rate: 1, fuse: true });
      } else if (!spec.stagger || this.fresh(spec.spawn + ((e.x * 0.5) | 0) + ((e.z * 0.5) | 0), 0.02)) {
        this.play(spec.spawn, { pos: this.entPos(e, spec), delay });
      }
    }
    if (spec.loop) {
      // Track it even if it cannot sound yet (too far away, or no voice free): update() starts
      // the loop as soon as it can be heard.
      const rec: EntLoop = { voice: null, kind: e.k, spec, x: e.x, y: e.y, z: e.z, born: now - e.age, life: e.life, rate: spec.loopRate ?? 1, fuse: false };
      this.entLoops.set(e.id, rec);
      let sounding = 0;
      for (const o of this.entLoops.values()) if (o.voice && !o.voice.done) sounding++;
      if (sounding < MAX_ENT_LOOPS && !this.mergedAway(rec, e.id)) {
        rec.voice = this.play(spec.loop, { pos: e, loop: true, gain: spec.loopGain ?? 1, rate: rec.rate });
        if (rec.voice) rec.rate = rec.voice.src.playbackRate.value;
      }
    }
  }

  /** Is another loop of the same kind already sounding close enough to stand in for this one? */
  private mergedAway(e: EntLoop, id: number): boolean {
    if (!e.spec.merge) return false;
    for (const [oid, o] of this.entLoops) {
      if (oid !== id && o.kind === e.kind && o.voice && !o.voice.done && Math.hypot(o.x - e.x, o.z - e.z) < e.spec.merge) return true;
    }
    return false;
  }

  entityMove(id: number, pos: AudioPos): void {
    const e = this.entLoops.get(id);
    if (!e || !this.ctx) return;
    e.x = pos.x; e.y = pos.y; e.z = pos.z;
    if (e.voice && e.voice.pan) setPannerPos(e.voice.pan, pos.x, pos.y, pos.z, this.ctx.currentTime);
  }

  private endEntity(id: number, fade: number): void {
    const e = this.entLoops.get(id);
    if (!e) return;
    this.entLoops.delete(id);
    if (e.voice) this.stopVoice(e.voice, fade);
  }

  entityDespawn(id: number, kind: EntityKind, pos: AudioPos, why: number): void {
    const spec = ENTITY[kind];
    const e = this.entLoops.get(id);
    this.endEntity(id, e && e.fuse ? 0.04 : 0.12);
    if (!spec) return;
    const key = spec.end?.[clamp(why | 0, 0, 4) as 0 | 1 | 2 | 3 | 4];
    if (!key) return;
    // many small things ending at once (a trail, a volley) should not stack into one loud hit
    if ((spec.stagger || spec.merge) && !this.fresh(key + ((pos.x * 0.25) | 0) + ((pos.z * 0.25) | 0), 0.08)) return;
    // ... and a whole room of entities cleared in one frame (leaving a match) gets a few, not all
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (now - this.endBurstAt > 0.03) { this.endBurstAt = now; this.endBurst = 0; }
    if (++this.endBurst > 4) return;
    this.play(key, { pos, gain: spec.endGain ?? 1, rate: spec.endRate ?? 1 });
  }

  /** Nearest point to the listener on the segment a-b (beams are line sources). */
  private nearestOnSegment(a: AudioPos, b: AudioPos): AudioPos {
    const L = this.lis, dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    const t = len2 > 1e-6 ? clamp01(((L.x - a.x) * dx + (L.y - a.y) * dy + (L.z - a.z) * dz) / len2) : 0;
    return { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
  }

  fx(kind: EntityKind | 'melee', el: ElementId, pos: AudioPos, end: AudioPos): void {
    const spec = FX[kind];
    if (!spec) { this.play(`hit.${el}.h`, { pos }); return; }
    this.play(spec.key, { pos: spec.beam ? this.nearestOnSegment(pos, end) : pos });
    if (spec.end) this.play(spec.end, { pos: end, delay: 0.02 });
    if (kind === 'melee') this.play(`hit.${el}.t`, { pos, gain: 0.9 });
  }

  hit(el: ElementId, abilityKey: string, dmg: number, heavy: boolean, crit: boolean, pos: AudioPos, involvesLocal: 'dealt' | 'taken' | null): void {
    const boost = involvesLocal !== null;
    if (dmg <= 4.5 && !heavy && !crit) {
      // damage-over-time and zone ticks: just the element's sting
      this.play(`hit.${el}.t`, { pos, boost });
      if (involvesLocal === 'taken') this.play('hit.taken.l', { local: true, gain: 0.35 });
      else if (involvesLocal === 'dealt') this.play('hit.confirm.l', { local: true, gain: 0.4 });
      return;
    }
    // bigger hits are louder and pitched lower
    const scale = clamp(0.55 + dmg / 36, 0.55, 1.45), rate = clamp(1.12 - dmg / 90, 0.8, 1.12);
    const big = heavy ? 'h' : 'l';
    this.play(`hit.body.${big}${this.rr++ % 3}`, { pos, gain: scale * 0.9, rate, boost });
    this.play(`hit.${el}.${big}`, { pos, gain: scale, rate, boost });
    if (abilityKey.endsWith('_melee')) this.play(`hit.weapon.${this.rr % 2}`, { pos, gain: 0.6 * scale, boost });
    if (crit) {
      this.play('hit.crit', { pos, boost });
      if (el === 'umbra') this.play('hit.umbra.backstab', { pos, boost });
    }
    if (involvesLocal === 'dealt') this.play(heavy || crit ? 'hit.confirm.h' : 'hit.confirm.l', { local: true, gain: Math.min(1.2, scale) });
    else if (involvesLocal === 'taken') this.play(heavy ? 'hit.taken.h' : 'hit.taken.l', { local: true, gain: Math.min(1.2, scale) });
  }

  death(pos: AudioPos, fall: boolean, involvesLocal: 'killer' | 'victim' | null): void {
    const boost = involvesLocal !== null;
    if (fall) {
      this.play('death.fall', { pos, boost });
      if (involvesLocal === 'victim') this.play('death.local.fall', { local: true });
    } else {
      this.play('death.body', { pos, boost });
      this.play('death.soul', { pos, delay: 0.15, boost });
      if (involvesLocal === 'victim') this.play('death.local', { local: true });
    }
    if (involvesLocal === 'killer') this.play('kill.confirm', { local: true, delay: 0.12 });
  }

  respawn(pos: AudioPos, isLocal: boolean): void {
    this.play('respawn', { pos, local: isLocal, gain: isLocal ? 0.9 : 0.8 });
  }

  teleport(kind: string, from: AudioPos, to: AudioPos): void {
    const [out, into] = TELEPORT[kind] ?? TELEPORT_DEFAULT;
    this.play(out, { pos: from });
    this.play(into, { pos: to, delay: 0.03 });
  }

  pop(kind: 'freeze' | 'bubble', pos: AudioPos): void {
    this.play(kind === 'freeze' ? 'pop.freeze' : 'pop.bubble', { pos });
  }

  pickup(pos: AudioPos, isLocal: boolean): void {
    this.play('pickup', { pos, local: isLocal });
  }

  footstep(surface: string, pos: AudioPos, isLocal: boolean, kind: 'step' | 'land' | 'jump'): void {
    const surf: SurfaceName = (SURFACES as readonly string[]).includes(surface) ? (surface as SurfaceName) : 'rock';
    let key: string;
    if (kind === 'step') {
      let v = Math.floor(Math.random() * STEP_VARIANTS);
      if (v === this.lastStep) v = (v + 1) % STEP_VARIANTS;
      this.lastStep = v;
      key = `step.${surf}.${v}`;
    } else key = `${kind}.${surf}`;
    this.play(key, { pos, local: isLocal, gain: isLocal ? 0.6 : 1 });
  }

  thunder(distance: number, strength: number): void {
    const d = Math.max(0, distance), s = clamp01(strength);
    if (s <= 0.01) return;
    // sound takes its time to arrive; high frequencies do not survive the trip, or the hall's walls
    const key = d < 260 ? 'thunder.near' : d < 900 ? 'thunder.mid' : 'thunder.far';
    const gain = s * clamp(1.25 - d / 1600, 0.3, 1) * (1 - 0.45 * this.indoors);
    const lowpass = clamp(18000 * Math.exp(-d / 320), 260, 18000) * lerp(1, 0.12, this.indoors);
    this.play(key, { gain, lowpass: Math.max(200, lowpass), delay: Math.min(3.5, d / 343), bus: 'ambience', rate: lerp(1.05, 0.9, clamp01(d / 1500)) });
  }

  // ==========================================================================================
  // non-positional
  // ==========================================================================================

  announce(kind: AnnounceKind): void {
    this.play('ann.' + kind, { bus: 'stinger' });
  }

  ui(sound: UiSound): void {
    this.play('ui.' + sound, { bus: 'ui' });
  }

  duck(seconds: number, depth: number): void {
    if (this.ctx && this.ctx.state === 'running') this.mix?.duck(seconds, depth);
  }

  // ==========================================================================================
  // diagnostics (dev harness)
  // ==========================================================================================

  get debug(): { ctx: AudioContext | null; mix: Mix | null; voices: number; loops: number; musicVoices: number; music: Conductor['info'] | null; conductor: Conductor | null } {
    return { ctx: this.ctx, mix: this.mix, voices: this.voices.length, loops: this.entLoops.size, musicVoices: this.player?.voices ?? 0, music: this.conductor?.info ?? null, conductor: this.conductor };
  }
}
