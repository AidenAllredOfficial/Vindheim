// The hall from inside: plank floor, hewn-log walls, carved posts, beams and rafters, the long
// fire, benches, the high seat on its dais, mead tables, chandeliers, wall décor, dust and embers.
import * as THREE from 'three';
import { fbm2 } from '@shared/math';
import { HALL, type Collider } from '@shared/world';
import { hashf, lin, lineLight, torus, trs, unitSphere, type V3 } from './geo';
import { C, CEIL, F, MIDZ, XI, ZNI, ZS, ZSI, candle, chainLine, dragonHead, trophy, type Kit } from './kit';
import { SPR } from './textures';

const DOOR = HALL.doorHalfWidth, DOOR_TOP = F + HALL.doorHeight;
const _m = new THREE.Matrix4();
const ss = THREE.MathUtils.smoothstep;

export interface InteriorBuild {
  /** Coal bed geometry (own material). */
  coals: THREE.BufferGeometry;
  /** Centre of the fire (where the point light sits) and half the length of the flame line along z. */
  fire: V3;
  fireHalf: number;
}

export function buildInterior(k: Kit): InteriorBuild {
  const { woodIn, planksIn, rockIn, masonIn, ironIn, carveIn, clothIn } = k;
  const R = k.T.carveRects, CR = k.T.clothRects;
  const cols = k.world.colliders.filter((c) => c.z < -100);
  const posts = cols.filter((c) => c.kind === 'timber');
  const postZ = [...new Set(posts.map((p) => p.z))].sort((a, b) => a - b);
  const pit = cols.find((c) => c.kind === 'firepit')!;

  // ------------------------------------------------------------------ floor
  {
    const NP = 65, pw = (XI * 2) / NP;
    const NZ = k.seg(ZSI - ZNI, 1.1);
    const base = lin(C.plank);
    for (let p = 0; p < NP; p++) {
      const xa = -XI + p * pw, xb = xa + pw;
      const tint = 0.8 + 0.4 * hashf(p, 11);
      const uo = hashf(p, 12) * 7;
      const row: number[] = [];
      for (let i = 0; i <= NZ; i++) {
        const z = ZNI + ((ZSI - ZNI) * i) / NZ;
        const xm = (xa + xb) / 2;
        // wear: paler along the aisles and inside the door, sooty by the hearth, grimy at the walls
        const aisle = Math.exp(-Math.pow((Math.abs(xm) - 4.2) / 1.5, 2)) * ss(z, -177, -172) * (1 - ss(z, -147, -144.5) * 0.3);
        const door = Math.exp(-(xm * xm) / 14 - Math.pow((z + 146.5) / 4.5, 2));
        const soot = Math.exp(-Math.pow(xm / 2.6, 2)) * ss(z, -167, -165) * (1 - ss(z, -155, -153));
        const wall = ss(Math.abs(xm), 9.2, 11);
        const n = 0.85 + 0.3 * fbm2(xm * 0.5, z * 0.5, 3, 5);
        const w = tint * n * (1 + 0.32 * aisle + 0.3 * door - 0.38 * soot - 0.3 * wall);
        const c: V3 = [base[0] * w, base[1] * w * (1 - 0.04 * aisle), base[2] * w * (1 - 0.1 * aisle)];
        row.push(planksIn.vert(xa, F, z, 0, 1, 0, z / 1.36 + uo, ((p % 4) + 0.02) / 4, c), planksIn.vert(xb, F, z, 0, 1, 0, z / 1.36 + uo, ((p % 4) + 0.98) / 4, c));
      }
      for (let i = 0; i < NZ; i++) { const a = row[i * 2], b = row[i * 2 + 1], c2 = row[i * 2 + 3], d = row[i * 2 + 2]; planksIn.tri(a, c2, b); planksIn.tri(a, d, c2); }
    }
    // doorway floor
    const keep = planksIn.sky; planksIn.sky = 0.35;
    planksIn.quad([-DOOR, F, ZS], [DOOR, F, ZS], [DOOR, F, ZSI], [-DOOR, F, ZSI], { color: C.plank, tile: 1.36, grain: 1, nu: 4 });
    planksIn.sky = keep;
  }

  // ------------------------------------------------------------------ ceiling boards
  {
    const from = planksIn.quad([-XI, CEIL, ZSI], [-XI, CEIL, ZNI], [XI, CEIL, ZNI], [XI, CEIL, ZSI], { color: C.ceiling, tile: 1.36, nu: k.seg(36, 1.6), nv: k.seg(22, 1.6) });
    planksIn.shade(from, (x, _y, z) => 0.75 + 0.25 * fbm2(x * 0.3, z * 0.3, 2, 9) - 0.3 * Math.exp(-(x * x) / 10 - Math.pow((z - pit.z) / 6, 2)));
  }

  // ------------------------------------------------------------------ walls: hewn logs, peak at the collider face
  {
    const H = CEIL - F, NL = 19, lh = H / NL;
    const prof: [number, number][] = k.d >= 2
      ? [[-0.11, 0], [-0.035, 0.05], [0, 0.17], [0, lh - 0.17], [-0.035, lh - 0.05], [-0.11, lh]]
      : [[-0.11, 0], [0, 0.12], [0, lh - 0.12], [-0.11, lh]];
    const shadeWall = (from: number) => woodIn.shade(from, (_x, y) => 1 - 0.4 * ss(y, F + 4.5, CEIL) - 0.15 * (1 - ss(y, F, F + 0.9)));
    for (let i = 0; i < NL; i++) {
      const y = F + i * lh;
      const col = i % 4 === 1 ? C.timberDark : C.timber;
      for (const sgn of [-1, 1]) {
        shadeWall(woodIn.strip([sgn * XI, y, ZNI], [sgn * XI, y, ZSI], [-sgn, 0, 0], prof, { color: col, jitter: 0.13, tile: 2.2, seg: k.seg(36, 0.6), wobble: 0.008 }));
      }
      shadeWall(woodIn.strip([-XI, y, ZNI], [XI, y, ZNI], [0, 0, 1], prof, { color: col, jitter: 0.13, tile: 2.2, seg: k.seg(22, 0.6), wobble: 0.008 }));
      if (y < DOOR_TOP) {
        shadeWall(woodIn.strip([-XI, y, ZSI], [-DOOR, y, ZSI], [0, 0, -1], prof, { color: col, jitter: 0.13, tile: 2.2, seg: k.seg(8.4, 0.6), wobble: 0.008 }));
        shadeWall(woodIn.strip([DOOR, y, ZSI], [XI, y, ZSI], [0, 0, -1], prof, { color: col, jitter: 0.13, tile: 2.2, seg: k.seg(8.4, 0.6), wobble: 0.008 }));
      } else {
        shadeWall(woodIn.strip([-XI, y, ZSI], [XI, y, ZSI], [0, 0, -1], prof, { color: col, jitter: 0.13, tile: 2.2, seg: k.seg(22, 0.6), wobble: 0.008 }));
      }
    }
    // header over the door (closes the split course)
    woodIn.box(DOOR * 2 + 0.9, 0.5, 0.12, 0, DOOR_TOP + 0.25, ZSI - 0.03, { color: C.timberDark, tile: 2.2 });
    carveIn.stripBand([DOOR + 0.4, DOOR_TOP + 0.06, ZSI - 0.095], [-DOOR - 0.4, DOOR_TOP + 0.06, ZSI - 0.095], [0, 0.38, 0], R.bandBraid, 3, {});
    // wall posts (half timbers) and corner posts
    const wallPost = (x: number, z: number, wx: number, wz: number) => woodIn.box(wx, H, wz, x, F + H / 2, z, { color: C.timberDark, grain: 1, tile: 2.2, seg: [1, k.seg(H, 0.9), 1] });
    for (const z of postZ) for (const sgn of [-1, 1]) wallPost(sgn * (XI - 0.06), z, 0.24, 0.46);
    for (const sgn of [-1, 1]) for (const z of [ZNI + 0.12, ZSI - 0.12]) wallPost(sgn * (XI - 0.12), z, 0.36, 0.36);
    for (const sgn of [-1, 1]) { wallPost(sgn * 5.4, ZNI + 0.06, 0.46, 0.24); wallPost(sgn * 5.4, ZSI - 0.06, 0.46, 0.24); }
    // carved rail and skirting along the long walls
    for (const sgn of [-1, 1]) {
      const x = sgn * (XI - 0.07);
      woodIn.box(0.14, 0.34, ZSI - ZNI, x, F + 3.2, MIDZ, { color: C.timberDark, grain: 2, tile: 2.2, seg: [1, 1, k.seg(36, 1.2)] });
      const xf = sgn * (XI - 0.146);
      const a: V3 = [xf, F + 3.07, sgn > 0 ? ZSI : ZNI], b: V3 = [xf, F + 3.07, sgn > 0 ? ZNI : ZSI];
      carveIn.stripBand(a, b, [0, 0.26, 0], R.bandRunes, 26, {});
      woodIn.box(0.1, 0.36, ZSI - ZNI, sgn * (XI - 0.05), F + 0.18, MIDZ, { color: C.timberDark, grain: 2, tile: 2.2, seg: [1, 1, k.seg(36, 1.2)] });
    }
    woodIn.box(XI * 2, 0.36, 0.1, 0, F + 0.18, ZNI + 0.05, { color: C.timberDark, tile: 2.2, seg: [k.seg(22, 1.2), 1, 1] });
  }

  // ------------------------------------------------------------------ carved posts, beams, rafters
  {
    for (const p of posts) {
      const r = p.hx;
      const from = woodIn.cyl(r, r, CEIL - F, p.x, F, p.z, { radial: k.d >= 2 ? 16 : 10, hseg: k.seg(8.8, 0.7), color: C.timber, tile: 2.2, jitter: 0.08 });
      woodIn.shade(from, (_x, y) => 1 - 0.3 * ss(y, F + 5, CEIL));
      rockIn.cyl(r + 0.08, r + 0.05, 0.3, p.x, F, p.z, { radial: 12, color: C.stoneDark, tile: 1.4 });
      carveIn.ringBand(p.x, F + 1.15, F + 1.65, p.z, r + 0.012, R.bandBraid, 1, 16);
      carveIn.ringBand(p.x, F + 2.66, F + 3.08, p.z, r + 0.012, R.bandTwist, 1, 16);
      carveIn.ringBand(p.x, F + 5.5, F + 6.1, p.z, r + 0.012, R.bandScale, 1, 16);
      for (const y of [F + 1.1, F + 1.7, F + 2.62, F + 3.12]) {
        ironIn.add(torus(1, 0.028, 4, 16), trs(p.x, y, p.z, { rx: Math.PI / 2 }, _m), { color: C.ironDark }, [r + 0.012, r + 0.012, 1]);
      }
      // capital under the tie beam
      woodIn.cyl(r, r + 0.22, 0.55, p.x, 25.7, p.z, { radial: 12, color: C.timberDark, tile: 2 });
      // knee braces: toward the nave, toward the wall, and along the arcade
      const sgn = Math.sign(p.x);
      woodIn.beam([p.x - sgn * 0.3, 24.3, p.z], [p.x - sgn * 2.0, 26.3, p.z], 0.2, 0.28, { color: C.timberDark, tile: 2.2, seg: 2 });
      woodIn.beam([p.x + sgn * 0.3, 24.3, p.z], [p.x + sgn * 2.0, 26.3, p.z], 0.2, 0.28, { color: C.timberDark, tile: 2.2, seg: 2 });
      if (k.d >= 1) for (const dz of [-1, 1]) woodIn.beam([p.x, 25.0, p.z + dz * 0.3], [p.x, 26.86, p.z + dz * 1.9], 0.2, 0.26, { color: C.timberDark, tile: 2.2, seg: 2 });
    }
    // tie beams across the hall
    for (const z of postZ) {
      const from = woodIn.box(XI * 2, 0.6, 0.46, 0, 26.55, z, { color: C.timberDark, tile: 2.6, seg: [k.seg(22, 1.0), 1, 1] });
      woodIn.shade(from, () => 0.85);
    }
    // arcade plates along the post rows
    for (const sgn of [-1, 1]) woodIn.box(0.5, 0.55, ZSI - ZNI, sgn * 5.4, 27.125, MIDZ, { color: C.timberDark, grain: 2, tile: 2.6, seg: [1, 1, k.seg(36, 1.2)] });
    // joists
    const nj = [14, 20, 27, 27][k.d];
    for (let i = 0; i < nj; i++) {
      const z = ZNI + 0.7 + ((ZSI - ZNI - 1.4) * i) / (nj - 1);
      woodIn.box(XI * 2, 0.3, 0.2, 0, 27.25, z, { color: C.timberDark, tile: 2.6, jitter: 0.1, seg: [k.seg(22, 2.2), 1, 1] });
    }
    // occluders for baked shadows
    for (const p of posts) k.occluders.push({ t: 'cyl', x: p.x, z: p.z, r: p.hx, y0: F, y1: CEIL });
  }

  // ------------------------------------------------------------------ the long fire
  const fireY = pit.y1;
  const coals = new THREE.BufferGeometry();
  {
    const kw = 0.36;
    const stone = (x: number, z: number, w: number, d: number) => {
      const from = masonIn.box(w, pit.y1 - (F - 0.06), d, x, (pit.y1 + F - 0.06) / 2, z, { color: 0x8a7f78, tile: 1.25, seg: [Math.max(1, Math.round(w / 0.7)), 1, Math.max(1, Math.round(d / 0.7))] });
      // sooty, uneven tone
      masonIn.shade(from, (px, _py, pz) => 0.62 + 0.5 * fbm2(px * 1.7 + 3, pz * 1.7, 2, 31));
    };
    for (const sgn of [-1, 1]) {
      stone(pit.x + sgn * (pit.hx - kw / 2), pit.z, kw, pit.hz * 2 - kw * 2);
      stone(pit.x, pit.z + sgn * (pit.hz - kw / 2), pit.hx * 2, kw);
    }
    // glowing inner faces of the kerb
    const glow: V3 = [0.9, 0.3, 0.06];
    const ix = pit.hx - kw, iz = pit.hz - kw, yb = pit.y1 - 0.1;
    masonIn.quad([pit.x - ix, yb, pit.z + iz], [pit.x - ix, yb, pit.z - iz], [pit.x - ix, pit.y1, pit.z - iz], [pit.x - ix, pit.y1, pit.z + iz], { color: C.stoneWarm, tile: 1.3, emit: glow, nu: 8 });
    masonIn.quad([pit.x + ix, yb, pit.z - iz], [pit.x + ix, yb, pit.z + iz], [pit.x + ix, pit.y1, pit.z + iz], [pit.x + ix, pit.y1, pit.z - iz], { color: C.stoneWarm, tile: 1.3, emit: glow, nu: 8 });
    // coal bed
    const nx = 6, nz = 26;
    const pos: number[] = [], uv: number[] = [], heat: number[] = [], idx: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / nz;
      const x = pit.x - ix + ix * 2 * u, z = pit.z - iz + iz * 2 * v;
      pos.push(x, yb + 0.015 + 0.05 * Math.sin(u * Math.PI) * (0.6 + 0.4 * fbm2(x * 2, z * 2, 2, 3)), z);
      uv.push(x * 0.9, z * 0.9);
      heat.push((0.45 + 0.55 * Math.sin(u * Math.PI)) * (0.55 + 0.45 * Math.sin(v * Math.PI) ** 0.5) * (0.7 + 0.6 * fbm2(x * 1.3, z * 1.3, 2, 8)));
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1; idx.push(a, d, c, a, c, b); }
    coals.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    coals.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    coals.setAttribute('aHeat', new THREE.Float32BufferAttribute(heat, 1));
    coals.setIndex(idx);
    coals.computeBoundingSphere();
    // charred logs
    const nlog = [10, 16, 24, 30][k.d];
    for (let i = 0; i < nlog; i++) {
      const z = pit.z - iz + 0.5 + ((iz * 2 - 1.0) * (i + hashf(i, 21))) / nlog;
      const ang = (hashf(i, 22) - 0.5) * 1.6 + (i % 3 === 0 ? Math.PI / 2 : 0);
      const len = 0.75 + hashf(i, 23) * 0.6, rr = 0.075 + hashf(i, 24) * 0.05;
      const cx = (hashf(i, 25) - 0.5) * 0.7, lift = 0.02 + (i % 4 === 1 ? 0.16 : 0.02) + hashf(i, 26) * 0.05;
      const dx = Math.cos(ang) * len / 2, dz = Math.sin(ang) * len / 2;
      const hx = Math.min(ix - 0.1, Math.max(-ix + 0.1, cx + dx)), hx2 = Math.min(ix - 0.1, Math.max(-ix + 0.1, cx - dx));
      woodIn.log([pit.x + hx2, yb + rr + lift, z - dz], [pit.x + hx, yb + rr + lift + (hashf(i, 27) - 0.3) * 0.16, z + dz], rr, { radial: 6, color: C.char, tile: 0.8, emit: [0.75 * hashf(i, 28), 0.16 * hashf(i, 28), 0.02] });
    }
    // flames
    const nf = [10, 16, 24, 32][k.d];
    for (let i = 0; i < nf; i++) {
      const t = (i + 0.5) / nf;
      const z = pit.z - iz + 0.35 + (iz * 2 - 0.7) * t + (hashf(i, 31) - 0.5) * 0.3;
      const mid = Math.sin(t * Math.PI);
      k.flames.add(pit.x + (hashf(i, 32) - 0.5) * 0.9, yb + 0.02, z, 0.95 + hashf(i, 33) * 0.55, 1.0 + mid * 0.7 + hashf(i, 34) * 0.9, 1.0, 0.22);
    }
    for (let i = 0; i < Math.round(nf * 0.7); i++) {
      const t = (i + 0.5) / (nf * 0.7);
      k.flames.add(pit.x + (hashf(i, 35) - 0.5) * 1.2, yb + 0.02, pit.z - iz + 0.3 + (iz * 2 - 0.6) * t, 0.55 + hashf(i, 36) * 0.3, 0.6 + hashf(i, 37) * 0.45, 1.25, 0.1);
    }
    k.occluders.push({ t: 'box', x0: pit.x - pit.hx, x1: pit.x + pit.hx, y0: F - 1, y1: pit.y1, z0: pit.z - pit.hz, z1: pit.z + pit.hz });
    // baked light: a line of warm samples above the bed
    k.lights.push(...lineLight([pit.x, fireY + 0.8, pit.z - iz + 0.4], [pit.x, fireY + 0.8, pit.z + iz - 0.4], [3, 5, 7, 9][k.d], { c: [8.4, 4.3, 1.85], r0: 2.3, radius: 32, wrap: 0.22, zone: 1, occl: true }));

    // embers, sparks and the soft body of light above the fire
    const NE = [18, 36, 64, 100][k.d];
    k.emitters.push((P, e) => {
      const fl = 0.8 + 0.2 * Math.sin(e.time * 8.3) * Math.sin(e.time * 3.7 + 1);
      for (let i = 0; i < 3; i++) P.add(pit.x, fireY + 1.2, pit.z + (i - 1) * 3.1, 5.5, 4.6, 0, SPR.blob, 0, 0.1 * fl, 0.04 * fl, 0.01 * fl, 0);
      const n = Math.round(NE * Math.min(1.5, e.k));
      for (let i = 0; i < n; i++) {
        const life = 2.4 + hashf(i, 51) * 3.4;
        const ph = (e.time / life + hashf(i, 52)) % 1;
        const age = ph * life;
        const sw = 0.25 + age * 0.22;
        const x = pit.x + (hashf(i, 53) - 0.5) * 1.4 + Math.sin(age * 2.1 + i * 1.7) * sw;
        const y = fireY + 0.2 + age * (0.9 + hashf(i, 54) * 0.9) * (1 - ph * 0.25);
        const z = pit.z + (hashf(i, 55) - 0.5) * (iz * 2 - 0.4) + Math.cos(age * 1.7 + i * 2.3) * sw;
        const f = Math.min(1, ph * 12) * Math.pow(1 - ph, 1.3) * (0.6 + 0.4 * Math.sin(age * 13 + i));
        const s = 0.035 + hashf(i, 56) * 0.045;
        P.add(x, y, z, s, s * (1.4 + hashf(i, 57)), i, i % 4 === 0 ? SPR.ember : SPR.mote, 0, 5.2 * f, (2.0 - ph * 1.3) * f, 0.3 * f, 0);
      }
    });
  }
  const fire: V3 = [pit.x, fireY + 1.25, pit.z];

  // ------------------------------------------------------------------ benches
  for (const b of cols.filter((c) => c.kind === 'bench')) {
    const h = b.y1 - b.y0;
    woodIn.box(b.hx * 2, 0.11, b.hz * 2, b.x, b.y1 - 0.055, b.z, { color: C.timber, grain: 2, tile: 2.2, seg: [1, 1, k.seg(7.2, 0.9)] });
    for (const sx of [-1, 1]) woodIn.box(0.06, h - 0.11, b.hz * 2 - 0.2, b.x + sx * (b.hx - 0.07), b.y0 + (h - 0.11) / 2, b.z, { color: C.timberDark, grain: 2, tile: 2.2, seg: [1, 1, k.seg(7.2, 0.9)] });
    for (const sz of [-1, 1]) {
      woodIn.box(b.hx * 2 - 0.06, h - 0.11, 0.12, b.x, b.y0 + (h - 0.11) / 2, b.z + sz * (b.hz - 0.08), { color: C.timberDark });
      const zf = b.z + sz * (b.hz - 0.018);
      carveIn.stripBand([b.x + sz * 0.3, b.y0 + 0.1, zf], [b.x - sz * 0.3, b.y0 + 0.1, zf], [0, 0.22, 0], R.bandTwist, 1, {});
    }
    for (let i = 0; i < 2; i++) {
      const fz = b.z + (i === 0 ? -1.9 : 1.7) + Math.sign(b.x) * 0.3;
      const y = b.y1 + 0.014, hw = b.hx + 0.03, hl = 0.8;
      clothIn.quad([b.x - hw, y, fz + hl], [b.x + hw, y, fz + hl], [b.x + hw, y, fz - hl], [b.x - hw, y, fz - hl], { uvRect: CR.fur[(i + (b.x > 0 ? 1 : 0)) % 3], uvSwap: true });
    }
    k.occluders.push({ t: 'box', x0: b.x - b.hx, x1: b.x + b.hx, y0: b.y0, y1: b.y1, z0: b.z - b.hz, z1: b.z + b.hz });
  }

  // ------------------------------------------------------------------ dais, high seat, backboard
  {
    const d = cols.find((c) => c.kind === 'highdais')!;
    const x0 = d.x - d.hx, x1 = d.x + d.hx, z0 = d.z - d.hz, z1 = d.z + d.hz, y = d.y1;
    const from = planksIn.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], { color: C.timberRed, tile: 1.36, nu: k.seg(10.4, 0.8), nv: 5 });
    planksIn.shade(from, (px, _y, pz) => 0.85 + 0.3 * fbm2(px * 0.6, pz * 0.6, 2, 13));
    woodIn.quad([x0, F, z1], [x1, F, z1], [x1, y, z1], [x0, y, z1], { color: C.timberDark, tile: 2.2, nu: k.seg(10.4, 0.8) });
    woodIn.quad([x1, F, z1], [x1, F, z0], [x1, y, z0], [x1, y, z1], { color: C.timberDark, tile: 2.2, nu: 4 });
    woodIn.quad([x0, F, z0], [x0, F, z1], [x0, y, z1], [x0, y, z0], { color: C.timberDark, tile: 2.2, nu: 4 });
    woodIn.quad([x1, F, z0], [x0, F, z0], [x0, y, z0], [x1, y, z0], { color: C.timberDark, tile: 2.2 });
    carveIn.stripBand([x0 + 0.1, F + 0.07, z1 + 0.006], [x1 - 0.1, F + 0.07, z1 + 0.006], [0, 0.31, 0], R.bandBraid, 6, {});
    k.occluders.push({ t: 'box', x0, x1, y0: F - 1, y1: y, z0, z1 });

    const t = cols.find((c) => c.kind === 'throne')!;
    const tx0 = t.x - t.hx, tx1 = t.x + t.hx, tz0 = t.z - t.hz, tz1 = t.z + t.hz, ty0 = t.y0, ty1 = t.y1, th = ty1 - ty0;
    const sideW = 0.22;
    for (const sgn of [-1, 1]) {
      woodIn.box(sideW, th, t.hz * 2, t.x + sgn * (t.hx - sideW / 2), ty0 + th / 2, t.z, { color: C.timberDark, grain: 1, tile: 2 });
      const xf = t.x + sgn * (t.hx + 0.005);
      const a: V3 = [xf, ty0 + 0.4, sgn > 0 ? tz1 - 0.15 : tz0 + 0.15], b: V3 = [xf, ty0 + 0.4, sgn > 0 ? tz0 + 0.15 : tz1 - 0.15];
      carveIn.quad(a, b, [b[0], ty0 + 1.7, b[2]], [a[0], ty0 + 1.7, a[2]], { uvRect: R.panel });
      // inner face of the wing
      const xi = t.x + sgn * (t.hx - sideW - 0.003);
      carveIn.stripBand([xi, ty0 + 0.6, sgn > 0 ? tz0 + 0.3 : tz1 - 0.05], [xi, ty0 + 0.6, sgn > 0 ? tz1 - 0.05 : tz0 + 0.3], [0, 0.26, 0], R.bandTwist, 1, {});
      // small dragon finials on the front corners (tiny)
      trs(t.x + sgn * (t.hx - sideW / 2), ty1 + 0.045, tz1 - 0.1, { ry: -Math.PI / 2 }, _m);
      woodIn.add(dragonHead(), _m, { color: C.timberDark, tile: 0.8 }, [0.19, 0.19, 0.5]);
      // front edge of the wing: carved strip
      carveIn.stripBand([t.x + sgn * t.hx - (sgn > 0 ? sideW : 0), ty0 + 0.02, tz1 + 0.005], [t.x + sgn * t.hx - (sgn > 0 ? sideW : 0), th + ty0 - 0.2, tz1 + 0.005], [sideW, 0, 0], R.bandScale, 2, {});
    }
    woodIn.box(t.hx * 2 - sideW * 2, th, 0.25, t.x, ty0 + th / 2, tz0 + 0.125, { color: C.timberDark, grain: 1, tile: 2 });
    woodIn.box(t.hx * 2, 0.16, t.hz * 2, t.x, ty1 - 0.08, t.z, { color: C.timber, tile: 2 });
    carveIn.stripBand([tx0, ty1 - 0.16, tz1 + 0.006], [tx1, ty1 - 0.16, tz1 + 0.006], [0, 0.16, 0], R.bandBraid, 2, {});
    // seat
    const seatH = 0.55, sx0 = tx0 + sideW, sx1 = tx1 - sideW;
    woodIn.box(sx1 - sx0, seatH, t.hz * 2 - 0.25, t.x, ty0 + seatH / 2, tz0 + 0.25 + (t.hz * 2 - 0.25) / 2, { color: C.timber, tile: 2 });
    carveIn.stripBand([sx0, ty0 + 0.1, tz1 + 0.006], [sx1, ty0 + 0.1, tz1 + 0.006], [0, 0.3, 0], R.bandRunes, 1, {});
    // inner back panel + fur on the seat
    carveIn.quad([sx0 + 0.1, ty0 + seatH + 0.06, tz0 + 0.256], [sx1 - 0.1, ty0 + seatH + 0.06, tz0 + 0.256], [sx1 - 0.1, ty1 - 0.2, tz0 + 0.256], [sx0 + 0.1, ty1 - 0.2, tz0 + 0.256], { uvRect: R.panel, emit: [0.1, 0.06, 0.02] });
    const fy = ty0 + seatH + 0.014;
    clothIn.quad([sx0, fy, tz1 + 0.02], [sx1, fy, tz1 + 0.02], [sx1, fy, tz0 + 0.3], [sx0, fy, tz0 + 0.3], { uvRect: CR.fur[1] });
    clothIn.quad([sx0 + 0.15, ty0 + 0.12, tz1 + 0.03], [sx1 - 0.15, ty0 + 0.12, tz1 + 0.03], [sx1 - 0.1, fy, tz1 + 0.02], [sx0 + 0.1, fy, tz1 + 0.02], { uvRect: [CR.fur[1][0], CR.fur[1][1], CR.fur[1][2], CR.fur[1][1] + (CR.fur[1][3] - CR.fur[1][1]) * 0.25] });
    k.occluders.push({ t: 'box', x0: tx0, x1: tx1, y0: ty0, y1: ty1, z0: tz0, z1: tz1 });

    // the great backboard on the north wall, framed, dragon heads above
    const bw = 1.72, by0 = F + 0.5, by1 = F + 5.6, bz = ZNI + 0.1;
    carveIn.quad([-bw, by0, bz], [bw, by0, bz], [bw, by1, bz], [-bw, by1, bz], { uvRect: R.backboard, emit: [0.16, 0.1, 0.035], nv: 4, nu: 2 });
    for (const sgn of [-1, 1]) {
      woodIn.box(0.36, by1 - F + 0.3, 0.22, sgn * (bw + 0.18), (by1 + F + 0.3) / 2, ZNI + 0.11, { color: C.timberDark, grain: 1, tile: 2.2, seg: [1, 4, 1] });
      carveIn.stripBand([sgn * (bw + 0.18) + 0.13, F + 0.6, ZNI + 0.224], [sgn * (bw + 0.18) + 0.13, by1, ZNI + 0.224], [-0.26, 0, 0], R.bandBraid, 3, {});
      trs(sgn * (bw + 0.1), by1 + 0.45, ZNI + 0.2, { ry: sgn > 0 ? 0 : Math.PI, rz: 0.5 }, _m);
      woodIn.add(dragonHead(), _m, { color: C.timberDark, tile: 1.2 }, [0.8, 0.8, 1.2]);
    }
    woodIn.box(bw * 2 + 1.0, 0.36, 0.26, 0, by1 + 0.2, ZNI + 0.13, { color: C.timberDark, tile: 2.2 });
    carveIn.stripBand([-bw - 0.4, by1 + 0.06, ZNI + 0.264], [bw + 0.4, by1 + 0.06, ZNI + 0.264], [0, 0.28, 0], R.bandRunes, 3, {});
    // pelt before the high seat, runners down the nave
    const py = y + 0.014;
    clothIn.quad([-1.25, py, z1 - 0.15], [1.25, py, z1 - 0.15], [1.25, py, tz1 + 0.1], [-1.25, py, tz1 + 0.1], { uvRect: CR.fur[0], nu: 2, nv: 2 });
  }
  {
    const ry = F + 0.014;
    for (const [za, zb] of [[-145.3, -153.6], [-166.3, -174.25]] as [number, number][]) {
      clothIn.quad([-1.05, ry, za], [1.05, ry, za], [1.05, ry, zb], [-1.05, ry, zb], { uvRect: CR.runner, nv: k.seg(8, 1.2), nu: 2 });
    }
    // pelts on the floor in the corners by the door
    for (const sgn of [-1, 1]) {
      const cx = sgn * 7.6, cz = -146.6, a = sgn * 0.5, hw = 1.0, hl = 1.35;
      const cs = Math.cos(a), sn = Math.sin(a);
      const p = (lx: number, lz: number): V3 => [cx + lx * cs - lz * sn, ry, cz + lx * sn + lz * cs];
      clothIn.quad(p(-hw, hl), p(hw, hl), p(hw, -hl), p(-hw, -hl), { uvRect: CR.fur[sgn > 0 ? 2 : 1], nu: 2, nv: 2 });
    }
  }

  // ------------------------------------------------------------------ mead tables
  for (const t of cols.filter((c) => c.kind === 'table')) {
    const h = t.y1 - t.y0;
    woodIn.box(t.hx * 2, 0.12, t.hz * 2, t.x, t.y1 - 0.06, t.z, { color: C.timber, grain: 2, tile: 2.2, seg: [1, 1, 4] });
    for (const sz of [-1, 1]) woodIn.box(t.hx * 2 - 0.2, h - 0.12, 0.14, t.x, t.y0 + (h - 0.12) / 2, t.z + sz * (t.hz - 0.25), { color: C.timberDark, tile: 2.2 });
    woodIn.box(0.1, 0.45, t.hz * 2 - 0.5, t.x, t.y0 + 0.42, t.z, { color: C.timberDark, grain: 2, tile: 2.2 });
    for (const sx of [-1, 1]) woodIn.box(0.06, 0.2, t.hz * 2 - 0.1, t.x + sx * (t.hx - 0.06), t.y1 - 0.22, t.z, { color: C.timberDark, grain: 2, tile: 2.2 });
    k.occluders.push({ t: 'box', x0: t.x - t.hx, x1: t.x + t.hx, y0: t.y0, y1: t.y1, z0: t.z - t.hz, z1: t.z + t.hz });
    tableware(k, t);
  }

  // ------------------------------------------------------------------ chandeliers
  chandelier(k, 0, F + 5.3, -150.6, 1.2, 10, 27.1);
  chandelier(k, 0, F + 5.3, -173.4, 1.2, 10, 27.1);
  // gold and candle bounce on the high seat
  k.lights.push({ p: [0, F + 3.4, -175.2], c: [1.5, 0.9, 0.42], r0: 2.4, radius: 7.5, wrap: 0.4, zone: 1 });
  chandelier(k, -6.6, F + 4.5, -176.6, 0.72, 6, 27.1);
  chandelier(k, 6.6, F + 4.5, -176.6, 0.72, 6, 27.1);

  // ------------------------------------------------------------------ wall décor
  {
    const peds = cols.filter((c) => c.kind === 'pedestal');
    let n = 0;
    for (const p of peds) {
      const sgn = Math.sign(p.x);
      for (const dz of [-2.05, 2.05]) trophy(k, true, sgn * XI, F + 4.65, p.z + dz, -sgn, 0, n * 3 + 1, n++);
    }
    for (const sgn of [-1, 1]) {
      // stretched pelts by the door
      const x = sgn * (XI - 0.03);
      const za = sgn > 0 ? -147.1 : -144.9, zb = sgn > 0 ? -144.9 : -147.1;
      clothIn.quad([x, F + 1.6, za], [x, F + 1.6, zb], [x, F + 4.5, zb], [x, F + 4.5, za], { uvRect: CR.fur[sgn > 0 ? 0 : 2] });
      // tapestries above the mead tables
      const ta = sgn > 0 ? -174.6 : -179.3, tb = sgn > 0 ? -179.3 : -174.6;
      const xt = sgn * (XI - 0.16);
      clothIn.quad([xt, F + 3.55, ta], [xt, F + 3.55, tb], [xt, F + 5.9, tb], [xt, F + 5.9, ta], { uvRect: CR.tapestry[sgn > 0 ? 0 : 1], nu: 4, nv: 2, swayFromTop: 0.12 });
      woodIn.log([xt, F + 5.95, ta + (sgn > 0 ? 0.15 : -0.15)], [xt, F + 5.95, tb - (sgn > 0 ? 0.15 : -0.15)], 0.045, { radial: 6, color: C.timberDark });
      // clan banners on the north wall, trophies beside them
      const bx = sgn * 4.25, bz = ZNI + 0.16;
      clothIn.quad([bx - 0.85, F + 2.3, bz], [bx + 0.85, F + 2.3, bz], [bx + 0.85, F + 7.4, bz], [bx - 0.85, F + 7.4, bz], { uvRect: CR.clanBanner[sgn > 0 ? 1 : 0], nu: 3, nv: 8, swayFromTop: 0.1 });
      woodIn.log([bx - 1.0, F + 7.44, bz], [bx + 1.0, F + 7.44, bz], 0.05, { radial: 6, color: C.timberDark });
      trophy(k, true, sgn * 8.3, F + 4.7, ZNI, 0, 1, 5 + (sgn > 0 ? 1 : 0), sgn > 0 ? 0 : 2);
      // south wall: clan banner + shield
      const sx = sgn * 8.0, sz = ZSI - 0.16;
      clothIn.quad([sx + 0.85, F + 2.0, sz], [sx - 0.85, F + 2.0, sz], [sx - 0.85, F + 7.1, sz], [sx + 0.85, F + 7.1, sz], { uvRect: CR.clanBanner[sgn > 0 ? 0 : 1], nu: 3, nv: 8, swayFromTop: 0.14 });
      woodIn.log([sx - 1.0, F + 7.14, sz], [sx + 1.0, F + 7.14, sz], 0.05, { radial: 6, color: C.timberDark });
      // door leaves swung open against the wall (flush)
      const lz = ZSI - 0.07;
      carveIn.quad([sgn * (DOOR + 2.55), F + 0.02, lz - 0.065], [sgn * (DOOR + 0.02), F + 0.02, lz - 0.065], [sgn * (DOOR + 0.02), DOOR_TOP - 0.05, lz - 0.065], [sgn * (DOOR + 2.55), DOOR_TOP - 0.05, lz - 0.065], { uvRect: R.door, flip: sgn < 0, nv: 3 });
      woodIn.box(2.53, HALL.doorHeight - 0.07, 0.12, sgn * (DOOR + 1.285), F + HALL.doorHeight / 2 - 0.015, lz, { color: C.timberDark, grain: 1, tile: 2 });
    }
    trophy(k, true, 0, F + 6.5, ZSI, 0, -1, 2, 0);
  }

  // ------------------------------------------------------------------ cold light at the door + dust
  k.lights.push({ p: [0, F + 2.6, ZS - 0.3], c: [0.5, 1.1, 2.6], r0: 2.6, radius: 13, wrap: 0.3, zone: 1, occl: true, dir: [0, -0.34, -0.94], cone: 2.0 });
  // moonlight falling through the doorway: a long cold pool on the floor
  k.lights.push({ p: [0, F + 2.2, ZS], c: [0.8, 2.1, 5.4], r0: 1, radius: 40, wrap: 0.05, zone: 1, beam: { dir: [0.13, -0.4, -0.907], z: ZSI, x0: -DOOR, x1: DOOR, y0: F, y1: DOOR_TOP, soft: 0.4 } });
  const ND = [26, 50, 90, 150][k.d];
  k.emitters.push((P, e) => {
    // cool haze in the doorway
    P.add(0, F + 2.3, ZSI - 0.4, 5.6, 4.8, 0, SPR.blob, 0, 0.035, 0.07, 0.15, 0);
    const n = Math.round(ND * Math.min(1.4, e.k));
    for (let i = 0; i < n; i++) {
      const bx = (hashf(i, 61) - 0.5) * 17, by = F + 0.4 + hashf(i, 62) * 5.6, bz = ZNI + 2 + hashf(i, 63) * 33;
      const x = bx + Math.sin(e.time * 0.11 + i * 1.3) * 1.1, y = by + Math.sin(e.time * 0.08 + i * 2.1) * 0.6, z = bz + Math.cos(e.time * 0.09 + i * 0.7) * 1.1;
      // lit by whichever source is near: fire (warm) or door (cold)
      const dfx = x - pit.x, dfz = Math.max(0, Math.abs(z - pit.z) - 4.5);
      const warm = 1 / (1 + (dfx * dfx + dfz * dfz + (y - fireY) * (y - fireY) * 0.4) * 0.07);
      const cold = Math.exp(-(x * x) / 9) * Math.exp(-Math.pow((z - ZSI) / 5, 2));
      const tw = 0.6 + 0.4 * Math.sin(e.time * (0.7 + hashf(i, 64)) + i);
      const s = 0.028 + hashf(i, 65) * 0.03;
      P.add(x, y, z, s, s, 0, SPR.mote, 0, (1.7 * warm + 0.25 * cold) * tw, (0.75 * warm + 0.5 * cold) * tw, (0.22 * warm + 1.0 * cold) * tw, 0);
    }
  });

  return { coals, fire, fireHalf: pit.hz - 0.8 };
}

function chandelier(k: Kit, x: number, y: number, z: number, R: number, n: number, hangY: number): void {
  const { ironIn } = k;
  ironIn.add(torus(R, 0.04, 5, 28), trs(x, y, z, { rx: Math.PI / 2 }, _m), { color: C.iron });
  ironIn.add(torus(R * 0.5, 0.03, 4, 18), trs(x, y + 0.02, z, { rx: Math.PI / 2 }, _m), { color: C.iron });
  const hub: V3 = [x, y + R * 1.15, z];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    ironIn.beam([x + Math.cos(a) * R * 0.5, y + 0.02, z + Math.sin(a) * R * 0.5], [x + Math.cos(a) * R, y, z + Math.sin(a) * R], 0.04, 0.03, { color: C.iron });
    chainLine(ironIn, [x + Math.cos(a) * R, y, z + Math.sin(a) * R], hub);
  }
  chainLine(ironIn, hub, [x, hangY, z]);
  ironIn.add(unitSphere(6, 4), trs(hub[0], hub[1], hub[2], {}, _m), { color: C.ironDark }, [0.07, 0.07, 0.07]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cx = x + Math.cos(a) * R, cz = z + Math.sin(a) * R;
    ironIn.cyl(0.06, 0.075, 0.04, cx, y + 0.03, cz, { radial: 6, color: C.iron });
    ironIn.cyl(0.03, 0.026, 0.14, cx, y + 0.07, cz, { radial: 6, color: C.wax, emit: [1.4, 0.75, 0.3] });
    k.flames.add(cx, y + 0.2, cz, 0.11, 0.24, 1.6, 0.01);
  }
  k.lights.push({ p: [x, y - 0.15, z], c: [1.9 * R, 1.1 * R, 0.5 * R], r0: 1.7, radius: 10, wrap: 0.5, zone: 1 });
  k.emitters.push((P, e) => {
    const f = 0.88 + 0.12 * Math.sin(e.time * 6.1 + x + z);
    P.add(x, y + 0.2, z, R * 3.2, R * 2.4, 0, SPR.blob, 0, 0.16 * f, 0.08 * f, 0.028 * f, 0);
  });
}

function tableware(k: Kit, t: Collider): void {
  const { woodIn, ironIn } = k;
  const y = t.y1;
  const seed = t.seed % 1000;
  candle(k, t.x + 0.1, y, t.z - 1.1);
  candle(k, t.x - 0.15, y, t.z + 0.9, 0.17);
  candle(k, t.x + 0.3, y, t.z + 1.5, 0.1);
  k.lights.push({ p: [t.x, y + 0.5, t.z], c: [1.1, 0.55, 0.2], r0: 0.9, radius: 4.5, wrap: 0.4, zone: 1 });
  for (let i = 0; i < 7; i++) {
    const px = t.x + (hashf(i, seed + 1) - 0.5) * 1.1, pz = t.z - 1.7 + (3.4 * (i + hashf(i, seed + 2) * 0.6)) / 7;
    const kind = Math.floor(hashf(i, seed + 3) * 4);
    if (kind === 0) {
      // bowl with stew
      woodIn.cyl(0.085, 0.13, 0.075, px, y, pz, { radial: 8, color: C.timberDark, tile: 0.6 });
      ironIn.cyl(0.115, 0.115, 0.01, px, y + 0.062, pz, { radial: 8, color: 0x8a5a2a });
    } else if (kind === 1) {
      // drinking horn on its side, gold-rimmed
      const a = hashf(i, seed + 4) * Math.PI * 2;
      const hx = Math.cos(a) * 0.17, hz = Math.sin(a) * 0.17;
      woodIn.log([px - hx, y + 0.06, pz - hz], [px + hx, y + 0.1, pz + hz], 0.05, { radial: 6, rEnd: 0.01, color: C.horn, tile: 0.5 });
      ironIn.add(torus(1, 0.12, 4, 8), trs(px - hx, y + 0.06, pz - hz, { ry: -a + Math.PI / 2 }, _m), { color: C.gold, emit: [0.25, 0.16, 0.04] }, [0.052, 0.052, 0.3]);
    } else if (kind === 2) {
      // platter with a loaf
      ironIn.cyl(0.16, 0.17, 0.018, px, y, pz, { radial: 10, color: C.ironLite });
      woodIn.add(unitSphere(8, 5), trs(px, y + 0.06, pz, { ry: hashf(i, seed + 5) * 3 }, _m), { color: 0xb98a4e, tile: 0.4 }, [0.12, 0.06, 0.085]);
    } else {
      // jug
      ironIn.cyl(0.075, 0.05, 0.2, px, y, pz, { radial: 8, color: C.bronze, emit: [0.12, 0.07, 0.02] });
      ironIn.cyl(0.055, 0.062, 0.04, px, y + 0.2, pz, { radial: 8, color: C.bronze });
    }
  }
}
