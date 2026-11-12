// Shared plumbing for the environment: quality table, uniforms shared by every environment
// material, a small mesh builder used to merge all static geometry, and a few numeric helpers.
import * as THREE from 'three';
import { fbm2, hash2 } from '@shared/math';
import type { QualityLevel } from '../../settings';

// ----------------------------------------------------------------------------------------------
// Art-direction constants
// ----------------------------------------------------------------------------------------------

/** Unit vector pointing from the world TO the moon (south-south-east, so its light spills through the hall door). */
export const MOON_DIR = new THREE.Vector3(0.36, 0.60, 0.72).normalize();
/** Horizontal unit vector toward the ember glow on the horizon (west-south-west). */
export const SUNSET_DIR = new THREE.Vector3(-0.92, 0, 0.39).normalize();

export const MOON_COLOR = new THREE.Color(0.60, 0.74, 1.0);
export const WARM_COLOR = new THREE.Color(1.0, 0.50, 0.16);
export const RUNE_GOLD = new THREE.Color(1.0, 0.66, 0.24);

/** Number of analytic "warm light" slots evaluated by the environment shaders. */
export const MAX_WARM = 24;

// ----------------------------------------------------------------------------------------------
// Quality
// ----------------------------------------------------------------------------------------------

export interface EnvQuality {
  shadowSize: number;
  /** Half-extent of the shadow box around the focus (metres). */
  shadowRange: number;
  /** Fraction of grass tufts drawn. */
  grass: number;
  snowFlakes: number;
  /** Cloud-sea parallax iterations (0 = flat shading). */
  cloudSteps: number;
  /** Sky shader detail: 0 gradient + moon, 1 + stars, 2 + cirrus and star dust. */
  skyDetail: number;
  auroraRibbons: number;
  wisps: number;
  farRocks: number;
  /** Analytic warm lights evaluated per pixel. */
  warmLights: number;
  pebbles: number;
  embers: boolean;
  anisotropy: number;
}

export const ENV_QUALITY: Record<QualityLevel, EnvQuality> = {
  low: { shadowSize: 1024, shadowRange: 46, grass: 0.3, snowFlakes: 1400, cloudSteps: 0, skyDetail: 0, auroraRibbons: 1, wisps: 8, farRocks: 10, warmLights: 0, pebbles: 0.25, embers: false, anisotropy: 1 },
  medium: { shadowSize: 1536, shadowRange: 56, grass: 0.42, snowFlakes: 3600, cloudSteps: 2, skyDetail: 1, auroraRibbons: 2, wisps: 16, farRocks: 18, warmLights: MAX_WARM, pebbles: 0.6, embers: true, anisotropy: 4 },
  high: { shadowSize: 2048, shadowRange: 66, grass: 0.72, snowFlakes: 7000, cloudSteps: 4, skyDetail: 2, auroraRibbons: 3, wisps: 26, farRocks: 28, warmLights: MAX_WARM, pebbles: 1, embers: true, anisotropy: 8 },
  ultra: { shadowSize: 4096, shadowRange: 84, grass: 1, snowFlakes: 12000, cloudSteps: 6, skyDetail: 2, auroraRibbons: 4, wisps: 36, farRocks: 40, warmLights: MAX_WARM, pebbles: 1, embers: true, anisotropy: 16 },
};

// ----------------------------------------------------------------------------------------------
// Uniforms shared by every environment material (one object, so one update reaches them all)
// ----------------------------------------------------------------------------------------------

export interface SharedUniforms {
  uTime: { value: number };
  /** xy = wind direction in (x, z), z = strength 0..1, w = accumulated gust phase. */
  uWind: { value: THREE.Vector4 };
  uRockTex: { value: THREE.Texture | null };
  uDetailTex: { value: THREE.Texture | null };
  uWarmPos: { value: THREE.Vector4[] };
  uWarmCol: { value: THREE.Vector3[] };
  uMoonDir: { value: THREE.Vector3 };
  /** Scales snow sparkle / ice glints (drops in bad weather). */
  uSparkle: { value: number };
  /** Extra snow cover from the weather 0..1. */
  uSnowfall: { value: number };
}

export function makeSharedUniforms(): SharedUniforms {
  const pos: THREE.Vector4[] = [], col: THREE.Vector3[] = [];
  for (let i = 0; i < MAX_WARM; i++) { pos.push(new THREE.Vector4(0, -1000, 0, 1)); col.push(new THREE.Vector3()); }
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector4(1, 0, 0.2, 0) },
    uRockTex: { value: null },
    uDetailTex: { value: null },
    uWarmPos: { value: pos },
    uWarmCol: { value: col },
    uMoonDir: { value: MOON_DIR.clone() },
    uSparkle: { value: 1 },
    uSnowfall: { value: 0 },
  };
}

// ----------------------------------------------------------------------------------------------
// Numeric helpers
// ----------------------------------------------------------------------------------------------

export type RGB = [number, number, number];

export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleRGB = (a: RGB, s: number): RGB => [a[0] * s, a[1] * s, a[2] * s];
/** 0xRRGGBB (sRGB) to linear RGB. */
export const hexRGB = (hex: number): RGB => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

/** Cheap 3D-ish noise built from the shared 2D fbm (enough for displacing rock faces). */
export const fbm3 = (x: number, y: number, z: number, oct = 3, seed = 0): number =>
  (fbm2(x + y * 0.37, z - y * 0.29, oct, seed) + fbm2(y * 0.9 + z * 0.31, x * 0.83 - 5.3, oct, seed + 91)) * 0.5;

export const rnd = (i: number, seed: number): number => hash2(i, 1013, seed);

/** three.js' ACES filmic curve, on the CPU (used to pre-tone-map the fog colour for the direct-to-screen path). */
export function acesFilmic(c: THREE.Color, exposure: number): THREE.Color {
  const s = exposure / 0.6;
  const r0 = c.r * s, g0 = c.g * s, b0 = c.b * s;
  let r = 0.59719 * r0 + 0.35458 * g0 + 0.04823 * b0;
  let g = 0.07600 * r0 + 0.90834 * g0 + 0.01566 * b0;
  let b = 0.02840 * r0 + 0.13383 * g0 + 0.83777 * b0;
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  r = fit(r); g = fit(g); b = fit(b);
  const cl = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return c.setRGB(
    cl(1.60475 * r - 0.53108 * g - 0.07367 * b),
    cl(-0.10208 * r + 1.10813 * g - 0.00605 * b),
    cl(-0.00327 * r - 0.07276 * g + 1.07602 * b),
  );
}

export const nextFrame = (): Promise<void> => new Promise((res) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => res());
  else setTimeout(res, 0);
});

// ----------------------------------------------------------------------------------------------
// Mesh builder
// ----------------------------------------------------------------------------------------------

/**
 * Accumulates indexed triangles with per-vertex colour, uv and the `aSurf` material parameters
 * understood by the environment surface shader:
 *   aSurf.x  snow cover 0..1        aSurf.y  moss 0..1
 *   aSurf.z  masonry course height / plank width in metres (0 = none; wood: plank width; foliage: sway phase)
 *   aSurf.w  stone: 0 natural rock .. 1 dressed stone; foliage: sway weight
 * Vertices that are shared between triangles are smooth-shaded; duplicate them for a hard edge.
 */
export class Geo {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  surf: number[] = [];
  idx: number[] = [];
  /** Explicit normals (only when every vertex was added through `vn`). */
  nrm: number[] = [];
  private cr = 1; private cg = 1; private cb = 1;
  private s0 = 0; private s1 = 0; private s2 = 0; private s3 = 0;

  get count(): number { return this.pos.length / 3; }
  get triangles(): number { return this.idx.length / 3; }

  color(c: RGB): this { this.cr = c[0]; this.cg = c[1]; this.cb = c[2]; return this; }
  surface(snow: number, moss = 0, masonry = 0, w = 0): this { this.s0 = snow; this.s1 = moss; this.s2 = masonry; this.s3 = w; return this; }

  v(x: number, y: number, z: number, u = 0, v = 0): number {
    this.pos.push(x, y, z);
    this.col.push(this.cr, this.cg, this.cb);
    this.uv.push(u, v);
    this.surf.push(this.s0, this.s1, this.s2, this.s3);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, a, c, d); }

  /**
   * Connect two rings of `n` vertices starting at indices `upper` and `lower`. Rings must run in
   * "theta order" (x toward z); faces then point outward.
   */
  bridge(upper: number, lower: number, n: number, closed: boolean): void {
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      this.idx.push(upper + i, upper + j, lower + i, upper + j, lower + j, lower + i);
    }
  }

  /** Flat-shaded triangle with its own vertices. */
  flatTri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const a = this.v(ax, ay, az), b = this.v(bx, by, bz), c = this.v(cx, cy, cz);
    this.idx.push(a, b, c);
  }

  /** Flat quad with its own vertices; uv spans (0,0)-(1,1) scaled by (su, sv). */
  flatQuad(p0: number[], p1: number[], p2: number[], p3: number[], su = 1, sv = 1): void {
    const a = this.v(p0[0], p0[1], p0[2], 0, 0), b = this.v(p1[0], p1[1], p1[2], su, 0);
    const c = this.v(p2[0], p2[1], p2[2], su, sv), d = this.v(p3[0], p3[1], p3[2], 0, sv);
    this.idx.push(a, b, c, a, c, d);
  }

  /** Append another builder, optionally transformed. */
  append(g: Geo, m?: THREE.Matrix4): void {
    const base = this.count;
    if (m) {
      const e = m.elements;
      for (let i = 0; i < g.pos.length; i += 3) {
        const x = g.pos[i], y = g.pos[i + 1], z = g.pos[i + 2];
        this.pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
    } else for (let i = 0; i < g.pos.length; i++) this.pos.push(g.pos[i]);
    for (let i = 0; i < g.col.length; i++) this.col.push(g.col[i]);
    for (let i = 0; i < g.uv.length; i++) this.uv.push(g.uv[i]);
    for (let i = 0; i < g.surf.length; i++) this.surf.push(g.surf[i]);
    for (let i = 0; i < g.idx.length; i++) this.idx.push(g.idx[i] + base);
  }

  /** Append a three.js geometry (positions + indices), using the current colour / surface. */
  appendGeometry(geom: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const base = this.count;
    const p = geom.getAttribute('position');
    const uvA = geom.getAttribute('uv');
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (m) v.applyMatrix4(m);
      this.v(v.x, v.y, v.z, uvA ? uvA.getX(i) : 0, uvA ? uvA.getY(i) : 0);
    }
    const ix = geom.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) this.idx.push(ix.getX(i) + base);
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aSurf', new THREE.BufferAttribute(new Float32Array(this.surf), 4));
    const n = this.count;
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Translation + yaw (collider convention: local +x = (cos yaw, sin yaw) in world x/z). */
export function placeMatrix(x: number, y: number, z: number, yaw: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.makeRotationY(-yaw).setPosition(x, y, z);
}
