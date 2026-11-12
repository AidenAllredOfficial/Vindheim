// Deterministic fighter step: movement, jumping, the action state machine and the signature
// movement abilities. This exact function runs on the server (authoritative) and on the owning
// client (prediction), so it must depend only on (state, input, world).
//
// Everything that affects OTHER fighters (damage, spawning projectiles…) is reported through the
// StepHooks callbacks; the server acts on them, the predicting client only uses them for feedback.

import { clamp, approach, approachAngle, dirFromYawPitch, wrapAngle } from '../math';
import { VOID, STEP_HEIGHT, type World, type GroundHit } from '../world';
import { ELEMENT_LIST, type AbilityDef, SLOT_MOVE } from '../elements';
import {
  AIR_ACCEL, BTN_JUMP, CHILL_SLOW, COYOTE_TIME, DOWN_TIME, GETUP_INVULN, GRAVITY, GROUND_ACCEL, GROUND_FRICTION,
  ICE_ACCEL, ICE_FRICTION, JUMP_VELOCITY, MAX_FALL_SPEED, MAX_HP, MOVE_SPEED, MV_DASH, MV_GLIDE, MV_LEAP, MV_NONE,
  MV_RAY, MV_SOAR, MV_SURGE, PLAYER_HEIGHT, PLAYER_RADIUS, SLOT_BUTTON, TECH_TIME, TECH_WINDOW, CHEST_HEIGHT,
  type Input, type PlayerState,
} from '../types';

export interface StepHooks {
  /** An action began (wind-up starts). */
  onStart?(p: PlayerState, slot: number, ab: AbilityDef): void;
  /**
   * An action's effect comes out now. `n` is the release index (0 for single effects, 0..burst-1
   * for volleys). For movement abilities this fires BEFORE the fighter is moved.
   */
  onRelease?(p: PlayerState, slot: number, ab: AbilityDef, n: number): void;
  /** A movement mode ended (dash finished, leap landed, ray arrived …). */
  onMoveEnd?(p: PlayerState, mode: number, landed: boolean): void;
  onJump?(p: PlayerState): void;
  /** Touched down. `speed` is the downward speed at impact; `knockdown` if it began a knockdown. */
  onLand?(p: PlayerState, speed: number, knockdown: boolean): void;
}

export const NO_INPUT: Input = { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0 };
const NO_HOOKS: StepHooks = {};
const PITCH_LIMIT = 1.45;
/** How long a button press is remembered while the fighter is busy. */
const BUFFER_TIME = 0.22;

export function createPlayerState(id: number): PlayerState {
  return {
    id, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, face: 0, onGround: false, ice: false,
    hp: MAX_HP, alive: true, el: 0, hall: true,
    act: -1, actT: 0, actYaw: 0, actPitch: 0, actN: 0, cd: [0, 0, 0, 0, 0],
    stun: 0, launched: false, down: 0, inv: 0, sinceJump: 9,
    coyote: 0, pb: 0, mv: MV_NONE, mvT: 0, mvX: 0, mvY: 0, mvZ: 0, airUsed: false,
    burn: 0, chill: 0, chillT: 0, freeze: 0, freezeImm: 0, shock: 0, root: 0, slow: 0, slowMul: 1, bubble: 0,
    stealth: 0, haste: 0, hasteMul: 1,
    buf: -1, bufT: 0, jbuf: 0,
  } as PlayerState;
}

/** Copy every field of `src` into `dst` (no allocation except the cooldown array reuse). */
export function copyPlayerState(dst: PlayerState, src: PlayerState): PlayerState {
  const cd = dst.cd;
  Object.assign(dst, src);
  dst.cd = cd;
  for (let i = 0; i < 5; i++) cd[i] = src.cd[i];
  return dst;
}

export const abilityOf = (p: PlayerState, slot: number): AbilityDef => (ELEMENT_LIST[p.el] || ELEMENT_LIST[0]).abilities[slot];

/** Can the fighter act / steer at all right now? */
export const hasControl = (p: PlayerState): boolean =>
  p.alive && p.stun <= 0 && !p.launched && p.down <= 0 && p.freeze <= 0 && p.bubble <= 0;

/** Can this slot be started right now (ignoring whether another action is in progress)? */
export function canUse(p: PlayerState, slot: number): boolean {
  if (!hasControl(p) || p.cd[slot] > 0) return false;
  const ab = abilityOf(p, slot);
  if (!ab.air && !p.onGround) return false;
  if (slot === SLOT_MOVE) {
    if (p.root > 0) return false;
    if (!p.onGround && p.airUsed) return false;
  }
  return true;
}

const ground: GroundHit = { y: 0, surf: 'grass', collider: null };
const pos2 = { x: 0, z: 0 };

function cancelAction(p: PlayerState) { p.act = -1; p.actT = 0; p.actN = 0; }

function endMove(p: PlayerState, hooks: StepHooks, landed: boolean) {
  const mode = p.mv;
  if (mode === MV_NONE) return;
  p.mv = MV_NONE; p.mvT = 0;
  if (mode === MV_DASH || mode === MV_SURGE) {
    // bleed off the burst speed, keep a run's worth of momentum
    const s = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    if (s > MOVE_SPEED) { p.vx *= MOVE_SPEED / s; p.vz *= MOVE_SPEED / s; }
  } else if (mode === MV_RAY) {
    p.vx = p.mvX * 4; p.vy = Math.max(0, p.mvY * 4); p.vz = p.mvZ * 4;
  }
  hooks.onMoveEnd?.(p, mode, landed);
}

/** Begin the signature movement of the fighter's element. Called at the action's release. */
function startMovement(p: PlayerState, ab: AbilityDef, inp: Input, world: World) {
  const fx = ab.fx;
  if (!p.onGround) p.airUsed = true;
  switch (fx.t) {
    case 'dash': {
      // dash where you are steering; with no input, where you are aiming
      let dx = -Math.sin(p.yaw) * inp.mz + Math.cos(p.yaw) * inp.mx;
      let dz = -Math.cos(p.yaw) * inp.mz - Math.sin(p.yaw) * inp.mx;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l < 0.2) { dx = -Math.sin(p.yaw); dz = -Math.cos(p.yaw); } else { dx /= l; dz /= l; }
      const sp = fx.dist / fx.time;
      p.mv = MV_DASH; p.mvT = fx.time; p.mvX = dx; p.mvY = 0; p.mvZ = dz;
      p.vx = dx * sp; p.vz = dz * sp; p.vy = 0;
      p.face = Math.atan2(-dx, -dz);
      break;
    }
    case 'glide': {
      p.mv = MV_GLIDE; p.mvT = fx.time; p.mvX = -Math.sin(p.yaw); p.mvY = 0; p.mvZ = -Math.cos(p.yaw);
      break;
    }
    case 'surge': {
      p.mv = MV_SURGE; p.mvT = fx.time; p.mvX = -Math.sin(p.yaw); p.mvY = 0; p.mvZ = -Math.cos(p.yaw);
      p.vy = 0;
      break;
    }
    case 'blink': {
      const d = dirFromYawPitch(p.yaw, clamp(p.pitch, -0.6, 1.1));
      const oy = p.y + CHEST_HEIGHT;
      const hit = world.raycast(p.x, oy, p.z, d.x, d.y, d.z, fx.dist, PLAYER_RADIUS * 0.9);
      const t = hit ? Math.max(0, hit.t - 0.35) : fx.dist;
      let nx = p.x + d.x * t, ny = oy + d.y * t - CHEST_HEIGHT, nz = p.z + d.z * t;
      const g = world.ground(nx, nz, ny + 1.2, ground);
      if (g.y > VOID && ny < g.y) ny = g.y;
      p.x = nx; p.y = ny; p.z = nz;
      p.vx = d.x * 3; p.vz = d.z * 3; p.vy = Math.max(0, d.y * 3);
      p.onGround = false; p.coyote = 0;
      break;
    }
    case 'leap': {
      const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
      // look down for a short hop, look up for a long high arc
      const k = clamp(0.75 + p.pitch * 0.6, 0.45, 1.15);
      p.vx = dx * fx.speed * k; p.vz = dz * fx.speed * k; p.vy = fx.up * clamp(0.85 + p.pitch * 0.35, 0.7, 1.1);
      p.mv = MV_LEAP; p.mvT = 4; p.mvX = dx; p.mvY = 0; p.mvZ = dz;
      p.onGround = false; p.coyote = 0;
      break;
    }
    case 'soar': {
      p.vy = fx.up; p.mv = MV_SOAR; p.mvT = fx.time; p.onGround = false; p.coyote = 0;
      break;
    }
    case 'meld': {
      p.stealth = fx.time; p.haste = fx.time; p.hasteMul = fx.haste;
      break;
    }
    case 'ray': {
      const d = dirFromYawPitch(p.yaw, clamp(p.pitch, -1.2, 1.2));
      const sp = fx.dist / fx.time;
      p.mv = MV_RAY; p.mvT = fx.time; p.mvX = d.x; p.mvY = d.y; p.mvZ = d.z;
      p.vx = d.x * sp; p.vy = d.y * sp; p.vz = d.z * sp;
      p.onGround = false; p.coyote = 0;
      break;
    }
  }
}

/**
 * Advance one fighter by dt. Mutates `p`.
 */
export function stepPlayer(p: PlayerState, inp: Input, world: World, dt: number, hooks: StepHooks = NO_HOOKS): void {
  if (!p.alive) { p.pb = inp.b; return; }

  // ------------------------------------------------------------------ timers
  for (let i = 0; i < 5; i++) if (p.cd[i] > 0) p.cd[i] = Math.max(0, p.cd[i] - dt);
  if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
  if (p.inv > 0) p.inv = Math.max(0, p.inv - dt);
  if (p.burn > 0) p.burn = Math.max(0, p.burn - dt);
  if (p.chillT > 0) { p.chillT -= dt; if (p.chillT <= 0) { p.chillT = 0; p.chill = 0; } }
  if (p.freeze > 0) { p.freeze -= dt; if (p.freeze <= 0) { p.freeze = 0; p.freezeImm = 3; } }
  if (p.freezeImm > 0) p.freezeImm = Math.max(0, p.freezeImm - dt);
  if (p.shock > 0) p.shock = Math.max(0, p.shock - dt);
  if (p.root > 0) p.root = Math.max(0, p.root - dt);
  if (p.slow > 0) { p.slow -= dt; if (p.slow <= 0) { p.slow = 0; p.slowMul = 1; } }
  if (p.bubble > 0) p.bubble = Math.max(0, p.bubble - dt);
  if (p.stealth > 0) p.stealth = Math.max(0, p.stealth - dt);
  if (p.haste > 0) { p.haste -= dt; if (p.haste <= 0) { p.haste = 0; p.hasteMul = 1; } }
  if (p.bufT > 0) { p.bufT -= dt; if (p.bufT <= 0) p.buf = -1; }
  if (p.jbuf > 0) p.jbuf -= dt;
  p.sinceJump += dt;

  p.yaw = wrapAngle(inp.yaw);
  p.pitch = clamp(inp.pitch, -PITCH_LIMIT, PITCH_LIMIT);

  const pressed = inp.b & ~p.pb;
  p.pb = inp.b;
  if (pressed & BTN_JUMP) { p.sinceJump = 0; p.jbuf = 0.12; }

  // air recovery: once the hit-stun of a launch wears off in mid-air the fighter rights itself
  if (p.launched && p.stun <= 0) p.launched = false;

  // knockdown countdown (lying, then getting up)
  if (p.down > 0) p.down = Math.max(0, p.down - dt);

  let control = hasControl(p);
  if (!control) {
    if (p.act >= 0) cancelAction(p);
    if (p.mv !== MV_NONE && (p.stun > 0 || p.launched || p.freeze > 0 || p.bubble > 0)) { p.mv = MV_NONE; p.mvT = 0; }
    p.buf = -1;
  }

  // ------------------------------------------------------------------ actions
  // remember presses
  for (let s = 4; s >= 0; s--) if (pressed & SLOT_BUTTON[s]) { p.buf = s; p.bufT = BUFFER_TIME; break; }

  if (control && p.act < 0 && p.mv !== MV_DASH && p.mv !== MV_RAY && p.mv !== MV_SURGE) {
    // a buffered press wins; otherwise any held button starts its action (auto-repeat)
    let want = -1;
    if (p.buf >= 0 && canUse(p, p.buf)) want = p.buf;
    else for (let s = 4; s >= 0; s--) if ((inp.b & SLOT_BUTTON[s]) && canUse(p, s)) { want = s; break; }
    if (want >= 0) {
      const ab = abilityOf(p, want);
      p.act = want; p.actT = 0; p.actN = 0;
      p.actYaw = p.yaw; p.actPitch = p.pitch;
      p.cd[want] = ab.cooldown;
      p.buf = -1; p.bufT = 0;
      if (p.mv === MV_GLIDE || p.mv === MV_SOAR) { /* attacks are allowed while gliding / soaring */ }
      hooks.onStart?.(p, want, ab);
    }
  }

  let moveMul = 1;
  let lungeSpeed = 0;
  if (p.act >= 0) {
    const ab = abilityOf(p, p.act);
    const fx = ab.fx;
    const prevT = p.actT;
    p.actT += dt;
    moveMul = ab.moveMul;
    // aim handling: melee is locked at the start; charges and channels slew; the rest follow freely until release
    if (fx.t === 'melee') { /* locked */ }
    else if (ab.anim === 'charge') { p.actYaw = approachAngle(p.actYaw, p.yaw, 0.9 * dt); p.actPitch = approach(p.actPitch, p.pitch, 0.9 * dt); }
    else if (fx.t === 'channel') { p.actYaw = approachAngle(p.actYaw, p.yaw, 2.6 * dt); p.actPitch = approach(p.actPitch, p.pitch, 2.6 * dt); }
    else if (p.actN === 0) { p.actYaw = p.yaw; p.actPitch = p.pitch; }

    if (fx.t === 'melee' && p.actT > ab.windup * 0.35 && p.actT < ab.windup + ab.active) lungeSpeed = fx.lunge;

    // releases
    const burst = fx.t === 'proj' && fx.burst ? fx.burst : 1;
    const interval = fx.t === 'proj' && fx.interval ? fx.interval : 0;
    while (p.act >= 0 && p.actN < burst && p.actT >= ab.windup + p.actN * interval) {
      if (p.actN > 0) { p.actYaw = p.yaw; p.actPitch = p.pitch; }
      const n = p.actN++;
      hooks.onRelease?.(p, p.act, ab, n);
      if (p.act === SLOT_MOVE) startMovement(p, ab, inp, world);
      else if (p.stealth > 0) { p.stealth = 0; p.haste = 0; p.hasteMul = 1; }
    }
    void prevT;
    if (p.act >= 0 && p.actT >= ab.windup + ab.active + ab.recovery) cancelAction(p);
  }

  // ------------------------------------------------------------------ horizontal velocity
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  let wx = -sy * inp.mz + cy * inp.mx;
  let wz = -cy * inp.mz - sy * inp.mx;
  let wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 1) { wx /= wl; wz /= wl; wl = 1; }
  if (!control || p.root > 0) { wx = 0; wz = 0; wl = 0; }

  let speed = MOVE_SPEED * moveMul;
  if (p.chill > 0) speed *= 1 - CHILL_SLOW * p.chill;
  if (p.shock > 0) speed *= 0.6;
  if (p.slow > 0) speed *= p.slowMul;
  if (p.haste > 0) speed *= p.hasteMul;

  let gravityMul = 1;
  const mode = p.mv;

  if (mode === MV_DASH) {
    p.mvT -= dt; p.vy = 0; gravityMul = 0;
    if (p.mvT <= 0) endMove(p, hooks, false);
  } else if (mode === MV_RAY) {
    p.mvT -= dt; gravityMul = 0;
    if (p.mvT <= 0) endMove(p, hooks, false);
  } else if (mode === MV_SURGE) {
    const fx = abilityOf(p, SLOT_MOVE).fx;
    const sp = fx.t === 'surge' ? fx.speed : 20;
    const a = approachAngle(Math.atan2(-p.mvX, -p.mvZ), p.yaw, 3.2 * dt);
    p.mvX = -Math.sin(a); p.mvZ = -Math.cos(a);
    p.vx = p.mvX * sp; p.vz = p.mvZ * sp; p.vy = 0; gravityMul = 0;
    p.face = a;
    p.mvT -= dt;
    if (p.mvT <= 0) endMove(p, hooks, false);
  } else if (mode === MV_GLIDE) {
    const fx = abilityOf(p, SLOT_MOVE).fx;
    const sp = fx.t === 'glide' ? fx.speed : 15;
    const turn = fx.t === 'glide' ? fx.turn : 2.5;
    const a = approachAngle(Math.atan2(-p.mvX, -p.mvZ), p.yaw, turn * dt);
    p.mvX = -Math.sin(a); p.mvZ = -Math.cos(a);
    p.vx = p.mvX * sp; p.vz = p.mvZ * sp;
    p.face = a;
    p.mvT -= dt;
    if (p.mvT <= 0) endMove(p, hooks, false);
    else if (p.jbuf > 0 && p.onGround) {
      // leap off the ribbon, keeping the speed
      p.jbuf = 0; p.vy = JUMP_VELOCITY; p.onGround = false; p.coyote = 0;
      endMove(p, hooks, false);
      hooks.onJump?.(p);
    }
  } else if (lungeSpeed > 0 && p.onGround) {
    p.vx = -Math.sin(p.actYaw) * lungeSpeed; p.vz = -Math.cos(p.actYaw) * lungeSpeed;
  } else if (p.onGround) {
    if (control && p.down <= 0) {
      const accel = (p.ice ? ICE_ACCEL : GROUND_ACCEL) * dt;
      const tx = wx * speed, tz = wz * speed;
      const dx = tx - p.vx, dz = tz - p.vz;
      const dl = Math.sqrt(dx * dx + dz * dz);
      if (dl <= accel || dl < 1e-6) { p.vx = tx; p.vz = tz; } else { p.vx += (dx / dl) * accel; p.vz += (dz / dl) * accel; }
    } else {
      const f = Math.max(0, 1 - (p.ice ? ICE_FRICTION : GROUND_FRICTION * 0.7) * dt);
      p.vx *= f; p.vz *= f;
    }
  } else {
    // airborne: limited steering, never beyond run speed by steering alone
    if (control && !p.launched && wl > 0 && mode !== MV_LEAP) {
      const accel = (mode === MV_SOAR ? AIR_ACCEL * 2.2 : AIR_ACCEL) * dt;
      const cap = mode === MV_SOAR ? MOVE_SPEED * 1.25 : Math.max(speed, 0.01);
      const cur = p.vx * wx + p.vz * wz;
      const add = Math.min(accel, Math.max(0, cap - cur));
      p.vx += wx * add; p.vz += wz * add;
    }
    if (p.bubble > 0) { const f = Math.max(0, 1 - 3 * dt); p.vx *= f; p.vz *= f; }
  }

  // ------------------------------------------------------------------ jumping & gravity
  if (p.onGround) p.coyote = COYOTE_TIME; else if (p.coyote > 0) p.coyote -= dt;
  if (control && p.jbuf > 0 && p.coyote > 0 && p.down <= 0 && p.root <= 0 && p.mv === MV_NONE && !(p.act >= 0 && abilityOf(p, p.act).moveMul === 0)) {
    p.vy = JUMP_VELOCITY; p.onGround = false; p.coyote = 0; p.jbuf = 0;
    hooks.onJump?.(p);
  }

  if (p.bubble > 0) {
    p.vy = approach(p.vy, 1.7, 30 * dt);
  } else if (gravityMul > 0) {
    let g = GRAVITY;
    if (p.mv === MV_SOAR) {
      p.mvT -= dt;
      const fx = abilityOf(p, SLOT_MOVE).fx;
      if (p.vy < 0 && fx.t === 'soar') { g *= fx.gravityMul; if (p.vy < -4.5) p.vy = approach(p.vy, -4.5, 60 * dt); }
      if (p.mvT <= 0) endMove(p, hooks, false);
    }
    p.vy = Math.max(-MAX_FALL_SPEED, p.vy - g * dt);
  }

  // ------------------------------------------------------------------ integrate (sub-stepped)
  const hs = Math.sqrt(p.vx * p.vx + p.vz * p.vz) * dt;
  const steps = Math.max(1, Math.ceil(Math.max(hs, Math.abs(p.vy) * dt) / 0.3));
  const sdt = dt / steps;
  const wasGround = p.onGround;
  let impact = 0;
  let landed = false;
  let blocked = false;
  for (let i = 0; i < steps; i++) {
    const ox = p.x, oz = p.z;
    pos2.x = p.x + p.vx * sdt; pos2.z = p.z + p.vz * sdt;
    if (world.resolveCircle(pos2, PLAYER_RADIUS, p.y, p.y + PLAYER_HEIGHT)) blocked = true;
    p.x = pos2.x; p.z = pos2.z;

    const g = world.ground(p.x, p.z, p.y, ground);
    if (p.onGround && p.vy <= 0) {
      if (g.y >= p.y - 0.42) { p.y = g.y; p.vy = 0; }
      else p.onGround = false;
    }
    if (!p.onGround) {
      p.y += p.vy * sdt;
      if (g.y > VOID && p.y <= g.y && p.vy <= 0) {
        impact = -p.vy; p.y = g.y; p.vy = 0; p.onGround = true; landed = true;
      } else if (g.y > VOID && g.y > p.y && g.y - p.y <= STEP_HEIGHT && p.vy <= 2 && p.mv !== MV_RAY) {
        // feet caught a lip: mantle onto it
        impact = Math.max(0, -p.vy); p.y = g.y; p.vy = 0; p.onGround = true; landed = true;
      }
      const c = world.ceiling(p.x, p.z, p.y);
      if (p.y + PLAYER_HEIGHT > c) { p.y = c - PLAYER_HEIGHT; if (p.vy > 0) p.vy = 0; }
    }
    if (p.onGround) p.ice = ground.surf === 'ice';
    // a ray dash ends when it hits something
    if (p.mv === MV_RAY && (blocked || landed)) { endMove(p, hooks, landed); break; }
    if (p.mv === MV_DASH && blocked) {
      const moved = Math.sqrt((p.x - ox) ** 2 + (p.z - oz) ** 2);
      if (moved < Math.abs(hs / steps) * 0.3) { endMove(p, hooks, false); }
    }
  }
  if (!p.onGround) p.ice = false;
  if (blocked && p.launched) { p.vx *= 0.6; p.vz *= 0.6; }

  // ------------------------------------------------------------------ landing
  if (landed && !wasGround) {
    p.airUsed = false;
    let knockdown = false;
    if (p.launched) {
      p.launched = false;
      knockdown = true;
      const tech = p.sinceJump < TECH_WINDOW;
      p.down = tech ? TECH_TIME : DOWN_TIME;
      p.inv = Math.max(p.inv, p.down + GETUP_INVULN);
      p.stun = 0;
      p.vx *= tech ? 0.6 : 0.3; p.vz *= tech ? 0.6 : 0.3;
    }
    if (p.mv === MV_LEAP) endMove(p, hooks, true);
    else if (p.mv === MV_SOAR) endMove(p, hooks, true);
    hooks.onLand?.(p, impact, knockdown);
  } else if (p.onGround) {
    p.airUsed = false;
  }

  // ------------------------------------------------------------------ facing
  if (p.act >= 0 && p.mv === MV_NONE) {
    p.face = approachAngle(p.face, p.actYaw, 22 * dt);
  } else if (control && p.mv === MV_NONE) {
    const sp2 = p.vx * p.vx + p.vz * p.vz;
    if (wl > 0.1 && sp2 > 0.5) p.face = approachAngle(p.face, Math.atan2(-wx, -wz), 13 * dt);
  }
}
