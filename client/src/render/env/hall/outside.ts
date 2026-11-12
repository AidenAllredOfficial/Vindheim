// Outside the hall: stone terrace with fire bowls and a low kerb, the causeway to the sparring
// ring, the ring itself (rope-and-post boundary, low props off the platform) and the Skygate.
import * as THREE from 'three';
import { HALL } from '@shared/world';
import { hashf, lin, trs, type V3 } from './geo';
import { C, axe, cresset, dragonHead, spear, sword, type Kit } from './kit';
import { runeIndex } from './runes';
import { SPR } from './textures';
import { ELEMENT_ORDER, ELEMENTS } from '@shared/elements';

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
/** Skygate energy colours (linear). */
export const GATE_TEAL: V3 = [0.1, 0.95, 0.72], GATE_ICE: V3 = [0.55, 0.92, 1.0];

export interface OutsideBuild {
  /** Membrane geometry (own material); uv = metres across / above the terrace. */
  membrane: THREE.BufferGeometry;
  gate: V3;
  /** Height of the arch spring line above the terrace. */
  springRel: number;
}

/** Low fire bowl on a kerb pier: everything below 0.4 m, the flames are the only tall part. */
function fireBowl(k: Kit, x: number, z: number, y: number): void {
  const { rockOut, ironOut } = k;
  rockOut.box(0.62, 0.2, 0.62, x, y + 0.1, z, { color: C.stoneDark, tile: 1.2, snow: 0.3 });
  ironOut.cyl(0.16, 0.3, 0.16, x, y + 0.2, z, { radial: 10, color: C.iron, emit: [0.5, 0.14, 0.03] });
  ironOut.cyl(0.26, 0.26, 0.02, x, y + 0.345, z, { radial: 10, color: 0xffb060, emit: [5, 1.5, 0.22] });
  k.flames.add(x, y + 0.33, z, 0.62, 1.05, 1.1, 0.07);
  k.flames.add(x + 0.05, y + 0.33, z - 0.04, 0.4, 0.65, 1.25, 0.04);
  k.lights.push({ p: [x, y + 0.9, z], c: [2.6, 1.1, 0.34], r0: 1.4, radius: 8, wrap: 0.4, zone: 0 });
  k.emitters.push((P, e) => {
    const f = 0.8 + 0.2 * Math.sin(e.time * 8.7 + x) * Math.sin(e.time * 4.1 + z);
    P.add(x, y + 0.75, z, 2.8, 2.6, 0, SPR.blob, 0, 0.5 * f, 0.19 * f, 0.04 * f, 0);
    for (let i = 0; i < 4; i++) {
      const life = 1.3 + hashf(i, 3) * 0.9, ph = (e.time / life + hashf(i, 4) + x * 0.1) % 1;
      const a = Math.pow(1 - ph, 1.5) * 4;
      P.add(x + Math.sin(ph * 5 + i * 2) * 0.16 + e.windX * ph * e.wind, y + 0.5 + ph * 1.9, z + Math.cos(ph * 4 + i) * 0.16 + e.windZ * ph * e.wind, 0.05, 0.05, 0, SPR.mote, 0, a, a * 0.4, a * 0.07, 0);
    }
  });
}

export function buildOutside(k: Kit): OutsideBuild {
  const { pave, masonOut, rockOut, woodOut, ironOut, carveOut, clothOut, snow, glyph } = k;
  const R = k.T.carveRects, G = k.T.glyphRects;
  const T = HALL.terrace, RG = HALL.ring, GT = HALL.gate;
  const ty = T.y;
  const tx0 = T.x - T.hx, tx1 = T.x + T.hx, tz0 = T.z - T.hz, tz1 = T.z + T.hz;
  const bridge = k.world.colliders.find((c) => c.kind === 'bridge' && c.z < -100)!;
  const bz0 = bridge.z - bridge.hz, bz1 = bridge.z + bridge.hz;

  // ------------------------------------------------------------------ terrace
  {
    const from = pave.quad([tx0, ty, tz1], [tx1, ty, tz1], [tx1, ty, tz0], [tx0, ty, tz0], { color: C.stone, tile: 3, nu: k.seg(18, 1.3), nv: k.seg(23, 1.3), snow: 0.5 });
    // worn, darker lane from the door to the gate; snow gathers toward the edges
    for (let i = from; i < pave.vertexCount; i++) {
      const x = pave.pos[i * 3], z = pave.pos[i * 3 + 2];
      const lane = Math.exp(-(x * x) / 9);
      const w = 0.92 - 0.14 * lane + 0.12 * hashf(i, 5);
      pave.col[i * 3] *= w; pave.col[i * 3 + 1] *= w; pave.col[i * 3 + 2] *= w;
      const edge = Math.max(THREE.MathUtils.smoothstep(Math.abs(x), 5, 9), THREE.MathUtils.smoothstep(z, tz1 - 4, tz1) * 0.5);
      pave.fx[i * 2] = THREE.MathUtils.clamp(0.26 + 0.42 * edge - 0.2 * lane + 0.2 * (hashf(i, 6) - 0.5), 0, 1);
    }
    const yb = 16.8;
    masonOut.quad([tx1, yb, tz1], [tx1, yb, tz0], [tx1, ty, tz0], [tx1, ty, tz1], { color: C.stoneDark, tile: 2.2, nu: 6 });
    masonOut.quad([tx0, yb, tz0], [tx0, yb, tz1], [tx0, ty, tz1], [tx0, ty, tz0], { color: C.stoneDark, tile: 2.2, nu: 6 });
    masonOut.quad([tx0, yb, tz1], [tx1, yb, tz1], [tx1, ty, tz1], [tx0, ty, tz1], { color: C.stoneDark, tile: 2.2, nu: 6 });

    // low kerb stones (0.26..0.32 high) with gaps for the causeway and the gate
    const kerb = (xa: number, za: number, xb: number, zb: number) => {
      const len = Math.hypot(xb - xa, zb - za);
      const n = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const cx = xa + (xb - xa) * (t0 + t1) / 2, cz = za + (zb - za) * (t0 + t1) / 2;
        const h = 0.25 + 0.07 * hashf(i + Math.round(xa * 7 + za * 3), 9);
        const alongX = Math.abs(xb - xa) > Math.abs(zb - za);
        rockOut.box(alongX ? len / n - 0.04 : 0.3, h, alongX ? 0.3 : len / n - 0.04, cx, ty + h / 2, cz, { color: C.stone, jitter: 0.14, tile: 1.6, snow: 0.55 });
      }
    };
    kerb(tx0 + 0.16, tz0 + 0.5, tx0 + 0.16, tz1 - 0.7);
    kerb(tx1 - 0.16, tz0 + 0.5, tx1 - 0.16, bz0 - 0.1);
    kerb(tx1 - 0.16, bz1 + 0.1, tx1 - 0.16, tz1 - 0.7);
    kerb(tx0 + 0.7, tz1 - 0.16, -GT.halfWidth - 1.7, tz1 - 0.16);
    kerb(GT.halfWidth + 1.7, tz1 - 0.16, tx1 - 0.7, tz1 - 0.16);
    // fire bowls on low piers
    fireBowl(k, tx0 + 0.36, tz1 - 0.36, ty);
    fireBowl(k, tx1 - 0.36, tz1 - 0.36, ty);
    fireBowl(k, tx0 + 0.36, T.z + 1.5, ty);
    fireBowl(k, tx1 - 0.36, bz1 + 0.5, ty);
    fireBowl(k, tx1 - 0.36, bz0 - 0.5, ty);
    // drifted snow in the lee of the kerbs
    for (const sgn of [-1, 1]) for (let i = 0; i < 9; i++) {
      if (hashf(i, sgn > 0 ? 13 : 14) < 0.3) continue;
      const z0 = tz0 + 1 + i * 2.4, wd = 0.5 + hashf(i, 15) * 0.6, h = 0.08 + hashf(i, 16) * 0.12;
      if (sgn > 0 && z0 + 2.2 > bz0 - 0.4 && z0 < bz1 + 0.4) continue;
      const x = sgn * (T.hx - 0.3);
      snow.strip([x, ty, z0], [x, ty, z0 + 2.2], [-sgn, 0, 0], [[0, h * 1.4], [wd * 0.4, h], [wd, 0.005]], { color: C.snow, tile: 3, wobble: 0.025, wobbleSeed: 300 + i, seg: 5, taper: 0.5 });
    }
    // rune circle inlaid before the gate
    const cz = tz1 - 3.3, cr = 2.75, gy = ty + 0.012;
    glyph.quad([-cr, gy, cz + cr], [cr, gy, cz + cr], [cr, gy, cz - cr], [-cr, gy, cz - cr], G.circle, [GATE_TEAL[0] * 0.75, GATE_TEAL[1] * 0.75, GATE_TEAL[2] * 0.75], 0.2);
  }

  // ------------------------------------------------------------------ causeway (the 'bridge' collider)
  {
    const xa = tx1, xb = RG.x - RG.r + 0.25;
    const ya = bridge.y1, yb2 = bridge.y1b ?? bridge.y1;
    const bx0 = bridge.x - bridge.hx, bx1 = bridge.x + bridge.hx;
    const yAt = (x: number) => ya + (yb2 - ya) * THREE.MathUtils.clamp((x - bx0) / (bx1 - bx0), 0, 1);
    const nz = 5, nx = 8;
    const col = lin(C.stoneWarm);
    const grid: number[] = [];
    for (let j = 0; j <= nz; j++) {
      const z = bz0 + ((bz1 - bz0) * j) / nz;
      // far end follows the ring's rim so the two tops do not overlap
      const xe = RG.x - Math.sqrt(Math.max(0, RG.r * RG.r - (z - RG.z) * (z - RG.z))) + 0.02;
      for (let i = 0; i <= nx; i++) {
        const x = xa + ((Math.max(xb, xe) - xa) * i) / nx;
        const w = 0.85 + 0.2 * hashf(i * 9 + j, 21);
        grid.push(pave.vert(x, yAt(x) + 0.002, z, 0, 1, 0, x / 2.4, z / 2.4, [col[0] * w, col[1] * w, col[2] * w], 0.35 + 0.3 * hashf(i + j * 5, 22)));
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = grid[j * (nx + 1) + i], b = a + 1, c = a + nx + 2, d = a + nx + 1; pave.tri(a, d, c); pave.tri(a, c, b); }
    masonOut.quad([xa, 16.8, bz1], [xb + 0.4, 16.8, bz1], [xb + 0.4, yAt(xb), bz1], [xa, ya, bz1], { color: C.stoneDark, tile: 2.2 });
    masonOut.quad([xb + 0.4, 16.8, bz0], [xa, 16.8, bz0], [xa, ya, bz0], [xb + 0.4, yAt(xb), bz0], { color: C.stoneDark, tile: 2.2 });
    for (const z of [bz0 + 0.14, bz1 - 0.14]) for (let i = 0; i < 4; i++) {
      const x = xa + 0.5 + i * 1.32;
      rockOut.box(1.2, 0.2, 0.26, x + 0.3, yAt(x) + 0.1, z, { color: C.stone, jitter: 0.14, tile: 1.6, snow: 0.7 });
    }
  }

  // ------------------------------------------------------------------ sparring ring
  {
    const y = RG.y, cx = RG.x, cz = RG.z;
    const seg = [28, 40, 56, 64][k.d];
    carveOut.disc(cx, y + 0.003, cz, 0, 1.75, 28, 1, { uvRect: R.inlay, color: 0xcfcbd8 });
    rockOut.disc(cx, y, cz, 1.75, 2.05, seg, 1, { color: C.stoneDark, polar: true, tile: 1.6 });
    pave.disc(cx, y, cz, 2.05, 5.15, seg, 3, { color: C.stone, polar: true, tile: 3, snow: 0.3 });
    // carved band
    {
      const r0 = 5.15, r1 = 5.72, reps = 12, per = Math.round(seg / reps) || 1;
      const rect = R.bandStone;
      const white = lin(0xcfcbd8);
      for (let rp = 0; rp < reps; rp++) for (let s = 0; s < per; s++) {
        const a0 = ((rp + s / per) / reps) * Math.PI * 2, a1 = ((rp + (s + 1) / per) / reps) * Math.PI * 2;
        const u0 = rect[0] + (rect[2] - rect[0]) * (s / per), u1 = rect[0] + (rect[2] - rect[0]) * ((s + 1) / per);
        const a = carveOut.vert(cx + Math.cos(a0) * r0, y + 0.002, cz + Math.sin(a0) * r0, 0, 1, 0, u0, rect[1], white);
        const b = carveOut.vert(cx + Math.cos(a1) * r0, y + 0.002, cz + Math.sin(a1) * r0, 0, 1, 0, u1, rect[1], white);
        const c = carveOut.vert(cx + Math.cos(a1) * r1, y + 0.002, cz + Math.sin(a1) * r1, 0, 1, 0, u1, rect[3], white);
        const d = carveOut.vert(cx + Math.cos(a0) * r1, y + 0.002, cz + Math.sin(a0) * r1, 0, 1, 0, u0, rect[3], white);
        carveOut.tri(a, b, c); carveOut.tri(a, c, d);
      }
    }
    // outer kerb slabs
    const nk = 30;
    for (let i = 0; i < nk; i++) {
      const a0 = (i / nk) * Math.PI * 2 + 0.01, a1 = ((i + 1) / nk) * Math.PI * 2 - 0.01;
      const w = 0.8 + 0.3 * hashf(i, 31);
      const col = lin(C.stone);
      const cc: V3 = [col[0] * w, col[1] * w, col[2] * w];
      const sn = 0.3 + 0.5 * hashf(i, 32);
      const pts = [[a0, 5.72], [a1, 5.72], [a1, RG.r], [a0, RG.r]].map(([an, rr]) => rockOut.vert(cx + Math.cos(an) * rr, y, cz + Math.sin(an) * rr, 0, 1, 0, (an * rr) / 1.6, rr / 1.6, cc, sn));
      rockOut.tri(pts[0], pts[1], pts[2]); rockOut.tri(pts[0], pts[2], pts[3]);
    }
    masonOut.cyl(RG.r, RG.r, y - 16.6, cx, 16.6, cz, { radial: seg, open: true, color: C.stoneDark, tile: 2.2 });

    // rope-and-post boundary: low and purely visual, open toward the causeway
    const np = 18, pr = RG.r - 0.28, ph = 0.36;
    const postAt = (i: number): V3 | null => {
      const an = (i / np) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(an - Math.PI), Math.cos(an - Math.PI))) < 0.3) return null;
      return [cx + Math.cos(an) * pr, y, cz + Math.sin(an) * pr];
    };
    for (let i = 0; i < np; i++) {
      const p = postAt(i);
      if (!p) continue;
      woodOut.cyl(0.065, 0.055, ph, p[0], y, p[2], { radial: 6, color: C.timberOutDark, tile: 0.8, snow: 0.6 });
      ironOut.cyl(0.075, 0.075, 0.04, p[0], y + ph - 0.09, p[2], { radial: 6, color: C.ironDark });
      const q = postAt(i + 1) ?? (i + 1 === np ? postAt(0) : null);
      if (!q) continue;
      const m = 4;
      let prev: V3 = [p[0], y + ph - 0.07, p[2]];
      for (let s = 1; s <= m; s++) {
        const t = s / m;
        const cur: V3 = [p[0] + (q[0] - p[0]) * t, y + ph - 0.07 - Math.sin(t * Math.PI) * 0.1, p[2] + (q[2] - p[2]) * t];
        woodOut.log(prev, cur, 0.02, { radial: 4, color: C.rope, tile: 0.4 });
        prev = cur;
      }
    }

    // ---- low props OFF the platform (on the terrain, toward the hall side)
    const g = (x: number, z: number) => { const h = k.world.terrainHeight(x, z); return h > -1e8 ? h : HALL.baseY; };
    {
      // weapon rest: two log trestles carrying a rail, weapons leaning on it
      const wx = 17.0, wz = -140.3, wa = 0.55;
      const dx = Math.cos(wa), dz = Math.sin(wa);
      const gy = g(wx, wz);
      const pA: V3 = [wx - dx * 1.1, gy + 0.22, wz - dz * 1.1], pB: V3 = [wx + dx * 1.1, gy + 0.22, wz + dz * 1.1];
      woodOut.log(pA, pB, 0.05, { radial: 6, color: C.timberOutDark, snow: 0.5 });
      for (const e of [pA, pB]) for (const s2 of [-1, 1]) woodOut.log([e[0] - dz * s2 * 0.2, gy - 0.05, e[2] + dx * s2 * 0.2], [e[0], gy + 0.25, e[2]], 0.04, { radial: 5, color: C.timberOutDark });
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5;
        const rx = pA[0] + (pB[0] - pA[0]) * t, rz = pA[2] + (pB[2] - pA[2]) * t;
        // everything stays under knee height: butts on the snow, heads resting on the rail
        const gf = (x: number, z: number) => g(x, z) + 0.03;
        const fx = rx + dz * 0.8, fz = rz - dx * 0.8;
        const foot: V3 = [fx, gf(fx, fz), fz], head: V3 = [rx - dz * 0.16, gy + 0.28, rz + dx * 0.16];
        if (i % 3 === 0) { const sx2 = rx + dz * 1.5, sz2 = rz - dx * 1.5; spear(k, false, [sx2, gf(sx2, sz2), sz2], [rx, gy + 0.275, rz]); }
        else if (i % 3 === 1) axe(k, false, foot, head, Math.PI / 2);
        else sword(k, false, head, foot);
      }
      // a couple of shields lying flat against the trestle
      for (const s of [-1, 1]) {
        const sx = wx + dx * s * 1.5, sz = wz + dz * s * 1.5;
        trs(sx, g(sx, sz) + 0.07, sz, { rx: -Math.PI / 2 + 0.2 * s, ry: s }, _m);
        carveOut.add(new THREE.CircleGeometry(0.46, 20), _m, { uvRect: R.shield[s > 0 ? 3 : 6] });
      }
    }
    {
      // straw targets: low bales with a painted roundel laid on top, a few arrows
      for (const [sx, sz, a] of [[15.6, -126.4, 0.4], [18.3, -124.9, -0.3]] as [number, number, number][]) {
        const gy = g(sx, sz);
        trs(sx, gy + 0.15, sz, { ry: a }, _m);
        woodOut.add(new THREE.BoxGeometry(1.0, 0.32, 0.6, 2, 1, 1), _m, { color: 0xa8956a, tile: 0.7, grain: 0, snow: 0.45, jitter: 0.1 });
        for (const o of [-0.28, 0.28]) { trs(sx, gy + 0.15, sz, { ry: a }, _m); _m.multiply(_r.makeTranslation(o, 0, 0)); ironOut.add(new THREE.BoxGeometry(0.035, 0.34, 0.62), _m, { color: C.rope }); }
        trs(sx, gy + 0.325, sz, { rx: -Math.PI / 2, ry: a }, _m);
        carveOut.add(new THREE.CircleGeometry(0.36, 18), _m, { uvRect: R.shield[5] });
        for (let i = 0; i < 3; i++) {
          const ax = sx + (hashf(i, 41 + sx) - 0.5) * 0.4, az = sz + (hashf(i, 42 + sx) - 0.5) * 0.3;
          woodOut.log([ax, gy + 0.28, az], [ax + (hashf(i, 43) - 0.5) * 0.1, gy + 0.35, az + 0.04], 0.008, { radial: 4, color: C.bone });
        }
      }
    }
  }

  // ------------------------------------------------------------------ the Skygate
  const posts = k.world.colliders.filter((c) => c.kind === 'gatepost');
  const gz = GT.z, springY = Math.max(...posts.map((p) => p.y1)) + 0.5;
  const archR = GT.halfWidth + 0.7;       // centre-line radius = post centres
  {
    const runes = ELEMENT_ORDER.map((el) => runeIndex(ELEMENTS[el].rune));
    posts.forEach((p, pi) => {
      const r = p.hx;
      rockOut.cyl(r, r - 0.03, p.y1 - p.y0, p.x, p.y0, p.z, { radial: 14, hseg: 4, color: C.stoneGate, tile: 2.4, jitter: 0.05 });
      rockOut.cyl(r + 0.1, r + 0.06, 0.34, p.x, ty - 0.02, p.z, { radial: 14, color: C.stoneDark, tile: 1.6, snow: 0.5 });
      for (const y of [ty + 1.0, ty + 3.2, ty + 5.4]) carveOut.ringBand(p.x, y, y + 0.4, p.z, r + 0.012, R.bandStone, 2, 16, { color: 0xcdd3e6 });
      // capital
      rockOut.box(1.7, 0.5, 1.5, p.x, p.y1 + 0.25, p.z, { color: C.stoneGate, tile: 1.6, snow: 0.8 });
      // glowing rune columns, facing the terrace (north) and the drop (south)
      for (let j = 0; j < 4; j++) {
        const y0 = ty + 1.5 + j * 1.1 + (j >= 2 ? 0.1 : 0);
        for (const ang of [-Math.PI / 2, Math.PI / 2]) {
          glyph.onCylinder(p.x, y0, y0 + 0.9, p.z, r + 0.02, ang, 0.9, G.rune[runes[(pi * 4 + j) % 8]], [GATE_TEAL[0] * 1.7, GATE_TEAL[1] * 1.7, GATE_TEAL[2] * 1.7], (j + pi * 4) / 8, 3);
        }
      }
      // iron fire baskets high on the outer faces
      const sgn = Math.sign(p.x);
      cresset(k, false, p.x + sgn * r, ty + 3.7, p.z, sgn, 0, 0, 1.1);
      // winged dragon heads rising from the capitals (above head height)
      trs(p.x + sgn * 0.45, p.y1 + 0.5, p.z, { ry: sgn > 0 ? 0 : Math.PI, rz: 0.42 }, _m);
      rockOut.add(dragonHead(), _m, { color: C.stoneGate, tile: 1.6, snow: 0.6 }, [1.4, 1.4, 1.9]);
    });
    // arch of voussoirs
    const nv = 15, thick = 1.3, depth = 1.15;
    for (let i = 0; i < nv; i++) {
      const a = Math.PI * ((i + 0.5) / nv);
      const cxv = GT.x + Math.cos(a) * archR, cyv = springY + Math.sin(a) * archR;
      const key = i === (nv - 1) / 2;
      const arcLen = (Math.PI * (archR + thick / 2)) / nv;
      trs(cxv, cyv, gz, { rz: a - Math.PI / 2 }, _m);
      rockOut.add(new THREE.BoxGeometry(arcLen * (key ? 1.25 : 0.96), key ? thick + 0.5 : thick, key ? depth + 0.3 : depth), _m, { color: key ? C.stone : C.stoneGate, tile: 1.8, jitter: 0.1, snow: 0.85 });
      // a rune on each face of each stone; the pulse runs around the arch
      for (const zs of [-1, 1]) {
        const zf = gz + zs * ((key ? depth + 0.3 : depth) / 2 + 0.012);
        const hs = key ? 0.62 : 0.4;
        const ux = Math.cos(a - Math.PI / 2), uy = Math.sin(a - Math.PI / 2);   // along the arc
        const vx = Math.cos(a), vy = Math.sin(a);                               // outward
        const q = (su: number, sv: number): V3 => [cxv + ux * su * hs * zs + vx * sv * hs, cyv + uy * su * hs * zs + vy * sv * hs, zf];
        const rect = key ? G.valknut : G.rune[(i * 5 + 3) % 24];
        const pw = key ? 2.6 : 1.5;
        glyph.quad(q(1, -1), q(-1, -1), q(-1, 1), q(1, 1), rect, [GATE_ICE[0] * pw, GATE_ICE[1] * pw, GATE_ICE[2] * pw], i / nv);
      }
    }
    // pennants streaming from the dragon heads
    for (const sgn of [-1, 1]) {
      const px = sgn * (archR + 1.6), py = springY + 1.95;
      woodOut.log([px, py - 0.5, gz], [px, py + 1.5, gz], 0.035, { radial: 5, color: C.timberOutDark });
      clothOut.quad([px, py + 0.75, gz], [px + sgn * 1.5, py + 0.75, gz], [px + sgn * 1.5, py + 1.5, gz], [px, py + 1.5, gz], { uvRect: k.T.clothRects.pennant, nu: 6, nv: 2, swayFromLeft: 1.6 });
    }
  }

  // membrane: rectangle with a round top, down into the ground
  const membrane = new THREE.BufferGeometry();
  {
    const hw = GT.halfWidth + 0.02;
    const sp = springY - ty;
    const s = new THREE.Shape();
    s.moveTo(-hw, -1.5); s.lineTo(hw, -1.5); s.lineTo(hw, sp);
    s.absarc(0, sp, hw, 0, Math.PI, false);
    s.lineTo(-hw, -1.5);
    const sg = new THREE.ShapeGeometry(s, 20);
    const pos = sg.attributes.position as THREE.BufferAttribute;
    const p: number[] = [], uv: number[] = [];
    for (let i = 0; i < pos.count; i++) { p.push(GT.x + pos.getX(i), ty + pos.getY(i), gz); uv.push(pos.getX(i), pos.getY(i)); }
    membrane.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    membrane.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    membrane.setIndex(sg.index);
    membrane.computeBoundingSphere();
    sg.dispose();
  }
  const gate: V3 = [GT.x, ty + 3.4, gz];
  // gate light on the surrounding stone
  k.lights.push({ p: [GT.x, ty + 3.0, gz - 0.6], c: [0.2, 1.05, 0.85], r0: 3.2, radius: 17, wrap: 0.45, zone: 0 });
  k.lights.push({ p: [GT.x, ty + 3.0, gz + 0.6], c: [0.2, 1.05, 0.85], r0: 3.2, radius: 12, wrap: 0.45, zone: 0 });
  const NG = [14, 26, 44, 64][k.d];
  const springRel = springY - ty;
  k.emitters.push((P, e) => {
    const t = e.time;
    const pulse = 0.85 + 0.15 * Math.sin(t * 1.3);
    // body glow in front of and behind the membrane
    P.add(GT.x, ty + 3.6, gz, 8.5, 10, 0, SPR.blob, 0, 0.012 * pulse, 0.085 * pulse, 0.07 * pulse, 0);
    P.add(GT.x, ty + springRel * 0.62, gz, 3.6, 3.6, t * 0.1, SPR.flare, 0, 0.05 * pulse, 0.16 * pulse, 0.16 * pulse, 0);
    const n = Math.round(NG * Math.min(1.4, e.k));
    for (let i = 0; i < n; i++) {
      // motes drawn in a spiral toward the membrane from both sides
      const life = 2.6 + hashf(i, 71) * 2.6, ph = (t / life + hashf(i, 72)) % 1;
      const side = i % 2 ? 1 : -1;
      const an = i * 2.4 + ph * (3 + hashf(i, 73) * 2), rr = (0.5 + hashf(i, 74) * 2.6) * (1 - ph * 0.75);
      const x = GT.x + Math.cos(an) * rr, y = ty + springRel * 0.62 + Math.sin(an) * rr * 1.25;
      if (y < ty + 0.1) continue;
      const z = gz + side * (1 - ph) * (1 - ph) * 3.4;
      const a = Math.min(1, ph * 6) * (1 - ph * ph) * 3.2;
      const s = 0.05 + hashf(i, 75) * 0.06;
      P.add(x, y, z, s, s, 0, i % 5 === 0 ? SPR.spark : SPR.mote, 0, (0.2 + 0.5 * hashf(i, 76)) * a, 0.95 * a, 0.85 * a, 0);
    }
    for (let i = 0; i < Math.round(n * 0.3); i++) {
      // sparks crawling up the inner edge of the frame
      const ph = (t * (0.25 + hashf(i, 81) * 0.2) + hashf(i, 82)) % 1;
      const side = i % 2 ? 1 : -1;
      const hw = GT.halfWidth - 0.05;
      const yy = ph * (springRel + hw * 1.3);
      let x: number, y: number;
      if (yy < springRel) { x = side * hw; y = yy; } else { const a2 = (yy - springRel) / hw; x = side * Math.cos(Math.min(a2, 1.57)) * hw; y = springRel + Math.sin(Math.min(a2, 1.57)) * hw; }
      const a = Math.sin(ph * Math.PI) * 3;
      P.add(GT.x + x, ty + y, gz, 0.14, 0.14, t + i, SPR.spark, 0, 0.6 * a, a, a, 0);
    }
  });
  return { membrane, gate, springRel };
}
