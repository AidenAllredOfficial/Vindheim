// Procedural textures for the effects layer. Nothing is loaded: every sprite is an analytic
// function rasterised once at start-up into a data texture.
//
// Particle atlas channels:  R = luminance (shading)   G = heat (white-hot core mask)   A = coverage

import * as THREE from 'three';
import { fbm2, noise2, hash2 } from '@shared/math';

export const ATLAS_COLS = 8, ATLAS_ROWS = 4, CELL = 128;

/** Sprite indices in the particle atlas. */
export const SPR = {
  GLOW: 0, SPARK: 1, SMOKE: 2 /* +1 variant */, FLAME: 4 /* +1 variant */, SHARD: 6, RING: 7,
  STAR: 8, STREAK: 9, CHUNK: 10, FLAKE: 11, LEAF: 12, DROP: 13, WISP: 14, BUBBLE: 15,
  ARC: 16, DUST: 17, RAY: 18, GLINT: 19, EMBER: 20, CURL: 21, SPLASH: 22, MOTE: 23,
} as const;

const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ss = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

type SpriteFn = (x: number, y: number, out: number[]) => void; // x,y in [-1,1], y up; out = [lum, heat, alpha]

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = sat((wx * vx + wy * vy) / (vx * vx + vy * vy + 1e-9));
  const dx = wx - vx * t, dy = wy - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

const edge = (r: number) => ss(1.0, 0.82, r); // keeps every sprite clear of its cell border

const SPRITES: Record<number, SpriteFn> = {
  [SPR.GLOW]: (x, y, o) => { const r = Math.hypot(x, y); o[0] = 1; o[1] = Math.exp(-r * r * 14); o[2] = Math.exp(-r * r * 4.2) * edge(r); },
  [SPR.SPARK]: (x, y, o) => { const r = Math.hypot(x, y); o[0] = 1; o[1] = Math.exp(-r * r * 60); o[2] = sat(Math.exp(-r * r * 26) + 0.22 * Math.exp(-r * r * 4)) * edge(r); },
  [SPR.SMOKE]: (x, y, o) => smoke(x, y, o, 3),
  [SPR.SMOKE + 1]: (x, y, o) => smoke(x, y, o, 71),
  [SPR.FLAME]: (x, y, o) => flame(x, y, o, 5),
  [SPR.FLAME + 1]: (x, y, o) => flame(x, y, o, 37),
  [SPR.SHARD]: (x, y, o) => {
    // sharp faceted sliver, long axis = y
    const d = Math.abs(x) / 0.2 + Math.abs(y + 0.12 * x) / 0.9;
    o[2] = ss(1.0, 0.9, d);
    o[0] = x < 0.02 * (y + 1) ? 1 : 0.55; o[1] = ss(0.5, 0.0, d) * 0.6 + ss(0.06, 0.0, Math.abs(x - 0.02 * (y + 1))) * 0.5;
  },
  [SPR.RING]: (x, y, o) => { const r = Math.hypot(x, y); const d = (r - 0.78) / 0.07; o[0] = 1; o[1] = Math.exp(-d * d * 4); o[2] = Math.exp(-d * d); },
  [SPR.STAR]: (x, y, o) => {
    const r = Math.hypot(x, y), ax = Math.abs(x), ay = Math.abs(y);
    const cross = Math.exp(-ax * 26) * Math.exp(-ay * 2.6) + Math.exp(-ay * 26) * Math.exp(-ax * 2.6);
    const dx = Math.abs(x + y) * 0.7071, dy = Math.abs(x - y) * 0.7071;
    const diag = 0.45 * (Math.exp(-dx * 30) * Math.exp(-dy * 5.5) + Math.exp(-dy * 30) * Math.exp(-dx * 5.5));
    const core = Math.exp(-r * r * 30);
    o[0] = 1; o[1] = sat(core + cross * 0.6); o[2] = sat(cross + diag + core + 0.18 * Math.exp(-r * r * 5)) * edge(r);
  },
  [SPR.STREAK]: (x, y, o) => {
    const w = Math.exp(-(x * x) / 0.012), l = Math.pow(sat(1 - Math.abs(y)), 1.3);
    o[0] = 1; o[1] = Math.exp(-(x * x) / 0.002) * l; o[2] = sat(w * l + 0.25 * Math.exp(-(x * x) / 0.09) * l * l);
  },
  [SPR.CHUNK]: (x, y, o) => {
    const a = Math.atan2(y, x), r = Math.hypot(x, y);
    const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 7);
    const a0 = (k / 7) * Math.PI * 2 - Math.PI, a1 = ((k + 1) / 7) * Math.PI * 2 - Math.PI;
    const r0 = 0.55 + 0.3 * hash2(k, 3, 9), r1 = 0.55 + 0.3 * hash2((k + 1) % 7, 3, 9);
    // distance to the polygon edge k
    const ax = Math.cos(a0) * r0, ay = Math.sin(a0) * r0, bx = Math.cos(a1) * r1, by = Math.sin(a1) * r1;
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const len = Math.hypot(bx - ax, by - ay);
    const d = cr / len; // > 0 inside
    o[2] = ss(0.0, 0.04, d);
    const facet = 0.45 + 0.55 * hash2(k, 11, 5) * (0.6 + 0.4 * sat(1 - r)) + 0.25 * sat(y * 0.8 + 0.3);
    o[0] = sat(facet * (0.8 + 0.4 * noise2(x * 6 + 9, y * 6 + 4, 2))); o[1] = 0;
  },
  [SPR.FLAKE]: (x, y, o) => {
    const r = Math.hypot(x, y); let a = Math.atan2(y, x);
    const seg = Math.PI / 3; a = Math.abs(((a % seg) + seg) % seg - seg / 2);
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    let d = segDist(px, py, 0, 0, 0.82, 0);
    d = Math.min(d, segDist(px, py, 0.45, 0, 0.62, 0.17), segDist(px, py, 0.25, 0, 0.36, 0.1));
    const line = Math.exp(-(d * d) / 0.0016);
    o[0] = 1; o[1] = Math.exp(-r * r * 20); o[2] = sat(line + 0.35 * Math.exp(-r * r * 6)) * edge(r);
  },
  [SPR.LEAF]: (x, y, o) => {
    const bx = x - 0.25 * y * y + 0.1; const d = (bx * bx) / 0.03 + (y * y) / 0.72;
    o[2] = ss(1.0, 0.8, d); o[0] = 0.65 + 0.35 * ss(-0.1, 0.12, bx); o[1] = 0;
  },
  [SPR.DROP]: (x, y, o) => {
    const r = Math.hypot(x, y) / 0.8;
    const rim = ss(0.45, 0.95, r);
    const spec = Math.exp(-((x + 0.25) ** 2 + (y - 0.3) ** 2) / 0.02);
    o[2] = ss(1.0, 0.9, r) * sat(0.35 + 0.65 * rim + spec); o[0] = sat(0.55 + 0.45 * rim + spec); o[1] = spec;
  },
  [SPR.WISP]: (x, y, o) => {
    // crescent swoosh: a band of an off-centre circle that thins toward both ends
    const cx = 0.25, cy = -0.1; const r = Math.hypot(x - cx, y - cy), a = Math.atan2(y - cy, x - cx);
    const t = sat((a + 2.2) / 3.6) /* along */; const taper = Math.sin(t * Math.PI);
    const w = 0.02 + 0.11 * taper; const d = (r - 0.7) / w;
    const n = 0.6 + 0.4 * noise2(a * 5, r * 9, 13);
    o[0] = 1; o[1] = Math.exp(-d * d * 3) * taper; o[2] = (a > -2.2 && a < 1.4 ? Math.exp(-d * d) * taper * n : 0) * edge(Math.hypot(x, y));
  },
  [SPR.BUBBLE]: (x, y, o) => {
    const r = Math.hypot(x, y) / 0.82;
    const rim = Math.exp(-(((r - 0.9) / 0.09) ** 2));
    const spec = Math.exp(-((x + 0.3) ** 2 + (y - 0.36) ** 2) / 0.015) + 0.5 * Math.exp(-((x - 0.32) ** 2 + (y + 0.38) ** 2) / 0.02);
    o[0] = 1; o[1] = sat(spec); o[2] = sat(rim + spec + 0.1 * ss(1, 0.3, r)) * ss(1.06, 0.98, r);
  },
  [SPR.ARC]: (x, y, o) => {
    // a little jagged electric arc, long axis = y
    let d = 9;
    let px = 0, py = -0.85;
    for (let i = 1; i <= 6; i++) {
      const ny = -0.85 + (1.7 * i) / 6, nx = i === 6 ? 0 : (hash2(i, 21, 8) - 0.5) * 0.55;
      d = Math.min(d, segDist(x, y, px, py, nx, ny)); px = nx; py = ny;
    }
    d = Math.min(d, segDist(x, y, 0.1, -0.1, 0.5, 0.25) * 1.5);
    o[0] = 1; o[1] = Math.exp(-(d * d) / 0.0012); o[2] = sat(Math.exp(-(d * d) / 0.004) + 0.3 * Math.exp(-(d * d) / 0.03)) * edge(Math.hypot(x, y));
  },
  [SPR.DUST]: (x, y, o) => {
    const r = Math.hypot(x, y); const n = fbm2(x * 2.2 + 31, y * 2.2 + 17, 4, 23);
    const grain = 0.75 + 0.25 * noise2(x * 14, y * 14, 4);
    o[2] = sat(ss(0.98, 0.15, r + (n - 0.5) * 0.55) * grain * 0.9); o[0] = sat(0.62 + 0.38 * ss(-0.6, 0.7, y + (n - 0.5))); o[1] = 0;
  },
  [SPR.RAY]: (x, y, o) => {
    // tapered ray: wide soft base at y=-1, needle tip at y=+1
    const t = (y + 1) * 0.5; const w = 0.22 * (1 - t) + 0.015;
    const a = Math.exp(-(x * x) / (w * w)) * Math.pow(sat(1 - t), 0.6) * ss(0, 0.12, t);
    o[0] = 1; o[1] = Math.exp(-(x * x) / (w * w * 0.15)) * (1 - t); o[2] = sat(a);
  },
  [SPR.GLINT]: (x, y, o) => {
    const ax = Math.abs(x), ay = Math.abs(y), r = Math.hypot(x, y);
    const c = Math.exp(-ax * 40) * Math.exp(-ay * 3.2) + Math.exp(-ay * 40) * Math.exp(-ax * 3.2);
    o[0] = 1; o[1] = sat(c); o[2] = sat(c + Math.exp(-r * r * 50)) * edge(r);
  },
  [SPR.EMBER]: (x, y, o) => {
    const r = Math.hypot(x * 1.25, y);
    const n = 0.7 + 0.3 * noise2(x * 5 + 2, y * 5 + 8, 6);
    o[0] = 1; o[1] = Math.exp(-r * r * 30); o[2] = sat(ss(0.5, 0.2, r) * n + 0.3 * Math.exp(-r * r * 5)) * edge(r);
  },
  [SPR.CURL]: (x, y, o) => {
    // wind curl: a spiral streak
    const r = Math.hypot(x, y), a = Math.atan2(y, x);
    let best = 0;
    for (let k = -1; k <= 1; k++) {
      const aa = a + k * Math.PI * 2; const t = (aa + Math.PI) / (Math.PI * 3); // 0..1 along 1.5 turns
      if (t < 0 || t > 1) continue;
      const rr = 0.18 + 0.62 * t; const w = 0.012 + 0.05 * Math.sin(t * Math.PI);
      const d = (r - rr) / w; best = Math.max(best, Math.exp(-d * d) * Math.sin(t * Math.PI));
    }
    o[0] = 1; o[1] = best * best; o[2] = best * edge(r);
  },
  [SPR.SPLASH]: (x, y, o) => {
    // crown of droplets: blobby ring, brighter rim
    const r = Math.hypot(x, y), a = Math.atan2(y, x);
    const lobes = 0.72 + 0.12 * Math.sin(a * 7 + 1.3) + 0.06 * Math.sin(a * 13);
    const d = (r - lobes) / 0.13; const body = Math.exp(-d * d);
    const n = 0.6 + 0.4 * noise2(x * 7 + 3, y * 7 + 1, 15);
    o[0] = 1; o[1] = Math.exp(-d * d * 5) * 0.7; o[2] = sat(body * n) * edge(r);
  },
  [SPR.MOTE]: (x, y, o) => {
    // tiny diamond mote with a soft halo
    const d = Math.abs(x) + Math.abs(y), r = Math.hypot(x, y);
    o[0] = 1; o[1] = ss(0.35, 0.0, d); o[2] = sat(ss(0.5, 0.3, d) + 0.35 * Math.exp(-r * r * 6)) * edge(r);
  },
};

function smoke(x: number, y: number, o: number[], seed: number) {
  const r = Math.hypot(x, y);
  const n = fbm2(x * 1.9 + seed, y * 1.9 - seed, 4, seed);
  const n2 = fbm2(x * 4.5 - seed, y * 4.5 + seed * 2, 3, seed + 5);
  const body = ss(0.95, 0.1, r + (n - 0.5) * 0.9);
  o[2] = sat(body * (0.55 + 0.6 * n2));
  // lit from above-left, darker pockets
  o[0] = sat(0.5 + 0.5 * ss(-0.7, 0.8, y * 0.8 - x * 0.3 + (n2 - 0.5) * 1.2));
  o[1] = sat(body * body * (1 - r));
}

function flame(x: number, y: number, o: number[], seed: number) {
  // teardrop pointing up, eroded by noise that gets stronger toward the tip
  const t = (y + 1) * 0.5; // 0 bottom .. 1 tip
  const n = fbm2(x * 2.6 + seed, y * 2.0 - seed, 4, seed);
  const sway = (noise2(y * 1.7 + seed, 3.1, seed) - 0.5) * 0.35 * t;
  const w = 0.62 * Math.pow(sat(1 - t), 0.75) * ss(0, 0.16, t) + 0.02;
  const d = Math.abs(x - sway) / w;
  const body = ss(1.0, 0.25, d + (n - 0.5) * (0.5 + 1.1 * t));
  const soft = ss(1.0, 0.1, d + (n - 0.5) * 0.8);
  o[2] = sat(body * ss(1.0, 0.7, t) * (0.3 + 0.8 * soft));
  o[0] = 1;
  o[1] = sat(ss(0.75, 0.0, d) * ss(0.7, 0.05, t) * (0.6 + 0.6 * n));
}

function makeData(w: number, h: number, data: Uint8Array<ArrayBuffer>, mips = true): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mips;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function buildParticleAtlas(): THREE.DataTexture {
  const W = ATLAS_COLS * CELL, H = ATLAS_ROWS * CELL;
  const data = new Uint8Array(W * H * 4);
  const o = [0, 0, 0];
  for (const key of Object.keys(SPRITES)) {
    const idx = +key, fn = SPRITES[idx];
    const cx = idx % ATLAS_COLS, cy = Math.floor(idx / ATLAS_COLS);
    for (let py = 0; py < CELL; py++) for (let px = 0; px < CELL; px++) {
      // 3 px transparent gutter so neighbours never bleed through the mip chain
      const g = 3;
      let lum = 0, heat = 0, a = 0;
      if (px >= g && py >= g && px < CELL - g && py < CELL - g) {
        const x = ((px - g + 0.5) / (CELL - 2 * g)) * 2 - 1, y = ((py - g + 0.5) / (CELL - 2 * g)) * 2 - 1;
        o[0] = 1; o[1] = 0; o[2] = 0;
        fn(x, y, o);
        lum = sat(o[0]); heat = sat(o[1]); a = sat(o[2]);
      }
      const i = ((cy * CELL + py) * W + cx * CELL + px) * 4;
      data[i] = lum * 255; data[i + 1] = heat * 255; data[i + 2] = 0; data[i + 3] = a * 255;
    }
  }
  return makeData(W, H, data);
}

// ------------------------------------------------------------------------------------- runes

type Stroke = number[]; // x0,y0,x1,y1,... polyline in a unit box, y up
const R: Record<string, Stroke[]> = {
  fehu: [[0.3, 0, 0.3, 1], [0.3, 0.5, 0.75, 0.88], [0.3, 0.22, 0.75, 0.6]],
  uruz: [[0.25, 0, 0.25, 1, 0.75, 0.62, 0.75, 0]],
  thurisaz: [[0.32, 0, 0.32, 1], [0.32, 0.78, 0.72, 0.5, 0.32, 0.22]],
  ansuz: [[0.3, 0, 0.3, 1, 0.75, 0.7], [0.3, 0.64, 0.75, 0.34]],
  raidho: [[0.3, 0, 0.3, 1, 0.72, 0.76, 0.3, 0.52, 0.76, 0]],
  kenaz: [[0.72, 0.92, 0.28, 0.5, 0.72, 0.08]],
  gebo: [[0.2, 0.08, 0.8, 0.92], [0.2, 0.92, 0.8, 0.08]],
  wunjo: [[0.32, 0, 0.32, 1, 0.74, 0.74, 0.32, 0.48]],
  hagalaz: [[0.25, 0, 0.25, 1], [0.75, 0, 0.75, 1], [0.25, 0.66, 0.75, 0.34]],
  nauthiz: [[0.5, 0, 0.5, 1], [0.24, 0.68, 0.76, 0.32]],
  isa: [[0.5, 0, 0.5, 1]],
  jera: [[0.58, 0.96, 0.26, 0.72, 0.5, 0.52], [0.5, 0.48, 0.76, 0.28, 0.44, 0.04]],
  eihwaz: [[0.5, 0, 0.5, 1, 0.8, 0.72], [0.5, 0, 0.2, 0.28]],
  perthro: [[0.28, 0, 0.28, 1, 0.52, 0.8, 0.76, 1], [0.28, 0, 0.52, 0.2, 0.76, 0]],
  algiz: [[0.5, 0, 0.5, 1], [0.5, 0.52, 0.18, 0.98], [0.5, 0.52, 0.82, 0.98]],
  sowilo: [[0.72, 1, 0.28, 0.68, 0.72, 0.36, 0.28, 0]],
  tiwaz: [[0.5, 0, 0.5, 1, 0.18, 0.64], [0.5, 1, 0.82, 0.64]],
  berkano: [[0.3, 0, 0.3, 1, 0.72, 0.76, 0.3, 0.5, 0.72, 0.24, 0.3, 0]],
  ehwaz: [[0.22, 0, 0.22, 1, 0.5, 0.64, 0.78, 1, 0.78, 0]],
  mannaz: [[0.22, 0, 0.22, 1, 0.78, 0.46], [0.78, 0, 0.78, 1, 0.22, 0.46]],
  laguz: [[0.36, 0, 0.36, 1, 0.74, 0.62]],
  ingwaz: [[0.5, 0.92, 0.82, 0.5, 0.5, 0.08, 0.18, 0.5, 0.5, 0.92]],
  dagaz: [[0.2, 0.05, 0.2, 0.95, 0.8, 0.05, 0.8, 0.95, 0.2, 0.05]],
  othala: [[0.2, 0, 0.8, 0.6, 0.5, 0.96, 0.2, 0.6, 0.8, 0]],
};
const RUNE_NAMES = Object.keys(R);

function runeDist(strokes: Stroke[], x: number, y: number): number {
  let d = 9;
  for (const s of strokes) for (let i = 0; i + 3 < s.length; i += 2) d = Math.min(d, segDist(x, y, s[i], s[i + 1], s[i + 2], s[i + 3]));
  return d;
}

/** Glyph atlas: 4x4 cells. 0..7 = the eight element runes (ELEMENT_ORDER), 8 = heal rune (algiz),
 *  9.. = spare ornament runes. R = crisp stroke, G = wide glow, A = max of both. */
export const GLYPH_COLS = 4, GLYPH_ROWS = 4;
export const GLYPH_HEAL = 8;
const GLYPH_ORDER = ['kenaz', 'isa', 'thurisaz', 'uruz', 'wunjo', 'laguz', 'eihwaz', 'sowilo', 'algiz', 'gebo', 'dagaz', 'othala', 'tiwaz', 'ansuz', 'raidho', 'ingwaz'];

export function buildGlyphAtlas(): THREE.DataTexture {
  const C = 128, W = GLYPH_COLS * C, H = GLYPH_ROWS * C;
  const data = new Uint8Array(W * H * 4);
  for (let g = 0; g < GLYPH_ORDER.length; g++) {
    const strokes = R[GLYPH_ORDER[g]];
    const cx = g % GLYPH_COLS, cy = Math.floor(g / GLYPH_COLS);
    for (let py = 0; py < C; py++) for (let px = 0; px < C; px++) {
      // glyph box occupies the middle of the cell (aspect 0.62 : 1)
      const u = (px + 0.5) / C, v = (py + 0.5) / C;
      const x = (u - 0.5) / 0.44 + 0.5, y = (v - 0.5) / 0.66 + 0.5;
      const d = runeDist(strokes, x, y) * 0.55; // back to roughly cell units
      const crisp = ss(0.034, 0.02, d), glow = Math.exp(-(d * d) / 0.006);
      const i = ((cy * C + py) * W + cx * C + px) * 4;
      const border = ss(0.5, 0.42, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)));
      data[i] = crisp * 255; data[i + 1] = glow * border * 255; data[i + 2] = 0; data[i + 3] = sat(Math.max(crisp, glow * border)) * 255;
    }
  }
  return makeData(W, H, data);
}

/** Rune band for circles: a horizontally repeating strip of 24 runes. R = crisp, G = glow. */
export function buildRuneBand(): THREE.DataTexture {
  const N = 24, W = 1024, H = 64, cw = W / N;
  const data = new Uint8Array(W * H * 4);
  for (let px = 0; px < W; px++) {
    const g = Math.floor(px / cw);
    const strokes = R[RUNE_NAMES[(g * 7 + 3) % RUNE_NAMES.length]];
    for (let py = 0; py < H; py++) {
      const u = (px - g * cw + 0.5) / cw, v = (py + 0.5) / H;
      const x = (u - 0.5) / 0.6 + 0.5, y = (v - 0.5) / 0.72 + 0.5;
      const d = runeDist(strokes, x, y) * 0.6;
      const crisp = ss(0.07, 0.035, d), glow = Math.exp(-(d * d) / 0.02);
      const i = (py * W + px) * 4;
      data[i] = crisp * 255; data[i + 1] = glow * 255; data[i + 2] = 0; data[i + 3] = 255;
    }
  }
  const tex = makeData(W, H, data);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
