// The pedestal gallery: a side panel (bottom sheet on phones) that leaves the 3D pedestal in
// view. An unlock ladder across the top, the selected element's story and kit, and exactly one
// honest call to action.

import type { Profile } from '@shared/types';
import { ELEMENTS, ELEMENT_ORDER, type ElementId, type ElementDef } from '@shared/elements';
import { h, setText, show, num, clamp01 } from './dom';
import { abilityIcon, runeGlyph } from './icons';
import { keycap, primaryBind, SLOT_ACTION, SLOT_NAME } from './keys';
import { button, icon, iconButton, medal, tint, wireSound, type Ctx } from './core';
import { DIFFICULTY_LABEL } from './copy';

export type OwnState = 'equipped' | 'owned' | 'next' | 'locked';

export function ownState(p: Profile | null, id: ElementId): OwnState {
  if (!p) return id === ELEMENT_ORDER[0] ? 'equipped' : id === ELEMENT_ORDER[1] ? 'next' : 'locked';
  if (p.equipped === id) return 'equipped';
  if (p.owned.includes(id)) return 'owned';
  const next = ELEMENT_ORDER.find((e) => !p.owned.includes(e));
  return next === id ? 'next' : 'locked';
}

const STATE_LABEL: Record<OwnState, string> = { equipped: 'Equipped', owned: 'Owned', next: 'Next to unlock', locked: 'Locked' };

export class Pedestal {
  readonly el: HTMLElement;
  current: ElementId | null = null;
  private rail: HTMLElement;
  private railBtns = new Map<ElementId, HTMLButtonElement>();
  private body: HTMLElement;
  private rune: HTMLElement;
  private nameEl: HTMLElement;
  private titleEl: HTMLElement;
  private stateEl: HTMLElement;
  private loreEl: HTMLElement;
  private styleEl: HTMLElement;
  private tagsEl: HTMLElement;
  private pips: HTMLElement;
  private abTabs: HTMLElement;
  private abDetail: HTMLElement;
  private glory: HTMLElement;
  private costRow: HTMLElement;
  private costMeter: HTMLElement;
  private costText: HTMLElement;
  private cta: HTMLButtonElement;
  private ctaNote: HTMLElement;
  private trial: HTMLButtonElement;
  private abilityIndex = 0;
  private ctaAction: (() => void) | null = null;
  private lastOwned = '';
  private swipe: { id: number; x: number; y: number } | null = null;

  constructor(private ctx: Ctx) {
    const prev = iconButton(ctx, 'left', 'Previous element', () => this.step(-1), 'ped-nav');
    const next = iconButton(ctx, 'right', 'Next element', () => this.step(1), 'ped-nav');
    this.rail = h('div.ped-rail', { role: 'tablist', attrs: { 'aria-label': 'Elements, in unlock order' } });
    ELEMENT_ORDER.forEach((id, i) => {
      const b = h('button.ped-step', { type: 'button', role: 'tab', data: { el: id } }, medal(id), h('span.ped-step-badge'), h('span.ped-step-num.t-num', { text: String(i + 1) }));
      tint(b, id);
      wireSound(ctx, b);
      b.addEventListener('click', () => this.select(id));
      this.railBtns.set(id, b);
      this.rail.appendChild(b);
    });

    this.rune = h('div.ped-rune', { attrs: { 'aria-hidden': 'true' } });
    this.nameEl = h('h2.ped-name', { id: 'v-ped-name' });
    this.titleEl = h('div.ped-title');
    this.stateEl = h('span.ped-state');
    this.loreEl = h('p.ped-lore');
    this.styleEl = h('p.ped-style');
    this.tagsEl = h('div.ped-tags');
    this.pips = h('div.ped-diff');
    this.abTabs = h('div.ped-abs', { role: 'tablist', attrs: { 'aria-label': 'Abilities' } });
    this.abDetail = h('div.ped-ab', { role: 'tabpanel', id: 'v-ped-ab' });

    this.glory = h('span.glory');
    this.costMeter = h('i');
    this.costText = h('span.t-num');
    this.costRow = h('div.ped-cost', null, h('div.ped-cost-row', null, h('span.t-label', { text: 'Your glory' }), this.glory, h('span.ped-cost-of'), this.costText), h('div.meter', null, this.costMeter));
    this.cta = button(ctx, { label: '', class: 'btn element block big ped-cta', sound: null, onClick: () => this.pressCta() });
    this.ctaNote = h('p.ped-note', { id: 'v-ped-note' });
    this.cta.setAttribute('aria-describedby', 'v-ped-note');
    this.trial = button(ctx, { label: 'Try it in the sparring ring', icon: 'dummy', class: 'btn small block ped-trial', onClick: () => this.pressTrial() });

    this.body = h('div.ped-body.scroll', null,
      h('div.ped-hero', null, this.rune, h('div.ped-hero-text', null, this.stateEl, this.nameEl, this.titleEl)),
      this.loreEl,
      h('div.ped-meta', null, this.tagsEl, this.pips),
      this.styleEl,
      h('div.ped-kit', null, this.abTabs, this.abDetail));

    this.el = h('aside.pedestal.panel.v-click', { hidden: true, role: 'dialog', attrs: { 'aria-labelledby': 'v-ped-name', 'aria-modal': 'false' } },
      h('div.ped-ladder', null, prev, this.rail, next, h('i.ped-ladder-sep'), iconButton(ctx, 'close', 'Close the gallery', () => this.close(), 'ped-close')),
      this.body,
      h('footer.ped-foot', null, this.costRow, this.cta, this.ctaNote, this.trial));

    this.el.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'mouse') this.swipe = { id: ev.pointerId, x: ev.clientX, y: ev.clientY }; });
    this.el.addEventListener('pointerup', (ev) => {
      const s = this.swipe; this.swipe = null;
      if (!s || s.id !== ev.pointerId) return;
      const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) this.step(dx < 0 ? 1 : -1);
    });
    this.el.addEventListener('pointercancel', () => { this.swipe = null; });

    ctx.on('profile', () => this.onProfile());
    ctx.on('binds', () => { if (this.current) this.paintAbility(); });
    ctx.on('touch', () => { if (this.current) this.paintAbility(); });
    ctx.on('zone', () => { if (this.current && ctx.state.hud && ctx.state.hud.zone !== 'hall') this.close(true); });
  }

  get isOpen(): boolean { return this.current !== null; }

  open(id: ElementId): void {
    const was = this.current;
    if (!ELEMENTS[id]) return;
    if (was === null) {
      show(this.el, true);
      this.el.classList.remove('closing');
      this.ctx.sound('open');
    }
    this.select(id, was !== null);
    if (was === null) {
      this.ctx.root.classList.add('ped-open');
      this.ctx.refreshBlocking();
      this.cta.focus({ preventScroll: true });
    }
  }

  close(silent = false): void {
    if (this.current === null) return;
    this.current = null;
    this.ctx.actions.inspect?.(null);
    show(this.el, false);
    this.ctx.root.classList.remove('ped-open');
    if (!silent) this.ctx.sound('close');
    this.ctx.refreshBlocking();
  }

  step(d: number): void {
    if (!this.current) return;
    const i = ELEMENT_ORDER.indexOf(this.current);
    this.select(ELEMENT_ORDER[(i + d + ELEMENT_ORDER.length) % ELEMENT_ORDER.length], true, d);
  }

  /** Arrow keys browse; number keys pick an ability. Returns true if consumed. */
  handleKey(ev: KeyboardEvent): boolean {
    if (!this.current) return false;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return false;
    if (ev.key === 'ArrowLeft') { this.step(-1); this.ctx.sound('click'); return true; }
    if (ev.key === 'ArrowRight') { this.step(1); this.ctx.sound('click'); return true; }
    if (ev.key >= '1' && ev.key <= '5') { this.abilityIndex = Number(ev.key) - 1; this.paintAbilities(); this.ctx.sound('hover'); return true; }
    if (ev.key === 'Escape') { this.close(); return true; }
    if (ev.key === 'Tab') {
      // keep focus inside the panel while it is open
      const f = Array.from(this.el.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])')).filter((e) => e.offsetParent !== null);
      if (!f.length) return false;
      const a = document.activeElement as HTMLElement | null;
      if (!a || !this.el.contains(a)) { ev.preventDefault(); f[0].focus(); }
      else if (ev.shiftKey && a === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && a === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
      return true;
    }
    return false;
  }

  private select(id: ElementId, animate = false, dir = 0): void {
    const changed = this.current !== id;
    this.current = id;
    if (changed) this.ctx.actions.inspect?.(id);
    if (changed) this.abilityIndex = 0;
    this.paint();
    if (animate && changed) {
      this.body.classList.remove('swap-l', 'swap-r');
      void this.body.offsetWidth;
      this.body.classList.add(dir < 0 ? 'swap-l' : 'swap-r');
      this.body.scrollTop = 0;
    }
  }

  private onProfile(): void {
    const p = this.ctx.state.profile;
    const owned = p ? p.owned.join(',') : '';
    if (this.current && p && this.lastOwned && owned !== this.lastOwned && p.owned.includes(this.current) && !this.lastOwned.split(',').includes(this.current)) {
      this.el.classList.remove('celebrate'); void this.el.offsetWidth; this.el.classList.add('celebrate');
      this.ctx.toast(`${ELEMENTS[this.current].name} unlocked. Take it up when you are ready.`, 'good');
    }
    this.lastOwned = owned;
    if (this.current) this.paint();
  }

  // ---------------------------------------------------------------------------- painting
  private paint(): void {
    const id = this.current;
    if (!id) return;
    const def = ELEMENTS[id];
    const p = this.ctx.state.profile;
    if (p && !this.lastOwned) this.lastOwned = p.owned.join(',');
    const state = ownState(p, id);
    tint(this.el, id);
    this.el.dataset.state = state;

    for (const [eid, b] of this.railBtns) {
      const s = ownState(p, eid);
      b.dataset.state = s;
      const on = eid === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.setAttribute('aria-label', `${ELEMENTS[eid].name} — ${STATE_LABEL[s]}${s === 'next' || s === 'locked' ? `, ${num(ELEMENTS[eid].cost)} glory` : ''}`);
      const badge = b.querySelector('.ped-step-badge') as HTMLElement;
      const want = s === 'equipped' ? 'check' : s === 'locked' ? 'lock' : s === 'next' ? 'glory' : '';
      if (badge.dataset.i !== want) { badge.dataset.i = want; badge.textContent = ''; if (want) badge.appendChild(icon(want)); }
    }

    this.rune.innerHTML = runeGlyph(id);
    setText(this.nameEl, def.name);
    setText(this.titleEl, def.title);
    this.stateEl.textContent = '';
    this.stateEl.append(icon(state === 'equipped' ? 'check' : state === 'owned' ? 'star' : state === 'next' ? 'glory' : 'lock'),
      state === 'next' || state === 'locked' ? `${STATE_LABEL[state]} · ${num(def.cost)} glory` : STATE_LABEL[state]);
    setText(this.loreEl, def.lore);
    setText(this.styleEl, def.style);
    this.tagsEl.textContent = '';
    for (const t of def.tags) this.tagsEl.appendChild(h('span.tag', { text: t }));
    this.pips.textContent = '';
    this.pips.setAttribute('aria-label', `Difficulty: ${DIFFICULTY_LABEL[def.difficulty]}`);
    this.pips.append(...[1, 2, 3].map((n) => h('i', { class: n <= def.difficulty ? 'on' : '' })), h('span.ped-diff-name', { text: DIFFICULTY_LABEL[def.difficulty] }));

    this.paintAbilities();
    this.paintCta(def, state);
  }

  private paintAbilities(): void {
    const id = this.current;
    if (!id) return;
    const def = ELEMENTS[id];
    this.abTabs.textContent = '';
    def.abilities.forEach((a, i) => {
      const b = h('button.ped-abtab', { type: 'button', role: 'tab', attrs: { 'aria-selected': String(i === this.abilityIndex), 'aria-controls': 'v-ped-ab', 'aria-label': `${SLOT_NAME[a.slot]}: ${a.name}` }, tabindex: i === this.abilityIndex ? 0 : -1 },
        h('span.tile', { html: abilityIcon(a.key) }), h('span.ped-abtab-slot', { text: a.slot === 0 ? 'Melee' : a.slot === 4 ? 'Move' : String(a.slot) }));
      wireSound(this.ctx, b);
      const pick = (): void => { if (this.abilityIndex === i) return; this.abilityIndex = i; this.paintAbilities(); (this.abTabs.children[i] as HTMLElement).focus(); };
      b.addEventListener('click', pick);
      b.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse' && this.abilityIndex !== i) { this.abilityIndex = i; for (const [j, c] of Array.from(this.abTabs.children).entries()) c.setAttribute('aria-selected', String(j === i)); this.paintAbility(); } });
      this.abTabs.appendChild(b);
    });
    this.paintAbility();
  }

  private paintAbility(): void {
    const id = this.current;
    if (!id) return;
    const a = ELEMENTS[id].abilities[this.abilityIndex] || ELEMENTS[id].abilities[0];
    const touch = this.ctx.state.touch;
    const cd = a.cooldown >= 10 ? `${Math.round(a.cooldown)}s` : `${a.cooldown.toFixed(1).replace(/\.0$/, '')}s`;
    this.abDetail.textContent = '';
    this.abDetail.append(
      h('div.ped-ab-head', null,
        h('h3', { text: a.name }),
        touch ? null : keycap(primaryBind(SLOT_ACTION[a.slot]), 'dark')),
      h('div.ped-ab-meta', null,
        h('span', { text: SLOT_NAME[a.slot] }), h('i'),
        h('span', null, icon('timer'), `${cd} cooldown`), h('i'),
        h('span', { text: a.air ? 'Works in the air' : 'Ground only' })),
      h('p.ped-ab-desc', { text: a.desc }),
      h('p.ped-ab-tip', null, h('b', { text: 'Tip' }), a.tip));
  }

  private paintCta(def: ElementDef, state: OwnState): void {
    const p = this.ctx.state.profile;
    const hud = this.ctx.state.hud;
    const glory = p ? p.glory : 0;
    const trialing = !!hud && hud.trial && hud.element === def.id;
    const set = (label: string, note: string, enabled: boolean, action: (() => void) | null, variant: 'element' | 'primary' | 'idle'): void => {
      setText(this.cta.querySelector('.btn-label') as HTMLElement, label);
      setText(this.ctaNote, note);
      this.cta.setAttribute('aria-disabled', String(!enabled));
      this.cta.classList.toggle('is-off', !enabled);
      this.cta.classList.toggle('element', variant === 'element');
      this.cta.classList.toggle('primary', variant === 'primary');
      this.ctaAction = action;
    };
    this.glory.textContent = '';
    this.glory.append(icon('glory'), num(glory));
    const showCost = state === 'next' || state === 'locked';
    show(this.costRow.querySelector('.meter') as HTMLElement, showCost);
    setText(this.costRow.querySelector('.ped-cost-of') as HTMLElement, showCost ? 'Cost' : '');
    setText(this.costText, showCost ? num(def.cost) : '');
    this.costMeter.style.transform = `scaleX(${clamp01(glory / Math.max(1, def.cost)).toFixed(3)})`;

    if (state === 'equipped') {
      set('Equipped', `${def.name} goes with you through the Skygate.`, false, null, 'idle');
    } else if (state === 'owned') {
      set(`Equip ${def.name}`, 'Yours. Take it up and it deploys with you.', true, () => {
        this.ctx.sound('equip');
        this.ctx.actions.equip(def.id);
      }, 'element');
    } else if (state === 'next') {
      if (glory >= def.cost) {
        set(`Unlock · ${num(def.cost)} glory`, `Leaves you with ${num(glory - def.cost)} glory. It is yours forever.`, true, () => {
          this.ctx.sound('unlock');
          this.ctx.actions.unlock(def.id);
        }, 'primary');
      } else {
        set(`Need ${num(def.cost - glory)} more glory`, 'Damage, kills and ring-outs all pay. So does the podium.', false, null, 'idle');
      }
    } else {
      const p2 = this.ctx.state.profile;
      const nextId = ELEMENT_ORDER.find((e) => !(p2 ? p2.owned : [ELEMENT_ORDER[0]]).includes(e)) || ELEMENT_ORDER[0];
      set(`Unlock ${ELEMENTS[nextId].name} first`, 'The elements open in order. One pedestal at a time.', false, null, 'idle');
    }
    const owned = state === 'equipped' || state === 'owned';
    show(this.trial, !owned);
    const tl = this.trial.querySelector('.btn-label') as HTMLElement;
    setText(tl, trialing ? `End the ${def.name} trial` : 'Try it in the sparring ring');
  }

  private pressCta(): void {
    if (this.ctaAction) { this.ctaAction(); return; }
    this.ctx.sound('denied');
    this.cta.classList.remove('shake'); void this.cta.offsetWidth; this.cta.classList.add('shake');
  }

  private pressTrial(): void {
    const id = this.current;
    if (!id) return;
    const hud = this.ctx.state.hud;
    if (hud && hud.trial && hud.element === id) {
      this.ctx.actions.trial(null);
      this.ctx.toast('Trial ended. Back to your own element.', 'info');
    } else {
      this.ctx.actions.trial(id);
      this.ctx.toast(`${ELEMENTS[id].name} is yours to try. The sparring ring is outside.`, 'good');
    }
    this.close(true);
  }
}
