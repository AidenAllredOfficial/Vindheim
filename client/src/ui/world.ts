// World-anchored interface: nameplates above fighters and floating damage numbers. Both are
// pooled; per frame we only write transforms / opacity, and only when the value moved.

import type { DamageNumber, Nameplate } from '../contracts';
import { settings } from '../settings';
import { h, setClass, setText } from './dom';
import { uiIcon, elementEmblem } from './icons';
import { tint } from './core';

interface Plate {
  el: HTMLElement;
  name: HTMLElement;
  fill: HTMLElement;
  emblem: HTMLElement;
  id: number;
  seen: number;
  // last drawn
  x: number; y: number; scale: number; alpha: number; hp: number; text: string; element: string;
}

const MAX_PLATES = 24;

export class WorldLayer {
  readonly el: HTMLElement;
  private plateLayer = h('div.plates');
  private numberLayer = h('div.dmg-layer', { attrs: { 'aria-hidden': 'true' } });
  private plates = new Map<number, Plate>();
  private free: Plate[] = [];
  private frame = 0;
  private numbers: HTMLElement[] = [];
  private numberIndex = 0;

  constructor() {
    this.el = h('div.v-layer.v-world', { attrs: { 'aria-hidden': 'true' } }, this.plateLayer, this.numberLayer);
    for (let i = 0; i < 28; i++) {
      const n = h('span.dmg');
      this.numbers.push(n);
      this.numberLayer.appendChild(n);
    }
  }

  private makePlate(): Plate {
    const name = h('span.np-name');
    const fill = h('i.np-fill');
    const emblem = h('span.np-el');
    const el = h('div.np', null,
      h('div.np-row', null, h('span.np-crown', { html: uiIcon('crown') }), emblem, name, h('span.np-bot', { text: 'BOT' })),
      h('div.np-bar', null, fill));
    this.plateLayer.appendChild(el);
    return { el, name, fill, emblem, id: -1, seen: 0, x: NaN, y: NaN, scale: NaN, alpha: NaN, hp: NaN, text: '', element: '' };
  }

  setNameplates(list: Nameplate[]): void {
    const frame = ++this.frame;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n.onScreen) continue;
      let p = this.plates.get(n.id);
      if (!p) {
        if (this.plates.size >= MAX_PLATES) continue;
        p = this.free.pop() || this.makePlate();
        p.id = n.id;
        p.x = p.y = p.scale = p.alpha = p.hp = NaN;
        this.plates.set(n.id, p);
        p.el.style.display = '';
      }
      p.seen = frame;

      if (p.text !== n.name) { p.text = n.name; setText(p.name, n.isDummy ? 'Training dummy' : n.name); }
      if (p.element !== n.element) { p.element = n.element; tint(p.el, n.element); p.emblem.innerHTML = elementEmblem(n.element); }
      setClass(p.el, 'bot', n.isBot && !n.isDummy);
      setClass(p.el, 'dummy', n.isDummy);
      setClass(p.el, 'leader', n.leader);

      const hp = Math.max(0, Math.min(100, Math.round(n.hp)));
      if (hp !== p.hp) {
        p.hp = hp;
        p.fill.style.transform = `scaleX(${(hp / 100).toFixed(3)})`;
        setClass(p.el, 'low', hp <= 30);
      }

      // far plates shrink and thin out; occluded ones fade
      const d = n.dist;
      const scale = Math.round((d < 8 ? 1 : d > 45 ? 0.68 : 1 - ((d - 8) / 37) * 0.32) * 50) / 50;
      const alpha = Math.round((n.hidden ? 0.22 : d > 70 ? 0.45 : d > 45 ? 0.75 : 1) * 20) / 20;
      const x = Math.round(n.sx * 2) / 2, y = Math.round(n.sy * 2) / 2;
      if (x !== p.x || y !== p.y || scale !== p.scale) {
        p.x = x; p.y = y; p.scale = scale;
        p.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%) scale(${scale})`;
      }
      if (alpha !== p.alpha) { p.alpha = alpha; p.el.style.opacity = String(alpha); }
    }
    for (const [id, p] of this.plates) {
      if (p.seen === frame) continue;
      p.el.style.display = 'none';
      this.plates.delete(id);
      this.free.push(p);
    }
  }

  clearPlates(): void {
    for (const [id, p] of this.plates) { p.el.style.display = 'none'; this.plates.delete(id); this.free.push(p); }
  }

  pushDamageNumber(d: DamageNumber): void {
    const s = settings.get();
    if (!s.damageNumbers) return;
    const el = this.numbers[this.numberIndex];
    this.numberIndex = (this.numberIndex + 1) % this.numbers.length;
    const amount = Math.max(1, Math.round(d.amount));
    const big = d.heavy || d.kind === 'crit';
    el.className = `dmg k-${d.kind}${d.heavy ? ' heavy' : ''}`;
    // shape cues as well as colour: crits get a bang, heals a plus, damage taken a minus
    el.textContent = d.kind === 'heal' ? `+${amount}` : d.kind === 'taken' ? `−${amount}` : d.kind === 'crit' ? `${amount}!` : String(amount);
    if (!el.animate) return;
    for (const a of el.getAnimations()) a.cancel();
    const jx = (Math.random() - 0.5) * 36;
    const x = d.sx + jx * 0.4, y = d.sy;
    const rise = d.kind === 'dot' ? 34 : big ? 78 : 56;
    const drift = jx * (d.kind === 'taken' ? 0.4 : 1.3);
    const s0 = big ? 1.9 : 1.35;
    const at = (dx: number, dy: number, sc: number): string => `translate3d(${(x + dx).toFixed(1)}px, ${(y + dy).toFixed(1)}px, 0) translate(-50%, -50%) scale(${sc})`;
    const dir = d.kind === 'taken' ? 0.6 : -1;
    if (s.reduceMotion) {
      el.animate([{ opacity: 1, transform: at(0, 0, 1) }, { opacity: 1, transform: at(0, 0, 1), offset: 0.7 }, { opacity: 0, transform: at(0, 0, 1) }], { duration: 700 });
      return;
    }
    el.animate([
      { opacity: 0, transform: at(0, 0, s0) },
      { opacity: 1, transform: at(drift * 0.15, dir * rise * 0.22, 1), offset: 0.14 },
      { opacity: 1, transform: at(drift * 0.7, dir * rise * 0.8, 1), offset: 0.7 },
      { opacity: 0, transform: at(drift, dir * rise, 0.86) },
    ], { duration: big ? 1100 : d.kind === 'dot' ? 620 : 860, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }
}
