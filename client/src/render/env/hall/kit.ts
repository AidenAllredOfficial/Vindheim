// Shared build context for the hall's builders: batches (one per material), light list for the
// baker, palette, layout constants and small reusable props (shields, weapons, dragon heads ...).
import * as THREE from 'three';
import { Rng } from '@shared/math';
import { HALL, type World } from '@shared/world';
import type { QualityLevel } from '../../../settings';
import { Batch, FlameSet, GlyphBatch, basisAlong, torus, trs, unitSphere, type BakeLight, type Occluder, type Piece, type V3 } from './geo';
import type { HallTextures } from './textures';

/** Layout shorthands. */
export const F = HALL.floorY;
export const X0 = HALL.minX, X1 = HALL.maxX, ZN = HALL.minZ, ZS = HALL.maxZ;
export const WALL = 0.8;
/** Inner wall faces. */
export const XI = X1 - WALL, ZNI = ZN + WALL, ZSI = ZS - WALL;
export const CEIL = HALL.roofY0, WALL_TOP = HALL.wallTop;
export const MIDZ = (ZN + ZS) / 2;

/** Palette (sRGB hex). Albedo textures are light, so these read ~2x darker on screen. */
export const C = {
  timber: 0x82694f, timberDark: 0x5e4a39, timberRed: 0x80523c,
  timberOut: 0xa39384, timberOutDark: 0x7a6c60,
  plank: 0x8c735a, plankDark: 0x66513f, ceiling: 0x4c3c30,
  stone: 0x9d9aa8, stoneDark: 0x716e7d, stoneWarm: 0xa39a94, stoneGate: 0x8d93a6,
  iron: 0x45423f, ironDark: 0x2c2a28, ironLite: 0x6c665e,
  gold: 0xd9ac50, bronze: 0x9c6c30,
  rope: 0xb8a073, straw: 0xd0b56c, wax: 0xe8dcc0, bone: 0xd8ccb0, horn: 0xc9b48a,
  snow: 0xe8effa, snowShade: 0xbfd0ea, ice: 0xbfe2f6,
  roof: 0x9a8a7c, roofDark: 0x76685e,
  char: 0x1c1816,
} as const;

export interface SpriteSink {
  /** mode: 0 billboard, 1 flat on the ground plane, 2 upright (Y-locked); add 0.25 to anchor at the bottom edge. Alpha 0 = additive. */
  add(x: number, y: number, z: number, sx: number, sy: number, rot: number, frame: number, mode: number, r: number, g: number, b: number, a: number): void;
}
export interface EmitEnv { time: number; dt: number; cam: THREE.Vector3; wind: number; windX: number; windZ: number; /** particle budget multiplier 0.3..1.6 */ k: number }
export type Emitter = (P: SpriteSink, e: EmitEnv) => void;

export interface Kit {
  world: World;
  q: QualityLevel;
  /** Detail level 0 (low) .. 3 (ultra). */
  d: number;
  T: HallTextures;
  rng: Rng;
  woodIn: Batch; woodOut: Batch; planksIn: Batch; planksOut: Batch;
  rockIn: Batch; rockOut: Batch; masonIn: Batch; masonOut: Batch; pave: Batch;
  roof: Batch; snow: Batch;
  ironIn: Batch; ironOut: Batch; carveIn: Batch; carveOut: Batch; clothIn: Batch; clothOut: Batch;
  glyph: GlyphBatch;
  flames: FlameSet;
  lights: BakeLight[];
  occluders: Occluder[];
  emitters: Emitter[];
  /** Segment count for a span: `per` metres per segment at high detail. */
  seg(len: number, per: number): number;
}

export function makeKit(world: World, q: QualityLevel, T: HallTextures): Kit {
  const d = q === 'low' ? 0 : q === 'medium' ? 1 : q === 'high' ? 2 : 3;
  const mk = (seed: number, inside: boolean) => { const b = new Batch(seed); b.sky = inside ? 0 : 1; return b; };
  const mul = [2.6, 1.6, 1, 0.8][d];
  return {
    world, q, d, T, rng: new Rng(90210),
    woodIn: mk(1, true), woodOut: mk(2, false), planksIn: mk(3, true), planksOut: mk(4, false),
    rockIn: mk(5, true), rockOut: mk(6, false), masonIn: mk(7, true), masonOut: mk(8, false), pave: mk(9, false),
    roof: mk(10, false), snow: mk(11, false),
    ironIn: mk(12, true), ironOut: mk(13, false), carveIn: mk(14, true), carveOut: mk(15, false), clothIn: mk(16, true), clothOut: mk(17, false),
    glyph: new GlyphBatch(), flames: new FlameSet(),
    lights: [], occluders: [], emitters: [],
    seg: (len, per) => Math.max(1, Math.round(len / (per * mul))),
  };
}

// ------------------------------------------------------------------------------------------------
// Reusable prop geometry
// ------------------------------------------------------------------------------------------------

let dragonGeo: THREE.BufferGeometry | null = null;
let axeGeo: THREE.BufferGeometry | null = null;
let coneX: THREE.BufferGeometry | null = null;
let circleGeo: THREE.BufferGeometry | null = null;

/** Dragon-head finial: side profile in the XY plane, snout toward +X, neck base on the origin; ~2 m long at scale 1. */
export function dragonHead(): THREE.BufferGeometry {
  if (dragonGeo) return dragonGeo;
  const s = new THREE.Shape();
  s.moveTo(-0.25, -0.24);
  s.bezierCurveTo(0.5, -0.32, 0.92, -0.06, 1.05, 0.42);      // throat
  s.bezierCurveTo(1.12, 0.6, 1.36, 0.63, 1.72, 0.52);        // under the jaw
  s.lineTo(1.8, 0.64);                                       // jaw tip
  s.lineTo(1.62, 0.7); s.lineTo(1.58, 0.79); s.lineTo(1.5, 0.71);   // tooth
  s.bezierCurveTo(1.4, 0.74, 1.3, 0.78, 1.2, 0.86);          // mouth corner
  s.bezierCurveTo(1.36, 0.9, 1.5, 0.9, 1.6, 0.89);
  s.lineTo(1.66, 0.79); s.lineTo(1.73, 0.88);                // fang
  s.lineTo(1.93, 0.84);
  s.lineTo(2.02, 0.99);                                      // nose
  s.bezierCurveTo(1.84, 1.16, 1.56, 1.24, 1.3, 1.25);        // snout top to brow
  s.bezierCurveTo(1.2, 1.44, 0.98, 1.55, 0.8, 1.46);         // crest
  s.bezierCurveTo(0.58, 1.68, 0.24, 1.54, 0.33, 1.25);       // curl
  s.bezierCurveTo(0.48, 1.4, 0.7, 1.33, 0.74, 1.13);
  s.bezierCurveTo(0.52, 0.9, 0.3, 0.5, -0.25, 0.24);         // back of the neck
  s.closePath();
  const eye = new THREE.Path();
  eye.absellipse(1.4, 1.04, 0.085, 0.06, 0, Math.PI * 2, false, 0.3);
  s.holes.push(eye);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 1, curveSegments: 7 });
  g.translate(0, 0, -0.1);
  dragonGeo = g;
  return g;
}

function axeBlade(): THREE.BufferGeometry {
  if (axeGeo) return axeGeo;
  const s = new THREE.Shape();
  s.moveTo(-0.06, 0);
  s.lineTo(0.06, 0);
  s.quadraticCurveTo(0.08, 0.13, 0.17, 0.22);
  s.quadraticCurveTo(0.0, 0.31, -0.19, 0.2);
  s.quadraticCurveTo(-0.07, 0.12, -0.06, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -0.011);
  axeGeo = g;
  return g;
}

/** 4-sided pyramid along +X: base at x = -0.5, tip at x = +0.5, base half-size 1. */
function pyramidX(): THREE.BufferGeometry {
  if (coneX) return coneX;
  const g = new THREE.ConeGeometry(1, 1, 4);
  g.rotateZ(-Math.PI / 2);
  coneX = g;
  return g;
}
function circle(): THREE.BufferGeometry {
  if (!circleGeo) circleGeo = new THREE.CircleGeometry(1, 22);
  return circleGeo;
}
export function disposeProps(): void {
  for (const g of [dragonGeo, axeGeo, coneX, circleGeo]) g?.dispose();
  dragonGeo = axeGeo = coneX = circleGeo = null;
}

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4();

/**
 * Round shield hung on a wall. (nx, nz) is the outward facing direction; `inside` picks the
 * interior or exterior batches.
 */
export function shield(k: Kit, inside: boolean, x: number, y: number, z: number, nx: number, nz: number, r: number, design: number, spin = 0): void {
  const carve = inside ? k.carveIn : k.carveOut, iron = inside ? k.ironIn : k.ironOut;
  const ry = Math.atan2(nx, nz);
  trs(x + nx * 0.05, y, z + nz * 0.05, { ry }, _m);
  _m.multiply(_r.makeRotationZ(spin));
  carve.add(circle(), _m, { uvRect: k.T.carveRects.shield[design % 8] }, [r, r, 1]);
  // boss
  trs(x + nx * 0.05, y, z + nz * 0.05, { ry }, _m);
  _m.multiply(_r.makeRotationX(Math.PI / 2));
  iron.add(unitSphere(8, 4, Math.PI / 2), _m, { color: C.ironLite }, [r * 0.24, r * 0.2, r * 0.24]);
  // thin backing edge so it does not look like paper from the side
  trs(x + nx * 0.025, y, z + nz * 0.025, { ry }, _m);
  iron.add(torus(1, 0.045, 4, 20), _m, { color: C.ironDark }, [r, r, 0.5]);
}

export function spear(k: Kit, inside: boolean, a: V3, b: V3): void {
  const wood = inside ? k.woodIn : k.woodOut, iron = inside ? k.ironIn : k.ironOut;
  wood.log(a, b, 0.022, { radial: 5, color: C.timber, tile: 1 });
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, uz = (b[2] - a[2]) / len;
  const t: V3 = [b[0] + ux * 0.32, b[1] + uy * 0.32, b[2] + uz * 0.32];
  iron.add(pyramidX(), basisAlong(b, t, 0, _m), { color: C.ironLite }, [0.32, 0.05, 0.014]);
}

export function axe(k: Kit, inside: boolean, a: V3, b: V3, roll = 0): void {
  const wood = inside ? k.woodIn : k.woodOut, iron = inside ? k.ironIn : k.ironOut;
  wood.log(a, b, 0.024, { radial: 5, color: C.timberDark, tile: 1 });
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, uz = (b[2] - a[2]) / len;
  const c: V3 = [b[0] - ux * 0.1, b[1] - uy * 0.1, b[2] - uz * 0.1];
  basisAlong(a, b, roll, _m);
  _m.setPosition(c[0], c[1], c[2]);
  iron.add(axeBlade(), _m, { color: C.ironLite });
}

export function sword(k: Kit, inside: boolean, a: V3, b: V3): void {
  const wood = inside ? k.woodIn : k.woodOut, iron = inside ? k.ironIn : k.ironOut;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const at = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const g = 0.16 / len;
  wood.log(a, at(g), 0.018, { radial: 5, color: C.timberDark, tile: 0.5 });
  iron.beam(at(g), at(g + 0.02 / len), 0.03, 0.2, { color: C.bronze });
  iron.beam(at(g + 0.02 / len), at(0.93), 0.012, 0.055, { color: C.ironLite });
  iron.add(pyramidX(), basisAlong(at(0.93), b, 0, _m), { color: C.ironLite }, [len * 0.07, 0.0275, 0.006]);
  iron.add(unitSphere(6, 4), trs(a[0], a[1], a[2], {}, _m), { color: C.bronze }, [0.03, 0.03, 0.03]);
}

/** Crossed weapons behind a shield on a wall whose outward normal is (nx, nz). */
export function trophy(k: Kit, inside: boolean, x: number, y: number, z: number, nx: number, nz: number, design: number, kind: number): void {
  // tangent along the wall
  const tx = -nz, tz = nx;
  const p = (s: number, h: number, out = 0.04): V3 => [x + tx * s + nx * out, y + h, z + tz * s + nz * out];
  if (kind % 3 === 0) { spear(k, inside, p(-0.75, -1.15), p(0.75, 1.15)); spear(k, inside, p(0.75, -1.15), p(-0.75, 1.15)); }
  else if (kind % 3 === 1) { axe(k, inside, p(-0.5, -0.75), p(0.42, 0.62), 0); axe(k, inside, p(0.5, -0.75), p(-0.42, 0.62), Math.PI); }
  else { sword(k, inside, p(-0.55, 0.62), p(0.5, -0.6)); sword(k, inside, p(0.55, 0.62), p(-0.5, -0.6)); }
  shield(k, inside, x, y, z, nx, nz, 0.5, design, design * 0.9);
}

/** Simple hanging chain as a run of thin square links (cheap; used for chandeliers). */
export function chainLine(b: Batch, a: V3, c: V3, o: Piece = {}): void {
  b.beam(a, c, 0.028, 0.028, { color: C.ironDark, ...o });
}

/** Iron fire basket (cresset) on a bracket from a wall; adds flames + a baked light. */
export function cresset(k: Kit, inside: boolean, x: number, y: number, z: number, nx: number, nz: number, zone: 0 | 1, size = 1): void {
  const iron = inside ? k.ironIn : k.ironOut;
  const bx = x + nx * 0.42 * size, bz = z + nz * 0.42 * size;
  iron.beam([x, y - 0.1, z], [bx, y - 0.1, bz], 0.05, 0.05, { color: C.ironDark });
  iron.beam([x, y - 0.55, z], [bx, y - 0.14, bz], 0.04, 0.04, { color: C.ironDark });
  iron.cyl(0.14 * size, 0.24 * size, 0.3 * size, bx, y - 0.1, bz, { radial: 8, open: true, color: C.iron, emit: [0.6, 0.16, 0.03] });
  iron.cyl(0.14 * size, 0.14 * size, 0.03, bx, y - 0.12, bz, { radial: 8, color: C.ironDark });
  iron.cyl(0.2 * size, 0.2 * size, 0.04, bx, y + 0.12 * size, bz, { radial: 8, color: 0xffb060, emit: [5, 1.6, 0.25] });
  k.flames.add(bx, y + 0.1 * size, bz, 0.5 * size, 0.85 * size, 1.1, 0.05);
  k.flames.add(bx + 0.04, y + 0.08 * size, bz - 0.03, 0.34 * size, 0.55 * size, 1.2, 0.03);
  k.lights.push({ p: [bx + nx * 0.25, y + 0.5, bz + nz * 0.25], c: [2.1, 0.9, 0.3], r0: 1.3, radius: 8, wrap: 0.35, zone });
  const sx = bx, sy = y + 0.45 * size, sz = bz;
  k.emitters.push((P, e) => {
    const f = 0.8 + 0.2 * Math.sin(e.time * 9 + sx * 3) + 0.1 * Math.sin(e.time * 23 + sz);
    P.add(sx, sy, sz, 2.2 * size, 2.2 * size, 0, 0, 0, 0.5 * f, 0.19 * f, 0.045 * f, 0);
  });
}

/** Small candle with a flame (on tables). */
export function candle(k: Kit, x: number, y: number, z: number, h = 0.13): void {
  k.ironIn.cyl(0.028, 0.024, h, x, y, z, { radial: 6, color: C.wax, emit: [0.9, 0.5, 0.2] });
  k.flames.add(x, y + h - 0.01, z, 0.09, 0.2, 1.5, 0.01);
}
