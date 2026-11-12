// Shared GLSL for every effect material.
//
// Conventions (see contracts.ts): effects render into a linear HDR buffer, glow = values > 1.
// Every material here uses PREMULTIPLIED blending (ONE, ONE_MINUS_SRC_ALPHA) and writes
// vec4(rgb * coverage, coverage * (1 - additive)), so one material can mix alpha-blended
// (smoke, scorch, rock) and additive (fire, light) pixels – and even fade between the two.

import * as THREE from 'three';

export const NOISE = /* glsl */ `
float vHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vHash3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vHash(i), vHash(i + vec2(1.0, 0.0)), f.x), mix(vHash(i + vec2(0.0, 1.0)), vHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vNoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(vHash3(i), vHash3(i + vec3(1,0,0)), f.x), mix(vHash3(i + vec3(0,1,0)), vHash3(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(vHash3(i + vec3(0,0,1)), vHash3(i + vec3(1,0,1)), f.x), mix(vHash3(i + vec3(0,1,1)), vHash3(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
float vFbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
float vFbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vNoise3(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }
// cellular: nearest-cell id hash in .z of the result
vec3 vCellId(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(vHash(i + g), vHash(i + g + 7.7));
    float d = length(g + o - f);
    if (d < d1){ d2 = d1; d1 = d; id = vHash(i + g + 3.3); } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2, id);
}
// cellular distance (for ice / cracks)
vec2 vCell(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(vHash(i + g), vHash(i + g + 7.7));
    float d = length(g + o - f);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
`;

export const FOG_V_PARS = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
`;
export const FOG_V = /* glsl */ `
#include <fog_vertex>
`;

/** Fragment helpers: fog factor + the common premultiplied output footer. */
export const FRAG_PARS = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
float vfxFog(){
#ifdef USE_FOG
  #ifdef FOG_EXP2
    return 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    return smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#else
  return 0.0;
#endif
}
// rgb is premultiplied by coverage; alpha is the part that occludes the background.
vec4 vfxFogged(vec3 rgb, float alpha){
#ifdef USE_FOG
  float f = vfxFog();
  rgb = mix(rgb, fogColor * alpha, f * mix(0.7, 1.0, clamp(alpha, 0.0, 1.0)));
#endif
  return vec4(rgb, alpha);
}
`;

/** Every fragment shader ends with this (contract: tonemapping + colourspace chunks). */
export const FRAG_END = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

export function premult(mat: THREE.ShaderMaterial): THREE.ShaderMaterial {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return mat;
}

export function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}
