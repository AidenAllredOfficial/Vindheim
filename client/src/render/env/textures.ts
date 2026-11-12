// Procedural textures (no external assets): two tileable noise atlases sampled by every
// environment shader, and the Elder Futhark glyph atlas used by glowing runes.
import * as THREE from 'three';
import { hash2 } from '@shared/math';

const mod = (a: number, n: number) => ((a % n) + n) % n;
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Tileable value noise: lattice of `period` cells. */
function pnoise(x: number, y: number, period: number, seed: number, periodY = period): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = mod(xi, period), x1 = (x0 + 1) % period, y0 = mod(yi, periodY), y1 = (y0 + 1) % periodY;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function pfbm(x: number, y: number, period: number, oct: number, seed: number): number {
  let amp = 0.5, sum = 0, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * pnoise(x * f, y * f, period * f, seed + i * 19); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}

const W = { f1: 0, f2: 0, id: 0 };
/** Tileable Worley noise: distances to the two nearest feature points, and the nearest cell's id. */
function pworley(x: number, y: number, period: number, seed: number): typeof W {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy;
    const wx = mod(cx, period), wy = mod(cy, period);
    const px = cx + 0.15 + 0.7 * hash2(wx, wy, seed), py = cy + 0.15 + 0.7 * hash2(wx, wy, seed + 57);
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = wx * 131 + wy; } else if (d < f2) f2 = d;
  }
  W.f1 = f1; W.f2 = f2; W.id = id;
  return W;
}

function finish(tex: THREE.DataTexture, anisotropy: number): THREE.DataTexture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Rock atlas. RG = tangent-space slope (-dH/du, -dH/dv, packed 0..1), B = height, A = cavity
 * (0 in cracks .. 1 on open faces). Cracked, chunky strata with fine grain.
 */
export function makeRockTexture(size: number, anisotropy: number): THREE.DataTexture {
  const H = new Float32Array(size * size), C = new Float32Array(size * size);
  const ridge = (x: number, y: number, px: number, py: number, oct: number, seed: number): number => {
    let amp = 0.5, sum = 0, norm = 0, f = 1, prev = 1;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(2 * pnoise(x * f, y * f, px * f, seed + i * 23, py * f) - 1);
      n *= n;
      sum += amp * n * prev; norm += amp; prev = 0.4 + 0.6 * n; amp *= 0.55; f *= 2;
    }
    return sum / norm;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // warp the domain so nothing lines up with the texel grid
    const wu = u + (pfbm(u * 3, v * 3, 3, 3, 201) - 0.5) * 0.11, wv = v + (pfbm(u * 3, v * 3, 3, 3, 202) - 0.5) * 0.11;
    const broad = pfbm(wu * 4, wv * 4, 4, 4, 31);
    // creased facets: ridged noise stretched along one axis reads as bedding planes
    const facets = ridge(wu * 3, wv * 11, 3, 11, 4, 57);
    const fine = pfbm(u * 30, v * 30, 30, 3, 47);
    // a sparse net of thin fractures
    const w1 = pworley(wu * 4, wv * 4, 4, 11);
    const gate = sstep(0.42, 0.62, pfbm(u * 2, v * 2, 2, 3, 77)); // fractures only in some regions
    const crack = (1 - sstep(0.0, 0.022, w1.f2 - w1.f1)) * gate;
    const w2 = pworley(wu * 11 + 0.3, wv * 11, 11, 23);
    const crack2 = (1 - sstep(0.0, 0.035, w2.f2 - w2.f1)) * sstep(0.5, 0.72, broad) * 0.5;
    const cr = Math.max(crack, crack2);
    const pits = sstep(0.62, 0.8, pfbm(u * 16, v * 16, 16, 2, 91));
    H[y * size + x] = 0.34 * broad + 0.44 * facets + 0.14 * fine + 0.08 - cr * 0.14 - pits * 0.05;
    C[y * size + x] = (1 - cr * 0.6) * (0.55 + 0.45 * sstep(0.05, 0.55, facets)) * (0.85 + 0.15 * fine) * (1 - pits * 0.25);
  }
  const data = new Uint8Array(size * size * 4);
  const K = size * 0.036; // slope strength
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const hx = H[y * size + ((x + 1) % size)] - H[y * size + ((x + size - 1) % size)];
    const hy = H[((y + 1) % size) * size + x] - H[((y + size - 1) % size) * size + x];
    data[i * 4] = Math.max(0, Math.min(255, 127.5 - hx * K * 127.5));
    data[i * 4 + 1] = Math.max(0, Math.min(255, 127.5 - hy * K * 127.5));
    data[i * 4 + 2] = Math.max(0, Math.min(255, H[i] * 255));
    data[i * 4 + 3] = Math.max(0, Math.min(255, C[i] * 255));
  }
  return finish(new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType), anisotropy);
}

/**
 * Detail atlas. R = broad fbm, G = thin crack lines (ice, dry earth), B = fine uncorrelated grain
 * (sparkle, blades), A = a second, lower-frequency fbm (clouds, macro variation).
 */
export function makeDetailTexture(size: number, anisotropy: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    const r = pfbm(u * 4, v * 4, 4, 5, 5);
    // cracks: warped cell borders, a bold network plus a fine one
    const wx = u + (pnoise(u * 9, v * 9, 9, 71) - 0.5) * 0.035, wy = v + (pnoise(u * 9, v * 9, 9, 72) - 0.5) * 0.035;
    const w1 = pworley(wx * 5, wy * 5, 5, 61);
    const l1 = 1 - sstep(0.0, 0.045, w1.f2 - w1.f1);
    const w2 = pworley(wx * 13, wy * 13, 13, 67);
    const l2 = 1 - sstep(0.0, 0.07, w2.f2 - w2.f1);
    const g = Math.max(l1, l2 * 0.45);
    const b = hash2(x, y, 97) * 0.75 + pnoise(u * 64, v * 64, 64, 99) * 0.25;
    const a = pfbm(u * 3, v * 3, 3, 5, 83);
    data[i] = r * 255; data[i + 1] = g * 255; data[i + 2] = b * 255; data[i + 3] = sstep(0.12, 0.88, a) * 255;
  }
  return finish(new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType), anisotropy);
}

// ----------------------------------------------------------------------------------------------
// Rune atlas
// ----------------------------------------------------------------------------------------------

type Stroke = [number, number][];
/** Elder Futhark, drawn as strokes in a unit box (y up). Order = FUTHARK below. */
const GLYPHS: Record<string, Stroke[]> = {
  'ᚠ': [[[0.36, 0], [0.36, 1]], [[0.36, 0.5], [0.7, 0.78]], [[0.36, 0.76], [0.7, 1]]],
  'ᚢ': [[[0.3, 0], [0.3, 1], [0.7, 0.62], [0.7, 0]]],
  'ᚦ': [[[0.36, 0], [0.36, 1]], [[0.36, 0.78], [0.7, 0.5], [0.36, 0.22]]],
  'ᚨ': [[[0.36, 0], [0.36, 1], [0.7, 0.76]], [[0.36, 0.7], [0.7, 0.46]]],
  'ᚱ': [[[0.34, 0], [0.34, 1], [0.68, 0.76], [0.34, 0.52], [0.7, 0]]],
  'ᚲ': [[[0.7, 0.88], [0.32, 0.5], [0.7, 0.12]]],
  'ᚷ': [[[0.24, 0.08], [0.76, 0.92]], [[0.76, 0.08], [0.24, 0.92]]],
  'ᚹ': [[[0.36, 0], [0.36, 1], [0.7, 0.76], [0.36, 0.52]]],
  'ᚺ': [[[0.3, 0], [0.3, 1]], [[0.7, 0], [0.7, 1]], [[0.3, 0.66], [0.7, 0.36]]],
  'ᚾ': [[[0.5, 0], [0.5, 1]], [[0.28, 0.68], [0.72, 0.36]]],
  'ᛁ': [[[0.5, 0], [0.5, 1]]],
  'ᛃ': [[[0.56, 0.96], [0.28, 0.72], [0.56, 0.5]], [[0.44, 0.5], [0.72, 0.28], [0.44, 0.04]]],
  'ᛇ': [[[0.5, 0], [0.5, 1], [0.74, 0.76]], [[0.5, 0], [0.26, 0.24]]],
  'ᛈ': [[[0.34, 0], [0.34, 1], [0.54, 0.82], [0.72, 1]], [[0.34, 0], [0.54, 0.18], [0.72, 0]]],
  'ᛉ': [[[0.5, 0], [0.5, 1]], [[0.24, 1], [0.5, 0.52], [0.76, 1]]],
  'ᛊ': [[[0.68, 1], [0.32, 0.66], [0.68, 0.36], [0.32, 0]]],
  'ᛏ': [[[0.5, 0], [0.5, 1]], [[0.24, 0.7], [0.5, 1], [0.76, 0.7]]],
  'ᛒ': [[[0.34, 0], [0.34, 1], [0.68, 0.76], [0.34, 0.5], [0.68, 0.24], [0.34, 0]]],
  'ᛖ': [[[0.28, 0], [0.28, 1], [0.5, 0.7], [0.72, 1], [0.72, 0]]],
  'ᛗ': [[[0.28, 0], [0.28, 1], [0.72, 0.56]], [[0.72, 0], [0.72, 1], [0.28, 0.56]]],
  'ᛚ': [[[0.4, 0], [0.4, 1], [0.7, 0.68]]],
  'ᛜ': [[[0.5, 0.88], [0.76, 0.5], [0.5, 0.12], [0.24, 0.5], [0.5, 0.88]]],
  'ᛞ': [[[0.24, 0.08], [0.24, 0.92], [0.76, 0.08], [0.76, 0.92], [0.24, 0.08]]],
  'ᛟ': [[[0.26, 0], [0.74, 0.52], [0.5, 0.9], [0.26, 0.52], [0.74, 0]]],
};
export const FUTHARK = Object.keys(GLYPHS);
/** Extra ornaments stored after the runes. */
export const GLYPH_RING = FUTHARK.length;      // a knotted ring
export const GLYPH_KNOT = FUTHARK.length + 1;  // valknut
export const GLYPH_GLOW = FUTHARK.length + 2;  // soft radial glow
export const GLYPH_BAND = FUTHARK.length + 3;  // knotwork braid (tiles horizontally)

export interface RuneAtlas {
  texture: THREE.Texture;
  /** [u0, v0, u1, v1] of a glyph cell. */
  rect(index: number): [number, number, number, number];
  indexOf(rune: string): number;
}

/**
 * R = crisp stroke, G = soft halo. Drawn on a 2D canvas at start-up.
 */
export function makeRuneAtlas(): RuneAtlas {
  const COLS = 8, ROWS = 4, CELL = 128;
  const mk = () => { const c = document.createElement('canvas'); c.width = COLS * CELL; c.height = ROWS * CELL; return c; };
  const sharp = mk(), soft = mk();
  const draw = (cv: HTMLCanvasElement, glow: boolean) => {
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (glow) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 20; }
    const cell = (i: number, fn: (px: (x: number) => number, py: (y: number) => number) => void) => {
      const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
      ctx.save();
      ctx.beginPath(); ctx.rect(cx, cy, CELL, CELL); ctx.clip();
      const pad = CELL * 0.2;
      fn((x) => cx + pad + x * (CELL - pad * 2), (y) => cy + CELL - pad - y * (CELL - pad * 2));
      ctx.restore();
    };
    const passes = glow ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      FUTHARK.forEach((r, i) => cell(i, (px, py) => {
        ctx.lineWidth = glow ? 11 : 8.5;
        for (const s of GLYPHS[r]) {
          ctx.beginPath();
          s.forEach(([x, y], k) => (k ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
          ctx.stroke();
        }
      }));
      cell(GLYPH_RING, (px, py) => {
        ctx.lineWidth = glow ? 8 : 6;
        ctx.beginPath(); ctx.arc(px(0.5), py(0.5), CELL * 0.27, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = glow ? 5 : 3.5;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(px(0.5) + Math.cos(a) * CELL * 0.18, py(0.5) + Math.sin(a) * CELL * 0.18);
          ctx.lineTo(px(0.5) + Math.cos(a + 0.5) * CELL * 0.27, py(0.5) + Math.sin(a + 0.5) * CELL * 0.27);
          ctx.stroke();
        }
      });
      cell(GLYPH_KNOT, (px, py) => {
        ctx.lineWidth = glow ? 7 : 5;
        for (let k = 0; k < 3; k++) {
          const a0 = -Math.PI / 2 + (k / 3) * Math.PI * 2;
          const ox = px(0.5) + Math.cos(a0) * CELL * 0.1, oy = py(0.47) + Math.sin(a0) * CELL * 0.1;
          ctx.beginPath();
          for (let j = 0; j <= 3; j++) {
            const a = -Math.PI / 2 + (j / 3) * Math.PI * 2;
            const x = ox + Math.cos(a) * CELL * 0.2, y = oy + Math.sin(a) * CELL * 0.2;
            j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
      });
      cell(GLYPH_BAND, (px, py) => {
        // two-strand braid, exactly two periods across the cell so it tiles
        ctx.lineWidth = glow ? 9 : 7;
        const x0 = px(0) - CELL * 0.2, wdt = CELL;
        for (let s = 0; s < 2; s++) {
          ctx.beginPath();
          for (let k = 0; k <= 48; k++) {
            const t = k / 48;
            const x = x0 + t * wdt, y = py(0.5) + Math.sin(t * Math.PI * 4 + s * Math.PI) * CELL * 0.17;
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
        ctx.lineWidth = glow ? 4 : 3;
        for (const yy of [0.04, 0.96]) { ctx.beginPath(); ctx.moveTo(x0, py(yy)); ctx.lineTo(x0 + wdt, py(yy)); ctx.stroke(); }
      });
    }
    // radial glow cell
    {
      const i = GLYPH_GLOW, cx = (i % COLS) * CELL + CELL / 2, cy = Math.floor(i / COLS) * CELL + CELL / 2;
      ctx.shadowBlur = 0;
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, CELL * 0.5);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
      gr.addColorStop(0.6, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
    }
  };
  draw(sharp, false); draw(soft, true);
  const a = sharp.getContext('2d')!.getImageData(0, 0, sharp.width, sharp.height).data;
  const b = soft.getContext('2d')!.getImageData(0, 0, soft.width, soft.height).data;
  const w = sharp.width, h = sharp.height;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const src = (y * w + x) * 4, dst = ((h - 1 - y) * w + x) * 4; // flip so v runs upward
    data[dst] = a[src]; data[dst + 1] = b[src]; data[dst + 2] = 0; data[dst + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4; texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return {
    texture,
    rect(index: number) {
      const cx = index % COLS, cy = Math.floor(index / COLS);
      return [cx / COLS, 1 - (cy + 1) / ROWS, (cx + 1) / COLS, 1 - cy / ROWS];
    },
    indexOf(rune: string) { const i = FUTHARK.indexOf(rune); return i < 0 ? 0 : i; },
  };
}

/**
 * Grass card: a row of tapered blades. RGB = blade shade (root dark, tip pale), A = coverage.
 */
export function makeGrassTexture(): THREE.Texture {
  const Wd = 256, Hd = 128;
  const cv = document.createElement('canvas');
  cv.width = Wd; cv.height = Hd;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, Wd, Hd);
  const blades = 46;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < blades; i++) {
    const r = (k: number) => hash2(i, k, 811 + pass * 7);
    const x0 = 8 + ((i + r(1) * 0.9) / blades) * (Wd - 16);
    const hgt = Hd * (0.36 + r(2) * 0.62) * (pass ? 0.66 : 1);
    const lean = (r(3) - 0.5) * 40;
    const w0 = 1.7 + r(4) * 1.7;
    const shade = Math.round(150 + r(5) * 105);
    const tipX = x0 + lean, tipY = Hd - hgt;
    const cx = x0 + lean * 0.25, cy = Hd - hgt * 0.6;
    const grad = ctx.createLinearGradient(0, Hd, 0, tipY);
    grad.addColorStop(0, `rgb(${shade * 0.56 | 0},${shade * 0.56 | 0},${shade * 0.56 | 0})`);
    grad.addColorStop(1, `rgb(${shade},${shade},${shade})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0 - w0, Hd + 2);
    ctx.quadraticCurveTo(cx - w0 * 0.7, cy, tipX, tipY);
    ctx.quadraticCurveTo(cx + w0 * 0.7, cy, x0 + w0, Hd + 2);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Fir bough card: u runs from the trunk (0) to the tip (1), the spine lies along v = 0.5.
 * Needled twigs in dark greens with snow lying along the spine and the upper twigs.
 */
export function makeBoughTexture(): THREE.Texture {
  const Wd = 512, Hd = 256, S = 2;
  const cv = document.createElement('canvas');
  cv.width = Wd; cv.height = Hd;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, Wd, Hd);
  ctx.lineCap = 'round';
  const greens = ['#123821', '#1b4a2b', '#266238', '#327a44', '#16402a'];
  const profile = (u: number) => Math.pow(Math.sin(Math.min(1, u * 1.08) * Math.PI), 0.55) * (1 - u * 0.35);
  const twigs = 40;
  const snow: [number, number, number][] = [];
  for (let i = 0; i < twigs; i++) for (const side of [-1, 1]) {
    const r = (k: number) => hash2(i * 2 + (side > 0 ? 1 : 0), k, 613);
    const u = (i + r(1) * 0.8) / twigs;
    const x0 = 8 * S + u * (Wd - 22 * S), y0 = Hd / 2;
    const len = (Hd * 0.46) * profile(u) * (0.72 + r(2) * 0.4);
    const ang = (0.72 + r(3) * 0.4) * side; // swept toward the tip
    const dx = Math.cos(ang), dy = Math.sin(ang);
    ctx.strokeStyle = greens[Math.floor(r(4) * greens.length)];
    ctx.lineWidth = 2.6 * S;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + dx * len, y0 + dy * len); ctx.stroke();
    // needles along the twig
    const n = Math.max(3, Math.round(len / (3.2 * S)));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = x0 + dx * len * t, py = y0 + dy * len * t;
      const nl = (5 + r(10 + k) * 5) * S;
      ctx.strokeStyle = greens[Math.floor(hash2(i, k, 617 + side) * greens.length)];
      ctx.lineWidth = 1.5 * S;
      for (const s2 of [-1, 1]) {
        const a2 = ang + s2 * (0.55 + r(20 + k) * 0.3);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a2) * nl, py + Math.sin(a2) * nl); ctx.stroke();
      }
      if (t < 0.7 && hash2(i * 7 + k, side + 3, 619) < 0.36 * (1 - t)) snow.push([px, py, (4 + r(30 + k) * 6) * S]);
    }
  }
  // spine
  ctx.strokeStyle = '#0f2a1a'; ctx.lineWidth = 4 * S;
  ctx.beginPath(); ctx.moveTo(2, Hd / 2); ctx.lineTo(Wd - 16 * S, Hd / 2); ctx.stroke();
  // snow: soft clumps on the twigs, a ridge along the spine
  for (let i = 0; i < 30; i++) snow.push([10 * S + hash2(i, 1, 621) * (Wd - 70 * S), Hd / 2 + (hash2(i, 2, 621) - 0.5) * 16 * S, (5 + hash2(i, 3, 621) * 7) * S]);
  ctx.globalCompositeOperation = 'source-atop'; // snow only where there is foliage
  for (const [x, y, rad] of snow) {
    const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(236,243,253,1)'); gr.addColorStop(0.72, 'rgba(222,232,249,0.96)'); gr.addColorStop(1, 'rgba(205,218,242,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  return tex;
}
