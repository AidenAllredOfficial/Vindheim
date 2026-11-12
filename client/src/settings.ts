// Player settings: one typed store, persisted to localStorage, observable.

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = 'auto' | QualityLevel;

export type BindAction =
  | 'forward' | 'back' | 'left' | 'right' | 'jump'
  | 'melee' | 'ability1' | 'ability2' | 'ability3' | 'move'
  | 'interact' | 'deploy' | 'hall' | 'scoreboard' | 'chat' | 'menu';

/** Key bindings use KeyboardEvent.code, or 'Mouse0' / 'Mouse1' / 'Mouse2' for mouse buttons. */
export type Keybinds = Record<BindAction, string[]>;

export const DEFAULT_BINDS: Keybinds = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  melee: ['Mouse0'], ability1: ['Mouse2', 'KeyQ'], ability2: ['KeyE'], ability3: ['KeyR'], move: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyF'], deploy: ['KeyG'], hall: ['KeyH'], scoreboard: ['Tab'], chat: ['Enter'], menu: ['Escape'],
};

export interface Settings {
  // graphics
  quality: QualitySetting;
  /** Resolution scale 0.5 .. 1.5 (multiplied by device pixel ratio, capped). */
  renderScale: number;
  /** Let the game lower resolution automatically to hold frame rate. */
  dynamicResolution: boolean;
  shadows: boolean;
  bloom: boolean;
  fov: number;
  showFps: boolean;
  // audio (0..1)
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  muteWhenHidden: boolean;
  // controls
  sensitivity: number;
  invertY: boolean;
  touchSensitivity: number;
  /** Gentle aim magnetism toward enemies (on by default for touch). */
  aimAssist: boolean;
  leftHanded: boolean;
  binds: Keybinds;
  // gameplay / accessibility
  /** Camera shake multiplier 0..1. */
  screenShake: number;
  /** Soften full-screen flashes, impact frames and lightning. */
  reduceFlashes: boolean;
  /** Tone down interface motion. */
  reduceMotion: boolean;
  hitStop: boolean;
  damageNumbers: boolean;
  /** Interface scale 0.8 .. 1.4. */
  uiScale: number;
  highContrast: boolean;
  /** Use a colour-blind-safe palette for enemy / ally cues. */
  colorblind: boolean;
  showPing: boolean;
  chat: boolean;
  /** Onboarding hints. */
  hints: boolean;
}

const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto', renderScale: 1, dynamicResolution: true, shadows: true, bloom: true, fov: 72, showFps: false,
  masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.9, ambienceVolume: 0.7, muteWhenHidden: true,
  sensitivity: 1, invertY: false, touchSensitivity: 1, aimAssist: isTouch, leftHanded: false,
  binds: DEFAULT_BINDS,
  screenShake: 1, reduceFlashes: false, reduceMotion: false, hitStop: true, damageNumbers: true,
  uiScale: 1, highContrast: false, colorblind: false, showPing: true, chat: true, hints: true,
};

const KEY = 'vindheim.settings.v1';
type Listener = (s: Settings, changed: (keyof Settings)[]) => void;

class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    this.value = structuredClone(DEFAULT_SETTINGS);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
          if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULT_SETTINGS[k]) (this.value as any)[k] = saved[k];
        }
        this.value.binds = { ...structuredClone(DEFAULT_BINDS), ...(saved.binds || {}) };
      }
    } catch { /* corrupted or unavailable storage: fall back to defaults */ }
  }

  get(): Readonly<Settings> { return this.value; }

  set(patch: Partial<Settings>): void {
    const changed: (keyof Settings)[] = [];
    for (const k of Object.keys(patch) as (keyof Settings)[]) {
      if (patch[k] === undefined) continue;
      if (JSON.stringify(this.value[k]) !== JSON.stringify(patch[k])) { (this.value as any)[k] = patch[k]; changed.push(k); }
    }
    if (!changed.length) return;
    try { localStorage.setItem(KEY, JSON.stringify(this.value)); } catch { /* ignore */ }
    for (const l of this.listeners) l(this.value, changed);
  }

  reset(): void { this.set(structuredClone(DEFAULT_SETTINGS)); }

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export const settings = new SettingsStore();
export const IS_TOUCH = isTouch;
