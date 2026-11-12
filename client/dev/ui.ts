// Interface harness: the real UI over a stand-in painted backdrop, driven by a mock game.
//
//   /dev/ui.html?state=loading|title|private|hall|pedestal|arena|death|results|menu|settings|howto|scoreboard|chat|icons
//   &touch=1      force touch controls           &el=frost     element (pedestal focus / equipped)
//   &tab=controls settings / how-to tab          &hc=1 &cb=1 &rm=1 &lh=1 &scale=1.2   accessibility modes
//   &quiet=1      stop the random combat events  &room=CODE    simulate an invite link
//
// `window.ui` is the Ui, `window.mock` exposes go(state), and every action is logged to the console.

import { createUi } from '../src/ui/index';
import { abilityIcon, elementEmblem, runeGlyph, uiIcon, ABILITY_ICON_KEYS } from '../src/ui/icons';
import { settings } from '../src/settings';
import type { HudFrame, Nameplate, UiActions } from '../src/contracts';
import { ELEMENTS, ELEMENT_ORDER, type ElementId } from '@shared/elements';
import type { MatchInfo, MatchResults, Profile, RosterEntry } from '@shared/types';

const params = new URLSearchParams(location.search);
const q = (k: string, d = ''): string => params.get(k) ?? d;
const startState = q('state', 'title');
const quiet = q('quiet') === '1';

// ------------------------------------------------------------------------------------ backdrop
const canvas = document.getElementById('game') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
let scene: 'sky' | 'hall' = 'sky';

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function paint(t: number): void {
  const w = (canvas.width = Math.floor(innerWidth)), hh = (canvas.height = Math.floor(innerHeight));
  if (scene === 'hall') {
    // firelit timber hall
    const bg = g.createLinearGradient(0, 0, 0, hh);
    bg.addColorStop(0, '#0d0907'); bg.addColorStop(0.55, '#1d120b'); bg.addColorStop(1, '#0a0705');
    g.fillStyle = bg; g.fillRect(0, 0, w, hh);
    const fire = g.createRadialGradient(w * 0.5, hh * 0.78, 0, w * 0.5, hh * 0.78, hh * 0.9);
    const fl = 0.85 + Math.sin(t * 7) * 0.05 + Math.sin(t * 13.3) * 0.04;
    fire.addColorStop(0, `rgba(255,170,70,${0.85 * fl})`); fire.addColorStop(0.25, `rgba(210,95,30,${0.5 * fl})`); fire.addColorStop(1, 'rgba(40,14,4,0)');
    g.fillStyle = fire; g.fillRect(0, 0, w, hh);
    // posts and beams
    g.fillStyle = 'rgba(8,5,3,0.9)';
    for (let i = 0; i < 6; i++) {
      const x = w * (0.06 + i * 0.176), pw = w * 0.022 * (1 + Math.abs(i - 2.5) * 0.25);
      g.fillRect(x - pw / 2, 0, pw, hh);
    }
    g.fillRect(0, hh * 0.1, w, hh * 0.035);
    // cold door light
    const door = g.createRadialGradient(w * 0.5, hh * 0.42, 0, w * 0.5, hh * 0.42, hh * 0.3);
    door.addColorStop(0, 'rgba(120,170,230,0.55)'); door.addColorStop(1, 'rgba(60,100,170,0)');
    g.fillStyle = door; g.fillRect(0, 0, w, hh);
    // pedestal with a glowing shard
    const px = w * 0.36, py = hh * 0.62;
    g.fillStyle = '#20150e'; g.fillRect(px - 46, py, 92, hh * 0.3); g.fillRect(px - 60, py - 12, 120, 16);
    const glow = g.createRadialGradient(px, py - 70, 0, px, py - 70, 150);
    glow.addColorStop(0, 'rgba(140,220,255,0.95)'); glow.addColorStop(0.2, 'rgba(110,200,255,0.5)'); glow.addColorStop(1, 'rgba(60,140,220,0)');
    g.fillStyle = glow; g.fillRect(px - 160, py - 230, 320, 320);
    g.fillStyle = '#eafaff'; g.beginPath(); g.moveTo(px, py - 120); g.lineTo(px + 22, py - 60); g.lineTo(px, py - 22); g.lineTo(px - 22, py - 60); g.closePath(); g.fill();
    // embers
    const r = rand(7);
    for (let i = 0; i < 60; i++) {
      const ex = r() * w, sp = 0.02 + r() * 0.05, ey = hh - (((t * sp + r()) % 1) * hh);
      g.fillStyle = `rgba(255,${150 + Math.floor(r() * 80)},60,${0.25 + r() * 0.5})`;
      g.fillRect(ex + Math.sin(t + i) * 12, ey, 2, 2);
    }
    return;
  }
  // arctic dusk over the cloud sea
  const sky = g.createLinearGradient(0, 0, 0, hh);
  sky.addColorStop(0, '#06101f'); sky.addColorStop(0.42, '#12314a'); sky.addColorStop(0.62, '#3f4a5c'); sky.addColorStop(0.72, '#c2703a'); sky.addColorStop(0.78, '#6a4a50'); sky.addColorStop(1, '#141c2c');
  g.fillStyle = sky; g.fillRect(0, 0, w, hh);
  const r = rand(11);
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`; g.fillRect(r() * w, r() * hh * 0.5, 1.4, 1.4); }
  // moon
  const mx = w * 0.74, my = hh * 0.2, mr = Math.min(w, hh) * 0.085;
  const halo = g.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 4);
  halo.addColorStop(0, 'rgba(210,225,255,0.5)'); halo.addColorStop(1, 'rgba(210,225,255,0)');
  g.fillStyle = halo; g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  g.fillStyle = '#e9eef8'; g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  // aurora
  for (let b = 0; b < 3; b++) {
    g.beginPath();
    for (let x = 0; x <= w; x += 16) {
      const y = hh * (0.2 + b * 0.07) + Math.sin(x * 0.004 + t * 0.15 + b * 2) * hh * 0.05 + Math.sin(x * 0.011 - t * 0.1) * hh * 0.02;
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.lineWidth = hh * 0.07; g.strokeStyle = b === 1 ? 'rgba(150,110,255,0.10)' : 'rgba(90,240,170,0.13)'; g.stroke();
  }
  // island silhouettes
  const ridge = (base: number, amp: number, col: string, seed: number, drift: number): void => {
    const rr = rand(seed); const off = (t * drift) % 200;
    g.fillStyle = col; g.beginPath(); g.moveTo(0, hh);
    let y = base;
    for (let x = -200; x <= w + 200; x += 40) { y = base + (rr() - 0.5) * amp; g.lineTo(x + off, hh * y); }
    g.lineTo(w, hh); g.closePath(); g.fill();
  };
  ridge(0.66, 0.16, '#1b2638', 3, 0.6);
  ridge(0.74, 0.1, '#111a29', 5, 1.4);
  // warm braziers
  for (const [bx, by] of [[0.3, 0.72], [0.62, 0.69]]) {
    const gl = g.createRadialGradient(w * bx, hh * by, 0, w * bx, hh * by, hh * 0.16);
    gl.addColorStop(0, 'rgba(255,170,80,0.75)'); gl.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gl; g.fillRect(w * bx - hh * 0.2, hh * by - hh * 0.2, hh * 0.4, hh * 0.4);
  }
  // cloud sea
  const fog = g.createLinearGradient(0, hh * 0.8, 0, hh);
  fog.addColorStop(0, 'rgba(150,170,200,0)'); fog.addColorStop(1, 'rgba(150,170,200,0.4)');
  g.fillStyle = fog; g.fillRect(0, hh * 0.8, w, hh * 0.2);
}

// ------------------------------------------------------------------------------------ mock data
const NAMES = ['Sigrun', 'Hrafnkel', 'Astrid Stormborn', 'Ulf', 'Brynja', 'Ketil', 'Runa', 'Thorvald', 'Ingrid'];
const equipped = (ELEMENT_ORDER.includes(q('el') as ElementId) && startState !== 'pedestal' ? q('el') : 'ember') as ElementId;
const ownedCount = Number(q('owned', '2'));
const profile: Profile = {
  name: q('name', 'Sigrun'), glory: Number(q('glory', '620')), owned: ELEMENT_ORDER.slice(0, ownedCount) as ElementId[], equipped: ELEMENT_ORDER.indexOf(equipped) < ownedCount ? equipped : 'ember',
  stats: { kills: 412, deaths: 367, ringouts: 58, falls: 41, damage: 48211, hits: 3120, matches: 46, wins: 9, podiums: 21, bestStreak: 7, bestMatchKills: 17, gloryEarned: 12840, playSeconds: 15120, elementKills: { ember: 300, frost: 112 } },
  created: Date.now() - 86400000 * 12,
};
const roster: RosterEntry[] = NAMES.slice(0, 8).map((name, i) => ({
  id: i + 1, name, bot: i >= 3, dummy: false, el: i === 0 ? ELEMENT_ORDER.indexOf(equipped) : (i * 3 + 1) % 8,
  kills: [7, 12, 9, 4, 6, 2, 8, 5][i], deaths: [5, 4, 7, 9, 6, 11, 5, 8][i], streak: [2, 4, 0, 0, 1, 0, 3, 0][i], dmg: [820, 1310, 1040, 505, 700, 260, 915, 610][i], hall: i === 5, ping: [34, 61, 148, 0, 0, 0, 0, 0][i],
}));
const LOCAL = 1;
const match: MatchInfo = { phase: 'live', timeLeft: 187, killTarget: 20, round: 3 };

// ------------------------------------------------------------------------------------ the interface
const log = (name: string) => (...args: unknown[]): void => console.log(`[action] ${name}`, ...args.map((a) => JSON.stringify(a)));
const actions: UiActions = {
  setName: (n) => { log('setName')(n); profile.name = n; roster[0].name = n; ui.setProfile({ ...profile }); },
  play: (m) => { log('play')(m); window.setTimeout(() => go(m.type === 'public' ? 'hall' : 'hall'), 900); },
  leaveRoom: () => { log('leaveRoom')(); go('title'); },
  deploy: () => { log('deploy')(); go('arena'); },
  returnToHall: () => { log('returnToHall')(); go('hall'); },
  equip: (el) => { log('equip')(el); profile.equipped = el; frame.element = el; frame.trial = false; ui.setProfile({ ...profile }); },
  unlock: (el) => { log('unlock')(el); if (!profile.owned.includes(el)) { profile.glory -= ELEMENTS[el].cost; profile.owned = [...profile.owned, el]; frame.glory = profile.glory; ui.setProfile({ ...profile, owned: [...profile.owned] }); } },
  trial: (el) => { log('trial')(el); frame.element = el || profile.equipped; frame.trial = !!el; },
  sendChat: (text) => { log('sendChat')(text); ui.pushChat({ name: profile.name, text, system: false, self: true }); },
  setUiFocus: log('setUiFocus'),
  userGesture: log('userGesture'),
  playUiSound: (s) => { if (s !== 'hover') console.debug(`[sound] ${s}`); },
};

if (q('hc') === '1' || q('cb') === '1' || q('rm') === '1' || q('lh') === '1' || q('scale') || q('fps') === '1') {
  settings.set({ highContrast: q('hc') === '1', colorblind: q('cb') === '1', reduceMotion: q('rm') === '1', leftHanded: q('lh') === '1', uiScale: Number(q('scale', '1')), showFps: q('fps') === '1' });
}

const root = document.getElementById('ui-root')!;
const ui = createUi(root, actions);
if (q('touch') === '1') window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 99, bubbles: true }));

const frame: HudFrame = {
  inGame: false, zone: 'hall', alive: true, hp: 100, maxHp: 100, element: profile.equipped, trial: false,
  cooldown: [0, 0, 0, 0, 0], cooldownTotal: [0.5, 1, 6.5, 13, 4.5], activeSlot: -1, locked: [false, false, false, false, false],
  statuses: [], glory: profile.glory, respawnIn: 0, prompt: null, recall: 0, targetId: 0, ping: 34, fps: 60, weather: 'snowfall', streak: 0,
};

let state = '';
let mode: 'none' | 'hall' | 'arena' = 'none';
let t0 = performance.now();
let simT = 0;

function results(): MatchResults {
  const standings = roster.slice().sort((a, b) => b.kills - a.kills).map((r) => ({ id: r.id, name: r.name, bot: r.bot, el: r.el, kills: r.kills + 6, deaths: r.deaths + 3, dmg: r.dmg * 2 }));
  const place = standings.findIndex((s) => s.id === LOCAL) + 1;
  return { round: match.round, standings, you: { place, glory: 318, bonus: place <= 3 ? [120, 80, 50][place - 1] : 20, kills: 13, deaths: 8, dmg: 1640, bestStreak: 4 } };
}

function clickButton(text: string): boolean {
  const b = Array.from(root.querySelectorAll('button')).find((x) => (x.textContent || '').trim().toLowerCase().startsWith(text.toLowerCase()) && (x as HTMLElement).offsetParent !== null);
  if (b) (b as HTMLElement).click();
  return !!b;
}

function enterGame(zone: 'hall' | 'arena'): void {
  scene = zone === 'hall' ? 'hall' : 'sky';
  mode = zone;
  frame.inGame = true; frame.zone = zone; frame.alive = true; frame.hp = zone === 'hall' ? 100 : 78; frame.respawnIn = 0; frame.recall = 0;
  frame.prompt = null; frame.statuses = []; frame.streak = zone === 'arena' ? 3 : 0;
  ui.setScreen('game');
  ui.setConnection('online');
  ui.setProfile({ ...profile });
  ui.setRoom({ code: q('room', 'RAVN7'), isPrivate: true, bots: true, humans: 3, capacity: 8 });
  ui.setRoster(roster.map((r) => ({ ...r })), LOCAL);
  match.phase = zone === 'hall' && q('phase', 'intermission') === 'intermission' ? 'intermission' : 'live';
  match.timeLeft = match.phase === 'intermission' ? 14 : 187;
  ui.setMatch({ ...match });
  ui.showDeath(null); ui.showResults(null); ui.showPedestal(null); ui.showScoreboard(false); ui.setHint(null);
  ui.setHud(frame);
}

function go(next: string): void {
  state = next;
  t0 = performance.now(); simT = 0;
  console.log(`[harness] state → ${next}`);
  switch (next) {
    case 'loading':
      mode = 'none'; scene = 'sky'; frame.inGame = false;
      ui.setScreen('loading');
      break;
    case 'title': case 'private':
      mode = 'none'; scene = 'sky'; frame.inGame = false;
      ui.setScreen('title'); ui.setConnection('online'); ui.setProfile({ ...profile });
      if (next === 'private') window.setTimeout(() => clickButton('Private room'), 150);
      break;
    case 'hall':
      enterGame('hall');
      frame.prompt = { action: 'interact', text: 'Inspect Frost' };
      ui.setHint({ id: 'hall', title: 'The pedestal gallery', text: 'Walk up to a pedestal to study an element. Glory unlocks the next one.', actions: ['interact', 'deploy'] });
      break;
    case 'pedestal':
      enterGame('hall');
      ui.showPedestal((ELEMENT_ORDER.includes(q('el') as ElementId) ? q('el') : 'frost') as ElementId);
      break;
    case 'arena':
      enterGame('arena');
      ui.setHint(q('hint') === '0' ? null : { id: 'move', title: 'Nothing can be blocked', text: 'Keep moving. Tap jump just before landing to roll out of a knockdown.', actions: ['forward', 'left', 'back', 'right', 'jump'] });
      break;
    case 'death':
      enterGame('arena');
      frame.alive = false; frame.hp = 0; frame.respawnIn = 3.2;
      ui.showDeath({ killerName: 'Hrafnkel', killerEl: 'storm', ability: 'thunderstrike', fall: q('fall') === '1', respawnIn: 3.2 });
      break;
    case 'results':
      enterGame('arena');
      match.phase = 'results'; match.timeLeft = 11; ui.setMatch({ ...match });
      ui.showResults(results());
      break;
    case 'menu':
      enterGame(q('zone') === 'hall' ? 'hall' : 'arena');
      ui.toggleMenu(true);
      break;
    case 'settings': case 'howto':
      enterGame('arena');
      ui.toggleMenu(true);
      window.setTimeout(() => {
        clickButton(next === 'settings' ? 'Settings' : 'How to play');
        const tab = q('tab');
        if (tab) window.setTimeout(() => (root.querySelector(`.tab[data-tab="${tab}"]`) as HTMLElement | null)?.click(), 80);
      }, 120);
      break;
    case 'scoreboard':
      enterGame('arena');
      ui.showScoreboard(true);
      break;
    case 'chat':
      enterGame('arena');
      ui.pushChat({ name: '', text: 'Astrid Stormborn entered the hall.', system: true, self: false });
      ui.pushChat({ name: 'Hrafnkel', text: 'that meteor was personal', system: false, self: false, element: 'storm' });
      ui.pushChat({ name: 'Sigrun', text: 'it was', system: false, self: true });
      ui.pushChat({ name: 'Astrid Stormborn', text: 'stop standing on bridges then', system: false, self: false, element: 'gale' });
      window.setTimeout(() => ui.openChat(), 100);
      break;
    case 'icons':
      mode = 'none'; iconSheet();
      break;
    default:
      go('title');
  }
}

// ------------------------------------------------------------------------------------ icon sheet (design review)
function iconSheet(): void {
  ui.setScreen('game');
  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:16px 20px;background:#0b111e;color:#eef1f7;font:600 11px Inter Variable,system-ui;z-index:999;pointer-events:auto';
  let html = '';
  for (const id of ELEMENT_ORDER) {
    const d = ELEMENTS[id];
    const col = '#' + d.color.toString(16).padStart(6, '0'), core = '#' + d.core.toString(16).padStart(6, '0'), dark = '#' + d.dark.toString(16).padStart(6, '0');
    const rgbv = `${(d.color >> 16) & 255} ${(d.color >> 8) & 255} ${d.color & 255}`;
    html += `<div style="display:flex;align-items:center;gap:14px;margin-bottom:9px;--el:${col};--el-core:${core};--el-dark:${dark};--el-rgb:${rgbv}">` +
      `<div style="width:66px;color:${col};font-size:13px">${d.name}</div>` +
      `<span class="medal" style="width:52px;height:52px">${elementEmblem(id)}</span>` +
      `<span style="width:40px;height:40px;color:${col}">${runeGlyph(id)}</span>` +
      d.abilities.map((a) => `<div style="text-align:center;width:104px"><span class="tile" style="width:66px;height:66px;margin:0 auto">${abilityIcon(a.key)}</span><div style="margin-top:3px;color:#b6c0d2">${a.name}</div></div>`).join('') +
      d.abilities.slice(0, 5).map((a) => `<span style="width:22px;height:22px;color:${core}">${abilityIcon(a.key)}</span>`).join('') +
      `</div>`;
  }
  const names = ['close', 'check', 'left', 'right', 'up', 'down', 'play', 'gear', 'copy', 'link', 'crown', 'bot', 'skull', 'chat', 'menu', 'list', 'lock', 'glory', 'volume', 'monitor', 'keyboard', 'accessibility', 'users', 'signal', 'exit', 'swords', 'info', 'help', 'warn', 'rotate', 'fall', 'heart', 'timer', 'target', 'star', 'flame', 'dummy', 'door', 'eye', 'reset', 'touch', 'mouse', 'mouseL', 'mouseR', 'mouseM', 'jump', 'spark', 'trophy'];
  html += `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">` + names.map((n) => `<div style="width:50px;text-align:center;color:#f6e0ae"><span style="display:block;width:28px;height:28px;margin:0 auto">${uiIcon(n)}</span><div style="color:#8491a8;font-size:9px">${n}</div></div>`).join('') + `</div>`;
  html += `<div style="color:#8491a8;margin-top:6px">${ABILITY_ICON_KEYS.length} ability icons</div>`;
  sheet.innerHTML = html;
  root.appendChild(sheet);
}

// ------------------------------------------------------------------------------------ mock simulation
const enemies = [
  { id: 2, bx: 0.36, by: 0.43, dist: 12, ph: 0 }, { id: 3, bx: 0.63, by: 0.38, dist: 26, ph: 2 },
  { id: 7, bx: 0.52, by: 0.47, dist: 7, ph: 4 }, { id: 5, bx: 0.8, by: 0.5, dist: 48, ph: 1 },
];
const plates: Nameplate[] = enemies.map((e) => {
  const r = roster.find((x) => x.id === e.id)!;
  return { id: e.id, name: r.name, sx: 0, sy: 0, dist: e.dist, onScreen: true, hp: 100, element: ELEMENT_ORDER[r.el], isBot: r.bot, isDummy: false, hidden: false, leader: r.id === 2 };
});
const dummyPlate: Nameplate = { id: 90, name: 'Dummy', sx: 0, sy: 0, dist: 9, onScreen: true, hp: 64, element: 'ember', isBot: false, isDummy: true, hidden: false, leader: false };

let nextEvent = 0;
let eventIndex = 0;
const ANN: [Parameters<typeof ui.pushAnnouncement>[0], string, number][] = [['firstblood', 'Hrafnkel', 1], ['double', 'Sigrun', 2], ['ringout', 'Astrid Stormborn', 1], ['lead', 'Hrafnkel', 0], ['rampage', 'Hrafnkel', 5], ['shutdown', 'Sigrun', 5], ['oneminute', '', 0], ['triple', 'Runa', 3], ['unstoppable', 'Brynja', 7], ['tenseconds', '', 0], ['matchstart', '', 20], ['matchend', 'Hrafnkel', 0]];
const forcedAnn = q('ann');

function simulate(dt: number, now: number): void {
  simT += dt;
  frame.fps = 58 + Math.round(Math.sin(now / 900) * 3);
  frame.ping = Number(q('ping', '34')) + Math.round(Math.sin(now / 1300) * 4);
  if (state === 'loading') { ui.setLoading(Math.min(0.99, 0.12 + simT * 0.085), ['Raising the island', 'Carving runes', 'Lighting the hearth', 'Waking the aurora', 'Sharpening axes'][Math.floor(simT / 1.6) % 5]); return; }
  if (mode === 'none') return;

  // cooldowns tick; abilities fire on a loop
  for (let i = 0; i < 5; i++) frame.cooldown[i] = Math.max(0, frame.cooldown[i] - dt);
  const def = ELEMENTS[frame.element];
  for (let i = 0; i < 5; i++) frame.cooldownTotal[i] = def.abilities[i].cooldown;
  if (!quiet && frame.alive) {
    const beat = Math.floor(simT / 0.9);
    const slot = [1, 0, 2, 1, 4, 0, 3, 1][beat % 8];
    const into = simT - beat * 0.9;
    if (into < 0.25 && frame.cooldown[slot] <= 0) { frame.activeSlot = slot; }
    else if (frame.activeSlot === slot && into >= 0.25) { frame.cooldown[slot] = frame.cooldownTotal[slot]; frame.activeSlot = -1; }
  } else if (quiet) {
    // a fixed, deterministic picture for screenshots
    frame.cooldown = [0, 0.4, 3.8, 9.2, 0]; frame.activeSlot = -1;
  }
  frame.locked[3] = mode === 'arena' && Math.floor(simT / 5) % 3 === 2;

  if (mode === 'arena') {
    if (frame.alive && state !== 'death') {
      frame.hp = quiet ? Number(q('hp', '78')) : Math.max(8, 62 + Math.sin(simT * 0.5) * 48);
      frame.statuses = [{ k: 'burn', t: 2.6 - (simT % 2.6) }, { k: 'chill', t: 3.5 - (simT % 3.5), n: 1 + (Math.floor(simT / 2) % 3) }];
      if (Math.floor(simT / 6) % 2) frame.statuses.push({ k: 'shock', t: 1.2 - (simT % 1.2) });
      frame.targetId = Math.sin(simT * 1.3) > 0.2 ? 2 : 0;
      frame.recall = q('recall') === '1' ? (simT * 0.5) % 1 : 0;
    } else {
      frame.respawnIn = Math.max(0, 3.2 - (simT % 4.2));
      frame.statuses = []; frame.targetId = 0;
    }
    const w = innerWidth, hh = innerHeight;
    enemies.forEach((e, i) => {
      const p = plates[i];
      p.sx = w * (e.bx + Math.sin(simT * 0.4 + e.ph) * 0.04);
      p.sy = hh * (e.by + Math.cos(simT * 0.5 + e.ph) * 0.02);
      p.hp = 50 + Math.sin(simT * 0.6 + e.ph) * 50;
      p.hidden = i === 1 && Math.floor(simT / 3) % 2 === 1;
    });
    ui.setNameplates(plates);
    if (!quiet && now > nextEvent && state !== 'results') {
      nextEvent = now + 700;
      const k = eventIndex++;
      const p = plates[k % plates.length];
      ui.pushDamageNumber({ sx: p.sx, sy: p.sy + 70, amount: 6 + ((k * 7) % 30), kind: k % 7 === 3 ? 'crit' : k % 5 === 4 ? 'dot' : 'dealt', heavy: k % 4 === 2 });
      ui.hitMarker(k % 6 === 5 ? 'kill' : k % 4 === 2 ? 'heavy' : 'hit');
      ui.gloryGain(6, 'hit');
      if (k % 3 === 1) { ui.damageFrom((k * 1.3) % (Math.PI * 2), 0.4 + (k % 3) * 0.3); ui.pushDamageNumber({ sx: innerWidth / 2, sy: innerHeight * 0.62, amount: 9 + (k % 9), kind: 'taken', heavy: false }); }
      if (k % 9 === 8) ui.pushDamageNumber({ sx: innerWidth / 2, sy: innerHeight * 0.6, amount: 25, kind: 'heal', heavy: false });
      if (k % 4 === 1) {
        const a = roster[(k * 3) % roster.length], b = roster[(k * 5 + 1) % roster.length];
        const el = ELEMENT_ORDER[a.el];
        ui.pushFeed({ killer: a.name, victim: b.name, killerEl: el, ability: ELEMENTS[el].abilities[1 + (k % 3)].key, fall: k % 8 === 5, youKiller: a.id === LOCAL, youVictim: b.id === LOCAL && a.id !== LOCAL });
        if (a.id === LOCAL) ui.gloryGain(k % 8 === 5 ? 45 : 30, k % 8 === 5 ? 'ringout' : 'kill');
        frame.glory += a.id === LOCAL ? 30 : 0;
      }
      if (k % 6 === 2 && !forcedAnn) { const a = ANN[Math.floor(k / 6) % ANN.length]; ui.pushAnnouncement(a[0], a[1], a[2]); }
      if (k % 11 === 4) ui.pushChat({ name: roster[k % 3 + 1].name, text: ['gg', 'who keeps throwing bubbles', 'the bridge is mine', 'nice ring out'][k % 4], system: false, self: false, element: ELEMENT_ORDER[roster[k % 3 + 1].el] });
      frame.glory += 3;
    }
  } else {
    // hall: a training dummy in view, intermission ticking
    dummyPlate.sx = innerWidth * 0.6; dummyPlate.sy = innerHeight * 0.44;
    ui.setNameplates(state === 'pedestal' ? [] : [dummyPlate]);
    frame.statuses = []; frame.targetId = 0;
    if (!quiet && Math.floor(simT / 14) !== Math.floor((simT - dt) / 14)) {
      match.phase = match.phase === 'intermission' ? 'live' : 'intermission';
      match.timeLeft = match.phase === 'intermission' ? 14 : 187;
      ui.setMatch({ ...match });
    }
  }
  ui.setHud(frame);
}

let last = performance.now();
let lastPaint = 0;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (now - lastPaint > 90) { lastPaint = now; paint((now - t0) / 1000); }
  simulate(dt, now);
  requestAnimationFrame(loop);
}

declare global { interface Window { ui: typeof ui; mock: { go: typeof go; frame: HudFrame; profile: Profile; click: typeof clickButton } } }
window.ui = ui;
window.mock = { go, frame, profile, click: clickButton };

go(startState);
if (forcedAnn) window.setTimeout(() => ui.pushAnnouncement(forcedAnn as Parameters<typeof ui.pushAnnouncement>[0], 'Hrafnkel', 5), 300);
if (q('toast')) window.setTimeout(() => { ui.toast('Invite link copied. Send it to someone you want to fight.', 'good'); ui.toast('The hall did not answer. Try again.', 'bad'); }, 300);
requestAnimationFrame(loop);
