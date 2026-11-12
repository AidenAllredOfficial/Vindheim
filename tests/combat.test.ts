import { describe, expect, it } from 'vitest';
import { ELEMENT_ORDER, ELEMENTS } from '../shared/elements';
import {
  BTN_A1, BTN_A2, BTN_A3, BTN_MELEE, DT, GLORY_PER_KILL, MATCH_KILL_TARGET, MAX_HP, SLOT_BUTTON,
  type GameEvent, type Input,
} from '../shared/types';
import { Game, type Fighter } from '../shared/sim/game';
import { VOID } from '../shared/world';

const el = (id: string) => ELEMENT_ORDER.indexOf(id as any);

/** A room with no bots, already in a live match, plus helpers to drive fighters by hand. */
function arena(seed = 7) {
  const glory = new Map<number, number>();
  const stats: Record<string, number> = {};
  const game = new Game({ bots: false, population: 0, seed }, {
    onGlory: (f, n) => glory.set(f.s.id, (glory.get(f.s.id) || 0) + n),
    onStat: (_f, k, v) => { stats[k] = (stats[k] || 0) + v; },
  });
  const events: GameEvent[] = [];
  const priv: GameEvent[] = [];
  const seq = new Map<number, number>();
  const step = (inputs: [Fighter, Partial<Input>][] = []) => {
    for (const [f, i] of inputs) {
      const n = (seq.get(f.s.id) || 0) + 1; seq.set(f.s.id, n);
      game.pushInput(f.s.id, { seq: n, mx: 0, mz: 0, yaw: f.s.yaw, pitch: f.s.pitch, b: 0, ...i });
    }
    game.step();
    events.push(...game.events); game.events = [];
    for (const arr of game.privateEvents.values()) priv.push(...arr);
    game.privateEvents.clear();
  };
  const run = (seconds: number, inputs: () => [Fighter, Partial<Input>][] = () => []) => { for (let i = 0; i < Math.round(seconds / DT); i++) step(inputs()); };
  // skip the opening intermission
  while (game.match.phase !== 'live') step();
  const place = (f: Fighter, x: number, z: number, yaw = 0) => {
    const s = f.s;
    s.x = x; s.z = z; s.y = game.world.topAt(x, z); s.vx = s.vy = s.vz = 0; s.yaw = yaw; s.face = yaw; s.pitch = 0;
    s.hall = false; s.onGround = true; s.inv = 0; s.alive = true; s.hp = MAX_HP;
    for (let i = 0; i < 32; i++) { f.hist[i * 3] = s.x; f.hist[i * 3 + 1] = s.y; f.hist[i * 3 + 2] = s.z; }
  };
  const add = (name: string, element: string, x: number, z: number, yaw = 0) => { const f = game.addFighter(name, false, el(element)); place(f, x, z, yaw); return f; };
  const flush = () => { events.push(...game.events); game.events = []; for (const arr of game.privateEvents.values()) priv.push(...arr); game.privateEvents.clear(); };
  const of = <K extends GameEvent['e']>(k: K) => (flush(), events).filter((e) => e.e === k) as Extract<GameEvent, { e: K }>[];
  return { game, events, priv, step, run, add, place, of, glory, stats };
}

// Two fighters facing each other on the open meadow west of the centre: a at x, b 2 m north of a.
const AX = -30, AZ = 12;

describe('melee', () => {
  it('hits a foe in front, flinches them and knocks them back', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 2.2, Math.PI);
    t.step([[a, { b: BTN_MELEE }]]);
    t.run(0.4, () => [[a, {}], [b, {}]]);
    const hits = t.of('hit').filter((h) => h.k === 'ember_melee');
    expect(hits.length).toBe(1);
    expect(hits[0].t).toBe(b.s.id); expect(hits[0].s).toBe(a.s.id);
    expect(b.s.hp).toBeLessThan(MAX_HP);
    expect(b.s.burn).toBeGreaterThan(0);          // Brand Cleave ignites
    expect(b.s.z).toBeLessThan(AZ - 2.2);         // shoved north, away from the attacker
  });

  it('whiffs on a foe behind the attacker', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ + 2.2);
    t.step([[a, { b: BTN_MELEE }]]);
    t.run(0.5, () => [[a, {}]]);
    expect(t.of('hit').length).toBe(0);
    expect(b.s.hp).toBe(MAX_HP);
  });

  it('an interrupted wind-up deals no damage', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ, 0), b = t.add('B', 'storm', AX, AZ - 2.2, Math.PI);
    // Hammer-slow ember swing (0.26 s) vs the fastest jab on the island (0.19 s), started together
    t.step([[a, { b: BTN_MELEE }], [b, { b: BTN_MELEE }]]);
    t.run(0.5, () => [[a, {}], [b, {}]]);
    expect(a.s.hp).toBeLessThan(MAX_HP);
    expect(b.s.hp).toBe(MAX_HP);
  });

  it('heavy hits launch; knockback grows as health drops', () => {
    const far = (hp: number) => {
      const t = arena();
      const a = t.add('A', 'gale', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 2.2, Math.PI);
      b.s.hp = hp;
      t.step([[a, { b: BTN_MELEE }]]);
      t.run(0.3, () => [[a, {}]]);
      expect(b.s.launched || b.s.down > 0).toBe(true);
      t.run(2);
      return AZ - 2.2 - b.s.z;
    };
    const healthy = far(100), hurt = far(30);
    expect(healthy).toBeGreaterThan(4);
    expect(hurt).toBeGreaterThan(healthy * 1.25);
  });

  it("Stone's armoured wind-up shrugs off light hits but not heavy ones", () => {
    const t = arena();
    const a = t.add('A', 'stone', AX, AZ, 0), b = t.add('B', 'storm', AX, AZ - 2.2, Math.PI);
    t.step([[a, { b: BTN_MELEE }], [b, { b: BTN_MELEE }]]);
    t.run(0.6, () => [[a, {}], [b, {}]]);
    expect(a.s.hp).toBeLessThan(MAX_HP);   // the jab still hurt
    expect(b.s.hp).toBeLessThan(MAX_HP);   // … but the hammer came down anyway
    expect(t.of('hit').some((h) => h.k === 'stone_melee' && h.heavy === 1)).toBe(true);
  });

  it('Umbra backstabs from behind for bonus damage', () => {
    const front = arena(), back = arena();
    for (const [t, yawB] of [[front, Math.PI], [back, 0]] as [ReturnType<typeof arena>, number][]) {
      const a = t.add('A', 'umbra', AX, AZ, 0); t.add('B', 'ember', AX, AZ - 2.0, yawB);
      t.step([[a, { b: BTN_MELEE }]]);
      t.run(0.4, () => [[a, {}]]);
    }
    const f = front.of('hit')[0], b = back.of('hit')[0];
    expect(f.crit).toBe(0);
    expect(b.crit).toBe(1); expect(b.heavy).toBe(1);
    expect(b.dmg).toBeGreaterThan(f.dmg * 1.5);
  });
});

describe('projectiles, beams and areas', () => {
  it('a fireball flies, hits, burns and splashes bystanders', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 14, Math.PI), c = t.add('C', 'ember', AX + 1.6, AZ - 14, Math.PI);
    a.bot = true; // aim straight from the chest (no camera offset) so the test is exact
    t.step([[a, { b: BTN_A1 }]]);
    a.s.act = 1; // (bots do not use the input queue; start the cast by hand)
    for (let i = 0; i < 80; i++) { a.input = { seq: i, mx: 0, mz: 0, yaw: 0, pitch: 0, b: i === 0 ? BTN_A1 : 0 }; a.brain = null; t.step(); }
    expect(t.of('spawn').some((s) => s.k === 'fireball')).toBe(true);
    expect(t.of('despawn').some((d) => d.why === 2)).toBe(true);
    expect(b.s.hp).toBeLessThan(MAX_HP);
    expect(c.s.hp).toBeLessThan(MAX_HP); // splash
    expect(c.s.hp).toBeGreaterThan(b.s.hp);
  });

  it('a rampart stops projectiles and disappears on time', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ, 0), b = t.add('B', 'stone', AX, AZ - 14, Math.PI);
    a.bot = true; a.brain = null; b.bot = true; b.brain = null;
    b.input = { seq: 1, mx: 0, mz: 0, yaw: Math.PI, pitch: 0, b: BTN_A2 };
    t.run(0.5); b.input = { ...b.input, b: 0 };
    const wall = [...t.game.ents.values()].find((e) => e.k === 'rampart');
    expect(wall).toBeDefined();
    expect(t.game.world.dyn.length).toBe(1);
    a.input = { seq: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, b: BTN_A1 };
    t.run(0.2); a.input = { ...a.input, b: 0 };
    t.run(1.2);
    expect(b.s.hp).toBe(MAX_HP);
    expect(t.of('despawn').some((d) => d.why === 1)).toBe(true);
    t.run(7);
    expect(t.game.world.dyn.length).toBe(0);
  });

  it('Arc Bolt is instant and chains to a second foe', () => {
    const t = arena();
    const a = t.add('A', 'storm', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 12, Math.PI), c = t.add('C', 'ember', AX + 4, AZ - 13, Math.PI);
    a.bot = true; a.brain = null;
    a.input = { seq: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, b: BTN_A1 };
    t.run(0.2);
    const hits = t.of('hit').filter((h) => h.k === 'arcbolt');
    expect(hits.map((h) => h.t).sort()).toEqual([b.s.id, c.s.id].sort());
    expect(hits.find((h) => h.t === c.s.id)!.dmg).toBeLessThan(hits.find((h) => h.t === b.s.id)!.dmg);
    expect(t.of('fx').filter((f) => f.k === 'arcbolt').length).toBe(2);
  });

  it('a meteor lands after its fuse and can be walked out of', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 12, Math.PI), c = t.add('C', 'ember', AX + 2.5, AZ - 12, Math.PI);
    a.bot = true; a.brain = null;
    // aim at the ground under b, 12 m ahead
    a.input = { seq: 1, mx: 0, mz: 0, yaw: 0, pitch: Math.atan2(b.s.y - (a.s.y + 1.1), 12), b: BTN_A3 };
    t.run(0.6); a.input = { ...a.input, b: 0 };
    const strike = [...t.game.ents.values()].find((e) => e.k === 'meteor')!;
    expect(strike).toBeDefined();
    expect(Math.hypot(strike.x - AX, strike.z - (AZ - 12))).toBeLessThan(1.5);
    expect(b.s.hp).toBe(MAX_HP); // not yet
    // c runs out of the circle, b stands still
    t.run(1.1, () => [[c, { mx: -1, yaw: Math.PI }]]); // (facing south, strafing left = east, away from the mark)
    expect(b.s.hp).toBeLessThan(MAX_HP - 20);
    expect(c.s.hp).toBe(MAX_HP);
    expect([...t.game.ents.values()].some((e) => e.k === 'firepatch')).toBe(true);
  });

  it('a rime rune freezes whoever steps on it; the next hit shatters for bonus damage', () => {
    const t = arena();
    const a = t.add('A', 'frost', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 14, Math.PI);
    a.bot = true; a.brain = null;
    a.input = { seq: 1, mx: 0, mz: 0, yaw: 0, pitch: Math.atan2(-1.25, 7), b: BTN_A3 };
    t.run(0.5); a.input = { ...a.input, b: 0 };
    t.run(1.0);
    expect([...t.game.ents.values()].some((e) => e.k === 'rimerune')).toBe(true);
    t.run(1.4, () => [[b, { mz: 1, yaw: Math.PI }]]); // b walks south onto it
    expect(b.s.freeze).toBeGreaterThan(0);
    const hp = b.s.hp;
    t.game.hit(b, a, { dmg: 10, kb: 5, lift: 2 }, 'test', 0, -1, b.s.x, b.s.y + 1, b.s.z);
    expect(hp - b.s.hp).toBeCloseTo(13, 5);
    expect(b.s.freeze).toBe(0);
    expect(t.of('pop').some((p) => p.k === 'freeze')).toBe(true);
  });

  it('four stacks of chill freeze', () => {
    const t = arena();
    const a = t.add('A', 'frost', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 6, Math.PI);
    for (let i = 0; i < 3; i++) t.game.hit(b, a, { dmg: 1, kb: 0, lift: 0, status: [{ k: 'chill', t: 3.5, n: 1 }] }, 'test', 0, -1, 0, 0, 0);
    expect(b.s.chill).toBe(3); expect(b.s.freeze).toBe(0);
    t.game.hit(b, a, { dmg: 1, kb: 0, lift: 0, status: [{ k: 'chill', t: 3.5, n: 1 }] }, 'test', 0, -1, 0, 0, 0);
    expect(b.s.freeze).toBeGreaterThan(0); expect(b.s.chill).toBe(0);
  });

  it('burning deals damage over time and credits the arsonist', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 20, Math.PI);
    t.game.hit(b, a, { dmg: 5, kb: 0, lift: 0, status: [{ k: 'burn', t: 3 }] }, 'test', 0, -1, 0, 0, 0);
    const hp = b.s.hp;
    t.run(3.3);
    expect(hp - b.s.hp).toBeGreaterThan(7); expect(hp - b.s.hp).toBeLessThan(11);
    expect(t.of('hit').filter((h) => h.k === 'burn').every((h) => h.s === a.s.id)).toBe(true);
  });

  it('a bubble lifts its victim and pops on the next hit', () => {
    const t = arena();
    const a = t.add('A', 'tide', AX, AZ, 0), b = t.add('B', 'ember', AX, AZ - 6, Math.PI);
    const y0 = b.s.y;
    t.game.hit(b, a, ELEMENTS.tide.abilities[2].fx.t === 'proj' ? (ELEMENTS.tide.abilities[2].fx as any).hit : { dmg: 0, kb: 0, lift: 0 }, 'bubble', 0, -1, 0, 0, 0);
    expect(b.s.bubble).toBeGreaterThan(0);
    t.run(1, () => [[b, { mz: 1, b: BTN_MELEE }]]);
    expect(b.s.y).toBeGreaterThan(y0 + 1);
    expect(b.s.act).toBe(-1);
    t.game.hit(b, a, { dmg: 8, kb: 6, lift: 3 }, 'test', 0, -1, 0, 0, 0);
    expect(b.s.bubble).toBe(0);
    expect(t.of('pop').some((p) => p.k === 'bubble')).toBe(true);
  });
});

describe('rules', () => {
  it('nobody can be hurt in the hall — except the training dummies', () => {
    const t = arena();
    const a = t.game.addFighter('A', false, el('ember')), b = t.game.addFighter('B', false, el('ember'));
    expect(a.s.hall && b.s.hall).toBe(true);
    expect(t.game.hit(b, a, { dmg: 20, kb: 5, lift: 2 }, 'test', 1, 0, 0, 0, 0)).toBe(false);
    expect(b.s.hp).toBe(MAX_HP);
    const dummy = [...t.game.fighters.values()].find((f) => f.dummy)!;
    expect(t.game.hit(dummy, a, { dmg: 20, kb: 5, lift: 2 }, 'test', 1, 0, 0, 0, 0)).toBe(true);
    expect(dummy.s.hp).toBe(MAX_HP - 20);
    expect(t.glory.get(a.s.id) || 0).toBe(0); // no glory from dummies
    t.run(4);
    expect(dummy.s.hp).toBe(MAX_HP); // they reset
  });

  it('spawn protection and get-up invulnerability block hits', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ), b = t.add('B', 'ember', AX, AZ - 3);
    b.s.inv = 1;
    expect(t.game.hit(b, a, { dmg: 20, kb: 5, lift: 2 }, 'test', 1, 0, 0, 0, 0)).toBe(false);
  });

  it('a fall into the cloud sea credits the last attacker with a ring-out', () => {
    const t = arena();
    const a = t.add('A', 'gale', AX, AZ), b = t.add('B', 'ember', 0, 50);
    t.game.hit(b, a, { dmg: 5, kb: 3, lift: 2 }, 'gale_melee', 0, 1, 0, 0, 0);
    b.s.x = 0; b.s.z = 80; b.s.y = 0; b.s.onGround = false; // well past the southern rim
    expect(t.game.world.terrainHeight(b.s.x, b.s.z)).toBe(VOID);
    t.run(3);
    const death = t.of('death')[0];
    expect(death.p).toBe(b.s.id); expect(death.killer).toBe(a.s.id); expect(death.fall).toBe(1);
    expect(a.kills).toBe(1); expect(b.deaths).toBe(1);
    expect(t.glory.get(a.s.id)).toBeGreaterThanOrEqual(GLORY_PER_KILL);
    expect(t.stats.ringouts).toBe(1);
    expect(t.of('announce').some((x) => x.k === 'firstblood')).toBe(true);
    // … and the victim comes back
    while (!b.s.alive) t.step();
    expect(b.s.hp).toBe(MAX_HP); expect(b.s.inv).toBeGreaterThan(0); expect(b.s.hall).toBe(false);
  });

  it('glory is paid for damage and kills', () => {
    const t = arena();
    const a = t.add('A', 'ember', AX, AZ), b = t.add('B', 'ember', AX, AZ - 3);
    t.game.hit(b, a, { dmg: 60, kb: 0, lift: 0 }, 'test', 1, 0, 0, 0, 0);
    t.run(1);
    expect(t.glory.get(a.s.id)).toBe(30);
    t.game.hit(b, a, { dmg: 60, kb: 0, lift: 0 }, 'test', 1, 0, 0, 0, 0);
    t.run(1);
    expect(b.s.alive).toBe(false);
    expect(t.glory.get(a.s.id)).toBe(30 + 20 + GLORY_PER_KILL);
    expect(t.priv.filter((e) => e.e === 'glory').length).toBeGreaterThanOrEqual(3);
  });

  it('deploying drops you into the arena; returning needs a lull in the fight', () => {
    const t = arena();
    const a = t.game.addFighter('A', false, el('ember')), b = t.add('B', 'ember', AX, AZ);
    expect(t.game.deploy(a.s.id)).toBe(true);
    expect(a.s.hall).toBe(false);
    expect(t.of('tp').some((e) => e.k === 'deploy' && e.p === a.s.id)).toBe(true);
    t.run(2.5);
    expect(a.s.onGround).toBe(true);
    a.s.inv = 0;
    t.game.hit(a, b, { dmg: 5, kb: 1, lift: 0 }, 'test', 1, 0, 0, 0, 0);
    expect(t.game.toHall(a.s.id)).toBe(false);
    t.run(4);
    expect(t.game.toHall(a.s.id)).toBe(true);
    expect(a.s.hall).toBe(true); expect(a.s.hp).toBe(MAX_HP);
  });

  it('trial elements only last while in the hall', () => {
    const t = arena();
    const a = t.game.addFighter('A', false, el('ember'));
    t.game.setTrial(a.s.id, el('dawn'));
    expect(a.s.el).toBe(el('dawn'));
    t.game.deploy(a.s.id);
    expect(a.s.el).toBe(el('ember'));
    t.game.setTrial(a.s.id, el('dawn')); // ignored outside the hall
    expect(a.s.el).toBe(el('ember'));
  });

  it('walking through the Skygate deploys', () => {
    const t = arena();
    const a = t.game.addFighter('A', false, el('ember'));
    a.s.x = 0; a.s.z = -123; a.s.y = t.game.world.topAt(0, -123);
    t.run(1.5, () => [[a, { mz: 1, yaw: Math.PI }]]); // walk south through the gate
    expect(a.s.hall).toBe(false);
  });
});

describe('match loop', () => {
  it('runs intermission -> live -> results -> intermission and pays placement glory', () => {
    const glory = new Map<number, number>();
    let ended = 0;
    const game = new Game({ bots: false, population: 0, seed: 3 }, { onGlory: (f, n, why) => { if (why === 'place' || why === 'match') glory.set(f.s.id, (glory.get(f.s.id) || 0) + n); }, onMatchEnd: () => ended++ });
    const a = game.addFighter('A', false, 0), b = game.addFighter('B', false, 0);
    expect(game.match.phase).toBe('intermission');
    expect(game.deploy(a.s.id)).toBe(false); // gate sealed
    while (game.match.phase === 'intermission') game.step();
    expect(game.match.phase).toBe('live');
    game.deploy(a.s.id); game.deploy(b.s.id);
    for (let k = 0; k < MATCH_KILL_TARGET; k++) {
      b.s.inv = 0; b.s.alive = true; b.s.hp = 10; b.s.hall = false;
      game.hit(b, a, { dmg: 50, kb: 0, lift: 0 }, 'test', 1, 0, 0, 0, 0);
    }
    expect(game.match.phase).toBe('results');
    expect(ended).toBe(1);
    const res = game.resultsFor(a)!;
    expect(res.standings[0].id).toBe(a.s.id);
    expect(res.you!.place).toBe(1);
    expect(glory.get(a.s.id)).toBeGreaterThan(0);
    expect(glory.get(b.s.id) || 0).toBe(0); // b never landed a hit: no participation pay
    while (game.match.phase === 'results') game.step();
    expect(game.match.phase).toBe('intermission');
    expect(a.s.hall && b.s.hall).toBe(true);
    expect(a.kills).toBe(0);
    expect(game.match.round).toBe(2);
  });

  it('keeps public rooms topped up with bots and thins them as people join', () => {
    const game = new Game({ bots: true, population: 8, seed: 5 });
    game.balanceBots();
    expect(game.botCount()).toBe(8);
    game.addFighter('Human', false, 0); game.balanceBots();
    expect(game.botCount()).toBe(7);
    for (let i = 0; i < 8; i++) game.addFighter('H' + i, false, 0);
    game.balanceBots();
    expect(game.botCount()).toBe(0);
  });
});

describe('every ability can be performed without errors', () => {
  for (const element of ELEMENT_ORDER) {
    it(element, () => {
      const t = arena(11);
      const a = t.add('A', element, AX, AZ, 0);
      const foes = [t.add('B', 'ember', AX, AZ - 2.4, Math.PI), t.add('C', 'ember', AX + 2, AZ - 9, Math.PI), t.add('D', 'ember', AX - 3, AZ - 16, Math.PI)];
      a.bot = true; a.brain = null;
      for (let slot = 0; slot < 5; slot++) {
        t.place(a, AX, AZ, 0);
        a.s.act = -1; a.s.stun = 0; a.s.launched = false; a.s.down = 0;
        for (let i = 0; i < 5; i++) a.s.cd[i] = 0;
        a.input = { seq: 1, mx: 0, mz: 0, yaw: 0, pitch: slot === 3 ? -0.12 : 0, b: SLOT_BUTTON[slot] };
        t.run(0.1); a.input = { ...a.input, b: 0 };
        t.run(3.4);
        for (const f of [a, ...foes]) {
          for (const v of [f.s.x, f.s.y, f.s.z, f.s.vx, f.s.vy, f.s.vz, f.s.hp]) expect(Number.isFinite(v)).toBe(true);
        }
      }
      // the kit as a whole must have connected with someone standing in front of it
      expect(t.of('hit').filter((h) => h.s === a.s.id).length).toBeGreaterThan(0);
      t.run(30);
      expect([...t.game.ents.values()].filter((e) => e.o === a.s.id).length).toBe(0); // nothing leaks
    });
  }
});
