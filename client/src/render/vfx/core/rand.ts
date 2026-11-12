// Tiny fast PRNG for effects (allocation-free, reseedable so stills are reproducible).

let s = 0x2f6e2b1 >>> 0;

export function reseed(seed: number): void { s = (seed >>> 0) || 1; }

/** Uniform in [0, 1). */
export function rnd(): number {
  s ^= s << 13; s >>>= 0;
  s ^= s >>> 17;
  s ^= s << 5; s >>>= 0;
  return s / 4294967296;
}
/** Uniform in [-1, 1). */
export const rnd2 = (): number => rnd() * 2 - 1;
export const rr = (a: number, b: number): number => a + (b - a) * rnd();
/** Stochastic rounding: 2.3 -> 2 (70 %) or 3 (30 %). */
export const rcount = (x: number): number => Math.floor(x + rnd());

// random unit vector, written to module scalars (no allocation)
export let ux = 0, uy = 1, uz = 0;
export function unit(): void {
  const z = rnd2(), a = rnd() * 6.2831853, r = Math.sqrt(Math.max(0, 1 - z * z));
  ux = Math.cos(a) * r; uy = z; uz = Math.sin(a) * r;
}
/** Random unit vector within `spread` radians of (dx,dy,dz) (which must be unit length). */
export function unitCone(dx: number, dy: number, dz: number, spread: number): void {
  const cosT = 1 - rnd() * (1 - Math.cos(spread));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT)), ph = rnd() * 6.2831853;
  // basis around d
  let ax: number, ay: number, az: number;
  if (Math.abs(dy) < 0.95) { ax = dz; ay = 0; az = -dx; } else { ax = 0; ay = -dz; az = dy; }
  const al = 1 / Math.sqrt(ax * ax + ay * ay + az * az); ax *= al; ay *= al; az *= al;
  const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
  const c = Math.cos(ph) * sinT, sn = Math.sin(ph) * sinT;
  ux = dx * cosT + ax * c + bx * sn; uy = dy * cosT + ay * c + by * sn; uz = dz * cosT + az * c + bz * sn;
}
