// Character material: MeshStandardMaterial extended with per-vertex surface parameters, a small
// generated detail texture, HDR glow trim, hit flash, status tints, dissolve and stealth shimmer.
// One shader program per variant is shared by every fighter; uniforms are per character.

import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector4, type IUniform } from 'three';
import type { QualityLevel } from '../../settings';

let detailTex: DataTexture | null = null;

const hash = (x: number, y: number, s: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
/** Tileable value noise: (x, y) in 0..1, px/py = period in cells. */
const pnoise = (x: number, y: number, px: number, py: number, seed: number): number => {
  const fx = x * px, fy = y * py;
  const xi = Math.floor(fx), yi = Math.floor(fy);
  const xf = fx - xi, yf = fy - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a: number, p: number): number => ((a % p) + p) % p;
  const a = hash(w(xi, px), w(yi, py), seed), b = hash(w(xi + 1, px), w(yi, py), seed);
  const c = hash(w(xi, px), w(yi + 1, py), seed), d = hash(w(xi + 1, px), w(yi + 1, py), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

/** R: woven cloth · G: leather / skin grain · B: brushed, pitted metal · A: fur / straw / wood strands */
export function getDetailTexture(): DataTexture {
  if (detailTex) return detailTex;
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      // weave: alternating over/under threads
      const tx = u * 16, ty = v * 16;
      const cx = Math.floor(tx), cy = Math.floor(ty);
      const fx = tx - cx, fy = ty - cy;
      const over = (cx + cy) % 2 === 0;
      const thread = over ? Math.sin(fx * Math.PI) * (0.75 + 0.25 * Math.sin(fy * Math.PI)) : Math.sin(fy * Math.PI) * (0.75 + 0.25 * Math.sin(fx * Math.PI));
      const weave = 0.25 + 0.6 * Math.pow(thread, 0.7) + (pnoise(u, v, 32, 32, 5) - 0.5) * 0.3;
      // grain: blotchy fbm + pores
      let g = 0, amp = 0.5, p = 6;
      for (let o = 0; o < 4; o++) { g += amp * pnoise(u, v, p, p, 11 + o); amp *= 0.5; p *= 2; }
      g = g / 0.9375;
      const pore = Math.pow(pnoise(u, v, 48, 48, 31), 3) * 0.35;
      const grain = Math.min(1, Math.max(0, 0.5 + (g - 0.5) * 1.5 - pore));
      // metal: fine streaks along u + sparse scratches and pits
      const streak = pnoise(u, v, 4, 64, 41) * 0.55 + pnoise(u, v, 8, 128, 43) * 0.25;
      const scratch = Math.pow(pnoise(u, v, 3, 40, 47), 6) * 1.6;
      const pit = Math.pow(pnoise(u, v, 24, 24, 53), 5) * 1.2;
      const metal = Math.min(1, Math.max(0, 0.3 + streak + scratch - pit));
      // strands along v
      const st = pnoise(u, v, 40, 3, 61) * 0.6 + pnoise(u, v, 80, 6, 67) * 0.3 + pnoise(u, v, 16, 2, 71) * 0.25;
      const strand = Math.min(1, Math.max(0, (st - 0.28) * 1.7));
      const k = (y * N + x) * 4;
      data[k] = Math.min(255, Math.max(0, weave * 255));
      data[k + 1] = grain * 255;
      data[k + 2] = metal * 255;
      data[k + 3] = strand * 255;
    }
  }
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  detailTex = t;
  return t;
}

export interface CharUniforms {
  uDetail: IUniform<DataTexture>;
  uGlowAmt: IUniform<number>;
  uFlash: IUniform<number>;
  uFlashCol: IUniform<Color>;
  /** rgb tint + amount */
  uTint: IUniform<Vector4>;
  uFrozen: IUniform<number>;
  uShimmer: IUniform<number>;
  uDissolve: IUniform<number>;
  uEdgeCol: IUniform<Color>;
  uTime: IUniform<number>;
  uFade: IUniform<number>;
  [k: string]: IUniform;
}

export function makeUniforms(): CharUniforms {
  return {
    uDetail: { value: getDetailTexture() },
    uGlowAmt: { value: 2.6 },
    uFlash: { value: 0 },
    uFlashCol: { value: new Color(1, 0.96, 0.88) },
    uTint: { value: new Vector4(1, 1, 1, 0) },
    uFrozen: { value: 0 },
    uShimmer: { value: 0 },
    uDissolve: { value: 0 },
    uEdgeCol: { value: new Color(1, 0.6, 0.2) },
    uTime: { value: 0 },
    uFade: { value: 1 },
  };
}

const VERT_PARS = /* glsl */`
attribute vec4 aMat;
varying vec4 vMat;
varying vec3 vRest;
varying vec2 vDUv;
`;
const VERT_MAIN = /* glsl */`
vMat = aMat;
vRest = position;
vDUv = uv;
`;

const FRAG_PARS = /* glsl */`
uniform sampler2D uDetail;
uniform float uGlowAmt;
uniform float uFlash;
uniform vec3 uFlashCol;
uniform vec4 uTint;
uniform float uFrozen;
uniform float uShimmer;
uniform float uDissolve;
uniform vec3 uEdgeCol;
uniform float uTime;
uniform float uFade;
varying vec4 vMat;
varying vec3 vRest;
varying vec2 vDUv;

float vhHeight( vec4 t, float k ) {
  if ( k < 0.5 ) return mix( 0.5, t.g, 0.4 );
  if ( k < 1.5 ) return t.r;
  if ( k < 2.5 ) return t.g;
  if ( k < 3.5 ) return t.b;
  if ( k < 5.5 ) return t.a;
  if ( k < 6.5 ) return 0.5;
  return t.g * 0.6 + t.b * 0.4;
}
float vhStrength( float k ) {
  if ( k < 0.5 ) return 0.22;
  if ( k < 1.5 ) return 0.5;
  if ( k < 2.5 ) return 0.5;
  if ( k < 3.5 ) return 0.42;
  if ( k < 4.5 ) return 0.85;
  if ( k < 5.5 ) return 0.5;
  if ( k < 6.5 ) return 0.0;
  return 0.6;
}
#ifdef VH_BUMP
vec3 vhPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
  vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
  vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
  vec3 vN = surf_norm;
  vec3 R1 = cross( vSigmaY, vN );
  vec3 R2 = cross( vN, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDir;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}
#endif
`;

const FRAG_DISSOLVE = /* glsl */`
vec4 vhTex = texture2D( uDetail, vDUv );
float vhKind = vMat.w;
float vhH = vhHeight( vhTex, vhKind );
float vhEdge = 0.0;
if ( uDissolve > 0.001 ) {
  float dn = texture2D( uDetail, vRest.xy * 0.9 + vRest.zz * 0.6 ).g * 0.65 + texture2D( uDetail, vRest.zy * 2.3 + 0.37 ).g * 0.35;
  float th = uDissolve * 1.25 - 0.12 + ( 1.0 - clamp( vRest.y / 1.9, 0.0, 1.0 ) ) * 0.0;
  if ( dn < th ) discard;
  vhEdge = 1.0 - smoothstep( 0.0, 0.07, dn - th );
}
`;

const FRAG_COLOR = /* glsl */`
{
  float amt = vhStrength( vhKind );
  diffuseColor.rgb *= 1.0 + ( vhH - 0.5 ) * amt;
  float lum = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uTint.rgb * ( 0.25 + lum * 1.5 ), uTint.a );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.78, 0.95 ) * ( 0.45 + lum * 1.3 ), uFrozen * 0.78 );
}
`;

const FRAG_ROUGH = /* glsl */`
roughnessFactor = clamp( vMat.x + ( 0.5 - vhH ) * 0.25 * vhStrength( vhKind ), 0.05, 1.0 );
roughnessFactor = mix( roughnessFactor, 0.16, uFrozen * 0.85 );
`;
const FRAG_METAL = /* glsl */`
metalnessFactor = vMat.y * 0.82 * ( 1.0 - uFrozen * 0.7 );
`;

const FRAG_NORMAL = /* glsl */`
#ifdef VH_BUMP
{
  float k = vhStrength( vhKind );
  if ( k > 0.01 ) {
    vec2 dSTdx = dFdx( vDUv ), dSTdy = dFdy( vDUv );
    float hx = vhHeight( texture2D( uDetail, vDUv + dSTdx ), vhKind ) - vhH;
    float hy = vhHeight( texture2D( uDetail, vDUv + dSTdy ), vhKind ) - vhH;
    normal = vhPerturb( - vViewPosition, normal, vec2( hx, hy ) * k * 0.035, faceDirection );
  }
}
#endif
`;

const FRAG_EMISSIVE = /* glsl */`
{
  float g = vMat.z;
  if ( g > 0.001 ) {
    float pulse = 0.86 + 0.14 * sin( uTime * 2.6 + vRest.y * 4.0 + vRest.x * 3.0 );
    totalEmissiveRadiance += vColor.rgb * g * uGlowAmt * pulse * ( 1.0 - uFrozen * 0.6 );
  }
}
`;

const FRAG_FINAL = /* glsl */`
{
  vec3 V = normalize( vViewPosition );
  float ndv = saturate( dot( normal, V ) );
  float fres = pow( 1.0 - ndv, 3.5 );
  float albL = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
  vec3 nW = inverseTransformDirection( normal, viewMatrix );
  // cheap sky reflection so metal reads without an environment map
  vec3 rW = inverseTransformDirection( reflect( - V, normal ), viewMatrix );
  vec3 sky = mix( vec3( 0.05, 0.065, 0.1 ), vec3( 0.2, 0.34, 0.5 ), smoothstep( -0.25, 0.7, rW.y ) ) + vec3( 0.55, 0.3, 0.14 ) * exp( - abs( rW.y - 0.04 ) * 5.0 );
  vec3 spec = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
  float gloss = 1.0 - roughnessFactor;
  outgoingLight += sky * spec * gloss * gloss * ( 0.5 + 1.6 * metalnessFactor + 1.2 * uFrozen );
  // stylised rim: cool from above, warm from the horizon
  vec3 rimCol = mix( vec3( 0.42, 0.26, 0.14 ), vec3( 0.2, 0.34, 0.52 ), smoothstep( -0.2, 0.55, nW.y ) );
  outgoingLight += rimCol * fres * ( 0.12 + 1.1 * albL ) * ( 0.35 + 0.65 * ( 1.0 - metalnessFactor ) );
  outgoingLight += vec3( 0.45, 0.8, 1.0 ) * fres * uFrozen * 0.9;
  outgoingLight += vec3( 1.0, 0.92, 0.7 ) * uShimmer * ( fres * 1.5 + 0.1 ) * ( 0.6 + 0.4 * sin( uTime * 9.0 - vRest.y * 8.0 ) );
  outgoingLight += uFlashCol * uFlash * ( 0.7 + 2.6 * fres );
  outgoingLight += uEdgeCol * vhEdge * 5.0;
  #ifdef VH_FADE
  {
    float low = 1.0 - smoothstep( 0.08, 0.45, uFade );
    float band = 0.55 + 0.45 * sin( vRest.y * 26.0 + uTime * 4.5 + vhTex.g * 7.0 + vRest.x * 9.0 );
    float shim = fres * band;
    diffuseColor.a = mix( uFade, uFade * 0.2 + shim * ( 0.22 + uFade * 1.6 ), low );
    outgoingLight = mix( outgoingLight, vec3( 0.55, 0.75, 1.0 ) * ( 0.5 + shim * 1.4 ) + outgoingLight * 0.25, low * 0.85 );
  }
  #endif
}
`;

export interface CharMaterial extends MeshStandardMaterial { userData: { u: CharUniforms } }

/**
 * `fade` = the transparent variant used for stealth (uFade < 1).
 * The two variants of one character share a uniforms object.
 */
export function makeCharMaterial(quality: QualityLevel, uniforms: CharUniforms, fade: boolean): CharMaterial {
  const bump = quality === 'high' || quality === 'ultra';
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 }) as CharMaterial;
  m.userData.u = uniforms;
  if (fade) { m.transparent = true; m.depthWrite = true; }
  const key = 'vhchar' + (bump ? 'B' : '') + (fade ? 'F' : '');
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const defs = (bump ? '#define VH_BUMP\n' : '') + (fade ? '#define VH_FADE\n' : '');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_PARS + '#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = defs + shader.fragmentShader
      .replace('#include <common>', FRAG_PARS + '#include <common>')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_DISSOLVE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_METAL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE)
      .replace('#include <opaque_fragment>', FRAG_FINAL + '#include <opaque_fragment>');
  };
  return m;
}
