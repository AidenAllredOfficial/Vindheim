// Regressions for defects found in review: each test pins one rule that was once broken.
import { describe, expect, it } from 'vitest';
import { Lobby, type Conn, type ProfileStore } from '../shared/net/lobby';
import { PROTOCOL_VERSION, type ServerMsg } from '../shared/net/protocol';
import { ELEMENT_ORDER } from '../shared/elements';
import { BTN_A1, BTN_JUMP, BTN_MELEE, BTN_MOVE, DT, MAX_HP, MOVE_SPEED, MV_GLIDE, MV_NONE, type Input, type Profile } from '../shared/types';
import { Game, type Fighter } from '../shared/sim/game';
import { HALL, World } from '../shared/world';
import { createPlayerState, stepPlayer } from '../shared/sim/player';
import { ClientState } from '../client/src/core/state';
import { Rng } from '../shared/math';

const el = (id: string) => ELEMENT_ORDER.indexOf(id as any);
class MemStore implements ProfileStore {
  data = new Map<string, Profile>(); n = 0;
  load(t: string) { return this.data.get(t) ?? null; }
  save(t: string, p: Profile) { this.data.set(t, JSON.parse(JSON.stringify(p))); }
  newToken() { return (++this.n).toString(16).padStart(32, '0'); }
}
function liveGame(seed = 9) {
  const glory = new Map<number, number>();
  const stats: Record<string, number> = {};
  const game = new Game({ bots: false, population: 0, seed }, { onGlory: (f, n) => glory.set(f.s.id, (glory.get(f.s.id) || 0) + n), onStat: (_f, k, v) => { stats[k] = (stats[k] || 0) + v; } });
  while (game.match.phase !== 'live') game.step();
  const events: any[] = [];
  const step = (n = 1) => { for (let i = 0; i < n; i++) { game.step(); events.push(...game.events); game.events = []; game.privateEvents.clear(); } };
  const place = (f: Fighter, x: number, z: number, yaw = 0) => {
    const s = f.s; s.x = x; s.z = z; s.y = game.world.topAt(x, z); s.vx = s.vy = s.vz = 0; s.yaw = s.face = yaw; s.hall = false; s.onGround = true; s.inv = 0;
    for (let i = 0; i < 32; i++) { f.hist[i * 3] = s.x; f.hist[i * 3 + 1] = s.y; f.hist[i * 3 + 2] = s.z; }
  };
  return { game, events, step, place, glory, stats };
}

describe('hall membership', () => {
  it('an arena fighter knocked north across the hall line still dies (no free redeploy)', () => {
    const t = liveGame();
    const a = t.game.addFighter('A', false, el('gale')), b = t.game.addFighter('B', false, el('ember'));
    t.place(a, 0, -50); t.place(b, 0, -58);
    b.s.hp = 40;
    t.game.hit(b, a, { dmg: 5, kb: 3, lift: 2 }, 'gale_melee', 0, -1, 0, 0, 0);
    // flung far to the north, past z = -100, out over the void between the islands
    b.s.x = 0; b.s.z = -104; b.s.y = -8; b.s.vz = -6; b.s.vy = -4; b.s.onGround = false;
    t.step(120);
    const death = t.events.find((e) => e.e === 'death' && e.p === b.s.id);
    expect(death).toBeDefined();
    expect(death.fall).toBe(1); expect(death.killer).toBe(a.s.id);
    expect(t.events.some((e) => e.e === 'tp' && e.k === 'deploy' && e.p === b.s.id)).toBe(false);
  });

  it('leaving the hall island with a movement ability is a deploy, not a death', () => {
    for (const element of ['stone', 'tide', 'frost', 'ember', 'dawn']) {
      const t = liveGame();
      const f = t.game.addFighter('F', false, el(element));
      // stand at the southern lip of the hall island, facing the arena, and use the signature
      f.s.x = 14; f.s.z = -118; f.s.y = t.game.world.topAt(14, -118); f.s.onGround = true;
      let seq = 0;
      for (let i = 0; i < 240 && f.s.hall; i++) {
        t.game.pushInput(f.s.id, { seq: ++seq, mx: 0, mz: 1, yaw: Math.PI, pitch: 0.1, b: i < 3 ? BTN_MOVE : 0 });
        t.step();
      }
      expect(f.s.hall, element).toBe(false);
      expect(f.s.alive, element).toBe(true);
      expect(f.deaths, element).toBe(0);
      expect(t.events.some((e) => e.e === 'tp' && e.k === 'deploy'), element).toBe(true);
    }
  });

  it('things cast in the hall do not follow their owner into the arena', () => {
    const t = liveGame();
    const f = t.game.addFighter('F', false, el('frost'));
    let seq = 0;
    // etch a rime rune on the hall floor (it would otherwise live for 25 s)
    for (let i = 0; i < 40; i++) { t.game.pushInput(f.s.id, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: -0.4, b: i < 3 ? 16 : 0 }); t.step(); }
    expect([...t.game.ents.values()].some((e) => e.o === f.s.id)).toBe(true);
    t.game.deploy(f.s.id);
    expect([...t.game.ents.values()].some((e) => e.o === f.s.id)).toBe(false);
  });
});

describe('the Skygate between matches', () => {
  it('is a wall for server and client alike', () => {
    const game = new Game({ bots: false, population: 0, seed: 2 });
    expect(game.match.phase).toBe('intermission');
    const f = game.addFighter('F', false, 0);
    f.s.x = 0; f.s.z = HALL.gate.z - 4; f.s.y = game.world.topAt(0, HALL.gate.z - 4); f.s.onGround = true;
    const cs = new ClientState();
    cs.reset(f.s.id); cs.setGateSealed(true);
    Object.assign(cs.me, JSON.parse(JSON.stringify(f.s)));
    for (let i = 1; i <= 120; i++) {
      const inp: Input = { seq: i, mx: 0, mz: 1, yaw: Math.PI, pitch: 0, b: 0 };
      game.pushInput(f.s.id, inp); game.step();
      stepPlayer(cs.me, inp, cs.world, DT);
    }
    expect(f.s.hall).toBe(true);
    expect(f.s.z).toBeLessThan(HALL.gate.z - 0.7);          // stopped at the barrier
    expect(cs.me.z).toBeCloseTo(f.s.z, 6);                   // and prediction agrees exactly
    while (game.match.phase !== 'live') game.step();
    for (let i = 121; i <= 220 && f.s.hall; i++) { game.pushInput(f.s.id, { seq: i, mx: 0, mz: 1, yaw: Math.PI, pitch: 0, b: 0 }); game.step(); }
    expect(f.s.hall).toBe(false);                            // open once the match is live
  });
});

describe('server-side fairness', () => {
  it('sending inputs twice as fast does not make you faster', () => {
    const run = (perTick: number) => {
      const t = liveGame();
      const f = t.game.addFighter('F', false, el('ember'));
      t.place(f, -30, 12);
      // a long cooldown is a clock: it only runs down when the fighter is stepped
      f.s.cd[3] = 100; let seq = 0;
      for (let i = 0; i < 180; i++) { for (let k = 0; k < perTick; k++) t.game.pushInput(f.s.id, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0 }); t.step(); }
      return (100 - f.s.cd[3]) / DT; // simulation steps taken in 180 ticks
    };
    const honest = run(1), cheat = run(2);
    expect(honest).toBeCloseTo(180, 0);
    expect(cheat).toBeLessThan(180 * 1.1);
  });

  it('bursty input (a client at a low frame rate) is neither sped up nor starved', () => {
    const t = liveGame();
    const f = t.game.addFighter('F', false, el('ember'));
    t.place(f, -30, 12);
    f.s.cd[3] = 100; let seq = 0;
    for (let i = 0; i < 360; i++) { if (i % 5 === 0) for (let k = 0; k < 5; k++) t.game.pushInput(f.s.id, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0 }); t.step(); }
    const steps = (100 - f.s.cd[3]) / DT;
    expect(steps).toBeGreaterThan(360 * 0.99); expect(steps).toBeLessThan(360 * 1.02);
    expect(f.ack).toBeGreaterThan(seq - 7);        // every input was used, none starved
    expect(f.queue.length).toBeLessThanOrEqual(6);
  });

  it('claiming a huge ping does not extend melee reach', () => {
    const t = liveGame();
    const a = t.game.addFighter('A', false, el('ember')), b = t.game.addFighter('B', false, el('ember'));
    t.place(a, -30, 12, 0); t.place(b, -30, 9.6, Math.PI);
    a.ping = 999;
    let seq = 0, sb = 0;
    // b sprints away for half a second, then a swings at where b used to be
    for (let i = 0; i < 34; i++) { t.game.pushInput(b.s.id, { seq: ++sb, mx: 0, mz: -1, yaw: Math.PI, pitch: 0, b: 0 }); t.game.pushInput(a.s.id, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0 }); t.step(); }
    expect(a.s.z - b.s.z).toBeGreaterThan(5);
    for (let i = 0; i < 40; i++) { t.game.pushInput(b.s.id, { seq: ++sb, mx: 0, mz: -1, yaw: Math.PI, pitch: 0, b: 0 }); t.game.pushInput(a.s.id, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, b: i < 2 ? BTN_MELEE : 0 }); t.step(); }
    expect(b.s.hp).toBe(MAX_HP);
  });

  it('pays no placement glory without opposition or without landing a hit', () => {
    const t = liveGame();
    const f = t.game.addFighter('Solo', false, 0);
    t.game.deploy(f.s.id);
    f.s.inv = 0; f.s.x = 0; f.s.z = 85; f.s.y = -40; // walk off the edge once
    t.step(10);
    expect(f.deaths).toBe(1);
    t.game.match.timeLeft = 0.01; t.step(2);
    expect(t.game.match.phase).toBe('results');
    expect(t.glory.get(f.s.id) || 0).toBe(0);
    expect(t.stats.wins || 0).toBe(0);
    expect(t.game.resultsFor(f)!.you!.bonus).toBe(0);
  });
});

describe('prediction is exact', () => {
  it('replaying from a snapshot reproduces the server bit for bit, for every element', () => {
    for (const element of ELEMENT_ORDER) {
      const lobby = new Lobby(new MemStore());
      const inbox: ServerMsg[] = [];
      const conn: Conn = { send: (m) => inbox.push(JSON.parse(JSON.stringify(m))) };
      lobby.connect(conn);
      lobby.receive(conn, { t: 'hello', v: PROTOCOL_VERSION });
      lobby.receive(conn, { t: 'join', mode: 'create', bots: false });
      const joined = inbox.find((m) => m.t === 'joined') as Extract<ServerMsg, { t: 'joined' }>;
      const game: Game = (lobby as any).rooms.values().next().value.game;
      game.setTrial(joined.you, el(element));
      const cs = new ClientState();
      cs.reset(joined.you); cs.setRoster(joined.roster); cs.setGateSealed(true);
      const rng = new Rng(77 + el(element));
      const LAT = 4;
      const up: number[][] = [], down: ServerMsg[][] = [];
      let read = inbox.length, now = 0, worst = 0, corrections = 0, snaps = 0;
      let mx = 0, mz = 1, yaw = 0, b = 0;
      for (let i = 0; i < 1500; i++) {
        now += DT;
        if (i % 20 === 0) { mx = Math.round(rng.range(-1, 1) * 100) / 100; mz = Math.round(rng.range(-0.4, 1) * 100) / 100; yaw = Math.round(rng.range(-3, 3) * 1e4) / 1e4; }
        b = (rng.chance(0.03) ? BTN_JUMP : 0) | (rng.chance(0.02) ? BTN_MELEE : 0) | (rng.chance(0.02) ? BTN_A1 : 0) | (rng.chance(0.012) ? BTN_MOVE : 0);
        const inp = cs.tick({ mx, mz, b }, yaw, 0.05, {});
        up.push([inp.seq, inp.mx, inp.mz, inp.yaw, inp.pitch, inp.b]);
        if (up.length > LAT) lobby.receive(conn, { t: 'in', i: [up.shift()!] });
        lobby.tick();
        down.push(inbox.slice(read)); read = inbox.length;
        if (down.length > LAT) for (const m of down.shift()!) {
          if (m.t !== 's') continue;
          // the match going live opens the gate; the client learns it from the match message
          cs.setGateSealed(game.match.phase !== 'live');
          const px = cs.me.x, py = cs.me.y, pz = cs.me.z;
          cs.onSnapshot(m.k, m.a, m.me, m.p, now);
          const err = Math.hypot(cs.me.x - px, cs.me.y - py, cs.me.z - pz);
          snaps++; if (err > 1e-6) corrections++; if (err > worst) worst = err;
        }
        // keep the test in the hall: a deploy is a server-side teleport no client could predict
        if (!game.fighters.get(joined.you)!.s.hall) break;
      }
      expect(snaps, element).toBeGreaterThan(100);
      // (the only tolerated corrections are the handful around the gate opening / a rampart rising)
      expect(corrections, `${element}: ${corrections} corrections in ${snaps} snapshots, worst ${worst.toFixed(4)} m`).toBeLessThanOrEqual(3);
    }
  }, 60000);
});

describe('movement signatures leave you free to act', () => {
  const world = new World();
  const spawn = (element: string) => { const p = createPlayerState(1); p.x = -30; p.z = 10; p.y = world.topAt(-30, 10); p.onGround = true; p.hall = false; p.el = el(element); return p; };
  const input = (o: Partial<Input> = {}): Input => ({ seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0, ...o });

  it('jumping out of Glacier Glide returns control immediately', () => {
    const p = spawn('frost');
    stepPlayer(p, input({ b: BTN_MOVE }), world, DT);
    for (let i = 0; i < 20; i++) stepPlayer(p, input({ mz: 1 }), world, DT);
    expect(p.mv).toBe(MV_GLIDE);
    stepPlayer(p, input({ mz: 1, b: BTN_JUMP }), world, DT);
    expect(p.mv).toBe(MV_NONE);
    for (let i = 0; i < 60; i++) stepPlayer(p, input({ mz: 1 }), world, DT); // land
    expect(p.onGround).toBe(true);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(MOVE_SPEED * 0.9); // still running, not rooted
    stepPlayer(p, input({ mz: 1, b: BTN_MELEE }), world, DT);
    expect(p.act).toBe(0);
  });

  it('you can attack while gliding and while soaring', () => {
    const frost = spawn('frost');
    stepPlayer(frost, input({ b: BTN_MOVE }), world, DT);
    for (let i = 0; i < 12; i++) stepPlayer(frost, input(), world, DT);
    stepPlayer(frost, input({ b: BTN_A1 }), world, DT);
    expect(frost.mv).toBe(MV_GLIDE); expect(frost.act).toBe(1);
    const gale = spawn('gale');
    stepPlayer(gale, input({ b: BTN_MOVE }), world, DT);
    for (let i = 0; i < 20; i++) stepPlayer(gale, input(), world, DT);
    expect(gale.onGround).toBe(false);
    stepPlayer(gale, input({ b: BTN_A1 }), world, DT);
    expect(gale.act).toBe(1);
  });
});
