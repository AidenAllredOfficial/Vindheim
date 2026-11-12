// The game camera: an over-the-shoulder boom that never clips through the world, plus the
// title fly-over, the death orbit and the pedestal close-up, with trauma-based shake.

import * as THREE from 'three';
import { clamp, dirFromYawPitch, noise2, lerp } from '@shared/math';
import type { World } from '@shared/world';
import { HALL } from '@shared/world';
import { CAM_DIST, CAM_HEIGHT, CAM_SIDE } from '@shared/sim/aim';
import { settings } from '../settings';

export type CamMode = 'title' | 'follow' | 'death' | 'inspect';

const v = new THREE.Vector3();
const look = new THREE.Vector3();
const mat = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'title';
  /** Current boom length (shrinks against walls). */
  dist = CAM_DIST;
  /** Extra field of view that decays (dashes, big hits). */
  private fovKick = 0;
  private trauma = 0;
  private pivotY = 0;
  private hasPivot = false;
  private side = CAM_SIDE;
  private blend = 1;
  private fromPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private goalPos = new THREE.Vector3();
  private goalQuat = new THREE.Quaternion();
  private dummy = new THREE.Object3D();
  private deathAngle = 0;
  private deathH = 3.4;
  private inspectPos = new THREE.Vector3();
  private inspectLook = new THREE.Vector3();
  private time = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(settings.get().fov, 16 / 9, 0.12, 2600);
    this.camera.position.set(0, 40, 120);
  }

  setMode(mode: CamMode): void {
    if (mode === this.mode) return;
    // glide from wherever the camera is into the new behaviour
    this.fromPos.copy(this.camera.position); this.fromQuat.copy(this.camera.quaternion);
    this.blend = 0;
    this.mode = mode;
    this.hasPivot = false;
  }

  /** Cut instantly (teleports, respawns). */
  cut(): void { this.blend = 1; this.hasPivot = false; }

  shake(amount: number): void { this.trauma = clamp(this.trauma + amount * settings.get().screenShake, 0, 1); }
  kick(amount: number): void { this.fovKick = Math.min(14, this.fovKick + amount); }

  setInspect(px: number, py: number, pz: number, side: number): void {
    // stand in the aisle, a little to one side, looking at the emblem above the pedestal
    this.inspectPos.set(px - side * 4.2, py + 1.35, pz + 1.5);
    // aim a little past the pedestal so it sits left of centre, clear of the side panel
    this.inspectLook.set(px, py + 1.05, pz + side * 1.0);
  }

  private goalFromLook(px: number, py: number, pz: number, lx: number, ly: number, lz: number) {
    this.goalPos.set(px, py, pz);
    // camera convention: -Z looks at the target
    look.set(lx, ly, lz);
    this.goalQuat.setFromRotationMatrix(mat.lookAt(this.goalPos, look, UP));
  }

  /**
   * @param fx,fy,fz feet position of the followed fighter (render-interpolated)
   * @param yaw,pitch aim
   */
  update(dt: number, world: World, fx: number, fy: number, fz: number, yaw: number, pitch: number, aspect: number): void {
    this.time += dt;
    const cam = this.camera;
    if (this.mode === 'follow') {
      // smooth the pivot height so stepping up ledges does not jolt the view
      const targetY = fy + CAM_HEIGHT;
      if (!this.hasPivot) { this.pivotY = targetY; this.hasPivot = true; this.dist = CAM_DIST; }
      else this.pivotY += (targetY - this.pivotY) * Math.min(1, dt * 16);
      if (Math.abs(targetY - this.pivotY) > 3) this.pivotY = targetY;
      // pull the shoulder offset in when it would poke through a wall
      const sx = Math.cos(yaw), sz = -Math.sin(yaw);
      const wantSide = world.solidAt(fx + sx * (CAM_SIDE + 0.25), this.pivotY, fz + sz * (CAM_SIDE + 0.25), 0.2) ? 0 : CAM_SIDE;
      this.side += (wantSide - this.side) * Math.min(1, dt * 10);
      const px = fx + sx * this.side, py = this.pivotY, pz = fz + sz * this.side;
      const d = dirFromYawPitch(yaw, pitch);
      const hit = world.raycast(px, py, pz, -d.x, -d.y, -d.z, CAM_DIST, 0.22);
      const want = hit ? Math.max(0.5, hit.t - 0.12) : CAM_DIST;
      // snap in fast (never see through walls), ease back out
      this.dist = want < this.dist ? lerp(this.dist, want, Math.min(1, dt * 28)) : lerp(this.dist, want, Math.min(1, dt * 5));
      if (this.dist > want + 0.6) this.dist = want;
      this.goalFromLook(px - d.x * this.dist, py - d.y * this.dist, pz - d.z * this.dist, px + d.x * 40, py + d.y * 40, pz + d.z * 40);
    } else if (this.mode === 'death') {
      this.deathAngle += dt * 0.35;
      const r = 6.5;
      let h = 3.4;
      let cx = fx + Math.cos(this.deathAngle) * r, cz = fz + Math.sin(this.deathAngle) * r;
      const base = Math.max(fy, -6);
      const hit = world.raycast(fx, base + 1.6, fz, (cx - fx) / r, 0.3, (cz - fz) / r, r, 0.3);
      if (hit) {
        // something is in the way: come in closer and rise above it instead of staring at a rock
        const k = Math.max(0.25, (hit.t - 0.6) / r);
        cx = fx + (cx - fx) * k; cz = fz + (cz - fz) * k; h += (1 - k) * 4.5;
      }
      this.deathH += (h - this.deathH) * Math.min(1, dt * 4);
      this.goalFromLook(cx, base + this.deathH, cz, fx, base + 1.0, fz);
    } else if (this.mode === 'inspect') {
      this.goalFromLook(this.inspectPos.x, this.inspectPos.y, this.inspectPos.z, this.inspectLook.x, this.inspectLook.y, this.inspectLook.z);
    } else {
      // title: a slow, wide orbit that takes in both islands, drifting in height
      const t = this.time * 0.035;
      const r = 104 + Math.sin(t * 1.7) * 14;
      const px = Math.sin(t) * r, pz = 6 + Math.cos(t) * r * 0.9;
      const py = 30 + Math.sin(t * 2.3) * 9;
      const towardHall = clamp(-pz / 90, 0, 1);
      this.goalFromLook(px, py, pz, lerp(0, HALL.cx, towardHall * 0.5), lerp(4, 12, towardHall), lerp(-6, -60, towardHall));
    }

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / (this.mode === 'title' ? 1.6 : 0.55));
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      cam.position.lerpVectors(this.fromPos, this.goalPos, k);
      cam.quaternion.slerpQuaternions(this.fromQuat, this.goalQuat, k);
    } else {
      cam.position.copy(this.goalPos);
      cam.quaternion.copy(this.goalQuat);
    }

    // shake: rotational, driven by smooth noise, strength = trauma²
    if (this.trauma > 0.001) {
      const s = this.trauma * this.trauma;
      const t = this.time * 28;
      const ax = (noise2(t, 1.3, 11) - 0.5) * 2, ay = (noise2(t, 5.7, 23) - 0.5) * 2, az = (noise2(t, 9.1, 37) - 0.5) * 2;
      this.dummy.quaternion.setFromEuler(new THREE.Euler(ax * 0.05 * s, ay * 0.05 * s, az * 0.035 * s));
      cam.quaternion.multiply(this.dummy.quaternion);
      cam.position.x += ay * 0.12 * s; cam.position.y += ax * 0.12 * s;
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
    }

    const baseFov = settings.get().fov;
    this.fovKick *= Math.max(0, 1 - dt * 5.5);
    // keep the horizontal view sensible on tall (portrait) screens
    const fov = aspect < 1 ? clamp(baseFov * (1 + (1 - aspect) * 0.5), baseFov, 100) : baseFov;
    const want = fov + this.fovKick;
    if (Math.abs(cam.fov - want) > 0.01 || cam.aspect !== aspect) { cam.fov = want; cam.aspect = aspect; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  /** Project a world point to CSS pixels. Returns false if behind the camera. */
  project(x: number, y: number, z: number, width: number, height: number, out: { x: number; y: number }): boolean {
    v.set(x, y, z).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * width;
    out.y = (-v.y * 0.5 + 0.5) * height;
    return v.z < 1 && v.z > -1;
  }

  forward(out: THREE.Vector3): THREE.Vector3 { return this.camera.getWorldDirection(out); }
}

