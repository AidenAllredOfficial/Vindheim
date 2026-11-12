// Strips: every ribbon trail, lightning bolt and tendril in the game is a camera-facing (or
// ground-flat) triangle strip living in ONE shared dynamic mesh (one draw call).
//
//  * ribbon mode – a trail: call move() every frame, points age out behind the head
//  * path mode   – an explicit polyline rewritten by its owner (bolts, tendrils, helices)

import * as THREE from 'three';
import { FOG_V, FOG_V_PARS, FRAG_END, FRAG_PARS, NOISE, fogUniforms, premult } from './glsl';
import { rnd } from './rand';

export const STRIP_POINTS = 32;

/** Fragment looks. */
export const enum SS { GLOW = 0, FIRE = 1, WIND = 2, WATER = 3, SMOKE = 4, BOLT = 5, ICE = 6, LIGHT = 7 }

const N = STRIP_POINTS;

export class Strip {
  active = false;
  /** 0 ribbon, 1 path */
  mode = 0;
  /** 0 camera-facing, 1 flat on the ground, 2 upright (side = world up) */
  orient = 0;
  style: SS = SS.GLOW;
  seed = 0;
  count = 0;
  readonly px = new Float32Array(N); readonly py = new Float32Array(N); readonly pz = new Float32Array(N);
  /** ribbon: birth time of each point · path: unused */
  readonly pt = new Float32Array(N);
  /** path: per-point width and alpha multipliers */
  readonly pw = new Float32Array(N); readonly pa = new Float32Array(N);
  width = 0.3;
  /** ribbon: seconds a point lives */
  life = 0.3;
  /** ribbon: width taper exponent along the tail (0 = constant width) and head taper length (0..1 of the trail) */
  taper = 1; headTaper = 0.12;
  r0 = 1; g0 = 1; b0 = 1; r1 = 1; g1 = 1; b1 = 1;
  alpha = 1;
  /** ribbon: minimum distance between committed points */
  minSeg = 0.2;
  released = false;
  /** path: remaining life once released (fades alpha) */
  fade = 0; fadeTime = 0.2;
  slot = 0;

  color(c0: THREE.Color, m0: number, c1: THREE.Color, m1: number): this {
    this.r0 = c0.r * m0; this.g0 = c0.g * m0; this.b0 = c0.b * m0;
    this.r1 = c1.r * m1; this.g1 = c1.g * m1; this.b1 = c1.b * m1;
    return this;
  }

  /** Ribbon: move the head. */
  move(x: number, y: number, z: number, now: number): void {
    let n = this.count;
    if (n === 0) {
      this.px[0] = this.px[1] = x; this.py[0] = this.py[1] = y; this.pz[0] = this.pz[1] = z;
      this.pt[0] = this.pt[1] = now; this.count = 2;
      return;
    }
    const h = n - 1;
    this.px[h] = x; this.py[h] = y; this.pz[h] = z; this.pt[h] = now;
    const dx = x - this.px[h - 1], dy = y - this.py[h - 1], dz = z - this.pz[h - 1];
    if (dx * dx + dy * dy + dz * dz > this.minSeg * this.minSeg) {
      if (n === N) {
        this.px.copyWithin(0, 1); this.py.copyWithin(0, 1); this.pz.copyWithin(0, 1); this.pt.copyWithin(0, 1);
        n--;
      }
      this.px[n] = x; this.py[n] = y; this.pz[n] = z; this.pt[n] = now;
      this.count = n + 1;
    }
  }

  /** Path: set a point. */
  set(i: number, x: number, y: number, z: number, w = 1, a = 1): void {
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.pw[i] = w; this.pa[i] = a;
  }

  /** Stop feeding the strip. Ribbons trail off as their points age; paths fade over `fadeTime`. */
  end(fadeTime = 0.2): void {
    if (!this.active || this.released) return;
    this.released = true;
    this.fadeTime = Math.max(fadeTime, 1e-3); this.fade = this.fadeTime;
  }
}

const VERT = /* glsl */ `
${FOG_V_PARS}
attribute vec4 aA; attribute vec4 aC;
varying vec4 vA; varying vec4 vC;
void main(){
  vA = aA; vC = aC;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_V}
}`;

const FRAG = /* glsl */ `
${FRAG_PARS}
${NOISE}
uniform float uTime;
varying vec4 vA; varying vec4 vC;
void main(){
  float u = vA.x, v = vA.y, len = vA.z;
  float style = floor(vA.w + 0.001), seed = fract(vA.w) * 31.0;
  float av = abs(v);
  vec3 col = vC.rgb; float a = 0.0; float add = 1.0; vec3 rgb = vec3(0.0);
  if (style < 0.5){                       // GLOW: soft line with a hot centre
    float g = pow(1.0 - av, 2.2), core = smoothstep(0.35, 0.0, av);
    a = g; rgb = col * (g * 0.6 + core * 0.9);
  } else if (style < 1.5){                // FIRE: licking, eroding toward the tail
    float n = vFbm(vec2(len * 1.6 - uTime * 5.0, v * 1.6 + seed));
    float edge = 1.0 - av;
    float body = smoothstep(0.0, 0.55, edge * (1.15 - u * 0.5) + (n - 0.5) * (0.5 + u));
    float core = smoothstep(0.35, 0.95, edge + (n - 0.5) * 0.5) * (1.0 - u);
    a = body; rgb = col * body * (0.45 + 0.55 * n) + vec3(1.0, 0.8, 0.5) * core * 0.9;
  } else if (style < 2.5){                // WIND: several thin racing streaks
    float n1 = vNoise(vec2(len * 0.9 - uTime * 9.0 + seed, v * 3.5 + seed));
    float n2 = vNoise(vec2(len * 2.3 - uTime * 14.0, v * 9.0 - seed));
    float lines = smoothstep(0.52, 0.8, n1) + 0.6 * smoothstep(0.6, 0.85, n2);
    float env = pow(1.0 - av, 1.2);
    float soft = env * env * 0.25;
    a = clamp(lines * env + soft, 0.0, 1.0); rgb = col * a;
    add = 0.85;
  } else if (style < 3.5){                // WATER: body + bright foam streaks, partly opaque
    float n = vFbm(vec2(len * 1.3 - uTime * 6.0, v * 2.0 + seed));
    float edge = 1.0 - av;
    float body = smoothstep(0.0, 0.3, edge + (n - 0.5) * 0.35);
    float foam = smoothstep(0.55, 0.8, n + (1.0 - edge) * 0.25) + smoothstep(0.25, 0.0, edge) * 0.6;
    a = body; rgb = col * (0.55 + 0.6 * edge) + vec3(0.85, 0.97, 1.0) * foam * 1.6;
    rgb *= a; add = 0.45;
  } else if (style < 4.5){                // SMOKE: dark body, coloured rim
    float n = vFbm(vec2(len * 1.4 - uTime * 1.6 + seed, v * 1.8 + seed));
    float edge = 1.0 - av;
    float body = smoothstep(0.0, 0.6, edge + (n - 0.5) * 0.9);
    float rim = smoothstep(0.5, 0.0, edge + (n - 0.5) * 0.6) * body;
    a = body * (0.9 - 0.25 * u);
    rgb = (vec3(0.012, 0.006, 0.02) * (0.4 + n) + col * rim * 1.3) * a;
    add = rim * 0.6;
  } else if (style < 5.5){                // BOLT: white-hot filament in a coloured sheath
    float core = smoothstep(0.26, 0.04, av);
    float glow = pow(1.0 - av, 3.0);
    a = max(core, glow);
    rgb = col * glow * 0.9 + mix(col, vec3(1.0), 0.75) * core * 2.6;
  } else if (style < 6.5){                // ICE: flat frozen ribbon on the ground
    vec2 c = vCell(vec2(len * 1.3 + seed, v * 1.6));
    float crack = smoothstep(0.08, 0.0, c.y - c.x);
    float edge = 1.0 - av;
    float body = smoothstep(0.0, 0.25, edge + (vNoise(vec2(len * 3.0, seed)) - 0.5) * 0.3);
    float rim = smoothstep(0.3, 0.0, edge) * body;
    float sparkle = step(0.985, vHash(floor(vec2(len * 14.0, v * 7.0)) + floor(uTime * 6.0)));
    a = body * 0.8;
    rgb = (col * (0.35 + 0.35 * c.x) + vec3(0.9, 0.98, 1.0) * (crack * 0.9 + rim * 1.4 + sparkle * 3.0)) * body;
    add = 0.35;
  } else {                                // LIGHT: needle-straight, very hot
    float core = smoothstep(0.3, 0.0, av);
    float glow = pow(1.0 - av, 2.0);
    float shimmer = 0.85 + 0.15 * sin(len * 9.0 - uTime * 40.0 + seed);
    a = max(core, glow) * shimmer;
    rgb = col * glow * 0.7 + vec3(1.0, 0.97, 0.88) * core * 2.4;
  }
  gl_FragColor = vfxFogged(rgb * vC.a, a * vC.a * (1.0 - add));
  ${FRAG_END}
}`;

export class Strips {
  readonly pool: Strip[] = [];
  private readonly pos: Float32Array; private readonly aA: Float32Array; private readonly aC: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  private wasActive = false;
  private cursor = 0;
  activeCount = 0;

  constructor(private scene: THREE.Scene, count: number) {
    for (let i = 0; i < count; i++) { const s = new Strip(); s.slot = i; this.pool.push(s); }
    const verts = count * N * 2;
    this.pos = new Float32Array(verts * 3);
    this.aA = new Float32Array(verts * 4);
    this.aC = new Float32Array(verts * 4);
    const idx = new Uint16Array(count * (N - 1) * 6);
    let k = 0;
    for (let s = 0; s < count; s++) for (let i = 0; i < N - 1; i++) {
      const b = (s * N + i) * 2;
      idx[k++] = b; idx[k++] = b + 1; idx[k++] = b + 2; idx[k++] = b + 1; idx[k++] = b + 3; idx[k++] = b + 2;
    }
    const geo = new THREE.BufferGeometry();
    const dyn = (a: Float32Array, n: number) => { const at = new THREE.BufferAttribute(a, n); at.setUsage(THREE.DynamicDrawUsage); return at; };
    geo.setAttribute('position', dyn(this.pos, 3));
    geo.setAttribute('aA', dyn(this.aA, 4));
    geo.setAttribute('aC', dyn(this.aC, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    this.mat = premult(new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), uTime: { value: 0 } },
      vertexShader: VERT, fragmentShader: FRAG, fog: true, side: THREE.DoubleSide,
    }));
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  private take(): Strip | null {
    const n = this.pool.length;
    for (let i = 0; i < n; i++) {
      const s = this.pool[(this.cursor + i) % n];
      if (!s.active) {
        this.cursor = (this.cursor + i + 1) % n;
        s.active = true; s.released = false; s.count = 0; s.fade = 0; s.seed = rnd();
        s.alpha = 1; s.taper = 1; s.headTaper = 0.12; s.orient = 0;
        return s;
      }
    }
    return null;
  }

  /** Start a ribbon trail. Returns null when the pool is exhausted (callers must cope). */
  ribbon(style: SS, width: number, life: number, minSeg = 0.2, orient = 0): Strip | null {
    const s = this.take();
    if (!s) return null;
    s.mode = 0; s.style = style; s.width = width; s.life = life; s.minSeg = minSeg; s.orient = orient;
    return s;
  }

  /** Start an explicit polyline of `count` points (fill them with set()). */
  path(style: SS, width: number, count: number, orient = 0): Strip | null {
    const s = this.take();
    if (!s) return null;
    s.mode = 1; s.style = style; s.width = width; s.count = Math.min(count, N); s.orient = orient;
    for (let i = 0; i < N; i++) { s.pw[i] = 1; s.pa[i] = 1; }
    return s;
  }

  update(dt: number, now: number, camera: THREE.Camera): void {
    this.mat.uniforms.uTime.value = now;
    const cx = camera.matrixWorld.elements[12], cy = camera.matrixWorld.elements[13], cz = camera.matrixWorld.elements[14];
    let any = false, active = 0;
    const pos = this.pos, aA = this.aA, aC = this.aC;
    for (let si = 0; si < this.pool.length; si++) {
      const s = this.pool[si];
      const base = si * N * 2;
      if (!s.active) continue;
      let n = s.count;
      let fadeMul = 1;
      if (s.mode === 0) {
        // drop expired tail points
        let drop = 0;
        while (drop < n - 1 && now - s.pt[drop + 1] > s.life) drop++;
        if (drop > 0) {
          s.px.copyWithin(0, drop, n); s.py.copyWithin(0, drop, n); s.pz.copyWithin(0, drop, n); s.pt.copyWithin(0, drop, n);
          n -= drop; s.count = n;
        }
        if (s.released && (n < 2 || now - s.pt[n - 1] > s.life)) { s.active = false; this.zero(base); any = true; continue; }
      } else if (s.released) {
        s.fade -= dt;
        if (s.fade <= 0) { s.active = false; this.zero(base); any = true; continue; }
        fadeMul = s.fade / s.fadeTime;
      }
      any = true; active++;
      if (n < 2) { this.zero(base); continue; }
      let len = 0;
      const styleSeed = s.style + s.seed * 0.98;
      for (let i = 0; i < N; i++) {
        const j = i < n ? i : n - 1; // pad with the last point (degenerate)
        const x = s.px[j], y = s.py[j], z = s.pz[j];
        const jp = j > 0 ? j - 1 : 0, jn = j < n - 1 ? j + 1 : n - 1;
        let tx = s.px[jn] - s.px[jp], ty = s.py[jn] - s.py[jp], tz = s.pz[jn] - s.pz[jp];
        if (i > 0 && i < n) { const ex = x - s.px[j - 1], ey = y - s.py[j - 1], ez = z - s.pz[j - 1]; len += Math.sqrt(ex * ex + ey * ey + ez * ez); }
        let sx: number, sy: number, sz: number;
        if (s.orient === 1) { sx = -tz; sy = 0; sz = tx; }
        else if (s.orient === 2) { sx = 0; sy = 1; sz = 0; }
        else {
          const vx = cx - x, vy = cy - y, vz = cz - z;
          sx = ty * vz - tz * vy; sy = tz * vx - tx * vz; sz = tx * vy - ty * vx;
        }
        let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (sl < 1e-6) { sx = 0; sy = 1; sz = 0; sl = 1; }
        let w: number, a: number, u: number, r: number, g: number, b: number;
        if (s.mode === 0) {
          const k = Math.min(1, Math.max(0, (now - s.pt[j]) / s.life)); // 0 at the head .. 1 at the tail
          u = k;
          const head = s.headTaper > 0 ? Math.min(1, k / s.headTaper + 0.25) : 1;
          w = s.width * (s.taper > 0 ? Math.pow(1 - k, s.taper) : 1) * head;
          a = s.alpha * (1 - k) * (s.released ? 1 : 1);
          r = s.r0 + (s.r1 - s.r0) * k; g = s.g0 + (s.g1 - s.g0) * k; b = s.b0 + (s.b1 - s.b0) * k;
        } else {
          u = n > 1 ? j / (n - 1) : 0;
          w = s.width * s.pw[j];
          a = s.alpha * s.pa[j] * fadeMul;
          r = s.r0 + (s.r1 - s.r0) * u; g = s.g0 + (s.g1 - s.g0) * u; b = s.b0 + (s.b1 - s.b0) * u;
        }
        const hw = (w * 0.5) / sl;
        sx *= hw; sy *= hw; sz *= hw;
        const o = (base + i * 2) * 3, q = (base + i * 2) * 4;
        pos[o] = x - sx; pos[o + 1] = y - sy; pos[o + 2] = z - sz;
        pos[o + 3] = x + sx; pos[o + 4] = y + sy; pos[o + 5] = z + sz;
        aA[q] = u; aA[q + 1] = -1; aA[q + 2] = len; aA[q + 3] = styleSeed;
        aA[q + 4] = u; aA[q + 5] = 1; aA[q + 6] = len; aA[q + 7] = styleSeed;
        aC[q] = r; aC[q + 1] = g; aC[q + 2] = b; aC[q + 3] = a;
        aC[q + 4] = r; aC[q + 5] = g; aC[q + 6] = b; aC[q + 7] = a;
      }
    }
    this.activeCount = active;
    if (any || this.wasActive) {
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.aA as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.aC as THREE.BufferAttribute).needsUpdate = true;
    }
    this.mesh.visible = active > 0;
    this.wasActive = any;
  }

  private zero(base: number): void {
    this.pos.fill(0, base * 3, (base + N * 2) * 3);
    this.aC.fill(0, base * 4, (base + N * 2) * 4);
  }

  clear(): void {
    for (const s of this.pool) s.active = false;
    this.pos.fill(0); this.aC.fill(0);
    this.wasActive = true;
    this.mesh.visible = false;
  }

  dispose(): void { this.scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
}

// ------------------------------------------------------------------------------------- bolts

const hashf = (a: number, b: number, c: number): number => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
};

class Bolt {
  strip: Strip | null = null;
  ax = 0; ay = 0; az = 0; bx = 0; by = 0; bz = 0;
  t0 = 0; life = 0.2; jag = 0.12; seed = 0; hz = 30; width = 0.3;
  n = 16;
  /** branch: parent bolt index and where along it we fork (-1 = none) */
  parent = -1; parentT = 0;
  /** taper the far end to a point (branches, crawling arcs) */
  taperEnd = false;
  delay = 0;
}

/** Jagged, flickering, branching lightning built on path strips. */
export class Bolts {
  private readonly pool: Bolt[] = [];
  private px = 0; private py = 0; private pz = 0;

  constructor(private strips: Strips, count: number) {
    for (let i = 0; i < count; i++) this.pool.push(new Bolt());
  }

  /**
   * Fire a bolt from A to B. `jag` = lateral displacement as a fraction of the length,
   * `branches` = forks, returns nothing: bolts are fire-and-forget.
   */
  fire(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c0: THREE.Color, m0: number, c1: THREE.Color, m1: number,
       width: number, life: number, jag: number, branches: number, now: number, delay = 0, taperEnd = false): void {
    const main = this.spawn(ax, ay, az, bx, by, bz, c0, m0, c1, m1, width, life, jag, now, -1, 0, taperEnd, delay);
    if (main < 0) return;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    for (let i = 0; i < branches; i++) {
      const t = 0.2 + 0.6 * rnd();
      const bl = len * (0.18 + 0.25 * rnd());
      // fork direction: mostly forward, pushed sideways
      const dx = (bx - ax) / (len + 1e-6), dy = (by - ay) / (len + 1e-6), dz = (bz - az) / (len + 1e-6);
      const ex = dx + (rnd() * 2 - 1) * 1.1, ey = dy + (rnd() * 2 - 1) * 1.1, ez = dz + (rnd() * 2 - 1) * 1.1;
      const el = Math.hypot(ex, ey, ez) + 1e-6;
      const sx = ax + (bx - ax) * t, sy = ay + (by - ay) * t, sz = az + (bz - az) * t;
      this.spawn(sx, sy, sz, sx + (ex / el) * bl, sy + (ey / el) * bl, sz + (ez / el) * bl, c0, m0 * 0.7, c1, m1 * 0.7, width * 0.55, life * (0.6 + 0.4 * rnd()), jag * 1.6, now, main, t, true, delay);
    }
  }

  private spawn(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c0: THREE.Color, m0: number, c1: THREE.Color, m1: number,
                width: number, life: number, jag: number, now: number, parent: number, parentT: number, taperEnd: boolean, delay: number): number {
    for (let i = 0; i < this.pool.length; i++) {
      const b = this.pool[i];
      if (b.strip) continue;
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const n = Math.max(5, Math.min(STRIP_POINTS, Math.round(6 + len * 1.6)));
      const s = this.strips.path(SS.BOLT, width, n);
      if (!s) return -1;
      s.color(c0, m0, c1, m1);
      b.strip = s; b.n = n;
      b.ax = ax; b.ay = ay; b.az = az; b.bx = bx; b.by = by; b.bz = bz;
      b.t0 = now + delay; b.life = life; b.jag = jag; b.seed = Math.floor(rnd() * 65536); b.width = width;
      b.parent = parent; b.parentT = parentT; b.taperEnd = taperEnd; b.delay = delay;
      b.hz = 26 + rnd() * 14;
      s.alpha = 0;
      return i;
    }
    return -1;
  }

  /** Point on a bolt at parameter t for flicker step `step` (written to px/py/pz). */
  private point(b: Bolt, t: number, step: number): void {
    const dx = b.bx - b.ax, dy = b.by - b.ay, dz = b.bz - b.az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
    // two perpendicular axes
    let ux: number, uy: number, uz: number;
    if (Math.abs(dy) < 0.9 * len) { ux = dz; uy = 0; uz = -dx; } else { ux = 0; uy = -dz; uz = dy; }
    const ul = 1 / (Math.sqrt(ux * ux + uy * uy + uz * uz) + 1e-6); ux *= ul; uy *= ul; uz *= ul;
    const wx = (dy * uz - dz * uy) / len, wy = (dz * ux - dx * uz) / len, wz = (dx * uy - dy * ux) / len;
    const env = b.taperEnd ? Math.min(1, t * 4) : Math.sin(Math.PI * t);
    const amp = b.jag * len * env;
    // coarse kinks + fine jitter
    const k = t * 5, ki = Math.floor(k), kf = k - ki;
    const c1 = hashf(ki, b.seed, step), c2 = hashf(ki + 1, b.seed, step);
    const d1 = hashf(ki, b.seed + 9, step), d2 = hashf(ki + 1, b.seed + 9, step);
    const fi = Math.round(t * (b.n - 1));
    const o1 = (c1 + (c2 - c1) * kf) * amp + hashf(fi, b.seed + 3, step) * amp * 0.35;
    const o2 = (d1 + (d2 - d1) * kf) * amp + hashf(fi, b.seed + 5, step) * amp * 0.35;
    this.px = b.ax + dx * t + ux * o1 + wx * o2;
    this.py = b.ay + dy * t + uy * o1 + wy * o2;
    this.pz = b.az + dz * t + uz * o1 + wz * o2;
  }

  update(now: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const b = this.pool[i];
      const s = b.strip;
      if (!s) continue;
      const age = now - b.t0;
      if (age < 0) { s.alpha = 0; continue; }
      if (age >= b.life || !s.active) { s.end(0.001); b.strip = null; continue; }
      const k = age / b.life;
      const step = Math.floor(age * b.hz);
      // a branch stays rooted on its (re-jittering) parent
      if (b.parent >= 0) {
        const p = this.pool[b.parent];
        if (p.strip) {
          const pstep = Math.floor((now - p.t0) * p.hz);
          this.point(p, b.parentT, pstep);
          const ox = this.px - b.ax, oy = this.py - b.ay, oz = this.pz - b.az;
          b.ax += ox; b.ay += oy; b.az += oz; b.bx += ox; b.by += oy; b.bz += oz;
        }
      }
      const flick = 0.65 + 0.35 * hashf(step, b.seed, 77);
      s.alpha = Math.pow(1 - k, 0.7) * flick;
      s.width = b.width * (1 - 0.5 * k);
      for (let j = 0; j < b.n; j++) {
        const t = j / (b.n - 1);
        this.point(b, t, step);
        const w = b.taperEnd ? 1 - 0.85 * t : 1;
        s.set(j, this.px, this.py, this.pz, w, 1);
      }
    }
  }

  clear(): void { for (const b of this.pool) b.strip = null; }
}
