// Client-side kinematics for replicated combat entities. The server announces an entity once
// (spawn) and once more when it ends (despawn); in between, clients move it with these rules,
// which mirror what the authoritative simulation does.

import type { EntityKind } from '../elements';
import { ZONES } from '../elements';
import type { EntityState } from '../types';
import { VOID, type World } from '../world';

export type EntityClass = 'proj' | 'orb' | 'zone' | 'strike' | 'trap' | 'line' | 'wall' | 'wave' | 'channel' | 'pickup';

export const ENTITY_CLASS: Record<EntityKind, EntityClass | 'fx'> = {
  fireball: 'proj', flamewave: 'fx', meteor: 'strike', firepatch: 'zone', cindertrail: 'zone',
  iceshard: 'proj', spikes: 'line', rimerune: 'trap', rimeburst: 'fx', icetrail: 'zone',
  arcbolt: 'fx', balllightning: 'orb', thunderstrike: 'strike', staticburst: 'fx',
  boulder: 'proj', rampart: 'wall', earthshatter: 'fx', rockshard: 'proj', leapslam: 'fx',
  gustblade: 'proj', cyclone: 'zone', jetstream: 'channel',
  waterjet: 'channel', bubble: 'proj', tidalwave: 'wave',
  dagger: 'proj', snare: 'zone', shade: 'proj',
  glint: 'proj', solarflare: 'fx', sunlance: 'channel', raydash: 'fx',
  healrune: 'pickup',
};

/**
 * Advance an entity by dt. Returns true when a projectile ran into the world this step (the
 * caller may show the impact right away instead of waiting for the server's despawn).
 */
export function stepEntity(e: EntityState, dt: number, world: World): boolean {
  e.age += dt;
  const cls = ENTITY_CLASS[e.k];
  if (cls === 'proj' || cls === 'orb') {
    e.vy -= e.g * dt;
    const speed = Math.hypot(e.vx, e.vy, e.vz);
    const steps = Math.max(1, Math.ceil((speed * dt) / 0.45));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      e.x += e.vx * sdt; e.y += e.vy * sdt; e.z += e.vz * sdt;
      if (world.solidAt(e.x, e.y, e.z, e.r * 0.45)) {
        e.x -= e.vx * sdt * 0.5; e.y -= e.vy * sdt * 0.5; e.z -= e.vz * sdt * 0.5;
        return true;
      }
    }
  } else if (cls === 'zone') {
    const z = ZONES[e.k];
    if (z && z.speed) {
      const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
      const gy = world.ground(nx, nz, e.y + 1.2).y;
      if (gy > VOID && gy - e.y > 1.2) { e.vx = -e.vx * 0.6; e.vz = -e.vz * 0.6; }
      else { e.x = nx; e.z = nz; if (gy > VOID) e.y += Math.max(-4 * dt, Math.min(6 * dt, gy - e.y)); }
    }
  } else if (cls === 'wave') {
    e.x += e.vx * dt; e.z += e.vz * dt;
    const gy = world.ground(e.x, e.z, e.y + 1.5).y;
    if (gy > VOID) e.y += Math.max(-5 * dt, Math.min(5 * dt, gy - e.y));
  }
  return false;
}
