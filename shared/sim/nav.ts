// Navigation grid for the bots: a walkability map of the static world with A* search.
//
// The map is discovered by flood-filling outward from known walkable spots using the very same
// queries the physics uses (World.ground / World.resolveCircle), so a cell is walkable exactly
// when a fighter could walk there: ramps work, ledges block, roofs and lintels overhead are
// ignored, and one-way drops are one-way. Small gaps get "jump links".
// Built once (lazily) from the static World and shared by every room.

import { VOID, STEP_HEIGHT, getStaticWorld, type World } from '../world';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../types';
import type { Vec3 } from '../math';

const CELL = 1.5;
const MIN_X = -100, MAX_X = 100, MIN_Z = -196, MAX_Z = 100;
const W = Math.ceil((MAX_X - MIN_X) / CELL), H = Math.ceil((MAX_Z - MIN_Z) / CELL);
const MAX_DROP = 2.6;
/** Longest gap (in cells) a bot will jump. */
const JUMP_CELLS = 3;
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DZ = [0, 1, 1, 1, 0, -1, -1, -1];

export interface NavPath { pts: Vec3[]; jumps: boolean[] }

export class Nav {
  /** Walking height per cell (VOID = not walkable / unreachable). */
  readonly h = new Float32Array(W * H).fill(VOID);
  /** Extra traversal cost per cell (edges of the world are scary). */
  readonly cost = new Float32Array(W * H);
  /** Waypoint position per cell (nudged toward solid ground on narrow ledges). */
  readonly wx = new Float32Array(W * H);
  readonly wz = new Float32Array(W * H);
  /** Region id (1 = arena, 2 = hall island; 0 = unreachable). */
  readonly comp = new Uint8Array(W * H);
  /** Walkable neighbour directions (bit k = direction k). */
  private links = new Uint8Array(W * H);
  private jumpLinks = new Map<number, number[]>();

  // A* scratch
  private g = new Float32Array(W * H);
  private came = new Int32Array(W * H);
  private stamp = new Uint32Array(W * H);
  private closed = new Uint32Array(W * H);
  private gen = 0;
  private heap: number[] = [];
  private heapF: number[] = [];

  constructor(private world: World) {
    for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) {
      const i = iz * W + ix;
      this.wx[i] = MIN_X + (ix + 0.5) * CELL; this.wz[i] = MIN_Z + (iz + 0.5) * CELL;
    }
    this.flood(0, 8, 1);
    this.flood(0, -150, 2);
    this.finish();
  }

  cellOf(x: number, z: number): number {
    const ix = Math.floor((x - MIN_X) / CELL), iz = Math.floor((z - MIN_Z) / CELL);
    if (ix < 0 || iz < 0 || ix >= W || iz >= H) return -1;
    return iz * W + ix;
  }

  /** Is a body standing at (x, z, y) clear of walls? */
  private clear(x: number, z: number, y: number): boolean {
    const p = { x, z };
    this.world.resolveCircle(p, PLAYER_RADIUS, y, y + PLAYER_HEIGHT);
    return Math.hypot(p.x - x, p.z - z) < 0.25;
  }

  /** Height reached when walking from a point at height `y` to (x, z), or VOID if it cannot be walked. */
  private walkTo(fromX: number, fromZ: number, y: number, x: number, z: number): number {
    // check the midpoint first so a wall or a gap between the two cells is noticed
    const mx = (fromX + x) / 2, mz = (fromZ + z) / 2;
    const gm = this.world.ground(mx, mz, y).y;
    if (gm <= VOID || y - gm > MAX_DROP || !this.clear(mx, mz, gm)) return VOID;
    const g = this.world.ground(x, z, gm).y;
    if (g <= VOID || gm - g > MAX_DROP || y - g > MAX_DROP || !this.clear(x, z, g)) return VOID;
    return g;
  }

  private flood(sx: number, sz: number, id: number) {
    const start = this.cellOf(sx, sz);
    if (start < 0) return;
    const h0 = this.world.ground(this.wx[start], this.wz[start], this.world.terrainHeight(sx, sz) + 2.5).y;
    if (h0 <= VOID) return;
    this.h[start] = h0; this.comp[start] = id;
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const ix = i % W, iz = (i / W) | 0;
      const y = this.h[i];
      for (let k = 0; k < 8; k++) {
        const nx = ix + DX[k], nz = iz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const j = nz * W + nx;
        const g = this.walkTo(this.wx[i], this.wz[i], y, this.wx[j], this.wz[j]);
        if (g > VOID) {
          if (!this.comp[j]) { this.comp[j] = id; this.h[j] = g; queue.push(j); }
          // only link if we arrive at the height that cell is known by (single layer)
          if (Math.abs(this.h[j] - g) < 0.3) this.links[i] |= 1 << k;
        } else if ((k & 1) === 0 && this.world.ground(this.wx[j], this.wz[j], y).y <= VOID) {
          // a gap straight ahead: is there ground within jumping distance?
          for (let n = 2; n <= JUMP_CELLS + 1; n++) {
            const jx = ix + DX[k] * n, jz = iz + DZ[k] * n;
            if (jx < 0 || jz < 0 || jx >= W || jz >= H) break;
            const t = jz * W + jx;
            const g2 = this.world.ground(this.wx[t], this.wz[t], y + 1.0).y;
            if (g2 <= VOID) continue;
            if (Math.abs(g2 - y) <= 1.3 && this.clear(this.wx[t], this.wz[t], g2)) {
              if (!this.comp[t]) { this.comp[t] = id; this.h[t] = g2; queue.push(t); }
              if (Math.abs(this.h[t] - g2) < 0.3) {
                let arr = this.jumpLinks.get(i);
                if (!arr) this.jumpLinks.set(i, (arr = []));
                arr.push(t);
              }
            }
            break;
          }
        }
      }
    }
  }

  /** Edge costs and waypoint nudging once every cell is known. */
  private finish() {
    for (let i = 0; i < W * H; i++) {
      if (!this.comp[i]) continue;
      const cx = this.wx[i], cz = this.wz[i], y = this.h[i];
      let bad = 0, sx = 0, sz = 0, n = 0;
      for (let k = 0; k < 8; k++) {
        const px = cx + DX[k] * 0.9, pz = cz + DZ[k] * 0.9;
        const t = this.world.ground(px, pz, y).y;
        if (t <= VOID || y - t > MAX_DROP) bad++;
        else if (Math.abs(t - y) <= STEP_HEIGHT) { sx += px; sz += pz; n++; }
      }
      this.cost[i] = bad === 0 ? 0 : 2.5 + bad * 0.9;
      if (bad > 0 && n > 0) { this.wx[i] = (cx + (sx / n) * 2) / 3; this.wz[i] = (cz + (sz / n) * 2) / 3; }
    }
  }

  /** Is this spot on ground the bots can reach? */
  reachable(x: number, z: number): boolean {
    const c = this.cellOf(x, z);
    return c >= 0 && this.comp[c] !== 0;
  }

  /** Nearest reachable cell to a point (searches a small neighbourhood). */
  nearestCell(x: number, z: number): number {
    const c = this.cellOf(x, z);
    if (c >= 0 && this.comp[c]) return c;
    const ix = Math.floor((x - MIN_X) / CELL), iz = Math.floor((z - MIN_Z) / CELL);
    let best = -1, bd = 1e9;
    for (let r = 1; r <= 14 && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = ix + dx, nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const j = nz * W + nx;
        if (!this.comp[j]) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = j; }
      }
    }
    return best;
  }

  // ---- binary heap keyed by f
  private push(i: number, f: number) {
    const h = this.heap, hf = this.heapF;
    let k = h.length; h.push(i); hf.push(f);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      h[k] = h[p]; hf[k] = hf[p]; k = p;
    }
    h[k] = i; hf[k] = f;
  }
  private pop(): number {
    const h = this.heap, hf = this.heapF;
    const top = h[0];
    const li = h.pop()!, lf = hf.pop()!;
    const n = h.length;
    if (n > 0) {
      let k = 0;
      for (;;) {
        let c = k * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        h[k] = h[c]; hf[k] = hf[c]; k = c;
      }
      h[k] = li; hf[k] = lf;
    }
    return top;
  }

  /**
   * A* from (sx,sz) to (tx,tz). Returns waypoints (excluding the start) or null when there is no
   * route. `avoidJumps` is the extra cost of a gap-jump (they are risky).
   */
  findPath(sx: number, sz: number, tx: number, tz: number, avoidJumps = 6): NavPath | null {
    const start = this.nearestCell(sx, sz), goal = this.nearestCell(tx, tz);
    if (start < 0 || goal < 0) return null;
    if (this.comp[start] !== this.comp[goal]) return null;
    const exact = this.cellOf(tx, tz) === goal;
    const endPt = exact ? { x: tx, y: this.h[goal], z: tz } : { x: this.wx[goal], y: this.h[goal], z: this.wz[goal] };
    if (start === goal) return { pts: [endPt], jumps: [false] };
    const gen = ++this.gen;
    this.heap.length = 0; this.heapF.length = 0;
    const gx = goal % W, gz = (goal / W) | 0;
    const hfn = (i: number) => { const dx = Math.abs((i % W) - gx), dz = Math.abs(((i / W) | 0) - gz); return Math.max(dx, dz) + 0.41 * Math.min(dx, dz); };
    this.g[start] = 0; this.stamp[start] = gen; this.came[start] = -1;
    this.push(start, hfn(start));
    let expanded = 0;
    let found = false;
    const relax = (i: number, j: number, step: number, jump: boolean) => {
      if (this.closed[j] === gen) return;
      const ng = this.g[i] + step + this.cost[j] + (jump ? avoidJumps : 0);
      if (this.stamp[j] !== gen || ng < this.g[j]) {
        this.stamp[j] = gen; this.g[j] = ng;
        this.came[j] = jump ? -(i + 2) : i; // "arrived by jump" lives in the sign
        this.push(j, ng + hfn(j));
      }
    };
    while (this.heap.length && expanded < 9000) {
      const i = this.pop();
      if (this.closed[i] === gen) continue;
      this.closed[i] = gen;
      if (i === goal) { found = true; break; }
      expanded++;
      const ix = i % W, iz = (i / W) | 0;
      const mask = this.links[i];
      for (let k = 0; k < 8; k++) if (mask & (1 << k)) relax(i, (iz + DZ[k]) * W + ix + DX[k], k & 1 ? 1.414 : 1, false);
      const jl = this.jumpLinks.get(i);
      if (jl) for (const t of jl) relax(i, t, Math.hypot((t % W) - ix, ((t / W) | 0) - iz), true);
    }
    if (!found) return null;
    const cells: number[] = [], jumps: boolean[] = [];
    let c = goal;
    while (c !== start) {
      cells.push(c);
      const p = this.came[c];
      if (p < -1) { jumps.push(true); c = -p - 2; } else { jumps.push(false); c = p; }
      if (cells.length > 5000) return null;
    }
    cells.reverse(); jumps.reverse();
    const pts: Vec3[] = cells.map((i) => ({ x: this.wx[i], y: this.h[i], z: this.wz[i] }));
    pts[pts.length - 1] = endPt;
    return { pts, jumps };
  }
}

let nav: Nav | null = null;
export function getNav(): Nav { return nav || (nav = new Nav(getStaticWorld())); }
