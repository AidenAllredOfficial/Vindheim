// Audio harness.
//   /dev/audio.html                      audition every sound, the score, the ambience
//   /dev/audio.html?analyze=sfx          offline analysis of every sound effect (add &group=el.ember for one bank)
//   /dev/audio.html?analyze=music        instruments, score excerpts by state, variety, bar-line checks
//   /dev/audio.html?analyze=mix          distance / panning / duck / headroom through the real mix graph
//   /dev/audio.html?analyze=amb          the ambience manager in several weathers, outdoors and in the hall
//   /dev/audio.html?analyze=all          everything
//       &view=sheet|table|log  &page=N   what to show (contact sheet of waveforms + spectrograms by default)
//   /dev/audio.html?smoke=1              start the live engine and drive every contract method once
// Analysis results are also left on window.__report.

import { createAudio, Engine } from '../src/audio';
import { bank, GROUP_ORDER, ENTITY, FX, ELEMENT_IDS } from '../src/audio/catalog';
import { analyzeSfx, analyzeMusic, analyzeMix, analyzeAmbience, tuningCheck, drawSheet, report, excerpts } from '../src/audio/devtools/analysis';
import { UI_SOUNDS } from '../src/audio/sfx/ui';
import { ANNOUNCE_KINDS } from '../src/audio/sfx/announce';
import { SURFACES } from '../src/audio/sfx/core';
import { settings } from '../src/settings';
import { ELEMENT_LIST, type ElementId, type EntityKind } from '@shared/elements';
import type { EntityState } from '@shared/types';
import { World, HALL } from '@shared/world';
import { weatherAt, type Weather } from '@shared/weather';
import type { MusicState } from '../src/contracts';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text = '', cls = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  parent.appendChild(e);
  return e;
};

// ================================================================================================
// analysis mode
// ================================================================================================

async function runAnalysis(mode: string): Promise<void> {
  (window as unknown as { __report: typeof report }).__report = report;
  const view = params.get('view') ?? 'sheet', page = Number(params.get('page') ?? 0);
  const log = el('div', app); log.id = 'log';
  log.textContent = `analysing "${mode}" …`;
  const t0 = performance.now();
  try {
    if (mode === 'sfx' || mode === 'all') await analyzeSfx(params.get('group'));
    if (mode === 'music' || mode === 'all') await analyzeMusic();
    if (mode === 'mix' || mode === 'all') await analyzeMix();
    if (mode === 'amb' || mode === 'all') await analyzeAmbience();
    if (mode === 'tuning') await tuningCheck();
  } catch (e) {
    report.fails.push('exception: ' + (e as Error).message);
    console.error(e);
  }
  const secs = report.rows.reduce((a, r) => a + r.s.dur, 0);
  const summary = `ANALYSIS DONE mode=${mode}: ${report.rows.length} sounds (${secs.toFixed(0)} s of audio, ${(secs * 32000 * 4 / 1048576).toFixed(1)} MB), ${excerpts.length} mix excerpts, ${report.fails.length} failures, ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  console.log(summary);
  log.textContent = [summary, ...report.fails.map((f) => 'FAIL ' + f), '', ...(view === 'log' ? report.notes : report.notes.slice(-14))].join('\n');
  if (view === 'table') {
    const table = el('table', app);
    const head = el('tr', table);
    for (const h of ['sound', 'dur s', 'peak', 'rms', 'centroid Hz', 'clip %', 'dc', 'seam', 'problems']) el('th', head, h);
    const per = 52;
    for (const r of report.rows.slice(page * per, page * per + per)) {
      const tr = el('tr', table, '', r.fails.length ? 'fail' : '');
      for (const v of [r.key, r.s.dur.toFixed(2), r.s.peak.toFixed(3), r.s.rms.toFixed(3), String(Math.round(r.s.centroid)), r.s.clipPct.toFixed(2), r.s.dc.toFixed(4), r.seam ? `x${r.seam.jump.toFixed(1)} ${r.seam.levelDb.toFixed(1)}dB` : '', r.fails.join('; ')]) el('td', tr, v);
    }
  } else if (view === 'sheet') {
    const canvas = el('canvas', app); canvas.id = 'sheet';
    if (excerpts.length && (mode === 'music' || mode === 'mix' || mode === 'amb' || params.get('excerpts'))) {
      drawSheet(canvas, excerpts.slice(page * 6, page * 6 + 6).map((e) => ({ key: `${e.name}  rms ${e.rmsDb.toFixed(1)} dBFS  peak ${e.s.peak.toFixed(2)}`, data: e.data, sr: e.sr })), 1, 1250, 128);
    } else {
      const cols = Number(params.get('cols') ?? 8), per = cols * Math.round(80 / cols);
      drawSheet(canvas, report.rows.slice(page * per, page * per + per), cols, Math.floor(1250 / cols), cols <= 4 ? 132 : 78);
    }
  }
  report.done = true;
}

// ================================================================================================
// interactive mode
// ================================================================================================

function runInteractive(smoke: boolean): void {
  const world = new World();
  const audio = createAudio(world) as Engine;
  (window as unknown as { audio: Engine }).audio = audio;

  // ---- state
  const lis = { x: 0, y: 2, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  const src = { dist: 6, az: 30, local: false };
  let indoors = 0, autoWeather = false, walking = false, stepIn = 0, time = 0;
  const weather: Weather = { snow: 0.2, wind: 0.3, windDir: 0.6, storm: 0, aurora: 0.8, fog: 0, label: 'clear' };
  const music: MusicState = { scene: 'title', intensity: 0, danger: 0 };
  let involves: 'dealt' | 'taken' | null = null;
  let surface = 'grass', why = 1, nextId = 1;
  const flying: { e: EntityState; ttl: number; why: number }[] = [];

  const srcPos = (): { x: number; y: number; z: number } => {
    const a = (src.az * Math.PI) / 180;
    return { x: lis.x + Math.sin(a) * src.dist, y: lis.y - 0.5, z: lis.z - Math.cos(a) * src.dist };
  };

  // ---- widgets
  const section = (title: string, parent: HTMLElement = app): HTMLDivElement => { el('h2', parent, title); return el('div', parent); };
  const row = (parent: HTMLElement, tag = ''): HTMLDivElement => { const r = el('div', parent, '', 'row'); if (tag) el('span', r, tag, 'tag'); return r; };
  const btn = (parent: HTMLElement, label: string, fn: () => void, cls = ''): HTMLButtonElement => { const b = el('button', parent, label, cls); b.addEventListener('click', () => { audio.unlock(); fn(); }); return b; };
  const slider = (parent: HTMLElement, label: string, min: number, max: number, value: number, fn: (v: number) => void, step = 0.01): void => {
    const l = el('label', parent, label + ' ');
    const i = el('input', l); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
    const out = el('span', l, ' ' + value);
    i.addEventListener('input', () => { out.textContent = ' ' + i.value; fn(Number(i.value)); });
  };
  const select = (parent: HTMLElement, label: string, options: string[], fn: (v: string) => void): void => {
    const l = el('label', parent, label + ' ');
    const s = el('select', l);
    for (const o of options) el('option', s, o).value = o;
    s.addEventListener('change', () => fn(s.value));
  };

  // ---- top
  const top = row(app);
  btn(top, 'Start audio (unlock)', () => { /* unlock happens in btn */ }, 'go');
  const status = el('div', app); status.id = 'status';
  const scope = el('canvas', app); scope.id = 'scope'; scope.width = 900; scope.height = 110;

  const cols = el('div', app, '', 'cols');
  const left = el('div', cols), right = el('div', cols);

  // ---- mix
  const vols = row(section('Volumes (settings store)', left));
  const s0 = settings.get();
  slider(vols, 'master', 0, 1, s0.masterVolume, (v) => settings.set({ masterVolume: v }));
  slider(vols, 'music', 0, 1, s0.musicVolume, (v) => settings.set({ musicVolume: v }));
  slider(vols, 'sfx', 0, 1, s0.sfxVolume, (v) => settings.set({ sfxVolume: v }));
  slider(vols, 'ambience', 0, 1, s0.ambienceVolume, (v) => settings.set({ ambienceVolume: v }));

  const lst = section('Listener & test source', left);
  const l1 = row(lst);
  slider(l1, 'distance m', 0, 150, src.dist, (v) => { src.dist = v; }, 0.5);
  slider(l1, 'azimuth °', -180, 180, src.az, (v) => { src.az = v; }, 1);
  const l2 = row(lst);
  slider(l2, 'indoors', 0, 1, 0, (v) => { indoors = v; });
  select(l2, 'listener', ['arena centre', 'in the hall by the fire', 'hall doorway', 'terrace'], (v) => {
    if (v === 'arena centre') { lis.x = 0; lis.y = 2; lis.z = 0; }
    else if (v === 'in the hall by the fire') { lis.x = 3; lis.y = HALL.floorY + 1.6; lis.z = HALL.firepit.z; }
    else if (v === 'hall doorway') { lis.x = 0; lis.y = HALL.floorY + 1.6; lis.z = HALL.maxZ + 1; }
    else { lis.x = HALL.terrace.x; lis.y = HALL.terrace.y + 1.6; lis.z = HALL.terrace.z; }
  });
  select(l2, 'play as', ['other fighter (positional)', 'local player'], (v) => { src.local = v === 'local player'; });
  select(l2, 'hits involve me', ['no', 'dealt', 'taken'], (v) => { involves = v === 'no' ? null : (v as 'dealt' | 'taken'); });

  const mus = section('Score', left);
  const m1 = row(mus);
  select(m1, 'scene', ['title', 'hall', 'arena', 'results'], (v) => { music.scene = v as MusicState['scene']; audio.setMusicState(music); });
  slider(m1, 'intensity', 0, 1, 0, (v) => { music.intensity = v; audio.setMusicState(music); });
  slider(m1, 'danger', 0, 1, 0, (v) => { music.danger = v; audio.setMusicState(music); });

  const wx = section('Weather', left);
  const w1 = row(wx);
  slider(w1, 'wind', 0, 1, weather.wind, (v) => { weather.wind = v; });
  slider(w1, 'snow', 0, 1, weather.snow, (v) => { weather.snow = v; });
  slider(w1, 'storm', 0, 1, weather.storm, (v) => { weather.storm = v; });
  slider(w1, 'aurora', 0, 1, weather.aurora, (v) => { weather.aurora = v; });
  slider(w1, 'wind from °', -180, 180, 35, (v) => { weather.windDir = (v * Math.PI) / 180; }, 1);
  const w2 = row(wx);
  btn(w2, 'follow weatherAt(clock)', () => { autoWeather = !autoWeather; });
  btn(w2, 'thunder 150 m', () => audio.thunder(150, 1));
  btn(w2, 'thunder 600 m', () => audio.thunder(600, 0.9));
  btn(w2, 'thunder 1800 m', () => audio.thunder(1800, 0.8));

  const uiS = section('Interface', left);
  const u1 = row(uiS);
  for (const u of UI_SOUNDS) btn(u1, u, () => audio.ui(u));
  const ann = section('Announcer', left);
  const a1 = row(ann);
  for (const a of ANNOUNCE_KINDS) btn(a1, a, () => audio.announce(a));

  const misc = section('World & fighters', left);
  const f1 = row(misc, 'footsteps');
  select(f1, '', [...SURFACES], (v) => { surface = v; });
  btn(f1, 'step', () => audio.footstep(surface, srcPos(), src.local, 'step'));
  btn(f1, 'jump', () => audio.footstep(surface, srcPos(), src.local, 'jump'));
  btn(f1, 'land', () => audio.footstep(surface, srcPos(), src.local, 'land'));
  btn(f1, 'walk on/off', () => { walking = !walking; });
  const d1 = row(misc, 'life & death');
  btn(d1, 'death', () => audio.death(srcPos(), false, null));
  btn(d1, 'death (I am the victim)', () => { audio.death(srcPos(), false, 'victim'); audio.duck(1.2, 1); });
  btn(d1, 'kill (I am the killer)', () => audio.death(srcPos(), false, 'killer'));
  btn(d1, 'ring-out fall', () => audio.death(srcPos(), true, null));
  btn(d1, 'my ring-out', () => { audio.death(srcPos(), true, 'victim'); audio.duck(1.5, 0.8); });
  btn(d1, 'respawn', () => audio.respawn(srcPos(), src.local));
  const t1 = row(misc, 'teleports & pops');
  for (const k of ['thunderstep', 'duskstep', 'deploy', 'other']) btn(t1, k, () => { const p = srcPos(); audio.teleport(k, p, { x: p.x + 8, y: p.y, z: p.z - 6 }); });
  btn(t1, 'freeze shatter', () => audio.pop('freeze', srcPos()));
  btn(t1, 'bubble pop', () => audio.pop('bubble', srcPos()));
  btn(t1, 'health rune', () => audio.pickup(srcPos(), src.local));
  btn(t1, 'duck 0.15 s (hit-stop)', () => audio.duck(0.15, 0.7));
  btn(t1, 'duck 1.2 s', () => audio.duck(1.2, 1));

  // ---- elements
  const spawn = (kind: EntityKind, elId: ElementId, reason: number): void => {
    const p = srcPos(), a = ((src.az + 90) * Math.PI) / 180;
    const fuse = kind === 'meteor' ? 1.15 : kind === 'thunderstrike' ? 0.75 : kind === 'sunlance' ? 1.0 : 0;
    const speed = ({ fireball: 36, iceshard: 46, boulder: 27, gustblade: 48, bubble: 15, dagger: 46, shade: 36, glint: 85, balllightning: 8.5, cyclone: 7.5, tidalwave: 15, rockshard: 30 } as Record<string, number>)[kind] ?? 0;
    const life = fuse || ({ firepatch: 3.6, cindertrail: 2.4, spikes: 1.1, rimerune: 6, icetrail: 3.2, balllightning: 4.5, rampart: 4, cyclone: 4.6, jetstream: 1.3, waterjet: 0.8, bubble: 2.4, tidalwave: 1.33, snare: 5.5, healrune: 6 } as Record<string, number>)[kind] || (speed ? Math.min(2, 60 / speed) : 1);
    const e: EntityState = { id: nextId++, k: kind, o: 1, el: ELEMENT_IDS.indexOf(elId), x: p.x, y: p.y, z: p.z, vx: Math.sin(a) * speed, vy: 0, vz: -Math.cos(a) * speed, yaw: 0, r: 1, life, age: 0, g: 0, p: fuse || (kind === 'spikes' ? 15 : 0), q: 0 };
    if (kind === 'spikes') { e.vx = Math.sin(a); e.vz = -Math.cos(a); }
    const count = kind === 'iceshard' || kind === 'dagger' ? 3 : kind === 'cindertrail' || kind === 'icetrail' ? 5 : 1;
    for (let i = 0; i < count; i++) {
      const c = { ...e, id: i ? nextId++ : e.id, x: e.x + (count > 3 ? i * 1.6 : 0) };
      setTimeout(() => { audio.entitySpawn(c); flying.push({ e: c, ttl: life, why: fuse ? 3 : reason }); }, kind === 'iceshard' ? i * 90 : count > 3 ? i * 40 : 0);
    }
  };
  const fxOf = (kind: EntityKind | 'melee', elId: ElementId): void => { const p = srcPos(); audio.fx(kind, elId, p, { x: p.x + 10, y: p.y, z: p.z - 14 }); };

  const whyRow = row(section('Elements — abilities, entities, hits', right));
  select(whyRow, 'despawn reason', ['1 hit the world', '0 expired', '2 hit a fighter', '3 triggered', '4 overloaded'], (v) => { why = Number(v[0]); });
  const kindsByEl: Record<string, EntityKind[]> = {
    ember: ['fireball', 'flamewave', 'meteor', 'firepatch', 'cindertrail'], frost: ['iceshard', 'spikes', 'rimerune', 'rimeburst', 'icetrail'],
    storm: ['arcbolt', 'balllightning', 'thunderstrike', 'staticburst'], stone: ['boulder', 'rampart', 'earthshatter', 'rockshard', 'leapslam'],
    gale: ['gustblade', 'cyclone', 'jetstream'], tide: ['waterjet', 'bubble', 'tidalwave'], umbra: ['dagger', 'snare', 'shade'], dawn: ['glint', 'solarflare', 'sunlance', 'raydash'],
  };
  for (const def of ELEMENT_LIST) {
    const box = el('div', right);
    const head = row(box);
    const name = el('span', head, def.name, 'el'); name.style.color = '#' + def.color.toString(16).padStart(6, '0');
    for (const a of def.abilities) {
      btn(head, a.name, () => {
        const p = srcPos();
        audio.castStart(def.id, a.slot, a.key, p, src.local);
        setTimeout(() => {
          audio.castRelease(def.id, a.slot, a.key, p, src.local);
          // what the game would do next for this ability
          const fx = a.fx as { ent?: EntityKind; burst?: { ent: EntityKind }; land?: { ent: EntityKind } };
          const ent = fx.ent ?? fx.burst?.ent ?? fx.land?.ent;
          if (a.key === 'sunlance') return;
          if (a.fx.t === 'melee') { if (involves) audio.hit(def.id, a.key, a.fx.hit.dmg, !!a.fx.hit.heavy, false, p, involves); }
          else if (ent && FX[ent]) fxOf(ent, def.id);
          else if (ent) spawn(ent, def.id, why);
        }, a.windup * 1000);
        if (a.key === 'sunlance') { spawn('sunlance', def.id, 0); setTimeout(() => fxOf('sunlance', def.id), 1000); }
      });
      btn(head, 'tell', () => audio.castStart(def.id, a.slot, a.key, srcPos(), src.local));
      btn(head, 'rel', () => audio.castRelease(def.id, a.slot, a.key, srcPos(), src.local));
    }
    const ents = row(box, '  entities / fx');
    for (const k of kindsByEl[def.id]) {
      const spec = ENTITY[k];
      if (spec.spawn || spec.loop || spec.end) btn(ents, k, () => spawn(k, def.id, why));
      if (FX[k]) btn(ents, k + ' fx', () => fxOf(k, def.id));
    }
    const hits = row(box, '  hits');
    btn(hits, 'tick 3', () => audio.hit(def.id, 'zone', 3, false, false, srcPos(), involves));
    btn(hits, 'light 8', () => audio.hit(def.id, def.abilities[1].key, 8, false, false, srcPos(), involves));
    btn(hits, 'light 14', () => audio.hit(def.id, def.abilities[1].key, 14, false, false, srcPos(), involves));
    btn(hits, 'melee', () => audio.hit(def.id, def.abilities[0].key, def.abilities[0].fx.t === 'melee' ? def.abilities[0].fx.hit.dmg : 10, false, false, srcPos(), involves));
    btn(hits, 'heavy 22', () => audio.hit(def.id, def.abilities[2].key, 22, true, false, srcPos(), involves));
    btn(hits, 'heavy 36', () => audio.hit(def.id, def.abilities[3].key, 36, true, false, srcPos(), involves));
    btn(hits, 'crit', () => audio.hit(def.id, def.abilities[0].key, 19, true, true, srcPos(), involves));
    btn(hits, 'terrain', () => fxOf('melee', def.id));
  }
  const wr = row(right, 'world');
  btn(wr, 'healrune', () => spawn('healrune', 'dawn', 0));

  // ---- frame loop
  const sc = scope.getContext('2d')!;
  const freq = new Uint8Array(1024), wave = new Uint8Array(2048);
  let last = performance.now(), peakVoices = 0;
  const frame = (): void => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now; time += dt;
    if (autoWeather) Object.assign(weather, weatherAt(time * 20));
    audio.update(dt, lis, fwd, weather, indoors);
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], e = f.e;
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt; e.age += dt;
      if (ENTITY[e.k].loop || ENTITY[e.k].fuse) audio.entityMove(e.id, e);
      if ((f.ttl -= dt) <= 0) { audio.entityDespawn(e.id, e.k, e, f.why); flying.splice(i, 1); }
    }
    if (walking && (stepIn -= dt) <= 0) { stepIn = 0.36; audio.footstep(surface, srcPos(), src.local, 'step'); }
    const d = audio.debug;
    peakVoices = Math.max(peakVoices, d.voices);
    status.textContent =
      `context: ${d.ctx ? `${d.ctx.state} @ ${d.ctx.sampleRate} Hz, t=${d.ctx.currentTime.toFixed(1)} s, base latency ${((d.ctx.baseLatency || 0) * 1000).toFixed(0)} ms` : 'not created (press Start)'}\n` +
      `voices: ${d.voices} (peak ${peakVoices})   entity loops: ${d.loops}   music notes sounding: ${d.musicVoices}\n` +
      `score: ${d.music ? `${d.music.scene ?? '—'} / ${d.music.section} bar ${d.music.bar + 1}  ${d.music.bpm.toFixed(0)} bpm  intensity ${d.music.intensity.toFixed(2)}  danger ${d.music.danger.toFixed(2)}` : '—'}\n` +
      `bank: ${GROUP_ORDER.map((g) => (bank.isLoaded(g) ? g : g + '…')).join(' ')}`;
    const an = d.mix?.analyser;
    if (an) {
      an.getByteFrequencyData(freq); an.getByteTimeDomainData(wave);
      sc.fillStyle = '#0d1420'; sc.fillRect(0, 0, scope.width, scope.height);
      sc.fillStyle = '#3d7fb0';
      for (let x = 0; x < 600; x++) { const k = Math.min(1023, Math.floor(Math.pow(1023, x / 599))); const h = (freq[k] / 255) * scope.height; sc.fillRect(x, scope.height - h, 1, h); }
      sc.strokeStyle = '#e8c36a'; sc.beginPath();
      for (let x = 0; x < 290; x++) { const y = (wave[Math.floor((x / 290) * 2047)] / 255) * scope.height; if (x === 0) sc.moveTo(610, y); else sc.lineTo(610 + x, y); }
      sc.stroke();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (smoke) void runSmoke(audio, spawn, fxOf);
}

/** Drive every method of the contract on the live engine and report what happened. */
async function runSmoke(audio: Engine, spawn: (k: EntityKind, e: ElementId, why: number) => void, fxOf: (k: EntityKind | 'melee', e: ElementId) => void): Promise<void> {
  const out: Record<string, unknown> = { errors: [] as string[] };
  (window as unknown as { __smoke: typeof out }).__smoke = out;
  const errors = out.errors as string[];
  window.addEventListener('error', (e) => errors.push(e.message));
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const attempt = (name: string, fn: () => void): void => { try { fn(); } catch (e) { errors.push(`${name}: ${(e as Error).message}`); } };
  out.unlockedBefore = audio.unlocked;
  out.ctxBefore = audio.debug.ctx ? 'exists' : 'none';
  // calls before unlock must be harmless no-ops
  attempt('pre-unlock', () => { audio.ui('click'); audio.announce('firstblood'); audio.hit('ember', 'fireball', 12, false, false, { x: 0, y: 0, z: 0 }, null); audio.duck(0.2, 1); audio.setMusicState({ scene: 'hall', intensity: 0, danger: 0 }); });
  audio.unlock();
  out.unlocked = audio.unlocked;
  await Promise.all(GROUP_ORDER.map((g) => bank.load(g)));
  out.bankMs = { ...bank.timings };
  await sleep(600);
  const ctx = audio.debug.ctx!;
  out.state = ctx.state; out.sampleRate = ctx.sampleRate;
  const tA = ctx.currentTime;
  const p = { x: 4, y: 1, z: -6 };
  let peak = 0;
  const watch = setInterval(() => { peak = Math.max(peak, audio.debug.voices); }, 20);
  for (const u of UI_SOUNDS) attempt('ui ' + u, () => audio.ui(u));
  await sleep(200);
  for (const a of ANNOUNCE_KINDS) attempt('announce ' + a, () => audio.announce(a));
  for (const def of ELEMENT_LIST) {
    for (const a of def.abilities) { attempt('cs ' + a.key, () => audio.castStart(def.id, a.slot, a.key, p, false)); attempt('cr ' + a.key, () => audio.castRelease(def.id, a.slot, a.key, p, a.slot === 0)); }
    attempt('hits ' + def.id, () => { audio.hit(def.id, 'x', 3, false, false, p, null); audio.hit(def.id, def.id + '_melee', 12, false, false, p, 'dealt'); audio.hit(def.id, 'x', 30, true, true, p, 'taken'); });
    await sleep(120);
  }
  for (const k of Object.keys(ENTITY) as EntityKind[]) attempt('entity ' + k, () => spawn(k, 'ember', 1));
  for (const k of [...Object.keys(FX), 'cyclone'] as (EntityKind | 'melee')[]) attempt('fx ' + k, () => fxOf(k, 'storm'));
  await sleep(500);
  out.loopsWhileSpawned = audio.debug.loops;
  attempt('misc', () => {
    audio.death(p, false, 'victim'); audio.death(p, true, 'killer'); audio.respawn(p, true); audio.teleport('thunderstep', p, p); audio.teleport('duskstep', p, p); audio.teleport('deploy', p, p); audio.teleport('??', p, p);
    audio.pop('freeze', p); audio.pop('bubble', p); audio.pickup(p, true);
    for (const s of [...SURFACES, 'lava']) { audio.footstep(s, p, false, 'step'); audio.footstep(s, p, true, 'jump'); audio.footstep(s, p, false, 'land'); }
    audio.thunder(100, 1); audio.thunder(2000, 0.5); audio.duck(0.3, 1); audio.applySettings();
  });
  for (const scene of ['hall', 'results', 'title', 'arena'] as const) { attempt('music ' + scene, () => audio.setMusicState({ scene, intensity: 1, danger: 1 })); await sleep(700); }
  // full war music: how many notes sound at once, and how far ahead of the clock are we scheduling?
  let poly = 0;
  const polyWatch = setInterval(() => { poly = Math.max(poly, audio.debug.musicVoices); }, 50);
  await sleep(9000);
  clearInterval(polyWatch);
  clearInterval(watch);
  out.musicPolyphonyPeak = poly;
  const d = audio.debug;
  out.advanced = Number((ctx.currentTime - tA).toFixed(2));
  out.peakVoices = peak; out.voicesAfter = d.voices; out.loopsAfter = d.loops; out.musicVoices = d.musicVoices; out.music = d.music;
  // tab hidden: with muteWhenHidden the clock must stop, and start again when shown
  settings.set({ muteWhenHidden: true });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  await sleep(900);
  out.stateHidden = ctx.state;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  await sleep(700);
  out.stateShown = ctx.state;
  const tB = ctx.currentTime;
  await sleep(500);
  out.runningAgain = ctx.currentTime > tB;
  out.done = true;
  console.log('SMOKE ' + JSON.stringify(out));
}

// ================================================================================================
const mode = params.get('analyze');
if (mode) void runAnalysis(mode);
else runInteractive(params.has('smoke'));
