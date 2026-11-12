// The cloud sea (a ray-marched height field under the islands, lit by the moon and from within
// by lightning, fading into exactly the sky's horizon colour) and the wisps that drift past.
import * as THREE from 'three';
import { hash2 } from '@shared/math';
import { CLOUD_SEA_Y } from '@shared/world';
import { MOON_DIR, type EnvQuality, type SharedUniforms } from './common';
import { SKY_GLSL, type SkyUniforms } from './sky';

const SEA_VERT = /* glsl */`
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SEA_FRAG = /* glsl */`
uniform sampler2D uDetailTex;
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec2 uScroll;
uniform float uTop;
uniform float uBot;
uniform float uFade;
uniform vec4 uBolt[ 2 ];   // x, z, radius, brightness
varying vec3 vWPos;
#include <common>
${SKY_GLSL}
float cloudH( vec2 p ) {
  vec2 q = p + uScroll;
  float a = texture2D( uDetailTex, q * 0.00105 + vec2( 0.13, 0.71 ) ).a;
  vec2 r = vec2( q.x * 0.866 - q.y * 0.5, q.x * 0.5 + q.y * 0.866 );
  float b = texture2D( uDetailTex, r * 0.0041 - uScroll * 0.0009 ).r;
  #if CLOUD_STEPS > 0
    float c = texture2D( uDetailTex, q * 0.0163 + uScroll * 0.0031 ).r;
    float h = a * 0.52 + b * 0.36 + c * 0.12;
  #else
    float h = a * 0.58 + b * 0.42;
  #endif
  return smoothstep( 0.22, 0.82, h );
}
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize( vWPos - ro );
  float span = uTop - uBot;
  float t = distance( vWPos, ro );
  vec3 p = vWPos;
  float h0 = cloudH( p.xz );
  #if CLOUD_STEPS > 0
  {
    // iterative parallax: slide down the view ray until its depth matches the cloud top there.
    // Smooth everywhere (no silhouettes to alias), flattened toward the horizon.
    vec2 slope = rd.xz / max( - rd.y, 0.36 );
    float lod = 1.0 / ( 1.0 + t * 0.0035 );
    for ( int i = 0; i < CLOUD_STEPS; i ++ ) {
      vec2 q = vWPos.xz + slope * span * ( 1.0 - h0 ) * lod;
      h0 = mix( h0, cloudH( q ), 0.65 );
      p.xz = q;
    }
    p.y = uBot + span * h0;
  }
  #endif
  float h01 = h0;
  float e = 5.0 + t * 0.012;
  float hx = cloudH( p.xz + vec2( e, 0.0 ) ) - h0;
  float hz = cloudH( p.xz + vec2( 0.0, e ) ) - h0;
  vec3 n = normalize( vec3( - hx * span, e * 0.55, - hz * span ) );
  float ndl = dot( n, uMoonDir );
  float wrap = clamp( ndl * 0.6 + 0.4, 0.0, 1.0 );
  // a billow between us and the moon shades this one
  float occ = cloudH( p.xz + uMoonDir.xz * 34.0 ) - h0;
  float shade = 1.0 - smoothstep( 0.02, 0.4, occ ) * 0.6;
  float ao = 0.3 + 0.7 * h01;
  vec3 deep = vec3( 0.014, 0.026, 0.056 );
  vec3 lit = vec3( 0.36, 0.45, 0.62 );
  vec3 col = mix( deep, lit, wrap * wrap * shade ) * ao;
  // silver lining where the cloud thins toward the moon
  float back = pow( max( dot( rd, uMoonDir ), 0.0 ), 6.0 );
  col += vec3( 0.42, 0.52, 0.72 ) * back * ( 1.0 - h01 * 0.5 ) * 0.35;
  // the dusk glow warms the crests that face it
  float glow = skyGlow( rd );
  float facing = clamp( dot( n.xz, uSunsetDir.xz ) * 0.6 + 0.4, 0.0, 1.0 );
  col += vec3( 0.95, 0.32, 0.09 ) * glow * facing * h01 * h01 * 0.34 * ( 1.0 - uOvercast );
  col *= 1.0 - uStorm * 0.4;
  col = mix( col, uFogCol * 0.8, uOvercast * 0.45 );
  // lightning inside the cloud: thin parts glow brightest, crests stay dark
  for ( int i = 0; i < 2; i ++ ) {
    vec2 dv = p.xz - uBolt[ i ].xy;
    float g = exp( - dot( dv, dv ) / ( uBolt[ i ].z * uBolt[ i ].z ) );
    col += vec3( 0.58, 0.56, 1.0 ) * uBolt[ i ].w * ( g * ( 0.06 + 1.5 * ( 1.0 - h01 ) * ( 1.0 - h01 ) ) + g * g * g * 0.7 );
  }
  // dissolve into the horizon
  float f = 1.0 - exp( - ( t * t ) / ( uFade * uFade ) );
  col = mix( col, skyBase( vec3( rd.x, 0.0, rd.z ) ), f );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const WISP_VERT = /* glsl */`
attribute vec4 aWisp;   // xyz base position, w = size
attribute vec2 aRnd;
uniform vec3 uDrift;
uniform vec3 uBox;
uniform vec3 uCentre;
varying vec2 vUv2;
varying vec2 vRnd;
varying float vFade;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 c = mod( aWisp.xyz + uDrift * ( 0.6 + aRnd.x * 0.8 ), uBox ) - uBox * 0.5 + uCentre;
  vec3 toCam = cameraPosition - c;
  float dist = length( toCam );
  vec3 f = toCam / dist;
  vec3 r = normalize( cross( vec3( 0.0, 1.0, 0.0 ), f ) );
  vec3 u = cross( f, r );
  vec2 q = position.xy * aWisp.w * vec2( 1.0, 0.42 + aRnd.y * 0.25 );
  vec3 wp = c + r * q.x + u * q.y;
  vUv2 = position.xy + 0.5;
  vRnd = aRnd;
  // fade at the wrap borders, when very near the camera and with distance
  vec3 e = abs( ( c - uCentre ) / ( uBox * 0.5 ) );
  float edge = 1.0 - smoothstep( 0.75, 1.0, max( e.x, e.z ) );
  vFade = edge * smoothstep( aWisp.w * 0.35, aWisp.w * 1.1, dist );
  vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WISP_FRAG = /* glsl */`
uniform sampler2D uDetailTex;
uniform float uTime;
uniform vec3 uTint;
uniform float uOpacity;
varying vec2 vUv2;
varying vec2 vRnd;
varying float vFade;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 c = vUv2 - 0.5;
  float r = length( c ) * 2.0;
  float n = texture2D( uDetailTex, vUv2 * 0.23 + vRnd + uTime * 0.004 ).a;
  float n2 = texture2D( uDetailTex, vUv2 * 0.61 - vRnd * 3.0 - uTime * 0.007 ).r;
  float a = ( 1.0 - smoothstep( 0.1, 1.0, r + ( 0.5 - n ) * 0.8 ) ) * ( 0.4 + 0.6 * n2 );
  a *= vFade * uOpacity;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( uTint * ( 0.7 + 0.5 * n ), a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Clouds {
  readonly group = new THREE.Group();
  private sea: THREE.Mesh;
  private seaMat: THREE.ShaderMaterial;
  private wisps: THREE.Mesh;
  private wispMat: THREE.ShaderMaterial;
  private wispGeo: THREE.InstancedBufferGeometry;
  private scroll = new THREE.Vector2();
  private drift = new THREE.Vector3();
  readonly bolts = [new THREE.Vector4(0, 0, 200, 0), new THREE.Vector4(0, 0, 200, 0)];
  private fade = { value: 900 };
  private wispOpacity = { value: 0.2 };
  private wispTint = { value: new THREE.Color(0.2, 0.26, 0.38) };

  constructor(shared: SharedUniforms, sky: SkyUniforms, q: EnvQuality) {
    this.seaMat = new THREE.ShaderMaterial({
      name: 'env-cloudsea',
      uniforms: {
        ...sky,
        uDetailTex: shared.uDetailTex, uTime: shared.uTime, uMoonDir: { value: MOON_DIR.clone() },
        uScroll: { value: this.scroll }, uTop: { value: CLOUD_SEA_Y + 7 }, uBot: { value: CLOUD_SEA_Y - 10 },
        uFade: this.fade, uBolt: { value: this.bolts },
      },
      defines: { CLOUD_STEPS: q.cloudSteps },
      vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, fog: false,
    });
    const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
    plane.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(plane, this.seaMat);
    this.sea.frustumCulled = false;
    this.sea.position.y = CLOUD_SEA_Y + 7;
    this.sea.renderOrder = 800; // late in the opaque pass: mostly hidden behind the islands
    this.group.add(this.sea);

    // wisps: soft sheets drifting below the rims and high overhead (never through the play space)
    const MAXW = 40;
    const base = new THREE.PlaneGeometry(1, 1);
    this.wispGeo = new THREE.InstancedBufferGeometry();
    this.wispGeo.index = base.index;
    this.wispGeo.setAttribute('position', base.getAttribute('position'));
    const aw = new Float32Array(MAXW * 4), ar = new Float32Array(MAXW * 2);
    for (let i = 0; i < MAXW; i++) {
      const high = i % 4 === 3;
      aw[i * 4] = hash2(i, 1, 501) * 520;
      aw[i * 4 + 1] = high ? 100 + hash2(i, 2, 501) * 36 : 2 + hash2(i, 2, 501) * 26; // -> y 58..94 overhead, -40..-14 below the rims
      aw[i * 4 + 2] = hash2(i, 3, 501) * 520;
      aw[i * 4 + 3] = (high ? 90 : 46) + hash2(i, 4, 501) * 60;
      ar[i * 2] = hash2(i, 5, 501); ar[i * 2 + 1] = hash2(i, 6, 501);
    }
    this.wispGeo.setAttribute('aWisp', new THREE.InstancedBufferAttribute(aw, 4));
    this.wispGeo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(ar, 2));
    this.wispGeo.instanceCount = q.wisps;
    this.wispMat = new THREE.ShaderMaterial({
      name: 'env-wisps',
      uniforms: {
        ...THREE.UniformsLib.fog,
        uDetailTex: shared.uDetailTex, uTime: shared.uTime,
        uDrift: { value: this.drift }, uBox: { value: new THREE.Vector3(520, 140, 520) }, uCentre: { value: new THREE.Vector3(0, 28, -50) },
        uTint: this.wispTint, uOpacity: this.wispOpacity,
      },
      vertexShader: WISP_VERT, fragmentShader: WISP_FRAG,
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    this.wisps = new THREE.Mesh(this.wispGeo, this.wispMat);
    this.wisps.frustumCulled = false;
    this.wisps.renderOrder = -800;
    this.group.add(this.wisps);
  }

  setQuality(q: EnvQuality): void {
    if (this.seaMat.defines.CLOUD_STEPS !== q.cloudSteps) { this.seaMat.defines.CLOUD_STEPS = q.cloudSteps; this.seaMat.needsUpdate = true; }
    this.wispGeo.instanceCount = q.wisps;
  }

  /** windX/Z: metres per second the clouds move; fog 0..1; far: camera far plane. */
  update(dt: number, camera: THREE.PerspectiveCamera, windX: number, windZ: number, fog: number, storm: number): void {
    this.scroll.x -= windX * dt * 0.5; this.scroll.y -= windZ * dt * 0.5;
    this.drift.x += windX * dt; this.drift.z += windZ * dt;
    const ext = Math.min(camera.far * 0.68, 6000);
    this.sea.position.x = camera.position.x; this.sea.position.z = camera.position.z;
    this.sea.scale.set(ext, 1, ext);
    this.fade.value = Math.min(ext * 0.42, 1500) * (1 - fog * 0.45);
    this.wispOpacity.value = 0.34 + fog * 0.2 + storm * 0.08;
    this.wispTint.value.setRGB(0.3 - storm * 0.1, 0.38 - storm * 0.13, 0.54 - storm * 0.16);
  }

  dispose(): void {
    this.sea.geometry.dispose(); this.seaMat.dispose();
    this.wispGeo.dispose(); this.wispMat.dispose();
  }
}
