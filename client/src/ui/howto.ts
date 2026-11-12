// How to Play: controls (keyboard & mouse, touch), the combat rules in a few crisp lines, and
// what glory is for.

import { ELEMENTS, ELEMENT_ORDER } from '@shared/elements';
import { settings, type BindAction } from '../settings';
import { h, show, num } from './dom';
import { BIND_LABEL, keycap } from './keys';
import { button, icon, medal, tabStrip, type Ctx } from './core';
import { GLORY_LINES, RULES, TOUCH_GUIDE } from './copy';

const CONTROL_ROWS: { label: string; actions: BindAction[]; join?: string }[] = [
  { label: 'Move', actions: ['forward', 'left', 'back', 'right'] },
  { label: 'Jump — tap just before landing to roll out of a knockdown', actions: ['jump'] },
  { label: 'Melee strike', actions: ['melee'] },
  { label: 'Elemental attacks', actions: ['ability1', 'ability2', 'ability3'] },
  { label: 'Signature move', actions: ['move'] },
  { label: 'Interact — pedestals, the Skygate', actions: ['interact'] },
  { label: 'Deploy to the arena', actions: ['deploy'] },
  { label: 'Hold to return to the hall', actions: ['hall'] },
  { label: 'Scoreboard · Chat · Menu', actions: ['scoreboard', 'chat', 'menu'] },
];

function touchDiagram(leftHanded: boolean): HTMLElement {
  return h('div.touch-diagram', { class: leftHanded ? 'lh' : '', attrs: { role: 'img', 'aria-label': 'Touch layout: a movement stick under one thumb, attack buttons in an arc under the other, and drag-to-aim on the attack side.' } },
    h('div.td-phone', null,
      h('div.td-stick', null, h('i')),
      h('div.td-look', null, h('span', { text: 'Drag to aim' })),
      h('div.td-cluster', null, h('i.td-melee'), h('i.td-a.a1'), h('i.td-a.a2'), h('i.td-a.a3'), h('i.td-m'), h('i.td-j')),
      h('div.td-top', null, h('i'), h('i'), h('i'))));
}

export function openHowTo(ctx: Ctx, initialTab?: string): void {
  if (ctx.modals.isOpen('howto')) return;
  const binds = settings.get().binds;

  const keys = h('div.how-keys', null, ...CONTROL_ROWS.map((r) =>
    h('div.how-key-row', null,
      h('span.how-caps', { attrs: { 'aria-label': r.actions.map((a) => BIND_LABEL[a]).join(', ') } }, ...r.actions.map((a) => keycap((binds[a] && binds[a][0]) || ''))),
      h('span.how-key-label', { text: r.label }))));
  const kbPane = h('div.how-pane', { role: 'tabpanel' },
    h('div.how-cols', null,
      h('section', null, h('h3.how-h', null, icon('keyboard'), 'Keyboard & mouse'), keys,
        h('p.set-note', null, 'Aim with the mouse. Every binding can be changed in ', linkButton(ctx, 'Settings → Controls', () => ctx.openSettings('controls')), '.')),
      h('section', null, h('h3.how-h', null, icon('touch'), 'Touch'), touchDiagram(settings.get().leftHanded),
        h('ul.how-touch', null, ...TOUCH_GUIDE.map((t) => h('li', null, h('b', { text: t.title }), h('span', { text: t.text })))))));

  const rulesPane = h('div.how-pane', { role: 'tabpanel', hidden: true },
    h('ul.how-rules', null, ...RULES.map((r) => h('li', null, h('span.how-rule-icon', null, icon(r.icon)), h('div', null, h('h3', { text: r.title }), h('p', { text: r.text }))))));

  const p = ctx.state.profile;
  const owned = new Set(p ? p.owned : [ELEMENT_ORDER[0]]);
  const ladder = h('ol.how-ladder', null, ...ELEMENT_ORDER.map((id) => {
    const def = ELEMENTS[id];
    return h('li', { class: owned.has(id) ? 'owned' : '' }, medal(id, 'small'), h('span.how-ladder-name', { text: def.name }),
      h('span.how-ladder-cost.t-num', null, owned.has(id) ? icon('check') : null, owned.has(id) ? 'Yours' : def.cost ? num(def.cost) : 'Free'));
  }));
  const gloryPane = h('div.how-pane', { role: 'tabpanel', hidden: true },
    h('div.how-cols', null,
      h('ul.how-rules', null, ...GLORY_LINES.map((r) => h('li', null, h('span.how-rule-icon', null, icon(r.icon)), h('div', null, h('h3', { text: r.title }), h('p', { text: r.text }))))),
      h('section', null, h('h3.how-h', null, icon('glory'), 'The ladder'), ladder)));

  const panes: Record<string, HTMLElement> = { controls: kbPane, combat: rulesPane, glory: gloryPane };
  const scroller = h('div.set-scroll.scroll', null, kbPane, rulesPane, gloryPane);
  const tabs = tabStrip(ctx, 'How to play', [
    { id: 'controls', label: 'Controls', icon: 'keyboard' }, { id: 'combat', label: 'Combat', icon: 'swords' }, { id: 'glory', label: 'Glory', icon: 'glory' },
  ], (id) => { for (const [k, el] of Object.entries(panes)) show(el, k === id); scroller.scrollTop = 0; });
  tabs.el.classList.add('set-tabs');

  const handle = ctx.modals.open({
    id: 'howto', title: 'How to play', width: '50rem', class: 'settings-modal', body: h('div.settings', null, tabs.el, scroller),
    foot: [h('span.how-foot-line', { text: 'Spacing, timing, terrain. Never stats.' }), h('span.grow'), button(ctx, { label: 'Got it', class: 'btn primary', sound: null, onClick: () => handle.close() })],
  });
  tabs.select(initialTab && panes[initialTab] ? initialTab : ctx.state.touch ? 'combat' : 'controls');
}

function linkButton(ctx: Ctx, label: string, onClick: () => void): HTMLElement {
  return button(ctx, { label, class: 'linkish', onClick });
}
