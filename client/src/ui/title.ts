// Loading screen, title screen and the private-room dialog.

import { NAME_MAX } from '@shared/types';
import { ELEMENTS, ELEMENT_ORDER } from '@shared/elements';
import { h, setText, show, num, duration, clamp01 } from './dom';
import { sigil } from './icons';
import { button, icon, medal, switchControl, tabStrip, tint, type Ctx, type ModalHandle } from './core';
import { CONNECTION_LABEL, LOADING_LINES } from './copy';

type PlayMode = { type: 'public' } | { type: 'create'; bots: boolean } | { type: 'join'; code: string };

/** Normalise a display name the way the server will. */
export function cleanName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}
export function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function wordmark(size: 'big' | 'small' = 'big'): HTMLElement {
  return h('div.wordmark', { class: size, attrs: { role: 'img', 'aria-label': 'Vindheim — Clash of Elements' } },
    h('div.wordmark-name', { attrs: { 'aria-hidden': 'true' } }, ...'VINDHEIM'.split('').map((c, i) => h('span', { text: c, style: { '--i': String(i) } }))),
    h('div.wordmark-sub', { attrs: { 'aria-hidden': 'true' } }, h('i'), h('span', { text: 'Clash of Elements' }), h('i')));
}

// ================================================================================== loading
export class LoadingScreen {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private label: HTMLElement;
  private pct: HTMLElement;
  private tip: HTMLElement;
  private tipIndex = Math.floor(Math.random() * LOADING_LINES.length);
  private timer = 0;
  private barWrap: HTMLElement;

  constructor(private ctx: Ctx) {
    this.bar = h('div.load-fill');
    this.label = h('span.load-label', { text: 'Waking the hall' });
    this.pct = h('span.load-pct.t-num', { text: '0%' });
    this.tip = h('p.load-tip', { text: LOADING_LINES[this.tipIndex] });
    this.barWrap = h('div.load-bar', { role: 'progressbar', attrs: { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Loading' } }, this.bar);
    this.el = h('div.v-layer.v-loading', { attrs: { 'aria-busy': 'true' } },
      h('div.load-sigil', { html: sigil() }),
      h('div.load-center', null,
        wordmark('big'),
        this.barWrap,
        h('div.load-row', null, this.label, this.pct),
      ),
      h('div.load-foot', null, h('div.rule', null, h('i')), this.tip));
  }

  set(progress: number, label: string): void {
    const p = clamp01(progress);
    this.bar.style.transform = `scaleX(${p.toFixed(4)})`;
    setText(this.pct, `${Math.round(p * 100)}%`);
    if (label) setText(this.label, label);
    this.barWrap.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  setActive(on: boolean): void {
    window.clearInterval(this.timer);
    if (!on) return;
    this.timer = window.setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % LOADING_LINES.length;
      this.tip.classList.add('swap');
      window.setTimeout(() => { this.tip.textContent = LOADING_LINES[this.tipIndex]; this.tip.classList.remove('swap'); }, 260);
    }, 4600);
  }
}

// ================================================================================== title
export class TitleScreen {
  readonly el: HTMLElement;
  private nameInput: HTMLInputElement;
  private nameCount: HTMLElement;
  private nameNote: HTMLElement;
  private playBtn: HTMLButtonElement;
  private playSub: HTMLElement;
  private altBtn: HTMLButtonElement;
  private privateBtn: HTMLButtonElement;
  private conn: HTMLElement;
  private connText: HTMLElement;
  private card: HTMLElement;
  private dirty = false;
  private busyTimer = 0;
  private invite: string;
  private dialog: ModalHandle | null = null;
  private dialogBusy: HTMLButtonElement | null = null;

  constructor(private ctx: Ctx) {
    this.invite = cleanCode(new URLSearchParams(location.search).get('room') || '');

    this.nameInput = h('input.input', { type: 'text', id: 'v-name', attrs: { maxlength: NAME_MAX, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'Name your warrior', 'aria-describedby': 'v-name-note' } });
    this.nameCount = h('span.name-count.t-num', { text: `0/${NAME_MAX}` });
    this.nameNote = h('span.name-note', { id: 'v-name-note', text: 'The name others will curse.' });
    this.nameInput.addEventListener('input', () => { this.dirty = true; this.paintName(); });
    this.nameInput.addEventListener('blur', () => this.commitName(false));
    this.nameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); this.play(this.invite ? { type: 'join', code: this.invite } : { type: 'public' }, this.playBtn); }
    });

    this.playSub = h('span.play-sub');
    this.playBtn = button(ctx, { label: 'Play', class: 'btn primary big play-btn', sound: 'deploy', onClick: () => this.play(this.invite ? { type: 'join', code: this.invite } : { type: 'public' }, this.playBtn) });
    this.altBtn = button(ctx, { label: 'Quick match instead', class: 'btn quiet small', onClick: () => this.play({ type: 'public' }, this.altBtn) });
    this.privateBtn = button(ctx, { label: 'Private room', icon: 'users', class: 'btn', onClick: () => this.openPrivate(this.invite ? 'join' : 'create') });
    const howBtn = button(ctx, { label: 'How to play', icon: 'help', class: 'btn', onClick: () => ctx.openHowTo() });
    const setBtn = button(ctx, { label: 'Settings', icon: 'gear', class: 'btn', onClick: () => ctx.openSettings() });

    this.connText = h('span', { text: '' });
    this.conn = h('div.conn', { role: 'status', hidden: true }, h('i.conn-dot'), this.connText);
    this.card = h('aside.title-card.panel', { attrs: { 'aria-label': 'Your saga' } });

    this.el = h('div.v-layer.v-title', { hidden: true },
      h('div.title-shade'),
      h('main.title-main.v-click', null,
        wordmark('big'),
        h('div.title-form', null,
          h('label.t-label', { text: 'Fight as', attrs: { for: 'v-name' } }),
          h('div.name-row', null, this.nameInput, this.nameCount),
          this.nameNote,
          h('div.play-row', null, this.playBtn, this.playSub),
          this.altBtn,
          h('div.title-actions', null, this.privateBtn, howBtn, setBtn),
        ),
      ),
      h('div.title-side.v-click', null, this.card),
      h('footer.title-foot', null, this.conn, h('span.title-legal', { text: 'Eight elements. No blocking. One very long drop.' })),
    );

    ctx.on('profile', () => this.paintProfile());
    ctx.on('conn', () => this.paintConn());
    ctx.on('screen', () => { if (ctx.state.screen !== 'title') this.clearBusy(); else this.paintProfile(); });
    this.paintInvite();
    this.paintProfile();
    this.paintName();
  }

  setActive(on: boolean): void {
    show(this.el, on);
    if (on) {
      this.clearBusy();
      const firstRun = !this.ctx.state.profile || !this.ctx.state.profile.stats.matches;
      if (!this.ctx.state.touch && firstRun && !this.nameInput.value) this.nameInput.focus({ preventScroll: true });
    } else if (this.dialog) { this.ctx.modals.close('private', true); }
  }

  private paintInvite(): void {
    const inv = this.invite;
    setButtonText(this.playBtn, inv ? `Join ${inv}` : 'Play');
    this.playSub.textContent = inv ? 'You were invited to a private hall' : 'Quick match · public hall';
    show(this.altBtn, !!inv);
  }

  private paintName(): void {
    const v = this.nameInput.value;
    setText(this.nameCount, `${cleanName(v).length}/${NAME_MAX}`);
    this.nameInput.classList.remove('invalid');
    this.nameNote.classList.remove('bad');
    setText(this.nameNote, 'The name others will curse.');
  }

  /** Push the name to the game if it changed. Returns false when it is not usable. */
  private commitName(strict: boolean): boolean {
    const name = cleanName(this.nameInput.value);
    if (name.length < 2) {
      if (strict) {
        this.nameInput.classList.add('invalid');
        this.nameNote.classList.add('bad');
        setText(this.nameNote, name.length ? 'A name needs at least two characters.' : 'Every warrior needs a name.');
        this.nameInput.focus();
        this.ctx.sound('denied');
      }
      return false;
    }
    if (this.nameInput.value !== name) this.nameInput.value = name;
    if (this.dirty || !this.ctx.state.profile || this.ctx.state.profile.name !== name) {
      this.ctx.actions.setName(name);
      this.dirty = false;
    }
    return true;
  }

  private play(mode: PlayMode, source: HTMLButtonElement | null): void {
    if (!this.commitName(true)) { if (this.dialog) this.ctx.modals.close('private', true); return; }
    this.clearBusy();
    this.ctx.actions.play(mode);
    const b = source || this.playBtn;
    b.classList.add('busy');
    this.dialogBusy = b;
    for (const x of [this.playBtn, this.altBtn, this.privateBtn]) if (x !== b) x.disabled = true;
    this.busyTimer = window.setTimeout(() => {
      if (this.ctx.state.screen !== 'title') return;
      this.clearBusy();
      this.ctx.toast('The hall did not answer. Try again.', 'bad');
    }, 12000);
  }

  private clearBusy(): void {
    window.clearTimeout(this.busyTimer);
    this.dialogBusy?.classList.remove('busy');
    this.dialogBusy = null;
    for (const x of [this.playBtn, this.altBtn, this.privateBtn]) { x.classList.remove('busy'); x.disabled = false; }
  }

  private paintConn(): void {
    const s = this.ctx.state.conn;
    show(this.conn, !!s);
    if (!s) return;
    this.conn.dataset.state = s;
    const detail = this.ctx.state.connDetail;
    setText(this.connText, detail ? `${CONNECTION_LABEL[s]} · ${detail}` : CONNECTION_LABEL[s]);
    if (s === 'offline') this.clearBusy();
  }

  private paintProfile(): void {
    const p = this.ctx.state.profile;
    if (p && !this.dirty && (document.activeElement !== this.nameInput || !this.nameInput.value) && this.nameInput.value !== p.name) {
      this.nameInput.value = p.name;
      this.paintName();
    }
    const card = this.card;
    card.textContent = '';
    if (!p) {
      card.append(h('div.card-empty', null, h('div.t-eyebrow', { text: 'Your saga' }), h('p.t-dim', { text: 'No deeds yet. The hearth is lit and the Skygate is open.' })));
      return;
    }
    tint(card, p.equipped);
    const st = p.stats;
    const kd = st.deaths ? (st.kills / st.deaths).toFixed(2) : st.kills ? `${st.kills}.00` : '—';
    const owned = new Set(p.owned);
    const nextId = ELEMENT_ORDER.find((e) => !owned.has(e));
    const next = nextId ? ELEMENTS[nextId] : null;
    const stat = (label: string, value: string): HTMLElement => h('div.stat', null, h('dd.t-num', { text: value }), h('dt', { text: label }));

    card.append(
      h('header.card-head', null,
        medal(p.equipped),
        h('div.card-id', null, h('div.card-name', { text: p.name || 'Unnamed' }), h('div.card-el', { text: `${ELEMENTS[p.equipped].name} · ${ELEMENTS[p.equipped].title}` })),
        h('div.card-glory', { attrs: { 'aria-label': `${num(p.glory)} glory` } }, h('span.glory', null, icon('glory'), num(p.glory)), h('span.t-label', { text: 'Glory' })),
      ),
      h('dl.card-stats', null,
        stat('Matches', num(st.matches)), stat('Wins', num(st.wins)), stat('Kills', num(st.kills)),
        stat('K / D', kd), stat('Ring-outs', num(st.ringouts)), stat('Best streak', num(st.bestStreak)),
      ),
      h('div.card-ladder', { attrs: { role: 'img', 'aria-label': `${p.owned.length} of ${ELEMENT_ORDER.length} elements unlocked` } },
        ...ELEMENT_ORDER.map((id) => {
          const m = medal(id, 'small');
          m.classList.add(owned.has(id) ? 'owned' : id === nextId ? 'next' : 'locked');
          if (id === p.equipped) m.classList.add('equipped');
          return m;
        })),
      next
        ? h('div.card-next', null,
          h('div.card-next-row', null, h('span', { text: `Next: ${next.name}` }), p.glory >= next.cost ? h('span.t-gold', { text: 'Ready to unlock' }) : h('span.t-num', { text: `${num(p.glory)} / ${num(next.cost)}` })),
          h('div.meter', null, h('i', { style: { transform: `scaleX(${clamp01(p.glory / Math.max(1, next.cost)).toFixed(3)})` } })))
        : h('div.card-next', null, h('div.card-next-row', null, h('span', { text: 'Every element is yours.' }), h('span.t-faint', { text: st.playSeconds ? `${duration(st.playSeconds)} in the arena` : '' }))),
    );
  }

  // ------------------------------------------------------------------ private room dialog
  openPrivate(tab: 'create' | 'join' = 'create'): void {
    const ctx = this.ctx;
    let bots = true;
    const botSwitch = switchControl(ctx, 'Fill with bots', () => bots, (v) => { bots = v; });
    const createBtn = button(ctx, { label: 'Create room', class: 'btn primary block', sound: 'deploy', onClick: () => this.play({ type: 'create', bots }, createBtn) });
    const createPane = h('div.pr-pane', { role: 'tabpanel' },
      h('p.t-dim', { text: 'A hall of your own. You get a code — whoever has it can walk in.' }),
      h('div.opt-row', null,
        h('div.opt-text', null, h('div.opt-title', { text: 'Fill with bots' }), h('div.opt-desc', { text: 'Empty seats are taken by bots, so the arena is never quiet.' })),
        botSwitch.el),
      createBtn);

    const code = h('input.input.code', { type: 'text', attrs: { maxlength: 8, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'CODE', 'aria-label': 'Room code', enterkeyhint: 'go' } });
    code.value = this.invite;
    const note = h('p.pr-note.t-faint', { text: 'Ask your host for the code on their screen.' });
    const joinBtn = button(ctx, { label: 'Join room', class: 'btn primary block', sound: 'deploy', onClick: () => join() });
    const join = (): void => {
      const c = cleanCode(code.value);
      if (c.length < 3) {
        code.classList.add('invalid'); note.textContent = 'That code is too short. Check it and try again.'; note.classList.add('bad');
        code.focus(); ctx.sound('denied');
        return;
      }
      this.play({ type: 'join', code: c }, joinBtn);
    };
    code.addEventListener('input', () => { code.value = cleanCode(code.value); code.classList.remove('invalid'); note.classList.remove('bad'); note.textContent = 'Ask your host for the code on their screen.'; });
    code.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); join(); } });
    const joinPane = h('div.pr-pane', { role: 'tabpanel', hidden: true },
      h('p.t-dim', { text: 'Enter the code of a friend\'s hall.' }),
      code, note, joinBtn);

    const tabs = tabStrip(ctx, 'Private room', [{ id: 'create', label: 'Create', icon: 'door' }, { id: 'join', label: 'Join', icon: 'link' }], (id) => {
      show(createPane, id === 'create'); show(joinPane, id === 'join');
      if (id === 'join' && this.dialog) code.focus();
    });
    const body = h('div.modal-body.pr-dialog', null, tabs.el, createPane, joinPane);
    this.dialog = ctx.modals.open({ id: 'private', title: 'Private room', width: '27rem', body, focus: null, onClose: () => { this.dialog = null; } });
    tabs.select(tab);
    (tab === 'join' ? code : createBtn).focus();
  }
}

function setButtonText(b: HTMLElement, text: string): void {
  const l = b.querySelector('.btn-label');
  if (l) setText(l as HTMLElement, text);
}
