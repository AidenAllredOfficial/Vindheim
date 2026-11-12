// The hall from outside: stone footing, log walls, cornice, steep shingled roof with snow,
// gables with crossed dragon-head finials, carved door portal, shields, banners, cressets.
import * as THREE from 'three';
import { fbm2 } from '@shared/math';
import { HALL } from '@shared/world';
import { hashf, lin, trs, unitCyl, type V3 } from './geo';
import { C, F, X0, X1, ZN, ZS, ZSI, MIDZ, cresset, dragonHead, shield, type Kit } from './kit';
import { SPR } from './textures';

export const EAVE_X = 13.5, EAVE_Y = 28.15;
export const ROOF_Z0 = ZN - 1.9, ROOF_Z1 = ZS + 1.9;
const RIDGE_Y = 40.0, RIDGE_RISE = 1.6;
export const ridgeY = (z: number): number => { const s = (z - MIDZ) / ((ROOF_Z1 - ROOF_Z0) / 2); return RIDGE_Y + RIDGE_RISE * s * s; };
/** Roof surface height at (x, z). */
export const roofY = (x: number, z: number): number => {
  const t = 1 - Math.min(1, Math.abs(x) / EAVE_X);
  return EAVE_Y + (ridgeY(z) - EAVE_Y) * t + 0.42 * Math.pow(1 - t, 8);
};
export const VENT_Z = HALL.firepit.z;

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
const DOOR = HALL.doorHalfWidth, DOOR_TOP = F + HALL.doorHeight;

function halfLogProfile(r: number, n: number): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (Math.PI * i) / n; p.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return p;
}

export function buildExterior(k: Kit): { vent: V3 } {
  const { woodOut, masonOut, planksOut, carveOut, ironOut, clothOut, roof, snow } = k;
  const R = k.T.carveRects;

  // ------------------------------------------------------------------ stone footing
  const fy0 = 16.9, fy1 = F + 0.9;
  const foot = (x0: number, x1: number, z0: number, z1: number) =>
    masonOut.box(x1 - x0, fy1 - fy0, z1 - z0, (x0 + x1) / 2, (fy0 + fy1) / 2, (z0 + z1) / 2, { color: C.stoneDark, tile: 2.2, jitter: 0.06, snow: 0.9, seg: [k.seg(x1 - x0, 6), 1, k.seg(z1 - z0, 6)] });
  foot(X0 - 0.14, X0 + 0.3, ZN - 0.14, ZS + 0.14);
  foot(X1 - 0.3, X1 + 0.14, ZN - 0.14, ZS + 0.14);
  foot(X0 + 0.3, X1 - 0.3, ZN - 0.14, ZN + 0.3);
  foot(X0 + 0.3, -DOOR - 0.7, ZS - 0.3, ZS + 0.14);
  foot(DOOR + 0.7, X1 - 0.3, ZS - 0.3, ZS + 0.14);

  // ------------------------------------------------------------------ log walls
  const r = 0.27, course = 0.5;
  const prof = halfLogProfile(r, k.d >= 2 ? 5 : 3);
  const logCol = (i: number) => (i % 5 === 3 ? C.timberOutDark : C.timberOut);
  // long walls (west / east)
  for (let i = 0; i < 17; i++) {
    const y = fy1 + course * (i + 0.5);
    for (const sgn of [-1, 1]) {
      const x = sgn * (X1 - r);
      const from = woodOut.strip([x, y, ZN - 0.02], [x, y, ZS + 0.02], [sgn, 0, 0], prof, { color: logCol(i), jitter: 0.14, tile: 2.4, seg: k.seg(37, 3), wobble: 0.014, snow: 0.34 });
      woodOut.shade(from, (_x, yy) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(yy, fy1, fy1 + 3) - 0.25 * THREE.MathUtils.smoothstep(yy, 26.2, 27.6));
      for (const ze of [ZN, ZS]) {
        const dir = ze === ZN ? -1 : 1;
        woodOut.log([x, y, ze - dir * 0.3], [x, y, ze + dir * 0.3], r * 0.98, { radial: 8, color: 0xa08c74, jitter: 0.15, tile: 1.2, snow: 0.4 });
      }
    }
  }
  // gable walls (north / south): half a course out of phase so the ends interlock
  for (let i = 0; i < 18; i++) {
    const y = fy1 + course * i;
    const col = logCol(i + 2);
    const runs: [number, number, number][] = [[X0 + 0.02, X1 - 0.02, ZN + r]];
    if (y - r < DOOR_TOP + 0.2) runs.push([X0 + 0.02, -DOOR - 0.05, ZS - r], [DOOR + 0.05, X1 - 0.02, ZS - r]);
    else runs.push([X0 + 0.02, X1 - 0.02, ZS - r]);
    for (const [xa, xb, z] of runs) {
      const dir = z < MIDZ ? -1 : 1;
      const from = woodOut.strip([xa, y, z], [xb, y, z], [0, 0, dir], prof, { color: col, jitter: 0.14, tile: 2.4, seg: k.seg(xb - xa, 3), wobble: 0.014, snow: 0.34 });
      woodOut.shade(from, (_x, yy) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(yy, fy1, fy1 + 3) - 0.25 * THREE.MathUtils.smoothstep(yy, 26.2, 27.6));
    }
    for (const sgn of [-1, 1]) for (const z of [ZN + r, ZS - r]) {
      woodOut.log([sgn * (X1 - 0.3), y, z], [sgn * (X1 + 0.3), y, z], r * 0.98, { radial: 8, color: 0xa08c74, jitter: 0.15, tile: 1.2, snow: 0.4 });
    }
  }

  // ------------------------------------------------------------------ cornice (the roof slab's rim) + corner dragons
  const cy0 = HALL.roofY0, cy1 = HALL.roofY1, cw = 0.8;
  for (const sgn of [-1, 1]) {
    woodOut.box(cw, cy1 - cy0, ZS - ZN + cw * 2, sgn * (X1 + cw / 2), (cy0 + cy1) / 2, MIDZ, { color: C.timberOutDark, grain: 2, tile: 3, seg: [1, 1, k.seg(39, 4)] });
    const xf = sgn * (X1 + cw + 0.012);
    const a: V3 = [xf, cy0 + 0.33, sgn > 0 ? ZS + cw : ZN - cw], b: V3 = [xf, cy0 + 0.33, sgn > 0 ? ZN - cw : ZS + cw];
    carveOut.stripBand(a, b, [0, 0.54, 0], R.bandRunes, 14, { color: 0xb8ab9c });
    for (const zs of [-1, 1]) {
      // dragon-headed beam ends
      const z = zs > 0 ? ZS + cw : ZN - cw;
      trs(sgn * (X1 + cw / 2), cy0 + 0.6, z - zs * 0.05, { ry: zs > 0 ? -Math.PI / 2 : Math.PI / 2 }, _m);
      woodOut.add(dragonHead(), _m, { color: C.timberOutDark, tile: 1.6, snow: 0.5 }, [0.72, 0.72, 2.2]);
    }
  }
  for (const zs of [-1, 1]) {
    const z = zs > 0 ? ZS + cw / 2 : ZN - cw / 2;
    woodOut.box(X1 - X0, cy1 - cy0, cw, 0, (cy0 + cy1) / 2, z, { color: C.timberOutDark, grain: 0, tile: 3, seg: [k.seg(24, 4), 1, 1] });
    const zf = z + zs * (cw / 2 + 0.012);
    const a: V3 = [zs > 0 ? X0 : X1, cy0 + 0.33, zf], b: V3 = [zs > 0 ? X1 : X0, cy0 + 0.33, zf];
    carveOut.stripBand(a, b, [0, 0.54, 0], R.bandRunes, 8, { color: 0xb8ab9c });
  }

  // ------------------------------------------------------------------ roof
  const NC = [12, 18, 24, 28][k.d], NZ = [12, 20, 28, 36][k.d];
  const roofCol = lin(C.roof), roofDark = lin(C.roofDark);
  const lip = 0.075;
  /** Point on the roof slope (t: 0 eave .. 1 ridge), lifted along the outward normal. out = [x, y, z, nx, ny]. */
  const pt = (sgn: number, t: number, z: number, lift: number, out: number[]) => {
    const ry = ridgeY(z);
    const x = sgn * EAVE_X * (1 - t);
    const y = EAVE_Y + (ry - EAVE_Y) * t + 0.42 * Math.pow(1 - t, 8);
    const ty = ry - EAVE_Y - 3.36 * Math.pow(1 - t, 7);
    const l = Math.hypot(ty, EAVE_X);
    out[3] = (sgn * ty) / l; out[4] = EAVE_X / l;
    out[0] = x + out[3] * lift; out[1] = y + out[4] * lift; out[2] = z;
  };
  const tmp: number[] = [0, 0, 0, 0, 0, 0];
  const snowAt = (t: number, z: number, sgn: number): number => {
    const n = fbm2(z * 0.16 + sgn * 7, t * 6 + 3, 3, 71);
    const vent = Math.exp(-((z - VENT_Z) * (z - VENT_Z)) / 18) * THREE.MathUtils.smoothstep(t, 0.55, 1);
    return THREE.MathUtils.clamp(0.3 + 0.55 * n + 0.3 * THREE.MathUtils.smoothstep(t, 0.72, 1) + 0.22 * (1 - THREE.MathUtils.smoothstep(t, 0, 0.22)) - 0.9 * vent, 0, 1);
  };
  for (const sgn of [-1, 1]) {
    for (let j = 0; j < NC; j++) {
      const t0 = j / NC, t1 = (j + 1) / NC;
      const tint = 0.86 + 0.28 * hashf(j * 13 + (sgn > 0 ? 500 : 0), 3);
      const rows: number[] = [];
      for (let i = 0; i <= NZ; i++) {
        const z = ROOF_Z0 + ((ROOF_Z1 - ROOF_Z0) * i) / NZ;
        const soot = 1 - 0.3 * Math.exp(-((z - VENT_Z) * (z - VENT_Z)) / 26) * THREE.MathUtils.smoothstep(t0, 0.5, 1);
        const var2 = 0.85 + 0.3 * fbm2(z * 0.4, j * 0.7, 2, 19);
        const c: V3 = [THREE.MathUtils.lerp(roofDark[0], roofCol[0], var2 - 0.5) * tint * soot * 1.2, THREE.MathUtils.lerp(roofDark[1], roofCol[1], var2 - 0.5) * tint * soot * 1.2, THREE.MathUtils.lerp(roofDark[2], roofCol[2], var2 - 0.5) * tint * soot * 1.2];
        pt(sgn, t0, z, lip, tmp);
        const a = roof.vert(tmp[0], tmp[1], tmp[2], tmp[3], tmp[4], 0, (z * sgn) / 1.5, j * 0.5, c, snowAt(t0, z, sgn));
        pt(sgn, t1, z, 0, tmp);
        const b = roof.vert(tmp[0], tmp[1], tmp[2], tmp[3], tmp[4], 0, (z * sgn) / 1.5, j * 0.5 + 0.5, c, snowAt(t1, z, sgn));
        rows.push(a, b);
      }
      for (let i = 0; i < NZ; i++) {
        const a = rows[i * 2], b = rows[i * 2 + 1], c = rows[i * 2 + 3], d = rows[i * 2 + 2];
        if (sgn > 0) { roof.tri(a, b, c); roof.tri(a, c, d); } else { roof.tri(a, c, b); roof.tri(a, d, c); }
      }
      // butt face under the raised lower edge
      if (k.d >= 1) {
        const dark: V3 = [roofDark[0] * 0.35, roofDark[1] * 0.35, roofDark[2] * 0.35];
        const br: number[] = [];
        for (let i = 0; i <= NZ; i++) {
          const z = ROOF_Z0 + ((ROOF_Z1 - ROOF_Z0) * i) / NZ;
          pt(sgn, t0, z, lip, tmp);
          const nx = tmp[3], ny = tmp[4];
          const a = roof.vert(tmp[0], tmp[1], tmp[2], sgn * ny, -Math.abs(nx), 0, z / 1.5, 0.02, dark);
          pt(sgn, t0, z, 0, tmp);
          const b = roof.vert(tmp[0], tmp[1], tmp[2], sgn * ny, -Math.abs(nx), 0, z / 1.5, 0.0, dark);
          br.push(a, b);
        }
        for (let i = 0; i < NZ; i++) {
          const a = br[i * 2], b = br[i * 2 + 1], c = br[i * 2 + 3], d = br[i * 2 + 2];
          if (sgn > 0) { roof.tri(a, c, b); roof.tri(a, d, c); } else { roof.tri(a, b, c); roof.tri(a, c, d); }
        }
      }
    }
    // eave fascia board
    woodOut.box(0.1, 0.34, ROOF_Z1 - ROOF_Z0, sgn * (EAVE_X + 0.02), EAVE_Y + 0.34, MIDZ, { color: C.timberOutDark, grain: 2, tile: 3, rz: sgn * -0.75, snow: 0.6 });
  }

  // soffits: dark boards under the eaves and the gable overhangs
  {
    const keep = planksOut.sky; planksOut.sky = 0.6;
    for (const sgn of [-1, 1]) {
      const xe = sgn * (EAVE_X + 0.04), xc = sgn * (X1 + 0.8);
      planksOut.quad([xc, cy1 - 0.02, ROOF_Z0], [xe, EAVE_Y + 0.36, ROOF_Z0], [xe, EAVE_Y + 0.36, ROOF_Z1], [xc, cy1 - 0.02, ROOF_Z1], { color: C.timberOutDark, grain: 1, tile: 1.36, nv: k.seg(40, 6) });
      for (const zs of [-1, 1]) {
        const zin = zs > 0 ? ZS + 0.5 : ZN - 0.5, zout = zs > 0 ? ROOF_Z1 : ROOF_Z0;
        const NS2 = 8;
        for (let i = 0; i < NS2; i++) {
          const a: number[] = [0, 0, 0, 0, 0], b: number[] = [0, 0, 0, 0, 0], c2: number[] = [0, 0, 0, 0, 0], d2: number[] = [0, 0, 0, 0, 0];
          pt(sgn, i / NS2, zin, -0.14, a); pt(sgn, (i + 1) / NS2, zin, -0.14, b); pt(sgn, (i + 1) / NS2, zout, -0.14, c2); pt(sgn, i / NS2, zout, -0.14, d2);
          planksOut.quad([a[0], a[1], zin], [d2[0], d2[1], zout], [c2[0], c2[1], zout], [b[0], b[1], zin], { color: C.timberOutDark, tile: 1.36 });
        }
      }
    }
    planksOut.sky = keep;
  }

  // ridge beam + snow cap
  {
    const n = k.seg(ROOF_Z1 - ROOF_Z0, 3);
    for (let i = 0; i < n; i++) {
      const za = ROOF_Z0 - 0.5 + ((ROOF_Z1 - ROOF_Z0 + 1) * i) / n, zb = ROOF_Z0 - 0.5 + ((ROOF_Z1 - ROOF_Z0 + 1) * (i + 1)) / n;
      woodOut.log([0, ridgeY(za) + 0.02, za], [0, ridgeY(zb) + 0.02, zb], 0.24, { radial: 8, color: C.timberOutDark, tile: 2, snow: 0.2 });
    }
    const capProf: [number, number][] = [[-0.62, -0.42], [-0.42, -0.1], [-0.2, 0.1], [0, 0.17], [0.2, 0.1], [0.42, -0.1], [0.62, -0.42]];
    const segs: [number, number][] = [[ROOF_Z0 + 0.3, VENT_Z - 3.4], [VENT_Z + 3.6, ROOF_Z1 - 0.3]];
    for (const [za, zb] of segs) {
      const m = k.seg(zb - za, 1.6);
      for (let i = 0; i < m; i++) {
        const z0 = za + ((zb - za) * i) / m, z1 = za + ((zb - za) * (i + 1)) / m;
        snow.strip([0, ridgeY(z0) + 0.27, z0], [0, ridgeY(z1) + 0.27, z1], [1, 0, 0], capProf, { color: C.snow, tile: 3, wobble: 0.05, wobbleSeed: 400 + i });
      }
    }
  }

  // eave snow drifts + icicles
  {
    for (const sgn of [-1, 1]) {
      const n = k.seg(ROOF_Z1 - ROOF_Z0, 2.2);
      for (let i = 0; i < n; i++) {
        if (hashf(i, sgn > 0 ? 61 : 62) < 0.35) continue;
        const z0 = ROOF_Z0 + ((ROOF_Z1 - ROOF_Z0) * i) / n, z1 = ROOF_Z0 + ((ROOF_Z1 - ROOF_Z0) * (i + 1)) / n;
        const t = 0.03 + 0.07 * hashf(i, 63);
        pt(sgn, t, (z0 + z1) / 2, 0.04, tmp);
        const wide = 0.6 + 0.7 * hashf(i, 64), thick = 0.14 + 0.16 * hashf(i, 65);
        // lumpy pillow lying on the slope: side direction runs up-slope
        const up: V3 = [-sgn * 0.74, 0.67, 0];
        const prof2: [number, number][] = [[-wide, 0], [-wide * 0.6, thick * 0.7], [0, thick], [wide * 0.6, thick * 0.8], [wide, 0]];
        snow.strip([tmp[0], tmp[1], z0 - 0.5], [tmp[0], tmp[1], z1 + 0.5], up, prof2, { color: C.snow, tile: 3, wobble: 0.035, wobbleSeed: 900 + i, seg: 6, taper: 0.45 });
      }
      if (k.d >= 1) {
        const ni = Math.round((ROOF_Z1 - ROOF_Z0) / (k.d >= 2 ? 0.55 : 1.1));
        for (let i = 0; i < ni; i++) {
          const h = hashf(i, sgn > 0 ? 71 : 72);
          if (h < 0.3) continue;
          const z = ROOF_Z0 + 0.2 + ((ROOF_Z1 - ROOF_Z0 - 0.4) * (i + hashf(i, 73) * 0.6)) / ni;
          const len = 0.18 + h * h * 0.75;
          trs(sgn * (EAVE_X + 0.06), EAVE_Y + 0.36 - len / 2, z, { rx: Math.PI }, _m);
          snow.add(unitCyl(5, 1, true, 0.02), _m, { color: C.ice, emit: [0.05, 0.08, 0.12] }, [0.035 + h * 0.03, len, 0.035 + h * 0.03]);
        }
      }
    }
  }

  // smoke louvre over the fire
  const ventTop = ridgeY(VENT_Z) + 1.3;
  {
    const ry = ridgeY(VENT_Z);
    for (const sx of [-0.6, 0.6]) for (const dz of [-1.25, 1.25]) woodOut.box(0.14, 1.1, 0.14, sx, ry + 0.1, VENT_Z + dz, { color: C.timberOutDark });
    const rc = lin(C.roofDark);
    for (const sgn of [-1, 1]) {
      const a = roof.vert(sgn * 1.05, ry + 0.5, VENT_Z - 1.6, sgn * 0.6, 0.8, 0, 0, 0, rc, 0.5);
      const b = roof.vert(sgn * 1.05, ry + 0.5, VENT_Z + 1.6, sgn * 0.6, 0.8, 0, 2, 0, rc, 0.5);
      const c = roof.vert(0, ventTop, VENT_Z + 1.6, sgn * 0.6, 0.8, 0, 2, 0.6, rc, 0.2);
      const d = roof.vert(0, ventTop, VENT_Z - 1.6, sgn * 0.6, 0.8, 0, 0, 0.6, rc, 0.2);
      if (sgn > 0) { roof.tri(a, d, c); roof.tri(a, c, b); } else { roof.tri(a, c, d); roof.tri(a, b, c); }
    }
    woodOut.log([0, ventTop + 0.03, VENT_Z - 1.8], [0, ventTop + 0.03, VENT_Z + 1.8], 0.1, { radial: 6, color: C.timberOutDark });
    // glow of the hearth below, seen through the louvre
    ironOut.box(0.8, 0.3, 2.2, 0, ry + 0.12, VENT_Z, { color: 0xff9a4a, emit: [0.9, 0.28, 0.06] });
  }

  // ------------------------------------------------------------------ gables
  for (const zs of [-1, 1]) {
    const z = zs > 0 ? ZS + 0.5 : ZN - 0.5;
    const pw = 0.82;
    const n = Math.round((X1 + 0.6) * 2 / pw);
    for (let i = 0; i < n; i++) {
      const xa = -(X1 + 0.6) + i * pw, xb = xa + pw;
      const ya = roofY(xa, z) - 0.12, yb = roofY(xb, z) - 0.12;
      if (Math.max(ya, yb) < cy1 + 0.05) continue;
      const p0: V3 = [xa, cy1, z], p1: V3 = [xb, cy1, z], p2: V3 = [xb, Math.max(cy1, yb), z], p3: V3 = [xa, Math.max(cy1, ya), z];
      const from = zs > 0 ? planksOut.quad(p0, p1, p2, p3, { color: C.timberOut, jitter: 0.16, grain: 1, tile: 1.36, nv: 3 }) : planksOut.quad(p1, p0, p3, p2, { color: C.timberOut, jitter: 0.16, grain: 1, tile: 1.36, nv: 3 });
      planksOut.shade(from, (_x, y) => 1 - 0.45 * THREE.MathUtils.smoothstep(y, 33, 40));
    }
    // sun-window: carved ring with a warm glowing pane
    const wy = 33.2, wr = 1.15;
    trs(0, wy, z + zs * 0.06, { ry: zs > 0 ? 0 : Math.PI }, _m);
    ironOut.add(new THREE.CircleGeometry(wr, 20), _m, { color: 0xffb060, emit: [2.4, 0.85, 0.18] });
    trs(0, wy, z + zs * 0.1, {}, _m);
    woodOut.add(new THREE.TorusGeometry(wr, 0.16, 6, 24), _m, { color: C.timberOutDark, tile: 1.5 });
    for (let a = 0; a < 4; a++) {
      const an = (a * Math.PI) / 4;
      woodOut.beam([Math.cos(an) * wr, wy + Math.sin(an) * wr, z + zs * 0.1], [-Math.cos(an) * wr, wy - Math.sin(an) * wr, z + zs * 0.1], 0.1, 0.1, { color: C.timberOutDark });
    }
    // collar beam + queen posts on the gable face
    woodOut.box(15, 0.4, 0.2, 0, 31.2, z + zs * 0.1, { color: C.timberOutDark, tile: 3 });
    for (const sx of [-4.2, 4.2]) woodOut.box(0.36, 31.2 - cy1, 0.2, sx, (31.2 + cy1) / 2, z + zs * 0.1, { color: C.timberOutDark, tile: 3 });
    for (let i = -2; i <= 2; i++) shield(k, false, i * 3.4, 29.85, z + zs * 0.02, 0, zs, 0.62, i + 9 + (zs > 0 ? 0 : 3), i * 1.1);
    carveOut.stripBand([zs > 0 ? -7.2 : 7.2, 31.02, z + zs * 0.205], [zs > 0 ? 7.2 : -7.2, 31.02, z + zs * 0.205], [0, 0.36, 0], R.bandBraid, 8, { color: 0xc9bcae });

    // bargeboards crossing into dragon heads
    const zv = zs > 0 ? ROOF_Z1 : ROOF_Z0;
    const apexY = ridgeY(zv) + 0.25;
    for (const sgn of [-1, 1]) {
      const ex = sgn * (EAVE_X + 0.25), ey = EAVE_Y + 0.25;
      const dx = -ex, dy = apexY - ey, dl = Math.hypot(dx, dy);
      const ux = dx / dl, uy = dy / dl;
      const over = 2.7;
      const zb = zv + zs * (sgn > 0 ? 0.08 : 0.3);
      const a: V3 = [ex - ux * 0.5, ey - uy * 0.5, zb], b: V3 = [ux * over, apexY + uy * over, zb];
      woodOut.beam(a, b, 0.2, 0.78, { color: C.timberOutDark, tile: 3, seg: 4, snow: 0.5 });
      // carved face strip (outer face only)
      const nxp = -uy * Math.sign(ux), nyp = Math.abs(ux); // perpendicular pointing up-slope side
      const zf = zb + zs * 0.105;
      const s0: V3 = [a[0] - nxp * 0.2, a[1] - nyp * 0.2, zf], s1: V3 = [ux * 0.6 - nxp * 0.2, apexY + uy * 0.6 - nyp * 0.2, zf];
      const upv: V3 = [nxp * 0.4, nyp * 0.4, 0];
      // keep the quad facing outward (zs) whichever way the board runs
      const faceOut = (s1[0] - s0[0]) * upv[1] - (s1[1] - s0[1]) * upv[0];
      if (faceOut * zs > 0) carveOut.stripBand(s0, s1, upv, R.bandScale, 8, { color: 0xb9ac9e });
      else carveOut.stripBand(s1, s0, upv, R.bandScale, 8, { color: 0xb9ac9e });
      // dragon head
      const beta = sgn < 0 ? Math.atan2(uy, ux) : Math.atan2(-uy, -ux);
      _m.makeTranslation(b[0] - ux * 0.25, b[1] - uy * 0.25, zb);
      _m.multiply(_r.makeRotationZ(beta));
      if (sgn > 0) _m.multiply(_r.makeRotationY(Math.PI));
      woodOut.add(dragonHead(), _m, { color: C.timberOutDark, tile: 1.6, snow: 0.55 }, [1.3, 1.3, 1.1]);
    }
  }

  // ------------------------------------------------------------------ door portal (south)
  {
    const zf = ZS;
    for (const sgn of [-1, 1]) {
      const xc = sgn * (DOOR + 0.36);
      woodOut.box(0.72, DOOR_TOP - 18.3 + 0.1, 0.28, xc, (DOOR_TOP + 18.3) / 2, zf + 0.14, { color: C.timberDark, grain: 1, tile: 2 });
      carveOut.stripBand([xc + 0.24, 18.5, zf + 0.286], [xc + 0.24, DOOR_TOP - 0.1, zf + 0.286], [-0.48, 0, 0], R.bandBraid, 2, { color: 0xd8cfc4 });
      // plinth + capital blocks (flush)
      woodOut.box(0.84, 0.3, 0.3, xc, 18.45, zf + 0.15, { color: C.timberOutDark });
      woodOut.box(0.84, 0.26, 0.3, xc, DOOR_TOP + 0.08, zf + 0.15, { color: C.timberOutDark });
    }
    woodOut.box(7.6, 0.86, 0.3, 0, DOOR_TOP + 0.62, zf + 0.15, { color: C.timberDark, tile: 3 });
    carveOut.stripBand([-3.7, DOOR_TOP + 0.34, zf + 0.306], [3.7, DOOR_TOP + 0.34, zf + 0.306], [0, 0.56, 0], R.bandRunes, 3, { color: 0xd8cfc4 });
    // tympanum fan
    const ty = DOOR_TOP + 1.05, hw = 3.4, th = 3.25, zt = zf + 0.12;
    const rect = R.tympanum;
    const white: V3 = [0.85, 0.8, 0.74];
    const cx = carveOut.vert(0, ty, zt, 0, 0, 1, (rect[0] + rect[2]) / 2, rect[1], white);
    const NA = 20;
    let prev = -1;
    for (let i = 0; i <= NA; i++) {
      const an = Math.PI - (Math.PI * i) / NA;
      const px = Math.cos(an) * hw, py = Math.sin(an) * th;
      const v = carveOut.vert(px, ty + py, zt, 0, 0, 1, rect[0] + (rect[2] - rect[0]) * (0.5 + px / (2 * hw)), rect[1] + (rect[3] - rect[1]) * (py / th) * 0.985, white);
      if (prev >= 0) carveOut.tri(cx, v, prev);
      prev = v;
    }
    // arch moulding around it
    for (let i = 0; i < NA; i++) {
      const a0 = Math.PI - (Math.PI * i) / NA, a1 = Math.PI - (Math.PI * (i + 1)) / NA;
      woodOut.beam([Math.cos(a0) * (hw + 0.12), ty + Math.sin(a0) * (th + 0.12), zf + 0.14], [Math.cos(a1) * (hw + 0.12), ty + Math.sin(a1) * (th + 0.12), zf + 0.14], 0.28, 0.3, { color: C.timberDark, tile: 2 });
    }
    // reveals inside the wall thickness (half-lit by the sky)
    const keep = planksOut.sky;
    planksOut.sky = 0.45;
    planksOut.quad([-DOOR, F, ZSI], [-DOOR, F, ZS], [-DOOR, DOOR_TOP, ZS], [-DOOR, DOOR_TOP, ZSI], { color: C.plankDark, grain: 1, tile: 1.36, nv: 3 });
    planksOut.quad([DOOR, F, ZS], [DOOR, F, ZSI], [DOOR, DOOR_TOP, ZSI], [DOOR, DOOR_TOP, ZS], { color: C.plankDark, grain: 1, tile: 1.36, nv: 3 });
    planksOut.quad([-DOOR, DOOR_TOP, ZS], [DOOR, DOOR_TOP, ZS], [DOOR, DOOR_TOP, ZSI], [-DOOR, DOOR_TOP, ZSI], { color: C.plankDark, tile: 1.36, flip: true });
    planksOut.sky = keep;
    // threshold riser (terrace 18.3 -> floor 18.6)
    masonOut.quad([-DOOR, HALL.terrace.y, ZS + 0.002], [DOOR, HALL.terrace.y, ZS + 0.002], [DOOR, F, ZS + 0.002], [-DOOR, F, ZS + 0.002], { color: C.stoneWarm, tile: 2.2, emit: [0.5, 0.2, 0.06] });
  }

  // ------------------------------------------------------------------ shields, banners, cressets, windows
  {
    let di = 0;
    for (let z = ZN + 2.2; z < ZS - 1; z += 2.75) {
      shield(k, false, X0, 26.35, z, -1, 0, 0.52, di++, di * 1.3);
      shield(k, false, X1, 26.35, z + 0.4, 1, 0, 0.52, di++, di * 1.7);
    }
    for (const sgn of [-1, 1]) {
      shield(k, false, sgn * 7.3, 25.5, ZS, 0, 1, 0.56, di++, di);
      shield(k, false, sgn * 9.7, 25.5, ZS, 0, 1, 0.56, di++, di);
      // clan banners on poles
      const bx = sgn * 5.0, top = 26.4, bw = 1.5, bh = 4.5, bz = ZS + 0.3;
      woodOut.log([bx - 0.95, top + 0.06, bz], [bx + 0.95, top + 0.06, bz], 0.05, { radial: 6, color: C.timberDark });
      for (const e of [-0.9, 0.9]) woodOut.beam([bx + e, top + 0.06, ZS], [bx + e, top + 0.06, bz], 0.06, 0.06, { color: C.timberDark });
      clothOut.quad([bx - bw / 2, top - bh, bz], [bx + bw / 2, top - bh, bz], [bx + bw / 2, top, bz], [bx - bw / 2, top, bz], { uvRect: k.T.clothRects.clanBanner[sgn > 0 ? 0 : 1], nu: 4, nv: 12, swayFromTop: 1 });
      cresset(k, false, sgn * 7.3, 22.2, ZS + 0.02, 0, 1, 0);
    }
    // glowing slit windows along the long walls
    for (let i = 0; i < 5; i++) {
      const z = ZN + 5.2 + i * 6.7;
      for (const sgn of [-1, 1]) {
        const x = sgn * X1;
        woodOut.box(0.16, 1.3, 0.72, x + sgn * 0.03, 23.7, z, { color: C.timberOutDark });
        ironOut.box(0.06, 1.0, 0.42, x + sgn * 0.1, 23.7, z, { color: 0xffb060, emit: [2.6, 0.9, 0.18] });
        ironOut.box(0.08, 1.04, 0.05, x + sgn * 0.11, 23.7, z, { color: C.ironDark });
        ironOut.box(0.08, 0.05, 0.44, x + sgn * 0.11, 23.7, z, { color: C.ironDark });
      }
    }
  }

  // snow banked against the long walls (low, tiny)
  for (const sgn of [-1, 1]) {
    const n = k.seg(36, 2.4);
    for (let i = 0; i < n; i++) {
      const z0 = ZN + (36 * i) / n + 0.6, z1 = z0 + 36 / n;
      const hgt = 0.1 + 0.14 * hashf(i, 81), wd = 0.5 + 0.5 * hashf(i, 82);
      snow.strip([sgn * (X1 + 0.14), HALL.baseY - 0.05, z0 - 0.6], [sgn * (X1 + 0.14), HALL.baseY - 0.05, z1 + 0.6], [sgn, 0, 0], [[0, hgt * 1.5], [wd * 0.3, hgt * 1.2], [wd * 0.7, hgt * 0.5], [wd, 0]], { color: C.snow, tile: 3, wobble: 0.03, wobbleSeed: 1200 + i, seg: 5, taper: 0.5 });
    }
  }

  // ------------------------------------------------------------------ smoke + sparks from the louvre
  const vent: V3 = [0, ventTop - 0.2, VENT_Z];
  const NS = [8, 14, 22, 30][k.d];
  k.emitters.push((P, e) => {
    const n = Math.round(NS * Math.min(1.2, e.k));
    for (let i = 0; i < n; i++) {
      const life = 9 + hashf(i, 31) * 5;
      const ph = (e.time / life + hashf(i, 32)) % 1;
      const age = ph * life;
      const drift = age * (0.5 + e.wind * 2.6);
      const x = vent[0] + (hashf(i, 33) - 0.5) * 1.2 + e.windX * drift + Math.sin(age * 0.5 + i) * 0.5;
      const y = vent[1] + age * (1.5 - ph * 0.5);
      const z = vent[2] + (hashf(i, 34) - 0.5) * 2.4 + e.windZ * drift + Math.cos(age * 0.4 + i * 2) * 0.5;
      const size = 1.2 + age * 0.75;
      const al = Math.min(1, ph * 9) * Math.pow(1 - ph, 1.6) * 0.34;
      const warm = Math.max(0, 1 - age * 0.45);
      // premultiplied: grey-blue smoke, lit orange from below while young
      P.add(x, y, z, size, size, i + age * 0.12, SPR.smoke, 0, (0.11 + warm * 0.75) * al, (0.12 + warm * 0.26) * al, (0.15 + warm * 0.05) * al, al);
    }
    for (let i = 0; i < Math.round(n * 0.8); i++) {
      const life = 2.2 + hashf(i, 41) * 2;
      const ph = (e.time / life + hashf(i, 42)) % 1;
      const age = ph * life;
      const x = vent[0] + (hashf(i, 43) - 0.5) * 0.9 + e.windX * age * (0.6 + e.wind * 2) + Math.sin(age * 3 + i) * 0.25;
      const y = vent[1] - 0.3 + age * 2.1;
      const z = vent[2] + (hashf(i, 44) - 0.5) * 2 + e.windZ * age * (0.6 + e.wind * 2) + Math.cos(age * 2.6 + i) * 0.25;
      const f = Math.pow(1 - ph, 1.5) * 3.2;
      P.add(x, y, z, 0.07, 0.07, 0, SPR.mote, 0, 1.0 * f, 0.42 * f, 0.08 * f, 0);
    }
  });

  // warm spill out of the doorway (exterior surfaces only)
  k.lights.push({ p: [0, F + 2.4, ZS - 0.4], c: [3.2, 1.35, 0.42], r0: 2.6, radius: 13, wrap: 0.3, zone: 0, dir: [0, -0.32, 0.95], cone: 1.6 });
  k.emitters.push((P, e) => {
    const f = 0.85 + 0.15 * Math.sin(e.time * 7.3) * Math.sin(e.time * 3.1);
    P.add(0, F + 2.0, ZS - 0.2, 6.5, 5.4, 0, SPR.blob, 0, 0.42 * f, 0.17 * f, 0.045 * f, 0);
  });
  return { vent };
}
