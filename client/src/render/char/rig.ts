// The fighter skeleton: bone list, hierarchy and rest positions, plus a tiny FK solver.
//
// Model space: the character faces -Z, +X is its right, feet at y = 0. Every bone's rest
// orientation is the identity (axes aligned with model space); limbs hang straight down (-Y).

import { Bone, Matrix4, Quaternion, Vector3 } from 'three';

export const BONE_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'uarmL', 'larmL', 'handL', 'fingL',
  'clavR', 'uarmR', 'larmR', 'handR', 'fingR',
  'ulegL', 'llegL', 'footL', 'toeL',
  'ulegR', 'llegR', 'footR', 'toeR',
  'weapon',
  'clkL0', 'clkL1', 'clkL2', 'clkC0', 'clkC1', 'clkC2', 'clkR0', 'clkR1', 'clkR2',
  'braidL0', 'braidL1', 'braidR0', 'braidR1', 'beard', 'hair0', 'hair1', 'tail',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

const idx = {} as Record<BoneName, number>;
BONE_NAMES.forEach((n, i) => { idx[n] = i; });
/** Bone indices by name. */
export const B: Readonly<Record<BoneName, number>> = idx;
export const BONE_COUNT: number = BONE_NAMES.length;

const PARENT_OF: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavL: 'chest', uarmL: 'clavL', larmL: 'uarmL', handL: 'larmL', fingL: 'handL',
  clavR: 'chest', uarmR: 'clavR', larmR: 'uarmR', handR: 'larmR', fingR: 'handR',
  ulegL: 'hips', llegL: 'ulegL', footL: 'llegL', toeL: 'footL',
  ulegR: 'hips', llegR: 'ulegR', footR: 'llegR', toeR: 'footR',
  weapon: 'handR',
  clkL0: 'chest', clkL1: 'clkL0', clkL2: 'clkL1',
  clkC0: 'chest', clkC1: 'clkC0', clkC2: 'clkC1',
  clkR0: 'chest', clkR1: 'clkR0', clkR2: 'clkR1',
  braidL0: 'head', braidL1: 'braidL0', braidR0: 'head', braidR1: 'braidR0',
  beard: 'head', hair0: 'head', hair1: 'hair0', tail: 'hips',
};

// Proportions (metres).
export const UARM_LEN = 0.30, LARM_LEN = 0.27;
export const ULEG_LEN = 0.42, LLEG_LEN = 0.41;
export const SHOULDER_X = 0.26, SHOULDER_Y = 1.43;
export const HIP_X = 0.105, HIP_Y = 0.92;
export const ANKLE_Y = 0.09;
/** Ball of the foot relative to the ankle (forward is -Z). */
export const BALL_FWD = 0.13;
export const CLOAK_SEG = 0.33;
export const CLOAK_END_Y = 0.42;

/** Rest positions in model space. */
export const REST: Record<BoneName, [number, number, number]> = {
  root: [0, 0, 0], hips: [0, 0.96, 0], spine: [0, 1.10, 0], chest: [0, 1.26, 0], neck: [0, 1.50, 0.005], head: [0, 1.58, -0.005],
  clavL: [-0.06, 1.44, 0], uarmL: [-SHOULDER_X, SHOULDER_Y, 0], larmL: [-SHOULDER_X, SHOULDER_Y - UARM_LEN, 0], handL: [-SHOULDER_X, SHOULDER_Y - UARM_LEN - LARM_LEN, 0], fingL: [-SHOULDER_X, 0.775, 0],
  clavR: [0.06, 1.44, 0], uarmR: [SHOULDER_X, SHOULDER_Y, 0], larmR: [SHOULDER_X, SHOULDER_Y - UARM_LEN, 0], handR: [SHOULDER_X, SHOULDER_Y - UARM_LEN - LARM_LEN, 0], fingR: [SHOULDER_X, 0.775, 0],
  ulegL: [-HIP_X, HIP_Y, 0], llegL: [-HIP_X, HIP_Y - ULEG_LEN, 0], footL: [-HIP_X, ANKLE_Y, 0], toeL: [-HIP_X, 0, -BALL_FWD],
  ulegR: [HIP_X, HIP_Y, 0], llegR: [HIP_X, HIP_Y - ULEG_LEN, 0], footR: [HIP_X, ANKLE_Y, 0], toeR: [HIP_X, 0, -BALL_FWD],
  weapon: [SHOULDER_X - 0.03, 0.765, 0],
  clkL0: [-0.17, 1.41, 0.135], clkL1: [-0.195, 1.08, 0.165], clkL2: [-0.22, 0.75, 0.18],
  clkC0: [0, 1.41, 0.15], clkC1: [0, 1.08, 0.18], clkC2: [0, 0.75, 0.195],
  clkR0: [0.17, 1.41, 0.135], clkR1: [0.195, 1.08, 0.165], clkR2: [0.22, 0.75, 0.18],
  braidL0: [-0.098, 1.61, -0.05], braidL1: [-0.105, 1.48, -0.06], braidR0: [0.098, 1.61, -0.05], braidR1: [0.105, 1.48, -0.06],
  beard: [0, 1.585, -0.095], hair0: [0, 1.68, 0.095], hair1: [0, 1.55, 0.125], tail: [0.115, 0.94, -0.125],
};
/** Where the last bone of each dangling chain ends (rest, model space). */
export const CHAIN_END: Partial<Record<BoneName, [number, number, number]>> = {
  clkL2: [-0.245, CLOAK_END_Y, 0.19], clkC2: [0, CLOAK_END_Y, 0.205], clkR2: [0.245, CLOAK_END_Y, 0.19],
  braidL1: [-0.11, 1.35, -0.065], braidR1: [0.11, 1.35, -0.065], beard: [0, 1.44, -0.115], hair1: [0, 1.42, 0.14], tail: [0.12, 0.64, -0.135],
};

export const PARENT = new Int8Array(BONE_COUNT);
/** Rest offset from the parent bone (model axes). */
export const REST_LOCAL: Vector3[] = [];
export const REST_WORLD: Vector3[] = [];
BONE_NAMES.forEach((n, i) => {
  const par = PARENT_OF[n];
  PARENT[i] = par === null ? -1 : idx[par];
  const r = REST[n];
  REST_WORLD.push(new Vector3(r[0], r[1], r[2]));
  if (par === null) REST_LOCAL.push(new Vector3(r[0], r[1], r[2]));
  else { const pr = REST[par]; REST_LOCAL.push(new Vector3(r[0] - pr[0], r[1] - pr[1], r[2] - pr[2])); }
});

const _one = new Vector3(1, 1, 1);
const _v = new Vector3();

/**
 * Skeleton state for one character. Local rotations are written by the animator, then solve()
 * produces model-space positions/orientations for every bone. Bones flagged `free` are written
 * directly in model space (cloth / jiggle simulation) and skipped by the FK pass.
 */
export class Skel {
  readonly lq: Quaternion[] = [];
  readonly lp: Vector3[] = [];
  readonly wq: Quaternion[] = [];
  readonly wp: Vector3[] = [];
  readonly free = new Uint8Array(BONE_COUNT);
  readonly bones: Bone[] = [];
  readonly inverses: Matrix4[] = [];

  constructor() {
    for (let i = 0; i < BONE_COUNT; i++) {
      this.lq.push(new Quaternion());
      this.lp.push(REST_LOCAL[i].clone());
      this.wq.push(new Quaternion());
      this.wp.push(REST_WORLD[i].clone());
      const b = new Bone();
      b.name = BONE_NAMES[i];
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      b.matrixWorld.makeTranslation(REST_WORLD[i].x, REST_WORLD[i].y, REST_WORLD[i].z);
      this.bones.push(b);
      this.inverses.push(new Matrix4().makeTranslation(-REST_WORLD[i].x, -REST_WORLD[i].y, -REST_WORLD[i].z));
    }
  }

  /** Forward kinematics for bones in [from, to). Parents always precede children. */
  solve(from = 0, to = BONE_COUNT): void {
    const { lq, lp, wq, wp, free } = this;
    for (let i = from; i < to; i++) {
      if (free[i]) continue;
      const p = PARENT[i];
      if (p < 0) { wq[i].copy(lq[i]); wp[i].copy(lp[i]); continue; }
      wq[i].multiplyQuaternions(wq[p], lq[i]);
      wp[i].copy(lp[i]).applyQuaternion(wq[p]).add(wp[p]);
    }
  }

  /** Model-space position of a point given in a bone's local frame. */
  point(bone: number, lx: number, ly: number, lz: number, out: Vector3): Vector3 {
    return out.set(lx, ly, lz).applyQuaternion(this.wq[bone]).add(this.wp[bone]);
  }

  /** Push the solved pose into the THREE bones (model-space matrices; the mesh is bound 'detached'). */
  flush(): void {
    for (let i = 0; i < BONE_COUNT; i++) this.bones[i].matrixWorld.compose(this.wp[i], this.wq[i], _one);
  }

  /** Rigidly transform every solved bone (whole-body tumble / lie down). */
  transformAll(q: Quaternion, pivot: Vector3, offset: Vector3): void {
    for (let i = 0; i < BONE_COUNT; i++) {
      _v.copy(this.wp[i]).sub(pivot).applyQuaternion(q).add(pivot).add(offset);
      this.wp[i].copy(_v);
      this.wq[i].premultiply(q);
    }
  }
}
