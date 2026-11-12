// Procedural fighter (and training dummy) geometry: one skinned vertex stream per character.

import { BufferGeometry, Color, Vector3 } from 'three';
import type { QualityLevel } from '../../settings';
import { MeshBuilder, K_CLOTH, K_FUR, K_LEATHER, K_METAL, K_PLAIN, K_SKIN, K_WOOD, ringAt, ringPt, type Ring } from './meshgen';
import { B, REST, SHOULDER_X as SX, SHOULDER_Y as SY, HIP_X as HX, CLOAK_END_Y } from './rig';
import { clamp01, lerp, makeRng, smooth } from './mathx';
import type { Look } from './look';
import { buildWeapon, RUNES, type WeaponInfo } from './weapons';

export interface ModelInfo {
  geometry: BufferGeometry;
  weapon: WeaponInfo;
  triangles: number;
  vertices: number;
  /** How many cloak segments are in use (0 = no cloak). */
  cloakSegs: number;
  hasBraids: boolean; hasBeard: boolean; hasHair: boolean;
}

const QUAL: Record<QualityLevel, { seg: number; fur: number; cu: number; cv: number }> = {
  low: { seg: 7, fur: 0.4, cu: 4, cv: 5 },
  medium: { seg: 9, fur: 0.7, cu: 6, cv: 7 },
  high: { seg: 12, fur: 1, cu: 8, cv: 10 },
  ultra: { seg: 14, fur: 1.25, cu: 10, cv: 12 },
};

const mixc = (a: Color, b: Color, t: number): Color => a.clone().lerp(b, t);
const hex = (h: number): Color => new Color().setHex(h);
const _t = [0, 0, 0];

export function buildModel(look: Look, quality: QualityLevel): ModelInfo {
  const q = QUAL[quality];
  const b = new MeshBuilder();
  b.seg = q.seg;
  const rnd = makeRng(look.seed * 31 + 7);
  const info = look.dummy ? buildDummy(b, look, q, rnd) : buildFighter(b, look, q, rnd);
  const geometry = b.build();
  return { geometry, triangles: b.triangleCount, vertices: b.vertexCount, ...info };
}

type Q = { seg: number; fur: number; cu: number; cv: number };
type Parts = Omit<ModelInfo, 'geometry' | 'triangles' | 'vertices'>;

// ------------------------------------------------------------------------------------------
// shared pieces
// ------------------------------------------------------------------------------------------

const torsoSkin = (p: Vector3, mb: MeshBuilder): void => {
  const y = p.y;
  if (y < 0.93) {
    const leg = smooth(0.9, 0.7, y) * 0.82 * smooth(0.012, 0.085, Math.abs(p.x));
    if (leg > 0.01) mb.setSkin(B.hips, 1 - leg, p.x < 0 ? B.ulegL : B.ulegR, leg); else mb.setSkin(B.hips, 1);
  } else if (y < 1.06) mb.setSkin(B.hips, 1 - (y - 0.93) / 0.13, B.spine, (y - 0.93) / 0.13);
  else if (y < 1.22) mb.setSkin(B.spine, 1 - (y - 1.06) / 0.16, B.chest, (y - 1.06) / 0.16);
  else if (y < 1.47) mb.setSkin(B.chest, 1);
  else { const t = clamp01((y - 1.47) / 0.07); mb.setSkin(B.chest, 1 - t, B.neck, t); }
};

/** Shoulder gear follows the chest, and partly the upper arm toward the outside. */
const shoulderSkin = (amount: number) => (p: Vector3, mb: MeshBuilder): void => {
  const w = smooth(0.17, 0.34, Math.abs(p.x)) * amount;
  if (w > 0.01) mb.setSkin(B.chest, 1 - w, p.x < 0 ? B.uarmL : B.uarmR, w); else mb.setSkin(B.chest, 1);
};

function foot(b: MeshBuilder, col: Color, kind: number, scale = 1): void {
  // built along -Z: ring y = distance toward the toe, rf = down, rb = up
  b.push().translate(HX, 0, 0).rotX(-90);
  b.color(col).surf(kind, 0.85);
  const W = (t: number): [number, number, number] => [B.footR, B.toeR, smooth(0.1, 0.16, t)];
  const h = 0.046;
  b.loft([
    { y: -0.085, rx: 0.028 * scale, rf: 0.03, rb: 0.03, z: h, w: W(-0.08), sh: 0.8 },
    { y: -0.06, rx: 0.05 * scale, rf: 0.045, rb: 0.055, z: h, w: W(-0.06) },
    { y: 0.0, rx: 0.06 * scale, rf: 0.046, rb: 0.085, z: h, w: W(0) },
    { y: 0.075, rx: 0.064 * scale, rf: 0.046, rb: 0.055, z: h, w: W(0.075) },
    { y: 0.15, rx: 0.068 * scale, rf: 0.046, rb: 0.036, z: h, w: W(0.15) },
    { y: 0.215, rx: 0.06 * scale, rf: 0.042, rb: 0.03, z: h - 0.003, w: W(0.215) },
    { y: 0.262, rx: 0.036 * scale, rf: 0.03, rb: 0.022, z: h - 0.01, w: W(0.26), sh: 0.85 },
    { y: 0.275, rx: 0, z: h - 0.014, w: W(0.27) },
  ], { capA: true, seg: Math.max(6, b.seg - 2) });
  b.pop();
}

function hand(b: MeshBuilder, col: Color, kind: number, big = 1.14, rough = 0.75, metal = 0): void {
  // right hand; palm faces -X
  const s = big;
  b.color(col).surf(kind, rough, metal).rigid(B.handR);
  const seg = Math.max(6, b.seg - 4);
  b.loft([
    { x: SX, y: 0.865, rx: 0.027 * s, rz: 0.036 * s, ex: 3 },
    { x: SX, y: 0.83, rx: 0.031 * s, rz: 0.05 * s, ex: 3 },
    { x: SX, y: 0.772, rx: 0.031 * s, rz: 0.053 * s, ex: 3 },
  ].reverse(), { seg, capA: true });
  // thumb
  b.push().translate(SX - 0.008, 0.838, -0.046 * s).rotX(28).rotZ(-12);
  b.loft([{ y: 0, rx: 0.017 * s }, { y: -0.05 * s, rx: 0.016 * s }, { y: -0.078 * s, rx: 0.008 * s }], { seg: 5, capB: true });
  b.pop();
  b.rigid(B.fingR);
  b.loft([
    { x: SX, y: 0.782, rx: 0.029 * s, rz: 0.052 * s, ex: 3.5 },
    { x: SX, y: 0.73, rx: 0.027 * s, rz: 0.049 * s, ex: 3.5 },
    { x: SX + 0.002, y: 0.69, rx: 0.019 * s, rz: 0.04 * s, ex: 3 },
  ].reverse(), { seg, capA: true });
}

/** Rune glyph as glowing strokes; `place` maps glyph coords (-0.5..0.5) to a model-space point. */
function rune(b: MeshBuilder, look: Look, place: (gx: number, gy: number, out: Vector3) => void, nx: number, ny: number, nz: number, width: number, glow = 1.5): void {
  const p0 = new Vector3(), p1 = new Vector3();
  b.color(look.elColor).surf(K_PLAIN, 0.5, 0, glow);
  for (const s of RUNES[look.element]) {
    place(s[0], s[1], p0); place(s[2], s[3], p1);
    b.stroke(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, width, nx, ny, nz);
  }
}

// ------------------------------------------------------------------------------------------
// the fighter
// ------------------------------------------------------------------------------------------

function buildFighter(b: MeshBuilder, look: Look, q: Q, rnd: () => number): Parts {
  const S = look.shoulders, G = look.girth, L = look.limb;
  const el = look.element;
  const v = look.v;
  // baked ambient shading: darker toward the ground and in the lee of the shoulders
  b.shadeFn = (p) => lerp(0.8, 1, smooth(0, 0.55, p.y)) * (p.y > 1.2 && p.y < 1.42 ? 0.94 : 1);

  // ---------------------------------------------------------------- torso / tunic
  const armor = el === 'stone' || el === 'ember' ? (v[5] < 0.6 ? 2 : 1) : el === 'gale' ? 0 : el === 'dawn' ? 2 : el === 'umbra' ? 1 : v[5] < 0.35 ? 2 : v[5] < 0.75 ? 1 : 0;
  const tunicRings: Ring[] = [
    { y: 0.67, rx: 0.218 * G, rf: 0.156 * G, rb: 0.17 * G, ex: 2.3, sh: 0.62 },
    { y: 0.7, rx: 0.216 * G, rf: 0.154 * G, rb: 0.168 * G, ex: 2.3, sh: 0.86 },
    { y: 0.79, rx: 0.207 * G, rf: 0.147 * G, rb: 0.157 * G, ex: 2.3, sh: 0.95 },
    { y: 0.9, rx: 0.19 * G, rf: 0.136 * G, rb: 0.14 * G, ex: 2.4 },
    { y: 0.98, rx: 0.172 * G, rf: 0.126 * G, rb: 0.122 * G, ex: 2.4, sh: 0.8 },
    { y: 1.08, rx: 0.18 * lerp(G, S, 0.4), rf: 0.132 * G, rb: 0.126, ex: 2.4 },
    { y: 1.2, rx: 0.206 * S, rf: 0.152, rb: 0.14, ex: 2.4 },
    { y: 1.32, rx: 0.236 * S, rf: 0.166, rb: 0.15, ex: 2.5 },
    { y: 1.42, rx: 0.242 * S, rf: 0.15, rb: 0.146, ex: 2.6 },
    { y: 1.475, rx: 0.15 * S, rf: 0.1, rb: 0.11, ex: 2.2 },
    { y: 1.52, rx: 0.074, rf: 0.07, rb: 0.075 },
  ];
  b.color(look.tunic).surf(K_CLOTH, 0.92).skinBy(torsoSkin);
  b.loft(tunicRings, { capA: true });
  const band = (y0: number, y1: number, grow: number, bulge = 0.004): void => {
    b.loft([ringAt(tunicRings, y0, grow), ringAt(tunicRings, (y0 + y1) / 2, grow + bulge), ringAt(tunicRings, y1, grow)]);
  };
  // hem trim + glowing thread
  b.color(look.trim).surf(K_CLOTH, 0.85);
  band(0.668, 0.72, 0.004, 0.003);
  b.color(look.elColor).surf(K_PLAIN, 0.6, 0, 1.2);
  band(0.727, 0.739, 0.004, 0.003);
  // collar
  b.color(look.trim).surf(K_CLOTH, 0.85);
  b.loft([ringAt(tunicRings, 1.468, 0.006), ringAt(tunicRings, 1.5, 0.012), ringAt(tunicRings, 1.525, 0.008)]);

  if (armor === 1) {
    // leather jerkin, open at the front
    b.color(look.leather).surf(K_LEATHER, 0.78);
    const rr = [0.86, 0.93, 0.98, 1.08, 1.2, 1.32, 1.42, 1.462].map((y, i) => ({ ...ringAt(tunicRings, y, 0.011), sh: i === 0 ? 0.8 : 1 }));
    b.loft(rr, { arc: [16, 344], double: true, inner: 0.5 });
    b.color(look.leatherDark).surf(K_LEATHER, 0.8);
    b.loft([ringAt(tunicRings, 0.85, 0.013), ringAt(tunicRings, 0.875, 0.016), ringAt(tunicRings, 0.9, 0.013)], { arc: [16, 344] });
  } else if (armor === 2) {
    // mail / scale hauberk
    const mail = el === 'dawn' ? mixc(look.metal, hex(0xc9a24a), 0.5) : mixc(look.metalDark, look.metal, 0.35);
    b.color(mail).surf(K_METAL, 0.55, 0.85);
    const ys = [0.755, 0.8, 0.9, 0.98, 1.08, 1.2, 1.32, 1.42, 1.47];
    b.loft(ys.map((y, i) => ({ ...ringAt(tunicRings, y, 0.01), sh: i === 0 ? 0.7 : i % 2 ? 1.06 : 0.92 })));
    b.color(look.metalDark).surf(K_METAL, 0.5, 0.9);
    band(0.75, 0.772, 0.012, 0.004);
  }

  // ---------------------------------------------------------------- belt
  b.color(look.leatherDark).surf(K_LEATHER, 0.75);
  band(0.948, 1.012, 0.014, 0.006);
  const beltR = ringAt(tunicRings, 0.98, 0.02);
  b.rigid(B.hips);
  b.push().translate(0, 0.98, -(beltR.rf ?? 0.14) - 0.012);
  b.color(look.metal).surf(K_METAL, 0.35, 1);
  const oct: number[][] = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; oct.push([Math.cos(a) * 0.044, Math.sin(a) * 0.044]); }
  b.plate(oct, 0.022, 0.4);
  b.color(look.elColor).surf(K_PLAIN, 0.4, 0, 1.8);
  b.disc(0, 0, -0.0125, 0.017, 8);
  b.pop();
  // pouch
  b.color(look.leather).surf(K_LEATHER, 0.8);
  b.push().translate(-(beltR.rx - 0.02), 0.925, -(beltR.rf ?? 0.13) * 0.62).rotY(-38);
  b.box(0, 0, 0, 0.075, 0.085, 0.045);
  b.color(look.leatherDark);
  b.box(0, 0.03, -0.004, 0.08, 0.03, 0.05);
  b.pop();
  // hanging strap end (jiggles)
  b.color(look.leatherDark).surf(K_LEATHER, 0.78).rigid(B.tail);
  const strap: Ring[] = [
    { x: 0.115, y: 0.95, z: -(beltR.rf ?? 0.13) - 0.006, rx: 0.026, rz: 0.006, w: [B.hips, B.tail, 0.3] },
    { x: 0.118, y: 0.84, z: -(beltR.rf ?? 0.13) - 0.016, rx: 0.025, rz: 0.006 },
    { x: 0.12, y: 0.74, z: -(beltR.rf ?? 0.13) - 0.022, rx: 0.024, rz: 0.006, c: look.metal },
    { x: 0.12, y: 0.705, z: -(beltR.rf ?? 0.13) - 0.022, rx: 0.012, rz: 0.005, c: look.metal },
  ];
  b.loft(strap.reverse(), { seg: 4, capA: true });

  // cloak clasp / brooch on the chest
  b.rigid(B.chest);
  b.push().translate(0.105 * S, 1.405, -0.158);
  b.rotX(-14);
  b.color(look.metal).surf(K_METAL, 0.3, 1);
  b.plate(oct.map((p) => [p[0] * 0.8, p[1] * 0.8]), 0.018, 0.35);
  b.color(look.elColor).surf(K_PLAIN, 0.4, 0, 2.0);
  b.disc(0, 0, -0.0105, 0.014, 8);
  b.pop();

  // ---------------------------------------------------------------- legs
  const wraps = look.legWraps;
  b.sym(() => {
    b.color(look.trousers).surf(K_CLOTH, 0.92).rigid(B.ulegR);
    b.loft([
      { x: HX, y: 0.5, rx: 0.078 * L, rz: 0.082 * L },
      { x: HX, y: 0.62, rx: 0.09 * L, rz: 0.097 * L },
      { x: HX, y: 0.8, rx: 0.101 * L, rz: 0.11 * L },
      { x: HX - 0.005, y: 0.95, rx: 0.1 * L, rz: 0.108 * L, sh: 0.7 },
    ]);
    b.blend(B.ulegR, B.llegR, 0.5);
    b.ellipsoid(HX, 0.5, -0.006, 0.077 * L, 0.08, 0.081 * L, { rings: 5 });
    b.rigid(B.llegR);
    if (wraps) {
      // winingas: wrapped shins
      const rr: Ring[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, y = lerp(0.5, 0.1, t);
        rr.push({ x: HX, y, z: lerp(0, 0.004, t), rx: (lerp(0.078, 0.06, t) + Math.sin(t * Math.PI) * 0.008) * L + (i % 2 ? 0.004 : 0), rz: (lerp(0.082, 0.064, t) + Math.sin(t * Math.PI) * 0.01) * L + (i % 2 ? 0.004 : 0), c: i % 2 ? look.wrap : mixc(look.wrap, hex(0x2a2620), 0.35) });
      }
      b.color(look.wrap).surf(K_CLOTH, 0.95);
      b.loft(rr);
      b.color(look.leatherDark).surf(K_LEATHER, 0.8);
      b.loft([{ x: HX, y: 0.2, rx: 0.07, rz: 0.075 }, { x: HX, y: 0.12, rx: 0.075, rz: 0.082 }, { x: HX, y: 0.06, rx: 0.073, rz: 0.082 }]);
    } else {
      b.color(look.trousers).surf(K_CLOTH, 0.92);
      b.loft([{ x: HX, y: 0.5, rx: 0.077 * L, rz: 0.081 * L }, { x: HX, y: 0.4, rx: 0.08 * L, rz: 0.088 * L }, { x: HX, y: 0.32, rx: 0.074 * L, rz: 0.08 * L }]);
      // tall boots with a fur cuff
      b.color(look.leather).surf(K_LEATHER, 0.78);
      b.loft([
        { x: HX, y: 0.375, rx: 0.088 * L, rz: 0.094 * L, sh: 0.85 }, { x: HX, y: 0.33, rx: 0.086 * L, rz: 0.092 * L },
        { x: HX, y: 0.2, rx: 0.076, rz: 0.082 }, { x: HX, y: 0.11, rx: 0.075, rz: 0.084 }, { x: HX, y: 0.06, rx: 0.075, rz: 0.086 },
      ]);
      b.color(look.fur).surf(K_FUR, 0.95);
      b.loft([{ x: HX, y: 0.405, rx: 0.086 * L, rz: 0.09 * L }, { x: HX, y: 0.38, rx: 0.1 * L, rz: 0.105 * L }, { x: HX, y: 0.345, rx: 0.096 * L, rz: 0.1 * L }, { x: HX, y: 0.33, rx: 0.086 * L, rz: 0.09 * L }]);
      const nt = Math.round(9 * q.fur);
      for (let i = 0; i < nt; i++) {
        const a = (i / nt) * Math.PI * 2 + 0.3;
        b.tuft(HX + Math.sin(a) * 0.092 * L, 0.385, -Math.cos(a) * 0.097 * L, Math.sin(a) * 0.5, -0.85, -Math.cos(a) * 0.5, 0.06 + rnd() * 0.025, 0.024);
      }
      // strap + glowing stud
      b.color(look.leatherDark).surf(K_LEATHER, 0.8);
      b.loft([{ x: HX, y: 0.25, rx: 0.082, rz: 0.088 }, { x: HX, y: 0.235, rx: 0.086, rz: 0.092 }, { x: HX, y: 0.22, rx: 0.08, rz: 0.086 }]);
    }
    if (el === 'stone' || (el !== 'gale' && v[6] < 0.35)) {
      // knee cop
      b.color(look.metal).surf(K_METAL, 0.4, 0.95).blend(B.llegR, B.ulegR, 0.35);
      b.push().translate(HX, 0.5, -0.07 * L).rotX(-80);
      b.ellipsoid(0, 0, 0, 0.058, 0.03, 0.068, { lat: [0, 90], rings: 3, seg: 8 });
      b.pop();
    }
    b.rigid(B.footR);
    foot(b, wraps ? look.leatherDark : look.leather, K_LEATHER, 1.14);
  });

  // ---------------------------------------------------------------- arms
  const bare = look.bareArms;
  const sleeve = bare ? look.skin : mixc(look.tunic, hex(0x000000), 0.12);
  const sleeveKind = bare ? K_SKIN : K_CLOTH;
  b.sym(() => {
    b.color(sleeve).surf(sleeveKind, bare ? 0.7 : 0.92).rigid(B.uarmR);
    b.ellipsoid(SX, SY, 0, 0.09 * L, 0.09 * L, 0.092 * L, { rings: 5 });
    b.loft([
      { x: SX, y: 1.13, rx: 0.064 * L, rz: 0.066 * L },
      { x: SX, y: 1.22, rx: 0.073 * L, rz: 0.077 * L },
      { x: SX + 0.004, y: 1.34, rx: 0.084 * L, rz: 0.088 * L },
      { x: SX, y: 1.44, rx: 0.08 * L, rz: 0.084 * L },
    ]);
    if (bare) {
      // arm ring
      b.color(look.metal).surf(K_METAL, 0.3, 1);
      b.loft([{ x: SX, y: 1.245, rx: 0.076 * L, rz: 0.08 * L }, { x: SX, y: 1.265, rx: 0.081 * L, rz: 0.085 * L }, { x: SX, y: 1.285, rx: 0.08 * L, rz: 0.084 * L }]);
      b.color(look.elColor).surf(K_PLAIN, 0.5, 0, 1.3);
      b.loft([{ x: SX, y: 1.258, rx: 0.082 * L, rz: 0.086 * L }, { x: SX, y: 1.265, rx: 0.084 * L, rz: 0.088 * L }, { x: SX, y: 1.272, rx: 0.082 * L, rz: 0.086 * L }]);
    }
    b.color(sleeve).surf(sleeveKind, bare ? 0.7 : 0.92).blend(B.uarmR, B.larmR, 0.5);
    b.ellipsoid(SX, 1.13, 0.004, 0.062 * L, 0.064, 0.064 * L, { rings: 5 });
    b.rigid(B.larmR);
    b.loft([{ x: SX, y: 0.87, rx: 0.045, rz: 0.048 }, { x: SX, y: 0.95, rx: 0.055 * L, rz: 0.058 * L }, { x: SX, y: 1.05, rx: 0.066 * L, rz: 0.068 * L }, { x: SX, y: 1.13, rx: 0.062 * L, rz: 0.064 * L }]);
    if (el === 'storm') {
      // conductor gauntlets: oversized plate with glowing coils
      b.color(look.metal).surf(K_METAL, 0.32, 1);
      b.loft([
        { x: SX, y: 0.885, rx: 0.066, rz: 0.07 }, { x: SX, y: 0.905, rx: 0.07, rz: 0.074 }, { x: SX, y: 0.97, rx: 0.076 * L, rz: 0.08 * L },
        { x: SX, y: 1.07, rx: 0.088 * L, rz: 0.09 * L }, { x: SX + 0.008, y: 1.105, rx: 0.097 * L, rz: 0.098 * L }, { x: SX + 0.008, y: 1.115, rx: 0.09 * L, rz: 0.09 * L },
      ], { capB: true });
      b.color(look.elColor).surf(K_PLAIN, 0.4, 0, 1.7);
      for (const y of [0.93, 0.985, 1.04]) {
        const r = lerp(0.074, 0.088, (y - 0.905) / 0.165) * L + 0.003;
        b.loft([{ x: SX, y: y - 0.008, rx: r, rz: r + 0.003 }, { x: SX, y, rx: r + 0.006, rz: r + 0.009 }, { x: SX, y: y + 0.008, rx: r, rz: r + 0.003 }]);
      }
      hand(b, look.metalDark, K_METAL, 1.26, 0.4, 0.9);
      b.color(look.elCore).surf(K_PLAIN, 0.3, 0, 1.6).rigid(B.fingR);
      b.color(look.elColor).surf(K_PLAIN, 0.3, 0, 0.9); b.box(SX + 0.036, 0.752, 0, 0.01, 0.022, 0.08);
    } else if (el === 'gale') {
      // hand wraps
      const rr: Ring[] = [];
      for (let i = 0; i <= 7; i++) {
        const t = i / 7, y = lerp(1.09, 0.875, t);
        rr.push({ x: SX, y, rx: lerp(0.068, 0.05, t) * L + (i % 2 ? 0.004 : 0), rz: lerp(0.07, 0.053, t) * L + (i % 2 ? 0.004 : 0), c: i % 2 ? look.wrap : mixc(look.wrap, look.elDark, 0.4) });
      }
      b.color(look.wrap).surf(K_CLOTH, 0.95);
      b.loft(rr);
      hand(b, look.wrap, K_CLOTH, 1.14, 0.95);
    } else {
      // bracer with a glowing rune line
      b.color(look.leather).surf(K_LEATHER, 0.75);
      b.loft([
        { x: SX, y: 0.892, rx: 0.058, rz: 0.061, c: look.metalDark }, { x: SX, y: 0.905, rx: 0.06, rz: 0.063 }, { x: SX, y: 0.97, rx: 0.066 * L, rz: 0.069 * L },
        { x: SX, y: 1.06, rx: 0.075 * L, rz: 0.078 * L }, { x: SX, y: 1.078, rx: 0.078 * L, rz: 0.08 * L, c: look.metalDark }, { x: SX, y: 1.085, rx: 0.07 * L, rz: 0.072 * L, c: look.metalDark },
      ]);
      b.color(look.elColor).surf(K_PLAIN, 0.5, 0, 1.5);
      b.stroke(SX + 0.078 * L, 1.05, 0, SX + 0.064, 0.925, 0, 0.014, 1, 0, 0);
      b.stroke(SX + 0.072 * L, 1.0, -0.02, SX + 0.071 * L, 0.985, 0.022, 0.011, 1, 0, 0);
      const gloved = el === 'umbra' || v[7] < 0.4;
      hand(b, gloved ? look.leatherDark : look.skin, gloved ? K_LEATHER : K_SKIN, 1.14, gloved ? 0.8 : 0.7);
    }
  });

  // ---------------------------------------------------------------- neck + head
  b.color(look.skin).surf(K_SKIN, 0.7);
  b.loft([
    { y: 1.46, rx: 0.07, rz: 0.066, w: [B.chest, B.neck, 0.4], sh: 0.8 },
    { y: 1.54, rx: 0.06, rz: 0.062, w: [B.chest, B.neck, 1], sh: 0.85 },
    { y: 1.62, rx: 0.058, rz: 0.06, w: [B.neck, B.head, 1], sh: 0.8 },
  ]);
  const hooded = look.helm === 'hood' || look.helm === 'deephood';
  const faceShade = look.helm === 'deephood' ? 0.42 : look.helm === 'hood' ? 0.8 : 1;
  buildHead(b, look, q, rnd, faceShade);
  buildHair(b, look, q, rnd, hooded);
  const beard = buildBeard(b, look, q, rnd);
  buildHelm(b, look, q, rnd);

  // ---------------------------------------------------------------- shoulders, cloak
  buildMantle(b, look, q, rnd);
  const cloakSegs = buildCloak(b, look, q, rnd, tunicRings);

  // ---------------------------------------------------------------- weapon
  const weapon = buildWeapon(b, look, look.weapon);
  if (look.weapon === 'none') {
    // gale fights with the right leg: sockets are handled by the view
    weapon.tip.set(0, 0, 0); weapon.base.set(0, 0, 0);
  }
  const hs = look.hairStyle;
  return { weapon, cloakSegs, hasBraids: hs === 'braids', hasBeard: beard, hasHair: hs === 'long' || hs === 'topknot' || hs === 'mohawk' };
}

function headSpace(b: MeshBuilder, look: Look): void {
  b.push().translate(REST.head[0], REST.head[1], REST.head[2]).scale(look.headScale);
}

function buildHead(b: MeshBuilder, look: Look, q: Q, rnd: () => number, faceShade: number): void {
  headSpace(b, look);
  b.rigid(B.head);
  const saveShade = b.shadeMul;
  b.shadeMul = faceShade;
  b.color(look.skin).surf(K_SKIN, 0.68);
  b.loft([
    { y: 0.002, rx: 0.04, rf: 0.07, rb: 0.02, sh: 0.75 },
    { y: 0.024, rx: 0.066, rf: 0.097, rb: 0.055, sh: 0.9 },
    { y: 0.06, rx: 0.085, rf: 0.106, rb: 0.088 },
    { y: 0.1, rx: 0.093, rf: 0.107, rb: 0.104 },
    { y: 0.14, rx: 0.097, rf: 0.105, rb: 0.11 },
    { y: 0.18, rx: 0.091, rf: 0.098, rb: 0.106 },
    { y: 0.21, rx: 0.07, rf: 0.076, rb: 0.085 },
    { y: 0.227, rx: 0, rf: 0, rb: 0 },
  ], { capA: true });
  // nose
  b.loft([
    { y: 0.142, z: -0.099, rx: 0.009, rf: 0.006, rb: 0.004 },
    { y: 0.1, z: -0.102, rx: 0.015, rf: 0.026, rb: 0.004 },
    { y: 0.086, z: -0.102, rx: 0.017, rf: 0.02, rb: 0.004, sh: 0.8 },
    { y: 0.078, z: -0.1, rx: 0.006, rf: 0.006, rb: 0.004, sh: 0.7 },
  ], { seg: 5 });
  // ears
  for (const s of [1, -1]) b.ellipsoid(s * 0.094, 0.108, 0.008, 0.012, 0.027, 0.018, { seg: 5, rings: 3 });
  // brows
  b.color(look.brow).surf(K_FUR, 0.9);
  for (const s of [1, -1]) {
    b.push().translate(s * 0.04, 0.139, -0.096).rotZ(s * -9).rotY(s * -16);
    b.box(0, 0, 0, 0.048, 0.013, 0.022);
    b.pop();
  }
  // eyes: dark sockets with a faint elemental glint
  b.color(0x0c0c10).surf(K_PLAIN, 0.25);
  for (const s of [1, -1]) b.ellipsoid(s * 0.038, 0.119, -0.089, 0.019, 0.011, 0.014, { seg: 6, rings: 3 });
  b.color(mixc(look.elCore, look.elColor, 0.5)).surf(K_PLAIN, 0.3, 0, look.eyeGlow);
  for (const s of [1, -1]) b.ellipsoid(s * 0.038, 0.119, -0.099, 0.0075, 0.0065, 0.006, { seg: 5, rings: 3 });
  // mouth
  b.color(mixc(look.skin, hex(0x2a0c0c), 0.6)).surf(K_SKIN, 0.6);
  b.box(0, 0.054, -0.1015, 0.042, 0.006, 0.01);
  // war paint
  if (look.warpaint) {
    const paint = mixc(look.elColor, look.elDark, 0.55);
    b.color(paint).surf(K_PLAIN, 0.8);
    if (look.warpaint === 1) {
      b.loft([{ y: 0.106, rx: 0.0945, rf: 0.109, rb: 0.105 }, { y: 0.133, rx: 0.098, rf: 0.108, rb: 0.11 }], { arc: [-78, 78] });
    } else if (look.warpaint === 2) {
      for (const s of [1, -1]) { b.stroke(s * 0.05, 0.1, -0.103, s * 0.058, 0.03, -0.095, 0.014, 0, 0, -1); b.stroke(s * 0.07, 0.1, -0.092, s * 0.076, 0.045, -0.083, 0.012, s * 0.5, 0, -1); }
    } else {
      b.loft([{ y: 0.03, rx: 0.07, rf: 0.1, rb: 0.06 }, { y: 0.06, rx: 0.0865, rf: 0.108, rb: 0.09 }, { y: 0.1, rx: 0.0945, rf: 0.109, rb: 0.105 }, { y: 0.14, rx: 0.0985, rf: 0.107, rb: 0.11 }, { y: 0.18, rx: 0.0925, rf: 0.1, rb: 0.107 }], { arc: [8, 80] });
    }
  }
  b.shadeMul = saveShade;
  b.pop();
}

function buildHair(b: MeshBuilder, look: Look, q: Q, rnd: () => number, hooded: boolean): void {
  const hs = look.hairStyle;
  const covered = look.helm === 'nasal' || look.helm === 'spectacle' || look.helm === 'horned' || look.helm === 'furcap' || look.helm === 'winged' || hooded;
  const hair = look.hair;
  const dark = mixc(hair, hex(0x0a0806), 0.35);
  if (hs !== 'bald' && !covered) {
    headSpace(b, look);
    b.rigid(B.head);
    if (hs === 'mohawk') {
      // shaved sides (stubble) and a crest
      b.color(mixc(look.skin, hair, 0.45)).surf(K_SKIN, 0.85);
      b.loft([{ y: 0.14, rx: 0.099, rf: 0.1, rb: 0.113 }, { y: 0.18, rx: 0.093, rf: 0.1, rb: 0.108 }, { y: 0.212, rx: 0.071, rf: 0.077, rb: 0.087 }, { y: 0.229, rx: 0, rf: 0, rb: 0 }]);
      b.color(hair).surf(K_FUR, 0.9);
      const n = Math.round(11 * Math.max(0.6, q.fur));
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = lerp(-0.75, 1.75, t);
        const y = 0.13 + Math.cos(a) * 0.092, z = Math.sin(a) * 0.1;
        b.tuft(0, y, z, 0, Math.cos(a) * 0.8 + 0.3, Math.sin(a) * 0.8 + 0.35, 0.075 + rnd() * 0.03, 0.03, 1.15);
      }
    } else {
      b.color(hair).surf(K_FUR, 0.88);
      b.loft([
        { y: 0.04, rx: 0.088, rf: 0.09, rb: 0.096, sh: 0.8 }, { y: 0.1, rx: 0.1, rf: 0.1, rb: 0.115 },
        { y: 0.15, rx: 0.104, rf: 0.104, rb: 0.119 }, { y: 0.178, rx: 0.1, rf: 0.102, rb: 0.115 },
      ], { arc: [76, 284], double: true, inner: 0.6 });
      b.loft([
        { y: 0.172, rx: 0.1, rf: 0.104, rb: 0.115 }, { y: 0.205, rx: 0.086, rf: 0.09, rb: 0.099 },
        { y: 0.229, rx: 0.052, rf: 0.054, rb: 0.062 }, { y: 0.239, rx: 0, rf: 0, rb: 0 },
      ]);
      // fringe tufts
      b.color(hair, 0.92);
      for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.036; b.tuft(x, 0.178, -0.094 + Math.abs(x) * 0.25, x * 2, -0.75, -0.55, 0.045 + rnd() * 0.02, 0.022, 1.1); }
      if (hs === 'topknot') {
        b.ellipsoid(0, 0.235, 0.045, 0.036, 0.036, 0.04, { seg: 7, rings: 4 });
        b.color(look.leatherDark).surf(K_LEATHER, 0.8);
        b.loft([{ y: 0.212, z: 0.04, rx: 0.03 }, { y: 0.222, z: 0.042, rx: 0.034 }, { y: 0.232, z: 0.044, rx: 0.03 }], { seg: 6 });
      }
    }
    b.pop();
  }
  if (hs === 'bald' || hs === 'short') return;
  // dangling parts are built in model space so they line up with their bones
  const hsY = (y: number): number => REST.head[1] + (y - REST.head[1]) * look.headScale;
  if (hs === 'long') {
    b.color(hair).surf(K_FUR, 0.9);
    const fall: Ring[] = [
      { y: hsY(1.71), z: 0.075, rx: 0.09, rz: 0.045, w: [B.head, B.hair0, 0] },
      { y: 1.66, z: 0.095, rx: 0.1, rz: 0.045, w: [B.head, B.hair0, 0.5] },
      { y: 1.57, z: 0.125, rx: 0.105, rz: 0.042, w: [B.hair0, B.hair1, 0.4] },
      { y: 1.48, z: 0.138, rx: 0.095, rz: 0.036, w: [B.hair0, B.hair1, 1], c: dark },
      { y: 1.41, z: 0.142, rx: 0.06, rz: 0.022, w: [B.hair0, B.hair1, 1], c: dark },
    ];
    b.loft(fall.reverse(), { capA: true });
  } else if (hs === 'topknot' || hs === 'mohawk') {
    // a tail / war-braid down the back
    const y0 = hs === 'topknot' ? hsY(1.8) : hsY(1.66);
    const z0 = hs === 'topknot' ? 0.06 : 0.1;
    b.color(hair).surf(K_FUR, 0.9);
    const rr: Ring[] = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = lerp(y0, 1.42, t);
      const z = lerp(z0, 0.14, smooth(0, 0.5, t));
      const wv = clamp01((1.68 - y) / 0.13);
      rr.push({ y, z, rx: lerp(0.032, 0.014, t) + (i % 2 ? 0.006 : 0), w: y > 1.55 ? [B.head, B.hair0, clamp01(wv)] : [B.hair0, B.hair1, clamp01((1.55 - y) / 0.06)], c: i === n - 1 ? look.metal : undefined });
    }
    b.loft(rr.reverse(), { seg: 6, capA: true });
  } else if (hs === 'braids') {
    b.sym(() => {
      b.color(hair).surf(K_FUR, 0.9);
      const rr: Ring[] = [];
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const t = i / n, y = lerp(hsY(1.67), 1.35, t);
        const x = lerp(0.092 * look.headScale, 0.11, smooth(0, 0.4, t)), z = lerp(-0.02, -0.065, smooth(0, 0.5, t));
        rr.push({ x, y, z, rx: lerp(0.026, 0.016, t) + (i % 2 ? 0.007 : 0), w: y > 1.61 ? [B.head, B.braidR0, 0] : y > 1.48 ? [B.braidR0, B.braidR1, clamp01((1.5 - y) / 0.04)] : [B.braidR0, B.braidR1, 1], c: i === n - 1 ? look.metal : undefined, g: i === n - 1 ? 0 : undefined });
      }
      b.loft(rr.reverse(), { seg: 6, capA: true });
      // glowing bead
      b.color(look.elColor).surf(K_PLAIN, 0.4, 0, 1.4).rigid(B.braidR1);
      b.ellipsoid(0.11, 1.385, -0.065, 0.021, 0.014, 0.021, { seg: 6, rings: 3 });
    });
  }
}

function buildBeard(b: MeshBuilder, look: Look, q: Q, rnd: () => number): boolean {
  const bs = look.beardStyle;
  if (bs === 'none') return false;
  const col = mixc(look.hair, hex(0x0a0806), 0.18);
  headSpace(b, look);
  b.color(col).surf(K_FUR, 0.92);
  const W = (w: number): [number, number, number] => [B.head, B.beard, w];
  if (bs === 'short') {
    b.loft([
      { y: -0.006, rx: 0.044, rf: 0.078, rb: 0.01, w: W(0), sh: 0.8 }, { y: 0.024, rx: 0.071, rf: 0.105, rb: 0.03, w: W(0) },
      { y: 0.06, rx: 0.09, rf: 0.113, rb: 0.03, w: W(0) }, { y: 0.092, rx: 0.096, rf: 0.106, rb: 0.03, w: W(0) },
    ], { arc: [-112, 112], capA: true });
  } else {
    const long = bs === 'full' ? 1 : 0.7;
    b.loft([
      { y: -0.085 * long, z: -0.012, rx: 0.022, rf: 0.07, rb: 0.0, w: W(0.9), sh: 0.75 },
      { y: -0.05 * long, z: -0.008, rx: 0.058, rf: 0.098, rb: 0.01, w: W(0.7), sh: 0.88 },
      { y: -0.01, rx: 0.08, rf: 0.114, rb: 0.02, w: W(0.35) },
      { y: 0.03, rx: 0.09, rf: 0.118, rb: 0.03, w: W(0.1) },
      { y: 0.066, rx: 0.094, rf: 0.115, rb: 0.03, w: W(0) },
      { y: 0.094, rx: 0.097, rf: 0.107, rb: 0.03, w: W(0) },
    ], { arc: [-114, 114], capA: true });
  }
  // moustache
  b.rigid(B.head);
  for (const s of [1, -1]) {
    b.push().translate(s * 0.024, 0.066, -0.108).rotZ(s * -24);
    b.ellipsoid(0, 0, 0, 0.03, 0.012, 0.014, { seg: 5, rings: 3 });
    b.pop();
  }
  b.pop();
  if (bs === 'braided' || bs === 'forked') {
    const tails = bs === 'braided' ? [0] : [-0.034, 0.034];
    for (const x of tails) {
      b.color(col).surf(K_FUR, 0.92);
      const rr: Ring[] = [];
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        rr.push({ x: x * (1 + t * 0.6), y: lerp(1.56, bs === 'braided' ? 1.4 : 1.44, t), z: lerp(-0.1, -0.118, t), rx: lerp(0.03, 0.013, t) + (i % 2 ? 0.006 : 0), w: [B.head, B.beard, clamp01(0.5 + t)], c: i === n - 1 ? look.metal : undefined });
      }
      b.loft(rr.reverse(), { seg: 6, capA: true });
    }
  }
  return true;
}

function buildHelm(b: MeshBuilder, look: Look, q: Q, rnd: () => number): void {
  const h = look.helm;
  if (h === 'none') return;
  headSpace(b, look);
  b.rigid(B.head);
  const metal = look.metal, dark = look.metalDark;
  const dome = (grow: number, col: Color, kind = K_METAL, rough = 0.34, met = 1): void => {
    b.color(col).surf(kind, rough, met);
    b.loft([
      { y: 0.128, rx: 0.106 + grow, rf: 0.112 + grow, rb: 0.121 + grow },
      { y: 0.155, rx: 0.107 + grow, rf: 0.112 + grow, rb: 0.122 + grow },
      { y: 0.195, rx: 0.097 + grow, rf: 0.1 + grow, rb: 0.11 + grow },
      { y: 0.228, rx: 0.07 + grow, rf: 0.072 + grow, rb: 0.08 + grow },
      { y: 0.25, rx: 0.034, rf: 0.034, rb: 0.038 },
      { y: 0.258 + grow, rx: 0, rf: 0, rb: 0 },
    ]);
  };
  const rim = (col: Color, grow = 0): void => {
    b.color(col).surf(K_METAL, 0.4, 1);
    b.loft([{ y: 0.116, rx: 0.108 + grow, rf: 0.114 + grow, rb: 0.123 + grow }, { y: 0.13, rx: 0.114 + grow, rf: 0.12 + grow, rb: 0.129 + grow }, { y: 0.146, rx: 0.109 + grow, rf: 0.115 + grow, rb: 0.124 + grow }], { double: true, inner: 0.4 });
  };
  const nasal = (): void => { b.color(dark).surf(K_METAL, 0.4, 1); b.box(0, 0.092, -0.121, 0.024, 0.085, 0.014); };
  const crest = (): void => {
    b.color(dark).surf(K_METAL, 0.4, 1);
    // ridge band over the crown, front to back
    b.push().rotY(90);
    b.loft([{ y: -0.012, rx: 0.118, rz: 0.118 }, { y: 0.012, rx: 0.118, rz: 0.118 }], { arc: [-90, 90], seg: 10, capA: false });
    b.pop();
  };
  const aventail = (col: Color, kind: number): void => {
    b.color(col).surf(kind, 0.6, kind === K_METAL ? 0.8 : 0);
    b.loft([
      { y: -0.035, rx: 0.128, rb: 0.135, w: [B.head, B.neck, 0.6], sh: 0.8 }, { y: 0.03, rx: 0.118, rb: 0.128, w: [B.head, B.neck, 0.3] },
      { y: 0.09, rx: 0.111, rb: 0.124 }, { y: 0.135, rx: 0.109, rb: 0.123 },
    ], { arc: [98, 262], double: true, inner: 0.45 });
  };
  const cheeks = (): void => {
    b.color(metal).surf(K_METAL, 0.36, 1);
    for (const a of [[52, 118], [242, 308]]) {
      b.loft([{ y: 0.022, rx: 0.086, rf: 0.1, rb: 0.09, sh: 0.85 }, { y: 0.06, rx: 0.1, rf: 0.112, rb: 0.105 }, { y: 0.125, rx: 0.106, rf: 0.114, rb: 0.12 }], { arc: a as [number, number], seg: 4, double: true, inner: 0.4 });
    }
  };
  const browGlow = (): void => {
    b.color(look.elColor).surf(K_PLAIN, 0.4, 0, 1.6);
    b.stroke(-0.03, 0.166, -0.1145, 0, 0.186, -0.111, 0.011, 0, 0.2, -1);
    b.stroke(0.03, 0.166, -0.1145, 0, 0.186, -0.111, 0.011, 0, 0.2, -1);
  };
  if (h === 'nasal') {
    dome(0, metal); rim(dark); nasal(); browGlow();
    if (look.v[8] < 0.5) aventail(look.leatherDark, K_LEATHER);
    b.color(dark).surf(K_METAL, 0.4, 1);
    b.loft([{ y: 0.25, rx: 0.016 }, { y: 0.3, rx: 0 }], { seg: 5 });
  } else if (h === 'spectacle') {
    dome(0, metal); rim(dark); nasal(); cheeks(); browGlow();
    // ocular guard
    b.color(dark).surf(K_METAL, 0.4, 1);
    b.loft([{ y: 0.098, rx: 0.102, rf: 0.114, rb: 0.1 }, { y: 0.106, rx: 0.106, rf: 0.119, rb: 0.1 }, { y: 0.118, rx: 0.108, rf: 0.117, rb: 0.1 }], { arc: [-66, 66], double: true });
    aventail(mixc(dark, metal, 0.3), K_METAL);
  } else if (h === 'horned') {
    dome(0.004, mixc(metal, dark, 0.3)); rim(dark, 0.004); nasal(); cheeks();
    b.color(0xd8cdb4).surf(K_WOOD, 0.55);
    for (const s of [1, -1]) {
      b.push().scale(s, 1, 1);
      b.loft([
        { x: 0.098, y: 0.17, rx: 0.034, tz: -80 }, { x: 0.15, y: 0.185, rx: 0.03, tz: -62 }, { x: 0.195, y: 0.225, rx: 0.024, tz: -34, z: -0.008 },
        { x: 0.213, y: 0.28, rx: 0.016, tz: -10, z: -0.022, c: hex(0xb0a48a) }, { x: 0.214, y: 0.335, rx: 0, tz: 0, z: -0.04, c: hex(0x8a7e68) },
      ], { seg: 7 });
      b.pop();
    }
    b.color(look.elColor).surf(K_PLAIN, 0.4, 0, 1.4);
    for (const s of [1, -1]) b.loft([{ x: s * 0.104, y: 0.158, rx: 0.036, tz: s * -80 }, { x: s * 0.112, y: 0.16, rx: 0.04, tz: s * -80 }, { x: s * 0.12, y: 0.162, rx: 0.036, tz: s * -80 }], { seg: 7, flip: s < 0 });
  } else if (h === 'furcap') {
    dome(0.006, look.fur, K_FUR, 0.95, 0);
    const n = Math.round(16 * q.fur);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      b.tuft(Math.sin(a) * 0.11, 0.135, -Math.cos(a) * 0.118 + 0.004, Math.sin(a) * 0.7, -0.6, -Math.cos(a) * 0.7, 0.05 + rnd() * 0.03, 0.03);
    }
    for (const s of [1, -1]) b.ellipsoid(s * 0.104, 0.085, 0.01, 0.022, 0.06, 0.045, { seg: 6, rings: 4 });
    b.color(look.metal).surf(K_METAL, 0.35, 1);
    b.disc(0, 0.17, -0.1235, 0.02, 8);
    browGlow();
  } else if (h === 'circlet' || h === 'winged') {
    const gold = look.element === 'dawn' ? mixc(hex(0xe2b95a), metal, 0.2) : metal;
    if (h === 'winged') {
      dome(0, gold, K_METAL, 0.28, 1); rim(mixc(gold, dark, 0.4));
      b.color(gold).surf(K_METAL, 0.3, 1);
      for (const s of [1, -1]) {
        b.push().translate(s * 0.113, 0.16, 0.0).rotY(90).rotX(s * 8);
        b.plate([[0.02, -0.03], [0.03, 0.035], [-0.02, 0.11], [-0.075, 0.185], [-0.07, 0.115], [-0.12, 0.135], [-0.095, 0.065], [-0.135, 0.06], [-0.09, 0.005], [-0.04, -0.03]], 0.014, 0.3, 0.5, look.elColor);
        b.pop();
      }
      b.color(look.elColor).surf(K_PLAIN, 0.4, 0, 1.9);
      b.disc(0, 0.172, -0.1165, 0.018, 8);
    } else {
      b.color(gold).surf(K_METAL, 0.3, 1);
      b.loft([{ y: 0.15, rx: 0.1, rf: 0.106, rb: 0.115 }, { y: 0.163, rx: 0.106, rf: 0.11, rb: 0.121 }, { y: 0.176, rx: 0.1, rf: 0.105, rb: 0.116 }]);
      b.push().translate(0, 0.165, -0.112);
      b.plate([[0, 0.04], [0.022, 0], [0, -0.022], [-0.022, 0]], 0.016, 0.5, 1.9, look.elColor);
      b.pop();
    }
  } else if (h === 'headband') {
    b.color(look.wrap).surf(K_CLOTH, 0.95);
    b.loft([{ y: 0.148, rx: 0.1, rf: 0.106, rb: 0.115 }, { y: 0.163, rx: 0.106, rf: 0.11, rb: 0.121 }, { y: 0.178, rx: 0.1, rf: 0.105, rb: 0.116 }]);
    // knot tails + feathers
    for (const s of [1, -1]) {
      b.push().translate(s * 0.02, 0.16, 0.118).rotX(18).rotZ(s * 14);
      b.box(0, -0.06, 0, 0.026, 0.12, 0.006);
      b.pop();
    }
    b.color(0xeef2ec).surf(K_PLAIN, 0.8);
    for (let i = 0; i < 2; i++) {
      b.push().translate(-0.108, 0.16, 0.03 + i * 0.03).rotY(90).rotX(-20 - i * 22);
      b.plate([[0, 0], [0.022, 0.05], [0.018, 0.13], [0, 0.2 - i * 0.03], [-0.018, 0.13], [-0.022, 0.05]], 0.008, 0.35, 0.45, look.elColor);
      b.pop();
    }
  } else if (h === 'hood' || h === 'deephood') {
    const deep = h === 'deephood';
    const col = deep ? look.cloakCol : mixc(look.cloakCol, look.fur, 0.25);
    const rf = deep ? 0.168 : 0.132;
    const open: [number, number] = deep ? [30, 330] : [40, 320];
    b.color(col).surf(K_CLOTH, 0.95);
    b.loft([
      { y: -0.095, rx: 0.15, rf: 0.115, rb: 0.135, w: [B.chest, B.neck, 0.3], sh: 0.8 },
      { y: -0.03, rx: 0.125, rf: 0.115, rb: 0.128, w: [B.neck, B.head, 0.45] },
      { y: 0.05, rx: 0.118, rf: rf - 0.01, rb: 0.132, w: [B.neck, B.head, 1] },
      { y: 0.13, rx: 0.119, rf: rf, rb: 0.138 },
      { y: 0.195, rx: 0.112, rf: rf, rb: 0.138 },
    ], { arc: open, double: true, inner: deep ? 0.22 : 0.45 });
    b.loft([
      { y: 0.19, rx: 0.113, rf: rf + 0.004, rb: 0.139 },
      { y: 0.235, rx: 0.092, rf: rf - 0.03, rb: 0.135 },
      { y: 0.268, rx: 0.05, rf: 0.07, rb: 0.115, z: 0.012 },
      { y: 0.284, rx: 0, rf: 0, rb: 0, z: 0.05 },
    ], { double: true, inner: deep ? 0.22 : 0.45 });
    // trim along the opening
    b.color(look.trim).surf(K_CLOTH, 0.85);
    b.loft([{ y: 0.186, rx: 0.115, rf: rf + 0.008, rb: 0.14 }, { y: 0.2, rx: 0.116, rf: rf + 0.01, rb: 0.14 }], { arc: [-open[0] - 6, open[0] + 6], double: true });
    if (!deep) {
      b.color(look.fur).surf(K_FUR, 0.95);
      const n = Math.round(12 * q.fur);
      for (let i = 0; i < n; i++) {
        const a = lerp(-open[0] - 20, open[0] + 20, i / (n - 1)) * (Math.PI / 180);
        b.tuft(Math.sin(a) * 0.117, 0.19, -Math.cos(a) * (rf + 0.004), Math.sin(a) * 0.6, -0.3, -Math.cos(a), 0.05 + rnd() * 0.02, 0.028);
      }
    }
  }
  b.pop();
}

function buildMantle(b: MeshBuilder, look: Look, q: Q, rnd: () => number): void {
  const S = look.shoulders;
  const m = look.mantle;
  if (m === 'none') return;
  if (m === 'fur' || m === 'collar' || m === 'scale') {
    const fur = m === 'fur';
    const rings: Ring[] = fur ? [
      { y: 1.555, rx: 0.088, rf: 0.085, rb: 0.092, sh: 0.75 },
      { y: 1.525, rx: 0.155 * S, rf: 0.125, rb: 0.135 },
      { y: 1.475, rx: 0.265 * S, rf: 0.165, rb: 0.172 },
      { y: 1.415, rx: 0.34 * S, rf: 0.18, rb: 0.19 },
      { y: 1.35, rx: 0.348 * S, rf: 0.17, rb: 0.186, sh: 0.9 },
      { y: 1.32, rx: 0.3 * S, rf: 0.15, rb: 0.16, sh: 0.6 },
    ] : m === 'collar' ? [
      { y: 1.56, rx: 0.086, rf: 0.082, rb: 0.09, sh: 0.7 },
      { y: 1.535, rx: 0.13, rf: 0.112, rb: 0.122 },
      { y: 1.49, rx: 0.2 * S, rf: 0.14, rb: 0.148 },
      { y: 1.45, rx: 0.262 * S, rf: 0.162, rb: 0.162 },
      { y: 1.425, rx: 0.24 * S, rf: 0.15, rb: 0.15, sh: 0.6 },
    ] : [
      { y: 1.548, rx: 0.09, rf: 0.086, rb: 0.092, sh: 0.75 },
      { y: 1.515, rx: 0.16 * S, rf: 0.124, rb: 0.134 },
      { y: 1.47, rx: 0.262 * S, rf: 0.16, rb: 0.168 },
      { y: 1.41, rx: 0.33 * S, rf: 0.172, rb: 0.184 },
      { y: 1.385, rx: 0.3 * S, rf: 0.155, rb: 0.165, sh: 0.6 },
    ];
    b.skinBy(shoulderSkin(fur ? 0.5 : 0.4));
    if (fur) b.color(look.fur).surf(K_FUR, 0.96);
    else if (m === 'collar') b.color(mixc(look.cloakCol, look.leather, 0.35)).surf(K_CLOTH, 0.92);
    else b.color(mixc(look.elDark, look.metal, 0.45)).surf(K_METAL, 0.42, 0.75);
    b.loft(rings.slice().reverse());
    if (fur) {
      const n = Math.round(74 * q.fur);
      const dark = mixc(look.fur, new Color(0x0a0806), 0.3);
      for (let i = 0; i < n; i++) {
        const th = rnd() * 360;
        const t = 1 + rnd() * 3.2;
        const j = Math.floor(t), f = t - j;
        const ra = rings[j], rb = rings[Math.min(rings.length - 1, j + 1)];
        ringPt(ra, th, _t); const ax = _t[0], ay = _t[1], az = _t[2];
        ringPt(rb, th, _t);
        const x = lerp(ax, _t[0], f), y = lerp(ay, _t[1], f), z = lerp(az, _t[2], f);
        const r = Math.hypot(x, z) || 1;
        b.color(rnd() < 0.3 ? dark : look.fur, 0.9 + rnd() * 0.25);
        b.tuft(x, y - 0.005, z, x / r * 0.75, -0.75 + (j < 2 ? 0.5 : 0), z / r * 0.75, 0.07 + rnd() * 0.05, 0.03 + rnd() * 0.012);
      }
    } else if (m === 'scale') {
      // scalloped lower tiers
      for (let k = 0; k < 2; k++) {
        const y0 = 1.44 - k * 0.055, gr = 0.012 + k * 0.016;
        const top = ringAt(rings.slice().reverse(), y0 + 0.05, gr), bot = ringAt(rings.slice().reverse(), y0, gr + 0.012);
        bot.rx = top.rx + 0.03; bot.rf = (top.rf ?? 0) + 0.02; bot.rb = (top.rb ?? 0) + 0.022; bot.y = y0 - 0.02;
        b.color(mixc(look.elDark, look.metal, 0.3 + k * 0.25)).surf(K_METAL, 0.4, 0.8);
        b.loft([{ ...bot, sh: 0.8 }, top], { double: true, inner: 0.4 });
      }
      b.color(look.elColor).surf(K_PLAIN, 0.5, 0, 1.2);
      const tr = ringAt(rings.slice().reverse(), 1.5, 0.004);
      b.loft([{ ...tr, y: 1.494 }, { ...tr, y: 1.5, rx: tr.rx + 0.004 }, { ...tr, y: 1.506 }]);
    } else {
      b.color(look.trim).surf(K_CLOTH, 0.85);
      const tr = ringAt(rings.slice().reverse(), 1.452, 0.005);
      b.loft([{ ...tr, y: 1.436, rx: tr.rx - 0.012 }, { ...tr, y: 1.452 }, { ...tr, y: 1.468, rx: tr.rx - 0.01, rf: (tr.rf ?? 0) - 0.006, rb: (tr.rb ?? 0) - 0.006 }]);
    }
  } else if (m === 'pauldrons') {
    b.skinBy(shoulderSkin(0.6));
    const dark = look.metalDark;
    b.sym(() => {
      b.push().translate(SX * S * 0.98 + 0.02, SY + 0.012, 0).rotZ(-20);
      b.color(look.metal).surf(K_METAL, 0.33, 1);
      b.ellipsoid(0, 0, 0, 0.125, 0.082, 0.128, { lat: [-4, 90], rings: 5 });
      b.color(dark).surf(K_METAL, 0.42, 1);
      b.loft([{ y: -0.018, rx: 0.124, rz: 0.127 }, { y: -0.004, rx: 0.132, rz: 0.135 }, { y: 0.01, rx: 0.124, rz: 0.127 }], { double: true, inner: 0.4 });
      b.loft([{ y: 0.07, rx: 0.02 }, { y: 0.125, rx: 0 }], { seg: 5 });
      b.color(look.elColor).surf(K_PLAIN, 0.4, 0, 1.5);
      b.stroke(0.045, 0.079, -0.07, 0.1, 0.045, -0.03, 0.013, 0.5, 0.8, -0.2);
      b.stroke(0.1, 0.045, -0.03, 0.06, 0.07, 0.04, 0.013, 0.5, 0.8, 0.2);
      b.pop();
      // lower lame
      b.push().translate(SX * S * 0.98 + 0.062, SY - 0.05, 0).rotZ(-42);
      b.color(mixc(look.metal, dark, 0.35)).surf(K_METAL, 0.38, 1);
      b.ellipsoid(0, 0, 0, 0.098, 0.066, 0.11, { lat: [-4, 80], rings: 4 });
      b.pop();
    });
    // padded gorget joining them
    b.skinBy(shoulderSkin(0.3));
    b.color(look.leatherDark).surf(K_LEATHER, 0.8);
    b.loft([{ y: 1.435, rx: 0.2 * S, rf: 0.14, rb: 0.146, sh: 0.7 }, { y: 1.475, rx: 0.19 * S, rf: 0.132, rb: 0.14 }, { y: 1.515, rx: 0.125, rf: 0.105, rb: 0.115 }, { y: 1.55, rx: 0.086, rf: 0.082, rb: 0.09, sh: 0.75 }]);
  } else if (m === 'feather') {
    b.skinBy(shoulderSkin(0.45));
    b.color(mixc(look.wrap, look.leather, 0.5)).surf(K_CLOTH, 0.92);
    b.loft([{ y: 1.43, rx: 0.215 * S, rf: 0.145, rb: 0.15, sh: 0.7 }, { y: 1.475, rx: 0.2 * S, rf: 0.138, rb: 0.146 }, { y: 1.52, rx: 0.125, rf: 0.105, rb: 0.115 }, { y: 1.55, rx: 0.086, rf: 0.082, rb: 0.09, sh: 0.75 }]);
    const white = hex(0xeef2ea), grey = hex(0x9aa39c);
    const rows = [{ n: 15, y: 1.5, r: 0.15, len: 0.29, drop: 48 }, { n: 12, y: 1.535, r: 0.1, len: 0.22, drop: 30 }];
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k];
      const n = Math.max(6, Math.round(row.n * Math.min(1, q.fur + 0.25)));
      for (let i = 0; i < n; i++) {
        const th = (i / n) * 360 + k * 12 + (rnd() - 0.5) * 8;
        const front = Math.abs(((th + 180) % 360) - 180) < 38;
        const len = row.len * (front ? 0.62 : 1) * (0.88 + rnd() * 0.26) * (Math.abs(Math.sin(th * Math.PI / 180)) * 0.25 + 0.85);
        const sn = Math.sin(th * Math.PI / 180), cs = Math.cos(th * Math.PI / 180);
        b.push().translate(sn * row.r * S * 1.25, row.y, -cs * row.r);
        b.rotY(-th).rotX(-(90 + row.drop + rnd() * 10)).rotY((rnd() - 0.5) * 30);
        b.color(k === 0 && rnd() < 0.35 ? grey : white).surf(K_PLAIN, 0.75);
        b.plate([[0, 0], [0.042, 0.07], [0.05, len * 0.62], [0.014, len], [-0.018, len * 0.96], [-0.05, len * 0.6], [-0.042, 0.07]], 0.014, 0.42, 0.55, look.elColor);
        b.pop();
      }
    }
  }
  b.skinBy(null);
}

function buildCloak(b: MeshBuilder, look: Look, q: Q, rnd: () => number, tunicRings: Ring[]): number {
  const S = look.shoulders;
  const style = look.cloak;
  const place = new Vector3();
  if (style === 'none') {
    // rune on the back of the tunic instead
    b.rigid(B.chest);
    const r = ringAt(tunicRings, 1.27, 0.014);
    rune(b, look, (gx, gy, out) => out.set(gx * 0.15, 1.27 + gy * 0.2, (r.rb ?? 0.15) + (look.mantle === 'pauldrons' ? 0.0 : 0) - Math.abs(gx) * 0.012), 0, 0, 1, 0.022, 1.6);
    return 0;
  }
  const endY = style === 'long' ? CLOAK_END_Y : style === 'short' ? 0.78 : 0.62;
  const half = style === 'half';
  const segs = style === 'short' ? 2 : 3;
  const tatter: number[] = [];
  for (let i = 0; i <= 24; i++) tatter.push((rnd() - 0.35) * 0.07);
  const xl = (v: number): number => half ? lerp(-0.235 * S, -0.3, v) : lerp(-0.225 * S, -0.31, v);
  const xr = (v: number): number => half ? lerp(0.06, 0.02, v) : lerp(0.225 * S, 0.31, v);
  const fn = (u: number, v: number, out: Vector3): void => {
    const x = lerp(xl(v), xr(v), u);
    const e = (u * 2 - 1);
    const yEnd = endY + (half ? u * 0.42 : 0) + tatter[Math.round(u * 24)] * smooth(0.6, 1, v);
    const y = lerp(1.47, yEnd, v) - Math.sin(v * Math.PI) * 0.0;
    // wraps around the shoulders at the top, flatter and further back toward the hem
    const z = lerp(0.182 - e * e * 0.1, 0.262 - e * e * 0.045, smooth(0, 0.4, v)) + Math.sin(u * 9 + v * 3) * 0.008 * v;
    out.set(x, y, z);
  };
  const vOf = (v: number): number => (1.47 - lerp(1.47, endY, v));
  const skin = (u: number, v: number, mb: MeshBuilder): void => {
    // which chains
    const x = lerp(xl(v), xr(v), u);
    const cu = clamp01((x + 0.2) / 0.4) * 2;
    const ci = Math.min(1, Math.floor(cu)), cf = cu - ci;
    const chainA = [B.clkL0, B.clkC0][ci], chainB = [B.clkC0, B.clkR0][ci];
    // which segments: s in bone units down the chain
    const s = vOf(v) / 0.33 - 0.5 + 0.18;
    let k = Math.floor(s), f = s - k;
    if (k < -1) { k = -1; f = 0; }
    if (k >= 2) { k = 2; f = 0; }
    const lo = (base: number): number => (k < 0 ? B.chest : base + k);
    const hi = (base: number): number => base + Math.min(2, k + 1);
    mb.setSkin(lo(chainA), (1 - cf) * (1 - f), hi(chainA), (1 - cf) * f, lo(chainB), cf * (1 - f), hi(chainB), cf * f);
  };
  const trimStart = 1 - 0.07 / (1.47 - endY);
  b.color(look.cloakCol).surf(K_CLOTH, 0.94);
  b.sheet(half ? Math.max(3, q.cu >> 1) : q.cu, style === 'short' ? Math.max(4, Math.round(q.cv * 0.65)) : q.cv, fn, {
    skin, double: true, back: look.lining, flip: true,
    shade: (u, v) => 0.82 + 0.18 * Math.cos(u * 12.5) * 0.5 + 0.09 - v * 0.12,
    colorAt: (u, v) => (v > trimStart ? look.trim : undefined),
  });
  // rune on the back
  const cu0 = half ? 0.42 : 0.5, cv0 = (1.47 - 1.13) / (1.47 - endY);
  const gw = 0.19 / (xr(cv0) - xl(cv0)), gh = 0.27 / (1.47 - endY);
  const p0 = new Vector3(), p1 = new Vector3();
  b.color(look.elColor).surf(K_PLAIN, 0.5, 0, 1.6);
  for (const s of RUNES[look.element]) {
    const u0 = cu0 + s[0] * gw, v0 = cv0 - s[1] * gh, u1 = cu0 + s[2] * gw, v1 = cv0 - s[3] * gh;
    fn(u0, v0, p0); fn(u1, v1, p1);
    skin((u0 + u1) / 2, (v0 + v1) / 2, b);
    b.stroke(p0.x, p0.y, p0.z + 0.008, p1.x, p1.y, p1.z + 0.008, 0.028, 0, 0, 1);
  }
  void place;
  return segs;
}

// ------------------------------------------------------------------------------------------
// the training dummy
// ------------------------------------------------------------------------------------------

function buildDummy(b: MeshBuilder, look: Look, q: Q, rnd: () => number): Parts {
  const burlap = hex(0x9c8862), burlapD = hex(0x6e5e42), straw = hex(0xd8b64e), rope = hex(0x5e4e36), rust = hex(0x7a5c48), iron = hex(0x6a6e74);
  b.shadeFn = (p) => lerp(0.78, 1, smooth(0, 0.6, p.y));
  const strawTufts = (cx: number, cy: number, cz: number, r: number, n: number, dirY: number, len: number, spread = 1): void => {
    b.color(straw).surf(K_FUR, 0.9);
    const m = Math.max(3, Math.round(n * q.fur));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 + rnd();
      b.color(straw, 0.75 + rnd() * 0.4);
      b.tuft(cx + Math.sin(a) * r, cy, cz - Math.cos(a) * r, Math.sin(a) * spread, dirY + (rnd() - 0.5) * 0.4, -Math.cos(a) * spread, len * (0.7 + rnd() * 0.6), 0.013);
    }
  };
  const ropeBand = (x: number, y: number, r: number): void => {
    b.color(rope).surf(K_CLOTH, 0.95);
    b.loft([{ x, y: y - 0.014, rx: r }, { x, y, rx: r + 0.008 }, { x, y: y + 0.014, rx: r }]);
  };
  // torso sack
  const rings: Ring[] = [
    { y: 0.62, rx: 0.19, rf: 0.15, rb: 0.16, sh: 0.6 }, { y: 0.7, rx: 0.215, rf: 0.17, rb: 0.175 }, { y: 0.9, rx: 0.21, rf: 0.175, rb: 0.165 },
    { y: 1.0, rx: 0.185, rf: 0.15, rb: 0.14, sh: 0.8 }, { y: 1.15, rx: 0.215, rf: 0.165, rb: 0.15 }, { y: 1.32, rx: 0.235, rf: 0.165, rb: 0.155 },
    { y: 1.43, rx: 0.225, rf: 0.14, rb: 0.14 }, { y: 1.5, rx: 0.12, rf: 0.09, rb: 0.095 }, { y: 1.54, rx: 0.07, rf: 0.065, rb: 0.07, sh: 0.7 },
  ];
  b.color(burlap).surf(K_CLOTH, 0.97).skinBy(torsoSkin);
  b.loft(rings, { capA: true });
  // rope belt
  b.color(rope).surf(K_CLOTH, 0.95);
  b.loft([ringAt(rings, 0.98, 0.006), ringAt(rings, 1.0, 0.018), ringAt(rings, 1.02, 0.006)]);
  // patches + stitches
  b.color(burlapD).surf(K_CLOTH, 0.97);
  b.loft([ringAt(rings, 0.74, 0.004), ringAt(rings, 0.86, 0.004)], { arc: [120, 170] });
  b.loft([ringAt(rings, 1.06, 0.004), ringAt(rings, 1.16, 0.004)], { arc: [200, 250] });
  b.color(0x2a2218).surf(K_PLAIN, 0.9);
  // battered breastplate with the painted target
  b.color(rust).surf(K_METAL, 0.62, 0.8);
  const plateR = [1.03, 1.1, 1.22, 1.33, 1.42].map((y, i) => ({ ...ringAt(rings, y, 0.014 + (i === 2 ? 0.006 : 0)), sh: 0.85 + ((i * 7) % 3) * 0.1 }));
  b.loft(plateR, { arc: [-112, 112], double: true, inner: 0.45 });
  b.color(iron).surf(K_METAL, 0.5, 0.9);
  b.loft([ringAt(rings, 1.02, 0.018), ringAt(rings, 1.04, 0.022)], { arc: [-112, 112], double: true });
  b.loft([ringAt(rings, 1.405, 0.018), ringAt(rings, 1.43, 0.02)], { arc: [-112, 112], double: true });
  // straps round the back
  b.color(rope).surf(K_LEATHER, 0.85);
  b.loft([ringAt(rings, 1.12, 0.008), ringAt(rings, 1.15, 0.01)], { arc: [108, 252] });
  b.loft([ringAt(rings, 1.33, 0.008), ringAt(rings, 1.36, 0.01)], { arc: [108, 252] });
  // target
  b.rigid(B.chest);
  const tz = -((ringAt(rings, 1.24, 0.022).rf ?? 0.18)) - 0.004;
  const tcols = [0xe8e2d0, 0xb02a20, 0xe8e2d0, 0xb02a20];
  const trad = [0.125, 0.094, 0.062, 0.03];
  for (let i = 0; i < 4; i++) { b.color(tcols[i]).surf(K_PLAIN, 0.8); b.disc(0, 1.235, tz - i * 0.002, trad[i], 14); }
  // a couple of dents / scratches
  b.color(0x3a2e28).surf(K_PLAIN, 0.8);
  b.stroke(-0.13, 1.36, tz + 0.01, -0.06, 1.3, tz - 0.002, 0.008, 0, 0, -1);
  b.stroke(0.08, 1.12, tz + 0.004, 0.14, 1.17, tz + 0.012, 0.007, 0, 0, -1);
  b.skinBy(null);
  strawTufts(0, 1.5, 0, 0.09, 12, 0.5, 0.1);
  b.rigid(B.hips);
  strawTufts(0, 0.63, 0, 0.16, 12, -0.9, 0.09, 0.5);

  // head sack
  b.rigid(B.head);
  b.push().translate(0, 1.58, -0.005);
  b.color(burlap).surf(K_CLOTH, 0.97);
  b.ellipsoid(0, 0.115, 0, 0.108, 0.125, 0.108, { rings: 7 });
  b.loft([{ y: -0.04, rx: 0.06, sh: 0.7 }, { y: 0.0, rx: 0.052 }, { y: 0.03, rx: 0.08 }]);
  ropeBand(0, 0.0, 0.054);
  // painted face
  b.color(0x1c1612).surf(K_PLAIN, 0.9);
  for (const s of [1, -1]) {
    b.stroke(s * 0.022, 0.15, -0.103, s * 0.056, 0.114, -0.1, 0.012, 0, 0, -1);
    b.stroke(s * 0.022, 0.114, -0.103, s * 0.056, 0.15, -0.1, 0.012, 0, 0, -1);
  }
  b.stroke(-0.045, 0.062, -0.098, 0.045, 0.062, -0.098, 0.009, 0, 0, -1);
  for (let i = -2; i <= 2; i++) b.stroke(i * 0.02, 0.05, -0.098, i * 0.02, 0.075, -0.099, 0.006, 0, 0, -1);
  // dented old helm, askew
  b.push().rotZ(7).rotX(-4).translate(0, 0.012, 0);
  b.color(rust).surf(K_METAL, 0.6, 0.85);
  b.loft([{ y: 0.14, rx: 0.114, rz: 0.118 }, { y: 0.17, rx: 0.114, rz: 0.118 }, { y: 0.215, rx: 0.098, rz: 0.1 }, { y: 0.25, rx: 0.06, rz: 0.062, sh: 0.8 }, { y: 0.268, rx: 0 }]);
  b.color(iron).surf(K_METAL, 0.5, 0.9);
  b.loft([{ y: 0.128, rx: 0.116, rz: 0.12 }, { y: 0.142, rx: 0.122, rz: 0.126 }, { y: 0.156, rx: 0.116, rz: 0.12 }], { double: true });
  b.box(0, 0.1, -0.122, 0.024, 0.085, 0.012);
  b.pop();
  b.pop();
  strawTufts(0, 1.71, 0.02, 0.1, 9, -0.3, 0.07);

  // limbs
  b.sym(() => {
    b.color(burlap).surf(K_CLOTH, 0.97).rigid(B.uarmR);
    b.ellipsoid(SX, SY, 0, 0.085, 0.085, 0.085, { rings: 5 });
    b.loft([{ x: SX, y: 1.13, rx: 0.066 }, { x: SX, y: 1.28, rx: 0.08 }, { x: SX, y: 1.43, rx: 0.078 }]);
    b.blend(B.uarmR, B.larmR, 0.5);
    b.ellipsoid(SX, 1.13, 0, 0.064, 0.064, 0.064, { rings: 4 });
    ropeBand(SX, 1.13, 0.062);
    b.rigid(B.larmR);
    b.color(burlap).surf(K_CLOTH, 0.97);
    b.loft([{ x: SX, y: 0.88, rx: 0.05 }, { x: SX, y: 1.0, rx: 0.07 }, { x: SX, y: 1.13, rx: 0.064 }]);
    ropeBand(SX, 0.885, 0.05);
    b.rigid(B.handR);
    b.color(burlapD).surf(K_CLOTH, 0.97);
    b.ellipsoid(SX, 0.82, 0, 0.045, 0.06, 0.055, { rings: 4 });
    b.rigid(B.fingR);
    b.ellipsoid(SX, 0.745, 0, 0.038, 0.045, 0.048, { rings: 4 });
    b.rigid(B.handR);
    strawTufts(SX, 0.87, 0, 0.04, 6, -0.6, 0.07);

    b.color(burlap).surf(K_CLOTH, 0.97).rigid(B.ulegR);
    b.loft([{ x: HX, y: 0.5, rx: 0.075 }, { x: HX, y: 0.7, rx: 0.095 }, { x: HX, y: 0.93, rx: 0.095, sh: 0.7 }]);
    b.blend(B.ulegR, B.llegR, 0.5);
    b.ellipsoid(HX, 0.5, 0, 0.072, 0.072, 0.072, { rings: 4 });
    ropeBand(HX, 0.5, 0.07);
    b.rigid(B.llegR);
    b.color(burlap).surf(K_CLOTH, 0.97);
    b.loft([{ x: HX, y: 0.1, rx: 0.058 }, { x: HX, y: 0.3, rx: 0.076 }, { x: HX, y: 0.5, rx: 0.072 }]);
    ropeBand(HX, 0.125, 0.058);
    strawTufts(HX, 0.14, 0, 0.05, 6, -0.5, 0.06);
    b.rigid(B.footR);
    foot(b, burlapD, K_CLOTH, 1.05);
  });
  const weapon: WeaponInfo = { tip: new Vector3(), base: new Vector3(), grip2: null };
  return { weapon, cloakSegs: 0, hasBraids: false, hasBeard: false, hasHair: false };
}
