// Lights owned by the environment: the moon (the only shadow caster, with a texel-snapped shadow
// box that follows the focus), a hemisphere fill, and ONE warm point light that lives at whichever
// brazier is nearest the focus. The light count never changes after construction.
import * as THREE from 'three';
import { hash1, noise2 } from '@shared/math';
import { HALL } from '@shared/world';
import type { Weather } from '@shared/weather';
import { MAX_WARM, MOON_COLOR, MOON_DIR, WARM_COLOR, type EnvQuality, type SharedUniforms } from './common';
import type { WarmSource } from './props';

const MOON_INTENSITY = 2.9;
const HEMI_INTENSITY = 0.95;
export const ENV_INTENSITY = 0.85;
const FIRE_INTENSITY = 15;

export class Lighting {
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fire: THREE.PointLight;
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private centre = new THREE.Vector3();
  private range = 60;
  private mapSize = 2048;
  private active = -1;       // index into `sources` of the brazier hosting the point light
  private pending = -1;
  private blend = 0;         // 0 = light off (moving), 1 = fully on
  /** 0 outdoors .. 1 deep inside the hall (fill is dimmed so firelight can carry the room). */
  indoors = 0;

  constructor(private scene: THREE.Scene, private sources: WarmSource[], q: EnvQuality, shadows: boolean) {
    this.moon = new THREE.DirectionalLight(MOON_COLOR, MOON_INTENSITY);
    this.moon.name = 'env-moon';
    this.right.crossVectors(new THREE.Vector3(0, 1, 0), MOON_DIR).normalize();
    this.up.crossVectors(MOON_DIR, this.right).normalize();
    this.moon.shadow.bias = -0.0005;
    this.moon.shadow.normalBias = 0.06;
    this.moon.shadow.radius = 2.2;
    scene.add(this.moon, this.moon.target);

    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.2, 0.33, 0.62), new THREE.Color(0.1, 0.08, 0.1), HEMI_INTENSITY);
    this.hemi.name = 'env-hemi';
    scene.add(this.hemi);

    this.fire = new THREE.PointLight(WARM_COLOR, 0, 20, 2);
    this.fire.name = 'env-fire';
    this.fire.castShadow = false;
    scene.add(this.fire);

    this.applyQuality(q, shadows);
    this.snap(new THREE.Vector3());
  }

  applyQuality(q: EnvQuality, shadows: boolean): void {
    this.range = q.shadowRange;
    const s = this.moon.shadow;
    if (this.moon.castShadow !== shadows) this.moon.castShadow = shadows;
    if (this.mapSize !== q.shadowSize || s.mapSize.x !== q.shadowSize) {
      this.mapSize = q.shadowSize;
      s.mapSize.set(q.shadowSize, q.shadowSize);
      if (s.map) { s.map.dispose(); s.map = null; }
    }
    const cam = s.camera;
    cam.left = -this.range; cam.right = this.range; cam.top = this.range; cam.bottom = -this.range;
    cam.near = 1; cam.far = 420;
    cam.updateProjectionMatrix();
    s.needsUpdate = true;
  }

  /** Move the shadow box to the focus in whole shadow texels, so shadow edges never shimmer. */
  private snap(focus: THREE.Vector3): void {
    const texel = (this.range * 2) / this.mapSize;
    const fx = Math.round(focus.dot(this.right) / texel) * texel;
    const fy = Math.round(focus.dot(this.up) / texel) * texel;
    const fz = focus.dot(MOON_DIR);
    this.centre.set(0, 0, 0).addScaledVector(this.right, fx).addScaledVector(this.up, fy).addScaledVector(MOON_DIR, fz);
    this.moon.target.position.copy(this.centre);
    this.moon.position.copy(this.centre).addScaledVector(MOON_DIR, 210);
    this.moon.target.updateMatrixWorld();
    this.moon.updateMatrixWorld();
  }

  update(dt: number, time: number, focus: THREE.Vector3, weather: Weather, flash: number, shared: SharedUniforms): void {
    this.snap(focus);
    // inside the hall footprint the sky fill backs off
    const m = 1.2;
    const inside = focus.x > HALL.minX + m && focus.x < HALL.maxX - m && focus.z > HALL.minZ + m && focus.z < HALL.maxZ - m && focus.y < HALL.roofY1 + 0.5 && focus.y > HALL.baseY - 1;
    this.indoors += ((inside ? 1 : 0) - this.indoors) * Math.min(1, dt * 2.2);
    const overcast = Math.min(1, weather.fog * 0.8 + weather.storm * 0.5);
    this.moon.intensity = MOON_INTENSITY * (1 - overcast * 0.55);
    this.hemi.intensity = HEMI_INTENSITY * (1 - this.indoors * 0.82) * (1 - weather.storm * 0.25) + flash * 1.1;
    this.scene.environmentIntensity = ENV_INTENSITY * (1 - this.indoors * 0.86) * (1 - overcast * 0.3);

    // ---- warm sources: flicker, and hand the real point light to the nearest fire
    let best = -1, bestD = 1e12;
    const src = this.sources;
    for (let i = 0; i < src.length; i++) {
      if (src[i].kind !== 'fire') continue;
      const dx = src[i].x - focus.x, dy = src[i].y - focus.y, dz = src[i].z - focus.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD > 60 * 60) best = -1;
    if (this.active < 0 && best >= 0 && this.blend <= 0) { this.active = best; }
    if (best !== this.active) {
      // a little hysteresis so the light does not ping-pong between two equidistant fires
      const cur = this.active >= 0 ? (src[this.active].x - focus.x) ** 2 + (src[this.active].y - focus.y) ** 2 + (src[this.active].z - focus.z) ** 2 : 1e12;
      this.pending = best < 0 || bestD < cur * 0.72 ? best : this.active;
    } else this.pending = this.active;
    if (this.pending !== this.active) {
      this.blend = Math.max(0, this.blend - dt * 4.5);
      if (this.blend <= 0) this.active = this.pending;
    } else this.blend = Math.min(1, this.blend + dt * 3);
    const wind = 1 + weather.wind * 0.8;
    const n = Math.min(src.length, MAX_WARM);
    for (let i = 0; i < n; i++) {
      const s = src[i];
      let k = 1;
      if (s.kind === 'fire') {
        const f = noise2(time * 5.3 * wind + i * 17.1, i * 3.7, 77);
        const f2 = hash1(Math.floor(time * 13 + i * 5), 31);
        k = 0.74 + 0.4 * f + 0.07 * f2;
        if (i === this.active) {
          this.fire.position.set(s.x, s.y + 0.15, s.z);
          this.fire.intensity = FIRE_INTENSITY * k * this.blend * (s.radius > 12 ? 1.25 : 1);
          this.fire.distance = s.radius * 1.9;
          k *= 1 - 0.8 * this.blend; // the real light takes over for this one
        }
      } else {
        k = 0.86 + 0.14 * Math.sin(time * 1.4 + i * 2.1);
      }
      shared.uWarmPos.value[i].set(s.x, s.y, s.z, s.radius);
      shared.uWarmCol.value[i].set(s.color[0] * k, s.color[1] * k, s.color[2] * k);
    }
    if (this.active < 0) this.fire.intensity = 0;
  }

  dispose(): void {
    this.scene.remove(this.moon, this.moon.target, this.hemi, this.fire);
    this.moon.shadow.map?.dispose();
    this.moon.dispose(); this.hemi.dispose(); this.fire.dispose();
  }
}
