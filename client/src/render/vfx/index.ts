// Vindheim effects layer: every combat and status effect in the game.
//
//   core/      the pooled, allocation-free toolkit (GPU particles, strips, decals, instanced
//              mesh batches, the three pooled lights, procedural textures)
//   kinds_*.ts one visual per simulated entity kind (projectiles, zones, traps, walls, channels)
//   fx.ts      instant events (bursts, beams, hits, deaths, teleports, pickups)
//   fighters.ts cast tells, swing arcs, movement signatures, statuses, footfalls
//
// Entities render from the live EntityState the game core mutates in place.

import type * as THREE from 'three';
import type { World } from '@shared/world';
import type { EntityState, GameEvent } from '@shared/types';
import type { FighterLookup, PlayerView, Vfx } from '../../contracts';
import type { QualityLevel } from '../../settings';
import { Ctx } from './ctx';
import { Ent, type KindTable } from './entity';
import { KINDS_A } from './kinds_a';
import { KINDS_B } from './kinds_b';
import { death, hit, instantFx, pickup, popEvent, respawn, teleport } from './fx';
import { FighterFx } from './fighters';

/** Extra diagnostics the dev harness reads (not part of the Vfx contract). */
export interface VfxStats { particles: number; capacity: number; decals: number; strips: number; inst: number; entities: number; draws: number }

export function createVfx(scene: THREE.Scene, world: World, fighters: FighterLookup, quality: QualityLevel): Vfx & { stats(): VfxStats } {
  const c = new Ctx(scene, world, fighters, quality);
  const table: KindTable = { ...KINDS_A, ...KINDS_B };
  const ents = new Map<number, Ent>();
  /** Same entities as `ents`, as a dense array (iterated every frame without allocating). */
  const live: Ent[] = [];
  const pool: Ent[] = [];
  const unlist = (n: Ent): void => { const i = live.indexOf(n); if (i >= 0) { live[i] = live[live.length - 1]; live.pop(); } };
  const dying: Ent[] = [];
  const F = new FighterFx(c);

  const finish = (n: Ent): void => {
    n.endStrips();
    n.def.free?.(c, n);
    pool.push(n);
  };

  const api: Vfx & { stats(): VfxStats } = {
    spawnEntity(e: EntityState): void {
      const def = table[e.k];
      if (!def) return;
      const old = ents.get(e.id);
      if (old) { ents.delete(e.id); unlist(old); finish(old); }
      const n = pool.pop() || new Ent();
      n.reset();
      n.e = e; n.kind = e.k; n.def = def; n.el = e.el;
      n.pal = c.pals[e.el] || c.pals[0];
      n.mine = !!fighters.get(e.o)?.isLocal;
      n.birth = c.now - e.age;
      n.px = e.x; n.py = e.y; n.pz = e.z;
      n.heading();
      ents.set(e.id, n);
      live.push(n);
      def.spawn(c, n);
    },

    despawnEntity(id: number, x: number, y: number, z: number, why: number): void {
      const n = ents.get(id);
      if (!n) return;
      ents.delete(id);
      unlist(n);
      n.dead = true; n.why = why; n.ex = x; n.ey = y; n.ez = z;
      n.def.despawn?.(c, n, why);
      if (n.linger > 0 && n.def.after) dying.push(n); else finish(n);
    },

    onEvent(ev: GameEvent): void {
      switch (ev.e) {
        case 'fx': instantFx(c, ev); break;
        case 'hit': {
          // zaps from a ball lightning arrive as hits whose source entity is the orb
          const src = ev.eid ? ents.get(ev.eid) : undefined;
          const orb = !!src && src.kind === 'balllightning';
          hit(c, ev, orb ? src!.e.x : 0, orb ? src!.e.y : 0, orb ? src!.e.z : 0, orb);
          break;
        }
        case 'death': death(c, ev, fighters.get(ev.p)?.element ?? 'ember'); break;
        case 'respawn': respawn(c, ev, fighters.get(ev.p)?.element ?? 'ember'); break;
        case 'tp': teleport(c, ev, fighters.get(ev.p)?.element ?? 'dawn'); break;
        case 'pop': popEvent(c, ev); break;
        case 'pickup': {
          const p = fighters.get(ev.p);
          pickup(c, ev, p ? p.x : 0, p ? p.y : 0, p ? p.z : 0, !!p);
          break;
        }
        default: break; // spawn / despawn arrive through spawnEntity / despawnEntity; the rest is not ours
      }
    },

    castStart(p: PlayerView, slot: number): void { F.castStart(p, slot); },
    castRelease(p: PlayerView, slot: number): void { F.castRelease(p, slot); },
    footfall(p: PlayerView, kind: 'step' | 'land' | 'jump', surface: string): void { F.footfall(p, kind, surface); },

    update(dt: number, _time: number, camera: THREE.PerspectiveCamera): void {
      c.begin(dt, camera);
      for (let i = 0; i < live.length; i++) {
        const n = live[i];
        n.def.update?.(c, n, dt);
        n.px = n.e.x; n.py = n.e.y; n.pz = n.e.z;
      }
      for (let i = dying.length - 1; i >= 0; i--) {
        const n = dying[i];
        n.linger -= dt;
        if (n.linger > 0) n.def.after!(c, n, dt);
        else { dying[i] = dying[dying.length - 1]; dying.pop(); finish(n); }
      }
      F.update(dt);
      c.end();
    },

    setQuality(q: QualityLevel): void { c.setQuality(q); },

    clear(): void {
      for (let i = 0; i < live.length; i++) finish(live[i]);
      live.length = 0;
      ents.clear();
      for (const n of dying) finish(n);
      dying.length = 0;
      F.clear();
      c.clear();
    },

    dispose(): void {
      api.clear();
      c.dispose();
    },

    stats(): VfxStats {
      let inst = 0, draws = c.P.drawCalls() + (c.strips.mesh.visible ? 1 : 0) + (c.decals.mesh.visible ? 1 : 0);
      for (const b of c.B.all) { inst += b.liveCount(); if (b.mesh.visible) draws++; }
      return { particles: c.P.live(), capacity: c.P.capacity, decals: c.decals.liveCount(), strips: c.strips.activeCount, inst, entities: ents.size, draws };
    },
  };
  return api;
}
