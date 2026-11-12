// Shared plumbing for every screen: the context object, sound-wired buttons, the modal stack
// (focus trap, Escape, restore focus) and toasts.

import type { HudFrame, UiActions, UiSound } from '../contracts';
import type { MatchInfo, Profile, RoomInfo, RosterEntry } from '@shared/types';
import { ELEMENTS, type ElementId } from '@shared/elements';
import { h, frag, focusables, hex, rgb, nextId, type Child } from './dom';
import { uiIcon, elementEmblem } from './icons';

export type Screen = 'loading' | 'title' | 'game';
export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface UiState {
  screen: Screen;
  profile: Profile | null;
  room: RoomInfo | null;
  roster: RosterEntry[];
  localId: number;
  match: MatchInfo | null;
  hud: HudFrame | null;
  conn: ConnState | null;
  connDetail: string;
  /** Touch controls are showing. */
  touch: boolean;
}

export type UiEvent = 'profile' | 'room' | 'roster' | 'match' | 'binds' | 'touch' | 'screen' | 'zone' | 'conn' | 'settings' | 'layout';

export interface Ctx {
  root: HTMLElement;
  actions: UiActions;
  state: UiState;
  sound(s: UiSound): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
  modals: ModalStack;
  on(ev: UiEvent, fn: () => void): void;
  emit(ev: UiEvent): void;
  /** Recompute isBlocking() and tell the game when it changed. */
  refreshBlocking(): void;
  openSettings(tab?: string): void;
  openHowTo(tab?: string): void;
  /** Invite link for the current room. */
  inviteLink(code: string): string;
  /** While set, every key event goes here instead of to the interface (key rebinding). */
  keyCapture: ((ev: KeyboardEvent) => void) | null;
}

// ------------------------------------------------------------------------------------ elements
/** Paint an element's colours onto a subtree as CSS variables. */
export function tint(el: HTMLElement, id: ElementId | null | undefined): void {
  const k = el as HTMLElement & { __el?: string };
  const key = id || '';
  if (k.__el === key) return;
  k.__el = key;
  const def = id ? ELEMENTS[id] : null;
  if (!def) { for (const v of ['--el', '--el-rgb', '--el-core', '--el-dark']) el.style.removeProperty(v); return; }
  el.style.setProperty('--el', hex(def.color));
  el.style.setProperty('--el-rgb', rgb(def.color));
  el.style.setProperty('--el-core', hex(def.core));
  el.style.setProperty('--el-dark', hex(def.dark));
}

export function medal(id: ElementId, size: '' | 'small' | 'tiny' = ''): HTMLElement {
  const m = h('span.medal', { class: size, html: elementEmblem(id), attrs: { 'aria-hidden': 'true' } });
  tint(m, id);
  return m;
}

export const icon = (name: string, cls = ''): HTMLElement => {
  const el = frag(uiIcon(name));
  if (cls) el.classList.add(...cls.split(' '));
  return el;
};

// ------------------------------------------------------------------------------------ buttons
export interface ButtonOpts {
  label?: string;
  icon?: string;
  class?: string;
  title?: string;
  aria?: string;
  sound?: UiSound | null;
  disabled?: boolean;
  onClick?: (ev: MouseEvent) => void;
}

/** Hover / press sounds for anything clickable. */
export function wireSound(ctx: Ctx, el: HTMLElement, click: UiSound | null = 'click'): void {
  el.addEventListener('pointerenter', (ev) => {
    if ((ev as PointerEvent).pointerType === 'mouse' && !(el as HTMLButtonElement).disabled) ctx.sound('hover');
  });
  if (click) el.addEventListener('click', () => ctx.sound(click));
}

export function button(ctx: Ctx, opts: ButtonOpts, ...children: Child[]): HTMLButtonElement {
  const b = h('button', { type: 'button', class: opts.class || 'btn', title: opts.title, disabled: opts.disabled, attrs: { 'aria-label': opts.aria } },
    opts.icon ? icon(opts.icon) : null,
    opts.label !== undefined ? h('span.btn-label', { text: opts.label }) : null,
    ...children);
  wireSound(ctx, b, opts.sound === undefined ? 'click' : opts.sound);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

export const iconButton = (ctx: Ctx, name: string, label: string, onClick: (ev: MouseEvent) => void, cls = ''): HTMLButtonElement =>
  button(ctx, { icon: name, class: `ibtn ${cls}`.trim(), aria: label, title: label, onClick });

export function setButtonLabel(b: HTMLElement, text: string): void {
  const l = b.querySelector('.btn-label');
  if (l && l.textContent !== text) l.textContent = text;
}

// ------------------------------------------------------------------------------------ switch / slider / segmented
export function switchControl(ctx: Ctx, label: string, get: () => boolean, set: (v: boolean) => void): { el: HTMLButtonElement; sync(): void } {
  const el = h('button.switch', { type: 'button', role: 'switch', attrs: { 'aria-label': label, 'aria-checked': String(get()) } }, h('i'));
  wireSound(ctx, el, null);
  el.addEventListener('click', () => { const v = !get(); set(v); ctx.sound(v ? 'click' : 'back'); el.setAttribute('aria-checked', String(v)); });
  return { el, sync: () => el.setAttribute('aria-checked', String(get())) };
}

export function sliderControl(ctx: Ctx, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): { el: HTMLElement; sync(): void } {
  const out = h('output');
  const input = h('input', { type: 'range', attrs: { min, max, step, 'aria-label': label } });
  const paint = (): void => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    input.setAttribute('aria-valuetext', fmt(v));
  };
  input.value = String(get());
  paint();
  let lastTick = 0;
  input.addEventListener('input', () => {
    set(Number(input.value));
    paint();
    const now = performance.now();
    if (now - lastTick > 70) { lastTick = now; ctx.sound('hover'); }
  });
  input.addEventListener('change', () => ctx.sound('click'));
  return { el: h('div.slider', null, input, out), sync: () => { input.value = String(get()); paint(); } };
}

export function segmented<T extends string>(ctx: Ctx, label: string, options: { value: T; label: string }[], get: () => T, set: (v: T) => void): { el: HTMLElement; sync(): void } {
  const el = h('div.seg', { role: 'radiogroup', attrs: { 'aria-label': label } });
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', role: 'radio', text: o.label, data: { v: o.value } });
    wireSound(ctx, b);
    b.addEventListener('click', () => { set(o.value); sync(); });
    b.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      ev.preventDefault();
      const i = options.findIndex((x) => x.value === get());
      const n = options[(i + (ev.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
      set(n.value); sync();
      (el.querySelector(`[data-v="${n.value}"]`) as HTMLElement | null)?.focus();
    });
    el.appendChild(b);
    return b;
  });
  const sync = (): void => {
    const v = get();
    for (const b of btns) { const on = b.dataset.v === v; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
  };
  sync();
  return { el, sync };
}

/** A tab strip with arrow-key navigation. */
export function tabStrip(ctx: Ctx, label: string, tabs: { id: string; label: string; icon?: string }[], onSelect: (id: string) => void): { el: HTMLElement; select(id: string, focus?: boolean): void; current(): string } {
  const el = h('div.tabs', { role: 'tablist', attrs: { 'aria-label': label } });
  let cur = tabs[0].id;
  const btns = tabs.map((t) => {
    const b = h('button.tab', { type: 'button', role: 'tab', data: { tab: t.id }, attrs: { 'aria-selected': 'false' } }, t.icon ? icon(t.icon) : null, h('span', { text: t.label }));
    wireSound(ctx, b);
    b.addEventListener('click', () => select(t.id));
    b.addEventListener('keydown', (ev) => {
      const d = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      ev.preventDefault(); ev.stopPropagation();
      const i = tabs.findIndex((x) => x.id === cur);
      select(tabs[(i + d + tabs.length) % tabs.length].id, true);
    });
    el.appendChild(b);
    return b;
  });
  function select(id: string, focus = false): void {
    if (!tabs.some((t) => t.id === id)) id = tabs[0].id;
    cur = id;
    for (const b of btns) { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
    onSelect(id);
  }
  return { el, select, current: () => cur };
}

// ------------------------------------------------------------------------------------ modal stack
export interface ModalOpts {
  id: string;
  title: string;
  /** CSS width of the dialog, e.g. '52rem'. */
  width?: string;
  class?: string;
  body: Child;
  foot?: Child;
  /** Element to focus first (defaults to the first focusable in the body). */
  focus?: HTMLElement | null;
  onClose?: () => void;
  /** Return true to swallow Escape (e.g. while capturing a key). */
  onEscape?: () => boolean;
  /** Hide the header close button (the dialog must offer its own way out). */
  noClose?: boolean;
}

export interface ModalHandle { id: string; el: HTMLElement; close(): void }

export class ModalStack {
  readonly layer: HTMLElement;
  private stack: { opts: ModalOpts; back: HTMLElement; dialog: HTMLElement; restore: HTMLElement | null; handle: ModalHandle }[] = [];

  constructor(private ctx: Ctx) {
    this.layer = h('div.v-layer.v-modals');
  }

  get count(): number { return this.stack.length; }
  isOpen(id: string): boolean { return this.stack.some((m) => m.opts.id === id); }
  top(): ModalHandle | null { return this.stack.length ? this.stack[this.stack.length - 1].handle : null; }

  open(opts: ModalOpts): ModalHandle {
    const existing = this.stack.find((m) => m.opts.id === opts.id);
    if (existing) return existing.handle;
    const titleId = nextId('v-modal-title');
    const closeBtn = opts.noClose ? null : iconButton(this.ctx, 'close', 'Close', () => handle.close());
    if (closeBtn) closeBtn.dataset.sound = 'none';
    const dialog = h('div.modal.panel', { class: opts.class, role: 'dialog', attrs: { 'aria-modal': 'true', 'aria-labelledby': titleId }, style: opts.width ? { '--w': opts.width } : undefined },
      h('header.modal-head', null, h('h2', { id: titleId, text: opts.title }), closeBtn),
      opts.body,
      opts.foot ? h('footer.modal-foot', null, opts.foot) : null);
    const back = h('div.modal-back', null, dialog);
    back.addEventListener('pointerdown', (ev) => { if (ev.target === back) handle.close(); });
    const restore = document.activeElement instanceof HTMLElement && this.ctx.root.contains(document.activeElement) ? document.activeElement : null;
    const handle: ModalHandle = { id: opts.id, el: dialog, close: () => this.close(opts.id) };
    // only the top dialog is interactive
    for (const m of this.stack) { m.back.setAttribute('inert', ''); m.back.style.visibility = 'hidden'; }
    this.stack.push({ opts, back, dialog, restore, handle });
    this.layer.appendChild(back);
    this.ctx.sound('open');
    this.ctx.refreshBlocking();
    const target = opts.focus || focusables(dialog).find((e) => !e.closest('.modal-head')) || focusables(dialog)[0];
    if (target) target.focus({ preventScroll: true });
    return handle;
  }

  close(id?: string, silent = false): void {
    const i = id ? this.stack.findIndex((m) => m.opts.id === id) : this.stack.length - 1;
    if (i < 0) return;
    const [m] = this.stack.splice(i, 1);
    m.back.classList.add('closing');
    m.back.style.pointerEvents = 'none';
    window.setTimeout(() => m.back.remove(), 170);
    const top = this.stack[this.stack.length - 1];
    if (top) { top.back.removeAttribute('inert'); top.back.style.visibility = ''; }
    if (!silent) this.ctx.sound('close');
    m.opts.onClose?.();
    this.ctx.refreshBlocking();
    if (m.restore && m.restore.isConnected) m.restore.focus({ preventScroll: true });
    else if (top) focusables(top.dialog)[0]?.focus({ preventScroll: true });
  }

  closeAll(): void { while (this.stack.length) this.close(undefined, true); }

  /** Key handling for the top dialog. Returns true if the key was consumed. */
  handleKey(ev: KeyboardEvent): boolean {
    const m = this.stack[this.stack.length - 1];
    if (!m) return false;
    if (ev.key === 'Escape') {
      if (m.opts.onEscape && m.opts.onEscape()) return true;
      this.close();
      return true;
    }
    if (ev.key === 'Tab') {
      const f = focusables(m.dialog);
      if (!f.length) { ev.preventDefault(); return true; }
      const first = f[0], last = f[f.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !m.dialog.contains(active)) { ev.preventDefault(); first.focus(); }
      else if (ev.shiftKey && active === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------------------------ toasts
export class Toasts {
  readonly el = h('div.v-toasts', { role: 'status', attrs: { 'aria-live': 'polite' } });
  private last = '';
  private lastAt = 0;

  push(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const now = performance.now();
    if (text === this.last && now - this.lastAt < 1500) return; // do not stack duplicates
    this.last = text; this.lastAt = now;
    const t = h('div.toast', { class: kind }, icon(kind === 'good' ? 'check' : kind === 'bad' ? 'warn' : 'info'), h('span', { text }));
    this.el.appendChild(t);
    while (this.el.childElementCount > 4) this.el.firstElementChild?.remove();
    const life = 2600 + Math.min(2600, text.length * 45);
    window.setTimeout(() => { t.classList.add('out'); window.setTimeout(() => t.remove(), 320); }, life);
  }
}
