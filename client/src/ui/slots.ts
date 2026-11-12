// One ability slot: icon plate, radial cooldown sweep, remaining seconds, ready flash, active and
// locked states. Used by the desktop ability bar and by the touch buttons (which ARE the bar on
// touch). `update()` is called every frame and writes to the DOM only when something changed.

import { ELEMENTS, type ElementId } from '@shared/elements';
import { h, setClass, setText, setVar } from './dom';
import { abilityIcon } from './icons';
import { fillKeycap, primaryBind, SLOT_ACTION, SLOT_NAME } from './keys';

export class AbilitySlot {
  readonly el: HTMLElement;
  private face: HTMLElement;
  private secs: HTMLElement;
  private flash: HTMLElement;
  private key: HTMLElement | null = null;
  private abilityKey = '';
  private wasCooling = false;
  private total = 0;
  private lastP = -1;
  private lastSec = -1;

  constructor(readonly slot: number, host?: HTMLElement, withKey = true) {
    this.face = h('span.slot-face');
    this.secs = h('span.slot-secs.t-num', { attrs: { 'aria-hidden': 'true' } });
    this.flash = h('span.slot-flash');
    this.el = host || h('div.slot');
    this.el.classList.add('slot', `slot-${slot}`);
    this.el.append(this.face, h('span.slot-sweep'), this.flash, this.secs, h('span.slot-ban'));
    if (withKey) { this.key = h('kbd.keycap.slot-key'); this.el.append(this.key); this.refreshKey(); }
  }

  /** Swap the icon for the ability an element has in this slot. */
  setElement(el: ElementId): void {
    const a = ELEMENTS[el].abilities[this.slot];
    if (!a || a.key === this.abilityKey) return;
    this.abilityKey = a.key;
    this.face.innerHTML = abilityIcon(a.key);
    this.el.setAttribute('aria-label', `${SLOT_NAME[this.slot]}: ${a.name}`);
    this.el.title = '';
  }

  refreshKey(): void {
    if (this.key) fillKeycap(this.key, primaryBind(SLOT_ACTION[this.slot]));
  }

  update(cd: number, total: number, active: boolean, locked: boolean, reduceMotion: boolean): void {
    const cooling = cd > 0.04;
    const showNumber = cooling && total >= 1.4;
    setClass(this.el, 'cooling', cooling);
    setClass(this.el, 'active', active);
    setClass(this.el, 'locked', locked && !cooling);
    if (cooling) {
      this.total = total;
      const p = Math.round((total > 0 ? Math.min(1, cd / total) : 0) * 200);
      if (p !== this.lastP) { this.lastP = p; setVar(this.el, '--p', String(p / 200)); }
      const sec = !showNumber ? -1 : cd >= 3 ? Math.ceil(cd) * 10 : Math.round(cd * 10);
      if (sec !== this.lastSec) { this.lastSec = sec; setText(this.secs, sec < 0 ? '' : cd >= 3 ? String(sec / 10) : (sec / 10).toFixed(1)); }
    } else if (this.wasCooling) {
      setText(this.secs, '');
      setVar(this.el, '--p', '0');
      this.lastP = 0; this.lastSec = -1;
      if (this.total >= 1.4 && this.flash.animate) {
        this.flash.animate(
          reduceMotion
            ? [{ opacity: 0.7 }, { opacity: 0 }]
            : [{ opacity: 0.95, transform: 'scale(0.9)' }, { opacity: 0, transform: 'scale(1.45)' }],
          { duration: reduceMotion ? 200 : 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
        if (!reduceMotion) this.face.animate([{ transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      }
    }
    this.wasCooling = cooling;
  }
}
