// Chat: a quiet log in the corner whose lines fade out, and an input that opens on demand.

import type { ChatLine } from '../contracts';
import { CHAT_MAX } from '@shared/types';
import { settings } from '../settings';
import { h, setText, show } from './dom';
import { keycap } from './keys';
import { tint, type Ctx } from './core';

const MAX_LINES = 40;
const FADE_AFTER = 9000;

export class Chat {
  readonly el: HTMLElement;
  private log: HTMLElement;
  private form: HTMLElement;
  private input: HTMLInputElement;
  private count: HTMLElement;
  private hintRow: HTMLElement;
  open = false;

  constructor(private ctx: Ctx) {
    this.log = h('div.chat-log', { role: 'log', attrs: { 'aria-live': 'polite', 'aria-label': 'Chat' } });
    this.input = h('input.chat-input', { type: 'text', attrs: { maxlength: CHAT_MAX, autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': 'Chat message', placeholder: 'Say something worth hearing' } });
    this.count = h('span.chat-count.t-num');
    this.form = h('div.chat-form', { hidden: true }, h('span.t-label', { text: 'Say' }), this.input, this.count);
    this.hintRow = h('div.chat-hint', { hidden: true }, h('span', null, keycap('Enter'), 'send'), h('span', null, keycap('Escape'), 'cancel'));
    this.el = h('div.chat', null, this.log, this.form, this.hintRow);

    this.input.addEventListener('input', () => this.paintCount());
    this.input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); this.send(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); this.close(true); }
    });
    this.input.addEventListener('keyup', (ev) => ev.stopPropagation());
    this.input.addEventListener('blur', () => { if (this.open) window.setTimeout(() => { if (this.open && document.activeElement !== this.input) this.close(false); }, 120); });
    ctx.on('settings', () => this.applySettings());
    this.applySettings();
  }

  private applySettings(): void {
    const on = settings.get().chat;
    show(this.el, on);
    if (!on && this.open) this.close(false);
  }

  private paintCount(): void {
    const left = CHAT_MAX - this.input.value.length;
    setText(this.count, String(left));
    this.count.classList.toggle('near', left <= 20);
  }

  openInput(): void {
    if (!settings.get().chat) { this.ctx.toast('Chat is off. Turn it on in Settings → Gameplay.', 'info'); return; }
    if (this.open) { this.input.focus(); return; }
    this.open = true;
    this.el.classList.add('open');
    show(this.form, true);
    show(this.hintRow, !this.ctx.state.touch);
    this.input.value = '';
    this.paintCount();
    this.log.scrollTop = this.log.scrollHeight;
    this.ctx.refreshBlocking();
    this.input.focus({ preventScroll: true });
    this.ctx.sound('open');
  }

  close(sound: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('open');
    show(this.form, false);
    show(this.hintRow, false);
    this.input.blur();
    if (sound) this.ctx.sound('close');
    this.ctx.refreshBlocking();
  }

  private send(): void {
    const text = this.input.value.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (text) { this.ctx.actions.sendChat(text); this.ctx.sound('chat'); }
    this.close(!text);
  }

  push(line: ChatLine): void {
    if (!settings.get().chat && !line.system) return;
    const el = h('div.chat-line', { class: `${line.system ? 'system' : ''} ${line.self ? 'self' : ''}` },
      line.system ? null : h('b', { text: line.name }),
      line.text);
    if (!line.system && line.element && !line.self) tint(el, line.element);
    this.log.appendChild(el);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    window.setTimeout(() => el.classList.add('faded'), FADE_AFTER);
    if (!line.self && !line.system) this.ctx.sound('chat');
  }

  clear(): void { this.log.textContent = ''; }
}
