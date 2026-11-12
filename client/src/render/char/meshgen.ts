// Procedural mesh builder for skinned characters: lofted tubes, shells, faceted plates, sheets
// and fur tufts, all written into one vertex stream with per-vertex colour, surface parameters
// (roughness, metalness, glow, detail kind) and skin weights.

import { BufferGeometry, Color, Float32BufferAttribute, Matrix3, Matrix4, Sphere, Uint16BufferAttribute, Vector3 } from 'three';
import { B, BONE_NAMES } from './rig';
import { DEG } from './mathx';

/** Surface detail kinds understood by the character shader. */
export const K_SKIN = 0, K_CLOTH = 1, K_LEATHER = 2, K_METAL = 3, K_FUR = 4, K_WOOD = 5, K_PLAIN = 6, K_STONE = 7;

export interface Ring {
  x?: number; y: number; z?: number;
  /** Half width (X). */
  rx: number;
  /** Half depth (Z); rf / rb override it toward the front (-Z) / back (+Z). */
  rz?: number; rf?: number; rb?: number;
  /** Superellipse exponent: 2 round, larger = boxier, 1 = diamond. */
  ex?: number;
  /** Shade multiplier (baked ambient occlusion / grime). */
  sh?: number;
  /** Colour override for this ring. */
  c?: Color;
  /** Skin override [boneA, boneB, weightB]. */
  w?: [number, number, number];
  /** Tilt of the ring plane in degrees about X and Z. */
  tx?: number; tz?: number;
  /** Glow override. */
  g?: number;
}

export interface LoftOpts {
  seg?: number;
  /** Partial sweep in degrees, 0 = front (-Z), 90 = right (+X), 180 = back. Default: closed. */
  arc?: [number, number];
  capA?: boolean; capB?: boolean;
  flat?: boolean;
  /** Also emit the inside faces (open shells). `inner` darkens them. */
  double?: boolean; inner?: number;
  flip?: boolean;
  /** Detail texture tiles per metre. */
  dens?: number;
}

const MIRROR = new Uint8Array(BONE_NAMES.length);
BONE_NAMES.forEach((n, i) => {
  let m: string = n;
  if (/^(clav|uarm|larm|hand|fing|uleg|lleg|foot|toe)[LR]$/.test(n)) m = n.slice(0, -1) + (n.endsWith('L') ? 'R' : 'L');
  else if (/^clk[LR]\d$/.test(n)) m = 'clk' + (n[3] === 'L' ? 'R' : 'L') + n[4];
  else if (/^braid[LR]\d$/.test(n)) m = 'braid' + (n[5] === 'L' ? 'R' : 'L') + n[6];
  MIRROR[i] = (B as Record<string, number>)[m];
});

const _p = new Vector3(), _n = new Vector3(), _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _col = new Color();

export class MeshBuilder {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; uv: number[] = []; mat: number[] = [];
  si: number[] = []; sw: number[] = []; idx: number[] = [];

  private mtx = new Matrix4();
  private nmtx = new Matrix3();
  private stack: Matrix4[] = [];
  private det = 1;
  private mirrored = false;

  // paint state (linear colour)
  cr = 1; cg = 1; cb = 1;
  rough = 0.8; metal = 0; glowAmt = 0; kind = K_PLAIN; shadeMul = 1;
  // skin state
  private bi = [0, 0, 0, 0];
  private bw = [1, 0, 0, 0];
  /** Optional per-vertex skin callback (model-space position). */
  skinFn: ((p: Vector3, b: MeshBuilder) => void) | null = null;
  /** Optional per-vertex shade callback. */
  shadeFn: ((p: Vector3) => number) | null = null;
  /** Default radial segments for lofts. */
  seg = 12;

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  // ------------------------------------------------------------------ transform stack
  push(): this { this.stack.push(this.mtx.clone()); return this; }
  pop(): this { const m = this.stack.pop(); if (m) this.mtx.copy(m); this.sync(); return this; }
  private sync(): void { this.nmtx.getNormalMatrix(this.mtx); this.det = this.mtx.determinant(); }
  translate(x: number, y: number, z: number): this { this.mtx.multiply(_m4.makeTranslation(x, y, z)); this.sync(); return this; }
  rotX(deg: number): this { this.mtx.multiply(_m4.makeRotationX(deg * DEG)); this.sync(); return this; }
  rotY(deg: number): this { this.mtx.multiply(_m4.makeRotationY(deg * DEG)); this.sync(); return this; }
  rotZ(deg: number): this { this.mtx.multiply(_m4.makeRotationZ(deg * DEG)); this.sync(); return this; }
  scale(x: number, y = x, z = x): this { this.mtx.multiply(_m4.makeScale(x, y, z)); this.sync(); return this; }
  /** Run `fn` for the right side (s = 1) and mirrored for the left (s = -1, bones swapped). */
  sym(fn: (s: number) => void): void {
    fn(1);
    this.push();
    this.mtx.premultiply(_m4.makeScale(-1, 1, 1)); this.sync();
    this.mirrored = !this.mirrored;
    fn(-1);
    this.mirrored = !this.mirrored;
    this.pop();
  }
  /** Run `fn` mirrored only (left side from right-side code). */
  left(fn: () => void): void {
    this.push();
    this.mtx.premultiply(_m4.makeScale(-1, 1, 1)); this.sync();
    this.mirrored = !this.mirrored;
    fn();
    this.mirrored = !this.mirrored;
    this.pop();
  }

  // ------------------------------------------------------------------ paint / skin state
  color(c: Color | number, shade = 1): this {
    if (typeof c === 'number') _col.setHex(c); else _col.copy(c);
    this.cr = _col.r * shade; this.cg = _col.g * shade; this.cb = _col.b * shade;
    return this;
  }
  surf(kind: number, rough: number, metal = 0, glow = 0): this { this.kind = kind; this.rough = rough; this.metal = metal; this.glowAmt = glow; return this; }
  glow(g: number): this { this.glowAmt = g; return this; }
  private mb(i: number): number { return this.mirrored ? MIRROR[i] : i; }
  rigid(bone: number): this { this.skinFn = null; this.bi = [this.mb(bone), 0, 0, 0]; this.bw = [1, 0, 0, 0]; return this; }
  blend(a: number, b: number, wb: number): this {
    this.skinFn = null;
    this.bi = [this.mb(a), this.mb(b), 0, 0]; this.bw = [1 - wb, wb, 0, 0];
    return this;
  }
  /** Set weights from inside a skinFn (no mirroring is applied to callbacks' indices; use mb-free logic on p). */
  setSkin(i0: number, w0: number, i1 = 0, w1 = 0, i2 = 0, w2 = 0, i3 = 0, w3 = 0): void {
    const s = w0 + w1 + w2 + w3 || 1;
    this.bi[0] = i0; this.bi[1] = i1; this.bi[2] = i2; this.bi[3] = i3;
    this.bw[0] = w0 / s; this.bw[1] = w1 / s; this.bw[2] = w2 / s; this.bw[3] = w3 / s;
  }
  skinBy(fn: ((p: Vector3, b: MeshBuilder) => void) | null): this { this.skinFn = fn; return this; }

  // ------------------------------------------------------------------ primitives
  /** Emit one vertex (local coordinates; the current transform is applied). */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, shade = 1, c?: Color, g?: number): number {
    _p.set(x, y, z).applyMatrix4(this.mtx);
    _n.set(nx, ny, nz).applyMatrix3(this.nmtx).normalize();
    if (this.skinFn) this.skinFn(_p, this);
    const s = shade * this.shadeMul * (this.shadeFn ? this.shadeFn(_p) : 1);
    this.pos.push(_p.x, _p.y, _p.z);
    this.nrm.push(_n.x, _n.y, _n.z);
    if (c) this.col.push(c.r * s, c.g * s, c.b * s); else this.col.push(this.cr * s, this.cg * s, this.cb * s);
    this.uv.push(u, v);
    this.mat.push(this.rough, this.metal, g ?? this.glowAmt, this.kind);
    this.si.push(this.bi[0], this.bi[1], this.bi[2], this.bi[3]);
    this.sw.push(this.bw[0], this.bw[1], this.bw[2], this.bw[3]);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    if (this.det < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }

  /** Flat-shaded convex polygon; the normal is oriented toward `hint`. */
  poly(pts: number[][], hint: number[], shade = 1): void {
    const n = pts.length;
    _a.set(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
    _b.set(pts[n - 1][0] - pts[0][0], pts[n - 1][1] - pts[0][1], pts[n - 1][2] - pts[0][2]);
    _c.crossVectors(_a, _b);
    if (n > 3 && _c.lengthSq() < 1e-12) { _b.set(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]); _c.crossVectors(_a, _b); }
    _c.normalize();
    let fl = false;
    if (_c.x * hint[0] + _c.y * hint[1] + _c.z * hint[2] < 0) { _c.negate(); fl = true; }
    const nx = _c.x, ny = _c.y, nz = _c.z;
    const base = this.vertexCount;
    for (let i = 0; i < n; i++) this.vert(pts[i][0], pts[i][1], pts[i][2], nx, ny, nz, pts[i][0] * 6 + pts[i][2] * 6, pts[i][1] * 6, shade);
    for (let i = 1; i < n - 1; i++) { if (fl) this.tri(base, base + i + 1, base + i); else this.tri(base, base + i, base + i + 1); }
  }

  /** Axis-aligned (in the current transform) box, flat shaded. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.poly([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1]);
    this.poly([[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], [0, 0, 1]);
    this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], 0.92);
    this.poly([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], 0.92);
    this.poly([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], 1.05);
    this.poly([[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], [0, -1, 0], 0.8);
  }

  /**
   * A faceted plate lying in the local XY plane: sharp outline at z = 0, raised to +-thick/2
   * toward an inset copy of the outline. Blades, axe heads, feathers, buckles.
   * `edgeGlow` paints the outline vertices with glow (a lit cutting edge).
   */
  plate(outline: number[][], thick: number, inset = 0.45, edgeGlow = 0, edgeColor?: Color): void {
    const n = outline.length;
    let cx = 0, cy = 0;
    for (const p of outline) { cx += p[0]; cy += p[1]; }
    cx /= n; cy /= n;
    const inner = outline.map((p) => [cx + (p[0] - cx) * (1 - inset), cy + (p[1] - cy) * (1 - inset)]);
    // with a lit edge, a narrow rim ring carries the glow so the flat of the blade stays metal
    const rimIn = edgeGlow ? Math.min(inset * 0.3, 0.12) : 0;
    const rimRing = outline.map((p) => [cx + (p[0] - cx) * (1 - rimIn), cy + (p[1] - cy) * (1 - rimIn)]);
    for (const s of [1, -1]) {
      const z = (s * thick) / 2;
      const zr = edgeGlow ? z * 0.45 : 0;
      const quad = (a: number[], b: number[], c: number[], d: number[], za: number, zc: number, glowA: boolean): void => {
        _a.set(b[0] - a[0], b[1] - a[1], 0); _b.set(d[0] - a[0], d[1] - a[1], zc - za); _c.crossVectors(_a, _b).normalize();
        let fl = false;
        if (_c.z * s < 0) { _c.negate(); fl = true; }
        const base = this.vertexCount;
        this.vert(a[0], a[1], za, _c.x, _c.y, _c.z, a[0] * 8, a[1] * 8, 1, glowA ? edgeColor : undefined, glowA ? edgeGlow : undefined);
        this.vert(b[0], b[1], za, _c.x, _c.y, _c.z, b[0] * 8, b[1] * 8, 1, glowA ? edgeColor : undefined, glowA ? edgeGlow : undefined);
        this.vert(c[0], c[1], zc, _c.x, _c.y, _c.z, c[0] * 8, c[1] * 8);
        this.vert(d[0], d[1], zc, _c.x, _c.y, _c.z, d[0] * 8, d[1] * 8);
        if (fl) { this.tri(base, base + 2, base + 1); this.tri(base, base + 3, base + 2); } else { this.tri(base, base + 1, base + 2); this.tri(base, base + 2, base + 3); }
      };
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (edgeGlow) {
          quad(outline[i], outline[j], rimRing[j], rimRing[i], 0, zr, true);
          quad(rimRing[i], rimRing[j], inner[j], inner[i], zr, z, false);
        } else quad(outline[i], outline[j], inner[j], inner[i], 0, z, false);
      }
      // cap: fan from the centroid (works for any outline that is star-shaped about it)
      const cb = this.vertexCount;
      this.vert(cx, cy, z, 0, 0, s, cx * 8, cy * 8);
      for (let i = 0; i < n; i++) this.vert(inner[i][0], inner[i][1], z, 0, 0, s, inner[i][0] * 8, inner[i][1] * 8);
      for (let i = 0; i < n; i++) {
        const a = cb + 1 + i, b = cb + 1 + ((i + 1) % n);
        const ax = inner[i][0] - cx, ay = inner[i][1] - cy, bx = inner[(i + 1) % n][0] - cx, by = inner[(i + 1) % n][1] - cy;
        if ((ax * by - ay * bx) * s > 0) this.tri(cb, a, b); else this.tri(cb, b, a);
      }
    }
  }

  /** A flat disc (n-gon) facing local -Z at depth z. */
  disc(cx: number, cy: number, z: number, r: number, n = 12, ry = r): void {
    const pts: number[][] = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry, z]); }
    this.poly(pts, [0, 0, -1]);
  }

  /** A three-sided spike (fur tuft, straw, thorn). Base at (x,y,z), pointing along d with length len. */
  tuft(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, r: number, tipShade = 1.25): void {
    _a.set(dx, dy, dz).normalize();
    // two perpendiculars
    if (Math.abs(_a.y) < 0.9) _b.set(0, 1, 0); else _b.set(1, 0, 0);
    _c.crossVectors(_a, _b).normalize();
    _b.crossVectors(_c, _a).normalize();
    const tx = x + _a.x * len, ty = y + _a.y * len, tz = z + _a.z * len;
    const base = this.vertexCount;
    for (let i = 0; i < 3; i++) {
      const an = (i / 3) * Math.PI * 2 + 0.4;
      const ox = _b.x * Math.cos(an) + _c.x * Math.sin(an), oy = _b.y * Math.cos(an) + _c.y * Math.sin(an), oz = _b.z * Math.cos(an) + _c.z * Math.sin(an);
      this.vert(x + ox * r, y + oy * r, z + oz * r, ox * 0.8 + _a.x * 0.6, oy * 0.8 + _a.y * 0.6, oz * 0.8 + _a.z * 0.6, i / 3, 0, 0.72);
    }
    const tip = this.vert(tx, ty, tz, _a.x, _a.y, _a.z, 0.5, len * 6, tipShade);
    // winding: either orientation is acceptable visually; emit both-facing safe order
    this.tri(base, base + 1, tip); this.tri(base + 1, base + 2, tip); this.tri(base + 2, base, tip);
  }

  /** Loft a surface through cross-section rings stacked (mostly) along local Y. */
  loft(rings: Ring[], o: LoftOpts = {}): void {
    const seg = Math.max(3, o.seg ?? this.seg);
    const a0 = (o.arc ? o.arc[0] : -180) * DEG, a1 = (o.arc ? o.arc[1] : 180) * DEG;
    const closed = !o.arc;
    const n = rings.length, cols = seg + 1;
    const P = new Float32Array(n * cols * 3);
    let axisSum = 0;
    for (let j = 0; j < n; j++) {
      const r = rings[j];
      const cx = r.x ?? 0, cy = r.y, cz = r.z ?? 0;
      if (j > 0) axisSum += cy - rings[j - 1].y;
      const ex = r.ex ?? 2;
      const ctx = Math.cos((r.tx ?? 0) * DEG), stx = Math.sin((r.tx ?? 0) * DEG);
      const ctz = Math.cos((r.tz ?? 0) * DEG), stz = Math.sin((r.tz ?? 0) * DEG);
      for (let i = 0; i < cols; i++) {
        const th = a0 + ((a1 - a0) * i) / seg;
        const s = Math.sin(th), c = Math.cos(th);
        const ss = Math.sign(s) * Math.pow(Math.abs(s), 2 / ex), cc = Math.sign(c) * Math.pow(Math.abs(c), 2 / ex);
        const rz = c > 0 ? (r.rf ?? r.rz ?? r.rx) : (r.rb ?? r.rz ?? r.rx);
        let lx = ss * r.rx, ly = 0, lz = -cc * rz;
        if (r.tx) { const y2 = ly * ctx - lz * stx, z2 = ly * stx + lz * ctx; ly = y2; lz = z2; }
        if (r.tz) { const x2 = lx * ctz - ly * stz, y2 = lx * stz + ly * ctz; lx = x2; ly = y2; }
        const k = (j * cols + i) * 3;
        P[k] = cx + lx; P[k + 1] = cy + ly; P[k + 2] = cz + lz;
      }
    }
    let dir = axisSum >= 0 ? 1 : -1;
    if (o.flip) dir = -dir;
    // normals
    const N = new Float32Array(n * cols * 3);
    for (let j = 0; j < n; j++) {
      const jm = Math.max(0, j - 1), jp = Math.min(n - 1, j + 1);
      for (let i = 0; i < cols; i++) {
        let im = i - 1, ip = i + 1;
        if (closed) { if (im < 0) im = seg - 1; if (ip > seg) ip = 1; } else { im = Math.max(0, im); ip = Math.min(seg, ip); }
        const ka = (jp * cols + i) * 3, kb = (jm * cols + i) * 3, kc = (j * cols + ip) * 3, kd = (j * cols + im) * 3;
        _a.set(P[ka] - P[kb], P[ka + 1] - P[kb + 1], P[ka + 2] - P[kb + 2]);
        _b.set(P[kc] - P[kd], P[kc + 1] - P[kd + 1], P[kc + 2] - P[kd + 2]);
        _c.crossVectors(_a, _b);
        if (_c.lengthSq() < 1e-14) {
          // degenerate ring (pole): point along the axis, away from the body of the loft
          const kk = (j === 0 ? 1 : n - 2);
          _c.set(rings[j].x ?? 0, rings[j].y, rings[j].z ?? 0).sub(_a.set(rings[kk].x ?? 0, rings[kk].y, rings[kk].z ?? 0));
          if (_c.lengthSq() < 1e-14) _c.set(0, j === 0 ? -1 : 1, 0);
          _c.normalize();
        } else _c.normalize().multiplyScalar(dir);
        const k = (j * cols + i) * 3;
        N[k] = _c.x; N[k + 1] = _c.y; N[k + 2] = _c.z;
      }
    }
    // uv
    const dens = o.dens ?? 5;
    let avgR = 0;
    for (const r of rings) avgR += (r.rx + (r.rz ?? r.rx)) / 2;
    avgR /= n;
    const uT = Math.max(1, Math.round(((a1 - a0) * avgR) * dens));
    const V = new Float32Array(n);
    for (let j = 1; j < n; j++) {
      const a = rings[j], b = rings[j - 1];
      V[j] = V[j - 1] + Math.hypot((a.x ?? 0) - (b.x ?? 0), a.y - b.y, (a.z ?? 0) - (b.z ?? 0), a.rx - b.rx) * dens;
    }
    const emit = (inside: boolean): void => {
      const sgn = inside ? -1 : 1;
      const shadeIn = inside ? (o.inner ?? 0.55) : 1;
      const saveBi = this.bi.slice(), saveBw = this.bw.slice();
      const quad = (a: number, b: number, c: number, d: number): void => {
        if ((dir > 0) !== inside) { this.tri(a, c, b); this.tri(b, c, d); } else { this.tri(a, b, c); this.tri(b, d, c); }
      };
      if (o.flat) {
        for (let j = 0; j < n - 1; j++) {
          for (let i = 0; i < seg; i++) {
            const ids = [[j, i], [j, i + 1], [j + 1, i], [j + 1, i + 1]];
            const k0 = (j * cols + i) * 3, k1 = (j * cols + i + 1) * 3, k2 = ((j + 1) * cols + i) * 3, k3 = ((j + 1) * cols + i + 1) * 3;
            _a.set(P[k2] - P[k0], P[k2 + 1] - P[k0 + 1], P[k2 + 2] - P[k0 + 2]);
            _b.set(P[k1] - P[k0], P[k1 + 1] - P[k0 + 1], P[k1 + 2] - P[k0 + 2]);
            _c.crossVectors(_a, _b);
            if (_c.lengthSq() < 1e-14) { _a.set(P[k3] - P[k1], P[k3 + 1] - P[k1 + 1], P[k3 + 2] - P[k1 + 2]); _b.set(P[k3] - P[k2], P[k3 + 1] - P[k2 + 1], P[k3 + 2] - P[k2 + 2]); _c.crossVectors(_b, _a); }
            _c.normalize().multiplyScalar(dir * sgn);
            const base = this.vertexCount;
            for (const [jj, ii] of ids) {
              const r = rings[jj];
              if (r.w) this.blendRaw(r.w);
              const k = (jj * cols + ii) * 3;
              this.vert(P[k], P[k + 1], P[k + 2], _c.x, _c.y, _c.z, (ii / seg) * uT, V[jj], (r.sh ?? 1) * shadeIn, r.c, r.g);
            }
            quad(base, base + 1, base + 2, base + 3);
          }
        }
      } else {
        const base = this.vertexCount;
        for (let j = 0; j < n; j++) {
          const r = rings[j];
          if (r.w) this.blendRaw(r.w);
          for (let i = 0; i < cols; i++) {
            const k = (j * cols + i) * 3;
            this.vert(P[k], P[k + 1], P[k + 2], N[k] * sgn, N[k + 1] * sgn, N[k + 2] * sgn, (i / seg) * uT, V[j], (r.sh ?? 1) * shadeIn, r.c, r.g);
          }
        }
        for (let j = 0; j < n - 1; j++) {
          if (rings[j].rx < 1e-6 && rings[j + 1].rx < 1e-6) continue;
          for (let i = 0; i < seg; i++) {
            const a = base + j * cols + i;
            quad(a, a + 1, a + cols, a + cols + 1);
          }
        }
      }
      this.bi = saveBi; this.bw = saveBw;
    };
    emit(false);
    if (o.double) emit(true);
    // caps
    const cap = (j: number, towardNext: number): void => {
      const r = rings[j];
      if (r.rx < 1e-6) return;
      const other = rings[j + towardNext];
      _c.set((r.x ?? 0) - (other.x ?? 0), r.y - other.y, (r.z ?? 0) - (other.z ?? 0)).normalize();
      const nx = _c.x, ny = _c.y, nz = _c.z;
      const saveBi = this.bi.slice(), saveBw = this.bw.slice();
      if (r.w) this.blendRaw(r.w);
      const base = this.vertexCount;
      this.vert(r.x ?? 0, r.y, r.z ?? 0, nx, ny, nz, 0.5, 0.5, (r.sh ?? 1) * 0.9, r.c);
      for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 3;
        this.vert(P[k], P[k + 1], P[k + 2], nx, ny, nz, 0.5 + (P[k] - (r.x ?? 0)) * 4, 0.5 + (P[k + 2] - (r.z ?? 0)) * 4, (r.sh ?? 1) * 0.9, r.c);
      }
      // the cap faces away from the loft body
      const up = (towardNext < 0) === (dir > 0);
      for (let i = 0; i < seg; i++) {
        if (up) this.tri(base, base + 2 + i, base + 1 + i); else this.tri(base, base + 1 + i, base + 2 + i);
      }
      this.bi = saveBi; this.bw = saveBw;
    };
    if (o.capA) cap(0, 1);
    if (o.capB) cap(n - 1, -1);
  }

  private blendRaw(w: [number, number, number]): void {
    this.bi[0] = this.mb(w[0]); this.bi[1] = this.mb(w[1]); this.bi[2] = 0; this.bi[3] = 0;
    this.bw[0] = 1 - w[2]; this.bw[1] = w[2]; this.bw[2] = 0; this.bw[3] = 0;
  }

  /** Ellipsoid (optionally a latitude slice, lat in -90..90). */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, o: LoftOpts & { rings?: number; lat?: [number, number]; rf?: number; rb?: number; ex?: number } = {}): void {
    const nr = o.rings ?? Math.max(4, Math.round((o.seg ?? this.seg) * 0.6));
    const l0 = (o.lat ? o.lat[0] : -90) * DEG, l1 = (o.lat ? o.lat[1] : 90) * DEG;
    const rings: Ring[] = [];
    for (let j = 0; j <= nr; j++) {
      const la = l0 + ((l1 - l0) * j) / nr;
      const c = Math.max(0, Math.cos(la)), s = Math.sin(la);
      rings.push({ x: cx, y: cy + s * ry, z: cz, rx: rx * c, rz: rz * c, rf: o.rf !== undefined ? o.rf * c : undefined, rb: o.rb !== undefined ? o.rb * c : undefined, ex: o.ex });
    }
    this.loft(rings, o);
  }

  /**
   * A parametric sheet (cloaks, flaps). fn writes the local position for (u, v) in 0..1.
   * `skin(u, v)` may set weights per vertex. Double-sided sheets get a back face coloured `back`.
   */
  sheet(nu: number, nv: number, fn: (u: number, v: number, out: Vector3) => void, o: {
    skin?: (u: number, v: number, b: MeshBuilder) => void; double?: boolean; back?: Color; flip?: boolean; dens?: number;
    shade?: (u: number, v: number) => number; colorAt?: (u: number, v: number) => Color | undefined; glowAt?: (u: number, v: number) => number;
  } = {}): void {
    const cols = nu + 1, rows = nv + 1;
    const P: Vector3[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const p = new Vector3(); fn(i / nu, j / nv, p); P.push(p); }
    const N: Vector3[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = P[j * cols + Math.min(nu, i + 1)], b = P[j * cols + Math.max(0, i - 1)];
      const c = P[Math.min(nv, j + 1) * cols + i], d = P[Math.max(0, j - 1) * cols + i];
      _a.subVectors(a, b); _b.subVectors(c, d);
      const nn = new Vector3().crossVectors(_a, _b).normalize();
      if (o.flip) nn.negate();
      N.push(nn);
    }
    const dens = o.dens ?? 5;
    const saveFn = this.skinFn;
    this.skinFn = null;
    const emit = (back: boolean): void => {
      const base = this.vertexCount;
      const s = back ? -1 : 1;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const k = j * cols + i, u = i / nu, v = j / nv;
        if (o.skin) o.skin(u, v, this);
        const c = back ? (o.back ?? undefined) : o.colorAt?.(u, v);
        this.vert(P[k].x, P[k].y, P[k].z, N[k].x * s, N[k].y * s, N[k].z * s, u * nu * 0.12 * dens, v * nv * 0.1 * dens, (o.shade ? o.shade(u, v) : 1) * (back ? 0.85 : 1), c, back ? 0 : o.glowAt?.(u, v));
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = base + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        if (back === !!o.flip) { this.tri(a, b, c); this.tri(b, d, c); } else { this.tri(a, c, b); this.tri(b, c, d); }
      }
    };
    emit(false);
    if (o.double) emit(true);
    this.skinFn = saveFn;
  }

  /** Thin emissive stroke between two local points, facing `nrm` (rune glyphs, trim lines). */
  stroke(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, nx: number, ny: number, nz: number): void {
    _a.set(bx - ax, by - ay, bz - az);
    _b.set(nx, ny, nz);
    _c.crossVectors(_a, _b).normalize().multiplyScalar(width / 2);
    const ex = _a.x, ey = _a.y, ez = _a.z, el = Math.hypot(ex, ey, ez) || 1;
    const px = (ex / el) * width * 0.35, py = (ey / el) * width * 0.35, pz = (ez / el) * width * 0.35;
    const base = this.vertexCount;
    this.vert(ax - _c.x - px, ay - _c.y - py, az - _c.z - pz, nx, ny, nz, 0, 0);
    this.vert(ax + _c.x - px, ay + _c.y - py, az + _c.z - pz, nx, ny, nz, 1, 0);
    this.vert(bx - _c.x + px, by - _c.y + py, bz - _c.z + pz, nx, ny, nz, 0, 1);
    this.vert(bx + _c.x + px, by + _c.y + py, bz + _c.z + pz, nx, ny, nz, 1, 1);
    // emit both windings so the stroke shows regardless of the surface's handedness
    this.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    this.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aMat', new Float32BufferAttribute(this.mat, 4));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    // Animated bounds: generous fixed sphere (reach of the longest weapon, tumbling, lying down).
    g.boundingSphere = new Sphere(new Vector3(0, 1, 0), 3.4);
    return g;
  }
}

const _m4 = new Matrix4();

/** Point on a ring at angle `thDeg` (0 = front, 90 = right, 180 = back); ignores tilt. */
export function ringPt(r: Ring, thDeg: number, out: number[]): number[] {
  const th = thDeg * DEG, s = Math.sin(th), c = Math.cos(th), ex = r.ex ?? 2;
  const ss = Math.sign(s) * Math.pow(Math.abs(s), 2 / ex), cc = Math.sign(c) * Math.pow(Math.abs(c), 2 / ex);
  const rz = c > 0 ? (r.rf ?? r.rz ?? r.rx) : (r.rb ?? r.rz ?? r.rx);
  out[0] = (r.x ?? 0) + ss * r.rx; out[1] = r.y; out[2] = (r.z ?? 0) - cc * rz;
  return out;
}

/** Interpolate a stack of rings (sorted by ascending y) at height y. */
export function ringAt(rings: Ring[], y: number, grow = 0): Ring {
  let j = 0;
  while (j < rings.length - 2 && rings[j + 1].y < y) j++;
  const a = rings[j], b = rings[j + 1];
  const t = Math.min(1, Math.max(0, (y - a.y) / (b.y - a.y || 1)));
  const L = (p: number, q: number): number => p + (q - p) * t;
  return {
    x: L(a.x ?? 0, b.x ?? 0), y, z: L(a.z ?? 0, b.z ?? 0),
    rx: L(a.rx, b.rx) + grow,
    rf: L(a.rf ?? a.rz ?? a.rx, b.rf ?? b.rz ?? b.rx) + grow,
    rb: L(a.rb ?? a.rz ?? a.rx, b.rb ?? b.rz ?? b.rx) + grow,
    ex: L(a.ex ?? 2, b.ex ?? 2),
  };
}
