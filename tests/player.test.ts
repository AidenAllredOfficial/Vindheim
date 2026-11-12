import { describe, expect, it } from 'vitest';
import { World, VOID } from '../shared/world';
import { ELEMENT_ORDER, ELEMENTS } from '../shared/elements';
import {
  BTN_A1, BTN_JUMP, BTN_MELEE, BTN_MOVE, DT, GRAVITY, JUMP_VELOCITY, MOVE_SPEED, MV_DASH, MV_GLIDE, MV_LEAP, MV_NONE, MV_SOAR,
  type Input, type PlayerState,
} from '../shared/types';
import { canUse, createPlayerState, stepPlayer, type StepHooks } from '../shared/sim/player';

const world = new World();
const el = (id: string) => ELEMENT_ORDER.indexOf(id as any);

function spawn(x = 20, z = 20, element = 'ember'): PlayerState {
  const p = createPlayerState(1);
  p.x = x; p.z = z; p.y = world.topAt(x, z); p.onGround = true; p.hall = false; p.el = el(element);
  return p;
}
function inp(over: Partial<Input> = {}): Input { return { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, b: 0, ...over }; }
function run(p: PlayerState, input: Input, seconds: number, hooks?: StepHooks) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepPlayer(p, input, world, DT, hooks);
}

describe('movement', () => {
  it('accelerates to run speed and stops', () => {
    const p = spawn();
    run(p, inp({ mz: 1 }), 1);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(MOVE_SPEED, 1);
    expect(p.vz).toBeLessThan(0); // yaw 0 looks toward -Z
    run(p, inp(), 0.5);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(0.01);
  });

  it('moves relative to the aim yaw', () => {
    const p = spawn();
    run(p, inp({ mz: 1, yaw: Math.PI / 2 }), 0.5);
    expect(p.vx).toBeLessThan(-MOVE_SPEED * 0.9); // yaw +90° looks toward -X
    const q = spawn();
    run(q, inp({ mx: 1 }), 0.5);
    expect(q.vx).toBeGreaterThan(MOVE_SPEED * 0.9); // strafe right = +X when looking at -Z
  });

  it('jumps to the expected height and lands', () => {
    const p = spawn();
    const y0 = p.y;
    let peak = 0, jumped = 0, landed = 0;
    const hooks: StepHooks = { onJump: () => jumped++, onLand: () => landed++ };
    stepPlayer(p, inp({ b: BTN_JUMP }), world, DT, hooks);
    for (let i = 0; i < 120; i++) { stepPlayer(p, inp(), world, DT, hooks); peak = Math.max(peak, p.y - y0); }
    expect(jumped).toBe(1);
    expect(landed).toBe(1);
    expect(peak).toBeCloseTo((JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY), 0);
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(y0, 1);
  });

  it('cannot walk through a standing stone', () => {
    const stone = world.colliders.find((c) => c.kind === 'monolith')!;
    const p = spawn(stone.x, stone.z + 6);
    p.y = world.ground(p.x, p.z, 50).y;
    run(p, inp({ mz: 1 }), 2); // walk north into it
    expect(Math.hypot(p.x - stone.x, p.z - stone.z)).toBeGreaterThanOrEqual(stone.hx + 0.44);
  });

  it('falls when it walks off the rim', () => {
    const p = spawn(0, 50);
    p.y = world.ground(0, 50, 50).y;
    run(p, inp({ mz: -1 }), 4); // back away to the south, over the edge
    expect(world.terrainHeight(p.x, p.z)).toBe(VOID);
    expect(p.onGround).toBe(false);
    expect(p.y).toBeLessThan(-10);
  });

  it('slides on the frozen lake', () => {
    const grass = spawn(-30, 10), ice = spawn(36, 4);
    run(grass, inp({ mz: 1 }), 0.25); run(ice, inp({ mz: 1 }), 0.25);
    expect(ice.ice).toBe(true);
    expect(Math.hypot(ice.vx, ice.vz)).toBeLessThan(Math.hypot(grass.vx, grass.vz) * 0.6);
  });

  it('is deterministic for identical inputs', () => {
    const a = spawn(), b = spawn();
    for (let i = 0; i < 400; i++) {
      const input = inp({ mz: Math.sin(i * 0.1), mx: Math.cos(i * 0.07), yaw: i * 0.02, pitch: Math.sin(i * 0.05) * 0.5, b: (i % 37 === 0 ? BTN_JUMP : 0) | (i % 53 === 0 ? BTN_MELEE : 0) | (i % 91 === 0 ? BTN_A1 : 0) | (i % 140 === 0 ? BTN_MOVE : 0) });
      stepPlayer(a, input, world, DT); stepPlayer(b, input, world, DT);
    }
    expect(a).toEqual(b);
  });
});

describe('actions', () => {
  it('commits to a melee swing: wind-up, one release, recovery, cooldown', () => {
    const p = spawn();
    const ab = ELEMENTS.ember.abilities[0];
    const releases: number[] = [];
    let starts = 0;
    const hooks: StepHooks = { onStart: () => starts++, onRelease: (s) => releases.push(s.actT) };
    stepPlayer(p, inp({ b: BTN_MELEE }), world, DT, hooks);
    expect(p.act).toBe(0);
    expect(starts).toBe(1);
    expect(p.cd[0]).toBeGreaterThan(0);
    run(p, inp(), ab.windup + ab.active + ab.recovery - 0.05, hooks);
    expect(p.act).toBe(0); // still committed
    expect(releases.length).toBe(1);
    expect(releases[0]).toBeGreaterThanOrEqual(ab.windup);
    expect(releases[0]).toBeLessThan(ab.windup + 2 * DT);
    run(p, inp(), 0.1, hooks);
    expect(p.act).toBe(-1);
  });

  it('fires a three-shard volley', () => {
    const p = spawn(20, 20, 'frost');
    let n = 0;
    const hooks: StepHooks = { onRelease: () => n++ };
    stepPlayer(p, inp({ b: BTN_A1 }), world, DT, hooks);
    run(p, inp(), 1, hooks);
    expect(n).toBe(3);
  });

  it('buffers a press made during another action', () => {
    const p = spawn();
    stepPlayer(p, inp({ b: BTN_MELEE }), world, DT);
    const ab = ELEMENTS.ember.abilities[0];
    run(p, inp(), ab.windup + ab.active + ab.recovery - 0.1);
    stepPlayer(p, inp({ b: BTN_A1 }), world, DT); // tap during recovery
    run(p, inp(), 0.12);
    expect(p.act).toBe(1);
  });

  it('refuses ground-only abilities in the air and anything while stunned', () => {
    const p = spawn();
    p.onGround = false; p.y += 5;
    expect(canUse(p, 3)).toBe(false); // meteor needs footing
    expect(canUse(p, 1)).toBe(true);
    p.stun = 0.3;
    expect(canUse(p, 1)).toBe(false);
  });

  it('a stun interrupts the action in progress', () => {
    const p = spawn();
    stepPlayer(p, inp({ b: BTN_MELEE }), world, DT);
    p.stun = 0.3;
    stepPlayer(p, inp(), world, DT);
    expect(p.act).toBe(-1);
  });
});

describe('movement signatures', () => {
  it('Cinder Dash covers its distance then returns control', () => {
    const p = spawn(-30, 10, 'ember');
    const x0 = p.x, z0 = p.z;
    stepPlayer(p, inp({ b: BTN_MOVE, mz: 1 }), world, DT);
    expect(p.mv).toBe(MV_DASH);
    run(p, inp({ mz: 1 }), 0.25);
    expect(p.mv).toBe(MV_NONE);
    const d = Math.hypot(p.x - x0, p.z - z0);
    expect(d).toBeGreaterThan(8); expect(d).toBeLessThan(12);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThanOrEqual(MOVE_SPEED + 0.01);
  });

  it('Thunderstep never ends inside a wall', () => {
    const stone = world.colliders.find((c) => c.kind === 'monolith')!;
    const p = spawn(stone.x, stone.z + 5, 'storm');
    p.y = world.ground(p.x, p.z, 50).y;
    run(p, inp({ b: BTN_MOVE }), 0.2); // blink north, straight at the monolith
    expect(p.z).toBeGreaterThan(stone.z + stone.hx);
    expect(world.solidAt(p.x, p.y + 1, p.z, 0.2)).toBeNull();
  });

  it('Thunderstep crosses open ground at full range', () => {
    const p = spawn(-30, 10, 'storm');
    const z0 = p.z;
    run(p, inp({ b: BTN_MOVE }), 0.2);
    expect(z0 - p.z).toBeGreaterThan(10);
  });

  it('Seismic Leap arcs and reports its landing', () => {
    const p = spawn(-30, 10, 'stone');
    let landedLeap = false;
    const hooks: StepHooks = { onMoveEnd: (_s, mode, landed) => { if (mode === MV_LEAP && landed) landedLeap = true; } };
    stepPlayer(p, inp({ b: BTN_MOVE, pitch: 0.2 }), world, DT, hooks);
    run(p, inp({ pitch: 0.2 }), 0.3, hooks);
    expect(p.mv).toBe(MV_LEAP);
    expect(p.onGround).toBe(false);
    run(p, inp({ pitch: 0.2 }), 2, hooks);
    expect(landedLeap).toBe(true);
    expect(p.mv).toBe(MV_NONE);
  });

  it('Zephyr Soar works in mid-air and slows the fall', () => {
    const p = spawn(-30, 10, 'gale');
    p.onGround = false; p.y += 6; p.vy = -8;
    stepPlayer(p, inp({ b: BTN_MOVE }), world, DT);
    expect(p.mv).toBe(MV_SOAR);
    expect(p.vy).toBeGreaterThan(8);
    run(p, inp(), 1.6);
    expect(p.vy).toBeGreaterThan(-6); // gliding, not plummeting
    expect(canUse(p, 4)).toBe(false); // once per airtime
  });

  it('Glacier Glide steers toward the aim and can be jumped out of', () => {
    const p = spawn(-30, 10, 'frost');
    stepPlayer(p, inp({ b: BTN_MOVE }), world, DT);
    expect(p.mv).toBe(MV_GLIDE);
    run(p, inp({ yaw: 1 }), 0.4);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(MOVE_SPEED * 1.8);
    expect(p.vx).toBeLessThan(0); // turning toward yaw +1 (toward -X)
    stepPlayer(p, inp({ yaw: 1, b: BTN_JUMP }), world, DT);
    expect(p.mv).toBe(MV_NONE);
    expect(p.vy).toBeGreaterThan(0);
  });

  it('Shadowmeld hides and hastens until an attack', () => {
    const p = spawn(-30, 10, 'umbra');
    stepPlayer(p, inp({ b: BTN_MOVE }), world, DT);
    run(p, inp({ mz: 1 }), 0.6);
    expect(p.stealth).toBeGreaterThan(0);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(MOVE_SPEED * 1.2);
    run(p, inp({ b: BTN_MELEE }), 0.4);
    expect(p.stealth).toBe(0);
  });
});

describe('hit reactions', () => {
  it('a launch that lands inside the stun window knocks down, then grants invulnerability', () => {
    const p = spawn();
    p.launched = true; p.stun = 0.6; p.onGround = false; p.vy = 5; p.y += 0.1;
    let knocked = false;
    run(p, inp(), 0.5, { onLand: (_s, _v, kd) => { knocked = knocked || kd; } });
    expect(knocked).toBe(true);
    expect(p.down).toBeGreaterThan(0);
    expect(p.inv).toBeGreaterThan(p.down);
    run(p, inp({ mz: 1 }), 0.3);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(1); // cannot run while down
  });

  it('a long launch is recovered in the air', () => {
    const p = spawn();
    p.launched = true; p.stun = 0.5; p.onGround = false; p.vy = 14; p.y += 0.1;
    run(p, inp(), 0.7);
    expect(p.onGround).toBe(false);
    expect(p.launched).toBe(false);
    run(p, inp(), 2);
    expect(p.onGround).toBe(true);
    expect(p.down).toBe(0);
  });

  it('teching shortens the knockdown', () => {
    const a = spawn(), b = spawn();
    for (const p of [a, b]) { p.launched = true; p.stun = 0.6; p.onGround = false; p.vy = 4; p.y += 0.1; }
    let downA = 0, downB = 0;
    for (let i = 0; i < 40; i++) {
      stepPlayer(a, inp(), world, DT);
      // b taps jump just before touching down
      stepPlayer(b, inp({ b: b.vy < -1.5 && i % 2 === 0 ? BTN_JUMP : 0 }), world, DT);
      downA = Math.max(downA, a.down); downB = Math.max(downB, b.down);
    }
    expect(downA).toBeGreaterThan(0.5);
    expect(downB).toBeGreaterThan(0); expect(downB).toBeLessThan(downA * 0.6);
  });

  it('frozen and bubbled fighters cannot act', () => {
    const p = spawn();
    p.freeze = 1;
    run(p, inp({ mz: 1, b: BTN_MELEE }), 0.3);
    expect(p.act).toBe(-1);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(0.5);
    const q = spawn();
    q.bubble = 1; q.onGround = false;
    const y0 = q.y;
    run(q, inp({ mz: 1 }), 0.8);
    expect(q.y).toBeGreaterThan(y0 + 0.8); // floats upward
  });
});
