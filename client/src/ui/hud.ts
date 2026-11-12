// The in-game HUD for both zones (hall and arena). `setFrame()` runs every rendered frame, so every
// piece keeps the last value it drew and touches the DOM only when that value changes.

import type { FeedEntry, Hint, HudFrame } from '../contracts';
import type { AnnounceKind, MatchInfo, RosterEntry } from '@shared/types';
import { ELEMENTS, ELEMENT_ORDER, STATUS_INFO, SLOT_COUNT, abilityByKey, type ElementId } from '@shared/elements';
import { settings } from '../settings';
import { h, frag, setText, setClass, show, clock, num, hex, rgb, clamp01, copyText } from './dom';
import { abilityIcon, elementEmblem, uiIcon } from './icons';
import { actionKeycap, fillKeycap, primaryBind } from './keys';
import { button, icon, medal, tint, type Ctx } from './core';
import { AbilitySlot } from './slots';
import { ANNOUNCE, GLORY_WHY } from './copy';

const STATUS_ICON: Record<string, string> = {
  burn: uiIcon('flame'), chill: elementEmblem('frost'), freeze: elementEmblem('frost'), shock: elementEmblem('storm'),
  root: uiIcon('lock'), slow: uiIcon('timer'), bubble: elementEmblem('tide'), stealth: uiIcon('eye'),
};

const elOf = (index: number): ElementId => ELEMENT_ORDER[index] || ELEMENT_ORDER[0];

interface StatusChip { el: HTMLElement; time: HTMLElement; stack: HTMLElement; used: boolean; t: number; n: number }
interface Announcement { kind: AnnounceKind; name: string; n: number }

export class Hud {
  readonly el: HTMLElement;
  /** Bottom-left mount point for the chat log. */
  readonly chatMount: HTMLElement;

  // ---- top
  private board: HTMLElement;
  private boardRows: HTMLElement;
  private boardTitle: HTMLElement;
  private clockEl: HTMLElement;
  private clockTime: HTMLElement;
  private clockSub: HTMLElement;
  private banner: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerSub: HTMLElement;
  private feed: HTMLElement;
  private roomChip: HTMLButtonElement;
  private roomCode: HTMLElement;
  // ---- centre
  private cross: HTMLElement;
  private marker: HTMLElement;
  private dirs: HTMLElement[] = [];
  private dirIndex = 0;
  private recall: HTMLElement;
  private recallArc: SVGCircleElement;
  private prompt: HTMLElement;
  private promptKey: HTMLElement;
  private promptText: HTMLElement;
  private promptBtn: HTMLButtonElement;
  private promptBtnText: HTMLElement;
  private announceEl: HTMLElement;
  private minorEl: HTMLElement;
  private hintEl: HTMLElement;
  // ---- bottom
  private bottom: HTMLElement;
  private statusRow: HTMLElement;
  private hpWrap: HTMLElement;
  private hpFill: HTMLElement;
  private hpGhost: HTMLElement;
  private hpNum: HTMLElement;
  private streak: HTMLElement;
  private streakNum: HTMLElement;
  private plate: HTMLElement;
  private plateMedal: HTMLElement;
  private plateName: HTMLElement;
  private plateTitle: HTMLElement;
  private trialBtn: HTMLButtonElement;
  private deploy: HTMLButtonElement;
  private deployLabel: HTMLElement;
  private deployKey: HTMLElement;
  private bar: HTMLElement;
  readonly slots: AbilitySlot[] = [];
  private gloryEl: HTMLElement;
  private gloryNum: HTMLElement;
  private ticker: HTMLElement;
  private perf: HTMLElement;
  private perfFps: HTMLElement;
  private perfPing: HTMLElement;

  // ---- diff state
  private zone = '';
  private element: ElementId | '' = '';
  private hp = -1;
  private ghost = 1;
  private ghostHold = 0;
  private gloryShown = -1;
  private gloryDrawn = NaN;
  private promptLabel = '';
  private streakDrawn = -1;
  private boardSig = '';
  private soundSecond = -1;
  private gloryTarget = -1;
  private chips = new Map<string, StatusChip>();
  private promptAction = '';
  private recallShown = -1;
  private perfAt = 0;
  private lastFrameAt = 0;
  private matchAt = 0;
  private match: MatchInfo | null = null;
  private clockShown = -1;
  private hitGain = 0;
  private hitGainEl: HTMLElement | null = null;
  private hitGainTimer = 0;
  private queue: Announcement[] = [];
  private announcing = false;
  private hint: Hint | null = null;
  private reduceMotion = false;

  constructor(private ctx: Ctx) {
    // ------------------------------------------------------------ top left: leaderboard / roster
    this.boardTitle = h('div.board-title.t-label');
    this.boardRows = h('ol.board-rows');
    this.board = h('section.board.glass', { attrs: { 'aria-label': 'Standings' } }, this.boardTitle, this.boardRows);

    // ------------------------------------------------------------ top centre: clock (arena) / banner (hall)
    this.clockTime = h('div.clock-time.t-num', { text: '0:00' });
    this.clockSub = h('div.clock-sub');
    this.clockEl = h('div.clock', { role: 'timer', attrs: { 'aria-label': 'Match time' } }, this.clockTime, this.clockSub);
    this.bannerTitle = h('div.banner-title');
    this.bannerSub = h('div.banner-sub');
    this.banner = h('div.banner', { role: 'status' }, h('div.rule', null, h('i')), this.bannerTitle, this.bannerSub);

    // ------------------------------------------------------------ top right: room chip + kill feed
    this.roomCode = h('b.t-num');
    this.roomChip = button(ctx, { class: 'room-chip v-click', aria: 'Copy invite link', title: 'Copy invite link', onClick: () => this.copyInvite() },
      icon('users'), h('span', { text: 'Room' }), this.roomCode, icon('copy', 'room-copy'));
    this.feed = h('ul.feed', { attrs: { 'aria-label': 'Kill feed', 'aria-live': 'off' } });

    // ------------------------------------------------------------ centre: crosshair and friends
    this.cross = h('div.cross', { attrs: { 'aria-hidden': 'true' } }, h('i.c-dot'), h('i.c-t'), h('i.c-r'), h('i.c-b'), h('i.c-l'), h('i.c-ring'));
    this.marker = h('div.marker', { attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i'), h('i'), h('b'));
    const dirWrap = h('div.dirs', { attrs: { 'aria-hidden': 'true' } });
    for (let i = 0; i < 6; i++) {
      const d = h('div.dir', null, frag('<svg viewBox="0 0 120 40" class="vi"><path d="M6 34C32 12 88 12 114 34L104 38C82 22 38 22 16 38Z" fill="currentColor"/><path d="M60 2L70 14H50Z" fill="currentColor"/></svg>'));
      this.dirs.push(d); dirWrap.appendChild(d);
    }
    const ring = frag('<svg class="recall-svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" class="r-track"/><circle cx="32" cy="32" r="27" class="r-arc" transform="rotate(-90 32 32)"/></svg>');
    this.recallArc = ring.querySelector('.r-arc') as unknown as SVGCircleElement;
    this.recall = h('div.recall', { hidden: true, role: 'status' }, ring, h('span.recall-icon', { html: uiIcon('door') }), h('div.recall-label', { text: 'Returning to the hall' }));
    this.promptKey = h('kbd.keycap');
    this.promptText = h('span.prompt-text');
    this.promptBtnText = h('span.prompt-btn-text');
    this.promptBtn = button(ctx, { class: 'prompt-btn v-click', onClick: () => this.firePrompt() }, icon('touch'), this.promptBtnText);
    this.prompt = h('div.prompt', { hidden: true, role: 'status' }, this.promptKey, this.promptText, this.promptBtn);
    this.announceEl = h('div.announce', { attrs: { 'aria-live': 'assertive' } });
    this.minorEl = h('div.announce-minor', { attrs: { 'aria-live': 'polite' } });
    this.hintEl = h('aside.hint.panel', { hidden: true, attrs: { 'aria-live': 'polite' } });

    // ------------------------------------------------------------ bottom centre
    this.statusRow = h('ul.statuses', { attrs: { 'aria-label': 'Status effects' } });
    this.hpFill = h('i.hp-fill');
    this.hpGhost = h('i.hp-ghost');
    this.hpNum = h('span.hp-num.t-num', { text: '100' });
    this.streakNum = h('b.t-num');
    this.streak = h('span.streak', { hidden: true }, icon('flame'), this.streakNum);
    this.hpWrap = h('div.hp', { role: 'meter', attrs: { 'aria-label': 'Health', 'aria-valuemin': 0, 'aria-valuemax': 100 } },
      h('span.hp-icon', { html: uiIcon('heart') }), this.hpNum,
      h('div.hp-track', null, this.hpGhost, this.hpFill, h('i.hp-ticks')), this.streak);

    this.plateMedal = h('span.medal');
    this.plateName = h('span.plate-name');
    this.plateTitle = h('span.plate-title');
    this.trialBtn = button(ctx, { label: 'End trial', class: 'btn small v-click plate-trial', sound: 'back', onClick: () => ctx.actions.trial(null) });
    this.plate = h('div.plate', null, this.plateMedal, h('div.plate-text', null, this.plateName, this.plateTitle), h('span.tag.plate-tag', { text: 'Trial' }), this.trialBtn);

    this.deployLabel = h('span.deploy-label');
    this.deployKey = h('kbd.keycap');
    this.deploy = button(ctx, { class: 'deploy v-click', sound: 'deploy', onClick: () => ctx.actions.deploy() },
      h('span.deploy-glyph', { html: uiIcon('swords') }), this.deployLabel, this.deployKey);

    this.bar = h('div.bar', { role: 'group', attrs: { 'aria-label': 'Abilities' } });
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = new AbilitySlot(i);
      this.slots.push(s);
      if (i === SLOT_COUNT - 1) this.bar.appendChild(h('i.bar-sep'));
      this.bar.appendChild(s.el);
    }
    this.bottom = h('div.hud-bc', null, this.statusRow, this.deploy, this.plate, this.hpWrap, this.bar);

    // ------------------------------------------------------------ bottom right
    this.gloryNum = h('span.t-num', { text: '0' });
    this.gloryEl = h('div.hud-glory', { attrs: { 'aria-label': 'Glory' } }, h('span.glory', null, icon('glory'), this.gloryNum), h('span.t-label', { text: 'Glory' }));
    this.ticker = h('ul.ticker', { attrs: { 'aria-live': 'off' } });
    this.perfFps = h('span.t-num');
    this.perfPing = h('span.t-num.perf-ping');
    this.perf = h('div.perf', { attrs: { 'aria-hidden': 'true' } }, this.perfFps, h('span.perf-bars', { html: uiIcon('signal') }), this.perfPing);

    this.chatMount = h('div.hud-bl');

    this.el = h('div.v-layer.v-hud', { hidden: true },
      h('div.hud-tl', null, this.board),
      h('div.hud-tc', null, this.clockEl, this.banner),
      h('div.hud-tr', null, this.roomChip, this.feed),
      h('div.hud-center', null, dirWrap, this.cross, this.marker, this.recall),
      this.prompt, this.announceEl, this.minorEl, this.hintEl,
      this.chatMount, this.bottom,
      h('div.hud-br', null, this.ticker, this.gloryEl, this.perf));

    ctx.on('binds', () => this.refreshBinds());
    ctx.on('roster', () => this.paintBoard());
    ctx.on('room', () => this.paintRoom());
    ctx.on('match', () => { this.match = ctx.state.match; this.matchAt = performance.now(); this.paintMatch(true); this.paintBoard(); });
    ctx.on('touch', () => { this.paintPrompt(true); this.paintHint(); });
    ctx.on('settings', () => this.applySettings());
    ctx.on('profile', () => this.paintBoard());
    ctx.on('layout', () => this.paintBoard());
    this.applySettings();
    this.refreshBinds();
    this.paintRoom();
  }

  private applySettings(): void {
    const s = settings.get();
    this.reduceMotion = s.reduceMotion;
    show(this.perf, s.showFps || s.showPing);
    show(this.perfFps, s.showFps);
    show(this.perfPing, s.showPing);
    (this.perf.querySelector('.perf-bars') as HTMLElement).hidden = !s.showPing;
    this.paintHint();
  }

  private refreshBinds(): void {
    for (const s of this.slots) s.refreshKey();
    fillKeycap(this.deployKey, primaryBind('deploy'));
    this.paintPrompt(true);
    this.paintHint();
  }

  // ====================================================================== per-frame
  setFrame(f: HudFrame): void {
    const now = performance.now();
    const dt = this.lastFrameAt ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 0.016;
    this.lastFrameAt = now;
    show(this.el, f.inGame);
    if (!f.inGame) return;

    if (f.zone !== this.zone) {
      this.zone = f.zone;
      this.el.classList.toggle('zone-hall', f.zone === 'hall');
      this.el.classList.toggle('zone-arena', f.zone === 'arena');
      this.clockShown = -1;
      this.paintMatch(true);
      this.paintBoard();
      this.ctx.emit('zone');
    }
    setClass(this.el, 'dead', !f.alive);

    // ---- element
    if (f.element !== this.element) {
      this.element = f.element;
      const def = ELEMENTS[f.element];
      tint(this.bottom, f.element);
      for (const s of this.slots) s.setElement(f.element);
      this.plateMedal.innerHTML = elementEmblem(f.element);
      setText(this.plateName, def.name);
      setText(this.plateTitle, def.title);
    }
    setClass(this.plate, 'trial', f.trial);

    // ---- health
    const maxHp = f.maxHp > 0 ? f.maxHp : 100;
    const hp = Math.max(0, Math.min(maxHp, f.hp));
    const frac = hp / maxHp;
    if (hp !== this.hp) {
      const prev = this.hp;
      this.hp = hp;
      this.hpFill.style.transform = `scaleX(${frac.toFixed(4)})`;
      setText(this.hpNum, String(Math.ceil(hp)));
      this.hpWrap.setAttribute('aria-valuenow', String(Math.ceil(hp)));
      if (prev >= 0 && hp < prev - 0.5) {
        this.ghostHold = 0.38;
        if (this.ghost < prev / maxHp) this.ghost = prev / maxHp;
        if (!this.reduceMotion && this.hpWrap.animate) {
          const k = Math.min(1, (prev - hp) / 25);
          this.hpWrap.animate([{ transform: `translateX(${-4 * k - 1}px)` }, { transform: `translateX(${3 * k + 1}px)` }, { transform: 'translateX(-1px)' }, { transform: 'none' }], { duration: 240 });
        }
        if (this.hpFill.animate) this.hpFill.animate([{ filter: 'brightness(2.4) saturate(0.2)' }, { filter: 'none' }], { duration: 260 });
      } else if (prev >= 0 && hp > prev + 0.5 && this.hpFill.animate) {
        this.hpFill.animate([{ filter: 'brightness(1.8) hue-rotate(60deg)' }, { filter: 'none' }], { duration: 500 });
      }
      setClass(this.hpWrap, 'low', frac <= 0.3 && hp > 0);
      setClass(this.hpWrap, 'mid', frac > 0.3 && frac <= 0.6);
    }
    if (this.ghost > frac) {
      if (this.ghostHold > 0) this.ghostHold -= dt; else this.ghost = Math.max(frac, this.ghost - dt * 0.9);
      this.hpGhost.style.transform = `scaleX(${this.ghost.toFixed(4)})`;
    } else if (this.ghost !== frac) {
      this.ghost = frac;
      this.hpGhost.style.transform = `scaleX(${frac.toFixed(4)})`;
    }

    // ---- abilities
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].update(f.cooldown[i] || 0, f.cooldownTotal[i] || 0, f.activeSlot === i, !!f.locked[i], this.reduceMotion);
    }

    // ---- statuses
    this.paintStatuses(f.statuses);

    // ---- streak
    const streak = f.streak >= 2 && f.zone === 'arena' ? f.streak : 0;
    if (streak !== this.streakDrawn) { this.streakDrawn = streak; show(this.streak, streak > 0); if (streak) setText(this.streakNum, `×${streak}`); }

    // ---- glory (count toward the target)
    if (f.glory !== this.gloryTarget) {
      if (this.gloryTarget >= 0 && f.glory > this.gloryTarget && !this.reduceMotion && this.gloryEl.animate) {
        this.gloryEl.animate([{ transform: 'scale(1.12)', filter: 'brightness(1.5)' }, { transform: 'none', filter: 'none' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      }
      if (this.gloryTarget < 0 || this.reduceMotion) this.gloryShown = f.glory;
      this.gloryTarget = f.glory;
    }
    if (this.gloryShown !== this.gloryTarget) {
      const diff = this.gloryTarget - this.gloryShown;
      const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * dt * 6);
      this.gloryShown = Math.abs(step) >= Math.abs(diff) ? this.gloryTarget : this.gloryShown + step;
    }
    const gloryInt = Math.round(this.gloryShown);
    if (gloryInt !== this.gloryDrawn) { this.gloryDrawn = gloryInt; setText(this.gloryNum, num(gloryInt)); }

    // ---- prompt, recall, crosshair
    const action = f.prompt ? f.prompt.action : '';
    const label = f.prompt ? f.prompt.text : '';
    if (action !== this.promptAction || label !== this.promptLabel) {
      this.promptAction = action;
      this.promptLabel = label;
      if (f.prompt) { setText(this.promptText, label); setText(this.promptBtnText, label); }
      this.paintPrompt(false);
    }
    const rc = f.recall > 0.001 ? Math.round(clamp01(f.recall) * 100) : 0;
    if (rc !== this.recallShown) {
      this.recallShown = rc;
      show(this.recall, rc > 0);
      setClass(this.el, 'recalling', rc > 0);
      this.recallArc.style.strokeDashoffset = String(169.6 * (1 - rc / 100));
    }
    setClass(this.cross, 'on-target', f.targetId > 0 && f.alive);
    setClass(this.cross, 'busy', f.activeSlot >= 0);

    // ---- clock / banner (once a second)
    this.paintMatch(false);

    // ---- perf (twice a second)
    if (now - this.perfAt > 500) {
      this.perfAt = now;
      setText(this.perfFps, `${Math.round(f.fps)} FPS`);
      setText(this.perfPing, `${Math.round(f.ping)} ms`);
      const q = f.ping < 70 ? 'good' : f.ping < 140 ? 'ok' : 'poor';
      if (this.perf.dataset.q !== q) this.perf.dataset.q = q;
    }
  }

  private paintStatuses(list: { k: string; t: number; n?: number }[]): void {
    if (!list.length && !this.chips.size) return;
    for (const c of this.chips.values()) c.used = false;
    for (const s of list) {
      const info = STATUS_INFO[s.k];
      if (!info) continue;
      let c = this.chips.get(s.k);
      if (!c) {
        const time = h('span.st-time.t-num');
        const stack = h('b.st-stack.t-num');
        const el = h('li.status', { title: info.desc, style: { '--st': hex(info.color), '--st-rgb': rgb(info.color) } },
          h('span.st-icon', { html: STATUS_ICON[s.k] || uiIcon('info') }), h('span.st-name', { text: info.name }), stack, time);
        c = { el, time, stack, used: true, t: -1, n: -1 };
        this.chips.set(s.k, c);
        this.statusRow.appendChild(el);
      }
      c.used = true;
      const tenths = s.t > 0 ? Math.ceil(s.t * 10) : 0;
      if (tenths !== c.t) { c.t = tenths; setText(c.time, tenths ? (tenths / 10).toFixed(1) : ''); }
      const n = s.n && s.n > 1 ? s.n : 0;
      if (n !== c.n) { c.n = n; setText(c.stack, n ? `×${n}` : ''); }
    }
    for (const [k, c] of this.chips) if (!c.used) { c.el.remove(); this.chips.delete(k); }
  }

  // ====================================================================== match clock / hall banner
  private timeLeft(): number {
    if (!this.match) return 0;
    return Math.max(0, this.match.timeLeft - (performance.now() - this.matchAt) / 1000);
  }

  private paintMatch(force: boolean): void {
    const m = this.match;
    if (!m) { show(this.clockEl, false); show(this.banner, false); show(this.deploy, false); return; }
    const left = Math.ceil(this.timeLeft());
    if (!force && left === this.clockShown) return;
    this.clockShown = left;
    const sig = left + (m.phase === 'live' ? 1000 : m.phase === 'intermission' ? 2000 : 3000) + m.round * 10000;
    const tick = sig !== this.soundSecond;
    this.soundSecond = sig;
    const hall = this.zone === 'hall';
    show(this.clockEl, !hall);
    show(this.banner, hall);
    show(this.deploy, hall);
    if (hall) {
      this.banner.dataset.phase = m.phase;
      if (m.phase === 'intermission') {
        setText(this.bannerTitle, `Next match in ${clock(left)}`);
        setText(this.bannerSub, 'Choose your element. The Skygate opens at the horn.');
        setText(this.deployLabel, `Skygate opens in ${clock(left)}`);
        if (tick && left <= 5 && left > 0) this.ctx.sound('countdown');
      } else if (m.phase === 'live') {
        setText(this.bannerTitle, 'Match live — deploy!');
        setText(this.bannerSub, `${clock(left)} left · first to ${m.killTarget} kills`);
        setText(this.deployLabel, 'Deploy to the arena');
      } else {
        setText(this.bannerTitle, 'The horn has sounded');
        setText(this.bannerSub, `Next match in ${clock(left)}`);
        setText(this.deployLabel, 'The arena is closed');
      }
      const live = m.phase === 'live';
      if (this.deploy.disabled === live) this.deploy.disabled = !live;
      setClass(this.deploy, 'live', live);
    } else {
      setText(this.clockTime, m.phase === 'live' ? clock(left) : m.phase === 'results' ? 'Over' : clock(left));
      setClass(this.clockEl, 'urgent', m.phase === 'live' && left <= 10);
      setClass(this.clockEl, 'late', m.phase === 'live' && left <= 60);
      const lead = this.leaderKills();
      setText(this.clockSub, m.phase === 'live' ? `First to ${m.killTarget}${lead > 0 ? ` · leader ${lead}` : ''}` : m.phase === 'intermission' ? 'Intermission' : 'Match over');
      if (tick && m.phase === 'live' && left <= 10 && left > 0) this.ctx.sound('countdown');
    }
  }

  private leaderKills(): number {
    let best = 0;
    for (const r of this.ctx.state.roster) if (!r.dummy && r.kills > best) best = r.kills;
    return best;
  }

  // ====================================================================== leaderboard / roster
  private paintBoard(): void {
    const roster = this.ctx.state.roster.filter((r) => !r.dummy);
    const localId = this.ctx.state.localId;
    const rows = this.boardRows;
    const short = this.ctx.root.classList.contains('short');
    let sig = `${this.zone}|${localId}|${short}|${this.match ? `${this.match.round}/${this.match.killTarget}` : ''}`;
    for (const r of roster) sig += `|${r.id},${r.name},${r.el},${r.kills},${r.deaths},${r.hall ? 1 : 0},${r.bot ? 1 : 0}`;
    if (sig === this.boardSig) return;
    this.boardSig = sig;
    rows.textContent = '';
    if (this.zone === 'hall') {
      setText(this.boardTitle, `In this hall · ${roster.length}`);
      const sorted = roster.slice().sort((a, b) => Number(b.id === localId) - Number(a.id === localId) || Number(a.bot) - Number(b.bot) || a.name.localeCompare(b.name));
      const cap = short ? 4 : 8;
      for (const r of sorted.slice(0, cap)) rows.appendChild(this.boardRow(r, null, r.hall ? 'Hall' : 'Arena', r.id === localId, !r.hall));
      if (sorted.length > cap) rows.appendChild(h('li.board-more', { text: `+${sorted.length - cap} more` }));
      return;
    }
    setText(this.boardTitle, this.match ? `Round ${this.match.round} · first to ${this.match.killTarget}` : 'Standings');
    const sorted = roster.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.dmg - a.dmg);
    const top = sorted.slice(0, 3);
    top.forEach((r, i) => rows.appendChild(this.boardRow(r, i + 1, String(r.kills), r.id === localId, false)));
    const mine = sorted.findIndex((r) => r.id === localId);
    if (mine >= 3) {
      if (mine > 3) rows.appendChild(h('li.board-gap', { attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')));
      rows.appendChild(this.boardRow(sorted[mine], mine + 1, String(sorted[mine].kills), true, false));
    }
  }

  private boardRow(r: RosterEntry, rank: number | null, value: string, you: boolean, dim: boolean): HTMLElement {
    return h('li.board-row', { class: `${you ? 'you' : ''} ${dim ? 'away' : ''} ${rank === 1 ? 'first' : ''}` },
      rank !== null ? h('span.board-rank.t-num', null, rank === 1 ? icon('crown') : String(rank)) : null,
      medal(elOf(r.el), 'tiny'),
      h('span.board-name', null, r.name, r.bot ? h('span.bot-tag', { text: 'Bot' }) : null),
      h('span.board-val.t-num', { text: value }));
  }

  // ====================================================================== room chip
  private paintRoom(): void {
    const room = this.ctx.state.room;
    show(this.roomChip, !!room);
    if (!room) return;
    setText(this.roomCode, room.code);
    this.roomChip.classList.toggle('is-private', room.isPrivate);
    (this.roomChip.querySelector('span') as HTMLElement).textContent = room.isPrivate ? 'Private room' : 'Room';
  }

  private async copyInvite(): Promise<void> {
    const room = this.ctx.state.room;
    if (!room) return;
    const ok = await copyText(this.ctx.inviteLink(room.code));
    this.ctx.toast(ok ? 'Invite link copied. Send it to someone you want to fight.' : `Room code: ${room.code}`, ok ? 'good' : 'info');
  }

  // ====================================================================== prompt
  private paintPrompt(force: boolean): void {
    const has = !!this.promptAction;
    show(this.prompt, has);
    if (!has && !force) return;
    const touch = this.ctx.state.touch;
    setClass(this.prompt, 'as-touch', touch);
    fillKeycap(this.promptKey, primaryBind(this.promptAction));
  }

  /** Touch (or mouse) activation of the context prompt. */
  private firePrompt(): void {
    const a = this.promptAction;
    if (!a) return;
    if (a === 'deploy') { this.ctx.actions.deploy(); return; }
    if (a === 'hall') { this.ctx.actions.returnToHall(); return; }
    // Everything else has no direct UiAction: press the bound key on the player's behalf.
    pressBoundKey(a);
  }

  // ====================================================================== transient feedback
  pushFeed(e: FeedEntry): void {
    const ability = abilityByKey(e.ability);
    const li = h('li.feed-row', { class: `${e.youKiller ? 'you-killer' : ''} ${e.youVictim ? 'you-victim' : ''}` });
    tint(li, e.killerEl);
    const how = h('span.feed-how', { html: e.fall ? uiIcon('fall') : ability ? abilityIcon(e.ability) : uiIcon('skull'), title: e.fall ? 'Ring out' : ability ? ability.name : 'Kill' });
    if (e.killer) li.append(h('span.feed-killer', { text: e.killer }));
    li.append(how, h('span.feed-victim', { text: e.victim }));
    li.setAttribute('aria-label', e.killer ? `${e.killer} ${e.fall ? 'rang out' : 'killed'} ${e.victim}` : `${e.victim} fell`);
    this.feed.appendChild(li);
    while (this.feed.childElementCount > 5) this.feed.firstElementChild?.remove();
    window.setTimeout(() => { li.classList.add('out'); window.setTimeout(() => li.remove(), 400); }, 6500);
  }

  pushAnnouncement(kind: AnnounceKind, name: string, n: number): void {
    const def = ANNOUNCE[kind];
    if (!def) return;
    if (def.minor) {
      const el = h('div.minor', null, h('b', { text: name }), ` ${def.title.toLowerCase()}`);
      this.minorEl.textContent = '';
      this.minorEl.appendChild(el);
      window.setTimeout(() => el.remove(), 2600);
      return;
    }
    if (this.queue.length > 3) this.queue.shift();
    this.queue.push({ kind, name, n });
    if (!this.announcing) this.nextAnnouncement();
  }

  private nextAnnouncement(): void {
    const a = this.queue.shift();
    if (!a) { this.announcing = false; this.el.classList.remove('announcing'); return; }
    this.announcing = true;
    this.el.classList.add('announcing');
    const def = ANNOUNCE[a.kind];
    const n = a.kind === 'matchstart' && !a.n ? (this.match ? this.match.killTarget : 0) : a.n;
    const sub = def.sub(a.name, n);
    const el = h('div.ann', { class: `tone-${def.tone}` },
      h('div.ann-line'),
      h('div.ann-title', { attrs: { 'aria-label': def.title } }, ...def.title.split('').map((c, i) => h('span', { text: c === ' ' ? ' ' : c, style: { '--i': String(i) } }))),
      sub ? h('div.ann-sub', { text: sub }) : null);
    this.announceEl.textContent = '';
    this.announceEl.appendChild(el);
    const hold = this.queue.length ? 1500 : 2300;
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => { el.remove(); this.nextAnnouncement(); }, 320);
    }, hold);
  }

  hitMarker(kind: 'hit' | 'heavy' | 'kill'): void {
    const m = this.marker;
    m.dataset.kind = kind;
    if (!m.animate) return;
    const big = kind === 'kill' ? 1.55 : kind === 'heavy' ? 1.25 : 1;
    const dur = kind === 'kill' ? 620 : kind === 'heavy' ? 380 : 260;
    for (const a of m.getAnimations()) a.cancel();
    m.animate(this.reduceMotion
      ? [{ opacity: 1, transform: `scale(${big})` }, { opacity: 0, transform: `scale(${big})` }]
      : [{ opacity: 1, transform: `scale(${big * 1.5})` }, { opacity: 1, transform: `scale(${big})`, offset: 0.3 }, { opacity: 0, transform: `scale(${big * 0.92})` }],
    { duration: dur, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }

  damageFrom(angle: number, strength: number): void {
    const d = this.dirs[this.dirIndex];
    this.dirIndex = (this.dirIndex + 1) % this.dirs.length;
    const s = clamp01(strength);
    d.style.transform = `rotate(${angle.toFixed(3)}rad)`;
    d.style.setProperty('--s', (0.75 + s * 0.5).toFixed(2));
    if (!d.animate) return;
    for (const a of d.getAnimations()) a.cancel();
    d.animate([{ opacity: 0.55 + s * 0.45 }, { opacity: 0.5 + s * 0.4, offset: 0.35 }, { opacity: 0 }], { duration: 900 + s * 700, easing: 'ease-out' });
  }

  gloryGain(amount: number, why: string): void {
    if (amount <= 0) return;
    // damage trickles in constantly: fold it into one running line instead of spamming
    if (why === 'hit') {
      this.hitGain += amount;
      if (!this.hitGainEl || !this.hitGainEl.isConnected) {
        this.hitGainEl = h('li.tick.tick-hit', null, h('b.t-num'), h('span', { text: GLORY_WHY.hit }));
        this.ticker.appendChild(this.hitGainEl);
      }
      setText(this.hitGainEl.firstElementChild as HTMLElement, `+${num(this.hitGain)}`);
      const el = this.hitGainEl;
      window.clearTimeout(this.hitGainTimer);
      this.hitGainTimer = window.setTimeout(() => { this.hitGain = 0; this.hitGainEl = null; el.classList.add('out'); window.setTimeout(() => el.remove(), 400); }, 1800);
      return;
    }
    const li = h('li.tick', { class: why === 'kill' || why === 'ringout' ? 'tick-big' : '' }, h('b.t-num', { text: `+${num(amount)}` }), h('span', { text: GLORY_WHY[why] || why }));
    this.ticker.appendChild(li);
    while (this.ticker.childElementCount > 5) this.ticker.firstElementChild?.remove();
    this.ctx.sound('glory');
    window.setTimeout(() => { li.classList.add('out'); window.setTimeout(() => li.remove(), 400); }, 2600);
  }

  // ====================================================================== coach marks
  setHint(hint: Hint | null): void {
    this.hint = hint;
    this.paintHint();
  }

  private paintHint(): void {
    const hint = settings.get().hints ? this.hint : null;
    const el = this.hintEl;
    if (!hint) { show(el, false); el.dataset.id = ''; return; }
    const touch = this.ctx.state.touch;
    const sig = `${hint.id}|${touch}|${(hint.actions || []).map(primaryBind).join(',')}`;
    if (el.dataset.id === sig) { show(el, true); return; }
    el.dataset.id = sig;
    el.textContent = '';
    const caps = (hint.actions || []).length
      ? h('div.hint-keys', null, ...(touch ? touchGlyphs(hint.actions || []) : (hint.actions || []).map((a) => actionKeycap(a))))
      : null;
    el.append(h('div.hint-head', null, h('span.hint-rune', { html: uiIcon('spark') }), h('h3', { text: hint.title })), h('p', { text: hint.text }));
    if (caps) el.append(caps);
    show(el, true);
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
}

const TOUCH_GLYPH: Record<string, { label: string; cls: string }> = {
  forward: { label: 'Left stick', cls: 'stick' }, back: { label: 'Left stick', cls: 'stick' }, left: { label: 'Left stick', cls: 'stick' }, right: { label: 'Left stick', cls: 'stick' },
  jump: { label: 'Jump', cls: 'jump' }, melee: { label: 'Strike', cls: 'melee' },
  ability1: { label: 'Ability 1', cls: 'ab' }, ability2: { label: 'Ability 2', cls: 'ab' }, ability3: { label: 'Ability 3', cls: 'ab' },
  move: { label: 'Signature', cls: 'move' }, interact: { label: 'Tap the prompt', cls: 'tap' }, deploy: { label: 'Deploy button', cls: 'tap' },
  hall: { label: 'Menu → Return', cls: 'tap' }, scoreboard: { label: 'Scores button', cls: 'tap' }, chat: { label: 'Chat button', cls: 'tap' }, menu: { label: 'Menu button', cls: 'tap' },
};

function touchGlyphs(actions: string[]): HTMLElement[] {
  const seen = new Set<string>();
  const out: HTMLElement[] = [];
  for (const a of actions) {
    const g = TOUCH_GLYPH[a];
    if (!g || seen.has(g.label)) continue;
    seen.add(g.label);
    out.push(h('span.tglyph', { class: g.cls }, h('i'), g.label));
  }
  return out;
}

/** Simulate a press of the first keyboard binding of an action, for prompts tapped on touch. */
export function pressBoundKey(action: string): void {
  const binds = (settings.get().binds as Record<string, string[] | undefined>)[action] || [];
  const code = binds.find((b) => !b.startsWith('Mouse')) || binds[0];
  if (!code || code.startsWith('Mouse')) return;
  const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code;
  const target: EventTarget = document.getElementById('game') || document.body;
  const init: KeyboardEventInit = { code, key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  window.setTimeout(() => target.dispatchEvent(new KeyboardEvent('keyup', init)), 60);
}
