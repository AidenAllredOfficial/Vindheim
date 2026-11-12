// The world of Vindheim: a deterministic description of every walkable surface and solid
// obstacle. The same data drives server physics, client prediction, bot navigation AND the
// renderer (which dresses each collider according to its `kind`), so what you see is exactly
// what you collide with.
//
// Model ("2.5D"): the world is made of
//   * landmasses  – floating islands with a polar outline and a gentle analytic heightfield
//   * colliders   – vertical prisms (oriented boxes / cylinders) with a flat or ramped top.
// You can stand on any top, are blocked by any side taller than STEP_HEIGHT, and can pass
// underneath a prism whose bottom (y0) is above your head.
//
// Axes: +X east, +Z south, +Y up. The arena island is centred on the origin; the Hearth-Hall
// island floats to the north (negative Z), higher up.

import { clamp, clamp01, fbm2, lerp, smoothstep, wrapAngle, Rng, type Vec3 } from './math';
import { ELEMENT_ORDER, type ElementId } from './ids';

export const STEP_HEIGHT = 0.55;
export const VOID = -1e9;
/** Falling below this height in the arena is lethal. */
export const ARENA_KILL_Y = -30;
/** Falling below this height near the hall drops you into the arena ("leap of faith"). */
export const HALL_DROP_Y = -2;
/** Everything north of this line belongs to the hall (safe zone). */
export const HALL_ZONE_Z = -100;
export const CLOUD_SEA_Y = -46;

export type Surface = 'grass' | 'rock' | 'snow' | 'ice' | 'stone' | 'wood';

export type ColliderKind =
  // arena – natural
  | 'rock'        // flat-topped natural rock mass / boulder / plateau tier
  | 'ramp'        // natural rock ramp (sloped top, see y1b)
  | 'ledge'       // thin rock shelf hanging over the void
  | 'icecrystal'  // tall ice crystal
  | 'tree'        // pine trunk (canopy is visual only)
  | 'stepstone'   // floating stepping stone over the void
  // arena – built
  | 'standing'    // standing stone of the central circle (rune-carved)
  | 'fallen'      // toppled standing stone
  | 'dais'        // low circular stone platform
  | 'monolith'    // the great central rune monolith
  | 'floor'       // ruin floor slab
  | 'pillar'      // ruin column (height varies = broken)
  | 'wall'        // ruin wall segment
  | 'rubble'      // low broken block
  | 'archpost'    // arch upright
  | 'lintel'      // arch top (has clearance below)
  | 'bridge'      // stone/wood bridge deck (thin; void below)
  | 'ship'        // frozen longship hull (deck is walkable)
  | 'mast'        // longship mast
  | 'shrine'      // elemental rune shrine (tag = element id)
  // hall
  | 'hallfloor' | 'hallwall' | 'hallroof' | 'halllintel' | 'timber' | 'firepit' | 'bench' | 'table'
  | 'pedestal'    // elemental pedestal (tag = element id)
  | 'highdais' | 'throne' | 'terrace' | 'ring' | 'gatepost'
  // dynamic (created by abilities at runtime)
  | 'rampart';

export interface Collider {
  id: number;
  shape: 'box' | 'cyl';
  kind: ColliderKind;
  /** Footprint centre. */
  x: number; z: number;
  /** Box half extents along local x / z. For cylinders hx is the radius (hz mirrors it). */
  hx: number; hz: number;
  /**
   * Box rotation. Local +x axis = (cos yaw, sin yaw) in world (x, z); local +z = (-sin yaw, cos yaw).
   * For a three.js mesh use `mesh.rotation.y = -yaw`.
   */
  yaw: number;
  /** Bottom and top heights (world Y). */
  y0: number; y1: number;
  /** Ramps only: top height at the local +x end (y1 is the height at the local -x end). */
  y1b?: number;
  surf: Surface;
  /** Stable per-collider random seed for visual variation. */
  seed: number;
  /** Extra info, e.g. the element id for pedestals and shrines. */
  tag?: string;
}

export interface Landmass {
  id: number;
  kind: 'arena' | 'hall' | 'islet';
  name: string;
  cx: number; cz: number;
  baseY: number;
  radius: number;
  /** Outline roughness as a fraction of the radius. */
  rough: number;
  seed: number;
  /** How far the rocky underside tapers down below baseY (visual only). */
  depth: number;
  notches: { angle: number; halfWidth: number; innerR: number }[];
}

export interface GroundHit { y: number; surf: Surface; collider: Collider | null }
export interface RayHit { t: number; x: number; y: number; z: number; collider: Collider | null }

export interface SpawnPoint { x: number; y: number; z: number; yaw: number }

// ----------------------------------------------------------------------------------------------
// Layout constants (exported so the renderer / UI can reference landmarks)
// ----------------------------------------------------------------------------------------------

export const HALL = {
  /** Island centre. */
  cx: 0, cz: -152, baseY: 18,
  /** Interior floor height. */
  floorY: 18.6,
  /** Building footprint (outer faces of the walls). */
  minX: -11.8, maxX: 11.8, minZ: -180.8, maxZ: -143.2,
  wallTop: 28, roofY0: 27.4, roofY1: 28.6,
  doorHalfWidth: 2.6, doorHeight: 4.4,
  firepit: { x: 0, z: -160, hx: 1.3, hz: 5 },
  terrace: { x: 0, z: -131.6, hx: 9, hz: 11.6, y: 18.3 },
  ring: { x: 21, z: -133, r: 6.5, y: 18.25 },
  gate: { x: 0, z: -119.4, halfWidth: 2.6 },
} as const;

export const LAKE = { x: 36, z: 4, rx: 17, rz: 14 } as const;
export const RUINS = { x: 4, z: 40 } as const;
export const HIGHLANDS = { x: 2, z: -42 } as const;
export const CHASM_ANGLE = Math.PI * 0.75; // south-west

// ----------------------------------------------------------------------------------------------

function boxLocal(c: Collider, x: number, z: number): [number, number] {
  const dx = x - c.x, dz = z - c.z;
  if (c.yaw === 0) return [dx, dz];
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  return [dx * cs + dz * sn, -dx * sn + dz * cs];
}

/** Top height of a collider at a world position (meaningful inside / near the footprint). */
export function colliderTop(c: Collider, x: number, z: number): number {
  if (c.y1b === undefined) return c.y1;
  const [lx] = boxLocal(c, x, z);
  return lerp(c.y1, c.y1b, clamp01((lx + c.hx) / (2 * c.hx)));
}

export function colliderContains(c: Collider, x: number, z: number, margin = 0): boolean {
  if (c.shape === 'cyl') {
    const dx = x - c.x, dz = z - c.z, r = c.hx + margin;
    return dx * dx + dz * dz <= r * r;
  }
  const [lx, lz] = boxLocal(c, x, z);
  return Math.abs(lx) <= c.hx + margin && Math.abs(lz) <= c.hz + margin;
}

const CELL = 8;
const cellKey = (ix: number, iz: number) => (ix + 512) * 2048 + (iz + 512);

export class World {
  readonly landmasses: Landmass[] = [];
  /** Static colliders (never change after construction). */
  readonly colliders: Collider[] = [];
  /** Dynamic colliders (ability-made walls). Replaced by the simulation as they come and go. */
  dyn: Collider[] = [];

  readonly spawns: SpawnPoint[] = [];
  readonly hallSpawns: SpawnPoint[] = [];
  readonly dummySpots: SpawnPoint[] = [];
  readonly pickupSpots: Vec3[] = [];
  /** Pedestal position (top centre) for each element, in the hall. */
  readonly pedestals: Record<string, Vec3> = {};
  /** Elemental shrines scattered around the arena. */
  readonly shrines: { element: ElementId; x: number; y: number; z: number }[] = [];
  /** Places where bots and players like to loiter in the hall. */
  readonly hallPoints: Vec3[] = [];

  private grid = new Map<number, Collider[]>();
  private nextId = 1;
  private scratch: Collider[] = [];

  constructor() {
    this.build();
    for (const c of this.colliders) this.indexCollider(c);
  }

  // ------------------------------------------------------------------ landmass / terrain

  /** Distance from the landmass centre to its rim in direction `angle` (atan2(z, x)). */
  edgeRadius(lm: Landmass, angle: number): number {
    const n = fbm2(Math.cos(angle) * 1.7 + 5.3, Math.sin(angle) * 1.7 + 9.1, 3, lm.seed);
    let r = lm.radius * (1 + lm.rough * (n - 0.5) * 2);
    for (const nt of lm.notches) {
      const d = Math.abs(wrapAngle(angle - nt.angle));
      if (d < nt.halfWidth) {
        const k = smoothstep(0.55, 1.0, d / nt.halfWidth);
        r = Math.min(r, nt.innerR + (r - nt.innerR) * k);
      }
    }
    return r;
  }

  /** Signed distance-ish value: > 0 inside the landmass (metres to the rim along the radius). */
  rimDistance(lm: Landmass, x: number, z: number): number {
    const dx = x - lm.cx, dz = z - lm.cz;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r > lm.radius * (1 + lm.rough) + 0.01) return lm.radius * (1 + lm.rough) - r;
    return this.edgeRadius(lm, Math.atan2(dz, dx)) - r;
  }

  landmassAt(x: number, z: number): Landmass | null {
    for (const lm of this.landmasses) if (this.rimDistance(lm, x, z) > 0) return lm;
    return null;
  }

  /** Terrain height of a specific landmass at (x, z), ignoring its outline. */
  landHeight(lm: Landmass, x: number, z: number): number {
    const dx = x - lm.cx, dz = z - lm.cz;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (lm.kind === 'arena') {
      let h = (fbm2(x * 0.035 + 40, z * 0.035 + 40, 4, 11) - 0.5) * 2.6;
      h += (fbm2(x * 0.11, z * 0.11, 2, 5) - 0.5) * 0.35;
      // the Thing-stead (centre) is trampled flat
      h = lerp(h, 0.35, 1 - smoothstep(9, 22, r));
      // frozen lake basin
      const le = ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2;
      h = lerp(h, -0.55, 1 - smoothstep(0.8, 1.35, le));
      // ruins sit on a levelled terrace
      const rd = Math.sqrt((x - RUINS.x) ** 2 + (z - RUINS.z) ** 2);
      h = lerp(h, 0.2, 1 - smoothstep(13, 21, rd));
      // ground swells toward the northern highlands
      h += smoothstep(12, 44, -z) * 1.3;
      // the rim sags a little
      h -= smoothstep(0.8, 1.0, r / lm.radius) * 0.7;
      return lm.baseY + h;
    }
    if (lm.kind === 'hall') {
      const n = (fbm2(x * 0.06 + 3, z * 0.06 + 7, 3, 23) - 0.5) * 1.4;
      // flat where the hall, terrace and sparring ring stand
      const flat = 1 - smoothstep(0.55, 0.85, r / lm.radius);
      return lm.baseY + lerp(n - smoothstep(0.8, 1, r / lm.radius) * 0.8, 0, flat);
    }
    // islets: a soft dome with a little noise
    const dome = (1 - clamp01(r / lm.radius) ** 2) * 0.7;
    return lm.baseY + dome + (fbm2(x * 0.15, z * 0.15, 2, lm.seed) - 0.5) * 0.5;
  }

  /** Terrain height at (x, z) or VOID when there is no land there. */
  terrainHeight(x: number, z: number): number {
    for (const lm of this.landmasses) if (this.rimDistance(lm, x, z) > 0) return this.landHeight(lm, x, z);
    return VOID;
  }

  /** Is this spot on the frozen lake? */
  onLake(x: number, z: number): boolean {
    return ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2 < 1;
  }

  /** Terrain surface type (physics + footsteps). */
  terrainSurface(x: number, z: number): Surface {
    if (z < HALL_ZONE_Z) return 'snow';
    if (this.onLake(x, z)) return 'ice';
    const b = this.biomeAt(x, z);
    if (b.snow > 0.5) return 'snow';
    if (b.rock > 0.5) return 'rock';
    return 'grass';
  }

  /**
   * Smooth biome weights used by the terrain shader (and surface lookups). Each in [0,1];
   * grass is the remainder: grass = 1 - max(rock, snow, ice).
   */
  biomeAt(x: number, z: number): { rock: number; snow: number; ice: number; dirt: number } {
    if (z < HALL_ZONE_Z) {
      const n = fbm2(x * 0.08, z * 0.08, 3, 31);
      return { rock: smoothstep(0.52, 0.7, n), snow: 1 - smoothstep(0.35, 0.6, n) * 0.6, ice: 0, dirt: 0 };
    }
    const r = Math.sqrt(x * x + z * z);
    const n = fbm2(x * 0.05 + 9, z * 0.05 + 2, 3, 41);
    const le = ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2;
    const ice = 1 - smoothstep(0.85, 1.05, le);
    // rock: highlands in the north, a band along the rim and around the chasm
    let rock = smoothstep(16, 30, -z + (n - 0.5) * 14);
    rock = Math.max(rock, smoothstep(0.86, 0.97, r / 62 + (n - 0.5) * 0.08));
    const ca = Math.abs(wrapAngle(Math.atan2(z, x) - CHASM_ANGLE));
    rock = Math.max(rock, (1 - smoothstep(0.16, 0.3, ca)) * smoothstep(14, 22, r));
    // snow: drifts in the north and east, around the lake, patchy elsewhere
    let snow = smoothstep(0.5, 0.72, n + smoothstep(0, 60, -z) * 0.25 + smoothstep(0, 50, x) * 0.2);
    snow = Math.max(snow, (1 - smoothstep(1.0, 1.9, le)) * 0.9);
    // dirt: the trampled centre and the paths toward the ruins
    const rd = Math.sqrt((x - RUINS.x) ** 2 + (z - RUINS.z) ** 2);
    let dirt = (1 - smoothstep(6, 15, r)) * 0.8;
    dirt = Math.max(dirt, (1 - smoothstep(10, 17, rd)) * 0.5);
    dirt = Math.max(dirt, (1 - smoothstep(1.2, 3.2, Math.abs(x - 2 - Math.sin(z * 0.15) * 2))) * smoothstep(8, 14, z) * (1 - smoothstep(26, 32, z)) * 0.8);
    return { rock, snow: snow * (1 - ice), ice, dirt: dirt * (1 - rock) * (1 - snow) };
  }

  // ------------------------------------------------------------------ collider queries

  private indexCollider(c: Collider) {
    const ext = c.shape === 'cyl' ? c.hx : Math.sqrt(c.hx * c.hx + c.hz * c.hz);
    const x0 = Math.floor((c.x - ext) / CELL), x1 = Math.floor((c.x + ext) / CELL);
    const z0 = Math.floor((c.z - ext) / CELL), z1 = Math.floor((c.z + ext) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = cellKey(ix, iz);
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(c);
    }
  }

  /** Colliders (static + dynamic) whose cells overlap the circle. Result array is reused! */
  near(x: number, z: number, r: number): Collider[] {
    const out = this.scratch;
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    if (x0 === x1 && z0 === z1) {
      const arr = this.grid.get(cellKey(x0, z0));
      if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
    } else {
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const arr = this.grid.get(cellKey(ix, iz));
        if (arr) for (let i = 0; i < arr.length; i++) if (out.indexOf(arr[i]) < 0) out.push(arr[i]);
      }
    }
    for (let i = 0; i < this.dyn.length; i++) out.push(this.dyn[i]);
    return out;
  }

  /**
   * The highest surface that can support a body whose feet are at `feetY` (it may step up
   * STEP_HEIGHT). Returns y = VOID over the abyss.
   */
  ground(x: number, z: number, feetY: number, out?: GroundHit): GroundHit {
    const res = out || { y: VOID, surf: 'grass' as Surface, collider: null };
    let y = this.terrainHeight(x, z);
    res.collider = null;
    res.surf = y > VOID ? this.terrainSurface(x, z) : 'rock';
    const cs = this.near(x, z, 0.2);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!colliderContains(c, x, z, 0.12)) continue;
      const top = colliderTop(c, x, z);
      if (top > y && top <= feetY + STEP_HEIGHT) { y = top; res.collider = c; res.surf = c.surf; }
    }
    res.y = y;
    return res;
  }

  /** Highest surface at (x, z) regardless of where you stand (for spawning, AI, decals). */
  topAt(x: number, z: number): number {
    return this.ground(x, z, 1e6).y;
  }

  /** Lowest collider underside above `feetY` at this spot (Infinity if open sky). */
  ceiling(x: number, z: number, feetY: number): number {
    let c0 = Infinity;
    const cs = this.near(x, z, 0.2);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.y0 > feetY + 1.0 && c.y0 < c0 && colliderContains(c, x, z, 0.3)) c0 = c.y0;
    }
    return c0;
  }

  /**
   * Push a vertical cylinder (the player) out of every collider side it cannot step onto.
   * Mutates `pos` (x, z only). Returns true when a push happened.
   */
  resolveCircle(pos: { x: number; z: number }, radius: number, feetY: number, headY: number): boolean {
    let pushed = false;
    const cs = this.near(pos.x, pos.z, radius + 0.5);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.y0 >= headY) continue;            // overhead
      if (c.y0 > feetY + 1.0) continue;       // handled as a ceiling instead
      if (c.shape === 'cyl') {
        if (c.y1 <= feetY + STEP_HEIGHT) continue;
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const rr = c.hx + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-5) { pos.x = c.x + rr; }
        else { pos.x = c.x + (dx / d) * rr; pos.z = c.z + (dz / d) * rr; }
        pushed = true;
      } else {
        const cs2 = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        const dx = pos.x - c.x, dz = pos.z - c.z;
        let lx = dx * cs2 + dz * sn, lz = -dx * sn + dz * cs2;
        const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
        // height of the top nearest to the body decides whether this side is steppable
        const top = c.y1b === undefined ? c.y1 : lerp(c.y1, c.y1b, clamp01((qx + c.hx) / (2 * c.hx)));
        if (top <= feetY + STEP_HEIGHT) continue;
        const ox = lx - qx, oz = lz - qz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          lx = qx + (ox / d) * radius; lz = qz + (oz / d) * radius;
        } else {
          // centre is inside the box: leave through the nearest face
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) lx = (lx < 0 ? -1 : 1) * (c.hx + radius);
          else lz = (lz < 0 ? -1 : 1) * (c.hz + radius);
        }
        pos.x = c.x + lx * cs2 - lz * sn;
        pos.z = c.z + lx * sn + lz * cs2;
        pushed = true;
      }
    }
    return pushed;
  }

  /** Is the point (inflated by r) inside terrain or a collider? Used by projectiles. */
  solidAt(x: number, y: number, z: number, r = 0): Collider | true | null {
    const th = this.terrainHeight(x, z);
    if (th > VOID && y - r < th) {
      // only the top few metres of an island are solid for projectiles; below is open air
      const lm = this.landmassAt(x, z);
      if (!lm || y > th - 6) return true;
    }
    const cs = this.near(x, z, r + 0.1);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (y + r < c.y0) continue;
      if (!colliderContains(c, x, z, r)) continue;
      if (y - r < colliderTop(c, x, z)) return c;
    }
    return null;
  }

  /** March a ray through the world. Returns the first solid hit within maxDist, or null. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, r = 0, out?: RayHit): RayHit | null {
    const step = 0.4;
    let t = 0, prev = 0;
    while (t <= maxDist) {
      const hit = this.solidAt(ox + dx * t, oy + dy * t, oz + dz * t, r);
      if (hit) {
        // refine between prev and t
        let lo = prev, hi = t;
        for (let i = 0; i < 5; i++) {
          const mid = (lo + hi) * 0.5;
          if (this.solidAt(ox + dx * mid, oy + dy * mid, oz + dz * mid, r)) hi = mid; else lo = mid;
        }
        const res = out || { t: 0, x: 0, y: 0, z: 0, collider: null };
        res.t = lo; res.x = ox + dx * lo; res.y = oy + dy * lo; res.z = oz + dz * lo;
        res.collider = hit === true ? null : hit;
        return res;
      }
      if (t === maxDist) break;
      prev = t;
      t = Math.min(maxDist, t + step);
    }
    return null;
  }

  /** Line of sight between two points (eye to eye). */
  los(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.01) return true;
    return !this.raycast(a.x, a.y, a.z, dx / d, dy / d, dz / d, d);
  }

  /** True if the point is in the hall safe zone. */
  inHallZone(z: number): boolean { return z < HALL_ZONE_Z; }

  // ------------------------------------------------------------------ construction

  private add(c: Omit<Collider, 'id' | 'seed' | 'hz' | 'yaw'> & { hz?: number; yaw?: number; seed?: number }): Collider {
    const id = this.nextId++;
    const full: Collider = {
      ...c,
      id,
      hz: c.hz ?? c.hx,
      yaw: c.yaw ?? 0,
      seed: c.seed ?? (Math.imul(id, 2654435761) >>> 0),
    };
    this.colliders.push(full);
    return full;
  }

  private box(kind: ColliderKind, x: number, z: number, hx: number, hz: number, y0: number, y1: number, surf: Surface, yaw = 0, tag?: string) {
    return this.add({ shape: 'box', kind, x, z, hx, hz, yaw, y0, y1, surf, tag });
  }

  private cyl(kind: ColliderKind, x: number, z: number, r: number, y0: number, y1: number, surf: Surface, tag?: string) {
    return this.add({ shape: 'cyl', kind, x, z, hx: r, y0, y1, surf, tag });
  }

  /** A deck between two points; becomes a ramp when the end heights differ. */
  private span(kind: ColliderKind, ax: number, az: number, ay: number, bx: number, bz: number, by: number, width: number, thick: number, surf: Surface) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    const c = this.add({
      shape: 'box', kind, x: (ax + bx) / 2, z: (az + bz) / 2, hx: len / 2, hz: width / 2, yaw: Math.atan2(dz, dx),
      y0: Math.min(ay, by) - thick, y1: ay, surf,
    });
    if (Math.abs(by - ay) > 1e-6) c.y1b = by;
    return c;
  }

  /** The barrier that seals the Skygate between matches (a dynamic collider both sides add). */
  gateBarrier(): Collider {
    const g = HALL.gate;
    return { id: 99999, shape: 'box', kind: 'gatepost', x: g.x, z: g.z, hx: g.halfWidth + 0.2, hz: 0.35, yaw: 0, y0: HALL.terrace.y - 1.5, y1: HALL.terrace.y + 9, surf: 'stone', seed: 1 };
  }

  /** Dynamic collider factory used by the simulation (not registered in the static grid). */
  makeDynamicBox(kind: ColliderKind, id: number, x: number, z: number, hx: number, hz: number, yaw: number, y0: number, y1: number): Collider {
    return { id, shape: 'box', kind, x, z, hx, hz, yaw, y0, y1, surf: 'rock', seed: id * 7919 };
  }

  private build() {
    const arena: Landmass = {
      id: 0, kind: 'arena', name: 'Vindheim', cx: 0, cz: 0, baseY: 0, radius: 62, rough: 0.09, seed: 3, depth: 46,
      notches: [{ angle: CHASM_ANGLE, halfWidth: 0.15, innerR: 21 }],
    };
    const hall: Landmass = { id: 1, kind: 'hall', name: 'Hearth-Hall', cx: HALL.cx, cz: HALL.cz, baseY: HALL.baseY, radius: 38, rough: 0.05, seed: 8, depth: 30, notches: [] };
    const ravenRock: Landmass = { id: 2, kind: 'islet', name: 'Raven Rock', cx: -84, cz: 4, baseY: 2.2, radius: 9.5, rough: 0.12, seed: 14, depth: 16, notches: [] };
    const shard: Landmass = { id: 3, kind: 'islet', name: 'The Shard', cx: -76, cz: -31, baseY: 5.5, radius: 6.5, rough: 0.14, seed: 19, depth: 13, notches: [] };
    const frostholm: Landmass = { id: 4, kind: 'islet', name: 'Frostholm', cx: 83, cz: 10, baseY: -0.6, radius: 8.5, rough: 0.12, seed: 27, depth: 15, notches: [] };
    const lastStep: Landmass = { id: 5, kind: 'islet', name: 'Last Step', cx: 12, cz: 88, baseY: 1.4, radius: 6.5, rough: 0.12, seed: 33, depth: 12, notches: [] };
    this.landmasses.push(arena, hall, ravenRock, shard, frostholm, lastStep);

    const th = (x: number, z: number) => this.landHeight(arena, x, z);
    const rng = new Rng(20261111);

    // ---------------- The Thing-stead: stone circle + central monolith
    const daisY = th(0, 0) + 0.5;
    this.cyl('dais', 0, 0, 4.2, -2, daisY, 'stone');
    this.cyl('monolith', 0, 0, 0.85, daisY, daisY + 6.2, 'stone');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * 12.5, z = Math.sin(a) * 12.5;
      const g = th(x, z);
      if (i === 2 || i === 6) {
        // toppled stones – low cover you can hop onto
        this.box('fallen', x + Math.cos(a) * 1.2, z + Math.sin(a) * 1.2, 2.3, 0.75, g - 0.5, g + 0.95, 'stone', a + 0.25);
      } else {
        this.box('standing', x, z, 0.55, 1.0, g - 1, g + rng.range(3.6, 5.2), 'stone', a);
      }
    }

    // ---------------- Northern highlands: two rock tiers, a peak, ramps and the Raven's Walk
    const T1 = 3.3, T2 = 6.3, PEAK = 8.7;
    this.box('rock', 0, -41, 19, 10.5, -6, T1, 'rock', 0.06);
    this.cyl('rock', -19, -37, 8.5, -6, T1, 'rock');
    this.cyl('rock', 20, -42, 7.5, -6, T1, 'rock');
    this.cyl('rock', 6, -30.5, 5, -6, T1, 'rock');
    this.box('rock', 4, -46, 9, 5.5, -6, T2, 'rock', -0.05);
    this.cyl('rock', -6, -46, 5, -6, T2, 'rock');
    this.cyl('rock', 9.6, -45, 1.6, -6, 7.5, 'rock');
    this.cyl('rock', 6.4, -48, 2.9, -6, PEAK, 'rock');
    // ramps: south-west and east up to tier one, a switchback up to tier two
    this.span('ramp', -17, -22.5, th(-17, -22.5) - 0.25, -17, -31, T1, 5, 6, 'rock');
    this.span('ramp', 33, -37, th(33, -37) - 0.25, 25.5, -39.5, T1, 4.6, 6, 'rock');
    this.span('ramp', -12.5, -38.5, T1, -7.5, -43.5, T2, 3.6, 6, 'rock');
    // stepping rocks for the acrobatic route up the south face
    this.cyl('rock', 13, -27.5, 1.9, -4, th(13, -27.5) + 1.3, 'rock');
    this.cyl('rock', 10.5, -29.6, 1.5, -4, th(10.5, -29.6) + 2.3, 'rock');
    // the Raven's Walk: a string of narrow shelves hanging outside the northern rim
    {
      let prev: { x: number; z: number } | null = null;
      for (let i = 0; i <= 9; i++) {
        const a = -2.25 + (i / 9) * 1.35;
        const r = this.edgeRadius(arena, a) + 0.9 + Math.sin(i * 1.9) * 0.5;
        const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
        if (prev && i !== 5) {
          // (i === 5 leaves a gap that must be jumped)
          this.span('ledge', prev.x, prev.z, 1.1, p.x, p.z, 1.1, 2.1, 1.4, 'rock');
        }
        prev = p;
      }
    }

    // ---------------- Frozen lake (east): ice crystals and the wreck of a longship
    const iceSpots: [number, number, number, number][] = [
      [30, -4, 1.3, 4.6], [33.5, 9.5, 1.0, 3.2], [45, 12, 1.5, 5.4], [47.5, 9.5, 0.9, 2.6], [41, 16.5, 1.1, 3.8],
      [25.5, 8, 0.9, 2.4], [50, -1, 1.2, 4.2], [36, 2.5, 0.8, 2.0],
    ];
    for (const [x, z, r, h] of iceSpots) this.cyl('icecrystal', x, z, r, -3, th(x, z) + h, 'ice');
    this.box('ship', 40.5, -6.5, 7.2, 1.9, -1.2, th(40.5, -6.5) + 1.15, 'wood', 0.5);
    this.cyl('mast', 40.5, -6.5, 0.32, -1, th(40.5, -6.5) + 8.5, 'wood');

    // ---------------- Ruins (south): a broken temple
    const RF = 1.0; // ruin floor height
    this.box('floor', RUINS.x, RUINS.z, 12, 8, -3, RF, 'stone');
    this.span('ramp', RUINS.x, 28.4, th(RUINS.x, 28.4) - 0.2, RUINS.x, 32.2, RF, 6.4, 3, 'stone');
    const pillarH = [6.4, 2.2, 6.4, 3.4, 6.4, 1.4, 4.8, 6.4, 2.8, 6.4];
    let pi = 0;
    for (const z of [35.2, 44.8]) for (const x of [-5, -0.5, 4, 8.5, 13]) {
      this.cyl('pillar', x, z, 0.72, RF, RF + pillarH[pi++ % pillarH.length], 'stone');
    }
    this.box('wall', -1.5, 48.6, 5.2, 0.6, RF - 1, RF + 4.4, 'stone');
    this.box('wall', 11.5, 48.6, 3.6, 0.6, RF - 1, RF + 2.6, 'stone');
    this.box('wall', -8.6, 42.5, 0.6, 3.6, RF - 1, RF + 3.3, 'stone');
    this.box('wall', 16.6, 38, 0.6, 2.6, RF - 1, RF + 2.0, 'stone');
    this.box('rubble', 6.6, 47.2, 1.0, 0.9, RF - 1, RF + 1.2, 'stone', 0.3);
    this.box('rubble', -6.4, 46.6, 1.2, 0.8, RF - 1, RF + 1.0, 'stone', -0.2);
    this.box('rubble', 14.6, 43.6, 0.9, 0.9, RF - 1, RF + 1.1, 'stone', 0.6);
    this.box('rubble', -11.5, 36, 1.3, 1.0, -1, th(-11.5, 36) + 1.0, 'stone', 0.9);
    this.box('rubble', 19.5, 44.5, 1.1, 1.4, -1, th(19.5, 44.5) + 1.2, 'stone', 0.4);
    // entrance arch at the top of the stair
    this.box('archpost', RUINS.x - 3.9, 32.6, 0.6, 0.6, RF - 1, RF + 5.0, 'stone');
    this.box('archpost', RUINS.x + 3.9, 32.6, 0.6, 0.6, RF - 1, RF + 5.0, 'stone');
    this.box('lintel', RUINS.x, 32.6, 4.7, 0.7, RF + 5.0, RF + 6.0, 'stone');

    // ---------------- The chasm (south-west) and its crossing
    {
      // bridge across the chasm where it is ~7 m wide
      const r = 36;
      const a0 = CHASM_ANGLE - 0.15 * 1.02, a1 = CHASM_ANGLE + 0.15 * 1.02;
      const ax = Math.cos(a0) * r, az = Math.sin(a0) * r, bx = Math.cos(a1) * r, bz = Math.sin(a1) * r;
      const ex = (bx - ax), ez = (bz - az), el = Math.sqrt(ex * ex + ez * ez);
      const ux = ex / el, uz = ez / el;
      // extend 1.6 m onto solid ground at both ends
      this.span('bridge', ax - ux * 1.6, az - uz * 1.6, th(ax - ux * 2, az - uz * 2) + 0.1, bx + ux * 1.6, bz + uz * 1.6, th(bx + ux * 2, bz + uz * 2) + 0.1, 2.6, 0.5, 'wood');
    }

    // ---------------- Outlying islets and their crossings
    const edgeX = (lm: Landmass, a: number, inset: number) => lm.cx + Math.cos(a) * (this.edgeRadius(lm, a) - inset);
    const edgeZ = (lm: Landmass, a: number, inset: number) => lm.cz + Math.sin(a) * (this.edgeRadius(lm, a) - inset);
    const lh = (lm: Landmass, x: number, z: number) => this.landHeight(lm, x, z);
    {
      // Arena west rim -> Raven Rock: a long stone bridge
      const a = Math.PI * 0.985;
      const ax = edgeX(arena, a, 2), az = edgeZ(arena, a, 2);
      const b = 0.0;
      const bx = edgeX(ravenRock, b, 1.8), bz = edgeZ(ravenRock, b, 1.8);
      this.span('bridge', ax, az, lh(arena, ax, az) + 0.12, bx, bz, lh(ravenRock, bx, bz) + 0.12, 2.3, 0.7, 'stone');
      // Raven Rock -> The Shard: a narrow rising ledge
      const c = -1.25;
      const cx2 = edgeX(ravenRock, c, 1.5), cz2 = edgeZ(ravenRock, c, 1.5);
      const d = 1.75;
      const dx2 = edgeX(shard, d, 1.4), dz2 = edgeZ(shard, d, 1.4);
      this.span('ledge', cx2, cz2, lh(ravenRock, cx2, cz2) + 0.1, dx2, dz2, lh(shard, dx2, dz2) + 0.1, 1.7, 0.9, 'rock');
      // The Shard -> arena north-west: two stepping stones (jumps)
      this.cyl('stepstone', -68.5, -33.5, 1.7, 2.8, 4.6, 'rock');
      this.cyl('stepstone', -62.6, -34.6, 1.6, 1.6, 3.4, 'rock');
    }
    {
      // Frozen lake -> Frostholm: an ice bridge (slippery!)
      const a = 0.12;
      const ax = edgeX(arena, a, 2), az = edgeZ(arena, a, 2);
      const b = Math.PI * 1.0;
      const bx = edgeX(frostholm, b, 1.6), bz = edgeZ(frostholm, b, 1.6);
      this.span('bridge', ax, az, lh(arena, ax, az) + 0.1, bx, bz, lh(frostholm, bx, bz) + 0.1, 2.6, 0.8, 'ice');
    }
    {
      // Ruins -> Last Step: the Broken Stair, floating stepping stones
      const a = Math.PI * 0.5 - 0.1;
      const sx = edgeX(arena, a, 0), sz = edgeZ(arena, a, 0);
      const b = -Math.PI * 0.5;
      const ex2 = edgeX(lastStep, b, 0), ez2 = edgeZ(lastStep, b, 0);
      const n = Math.max(3, Math.round(Math.sqrt((ex2 - sx) ** 2 + (ez2 - sz) ** 2) / 5.2));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = lerp(sx, ex2, t) + Math.sin(i * 2.4) * 1.1, z = lerp(sz, ez2, t);
        const y = lerp(0.2, 1.4, t) + Math.sin(i * 1.7) * 0.35;
        this.cyl('stepstone', x, z, 1.75 - (i % 2) * 0.25, y - 1.8, y, 'rock');
      }
    }

    // ---------------- Elemental shrines: one per element, ringed around the arena
    const shrineSpots: [number, number][] = [
      [-27, 12],   // ember  – west meadow
      [47, 3],     // frost  – on the lake
      [14, -44.5], // storm  – highlands, second tier
      [-30, -20],  // stone  – north-west rocks
      [-84, 4],    // gale   – Raven Rock
      [83, 10],    // tide   – Frostholm
      [-25, 36],   // umbra  – beyond the chasm
      [12, 88],    // dawn   – Last Step
    ];
    ELEMENT_ORDER.forEach((el, i) => {
      const [x, z] = shrineSpots[i];
      const g = this.groundForBuild(x, z);
      this.cyl('shrine', x, z, 0.62, g - 1, g + 2.7, 'stone', el);
      this.shrines.push({ element: el, x, y: g, z });
    });

    // ---------------- Scatter: boulders and pines
    const blocked = (x: number, z: number, pad: number) => {
      if (this.rimDistance(arena, x, z) < 4 + pad) return true;
      if (this.onLake(x, z)) return true;
      if (Math.sqrt(x * x + z * z) < 16) return true;
      if (Math.abs(x - 2) < 4 && z > 8 && z < 30) return true; // keep the path to the ruins open
      for (const c of this.colliders) {
        const ext = (c.shape === 'cyl' ? c.hx : Math.max(c.hx, c.hz)) + pad;
        if (Math.abs(x - c.x) < ext + 1.2 && Math.abs(z - c.z) < ext + 1.2) return true;
      }
      return false;
    };
    let placed = 0;
    for (let tries = 0; tries < 600 && placed < 20; tries++) {
      const x = rng.range(-58, 58), z = rng.range(-28, 58);
      const r = rng.range(1.0, 2.3);
      if (blocked(x, z, r)) continue;
      const g = th(x, z);
      this.cyl('rock', x, z, r, g - 2, g + rng.range(0.8, 1.2) * Math.min(2.6, r * 1.15), 'rock');
      placed++;
    }
    placed = 0;
    for (let tries = 0; tries < 900 && placed < 22; tries++) {
      // pines favour the west and the north-west
      const x = rng.range(-58, 30), z = rng.range(-30, 56);
      if (x > -8 && rng.chance(0.75)) continue;
      if (blocked(x, z, 0.6)) continue;
      const g = th(x, z);
      this.cyl('tree', x, z, 0.42, g - 1, g + rng.range(9, 13), 'wood');
      placed++;
    }

    // ---------------- Arena spawn points
    const spawnSpots: [number, number][] = [
      [-18, 16], [20, 18], [22, -14], [-24, -8], [0, 22], [-38, 22], [42, 22], [50, -8],
      [-44, -12], [4, 52], [-6, -36], [16, -40], [-30, 44], [26, 44], [-52, 4], [36, -24],
    ];
    for (const [x, z] of spawnSpots) {
      const y = this.groundForBuild(x, z);
      if (y <= VOID) continue;
      this.spawns.push({ x, y, z, yaw: Math.atan2(x, z) }); // face the centre
    }

    // ---------------- Health rune (pickup) spots: the risky places
    for (const [x, z] of [[0, 5.2], [-84, 0.5], [83, 13], [12, 85], [-76, -31], [6.4, -48], [40.5, -6.5], [4, 40]] as [number, number][]) {
      this.pickupSpots.push({ x, y: this.groundForBuild(x, z) + 1.0, z });
    }

    this.buildHall(hall);
  }

  /** Highest surface at build time (grid is not populated yet, so scan linearly). */
  private groundForBuild(x: number, z: number): number {
    let y = this.terrainHeight(x, z);
    for (const c of this.colliders) if (colliderContains(c, x, z, 0)) y = Math.max(y, colliderTop(c, x, z));
    return y;
  }

  private buildHall(_lm: Landmass) {
    const H = HALL, F = H.floorY;
    const midZ = (H.minZ + H.maxZ) / 2, lenZ = (H.maxZ - H.minZ) / 2;
    const wt = 0.4; // wall half-thickness
    this.box('hallfloor', 0, midZ, (H.maxX - H.minX) / 2, lenZ, H.baseY - 2, F, 'wood');
    this.box('hallwall', H.minX + wt, midZ, wt, lenZ, H.baseY - 1, H.wallTop, 'wood', 0, 'west');
    this.box('hallwall', H.maxX - wt, midZ, wt, lenZ, H.baseY - 1, H.wallTop, 'wood', 0, 'east');
    this.box('hallwall', 0, H.minZ + wt, (H.maxX - H.minX) / 2, wt, H.baseY - 1, H.wallTop, 'wood', 0, 'north');
    const segHalf = ((H.maxX - H.minX) / 2 - H.doorHalfWidth) / 2;
    this.box('hallwall', H.minX + segHalf, H.maxZ - wt, segHalf, wt, H.baseY - 1, H.wallTop, 'wood', 0, 'south-w');
    this.box('hallwall', H.maxX - segHalf, H.maxZ - wt, segHalf, wt, H.baseY - 1, H.wallTop, 'wood', 0, 'south-e');
    this.box('halllintel', 0, H.maxZ - wt, H.doorHalfWidth, wt, F + H.doorHeight, H.wallTop, 'wood');
    this.box('hallroof', 0, midZ, (H.maxX - H.minX) / 2 + 0.8, lenZ + 0.8, H.roofY0, H.roofY1, 'wood');

    // long fire down the middle, benches either side
    this.box('firepit', H.firepit.x, H.firepit.z, H.firepit.hx, H.firepit.hz, F - 0.5, F + 0.7, 'stone');
    this.box('bench', -2.9, H.firepit.z, 0.38, 3.6, F, F + 0.5, 'wood');
    this.box('bench', 2.9, H.firepit.z, 0.38, 3.6, F, F + 0.5, 'wood');
    // carved timber posts
    for (const z of [-148, -154.5, -161, -167.5, -174]) {
      this.cyl('timber', -5.4, z, 0.42, F, H.roofY0, 'wood');
      this.cyl('timber', 5.4, z, 0.42, F, H.roofY0, 'wood');
    }
    // the pedestal gallery: west wall then east wall, walking north from the door
    const pedZ = [-151.2, -157.7, -164.2, -170.7];
    ELEMENT_ORDER.forEach((el, i) => {
      const x = i < 4 ? -8.9 : 8.9;
      const z = pedZ[i % 4];
      this.cyl('pedestal', x, z, 1.05, F, F + 0.85, 'stone', el);
      this.pedestals[el] = { x, y: F + 0.85, z };
    });
    // high seat at the north end, mead tables beside it
    this.box('highdais', 0, -177, 5.2, 2.6, F - 0.2, F + 0.45, 'wood');
    this.box('throne', 0, -178.6, 1.0, 0.8, F + 0.45, F + 2.6, 'wood');
    this.box('table', -6.6, -176.6, 0.8, 2.0, F, F + 0.95, 'wood');
    this.box('table', 6.6, -176.6, 0.8, 2.0, F, F + 0.95, 'wood');

    // terrace, sparring ring and the Skygate
    this.box('terrace', H.terrace.x, H.terrace.z, H.terrace.hx, H.terrace.hz, H.baseY - 2, H.terrace.y, 'stone');
    this.cyl('ring', H.ring.x, H.ring.z, H.ring.r, H.baseY - 2, H.ring.y, 'stone');
    this.span('bridge', H.terrace.hx - 0.5, H.ring.z, H.terrace.y, H.ring.x - H.ring.r + 0.6, H.ring.z, H.ring.y, 3, 1.5, 'stone');
    this.cyl('gatepost', H.gate.x - H.gate.halfWidth - 0.7, H.gate.z, 0.7, H.baseY - 1, H.terrace.y + 6.2, 'stone');
    this.cyl('gatepost', H.gate.x + H.gate.halfWidth + 0.7, H.gate.z, 0.7, H.baseY - 1, H.terrace.y + 6.2, 'stone');

    for (const [x, z] of [[-2.6, -147.5], [2.6, -147.5], [0, -150], [-4, -151], [4, -151], [-2, -153], [2, -153], [0, -146.5]] as [number, number][]) {
      this.hallSpawns.push({ x, y: F, z, yaw: 0 });
    }
    const R = H.ring;
    for (const [dx, dz, yaw] of [[0, -3.6, Math.PI], [3.4, 2.2, -Math.PI * 0.35], [-3.4, 2.2, Math.PI * 0.35]] as [number, number, number][]) {
      this.dummySpots.push({ x: R.x + dx, y: R.y, z: R.z + dz, yaw });
    }
    for (const [x, z] of [[-3.4, -156], [3.4, -163], [-3.6, -165], [3.6, -155.5], [0, -172], [-6.8, -160.8], [6.8, -154.5], [0, -138], [-5, -130], [5, -127], [14, -133]] as [number, number][]) {
      this.hallPoints.push({ x, y: this.groundForBuild(x, z), z });
    }
  }
}

/** Shared immutable world instance (dynamic colliders are per-World, so the server makes one per room). */
let shared: World | null = null;
export function getStaticWorld(): World { return shared || (shared = new World()); }
