// Bot fighters. A bot is an ordinary fighter whose Input is written by a BotBrain every tick:
// it sees the same world, obeys the same cooldowns and has the same reaction limits as a
// person (reaction delay, imperfect aim, limited turn speed), scaled by a skill value.

import { angleDiff, approachAngle, clamp, Rng, wrapAngle, type Vec3 } from '../math';
import { VOID, HALL, type World } from '../world';
import { ELEMENT_ORDER, type AbilityDef } from '../elements';
import {
  BTN_JUMP, CHEST_HEIGHT, DT, MAX_HP, MV_NONE, PLAYER_RADIUS, SLOT_BUTTON,
  type PlayerState,
} from '../types';
import { abilityOf, canUse, hasControl } from './player';
import { getNav, type NavPath } from './nav';
import type { Ent, Fighter, Game } from './game';

export const BOT_NAMES = [
  'Bjorn', 'Sigrid', 'Ragnvald', 'Astrid', 'Ivar', 'Freydis', 'Leif', 'Gudrun', 'Hakon', 'Thyra', 'Ulf', 'Ylva',
  'Eirik', 'Solveig', 'Torsten', 'Runa', 'Halfdan', 'Brynja', 'Knut', 'Hilda', 'Orm', 'Signy', 'Arne', 'Liv',
  'Gunnar', 'Ingrid', 'Sten', 'Tove', 'Vidar', 'Yrsa',
];

/** Preferred fighting distance per element (index = element order). */
const PREF_RANGE = [8, 10, 12, 2.3, 2.6, 5, 2.3, 22];

const tmp: Vec3 = { x: 0, y: 0, z: 0 };

export class BotBrain {
  readonly rng: Rng;
  readonly skill: number;
  readonly aggression: number;
  /** Seconds until this bot walks out of the hall once a match is live. */
  deployIn = 3;

  private targetId = 0;
  private thinkT = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private errYaw = 0; private errPitch = 0; private errT = 0;
  private strafe = 1; private strafeT = 0;
  private path: NavPath | null = null; private pathI = 0; private pathT = 0; private pathGX = 0; private pathGZ = 0;
  private dodgeT = 0; private dodgeX = 0; private dodgeZ = 0;
  private jumpAt = -1;
  private useT = [0, 0, 0, 0, 0];
  private seen = new Set<number>();
  private stuckT = 0; private lastX = 0; private lastZ = 0; private unstick = 0;
  private hallGoal: Vec3 | null = null; private hallWait = 1;
  private castAim: Vec3 | null = null; private castAimT = 0;
  private pendingSlot = -1; private pendingT = 0;
  /** An ability the bot has decided on and is still lining up. */
  private intent: { slot: number; aim: Vec3; tol: number; until: number } | null = null;
  private fleeing = false;
  private roam: Vec3 | null = null;
  private hazardX = 0; private hazardZ = 0; private hazard = false;
  private threatDodge: { t: number; x: number; z: number; jump: boolean } | null = null;
  private time = 0;

  constructor(seed: number, skill: number) {
    this.rng = new Rng(seed);
    this.skill = clamp(skill, 0.1, 1);
    this.aggression = this.rng.range(0.3, 1);
    this.strafe = this.rng.chance(0.5) ? 1 : -1;
    this.thinkT = this.rng.range(0, 0.15);
  }

  // ------------------------------------------------------------------------------------------
  think(game: Game, f: Fighter): void {
    const s = f.s;
    const inp = f.input;
    this.time += DT;
    inp.seq++; inp.b = 0; inp.mx = 0; inp.mz = 0;
    for (let i = 0; i < 5; i++) if (this.useT[i] > 0) this.useT[i] -= DT;
    if (this.castAimT > 0) { this.castAimT -= DT; if (this.castAimT <= 0) this.castAim = null; }
    if (s.hall) this.thinkHall(game, f);
    else this.thinkArena(game, f);
    inp.yaw = this.aimYaw; inp.pitch = this.aimPitch;
  }

  // ------------------------------------------------------------------------------------------ helpers
  private move(inp: { mx: number; mz: number }, dx: number, dz: number, scale = 1) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    dx /= l; dz /= l;
    const fx = -Math.sin(this.aimYaw), fz = -Math.cos(this.aimYaw);
    const rx = Math.cos(this.aimYaw), rz = -Math.sin(this.aimYaw);
    inp.mz = (dx * fx + dz * fz) * scale;
    inp.mx = (dx * rx + dz * rz) * scale;
  }

  /** Would walking this way keep the bot on solid ground? */
  private safe(world: World, s: PlayerState, dx: number, dz: number): boolean {
    for (const d of [1.1, 2.3]) {
      const g = world.ground(s.x + dx * d, s.z + dz * d, s.y + 0.6).y;
      if (g <= VOID || s.y - g > 2.8) return false;
    }
    return true;
  }

  /** Rotate a desired direction until it is safe to walk. Returns false if nowhere is. */
  private steerSafe(world: World, s: PlayerState, dir: { x: number; z: number }): boolean {
    if (this.safe(world, s, dir.x, dir.z)) return true;
    for (const a of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1, Math.PI]) {
      const cs = Math.cos(a), sn = Math.sin(a);
      const x = dir.x * cs - dir.z * sn, z = dir.x * sn + dir.z * cs;
      if (this.safe(world, s, x, z)) { dir.x = x; dir.z = z; return true; }
    }
    return false;
  }

  private aimAt(s: PlayerState, x: number, y: number, z: number, rate: number) {
    const dx = x - s.x, dy = y - (s.y + CHEST_HEIGHT + 0.15), dz = z - s.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.aimYaw = approachAngle(this.aimYaw, wrapAngle(yaw + this.errYaw), rate * DT);
    this.aimPitch = clamp(this.aimPitch + clamp(pitch + this.errPitch - this.aimPitch, -rate * DT, rate * DT), -1.3, 1.3);
  }

  private aimError(s: PlayerState, x: number, y: number, z: number): number {
    const dx = x - s.x, dy = y - (s.y + CHEST_HEIGHT + 0.15), dz = z - s.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return Math.hypot(angleDiff(this.aimYaw, yaw), this.aimPitch - pitch);
  }

  private followPath(game: Game, s: PlayerState, inp: { mx: number; mz: number; b: number }, gx: number, gz: number): boolean {
    this.pathT -= DT;
    if (!this.path || this.pathT <= 0 || Math.hypot(gx - this.pathGX, gz - this.pathGZ) > 4) {
      this.path = getNav().findPath(s.x, s.z, gx, gz, 7 - this.skill * 3);
      this.pathI = 0; this.pathT = 0.8 + this.rng.next() * 0.5; this.pathGX = gx; this.pathGZ = gz;
    }
    const p = this.path;
    if (!p) return false;
    while (this.pathI < p.pts.length - 1 && Math.hypot(p.pts[this.pathI].x - s.x, p.pts[this.pathI].z - s.z) < 1.1) this.pathI++;
    const w = p.pts[this.pathI];
    const dx = w.x - s.x, dz = w.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) return true;
    const dir = { x: dx / d, z: dz / d };
    if (p.jumps[this.pathI]) {
      // a gap: run straight at it and jump from the lip
      this.move(inp, dir.x, dir.z);
      const ahead = game.world.ground(s.x + dir.x * 0.9, s.z + dir.z * 0.9, s.y + 0.6).y;
      if (s.onGround && (ahead <= VOID || s.y - ahead > 1.2)) inp.b |= BTN_JUMP;
      return true;
    }
    if (!this.steerSafe(game.world, s, dir)) return false;
    this.move(inp, dir.x, dir.z);
    // hop up ledges that are just too tall to step
    if (s.onGround && w.y - s.y > 0.5 && w.y - s.y < 1.7 && d < 2.2) inp.b |= BTN_JUMP;
    return true;
  }

  private checkStuck(s: PlayerState, inp: { mx: number; mz: number; b: number }) {
    this.stuckT += DT;
    if (this.unstick > 0) {
      this.unstick -= DT;
      if (s.onGround && this.unstick > 0.5) inp.b |= BTN_JUMP;
    }
    if (this.stuckT < 0.9) return;
    const moved = Math.hypot(s.x - this.lastX, s.z - this.lastZ);
    const wanted = Math.abs(inp.mx) + Math.abs(inp.mz) > 0.3;
    this.stuckT = 0; this.lastX = s.x; this.lastZ = s.z;
    if (wanted && moved < 0.5 && hasControl(s)) {
      this.unstick = 0.7; this.strafe = -this.strafe; this.path = null; this.pathT = 0;
    }
  }

  // ------------------------------------------------------------------------------------------ hall
  private thinkHall(game: Game, f: Fighter) {
    const s = f.s, inp = f.input;
    const live = game.match.phase === 'live';
    if (live) {
      this.deployIn -= DT;
      if (this.deployIn <= -9) { game.deploy(s.id); return; } // never get stranded
      if (this.deployIn <= 0) {
        // walk out through the Skygate like everybody else
        const gx = HALL.gate.x, gz = HALL.gate.z + 0.6;
        this.aimAt(s, gx, s.y + CHEST_HEIGHT, gz, 5);
        if (Math.hypot(gx - s.x, gz - s.z) < 4 && s.z > HALL.terrace.z) this.move(inp, gx - s.x, gz - s.z);
        else if (!this.followPath(game, s, inp, gx, gz - 2.5)) this.move(inp, gx - s.x, gz - s.z);
        this.checkStuck(s, inp);
        return;
      }
    }
    // loiter: wander between the fire, the pedestals and the terrace
    if (!this.hallGoal) {
      this.hallWait -= DT;
      if (this.hallWait <= 0) {
        const pts = game.world.hallPoints;
        const g = pts[this.rng.int(0, pts.length - 1)];
        this.hallGoal = { x: g.x + this.rng.range(-0.8, 0.8), y: g.y, z: g.z + this.rng.range(-0.8, 0.8) };
      } else {
        // face the fire or whoever is nearest
        let look: Vec3 = { x: HALL.firepit.x, y: HALL.floorY + 1, z: HALL.firepit.z };
        let bd = 6;
        for (const o of game.fighters.values()) {
          if (o === f || !o.s.hall || o.dummy) continue;
          const d = Math.hypot(o.s.x - s.x, o.s.z - s.z);
          if (d < bd) { bd = d; look = { x: o.s.x, y: o.s.y + 1.5, z: o.s.z }; }
        }
        this.aimAt(s, look.x, look.y, look.z, 2.5);
        return;
      }
    }
    const g = this.hallGoal!;
    const d = Math.hypot(g.x - s.x, g.z - s.z);
    if (d < 1.0) { this.hallGoal = null; this.hallWait = this.rng.range(2, 8); return; }
    this.aimAt(s, g.x, s.y + CHEST_HEIGHT, g.z, 4);
    if (!this.followPath(game, s, inp, g.x, g.z)) { this.hallGoal = null; this.hallWait = 1; }
    // stroll, don't sprint, indoors
    inp.mx *= 0.62; inp.mz *= 0.62;
    this.checkStuck(s, inp);
  }

  // ------------------------------------------------------------------------------------------ arena
  private pickTarget(game: Game, f: Fighter): Fighter | null {
    const s = f.s;
    let best: Fighter | null = null, bs = 1e9;
    for (const o of game.fighters.values()) {
      if (o === f || o.dummy || !o.s.alive || o.s.hall) continue;
      const d = Math.hypot(o.s.x - s.x, o.s.z - s.z);
      if (o.s.stealth > 0 && d > 4.5) continue;
      let score = d;
      if (o.s.id === this.targetId) score -= 6;
      if (f.lastHitBy === o.s.id && game.time - f.lastHitT < 4) score -= 9;
      if (o.s.hp < 35) score -= 5;
      if (o.s.inv > 0.4) score += 8;
      if (d < 30) { tmp.x = o.s.x; tmp.y = o.s.y + CHEST_HEIGHT; tmp.z = o.s.z; if (!game.world.los({ x: s.x, y: s.y + CHEST_HEIGHT, z: s.z }, tmp)) score += 10; }
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }

  /** Look for things about to hurt: projectiles on a collision course, ground hazards, wind-ups. */
  private perceive(game: Game, f: Fighter) {
    const s = f.s;
    this.hazard = false; this.hazardX = 0; this.hazardZ = 0;
    if (this.seen.size > 200) this.seen.clear();
    for (const e of game.ents.values() as IterableIterator<Ent>) {
      if (e.o === s.id) continue;
      const owner = game.fighters.get(e.o);
      if (owner && owner.s.hall) continue;
      const dx = s.x - e.x, dz = s.z - e.z;
      const d = Math.hypot(dx, dz);
      if (e.cls === 'strike' || (e.cls === 'zone' && e.k !== 'icetrail') || e.cls === 'orb') {
        const rad = (e.cls === 'orb' ? 4.2 : e.r) + 1.0;
        if (d < rad && Math.abs(s.y - e.y) < 5) {
          // strikes are only dodged if there is still time to notice them
          if (e.cls === 'strike' && e.p - e.age < 0.18 * (1.2 - this.skill)) continue;
          this.hazard = true;
          const l = d || 1;
          this.hazardX += dx / l; this.hazardZ += dz / l;
        }
      } else if (e.cls === 'wave' || e.cls === 'line') {
        const vl = Math.hypot(e.vx, e.vz) || 1;
        const ux = e.vx / vl, uz = e.vz / vl;
        const along = -(dx * ux + dz * uz) * -1; // distance of the bot ahead of the entity
        const lat = dx * uz - dz * ux;
        const half = (e.cls === 'wave' ? e.p / 2 : e.r) + 1;
        if (along > -1 && along < 14 && Math.abs(lat) < half && !this.seen.has(e.id)) {
          this.seen.add(e.id);
          if (this.rng.chance(0.25 + this.skill * 0.6)) {
            const side = lat >= 0 ? 1 : -1;
            this.threatDodge = { t: 0.1 + (1 - this.skill) * 0.25, x: uz * side, z: -ux * side, jump: e.cls === 'line' };
          }
        }
      } else if (e.cls === 'proj') {
        if (this.seen.has(e.id)) continue;
        const rx = e.x - s.x, ry = e.y - (s.y + 1), rz = e.z - s.z;
        const v2 = e.vx * e.vx + e.vy * e.vy + e.vz * e.vz;
        const t = -(rx * e.vx + ry * e.vy + rz * e.vz) / (v2 || 1);
        if (t <= 0 || t > 0.75) continue;
        const mx = rx + e.vx * t, my = ry + e.vy * t, mz = rz + e.vz * t;
        if (Math.hypot(mx, my, mz) > 1.5 + e.r) continue;
        this.seen.add(e.id);
        if (!this.rng.chance(0.15 + this.skill * 0.6)) continue;
        // sidestep away from the shot's line
        const vl = Math.hypot(e.vx, e.vz) || 1;
        const px = -e.vz / vl, pz = e.vx / vl;
        const side = (mx * px + mz * pz) > 0 ? -1 : 1;
        this.threatDodge = { t: 0.08 + (1 - this.skill) * 0.22, x: px * side, z: pz * side, jump: this.rng.chance(0.3) };
      }
    }
    // read enemy wind-ups
    for (const o of game.fighters.values()) {
      if (o === f || !o.s.alive || o.s.hall || o.dummy || o.s.act < 0) continue;
      const ab = abilityOf(o.s, o.s.act);
      if (o.s.actT > ab.windup) continue;
      const dx = s.x - o.s.x, dz = s.z - o.s.z;
      const d = Math.hypot(dx, dz);
      const key = o.s.id * 100 + o.s.act + 1e6 + Math.floor(game.time * 1.5) * 1e4;
      if (this.seen.has(key)) continue;
      const fx = ab.fx;
      if (fx.t === 'burst' && fx.groundedOnly && d < fx.radius + 0.5) {
        this.seen.add(key);
        if (this.rng.chance(0.2 + this.skill * 0.7)) this.jumpAt = this.time + Math.max(0, ab.windup - o.s.actT - 0.2);
      } else if ((fx.t === 'melee' && d < fx.range + 1.6) || (fx.t === 'cone' && d < fx.range + 1) || (fx.t === 'burst' && d < fx.radius + 1)) {
        this.seen.add(key);
        if (this.rng.chance(this.skill * 0.55)) { const l = d || 1; this.threatDodge = { t: 0.05 + (1 - this.skill) * 0.15, x: dx / l, z: dz / l, jump: false }; }
      } else if (fx.t === 'beam' && ab.anim === 'charge') {
        const ax = -Math.sin(o.s.actYaw), az = -Math.cos(o.s.actYaw);
        const along = dx * ax + dz * az, lat = dx * az - dz * ax;
        if (along > 0 && Math.abs(lat) < 2.5) {
          this.seen.add(key);
          if (this.rng.chance(0.3 + this.skill * 0.6)) { const side = lat >= 0 ? 1 : -1; this.threatDodge = { t: 0.3, x: az * side, z: -ax * side, jump: false }; }
        }
      }
    }
  }

  private press(inp: { b: number }, slot: number) { inp.b |= SLOT_BUTTON[slot]; }

  private thinkArena(game: Game, f: Fighter) {
    const s = f.s, inp = f.input;
    const world = game.world;
    const control = hasControl(s);

    // tech the knockdown
    if (s.launched && s.vy < 0) {
      const g = world.ground(s.x, s.z, s.y + 0.5).y;
      if (g > VOID && s.y - g < 0.9 && this.rng.chance(this.skill * 0.12)) inp.b |= BTN_JUMP;
    }

    // ---- slow thinking
    this.thinkT -= DT;
    if (this.thinkT <= 0) {
      this.thinkT = 0.12 + this.rng.next() * 0.06;
      const t = this.pickTarget(game, f);
      this.targetId = t ? t.s.id : 0;
      this.perceive(game, f);
      const hpLow = s.hp < 32;
      this.fleeing = hpLow && !!t && (t.s.hp > s.hp + 12 || this.aggression < 0.5) && Math.hypot(t.s.x - s.x, t.s.z - s.z) < 16;
    }
    this.errT -= DT;
    if (this.errT <= 0) {
      this.errT = 0.3 + this.rng.next() * 0.25;
      const k = (1 - this.skill) * 0.085 + 0.012;
      this.errYaw = this.rng.gauss() * k; this.errPitch = this.rng.gauss() * k * 0.6;
    }
    this.strafeT -= DT;
    if (this.strafeT <= 0) { this.strafeT = this.rng.range(0.5, 1.9); if (this.rng.chance(0.6)) this.strafe = -this.strafe; }

    const target = this.targetId ? game.fighters.get(this.targetId) || null : null;
    const t = target && target.s.alive && !target.s.hall ? target.s : null;
    const turn = 4.5 + this.skill * 8;

    // ---- falling over the abyss: get back
    const below = world.ground(s.x, s.z, s.y + 1).y;
    if (!s.onGround && below <= VOID) {
      const nav = getNav();
      const c = nav.nearestCell(s.x, s.z);
      if (c >= 0) {
        const hx = nav.wx[c], hz = nav.wz[c], hy = nav.h[c];
        const dx = hx - s.x, dz = hz - s.z, d = Math.hypot(dx, dz) || 1;
        // aim a little past the lip so we land well inside
        const ax = hx + (dx / d) * 2.5, az = hz + (dz / d) * 2.5;
        this.aimAt(s, ax, hy + 2.2 + Math.max(0, (hy - s.y)) * 0.4, az, 14);
        this.move(inp, dx, dz);
        if (control && s.cd[4] <= 0 && canUse(s, 4) && this.rng.chance(0.2 + this.skill * 0.5)) {
          const el = ELEMENT_ORDER[s.el];
          const aimed = this.aimError(s, ax, hy + 2.2 + Math.max(0, (hy - s.y)) * 0.4, az) < 0.25;
          if (el === 'gale' && s.vy < -1) this.press(inp, 4);
          else if ((el === 'storm' && d < 13) || (el === 'dawn' && d < 17)) { if (aimed) this.press(inp, 4); }
          else if ((el === 'ember' && d < 9.5) || (el === 'tide' && d < 12)) { if (s.y > hy - 0.3) this.press(inp, 4); }
        }
      }
      return;
    }

    // ---- decide where to aim
    let aimPt: Vec3 | null = null;
    if (this.castAim) aimPt = this.castAim;
    else if (t) aimPt = { x: t.x, y: t.y + CHEST_HEIGHT, z: t.z };
    if (aimPt) this.aimAt(s, aimPt.x, aimPt.y, aimPt.z, turn);

    // ---- movement
    const dir = { x: 0, z: 0 };
    let moving = false;
    if (this.threatDodge) {
      this.threatDodge.t -= DT;
      if (this.threatDodge.t <= 0) {
        const td = this.threatDodge; this.threatDodge = null;
        this.dodgeT = 0.38; this.dodgeX = td.x; this.dodgeZ = td.z;
        if (td.jump && s.onGround) inp.b |= BTN_JUMP;
        // a movement ability makes the best dodge
        if (control && canUse(s, 4) && this.rng.chance(this.skill * 0.45)) {
          const el = ELEMENT_ORDER[s.el];
          if (el === 'ember' || el === 'storm' || el === 'dawn' || el === 'tide') {
            this.aimYaw = Math.atan2(-td.x, -td.z); this.aimPitch = 0.05;
            this.move(inp, td.x, td.z); this.press(inp, 4);
          }
        }
      }
    }
    if (this.jumpAt >= 0 && this.time >= this.jumpAt) { this.jumpAt = -1; if (s.onGround) inp.b |= BTN_JUMP; }

    if (this.dodgeT > 0) {
      this.dodgeT -= DT;
      dir.x = this.dodgeX; dir.z = this.dodgeZ;
      moving = this.steerSafe(world, s, dir);
    } else if (this.hazard) {
      const l = Math.hypot(this.hazardX, this.hazardZ);
      if (l > 0.01) { dir.x = this.hazardX / l; dir.z = this.hazardZ / l; }
      else { dir.x = Math.cos(this.time * 3); dir.z = Math.sin(this.time * 3); }
      moving = this.steerSafe(world, s, dir);
    } else if (t) {
      const dx = t.x - s.x, dz = t.z - s.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      let pref = PREF_RANGE[s.el];
      // commit to close range when the close-range tools are ready and the bot is bold
      if (pref > 6 && this.aggression > 0.72 && s.cd[2] <= 0 && s.hp > 45) pref = Math.min(pref, 6.5);
      const rune = this.wantRune(game, s);
      if (rune) {
        this.followPath(game, s, inp, rune.x, rune.z);
        moving = false;
      } else if (this.fleeing) {
        dir.x = -ux; dir.z = -uz;
        if (!this.safe(world, s, dir.x, dir.z)) { dir.x = -uz * this.strafe; dir.z = ux * this.strafe; }
        moving = this.steerSafe(world, s, dir);
      } else if (d > 26 || Math.abs(t.y - s.y) > 2.2 || !this.clearWalk(world, s, ux, uz, Math.min(d, 6))) {
        if (!this.followPath(game, s, inp, t.x, t.z)) {
          dir.x = -uz * this.strafe; dir.z = ux * this.strafe;
          moving = this.steerSafe(world, s, dir);
        }
      } else if (d > pref + (pref < 4 ? 0.5 : 2.5)) {
        // brawlers weave a little on the way in so they are not a free target
        const weave = pref < 4 && d > 6 ? Math.sin(this.time * 3.1 + this.aggression * 9) * 0.45 : 0;
        dir.x = ux - uz * weave; dir.z = uz + ux * weave; moving = this.steerSafe(world, s, dir);
      } else if (d < pref - (pref < 4 ? 1.2 : 2.5)) {
        dir.x = -ux * 0.8 - uz * this.strafe * 0.6; dir.z = -uz * 0.8 + ux * this.strafe * 0.6;
        moving = this.steerSafe(world, s, dir);
      } else {
        dir.x = -uz * this.strafe + ux * 0.15; dir.z = ux * this.strafe + uz * 0.15;
        moving = this.steerSafe(world, s, dir);
        if (s.onGround && this.rng.chance(DT * 0.35 * this.skill)) inp.b |= BTN_JUMP;
      }
    } else {
      // nobody around: roam toward where fights happen
      if (!this.roam || Math.hypot(this.roam.x - s.x, this.roam.z - s.z) < 3) {
        const sp = world.spawns[this.rng.int(0, world.spawns.length - 1)];
        this.roam = { x: sp.x, y: sp.y, z: sp.z };
      }
      this.aimAt(s, this.roam.x, s.y + CHEST_HEIGHT, this.roam.z, 4);
      if (!this.followPath(game, s, inp, this.roam.x, this.roam.z)) this.roam = null;
    }
    if (moving) this.move(inp, dir.x, dir.z);
    this.checkStuck(s, inp);

    // ---- abilities
    if (!control || !t || s.act >= 0 || s.mv !== MV_NONE) return;
    if (this.pendingSlot >= 0) {
      // a decision made a moment ago (reaction time) now comes out
      this.pendingT -= DT;
      if (this.pendingT <= 0) { const slot = this.pendingSlot; this.pendingSlot = -1; if (canUse(s, slot)) this.press(inp, slot); }
      return;
    }
    if (this.intent) {
      // keep turning onto the chosen aim point; fire the moment it lines up
      const it = this.intent;
      if (this.time > it.until || !canUse(s, it.slot)) this.intent = null;
      else {
        this.castAim = it.aim; this.castAimT = 0.2;
        if (this.aimError(s, it.aim.x, it.aim.y, it.aim.z) <= it.tol) {
          this.intent = null;
          const ab = abilityOf(s, it.slot);
          this.castAim = it.aim; this.castAimT = ab.windup + 0.12;
          this.press(inp, it.slot);
          this.useT[it.slot] = ab.cooldown * (0.1 + (1 - this.skill) * 0.5 * this.rng.next()) + 0.2 * this.rng.next();
        }
        return;
      }
    }
    const dx = t.x - s.x, dy = t.y - s.y, dz = t.z - s.z;
    const d = Math.hypot(dx, dz);
    const hasLos = d < 60 && world.los({ x: s.x, y: s.y + CHEST_HEIGHT, z: s.z }, { x: t.x, y: t.y + CHEST_HEIGHT, z: t.z });
    const helpless = t.stun > 0.25 || t.down > 0.3 || t.root > 0.3 || t.freeze > 0.3 || t.bubble > 0.3;
    const tv = Math.hypot(t.vx, t.vz);

    for (const slot of [3, 2, 1, 0, 4]) {
      if (this.useT[slot] > 0 || !canUse(s, slot)) continue;
      const ab = abilityOf(s, slot);
      const ai = ab.ai;
      if (slot !== 4 && (d < ai.min || d > ai.max + (slot === 0 ? 0.6 : 0))) continue;
      let go = false;
      let aim: Vec3 | null = null;
      let tol = 0.07 + 0.6 / Math.max(2, d);
      switch (ai.use) {
        case 'melee':
          go = Math.abs(dy) < 1.8 && hasLos && d <= ai.max + 0.5; tol = 0.5;
          aim = { x: t.x, y: t.y + CHEST_HEIGHT, z: t.z };
          break;
        case 'poke': {
          if (!hasLos) break;
          aim = this.leadPoint(s, t, ab, d);
          go = true;
          break;
        }
        case 'burst': {
          if (!hasLos && ab.fx.t !== 'burst') break;
          if (ab.fx.t === 'burst' && ab.fx.groundedOnly && !t.onGround) break;
          if (ab.fx.t === 'burst') { go = Math.abs(dy) < 2.5; tol = 9; }
          else { aim = this.leadPoint(s, t, ab, d); go = true; tol = ab.fx.t === 'proj' ? tol : 0.3; }
          break;
        }
        case 'zone': {
          if (!hasLos) break;
          const lead = (ai.delay ?? 0.6) * (helpless ? 0 : 0.75);
          aim = { x: t.x + t.vx * lead, y: t.y + (ab.fx.t === 'proj' ? CHEST_HEIGHT : 0.1), z: t.z + t.vz * lead };
          go = helpless || this.rng.chance(0.5);
          tol = 0.12;
          break;
        }
        case 'trap': {
          const k = clamp(d * 0.5, 2, 7) / (d || 1);
          aim = { x: s.x + dx * k, y: s.y + 0.1, z: s.z + dz * k };
          go = d < 14 && (this.fleeing || this.rng.chance(0.3));
          tol = 0.25;
          break;
        }
        case 'push': {
          if (!hasLos) break;
          aim = this.leadPoint(s, t, ab, d);
          const edge = this.nearEdge(world, t, dx / (d || 1), dz / (d || 1));
          go = edge || this.rng.chance(0.35);
          break;
        }
        case 'wall':
          go = this.fleeing && d < 12 && this.rng.chance(0.5);
          aim = { x: t.x, y: t.y + CHEST_HEIGHT, z: t.z }; tol = 0.4;
          break;
        case 'escape': {
          go = this.useMovement(s, t, d, hasLos, tv);
          if (!go) break;
          tol = 0.35;
          if (ab.fx.t === 'leap') {
            // a leap's range is set by how high you look: pick the pitch that lands on the target
            const lx = t.x + t.vx * 0.5, lz = t.z + t.vz * 0.5;
            const ld = Math.hypot(lx - s.x, lz - s.z);
            // never leap at someone standing on the brink: the overshoot is a long way down
            const ox = (lx - s.x) / (ld || 1), oz = (lz - s.z) / (ld || 1);
            if (world.ground(lx + ox * 3.5, lz + oz * 3.5, t.y + 2).y <= VOID || world.ground(lx, lz, t.y + 2).y <= VOID) { go = false; break; }
            const pitch = clamp((ld - 10.6) * 0.082, -0.5, 0.4);
            aim = { x: lx, y: s.y + CHEST_HEIGHT + 0.15 + Math.tan(pitch) * ld, z: lz };
            tol = 0.12;
          } else aim = { x: t.x, y: t.y + CHEST_HEIGHT, z: t.z };
          break;
        }
        default: break;
      }
      if (!go) { this.useT[slot] = 0.15 + this.rng.next() * 0.25; continue; }
      if (aim) {
        // hold the aim through the wind-up
        this.castAim = aim; this.castAimT = ab.windup + 0.12;
        if (this.aimError(s, aim.x, aim.y, aim.z) > tol) {
          // not lined up yet: commit to it for a moment rather than re-deciding every tick
          this.intent = { slot, aim, tol, until: this.time + 0.45 + (1 - this.skill) * 0.3 };
          return;
        }
      }
      // humans do not act on the first possible frame
      this.pendingSlot = slot;
      this.pendingT = (1 - this.skill) * 0.22 * this.rng.next();
      this.useT[slot] = ab.cooldown * (0.1 + (1 - this.skill) * 0.5 * this.rng.next()) + (slot === 0 ? 0.1 : 0.25) * this.rng.next();
      return;
    }
  }

  /** Is there level ground between the bot and a point `dist` ahead (so walking straight works)? */
  private clearWalk(world: World, s: PlayerState, ux: number, uz: number, dist: number): boolean {
    let y = s.y;
    for (let d = 1.2; d <= dist; d += 1.2) {
      const g = world.ground(s.x + ux * d, s.z + uz * d, y + 0.6).y;
      if (g <= VOID || y - g > 2.8) return false;
      if (world.topAt(s.x + ux * d, s.z + uz * d) - g > 1.2) return false; // something tall in the way
      y = g;
    }
    return true;
  }

  /** Would shoving the target along (ux,uz) put it over the abyss? */
  private nearEdge(world: World, t: PlayerState, ux: number, uz: number): boolean {
    for (const d of [3, 6, 9]) if (world.ground(t.x + ux * d, t.z + uz * d, t.y + 1).y <= VOID) return true;
    return false;
  }

  private leadPoint(s: PlayerState, t: PlayerState, ab: AbilityDef, d: number): Vec3 {
    const ai = ab.ai;
    let x = t.x, y = t.y + CHEST_HEIGHT, z = t.z;
    if (ai.lead && ai.lead > 0) {
      const time = d / ai.lead;
      const k = 0.55 + this.skill * 0.45;
      x += t.vx * time * k; z += t.vz * time * k;
      if (!t.onGround) y += clamp(t.vy * time * 0.5, -2, 3);
      if (ai.arc) y += 0.5 * ai.arc * time * time - 0.11 * ai.lead * time;
    }
    // splash weapons: shoot the ground at their feet
    if (ab.fx.t === 'proj' && ab.fx.explode && t.onGround && d > 6) y = t.y + 0.25;
    return { x, y, z };
  }

  /** Should the bot spend its movement signature offensively right now? */
  private useMovement(s: PlayerState, t: PlayerState, d: number, los: boolean, _tv: number): boolean {
    const el = ELEMENT_ORDER[s.el];
    const bold = this.aggression > 0.45;
    if (this.fleeing) return d < 8 && el !== 'stone' && el !== 'frost' ? this.rng.chance(0.08) : false;
    switch (el) {
      case 'stone': return los && d > 5 && d < 16 && t.onGround && this.rng.chance(0.3);
      case 'ember': return los && d > 6 && d < 12 && bold && s.cd[2] <= 0.3 && this.rng.chance(0.06);
      case 'frost': return d > 17 && this.rng.chance(0.05);
      case 'storm': return los && d > 18 && this.rng.chance(0.04);
      case 'tide': return los && d > 3.5 && d < 11 && Math.abs(t.y - s.y) < 1.2 && this.rng.chance(0.08);
      case 'umbra': return d > 7 && d < 22 && bold && this.rng.chance(0.07);
      case 'dawn': return d < 5 && this.rng.chance(0.02);
      default: return false;
    }
  }

  /** A health rune worth walking to? */
  private wantRune(game: Game, s: PlayerState): Vec3 | null {
    if (s.hp > 55) return null;
    let best: Vec3 | null = null, bd = 30;
    for (const e of game.ents.values()) {
      if (e.k !== 'healrune') continue;
      const d = Math.hypot(e.x - s.x, e.z - s.z);
      if (d < bd && getNav().reachable(e.x, e.z)) { bd = d; best = e; }
    }
    return best;
  }
}

export const BOT_MAX_HP = MAX_HP;
export const BOT_BODY = PLAYER_RADIUS;
