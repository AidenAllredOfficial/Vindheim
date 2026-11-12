// Settings dialog. Every control reads and writes the settings store live; the store's
// subscription keeps the controls honest when something else changes a value (reset, another tab).

import { settings, DEFAULT_SETTINGS, DEFAULT_BINDS, type BindAction, type Keybinds, type QualitySetting, type Settings } from '../settings';
import { h, show, type Child } from './dom';
import { BIND_GROUPS, BIND_LABEL, codeFromEvent, fillKeycap, keyLabel } from './keys';
import { button, icon, segmented, sliderControl, switchControl, tabStrip, wireSound, type Ctx } from './core';

type Sync = () => void;
const pct = (v: number): string => `${Math.round(v * 100)}%`;

const TAB_KEYS: Record<string, (keyof Settings)[]> = {
  graphics: ['quality', 'renderScale', 'dynamicResolution', 'shadows', 'bloom', 'fov', 'showFps', 'showPing'],
  audio: ['masterVolume', 'musicVolume', 'sfxVolume', 'ambienceVolume', 'muteWhenHidden'],
  controls: ['sensitivity', 'touchSensitivity', 'invertY', 'aimAssist', 'leftHanded', 'binds'],
  gameplay: ['screenShake', 'hitStop', 'damageNumbers', 'reduceFlashes', 'reduceMotion', 'uiScale', 'highContrast', 'colorblind', 'hints', 'chat'],
};

export function openSettings(ctx: Ctx, initialTab = 'graphics'): void {
  if (ctx.modals.isOpen('settings')) return;
  const syncs: Sync[] = [];
  const get = settings.get.bind(settings);
  const set = (patch: Partial<Settings>): void => settings.set(patch);

  const row = (title: string, desc: string, control: HTMLElement, wide = false): HTMLElement =>
    h('div.set-row', { class: wide ? 'wide' : '' }, h('div.set-text', null, h('div.set-title', { text: title }), desc ? h('div.set-desc', { text: desc }) : null), h('div.set-ctl', null, control));
  const toggle = (key: keyof Settings, title: string, desc: string): HTMLElement => {
    const c = switchControl(ctx, title, () => !!get()[key], (v) => set({ [key]: v } as Partial<Settings>));
    syncs.push(c.sync);
    return row(title, desc, c.el);
  };
  const slide = (key: keyof Settings, title: string, desc: string, min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement => {
    const c = sliderControl(ctx, title, min, max, step, () => Number(get()[key]), (v) => set({ [key]: v } as Partial<Settings>), fmt);
    syncs.push(c.sync);
    return row(title, desc, c.el, true);
  };
  const group = (title: string, ...rows: Child[]): HTMLElement => h('section.set-group', null, h('h3.set-group-title', null, h('span', { text: title })), ...rows);

  // ------------------------------------------------------------------ graphics
  const quality = segmented<QualitySetting>(ctx, 'Quality', [
    { value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' },
  ], () => get().quality, (v) => set({ quality: v }));
  syncs.push(quality.sync);
  const graphics = h('div.set-pane', { role: 'tabpanel' },
    group('Picture',
      row('Quality', 'Auto reads your device and aims for a steady frame rate.', quality.el, true),
      slide('renderScale', 'Resolution scale', 'Lower it for speed, raise it for sharpness.', 0.5, 1.5, 0.05, pct),
      toggle('dynamicResolution', 'Dynamic resolution', 'Drops resolution in heavy moments to hold the frame rate.'),
      toggle('shadows', 'Shadows', 'Moonlight shadows from fighters and terrain.'),
      toggle('bloom', 'Bloom', 'The glow around fire, lightning and runes.'),
      slide('fov', 'Field of view', 'How wide the camera sees.', 60, 100, 1, (v) => `${Math.round(v)}°`)),
    group('Readouts',
      toggle('showFps', 'Show frame rate', 'A small FPS counter in the corner.'),
      toggle('showPing', 'Show ping', 'Your delay to the server, in milliseconds.')));

  // ------------------------------------------------------------------ audio
  const audio = h('div.set-pane', { role: 'tabpanel', hidden: true },
    group('Volume',
      slide('masterVolume', 'Master', 'Everything at once.', 0, 1, 0.01, pct),
      slide('musicVolume', 'Music', 'The score rises with the fight.', 0, 1, 0.01, pct),
      slide('sfxVolume', 'Effects', 'Strikes, spells and footsteps. You will want to hear these.', 0, 1, 0.01, pct),
      slide('ambienceVolume', 'Ambience', 'Wind, fire and distant thunder.', 0, 1, 0.01, pct)),
    group('Behaviour',
      toggle('muteWhenHidden', 'Mute in the background', 'Silence the game when its tab is not in front.')));

  // ------------------------------------------------------------------ controls
  const bindTable = h('div.binds');
  let listening: { action: BindAction; index: number; btn: HTMLButtonElement } | null = null;

  const stopListening = (): void => {
    if (!listening) return;
    listening.btn.classList.remove('listening');
    listening = null;
    ctx.keyCapture = null;
    window.removeEventListener('mousedown', onMouse, true);
    paintBinds();
  };
  const assign = (code: string): void => {
    if (!listening) return;
    const { action, index } = listening;
    const binds = structuredClone(get().binds) as Keybinds;
    // conflict: a key does one thing. Take it away from whoever had it.
    let stolen: BindAction | null = null;
    for (const a of Object.keys(binds) as BindAction[]) {
      const i = binds[a].indexOf(code);
      if (i >= 0 && !(a === action && i === index)) { binds[a].splice(i, 1); if (a !== action) stolen = a; }
    }
    const list = binds[action];
    if (index < list.length) list[index] = code; else list.push(code);
    binds[action] = Array.from(new Set(list)).slice(0, 2);
    set({ binds });
    if (stolen) ctx.toast(`${keyLabel(code)} moved from “${BIND_LABEL[stolen]}” to “${BIND_LABEL[action]}”.${binds[stolen].length ? '' : ` ${BIND_LABEL[stolen]} is now unbound.`}`, binds[stolen].length ? 'info' : 'bad');
    ctx.sound('equip');
    stopListening();
  };
  const clearBind = (): void => {
    if (!listening) return;
    const { action, index } = listening;
    const binds = structuredClone(get().binds) as Keybinds;
    binds[action].splice(index, 1);
    set({ binds });
    ctx.sound('back');
    stopListening();
  };
  function onMouse(ev: MouseEvent): void {
    if (!listening) return;
    const t = ev.target as HTMLElement | null;
    if (t && t.closest('.bind-cancel')) return;
    ev.preventDefault(); ev.stopPropagation();
    const code = codeFromEvent(ev);
    if (code) assign(code);
  }
  const listen = (action: BindAction, index: number, btn: HTMLButtonElement): void => {
    stopListening();
    listening = { action, index, btn };
    btn.classList.add('listening');
    btn.textContent = 'Press a key…';
    ctx.keyCapture = (ev) => {
      if (ev.type !== 'keydown') return;
      if (ev.key === 'Escape') { ctx.sound('back'); stopListening(); return; }
      if (ev.key === 'Backspace' || ev.key === 'Delete') { clearBind(); return; }
      const code = codeFromEvent(ev);
      if (code) assign(code);
    };
    // listen for mouse buttons on the next tick so the click that started this is not captured
    window.setTimeout(() => { if (listening) window.addEventListener('mousedown', onMouse, true); }, 0);
  };
  const paintBinds = (): void => {
    const binds = get().binds;
    bindTable.textContent = '';
    for (const g of BIND_GROUPS) {
      bindTable.appendChild(h('div.bind-group', { text: g.title }));
      for (const action of g.actions) {
        const list = binds[action] || [];
        const cells = [0, 1].map((i) => {
          const code = list[i] || '';
          const cap = h('kbd.keycap.dark');
          fillKeycap(cap, code);
          const b = h('button.bind-btn', { type: 'button', attrs: { 'aria-label': `${BIND_LABEL[action]}, ${i === 0 ? 'primary' : 'alternate'} binding: ${code ? keyLabel(code) : 'unbound'}. Press to rebind.` } }, cap);
          wireSound(ctx, b);
          b.addEventListener('click', () => listen(action, Math.min(i, list.length), b));
          return b;
        });
        bindTable.appendChild(h('div.bind-row', { class: list.length ? '' : 'unbound' },
          h('span.bind-name', null, BIND_LABEL[action], list.length ? null : h('span.bind-warn', null, icon('warn'), 'Unbound')), ...cells));
      }
    }
  };
  paintBinds();
  syncs.push(() => { if (!listening) paintBinds(); });

  const controls = h('div.set-pane', { role: 'tabpanel', hidden: true },
    group('Aim',
      slide('sensitivity', 'Mouse sensitivity', 'How far the camera turns for a given movement.', 0.2, 3, 0.05, (v) => `${v.toFixed(2)}×`),
      slide('touchSensitivity', 'Touch sensitivity', 'The same, for dragging on a touch screen.', 0.2, 3, 0.05, (v) => `${v.toFixed(2)}×`),
      toggle('invertY', 'Invert vertical look', 'Push up to look down.'),
      toggle('aimAssist', 'Aim assist', 'A gentle pull toward the foe nearest your crosshair.')),
    group('Touch',
      toggle('leftHanded', 'Left-handed layout', 'Mirror the touch controls: attacks on the left, movement on the right.')),
    group('Key bindings',
      h('p.set-note', null, 'Select a binding, then press a key or mouse button. ', h('kbd.keycap.dark', { text: 'Esc' }), ' cancels, ', h('kbd.keycap.dark.keycap-wide', { text: 'Bksp' }), ' clears.'),
      bindTable,
      h('div.set-inline', null, button(ctx, { label: 'Reset key bindings', icon: 'reset', class: 'btn small', onClick: () => { stopListening(); set({ binds: structuredClone(DEFAULT_BINDS) }); ctx.toast('Key bindings restored.', 'good'); } }))));

  // ------------------------------------------------------------------ gameplay & accessibility
  const gameplay = h('div.set-pane', { role: 'tabpanel', hidden: true },
    group('Feel',
      slide('screenShake', 'Screen shake', 'How hard the camera reacts to impacts.', 0, 1, 0.05, pct),
      toggle('hitStop', 'Hit-stop', 'A split-second freeze on heavy hits that sells the impact.'),
      toggle('damageNumbers', 'Damage numbers', 'Floating numbers where your hits land.')),
    group('Comfort',
      toggle('reduceFlashes', 'Reduce flashes', 'Softens lightning, impact frames and full-screen flashes.'),
      toggle('reduceMotion', 'Reduce motion', 'Calms interface animation and transitions.')),
    group('Legibility',
      slide('uiScale', 'Interface scale', 'Make the whole interface larger or smaller.', 0.8, 1.4, 0.05, pct),
      toggle('highContrast', 'High contrast', 'Solid panels, brighter text, stronger outlines.'),
      toggle('colorblind', 'Colour-blind-safe cues', 'Swaps red and green cues for orange and blue, and leans on shape.')),
    group('Guidance',
      toggle('hints', 'Hints', 'Short coach marks while you learn the ropes.'),
      toggle('chat', 'Chat', 'Show messages from others and allow sending your own.')));

  const panes: Record<string, HTMLElement> = { graphics, audio, controls, gameplay };
  const scroller = h('div.set-scroll.scroll', null, graphics, audio, controls, gameplay);
  const resetBtn = button(ctx, { label: 'Restore defaults', icon: 'reset', class: 'btn quiet small', onClick: () => {
    stopListening();
    const patch: Partial<Settings> = {};
    for (const k of TAB_KEYS[tabs.current()] || []) (patch as Record<string, unknown>)[k] = structuredClone(DEFAULT_SETTINGS[k]);
    set(patch);
    ctx.toast('Defaults restored for this page.', 'good');
  } });
  const tabs = tabStrip(ctx, 'Settings', [
    { id: 'graphics', label: 'Graphics', icon: 'monitor' }, { id: 'audio', label: 'Audio', icon: 'volume' },
    { id: 'controls', label: 'Controls', icon: 'keyboard' }, { id: 'gameplay', label: 'Gameplay & Access', icon: 'accessibility' },
  ], (id) => {
    stopListening();
    for (const [k, p] of Object.entries(panes)) show(p, k === id);
    scroller.scrollTop = 0;
  });
  tabs.el.classList.add('set-tabs');

  const unsub = settings.subscribe(() => { for (const s of syncs) s(); });
  const body = h('div.settings', null, tabs.el, scroller);
  const handle = ctx.modals.open({
    id: 'settings', title: 'Settings', width: '50rem', class: 'settings-modal', body,
    foot: [resetBtn, h('span.grow'), button(ctx, { label: 'Done', class: 'btn primary', sound: null, onClick: () => handle.close() })],
    onClose: () => { stopListening(); unsub(); },
    onEscape: () => { if (listening) { stopListening(); return true; } return false; },
  });
  tabs.select(panes[initialTab] ? initialTab : 'graphics');
}
