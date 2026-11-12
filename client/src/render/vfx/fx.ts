// Instant effects: `fx` events (cones, bursts, beams) and combat events (hit, death, respawn,
// teleports, pops, pickups).

import { abilityByKey } from '@shared/elements';
import { CLOUD_SEA_Y } from '@shared/world';
import type { GameEvent } from '@shared/types';
import type { Ctx } from './ctx';
import { surfDust } from './ctx';
import { Ent } from './entity';
import { DS } from './core/decals';
import { SS } from './core/strips';
import { I } from './core/inst';
import { GLYPH_HEAL } from './core/atlas';
import { rnd, rnd2, rr } from './core/rand';
import {
  ARC, BUBBLET, CURL, DEBRIS, DROP, DUST, DUST_BIG, EMBER, FIREBLOB, FLAKE, FLAME, FLAME_BIG, FOAM, FROST_MIST, GLINT, GLOW, ICE_CHIP, MOTE, RAY,
  RINGPUFF, SHADOW, SHADOW_GLOW, SHADOW_MOTE, SMOKE_HOT, SOUL, SOUL_MOTE, SPARK, SPARK_FLOAT, SPRAY, SUNMOTE, WIND, ZAP,
} from './pdefs';
import { TAU, airRing, bolt, chunks, cracks, dome, dust, faceRing, flare, frostMark, groundGlow, pop, scorch, shock } from './common';
import { bubblePop } from './kinds_b';

type FxEvent = Extract<GameEvent, { e: 'fx' }>;
type HitEvent = Extract<GameEvent, { e: 'hit' }>;
type DeathEvent = Extract<GameEvent, { e: 'death' }>;
type RespawnEvent = Extract<GameEvent, { e: 'respawn' }>;
type TpEvent = Extract<GameEvent, { e: 'tp' }>;
type PopEvent = Extract<GameEvent, { e: 'pop' }>;
type PickupEvent = Extract<GameEvent, { e: 'pickup' }>;

const EL = { ember: 0, frost: 1, storm: 2, stone: 3, gale: 4, tide: 5, umbra: 6, dawn: 7 } as const;
const elOf = (id: string): number => (EL as Record<string, number>)[id] ?? 0;

// ------------------------------------------------------------------------------------- fx

function flamewave(c: Ctx, ev: FxEvent): void {
  const pal = c.use(ev.el), P = c.P;
  let dx = ev.x2 - ev.x, dy = ev.y2 - ev.y, dz = ev.z2 - ev.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  const range = ev.r > 0 ? ev.r : len;
  const def = abilityByKey('flamewave');
  const arc = ((def && def.fx.t === 'cone' ? def.fx.arc : 85) * Math.PI) / 180, half = arc / 2;
  const hl = Math.hypot(dx, dz) || 1, hx = dx / hl, hz = dz / hl;
  const feet = ev.y - 1.1;
  if (c.nearGround(ev.x, ev.y, ev.z, 3.5)) {
    const d = c.decals.begin(DS.SECTOR, ev.x, c.groundY(ev.x, ev.z, feet), ev.z, range, 2.4);
    d.rot = Math.atan2(hz, hx); d.fuse = 0.2; d.p1 = half; d.fadeIn = 0.01; d.fadeOut = 1.2; d.extX = d.extZ = 1.05;
    d.c0(pal.color, 1.6).c1(pal.core, 1.6);
    c.decals.commit();
  }
  // a low glowing front races out along the ground …
  I.reset().pos(ev.x, feet + 0.25, ev.z).aimZ(-hx, 0, -hz).scale(range * 0.3);
  I.scaleEnd = 1 / 0.3; I.life = 0.3; I.style = 1; I.p1 = arc; I.p2 = 0.55;
  I.c0(pal.color, 1.2).c1(pal.core, 1.0);
  c.B.arcs.spawn(I);
  // … and behind it a wall of flame stands up row by row, out to exactly the range
  const SWEEP = 0.2, rows = 7;
  for (let j = 0; j < rows; j++) {
    const fr = (j + 1) / rows, rad = range * fr * 0.97, delay = SWEEP * fr * fr;
    const width = rad * arc;
    for (let i = P.n(1.5 + width * 1.5); i > 0; i--) {
      const a = rnd2() * half * 0.93, cs = Math.cos(a), sn = Math.sin(a);
      const ddx = hx * cs - hz * sn, ddz = hz * cs + hx * sn, rr2 = rad + rnd2() * range * 0.06;
      const px = ev.x + ddx * rr2, pz = ev.z + ddz * rr2, py = ev.y + dy * rr2 - 0.9;
      P.emit(FLAME_BIG, px, py + rnd() * 0.5, pz, ddx * rr(2, 5), rr(1.5, 4.5), ddz * rr(2, 5), 1.0 + 0.5 * fr, delay + rnd() * 0.03, 0.5);
      if (rnd() < 0.8) P.emit(FIREBLOB, px, py + 0.5 + rnd() * 0.5, pz, ddx * rr(3, 8), rr(0.5, 2.5), ddz * rr(3, 8), 0.9 + 0.4 * fr, delay);
      if (rnd() < 0.8) P.emit(EMBER, px, py + 0.4, pz, ddx * rr(1, 5), rr(1, 5), ddz * rr(1, 5), 1.1, delay);
      if (rnd() < 0.5) P.emit(SPARK, px, py + 0.4, pz, ddx * rr(6, 16), rr(2, 8), ddz * rr(6, 16), 1.1, delay);
      if (rnd() < 0.14) P.emit(SMOKE_HOT, px, py + 0.8, pz, ddx * 2, 1.5, ddz * 2, 1.4, delay + 0.12);
    }
  }
  pop(c, ev.x + dx * 0.9, ev.y, ev.z + dz * 0.9, 1.8, 1.2);
  c.lights.flash(ev.x + dx * 3, ev.y + 1.2, ev.z + dz * 3, pal.color, 6, 22, 0.3);
}

function arcbolt(c: Ctx, ev: FxEvent): void {
  const pal = c.use(ev.el), P = c.P;
  const len = Math.hypot(ev.x2 - ev.x, ev.y2 - ev.y, ev.z2 - ev.z) || 1;
  const dx = (ev.x2 - ev.x) / len, dy = (ev.y2 - ev.y) / len, dz = (ev.z2 - ev.z) / len;
  bolt(c, ev.x, ev.y, ev.z, ev.x2, ev.y2, ev.z2, pal, 0.55, 0.2, Math.min(0.09, 0.9 / len), 3);
  bolt(c, ev.x, ev.y, ev.z, ev.x2, ev.y2, ev.z2, pal, 0.26, 0.15, Math.min(0.16, 1.5 / len), 0, false, 0.02);
  pop(c, ev.x, ev.y, ev.z, 1.5, 1.0);
  pop(c, ev.x2, ev.y2, ev.z2, 2.3, 2.0);
  P.sphere(ZAP, 18, ev.x2, ev.y2, ev.z2, 4, 13);
  P.cone(ZAP, 10, ev.x2, ev.y2, ev.z2, dx, dy, dz, 0.6, 6, 16);
  P.sphere(ARC, 7, ev.x2, ev.y2, ev.z2, 0, 2, 1.2, 0.4);
  P.cone(ZAP, 6, ev.x, ev.y, ev.z, dx, dy, dz, 0.7, 3, 9);
  airRing(c, ev.x2, ev.y2, ev.z2, dx, dy, dz, 0.2, 1.1, pal, 0.2, 1, 0.22, 1);
  c.lights.flash(ev.x2, ev.y2, ev.z2, pal.color, 5, 16, 0.14);
}

function staticburst(c: Ctx, ev: FxEvent): void {
  const pal = c.use(ev.el), P = c.P, r = ev.r > 0 ? ev.r : 3.2;
  const gy = c.groundY(ev.x, ev.z, ev.y), grounded = c.nearGround(ev.x, ev.y + 0.3, ev.z, 2.5);
  const y = grounded ? gy : ev.y;
  if (grounded) shock(c, ev.x, gy, ev.z, r, pal, 0.2, 0.08, 1.2, 0.3);
  else airRing(c, ev.x, ev.y + 1, ev.z, 0, 1, 0, r * 0.2, r, pal, 0.25, 1.2, 0.14, 1);
  // a crackling ring: short arcs chained round the true radius
  const segs = c.d(11);
  const a0 = rnd() * TAU;
  for (let i = 0; i < segs; i++) {
    const a = a0 + (i / segs) * TAU, b = a + (TAU / segs) * 1.15;
    bolt(c, ev.x + Math.cos(a) * r * 0.96, y + 0.25, ev.z + Math.sin(a) * r * 0.96, ev.x + Math.cos(b) * r * 0.96, y + 0.25, ev.z + Math.sin(b) * r * 0.96, pal, 0.24, rr(0.16, 0.26), 0.18, 0, false, 0.1 + rnd() * 0.05);
    if (i % 2 === 0) bolt(c, ev.x, y + 1, ev.z, ev.x + Math.cos(a) * r * 0.9, y + 0.2, ev.z + Math.sin(a) * r * 0.9, pal, 0.2, 0.14, 0.14, 0, true);
  }
  P.ring(ZAP, 34, ev.x, y + 0.4, ev.z, r * 0.3, r * 4.5, 3);
  P.sphere(ARC, 10, ev.x, y + 1, ev.z, 0, 2, 1.4, 0.8);
  pop(c, ev.x, y + 1, ev.z, 2.4, 1.8);
  c.lights.flash(ev.x, y + 1, ev.z, pal.color, 4.5, 15, 0.2);
}

/** Ground shockwave with rock teeth erupting in rings (Earthshatter, Seismic Leap landing). */
function quake(c: Ctx, ev: FxEvent, big: boolean): void {
  const pal = c.use(ev.el), P = c.P, r = ev.r > 0 ? ev.r : big ? 7 : 4.2;
  const x = ev.x, z = ev.z, y = c.groundY(x, z, ev.y);
  const speed = 32, time = r / speed;
  shock(c, x, y, z, r, pal, time, 0.07, 1.25, 0.45);
  cracks(c, x, y, z, r, pal.color, big ? 6 : 5, time, 1.3, 1.9);
  const rings = big ? 4 : 3;
  for (let j = 0; j < rings; j++) {
    const rad = r * ((j + 0.8) / (rings + 0.1)), delay = rad / speed;
    const count = c.d(4 + j * 4);
    const a0 = rnd() * TAU;
    for (let i = 0; i < count; i++) {
      const a = a0 + ((i + rnd2() * 0.3) / count) * TAU, cs = Math.cos(a), sn = Math.sin(a);
      const px = x + cs * rad, pz = z + sn * rad, py = c.groundY(px, pz, y);
      const h = rr(0.55, 1.15) * (big ? 1 : 0.85) * (0.75 + 0.12 * j), w = h * rr(0.28, 0.4);
      const lean = rr(0.25, 0.6), ll = 1 / Math.hypot(lean, 1);
      I.reset().pos(px, py - 0.1, pz).aimY(cs * lean * ll, ll, sn * lean * ll).scale(w, h, w * rr(0.8, 1.2));
      I.style = 0; I.p2 = 1; I.delay = delay; I.growIn = 0.07; I.shrinkOut = 0.28; I.life = rr(0.45, 0.7);
      I.c0(pal.color, 0.45 * rr(0.8, 1.15)).c1(pal.core, 0.8);
      c.B.rocks.spawn(I);
    }
    P.colA.copy(surfDust(c.surface(x, z, y))).lerp(pal.color, 0.45);
    P.ring(DUST_BIG, 7 + j * 3, x, y + 0.3, z, rad, 2.5, 1.6, 1.1 + 0.1 * j, 0.1, delay);
    P.colA.copy(pal.color).multiplyScalar(0.55);
    P.ring(DEBRIS, 10 + j * 5, x, y + 0.2, z, rad, 1.5, 7, 1.2, 0.1, delay);
  }
  pop(c, x, y + 0.4, z, big ? 3.2 : 2.6, big ? 2.2 : 1.8);
  P.hemi(SPARK, 18, x, y + 0.2, z, 5, 15, 1.1, 0.5);
  chunks(c, c.B.rocks, big ? 12 : 8, x, y + 0.2, z, y, 5, 10, 0.26, pal.color, 0.5, pal.core, 0.6, 0);
  if (!big) scorch(c, x, y, z, r * 0.4, pal, 5, 0.2, 0.4);
  c.lights.flash(x, y + 1.2, z, pal.core, big ? 5.5 : 4, big ? 26 : 18, 0.25);
}

function solarflare(c: Ctx, ev: FxEvent): void {
  const pal = c.use(ev.el), P = c.P, r = ev.r > 0 ? ev.r : 5.6;
  const x = ev.x, y = ev.y, z = ev.z;
  if (c.nearGround(x, y, z, 3)) shock(c, x, c.groundY(x, z, y - 1.1), z, r, pal, 0.2, 0.08, 1.5, 0.4);
  dome(c, x, y, z, r, pal, 0.3, 1.5, 0, 0.2);
  airRing(c, x, y, z, 0, 1, 0, r * 0.15, r, pal, 0.26, 1.5, 0.12);
  // straight rays to exactly the blast radius (RAY drag 3.5: reach ~ v * 0.18)
  const rays = P.n(64);
  for (let i = 0; i < rays; i++) {
    const a = rnd() * TAU, up = rnd2() * 0.35, cs = Math.cos(a) * Math.cos(up), sn = Math.sin(a) * Math.cos(up);
    const v = r * 5.4 * rr(0.6, 1);
    P.emit(RAY, x + cs * 0.5, y + Math.sin(up) * 0.5, z + sn * 0.5, cs * v, Math.sin(up) * v, sn * v, 1.6);
  }
  P.ring(SUNMOTE, 26, x, y - 0.6, z, r * 0.9, 0.5, 1.2, 1, 0.1, 0.12);
  pop(c, x, y, z, r * 0.6, r * 0.7);
  flare(c, x, y, z, r * 0.6, pal, 0.2, 1.0);
  c.lights.flash(x, y + 0.5, z, pal.color, 12, 36, 0.28, 0.03);
}

function sunlanceBeam(c: Ctx, ev: FxEvent): void {
  const pal = c.use(ev.el), P = c.P;
  const L = Math.hypot(ev.x2 - ev.x, ev.y2 - ev.y, ev.z2 - ev.z) || 1;
  const dx = (ev.x2 - ev.x) / L, dy = (ev.y2 - ev.y) / L, dz = (ev.z2 - ev.z) / L;
  const def = abilityByKey('sunlance');
  const width = def && def.fx.t === 'beam' ? def.fx.width : 1.6;
  const rad = width * 0.5;
  // body at the true width + a white-hot heart; both thin away over the linger
  I.reset().pos(ev.x, ev.y, ev.z).aimZ(dx, dy, dz).scale(rad, rad, L); I.style = 0; I.life = 0.46; I.shrinkOut = 0.34; I.growIn = 0.03;
  I.c0(pal.color, 2.4).c1(pal.core, 3.0);
  c.B.beams.spawn(I);
  I.reset().pos(ev.x, ev.y, ev.z).aimZ(dx, dy, dz).scale(rad * 0.45, rad * 0.45, L); I.style = 0; I.life = 0.52; I.shrinkOut = 0.4; I.growIn = 0.02;
  I.c0(pal.core, 2.6).c1(pal.core, 4.0);
  c.B.beams.spawn(I);
  for (let i = 0; i < 3; i++) airRing(c, ev.x + dx * (0.4 + i * 1.3), ev.y + dy * (0.4 + i * 1.3), ev.z + dz * (0.4 + i * 1.3), dx, dy, dz, rad * 0.8, rad * (2.6 - i * 0.5), pal, 0.3 + i * 0.05, 1.5, 0.14, 0, i * 0.03);
  const along = Math.min(L, 60);
  for (let i = P.n(along * 2.4); i > 0; i--) {
    const t = rnd() * along, a = rnd() * TAU;
    // radial direction around the beam
    let ax = dz, ay = 0, az = -dx; if (Math.abs(dy) > 0.95) { ax = 1; az = 0; }
    const al = 1 / Math.hypot(ax, ay, az); ax *= al; az *= al;
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    const cs = Math.cos(a), sn = Math.sin(a), ox = ax * cs + bx * sn, oy = by * sn, oz = az * cs + bz * sn;
    P.emit(RAY, ev.x + dx * t + ox * rad * 0.8, ev.y + dy * t + oy * rad * 0.8, ev.z + dz * t + oz * rad * 0.8, ox * rr(3, 8) + dx * 6, oy * rr(3, 8) + dy * 6, oz * rr(3, 8) + dz * 6, 1.1, rnd() * 0.1);
  }
  for (let i = P.n(along * 0.9); i > 0; i--) { const t = rnd() * along; P.emit(SUNMOTE, ev.x + dx * t + rnd2() * rad, ev.y + dy * t + rnd2() * rad, ev.z + dz * t + rnd2() * rad, dx * 2, 0.5, dz * 2, 1, 0.1 + rnd() * 0.3); }
  pop(c, ev.x, ev.y, ev.z, 4.2, 3.6);
  flare(c, ev.x, ev.y, ev.z, 3.4, pal, 0.36, 1.3);
  // where it lands
  pop(c, ev.x2, ev.y2, ev.z2, 4.5, 4.0);
  flare(c, ev.x2, ev.y2, ev.z2, 3.2, pal, 0.4, 1.2);
  P.cone(RAY, 44, ev.x2, ev.y2, ev.z2, -dx, -dy + 0.4, -dz, 1.35, 6, 22, 1.4);
  P.sphere(SPARK, 34, ev.x2, ev.y2, ev.z2, 5, 18, 1.2);
  P.sphere(SUNMOTE, 16, ev.x2, ev.y2, ev.z2, 1, 5);
  if (c.nearGround(ev.x2, ev.y2, ev.z2, 1.5)) scorch(c, ev.x2, c.groundY(ev.x2, ev.z2, ev.y2), ev.z2, 1.8, pal, 6, 2.2);
  c.lights.flash(ev.x + dx * 2, ev.y + 0.5, ev.z + dz * 2, pal.color, 11, 34, 0.36, 0.1);
  c.lights.flash(ev.x2 - dx, ev.y2 + 0.5, ev.z2 - dz, pal.color, 10, 30, 0.36, 0.1);
}

function raydash(c: Ctx, ev: FxEvent): void {
  const pal = c.use(ev.el), P = c.P, r = ev.r > 0 ? ev.r : 2.8;
  const L = Math.hypot(ev.x2 - ev.x, ev.y2 - ev.y, ev.z2 - ev.z) || 1;
  const dx = (ev.x2 - ev.x) / L, dy = (ev.y2 - ev.y) / L, dz = (ev.z2 - ev.z) / L;
  I.reset().pos(ev.x, ev.y, ev.z).aimZ(dx, dy, dz).scale(0.13, 0.13, L); I.style = 0; I.life = 0.3; I.shrinkOut = 0.28;
  I.c0(pal.color, 1.4).c1(pal.core, 1.6);
  c.B.beams.spawn(I);
  P.line(SUNMOTE, L * 1.6, ev.x, ev.y, ev.z, ev.x2, ev.y2, ev.z2, 0.25, 0, 0.4, 0, 0.9);
  P.sphere(GLINT, 6, ev.x, ev.y, ev.z, 0.5, 2);
  P.emit(RINGPUFF, ev.x, ev.y, ev.z, 0, 0, 0, 1.2);
  // the dazzle where the ray ends
  pop(c, ev.x2, ev.y2, ev.z2, r * 0.9, r * 1.2);
  flare(c, ev.x2, ev.y2, ev.z2, r * 0.9, pal, 0.26, 1.0);
  faceRing(c, ev.x2, ev.y2, ev.z2, r * 0.2, r, pal, 0.24, 0.7, 0.08);
  const rays = P.n(40);
  for (let i = 0; i < rays; i++) { const a = rnd() * TAU, u = rnd2(), s = Math.sqrt(1 - u * u), v = r * 5.4 * rr(0.6, 1); P.emit(RAY, ev.x2, ev.y2, ev.z2, Math.cos(a) * s * v, u * v, Math.sin(a) * s * v, 1.2); }
  P.sphere(SUNMOTE, 14, ev.x2, ev.y2, ev.z2, 1, 4);
  if (c.nearGround(ev.x2, ev.y2, ev.z2, 2.2)) shock(c, ev.x2, c.groundY(ev.x2, ev.z2, ev.y2 - 1), ev.z2, r, pal, 0.18, 0.08, 1.2, 0.3);
  c.lights.flash(ev.x2, ev.y2, ev.z2, pal.color, 7, 22, 0.22);
}

function rimeburst(c: Ctx, ev: FxEvent): void {
  const pal = c.use(ev.el), P = c.P, r = ev.r > 0 ? ev.r : 3.2;
  const x = ev.x, z = ev.z, y = c.groundY(x, z, ev.y);
  shock(c, x, y, z, r, pal, 0.2, 0.09, 1.4, 0.4);
  frostMark(c, x, y, z, r, pal, 4.5);
  // a crown of ice thrown up just inside the true radius
  const rows = [[0.8, 11, 1.5], [0.45, 6, 1.0]];
  for (const [fr, cnt, hh] of rows) {
    const count = c.d(cnt), a0 = rnd() * TAU;
    for (let i = 0; i < count; i++) {
      const a = a0 + ((i + rnd2() * 0.25) / count) * TAU, cs = Math.cos(a), sn = Math.sin(a);
      const px = x + cs * r * fr, pz = z + sn * r * fr, h = hh * rr(0.75, 1.25), w = h * rr(0.18, 0.25);
      const lean = rr(0.35, 0.7), ll = 1 / Math.hypot(lean, 1);
      I.reset().pos(px, c.groundY(px, pz, y) - 0.05, pz).aimY(cs * lean * ll, ll, sn * lean * ll).scale(w, h, w);
      I.style = 1; I.p2 = 1; I.delay = fr * 0.1; I.growIn = 0.07; I.shrinkOut = 0.28; I.life = rr(0.9, 1.3);
      I.c0(pal.color, 1.0).c1(pal.core, 1.7);
      c.B.crystals.spawn(I);
    }
  }
  dome(c, x, y, z, r, pal, 0.3, 1.4, 0, 0.5);
  P.hemi(FLAKE, 44, x, y + 0.5, z, 2, r * 2.6, 1.2, 0.3);
  P.hemi(ICE_CHIP, 28, x, y + 0.3, z, 3, 11, 1.1, 0.3);
  P.ring(FROST_MIST, 16, x, y + 0.4, z, r * 0.5, r * 1.6, 0.4, 1.5, 0.2);
  pop(c, x, y + 0.8, z, r * 0.8, r * 0.8);
  c.lights.flash(x, y + 1.2, z, pal.color, 7, 24, 0.3);
}

/** A swing that bit into terrain. */
function meleeClang(c: Ctx, ev: FxEvent): void {
  const pal = c.use(ev.el), P = c.P;
  const moved = Math.hypot(ev.x2 - ev.x, ev.y2 - ev.y, ev.z2 - ev.z) > 0.05;
  const x = moved ? ev.x2 : ev.x, y = moved ? ev.y2 : ev.y, z = moved ? ev.z2 : ev.z;
  pop(c, x, y, z, 0.9, 0.9);
  P.sphere(SPARK, 14, x, y, z, 3, 11);
  P.colA.copy(surfDust(c.surface(x, z, y)));
  P.sphere(DUST, 4, x, y, z, 0.5, 2, 0.8);
  P.sphere(DEBRIS, 5, x, y, z, 1, 5, 0.8);
  c.lights.flash(x, y, z, pal.core, 1.2, 6, 0.1);
}

const scratch = new Ent();

export function instantFx(c: Ctx, ev: FxEvent): void {
  switch (ev.k) {
    case 'flamewave': flamewave(c, ev); break;
    case 'arcbolt': arcbolt(c, ev); break;
    case 'staticburst': staticburst(c, ev); break;
    case 'earthshatter': quake(c, ev, true); break;
    case 'leapslam': quake(c, ev, false); break;
    case 'solarflare': solarflare(c, ev); break;
    case 'sunlance': sunlanceBeam(c, ev); break;
    case 'raydash': raydash(c, ev); break;
    case 'rimeburst': rimeburst(c, ev); break;
    case 'melee': meleeClang(c, ev); break;
    default: break;
  }
}

// ------------------------------------------------------------------------------------- hit

export function hit(c: Ctx, ev: HitEvent, orbX: number, orbY: number, orbZ: number, fromOrb: boolean): void {
  const pal = c.use(ev.el), P = c.P;
  const { x, y, z, dx, dy, dz } = ev;
  const heavy = ev.heavy === 1, crit = ev.crit === 1, kill = ev.kill === 1;
  let s = Math.min(2.2, Math.max(0.55, ev.dmg / 13));
  if (heavy) s *= 1.15;
  if (crit) s *= 1.25;
  if (kill) s *= 1.3;
  if (ev.dmg <= 4.5 && !heavy) s = 0.5; // ticks (burning ground, jets, zaps) stay small
  const tick = s <= 0.5;
  if (fromOrb) bolt(c, orbX, orbY, orbZ, x, y, z, pal, 0.3, 0.16, 0.1, 1);
  pop(c, x, y, z, 0.6 * s, heavy || crit ? 1.0 * s : tick ? 0 : 0.6 * s);
  P.cone(ev.el === EL.storm || ev.el === EL.dawn || ev.el === EL.umbra ? SPARK_FLOAT : SPARK, 9 * s * (heavy ? 1.8 : 1), x, y, z, dx, dy + 0.2, dz, 0.75, 4 * s, 13 * s, 1);
  // the element's own flavour
  switch (ev.el) {
    case EL.ember: P.cone(FLAME, 4 * s, x, y, z, dx, dy + 0.4, dz, 0.9, 1, 5, 0.9); P.cone(EMBER, 7 * s, x, y, z, dx, dy + 0.5, dz, 1.0, 1, 6); break;
    case EL.frost: P.cone(ICE_CHIP, 7 * s, x, y, z, dx, dy + 0.4, dz, 0.9, 2, 8); P.sphere(FLAKE, 5 * s, x, y, z, 0.5, 2.5); P.emit(FROST_MIST, x, y, z, dx, 0.3, dz, 0.7 * s); break;
    case EL.storm: P.sphere(ARC, 3 * s, x, y, z, 0, 1.5, s, 0.3); P.sphere(ZAP, 9 * s, x, y, z, 3, 11); break;
    case EL.stone: P.colA.copy(pal.color).multiplyScalar(0.55); P.cone(DEBRIS, 9 * s, x, y, z, dx, dy + 0.5, dz, 0.9, 2, 8); P.colA.copy(pal.color).multiplyScalar(0.85); P.sphere(DUST, 3 * s, x, y, z, 0.5, 2.5, 0.9 * s); break;
    case EL.gale: P.cone(WIND, 10 * s, x, y, z, dx, dy, dz, 0.5, 10, 26, 1.2); P.cone(CURL, 2 * s, x, y, z, dx, dy, dz, 0.8, 2, 6, 0.9 * s); break;
    case EL.tide: P.cone(DROP, 12 * s, x, y, z, dx, dy + 0.5, dz, 0.9, 2, 9); P.emit(FOAM, x, y, z, dx, 0.5, dz, 1.1 * s); P.sphere(SPRAY, 2 * s, x, y, z, 0.5, 2, 0.9 * s); break;
    case EL.umbra: P.sphere(SHADOW, 3 * s, x, y, z, 0.5, 2.5, 0.7 * s); P.sphere(SHADOW_GLOW, 2 * s, x, y, z, 0.5, 2, 0.8 * s); break;
    default: P.sphere(RAY, 9 * s, x, y, z, 4, 12, s); P.sphere(GLINT, 3 * s, x, y, z, 0.5, 2); break;
  }
  if (tick) return;
  if (heavy) {
    airRing(c, x, y, z, dx, dy, dz, 0.25, 1.15 * s, pal, 0.2, 0.75, 0.13);
    const gy = c.groundY(x, z, y - 1);
    if (ev.el === EL.stone) chunks(c, c.B.rocks, 5, x, y, z, gy, 4, 5, 0.14, pal.color, 0.5, pal.core, 0.6, 0, 0, dx, dz, 4);
    else if (ev.el === EL.frost) chunks(c, c.B.crystals, 5, x, y, z, gy, 4, 5, 0.12, pal.color, 1, pal.core, 1.5, 1, 0, dx, dz, 4);
    else { P.colA.copy(pal.dark).multiplyScalar(1.6); P.cone(DEBRIS, 8 * s, x, y, z, dx, dy + 0.5, dz, 0.8, 3, 10, 0.9); }
    if (c.nearGround(x, y, z, 2)) dust(c, x, gy, z, 7, 0.4, 3.5, 0.8, 0.9);
    c.lights.flash(x, y, z, pal.color, 3.2 * s, 13, 0.16);
  }
  if (crit) {
    flare(c, x, y, z, 1.7 * s, pal, 0.24, 1.3);
    faceRing(c, x, y, z, 0.25, 1.9 * s, pal, 0.26, 1.2, 0.14);
    P.sphere(GLINT, 6, x, y, z, 1, 4, 1.2);
  }
  if (kill) {
    faceRing(c, x, y, z, 0.3, 2.8, pal, 0.34, 1.4, 0.12);
    flare(c, x, y, z, 2.6, pal, 0.3, 1.4);
    P.sphere(SPARK_FLOAT, 30, x, y, z, 5, 16, 1.2);
    c.lights.flash(x, y, z, pal.color, 7, 20, 0.25);
  }
}

// ------------------------------------------------------------------------------------- death / respawn

export function death(c: Ctx, ev: DeathEvent, element: string): void {
  const el = elOf(element), pal = c.use(el), P = c.P;
  const x = ev.x, y = ev.y + 1.0, z = ev.z;
  if (ev.fall === 1) {
    // a long streak down into the cloud sea, and a bloom where it goes under
    const top = y + 26, bottom = Math.min(CLOUD_SEA_Y + 1, y - 6), L = top - bottom;
    I.reset().pos(x, bottom, z).aimZ(0, 1, 0).scale(0.3, 0.3, L); I.style = 4; I.p1 = 0.3; I.p2 = -0.6; I.life = 0.9;
    I.c0(pal.color, 1.3).c1(pal.core, 1.2);
    c.B.beams.spawn(I);
    for (let i = P.n(46); i > 0; i--) { const t = rnd(); P.emit(SPARK_FLOAT, x + rnd2() * 0.4, top - t * L, z + rnd2() * 0.4, rnd2(), -rr(20, 44), rnd2(), 1.6, t * 0.35, 1.6); }
    for (let i = P.n(20); i > 0; i--) { const t = rnd(); P.emit(SOUL, x + rnd2() * 0.5, top - t * L, z + rnd2() * 0.5, 0, rr(0.5, 2), 0, 1.4, 0.2 + t * 0.5); }
    c.usePal(c.neutral);
    P.ring(SPRAY, 22, x, bottom + 0.5, z, 1.5, 7, 3, 4.5, 0.3, 0.3);
    c.usePal(pal);
    P.emit(GLOW, x, bottom + 1, z, 0, 0, 0, 9, 0.3, 2);
    flare(c, x, bottom + 2, z, 5, pal, 0.5, 1);
    return;
  }
  // a hollow burst of the fighter's element …
  pop(c, x, y, z, 2.2, 2.0);
  faceRing(c, x, y, z, 0.4, 2.6, pal, 0.38, 1.3, 0.12);
  airRing(c, x, y - 0.6, z, 0, 1, 0, 0.3, 2.2, pal, 0.34, 1.0, 0.14);
  P.sphere(SPARK_FLOAT, 34, x, y, z, 4, 13, 1.2, 0.4);
  P.sphere(MOTE, 22, x, y, z, 1, 5, 1.1, 0.5);
  switch (el) {
    case EL.ember: P.sphere(FIREBLOB, 10, x, y, z, 2, 6, 0.9, 0.3); P.sphere(EMBER, 20, x, y, z, 1, 6); break;
    case EL.frost: P.sphere(ICE_CHIP, 22, x, y, z, 2, 9); P.sphere(FLAKE, 16, x, y, z, 1, 4); break;
    case EL.storm: P.sphere(ARC, 10, x, y, z, 0, 2, 1.4, 0.5); P.sphere(ZAP, 24, x, y, z, 4, 14); break;
    case EL.stone: P.colA.copy(pal.color).multiplyScalar(0.55); P.sphere(DEBRIS, 24, x, y, z, 2, 9); P.colA.copy(pal.color).multiplyScalar(0.85); P.sphere(DUST_BIG, 6, x, y, z, 1, 3); break;
    case EL.gale: P.sphere(CURL, 10, x, y, z, 2, 7, 1.2); P.sphere(WIND, 24, x, y, z, 6, 18); break;
    case EL.tide: P.sphere(DROP, 30, x, y, z, 3, 9); P.sphere(BUBBLET, 12, x, y, z, 1, 3); break;
    case EL.umbra: P.sphere(SHADOW, 12, x, y, z, 1, 4, 1); P.sphere(SHADOW_GLOW, 8, x, y, z, 1, 4); break;
    default: P.sphere(RAY, 26, x, y, z, 6, 16, 1.2); P.sphere(GLINT, 8, x, y, z, 1, 3); break;
  }
  // … then the soul leaves: slow wisps and motes climbing away
  for (let i = P.n(12); i > 0; i--) P.emit(SOUL, x + rnd2() * 0.35, y - 0.6 + rnd() * 1.2, z + rnd2() * 0.35, rnd2() * 0.3, rr(0.6, 1.6), rnd2() * 0.3, 1.1, 0.1 + rnd() * 0.7);
  for (let i = P.n(26); i > 0; i--) P.emit(SOUL_MOTE, x + rnd2() * 0.5, y - 0.8 + rnd() * 1.4, z + rnd2() * 0.5, rnd2() * 0.4, rr(0.8, 2.2), rnd2() * 0.4, 1, rnd() * 0.9);
  I.reset().pos(x, ev.y, z).aimZ(0, 1, 0).scale(0.34, 0.34, 7); I.style = 4; I.p1 = 0.3; I.p2 = 0.8; I.life = 1.5; I.delay = 0.1;
  I.c0(pal.color, 0.7).c1(pal.core, 0.6);
  c.B.beams.spawn(I);
  if (c.nearGround(x, y, z, 2.5)) groundGlow(c, x, c.groundY(x, z, ev.y), z, 2.2, pal.color, 0.8, 1.4, 0.1);
  c.lights.flash(x, y, z, pal.color, 5, 16, 0.35);
}

export function respawn(c: Ctx, ev: RespawnEvent, element: string): void {
  const el = elOf(element), pal = c.use(el), P = c.P;
  const x = ev.x, y = ev.y, z = ev.z;
  // a column of light
  I.reset().pos(x, y, z).aimZ(0, 1, 0).scale(0.7, 0.7, 14); I.style = 4; I.p1 = 0.55; I.p2 = 0.7; I.life = 1.0;
  I.c0(pal.color, 1.3).c1(pal.core, 1.2);
  c.B.beams.spawn(I);
  I.reset().pos(x, y, z).aimZ(0, 1, 0).scale(0.22, 0.22, 22); I.style = 4; I.p1 = 0.4; I.p2 = 0.3; I.life = 0.7;
  I.c0(pal.color, 1.4).c1(pal.core, 1.6);
  c.B.beams.spawn(I);
  const d = c.decals.begin(DS.RUNE, x, y, z, 1.7, 1.6);
  d.fuse = 0.3; d.p1 = el; d.p2 = 0; d.fadeIn = 0.05; d.fadeOut = 0.7; d.c0(pal.color, 1.5).c1(pal.core, 1.9);
  c.decals.commit();
  shock(c, x, y, z, 2.2, pal, 0.25, 0.08, 1.2, 0.3);
  for (let i = P.n(34); i > 0; i--) { const a = rnd() * TAU, r = rr(0.1, 0.8); P.emit(MOTE, x + Math.cos(a) * r, y + rnd() * 2.2, z + Math.sin(a) * r, 0, rr(2, 6), 0, 1.1, rnd() * 0.5); }
  P.ring(SPARK_FLOAT, 20, x, y + 0.2, z, 0.5, 6, 2);
  pop(c, x, y + 1.1, z, 2.2, 1.6);
  flare(c, x, y + 1.1, z, 1.6, pal, 0.4, 1);
  c.lights.flash(x, y + 1.5, z, pal.color, 5.5, 18, 0.45, 0.1);
}

// ------------------------------------------------------------------------------------- teleports

export function teleport(c: Ctx, ev: TpEvent, element: string): void {
  const P = c.P;
  if (ev.k === 'thunderstep') {
    const pal = c.use(EL.storm);
    const ay = ev.y + 1.1, by = ev.y2 + 1.1;
    const len = Math.hypot(ev.x2 - ev.x, ev.y2 - ev.y, ev.z2 - ev.z) || 1;
    bolt(c, ev.x, ay, ev.z, ev.x2, by, ev.z2, pal, 0.75, 0.26, Math.min(0.08, 0.9 / len), 3);
    bolt(c, ev.x, ay + 0.4, ev.z, ev.x2, by - 0.3, ev.z2, pal, 0.3, 0.2, Math.min(0.14, 1.5 / len), 1, false, 0.02);
    // the afterimage they leave behind
    for (let i = 0; i < 2; i++) {
      I.reset().pos(ev.x, ev.y + 0.95, ev.z).scale(0.5 + i * 0.12, 0.98 + i * 0.1, 0.5 + i * 0.12); I.style = 4; I.life = 0.3 + i * 0.1; I.scaleEnd = 1.08;
      I.c0(pal.color, 2.2 - i * 0.8).c1(pal.core, 2.0 - i * 0.8);
      c.B.shells.spawn(I);
    }
    P.sphere(ZAP, 16, ev.x, ay, ev.z, 2, 8);
    P.sphere(ARC, 6, ev.x, ay, ev.z, 0, 1, 1.2, 0.5);
    pop(c, ev.x2, by, ev.z2, 2.0, 1.8);
    P.sphere(ZAP, 26, ev.x2, by, ev.z2, 4, 14);
    P.sphere(ARC, 8, ev.x2, by, ev.z2, 0, 2, 1.3, 0.5);
    airRing(c, ev.x2, ev.y2 + 0.3, ev.z2, 0, 1, 0, 0.3, 1.8, pal, 0.25, 1.2, 0.16, 1);
    if (c.nearGround(ev.x2, ev.y2 + 0.3, ev.z2, 1.5)) groundGlow(c, ev.x2, c.groundY(ev.x2, ev.z2, ev.y2), ev.z2, 2, pal.color, 1.2, 0.5, 0.02);
    c.lights.flash(ev.x2, by, ev.z2, pal.color, 6, 18, 0.2);
  } else if (ev.k === 'duskstep') {
    const pal = c.use(EL.umbra);
    const ay = ev.y + 1.0, by = ev.y2 + 1.0;
    // origin: the shadow folds in on itself
    for (let i = P.n(16); i > 0; i--) { const a = rnd() * TAU, u = rnd2(), s = Math.sqrt(1 - u * u), r = rr(0.9, 1.6); P.emit(SHADOW, ev.x + Math.cos(a) * s * r, ay + u * r, ev.z + Math.sin(a) * s * r, -Math.cos(a) * s * 3.2, -u * 3.2, -Math.sin(a) * s * 3.2, 0.9, 0, 0.5); }
    P.sphere(SHADOW_GLOW, 6, ev.x, ay, ev.z, 0.3, 1.5, 0.9);
    faceRing(c, ev.x, ay, ev.z, 1.5, 0.25, pal, 0.22, 0.4, 0.1);
    // destination: it bursts open
    P.sphere(SHADOW, 18, ev.x2, by, ev.z2, 1.5, 5, 1.1);
    P.sphere(SHADOW_GLOW, 9, ev.x2, by, ev.z2, 1, 4, 1.1);
    P.sphere(SHADOW_MOTE, 16, ev.x2, by, ev.z2, 1, 5);
    faceRing(c, ev.x2, by, ev.z2, 0.25, 1.6, pal, 0.26, 0.5, 0.1);
    pop(c, ev.x2, by, ev.z2, 1.3);
    // a thread of smoke between the two, gone in a blink
    const s = c.strips.path(SS.SMOKE, 0.55, 14);
    if (s) {
      s.color(pal.color, 1.6, pal.color, 1.6);
      for (let i = 0; i < 14; i++) { const t = i / 13, sag = Math.sin(t * Math.PI); s.set(i, ev.x + (ev.x2 - ev.x) * t, ay + (by - ay) * t + sag * 0.5, ev.z + (ev.z2 - ev.z) * t, 0.3 + sag * 0.7, sag); }
      s.end(0.32);
    }
    for (const [gx, gy, gz] of [[ev.x, ev.y, ev.z], [ev.x2, ev.y2, ev.z2]]) if (c.nearGround(gx, gy + 0.3, gz, 1.5)) {
      const d = c.decals.begin(DS.SHADOW, gx, c.groundY(gx, gz, gy), gz, 1.2, 0.9);
      d.fuse = 0.15; d.fadeIn = 0.03; d.fadeOut = 0.5; d.c0(pal.color, 0.7).c1(pal.color, 0.5);
      c.decals.commit();
    }
    c.lights.flash(ev.x2, by, ev.z2, pal.color, 2.5, 10, 0.2);
  } else if (ev.k === 'deploy') {
    const el = elOf(element), pal = c.use(el);
    const x = ev.x2, y = ev.y2, z = ev.z2;
    // a falling star: the streak, then the column it leaves standing
    I.reset().pos(x, y, z).aimZ(0.1188, 0.9897, -0.0792).scale(0.16, 0.16, 70); I.style = 0; I.life = 0.36; I.shrinkOut = 0.3;
    I.c0(pal.color, 1.5).c1(pal.core, 1.6);
    c.B.beams.spawn(I);
    I.reset().pos(x, y, z).aimZ(0, 1, 0).scale(0.6, 0.6, 18); I.style = 4; I.p1 = 0.5; I.p2 = 0.8; I.life = 0.8;
    I.c0(pal.color, 1.2).c1(pal.core, 1.2);
    c.B.beams.spawn(I);
    pop(c, x, y + 0.8, z, 2.0, 2.0);
    flare(c, x, y + 1, z, 2.0, pal, 0.3, 1.0);
    shock(c, x, y, z, 2.8, pal, 0.22, 0.09, 1.4, 0.35);
    const d = c.decals.begin(DS.RUNE, x, y, z, 1.8, 1.8);
    d.fuse = 0.2; d.p1 = el; d.p2 = 0; d.fadeIn = 0.03; d.fadeOut = 0.8; d.c0(pal.color, 1.5).c1(pal.core, 1.9);
    c.decals.commit();
    dust(c, x, y, z, 12, 0.6, 5, 1, 1.2, true);
    P.ring(SPARK_FLOAT, 30, x, y + 0.3, z, 0.4, 9, 3);
    for (let i = P.n(26); i > 0; i--) P.emit(MOTE, x + rnd2() * 0.8, y + rnd() * 3, z + rnd2() * 0.8, 0, rr(1, 4), 0, 1.1, rnd() * 0.3);
    c.lights.flash(x, y + 1.5, z, pal.color, 8, 24, 0.4, 0.05);
    // where they left from: a brief rising thread
    I.reset().pos(ev.x, ev.y, ev.z).aimZ(0, 1, 0).scale(0.45, 0.45, 12); I.style = 4; I.p1 = 0.4; I.p2 = 0.6; I.life = 0.7;
    I.c0(pal.color, 1.4).c1(pal.core, 2.0);
    c.B.beams.spawn(I);
    P.sphere(MOTE, 14, ev.x, ev.y + 1, ev.z, 0.5, 3);
  }
}

// ------------------------------------------------------------------------------------- pops / pickup

export function popEvent(c: Ctx, ev: PopEvent): void {
  if (ev.k === 'bubble') { c.use(EL.tide); bubblePop(c, ev.x, ev.y, ev.z, 1.3); return; }
  const pal = c.use(EL.frost), P = c.P;
  const { x, y, z } = ev;
  const gy = c.groundY(x, z, y - 1);
  scratch.pal = pal;
  chunks(c, c.B.crystals, 16, x, y, z, gy, 6, 6, 0.3, pal.color, 1.0, pal.core, 1.6, 1, 0, 0, 0, 0, 0.5);
  P.sphere(ICE_CHIP, 34, x, y, z, 3, 11, 1.2, 0.5);
  P.sphere(FLAKE, 18, x, y, z, 1, 5, 1.1, 0.6);
  P.sphere(FROST_MIST, 6, x, y, z, 0.5, 2, 1.1, 0.4);
  pop(c, x, y, z, 2.2, 1.8);
  faceRing(c, x, y, z, 0.4, 2.0, pal, 0.26, 1.2, 0.14);
  if (c.nearGround(x, y, z, 2.2)) frostMark(c, x, gy, z, 1.4, pal, 3);
  c.lights.flash(x, y, z, pal.color, 4, 14, 0.2);
}

export function pickup(c: Ctx, ev: PickupEvent, px: number, py: number, pz: number, hasPicker: boolean): void {
  const pal = c.usePal(c.heal), P = c.P;
  pop(c, ev.x, ev.y, ev.z, 1.8, 1.8);
  P.sphere(MOTE, 24, ev.x, ev.y, ev.z, 1, 5, 1.1);
  P.sphere(GLINT, 8, ev.x, ev.y, ev.z, 0.5, 3);
  faceRing(c, ev.x, ev.y, ev.z, 0.3, 1.8, pal, 0.3, 1.1, 0.16);
  c.lights.flash(ev.x, ev.y, ev.z, pal.color, 3.2, 12, 0.3);
  if (!hasPicker) return;
  // the heal washes up the body of whoever took it
  for (let i = P.n(30); i > 0; i--) {
    const a = rnd() * TAU, h = rnd(), r = 0.55;
    P.emit(MOTE, px + Math.cos(a) * r, py + h * 0.6, pz + Math.sin(a) * r, -Math.sin(a) * 1.5, rr(1.6, 3.2), Math.cos(a) * 1.5, 1.1, h * 0.35);
  }
  I.reset().pos(px, py + 0.95, pz).scale(0.7, 1.15, 0.7); I.style = 1; I.life = 0.7; I.scaleEnd = 1.15; I.shrinkOut = 0.5;
  I.c0(pal.color, 1.6).c1(pal.core, 1.6);
  c.B.shells.spawn(I);
  const d = c.decals.begin(DS.RUNE, px, py, pz, 1.2, 1.1);
  d.fuse = 0.2; d.p1 = GLYPH_HEAL; d.p2 = 0; d.fadeIn = 0.04; d.fadeOut = 0.6; d.c0(pal.color, 1.4).c1(pal.core, 1.7);
  c.decals.commit();
}

void SUNMOTE; void SMOKE_HOT;
