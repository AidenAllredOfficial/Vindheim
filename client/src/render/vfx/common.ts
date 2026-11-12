// Building blocks shared by many effects: flashes, sparks, debris, shock rings, domes, marks.

import type * as THREE from 'three';
import type { Ctx } from './ctx';
import { surfDust } from './ctx';
import type { Palette, PDef } from './core/particles';
import { DS } from './core/decals';
import { I, type InstBatch } from './core/inst';
import { rnd, rnd2, rr, unit, ux, uy, uz } from './core/rand';
import { DEBRIS, DUST, DUST_BIG, FLASH, SPARK, STAR } from './pdefs';

const TAU = Math.PI * 2;

/** Bright pop: glow + (optionally) a star flare. Sizes in metres. */
export function pop(c: Ctx, x: number, y: number, z: number, size: number, star = 0): void {
  c.P.emit(FLASH, x, y, z, 0, 0, 0, size);
  if (star > 0) c.P.emit(STAR, x, y, z, 0, 0, 0, star);
}

export function sparks(c: Ctx, def: PDef, n: number, x: number, y: number, z: number, vMin: number, vMax: number, scale = 1): void {
  c.P.sphere(def, n, x, y, z, vMin, vMax, scale);
}

/** Dust in the colour of the ground at this spot. */
export function dust(c: Ctx, x: number, y: number, z: number, n: number, radius: number, vOut: number, vUp: number, scale = 1, big = false): void {
  c.P.colA.copy(surfDust(c.surface(x, z, y)));
  c.P.ring(big ? DUST_BIG : DUST, n, x, y + 0.15, z, radius, vOut, vUp, scale, 0.35);
}

export function pebbles(c: Ctx, x: number, y: number, z: number, n: number, vMin: number, vMax: number, col: THREE.Color, scale = 1): void {
  c.P.colA.copy(col);
  c.P.hemi(DEBRIS, n, x, y + 0.1, z, vMin, vMax, scale, 0.2);
}

/**
 * Ballistic mesh debris (rocks or crystals) thrown from a point; each chunk lands on `groundY`
 * and stops there, then shrinks away. dir (dx,dz) biases the throw (0,0 = radial).
 */
export function chunks(c: Ctx, batch: InstBatch, n: number, x: number, y: number, z: number, groundY: number, vOut: number, vUp: number, size: number,
                       col0: THREE.Color, m0: number, col1: THREE.Color, m1: number, style: number, p1 = 0, dx = 0, dz = 0, bias = 0, r0 = 0): void {
  const count = c.d(n);
  for (let i = 0; i < count; i++) {
    const a = rnd() * TAU, cs = Math.cos(a), sn = Math.sin(a);
    const vo = vOut * (0.35 + 0.65 * rnd()), vu = vUp * (0.45 + 0.55 * rnd());
    const vx = cs * vo + dx * bias, vz = sn * vo + dz * bias;
    const s = size * (0.45 + 0.75 * rnd());
    const g = 22;
    const sy = y + rnd() * 0.3, px = x + cs * r0 * rnd(), pz = z + sn * r0 * rnd();
    const h = Math.max(0, sy - groundY);
    const tHit = (vu + Math.sqrt(vu * vu + 2 * g * h)) / g;
    I.reset().pos(px, sy, pz).vel(vx, vu, vz).scale(s * rr(0.7, 1.2), s * rr(0.6, 1.1), s * rr(0.7, 1.2)).randomRot();
    I.grav = g; I.tHit = tHit; I.spin = rr(4, 11); I.life = tHit + rr(0.35, 0.9); I.shrinkOut = 0.3;
    I.c0(col0, m0 * rr(0.8, 1.15)).c1(col1, m1); I.style = style; I.p1 = p1;
    batch.spawn(I);
  }
}

/** Expanding shock ring on the ground reaching exactly `radius` after `time` seconds. */
export function shock(c: Ctx, x: number, y: number, z: number, radius: number, pal: Palette, time: number, thick = 0.07, jag = 0, mul = 1, linger = 0.25, delay = 0): number {
  const d = c.decals.begin(DS.SHOCK, x, y, z, radius, time + linger);
  d.fuse = time; d.p1 = thick; d.p2 = jag; d.fadeIn = 0.01; d.fadeOut = linger; d.age = -delay; d.lift = 0.03;
  d.c0(pal.color, 1.4 * mul).c1(pal.core, 2.0 * mul);
  return c.decals.commit();
}

/** Hollow burst dome (hemisphere shell) growing to exactly `radius`. */
export function dome(c: Ctx, x: number, y: number, z: number, radius: number, pal: Palette, life: number, mul = 1, alpha = 0, noise = 0): void {
  I.reset().pos(x, y, z).scale(radius * 0.25);
  I.scaleEnd = 4; I.life = life; I.style = 2; I.p1 = noise; I.p2 = alpha;
  I.c0(pal.color, 1.5 * mul).c1(pal.core, 1.6 * mul);
  c.B.shells.spawn(I);
}

/** Free-standing glow ring whose plane faces the unit direction (dx,dy,dz); grows r0 -> r1. */
export function airRing(c: Ctx, x: number, y: number, z: number, dx: number, dy: number, dz: number, r0: number, r1: number, pal: Palette, life: number, mul = 1, thick = 0.2, style = 0, delay = 0): void {
  I.reset().pos(x, y, z).fromTo(0, 0, 1, dx, dy, dz).scale(r0);
  I.scaleEnd = r1 / Math.max(r0, 1e-3); I.life = life; I.style = style; I.p1 = thick; I.p2 = 0; I.delay = delay;
  I.c0(pal.color, 2.0 * mul).c1(pal.core, 2.6 * mul);
  c.B.rings.spawn(I);
}
/** Camera-facing glow ring. */
export function faceRing(c: Ctx, x: number, y: number, z: number, r0: number, r1: number, pal: Palette, life: number, mul = 1, thick = 0.2, style = 0): void {
  I.reset().pos(x, y, z).scale(r0);
  I.scaleEnd = r1 / Math.max(r0, 1e-3); I.life = life; I.style = style; I.p1 = thick; I.p2 = 1;
  I.c0(pal.color, 2.0 * mul).c1(pal.core, 2.6 * mul);
  c.B.rings.spawn(I);
}

/** Timed star flare billboard (bigger and steadier than a particle). */
export function flare(c: Ctx, x: number, y: number, z: number, size: number, pal: Palette, life: number, mul = 1): void {
  I.reset().pos(x, y, z).scale(size * 0.4);
  I.scaleEnd = 2.5; I.life = life; I.style = 1; I.shrinkOut = life * 0.7;
  I.c0(pal.color, 2.2 * mul).c1(pal.core, 3.0 * mul);
  c.B.glyphs.spawn(I);
}

export function scorch(c: Ctx, x: number, y: number, z: number, radius: number, pal: Palette, life: number, heat = 1.5, mul = 1): void {
  const d = c.decals.begin(DS.SCORCH, x, y, z, radius, life);
  d.p1 = heat; d.fadeIn = 0.05; d.fadeOut = Math.min(1.5, life * 0.4);
  d.c0(pal.color, 2.2 * mul).c1(pal.core, 1.5 * mul);
  c.decals.commit();
}

export function cracks(c: Ctx, x: number, y: number, z: number, radius: number, col: THREE.Color, life: number, spread: number, glow = 1, mul = 1.6): void {
  const d = c.decals.begin(DS.CRACKS, x, y, z, radius, life);
  d.fuse = spread; d.p1 = glow; d.p2 = rnd() * 2; d.fadeIn = 0.01; d.fadeOut = Math.min(1.5, life * 0.4); d.lift = 0.01;
  d.c0(col, mul);
  c.decals.commit();
}

export function frostMark(c: Ctx, x: number, y: number, z: number, radius: number, pal: Palette, life: number): void {
  const d = c.decals.begin(DS.FROST, x, y, z, radius, life);
  d.fadeIn = 0.06; d.fadeOut = Math.min(1.2, life * 0.4);
  d.c0(pal.color, 1.0).c1(pal.core, 1.3);
  c.decals.commit();
}

export function ripple(c: Ctx, x: number, y: number, z: number, radius: number, pal: Palette, life: number): void {
  const d = c.decals.begin(DS.RIPPLE, x, y, z, radius, life);
  d.fuse = life * 0.6; d.fadeIn = 0.03; d.fadeOut = life * 0.5;
  d.c0(pal.dark, 1.2).c1(pal.core, 1.4);
  c.decals.commit();
}

/** Soft light pool on the ground. */
export function groundGlow(c: Ctx, x: number, y: number, z: number, radius: number, col: THREE.Color, mul: number, life: number, fadeIn = 0.05): number {
  const d = c.decals.begin(DS.GLOW, x, y, z, radius, life);
  d.fadeIn = fadeIn; d.fadeOut = Math.min(0.5, life * 0.6); d.extX = d.extZ = 1.25;
  d.c0(col, mul);
  return c.decals.commit();
}

/** A lightning bolt in an element's colours. */
export function bolt(c: Ctx, ax: number, ay: number, az: number, bx: number, by: number, bz: number, pal: Palette, width: number, life: number, jag = 0.09, branches = 0, taper = false, delay = 0, mul = 1): void {
  c.bolts.fire(ax, ay, az, bx, by, bz, pal.color, 2.6 * mul, pal.color, 2.0 * mul, width, life, jag, c.d(branches) * (branches > 0 ? 1 : 0), c.now, delay, taper);
}

/** Emit `perMetre` particles along the segment travelled this frame, back-dated so the trail is even. */
export function trail(c: Ctx, def: PDef, perMetre: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, jitter: number, vx: number, vy: number, vz: number, scale = 1): void {
  const dist = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const n = c.P.n(perMetre * dist);
  for (let i = 0; i < n; i++) {
    const t = rnd();
    c.P.emit(def, x0 + (x1 - x0) * t + rnd2() * jitter, y0 + (y1 - y0) * t + rnd2() * jitter, z0 + (z1 - z0) * t + rnd2() * jitter, vx, vy, vz, scale, -(1 - t) * c.dt);
  }
}

/** Particles converging on a point from a shell of radius r (they arrive as they die). */
export function gather(c: Ctx, def: PDef, n: number, x: number, y: number, z: number, r: number, scale = 1): void {
  const count = c.P.n(n);
  for (let i = 0; i < count; i++) {
    unit();
    const d = r * (0.6 + 0.6 * rnd()), sp = d / (def.life * 0.95);
    c.P.emit(def, x + ux * d, y + uy * d, z + uz * d, -ux * sp, -uy * sp, -uz * sp, scale, 0, 1);
  }
}

export { TAU };
