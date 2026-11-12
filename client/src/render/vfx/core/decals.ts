// Ground decals: telegraphs, rune circles, zone rings, scorch / frost marks, shock rings.
//
// Every decal is a 9x9 grid draped over the real ground (heights sampled from the World at
// spawn), all living in ONE shared mesh. Animation is closed-form in the shader (age, fuse,
// fade), so a decal costs nothing per frame after it is written.

import * as THREE from 'three';
import type { World, GroundHit } from '@shared/world';
import { VOID } from '@shared/world';
import { FOG_V, FOG_V_PARS, FRAG_END, FRAG_PARS, NOISE, fogUniforms, premult } from './glsl';
import { rnd } from './rand';

/** Decal looks. */
export const enum DS {
  TELEGRAPH = 0, RING = 1, SCORCH = 2, FROST = 3, RUNE = 4, SHOCK = 5, FIRE = 6, SHADOW = 7,
  CRACKS = 8, ICE = 9, GLOW = 10, RIPPLE = 11, SECTOR = 12, STRIP = 13,
}

const G = 9, VERTS = G * G, STRIDE = 24;

export class DecalSpec {
  style: DS = DS.RING;
  x = 0; y = 0; z = 0;
  /** Exact gameplay radius in metres (uv radius 1). */
  radius = 1;
  /** Quad half-size in radius units along local x / z (room for the fringe). */
  extX = 1.2; extZ = 1.2;
  /** Local +x axis = (cos rot, sin rot) in world (x, z) – the collider yaw convention. */
  rot = 0;
  /** Total life in seconds (the fade-out happens inside it). */
  life = 1;
  /** Style timing parameter (fuse / expansion time / arm time). */
  fuse = 1;
  fadeIn = 0.08; fadeOut = 0.4;
  p1 = 0; p2 = 0;
  r0 = 1; g0 = 1; b0 = 1; a0 = 1;
  r1 = 1; g1 = 1; b1 = 1; a1 = 1;
  /** Extra height above the ground (stacking order). */
  lift = 0;
  /** Pre-age (seconds already elapsed when the decal is created). */
  age = 0;
  c0(c: THREE.Color, m = 1, a = 1): this { this.r0 = c.r * m; this.g0 = c.g * m; this.b0 = c.b * m; this.a0 = a; return this; }
  c1(c: THREE.Color, m = 1, a = 1): this { this.r1 = c.r * m; this.g1 = c.g * m; this.b1 = c.b * m; this.a1 = a; return this; }
}

const VERT = /* glsl */ `
${FOG_V_PARS}
uniform float uTime;
attribute vec4 aUv; attribute vec4 aT; attribute vec4 aP; attribute vec4 aC0; attribute vec4 aC1;
varying vec4 vUv; varying vec4 vT; varying vec4 vP; varying vec4 vC0; varying vec4 vC1;
void main(){
  float age = uTime - aT.x;
  if (age < 0.0 || uTime >= aT.y){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float fade = clamp(age / max(aP.w, 1e-4), 0.0, 1.0) * clamp((aT.y - uTime) / max(aT.w, 1e-4), 0.0, 1.0);
  vUv = aUv; vT = vec4(age, aT.z, fade, aP.x); vP = vec4(aP.y, aP.z, aT.y - aT.x, 0.0);
  vC0 = aC0; vC1 = aC1;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_V}
}`;

const FRAG = /* glsl */ `
${FRAG_PARS}
${NOISE}
uniform float uTime;
uniform sampler2D uBand; uniform sampler2D uGlyph;
varying vec4 vUv; varying vec4 vT; varying vec4 vP; varying vec4 vC0; varying vec4 vC1;
#define TAU 6.2831853
float lineAt(float x, float c, float hw, float aa){ return 1.0 - smoothstep(hw, hw + aa, abs(x - c)); }
vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
float glyph(vec2 q, float idx, out float glow){
  // q in [-1,1]^2 -> glyph cell
  if (abs(q.x) > 1.0 || abs(q.y) > 1.0){ glow = 0.0; return 0.0; }
  vec2 cell = vec2(mod(idx, 4.0), floor(idx / 4.0));
  vec4 t = texture2D(uGlyph, (cell + q * 0.5 + 0.5) / 4.0);
  glow = t.g; return t.r;
}
float runeBand(float r, float ang, float r0, float r1, float reps, float spin, out float glow){
  float v = (r - r0) / (r1 - r0);
  if (v < 0.0 || v > 1.0){ glow = 0.0; return 0.0; }
  vec4 t = texture2D(uBand, vec2(ang / TAU * reps + spin, v));
  glow = t.g; return t.r;
}
void main(){
  vec2 p = vUv.xy; float R = vUv.z, seed = vUv.w;
  float age = vT.x, fuse = max(vT.y, 1e-4), fade = vT.z, style = vT.w;
  float p1 = vP.x, p2 = vP.y, life = vP.z;
  float r = length(p), ang = atan(p.y, p.x);
  float aa = fwidth(r) * 1.2 + 1e-4;
  vec3 c0 = vC0.rgb, c1 = vC1.rgb;
  vec3 rgb = vec3(0.0); float alpha = 0.0;

  if (style < 0.5){
    // ---------------------------------------------------------------- TELEGRAPH (delayed strike)
    float prog = clamp(age / fuse, 0.0, 1.0);
    float lw = clamp(0.085 / R, 0.012, 0.06);
    float inside = 1.0 - smoothstep(1.0 - aa, 1.0, r);
    float ring = lineAt(r, 1.0 - lw, lw, aa);
    float outline = lineAt(r, 1.0 + lw * 1.6, lw * 1.6, aa * 2.0);
    float fill = 1.0 - smoothstep(prog - aa * 2.0, prog, r);
    float n = vFbm(p * 2.6 + seed * 9.0 + vec2(0.0, -uTime * 0.6));
    float front = lineAt(r, prog - lw * 0.9, lw * 0.9, aa) * step(0.02, prog) * step(prog, 0.995);
    float g1; float runes = runeBand(r, ang, 0.74, 0.93, 3.0, uTime * 0.045 + seed, g1);
    float spokes = smoothstep(0.92, 1.0, cos(ang * 12.0 + seed)) * smoothstep(0.3, 0.72, r) * inside * 0.35;
    float pulse = 0.72 + 0.28 * sin(age * (9.0 + 34.0 * prog * prog));
    float urgency = 0.55 + 0.9 * prog * prog;
    float under = inside * (0.34 + 0.2 * smoothstep(0.4, 1.0, r));
    vec3 lineC = mix(c0, c1, 0.35);
    rgb = c0 * fill * inside * (0.16 + 0.3 * n) * (0.6 + 0.6 * prog)
        + lineC * (ring * 1.5 * pulse + front * 1.1)
        + c0 * (runes * 0.8 + g1 * 0.12 + spokes * 0.6) * urgency
        + c1 * pow(prog, 6.0) * inside * 0.25;
    alpha = max(max(under, outline * 0.7), ring * 0.9);
    rgb *= vC0.a;
  } else if (style < 1.5){
    // ---------------------------------------------------------------- RING (zone radius)
    float lw = clamp(0.06 / R, 0.008, 0.06);
    float dash = p1 > 0.5 ? smoothstep(0.0, 0.25, abs(fract(ang / TAU * p1 + uTime * 0.03 + seed) - 0.5) - 0.12) : 1.0;
    float ring = lineAt(r, 1.0 - lw, lw, aa) * dash;
    float outline = lineAt(r, 1.0 + lw * 1.5, lw * 1.5, aa * 2.0) * dash;
    float inside = 1.0 - smoothstep(1.0 - aa, 1.0, r);
    float inner = inside * pow(r, 3.0);
    rgb = mix(c0, c1, 0.4) * ring * 1.4 + c0 * inner * p2;
    alpha = max(outline * 0.55, ring * 0.6);
    rgb *= vC0.a; alpha *= vC0.a;
  } else if (style < 2.5){
    // ---------------------------------------------------------------- SCORCH
    float n = vFbm(p * 2.2 + seed * 13.0);
    float body = 1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.6);
    vec2 cl = vCell(p * 4.5 * max(1.0, R * 0.8) + seed * 7.0 + (n - 0.5) * 1.5);
    float crack = smoothstep(0.06, 0.0, cl.y - cl.x) * body * smoothstep(0.35, 0.7, vNoise(p * 3.0 + seed * 3.0));
    float heat = pow(max(0.0, 1.0 - age / max(p1, 1e-3)), 2.0);
    float streaks = smoothstep(0.55, 0.95, vNoise(vec2(ang * 5.0 + seed, r * 2.0))) * smoothstep(1.15, 0.6, r) * smoothstep(0.3, 0.8, r);
    alpha = clamp(body * 0.82 + streaks * 0.35, 0.0, 0.88) * vC0.a;
    rgb = vec3(0.012, 0.01, 0.01) * alpha + c0 * crack * heat * (0.4 + 0.5 * n) + c0 * heat * body * body * 0.12 * n;
  } else if (style < 3.5){
    // ---------------------------------------------------------------- FROST
    float n = vFbm(p * 2.4 + seed * 5.0);
    float body = 1.0 - smoothstep(0.45, 1.0, r + (n - 0.5) * 0.5);
    vec2 cl = vCell(p * 4.0 * max(1.0, R * 0.45) + seed * 3.0);
    float vein = smoothstep(0.09, 0.0, cl.y - cl.x);
    float rays = smoothstep(0.75, 1.0, vNoise(vec2(ang * 9.0 + seed * 4.0, r * 1.5))) * smoothstep(1.1, 0.55, r) * smoothstep(0.2, 0.7, r);
    float sparkle = step(0.988, vHash(floor(p * R * 9.0) + floor(uTime * 5.0)));
    alpha = clamp(body * 0.5 + rays * 0.3, 0.0, 0.7) * vC0.a;
    rgb = (c0 * (0.3 + 0.3 * cl.x) + c1 * (vein * 0.55 + rays * 0.5 + sparkle * 2.5 * body)) * max(body, rays) * vC0.a;
  } else if (style < 4.5){
    // ---------------------------------------------------------------- RUNE CIRCLE
    float grow = p2 > 0.5 ? clamp(age / fuse, 0.0, 1.0) : 1.0;
    float draw = clamp(age / min(fuse, 0.25) , 0.0, 1.0);                // the circle "writes" itself
    float sweep = step(fract(ang / TAU + 0.5), draw);
    float lw = clamp(0.045 / R, 0.008, 0.05);
    float ringA = lineAt(r, 1.0 - lw, lw, aa);
    float ringB = lineAt(r, 0.7, lw * 0.8, aa);
    float ringC = lineAt(r, 0.42, lw * 0.7, aa);
    float g1; float runes = runeBand(r, ang, 0.74, 0.95, 3.0, uTime * 0.05 + seed, g1);
    // inscribed star: fold the angle into p1b segments
    vec2 q = rot2(p, -uTime * 0.25 - seed * 6.0);
    float qa = atan(q.y, q.x); float segs = 3.0;
    float fa = mod(qa, TAU / segs) - TAU / segs * 0.5;
    float star = lineAt(length(q) * cos(fa), 0.7 * cos(TAU / segs * 0.5), lw * 0.7, aa) * step(length(q), 0.7);
    vec2 q2 = rot2(p, uTime * 0.25 + seed * 6.0 + TAU / 6.0);
    float qa2 = atan(q2.y, q2.x);
    float fa2 = mod(qa2, TAU / segs) - TAU / segs * 0.5;
    star += lineAt(length(q2) * cos(fa2), 0.7 * cos(TAU / segs * 0.5), lw * 0.7, aa) * step(length(q2), 0.7);
    float gg = 0.0; float gl = p1 >= 0.0 ? glyph(p / 0.36 * vec2(1.0, -1.0), p1, gg) : 0.0;
    float inside = 1.0 - smoothstep(0.9, 1.0, r);
    float bright = (0.45 + 0.9 * grow) * (0.85 + 0.15 * sin(uTime * 7.0 + seed * 20.0));
    float lines = (ringA + ringB * 0.8 + ringC * 0.5 + star * 0.55 + runes * 1.2) * sweep;
    rgb = (mix(c0, c1, 0.3) * lines * 1.0 + c0 * (g1 * 0.15 * sweep + inside * (0.06 + 0.14 * grow * (1.0 - r))) + mix(c0, c1, 0.5) * (gl * 1.3 + gg * 0.25) * grow) * bright * vC0.a;
    alpha = clamp(inside * 0.28 + lines * 0.3, 0.0, 0.6) * vC0.a * vC1.a;
  } else if (style < 5.5){
    // ---------------------------------------------------------------- SHOCK (expanding ring)
    float k = clamp(age / fuse, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - k, 2.4);
    float lw = max(p1, 0.02) * (1.0 - 0.72 * e);
    float jag = p2 > 0.5 ? (vNoise(vec2(ang * 7.0 + seed * 9.0, uTime * 22.0)) - 0.5) * 0.08 * p2 : 0.0;
    float rr = r + jag;
    float front = lineAt(rr, e - lw, lw, aa * 1.5);
    float wake = smoothstep(e - lw * 9.0, e, rr) * (1.0 - smoothstep(e - aa, e, rr));
    float lingering = lineAt(r, 1.0 - 0.012, 0.012, aa) * step(0.999, k);
    float f = pow(1.0 - k, 0.8);
    float after = clamp(1.0 - (age - fuse) / max(life - fuse, 1e-3), 0.0, 1.0);
    float arrive = step(0.999, k) * after * after;
    float frontI = k < 0.999 ? (0.3 + 0.7 * f) : 0.3 * arrive;
    rgb = (mix(c0, c1, 0.5) * front * 1.5 * frontI + c0 * wake * 0.4 * f + c0 * lingering * 0.6 * after) * vC0.a;
    alpha = clamp(front * 0.5 * frontI + wake * 0.22 * f, 0.0, 0.7) * vC0.a * vC1.a;
  } else if (style < 6.5){
    // ---------------------------------------------------------------- FIRE (burning ground)
    float lw = clamp(0.07 / R, 0.01, 0.06);
    float inside = 1.0 - smoothstep(1.0 - aa * 2.0, 1.0, r);
    vec2 fl = p * 2.0 * max(1.0, R * 0.6);
    float n = vFbm(fl + vec2(seed * 7.0, -uTime * 0.9));
    float n2 = vFbm(fl * 2.1 - vec2(uTime * 0.7, seed * 3.0));
    float flow = smoothstep(0.35, 0.9, n * 0.6 + n2 * 0.6 + r * 0.15);
    float rim = lineAt(r, 1.0 - lw, lw, aa) * (0.75 + 0.25 * sin(ang * 23.0 + uTime * 9.0));
    float emberEdge = smoothstep(0.55, 1.0, r) * inside;
    alpha = clamp(inside * 0.62 + lineAt(r, 1.0 + lw, lw * 1.4, aa * 2.0) * 0.5, 0.0, 0.8) * vC0.a;
    rgb = vec3(0.02, 0.008, 0.004) * alpha
        + (c0 * flow * inside * (0.4 + 0.6 * emberEdge) + c1 * pow(flow, 3.0) * inside * 0.4 + mix(c0, c1, 0.3) * rim * 0.9 * (0.6 + 0.4 * vNoise(vec2(ang * 9.0, uTime * 3.0)))) * vC0.a;
  } else if (style < 7.5){
    // ---------------------------------------------------------------- SHADOW (snare pool)
    float arm = clamp(age / fuse, 0.0, 1.0);
    float rad = mix(0.25, 1.0, 1.0 - pow(1.0 - arm, 2.0));
    float rn = r / rad;
    float lw = clamp(0.07 / R, 0.01, 0.06);
    float swirl = vFbm(vec2(ang * 1.6 + rn * 4.5 - uTime * 0.9 + seed * 5.0, rn * 3.0 + uTime * 0.35));
    float swirl2 = vFbm(vec2(ang * 3.0 - rn * 6.0 + uTime * 0.6, rn * 5.0 - uTime * 0.5 + seed));
    float inside = 1.0 - smoothstep(1.0 - aa * 2.0, 1.0, rn);
    float edgeN = 1.0 - smoothstep(0.82, 1.0, rn + (swirl - 0.5) * 0.12);
    float rim = lineAt(rn, 1.0 - lw, lw, aa) ;
    float veins = smoothstep(0.62, 0.9, swirl2) * inside * smoothstep(0.1, 0.8, rn);
    float armed = step(1.0, arm);
    alpha = clamp(inside * (0.72 + 0.2 * swirl) * max(edgeN, 0.75) + lineAt(rn, 1.0 + lw, lw * 1.5, aa * 2.0) * 0.5, 0.0, 0.93) * vC0.a;
    rgb = vec3(0.01, 0.004, 0.02) * alpha
        + (c0 * veins * (0.35 + 0.35 * armed) + mix(c0, c1, 0.3) * rim * (0.6 + 0.9 * armed) * (0.8 + 0.2 * sin(uTime * 5.0 + ang * 3.0))
        + c0 * inside * pow(rn, 4.0) * 0.35) * vC0.a;
  } else if (style < 8.5){
    // ---------------------------------------------------------------- CRACKS
    float reach = clamp(age / fuse, 0.0, 1.0);
    float n = vFbm(p * 2.0 + seed * 11.0);
    vec2 cl = vCell(vec2(ang * (2.2 + p2), r * 2.6 * max(1.0, R * 0.3)) + seed * 3.0);
    float radial = smoothstep(0.045, 0.0, cl.y - cl.x);
    vec2 cl2 = vCell(p * 2.2 * max(1.0, R * 0.4) + seed);
    float webs = smoothstep(0.035, 0.0, cl2.y - cl2.x) * smoothstep(0.3, 0.6, n);
    float mask = (1.0 - smoothstep(reach * 0.8, reach * 1.02 + 0.02, r + (n - 0.5) * 0.25)) * smoothstep(0.02, 0.12, r + 0.05);
    float crack = clamp(radial * (1.0 - r * 0.35) + webs * 0.6 * (1.0 - r), 0.0, 1.0) * mask;
    float heat = pow(max(0.0, 1.0 - age / max(p1, 1e-3)), 1.5);
    float centre = (1.0 - smoothstep(0.0, 0.4, r)) * 0.5;
    alpha = clamp(crack * 0.8 + centre * mask, 0.0, 0.9) * vC0.a;
    rgb = vec3(0.012, 0.01, 0.009) * alpha + c0 * crack * heat * 0.45 * (1.0 - r * 0.5) * vC0.a;
  } else if (style < 9.5){
    // ---------------------------------------------------------------- ICE (slippery patch)
    float lw = clamp(0.05 / R, 0.01, 0.06);
    float n = vFbm(p * 3.0 + seed * 5.0);
    float edge = r + (n - 0.5) * 0.14;
    float body = 1.0 - smoothstep(0.93, 1.0, edge);
    vec2 cl = vCell(p * 3.0 * max(1.0, R * 0.7) + seed * 9.0);
    float crack = smoothstep(0.06, 0.0, cl.y - cl.x);
    float rim = smoothstep(0.72, 0.97, edge) * body;
    float gloss = smoothstep(0.55, 0.9, vNoise(p * 1.6 + seed + vec2(uTime * 0.05, 0.0)));
    float sparkle = step(0.99, vHash(floor(p * R * 10.0) + floor(uTime * 4.0)));
    alpha = body * (0.5 + 0.2 * rim) * vC0.a;
    rgb = (c0 * (0.2 + 0.18 * gloss) + c1 * (crack * 0.35 + rim * 0.3 + sparkle * 2.2)) * body * vC0.a;
  } else if (style < 10.5){
    // ---------------------------------------------------------------- GLOW (light pool)
    float g = exp(-r * r * 3.2) * (1.0 - smoothstep(0.9, 1.2, r));
    rgb = c0 * g * vC0.a; alpha = 0.0;
  } else if (style < 11.5){
    // ---------------------------------------------------------------- RIPPLE (water)
    float k = clamp(age / fuse, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - k, 2.0);
    float n = vFbm(p * 2.5 + seed * 3.0);
    float wet = (1.0 - smoothstep(e * 0.85, e * 1.02 + 0.02, r + (n - 0.5) * 0.3));
    float rings = 0.0;
    for (int i = 0; i < 3; i++){ float rr = e * (1.0 - float(i) * 0.3); rings += lineAt(r, rr, 0.035, aa * 1.5) * (1.0 - float(i) * 0.3); }
    float foam = smoothstep(0.6, 0.85, vNoise(p * 7.0 + vec2(uTime * 0.6, seed))) * wet * (1.0 - k) * 0.6;
    alpha = wet * 0.38 * vC0.a;
    rgb = (c0 * wet * 0.12 + c1 * (rings * (1.0 - k) * 0.1 + foam * 0.4)) * vC0.a;
  } else if (style < 12.5){
    // ---------------------------------------------------------------- SECTOR (cone on the ground)
    float k = clamp(age / fuse, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - k, 2.0);
    float n = vFbm(vec2(ang * 3.0 + seed * 4.0, r * 3.0 - uTime * 2.0));
    float angMask = 1.0 - smoothstep(p1 - 0.05, p1 + 0.03, abs(ang) + (n - 0.5) * 0.08);
    float inside = angMask * (1.0 - smoothstep(1.0 - aa * 2.0, 1.0, r)) * smoothstep(0.03, 0.14, r);
    float swept = 1.0 - smoothstep(e - 0.02, e + 0.02, r);
    float front = lineAt(r, e, 0.05, aa * 2.0) * (1.0 - k);
    float heat = pow(max(0.0, 1.0 - (age - fuse) / 0.7), 2.0);
    vec2 cl = vCell(p * R * 1.6 + seed * 3.0 + (n - 0.5));
    float crack = smoothstep(0.07, 0.0, cl.y - cl.x) * smoothstep(0.3, 0.7, vNoise(p * R * 0.8 + seed));
    float n3 = vFbm(p * R * 0.9 + seed * 5.0);
    float edgeLine = (lineAt(r, 1.0 - 0.012, 0.012, aa) * angMask + lineAt(abs(ang), p1, 0.012, 0.01) * step(r, 1.0) * smoothstep(0.03, 0.14, r)) * swept;
    alpha = inside * swept * smoothstep(0.25, 0.75, n3 + 0.2) * smoothstep(1.0, 0.8, r + (n3 - 0.5) * 0.3) * 0.45 * vC0.a;
    rgb = vec3(0.012, 0.008, 0.006) * alpha
        + (c0 * inside * swept * heat * (0.12 + 0.7 * crack + 0.3 * n) + mix(c0, c1, 0.4) * (front * inside * 1.4 + edgeLine * heat * 1.0)) * vC0.a;
  } else {
    // ---------------------------------------------------------------- STRIP (line eruption / wall base)
    // local x runs along the strip (-1..1), p1 = half width in radius units, front = age / fuse
    float k = clamp(age / fuse, 0.0, 1.0);
    float along = p.x * 0.5 + 0.5;
    float n = vFbm(p * vec2(6.0, 6.0) * max(1.0, R * 0.3) + seed * 7.0);
    float w = abs(p.y) / max(p1, 1e-3);
    float body = (1.0 - smoothstep(0.75, 1.05, w + (n - 0.5) * 0.35)) * step(abs(p.x), 1.0) * (1.0 - smoothstep(k - 0.02, k + 0.01, along));
    float ends = smoothstep(0.0, 0.03, along) * smoothstep(1.0, 0.97, along);
    vec2 cl = vCell(p * vec2(1.0, 1.0) * R * 1.4 + seed * 5.0);
    float crack = smoothstep(0.04, 0.0, cl.y - cl.x);
    float edge = lineAt(w, 1.0, 0.06, 0.05) * step(abs(p.x), 1.0) * (1.0 - smoothstep(k - 0.02, k + 0.01, along));
    float front = lineAt(along, k, 0.012, 0.01) * step(w, 1.0) * step(k, 0.995);
    float sparkle = step(0.99, vHash(floor(p * R * 8.0) + floor(uTime * 5.0)));
    alpha = body * ends * mix(0.5, 0.78, p2) * vC0.a;
    rgb = p2 > 0.5
        ? vec3(0.012, 0.01, 0.009) * alpha + (c0 * crack * body * 0.3 + c1 * front * 1.0) * vC0.a
        : (c0 * body * ends * (0.2 + 0.2 * cl.x) + c1 * (crack * body * 0.3 + edge * 0.22 + front * 1.2 + sparkle * body * 1.2)) * vC0.a;
  }
  gl_FragColor = vfxFogged(rgb * fade * 0.8, alpha * fade);
  ${FRAG_END}
}`;

export class Decals {
  readonly spec = new DecalSpec();
  private readonly data: Float32Array;
  private readonly buf: THREE.InterleavedBuffer;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  private readonly end: Float32Array;
  private readonly gen: Uint16Array;
  private readonly meta: Float32Array; // per slot: radius, extX, extZ, rot, lift
  private readonly heights = new Float32Array(VERTS);
  private readonly hit: GroundHit = { y: 0, surf: 'grass', collider: null };
  private cursor = 0;
  private now = 0;
  private maxEnd = 0;
  private dMin = -1; private dMax = -1;
  private readonly range = { start: 0, count: 0 };
  readonly count: number;

  constructor(private scene: THREE.Scene, private world: World, count: number, band: THREE.Texture, glyphs: THREE.Texture) {
    this.count = count;
    this.data = new Float32Array(count * VERTS * STRIDE);
    this.end = new Float32Array(count);
    this.gen = new Uint16Array(count);
    this.meta = new Float32Array(count * 5);
    this.buf = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    geo.setAttribute('aUv', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    geo.setAttribute('aT', new THREE.InterleavedBufferAttribute(this.buf, 4, 8));
    geo.setAttribute('aP', new THREE.InterleavedBufferAttribute(this.buf, 4, 12));
    geo.setAttribute('aC0', new THREE.InterleavedBufferAttribute(this.buf, 4, 16));
    geo.setAttribute('aC1', new THREE.InterleavedBufferAttribute(this.buf, 4, 20));
    const idx = new Uint16Array(count * (G - 1) * (G - 1) * 6);
    let k = 0;
    for (let s = 0; s < count; s++) for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) {
      const a = s * VERTS + j * G + i, b = a + 1, c = a + G, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    this.mat = premult(new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), uTime: { value: 0 }, uBand: { value: band }, uGlyph: { value: glyphs } },
      vertexShader: VERT, fragmentShader: FRAG, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Reset the scratch spec and return it; fill in more fields, then call commit(). */
  begin(style: DS, x: number, y: number, z: number, radius: number, life: number): DecalSpec {
    const d = this.spec;
    d.style = style; d.x = x; d.y = y; d.z = z; d.radius = radius; d.life = life;
    d.extX = 1.2; d.extZ = 1.2; d.rot = 0; d.fuse = life; d.fadeIn = 0.08; d.fadeOut = Math.min(0.4, life * 0.5);
    d.p1 = 0; d.p2 = 0; d.r0 = d.g0 = d.b0 = d.a0 = 1; d.r1 = d.g1 = d.b1 = d.a1 = 1; d.lift = 0; d.age = 0;
    return d;
  }

  /** Write the scratch spec into a free slot. Returns a handle (or -1 when full of live decals). */
  commit(): number {
    const d = this.spec, n = this.count;
    let slot = -1;
    for (let i = 0; i < n; i++) {
      const s = (this.cursor + i) % n;
      if (this.end[s] <= this.now) { slot = s; break; }
    }
    if (slot < 0) {
      // all busy: steal the one that ends soonest
      let best = Infinity;
      for (let i = 0; i < n; i++) if (this.end[i] < best) { best = this.end[i]; slot = i; }
    }
    this.cursor = (slot + 1) % n;
    this.gen[slot] = (this.gen[slot] + 1) & 0xffff;
    const birth = this.now - d.age, end = birth + d.life;
    this.end[slot] = end;
    if (end > this.maxEnd) this.maxEnd = end;
    const m = slot * 5;
    this.meta[m] = d.radius; this.meta[m + 1] = d.extX; this.meta[m + 2] = d.extZ; this.meta[m + 3] = d.rot; this.meta[m + 4] = d.lift;
    this.place(slot, d.x, d.y, d.z);
    const a = this.data, seed = rnd();
    let o = slot * VERTS * STRIDE;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      a[o + 4] = ((i / (G - 1)) * 2 - 1) * d.extX; a[o + 5] = ((j / (G - 1)) * 2 - 1) * d.extZ; a[o + 6] = d.radius; a[o + 7] = seed;
      a[o + 8] = birth; a[o + 9] = end; a[o + 10] = d.fuse; a[o + 11] = d.fadeOut;
      a[o + 12] = d.style; a[o + 13] = d.p1; a[o + 14] = d.p2; a[o + 15] = d.fadeIn;
      a[o + 16] = d.r0; a[o + 17] = d.g0; a[o + 18] = d.b0; a[o + 19] = d.a0;
      a[o + 20] = d.r1; a[o + 21] = d.g1; a[o + 22] = d.b1; a[o + 23] = d.a1;
      o += STRIDE;
    }
    this.dirty(slot);
    return this.gen[slot] * 1024 + slot;
  }

  private dirty(slot: number): void {
    if (this.dMin < 0 || slot < this.dMin) this.dMin = slot;
    if (slot > this.dMax) this.dMax = slot;
  }

  /** Upload the slots touched this frame (one contiguous range, no allocation). */
  flush(): void {
    if (this.dMin < 0) return;
    const r = this.buf.updateRanges;
    if (r.length > 0) r.length = 0; // an earlier range was never uploaded: send everything
    else { this.range.start = this.dMin * VERTS * STRIDE; this.range.count = (this.dMax - this.dMin + 1) * VERTS * STRIDE; r.push(this.range); }
    this.buf.needsUpdate = true;
    this.dMin = -1; this.dMax = -1;
  }

  private slotOf(handle: number): number {
    if (handle < 0) return -1;
    const slot = handle % 1024;
    return this.gen[slot] === Math.floor(handle / 1024) && this.end[slot] > this.now ? slot : -1;
  }

  /** Drape a slot's grid over the ground around (x, z). `y` is the reference height (feet level). */
  private place(slot: number, x: number, y: number, z: number): void {
    const m = slot * 5;
    const R = this.meta[m], ex = this.meta[m + 1] * R, ez = this.meta[m + 2] * R, rot = this.meta[m + 3];
    const lift = 0.05 + this.meta[m + 4];
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const big = Math.max(ex, ez);
    const ns = big < 1.7 ? 3 : big < 4.2 ? 5 : 9; // sample resolution
    const h = this.heights, step = (G - 1) / (ns - 1);
    for (let j = 0; j < ns; j++) for (let i = 0; i < ns; i++) {
      const lx = ((i / (ns - 1)) * 2 - 1) * ex, lz = ((j / (ns - 1)) * 2 - 1) * ez;
      const wx = x + lx * cs - lz * sn, wz = z + lx * sn + lz * cs;
      let gy = this.world.ground(wx, wz, y + 0.7, this.hit).y;
      if (gy <= VOID * 0.5 || gy < y - 6) gy = y; // over the abyss: hang flat at the reference height
      h[Math.round(j * step) * G + Math.round(i * step)] = gy;
    }
    if (ns < G) {
      const st = Math.round(step);
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        const i0 = Math.min(Math.floor(i / st) * st, G - 1 - st), j0 = Math.min(Math.floor(j / st) * st, G - 1 - st);
        if (i % st === 0 && j % st === 0) continue;
        const fx = (i - i0) / st, fz = (j - j0) / st;
        const a = h[j0 * G + i0], b = h[j0 * G + i0 + st], c = h[(j0 + st) * G + i0], d = h[(j0 + st) * G + i0 + st];
        h[j * G + i] = a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
      }
    }
    const a = this.data;
    let o = slot * VERTS * STRIDE;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const lx = ((i / (G - 1)) * 2 - 1) * ex, lz = ((j / (G - 1)) * 2 - 1) * ez;
      a[o] = x + lx * cs - lz * sn; a[o + 1] = h[j * G + i] + lift; a[o + 2] = z + lx * sn + lz * cs;
      o += STRIDE;
    }
  }

  /** Move a live decal (moving zones). Re-drapes it over the ground. */
  move(handle: number, x: number, y: number, z: number, rot?: number): void {
    const slot = this.slotOf(handle);
    if (slot < 0) return;
    if (rot !== undefined) this.meta[slot * 5 + 3] = rot;
    this.place(slot, x, y, z);
    this.dirty(slot);
  }

  /** End a decal early, fading over `fade` seconds. */
  release(handle: number, fade = 0.3): void {
    const slot = this.slotOf(handle);
    if (slot < 0) return;
    const end = this.now + fade;
    if (end >= this.end[slot]) return;
    this.end[slot] = end;
    const a = this.data;
    let o = slot * VERTS * STRIDE;
    for (let i = 0; i < VERTS; i++) { a[o + 9] = end; a[o + 11] = fade; o += STRIDE; }
    this.dirty(slot);
  }

  alive(handle: number): boolean { return this.slotOf(handle) >= 0; }

  update(now: number): void {
    this.now = now;
    this.mat.uniforms.uTime.value = now;
    this.mesh.visible = this.maxEnd > now;
  }

  liveCount(): number { let n = 0; for (let i = 0; i < this.count; i++) if (this.end[i] > this.now) n++; return n; }

  clear(): void {
    this.end.fill(0); this.maxEnd = 0; this.mesh.visible = false;
    for (let i = 9; i < this.data.length; i += STRIDE) this.data[i] = 0;
    this.dMin = -1; this.dMax = -1;
    this.buf.updateRanges.length = 0;
    this.buf.needsUpdate = true;
  }

  dispose(): void { this.scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
}
