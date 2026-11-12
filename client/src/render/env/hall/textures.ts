// Procedural textures for the Hearth-Hall. Everything is generated at start-up on 2D canvases:
// tiling PBR-ish surfaces (albedo + normal from a height field), a painted cloth atlas, a carved
// & painted atlas with a matching normal map, a glow-glyph sheet, a particle sheet and a noise LUT.
import * as THREE from 'three';
import { hash2 } from '@shared/math';
import { ELEMENT_ORDER, ELEMENTS, type ElementId } from '@shared/elements';
import type { QualityLevel } from '../../../settings';
import type { UVRect } from './geo';
import * as K from './runes';

type Ctx = CanvasRenderingContext2D;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

/** Tileable value noise: lattice wraps with integer periods (px, py). */
export function tnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function tfbm(x: number, y: number, px: number, py: number, oct: number, seed: number): number {
  let amp = 0.5, sum = 0, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * tnoise(x * f, y * f, px * f, py * f, seed + i * 17); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Height field (canvas rows, y down) -> tangent-space normal map (OpenGL convention, v up). */
function normalsFromHeight(hgt: Float32Array, w: number, h: number, strength: number, wrap: boolean): HTMLCanvasElement {
  const cv = canvas(w, h);
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = wrap ? (y + h - 1) % h : Math.max(0, y - 1), yp = wrap ? (y + 1) % h : Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = wrap ? (x + w - 1) % w : Math.max(0, x - 1), xp = wrap ? (x + 1) % w : Math.min(w - 1, x + 1);
      const dx = (hgt[y * w + xp] - hgt[y * w + xm]) * strength;
      const dy = (hgt[yp * w + x] - hgt[ym * w + x]) * strength;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      d[i] = (-dx * il * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * il * 0.5 + 0.5) * 255;
      d[i + 2] = (il * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export interface TileTex { map: THREE.Texture; normalMap: THREE.Texture }

function asTexture(cv: HTMLCanvasElement, srgb: boolean, repeat: boolean, aniso: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

interface Px { h: number; r: number; g: number; b: number }
function makeTile(size: number, strength: number, aniso: number, fn: (u: number, v: number, o: Px) => void): TileTex {
  const cv = canvas(size, size);
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const hgt = new Float32Array(size * size);
  const o: Px = { h: 0, r: 0, g: 0, b: 0 };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, y / size, o);
    const i = y * size + x;
    hgt[i] = o.h;
    d[i * 4] = clamp01(o.r) * 255; d[i * 4 + 1] = clamp01(o.g) * 255; d[i * 4 + 2] = clamp01(o.b) * 255; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: asTexture(cv, true, true, aniso), normalMap: asTexture(normalsFromHeight(hgt, size, size, strength * (size / 512), true), false, true, aniso) };
}

const wrapD = (d: number) => d - Math.round(d);

// ------------------------------------------------------------------------------------------------
// Tiling surfaces
// ------------------------------------------------------------------------------------------------

const knotCache = new Map<number, number[]>();
function grain(u: number, v: number, seed: number, o: Px): void {
  const warp = tfbm(u * 2, v * 2, 2, 2, 2, 11 + seed) - 0.5;
  const vv = v + warp * 0.025;
  let kf = 0;
  let kn = knotCache.get(seed);
  if (!kn) { kn = []; for (let k = 0; k < 3; k++) kn.push(hash2(k, 1, 90 + seed), hash2(k, 2, 90 + seed), 0.018 + 0.02 * hash2(k, 3, 90 + seed)); knotCache.set(seed, kn); }
  for (let k = 0; k < 9; k += 3) {
    const du = wrapD(u - kn[k]), dv = wrapD(vv - kn[k + 1]);
    const e = (du * du * 0.3 + dv * dv * 7) / (kn[k + 2] * kn[k + 2]);
    if (e < 8) kf += Math.exp(-e);
  }
  const phase = vv * 38 + (tfbm(u * 2, vv * 6, 2, 6, 3, 21 + seed) - 0.5) * 2.2 + kf * 3.0;
  const rings = Math.pow(0.5 + 0.5 * Math.sin(TAU * phase), 1.2);
  const broad = tfbm(u * 2, vv * 9, 2, 9, 2, 27 + seed);
  const fibre = tnoise(u * 8, v * 180, 8, 180, 5 + seed);
  const fine = tnoise(u * 28, v * 256, 28, 256, 7 + seed);
  const crack = sstep(0.83, 0.92, tnoise(u * 4, v * 52, 4, 52, 9 + seed)) * sstep(0.35, 0.6, tnoise(u * 3, v * 6, 3, 6, 13 + seed));
  const h = clamp01(0.2 * rings + 0.3 * fibre + 0.16 * fine + 0.26 * broad + 0.08 * (warp + 0.5) - crack * 0.85);
  let tone = 0.56 + 0.5 * h;
  tone *= (1 - crack * 0.6) * (1 - Math.min(1, kf) * 0.4);
  const hue = tnoise(u * 2, v * 3, 2, 3, 23 + seed);
  o.h = h; o.r = tone * (0.99 + 0.03 * hue); o.g = tone * (0.93 + 0.04 * hue); o.b = tone * (0.86 - 0.03 * hue);
}

function woodTile(size: number, aniso: number): TileTex {
  return makeTile(size, 2.6, aniso, (u, v, o) => grain(u, v, 0, o));
}

function plankTile(size: number, aniso: number): TileTex {
  const N = 4;
  return makeTile(size, 3.2, aniso, (u, v, o) => {
    const pv = v * N, pi = Math.floor(pv), pl = pv - pi;
    const off = hash2(pi, 3, 71);
    grain(u + off, pl / N + pi * 0.31, pi * 5 + 3, o);
    const edgePx = Math.min(pl, 1 - pl) * (size / N);
    const seam = 1 - sstep(0.4, 3.4, edgePx);
    const uj = hash2(pi, 5, 72);
    const duPx = Math.abs(wrapD(u - uj)) * size;
    const joint = 1 - sstep(0.5, 2.6, duPx);
    let nail = 0;
    for (const s of [-1, 1]) for (const nv of [0.22, 0.78]) {
      const ddx = wrapD(u - uj) * size - s * 10, ddy = (pl - nv) * (size / N);
      nail = Math.max(nail, 1 - sstep(2.0, 3.6, Math.sqrt(ddx * ddx + ddy * ddy)));
    }
    const gap = Math.max(seam, joint);
    const bevel = sstep(0, 7, Math.min(edgePx, duPx));
    const tint = 0.84 + 0.3 * hash2(pi, 9, 73);
    o.h = o.h * 0.45 + 0.55 * bevel - nail * 0.25;
    const k = tint * (1 - gap * 0.8) * (1 - nail * 0.6);
    o.r *= k; o.g *= k; o.b *= k;
  });
}

function rockTile(size: number, aniso: number): TileTex {
  return makeTile(size, 3.4, aniso, (u, v, o) => {
    const a = tfbm(u * 4, v * 4, 4, 4, 4, 31), b = tfbm(u * 9, v * 9, 9, 9, 2, 37);
    const rg = 1 - Math.abs(2 * tfbm(u * 6, v * 6, 6, 6, 3, 41) - 1);
    const gr = tnoise(u * 96, v * 96, 96, 96, 43);
    const crack = (1 - sstep(0.002, 0.012, Math.abs(tfbm(u * 2, v * 2, 2, 2, 4, 47) - 0.5))) * sstep(0.45, 0.7, tnoise(u * 3, v * 3, 3, 3, 48));
    const chisel = tnoise(u * 14 + v * 9, v * 70, 14, 70, 49);
    const h = clamp01(0.46 * a + 0.2 * b + 0.16 * rg * rg + 0.08 * gr + 0.1 * chisel - crack * 0.45);
    let tone = 0.52 + 0.46 * h;
    tone *= 1 - crack * 0.3;
    const lichen = sstep(0.6, 0.74, tfbm(u * 5 + 3, v * 5, 5, 5, 2, 53)) * 0.45;
    o.h = h;
    o.r = mix(tone * 0.97, tone * 0.72, lichen); o.g = mix(tone * 0.96, tone * 0.78, lichen); o.b = mix(tone * 1.04, tone * 0.6, lichen);
  });
}

function pavingTile(size: number, aniso: number): TileTex {
  // three courses of unequal height, each cut into flags of unequal length; edges wander a little
  const rowY = [0, 0.3, 0.68, 1];
  const bounds: number[][] = [];
  for (let r = 0; r < 3; r++) {
    const nb = r === 1 ? 2 : 3;
    const arr: number[] = [];
    for (let k = 0; k < nb; k++) arr.push((k + 0.5 * (hash2(r, k, 61) - 0.5)) / nb + r * 0.21);
    bounds.push(arr.map((x) => ((x % 1) + 1) % 1).sort((p, q) => p - q));
  }
  return makeTile(size, 4.0, aniso, (u, v, o) => {
    const wu = (((u + (tfbm(u * 5, v * 5, 5, 5, 2, 611) - 0.5) * 0.016) % 1) + 1) % 1;
    const wv = (((v + (tfbm(u * 5 + 2, v * 5, 5, 5, 2, 613) - 0.5) * 0.016) % 1) + 1) % 1;
    let r = 0;
    while (r < 2 && wv >= rowY[r + 1]) r++;
    const arr = bounds[r];
    let du = 1, blk = arr.length - 1;
    for (let k = 0; k < arr.length; k++) {
      const d = Math.abs(wrapD(wu - arr[k]));
      if (d < du) du = d;
      if (wu >= arr[k]) blk = k;
    }
    const edgePx = Math.min(du, wv - rowY[r], rowY[r + 1] - wv) * size;
    const mortar = sstep(1.6, 5.5, edgePx), pillow = sstep(2, 30, edgePx);
    const id = r * 8 + blk;
    const surf = tfbm(u * 9, v * 9, 9, 9, 4, 63), pits = tnoise(u * 80, v * 80, 80, 80, 65);
    const chip = sstep(0.62, 0.8, tfbm(u * 14, v * 14, 14, 14, 2, 67)) * (1 - pillow);
    const cellTone = 0.72 + 0.22 * hash2(id, 1, 66), cellH = hash2(id, 2, 66) * 0.16;
    o.h = mortar * (0.5 + cellH + 0.2 * pillow) * (1 - chip * 0.5) + 0.16 * surf * mortar + 0.05 * pits;
    const tone = mix(0.42, cellTone * (0.8 + 0.3 * surf) + (1 - pillow) * 0.04, mortar * (1 - chip * 0.4)) * (0.96 + 0.08 * pits);
    const hue = hash2(id, 3, 66);
    o.r = tone * (0.96 + 0.06 * hue); o.g = tone * 0.96; o.b = tone * (1.05 - 0.07 * hue);
  });
}

function masonryTile(size: number, aniso: number): TileTex {
  const rows = 4;
  const bounds: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const nb = 3 + (r % 2);
    const arr: number[] = [];
    for (let k = 0; k < nb; k++) arr.push((k + 0.3 * (hash2(r, k, 81) - 0.5)) / nb);
    bounds.push(arr);
  }
  return makeTile(size, 4.4, aniso, (u, v, o) => {
    const rv = v * rows, r = Math.floor(rv), rl = rv - r;
    const arr = bounds[r];
    const x = (((u + r * 0.37) % 1) + 1) % 1;
    let du = 1, blk = 0;
    for (let k = 0; k < arr.length; k++) {
      const d = Math.abs(wrapD(x - arr[k]));
      if (d < du) du = d;
      if (x >= arr[k]) blk = k + 1;
    }
    const edgePx = Math.min(du * size, Math.min(rl, 1 - rl) * (size / rows));
    const mortar = sstep(1.2, 4.6, edgePx), pillow = sstep(2, 24, edgePx);
    const id = r * 8 + (blk % arr.length);
    const a = tfbm(u * 6, v * 6, 6, 6, 4, 83), gr = tnoise(u * 90, v * 90, 90, 90, 85);
    const chisel = tnoise(u * 60, v * 12 + u * 9, 60, 12, 87);
    const tone0 = 0.64 + 0.3 * hash2(id, 1, 86);
    o.h = mortar * (0.5 + 0.22 * pillow + hash2(id, 2, 86) * 0.16) + 0.16 * a * mortar + 0.05 * gr + 0.07 * chisel * mortar;
    const tone = mix(0.28, tone0 * (0.76 + 0.36 * a) * (0.94 + 0.12 * chisel), mortar);
    const hue = hash2(id, 3, 86);
    o.r = tone * (0.96 + 0.06 * hue); o.g = tone * 0.96; o.b = tone * (1.06 - 0.08 * hue);
  });
}

function shingleTile(size: number, aniso: number): TileTex {
  const rows = 4;
  const per = [6, 7, 6, 7];
  return makeTile(size, 5.0, aniso, (u, v, o) => {
    let rv = v * rows, r = Math.floor(rv), vl = rv - r;
    const find = (row: number): number => {
      const n = per[((row % rows) + rows) % rows];
      const x = (((u + row * 0.43) % 1) + 1) % 1 * n;
      return Math.floor(x + 0.22 * (tnoise(Math.floor(x) + 0.5, row * 3.1, n, 97, 91) - 0.5));
    };
    let s = find(r);
    const butt = 0.16 * hash2(s, ((r % rows) + rows) % rows, 92);
    if (vl > 1 - butt) { r += 1; vl -= 1; s = find(r); }
    const rw = ((r % rows) + rows) % rows;
    const n = per[rw];
    const x = (((u + r * 0.43) % 1) + 1) % 1 * n;
    const fx = x - Math.floor(x);
    const gapPx = Math.min(fx, 1 - fx) * (size / n);
    const gap = 1 - sstep(0.6, 2.6, gapPx);
    const id = s * 13 + rw * 7;
    const streak = tnoise(u * 110, v * 5, 110, 5, 93), lf = tfbm(u * 4, v * 4, 4, 4, 3, 95);
    const ramp = clamp01(vl + 0.16);
    o.h = clamp01(ramp * 0.75 + 0.15 * streak + hash2(id, 4, 92) * 0.1) * (1 - gap * 0.7);
    let tone = (0.52 + 0.4 * hash2(id, 1, 92)) * (0.62 + 0.38 * sstep(0, 0.38, ramp)) * (0.82 + 0.3 * streak) * (0.9 + 0.2 * lf);
    tone *= 1 - gap * 0.7;
    const hue = hash2(id, 2, 92);
    o.r = tone * (0.98 + 0.06 * hue); o.g = tone * (0.92 + 0.03 * hue); o.b = tone * (0.86 - 0.04 * hue);
  });
}

// ------------------------------------------------------------------------------------------------
// Atlas packing
// ------------------------------------------------------------------------------------------------

class Atlas {
  readonly cv: HTMLCanvasElement;
  readonly c: Ctx;
  readonly hcv: HTMLCanvasElement | null;
  readonly hc: Ctx | null;
  private x = 0; private y = 0; private rowH = 0;
  private readonly pad = 6;

  constructor(readonly size: number, readonly scale: number, withHeight: boolean, clear: string | null) {
    this.cv = canvas(size, size);
    this.c = this.cv.getContext('2d')!;
    if (clear) { this.c.fillStyle = clear; this.c.fillRect(0, 0, size, size); }
    this.hcv = withHeight ? canvas(size, size) : null;
    this.hc = this.hcv ? this.hcv.getContext('2d')! : null;
    if (this.hc) { this.hc.fillStyle = '#808080'; this.hc.fillRect(0, 0, size, size); }
  }

  /** Reserve a w x h cell (logical pixels at scale 1) and draw into it. `bleed` lets the drawing spill into the padding (tileable strips). */
  add(w: number, h: number, draw: (c: Ctx, height: boolean) => void, bleed = false): UVRect {
    const s = this.scale, pw = Math.ceil(w * s), ph = Math.ceil(h * s), pad = this.pad;
    if (this.x + pw + pad * 2 > this.size) { this.x = 0; this.y += this.rowH; this.rowH = 0; }
    if (this.y + ph + pad * 2 > this.size) throw new Error('hall atlas overflow');
    const ox = this.x + pad, oy = this.y + pad;
    this.x += pw + pad * 2; this.rowH = Math.max(this.rowH, ph + pad * 2);
    const run = (c: Ctx, height: boolean) => {
      c.save();
      c.beginPath();
      const b = bleed ? pad : 0;
      c.rect(ox - b, oy - b, pw + b * 2, ph + b * 2);
      c.clip();
      c.translate(ox, oy);
      c.scale(s, s);
      draw(c, height);
      c.restore();
    };
    run(this.c, false);
    if (this.hc) run(this.hc, true);
    const S = this.size, e = 0.75;
    return [(ox + e) / S, 1 - (oy + ph - e) / S, (ox + pw - e) / S, 1 - (oy + e) / S];
  }

  textures(aniso: number, normalStrength: number): { map: THREE.Texture; normalMap: THREE.Texture | null } {
    const map = asTexture(this.cv, true, false, aniso);
    let normalMap: THREE.Texture | null = null;
    if (this.hc && this.hcv) {
      // half-resolution normals: the browser's down-scale doubles as the bevel blur
      const S = this.size >> 1;
      const small = canvas(S, S);
      const sc = small.getContext('2d')!;
      sc.imageSmoothingEnabled = true;
      sc.drawImage(this.hcv, 0, 0, S, S);
      const src = sc.getImageData(0, 0, S, S).data;
      const h = new Float32Array(S * S), tmp = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) h[i] = src[i * 4] / 255;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x;
        tmp[i] = (h[y * S + Math.max(0, x - 1)] + h[i] * 2 + h[y * S + Math.min(S - 1, x + 1)]) * 0.25;
      }
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x;
        h[i] = (tmp[Math.max(0, y - 1) * S + x] + tmp[i] * 2 + tmp[Math.min(S - 1, y + 1) * S + x]) * 0.25;
      }
      normalMap = asTexture(normalsFromHeight(h, S, S, normalStrength * this.scale * 0.5, false), false, false, aniso);
    }
    return { map, normalMap };
  }
}

// ------------------------------------------------------------------------------------------------
// Painting helpers
// ------------------------------------------------------------------------------------------------

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
function shadeHex(n: number, k: number): string {
  const r = Math.min(255, ((n >> 16) & 255) * k) | 0, g = Math.min(255, ((n >> 8) & 255) * k) | 0, b = Math.min(255, (n & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
}
function mixHex(a: number, b: number, t: number): string {
  const r = mix((a >> 16) & 255, (b >> 16) & 255, t) | 0, g = mix((a >> 8) & 255, (b >> 8) & 255, t) | 0, bl = mix(a & 255, b & 255, t) | 0;
  return `rgb(${r},${g},${bl})`;
}

const GOLD = '#caa046', GOLD_HI = '#f0d488', GOLD_DK = '#6e4c16', INK = '#140c07', RED = '#6f1f14', BLUE = '#1c3148', BONE = '#d6c9aa';

interface Pal { ground: string; body: string; edge: string; line?: string; accent: string; accent2: string }
const PAL_H: Pal = { ground: '#6a6a6a', body: '#dcdcdc', edge: '#2a2a2a', line: '#f4f4f4', accent: '#b4b4b4', accent2: '#909090' };

/** Cross-hatched weave shading over cloth. */
function weave(c: Ctx, w: number, h: number, strength = 0.16): void {
  c.save();
  c.globalAlpha = strength;
  c.fillStyle = '#000';
  for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  c.globalAlpha = strength * 0.6;
  for (let x = 0; x < w; x += 3) c.fillRect(x, 0, 1, h);
  c.globalAlpha = strength * 0.5;
  c.fillStyle = '#fff';
  for (let y = 1; y < h; y += 6) c.fillRect(0, y, w, 1);
  // soft vertical folds
  for (let i = 0; i < 5; i++) {
    const x = (hash2(i, w, 7) * 0.9 + 0.05) * w, fw = w * (0.05 + 0.08 * hash2(i, h, 8));
    const g = c.createLinearGradient(x - fw, 0, x + fw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.16;
    c.fillStyle = g; c.fillRect(x - fw, 0, fw * 2, h);
  }
  c.restore();
}

/** Mottled dirt / wear. */
function grime(c: Ctx, w: number, h: number, seed: number, strength = 0.25): void {
  c.save();
  for (let i = 0; i < 70; i++) {
    const x = hash2(i, 1, seed) * w, y = hash2(i, 2, seed) * h, r = (0.04 + hash2(i, 3, seed) * 0.16) * Math.max(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const dark = hash2(i, 4, seed) > 0.35;
    g.addColorStop(0, dark ? `rgba(8,5,3,${strength * 0.5})` : `rgba(255,240,210,${strength * 0.22})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  c.restore();
}

function woodGround(c: Ctx, w: number, h: number, base: string, seed: number, vertical = false): void {
  c.fillStyle = base; c.fillRect(-8, -8, w + 16, h + 16);
  c.save();
  c.globalAlpha = 0.2;
  const n = Math.floor((vertical ? w : h) / 2.2);
  for (let i = 0; i < n; i++) {
    c.strokeStyle = hash2(i, 5, seed) > 0.5 ? '#000' : '#c9a777';
    c.lineWidth = 0.6 + hash2(i, 6, seed) * 1.2;
    c.globalAlpha = 0.06 + hash2(i, 7, seed) * 0.16;
    const p = hash2(i, 8, seed) * (vertical ? w : h);
    c.beginPath();
    if (vertical) { c.moveTo(p, -8); c.bezierCurveTo(p + 3, h * 0.3, p - 3, h * 0.7, p + 1, h + 8); } else { c.moveTo(-8, p); c.bezierCurveTo(w * 0.3, p + 3, w * 0.7, p - 3, w + 8, p + 1); }
    c.stroke();
  }
  c.restore();
}

function spacedText(c: Ctx, text: string, cx: number, cy: number, spacing: number): void {
  let total = 0;
  const ws = [...text].map((ch) => { const m = c.measureText(ch).width; total += m; return m; });
  total += spacing * (text.length - 1);
  let x = cx - total / 2;
  c.textAlign = 'left'; c.textBaseline = 'middle';
  [...text].forEach((ch, i) => { c.fillText(ch, x, cy); x += ws[i] + spacing; });
}

// ------------------------------------------------------------------------------------------------
// Cloth atlas (banners, tapestries, rugs, furs)
// ------------------------------------------------------------------------------------------------

export interface ClothRects {
  elementBanner: Record<ElementId, UVRect>;
  clanBanner: UVRect[];
  tapestry: UVRect[];
  runner: UVRect;
  fur: UVRect[];
  pennant: UVRect;
}

function drawElementBanner(c: Ctx, el: ElementId, w: number, h: number): void {
  const E = ELEMENTS[el];
  c.clearRect(-8, -8, w + 16, h + 16);
  c.save();
  // swallow-tail silhouette
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(w, 0); c.lineTo(w, h); c.lineTo(w * 0.5, h - w * 0.42); c.lineTo(0, h); c.closePath();
  c.clip();
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mixHex(E.dark, 0x120c0a, 0.25)); g.addColorStop(1, mixHex(E.dark, 0x0a0706, 0.5));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // side stripes
  c.fillStyle = shadeHex(E.color, 0.72); c.fillRect(7, 0, 6, h); c.fillRect(w - 13, 0, 6, h);
  c.fillStyle = shadeHex(E.color, 0.3); c.fillRect(16, 0, 2, h); c.fillRect(w - 18, 0, 2, h);
  // top band
  c.fillStyle = INK; c.fillRect(0, 0, w, 44);
  K.braidBand(c, 0, w, 22, 9, 3, 2, { width: 5, body: shadeHex(E.color, 0.85), edge: INK, line: hex(E.core) });
  c.fillStyle = shadeHex(E.color, 0.8); c.fillRect(0, 44, w, 3);
  // roundel + rune
  const cy = h * 0.42;
  c.fillStyle = 'rgba(0,0,0,0.42)'; c.beginPath(); c.arc(w / 2, cy, w * 0.36, 0, TAU); c.fill();
  c.lineWidth = 3; c.strokeStyle = shadeHex(E.color, 0.8); c.beginPath(); c.arc(w / 2, cy, w * 0.36, 0, TAU); c.stroke();
  K.strokeRune(c, E.rune, w / 2, cy, w * 0.5, 13, shadeHex(E.dark, 0.5));
  K.strokeRune(c, E.rune, w / 2, cy, w * 0.5, 8, hex(E.color));
  K.strokeRune(c, E.rune, w / 2, cy, w * 0.5, 2.5, hex(E.core));
  // lower chevrons
  c.strokeStyle = shadeHex(E.color, 0.6); c.lineWidth = 4;
  for (let i = 0; i < 3; i++) { const y = h * 0.66 + i * 22; c.beginPath(); c.moveTo(22, y); c.lineTo(w / 2, y + 22); c.lineTo(w - 22, y); c.stroke(); }
  weave(c, w, h, 0.2);
  grime(c, w, h, el.length * 13 + 5, 0.3);
  c.restore();
}

function drawClanBanner(c: Ctx, kind: number, w: number, h: number): void {
  c.clearRect(-8, -8, w + 16, h + 16);
  c.save();
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(w, 0); c.lineTo(w, h * 0.9);
  const tails = 3;
  for (let i = tails; i > 0; i--) { c.lineTo((w * (i - 0.5)) / tails, h); c.lineTo((w * (i - 1)) / tails, h * 0.9); }
  c.closePath();
  c.clip();
  const base = kind === 0 ? RED : BLUE;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, base); g.addColorStop(1, kind === 0 ? '#3d0f0a' : '#0f1c2c');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // border
  c.strokeStyle = GOLD; c.lineWidth = 5; c.strokeRect(12, 12, w - 24, h * 0.9 - 30);
  c.strokeStyle = GOLD_DK; c.lineWidth = 2; c.strokeRect(20, 20, w - 40, h * 0.9 - 46);
  const st = { width: 7, body: GOLD, edge: INK, line: GOLD_HI };
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(22, 30, w - 44, 46); c.fillRect(22, h * 0.9 - 92, w - 44, 46);
  K.braidBand(c, 22, w - 22, 53, 12, 4, 3, st);
  K.braidBand(c, 22, w - 22, h * 0.9 - 69, 12, 4, 3, st);
  const cy = h * 0.42, r = w * 0.36;
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.arc(w / 2, cy, r * 1.12, 0, TAU); c.fill();
  K.braidRing(c, w / 2, cy, r * 1.02, 7, 12, 2, { width: 5, body: GOLD, edge: INK, line: GOLD_HI });
  if (kind === 0) K.worldTree(c, w / 2, cy, r * 0.95, { width: 5, body: GOLD_HI, edge: INK }, 3);
  else { K.valknut(c, w / 2, cy + 4, r * 0.86, { width: 8, body: GOLD_HI, edge: INK }); }
  K.runeRow(c, 30, w - 30, h * 0.69, 30, 4.5, GOLD, kind * 3 + 1);
  weave(c, w, h, 0.2);
  grime(c, w, h, 31 + kind, 0.32);
  c.restore();
}

function drawShip(c: Ctx, x: number, y: number, s: number, sail: string, flip: boolean): void {
  c.save();
  c.translate(x, y); c.scale(flip ? -s : s, s);
  // hull
  c.fillStyle = '#2a1a10'; c.strokeStyle = GOLD; c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(-52, -6); c.quadraticCurveTo(0, 22, 52, -6); c.quadraticCurveTo(60, -22, 54, -34); c.quadraticCurveTo(50, -14, 40, -6);
  c.lineTo(-40, -6); c.quadraticCurveTo(-52, -16, -58, -30); c.quadraticCurveTo(-62, -16, -52, -6); c.closePath();
  c.fill(); c.stroke();
  // dragon prow curl
  c.beginPath(); c.arc(50, -37, 5, 0.6, Math.PI * 1.8); c.stroke();
  // shields
  for (let i = -3; i <= 3; i++) { c.fillStyle = i % 2 ? '#8a2a18' : '#d6c9aa'; c.beginPath(); c.arc(i * 11, -3, 4.6, 0, TAU); c.fill(); c.strokeStyle = INK; c.lineWidth = 1; c.stroke(); }
  // mast + sail
  c.strokeStyle = '#1a100a'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(0, -6); c.lineTo(0, -74); c.stroke();
  c.beginPath(); c.moveTo(-30, -70); c.quadraticCurveTo(0, -64, 30, -70); c.lineTo(27, -24); c.quadraticCurveTo(0, -16, -27, -24); c.closePath();
  c.fillStyle = BONE; c.fill();
  c.save(); c.clip();
  c.fillStyle = sail;
  for (let i = -3; i <= 3; i += 2) c.fillRect(i * 9 - 4.5, -80, 9, 70);
  c.restore();
  c.strokeStyle = INK; c.lineWidth = 1.2; c.stroke();
  c.restore();
}

function drawTapestry(c: Ctx, kind: number, w: number, h: number): void {
  const ground = kind === 0 ? '#3b2a1c' : '#1d2f36';
  c.fillStyle = ground; c.fillRect(-8, -8, w + 16, h + 16);
  // border
  c.fillStyle = kind === 0 ? RED : '#3d1711'; c.fillRect(0, 0, w, 34); c.fillRect(0, h - 34, w, 34);
  const st = { width: 5, body: GOLD, edge: INK, line: GOLD_HI };
  K.braidBand(c, 0, w, 17, 8, 10, 2, st);
  K.braidBand(c, 0, w, h - 17, 8, 10, 2, st);
  c.fillStyle = GOLD_DK; c.fillRect(0, 34, w, 3); c.fillRect(0, h - 37, w, 3);
  // sky bodies
  if (kind === 0) {
    K.sunWheel(c, w * 0.82, h * 0.3, 36, { width: 3.5, body: GOLD_HI, edge: INK });
    // mountains
    c.fillStyle = '#5b5348';
    c.beginPath(); c.moveTo(0, h * 0.6);
    for (let i = 0; i <= 10; i++) c.lineTo((i / 10) * w, h * (0.6 - (i % 2 ? 0.2 + 0.08 * hash2(i, 0, 5) : 0.02)));
    c.lineTo(w, h * 0.66); c.lineTo(0, h * 0.66); c.closePath(); c.fill();
    c.strokeStyle = BONE; c.lineWidth = 2;
    for (let i = 1; i <= 9; i += 2) { const x = (i / 10) * w, y = h * (0.6 - (0.2 + 0.08 * hash2(i, 0, 5))); c.beginPath(); c.moveTo(x - 12, y + 16); c.lineTo(x, y); c.lineTo(x + 12, y + 16); c.stroke(); }
  } else {
    // moon + stars + aurora ribbons
    c.fillStyle = BONE; c.beginPath(); c.arc(w * 0.16, h * 0.3, 22, 0, TAU); c.fill();
    c.fillStyle = ground; c.beginPath(); c.arc(w * 0.16 + 9, h * 0.3 - 5, 19, 0, TAU); c.fill();
    c.fillStyle = GOLD_HI;
    for (let i = 0; i < 26; i++) { const x = hash2(i, 1, 44) * w, y = 44 + hash2(i, 2, 44) * h * 0.3; c.fillRect(x, y, 2.4, 2.4); }
    c.lineWidth = 5;
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = ['#3f8f78', '#7a5aa8', '#4aa79a'][k];
      c.beginPath();
      for (let i = 0; i <= 40; i++) { const x = (i / 40) * w; const y = h * (0.26 + k * 0.05) + Math.sin(i * 0.5 + k * 2) * 12; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
    }
  }
  // sea
  for (let r = 0; r < 4; r++) {
    c.strokeStyle = r % 2 ? '#3d6f86' : '#8fb7c2'; c.lineWidth = 3.4;
    c.beginPath();
    const y0 = h * 0.7 + r * 13;
    for (let i = 0; i <= 80; i++) { const x = (i / 80) * w; const y = y0 + Math.sin(i * 0.8 + r * 1.7) * 4.5; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
    c.stroke();
  }
  drawShip(c, w * 0.26, h * 0.66, 1.15, kind === 0 ? '#8a2a18' : '#28524e', false);
  drawShip(c, w * 0.6, h * 0.69, 0.9, kind === 0 ? '#1c3148' : '#8a2a18', kind === 1);
  if (kind === 1) drawShip(c, w * 0.86, h * 0.66, 0.7, '#caa046', true);
  weave(c, w, h, 0.26);
  grime(c, w, h, 51 + kind, 0.3);
}

function drawRunner(c: Ctx, w: number, h: number): void {
  c.clearRect(-8, -8, w + 16, h + 16);
  // fringe
  c.strokeStyle = '#b8a888'; c.lineWidth = 2;
  for (let x = 6; x < w - 4; x += 5) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (hash2(x, 1, 3) - 0.5) * 3, 16); c.moveTo(x, h); c.lineTo(x + (hash2(x, 2, 3) - 0.5) * 3, h - 16); c.stroke(); }
  c.fillStyle = '#4a1712'; c.fillRect(2, 14, w - 4, h - 28);
  c.fillStyle = '#1b2b3d'; c.fillRect(14, 26, w - 28, h - 52);
  c.strokeStyle = GOLD; c.lineWidth = 3; c.strokeRect(14, 26, w - 28, h - 52);
  c.strokeStyle = '#b08a3a'; c.lineWidth = 1.5; c.strokeRect(22, 34, w - 44, h - 68);
  // diamonds down the middle
  const n = 7, step = (h - 100) / n;
  for (let i = 0; i < n; i++) {
    const cy = 50 + step * (i + 0.5), rx = w * 0.3, ry = step * 0.44;
    c.fillStyle = i % 2 ? '#6f1f14' : '#8f6a2a';
    c.beginPath(); c.moveTo(w / 2, cy - ry); c.lineTo(w / 2 + rx, cy); c.lineTo(w / 2, cy + ry); c.lineTo(w / 2 - rx, cy); c.closePath(); c.fill();
    c.strokeStyle = BONE; c.lineWidth = 2.5; c.stroke();
    c.fillStyle = '#1b2b3d'; c.beginPath(); c.moveTo(w / 2, cy - ry * 0.45); c.lineTo(w / 2 + rx * 0.45, cy); c.lineTo(w / 2, cy + ry * 0.45); c.lineTo(w / 2 - rx * 0.45, cy); c.closePath(); c.fill();
    K.strokeRune(c, i * 5 + 2, w / 2, cy, ry * 0.5, 2.5, GOLD_HI);
  }
  // zigzag borders
  c.strokeStyle = '#c9b48a'; c.lineWidth = 2;
  for (const x of [34, w - 34]) { c.beginPath(); for (let y = 44, k = 0; y < h - 44; y += 12, k++) { const xx = x + (k % 2 ? 6 : -6); if (k === 0) c.moveTo(xx, y); else c.lineTo(xx, y); } c.stroke(); }
  weave(c, w, h, 0.3);
  grime(c, w, h, 77, 0.45);
}

function drawFur(c: Ctx, kind: number, w: number, h: number): void {
  c.clearRect(-8, -8, w + 16, h + 16);
  const cols = kind === 0 ? ['#4a3323', '#75553a', '#a17e56'] : kind === 1 ? ['#6b6e72', '#a2a5a8', '#dcdcd6'] : ['#5a4433', '#8f7252', '#c4a880'];
  c.save();
  // pelt outline: body, four legs, head, tail
  const cx = w / 2;
  c.beginPath();
  c.moveTo(cx - w * 0.1, h * 0.04);
  c.bezierCurveTo(cx - w * 0.2, h * 0.02, cx - w * 0.22, h * 0.12, cx - w * 0.16, h * 0.17); // head left
  c.bezierCurveTo(cx - w * 0.42, h * 0.12, cx - w * 0.5, h * 0.2, cx - w * 0.47, h * 0.3); // front leg
  c.bezierCurveTo(cx - w * 0.36, h * 0.3, cx - w * 0.3, h * 0.36, cx - w * 0.31, h * 0.5);
  c.bezierCurveTo(cx - w * 0.33, h * 0.64, cx - w * 0.5, h * 0.7, cx - w * 0.48, h * 0.86); // hind leg
  c.bezierCurveTo(cx - w * 0.4, h * 0.94, cx - w * 0.26, h * 0.84, cx - w * 0.14, h * 0.86);
  c.bezierCurveTo(cx - w * 0.06, h * 0.9, cx - w * 0.04, h * 0.99, cx, h * 0.99); // tail
  c.bezierCurveTo(cx + w * 0.04, h * 0.99, cx + w * 0.06, h * 0.9, cx + w * 0.14, h * 0.86);
  c.bezierCurveTo(cx + w * 0.26, h * 0.84, cx + w * 0.4, h * 0.94, cx + w * 0.48, h * 0.86);
  c.bezierCurveTo(cx + w * 0.5, h * 0.7, cx + w * 0.33, h * 0.64, cx + w * 0.31, h * 0.5);
  c.bezierCurveTo(cx + w * 0.3, h * 0.36, cx + w * 0.36, h * 0.3, cx + w * 0.47, h * 0.3);
  c.bezierCurveTo(cx + w * 0.5, h * 0.2, cx + w * 0.42, h * 0.12, cx + w * 0.16, h * 0.17);
  c.bezierCurveTo(cx + w * 0.22, h * 0.12, cx + w * 0.2, h * 0.02, cx + w * 0.1, h * 0.04);
  c.closePath();
  c.clip();
  const g = c.createRadialGradient(cx, h * 0.5, 10, cx, h * 0.5, h * 0.6);
  g.addColorStop(0, cols[1]); g.addColorStop(1, cols[0]);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // fur strokes flowing outward from the spine
  for (let i = 0; i < 2600; i++) {
    const x = hash2(i, 1, 60 + kind) * w, y = hash2(i, 2, 60 + kind) * h;
    const side = x < cx ? -1 : 1;
    const len = 7 + hash2(i, 3, 60 + kind) * 12;
    const a = Math.PI / 2 - side * (0.35 + 0.5 * Math.abs(x - cx) / cx) + (hash2(i, 4, 60 + kind) - 0.5) * 0.5;
    const t = hash2(i, 5, 60 + kind);
    c.strokeStyle = t > 0.66 ? cols[2] : t > 0.3 ? cols[1] : cols[0];
    c.globalAlpha = 0.35 + 0.4 * hash2(i, 6, 60 + kind);
    c.lineWidth = 1 + hash2(i, 7, 60 + kind) * 1.2;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * len * side, y + Math.sin(a) * len); c.stroke();
  }
  // darker spine
  c.globalAlpha = 0.35;
  const sg = c.createLinearGradient(cx - w * 0.1, 0, cx + w * 0.1, 0);
  sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.5, 'rgba(0,0,0,0.9)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sg; c.fillRect(cx - w * 0.1, 0, w * 0.2, h);
  c.restore();
}

function drawPennant(c: Ctx, w: number, h: number): void {
  c.clearRect(-8, -8, w + 16, h + 16);
  c.save();
  c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h * 0.32); c.lineTo(w * 0.62, h * 0.5); c.lineTo(w, h * 0.7); c.lineTo(0, h); c.closePath(); c.clip();
  c.fillStyle = RED; c.fillRect(0, 0, w, h);
  c.fillStyle = GOLD; c.fillRect(0, h * 0.44, w, h * 0.12);
  K.strokeRune(c, 'algiz', w * 0.22, h * 0.5, h * 0.42, 7, INK);
  K.strokeRune(c, 'algiz', w * 0.22, h * 0.5, h * 0.42, 4, GOLD_HI);
  weave(c, w, h, 0.22);
  c.restore();
}

function buildClothAtlas(size: number, scale: number, aniso: number): { map: THREE.Texture; rects: ClothRects } {
  const A = new Atlas(size, scale, false, null);
  // order matters for the shelf packer: tall cells first, then the wide ones
  const runner = A.add(256, 1000, (c) => drawRunner(c, 256, 1000));
  const clanBanner = [0, 1].map((k) => A.add(256, 768, (c) => drawClanBanner(c, k, 256, 768)));
  const fur = [0, 1, 2].map((k) => A.add(336, 448, (c) => drawFur(c, k, 336, 448)));
  const elementBanner = {} as Record<ElementId, UVRect>;
  const banner = (el: ElementId) => { elementBanner[el] = A.add(128, 448, (c) => drawElementBanner(c, el, 128, 448)); };
  banner(ELEMENT_ORDER[0]);
  const tapestry = [0, 1].map((k) => A.add(640, 320, (c) => drawTapestry(c, k, 640, 320)));
  for (let i = 1; i < ELEMENT_ORDER.length; i++) banner(ELEMENT_ORDER[i]);
  const pennant = A.add(256, 128, (c) => drawPennant(c, 256, 128));
  const { map } = A.textures(aniso, 1);
  return { map, rects: { elementBanner, clanBanner, tapestry, runner, fur, pennant } };
}

// ------------------------------------------------------------------------------------------------
// Carved / painted atlas (shields, plaques, knotwork bands, panels) with normal map
// ------------------------------------------------------------------------------------------------

export interface CarveRects {
  shield: UVRect[];
  plaque: Record<ElementId, UVRect>;
  /** Tileable strips: gold braid on red, rune row on dark wood, twist on blue, grey stone braid, scale pattern. */
  bandBraid: UVRect; bandRunes: UVRect; bandTwist: UVRect; bandStone: UVRect; bandScale: UVRect;
  backboard: UVRect;
  tympanum: UVRect;
  inlay: UVRect;
  door: UVRect;
  panel: UVRect;
  stonePanel: UVRect;
}

function drawShield(c: Ctx, k: number, s: number, H: boolean): void {
  const cx = s / 2, cy = s / 2, r = s / 2 - 2;
  if (H) {
    c.fillStyle = '#808080'; c.fillRect(-8, -8, s + 16, s + 16);
    c.strokeStyle = '#5a5a5a'; c.lineWidth = 1.6;
    for (let x = s / 10; x < s; x += s / 5) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, s); c.stroke(); }
    c.strokeStyle = '#d0d0d0'; c.lineWidth = s * 0.07; c.beginPath(); c.arc(cx, cy, r - s * 0.035, 0, TAU); c.stroke();
    c.fillStyle = '#f0f0f0';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; c.beginPath(); c.arc(cx + Math.cos(a) * (r - s * 0.035), cy + Math.sin(a) * (r - s * 0.035), s * 0.014, 0, TAU); c.fill(); }
    return;
  }
  const pal: [string, string, string][] = [
    ['#7a2216', '#d6c9aa', GOLD], ['#1c3148', '#d6c9aa', GOLD], ['#18120e', GOLD, '#7a2216'], ['#8a6a24', '#15100c', '#d6c9aa'],
    ['#7a2216', GOLD, '#15100c'], ['#28524e', '#d6c9aa', '#15100c'], ['#1c3148', GOLD, '#d6c9aa'], ['#3c2a1c', '#7a2216', '#d6c9aa'],
  ];
  const [a, b, d] = pal[k % pal.length];
  c.fillStyle = a; c.fillRect(-8, -8, s + 16, s + 16);
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.clip();
  switch (k % 8) {
    case 0: c.fillStyle = b; c.fillRect(cx, 0, s, cy); c.fillRect(0, cy, cx, s); break;
    case 1:
      c.fillStyle = b;
      for (let i = 0; i < 4; i++) {
        c.beginPath(); c.moveTo(cx, cy);
        for (let t = 0; t <= 1.001; t += 0.05) { const ang = (i * TAU) / 4 + t * 1.5; c.lineTo(cx + Math.cos(ang) * r * 1.1 * t, cy + Math.sin(ang) * r * 1.1 * t); }
        for (let t = 1; t >= -0.001; t -= 0.05) { const ang = (i * TAU) / 4 + t * 1.5 + 0.75 * t + 0.02; c.lineTo(cx + Math.cos(ang) * r * 1.1 * t, cy + Math.sin(ang) * r * 1.1 * t); }
        c.closePath(); c.fill();
      }
      break;
    case 2: K.triskele(c, cx, cy, r * 0.9, { width: s * 0.045, body: b, edge: '#000' }); break;
    case 3: c.fillStyle = b; c.fillRect(0, 0, cx, s); K.strokeRune(c, 'tiwaz', cx, cy, r * 1.1, s * 0.05, d); break;
    case 4:
      c.fillStyle = b;
      for (let i = 0; i < 8; i++) { const a0 = (i / 8) * TAU, a1 = a0 + TAU / 16; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a0) * r * 1.2, cy + Math.sin(a0) * r * 1.2); c.lineTo(cx + Math.cos(a1) * r * 1.2, cy + Math.sin(a1) * r * 1.2); c.closePath(); c.fill(); }
      break;
    case 5:
      for (let i = 0; i < 3; i++) { c.strokeStyle = i % 2 ? d : b; c.lineWidth = s * 0.06; c.beginPath(); c.arc(cx, cy, r * (0.82 - i * 0.2), 0, TAU); c.stroke(); }
      break;
    case 6: c.fillStyle = b; c.fillRect(cx - s * 0.08, 0, s * 0.16, s); c.fillRect(0, cy - s * 0.08, s, s * 0.16); break;
    default:
      c.strokeStyle = b; c.lineWidth = s * 0.07;
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(0, cy + i * s * 0.2 + s * 0.2); c.lineTo(cx, cy + i * s * 0.2 - s * 0.05); c.lineTo(s, cy + i * s * 0.2 + s * 0.2); c.stroke(); }
  }
  // plank seams, wear
  c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1.4;
  for (let x = s / 10; x < s; x += s / 5) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, s); c.stroke(); }
  grime(c, s, s, 100 + k, 0.5);
  // scratches
  c.strokeStyle = 'rgba(230,220,200,0.25)'; c.lineWidth = 1;
  for (let i = 0; i < 9; i++) { const x = hash2(i, 1, 130 + k) * s, y = hash2(i, 2, 130 + k) * s, an = hash2(i, 3, 130 + k) * TAU, l = 10 + hash2(i, 4, 130 + k) * 30; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); c.stroke(); }
  c.restore();
  // iron rim + rivets
  c.strokeStyle = '#2a2826'; c.lineWidth = s * 0.07; c.beginPath(); c.arc(cx, cy, r - s * 0.035, 0, TAU); c.stroke();
  c.strokeStyle = '#55504a'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, r - s * 0.06, 0, TAU); c.stroke();
  c.fillStyle = '#7d766c';
  for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU; c.beginPath(); c.arc(cx + Math.cos(an) * (r - s * 0.035), cy + Math.sin(an) * (r - s * 0.035), s * 0.013, 0, TAU); c.fill(); }
}

function drawPlaque(c: Ctx, el: ElementId, w: number, h: number, H: boolean): void {
  const E = ELEMENTS[el];
  if (H) { c.fillStyle = '#787878'; c.fillRect(-8, -8, w + 16, h + 16); } else woodGround(c, w, h, '#24160d', 200 + el.length);
  // raised frame
  c.lineWidth = 7; c.strokeStyle = H ? '#d0d0d0' : '#3d2816'; c.strokeRect(5, 5, w - 10, h - 10);
  c.lineWidth = 2; c.strokeStyle = H ? '#404040' : GOLD_DK; c.strokeRect(11, 11, w - 22, h - 22);
  // sunk field
  c.fillStyle = H ? '#585858' : 'rgba(0,0,0,0.35)'; c.fillRect(13, 13, w - 26, h - 26);
  // end roundels with the rune
  for (const x of [h / 2 + 4, w - h / 2 - 4]) {
    c.fillStyle = H ? '#484848' : shadeHex(E.dark, 0.55); c.beginPath(); c.arc(x, h / 2, h * 0.31, 0, TAU); c.fill();
    c.lineWidth = 3; c.strokeStyle = H ? '#d8d8d8' : GOLD; c.stroke();
    K.strokeRune(c, E.rune, x, h / 2, h * 0.38, 5, H ? '#f0f0f0' : hex(E.color));
    if (!H) K.strokeRune(c, E.rune, x, h / 2, h * 0.38, 1.6, hex(E.core));
  }
  const name = E.name.toUpperCase();
  c.font = `700 ${Math.round(h * 0.46)}px Georgia, 'Times New Roman', serif`;
  if (!H) { c.fillStyle = '#0a0604'; spacedText(c, name, w / 2 + 2, h / 2 + 4, 9); }
  c.fillStyle = H ? '#f4f4f4' : GOLD_HI; spacedText(c, name, w / 2, h / 2 + 1, 9);
  if (!H) {
    const g = c.createLinearGradient(0, h * 0.25, 0, h * 0.75);
    g.addColorStop(0, 'rgba(255,240,190,0.0)'); g.addColorStop(1, 'rgba(90,50,10,0.5)');
    c.save(); c.globalCompositeOperation = 'source-atop'; c.fillStyle = g; c.fillRect(h, 10, w - h * 2, h - 20); c.restore();
  }
}

function bandCell(c: Ctx, H: boolean, w: number, h: number, kind: 'braid' | 'runes' | 'twist' | 'stone' | 'scale'): void {
  const pal = (g: string, body: string, edge: string, line?: string): K.RibbonStyle & { g: string } => (H ? { g: PAL_H.ground, width: 0, body: PAL_H.body, edge: PAL_H.edge, line: PAL_H.line } : { g, width: 0, body, edge, line });
  const rails = (col: string, hi: string) => {
    c.fillStyle = H ? '#c8c8c8' : col; c.fillRect(-8, 0, w + 16, 9); c.fillRect(-8, h - 9, w + 16, 9);
    c.fillStyle = H ? '#383838' : hi; c.fillRect(-8, 9, w + 16, 2.5); c.fillRect(-8, h - 11.5, w + 16, 2.5);
  };
  if (kind === 'braid') {
    const p = pal('#4d150e', GOLD, INK, GOLD_HI);
    if (H) { c.fillStyle = p.g; c.fillRect(-8, -8, w + 16, h + 16); } else { c.fillStyle = p.g; c.fillRect(-8, -8, w + 16, h + 16); grime(c, w, h, 301, 0.4); }
    K.braidBand(c, 0, w, h / 2, h * 0.24, 4, 3, { ...p, width: h * 0.13 });
    rails(GOLD_DK, INK);
  } else if (kind === 'twist') {
    const p = pal('#152638', BONE, INK, '#ffffff');
    c.fillStyle = p.g; c.fillRect(-8, -8, w + 16, h + 16);
    K.braidBand(c, 0, w, h / 2, h * 0.2, 6, 2, { ...p, width: h * 0.14 });
    c.fillStyle = H ? '#e0e0e0' : GOLD;
    for (let i = 0; i < 12; i++) { c.beginPath(); c.arc(((i + 0.5) / 12) * w, h / 2, h * 0.05, 0, TAU); c.fill(); }
    rails('#3a2a1a', INK);
  } else if (kind === 'stone') {
    c.fillStyle = H ? '#707070' : '#5d5a62'; c.fillRect(-8, -8, w + 16, h + 16);
    if (!H) grime(c, w, h, 303, 0.5);
    K.braidBand(c, 0, w, h / 2, h * 0.22, 4, 3, H ? { width: h * 0.13, body: PAL_H.body, edge: PAL_H.edge } : { width: h * 0.13, body: '#8d8a92', edge: '#26242a', line: '#a9a6ae' });
    c.fillStyle = H ? '#c8c8c8' : '#7b7880'; c.fillRect(-8, 0, w + 16, 8); c.fillRect(-8, h - 8, w + 16, 8);
    c.fillStyle = H ? '#383838' : '#2c2a30'; c.fillRect(-8, 8, w + 16, 2.5); c.fillRect(-8, h - 10.5, w + 16, 2.5);
  } else if (kind === 'runes') {
    if (H) { c.fillStyle = '#909090'; c.fillRect(-8, -8, w + 16, h + 16); } else woodGround(c, w, h, '#2b1a0f', 305);
    const n = 12, step = w / n;
    for (let i = -1; i <= n; i++) {
      const x = step * (i + 0.5);
      const idx = (((i + n) % n) * 7 + 3) % 24;
      if (H) K.strokeRune(c, idx, x, h / 2, h * 0.5, 6, '#303030');
      else { K.strokeRune(c, idx, x, h / 2, h * 0.5, 6.5, '#0a0604'); K.strokeRune(c, idx, x, h / 2, h * 0.5, 3.4, GOLD); }
    }
    rails('#5a3d1e', INK);
  } else {
    c.fillStyle = H ? '#606060' : '#3a1410'; c.fillRect(-8, -8, w + 16, h + 16);
    const n = 16, rw = w / n, rh = h / 3;
    for (let r = 3; r >= -1; r--) for (let i = -1; i <= n; i++) {
      const x = (i + (r % 2 ? 0.5 : 0)) * rw + rw / 2, y = r * rh;
      c.beginPath(); c.moveTo(x - rw / 2, y); c.quadraticCurveTo(x - rw / 2, y + rh * 1.25, x, y + rh * 1.5); c.quadraticCurveTo(x + rw / 2, y + rh * 1.25, x + rw / 2, y); c.closePath();
      if (H) { const g = c.createLinearGradient(0, y, 0, y + rh * 1.5); g.addColorStop(0, '#505050'); g.addColorStop(1, '#e8e8e8'); c.fillStyle = g; } else c.fillStyle = (i + r) % 3 === 0 ? '#8a6a24' : (i + r) % 3 === 1 ? '#6f1f14' : '#7d5a20';
      c.fill();
      c.lineWidth = 2; c.strokeStyle = H ? '#202020' : INK; c.stroke();
    }
    if (!H) grime(c, w, h, 307, 0.45);
  }
}

function drawBackboard(c: Ctx, w: number, h: number, H: boolean): void {
  if (H) { c.fillStyle = '#6c6c6c'; c.fillRect(-8, -8, w + 16, h + 16); } else { woodGround(c, w, h, '#2a180e', 401, true); grime(c, w, h, 402, 0.4); }
  const rib = (width: number, gold = true): K.RibbonStyle => (H ? { width, body: PAL_H.body, edge: PAL_H.edge, line: PAL_H.line } : { width, body: gold ? GOLD : '#8a2a18', edge: INK, line: gold ? GOLD_HI : '#c8553a' });
  // frame
  c.lineWidth = 12; c.strokeStyle = H ? '#cfcfcf' : '#4a2f18'; c.strokeRect(8, 8, w - 16, h - 16);
  c.lineWidth = 3; c.strokeStyle = H ? '#303030' : GOLD_DK; c.strokeRect(17, 17, w - 34, h - 34);
  // side braids
  for (const x of [46, w - 46]) {
    c.save(); c.translate(x, 0); c.rotate(Math.PI / 2);
    K.braidBand(c, 34, h - 34, 0, 11, 9, 3, rib(7));
    c.restore();
  }
  // top & bottom rune rows
  c.fillStyle = H ? '#585858' : 'rgba(0,0,0,0.4)'; c.fillRect(78, 28, w - 156, 50); c.fillRect(78, h - 78, w - 156, 50);
  if (H) { K.runeRow(c, 84, w - 84, 53, 34, 6, '#e8e8e8', 2); K.runeRow(c, 84, w - 84, h - 53, 34, 6, '#e8e8e8', 5); } else {
    K.runeRow(c, 84, w - 84, 53, 34, 7, INK, 2); K.runeRow(c, 84, w - 84, 53, 34, 4, GOLD, 2);
    K.runeRow(c, 84, w - 84, h - 53, 34, 7, INK, 5); K.runeRow(c, 84, w - 84, h - 53, 34, 4, GOLD, 5);
  }
  // great ring with the world tree
  const cx = w / 2, cy = h * 0.4, r = w * 0.31;
  c.fillStyle = H ? '#4c4c4c' : 'rgba(0,0,0,0.45)'; c.beginPath(); c.arc(cx, cy, r * 1.16, 0, TAU); c.fill();
  K.braidRing(c, cx, cy, r * 1.04, 11, 14, 3, rib(7));
  K.worldTree(c, cx, cy, r * 0.98, H ? { width: 7, body: '#f0f0f0', edge: '#202020' } : { width: 7, body: GOLD_HI, edge: INK }, 7);
  // lower panel: two ravens' wings abstracted as mirrored spirals + valknut
  const ly = h * 0.76;
  K.valknut(c, cx, ly, 62, rib(8));
  for (const s of [-1, 1]) {
    K.triskele(c, cx + s * 118, ly, 50, rib(6, false));
    K.braidRing(c, cx + s * 118, ly, 54, 5, 10, 2, rib(4));
  }
}

function drawTympanum(c: Ctx, w: number, h: number, H: boolean): void {
  if (H) { c.fillStyle = '#6c6c6c'; c.fillRect(-8, -8, w + 16, h + 16); } else { woodGround(c, w, h, '#2a180e', 411); grime(c, w, h, 412, 0.4); }
  const rib = (width: number, gold = true): K.RibbonStyle => (H ? { width, body: PAL_H.body, edge: PAL_H.edge, line: PAL_H.line } : { width, body: gold ? GOLD : '#8a2a18', edge: INK, line: gold ? GOLD_HI : '#c8553a' });
  const cx = w / 2, by = h - 6, R = Math.min(w / 2 - 10, h - 14);
  // concentric arcs of interlace
  const arc = (radius: number, lobes: number, st: K.RibbonStyle, amp: number) => {
    K.interlace(c, [0, Math.PI], lobes, amp, Math.PI, Math.PI * 2, (t, off) => [cx + Math.cos(t) * (radius + off) * (w / 2 - 10) / R, by + Math.sin(t) * (radius + off)], st, 300);
  };
  c.fillStyle = H ? '#505050' : 'rgba(0,0,0,0.4)';
  c.beginPath(); c.ellipse(cx, by, w / 2 - 10, R, 0, Math.PI, TAU); c.closePath(); c.fill();
  arc(R * 0.9, 18, rib(8), 10);
  arc(R * 0.62, 12, rib(7, false), 9);
  K.sunWheel(c, cx, by - R * 0.16, R * 0.4, rib(6), 10);
  c.lineWidth = 9; c.strokeStyle = H ? '#d0d0d0' : '#4a2f18';
  c.beginPath(); c.ellipse(cx, by, w / 2 - 8, R + 2, 0, Math.PI, TAU); c.stroke();
}

function drawInlay(c: Ctx, s: number, H: boolean): void {
  c.fillStyle = H ? '#808080' : '#57545c'; c.fillRect(-8, -8, s + 16, s + 16);
  if (!H) grime(c, s, s, 421, 0.6);
  const cx = s / 2, cy = s / 2;
  const st: K.RibbonStyle = H ? { width: 11, body: '#d8d8d8', edge: '#282828' } : { width: 11, body: '#8f8c95', edge: '#232127', line: '#aeabb4' };
  K.braidRing(c, cx, cy, s * 0.41, 13, 16, 3, st);
  c.lineWidth = 5; c.strokeStyle = H ? '#303030' : '#27252b';
  c.beginPath(); c.arc(cx, cy, s * 0.33, 0, TAU); c.stroke();
  c.beginPath(); c.arc(cx, cy, s * 0.485, 0, TAU); c.stroke();
  K.runeCircle(c, cx, cy, s * 0.275, s * 0.07, 16, 5, H ? '#2c2c2c' : '#1f1d22', 3);
  K.triskele(c, cx, cy, s * 0.21, { ...st, width: 12 });
}

function drawDoor(c: Ctx, w: number, h: number, H: boolean): void {
  if (H) { c.fillStyle = '#909090'; c.fillRect(-8, -8, w + 16, h + 16); } else woodGround(c, w, h, '#33200f', 431, true);
  const n = 5;
  for (let i = 1; i < n; i++) { c.fillStyle = H ? '#383838' : 'rgba(0,0,0,0.6)'; c.fillRect((i * w) / n - 1.5, 0, 3, h); }
  if (!H) grime(c, w, h, 432, 0.5);
  // iron straps with curled ends
  const iron = H ? '#d8d8d8' : '#26241f', hi = H ? '#f4f4f4' : '#4b4841';
  for (const y of [h * 0.18, h * 0.5, h * 0.82]) {
    c.fillStyle = iron; c.fillRect(0, y - 9, w * 0.78, 18);
    c.strokeStyle = iron; c.lineWidth = 7; c.lineCap = 'round';
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(w * 0.76, y); c.quadraticCurveTo(w * 0.88, y + s * 4, w * 0.9, y + s * 26); c.arc(w * 0.86, y + s * 26, w * 0.04, 0, s * Math.PI * 1.4, s < 0); c.stroke(); }
    c.fillStyle = hi;
    for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(14 + i * (w * 0.15), y, 3.6, 0, TAU); c.fill(); }
  }
  c.lineWidth = 6; c.strokeStyle = H ? '#404040' : INK; c.strokeRect(3, 3, w - 6, h - 6);
}

function drawPanel(c: Ctx, s: number, H: boolean, stone: boolean): void {
  if (H) { c.fillStyle = '#707070'; c.fillRect(-8, -8, s + 16, s + 16); } else if (stone) { c.fillStyle = '#5a5760'; c.fillRect(-8, -8, s + 16, s + 16); grime(c, s, s, 441, 0.6); } else { woodGround(c, s, s, '#2a180e', 442); grime(c, s, s, 443, 0.4); }
  const st: K.RibbonStyle = H ? { width: 8, body: PAL_H.body, edge: PAL_H.edge, line: PAL_H.line } : stone ? { width: 8, body: '#8f8c95', edge: '#232127', line: '#aeabb4' } : { width: 8, body: GOLD, edge: INK, line: GOLD_HI };
  c.lineWidth = 9; c.strokeStyle = H ? '#cfcfcf' : stone ? '#77747c' : '#4a2f18'; c.strokeRect(6, 6, s - 12, s - 12);
  K.braidRing(c, s / 2, s / 2, s * 0.33, 10, 10, 3, st);
  K.valknut(c, s / 2, s / 2 + 4, s * 0.2, { ...st, width: 7 });
  for (const [x, y] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]]) K.triskele(c, s * x, s * y, s * 0.08, { ...st, width: 4 });
}

function buildCarveAtlas(size: number, scale: number, aniso: number): { map: THREE.Texture; normalMap: THREE.Texture; rects: CarveRects } {
  const A = new Atlas(size, scale, true, '#2a180e');
  const backboard = A.add(512, 760, (c, H) => drawBackboard(c, 512, 760, H));
  const door = A.add(256, 512, (c, H) => drawDoor(c, 256, 512, H));
  const inlay = A.add(448, 448, (c, H) => drawInlay(c, 448, H));
  const tympanum = A.add(640, 320, (c, H) => drawTympanum(c, 640, 320, H));
  const panel = A.add(256, 256, (c, H) => drawPanel(c, 256, H, false));
  const stonePanel = A.add(256, 256, (c, H) => drawPanel(c, 256, H, true));
  const shield = Array.from({ length: 8 }, (_, k) => A.add(224, 224, (c, H) => drawShield(c, k, 224, H)));
  const band = (kind: 'braid' | 'runes' | 'twist' | 'stone' | 'scale') => A.add(512, 96, (c, H) => bandCell(c, H, 512, 96, kind), true);
  const bandBraid = band('braid'), bandRunes = band('runes'), bandTwist = band('twist'), bandStone = band('stone'), bandScale = band('scale');
  const plaque = {} as Record<ElementId, UVRect>;
  for (const el of ELEMENT_ORDER) plaque[el] = A.add(384, 96, (c, H) => drawPlaque(c, el, 384, 96, H));
  const t = A.textures(aniso, 7);
  return { map: t.map, normalMap: t.normalMap!, rects: { shield, plaque, bandBraid, bandRunes, bandTwist, bandStone, bandScale, backboard, tympanum, inlay, door, panel, stonePanel } };
}

// ------------------------------------------------------------------------------------------------
// Glow glyph sheet (additive): runes, rune circle, valknut, bands
// ------------------------------------------------------------------------------------------------

export interface GlyphRects {
  /** 24 Elder Futhark runes; index with runeIndex(). */
  rune: UVRect[];
  circle: UVRect;
  valknut: UVRect;
  rays: UVRect;
  runeBand: UVRect;
  braidBand: UVRect;
  /** Grid layout for shaders: 8 columns x 8 rows of the sheet, runes fill the first three rows. */
  cols: number; rows: number;
}

function buildGlyphs(size: number): { tex: THREE.Texture; rects: GlyphRects } {
  const cv = canvas(size, size);
  const c = cv.getContext('2d')!;
  const k = size / 1024;
  c.fillStyle = '#000'; c.fillRect(0, 0, size, size);
  c.scale(k, k);
  const glow = (_blur: number, draw: () => void) => { draw(); };
  const S = 1024;
  const rect = (x: number, y: number, w: number, h: number, inset = 1): UVRect => [(x + inset) / S, 1 - (y + h - inset) / S, (x + w - inset) / S, 1 - (y + inset) / S];
  const rune: UVRect[] = [];
  for (let i = 0; i < 24; i++) {
    const cx = (i % 8) * 128 + 64, cy = Math.floor(i / 8) * 128 + 64;
    c.save(); c.beginPath(); c.rect(cx - 64, cy - 64, 128, 128); c.clip();
    glow(14, () => K.strokeRune(c, i, cx, cy, 80, 9, '#ffffff'));
    c.restore();
    rune.push(rect(cx - 64, cy - 64, 128, 128));
  }
  // tileable bands (row 3: y 384..512)
  c.save(); c.beginPath(); c.rect(0, 384, 512, 128); c.clip();
  glow(10, () => { for (let i = -1; i <= 8; i++) K.strokeRune(c, (((i + 8) % 8) * 5 + 1) % 24, 32 + i * 64, 448, 62, 6, '#ffffff'); });
  c.fillStyle = '#fff'; c.fillRect(0, 392, 512, 3); c.fillRect(0, 501, 512, 3);
  c.restore();
  c.save(); c.beginPath(); c.rect(512, 384, 512, 128); c.clip();
  c.translate(512, 0);
  glow(10, () => K.braidBand(c, 0, 512, 448, 26, 4, 3, { width: 9, body: '#ffffff', edge: '#000000', edgeW: 5 }));
  c.restore();
  // rune circle (bottom-left 512)
  c.save(); c.beginPath(); c.rect(0, 512, 512, 512); c.clip();
  glow(12, () => {
    const cx = 256, cy = 768;
    c.strokeStyle = '#fff'; c.lineWidth = 5;
    for (const r of [244, 196, 120]) { c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke(); }
    K.runeCircle(c, cx, cy, 220, 34, 24, 4.5, '#ffffff', 0);
    K.braidRing(c, cx, cy, 158, 16, 12, 3, { width: 7, body: '#ffffff', edge: '#000000', edgeW: 4 });
    K.valknut(c, cx, cy + 6, 96, { width: 8, body: '#ffffff', edge: '#000000', edgeW: 4 });
  });
  c.restore();
  // valknut (256) and ray burst (256)
  c.save(); c.beginPath(); c.rect(512, 512, 256, 256); c.clip();
  glow(12, () => { K.valknut(c, 640, 646, 104, { width: 10, body: '#ffffff', edge: '#000000', edgeW: 5 }); });
  c.restore();
  c.save(); c.beginPath(); c.rect(768, 512, 256, 256); c.clip();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU + hash2(i, 1, 5) * 0.1, len = 60 + hash2(i, 2, 5) * 64, wd = 0.02 + hash2(i, 3, 5) * 0.05;
    const g = c.createRadialGradient(896, 640, 4, 896, 640, len);
    g.addColorStop(0, `rgba(255,255,255,${0.5 + 0.5 * hash2(i, 4, 5)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.moveTo(896, 640); c.arc(896, 640, len, a - wd, a + wd); c.closePath(); c.fill();
  }
  c.restore();
  // halo: add two down-scaled (= blurred) copies of the crisp sheet back on top of it
  c.setTransform(1, 0, 0, 1, 0, 0);
  for (const div of [4, 10]) {
    const sm = canvas(Math.max(8, Math.round(size / div)), Math.max(8, Math.round(size / div)));
    const sc = sm.getContext('2d')!;
    sc.imageSmoothingEnabled = true;
    sc.drawImage(cv, 0, 0, sm.width, sm.height);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = div === 4 ? 0.7 : 0.5;
    c.imageSmoothingEnabled = true;
    c.drawImage(sm, 0, 0, size, size);
    c.restore();
  }
  const tex = asTexture(cv, false, false, 4);
  return { tex, rects: { rune, runeBand: rect(0, 384, 512, 128, 0), braidBand: rect(512, 384, 512, 128, 0), circle: rect(0, 512, 512, 512), valknut: rect(512, 512, 256, 256), rays: rect(768, 512, 256, 256), cols: 8, rows: 8 } };
}

// ------------------------------------------------------------------------------------------------
// Particle sheet: 4 x 4 cells, intensity in alpha
// ------------------------------------------------------------------------------------------------

export const SPR = { blob: 0, spark: 1, smoke: 2, ring: 3, arc: 4, boltA: 5, boltB: 6, drop: 7, crystal: 8, ray: 9, wisp: 10, mote: 11, ember: 12, flare: 13, halo: 14, disc: 15 } as const;

function buildParticles(size: number): THREE.Texture {
  const cv = canvas(size, size);
  const c = cv.getContext('2d')!;
  const cs = size / 4;
  const cell = (i: number, draw: (s: number) => void) => {
    c.save();
    c.translate((i % 4) * cs, Math.floor(i / 4) * cs);
    c.beginPath(); c.rect(0, 0, cs, cs); c.clip();
    draw(cs);
    c.restore();
  };
  const radial = (s: number, stops: [number, number][], r = 0.5, cx = 0.5, cy = 0.5) => {
    const g = c.createRadialGradient(cx * s, cy * s, 0, cx * s, cy * s, r * s);
    for (const [t, a] of stops) g.addColorStop(t, `rgba(255,255,255,${a})`);
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  };
  cell(SPR.blob, (s) => radial(s, [[0, 1], [0.25, 0.62], [0.55, 0.2], [0.8, 0.05], [1, 0]]));
  cell(SPR.spark, (s) => {
    radial(s, [[0, 1], [0.12, 0.9], [0.3, 0.2], [0.6, 0.03], [1, 0]]);
    c.globalCompositeOperation = 'lighter';
    for (const a of [0, Math.PI / 2]) {
      c.save(); c.translate(s / 2, s / 2); c.rotate(a);
      const g = c.createLinearGradient(-s * 0.48, 0, s * 0.48, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, s * 0.48, s * 0.018, 0, 0, TAU); c.fill();
      c.restore();
    }
  });
  const noisy = (i: number, seed: number, fn: (u: number, v: number, n: number, n2: number) => number) => {
    const img = c.createImageData(cs, cs);
    for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
      const u = x / cs, v = y / cs;
      const n = tfbm(u * 4, v * 4, 4, 4, 4, seed), n2 = tfbm(u * 9 + 3, v * 9, 9, 9, 3, seed + 9);
      const a = clamp01(fn(u, v, n, n2));
      const k = (y * cs + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
    }
    c.putImageData(img, (i % 4) * cs, Math.floor(i / 4) * cs);
  };
  noisy(SPR.smoke, 501, (u, v, n, n2) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    return sstep(1.0, 0.25, d + (n - 0.5) * 0.7) * (0.55 + 0.6 * n2) * 0.95;
  });
  noisy(SPR.wisp, 517, (u, v, n, n2) => {
    // a curling tendril
    const t = v, cxv = 0.5 + Math.sin(t * 5.2 + n * 2.0) * 0.16 * (1 - t * 0.3);
    const wd = 0.035 + 0.1 * Math.sin(Math.PI * t) * (0.6 + 0.8 * n2);
    return sstep(wd, wd * 0.25, Math.abs(u - cxv)) * Math.sin(Math.PI * t) * (0.5 + 0.7 * n);
  });
  cell(SPR.ring, (s) => {
    c.lineWidth = s * 0.03; c.strokeStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = s * 0.06;
    c.beginPath(); c.arc(s / 2, s / 2, s * 0.4, 0, TAU); c.stroke(); c.stroke();
  });
  cell(SPR.arc, (s) => {
    // crescent wind streak: bright head, fading tail
    for (let i = 0; i < 64; i++) {
      const t = i / 63, a = -Math.PI * 0.95 + t * Math.PI * 1.5;
      c.globalAlpha = Math.pow(t, 1.6) * 0.5;
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(s / 2 + Math.cos(a) * s * 0.4, s / 2 + Math.sin(a) * s * 0.4, s * (0.006 + 0.022 * t), 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  });
  const bolt = (i: number, seed: number) => cell(i, (s) => {
    c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineJoin = 'round'; c.shadowColor = '#fff'; c.shadowBlur = s * 0.05;
    const run = (x: number, y: number, x1: number, y1: number, w: number, depth: number, sd: number) => {
      const pts: [number, number][] = [[x, y]];
      const n = 7;
      for (let k = 1; k < n; k++) { const t = k / n; pts.push([mix(x, x1, t) + (hash2(k, sd, seed) - 0.5) * s * 0.2, mix(y, y1, t) + (hash2(k, sd + 1, seed) - 0.5) * s * 0.05]); }
      pts.push([x1, y1]);
      c.lineWidth = w; c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
      if (depth > 0) { const p = pts[2 + (sd % 3)]; run(p[0], p[1], p[0] + (hash2(sd, 9, seed) - 0.5) * s * 0.6, p[1] + s * 0.3, w * 0.55, depth - 1, sd + 7); }
    };
    run(s * 0.5, s * 0.04, s * 0.5, s * 0.96, s * 0.022, 2, 1);
    run(s * 0.5, s * 0.04, s * 0.5, s * 0.96, s * 0.008, 0, 1);
  });
  bolt(SPR.boltA, 11); bolt(SPR.boltB, 29);
  cell(SPR.drop, (s) => {
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath(); c.moveTo(s * 0.5, s * 0.1); c.bezierCurveTo(s * 0.62, s * 0.4, s * 0.78, s * 0.52, s * 0.78, s * 0.66); c.arc(s * 0.5, s * 0.66, s * 0.28, 0, Math.PI); c.bezierCurveTo(s * 0.22, s * 0.52, s * 0.38, s * 0.4, s * 0.5, s * 0.1); c.fill();
    c.fillStyle = 'rgba(255,255,255,1)'; c.beginPath(); c.ellipse(s * 0.4, s * 0.62, s * 0.07, s * 0.11, 0.5, 0, TAU); c.fill();
    c.lineWidth = s * 0.03; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.arc(s * 0.5, s * 0.66, s * 0.26, 0.2, Math.PI * 0.8); c.stroke();
  });
  cell(SPR.crystal, (s) => {
    c.translate(s / 2, s / 2);
    c.fillStyle = 'rgba(255,255,255,0.4)'; c.strokeStyle = '#fff'; c.lineWidth = s * 0.02; c.lineJoin = 'miter';
    c.beginPath(); c.moveTo(0, -s * 0.46); c.lineTo(s * 0.17, -s * 0.08); c.lineTo(s * 0.1, s * 0.4); c.lineTo(-s * 0.1, s * 0.4); c.lineTo(-s * 0.17, -s * 0.08); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.75)'; c.beginPath(); c.moveTo(0, -s * 0.46); c.lineTo(s * 0.17, -s * 0.08); c.lineTo(0, s * 0.02); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(0, -s * 0.46); c.lineTo(0, s * 0.4); c.stroke();
  });
  cell(SPR.ray, (s) => {
    const g = c.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.15, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(s * 0.5, 0); c.lineTo(s * 0.62, s); c.lineTo(s * 0.38, s); c.closePath(); c.fill();
    const g2 = c.createLinearGradient(0, 0, s, 0);
    g2.addColorStop(0.3, 'rgba(0,0,0,1)'); g2.addColorStop(0.5, 'rgba(0,0,0,0)'); g2.addColorStop(0.7, 'rgba(0,0,0,1)');
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = g2; c.fillRect(0, 0, s, s);
  });
  cell(SPR.mote, (s) => radial(s, [[0, 1], [0.1, 1], [0.2, 0.35], [0.45, 0.08], [0.7, 0]]));
  cell(SPR.ember, (s) => {
    c.translate(s / 2, s / 2); c.scale(0.42, 1);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.48);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.8)'); g.addColorStop(0.5, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(-s, -s, s * 2, s * 2);
  });
  cell(SPR.flare, (s) => {
    radial(s, [[0, 1], [0.08, 0.8], [0.25, 0.16], [0.5, 0.03], [1, 0]]);
    c.globalCompositeOperation = 'lighter';
    c.translate(s / 2, s / 2);
    for (let i = 0; i < 6; i++) {
      c.save(); c.rotate((i / 6) * Math.PI);
      const g = c.createLinearGradient(-s * 0.5, 0, s * 0.5, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${i === 0 ? 1 : 0.5})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, s * (i === 0 ? 0.5 : 0.36), s * 0.012, 0, 0, TAU); c.fill();
      c.restore();
    }
  });
  cell(SPR.halo, (s) => {
    // soft wide ring with inner glow (crown halo)
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.22)'); g.addColorStop(0.72, 'rgba(255,255,255,1)'); g.addColorStop(0.8, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
  cell(SPR.disc, (s) => radial(s, [[0, 0.9], [0.6, 0.7], [0.85, 0.3], [1, 0]]));
  const t = asTexture(cv, false, false, 1);
  return t;
}

function buildNoise(size: number): THREE.Texture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    data[i] = tfbm(u * 4, v * 4, 4, 4, 5, 701) * 255;
    data[i + 1] = tfbm(u * 8, v * 8, 8, 8, 4, 709) * 255;
    data[i + 2] = (1 - Math.abs(2 * tfbm(u * 5, v * 5, 5, 5, 4, 719) - 1)) * 255;
    data[i + 3] = tfbm(u * 2, v * 2, 2, 2, 5, 727) * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------------

export interface HallTextures {
  wood: TileTex; planks: TileTex; rock: TileTex; paving: TileTex; masonry: TileTex; shingles: TileTex;
  cloth: THREE.Texture; clothRects: ClothRects;
  carve: THREE.Texture; carveNormal: THREE.Texture; carveRects: CarveRects;
  glyph: THREE.Texture; glyphRects: GlyphRects;
  particles: THREE.Texture;
  noise: THREE.Texture;
  /** Generation time per stage in ms (profiling). */
  timing: Record<string, number>;
  dispose(): void;
}

export function buildTextures(q: QualityLevel): HallTextures {
  const tile = q === 'low' ? 256 : q === 'medium' ? 384 : 512;
  const timing: Record<string, number> = {};
  let mark = performance.now();
  const lap = (name: string) => { const n = performance.now(); timing[name] = Math.round(n - mark); mark = n; };
  const aniso = q === 'low' ? 2 : q === 'medium' ? 4 : 8;
  const atlasSize = q === 'low' || q === 'medium' ? 1024 : 2048;
  const scale = atlasSize / 2048;
  const wood = woodTile(tile, aniso); lap('wood');
  const planks = plankTile(tile, aniso); lap('planks');
  const rock = rockTile(tile, aniso); lap('rock');
  const paving = pavingTile(tile, aniso); lap('paving');
  const masonry = masonryTile(tile, aniso); lap('masonry');
  const shingles = shingleTile(tile, aniso); lap('shingles');
  const cloth = buildClothAtlas(atlasSize, scale, aniso); lap('cloth');
  const carve = buildCarveAtlas(atlasSize, scale, aniso); lap('carve');
  const glyph = buildGlyphs(q === 'low' ? 512 : 1024); lap('glyph');
  const particles = buildParticles(q === 'low' ? 512 : 1024); lap('particles');
  const noise = buildNoise(256); lap('noise');
  const all: THREE.Texture[] = [wood.map, wood.normalMap, planks.map, planks.normalMap, rock.map, rock.normalMap, paving.map, paving.normalMap, masonry.map, masonry.normalMap, shingles.map, shingles.normalMap, cloth.map, carve.map, carve.normalMap, glyph.tex, particles, noise];
  return {
    wood, planks, rock, paving, masonry, shingles,
    cloth: cloth.map, clothRects: cloth.rects,
    carve: carve.map, carveNormal: carve.normalMap, carveRects: carve.rects,
    glyph: glyph.tex, glyphRects: glyph.rects,
    particles, noise, timing,
    dispose() { for (const t of all) t.dispose(); },
  };
}
