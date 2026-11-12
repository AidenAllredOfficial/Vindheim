// Vindheim interface — entry point. Builds every layer over the 3D canvas and implements the
// `Ui` contract. See the individual modules for each screen.

import '@fontsource-variable/cinzel/index.css';
import '@fontsource-variable/inter/index.css';
import './styles/base.css';
import './styles/title.css';
import './styles/hud.css';
import './styles/panels.css';
import './styles/touch.css';

import type { ChatLine, DamageNumber, DeathInfo, FeedEntry, Hint, HudFrame, Nameplate, Ui, UiActions, UiSound } from '../contracts';
import type { AnnounceKind, MatchInfo, MatchResults, Profile, RoomInfo, RosterEntry } from '@shared/types';
import type { ElementId } from '@shared/elements';
import { settings, IS_TOUCH } from '../settings';
import { h, show, setText } from './dom';
import { ModalStack, Toasts, type Ctx, type UiEvent, type UiState } from './core';
import { LoadingScreen, TitleScreen } from './title';
import { Hud } from './hud';
import { WorldLayer } from './world';
import { Chat } from './chat';
import { Pedestal } from './pedestal';
import { DeathOverlay, PauseMenu, Results, Scoreboard } from './overlays';
import { TouchControls } from './touch';
import { openSettings } from './settingsPanel';
import { openHowTo } from './howto';
import { CONNECTION_LABEL } from './copy';

export function createUi(root: HTMLElement, actions: UiActions): Ui {
  root.classList.add('vui', 's-loading');
  root.setAttribute('lang', 'en');

  const state: UiState = {
    screen: 'loading', profile: null, room: null, roster: [], localId: -1, match: null, hud: null,
    conn: null, connDetail: '', touch: false,
  };
  const listeners = new Map<UiEvent, (() => void)[]>();
  let blocking = true;
  let lastEscape = 0;
  let scoreWanted = false;

  const ctx: Ctx = {
    root, actions, state,
    sound: (s: UiSound) => { try { actions.playUiSound(s); } catch { /* audio is never worth a crash */ } },
    toast: (text, kind) => { toasts.push(text, kind); ctx.sound('toast'); },
    modals: null as unknown as ModalStack,
    on: (ev, fn) => { const l = listeners.get(ev); if (l) l.push(fn); else listeners.set(ev, [fn]); },
    emit: (ev) => { const l = listeners.get(ev); if (l) for (const fn of l) fn(); },
    refreshBlocking,
    openSettings: (tab) => openSettings(ctx, tab),
    openHowTo: (tab) => openHowTo(ctx, tab),
    inviteLink: (code) => `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`,
    keyCapture: null,
  };
  const toasts = new Toasts();
  ctx.modals = new ModalStack(ctx);

  // ------------------------------------------------------------------ layers (bottom to top)
  const world = new WorldLayer();
  const touch = new TouchControls(ctx, {
    menu: () => menu.toggle(true),
    chat: () => chat.openInput(),
    scoreboard: () => { scoreWanted = !scoreboard.visible; paintScoreboard(); },
  });
  const hud = new Hud(ctx);
  const chat = new Chat(ctx);
  hud.chatMount.appendChild(chat.el);
  const pedestal = new Pedestal(ctx);
  const death = new DeathOverlay(ctx);
  const scoreboard = new Scoreboard(ctx);
  const results = new Results(ctx);
  const menu = new PauseMenu(ctx);
  const title = new TitleScreen(ctx);
  const loading = new LoadingScreen(ctx);
  const netText = h('span');
  const net = h('div.net-banner', { hidden: true, role: 'status' }, h('i.conn-dot'), netText);
  const overlay = h('div.v-layer.v-overlay', null, death.el, scoreboard.el, results.el, net);
  const side = h('div.v-layer.v-side', null, pedestal.el);

  root.append(world.el, touch.el, hud.el, side, overlay, title.el, loading.el, ctx.modals.layer, toasts.el);
  loading.setActive(true);

  // ------------------------------------------------------------------ layout + accessibility modes
  function layout(): void {
    const w = window.innerWidth, hgt = window.innerHeight;
    const k = Math.min(w / 1280, hgt / 720);
    const base = Math.max(13, Math.min(40, 15 * (k >= 1 ? Math.pow(k, 0.82) : k)));
    const s = settings.get();
    document.documentElement.style.fontSize = `${(base * s.uiScale).toFixed(2)}px`;
    const portrait = hgt > w * 1.05;
    root.classList.toggle('portrait', portrait);
    root.classList.toggle('short', !portrait && hgt < 520);
    root.classList.toggle('compact', Math.min(w, hgt) < 560);
    root.classList.toggle('squat', portrait && hgt < 720);
    ctx.emit('layout');
  }
  const osReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function applySettings(changed?: readonly string[]): void {
    const s = settings.get();
    root.classList.toggle('hc', s.highContrast);
    root.classList.toggle('cb', s.colorblind);
    root.classList.toggle('rm', s.reduceMotion || osReducedMotion.matches);
    root.classList.toggle('lh', s.leftHanded);
    if (!changed || changed.includes('uiScale')) layout();
    ctx.emit('settings');
    if (!changed || changed.includes('binds')) ctx.emit('binds');
  }
  settings.subscribe((_s, changed) => applySettings(changed as string[]));
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  applySettings();

  // ------------------------------------------------------------------ touch mode (switches with the input device)
  let lastTouchAt = -1e9;
  function setTouch(on: boolean): void {
    if (state.touch === on) return;
    state.touch = on;
    root.classList.toggle('touch', on);
    touch.setEnabled(on);
    ctx.emit('touch');
  }
  window.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'touch' || ev.pointerType === 'pen') { lastTouchAt = performance.now(); setTouch(true); }
    else if (ev.pointerType === 'mouse' && state.touch && performance.now() - lastTouchAt > 1200 && ev.isTrusted) setTouch(false);
  }, true);
  window.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'mouse' && state.touch && ev.isTrusted && performance.now() - lastTouchAt > 1200 && (Math.abs(ev.movementX) + Math.abs(ev.movementY) > 2)) setTouch(false);
  }, true);
  if (IS_TOUCH) setTouch(true);

  // ------------------------------------------------------------------ first gesture (unlocks audio)
  let gestured = false;
  const gesture = (ev: Event): void => {
    if (gestured || !ev.isTrusted && ev.type !== 'click') return;
    gestured = true;
    for (const t of ['click', 'keydown', 'touchend', 'pointerup']) window.removeEventListener(t, gesture, true);
    try { actions.userGesture(); } catch { /* the game decides what a gesture means */ }
  };
  for (const t of ['click', 'keydown', 'touchend', 'pointerup']) window.addEventListener(t, gesture, true);

  // ------------------------------------------------------------------ blocking / focus
  function computeBlocking(): boolean {
    return state.screen !== 'game' || ctx.modals.count > 0 || pedestal.isOpen || chat.open || results.isOpen;
  }
  function refreshBlocking(): void {
    const b = computeBlocking();
    root.classList.toggle('blocking', b);
    root.classList.toggle('modal-open', ctx.modals.count > 0);
    root.classList.toggle('res-open', results.isOpen);
    touch.setActive(state.screen === 'game' && !b);
    paintScoreboard();
    if (b === blocking) return;
    blocking = b;
    try { actions.setUiFocus(b); } catch { /* ignore */ }
    if (!b) {
      // hand the keyboard back to the game canvas
      const a = document.activeElement;
      if (a instanceof HTMLElement && root.contains(a)) a.blur();
    }
  }
  function paintScoreboard(): void {
    scoreboard.setVisible(scoreWanted && state.screen === 'game' && ctx.modals.count === 0 && !results.isOpen && !pedestal.isOpen);
    root.classList.toggle('score-open', scoreboard.visible);
  }

  // ------------------------------------------------------------------ keyboard
  // Keys are examined in the capture phase so Escape / Tab / arrows work wherever focus is. Events
  // that target our own controls are left to travel on (inputs and tab strips have their own
  // handlers) and are stopped from bubbling out to the game while the interface is blocking.
  const stop = (ev: Event): void => { ev.stopPropagation(); ev.stopImmediatePropagation(); };
  window.addEventListener('keydown', (ev) => {
    const inside = ev.target instanceof Node && root.contains(ev.target);
    if (ctx.keyCapture) { ev.preventDefault(); stop(ev); ctx.keyCapture(ev); if (ev.key === 'Escape') lastEscape = performance.now(); return; }
    if (ev.key === 'Escape' && state.screen === 'game' && computeBlocking()) lastEscape = performance.now();
    if (ctx.modals.count > 0) {
      if (ctx.modals.handleKey(ev) && ev.key === 'Escape') ev.preventDefault();
      if (!inside) stop(ev);
      return;
    }
    if (state.screen !== 'game') return;
    if (chat.open) {
      if (!inside) {
        if (ev.key === 'Escape') { chat.close(true); ev.preventDefault(); }
        stop(ev);
      }
      return;
    }
    if (results.isOpen) {
      if (ev.key === 'Escape') { results.set(null); ctx.sound('close'); ev.preventDefault(); }
      else if (ev.key === 'Tab') ev.preventDefault();
      if (!inside) stop(ev);
      return;
    }
    if (pedestal.isOpen) {
      if (pedestal.handleKey(ev) && ev.key !== 'Tab') ev.preventDefault();
      if (!inside) stop(ev);
    }
  }, true);
  window.addEventListener('keyup', (ev) => { if (ctx.keyCapture) stop(ev); }, true);
  root.addEventListener('keydown', (ev) => { if (blocking) ev.stopPropagation(); });
  root.addEventListener('keypress', (ev) => { if (blocking) ev.stopPropagation(); });
  // a HUD button clicked mid-game must not keep the keyboard
  root.addEventListener('click', () => {
    if (blocking) return;
    const a = document.activeElement;
    if (a instanceof HTMLElement && root.contains(a)) a.blur();
  });

  // ------------------------------------------------------------------ connection banner (in game)
  function paintNet(): void {
    // offline practice is a working mode, not a fault: only a dropped live connection earns a banner
    const bad = state.screen === 'game' && state.conn === 'reconnecting';
    show(net, bad);
    if (!bad || !state.conn) return;
    net.dataset.state = state.conn;
    setText(netText, state.conn === 'offline' ? `Connection lost${state.connDetail ? ` · ${state.connDetail}` : ''}` : `${CONNECTION_LABEL.reconnecting}${state.connDetail ? ` ${state.connDetail}` : ''}`);
  }

  // ------------------------------------------------------------------ the contract
  const ui: Ui = {
    touch: touch.input,
    isBlocking: () => blocking,

    setLoading(progress: number, label: string): void { loading.set(progress, label); },

    setScreen(screen: 'loading' | 'title' | 'game'): void {
      if (screen === state.screen) return;
      const prev = state.screen;
      state.screen = screen;
      root.classList.remove('s-loading', 's-title', 's-game');
      root.classList.add(`s-${screen}`);
      if (screen === 'loading') { loading.el.classList.remove('leaving'); show(loading.el, true); loading.setActive(true); }
      else if (prev === 'loading') {
        loading.setActive(false);
        loading.el.classList.add('leaving');
        window.setTimeout(() => { if (state.screen !== 'loading') show(loading.el, false); }, 650);
      }
      title.setActive(screen === 'title');
      if (screen !== 'game') {
        ctx.modals.closeAll();
        pedestal.close(true);
        chat.close(false);
        results.set(null);
        death.set(null);
        scoreWanted = false;
        show(hud.el, false);
        world.clearPlates();
        if (screen === 'title') chat.clear();
      } else {
        ctx.modals.closeAll();
      }
      ctx.emit('screen');
      paintNet();
      refreshBlocking();
    },

    setConnection(s, detail): void {
      state.conn = s; state.connDetail = detail || '';
      ctx.emit('conn');
      paintNet();
    },
    setProfile(p: Profile): void { state.profile = p; ctx.emit('profile'); },
    setRoom(room: RoomInfo | null): void { state.room = room; ctx.emit('room'); },
    setRoster(roster: RosterEntry[], localId: number): void { state.roster = roster; state.localId = localId; ctx.emit('roster'); },
    setMatch(m: MatchInfo): void { state.match = m; ctx.emit('match'); results.syncClock(); },

    setHud(f: HudFrame): void {
      state.hud = f;
      if (state.screen !== 'game') return;
      hud.setFrame(f);
      touch.update(f);
      death.tick(f.respawnIn);
      scoreboard.tick();
    },
    setNameplates(list: Nameplate[]): void { world.setNameplates(list); },

    showPedestal(el: ElementId | null): void { if (el) pedestal.open(el); else pedestal.close(true); },
    showResults(r: MatchResults | null): void { if (r) { ctx.modals.closeAll(); pedestal.close(true); chat.close(false); } results.set(r); paintScoreboard(); },
    showDeath(d: DeathInfo | null): void { death.set(d); },
    setHint(hint: Hint | null): void { hud.setHint(hint); },

    toggleMenu(open?: boolean): void {
      if (state.screen !== 'game') return;
      if (open === undefined) {
        // the same Escape press may already have closed something here
        if (performance.now() - lastEscape < 160) return;
        if (!menu.isOpen) {
          if (ctx.modals.count > 0) { ctx.modals.close(); return; }
          if (chat.open) { chat.close(true); return; }
          if (pedestal.isOpen) { pedestal.close(); return; }
          if (results.isOpen) { results.set(null); return; }
        }
      }
      if (open === false && !menu.isOpen) return;
      menu.toggle(open);
    },
    showScoreboard(on: boolean): void { scoreWanted = on; paintScoreboard(); },
    openChat(): void { if (state.screen === 'game' && ctx.modals.count === 0 && !results.isOpen) chat.openInput(); },

    pushFeed(entry: FeedEntry): void { hud.pushFeed(entry); },
    pushChat(line: ChatLine): void { chat.push(line); },
    pushAnnouncement(kind: AnnounceKind, playerName: string, n: number): void { hud.pushAnnouncement(kind, playerName, n); },
    pushDamageNumber(d: DamageNumber): void { world.pushDamageNumber(d); },
    hitMarker(kind): void { hud.hitMarker(kind); },
    damageFrom(angle: number, strength: number): void { hud.damageFrom(angle, strength); },
    gloryGain(amount: number, why: string): void { hud.gloryGain(amount, why); },
    toast(text: string, kind?: 'info' | 'good' | 'bad'): void { ctx.toast(text, kind); },
  };

  layout();
  return ui;
}
