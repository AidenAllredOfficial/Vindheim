// Poses: a compact, blendable description of the whole body, and the little authoring language
// key poses are written in.
//
// Authoring space is RUF = [right, up, forward] in metres relative to the character (forward is
// model -Z). Hand targets are relative to the same-side shoulder. Rotations are body Eulers in
// degrees: [pitch (lean forward +), yaw (turn left +), roll (lean right +)].

import { Quaternion, Vector3 } from 'three';
import { B, REST_WORLD, REST_LOCAL, UARM_LEN, LARM_LEN } from './rig';
import { qBasis, qEuler, slerpU, twoBoneIK } from './mathx';

export type V3 = [number, number, number];

export interface ArmDef {
  /** Wrist target relative to the shoulder, in chest space. */
  h?: V3;
  /** Wrist target relative to the shoulder's rest position, in model space (ignores torso rotation). */
  hM?: V3;
  /** Direction the elbow points (chest space). */
  pole?: V3;
  /** Weapon direction (the hand's local -Z) in chest / model space. */
  w?: V3; wM?: V3;
  /** Direction of the blade edge / knuckles (the hand's local -Y); defaults to the forearm. */
  e?: V3; eM?: V3;
  /** Open-hand orientation: palm normal and finger direction. */
  palm?: V3; palmM?: V3; fing?: V3; fingM?: V3;
  /** 0 fist .. 1 open hand. */
  open?: number;
}

export interface FootDef {
  /** Ankle position in root space (absolute; rest is [+-0.105, 0.09, 0]). */
  p: V3;
  /** [pitch (toes down +), yaw (left +), roll]. */
  r?: V3;
  /** Knee direction. */
  knee?: V3;
}

export interface PoseDef {
  /** Hips offset from rest and hips rotation. */
  hp?: V3; hr?: V3;
  sp?: V3; ch?: V3; nk?: V3; hd?: V3;
  R?: ArmDef; L?: ArmDef;
  /** Off hand holds the weapon's second grip (0..1). */
  grip?: number;
  /** Feet taken off the ground and posed directly. */
  fR?: FootDef; fL?: FootDef;
  /** Stance offsets for planted feet: [right, forward, yawLeftDeg] added to the neutral stance. */
  stR?: V3; stL?: V3;
  /** Whole-body transform about the hips pivot: offset + rotation. */
  rp?: V3; rr?: V3;
  /** How much the arms follow aim pitch (0..1). */
  aim?: number;
}

// Parts (for masks)
export const P_HIPS = 0, P_TORSO = 1, P_HEAD = 2, P_ARML = 3, P_ARMR = 4, P_LEGS = 5, P_ROOT = 6, P_COUNT = 7;

// Quaternion slots
export const Q_SPINE = 0, Q_CHEST = 1, Q_NECK = 2, Q_HEAD = 3, Q_UARML = 4, Q_LARML = 5, Q_HANDL = 6, Q_UARMR = 7, Q_LARMR = 8, Q_HANDR = 9, Q_COUNT = 10;
const Q_PART = [P_TORSO, P_TORSO, P_HEAD, P_HEAD, P_ARML, P_ARML, P_ARML, P_ARMR, P_ARMR, P_ARMR];
export const Q_BONE = [B.spine, B.chest, B.neck, B.head, B.uarmL, B.larmL, B.handL, B.uarmR, B.larmR, B.handR];

export class Pose {
  readonly hipsP = new Vector3();
  readonly hipsQ = new Quaternion();
  readonly q: Quaternion[] = [];
  readonly rootP = new Vector3();
  readonly rootQ = new Quaternion();
  /** Ankle targets (root space), foot orientation and knee direction for overridden feet: [L, R]. */
  readonly footP = [new Vector3(-0.105, 0.09, 0), new Vector3(0.105, 0.09, 0)];
  readonly footQ = [new Quaternion(), new Quaternion()];
  readonly knee = [new Vector3(0, 0, -1), new Vector3(0, 0, -1)];
  readonly footW = [0, 0];
  /** Stance offsets [Lr, Lf, Lyaw, Rr, Rf, Ryaw]. */
  readonly st = [0, 0, 0, 0, 0, 0];
  grip = 0; openL = 0.25; openR = 0; aim = 0;
  readonly mask = new Float32Array(P_COUNT);

  constructor() { for (let i = 0; i < Q_COUNT; i++) this.q.push(new Quaternion()); }

  reset(): this {
    this.hipsP.set(0, 0, 0); this.hipsQ.identity(); this.rootP.set(0, 0, 0); this.rootQ.identity();
    for (const q of this.q) q.identity();
    this.footP[0].set(-0.105, 0.09, 0); this.footP[1].set(0.105, 0.09, 0);
    this.footQ[0].identity(); this.footQ[1].identity();
    this.knee[0].set(0, 0, -1); this.knee[1].set(0, 0, -1);
    this.footW[0] = this.footW[1] = 0;
    this.st.fill(0);
    this.grip = 0; this.openL = 0.25; this.openR = 0; this.aim = 0;
    this.mask.fill(0);
    return this;
  }

  copy(o: Pose): this {
    this.hipsP.copy(o.hipsP); this.hipsQ.copy(o.hipsQ); this.rootP.copy(o.rootP); this.rootQ.copy(o.rootQ);
    for (let i = 0; i < Q_COUNT; i++) this.q[i].copy(o.q[i]);
    for (let i = 0; i < 2; i++) { this.footP[i].copy(o.footP[i]); this.footQ[i].copy(o.footQ[i]); this.knee[i].copy(o.knee[i]); this.footW[i] = o.footW[i]; }
    for (let i = 0; i < 6; i++) this.st[i] = o.st[i];
    this.grip = o.grip; this.openL = o.openL; this.openR = o.openR; this.aim = o.aim;
    this.mask.set(o.mask);
    return this;
  }

  /**
   * this = mix(a, b, t). A part defined in only one of the two is taken from that one; t may
   * extrapolate slightly (anticipation creep).
   */
  mix(a: Pose, b: Pose, t: number): this {
    const ma = a.mask, mb = b.mask;
    const pt = (p: number): number => (ma[p] > 0 && mb[p] > 0 ? t : mb[p] > 0 ? 1 : 0);
    for (let p = 0; p < P_COUNT; p++) this.mask[p] = Math.max(0, Math.min(1, ma[p] + (mb[p] - ma[p]) * Math.max(0, Math.min(1, t))));
    let w = pt(P_HIPS);
    this.hipsP.lerpVectors(a.hipsP, b.hipsP, w); slerpU(this.hipsQ, a.hipsQ, b.hipsQ, w);
    w = pt(P_ROOT);
    this.rootP.lerpVectors(a.rootP, b.rootP, w); slerpU(this.rootQ, a.rootQ, b.rootQ, w);
    for (let i = 0; i < Q_COUNT; i++) slerpU(this.q[i], a.q[i], b.q[i], pt(Q_PART[i]));
    w = pt(P_LEGS);
    const wc = Math.max(0, Math.min(1, w));
    for (let i = 0; i < 2; i++) {
      // feet: only blend positions between two overridden feet, otherwise snap to the one that is
      const fa = a.footW[i] > 0.5, fb = b.footW[i] > 0.5;
      if (fa && fb) { this.footP[i].lerpVectors(a.footP[i], b.footP[i], w); slerpU(this.footQ[i], a.footQ[i], b.footQ[i], w); this.knee[i].lerpVectors(a.knee[i], b.knee[i], w); this.footW[i] = 1; }
      else if (fb && (w > 0.5 || !fa)) { this.footP[i].copy(b.footP[i]); this.footQ[i].copy(b.footQ[i]); this.knee[i].copy(b.knee[i]); this.footW[i] = w > 0.35 ? 1 : 0; }
      else if (fa) { this.footP[i].copy(a.footP[i]); this.footQ[i].copy(a.footQ[i]); this.knee[i].copy(a.knee[i]); this.footW[i] = w < 0.65 ? 1 : 0; }
      else this.footW[i] = 0;
    }
    for (let i = 0; i < 6; i++) this.st[i] = a.st[i] + (b.st[i] - a.st[i]) * wc;
    w = pt(P_ARML);
    this.grip = a.grip + (b.grip - a.grip) * Math.max(0, Math.min(1, w));
    this.openL = a.openL + (b.openL - a.openL) * Math.max(0, Math.min(1, w));
    w = pt(P_ARMR);
    this.openR = a.openR + (b.openR - a.openR) * Math.max(0, Math.min(1, w));
    this.aim = a.aim + (b.aim - a.aim) * Math.max(0, Math.min(1, t));
    return this;
  }

  /** Layer `over` on top of this pose with weight w (per-part scaled by `over`'s mask and `partW`). */
  layer(over: Pose, w: number, partW?: ArrayLike<number>): this {
    const m = over.mask;
    const pw = (p: number): number => Math.max(0, Math.min(1, w * m[p] * (partW ? partW[p] : 1)));
    let k = pw(P_HIPS);
    if (k > 0) { this.hipsP.lerp(over.hipsP, k); this.hipsQ.slerp(over.hipsQ, k); }
    k = pw(P_ROOT);
    if (k > 0) { this.rootP.lerp(over.rootP, k); this.rootQ.slerp(over.rootQ, k); }
    for (let i = 0; i < Q_COUNT; i++) { k = pw(Q_PART[i]); if (k > 0) this.q[i].slerp(over.q[i], k); }
    k = pw(P_LEGS);
    if (k > 0) {
      for (let i = 0; i < 2; i++) {
        if (over.footW[i] > 0.5) {
          if (this.footW[i] > 0.5) { this.footP[i].lerp(over.footP[i], k); this.footQ[i].slerp(over.footQ[i], k); this.knee[i].lerp(over.knee[i], k); }
          else if (k > 0.3) { this.footP[i].copy(over.footP[i]); this.footQ[i].copy(over.footQ[i]); this.knee[i].copy(over.knee[i]); this.footW[i] = 1; }
        } else if (this.footW[i] > 0.5 && k > 0.7) this.footW[i] = 0;
      }
      for (let i = 0; i < 6; i++) this.st[i] += (over.st[i] - this.st[i]) * k;
    }
    k = pw(P_ARML);
    if (k > 0) { this.grip += (over.grip - this.grip) * k; this.openL += (over.openL - this.openL) * k; }
    k = pw(P_ARMR);
    if (k > 0) this.openR += (over.openR - this.openR) * k;
    this.aim += (over.aim - this.aim) * Math.max(0, Math.min(1, w));
    this.mask.fill(1);
    return this;
  }
}

// ------------------------------------------------------------------------------------------
// compiling a PoseDef
// ------------------------------------------------------------------------------------------

const _hq = new Quaternion(), _sq = new Quaternion(), _cq = new Quaternion(), _cqi = new Quaternion();
const _qU = new Quaternion(), _qL = new Quaternion(), _qH = new Quaternion(), _qi = new Quaternion();
const _cp = new Vector3(), _sh = new Vector3(), _t = new Vector3(), _pole = new Vector3(), _zero = new Vector3();
const _w = new Vector3(), _e = new Vector3(), _f = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _mid = new Vector3(), _end = new Vector3();

const ruf = (out: Vector3, v: V3): Vector3 => out.set(v[0], v[1], -v[2]);

const SHOULDER_L = new Vector3().subVectors(REST_WORLD[B.uarmL], REST_WORLD[B.chest]);
const SHOULDER_R = new Vector3().subVectors(REST_WORLD[B.uarmR], REST_WORLD[B.chest]);
const DEFAULT_POLE_R: V3 = [0.45, -0.55, -0.7];
const DEFAULT_POLE_L: V3 = [-0.45, -0.55, -0.7];

function compileArm(def: ArmDef, right: boolean, out: Pose): void {
  const qi = right ? Q_UARMR : Q_UARML;
  const shLocal = right ? SHOULDER_R : SHOULDER_L;
  // target in chest space relative to the shoulder
  if (def.hM) {
    // model-space target -> chest space
    ruf(_t, def.hM).add(REST_WORLD[right ? B.uarmR : B.uarmL]);
    _sh.copy(shLocal).applyQuaternion(_cq).add(_cp);
    _t.sub(_sh).applyQuaternion(_cqi);
  } else if (def.h) ruf(_t, def.h);
  else _t.set(0, -(UARM_LEN + LARM_LEN) * 0.98, 0);
  ruf(_pole, def.pole ?? (right ? DEFAULT_POLE_R : DEFAULT_POLE_L));
  twoBoneIK(_zero, _t, UARM_LEN, LARM_LEN, _pole, false, _qU, _qL, _mid, _end);
  // forearm direction
  _f.subVectors(_end, _mid).normalize();
  // hand orientation
  let haveHand = false;
  if (def.w || def.wM) {
    if (def.wM) ruf(_w, def.wM).applyQuaternion(_cqi); else ruf(_w, def.w!);
    _w.normalize();
    if (def.eM) ruf(_e, def.eM).applyQuaternion(_cqi); else if (def.e) ruf(_e, def.e); else _e.copy(_f);
    _z.copy(_w).negate();
    _y.copy(_e).addScaledVector(_w, -_e.dot(_w));
    if (_y.lengthSq() < 1e-6) { _y.set(0, 1, 0).addScaledVector(_w, -_w.y); if (_y.lengthSq() < 1e-6) _y.set(1, 0, 0); }
    _y.normalize().negate();
    _x.crossVectors(_y, _z);
    qBasis(_qH, _x, _y, _z);
    haveHand = true;
  } else if (def.palm || def.palmM) {
    if (def.fingM) ruf(_e, def.fingM).applyQuaternion(_cqi); else if (def.fing) ruf(_e, def.fing); else _e.copy(_f);
    _e.normalize();
    if (def.palmM) ruf(_w, def.palmM).applyQuaternion(_cqi); else ruf(_w, def.palm!);
    _y.copy(_e).negate();
    _x.copy(_w).addScaledVector(_y, -_w.dot(_y));
    if (_x.lengthSq() < 1e-6) { _x.set(1, 0, 0).addScaledVector(_y, -_y.x); }
    _x.normalize();
    if (right) _x.negate();
    _z.crossVectors(_x, _y);
    qBasis(_qH, _x, _y, _z);
    haveHand = true;
  }
  out.q[qi].copy(_qU);
  out.q[qi + 1].copy(_qi.copy(_qU).invert()).multiply(_qL);
  if (haveHand) out.q[qi + 2].copy(_qi.copy(_qL).invert()).multiply(_qH); else out.q[qi + 2].identity();
  if (right) out.openR = def.open ?? 0; else out.openL = def.open ?? 0.25;
  out.mask[right ? P_ARMR : P_ARML] = 1;
}

/** Compile a PoseDef into `out` (parts not mentioned keep mask 0). */
export function compilePose(def: PoseDef, out: Pose): Pose {
  out.reset();
  if (def.hp || def.hr) {
    if (def.hp) ruf(out.hipsP, def.hp);
    if (def.hr) qEuler(out.hipsQ, def.hr[0], def.hr[1], def.hr[2]);
    out.mask[P_HIPS] = 1;
  }
  if (def.sp || def.ch) {
    if (def.sp) qEuler(out.q[Q_SPINE], def.sp[0], def.sp[1], def.sp[2]);
    if (def.ch) qEuler(out.q[Q_CHEST], def.ch[0], def.ch[1], def.ch[2]);
    out.mask[P_TORSO] = 1;
  }
  if (def.nk || def.hd) {
    if (def.nk) qEuler(out.q[Q_NECK], def.nk[0], def.nk[1], def.nk[2]);
    if (def.hd) qEuler(out.q[Q_HEAD], def.hd[0], def.hd[1], def.hd[2]);
    out.mask[P_HEAD] = 1;
  }
  // chest frame of this pose (for model-space arm targets)
  _hq.copy(out.hipsQ);
  _sq.copy(_hq).multiply(out.q[Q_SPINE]);
  _cq.copy(_sq).multiply(out.q[Q_CHEST]);
  _cqi.copy(_cq).invert();
  _cp.copy(REST_WORLD[B.hips]).add(out.hipsP);
  _cp.add(_t.copy(REST_LOCAL[B.spine]).applyQuaternion(_hq));
  _cp.add(_t.copy(REST_LOCAL[B.chest]).applyQuaternion(_sq));
  if (def.R) compileArm(def.R, true, out);
  if (def.L) compileArm(def.L, false, out);
  if (def.grip !== undefined) out.grip = def.grip;
  if (def.fL || def.fR || def.stL || def.stR) {
    const fd = [def.fL, def.fR];
    for (let i = 0; i < 2; i++) {
      const f = fd[i];
      if (!f) continue;
      ruf(out.footP[i], f.p);
      if (f.r) qEuler(out.footQ[i], f.r[0], f.r[1], f.r[2]);
      if (f.knee) ruf(out.knee[i], f.knee); else out.knee[i].set(i === 0 ? -0.1 : 0.1, 0, -1);
      out.footW[i] = 1;
    }
    if (def.stL) { out.st[0] = def.stL[0]; out.st[1] = def.stL[1]; out.st[2] = def.stL[2]; }
    if (def.stR) { out.st[3] = def.stR[0]; out.st[4] = def.stR[1]; out.st[5] = def.stR[2]; }
    out.mask[P_LEGS] = 1;
  }
  if (def.rp || def.rr) {
    if (def.rp) ruf(out.rootP, def.rp);
    if (def.rr) qEuler(out.rootQ, def.rr[0], def.rr[1], def.rr[2]);
    out.mask[P_ROOT] = 1;
  }
  out.aim = def.aim ?? 0;
  return out;
}

/** Compile and keep. */
export const pose = (def: PoseDef): Pose => compilePose(def, new Pose());
