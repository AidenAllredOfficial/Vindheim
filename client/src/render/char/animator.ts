// The procedural animator: turns a PlayerView into a solved skeleton every frame.
//
// Pipeline: gait (world-space foot planting) -> locomotion pose -> movement signature / action
// layer -> reactions -> additive aim, lean and flinch -> inertialized output (every discrete
// change of state decays smoothly from the previous output, so nothing pops) -> leg and grip IK
// -> whole-body transform -> secondary motion (cloak, braids, beard).

import { Quaternion, Vector3 } from 'three';
import { ELEMENTS, type AbilityDef, type AnimKind, type ElementId } from '@shared/elements';
import { GETUP_TIME, MV_DASH, MV_GLIDE, MV_LEAP, MV_RAY, MV_SOAR, MV_SURGE } from '@shared/types';
import type { PlayerView } from '../../contracts';
import type { QualityLevel } from '../../settings';
import { B, CHAIN_END, HIP_X, LARM_LEN, LLEG_LEN, REST_LOCAL, REST_WORLD, Skel, UARM_LEN, ULEG_LEN } from './rig';
import { DEG, Spring, TAU, clamp, clamp01, damp, easeInOut, easeOut, hash11, lerp, noise1, qEuler, slerpU, smooth, twoBoneIK, wrapAngle } from './mathx';
import { Gait, type GaitIn } from './gait';
import { P_ARML, P_ARMR, P_COUNT, P_HIPS, P_LEGS, P_ROOT, Pose, Q_BONE, Q_CHEST, Q_COUNT, Q_HEAD, Q_NECK, Q_SPINE, Q_UARML, Q_UARMR, compilePose, type ArmDef, type PoseDef, type V3 } from './pose';
import { POSES, evalAction } from './anims';
import type { WeaponClass } from './look';

interface Carry {
  iR: V3; iW: V3; rR: V3; rW: V3; rSw: number;
  iL: V3; rL: V3; lSw: number;
  grip: number; openL: number; openR: number;
  /** Idle body: hips drop, forward hunch. */
  crouch: number; hunch: number;
}
const CARRY: Record<WeaponClass | 'dummy', Carry> = {
  axe: { iR: [0.11, -0.43, 0.15], iW: [0.5, 0.62, 0.6], rR: [0.1, -0.36, 0.1], rW: [0.35, 0.85, 0.4], rSw: 0.13, iL: [-0.07, -0.46, 0.12], rL: [-0.05, -0.3, 0.05], lSw: 0.27, grip: 0, openL: 0.35, openR: 0, crouch: 0.035, hunch: 2 },
  sword: { iR: [0.1, -0.44, 0.16], iW: [0.3, 0.55, 0.78], rR: [0.12, -0.42, 0.02], rW: [0.35, -0.25, -0.9], rSw: 0.12, iL: [-0.07, -0.46, 0.12], rL: [-0.05, -0.3, 0.05], lSw: 0.27, grip: 0, openL: 0.35, openR: 0, crouch: 0.035, hunch: 2 },
  rod: { iR: [0.03, -0.33, 0.27], iW: [0.1, 0.62, 0.78], rR: [0.06, -0.34, 0.12], rW: [0.15, 0.5, 0.85], rSw: 0.16, iL: [0.03, -0.28, 0.3], rL: [-0.03, -0.3, 0.06], lSw: 0.25, grip: 0, openL: 0, openR: 0, crouch: 0.05, hunch: 5 },
  dagger: { iR: [0.05, -0.4, 0.24], iW: [-0.25, 0.3, 0.9], rR: [0.1, -0.4, -0.02], rW: [0.3, -0.25, -0.9], rSw: 0.1, iL: [0.0, -0.38, 0.22], rL: [-0.05, -0.32, 0.04], lSw: 0.24, grip: 0, openL: 0.5, openR: 0, crouch: 0.075, hunch: 8 },
  hammer: { iR: [-0.04, -0.44, 0.24], iW: [0.62, -0.42, 0.66], rR: [-0.06, -0.42, 0.22], rW: [0.62, -0.3, 0.72], rSw: -0.03, iL: [0.1, -0.4, 0.2], rL: [0.1, -0.4, 0.2], lSw: 0, grip: 1, openL: 0, openR: 0, crouch: 0.045, hunch: 4 },
  none: { iR: [-0.06, -0.24, 0.3], iW: [0, 1, 0], rR: [0.1, -0.3, -0.36], rW: [0, 1, 0], rSw: 0.04, iL: [0.04, -0.18, 0.36], rL: [-0.1, -0.3, -0.36], lSw: 0.04, grip: 0, openL: 0.15, openR: 0.15, crouch: 0.05, hunch: 4 },
  harpoon: { iR: [0.12, -0.36, 0.12], iW: [0.06, 0.96, 0.26], rR: [0.1, -0.47, 0.04], rW: [0.05, 0.2, 0.97], rSw: 0.05, iL: [-0.07, -0.46, 0.12], rL: [-0.05, -0.3, 0.05], lSw: 0.27, grip: 0, openL: 0.35, openR: 0, crouch: 0.035, hunch: 2 },
  spear: { iR: [0.13, -0.34, 0.12], iW: [0.03, 0.97, 0.22], rR: [0.1, -0.47, 0.04], rW: [0.04, 0.16, 0.98], rSw: 0.05, iL: [-0.07, -0.46, 0.12], rL: [-0.05, -0.3, 0.05], lSw: 0.27, grip: 0, openL: 0.35, openR: 0, crouch: 0.03, hunch: 1 },
  dummy: { iR: [0.3, -0.44, 0.0], iW: [0, 1, 0], rR: [0.3, -0.42, 0], rW: [0, 1, 0], rSw: 0.1, iL: [-0.3, -0.44, 0.0], rL: [-0.3, -0.42, 0], lSw: 0.1, grip: 0, openL: 0.2, openR: 0.2, crouch: 0.0, hunch: 0 },
};

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion(), _qi = new Quaternion(), _qId = new Quaternion();
const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3(), _pole = new Vector3();
const _hip = new Vector3(), _ank = new Vector3();
const _qU = new Quaternion(), _qL = new Quaternion(), _qF = new Quaternion();
const _an = { x: 0, y: 0, z: 0 };
const PIVOT = new Vector3(0, 0.95, 0);
const set3 = (a: V3, x: number, y: number, z: number): void => { a[0] = x; a[1] = y; a[2] = z; };
const lerp3 = (o: V3, a: V3, b: V3, t: number): void => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; };

const CLOAK_BONES = [[B.clkL0, B.clkL1, B.clkL2], [B.clkC0, B.clkC1, B.clkC2], [B.clkR0, B.clkR1, B.clkR2]];

class Particle {
  readonly p = new Vector3(); readonly v = new Vector3();
  readonly restDir = new Vector3(); len = 0.3;
}
interface Jiggle { bones: number[]; parent: number; parts: Particle[]; stiff: number; drag: number; grav: number }

export interface AnimatorConfig {
  element: ElementId; cls: WeaponClass; dummy: boolean; quality: QualityLevel;
  grip2: Vector3 | null; cloakSegs: number; hasBraids: boolean; hasBeard: boolean; hasHair: boolean;
  seed: number;
  /** Height scale of the model (the animator works in model metres). */
  scale: number;
}

export class Animator {
  readonly skel = new Skel();
  /** 0..1 dissolve amount while dead. */
  dissolve = 0;
  /** Landing / impact squash (-1..1, negative = squashed). */
  squash = 0;
  /** Set when a foot touched down this frame: 'step' | 'land'. */
  footEvent: '' | 'step' | 'land' = '';

  private cfg!: AnimatorConfig;
  private readonly pp = {} as PlayerView;
  private carry!: Carry;
  private readonly gait = new Gait();
  private readonly gin: GaitIn = { dt: 0, px: 0, pz: 0, face: 0, vx: 0, vz: 0, grounded: true, locked: false, homeL: [-0.13, 0.1, 0.1], homeR: [0.14, -0.1, -0.3], hipY: 0.9, hipX: 0, hipZ: 0, speedScale: 1 };

  private readonly tgt = new Pose();
  private readonly out = new Pose();
  private readonly last = new Pose();
  private readonly actP = new Pose();
  private readonly tmpP = new Pose();
  private readonly tmpP2 = new Pose();
  private readonly locoDef: PoseDef = { hp: [0, 0, 0], hr: [0, 0, 0], sp: [0, 0, 0], ch: [0, 0, 0], nk: [0, 0, 0], hd: [0, 0, 0], R: { h: [0, 0, 0], w: [0, 0, 1], pole: [0.45, -0.55, -0.7] }, L: { h: [0, 0, 0], pole: [-0.45, -0.55, -0.7], palm: [1, 0, 0.2] }, stL: [0, 0, 0], stR: [0, 0, 0], grip: 0 };
  private readonly dashDef: PoseDef = { hp: [0, 0, 0], hr: [0, 0, 0], sp: [8, 0, 0], ch: [4, 0, 0], hd: [0, 0, 0], R: { h: [0, 0, 0], w: [0.2, 0.1, -0.95] }, L: { h: [0, 0, 0], open: 0.4 }, fL: { p: [0, 0, 0], r: [0, 0, 0], knee: [0, 0.2, 1] }, fR: { p: [0, 0, 0], r: [0, 0, 0], knee: [0, -0.3, 1] } };
  private readonly partW = new Float32Array(P_COUNT);

  // inertialization
  private readonly offQ: Quaternion[] = [];
  private readonly offHips = new Vector3();
  private readonly offRoot = new Vector3();
  private offGrip = 0; private offOpenL = 0; private offOpenR = 0;
  private iT = 1; private iDur = 0.1; private iPending = false; private iSharp = false;
  private readonly footOff = [new Vector3(), new Vector3()];
  private readonly footOffT = [1, 1];
  private readonly footOffDur = [0.1, 0.1];
  private readonly lastAnkle = [new Vector3(-HIP_X, 0.09, 0), new Vector3(HIP_X, 0.09, 0)];
  private readonly lastFootQ = [new Quaternion(), new Quaternion()];
  private readonly lastFootYaw = [0, 0];
  private readonly wasOver = [false, false];
  private readonly plantCheck = [new Vector3(), new Vector3()];
  private readonly plantHad = [false, false];

  // previous frame
  private first = true;
  private px = 0; private py = 0; private pz = 0; private pvx = 0; private pvy = 0; private pvz = 0;
  private pAct = -1; private pActT = 0; private pMv = 0; private pGround = true; private pLaunched = false; private pDown = 0;
  private pBubbled = false; private pAlive = true; private pFrozen = false; private pStun = 0; private pRooted = false; private pStealth = false;

  // state
  private actDef: AbilityDef | null = null;
  private actKind: AnimKind | null = null;
  private meldT = 9; private landT = 9; private rayEndT = 9; private mvT = 0; private deathT = 0; private deathAir = false;
  private airT = 0;
  private runW = 0; private airW = 0;
  private accF = 0; private accR = 0;
  private readonly leanP = new Spring(); private readonly leanR = new Spring();
  private readonly hipS = new Spring(); private readonly sqS = new Spring();
  private readonly aimY = new Spring(); private readonly aimP = new Spring();
  private readonly flP = new Spring(); private readonly flY = new Spring(); private readonly flR = new Spring(); private readonly flX = new Spring(); private readonly flZ = new Spring();
  private stagW = 0; private stagL = 1; private stagR = 1; private flinchN = 0;
  private tumble = 0; private tumbleFwd = false; private tumblePsi = 0; private lieSupine = true; private lieAng = 90;
  private hipDrop = 0;
  private turnRate = 0; private pFace = 0;
  private lookT = 0;

  // secondary
  private readonly cloak: Particle[][] = [];
  private readonly jiggles: Jiggle[] = [];
  private secInit = false;
  private readonly cloakQ = new Quaternion();

  constructor(cfg: AnimatorConfig) {
    for (let i = 0; i < Q_COUNT + 2; i++) this.offQ.push(new Quaternion());
    for (let c = 0; c < 3; c++) { const ch: Particle[] = []; for (let s = 0; s < 3; s++) ch.push(new Particle()); this.cloak.push(ch); }
    this.configure(cfg);
  }

  configure(cfg: AnimatorConfig): void {
    this.cfg = cfg;
    this.carry = CARRY[cfg.dummy ? 'dummy' : cfg.cls];
    // open hands for the unarmed, a weapon grip for everyone else
    const R = this.locoDef.R as ArmDef, L = this.locoDef.L as ArmDef;
    if (cfg.dummy) { R.w = undefined; R.palm = [0, -1, 0]; L.palm = [0, -1, 0]; }
    else if (cfg.cls === 'none') { R.w = undefined; R.palm = [-1, 0, 0.25]; L.palm = [1, 0, 0.25]; }
    else { R.w = [0, 0, 1]; R.palm = undefined; L.palm = [1, 0, 0.2]; }
    const sk = this.skel;
    sk.free.fill(0);
    // cloak chains
    for (let c = 0; c < 3; c++) {
      for (let s = 0; s < 3; s++) {
        const bone = CLOAK_BONES[c][s];
        const next = s < 2 ? REST_WORLD[CLOAK_BONES[c][s + 1]] : _v.fromArray(CHAIN_END[(['clkL2', 'clkC2', 'clkR2'] as const)[c]]!);
        const pt = this.cloak[c][s];
        pt.restDir.subVectors(next, REST_WORLD[bone]);
        pt.len = pt.restDir.length();
        pt.restDir.normalize();
        sk.free[bone] = 1;
      }
    }
    // jiggle chains
    this.jiggles.length = 0;
    const lowQ = cfg.quality === 'low';
    const add = (bones: number[], parent: number, endName: keyof typeof CHAIN_END, stiff: number, drag: number, grav: number): void => {
      const parts: Particle[] = [];
      for (let i = 0; i < bones.length; i++) {
        const pt = new Particle();
        const next = i < bones.length - 1 ? REST_WORLD[bones[i + 1]] : _v.fromArray(CHAIN_END[endName]!);
        pt.restDir.subVectors(next, REST_WORLD[bones[i]]);
        pt.len = pt.restDir.length(); pt.restDir.normalize();
        parts.push(pt);
        sk.free[bones[i]] = 1;
      }
      this.jiggles.push({ bones, parent, parts, stiff, drag, grav });
    };
    if (!lowQ) {
      if (cfg.hasBraids) { add([B.braidL0, B.braidL1], B.head, 'braidL1', 16, 3, 12); add([B.braidR0, B.braidR1], B.head, 'braidR1', 16, 3, 12); }
      if (cfg.hasBeard) add([B.beard], B.head, 'beard', 34, 5, 6);
      if (cfg.hasHair) add([B.hair0, B.hair1], B.head, 'hair1', 14, 3, 12);
      if (!cfg.dummy) add([B.tail], B.hips, 'tail', 14, 2.5, 14);
    }
    this.secInit = false;
  }

  /** Is foot f (0 left, 1 right) planted on the ground right now? (debug / footsteps) */
  footPlanted(f: number): boolean { return this.out.footW[f] < 0.5 && this.gait.feet[f].planted; }
  get gaitPhase(): number { return this.gait.phase; }
  /** World plant coordinates of foot f (debug: a planted foot keeps these until it lifts). */
  plantKey(f: number): number { const ft = this.gait.feet[f]; return ft.wx * 131.7 + ft.wz; }

  // ----------------------------------------------------------------------------------------
  private inert(dur: number, sharp = false): void {
    if (this.iPending && dur > this.iDur) return;
    this.iPending = true; this.iDur = Math.max(0.01, dur); this.iSharp = sharp;
  }

  /** Snap everything (spawn, teleport, respawn). */
  private hardReset(p: PlayerView): void {
    this.iPending = false; this.iT = 1;
    this.footOffT[0] = this.footOffT[1] = 1;
    this.wasOver[0] = this.wasOver[1] = false;
    this.plantHad[0] = this.plantHad[1] = false;
    this.hipS.reset(); this.sqS.reset(); this.leanP.reset(); this.leanR.reset(); this.flP.reset(); this.flY.reset(); this.flR.reset(); this.flX.reset(); this.flZ.reset();
    this.aimY.reset(clamp(wrapAngle(p.aimYaw - p.face), -1.3, 1.3)); this.aimP.reset(p.aimPitch);
    this.stagW = 0; this.tumble = 0; this.hipDrop = 0; this.accF = this.accR = 0;
    this.meldT = this.landT = this.rayEndT = 9; this.deathT = 0; this.dissolve = 0;
    this.runW = 0; this.airW = p.onGround ? 0 : 1;
    this.actDef = null; this.actKind = null;
    this.fillGin(p, 1 / 60);
    this.gait.reset(this.gin);
    this.secInit = false;
  }

  private fillGin(p: PlayerView, dt: number): void {
    const g = this.gin;
    g.dt = dt; g.px = p.x; g.pz = p.z; g.face = p.face; g.vx = p.vx; g.vz = p.vz;
    g.grounded = p.onGround && !p.launched && p.mv === 0 && !p.bubbled;
    g.locked = p.rooted || p.frozen || p.down > 0 || !p.alive;
    g.hipY = 0.92 + this.last.hipsP.y - this.hipDrop; g.hipX = this.last.hipsP.x; g.hipZ = this.last.hipsP.z;
  }

  // ----------------------------------------------------------------------------------------
  update(dt: number, pIn: PlayerView, time: number): void {
    dt = clamp(dt, 0, 0.1);
    // work in model metres: divide world distances by the height scale
    const p = Object.assign(this.pp, pIn);
    const inv = 1 / this.cfg.scale;
    p.x *= inv; p.y *= inv; p.z *= inv; p.vx *= inv; p.vy *= inv; p.vz *= inv;
    this.footEvent = '';
    const sk = this.skel;
    const cfg = this.cfg;

    // ---- teleports and first frame
    const jump = Math.hypot(p.x - this.px, p.y - this.py, p.z - this.pz);
    const spd3 = Math.hypot(p.vx, p.vy, p.vz);
    const teleported = this.first || jump > Math.max(2.5, spd3 * dt * 3 + 1.2);
    if (teleported) {
      if (!this.first) this.shiftSecondary(p.x - this.px, p.y - this.py, p.z - this.pz);
      this.hardReset(p);
      this.pAct = -1; this.pMv = p.mv; this.pGround = p.onGround; this.pLaunched = p.launched; this.pDown = p.down; this.pBubbled = p.bubbled;
      this.pAlive = p.alive; this.pFrozen = p.frozen; this.pStun = p.stun; this.pvx = p.vx; this.pvy = p.vy; this.pvz = p.vz; this.pFace = p.face;
      this.pRooted = p.rooted; this.pStealth = p.stealth;
    }
    if (p.alive && !this.pAlive) { this.hardReset(p); this.first = true; }

    // ---- frozen: hold the pose exactly
    if (p.frozen && !this.first) {
      if (!this.pFrozen) this.pFrozen = true;
      this.shiftSecondary(p.x - this.px, p.y - this.py, p.z - this.pz);
      this.px = p.x; this.py = p.y; this.pz = p.z;
      this.finishSkeleton(p, 0, time, true);
      return;
    }
    if (this.pFrozen && !p.frozen) { this.inert(0.22); this.fillGin(p, dt); this.gait.reset(this.gin); }

    const cf = Math.cos(p.face), sf = Math.sin(p.face);
    const vF = -p.vx * sf - p.vz * cf, vR = p.vx * cf - p.vz * sf;
    const speed = Math.hypot(p.vx, p.vz);

    // ---- acceleration -> lean
    if (dt > 1e-5) {
      const ax = (p.vx - this.pvx) / dt, az = (p.vz - this.pvz) / dt;
      const aF = clamp(-ax * sf - az * cf, -60, 60), aR = clamp(ax * cf - az * sf, -60, 60);
      this.accF = damp(this.accF, aF, 9, dt); this.accR = damp(this.accR, aR, 9, dt);
      this.turnRate = damp(this.turnRate, wrapAngle(p.face - this.pFace) / dt, 8, dt);
    }
    const dvx = p.vx - this.pvx, dvz = p.vz - this.pvz;

    // ---- discrete state changes
    const def = !cfg.dummy && p.act >= 0 && p.act < 5 ? ELEMENTS[p.element].abilities[p.act] : null;
    const started = def !== null && (p.act !== this.pAct || p.actT < this.pActT - 0.02);
    if (started && def) {
      this.actDef = def; this.actKind = def.anim;
      const r = evalAction(def.anim, cfg.cls, def, p.actT, this.actP);
      this.inert(r ? r.blendIn : 0.06);
      if (def.anim === 'meld') this.meldT = 0;
    } else if (!def && this.actDef) {
      const d = this.actDef;
      const total = d.windup + d.active + d.recovery;
      if (this.pActT < total - 0.05 && evalAction(d.anim, cfg.cls, d, this.pActT, this.actP)) this.inert(0.14);
      this.actDef = null; this.actKind = null;
    }
    if (p.mv !== this.pMv) {
      if (p.mv !== 0) { this.mvT = 0; this.inert(p.mv === MV_RAY || p.mv === MV_DASH ? 0.05 : 0.1); }
      else {
        this.inert(0.16);
        if (this.pMv === MV_LEAP) { this.landT = 0; this.hipS.kick(-2.2); this.sqS.kick(-5); this.inert(0.05, true); }
        if (this.pMv === MV_RAY) this.rayEndT = 0;
      }
    }
    const grounded = p.onGround && !p.launched && p.mv === 0 && !p.bubbled;
    const wasGrounded = this.pGround;
    if (grounded !== wasGrounded && p.alive) {
      if (grounded) {
        const impact = clamp(-this.pvy, 0, 24);
        this.hipS.kick(-impact * 0.13); this.sqS.kick(-impact * 0.22);
        this.inert(0.09);
        if (impact > 2) this.footEvent = 'land';
      } else { this.inert(0.12); this.airT = 0; }
    }
    if (p.launched && !this.pLaunched) {
      this.inert(0.1);
      this.tumble = 0;
      const kl = Math.hypot(vF, vR);
      this.tumbleFwd = kl > 0.5 && vF / kl > 0.35;
      this.tumblePsi = kl > 0.5 ? (this.tumbleFwd ? Math.atan2(-vR, vF) : Math.atan2(vR, -vF)) : 0;
    }
    if (p.down > 0 && this.pDown <= 0) {
      this.inert(0.1, true);
      this.sqS.kick(-6);
      if (!this.pLaunched) { this.tumble = 0; this.tumbleFwd = false; this.tumblePsi = 0; }
      // settle onto the nearer of back / front
      const a = ((this.tumble / DEG) % 360 + 360) % 360;
      const near90 = Math.abs(a - 90) <= 90;
      this.lieAng = near90 ? 90 : 270;
      this.lieSupine = this.tumbleFwd ? !near90 : near90;
    }
    if (p.down <= 0 && this.pDown > 0) this.inert(0.14);
    if (p.bubbled !== this.pBubbled) this.inert(0.25);
    if (p.rooted !== this.pRooted) this.inert(0.15);
    if (!p.alive && this.pAlive) {
      this.deathT = 0; this.deathAir = !p.onGround || p.launched;
      this.inert(0.12);
      if (this.deathAir && !this.pLaunched) { this.tumble = 0; this.tumbleFwd = false; this.tumblePsi = 0; }
    }
    if (p.stun > 0 && (this.pStun <= 0 || p.stun > this.pStun + 0.05)) this.startFlinch(dvx, dvz, cf, sf, p);

    // ---- timers
    this.mvT += dt; this.meldT += dt; this.landT += dt; this.rayEndT += dt; this.airT += dt;
    if (!p.alive) this.deathT += dt;

    // ---- gait
    this.fillGin(p, dt);
    const st = this.last.st;
    set3(this.gin.homeL, -0.115 + st[0], st[1], (6 + st[2]) * DEG);
    set3(this.gin.homeR, 0.115 + st[3], st[4], (-6 + st[5]) * DEG);
    this.gin.locked = this.gin.locked || p.bubbled;
    this.gait.update(this.gin);
    for (let f = 0; f < 2; f++) if (this.gait.feet[f].landed) { this.gait.feet[f].landed = false; if (!this.footEvent && this.gait.moving) this.footEvent = 'step'; }

    // ---- target pose
    const tgt = this.tgt;
    this.runW = damp(this.runW, this.gait.moving ? 1 : 0, 11, dt);
    this.airW = damp(this.airW, grounded || p.mv !== 0 ? 0 : 1, 14, dt);
    this.locomotion(p, time, dt, vF, vR, speed);
    let bodyAdditive = 1; // aim / lean / flinch strength

    // movement signatures
    this.movement(p, time, dt, vF, vR, speed);

    // actions
    let shake = 0, aimArms = 0;
    if (this.actDef && this.actKind && p.act >= 0) {
      const d = this.actDef;
      const r = evalAction(this.actKind, cfg.cls, d, p.actT, this.actP);
      if (r) {
        const legW = r.fullBody || d.moveMul <= 0 ? 1 : 1 - smooth(1.2, 3.2, speed) * (grounded ? 1 : 1);
        const pw = this.partW;
        pw.fill(1);
        pw[P_LEGS] = grounded ? legW : (r.fullBody ? 1 : 0);
        pw[P_HIPS] = grounded ? 0.45 + 0.55 * legW : 0.6;
        tgt.layer(this.actP, r.w, pw);
        shake = r.shake * r.w; aimArms = r.aim * r.w;
      }
    }
    if (p.stealth && !cfg.dummy) tgt.layer(POSES.sneak, 0.85);

    // reactions
    if (p.rooted && grounded) this.rootedStrain(time);
    if (this.stagW > 0.002 || p.stun > 0) {
      this.stagW = damp(this.stagW, p.stun > 0 ? 1 : 0, p.stun > 0 ? 40 : 9, dt);
      const pw = this.partW;
      pw.fill(1); pw[P_ARML] = this.stagL; pw[P_ARMR] = this.stagR; pw[P_LEGS] = 0; pw[P_HIPS] = 0.7;
      tgt.layer(POSES.stagger, this.stagW * 0.85, pw);
    }
    if (p.bubbled) { this.bubblePose(time); bodyAdditive = 0; }
    if (p.launched && p.alive) { this.tumblePose(p, time, dt, vF, vR); bodyAdditive = 0.3; }
    else if (p.down > 0 && p.alive) { this.downPose(p, time); bodyAdditive = p.down < GETUP_TIME ? 1 - p.down / GETUP_TIME : 0; }
    if (!p.alive) { this.deathPose(p, time, dt, vF, vR); bodyAdditive = 0; }

    // ---- additive layers
    this.additive(p, time, dt, vF, vR, speed, bodyAdditive, aimArms, shake);

    // ---- inertialize -> out
    this.inertialize(dt);

    // ---- solve
    this.finishSkeleton(p, dt, time, false);

    // ---- remember
    this.px = p.x; this.py = p.y; this.pz = p.z; this.pvx = p.vx; this.pvy = p.vy; this.pvz = p.vz;
    this.pAct = p.act; this.pActT = p.actT; this.pMv = p.mv; this.pGround = grounded; this.pLaunched = p.launched; this.pDown = p.down;
    this.pBubbled = p.bubbled; this.pAlive = p.alive; this.pFrozen = p.frozen; this.pStun = p.stun; this.pFace = p.face; this.pRooted = p.rooted; this.pStealth = p.stealth;
    this.first = false;
  }

  // ----------------------------------------------------------------------------------------
  // locomotion
  // ----------------------------------------------------------------------------------------
  private locomotion(p: PlayerView, time: number, dt: number, vF: number, vR: number, speed: number): void {
    const g = this.gait, c = this.carry, d = this.locoDef;
    const rw = this.runW, k = g.k * rw;
    const cyc = g.phase * TAU;
    const dummy = this.cfg.dummy;
    const idleAmt = 1 - rw;
    const breath = Math.sin(time * 1.7 + this.cfg.seed);
    const sway = dummy ? 0 : Math.sin(time * 0.55 + this.cfg.seed * 1.3);
    const hipYawDeg = g.hipYaw / DEG;
    const bob = -(0.008 + 0.024 * k) * Math.cos(2 * TAU * (g.phase - g.duty * 0.5));
    const tw = Math.cos(cyc); // +1 at left touchdown
    // hips
    const back = g.backward ? 1 : 0;
    set3(d.hp!, lerp(sway * 0.014, 0, rw), lerp(-c.crouch + breath * 0.003, -0.025 - 0.03 * k + bob, rw), lerp(0, 0.02 * k * (1 - 2 * back), rw));
    set3(d.hr!, lerp(dummy ? 0 : 3, (5 + 9 * k) * (1 - 1.7 * back), rw), lerp(dummy ? 0 : -14, hipYawDeg - 8 * k * tw, rw), lerp(sway * 1.5, 3 * k * Math.sin(cyc), rw));
    set3(d.sp!, lerp(c.hunch * 0.5, 3 + 4 * k, rw), lerp(dummy ? 0 : 5, -hipYawDeg * 0.45 + 5 * k * tw, rw), 0);
    set3(d.ch!, lerp(c.hunch * 0.5 + 1 + breath * 1.1, 2 + 3 * k, rw), lerp(dummy ? 0 : 6, -hipYawDeg * 0.55 + 9 * k * tw, rw), lerp(-sway * 1.2, -2 * k * Math.sin(cyc), rw));
    // idle look-around
    const look = dummy ? 0 : this.glance(time, dt) * idleAmt;
    set3(d.nk!, lerp(-1, -3 - 3 * k, rw), look * 0.4, 0);
    set3(d.hd!, lerp(-c.hunch - 2, -5 - 5 * k, rw), lerp(3, -4 * k * tw, rw) + look * 0.6, 0);
    // stance
    set3(d.stL!, lerp(-0.015, 0, rw), lerp(0.1, 0, rw), 0);
    set3(d.stR!, lerp(0.025, 0, rw), lerp(-0.1, 0, rw), lerp(dummy ? 0 : -16, 0, rw));
    if (dummy) { set3(d.stL!, -0.02, 0, 4); set3(d.stR!, 0.02, 0, -4); }
    // arms
    const sw = -tw * rw; // + = left arm forward
    const R = d.R as ArmDef, L = d.L as ArmDef;
    const air = this.airW;
    lerp3(R.h!, c.iR, c.rR, rw);
    R.h![2] += -c.rSw * sw * (0.5 + 0.5 * k); R.h![1] += Math.abs(sw) * 0.03 * k + breath * 0.004 * idleAmt + air * 0.06; R.h![0] += air * 0.08;
    if (R.w) lerp3(R.w, c.iW, c.rW, rw);
    lerp3(L.h!, c.iL, c.rL, rw);
    L.h![2] += c.lSw * sw * (0.45 + 0.55 * k); L.h![1] += Math.abs(sw) * 0.05 * k - breath * 0.004 * idleAmt + air * 0.16; L.h![0] -= air * 0.16;
    R.open = c.openR; L.open = lerp(c.openL, c.openL * 0.5, rw);
    d.grip = c.grip;
    compilePose(d, this.tgt);
    this.tgt.mask.fill(1);
    // airborne
    if (air > 0.002) {
      const up = smooth(-3, 4, p.vy);
      this.tmpP.mix(POSES.airFall, POSES.airRise, up);
      const pw = this.partW; pw.fill(1); pw[P_ARML] = 0; pw[P_ARMR] = 0;
      this.tgt.layer(this.tmpP, air, pw);
      this.tgt.mask.fill(1);
    }
  }

  private glance(time: number, dt: number): number {
    // an occasional look to one side
    const n = noise1(time * 0.23 + this.cfg.seed * 3.7, 3);
    const a = Math.abs(n);
    this.lookT = damp(this.lookT, a > 0.42 ? Math.sign(n) * smooth(0.42, 0.7, a) : 0, 3, dt);
    return this.lookT * 34;
  }

  // ----------------------------------------------------------------------------------------
  // movement signatures
  // ----------------------------------------------------------------------------------------
  private movement(p: PlayerView, time: number, dt: number, vF: number, vR: number, speed: number): void {
    const tgt = this.tgt;
    const mv = p.mv;
    if (mv === MV_DASH) {
      const mF = speed > 0.5 ? vF / speed : 1, mR = speed > 0.5 ? vR / speed : 0;
      const d = this.dashDef;
      const flut = Math.sin(time * 40) * 0.02;
      set3(d.hp!, mR * 0.08, -0.24, mF * 0.1);
      set3(d.hr!, 44 * mF - 6 * Math.abs(mR), -22 * mR * (mF >= 0 ? 1 : -1), 36 * mR);
      set3(d.hd!, -38 * mF, 0, -20 * mR);
      set3(d.R!.h!, 0.16 - 0.2 * mR, -0.3, -0.36 * mF - 0.05);
      set3(d.L!.h!, -0.16 - 0.2 * mR, -0.3, -0.38 * mF - 0.05);
      set3(d.R!.w!, 0.2 - mR * 0.6, 0.1, -0.95 * mF + 0.01);
      set3(d.fL!.p, -0.1 + 0.34 * mR, 0.3 + flut, 0.42 * mF);
      set3(d.fL!.r!, -20 * mF, 0, 0);
      set3(d.fR!.p, 0.1 - 0.5 * mR, 0.25 - flut, -0.75 * mF);
      set3(d.fR!.r!, 60 * Math.max(0.2, mF), 0, 0);
      compilePose(d, this.tmpP);
      tgt.layer(this.tmpP, 1);
    } else if (mv === MV_GLIDE) {
      tgt.layer(POSES.glide, 1);
      // lean into the carve, bob on the ice
      const roll = clamp(this.turnRate * -9, -22, 22) + clamp(this.accR * 0.4, -10, 10);
      tgt.hipsQ.premultiply(qEuler(_q, 0, 0, roll));
      tgt.hipsP.y += Math.sin(time * 9) * 0.012;
    } else if (mv === MV_LEAP) {
      this.tmpP.mix(POSES.leapFall, POSES.leapRise, smooth(-5, 4, p.vy));
      tgt.layer(this.tmpP, 1);
    } else if (mv === MV_SOAR) {
      const u = smooth(0.18, 0.5, this.mvT);
      this.tmpP.mix(POSES.soarBurst, POSES.soarGlide, u);
      tgt.layer(this.tmpP, 1);
      const pitch = (clamp(speed / 9, 0, 1) * 32 - 20 - clamp(p.vy * 2.2, -22, 30)) * u;
      const rollS = clamp(vR * 3.2 + this.turnRate * -8, -30, 30) * u;
      tgt.hipsQ.premultiply(qEuler(_q, pitch, 0, rollS));
      const fl = Math.sin(time * 7) * 0.02 * u;
      tgt.footP[0].y += fl; tgt.footP[1].y -= fl;
    } else if (mv === MV_SURGE) {
      tgt.layer(POSES.surge, 1);
      const roll = clamp(this.turnRate * -10 + vR * 2, -35, 35);
      tgt.hipsQ.premultiply(qEuler(_q, 0, 0, roll));
      const kick = Math.sin(time * 26) * 0.07;
      tgt.footP[0].y += kick; tgt.footP[1].y -= kick;
      tgt.hipsP.y += Math.sin(time * 13) * 0.02;
    } else if (mv === MV_RAY) {
      tgt.layer(POSES.ray, 1);
      // lay the whole body along the velocity
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      if (sp > 0.5) {
        _v.set(vR / sp, p.vy / sp, -vF / sp);
        tgt.rootQ.setFromUnitVectors(Y, _v);
      } else tgt.rootQ.setFromAxisAngle(X, -80 * DEG);
      tgt.rootP.set(0, 0, 0);
    }
    // phases around the modes
    if (this.actKind === 'leap' && p.act >= 0 && mv === 0 && this.actDef && p.actT < this.actDef.windup + 0.03 && this.landT > 0.4) {
      tgt.layer(POSES.leapCrouch, easeOut(clamp01(p.actT / Math.max(0.04, this.actDef.windup * 0.6))));
    }
    if (this.landT < 0.5 && mv === 0) tgt.layer(POSES.leapLand, 1 - smooth(0.2, 0.5, this.landT));
    if (this.rayEndT < 0.4 && mv === 0) tgt.layer(POSES.rayEnd, 1 - smooth(0.1, 0.4, this.rayEndT));
    if (this.meldT < 0.5) tgt.layer(POSES.meld, 1 - smooth(0.22, 0.5, this.meldT));
  }

  // ----------------------------------------------------------------------------------------
  // reactions
  // ----------------------------------------------------------------------------------------
  private startFlinch(dvx: number, dvz: number, cf: number, sf: number, p: PlayerView): void {
    this.flinchN++;
    const n = this.flinchN * 7 + this.cfg.seed;
    const r1 = hash11(n) * 2 - 1, r2 = hash11(n + 1) * 2 - 1, r3 = hash11(n + 2);
    // knock direction in body space (from the velocity change); random if there was none
    let kF = -dvx * sf - dvz * cf, kR = dvx * cf - dvz * sf;
    const kl = Math.hypot(kF, kR);
    if (kl > 0.6) { kF /= kl; kR /= kl; } else { kF = -0.8; kR = r1 * 0.6; }
    const s = 1;
    this.flP.kick(kF * 520 * s + r2 * 90);
    this.flR.kick(kR * 420 * s + r1 * 110);
    this.flY.kick(r1 * 380 + kR * 200);
    this.flX.kick(kR * 1.5); this.flZ.kick(-kF * 1.7);
    this.stagL = 0.45 + r3 * 0.55; this.stagR = 0.45 + (1 - r3) * 0.55;
    this.sqS.kick(-2.4);
    this.inert(0.08);
    void p;
  }

  private rootedStrain(time: number): void {
    const tgt = this.tgt;
    const a = Math.sin(time * 5.3), b = Math.sin(time * 3.1 + 1), c = Math.sin(time * 7.7 + 2);
    tgt.layer(POSES.strain, 0.55 + 0.25 * a);
    tgt.hipsQ.premultiply(qEuler(_q, 3 * b, 9 * a, 5 * c));
    tgt.q[Q_CHEST].premultiply(qEuler(_q, 4 * c, -8 * b, 4 * a));
    tgt.hipsP.y += 0.03 * Math.max(0, a);
  }

  private bubblePose(time: number): void {
    const tgt = this.tgt;
    tgt.layer(POSES.bubble, 1);
    const s = this.cfg.seed;
    qEuler(tgt.rootQ, 18 * Math.sin(time * 0.9 + s), (time * 34) % 360, 14 * Math.sin(time * 0.7 + 1 + s));
    tgt.rootP.set(0, 0.08 + 0.05 * Math.sin(time * 1.3), 0);
    tgt.q[Q_UARML].premultiply(qEuler(_q, 6 * Math.sin(time * 1.7), 0, 0));
    tgt.footP[0].y += 0.03 * Math.sin(time * 1.9); tgt.footP[1].y += 0.03 * Math.sin(time * 1.6 + 1);
  }

  private tumbleRoot(ang: number): void {
    // Ry(psi) * Rx(+-ang): backward tumbles rotate the head toward +Z, forward ones toward -Z
    _q.setFromAxisAngle(Y, this.tumblePsi);
    _q2.setFromAxisAngle(X, this.tumbleFwd ? -ang : ang);
    this.tgt.rootQ.multiplyQuaternions(_q, _q2);
  }

  private tumblePose(p: PlayerView, time: number, dt: number, vF: number, vR: number): void {
    const tgt = this.tgt;
    const sp = Math.hypot(p.vx, p.vy, p.vz);
    this.tumble += dt * clamp(4.5 + sp * 0.42, 4.5, 13);
    // follow the direction of travel
    const hl = Math.hypot(vF, vR);
    if (hl > 1.5) {
      const psi = this.tumbleFwd ? Math.atan2(-vR, vF) : Math.atan2(vR, -vF);
      this.tumblePsi += wrapAngle(psi - this.tumblePsi) * (1 - Math.exp(-6 * dt));
    }
    const fl = 0.5 + 0.5 * Math.sin(this.tumble * 1.3 + this.cfg.seed);
    this.tmpP.mix(POSES.tumbleA, POSES.tumbleB, fl);
    tgt.layer(this.tmpP, 1);
    this.tumbleRoot(this.tumble);
    tgt.rootP.set(0, 0, 0);
    void time;
  }

  private downPose(p: PlayerView, time: number): void {
    const tgt = this.tgt;
    const lie = this.lieSupine ? POSES.lieBack : POSES.lieFront;
    const layDown = (): void => {
      this.tmpP2.copy(lie);
      this.tmpP2.mask[P_ROOT] = 1;
      _q.setFromAxisAngle(Y, this.tumblePsi);
      _q2.setFromAxisAngle(X, (this.tumbleFwd ? -this.lieAng : this.lieAng) * DEG);
      this.tmpP2.rootQ.multiplyQuaternions(_q, _q2);
      this.tmpP2.rootP.set(0, -0.79, 0);
    };
    if (p.down >= GETUP_TIME) {
      layDown();
      tgt.layer(this.tmpP2, 1);
      // a last breath of movement: the body settles
      tgt.rootP.y += 0.012 * Math.sin(time * 2.2);
    } else {
      const u = 1 - p.down / GETUP_TIME;
      layDown();
      // lie -> tuck -> stand
      if (u < 0.5) {
        const a = easeInOut(u / 0.5);
        // base for the tuck is the standing target with the tuck layered in
        this.tmpP.copy(tgt); this.tmpP.layer(POSES.getupTuck, 1);
        this.tmpP.rootQ.identity(); this.tmpP.rootP.set(0, 0, 0); this.tmpP.mask.fill(1);
        this.tmpP2.mask.fill(1);
        // un-posed parts of the lying pose come from the standing target
        this.actP.copy(tgt); this.actP.layer(this.tmpP2, 1); this.actP.mask.fill(1);
        if (a > 0.45) { this.actP.footW[0] = 0; this.actP.footW[1] = 0; }
        tgt.mix(this.actP, this.tmpP, a);
      } else {
        const a = easeInOut((u - 0.5) / 0.5);
        tgt.layer(POSES.getupTuck, 1 - a);
      }
    }
  }

  private deathPose(p: PlayerView, time: number, dt: number, vF: number, vR: number): void {
    const tgt = this.tgt;
    const t = this.deathT;
    if (this.deathAir || !p.onGround) {
      this.tumblePose(p, time, dt, vF, vR);
      this.dissolve = smooth(0.35, 1.5, t);
      return;
    }
    // knees buckle, then down onto the back
    const a = easeOut(clamp01(t / 0.3), 2);
    tgt.layer(POSES.buckle, a);
    const b = easeInOut(clamp01((t - 0.22) / 0.45));
    if (b > 0) {
      this.tmpP2.copy(POSES.lieBack);
      this.tmpP2.mask[P_ROOT] = 1;
      this.tmpP2.rootQ.setFromAxisAngle(X, 90 * DEG);
      this.tmpP2.rootP.set(0, -0.79, 0);
      this.actP.copy(tgt); this.actP.layer(this.tmpP2, 1); this.actP.mask.fill(1);
      this.tmpP.copy(tgt); this.tmpP.mask.fill(1);
      tgt.mix(this.tmpP, this.actP, b);
    }
    this.dissolve = smooth(0.9, 2.1, t);
  }

  // ----------------------------------------------------------------------------------------
  // additive: aim, lean, flinch, landing, tremble
  // ----------------------------------------------------------------------------------------
  private additive(p: PlayerView, time: number, dt: number, vF: number, vR: number, speed: number, amt: number, aimArms: number, shake: number): void {
    const tgt = this.tgt;
    const dummy = this.cfg.dummy;
    // springs always run
    const fp = this.flP.step(0, 3.4, 0.42, dt), fy = this.flY.step(0, 3.0, 0.45, dt), fr = this.flR.step(0, 3.2, 0.42, dt);
    const fx = this.flX.step(0, 3.2, 0.5, dt), fz = this.flZ.step(0, 3.2, 0.5, dt);
    const land = this.hipS.step(0, 3.6, 0.5, dt);
    this.squash = this.sqS.step(0, 6, 0.42, dt);
    const leanP = this.leanP.crit(clamp(this.accF * 0.32, -13, 13), 14, dt);
    const leanR = this.leanR.crit(clamp(this.accR * 0.32 + this.turnRate * speed * -0.35, -13, 13), 14, dt);
    const yawT = dummy ? 0 : clamp(wrapAngle(p.aimYaw - p.face), -1.35, 1.35);
    const ay = this.aimY.crit(yawT, 18, dt) / DEG, ap = this.aimP.crit(dummy ? 0 : clamp(p.aimPitch, -1.1, 1.1), 18, dt) / DEG;
    if (amt <= 0.001) return;
    // lean + flinch on the hips
    tgt.hipsQ.premultiply(qEuler(_q, (leanP + clamp(fp, -40, 40) * 0.35) * amt, 0, (leanR + clamp(fr, -35, 35) * 0.35) * amt));
    tgt.hipsP.x += clamp(fx, -0.2, 0.2) * amt; tgt.hipsP.z += clamp(fz, -0.22, 0.22) * amt;
    tgt.hipsP.y += clamp(land, -0.38, 0.1) * amt;
    // flinch through the spine
    const cp = clamp(fp, -45, 45), cy = clamp(fy, -40, 40), cr = clamp(fr, -35, 35);
    tgt.q[Q_SPINE].premultiply(qEuler(_q, (cp * 0.3 - ap * 0.12) * amt, (cy * 0.25 + ay * 0.15) * amt, cr * 0.25 * amt));
    tgt.q[Q_CHEST].premultiply(qEuler(_q, (cp * 0.4 - ap * 0.14) * amt, (cy * 0.4 + ay * 0.25) * amt, cr * 0.3 * amt));
    tgt.q[Q_NECK].premultiply(qEuler(_q, (cp * 0.2 - ap * 0.2) * amt, (-cy * 0.2 + ay * 0.25) * amt, cr * 0.2 * amt));
    tgt.q[Q_HEAD].premultiply(qEuler(_q, (cp * 0.45 - ap * 0.3) * amt, (-cy * 0.3 + ay * 0.35) * amt, cr * 0.3 * amt));
    // arms follow the aim pitch during casts
    if (aimArms > 0.001) {
      _q.setFromAxisAngle(X, ap * DEG * 0.72 * aimArms * amt);
      tgt.q[Q_UARML].premultiply(_q); tgt.q[Q_UARMR].premultiply(_q);
    }
    if (shake > 0.001) {
      const s = shake * 2.2;
      tgt.q[Q_UARML].premultiply(qEuler(_q, noise1(time * 31, 1) * s, noise1(time * 29, 2) * s, 0));
      tgt.q[Q_UARMR].premultiply(qEuler(_q, noise1(time * 33, 3) * s, noise1(time * 27, 4) * s, 0));
      tgt.q[Q_CHEST].premultiply(qEuler(_q, noise1(time * 23, 5) * s * 0.5, noise1(time * 19, 6) * s * 0.5, 0));
      tgt.hipsP.y -= shake * 0.012 * (1 + noise1(time * 17, 7));
    }
  }

  // ----------------------------------------------------------------------------------------
  private inertialize(dt: number): void {
    const tgt = this.tgt, out = this.out, last = this.last;
    if (this.iPending && !this.first) {
      // offsets from the new target back to what was on screen
      this.offQ[0].copy(_qi.copy(tgt.hipsQ).invert()).premultiply(last.hipsQ);
      this.offQ[1].copy(_qi.copy(tgt.rootQ).invert()).premultiply(last.rootQ);
      for (let i = 0; i < Q_COUNT; i++) this.offQ[i + 2].copy(_qi.copy(tgt.q[i]).invert()).premultiply(last.q[i]);
      this.offHips.subVectors(last.hipsP, tgt.hipsP);
      this.offRoot.subVectors(last.rootP, tgt.rootP);
      this.offGrip = last.grip - tgt.grip; this.offOpenL = last.openL - tgt.openL; this.offOpenR = last.openR - tgt.openR;
      this.iT = 0;
      for (let f = 0; f < 2; f++) {
        if (tgt.footW[f] > 0.5 && this.wasOver[f]) { this.footOff[f].subVectors(this.lastAnkle[f], tgt.footP[f]); this.footOffT[f] = 0; this.footOffDur[f] = this.iDur; }
      }
    }
    this.iPending = false;
    out.copy(tgt);
    if (this.iT < this.iDur) {
      this.iT += dt;
      const u = clamp01(this.iT / this.iDur);
      const k = this.iSharp ? (1 - u) * (1 - u) * (1 - u) : (1 - u) * (1 - u) * (1 + 2 * u);
      if (k > 1e-4) {
        out.hipsQ.premultiply(slerpU(_q, _qId, this.offQ[0], k));
        out.rootQ.premultiply(slerpU(_q, _qId, this.offQ[1], k));
        for (let i = 0; i < Q_COUNT; i++) out.q[i].premultiply(slerpU(_q, _qId, this.offQ[i + 2], k));
        out.hipsP.addScaledVector(this.offHips, k);
        out.rootP.addScaledVector(this.offRoot, k);
        out.grip = clamp01(out.grip + this.offGrip * k); out.openL += this.offOpenL * k; out.openR += this.offOpenR * k;
      }
    }
    last.copy(out);
  }

  // ----------------------------------------------------------------------------------------
  // skeleton
  // ----------------------------------------------------------------------------------------
  private finishSkeleton(p: PlayerView, dt: number, time: number, hold: boolean): void {
    const sk = this.skel, out = this.out, g = this.gait;
    const lq = sk.lq;
    if (!hold) {
      sk.lq[B.root].identity(); sk.lp[B.root].set(0, 0, 0);
      // hips
      sk.lp[B.hips].copy(REST_LOCAL[B.hips]).add(out.hipsP);
      // keep planted legs within reach: sink the hips rather than let a foot float
      let need = 0;
      for (let f = 0; f < 2; f++) {
        const ft = g.feet[f];
        if (out.footW[f] > 0.5 || !ft.planted) continue;
        Gait.ankle(ft, _an);
        _hip.copy(REST_LOCAL[f === 0 ? B.ulegL : B.ulegR]).applyQuaternion(out.hipsQ).add(sk.lp[B.hips]);
        const dh = Math.hypot(_an.x - _hip.x, _an.z - _hip.z);
        const maxL = (ULEG_LEN + LLEG_LEN) * 0.992;
        if (dh < maxL) need = Math.max(need, _hip.y - (_an.y + Math.sqrt(maxL * maxL - dh * dh)));
        else need = Math.max(need, 0.3);
      }
      this.hipDrop = need > this.hipDrop ? need : damp(this.hipDrop, need, 12, dt);
      sk.lp[B.hips].y -= clamp(this.hipDrop, 0, 0.4);
      lq[B.hips].copy(out.hipsQ);
      for (let i = 0; i < Q_COUNT; i++) lq[Q_BONE[i]].copy(out.q[i]);
      // fingers
      lq[B.fingR].setFromAxisAngle(Z, -lerp(100, 8, clamp01(out.openR)) * DEG);
      lq[B.fingL].setFromAxisAngle(Z, lerp(100, 8, clamp01(out.openL)) * DEG);
      sk.solve(0, B.hips + 1);
      this.solveLegs(p, dt);
      sk.solve(B.spine, B.weapon + 1);
      this.gripIK();
      // whole-body transform
      if (out.rootQ.w < 0.99999 || out.rootP.lengthSq() > 1e-8) sk.transformAll(out.rootQ, PIVOT, out.rootP);
    }
    this.secondary(p, hold ? 0 : dt, time);
    sk.flush();
  }

  private solveLegs(p: PlayerView, dt: number): void {
    const sk = this.skel, out = this.out, g = this.gait;
    const hq = sk.wq[B.hips];
    for (let f = 0; f < 2; f++) {
      const ul = f === 0 ? B.ulegL : B.ulegR, ll = ul + 1, ft = ul + 2, toe = ul + 3;
      const gf = g.feet[f];
      const over = out.footW[f] > 0.5;
      let toePitch = 0;
      if (over) {
        if (!this.wasOver[f]) {
          // the pose takes this foot off the ground: ease from where it was
          this.footOff[f].subVectors(this.lastAnkle[f], out.footP[f]);
          this.footOffT[f] = 0; this.footOffDur[f] = 0.11;
          gf.free = true;
        }
        _ank.copy(out.footP[f]);
        if (this.footOffT[f] < this.footOffDur[f]) {
          this.footOffT[f] += dt;
          const u = clamp01(this.footOffT[f] / this.footOffDur[f]);
          _ank.addScaledVector(this.footOff[f], (1 - u) * (1 - u) * (1 + 2 * u));
        }
        // foot orientation follows the hips for posed feet
        _qF.copy(hq).multiply(out.footQ[f]);
        if (dt > 0) this.lastFootQ[f].slerp(_qF, 1 - Math.exp(-30 * dt)); else this.lastFootQ[f].copy(_qF);
        _qF.copy(this.lastFootQ[f]);
        _pole.copy(out.knee[f]).applyQuaternion(hq);
        this.plantHad[f] = false;
      } else {
        if (this.wasOver[f]) {
          // hand the foot back to the gait from its current place (ankle -> ball)
          const la = this.lastAnkle[f];
          const yaw = this.lastFootYaw[f];
          g.release(f, this.gin, la.x - 0.13 * Math.sin(yaw), Math.max(0, la.y - 0.09), la.z - 0.13 * Math.cos(yaw), yaw);
          g.update({ ...this.gin, dt: 0 });
        }
        Gait.ankle(gf, _an);
        _ank.set(_an.x, _an.y, _an.z);
        _q.setFromAxisAngle(Y, gf.yaw);
        _qF.copy(_q).multiply(_q2.setFromAxisAngle(X, -gf.pitch));
        this.lastFootQ[f].copy(_qF);
        toePitch = Math.max(0, gf.pitch);
        // knees point where the foot points, splayed a little with the hips
        _pole.set(-Math.sin(gf.yaw) + (f === 0 ? -0.12 : 0.12), 0.1, -Math.cos(gf.yaw));
        _v.set(0, 0, -1).applyQuaternion(hq);
        _pole.addScaledVector(_v, 0.8);
      }
      this.wasOver[f] = over;
      _hip.copy(REST_LOCAL[ul]).applyQuaternion(hq).add(sk.wp[B.hips]);
      twoBoneIK(_hip, _ank, ULEG_LEN, LLEG_LEN, _pole, true, _qU, _qL, undefined, _v4);
      sk.lq[ul].copy(_qi.copy(hq).invert()).multiply(_qU);
      sk.lq[ll].copy(_qi.copy(_qU).invert()).multiply(_qL);
      sk.lq[ft].copy(_qi.copy(_qL).invert()).multiply(_qF);
      sk.lq[toe].setFromAxisAngle(X, toePitch);
      this.lastAnkle[f].copy(_v4);
      // yaw of the foot (for handing back to the gait)
      _v.set(0, 0, -1).applyQuaternion(_qF);
      this.lastFootYaw[f] = Math.atan2(-_v.x, -_v.z);
    }
    void p;
  }

  private gripIK(): void {
    const sk = this.skel, out = this.out;
    const g2 = this.cfg.grip2;
    if (!g2 || out.grip < 0.01) return;
    const wq = sk.wq[B.weapon];
    sk.point(B.weapon, g2.x, g2.y, g2.z, _v);
    // wrist so that the left palm sits on the shaft
    _v2.set(0.03, -0.095, 0).applyQuaternion(wq);
    _v.sub(_v2);
    // the hand travels in a straight line between where the pose has it and the shaft
    const k = clamp01(out.grip);
    const ks = k * k * (3 - 2 * k);
    _v.lerpVectors(sk.wp[B.handL], _v, ks);
    _q3.copy(sk.wq[B.handL]).slerp(wq, ks);
    _pole.set(-0.5, -0.6, 0.6).applyQuaternion(sk.wq[B.chest]);
    twoBoneIK(sk.wp[B.uarmL], _v, UARM_LEN, LARM_LEN, _pole, false, _qU, _qL);
    const kq = Math.min(1, k * 5);
    _q.copy(_qi.copy(sk.wq[B.clavL]).invert()).multiply(_qU);
    sk.lq[B.uarmL].slerp(_q, kq);
    _q.copy(_qi.copy(_qU).invert()).multiply(_qL);
    sk.lq[B.larmL].slerp(_q, kq);
    _q.copy(_qi.copy(_qL).invert()).multiply(_q3);
    sk.lq[B.handL].slerp(_q, kq);
    sk.lq[B.fingL].setFromAxisAngle(Z, lerp(100, lerp(100, 8, clamp01(out.openL)), 1 - k) * DEG);
    sk.solve(B.uarmL, B.fingL + 1);
  }

  // ----------------------------------------------------------------------------------------
  // secondary motion (world space)
  // ----------------------------------------------------------------------------------------
  private toWorld(v: Vector3, p: PlayerView): Vector3 {
    const c = Math.cos(p.face), s = Math.sin(p.face);
    const x = v.x * c + v.z * s, z = -v.x * s + v.z * c;
    return v.set(x + p.x, v.y + p.y, z + p.z);
  }
  private toModel(v: Vector3, p: PlayerView): Vector3 {
    const c = Math.cos(p.face), s = Math.sin(p.face);
    const dx = v.x - p.x, dz = v.z - p.z;
    return v.set(dx * c - dz * s, v.y - p.y, dx * s + dz * c);
  }
  private shiftSecondary(dx: number, dy: number, dz: number): void {
    for (const ch of this.cloak) for (const pt of ch) pt.p.x += dx, pt.p.y += dy, pt.p.z += dz;
    for (const j of this.jiggles) for (const pt of j.parts) pt.p.x += dx, pt.p.y += dy, pt.p.z += dz;
  }

  private secondary(p: PlayerView, dt: number, time: number): void {
    const sk = this.skel, cfg = this.cfg;
    const segs = cfg.cloakSegs;
    const chestQ = sk.wq[B.chest];
    const init = !this.secInit;
    this.secInit = true;
    const low = cfg.quality === 'low';
    _q3.setFromAxisAngle(Y, p.face); // model -> world rotation
    const steps = dt <= 0 ? 0 : low ? 1 : dt > 0.02 ? 2 : 1;
    const h = steps ? dt / steps : 0;

    // ---- cloak
    for (let c = 0; c < 3; c++) {
      const chain = this.cloak[c];
      const b0 = CLOAK_BONES[c][0];
      // anchor rides the chest
      sk.wp[b0].copy(REST_LOCAL[b0]).applyQuaternion(chestQ).add(sk.wp[B.chest]);
      if (segs === 0) {
        // unused bones: park them rigidly on the chest
        for (let s = 0; s < 3; s++) {
          const bone = CLOAK_BONES[c][s];
          sk.wq[bone].copy(chestQ);
          if (s > 0) sk.wp[bone].copy(REST_WORLD[bone]).sub(REST_WORLD[B.chest]).applyQuaternion(chestQ).add(sk.wp[B.chest]);
        }
        continue;
      }
      if (low && c !== 1) continue;
      const anchorW = this.toWorld(_v.copy(sk.wp[b0]), p);
      if (init) {
        let prev = _v2.copy(sk.wp[b0]);
        for (let s = 0; s < 3; s++) {
          const pt = chain[s];
          _v3.copy(pt.restDir).applyQuaternion(chestQ).multiplyScalar(pt.len).add(prev);
          prev = _v2.copy(_v3);
          this.toWorld(pt.p.copy(_v3), p); pt.v.set(0, 0, 0);
        }
      }
      for (let it = 0; it < steps; it++) {
        for (let s = 0; s < 3; s++) {
          const pt = chain[s];
          // gravity, air drag, a breath of wind; a stiffness pull toward the draped rest shape
          pt.v.y -= 17 * h;
          const drag = Math.exp(-3.4 * h);
          pt.v.x *= drag; pt.v.z *= drag; pt.v.y *= Math.exp(-1.1 * h);
          pt.v.x += Math.sin(time * 1.3 + s * 1.7 + c) * 0.5 * h; pt.v.z += Math.cos(time * 1.1 + s * 1.3 + c * 2) * 0.5 * h;
          _v4.copy(pt.p);
          pt.p.addScaledVector(pt.v, h);
          const par = s === 0 ? anchorW : chain[s - 1].p;
          // distance constraint
          _v2.subVectors(pt.p, par);
          const d = _v2.length() || 1e-5;
          pt.p.copy(par).addScaledVector(_v2, pt.len / d);
          this.collideCloak(pt.p, p, c);
          // keep the length after collision
          _v2.subVectors(pt.p, par);
          const d2 = _v2.length() || 1e-5;
          pt.p.copy(par).addScaledVector(_v2, pt.len / d2);
          pt.v.subVectors(pt.p, _v4).multiplyScalar(1 / h);
          if (pt.v.lengthSq() > 900) pt.v.setLength(30);
        }
      }
    }
    if (segs > 0) {
      if (low) {
        // side chains copy the centre chain's sway
        for (let s = 0; s < 3; s++) {
          for (const c of [0, 2]) {
            const src = this.cloak[1], dst = this.cloak[c];
            const b0 = CLOAK_BONES[c][0];
            const a = this.toWorld(_v.copy(sk.wp[b0]), p), ac = this.toWorld(_v2.copy(sk.wp[CLOAK_BONES[1][0]]), p);
            dst[s].p.copy(src[s].p).sub(ac).add(a);
            dst[s].p.x += (c === 0 ? -1 : 1) * 0.03 * (s + 1) * Math.cos(p.face); dst[s].p.z += (c === 0 ? 1 : -1) * 0.03 * (s + 1) * Math.sin(p.face);
          }
        }
      }
      for (let c = 0; c < 3; c++) {
        const chain = this.cloak[c];
        let from = _v.copy(sk.wp[CLOAK_BONES[c][0]]);
        for (let s = 0; s < 3; s++) {
          const bone = CLOAK_BONES[c][s], pt = chain[s];
          const to = this.toModel(_v2.copy(pt.p), p);
          _v3.subVectors(to, from).normalize();
          _v4.copy(pt.restDir).applyQuaternion(chestQ);
          sk.wq[bone].setFromUnitVectors(_v4, _v3).multiply(chestQ);
          sk.wp[bone].copy(from);
          from = _v.copy(to);
        }
      }
    }

    // ---- jiggle chains
    for (const j of this.jiggles) {
      let parentQ = sk.wq[j.parent];
      let origin = _v.copy(REST_LOCAL[j.bones[0]]).applyQuaternion(parentQ).add(sk.wp[j.parent]);
      const baseQ = this.cloakQ.copy(parentQ);
      for (let i = 0; i < j.bones.length; i++) {
        const bone = j.bones[i], pt = j.parts[i];
        sk.wp[bone].copy(origin);
        // where the tip would be if rigid
        _v2.copy(pt.restDir).applyQuaternion(i === 0 ? baseQ : parentQ);
        const restTipW = this.toWorld(_v3.copy(_v2).multiplyScalar(pt.len).add(origin), p);
        const originW = this.toWorld(_v4.copy(origin), p);
        if (init) { pt.p.copy(restTipW); pt.v.set(0, 0, 0); }
        for (let it = 0; it < steps; it++) {
          const before = _hip.copy(pt.p);
          pt.v.y -= j.grav * h;
          pt.v.multiplyScalar(Math.exp(-j.drag * h));
          pt.p.addScaledVector(pt.v, h);
          pt.p.lerp(restTipW, 1 - Math.exp(-j.stiff * h));
          _ank.subVectors(pt.p, originW);
          const d = _ank.length() || 1e-5;
          pt.p.copy(originW).addScaledVector(_ank, pt.len / d);
          pt.v.subVectors(pt.p, before).multiplyScalar(1 / h);
          if (pt.v.lengthSq() > 400) pt.v.setLength(20);
        }
        const tip = this.toModel(_v3.copy(pt.p), p);
        _ank.subVectors(tip, origin).normalize();
        sk.wq[bone].setFromUnitVectors(_v2.normalize(), _ank).multiply(i === 0 ? baseQ : parentQ);
        parentQ = sk.wq[bone];
        origin = _v.copy(tip);
      }
    }
  }

  /** Keep a cloak particle (world space) out of the body. */
  private collideCloak(pt: Vector3, p: PlayerView, chain: number): void {
    const sk = this.skel;
    const push = (bone: number, ox: number, oy: number, oz: number, r: number): void => {
      sk.point(bone, ox, oy, oz, _hip);
      this.toWorld(_hip, p);
      _ank.subVectors(pt, _hip);
      const d = _ank.length();
      if (d < r && d > 1e-5) pt.copy(_hip).addScaledVector(_ank, r / d);
    };
    push(B.chest, 0, 0.02, 0, 0.225);
    push(B.spine, 0, 0, 0, 0.21);
    push(B.hips, 0, -0.05, 0.01, 0.245);
    push(B.hips, 0, -0.24, 0.0, 0.235);
    if (chain !== 2) { push(B.ulegL, 0, -0.2, 0, 0.14); push(B.llegL, 0, -0.1, 0, 0.11); }
    if (chain !== 0) { push(B.ulegR, 0, -0.2, 0, 0.14); push(B.llegR, 0, -0.1, 0, 0.11); }
    // never through the ground
    if (pt.y < p.y + 0.04) pt.y = p.y + 0.04;
  }
}

