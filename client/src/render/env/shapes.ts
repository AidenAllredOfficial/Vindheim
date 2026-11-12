// Shape generators used to dress colliders. The central one is `prism`: an exact-footprint,
// exact-top vertical prism whose sides may be bevelled, displaced (a little) and flared, with an
// optional hanging underside. "What you see is what you collide with" is enforced here: the top
// face is the collider's top plane over the collider's footprint, and sides stay within
// MAX_BULGE of the true wall.
import * as THREE from 'three';
import { fbm2, hash2, lerp } from '@shared/math';
import { Geo, type RGB } from './common';

export const MAX_BULGE = 0.25;

export interface OutlinePt {
  x: number; z: number;
  /** Outward normal. */
  nx: number; nz: number;
  /** Inset direction for the top bevel (equals the normal except at hard corners). */
  ix: number; iz: number;
  /** Distance along the perimeter (metres). */
  u: number;
}

/** Circle, smooth. */
export function cylOutline(r: number, n: number, phase = 0): OutlinePt[] {
  const out: OutlinePt[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    out.push({ x: c * r, z: s * r, nx: c, nz: s, ix: c, iz: s, u: (i / n) * Math.PI * 2 * r });
  }
  return out;
}

/**
 * Polygon (corners in theta order). `hard` duplicates the corners so each side shades flat;
 * otherwise corner normals are averaged. Sides are subdivided to at most `seg` metres.
 */
export function polyOutline(corners: [number, number][], seg: number, hard: boolean): OutlinePt[] {
  const out: OutlinePt[] = [];
  const n = corners.length;
  const en: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    en.push([dz / l, -dx / l]);
  }
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const parts = Math.max(1, Math.ceil(len / seg));
    const prev = en[(i + n - 1) % n], cur = en[i], nxt = en[(i + 1) % n];
    // proper mitred inset directions at both ends of this side
    const mit = (p: [number, number], q: [number, number]): [number, number] => {
      const d = 1 + p[0] * q[0] + p[1] * q[1];
      return [(p[0] + q[0]) / d, (p[1] + q[1]) / d];
    };
    const m0 = mit(prev, cur), m1 = mit(cur, nxt);
    // hard corners are duplicated (each side owns both of its ends); soft ones are shared with the next side
    const last = hard ? parts : parts - 1;
    for (let k = 0; k <= last; k++) {
      const t = k / parts;
      const x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
      let nx = cur[0], nz = cur[1], ix = cur[0], iz = cur[1];
      if (k === 0) {
        ix = m0[0]; iz = m0[1];
        if (!hard) { const l = Math.hypot(m0[0], m0[1]); nx = m0[0] / l; nz = m0[1] / l; }
      } else if (k === parts) { ix = m1[0]; iz = m1[1]; }
      out.push({ x, z, nx, nz, ix, iz, u: u + len * t });
    }
    u += len;
  }
  return out;
}

export const boxOutline = (hx: number, hz: number, seg: number, hard: boolean): OutlinePt[] =>
  polyOutline([[hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]], seg, hard);

/** Regular polygon whose flats touch radius `r` at their corners (corners at radius r). */
export function ngonOutline(r: number, sides: number, phase: number, seg: number, hard = true): OutlinePt[] {
  const c: [number, number][] = [];
  for (let i = 0; i < sides; i++) { const a = phase + (i / sides) * Math.PI * 2; c.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return polyOutline(c, seg, hard);
}

export interface PrismOpts {
  /** Exact walkable top height at a local (x, z). */
  top: (x: number, z: number) => number;
  /** Lowest side ring (world y). */
  bottom: number;
  rings?: number;
  bevel?: number;
  /** Outward displacement in metres at depth-fraction v (0 top .. 1 bottom). Clamped to ±MAX_BULGE. */
  disp?: (p: OutlinePt, y: number, v: number) => number;
  /** Extra outward spread at the base (metres, clamped). */
  flare?: number;
  topColor: RGB;
  sideColor: RGB;
  sideColorLow?: RGB;
  topSurf: [number, number, number, number];
  sideSurf: [number, number, number, number];
  cap?: 'none' | 'flat' | 'taper';
  taperDepth?: number;
  taperSeed?: number;
  /** Wood grain runs vertically on the sides (trunks, masts). */
  uvVertical?: boolean;
  /** Swap the top's uv axes (planks across instead of along). */
  topUvSwap?: boolean;
  noTop?: boolean;
}

export function prism(g: Geo, o: OutlinePt[], opt: PrismOpts): void {
  const n = o.length;
  const bevel = opt.bevel ?? 0.05;
  const topC = opt.top(0, 0);
  // ---- top face (its own vertices: exactly flat / exactly the ramp plane)
  if (!opt.noTop) {
    g.color(opt.topColor).surface(...opt.topSurf);
    const c = g.v(0, topC, 0, 0, 0);
    const t0 = g.count;
    for (let i = 0; i < n; i++) {
      const p = o[i];
      const x = p.x - p.ix * bevel, z = p.z - p.iz * bevel;
      if (opt.topUvSwap) g.v(x, opt.top(x, z), z, z, x); else g.v(x, opt.top(x, z), z, x, z);
    }
    for (let i = 0; i < n; i++) g.tri(c, t0 + (i + 1) % n, t0 + i);
  }
  // ---- bevel + sides
  let minTop = Infinity;
  for (let i = 0; i < n; i++) minTop = Math.min(minTop, opt.top(o[i].x, o[i].z));
  const height = Math.max(0.05, minTop - bevel - opt.bottom);
  const rings = opt.rings ?? Math.max(1, Math.min(8, Math.round(height / 0.9)));
  const low = opt.sideColorLow ?? opt.sideColor;
  const flare = Math.min(opt.flare ?? 0, MAX_BULGE);
  const starts: number[] = [];
  g.surface(...opt.sideSurf);
  // bevel upper ring
  starts.push(g.count);
  g.color(opt.sideColor);
  for (let i = 0; i < n; i++) {
    const p = o[i];
    const x = p.x - p.ix * bevel, z = p.z - p.iz * bevel, y = opt.top(x, z);
    if (opt.uvVertical) g.v(x, y, z, y, p.u); else g.v(x, y, z, p.u, y);
  }
  for (let k = 0; k <= rings; k++) {
    const v = k / rings;
    starts.push(g.count);
    g.color([lerp(opt.sideColor[0], low[0], v), lerp(opt.sideColor[1], low[1], v), lerp(opt.sideColor[2], low[2], v)]);
    for (let i = 0; i < n; i++) {
      const p = o[i];
      const yTop = opt.top(p.x, p.z) - bevel;
      const y = lerp(yTop, opt.bottom, v);
      let d = 0;
      if (k > 0) {
        const ease = Math.min(1, (yTop - y) / 0.4);
        d = (opt.disp ? opt.disp(p, y, v) : 0) * ease + flare * v * v;
        d = Math.max(-MAX_BULGE, Math.min(MAX_BULGE, d));
      }
      const x = p.x + p.nx * d, z = p.z + p.nz * d;
      if (opt.uvVertical) g.v(x, y, z, y, p.u); else g.v(x, y, z, p.u, y);
    }
  }
  for (let k = 0; k < starts.length - 1; k++) g.bridge(starts[k], starts[k + 1], n, true);
  const lastRing = starts[starts.length - 1];
  // ---- underside
  if (opt.cap === 'flat') {
    g.color(low);
    const c = g.v(0, opt.bottom, 0, 0, 0);
    const b0 = g.count;
    for (let i = 0; i < n; i++) g.v(g.pos[(lastRing + i) * 3], opt.bottom, g.pos[(lastRing + i) * 3 + 2], o[i].x, o[i].z);
    for (let i = 0; i < n; i++) g.tri(c, b0 + i, b0 + (i + 1) % n);
  } else if (opt.cap === 'taper') {
    const depth = opt.taperDepth ?? 2;
    const seed = opt.taperSeed ?? 1;
    const M = 4;
    let prev = lastRing;
    // off-centre keel so the hanging rock is not a perfect cone
    const kx = (hash2(seed, 1, 5) - 0.5) * 0.5, kz = (hash2(seed, 2, 5) - 0.5) * 0.5;
    let ext = 0;
    for (let i = 0; i < n; i++) ext = Math.max(ext, Math.hypot(o[i].x, o[i].z));
    for (let m = 1; m <= M; m++) {
      const f = m / M;
      const s = 1 - Math.pow(f, 1.25);
      const shade = 1 - f * 0.45;
      g.color([low[0] * shade, low[1] * shade, low[2] * shade]);
      g.surface(0, 0, 0, opt.sideSurf[3]);
      const st = g.count;
      for (let i = 0; i < n; i++) {
        const bx = g.pos[(lastRing + i) * 3], bz = g.pos[(lastRing + i) * 3 + 2];
        const x = lerp(kx * ext, bx, s), z = lerp(kz * ext, bz, s);
        const nn = fbm2(x * 0.7 + seed, z * 0.7 - seed, 2, seed);
        const y = opt.bottom - depth * Math.pow(f, 0.85) * (0.55 + 0.9 * nn * (1 - f) + 0.45 * f);
        g.v(x, y, z, o[i].u, y);
      }
      g.bridge(prev, st, n, true);
      prev = st;
    }
  }
}

// ----------------------------------------------------------------------------------------------
// Small solids
// ----------------------------------------------------------------------------------------------

const _c = new THREE.Vector3();

/** Flat quad that always faces away from (cx, cy, cz). */
export function quadOut(g: Geo, p0: number[], p1: number[], p2: number[], p3: number[], cx: number, cy: number, cz: number, su = 1, sv = 1): void {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const mx = (p0[0] + p2[0]) / 2 - cx, my = (p0[1] + p2[1]) / 2 - cy, mz = (p0[2] + p2[2]) / 2 - cz;
  if (nx * mx + ny * my + nz * mz >= 0) g.flatQuad(p0, p1, p2, p3, su, sv);
  else g.flatQuad(p1, p0, p3, p2, su, sv);
}

/** A straight beam of rectangular section from a to b. uv.x runs along its length (metres). */
export function beam(g: Geo, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, upHint?: THREE.Vector3, taper = 1): void {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  if (len < 1e-5) return;
  d.multiplyScalar(1 / len);
  const up = upHint ? upHint.clone() : new THREE.Vector3(0, 1, 0);
  if (Math.abs(d.dot(up)) > 0.95) up.set(1, 0, 0);
  const s = new THREE.Vector3().crossVectors(d, up).normalize();
  const t = new THREE.Vector3().crossVectors(s, d).normalize();
  const corner = (p: THREE.Vector3, sx: number, tx: number, k: number): number[] => [
    p.x + s.x * sx * w * 0.5 * k + t.x * tx * h * 0.5 * k,
    p.y + s.y * sx * w * 0.5 * k + t.y * tx * h * 0.5 * k,
    p.z + s.z * sx * w * 0.5 * k + t.z * tx * h * 0.5 * k,
  ];
  _c.addVectors(a, b).multiplyScalar(0.5);
  const A = [corner(a, -1, -1, 1), corner(a, 1, -1, 1), corner(a, 1, 1, 1), corner(a, -1, 1, 1)];
  const B = [corner(b, -1, -1, taper), corner(b, 1, -1, taper), corner(b, 1, 1, taper), corner(b, -1, 1, taper)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const across = i % 2 === 0 ? w : h;
    // uv: x along the beam, y across this face
    quadOut(g, A[i], B[i], B[j], A[j], _c.x, _c.y, _c.z, len, across);
  }
  quadOut(g, A[0], A[1], A[2], A[3], _c.x, _c.y, _c.z, w, h);
  quadOut(g, B[0], B[1], B[2], B[3], _c.x, _c.y, _c.z, w, h);
}

/** A round tube along a polyline, smooth-shaded. radius(t) with t in 0..1. */
export function tube(g: Geo, pts: THREE.Vector3[], radius: (t: number) => number, seg: number, capEnds = true): void {
  const n = pts.length;
  if (n < 2) return;
  const d = new THREE.Vector3(), s = new THREE.Vector3(), t = new THREE.Vector3(), ref = new THREE.Vector3(0, 1, 0);
  const starts: number[] = [];
  let along = 0;
  // a stable frame: project the previous side vector onto the new normal plane
  d.subVectors(pts[1], pts[0]).normalize();
  if (Math.abs(d.y) > 0.9) ref.set(1, 0, 0);
  s.crossVectors(ref, d).normalize();
  for (let k = 0; k < n; k++) {
    if (k > 0) along += pts[k].distanceTo(pts[k - 1]);
    if (k === 0) d.subVectors(pts[1], pts[0]);
    else if (k === n - 1) d.subVectors(pts[k], pts[k - 1]);
    else d.subVectors(pts[k + 1], pts[k - 1]);
    d.normalize();
    s.addScaledVector(d, -s.dot(d)).normalize();
    t.crossVectors(d, s);
    const r = radius(k / (n - 1));
    starts.push(g.count);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      g.v(pts[k].x + (s.x * c + t.x * sn) * r, pts[k].y + (s.y * c + t.y * sn) * r, pts[k].z + (s.z * c + t.z * sn) * r, along, (i / seg) * 2 * Math.PI * r);
    }
  }
  for (let k = 0; k < n - 1; k++) g.bridge(starts[k], starts[k + 1], seg, true);
  if (capEnds) {
    const c0 = g.v(pts[0].x, pts[0].y, pts[0].z, 0, 0);
    for (let i = 0; i < seg; i++) g.tri(c0, starts[0] + (i + 1) % seg, starts[0] + i);
    const c1 = g.v(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z, along, 0);
    const l = starts[n - 1];
    for (let i = 0; i < seg; i++) g.tri(c1, l + i, l + (i + 1) % seg);
  }
}

/** Surface of revolution around a vertical axis. profile = [radius, y] from TOP to BOTTOM for outward faces. */
export function lathe(g: Geo, cx: number, cz: number, profile: [number, number][], seg: number): void {
  const starts: number[] = [];
  for (const [r, y] of profile) {
    starts.push(g.count);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      g.v(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, (i / seg) * 2 * Math.PI * Math.max(r, 0.05), y);
    }
  }
  for (let k = 0; k < starts.length - 1; k++) g.bridge(starts[k], starts[k + 1], seg, true);
}

/** A pointed shard (crystal splinter, splintered wood, icicle-like spike) from base centre toward tip. */
export function spike(g: Geo, base: THREE.Vector3, tip: THREE.Vector3, r: number, sides: number, twist = 0): void {
  const d = new THREE.Vector3().subVectors(tip, base).normalize();
  const ref = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3().crossVectors(ref, d).normalize();
  const t = new THREE.Vector3().crossVectors(d, s);
  const ring: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const a = twist + (i / sides) * Math.PI * 2, c = Math.cos(a) * r, sn = Math.sin(a) * r;
    ring.push([base.x + s.x * c + t.x * sn, base.y + s.y * c + t.y * sn, base.z + s.z * c + t.z * sn]);
  }
  const mid = new THREE.Vector3().addVectors(base, tip).multiplyScalar(0.5);
  for (let i = 0; i < sides; i++) {
    const p = ring[i], q = ring[(i + 1) % sides];
    // flat facets, oriented outward
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = tip.x - p[0], vy = tip.y - p[1], vz = tip.z - p[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (p[0] + q[0]) / 2 - mid.x, my = (p[1] + q[1]) / 2 - mid.y, mz = (p[2] + q[2]) / 2 - mid.z;
    if (nx * mx + ny * my + nz * mz >= 0) g.flatTri(p[0], p[1], p[2], q[0], q[1], q[2], tip.x, tip.y, tip.z);
    else g.flatTri(q[0], q[1], q[2], p[0], p[1], p[2], tip.x, tip.y, tip.z);
  }
}

/** A lumpy boulder-ish blob (unit size, flat-shaded) for instancing: pebbles, floating rocks. */
export function blobGeometry(seed: number, detail: number, flatten: number, keel: number): THREE.BufferGeometry {
  const src = new THREE.IcosahedronGeometry(1, detail);
  const p = src.getAttribute('position');
  const g = new Geo();
  g.color([1, 1, 1]).surface(0.8, 0.2, 0, 0);
  const v = new THREE.Vector3();
  const disp = (x: number, y: number, z: number): THREE.Vector3 => {
    const n = fbm2(x * 1.7 + seed, z * 1.7 + y * 1.3, 3, seed) * 0.7 + fbm2(y * 2.1 - seed, x * 1.9 + z, 2, seed + 5) * 0.3;
    let r = 0.62 + n * 0.75;
    let yy = y;
    if (y > 0) yy = y * flatten; else { yy = y * keel; r *= 1 - Math.min(0.75, -y * 0.55); }
    return v.set(x * r, yy * (0.7 + n * 0.5), z * r);
  };
  for (let i = 0; i < p.count; i += 3) {
    const a = disp(p.getX(i), p.getY(i), p.getZ(i)).clone();
    const b = disp(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)).clone();
    const c = disp(p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)).clone();
    g.flatTri(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  src.dispose();
  return g.build();
}

/**
 * A distant shard of the old world: a ragged plateau over a cluster of hanging spires (unit
 * radius, flat-shaded, for instancing far outside the playable space).
 */
export function shardGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const src = new THREE.IcosahedronGeometry(1, detail);
  const p = src.getAttribute('position');
  const g = new Geo();
  const ss = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const disp = (x: number, y: number, z: number, out: number[]): void => {
    const ang = Math.atan2(z, x);
    const rim = 0.62 + 0.5 * fbm2(Math.cos(ang) * 1.4 + seed, Math.sin(ang) * 1.4 - seed, 3, seed) + 0.28 * fbm2(Math.cos(ang) * 5 - seed, Math.sin(ang) * 5 + seed, 2, seed + 9);
    if (y >= 0) {
      const mound = 0.5 + 0.9 * fbm2(x * 2.3 + seed, z * 2.3, 2, seed + 3);
      out[0] = x * rim; out[1] = Math.sqrt(y) * 0.2 * mound; out[2] = z * rim;
      return;
    }
    const lobe = fbm2(x * 1.9 + seed * 1.7, z * 1.9 - seed, 3, seed + 11);
    const depth = Math.pow(-y, 1.05) * (0.7 + 2.6 * ss(0.3, 0.75, lobe));
    const shrink = 1 - Math.pow(-y, 0.8) * 0.72;
    const rough = 1 + (fbm2(x * 4 + y * 3, z * 4 - y * 2, 2, seed + 5) - 0.5) * 0.4;
    out[0] = x * rim * shrink * rough; out[1] = -depth; out[2] = z * rim * shrink * rough;
  };
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < p.count; i += 3) {
    disp(p.getX(i), p.getY(i), p.getZ(i), a);
    disp(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1), b);
    disp(p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2), c);
    const yAvg = (a[1] + b[1] + c[1]) / 3;
    const k = yAvg >= 0 ? 1.05 : Math.max(0.45, 1 + yAvg * 0.28);
    g.color([k, k, k]).surface(yAvg > -0.25 ? 0.9 : 0, 0.15, 0, 0);
    g.flatTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  src.dispose();
  return g.build();
}
