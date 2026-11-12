// GPU particles. A particle is written ONCE into an instanced ring buffer (spawn state +
// curves); the vertex shader integrates it in closed form (velocity, drag, gravity, turbulence,
// size / colour / additivity over life), so there is no per-frame CPU cost and no allocation.
//
// Two batches share one shader: `back` (drawn first – smoke, dust, debris) and `front`
// (drawn last – glows, sparks, fire). When a batch is full the oldest particles are recycled.

import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS } from './atlas';
import { FOG_V, FOG_V_PARS, FRAG_END, FRAG_PARS, fogUniforms, premult } from './glsl';
import { rnd, rnd2, unit, unitCone, ux, uy, uz } from './rand';

/** Colour roles, resolved against the current palette when a particle is emitted. */
export const enum C { COLOR = 0, CORE = 1, DARK = 2, WHITE = 3, SMOKE = 4, A = 5, B = 6, BLACK = 7, /** halfway from the element colour to its core */ HOT = 8 }

export interface PDef {
  /** Drawn in the front (glow) batch instead of the back (smoke) batch. */
  front: boolean;
  spr: number; sprN: number;
  life: number; lifeVar: number;
  /** Size (metres, full quad width) at birth and death; sVar = random scale spread. */
  s0: number; s1: number; sVar: number;
  /** Colour role + HDR multiplier at birth / death; cPow shapes the blend (>1 stays near c0 longer). */
  c0: C; m0: number; c1: C; m1: number; cPow: number;
  a0: number; a1: number;
  /** 1 = additive, 0 = alpha blended; interpolated over life (fire that turns into smoke). */
  add0: number; add1: number;
  /** White-hot core boost from the sprite's heat channel. */
  heat: number;
  /** Fraction of life spent fading in, and the fade-out exponent ((1-k)^fadePow). */
  fadeIn: number; fadePow: number;
  drag: number;
  /** Downward acceleration (negative = buoyant). */
  grav: number;
  /** Velocity stretch in seconds of motion blur (0 = free rotating billboard). */
  stretch: number;
  /** Random initial rotation (0..1 of a full turn) and random spin (rad/s). */
  rot: number; spin: number;
  /** Turbulent wander amplitude (metres). */
  turb: number;
  /** Random velocity added to whatever the emitter supplies (m/s). */
  vVar: number;
}

const DEF: PDef = {
  front: true, spr: 0, sprN: 1, life: 0.5, lifeVar: 0.25, s0: 0.3, s1: 0.1, sVar: 0.3,
  c0: C.CORE, m0: 3, c1: C.COLOR, m1: 1.5, cPow: 1, a0: 1, a1: 1, add0: 1, add1: 1, heat: 0.6,
  fadeIn: 0.06, fadePow: 1.4, drag: 1, grav: 0, stretch: 0, rot: 1, spin: 0, turb: 0, vVar: 0,
};
export const pdef = (p: Partial<PDef>): PDef => ({ ...DEF, ...p });

const STRIDE = 32;

const VERT = /* glsl */ `
${FOG_V_PARS}
uniform float uTime;
attribute vec4 a0; attribute vec4 a1; attribute vec4 a2; attribute vec4 a3;
attribute vec4 a4; attribute vec4 a5; attribute vec4 a6; attribute vec4 a7;
varying vec2 vUv; varying vec4 vCol; varying vec2 vMix;
void main(){
  float t = uTime - a0.w;
  float k = t / a1.w;
  if (k < 0.0 || k >= 1.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float dr = max(a2.z, 0.001);
  float ex = exp(-dr * t);
  float e = (1.0 - ex) / dr;
  vec3 g = vec3(0.0, -a2.w, 0.0);
  vec3 p = a0.xyz + a1.xyz * e + g * ((t - e) / dr);
  vec3 vel = a1.xyz * ex + g * e;
  float seed = a7.w;
  float tb = a6.z * min(t * 2.5, 1.0);
  p += tb * vec3(sin(t * 3.1 + seed * 61.0), sin(t * 2.3 + seed * 37.0) * 0.6, cos(t * 2.7 + seed * 83.0));
  float sk = 1.0 - (1.0 - k) * (1.0 - k);
  float size = mix(a2.x, a2.y, sk);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 c = position.xy;
  vec2 off;
  if (a5.w > 0.0){
    vec2 vv = (viewMatrix * vec4(vel, 0.0)).xy;
    float l = length(vv);
    vec2 d = l > 1e-4 ? vv / l : vec2(0.0, 1.0);
    off = d * c.y * (size + a5.w * l) + vec2(d.y, -d.x) * c.x * size;
  } else {
    float ang = a5.y + a5.z * t;
    float cs = cos(ang), sn = sin(ang);
    off = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  ${FOG_V}
  float cell = a5.x;
  vec2 cxy = vec2(mod(cell, ${ATLAS_COLS}.0), floor(cell / ${ATLAS_COLS}.0));
  vUv = (cxy + c + 0.5) / vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0);
  float ck = pow(k, a6.w);
  float fade = min(k / max(a6.x, 1e-4), 1.0) * pow(1.0 - k, a6.y);
  vCol = vec4(mix(a3.rgb, a4.rgb, ck), mix(a3.a, a4.a, k) * fade);
  vMix = vec2(mix(a7.x, a7.y, k), a7.z);
}`;

const FRAG = /* glsl */ `
${FRAG_PARS}
uniform sampler2D uAtlas;
varying vec2 vUv; varying vec4 vCol; varying vec2 vMix;
void main(){
  vec4 tex = texture2D(uAtlas, vUv);
  float a = tex.a * vCol.a;
  if (a < 0.003) discard;
  // GAIN calibrates additive particles against the bloom (overlapping sprites add up fast)
  vec3 c = vCol.rgb * tex.r * mix(1.0, 0.6, vMix.x);
  c += mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))), 0.25) * tex.g * vMix.y * 0.9;
  gl_FragColor = vfxFogged(c * a, a * (1.0 - vMix.x));
  ${FRAG_END}
}`;

class Batch {
  readonly cap: number;
  readonly data: Float32Array;
  readonly death: Float32Array;
  readonly buf: THREE.InstancedInterleavedBuffer;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;
  cursor = 0;
  high = 0;
  maxDeath = 0;
  private dMin = -1; private dMax = -1; private dCount = 0;
  private rangeA = { start: 0, count: 0 }; private rangeB = { start: 0, count: 0 };

  constructor(cap: number, mat: THREE.ShaderMaterial, order: number) {
    this.cap = cap;
    this.data = new Float32Array(cap * STRIDE);
    this.death = new Float32Array(cap);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    for (let i = 0; i < 8; i++) geo.setAttribute('a' + i, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4));
    geo.instanceCount = 0;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Returns the write offset of a fresh slot. */
  alloc(deathTime: number): number {
    const i = this.cursor;
    this.cursor = i + 1 === this.cap ? 0 : i + 1;
    if (this.high < this.cap) this.high = Math.max(this.high, i + 1);
    this.death[i] = deathTime;
    if (deathTime > this.maxDeath) this.maxDeath = deathTime;
    if (this.dMin < 0) this.dMin = i;
    this.dMax = i;
    this.dCount++;
    return i * STRIDE;
  }

  flush(): void {
    if (this.dMin < 0) return;
    const r = this.buf.updateRanges;
    if (r.length > 0 || this.dCount >= this.cap) {
      // a previous flush has not been uploaded yet, or the ring lapped itself: upload everything
      r.length = 0;
    } else if (this.dMax >= this.dMin) {
      this.rangeA.start = this.dMin * STRIDE; this.rangeA.count = (this.dMax - this.dMin + 1) * STRIDE;
      r.push(this.rangeA);
    } else {
      this.rangeA.start = this.dMin * STRIDE; this.rangeA.count = (this.cap - this.dMin) * STRIDE;
      this.rangeB.start = 0; this.rangeB.count = (this.dMax + 1) * STRIDE;
      r.push(this.rangeB, this.rangeA);
    }
    this.buf.needsUpdate = true;
    this.geo.instanceCount = this.high;
    this.dMin = -1; this.dMax = -1; this.dCount = 0;
  }

  live(now: number): number {
    let n = 0;
    for (let i = 0; i < this.high; i++) if (this.death[i] > now) n++;
    return n;
  }

  clear(): void {
    this.data.fill(0); this.death.fill(0);
    this.cursor = 0; this.high = 0; this.dMin = -1; this.dMax = -1; this.dCount = 0; this.maxDeath = 0;
    this.buf.updateRanges.length = 0;
    this.buf.needsUpdate = true;
    this.geo.instanceCount = 0;
  }

  dispose(): void { this.geo.dispose(); }
}

export interface Palette { color: THREE.Color; core: THREE.Color; dark: THREE.Color }

export class Particles {
  now = 0;
  /** Emission count multiplier for the current quality level. */
  density = 1;
  /** Custom colour slots (roles C.A and C.B). */
  readonly colA = new THREE.Color(1, 1, 1);
  readonly colB = new THREE.Color(1, 1, 1);
  private pal: Palette;
  private readonly white = new THREE.Color(1, 1, 1);
  private readonly smoke = new THREE.Color(0.055, 0.05, 0.06);
  private readonly black = new THREE.Color(0, 0, 0);
  private readonly hot = new THREE.Color(1, 1, 1);
  private back!: Batch; private front!: Batch;
  private readonly mat: THREE.ShaderMaterial;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, atlas: THREE.Texture, capacity: number, pal: Palette) {
    this.scene = scene;
    this.pal = pal;
    this.mat = premult(new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), uTime: { value: 0 }, uAtlas: { value: atlas } },
      vertexShader: VERT, fragmentShader: FRAG, fog: true, side: THREE.DoubleSide,
    }));
    this.build(capacity);
    this.setPalette(pal);
  }

  private build(capacity: number): void {
    this.back = new Batch(Math.floor(capacity * 0.38), this.mat, 20);
    this.front = new Batch(capacity - this.back.cap, this.mat, 24);
    this.scene.add(this.back.mesh, this.front.mesh);
  }

  setCapacity(capacity: number): void {
    this.scene.remove(this.back.mesh, this.front.mesh);
    this.back.dispose(); this.front.dispose();
    this.build(capacity);
  }

  get capacity(): number { return this.back.cap + this.front.cap; }
  setPalette(p: Palette): void { this.pal = p; this.hot.copy(p.color).lerp(p.core, 0.42); }
  live(): number { return this.back.live(this.now) + this.front.live(this.now); }
  /** Draw calls this system is costing right now (0..2). */
  drawCalls(): number { return (this.back.mesh.visible ? 1 : 0) + (this.front.mesh.visible ? 1 : 0); }

  private role(c: C): THREE.Color {
    switch (c) {
      case C.COLOR: return this.pal.color;
      case C.CORE: return this.pal.core;
      case C.DARK: return this.pal.dark;
      case C.WHITE: return this.white;
      case C.SMOKE: return this.smoke;
      case C.A: return this.colA;
      case C.B: return this.colB;
      case C.HOT: return this.hot;
      default: return this.black;
    }
  }

  /** Quality-scaled particle count with stochastic rounding. */
  n(count: number): number { return Math.floor(count * this.density + rnd()); }

  /**
   * Emit one particle. `scale` multiplies its size, `delay` postpones its birth (seconds; the
   * particle is invisible until then – negative values pre-age it), `lifeMul` scales its life.
   */
  emit(d: PDef, x: number, y: number, z: number, vx: number, vy: number, vz: number, scale = 1, delay = 0, lifeMul = 1): void {
    const b = d.front ? this.front : this.back;
    const life = d.life * (1 + rnd2() * d.lifeVar) * lifeMul;
    const birth = this.now + delay;
    const o = b.alloc(birth + life);
    const a = b.data;
    const sm = scale * (1 + rnd2() * d.sVar);
    if (d.vVar > 0) { unit(); const m = d.vVar * rnd(); vx += ux * m; vy += uy * m; vz += uz * m; }
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = birth;
    a[o + 4] = vx; a[o + 5] = vy; a[o + 6] = vz; a[o + 7] = life;
    a[o + 8] = d.s0 * sm; a[o + 9] = d.s1 * sm; a[o + 10] = d.drag; a[o + 11] = d.grav;
    const c0 = this.role(d.c0), c1 = this.role(d.c1);
    a[o + 12] = c0.r * d.m0; a[o + 13] = c0.g * d.m0; a[o + 14] = c0.b * d.m0; a[o + 15] = d.a0;
    a[o + 16] = c1.r * d.m1; a[o + 17] = c1.g * d.m1; a[o + 18] = c1.b * d.m1; a[o + 19] = d.a1;
    a[o + 20] = d.spr + (d.sprN > 1 ? Math.floor(rnd() * d.sprN) : 0);
    a[o + 21] = d.rot * rnd() * 6.2831853; a[o + 22] = d.spin * rnd2(); a[o + 23] = d.stretch;
    a[o + 24] = d.fadeIn; a[o + 25] = d.fadePow; a[o + 26] = d.turb; a[o + 27] = d.cPow;
    a[o + 28] = d.add0; a[o + 29] = d.add1; a[o + 30] = d.heat; a[o + 31] = rnd();
  }

  /** Radial burst from a point (optionally starting on a shell of radius r0). */
  sphere(d: PDef, count: number, x: number, y: number, z: number, vMin: number, vMax: number, scale = 1, r0 = 0, delay = 0): void {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      unit();
      const v = vMin + (vMax - vMin) * rnd();
      this.emit(d, x + ux * r0, y + uy * r0, z + uz * r0, ux * v, uy * v, uz * v, scale, delay);
    }
  }

  /** Upper-hemisphere burst (ground impacts). `flat` 0..1 squashes it toward the horizon. */
  hemi(d: PDef, count: number, x: number, y: number, z: number, vMin: number, vMax: number, scale = 1, flat = 0, r0 = 0, delay = 0): void {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      unit();
      const v = vMin + (vMax - vMin) * rnd();
      const yy = Math.abs(uy) * (1 - flat) + 0.05;
      this.emit(d, x + ux * r0, y + yy * r0, z + uz * r0, ux * v, yy * v, uz * v, scale, delay);
    }
  }

  /** Horizontal ring: particles start on a circle and fly outward (vOut) and up (vUp). */
  ring(d: PDef, count: number, x: number, y: number, z: number, radius: number, vOut: number, vUp: number, scale = 1, jitter = 0.15, delay = 0): void {
    const n = this.n(count);
    const a0 = rnd() * 6.2831853;
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + rnd() * 0.8) / n) * 6.2831853, cs = Math.cos(a), sn = Math.sin(a);
      const r = radius * (1 + rnd2() * jitter), vo = vOut * (0.7 + 0.6 * rnd()), vu = vUp * (0.5 + rnd());
      this.emit(d, x + cs * r, y, z + sn * r, cs * vo, vu, sn * vo, scale, delay);
    }
  }

  /** Cone burst around a unit direction. */
  cone(d: PDef, count: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, spread: number, vMin: number, vMax: number, scale = 1, delay = 0): void {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      unitCone(dx, dy, dz, spread);
      const v = vMin + (vMax - vMin) * rnd();
      this.emit(d, x, y, z, ux * v, uy * v, uz * v, scale, delay);
    }
  }

  /** Uniformly inside a horizontal disc; each particle gets the given velocity (+ the def's vVar). */
  disc(d: PDef, count: number, x: number, y: number, z: number, radius: number, vx: number, vy: number, vz: number, scale = 1, yJit = 0): void {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.2831853, r = Math.sqrt(rnd()) * radius;
      this.emit(d, x + Math.cos(a) * r, y + rnd() * yJit, z + Math.sin(a) * r, vx, vy, vz, scale);
    }
  }

  /** Along a segment, with positional jitter. */
  line(d: PDef, count: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, jitter: number, vx: number, vy: number, vz: number, scale = 1, delay = 0): void {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const t = rnd();
      this.emit(d, x0 + (x1 - x0) * t + rnd2() * jitter, y0 + (y1 - y0) * t + rnd2() * jitter, z0 + (z1 - z0) * t + rnd2() * jitter, vx, vy, vz, scale, delay);
    }
  }

  update(now: number): void {
    this.now = now;
    this.mat.uniforms.uTime.value = now;
    this.back.mesh.visible = this.back.maxDeath > now;
    this.front.mesh.visible = this.front.maxDeath > now;
  }

  /** Upload this frame's new particles. Call once per frame after all emission. */
  flush(): void { this.back.flush(); this.front.flush(); }

  clear(): void { this.back.clear(); this.front.clear(); }

  dispose(): void {
    this.scene.remove(this.back.mesh, this.front.mesh);
    this.back.dispose(); this.front.dispose(); this.mat.dispose();
  }
}
