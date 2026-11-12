import { describe, expect, it } from 'vitest';
import { World, VOID, HALL, STEP_HEIGHT, colliderContains, colliderTop } from '../shared/world';
import { ELEMENT_ORDER } from '../shared/elements';
import { getNav } from '../shared/sim/nav';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../shared/types';

const world = new World();

describe('world layout', () => {
  it('is deterministic', () => {
    const b = new World();
    expect(b.colliders.length).toBe(world.colliders.length);
    for (let i = 0; i < world.colliders.length; i++) expect(b.colliders[i]).toEqual(world.colliders[i]);
    expect(b.terrainHeight(12.3, -7.7)).toBe(world.terrainHeight(12.3, -7.7));
  });

  it('has solid ground in the arena centre and void beyond the rim', () => {
    expect(world.terrainHeight(0, 10)).toBeGreaterThan(-3);
    expect(world.terrainHeight(0, 75)).toBe(VOID);
    expect(world.terrainHeight(140, 0)).toBe(VOID);
    expect(world.ground(140, 0, 5).y).toBe(VOID);
  });

  it('cuts a chasm into the south-west of the arena', () => {
    const a = Math.PI * 0.75;
    expect(world.terrainHeight(Math.cos(a) * 45, Math.sin(a) * 45)).toBe(VOID);
    expect(world.terrainHeight(Math.cos(a) * 12, Math.sin(a) * 12)).toBeGreaterThan(VOID);
  });

  it('places every spawn on open, walkable ground', () => {
    expect(world.spawns.length).toBeGreaterThanOrEqual(10);
    for (const sp of world.spawns) {
      const g = world.ground(sp.x, sp.z, sp.y + 0.2);
      expect(g.y).toBeGreaterThan(VOID);
      expect(Math.abs(g.y - sp.y)).toBeLessThan(0.01);
      const p = { x: sp.x, z: sp.z };
      world.resolveCircle(p, PLAYER_RADIUS, sp.y, sp.y + PLAYER_HEIGHT);
      expect(Math.hypot(p.x - sp.x, p.z - sp.z)).toBeLessThan(0.5);
    }
  });

  it('gives every element a pedestal and a shrine', () => {
    for (const el of ELEMENT_ORDER) {
      expect(world.pedestals[el]).toBeDefined();
      expect(world.shrines.some((s) => s.element === el)).toBe(true);
    }
    expect(world.dummySpots.length).toBe(3);
  });

  it('keeps the hall spawns inside the hall on the floor', () => {
    for (const sp of world.hallSpawns) {
      expect(sp.x).toBeGreaterThan(HALL.minX); expect(sp.x).toBeLessThan(HALL.maxX);
      expect(sp.z).toBeGreaterThan(HALL.minZ); expect(sp.z).toBeLessThan(HALL.maxZ);
      expect(world.ground(sp.x, sp.z, sp.y + 0.2).y).toBeCloseTo(HALL.floorY, 5);
      expect(world.inHallZone(sp.z)).toBe(true);
    }
  });
});

describe('collision queries', () => {
  it('lets a body stand on low tops and blocks it with tall sides', () => {
    const pillar = world.colliders.find((c) => c.kind === 'pillar')!;
    const base = world.ground(pillar.x + pillar.hx + 1.5, pillar.z, 50).y;
    // from the ground the pillar is a wall …
    expect(world.ground(pillar.x, pillar.z, base).y).toBeLessThan(pillar.y1);
    const p = { x: pillar.x + 0.1, z: pillar.z };
    expect(world.resolveCircle(p, PLAYER_RADIUS, base, base + PLAYER_HEIGHT)).toBe(true);
    expect(Math.hypot(p.x - pillar.x, p.z - pillar.z)).toBeGreaterThanOrEqual(pillar.hx + PLAYER_RADIUS - 1e-6);
    // … but once above it you can stand on top
    expect(world.ground(pillar.x, pillar.z, pillar.y1 + 0.1).y).toBeCloseTo(pillar.y1, 5);
  });

  it('interpolates ramp tops', () => {
    const ramp = world.colliders.find((c) => c.kind === 'ramp' && c.y1b !== undefined)!;
    const lo = colliderTop(ramp, ramp.x - Math.cos(ramp.yaw) * ramp.hx, ramp.z - Math.sin(ramp.yaw) * ramp.hx);
    const hi = colliderTop(ramp, ramp.x + Math.cos(ramp.yaw) * ramp.hx, ramp.z + Math.sin(ramp.yaw) * ramp.hx);
    expect(lo).toBeCloseTo(ramp.y1, 5);
    expect(hi).toBeCloseTo(ramp.y1b!, 5);
    expect(colliderTop(ramp, ramp.x, ramp.z)).toBeCloseTo((ramp.y1 + ramp.y1b!) / 2, 5);
    expect(colliderContains(ramp, ramp.x, ramp.z)).toBe(true);
  });

  it('lets bodies pass under lintels and treats them as ceilings', () => {
    const lintel = world.colliders.find((c) => c.kind === 'lintel')!;
    const floor = world.ground(lintel.x, lintel.z, lintel.y0 - 1).y;
    expect(floor).toBeLessThan(lintel.y0 - PLAYER_HEIGHT);
    const p = { x: lintel.x, z: lintel.z };
    expect(world.resolveCircle(p, PLAYER_RADIUS, floor, floor + PLAYER_HEIGHT)).toBe(false);
    expect(world.ceiling(lintel.x, lintel.z, floor)).toBeCloseTo(lintel.y0, 5);
  });

  it('raycasts against terrain and colliders', () => {
    const down = world.raycast(0, 30, 20, 0, -1, 0, 60);
    expect(down).not.toBeNull();
    expect(down!.y).toBeCloseTo(world.topAt(0, 20), 0);
    expect(world.raycast(0, 30, 20, 0, 1, 0, 60)).toBeNull();
    const mono = world.colliders.find((c) => c.kind === 'monolith')!;
    const hit = world.raycast(mono.x + 10, mono.y0 + 2, mono.z, -1, 0, 0, 30);
    expect(hit).not.toBeNull();
    expect(hit!.collider?.kind).toBe('monolith');
    expect(hit!.t).toBeGreaterThan(8.5);
    expect(world.los({ x: mono.x + 10, y: mono.y0 + 2, z: mono.z }, { x: mono.x - 10, y: mono.y0 + 2, z: mono.z })).toBe(false);
    expect(world.los({ x: 20, y: 6, z: 20 }, { x: 22, y: 6, z: 24 })).toBe(true);
  });

  it('honours dynamic colliders', () => {
    const w = new World();
    const y = w.topAt(20, 22);
    expect(w.solidAt(20, y + 1.5, 22, 0.2)).toBeNull();
    w.dyn = [w.makeDynamicBox('rampart', 9999, 20, 22, 3.5, 0.65, 0.3, y - 1, y + 3.4)];
    expect(w.solidAt(20, y + 1.5, 22, 0.2)).not.toBeNull();
    const p = { x: 20, z: 22.2 };
    expect(w.resolveCircle(p, PLAYER_RADIUS, y, y + PLAYER_HEIGHT)).toBe(true);
    w.dyn = [];
    expect(w.solidAt(20, y + 1.5, 22, 0.2)).toBeNull();
  });

  it('steps are only climbable up to STEP_HEIGHT', () => {
    const bench = world.colliders.find((c) => c.kind === 'bench')!;
    expect(bench.y1 - HALL.floorY).toBeLessThanOrEqual(STEP_HEIGHT);
    const fire = world.colliders.find((c) => c.kind === 'firepit')!;
    expect(fire.y1 - HALL.floorY).toBeGreaterThan(STEP_HEIGHT);
  });
});

describe('navigation', () => {
  const nav = getNav();
  it('reaches every arena spawn from the centre', () => {
    for (const sp of world.spawns) {
      expect(nav.reachable(sp.x, sp.z)).toBe(true);
      const path = nav.findPath(0, 8, sp.x, sp.z);
      expect(path).not.toBeNull();
    }
  });
  it('connects the hall interior to the Skygate', () => {
    const path = nav.findPath(0, -150, HALL.gate.x, HALL.gate.z - 2);
    expect(path).not.toBeNull();
    // the route leaves through the door, never through a wall
    for (const p of path!.pts) {
      const inside = p.z > HALL.minZ && p.z < HALL.maxZ;
      if (inside) expect(Math.abs(p.x)).toBeLessThan(HALL.maxX);
    }
  });
  it('does not link the hall island to the arena', () => {
    expect(nav.findPath(0, -150, 0, 8)).toBeNull();
  });
});
