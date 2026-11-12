// The authoritative simulation of one room: fighters, combat entities, hit resolution, scoring
// and the match loop. Runs on the server at TICK_RATE (and in-page for offline practice).

import { clamp, dirFromYawPitch, wrapAngle, Rng, type Vec3 } from '../math';
import { World, VOID, ARENA_KILL_Y, HALL_DROP_Y, HALL, colliderContains, type Collider, type SpawnPoint } from '../world';
import {
  ELEMENT_LIST, ELEMENT_ORDER, ZONES, SLOT_MOVE,
  type AbilityDef, type Effect, type EntityKind, type HitSpec, type ZoneDef,
} from '../elements';
import {
  BUBBLE_POP_MUL, BURN_DPS, CHEST_HEIGHT, CHILL_MAX, DT, FREEZE_SHATTER_MUL, FREEZE_TIME, GLORY_PER_DAMAGE,
  GLORY_PER_KILL, GLORY_PLACEMENT, GLORY_PARTICIPATION, GLORY_RINGOUT_BONUS, INTERMISSION_TIME, KB_HP_SCALE,
  KILL_CREDIT_WINDOW, LIGHT_STUN, HEAVY_STUN, MATCH_KILL_TARGET, MATCH_TIME, MAX_HP, MV_DASH, MV_GLIDE, MV_LEAP, MV_NONE, MV_RAY,
  MV_SURGE, PLAYER_HEIGHT, PLAYER_RADIUS, RESPAWN_TIME, RESULTS_TIME, SPAWN_INVULN,
  type AnnounceKind, type DespawnWhy, type EntityState, type GameEvent, type Input, type MatchInfo, type MatchResults,
  type PlayerState, type RosterEntry,
} from '../types';
import { abilityOf, createPlayerState, stepPlayer, NO_INPUT, type StepHooks } from './player';
import { aimPoint, shotDirection } from './aim';
import { BotBrain, BOT_NAMES } from './bots';

type EntClass = 'proj' | 'orb' | 'zone' | 'strike' | 'trap' | 'line' | 'wall' | 'wave' | 'channel' | 'pickup';

export interface Ent extends EntityState {
  cls: EntClass;
  ab: AbilityDef | null;
  /** Fighters already affected (projectile pierce, line, wave first contact). */
  hitIds: Set<number> | null;
  tickT: number;
  zone: ZoneDef | null;
  entered: Set<number> | null;
  col: Collider | null;
  /** Free slot: pickup spot index, wave distance travelled … */
  n: number;
  dead: boolean;
}

export interface Fighter {
  s: PlayerState;
  name: string;
  bot: boolean;
  dummy: boolean;
  brain: BotBrain | null;
  /** Latest input (bots write it directly; humans go through the queue). */
  input: Input;
  queue: Input[];
  /** Last processed input sequence. */
  ack: number;
  /** Owned element the fighter deploys with, and the trial element in the hall (-1 none). */
  equipped: number;
  trial: number;
  kills: number; deaths: number; streak: number; bestStreak: number; dmg: number;
  lastHitBy: number; lastHitT: number; lastHitKey: string;
  lastCombatT: number;
  lastKillT: number; multi: number;
  respawnT: number;
  wantHall: boolean;
  /** Chest-height position history for lag compensation (ring of HIST ticks). */
  hist: Float32Array;
  ping: number;
  gloryAcc: number;
  matchGlory: number;
  burnAcc: number; burnSrc: number;
  ambush: boolean;
  tpFrom: Vec3 | null;
  rayFrom: Vec3 | null;
  surgeHit: Set<number> | null;
  trailX: number; trailZ: number;
  home: SpawnPoint | null;
  regenT: number;
  joinedTick: number;
}

export interface GameCallbacks {
  /** Glory awarded to a human fighter. */
  onGlory?(f: Fighter, amount: number, why: 'hit' | 'kill' | 'ringout' | 'place' | 'match'): void;
  /** A persistent stat changed for a human fighter. */
  onStat?(f: Fighter, stat: 'kills' | 'deaths' | 'ringouts' | 'falls' | 'damage' | 'hits' | 'matches' | 'wins' | 'podiums' | 'streak' | 'matchKills', value: number): void;
  onMatchEnd?(results: MatchResults, standings: Fighter[]): void;
}

export interface GameOptions {
  bots: boolean;
  /** Total fighters the room is topped up to with bots. */
  population: number;
  seed: number;
}

const HIST = 32;
const tmpA: Vec3 = { x: 0, y: 0, z: 0 };
const tmpB: Vec3 = { x: 0, y: 0, z: 0 };
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Game {
  readonly world = new World();
  tick = 0;
  time = 0;
  readonly fighters = new Map<number, Fighter>();
  readonly ents = new Map<number, Ent>();
  /** Events produced since the last drain, broadcast to everyone in the room. */
  events: GameEvent[] = [];
  /** Events for a single recipient. */
  privateEvents = new Map<number, GameEvent[]>();
  match: MatchInfo = { phase: 'intermission', timeLeft: 9, killTarget: MATCH_KILL_TARGET, round: 1 };
  lastResults: MatchResults | null = null;
  rosterDirty = true;
  matchDirty = true;

  private nextFighterId = 1;
  private nextEntId = 1;
  private rng: Rng;
  private firstBlood = false;
  private leaderId = 0;
  private pickupT = 6;
  private pickupActive = new Set<number>();
  private cur: Fighter | null = null;
  private hooks: StepHooks;
  private announced = { minute: false, ten: false };

  constructor(readonly opts: GameOptions, readonly cb: GameCallbacks = {}) {
    this.rng = new Rng(opts.seed || 1);
    this.hooks = {
      onStart: (p, slot, ab) => this.onStart(this.cur!, slot, ab),
      onRelease: (p, slot, ab, n) => this.onRelease(this.cur!, slot, ab, n),
      onMoveEnd: (p, mode, landed) => this.onMoveEnd(this.cur!, mode, landed),
    };
    for (const spot of this.world.dummySpots) {
      const f = this.addFighter('Training Thrall', false, 0, true);
      f.home = spot;
      this.placeAt(f, spot.x, spot.y, spot.z, spot.yaw);
    }
  }

  // ============================================================================ fighters

  addFighter(name: string, bot: boolean, equipped: number, dummy = false, botSkill?: number): Fighter {
    const id = this.nextFighterId++;
    const s = createPlayerState(id);
    s.el = equipped;
    const f: Fighter = {
      s, name, bot, dummy, brain: null, input: { ...NO_INPUT }, queue: [], ack: 0, equipped, trial: -1,
      kills: 0, deaths: 0, streak: 0, bestStreak: 0, dmg: 0, lastHitBy: 0, lastHitT: -99, lastHitKey: '', lastCombatT: -99,
      lastKillT: -99, multi: 0, respawnT: 0, wantHall: false, hist: new Float32Array(HIST * 3), ping: 0,
      gloryAcc: 0, matchGlory: 0, burnAcc: 0, burnSrc: 0, ambush: false, tpFrom: null, rayFrom: null, surgeHit: null,
      trailX: 0, trailZ: 0, home: null, regenT: 0, joinedTick: this.tick,
    };
    if (bot) f.brain = new BotBrain(this.rng.int(1, 1e9), botSkill ?? this.rng.range(0.35, 0.92));
    this.fighters.set(id, f);
    if (!dummy) {
      this.spawnInHall(f, false);
      this.events.push({ e: 'join', p: id });
    }
    this.rosterDirty = true;
    return f;
  }

  removeFighter(id: number): void {
    const f = this.fighters.get(id);
    if (!f) return;
    for (const e of this.ents.values()) if (e.o === id && (e.cls === 'trap' || e.cls === 'channel')) this.despawn(e, 0);
    this.fighters.delete(id);
    this.privateEvents.delete(id);
    this.events.push({ e: 'leave', p: id, name: f.name });
    this.rosterDirty = true;
  }

  humans(): number { let n = 0; for (const f of this.fighters.values()) if (!f.bot && !f.dummy) n++; return n; }
  botCount(): number { let n = 0; for (const f of this.fighters.values()) if (f.bot) n++; return n; }

  /** Keep the room topped up with bots (or thin them out as humans arrive). */
  balanceBots(): void {
    const humans = this.humans();
    const want = this.opts.bots ? Math.max(0, this.opts.population - humans) : 0;
    let have = this.botCount();
    while (have < want) {
      const used = new Set([...this.fighters.values()].map((f) => f.name));
      const free = BOT_NAMES.filter((n) => !used.has(n));
      const name = free.length ? this.rng.pick(free) : 'Einherjar ' + this.rng.int(2, 99);
      const f = this.addFighter(name, true, this.rng.int(0, ELEMENT_ORDER.length - 1));
      if (this.match.phase === 'live') f.brain!.deployIn = this.rng.range(0.5, 6);
      have++;
    }
    while (have > want) {
      // retire the bot that matters least right now
      let pick: Fighter | null = null;
      for (const f of this.fighters.values()) {
        if (!f.bot) continue;
        if (!pick || (f.s.hall ? 1 : 0) > (pick.s.hall ? 1 : 0) || ((f.s.hall === pick.s.hall) && f.kills < pick.kills)) pick = f;
      }
      if (!pick) break;
      this.removeFighter(pick.s.id);
      have--;
    }
  }

  pushInput(id: number, inp: Input): void {
    const f = this.fighters.get(id);
    if (!f || f.bot) return;
    if (inp.seq <= f.ack) return;
    if (f.queue.length > 30) f.queue.splice(0, f.queue.length - 30);
    f.queue.push(inp);
  }

  private note(f: Fighter, text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    if (f.bot || f.dummy) return;
    this.priv(f.s.id, { e: 'note', text, kind });
  }

  private priv(id: number, ev: GameEvent) {
    let arr = this.privateEvents.get(id);
    if (!arr) this.privateEvents.set(id, (arr = []));
    arr.push(ev);
  }

  private resetState(f: Fighter) {
    const s = f.s;
    const id = s.id, el = s.el, yaw = s.yaw, pb = s.pb;
    const cd = s.cd;
    Object.assign(s, createPlayerState(id));
    s.cd = cd; for (let i = 0; i < 5; i++) cd[i] = 0;
    s.el = el; s.yaw = yaw; s.pb = pb;
    f.burnAcc = 0; f.surgeHit = null; f.tpFrom = null; f.rayFrom = null; f.lastHitBy = 0;
  }

  private placeAt(f: Fighter, x: number, y: number, z: number, yaw: number) {
    const s = f.s;
    s.x = x; s.y = y; s.z = z; s.vx = s.vy = s.vz = 0; s.yaw = yaw; s.face = yaw; s.pitch = 0;
    s.hall = this.world.inHallZone(z);
    s.onGround = false;
    for (let i = 0; i < HIST; i++) { f.hist[i * 3] = x; f.hist[i * 3 + 1] = y; f.hist[i * 3 + 2] = z; }
  }

  spawnInHall(f: Fighter, announce = true): void {
    this.resetState(f);
    f.trial = -1;
    f.s.el = f.equipped;
    const sp = this.world.hallSpawns[this.rng.int(0, this.world.hallSpawns.length - 1)];
    this.placeAt(f, sp.x + this.rng.range(-0.4, 0.4), sp.y, sp.z + this.rng.range(-0.4, 0.4), sp.yaw);
    f.s.alive = true;
    f.respawnT = 0; f.wantHall = false;
    if (announce) this.events.push({ e: 'respawn', p: f.s.id, x: r2(f.s.x), y: r2(f.s.y), z: r2(f.s.z), hall: 1 });
    this.rosterDirty = true;
  }

  /** Choose the arena spawn farthest from danger. */
  private pickSpawn(): SpawnPoint {
    let best: SpawnPoint[] = [];
    const scored = this.world.spawns.map((sp) => {
      let near = 1e9;
      for (const o of this.fighters.values()) {
        if (!o.s.alive || o.s.hall || o.dummy) continue;
        const d = Math.hypot(o.s.x - sp.x, o.s.z - sp.z);
        if (d < near) near = d;
      }
      return { sp, near: Math.min(near, 45) + this.rng.next() * 6 };
    }).sort((a, b) => b.near - a.near);
    best = scored.slice(0, 3).map((s) => s.sp);
    return this.rng.pick(best);
  }

  private spawnInArena(f: Fighter, drop: boolean): void {
    const fromX = f.s.x, fromY = f.s.y, fromZ = f.s.z;
    this.resetState(f);
    f.trial = -1;
    f.s.el = f.equipped;
    const sp = this.pickSpawn();
    this.placeAt(f, sp.x, sp.y + (drop ? 14 : 0.1), sp.z, sp.yaw);
    f.s.alive = true;
    f.s.inv = SPAWN_INVULN + (drop ? 0.9 : 0);
    if (drop) f.s.vy = -12;
    f.respawnT = 0; f.wantHall = false;
    if (drop) this.events.push({ e: 'tp', p: f.s.id, k: 'deploy', x: r2(fromX), y: r2(fromY), z: r2(fromZ), x2: r2(sp.x), y2: r2(sp.y), z2: r2(sp.z) });
    else this.events.push({ e: 'respawn', p: f.s.id, x: r2(sp.x), y: r2(sp.y), z: r2(sp.z), hall: 0 });
    this.rosterDirty = true;
  }

  // ---- commands from players
  deploy(id: number): boolean {
    const f = this.fighters.get(id);
    if (!f || f.dummy || !f.s.alive || !f.s.hall) return false;
    if (this.match.phase !== 'live') {
      this.note(f, this.match.phase === 'results' ? 'The Skygate is sealed until the next match.' : `The Skygate opens in ${Math.ceil(this.match.timeLeft)}s.`);
      return false;
    }
    this.spawnInArena(f, true);
    return true;
  }

  toHall(id: number): boolean {
    const f = this.fighters.get(id);
    if (!f || f.dummy) return false;
    if (!f.s.alive) { f.wantHall = true; return true; }
    if (f.s.hall) return false;
    if (this.time - f.lastCombatT < 3.5) { this.note(f, 'You cannot leave in the middle of a fight.', 'bad'); return false; }
    this.spawnInHall(f);
    return true;
  }

  setEquipped(id: number, el: number): void {
    const f = this.fighters.get(id);
    if (!f) return;
    f.equipped = el;
    if (f.s.hall) { f.trial = -1; this.setElement(f, el); }
    this.rosterDirty = true;
  }

  setTrial(id: number, el: number): void {
    const f = this.fighters.get(id);
    if (!f || !f.s.hall) return;
    f.trial = el;
    this.setElement(f, el >= 0 ? el : f.equipped);
  }

  private setElement(f: Fighter, el: number) {
    if (f.s.el === el) return;
    f.s.el = el; f.s.act = -1; f.s.mv = MV_NONE;
    for (let i = 0; i < 5; i++) f.s.cd[i] = 0;
    for (const e of this.ents.values()) if (e.o === f.s.id && e.cls !== 'pickup') this.despawn(e, 0);
    this.rosterDirty = true;
  }

  chat(id: number, text: string): void {
    const f = this.fighters.get(id);
    if (!f) return;
    this.events.push({ e: 'chat', p: id, name: f.name, text, sys: 0 });
  }

  roster(): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (const f of this.fighters.values()) {
      out.push({ id: f.s.id, name: f.name, bot: f.bot, dummy: f.dummy, el: f.s.el, kills: f.kills, deaths: f.deaths, streak: f.streak, dmg: Math.round(f.dmg), hall: f.s.hall, ping: f.bot ? 0 : Math.round(f.ping) });
    }
    return out;
  }

  entityStates(): EntityState[] {
    const out: EntityState[] = [];
    for (const e of this.ents.values()) out.push(this.entState(e));
    return out;
  }

  // ============================================================================ tick

  step(): void {
    this.tick++;
    this.time += DT;
    this.stepMatch();

    for (const f of this.fighters.values()) {
      const s = f.s;
      if (f.dummy) { this.stepDummy(f); continue; }
      if (!s.alive) {
        // drain inputs so the client's ack keeps advancing while dead
        if (f.queue.length) { const last = f.queue[f.queue.length - 1]; f.ack = last.seq; f.input = last; f.queue.length = 0; s.yaw = last.yaw; s.pitch = last.pitch; }
        f.respawnT -= DT;
        if (f.respawnT <= 0) {
          if (f.wantHall || this.match.phase !== 'live') this.spawnInHall(f); else this.spawnInArena(f, false);
        }
        continue;
      }
      if (f.brain) f.brain.think(this, f);
      this.cur = f;
      if (f.bot) {
        stepPlayer(s, f.input, this.world, DT, this.hooks);
        this.afterStep(f);
      } else {
        // consume one input per tick; catch up when the queue backs up, coast when it is empty
        let n = f.queue.length > 4 ? 2 : 1;
        if (f.queue.length === 0) { n = 0; stepPlayer(s, f.input, this.world, DT, this.hooks); this.afterStep(f); }
        while (n-- > 0 && f.queue.length && s.alive) {
          const inp = f.queue.shift()!;
          f.input = inp; f.ack = inp.seq;
          stepPlayer(s, inp, this.world, DT, this.hooks);
          this.afterStep(f);
        }
      }
    }
    this.cur = null;

    this.stepEntities();
    this.separate();
    this.stepPickups();

    // drip-feed glory for damage so the counter ticks up as you fight
    if (this.tick % 30 === 0) {
      for (const f of this.fighters.values()) {
        if (f.gloryAcc >= 1) { const n = Math.floor(f.gloryAcc); f.gloryAcc -= n; this.award(f, n, 'hit'); }
      }
    }
  }

  private stepDummy(f: Fighter) {
    const s = f.s;
    const home = f.home!;
    if (!s.alive) {
      f.respawnT -= DT;
      if (f.respawnT <= 0) this.resetDummy(f);
      return;
    }
    this.cur = f;
    stepPlayer(s, NO_INPUT, this.world, DT, this.hooks);
    this.recordHist(f);
    this.burnTick(f);
    f.regenT += DT;
    const away = Math.hypot(s.x - home.x, s.z - home.z);
    if (s.y < HALL.baseY - 6 || (f.regenT > 2.5 && (away > 1.2 || s.hp < MAX_HP) && s.onGround && s.down <= 0)) this.resetDummy(f);
  }

  private resetDummy(f: Fighter) {
    const home = f.home!;
    const moved = Math.hypot(f.s.x - home.x, f.s.z - home.z) > 0.6 || !f.s.alive;
    this.resetState(f);
    this.placeAt(f, home.x, home.y, home.z, home.yaw);
    f.s.alive = true; f.s.onGround = true; f.regenT = 0;
    if (moved) this.events.push({ e: 'respawn', p: f.s.id, x: r2(home.x), y: r2(home.y), z: r2(home.z), hall: 1 });
  }

  private recordHist(f: Fighter) {
    const i = (this.tick % HIST) * 3;
    f.hist[i] = f.s.x; f.hist[i + 1] = f.s.y; f.hist[i + 2] = f.s.z;
  }

  /** Position of `target` as `viewer` saw it when they acted (lag compensation for instant hits). */
  private seenPos(target: Fighter, viewer: Fighter | null, out: Vec3): Vec3 {
    let back = 0;
    if (viewer && !viewer.bot && viewer !== target) back = clamp(Math.round((viewer.ping / 1000 + 0.07) * 60), 0, HIST - 2);
    if (back === 0) { out.x = target.s.x; out.y = target.s.y; out.z = target.s.z; return out; }
    const i = (((this.tick - back) % HIST) + HIST) % HIST * 3;
    out.x = target.hist[i]; out.y = target.hist[i + 1]; out.z = target.hist[i + 2];
    return out;
  }

  private burnTick(f: Fighter) {
    const s = f.s;
    if (s.burn > 0 && s.alive) {
      f.burnAcc += DT;
      if (f.burnAcc >= 0.5) {
        f.burnAcc -= 0.5;
        const src = this.fighters.get(f.burnSrc) || null;
        this.hit(f, src, { dmg: BURN_DPS * 0.5, kb: 0, lift: 0, stun: 0 }, 'burn', 0, 0, s.x, s.y + CHEST_HEIGHT, s.z);
      }
    } else f.burnAcc = 0;
  }

  private afterStep(f: Fighter) {
    const s = f.s;
    const wasHall = s.hall;
    s.hall = this.world.inHallZone(s.z);
    this.recordHist(f);

    if (f.tpFrom) {
      const a = f.tpFrom; f.tpFrom = null;
      this.events.push({ e: 'tp', p: s.id, k: 'thunderstep', x: r2(a.x), y: r2(a.y), z: r2(a.z), x2: r2(s.x), y2: r2(s.y), z2: r2(s.z) });
    }

    // the hall: walk through the Skygate or leap off the island to deploy
    if (s.hall) {
      const g = HALL.gate;
      const inGate = Math.abs(s.x - g.x) < g.halfWidth && Math.abs(s.z - g.z) < 0.9 && s.y < HALL.terrace.y + 4;
      if (s.y < HALL_DROP_Y || inGate) {
        if (this.match.phase === 'live') this.spawnInArena(f, true);
        else if (s.y < HALL_DROP_Y) this.spawnInHall(f);
        else {
          // sealed gate: nudge back
          s.z = g.z - 1.0; s.vz = -4;
          if (this.tick % 45 === 0) this.note(f, this.match.phase === 'results' ? 'The Skygate is sealed until the next match.' : `The Skygate opens in ${Math.ceil(this.match.timeLeft)}s.`);
        }
        return;
      }
    } else if (s.y < ARENA_KILL_Y) {
      const credit = this.time - f.lastHitT < KILL_CREDIT_WINDOW ? this.fighters.get(f.lastHitBy) || null : null;
      this.kill(f, credit, credit ? f.lastHitKey : 'fall', true);
      return;
    }
    if (wasHall !== s.hall) this.rosterDirty = true;

    this.burnTick(f);

    // trails laid by movement signatures
    if (s.mv === MV_DASH || s.mv === MV_GLIDE) {
      const ab = abilityOf(s, SLOT_MOVE);
      const trail = (ab.fx.t === 'dash' || ab.fx.t === 'glide') ? ab.fx.trail : undefined;
      const z = trail ? ZONES[trail] : undefined;
      if (trail && z && Math.hypot(s.x - f.trailX, s.z - f.trailZ) > z.radius * 1.15) {
        f.trailX = s.x; f.trailZ = s.z;
        const gy = this.world.ground(s.x, s.z, s.y + 0.5).y;
        if (gy > VOID && s.y - gy < 1.5) this.spawnZone(trail, f, s.x, gy, s.z, 0, 0, 0);
      }
    }
    // the surge bowls people over
    if (s.mv === MV_SURGE) {
      const ab = abilityOf(s, SLOT_MOVE);
      if (ab.fx.t === 'surge') {
        if (!f.surgeHit) f.surgeHit = new Set();
        for (const o of this.fighters.values()) {
          if (o === f || f.surgeHit.has(o.s.id) || !this.canHit(f, o)) continue;
          const dx = o.s.x - s.x, dz = o.s.z - s.z;
          if (dx * dx + dz * dz > (ab.fx.radius + PLAYER_RADIUS) ** 2 || Math.abs(o.s.y - s.y) > 2.4) continue;
          f.surgeHit.add(o.s.id);
          // shove them aside, perpendicular to the surge
          const side = (dx * s.mvZ - dz * s.mvX) > 0 ? 1 : -1;
          let kx = s.mvX * 0.6 + s.mvZ * side * 0.8, kz = s.mvZ * 0.6 - s.mvX * side * 0.8;
          const l = Math.hypot(kx, kz) || 1; kx /= l; kz /= l;
          this.hit(o, f, ab.fx.hit, ab.key, kx, kz, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z);
        }
      }
    } else if (f.surgeHit) f.surgeHit = null;
  }

  // ============================================================================ hit resolution

  /** May `src` affect `target` right now? */
  private canHit(src: Fighter | null, target: Fighter): boolean {
    const t = target.s;
    if (!t.alive || t.inv > 0) return false;
    if (t.hall && !target.dummy) return false;
    if (src && src.s.hall !== t.hall) return false;
    if (this.match.phase === 'results' && !target.dummy) return false;
    return true;
  }

  /**
   * Apply a hit. (dx, dz) is the horizontal knockback direction (unit), (px,py,pz) the impact point.
   * Returns false if the target could not be hit.
   */
  hit(target: Fighter, src: Fighter | null, spec: HitSpec, key: string, dx: number, dz: number, px: number, py: number, pz: number, opts?: { eid?: number; mul?: number; crit?: boolean; heavy?: boolean }): boolean {
    const t = target.s;
    if (src === target && spec.dmg > 0) return false;
    if (!this.canHit(src, target)) return false;
    let dmg = spec.dmg * (opts?.mul ?? 1);
    let crit = !!opts?.crit;
    let heavy = spec.heavy || !!opts?.heavy;
    // damage-over-time style ticks cause no reaction; neither do light hits against an armoured wind-up
    let dot = spec.stun === 0 && !heavy;
    if (!heavy && !dot && t.act >= 0 && spec.kb >= 0) {
      const cur = abilityOf(t, t.act);
      if (cur.armor && t.actT < cur.windup + cur.active) dot = true;
    }

    if (t.freeze > 0 && !dot && dmg > 0) {
      dmg *= FREEZE_SHATTER_MUL; crit = true; t.freeze = 0; t.freezeImm = 3;
      this.events.push({ e: 'pop', p: t.id, k: 'freeze', x: r2(t.x), y: r2(t.y), z: r2(t.z) });
    }
    if (t.bubble > 0 && !dot && dmg > 0) {
      dmg *= BUBBLE_POP_MUL; crit = true; t.bubble = 0;
      this.events.push({ e: 'pop', p: t.id, k: 'bubble', x: r2(t.x), y: r2(t.y), z: r2(t.z) });
    }

    dmg = Math.min(dmg, t.hp);
    t.hp -= dmg;
    if (src && src !== target) {
      target.lastHitBy = src.s.id; target.lastHitT = this.time; target.lastHitKey = key;
      if (!dot) { target.lastCombatT = this.time; src.lastCombatT = this.time; }
      if (!target.dummy) {
        src.dmg += dmg;
        if (!src.bot) {
          src.gloryAcc += dmg * GLORY_PER_DAMAGE;
          this.cb.onStat?.(src, 'damage', dmg);
          if (!dot) this.cb.onStat?.(src, 'hits', 1);
        }
      }
    }
    target.regenT = 0;

    // ---- statuses
    if (spec.status) for (const st of spec.status) {
      switch (st.k) {
        case 'burn': t.burn = Math.max(t.burn, st.t); target.burnSrc = src ? src.s.id : 0; break;
        case 'chill':
          if (t.freezeImm <= 0 && t.freeze <= 0) {
            t.chill += st.n ?? 1; t.chillT = st.t;
            if (t.chill >= CHILL_MAX) { t.chill = 0; t.chillT = 0; t.freeze = FREEZE_TIME; }
          }
          break;
        case 'freeze': if (t.freezeImm <= 0) { t.freeze = Math.max(t.freeze, st.t); t.chill = 0; } break;
        case 'shock': t.shock = Math.max(t.shock, st.t); break;
        case 'root': t.root = Math.max(t.root, st.t); break;
        case 'slow': t.slow = Math.max(t.slow, st.t); t.slowMul = st.n ?? 0.6; break;
        case 'bubble': t.bubble = st.t; t.launched = false; t.stun = 0; t.vx *= 0.2; t.vz *= 0.2; t.vy = 2; t.onGround = false; break;
      }
    }
    if (t.freeze > 0 || t.bubble > 0) { t.act = -1; t.mv = MV_NONE; }

    // ---- knockback & reaction
    const kbScale = (1 + KB_HP_SCALE * (1 - t.hp / MAX_HP)) * (ELEMENT_LIST[t.el]?.kbTaken ?? 1);
    let ky = 0;
    if (!dot && t.freeze <= 0 && t.bubble <= 0) {
      const kb = spec.kb * kbScale;
      if (kb !== 0 || spec.lift > 0) {
        t.vx = dx * kb; t.vz = dz * kb;
        if (spec.lift > 0) { t.vy = spec.lift * Math.sqrt(kbScale); t.onGround = false; t.coyote = 0; ky = t.vy; }
      }
      t.act = -1; t.mv = MV_NONE; t.buf = -1;
      if (heavy) { t.launched = true; t.stun = Math.max(t.stun, HEAVY_STUN + Math.min(0.25, dmg * 0.008)); t.down = 0; if (t.onGround) { t.onGround = false; t.y += 0.06; if (t.vy < 3) t.vy = 3; } }
      else t.stun = Math.max(t.stun, spec.stun ?? LIGHT_STUN);
      if (t.stealth > 0) { t.stealth = 0; t.haste = 0; t.hasteMul = 1; }
    } else if (dot && spec.kb !== 0 && spec.stun === 0) {
      t.vx += dx * spec.kb; t.vz += dz * spec.kb;
    }

    const killed = t.hp <= 0;
    const kl = Math.hypot(dx * spec.kb, ky, dz * spec.kb) || 1;
    this.events.push({
      e: 'hit', t: t.id, s: src ? src.s.id : 0, eid: opts?.eid ?? 0, k: key, el: src ? src.s.el : 0, dmg: Math.round(dmg * 10) / 10,
      x: r2(px), y: r2(py), z: r2(pz), dx: r2((dx * spec.kb) / kl), dy: r2(ky / kl), dz: r2((dz * spec.kb) / kl),
      heavy: heavy ? 1 : 0, crit: crit ? 1 : 0, kill: killed ? 1 : 0,
    });
    if (killed) this.kill(target, src && src !== target ? src : (this.time - target.lastHitT < KILL_CREDIT_WINDOW ? this.fighters.get(target.lastHitBy) || null : null), key, false);
    return true;
  }

  private award(f: Fighter, n: number, why: 'hit' | 'kill' | 'ringout' | 'place' | 'match') {
    if (f.bot || f.dummy || n <= 0) return;
    f.matchGlory += n;
    this.cb.onGlory?.(f, n, why);
    this.priv(f.s.id, { e: 'glory', n, why });
  }

  private announce(k: AnnounceKind, p = 0, n = 0) { this.events.push({ e: 'announce', k, p, n }); }

  private kill(f: Fighter, killer: Fighter | null, key: string, fall: boolean) {
    const s = f.s;
    if (!s.alive) return;
    s.alive = false; s.hp = 0; s.act = -1; s.mv = MV_NONE;
    for (const e of this.ents.values()) if (e.o === s.id && e.cls === 'channel') this.despawn(e, 0);
    this.events.push({ e: 'death', p: s.id, killer: killer ? killer.s.id : 0, k: key, fall: fall ? 1 : 0, x: r2(s.x), y: r2(s.y), z: r2(s.z) });
    if (f.dummy) { f.respawnT = 1.6; return; }
    f.respawnT = RESPAWN_TIME;
    f.deaths++;
    const hadStreak = f.streak;
    f.streak = 0;
    this.rosterDirty = true;
    if (!f.bot) { this.cb.onStat?.(f, 'deaths', 1); if (fall && !killer) this.cb.onStat?.(f, 'falls', 1); }
    if (this.match.phase !== 'live') return;
    if (killer && killer !== f && !killer.dummy) {
      killer.kills++; killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      killer.multi = this.time - killer.lastKillT < 4.5 ? killer.multi + 1 : 1;
      killer.lastKillT = this.time;
      this.award(killer, GLORY_PER_KILL, 'kill');
      if (fall) this.award(killer, GLORY_RINGOUT_BONUS, 'ringout');
      if (!killer.bot) {
        this.cb.onStat?.(killer, 'kills', 1);
        if (fall) this.cb.onStat?.(killer, 'ringouts', 1);
        this.cb.onStat?.(killer, 'streak', killer.streak);
      }
      const kid = killer.s.id;
      if (!this.firstBlood) { this.firstBlood = true; this.announce('firstblood', kid); }
      else if (killer.multi === 2) this.announce('double', kid);
      else if (killer.multi === 3) this.announce('triple', kid);
      else if (killer.multi >= 4) this.announce('rampage', kid, killer.multi);
      else if (hadStreak >= 4) this.announce('shutdown', kid, hadStreak);
      else if (killer.streak === 5 || killer.streak === 8 || killer.streak === 12) this.announce('unstoppable', kid, killer.streak);
      else if (fall) this.announce('ringout', kid);
      // lead changes
      let lead: Fighter | null = null;
      for (const o of this.fighters.values()) if (!o.dummy && (!lead || o.kills > lead.kills)) lead = o;
      if (lead && lead === killer && this.leaderId !== kid && killer.kills >= 3) {
        let tied = false;
        for (const o of this.fighters.values()) if (!o.dummy && o !== killer && o.kills === killer.kills) tied = true;
        if (!tied) { this.leaderId = kid; this.announce('lead', kid); }
      }
      if (killer.kills >= this.match.killTarget) this.endMatch();
    }
  }

  // ============================================================================ actions

  private onStart(f: Fighter, slot: number, ab: AbilityDef) {
    const s = f.s;
    f.ambush = s.stealth > 0;
    f.lastCombatT = Math.max(f.lastCombatT, s.hall ? f.lastCombatT : this.time - 2);
    if (ab.fx.t === 'beam' && ab.anim === 'charge') {
      // the charging tell everyone can see
      const d = dirFromYawPitch(s.yaw, s.pitch);
      this.spawn(ab.fx.ent, 'channel', f, ab, s.x, s.y + CHEST_HEIGHT, s.z, d.x, d.y, d.z, s.yaw, 0, ab.windup, 0, ab.fx.range, ab.fx.width);
    }
  }

  private muzzle(s: PlayerState, yaw: number, out: Vec3): Vec3 {
    out.x = s.x - Math.sin(yaw) * 0.7; out.y = s.y + CHEST_HEIGHT + 0.15; out.z = s.z - Math.cos(yaw) * 0.7;
    return out;
  }

  /** Ground point the fighter is aiming at, clamped to `range` (for strikes, traps, zones). */
  private groundTarget(f: Fighter, range: number, out: Vec3): Vec3 {
    const s = f.s;
    aimPoint(this.world, s.x, s.y, s.z, s.actYaw, s.actPitch, range + 6, f.bot, out);
    let dx = out.x - s.x, dz = out.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d > range) { dx *= range / d; dz *= range / d; }
    out.x = s.x + dx; out.z = s.z + dz;
    const top = this.world.ground(out.x, out.z, Math.max(out.y, s.y) + 3).y;
    out.y = top > VOID ? top : s.y;
    return out;
  }

  private onRelease(f: Fighter, slot: number, ab: AbilityDef, n: number) {
    const s = f.s;
    const fx = ab.fx;
    const yaw = s.actYaw, pitch = s.actPitch;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    switch (fx.t) {
      case 'melee': this.doMelee(f, ab, fx); break;
      case 'proj': {
        const m = this.muzzle(s, yaw, tmpA);
        const aim = aimPoint(this.world, s.x, s.y, s.z, yaw, pitch, 70, f.bot, tmpB);
        const d = shotDirection(m.x, m.y, m.z, aim, yaw, pitch, { x: 0, y: 0, z: 0 });
        const count = fx.count ?? 1;
        for (let i = 0; i < count; i++) {
          let dx = d.x, dy = d.y, dz = d.z;
          if (count > 1 && fx.spread) {
            const a = ((i - (count - 1) / 2) * fx.spread * Math.PI) / 180;
            const cs = Math.cos(a), sn = Math.sin(a);
            const nx = dx * cs - dz * sn, nz = dx * sn + dz * cs;
            dx = nx; dz = nz;
          }
          const g = fx.gravity ?? 0;
          // arcing shots get a little loft so "aim at them" works at mid range
          const loft = g > 0 ? 0.11 : 0;
          const e = this.spawn(fx.ent, fx.special === 'orb' ? 'orb' : 'proj', f, ab, m.x, m.y, m.z, dx * fx.speed, (dy + loft) * fx.speed, dz * fx.speed, Math.atan2(-dx, -dz), fx.radius, fx.life, g, 0, 0);
          if (fx.special === 'orb') { e.zone = ZONES[fx.ent] || null; e.tickT = 0.25; }
          if (fx.pierce) e.hitIds = new Set();
        }
        break;
      }
      case 'beam': this.doBeam(f, ab, fx); break;
      case 'channel': {
        this.spawn(fx.ent, 'channel', f, ab, s.x, s.y + CHEST_HEIGHT, s.z, fwdX, 0, fwdZ, yaw, 0, ab.active, 0, fx.range, fx.width);
        break;
      }
      case 'cone': {
        const cosHalf = Math.cos((fx.arc * Math.PI) / 360);
        const d = dirFromYawPitch(yaw, clamp(pitch, -0.5, 0.5));
        for (const o of this.fighters.values()) {
          if (o === f || !this.canHit(f, o)) continue;
          const tp = this.seenPos(o, f, tmpA);
          const dx = tp.x - s.x, dy = tp.y - s.y, dz = tp.z - s.z;
          const dist = Math.hypot(dx, dz);
          if (dist > fx.range + PLAYER_RADIUS || Math.abs(dy) > 3) continue;
          if (dist > 0.6 && (dx * fwdX + dz * fwdZ) / dist < cosHalf) continue;
          if (!this.los(s, o.s)) continue;
          const l = dist || 1;
          this.hit(o, f, fx.hit, ab.key, dist > 0.3 ? dx / l : fwdX, dist > 0.3 ? dz / l : fwdZ, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z);
        }
        this.fxEvent(fx.ent, f, s.x, s.y + CHEST_HEIGHT, s.z, s.x + d.x * fx.range, s.y + CHEST_HEIGHT + d.y * fx.range, s.z + d.z * fx.range, fx.range);
        break;
      }
      case 'burst': {
        this.burst(f, fx.ent, ab.key, s.x, s.y, s.z, fx.radius, fx.hit, !!fx.groundedOnly, null);
        break;
      }
      case 'strike': {
        const p = this.groundTarget(f, fx.range, tmpA);
        this.spawn(fx.ent, 'strike', f, ab, p.x, p.y, p.z, 0, 0, 0, yaw, fx.radius, fx.delay + 0.05, 0, fx.delay, 0);
        break;
      }
      case 'line': {
        const e = this.spawn(fx.ent, 'line', f, ab, s.x + fwdX * 1.0, s.y, s.z + fwdZ * 1.0, fwdX * fx.speed, 0, fwdZ * fx.speed, yaw, fx.width / 2, fx.length / fx.speed + 0.7, 0, fx.length, fx.speed);
        e.hitIds = new Set();
        break;
      }
      case 'trap': {
        const mine: Ent[] = [];
        for (const e of this.ents.values()) if (e.k === fx.ent && e.o === s.id) mine.push(e);
        while (mine.length >= fx.max) this.despawn(mine.shift()!, 0);
        const p = this.groundTarget(f, fx.range, tmpA);
        this.spawn(fx.ent, 'trap', f, ab, p.x, p.y, p.z, 0, 0, 0, yaw, fx.trigger, fx.life, 0, fx.arm, 0);
        break;
      }
      case 'zone': {
        const z = ZONES[fx.ent]!;
        if (z.speed) {
          const gx = s.x + fwdX * fx.range, gz = s.z + fwdZ * fx.range;
          const gy = this.world.ground(gx, gz, s.y + 2).y;
          this.spawnZone(fx.ent, f, gx, gy > VOID ? gy : s.y, gz, fwdX * z.speed, fwdZ * z.speed, yaw, ab);
        } else {
          const p = this.groundTarget(f, fx.range, tmpA);
          this.spawnZone(fx.ent, f, p.x, p.y, p.z, 0, 0, yaw, ab);
        }
        break;
      }
      case 'wall': this.doWall(f, ab, fx); break;
      case 'wave': {
        const gx = s.x + fwdX * 1.6, gz = s.z + fwdZ * 1.6;
        const e = this.spawn(fx.ent, 'wave', f, ab, gx, s.y, gz, fwdX * fx.speed, 0, fwdZ * fx.speed, -yaw, 1.3, fx.range / fx.speed, 0, fx.width, fx.height);
        e.hitIds = new Set(); e.entered = new Set();
        break;
      }
      case 'blink': {
        f.tpFrom = { x: s.x, y: s.y, z: s.z };
        this.burst(f, fx.burst.ent, ab.key, s.x, s.y, s.z, fx.burst.radius, fx.burst.hit, false, null);
        break;
      }
      case 'ray': f.rayFrom = { x: s.x, y: s.y, z: s.z }; break;
      case 'dash': case 'glide': f.trailX = s.x + 99; f.trailZ = s.z; break;
      default: break;
    }
  }

  private onMoveEnd(f: Fighter, mode: number, landed: boolean) {
    const s = f.s;
    const ab = abilityOf(s, SLOT_MOVE);
    if (mode === MV_LEAP && landed && ab.fx.t === 'leap') {
      this.burst(f, ab.fx.land.ent, ab.key, s.x, s.y, s.z, ab.fx.land.radius, ab.fx.land.hit, false, null);
    } else if (mode === MV_RAY && ab.fx.t === 'ray') {
      const a = f.rayFrom || { x: s.x, y: s.y, z: s.z };
      f.rayFrom = null;
      this.burst(f, ab.fx.burst.ent, ab.key, s.x, s.y, s.z, ab.fx.burst.radius, ab.fx.burst.hit, false, a);
    }
  }

  private los(a: PlayerState, b: PlayerState): boolean {
    tmpA.x = a.x; tmpA.y = a.y + CHEST_HEIGHT; tmpA.z = a.z;
    tmpB.x = b.x; tmpB.y = b.y + CHEST_HEIGHT; tmpB.z = b.z;
    return this.world.los(tmpA, tmpB);
  }

  private fxEvent(k: EntityKind | 'melee', f: Fighter | null, x: number, y: number, z: number, x2: number, y2: number, z2: number, r: number) {
    this.events.push({ e: 'fx', k, o: f ? f.s.id : 0, el: f ? f.s.el : 0, x: r2(x), y: r2(y), z: r2(z), x2: r2(x2), y2: r2(y2), z2: r2(z2), r: r2(r) });
  }

  /** Radial hit around a point. `from` (optional) is the start point for streak effects (ray dash). */
  private burst(f: Fighter | null, ent: EntityKind, key: string, x: number, y: number, z: number, radius: number, spec: HitSpec, groundedOnly: boolean, from: Vec3 | null, skip?: Fighter | null, eid = 0) {
    for (const o of this.fighters.values()) {
      if (o === f || o === skip || !this.canHit(f, o)) continue;
      if (f === null && o.s.hall) continue;
      const dx = o.s.x - x, dz = o.s.z - z;
      const d = Math.hypot(dx, dz);
      if (d > radius + PLAYER_RADIUS) continue;
      const dy = o.s.y - y;
      if (dy > radius * 0.8 + 1 || dy < -2.6) continue;
      if (groundedOnly && !o.s.onGround) continue;
      const l = d || 1;
      this.hit(o, f, spec, key, d > 0.2 ? dx / l : 1, d > 0.2 ? dz / l : 0, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { eid });
    }
    if (from) this.fxEvent(ent, f, from.x, from.y + CHEST_HEIGHT, from.z, x, y + CHEST_HEIGHT, z, radius);
    else this.fxEvent(ent, f, x, y, z, x, y, z, radius);
  }

  private doMelee(f: Fighter, ab: AbilityDef, fx: Extract<Effect, { t: 'melee' }>) {
    const s = f.s;
    const yaw = s.actYaw;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const cosHalf = Math.cos((fx.arc * Math.PI) / 360);
    for (const o of this.fighters.values()) {
      if (o === f || !this.canHit(f, o)) continue;
      const tp = this.seenPos(o, f, tmpA);
      const dx = tp.x - s.x, dy = tp.y - s.y, dz = tp.z - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > fx.range + PLAYER_RADIUS || dy > 2.3 || dy < -2.0) continue;
      // generous up close so point-blank swings never whiff through someone
      if (dist > 1.0 && (dx * fwdX + dz * fwdZ) / dist < cosHalf) continue;
      if (!this.los(s, o.s)) continue;
      let kx = fwdX, kz = fwdZ;
      if (dist > 0.4) { kx = fwdX * 0.5 + (dx / dist) * 0.5; kz = fwdZ * 0.5 + (dz / dist) * 0.5; const l = Math.hypot(kx, kz) || 1; kx /= l; kz /= l; }
      let mul = 1, crit = false, heavy = false;
      if (fx.backstab) {
        const tfx = -Math.sin(o.s.face), tfz = -Math.cos(o.s.face);
        if (f.ambush || tfx * kx + tfz * kz > 0.35) { mul = fx.backstab; crit = true; heavy = true; }
      }
      if (fx.pull && dist > 0.2) { kx = dx / dist; kz = dz / dist; }
      this.hit(o, f, fx.hit, ab.key, kx, kz, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { mul, crit, heavy });
    }
    f.ambush = false;
    // Stone: a hammer blow shatters your own rampart into a hail of rock
    if (ab.key === 'stone_melee') {
      for (const e of this.ents.values()) {
        if (e.k !== 'rampart' || e.o !== s.id || e.dead) continue;
        const dx = e.x - s.x, dz = e.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > fx.range + e.p * 0.5 || (d > 1 && (dx * fwdX + dz * fwdZ) / d < 0.3)) continue;
        // nearest point on the wall must be in reach
        const along = clamp(-(dx * Math.cos(e.yaw) + dz * Math.sin(e.yaw)), -e.p / 2, e.p / 2);
        const nx = e.x + Math.cos(e.yaw) * along - s.x, nz = e.z + Math.sin(e.yaw) * along - s.z;
        if (Math.hypot(nx, nz) > fx.range + 1.0) continue;
        this.despawn(e, 4);
        const shard: HitSpec = { dmg: 11, kb: 10, lift: 5, heavy: true };
        for (let i = 0; i < 6; i++) {
          const a = ((i - 2.5) * 11 * Math.PI) / 180;
          const cs = Math.cos(a), sn = Math.sin(a);
          const ddx = fwdX * cs - fwdZ * sn, ddz = fwdX * sn + fwdZ * cs;
          const off = (i - 2.5) * (e.p / 7);
          const sx = e.x + Math.cos(e.yaw) * off + fwdX * 1.0, sz = e.z + Math.sin(e.yaw) * off + fwdZ * 1.0;
          const sh = this.spawn('rockshard', 'proj', f, ab, sx, e.y + 1.0 + (i % 3) * 0.7, sz, ddx * 30, 4 + (i % 2) * 2, ddz * 30, Math.atan2(-ddx, -ddz), 0.5, 1.4, 14, 0, 0);
          (sh as any).spec = shard;
        }
      }
    }
  }

  private doBeam(f: Fighter, ab: AbilityDef, fx: Extract<Effect, { t: 'beam' }>) {
    const s = f.s;
    const yaw = s.actYaw, pitch = s.actPitch;
    const ox = s.x - Math.sin(yaw) * 0.5, oy = s.y + CHEST_HEIGHT + 0.2, oz = s.z - Math.cos(yaw) * 0.5;
    const aim = aimPoint(this.world, s.x, s.y, s.z, yaw, pitch, fx.range + 6, f.bot, tmpB);
    const d = shotDirection(ox, oy, oz, aim, yaw, pitch, { x: 0, y: 0, z: 0 });
    const wall = this.world.raycast(ox, oy, oz, d.x, d.y, d.z, fx.range, 0.1);
    let maxT = wall ? wall.t : fx.range;
    const cands: { o: Fighter; t: number }[] = [];
    for (const o of this.fighters.values()) {
      if (o === f || !this.canHit(f, o)) continue;
      const tp = this.seenPos(o, f, tmpA);
      // closest approach of the ray to the fighter's body axis (sampled at three heights)
      let bestT = -1, bestD = 1e9;
      for (const h of [0.35, 1.0, 1.6]) {
        const px = tp.x - ox, py = tp.y + h - oy, pz = tp.z - oz;
        const t = clamp(px * d.x + py * d.y + pz * d.z, 0, maxT);
        const dd = Math.hypot(px - d.x * t, py - d.y * t, pz - d.z * t);
        if (dd < bestD) { bestD = dd; bestT = t; }
      }
      if (bestD <= fx.width / 2 + PLAYER_RADIUS && bestT > 0) cands.push({ o, t: bestT });
    }
    cands.sort((a, b) => a.t - b.t);
    const hitList = fx.pierce ? cands : cands.slice(0, 1);
    if (!fx.pierce && hitList.length) maxT = hitList[0].t;
    const ex = ox + d.x * maxT, ey = oy + d.y * maxT, ez = oz + d.z * maxT;
    const hl = Math.hypot(d.x, d.z) || 1;

    // Storm: striking your own ball lightning overloads it
    if (ab.key === 'arcbolt') {
      for (const e of this.ents.values()) {
        if (e.k !== 'balllightning' || e.o !== s.id || e.dead) continue;
        const px = e.x - ox, py = e.y - oy, pz = e.z - oz;
        const t = clamp(px * d.x + py * d.y + pz * d.z, 0, maxT);
        if (Math.hypot(px - d.x * t, py - d.y * t, pz - d.z * t) < 1.3) {
          const ov = e.zone?.overload;
          this.despawn(e, 4);
          if (ov) this.burst(f, 'balllightning', 'balllightning', e.x, e.y - 1, e.z, ov.r, ov.hit, false, null);
        }
      }
    }
    this.fxEvent(fx.ent, f, ox, oy, oz, ex, ey, ez, fx.width);
    for (const c of hitList) {
      const o = c.o;
      this.hit(o, f, fx.hit, ab.key, d.x / hl, d.z / hl, ox + d.x * c.t, oy + d.y * c.t, oz + d.z * c.t);
      if (fx.chain) {
        let best: Fighter | null = null, bd = fx.chain.range;
        for (const q of this.fighters.values()) {
          if (q === f || q === o || !this.canHit(f, q)) continue;
          const dd = Math.hypot(q.s.x - o.s.x, q.s.y - o.s.y, q.s.z - o.s.z);
          if (dd < bd && this.los(o.s, q.s)) { bd = dd; best = q; }
        }
        if (best) {
          const cx = best.s.x - o.s.x, cz = best.s.z - o.s.z, cl = Math.hypot(cx, cz) || 1;
          this.fxEvent(fx.ent, f, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, best.s.x, best.s.y + CHEST_HEIGHT, best.s.z, fx.width);
          this.hit(best, f, fx.hit, ab.key, cx / cl, cz / cl, best.s.x, best.s.y + CHEST_HEIGHT, best.s.z, { mul: fx.chain.mul });
        }
      }
    }
  }

  private doWall(f: Fighter, ab: AbilityDef, fx: Extract<Effect, { t: 'wall' }>) {
    const s = f.s;
    const yaw = s.actYaw;
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    let cx = 0, cz = 0, gy = VOID;
    for (const dist of [fx.dist, fx.dist * 0.75, fx.dist * 0.5]) {
      cx = s.x + fwdX * dist; cz = s.z + fwdZ * dist;
      gy = this.world.ground(cx, cz, s.y + 2.5).y;
      if (gy > VOID && Math.abs(gy - s.y) < 4) break;
      gy = VOID;
    }
    if (gy <= VOID) { s.cd[2] = Math.min(s.cd[2], 1.5); this.note(f, 'No ground there to raise.', 'bad'); return; }
    const cyaw = -yaw; // collider local x runs across the caster's view
    const e = this.spawn(fx.ent, 'wall', f, ab, cx, gy, cz, 0, 0, 0, cyaw, fx.thick / 2, fx.life, 0, fx.width, fx.height);
    e.col = this.world.makeDynamicBox('rampart', 100000 + e.id, cx, cz, fx.width / 2, fx.thick / 2, cyaw, gy - 1.5, gy + fx.height);
    this.world.dyn = [...this.world.dyn, e.col];
    // anyone standing where the rock comes up goes with it
    for (const o of this.fighters.values()) {
      if (!o.s.alive) continue;
      if (!colliderContains(e.col, o.s.x, o.s.z, PLAYER_RADIUS * 0.8) || o.s.y > gy + fx.height || o.s.y < gy - 1.5) continue;
      if (o !== f && this.canHit(f, o)) {
        this.hit(o, f, fx.hit, ab.key, fwdX, fwdZ, o.s.x, o.s.y + 0.3, o.s.z);
      } else {
        // friends of the wall (its owner, bystanders in the hall) are simply lifted on top
        o.s.y = gy + fx.height + 0.05; o.s.vy = 0;
      }
    }
  }

  // ============================================================================ entities

  private entState(e: Ent): EntityState {
    return { id: e.id, k: e.k, o: e.o, el: e.el, x: r2(e.x), y: r2(e.y), z: r2(e.z), vx: r3(e.vx), vy: r3(e.vy), vz: r3(e.vz), yaw: r3(e.yaw), r: e.r, life: r2(e.life), age: r2(e.age), g: e.g, p: e.p, q: e.q };
  }

  private spawn(k: EntityKind, cls: EntClass, f: Fighter | null, ab: AbilityDef | null, x: number, y: number, z: number, vx: number, vy: number, vz: number, yaw: number, r: number, life: number, g: number, p: number, q: number): Ent {
    const e: Ent = {
      id: this.nextEntId++, k, o: f ? f.s.id : 0, el: f ? f.s.el : 0, x, y, z, vx, vy, vz, yaw, r, life, age: 0, g, p, q,
      cls, ab, hitIds: null, tickT: 0, zone: null, entered: null, col: null, n: 0, dead: false,
    };
    this.ents.set(e.id, e);
    this.events.push({ e: 'spawn', ...this.entState(e) });
    return e;
  }

  private spawnZone(k: EntityKind, f: Fighter, x: number, y: number, z: number, vx: number, vz: number, yaw: number, ab: AbilityDef | null = null): Ent {
    const zd = ZONES[k]!;
    const e = this.spawn(k, 'zone', f, ab, x, y, z, vx, 0, vz, yaw, zd.radius, zd.life, 0, zd.arm ?? 0, 0);
    e.zone = zd; e.tickT = zd.arm ?? 0.05;
    if (zd.rootOnEnter) e.entered = new Set();
    return e;
  }

  private despawn(e: Ent, why: DespawnWhy) {
    if (e.dead) return;
    e.dead = true;
    this.ents.delete(e.id);
    if (e.col) { const col = e.col; this.world.dyn = this.world.dyn.filter((c) => c !== col); e.col = null; }
    if (e.cls === 'pickup') this.pickupActive.delete(e.n);
    this.events.push({ e: 'despawn', id: e.id, x: r2(e.x), y: r2(e.y), z: r2(e.z), why });
  }

  private stepEntities() {
    for (const e of this.ents.values()) {
      if (e.dead) continue;
      e.age += DT;
      const owner = e.o ? this.fighters.get(e.o) || null : null;
      if (e.o && !owner && e.cls !== 'zone' && e.cls !== 'wall') { this.despawn(e, 0); continue; }
      switch (e.cls) {
        case 'proj': case 'orb': this.stepProjectile(e, owner); break;
        case 'zone': this.stepZone(e, owner); break;
        case 'strike': this.stepStrike(e, owner); break;
        case 'trap': this.stepTrap(e, owner); break;
        case 'line': this.stepLine(e, owner); break;
        case 'wave': this.stepWave(e, owner); break;
        case 'channel': this.stepChannel(e, owner); break;
        case 'wall': case 'pickup': if (e.age >= e.life) this.despawn(e, 0); break;
      }
    }
  }

  private stepProjectile(e: Ent, owner: Fighter | null) {
    const fx = e.ab?.fx.t === 'proj' ? e.ab.fx : null;
    const spec: HitSpec = (e as any).spec || fx?.hit || { dmg: 5, kb: 4, lift: 2 };
    e.vy -= e.g * DT;
    const speed = Math.hypot(e.vx, e.vy, e.vz);
    const steps = Math.max(1, Math.ceil((speed * DT) / 0.45));
    const sdt = DT / steps;
    const hl = Math.hypot(e.vx, e.vz) || 1;
    for (let i = 0; i < steps; i++) {
      e.x += e.vx * sdt; e.y += e.vy * sdt; e.z += e.vz * sdt;
      // fighters
      for (const o of this.fighters.values()) {
        if (o === owner || !this.canHit(owner, o)) continue;
        if (e.hitIds && e.hitIds.has(o.s.id)) continue;
        const dx = o.s.x - e.x, dz = o.s.z - e.z;
        const rr = e.r + PLAYER_RADIUS;
        if (dx * dx + dz * dz > rr * rr) continue;
        const cy = clamp(e.y, o.s.y + 0.2, o.s.y + PLAYER_HEIGHT - 0.2);
        if (Math.abs(e.y - cy) > e.r) continue;
        if (e.cls === 'orb') { this.detonate(e, owner, 3); return; }
        let mul = 1, crit = false;
        if (fx?.farBonus && owner) {
          const travelled = speed * e.age;
          if (travelled >= fx.farBonus.dist) { mul = fx.farBonus.mul; crit = true; }
        }
        const ok = this.hit(o, owner, spec, e.ab?.key || e.k, e.vx / hl, e.vz / hl, e.x, e.y, e.z, { eid: e.id, mul, crit });
        if (ok && fx?.special === 'swap' && owner && owner.s.alive && o.s.alive) this.swapBehind(owner, o);
        if (e.hitIds) { e.hitIds.add(o.s.id); continue; }
        this.explode(e, owner, fx, o);
        this.despawn(e, 2);
        return;
      }
      // world
      if (this.world.solidAt(e.x, e.y, e.z, e.r * 0.45)) {
        e.x -= e.vx * sdt * 0.5; e.y -= e.vy * sdt * 0.5; e.z -= e.vz * sdt * 0.5;
        if (e.cls === 'orb') { this.detonate(e, owner, 3); return; }
        this.explode(e, owner, fx, null);
        if (fx?.leave) { const gy = this.world.ground(e.x, e.z, e.y + 1).y; if (gy > VOID && owner) this.spawnZone(fx.leave, owner, e.x, gy, e.z, 0, 0, 0); }
        this.despawn(e, 1);
        return;
      }
    }
    if (e.y < ARENA_KILL_Y - 20) { this.despawn(e, 0); return; }
    if (e.cls === 'orb' && e.zone) {
      e.tickT -= DT;
      if (e.tickT <= 0) {
        e.tickT += e.zone.tick;
        for (const o of this.fighters.values()) {
          if (o === owner || !this.canHit(owner, o)) continue;
          const d = Math.hypot(o.s.x - e.x, o.s.y + CHEST_HEIGHT - e.y, o.s.z - e.z);
          if (d > e.zone.radius) continue;
          tmpA.x = e.x; tmpA.y = e.y; tmpA.z = e.z; tmpB.x = o.s.x; tmpB.y = o.s.y + CHEST_HEIGHT; tmpB.z = o.s.z;
          if (!this.world.los(tmpA, tmpB)) continue;
          this.hit(o, owner, e.zone.hit!, e.k, 0, 0, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { eid: e.id });
        }
      }
    }
    if (e.age >= e.life) {
      if (e.cls === 'orb') this.detonate(e, owner, 3);
      else this.despawn(e, 0);
    }
  }

  private detonate(e: Ent, owner: Fighter | null, why: DespawnWhy) {
    const det = e.zone?.detonate;
    this.despawn(e, why);
    if (det) this.burst(owner, e.k, e.k, e.x, e.y - 1, e.z, det.r, det.hit, false, null, null, e.id);
  }

  private explode(e: Ent, owner: Fighter | null, fx: Extract<Effect, { t: 'proj' }> | null, direct: Fighter | null) {
    if (!fx?.explode) return;
    const ex = fx.explode;
    for (const o of this.fighters.values()) {
      if (o === owner || o === direct || !this.canHit(owner, o)) continue;
      const dx = o.s.x - e.x, dz = o.s.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > ex.r + PLAYER_RADIUS || Math.abs(o.s.y + 0.9 - e.y) > ex.r + 0.9) continue;
      const l = d || 1;
      this.hit(o, owner, ex.hit, e.ab?.key || e.k, dx / l, dz / l, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { eid: e.id });
    }
  }

  /** Umbra's Dusk Step: appear behind the victim. */
  private swapBehind(f: Fighter, victim: Fighter) {
    const s = f.s, v = victim.s;
    const face = v.face;
    const from = { x: s.x, y: s.y, z: s.z };
    let placed = false;
    // try directly behind, then closer, then beside
    for (const [back, side] of [[1.5, 0], [1.1, 0], [1.2, 0.9], [1.2, -0.9], [0.8, 0]] as [number, number][]) {
      const x = v.x + Math.sin(face) * back + Math.cos(face) * side;
      const z = v.z + Math.cos(face) * back - Math.sin(face) * side;
      const g = this.world.ground(x, z, v.y + 1.0);
      if (g.y <= VOID || Math.abs(g.y - v.y) > 2.2) continue;
      const probe = { x, z };
      this.world.resolveCircle(probe, PLAYER_RADIUS, g.y, g.y + PLAYER_HEIGHT);
      if (Math.hypot(probe.x - x, probe.z - z) > 0.6) continue;
      s.x = probe.x; s.z = probe.z; s.y = Math.max(g.y, v.onGround ? g.y : v.y);
      placed = true;
      break;
    }
    if (!placed) return;
    s.vx = s.vy = s.vz = 0; s.mv = MV_NONE; s.onGround = false;
    const yaw = Math.atan2(-(v.x - s.x), -(v.z - s.z));
    s.face = yaw;
    f.ambush = true;
    this.events.push({ e: 'tp', p: s.id, k: 'duskstep', x: r2(from.x), y: r2(from.y), z: r2(from.z), x2: r2(s.x), y2: r2(s.y), z2: r2(s.z) });
  }

  private stepZone(e: Ent, owner: Fighter | null) {
    const z = e.zone!;
    if (z.speed) {
      const nx = e.x + e.vx * DT, nz = e.z + e.vz * DT;
      const gy = this.world.ground(nx, nz, e.y + 1.2).y;
      // roaming zones slide along walls rather than stopping dead
      if (gy > VOID && gy - e.y > 1.2) { e.vx = -e.vx * 0.6; e.vz = -e.vz * 0.6; }
      else { e.x = nx; e.z = nz; if (gy > VOID) e.y += clamp(gy - e.y, -4 * DT, 6 * DT); }
    }
    const armed = e.age >= (z.arm ?? 0);
    if (armed) {
      const tall = e.k === 'cyclone' ? 7 : 2.6;
      if (z.pull && z.pullRadius) {
        for (const o of this.fighters.values()) {
          if (o === owner || !this.canHit(owner, o) || o.s.down > 0) continue;
          const dx = e.x - o.s.x, dz = e.z - o.s.z;
          const d = Math.hypot(dx, dz);
          if (d > z.pullRadius || d < 0.3 || Math.abs(o.s.y - e.y) > tall) continue;
          const a = z.pull * (1 - (d / z.pullRadius) * 0.5) * DT;
          o.s.vx += (dx / d) * a; o.s.vz += (dz / d) * a;
        }
      }
      for (const o of this.fighters.values()) {
        if (o === owner || !this.canHit(owner, o)) continue;
        const dx = o.s.x - e.x, dz = o.s.z - e.z;
        const inside = dx * dx + dz * dz <= (e.r + PLAYER_RADIUS * 0.5) ** 2 && o.s.y - e.y < tall && o.s.y - e.y > -1.5;
        if (!inside) continue;
        if (z.slow) { o.s.slow = Math.max(o.s.slow, 0.25); o.s.slowMul = z.slow; }
        if (e.entered && !e.entered.has(o.s.id)) {
          e.entered.add(o.s.id);
          if (z.rootOnEnter) this.hit(o, owner, { dmg: 0, kb: 0, lift: 0, stun: 0, status: [{ k: 'root', t: z.rootOnEnter }] }, e.k, 0, 0, o.s.x, o.s.y + 0.4, o.s.z, { eid: e.id });
        }
      }
      e.tickT -= DT;
      if (e.tickT <= 0 && z.hit) {
        e.tickT += z.tick;
        for (const o of this.fighters.values()) {
          if (o === owner || !this.canHit(owner, o)) continue;
          const dx = o.s.x - e.x, dz = o.s.z - e.z;
          if (dx * dx + dz * dz > (e.r + PLAYER_RADIUS * 0.5) ** 2 || o.s.y - e.y > tall || o.s.y - e.y < -1.5) continue;
          if (z.hit.heavy && (o.s.launched || o.s.down > 0)) continue; // already airborne from it
          const d = Math.hypot(dx, dz) || 1;
          // the cyclone flings outward along its travel direction
          let kx = dx / d, kz = dz / d;
          if (z.speed) { const vl = Math.hypot(e.vx, e.vz) || 1; kx = e.vx / vl; kz = e.vz / vl; }
          this.hit(o, owner, z.hit, e.k, kx, kz, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { eid: e.id });
        }
      }
    }
    if (e.age >= e.life) this.despawn(e, 0);
  }

  private stepStrike(e: Ent, owner: Fighter | null) {
    if (e.age < e.p) return;
    const fx = e.ab?.fx.t === 'strike' ? e.ab.fx : null;
    this.despawn(e, 3);
    if (!fx) return;
    for (const o of this.fighters.values()) {
      if (o === owner || !this.canHit(owner, o)) continue;
      const dx = o.s.x - e.x, dz = o.s.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > e.r + PLAYER_RADIUS * 0.6 || o.s.y - e.y > 4.5 || o.s.y - e.y < -2) continue;
      const l = d || 1;
      this.hit(o, owner, fx.hit, e.ab!.key, d > 0.3 ? dx / l : 1, d > 0.3 ? dz / l : 0, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { eid: e.id });
    }
    if (fx.leave && owner) this.spawnZone(fx.leave, owner, e.x, e.y, e.z, 0, 0, 0);
  }

  private stepTrap(e: Ent, owner: Fighter | null) {
    const fx = e.ab?.fx.t === 'trap' ? e.ab.fx : null;
    if (!fx) { this.despawn(e, 0); return; }
    if (e.age >= e.life) { this.despawn(e, 0); return; }
    if (e.age < e.p) return;
    let tripped = false;
    for (const o of this.fighters.values()) {
      if (o === owner || !this.canHit(owner, o)) continue;
      const dx = o.s.x - e.x, dz = o.s.z - e.z;
      if (dx * dx + dz * dz <= e.r * e.r && Math.abs(o.s.y - e.y) < 1.8) { tripped = true; break; }
    }
    if (!tripped) return;
    this.despawn(e, 3);
    this.burst(owner, 'rimeburst', e.ab!.key, e.x, e.y, e.z, fx.radius, fx.hit, false, null, null, e.id);
  }

  private stepLine(e: Ent, owner: Fighter | null) {
    const fx = e.ab?.fx.t === 'line' ? e.ab.fx : null;
    if (!fx || e.age >= e.life) { this.despawn(e, 0); return; }
    const front = Math.min(e.p, e.age * e.q);
    const prev = Math.max(0, front - e.q * DT - 0.6);
    if (prev >= e.p) return;
    const vl = Math.hypot(e.vx, e.vz) || 1;
    const ux = e.vx / vl, uz = e.vz / vl;
    for (const o of this.fighters.values()) {
      if (o === owner || e.hitIds!.has(o.s.id) || !this.canHit(owner, o)) continue;
      const dx = o.s.x - e.x, dz = o.s.z - e.z;
      const along = dx * ux + dz * uz;
      if (along < prev - PLAYER_RADIUS || along > front + PLAYER_RADIUS) continue;
      if (Math.abs(dx * uz - dz * ux) > e.r + PLAYER_RADIUS) continue;
      // spikes come out of the ground: the fighter must be near it
      const gy = this.world.ground(o.s.x, o.s.z, o.s.y + 0.5).y;
      if (gy <= VOID || o.s.y - gy > 1.4) continue;
      e.hitIds!.add(o.s.id);
      this.hit(o, owner, fx.hit, e.ab!.key, ux, uz, o.s.x, o.s.y + 0.4, o.s.z, { eid: e.id });
    }
  }

  private stepWave(e: Ent, owner: Fighter | null) {
    const fx = e.ab?.fx.t === 'wave' ? e.ab.fx : null;
    if (!fx) { this.despawn(e, 0); return; }
    const vl = Math.hypot(e.vx, e.vz) || 1;
    const ux = e.vx / vl, uz = e.vz / vl;
    e.x += e.vx * DT; e.z += e.vz * DT;
    const gy = this.world.ground(e.x, e.z, e.y + 1.5).y;
    if (gy > VOID) e.y += clamp(gy - e.y, -5 * DT, 5 * DT);
    const blocked = !!this.world.solidAt(e.x, e.y + 2.0, e.z, 0.3);
    const ending = e.age >= e.life || blocked;
    for (const o of this.fighters.values()) {
      if (o === owner || !this.canHit(owner, o)) continue;
      const dx = o.s.x - e.x, dz = o.s.z - e.z;
      const along = dx * ux + dz * uz;
      const lat = Math.abs(dx * uz - dz * ux);
      const inside = lat <= e.p / 2 + PLAYER_RADIUS && along > -1.6 && along < 1.8 && o.s.y - e.y < e.q + 0.6 && o.s.y - e.y > -2;
      if (!inside) continue;
      if (!e.hitIds!.has(o.s.id)) {
        e.hitIds!.add(o.s.id);
        this.hit(o, owner, fx.hit, e.ab!.key, ux, uz, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { eid: e.id });
      }
      if (!o.s.alive) continue;
      if (ending) {
        this.hit(o, owner, fx.end, e.ab!.key, ux, uz, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { eid: e.id });
      } else if (o.s.down <= 0) {
        // carried along with the crest
        o.s.vx = e.vx * 1.02; o.s.vz = e.vz * 1.02;
        if (o.s.onGround && o.s.stun < 0.1) o.s.stun = 0.1;
        if (o.s.act >= 0) o.s.act = -1;
      }
    }
    if (ending) this.despawn(e, blocked ? 1 : 0);
  }

  private stepChannel(e: Ent, owner: Fighter | null) {
    if (!owner || !owner.s.alive) { this.despawn(e, 0); return; }
    const s = owner.s;
    const ab = e.ab!;
    const charging = ab.fx.t === 'beam';
    // the channel lives exactly as long as its owner keeps performing the action
    if (s.act < 0 || abilityOf(s, s.act) !== ab || e.age >= e.life + 0.05) {
      const finished = e.age >= e.life - 0.03;
      if (!charging && finished && ab.fx.t === 'channel' && ab.fx.finisher) this.channelHits(e, owner, ab.fx, ab.fx.finisher, true);
      this.despawn(e, 0);
      return;
    }
    const m = this.muzzle(s, s.actYaw, tmpA);
    e.x = m.x; e.y = m.y; e.z = m.z;
    const aim = aimPoint(this.world, s.x, s.y, s.z, s.actYaw, s.actPitch, e.p + 6, owner.bot, tmpB);
    const d = shotDirection(m.x, m.y, m.z, aim, s.actYaw, s.actPitch, { x: 0, y: 0, z: 0 });
    e.vx = d.x; e.vy = d.y; e.vz = d.z; e.yaw = s.actYaw;
    if (charging || ab.fx.t !== 'channel') return;
    e.tickT -= DT;
    if (e.tickT <= 0) { e.tickT += ab.fx.tick; this.channelHits(e, owner, ab.fx, ab.fx.hit, false); }
  }

  private channelHits(e: Ent, owner: Fighter, fx: Extract<Effect, { t: 'channel' }>, spec: HitSpec, finisher: boolean) {
    const wall = this.world.raycast(e.x, e.y, e.z, e.vx, e.vy, e.vz, fx.range, 0.15);
    const maxT = wall ? wall.t : fx.range;
    const hl = Math.hypot(e.vx, e.vz) || 1;
    for (const o of this.fighters.values()) {
      if (o === owner || !this.canHit(owner, o)) continue;
      const px = o.s.x - e.x, py = o.s.y + 0.95 - e.y, pz = o.s.z - e.z;
      const t = clamp(px * e.vx + py * e.vy + pz * e.vz, 0, maxT);
      if (t <= 0) continue;
      const dd = Math.hypot(px - e.vx * t, py - e.vy * t, pz - e.vz * t);
      if (dd > fx.width / 2 + PLAYER_RADIUS + 0.35) continue;
      const ok = this.hit(o, owner, spec, e.ab!.key, e.vx / hl, e.vz / hl, o.s.x, o.s.y + CHEST_HEIGHT, o.s.z, { eid: e.id });
      if (ok && !finisher && o.s.alive && o.s.down <= 0 && o.s.freeze <= 0) {
        // steady shove along the stream, stronger up close
        const k = fx.push * fx.tick * (1.15 - 0.4 * (t / fx.range));
        o.s.vx += (e.vx / hl) * k; o.s.vz += (e.vz / hl) * k;
        const sp = Math.hypot(o.s.vx, o.s.vz);
        const cap = 13;
        if (sp > cap) { o.s.vx *= cap / sp; o.s.vz *= cap / sp; }
      }
    }
  }

  // ============================================================================ world systems

  /** Fighters are solid to one another: gently push overlapping bodies apart. */
  private separate() {
    const list: Fighter[] = [];
    for (const f of this.fighters.values()) if (f.s.alive && f.s.mv !== MV_SURGE && f.s.mv !== MV_RAY) list.push(f);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i].s, b = list[j].s;
      if (a.hall !== b.hall) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const min = PLAYER_RADIUS * 2 * 0.92;
      if (d2 >= min * min || Math.abs(a.y - b.y) > PLAYER_HEIGHT * 0.9) continue;
      const d = Math.sqrt(d2);
      const push = Math.min(0.06, (min - d) * 0.5);
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
      const wa = list[i].dummy ? 0.3 : 1, wb = list[j].dummy ? 0.3 : 1;
      a.x -= nx * push * wa; a.z -= nz * push * wa;
      b.x += nx * push * wb; b.z += nz * push * wb;
    }
  }

  private stepPickups() {
    if (this.match.phase !== 'live') return;
    this.pickupT -= DT;
    if (this.pickupT <= 0) {
      this.pickupT = 14;
      if (this.pickupActive.size < 3) {
        const free: number[] = [];
        this.world.pickupSpots.forEach((_, i) => { if (!this.pickupActive.has(i)) free.push(i); });
        if (free.length) {
          const i = this.rng.pick(free);
          const p = this.world.pickupSpots[i];
          const e = this.spawn('healrune', 'pickup', null, null, p.x, p.y, p.z, 0, 0, 0, 0, 1.2, 60, 0, 0, 0);
          e.n = i;
          this.pickupActive.add(i);
        }
      }
    }
    for (const e of this.ents.values()) {
      if (e.cls !== 'pickup' || e.dead) continue;
      for (const f of this.fighters.values()) {
        const s = f.s;
        if (!s.alive || s.hall || f.dummy || s.hp >= MAX_HP) continue;
        if (Math.hypot(s.x - e.x, s.z - e.z) > e.r + PLAYER_RADIUS || Math.abs(s.y + 1 - e.y) > 2.2) continue;
        const heal = Math.min(40, MAX_HP - s.hp);
        s.hp += heal; s.burn = 0;
        this.events.push({ e: 'pickup', p: s.id, id: e.id, heal, x: r2(e.x), y: r2(e.y), z: r2(e.z) });
        this.despawn(e, 2);
        break;
      }
    }
  }

  // ============================================================================ match loop

  private stepMatch() {
    const m = this.match;
    m.timeLeft -= DT;
    if (m.phase === 'live') {
      if (!this.announced.minute && m.timeLeft <= 60) { this.announced.minute = true; this.announce('oneminute'); }
      if (!this.announced.ten && m.timeLeft <= 10) { this.announced.ten = true; this.announce('tenseconds'); }
      if (m.timeLeft <= 0) this.endMatch();
    } else if (m.phase === 'intermission') {
      if (m.timeLeft <= 0) this.startMatch();
    } else if (m.timeLeft <= 0) {
      this.startIntermission();
    }
  }

  private startMatch() {
    this.match = { phase: 'live', timeLeft: MATCH_TIME, killTarget: MATCH_KILL_TARGET, round: this.match.round };
    this.firstBlood = false; this.leaderId = 0; this.announced = { minute: false, ten: false };
    this.pickupT = 10;
    for (const f of this.fighters.values()) {
      f.kills = 0; f.deaths = 0; f.streak = 0; f.bestStreak = 0; f.dmg = 0; f.matchGlory = 0; f.multi = 0;
      if (f.brain) f.brain.deployIn = this.rng.range(0.6, 7);
    }
    this.announce('matchstart', 0, this.match.killTarget);
    this.matchDirty = true; this.rosterDirty = true;
  }

  private endMatch() {
    if (this.match.phase !== 'live') return;
    const standings = [...this.fighters.values()].filter((f) => !f.dummy)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.dmg - a.dmg);
    const results: MatchResults = {
      round: this.match.round,
      standings: standings.map((f) => ({ id: f.s.id, name: f.name, bot: f.bot, el: f.equipped, kills: f.kills, deaths: f.deaths, dmg: Math.round(f.dmg) })),
      you: null,
    };
    standings.forEach((f, i) => {
      if (f.bot) return;
      const played = f.kills + f.deaths > 0 || f.dmg > 0;
      if (!played) return;
      const bonus = (i < 3 ? GLORY_PLACEMENT[i] : 0) + GLORY_PARTICIPATION;
      this.award(f, bonus, i < 3 ? 'place' : 'match');
      this.cb.onStat?.(f, 'matches', 1);
      this.cb.onStat?.(f, 'matchKills', f.kills);
      if (i === 0) this.cb.onStat?.(f, 'wins', 1);
      if (i < 3) this.cb.onStat?.(f, 'podiums', 1);
    });
    this.lastResults = results;
    this.match = { phase: 'results', timeLeft: RESULTS_TIME, killTarget: MATCH_KILL_TARGET, round: this.match.round };
    this.announce('matchend', standings[0] ? standings[0].s.id : 0);
    for (const e of [...this.ents.values()]) this.despawn(e, 0);
    this.cb.onMatchEnd?.(results, standings);
    this.matchDirty = true; this.rosterDirty = true;
  }

  private startIntermission() {
    this.match = { phase: 'intermission', timeLeft: INTERMISSION_TIME, killTarget: MATCH_KILL_TARGET, round: this.match.round + 1 };
    for (const e of [...this.ents.values()]) this.despawn(e, 0);
    for (const f of this.fighters.values()) {
      if (f.dummy) continue;
      f.kills = 0; f.deaths = 0; f.streak = 0; f.dmg = 0;
      if (!f.s.hall || !f.s.alive) this.spawnInHall(f);
      // bots sometimes change discipline between matches
      if (f.bot && this.rng.chance(0.35)) { f.equipped = this.rng.int(0, ELEMENT_ORDER.length - 1); this.setElement(f, f.equipped); }
    }
    this.matchDirty = true; this.rosterDirty = true;
  }

  /** Results as seen by one fighter (adds their personal line). */
  resultsFor(f: Fighter): MatchResults | null {
    const r = this.lastResults;
    if (!r) return null;
    const place = r.standings.findIndex((s) => s.id === f.s.id);
    if (place < 0) return { ...r, you: null };
    const played = f.kills + f.deaths > 0 || f.dmg > 0;
    const bonus = played ? (place < 3 ? GLORY_PLACEMENT[place] : 0) + GLORY_PARTICIPATION : 0;
    return { ...r, you: { place: place + 1, glory: f.matchGlory, bonus, kills: f.kills, deaths: f.deaths, dmg: Math.round(f.dmg), bestStreak: f.bestStreak } };
  }
}

export { ELEMENT_LIST };
