// The game client: owns the loop and wires networking, prediction, input and camera to the
// presentation subsystems (environment, characters, effects, audio, interface).

import * as THREE from 'three';
import { angleDiff, clamp, dirFromYawPitch, wrapAngle } from '@shared/math';
import { HALL } from '@shared/world';
import { weatherAt, type Weather } from '@shared/weather';
import { ELEMENTS, ELEMENT_LIST, ELEMENT_ORDER, abilityByKey, type ElementId } from '@shared/elements';
import {
  CHEST_HEIGHT, DT, EYE_HEIGHT, MAX_HP, RESPAWN_TIME, MV_DASH, MV_RAY, MV_SURGE,
  type EntityState, type GameEvent, type MatchInfo, type Profile, type RoomInfo,
} from '@shared/types';
import { abilityOf, canUse, type StepHooks } from '@shared/sim/player';
import { aimPoint, cameraPivot, shotDirection } from '@shared/sim/aim';
import { ENTITY_CLASS } from '@shared/sim/entities';
import type { ServerMsg } from '@shared/net/protocol';
import { normalizeCode } from '@shared/net/protocol';
import { settings, IS_TOUCH, type BindAction, type QualityLevel } from './settings';
import type {
  AudioEngine, AudioModule, CharacterModule, CharacterView, Environment, EnvironmentModule, FighterLookup, Hint, HudFrame, Nameplate, PlayerView,
  PostFX, SocketName, Ui, UiActions, UiModule, Vfx, VfxModule,
} from './contracts';

/** The presentation subsystems the game core drives (injected so each can be swapped or stubbed). */
export interface Modules { char: CharacterModule; env: EnvironmentModule; vfx: VfxModule; audio: AudioModule; ui: UiModule }
import { Net, defaultServerUrl } from './core/net';
import { InputManager } from './core/input';
import { GameCamera } from './core/camera';
import { ClientState } from './core/state';

interface CharEntry {
  view: PlayerView;
  char: CharacterView;
  element: ElementId;
  lastAct: number;
  lastActT: number;
  wasGround: boolean;
  lastVy: number;
  stepDist: number;
  lastX: number;
  lastZ: number;
  opacity: number;
  /** Line of sight from the camera (refreshed round-robin). */
  seen: boolean;
}

const DOT_KEYS = new Set(['burn', 'firepatch', 'cindertrail', 'icetrail', 'snare', 'balllightning', 'jetstream']);
const KEY_NAMES: Record<string, string> = {
  burn: 'Burn', fall: 'The long fall', firepatch: 'Burning ground', cindertrail: 'Cinder trail', icetrail: 'Ice trail',
  balllightning: 'Ball Lightning', cyclone: 'Cyclone', snare: 'Shadow Snare',
};
const TUTORIAL_KEY = 'vindheim.tutorial.v1';
const v3a = new THREE.Vector3(), v3b = new THREE.Vector3();
const tmpA = { x: 0, y: 0, z: 0 }, tmpB = { x: 0, y: 0, z: 0 }, tmpC = { x: 0, y: 0, z: 0 };
const scr = { x: 0, y: 0 };

export class App {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new GameCamera();
  private state = new ClientState();
  private net = new Net(defaultServerUrl());
  private input!: InputManager;
  private ui!: Ui;
  private audio!: AudioEngine;
  private env!: Environment;
  private post!: PostFX;
  private vfx!: Vfx;
  private chars = new Map<number, CharEntry>();

  private profile: Profile | null = null;
  private room: RoomInfo | null = null;
  private match: MatchInfo = { phase: 'intermission', timeLeft: 0, killTarget: 20, round: 1 };
  private matchAt = 0;
  private inRoom = false;
  private wantRoom: { type: 'public' } | { type: 'create'; bots: boolean } | { type: 'join'; code: string } | null = null;
  private inviteCode = '';
  private quality: QualityLevel = 'high';
  private weather: Weather = weatherAt(0);

  private last = 0;
  private acc = 0;
  private time = 0;
  private hitStop = 0;
  private dynScale = 1;
  private frameMs = 16;
  private slowT = 0; private fastT = 0;
  private fps = 60; private fpsFrames = 0; private fpsT = 0;
  private width = 1; private height = 1;

  private combat = 0;
  private recall = 0;
  private respawnIn = 0;
  private deadPos = { x: 0, y: 0, z: 0 };
  private gallery: ElementId | null = null;
  private targetId = 0;
  private losCursor = 0;
  private indoors = 0;
  private leaderId = 0;
  private sample = { mx: 0, mz: 0, b: 0 };
  private hooks: StepHooks;
  private hud: HudFrame = {
    inGame: false, zone: 'hall', alive: true, hp: MAX_HP, maxHp: MAX_HP, element: 'ember', trial: false,
    cooldown: [0, 0, 0, 0, 0], cooldownTotal: [1, 1, 1, 1, 1], activeSlot: -1, locked: [false, false, false, false, false],
    statuses: [], glory: 0, respawnIn: 0, prompt: null, recall: 0, targetId: 0, ping: 0, fps: 60, weather: 'clear', streak: 0,
  };
  private plates: Nameplate[] = [];
  private tutorial: Record<string, boolean> = {};
  private hint: Hint | null = null;
  private hintUntil = 0;
  private movedDist = 0;
  private firstJoin = true;

  constructor(private canvas: HTMLCanvasElement, private uiRoot: HTMLElement, private mods: Modules) {
    this.hooks = {
      onStart: (p, slot) => { this.vfx.castStart(this.state.myView, slot); this.audio.castStart(this.state.myView.element, slot, abilityOf(p, slot).key, this.state.myView, true); },
      onRelease: (p, slot, ab, n) => {
        if (n === 0 || ab.fx.t === 'proj') { this.vfx.castRelease(this.state.myView, slot); this.audio.castRelease(this.state.myView.element, slot, ab.key, this.state.myView, true); }
        if (slot === 4) this.cam.kick(ab.fx.t === 'dash' || ab.fx.t === 'ray' || ab.fx.t === 'surge' ? 7 : 3);
      },
      onJump: () => this.footfall(this.state.myView, 'jump'),
      onLand: (_p, speed) => { this.footfall(this.state.myView, 'land'); if (speed > 14) this.cam.shake(Math.min(0.35, speed / 90)); },
    };
    try { this.tutorial = JSON.parse(localStorage.getItem(TUTORIAL_KEY) || '{}') || {}; } catch { this.tutorial = {}; }
    const m = /[?&]room=([A-Za-z0-9]+)/.exec(location.search);
    if (m) this.inviteCode = normalizeCode(m[1]);
  }

  // ============================================================================ boot
  async start(): Promise<void> {
    const actions: UiActions = {
      setName: (name) => { this.net.send({ t: 'cmd', c: 'name', v: name }); if (this.profile) this.profile.name = name; },
      play: (mode) => this.play(mode),
      leaveRoom: () => { this.wantRoom = null; this.net.send({ t: 'leave' }); },
      deploy: () => this.net.send({ t: 'cmd', c: 'deploy' }),
      returnToHall: () => this.net.send({ t: 'cmd', c: 'hall' }),
      equip: (el) => this.net.send({ t: 'cmd', c: 'equip', v: el }),
      unlock: (el) => this.net.send({ t: 'cmd', c: 'unlock', v: el }),
      trial: (el) => this.net.send({ t: 'cmd', c: 'trial', v: el }),
      inspect: (el) => this.setGallery(el),
      sendChat: (text) => this.net.send({ t: 'cmd', c: 'chat', v: text }),
      setUiFocus: (open) => {
        if (open) this.input.unlock();
        else { if (this.gallery) this.setGallery(null); if (this.inRoom) this.input.lock(); }
      },
      userGesture: () => this.audio.unlock(),
      playUiSound: (s) => this.audio.ui(s),
    };
    this.ui = this.mods.ui.createUi(this.uiRoot, actions);
    this.ui.setScreen('loading');
    this.ui.setLoading(0.02, 'Waking the hearth…');

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    } catch {
      this.ui.setLoading(0, 'This device cannot run WebGL 2, which Vindheim needs. Try a recent Chrome, Firefox or Safari.');
      return;
    }
    this.renderer.setClearColor(0x070b14, 1);
    this.quality = this.resolveQuality();
    this.resize();

    this.input = new InputManager(this.canvas, this.ui.touch, () => this.ui.isBlocking());
    this.input.onAction = (a) => this.onAction(a);
    this.input.onActionUp = (a) => { if (a === 'scoreboard') this.ui.showScoreboard(false); };
    this.input.onLockLost = () => { if (this.inRoom) this.ui.toggleMenu(true); };

    const world = this.state.world;
    this.audio = this.mods.audio.createAudio(world);
    await frame();
    this.ui.setLoading(0.08, 'Carving the fighters…');
    this.mods.char.preload(this.quality);
    await frame();
    this.env = await this.mods.env.createEnvironment(this.scene, this.renderer, world, this.quality, (p, label) => this.ui.setLoading(0.1 + p * 0.75, label));
    this.env.onLightning = (d, s) => this.audio.thunder(d, s);
    this.post = this.mods.env.createPostFX(this.renderer, this.quality);
    this.ui.setLoading(0.9, 'Kindling the elements…');
    await frame();
    const lookup: FighterLookup = {
      get: (id) => this.state.view(id),
      socket: (id, name, out) => this.socket(id, name, out),
      all: () => this.allViews(),
    };
    this.vfx = this.mods.vfx.createVfx(this.scene, world, lookup, this.quality);
    // compile the fighters' material variants now rather than at the first Shadowmeld
    (this.mods.char as any).warmup?.(this.renderer, this.cam.camera, this.scene, this.quality);
    this.applySettings(true);
    settings.subscribe((_s, changed) => this.onSettings(changed));
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushIdleInput(); });
    this.resize();

    // warm the pipeline (compile shaders) before showing the title
    this.cam.update(0.016, world, 0, 0, 0, 0, 0, this.width / this.height);
    this.post.render(this.scene, this.cam.camera, 0.016);
    this.ui.setLoading(0.97, 'Opening the Skygate…');
    await frame();

    this.net.onState = (s, detail) => {
      this.ui.setConnection(s, detail);
      if (s === 'reconnecting' && this.inRoom) { this.inRoom = false; this.ui.toast('Connection lost — reconnecting…', 'bad'); }
    };
    this.net.onMessage = (m) => this.onMessage(m);
    this.ui.setConnection('connecting');
    this.net.start(undefined, /[?&]offline(=1)?(&|$)/.test(location.search));

    this.ui.setLoading(1, 'Ready');
    this.ui.setScreen('title');
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
    (window as any).__vindheim = this; // handy for debugging and automated smoke tests
  }

  private resolveQuality(): QualityLevel {
    const q = settings.get().quality;
    if (q !== 'auto') return q;
    const cores = navigator.hardwareConcurrency || 4;
    const small = Math.min(window.innerWidth, window.innerHeight) < 500;
    if (IS_TOUCH) return small || cores <= 4 ? 'low' : 'medium';
    return cores <= 4 ? 'medium' : 'high';
  }

  private resize() {
    this.width = Math.max(1, window.innerWidth); this.height = Math.max(1, window.innerHeight);
    const s = settings.get();
    const cap = this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.5 : 2;
    const pr = clamp(Math.min(window.devicePixelRatio || 1, cap) * s.renderScale * this.dynScale, 0.4, 3);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.post?.setSize(this.width, this.height, pr);
  }

  private applySettings(initial = false) {
    const s = settings.get();
    this.env.setQuality(this.quality, s.shadows);
    this.post.setQuality(this.quality, s.bloom);
    this.env.setReduceFlashes(s.reduceFlashes);
    this.post.setReduceFlashes(s.reduceFlashes);
    if (!initial) { this.vfx.setQuality(this.quality); this.resize(); }
    this.audio.applySettings();
  }

  private onSettings(changed: string[]) {
    if (changed.includes('quality')) {
      const q = this.resolveQuality();
      if (q !== this.quality) { this.quality = q; this.dynScale = 1; }
    }
    this.applySettings();
    if (changed.includes('hints') && !settings.get().hints) { this.hint = null; this.ui.setHint(null); }
  }

  // ============================================================================ room flow
  private play(mode: { type: 'public' } | { type: 'create'; bots: boolean } | { type: 'join'; code: string }) {
    // an invite link turns the first quick-play into "join that room"
    if (mode.type === 'public' && this.inviteCode) { mode = { type: 'join', code: this.inviteCode }; this.inviteCode = ''; }
    this.wantRoom = mode;
    this.input.lock();
    this.net.send({ t: 'join', mode: mode.type, code: mode.type === 'join' ? mode.code : undefined, bots: mode.type === 'create' ? mode.bots : undefined });
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.setProfile(m.profile);
        // came back after a dropped connection: return to the room we were in
        if (this.wantRoom && !this.inRoom) {
          const again = this.room && this.room.isPrivate ? { type: 'join' as const, code: this.room.code } : this.wantRoom;
          this.net.send({ t: 'join', mode: again.type, code: again.type === 'join' ? again.code : undefined, bots: again.type === 'create' ? again.bots : undefined });
        }
        break;
      case 'profile': this.setProfile(m.profile); break;
      case 'joined': {
        this.clearRoom();
        this.state.reset(m.you);
        this.inRoom = true;
        this.room = m.room;
        this.ui.setRoom(m.room);
        this.applyRoster(m.roster, true);
        for (const e of m.ents) this.spawnEntity(e, 0);
        this.setMatch(m.match);
        this.ui.showResults(m.results);
        this.input.yaw = 0; this.input.pitch = -0.05;
        this.input.enabled = true;
        this.cam.setMode('follow');
        this.ui.setScreen('game');
        this.hud.inGame = true;
        if (m.room.isPrivate) {
          const url = `${location.origin}${location.pathname}?room=${m.room.code}`;
          this.ui.toast(`Private room ${m.room.code} — share the code or the link to invite friends.`, 'good');
          try { history.replaceState(null, '', `?room=${m.room.code}`); } catch { /* sandboxed */ }
          void url;
        } else {
          try { history.replaceState(null, '', location.pathname); } catch { /* sandboxed */ }
        }
        if (this.net.local && this.firstJoin) this.ui.toast('Offline practice: fighting bots on this device. Progress is saved locally.', 'info');
        this.firstJoin = false;
        break;
      }
      case 'left': this.toTitle(); break;
      case 's': {
        if (!this.inRoom) return;
        this.state.onSnapshot(m.k, m.a, m.me, m.p, performance.now() / 1000);
        if (m.e) for (const ev of m.e) this.onEvent(ev);
        break;
      }
      case 'roster':
        if (!this.inRoom) return;
        this.room = m.room; this.ui.setRoom(m.room);
        this.applyRoster(m.roster, false);
        break;
      case 'match':
        if (!this.inRoom) return;
        this.setMatch(m.match);
        this.ui.showResults(m.match.phase === 'results' ? m.results : null);
        break;
      case 'err':
        this.ui.toast(m.msg, 'bad');
        this.audio.ui('denied');
        if (m.code === 'room-not-found' || m.code === 'room-full') { this.wantRoom = null; this.input.unlock(); }
        break;
    }
  }

  private setProfile(p: Profile) {
    const before = this.profile;
    this.profile = p;
    this.ui.setProfile(p);
    this.hud.glory = p.glory;
    const next = p.owned.length < ELEMENT_ORDER.length ? ELEMENT_ORDER[p.owned.length] : null;
    for (const el of ELEMENT_ORDER) {
      this.env.setPedestalState(el, el === p.equipped ? 'equipped' : p.owned.includes(el) ? 'owned' : el === next ? 'next' : 'locked');
    }
    if (before && p.owned.length > before.owned.length) {
      const el = ELEMENTS[p.owned[p.owned.length - 1]];
      this.ui.toast(`${el.name} unlocked — ${el.title}.`, 'good');
      this.audio.ui('unlock');
    }
  }

  private setMatch(m: MatchInfo) {
    const prev = this.match.phase;
    this.match = m; this.matchAt = performance.now() / 1000;
    this.ui.setMatch(m);
    if (prev !== m.phase && m.phase === 'intermission') this.ui.showResults(null);
  }

  private applyRoster(list: import('@shared/types').RosterEntry[], initial: boolean) {
    const { joined, left } = this.state.setRoster(list);
    for (const id of left) this.dropChar(id);
    void joined; void initial;
    this.ui.setRoster(list, this.state.myId);
    let lead = 0, best = 0;
    for (const r of list) if (!r.dummy && r.kills > best) { best = r.kills; lead = r.id; }
    this.leaderId = lead;
    const me = this.state.roster.get(this.state.myId);
    this.hud.streak = me ? me.streak : 0;
  }

  private clearRoom() {
    for (const id of [...this.chars.keys()]) this.dropChar(id);
    this.vfx.clear();
    for (const e of this.state.ents.values()) this.audio.entityDespawn(e.id, e.k, e, 0);
    this.ui.showDeath(null); this.ui.showResults(null); this.ui.setHint(null);
    this.hint = null; this.recall = 0; this.gallery = null; this.combat = 0;
    this.post.setDesaturate(0); this.post.setDanger(0); this.post.setFrost(0);
  }

  private toTitle() {
    this.clearRoom();
    this.inRoom = false; this.room = null;
    this.state.reset(0);
    this.input.enabled = false; this.input.unlock();
    this.hud.inGame = false;
    this.cam.setMode('title');
    this.ui.setRoom(null);
    this.ui.setScreen('title');
    try { history.replaceState(null, '', location.pathname); } catch { /* sandboxed */ }
  }

  private dropChar(id: number) {
    const c = this.chars.get(id);
    if (!c) return;
    this.scene.remove(c.char.root);
    c.char.dispose();
    this.chars.delete(id);
  }

  // ============================================================================ actions
  private onAction(a: BindAction) {
    if (!this.inRoom) return;
    const me = this.state.me;
    switch (a) {
      case 'menu': this.ui.toggleMenu(); break;
      case 'scoreboard': this.ui.showScoreboard(true); break;
      case 'chat': if (settings.get().chat) this.ui.openChat(); break;
      case 'interact': {
        if (!me.hall) break;
        const el = this.nearPedestal();
        if (el) { this.ui.showPedestal(el); this.setGallery(el); this.doneHint('pedestal'); }
        break;
      }
      case 'deploy': if (me.hall && me.alive) this.net.send({ t: 'cmd', c: 'deploy' }); break;
      case 'hall': if (!me.alive) { this.net.send({ t: 'cmd', c: 'hall' }); this.ui.toast('You will wake in the hall.', 'info'); } break;
    }
  }

  private setGallery(el: ElementId | null) {
    this.gallery = el;
    if (el && this.state.me.hall) {
      const p = this.state.world.pedestals[el];
      this.cam.setInspect(p.x, p.y, p.z, p.x < 0 ? -1 : 1);
      this.cam.setMode('inspect');
    } else if (this.cam.mode === 'inspect') this.cam.setMode(this.state.me.alive ? 'follow' : 'death');
  }

  private nearPedestal(): ElementId | null {
    const v = this.state.myView;
    let best: ElementId | null = null, bd = 3.4;
    for (const el of ELEMENT_ORDER) {
      const p = this.state.world.pedestals[el];
      const d = Math.hypot(p.x - v.x, p.z - v.z);
      if (d < bd) { bd = d; best = el; }
    }
    return best;
  }

  private flushIdleInput() {
    if (!this.inRoom) return;
    const inp = this.state.tick({ mx: 0, mz: 0, b: 0 }, this.input.yaw, this.input.pitch, {});
    this.net.send({ t: 'in', i: [[inp.seq, 0, 0, inp.yaw, inp.pitch, 0]] });
  }

  // ============================================================================ lookups
  private socket(id: number, name: SocketName, out: THREE.Vector3): THREE.Vector3 {
    const c = this.chars.get(id);
    if (c && c.char.root.visible) return c.char.getSocket(name, out);
    const v = this.state.view(id);
    if (!v) return out.set(0, -999, 0);
    const h = name === 'feet' ? 0 : name === 'head' ? 1.65 : CHEST_HEIGHT;
    return out.set(v.x, v.y + h, v.z);
  }

  private *allViews(): Iterable<PlayerView> {
    if (this.inRoom) yield this.state.myView;
    for (const r of this.state.remotes.values()) yield r.view;
  }

  private surfaceUnder(v: PlayerView): string {
    return this.state.world.ground(v.x, v.z, v.y + 0.3).surf;
  }

  private footfall(v: PlayerView, kind: 'step' | 'land' | 'jump') {
    const surf = this.surfaceUnder(v);
    this.vfx.footfall(v, kind, surf);
    this.audio.footstep(surf, v, v.isLocal, kind);
  }

  // ============================================================================ events
  private spawnEntity(e: EntityState, lead: number) {
    const live = this.state.addEntity(e, lead);
    this.attachChannel(live);
    this.vfx.spawnEntity(live);
    this.audio.entitySpawn(live);
  }

  private attachChannel(e: EntityState) {
    if (ENTITY_CLASS[e.k] !== 'channel') return;
    const v = this.state.view(e.o);
    if (!v) return;
    const local = v.isLocal;
    const yaw = local ? this.state.me.actYaw : v.aimYaw, pitch = local ? this.state.me.actPitch : v.aimPitch;
    const mx = v.x - Math.sin(yaw) * 0.7, my = v.y + CHEST_HEIGHT + 0.15, mz = v.z - Math.cos(yaw) * 0.7;
    const aim = aimPoint(this.state.world, v.x, v.y, v.z, yaw, pitch, e.p + 6, v.isBot, tmpA);
    const d = shotDirection(mx, my, mz, aim, yaw, pitch, tmpB);
    e.x = mx; e.y = my; e.z = mz; e.vx = d.x; e.vy = d.y; e.vz = d.z; e.yaw = yaw;
  }

  private abilityName(k: string): string { return abilityByKey(k)?.name || KEY_NAMES[k] || 'the arena'; }

  private onEvent(ev: GameEvent) {
    const st = this.state;
    const me = st.myId;
    switch (ev.e) {
      case 'spawn': this.spawnEntity(ev, this.net.rtt / 2000); break;
      case 'despawn': {
        const e = st.ents.get(ev.id);
        if (!e) break;
        const silent = st.endedLocally.has(ev.id);
        st.removeEntity(ev.id);
        if (!silent) { this.vfx.despawnEntity(ev.id, ev.x, ev.y, ev.z, ev.why); this.audio.entityDespawn(ev.id, e.k, ev, ev.why); }
        if (ev.why >= 3 && (e.k === 'meteor' || e.k === 'thunderstrike' || e.k === 'balllightning')) this.shakeNear(ev.x, ev.y, ev.z, 0.55, 30);
        break;
      }
      case 'hit': this.onHit(ev); break;
      case 'fx': {
        this.vfx.onEvent(ev);
        this.audio.fx(ev.k, ELEMENT_ORDER[ev.el] || 'ember', ev, { x: ev.x2, y: ev.y2, z: ev.z2 });
        if (ev.k === 'earthshatter' || ev.k === 'leapslam' || ev.k === 'sunlance' || ev.k === 'solarflare') this.shakeNear(ev.x, ev.y, ev.z, ev.k === 'sunlance' ? 0.5 : 0.4, 26);
        break;
      }
      case 'death': {
        this.vfx.onEvent(ev);
        const victim = st.nameOf(ev.p), killer = ev.killer ? st.nameOf(ev.killer) : '';
        const vr = st.roster.get(ev.p);
        this.audio.death(ev, !!ev.fall, ev.killer === me ? 'killer' : ev.p === me ? 'victim' : null);
        if (vr && vr.dummy) break;
        this.ui.pushFeed({ killer, victim, killerEl: ev.killer ? st.elementOf(ev.killer) : null, ability: this.abilityName(ev.k), fall: !!ev.fall, youKiller: ev.killer === me, youVictim: ev.p === me });
        if (ev.p === me) {
          this.deadPos = { x: ev.x, y: Math.max(ev.y, -8), z: ev.z };
          this.respawnIn = RESPAWN_TIME;
          this.ui.showDeath({ killerName: killer, killerEl: ev.killer ? st.elementOf(ev.killer) : null, ability: this.abilityName(ev.k), fall: !!ev.fall, respawnIn: RESPAWN_TIME });
          this.cam.setMode('death');
          this.post.setDesaturate(0.8);
          this.audio.duck(1.2, 0.7);
          this.recall = 0;
          if (this.gallery) { this.ui.showPedestal(null); this.gallery = null; }
        }
        break;
      }
      case 'respawn': {
        this.vfx.onEvent(ev);
        this.audio.respawn(ev, ev.p === me);
        if (ev.p === me) this.onLocalSpawn(ev.x, ev.z, !!ev.hall);
        break;
      }
      case 'tp': {
        this.vfx.onEvent(ev);
        this.audio.teleport(ev.k, ev, { x: ev.x2, y: ev.y2, z: ev.z2 });
        if (ev.p === me) {
          if (ev.k === 'deploy') { this.onLocalSpawn(ev.x2, ev.z2, false); this.post.kick(0.8); this.doneHint('deploy'); this.audio.ui('deploy'); }
          else { this.post.kick(0.6); this.cam.kick(6); }
        }
        break;
      }
      case 'pop': this.vfx.onEvent(ev); this.audio.pop(ev.k, ev); break;
      case 'pickup': {
        this.vfx.onEvent(ev);
        this.audio.pickup(ev, ev.p === me);
        if (ev.p === me && this.cam.project(ev.x, ev.y, ev.z, this.width, this.height, scr)) this.ui.pushDamageNumber({ sx: scr.x, sy: scr.y, amount: ev.heal, kind: 'heal', heavy: false });
        break;
      }
      case 'announce':
        this.ui.pushAnnouncement(ev.k, ev.p ? st.nameOf(ev.p) : '', ev.n);
        this.audio.announce(ev.k);
        break;
      case 'chat':
        this.ui.pushChat({ name: ev.name, text: ev.text, system: !!ev.sys, self: ev.p === me, element: st.elementOf(ev.p) || undefined });
        if (ev.p !== me) this.audio.ui('chat');
        break;
      case 'join': break; // named once the roster arrives (see 'leave' for the farewell)
      case 'leave': this.ui.pushChat({ name: '', text: `${ev.name} left the room.`, system: true, self: false }); break;
      case 'note': this.ui.toast(ev.text, ev.kind); if (ev.kind === 'bad') this.audio.ui('denied'); break;
      case 'glory':
        if (this.profile) { this.profile.glory += ev.n; this.hud.glory = this.profile.glory; }
        this.ui.gloryGain(ev.n, ev.why);
        if (ev.why !== 'hit') this.audio.ui('glory');
        break;
    }
  }

  private onLocalSpawn(x: number, z: number, hall: boolean) {
    this.ui.showDeath(null);
    this.respawnIn = 0;
    this.post.setDesaturate(0);
    this.input.yaw = hall ? 0 : Math.atan2(x, z);
    this.input.pitch = -0.08;
    this.cam.setMode('follow');
    this.cam.cut();
    this.recall = 0;
    if (!hall && !this.tutorial.arena) this.showHint('arena', { id: 'arena', title: 'Nothing can be blocked', text: 'Every clean hit staggers or launches. Stay moving, jump the ground attacks, and strike when they miss.' }, 9);
  }

  private shakeNear(x: number, y: number, z: number, amount: number, range: number) {
    const v = this.state.myView;
    const d = Math.hypot(v.x - x, v.y - y, v.z - z);
    if (d < range) this.cam.shake(amount * (1 - d / range));
  }

  private onHit(ev: Extract<GameEvent, { e: 'hit' }>) {
    const st = this.state;
    const me = st.myId;
    const dot = DOT_KEYS.has(ev.k) && !ev.heavy;
    this.vfx.onEvent(ev);
    const el = ELEMENT_ORDER[ev.el] || 'ember';
    const mine = ev.s === me && ev.t !== me, onMe = ev.t === me;
    const target = st.roster.get(ev.t);
    if (!dot || ev.kill) this.audio.hit(el, ev.k, ev.dmg, !!ev.heavy, !!ev.crit, ev, mine ? 'dealt' : onMe ? 'taken' : null);
    const c = this.chars.get(ev.t);
    if (c && !dot) c.char.flash(ev.heavy ? 1 : 0.6);
    const s = settings.get();

    if (mine) {
      if (!dot) {
        this.ui.hitMarker(ev.kill ? 'kill' : ev.heavy ? 'heavy' : 'hit');
        this.combat = Math.min(1, this.combat + 0.22);
        if (ev.heavy || ev.kill) {
          this.cam.shake(ev.kill ? 0.5 : 0.3);
          if (s.hitStop) this.hitStop = Math.max(this.hitStop, ev.kill ? 0.11 : 0.065);
          this.post.impact(ev.kill ? 0.9 : 0.5);
          if (ev.kill) this.post.kick(0.5);
        } else this.cam.shake(0.1);
        if (target?.dummy) this.doneHint('ring');
      } else if (ev.kill) this.ui.hitMarker('kill');
      if (s.damageNumbers && ev.dmg > 0 && this.cam.project(ev.x, ev.y + 0.5, ev.z, this.width, this.height, scr)) {
        this.ui.pushDamageNumber({ sx: scr.x, sy: scr.y, amount: ev.dmg, kind: dot ? 'dot' : ev.crit ? 'crit' : 'dealt', heavy: !!ev.heavy });
      }
      if (ev.kill && !target?.dummy && !this.tutorial.glory) this.showHint('glory', { id: 'glory', title: 'Glory', text: 'Hits and kills earn glory. Spend it in the hall to unlock the next element.', actions: ['hall'] }, 10);
    }
    if (onMe) {
      const v = st.myView;
      if (!dot) {
        this.combat = Math.min(1, this.combat + 0.25);
        this.cam.shake(clamp(0.15 + ev.dmg / 45, 0, 0.75) * (ev.heavy ? 1.25 : 1));
        this.post.hurt(clamp(0.18 + ev.dmg / 60, 0, 0.65));
        if (ev.heavy) { if (s.hitStop) this.hitStop = Math.max(this.hitStop, 0.08); this.post.impact(0.6); this.post.kick(0.6); this.audio.duck(0.25, 0.5); }
        this.recall = 0;
        const src = st.view(ev.s);
        if (src) {
          // bearing of the attacker relative to where we are looking, clockwise
          const ang = Math.atan2(src.x - v.x, -(src.z - v.z));
          this.ui.damageFrom(wrapAngle(ang + this.input.yaw), clamp(ev.dmg / 25, 0.3, 1));
        }
      } else this.post.hurt(0.12);
      if (s.damageNumbers && ev.dmg >= 1 && this.cam.project(v.x, v.y + 2.0, v.z, this.width, this.height, scr)) {
        this.ui.pushDamageNumber({ sx: scr.x, sy: scr.y, amount: ev.dmg, kind: 'taken', heavy: !!ev.heavy });
      }
    } else if (ev.heavy && !mine) this.shakeNear(ev.x, ev.y, ev.z, 0.18, 14);
  }

  // ============================================================================ hints
  private showHint(id: string, hint: Hint, seconds: number) {
    if (!settings.get().hints || this.tutorial[id]) return;
    this.hint = hint; this.hintUntil = this.time + seconds;
    this.ui.setHint(hint);
    if (seconds < 100) this.doneHint(id, false);
  }

  private doneHint(id: string, clear = true) {
    if (this.tutorial[id]) return;
    this.tutorial[id] = true;
    try { localStorage.setItem(TUTORIAL_KEY, JSON.stringify(this.tutorial)); } catch { /* private mode */ }
    if (clear && this.hint && this.hint.id === id) { this.hint = null; this.ui.setHint(null); }
  }

  private updateHints(dt: number) {
    if (!settings.get().hints) return;
    const me = this.state.me, v = this.state.myView;
    if (this.hint && this.time > this.hintUntil) { this.hint = null; this.ui.setHint(null); }
    if (this.hint || this.gallery || !me.alive) return;
    const t = this.tutorial;
    if (me.hall) {
      if (!t.move) {
        this.movedDist += Math.hypot(me.vx, me.vz) * dt;
        if (this.movedDist > 7) this.doneHint('move');
        else this.showHint('move', { id: 'move', title: 'Welcome to the Hearth-Hall', text: IS_TOUCH ? 'Move with the left stick. Drag the right side of the screen to look around.' : 'Move, look around with the mouse, and jump.', actions: ['forward', 'left', 'back', 'right', 'jump'] }, 600);
      } else if (!t.pedestal) {
        this.showHint('pedestal', { id: 'pedestal', title: 'The gallery of elements', text: 'Eight pedestals line the walls. Walk up to one and study it.', actions: ['interact'] }, 600);
      } else if (!t.ring && v.z > HALL.maxZ - 2) {
        this.showHint('ring', { id: 'ring', title: 'The sparring ring', text: 'Try your strikes on the training thralls beside the terrace before you fight for real.', actions: ['melee', 'ability1', 'ability2', 'ability3', 'move'] }, 600);
      } else if (!t.deploy && (t.ring || this.match.phase === 'live') && t.pedestal) {
        this.showHint('deploy', { id: 'deploy', title: 'The Skygate', text: this.match.phase === 'live' ? 'The match is live. Walk through the Skygate on the terrace — or simply leap off the island.' : 'When the match begins, walk through the Skygate on the terrace to drop into the arena.', actions: ['deploy'] }, 600);
      }
    } else if (!t.edge && t.arena && this.time > this.hintUntil + 6) {
      this.showHint('edge', { id: 'edge', title: 'Mind the edge', text: 'The cloud sea kills. Knock your foes over the rim — and when you are launched, steer back or use your movement ability.', actions: ['move'] }, 9);
    } else if (!t.recall && t.edge && this.time > this.hintUntil + 25) {
      this.showHint('recall', { id: 'recall', title: 'Back to the hall', text: 'Hold to return to the hall when no one is on you — to change element or spend glory.', actions: ['hall'] }, 8);
    }
  }

  // ============================================================================ frame
  private frame() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) dt = 0.001;
    this.time += dt;
    const nowSec = now / 1000;
    const st = this.state;
    const world = st.world;

    this.fpsFrames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsT); this.fpsFrames = 0; this.fpsT = 0; }
    this.adaptResolution(dt);

    this.input.frame(dt);
    if (this.inRoom) this.aimAssist(dt);

    // ---- fixed simulation ticks
    if (this.inRoom) {
      this.acc += dt;
      let n = 0;
      const batch: number[][] = [];
      while (this.acc >= DT && n < 6) {
        this.acc -= DT; n++;
        this.input.sample(this.sample);
        if (this.gallery) { this.sample.mx = 0; this.sample.mz = 0; this.sample.b = 0; }
        const yaw = Math.round(this.input.yaw * 10000) / 10000, pitch = Math.round(this.input.pitch * 10000) / 10000;
        this.sample.mx = Math.round(this.sample.mx * 100) / 100; this.sample.mz = Math.round(this.sample.mz * 100) / 100;
        const inp = st.tick(this.sample, yaw, pitch, this.hooks);
        batch.push([inp.seq, inp.mx, inp.mz, inp.yaw, inp.pitch, inp.b]);
      }
      if (this.acc > DT * 6) this.acc = 0;
      if (batch.length) this.net.send({ t: 'in', i: batch });
      st.frame(this.acc / DT, dt, nowSec, this.input.yaw, this.input.pitch);
    }

    // hit-stop freezes animation and effects for a few frames; the simulation never stops
    let vdt = dt;
    if (this.hitStop > 0) { this.hitStop -= dt; vdt = dt * 0.06; }

    if (this.inRoom) {
      st.stepEntities(vdt === dt ? dt : dt * 0.3, (e) => this.attachChannel(e), (e) => {
        this.vfx.despawnEntity(e.id, e.x, e.y, e.z, 1);
        this.audio.entityDespawn(e.id, e.k, e, 1);
      }, (e) => { st.removeEntity(e.id); this.vfx.despawnEntity(e.id, e.x, e.y, e.z, 0); this.audio.entityDespawn(e.id, e.k, e, 0); });
      for (const e of st.ents.values()) if (ENTITY_CLASS[e.k] !== 'zone' || e.vx !== 0 || e.vz !== 0) this.audio.entityMove(e.id, e);
      this.updateFighters(dt, vdt);
      this.updateLocal(dt);
    }

    // ---- camera
    const v = st.myView;
    const dead = this.inRoom && !st.me.alive;
    const fx = dead ? this.deadPos.x : v.x, fy = dead ? this.deadPos.y : v.y, fz = dead ? this.deadPos.z : v.z;
    this.cam.update(dt, world, fx, fy, fz, this.input.yaw, this.input.pitch, this.width / this.height);
    const cam = this.cam.camera;

    // ---- world
    this.weather = weatherAt(this.net.serverNow());
    const focus = v3a.set(this.inRoom ? fx : cam.position.x * 0.3, this.inRoom ? fy : 0, this.inRoom ? fz : cam.position.z * 0.3);
    this.env.update(dt, this.time, cam, focus, this.weather);
    this.vfx.update(vdt, this.time, cam);

    const cp = cam.position;
    const inside = cp.x > HALL.minX && cp.x < HALL.maxX && cp.z > HALL.minZ && cp.z < HALL.maxZ && cp.y < HALL.roofY1 ? 1 : 0;
    this.indoors += (inside - this.indoors) * Math.min(1, dt * 3);
    const fwd = this.cam.forward(v3b);
    this.audio.update(dt, cp, fwd, this.weather, this.indoors);
    this.updateMusic(dt);

    if (this.inRoom) { this.updateHud(dt); this.updatePlates(); this.updateHints(dt); }
    this.post.render(this.scene, cam, dt);
  }

  private adaptResolution(dt: number) {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (!settings.get().dynamicResolution) { if (this.dynScale !== 1) { this.dynScale = 1; this.resize(); } return; }
    if (this.frameMs > 22) { this.slowT += dt; this.fastT = 0; } else if (this.frameMs < 14) { this.fastT += dt; this.slowT = 0; } else { this.slowT = 0; this.fastT = 0; }
    if (this.slowT > 2 && this.dynScale > 0.55) { this.dynScale = Math.max(0.55, this.dynScale - 0.1); this.slowT = 0; this.resize(); }
    else if (this.slowT > 6 && this.dynScale <= 0.55 && settings.get().quality === 'auto' && this.quality !== 'low') {
      // still struggling at the lowest resolution: step the whole quality tier down
      this.quality = this.quality === 'ultra' ? 'high' : this.quality === 'high' ? 'medium' : 'low';
      this.dynScale = 0.8; this.slowT = 0;
      this.applySettings();
    }
    else if (this.fastT > 6 && this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale + 0.1); this.fastT = 0; this.resize(); }
  }

  private aimAssist(dt: number) {
    const s = settings.get();
    if (!s.aimAssist || this.input.device === 'keyboard' || !this.state.me.alive || this.gallery) return;
    const st = this.state, v = st.myView;
    const pivot = cameraPivot(v.x, v.y, v.z, this.input.yaw, tmpC);
    let best = 0.2, by = 0, bp = 0, found = false;
    for (const r of st.remotes.values()) {
      const o = r.view;
      if (!o.alive || !o.visible || o.stealth || o.inHall !== v.inHall || (o.inHall && !o.isDummy)) continue;
      const dx = o.x - pivot.x, dy = o.y + CHEST_HEIGHT - pivot.y, dz = o.z - pivot.z;
      const d = Math.hypot(dx, dz);
      if (d > 45 || d < 1.5) continue;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, d);
      const off = Math.hypot(angleDiff(this.input.yaw, yaw), pitch - this.input.pitch);
      if (off < best && this.chars.get(o.id)?.seen !== false) { best = off; by = angleDiff(this.input.yaw, yaw); bp = pitch - this.input.pitch; found = true; }
    }
    if (!found) return;
    // pull harder the closer the aim already is; never fight a deliberate fast turn
    const k = Math.min(1, dt * 3.2 * (1 - best / 0.2)) * (this.input.turnRate > 2.5 ? 0.3 : 1);
    this.input.nudge(by * k, bp * k);
  }

  private updateFighters(dt: number, vdt: number) {
    const st = this.state;
    const cam = this.cam.camera.position;
    const mv = st.myView;
    // refresh one line-of-sight per frame (cheap, and plenty for nameplates)
    const ids = [...st.remotes.keys()];
    const losId = ids.length ? ids[this.losCursor++ % ids.length] : 0;
    let target = 0, targetDist = 1e9;
    const fwd = this.cam.forward(v3b);

    for (const view of this.allViews()) {
      if (!st.roster.has(view.id) && !view.isLocal) continue;
      let c = this.chars.get(view.id);
      if (!c) {
        if (!view.visible) continue;
        const char = this.mods.char.create({ seed: view.seed, element: view.element, kind: view.isDummy ? 'dummy' : 'fighter', quality: this.quality });
        this.scene.add(char.root);
        c = { view, char, element: view.element, lastAct: -1, lastActT: 0, wasGround: true, lastVy: 0, stepDist: 0, lastX: view.x, lastZ: view.z, opacity: 1, seen: true };
        this.chars.set(view.id, c);
      }
      if (c.element !== view.element) { c.element = view.element; c.char.setElement(view.element); }
      const dist = Math.hypot(view.x - cam.x, view.y - cam.y, view.z - cam.z);
      // while studying a pedestal the camera frames the emblem; step out of your own shot
      if (dist > 150 || !view.visible || (view.isLocal && this.cam.mode === 'inspect')) { c.char.root.visible = false; c.lastAct = view.act; c.lastActT = view.actT; c.lastX = view.x; c.lastZ = view.z; c.wasGround = view.onGround; continue; }
      c.char.root.visible = true;

      // stealth: you see your own outline; others are a shimmer that firms up at arm's length
      const dMe = view.isLocal ? 0 : Math.hypot(view.x - mv.x, view.z - mv.z);
      const wantOp = view.stealth ? (view.isLocal ? 0.36 : dMe < 3.5 ? 0.2 : 0.05) : 1;
      if (Math.abs(wantOp - c.opacity) > 0.004) { c.opacity += (wantOp - c.opacity) * Math.min(1, dt * 7); c.char.setOpacity(c.opacity); }
      else if (c.opacity !== wantOp) { c.opacity = wantOp; c.char.setOpacity(wantOp); }

      c.char.update(view.frozen ? 0 : vdt, view, this.time);

      // ---- transitions -> effects and sound
      if (!view.isLocal && view.alive) {
        const ab = view.act >= 0 ? ELEMENTS[view.element].abilities[view.act] : null;
        if (ab && (view.act !== c.lastAct || view.actT < c.lastActT - 0.05)) {
          this.vfx.castStart(view, view.act); this.audio.castStart(view.element, view.act, ab.key, view, false);
          c.lastActT = 0;
        }
        if (ab && c.lastActT < ab.windup && view.actT >= ab.windup) {
          this.vfx.castRelease(view, view.act); this.audio.castRelease(view.element, view.act, ab.key, view, false);
        }
        if (view.onGround && !c.wasGround && c.lastVy < -4) this.footfall(view, 'land');
        else if (!view.onGround && c.wasGround && view.vy > 4) this.footfall(view, 'jump');
      }
      if (view.alive && view.onGround && view.down <= 0 && view.mv === 0 && dist < 45) {
        c.stepDist += Math.hypot(view.x - c.lastX, view.z - c.lastZ);
        if (c.stepDist > 2.5) { c.stepDist = 0; this.footfall(view, 'step'); }
      }
      c.lastAct = view.act; c.lastActT = view.actT; c.wasGround = view.onGround; c.lastVy = view.vy; c.lastX = view.x; c.lastZ = view.z;

      if (view.isLocal) continue;
      if (view.id === losId) {
        tmpA.x = cam.x; tmpA.y = cam.y; tmpA.z = cam.z; tmpB.x = view.x; tmpB.y = view.y + 1.6; tmpB.z = view.z;
        c.seen = st.world.los(tmpA, tmpB);
      }
      // what is under the crosshair?
      if (view.alive && c.seen && !view.stealth) {
        const dx = view.x - cam.x, dy = view.y + 1.0 - cam.y, dz = view.z - cam.z;
        const along = dx * fwd.x + dy * fwd.y + dz * fwd.z;
        if (along > 1 && along < targetDist) {
          const off = Math.hypot(dx - fwd.x * along, dy - fwd.y * along, dz - fwd.z * along);
          if (off < 0.95) { target = view.id; targetDist = along; }
        }
      }
    }
    this.targetId = target;
  }

  private updateLocal(dt: number) {
    const st = this.state, me = st.me;
    this.combat = Math.max(0, this.combat - dt * 0.07);
    if (!me.alive) { this.respawnIn = Math.max(0, this.respawnIn - dt); return; }
    // hold to return to the hall
    if (!me.hall && this.input.isDown('hall') && !this.ui.isBlocking()) {
      this.recall += dt / 1.6;
      if (this.recall >= 1) { this.recall = 0; this.net.send({ t: 'cmd', c: 'hall' }); this.doneHint('recall'); }
    } else this.recall = 0;
    this.post.setDanger(me.hall ? 0 : clamp((34 - me.hp) / 34, 0, 1) * 0.7);
    this.post.setFrost(me.freeze > 0 ? 1 : me.chill * 0.2);
    if ((me.mv === MV_DASH || me.mv === MV_RAY || me.mv === MV_SURGE)) this.post.kick(0.25);
    if (this.gallery && !me.hall) { this.ui.showPedestal(null); this.setGallery(null); }
  }

  private updateMusic(dt: number) {
    void dt;
    if (!this.inRoom) { this.audio.setMusicState({ scene: 'title', intensity: 0, danger: 0 }); return; }
    const me = this.state.me, v = this.state.myView;
    if (this.match.phase === 'results') { this.audio.setMusicState({ scene: 'results', intensity: 0.5, danger: 0 }); return; }
    if (me.hall) { this.audio.setMusicState({ scene: 'hall', intensity: 0, danger: 0 }); return; }
    let near = 0;
    for (const r of this.state.remotes.values()) {
      const o = r.view;
      if (!o.alive || o.inHall || o.isDummy) continue;
      const d = Math.hypot(o.x - v.x, o.z - v.z);
      if (d < 22) near = Math.max(near, 1 - d / 22);
    }
    const left = this.matchTimeLeft();
    const danger = Math.max(me.alive ? clamp((40 - me.hp) / 40, 0, 1) : 0, this.match.phase === 'live' && left < 45 ? 0.55 : 0);
    this.audio.setMusicState({ scene: 'arena', intensity: clamp(Math.max(this.combat, near * 0.55), 0, 1), danger });
  }

  private matchTimeLeft(): number { return Math.max(0, this.match.timeLeft - (performance.now() / 1000 - this.matchAt)); }

  private updateHud(dt: number) {
    void dt;
    const st = this.state, me = st.me, h = this.hud;
    const el = ELEMENT_LIST[me.el] || ELEMENT_LIST[0];
    h.zone = me.hall ? 'hall' : 'arena';
    h.alive = me.alive; h.hp = Math.max(0, me.hp); h.element = el.id;
    h.trial = !!this.profile && me.hall && !this.profile.owned.includes(el.id);
    for (let i = 0; i < 5; i++) {
      h.cooldown[i] = me.cd[i]; h.cooldownTotal[i] = el.abilities[i].cooldown;
      h.locked[i] = me.alive && me.cd[i] <= 0 && me.act !== i && !canUse(me, i);
    }
    h.activeSlot = me.act;
    const s = h.statuses; s.length = 0;
    if (me.burn > 0) s.push({ k: 'burn', t: me.burn });
    if (me.freeze > 0) s.push({ k: 'freeze', t: me.freeze });
    else if (me.chill > 0) s.push({ k: 'chill', t: me.chillT, n: me.chill });
    if (me.shock > 0) s.push({ k: 'shock', t: me.shock });
    if (me.root > 0) s.push({ k: 'root', t: me.root });
    if (me.slow > 0) s.push({ k: 'slow', t: me.slow });
    if (me.bubble > 0) s.push({ k: 'bubble', t: me.bubble });
    if (me.stealth > 0) s.push({ k: 'stealth', t: me.stealth });
    h.respawnIn = this.respawnIn; h.recall = this.recall; h.targetId = this.targetId;
    h.ping = Math.round(this.net.rtt); h.fps = this.fps; h.weather = this.weather.label;
    // context prompt
    h.prompt = null;
    if (me.alive && me.hall && !this.gallery) {
      const v = st.myView;
      const ped = this.nearPedestal();
      const g = HALL.gate;
      if (ped) h.prompt = { action: 'interact', text: `Study ${ELEMENTS[ped].name}` };
      else if (Math.hypot(v.x - g.x, v.z - g.z) < 9 && v.z > HALL.maxZ) {
        h.prompt = this.match.phase === 'live' ? { action: 'deploy', text: 'Deploy to the arena' } : { action: 'deploy', text: `Skygate opens in ${Math.ceil(this.matchTimeLeft())}s` };
      }
    }
    this.ui.setHud(h);
  }

  private updatePlates() {
    const st = this.state, cam = this.cam.camera.position;
    const list = this.plates;
    let n = 0;
    for (const r of st.remotes.values()) {
      const v = r.view;
      if (!v.alive || !v.visible || !st.roster.has(v.id)) continue;
      const dist = Math.hypot(v.x - cam.x, v.y - cam.y, v.z - cam.z);
      if (dist > (v.isDummy ? 26 : 70)) continue;
      if (v.stealth && dist > 3.5) continue;
      const on = this.cam.project(v.x, v.y + 2.15, v.z, this.width, this.height, scr);
      let p = list[n];
      if (!p) p = list[n] = { id: 0, name: '', sx: 0, sy: 0, dist: 0, onScreen: false, hp: 0, element: 'ember', isBot: false, isDummy: false, hidden: false, leader: false };
      p.id = v.id; p.name = v.name; p.sx = scr.x; p.sy = scr.y; p.dist = dist;
      p.onScreen = on && scr.x > -60 && scr.x < this.width + 60 && scr.y > -40 && scr.y < this.height + 40;
      p.hp = v.hp; p.element = v.element; p.isBot = v.isBot; p.isDummy = v.isDummy;
      p.hidden = this.chars.get(v.id)?.seen === false;
      p.leader = v.id === this.leaderId;
      n++;
    }
    list.length = n;
    this.ui.setNameplates(list);
  }
}

function frame(): Promise<void> { return new Promise((r) => requestAnimationFrame(() => r())); }

void dirFromYawPitch; void EYE_HEIGHT;
