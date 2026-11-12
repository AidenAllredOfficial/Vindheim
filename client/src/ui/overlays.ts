// Death overlay, match results, the full scoreboard and the pause menu.

import type { DeathInfo } from '../contracts';
import type { MatchResults, RosterEntry } from '@shared/types';
import { ELEMENTS, ELEMENT_ORDER, abilityByKey, type ElementId } from '@shared/elements';
import { h, setText, show, num, clock, ordinal, copyText } from './dom';
import { abilityIcon, uiIcon } from './icons';
import { actionKeycap } from './keys';
import { button, icon, medal, tint, type Ctx, type ModalHandle } from './core';

const elOf = (index: number): ElementId => ELEMENT_ORDER[index] || ELEMENT_ORDER[0];

// ================================================================================== death
export class DeathOverlay {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private by: HTMLElement;
  private count: HTMLElement;
  private ring: HTMLElement;
  private hintRow: HTMLElement;
  private info: DeathInfo | null = null;
  private total = 3;
  private shown = '';

  constructor(private ctx: Ctx) {
    this.head = h('div.death-head');
    this.by = h('div.death-by');
    this.count = h('b.t-num');
    this.ring = h('i.death-fill');
    this.hintRow = h('div.death-hint');
    this.el = h('div.death', { hidden: true, role: 'status', attrs: { 'aria-live': 'assertive' } },
      h('div.death-band', null,
        this.head, this.by,
        h('div.death-respawn', null, h('span', { text: 'Back in' }), this.count, h('div.death-meter', null, this.ring)),
        this.hintRow));
    ctx.on('binds', () => this.paintHint());
    ctx.on('touch', () => this.paintHint());
  }

  private paintHint(): void {
    this.hintRow.textContent = '';
    if (this.ctx.state.touch) this.hintRow.append('Open the menu to return to the hall');
    else this.hintRow.append('Hold ', actionKeycap('hall', 'dark'), ' to return to the hall');
  }

  set(d: DeathInfo | null): void {
    this.info = d;
    show(this.el, !!d);
    if (!d) return;
    this.total = Math.max(0.5, d.respawnIn);
    this.shown = '';
    const ability = abilityByKey(d.ability);
    tint(this.el, d.killerEl);
    setText(this.head, d.fall ? 'Ring Out' : 'Slain');
    this.by.textContent = '';
    if (d.killerName) {
      if (d.killerEl) this.by.append(medal(d.killerEl, 'small'));
      this.by.append(h('span', null, d.fall ? 'Sent over the edge by ' : 'Struck down by ', h('b', { text: d.killerName })));
      if (!d.fall && ability) this.by.append(h('span.death-ability', null, h('span.death-ability-icon', { html: abilityIcon(d.ability) }), ability.name));
    } else {
      this.by.append(h('span', { text: d.fall ? 'The cloud sea takes everyone equally.' : 'The arena claimed you.' }));
    }
    this.paintHint();
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
    this.tick(d.respawnIn);
  }

  /** Called every frame with HudFrame.respawnIn. */
  tick(respawnIn: number): void {
    if (!this.info) return;
    const t = Math.max(0, respawnIn);
    const text = t > 0.05 ? t.toFixed(1) : '0.0';
    if (text === this.shown) return;
    this.shown = text;
    setText(this.count, text);
    this.ring.style.transform = `scaleX(${Math.min(1, 1 - t / this.total).toFixed(3)})`;
  }
}

// ================================================================================== scoreboard
export class Scoreboard {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private rows: HTMLElement;
  private foot: HTMLElement;
  visible = false;
  private dirty = true;
  private at = 0;
  private clockDrawn = '';
  private sig = '';

  constructor(private ctx: Ctx) {
    this.title = h('h2');
    this.sub = h('div.score-sub');
    this.rows = h('tbody');
    this.foot = h('div.score-foot');
    this.el = h('section.scoreboard.panel', { hidden: true, attrs: { 'aria-label': 'Scoreboard' } },
      h('header.score-head', null, this.title, this.sub),
      h('div.score-scroll.scroll', null,
        h('table.score-table', null,
          h('thead', null, h('tr', null,
            h('th.c-rank', { text: '#', attrs: { scope: 'col' } }), h('th.c-name', { text: 'Warrior', attrs: { scope: 'col' } }),
            h('th', { attrs: { scope: 'col', title: 'Kills' } }, 'K'), h('th', { attrs: { scope: 'col', title: 'Deaths' } }, 'D'),
            h('th', { text: 'Damage', attrs: { scope: 'col' } }), h('th', { text: 'Streak', attrs: { scope: 'col' } }), h('th', { text: 'Ping', attrs: { scope: 'col' } }))),
          this.rows)),
      this.foot);
    ctx.on('roster', () => { this.dirty = true; if (this.visible) this.paint(); });
    ctx.on('match', () => { this.at = performance.now(); this.clockDrawn = ''; if (this.visible) this.tick(); });
    ctx.on('room', () => { this.dirty = true; if (this.visible) this.paint(); });
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    show(this.el, on);
    if (on) this.paint();
  }

  /** Keep the clock in the header fresh while open (called per frame, writes once a second). */
  tick(): void {
    if (!this.visible) return;
    const m = this.ctx.state.match;
    if (!m) return;
    const left = Math.ceil(Math.max(0, m.timeLeft - (performance.now() - this.at) / 1000));
    const key = `${m.phase}${left}`;
    if (key === this.clockDrawn) return;
    this.clockDrawn = key;
    const phase = m.phase === 'live' ? `${clock(left)} left` : m.phase === 'intermission' ? `Next match in ${clock(left)}` : 'Match over';
    const weather = this.ctx.state.hud ? this.ctx.state.hud.weather : '';
    setText(this.sub, `Round ${m.round} · first to ${m.killTarget} · ${phase}${weather ? ` · ${weather.charAt(0).toUpperCase()}${weather.slice(1)}` : ''}`);
  }

  private paint(): void {
    if (!this.dirty) { this.tick(); return; }
    this.dirty = false;
    const st = this.ctx.state;
    const roster = st.roster.filter((r) => !r.dummy).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.dmg - a.dmg);
    let sig = `${st.localId}|${st.touch}|${st.room ? st.room.code : ''}`;
    for (const r of roster) sig += `|${r.id},${r.name},${r.el},${r.kills},${r.deaths},${Math.round(r.dmg)},${r.streak},${Math.round(r.ping / 5)},${r.hall ? 1 : 0}`;
    this.clockDrawn = '';
    if (sig === this.sig) { this.tick(); return; }
    this.sig = sig;
    setText(this.title, st.room ? (st.room.isPrivate ? `Private room ${st.room.code}` : `Hall ${st.room.code}`) : 'Scoreboard');
    this.tick();
    this.rows.textContent = '';
    roster.forEach((r, i) => this.rows.appendChild(scoreRow(r, i + 1, r.id === st.localId)));
    const humans = roster.filter((r) => !r.bot).length;
    this.foot.textContent = '';
    this.foot.append(
      h('span', null, `${humans} ${humans === 1 ? 'warrior' : 'warriors'}${roster.length - humans ? ` · ${roster.length - humans} bots` : ''}`),
      st.touch ? h('span', { text: 'Tap Scores again to close' }) : h('span', null, 'Release ', actionKeycap('scoreboard', 'dark'), ' to close'));
  }
}

function scoreRow(r: RosterEntry, rank: number, you: boolean): HTMLElement {
  const el = elOf(r.el);
  const tr = h('tr', { class: `${you ? 'you' : ''} ${r.hall ? 'away' : ''}` },
    h('td.c-rank.t-num', null, rank === 1 && r.kills > 0 ? icon('crown') : String(rank)),
    h('th.c-name', { attrs: { scope: 'row' } },
      h('span.c-name-in', null, medal(el, 'tiny'), h('span.c-name-text', { text: r.name }),
        r.bot ? h('span.bot-tag', { text: 'Bot' }) : null,
        you ? h('span.you-tag', { text: 'You' }) : null,
        r.hall ? h('span.hall-tag', { text: 'In the hall' }) : null)),
    h('td.t-num.c-k', { text: String(r.kills) }),
    h('td.t-num', { text: String(r.deaths) }),
    h('td.t-num', { text: num(r.dmg) }),
    h('td.t-num', null, r.streak >= 2 ? h('span.c-streak', null, icon('flame'), String(r.streak)) : '—'),
    h('td.t-num.c-ping', { text: r.bot ? '—' : `${Math.round(r.ping)}`, class: r.bot ? '' : r.ping < 70 ? 'good' : r.ping < 140 ? 'ok' : 'poor' }));
  tint(tr, el);
  return tr;
}

// ================================================================================== results
export class Results {
  readonly el: HTMLElement;
  private inner: HTMLElement;
  private countdown: HTMLElement | null = null;
  private until = 0;
  private timer = 0;
  private shown = false;

  constructor(private ctx: Ctx) {
    this.inner = h('div.results-in');
    this.el = h('section.results.v-click', { hidden: true, role: 'dialog', attrs: { 'aria-modal': 'true', 'aria-label': 'Match results' } }, this.inner);
  }

  get isOpen(): boolean { return this.shown; }

  set(r: MatchResults | null): void {
    window.clearInterval(this.timer);
    this.shown = !!r;
    show(this.el, !!r);
    if (!r) { this.ctx.refreshBlocking(); return; }
    const ctx = this.ctx;
    const localId = ctx.state.localId;
    const top = r.standings.slice(0, 3);
    const order = [1, 0, 2].filter((i) => top[i]); // 2nd · 1st · 3rd
    const podium = h('div.podium', null, ...order.map((i) => {
      const s = top[i];
      const el = elOf(s.el);
      const col = h('div.pod', { class: `p${i + 1} ${s.id === localId ? 'you' : ''}`, style: { '--d': `${[0.25, 0.05, 0.4][i]}s` } },
        i === 0 ? h('span.pod-crown', { html: uiIcon('crown') }) : null,
        medal(el),
        h('div.pod-name', null, s.name, s.bot ? h('span.bot-tag', { text: 'Bot' }) : null),
        h('div.pod-el', { text: ELEMENTS[el].name }),
        h('div.pod-block', null, h('b.t-num', { text: String(i + 1) }), h('span.t-num', { text: `${s.kills} ${s.kills === 1 ? 'kill' : 'kills'}` })));
      tint(col, el);
      return col;
    }));

    const table = h('table.score-table.res-table', null,
      h('thead', null, h('tr', null, h('th.c-rank', { text: '#', attrs: { scope: 'col' } }), h('th.c-name', { text: 'Warrior', attrs: { scope: 'col' } }), h('th', { text: 'K', attrs: { scope: 'col', title: 'Kills' } }), h('th', { text: 'D', attrs: { scope: 'col', title: 'Deaths' } }), h('th', { text: 'Damage', attrs: { scope: 'col' } }))),
      h('tbody', null, ...r.standings.map((s, i) => {
        const tr = h('tr', { class: s.id === localId ? 'you' : '' },
          h('td.c-rank.t-num', { text: String(i + 1) }),
          h('th.c-name', { attrs: { scope: 'row' } }, h('span.c-name-in', null, medal(elOf(s.el), 'tiny'), h('span.c-name-text', { text: s.name }), s.bot ? h('span.bot-tag', { text: 'Bot' }) : null, s.id === localId ? h('span.you-tag', { text: 'You' }) : null)),
          h('td.t-num.c-k', { text: String(s.kills) }), h('td.t-num', { text: String(s.deaths) }), h('td.t-num', { text: num(s.dmg) }));
        tint(tr, elOf(s.el));
        return tr;
      })));

    const you = r.you;
    let side: HTMLElement;
    if (you) {
      const base = Math.max(0, you.glory - you.bonus);
      const line = (label: string, value: string, cls = ''): HTMLElement => h('div.gl-row', { class: cls }, h('span', { text: label }), h('b.t-num', { text: value }));
      const verdict = you.place === 1 ? 'The day is yours.' : you.place <= 3 ? 'A place on the podium.' : you.kills > 0 ? 'Blood was drawn. Next time, more.' : 'The arena will remember you eventually.';
      side = h('aside.res-you.panel', null,
        h('div.t-eyebrow', { text: 'Your match' }),
        h('div.res-place', null, h('b', { text: ordinal(you.place) }), h('span', { text: verdict })),
        h('div.res-stats', null,
          h('div', null, h('b.t-num', { text: String(you.kills) }), h('span', { text: 'Kills' })),
          h('div', null, h('b.t-num', { text: String(you.deaths) }), h('span', { text: 'Deaths' })),
          h('div', null, h('b.t-num', { text: num(you.dmg) }), h('span', { text: 'Damage' })),
          h('div', null, h('b.t-num', { text: String(you.bestStreak) }), h('span', { text: 'Best streak' }))),
        h('div.gl', null,
          line('Damage, kills & ring-outs', `+${num(base)}`),
          line(you.place <= 3 ? `Placement — ${ordinal(you.place)}` : 'Match fought', `+${num(you.bonus)}`),
          h('div.gl-total', null, h('span', { text: 'Glory earned' }), h('span.glory', null, icon('glory'), `+${num(you.glory)}`))));
    } else {
      side = h('aside.res-you.panel', null,
        h('div.t-eyebrow', { text: 'Your match' }),
        h('p.t-dim', { text: 'You watched this one from the hall. The next horn is yours.' }));
    }

    this.countdown = h('b.t-num');
    const cont = button(ctx, { label: 'Continue', class: 'btn primary', onClick: () => { this.set(null); } });
    this.inner.textContent = '';
    this.inner.append(
      h('header.res-head', null, h('div.t-eyebrow', { text: `Round ${r.round}` }), h('h2', { text: top[0] ? `${top[0].name} takes the day` : 'Match over' }), h('div.rule', null, h('i'))),
      h('div.res-grid', null,
        h('div.res-main', null, podium, h('div.res-standings.panel.plain.scroll', null, table)),
        side),
      h('footer.res-foot', null, h('span.res-count', null, 'Back to the hall in ', this.countdown), cont));

    const m = ctx.state.match;
    this.until = performance.now() + (m && m.phase === 'results' ? m.timeLeft : 11) * 1000;
    const paint = (): void => { if (this.countdown) setText(this.countdown, String(Math.max(0, Math.ceil((this.until - performance.now()) / 1000)))); };
    paint();
    this.timer = window.setInterval(paint, 250);
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
    ctx.refreshBlocking();
    cont.focus({ preventScroll: true });
  }

  /** The server's clock for the results phase arrived or changed. */
  syncClock(): void {
    const m = this.ctx.state.match;
    if (this.shown && m && m.phase === 'results') this.until = performance.now() + m.timeLeft * 1000;
  }
}

// ================================================================================== pause menu
export class PauseMenu {
  private handle: ModalHandle | null = null;

  constructor(private ctx: Ctx) {
    ctx.on('screen', () => { if (ctx.state.screen !== 'game') this.close(); });
  }

  get isOpen(): boolean { return !!this.handle; }

  toggle(open?: boolean): void {
    const want = open === undefined ? !this.handle : open;
    if (want) this.open(); else this.close();
  }

  close(): void { if (this.handle) this.ctx.modals.close('menu'); }

  private open(): void {
    if (this.handle) return;
    const ctx = this.ctx;
    const st = ctx.state;
    const inArena = !!st.hud && st.hud.zone === 'arena';
    const resume = button(ctx, { label: 'Resume', icon: 'play', class: 'btn primary block', sound: null, onClick: () => this.close() });
    const leaveWrap = h('div.menu-leave');
    const paintLeave = (confirm: boolean): void => {
      leaveWrap.textContent = '';
      if (!confirm) {
        leaveWrap.append(button(ctx, { label: 'Leave room', icon: 'exit', class: 'btn block danger', onClick: () => { paintLeave(true); (leaveWrap.querySelector('.btn') as HTMLElement | null)?.focus(); } }));
        return;
      }
      leaveWrap.append(
        h('p.menu-confirm', { text: 'Leave this room? Your glory is already banked.' }),
        h('div.menu-confirm-row', null,
          button(ctx, { label: 'Stay', class: 'btn', sound: 'back', onClick: () => { paintLeave(false); (leaveWrap.querySelector('.btn') as HTMLElement | null)?.focus(); } }),
          button(ctx, { label: 'Leave', class: 'btn danger', onClick: () => { this.close(); ctx.actions.leaveRoom(); } })));
    };
    paintLeave(false);

    const room = st.room;
    const roomBox = room ? h('div.menu-room', null,
      h('div.menu-room-id', null, h('span.t-label', { text: room.isPrivate ? 'Private room' : 'Public hall' }), h('b.menu-code', { text: room.code }),
        h('span.t-faint', { text: `${room.humans}/${room.capacity} warriors${room.bots ? ' · bots fill the rest' : ''}` })),
      h('div.menu-room-btns', null,
        button(ctx, { label: 'Copy code', icon: 'copy', class: 'btn small', onClick: async () => { const ok = await copyText(room.code); ctx.toast(ok ? `Code ${room.code} copied.` : `Room code: ${room.code}`, ok ? 'good' : 'info'); } }),
        button(ctx, { label: 'Copy invite link', icon: 'link', class: 'btn small', onClick: async () => { const ok = await copyText(ctx.inviteLink(room.code)); ctx.toast(ok ? 'Invite link copied. Send it to someone you want to fight.' : ctx.inviteLink(room.code), ok ? 'good' : 'info'); } }))) : null;

    const body = h('div.modal-body.menu', null,
      resume,
      inArena ? button(ctx, { label: 'Return to the hall', icon: 'door', class: 'btn block', onClick: () => { this.close(); ctx.actions.returnToHall(); } }) : null,
      button(ctx, { label: 'Settings', icon: 'gear', class: 'btn block', onClick: () => ctx.openSettings() }),
      button(ctx, { label: 'How to play', icon: 'help', class: 'btn block', onClick: () => ctx.openHowTo() }),
      leaveWrap,
      roomBox);
    this.handle = ctx.modals.open({ id: 'menu', title: 'Menu', width: '23rem', class: 'menu-modal', body, focus: resume, onClose: () => { this.handle = null; } });
  }
}
