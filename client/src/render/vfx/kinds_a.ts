// Entity visuals: Ember, Frost, Storm, Stone.

import { ZONES } from '@shared/elements';
import type { Ctx } from './ctx';
import { surfDust } from './ctx';
import type { Ent, KindDef, KindTable } from './entity';
import { DS } from './core/decals';
import { SS } from './core/strips';
import { I, type InstBatch } from './core/inst';
import { rnd, rnd2, rr } from './core/rand';
import {
  ARC, DEBRIS, DUST, DUST_BIG, EMBER, FIREBLOB, FLAKE, FLAME, FLAME_BIG, FLASH, FROST_MIST, GLOW, ICE_CHIP, MOTE, SMOKE, SMOKE_HOT,
  SPARK, SPARK_FLOAT, STAR, ZAP,
} from './pdefs';
import { TAU, airRing, bolt, chunks, cracks, dome, dust, flare, frostMark, groundGlow, pebbles, pop, scorch, shock, trail } from './common';

/** Allocate a live instance that stays invisible until its first write. */
export function live(b: InstBatch): number { I.reset().scale(0); return b.spawnLive(I); }

const LIGHT_KEY = 100000;

// =========================================================================================== EMBER

/** A fiery burst reaching exactly `r` metres. */
export function fireBurst(c: Ctx, n: Ent, x: number, y: number, z: number, r: number, power: number): void {
  const pal = c.usePal(n.pal), P = c.P;
  const grounded = c.nearGround(x, y, z, r * 0.8);
  pop(c, x, y, z, r * 1.0, r * 0.9);
  // FIREBLOB drag 3.2: travel ~ v / 3.2, so v = r * 3.2 puts the fire at the true radius
  P.sphere(FIREBLOB, 14 * power, x, y, z, r * 1.6, r * 3.3, 0.55 + r * 0.22);
  P.sphere(SPARK, 22 * power, x, y, z, r * 2.5, r * 7, 1);
  P.sphere(EMBER, 16 * power, x, y, z, r * 0.8, r * 2.6, 1, r * 0.3);
  P.sphere(SMOKE_HOT, 5 * power, x, y, z, 0.4, r * 0.9, 0.8 + r * 0.3, r * 0.3, 0.08);
  dome(c, x, y, z, r, pal, 0.22, 1.0, 0, 0.3);
  if (grounded) {
    const gy = c.groundY(x, z, y);
    shock(c, x, gy, z, r, pal, 0.2, 0.08);
    scorch(c, x, gy, z, r * 0.72, pal, 6, 1.6);
  }
  c.lights.flash(x, y + 0.4, z, pal.color, 2.2 + r, 9 + r * 3, 0.22);
}

const fireball: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    pop(c, e.x, e.y, e.z, 1.2);
    c.P.cone(SPARK, 8, e.x, e.y, e.z, n.dx, n.dy, n.dz, 0.5, 4, 12);
    c.P.cone(FLAME, 5, e.x, e.y, e.z, n.dx, n.dy, n.dz, 0.7, 1, 4, 0.7);
    n.h[0] = live(c.B.orbs); n.h[1] = live(c.B.glyphs);
    const s = (n.s[0] = c.strips.ribbon(SS.FIRE, 0.95, 0.2, 0.45));
    if (s) s.color(pal.color, 1.8, pal.dark, 1.4);
  },
  update(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    I.reset().pos(e.x, e.y, e.z).scale(0.62); I.style = 0; I.c0(pal.color, 1.7).c1(pal.core, 1.1);
    c.B.orbs.write(n.h[0], I);
    I.reset().pos(e.x, e.y, e.z).scale(2.4); I.style = 2; I.c0(pal.color, 0.6).c1(pal.core, 0.3);
    c.B.glyphs.write(n.h[1], I);
    n.s[0]?.move(e.x, e.y, e.z, c.now);
    trail(c, FLAME, 2.6, n.px, n.py, n.pz, e.x, e.y, e.z, 0.14, 0, 0.6, 0, 0.75);
    trail(c, EMBER, 1.3, n.px, n.py, n.pz, e.x, e.y, e.z, 0.2, 0, 0.4, 0);
    trail(c, SMOKE, 0.45, n.px, n.py, n.pz, e.x, e.y, e.z, 0.15, 0, 0.5, 0, 0.7);
    c.lights.hold(LIGHT_KEY + e.id, e.x, e.y, e.z, pal.color, 1.5, 10);
  },
  despawn(c, n, why) {
    c.usePal(n.pal);
    if (why === 0) {
      c.P.sphere(EMBER, 10, n.ex, n.ey, n.ez, 0.5, 3);
      c.P.sphere(SMOKE, 3, n.ex, n.ey, n.ez, 0.2, 1, 0.7);
      c.P.emit(GLOW, n.ex, n.ey, n.ez, 0, 0, 0, 1.2);
    } else fireBurst(c, n, n.ex, n.ey, n.ez, 2.4, 1);
  },
  free(c, n) { c.B.orbs.kill(n.h[0]); c.B.glyphs.kill(n.h[1]); },
};

function telegraph(c: Ctx, n: Ent): number {
  const e = n.e, pal = n.pal;
  const d = c.decals.begin(DS.TELEGRAPH, e.x, e.y, e.z, e.r, e.p + 0.3);
  d.fuse = e.p; d.age = e.age; d.fadeIn = 0.06; d.fadeOut = 0.12; d.lift = 0.05; d.extX = d.extZ = 1.12;
  d.c0(pal.color, 1.7).c1(pal.core, 2.3);
  return c.decals.commit();
}

const meteor: KindDef = {
  spawn(c, n) {
    const pal = n.pal;
    n.h[0] = telegraph(c, n);
    n.h[1] = live(c.B.rocks); n.h[2] = live(c.B.orbs); n.h[3] = live(c.B.glyphs);
    // the meteor comes in along a slanted path, start point 60 m out
    const a = rnd() * TAU;
    n.f[0] = Math.cos(a) * 24; n.f[1] = 54; n.f[2] = Math.sin(a) * 24;
    const s = (n.s[0] = c.strips.ribbon(SS.FIRE, 2.6, 0.42, 1.6));
    if (s) { s.color(pal.color, 2.2, pal.dark, 1.6); s.headTaper = 0.05; }
    const s2 = (n.s[1] = c.strips.ribbon(SS.SMOKE, 3.2, 0.9, 2.2));
    if (s2) s2.color(pal.dark, 1.2, pal.dark, 0.6);
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal);
    const k = Math.min(1, e.age / Math.max(e.p, 1e-3)), rem = 1 - k;
    const x = e.x + n.f[0] * rem, y = e.y + n.f[1] * rem + 0.8, z = e.z + n.f[2] * rem;
    I.reset().pos(x, y, z).scale(1.25).yaw(c.now * 3.1).pitch(c.now * 2.3); I.style = 0; I.p1 = 1.3;
    I.c0(c.rock, 0.5).c1(pal.color, 2.2);
    c.B.rocks.write(n.h[1], I);
    I.reset().pos(x, y, z).scale(2.0); I.style = 0; I.c0(pal.color, 1.8).c1(pal.core, 1.3);
    c.B.orbs.write(n.h[2], I);
    I.reset().pos(x, y, z).scale(7); I.style = 1; I.c0(pal.color, 1.0).c1(pal.core, 1.2);
    c.B.glyphs.write(n.h[3], I);
    n.s[0]?.move(x, y, z, c.now); n.s[1]?.move(x, y, z, c.now);
    if (n.f[3] !== 0) {
      trail(c, FLAME_BIG, 0.5, n.f[4], n.f[5], n.f[6], x, y, z, 0.5, 0, 1, 0, 1.6);
      trail(c, EMBER, 0.6, n.f[4], n.f[5], n.f[6], x, y, z, 0.7, 0, 0, 0, 1.4);
    }
    n.f[3] = 1; n.f[4] = x; n.f[5] = y; n.f[6] = z;
    // the ground heats up as it comes: embers lift off inside the ring, light grows
    c.P.disc(EMBER, 26 * k * dt * e.r, e.x, e.y + 0.1, e.z, e.r * 0.95, 0, 1.5 + 3 * k, 0);
    c.lights.hold(LIGHT_KEY + e.id, e.x + n.f[0] * rem * 0.25, e.y + 2.5 + n.f[1] * rem * 0.25, e.z + n.f[2] * rem * 0.25, pal.color, 1.5 + 7 * k * k, 30);
  },
  despawn(c, n, why) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    c.decals.release(n.h[0], 0.12);
    if (why !== 3) { P.sphere(SMOKE, 6, n.f[4], n.f[5], n.f[6], 0.5, 2, 1.5); return; }
    const x = n.ex, z = n.ez, r = e.r, y = c.groundY(x, z, n.ey);
    pop(c, x, y + 0.8, z, r * 1.3, r * 1.2);
    flare(c, x, y + 1, z, r * 1.2, pal, 0.26, 1.0);
    P.hemi(FIREBLOB, 44, x, y + 0.3, z, r * 1.4, r * 3.3, 2.2, 0.45);
    P.hemi(SPARK, 60, x, y + 0.3, z, 8, 30, 1.4, 0.2);
    P.hemi(EMBER, 44, x, y + 0.3, z, 2, 11, 1.4, 0.1, r * 0.5);
    // a crown of fire standing on the true radius
    P.ring(FLAME_BIG, 30, x, y + 0.2, z, r * 0.9, 0.6, 5.5, 1.5, 0.08);
    P.ring(SMOKE_HOT, 12, x, y + 0.5, z, r * 0.6, 2.2, 2.8, 2.4, 0.3, 0.06);
    dust(c, x, y, z, 14, r * 0.8, 6, 1.2, 1.6, true);
    chunks(c, c.B.rocks, 16, x, y + 0.3, z, y, 9, 11, 0.26, c.rock, 0.55, pal.color, 1.6, 0, 0.22, 0, 0, 0, r * 0.4);
    dome(c, x, y, z, r, pal, 0.34, 1.5, 0.1, 0.5);
    shock(c, x, y, z, r, pal, 0.24, 0.09, 1.3, 0.4);
    cracks(c, x, y, z, r, pal.color, 7, 0.2, 2.6, 2.4);
    scorch(c, x, y, z, r * 0.8, pal, 9, 2.4);
    c.lights.flash(x, y + 2, z, pal.color, 12, 42, 0.42, 0.05);
  },
  free(c, n) { c.B.rocks.kill(n.h[1]); c.B.orbs.kill(n.h[2]); c.B.glyphs.kill(n.h[3]); },
};

/** Burning ground: firepatch and cindertrail. */
const firezone: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    const d = c.decals.begin(DS.FIRE, e.x, e.y, e.z, e.r, Math.max(0.1, e.life - e.age));
    d.fadeIn = 0.15; d.fadeOut = 0.4; d.c0(pal.color, 1.5).c1(pal.core, 1.7); d.extX = d.extZ = 1.1;
    n.h[0] = c.decals.commit();
    if (e.age < 0.2) {
      c.P.ring(FLAME_BIG, 5 + e.r * 4, e.x, e.y + 0.1, e.z, e.r * 0.8, 0.5, 3.5, 0.6 + e.r * 0.2, 0.25);
      c.P.disc(EMBER, 6 * e.r, e.x, e.y + 0.1, e.z, e.r, 0, 3, 0);
    }
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    const fade = Math.min(1, Math.max(0, (e.life - e.age) / 0.4)), r = e.r, area = r * r;
    // flames stay inside the true radius; a ring of small ones stands on the edge
    P.disc(FLAME, 9 * area * fade * dt, e.x, e.y + 0.1, e.z, r * 0.86, 0, 1.6, 0, 1.0 + 0.16 * r);
    P.disc(FIREBLOB, 3 * area * fade * dt, e.x, e.y + 0.25, e.z, r * 0.8, 0, 1.4, 0, 0.5 + 0.08 * r);
    const edge = P.n(7 * r * fade * dt);
    for (let i = 0; i < edge; i++) { const a = rnd() * TAU; P.emit(FLAME, e.x + Math.cos(a) * r * 0.95, e.y + 0.08, e.z + Math.sin(a) * r * 0.95, 0, 0.8, 0, 0.7); }
    P.disc(EMBER, 2.4 * area * fade * dt, e.x, e.y + 0.2, e.z, r * 0.9, 0, 2.2, 0);
    P.disc(SMOKE, 0.5 * area * fade * dt, e.x, e.y + 0.9, e.z, r * 0.7, 0, 1.2, 0, 0.9);
    if (r > 2) c.lights.hold(LIGHT_KEY + e.id, e.x, e.y + 1.2, e.z, pal.color, 1.3 * fade, r * 4.5);
  },
  despawn(c, n) {
    c.usePal(n.pal);
    c.decals.release(n.h[0], 0.35);
    c.P.disc(SMOKE, 2 + n.e.r * 2, n.e.x, n.e.y + 0.3, n.e.z, n.e.r * 0.7, 0, 1, 0, 0.9);
  },
};

// =========================================================================================== FROST

function iceShatter(c: Ctx, n: Ent, x: number, y: number, z: number, power: number): void {
  const pal = c.usePal(n.pal), P = c.P;
  pop(c, x, y, z, 1.0 * power, 0.9 * power);
  P.cone(ICE_CHIP, 12 * power, x, y, z, -n.dx, -n.dy * 0.3 + 0.5, -n.dz, 1.2, 2, 8);
  P.sphere(FLAKE, 8 * power, x, y, z, 0.5, 3);
  P.sphere(FROST_MIST, 3 * power, x, y, z, 0.2, 1.2, 0.7);
  chunks(c, c.B.crystals, 4 * power, x, y, z, c.groundY(x, z, y), 3.5, 4, 0.13, pal.color, 1.0, pal.core, 1.5, 1);
  c.lights.flash(x, y, z, pal.color, 1.2 * power, 7, 0.12);
}

const iceshard: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    pop(c, e.x, e.y, e.z, 0.7);
    c.P.cone(ICE_CHIP, 3, e.x, e.y, e.z, n.dx, n.dy, n.dz, 0.6, 2, 6, 0.7);
    n.h[0] = live(c.B.crystals);
    const s = (n.s[0] = c.strips.ribbon(SS.GLOW, 0.3, 0.05, 0.4));
    if (s) s.color(pal.core, 1.8, pal.color, 1.0);
  },
  update(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    I.reset().pos(e.x - n.dx * 0.25, e.y - n.dy * 0.25, e.z - n.dz * 0.25).aimY(n.dx, n.dy, n.dz).scale(0.27, 1.0, 0.27);
    I.style = 1; I.c0(pal.color, 1.3).c1(pal.core, 2.0);
    c.B.crystals.write(n.h[0], I);
    n.s[0]?.move(e.x, e.y, e.z, c.now);
    trail(c, FLAKE, 0.55, n.px, n.py, n.pz, e.x, e.y, e.z, 0.1, 0, 0, 0, 0.8);
    trail(c, FROST_MIST, 0.22, n.px, n.py, n.pz, e.x, e.y, e.z, 0.1, 0, 0, 0, 0.45);
  },
  despawn(c, n, why) {
    c.usePal(n.pal);
    if (why === 0) { c.P.sphere(FLAKE, 6, n.ex, n.ey, n.ez, 0.3, 1.5); c.P.sphere(FROST_MIST, 2, n.ex, n.ey, n.ez, 0.1, 0.6, 0.5); return; }
    iceShatter(c, n, n.ex, n.ey, n.ez, 1);
    if (why === 1 && c.nearGround(n.ex, n.ey, n.ez, 0.8)) frostMark(c, n.ex, c.groundY(n.ex, n.ez, n.ey), n.ez, 0.8, n.pal, 3);
  },
  free(c, n) { c.B.crystals.kill(n.h[0]); },
};

const spikes: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    const l = Math.hypot(e.vx, e.vz) || 1;
    n.dx = e.vx / l; n.dz = e.vz / l; n.dy = 0;
    const half = e.p * 0.5, cx = e.x + n.dx * half, cz = e.z + n.dz * half;
    const d = c.decals.begin(DS.STRIP, cx, e.y, cz, half, e.p / e.q + 2.0);
    d.rot = Math.atan2(n.dz, n.dx); d.extX = 1.04; d.extZ = (e.r + 0.45) / half; d.fuse = e.p / e.q; d.p1 = e.r / half; d.p2 = 0;
    d.age = e.age; d.fadeIn = 0.01; d.fadeOut = 0.8; d.c0(pal.color, 1.2).c1(pal.core, 1.3);
    c.decals.commit();
    n.f[0] = 0.5; // next row distance
    pop(c, e.x, e.y + 0.3, e.z, 1.6, 1.2);
    c.P.hemi(ICE_CHIP, 10, e.x, e.y + 0.1, e.z, 2, 7);
    c.lights.flash(e.x + n.dx * 2, e.y + 1.2, e.z + n.dz * 2, pal.color, 3, 16, 0.3);
  },
  update(c, n) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    const front = Math.min(e.age * e.q, e.p);
    let row = n.f[0], guard = 0;
    while (row <= front && guard++ < 40) {
      const delay = row / e.q - e.age; // back-date to the instant the front passed
      const px = e.x + n.dx * row, pz = e.z + n.dz * row;
      const nx = -n.dz, nz = n.dx;
      const big = 0.75 + 0.5 * rnd();
      const count = c.cfg.detail >= 1 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        // one tall spike near the centre line, the others shorter out toward the edges
        const side = i === 0 ? rnd2() * 0.3 : (i === 1 ? 1 : -1) * rr(0.5, 0.92);
        const off = side * e.r, along = rnd2() * 0.2;
        const sx = px + nx * off + n.dx * along, sz = pz + nz * off + n.dz * along;
        const sy = c.groundY(sx, sz, e.y);
        const h = (i === 0 ? rr(1.7, 2.5) * big : rr(0.8, 1.5)) * (0.75 + 0.25 * Math.min(1, row / 2));
        const w = h * rr(0.17, 0.24);
        // lean forward and outward
        const lx = n.dx * 0.28 + nx * side * 0.3 + rnd2() * 0.08, lz = n.dz * 0.28 + nz * side * 0.3 + rnd2() * 0.08;
        const ll = 1 / Math.hypot(lx, 1, lz);
        I.reset().pos(sx, sy - 0.05, sz).aimY(lx * ll, ll, lz * ll).scale(w, h, w);
        I.style = 1; I.p2 = 1; I.growIn = 0.07; I.shrinkOut = 0.24; I.life = rr(0.72, 0.92); I.delay = delay;
        I.c0(pal.color, 1.0).c1(pal.core, 1.7);
        c.B.crystals.spawn(I);
      }
      const gy = c.groundY(px, pz, e.y);
      P.emit(FLASH, px, gy + 0.5, pz, 0, 0, 0, 1.1, delay);
      for (let i = P.n(4); i > 0; i--) P.emit(ICE_CHIP, px + nx * rnd2() * e.r, gy + 0.3, pz + nz * rnd2() * e.r, rnd2() * 2 + n.dx * 3, rr(3, 8), rnd2() * 2 + n.dz * 3, 1, delay);
      for (let i = P.n(1.6); i > 0; i--) P.emit(FROST_MIST, px + nx * rnd2() * e.r, gy + 0.5, pz + nz * rnd2() * e.r, n.dx * 1.5, 0.6, n.dz * 1.5, 1, delay);
      // the crumble, scheduled now
      for (let i = P.n(3); i > 0; i--) P.emit(ICE_CHIP, px + nx * rnd2() * e.r, gy + rr(0.4, 1.6), pz + nz * rnd2() * e.r, rnd2() * 1.5, rr(0, 2), rnd2() * 1.5, 0.8, delay + 0.72);
      for (let i = P.n(1.2); i > 0; i--) P.emit(FROST_MIST, px + nx * rnd2() * e.r, gy + 0.6, pz + nz * rnd2() * e.r, 0, 0.4, 0, 1.1, delay + 0.7);
      row += 0.62;
    }
    n.f[0] = row;
  },
};

const rimerune: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    const d = c.decals.begin(DS.RUNE, e.x, e.y, e.z, e.r, Math.max(0.2, e.life - e.age));
    d.fuse = Math.max(e.p, 0.05); d.p1 = 1; d.p2 = 1; d.age = e.age; d.fadeIn = 0.1; d.fadeOut = 0.4; d.extX = d.extZ = 1.08;
    // the owner reads it clearly; everyone else gets a faint shimmer
    d.c0(pal.color, 1.3, n.mine ? 1 : 0.11).c1(pal.core, 1.6, n.mine ? 1 : 0.4);
    n.h[0] = c.decals.commit();
    if (e.age < 0.2) { c.P.ring(FLAKE, 10, e.x, e.y + 0.1, e.z, e.r * 0.8, -1.5, 0.6); pop(c, e.x, e.y + 0.2, e.z, n.mine ? 1.4 : 0.7); }
  },
  update(c, n, dt) {
    const e = n.e; c.usePal(n.pal);
    const armed = e.age >= e.p;
    if (n.mine) {
      c.P.disc(FLAKE, (armed ? 2.5 : 9) * dt, e.x, e.y + 0.1, e.z, e.r * 0.9, 0, 0.5, 0, 0.8);
      if (armed && n.f[0] === 0) { n.f[0] = 1; c.P.ring(FLAKE, 14, e.x, e.y + 0.15, e.z, e.r, 0.3, 1.2); c.P.emit(GLOW, e.x, e.y + 0.3, e.z, 0, 0, 0, 2.2); }
    } else {
      c.P.disc(FLAKE, 0.7 * dt, e.x, e.y + 0.08, e.z, e.r * 0.8, 0, 0.25, 0, 0.5);
    }
  },
  despawn(c, n, why) {
    c.usePal(n.pal);
    c.decals.release(n.h[0], why === 3 ? 0.12 : 0.5);
    if (why === 3) pop(c, n.e.x, n.e.y + 0.3, n.e.z, 2.2, 1.6);
  },
};

const icetrail: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    const d = c.decals.begin(DS.ICE, e.x, e.y, e.z, e.r, Math.max(0.1, e.life - e.age));
    d.fadeIn = 0.12; d.fadeOut = 0.4; d.extX = d.extZ = 1.1; d.c0(pal.color, 1.0).c1(pal.core, 1.3);
    n.h[0] = c.decals.commit();
    if (e.age < 0.2) { c.P.hemi(ICE_CHIP, 4, e.x, e.y + 0.1, e.z, 1, 4, 0.8); c.P.disc(FROST_MIST, 2, e.x, e.y + 0.2, e.z, e.r * 0.6, 0, 0.3, 0, 0.8); }
  },
  update(c, n, dt) {
    const e = n.e; c.usePal(n.pal);
    const fade = Math.min(1, Math.max(0, (e.life - e.age) / 0.4));
    c.P.disc(FROST_MIST, 1.3 * fade * dt, e.x, e.y + 0.25, e.z, e.r * 0.75, 0, 0.25, 0, 0.85);
    c.P.disc(FLAKE, 1.6 * fade * dt, e.x, e.y + 0.1, e.z, e.r * 0.9, 0, 0.5, 0, 0.7);
  },
  despawn(c, n) { c.decals.release(n.h[0], 0.35); },
};

// =========================================================================================== STORM

function zapBurst(c: Ctx, n: Ent, x: number, y: number, z: number, r: number, big: boolean): void {
  const pal = c.usePal(n.pal), P = c.P;
  const grounded = c.nearGround(x, y, z, r);
  const gy = grounded ? c.groundY(x, z, y) : y;
  pop(c, x, y, z, r * (big ? 0.8 : 0.9), r * (big ? 0.8 : 0.8));
  const spokes = c.d(big ? 14 : 8);
  for (let i = 0; i < spokes; i++) {
    const a = (i + rnd()) / spokes * TAU, up = big ? rr(-0.1, 0.9) : rr(-0.1, 0.6);
    const cs = Math.cos(a) * Math.cos(up), sn = Math.sin(a) * Math.cos(up);
    const ty = Math.max(gy + 0.1, y + Math.sin(up) * r);
    bolt(c, x, y, z, x + cs * r, ty, z + sn * r, pal, big ? 0.42 : 0.3, rr(0.16, 0.26), 0.13, big ? 1 : 0, true);
  }
  P.sphere(ZAP, big ? 90 : 40, x, y, z, r * 2, r * 6.5);
  P.sphere(ARC, big ? 26 : 12, x, y, z, 0, r * 1.5, big ? 1.8 : 1.3, r * 0.4);
  P.sphere(SPARK, big ? 30 : 12, x, y, z, 4, 14);
  dome(c, x, y, z, r, pal, big ? 0.36 : 0.26, big ? 1.8 : 1.3, 0, 0.6);
  if (grounded) {
    shock(c, x, gy, z, r, pal, big ? 0.22 : 0.18, 0.08, big ? 1.5 : 1.2, 0.3);
    if (big) { shock(c, x, gy, z, r, pal, 0.3, 0.05, 1, 0.3, 0.08); scorch(c, x, gy, z, r * 0.45, pal, 5, 1.2); }
  }
  if (big) {
    bolt(c, x + rnd2() * 4, y + 46, z + rnd2() * 4, x, y, z, pal, 1.0, 0.32, 0.05, 3);
    airRing(c, x, y, z, 0, 1, 0, r * 0.2, r, pal, 0.3, 1.4, 0.16, 1);
    flare(c, x, y, z, r * 1.2, pal, 0.3, 1.3);
  }
  c.lights.flash(x, y + 0.5, z, pal.color, big ? 16 : 8, big ? 46 : 24, big ? 0.4 : 0.25, big ? 0.06 : 0);
}

const balllightning: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    pop(c, e.x, e.y, e.z, 1.8, 1.3);
    c.P.sphere(ZAP, 14, e.x, e.y, e.z, 3, 9);
    n.h[0] = live(c.B.orbs); n.h[1] = live(c.B.glyphs);
    const gy = c.groundY(e.x, e.z, e.y);
    const zr = ZONES.balllightning?.radius ?? 5; // the radius inside which it zaps
    const d = c.decals.begin(DS.RING, e.x, gy, e.z, zr, 60);
    d.p1 = 28; d.p2 = 0.12; d.extX = d.extZ = 1.06; d.fadeIn = 0.3; d.c0(pal.color, 1.2, 0.85).c1(pal.color, 1.6);
    n.h[2] = c.decals.commit();
    n.h[3] = groundGlow(c, e.x, gy, e.z, 2.6, pal.color, 0.5, 60, 0.3);
    n.f[2] = e.x; n.f[3] = e.z;
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    const pulse = 1 + 0.06 * Math.sin(c.now * 23);
    I.reset().pos(e.x, e.y, e.z).scale(0.95 * pulse); I.style = 1; I.c0(pal.color, 2.0).c1(pal.core, 0.9);
    c.B.orbs.write(n.h[0], I);
    I.reset().pos(e.x, e.y, e.z).scale(3.6); I.style = 2; I.c0(pal.color, 0.5).c1(pal.core, 0.2);
    c.B.glyphs.write(n.h[1], I);
    // crawling arcs
    n.f[0] -= dt;
    if (n.f[0] <= 0) {
      n.f[0] = rr(0.05, 0.1);
      const a = rnd() * TAU, u = rnd2(), s = Math.sqrt(1 - u * u), len = rr(0.9, 1.7);
      bolt(c, e.x, e.y, e.z, e.x + Math.cos(a) * s * len, e.y + u * len, e.z + Math.sin(a) * s * len, pal, 0.16, 0.1, 0.2, 0, true);
    }
    n.f[1] -= dt;
    const gy = c.groundY(e.x, e.z, e.y);
    if (n.f[1] <= 0 && e.y - gy < 4) {
      n.f[1] = rr(0.22, 0.45);
      const a = rnd() * TAU, d = rr(0.3, 2.0);
      const gx = e.x + Math.cos(a) * d, gz = e.z + Math.sin(a) * d;
      bolt(c, e.x, e.y, e.z, gx, gy + 0.05, gz, pal, 0.2, 0.13, 0.14, 1, true);
      P.sphere(ZAP, 4, gx, gy + 0.1, gz, 1, 4);
    }
    P.sphere(ZAP, 12 * dt, e.x, e.y, e.z, 2, 6, 1, 0.7);
    if (Math.abs(e.x - n.f[2]) + Math.abs(e.z - n.f[3]) > 0.3) {
      n.f[2] = e.x; n.f[3] = e.z;
      c.decals.move(n.h[2], e.x, gy, e.z); c.decals.move(n.h[3], e.x, gy, e.z);
    }
    c.lights.hold(LIGHT_KEY + e.id, e.x, e.y, e.z, pal.color, 1.8, 13);
  },
  despawn(c, n, why) {
    c.usePal(n.pal);
    c.decals.release(n.h[2], 0.2); c.decals.release(n.h[3], 0.2);
    if (why === 4) zapBurst(c, n, n.ex, n.ey, n.ez, 5.6, true);
    else if (why === 0) { c.P.sphere(ZAP, 12, n.ex, n.ey, n.ez, 2, 6); c.P.sphere(ARC, 6, n.ex, n.ey, n.ez, 0, 1, 1); c.P.emit(GLOW, n.ex, n.ey, n.ez, 0, 0, 0, 1.6); }
    else zapBurst(c, n, n.ex, n.ey, n.ez, 3.2, false);
  },
  free(c, n) { c.B.orbs.kill(n.h[0]); c.B.glyphs.kill(n.h[1]); },
};

const thunderstrike: KindDef = {
  spawn(c, n) {
    n.h[0] = telegraph(c, n);
    n.h[1] = live(c.B.beams);
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    const k = Math.min(1, e.age / Math.max(e.p, 1e-3));
    // a hair-thin leader shows where the sky will open
    I.reset().pos(e.x, e.y + 0.1, e.z).aimZ(0, 1, 0).scale(0.025 + 0.035 * k, 0.025 + 0.035 * k, 46); I.style = 1;
    I.c0(pal.color, 0.3 + 1.0 * k * k).c1(pal.core, 0.3 + 1.0 * k * k);
    c.B.beams.write(n.h[1], I);
    // static dances inside the ring, faster and faster
    n.f[0] -= dt;
    if (n.f[0] <= 0) {
      n.f[0] = 0.1 - 0.06 * k;
      const a = rnd() * TAU, r1 = Math.sqrt(rnd()) * e.r * 0.9, a2 = a + rr(0.4, 1.4), r2 = Math.sqrt(rnd()) * e.r * 0.9;
      const ax = e.x + Math.cos(a) * r1, az = e.z + Math.sin(a) * r1, bx = e.x + Math.cos(a2) * r2, bz = e.z + Math.sin(a2) * r2;
      bolt(c, ax, c.groundY(ax, az, e.y) + 0.12, az, bx, c.groundY(bx, bz, e.y) + 0.12, bz, pal, 0.14, 0.1, 0.16, 0, false);
    }
    P.disc(ZAP, (10 + 40 * k) * dt, e.x, e.y + 0.1, e.z, e.r * 0.9, 0, 3 + 6 * k, 0);
  },
  despawn(c, n, why) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    c.decals.release(n.h[0], 0.12);
    if (why !== 3) return;
    const x = n.ex, z = n.ez, r = e.r, y = c.groundY(x, z, n.ey);
    const sx = x + rnd2() * 7, sz = z + rnd2() * 7, top = y + 58;
    bolt(c, sx, top, sz, x, y, z, pal, 1.5, 0.34, 0.045, 4);
    bolt(c, sx, top, sz, x, y, z, pal, 0.7, 0.26, 0.08, 2, false, 0.03);
    bolt(c, sx + 2, top, sz - 2, x + rnd2(), y, z + rnd2(), pal, 0.5, 0.2, 0.1, 1, false, 0.07);
    // the column of light the bolt leaves on the eye
    I.reset().pos(x, y, z).aimZ(0, 1, 0).scale(r * 0.2, r * 0.2, 26); I.style = 4; I.p1 = 0.5; I.p2 = 0.6; I.life = 0.2;
    I.c0(pal.color, 1.6).c1(pal.core, 1.6);
    c.B.beams.spawn(I);
    pop(c, x, y + 0.8, z, r * 1.5, r * 1.4);
    flare(c, x, y + 1, z, r * 1.2, pal, 0.24, 1.0);
    const spokes = c.d(10);
    for (let i = 0; i < spokes; i++) {
      const a = (i + rnd()) / spokes * TAU, gx = x + Math.cos(a) * r * 0.98, gz = z + Math.sin(a) * r * 0.98;
      bolt(c, x, y + 0.15, z, gx, c.groundY(gx, gz, y) + 0.12, gz, pal, 0.3, rr(0.2, 0.32), 0.11, 1, true, 0.02);
    }
    P.hemi(ZAP, 80, x, y + 0.2, z, 6, 24, 1.2, 0.2);
    P.hemi(SPARK, 36, x, y + 0.2, z, 6, 20, 1.2, 0.1);
    P.sphere(ARC, 18, x, y + 0.8, z, 0, 4, 1.8, r * 0.5);
    P.ring(SMOKE_HOT, 8, x, y + 0.3, z, r * 0.4, 1.5, 2.5, 1.5, 0.3, 0.05);
    dust(c, x, y, z, 10, r * 0.5, 5, 1, 1.3, true);
    chunks(c, c.B.rocks, 9, x, y + 0.2, z, y, 6, 10, 0.2, c.rock, 0.55, pal.color, 1.2, 0, 0.5);
    dome(c, x, y, z, r, pal, 0.26, 1.5, 0, 0.6);
    shock(c, x, y, z, r, pal, 0.16, 0.1, 1.5, 0.4, 0);
    cracks(c, x, y, z, r * 0.9, pal.color, 5, 0.12, 1.6, 2.6);
    scorch(c, x, y, z, r * 0.6, pal, 6, 1.4);
    c.lights.flash(x, y + 2.5, z, pal.core, 16, 50, 0.28, 0.05);
  },
  free(c, n) { c.B.beams.kill(n.h[1]); },
};

// =========================================================================================== STONE

function rockBurst(c: Ctx, n: Ent, x: number, y: number, z: number, r: number, power: number): void {
  const pal = c.usePal(n.pal), P = c.P;
  const grounded = c.nearGround(x, y, z, r);
  const gy = grounded ? c.groundY(x, z, y) : y - 3;
  P.colA.copy(pal.color).multiplyScalar(0.55);
  P.sphere(DEBRIS, 26 * power, x, y, z, 3, 11, 1.2);
  P.colA.copy(surfDust(c.surface(x, z, y))).lerp(pal.color, 0.5);
  P.sphere(DUST_BIG, 9 * power, x, y, z, 1.5, r * 2.6, 0.7 + r * 0.25);
  P.sphere(DUST, 8 * power, x, y, z, 1, r * 2, 1);
  P.sphere(SPARK, 8 * power, x, y, z, 3, 10);
  pop(c, x, y, z, r * 0.8);
  chunks(c, c.B.rocks, 12 * power, x, y, z, gy, r * 3.2, 6.5, 0.26, pal.color, 0.5, pal.core, 0.6, 0, 0, n.dx, n.dz, 2);
  if (grounded) {
    shock(c, x, gy, z, r, pal, 0.18, 0.09, 0.8, 0.25);
    cracks(c, x, gy, z, r * 0.9, pal.color, 5, 0.1, 0.8);
  }
  c.lights.flash(x, y + 0.5, z, pal.core, 2.2 * power, 12, 0.15);
}

function rockLive(c: Ctx, n: Ent, slot: number, scale: number): void {
  const e = n.e, pal = n.pal;
  n.f[0] += c.dt * (7 + scale * 2);
  I.reset().pos(e.x, e.y, e.z).yaw(n.f[1]).pitch(-n.f[0]).scale(scale, scale * 0.86, scale * 0.94);
  I.style = 0; I.c0(pal.color, 0.5).c1(pal.core, 0.7);
  c.B.rocks.write(slot, I);
}

const boulder: KindDef = {
  spawn(c, n) {
    const e = n.e; c.usePal(n.pal);
    n.heading();
    n.f[1] = Math.atan2(n.dx, n.dz);
    n.h[0] = live(c.B.rocks);
    c.P.colA.copy(n.pal.color).multiplyScalar(0.6);
    c.P.sphere(DEBRIS, 8, e.x, e.y, e.z, 1, 5);
    c.P.colA.copy(n.pal.color).multiplyScalar(0.9);
    c.P.sphere(DUST, 6, e.x, e.y, e.z, 0.5, 2.5, 1.1);
  },
  update(c, n) {
    const e = n.e; c.usePal(n.pal);
    n.heading();
    rockLive(c, n, n.h[0], 0.86);
    c.P.colA.copy(n.pal.color).multiplyScalar(0.8);
    trail(c, DUST, 1.1, n.px, n.py, n.pz, e.x, e.y, e.z, 0.35, 0, 0, 0, 0.9);
    c.P.colA.copy(n.pal.color).multiplyScalar(0.55);
    trail(c, DEBRIS, 0.7, n.px, n.py, n.pz, e.x, e.y, e.z, 0.4, n.dx * 4, 0, n.dz * 4, 0.8);
  },
  despawn(c, n, why) {
    if (why === 0) {
      c.usePal(n.pal);
      chunks(c, c.B.rocks, 5, n.ex, n.ey, n.ez, c.groundY(n.ex, n.ez, n.ey), 2, 2, 0.24, n.pal.color, 0.5, n.pal.core, 0.6, 0);
      c.P.colA.copy(n.pal.color).multiplyScalar(0.8);
      c.P.sphere(DUST, 6, n.ex, n.ey, n.ez, 0.5, 2);
    } else rockBurst(c, n, n.ex, n.ey, n.ez, 2.0, 1);
  },
  free(c, n) { c.B.rocks.kill(n.h[0]); },
};

const rockshard: KindDef = {
  spawn(c, n) { n.heading(); n.f[1] = rnd() * TAU; n.h[0] = live(c.B.rocks); },
  update(c, n) {
    const e = n.e; c.usePal(n.pal);
    n.heading();
    rockLive(c, n, n.h[0], 0.3);
    c.P.colA.copy(n.pal.color).multiplyScalar(0.8);
    trail(c, DUST, 0.45, n.px, n.py, n.pz, e.x, e.y, e.z, 0.1, 0, 0, 0, 0.5);
  },
  despawn(c, n, why) {
    if (why === 0) return;
    const pal = c.usePal(n.pal);
    c.P.colA.copy(pal.color).multiplyScalar(0.55);
    c.P.sphere(DEBRIS, 9, n.ex, n.ey, n.ez, 2, 7, 0.9);
    c.P.colA.copy(pal.color).multiplyScalar(0.85);
    c.P.sphere(DUST, 4, n.ex, n.ey, n.ez, 0.5, 2.5, 0.8);
    c.P.sphere(SPARK, 4, n.ex, n.ey, n.ez, 2, 7);
    chunks(c, c.B.rocks, 2, n.ex, n.ey, n.ez, c.groundY(n.ex, n.ez, n.ey), 3, 3, 0.1, pal.color, 0.5, pal.core, 0.6, 0);
  },
  free(c, n) { c.B.rocks.kill(n.h[0]); },
};

const RISE = 0.25;
function writeWall(c: Ctx, n: Ent, heightK: number, glow: number): void {
  const e = n.e, pal = n.pal;
  const sink = 0.35; // buried skirt so the base never floats on a slope
  I.reset().pos(e.x, e.y - sink, e.z).yaw(-e.yaw).scale(e.p, (e.q + sink) * heightK, e.r * 2);
  I.style = 3; I.p1 = (e.q + sink) * heightK; I.p2 = glow;
  I.c0(pal.color, 0.42).c1(pal.core, 1.0);
  c.B.slabs.write(n.h[0], I);
}
function wallPoint(n: Ent, s: number, side: number, out: Float32Array): void {
  // s in [-0.5, 0.5] along the wall, side -1/0/+1 across it
  const e = n.e, cs = Math.cos(e.yaw), sn = Math.sin(e.yaw);
  out[14] = e.x + cs * s * e.p - sn * side * e.r; out[15] = e.z + sn * s * e.p + cs * side * e.r;
}

const rampart: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    n.h[0] = live(c.B.slabs);
    const fresh = e.age < RISE;
    // rubble footing and a broken crest: break the box silhouette without leaving the collider by more than a hand
    const rem = Math.max(0.3, e.life - e.age);
    const base = c.d(12), crest = c.d(7);
    for (let i = 0; i < base + crest; i++) {
      const top = i >= base;
      const s = rnd() - 0.5, side = top ? rnd2() * 0.5 : (rnd() < 0.5 ? -1 : 1);
      wallPoint(n, s * 0.96, side, n.f);
      const x = n.f[14], z = n.f[15];
      const size = top ? rr(0.28, 0.42) : rr(0.25, 0.5);
      const y = top ? e.y + e.q - size * 0.72 : c.groundY(x, z, e.y) + size * 0.2;
      I.reset().pos(x, y, z).randomRot().scale(size * rr(0.9, 1.4), size, size * rr(0.8, 1.2));
      I.delay = fresh ? (top ? RISE * 0.8 : rnd() * 0.12) : 0;
      I.style = 0; I.life = rem + 0.3 - I.delay; I.growIn = 0.22; I.shrinkOut = 0.25;
      I.c0(pal.color, 0.42 * rr(0.8, 1.15)).c1(pal.core, 0.5);
      if (2 + i < 30) { n.h[2 + i] = c.B.rocks.spawn(I); n.f[16 + i] = c.B.rocks.deathOf(n.h[2 + i]); }
    }
    if (!fresh) return;
    const d = c.decals.begin(DS.STRIP, e.x, e.y, e.z, e.p * 0.5 + 0.5, 8);
    d.rot = e.yaw; d.extX = 1.05; d.extZ = (e.r + 1.3) / (e.p * 0.5 + 0.5); d.fuse = 0.12; d.p1 = (e.r + 0.9) / (e.p * 0.5 + 0.5); d.p2 = 1;
    d.fadeIn = 0.01; d.fadeOut = 1.5; d.c0(pal.color, 1.5).c1(pal.core, 1.6);
    c.decals.commit();
    for (let i = P.n(26); i > 0; i--) {
      const s = rnd() - 0.5, side = rnd() < 0.5 ? -1 : 1;
      wallPoint(n, s, side * 1.2, n.f);
      const ox = -Math.sin(e.yaw) * side, oz = Math.cos(e.yaw) * side;
      P.colA.copy(surfDust(c.surface(n.f[14], n.f[15], e.y))).lerp(pal.color, 0.4);
      P.emit(DUST_BIG, n.f[14], e.y + rr(0.1, 0.6), n.f[15], ox * rr(1.5, 5), rr(0.5, 2.5), oz * rr(1.5, 5), 1.1, rnd() * 0.18);
    }
    P.colA.copy(pal.color).multiplyScalar(0.55);
    for (let i = P.n(40); i > 0; i--) {
      const s = rnd() - 0.5, side = rnd() < 0.5 ? -1 : 1;
      wallPoint(n, s, side * 1.1, n.f);
      P.emit(DEBRIS, n.f[14], e.y + 0.2, n.f[15], -Math.sin(e.yaw) * side * rr(1, 5) + rnd2(), rr(4, 11), Math.cos(e.yaw) * side * rr(1, 5) + rnd2(), 1.2, rnd() * 0.2);
    }
    c.lights.flash(e.x, e.y + 1, e.z, pal.core, 2.5, 14, 0.25);
  },
  update(c, n, dt) {
    const e = n.e; c.usePal(n.pal);
    const k = Math.min(1, e.age / RISE), rise = 1 - (1 - k) * (1 - k) * (1 - k);
    writeWall(c, n, rise, Math.max(0, 1 - e.age / 0.9));
    // grit trickles off the crest
    const drops = c.P.n(1.4 * dt);
    for (let i = 0; i < drops; i++) {
      wallPoint(n, rnd() - 0.5, rnd() < 0.5 ? -1.05 : 1.05, n.f);
      c.P.colA.copy(n.pal.color).multiplyScalar(0.7);
      c.P.emit(DUST, n.f[14], e.y + e.q * rr(0.5, 1), n.f[15], 0, -1.5, 0, 0.5);
    }
  },
  despawn(c, n, why) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    const shattered = why === 4;
    for (let i = 2; i < 30; i++) c.B.rocks.cut(n.h[i], n.f[14 + i], shattered ? 0.05 : 0.3);
    // which way do the pieces go? away from whoever broke it
    let ox = -Math.sin(e.yaw), oz = Math.cos(e.yaw);
    const owner = c.fighters.get(e.o);
    if (owner && (e.x - owner.x) * ox + (e.z - owner.z) * oz < 0) { ox = -ox; oz = -oz; }
    const count = c.d(shattered ? 34 : 20);
    for (let i = 0; i < count; i++) {
      const s = rnd() - 0.5, hgt = rnd() * e.q;
      wallPoint(n, s, rnd2() * 0.8, n.f);
      const x = n.f[14], z = n.f[15], gy = c.groundY(x, z, e.y);
      const vo = shattered ? rr(5, 15) : rr(0, 1.6), vu = shattered ? rr(1, 7) : rr(-1, 1.5);
      const size = rr(0.22, shattered ? 0.5 : 0.6), g = 22, h = Math.max(0, e.y + hgt - gy);
      const disc = Math.max(0, vu * vu + 2 * g * h);
      I.reset().pos(x, e.y + hgt, z).vel(ox * vo + rnd2() * 2, vu, oz * vo + rnd2() * 2).randomRot().scale(size * rr(0.8, 1.3), size, size * rr(0.8, 1.2));
      I.grav = g; I.tHit = (vu + Math.sqrt(disc)) / g; I.spin = rr(3, 9); I.life = I.tHit + rr(0.4, 1.0); I.shrinkOut = 0.35;
      I.style = 0; I.c0(pal.color, 0.42 * rr(0.8, 1.15)).c1(pal.core, 0.6);
      c.B.rocks.spawn(I);
    }
    for (let i = P.n(shattered ? 34 : 22); i > 0; i--) {
      wallPoint(n, rnd() - 0.5, rnd2(), n.f);
      P.colA.copy(pal.color).multiplyScalar(0.85);
      P.emit(DUST_BIG, n.f[14], e.y + rnd() * e.q, n.f[15], ox * (shattered ? rr(2, 9) : 0) + rnd2(), rr(-0.5, 1.5), oz * (shattered ? rr(2, 9) : 0) + rnd2(), 1.2, rnd() * 0.1);
    }
    P.colA.copy(pal.color).multiplyScalar(0.55);
    for (let i = P.n(shattered ? 60 : 24); i > 0; i--) {
      wallPoint(n, rnd() - 0.5, rnd2(), n.f);
      P.emit(DEBRIS, n.f[14], e.y + rnd() * e.q, n.f[15], ox * (shattered ? rr(3, 16) : 0) + rnd2() * 2, rr(0, shattered ? 8 : 2), oz * (shattered ? rr(3, 16) : 0) + rnd2() * 2, 1.2);
    }
    if (shattered) {
      pop(c, e.x, e.y + e.q * 0.5, e.z, 3.2, 2.4);
      c.P.sphere(SPARK, 24, e.x, e.y + e.q * 0.5, e.z, 5, 16);
      shock(c, e.x, e.y, e.z, e.p * 0.5, pal, 0.2, 0.08, 0.9, 0.2);
      c.lights.flash(e.x, e.y + 1.5, e.z, pal.core, 5, 20, 0.2);
      c.B.slabs.kill(n.h[0]); n.h[0] = -1;
    } else {
      n.linger = 0.4; // the wall slumps back into the ground
    }
  },
  after(c, n) {
    c.usePal(n.pal);
    const k = Math.max(0, n.linger / 0.4);
    writeWall(c, n, k * k, 0);
  },
  free(c, n) { c.B.slabs.kill(n.h[0]); },
};

// ===========================================================================================

export const KINDS_A: KindTable = {
  fireball, meteor, firepatch: firezone, cindertrail: firezone,
  iceshard, spikes, rimerune, icetrail,
  balllightning, thunderstrike,
  boulder, rockshard, rampart,
};

// Shared with the instant-effect module.
export { zapBurst, rockBurst, iceShatter };
// Keep the linter honest about presets used only on some quality paths.
void MOTE; void SPARK_FLOAT; void STAR; void pebbles;
