// The score of Vindheim. A conductor that composes as it goes: fixed musical material (a main
// theme, a second strain, chord progressions, ostinato and drum patterns, lullabies for the hall)
// arranged, orchestrated and varied on the fly, one beat at a time, a fraction of a second ahead
// of the audio clock.
//
// Key: D. Mode: dorian (B natural over G major) with aeolian borrowings (B-flat, the epic bVI).
// Everything sits over the open fifth D-A of the tagelharpa drone.
//
//   title    66 bpm 4/4   the main theme, stated softly, then by horns, then by everyone
//   hall     92 bpm 3/4   lyre arpeggios, a soft drone, a hummed lullaby
//   arena   100 bpm 4/4   layers that enter with intensity; danger adds pulse, tremolo, a heartbeat
//   results  72 bpm 4/4   bVI - bVII - I: home to D major, then an afterglow
//
// Scene changes land on bar lines. Arena layers cross-fade continuously with the smoothed
// intensity; individual notes also have intensity thresholds, so the texture thickens note by note.

import { Rng, clamp01, smoothstep } from '../dsp';
import type { MusicSink, Chan, SceneName } from './player';
import type { InstrName } from './instruments';

export interface ScoreState { scene: SceneName; intensity: number; danger: number }

// ============================================================================================
// Harmony
// ============================================================================================

type Kind = 'm' | 'M' | '5' | 'sus';
interface Chord { name: string; pc: number; kind: Kind; bass?: number }
const IV: Record<Kind, number[]> = { m: [0, 3, 7], M: [0, 4, 7], 5: [0, 7], sus: [0, 5, 7] };
const chord = (name: string, pc: number, kind: Kind, bass?: number): Chord => ({ name, pc, kind, bass });

const Dm = chord('Dm', 2, 'm'), C = chord('C', 0, 'M'), G = chord('G', 7, 'M'), Am = chord('Am', 9, 'm');
const Bb = chord('Bb', 10, 'M'), F = chord('F', 5, 'M'), Gm = chord('Gm', 7, 'm');
const D5 = chord('D5', 2, '5'), A5 = chord('A5', 9, '5'), DM = chord('D', 2, 'M'), GD = chord('G/D', 7, 'M', 2);

/** Chord tones between two MIDI notes, ascending. */
function tonesIn(ch: Chord, lo: number, hi: number): number[] {
  const iv = IV[ch.kind], out: number[] = [];
  for (let m = lo; m <= hi; m++) if (iv.includes((((m - ch.pc) % 12) + 12) % 12)) out.push(m);
  return out;
}
/** The chord's bass note in the octave starting at `lo`. */
function bassOf(ch: Chord, lo: number): number {
  const pc = ch.bass ?? ch.pc;
  return lo + ((((pc - lo) % 12) + 12) % 12);
}
/**
 * The drone: an open fifth (or octave) in the bass that holds D for as long as the harmony allows
 * and otherwise steps to the chord's own root and fifth — the old double-tonic habit of sliding
 * the whole drone down to C and back. It never sits a second away from the bass.
 */
function droneOf(ch: Chord): [number, number] {
  const iv = IV[ch.kind], has = (pc: number): boolean => iv.includes((((pc - ch.pc) % 12) + 12) % 12);
  if (has(2)) return [38, has(9) ? 45 : 50];
  const low = bassOf(ch, 36);
  return [low, low + 7];
}

/** Three-note voicing that moves as little as possible from the previous one. */
function voiceLead(ch: Chord, prev: number[] | null, lo: number, hi: number): number[] {
  const tones = tonesIn(ch, lo, hi);
  if (!prev) {
    const mid = (lo + hi) / 2 - 3;
    let i = 0;
    while (i < tones.length - 3 && tones[i] < mid - 4) i++;
    return tones.slice(i, i + 3);
  }
  const used = new Set<number>(), out: number[] = [];
  for (const p of prev) {
    let best = -1, bd = 1e9;
    for (const t of tones) { if (used.has(t)) continue; const d = Math.abs(t - p); if (d < bd) { bd = d; best = t; } }
    if (best >= 0) { used.add(best); out.push(best); }
  }
  return out.sort((a, b) => a - b);
}

// ============================================================================================
// Material
// ============================================================================================

/** [bar, beat, length in beats, MIDI note] */
type Mel = [number, number, number, number];
interface Section { id: string; beats: number; chords: Chord[]; mel: Mel[]; melOct?: number }

// The main theme. Two four-bar phrases: the first reaches up a fifth and falls back through the
// dorian B natural; the second starts the same, turns through B-flat and C, and climbs home.
const THEME: Section = {
  id: 'theme', beats: 4,
  chords: [Dm, C, G, Am, Dm, Bb, C, Dm],
  mel: [
    [0, 0, 2, 62], [0, 2, 1.5, 69], [0, 3.5, 0.5, 67],
    [1, 0, 1, 64], [1, 1, 1, 67], [1, 2, 2, 72],
    [2, 0, 1.5, 71], [2, 1.5, 0.5, 69], [2, 2, 1, 67], [2, 3, 1, 71],
    [3, 0, 3, 69],
    [4, 0, 2, 62], [4, 2, 1.5, 69], [4, 3.5, 0.5, 67],
    [5, 0, 1, 65], [5, 1, 1, 70], [5, 2, 2, 74],
    [6, 0, 1.5, 76], [6, 1.5, 0.5, 74], [6, 2, 1, 72], [6, 3, 1, 76],
    [7, 0, 4, 74],
  ],
};
// The second strain: brighter, starting from the relative major, ending on the same cadence.
const STRAIN: Section = {
  id: 'strain', beats: 4,
  chords: [F, C, Dm, Am, Bb, F, C, Dm],
  mel: [
    [0, 0, 2, 69], [0, 2, 2, 72],
    [1, 0, 1.5, 76], [1, 1.5, 0.5, 74], [1, 2, 2, 72],
    [2, 0, 1, 74], [2, 1, 1, 77], [2, 2, 1, 76], [2, 3, 1, 74],
    [3, 0, 3, 76], [3, 3, 1, 72],
    [4, 0, 2, 74], [4, 2, 2, 77],
    [5, 0, 1, 72], [5, 1, 1, 69], [5, 2, 2, 72],
    [6, 0, 1, 67], [6, 1, 1, 72], [6, 2, 2, 76],
    [7, 0, 4, 74],
  ],
};
// Arena only: a driving section built on horn calls.
const DRIVE: Section = {
  id: 'drive', beats: 4, melOct: 0,
  chords: [Dm, Dm, Bb, C, Dm, Dm, F, C],
  mel: [
    [0, 0, 0.75, 50], [0, 1, 0.5, 50], [0, 1.5, 2.5, 57],
    [2, 0, 0.75, 50], [2, 1, 0.5, 50], [2, 1.5, 2.5, 58],
    [3, 0, 3, 55], [3, 3, 1, 52],
    [4, 0, 0.75, 50], [4, 1, 0.5, 50], [4, 1.5, 2.5, 57],
    [5, 0, 2, 62], [5, 2, 2, 57],
    [6, 0, 2, 60], [6, 2, 2, 57],
    [7, 0, 1.5, 55], [7, 1.5, 0.5, 57], [7, 2, 2, 60],
  ],
};
// Arena only: a long climb over a pedal, ending on the open dominant.
const PEDAL: Section = {
  id: 'pedal', beats: 4, melOct: 0,
  chords: [Dm, Dm, Gm, Dm, Bb, Bb, C, A5],
  mel: [
    [0, 0, 4, 50], [1, 0, 2, 53], [1, 2, 2, 57], [2, 0, 3, 58], [2, 3, 1, 57], [3, 0, 4, 57],
    [4, 0, 2, 58], [4, 2, 2, 62], [5, 0, 3, 65], [5, 3, 1, 62], [6, 0, 2, 60], [6, 2, 2, 64], [7, 0, 4, 64],
  ],
};
const INTRO: Section = { id: 'intro', beats: 4, chords: [D5, D5, D5, D5], mel: [[1, 0, 1.5, 50], [1, 2, 5, 57]], melOct: 0 };
const INTERLUDE: Section = { id: 'interlude', beats: 4, chords: [Dm, C, Bb, A5], mel: [[0, 0, 4, 74], [1, 0, 4, 72], [2, 0, 4, 70], [3, 0, 4, 69]] };

// Hall lullabies, in three.
const HALL_A: Section = {
  id: 'hallA', beats: 3,
  chords: [Dm, Dm, C, C, F, C, Dm, Dm],
  mel: [[0, 0, 2, 69], [0, 2, 1, 74], [1, 0, 1, 72], [1, 1, 2, 69], [2, 0, 2, 67], [2, 2, 1, 64], [3, 0, 3, 67],
    [4, 0, 2, 69], [4, 2, 1, 72], [5, 0, 1, 67], [5, 1, 1, 64], [5, 2, 1, 67], [6, 0, 2, 65], [6, 2, 1, 64], [7, 0, 3, 62]],
};
const HALL_B: Section = {
  id: 'hallB', beats: 3,
  chords: [Bb, F, C, Dm, Bb, C, Dm, Dm],
  mel: [[0, 0, 2, 74], [0, 2, 1, 70], [1, 0, 2, 72], [1, 2, 1, 69], [2, 0, 1, 67], [2, 1, 1, 72], [2, 2, 1, 76], [3, 0, 3, 74],
    [4, 0, 2, 77], [4, 2, 1, 74], [5, 0, 1, 76], [5, 1, 1, 72], [5, 2, 1, 67], [6, 0, 2, 69], [6, 2, 1, 65], [7, 0, 3, 62]],
};
const HALL_C: Section = {
  id: 'hallC', beats: 3,
  chords: [Dm, G, Dm, G, F, C, Am, Dm],
  mel: [[0, 0, 1, 62], [0, 1, 1, 65], [0, 2, 1, 69], [1, 0, 2, 71], [1, 2, 1, 67], [2, 0, 1, 69], [2, 1, 1, 65], [2, 2, 1, 62], [3, 0, 2, 67], [3, 2, 1, 71],
    [4, 0, 2, 72], [4, 2, 1, 69], [5, 0, 2, 67], [5, 2, 1, 64], [6, 0, 1, 72], [6, 1, 1, 69], [6, 2, 1, 64], [7, 0, 3, 62]],
};

// Results: the cadence, then an afterglow in D mixolydian with one last look at B-flat and C.
const CADENCE: Section = { id: 'cadence', beats: 4, chords: [Bb, DM, DM], mel: [[1, 0, 1.5, 57], [1, 1.5, 0.5, 57], [1, 2, 1, 62], [1, 3, 1, 66], [2, 0, 4, 69]], melOct: 0 };
const AFTERGLOW: Section = {
  id: 'afterglow', beats: 4,
  chords: [DM, GD, DM, A5, Bb, C, DM, DM],
  mel: [[0, 0, 2, 62], [0, 2, 1.5, 69], [0, 3.5, 0.5, 67], [1, 0, 2, 71], [1, 2, 1, 69], [1, 3, 1, 67], [2, 0, 2, 66], [2, 2, 2, 69], [3, 0, 3, 64],
    [4, 0, 1, 65], [4, 1, 1, 70], [4, 2, 2, 74], [5, 0, 1.5, 76], [5, 1.5, 0.5, 74], [5, 2, 2, 72], [6, 0, 4, 74]],
};

// Lyre arpeggio shapes: indices into the chord-tone stack, -1 = rest. Eight (4/4) or six (3/4) eighths.
const ARP4: number[][] = [[0, 2, 3, 4, 3, 2, 4, 2], [0, 3, 2, 4, 5, 4, 3, 2], [0, -1, 3, 4, -1, 2, 3, -1], [0, 2, 4, 3, 5, 3, 4, 2]];
const ARP3: number[][] = [[0, 2, 3, 4, 3, 2], [0, 2, 4, 3, 5, 3], [0, -1, 3, 4, -1, 2], [0, 3, 2, 4, 3, 5], [0, -1, 2, 3, 4, -1]];

// War-drum patterns on sixteen steps: step -> strength.
const WAR: Record<number, number>[] = [
  { 0: 1, 6: 0.7, 8: 0.9, 14: 0.6 },
  { 0: 1, 3: 0.5, 6: 0.8, 8: 0.9, 11: 0.5, 14: 0.7 },
  { 0: 1, 4: 0.6, 6: 0.8, 10: 0.9, 12: 0.7 },
  { 0: 1, 8: 0.85 },
];
// Frame-drum patterns: step -> [stroke, strength, minimum intensity].
type Stroke = 'dum' | 'tak' | 'ka';
const FRAME: Record<number, [Stroke, number, number]>[] = [
  { 0: ['dum', 0.8, 0], 3: ['ka', 0.3, 0.35], 4: ['tak', 0.6, 0.15], 6: ['ka', 0.35, 0.3], 7: ['ka', 0.3, 0.45], 10: ['dum', 0.65, 0.1], 11: ['ka', 0.3, 0.4], 12: ['tak', 0.65, 0.15], 14: ['ka', 0.4, 0.3], 15: ['ka', 0.3, 0.5] },
  { 0: ['dum', 0.8, 0], 2: ['ka', 0.3, 0.4], 4: ['tak', 0.6, 0.15], 6: ['dum', 0.6, 0.2], 7: ['ka', 0.3, 0.45], 10: ['dum', 0.6, 0.1], 12: ['tak', 0.65, 0.15], 13: ['ka', 0.3, 0.45], 14: ['tak', 0.5, 0.3] },
];
// Sparse lyre figures for the quiet arena: [eighth-note step, chord-tone index].
const FIGURES: [number, number][][] = [
  [[0, 0], [1, 2], [2, 3]], [[2, 4], [3, 3], [4, 2], [6, 0]], [[0, 3], [3, 4], [4, 2]], [[4, 0], [5, 2], [6, 3], [7, 4]],
  [[0, 4], [2, 3], [4, 2], [6, 3]], [[1, 2], [2, 4], [5, 3]], [[0, 0], [4, 2], [6, 4]],
];

// ============================================================================================
// Seating plan
// ============================================================================================

const ch = (scene: SceneName, layer: string, name: string, gain: number, pan: number, send: number): Chan => ({ scene, layer, name, gain, pan, send });

const T = {
  drone: ch('title', 'main', 'drone', 0.4, 0, 0.3), bass: ch('title', 'main', 'bass', 0.55, 0.1, 0.2),
  pad: ch('title', 'main', 'pad', 0.34, -0.1, 0.5), lyre: ch('title', 'main', 'lyre', 0.7, -0.35, 0.4),
  tagel: ch('title', 'main', 'tagel', 0.7, 0.25, 0.4), horn: ch('title', 'main', 'horn', 0.85, 0.15, 0.45),
  choir: ch('title', 'main', 'choir', 0.6, -0.05, 0.55), war: ch('title', 'main', 'war', 0.9, 0, 0.3),
  frame: ch('title', 'main', 'frame', 0.55, 0.3, 0.25), bell: ch('title', 'main', 'bell', 0.45, 0.2, 0.6),
  ost: ch('title', 'main', 'ost', 0.42, -0.2, 0.2), call: ch('title', 'main', 'call', 0.32, 0.45, 0.9),
};
const H = {
  drone: ch('hall', 'main', 'drone', 0.36, 0, 0.3), lyre: ch('hall', 'main', 'lyre', 0.72, -0.25, 0.35),
  lyreHi: ch('hall', 'main', 'lyreHi', 0.6, 0.3, 0.45), mel: ch('hall', 'main', 'mel', 0.55, 0.2, 0.4),
  hum: ch('hall', 'main', 'hum', 0.6, -0.05, 0.5), pad: ch('hall', 'main', 'pad', 0.34, 0.05, 0.5),
  drum: ch('hall', 'main', 'drum', 0.4, 0.1, 0.3),
};
const A = {
  drone: ch('arena', 'drone', 'drone', 0.42, 0, 0.3),
  lyre: ch('arena', 'sparse', 'lyre', 0.62, -0.35, 0.5), call: ch('arena', 'sparse', 'call', 0.36, 0.45, 0.9),
  bell: ch('arena', 'sparse', 'bell', 0.35, 0.2, 0.7), soft: ch('arena', 'sparse', 'soft', 0.55, 0, 0.4),
  ost: ch('arena', 'pulse', 'ost', 0.5, -0.22, 0.2), bass: ch('arena', 'pulse', 'bass', 0.6, 0.08, 0.15),
  frame: ch('arena', 'pulse', 'frame', 0.5, 0.32, 0.22), frag: ch('arena', 'pulse', 'frag', 0.5, 0.25, 0.45),
  war: ch('arena', 'war', 'war', 0.95, 0, 0.28), anvil: ch('arena', 'war', 'anvil', 0.4, -0.4, 0.4),
  choir: ch('arena', 'pad', 'choir', 0.4, -0.05, 0.5), strpad: ch('arena', 'pad', 'strpad', 0.4, -0.18, 0.35),
  horn: ch('arena', 'lead', 'horn', 0.9, 0.15, 0.45), top: ch('arena', 'lead', 'top', 0.5, -0.1, 0.55),
  heart: ch('arena', 'danger', 'heart', 0.8, 0, 0.08), trem: ch('arena', 'danger', 'trem', 0.5, -0.3, 0.4),
  rattle: ch('arena', 'danger', 'rattle', 0.5, 0.45, 0.2),
};
const R = {
  drone: ch('results', 'main', 'drone', 0.36, 0, 0.3), bass: ch('results', 'main', 'bass', 0.55, 0.1, 0.2),
  horn: ch('results', 'main', 'horn', 0.8, 0.15, 0.45), choir: ch('results', 'main', 'choir', 0.5, -0.05, 0.55),
  war: ch('results', 'main', 'war', 0.9, 0, 0.3), frame: ch('results', 'main', 'frame', 0.55, 0.3, 0.25),
  bell: ch('results', 'main', 'bell', 0.5, 0.2, 0.6), lyre: ch('results', 'main', 'lyre', 0.68, -0.3, 0.4),
  tagel: ch('results', 'main', 'tagel', 0.55, 0.25, 0.4), pad: ch('results', 'main', 'pad', 0.34, 0, 0.5),
};
/** Transition effects (the swell into a bar line, the bloom on arrival) play on the scene they belong to. */
const FXC: Record<SceneName, Chan> = {
  title: ch('title', 'main', 'fx', 0.5, 0, 0.4), hall: ch('hall', 'main', 'fx', 0.3, 0, 0.4),
  arena: ch('arena', 'drone', 'fx', 0.55, 0, 0.4), results: ch('results', 'main', 'fx', 0.5, 0, 0.4),
};

const ARENA_LAYERS = ['drone', 'sparse', 'pulse', 'war', 'pad', 'lead', 'danger'] as const;
type ArenaLayer = (typeof ARENA_LAYERS)[number];

const BPM: Record<SceneName, number> = { title: 66, hall: 92, arena: 100, results: 72 };
/** Scene fader positions: the quiet scenes are mixed up so the score sits at a consistent level. */
const SCENE_GAIN: Record<SceneName, number> = { title: 1.5, hall: 1.7, arena: 1, results: 1.35 };

type Lead = 'lyre' | 'tagel' | 'horn' | 'choir' | 'tutti' | 'call' | 'none';
interface TitleSeg { sec: Section; dyn: number; lead: Lead; pad: InstrName | null; drums: 0 | 1 | 2; arp: number; ost: boolean; bell: boolean; bass: boolean }
interface HallOrc { mel: 'tagel' | 'mm' | 'lyre' | 'none'; arp: number; pad: boolean; drum: boolean; fullDrone: boolean; endStrum: boolean }
interface ArenaOrc { ost: number; frame: number; war: [number, number]; fills: [number, number]; callBar: number; bell: boolean }

export interface BarInfo { scene: SceneName; section: string; bar: number; time: number; chord: string; bpm: number; intensity: number; danger: number }

// ============================================================================================
// The conductor
// ============================================================================================

export class Conductor {
  private readonly sink: MusicSink;
  private readonly rng: Rng;
  private target: ScoreState = { scene: 'title', intensity: 0, danger: 0 };
  private scene: SceneName | null = null;
  private I = 0;
  private D = 0;
  private started = false;
  private nextBeat = 0;
  private beat = 0;
  private beats = 4;
  private spb = 0.9;
  /** Bars played since the scene began. */
  private bar = 0;
  private sec: Section = INTRO;
  private secBar = 0;
  private lastSec = '';
  private prevSec = '';
  private voicing: number[] | null = null;
  private riserFor: SceneName | null = null;
  private rr = 0;
  private droneHeld = 0;
  // per-scene arrangement state
  private tQueue: TitleSeg[] = [];
  private tSeg: TitleSeg | null = null;
  private tForm = -1;
  private hOrc: HallOrc = { mel: 'none', arp: 0, pad: false, drum: false, fullDrone: false, endStrum: false };
  private aOrc: ArenaOrc = { ost: 0, frame: 0, war: [0, 2], fills: [0, 2], callBar: 2, bell: false };
  private aFig: [number, number][] = [];
  private aLevel: Record<ArenaLayer, number> = { drone: 0, sparse: 0, pulse: 0, war: 0, pad: 0, lead: 0, danger: 0 };
  private rPass = 0;
  /** Called at every bar line (analysis, debugging). */
  onBar: ((b: BarInfo) => void) | null = null;

  constructor(sink: MusicSink, seed: number) {
    this.sink = sink;
    this.rng = new Rng(seed);
  }

  setState(s: ScoreState): void {
    this.target = { scene: s.scene, intensity: clamp01(s.intensity), danger: clamp01(s.danger) };
  }

  get playing(): SceneName | null { return this.scene; }
  get info(): { scene: SceneName | null; section: string; bar: number; intensity: number; danger: number; bpm: number } {
    return { scene: this.scene, section: this.sec.id, bar: this.secBar, intensity: this.I, danger: this.D, bpm: 60 / this.spb };
  }

  /** Begin at context time t0. */
  start(t0: number): void {
    this.started = true;
    this.nextBeat = t0;
    this.beat = 0;
    this.scene = null;
  }

  /** If the clock jumped (tab was suspended), re-anchor instead of racing to catch up. */
  resync(now: number): void {
    if (this.started && this.nextBeat < now - 0.2) this.nextBeat = now + 0.05;
  }

  /** Schedule every beat that begins before `until`. `now` is the current context time. */
  advance(until: number, now: number): void {
    if (!this.started) return;
    // a scene change is pending: swell into the coming bar line
    if (this.scene && this.target.scene !== this.scene && this.riserFor !== this.target.scene) {
      const line = this.nextBeat + (this.beat === 0 ? 0 : (this.beats - this.beat) * this.spb);
      const room = line - now;
      if (room > 0.45) {
        const len = Math.min(3, room - 0.02);
        this.sink.hit(FXC[this.scene], 'm.riser', line - len, this.target.scene === 'hall' ? 0.5 : 0.9, { offset: 3 - len });
      }
      this.riserFor = this.target.scene;
    }
    let guard = 0;
    while (this.nextBeat < until && guard++ < 64) this.doBeat();
  }

  // ------------------------------------------------------------------------------------------
  private doBeat(): void {
    const t = this.nextBeat;
    if (this.beat === 0) this.startBar(t);
    // smooth the game's intensity: quick to rise, slow to fall
    const ti = this.target.intensity, td = this.target.danger;
    this.I += (ti - this.I) * (1 - Math.exp(-this.spb / (ti > this.I ? 1.1 : 4.5)));
    this.D += (td - this.D) * (1 - Math.exp(-this.spb / (td > this.D ? 1.5 : 4)));
    const b = this.beat;
    switch (this.scene) {
      case 'title': this.titleBeat(t, b); break;
      case 'hall': this.hallBeat(t, b); break;
      case 'arena': this.arenaLayers(t, 0.3); this.arenaBeat(t, b); break;
      case 'results': this.resultsBeat(t, b); break;
    }
    this.nextBeat = t + this.spb;
    if (++this.beat >= this.beats) { this.beat = 0; this.secBar++; this.bar++; }
  }

  private startBar(t: number): void {
    if (this.scene !== this.target.scene) this.enter(this.target.scene, t);
    else if (this.secBar >= this.sec.chords.length) this.nextSection();
    this.beats = this.sec.beats;
    this.spb = 60 / (BPM[this.scene!] + (this.scene === 'arena' ? 8 * this.D : 0));
    if (this.onBar) this.onBar({ scene: this.scene!, section: this.sec.id, bar: this.secBar, time: t, chord: this.sec.chords[this.secBar].name, bpm: 60 / this.spb, intensity: this.I, danger: this.D });
  }

  private enter(to: SceneName, t: number): void {
    const from = this.scene;
    if (from) this.sink.setScene(from, 0, t, from === 'arena' ? 0.4 : 0.55);
    this.sink.setScene(to, SCENE_GAIN[to], Math.max(0, t - 0.15), 0.04);
    this.scene = to;
    this.bar = 0;
    this.secBar = 0;
    this.droneHeld = 0;
    this.voicing = null;
    this.riserFor = null;
    this.lastSec = '';
    this.prevSec = '';
    switch (to) {
      case 'title':
        this.tQueue = [];
        this.tForm = -1;
        this.tSeg = { sec: INTRO, dyn: 0.25, lead: 'call', pad: null, drums: 0, arp: -1, ost: false, bell: true, bass: false };
        this.sec = INTRO;
        if (from) this.sink.hit(FXC.title, 'm.boom', t, 0.6);
        break;
      case 'hall':
        this.sec = this.rng.pick([HALL_A, HALL_C]);
        this.hallOrchestrate(true);
        break;
      case 'arena':
        // drop into the fight on the driving material; the theme has to be earned
        this.sec = this.rng.pick([DRIVE, PEDAL]);
        this.arenaOrchestrate();
        this.I = Math.max(this.I, this.target.intensity * 0.6);
        this.arenaLayers(Math.max(0, t - 0.15), 0.05);
        this.sink.hit(FXC.arena, 'm.boom', t, 0.8);
        break;
      case 'results':
        this.sec = CADENCE;
        this.rPass = 0;
        break;
    }
    this.lastSec = this.sec.id;
  }

  private nextSection(): void {
    this.secBar = 0;
    this.droneHeld = 0;
    const older = this.prevSec; // the section before the one that just ended
    this.prevSec = this.lastSec;
    switch (this.scene) {
      case 'title': {
        if (!this.tQueue.length) this.tQueue = this.titleForm();
        this.tSeg = this.tQueue.shift()!;
        this.sec = this.tSeg.sec;
        break;
      }
      case 'hall': {
        // never the same lullaby twice; usually the one we have not heard for longest
        const pool = [HALL_A, HALL_B, HALL_C].filter((s) => s.id !== this.lastSec);
        const rested = pool.filter((s) => s.id !== older);
        this.sec = rested.length && this.rng.chance(0.7) ? this.rng.pick(rested) : this.rng.pick(pool);
        this.hallOrchestrate(false);
        break;
      }
      case 'arena': {
        const themeDue = this.lastSec !== 'theme' && older !== 'theme';
        let pool: Section[] = [THEME, THEME, THEME, STRAIN, STRAIN, DRIVE, DRIVE, DRIVE, PEDAL, PEDAL].filter((s) => s.id !== this.lastSec);
        if (this.lastSec === 'strain') pool = pool.filter((s) => s.id !== 'pedal'); // the strain wants to resolve into something that moves
        this.sec = themeDue && this.rng.chance(0.65) ? THEME : this.rng.pick(pool);
        this.arenaOrchestrate();
        break;
      }
      default:
        this.sec = AFTERGLOW;
        this.rPass++;
    }
    this.lastSec = this.sec.id;
  }

  // ------------------------------------------------------------------------------------------
  // helpers
  private note(c: Chan, instr: InstrName, midi: number, t: number, beats: number, vel: number, a?: number, r?: number): void {
    this.sink.note(c, instr, midi, t, beats * this.spb, vel * (0.93 + this.rng.next() * 0.14), a === undefined ? undefined : { a, r });
  }
  /** A plucked note, slightly humanised. */
  private pluck(c: Chan, midi: number, t: number, vel: number): void {
    this.sink.note(c, 'lyre', midi, t + this.rng.range(0, 0.012), 0, vel * (0.85 + this.rng.next() * 0.3));
  }
  private drum(c: Chan, key: string, t: number, vel: number): void {
    this.sink.hit(c, key, t + this.rng.range(0, 0.006), vel * (0.9 + this.rng.next() * 0.2));
  }
  private war(c: Chan, t: number, vel: number): void {
    this.rr++;
    this.drum(c, vel >= 0.78 ? 'm.war.h' + (this.rr % 3) : 'm.war.s' + (this.rr % 2), t, vel);
  }
  private frame(c: Chan, stroke: Stroke, t: number, vel: number): void {
    this.rr++;
    this.drum(c, `m.frame.${stroke}${this.rr % 2}`, t, vel);
  }
  /** Melody notes of the current section that begin during beat `b` of the current bar. */
  private melAt(b: number): Mel[] {
    const k = this.secBar;
    return this.sec.mel.filter((m) => m[0] === k && m[1] >= b && m[1] < b + 1);
  }
  /** The chord-tone stack the lyre arpeggiates: six notes upward from the bass around C3. */
  private stack(chd: Chord): number[] {
    const b = bassOf(chd, 48);
    return [b, ...tonesIn(chd, b + 1, b + 30)].slice(0, 6);
  }
  private arp(c: Chan, chd: Chord, pat: number[], b: number, t: number, vel: number): void {
    const s = this.stack(chd);
    for (let e = 0; e < 2; e++) {
      const idx = pat[b * 2 + e];
      if (idx === undefined || idx < 0) continue;
      this.pluck(c, s[Math.min(idx, s.length - 1)], t + e * 0.5 * this.spb, vel * (b === 0 && e === 0 ? 1.25 : e === 0 ? 1 : 0.85));
    }
  }
  /**
   * Bow the drone for this bar (call on beat 0). Where the next bar wants the same two notes the
   * stroke is carried across the bar line, so a static harmony gets long, unhurried bows.
   */
  private drone(c: Chan, t: number, vel: number, third = false): void {
    if (this.droneHeld > 0) { this.droneHeld--; return; }
    const k = this.secBar, chords = this.sec.chords, cur = droneOf(chords[k]);
    const next = k + 1 < chords.length ? droneOf(chords[k + 1]) : null;
    const long = !!next && next[0] === cur[0] && next[1] === cur[1];
    this.droneHeld = long ? 1 : 0;
    const beats = this.beats * (long ? 2 : 1) + 0.35, a = long ? 1.2 : 0.7;
    this.note(c, 'tagel', cur[0], t, beats, vel, a, 1.4);
    this.note(c, 'tagel', cur[1], t, beats, vel * 0.8, a + 0.2, 1.4);
    if (third && cur[0] === 38) this.note(c, 'tagel', 50, t, beats, vel * 0.45, a + 0.4, 1.4);
  }

  /** The swell of a four-bar phrase: strongest in its third bar. */
  private phrase(b: number): number {
    return 0.82 + 0.18 * Math.sin((Math.PI * ((this.secBar % 4) + b / this.beats)) / 4);
  }
  private pad(c: Chan, instr: InstrName, chd: Chord, t: number, vel: number, lo: number, hi: number, a = 0.5, r = 0.9): void {
    this.voicing = voiceLead(chd, this.voicing, lo, hi);
    for (const m of this.voicing) this.note(c, instr, m, t, this.beats, vel, a, r);
  }

  // ------------------------------------------------------------------------------------------
  // TITLE
  private titleForm(): TitleSeg[] {
    const r = this.rng;
    const seg = (sec: Section, dyn: number, lead: Lead, pad: InstrName | null, drums: 0 | 1 | 2, ost: boolean, bell: boolean): TitleSeg =>
      ({ sec, dyn, lead, pad, drums, ost, bell, arp: r.int(0, ARP4.length - 1), bass: dyn > 0.4 });
    const inter: TitleSeg = { sec: INTERLUDE, dyn: 0.3, lead: r.pick<Lead>(['tagel', 'none', 'lyre']), pad: 'mm', drums: 0, arp: r.int(0, ARP4.length - 1), ost: false, bell: false, bass: true };
    let f = r.int(0, 2);
    if (f === this.tForm) f = (f + 1) % 3;
    this.tForm = f;
    if (f === 0) return [
      seg(THEME, 0.35, 'lyre', r.chance(0.5) ? 'mm' : null, 0, false, false),
      seg(THEME, 0.62, 'horn', 'mm', 1, false, false),
      seg(STRAIN, 0.74, r.pick<Lead>(['tagel', 'choir']), 'str', 1, true, false),
      seg(THEME, 1, 'tutti', 'ah', 2, true, true),
      inter,
    ];
    if (f === 1) return [
      seg(STRAIN, 0.4, 'lyre', 'mm', 0, false, false),
      seg(THEME, 0.58, 'tagel', 'mm', 1, false, false),
      seg(THEME, 1, 'tutti', 'ah', 2, true, true),
      inter,
    ];
    return [
      seg(THEME, 0.45, 'choir', 'str', 0, false, false),
      seg(STRAIN, 0.7, 'horn', 'mm', 1, true, false),
      seg(THEME, 0.9, 'horn', 'ah', 2, true, true),
      seg(STRAIN, 1, 'tutti', 'ah', 2, true, false),
      inter,
    ];
  }

  private lead(kind: Lead, set: { lyre: Chan; tagel: Chan; horn: Chan; choir: Chan; call?: Chan }, m: Mel, t: number, vel: number): void {
    const tt = t + (m[1] - Math.floor(m[1])) * this.spb, len = m[2], midi = m[3], oct = this.sec.melOct ?? -12;
    switch (kind) {
      case 'lyre': this.pluck(set.lyre, midi, tt, vel * 0.9); if (len >= 2) this.pluck(set.lyre, midi - 12, tt, vel * 0.4); break;
      case 'tagel': this.note(set.tagel, 'tagel', midi, tt, len * 0.96, vel * 0.8, 0.09, 0.25); break;
      case 'horn': this.note(set.horn, 'horn', midi + oct, tt, len * 0.94, vel, 0.05, 0.22); break;
      case 'choir': this.note(set.choir, 'ah', midi, tt, len * 0.98, vel * 0.8, 0.14, 0.4); break;
      case 'call': if (set.call) this.note(set.call, 'horn', midi + (this.sec.melOct ?? 0), tt, len, vel, 0.1, 0.6); break;
      case 'tutti':
        this.note(set.horn, 'horn', midi + oct, tt, len * 0.94, vel, 0.05, 0.22);
        this.note(set.choir, 'ah', midi, tt, len * 0.98, vel * 0.75, 0.12, 0.4);
        this.note(set.tagel, 'tagel', midi, tt, len * 0.96, vel * 0.5, 0.09, 0.25);
        break;
      default:
    }
  }

  private titleBeat(t: number, b: number): void {
    const o = this.tSeg!, k = this.secBar, chd = this.sec.chords[k], spb = this.spb, dyn = o.dyn, phr = this.phrase(b);
    const intro = this.sec === INTRO;
    // the drone
    if (b === 0) this.drone(T.drone, t, 0.5 + 0.3 * dyn, intro || dyn > 0.8);
    if (b === 0 && o.bass) {
      this.note(T.bass, 'str', bassOf(chd, 36), t, 4, 0.45 + 0.3 * dyn, 0.25, 0.5);
      if (dyn > 0.8) this.note(T.bass, 'str', bassOf(chd, 36) - 12, t, 4, 0.5, 0.2, 0.5);
    }
    if (b === 0 && o.pad) this.pad(T.pad, o.pad, chd, t, (0.3 + 0.25 * dyn) * phr, 55, 74);
    for (const m of this.melAt(b)) this.lead(o.lead, T, m, t, (0.62 + 0.38 * dyn) * phr);
    // lyre: accompanies unless it has the tune (then it only adds a thumbed bass)
    if (o.lead === 'lyre') { if (b === 0) this.pluck(T.lyre, bassOf(chd, 48), t, 0.45); }
    else if (o.arp >= 0 && dyn < 0.95) this.arp(T.lyre, chd, ARP4[o.arp], b, t, 0.42 * phr);
    if (intro && k >= 2) this.arp(T.lyre, chd, [0, -1, 2, -1, 3, 4, -1, 2], b, t, 0.4);
    // strings ostinato under the bigger statements: long-short-short on root and fifth
    if (o.ost) {
      const root = bassOf(chd, 36);
      this.note(T.ost, 'spicc', b % 2 ? root + 7 : root, t, 0, 0.8 * phr);
      this.note(T.ost, 'spicc', root, t + 0.5 * spb, 0, 0.5 * phr);
      if (dyn > 0.9) this.note(T.ost, 'spicc', root + 12, t + 0.75 * spb, 0, 0.42 * phr);
    }
    // drums
    const fill = (k % 4 === 3) && b === 3;
    if (o.drums === 1) {
      if (b === 0) this.war(T.war, t, 0.6);
      if (b === 2) this.frame(T.frame, 'dum', t, 0.55);
      if (b === 3 && this.rng.chance(0.5)) this.frame(T.frame, 'ka', t + 0.5 * spb, 0.35);
    } else if (o.drums === 2) {
      if (k === 0 && b === 0) this.drum(T.war, 'm.hit', t, 0.75);
      if (b === 0) this.war(T.war, t, 0.95);
      if (b === 2) { this.war(T.war, t, 0.65); this.war(T.war, t + 0.5 * spb, 0.55); }
      if (b === 1 || (b === 3 && !fill)) this.frame(T.frame, 'tak', t, 0.5);
      if (fill) for (let s = 0; s < 4; s++) this.frame(T.frame, 'dum', t + s * 0.25 * spb, 0.35 + s * 0.15);
    }
    if (o.bell && b === 0 && (k === 0 || k === 4)) this.sink.note(T.bell, 'bell', k === 0 ? 74 : 69, t, 0, 0.6);
  }

  // ------------------------------------------------------------------------------------------
  // HALL
  private hallOrchestrate(first: boolean): void {
    const r = this.rng;
    this.hOrc = {
      mel: first ? 'none' : r.pick(['tagel', 'mm', 'lyre', 'tagel', 'mm', 'none'] as const),
      arp: r.int(0, ARP3.length - 1),
      pad: r.chance(0.45),
      drum: r.chance(0.3),
      fullDrone: r.chance(0.6),
      endStrum: r.chance(0.6),
    };
  }

  private hallBeat(t: number, b: number): void {
    const o = this.hOrc, k = this.secBar, chd = this.sec.chords[k], spb = this.spb, phr = this.phrase(b);
    if (b === 0) this.drone(H.drone, t, o.fullDrone ? 0.34 : 0.28);
    // the lyre never stops, but it breathes: the last bar of a section is a slow rolled chord
    if (k === 7 && o.endStrum) {
      if (b === 0) { const s = this.stack(chd); [0, 2, 3, 4].forEach((i, n) => this.pluck(H.lyre, s[i], t + n * 0.045, 0.5)); }
    } else this.arp(H.lyre, chd, ARP3[o.arp], b, t, 0.5 * phr);
    // the lullaby, when someone takes it up
    for (const m of this.melAt(b)) {
      const tt = t + (m[1] - Math.floor(m[1])) * spb;
      if (o.mel === 'tagel') this.note(H.mel, 'tagel', m[3], tt, m[2] * 0.96, 0.5 * phr, 0.12, 0.3);
      else if (o.mel === 'mm') this.note(H.hum, 'mm', m[3] - 12, tt, m[2] * 0.98, 0.55 * phr, 0.2, 0.4);
      else if (o.mel === 'lyre') this.pluck(H.lyreHi, m[3] + 12, tt, 0.5 * phr);
    }
    if (o.pad && b === 0) this.pad(H.pad, 'mm', chd, t, 0.28, 50, 67, 0.7, 1.0);
    if (o.drum) {
      if (b === 0 && k % 2 === 0) this.frame(H.drum, 'dum', t, 0.4);
      if (b === 2 && k % 4 === 3) this.frame(H.drum, 'ka', t + 0.5 * spb, 0.3);
    }
  }

  // ------------------------------------------------------------------------------------------
  // ARENA
  private arenaOrchestrate(): void {
    const r = this.rng;
    const w1 = r.int(0, 2);
    this.aOrc = {
      ost: r.int(0, 2), frame: r.int(0, 1),
      war: [w1, (w1 + r.int(1, 2)) % 3],
      fills: [r.int(0, 3), r.int(0, 2)],
      callBar: r.pick([2, 6]), bell: r.chance(0.5),
    };
  }

  /** Layer levels as continuous functions of the smoothed intensity and danger. */
  private arenaLayers(t: number, tau: number): void {
    const I = this.I, D = this.D, L = this.aLevel;
    L.drone = 1 - 0.5 * smoothstep(0.4, 0.8, I);
    L.sparse = 1 - smoothstep(0.3, 0.65, I);
    L.pulse = smoothstep(0.1, 0.35, I) * (0.75 + 0.25 * I);
    L.war = smoothstep(0.33, 0.6, I) * (0.7 + 0.3 * I);
    L.pad = smoothstep(0.4, 0.72, I);
    L.lead = smoothstep(0.58, 0.82, I);
    L.danger = smoothstep(0.15, 0.5, D);
    for (const k of ARENA_LAYERS) this.sink.setLayer('arena', k, L[k], t, tau);
  }

  private arenaBeat(t: number, b: number): void {
    const o = this.aOrc, sec = this.sec, k = this.secBar, chd = sec.chords[k], spb = this.spb, I = this.I, D = this.D, L = this.aLevel;
    const phr = this.phrase(b), bass = bassOf(chd, 36), on = 0.03;

    // ---- the drone never leaves
    if (b === 0) this.drone(A.drone, t, 0.55, k % 4 === 0);

    // ---- sparse: a lone lyre, a far-off horn, a bell, a soft drum. The island holding its breath.
    if (L.sparse > on) {
      if (b === 0) this.aFig = this.rng.chance(0.6) ? this.rng.pick(FIGURES) : [];
      if (this.aFig.length) {
        const s = this.stack(chd);
        for (const [step, idx] of this.aFig) if (step >> 1 === b) this.pluck(A.lyre, s[Math.min(idx, s.length - 1)] + (idx > 2 ? 0 : 12), t + (step & 1) * 0.5 * spb, 0.55);
      }
      if (b === 0 && k === o.callBar) {
        const up = this.rng.chance(0.5);
        this.note(A.call, 'horn', up ? 57 : 50, t, 1.4, 0.6, 0.1, 0.5);
        this.note(A.call, 'horn', up ? 62 : 57, t + 1.5 * spb, 3.6, 0.7, 0.1, 0.9);
      }
      if (b === 0 && k === 0 && o.bell) this.sink.note(A.bell, 'bell', 74, t, 0, 0.5);
      if (b === 0 && k % 2 === 1) this.war(A.soft, t, 0.5);
      if (b === 2 && this.rng.chance(0.35)) this.frame(A.soft, 'ka', t + 0.75 * spb, 0.4);
    }

    // ---- pulse: low strings ostinato, bass, frame drum
    if (L.pulse > on) {
      const root = bass, gallop = I > 0.72 || D > 0.5; // cellos, below the horns
      for (let e = 0; e < 2; e++) {
        const i8 = b * 2 + e;
        if (e === 1 && I < 0.2) continue;
        let m = root, acc = false;
        if (o.ost === 0) { acc = i8 === 0 || i8 === 3 || i8 === 6; m = i8 === 3 ? root + 7 : i8 === 6 ? root + 12 : root; } // 3 + 3 + 2
        else if (o.ost === 1) { acc = e === 0; m = [root, root + 7, root, root + 7, root + 12, root + 7, root, root + 7][i8]; }
        else { acc = e === 0; m = i8 === 7 ? root + 7 : root; }
        this.note(A.ost, 'spicc', m, t + e * 0.5 * spb, 0, (acc ? 0.85 : 0.5) * phr);
      }
      if (gallop) {
        this.note(A.ost, 'spicc', root, t + 0.75 * spb, 0, 0.42);
        if (D > 0.75) this.note(A.ost, 'spicc', root, t + 0.25 * spb, 0, 0.36);
      }
      if (b === 0) {
        this.note(A.bass, 'str', bass - 12, t, 4, 0.55, 0.08, 0.3);
        this.note(A.bass, 'str', bass, t, 4, 0.4, 0.08, 0.3);
      }
      const fp = FRAME[o.frame];
      for (let s = 0; s < 4; s++) {
        const e = fp[b * 4 + s];
        if (e && I >= e[2]) this.frame(A.frame, e[0], t + s * 0.25 * spb, e[1] * smoothstep(e[2], e[2] + 0.12, I + 0.02));
      }
      // while the horns are silent, the tagelharpa remembers the opening of each phrase
      if (L.lead < 0.3 && (k % 4) < 2 && sec.melOct === undefined) {
        for (const m of this.melAt(b)) this.note(A.frag, 'tagel', m[3], t + (m[1] - Math.floor(m[1])) * spb, m[2] * 0.96, 0.55 * phr, 0.09, 0.3);
      }
    }

    // ---- war drums
    if (L.war > on) {
      const fillBar = k % 4 === 3, fill = fillBar ? o.fills[(k >> 2) & 1] : 3;
      if (fillBar && b >= 2 && fill !== 3) {
        const s0 = (b - 2) * 4;
        if (fill === 0) {
          for (let s = 0; s < 4; s++) { const n = s0 + s; if (n === 7) this.war(A.war, t + s * 0.25 * spb, 0.9); else this.frame(A.war, 'dum', t + s * 0.25 * spb, 0.4 + 0.08 * n); }
        } else if (fill === 1) {
          for (let s = 0; s < 3; s++) { const n = (b - 2) * 3 + s; this.war(A.war, t + (s / 3) * spb, n === 5 ? 0.95 : 0.45 + 0.08 * n); }
        } else {
          for (let s = 0; s < 4; s++) { const n = s0 + s; if (n === 0 || n === 3 || n === 6) this.war(A.war, t + s * 0.25 * spb, 0.8 + n * 0.025); }
        }
      } else {
        const wp = WAR[I < 0.5 ? 3 : o.war[(k >> 2) & 1]];
        for (let s = 0; s < 4; s++) { const v = wp[b * 4 + s]; if (v) this.war(A.war, t + s * 0.25 * spb, v * (0.75 + 0.25 * I)); }
      }
      if (k === 0 && b === 0 && I > 0.6) this.drum(A.war, 'm.hit', t, 0.8);
      if (I > 0.78 && sec === DRIVE && (b === 1 || b === 3)) this.drum(A.anvil, 'm.anvil' + (b === 1 ? 0 : 1), t, 0.6);
      else if (I > 0.7 && b === 0 && k % 4 === 0) this.drum(A.anvil, 'm.anvil0', t, 0.5);
    }

    // ---- pad: choir and mid strings holding the harmony
    if (L.pad > on && b === 0) {
      this.pad(A.choir, 'ah', chd, t, (0.42 + 0.2 * I) * phr, 55, 74, 0.35, 0.6);
      this.note(A.strpad, 'str', bass + 12, t, 4, 0.4, 0.3, 0.5);
      this.note(A.strpad, 'str', bass + 19, t, 4, 0.34, 0.3, 0.5);
    }

    // ---- lead: horns carry the tune; at the top the choir doubles it
    if (L.lead > on) {
      const oct = sec.melOct ?? -12;
      for (const m of this.melAt(b)) {
        const tt = t + (m[1] - Math.floor(m[1])) * spb;
        this.note(A.horn, 'horn', m[3] + oct, tt, m[2] * 0.94, 0.9 * phr, 0.05, 0.2);
        if (I > 0.85) this.note(A.top, 'ah', m[3] + oct + 12, tt, m[2] * 0.98, 0.6 * phr, 0.1, 0.35);
      }
    }

    // ---- danger: a heartbeat, tremolo climbing, a rattle of sixteenths
    if (L.danger > on) {
      if (D >= 0.55 || b % 2 === 0) this.sink.hit(A.heart, 'm.heart', t, 0.6 + 0.4 * D);
      if (b === 0 && k % 2 === 0) {
        const v = 0.3 + 0.4 * D;
        this.note(A.trem, 'trem', 69, t, 8.2, v, 0.8, 0.8);
        if (D >= 0.6) this.note(A.trem, 'trem', 74, t, 8.2, v * 0.9, 0.8, 0.8);
        if (D >= 0.85) this.note(A.trem, 'trem', 77, t, 8.2, v * 0.8, 0.8, 0.8);
      }
      if (D >= 0.45) for (let s = 0; s < 4; s++) this.drum(A.rattle, 'm.rattle' + (s & 1), t + s * 0.25 * spb, (s === 0 ? 0.6 : s === 2 ? 0.42 : 0.3) * D);
    }
  }

  // ------------------------------------------------------------------------------------------
  // RESULTS
  private resultsBeat(t: number, b: number): void {
    const k = this.secBar, spb = this.spb;
    if (this.sec === CADENCE) {
      if (k === 0) {
        // B-flat, then C, with the drums gathering
        const second = b >= 2;
        if (b === 0 || b === 2) {
          const hn = second ? [48, 52, 55] : [46, 50, 53], ah = second ? [60, 64, 67] : [58, 62, 65];
          for (const m of hn) this.note(R.horn, 'horn', m, t, 1.9, second ? 0.8 : 0.7, 0.06, 0.2);
          for (const m of ah) this.note(R.choir, 'ah', m, t, 1.95, second ? 0.5 : 0.4, 0.3, 0.4);
          this.note(R.bass, 'str', second ? 36 : 34, t, 1.95, 0.6, 0.1, 0.3);
          this.war(R.war, t, second ? 1 : 0.9);
        }
        if (b === 1) this.war(R.war, t + 0.5 * spb, 0.55);
        if (b === 3) for (let s = 0; s < 4; s++) this.frame(R.frame, 'dum', t + s * 0.25 * spb, 0.4 + s * 0.14);
        return;
      }
      // home: D major, held for two bars under a short fanfare
      if (k === 1 && b === 0) {
        this.drum(R.war, 'm.hit', t, 1);
        for (const m of [50, 57]) this.note(R.horn, 'horn', m, t, 7.6, 0.55, 0.06, 0.8);
        for (const m of [62, 66, 69, 74]) this.note(R.choir, 'ah', m, t, 7.6, 0.48, 0.15, 1.2);
        this.note(R.bass, 'str', 26, t, 7.6, 0.6, 0.1, 0.8);
        this.note(R.bass, 'str', 38, t, 7.6, 0.5, 0.1, 0.8);
        this.sink.note(R.bell, 'bell', 74, t, 0, 0.7);
      }
      if (k === 2 && b === 0) { this.sink.note(R.bell, 'bell', 69, t, 0, 0.5); this.war(R.war, t, 0.9); }
      if (k === 1 && b === 2) this.war(R.war, t + 0.5 * spb, 0.6);
      if (k === 1 && b === 3) this.war(R.war, t, 0.8);
      for (const m of this.melAt(b)) this.note(R.horn, 'horn', m[3], t + (m[1] - Math.floor(m[1])) * spb, m[2] * 0.94, 0.9, 0.05, 0.3);
      return;
    }
    // afterglow
    const chd = this.sec.chords[k], phr = this.phrase(b), tagelPass = this.rPass % 2 === 0;
    if (b === 0) this.drone(R.drone, t, 0.4);
    this.arp(R.lyre, chd, ARP4[(this.rPass + (k >> 2)) % ARP4.length], b, t, 0.45 * phr);
    if (b === 0) this.pad(R.pad, 'mm', chd, t, 0.3, 50, 69, 0.6, 1.0);
    for (const m of this.melAt(b)) {
      const tt = t + (m[1] - Math.floor(m[1])) * spb;
      if (tagelPass) this.note(R.tagel, 'tagel', m[3], tt, m[2] * 0.96, 0.5 * phr, 0.1, 0.3);
      else this.pluck(R.lyre, m[3] + 12, tt, 0.55 * phr);
    }
    if (b === 0 && k % 4 === 0) this.war(R.war, t, 0.45);
  }
}
