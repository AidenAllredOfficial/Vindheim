// Tiny DOM toolkit for the interface: element builders, formatters and diff-friendly setters.
// No framework — every piece of the HUD owns its nodes and writes to them only on change.

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Props {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  id?: string;
  role?: string;
  tabindex?: number;
  hidden?: boolean;
  disabled?: boolean;
  type?: string;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  data?: Record<string, string | number>;
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
}

function append(parent: Node, c: Child): void {
  if (c === null || c === undefined || c === false) return;
  if (Array.isArray(c)) { for (const x of c) append(parent, x); return; }
  parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
}

/** Create an element: `h('div.panel.gold', { text: 'Hi' }, child, …)`. */
export function h<K extends keyof HTMLElementTagNameMap>(spec: K | `${K}.${string}`, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const dot = spec.indexOf('.');
  const tag = (dot < 0 ? spec : spec.slice(0, dot)) as K;
  const el = document.createElement(tag);
  if (dot >= 0) el.className = spec.slice(dot + 1).replace(/\./g, ' ');
  if (props) {
    if (props.class) el.className = el.className ? `${el.className} ${props.class}` : props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.title) el.title = props.title;
    if (props.id) el.id = props.id;
    if (props.role) el.setAttribute('role', props.role);
    if (props.tabindex !== undefined) el.tabIndex = props.tabindex;
    if (props.hidden) el.hidden = true;
    if (props.type) el.setAttribute('type', props.type);
    if (props.disabled) (el as unknown as HTMLButtonElement).disabled = true;
    if (props.style) for (const [k, v] of Object.entries(props.style)) {
      if (k.startsWith('--')) el.style.setProperty(k, String(v)); else (el.style as unknown as Record<string, string>)[k] = String(v);
    }
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) {
      if (v === null || v === undefined || v === false) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
    if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = String(v);
    if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn as EventListener);
  }
  for (const c of children) append(el, c);
  return el;
}

/** Parse a trusted HTML/SVG string (our own icon markup) into a single element. */
export function frag(markup: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
}

export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }
export function setChildren(el: Element, ...children: Child[]): void { clear(el); for (const c of children) append(el, c); }

/** Write text only when it changed (cheap to call every frame). */
export function setText(el: HTMLElement, text: string): void {
  const k = el as HTMLElement & { __t?: string };
  if (k.__t !== text) { k.__t = text; el.textContent = text; }
}
/** Toggle a class only when it changed. */
export function setClass(el: Element, cls: string, on: boolean): void {
  const k = el as Element & { __c?: Record<string, boolean> };
  const m = k.__c || (k.__c = {});
  if (m[cls] !== on) { m[cls] = on; el.classList.toggle(cls, on); }
}
/** Set a CSS custom property / style only when it changed. */
export function setVar(el: HTMLElement, name: string, value: string): void {
  const k = el as HTMLElement & { __v?: Record<string, string> };
  const m = k.__v || (k.__v = {});
  if (m[name] !== value) { m[name] = value; el.style.setProperty(name, value); }
}
export function setAttr(el: Element, name: string, value: string | null): void {
  const k = el as Element & { __a?: Record<string, string | null> };
  const m = k.__a || (k.__a = {});
  if (m[name] !== value) { m[name] = value; if (value === null) el.removeAttribute(name); else el.setAttribute(name, value); }
}
export function show(el: HTMLElement, on: boolean): void {
  const k = el as HTMLElement & { __h?: boolean };
  if (k.__h !== on) { k.__h = on; el.hidden = !on; }
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** 0xRRGGBB -> '#rrggbb' */
export const hex = (c: number): string => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
/** 0xRRGGBB -> 'r g b' (for `rgb(var(--x) / a)`). */
export const rgb = (c: number): string => `${(c >> 16) & 255} ${(c >> 8) & 255} ${c & 255}`;

/** 75 -> '1:15' */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** 12345 -> '12,345' */
export function num(n: number): string {
  const v = Math.round(n);
  const s = String(Math.abs(v));
  let out = '';
  for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) out += ','; out += s[i]; }
  return (v < 0 ? '-' : '') + out;
}
/** 5400 -> '1h 30m' */
export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export const ordinal = (n: number): string => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};

let uid = 0;
export const nextId = (prefix: string): string => `${prefix}-${++uid}`;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => !e.hidden && e.offsetParent !== null);
}

/** Copy text to the clipboard, with a fallback for insecure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = h('textarea', { attrs: { readonly: true, 'aria-hidden': 'true' }, style: { position: 'fixed', left: '-999px', top: '0', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
