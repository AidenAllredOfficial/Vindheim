// Small math helpers for the character system (allocation-free where it matters).

import { Matrix4, Quaternion, Vector3 } from 'three';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
/** Frame-rate independent exponential approach. */
export const damp = (cur: number, target: number, lambda: number, dt: number): number =>
  cur + (target - cur) * (1 - Math.exp(-lambda * dt));
export const dampAngle = (cur: number, target: number, lambda: number, dt: number): number =>
  cur + wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt));

/** Ease helpers on 0..1. */
export const easeOut = (u: number, p = 3): number => 1 - Math.pow(1 - clamp01(u), p);
export const easeIn = (u: number, p = 2): number => Math.pow(clamp01(u), p);
export const easeInOut = (u: number): number => { u = clamp01(u); return u * u * (3 - 2 * u); };

/** A scalar spring (position + velocity). */
export class Spring {
  x = 0; v = 0;
  constructor(x = 0) { this.x = x; }
  /** Critically damped move toward target (exact, unconditionally stable). */
  crit(target: number, omega: number, dt: number): number {
    const d = this.x - target;
    const e = Math.exp(-omega * dt);
    const tmp = (this.v + omega * d) * dt;
    this.v = (this.v - omega * tmp) * e;
    this.x = target + (d + tmp) * e;
    return this.x;
  }
  /** Under-damped spring (zeta < 1 overshoots). Sub-stepped semi-implicit Euler. */
  step(target: number, freqHz: number, zeta: number, dt: number): number {
    const w = freqHz * TAU;
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      this.v += (-w * w * (this.x - target) - 2 * zeta * w * this.v) * h;
      this.x += this.v * h;
      left -= h;
    }
    return this.x;
  }
  kick(impulse: number): void { this.v += impulse; }
  reset(x = 0): void { this.x = x; this.v = 0; }
}

/** mulberry32 */
export const makeRng = (seed: number): (() => number) => {
  let s = (seed >>> 0) || 1;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const hash11 = (n: number): number => {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Smooth 1D value noise in -1..1. */
export const noise1 = (x: number, seed = 0): number => {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash11(i * 7919 + seed * 104729), b = hash11((i + 1) * 7919 + seed * 104729);
  return (a + (b - a) * u) * 2 - 1;
};

const _m = new Matrix4();
const _vx = new Vector3(), _vy = new Vector3(), _vz = new Vector3();
const _qa = new Quaternion(), _qb = new Quaternion(), _qc = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0), Y_AXIS = new Vector3(0, 1, 0), Z_AXIS = new Vector3(0, 0, 1);

/**
 * Body-style Euler in degrees: pitch (lean forward +), yaw (turn left +), roll (lean right +).
 * The character faces -Z, +X is its right.
 */
export const qEuler = (out: Quaternion, pitchFwd: number, yawLeft: number, rollRight: number): Quaternion => {
  out.setFromAxisAngle(Y_AXIS, yawLeft * DEG);
  if (pitchFwd !== 0) out.multiply(_qa.setFromAxisAngle(X_AXIS, -pitchFwd * DEG));
  if (rollRight !== 0) out.multiply(_qb.setFromAxisAngle(Z_AXIS, -rollRight * DEG));
  return out;
};

/** Quaternion from an orthonormal basis. */
export const qBasis = (out: Quaternion, x: Vector3, y: Vector3, z: Vector3): Quaternion => {
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
};

/** Slerp that also extrapolates (t outside 0..1) and always takes the short way. */
export const slerpU = (out: Quaternion, a: Quaternion, b: Quaternion, t: number): Quaternion => {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0: number, s1: number;
  if (cos > 0.9995) { s0 = 1 - t; s1 = t; } else {
    const th = Math.acos(cos), sn = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / sn; s1 = Math.sin(t * th) / sn;
  }
  out.set(a.x * s0 + bx * s1, a.y * s0 + by * s1, a.z * s0 + bz * s1, a.w * s0 + bw * s1);
  return out.normalize();
};

/** out = slerp(identity, q, t) */
export const qScale = (out: Quaternion, q: Quaternion, t: number): Quaternion => {
  _qc.set(0, 0, 0, 1);
  return slerpU(out, _qc, q, t);
};

/**
 * Analytic two-bone IK. Bones point along local -Y at rest and hinge about local X.
 * a: root joint, t: target for the end joint, pole: direction the middle joint should point.
 * flip = false for arms (elbow hinge), true for legs (knee hinge).
 * Results are orientations in the same space a/t/pole are given in.
 */
const _d = new Vector3(), _mm = new Vector3(), _e = new Vector3(), _s1 = new Vector3(), _s2 = new Vector3(), _h = new Vector3(), _end = new Vector3();
export const twoBoneIK = (
  a: Vector3, t: Vector3, l1: number, l2: number, pole: Vector3, flip: boolean,
  qUpper: Quaternion, qLower: Quaternion, outMid?: Vector3, outEnd?: Vector3,
): void => {
  _d.subVectors(t, a);
  let dist = _d.length();
  if (dist < 1e-5) { _d.set(0, -1, 0); dist = 1e-5; } else _d.multiplyScalar(1 / dist);
  // soft clamp: never fully straighten (avoids popping at full reach)
  const maxL = (l1 + l2) * 0.999, minL = Math.abs(l1 - l2) + 0.02;
  dist = clamp(dist, minL, maxL);
  const al = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const hh = Math.sqrt(Math.max(0, l1 * l1 - al * al));
  _mm.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_mm.lengthSq() < 1e-8) {
    // pole parallel to the limb: pick any perpendicular
    _mm.set(0, 0, 1).addScaledVector(_d, -_d.z);
    if (_mm.lengthSq() < 1e-8) _mm.set(1, 0, 0).addScaledVector(_d, -_d.x);
  }
  _mm.normalize();
  _e.copy(a).addScaledVector(_d, al).addScaledVector(_mm, hh);
  _end.copy(a).addScaledVector(_d, dist);
  _s1.subVectors(_e, a).normalize();
  _s2.subVectors(_end, _e).normalize();
  if (flip) _h.crossVectors(_d, _mm); else _h.crossVectors(_mm, _d);
  _h.normalize();
  _vy.copy(_s1).negate(); _vz.crossVectors(_h, _vy).normalize();
  qBasis(qUpper, _h, _vy, _vz);
  _vy.copy(_s2).negate(); _vz.crossVectors(_h, _vy).normalize();
  qBasis(qLower, _h, _vy, _vz);
  if (outMid) outMid.copy(_e);
  if (outEnd) outEnd.copy(_end);
};

/** Orientation whose local -Y points along `dir`, keeping local X as close to `xHint` as possible. */
export const qAim = (out: Quaternion, dir: Vector3, xHint: Vector3): Quaternion => {
  _vy.copy(dir).negate().normalize();
  _vx.copy(xHint).addScaledVector(_vy, -xHint.dot(_vy));
  if (_vx.lengthSq() < 1e-8) _vx.set(1, 0, 0).addScaledVector(_vy, -_vy.x);
  _vx.normalize();
  _vz.crossVectors(_vx, _vy);
  return qBasis(out, _vx, _vy, _vz);
};
