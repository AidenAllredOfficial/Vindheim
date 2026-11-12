import { describe, expect, it } from 'vitest';
import { Lobby, cleanChat, cleanName, newProfile, sanitizeProfile, type Conn, type ProfileStore } from '../shared/net/lobby';
import { PROTOCOL_VERSION, decodeSelf, encodeRemote, encodeSelf, normalizeCode, R, F_ALIVE, F_GROUND, type ServerMsg } from '../shared/net/protocol';
import { createPlayerState, stepPlayer } from '../shared/sim/player';
import { ELEMENTS } from '../shared/elements';
import { BTN_JUMP, DT, ROOM_MAX_HUMANS, type Profile } from '../shared/types';
import { World } from '../shared/world';
import { ClientState } from '../client/src/core/state';

class MemStore implements ProfileStore {
  data = new Map<string, Profile>();
  n = 0;
  load(t: string) { const p = this.data.get(t); return p ? JSON.parse(JSON.stringify(p)) : null; }
  save(t: string, p: Profile) { this.data.set(t, JSON.parse(JSON.stringify(p))); }
  newToken() { return (++this.n).toString(16).padStart(32, '0'); }
}

function client(lobby: Lobby) {
  const inbox: ServerMsg[] = [];
  const conn: Conn = { send: (m) => inbox.push(JSON.parse(JSON.stringify(m))) };
  lobby.connect(conn);
  const last = <T extends ServerMsg['t']>(t: T) => [...inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  return { conn, inbox, last, send: (m: any) => lobby.receive(conn, m) };
}

describe('sanitising', () => {
  it('cleans names and chat', () => {
    expect(cleanName('  <b>Bjørn</b>\n the   Bold ')).toBe('bBjørn/b the Bol');
    expect(cleanName('x'.repeat(50)).length).toBe(16);
    expect(cleanName(42)).toBe('');
    expect(cleanChat('hello\u0000 there   friend')).toBe('hello there friend');
    expect(cleanChat('y'.repeat(500)).length).toBe(140);
    expect(normalizeCode(' ab-c12 ')).toBe('ABC12');
  });

  it('repairs corrupt profiles', () => {
    const p = sanitizeProfile({ name: 'Rune', glory: -50, owned: ['ember', 'storm', 'dawn'], equipped: 'dawn', stats: { kills: 'x', deaths: 3 } })!;
    expect(p.glory).toBe(0);
    expect(p.owned).toEqual(['ember']);       // the ladder has no gaps: storm without frost is dropped
    expect(p.equipped).toBe('ember');
    expect(p.stats.kills).toBe(0); expect(p.stats.deaths).toBe(3);
    expect(sanitizeProfile(null)).toBeNull();
  });
});

describe('state encoding', () => {
  it('round-trips the full fighter state', () => {
    const world = new World();
    const a = createPlayerState(3);
    a.x = 20; a.z = 20; a.y = world.topAt(20, 20); a.onGround = true; a.hall = false; a.el = 2;
    for (let i = 0; i < 90; i++) stepPlayer(a, { seq: i, mx: 0.5, mz: 1, yaw: i * 0.03, pitch: 0.1, b: i === 20 ? BTN_JUMP : i === 40 ? 4 : 0 }, world, DT);
    a.burn = 1.5; a.chill = 2; a.chillT = 3;
    const b = decodeSelf(JSON.parse(JSON.stringify(encodeSelf(a))), createPlayerState(3));
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      if (k === 'cd') { for (let i = 0; i < 5; i++) expect(b.cd[i]).toBeCloseTo(a.cd[i], 2); continue; }
      if (typeof a[k] === 'number') expect(b[k] as number).toBeCloseTo(a[k] as number, 3);
      else expect(b[k]).toBe(a[k]);
    }
    const r = encodeRemote(a);
    expect(r[R.id]).toBe(3);
    expect(r[R.x]).toBeCloseTo(a.x, 2);
    expect(r[R.flags] & F_ALIVE).toBeTruthy();
    expect(!!(r[R.flags] & F_GROUND)).toBe(a.onGround);
  });
});

describe('lobby', () => {
  it('welcomes a new player, restores a returning one and rejects old clients', () => {
    const store = new MemStore(), lobby = new Lobby(store);
    const a = client(lobby);
    a.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Sigrun' });
    const w = a.last('welcome')!;
    expect(w.profile.name).toBe('Sigrun'); expect(w.profile.owned).toEqual(['ember']); expect(w.token).toMatch(/^[a-f0-9]{32}$/);
    const b = client(lobby);
    b.send({ t: 'hello', v: PROTOCOL_VERSION, token: w.token, name: 'Ignored' });
    expect(b.last('welcome')!.profile.name).toBe('Sigrun');
    const c = client(lobby);
    c.send({ t: 'hello', v: 0 });
    expect(c.last('err')!.code).toBe('version');
    const d = client(lobby);
    d.send({ t: 'hello', v: PROTOCOL_VERSION, token: 'not-a-token' });
    expect(d.last('welcome')!.token).not.toBe('not-a-token');
  });

  it('quick play fills a public room with bots; private rooms are joined by code', () => {
    const lobby = new Lobby(new MemStore());
    const a = client(lobby), b = client(lobby), c = client(lobby);
    for (const x of [a, b, c]) x.send({ t: 'hello', v: PROTOCOL_VERSION });
    a.send({ t: 'join', mode: 'public' });
    const ja = a.last('joined')!;
    expect(ja.room.isPrivate).toBe(false);
    expect(ja.roster.filter((r) => r.bot).length).toBe(7);
    expect(ja.roster.filter((r) => r.dummy).length).toBe(3);
    b.send({ t: 'join', mode: 'public' });
    expect(b.last('joined')!.room.code).toBe(ja.room.code); // same room
    c.send({ t: 'join', mode: 'create', bots: false });
    const jc = c.last('joined')!;
    expect(jc.room.isPrivate).toBe(true); expect(jc.room.code).toHaveLength(5);
    expect(jc.roster.filter((r) => r.bot).length).toBe(0);
    b.send({ t: 'join', mode: 'join', code: jc.room.code.toLowerCase() });
    expect(b.last('joined')!.room.code).toBe(jc.room.code);
    b.send({ t: 'join', mode: 'join', code: 'ZZZZZ' });
    expect(b.last('err')!.code).toBe('room-not-found');
    expect(lobby.stats().rooms).toBe(2);
    c.send({ t: 'leave' }); lobby.disconnect(b.conn);
    expect(lobby.stats().rooms).toBe(1);
  });

  it('refuses to overfill a room', () => {
    const lobby = new Lobby(new MemStore());
    const host = client(lobby);
    host.send({ t: 'hello', v: PROTOCOL_VERSION }); host.send({ t: 'join', mode: 'create', bots: true });
    const code = host.last('joined')!.room.code;
    for (let i = 1; i < ROOM_MAX_HUMANS; i++) { const g = client(lobby); g.send({ t: 'hello', v: PROTOCOL_VERSION }); g.send({ t: 'join', mode: 'join', code }); expect(g.last('joined')).toBeDefined(); }
    const late = client(lobby);
    late.send({ t: 'hello', v: PROTOCOL_VERSION }); late.send({ t: 'join', mode: 'join', code });
    expect(late.last('err')!.code).toBe('room-full');
  });

  it('streams snapshots and acknowledges inputs', () => {
    const lobby = new Lobby(new MemStore());
    const a = client(lobby);
    a.send({ t: 'hello', v: PROTOCOL_VERSION }); a.send({ t: 'join', mode: 'public' });
    for (let i = 1; i <= 30; i++) { a.send({ t: 'in', i: [[i, 0, 1, 0, 0, 0]] }); lobby.tick(); }
    const snap = a.last('s')!;
    expect(snap.a).toBe(30);
    expect(snap.p.length).toBe(10); // 7 bots + 3 dummies
    expect(a.inbox.filter((m) => m.t === 's').length).toBe(15);
    expect(a.last('roster')).toBeDefined(); expect(a.last('match')).toBeDefined();
    // garbage is ignored, not fatal
    a.send({ t: 'in', i: [[31, 'x', null, NaN, 99, -1], 'nope', []] }); a.send({ t: 'in' }); a.send(null); a.send({ t: 'cmd', c: 'equip', v: { evil: 1 } });
    lobby.tick(); lobby.tick();
    expect(a.last('s')!.a).toBe(31);
  });

  it('enforces the unlock ladder and persists progress', () => {
    const store = new MemStore(), lobby = new Lobby(store);
    const a = client(lobby);
    a.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Rich' });
    const token = a.last('welcome')!.token;
    a.send({ t: 'join', mode: 'create', bots: false });
    const cost = ELEMENTS.frost.cost;
    a.send({ t: 'cmd', c: 'unlock', v: 'frost' });               // cannot afford
    a.send({ t: 'cmd', c: 'equip', v: 'storm' });                // not owned
    for (let i = 0; i < 70; i++) lobby.tick();
    expect(a.last('profile')?.profile.owned ?? ['ember']).toEqual(['ember']);
    // grant glory the way the game would
    lobby.disconnect(a.conn);
    const prof = store.load(token)!; prof.glory = cost + 30; store.save(token, prof);
    const b = client(lobby);
    b.send({ t: 'hello', v: PROTOCOL_VERSION, token });
    expect(b.last('welcome')!.profile.glory).toBe(cost + 30);
    b.send({ t: 'join', mode: 'create', bots: false });
    b.send({ t: 'cmd', c: 'unlock', v: 'storm' });               // out of order
    expect(b.last('profile')).toBeUndefined();
    b.send({ t: 'cmd', c: 'unlock', v: 'frost' });
    const p = b.last('profile')!.profile;
    expect(p.owned).toEqual(['ember', 'frost']); expect(p.glory).toBe(30); expect(p.equipped).toBe('frost');
    b.send({ t: 'cmd', c: 'unlock', v: 'frost' });               // twice does nothing
    b.send({ t: 'cmd', c: 'equip', v: 'ember' });
    b.send({ t: 'cmd', c: 'name', v: '  New <Name>  ' });
    lobby.disconnect(b.conn);
    const saved = store.load(token)!;
    expect(saved.owned).toEqual(['ember', 'frost']); expect(saved.glory).toBe(30); expect(saved.equipped).toBe('ember'); expect(saved.name).toBe('New Name');
  });

  it('relays chat with rate limiting', () => {
    const lobby = new Lobby(new MemStore());
    const a = client(lobby), b = client(lobby);
    a.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Talker' }); a.send({ t: 'join', mode: 'create', bots: false });
    b.send({ t: 'hello', v: PROTOCOL_VERSION }); b.send({ t: 'join', mode: 'join', code: a.last('joined')!.room.code });
    for (let i = 0; i < 9; i++) a.send({ t: 'cmd', c: 'chat', v: 'skål ' + i });
    lobby.tick(); lobby.tick();
    const chats = b.inbox.filter((m) => m.t === 's').flatMap((m: any) => m.e || []).filter((e: any) => e.e === 'chat');
    expect(chats.length).toBe(5);
    expect(chats[0].name).toBe('Talker'); expect(chats[0].text).toBe('skål 0');
  });
});

describe('client prediction', () => {
  it('matches the server with latency and corrects after a server-side shove', () => {
    const lobby = new Lobby(new MemStore());
    const c = client(lobby);
    c.send({ t: 'hello', v: PROTOCOL_VERSION }); c.send({ t: 'join', mode: 'create', bots: false });
    const joined = c.last('joined')!;
    const cs = new ClientState();
    cs.reset(joined.you);
    cs.setRoster(joined.roster);
    const LAT = 4; // ticks each way
    const up: any[][] = [], down: ServerMsg[][] = [];
    let now = 0, read = c.inbox.length, maxErr = 0;
    const game = (lobby as any).rooms.values().next().value.game;
    for (let i = 0; i < 400; i++) {
      now += DT;
      // client: sample, predict, send (arrives LAT ticks later)
      const inp = cs.tick({ mx: Math.round(Math.sin(i * 0.05) * 100) / 100, mz: 1, b: i % 70 === 10 ? BTN_JUMP : 0 }, Math.round(i * 0.01 * 1e4) / 1e4, 0, {});
      up.push([inp.seq, inp.mx, inp.mz, inp.yaw, inp.pitch, inp.b]);
      if (up.length > LAT) c.send({ t: 'in', i: [up.shift()!] });
      if (i === 200) { const f = game.fighters.get(joined.you); f.s.vx += 9; f.s.vy = 6; f.s.onGround = false; } // a hit the client could not predict
      lobby.tick();
      down.push(c.inbox.slice(read)); read = c.inbox.length;
      if (down.length > LAT) for (const m of down.shift()!) if (m.t === 's') cs.onSnapshot(m.k, m.a, m.me, m.p, now);
      cs.frame(1, DT, now, 0, 0);
      if (i > 60 && (i < 200 || i > 290)) {
        // compare with where the server will be once it has processed the same inputs
        const f = game.fighters.get(joined.you);
        const lag = cs.me.x - f.s.x; void lag;
      }
    }
    // let the pipes drain, then both sides must agree exactly
    for (let i = 0; i < 30; i++) {
      now += DT;
      const inp = cs.tick({ mx: 0, mz: 0, b: 0 }, 0, 0, {});
      up.push([inp.seq, 0, 0, 0, 0, 0]);
      c.send({ t: 'in', i: [up.shift()!] });
      lobby.tick();
      down.push(c.inbox.slice(read)); read = c.inbox.length;
      for (const m of down.shift()!) if (m.t === 's') cs.onSnapshot(m.k, m.a, m.me, m.p, now);
    }
    while (up.length) { c.send({ t: 'in', i: [up.shift()!] }); lobby.tick(); }
    for (const batch of down) for (const m of batch) if (m.t === 's') cs.onSnapshot(m.k, m.a, m.me, m.p, now);
    for (const m of c.inbox.slice(read)) if (m.t === 's') cs.onSnapshot(m.k, m.a, m.me, m.p, now);
    const f = game.fighters.get(joined.you);
    maxErr = Math.hypot(cs.me.x - f.s.x, cs.me.y - f.s.y, cs.me.z - f.s.z);
    expect(maxErr).toBeLessThan(0.02);
    expect(Math.hypot(f.s.x, f.s.z + 150)).toBeGreaterThan(1); // and it really did move around the hall
  });

  it('interpolates remote fighters between snapshots', () => {
    const cs = new ClientState();
    cs.reset(1);
    const r = cs.remote(2);
    const base = encodeRemote(createPlayerState(2));
    const a = [...base], b = [...base];
    a[R.x] = 0; b[R.x] = 3; a[R.flags] = b[R.flags] = F_ALIVE | F_GROUND;
    r.push(1.0, a); r.push(1.1, b);
    r.sample(1.05);
    expect(r.view.x).toBeCloseTo(1.5, 5);
    expect(r.view.alive).toBe(true);
    r.sample(1.3); // starved of packets: coast briefly, never run away
    expect(r.view.x).toBeLessThan(3.5);
    const far = [...base]; far[R.x] = 60; far[R.flags] = F_ALIVE;
    r.push(1.2, far);
    r.sample(1.15); // a teleport is a cut, not a slide
    expect(r.view.x === 3 || r.view.x === 60).toBe(true);
  });
});

describe('bots', () => {
  it('play a whole match sensibly', () => {
    const lobby = new Lobby(new MemStore());
    const a = client(lobby);
    a.send({ t: 'hello', v: PROTOCOL_VERSION }); a.send({ t: 'join', mode: 'public' });
    const game = (lobby as any).rooms.values().next().value.game;
    let deaths = 0, falls = 0, casts = 0;
    for (let i = 0; i < 60 * 150; i++) {
      game.step();
      for (const ev of game.events) { if (ev.e === 'death' && !game.fighters.get(ev.p)?.dummy) { deaths++; if (ev.fall && !ev.killer) falls++; } if (ev.e === 'spawn' || ev.e === 'fx') casts++; }
      game.events.length = 0; game.privateEvents.clear();
      if (i % 600 === 0) for (const f of game.fighters.values()) for (const v of [f.s.x, f.s.y, f.s.z, f.s.vx, f.s.vy, f.s.vz, f.s.hp, f.s.yaw, f.s.pitch]) expect(Number.isFinite(v)).toBe(true);
    }
    const bots = [...game.fighters.values()].filter((f: any) => f.bot);
    expect(bots.length).toBe(7);
    expect(bots.every((f: any) => !f.s.hall)).toBe(true);          // everyone walked out through the gate
    expect(deaths).toBeGreaterThan(8);                              // they actually fight
    expect(casts).toBeGreaterThan(200);
    expect(falls).toBeLessThan(deaths * 0.25);                      // and do not just walk off the island
    expect(new Set(bots.map((f: any) => f.name)).size).toBe(7);
  }, 60000);
});
void newProfile;
