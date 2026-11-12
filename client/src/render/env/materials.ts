// Environment materials. Everything that receives light is a MeshStandardMaterial /
// MeshLambertMaterial extended through onBeforeCompile, so the moon, its shadow, the hall's
// point lights, the image-based fill and scene fog all keep working; the extensions add
// world-space procedural detail (triplanar rock, masonry, wood grain, ice, snow cover) and a
// loop of analytic "warm lights" (braziers, glowing runes) that costs no real light.
import * as THREE from 'three';
import { MAX_WARM, type SharedUniforms } from './common';

export type SurfaceKind = 'stone' | 'wood' | 'ice' | 'foliage';

const PARS_VERT = /* glsl */`
attribute vec4 aSurf;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec4 vSurf;
varying vec2 vEnvUv;
uniform float uTime;
uniform vec4 uWind;
`;

const WORLD_VERT = /* glsl */`
{
  vec4 ewp = vec4( transformed, 1.0 );
  vec3 ewn = objectNormal;
  #ifdef USE_INSTANCING
    ewp = instanceMatrix * ewp;
    ewn = mat3( instanceMatrix ) * ewn;
  #endif
  ewp = modelMatrix * ewp;
  vWPos = ewp.xyz;
  vWNrm = normalize( mat3( modelMatrix ) * ewn );
  vSurf = aSurf;
  vEnvUv = uv;
}
`;

const WARM_PARS = /* glsl */`
#if NUM_WARM > 0
uniform vec4 uWarmPos[ NUM_WARM ];
uniform vec3 uWarmCol[ NUM_WARM ];
vec3 envWarm( vec3 wp, vec3 wn ) {
  vec3 sum = vec3( 0.0 );
  for ( int i = 0; i < NUM_WARM; i ++ ) {
    vec3 d = uWarmPos[ i ].xyz - wp;
    float r = uWarmPos[ i ].w;
    float d2 = dot( d, d );
    if ( d2 < r * r ) {
      float a = 1.0 - d2 / ( r * r );
      float ndl = clamp( dot( wn, d * inversesqrt( d2 + 0.02 ) ) * 0.65 + 0.35, 0.0, 1.0 );
      sum += uWarmCol[ i ] * ( a * a * ndl / ( 1.0 + d2 * 0.22 ) );
    }
  }
  return sum;
}
#endif
`;

const PARS_FRAG = /* glsl */`
uniform sampler2D uRockTex;
uniform sampler2D uDetailTex;
uniform float uTime;
uniform vec3 uMoonDir;
uniform float uSparkle;
uniform float uSnowfall;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec4 vSurf;
varying vec2 vEnvUv;
float envHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
${WARM_PARS}
`;

// --------------------------------------------------------------------------- surface bodies

const BODY_BEGIN = /* glsl */`
vec3 eP = vWPos;
vec3 eG = normalize( vWNrm );
#ifdef DOUBLE_SIDED
  eG *= faceDirection;
#endif
vec3 eN = eG;
vec3 eV = normalize( cameraPosition - eP );
vec3 eAlb = diffuseColor.rgb;
float eRough = 0.85;
float eSpec = 1.0;
vec3 eEmit = vec3( 0.0 );
const vec3 SNOW_ALB = vec3( 0.78, 0.84, 0.93 );
`;

const BODY_END = /* glsl */`
diffuseColor.rgb = eAlb;
#ifdef STANDARD
  roughnessFactor = eRough;
#endif
normal = normalize( ( viewMatrix * vec4( eN, 0.0 ) ).xyz );
#if NUM_WARM > 0
  totalEmissiveRadiance += eAlb * envWarm( eP, eN );
#endif
totalEmissiveRadiance += eEmit;
`;

const BODY_STONE = /* glsl */`
{
  float carved = vSurf.w;
  vec3 tw = pow( abs( eG ), vec3( 4.0 ) );
  tw /= ( tw.x + tw.y + tw.z );
  float sc = mix( 0.11, 0.2, carved );
  vec4 tx = texture2D( uRockTex, eP.zy * sc );
  vec4 ty = texture2D( uRockTex, eP.xz * sc );
  vec4 tz = texture2D( uRockTex, eP.xy * sc );
  vec4 t = tx * tw.x + ty * tw.y + tz * tw.z;
  vec2 bx = tx.rg * 2.0 - 1.0, by = ty.rg * 2.0 - 1.0, bz = tz.rg * 2.0 - 1.0;
  vec3 bump = vec3( 0.0, bx.y, bx.x ) * tw.x + vec3( by.x, 0.0, by.y ) * tw.y + vec3( bz.x, bz.y, 0.0 ) * tw.z;
  float macro = texture2D( uDetailTex, eP.xz * 0.021 + eP.y * 0.013 ).a;
  float strata = texture2D( uDetailTex, vec2( eP.y * 0.19 + macro * 0.5, dot( eP.xz, vec2( 0.017, 0.011 ) ) ) ).r;
  float tone = ( 0.42 + 1.0 * t.b ) * mix( 0.45, 1.0, t.a );
  tone *= mix( mix( 0.72, 1.22, strata ), 1.0, carved ) * ( 0.82 + 0.36 * macro );
  eAlb *= tone;
  // lichen-ish warm/cool drift so big faces are never one flat hue
  eAlb *= mix( vec3( 1.06, 1.0, 0.92 ), vec3( 0.92, 0.98, 1.1 ), macro );

  // dressed-stone courses (uv = metres along the wall / up, or local x/z on floors)
  float joint = 0.0;
  if ( vSurf.z > 0.001 ) {
    vec2 bs = vec2( vSurf.z * 1.9, vSurf.z );
    vec2 bu = vEnvUv / bs;
    float row = floor( bu.y );
    bu.x += mod( row, 2.0 ) * 0.5 + envHash( vec2( row, 1.7 ) ) * 0.23;
    vec2 f = fract( bu );
    vec2 e = min( f, 1.0 - f ) * bs;
    joint = 1.0 - smoothstep( 0.012, 0.05, min( e.x, e.y ) );
    float blk = envHash( floor( bu ) );
    eAlb *= ( 0.8 + 0.4 * blk ) * ( 1.0 - joint * 0.62 );
  }

  float mossN = texture2D( uDetailTex, eP.xz * 0.137 + eP.y * 0.093 ).r;
  float moss = vSurf.y * smoothstep( 0.46, 0.64, mossN * 0.72 + ( 1.0 - t.b ) * 0.22 + eG.y * 0.2 );
  eAlb = mix( eAlb, vec3( 0.062, 0.085, 0.030 ) * ( 0.55 + 0.9 * t.b ) * ( 1.0 - joint * 0.55 ), moss );
  eN = normalize( eG + bump * mix( 1.15, 0.7, carved ) * ( 1.0 - moss * 0.5 ) );
  eRough = mix( 0.93, 1.0, moss );
  eSpec = 0.3;

  float cover = clamp( vSurf.x + uSnowfall * 0.25 * step( 0.01, vSurf.x ), 0.0, 1.0 );
  float line = eG.y + ( macro - 0.5 ) * 0.5 + ( mossN - 0.5 ) * 0.45;
  float edge0 = mix( 1.42, 0.5, cover );
  float snow = smoothstep( edge0, edge0 + 0.22, line ) * step( 0.01, cover );
  eAlb = mix( eAlb, SNOW_ALB * ( 0.88 + 0.12 * t.b ), snow );
  eRough = mix( eRough, 0.6, snow );
  eSpec = mix( eSpec, 0.7, snow );
  eN = normalize( mix( eN, eG, snow * 0.75 ) );
  float sp = texture2D( uDetailTex, eP.xz * 2.7 + eV.xz * 0.35 ).b * texture2D( uDetailTex, eP.xz * 4.1 - eV.zx * 0.25 + 0.5 ).b;
  eEmit += vec3( 0.75, 0.86, 1.0 ) * smoothstep( 0.6, 0.78, sp ) * snow * uSparkle * 1.4;
}
`;

const BODY_WOOD = /* glsl */`
{
  vec2 gu = vEnvUv;
  float pw = vSurf.z;
  float pid = 0.0, gap = 0.0;
  if ( pw > 0.001 ) {
    float pv = gu.y / pw;
    pid = floor( pv );
    float f = fract( pv );
    gap = 1.0 - smoothstep( 0.008, 0.03, min( f, 1.0 - f ) * pw );
  }
  float g1 = texture2D( uDetailTex, vec2( gu.x * 0.09 + pid * 0.37, gu.y * 1.7 + pid * 0.61 ) ).r;
  float g2 = texture2D( uDetailTex, vec2( gu.x * 0.31 + pid * 0.13, gu.y * 6.5 ) ).r;
  float grain = g1 * 0.55 + g2 * 0.45;
  float knots = texture2D( uDetailTex, vec2( gu.x * 0.5, gu.y * 1.1 ) + pid * 0.27 ).g;
  eAlb *= ( 0.45 + 1.0 * grain ) * ( 0.8 + 0.4 * envHash( vec2( pid, 3.1 ) ) ) * ( 1.0 - gap * 0.8 ) * ( 1.0 - knots * 0.35 );
  // bump from the grain, derivative based
  vec3 dpx = dFdx( eP ), dpy = dFdy( eP );
  float h = grain * 0.05 - gap * 0.03;
  float hx = dFdx( h ), hy = dFdy( h );
  vec3 r1 = cross( dpy, eG ), r2 = cross( eG, dpx );
  float det = dot( dpx, r1 );
  eN = normalize( abs( det ) * eG - sign( det ) * ( hx * r1 + hy * r2 ) );
  eRough = 0.82 + 0.15 * grain;
  eSpec = 0.45;

  vec4 ty = texture2D( uRockTex, eP.xz * 0.27 );
  float cover = clamp( vSurf.x + uSnowfall * 0.25 * step( 0.01, vSurf.x ), 0.0, 1.0 );
  float edge0 = mix( 1.42, 0.5, cover );
  float snow = smoothstep( edge0, edge0 + 0.22, eG.y + ( ty.b - 0.5 ) * 0.6 ) * step( 0.01, cover );
  // hoar frost on everything else
  float frost = vSurf.y * smoothstep( 0.45, 0.75, g1 + ( ty.b - 0.5 ) * 0.4 );
  eAlb = mix( eAlb, vec3( 0.55, 0.64, 0.74 ), frost * 0.55 );
  eAlb = mix( eAlb, SNOW_ALB, snow );
  eRough = mix( eRough, 0.6, snow );
  eN = normalize( mix( eN, eG, snow * 0.8 ) );
}
`;

const BODY_ICE = /* glsl */`
{
  vec3 tw = pow( abs( eG ), vec3( 4.0 ) );
  tw /= ( tw.x + tw.y + tw.z );
  float cr = texture2D( uDetailTex, eP.zy * 0.19 ).g * tw.x + texture2D( uDetailTex, eP.xz * 0.19 ).g * tw.y + texture2D( uDetailTex, eP.xy * 0.19 ).g * tw.z;
  float bold = smoothstep( 0.5, 0.95, cr );
  vec2 par = eV.xz * 0.5 + eV.y * 0.3;
  float inner = texture2D( uDetailTex, ( eP.xy + eP.zz * vec2( 0.7, 0.4 ) ) * 0.17 - par * 0.35 ).a;
  float inner2 = texture2D( uDetailTex, ( eP.zy + eP.xx * vec2( 0.6, 0.3 ) ) * 0.41 - par * 0.8 ).r;
  float ndv = clamp( dot( eG, eV ), 0.0, 1.0 );
  float fres = pow( 1.0 - ndv, 2.2 );
  vec3 tint = diffuseColor.rgb;
  // dark, clear heart; milky veils drifting inside; bright where the facets turn away
  eAlb = tint * ( 0.07 + 0.3 * inner * inner ) + vec3( 0.5, 0.62, 0.7 ) * ( bold * 0.22 + cr * 0.04 );
  eEmit = tint * ( 0.035 + 0.85 * fres + 0.5 * inner * inner2 * inner2 ) + vec3( 0.45, 0.7, 0.9 ) * bold * 0.1;
  // moonlight carried through the crystal
  eEmit += tint * pow( clamp( dot( - eV, uMoonDir ) * 0.5 + 0.5, 0.0, 1.0 ), 3.0 ) * 0.4;
  eRough = 0.07 + bold * 0.3;
  vec4 ty = texture2D( uRockTex, eP.xz * 0.27 );
  eN = normalize( eG + vec3( ty.r - 0.5, 0.0, ty.g - 0.5 ) * 0.12 );
  float cover = clamp( vSurf.x + uSnowfall * 0.25 * step( 0.01, vSurf.x ), 0.0, 1.0 );
  float edge0 = mix( 1.42, 0.5, cover );
  float snow = smoothstep( edge0, edge0 + 0.22, eG.y + ( ty.b - 0.5 ) * 0.6 ) * step( 0.01, cover );
  eAlb = mix( eAlb, SNOW_ALB, snow );
  eEmit *= 1.0 - snow;
  eRough = mix( eRough, 0.6, snow );
}
`;

const BODY_FOLIAGE = /* glsl */`
{
  float n = texture2D( uDetailTex, eP.xz * 0.9 + eP.y * 0.7 ).r;
  float n2 = texture2D( uDetailTex, eP.xz * 0.23 + eP.y * 0.31 ).a;
  eAlb *= 0.45 + 1.0 * n;
  // bough cards carry their own needles and snow
  eAlb = mix( eAlb, diffuseColor.rgb * eBough.rgb * ( 0.75 + 0.5 * n ), vSurf.y );
  eSpec = 0.4;
  float cover = clamp( vSurf.x + uSnowfall * 0.2 * step( 0.01, vSurf.x ), 0.0, 1.0 );
  float edge0 = mix( 1.3, 0.25, cover );
  float snow = smoothstep( edge0, edge0 + 0.3, eG.y + ( n2 - 0.5 ) * 0.9 + ( n - 0.5 ) * 0.4 ) * step( 0.01, cover );
  eAlb = mix( eAlb, SNOW_ALB, snow );
  eRough = mix( 0.9, 0.62, snow );
  // needles glow a little when the moon is behind them
  eEmit += eAlb * pow( clamp( dot( - eV, uMoonDir ), 0.0, 1.0 ), 3.0 ) * 0.22;
  // snow on the needles glitters a little
  eRough = mix( eRough, 0.6, vSurf.y * smoothstep( 0.45, 0.8, eBough.b ) );
}
`;

const BODIES: Record<SurfaceKind, string> = { stone: BODY_STONE, wood: BODY_WOOD, ice: BODY_ICE, foliage: BODY_FOLIAGE };

const FOLIAGE_SWAY = /* glsl */`
{
  float sw = aSurf.w;
  float ph = aSurf.z * 6.283 + dot( position.xz, vec2( 0.21, 0.17 ) );
  float g = sin( uTime * 1.25 + ph ) * 0.55 + sin( uTime * 2.7 + ph * 1.7 ) * 0.25 + 0.35;
  transformed.xz += uWind.xy * g * ( 0.05 + uWind.z * 0.42 ) * sw;
  transformed.y += sin( uTime * 3.3 + ph * 2.1 ) * 0.03 * sw * ( 0.3 + uWind.z );
}
`;

function attachShared(shader: { uniforms: Record<string, THREE.IUniform> }, shared: SharedUniforms): void {
  const u = shader.uniforms;
  u.uTime = shared.uTime; u.uWind = shared.uWind;
  u.uRockTex = shared.uRockTex; u.uDetailTex = shared.uDetailTex;
  u.uWarmPos = shared.uWarmPos; u.uWarmCol = shared.uWarmCol;
  u.uMoonDir = shared.uMoonDir; u.uSparkle = shared.uSparkle; u.uSnowfall = shared.uSnowfall;
}

const SPEC_PATCH = /* glsl */`#include <lights_physical_fragment>
  material.specularColor *= eSpec;
  material.specularF90 *= eSpec;`;

function patchCommon(shader: { vertexShader: string; fragmentShader: string }, body: string, extraVert = '', extraMap = ''): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${PARS_VERT}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${extraVert}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VERT}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${PARS_FRAG}`)
    .replace('#include <map_fragment>', `#include <map_fragment>\n${extraMap}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${body}`)
    .replace('#include <lights_physical_fragment>', SPEC_PATCH);
}

/** Set the number of analytic warm lights a material evaluates (recompiles it). */
export function setWarmCount(mat: THREE.Material, n: number): void {
  const d = (mat.defines ||= {});
  if (d.NUM_WARM !== n) { d.NUM_WARM = n; mat.needsUpdate = true; }
}

const BOUGH_MAP = /* glsl */`
  vec4 eBough = texture2D( uBoughTex, vEnvUv );
  diffuseColor.a *= mix( 1.0, eBough.a, vSurf.y );
`;

export function makeSurfaceMaterial(kind: SurfaceKind, shared: SharedUniforms, warm: number, bough?: THREE.Texture): THREE.MeshStandardMaterial {
  const foliage = kind === 'foliage';
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    side: foliage ? THREE.DoubleSide : THREE.FrontSide,
    envMapIntensity: kind === 'ice' ? 1.6 : 0.8,
    alphaTest: foliage ? 0.4 : 0,
  });
  if (foliage) mat.alphaToCoverage = true;
  mat.defines = { ...(mat.defines || {}), NUM_WARM: Math.min(warm, MAX_WARM) };
  mat.onBeforeCompile = (shader) => {
    attachShared(shader, shared);
    if (foliage) {
      shader.uniforms.uBoughTex = { value: bough ?? null };
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uBoughTex;');
    }
    patchCommon(shader, BODY_BEGIN + BODIES[kind] + BODY_END, foliage ? FOLIAGE_SWAY : '', foliage ? BOUGH_MAP : '');
  };
  mat.customProgramCacheKey = () => `vind-env-${kind}`;
  mat.name = `env-${kind}`;
  return mat;
}

// --------------------------------------------------------------------------- terrain

const TERRAIN_PARS_VERT = /* glsl */`
attribute vec4 aBiome;
attribute vec3 aMisc;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec4 vBiome;
varying vec3 vMisc;
`;

const TERRAIN_VERT = /* glsl */`
vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vWNrm = normalize( mat3( modelMatrix ) * objectNormal );
vBiome = aBiome;
vMisc = aMisc;
`;

const TERRAIN_PARS_FRAG = /* glsl */`
uniform sampler2D uRockTex;
uniform sampler2D uDetailTex;
uniform float uTime;
uniform vec3 uMoonDir;
uniform float uSparkle;
uniform float uSnowfall;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec4 vBiome;
varying vec3 vMisc;
${WARM_PARS}
`;

// vBiome = (rock, snow, ice, dirt); vMisc = (ambient occlusion, metres to the rim, spare)
const TERRAIN_BODY = /* glsl */`
vec3 eP = vWPos;
vec3 eG = normalize( vWNrm );
vec3 eN = eG;
vec3 eV = normalize( cameraPosition - eP );
float eDist = length( cameraPosition - eP );
vec2 p = eP.xz;
vec4 rk = texture2D( uRockTex, p * 0.13 );
vec4 rk2 = texture2D( uRockTex, p * 0.031 + 0.37 );
vec4 d1 = texture2D( uDetailTex, p * 0.09 );
vec4 d2 = texture2D( uDetailTex, p * 0.61 );
float macro = texture2D( uDetailTex, p * 0.011 + 0.2 ).a;
float nz = d1.r * 0.62 + d2.r * 0.38;

float rim = 1.0 - smoothstep( 0.1, 1.7, vMisc.y + ( rk.b - 0.5 ) * 1.6 );
float wRock = smoothstep( 0.36, 0.6, vBiome.x + ( rk.b - 0.5 ) * 0.5 + ( rk2.b - 0.5 ) * 0.35 );
wRock = max( wRock, max( rim, ( 1.0 - smoothstep( 0.7, 0.86, eG.y ) ) ) );
float snowIn = clamp( vBiome.y + uSnowfall * 0.3, 0.0, 1.0 );
float wSnow = smoothstep( 0.36, 0.64, snowIn + ( nz - 0.5 ) * 0.7 + ( macro - 0.5 ) * 0.25 - wRock * ( rk.b - 0.35 ) * 0.6 );
float wIce = smoothstep( 0.4, 0.6, vBiome.z + ( d1.a - 0.5 ) * 0.14 );
float wDirt = smoothstep( 0.3, 0.55, vBiome.w + ( d2.r - 0.5 ) * 0.5 ) * ( 1.0 - wRock );

// --- grass: dull ochre and dark moss, heather in patches
vec3 grass = mix( vec3( 0.070, 0.082, 0.032 ), vec3( 0.200, 0.172, 0.064 ), smoothstep( 0.25, 0.75, nz ) );
grass = mix( grass, vec3( 0.120, 0.082, 0.070 ), smoothstep( 0.55, 0.85, macro ) * 0.5 );
grass = mix( grass, vec3( 0.058, 0.094, 0.044 ), ( 1.0 - smoothstep( 0.15, 0.5, macro ) ) * 0.5 );
grass *= 0.72 + 0.56 * d2.b;
// --- dirt: trampled earth with pebbles
vec3 dirt = vec3( 0.105, 0.076, 0.054 ) * ( 0.7 + 0.6 * nz ) * mix( 0.88, 1.0, rk.a );
dirt = mix( dirt, vec3( 0.21, 0.2, 0.19 ), smoothstep( 0.78, 0.9, d2.r * rk.a ) * 0.8 );
// --- rock: slate grey-violet, darker cracks, lichen
vec3 rock = vec3( 0.168, 0.162, 0.204 ) * ( 0.42 + 1.0 * rk.b ) * mix( 0.58, 1.0, rk.a ) * ( 0.75 + 0.5 * rk2.b );
rock = mix( rock, vec3( 0.16, 0.15, 0.07 ), smoothstep( 0.62, 0.8, d1.r ) * 0.35 );
// --- snow: blue in the hollows
vec3 snow = mix( vec3( 0.60, 0.69, 0.84 ), vec3( 0.80, 0.86, 0.94 ), smoothstep( 0.25, 0.7, nz + ( rk2.b - 0.5 ) * 0.4 ) );

vec3 eAlb = mix( grass, dirt, wDirt );
eAlb = mix( eAlb, rock, wRock );
float eRough = mix( 1.0, 0.95, wRock );
float eSpec = 0.25;
float bumpK = mix( 0.45, 1.0, wRock ) * ( 1.0 - wDirt * 0.6 );
// thin snow shows what is underneath at its edges
eAlb = mix( eAlb, snow, wSnow );
eRough = mix( eRough, 0.7, wSnow );
eSpec = mix( eSpec, 0.7, wSnow );
bumpK = mix( bumpK, 0.0, wSnow );
vec3 eEmit = vec3( 0.0 );

if ( wIce > 0.002 ) {
  // frozen lake: dark water under glass, cracks at three depths, trapped bubbles, wind-blown snow
  vec2 par = eV.xz / max( eV.y, 0.22 );
  vec2 pw = p + ( d1.rg - 0.5 ) * 1.6;
  float c0 = smoothstep( 0.5, 0.95, texture2D( uDetailTex, pw * 0.043 ).g );
  float hair = texture2D( uDetailTex, pw * 0.21 + 0.17 ).g;
  vec2 pr = vec2( pw.x * 0.8 - pw.y * 0.6, pw.x * 0.6 + pw.y * 0.8 );
  float c1 = smoothstep( 0.5, 0.95, texture2D( uDetailTex, ( pr - par * 0.3 ) * 0.057 + 0.31 ).g );
  float c2 = smoothstep( 0.5, 0.95, texture2D( uDetailTex, ( pw - par * 0.9 ) * 0.031 + 0.63 ).g );
  float bub = smoothstep( 0.86, 0.97, texture2D( uDetailTex, ( p - par * 0.14 ) * 0.9 ).b );
  float depthN = texture2D( uDetailTex, ( p - par * 1.6 ) * 0.035 ).a;
  vec3 ice = mix( vec3( 0.006, 0.022, 0.036 ), vec3( 0.022, 0.085, 0.115 ), depthN );
  ice += vec3( 0.50, 0.70, 0.80 ) * ( c0 * 0.42 + hair * 0.07 ) + vec3( 0.16, 0.36, 0.46 ) * c1 * 0.3 + vec3( 0.05, 0.17, 0.24 ) * c2 * 0.3;
  ice += vec3( 0.35, 0.5, 0.56 ) * bub * 0.25;
  float dust = smoothstep( 0.5, 0.74, texture2D( uDetailTex, p * vec2( 0.045, 0.13 ) + 0.5 ).r + ( d2.r - 0.5 ) * 0.35 + uSnowfall * 0.12 );
  ice = mix( ice, snow, dust * 0.9 );
  float iceRough = mix( 0.04 + c0 * 0.3 + hair * 0.08, 0.62, dust );
  eAlb = mix( eAlb, ice, wIce );
  eRough = mix( eRough, iceRough, wIce );
  eSpec = mix( eSpec, 1.0, wIce );
  bumpK = mix( bumpK, 0.03 + dust * 0.1, wIce );
  eEmit += vec3( 0.03, 0.10, 0.13 ) * depthN * ( 1.0 - dust ) * wIce * 0.35;
  wSnow = mix( wSnow, dust, wIce );
}

vec2 bump = ( rk.rg * 2.0 - 1.0 ) + ( rk2.rg * 2.0 - 1.0 ) * 0.6;
float bumpFade = 1.0 / ( 1.0 + eDist * 0.012 );
// snow drifts: broad soft swells only, no rock relief showing through
vec2 drift = ( texture2D( uRockTex, p * 0.017 + 0.61 ).rg * 2.0 - 1.0 ) * 0.5 * wSnow;
eN = normalize( eG + vec3( bump.x, 0.0, bump.y ) * bumpK * bumpFade + vec3( drift.x, 0.0, drift.y ) );

// contact shadow baked from the colliders + a little self-occlusion in the cracks
eAlb *= vMisc.x;

float sp = texture2D( uDetailTex, p * 2.7 + eV.xz * 0.35 ).b * texture2D( uDetailTex, p * 4.1 - eV.zx * 0.25 + 0.5 ).b;
eEmit += vec3( 0.75, 0.86, 1.0 ) * smoothstep( 0.6, 0.78, sp ) * wSnow * uSparkle * 1.5 * ( 1.0 - smoothstep( 10.0, 70.0, eDist ) ) * vMisc.x;

diffuseColor.rgb = eAlb;
roughnessFactor = eRough;
normal = normalize( ( viewMatrix * vec4( eN, 0.0 ) ).xyz );
#if NUM_WARM > 0
  totalEmissiveRadiance += eAlb * envWarm( eP, eN );
#endif
totalEmissiveRadiance += eEmit;
`;

export function makeTerrainMaterial(shared: SharedUniforms, warm: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMapIntensity: 1.0 });
  mat.defines = { ...(mat.defines || {}), NUM_WARM: Math.min(warm, MAX_WARM) };
  mat.onBeforeCompile = (shader) => {
    attachShared(shader, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${TERRAIN_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS_FRAG}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TERRAIN_BODY}`)
      .replace('#include <lights_physical_fragment>', SPEC_PATCH);
  };
  mat.customProgramCacheKey = () => 'vind-env-terrain';
  mat.name = 'env-terrain';
  return mat;
}

// --------------------------------------------------------------------------- grass

/**
 * Instanced grass tufts: crossed cards of alpha-tested blades. uv.y = height (0 root .. 1 tip); the
 * instance colour tints the tuft. Lit like the ground (normal = up) so tufts sit in the terrain.
 */
export function makeGrassMaterial(shared: SharedUniforms, warm: number, fade: { value: THREE.Vector2 }, blades: THREE.Texture): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, alphaTest: 0.42 });
  mat.alphaToCoverage = true;
  mat.defines = { ...(mat.defines || {}), NUM_WARM: Math.min(warm, MAX_WARM) };
  mat.onBeforeCompile = (shader) => {
    attachShared(shader, shared);
    shader.uniforms.uGrassFade = fade;
    shader.uniforms.uBlades = { value: blades };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform float uTime;
        uniform vec4 uWind;
        uniform vec2 uGrassFade;
        varying vec3 vWPos;
        varying vec2 vBlade;
        varying float vGDist;`)
      .replace('#include <defaultnormal_vertex>', /* glsl */`#include <defaultnormal_vertex>
        transformedNormal = normalize( normalMatrix * vec3( 0.0, 1.0, 0.0 ) );`)
      .replace('#include <project_vertex>', /* glsl */`
        vec4 gp = vec4( transformed, 1.0 );
        vec3 gOrigin = vec3( 0.0 );
        #ifdef USE_INSTANCING
          gp = instanceMatrix * gp;
          gOrigin = instanceMatrix[ 3 ].xyz;
        #endif
        float gDist = distance( gOrigin, cameraPosition );
        float gKeep = 1.0 - smoothstep( uGrassFade.x, uGrassFade.y, gDist );
        gp.y = gOrigin.y + ( gp.y - gOrigin.y ) * gKeep;
        float gh = uv.y;
        float gph = dot( gOrigin.xz, vec2( 0.13, 0.11 ) );
        float gust = sin( uTime * 1.6 + gph ) * 0.5 + sin( uTime * 3.4 + gph * 2.3 + gOrigin.x ) * 0.28 + sin( uTime * 0.53 + gph * 0.31 ) * 0.4;
        float bend = ( 0.035 + uWind.z * 0.3 ) * ( 0.75 + gust * 0.7 ) * gKeep;
        gp.xz += uWind.xy * bend * gh;
        gp.y -= abs( bend ) * bend * gh * 0.5;
        vWPos = gp.xyz;
        vBlade = uv;
        vGDist = gDist;
        vec4 mvPosition = modelViewMatrix * gp;
        gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform sampler2D uBlades;
        varying vec3 vWPos;
        varying vec2 vBlade;
        varying float vGDist;
        ${WARM_PARS}`)
      .replace('#include <map_fragment>', /* glsl */`
        vec4 gTex = texture2D( uBlades, vBlade );
        // keep thin blades from dissolving in the distance as the mips blur the coverage away
        diffuseColor.a = gTex.a * ( 1.0 + smoothstep( 6.0, 45.0, vGDist ) * 1.4 );
        diffuseColor.rgb *= gTex.rgb * 1.5;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        {
          // both faces of a card are lit as upward-facing ground cover
          normal = normalize( vNormal );
          #if NUM_WARM > 0
            totalEmissiveRadiance += diffuseColor.rgb * envWarm( vWPos, vec3( 0.0, 1.0, 0.0 ) );
          #endif
        }`);
  };
  mat.customProgramCacheKey = () => 'vind-env-grass';
  mat.name = 'env-grass';
  return mat;
}

// --------------------------------------------------------------------------- glow (runes)

/**
 * Additive glowing decals: quads mapped onto the rune atlas (R = stroke, G = halo). Vertex colour
 * is HDR; `aPulse` = (phase, depth of the pulse 0..1).
 */
export function makeRuneMaterial(shared: SharedUniforms, atlas: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'env-runes',
    uniforms: { ...THREE.UniformsLib.fog, uTime: shared.uTime, uAtlas: { value: atlas }, uPower: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 color;
      attribute vec2 aPulse;
      uniform float uTime;
      varying vec3 vCol;
      varying vec2 vUv2;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv2 = uv;
        float pulse = 1.0 - aPulse.y * ( 0.5 + 0.5 * sin( uTime * 1.4 + aPulse.x ) );
        float flick = 0.94 + 0.06 * sin( uTime * 9.0 + aPulse.x * 7.0 );
        vCol = color * pulse * flick;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uAtlas;
      uniform float uPower;
      varying vec3 vCol;
      varying vec2 vUv2;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D( uAtlas, vUv2 );
        vec3 col = vCol * ( t.r * 1.6 + t.g * 0.5 ) + vec3( 1.0, 0.95, 0.85 ) * t.r * t.r * dot( vCol, vec3( 0.2 ) );
        gl_FragColor = vec4( col * uPower, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #ifdef USE_FOG
          float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          gl_FragColor.rgb *= 1.0 - fogFactor;
        #endif
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
}

export function makeMetalMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.55, metalness: 0.85, envMapIntensity: 1.2 });
  m.name = 'env-iron';
  return m;
}
