// Entity visuals: Gale, Tide, Umbra, Dawn and the health rune.

import type { Ctx } from './ctx';
import { surfDust } from './ctx';
import type { Ent, KindDef, KindTable } from './entity';
import { DS } from './core/decals';
import { SS } from './core/strips';
import { I } from './core/inst';
import { GLYPH_HEAL } from './core/atlas';
import { rnd, rnd2, rr } from './core/rand';
import {
  BUBBLET, CURL, DROP, DUST, FLECK, FOAM, GATHER, GLINT, GLOW, GUST_PUFF, MOTE, RAY, RINGPUFF, SHADOW, SHADOW_GLOW, SHADOW_MOTE,
  SPARK_FLOAT, SPRAY, STAR, SUNMOTE, WIND, WISP,
} from './pdefs';
import { TAU, airRing, dust, faceRing, flare, gather, pop, ripple, trail } from './common';
import { live } from './kinds_a';

const LIGHT_KEY = 100000;

/** Length of a channel / beam after the world has had its say. */
function reach(c: Ctx, x: number, y: number, z: number, dx: number, dy: number, dz: number, max: number): number {
  const hit = c.world.raycast(x + dx * 0.6, y + dy * 0.6, z + dz * 0.6, dx, dy, dz, max - 0.6);
  return hit ? hit.t + 0.6 : max;
}

// =========================================================================================== GALE

const gustblade: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    pop(c, e.x, e.y, e.z, 0.9);
    c.P.cone(CURL, 4, e.x, e.y, e.z, n.dx, n.dy, n.dz, 0.8, 2, 6, 0.8);
    n.h[0] = live(c.B.arcs); n.h[1] = live(c.B.arcs);
    for (let i = 0; i < 2; i++) {
      const s = (n.s[i] = c.strips.ribbon(SS.WIND, 0.55, 0.15, 0.6));
      if (s) s.color(pal.core, 1.9, pal.color, 1.0);
    }
  },
  update(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    const R = e.r * 1.22; // arc radius whose chord is the blade's true width
    const ox = e.x - n.dx * R * 0.88, oy = e.y - n.dy * R * 0.88, oz = e.z - n.dz * R * 0.88;
    const fadeOut = Math.min(1, Math.max(0, (e.life - e.age) / 0.12));
    for (let i = 0; i < 2; i++) {
      I.reset().pos(ox, oy, oz).aimZ(-n.dx, -n.dy, -n.dz);
      if (i === 1) I.roll(Math.PI / 2);
      I.scale(i === 0 ? R : R * 0.62); I.style = 2; I.p1 = i === 0 ? 2.0 : 1.5; I.p2 = 0.68;
      I.c0(pal.color, 1.3, fadeOut).c1(pal.core, 1.5);
      c.B.arcs.write(n.h[i], I);
    }
    // perpendicular (horizontal) for the two wing-tip ribbons
    let px = -n.dz, pz = n.dx; const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
    n.s[0]?.move(e.x + px * e.r * 0.95, e.y, e.z + pz * e.r * 0.95, c.now);
    n.s[1]?.move(e.x - px * e.r * 0.95, e.y, e.z - pz * e.r * 0.95, c.now);
    trail(c, WIND, 1.6, n.px, n.py, n.pz, e.x, e.y, e.z, e.r * 0.8, n.dx * 9, n.dy * 9, n.dz * 9);
    trail(c, CURL, 0.3, n.px, n.py, n.pz, e.x, e.y, e.z, e.r * 0.6, n.dx * 4, 0.3, n.dz * 4, 0.8);
    trail(c, GUST_PUFF, 0.4, n.px, n.py, n.pz, e.x, e.y, e.z, e.r * 0.5, n.dx * 3, 0, n.dz * 3, 0.9);
  },
  despawn(c, n, why) {
    c.usePal(n.pal);
    c.P.cone(WISP, 8, n.ex, n.ey, n.ez, n.dx, n.dy, n.dz, 1.2, 2, 8, 0.9);
    c.P.sphere(GUST_PUFF, 5, n.ex, n.ey, n.ez, 0.5, 3, 1);
    if (why === 1) { c.P.sphere(WIND, 14, n.ex, n.ey, n.ez, 4, 12); dust(c, n.ex, c.groundY(n.ex, n.ez, n.ey), n.ez, 6, 0.5, 3, 0.8); }
  },
  free(c, n) { c.B.arcs.kill(n.h[0]); c.B.arcs.kill(n.h[1]); },
};

const FUNNEL_H = 7.2;
const funnelR = (h: number) => 0.16 + 0.84 * Math.pow(h, 1.5);

const cyclone: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.h[0] = live(c.B.funnels);
    const d = c.decals.begin(DS.RING, e.x, e.y, e.z, e.r, 60);
    d.p1 = 0; d.p2 = 0.3; d.extX = d.extZ = 1.08; d.fadeIn = 0.25; d.c0(pal.color, 1.0).c1(pal.core, 1.9);
    n.h[1] = c.decals.commit();
    for (let i = 0; i < 3; i++) {
      const s = (n.s[i] = c.strips.path(SS.WIND, 0.6, 24));
      if (s) s.color(pal.core, 1.7, pal.color, 1.1);
    }
    n.f[2] = e.x; n.f[3] = e.z;
    c.P.ring(CURL, 10, e.x, e.y + 0.4, e.z, 1.2, 3, 2, 1.2);
    dust(c, e.x, e.y, e.z, 12, 1, 4, 1.5, 1.3, true);
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    const rise = Math.min(1, e.age / 0.4), fade = Math.min(1, Math.max(0, (e.life - e.age) / 0.4));
    const R = e.r * 0.93, H = FUNNEL_H * (1 - (1 - rise) * (1 - rise));
    I.reset().pos(e.x, e.y, e.z).scale(R, H, R); I.c0(pal.color, 1.0, fade).c1(pal.core, 1.1, 1);
    c.B.funnels.write(n.h[0], I);
    // three ropes of wind wound round the funnel
    for (let j = 0; j < 3; j++) {
      const s = n.s[j];
      if (!s) continue;
      s.alpha = fade * rise;
      for (let i = 0; i < 24; i++) {
        const h = i / 23, a = j * 2.094 - c.now * (8.5 - 3 * h) + h * 7.5;
        const rad = funnelR(h) * R * 1.07;
        s.set(i, e.x + Math.cos(a) * rad, e.y + 0.1 + h * H * 0.96, e.z + Math.sin(a) * rad, Math.sin(h * Math.PI) * 0.9 + 0.1, Math.sin(h * Math.PI));
      }
    }
    // dust skirt, lifted flecks, and streaks being dragged in from the pull radius
    const surf = c.surface(e.x, e.z, e.y);
    P.colA.copy(surfDust(surf));
    for (let i = P.n(26 * fade * dt); i > 0; i--) {
      const a = rnd() * TAU, r = rr(0.5, e.r * 0.8), cs = Math.cos(a), sn = Math.sin(a);
      P.emit(DUST, e.x + cs * r, e.y + 0.2, e.z + sn * r, -sn * 5 + e.vx, rr(0.5, 2.5), cs * 5 + e.vz, 1.1);
    }
    for (let i = P.n(16 * fade * dt); i > 0; i--) {
      const a = rnd() * TAU, r = rr(0.4, 1.4), cs = Math.cos(a), sn = Math.sin(a);
      P.emit(FLECK, e.x + cs * r, e.y + 0.3, e.z + sn * r, -sn * 7 + e.vx, rr(4, 9), cs * 7 + e.vz, 1.2);
    }
    for (let i = P.n(20 * fade * dt); i > 0; i--) {
      const a = rnd() * TAU, r = rr(4.5, 7.5), cs = Math.cos(a), sn = Math.sin(a);
      P.emit(WIND, e.x + cs * r, e.y + rr(0.2, 1.4), e.z + sn * r, -cs * 11 - sn * 4 + e.vx, 0.6, -sn * 11 + cs * 4 + e.vz, 1.1);
    }
    for (let i = P.n(7 * fade * dt); i > 0; i--) {
      const h = rnd(), a = rnd() * TAU, rad = funnelR(h) * R;
      P.emit(CURL, e.x + Math.cos(a) * rad, e.y + h * H, e.z + Math.sin(a) * rad, -Math.sin(a) * 4, 1.5, Math.cos(a) * 4, 1.1);
    }
    if (Math.abs(e.x - n.f[2]) + Math.abs(e.z - n.f[3]) > 0.25) { n.f[2] = e.x; n.f[3] = e.z; c.decals.move(n.h[1], e.x, e.y, e.z); }
  },
  despawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    c.decals.release(n.h[1], 0.3);
    I.reset().pos(e.x, e.y, e.z).scale(e.r * 0.93, FUNNEL_H, e.r * 0.93); I.c0(pal.color, 1.25).c1(pal.core, 1.6); I.life = 0.3; I.shrinkOut = 0.3; I.scaleEnd = 1.25;
    c.B.funnels.finish(n.h[0], I); n.h[0] = -1;
    n.endStrips(0.3);
    c.P.ring(CURL, 12, e.x, e.y + 1.5, e.z, 1.5, 5, 2, 1.3);
    c.P.ring(GUST_PUFF, 10, e.x, e.y + 0.6, e.z, 1.2, 5, 1, 1.4);
    c.P.ring(WIND, 20, e.x, e.y + 1, e.z, 1.5, 12, 2);
  },
  free(c, n) { c.B.funnels.kill(n.h[0]); },
};

const jetstream: KindDef = {
  spawn(c, n) {
    const e = n.e; c.usePal(n.pal);
    n.h[0] = live(c.B.beams); n.h[1] = live(c.B.beams);
    n.heading();
    pop(c, e.x, e.y, e.z, 1.0);
    airRing(c, e.x + n.dx, e.y + n.dy, e.z + n.dz, n.dx, n.dy, n.dz, 0.4, e.q * 0.6, n.pal, 0.25, 0.8, 0.2);
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    n.heading();
    n.f[1] -= dt;
    if (n.f[1] <= 0) { n.f[1] = 0.08; n.f[0] = reach(c, e.x, e.y, e.z, n.dx, n.dy, n.dz, e.p); }
    const L = n.f[0], rad = e.q * 0.5;
    const k = Math.min(1, e.age / 0.12) * Math.min(1, Math.max(0, (e.life - e.age) / 0.1));
    I.reset().pos(e.x + n.dx * 0.5, e.y + n.dy * 0.5, e.z + n.dz * 0.5).aimZ(n.dx, n.dy, n.dz).scale(rad * 0.9, rad * 0.9, L - 0.5); I.style = 3; I.p1 = 1.08;
    I.c0(pal.color, 0.6, k).c1(pal.core, 0.8);
    c.B.beams.write(n.h[0], I);
    I.reset().pos(e.x + n.dx * 0.5, e.y + n.dy * 0.5, e.z + n.dz * 0.5).aimZ(n.dx, n.dy, n.dz).scale(rad * 0.5, rad * 0.5, L - 0.5); I.style = 3; I.p1 = 1.2;
    I.c0(pal.core, 0.5, k).c1(pal.core, 0.7);
    c.B.beams.write(n.h[1], I);
    // streaks racing down the tube
    let ax: number, ay: number, az: number;
    if (Math.abs(n.dy) < 0.95) { ax = n.dz; ay = 0; az = -n.dx; } else { ax = 1; ay = 0; az = 0; }
    const al = 1 / Math.hypot(ax, ay, az); ax *= al; ay *= al; az *= al;
    const bx = n.dy * az - n.dz * ay, by = n.dz * ax - n.dx * az, bz = n.dx * ay - n.dy * ax;
    for (let i = P.n(64 * dt); i > 0; i--) {
      const t = rnd() * L * 0.72, a = rnd() * TAU, r = Math.sqrt(rnd()) * rad * 0.92, cs = Math.cos(a) * r, sn = Math.sin(a) * r;
      P.emit(WIND, e.x + n.dx * t + ax * cs + bx * sn, e.y + n.dy * t + ay * cs + by * sn, e.z + n.dz * t + az * cs + bz * sn, n.dx * 40, n.dy * 40, n.dz * 40, 1.3, 0, Math.min(1, (L - t) / 15));
    }
    for (let i = P.n(9 * dt); i > 0; i--) { const t = rnd() * L * 0.8; P.emit(CURL, e.x + n.dx * t + rnd2() * rad * 0.7, e.y + n.dy * t + rnd2() * rad * 0.7, e.z + n.dz * t + rnd2() * rad * 0.7, n.dx * 14, n.dy * 14, n.dz * 14, 1.1); }
    for (let i = P.n(10 * dt); i > 0; i--) { const t = rnd() * L; P.emit(GUST_PUFF, e.x + n.dx * t + rnd2() * rad * 0.6, e.y + n.dy * t + rnd2() * rad * 0.6, e.z + n.dz * t + rnd2() * rad * 0.6, n.dx * 10, n.dy * 10, n.dz * 10, 1.2); }
    n.f[2] -= dt;
    if (n.f[2] <= 0) { n.f[2] = 0.14; airRing(c, e.x + n.dx * 0.9, e.y + n.dy * 0.9, e.z + n.dz * 0.9, n.dx, n.dy, n.dz, 0.35, rad * 1.05, pal, 0.22, 0.35, 0.12); }
    // where the wind scours the ground
    if (L < e.p - 0.5) { const hx = e.x + n.dx * L, hy = e.y + n.dy * L, hz = e.z + n.dz * L; P.colA.copy(surfDust(c.surface(hx, hz, hy))); P.sphere(DUST, 14 * dt, hx, hy, hz, 1, 5, 1.2); }
  },
  despawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal), L = n.f[0] || e.p;
    // the finishing blast runs the length of the tube
    for (let i = 0; i < 4; i++) { const t = L * (0.15 + 0.25 * i); airRing(c, e.x + n.dx * t, e.y + n.dy * t, e.z + n.dz * t, n.dx, n.dy, n.dz, e.q * 0.25, e.q * 0.62, pal, 0.3, 0.6, 0.14, 0, i * 0.035); }
    c.P.cone(WIND, 40, e.x + n.dx, e.y + n.dy, e.z + n.dz, n.dx, n.dy, n.dz, 0.12, 30, 60, 1.6);
    c.P.cone(GUST_PUFF, 10, e.x + n.dx * 2, e.y + n.dy * 2, e.z + n.dz * 2, n.dx, n.dy, n.dz, 0.2, 8, 24, 1.4);
  },
  free(c, n) { c.B.beams.kill(n.h[0]); c.B.beams.kill(n.h[1]); },
};

// =========================================================================================== TIDE

const waterjet: KindDef = {
  spawn(c, n) {
    const e = n.e; c.usePal(n.pal);
    n.h[0] = live(c.B.beams); n.h[1] = live(c.B.beams);
    n.heading();
    c.P.cone(DROP, 12, e.x, e.y, e.z, n.dx, n.dy, n.dz, 0.5, 3, 10);
    c.P.emit(FOAM, e.x + n.dx * 0.6, e.y + n.dy * 0.6, e.z + n.dz * 0.6, 0, 0, 0, 1.2);
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    n.heading();
    n.f[1] -= dt;
    if (n.f[1] <= 0) { n.f[1] = 0.06; n.f[0] = reach(c, e.x, e.y, e.z, n.dx, n.dy, n.dz, e.p); }
    // the stream takes a moment to cross the gap
    const L = Math.min(n.f[0], 0.6 + e.age * 90), rad = e.q * 0.5;
    const k = Math.min(1, Math.max(0, (e.life - e.age) / 0.1));
    const sx = e.x + n.dx * 0.55, sy = e.y + n.dy * 0.55, sz = e.z + n.dz * 0.55;
    I.reset().pos(sx, sy, sz).aimZ(n.dx, n.dy, n.dz).scale(rad * 0.86 * k, rad * 0.86 * k, L - 0.55); I.style = 2; I.p1 = 1.15;
    I.c0(pal.color, 1.0).c1(pal.dark, 1.6);
    c.B.beams.write(n.h[0], I);
    // a second, tighter skin so the stream has depth when you look through it
    I.reset().pos(sx, sy, sz).aimZ(n.dx, n.dy, n.dz).scale(rad * 0.5 * k, rad * 0.5 * k, L - 0.55); I.style = 2; I.p1 = 1.25;
    I.c0(pal.color, 1.3).c1(pal.color, 0.8);
    c.B.beams.write(n.h[1], I);
    for (let i = P.n(46 * dt); i > 0; i--) {
      const t = rnd() * L; unitPerp(n);
      P.emit(DROP, e.x + n.dx * t + PX * rad * 0.8, e.y + n.dy * t + PY * rad * 0.8, e.z + n.dz * t + PZ * rad * 0.8, n.dx * 9 + PX * 2.5, n.dy * 9 + PY * 2.5 + 1, n.dz * 9 + PZ * 2.5);
    }
    for (let i = P.n(22 * dt); i > 0; i--) { const t = rnd() * L; P.emit(SPRAY, e.x + n.dx * t, e.y + n.dy * t, e.z + n.dz * t, n.dx * 6 + rnd2(), n.dy * 6 + 0.5, n.dz * 6 + rnd2(), 0.8); }
    // the head of the jet: a blooming splash
    const hx = e.x + n.dx * L, hy = e.y + n.dy * L, hz = e.z + n.dz * L;
    P.cone(DROP, 44 * dt, hx, hy, hz, -n.dx, -n.dy + 0.6, -n.dz, 1.25, 3, 10);
    P.sphere(FOAM, 16 * dt, hx, hy, hz, 0.5, 3, 1.3);
    P.sphere(SPRAY, 12 * dt, hx, hy, hz, 1, 4, 1.4);
    n.f[2] -= dt;
    if (n.f[2] <= 0 && L < e.p - 0.3 && c.nearGround(hx, hy, hz, 1)) { n.f[2] = 0.22; ripple(c, hx, c.groundY(hx, hz, hy), hz, 1.5, pal, 1.2); }
  },
  despawn(c, n) {
    const e = n.e; c.usePal(n.pal);
    const L = Math.min(n.f[0] || e.p, 0.6 + e.age * 90);
    c.P.line(DROP, 30, e.x, e.y, e.z, e.x + n.dx * L, e.y + n.dy * L, e.z + n.dz * L, e.q * 0.4, n.dx * 6, n.dy * 6 + 1, n.dz * 6);
    c.P.line(SPRAY, 8, e.x, e.y, e.z, e.x + n.dx * L, e.y + n.dy * L, e.z + n.dz * L, e.q * 0.3, n.dx * 3, 0.5, n.dz * 3, 1);
  },
  free(c, n) { c.B.beams.kill(n.h[0]); c.B.beams.kill(n.h[1]); },
};

// random unit vector perpendicular to an entity's heading
let PX = 0, PY = 0, PZ = 0;
function unitPerp(n: Ent): void {
  let ax: number, ay: number, az: number;
  if (Math.abs(n.dy) < 0.95) { ax = n.dz; ay = 0; az = -n.dx; } else { ax = 1; ay = 0; az = 0; }
  const al = 1 / Math.hypot(ax, ay, az); ax *= al; ay *= al; az *= al;
  const bx = n.dy * az - n.dz * ay, by = n.dz * ax - n.dx * az, bz = n.dx * ay - n.dy * ax;
  const a = rnd() * TAU, cs = Math.cos(a), sn = Math.sin(a);
  PX = ax * cs + bx * sn; PY = ay * cs + by * sn; PZ = az * cs + bz * sn;
}

/** A bubble bursting (projectile or prison). */
export function bubblePop(c: Ctx, x: number, y: number, z: number, r: number): void {
  const P = c.P;
  P.sphere(DROP, 34, x, y, z, 3, 9, 1.1, r * 0.9);
  P.sphere(BUBBLET, 12, x, y, z, 1, 4, 1.2, r * 0.6);
  P.sphere(SPRAY, 6, x, y, z, 1, 3, 1.3, r * 0.5);
  P.emit(RINGPUFF, x, y, z, 0, 0, 0, r * 1.5);
  P.emit(FOAM, x, y, z, 0, 0, 0, r * 2.2);
  pop(c, x, y, z, r * 0.9);
}

const bubble: KindDef = {
  spawn(c, n) {
    const e = n.e; c.usePal(n.pal);
    n.h[0] = live(c.B.shells);
    n.heading();
    c.P.cone(BUBBLET, 9, e.x, e.y, e.z, n.dx, n.dy, n.dz, 0.9, 1, 4);
    c.P.emit(FOAM, e.x, e.y, e.z, 0, 0, 0, 1.4);
  },
  update(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    const grow = Math.min(1, e.age / 0.15);
    const wob = Math.sin(c.now * 9) * 0.05;
    I.reset().pos(e.x, e.y, e.z).scale(e.r * grow * (1 + wob), e.r * grow * (1 - wob), e.r * grow * (1 + wob)); I.style = 0;
    I.c0(pal.color, 1.2).c1(pal.core, 1.6);
    c.B.shells.write(n.h[0], I);
    trail(c, BUBBLET, 1.4, n.px, n.py, n.pz, e.x, e.y, e.z, e.r * 0.7, 0, 0.4, 0);
    trail(c, DROP, 0.7, n.px, n.py, n.pz, e.x, e.y - e.r * 0.6, e.z, e.r * 0.4, n.dx * 3, 0, n.dz * 3, 0.8);
  },
  despawn(c, n, why) {
    const e = n.e, pal = c.usePal(n.pal);
    if (why === 2) {
      // swallowed someone: the prison bubble on the fighter takes over
      I.reset().pos(n.ex, n.ey, n.ez).scale(e.r); I.style = 0; I.scaleEnd = 1.35; I.life = 0.16; I.shrinkOut = 0.16; I.c0(pal.color, 1.7).c1(pal.core, 2.2);
      c.B.shells.finish(n.h[0], I); n.h[0] = -1;
      c.P.sphere(BUBBLET, 8, n.ex, n.ey, n.ez, 1, 3, 1, e.r);
    } else bubblePop(c, n.ex, n.ey, n.ez, e.r);
  },
  free(c, n) { c.B.shells.kill(n.h[0]); },
};

const WAVE_THICK = 2.6;
const tidalwave: KindDef = {
  spawn(c, n) {
    const e = n.e; c.usePal(n.pal);
    n.h[0] = live(c.B.waves);
    const l = Math.hypot(e.vx, e.vz) || 1;
    n.dx = e.vx / l; n.dy = 0; n.dz = e.vz / l;
    // spray where the water tears out of the ground
    const cx = -n.dz, cz = n.dx;
    for (let i = c.P.n(26); i > 0; i--) { const s = rnd2() * e.p * 0.5; c.P.emit(SPRAY, e.x + cx * s, e.y + 0.3, e.z + cz * s, n.dx * 3, rr(2, 6), n.dz * 3, 1.5); }
    for (let i = c.P.n(34); i > 0; i--) { const s = rnd2() * e.p * 0.5; c.P.emit(DROP, e.x + cx * s, e.y + 0.3, e.z + cz * s, n.dx * rr(2, 7) + rnd2(), rr(4, 10), n.dz * rr(2, 7) + rnd2()); }
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    const l = Math.hypot(e.vx, e.vz);
    if (l > 1e-3) { n.dx = e.vx / l; n.dz = e.vz / l; }
    const k = Math.min(1, e.age / 0.2), rise = 1 - (1 - k) * (1 - k);
    const fall = Math.min(1, Math.max(0, (e.life - e.age) / 0.14));
    const H = e.q * rise * (0.35 + 0.65 * fall);
    I.reset().pos(e.x, e.y - 0.12, e.z).aimZ(n.dx, 0, n.dz).scale(e.p, H, WAVE_THICK); I.p1 = e.p;
    I.c0(pal.color, 1.0).c1(pal.dark, 1.5);
    c.B.waves.write(n.h[0], I);
    const cx = -n.dz, cz = n.dx, sp = l;
    // crest spray thrown forward, foam churning at the foot, mist hanging behind
    for (let i = P.n(46 * dt * rise); i > 0; i--) { const s = rnd2() * e.p * 0.47; P.emit(SPRAY, e.x + cx * s + n.dx * 0.7, e.y + H * rr(0.75, 0.98), e.z + cz * s + n.dz * 0.7, n.dx * sp * 0.75, rr(0, 2.5), n.dz * sp * 0.75, 1.3); }
    for (let i = P.n(70 * dt * rise); i > 0; i--) { const s = rnd2() * e.p * 0.48; P.emit(DROP, e.x + cx * s + n.dx * 0.8, e.y + H * rr(0.6, 1), e.z + cz * s + n.dz * 0.8, n.dx * sp * rr(0.9, 1.4) + rnd2(), rr(-1, 4), n.dz * sp * rr(0.9, 1.4) + rnd2()); }
    for (let i = P.n(40 * dt); i > 0; i--) { const s = rnd2() * e.p * 0.5; P.emit(FOAM, e.x + cx * s + n.dx * rr(0.2, 1.1), e.y + 0.25, e.z + cz * s + n.dz * rr(0.2, 1.1), n.dx * sp * 0.6, 0.6, n.dz * sp * 0.6, 1.3); }
    for (let i = P.n(16 * dt); i > 0; i--) { const s = rnd2() * e.p * 0.5; P.emit(SPRAY, e.x + cx * s - n.dx * 2, e.y + rr(0.3, 1.2), e.z + cz * s - n.dz * 2, n.dx * 2, 0.8, n.dz * 2, 1.6); }
    // wet ground left behind
    n.f[0] -= dt;
    if (n.f[0] <= 0) {
      n.f[0] = 0.2;
      for (let j = -1; j <= 1; j++) { const wx = e.x + cx * j * e.p * 0.3 - n.dx * 1.5, wz = e.z + cz * j * e.p * 0.3 - n.dz * 1.5; ripple(c, wx, c.groundY(wx, wz, e.y), wz, e.p * 0.2, pal, 1.5); }
    }
  },
  despawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    const cx = -n.dz, cz = n.dx;
    // the crash
    for (let i = P.n(80); i > 0; i--) { const s = rnd2() * e.p * 0.5; P.emit(DROP, e.x + cx * s, e.y + rr(0.3, 1.8), e.z + cz * s, n.dx * rr(3, 13) + rnd2() * 2, rr(3, 11), n.dz * rr(3, 13) + rnd2() * 2, 1.2); }
    for (let i = P.n(30); i > 0; i--) { const s = rnd2() * e.p * 0.5; P.emit(SPRAY, e.x + cx * s, e.y + rr(0.3, 1.5), e.z + cz * s, n.dx * rr(2, 8), rr(2, 6), n.dz * rr(2, 8), 2.0); }
    for (let i = P.n(26); i > 0; i--) { const s = rnd2() * e.p * 0.5; P.emit(FOAM, e.x + cx * s + n.dx * rnd() * 2, e.y + 0.3, e.z + cz * s + n.dz * rnd() * 2, n.dx * 5, 1, n.dz * 5, 1.8); }
    for (let j = -1; j <= 1; j++) { const wx = e.x + cx * j * e.p * 0.3 + n.dx * 1.5, wz = e.z + cz * j * e.p * 0.3 + n.dz * 1.5; ripple(c, wx, c.groundY(wx, wz, e.y), wz, e.p * 0.3, pal, 2.2); }
  },
  free(c, n) { c.B.waves.kill(n.h[0]); },
};

// =========================================================================================== UMBRA

const dagger: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    n.h[0] = live(c.B.blades);
    const s = (n.s[0] = c.strips.ribbon(SS.SMOKE, 0.34, 0.13, 0.5));
    if (s) s.color(pal.color, 1.6, pal.dark, 1.0);
    c.P.emit(SHADOW, e.x, e.y, e.z, n.dx, n.dy, n.dz, 0.5);
    n.f[0] = rnd() * TAU;
  },
  update(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    // spin about the flight axis so the edge catches the light
    I.reset().pos(e.x - n.dx * 0.55, e.y - n.dy * 0.55, e.z - n.dz * 0.55).scale(0.78);
    I.fromTo(0, 1, 0, n.dx, n.dy, n.dz);
    spinAbout(n.dx, n.dy, n.dz, n.f[0] + c.now * 18);
    I.style = 2; I.c0(pal.dark, 1.4).c1(pal.color, 2.0);
    c.B.blades.write(n.h[0], I);
    n.s[0]?.move(e.x - n.dx * 0.3, e.y - n.dy * 0.3, e.z - n.dz * 0.3, c.now);
    trail(c, SHADOW_MOTE, 0.7, n.px, n.py, n.pz, e.x, e.y, e.z, 0.08, 0, 0, 0, 0.8);
  },
  despawn(c, n, why) {
    c.usePal(n.pal);
    if (why === 0) { c.P.sphere(SHADOW, 2, n.ex, n.ey, n.ez, 0.2, 1, 0.5); return; }
    c.P.sphere(SHADOW, 4, n.ex, n.ey, n.ez, 0.5, 2.5, 0.6);
    c.P.sphere(SHADOW_GLOW, 3, n.ex, n.ey, n.ez, 0.5, 2, 0.6);
    c.P.cone(SPARK_FLOAT, 7, n.ex, n.ey, n.ez, -n.dx, -n.dy + 0.3, -n.dz, 1.2, 2, 8);
    pop(c, n.ex, n.ey, n.ez, 0.8);
  },
  free(c, n) { c.B.blades.kill(n.h[0]); },
};

/** Pre-multiply the scratch spec's rotation by a turn of `a` radians about a world axis. */
function spinAbout(ax: number, ay: number, az: number, a: number): void {
  const s = Math.sin(a * 0.5), w = Math.cos(a * 0.5), x = ax * s, y = ay * s, z = az * s;
  const bx = I.qx, by = I.qy, bz = I.qz, bw = I.qw;
  I.qx = w * bx + x * bw + y * bz - z * by;
  I.qy = w * by - x * bz + y * bw + z * bx;
  I.qz = w * bz + x * by - y * bx + z * bw;
  I.qw = w * bw - x * bx - y * by - z * bz;
}

const TENDRILS = 6, TPTS = 12;
const snare: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    const d = c.decals.begin(DS.SHADOW, e.x, e.y, e.z, e.r, Math.max(0.1, e.life - e.age));
    d.fuse = Math.max(e.p, 0.05); d.age = e.age; d.fadeIn = 0.1; d.fadeOut = 0.4; d.extX = d.extZ = 1.1;
    d.c0(pal.color, 1.3).c1(pal.core, 1.7);
    n.h[0] = c.decals.commit();
    for (let i = 0; i < TENDRILS; i++) {
      const s = (n.s[i] = c.strips.path(SS.SMOKE, 0.3, TPTS));
      if (s) { s.color(pal.color, 1.5, pal.color, 2.0); s.alpha = 0; s.width = 0.42; }
      const a = (i + rnd() * 0.6) / TENDRILS * TAU, r = e.r * rr(0.35, 0.82);
      n.f[4 + i * 4] = Math.cos(a) * r; n.f[5 + i * 4] = Math.sin(a) * r; n.f[6 + i * 4] = rnd() * TAU; n.f[7 + i * 4] = rr(1.3, 2.0);
    }
    if (e.age < 0.2) { c.P.ring(SHADOW, 10, e.x, e.y + 0.2, e.z, e.r * 0.3, 2.5, 0.3, 1.2); pop(c, e.x, e.y + 0.2, e.z, 1.2); }
  },
  update(c, n, dt) {
    const e = n.e; c.usePal(n.pal);
    const P = c.P;
    const armed = e.age >= e.p;
    const fade = Math.min(1, Math.max(0, (e.life - e.age) / 0.4));
    const up = Math.min(1, Math.max(0, (e.age - e.p) / 0.35)) * fade;
    if (armed && n.f[0] === 0) { n.f[0] = 1; P.ring(SHADOW_GLOW, 16, e.x, e.y + 0.2, e.z, e.r * 0.96, 0.4, 1.2, 1.1, 0.03); }
    // grasping tendrils: they rise, sway, and hook inward at the tip
    for (let i = 0; i < TENDRILS; i++) {
      const s = n.s[i];
      if (!s) continue;
      const bx = n.f[4 + i * 4], bz = n.f[5 + i * 4], ph = n.f[6 + i * 4], H = n.f[7 + i * 4] * up;
      s.alpha = up;
      const br = Math.hypot(bx, bz) || 1, ix = -bx / br, iz = -bz / br;
      const gy = c.groundY(e.x + bx, e.z + bz, e.y);
      for (let j = 0; j < TPTS; j++) {
        const h = j / (TPTS - 1);
        const sway = Math.sin(c.now * 2.4 + ph + h * 3.2) * 0.24 * h, sway2 = Math.cos(c.now * 1.9 + ph * 1.7 + h * 2.5) * 0.2 * h;
        const hook = h * h * 0.55 * (0.7 + 0.3 * Math.sin(c.now * 3 + ph));
        s.set(j, e.x + bx + ix * hook + sway * iz + sway2 * ix, gy + 0.05 + h * H * (1 - 0.25 * h * h), e.z + bz + iz * hook - sway * ix + sway2 * iz, 1 - 0.85 * h, 1);
      }
    }
    for (let i = P.n(7 * fade * dt); i > 0; i--) {
      const a = rnd() * TAU, r = e.r * rr(0.5, 0.95), cs = Math.cos(a), sn = Math.sin(a);
      P.emit(SHADOW, e.x + cs * r, e.y + 0.15, e.z + sn * r, -cs * 0.9, 0.25, -sn * 0.9, 0.9);
    }
    for (let i = P.n((armed ? 10 : 22) * fade * dt); i > 0; i--) {
      const a = rnd() * TAU, r = e.r * (armed ? rr(0.85, 0.99) : rr(0.2, 0.9));
      P.emit(SHADOW_MOTE, e.x + Math.cos(a) * r, e.y + 0.1, e.z + Math.sin(a) * r, 0, rr(0.3, 1.1), 0);
    }
  },
  despawn(c, n) {
    c.decals.release(n.h[0], 0.35);
    n.endStrips(0.3);
  },
};

const shade: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    n.h[0] = live(c.B.orbs);
    for (let i = 0; i < 2; i++) {
      const s = (n.s[i] = c.strips.ribbon(SS.SMOKE, 0.55, 0.24, 0.4));
      if (s) s.color(pal.color, 1.7, pal.dark, 1.0);
    }
    c.P.sphere(SHADOW, 6, e.x, e.y, e.z, 0.5, 2.5, 0.8);
    pop(c, e.x, e.y, e.z, 0.8);
  },
  update(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    I.reset().pos(e.x, e.y, e.z).aimZ(n.dx, n.dy, n.dz).scale(0.5, 0.5, 0.85); I.style = 2; I.p1 = 1.5;
    I.c0(pal.color, 2.0).c1(pal.core, 2.0);
    c.B.orbs.write(n.h[0], I);
    // two streamers corkscrewing behind it
    unitPerpFixed(n);
    const a = c.now * 22, cs = Math.cos(a) * 0.24, sn = Math.sin(a) * 0.24;
    const bx = n.dy * AZ - n.dz * AY, by = n.dz * AX - n.dx * AZ, bz = n.dx * AY - n.dy * AX;
    n.s[0]?.move(e.x + AX * cs + bx * sn, e.y + AY * cs + by * sn, e.z + AZ * cs + bz * sn, c.now);
    n.s[1]?.move(e.x - AX * cs - bx * sn, e.y - AY * cs - by * sn, e.z - AZ * cs - bz * sn, c.now);
    trail(c, SHADOW, 2.2, n.px, n.py, n.pz, e.x, e.y, e.z, 0.15, n.dx * 4, n.dy * 4, n.dz * 4, 0.7);
    trail(c, SHADOW_GLOW, 0.8, n.px, n.py, n.pz, e.x, e.y, e.z, 0.2, n.dx * 3, 0, n.dz * 3, 0.7);
  },
  despawn(c, n, why) {
    const pal = c.usePal(n.pal);
    if (why === 2) {
      c.P.sphere(SHADOW, 12, n.ex, n.ey, n.ez, 1, 5, 1);
      c.P.sphere(SHADOW_GLOW, 6, n.ex, n.ey, n.ez, 1, 4, 1);
      pop(c, n.ex, n.ey, n.ez, 1.3);
      faceRing(c, n.ex, n.ey, n.ez, 0.3, 1.5, pal, 0.25, 0.5, 0.14);
    } else {
      c.P.sphere(SHADOW, 6, n.ex, n.ey, n.ez, 0.3, 2, 0.8);
      c.P.sphere(SHADOW_MOTE, 8, n.ex, n.ey, n.ez, 0.5, 2.5);
    }
  },
  free(c, n) { c.B.orbs.kill(n.h[0]); },
};
let AX = 1, AY = 0, AZ = 0;
function unitPerpFixed(n: Ent): void {
  if (Math.abs(n.dy) < 0.95) { AX = n.dz; AY = 0; AZ = -n.dx; } else { AX = 1; AY = 0; AZ = 0; }
  const al = 1 / Math.hypot(AX, AY, AZ); AX *= al; AY *= al; AZ *= al;
}

// =========================================================================================== DAWN

const glint: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    n.h[0] = live(c.B.glyphs);
    const s = (n.s[0] = c.strips.ribbon(SS.LIGHT, 0.2, 0.085, 1.0));
    if (s) { s.color(pal.core, 3.0, pal.color, 1.6); s.taper = 0.6; s.headTaper = 0.04; }
    pop(c, e.x, e.y, e.z, 0.9, 0.8);
    c.P.cone(RAY, 5, e.x, e.y, e.z, n.dx, n.dy, n.dz, 0.5, 6, 14);
  },
  update(c, n) {
    const e = n.e, pal = c.usePal(n.pal);
    n.heading();
    I.reset().pos(e.x, e.y, e.z).scale(1.15); I.style = 1; I.c0(pal.color, 1.8).c1(pal.core, 2.8);
    c.B.glyphs.write(n.h[0], I);
    n.s[0]?.move(e.x, e.y, e.z, c.now);
    trail(c, SUNMOTE, 0.32, n.px, n.py, n.pz, e.x, e.y, e.z, 0.06, 0, 0, 0, 0.7);
  },
  despawn(c, n, why) {
    const pal = c.usePal(n.pal);
    if (why === 0) { c.P.sphere(GLINT, 4, n.ex, n.ey, n.ez, 0.3, 1.5); return; }
    pop(c, n.ex, n.ey, n.ez, 1.4, 1.9);
    c.P.sphere(RAY, 14, n.ex, n.ey, n.ez, 5, 12);
    c.P.sphere(GLINT, 5, n.ex, n.ey, n.ez, 0.5, 2.5);
    c.lights.flash(n.ex, n.ey, n.ez, pal.color, 2.6, 10, 0.12);
  },
  free(c, n) { c.B.glyphs.kill(n.h[0]); },
};

/** The Sunlance while it charges: a warning line that brightens. */
const sunlance: KindDef = {
  spawn(c, n) {
    n.h[0] = live(c.B.beams); n.h[1] = live(c.B.beams); n.h[2] = live(c.B.glyphs);
    n.heading();
    n.f[0] = n.e.p;
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(n.pal), P = c.P;
    n.heading();
    n.f[1] -= dt;
    if (n.f[1] <= 0) { n.f[1] = 0.07; n.f[0] = reach(c, e.x, e.y, e.z, n.dx, n.dy, n.dz, e.p); }
    const L = n.f[0], k = Math.min(1, e.age / Math.max(e.life, 1e-3)), k2 = k * k;
    const ox = e.x + n.dx * 0.6, oy = e.y + n.dy * 0.6, oz = e.z + n.dz * 0.6;
    const rl = 0.035 + 0.1 * k;
    I.reset().pos(ox, oy, oz).aimZ(n.dx, n.dy, n.dz).scale(rl, rl, L - 0.6); I.style = 1;
    I.c0(pal.color, 0.9 + 3.2 * k2).c1(pal.core, 0.8 + 4.5 * k2);
    c.B.beams.write(n.h[0], I);
    // faint sleeve at the beam's true width, so everyone can read what it will cover
    I.reset().pos(ox, oy, oz).aimZ(n.dx, n.dy, n.dz).scale(e.q * 0.5, e.q * 0.5, L - 0.6); I.style = 5;
    I.c0(pal.color, 0.08 + 0.3 * k2);
    c.B.beams.write(n.h[1], I);
    I.reset().pos(ox, oy, oz).scale(1.2 + 3.0 * k); I.style = 1; I.c0(pal.color, 1.0 + 1.6 * k).c1(pal.core, 1.2 + 2.6 * k);
    c.B.glyphs.write(n.h[2], I);
    gather(c, GATHER, (20 + 60 * k) * dt, ox, oy, oz, 2.2);
    for (let i = P.n((6 + 22 * k) * dt); i > 0; i--) { const t = rnd() * Math.min(L, 30); P.emit(SUNMOTE, ox + n.dx * t + rnd2() * 0.2, oy + n.dy * t + rnd2() * 0.2, oz + n.dz * t + rnd2() * 0.2, 0, 0.3, 0, 0.7); }
    c.lights.hold(LIGHT_KEY + e.id, ox, oy, oz, pal.color, 1 + 4 * k2, 14);
  },
  free(c, n) { c.B.beams.kill(n.h[0]); c.B.beams.kill(n.h[1]); c.B.glyphs.kill(n.h[2]); },
};

// =========================================================================================== WORLD

const healrune: KindDef = {
  spawn(c, n) {
    const e = n.e, pal = c.usePal(c.heal);
    n.pal = pal;
    n.h[0] = live(c.B.glyphs); n.h[1] = live(c.B.glyphs); n.h[2] = live(c.B.beams);
    const gy = c.groundY(e.x, e.z, e.y);
    n.f[0] = gy;
    const d = c.decals.begin(DS.RUNE, e.x, gy, e.z, 1.25, 1e7);
    d.fuse = 0.4; d.p1 = GLYPH_HEAL; d.p2 = 0; d.fadeIn = 0.5; d.c0(pal.color, 1.2, 0.85).c1(pal.core, 1.4, 0.6);
    n.h[3] = c.decals.commit();
    n.f[1] = rnd() * TAU;
  },
  update(c, n, dt) {
    const e = n.e, pal = c.usePal(c.heal), P = c.P;
    const inK = Math.min(1, e.age / 0.5);
    const bob = Math.sin(c.now * 1.7 + n.f[1]) * 0.13, pulse = 1 + 0.07 * Math.sin(c.now * 3.4 + n.f[1]);
    const y = e.y + bob;
    I.reset().pos(e.x, y, e.z).scale(1.35 * pulse * inK); I.style = 0; I.p1 = GLYPH_HEAL; I.c0(pal.color, 1.6).c1(pal.core, 2.0);
    c.B.glyphs.write(n.h[0], I);
    I.reset().pos(e.x, y, e.z).scale(3.4 * inK); I.style = 2; I.c0(pal.color, 0.55).c1(pal.core, 0.25);
    c.B.glyphs.write(n.h[1], I);
    // the beacon: a soft pillar you can pick out from across the island
    I.reset().pos(e.x, n.f[0] + 0.05, e.z).aimZ(0, 1, 0).scale(0.42, 0.42, 20 * inK); I.style = 6; I.p1 = 0.35; I.p2 = 0.9;
    I.c0(pal.color, 0.75).c1(pal.core, 0.5);
    c.B.beams.write(n.h[2], I);
    for (let i = P.n(7 * dt); i > 0; i--) { const a = rnd() * TAU, r = rr(0.2, 1.1); P.emit(MOTE, e.x + Math.cos(a) * r, n.f[0] + rr(0.1, 1.6), e.z + Math.sin(a) * r, 0, rr(0.5, 1.4), 0, 0.9); }
    // two motes in orbit
    for (let j = 0; j < 2; j++) if (rnd() < 14 * dt * c.P.density) { const a = c.now * 2.6 + j * Math.PI + n.f[1]; P.emit(GLINT, e.x + Math.cos(a) * 0.75, y + Math.sin(a * 1.3) * 0.25, e.z + Math.sin(a) * 0.75, 0, 0, 0, 0.6, 0, 0.6); }
  },
  despawn(c, n, why) {
    const e = n.e, pal = c.usePal(c.heal);
    c.decals.release(n.h[3], 0.3);
    if (why === 2) {
      pop(c, e.x, e.y, e.z, 2.0, 2.2);
      c.P.sphere(MOTE, 20, e.x, e.y, e.z, 1, 5);
      faceRing(c, e.x, e.y, e.z, 0.3, 2.0, pal, 0.35, 1, 0.18);
      flare(c, e.x, e.y, e.z, 1.6, pal, 0.3);
    } else c.P.sphere(MOTE, 8, e.x, e.y, e.z, 0.3, 1.5);
  },
  free(c, n) { c.B.glyphs.kill(n.h[0]); c.B.glyphs.kill(n.h[1]); c.B.beams.kill(n.h[2]); },
};

export const KINDS_B: KindTable = { gustblade, cyclone, jetstream, waterjet, bubble, tidalwave, dagger, snare, shade, glint, sunlance, healrune };

void GLOW; void STAR; void WISP;
