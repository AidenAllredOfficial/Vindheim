// Geometry toolkit for the Hearth-Hall: a merging mesh builder with automatic world-scale UVs,
// per-vertex albedo tint, and a light "baker" that stores fake static lighting (fire, candles,
// door spill, pedestal glow weights) in vertex attributes.
import * as THREE from 'three';
import { Rng } from '@shared/math';

export type V3 = [number, number, number];
/** Atlas rectangle: u0, v0 (bottom-left), u1, v1 (top-right). */
export type UVRect = [number, number, number, number];

const _c = new THREE.Color();
/** Cheap deterministic hash -> [0, 1). */
export const hashf = (i: number, seed = 0): number => {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
/** sRGB hex -> linear rgb triple. */
export const lin = (hex: number): V3 => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };

export interface Piece {
  /** Albedo tint (sRGB hex). */
  color?: number;
  /** Per-piece brightness variation (0..1). */
  jitter?: number;
  /** Local axis (0 x, 1 y, 2 z) the texture U (grain) runs along. */
  grain?: 0 | 1 | 2;
  /** Metres per texture repeat. */
  tile?: number;
  /** Map the geometry's own 0..1 UVs into this atlas rectangle instead of auto-UVs. */
  uvRect?: UVRect;
  /** With uvRect: repeat the rect this many times along U (geometry u in 0..1). */
  uRepeat?: number;
  /** Swap U and V of the source geometry before mapping into uvRect. */
  uvSwap?: boolean;
  /** Cylindrical auto-UV: circumference derived from this radius (uses the geometry's own u for the angle). */
  cyl?: number;
  /** Snow amount on up-facing surfaces (0..1). */
  snow?: number;
  /** Cloth sway weight applied to every vertex (cloth helpers set their own gradient). */
  sway?: number;
  /** Multiplies baked light on this piece (dark recesses < 1). */
  occ?: number;
  /** Self-illumination added to the baked light (linear HDR, multiplied by albedo in the shader). */
  emit?: V3;
}

export interface Rot { rx?: number; ry?: number; rz?: number }

const boxCache = new Map<string, THREE.BoxGeometry>();
const cylCache = new Map<string, THREE.CylinderGeometry>();
const sphCache = new Map<string, THREE.SphereGeometry>();
const torCache = new Map<string, THREE.TorusGeometry>();

export function unitBox(sx = 1, sy = 1, sz = 1): THREE.BoxGeometry {
  const k = `${sx},${sy},${sz}`;
  let g = boxCache.get(k);
  if (!g) boxCache.set(k, (g = new THREE.BoxGeometry(1, 1, 1, sx, sy, sz)));
  return g;
}
/** Unit cylinder along Y: bottom radius 1, top radius `top`, height 1 (centred). */
export function unitCyl(radial = 12, hseg = 1, open = false, top = 1): THREE.CylinderGeometry {
  const k = `${radial},${hseg},${open},${top}`;
  let g = cylCache.get(k);
  if (!g) cylCache.set(k, (g = new THREE.CylinderGeometry(top, 1, 1, radial, hseg, open)));
  return g;
}
export function unitSphere(w = 10, h = 8, thetaLen = Math.PI): THREE.SphereGeometry {
  const k = `${w},${h},${thetaLen}`;
  let g = sphCache.get(k);
  if (!g) sphCache.set(k, (g = new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, thetaLen)));
  return g;
}
export function torus(R: number, r: number, radial = 6, tubular = 16, arc = Math.PI * 2): THREE.TorusGeometry {
  const k = `${R},${r},${radial},${tubular},${arc}`;
  let g = torCache.get(k);
  if (!g) torCache.set(k, (g = new THREE.TorusGeometry(R, r, radial, tubular, arc)));
  return g;
}
export function disposePrimitiveCaches(): void {
  for (const m of [boxCache, cylCache, sphCache, torCache]) { for (const g of m.values()) g.dispose(); m.clear(); }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

export function trs(x: number, y: number, z: number, r: Rot = {}, out = new THREE.Matrix4()): THREE.Matrix4 {
  _e.set(r.rx || 0, r.ry || 0, r.rz || 0, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s);
}

/**
 * Accumulates transformed primitives into one indexed geometry with attributes
 * position / normal / uv / color (+ sky zone, snow, sway used by the hall materials).
 */
export class Batch {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  /** Per vertex: sky visibility (1 outside, ~0 inside), bake occlusion multiplier. */
  zone: number[] = [];
  /** Per vertex: snow, sway. */
  fx: number[] = [];
  /** Per vertex: self-illumination rgb. */
  emit: number[] = [];
  idx: number[] = [];
  /** Zone for the pieces added next: 1 = exterior (sky lit), 0 = interior. */
  sky = 1;
  usesFx = false;
  readonly rng: Rng;

  constructor(seed: number) { this.rng = new Rng(seed); }

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  /** Push one raw vertex (for hand-built surfaces); returns its index. `rgb` is linear. */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, rgb: V3, snow = 0, sway = 0, emit?: V3): number {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v); this.col.push(rgb[0], rgb[1], rgb[2]);
    this.zone.push(this.sky, 1); this.fx.push(snow, sway);
    if (emit) this.emit.push(emit[0], emit[1], emit[2]); else this.emit.push(0, 0, 0);
    if (snow > 0 || sway > 0) this.usesFx = true;
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }

  /** Add a geometry. `scale` is applied in local space before `m` (lets unit primitives be cached). */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, o: Piece = {}, scale?: V3): number {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const n = geo.attributes.normal as THREE.BufferAttribute;
    const t = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const base = this.pos.length / 3;
    const sx = scale ? scale[0] : 1, sy = scale ? scale[1] : 1, sz = scale ? scale[2] : 1;
    _nm.getNormalMatrix(m);
    const rgb = lin(o.color ?? 0xffffff);
    const j = 1 + (this.rng.next() * 2 - 1) * (o.jitter ?? 0);
    const cr = rgb[0] * j, cg = rgb[1] * j, cb = rgb[2] * j;
    const tile = o.tile ?? 2, g = o.grain ?? 0;
    const ou = this.rng.next(), ov = this.rng.next();
    const rect = o.uvRect, rep = o.uRepeat ?? 1;
    const l = [0, 0, 0];
    const snow = o.snow ?? 0, sway = o.sway ?? 0, occ = o.occ ?? 1;
    if (snow > 0 || sway > 0) this.usesFx = true;
    for (let i = 0; i < p.count; i++) {
      l[0] = p.getX(i) * sx; l[1] = p.getY(i) * sy; l[2] = p.getZ(i) * sz;
      let nx = n.getX(i) / sx, ny = n.getY(i) / sy, nz = n.getZ(i) / sz;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      let u = 0, v = 0;
      if (rect && t) {
        let tu = t.getX(i), tv = t.getY(i);
        if (o.uvSwap) { const s = tu; tu = tv; tv = s; }
        tu *= rep;
        if (rep > 1) { const f = Math.floor(tu - 1e-6); tu = tu - f; if (tu > 1) tu = 1; }
        u = rect[0] + (rect[2] - rect[0]) * tu;
        v = rect[1] + (rect[3] - rect[1]) * tv;
      } else {
        const an = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
        const dom = an[0] >= an[1] && an[0] >= an[2] ? 0 : an[1] >= an[2] ? 1 : 2;
        if (o.cyl !== undefined && t && an[g] < 0.8) {
          u = l[g] / tile + ou;
          v = (t.getX(i) * Math.PI * 2 * o.cyl) / tile + ov;
        } else if (dom === g) {
          u = l[(g + 1) % 3] / tile + ou; v = l[(g + 2) % 3] / tile + ov;
        } else {
          u = l[g] / tile + ou; v = l[3 - g - dom] / tile + ov;
        }
      }
      _v.set(l[0], l[1], l[2]).applyMatrix4(m);
      _n.set(nx, ny, nz).applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.uv.push(u, v);
      this.col.push(cr, cg, cb);
      this.zone.push(this.sky, occ);
      this.fx.push(snow * THREE.MathUtils.smoothstep(_n.y, 0.15, 0.75), sway);
      if (o.emit) this.emit.push(o.emit[0], o.emit[1], o.emit[2]); else this.emit.push(0, 0, 0);
    }
    if (geo.index) {
      const ix = geo.index;
      for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    return base;
  }

  /** Axis-aligned (optionally rotated) box centred at (x, y, z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, o: Piece & Rot & { seg?: V3 } = {}): number {
    const sg = o.seg || [1, 1, 1];
    const grain = o.grain ?? (w >= h && w >= d ? 0 : h >= d ? 1 : 2);
    return this.add(unitBox(sg[0], sg[1], sg[2]), trs(x, y, z, o, _m), { ...o, grain }, [w, h, d]);
  }

  /** Vertical cylinder / cone frustum standing on y0. */
  cyl(rBot: number, rTop: number, h: number, x: number, y0: number, z: number, o: Piece & Rot & { radial?: number; hseg?: number; open?: boolean } = {}): number {
    const top = Math.round((rTop / rBot) * 1000) / 1000;
    return this.add(unitCyl(o.radial ?? 12, o.hseg ?? 1, o.open ?? false, top), trs(x, y0 + h / 2, z, o, _m), { grain: 1, cyl: rBot, ...o }, [rBot, h, rBot]);
  }

  /** Rectangular beam from A to B (cross-section w wide, h tall), grain along its length. */
  beam(a: V3, b: V3, w: number, h: number, o: Piece & { seg?: number; roll?: number } = {}): number {
    const m = basisAlong(a, b, o.roll ?? 0);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    return this.add(unitBox(o.seg ?? 1, 1, 1), m, { grain: 0, ...o }, [len, h, w]);
  }

  /** Round log from A to B. */
  log(a: V3, b: V3, r: number, o: Piece & { radial?: number; hseg?: number; rEnd?: number } = {}): number {
    const m = basisAlong(a, b, 0);
    // cylinder axis is local Y -> rotate so Y maps onto the beam's X axis
    _q.setFromAxisAngle(_z.set(0, 0, 1), -Math.PI / 2);
    const rotm = new THREE.Matrix4().makeRotationFromQuaternion(_q);
    m.multiply(rotm);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const top = Math.round(((o.rEnd ?? r) / r) * 1000) / 1000;
    return this.add(unitCyl(o.radial ?? 10, o.hseg ?? 1, false, top), m, { grain: 1, cyl: r, ...o }, [r, len, r]);
  }

  /**
   * Quad p0 (bottom-left) -> p1 (bottom-right) -> p2 (top-right) -> p3 (top-left), subdivided nu x nv.
   * UVs span `uvRect` (or world-scale auto UVs along the edges when omitted). Sway (cloth) can be
   * graded from the top edge (v = 1 pinned) with `swayFromTop`.
   */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, o: Piece & { nu?: number; nv?: number; swayFromTop?: number; swayFromLeft?: number; flip?: boolean } = {}): number {
    const nu = o.nu ?? 1, nv = o.nv ?? 1;
    const base = this.pos.length / 3;
    const rgb = lin(o.color ?? 0xffffff);
    const j = 1 + (this.rng.next() * 2 - 1) * (o.jitter ?? 0);
    const rect = o.uvRect;
    const tile = o.tile ?? 2;
    const lu = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), lv = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
    const ou = rect ? 0 : this.rng.next(), ov = rect ? 0 : this.rng.next();
    _x.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _y.set(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
    _n.crossVectors(_x, _y).normalize();
    if (o.flip) _n.negate();
    const snow = (o.snow ?? 0) * THREE.MathUtils.smoothstep(_n.y, 0.15, 0.75);
    if (snow > 0 || o.sway || o.swayFromTop || o.swayFromLeft) this.usesFx = true;
    for (let iv = 0; iv <= nv; iv++) {
      const tv = iv / nv;
      for (let iu = 0; iu <= nu; iu++) {
        const tu = iu / nu;
        const ax = p0[0] + (p1[0] - p0[0]) * tu, ay = p0[1] + (p1[1] - p0[1]) * tu, az = p0[2] + (p1[2] - p0[2]) * tu;
        const bx = p3[0] + (p2[0] - p3[0]) * tu, by = p3[1] + (p2[1] - p3[1]) * tu, bz = p3[2] + (p2[2] - p3[2]) * tu;
        this.pos.push(ax + (bx - ax) * tv, ay + (by - ay) * tv, az + (bz - az) * tv);
        this.nrm.push(_n.x, _n.y, _n.z);
        let su = tu, sv = tv;
        if (o.uvSwap) { su = tv; sv = tu; }
        if (rect) this.uv.push(rect[0] + (rect[2] - rect[0]) * su, rect[1] + (rect[3] - rect[1]) * sv);
        else if (o.grain === 1) this.uv.push((tv * lv) / tile + ou, (tu * lu) / tile + ov);
        else this.uv.push((tu * lu) / tile + ou, (tv * lv) / tile + ov);
        this.col.push(rgb[0] * j, rgb[1] * j, rgb[2] * j);
        this.zone.push(this.sky, o.occ ?? 1);
        if (o.emit) this.emit.push(o.emit[0], o.emit[1], o.emit[2]); else this.emit.push(0, 0, 0);
        let sw = o.sway ?? 0;
        if (o.swayFromTop) sw += o.swayFromTop * (1 - tv) * (1 - tv * 0.5);
        if (o.swayFromLeft) sw += o.swayFromLeft * tu;
        this.fx.push(snow, sw);
      }
    }
    const row = nu + 1;
    for (let iv = 0; iv < nv; iv++) for (let iu = 0; iu < nu; iu++) {
      const a = base + iv * row + iu, b = a + 1, c = a + row + 1, d = a + row;
      if (o.flip) this.idx.push(a, c, b, a, d, c); else this.idx.push(a, b, c, a, c, d);
    }
    return base;
  }

  /**
   * Sweep a 2D profile along a -> b. Profile points are [side, up] offsets (side along `side`, up
   * along +Y); the surface faces the way the profile bulges. Smooth-shaded.
   */
  strip(a: V3, b: V3, side: V3, profile: [number, number][], o: Piece & { seg?: number; wobble?: number; wobbleSeed?: number; /** > 0: the profile swells from nothing at both ends (mounds, drifts) */ taper?: number } = {}): number {
    const seg = o.seg ?? 1, np = profile.length;
    const base = this.pos.length / 3;
    const rgb = lin(o.color ?? 0xffffff);
    const j = 1 + (this.rng.next() * 2 - 1) * (o.jitter ?? 0);
    const tile = o.tile ?? 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ou = this.rng.next(), ov = this.rng.next();
    const ws = o.wobbleSeed ?? Math.floor(this.rng.next() * 1e6);
    const pn: [number, number][] = [], arc: number[] = [0];
    for (let k = 0; k < np; k++) {
      const p0 = profile[Math.max(0, k - 1)], p1 = profile[Math.min(np - 1, k + 1)];
      const ts = p1[0] - p0[0], tu = p1[1] - p0[1], tl = Math.hypot(ts, tu) || 1;
      pn.push([tu / tl, -ts / tl]);
      if (k > 0) arc.push(arc[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
    }
    const snowAmt = o.snow ?? 0;
    if (snowAmt > 0 || o.sway) this.usesFx = true;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const cx = a[0] + (b[0] - a[0]) * t, cy = a[1] + (b[1] - a[1]) * t, cz = a[2] + (b[2] - a[2]) * t;
      const tp = o.taper ? Math.pow(Math.max(0, Math.sin(Math.PI * t)), o.taper) : 1;
      for (let k = 0; k < np; k++) {
        let s = profile[k][0] * tp, u = profile[k][1] * tp;
        if (o.wobble && tp > 0.05) {
          const w = (hashf(i * 31 + k * 7, ws) - 0.5) * 2 * o.wobble;
          s += pn[k][0] * w; u += pn[k][1] * w;
        }
        this.pos.push(cx + side[0] * s, cy + side[1] * s + u, cz + side[2] * s);
        const nx = side[0] * pn[k][0], ny = side[1] * pn[k][0] + pn[k][1], nz = side[2] * pn[k][0];
        const nl = Math.hypot(nx, ny, nz) || 1;
        this.nrm.push(nx / nl, ny / nl, nz / nl);
        this.uv.push((t * len) / tile + ou, arc[k] / tile + ov);
        this.col.push(rgb[0] * j, rgb[1] * j, rgb[2] * j);
        this.zone.push(this.sky, o.occ ?? 1);
        if (o.emit) this.emit.push(o.emit[0], o.emit[1], o.emit[2]); else this.emit.push(0, 0, 0);
        this.fx.push(snowAmt * THREE.MathUtils.smoothstep(ny / nl, 0.15, 0.75), o.sway ?? 0);
      }
    }
    // winding: make the geometric normal agree with the profile normal
    _x.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const mid = Math.min(np - 2, Math.floor(np / 2));
    const ds = profile[mid + 1][0] - profile[mid][0], du = profile[mid + 1][1] - profile[mid][1];
    _y.set(side[0] * ds, side[1] * ds + du, side[2] * ds);
    _n.crossVectors(_x, _y);
    const ps = (pn[mid][0] + pn[mid + 1][0]) / 2, pu = (pn[mid][1] + pn[mid + 1][1]) / 2;
    const flip = _n.x * side[0] * ps + _n.y * (side[1] * ps + pu) + _n.z * side[2] * ps < 0;
    for (let i = 0; i < seg; i++) for (let k = 0; k < np - 1; k++) {
      const p0 = base + i * np + k, p1 = p0 + np, p2 = p1 + 1, p3 = p0 + 1;
      if (flip) this.idx.push(p0, p2, p1, p0, p3, p2); else this.idx.push(p0, p1, p2, p0, p2, p3);
    }
    return base;
  }

  /**
   * Band wrapped around a vertical cylinder, textured with an atlas strip repeated `repeats` times.
   * `start` / `arc` (radians, angle = atan2(z, x)) allow partial bands (plaques on a drum).
   */
  ringBand(x: number, y0: number, y1: number, z: number, radius: number, rect: UVRect, repeats: number, radial: number, o: Piece & { start?: number; arc?: number; rTop?: number } = {}): number {
    const base = this.pos.length / 3;
    const rgb = lin(o.color ?? 0xffffff);
    const start = o.start ?? 0, arc = o.arc ?? Math.PI * 2;
    const per = Math.max(1, Math.round(radial / repeats));
    const rTop = o.rTop ?? radius;
    let vi = base;
    for (let r = 0; r < repeats; r++) {
      for (let s = 0; s <= per; s++) {
        const f = (r + s / per) / repeats;
        // u runs left -> right for a viewer outside: decreasing angle
        const ang = start + arc * (1 - f);
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const u = rect[0] + (rect[2] - rect[0]) * (s / per);
        this.pos.push(x + cs * radius, y0, z + sn * radius, x + cs * rTop, y1, z + sn * rTop);
        this.nrm.push(cs, 0, sn, cs, 0, sn);
        this.uv.push(u, rect[1], u, rect[3]);
        for (let k = 0; k < 2; k++) {
          this.col.push(rgb[0], rgb[1], rgb[2]);
          this.zone.push(this.sky, o.occ ?? 1);
          if (o.emit) this.emit.push(o.emit[0], o.emit[1], o.emit[2]); else this.emit.push(0, 0, 0);
          this.fx.push(0, 0);
        }
        if (s < per) this.idx.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1);
        vi += 2;
      }
    }
    return base;
  }

  /** Flat band from a (bottom-left) to b (bottom-right) rising by `up`, atlas strip repeated `repeats` times. */
  stripBand(a: V3, b: V3, up: V3, rect: UVRect, repeats: number, o: Piece = {}): number {
    const base = this.vertexCount;
    for (let r = 0; r < repeats; r++) {
      const t0 = r / repeats, t1 = (r + 1) / repeats;
      const p0: V3 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0];
      const p1: V3 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1];
      this.quad(p0, p1, [p1[0] + up[0], p1[1] + up[1], p1[2] + up[2]], [p0[0] + up[0], p0[1] + up[1], p0[2] + up[2]], { ...o, uvRect: rect });
    }
    return base;
  }

  /** Flat disc / annulus on the XZ plane facing up. UVs: atlas rect, polar bands, or planar world-scale. */
  disc(x: number, y: number, z: number, r0: number, r1: number, radial: number, rings: number, o: Piece & { polar?: boolean } = {}): number {
    const base = this.pos.length / 3;
    const rgb = lin(o.color ?? 0xffffff);
    const j = 1 + (this.rng.next() * 2 - 1) * (o.jitter ?? 0);
    const tile = o.tile ?? 2;
    const rect = o.uvRect;
    const snow = o.snow ?? 0;
    if (snow > 0) this.usesFx = true;
    const ou = this.rng.next();
    for (let ir = 0; ir <= rings; ir++) {
      const r = r0 + ((r1 - r0) * ir) / rings;
      for (let ia = 0; ia <= radial; ia++) {
        const ang = (ia / radial) * Math.PI * 2;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        this.pos.push(x + cs * r, y, z + sn * r);
        this.nrm.push(0, 1, 0);
        if (rect) this.uv.push(rect[0] + (rect[2] - rect[0]) * (0.5 + (cs * r) / (2 * r1)), rect[1] + (rect[3] - rect[1]) * (0.5 - (sn * r) / (2 * r1)));
        else if (o.polar) this.uv.push((ang * (r0 + r1) * 0.5) / tile + ou, r / tile);
        else this.uv.push((x + cs * r) / tile, (z + sn * r) / tile);
        this.col.push(rgb[0] * j, rgb[1] * j, rgb[2] * j);
        this.zone.push(this.sky, o.occ ?? 1);
        if (o.emit) this.emit.push(o.emit[0], o.emit[1], o.emit[2]); else this.emit.push(0, 0, 0);
        this.fx.push(snow, 0);
      }
    }
    const row = radial + 1;
    for (let ir = 0; ir < rings; ir++) for (let ia = 0; ia < radial; ia++) {
      const a = base + ir * row + ia, b = a + 1, c = a + row + 1, d = a + row;
      this.idx.push(a, b, c, a, c, d);
    }
    return base;
  }

  /** Multiply the vertex colours of vertices [from, to) by a function of position (cheap hand-painted shading). */
  shade(from: number, fn: (x: number, y: number, z: number) => number, to = this.vertexCount): void {
    for (let i = from; i < to; i++) {
      const k = fn(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.col[i * 3] *= k; this.col[i * 3 + 1] *= k; this.col[i * 3 + 2] *= k;
    }
  }

  /** Displace vertices [from, to) (used for organic wobble on logs, snow, cloth folds). */
  warp(from: number, fn: (p: THREE.Vector3, n: THREE.Vector3) => void, to = this.vertexCount): void {
    for (let i = from; i < to; i++) {
      _v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      _n.set(this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]);
      fn(_v, _n);
      this.pos[i * 3] = _v.x; this.pos[i * 3 + 1] = _v.y; this.pos[i * 3 + 2] = _v.z;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFx', new THREE.Float32BufferAttribute(this.fx, 2));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Matrix whose local +X runs from a to b, centred between them; local Y is "up" (rolled by `roll`). */
export function basisAlong(a: V3, b: V3, roll = 0, out = new THREE.Matrix4()): THREE.Matrix4 {
  _x.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  if (Math.abs(_x.y) > 0.995) _z.set(0, 0, 1); else _z.crossVectors(_x, _y.set(0, 1, 0)).normalize();
  _y.crossVectors(_z, _x).normalize();
  if (roll) { _y.applyAxisAngle(_x, roll); _z.applyAxisAngle(_x, roll); }
  out.makeBasis(_x, _y, _z);
  out.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return out;
}

// ------------------------------------------------------------------------------------------------
// Light baking
// ------------------------------------------------------------------------------------------------

export interface BakeLight {
  p: V3;
  /** Linear colour x intensity (radiance multiplier on albedo at distance ~0). */
  c: V3;
  /** Source size: intensity halves at about this distance. */
  r0: number;
  /** Hard cut-off distance. */
  radius: number;
  /** N.L wrap (0 = hard lambert, 1 = fully wrapped). */
  wrap: number;
  /** 0 = exterior verts only, 1 = interior only, 2 = both. */
  zone: 0 | 1 | 2;
  /** Cast baked shadows from the occluder list. */
  occl?: boolean;
  /** Optional emission direction + exponent (door spill, shaded lamps). */
  dir?: V3;
  cone?: number;
  /** Parallel light shining through a rectangular opening in the plane z = `z` (moonlight through the door). */
  beam?: { dir: V3; z: number; x0: number; x1: number; y0: number; y1: number; soft: number };
}

export type Occluder =
  | { t: 'cyl'; x: number; z: number; r: number; y0: number; y1: number }
  | { t: 'box'; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

export interface BakeSetup {
  lights: BakeLight[];
  occluders: Occluder[];
  ambientIn: V3;
  ambientOut: V3;
  /** Emblem positions of the pedestals (index = element order). */
  peds: V3[];
  pedRadius: number;
  /** Sky visibility stored for interior vertices. */
  skyIn: number;
  shadows: boolean;
}

function segBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number, occ: Occluder[]): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (let i = 0; i < occ.length; i++) {
    const o = occ[i];
    if (o.t === 'cyl') {
      const fx = ax - o.x, fz = az - o.z;
      const a = dx * dx + dz * dz;
      if (a < 1e-9) continue;
      const b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - o.r * o.r;
      const disc = b * b - 4 * a * c;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = Math.max(0, (-b - sq) / (2 * a)), t1 = Math.min(1, (-b + sq) / (2 * a));
      if (t0 >= t1) continue;
      const ya = ay + dy * t0, yb = ay + dy * t1;
      if (Math.max(ya, yb) < o.y0 || Math.min(ya, yb) > o.y1) continue;
      return true;
    } else {
      let t0 = 0, t1 = 1;
      // slabs
      if (Math.abs(dx) < 1e-9) { if (ax < o.x0 || ax > o.x1) continue; } else {
        let ta = (o.x0 - ax) / dx, tb = (o.x1 - ax) / dx; if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 >= t1) continue;
      }
      if (Math.abs(dy) < 1e-9) { if (ay < o.y0 || ay > o.y1) continue; } else {
        let ta = (o.y0 - ay) / dy, tb = (o.y1 - ay) / dy; if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 >= t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (az < o.z0 || az > o.z1) continue; } else {
        let ta = (o.z0 - az) / dz, tb = (o.z1 - az) / dz; if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 >= t1) continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Compute the baked-light attributes for a finished batch geometry:
 *   aBake (vec3)  static fake irradiance (multiplied by albedo and the fire flicker in the shader)
 *   aLm   (vec3)  x = sky visibility, y = nearest pedestal index, z = pedestal glow weight
 */
export function bakeGeometry(g: THREE.BufferGeometry, b: Batch, setup: BakeSetup): void {
  const n = b.vertexCount;
  const bake = new Float32Array(n * 3), lm = new Float32Array(n * 3);
  const pos = b.pos, nrm = b.nrm, zone = b.zone;
  const L = setup.lights;
  for (let i = 0; i < n; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const inside = zone[i * 2] < 0.5;
    const occMul = zone[i * 2 + 1];
    const amb = inside ? setup.ambientIn : setup.ambientOut;
    // ambient with a little sky/ground gradient so forms read in the dark
    const hemi = inside ? 0.7 + 0.3 * ny : 1;
    let r = amb[0] * hemi, gg = amb[1] * hemi, bl = amb[2] * hemi;
    for (let k = 0; k < L.length; k++) {
      const l = L[k];
      if (l.zone !== 2 && (l.zone === 1) !== inside) continue;
      if (l.beam) {
        const bm = l.beam, d = bm.dir;
        const nd = -(nx * d[0] + ny * d[1] + nz * d[2]);
        if (nd <= 0 || d[2] >= 0) continue;
        const tp = (bm.z - pz) / -d[2];
        if (tp <= 0) continue;
        const hx = px - d[0] * tp, hy = py - d[1] * tp;
        const sm = (e0: number, e1: number, v: number) => { const q = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return q * q * (3 - 2 * q); };
        const m = sm(bm.x0 - bm.soft, bm.x0 + bm.soft, hx) * (1 - sm(bm.x1 - bm.soft, bm.x1 + bm.soft, hx)) * sm(bm.y0 - bm.soft, bm.y0 + bm.soft, hy) * (1 - sm(bm.y1 - bm.soft, bm.y1 + bm.soft, hy));
        if (m <= 0) continue;
        const fade = Math.max(0, 1 - tp / l.radius);
        r += l.c[0] * m * nd * fade; gg += l.c[1] * m * nd * fade; bl += l.c[2] * m * nd * fade;
        continue;
      }
      const dx = l.p[0] - px, dy = l.p[1] - py, dz = l.p[2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > l.radius * l.radius) continue;
      const d = Math.sqrt(d2) || 1e-4;
      let ndl = (nx * dx + ny * dy + nz * dz) / d;
      ndl = (ndl + l.wrap) / (1 + l.wrap);
      if (ndl <= 0) continue;
      const q = d / l.radius, win = 1 - q * q * q * q;
      let att = (win * win) / (1 + (d * d) / (l.r0 * l.r0));
      if (l.dir) {
        const cd = -(dx * l.dir[0] + dy * l.dir[1] + dz * l.dir[2]) / d;
        if (cd <= 0) continue;
        att *= Math.pow(cd, l.cone ?? 1);
      }
      att *= ndl;
      if (att < 0.002) continue;
      if (l.occl && setup.shadows && segBlocked(px + nx * 0.04, py + ny * 0.04, pz + nz * 0.04, l.p[0], l.p[1], l.p[2], setup.occluders)) continue;
      r += l.c[0] * att; gg += l.c[1] * att; bl += l.c[2] * att;
    }
    bake[i * 3] = r * occMul + b.emit[i * 3]; bake[i * 3 + 1] = gg * occMul + b.emit[i * 3 + 1]; bake[i * 3 + 2] = bl * occMul + b.emit[i * 3 + 2];
    lm[i * 3] = inside ? setup.skyIn : 1;
    // nearest pedestal
    let best = -1, bw = 0;
    if (inside) {
      for (let k = 0; k < setup.peds.length; k++) {
        const pd = setup.peds[k];
        const dx = pd[0] - px, dy = pd[1] - py, dz = pd[2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > setup.pedRadius * setup.pedRadius) continue;
        const d = Math.sqrt(d2) || 1e-4;
        let ndl = (nx * dx + ny * dy + nz * dz) / d;
        ndl = (ndl + 0.45) / 1.45;
        if (ndl <= 0) continue;
        const q = d / setup.pedRadius, win = 1 - q * q;
        const w = (win * win * ndl) / (1 + (d * d) / 2.2);
        if (w > bw) { bw = w; best = k; }
      }
    }
    lm[i * 3 + 1] = best < 0 ? 0 : best;
    lm[i * 3 + 2] = best < 0 ? 0 : bw * occMul;
  }
  g.setAttribute('aBake', new THREE.BufferAttribute(bake, 3));
  g.setAttribute('aLm', new THREE.BufferAttribute(lm, 3));
}

/** Split a line light into point samples. */
export function lineLight(a: V3, b: V3, samples: number, base: Omit<BakeLight, 'p'>): BakeLight[] {
  const out: BakeLight[] = [];
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0.5 : i / (samples - 1);
    out.push({ ...base, p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], c: [base.c[0] / samples, base.c[1] / samples, base.c[2] / samples] });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Additive glow glyphs (runes on stone, inlays): its own tiny builder
// ------------------------------------------------------------------------------------------------

export class GlyphBatch {
  pos: number[] = []; uv: number[] = []; col: number[] = []; phase: number[] = []; idx: number[] = [];

  /** p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left. Colour is linear HDR. */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, rect: UVRect, color: V3, phase: number): void {
    const b = this.pos.length / 3;
    this.pos.push(...p0, ...p1, ...p2, ...p3);
    this.uv.push(rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]);
    for (let i = 0; i < 4; i++) { this.col.push(color[0], color[1], color[2]); this.phase.push(phase); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  /** A patch on a vertical cylinder facing angle `ang` (atan2(z, x)), `width` metres of arc. */
  onCylinder(x: number, y0: number, y1: number, z: number, radius: number, ang: number, width: number, rect: UVRect, color: V3, phase: number, segs = 3): void {
    const half = width / radius / 2;
    for (let s = 0; s < segs; s++) {
      const f0 = s / segs, f1 = (s + 1) / segs;
      const a0 = ang + half - f0 * half * 2, a1 = ang + half - f1 * half * 2;
      const u0 = rect[0] + (rect[2] - rect[0]) * f0, u1 = rect[0] + (rect[2] - rect[0]) * f1;
      this.quad([x + Math.cos(a0) * radius, y0, z + Math.sin(a0) * radius], [x + Math.cos(a1) * radius, y0, z + Math.sin(a1) * radius],
        [x + Math.cos(a1) * radius, y1, z + Math.sin(a1) * radius], [x + Math.cos(a0) * radius, y1, z + Math.sin(a0) * radius], [u0, rect[1], u1, rect[3]], color, phase);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Static flame billboards (instanced). */
export class FlameSet {
  private items: number[] = [];
  count = 0;
  /** Base position (bottom centre), width, height, heat (HDR multiplier), lean (random drift at the tip). */
  add(x: number, y: number, z: number, w: number, h: number, heat = 1, lean = 0): void {
    this.items.push(x, y, z, hashf(this.count, 77) + this.count * 0.37, w, h, heat, lean);
    this.count++;
  }
  build(): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const n = this.count;
    const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { a[i * 4 + k] = this.items[i * 8 + k]; b[i * 4 + k] = this.items[i * 8 + 4 + k]; }
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 22, -150), 80);
    return g;
  }
}
