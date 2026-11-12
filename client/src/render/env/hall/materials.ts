// Materials for the Hearth-Hall.
//  * hallStandard(): MeshStandardMaterial patched with baked vertex lighting (fire, candles,
//    pedestal glow), a per-vertex sky-visibility term that keeps moon/sky light out of the
//    interior, optional snow cover and cloth sway.
//  * Custom HDR shaders: flames, coal bed, Skygate membrane, glow glyphs, particle sprites.
// Every custom fragment shader ends with the tonemapping + colorspace chunks (project rule).
import * as THREE from 'three';
import type { QualityLevel } from '../../../settings';
import type { HallTextures } from './textures';

export interface HallUniforms {
  uTime: { value: number };
  /** Fire flicker multiplier on the baked light (~0.8..1.15). */
  uFlick: { value: number };
  /** Glow colour x intensity of each pedestal (element order). */
  uPed: { value: THREE.Vector3[] };
  /** Wind strength 0..1 for cloth. */
  uWind: { value: number };
  /** Overall multiplier on the baked interior light (exposure trim). */
  uBakeGain: { value: number };
}

export function makeUniforms(): HallUniforms {
  return {
    uTime: { value: 0 },
    uFlick: { value: 1 },
    uPed: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    uWind: { value: 0.3 },
    uBakeGain: { value: 1 },
  };
}

export interface HallMatOpts { snow?: boolean; sway?: boolean }

/** Standard material + hall lighting patch. Geometry must carry aBake, aLm (and aFx when snow/sway is on). */
export function hallStandard(params: THREE.MeshStandardMaterialParameters, U: HallUniforms, opts: HallMatOpts = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...params });
  const key = `hall:${opts.snow ? 1 : 0}${opts.sway ? 1 : 0}`;
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uFlick = U.uFlick; sh.uniforms.uPed = U.uPed; sh.uniforms.uWind = U.uWind; sh.uniforms.uBakeGain = U.uBakeGain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aBake;
attribute vec3 aLm;
attribute vec2 aFx;
uniform vec3 uPed[8];
uniform float uFlick;
uniform float uTime;
uniform float uWind;
uniform float uBakeGain;
varying vec3 vHallBake;
varying float vHallSky;
varying float vHallSnow;
varying vec2 vHallXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vHallXZ = transformed.xz + transformed.y * 0.37;
// firelight flickers fully indoors, at half depth outdoors
vHallBake = (aBake * mix(uFlick, 0.5 + 0.5 * uFlick, aLm.x) + uPed[int(aLm.y + 0.5)] * aLm.z) * uBakeGain;
vHallSky = aLm.x;
vHallSnow = aFx.x;
${opts.sway ? `{
  float hsw = aFx.y;
  float hph = uTime * (1.3 + uWind * 1.6) + transformed.x * 0.8 + transformed.z * 0.8 + transformed.y * 0.9;
  transformed += (objectNormal * (sin(hph) * 0.10 + sin(hph * 2.3 + 1.7) * 0.035) + vec3(0.0, sin(hph * 0.7) * 0.02, 0.0)) * hsw * (0.25 + uWind);
}` : ''}`);
    let chunk = THREE.ShaderChunk.lights_fragment_begin;
    chunk = chunk.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= vHallSky;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vHallBake;
varying float vHallSky;
varying float vHallSnow;
varying vec2 vHallXZ;
float hallHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hallNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hallHash(i), hallHash(i + vec2(1.0, 0.0)), f.x), mix(hallHash(i + vec2(0.0, 1.0)), hallHash(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
${opts.snow ? `{
  float hn = hallNoise(vHallXZ * 0.55) * 0.55 + hallNoise(vHallXZ * 2.3) * 0.3 + hallNoise(vHallXZ * 9.0) * 0.15;
  float hsv = vHallSnow * 1.1 + (hn - 0.5) * 0.85;
  #ifdef USE_MAP
    hsv += (sampledDiffuseColor.g - 0.5) * 0.22;
  #endif
  float hsn = smoothstep(0.36, 0.66, hsv + (hallNoise(vHallXZ * 31.0) - 0.5) * 0.12) * step(0.02, vHallSnow);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.86, 0.95) * (0.9 + 0.1 * hallNoise(vHallXZ * 23.0)), hsn);
  roughnessFactor = mix(roughnessFactor, 0.92, hsn);
}` : ''}`)
      .replace('#include <lights_fragment_begin>', chunk + '\n#if defined( RE_IndirectDiffuse )\n irradiance *= vHallSky;\n#endif\n')
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectDiffuse )
  iblIrradiance *= vHallSky;
#endif
#if defined( RE_IndirectSpecular )
  radiance *= vHallSky;
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vHallBake;`);
  };
  return m;
}

// ------------------------------------------------------------------------------------------------
// Shared GLSL
// ------------------------------------------------------------------------------------------------

const FOG_FADE_PARS_V = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
#endif`;
const FOG_FADE_V = /* glsl */`
#ifdef USE_FOG
  vFogDepth = -mvPosition.z;
#endif`;
/** Fog for additive / premultiplied layers: fade out instead of blending toward the fog colour. */
const FOG_FADE_PARS_F = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec3 fogColor;
  float hallFogFade() {
    #ifdef FOG_EXP2
      return exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      return 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  }
#else
  float hallFogFade() { return 1.0; }
#endif`;
const TAIL = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

// ------------------------------------------------------------------------------------------------
// Flames: instanced, Y-locked billboards with a scrolling-noise flame shader
// ------------------------------------------------------------------------------------------------

export function flameMaterial(T: HallTextures, U: HallUniforms, q: QualityLevel): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms(), uTime: U.uTime, uNoise: { value: T.noise } },
    defines: { FLAME_LOD: q === 'low' ? 0 : q === 'medium' ? 1 : 2 },
    fog: true, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
attribute vec4 iPos;   // xyz base, w seed
attribute vec4 iSize;  // width, height, heat, lean
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
uniform float uTime;
${FOG_FADE_PARS_V}
void main() {
  vUv = uv;
  vSeed = iPos.w;
  vHeat = iSize.z;
  vec3 base = iPos.xyz;
  vec3 toCam = cameraPosition - base;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
  float sway = sin(uTime * 2.3 + iPos.w * 17.0) * 0.06 + sin(uTime * 5.1 + iPos.w * 31.0) * 0.03;
  vec3 p = base + right * (position.x * iSize.x + sway * uv.y * uv.y * iSize.y) + vec3(0.0, uv.y * iSize.y, 0.0);
  p.xz += vec2(sin(iPos.w * 40.0), cos(iPos.w * 40.0)) * iSize.w * uv.y * uv.y;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_V}
}`,
    fragmentShader: /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
${FOG_FADE_PARS_F}
void main() {
  float x = vUv.x * 2.0 - 1.0, y = vUv.y;
  float t = uTime;
  vec2 q = vec2(vUv.x * 0.42 + vSeed * 3.7, y * 0.5 - t * 0.56 - vSeed);
  float n1 = texture2D(uNoise, q).r;
  #if FLAME_LOD > 0
    float n2 = texture2D(uNoise, q * 2.1 + vec2(0.37, -t * 0.6)).g;
  #else
    float n2 = n1;
  #endif
  #if FLAME_LOD > 1
    float n3 = texture2D(uNoise, q * 4.7 + vec2(-0.21, -t * 1.25)).r;
    float n = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
  #else
    float n = n1 * 0.6 + n2 * 0.4;
  #endif
  // a tongue: narrows with height, its centre line wanders
  float cx = (n1 - 0.5) * 1.1 * y + (n2 - 0.5) * 0.45 * y;
  float w = mix(0.92, 0.1, smoothstep(0.0, 1.0, y));
  float f = 1.0 - abs(x - cx) / w;
  f += (n - 0.5) * (0.7 + 2.0 * y);
  f -= y * y * 0.42;
  float a = smoothstep(0.0, 0.2, f);
  a *= smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.88, 1.0, y));
  float core = smoothstep(0.3, 0.95, f) * (1.0 - y * 0.55);
  vec3 c0 = vec3(0.62, 0.045, 0.004);  // deep red edges and tips
  vec3 c1 = vec3(1.0, 0.33, 0.035);    // orange body
  vec3 c2 = vec3(1.0, 0.70, 0.24);     // hot core
  vec3 col = mix(c0, c1, smoothstep(0.02, 0.42, f));
  col = mix(col, c2, core);
  float ff = hallFogFade();
  col *= a * (0.7 + core * 1.15) * vHeat * ff;
  // premultiplied: nearer tongues veil the ones behind, so a fire seen end-on saturates instead of whiting out
  gl_FragColor = vec4(col, a * 0.78 * ff);
  ${TAIL}
}`,
  });
}

// ------------------------------------------------------------------------------------------------
// Coal bed: self-lit glowing embers between charred logs
// ------------------------------------------------------------------------------------------------

export function coalMaterial(T: HallTextures, U: HallUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms(), uTime: U.uTime, uNoise: { value: T.noise }, uFlick: U.uFlick },
    fog: true,
    vertexShader: /* glsl */`
attribute float aHeat;
varying vec2 vUv;
varying float vHeat;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vHeat = aHeat;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
uniform float uFlick;
varying vec2 vUv;
varying float vHeat;
#include <fog_pars_fragment>
void main() {
  vec4 n = texture2D(uNoise, vUv * 0.9);
  vec4 n2 = texture2D(uNoise, vUv * 2.6 + vec2(0.31, 0.17));
  float cells = n.b * 0.6 + n2.b * 0.4;                 // ridged: bright cracks between lumps
  float lump = n2.r;
  float pulse = 0.72 + 0.28 * sin(uTime * (1.2 + n.a * 2.0) + n.g * 20.0);
  float heat = smoothstep(0.42, 0.95, cells * 0.75 + lump * 0.45) * pulse * vHeat;
  vec3 ash = mix(vec3(0.012, 0.010, 0.009), vec3(0.07, 0.065, 0.06), n2.g * n.r);
  vec3 glow = mix(vec3(0.9, 0.05, 0.0), vec3(1.0, 0.42, 0.06), smoothstep(0.2, 0.7, heat));
  glow = mix(glow, vec3(1.0, 0.82, 0.4), smoothstep(0.75, 1.0, heat));
  vec3 col = ash * (0.4 + vHeat * 0.8) + glow * heat * (1.0 + heat * 5.0) * (0.85 + 0.15 * uFlick);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  ${TAIL}
}`,
  });
}

// ------------------------------------------------------------------------------------------------
// Glow glyphs: additive rune sheets (static geometry, vertex colour = HDR tint, aPhase = pulse offset)
// ------------------------------------------------------------------------------------------------

export function glyphMaterial(T: HallTextures, U: HallUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms(), uTime: U.uTime, uMap: { value: T.glyph } },
    fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: /* glsl */`
attribute vec3 color;
attribute float aPhase;
varying vec2 vUv;
varying vec3 vCol;
uniform float uTime;
${FOG_FADE_PARS_V}
void main() {
  vUv = uv;
  float pulse = 0.72 + 0.28 * sin(uTime * 1.1 + aPhase * 6.2831);
  float wave = 0.5 + 0.5 * sin(uTime * 2.4 - aPhase * 18.0);
  vCol = color * (pulse + wave * wave * 0.5);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_V}
}`,
    fragmentShader: /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vCol;
${FOG_FADE_PARS_F}
void main() {
  float m = texture2D(uMap, vUv).r;
  vec3 col = vCol * m * (0.6 + m * 0.8) * hallFogFade();
  gl_FragColor = vec4(col, 1.0);
  ${TAIL}
}`,
  });
}

// ------------------------------------------------------------------------------------------------
// Skygate membrane
// ------------------------------------------------------------------------------------------------

export function membraneMaterial(T: HallTextures, U: HallUniforms, q: QualityLevel): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(), uTime: U.uTime, uNoise: { value: T.noise },
      uHalfW: { value: 2.6 }, uSpring: { value: 6.2 }, uPower: { value: 1 },
    },
    defines: { GATE_LOD: q === 'low' ? 0 : q === 'medium' ? 1 : 2 },
    fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    // premultiplied: rgb is added, alpha veils what is behind
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    vertexShader: /* glsl */`
varying vec2 vP;   // metres: x across (0 centre), y above the threshold
${FOG_FADE_PARS_V}
void main() {
  vP = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_V}
}`,
    fragmentShader: /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
uniform float uHalfW;
uniform float uSpring;
uniform float uPower;
varying vec2 vP;
${FOG_FADE_PARS_F}
// signed distance to the gate opening (rectangle with a round top), negative inside
float sdGate(vec2 p) {
  vec2 q = vec2(abs(p.x), p.y);
  if (q.y > uSpring) return length(vec2(q.x, q.y - uSpring)) - uHalfW;
  return max(q.x - uHalfW, -q.y - 2.0);
}
void main() {
  float t = uTime;
  float sd = sdGate(vP);
  float inside = smoothstep(0.0, -0.06, sd);
  float edge = exp(sd * 2.4);                       // 1 at the frame, falling inward
  vec2 c = vP - vec2(0.0, uSpring * 0.62);
  float r = length(c * vec2(1.0, 0.72));
  float ang = atan(c.y, c.x);
  // swirl: angular speed rises toward the eye
  float sw = ang + t * 0.22 + 1.6 / (r + 0.7);
  vec2 pu = vec2(sw * 0.3183, r * 0.21 - t * 0.07);
  float n1 = texture2D(uNoise, pu).r;
  float n2 = texture2D(uNoise, pu * vec2(2.0, 2.7) + vec2(t * 0.03, -t * 0.11)).g;
  #if GATE_LOD > 0
    float rid = texture2D(uNoise, pu * vec2(1.0, 1.9) + vec2(-t * 0.05, n1 * 0.25)).b;
  #else
    float rid = n2;
  #endif
  // seam of atan at +-pi: cross-fade with a second sample taken with a shifted branch cut
  float sw2 = atan(-c.y, -c.x) + 3.14159265 + t * 0.22 + 1.6 / (r + 0.7);
  float seam = smoothstep(2.6, 3.1, abs(ang));
  vec2 pu2 = vec2(sw2 * 0.3183, r * 0.21 - t * 0.07);
  n1 = mix(n1, texture2D(uNoise, pu2).r, seam);
  float fil = pow(rid, 14.0) * smoothstep(0.25, 0.6, n2);              // thin bright filaments
  float cloud = n1 * 0.65 + n2 * 0.35;
  // rising veils
  float veil = texture2D(uNoise, vec2(vP.x * 0.16 + n1 * 0.08, vP.y * 0.05 - t * 0.12)).a;
  #if GATE_LOD > 1
    float stars = texture2D(uNoise, vP * 0.9 + vec2(t * 0.01, t * 0.02)).g;
    stars = smoothstep(0.80, 0.86, stars) * (0.5 + 0.5 * sin(t * 3.0 + vP.x * 9.0 + vP.y * 7.0));
  #else
    float stars = 0.0;
  #endif
  vec3 deep = vec3(0.008, 0.045, 0.10);
  vec3 teal = vec3(0.06, 0.62, 0.48);
  vec3 ice = vec3(0.55, 0.92, 1.0);
  vec3 violet = vec3(0.42, 0.20, 0.85);
  float band = smoothstep(0.35, 0.8, cloud);
  vec3 col = mix(deep, teal, band) * (0.22 + cloud * 0.8);
  col = mix(col, violet * 0.55, smoothstep(0.5, 0.9, veil) * 0.62);
  col += mix(teal, ice, 0.65) * fil * 2.0;
  col += vec3(0.9, 1.0, 1.0) * stars * 1.3;
  // eye: bright calm centre
  float eye = exp(-r * r * 0.7);
  col += mix(teal, ice, 0.4) * eye * (0.22 + 0.12 * sin(t * 1.3));
  // rim against the stone frame + ripples running along it
  float rip = 0.6 + 0.4 * sin(sd * 9.0 + t * 3.0 + n1 * 6.0);
  col += mix(teal, ice, 0.7) * (pow(edge, 3.0) * 0.9 * rip + pow(edge, 10.0) * 2.4);
  // fade toward the ground so it melts into the threshold
  float ground = smoothstep(-1.6, 0.5, vP.y);
  float alpha = inside * ground * (0.42 + 0.3 * cloud + 0.2 * edge + 0.1 * eye);
  col *= inside * ground * uPower * hallFogFade();
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.9) * hallFogFade());
  ${TAIL}
}`,
  });
}

// ------------------------------------------------------------------------------------------------
// Particle sprites: instanced quads, premultiplied blend (alpha 0 = additive, alpha > 0 = veiling)
// ------------------------------------------------------------------------------------------------

export function spriteMaterial(T: HallTextures): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms(), uMap: { value: T.particles } },
    fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    vertexShader: /* glsl */`
attribute vec4 iPosRot;   // xyz, rotation
attribute vec4 iSize;     // sx, sy, frame, mode (0 billboard, 1 flat on XZ, 2 upright Y-locked)
attribute vec4 iColor;    // premultiplied HDR rgb, alpha
varying vec2 vUv;
varying vec4 vCol;
${FOG_FADE_PARS_V}
void main() {
  float fr = iSize.z;
  vec2 cell = vec2(mod(fr, 4.0), floor(fr / 4.0));
  vUv = (cell + vec2(uv.x, 1.0 - uv.y) * 0.96 + 0.02) * 0.25;
  vUv.y = 1.0 - vUv.y;
  vCol = iColor;
  float cs = cos(iPosRot.w), sn = sin(iPosRot.w);
  float mode = floor(iSize.w + 0.01);
  vec2 q = (position.xy + vec2(0.0, step(0.1, fract(iSize.w)) * 0.5)) * iSize.xy;
  vec4 mvPosition;
  if (mode < 0.5) {
    q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
    mvPosition = viewMatrix * vec4(iPosRot.xyz, 1.0);
    mvPosition.xy += q;
  } else if (mode < 1.5) {
    q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
    mvPosition = viewMatrix * vec4(iPosRot.xyz + vec3(q.x, 0.0, q.y), 1.0);
  } else {
    vec3 toCam = cameraPosition - iPosRot.xyz;
    vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
    vec3 up = vec3(sn * right.x, cs, sn * right.z);
    vec3 rt = vec3(cs * right.x, -sn, cs * right.z);
    mvPosition = viewMatrix * vec4(iPosRot.xyz + rt * q.x + up * q.y, 1.0);
  }
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_V}
}`,
    fragmentShader: /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
${FOG_FADE_PARS_F}
void main() {
  float m = texture2D(uMap, vUv).a;
  float f = hallFogFade();
  gl_FragColor = vec4(vCol.rgb * m * f, vCol.a * m * f);
  ${TAIL}
}`,
  });
}

// ------------------------------------------------------------------------------------------------
// Emblem rune stones (instanced): dark carved stone whose rune glows in the element colour
// ------------------------------------------------------------------------------------------------

export function emblemMaterial(T: HallTextures, U: HallUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: T.rock.map, normalMap: T.rock.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.62, metalness: 0.05 });
  m.customProgramCacheKey = () => 'hall:emblem';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlyph = { value: T.glyph };
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aGlow;      // rgb glow (HDR), w = rune index
attribute vec2 aRuneUv;    // 0..1 on the rune faces, < 0 elsewhere
attribute vec4 aBody;      // rgb = warm fill light on the body, w = rim amount
varying vec4 vGlow;
varying vec2 vRuneUv;
varying vec4 vBody;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow; vRuneUv = aRuneUv; vBody = aBody;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uGlyph;
uniform float uTime;
varying vec4 vGlow;
varying vec2 vRuneUv;
varying vec4 vBody;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float idx = floor(vGlow.w + 0.5);
  vec2 cell = vec2(mod(idx, 8.0), floor(idx / 8.0));
  vec2 ruv = (cell + clamp(vec2(vRuneUv.x, 1.0 - vRuneUv.y), 0.02, 0.98)) / 8.0;
  ruv.y = 1.0 - ruv.y;
  float mask = (vRuneUv.x >= 0.0) ? texture2D(uGlyph, ruv).r : 0.0;
  float groove = smoothstep(0.25, 0.7, mask);
  diffuseColor.rgb *= 1.0 - groove * 0.7;
  totalEmissiveRadiance += vGlow.rgb * (mask * (0.5 + mask * 1.2));
  totalEmissiveRadiance += diffuseColor.rgb * vBody.rgb;
  float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.5);
  totalEmissiveRadiance += vGlow.rgb * rimF * vBody.w;
}`);
  };
  return m;
}

/** Plain instanced prop material (chains, pebbles, crowns) with a constant warm fill so it reads in the dark hall. */
export function propMaterial(params: THREE.MeshStandardMaterialParameters, fill: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(params);
  m.customProgramCacheKey = () => 'hall:prop';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFill = { value: fill };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFill;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.34) * uFill;`);
  };
  return m;
}
