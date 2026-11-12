// Key binding presentation: human labels for KeyboardEvent.code values, keycap elements and
// the labels of the bindable actions.

import { settings, type BindAction } from '../settings';
import { h, frag } from './dom';
import { uiIcon } from './icons';

export const BIND_ACTIONS: BindAction[] = [
  'forward', 'back', 'left', 'right', 'jump',
  'melee', 'ability1', 'ability2', 'ability3', 'move',
  'interact', 'deploy', 'hall', 'scoreboard', 'chat', 'menu',
];

export const BIND_LABEL: Record<BindAction, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump',
  melee: 'Melee strike', ability1: 'Ability 1', ability2: 'Ability 2', ability3: 'Ability 3', move: 'Signature move',
  interact: 'Interact', deploy: 'Deploy to the arena', hall: 'Return to the hall (hold)', scoreboard: 'Scoreboard', chat: 'Chat', menu: 'Menu',
};

export const BIND_GROUPS: { title: string; actions: BindAction[] }[] = [
  { title: 'Movement', actions: ['forward', 'back', 'left', 'right', 'jump'] },
  { title: 'Combat', actions: ['melee', 'ability1', 'ability2', 'ability3', 'move'] },
  { title: 'Hall & interface', actions: ['interact', 'deploy', 'hall', 'scoreboard', 'chat', 'menu'] },
];

/** Bind action for an ability slot (0 melee, 1..3 attacks, 4 movement). */
export const SLOT_ACTION: BindAction[] = ['melee', 'ability1', 'ability2', 'ability3', 'move'];
export const SLOT_NAME = ['Melee', 'Ability 1', 'Ability 2', 'Ability 3', 'Signature'];

const NAMED: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Bksp', Delete: 'Del', Insert: 'Ins',
  ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt',
  MetaLeft: 'Meta', MetaRight: 'R Meta', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
};

/** Short label for a binding code ('KeyQ' -> 'Q', 'Mouse0' -> 'LMB'). */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (/^F\d+$/.test(code)) return code;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Spoken label for screen readers. */
export function keySpoken(code: string): string {
  switch (code) {
    case 'Mouse0': return 'left mouse button';
    case 'Mouse1': return 'middle mouse button';
    case 'Mouse2': return 'right mouse button';
    case 'ArrowUp': return 'up arrow';
    case 'ArrowDown': return 'down arrow';
    case 'ArrowLeft': return 'left arrow';
    case 'ArrowRight': return 'right arrow';
    default: return keyLabel(code);
  }
}

const MOUSE_ICON: Record<string, string> = { Mouse0: 'mouseL', Mouse1: 'mouseM', Mouse2: 'mouseR' };

/** The first binding of an action (the one shown on the HUD). */
export function primaryBind(action: string): string {
  const b = settings.get().binds[action as BindAction];
  return (b && b[0]) || '';
}

/** A keycap element for a binding code. */
export function keycap(code: string, extraClass = ''): HTMLElement {
  const cap = h('kbd.keycap', { class: extraClass, attrs: { 'aria-label': keySpoken(code) } });
  fillKeycap(cap, code);
  return cap;
}

/** (Re)fill an existing keycap; cheap to call when bindings change. */
export function fillKeycap(cap: HTMLElement, code: string): void {
  const k = cap as HTMLElement & { __code?: string };
  if (k.__code === code) return;
  k.__code = code;
  cap.textContent = '';
  cap.classList.toggle('keycap-mouse', !!MOUSE_ICON[code]);
  cap.classList.toggle('keycap-empty', !code);
  cap.setAttribute('aria-label', code ? keySpoken(code) : 'unbound');
  if (MOUSE_ICON[code]) { cap.appendChild(frag(uiIcon(MOUSE_ICON[code]))); return; }
  cap.textContent = keyLabel(code);
  cap.classList.toggle('keycap-wide', keyLabel(code).length > 2);
}

/** Keycap for the primary binding of an action. */
export const actionKeycap = (action: string, extraClass = ''): HTMLElement => keycap(primaryBind(action), extraClass);

/** Translate a DOM event into a binding code, or null if it should be ignored. */
export function codeFromEvent(ev: KeyboardEvent | MouseEvent): string | null {
  if (ev instanceof KeyboardEvent) {
    if (!ev.code || ev.code === 'Unidentified') return null;
    return ev.code;
  }
  return ev.button >= 0 && ev.button <= 4 ? `Mouse${ev.button}` : null;
}
