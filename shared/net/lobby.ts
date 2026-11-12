// The lobby: sessions, matchmaking, rooms and persistence glue. Transport-agnostic — the Node
// server feeds it WebSocket messages; the offline practice mode runs the very same class in the
// browser with an in-memory connection.

import { ELEMENT_LIST, ELEMENT_ORDER, type ElementId } from '../elements';
import {
  CHAT_MAX, NAME_MAX, ROOM_MAX_HUMANS, ROOM_TARGET_POPULATION, SNAPSHOT_EVERY, TICK_RATE,
  type Input, type Profile, type ProfileStats, type RoomInfo,
} from '../types';
import { Game, type Fighter } from '../sim/game';
import { quantizePlayer } from '../sim/player';
import {
  CODE_ALPHABET, CODE_LENGTH, PROTOCOL_VERSION, encodeRemote, encodeSelf, normalizeCode,
  type ClientMsg, type ServerMsg,
} from './protocol';

export interface Conn {
  /** Deliver a message to the client. */
  send(msg: ServerMsg): void;
  /** Optional: drop the connection (abuse). */
  close?(): void;
}

export interface ProfileStore {
  load(token: string): Profile | null;
  /** Persist (implementations debounce). */
  save(token: string, profile: Profile): void;
  /** Mint a new unguessable token. */
  newToken(): string;
}

export function emptyStats(): ProfileStats {
  return { kills: 0, deaths: 0, ringouts: 0, falls: 0, damage: 0, hits: 0, matches: 0, wins: 0, podiums: 0, bestStreak: 0, bestMatchKills: 0, gloryEarned: 0, playSeconds: 0, elementKills: {} };
}

export function newProfile(name: string): Profile {
  return { name, glory: 0, owned: [ELEMENT_ORDER[0]], equipped: ELEMENT_ORDER[0], stats: emptyStats(), created: Date.now() };
}

const ADJ = ['Grim', 'Swift', 'Iron', 'Storm', 'Frost', 'Red', 'Wild', 'Stone', 'Raven', 'Wolf', 'Bold', 'Pale', 'Ash', 'Bright', 'Silent', 'Elder'];
const NOUN = ['Axe', 'Shield', 'Fang', 'Hammer', 'Rune', 'Spear', 'Skald', 'Jarl', 'Hound', 'Wing', 'Brand', 'Oath', 'Tide', 'Ember', 'Thorn', 'Helm'];
export const randomName = (): string => ADJ[Math.floor(Math.random() * ADJ.length)] + NOUN[Math.floor(Math.random() * NOUN.length)] + Math.floor(Math.random() * 90 + 10);

/** Strip control characters / markup-ish noise, collapse whitespace, clamp length. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, NAME_MAX).join('');
  return s;
}

const MILD = /\b(fuck|shit|bitch|cunt|nigg\w*|fag\w*|retard\w*)\b/gi;
export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, CHAT_MAX).join('');
  return s.replace(MILD, (m) => '*'.repeat(m.length));
}

/** Validate a stored / incoming profile so corrupt data can never break a room. */
export function sanitizeProfile(p: any): Profile | null {
  if (!p || typeof p !== 'object') return null;
  const out = newProfile(cleanName(p.name) || randomName());
  out.glory = Math.max(0, Math.floor(Number(p.glory) || 0));
  const owned: ElementId[] = [];
  // ownership is a ladder: keep the unbroken prefix
  for (const el of ELEMENT_ORDER) { if (Array.isArray(p.owned) && p.owned.includes(el)) owned.push(el); else break; }
  out.owned = owned.length ? owned : [ELEMENT_ORDER[0]];
  out.equipped = out.owned.includes(p.equipped) ? p.equipped : out.owned[0];
  out.created = Number(p.created) || Date.now();
  const st = p.stats || {};
  for (const k of Object.keys(out.stats) as (keyof ProfileStats)[]) {
    if (k === 'elementKills') continue;
    (out.stats as any)[k] = Math.max(0, Number(st[k]) || 0);
  }
  if (st.elementKills && typeof st.elementKills === 'object') {
    for (const el of ELEMENT_ORDER) if (st.elementKills[el]) out.stats.elementKills[el] = Math.max(0, Math.floor(Number(st.elementKills[el]) || 0));
  }
  return out;
}

class Session {
  token = '';
  profile: Profile | null = null;
  room: Room | null = null;
  fighterId = 0;
  ping = 0;
  profileDirty = false;
  chatTimes: number[] = [];
  msgCount = 0;
  /** Lobby tick of the last room join (joins are rate-limited: creating a room is not free). */
  lastJoin = -1000;
  /** A brand-new identity is only written to disk once it has something worth keeping. */
  fresh = false;
  constructor(readonly conn: Conn) {}
}

class Room {
  readonly game: Game;
  readonly sessions = new Map<number, Session>();
  private rosterT = 0;
  private matchT = 0;
  private secondT = 0;
  emptyFor = 0;

  constructor(readonly code: string, readonly isPrivate: boolean, readonly bots: boolean, private lobby: Lobby) {
    this.game = new Game({ bots, population: ROOM_TARGET_POPULATION, seed: (Math.random() * 2 ** 31) | 0 }, {
      onGlory: (f, n) => {
        const s = this.sessions.get(f.s.id);
        if (!s || !s.profile) return;
        s.profile.glory += n; s.profile.stats.gloryEarned += n; s.profileDirty = true;
      },
      onStat: (f, stat, v) => {
        const s = this.sessions.get(f.s.id);
        if (!s || !s.profile) return;
        const st = s.profile.stats;
        switch (stat) {
          case 'kills': { st.kills += v; const el = ELEMENT_ORDER[f.s.el]; st.elementKills[el] = (st.elementKills[el] || 0) + v; break; }
          case 'deaths': st.deaths += v; break;
          case 'ringouts': st.ringouts += v; break;
          case 'falls': st.falls += v; break;
          case 'damage': st.damage += v; break;
          case 'hits': st.hits += v; break;
          case 'matches': st.matches += v; break;
          case 'wins': st.wins += v; break;
          case 'podiums': st.podiums += v; break;
          case 'streak': st.bestStreak = Math.max(st.bestStreak, v); break;
          case 'matchKills': st.bestMatchKills = Math.max(st.bestMatchKills, v); break;
        }
        s.profileDirty = true;
      },
    });
  }

  info(): RoomInfo {
    return { code: this.code, isPrivate: this.isPrivate, bots: this.bots, humans: this.sessions.size, capacity: ROOM_MAX_HUMANS };
  }

  join(s: Session) {
    const p = s.profile!;
    const f = this.game.addFighter(p.name, false, ELEMENT_ORDER.indexOf(p.equipped));
    s.room = this; s.fighterId = f.s.id;
    this.sessions.set(f.s.id, s);
    this.game.balanceBots();
    s.conn.send({
      t: 'joined', room: this.info(), you: f.s.id, tick: this.game.tick, roster: this.game.roster(), ents: this.game.entityStates(),
      match: { ...this.game.match }, results: this.game.match.phase === 'results' ? this.game.resultsFor(f) : null,
    });
    this.game.rosterDirty = true;
  }

  leave(s: Session) {
    this.sessions.delete(s.fighterId);
    this.game.removeFighter(s.fighterId);
    s.room = null; s.fighterId = 0;
    if (this.sessions.size > 0) this.game.balanceBots();
  }

  fighter(s: Session): Fighter | undefined { return this.game.fighters.get(s.fighterId); }

  tick() {
    const g = this.game;
    g.step();
    this.secondT++;
    if (this.secondT >= TICK_RATE) {
      this.secondT = 0;
      for (const s of this.sessions.values()) {
        if (s.profile) { s.profile.stats.playSeconds += 1; }
        const f = g.fighters.get(s.fighterId);
        if (f) f.ping = s.ping;
      }
    }
    if (g.tick % SNAPSHOT_EVERY !== 0) return;

    const remotes = new Map<number, number[]>();
    for (const f of g.fighters.values()) remotes.set(f.s.id, encodeRemote(f.s));
    const shared = g.events;
    for (const s of this.sessions.values()) {
      const f = g.fighters.get(s.fighterId);
      if (!f) continue;
      const others: number[][] = [];
      for (const [id, arr] of remotes) if (id !== s.fighterId) others.push(arr);
      const priv = g.privateEvents.get(s.fighterId);
      const ev = priv && priv.length ? (shared.length ? shared.concat(priv) : priv) : shared;
      // snap the authoritative state to the wire grid so client and server continue from identical numbers
      quantizePlayer(f.s);
      const msg: ServerMsg = { t: 's', k: g.tick, a: f.ack, me: encodeSelf(f.s), p: others };
      if (ev.length) msg.e = ev;
      s.conn.send(msg);
    }
    g.events = [];
    g.privateEvents.clear();

    this.rosterT--;
    if ((g.rosterDirty && this.rosterT <= 0) || this.rosterT < -60) {
      g.rosterDirty = false; this.rosterT = 8;
      const roster = g.roster(), room = this.info();
      for (const s of this.sessions.values()) s.conn.send({ t: 'roster', roster, room });
    }
    this.matchT--;
    if (g.matchDirty || this.matchT <= 0) {
      const changed = g.matchDirty;
      g.matchDirty = false; this.matchT = 30;
      for (const s of this.sessions.values()) {
        const f = g.fighters.get(s.fighterId);
        s.conn.send({ t: 'match', match: { ...g.match }, results: g.match.phase === 'results' && f ? g.resultsFor(f) : null });
        if (changed) s.profileDirty = true;
      }
    }
  }
}

export interface LobbyStats { rooms: number; humans: number; bots: number; ticks: number }

/** Hard cap on simultaneous rooms (each one costs simulation time). */
const MAX_ROOMS = 300;

export class Lobby {
  private sessions = new Map<Conn, Session>();
  private rooms = new Map<string, Room>();
  private ticks = 0;

  constructor(private store: ProfileStore) {}

  connect(conn: Conn): void { this.sessions.set(conn, new Session(conn)); }

  disconnect(conn: Conn): void {
    const s = this.sessions.get(conn);
    if (!s) return;
    if (s.room) this.leaveRoom(s);
    this.persist(s);
    this.sessions.delete(conn);
  }

  private persist(s: Session) {
    const p = s.profile;
    if (!p || !s.token) return;
    // an identity that has done nothing yet is not worth a row (and cannot be used to bloat the store)
    if (s.fresh && p.glory === 0 && p.stats.playSeconds < 20 && p.stats.damage === 0) return;
    s.fresh = false;
    this.store.save(s.token, p);
  }

  private leaveRoom(s: Session) {
    const room = s.room;
    if (!room) return;
    room.leave(s);
    // an emptied room lingers briefly (see tick) so a dropped connection or a second tab can return to it
    room.emptyFor = 0;
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  receive(conn: Conn, msg: ClientMsg): void {
    const s = this.sessions.get(conn);
    if (!s || !msg || typeof msg !== 'object') return;
    // crude flood guard: inputs arrive at 60 Hz, everything else is rare
    s.msgCount++;
    if (s.msgCount > 400) { conn.send({ t: 'err', code: 'rate', msg: 'Too many messages.' }); conn.close?.(); return; }

    switch (msg.t) {
      case 'hello': {
        if (s.profile) return; // one identity per connection
        if (msg.v !== PROTOCOL_VERSION) { conn.send({ t: 'err', code: 'version', msg: 'This page is out of date. Please reload.' }); return; }
        let profile: Profile | null = null;
        let token = typeof msg.token === 'string' && /^[a-f0-9]{32,64}$/.test(msg.token) ? msg.token : '';
        if (token) profile = sanitizeProfile(this.store.load(token));
        // one live session per identity: a second tab takes over, and the first is told so
        for (const o of this.sessions.values()) {
          if (o === s || !token || o.token !== token) continue;
          profile = o.profile || profile;
          if (o.room) this.leaveRoom(o);
          o.profile = null; o.token = '';
          o.conn.send({ t: 'err', code: 'replaced', msg: 'Vindheim was opened in another tab. Reload this one to play here.' });
          o.conn.send({ t: 'left' });
        }
        if (!profile) { token = this.store.newToken(); profile = newProfile(cleanName(msg.name) || randomName()); s.fresh = true; }
        s.token = token; s.profile = profile;
        this.persist(s);
        conn.send({ t: 'welcome', v: PROTOCOL_VERSION, token, profile, now: Date.now() / 1000 });
        break;
      }
      case 'join': {
        if (!s.profile) return;
        if (this.ticks - s.lastJoin < TICK_RATE * 0.75) { conn.send({ t: 'err', code: 'rate', msg: 'One moment…' }); return; }
        if (s.room) this.leaveRoom(s);
        let room: Room | undefined;
        if (msg.mode === 'join') {
          room = this.rooms.get(normalizeCode(String(msg.code || '')));
          if (!room) { conn.send({ t: 'err', code: 'room-not-found', msg: 'No room with that code. Check it and try again.' }); return; }
          if (room.sessions.size >= ROOM_MAX_HUMANS) { conn.send({ t: 'err', code: 'room-full', msg: 'That room is full.' }); return; }
        } else if (msg.mode === 'create') {
          if (this.rooms.size >= MAX_ROOMS) { conn.send({ t: 'err', code: 'room-full', msg: 'The server is full. Try again in a moment.' }); return; }
          room = new Room(this.newCode(), true, msg.bots !== false, this);
          this.rooms.set(room.code, room);
        } else {
          // quick play: the fullest public room with space
          for (const r of this.rooms.values()) {
            if (r.isPrivate || r.sessions.size >= ROOM_MAX_HUMANS) continue;
            if (!room || r.sessions.size > room.sessions.size) room = r;
          }
          if (!room) { room = new Room(this.newCode(), false, true, this); this.rooms.set(room.code, room); }
        }
        s.lastJoin = this.ticks; // only successful joins count against the limit
        room.join(s);
        break;
      }
      case 'leave': {
        if (s.room) { this.leaveRoom(s); this.persist(s); }
        conn.send({ t: 'left' });
        break;
      }
      case 'in': {
        const room = s.room;
        if (!room || !Array.isArray(msg.i)) return;
        const n = Math.min(msg.i.length, 6);
        for (let k = msg.i.length - n; k < msg.i.length; k++) {
          const a = msg.i[k];
          if (!Array.isArray(a) || a.length < 6) continue;
          const inp: Input = { seq: a[0] | 0, mx: clampNum(a[1], -1, 1), mz: clampNum(a[2], -1, 1), yaw: clampNum(a[3], -1000, 1000), pitch: clampNum(a[4], -1.6, 1.6), b: (a[5] | 0) & 63 };
          const l = Math.hypot(inp.mx, inp.mz);
          if (l > 1) { inp.mx /= l; inp.mz /= l; }
          room.game.pushInput(s.fighterId, inp);
        }
        break;
      }
      case 'cmd': this.command(s, msg.c, msg.v); break;
      case 'ping': {
        if (typeof msg.rtt === 'number' && isFinite(msg.rtt)) s.ping = Math.max(0, Math.min(500, msg.rtt));
        conn.send({ t: 'pong', c: Number(msg.c) || 0, now: Date.now() / 1000 });
        break;
      }
    }
  }

  private command(s: Session, c: string, v: unknown) {
    const p = s.profile;
    if (!p) return;
    const room = s.room;
    const idx = typeof v === 'string' ? ELEMENT_ORDER.indexOf(v as ElementId) : -1;
    switch (c) {
      case 'name': {
        const name = cleanName(v);
        if (!name) return;
        p.name = name; s.profileDirty = true; s.fresh = false;
        const f = room?.fighter(s);
        if (f && room) { f.name = name; room.game.rosterDirty = true; }
        break;
      }
      case 'deploy': room?.game.deploy(s.fighterId); break;
      case 'hall': room?.game.toHall(s.fighterId); break;
      case 'equip': {
        if (idx < 0 || !p.owned.includes(ELEMENT_ORDER[idx])) return;
        p.equipped = ELEMENT_ORDER[idx]; s.profileDirty = true;
        room?.game.setEquipped(s.fighterId, idx);
        break;
      }
      case 'unlock': {
        if (idx < 0) return;
        const el = ELEMENT_LIST[idx];
        if (p.owned.includes(el.id) || idx !== p.owned.length || p.glory < el.cost) return;
        p.glory -= el.cost; p.owned.push(el.id); p.equipped = el.id;
        s.profileDirty = true;
        room?.game.setEquipped(s.fighterId, idx);
        this.persist(s);
        s.conn.send({ t: 'profile', profile: p });
        s.profileDirty = false;
        break;
      }
      case 'trial': room?.game.setTrial(s.fighterId, idx); break;
      case 'chat': {
        if (!room) return;
        const text = cleanChat(v);
        if (!text) return;
        const now = Date.now();
        s.chatTimes = s.chatTimes.filter((t) => now - t < 10000);
        if (s.chatTimes.length >= 5) return;
        s.chatTimes.push(now);
        room.game.chat(s.fighterId, text);
        break;
      }
    }
  }

  /** Advance every room by one simulation tick. Call at TICK_RATE. */
  tick(): void {
    this.ticks++;
    for (const room of this.rooms.values()) {
      if (room.sessions.size === 0) {
        // nobody home: do not simulate; close the room after a short grace period
        if (++room.emptyFor > TICK_RATE * 12) this.rooms.delete(room.code);
        continue;
      }
      // one misbehaving room must never take the others (or the lobby's own bookkeeping) down with it
      try { room.tick(); } catch (err) { console.error('[room ' + room.code + '] tick failed', err); }
    }
    if (this.ticks % TICK_RATE === 0) {
      for (const s of this.sessions.values()) {
        s.msgCount = 0;
        if (s.profileDirty && s.profile) {
          s.profileDirty = false;
          s.conn.send({ t: 'profile', profile: s.profile });
          if (this.ticks % (TICK_RATE * 5) === 0 || !s.room) this.persist(s);
        }
      }
    }
    if (this.ticks % (TICK_RATE * 20) === 0) for (const s of this.sessions.values()) this.persist(s);
  }

  /** Flush every profile (shutdown). */
  flush(): void { for (const s of this.sessions.values()) this.persist(s); }

  stats(): LobbyStats {
    let humans = 0, bots = 0;
    for (const r of this.rooms.values()) { humans += r.sessions.size; bots += r.game.botCount(); }
    return { rooms: this.rooms.size, humans, bots, ticks: this.ticks };
  }
}

function clampNum(v: unknown, lo: number, hi: number): number {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n < lo ? lo : n > hi ? hi : n;
}
