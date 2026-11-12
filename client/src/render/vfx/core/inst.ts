// Instanced mesh effects. One InstBatch = one geometry + one look = one draw call.
//
// An instance is either CLOSED-FORM (written once: ballistic motion, spin, grow-in, shrink-out,
// scale-over-life are all evaluated in the vertex shader) or LIVE (its owner rewrites it every
// frame from simulation state – projectiles, walls, status shells).

import * as THREE from 'three';
import { FOG_V, FOG_V_PARS, FRAG_END, FRAG_PARS, NOISE, fogUniforms, premult } from './glsl';
import { rnd } from './rand';

const STRIDE = 32;

/** Scratch description of one instance. Fill it in, then spawn()/write() it into a batch. */
export class InstSpec {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  life = 1; delay = 0;
  qx = 0; qy = 0; qz = 0; qw = 1;
  sx = 1; sy = 1; sz = 1;
  grav = 0;
  r0 = 1; g0 = 1; b0 = 1; a0 = 1;
  r1 = 1; g1 = 1; b1 = 1; a1 = 1;
  /** Tumble (rad/s) around a random axis. */
  spin = 0;
  /** Time at which ballistic motion stops (the chunk has landed). */
  tHit = 1e9;
  growIn = 0; shrinkOut = 0;
  /** Scale multiplier reached at the end of life (ease-out). */
  scaleEnd = 1;
  style = 0; p1 = 0; p2 = 0;
  /** Live instances keep their original birth time so shader animation stays continuous. */
  birth = NaN;

  reset(): this {
    this.x = this.y = this.z = 0; this.vx = this.vy = this.vz = 0; this.life = 1; this.delay = 0;
    this.qx = this.qy = this.qz = 0; this.qw = 1; this.sx = this.sy = this.sz = 1; this.grav = 0;
    this.r0 = this.g0 = this.b0 = this.a0 = 1; this.r1 = this.g1 = this.b1 = this.a1 = 1;
    this.spin = 0; this.tHit = 1e9; this.growIn = 0; this.shrinkOut = 0; this.scaleEnd = 1;
    this.style = 0; this.p1 = 0; this.p2 = 0; this.birth = NaN;
    return this;
  }
  pos(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  vel(x: number, y: number, z: number): this { this.vx = x; this.vy = y; this.vz = z; return this; }
  scale(x: number, y = x, z = x): this { this.sx = x; this.sy = y; this.sz = z; return this; }
  c0(c: THREE.Color, m = 1, a = 1): this { this.r0 = c.r * m; this.g0 = c.g * m; this.b0 = c.b * m; this.a0 = a; return this; }
  c1(c: THREE.Color, m = 1, a = 1): this { this.r1 = c.r * m; this.g1 = c.g * m; this.b1 = c.b * m; this.a1 = a; return this; }
  /** Rotation about +Y (same as object.rotation.y = a). */
  yaw(a: number): this { this.qx = 0; this.qy = Math.sin(a * 0.5); this.qz = 0; this.qw = Math.cos(a * 0.5); return this; }
  /** Shortest rotation taking the unit vector (ax,ay,az) onto the unit vector (bx,by,bz). */
  fromTo(ax: number, ay: number, az: number, bx: number, by: number, bz: number): this {
    const d = ax * bx + ay * by + az * bz;
    if (d < -0.9999) {
      // opposite: any perpendicular axis
      let px = 0, py = -az, pz = ay;
      if (Math.abs(ax) > 0.9) { px = -ay; py = ax; pz = 0; } else { px = 0; py = -az; pz = ay; }
      const l = 1 / Math.sqrt(px * px + py * py + pz * pz);
      this.qx = px * l; this.qy = py * l; this.qz = pz * l; this.qw = 0;
      return this;
    }
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx, w = 1 + d;
    const l = 1 / Math.sqrt(cx * cx + cy * cy + cz * cz + w * w);
    this.qx = cx * l; this.qy = cy * l; this.qz = cz * l; this.qw = w * l;
    return this;
  }
  /** Point the local +Y axis along a unit direction. */
  aimY(dx: number, dy: number, dz: number): this { return this.fromTo(0, 1, 0, dx, dy, dz); }
  /** Point the local +Z axis along a unit direction, keeping local +Y as upright as possible. */
  aimZ(dx: number, dy: number, dz: number): this {
    const yaw = Math.atan2(dx, dz), pitch = -Math.asin(Math.max(-1, Math.min(1, dy)));
    const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5), cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
    // q = qYaw * qPitch(X)
    this.qx = cy * sp; this.qy = sy * cp; this.qz = -sy * sp; this.qw = cy * cp;
    return this;
  }
  /** Post-multiply a roll around the local +Z axis. */
  roll(a: number): this {
    const s = Math.sin(a * 0.5), c = Math.cos(a * 0.5);
    const x = this.qx, y = this.qy, z = this.qz, w = this.qw;
    this.qx = x * c + y * s; this.qy = y * c - x * s; this.qz = z * c + w * s; this.qw = w * c - z * s;
    return this;
  }
  /** Post-multiply a pitch around the local +X axis. */
  pitch(a: number): this {
    const s = Math.sin(a * 0.5), c = Math.cos(a * 0.5);
    const x = this.qx, y = this.qy, z = this.qz, w = this.qw;
    this.qx = x * c + w * s; this.qy = y * c + z * s; this.qz = z * c - y * s; this.qw = w * c - x * s;
    return this;
  }
  randomRot(): this {
    const u1 = rnd(), u2 = rnd() * 6.2831853, u3 = rnd() * 6.2831853;
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    this.qx = a * Math.sin(u2); this.qy = a * Math.cos(u2); this.qz = b * Math.sin(u3); this.qw = b * Math.cos(u3);
    return this;
  }
}

/** The shared scratch spec. */
export const I = new InstSpec();

export class InstBatch {
  readonly cap: number;
  readonly mesh: THREE.Mesh;
  private readonly data: Float32Array;
  private readonly death: Float32Array;
  private readonly buf: THREE.InstancedInterleavedBuffer;
  private readonly geo: THREE.InstancedBufferGeometry;
  private cursor = 0; private high = 0;
  private dMin = -1; private dMax = -1;
  private range = { start: 0, count: 0 };
  private now = 0;
  private maxDeath = 0; private liveInf = 0;

  constructor(private scene: THREE.Scene, base: THREE.BufferGeometry, readonly material: THREE.ShaderMaterial, cap: number, order: number) {
    this.cap = cap;
    this.data = new Float32Array(cap * STRIDE);
    this.death = new Float32Array(cap);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.attributes[name]);
    const names = ['iA', 'iB', 'iC', 'iD', 'iE', 'iF', 'iG', 'iH'];
    for (let i = 0; i < 8; i++) geo.setAttribute(names[i], new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4));
    geo.instanceCount = 0;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  private put(slot: number, s: InstSpec, birth: number): void {
    const a = this.data, o = slot * STRIDE;
    a[o] = s.x; a[o + 1] = s.y; a[o + 2] = s.z; a[o + 3] = birth;
    a[o + 4] = s.vx; a[o + 5] = s.vy; a[o + 6] = s.vz; a[o + 7] = s.life;
    a[o + 8] = s.qx; a[o + 9] = s.qy; a[o + 10] = s.qz; a[o + 11] = s.qw;
    a[o + 12] = s.sx; a[o + 13] = s.sy; a[o + 14] = s.sz; a[o + 15] = s.grav;
    a[o + 16] = s.r0; a[o + 17] = s.g0; a[o + 18] = s.b0; a[o + 19] = s.a0;
    a[o + 20] = s.r1; a[o + 21] = s.g1; a[o + 22] = s.b1; a[o + 23] = s.a1;
    a[o + 24] = s.spin; a[o + 25] = s.tHit; a[o + 26] = s.growIn; a[o + 27] = s.shrinkOut;
    a[o + 28] = s.scaleEnd; a[o + 29] = s.style; a[o + 30] = s.p1; a[o + 31] = s.p2;
    if (this.dMin < 0 || slot < this.dMin) this.dMin = slot;
    if (slot > this.dMax) this.dMax = slot;
  }

  /** Closed-form instance: lives for s.life seconds (after s.delay). Returns its slot. */
  spawn(s: InstSpec = I): number {
    const slot = this.alloc();
    if (slot < 0) return -1;
    const birth = this.now + s.delay;
    this.death[slot] = birth + s.life;
    if (this.death[slot] > this.maxDeath) this.maxDeath = this.death[slot];
    this.put(slot, s, birth);
    return slot;
  }

  /** Live instance: stays until kill(). Rewrite it each frame with write(). */
  spawnLive(s: InstSpec = I): number {
    const slot = this.alloc();
    if (slot < 0) return -1;
    this.death[slot] = Infinity; this.liveInf++;
    s.life = 1e9;
    this.put(slot, s, isNaN(s.birth) ? this.now : s.birth);
    return slot;
  }

  /** Rewrite a live instance. The birth time is preserved unless s.birth is set. */
  write(slot: number, s: InstSpec = I): void {
    if (slot < 0) return;
    s.life = 1e9;
    this.put(slot, s, isNaN(s.birth) ? this.data[slot * STRIDE + 3] : s.birth);
  }

  birthOf(slot: number): number { return slot < 0 ? this.now : this.data[slot * STRIDE + 3]; }

  /** Remove a live instance immediately. */
  kill(slot: number): void {
    if (slot < 0 || this.death[slot] !== Infinity) return;
    this.death[slot] = 0; this.liveInf--;
    const o = slot * STRIDE;
    this.data[o + 3] = -1e9; this.data[o + 7] = 1e-3;
    if (this.dMin < 0 || slot < this.dMin) this.dMin = slot;
    if (slot > this.dMax) this.dMax = slot;
  }

  /** Turn a live instance into a closed-form one that plays out over s.life seconds from now. */
  finish(slot: number, s: InstSpec = I): void {
    if (slot < 0 || this.death[slot] !== Infinity) return;
    this.liveInf--;
    this.death[slot] = this.now + s.life;
    if (this.death[slot] > this.maxDeath) this.maxDeath = this.death[slot];
    this.put(slot, s, this.now);
  }

  /** Time at which a slot's instance ends (Infinity for live ones). */
  deathOf(slot: number): number { return slot < 0 ? 0 : this.death[slot]; }

  /**
   * Cut a closed-form instance short: it shrinks away over `fade` seconds. `death` must be the
   * value deathOf() returned at spawn, so a recycled slot is never touched.
   */
  cut(slot: number, death: number, fade: number): void {
    if (slot < 0 || this.death[slot] !== death || death === Infinity) return;
    const end = this.now + fade;
    if (end >= death) return;
    const o = slot * STRIDE;
    this.death[slot] = end;
    this.data[o + 7] = Math.max(1e-3, end - this.data[o + 3]);
    this.data[o + 27] = fade;
    if (this.dMin < 0 || slot < this.dMin) this.dMin = slot;
    if (slot > this.dMax) this.dMax = slot;
  }

  private alloc(): number {
    const n = this.cap;
    for (let i = 0; i < n; i++) {
      const s = (this.cursor + i) % n;
      if (this.death[s] <= this.now) {
        this.cursor = (s + 1) % n;
        if (s + 1 > this.high) this.high = s + 1;
        return s;
      }
    }
    return -1;
  }

  update(now: number): void {
    this.now = now;
    this.material.uniforms.uTime.value = now;
    if (this.dMin >= 0) {
      const r = this.buf.updateRanges;
      if (r.length > 0) r.length = 0; // previous range not uploaded yet: upload everything
      else { this.range.start = this.dMin * STRIDE; this.range.count = (this.dMax - this.dMin + 1) * STRIDE; r.push(this.range); }
      this.buf.needsUpdate = true;
      this.geo.instanceCount = this.high;
      this.dMin = -1; this.dMax = -1;
    }
    this.mesh.visible = this.liveInf > 0 || this.maxDeath > now;
  }

  liveCount(): number { let n = 0; for (let i = 0; i < this.high; i++) if (this.death[i] > this.now) n++; return n; }

  clear(): void {
    this.death.fill(0); this.data.fill(0);
    this.cursor = 0; this.high = 0; this.liveInf = 0; this.maxDeath = 0; this.dMin = -1; this.dMax = -1;
    this.buf.updateRanges.length = 0; this.buf.needsUpdate = true;
    this.geo.instanceCount = 0; this.mesh.visible = false;
  }

  dispose(): void { this.scene.remove(this.mesh); this.geo.dispose(); }
}

// =========================================================================================
// Shaders
// =========================================================================================

/** Shared vertex core. `deform` may edit lp (local position), ln (local normal), S (scale), grow3. */
function vert(deform: string, pars = ''): string {
  return /* glsl */ `
${FOG_V_PARS}
uniform float uTime;
attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD;
attribute vec4 iE; attribute vec4 iF; attribute vec4 iG; attribute vec4 iH;
varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
varying vec4 vC0; varying vec4 vC1; varying vec4 vPar; varying vec3 vInfo;
${NOISE}
${pars}
vec3 qrot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec4 qmul(vec4 a, vec4 b){ return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
void main(){
  float age = uTime - iA.w;
  float k = age / iB.w;
  if (k < 0.0 || k >= 1.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float tt = min(age, iG.y);
  vec3 P = iA.xyz + iB.xyz * tt + vec3(0.0, -0.5 * iD.w * tt * tt, 0.0);
  float seed = fract(iA.w * 7.31 + iA.x * 3.17 + iA.z * 1.93 + iD.x * 5.3);
  vec4 Q = iC;
  if (iG.x != 0.0){
    vec3 ax = normalize(vec3(sin(seed * 40.0), cos(seed * 71.0), sin(seed * 13.0 + 1.0)));
    float ang = iG.x * tt;
    Q = qmul(vec4(ax * sin(ang * 0.5), cos(ang * 0.5)), Q);
  }
  float grow = iG.z > 0.0 ? clamp(age / iG.z, 0.0, 1.0) : 1.0;
  grow = 1.0 - (1.0 - grow) * (1.0 - grow);
  float shrink = iG.w > 0.0 ? clamp((iB.w - age) / iG.w, 0.0, 1.0) : 1.0;
  float e = 1.0 - pow(1.0 - k, 3.0);
  vec3 S = iD.xyz * mix(1.0, iH.x, e);
  vec3 grow3 = vec3(grow * shrink);
  vec3 lp = position; vec3 ln = normal;
  float style = iH.y, p1 = iH.z, p2 = iH.w;
  vUv = uv;
  bool billboard = false;
  ${deform}
  vec3 sc = S * grow3;
  vec3 wp;
  if (billboard){
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = P + right * lp.x * sc.x + up * lp.y * sc.y;
    vNormal = normalize(cameraPosition - P);
  } else {
    wp = P + qrot(Q, lp * sc);
    vNormal = normalize(qrot(Q, ln / max(sc, vec3(1e-4))));
  }
  vLocal = lp; vWorld = wp;
  vC0 = iE; vC1 = iF; vPar = vec4(style, p1, p2, seed); vInfo = vec3(k, age, shrink);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_V}
}`;
}

const FRAG_HEAD = /* glsl */ `
${FRAG_PARS}
${NOISE}
uniform float uTime;
varying vec3 vLocal; varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
varying vec4 vC0; varying vec4 vC1; varying vec4 vPar; varying vec3 vInfo;
// calibrates emissive meshes against the bloom
#define GAIN 0.62
`;

// ---------------------------------------------------------------- FACET: rock / ice / blade / wall
/** styles: 0 rock (p1 = molten glow) · 1 ice · 2 shadow blade · 3 rampart wall. p2 > 0.5 (styles 0..2): erupt along local +Y. */
const FACET_FRAG = /* glsl */ `
${FRAG_HEAD}
uniform vec3 uLightDir; uniform vec3 uLightCol; uniform vec3 uSkyCol; uniform vec3 uGroundCol;
void main(){
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float style = vPar.x, p1 = vPar.y, p2 = vPar.z, seed = vPar.w;
  vec3 L = normalize(uLightDir);
  float nl = max(dot(N, L), 0.0);
  float hemi = N.y * 0.5 + 0.5;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 amb = mix(uGroundCol, uSkyCol, hemi);
  vec3 rgb; float alpha = 1.0;
  if (style < 0.5){
    vec3 q = vLocal * 2.3 + seed * 17.0;
    float n = vFbm3(q);
    float grit = vNoise3(q * 5.0);
    vec3 base = vC0.rgb * (0.5 + 0.55 * n) * (0.88 + 0.24 * grit);
    rgb = base * (uLightCol * nl + amb) + vC1.rgb * fres * 0.3 * vC1.a;
    float cr = abs(vNoise3(vLocal * 2.6 + seed * 5.0) - 0.5);
    float crack = smoothstep(0.07, 0.0, cr);
    rgb = mix(rgb, rgb * 0.35, crack * 0.7);
    rgb += vC1.rgb * p1 * (crack * 1.5 + smoothstep(0.25, 0.0, cr) * 0.22 + fres * 0.2);
  } else if (style < 1.5){
    float inner = vNoise3(vLocal * 3.0 + seed * 9.0);
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 26.0);
    float spec2 = pow(max(dot(reflect(vec3(0.0, -1.0, 0.0), N), V), 0.0), 9.0);
    float facet = 0.55 + 0.9 * vHash3(floor(N * 3.0 + 0.5) + seed);
    vec3 base = vC0.rgb * (0.3 + 0.45 * hemi + 0.25 * inner) * facet;
    rgb = base * (uLightCol * nl * 0.7 + amb * 1.6 + 0.3) + vC1.rgb * (fres * 1.5 + spec * 2.2 + spec2 * 0.5 + smoothstep(0.62, 0.9, inner) * 0.3);
    rgb *= vC0.a;
    #ifdef TRANSLUCENT
      alpha = clamp(0.34 + 0.25 * facet + 0.5 * fres + spec, 0.0, 0.95) * vC1.a * vInfo.z;
      gl_FragColor = vfxFogged(rgb * alpha, alpha * 0.85);
      ${FRAG_END}
      return;
    #endif
  } else if (style < 2.5){
    float edge = smoothstep(0.55, 1.0, abs(vLocal.x) * 5.0 + fres);
    rgb = vC0.rgb * (0.25 + 0.5 * nl) + vC1.rgb * (fres * 2.2 + edge * 0.9 + 0.12);
  } else {
    // rampart: world-space strata so neighbouring facets read as one mass of rock
    vec3 w = vWorld * 0.6;
    float n = vFbm3(w * 1.3);
    float g = vNoise3(w * 6.0);
    // bump the facet normal with the noise gradient
    float ee = 0.08;
    vec3 grad = vec3(vFbm3((w + vec3(ee, 0, 0)) * 1.3) - n, vFbm3((w + vec3(0, ee, 0)) * 1.3) - n, vFbm3((w + vec3(0, 0, ee)) * 1.3) - n) / ee;
    vec3 Nb = normalize(N - grad * 0.55);
    float nlb;
    float strata = smoothstep(0.35, 0.65, vNoise(vec2(vWorld.y * 2.4 + n * 2.5, seed * 31.0)));
    // the face is built of fitted blocks: every cell leans its own way and takes its own tone
    vec2 fuv = vec2(dot(vWorld.xz, vec2(N.z, -N.x)) + N.y * vWorld.x, vWorld.y * 1.25 + N.y * vWorld.z) * 0.75 + seed * 7.0;
    vec3 cl = vCellId(fuv + (n - 0.5) * 0.5);
    float crack = smoothstep(0.045, 0.0, cl.y - cl.x);
    vec3 tilt = vec3(vHash(vec2(cl.z, 1.0)), vHash(vec2(cl.z, 2.0)), vHash(vec2(cl.z, 3.0))) - 0.5;
    Nb = normalize(Nb + tilt * 0.55);
    nlb = max(dot(Nb, L), 0.0);
    vec3 base = vC0.rgb * (0.5 + 0.35 * n) * (0.82 + 0.26 * strata) * (0.9 + 0.2 * g) * (0.78 + 0.44 * cl.z);
    float ao = mix(0.5, 1.0, smoothstep(0.0, 0.9, vLocal.y * p1));   // darker toward the ground
    rgb = base * (uLightCol * nlb + mix(uGroundCol, uSkyCol, Nb.y * 0.5 + 0.5)) * ao;
    rgb = mix(rgb, rgb * 0.3, crack * 0.75);
    // fresh from the earth: a dull heat in the seams near the base, gone in a second
    rgb += vC1.rgb * (fres * 0.18 + crack * p2 * 0.5 * (1.0 - smoothstep(0.0, 1.6, vLocal.y * p1))) * vC1.a;
  }
#ifdef USE_FOG
  rgb = mix(rgb, fogColor, vfxFog());
#endif
  gl_FragColor = vec4(rgb, alpha);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- ORB: volumetric-looking energy ball
/** styles: 0 fire · 1 plasma · 2 shadow · 3 light · 4 molten glow shell */
const ORB_FRAG = /* glsl */ `
${FRAG_HEAD}
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float f = clamp(dot(N, V), 0.0, 1.0);
  float style = vPar.x, p1 = vPar.y, seed = vPar.w;
  vec3 q = vLocal * 2.4 + seed * 13.0;
  vec3 rgb; float alpha = 0.0; float cov;
  if (style < 0.5){
    float n = vFbm3(q + vec3(0.0, -uTime * 2.6, uTime * 0.7));
    float body = smoothstep(0.05, 0.75, f + (n - 0.5) * 0.7);
    float core = smoothstep(0.45, 1.0, f + (n - 0.5) * 0.35);
    cov = body;
    rgb = vC0.rgb * body * (0.6 + 0.9 * n) + vC1.rgb * core * 2.2;
  } else if (style < 1.5){
    float n = vFbm3(q * 1.3 + uTime * vec3(1.3, -2.1, 1.7));
    float fil = smoothstep(0.1, 0.0, abs(n - 0.5)) ;
    float core = pow(f, 2.2);
    cov = clamp(core + fil * f * 0.9 + pow(f, 0.8) * 0.3, 0.0, 1.0);
    rgb = vC0.rgb * (0.5 * pow(f, 0.7) + fil * 1.6 * f) + vC1.rgb * core * 3.0;
  } else if (style < 2.5){
    float n = vFbm3(q * 0.9 + vec3(0.0, uTime * 1.1, 0.0));
    float body = smoothstep(0.0, 0.5, f + (n - 0.5) * 0.9);
    float rim = (1.0 - smoothstep(0.1, 0.65, f + (n - 0.5) * 0.5)) * body;
    cov = body;
    alpha = body * 0.93;
    rgb = vec3(0.008, 0.003, 0.016) * body + vC0.rgb * rim * 1.6 + vC1.rgb * pow(f, 6.0) * p1;
  } else if (style < 3.5){
    float core = pow(f, 1.6);
    cov = pow(f, 0.6);
    rgb = vC0.rgb * cov * 0.9 + vC1.rgb * core * 3.0;
  } else {
    float n = vFbm3(q * 1.1 + vec3(uTime * 0.6));
    cov = pow(f, 1.4) * (0.6 + 0.6 * n);
    rgb = vC0.rgb * cov + vC1.rgb * pow(f, 4.0) * 1.5;
  }
  float a = vC0.a * vInfo.z;
  gl_FragColor = vfxFogged(rgb * a * GAIN, alpha * a);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- SHELL: fresnel surfaces
/** styles: 0 bubble · 1 shield shimmer · 2 burst dome · 3 water body · 4 afterimage */
const SHELL_DEFORM = /* glsl */ `
  if (style < 0.5 || (style > 2.5 && style < 3.5)){
    float wob = style < 0.5 ? 0.06 : 0.1;
    lp *= 1.0 + wob * (sin(lp.y * 4.0 + uTime * 5.0 + seed * 20.0) * sin(lp.x * 3.0 + uTime * 3.7) + 0.6 * sin(lp.z * 5.0 - uTime * 4.3 + seed * 9.0));
  }
`;
const SHELL_FRAG = /* glsl */ `
${FRAG_HEAD}
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float f = abs(dot(N, V));
  float rim = pow(1.0 - f, 2.5);
  float style = vPar.x, p1 = vPar.y, p2 = vPar.z, seed = vPar.w, k = vInfo.x;
  vec3 rgb; float alpha = 0.0;
  if (style < 0.5){
    // soap-film bubble: thin bright rim, drifting iridescence, two speculars
    float film = vFbm3(vLocal * 2.2 + vec3(0.0, uTime * 0.5, seed * 7.0));
    vec3 irid = 0.5 + 0.5 * cos(6.2831 * (film * 1.3 + vec3(0.0, 0.33, 0.67)) + f * 3.0);
    vec3 R = reflect(-V, N);
    float s1 = pow(max(dot(R, normalize(vec3(-0.4, 0.8, 0.35))), 0.0), 60.0);
    float s2 = pow(max(dot(R, normalize(vec3(0.5, -0.3, -0.6))), 0.0), 24.0) * 0.35;
    float edge = pow(1.0 - f, 3.5);
    rgb = vC0.rgb * (edge * 1.6 + 0.07) + mix(vC0.rgb, irid, 0.45) * rim * 0.7 + vC1.rgb * (s1 * 3.0 + s2 + pow(1.0 - f, 9.0) * 1.5);
    alpha = (0.1 + 0.3 * rim) ;
  } else if (style < 1.5){
    // shield shimmer: travelling bands
    float band = smoothstep(0.75, 1.0, sin(vLocal.y * 7.0 - uTime * 5.0 + seed * 6.0) * 0.5 + 0.5);
    float n = vNoise3(vLocal * 3.5 + uTime * 0.7);
    rgb = vC0.rgb * (pow(rim, 1.6) * 0.8 + band * 0.22 * (0.3 + rim)) * (0.6 + 0.6 * n) + vC1.rgb * pow(1.0 - f, 7.0) * 0.5;
  } else if (style < 2.5){
    // burst dome: hollow, noisy, thins as it expands
    float n = vFbm3(vLocal * 3.0 * (1.0 + p1) + vec3(0.0, -uTime * 1.5, seed * 11.0));
    // torn wisps riding an expanding shell – never a clean glass ball
    float thin = smoothstep(0.5 + 0.3 * k, 0.85, n) * smoothstep(0.02, 0.2, vLocal.y + 0.05);
    float fadeK = pow(1.0 - k, 2.0);
    rgb = vC0.rgb * thin * (0.35 + rim * 0.45) * fadeK;
    alpha = p2 * thin * fadeK * 0.5;
  } else if (style < 3.5){
    // water body: foam streaks racing backward (local -Z), glassy rim
    float n = vFbm3(vLocal * vec3(3.0, 3.0, 1.4) + vec3(0.0, 0.0, uTime * 6.0) + seed * 5.0);
    float foam = smoothstep(0.55, 0.8, n);
    rgb = vC0.rgb * (0.25 + rim * 1.2) + vC1.rgb * (foam * 0.9 + pow(1.0 - f, 5.0) * 1.2);
    alpha = 0.35 + 0.3 * rim;
  } else {
    // afterimage: rim-lit ghost
    float scan = 0.75 + 0.25 * sin(vWorld.y * 40.0 + uTime * 30.0);
    rgb = (vC0.rgb * rim * 1.6 + vC1.rgb * pow(1.0 - f, 5.0) * 1.2) * scan * (1.0 - k);
  }
  float a = vC0.a * vInfo.z;
  gl_FragColor = vfxFogged(rgb * a * GAIN, alpha * a);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- RING: free-standing shock ring
/** Local XY plane, radius 1 = quad edge. p1 = thickness (0..1), p2 > 0.5 billboard. styles: 0 smooth · 1 crackle */
const RING_DEFORM = /* glsl */ `
  billboard = p2 > 0.5;
`;
const RING_FRAG = /* glsl */ `
${FRAG_HEAD}
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p), ang = atan(p.y, p.x);
  float style = vPar.x, th = max(vPar.y, 0.02), seed = vPar.w, k = vInfo.x;
  float n = style > 0.5 ? vNoise(vec2(ang * 6.0 + seed * 20.0, uTime * 18.0)) : vNoise(vec2(ang * 3.0 + seed * 20.0, k * 3.0));
  float w = th * (1.0 - 0.6 * k);
  float d = (r - (0.92 - w)) / w;
  float ring = exp(-d * d * 2.5) * (0.6 + 0.6 * n);
  float core = exp(-d * d * 14.0);
  float fadeK = pow(1.0 - k, 1.5);
  vec3 rgb = (vC0.rgb * ring + vC1.rgb * core * 1.0) * fadeK * vC0.a * GAIN;
  gl_FragColor = vfxFogged(rgb, 0.0);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- ARC: swings, crescents, cone fronts
/**
 * Geometry is a (u, v) sheet bent in the shader: angle = (u - 0.5) * p1, radius = mix(p2, 1, v)
 * (p2 < 0: an upright band of half-height -p2 standing on the reach instead);
 * forward is local -Z, the sheet lies in the local XZ plane. Scale = reach.
 * styles: 0 blade slash (sweeps along u) · 1 fire wave · 2 wind crescent · 3 water hook · 4 shadow slash
 *         5 light thrust
 */
const ARC_DEFORM = /* glsl */ `
  float ang = (uv.x - 0.5) * abs(p1);
  float rad = mix(p2, 1.0, uv.y);
  if (p2 < 0.0){
    // upright band standing on the reach (so a swing reads from the side as well as from above)
    lp = vec3(sin(ang) * 0.97, (uv.y - 0.5) * -2.0 * p2, -cos(ang) * 0.97);
    ln = vec3(sin(ang), 0.0, -cos(ang));
    vUv = vec2(p1 < 0.0 ? 1.0 - uv.x : uv.x, pow(1.0 - abs(uv.y * 2.0 - 1.0), 0.45) * 0.96);
  } else {
    lp = vec3(sin(ang) * rad, 0.0, -cos(ang) * rad);
    ln = vec3(0.0, 1.0, 0.0);
    vUv = vec2(p1 < 0.0 ? 1.0 - uv.x : uv.x, uv.y);
  }
`;
const ARC_FRAG = /* glsl */ `
${FRAG_HEAD}
void main(){
  float u = vUv.x, v = vUv.y;
  float style = vPar.x, arc = abs(vPar.y), seed = vPar.w, k = vInfo.x;
  float ends = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u);
  vec3 rgb = vec3(0.0); float alpha = 0.0;
  if (style < 0.5 || (style > 2.5 && style < 4.5)){
    // a swing: the head races along u, leaving a fading wake
    float head = k * 1.6;
    float wake = smoothstep(head - 0.75, head, u) * step(u, head);
    float tip = exp(-pow((u - head) / 0.05, 2.0));
    float n = vNoise(vec2(u * arc * 6.0 + seed * 30.0, v * 3.0));
    float streak = 0.55 + 0.45 * smoothstep(0.3, 0.7, vNoise(vec2(v * 14.0 + seed * 9.0, u * 2.0)));
    float edge = smoothstep(0.55, 1.0, v) ;                // bright outer edge = the reach
    float outer = smoothstep(1.0, 0.94, v);
    float body = pow(v, 1.6) * outer;
    float life = pow(1.0 - k, 0.7);
    if (style < 0.5){
      rgb = (vC0.rgb * body * streak * 1.1 + vC1.rgb * (edge * outer * 1.5 + tip * v * 2.0)) * wake * ends * life;
    } else if (style < 3.5){
      float foam = smoothstep(0.5, 0.8, vFbm(vec2(u * arc * 5.0 - uTime * 4.0, v * 4.0 + seed)));
      rgb = (vC0.rgb * body * 0.9 + vC1.rgb * (foam * body * 1.2 + edge * outer * 1.2 + tip * v)) * wake * ends * life;
      alpha = body * wake * ends * life * 0.5;
    } else {
      float sm = smoothstep(0.25, 0.7, v + (n - 0.5) * 0.5) * outer;
      alpha = sm * wake * ends * life * 0.9;
      rgb = vec3(0.01, 0.004, 0.02) * alpha + (vC0.rgb * edge * outer * 1.6 + vC1.rgb * tip * v * 1.5) * wake * ends * life;
    }
  } else if (style < 1.5){
    // fire wave: a thick rolling front
    float n = vFbm(vec2(u * arc * 3.2 + seed * 20.0, v * 2.4 - uTime * 3.0));
    float n2 = vFbm(vec2(u * arc * 7.0 - seed * 9.0, v * 5.0 - uTime * 6.0));
    float front = smoothstep(0.0, 0.5, v + (n - 0.5) * 0.6) * smoothstep(1.0, 0.75, v + (n2 - 0.5) * 0.3);
    float hot = smoothstep(0.55, 0.95, v + (n - 0.5) * 0.4) * smoothstep(1.0, 0.9, v);
    float fadeK = pow(1.0 - k, 1.2);
    rgb = (vC0.rgb * front * (0.4 + 0.6 * n2) + vC1.rgb * hot * 0.9) * ends * fadeK;
    alpha = front * ends * fadeK * 0.15;
  } else if (style < 2.5){
    // wind crescent: sharp leading edge, streaky trailing body
    float n = vNoise(vec2(u * arc * 4.0 + seed * 10.0, v * 2.0 - uTime * 10.0));
    float lines = smoothstep(0.45, 0.75, vNoise(vec2(u * arc * 9.0 + seed, v * 1.2 - uTime * 16.0)));
    float lead = smoothstep(0.8, 0.97, v) * smoothstep(1.0, 0.97, v);
    float body = smoothstep(0.0, 0.9, v) * (0.25 + 0.75 * lines) * (0.5 + 0.5 * n);
    float shape = pow(sin(u * 3.14159), 0.6);
    rgb = (vC0.rgb * body * 0.9 + vC1.rgb * lead * 2.4) * shape * vInfo.z;
    alpha = body * shape * 0.12 * vInfo.z;
  } else {
    // light thrust: a lance, brightest on its centre line
    float cu = abs(u - 0.5) * 2.0;
    float core = exp(-cu * cu * 14.0);
    float tipFade = smoothstep(1.0, 0.8, v) * smoothstep(0.0, 0.25, v);
    float runner = exp(-pow((v - k * 1.5) / 0.18, 2.0));
    float life = pow(1.0 - k, 0.8);
    rgb = (vC0.rgb * exp(-cu * cu * 3.0) * 0.8 + vC1.rgb * core * (1.6 + 2.5 * runner)) * tipFade * life;
  }
  rgb *= vC0.a * GAIN;
  gl_FragColor = vfxFogged(rgb, alpha * vC0.a);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- BEAM: cylinders along +Z
/**
 * Unit cylinder, z 0..1, radius 1. p1 = radius multiplier at the far end, p2 = extra (see styles).
 * styles: 0 sunlance · 1 warning line · 2 water jet · 3 wind tube · 4 pillar of light (timed) · 5 width ghost
 *         6 pillar of light (steady, for live instances)
 */
const BEAM_DEFORM = /* glsl */ `
  float taper = mix(1.0, p1, lp.z);
  lp.xy *= taper;
  if (style > 1.5 && style < 3.5){
    float wob = style < 2.5 ? 0.1 : 0.12;
    float zz = lp.z * iD.z;
    lp.xy *= 1.0 + wob * sin(zz * 2.2 - uTime * 16.0 + atan(lp.y, lp.x) * 2.0) + wob * 0.8 * (vNoise(vec2(zz * 0.9 - uTime * 9.0, atan(lp.y, lp.x) * 1.5 + seed * 9.0)) - 0.5);
  }
  vUv = vec2(atan(position.y, position.x) / 6.2831853 + 0.5, position.z * iD.z);
  grow3 = vec3(grow * shrink, grow * shrink, 1.0);   // beams thin out, they never shorten
`;
const BEAM_FRAG = /* glsl */ `
${FRAG_HEAD}
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float f = abs(dot(N, V));
  float style = vPar.x, p2 = vPar.z, seed = vPar.w, k = vInfo.x;
  float z = vLocal.z, len = vUv.y, a = vUv.x;
  float capFade = smoothstep(0.0, 0.03, z);
  vec3 rgb = vec3(0.0); float alpha = 0.0;
  if (style < 0.5){
    float n = vFbm(vec2(a * 6.0 + seed * 9.0, len * 0.35 - uTime * 9.0));
    float core = pow(f, 3.0);
    float sheath = pow(f, 0.8) * (0.55 + 0.6 * n);
    float pulse = 0.85 + 0.15 * sin(len * 1.5 - uTime * 60.0);
    rgb = (vC0.rgb * sheath + vC1.rgb * core * 3.2 * pulse) * capFade;
  } else if (style < 1.5){
    float dash = 0.6 + 0.4 * smoothstep(0.3, 0.7, fract(len * 0.5 - uTime * 3.0));
    float flick = 0.75 + 0.25 * sin(uTime * 37.0 + seed * 40.0);
    rgb = (vC0.rgb * pow(f, 0.5) + vC1.rgb * pow(f, 3.0) * 2.0) * dash * flick * capFade;
  } else if (style < 2.5){
    float n = vFbm(vec2(a * 5.0 + seed * 7.0, len * 0.9 - uTime * 11.0));
    float n2 = vNoise(vec2(a * 14.0 - seed * 3.0, len * 2.2 - uTime * 19.0));
    float foam = smoothstep(0.62, 0.84, n) * (0.6 + 0.4 * n2) + smoothstep(0.8, 0.97, n2) * 0.3;
    float edge = pow(1.0 - f, 2.0);
    // deep body, bright only where the foam streaks and the glancing rim catch the light
    rgb = (mix(vC1.rgb, vC0.rgb, 0.35 + 0.65 * f) * (0.55 + 0.4 * n) + vec3(0.8, 0.95, 1.0) * (foam * 1.2 + edge * 0.35)) * capFade;
    alpha = (0.72 + 0.25 * foam) * capFade;
  } else if (style < 3.5){
    float n1 = vNoise(vec2(a * 9.0 + seed * 5.0, len * 0.35 - uTime * 13.0));
    float n2 = vNoise(vec2(a * 22.0 - seed * 3.0, len * 0.8 - uTime * 22.0));
    float lines = smoothstep(0.55, 0.85, n1) + 0.6 * smoothstep(0.62, 0.9, n2);
    float endFade = smoothstep(1.0, 0.7, z) * smoothstep(0.0, 0.08, z);
    float rimMask = 0.35 + 0.65 * pow(1.0 - f, 1.2);
    rgb = (vC0.rgb * lines * rimMask + vC1.rgb * lines * pow(1.0 - f, 3.0) * 0.8 + vC0.rgb * 0.05) * endFade;
    alpha = lines * 0.06 * endFade;
  } else if (style < 4.5 || style > 5.5){
    float n = vNoise(vec2(a * 8.0 + seed * 4.0, len * 0.6 - uTime * 4.0));
    float up = pow(1.0 - z, 1.0 + p2);
    float core = pow(f, 2.5);
    float fadeK = style > 5.5 ? 1.0 : sin(min(k * 1.25, 1.0) * 3.14159);
    rgb = (vC0.rgb * pow(f, 0.9) * (0.5 + 0.5 * n) + vC1.rgb * core * 0.8) * up * fadeK;
  } else {
    float edge = pow(1.0 - f, 3.0);
    float dash = smoothstep(0.35, 0.65, fract(len * 0.35 - uTime * 1.2));
    rgb = vC0.rgb * edge * (0.5 + 0.5 * dash) * capFade * smoothstep(1.0, 0.9, z);
  }
  float aa = vC0.a * vInfo.z;
  gl_FragColor = vfxFogged(rgb * aa * GAIN, alpha * aa);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- GLYPH: billboards (runes, flares)
/** p1 = glyph cell, styles: 0 rune glyph · 1 star flare · 2 soft halo */
const GLYPH_DEFORM = /* glsl */ `
  billboard = true;
`;
const GLYPH_FRAG = /* glsl */ `
${FRAG_HEAD}
uniform sampler2D uGlyph;
void main(){
  float style = vPar.x, idx = vPar.y, seed = vPar.w;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec3 rgb;
  if (style < 0.5){
    vec2 cell = vec2(mod(idx, 4.0), floor(idx / 4.0));
    vec4 t = texture2D(uGlyph, (cell + vUv) / 4.0);
    float halo = exp(-r * r * 3.0) * 0.35;
    rgb = vC1.rgb * t.r * 2.2 + vC0.rgb * (t.g * 0.9 + halo);
  } else if (style < 1.5){
    float ax = abs(p.x), ay = abs(p.y);
    float flick = 0.85 + 0.15 * sin(uTime * 31.0 + seed * 50.0);
    float cross = exp(-ax * 22.0) * exp(-ay * 2.4) + exp(-ay * 22.0) * exp(-ax * 2.4);
    vec2 d = vec2(abs(p.x + p.y), abs(p.x - p.y)) * 0.7071;
    float diag = 0.35 * (exp(-d.x * 26.0) * exp(-d.y * 5.0) + exp(-d.y * 26.0) * exp(-d.x * 5.0));
    float core = exp(-r * r * 26.0);
    float halo = exp(-r * r * 4.5) * 0.4;
    float edge = 1.0 - smoothstep(0.75, 1.0, r);
    rgb = (vC0.rgb * (halo + cross * 0.8 + diag) + vC1.rgb * (core * 2.5 + cross * 0.9)) * flick * edge;
  } else {
    float halo = exp(-r * r * 3.6) * (1.0 - smoothstep(0.8, 1.0, r));
    rgb = vC0.rgb * halo + vC1.rgb * exp(-r * r * 18.0);
  }
  float a = vC0.a * vInfo.z;
  gl_FragColor = vfxFogged(rgb * a * GAIN, 0.0);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- FUNNEL: the cyclone
const FUNNEL_DEFORM = /* glsl */ `
  float h = lp.y;
  float prof = mix(0.16, 1.0, pow(h, 1.5)) * (1.0 + 0.07 * sin(h * 11.0 - uTime * 6.0));
  float tw = uTime * (7.0 - 3.0 * h) + h * 5.0;
  float cs = cos(tw), sn = sin(tw);
  lp.xz = vec2(lp.x * cs - lp.z * sn, lp.x * sn + lp.z * cs) * prof;
  // the column sways and leans
  lp.x += (sin(uTime * 2.3 + h * 3.0 + seed * 9.0) * 0.16 + sin(uTime * 5.1 + h * 7.0) * 0.05) * h;
  lp.z += (cos(uTime * 1.9 + h * 2.6 + seed * 5.0) * 0.16) * h;
  ln = normalize(vec3(lp.x, -0.3, lp.z));
`;
const FUNNEL_FRAG = /* glsl */ `
${FRAG_HEAD}
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float f = abs(dot(N, V));
  float h = vUv.y, a = vUv.x, seed = vPar.w;
  float n1 = vNoise(vec2(a * 10.0 + h * 3.0, h * 5.0 - uTime * 2.2 + seed * 5.0));
  float n2 = vNoise(vec2(a * 26.0 - h * 6.0, h * 14.0 - uTime * 4.0));
  float bands = smoothstep(0.42, 0.72, n1) + 0.5 * smoothstep(0.55, 0.85, n2);
  float rim = pow(1.0 - f, 1.6);
  float vfade = smoothstep(0.0, 0.06, h) * smoothstep(1.0, 0.62, h);
  float body = 0.16 + 0.3 * rim;
  vec3 rgb = (vC0.rgb * (bands * (0.5 + 0.7 * rim) + body * 0.6) + vC1.rgb * bands * rim * 0.9) * vfade;
  float alpha = (0.2 * body + bands * 0.12) * vfade * 1.4;
  float aa = vC0.a * vInfo.z;
  gl_FragColor = vfxFogged(rgb * aa * GAIN, alpha * aa * vC1.a);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- WAVE: the tidal wave
/** Sheet (u across the crest, v along the cross-section profile). Local +Z = travel direction. */
const WAVE_DEFORM = /* glsl */ `
  float u = uv.x, v = uv.y;
  // cross-section in (z, y): up the back slope, over the crest, curl, down the hollow face
  float t = v;
  float zz, yy;
  if (t < 0.5){ float s = t / 0.5; zz = mix(-1.0, 0.1, s); yy = pow(s, 1.5); }
  else if (t < 0.72){ float s = (t - 0.5) / 0.22; float an = s * 2.4; zz = 0.1 + sin(an) * 0.42; yy = 1.0 - (1.0 - cos(an)) * 0.2; }
  else { float s = (t - 0.72) / 0.28; zz = mix(0.38, 0.18, s) - sin(s * 3.14159) * 0.16; yy = mix(0.655, 0.0, s); }
  // rounded shoulders at both ends of the crest, and a travelling swell
  float ex = abs(u - 0.5) * 2.0;
  float shoulder = sqrt(max(0.0, 1.0 - pow(ex, 5.0)));
  float swell = 1.0 + 0.07 * sin(u * 17.0 + uTime * 6.0 + seed * 9.0) * yy;
  lp = vec3(u - 0.5, yy * shoulder * swell, zz * mix(0.55, 1.0, shoulder));
  ln = vec3(0.0, 0.5, t < 0.6 ? -0.8 : 0.8);
  vUv = vec2(u, v);
`;
const WAVE_FRAG = /* glsl */ `
${FRAG_HEAD}
void main(){
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float u = vUv.x, v = vUv.y, seed = vPar.w, hgt = vLocal.y;
  float W = vPar.y; // width in metres, for uniform noise scale
  vec2 q = vec2(u * W * 0.7, v * 6.0);
  float flow = vFbm(q + vec2(seed * 7.0, -uTime * 2.6));
  float flow2 = vFbm(q * 2.3 + vec2(-seed * 3.0, -uTime * 4.2));
  float crest = smoothstep(0.42, 0.56, v) * smoothstep(0.8, 0.62, v);
  float foamTop = crest * smoothstep(0.3, 0.7, flow + hgt * 0.3);
  float streaks = smoothstep(0.55, 0.8, flow2) * smoothstep(0.1, 0.9, hgt);
  float baseFoam = smoothstep(0.16, 0.0, hgt) * smoothstep(0.35, 0.7, flow);
  float foam = clamp(foamTop * 1.3 + streaks * 0.45 + baseFoam, 0.0, 1.5);
  float depth = smoothstep(0.0, 0.9, hgt);
  // vC1 = the deep colour at the foot, vC0 = the lit body higher up
  vec3 water = mix(vC1.rgb, vC0.rgb, 0.25 + 0.6 * depth) * (0.55 + 0.35 * flow) + vC0.rgb * fres * 0.6;
  vec3 rgb = water + vec3(0.8, 0.94, 1.0) * foam * 0.85;
  float alpha = clamp(0.74 + 0.22 * foam + 0.15 * fres, 0.0, 0.97);
  float a = vC0.a * vInfo.z;
  gl_FragColor = vfxFogged(rgb * alpha * a, alpha * a * 0.95);
  ${FRAG_END}
}`;

// ---------------------------------------------------------------- SLAB (rampart) deform
const SLAB_DEFORM = /* glsl */ `
  // chip the top edge a little (never outward: the faces stay on the collider)
  if (lp.y > 0.99){
    float chip = vNoise(vec2(lp.x * iD.x * 1.7 + seed * 9.0, lp.z * iD.z * 2.3)) ;
    lp.y -= chip * 0.16 / max(iD.y, 0.2);
  }
  grow3 = vec3(1.0);
`;
const SPIKE_DEFORM = /* glsl */ `
  // spikes erupt along their own axis and sink back the same way
  if (p2 > 0.5) grow3 = vec3(mix(0.55, 1.0, grow) * mix(0.75, 1.0, shrink), grow * shrink, mix(0.55, 1.0, grow) * mix(0.75, 1.0, shrink));
`;

// =========================================================================================
// Geometry
// =========================================================================================

function jitterGeo(g: THREE.BufferGeometry, amt: number, seed: number): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  const h = (x: number, y: number, z: number, s: number) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
    return v - Math.floor(v);
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rx = Math.round(x * 50), ry = Math.round(y * 50), rz = Math.round(z * 50);
    const k = 1 + (h(rx, ry, rz, seed) - 0.5) * 2 * amt;
    p.setXYZ(i, x * k, y * k * (0.85 + 0.1 * h(rx, rz, ry, seed + 3)), z * k);
  }
  g.computeVertexNormals();
  return g;
}

function crystalGeo(): THREE.BufferGeometry {
  // irregular six-sided bipyramid: top tip y=+1, belt near y=-0.05, bottom tip y=-0.55
  const pos: number[] = [];
  const n = 6, belt: number[][] = [], shoulder: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.12;
    const r = 0.5 * (0.82 + 0.3 * ((i * 37) % 5) / 4);
    belt.push([Math.cos(a) * r, -0.05 + (((i * 13) % 3) - 1) * 0.05, Math.sin(a) * r]);
    shoulder.push([Math.cos(a) * r * 0.72, 0.42 + (((i * 7) % 3) - 1) * 0.06, Math.sin(a) * r * 0.72]);
  }
  const top = [0.06, 1, -0.04], bot = [0, -0.55, 0];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(shoulder[i], top, shoulder[j]);
    tri(belt[i], shoulder[i], shoulder[j]); tri(belt[i], shoulder[j], belt[j]);
    tri(bot, belt[i], belt[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

function bladeGeo(): THREE.BufferGeometry {
  // a dagger along +Y: blade (kite cross-section), guard, grip
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const tip = [0, 1, 0], l = [-0.13, 0.22, 0], r = [0.13, 0.22, 0], f = [0, 0.3, 0.035], b = [0, 0.3, -0.035], base = [0, 0.12, 0];
  for (const s of [f, b]) { tri(tip, l, s); tri(tip, s, r); tri(l, base, s); tri(s, base, r); }
  const gl = [-0.26, 0.13, 0], gr = [0.26, 0.13, 0], gt = [0, 0.19, 0.03], gb = [0, 0.19, -0.03], gd = [0, 0.06, 0];
  for (const s of [gt, gb]) { tri(gl, gd, s); tri(s, gd, gr); }
  const p0 = [0, -0.42, 0], hl = [-0.045, 0.08, 0], hr = [0.045, 0.08, 0], hf = [0, 0.08, 0.04], hb = [0, 0.08, -0.04];
  tri(p0, hl, hf); tri(p0, hf, hr); tri(p0, hr, hb); tri(p0, hb, hl);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

// =========================================================================================
// The set of batches the game uses
// =========================================================================================

export interface Batches {
  rocks: InstBatch; crystals: InstBatch; iceblock: InstBatch; blades: InstBatch; slabs: InstBatch;
  orbs: InstBatch; shells: InstBatch; rings: InstBatch; arcs: InstBatch; beams: InstBatch;
  glyphs: InstBatch; funnels: InstBatch; waves: InstBatch;
  all: InstBatch[];
  setLight(dir: THREE.Vector3, col: THREE.Color, sky: THREE.Color, ground: THREE.Color): void;
  update(now: number): void;
  clear(): void;
  dispose(): void;
}

export function createBatches(scene: THREE.Scene, glyphTex: THREE.Texture, capMul: number): Batches {
  const light = {
    uLightDir: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
    uLightCol: { value: new THREE.Color(0.75, 0.82, 1.0) },
    uSkyCol: { value: new THREE.Color(0.2, 0.26, 0.4) },
    uGroundCol: { value: new THREE.Color(0.12, 0.1, 0.09) },
  };
  const mats: THREE.ShaderMaterial[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mk = (deform: string, frag: string, opts: { opaque?: boolean; defines?: Record<string, string>; uniforms?: Record<string, THREE.IUniform>; side?: THREE.Side; depthWrite?: boolean } = {}) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), uTime: { value: 0 }, ...(opts.uniforms || {}) },
      vertexShader: vert(deform), fragmentShader: frag, fog: true, side: opts.side ?? THREE.DoubleSide,
      defines: opts.defines || {},
    });
    if (!opts.opaque) premult(m);
    mats.push(m);
    return m;
  };
  const facetOpaque = mk(SPIKE_DEFORM, FACET_FRAG, { opaque: true, uniforms: light, side: THREE.FrontSide });
  const facetSlab = mk(SLAB_DEFORM, FACET_FRAG, { opaque: true, uniforms: light, side: THREE.FrontSide });
  const facetClear = mk('', FACET_FRAG, { uniforms: light, defines: { TRANSLUCENT: '1' }, side: THREE.FrontSide });
  const orbMat = mk('', ORB_FRAG, { side: THREE.FrontSide });
  const shellMat = mk(SHELL_DEFORM, SHELL_FRAG);
  const ringMat = mk(RING_DEFORM, RING_FRAG);
  const arcMat = mk(ARC_DEFORM, ARC_FRAG);
  const beamMat = mk(BEAM_DEFORM, BEAM_FRAG);
  const glyphMat = mk(GLYPH_DEFORM, GLYPH_FRAG, { uniforms: { uGlyph: { value: glyphTex } } });
  const funnelMat = mk(FUNNEL_DEFORM, FUNNEL_FRAG);
  const waveMat = mk(WAVE_DEFORM, WAVE_FRAG);

  const g = <T extends THREE.BufferGeometry>(x: T): T => { geos.push(x); return x; };
  const rockGeo = g(jitterGeo(new THREE.IcosahedronGeometry(1, 1), 0.2, 3));
  const cryGeo = g(crystalGeo());
  const bladeG = g(bladeGeo());
  const slabGeo = g(new THREE.BoxGeometry(1, 1, 1, 12, 6, 2).translate(0, 0.5, 0));
  const orbGeo = g(new THREE.IcosahedronGeometry(1, 3));
  const shellGeo = g(new THREE.SphereGeometry(1, 28, 18));
  const quad = g(new THREE.PlaneGeometry(2, 2));
  const arcGeo = g(new THREE.PlaneGeometry(1, 1, 32, 4));
  const beamGeo = g(new THREE.CylinderGeometry(1, 1, 1, 18, 8, true).rotateX(Math.PI / 2).translate(0, 0, 0.5));
  const glyphGeo = g(new THREE.PlaneGeometry(1, 1));
  const funnelGeo = g(new THREE.CylinderGeometry(1, 1, 1, 28, 16, true).translate(0, 0.5, 0));
  const waveGeo = g(new THREE.PlaneGeometry(1, 1, 28, 26));

  const c = (n: number) => Math.max(8, Math.round(n * capMul));
  const b: Batches = {
    rocks: new InstBatch(scene, rockGeo, facetOpaque, c(260), 0),
    crystals: new InstBatch(scene, cryGeo, facetOpaque, c(220), 0),
    blades: new InstBatch(scene, bladeG, facetOpaque, 48, 0),
    slabs: new InstBatch(scene, slabGeo, facetSlab, 12, 0),
    iceblock: new InstBatch(scene, cryGeo, facetClear, 48, 12),
    orbs: new InstBatch(scene, orbGeo, orbMat, 96, 14),
    shells: new InstBatch(scene, shellGeo, shellMat, 64, 16),
    waves: new InstBatch(scene, waveGeo, waveMat, 6, 9),
    funnels: new InstBatch(scene, funnelGeo, funnelMat, 6, 10),
    beams: new InstBatch(scene, beamGeo, beamMat, 64, 18),
    arcs: new InstBatch(scene, arcGeo, arcMat, 64, 19),
    rings: new InstBatch(scene, quad, ringMat, 96, 21),
    glyphs: new InstBatch(scene, glyphGeo, glyphMat, 64, 26),
    all: [],
    setLight(dir, col, sky, ground) {
      light.uLightDir.value.copy(dir); light.uLightCol.value.copy(col); light.uSkyCol.value.copy(sky); light.uGroundCol.value.copy(ground);
    },
    update(now) { for (const x of b.all) x.update(now); },
    clear() { for (const x of b.all) x.clear(); },
    dispose() { for (const x of b.all) x.dispose(); for (const m of mats) m.dispose(); for (const x of geos) x.dispose(); },
  };
  b.all = [b.rocks, b.crystals, b.blades, b.slabs, b.iceblock, b.orbs, b.shells, b.waves, b.funnels, b.beams, b.arcs, b.rings, b.glyphs];
  // batches that share a material must still get their own uTime updates: uniforms are shared, fine.
  return b;
}
