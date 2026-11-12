// Effects attached to fighters: cast tells and releases, melee swing arcs, movement
// signatures, continuous statuses and footfalls. Everything is read from PlayerView each frame.

import * as THREE from 'three';
import { ELEMENTS, type AbilityDef, type AnimKind } from '@shared/elements';
import { MV_DASH, MV_GLIDE, MV_LEAP, MV_NONE, MV_RAY, MV_SOAR, MV_SURGE } from '@shared/types';
import { dirFromYawPitch } from '@shared/math';
import type { PlayerView } from '../../contracts';
import type { Ctx } from './ctx';
import { surfColor, surfDust } from './ctx';
import type { Palette } from './core/particles';
import { DS } from './core/decals';
import { SS, type Strip } from './core/strips';
import { I } from './core/inst';
import { rnd, rnd2, rr } from './core/rand';
import {
  ARC, BUBBLET, CURL, DEBRIS, DROP, DUST, DUST_BIG, EMBER, FIREBLOB, FLAKE, FLAME, FLECK, FOAM, FROST_MIST, GATHER, GLINT, GLOW, GUST_PUFF, ICE_CHIP,
  MOTE, RAY, SHADOW, SHADOW_GLOW, SHADOW_MOTE, SMOKE, SPARK, SPARK_FLOAT, SPRAY, SUNMOTE, WIND, ZAP,
} from './pdefs';
import { TAU, airRing, bolt, cracks, dust, faceRing, gather, pop, ripple, trail } from './common';
import { live } from './kinds_a';

const EL: Record<string, number> = { ember: 0, frost: 1, storm: 2, stone: 3, gale: 4, tide: 5, umbra: 6, dawn: 7 };
const LIGHT_KEY = 500000;

class FState {
  id = 0; seen = 0;
  x = 0; y = 0; z = 0;
  // cast
  cast = -1; castWind = 0; castDecal = -1; castOrb = -1; castHalo = -1; castSocketWeapon = false;
  // movement
  mv = MV_NONE; mvAge = 0;
  readonly rib: (Strip | null)[] = [null, null, null, null];
  mvShell = -1; mvGlyph = -1; mvTimer = 0;
  // statuses
  frozen = false; frozenT = 0; readonly ice = new Int32Array(4); readonly iceSeed = new Float32Array(8);
  bubbled = false; bubble = -1;
  stealth = false;
  invuln = false; shield = -1;
  rooted = false; rootDecal = -1; readonly root: (Strip | null)[] = [null, null, null];
  shockT = 0;
  alive = true;

  reset(id: number): void {
    this.id = id; this.cast = -1; this.castDecal = this.castOrb = this.castHalo = -1;
    this.mv = MV_NONE; this.mvAge = 0; this.mvShell = this.mvGlyph = -1;
    for (let i = 0; i < 4; i++) this.rib[i] = null;
    this.frozen = this.bubbled = this.stealth = this.invuln = this.rooted = false;
    this.ice.fill(-1); this.bubble = this.shield = this.rootDecal = -1;
    for (let i = 0; i < 3; i++) this.root[i] = null;
    this.shockT = 0; this.alive = true;
  }
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

export class FighterFx {
  private readonly map = new Map<number, FState>();
  private readonly pool: FState[] = [];
  private stamp = 0;

  constructor(private c: Ctx) {}

  private state(p: PlayerView): FState {
    let s = this.map.get(p.id);
    if (!s) {
      s = this.pool.pop() || new FState();
      s.reset(p.id); s.x = p.x; s.y = p.y; s.z = p.z; s.stealth = p.stealth; s.alive = p.alive;
      this.map.set(p.id, s);
    }
    return s;
  }

  // =============================================================================== casts

  castStart(p: PlayerView, slot: number): void {
    const c = this.c, s = this.state(p);
    this.endCast(s, false);
    const def = ELEMENTS[p.element]?.abilities[slot];
    if (!def || def.windup < 0.05 || p.stealth) return;
    const el = EL[p.element] ?? 0, pal = c.use(el);
    s.cast = slot; s.castWind = def.windup; s.castSocketWeapon = slot === 0;
    s.castOrb = live(c.B.orbs); s.castHalo = live(c.B.glyphs);
    // big casts write a rune circle at the feet that brightens through the wind-up
    const big = slot >= 2 && slot <= 3 && def.windup >= 0.25;
    if (big && p.onGround) {
      const d = c.decals.begin(DS.RUNE, p.x, p.y, p.z, slot === 3 ? 1.9 : 1.5, def.windup + 0.4);
      d.fuse = def.windup; d.p1 = el; d.p2 = 1; d.fadeIn = 0.06; d.fadeOut = 0.3; d.c0(pal.color, 1.3).c1(pal.core, 1.7);
      s.castDecal = c.decals.commit();
    }
    c.fighters.socket(p.id, slot === 0 ? 'weaponTip' : 'handR', v1);
    pop(c, v1.x, v1.y, v1.z, 0.5);
  }

  private endCast(s: FState, released: boolean): void {
    if (s.cast < 0) return;
    const c = this.c;
    c.B.orbs.kill(s.castOrb); c.B.glyphs.kill(s.castHalo);
    c.decals.release(s.castDecal, released ? 0.3 : 0.15);
    s.castOrb = s.castHalo = s.castDecal = -1; s.cast = -1;
  }

  private tickCast(p: PlayerView, s: FState, dt: number): void {
    const c = this.c;
    if (p.act !== s.cast || !p.alive) {
      // interrupted: the gathered power gutters out
      c.fighters.socket(p.id, s.castSocketWeapon ? 'weaponTip' : 'handR', v1);
      c.use(EL[p.element] ?? 0);
      c.P.sphere(SPARK_FLOAT, 6, v1.x, v1.y, v1.z, 1, 4);
      this.endCast(s, false);
      return;
    }
    const el = EL[p.element] ?? 0, pal = c.use(el);
    const k = Math.min(1, p.actT / s.castWind), melee = s.castSocketWeapon;
    c.fighters.socket(p.id, melee ? 'weaponTip' : 'handR', v1);
    const size = (melee ? 0.1 : 0.12) + (melee ? 0.12 : 0.24) * k * (s.cast === 3 ? 1.3 : 1);
    I.reset().pos(v1.x, v1.y, v1.z).scale(size * (1 + 0.08 * Math.sin(c.now * 40)));
    I.style = el === 0 ? 0 : el === 2 ? 1 : el === 6 ? 2 : el === 7 ? 3 : 4; I.p1 = 1;
    I.c0(pal.color, 1.4 + 2.2 * k).c1(pal.core, 1.2 + 2.6 * k);
    c.B.orbs.write(s.castOrb, I);
    I.reset().pos(v1.x, v1.y, v1.z).scale(size * (4 + 3 * k)); I.style = k > 0.6 && !melee ? 1 : 2;
    I.c0(pal.color, 0.5 + 1.1 * k).c1(pal.core, 0.3 + 1.2 * k);
    c.B.glyphs.write(s.castHalo, I);
    gather(c, GATHER, (melee ? 14 : 26 + 50 * k) * dt, v1.x, v1.y, v1.z, melee ? 0.7 : 1.3, melee ? 0.7 : 1);
    if (!melee && s.cast >= 2) {
      // motes lift off the circle
      for (let i = c.P.n((6 + 18 * k) * dt); i > 0; i--) { const a = rnd() * TAU, r = rr(0.5, 1.5); c.P.emit(MOTE, p.x + Math.cos(a) * r, p.y + 0.1, p.z + Math.sin(a) * r, 0, rr(0.6, 1.8), 0, 0.8); }
      c.lights.hold(LIGHT_KEY + p.id, v1.x, v1.y, v1.z, pal.color, 0.5 + 1.6 * k, 8);
    }
  }

  castRelease(p: PlayerView, slot: number): void {
    const c = this.c, s = this.state(p);
    const def = ELEMENTS[p.element]?.abilities[slot];
    this.endCast(s, true);
    if (!def) return;
    const el = EL[p.element] ?? 0, pal = c.use(el);
    const aim = dirFromYawPitch(p.aimYaw, p.aimPitch);
    if (def.fx.t === 'melee') { this.swing(p, def, pal, el); return; }
    if (slot === 4) return; // movement signatures announce themselves
    c.fighters.socket(p.id, 'handR', v1);
    const big = slot === 3 ? 1.4 : slot === 2 ? 1.2 : 1;
    pop(c, v1.x, v1.y, v1.z, 1.0 * big, 0.8 * big);
    c.P.cone(el === 3 ? SPARK : SPARK_FLOAT, 8 * big, v1.x, v1.y, v1.z, aim.x, aim.y, aim.z, 0.5, 4, 12);
    airRing(c, v1.x + aim.x * 0.3, v1.y + aim.y * 0.3, v1.z + aim.z * 0.3, aim.x, aim.y, aim.z, 0.15, 0.75 * big, pal, 0.2, 0.9, 0.22);
    c.lights.flash(v1.x, v1.y, v1.z, pal.color, 1.3 * big, 8, 0.12);
  }

  /** The melee swing arc: shape follows the ability's animation archetype, reach and arc. */
  private swing(p: PlayerView, def: AbilityDef, pal: Palette, el: number): void {
    const c = this.c, P = c.P;
    if (def.fx.t !== 'melee') return;
    const range = def.fx.range, arc = (def.fx.arc * Math.PI) / 180;
    const yaw = p.aimYaw, f = dirFromYawPitch(yaw, 0);
    const anim: AnimKind = def.anim;
    const cy = p.y + 1.15;
    const life = 0.2;
    const arcInst = (style: number, scale: number, sweep: number, inner: number, mul: number, lifeMul = 1) => {
      I.scale(scale); I.vel(p.vx, p.vy * 0.5, p.vz);
      I.style = style; I.p1 = sweep; I.p2 = inner; I.life = life * lifeMul;
      I.c0(pal.color, 1.6 * mul).c1(pal.core, 1.5 * mul);
      c.B.arcs.spawn(I);
    };
    // sparks shed along the edge of the arc
    const edge = (n: number, defn: typeof SPARK, speed: number, vertical: boolean) => {
      for (let i = P.n(n); i > 0; i--) {
        const a = rnd2() * arc * 0.5, cs = Math.cos(a), sn = Math.sin(a), r = range * rr(0.75, 1);
        if (vertical) P.emit(defn, p.x + f.x * cs * r, cy + sn * r, p.z + f.z * cs * r, f.x * speed * rr(0.3, 1) + p.vx, rnd2() * 2, f.z * speed * rr(0.3, 1) + p.vz, 1, rnd() * 0.08);
        else { const dx = f.x * cs - f.z * sn, dz = f.z * cs + f.x * sn; P.emit(defn, p.x + dx * r, cy + rnd2() * 0.25, p.z + dz * r, dx * speed * rr(0.3, 1) + p.vx, rr(0, 2), dz * speed * rr(0.3, 1) + p.vz, 1, rnd() * 0.08); }
      }
    };
    switch (anim) {
      case 'overhead': {
        // a vertical arc from above the head down into the ground ahead
        I.reset().pos(p.x, cy, p.z).yaw(yaw).pitch(0.6).roll(Math.PI / 2); arcInst(0, range, arc * 1.15, 0.4, 1.1, 1.2);
        I.reset().pos(p.x, cy, p.z).yaw(yaw).pitch(0.6).roll(Math.PI / 2); arcInst(0, range, arc * 1.15, -0.26, 0.9, 1.2);
        const ix = p.x + f.x * range * 0.82, iz = p.z + f.z * range * 0.82;
        if (c.nearGround(ix, p.y + 0.5, iz, 1.5)) {
          const gy = c.groundY(ix, iz, p.y);
          cracks(c, ix, gy, iz, 1.3, pal.color, 3, 0.08, 0.8);
          dust(c, ix, gy, iz, 8, 0.3, 3.5, 1.2, 1);
          P.colA.copy(pal.color).multiplyScalar(0.55);
          P.hemi(DEBRIS, 12, ix, gy + 0.1, iz, 2, 8, 1);
          pop(c, ix, gy + 0.3, iz, 1.3, 1.0);
        }
        P.colA.copy(pal.color).multiplyScalar(0.8);
        edge(8, DUST, 2, true);
        break;
      }
      case 'thrust': {
        I.reset().pos(p.x, cy, p.z).yaw(yaw); arcInst(5, range, arc, 0.12, 1.3, 1.1);
        I.reset().pos(p.x, cy, p.z).yaw(yaw).roll(Math.PI / 2); arcInst(5, range, arc, 0.12, 1.0, 1.1);
        const tx = p.x + f.x * range, tz = p.z + f.z * range;
        pop(c, tx, cy, tz, 0.9, 1.3);
        P.cone(RAY, 10, p.x + f.x * 1.2, cy, p.z + f.z * 1.2, f.x, 0, f.z, 0.12, 8, 20);
        P.line(SUNMOTE, 8, p.x + f.x, cy, p.z + f.z, tx, cy, tz, 0.1, f.x * 2, 0.3, f.z * 2, 0.7);
        break;
      }
      case 'jab': {
        I.reset().pos(p.x, cy, p.z).yaw(yaw); arcInst(5, range, arc * 0.7, 0.15, 1.2, 0.8);
        I.reset().pos(p.x, cy, p.z).yaw(yaw).roll(Math.PI / 2); arcInst(5, range, arc * 0.7, 0.15, 1.0, 0.8);
        c.fighters.socket(p.id, 'handR', v1);
        bolt(c, v1.x, v1.y, v1.z, p.x + f.x * range, cy, p.z + f.z * range, pal, 0.3, 0.14, 0.12, 2, true);
        P.cone(ZAP, 14, p.x + f.x * 1.2, cy, p.z + f.z * 1.2, f.x, 0, f.z, 0.5, 5, 14);
        P.cone(ARC, 4, p.x + f.x * range * 0.8, cy, p.z + f.z * range * 0.8, f.x, 0, f.z, 0.8, 0, 2, 1);
        faceRing(c, p.x + f.x * range * 0.9, cy, p.z + f.z * range * 0.9, 0.15, 0.8, pal, 0.16, 1, 0.24, 1);
        break;
      }
      case 'kick': {
        I.reset().pos(p.x, cy - 0.35, p.z).yaw(yaw).roll(-0.75); arcInst(0, range, arc, 0.4, 1.0);
        I.reset().pos(p.x, cy - 0.35, p.z).yaw(yaw).roll(-0.75); arcInst(2, range * 1.02, arc, 0.55, 0.9, 1.3);
        I.reset().pos(p.x, cy - 0.35, p.z).yaw(yaw).roll(-0.75); arcInst(0, range, arc, -0.26, 0.8);
        edge(14, WIND, 16, false);
        P.cone(CURL, 4, p.x + f.x * range * 0.8, cy, p.z + f.z * range * 0.8, f.x, 0.3, f.z, 0.7, 2, 6, 1);
        P.cone(GUST_PUFF, 4, p.x + f.x * range * 0.7, cy, p.z + f.z * range * 0.7, f.x, 0.2, f.z, 0.6, 3, 8, 1);
        break;
      }
      case 'hook': {
        // sweeps the other way and drags water back toward the caster
        I.reset().pos(p.x, cy - 0.1, p.z).yaw(yaw).roll(0.12); arcInst(3, range, -arc, 0.5, 1.0, 1.25);
        I.reset().pos(p.x, cy - 0.1, p.z).yaw(yaw).roll(0.12); arcInst(0, range, -arc, 0.72, 0.7, 1.1);
        I.reset().pos(p.x, cy - 0.1, p.z).yaw(yaw).roll(0.12); arcInst(3, range, -arc, -0.3, 0.9, 1.2);
        for (let i = P.n(22); i > 0; i--) {
          const a = rnd2() * arc * 0.5, cs = Math.cos(a), sn = Math.sin(a), dx = f.x * cs - f.z * sn, dz = f.z * cs + f.x * sn, r = range * rr(0.7, 1);
          P.emit(DROP, p.x + dx * r, cy + rnd2() * 0.3, p.z + dz * r, -dx * rr(3, 8), rr(1, 4), -dz * rr(3, 8), 1, rnd() * 0.1);
        }
        P.emit(FOAM, p.x + f.x * range * 0.8, cy, p.z + f.z * range * 0.8, -f.x * 3, 1, -f.z * 3, 1.5);
        P.cone(SPRAY, 4, p.x + f.x * range * 0.8, cy, p.z + f.z * range * 0.8, -f.x, 0.3, -f.z, 0.8, 2, 5, 1);
        break;
      }
      case 'stab': {
        I.reset().pos(p.x, cy, p.z).yaw(yaw).roll(0.5); arcInst(4, range, arc * 0.75, 0.25, 1.1, 0.85);
        I.reset().pos(p.x, cy, p.z).yaw(yaw); arcInst(5, range, arc * 0.4, 0.2, 0.9, 0.7);
        I.reset().pos(p.x, cy, p.z).yaw(yaw).roll(Math.PI / 2 + 0.5); arcInst(4, range, arc * 0.75, 0.25, 1.0, 0.85);
        P.cone(SPARK_FLOAT, 8, p.x + f.x * 1.2, cy, p.z + f.z * 1.2, f.x, 0, f.z, 0.3, 6, 14);
        P.cone(SHADOW, 3, p.x + f.x * range * 0.7, cy, p.z + f.z * range * 0.7, f.x, 0.1, f.z, 0.6, 1, 3, 0.6);
        break;
      }
      default: {
        // 'swing': a wide, slightly canted horizontal sweep
        I.reset().pos(p.x, cy, p.z).yaw(yaw).roll(0.22); arcInst(0, range, arc, 0.45, 1.15);
        I.reset().pos(p.x, cy, p.z).yaw(yaw).roll(0.22); arcInst(0, range * 0.82, arc, 0.25, 0.55);
        I.reset().pos(p.x, cy, p.z).yaw(yaw).roll(0.22); arcInst(0, range, arc, -0.3, 0.9);
        if (el === 0) { edge(12, FLAME, 3, false); edge(10, EMBER, 4, false); edge(8, SPARK, 9, false); }
        else if (el === 1) { edge(10, ICE_CHIP, 6, false); edge(10, FLAKE, 2, false); edge(3, FROST_MIST, 1.5, false); }
        else edge(14, SPARK_FLOAT, 8, false);
        break;
      }
    }
    c.lights.flash(p.x + f.x * range * 0.6, cy, p.z + f.z * range * 0.6, pal.color, 1.4, 8, 0.12);
  }

  // =============================================================================== movement signatures

  private startMove(p: PlayerView, s: FState, pal: Palette): void {
    const c = this.c, P = c.P;
    const sp = Math.hypot(p.vx, p.vy, p.vz) || 1, dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
    const cy = p.y + 1.0;
    const rib = (i: number, style: SS, w: number, life: number, seg: number, m0: number, m1: number, orient = 0) => {
      const r = (s.rib[i] = c.strips.ribbon(style, w, life, seg, orient));
      if (r) r.color(pal.core, m0, pal.color, m1);
      return r;
    };
    switch (p.mv) {
      case MV_DASH: {
        const r0 = rib(0, SS.FIRE, 1.4, 0.3, 0.5, 3.0, 1.6); if (r0) r0.color(pal.color, 1.7, pal.dark, 1.5);
        const r1 = rib(1, SS.FIRE, 0.8, 0.22, 0.5, 2.6, 1.4); if (r1) r1.color(pal.color, 1.4, pal.dark, 1.3);
        pop(c, p.x, cy, p.z, 1.8, 1.2);
        airRing(c, p.x, cy, p.z, dx, dy, dz, 0.3, 1.6, pal, 0.24, 1.2, 0.2);
        P.cone(FLAME, 10, p.x, cy, p.z, -dx, 0.3, -dz, 0.9, 2, 6, 1);
        P.cone(SPARK, 14, p.x, cy, p.z, -dx, 0.3, -dz, 0.8, 4, 12);
        break;
      }
      case MV_GLIDE: {
        const r0 = rib(0, SS.ICE, 1.35, 1.0, 0.6, 1.0, 1.0, 1); if (r0) { r0.taper = 0.25; r0.headTaper = 0.05; r0.color(pal.color, 1.1, pal.color, 0.9); }
        rib(1, SS.GLOW, 0.16, 0.35, 0.5, 2.2, 1.0, 1);
        rib(2, SS.GLOW, 0.16, 0.35, 0.5, 2.2, 1.0, 1);
        pop(c, p.x, p.y + 0.3, p.z, 1.3, 0.9);
        P.hemi(ICE_CHIP, 12, p.x, p.y + 0.1, p.z, 2, 7);
        P.ring(FROST_MIST, 6, p.x, p.y + 0.2, p.z, 0.4, 2, 0.3, 1);
        break;
      }
      case MV_SOAR: {
        rib(0, SS.WIND, 0.6, 0.4, 0.4, 1.9, 1.0); rib(1, SS.WIND, 0.6, 0.4, 0.4, 1.9, 1.0);
        // the updraft that throws them skyward
        if (c.nearGround(p.x, p.y + 0.5, p.z, 3)) {
          const gy = c.groundY(p.x, p.z, p.y);
          dust(c, p.x, gy, p.z, 12, 0.5, 5, 1, 1.1, true);
          for (let i = 0; i < 2; i++) airRing(c, p.x, gy + 0.2 + i * 0.5, p.z, 0, 1, 0, 0.3, 2.2 - i * 0.6, pal, 0.3 + i * 0.08, 1.0, 0.16, 0, i * 0.06);
        }
        for (let i = P.n(34); i > 0; i--) { const a = rnd() * TAU, r = rr(0.2, 1.0); P.emit(WIND, p.x + Math.cos(a) * r, p.y + rnd() * 1.2, p.z + Math.sin(a) * r, -Math.sin(a) * 3, rr(10, 22), Math.cos(a) * 3, 1.3, rnd() * 0.12); }
        P.ring(CURL, 6, p.x, p.y + 0.4, p.z, 0.6, 3, 2, 1.1);
        pop(c, p.x, p.y + 0.4, p.z, 1.2);
        break;
      }
      case MV_SURGE: {
        const r0 = rib(0, SS.WATER, 1.5, 0.36, 0.5, 1.4, 1.1); if (r0) r0.color(pal.color, 1.4, pal.dark, 1.3);
        const r1 = rib(1, SS.WATER, 0.9, 0.3, 0.5, 1.3, 1.0); if (r1) r1.color(pal.color, 1.3, pal.dark, 1.2);
        s.mvShell = live(c.B.shells);
        P.hemi(DROP, 22, p.x, p.y + 0.4, p.z, 3, 9);
        P.ring(FOAM, 6, p.x, p.y + 0.3, p.z, 0.5, 3, 1, 1.4);
        if (c.nearGround(p.x, p.y + 0.5, p.z, 2)) ripple(c, p.x, c.groundY(p.x, p.z, p.y), p.z, 2.0, pal, 1.4);
        break;
      }
      case MV_LEAP: {
        const gy = c.groundY(p.x, p.z, p.y);
        if (c.nearGround(p.x, p.y + 0.5, p.z, 2.5)) {
          cracks(c, p.x, gy, p.z, 1.7, pal.color, 4, 0.08, 0.9);
          dust(c, p.x, gy, p.z, 14, 0.5, 5, 1.2, 1.2, true);
          P.colA.copy(pal.color).multiplyScalar(0.55);
          P.hemi(DEBRIS, 20, p.x, gy + 0.1, p.z, 3, 10, 1.1);
        }
        pop(c, p.x, p.y + 0.3, p.z, 1.4);
        break;
      }
      case MV_RAY: {
        const r0 = rib(0, SS.LIGHT, 0.34, 0.36, 1.2, 1.6, 1.2); if (r0) { r0.taper = 0.6; r0.headTaper = 0.03; }
        const r1 = rib(1, SS.GLOW, 0.9, 0.22, 1.2, 0.8, 0.5); if (r1) r1.taper = 0.7;
        s.mvGlyph = live(c.B.glyphs);
        pop(c, p.x, cy, p.z, 2.0, 2.2);
        P.sphere(RAY, 16, p.x, cy, p.z, 5, 12);
        faceRing(c, p.x, cy, p.z, 0.3, 1.3, pal, 0.2, 0.6, 0.1);
        break;
      }
      default: break;
    }
  }

  private tickMove(p: PlayerView, s: FState, pal: Palette, dt: number): void {
    const c = this.c, P = c.P, now = c.now;
    const sp = Math.hypot(p.vx, p.vy, p.vz) || 1, dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
    const cy = p.y + 1.0;
    switch (s.mv) {
      case MV_DASH:
        s.rib[0]?.move(p.x, cy + 0.15, p.z, now); s.rib[1]?.move(p.x, p.y + 0.4, p.z, now);
        trail(c, FLAME, 3.2, s.x, s.y + 0.9, s.z, p.x, p.y + 0.9, p.z, 0.4, 0, 1, 0, 1.0);
        trail(c, EMBER, 2.4, s.x, s.y + 0.9, s.z, p.x, p.y + 0.9, p.z, 0.5, 0, 0.5, 0);
        trail(c, SMOKE, 0.5, s.x, s.y + 1.2, s.z, p.x, p.y + 1.2, p.z, 0.3, 0, 0.6, 0, 0.9);
        c.lights.hold(LIGHT_KEY + p.id, p.x, cy, p.z, pal.color, 2.2, 11);
        break;
      case MV_GLIDE: {
        const hl = Math.hypot(p.vx, p.vz) || 1, hx = p.vx / hl, hz = p.vz / hl;
        const gy = c.groundY(p.x, p.z, p.y) + 0.07;
        s.rib[0]?.move(p.x - hx * 0.2, gy, p.z - hz * 0.2, now);
        s.rib[1]?.move(p.x - hz * 0.62, gy + 0.03, p.z + hx * 0.62, now);
        s.rib[2]?.move(p.x + hz * 0.62, gy + 0.03, p.z - hx * 0.62, now);
        // spray carved off both edges
        for (let i = P.n(26 * dt); i > 0; i--) { const side = rnd() < 0.5 ? -1 : 1; P.emit(ICE_CHIP, p.x - hz * side * 0.55, gy + 0.1, p.z + hx * side * 0.55, -hz * side * rr(1, 4) - hx * 2, rr(1.5, 5), hx * side * rr(1, 4) - hz * 2, 0.8); }
        trail(c, FROST_MIST, 0.7, s.x, s.y + 0.3, s.z, p.x, p.y + 0.3, p.z, 0.4, 0, 0.3, 0, 0.9);
        trail(c, FLAKE, 1.4, s.x, s.y + 0.6, s.z, p.x, p.y + 0.6, p.z, 0.5, 0, 0.5, 0);
        break;
      }
      case MV_SOAR: {
        c.fighters.socket(p.id, 'handL', v1); c.fighters.socket(p.id, 'handR', v2);
        s.rib[0]?.move(v1.x, v1.y, v1.z, now); s.rib[1]?.move(v2.x, v2.y, v2.z, now);
        // wind streams up from under the feet and curls away
        for (let i = P.n(34 * dt); i > 0; i--) { const a = rnd() * TAU, r = rr(0.2, 0.9); P.emit(WIND, p.x + Math.cos(a) * r, p.y - rr(0.2, 1.6), p.z + Math.sin(a) * r, p.vx * 0.5 - Math.sin(a) * 2, p.vy * 0.4 + rr(5, 11), p.vz * 0.5 + Math.cos(a) * 2, 1.1); }
        for (let i = P.n(5 * dt); i > 0; i--) P.emit(CURL, p.x + rnd2() * 0.6, p.y - rr(0, 0.8), p.z + rnd2() * 0.6, rnd2(), rr(1, 3), rnd2(), 0.9);
        for (let i = P.n(5 * dt); i > 0; i--) P.emit(GUST_PUFF, p.x + rnd2() * 0.5, p.y - 0.3, p.z + rnd2() * 0.5, 0, -1.5, 0, 1);
        s.mvTimer -= dt;
        if (s.mvTimer <= 0) { s.mvTimer = 0.2; airRing(c, p.x, p.y - 0.25, p.z, 0, 1, 0, 0.25, 1.15, pal, 0.3, 0.7, 0.16); }
        break;
      }
      case MV_SURGE: {
        const hl = Math.hypot(p.vx, p.vz) || 1, hx = p.vx / hl, hz = p.vz / hl;
        // the wave body wrapped around the fighter
        I.reset().pos(p.x, p.y + 0.85, p.z).aimZ(dx, dy, dz).scale(0.95, 1.05, 1.75); I.style = 3; I.c0(pal.color, 1.2).c1(pal.core, 1.4);
        c.B.shells.write(s.mvShell, I);
        s.rib[0]?.move(p.x - hx * 0.6, p.y + 0.75, p.z - hz * 0.6, now); s.rib[1]?.move(p.x - hx * 0.4, p.y + 0.25, p.z - hz * 0.4, now);
        for (let i = P.n(70 * dt); i > 0; i--) P.emit(DROP, p.x + rnd2() * 0.7, p.y + rr(0.2, 1.7), p.z + rnd2() * 0.7, -p.vx * 0.25 + rnd2() * 3, rr(1, 6), -p.vz * 0.25 + rnd2() * 3);
        for (let i = P.n(24 * dt); i > 0; i--) P.emit(FOAM, p.x + hx * 0.9 + rnd2() * 0.5, p.y + rr(0.2, 0.9), p.z + hz * 0.9 + rnd2() * 0.5, p.vx * 0.5, 1, p.vz * 0.5, 1.2);
        for (let i = P.n(16 * dt); i > 0; i--) P.emit(SPRAY, p.x - hx * 0.8 + rnd2() * 0.5, p.y + rr(0.3, 1.3), p.z - hz * 0.8 + rnd2() * 0.5, p.vx * 0.2, 1.2, p.vz * 0.2, 1.3);
        break;
      }
      case MV_LEAP:
        P.colA.copy(surfDust(c.surface(p.x, p.z, p.y))).lerp(pal.color, 0.5);
        trail(c, DUST, 4.5, s.x, s.y + 0.2, s.z, p.x, p.y + 0.2, p.z, 0.35, 0, -0.5, 0, 1.3);
        P.colA.copy(pal.color).multiplyScalar(0.55);
        trail(c, DEBRIS, 1.3, s.x, s.y + 0.2, s.z, p.x, p.y + 0.2, p.z, 0.4, 0, 0, 0, 0.9);
        break;
      case MV_RAY:
        s.rib[0]?.move(p.x, cy, p.z, now); s.rib[1]?.move(p.x, cy, p.z, now);
        I.reset().pos(p.x, cy, p.z).scale(2.6); I.style = 1; I.c0(pal.color, 1.4).c1(pal.core, 1.8);
        c.B.glyphs.write(s.mvGlyph, I);
        trail(c, SUNMOTE, 1.3, s.x, s.y + 1, s.z, p.x, cy, p.z, 0.3, 0, 0.3, 0, 0.9);
        trail(c, RAY, 0.9, s.x, s.y + 1, s.z, p.x, cy, p.z, 0.2, rnd2() * 4, rnd2() * 4, rnd2() * 4, 0.9);
        c.lights.hold(LIGHT_KEY + p.id, p.x, cy, p.z, pal.color, 3, 12);
        break;
      default: break;
    }
  }

  private endMove(p: PlayerView, s: FState, pal: Palette): void {
    const c = this.c, P = c.P;
    for (let i = 0; i < 4; i++) { s.rib[i]?.end(); s.rib[i] = null; }
    if (s.mvShell >= 0) {
      I.reset().pos(p.x, p.y + 0.85, p.z).scale(0.95, 1.05, 1.4); I.style = 3; I.life = 0.2; I.shrinkOut = 0.2; I.scaleEnd = 1.4; I.c0(pal.color, 1.2).c1(pal.core, 1.4);
      c.B.shells.finish(s.mvShell, I); s.mvShell = -1;
    }
    c.B.glyphs.kill(s.mvGlyph); s.mvGlyph = -1;
    switch (s.mv) {
      case MV_DASH: P.sphere(EMBER, 12, p.x, p.y + 1, p.z, 1, 5); P.sphere(FLAME, 5, p.x, p.y + 1, p.z, 0.5, 2.5, 0.9); break;
      case MV_GLIDE: P.hemi(ICE_CHIP, 10, p.x, p.y + 0.1, p.z, 2, 6); P.ring(FROST_MIST, 4, p.x, p.y + 0.2, p.z, 0.3, 1.5, 0.3, 0.9); break;
      case MV_SOAR: P.sphere(CURL, 5, p.x, p.y + 0.8, p.z, 1, 3, 0.9); P.sphere(GUST_PUFF, 4, p.x, p.y + 0.8, p.z, 0.5, 2, 1); break;
      case MV_SURGE:
        P.hemi(DROP, 30, p.x, p.y + 0.5, p.z, 3, 10); P.ring(FOAM, 6, p.x, p.y + 0.3, p.z, 0.5, 4, 1, 1.5); P.sphere(SPRAY, 6, p.x, p.y + 0.8, p.z, 1, 4, 1.4);
        if (c.nearGround(p.x, p.y + 0.5, p.z, 2)) ripple(c, p.x, c.groundY(p.x, p.z, p.y), p.z, 2.4, pal, 1.6);
        break;
      default: break;
    }
  }

  // =============================================================================== statuses

  private statuses(p: PlayerView, s: FState, dt: number): void {
    const c = this.c, P = c.P, now = c.now;
    const cx = p.x, cz = p.z;

    // ---- stealth: a puff on entering and leaving, next to nothing in between
    if (p.stealth !== s.stealth) {
      c.use(EL.umbra);
      if (p.stealth) {
        for (let i = P.n(18); i > 0; i--) { const a = rnd() * TAU, r = rr(0.8, 1.5), h = rnd() * 1.8; P.emit(SHADOW, cx + Math.cos(a) * r, p.y + h, cz + Math.sin(a) * r, -Math.cos(a) * 2.6, (0.9 - h) * 1.2, -Math.sin(a) * 2.6, 0.95, 0, 0.55); }
        P.sphere(SHADOW_GLOW, 6, cx, p.y + 1, cz, 0.3, 1.5, 0.9);
        faceRing(c, cx, p.y + 1, cz, 1.4, 0.2, c.pals[EL.umbra], 0.22, 0.3, 0.1);
      } else {
        for (let i = P.n(20); i > 0; i--) { const a = rnd() * TAU, h = rnd() * 1.8; P.emit(SHADOW, cx + Math.cos(a) * 0.3, p.y + h, cz + Math.sin(a) * 0.3, Math.cos(a) * rr(1, 3), rr(0, 1), Math.sin(a) * rr(1, 3), 1.2); }
        P.sphere(SHADOW_GLOW, 7, cx, p.y + 1, cz, 0.5, 2.5, 1);
        P.sphere(SHADOW_MOTE, 10, cx, p.y + 1, cz, 0.5, 3);
      }
      s.stealth = p.stealth;
    }
    if (p.stealth) {
      c.use(EL.umbra);
      if (rnd() < 0.9 * dt) P.emit(SHADOW, cx + rnd2() * 0.3, p.y + 0.1, cz + rnd2() * 0.3, 0, 0.2, 0, 0.3, 0, 0.5);
    }

    // ---- burning: flames lick up the body
    if (p.burning && !p.stealth) {
      c.use(EL.ember);
      for (let i = P.n(46 * dt); i > 0; i--) { const a = rnd() * TAU, h = rr(0.1, 1.65); P.emit(FLAME, cx + Math.cos(a) * 0.4, p.y + h, cz + Math.sin(a) * 0.4, p.vx * 0.3, rr(0.8, 2.2), p.vz * 0.3, 1.3 + 0.6 * (1 - h / 1.65)); }
      for (let i = P.n(16 * dt); i > 0; i--) { const a = rnd() * TAU; P.emit(FIREBLOB, cx + Math.cos(a) * 0.34, p.y + rr(0.2, 1.5), cz + Math.sin(a) * 0.34, p.vx * 0.3, 1.6, p.vz * 0.3, 0.55, 0, 0.75); }
      for (let i = P.n(5 * dt); i > 0; i--) P.emit(GLOW, cx, p.y + rr(0.7, 1.3), cz, 0, 0.5, 0, 2.0, 0, 0.8);
      for (let i = P.n(10 * dt); i > 0; i--) P.emit(EMBER, cx + rnd2() * 0.35, p.y + rr(0.4, 1.8), cz + rnd2() * 0.35, rnd2() * 0.5, rr(1, 3), rnd2() * 0.5);
      for (let i = P.n(1.8 * dt); i > 0; i--) P.emit(SMOKE, cx + rnd2() * 0.2, p.y + 1.9, cz + rnd2() * 0.2, 0, 1.2, 0, 0.7);
    }

    // ---- chill: frost motes circling, more with every stack
    if (p.chill > 0 && !p.frozen && !p.stealth) {
      c.use(EL.frost);
      const n = Math.min(4, p.chill);
      for (let i = P.n((8 + 11 * n) * dt); i > 0; i--) { const a = rnd() * TAU, r = rr(0.5, 0.78); P.emit(FLAKE, cx + Math.cos(a) * r, p.y + rr(0.15, 1.85), cz + Math.sin(a) * r, -Math.sin(a) * 1.7 + p.vx * 0.5, rr(-0.5, 0.2), Math.cos(a) * 1.7 + p.vz * 0.5, 0.8 + 0.08 * n); }
      for (let i = P.n(2.2 * n * dt); i > 0; i--) P.emit(FROST_MIST, cx + rnd2() * 0.45, p.y + rr(0.2, 1.2), cz + rnd2() * 0.45, 0, 0.15, 0, 0.7 + 0.1 * n);
      for (let i = P.n(1.2 * n * dt); i > 0; i--) P.emit(GLOW, cx, p.y + rr(0.6, 1.3), cz, 0, 0, 0, 1.5, 0, 0.9);
      if (n >= 3) for (let i = P.n(4 * dt); i > 0; i--) P.emit(ICE_CHIP, cx + rnd2() * 0.4, p.y + rr(0.6, 1.6), cz + rnd2() * 0.4, rnd2(), 0.5, rnd2(), 0.5);
    }

    // ---- frozen: a faceted block of ice around the body
    if (p.frozen !== s.frozen) {
      const pal = c.use(EL.frost);
      if (p.frozen) {
        for (let i = 0; i < 4; i++) { s.ice[i] = live(c.B.iceblock); s.iceSeed[i * 2] = rnd() * TAU; s.iceSeed[i * 2 + 1] = rr(0.75, 1.1); }
        s.frozenT = now;
        pop(c, cx, p.y + 1, cz, 1.8, 1.4);
        P.sphere(FLAKE, 16, cx, p.y + 1, cz, 1, 4, 1, 0.5);
        P.ring(FROST_MIST, 6, cx, p.y + 0.3, cz, 0.5, 1.5, 0.3, 1.1);
        c.lights.flash(cx, p.y + 1, cz, pal.color, 2.5, 10, 0.2);
      } else {
        for (let i = 0; i < 4; i++) { c.B.iceblock.kill(s.ice[i]); s.ice[i] = -1; }
        P.sphere(FROST_MIST, 3, cx, p.y + 1, cz, 0.3, 1, 0.9);
      }
      s.frozen = p.frozen;
    }
    if (p.frozen) {
      const pal = c.use(EL.frost);
      const g = Math.min(1, (now - s.frozenT) / 0.12), gy = p.y;
      for (let i = 0; i < 4; i++) {
        const a = s.iceSeed[i * 2], k = s.iceSeed[i * 2 + 1];
        if (i === 0) I.reset().pos(cx, gy + 0.72, cz).yaw(a).scale(1.55 * g, 1.5 * g, 1.55 * g);
        else {
          const ang = a + i * 2.1, lean = 0.42, ll = 1 / Math.hypot(lean, 1);
          I.reset().pos(cx + Math.cos(ang) * 0.62, gy + 0.3, cz + Math.sin(ang) * 0.62).aimY(Math.cos(ang) * lean * ll, ll, Math.sin(ang) * lean * ll).scale(0.62 * k * g, 1.25 * k * g, 0.62 * k * g);
        }
        I.style = 1; I.c0(pal.color, 1.0).c1(pal.core, 1.5, i === 0 ? 0.92 : 1);
        c.B.iceblock.write(s.ice[i], I);
      }
      for (let i = P.n(5 * dt); i > 0; i--) P.emit(FLAKE, cx + rnd2() * 0.7, gy + rr(0.2, 2.1), cz + rnd2() * 0.7, 0, -0.3, 0, 0.8);
      for (let i = P.n(1.6 * dt); i > 0; i--) P.emit(FROST_MIST, cx + rnd2() * 0.6, gy + 0.2, cz + rnd2() * 0.6, rnd2() * 0.4, 0.1, rnd2() * 0.4, 0.9);
    }

    // ---- shocked: arcs crawl over the body
    if (p.shocked && !p.stealth) {
      const pal = c.use(EL.storm);
      s.shockT -= dt;
      if (s.shockT <= 0) {
        s.shockT = rr(0.035, 0.07);
        const a = rnd() * TAU, b = a + rr(1.2, 2.8), h1 = rr(0.2, 1.7), h2 = rr(0.2, 1.7);
        bolt(c, cx + Math.cos(a) * 0.46, p.y + h1, cz + Math.sin(a) * 0.46, cx + Math.cos(b) * 0.46, p.y + h2, cz + Math.sin(b) * 0.46, pal, 0.17, 0.13, 0.28, 0, false);
        if (rnd() < 0.3) bolt(c, cx + Math.cos(a) * 0.4, p.y + h1 * 0.5, cz + Math.sin(a) * 0.4, cx + Math.cos(a) * rr(0.6, 1.1), p.y + 0.05, cz + Math.sin(a) * rr(0.6, 1.1), pal, 0.13, 0.11, 0.22, 0, true);
      }
      for (let i = P.n(24 * dt); i > 0; i--) P.emit(ZAP, cx + rnd2() * 0.4, p.y + rr(0.3, 1.7), cz + rnd2() * 0.4, rnd2() * 4, rnd2() * 4, rnd2() * 4);
      for (let i = P.n(12 * dt); i > 0; i--) { const a = rnd() * TAU; P.emit(ARC, cx + Math.cos(a) * 0.48, p.y + rr(0.3, 1.7), cz + Math.sin(a) * 0.48, 0, 0, 0, 1.1); }
      for (let i = P.n(7 * dt); i > 0; i--) P.emit(GLOW, cx, p.y + rr(0.6, 1.4), cz, 0, 0, 0, 1.4, 0, 0.35);
    }

    // ---- rooted: shadow tendrils wind up the legs
    if (p.rooted !== s.rooted) {
      const pal = c.use(EL.umbra);
      if (p.rooted) {
        for (let i = 0; i < 3; i++) { const r = (s.root[i] = c.strips.path(SS.SMOKE, 0.34, 14)); if (r) r.color(pal.color, 2.6, pal.color, 3.2); }
        const d = c.decals.begin(DS.SHADOW, cx, p.y, cz, 0.85, 30);
        d.fuse = 0.15; d.fadeIn = 0.05; d.fadeOut = 0.3; d.c0(pal.color, 0.9).c1(pal.color, 0.6);
        s.rootDecal = c.decals.commit();
        P.ring(SHADOW, 6, cx, p.y + 0.2, cz, 0.6, -1, 0.5, 0.7);
      } else {
        for (let i = 0; i < 3; i++) { s.root[i]?.end(0.25); s.root[i] = null; }
        c.decals.release(s.rootDecal, 0.3); s.rootDecal = -1;
        P.sphere(SHADOW_MOTE, 8, cx, p.y + 0.4, cz, 0.5, 2);
      }
      s.rooted = p.rooted;
    }
    if (p.rooted) {
      c.use(EL.umbra);
      for (let i = 0; i < 3; i++) {
        const r = s.root[i];
        if (!r) continue;
        for (let j = 0; j < 14; j++) {
          const h = j / 13, a = i * 2.094 + h * 5.2 + Math.sin(now * 2 + i) * 0.3, rad = 0.52 - 0.06 * h + 0.03 * Math.sin(now * 5 + j);
          r.set(j, cx + Math.cos(a) * rad, p.y + 0.03 + h * 1.15, cz + Math.sin(a) * rad, 1 - 0.75 * h, 1);
        }
      }
      for (let i = P.n(6 * dt); i > 0; i--) { const a = rnd() * TAU; P.emit(SHADOW_MOTE, cx + Math.cos(a) * 0.6, p.y + 0.1, cz + Math.sin(a) * 0.6, 0, rr(0.3, 1), 0, 0.8); }
    }

    // ---- bubbled: a wobbling bubble around the fighter
    if (p.bubbled !== s.bubbled) {
      c.use(EL.tide);
      if (p.bubbled) { s.bubble = live(c.B.shells); P.sphere(BUBBLET, 8, cx, p.y + 1, cz, 0.5, 2, 1, 1.2); }
      else { c.B.shells.kill(s.bubble); s.bubble = -1; }
      s.bubbled = p.bubbled;
    }
    if (p.bubbled) {
      const pal = c.use(EL.tide);
      const w = Math.sin(now * 5.5) * 0.05;
      I.reset().pos(cx, p.y + 0.95, cz).scale(1.3 * (1 + w), 1.38 * (1 - w), 1.3 * (1 + w)); I.style = 0; I.c0(pal.color, 1.1).c1(pal.core, 1.5);
      c.B.shells.write(s.bubble, I);
      for (let i = P.n(6 * dt); i > 0; i--) P.emit(BUBBLET, cx + rnd2() * 0.9, p.y + rr(0, 1.8), cz + rnd2() * 0.9, 0, 0.5, 0, 0.9);
      for (let i = P.n(5 * dt); i > 0; i--) P.emit(DROP, cx + rnd2() * 0.8, p.y - 0.35, cz + rnd2() * 0.8, 0, -1, 0, 0.8);
    }

    // ---- invulnerable: a soft shield shimmer
    if (p.invuln !== s.invuln) {
      if (p.invuln) s.shield = live(c.B.shells); else { c.B.shells.kill(s.shield); s.shield = -1; }
      s.invuln = p.invuln;
    }
    if (p.invuln) {
      const pal = c.pals[EL[p.element] ?? 0];
      c.tmpColor.copy(pal.core).lerp(pal.color, 0.45);
      I.reset().pos(cx, p.y + 0.95, cz).scale(0.74, 1.15, 0.74); I.style = 1; I.c0(c.tmpColor, 0.5).c1(pal.core, 0.4);
      c.B.shells.write(s.shield, I);
    }
  }

  private dropStatuses(s: FState): void {
    const c = this.c;
    for (let i = 0; i < 4; i++) { c.B.iceblock.kill(s.ice[i]); s.ice[i] = -1; }
    c.B.shells.kill(s.bubble); c.B.shells.kill(s.shield); s.bubble = s.shield = -1;
    for (let i = 0; i < 3; i++) { s.root[i]?.end(0.2); s.root[i] = null; }
    c.decals.release(s.rootDecal, 0.2); s.rootDecal = -1;
    s.frozen = s.bubbled = s.invuln = s.rooted = false;
  }

  // =============================================================================== footfalls

  footfall(p: PlayerView, kind: 'step' | 'land' | 'jump', surface: string): void {
    if (p.stealth) return;
    const c = this.c, P = c.P;
    const m = kind === 'land' ? 4 : kind === 'jump' ? 2 : 1;
    const hl = Math.hypot(p.vx, p.vz), bx = hl > 0.5 ? -p.vx / hl : 0, bz = hl > 0.5 ? -p.vz / hl : 0;
    const y = p.y + 0.06;
    const puff = (n: number, scale: number) => {
      for (let i = P.n(n); i > 0; i--) { const a = rnd() * TAU, r = kind === 'step' ? 0.12 : 0.3; P.emit(DUST, p.x + Math.cos(a) * r, y + 0.05, p.z + Math.sin(a) * r, Math.cos(a) * (kind === 'step' ? 0.5 : 2.2) + bx * 1.2, rr(0.2, 0.9), Math.sin(a) * (kind === 'step' ? 0.5 : 2.2) + bz * 1.2, scale, 0, 0.7); }
    };
    const bits = (defn: typeof DEBRIS, n: number, scale: number) => {
      for (let i = P.n(n); i > 0; i--) P.emit(defn, p.x + rnd2() * 0.15, y + 0.05, p.z + rnd2() * 0.15, bx * rr(0.5, 2.5) + rnd2() * 1.2, rr(1.2, 3.2) * (kind === 'step' ? 1 : 1.5), bz * rr(0.5, 2.5) + rnd2() * 1.2, scale, 0, 0.75);
    };
    switch (surface) {
      case 'grass':
        P.colA.copy(surfDust('grass')); puff(1.2 * m, 0.5);
        P.colA.copy(surfColor('grass')); bits(FLECK, 2.5 * m, 1);
        break;
      case 'snow':
        P.colA.copy(surfDust('snow')).multiplyScalar(1.5); puff(2.5 * m, 0.6);
        bits(DEBRIS, 3 * m, 0.55);
        break;
      case 'ice':
        P.colA.copy(surfDust('ice')).multiplyScalar(1.5); bits(DEBRIS, 3 * m, 0.5); puff(0.6 * m, 0.4);
        c.usePal(c.pals[EL.frost]); P.sphere(GLINT, 0.8 * m, p.x, y + 0.1, p.z, 0.2, 0.8, 0.6);
        break;
      case 'wood':
        P.colA.copy(surfDust('wood')); puff(1.2 * m, 0.45); if (m > 1) bits(DEBRIS, 1.5 * m, 0.45);
        break;
      default: // rock, stone
        P.colA.copy(surfDust(surface)); puff(1.8 * m, 0.5);
        P.colA.copy(surfColor(surface)).multiplyScalar(0.8); bits(DEBRIS, 1.2 * m, 0.5);
        break;
    }
    if (kind === 'land') { P.colA.copy(surfDust(surface)).multiplyScalar(surface === 'snow' || surface === 'ice' ? 1.5 : 1); P.ring(DUST_BIG, 6, p.x, y + 0.1, p.z, 0.3, 2.6, 0.5, 0.55, 0.3); }
  }

  // =============================================================================== per frame

  update(dt: number): void {
    const c = this.c;
    this.stamp++;
    this.seenCount = 0;
    for (const p of c.fighters.all()) {
      const s = this.state(p);
      s.seen = this.stamp;
      this.seenCount++;
      const shown = p.visible && p.alive;
      const el = EL[p.element] ?? 0;
      if (!shown) {
        if (s.alive) { this.endCast(s, false); if (s.mv !== MV_NONE) { this.endMove(p, s, c.pals[el]); s.mv = MV_NONE; } this.dropStatuses(s); s.stealth = false; }
        s.alive = false; s.x = p.x; s.y = p.y; s.z = p.z;
        continue;
      }
      if (!s.alive) { s.alive = true; s.x = p.x; s.y = p.y; s.z = p.z; s.stealth = p.stealth; }
      // teleported? don't smear trails across the gap
      const jump = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
      if (jump > 6 && p.mv !== MV_RAY) { s.x = p.x; s.y = p.y; s.z = p.z; }
      if (s.cast >= 0) this.tickCast(p, s, dt);
      if (p.mv !== s.mv) {
        const pal = c.use(el);
        if (s.mv !== MV_NONE) this.endMove(p, s, pal);
        s.mv = p.mv; s.mvAge = 0; s.mvTimer = 0;
        if (p.mv !== MV_NONE && !p.stealth) this.startMove(p, s, pal);
      }
      if (s.mv !== MV_NONE) { s.mvAge += dt; this.tickMove(p, s, c.use(el), dt); }
      this.statuses(p, s, dt);
      s.x = p.x; s.y = p.y; s.z = p.z;
    }
    // fighters that left the scene
    if (this.map.size !== this.seenCount) this.map.forEach(this.sweep);
  }

  private seenCount = 0;
  private readonly sweep = (s: FState, id: number): void => {
    if (s.seen === this.stamp) return;
    const c = this.c;
    this.endCast(s, false);
    for (let i = 0; i < 4; i++) { s.rib[i]?.end(); s.rib[i] = null; }
    c.B.shells.kill(s.mvShell); c.B.glyphs.kill(s.mvGlyph);
    this.dropStatuses(s);
    this.map.delete(id); this.pool.push(s);
  };

  clear(): void {
    for (const s of this.map.values()) this.pool.push(s);
    this.map.clear();
  }
}
