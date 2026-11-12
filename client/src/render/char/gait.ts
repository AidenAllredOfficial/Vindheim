// Foot planting. Feet are planted in WORLD space: a planted foot does not move until it lifts,
// so there is no sliding whatever the body does above it. While moving, a gait clock decides when
// each foot lifts and where it lands (stride length x cadence = ground speed). At rest the feet
// take corrective steps toward the stance the current pose asks for.

import { ANKLE_Y, BALL_FWD, HIP_X } from './rig';
import { clamp, clamp01, lerp, smooth, wrapAngle, easeInOut, TAU } from './mathx';

export interface FootOut {
  /** Ball-of-foot position in root space, yaw (rad, left +) and heel-lift pitch (rad, toes down +). */
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** True while the foot is on the ground and bearing weight. */
  planted: boolean;
}

class Foot implements FootOut {
  x = 0; y = 0; z = 0; yaw = 0; pitch = 0;
  planted = true;
  // world plant
  wx = 0; wz = 0; wyaw = 0;
  // swing
  sx = 0; sz = 0; sy = 0; syaw = 0; sPitch = 0;
  swT = 1; swDur = 0.2; swH = 0.08;
  /** Set once at touchdown; consumed by the owner (footstep events). */
  landed = false;
  /** Posed directly by the animation (off the ground); the gait does not own it. */
  free = false;
  /** Current world position / yaw while swinging. */
  cwx = 0; cwz = 0; cwyaw = 0;
  /** Restart the swing from where the foot is now (the destination changed). */
  rebase(minDur: number): void {
    this.sx = this.cwx; this.sz = this.cwz; this.sy = this.y; this.syaw = this.cwyaw; this.sPitch = this.pitch;
    this.swDur = Math.max(minDur, (1 - Math.min(1, this.swT)) * this.swDur);
    this.swT = 0; this.swH = Math.min(this.swH, 0.03);
  }
}

export interface GaitIn {
  dt: number;
  /** World position and facing yaw of the root. */
  px: number; pz: number; face: number;
  vx: number; vz: number;
  grounded: boolean;
  /** No stepping at all (rooted, frozen). */
  locked: boolean;
  /** Stance the pose wants: ball offsets [right, forward, yawLeftRad] for L and R in root space. */
  homeL: [number, number, number]; homeR: [number, number, number];
  /** Hip joint height above the ground and hips offset (root space), for reach limits. */
  hipY: number; hipX: number; hipZ: number;
  /** Extra lower-body yaw the animation already applies (rad). */
  speedScale: number;
}

const STEP_TOL = 0.13, YAW_TOL = 0.6;

export class Gait {
  readonly feet: [Foot, Foot] = [new Foot(), new Foot()];
  phase = 0;
  moving = false;
  backward = false;
  /** Lower-body yaw toward the direction of travel (rad, left +), smoothed. */
  hipYaw = 0;
  /** 0..1 how fast we are going (0 = walk pace, 1 = full run). */
  k = 0;
  duty = 0.5;
  cadence = 0;
  /** Local travel direction (right, forward), unit, valid while moving. */
  mR = 0; mF = 1;
  private stepCool = 0;
  private inited = false;

  /** Put both feet under the body right now (spawn, teleport). */
  reset(i: GaitIn): void {
    const c = Math.cos(i.face), s = Math.sin(i.face);
    const homes = [i.homeL, i.homeR];
    for (let f = 0; f < 2; f++) {
      const ft = this.feet[f], h = homes[f];
      // local (right, forward) -> world
      ft.wx = i.px + h[0] * c - h[1] * s;
      ft.wz = i.pz - h[0] * s - h[1] * c;
      ft.wyaw = i.face + h[2];
      ft.planted = true; ft.swT = 1; ft.free = false; ft.pitch = 0; ft.y = 0; ft.landed = false;
    }
    this.moving = false; this.hipYaw = 0; this.inited = true; this.stepCool = 0;
    this.write(i);
  }

  /** The animation released a posed foot: carry on from where it is (root-space ball position). */
  release(f: number, i: GaitIn, lx: number, ly: number, lz: number, lyaw: number): void {
    const ft = this.feet[f];
    const c = Math.cos(i.face), s = Math.sin(i.face);
    // root space (x right, z back) -> world
    const wx = i.px + lx * c + lz * s, wz = i.pz - lx * s + lz * c;
    ft.free = false;
    if (ly < 0.03 && i.grounded) {
      ft.wx = wx; ft.wz = wz; ft.wyaw = i.face + lyaw; ft.planted = true; ft.swT = 1; ft.pitch = 0;
    } else {
      ft.sx = wx; ft.sz = wz; ft.sy = Math.max(0, ly); ft.syaw = i.face + lyaw; ft.sPitch = ft.pitch;
      ft.cwx = wx; ft.cwz = wz; ft.cwyaw = ft.syaw; ft.y = ft.sy;
      ft.planted = false; ft.swT = 0; ft.swDur = clamp(0.1 + ly * 0.25, 0.1, 0.24); ft.swH = 0.02;
    }
  }

  private beginSwing(f: number, dur: number, height: number): void {
    const ft = this.feet[f];
    ft.sx = ft.wx; ft.sz = ft.wz; ft.sy = 0; ft.syaw = ft.wyaw; ft.sPitch = ft.pitch;
    ft.planted = false; ft.swT = 0; ft.swDur = Math.max(0.07, dur); ft.swH = height;
  }

  update(i: GaitIn): void {
    if (!this.inited) this.reset(i);
    const dt = i.dt;
    const c = Math.cos(i.face), s = Math.sin(i.face);
    const speed = Math.hypot(i.vx, i.vz);
    // local velocity (right, forward)
    const vF = -i.vx * s - i.vz * c, vR = i.vx * c - i.vz * s;
    const wantMove = i.grounded && !i.locked && speed > 0.55;
    const homes = [i.homeL, i.homeR];
    this.stepCool -= dt;

    // ---- lower-body yaw toward the travel direction
    let hipYawT = 0;
    if (wantMove) {
      const alpha = Math.atan2(vR, vF); // 0 forward, + to the right
      const aa = Math.abs(alpha);
      if (this.backward ? aa < 1.4 : aa > 1.75) this.backward = !this.backward;
      const turn = this.backward ? alpha - Math.sign(alpha || 1) * Math.PI : alpha;
      hipYawT = -turn * 0.62 * smooth(0.6, 2.5, speed);
      this.mR = vR / speed; this.mF = vF / speed;
    }
    this.hipYaw += (hipYawT - this.hipYaw) * (1 - Math.exp(-12 * dt));

    const k = clamp01((speed - 1.2) / 6);
    this.k = wantMove ? k : 0;
    const duty = lerp(0.5, 0.27, smooth(1.2, 7.2, speed));
    const stanceLen = (0.6 + 0.13 * k) * (i.speedScale || 1);
    const stride = stanceLen / duty;
    const cadence = wantMove ? speed / stride : 0;
    this.duty = duty; this.cadence = cadence;
    const lat = lerp(0.115, 0.078, k);
    // lower-body frame (for lateral foot placement)
    const hy = i.face + this.hipYaw;
    const hrx = Math.cos(hy), hrz = -Math.sin(hy); // world "right" of the hips
    const mx = wantMove ? i.vx / speed : 0, mz = wantMove ? i.vz / speed : 0;

    if (wantMove) {
      if (!this.moving) {
        for (const ft of this.feet) if (!ft.planted && !ft.free) ft.rebase(0.1);
        // start with the rearmost foot
        const a0 = (this.feet[0].wx - i.px) * mx + (this.feet[0].wz - i.pz) * mz;
        const a1 = (this.feet[1].wx - i.px) * mx + (this.feet[1].wz - i.pz) * mz;
        this.phase = (a0 < a1 ? duty : 0.5 + duty) - 0.002;
        this.moving = true;
      }
      const prev = this.phase;
      this.phase = (this.phase + cadence * dt) % 1;
      for (let f = 0; f < 2; f++) {
        const ft = this.feet[f];
        if (ft.free) continue;
        const fp = (this.phase - f * 0.5 + 1) % 1;
        const fpPrev = (prev - f * 0.5 + 1) % 1;
        const side = f === 0 ? -1 : 1;
        if (ft.planted) {
          // lift-off at the end of stance, or early if the leg cannot reach any more
          const dx = ft.wx - i.px, dz = ft.wz - i.pz;
          const behind = -(dx * mx + dz * mz);
          // would the leg have to stretch past its length to keep this foot down?
          ft.x = dx * c - dz * s; ft.z = dx * s + dz * c; ft.yaw = wrapAngle(ft.wyaw - i.face);
          ft.pitch = smooth(0.08, 0.44, behind) * 0.98;
          Gait.ankle(ft, _an);
          const reach = Math.hypot(_an.x - (i.hipX + (f === 0 ? -HIP_X : HIP_X)), _an.y - i.hipY, _an.z - i.hipZ);
          const reachOut = behind > 0.05 && reach > 0.822;
          if ((fp >= duty && (fpPrev < duty || fpPrev > fp)) || reachOut || (fp >= duty && fp < 0.97 && behind > 0.2)) {
            const remain = fp >= duty ? (1 - fp) / cadence : (1 - duty) * 0.5 / cadence;
            this.beginSwing(f, clamp(remain, 0.08, 0.45), 0.07 + 0.2 * k);
          }
        }
        if (!ft.planted) {
          ft.swT += dt / ft.swDur;
          const rem = Math.max(0, (1 - ft.swT) * ft.swDur);
          const lead = stanceLen * 0.5 - 0.06;
          const lx = i.px + i.vx * rem + mx * lead + hrx * side * lat;
          const lz = i.pz + i.vz * rem + mz * lead + hrz * side * lat;
          const u = easeInOut(clamp01(ft.swT));
          if (ft.swT >= 1) {
            ft.wx = lx; ft.wz = lz; ft.wyaw = hy + side * -0.1; ft.planted = true; ft.landed = true; ft.pitch = 0;
          } else {
            const wx = lerp(ft.sx, lx, u), wz = lerp(ft.sz, lz, u);
            this.swingOut(ft, i, wx, wz, hy + side * -0.1, k);
          }
        }
      }
    } else {
      if (this.moving) for (const ft of this.feet) if (!ft.planted && !ft.free) ft.rebase(0.12);
      this.moving = false;
      // rest: settle swinging feet on their homes; take corrective steps
      let worst = -1, worstErr = 0;
      for (let f = 0; f < 2; f++) {
        const ft = this.feet[f];
        if (ft.free) continue;
        const h = homes[f];
        const hx = i.px + h[0] * c - h[1] * s, hz = i.pz - h[0] * s - h[1] * c, hyaw = i.face + h[2];
        if (!ft.planted) {
          ft.swT += dt / ft.swDur;
          if (ft.swT >= 1 || !i.grounded) {
            if (i.grounded) { ft.wx = hx; ft.wz = hz; ft.wyaw = hyaw; ft.planted = true; ft.landed = true; ft.pitch = 0; this.stepCool = 0.05; }
            else { ft.swT = Math.min(ft.swT, 0.999); this.swingOut(ft, i, lerp(ft.sx, hx, easeInOut(clamp01(ft.swT))), lerp(ft.sz, hz, easeInOut(clamp01(ft.swT))), hyaw, 0); }
          } else {
            const u = easeInOut(clamp01(ft.swT));
            this.swingOut(ft, i, lerp(ft.sx, hx, u), lerp(ft.sz, hz, u), hyaw, 0);
          }
        } else if (!i.locked && i.grounded) {
          const err = Math.hypot(ft.wx - hx, ft.wz - hz) + Math.max(0, Math.abs(wrapAngle(ft.wyaw - hyaw)) - YAW_TOL * 0.5) * 0.3;
          const far = Math.hypot(ft.wx - i.px, ft.wz - i.pz) > 0.7;
          if ((err > STEP_TOL || far) && err > worstErr) { worst = f; worstErr = err; }
        }
      }
      if (worst >= 0 && this.stepCool <= 0 && this.feet[1 - worst].planted) {
        this.beginSwing(worst, clamp(0.16 + worstErr * 0.16, 0.16, 0.3), clamp(0.04 + worstErr * 0.12, 0.04, 0.12));
        this.stepCool = 0.02;
      } else if (worst >= 0 && this.stepCool <= 0 && !this.feet[1 - worst].planted && this.feet[1 - worst].free) {
        this.beginSwing(worst, 0.2, 0.06);
      }
    }
    this.write(i);
  }

  private swingOut(ft: Foot, i: GaitIn, wx: number, wz: number, yaw: number, k: number): void {
    const u = clamp01(ft.swT);
    const c = Math.cos(i.face), s = Math.sin(i.face);
    const dx = wx - i.px, dz = wz - i.pz;
    ft.x = dx * c - dz * s; ft.z = dx * s + dz * c;
    ft.y = ft.sy * (1 - u) * (1 - u) + ft.swH * Math.sin(Math.PI * Math.pow(u, 0.8));
    ft.cwx = wx; ft.cwz = wz;
    ft.cwyaw = lerp(0, wrapAngle(yaw - ft.syaw), u) + ft.syaw;
    ft.yaw = wrapAngle(ft.cwyaw - i.face);
    // heel kicks up after toe-off, toes level again for the landing
    const kick = (0.5 + 0.75 * k);
    const prof = u < 0.3 ? lerp(ft.sPitch, kick, u / 0.3) : lerp(kick, 0, smooth(0.3, 0.92, u));
    ft.pitch = prof;
  }

  /** World plant -> root space outputs for planted feet. */
  private write(i: GaitIn): void {
    const c = Math.cos(i.face), s = Math.sin(i.face);
    for (let f = 0; f < 2; f++) {
      const ft = this.feet[f];
      if (!ft.planted || ft.free) continue;
      const dx = ft.wx - i.px, dz = ft.wz - i.pz;
      ft.x = dx * c - dz * s; ft.z = dx * s + dz * c; ft.y = 0;
      ft.yaw = wrapAngle(ft.wyaw - i.face);
      // heel rises as the foot trails behind the hip
      const fx = -Math.sin(ft.yaw), fz = -Math.cos(ft.yaw); // foot forward in root space
      const hipX = f === 0 ? -HIP_X : HIP_X;
      const behind = -((ft.x - hipX) * fx + ft.z * fz);
      const target = smooth(0.08, 0.44, behind) * 0.98 * (this.moving ? 1 : 0.5);
      // while running the heel must follow the leg exactly; at rest it eases
      if (this.moving) ft.pitch = target; else ft.pitch += (target - ft.pitch) * (1 - Math.exp(-30 * i.dt));
      // never ask the leg to stretch: lift the heel as far as it takes
      if (behind > 0) {
        for (let it = 0; it < 8; it++) {
          Gait.ankle(ft, _an);
          if (Math.hypot(_an.x - (i.hipX + hipX), _an.y - i.hipY, _an.z - i.hipZ) < 0.815 || ft.pitch > 1.15) break;
          ft.pitch += 0.12;
        }
      }
    }
  }

  /** Ankle position (root space) for a foot output. */
  static ankle(f: FootOut, out: { x: number; y: number; z: number }): void {
    // ankle = ball + Ry(yaw) Rx(-pitch) (0, ANKLE_Y, BALL_FWD)
    const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
    const ly = ANKLE_Y * cp + BALL_FWD * sp, lz = -ANKLE_Y * sp + BALL_FWD * cp;
    const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
    out.x = f.x + lz * sy; out.y = f.y + ly; out.z = f.z + lz * cy;
  }
}

const _an = { x: 0, y: 0, z: 0 };
export const GAIT_TAU = TAU;
