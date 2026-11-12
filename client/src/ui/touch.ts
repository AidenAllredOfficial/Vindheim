// Touch controls. A floating stick under one thumb, drag-to-look under the other, and a thumb
// arc of buttons that double as the ability bar (icons, cooldown sweeps). Everything is tracked
// per pointer, so moving, aiming and firing all work at once — and a press on a button that turns
// into a drag keeps steering the camera.

import type { HudFrame, TouchInput } from '../contracts';
import { BTN_JUMP, SLOT_BUTTON } from '@shared/types';
import { SLOT_COUNT, type ElementId } from '@shared/elements';
import { settings } from '../settings';
import { h, show } from './dom';
import { uiIcon } from './icons';
import { tint, type Ctx } from './core';
import { AbilitySlot } from './slots';

const STICK_RADIUS = 58;
const DEADZONE = 0.14;
const DRAG_SLOP = 10;

interface Held { bit: number; el: HTMLElement; x: number; y: number; sx: number; sy: number; dragging: boolean }

export interface TouchCallbacks { menu(): void; chat(): void; scoreboard(): void }

export class TouchControls {
  readonly el: HTMLElement;
  readonly input: TouchInput = { active: false, moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, buttons: 0 };
  private zone: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private cluster: HTMLElement;
  private rotate: HTMLElement;
  private slots: AbilitySlot[] = [];
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private looks = new Map<number, { x: number; y: number }>();
  private held = new Map<number, Held>();
  private element: ElementId | '' = '';
  private enabled = false;
  private active = false;
  private rotateDismissed = false;
  private reduceMotion = false;

  constructor(private ctx: Ctx, cb: TouchCallbacks) {
    this.knob = h('i.t-knob');
    this.stick = h('div.t-stick', null, h('i.t-ring'), this.knob);
    this.zone = h('div.t-zone');
    this.cluster = h('div.t-cluster');

    const names = ['Strike', 'Ability 1', 'Ability 2', 'Ability 3', 'Signature move'];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const b = h('div.t-btn', { class: `t-s${i}`, role: 'button', attrs: { 'aria-label': names[i] } });
      const slot = new AbilitySlot(i, b, false);
      this.slots.push(slot);
      this.bindButton(b, SLOT_BUTTON[i]);
      this.cluster.appendChild(b);
    }
    const jump = h('div.t-btn.t-jump', { role: 'button', attrs: { 'aria-label': 'Jump' } }, h('span.slot-face', { html: uiIcon('jump') }));
    this.bindButton(jump, BTN_JUMP);
    this.cluster.appendChild(jump);

    const small = (name: string, label: string, fn: () => void): HTMLElement => {
      const b = h('button.t-small', { type: 'button', attrs: { 'aria-label': label }, html: uiIcon(name) });
      b.addEventListener('click', () => { ctx.sound('click'); fn(); });
      return b;
    };
    const top = h('div.t-top.v-click', null, small('list', 'Scoreboard', cb.scoreboard), small('chat', 'Chat', cb.chat), small('menu', 'Menu', cb.menu));

    this.rotate = h('button.t-rotate.v-click', { type: 'button', hidden: true, attrs: { 'aria-label': 'Rotate your device for the full view. Tap to dismiss.' } },
      h('span.t-rotate-icon', { html: uiIcon('rotate') }), h('span', { text: 'Turn your device sideways for the full view' }));
    this.rotate.addEventListener('click', () => { this.rotateDismissed = true; show(this.rotate, false); });

    this.el = h('div.v-layer.v-touch', { hidden: true }, this.zone, this.stick, this.cluster, top, this.rotate);

    const z = this.zone;
    z.addEventListener('pointerdown', (ev) => this.zoneDown(ev));
    z.addEventListener('pointermove', (ev) => this.zoneMove(ev));
    z.addEventListener('pointerup', (ev) => this.zoneUp(ev));
    z.addEventListener('pointercancel', (ev) => this.zoneUp(ev));
    z.addEventListener('lostpointercapture', (ev) => this.zoneUp(ev));
    this.el.addEventListener('contextmenu', (ev) => ev.preventDefault());

    ctx.on('settings', () => this.applySettings());
    ctx.on('layout', () => this.paintRotate());
    this.applySettings();
  }

  private applySettings(): void {
    const s = settings.get();
    this.reduceMotion = s.reduceMotion;
    this.el.classList.toggle('lh', s.leftHanded);
  }

  /** Touch mode on/off (device has / is using a touch screen). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.refresh();
  }

  /** In game and nothing is capturing input. */
  setActive(on: boolean): void {
    this.active = on;
    this.refresh();
  }

  private refresh(): void {
    const on = this.enabled && this.active;
    show(this.el, on);
    if (!on) this.reset();
    this.paintRotate();
  }

  private paintRotate(): void {
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    show(this.rotate, this.enabled && this.active && portrait && !this.rotateDismissed);
  }

  reset(): void {
    this.stickId = -1;
    this.looks.clear();
    for (const hd of this.held.values()) hd.el.classList.remove('down');
    this.held.clear();
    this.input.moveX = 0; this.input.moveY = 0; this.input.buttons = 0;
    this.stick.classList.remove('on');
    this.knob.style.transform = '';
  }

  /** Per frame: cooldowns on the buttons. */
  update(f: HudFrame): void {
    if (!this.enabled || !this.active) return;
    if (f.element !== this.element) {
      this.element = f.element;
      tint(this.cluster, f.element);
      for (const s of this.slots) s.setElement(f.element);
    }
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].update(f.cooldown[i] || 0, f.cooldownTotal[i] || 0, f.activeSlot === i, !!f.locked[i], this.reduceMotion);
    }
  }

  // ------------------------------------------------------------------ stick + look
  private isStickSide(x: number): boolean {
    const left = x < window.innerWidth * 0.46;
    return settings.get().leftHanded ? x > window.innerWidth * 0.54 : left;
  }

  private zoneDown(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    this.input.active = true;
    try { this.zone.setPointerCapture(ev.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    if (this.stickId < 0 && this.isStickSide(ev.clientX)) {
      this.stickId = ev.pointerId;
      const m = STICK_RADIUS + 12;
      this.stickX = Math.max(m, Math.min(window.innerWidth - m, ev.clientX));
      this.stickY = Math.max(m, Math.min(window.innerHeight - m, ev.clientY));
      this.stick.style.left = `${this.stickX}px`;
      this.stick.style.top = `${this.stickY}px`;
      this.stick.style.bottom = 'auto';
      this.stick.style.right = 'auto';
      this.stick.classList.add('on', 'placed');
      this.moveStick(ev.clientX, ev.clientY);
      return;
    }
    this.looks.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  }

  private zoneMove(ev: PointerEvent): void {
    if (ev.pointerId === this.stickId) { this.moveStick(ev.clientX, ev.clientY); return; }
    const l = this.looks.get(ev.pointerId);
    if (!l) return;
    this.input.lookDX += ev.clientX - l.x;
    this.input.lookDY += ev.clientY - l.y;
    l.x = ev.clientX; l.y = ev.clientY;
  }

  private zoneUp(ev: PointerEvent): void {
    if (ev.pointerId === this.stickId) {
      this.stickId = -1;
      this.input.moveX = 0; this.input.moveY = 0;
      this.stick.classList.remove('on');
      this.knob.style.transform = '';
      return;
    }
    this.looks.delete(ev.pointerId);
  }

  private moveStick(x: number, y: number): void {
    const dx = x - this.stickX, dy = y - this.stickY;
    const len = Math.hypot(dx, dy);
    const reach = Math.min(len, STICK_RADIUS);
    const ux = len > 0 ? dx / len : 0, uy = len > 0 ? dy / len : 0;
    this.knob.style.transform = `translate3d(${(ux * reach).toFixed(1)}px, ${(uy * reach).toFixed(1)}px, 0)`;
    const mag = reach / STICK_RADIUS;
    if (mag < DEADZONE) { this.input.moveX = 0; this.input.moveY = 0; return; }
    // rescale so the edge of the dead zone is 0 and the rim is 1
    const out = (mag - DEADZONE) / (1 - DEADZONE);
    this.input.moveX = ux * out;
    this.input.moveY = -uy * out;
  }

  // ------------------------------------------------------------------ buttons
  private bindButton(el: HTMLElement, bit: number): void {
    el.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      this.input.active = true;
      try { el.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
      this.held.set(ev.pointerId, { bit, el, x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, dragging: false });
      el.classList.add('down');
      this.syncButtons();
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* not allowed */ } }
    });
    el.addEventListener('pointermove', (ev) => {
      const hd = this.held.get(ev.pointerId);
      if (!hd) return;
      if (!hd.dragging && Math.hypot(ev.clientX - hd.sx, ev.clientY - hd.sy) > DRAG_SLOP) { hd.dragging = true; hd.x = ev.clientX; hd.y = ev.clientY; }
      if (hd.dragging) {
        this.input.lookDX += ev.clientX - hd.x;
        this.input.lookDY += ev.clientY - hd.y;
        hd.x = ev.clientX; hd.y = ev.clientY;
      }
    });
    const up = (ev: PointerEvent): void => {
      const hd = this.held.get(ev.pointerId);
      if (!hd) return;
      this.held.delete(ev.pointerId);
      let still = false;
      for (const o of this.held.values()) if (o.el === el) still = true;
      if (!still) el.classList.remove('down');
      this.syncButtons();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  private syncButtons(): void {
    let b = 0;
    for (const hd of this.held.values()) b |= hd.bit;
    this.input.buttons = b;
  }
}
