// Dresses every arena collider according to its kind. HARD RULE: the walkable top of each
// dressed shape is exactly the collider's top (see shapes.prism); sides stay within ~0.25 m.
// Anything added without a collider is either tiny, overhead / under a deck, or out of reach.
import * as THREE from 'three';
import { clamp, clamp01, fbm2, hash2, lerp } from '@shared/math';
import { ELEMENTS, type ElementId } from '@shared/elements';
import { VOID, colliderContains, colliderTop, type Collider, type World } from '@shared/world';
import { Geo, RUNE_GOLD, hexRGB, mixRGB, placeMatrix, scaleRGB, type RGB } from './common';
import { beam, boxOutline, cylOutline, lathe, ngonOutline, polyOutline, prism, quadOut, spike, tube, type OutlinePt } from './shapes';
import { FUTHARK, GLYPH_BAND, GLYPH_GLOW, GLYPH_KNOT, GLYPH_RING, type RuneAtlas } from './textures';

export type BatchMaterial = 'stone' | 'wood' | 'ice' | 'foliage' | 'metal';

export interface WarmSource {
  x: number; y: number; z: number;
  radius: number;
  color: RGB;
  /** 'fire' flickers and can host the roaming point light. */
  kind: 'fire' | 'rune';
}

export interface FloatingCrystal { x: number; y: number; z: number; size: number; color: RGB; orbit: number; speed: number; phase: number }

const HALL_KINDS = new Set(['hallfloor', 'hallwall', 'hallroof', 'halllintel', 'timber', 'firepit', 'bench', 'table', 'pedestal', 'highdais', 'throne', 'terrace', 'ring', 'gatepost', 'rampart']);
export const isHallCollider = (c: Collider): boolean => HALL_KINDS.has(c.kind) || (c.kind === 'bridge' && c.z < -100);

// palette (linear albedo multipliers; the surface shader adds the texture)
const ROCK: RGB = [0.215, 0.208, 0.262];
const STONE: RGB = [0.34, 0.33, 0.335];
const STONE_WARM: RGB = [0.37, 0.34, 0.31];
const WOOD: RGB = [0.26, 0.17, 0.105];
const WOOD_DARK: RGB = [0.14, 0.098, 0.07];
const BARK: RGB = [0.13, 0.095, 0.075];
const ICE: RGB = [0.28, 0.6, 0.85];
const PINE_DARK: RGB = [0.03, 0.062, 0.042];
const GOLD: RGB = [RUNE_GOLD.r, RUNE_GOLD.g, RUNE_GOLD.b];
const FIRE: RGB = [1.0, 0.46, 0.13];

/** Glowing decal quads on the rune atlas. */
export class RuneBatch {
  pos: number[] = []; uv: number[] = []; col: number[] = []; pulse: number[] = []; idx: number[] = [];
  constructor(private atlas: RuneAtlas) {}

  /** centre, unit right / up vectors, size, glyph index, HDR colour. `tile` repeats the glyph horizontally. */
  quad(c: number[], right: number[], up: number[], w: number, h: number, glyph: number, color: RGB, intensity: number, phase: number, depth: number, tile = 1): void {
    const [u0, v0, u1, v1] = this.atlas.rect(glyph);
    const n = Math.max(1, Math.round(tile));
    for (let k = 0; k < n; k++) {
      const a = -w / 2 + (w / n) * k, b = a + w / n;
      const base = this.pos.length / 3;
      const hw = h / 2;
      const P = (s: number, t: number) => this.pos.push(c[0] + right[0] * s + up[0] * t, c[1] + right[1] * s + up[1] * t, c[2] + right[2] * s + up[2] * t);
      P(a, -hw); P(b, -hw); P(b, hw); P(a, hw);
      this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      for (let i = 0; i < 4; i++) { this.col.push(color[0] * intensity, color[1] * intensity, color[2] * intensity); this.pulse.push(phase, depth); }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aPulse', new THREE.BufferAttribute(new Float32Array(this.pulse), 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export interface PropsBuild {
  batches: Map<string, Geo>;
  runes: RuneBatch;
  flames: { x: number; y: number; z: number; scale: number }[];
  warm: WarmSource[];
  icicles: { x: number; y: number; z: number; len: number }[];
  crystals: FloatingCrystal[];
  /** Tiny loose stones: position, size, yaw, tint. */
  pebbles: { x: number; y: number; z: number; s: number; yaw: number; tint: RGB; snow: number }[];
  stats: Record<string, number>;
}

export function regionOf(x: number, z: number): string {
  if (z < -100) return 'h';
  if (x * x + z * z > 70 * 70) return 'o';
  return 'a' + (x > 0 ? 1 : 0) + (z > 0 ? 2 : 0);
}

export function dressColliders(world: World, atlas: RuneAtlas): PropsBuild {
  const out: PropsBuild = { batches: new Map(), runes: new RuneBatch(atlas), flames: [], warm: [], icicles: [], crystals: [], pebbles: [], stats: {} };
  const batch = (mat: BatchMaterial, x: number, z: number): Geo => {
    const key = `${mat}|${regionOf(x, z)}`;
    let g = out.batches.get(key);
    if (!g) out.batches.set(key, (g = new Geo()));
    return g;
  };
  const M = new THREE.Matrix4();
  const rnd = (c: Collider, i: number) => hash2(c.seed & 0xffff, i, (c.seed >>> 16) & 0xffff);
  const snowAt = (x: number, z: number, bias = 0) => clamp01(0.3 + world.biomeAt(x, z).snow * 0.75 + bias);
  /** Local (collider frame) to world. */
  const L2W = (c: Collider, lx: number, y: number, lz: number): number[] => {
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    return [c.x + lx * cs - lz * sn, y, c.z + lx * sn + lz * cs];
  };
  const LDIR = (c: Collider, lx: number, lz: number): number[] => {
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    return [lx * cs - lz * sn, 0, lx * sn + lz * cs];
  };
  const UP = [0, 1, 0];

  /** Terrain heights around the footprint. */
  const ground = (c: Collider) => {
    let min = Infinity, max = -Infinity, anyVoid = false;
    for (let i = 0; i <= 12; i++) {
      let lx = 0, lz = 0;
      if (i < 12) {
        const a = (i / 12) * Math.PI * 2;
        if (c.shape === 'cyl') { lx = Math.cos(a) * c.hx; lz = Math.sin(a) * c.hx; }
        else { lx = clamp(Math.cos(a) * 1.5, -1, 1) * c.hx; lz = clamp(Math.sin(a) * 1.5, -1, 1) * c.hz; }
      }
      const p = L2W(c, lx, 0, lz);
      const h = world.terrainHeight(p[0], p[2]);
      if (h <= VOID + 1) anyVoid = true; else { min = Math.min(min, h); max = Math.max(max, h); }
    }
    if (min === Infinity) { min = c.y0; max = c.y0; anyVoid = true; }
    return { min, max, anyVoid };
  };
  const rampTop = (c: Collider) => (x: number, _z: number) => (c.y1b === undefined ? c.y1 : lerp(c.y1, c.y1b, clamp01((x + c.hx) / (2 * c.hx))));
  const rockDisp = (seed: number, amp: number) => (p: OutlinePt, y: number) => {
    // beds 0.5-0.9 m thick that step in and out and dip gently along the face
    const dip = y / 0.68 + fbm2(p.u * 0.06 + seed * 0.01, 0.3, 2, seed & 127) * 3.2 + p.u * 0.012;
    const bed = Math.floor(dip), fr = dip - bed;
    const step = (hash2(bed, seed & 1023, 77) - 0.45) * 1.5;
    const lip = fr > 0.86 ? (fr - 0.86) / 0.14 : 0;        // each bed overhangs the one below a little
    const rough = (fbm2(p.u * 0.5 + seed * 0.013, y * 0.9 + seed * 0.007, 3, seed & 255) - 0.5) * 1.1;
    const notch = Math.max(0, fbm2(p.u * 0.21 + seed * 0.02, 0.7, 2, (seed >> 3) & 255) - 0.62) * -3.2; // vertical clefts
    return amp * (step * 0.62 + rough * 0.5 - lip * 0.5 + notch);
  };
  const chipDisp = (seed: number, amp: number) => (p: OutlinePt, y: number) =>
    -Math.max(0, fbm2(p.u * 1.1 + seed * 0.011, y * 1.3, 2, seed & 255) - 0.52) * amp * 4
    + (fbm2(p.u * 3.1, y * 3.3 + seed * 0.003, 2, 9) - 0.5) * amp * 0.5;
  const place = (dst: Geo, local: Geo, c: Collider) => dst.append(local, placeMatrix(c.x, 0, c.z, c.yaw, M));
  const count = (k: string) => { out.stats[k] = (out.stats[k] || 0) + 1; };

  /** Loose pebbles around the base of a rock or ruin (tiny, purely decorative). */
  const rubbleRing = (c: Collider, n: number, tint: RGB, maxS: number) => {
    const r0 = c.shape === 'cyl' ? c.hx : Math.max(c.hx, c.hz);
    for (let i = 0; i < n; i++) {
      const a = rnd(c, 100 + i) * Math.PI * 2;
      let lx: number, lz: number;
      const d = 0.25 + rnd(c, 200 + i) * 0.9;
      if (c.shape === 'cyl') { lx = Math.cos(a) * (r0 + d); lz = Math.sin(a) * (r0 + d); }
      else {
        const t = rnd(c, 300 + i) * 2 - 1, side = Math.floor(rnd(c, 400 + i) * 4);
        if (side === 0) { lx = c.hx + d; lz = t * c.hz; } else if (side === 1) { lx = -c.hx - d; lz = t * c.hz; }
        else if (side === 2) { lx = t * c.hx; lz = c.hz + d; } else { lx = t * c.hx; lz = -c.hz - d; }
      }
      const p = L2W(c, lx, 0, lz);
      const y = world.topAt(p[0], p[2]);
      if (y <= VOID + 1) continue;
      // only on terrain or a broad floor, never perched on another prop
      const th = world.terrainHeight(p[0], p[2]);
      if (Math.abs(y - th) > 0.02 && y - th > 1.3) continue;
      const s = 0.06 + rnd(c, 500 + i) * rnd(c, 600 + i) * maxS * 0.55;
      out.pebbles.push({ x: p[0], y: y + s * 0.2, z: p[2], s, yaw: a * 3, tint: scaleRGB(tint, 0.8 + rnd(c, 700 + i) * 0.4), snow: snowAt(p[0], p[2]) });
    }
  };

  const brazierSpots: { x: number; y: number; z: number; big?: boolean }[] = [];
  /** A brazier on the terrain / a top next to a collider. Skips spots over the void or inside something solid. */
  const wantBrazier = (x: number, z: number, big = false) => {
    const y = world.topAt(x, z);
    if (y <= VOID + 1) return;
    for (const c of world.colliders) {
      if (c.y0 > y + 0.5) continue;
      if (colliderTop(c, x, z) > y + 0.05 && colliderContains(c, x, z, 0.1)) return;
    }
    brazierSpots.push({ x, y, z, big });
  };


  for (const c of world.colliders) {
    if (isHallCollider(c)) continue;
    count(c.kind);
    const gi = ground(c);
    const snow = snowAt(c.x, c.z);
    const local = new Geo();
    const groundBottom = Math.max(c.y0, gi.min - 0.5);

    switch (c.kind) {
      // ------------------------------------------------------------------ natural rock
      case 'rock': {
        const r = Math.max(c.hx, c.hz);
        const big = r > 4;
        const tint = scaleRGB(mixRGB(ROCK, [0.3, 0.27, 0.27], rnd(c, 1) * 0.5), 0.9 + rnd(c, 2) * 0.25);
        let o: OutlinePt[];
        if (c.shape === 'cyl') {
          if (big) o = cylOutline(c.hx, Math.round((c.hx * 6.283) / 1.15), rnd(c, 3) * 6.28);
          else {
            const n = 8 + Math.floor(rnd(c, 4) * 4);
            const corners: [number, number][] = [];
            for (let i = 0; i < n; i++) {
              const a = ((i + (rnd(c, 10 + i) - 0.5) * 0.55) / n) * Math.PI * 2;
              const rr = c.hx * (1.035 - rnd(c, 30 + i) * 0.07);
              corners.push([Math.cos(a) * rr, Math.sin(a) * rr]);
            }
            o = polyOutline(corners, 0.8, true);
          }
        } else o = boxOutline(c.hx, c.hz, 1.15, false);
        const h = c.y1 - groundBottom;
        prism(local, o, {
          top: () => c.y1, bottom: gi.anyVoid ? c.y0 : groundBottom,
          bevel: big ? 0.14 : 0.1, rings: clamp(Math.round(h / 0.28), 3, 20),
          disp: rockDisp(c.seed, big ? 0.24 : 0.17), flare: 0.22,
          topColor: scaleRGB(tint, 1.08), sideColor: tint, sideColorLow: scaleRGB(tint, 0.72),
          topSurf: [snow, 0.35, 0, 0], sideSurf: [snow * 0.9, 0.55, 0, 0],
          cap: gi.anyVoid ? 'taper' : 'none', taperDepth: 2 + r * 0.5, taperSeed: c.seed & 1023,
        });
        place(batch('stone', c.x, c.z), local, c);
        rubbleRing(c, big ? Math.round(r * 2.2) : 4, tint, big ? 0.32 : 0.22);
        break;
      }
      case 'ramp': {
        const top = rampTop(c);
        if (c.surf === 'stone') {
          // the temple stair: a worn slab with tread lines (the surface stays the exact ramp plane)
          prism(local, boxOutline(c.hx, c.hz, 1.0, true), {
            top, bottom: groundBottom, bevel: 0.04, rings: 2, disp: chipDisp(c.seed, 0.05),
            topColor: STONE, sideColor: scaleRGB(STONE, 0.9), topSurf: [snow * 0.7, 0.55, 0, 1], sideSurf: [snow * 0.6, 0.7, 0.4, 1],
            topUvSwap: true,
          });
          local.color(scaleRGB(STONE, 0.42)).surface(0, 0.3, 0, 1);
          const steps = Math.round((2 * c.hx) / 0.42);
          for (let i = 1; i < steps; i++) {
            const x = -c.hx + (i / steps) * 2 * c.hx;
            const y0 = top(x - 0.03, 0) + 0.006, y1 = top(x + 0.03, 0) + 0.006;
            const wob = (hash2(i, 3, c.seed & 255) - 0.5) * 0.3;
            local.flatQuad([x - 0.03, y0, c.hz - 0.08 - Math.abs(wob)], [x + 0.03, y1, c.hz - 0.08 - Math.abs(wob)], [x + 0.03, y1, -c.hz + 0.08 + Math.abs(wob) * 0.5], [x - 0.03, y0, -c.hz + 0.08 + Math.abs(wob) * 0.5]);
          }
        } else {
          const tint = scaleRGB(ROCK, 0.95 + rnd(c, 2) * 0.15);
          prism(local, boxOutline(c.hx, c.hz, 1.1, false), {
            top, bottom: groundBottom, bevel: 0.1, rings: 12, disp: rockDisp(c.seed, 0.22), flare: 0.2,
            topColor: scaleRGB(tint, 1.05), sideColor: tint, sideColorLow: scaleRGB(tint, 0.7),
            topSurf: [snow * 0.8, 0.3, 0, 0], sideSurf: [snow * 0.8, 0.5, 0, 0],
          });
          rubbleRing(c, 7, tint, 0.28);
        }
        place(batch('stone', c.x, c.z), local, c);
        break;
      }
      case 'ledge': {
        const tint = scaleRGB(ROCK, 0.9 + rnd(c, 2) * 0.2);
        prism(local, boxOutline(c.hx, c.hz, 1.0, false), {
          top: rampTop(c), bottom: c.y0, bevel: 0.08, rings: 2, disp: rockDisp(c.seed, 0.16),
          topColor: scaleRGB(tint, 1.05), sideColor: tint, sideColorLow: scaleRGB(tint, 0.65),
          topSurf: [snow, 0.3, 0, 0], sideSurf: [snow * 0.7, 0.4, 0, 0],
          cap: 'taper', taperDepth: 1.5 + rnd(c, 5) * 1.8, taperSeed: c.seed & 1023,
        });
        place(batch('stone', c.x, c.z), local, c);
        for (let i = 0; i < 3; i++) {
          const p = L2W(c, (rnd(c, 40 + i) * 2 - 1) * c.hx * 0.8, 0, (rnd(c, 50 + i) < 0.5 ? -1 : 1) * c.hz * 0.92);
          out.icicles.push({ x: p[0], y: c.y0 + 0.05, z: p[2], len: 0.5 + rnd(c, 60 + i) * 1.0 });
        }
        break;
      }
      case 'stepstone': {
        const tint = scaleRGB(ROCK, 1.0 + rnd(c, 2) * 0.2);
        const n = 9;
        const corners: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const a = ((i + (rnd(c, 10 + i) - 0.5) * 0.4) / n) * Math.PI * 2;
          const rr = c.hx * (1.03 - rnd(c, 30 + i) * 0.05);
          corners.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        prism(local, polyOutline(corners, 0.9, true), {
          top: () => c.y1, bottom: c.y0, bevel: 0.1, rings: 2, disp: rockDisp(c.seed, 0.15),
          topColor: scaleRGB(tint, 1.1), sideColor: tint, sideColorLow: scaleRGB(tint, 0.6),
          topSurf: [snow * 0.8, 0.2, 0, 0], sideSurf: [snow * 0.5, 0.3, 0, 0],
          cap: 'taper', taperDepth: 2.6 + rnd(c, 5) * 1.4, taperSeed: c.seed & 1023,
        });
        place(batch('stone', c.x, c.z), local, c);
        // a faint ward ring: the magic that holds the stone up, and a landing marker in the dusk
        out.runes.quad([c.x, c.y1 + 0.025, c.z], [1, 0, 0], [0, 0, 1], c.hx * 1.7, c.hx * 1.7, GLYPH_RING, [0.35, 0.85, 1.0], 0.55, rnd(c, 7) * 6.28, 0.5);
        out.icicles.push({ x: c.x + c.hx * 0.6, y: c.y0, z: c.z, len: 0.8 }, { x: c.x - c.hx * 0.3, y: c.y0, z: c.z + c.hx * 0.6, len: 0.6 });
        break;
      }
      case 'icecrystal': {
        const tint = mixRGB(ICE, [0.42, 0.5, 0.95], rnd(c, 1) * 0.5);
        const phase = rnd(c, 2) * 6.28;
        // a cut crystal: hexagonal crown (the exact flat top), a girdle that swells a little, a
        // narrower foot, with the rings twisted against each other so the sides break into facets
        {
          const R = c.hx * 1.04, bev = Math.min(0.16, c.hx * 0.13);
          const h = c.y1 - groundBottom;
          const rings: { y: number; r: number; ph: number }[] = [
            { y: c.y1 - bev, r: R, ph: phase },
            { y: c.y1 - h * 0.38, r: R + Math.min(0.2, c.hx * 0.16), ph: phase + Math.PI / 6 },
            { y: groundBottom + h * 0.22, r: R + 0.04, ph: phase },
            { y: groundBottom, r: R - Math.min(0.2, c.hx * 0.18), ph: phase + Math.PI / 6 },
          ];
          const pt = (k: number, i: number): number[] => { const a = rings[k].ph + (i / 6) * Math.PI * 2; return [Math.cos(a) * rings[k].r, rings[k].y, Math.sin(a) * rings[k].r]; };
          const tri = (p: number[], q: number[], r: number[]) => {
            const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
            const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
            const mx = (p[0] + q[0] + r[0]) / 3, mz = (p[2] + q[2] + r[2]) / 3;
            if (nx * mx + nz * mz >= 0) local.flatTri(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
            else local.flatTri(q[0], q[1], q[2], p[0], p[1], p[2], r[0], r[1], r[2]);
          };
          // crown: flat top + bevel
          local.color(scaleRGB(tint, 1.15)).surface(0.55, 0, 0, 0);
          const cT = local.v(0, c.y1, 0);
          const t0 = local.count;
          for (let i = 0; i < 6; i++) { const a = phase + (i / 6) * Math.PI * 2; local.v(Math.cos(a) * (R - bev), c.y1, Math.sin(a) * (R - bev)); }
          for (let i = 0; i < 6; i++) local.tri(cT, t0 + (i + 1) % 6, t0 + i);
          local.surface(0, 0, 0, 0);
          for (let i = 0; i < 6; i++) {
            const a0 = phase + (i / 6) * Math.PI * 2, a1 = phase + ((i + 1) / 6) * Math.PI * 2;
            const p0 = [Math.cos(a0) * (R - bev), c.y1, Math.sin(a0) * (R - bev)], p1 = [Math.cos(a1) * (R - bev), c.y1, Math.sin(a1) * (R - bev)];
            tri(p0, p1, pt(0, i + 1)); tri(p0, pt(0, i + 1), pt(0, i));
          }
          // facets
          for (let k = 0; k < rings.length - 1; k++) {
            local.color(scaleRGB(tint, 1.05 - k * 0.12));
            const off = rings[k + 1].ph > rings[k].ph ? 0 : -1; // lower ring is half a step ahead / behind
            for (let i = 0; i < 6; i++) {
              const a0 = pt(k, i), a1 = pt(k, i + 1), b0 = pt(k + 1, i + off + (off ? 1 : 0)), b1 = pt(k + 1, i + 1 + off + (off ? 1 : 0));
              if (off === 0) { tri(a0, a1, b0); tri(a1, b1, b0); } else { tri(a0, a1, b1); tri(a0, b1, b0); }
            }
          }
        }
        const g = batch('ice', c.x, c.z);
        place(g, local, c);
        // satellite shards hugging the base (tiny)
        g.color(scaleRGB(tint, 1.1)).surface(0, 0, 0, 0);
        for (let i = 0; i < 5; i++) {
          const a = phase + i * 1.31 + rnd(c, 20 + i);
          const d = c.hx + 0.12 + rnd(c, 30 + i) * 0.22;
          const bx = c.x + Math.cos(a) * d, bz = c.z + Math.sin(a) * d;
          const by = world.terrainHeight(bx, bz);
          if (by <= VOID + 1) continue;
          const hgt = 0.22 + rnd(c, 40 + i) * 0.26;
          spike(g, new THREE.Vector3(bx, by - 0.05, bz), new THREE.Vector3(bx + Math.cos(a) * hgt * 0.45, by + hgt, bz + Math.sin(a) * hgt * 0.45), 0.09 + rnd(c, 50 + i) * 0.05, 5, a);
        }
        break;
      }
      // ------------------------------------------------------------------ pines
      case 'tree': {
        const gy = gi.max;
        prism(local, cylOutline(c.hx, 7, rnd(c, 1) * 6), {
          top: () => c.y1, bottom: groundBottom, bevel: 0.02, rings: 5, flare: 0.24, noTop: true,
          disp: (p, y) => (fbm2(p.u * 2.3, y * 0.6, 2, c.seed & 255) - 0.5) * 0.14,
          topColor: BARK, sideColor: BARK, sideColorLow: scaleRGB(BARK, 0.7),
          topSurf: [0, 0, 0, 0], sideSurf: [0, 0.5, 0, 0], uvVertical: true,
        });
        place(batch('wood', c.x, c.z), local, c);
        pineCanopy(batch('foliage', c.x, c.z), c.x, c.z, gy, c.y1, c.seed);
        break;
      }
      // ------------------------------------------------------------------ the Thing-stead
      case 'standing': {
        const tint = scaleRGB(mixRGB(STONE, STONE_WARM, rnd(c, 1)), 0.85 + rnd(c, 2) * 0.25);
        const broad = (p: OutlinePt) => Math.abs(p.nx) > 0.9;
        const chips = chipDisp(c.seed, 0.1);
        prism(local, boxOutline(c.hx, c.hz, 0.5, true), {
          top: () => c.y1, bottom: groundBottom, bevel: 0.07, rings: 6, flare: 0.12,
          disp: (p, y, v) => (broad(p) ? chips(p, y) * 0.25 : chips(p, y)),
          topColor: scaleRGB(tint, 1.05), sideColor: tint, sideColorLow: scaleRGB(tint, 0.75),
          topSurf: [snow, 0.5, 0, 0.7], sideSurf: [snow * 0.6, 0.6, 0, 0.7],
        });
        place(batch('stone', c.x, c.z), local, c);
        const gy = gi.max;
        const right = LDIR(c, 0, -1);
        const hgt = c.y1 - gy;
        const nR = Math.max(2, Math.floor((hgt - 1.1) / 1.08));
        for (let i = 0; i < nR; i++) {
          const y = gy + 1.25 + i * 1.08;
          const glyph = Math.floor(rnd(c, 20 + i) * FUTHARK.length);
          out.runes.quad(L2W(c, -c.hx - 0.035, y, 0), right, UP, 1.15, 1.3, glyph, GOLD, 2.2, rnd(c, 5) * 6.28 + i * 0.9, 0.4);
        }
        out.runes.quad(L2W(c, c.hx + 0.035, gy + 2.2, 0), LDIR(c, 0, 1), UP, 1.5, 1.5, GLYPH_KNOT, GOLD, 0.9, rnd(c, 6) * 6.28, 0.3);
        rubbleRing(c, 3, tint, 0.16);
        break;
      }
      case 'fallen': {
        const tint = scaleRGB(mixRGB(STONE, STONE_WARM, rnd(c, 1)), 0.8 + rnd(c, 2) * 0.2);
        prism(local, boxOutline(c.hx, c.hz, 0.6, true), {
          top: () => c.y1, bottom: groundBottom, bevel: 0.09, rings: 2, flare: 0.1, disp: chipDisp(c.seed, 0.12),
          topColor: tint, sideColor: scaleRGB(tint, 0.9), sideColorLow: scaleRGB(tint, 0.7),
          topSurf: [snow, 0.85, 0, 0.7], sideSurf: [snow * 0.5, 0.9, 0, 0.7],
        });
        place(batch('stone', c.x, c.z), local, c);
        // its runes still smoulder, face up
        for (let i = 0; i < 3; i++) {
          out.runes.quad(L2W(c, -1.3 + i * 1.3, c.y1 + 0.02, 0), LDIR(c, 0, 1), LDIR(c, 1, 0), 1.0, 1.15, Math.floor(rnd(c, 20 + i) * FUTHARK.length), GOLD, 0.55, rnd(c, 5) * 6.28 + i, 0.6);
        }
        rubbleRing(c, 5, tint, 0.2);
        break;
      }
      case 'dais': {
        const tint = scaleRGB(STONE, 0.95);
        prism(local, cylOutline(c.hx, 48), {
          top: () => c.y1, bottom: groundBottom, bevel: 0.05, rings: 1, noTop: true, disp: chipDisp(c.seed, 0.04),
          topColor: tint, sideColor: scaleRGB(tint, 0.9), topSurf: [0, 0, 0, 1], sideSurf: [snow * 0.4, 0.8, 0.26, 1],
        });
        // radial paving: rings of slabs, each its own flat piece at exactly y1
        const radii = [0, 1.05, 2.05, 3.1, c.hx - 0.05];
        const sectors = [1, 7, 11, 16];
        for (let k = 0; k < 4; k++) {
          const r0 = radii[k], r1 = radii[k + 1], m = sectors[k];
          const off = hash2(k, 5, 77) * 6.28;
          for (let s = 0; s < m; s++) {
            const a0 = off + (s / m) * Math.PI * 2, a1 = off + ((s + 1) / m) * Math.PI * 2;
            const shade = 0.78 + hash2(k * 31 + s, 9, 77) * 0.4;
            local.color(scaleRGB(tint, shade)).surface(snow * 0.55, 0.45, 0, 1);
            const sub = Math.max(2, Math.round(((a1 - a0) * r1) / 0.6));
            const gap = 0.022;
            const inner: number[] = [], outer: number[] = [];
            for (let q = 0; q <= sub; q++) {
              const ga0 = r0 > 0 ? gap / r0 : 0, ga1 = gap / r1;
              const ai = lerp(a0 + ga0, a1 - ga0, q / sub), ao = lerp(a0 + ga1, a1 - ga1, q / sub);
              inner.push(local.v(Math.cos(ai) * (r0 + (r0 > 0 ? gap : 0)), c.y1, Math.sin(ai) * (r0 + (r0 > 0 ? gap : 0)), Math.cos(ai) * r0, Math.sin(ai) * r0));
              outer.push(local.v(Math.cos(ao) * (r1 - gap), c.y1, Math.sin(ao) * (r1 - gap), Math.cos(ao) * r1, Math.sin(ao) * r1));
            }
            for (let q = 0; q < sub; q++) local.quad(inner[q], inner[q + 1], outer[q + 1], outer[q]);
          }
        }
        // dark bedding under the joints
        local.color(scaleRGB(tint, 0.3)).surface(0, 0.6, 0, 1);
        {
          const cc = local.v(0, c.y1 - 0.012, 0), st = local.count, n = 40;
          for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; local.v(Math.cos(a) * (c.hx - 0.05), c.y1 - 0.012, Math.sin(a) * (c.hx - 0.05)); }
          for (let i = 0; i < n; i++) local.tri(cc, st + (i + 1) % n, st + i);
        }
        place(batch('stone', c.x, c.z), local, c);
        // knotwork ring and a circle of runes set into the paving
        const nb = 22;
        for (let i = 0; i < nb; i++) {
          const a = (i / nb) * Math.PI * 2;
          const rr = 3.56;
          out.runes.quad([c.x + Math.cos(a) * rr, c.y1 + 0.02, c.z + Math.sin(a) * rr], [-Math.sin(a), 0, Math.cos(a)], [-Math.cos(a), 0, -Math.sin(a)], (2 * Math.PI * rr) / nb, 0.42, GLYPH_BAND, GOLD, 0.5, a * 3, 0.35);
        }
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + 0.13;
          const rr = 2.58;
          out.runes.quad([c.x + Math.cos(a) * rr, c.y1 + 0.02, c.z + Math.sin(a) * rr], [-Math.sin(a), 0, Math.cos(a)], [-Math.cos(a), 0, -Math.sin(a)], 0.5, 0.6, (i * 5 + 3) % FUTHARK.length, GOLD, 1.0, i * 0.52, 0.6);
        }
        for (const a of [0.52, 2.62, 4.71]) wantBrazier(c.x + Math.cos(a) * (c.hx + 0.5), c.z + Math.sin(a) * (c.hx + 0.5), true);
        break;
      }
      case 'monolith': {
        const tint = scaleRGB(STONE, 0.78);
        const sides = 8, rc = c.hx / Math.cos(Math.PI / sides) * 0.985;
        const phase = Math.PI / sides;
        const base = c.y0;
        prism(local, ngonOutline(rc, sides, phase, 2, true), {
          top: () => c.y1, bottom: c.y0 - 0.05, bevel: 0.09, rings: 12, flare: 0.1,
          disp: (p, y) => {
            const hh = y - base;
            const band = Math.abs(((hh + 0.25) % 1.72) - 0.2) < 0.07 ? -0.04 : 0;
            return band - Math.max(0, fbm2(p.u * 1.4, y * 1.1, 2, 91) - 0.6) * 0.2;
          },
          topColor: scaleRGB(tint, 1.1), sideColor: tint, sideColorLow: scaleRGB(tint, 0.85),
          topSurf: [snow, 0.2, 0, 0.85], sideSurf: [snow * 0.3, 0.35, 0, 0.85],
        });
        place(batch('stone', c.x, c.z), local, c);
        const faceW = 2 * rc * Math.sin(Math.PI / sides);
        for (let f = 0; f < sides; f++) {
          const a = (f / sides) * Math.PI * 2; // face normal direction (flats sit between corners at phase)
          const nx = Math.cos(a), nz = Math.sin(a);
          const right = [-nz, 0, nx];
          for (let i = 0; i < 6; i++) {
            const y = base + 0.82 + i * 0.95 + (f % 2) * 0.3;
            if (y > c.y1 - 0.55) continue;
            const glyph = Math.floor(hash2(f * 7 + i, 3, 51) * FUTHARK.length);
            out.runes.quad([c.x + nx * (c.hx * 0.985 + 0.035), y, c.z + nz * (c.hx * 0.985 + 0.035)], right, UP, faceW * 1.25, 0.98, glyph, [1.0, 0.74, 0.34], 2.8, -y * 1.15 + f * 0.785, 0.62);
          }
        }
        out.warm.push({ x: c.x, y: base + 2.6, z: c.z, radius: 14, color: scaleRGB(GOLD, 1.5), kind: 'rune' });
        // a crown of slow-turning shards high above the stone (out of reach)
        for (let i = 0; i < 6; i++) {
          out.crystals.push({ x: c.x, y: c.y1 + 1.5 + (i % 2) * 0.35, z: c.z, size: 0.16 + (i % 3) * 0.05, color: [1.0, 0.72, 0.3], orbit: 0.95 + (i % 2) * 0.2, speed: 0.35, phase: (i / 6) * Math.PI * 2 });
        }
        out.crystals.push({ x: c.x, y: c.y1 + 1.75, z: c.z, size: 0.3, color: [1.0, 0.85, 0.5], orbit: 0, speed: 0.6, phase: 0 });
        break;
      }
      // ------------------------------------------------------------------ ruins
      case 'floor': {
        prism(local, boxOutline(c.hx, c.hz, 2.0, true), {
          top: () => c.y1, bottom: groundBottom, bevel: 0.06, rings: 2, disp: chipDisp(c.seed, 0.06),
          topColor: scaleRGB(STONE, 0.92), sideColor: scaleRGB(STONE, 0.85), sideColorLow: scaleRGB(STONE, 0.6),
          topSurf: [snow * 0.75, 0.6, 0.78, 1], sideSurf: [snow * 0.5, 0.8, 0.5, 1],
        });
        place(batch('stone', c.x, c.z), local, c);
        // a great worn seal in the middle of the floor
        out.runes.quad([c.x, c.y1 + 0.02, c.z + 0.2], [1, 0, 0], [0, 0, -1], 5.2, 5.2, GLYPH_RING, GOLD, 0.42, 1.3, 0.5);
        out.runes.quad([c.x, c.y1 + 0.02, c.z + 0.2], [1, 0, 0], [0, 0, -1], 2.0, 2.0, GLYPH_KNOT, GOLD, 0.6, 0.4, 0.5);
        rubbleRing(c, 26, STONE, 0.34);
        break;
      }
      case 'pillar': {
        const tint = scaleRGB(mixRGB(STONE, STONE_WARM, rnd(c, 1) * 0.6), 0.92 + rnd(c, 2) * 0.16);
        const h = c.y1 - c.y0;
        const broken = h < 6;
        // a faceted shaft of stacked drums on a round plinth; broken ones end in a chipped flat
        const sides = 12, rc = c.hx / Math.cos(Math.PI / sides) * 0.99;
        prism(local, ngonOutline(rc, sides, rnd(c, 3) * 0.5, 2, true), {
          top: () => c.y1, bottom: c.y0 - 0.02, bevel: broken ? 0.08 : 0.05, rings: Math.max(4, Math.round(h / 0.26)),
          disp: (p, y) => {
            const hh = y - c.y0;
            if (hh < 0.3) return 0.2;                       // plinth
            if (hh < 0.44) return 0.2 * (1 - (hh - 0.3) / 0.14);
            const drum = Math.abs((hh % 1.04) - 0.52) > 0.45 ? -0.045 : 0;
            const entasis = -0.05 * clamp01((hh - 0.5) / 6);
            const worn = -Math.max(0, fbm2(p.u * 1.3 + c.seed * 0.01, y * 0.9, 2, c.seed & 255) - 0.62) * 0.22;
            return drum + entasis + worn + (broken && c.y1 - y < 0.3 ? -0.07 * hash2(Math.round(p.u * 3), 3, c.seed & 255) : 0);
          },
          topColor: broken ? scaleRGB(tint, 1.2) : tint, sideColor: tint, sideColorLow: scaleRGB(tint, 0.8),
          topSurf: [snow, 0.3, 0, 1], sideSurf: [snow * 0.3, 0.5, 0, 1],
        });
        place(batch('stone', c.x, c.z), local, c);
        if (broken) rubbleRing(c, 5, tint, 0.3);
        break;
      }
      case 'wall': {
        const tint = scaleRGB(STONE, 0.9 + rnd(c, 2) * 0.15);
        prism(local, boxOutline(c.hx, c.hz, 0.7, true), {
          top: () => c.y1, bottom: Math.max(c.y0, gi.min - 0.2), bevel: 0.06, rings: Math.max(3, Math.round((c.y1 - c.y0) / 0.7)), disp: chipDisp(c.seed, 0.09),
          topColor: scaleRGB(tint, 1.05), sideColor: tint, sideColorLow: scaleRGB(tint, 0.72),
          topSurf: [snow, 0.7, 0, 1], sideSurf: [snow * 0.4, 0.85, 0.44, 1],
        });
        place(batch('stone', c.x, c.z), local, c);
        rubbleRing(c, 6, tint, 0.3);
        for (let i = 0; i < 4; i++) {
          const long = c.hx > c.hz;
          const p = L2W(c, long ? (rnd(c, 40 + i) * 2 - 1) * c.hx * 0.9 : (i % 2 ? 1 : -1) * (c.hx + 0.05), 0, long ? (i % 2 ? 1 : -1) * (c.hz + 0.05) : (rnd(c, 40 + i) * 2 - 1) * c.hz * 0.9);
          out.icicles.push({ x: p[0], y: c.y1 - 0.12, z: p[2], len: 0.25 + rnd(c, 60 + i) * 0.4 });
        }
        break;
      }
      case 'rubble': {
        const tint = scaleRGB(STONE, 0.85 + rnd(c, 2) * 0.2);
        prism(local, boxOutline(c.hx, c.hz, 0.6, true), {
          top: () => c.y1, bottom: groundBottom, bevel: 0.1, rings: 2, flare: 0.08, disp: chipDisp(c.seed, 0.13),
          topColor: scaleRGB(tint, 1.05), sideColor: tint, sideColorLow: scaleRGB(tint, 0.75),
          topSurf: [snow, 0.7, 0, 1], sideSurf: [snow * 0.4, 0.8, 0.5, 1],
        });
        place(batch('stone', c.x, c.z), local, c);
        rubbleRing(c, 6, tint, 0.3);
        break;
      }
      case 'archpost': {
        const tint = scaleRGB(STONE, 0.95);
        const base = c.y0 + 1;
        prism(local, boxOutline(c.hx, c.hz, 0.6, true), {
          top: () => c.y1, bottom: c.y0, bevel: 0.03, rings: 14,
          disp: (p, y) => {
            const hh = y - base;
            if (hh < 0.4) return 0.16;
            if (hh < 0.52) return 0.16 * (1 - (hh - 0.4) / 0.12);
            if (c.y1 - y < 0.36) return 0.14;
            return chipDisp(c.seed, 0.05)(p, y);
          },
          topColor: tint, sideColor: tint, sideColorLow: scaleRGB(tint, 0.8),
          topSurf: [snow, 0.4, 0, 1], sideSurf: [snow * 0.3, 0.6, 0.5, 1],
        });
        place(batch('stone', c.x, c.z), local, c);
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            out.runes.quad(L2W(c, 0, base + 1.5 + i * 1.0, side * (c.hz + 0.035)), LDIR(c, -side, 0), UP, 0.95, 1.05, Math.floor(rnd(c, 20 + i + side * 3 + 3) * FUTHARK.length), GOLD, 1.5, i * 1.1 + c.x, 0.5);
          }
        }
        break;
      }
      case 'lintel': {
        const tint = scaleRGB(STONE, 0.9);
        prism(local, boxOutline(c.hx, c.hz, 0.9, true), {
          top: () => c.y1, bottom: c.y0, bevel: 0.05, rings: 2, disp: chipDisp(c.seed, 0.05), cap: 'flat',
          topColor: tint, sideColor: tint, sideColorLow: scaleRGB(tint, 0.8),
          topSurf: [snow, 0.4, 0, 1], sideSurf: [snow * 0.3, 0.5, 0, 1],
        });
        place(batch('stone', c.x, c.z), local, c);
        const my = (c.y0 + c.y1) / 2;
        for (const side of [-1, 1]) {
          out.runes.quad(L2W(c, 0, my, side * (c.hz + 0.035)), LDIR(c, -side, 0), UP, c.hx * 2 - 0.6, 0.6, GLYPH_BAND, GOLD, 1.1, 0.3, 0.3, 12);
          for (let i = 0; i < 6; i++) out.icicles.push({ x: c.x + (hash2(i, side + 3, 5) * 2 - 1) * (c.hx - 1.4), y: c.y0 + 0.02, z: c.z + side * c.hz * 0.8, len: 0.3 + hash2(i, 9, 5) * 0.5 });
        }
        // tattered pennants hanging in front of the posts, well above head height
        const cloth = batch('foliage', c.x, c.z);
        for (const sx of [-1, 1]) for (const side of [-1, 1]) {
          banner(cloth, L2W(c, sx * (c.hx - 0.8), c.y0 - 0.02, side * (c.hz + 0.09)), LDIR(c, 1, 0), 0.95, 1.5, sx * side > 0 ? [0.3, 0.035, 0.03] : [0.05, 0.09, 0.2], (sx + 2) * 7 + side);
        }
        break;
      }
      // ------------------------------------------------------------------ bridges
      case 'bridge': {
        const top = rampTop(c);
        const yA = c.y1, yB = c.y1b ?? c.y1;
        if (c.surf === 'wood') {
          prism(local, boxOutline(c.hx, c.hz, 2.0, true), {
            top, bottom: Math.min(yA, yB) - 0.2, bevel: 0.015, rings: 1, cap: 'flat', topUvSwap: true,
            topColor: WOOD, sideColor: scaleRGB(WOOD, 0.8), topSurf: [snow * 0.7, 0.6, 0.31, 0], sideSurf: [0, 0.5, 0, 0],
          });
          // stringers, ties and sagging ropes underneath the deck
          local.color(WOOD_DARK).surface(0, 0.6, 0, 0);
          for (const sz of [-1, 1]) {
            beam(local, new THREE.Vector3(-c.hx, yA - 0.36, sz * (c.hz - 0.3)), new THREE.Vector3(c.hx, yB - 0.36, sz * (c.hz - 0.3)), 0.24, 0.3);
            const rope: THREE.Vector3[] = [];
            for (let i = 0; i <= 14; i++) {
              const t = i / 14;
              rope.push(new THREE.Vector3(lerp(-c.hx, c.hx, t), lerp(yA, yB, t) - 0.3 - Math.sin(t * Math.PI) * 1.5, sz * (c.hz + 0.05)));
            }
            local.color([0.2, 0.16, 0.1]);
            tube(local, rope, () => 0.045, 5);
            local.color(WOOD_DARK);
            for (let i = 2; i <= 12; i += 2) local.color([0.2, 0.16, 0.1]), beam(local, new THREE.Vector3(rope[i].x, lerp(yA, yB, i / 14) - 0.2, sz * (c.hz + 0.05)), rope[i], 0.035, 0.035);
          }
          local.color(WOOD_DARK);
          const ties = Math.round(c.hx / 1.1);
          for (let i = -ties; i <= ties; i++) {
            const x = (i / (ties + 0.5)) * c.hx;
            beam(local, new THREE.Vector3(x, top(x, 0) - 0.3, -c.hz - 0.12), new THREE.Vector3(x, top(x, 0) - 0.3, c.hz + 0.12), 0.16, 0.16);
          }
          place(batch('wood', c.x, c.z), local, c);
          for (const sx of [-1, 1]) { const p = L2W(c, sx * (c.hx - 0.7), 0, c.hz + 0.5); wantBrazier(p[0], p[2]); }
        } else if (c.surf === 'ice') {
          const tint = scaleRGB(ICE, 0.95);
          prism(local, boxOutline(c.hx, c.hz, 1.0, false), {
            top, bottom: Math.min(yA, yB) - 0.8, bevel: 0.08, rings: 2, disp: (p, y) => (fbm2(p.u * 0.6, y * 2, 2, 19) - 0.5) * 0.3,
            topColor: scaleRGB(tint, 1.1), sideColor: tint, sideColorLow: scaleRGB(tint, 0.7),
            topSurf: [0.42, 0, 0, 0], sideSurf: [0, 0, 0, 0], cap: 'taper', taperDepth: 1.5, taperSeed: 77,
          });
          place(batch('ice', c.x, c.z), local, c);
          const n = Math.round(c.hx * 2 / 0.7);
          for (let i = 0; i < n; i++) for (const sz of [-1, 1]) {
            if (hash2(i, sz + 2, 31) < 0.3) continue;
            const lx = -c.hx + ((i + 0.5) / n) * 2 * c.hx;
            const p = L2W(c, lx, 0, sz * (c.hz - 0.12));
            out.icicles.push({ x: p[0], y: top(lx, 0) - 0.75, z: p[2], len: 0.5 + hash2(i, sz + 5, 31) * 1.3 });
          }
          { const p = L2W(c, -c.hx + 0.7, 0, c.hz + 0.5); wantBrazier(p[0], p[2]); }
        } else {
          // stone span: paved deck over a hanging arch
          const tint = scaleRGB(STONE, 0.9);
          prism(local, boxOutline(c.hx, c.hz, 1.2, true), {
            top, bottom: Math.min(yA, yB) - 0.7, bevel: 0.04, rings: 2, disp: chipDisp(c.seed, 0.05),
            topColor: tint, sideColor: scaleRGB(tint, 0.9), topSurf: [snow * 0.7, 0.5, 0.6, 1], sideSurf: [snow * 0.3, 0.7, 0.36, 1], topUvSwap: true,
          });
          local.color(scaleRGB(tint, 0.8)).surface(0, 0.7, 0.36, 1);
          const N = 18, zz = c.hz - 0.04;
          const yb = (s: number) => lerp(yA, yB, (s + 1) / 2) - 0.7;
          const arch = (s: number) => yb(s) - 0.15 - 2.7 * Math.pow(Math.abs(s), 2.3);
          for (let i = 0; i < N; i++) {
            const s0 = -1 + (2 * i) / N, s1 = -1 + (2 * (i + 1)) / N;
            const x0 = s0 * c.hx, x1 = s1 * c.hx;
            const cy = (yb(s0) + arch(s0)) / 2;
            for (const sz of [-1, 1]) {
              quadOut(local, [x0, yb(s0), sz * zz], [x1, yb(s1), sz * zz], [x1, arch(s1), sz * zz], [x0, arch(s0), sz * zz], (x0 + x1) / 2, cy, 0, 1, 1);
              // rewrite the uvs of that quad to metres so the courses line up
              const b = local.count - 4;
              for (let k = 0; k < 4; k++) { local.uv[(b + k) * 2] = local.pos[(b + k) * 3]; local.uv[(b + k) * 2 + 1] = local.pos[(b + k) * 3 + 1]; }
            }
            quadOut(local, [x0, arch(s0), -zz], [x1, arch(s1), -zz], [x1, arch(s1), zz], [x0, arch(s0), zz], (x0 + x1) / 2, cy, 0, 1, 1);
          }
          place(batch('stone', c.x, c.z), local, c);
          for (const sz of [-1, 1]) {
            out.runes.quad(L2W(c, 0, (yA + yB) / 2 - 0.42, sz * (c.hz + 0.03)), LDIR(c, -sz, 0), UP, 0.6, 0.6, GLYPH_KNOT, GOLD, 1.3, 2.0, 0.4);
            for (let i = 0; i < 8; i++) {
              const s = (hash2(i, sz + 2, 63) * 2 - 1) * 0.8;
              const p = L2W(c, s * c.hx, 0, sz * (c.hz - 0.15));
              out.icicles.push({ x: p[0], y: arch(s) + 0.03, z: p[2], len: 0.4 + hash2(i, sz + 7, 63) * 0.9 });
            }
          }
          for (const sx of [-1, 1]) { const p = L2W(c, sx * (c.hx - 0.6), 0, c.hz + 0.5); wantBrazier(p[0], p[2]); }
        }
        break;
      }
      // ------------------------------------------------------------------ the wreck
      case 'ship': {
        buildShip(c, gi.min, batch, out, L2W, M);
        break;
      }
      case 'mast': {
        const deck = (() => { for (const o of world.colliders) if (o.kind === 'ship' && colliderContains(o, c.x, c.z, 0)) return o.y1; return gi.max; })();
        prism(local, cylOutline(c.hx, 9, 0.3), {
          top: () => c.y1, bottom: deck - 0.1, bevel: 0.03, rings: 8,
          disp: (p, y) => (fbm2(p.u * 2, y * 0.4, 2, 7) - 0.5) * 0.05,
          topColor: scaleRGB(WOOD, 1.3), sideColor: WOOD, sideColorLow: scaleRGB(WOOD, 0.8),
          topSurf: [0.5, 0.6, 0, 0], sideSurf: [0, 0.8, 0, 0], uvVertical: true,
        });
        const g = batch('wood', c.x, c.z);
        place(g, local, c);
        // splintered break at the top (thin, and far above anyone's head)
        g.color(scaleRGB(WOOD, 1.25)).surface(0, 0.3, 0, 0);
        for (let i = 0; i < 6; i++) {
          const a = i * 1.05 + 0.3, r = c.hx * 0.6;
          spike(g, new THREE.Vector3(c.x + Math.cos(a) * r, c.y1 - 0.05, c.z + Math.sin(a) * r), new THREE.Vector3(c.x + Math.cos(a) * r * 1.5, c.y1 + 0.25 + hash2(i, 3, 9) * 0.45, c.z + Math.sin(a) * r * 1.5), 0.09, 3, a);
        }
        // mast partner collar at the deck
        g.color(WOOD_DARK).surface(0.3, 0.6, 0, 0);
        lathe(g, c.x, c.z, [[c.hx + 0.02, deck + 0.24], [c.hx + 0.2, deck + 0.2], [c.hx + 0.24, deck + 0.012]], 10);
        break;
      }
      // ------------------------------------------------------------------ shrines
      case 'shrine': {
        const el = ELEMENTS[(c.tag as ElementId)] ?? ELEMENTS.ember;
        const col = hexRGB(el.color), core = hexRGB(el.core);
        const base = c.y1 - 2.7;
        const tint = scaleRGB(mixRGB(STONE, col, 0.06), 0.78);
        const sides = 6, rc = c.hx * 1.06, phase = Math.PI / 6;
        prism(local, ngonOutline(rc, sides, phase, 2, true), {
          top: () => c.y1, bottom: Math.max(c.y0, base - 0.4), bevel: 0.08, rings: 10, flare: 0.1,
          disp: (p, y) => {
            const hh = y - base;
            if (hh < 0.3) return 0.18;
            if (hh < 0.42) return 0.18 * (1 - (hh - 0.3) / 0.12);
            if (Math.abs(hh - 1.28) < 0.05 || Math.abs(hh - 2.28) < 0.05) return -0.04;
            return -Math.max(0, fbm2(p.u * 1.6, y * 1.2, 2, c.seed & 255) - 0.6) * 0.2;
          },
          topColor: scaleRGB(tint, 1.1), sideColor: tint, sideColorLow: scaleRGB(tint, 0.8),
          topSurf: [snow, 0.2, 0, 0.9], sideSurf: [snow * 0.25, 0.4, 0, 0.9],
        });
        place(batch('stone', c.x, c.z), local, c);
        const glyph = atlas.indexOf(el.rune);
        const flat = rc * Math.cos(Math.PI / sides);
        const faceW = 2 * rc * Math.sin(Math.PI / sides);
        for (let f = 0; f < sides; f++) {
          const a = (f / sides) * Math.PI * 2;
          const nx = Math.cos(a), nz = Math.sin(a);
          out.runes.quad([c.x + nx * (flat + 0.035), base + 1.78, c.z + nz * (flat + 0.035)], [-nz, 0, nx], UP, faceW * 1.3, 1.1, glyph, col, 3.0, f * 1.05, 0.35);
          out.runes.quad([c.x + nx * (flat + 0.035), base + 0.86, c.z + nz * (flat + 0.035)], [-nz, 0, nx], UP, faceW * 1.0, 0.72, GLYPH_KNOT, col, 1.0, f * 1.05 + 2, 0.5);
        }
        out.runes.quad([c.x, base + 0.07, c.z], [1, 0, 0], [0, 0, 1], 3.4, 3.4, GLYPH_RING, col, 1.25, 0.7, 0.45);
        out.runes.quad([c.x, base + 0.09, c.z], [1, 0, 0], [0, 0, 1], 5.6, 5.6, GLYPH_GLOW, col, 0.2, 0.2, 0.5);
        out.warm.push({ x: c.x, y: base + 1.6, z: c.z, radius: 8, color: scaleRGB(col, 1.5), kind: 'rune' });
        out.crystals.push({ x: c.x, y: c.y1 + 0.5, z: c.z, size: 0.2, color: mixRGB(col, core, 0.35), orbit: 0, speed: 0.9, phase: c.x });
        for (let i = 0; i < 3; i++) out.crystals.push({ x: c.x, y: c.y1 + 0.3 + i * 0.16, z: c.z, size: 0.07, color: col, orbit: 0.42, speed: 1.3 - i * 0.2, phase: i * 2.1 });
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ braziers at the landmarks
  for (const c of world.colliders) {
    if (isHallCollider(c)) continue;
    if (c.kind === 'ramp') {
      // foot of each ramp, either side
      const lowAtMinus = (c.y1b ?? c.y1) > c.y1;
      const lx = (lowAtMinus ? -1 : 1) * (c.hx - 0.4);
      if (c.surf === 'stone') for (const sz of [-1, 1]) { const p = L2W(c, lx, 0, sz * (c.hz + 0.5)); wantBrazier(p[0], p[2], true); }
      else if (c.hz > 2.2) { const p = L2W(c, lx, 0, c.hz + 0.5); wantBrazier(p[0], p[2]); }
    } else if (c.kind === 'wall' && c.hx > 5) {
      const p = L2W(c, 0, 0, -c.hz - 0.45); wantBrazier(p[0], p[2], true);
    } else if (c.kind === 'ship') {
      const p = L2W(c, c.hx * 0.45, 0, c.hz + 0.6); wantBrazier(p[0], p[2]);
    } else if (c.kind === 'rock' && c.shape === 'cyl' && c.y1 > 8.5) {
      // beacon on the peak
      wantBrazier(c.x - c.hx * 0.55, c.z - c.hx * 0.55, true);
    }
  }
  const metal = batch('metal', 0, 0);
  for (const b of brazierSpots) {
    buildBrazier(metal, b.x, b.y, b.z, b.big ? 1.2 : 1);
    const fy = b.y + (b.big ? 1.32 : 1.1);
    out.flames.push({ x: b.x, y: fy, z: b.z, scale: b.big ? 1.25 : 1 });
    out.runes.quad([b.x, fy - 0.06, b.z], [1, 0, 0], [0, 0, 1], 0.62 * (b.big ? 1.2 : 1), 0.62 * (b.big ? 1.2 : 1), GLYPH_GLOW, FIRE, 5.0, b.x * 3, 0.3);
    out.warm.push({ x: b.x, y: fy + 0.25, z: b.z, radius: b.big ? 13 : 11, color: scaleRGB(FIRE, b.big ? 2.6 : 2.1), kind: 'fire' });
  }
  out.stats.braziers = brazierSpots.length;
  return out;
}

// ----------------------------------------------------------------------------------------------

function pineCanopy(g: Geo, x: number, z: number, groundY: number, topY: number, seed: number): void {
  const r0 = (i: number) => hash2(seed & 0xffff, i, 211);
  const H = topY - groundY;
  const yStart = groundY + 4.3 + r0(2) * 0.5;
  const yMin = groundY + 3.55; // nothing of the canopy hangs lower than this
  const yTip = topY + 1.6;
  const baseR = (2.25 + r0(3) * 0.7) * clamp(H / 11, 0.85, 1.25);
  const phase = (seed & 255) / 255;
  // a dark sleeve that hides the trunk between the boughs and closes over its top
  g.color(scaleRGB(PINE_DARK, 0.8)).surface(0.55, 0, phase, 0.3);
  lathe(g, x, z, [[0.03, yTip], [0.3, topY + 0.6], [0.56, topY - 0.15], [0.74, lerp(yStart, topY, 0.45)], [0.86, yStart + 0.35], [0.5, yStart - 0.6]], 8);
  const tiers = Math.max(8, Math.round((topY - yStart) / 0.62));
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = lerp(yStart, topY + 0.35, f);
    const r = baseR * Math.pow(1 - f, 0.8) * (0.86 + r0(10 + t) * 0.28) + 0.6;
    const n = Math.max(5, Math.round(11 - f * 6));
    const ph = r0(40 + t) * 6.28 + t * 0.7;
    const sway0 = clamp01((y - groundY) / H) * 0.5;
    for (let j = 0; j < n; j++) {
      const hj = (k: number) => hash2(t * 37 + j, k, seed & 1023);
      const a = ph + (j / n) * Math.PI * 2 + (hj(1) - 0.5) * 0.5;
      const L = r * (0.8 + hj(2) * 0.4);
      const droop = L * (0.26 + hj(3) * 0.24), rise = 0.25 + L * 0.13;
      const w = L * (0.4 + hj(4) * 0.12);
      const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
      const mid = 0.5;
      const k = 0.85 + hj(5) * 0.4;
      g.color([k, k, k]).surface(0, 1, phase + t * 0.13, sway0 + 0.08);
      const s0 = g.v(x + dx * 0.2, y + rise, z + dz * 0.2, 0, 0.5);
      const l0 = g.v(x + dx * 0.2 - sx * w, y + rise - w * 0.3, z + dz * 0.2 - sz * w, 0, 0);
      const q0 = g.v(x + dx * 0.2 + sx * w, y + rise - w * 0.3, z + dz * 0.2 + sz * w, 0, 1);
      g.surface(0, 1, phase + t * 0.13, sway0 + 0.3);
      const ym = y + rise * 0.55 - droop * 0.22;
      const s1 = g.v(x + dx * L * mid, ym, z + dz * L * mid, 0.5, 0.5);
      const l1 = g.v(x + dx * L * mid - sx * w, Math.max(yMin, ym - w * 0.36), z + dz * L * mid - sz * w, 0.5, 0);
      const q1 = g.v(x + dx * L * mid + sx * w, Math.max(yMin, ym - w * 0.36), z + dz * L * mid + sz * w, 0.5, 1);
      g.surface(0, 1, phase + t * 0.13, sway0 + 0.55);
      const s2 = g.v(x + dx * L, Math.max(yMin, y - droop), z + dz * L, 1, 0.5);
      const l2 = g.v(x + dx * L - sx * w, Math.max(yMin, y - droop - w * 0.3), z + dz * L - sz * w, 1, 0);
      const q2 = g.v(x + dx * L + sx * w, Math.max(yMin, y - droop - w * 0.3), z + dz * L + sz * w, 1, 1);
      g.tri(s0, s1, l1); g.tri(s0, l1, l0); g.tri(s1, s2, l2); g.tri(s1, l2, l1);
      g.tri(s0, q1, s1); g.tri(s0, q0, q1); g.tri(s1, q2, s2); g.tri(s1, q1, q2);
    }
  }
}

/** A hanging strip of cloth (uses the foliage material so it sways and frosts). */
function banner(g: Geo, topCentre: number[], right: number[], w: number, h: number, col: RGB, seed: number): void {
  const NX = 4, NY = 6;
  const start = g.count;
  for (let j = 0; j <= NY; j++) {
    const t = j / NY;
    for (let i = 0; i <= NX; i++) {
      const s = i / NX - 0.5;
      // ragged lower edge
      const rag = j === NY ? hash2(i, seed, 71) * 0.35 : 0;
      const border = Math.abs(s) > 0.38 || t < 0.08;
      g.color(border ? [0.36, 0.25, 0.07] : scaleRGB(col, 0.8 + 0.4 * hash2(i, j, seed)));
      g.surface(0.25, 0, hash2(seed, 3, 5), t * t * 0.55);
      g.v(topCentre[0] + right[0] * s * w, topCentre[1] - (t - rag * 0.3) * h, topCentre[2] + right[2] * s * w, s, t);
    }
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = start + j * (NX + 1) + i;
    g.quad(a, a + 1, a + NX + 2, a + NX + 1);
  }
}

/** Iron tripod brazier ~1.1 m tall, 0.45 m across. */
function buildBrazier(g: Geo, x: number, y: number, z: number, s: number): void {
  g.color([1, 1, 1]).surface(0, 0, 0, 0);
  const bowlY = y + 0.82 * s;
  // bowl, outside then inside
  lathe(g, x, z, [[0.3 * s, bowlY + 0.26 * s], [0.31 * s, bowlY + 0.2 * s], [0.24 * s, bowlY + 0.05 * s], [0.1 * s, bowlY - 0.02 * s], [0.02, bowlY - 0.03 * s]], 10);
  lathe(g, x, z, [[0.02, bowlY + 0.1 * s], [0.2 * s, bowlY + 0.12 * s], [0.27 * s, bowlY + 0.2 * s], [0.3 * s, bowlY + 0.26 * s]], 10);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    beam(g, new THREE.Vector3(x + Math.cos(a) * 0.12 * s, bowlY, z + Math.sin(a) * 0.12 * s), new THREE.Vector3(x + Math.cos(a) * 0.3 * s, y - 0.06, z + Math.sin(a) * 0.3 * s), 0.05, 0.05);
  }
  lathe(g, x, z, [[0.2 * s, y + 0.44 * s], [0.215 * s, y + 0.41 * s], [0.2 * s, y + 0.38 * s]], 8);
}

type BatchFn = (mat: BatchMaterial, x: number, z: number) => Geo;

/**
 * The longship, locked in pack ice. The collider is a box, so the walkable top is a rectangle:
 * the ship-shaped deck sits flush in a slab of snow-covered ice that fills the rest of it.
 * Stems rise from the end faces; everything else is below deck level or far overhead.
 */
function buildShip(c: Collider, iceY: number, batch: BatchFn, out: PropsBuild, L2W: (c: Collider, lx: number, y: number, lz: number) => number[], M: THREE.Matrix4): void {
  const deckY = c.y1;
  const hx = c.hx, hz = c.hz;
  const mat = placeMatrix(c.x, 0, c.z, c.yaw, M).clone();
  const halfW = (s: number) => hz * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 2.4)), 0.62);

  // ---- the ice slab (exact collider box); where the hull shows amidships it stays tucked in
  const ice = new Geo();
  prism(ice, boxOutline(hx, hz, 0.8, false), {
    top: () => deckY, bottom: iceY - 0.4, bevel: 0.07, rings: 3,
    disp: (p, y) => {
      const mid = Math.abs(p.x) < hx * 0.62 && Math.abs(p.nz) > 0.7;
      const d = (fbm2(p.u * 0.7, y * 1.6, 3, 43) - 0.5) * 0.45 + Math.sin(p.u * 2.3 + y * 3) * 0.05;
      return mid ? Math.min(d, 0) - 0.06 : d;
    },
    flare: 0.2,
    topColor: scaleRGB(ICE, 1.05), sideColor: scaleRGB(ICE, 0.95), sideColorLow: scaleRGB(ICE, 0.7),
    topSurf: [1, 0, 0, 0], sideSurf: [0.2, 0, 0, 0],
  });
  batch('ice', c.x, c.z).append(ice, mat);

  const w = new Geo();
  // ---- deck planks (flush, a hair above the slab)
  const N = 26;
  w.color(WOOD).surface(0.55, 0.7, 0.3, 0);
  {
    const st = w.count;
    for (let i = 0; i <= N; i++) {
      const s = -1 + (2 * i) / N;
      const x = s * (hx - 0.1), hw = Math.max(0.02, halfW(s) - 0.1);
      w.v(x, deckY + 0.012, -hw, x, -hw);
      w.v(x, deckY + 0.012, 0, x, 0);
      w.v(x, deckY + 0.012, hw, x, hw);
    }
    for (let i = 0; i < N; i++) {
      const a = st + i * 3, b = a + 3;
      w.quad(a, a + 1, b + 1, b); w.quad(a + 1, a + 2, b + 2, b + 1);
    }
  }
  // ---- gunwale: a low lip around the deck, rib stubs showing through it
  w.color(WOOD_DARK).surface(0.6, 0.8, 0, 0);
  for (const sz of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const s0 = -1 + (2 * i) / N, s1 = -1 + (2 * (i + 1)) / N;
      const a = new THREE.Vector3(s0 * (hx - 0.1), deckY + 0.085, sz * Math.max(0.02, halfW(s0) - 0.1));
      const b = new THREE.Vector3(s1 * (hx - 0.1), deckY + 0.085, sz * Math.max(0.02, halfW(s1) - 0.1));
      beam(w, a, b, 0.15, 0.16);
      if (i % 2 === 1 && Math.abs(s0) < 0.86) {
        const top = a.clone(); top.y = deckY + 0.24 + hash2(i, sz + 2, 3) * 0.14; top.z -= sz * 0.05;
        const foot = a.clone(); foot.y = deckY + 0.02; foot.z -= sz * 0.02;
        beam(w, foot, top, 0.09, 0.11, undefined, 0.6);
      }
    }
  }
  // ---- thwarts (low cross beams)
  for (const s of [-0.62, -0.31, 0.31, 0.62]) {
    const hw = halfW(s) - 0.22;
    beam(w, new THREE.Vector3(s * hx, deckY + 0.07, -hw), new THREE.Vector3(s * hx, deckY + 0.07, hw), 0.2, 0.13);
  }
  // ---- clinker strakes: only the mid-section stands proud of the ice
  for (let k = 0; k < 4; k++) {
    const yTop = deckY - 0.02 - k * 0.3, yBot = yTop - 0.36;
    const proud = 0.19 - k * 0.04;
    w.color(scaleRGB(WOOD, 0.92 - k * 0.1)).surface(0.25, 0.85, 0, 0);
    for (const sz of [-1, 1]) {
      const st = w.count;
      for (let i = 0; i <= N; i++) {
        const s = -1 + (2 * i) / N;
        const x = s * (hx - 0.05), zz = halfW(s) - hz;
        w.v(x, yTop, sz * (hz + zz + proud + 0.035), x, yTop);
        w.v(x, yBot, sz * (hz + zz + proud - 0.03), x, yBot);
      }
      for (let i = 0; i < N; i++) {
        const a = st + i * 2;
        if (sz > 0) w.quad(a, a + 1, a + 3, a + 2); else w.quad(a, a + 2, a + 3, a + 1);
      }
    }
  }
  // ---- round shields hung along the rail
  const shieldCols: RGB[] = [[0.3, 0.05, 0.04], [0.34, 0.25, 0.08], [0.07, 0.12, 0.22], [0.22, 0.2, 0.19]];
  const disc = new THREE.CylinderGeometry(0.36, 0.36, 0.05, 12);
  const boss = new THREE.SphereGeometry(0.09, 8, 5);
  const m2 = new THREE.Matrix4(), rot = new THREE.Matrix4();
  for (const sz of [-1, 1]) for (let i = 0; i < 5; i++) {
    const s = -0.5 + i * 0.25;
    const x = s * hx, zz = sz * (halfW(s) + 0.215);
    rot.makeRotationX(Math.PI / 2 + sz * 0.12);
    m2.makeTranslation(x, deckY - 0.48, zz).multiply(rot);
    w.color(shieldCols[(i + (sz > 0 ? 1 : 0)) % shieldCols.length]).surface(0.35, 0.7, 0, 0);
    w.appendGeometry(disc, m2);
    w.color([0.05, 0.05, 0.06]);
    m2.makeTranslation(x, deckY - 0.48, zz + sz * 0.04);
    w.appendGeometry(boss, m2);
  }
  disc.dispose(); boss.dispose();
  // ---- stems: rise from the end faces, curl out only above head height
  for (const sx of [-1, 1]) {
    const x0 = sx * (hx + 0.1);
    const pts: THREE.Vector3[] = [];
    const prof: [number, number][] = sx > 0
      ? [[0, -0.5], [0.02, 0.6], [0.04, 1.7], [0.1, 2.5], [0.34, 3.2], [0.78, 3.72], [1.3, 3.92], [1.72, 3.74]]
      : [[0, -0.5], [0.02, 0.6], [0.04, 1.7], [0.1, 2.5], [0.3, 3.2], [0.66, 3.66], [1.04, 3.62], [1.2, 3.3], [1.02, 3.02], [0.78, 3.1]];
    for (const [dx, dy] of prof) pts.push(new THREE.Vector3(x0 + sx * dx, deckY + dy, 0));
    w.color(WOOD_DARK).surface(0.5, 0.85, 0, 0);
    tube(w, pts, (t) => lerp(0.17, sx > 0 ? 0.13 : 0.07, t), 7);
    if (sx > 0) {
      // dragon head: skull wedge, jaw, two horns
      const hp = pts[pts.length - 1];
      const head = new THREE.Vector3(hp.x + 0.42, hp.y - 0.26, 0);
      beam(w, hp.clone().add(new THREE.Vector3(-0.1, 0.04, 0)), head, 0.3, 0.3, undefined, 0.5);
      beam(w, hp.clone().add(new THREE.Vector3(0.0, -0.2, 0)), new THREE.Vector3(hp.x + 0.34, hp.y - 0.46, 0), 0.2, 0.1, undefined, 0.5);
      for (const hzs of [-1, 1]) spike(w, new THREE.Vector3(hp.x - 0.06, hp.y + 0.1, hzs * 0.1), new THREE.Vector3(hp.x - 0.5, hp.y + 0.42, hzs * 0.26), 0.06, 4);
    }
  }
  // ---- broken yard, rigging and frozen sail tatters (all well overhead)
  const yardY = deckY + 6.3;
  const ya = new THREE.Vector3(-0.3, yardY + 0.5, -2.7), yb = new THREE.Vector3(0.3, yardY - 0.6, 2.5);
  w.color(WOOD).surface(0.7, 0.8, 0, 0);
  tube(w, [ya, ya.clone().lerp(yb, 0.5), yb], () => 0.1, 6);
  w.color([0.2, 0.17, 0.12]).surface(0.3, 0.8, 0, 0);
  const mastTop = new THREE.Vector3(0, deckY + 7.6, 0);
  for (const sx of [-1, 1]) {
    const end = new THREE.Vector3(sx * (hx + 0.2), deckY + 2.6, 0);
    const rope: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; const p = mastTop.clone().lerp(end, t); p.y -= Math.sin(t * Math.PI) * 0.7; rope.push(p); }
    tube(w, rope, () => 0.028, 4, false);
  }
  batch('wood', c.x, c.z).append(w, mat);

  const cloth = new Geo();
  for (let i = 0; i < 3; i++) {
    const t = 0.18 + i * 0.3;
    const p = ya.clone().lerp(yb, t);
    banner(cloth, [p.x, p.y - 0.08, p.z], [0.1, 0, 0.99], 1.25, 2.0 + hash2(i, 5, 9) * 0.5, [0.2, 0.17, 0.14], 40 + i);
  }
  batch('foliage', c.x, c.z).append(cloth, mat);

  // icicles from the yard and the rail, debris on the ice
  for (let i = 0; i < 9; i++) {
    const p = ya.clone().lerp(yb, 0.08 + i * 0.1);
    const wp = L2W(c, p.x, 0, p.z);
    out.icicles.push({ x: wp[0], y: p.y - 0.08, z: wp[2], len: 0.3 + hash2(i, 3, 15) * 0.6 });
  }
  for (let i = 0; i < 14; i++) {
    const s = (hash2(i, 1, 17) * 2 - 1) * 0.6, sz = i % 2 ? 1 : -1;
    const wp = L2W(c, s * hx, 0, sz * (hz + 0.2));
    out.icicles.push({ x: wp[0], y: deckY - 0.28 - (i % 3) * 0.3, z: wp[2], len: 0.2 + hash2(i, 5, 17) * 0.35 });
  }
}
