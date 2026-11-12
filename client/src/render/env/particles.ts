// Camera-following snow, brazier flames and embers, and the small floating crystals over the
// shrines and the monolith. All GPU-animated; nothing is allocated per frame.
import * as THREE from 'three';
import { hash2 } from '@shared/math';
import { HALL } from '@shared/world';
import type { Weather } from '@shared/weather';
import type { EnvQuality, SharedUniforms } from './common';
import type { FloatingCrystal } from './props';

// ----------------------------------------------------------------------------------------------
// Snow
// ----------------------------------------------------------------------------------------------

const SNOW_MAX = 12000;

const SNOW_VERT = /* glsl */`
attribute vec3 aBase;
attribute vec4 aRnd;
attribute vec2 aCorner;
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform vec3 uVel;
uniform float uDensity;
uniform float uSize;
uniform vec4 uHall;
uniform float uHallRoof;
varying vec2 vCorner;
varying float vAlpha;
void main() {
  float sp = 0.7 + 0.6 * aRnd.x;
  vec3 base = aBase * uBox + uOffset * sp;
  base.x += sin( uTime * ( 0.6 + aRnd.y ) + aRnd.y * 40.0 ) * 0.4;
  base.z += cos( uTime * ( 0.5 + aRnd.x ) + aRnd.x * 31.0 ) * 0.4;
  vec3 p = mod( base - cameraPosition, uBox ) - uBox * 0.5 + cameraPosition;
  float keep = step( aRnd.w, uDensity );
  // nothing falls inside the hall
  if ( p.x > uHall.x && p.x < uHall.y && p.z > uHall.z && p.z < uHall.w && p.y < uHallRoof ) keep = 0.0;
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  vec3 velV = mat3( viewMatrix ) * ( uVel * sp );
  float speed = length( velV.xy );
  vec2 dir = speed > 1e-4 ? velV.xy / speed : vec2( 0.0, 1.0 );
  float size = uSize * ( 0.55 + aRnd.z * 0.9 );
  size *= 0.55 + 0.45 * smoothstep( 1.0, 7.0, - mv.z );
  float stretch = min( speed * 0.016, 0.42 );
  mv.xy += aCorner.x * vec2( dir.y, - dir.x ) * size + aCorner.y * dir * ( size + stretch );
  float dist = - mv.z;
  vAlpha = keep * smoothstep( 0.35, 1.6, dist ) * ( 1.0 - smoothstep( uBox.x * 0.36, uBox.x * 0.5, dist ) ) * size / ( size + stretch * 0.6 );
  vCorner = aCorner;
  gl_Position = keep > 0.5 ? projectionMatrix * mv : vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;

const SNOW_FRAG = /* glsl */`
uniform vec3 uColor;
varying vec2 vCorner;
varying float vAlpha;
#include <common>
void main() {
  float r = length( vCorner );
  float a = ( 1.0 - smoothstep( 0.25, 1.0, r ) ) * vAlpha;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( uColor, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Snow {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private offset = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private count = 0;

  constructor(shared: SharedUniforms, q: EnvQuality) {
    const n = SNOW_MAX;
    const base = new Float32Array(n * 4 * 3), rnd = new Float32Array(n * 4 * 4), corner = new Float32Array(n * 4 * 2);
    const idx = new Uint32Array(n * 6);
    const cs = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let i = 0; i < n; i++) {
      const bx = hash2(i, 1, 701), by = hash2(i, 2, 701), bz = hash2(i, 3, 701);
      const r0 = hash2(i, 4, 701), r1 = hash2(i, 5, 701), r2 = hash2(i, 6, 701), r3 = hash2(i, 7, 701);
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        base[v * 3] = bx; base[v * 3 + 1] = by; base[v * 3 + 2] = bz;
        rnd[v * 4] = r0; rnd[v * 4 + 1] = r1; rnd[v * 4 + 2] = r2; rnd[v * 4 + 3] = r3;
        corner[v * 2] = cs[k * 2]; corner[v * 2 + 1] = cs[k * 2 + 1];
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    this.geo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    this.geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    this.geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      name: 'env-snow',
      uniforms: {
        uTime: shared.uTime, uBox: { value: new THREE.Vector3(42, 28, 42) }, uOffset: { value: this.offset }, uVel: { value: this.vel },
        uDensity: { value: 0.2 }, uSize: { value: 0.03 }, uColor: { value: new THREE.Color(0.62, 0.72, 0.9) },
        // the hall's pitched roof rises well above its collision slab: keep the whole volume under it clear
        uHall: { value: new THREE.Vector4(HALL.minX - 0.6, HALL.maxX + 0.6, HALL.minZ - 0.6, HALL.maxZ + 0.6) }, uHallRoof: { value: HALL.roofY1 + 9 },
      },
      vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.setQuality(q);
  }

  setQuality(q: EnvQuality): void {
    this.count = Math.min(SNOW_MAX, q.snowFlakes);
    this.geo.setDrawRange(0, this.count * 6);
  }

  update(dt: number, weather: Weather, flash: number): void {
    const wx = Math.cos(weather.windDir), wz = Math.sin(weather.windDir);
    const windSpeed = 0.6 + weather.wind * 15 * (0.35 + weather.snow * 0.65);
    const fall = 1.1 + weather.snow * 2.4;
    this.vel.set(wx * windSpeed, -fall, wz * windSpeed);
    this.offset.addScaledVector(this.vel, dt);
    // keep the accumulated offset bounded (it is only ever used modulo the box)
    const b = this.mat.uniforms.uBox.value as THREE.Vector3;
    if (Math.abs(this.offset.x) > 1e4) this.offset.x %= b.x * 16;
    if (Math.abs(this.offset.y) > 1e4) this.offset.y %= b.y * 16;
    if (Math.abs(this.offset.z) > 1e4) this.offset.z %= b.z * 16;
    this.mat.uniforms.uDensity.value = 0.1 + weather.snow * 0.9;
    this.mat.uniforms.uSize.value = 0.024 + weather.snow * 0.014;
    const k = 1 - weather.storm * 0.35 + flash * 1.5;
    (this.mat.uniforms.uColor.value as THREE.Color).setRGB(0.62 * k, 0.72 * k, 0.9 * k);
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

// ----------------------------------------------------------------------------------------------
// Flames + embers
// ----------------------------------------------------------------------------------------------

const FLAME_VERT = /* glsl */`
attribute vec4 aFlame;   // xyz position, w = scale
attribute float aSeed;
uniform float uTime;
uniform vec4 uWind;
varying vec2 vUv2;
varying float vSeed;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 c = aFlame.xyz;
  vec3 toCam = cameraPosition - c;
  vec3 r = normalize( vec3( toCam.z, 0.0, - toCam.x ) );
  float h = position.y + 0.5;
  vec3 wp = c + r * position.x * 2.6 * aFlame.w + vec3( 0.0, ( position.y * 2.6 + 0.52 ) * aFlame.w, 0.0 );
  // the card is larger than the flame: the rest carries its glow
  h = position.y * 2.6 / 1.05 + 0.5;
  // the flame leans with the wind
  wp.xz += uWind.xy * max( h, 0.0 ) * max( h, 0.0 ) * ( 0.08 + uWind.z * 0.3 ) * aFlame.w * step( h, 1.2 );
  vUv2 = vec2( position.x * 2.6 / 0.72, h );
  vSeed = aSeed;
  vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FLAME_FRAG = /* glsl */`
uniform sampler2D uDetailTex;
uniform float uTime;
varying vec2 vUv2;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 uv = vUv2;
  float n = texture2D( uDetailTex, vec2( uv.x * 0.33 + vSeed, uv.y * 0.26 - uTime * 0.62 + vSeed * 3.0 ) ).r;
  float n2 = texture2D( uDetailTex, vec2( uv.x * 0.8 - vSeed, uv.y * 0.6 - uTime * 1.25 ) ).r;
  float x = uv.x + ( n - 0.5 ) * 0.42 * uv.y;
  float width = 0.4 * pow( max( 1.0 - uv.y, 0.0 ), 0.65 ) * ( 0.5 + 0.7 * n2 );
  float body = smoothstep( width, width * 0.3, abs( x ) );
  body *= smoothstep( 0.0, 0.07, uv.y ) * ( 1.0 - smoothstep( 0.45 + 0.4 * n2, 1.0, uv.y + ( 1.0 - n ) * 0.3 ) ) * step( abs( uv.x ), 0.5 );
  vec3 col = mix( vec3( 1.0, 0.2, 0.02 ), vec3( 1.0, 0.62, 0.16 ), body );
  col = mix( col, vec3( 1.0, 0.9, 0.55 ), smoothstep( 0.55, 1.0, body * ( 1.0 - uv.y * 0.8 ) ) );
  // glow around the fire
  vec2 gq = vec2( uv.x * 0.72, ( uv.y - 0.4 ) * 1.05 ) / 1.3;
  float halo = exp( - dot( gq, gq ) * 5.5 ) * ( 0.85 + 0.15 * n );
  gl_FragColor = vec4( col * body * 4.6 + vec3( 1.0, 0.42, 0.1 ) * halo * 0.55, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif
}
`;

const EMBER_VERT = /* glsl */`
attribute vec4 aFlame;
attribute vec3 aRnd;
uniform float uTime;
uniform vec4 uWind;
varying float vLife;
varying vec2 vC;
#include <common>
#include <fog_pars_vertex>
void main() {
  float t = fract( uTime * ( 0.22 + aRnd.x * 0.2 ) + aRnd.y * 7.0 );
  vec3 c = aFlame.xyz;
  c.y += 0.3 + t * ( 1.6 + aRnd.z * 2.2 ) * aFlame.w;
  c.xz += ( vec2( aRnd.y, aRnd.z ) - 0.5 ) * 0.3 + uWind.xy * t * t * ( 0.5 + uWind.z * 3.5 );
  c.x += sin( uTime * 2.3 + aRnd.x * 30.0 + t * 6.0 ) * 0.14 * t;
  c.z += cos( uTime * 1.9 + aRnd.y * 30.0 + t * 5.0 ) * 0.14 * t;
  vec4 mv = viewMatrix * vec4( c, 1.0 );
  float size = ( 0.016 + aRnd.z * 0.02 ) * ( 1.0 - t * 0.6 );
  mv.xy += position.xy * 2.0 * size;
  vLife = t;
  vC = position.xy * 2.0;
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex>
}
`;

const EMBER_FRAG = /* glsl */`
varying float vLife;
varying vec2 vC;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a = ( 1.0 - smoothstep( 0.2, 1.0, length( vC ) ) ) * smoothstep( 0.0, 0.08, vLife ) * ( 1.0 - vLife ) * ( 1.0 - vLife );
  vec3 col = mix( vec3( 1.0, 0.75, 0.3 ), vec3( 1.0, 0.25, 0.04 ), vLife ) * a * 7.0;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif
}
`;

export class Fires {
  readonly group = new THREE.Group();
  private flames: THREE.Mesh;
  private embers: THREE.Mesh;
  private disposables: { dispose(): void }[] = [];

  constructor(shared: SharedUniforms, spots: { x: number; y: number; z: number; scale: number }[], q: EnvQuality) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const n = Math.max(1, spots.length);
    const fg = new THREE.InstancedBufferGeometry();
    fg.index = quad.index; fg.setAttribute('position', quad.getAttribute('position'));
    const af = new Float32Array(n * 4), as = new Float32Array(n);
    spots.forEach((s, i) => { af.set([s.x, s.y, s.z, s.scale], i * 4); as[i] = hash2(i, 3, 901); });
    fg.setAttribute('aFlame', new THREE.InstancedBufferAttribute(af, 4));
    fg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(as, 1));
    fg.instanceCount = spots.length;
    const fm = new THREE.ShaderMaterial({
      name: 'env-flames',
      uniforms: { ...THREE.UniformsLib.fog, uDetailTex: shared.uDetailTex, uTime: shared.uTime, uWind: shared.uWind },
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    this.flames = new THREE.Mesh(fg, fm);
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 20;
    this.group.add(this.flames);

    const PER = 9;
    const eg = new THREE.InstancedBufferGeometry();
    eg.index = quad.index; eg.setAttribute('position', quad.getAttribute('position'));
    const ef = new Float32Array(n * PER * 4), er = new Float32Array(n * PER * 3);
    spots.forEach((s, i) => {
      for (let k = 0; k < PER; k++) {
        const j = i * PER + k;
        ef.set([s.x, s.y, s.z, s.scale], j * 4);
        er.set([hash2(j, 1, 903), hash2(j, 2, 903), hash2(j, 3, 903)], j * 3);
      }
    });
    eg.setAttribute('aFlame', new THREE.InstancedBufferAttribute(ef, 4));
    eg.setAttribute('aRnd', new THREE.InstancedBufferAttribute(er, 3));
    eg.instanceCount = spots.length * PER;
    const em = new THREE.ShaderMaterial({
      name: 'env-embers',
      uniforms: { ...THREE.UniformsLib.fog, uTime: shared.uTime, uWind: shared.uWind },
      vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true,
    });
    this.embers = new THREE.Mesh(eg, em);
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 21;
    this.group.add(this.embers);
    this.disposables.push(fg, fm, eg, em, quad);
    this.setQuality(q);
  }

  setQuality(q: EnvQuality): void { this.embers.visible = q.embers; }
  dispose(): void { for (const d of this.disposables) d.dispose(); }
}

// ----------------------------------------------------------------------------------------------
// Floating crystals
// ----------------------------------------------------------------------------------------------

export class Crystals {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(private items: FloatingCrystal[]) {
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(0.55, 1, 0.55);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    mat.name = 'env-crystals';
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    this.mesh.count = items.length;
    const c = new THREE.Color();
    items.forEach((it, i) => this.mesh.setColorAt(i, c.setRGB(it.color[0] * 3.2, it.color[1] * 3.2, it.color[2] * 3.2)));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.frustumCulled = false;
    this.update(0);
  }

  update(time: number): void {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const a = it.phase + time * it.speed;
      this.p.set(it.x + Math.cos(a) * it.orbit, it.y + Math.sin(time * 0.9 + it.phase * 1.7) * 0.09, it.z + Math.sin(a) * it.orbit);
      this.e.set(Math.sin(a * 0.7) * 0.3, a * 1.3, 0.2);
      this.q.setFromEuler(this.e);
      this.s.setScalar(it.size);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
