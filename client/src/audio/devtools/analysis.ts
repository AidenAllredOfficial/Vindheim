// Offline verification suite behind client/dev/audio.html?analyze=sfx|music|mix|all.
// Renders every sound and excerpts of the score through OfflineAudioContexts, measures them,
// checks the properties the game depends on, and draws contact sheets to look at.
// Dev-only: nothing in the game imports this file.

import { ELEMENT_LIST } from '@shared/elements';
import { bank, GROUP_ORDER, ENTITY, FX, TELEPORT, TELEPORT_DEFAULT, ELEMENT_IDS } from '../catalog';
import type { Sound } from '../bank';
import { SR, rmsOf, peakOf, shortTermRms, midiHz } from '../dsp';
import { analyze, loopSeam, bandDistance, drawWave, drawSpectrogram, db, envelope, fft, type Stats } from '../analyze';
import { buildMix, calibrateChain, makePanner, distanceCutoff, LOWPASS_FROM } from '../mix';
import { MusicPlayer, type MusicSink, type Chan } from '../music/player';
import { INSTRUMENTS, type InstrName } from '../music/instruments';
import { Conductor, type BarInfo, type ScoreState } from '../music/conductor';
import { UI_SOUNDS } from '../sfx/ui';
import { ANNOUNCE_KINDS } from '../sfx/announce';
import { SURFACES, STEP_VARIANTS } from '../sfx/core';
import { Ambience } from '../ambience';
import { HALL } from '@shared/world';
import type { Weather } from '@shared/weather';

export interface Row { group: string; key: string; s: Stats; seam?: { jump: number; levelDb: number; natural: number }; fails: string[]; data: Float32Array; sr: number }

export interface Report {
  rows: Row[];
  fails: string[];
  notes: string[];
  timings: Record<string, number>;
  done: boolean;
}

export const report: Report = { rows: [], fails: [], notes: [], timings: {}, done: false };

const fail = (msg: string): void => { report.fails.push(msg); console.log('FAIL ' + msg); };
const note = (msg: string): void => { report.notes.push(msg); console.log(msg); };
const f1 = (v: number): string => v.toFixed(1);
const f3 = (v: number): string => v.toFixed(3);
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const padL = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

export function rowLine(r: Row): string {
  const s = r.s;
  return `${pad(r.key, 30)} ${padL(s.dur.toFixed(2), 5)}s  pk ${f3(s.peak)}  rms ${f3(s.rms)}  cen ${padL(String(Math.round(s.centroid)), 5)}Hz  clip ${s.clipPct.toFixed(2)}%  dc ${s.dc.toFixed(4)}` +
    (r.seam ? `  seam x${f1(r.seam.jump)} ${f1(r.seam.levelDb)}dB(nat ${f1(r.seam.natural)})` : '') + (r.fails.length ? '  <-- ' + r.fails.join('; ') : '');
}

/** How much adjacent 80 ms windows normally differ in level inside a loop (99th percentile, dB). */
function naturalStep(d: Float32Array, sr: number, from: number, to: number): number {
  const w = Math.round(0.08 * sr), diffs: number[] = [];
  for (let i = from + w; i + w <= to; i += w >> 1) diffs.push(Math.abs(db(rmsOf(d, i, i + w)) - db(rmsOf(d, i - w, i))));
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length * 0.99)] ?? 0;
}

function measure(group: string, snd: Sound): Row {
  const d = snd.buffer.getChannelData(0), s = analyze(d, SR), fails: string[] = [];
  if (s.rms < 0.002 || s.peak < 0.01) fails.push('silent');
  if (s.clipPct > 0 || s.peak > 0.985) fails.push('clips');
  if (Math.abs(s.dc) > 0.01) fails.push('dc offset');
  const row: Row = { group, key: snd.key, s, fails, data: d, sr: SR };
  if (snd.isLoop) {
    const seam = loopSeam(d, SR, snd.loopStart, snd.loopEnd);
    const natural = naturalStep(d, SR, Math.round(snd.loopStart * SR), Math.round(snd.loopEnd * SR));
    row.seam = { ...seam, natural };
    if (seam.jump > 4) fails.push('seam click');
    if (Math.abs(seam.levelDb) > Math.max(1.5, natural + 0.5)) fails.push('seam level step');
  }
  for (const f of fails) fail(`${snd.key}: ${f}`);
  return row;
}

async function loadGroup(group: string): Promise<Row[]> {
  await bank.load(group);
  report.timings[group] = bank.timings[group];
  const rows: Row[] = [];
  for (const key of Object.keys(bank.defsOf(group))) {
    const snd = bank.get(key);
    if (!snd) { fail(`${key}: not rendered`); continue; }
    rows.push(measure(group, snd));
  }
  report.rows.push(...rows);
  const seconds = rows.reduce((a, r) => a + r.s.dur, 0);
  note(`[${group}] ${rows.length} sounds, ${seconds.toFixed(1)} s of audio, rendered in ${bank.timings[group]} ms`);
  return rows;
}

// ==============================================================================================
// SFX
// ==============================================================================================

export async function analyzeSfx(only: string | null): Promise<void> {
  const groups = GROUP_ORDER.filter((g) => g !== 'music' && (!only || g === only));
  for (const g of groups) {
    const rows = await loadGroup(g);
    for (const r of rows) console.log(rowLine(r));
  }
  if (only) return;
  const has = (k: string): boolean => bank.has(k);
  const need = (k: string, why: string): void => { if (!has(k)) fail(`missing sound ${k} (${why})`); };

  // ---- coverage: everything the game can ask for has a sound
  for (const el of ELEMENT_LIST) {
    for (const a of el.abilities) {
      need('cs.' + a.key, 'cast start'); need('cr.' + a.key, 'cast release');
      const cs = bank.get('cs.' + a.key);
      // a tell must be over by the time the ability comes out (zero-wind-up moves get a blip)
      if (cs && cs.buffer.duration > Math.max(a.windup, 0.08) + 0.08) fail(`cs.${a.key}: tell ${cs.buffer.duration.toFixed(2)} s outlasts its ${a.windup} s wind-up`);
    }
    for (const v of ['l', 'h', 't']) need(`hit.${el.id}.${v}`, 'hit layer');
  }
  for (const [kind, spec] of Object.entries(ENTITY)) {
    if (spec.spawn) need(spec.spawn, kind + ' spawn');
    if (spec.loop) { need(spec.loop, kind + ' loop'); if (bank.get(spec.loop) && !bank.get(spec.loop)!.isLoop) fail(`${spec.loop} is not a loop`); }
    for (const k of Object.values(spec.end ?? {})) need(k, kind + ' despawn');
  }
  for (const [kind, spec] of Object.entries(FX)) { need(spec.key, kind + ' fx'); if (spec.end) need(spec.end, kind + ' fx end'); }
  for (const pair of [...Object.values(TELEPORT), TELEPORT_DEFAULT]) for (const k of pair) need(k, 'teleport');
  for (const u of UI_SOUNDS) need('ui.' + u, 'ui');
  for (const a of ANNOUNCE_KINDS) need('ann.' + a, 'announcer');
  for (const s of SURFACES) { for (let v = 0; v < STEP_VARIANTS; v++) need(`step.${s}.${v}`, 'footstep'); need(`jump.${s}`, 'jump'); need(`land.${s}`, 'land'); }
  for (const k of ['hit.body.l0', 'hit.body.h0', 'hit.crit', 'hit.confirm.l', 'hit.confirm.h', 'hit.taken.l', 'hit.taken.h', 'hit.weapon.0', 'death.body', 'death.soul', 'death.fall', 'death.local', 'death.local.fall', 'kill.confirm', 'respawn', 'pop.freeze', 'pop.bubble', 'pickup', 'thunder.near', 'thunder.mid', 'thunder.far', 'fx.melee']) need(k, 'core');

  const byKey = new Map(report.rows.map((r) => [r.key, r]));

  // ---- every wind-up tell is its own sound
  const tells = ELEMENT_LIST.flatMap((el) => el.abilities.map((a) => byKey.get('cs.' + a.key))).filter((r): r is Row => !!r);
  const pairs: { d: number; pair: string }[] = [];
  for (let i = 0; i < tells.length; i++) for (let j = i + 1; j < tells.length; j++) {
    const a = tells[i], b = tells[j];
    pairs.push({ d: bandDistance(a.s.bands, b.s.bands) + Math.abs(a.s.dur - b.s.dur) * 20 + Math.abs(Math.log2(a.s.centroid / b.s.centroid)) * 6, pair: `${a.key} / ${b.key}` });
  }
  pairs.sort((x, y) => x.d - y.d);
  note(`tells: ${tells.length}; distance = band-profile dB + 20 x duration difference + 6 x octaves between centroids. Closest pairs: ` + pairs.slice(0, 5).map((x) => `${x.pair} ${x.d.toFixed(1)}`).join('; '));
  if (pairs[0].d < 3) fail(`two tells are nearly identical: ${pairs[0].pair}`);

  // ---- heavy hits outweigh light ones
  for (const el of ELEMENT_IDS) {
    const l = byKey.get(`hit.${el}.l`), h = byKey.get(`hit.${el}.h`);
    if (l && h && !(h.s.rms * Math.sqrt(h.s.dur) > l.s.rms * Math.sqrt(l.s.dur) * 1.3)) fail(`hit.${el}.h does not carry more energy than hit.${el}.l`);
  }

  // ---- the eight elements are spectrally distinct families
  const profile: Record<string, number[]> = {}, cent: Record<string, number> = {};
  for (const el of ELEMENT_IDS) {
    const rows = report.rows.filter((r) => r.group === 'el.' + el);
    const n = rows[0].s.bands.length, mean = new Array<number>(n).fill(0);
    let c = 0;
    for (const r of rows) { for (let i = 0; i < n; i++) mean[i] += Math.max(r.s.bands[i], -50) / rows.length; c += Math.log2(r.s.centroid) / rows.length; }
    profile[el] = mean; cent[el] = Math.pow(2, c);
  }
  note('element timbre: geometric-mean spectral centroid — ' + ELEMENT_IDS.map((e) => `${e} ${Math.round(cent[e])} Hz`).join(', '));
  note('element band profiles (dB re total; 31 63 125 250 500 1k 2k 4k 8k 14k):');
  for (const el of ELEMENT_IDS) note(`  ${pad(el, 6)} ${profile[el].map((v) => padL(v.toFixed(0), 4)).join(' ')}`);
  let minD = 1e9, minPair = '';
  note('pairwise band-profile distance (dB RMS):');
  for (const a of ELEMENT_IDS) {
    const line = ELEMENT_IDS.map((b) => { const d = bandDistance(profile[a], profile[b]); if (a < b && d < minD) { minD = d; minPair = a + '/' + b; } return padL(d.toFixed(1), 5); }).join(' ');
    note(`  ${pad(a, 6)} ${line}`);
  }
  note(`closest two elements: ${minPair} at ${minD.toFixed(1)} dB`);
  if (minD < 3) fail(`elements ${minPair} are not spectrally distinct (${minD.toFixed(1)} dB)`);
}

// ==============================================================================================
// MUSIC
// ==============================================================================================

export interface Excerpt { name: string; data: Float32Array; sr: number; s: Stats; rmsDb: number; bars: BarInfo[] }
export const excerpts: Excerpt[] = [];

async function renderScore(seconds: number, script: (t: number) => ScoreState, seed: number): Promise<{ mid: Float32Array; bars: BarInfo[]; notes: number; peak: number }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const mix = buildMix(ctx, ctx.destination);
  const player = new MusicPlayer(ctx, bank, mix.music, mix.musicWet);
  const cond = new Conductor(player, seed);
  const bars: BarInfo[] = [];
  cond.onBar = (b) => bars.push(b);
  cond.setState(script(0));
  cond.start(0.05);
  for (let t = 0; t < seconds; t += 0.1) { cond.setState(script(t)); cond.advance(t + 0.35, t); }
  const buf = await ctx.startRendering();
  const l = buf.getChannelData(0), r = buf.getChannelData(1), mid = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) mid[i] = (l[i] + r[i]) * 0.5;
  return { mid, bars, notes: player.started, peak: Math.max(peakOf(l), peakOf(r)) };
}

/** A sink that writes the score down instead of playing it. */
class Scribe implements MusicSink {
  events: { t: number; what: string }[] = [];
  note(ch: Chan, instr: string, midi: number, t: number): void { this.events.push({ t, what: `${ch.layer}/${ch.name}:${instr}:${midi}` }); }
  hit(ch: Chan, key: string, t: number): void { this.events.push({ t, what: `${ch.layer}/${ch.name}:${key}` }); }
  setLayer(): void { /* levels are not part of the notation */ }
  setScene(): void { /* nor are scene faders */ }
}

function variety(name: string, state: ScoreState, seconds: number, seed: number): void {
  const scribe = new Scribe(), cond = new Conductor(scribe, seed), bars: BarInfo[] = [];
  cond.onBar = (b) => bars.push(b);
  cond.setState(state);
  cond.start(0);
  for (let t = 0; t < seconds; t += 0.1) cond.advance(t + 0.35, t);
  // write each bar down as the set of its events on a 16th-note grid
  const sig: string[] = bars.map(() => '');
  const lists: string[][] = bars.map(() => []);
  let bi = 0;
  scribe.events.sort((a, b) => a.t - b.t);
  for (const e of scribe.events) {
    while (bi + 1 < bars.length && e.t >= bars[bi + 1].time - 1e-6) bi++;
    const spb = 60 / bars[bi].bpm;
    lists[bi].push(`${Math.round(((e.t - bars[bi].time) / spb) * 4)}@${e.what}`);
  }
  for (let i = 0; i < bars.length; i++) sig[i] = lists[i].sort().join('|');
  const n = bars.length - 1; // the last bar is incomplete
  const unique = new Set(sig.slice(0, n)).size;
  let twin = 0, twin4 = 0;
  for (let i = 0; i + 16 <= n; i++) if (sig.slice(i, i + 8).join('#') === sig.slice(i + 8, i + 16).join('#')) twin++;
  for (let i = 0; i + 8 <= n; i++) if (sig.slice(i, i + 4).join('#') === sig.slice(i + 4, i + 8).join('#')) twin4++;
  const sections = bars.filter((b) => b.bar === 0).map((b) => b.section).join(' ');
  note(`variety ${pad(name, 16)} ${n} bars in ${seconds} s, ${unique} distinct (${Math.round((100 * unique) / n)}%), back-to-back identical 8-bar blocks: ${twin}, 4-bar blocks: ${twin4}`);
  note(`    form: ${sections}`);
  if (twin > 0) fail(`${name}: an 8-bar block repeats note-for-note back to back`);
  if (unique / n < 0.5) fail(`${name}: only ${unique} of ${n} bars are distinct`);
}

/** Fundamental of a steady tone near `expect` Hz, by autocorrelation with parabolic refinement. */
function pitchNear(d: Float32Array, sr: number, expect: number): number {
  const period = sr / expect, n = Math.min(d.length - Math.ceil(period * 1.1) - 2, Math.max(2048, Math.ceil(period * 12)));
  const lo = Math.floor(period * 0.94), hi = Math.ceil(period * 1.06);
  const ac = (lag: number): number => { let s = 0; for (let i = 0; i < n; i++) s += d[i] * d[i + lag]; return s; };
  let best = lo, bv = -Infinity;
  const vals: number[] = [];
  for (let lag = lo - 1; lag <= hi + 1; lag++) { const v = ac(lag); vals.push(v); if (lag >= lo && lag <= hi && v > bv) { bv = v; best = lag; } }
  const i = best - (lo - 1), y0 = vals[i - 1], y1 = vals[i], y2 = vals[i + 1];
  const shift = y0 - 2 * y1 + y2 !== 0 ? (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2) : 0;
  return sr / (best + shift);
}

/** Share of spectral energy (100 Hz .. 2 kHz) falling on each pitch class, C = 0. */
function chroma(d: Float32Array, sr: number): number[] {
  const size = 16384, out = new Array<number>(12).fill(0), re = new Float64Array(size), im = new Float64Array(size);
  for (let i0 = 0; i0 + size <= d.length; i0 += size >> 1) {
    for (let k = 0; k < size; k++) { re[k] = d[i0 + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (size - 1))); im[k] = 0; }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) {
      const f = (k * sr) / size;
      if (f < 100 || f > 2000) continue;
      const semis = 69 + 12 * Math.log2(f / 440), near = Math.round(semis);
      if (Math.abs(semis - near) > 0.3) continue;
      out[((near % 12) + 12) % 12] += re[k] * re[k] + im[k] * im[k];
    }
  }
  const total = out.reduce((a, b) => a + b, 0) || 1;
  return out.map((v) => v / total);
}
const PC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/** Play single notes through the real player and measure the pitch that comes out. */
export async function tuningCheck(): Promise<void> {
  await bank.load('music');
  const tests: [InstrName, number[]][] = [['tagel', [38, 45, 57, 64, 72]], ['str', [26, 33, 43, 55]], ['horn', [38, 50, 57, 64]], ['ah', [50, 60, 69, 76]], ['mm', [45, 55, 62]], ['trem', [69, 74]], ['spicc', [38, 43, 44, 45, 46, 57]], ['lyre', [50, 57, 62, 69, 77, 86]]];
  let worst = 0, worstAt = '';
  const lines: string[] = [];
  for (const [instr, notes] of tests) {
    const ctx = new OfflineAudioContext(1, Math.ceil(notes.length * 1.5 * SR), SR);
    const player = new MusicPlayer(ctx, bank, ctx.destination, null);
    const chan: Chan = { scene: 'title', layer: 'main', name: 'test', gain: 1, pan: 0, send: 0 };
    player.setScene('title', 1, 0, 0.001);
    notes.forEach((m, i) => player.note(chan, instr, m, 0.05 + i * 1.5, INSTRUMENTS[instr].sustained ? 1.2 : 0, 1));
    const d = (await ctx.startRendering()).getChannelData(0);
    const cents = notes.map((m, i) => {
      const from = Math.round((0.05 + i * 1.5 + (INSTRUMENTS[instr].sustained ? 0.55 : instr === 'spicc' ? 0.02 : 0.06)) * SR);
      const c = 1200 * Math.log2(pitchNear(d.subarray(from, from + Math.round((instr === 'spicc' ? 0.2 : 0.6) * SR)), SR, midiHz(m)) / midiHz(m));
      if (Math.abs(c) > Math.abs(worst)) { worst = c; worstAt = `${instr} ${m}`; }
      return `${m}:${c >= 0 ? '+' : ''}${c.toFixed(1)}`;
    });
    lines.push(`${instr} ${cents.join(' ')}`);
  }
  note('tuning, cents off equal temperament (midi:cents) — ' + lines.join(' | '));
  note(`worst tuning error: ${worst.toFixed(1)} cents (${worstAt})`);
  if (Math.abs(worst) > 8) fail(`${worstAt} is ${worst.toFixed(1)} cents out of tune`);
}

export async function analyzeMusic(): Promise<void> {
  await calibrateChain();
  const rows = await loadGroup('music');
  for (const r of rows) console.log(rowLine(r));
  await tuningCheck();

  const steady = (scene: ScoreState['scene'], intensity = 0, danger = 0) => (): ScoreState => ({ scene, intensity, danger });
  const cases: [string, number, (t: number) => ScoreState][] = [
    ['title', 64, steady('title')],
    ['hall', 40, steady('hall')],
    ['arena I=0.00', 30, steady('arena', 0)],
    ['arena I=0.25', 30, steady('arena', 0.25)],
    ['arena I=0.50', 30, steady('arena', 0.5)],
    ['arena I=0.75', 30, steady('arena', 0.75)],
    ['arena I=1.00', 30, steady('arena', 1)],
    ['arena I=0.5 D=1', 30, steady('arena', 0.5, 1)],
    ['arena I=1 D=1', 30, steady('arena', 1, 1)],
    ['results', 30, steady('results')],
    // intensity climbing from nothing to everything
    ['arena ramp 0>1', 64, (t) => ({ scene: 'arena', intensity: Math.min(1, Math.max(0, (t - 8) / 44)), danger: 0 })],
    // a whole session: title, hall, a fight that builds, danger, the end
    ['journey', 80, (t) => (t < 9 ? { scene: 'title', intensity: 0, danger: 0 } : t < 22 ? { scene: 'hall', intensity: 0, danger: 0 } : t < 60.5 ? { scene: 'arena', intensity: Math.min(1, (t - 22) / 20), danger: t > 48 ? 1 : 0 } : { scene: 'results', intensity: 0, danger: 0 })],
  ];
  const level: Record<string, number> = {};
  for (const [name, seconds, script] of cases) {
    const t0 = performance.now();
    const { mid, bars, notes, peak } = await renderScore(seconds, script, 20261111);
    const s = analyze(mid, SR);
    const from = Math.min(mid.length >> 1, Math.round(8 * SR));
    const rmsDb = db(rmsOf(mid, from));
    level[name] = rmsDb;
    excerpts.push({ name, data: mid, sr: SR, s, rmsDb, bars });
    note(`score ${pad(name, 16)} ${seconds}s  ${padL(String(notes), 4)} notes  peak ${f3(peak)}  rms(after 8 s) ${f1(rmsDb)} dBFS  centroid ${Math.round(s.centroid)} Hz  clip ${s.clipPct.toFixed(3)}%  [rendered in ${Math.round(performance.now() - t0)} ms]`);
    if (peak >= 0.999 || s.clipPct > 0) fail(`score "${name}" clips (peak ${f3(peak)})`);
    if (rmsDb < -50) fail(`score "${name}" is silent`);
    if (name === 'title' || name === 'hall' || name === 'arena I=1.00' || name === 'results') {
      // is it in key? D dorian/aeolian uses D E F G A Bb B C; the results add F# (D major)
      const ch = chroma(mid, SR), allowed = name === 'results' ? [0, 2, 4, 5, 6, 7, 9, 10, 11] : [0, 2, 4, 5, 7, 9, 10, 11];
      const outside = ch.reduce((a, v, i) => a + (allowed.includes(i) ? 0 : v), 0);
      const top = ch.map((v, i) => [v, i] as [number, number]).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([v, i]) => `${PC[i]} ${Math.round(v * 100)}%`).join(', ');
      note(`    pitch classes: ${top}; outside the mode: ${(outside * 100).toFixed(1)}%`);
      if (outside > 0.1) fail(`score "${name}" has ${(outside * 100).toFixed(0)}% of its tonal energy outside the mode`);
      if (ch[2] + ch[9] < 0.3) fail(`score "${name}" is not centred on D and A`);
    }
    if (name === 'arena ramp 0>1') {
      const env = envelope(mid, SR, 4);
      note('    loudness every 4 s (dBFS): ' + env.map((v) => f1(v)).join(' '));
      const early = (env[1] + env[2]) / 2, late = (env[env.length - 3] + env[env.length - 2]) / 2;
      if (late - early < 6) fail(`intensity ramp only gains ${f1(late - early)} dB`);
    }
    if (name === 'journey') {
      // every scene change must begin exactly one bar after the last bar line of the old scene
      for (let i = 1; i < bars.length; i++) {
        const a = bars[i - 1], b = bars[i];
        if (a.scene === b.scene) continue;
        const beats = a.scene === 'hall' ? 3 : 4, expect = a.time + beats * (60 / a.bpm), err = Math.abs(b.time - expect);
        note(`    ${a.scene} -> ${b.scene} at ${b.time.toFixed(3)} s; previous bar line ${a.time.toFixed(3)} + one bar = ${expect.toFixed(3)} (error ${(err * 1000).toFixed(2)} ms)`);
        if (err > 0.002) fail(`scene change ${a.scene}->${b.scene} is off the bar line by ${(err * 1000).toFixed(1)} ms`);
      }
      const env = envelope(mid, SR, 4);
      note('    loudness every 4 s (dBFS): ' + env.map((v) => f1(v)).join(' '));
    }
  }
  // loudness must rise with intensity, and danger must add to it
  const ladder = ['arena I=0.00', 'arena I=0.25', 'arena I=0.50', 'arena I=0.75', 'arena I=1.00'];
  note('arena loudness by intensity: ' + ladder.map((n) => `${n.slice(8)} -> ${f1(level[n])} dBFS`).join(', '));
  for (let i = 1; i < ladder.length; i++) if (!(level[ladder[i]] > level[ladder[i - 1]] + 0.4)) fail(`music loudness does not rise from ${ladder[i - 1]} (${f1(level[ladder[i - 1]])}) to ${ladder[i]} (${f1(level[ladder[i]])})`);
  if (!(level['arena I=0.5 D=1'] > level['arena I=0.50'] + 0.3)) fail('danger does not add loudness at I=0.5');
  note(`danger at I=0.5 adds ${f1(level['arena I=0.5 D=1'] - level['arena I=0.50'])} dB; at I=1 adds ${f1(level['arena I=1 D=1'] - level['arena I=1.00'])} dB`);

  // the notation itself: does any state fall into an obvious loop within 2.5 minutes?
  variety('title', { scene: 'title', intensity: 0, danger: 0 }, 150, 7);
  variety('hall', { scene: 'hall', intensity: 0, danger: 0 }, 150, 7);
  variety('arena I=0', { scene: 'arena', intensity: 0, danger: 0 }, 150, 7);
  variety('arena I=0.5', { scene: 'arena', intensity: 0.5, danger: 0 }, 150, 7);
  variety('arena I=1', { scene: 'arena', intensity: 1, danger: 0 }, 150, 7);
  variety('arena I=1 D=1', { scene: 'arena', intensity: 1, danger: 1 }, 150, 7);
  variety('results', { scene: 'results', intensity: 0, danger: 0 }, 150, 7);
}

// ==============================================================================================
// MIX: distance, panning, ducking, headroom
// ==============================================================================================

/** Offline compressors need a moment before they pass signal at their steady gain. */
const SETTLE = 0.5;

async function renderVoice(key: string, pos: { x: number; y: number; z: number } | null, seconds: number, extra?: (ctx: OfflineAudioContext, mix: ReturnType<typeof buildMix>) => void): Promise<{ l: Float32Array; r: Float32Array }> {
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + SETTLE) * SR), SR);
  const mix = buildMix(ctx, ctx.destination);
  const s = bank.get(key)!;
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  if (s.isLoop) { src.loop = true; src.loopStart = s.loopStart; src.loopEnd = s.loopEnd; }
  let tail: AudioNode = src;
  if (pos) {
    const d = Math.hypot(pos.x, pos.y, pos.z);
    if (d > LOWPASS_FROM) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = distanceCutoff(d, !!s.def.heavy); tail.connect(lp); tail = lp; }
    const pan = makePanner(ctx, pos, s.def.ref ?? 5);
    tail.connect(pan); tail = pan;
    tail.connect(mix.world);
  } else tail.connect(mix.local);
  src.start(SETTLE);
  extra?.(ctx, mix);
  const buf = await ctx.startRendering();
  return { l: buf.getChannelData(0), r: buf.getChannelData(1) };
}

export async function analyzeMix(): Promise<void> {
  for (const g of ['ui', 'announce', 'core', 'foot', 'amb', 'el.ember', 'el.stone', 'el.dawn', 'music']) await bank.load(g);
  note(`master chain: this browser's compressors add ${f1(db(await calibrateChain()))} dB to quiet signals; cancelled, so the chain is unity below threshold`);
  const mid = (o: { l: Float32Array; r: Float32Array }): Float32Array => { const m = new Float32Array(o.l.length); for (let i = 0; i < m.length; i++) m[i] = (o.l[i] + o.r[i]) * 0.5; return m; };

  // ---- distance: 5 m is in your face, 60 m is a faint rumble
  note('distance (source straight ahead): level re 5 m and spectral centroid');
  for (const key of ['ent.meteor.impact', 'hit.body.h0', 'cs.fireball', 'step.rock.0']) {
    const def = bank.get(key)!.def, range = def.range ?? 80;
    const got: { d: number; lv: number; c: number }[] = [];
    for (const d of [2, 5, 20, 60, 120]) {
      if (d > range) continue;
      const m = mid(await renderVoice(key, { x: 0, y: 0, z: -d }, bank.get(key)!.buffer.duration + 1.2));
      got.push({ d, lv: db(rmsOf(m)), c: analyze(m, SR).centroid });
    }
    const at5 = got.find((g) => g.d === 5)!, at60 = got.find((g) => g.d === 60);
    if (at60) {
      // (measured after the master dynamics, which hold near sounds back a little)
      if (at60.lv - at5.lv > -12) fail(`${key}: only ${f1(at60.lv - at5.lv)} dB quieter at 60 m than at 5 m`);
      if (def.heavy && !(at60.c < at5.c * 0.8)) fail(`${key}: heavy impact is not darker at 60 m (${Math.round(at60.c)} vs ${Math.round(at5.c)} Hz)`);
    }
    note(`  ${pad(key, 20)} ref ${def.ref ?? 5} m, cull ${range} m: ` + [2, 5, 20, 60, 120].map((d) => { const g = got.find((x) => x.d === d); return g ? `${d}m ${f1(g.lv - at5.lv)}dB/${Math.round(g.c)}Hz` : `${d}m culled`; }).join('  '));
  }

  // ---- panning
  const right = await renderVoice('hit.body.l0', { x: 8, y: 0, z: 0 }, 1), left = await renderVoice('hit.body.l0', { x: -8, y: 0, z: 0 }, 1);
  const pr = db(rmsOf(right.r)) - db(rmsOf(right.l)), pl = db(rmsOf(left.l)) - db(rmsOf(left.r));
  note(`panning: source 8 m to the right -> R-L = ${f1(pr)} dB; to the left -> L-R = ${f1(pl)} dB`);
  if (pr < 6 || pl < 6) fail('panning does not separate left from right');
  if (pr > 20 || pl > 20) fail('a source to one side is all but silent in the other ear');

  // ---- duck: hit-stop style low-pass and dip, then recovery
  const ducked = mid(await renderVoice('amb.windHigh', null, 4.5, (_ctx, mix) => mix.duck(0.6, 1, 2.0)));
  const before = ducked.subarray(Math.round(1.3 * SR), Math.round(1.9 * SR)), during = ducked.subarray(Math.round(2.06 * SR), Math.round(2.3 * SR)), after = ducked.subarray(Math.round(3.9 * SR), Math.round(4.6 * SR));
  const dDb = db(rmsOf(during)) - db(rmsOf(before)), aDb = db(rmsOf(after)) - db(rmsOf(before));
  note(`duck(0.6 s, depth 1): level ${f1(dDb)} dB and centroid ${Math.round(analyze(before, SR).centroid)} -> ${Math.round(analyze(during, SR).centroid)} Hz during; ${f1(aDb)} dB two seconds later`);
  if (dDb > -4) fail('duck is too shallow');
  if (Math.abs(aDb) > 1.5) fail('mix does not recover after a duck');

  // ---- balance: what single events measure at the output with every volume at 1
  note('output level of single events at default volume settings (peak / loudest 60 ms RMS, dBFS):');
  const single = async (label: string, keys: string[], pos: { x: number; y: number; z: number } | null, bus: 'sfx' | 'ui' | 'stinger' = 'sfx'): Promise<void> => {
    const seconds = Math.max(...keys.map((k) => bank.get(k)!.buffer.duration)) + 0.6 + SETTLE;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
    const mix = buildMix(ctx, ctx.destination);
    for (const key of keys) {
      const snd = bank.get(key)!, src = ctx.createBufferSource();
      src.buffer = snd.buffer;
      if (bus !== 'sfx') src.connect(bus === 'ui' ? mix.ui : mix.stinger);
      else if (pos) { const pan = makePanner(ctx, pos, snd.def.ref ?? 5); src.connect(pan); pan.connect(mix.world); }
      else src.connect(mix.local);
      src.start(SETTLE);
    }
    const buf = await ctx.startRendering();
    const m = mid({ l: buf.getChannelData(0), r: buf.getChannelData(1) });
    note(`  ${pad(label, 44)} ${padL(f1(db(Math.max(peakOf(buf.getChannelData(0)), peakOf(buf.getChannelData(1))))), 6)} / ${padL(f1(db(shortTermRms(m, SR))), 6)}`);
  };
  await single('heavy hit at 5 m (body + ember layer)', ['hit.body.h0', 'hit.ember.h'], { x: 1, y: 0, z: -5 });
  await single('light hit at 5 m (body + ember layer)', ['hit.body.l0', 'hit.ember.l'], { x: 1, y: 0, z: -5 });
  await single('heavy hit dealt by me (+ confirm layer)', ['hit.body.h0', 'hit.ember.h', 'hit.confirm.h'], { x: 1, y: 0, z: -5 });
  await single('meteor impact at 8 m', ['ent.meteor.impact'], { x: 2, y: 0, z: -8 });
  await single('meteor impact at 60 m', ['ent.meteor.impact'], { x: 10, y: 0, z: -59 });
  await single('enemy tell (fireball) at 20 m', ['cs.fireball'], { x: 5, y: 0, z: -19 });
  await single('my own footstep (grass)', ['step.grass.0'], null);
  await single('footstep at 10 m (rock)', ['step.rock.0'], { x: 3, y: 0, z: -9.5 });
  await single('ui click', ['ui.click'], null, 'ui');
  await single('announcer: first blood', ['ann.firstblood'], null, 'stinger');
  await single('announcer: match start', ['ann.matchstart'], null, 'stinger');

  // ---- headroom: the busiest moment we can build must not clip after the master chain
  {
    const seconds = 14;
    const ctx = new OfflineAudioContext(2, seconds * SR, SR);
    const mix = buildMix(ctx, ctx.destination);
    // sliders at 1.0 relative to defaults 0.8 / 0.6 / 0.9 / 0.7
    mix.setVolumes({ master: (1 / 0.8) ** 2, music: (1 / 0.6) ** 2, sfx: (1 / 0.9) ** 2, ambience: (1 / 0.7) ** 2 }, 0);
    const player = new MusicPlayer(ctx, bank, mix.music, mix.musicWet);
    const cond = new Conductor(player, 99);
    cond.setState({ scene: 'arena', intensity: 1, danger: 1 });
    cond.start(0.05);
    for (let t = 0; t < seconds; t += 0.1) cond.advance(t + 0.35, t);
    const loud = ['ent.meteor.impact', 'fx.earthshatter', 'fx.sunlance', 'ent.rampart.shatter', 'fx.flamewave', 'hit.body.h0', 'hit.stone.h', 'hit.ember.h', 'hit.dawn.h', 'hit.confirm.h', 'hit.taken.h', 'death.body', 'ent.fireball.burst', 'fx.solarflare'];
    for (let n = 0; n < 4; n++) loud.forEach((key, i) => {
      const s = bank.get(key);
      if (!s) return;
      const src = ctx.createBufferSource();
      src.buffer = s.buffer;
      if (i % 3 === 0) src.connect(mix.local);
      else { const pan = makePanner(ctx, { x: (i % 5) - 2, y: 0, z: -3 }, s.def.ref ?? 5); src.connect(pan); pan.connect(mix.world); }
      src.start(8 + n * 1.2 + (i % 4) * 0.02);
    });
    for (const k of ['amb.windLow', 'amb.windHigh', 'amb.howl']) { const s = bank.get(k)!; const src = ctx.createBufferSource(); src.buffer = s.buffer; src.loop = true; src.connect(mix.ambience); src.start(0); }
    const buf = await ctx.startRendering();
    const l = buf.getChannelData(0), r = buf.getChannelData(1), m = mid({ l, r });
    const pk = Math.max(peakOf(l), peakOf(r)), s = analyze(m, SR);
    const quiet = db(rmsOf(m, 4 * SR, 8 * SR)), busy = db(rmsOf(m, 8 * SR, 13 * SR));
    excerpts.push({ name: 'stress mix', data: m, sr: SR, s, rmsDb: busy, bars: [] });
    note(`headroom: full war music + blizzard + 56 of the loudest sounds in 5 s, every slider at maximum: peak ${f3(pk)}, clipped ${s.clipPct.toFixed(4)}%, music alone ${f1(quiet)} dBFS, with the barrage ${f1(busy)} dBFS`);
    if (pk >= 0.999 || s.clipPct > 0) fail(`master chain lets the mix clip (peak ${f3(pk)})`);
  }
}

// ==============================================================================================
// AMBIENCE: the live ambience manager, run to a steady state for a few weathers and places
// ==============================================================================================

export async function analyzeAmbience(): Promise<void> {
  await bank.load('amb');
  await calibrateChain();
  const wx = (wind: number, snow: number, storm: number, aurora: number): Weather => ({ wind, snow, storm, aurora, windDir: 0.6, fog: 0, label: 'clear' });
  const arena = { x: 0, y: 2, z: 0 }, byFire = { x: 3, y: HALL.floorY + 1.6, z: HALL.firepit.z };
  const run = async (name: string, w: Weather, indoors: number, at: { x: number; y: number; z: number }): Promise<{ lv: number; cen: number; lr: number }> => {
    const seconds = 10, ctx = new OfflineAudioContext(2, seconds * SR, SR);
    const mix = buildMix(ctx, ctx.destination);
    const l = ctx.listener;
    if (l.positionX) { l.positionX.value = at.x; l.positionY.value = at.y; l.positionZ.value = at.z; }
    else (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(at.x, at.y, at.z);
    const amb = new Ambience(ctx, bank, mix.ambience, () => { /* creaks are one-shots; not part of the bed */ });
    for (let i = 0; i < 4; i++) amb.update(1, w, indoors, at, { x: 0, y: 0, z: -1 });
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), m = new Float32Array(L.length);
    for (let i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) * 0.5;
    const from = 3 * SR, st = analyze(m.subarray(from), SR), lv = db(rmsOf(m, from));
    excerpts.push({ name: 'ambience: ' + name, data: m, sr: SR, s: st, rmsDb: lv, bars: [] });
    const lr = db(rmsOf(L, from)) - db(rmsOf(R, from));
    note(`  ${pad(name, 44)} ${padL(f1(lv), 6)} dBFS  centroid ${padL(String(Math.round(st.centroid)), 5)} Hz  L-R ${f1(lr)} dB  peak ${f3(Math.max(peakOf(L), peakOf(R)))}`);
    if (lv < -70) fail(`ambience "${name}" is silent`);
    return { lv, cen: st.centroid, lr };
  };
  note('ambience at default volume settings (steady state):');
  const calm = await run('arena, clear and calm, aurora', wx(0.2, 0.14, 0, 1), 0, arena);
  await run('arena, steady snowfall', wx(0.45, 0.6, 0, 0.5), 0, arena);
  const bliz = await run('arena, blizzard', wx(0.9, 1, 0, 0.2), 0, arena);
  const storm = await run('arena, thunderstorm', wx(0.7, 0.3, 1, 0.1), 0, arena);
  const muff = await run('same blizzard heard from indoors', wx(0.9, 1, 0, 0.2), 1, arena);
  const fire = await run('hall, by the long fire, calm night', wx(0.2, 0.14, 0, 1), 1, byFire);
  const fireBliz = await run('hall, by the fire, blizzard outside', wx(0.9, 1, 0, 0.2), 1, byFire);
  if (bliz.lv - calm.lv < 6) fail(`a blizzard is only ${f1(bliz.lv - calm.lv)} dB louder than a calm night`);
  if (storm.lv - calm.lv < 3) fail('a thunderstorm barely changes the ambience');
  if (bliz.lv - muff.lv < 6 || muff.cen > bliz.cen * 0.6) fail(`indoors does not muffle the wind enough (${f1(muff.lv - bliz.lv)} dB, ${Math.round(bliz.cen)} -> ${Math.round(muff.cen)} Hz)`);
  if (fire.lr < 1.5) fail('the fire is not heard on the side it is on');
  if (fireBliz.lv - fire.lv > 6) fail('the blizzard drowns the hall fire');
  note(`  blizzard is ${f1(bliz.lv - calm.lv)} dB louder than calm; indoors it drops ${f1(bliz.lv - muff.lv)} dB and darkens ${Math.round(bliz.cen)} -> ${Math.round(muff.cen)} Hz; the fire (to the listener's left) is ${f1(fire.lr)} dB stronger in the left ear`);
}

// ==============================================================================================
// contact sheets
// ==============================================================================================

/** Waveform + spectrogram thumbnails of the measured sounds. */
export function drawSheet(canvas: HTMLCanvasElement, rows: { key: string; data: Float32Array; sr: number; fails?: string[] }[], cols: number, cellW: number, cellH: number): void {
  const n = rows.length, rowsN = Math.ceil(n / cols);
  canvas.width = cols * cellW; canvas.height = Math.max(1, rowsN * cellH);
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#070b14'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.font = '10px ui-monospace, Menlo, monospace'; c.textBaseline = 'top';
  rows.forEach((r, i) => {
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH, w = cellW - 4, wh = Math.floor((cellH - 14) * 0.4), sh = cellH - 14 - wh - 2;
    drawWave(c, r.data, x, y + 12, w, wh);
    drawSpectrogram(c, r.data, r.sr, x, y + 12 + wh + 1, w, sh);
    c.fillStyle = r.fails && r.fails.length ? '#ff7a6a' : '#cfe0ff';
    c.fillText(`${r.key} ${(r.data.length / r.sr).toFixed(2)}s`, x + 1, y + 1);
  });
}
