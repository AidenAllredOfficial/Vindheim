// Client-side game state: the predicted local fighter, interpolated remote fighters and the
// locally-simulated combat entities.

import { angleDiff, hashString, lerp } from '@shared/math';
import { World } from '@shared/world';
import { ELEMENT_ORDER, type ElementId } from '@shared/elements';
import { DT, type EntityState, type Input, type PlayerState, type RosterEntry } from '@shared/types';
import { copyPlayerState, createPlayerState, stepPlayer, type StepHooks } from '@shared/sim/player';
import { ENTITY_CLASS, stepEntity } from '@shared/sim/entities';
import { decodeSelf, F_ALIVE, F_BUBBLE, F_BURN, F_FROZEN, F_GROUND, F_HALL, F_INV, F_LAUNCHED, F_ROOT, F_SHOCK, F_SLOW, F_STEALTH, R } from '@shared/net/protocol';
import type { PlayerView } from '../contracts';

/** How far in the past remote fighters are drawn, so there are always two snapshots to blend. */
const INTERP_DELAY = 0.1;

export function makeView(id: number): PlayerView {
  return {
    id, name: '', seed: id, element: 'ember', isLocal: false, isBot: false, isDummy: false,
    x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, face: 0, aimYaw: 0, aimPitch: 0, onGround: true, alive: true, hp: 100, inHall: true,
    act: -1, actT: 0, mv: 0, stun: 0, launched: false, down: 0, invuln: false,
    burning: false, chill: 0, frozen: false, shocked: false, rooted: false, slowed: false, bubbled: false, stealth: false, visible: false,
  };
}

interface Snap { t: number; a: number[] }

export class Remote {
  readonly view: PlayerView;
  private snaps: Snap[] = [];
  /** Time of death (for hiding the body after the collapse). */
  deadSince = -1;

  constructor(id: number) { this.view = makeView(id); }

  push(t: number, a: number[]): void {
    const s = this.snaps;
    if (s.length && t <= s[s.length - 1].t) return;
    s.push({ t, a });
    if (s.length > 12) s.shift();
  }

  /** Blend the two snapshots around render time `t` into the view. */
  sample(t: number): void {
    const s = this.snaps;
    const v = this.view;
    if (!s.length) return;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > t) i--;
    const b = s[i], a = i > 0 ? s[i - 1] : b;
    let k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    const A = a.a, B = b.a;
    const jump = Math.abs(B[R.x] - A[R.x]) + Math.abs(B[R.y] - A[R.y]) + Math.abs(B[R.z] - A[R.z]) > 7;
    if (jump) k = k < 0.5 ? 0 : 1;
    if (k > 1) {
      // newest snapshot is already in the past: coast on its velocity for a moment
      const ex = Math.min(t - b.t, 0.12);
      v.x = B[R.x] + B[R.vx] * ex; v.y = B[R.y] + B[R.vy] * ex; v.z = B[R.z] + B[R.vz] * ex;
      k = 1;
    } else {
      if (k < 0) k = 0;
      v.x = lerp(A[R.x], B[R.x], k); v.y = lerp(A[R.y], B[R.y], k); v.z = lerp(A[R.z], B[R.z], k);
    }
    v.vx = lerp(A[R.vx], B[R.vx], k); v.vy = lerp(A[R.vy], B[R.vy], k); v.vz = lerp(A[R.vz], B[R.vz], k);
    v.face = A[R.face] + angleDiff(A[R.face], B[R.face]) * k;
    v.aimYaw = A[R.yaw] + angleDiff(A[R.yaw], B[R.yaw]) * k;
    v.aimPitch = lerp(A[R.pitch], B[R.pitch], k);
    // discrete state comes from whichever snapshot we are closer to
    const D = k >= 0.5 ? B : A;
    const f = D[R.flags];
    v.hp = D[R.hp];
    v.act = D[R.act];
    v.actT = A[R.act] === B[R.act] && B[R.actT] >= A[R.actT] ? lerp(A[R.actT], B[R.actT], k) : D[R.actT] + (k >= 0.5 ? 0 : (t - a.t));
    v.mv = D[R.mv];
    v.down = lerp(A[R.down], B[R.down], k);
    v.stun = D[R.stun];
    v.chill = D[R.chill];
    v.onGround = !!(f & F_GROUND); v.alive = !!(f & F_ALIVE); v.launched = !!(f & F_LAUNCHED); v.inHall = !!(f & F_HALL);
    v.invuln = !!(f & F_INV); v.burning = !!(f & F_BURN); v.frozen = !!(f & F_FROZEN); v.shocked = !!(f & F_SHOCK);
    v.rooted = !!(f & F_ROOT); v.slowed = !!(f & F_SLOW); v.bubbled = !!(f & F_BUBBLE); v.stealth = !!(f & F_STEALTH);
  }
}

export interface LocalHooks extends StepHooks {}

export class ClientState {
  /** One World per client: dynamic colliders (ramparts) are mirrored into it for prediction. */
  readonly world = new World();
  myId = 0;
  /** Authoritative + predicted state of the local fighter. */
  readonly me: PlayerState = createPlayerState(0);
  private prev: PlayerState = createPlayerState(0);
  readonly myView: PlayerView = makeView(0);
  readonly remotes = new Map<number, Remote>();
  readonly roster = new Map<number, RosterEntry>();
  readonly ents = new Map<number, EntityState>();
  /** Projectiles whose impact was already shown locally; the server's despawn is then silent. */
  readonly endedLocally = new Set<number>();

  private pending: Input[] = [];
  private seq = 0;
  /** Decaying visual offset that hides prediction corrections. */
  private errX = 0; private errY = 0; private errZ = 0;
  /** server time (s) - local time (s), tracking the freshest packets. */
  private timeOffset = -1e9;
  private gotFirst = false;
  private myDeadSince = -1;
  private gateSealed = false;

  reset(myId: number): void {
    this.myId = myId;
    Object.assign(this.me, createPlayerState(myId));
    Object.assign(this.prev, createPlayerState(myId));
    Object.assign(this.myView, makeView(myId));
    this.myView.isLocal = true;
    this.remotes.clear(); this.roster.clear(); this.ents.clear(); this.endedLocally.clear();
    this.pending.length = 0; this.errX = this.errY = this.errZ = 0;
    this.timeOffset = -1e9; this.gotFirst = false; this.gateSealed = false; this.world.dyn = [];
    this.myDeadSince = -1;
  }

  // ------------------------------------------------------------------ roster
  setRoster(list: RosterEntry[]): { joined: RosterEntry[]; left: number[] } {
    const seen = new Set<number>();
    const joined: RosterEntry[] = [];
    for (const r of list) {
      seen.add(r.id);
      if (!this.roster.has(r.id)) joined.push(r);
      this.roster.set(r.id, r);
      const v = r.id === this.myId ? this.myView : this.remote(r.id).view;
      this.applyRoster(v, r);
    }
    const left: number[] = [];
    for (const id of this.roster.keys()) if (!seen.has(id)) left.push(id);
    for (const id of left) { this.roster.delete(id); this.remotes.delete(id); }
    return { joined, left };
  }

  private applyRoster(v: PlayerView, r: RosterEntry) {
    v.name = r.name; v.isBot = r.bot; v.isDummy = r.dummy;
    v.element = ELEMENT_ORDER[r.el] || 'ember';
    v.seed = hashString(r.name + (r.bot || r.dummy ? '' : '#' + r.id));
  }

  remote(id: number): Remote {
    let r = this.remotes.get(id);
    if (!r) { r = new Remote(id); this.remotes.set(id, r); const e = this.roster.get(id); if (e) this.applyRoster(r.view, e); }
    return r;
  }

  view(id: number): PlayerView | undefined {
    if (id === this.myId) return this.myView;
    return this.remotes.get(id)?.view;
  }

  nameOf(id: number): string { return this.roster.get(id)?.name || (id === 0 ? '' : 'Someone'); }
  elementOf(id: number): ElementId | null { const r = this.roster.get(id); return r ? ELEMENT_ORDER[r.el] : null; }

  // ------------------------------------------------------------------ snapshots
  /** Estimated server simulation time right now. */
  serverTime(nowSec: number): number { return nowSec + this.timeOffset; }

  onSnapshot(tick: number, ack: number, me: number[], others: number[][], nowSec: number): void {
    const t = tick * DT;
    // follow the least-delayed packets; let the estimate sag slowly so it adapts to rising latency
    const sample = t - nowSec;
    this.timeOffset = this.gotFirst ? Math.max(sample, this.timeOffset - 0.0004) : sample;
    this.gotFirst = true;

    for (const a of others) this.remote(a[R.id]).push(t, a);

    // reconcile: take the server's word, then replay the inputs it has not seen yet
    const bx = this.me.x, by = this.me.y, bz = this.me.z;
    decodeSelf(me, this.me);
    this.me.id = this.myId;
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop].seq <= ack) drop++;
    if (drop) this.pending.splice(0, drop);
    if (this.me.alive) for (const inp of this.pending) stepPlayer(this.me, inp, this.world, DT);
    const ex = bx - this.me.x, ey = by - this.me.y, ez = bz - this.me.z;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 > 0.000001 && d2 < 9) { this.errX += ex; this.errY += ey; this.errZ += ez; }
    else if (d2 >= 9) { this.errX = this.errY = this.errZ = 0; copyPlayerState(this.prev, this.me); }
  }

  /** Mispredicted far enough that the camera should cut rather than glide? */
  // ------------------------------------------------------------------ prediction tick
  tick(sample: { mx: number; mz: number; b: number }, yaw: number, pitch: number, hooks: LocalHooks): Input {
    const inp: Input = { seq: ++this.seq, mx: sample.mx, mz: sample.mz, yaw, pitch, b: sample.b };
    this.pending.push(inp);
    if (this.pending.length > 120) this.pending.shift();
    copyPlayerState(this.prev, this.me);
    if (this.me.alive) stepPlayer(this.me, inp, this.world, DT, hooks);
    else { this.me.yaw = yaw; this.me.pitch = pitch; }
    return inp;
  }

  /** Per rendered frame: write the local fighter's view (blended between ticks) and sample remotes. */
  frame(alpha: number, dt: number, nowSec: number, yaw: number, pitch: number): void {
    const k = Math.max(0, 1 - dt * 14);
    this.errX *= k; this.errY *= k; this.errZ *= k;
    const a = this.prev, b = this.me, v = this.myView;
    const tele = Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + Math.abs(b.z - a.z) > 5;
    const al = tele ? 1 : alpha;
    v.x = lerp(a.x, b.x, al) + this.errX; v.y = lerp(a.y, b.y, al) + this.errY; v.z = lerp(a.z, b.z, al) + this.errZ;
    v.vx = b.vx; v.vy = b.vy; v.vz = b.vz;
    v.face = a.face + angleDiff(a.face, b.face) * al;
    v.aimYaw = yaw; v.aimPitch = pitch;
    v.onGround = b.onGround; v.alive = b.alive; v.hp = b.hp; v.inHall = b.hall;
    v.act = b.act; v.actT = b.act >= 0 ? b.actT + (alpha - 1) * DT : 0;
    v.mv = b.mv; v.stun = b.stun; v.launched = b.launched; v.down = b.down; v.invuln = b.inv > 0;
    v.burning = b.burn > 0; v.chill = b.chill; v.frozen = b.freeze > 0; v.shocked = b.shock > 0; v.rooted = b.root > 0;
    v.slowed = b.slow > 0; v.bubbled = b.bubble > 0; v.stealth = b.stealth > 0;
    v.element = ELEMENT_ORDER[b.el] || v.element;
    if (b.alive) { this.myDeadSince = -1; v.visible = true; }
    else { if (this.myDeadSince < 0) this.myDeadSince = nowSec; v.visible = nowSec - this.myDeadSince < 2.4; }

    const rt = this.serverTime(nowSec) - INTERP_DELAY;
    for (const r of this.remotes.values()) {
      r.sample(rt);
      const rv = r.view;
      if (rv.alive) { r.deadSince = -1; rv.visible = rv.y > -900; }
      else { if (r.deadSince < 0) r.deadSince = nowSec; rv.visible = nowSec - r.deadSince < 2.4; }
    }
  }

  // ------------------------------------------------------------------ entities
  addEntity(e: EntityState, lead: number): EntityState {
    const copy: EntityState = { ...e };
    this.ents.set(copy.id, copy);
    if (copy.k === 'rampart') this.syncWalls();
    // start a little ahead to make up for latency (straight-line movers only)
    const cls = ENTITY_CLASS[copy.k];
    if (lead > 0 && (cls === 'proj' || cls === 'orb')) stepEntity(copy, Math.min(lead, 0.12), this.world);
    return copy;
  }

  removeEntity(id: number): EntityState | undefined {
    const e = this.ents.get(id);
    if (!e) return undefined;
    this.ents.delete(id);
    this.endedLocally.delete(id);
    if (e.k === 'rampart') this.syncWalls();
    return e;
  }

  /** The Skygate is barred between matches; prediction must know, or it walks through and snaps back. */
  setGateSealed(sealed: boolean): void {
    if (sealed === this.gateSealed) return;
    this.gateSealed = sealed;
    this.syncWalls();
  }

  private syncWalls() {
    const dyn = [];
    if (this.gateSealed) dyn.push(this.world.gateBarrier());
    for (const e of this.ents.values()) {
      if (e.k !== 'rampart') continue;
      dyn.push(this.world.makeDynamicBox('rampart', 100000 + e.id, e.x, e.z, e.p / 2, e.r, e.yaw, e.y - 1.5, e.y + e.q));
    }
    this.world.dyn = dyn;
  }

  /**
   * Advance entities. `attach` positions channel-type entities on their owner.
   * `onWorldHit` fires when a projectile visibly strikes the world before the server says so.
   */
  stepEntities(dt: number, attach: (e: EntityState) => void, onWorldHit: (e: EntityState) => void, onExpire: (e: EntityState) => void): void {
    for (const e of this.ents.values()) {
      const cls = ENTITY_CLASS[e.k];
      if (cls === 'channel') { e.age += dt; attach(e); }
      else if (this.endedLocally.has(e.id)) e.age += dt;
      else if (stepEntity(e, dt, this.world) && cls === 'proj') { this.endedLocally.add(e.id); onWorldHit(e); }
      // safety net: never keep something the server forgot to end
      if (e.age > e.life + 1.5) onExpire(e);
    }
  }
}
