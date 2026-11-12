// Small dependency-free math helpers shared by the simulation, server and client.

export interface Vec3 { x: number; y: number; z: number }

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vcopy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const vset = (o: Vec3, x: number, y: number, z: number): Vec3 => { o.x = x; o.y = y; o.z = z; return o; };
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vlen = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vlen2 = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const vdist = (a: Vec3, b: Vec3): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
export const vdistXZ = (a: Vec3, b: Vec3): number => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
export const vnorm = (a: Vec3): Vec3 => { const l = vlen(a); return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 }; };
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const sign = (v: number): number => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const approach = (v: number, target: number, maxDelta: number): number => (v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta));

/** Wrap an angle to (-PI, PI]. */
export const wrapAngle = (a: number): number => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const angleDiff = (from: number, to: number): number => wrapAngle(to - from);
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDiff(a, b) * t;
export const approachAngle = (a: number, b: number, maxDelta: number): number => { const d = angleDiff(a, b); return Math.abs(d) <= maxDelta ? b : a + sign(d) * maxDelta; };

/**
 * Convention used everywhere: yaw 0 looks toward -Z, positive yaw turns left (toward -X),
 * pitch positive looks up. forward = (-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)).
 */
export const dirFromYawPitch = (yaw: number, pitch: number): Vec3 => {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
};
export const yawFromDir = (x: number, z: number): number => Math.atan2(-x, -z);
export const pitchFromDir = (d: Vec3): number => Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z));

// ---------- deterministic hashing / noise ----------
export const hash2 = (x: number, y: number, seed = 0): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
export const hash1 = (x: number, seed = 0): number => hash2(x, 7919, seed);

/** Smooth 2D value noise in [0,1]. */
export const noise2 = (x: number, y: number, seed = 0): number => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
/** Fractal noise in [0,1]. */
export const fbm2 = (x: number, y: number, octaves = 4, seed = 0): number => {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += amp * noise2(x * f, y * f, seed + i * 17); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
};

/** Small seedable PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  gauss(): number { return (this.next() + this.next() + this.next() + this.next() - 2) * 1.2247; }
}

export const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
