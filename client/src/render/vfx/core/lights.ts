// The effects layer owns exactly three point lights, created once (the number of lights in the
// scene must never change – that would recompile every material). Flashes borrow the dimmest one.

import * as THREE from 'three';

class Slot {
  readonly light: THREE.PointLight;
  peak = 0; t = 0; attack = 0.02; decay = 0.3; hold = 0;
  /** Sustained lights are re-requested every frame (falling meteor, charging beam). */
  sustain = 0; sustainKey = 0; keep = 0;
  constructor() {
    this.light = new THREE.PointLight(0xffffff, 0, 20, 2);
    this.light.castShadow = false;
  }
}

export class Lights {
  private readonly slots: Slot[] = [];
  /** Global intensity scale (tuned so `intensity` 1 ≈ a torch, 10 ≈ a meteor strike). */
  scale = 4.5;

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 3; i++) { const s = new Slot(); this.slots.push(s); scene.add(s.light); }
  }

  private current(s: Slot): number {
    if (s.sustain > 0) return s.sustain;
    if (s.peak <= 0) return 0;
    if (s.t < s.attack) return s.peak * (s.t / s.attack);
    const d = s.t - s.attack - s.hold;
    return d <= 0 ? s.peak : s.peak * Math.exp(-d / s.decay);
  }

  /** One-shot flash. Steals the dimmest light only if this flash is brighter than what it shows. */
  flash(x: number, y: number, z: number, color: THREE.Color, intensity: number, radius: number, decay = 0.25, hold = 0): void {
    let best: Slot | null = null, bestI = Infinity;
    for (const s of this.slots) { const c = this.current(s); if (c < bestI) { bestI = c; best = s; } }
    if (!best || bestI > intensity) return;
    best.light.position.set(x, y, z);
    best.light.color.copy(color);
    best.light.distance = radius;
    best.peak = intensity; best.t = 0; best.decay = decay; best.hold = hold; best.sustain = 0; best.sustainKey = 0; best.keep = 0;
  }

  /**
   * Sustained light for a continuous source. Call every frame with the same non-zero key;
   * it fades out by itself as soon as the calls stop.
   */
  hold(key: number, x: number, y: number, z: number, color: THREE.Color, intensity: number, radius: number): void {
    let slot: Slot | null = null;
    for (const s of this.slots) if (s.sustainKey === key) { slot = s; break; }
    if (!slot) {
      let bestI = Infinity;
      for (const s of this.slots) { const c = this.current(s); if (c < bestI) { bestI = c; slot = s; } }
      if (!slot || bestI > intensity) return;
      slot.sustainKey = key;
    }
    slot.light.position.set(x, y, z);
    slot.light.color.copy(color);
    slot.light.distance = radius;
    slot.sustain = intensity; slot.peak = intensity; slot.t = slot.attack; slot.hold = 0; slot.decay = 0.12; slot.keep = 2;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      const i = this.current(s);
      s.light.intensity = i * this.scale;
      if (s.sustain > 0) { s.sustain = 0; s.peak = i; s.t = s.attack; s.hold = 0; }
      else { s.t += dt; if (s.peak > 0 && this.current(s) < 0.01) s.peak = 0; }
      if (s.keep > 0 && --s.keep === 0) s.sustainKey = 0;
    }
  }

  clear(): void { for (const s of this.slots) { s.peak = 0; s.sustain = 0; s.sustainKey = 0; s.light.intensity = 0; } }

  dispose(): void { for (const s of this.slots) { this.scene.remove(s.light); s.light.dispose(); } }
}
