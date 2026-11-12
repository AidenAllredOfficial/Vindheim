// Player input: keyboard + mouse (pointer lock), gamepad and touch, merged into one aim
// direction and one movement/button sample per simulation tick.

import { clamp, wrapAngle } from '@shared/math';
import { BTN_A1, BTN_A2, BTN_A3, BTN_JUMP, BTN_MELEE, BTN_MOVE } from '@shared/types';
import { settings, type BindAction } from '../settings';
import type { TouchInput } from '../contracts';

const PITCH_MAX = 1.35;
const SIM_ACTIONS: [BindAction, number][] = [
  ['jump', BTN_JUMP], ['melee', BTN_MELEE], ['ability1', BTN_A1], ['ability2', BTN_A2], ['ability3', BTN_A3], ['move', BTN_MOVE],
];
const UI_ACTIONS: BindAction[] = ['interact', 'deploy', 'hall', 'scoreboard', 'chat', 'menu'];

export class InputManager {
  yaw = 0;
  pitch = 0;
  /** Gameplay input allowed (false while a menu is open or on the title screen). */
  enabled = false;
  pointerLocked = false;
  /** Last device used, so prompts can show the right glyphs. */
  device: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  /** Fired once when a non-simulation action is pressed. */
  onAction: (a: BindAction) => void = () => {};
  /** Fired when one is released (scoreboard is hold-to-show, hall is hold-to-recall). */
  onActionUp: (a: BindAction) => void = () => {};
  /** Pointer lock was lost without the game asking for it (Esc): show the menu. */
  onLockLost: () => void = () => {};
  /** How fast the player is turning right now (rad/s), for aim assist. */
  turnRate = 0;

  private down = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private padPrev = 0;
  private padButtons = 0;
  private padMoveX = 0;
  private padMoveY = 0;
  private padLookX = 0;
  private padLookY = 0;
  private wantLock = false;
  private padHeld = new Set<BindAction>();

  constructor(private canvas: HTMLCanvasElement, private touch: TouchInput, private blocking: () => boolean) {
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.blocking()) return;
      this.device = 'keyboard';
      if (!this.pointerLocked) { this.lock(); if (e.button === 0) return; }
      this.setCode('Mouse' + e.button, true);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => this.setCode('Mouse' + e.button, false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      // without pointer lock (unsupported / denied) dragging with a button held still looks around
      if (this.pointerLocked || (e.buttons !== 0 && e.target === this.canvas)) {
        this.lookX += e.movementX; this.lookY += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      const was = this.pointerLocked;
      this.pointerLocked = locked;
      if (was && !locked) { this.releaseAll(); if (this.wantLock && this.enabled && !this.blocking()) this.onLockLost(); }
      if (locked) this.wantLock = true;
    });
    document.addEventListener('pointerlockerror', () => { this.pointerLocked = false; });
  }

  /** Ask for mouse capture (must be called from a user gesture). */
  lock(): void {
    if (this.touch.active || this.pointerLocked) return;
    this.wantLock = true;
    try {
      const p = (this.canvas as any).requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* not allowed right now; a click on the canvas will retry */ }
  }

  unlock(): void {
    this.wantLock = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private releaseAll() {
    for (const a of UI_ACTIONS) if (this.isDown(a)) { this.down.clear(); this.onActionUp(a); }
    this.down.clear();
  }

  private key(e: KeyboardEvent, isDown: boolean) {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing || (isDown && this.blocking())) { if (!isDown) this.setCode(e.code, false); return; }
    if (!this.enabled) return;
    if (isDown && e.repeat) { e.preventDefault(); return; }
    this.device = 'keyboard';
    // keep the browser from scrolling / tabbing away mid-fight
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || (e.code.startsWith('Key') && !e.ctrlKey && !e.metaKey)) e.preventDefault();
    this.setCode(e.code, isDown);
  }

  private setCode(code: string, isDown: boolean) {
    const had = this.down.has(code);
    if (isDown === had) return;
    if (isDown) this.down.add(code); else this.down.delete(code);
    const binds = settings.get().binds;
    for (const a of UI_ACTIONS) {
      if (!binds[a].includes(code)) continue;
      if (isDown) this.onAction(a); else this.onActionUp(a);
    }
  }

  isDown(a: BindAction): boolean {
    const codes = settings.get().binds[a];
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i])) return true;
    return this.padHeld.has(a);
  }

  private pollGamepad(dt: number) {
    this.padButtons = 0; this.padMoveX = 0; this.padMoveY = 0; this.padLookX = 0; this.padLookY = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { pad = p; break; }
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    const b = (i: number) => !!pad!.buttons[i] && (pad!.buttons[i].pressed || pad!.buttons[i].value > 0.4);
    this.padMoveX = dz(pad.axes[0] || 0); this.padMoveY = -dz(pad.axes[1] || 0);
    this.padLookX = dz(pad.axes[2] || 0); this.padLookY = dz(pad.axes[3] || 0);
    let bits = 0;
    if (b(0)) bits |= BTN_JUMP;
    if (b(7)) bits |= BTN_MELEE;
    if (b(6)) bits |= BTN_A1;
    if (b(5)) bits |= BTN_A2;
    if (b(4)) bits |= BTN_A3;
    if (b(1) || b(10)) bits |= BTN_MOVE;
    this.padButtons = bits;
    // menu-ish buttons are edge triggered
    let ui = 0;
    const uiMap: [number, BindAction][] = [[2, 'interact'], [3, 'deploy'], [9, 'menu'], [8, 'scoreboard'], [13, 'hall']];
    uiMap.forEach(([i], k) => { if (b(i)) ui |= 1 << k; });
    uiMap.forEach(([, a], k) => {
      const now = ui & (1 << k), was = this.padPrev & (1 << k);
      if (now && !was) { this.padHeld.add(a); this.onAction(a); }
      if (!now && was) { this.padHeld.delete(a); this.onActionUp(a); }
    });
    this.padPrev = ui;
    if (bits || ui || this.padMoveX || this.padMoveY || this.padLookX || this.padLookY) this.device = 'gamepad';
    void dt;
  }

  /** Per rendered frame: fold look input from every device into yaw/pitch. */
  frame(dt: number): void {
    this.pollGamepad(dt);
    const s = settings.get();
    const y0 = this.yaw, p0 = this.pitch;
    if (this.enabled && !this.blocking()) {
      const inv = s.invertY ? -1 : 1;
      const ms = 0.0023 * s.sensitivity;
      this.yaw -= this.lookX * ms;
      this.pitch -= this.lookY * ms * inv;
      if (this.touch.active) {
        const ts = 0.0052 * s.touchSensitivity;
        this.yaw -= this.touch.lookDX * ts;
        this.pitch -= this.touch.lookDY * ts * inv;
        if (this.touch.lookDX || this.touch.lookDY || this.touch.buttons || this.touch.moveX || this.touch.moveY) this.device = 'touch';
      }
      // response curve: fine control near the centre, fast turns at full tilt
      const curve = (v: number) => v * (0.35 + 0.65 * Math.abs(v));
      this.yaw -= curve(this.padLookX) * 3.4 * s.sensitivity * dt;
      this.pitch -= curve(this.padLookY) * 2.2 * s.sensitivity * dt * inv;
    }
    this.lookX = 0; this.lookY = 0; this.touch.lookDX = 0; this.touch.lookDY = 0;
    this.yaw = wrapAngle(this.yaw);
    this.pitch = clamp(this.pitch, -PITCH_MAX, PITCH_MAX);
    this.turnRate = dt > 0 ? Math.hypot(wrapAngle(this.yaw - y0), this.pitch - p0) / dt : 0;
  }

  /** Nudge the aim toward a point (aim assist). */
  nudge(dyaw: number, dpitch: number): void {
    this.yaw = wrapAngle(this.yaw + dyaw);
    this.pitch = clamp(this.pitch + dpitch, -PITCH_MAX, PITCH_MAX);
  }

  /** Per simulation tick: movement axes and held buttons. */
  sample(out: { mx: number; mz: number; b: number }): void {
    out.mx = 0; out.mz = 0; out.b = 0;
    if (!this.enabled || this.blocking()) return;
    let mx = 0, mz = 0;
    if (this.isDown('right')) mx += 1;
    if (this.isDown('left')) mx -= 1;
    if (this.isDown('forward')) mz += 1;
    if (this.isDown('back')) mz -= 1;
    mx += this.padMoveX; mz += this.padMoveY;
    if (this.touch.active) { mx += this.touch.moveX; mz += this.touch.moveY; }
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    out.mx = mx; out.mz = mz;
    let b = this.padButtons | (this.touch.active ? this.touch.buttons : 0);
    for (const [a, bit] of SIM_ACTIONS) if (this.isDown(a)) b |= bit;
    out.b = b;
  }
}
