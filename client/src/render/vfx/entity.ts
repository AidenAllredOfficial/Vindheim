// Per-entity effect state. Records are pooled; each entity kind is a small table of functions
// that render from the live EntityState the game core mutates in place.

import type { EntityState } from '@shared/types';
import type { EntityKind } from '@shared/elements';
import type { Ctx } from './ctx';
import type { Palette } from './core/particles';
import type { Strip } from './core/strips';

export class Ent {
  e!: EntityState;
  kind!: EntityKind;
  def!: KindDef;
  pal!: Palette;
  el = 0;
  /** Belongs to the local player. */
  mine = false;
  /** Instance / decal handles (-1 = none). */
  readonly h = new Int32Array(32);
  readonly s: (Strip | null)[] = [null, null, null, null, null, null, null, null];
  /** Scratch floats owned by the kind. */
  readonly f = new Float32Array(48);
  /** Previous position (for trails). */
  px = 0; py = 0; pz = 0;
  /** Time (effects clock) the entity was born. */
  birth = 0;
  /** After despawn a kind may keep animating for a while. */
  dead = false; linger = 0; why = 0;
  /** Where it ended. */
  ex = 0; ey = 0; ez = 0;
  /** Last known direction of travel (unit). */
  dx = 0; dy = 0; dz = 1;

  reset(): void {
    this.h.fill(-1); this.f.fill(0);
    for (let i = 0; i < this.s.length; i++) this.s[i] = null;
    this.dead = false; this.linger = 0; this.why = 0;
  }

  /** Update the cached travel direction from the entity's velocity. Returns the speed. */
  heading(): number {
    const e = this.e, sp = Math.hypot(e.vx, e.vy, e.vz);
    if (sp > 1e-4) { this.dx = e.vx / sp; this.dy = e.vy / sp; this.dz = e.vz / sp; }
    return sp;
  }
  endStrips(fade = 0.2): void {
    for (let i = 0; i < this.s.length; i++) { const s = this.s[i]; if (s) { s.end(fade); this.s[i] = null; } }
  }
}

export interface KindDef {
  spawn(c: Ctx, n: Ent): void;
  update?(c: Ctx, n: Ent, dt: number): void;
  /** Called once when the entity ends. Set n.linger > 0 to keep receiving after() calls. */
  despawn?(c: Ctx, n: Ent, why: number): void;
  /** Called every frame while lingering after despawn. */
  after?(c: Ctx, n: Ent, dt: number): void;
  /** Final clean-up (free live instances). Always called exactly once. */
  free?(c: Ctx, n: Ent): void;
}

export type KindTable = Partial<Record<EntityKind, KindDef>>;
