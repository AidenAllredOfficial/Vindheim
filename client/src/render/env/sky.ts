// Sky dome (arctic dusk gradient, ember horizon, stars, cirrus, a large pale moon), aurora
// ribbons, and the image-based-lighting environment baked from the same sky.
import * as THREE from 'three';
import type { Weather } from '@shared/weather';
import { MOON_DIR, SUNSET_DIR, type EnvQuality, type SharedUniforms } from './common';

/** GLSL shared by the sky dome and the cloud sea so both agree exactly at the horizon. */
export const SKY_GLSL = /* glsl */`
uniform vec3 uSunsetDir;
uniform vec3 uFogCol;
uniform float uOvercast;
uniform float uStorm;
float skyGlow( vec3 d ) {
  vec2 hd = normalize( d.xz + vec2( 1e-5 ) );
  float west = dot( hd, uSunsetDir.xz ) * 0.5 + 0.5;
  west = west * west * ( 3.0 - 2.0 * west );
  return west * west;
}
vec3 skyBase( vec3 d ) {
  float h = max( d.y, 0.0 );
  float glow = skyGlow( d );
  vec3 zen = vec3( 0.008, 0.022, 0.058 );
  vec3 up = vec3( 0.014, 0.055, 0.105 );
  vec3 teal = vec3( 0.035, 0.125, 0.165 );
  vec3 c = mix( up, zen, smoothstep( 0.3, 0.95, h ) );
  c = mix( teal, c, smoothstep( 0.02, 0.45, h ) );
  vec3 rose = mix( vec3( 0.10, 0.07, 0.16 ), vec3( 0.42, 0.16, 0.17 ), glow );
  c = mix( c, rose, exp( - h * mix( 11.0, 5.5, glow ) ) * mix( 0.55, 0.9, glow ) );
  float eb = exp( - h * mix( 30.0, 12.0, glow ) );
  c += vec3( 1.35, 0.46, 0.10 ) * eb * mix( 0.06, 1.0, glow ) * ( 1.0 - uOvercast * 0.75 );
  vec3 grey = uFogCol * ( 0.85 + 0.5 * h );
  c = mix( c, grey, uOvercast * 0.9 );
  c *= 1.0 - uStorm * 0.45;
  float hz = exp( - h * 38.0 );
  c = mix( c, uFogCol * ( 1.0 + glow * vec3( 2.2, 0.7, 0.1 ) * ( 1.0 - uOvercast ) ), hz * 0.85 );
  return c;
}
`;

export interface SkyUniforms {
  uSunsetDir: { value: THREE.Vector3 };
  uFogCol: { value: THREE.Color };
  uOvercast: { value: number };
  uStorm: { value: number };
  /** xz = unit direction toward the flash, w = brightness. */
  uFlash: { value: THREE.Vector4 };
}

export function makeSkyUniforms(): SkyUniforms {
  return {
    uSunsetDir: { value: SUNSET_DIR.clone() },
    uFogCol: { value: new THREE.Color(0.1, 0.13, 0.2) },
    uOvercast: { value: 0 },
    uStorm: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 0, 0, 0) },
  };
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = vec4( p.xy, p.w * 0.99999, p.w );
}
`;

const SKY_FRAG = /* glsl */`
uniform sampler2D uDetailTex;
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uMoonX;
uniform vec3 uMoonY;
uniform float uMoonSize;
uniform float uMoonBright;
uniform vec4 uFlash;
varying vec3 vDir;
#include <common>
${SKY_GLSL}
float hash31( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
vec3 hash33( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.xxy + p.yxx ) * p.zyx ); }
float starLayer( vec3 d, float scale, float density, float size ) {
  vec3 p = d * scale;
  vec3 ip = floor( p );
  vec3 fp = fract( p ) - 0.5;
  float rnd = hash31( ip );
  vec3 off = ( hash33( ip ) - 0.5 ) * 0.56;
  float dd = length( fp - off );
  float tw = 0.72 + 0.28 * sin( uTime * ( 1.2 + rnd * 4.0 ) + rnd * 90.0 );
  float mag = fract( rnd * 57.3 );
  return smoothstep( size, 0.0, dd ) * step( 1.0 - density, rnd ) * tw * ( 0.12 + 0.88 * mag * mag * mag );
}
void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  vec3 col = skyBase( d );
  float glow = skyGlow( d );
  float clear = ( 1.0 - uOvercast ) * ( 1.0 - uStorm * 0.6 );
  float cirrus = 0.0;
  #if SKY_DETAIL >= 2
  {
    vec2 cu = d.xz / ( max( h, 0.0 ) + 0.3 );
    float c1 = texture2D( uDetailTex, cu * 0.11 + uTime * vec2( 0.0011, 0.0004 ) ).a;
    float c2 = texture2D( uDetailTex, cu * vec2( 0.31, 0.17 ) - uTime * vec2( 0.0017, 0.0006 ) ).r;
    cirrus = smoothstep( 0.5 - uOvercast * 0.3, 0.95, c1 * 0.62 + c2 * 0.5 ) * smoothstep( 0.0, 0.22, h );
    float moonlit = pow( max( dot( d, uMoonDir ), 0.0 ), 5.0 );
    vec3 cc = mix( vec3( 0.04, 0.062, 0.105 ), vec3( 0.30, 0.37, 0.52 ), moonlit );
    cc += vec3( 0.9, 0.3, 0.1 ) * glow * exp( - max( h, 0.0 ) * 5.0 ) * 0.45 * ( 1.0 - uOvercast );
    col = mix( col, cc, cirrus * 0.6 );
  }
  #endif
  #if SKY_DETAIL >= 1
  {
    float vis = smoothstep( 0.03, 0.4, h ) * clear * ( 1.0 - cirrus * 0.8 );
    if ( vis > 0.01 ) {
      float s = starLayer( d, 120.0, 0.075, 0.13 ) * 2.6;
      #if SKY_DETAIL >= 2
        s += starLayer( d.zxy, 260.0, 0.11, 0.15 ) * 0.9;
        // star dust along a great band
        float band = exp( - pow( dot( d, normalize( vec3( 0.35, 0.5, - 0.79 ) ) ) * 3.2, 2.0 ) );
        float dust = texture2D( uDetailTex, d.xz * 1.7 + d.y ).r * texture2D( uDetailTex, d.zy * 3.1 ).a;
        col += vec3( 0.12, 0.16, 0.26 ) * band * dust * 0.5 * vis;
        s *= 1.0 + band * 1.2;
      #endif
      vec3 sc = mix( vec3( 0.72, 0.82, 1.0 ), vec3( 1.0, 0.86, 0.72 ), fract( s * 7.31 ) );
      col += sc * s * vis;
    }
  }
  #endif
  // moon: gibbous disc with maria, soft corona
  float md = dot( d, uMoonDir );
  float corona = exp( - ( 1.0 - md ) * 60.0 ) * 0.22 + exp( - ( 1.0 - md ) * 700.0 ) * 0.5;
  col += vec3( 0.42, 0.58, 0.9 ) * corona * ( 1.0 - uOvercast * 0.6 ) * ( 1.0 - uStorm * 0.5 );
  vec2 q = vec2( dot( d, uMoonX ), dot( d, uMoonY ) ) / uMoonSize;
  float r2 = dot( q, q );
  if ( md > 0.0 && r2 < 1.0 ) {
    float z = sqrt( 1.0 - r2 );
    vec3 n = vec3( q, z );
    float lit = clamp( dot( n, normalize( vec3( - 0.5, 0.28, 0.82 ) ) ) * 1.7 + 0.22, 0.0, 1.0 );
    float maria = texture2D( uDetailTex, q * 0.21 + 0.37 ).a;
    float fine = texture2D( uDetailTex, q * 0.9 + 0.11 ).r;
    float crater = texture2D( uDetailTex, q * 0.5 + 0.2 ).g;
    float alb = mix( 0.34, 1.0, smoothstep( 0.3, 0.72, maria ) ) * ( 0.78 + 0.44 * fine ) * ( 1.0 - crater * 0.25 );
    vec3 mc = vec3( 0.84, 0.91, 1.0 ) * alb * lit * uMoonBright * ( 0.6 + 0.4 * z );
    float edge = ( 1.0 - smoothstep( 0.93, 1.0, r2 ) );
    col = mix( col, mc + col * 0.35, edge * ( 1.0 - uOvercast * 0.85 ) * ( 1.0 - cirrus * 0.5 ) );
  }
  // distant lightning lights the horizon
  vec2 hd = normalize( d.xz + vec2( 1e-5 ) );
  float fl = pow( max( dot( hd, uFlash.xy ), 0.0 ), 3.0 ) * exp( - max( h, 0.0 ) * 6.0 ) + 0.12 * exp( - max( h, 0.0 ) * 2.0 );
  col += vec3( 0.62, 0.66, 1.0 ) * fl * uFlash.w;
  #ifdef ENV_BAKE
    // lower hemisphere = the moonlit cloud sea bouncing light back up
    col = mix( col, vec3( 0.030, 0.045, 0.080 ), ( 1.0 - smoothstep( - 0.3, 0.0, h ) ) );
  #endif
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const AURORA_VERT = /* glsl */`
uniform float uTime;
uniform vec4 uRibbon;   // azimuth, length, distance, base altitude
uniform vec2 uShape;    // height, seed
varying vec2 vSt;
varying float vElev;
void main() {
  float s = uv.x, t = uv.y;
  float seed = uShape.y;
  float x = ( s - 0.5 ) * uRibbon.y;
  float z = - uRibbon.z + sin( s * 6.0 + uTime * 0.06 + seed ) * 170.0 + sin( s * 15.0 - uTime * 0.11 + seed * 2.0 ) * 60.0 + sin( s * 37.0 + uTime * 0.23 + seed * 5.0 ) * 16.0;
  float y = uRibbon.w + t * uShape.x * ( 0.7 + 0.4 * sin( s * 9.0 + seed * 4.0 + uTime * 0.05 ) );
  float ca = cos( uRibbon.x ), sa = sin( uRibbon.x );
  vec3 P = vec3( x * ca - z * sa, y, x * sa + z * ca );
  vec3 dir = normalize( P );
  vSt = vec2( s, t );
  vElev = dir.y;
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * dir, 1.0 );
  gl_Position = vec4( p.xy, p.w * 0.9999, p.w );
}
`;

const AURORA_FRAG = /* glsl */`
uniform sampler2D uDetailTex;
uniform float uTime;
uniform float uAurora;
uniform vec2 uShape;
varying vec2 vSt;
varying float vElev;
#include <common>
void main() {
  float s = vSt.x, t = vSt.y;
  float seed = uShape.y;
  float rays = texture2D( uDetailTex, vec2( s * 7.0 + uTime * 0.011 + seed, 0.37 + seed * 0.13 ) ).r;
  float fine = texture2D( uDetailTex, vec2( s * 41.0 - uTime * 0.035, 0.11 + t * 0.03 + seed ) ).r;
  float drift = texture2D( uDetailTex, vec2( s * 1.7 - uTime * 0.006, seed * 0.31 ) ).a;
  float curtain = pow( max( rays, 0.0 ), 2.2 ) * 1.6 * ( 0.35 + 1.0 * fine ) * smoothstep( 0.2, 0.75, drift );
  float vert = smoothstep( 0.0, 0.05, t ) * pow( clamp( 1.0 - t, 0.0, 1.0 ), 1.7 );
  vec3 col = mix( vec3( 0.16, 0.92, 0.5 ), vec3( 0.12, 0.55, 0.8 ), smoothstep( 0.08, 0.5, t ) );
  col = mix( col, vec3( 0.62, 0.22, 0.95 ), smoothstep( 0.4, 0.95, t ) );
  float ends = smoothstep( 0.0, 0.14, s ) * ( 1.0 - smoothstep( 0.86, 1.0, s ) );
  float horizon = smoothstep( 0.03, 0.16, vElev );
  gl_FragColor = vec4( col * curtain * vert * ends * horizon * uAurora * 1.25, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly group = new THREE.Group();
  readonly uniforms: SkyUniforms;
  private dome: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private ribbons: THREE.Mesh[] = [];
  private auroraU = { value: 0 };
  private moonBright = { value: 2.3 };
  private aurora = 0;

  constructor(private shared: SharedUniforms, q: EnvQuality) {
    this.uniforms = makeSkyUniforms();
    const mx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), MOON_DIR).normalize();
    const my = new THREE.Vector3().crossVectors(MOON_DIR, mx).normalize();
    this.mat = new THREE.ShaderMaterial({
      name: 'env-sky',
      uniforms: {
        ...this.uniforms,
        uDetailTex: shared.uDetailTex, uTime: shared.uTime,
        uMoonDir: { value: MOON_DIR.clone() }, uMoonX: { value: mx }, uMoonY: { value: my },
        uMoonSize: { value: Math.sin(4.3 * Math.PI / 180) }, uMoonBright: this.moonBright,
      },
      defines: { SKY_DETAIL: q.skyDetail },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), this.mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 900; // after the opaque world: only uncovered pixels are shaded
    this.dome.matrixAutoUpdate = false;
    this.group.add(this.dome);

    // aurora: curtains to the north (behind the hall when seen from the arena) and one overhead
    const specs: [number, number, number, number, number, number][] = [
      // azimuth, length, distance, base altitude, height, seed
      [0.0, 3400, 950, 330, 330, 1.0],
      [0.5, 2800, 620, 420, 300, 4.3],
      [-0.6, 3000, 1300, 300, 420, 7.7],
      [2.5, 2600, 1100, 380, 300, 11.1],
    ];
    const geo = new THREE.PlaneGeometry(1, 1, 120, 6);
    for (let i = 0; i < specs.length; i++) {
      const [az, len, dist, alt, hgt, seed] = specs[i];
      const m = new THREE.ShaderMaterial({
        name: 'env-aurora',
        uniforms: {
          uDetailTex: shared.uDetailTex, uTime: shared.uTime, uAurora: this.auroraU,
          uRibbon: { value: new THREE.Vector4(az, len, dist, alt) }, uShape: { value: new THREE.Vector2(hgt, seed) },
        },
        vertexShader: AURORA_VERT, fragmentShader: AURORA_FRAG,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = -900; // first of the transparent queue: behind every effect
      mesh.matrixAutoUpdate = false;
      this.ribbons.push(mesh);
      this.group.add(mesh);
    }
    this.setQuality(q);
  }

  setQuality(q: EnvQuality): void {
    if (this.mat.defines.SKY_DETAIL !== q.skyDetail) { this.mat.defines.SKY_DETAIL = q.skyDetail; this.mat.needsUpdate = true; }
    this.ribbons.forEach((r, i) => { r.visible = i < q.auroraRibbons; });
  }

  update(dt: number, weather: Weather): void {
    const target = weather.aurora;
    this.aurora += (target - this.aurora) * Math.min(1, dt * 0.5);
    // the ribbons breathe slowly
    this.auroraU.value = this.aurora * (0.72 + 0.28 * Math.sin(this.shared.uTime.value * 0.13));
    this.moonBright.value = 2.3;
  }

  /**
   * Bake the sky into a PMREM environment for image-based fill and reflections: cool from the
   * moon side, warm from the ember horizon, dim blue from the cloud sea below.
   */
  bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const mat = this.mat.clone();
    mat.uniforms = { ...this.mat.uniforms, uOvercast: { value: 0.15 }, uStorm: { value: 0 }, uFlash: { value: new THREE.Vector4(1, 0, 0, 0) }, uMoonBright: { value: 9 } };
    mat.defines = { SKY_DETAIL: 0, ENV_BAKE: 1 };
    mat.side = THREE.BackSide;
    mat.depthTest = false;
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(scene, 0.03, 0.1, 100);
    pmrem.dispose();
    mesh.geometry.dispose();
    mat.dispose();
    return rt.texture;
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.mat.dispose();
    if (this.ribbons.length) this.ribbons[0].geometry.dispose();
    for (const r of this.ribbons) (r.material as THREE.Material).dispose();
  }
}
