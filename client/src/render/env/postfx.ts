// Post-processing. Scene -> linear half-float target (MSAA on high/ultra) -> bloom pyramid ->
// ONE final fullscreen pass (ACES, teal/amber grade, vignette, grain and every gameplay screen
// effect) -> screen; medium adds an FXAA pass in place of MSAA. Quality 'low' renders straight to
// the screen with the renderer's own ACES and draws the screen effects as a single blended overlay.
// Every target and material is created up front; render() allocates nothing.
import * as THREE from 'three';
import type { PostFX } from '../../contracts';
import type { QualityLevel } from '../../settings';

export const EXPOSURE = 1.0;

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const PREFILTER_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 tap( vec2 o ) { return min( texture2D( tSrc, vUv + o * uTexel ).rgb, vec3( 48.0 ) ); }
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
void main() {
  vec3 a = tap( vec2( - 1.0, - 1.0 ) ), b = tap( vec2( 1.0, - 1.0 ) ), c = tap( vec2( - 1.0, 1.0 ) ), d = tap( vec2( 1.0, 1.0 ) );
  // Karis average: a single very hot texel cannot flicker the whole bloom
  float wa = 1.0 / ( 1.0 + luma( a ) ), wb = 1.0 / ( 1.0 + luma( b ) ), wc = 1.0 / ( 1.0 + luma( c ) ), wd = 1.0 / ( 1.0 + luma( d ) );
  vec3 col = ( a * wa + b * wb + c * wc + d * wd ) / ( wa + wb + wc + wd );
  float br = max( col.r, max( col.g, col.b ) );
  float soft = clamp( br - uThreshold + uKnee, 0.0, 2.0 * uKnee );
  soft = soft * soft / ( 4.0 * uKnee + 1e-4 );
  float k = max( soft, br - uThreshold ) / max( br, 1e-4 );
  gl_FragColor = vec4( col * k, 1.0 );
}
`;

const DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 t( float x, float y ) { return texture2D( tSrc, vUv + vec2( x, y ) * uTexel ).rgb; }
void main() {
  vec3 col = t( 0.0, 0.0 ) * 0.125;
  col += ( t( - 2.0, - 2.0 ) + t( 2.0, - 2.0 ) + t( - 2.0, 2.0 ) + t( 2.0, 2.0 ) ) * 0.03125;
  col += ( t( 0.0, - 2.0 ) + t( - 2.0, 0.0 ) + t( 2.0, 0.0 ) + t( 0.0, 2.0 ) ) * 0.0625;
  col += ( t( - 1.0, - 1.0 ) + t( 1.0, - 1.0 ) + t( - 1.0, 1.0 ) + t( 1.0, 1.0 ) ) * 0.125;
  gl_FragColor = vec4( col, 1.0 );
}
`;

const UP_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
vec3 t( float x, float y ) { return texture2D( tSrc, vUv + vec2( x, y ) * uTexel ).rgb; }
void main() {
  vec3 col = t( 0.0, 0.0 ) * 0.25;
  col += ( t( - 1.0, 0.0 ) + t( 1.0, 0.0 ) + t( 0.0, - 1.0 ) + t( 0.0, 1.0 ) ) * 0.125;
  col += ( t( - 1.0, - 1.0 ) + t( 1.0, - 1.0 ) + t( - 1.0, 1.0 ) + t( 1.0, 1.0 ) ) * 0.0625;
  gl_FragColor = vec4( col * uWeight, 1.0 );
}
`;

/** Screen effects shared by the final pass and the low-quality overlay. */
const FX_UNIFORMS = /* glsl */`
uniform vec2 uRes;
uniform float uTime;
uniform float uImpact;
uniform float uHurt;
uniform float uDanger;
uniform float uDesat;
uniform float uKick;
uniform float uFrost;
uniform float uVignette;
float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash12( i ), hash12( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash12( i + vec2( 0.0, 1.0 ) ), hash12( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fbm3( vec2 p ) { return vnoise( p ) * 0.5 + vnoise( p * 2.07 + 3.1 ) * 0.3 + vnoise( p * 4.3 + 7.7 ) * 0.2; }
// x = coverage 0..1, y = crystal brightness
vec2 frostField( vec2 c, float aspect, float r ) {
  vec2 q = c * vec2( aspect, 1.0 );
  float box = max( abs( c.x ), abs( c.y ) ) * 2.0;        // 0 centre .. 1 at the screen edge
  float e = mix( box, r, 0.35 );
  float n = fbm3( q * 5.0 );
  float n2 = fbm3( q * 17.0 + 4.0 );
  float edge = e + ( n - 0.5 ) * 0.3 + ( n2 - 0.5 ) * 0.08;
  float m = smoothstep( 1.06 - uFrost * 0.42, 1.2 - uFrost * 0.22, edge );
  // feathery crystals: the thin ridges of two warped noise fields, plus a glitter of single pixels
  vec2 w = q + vec2( n, n2 ) * 0.06;
  float f1 = 1.0 - abs( 2.0 * vnoise( w * 26.0 ) - 1.0 );
  float f2 = 1.0 - abs( 2.0 * vnoise( w * 61.0 + 9.0 ) - 1.0 );
  float crystal = pow( f1, 5.0 ) * 0.7 + pow( f2, 6.0 ) * 0.5;
  float sparkle = step( 0.988, hash12( floor( gl_FragCoord.xy * 0.5 ) ) );
  return vec2( m, 0.5 + 0.6 * crystal + 0.4 * sparkle );
}
`;

const FINAL_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uExposure;
uniform float uBloom;
uniform float uGrain;
varying vec2 vUv;
${FX_UNIFORMS}
vec3 RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 aces( vec3 color ) {
  const mat3 inM = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 outM = mat3( vec3( 1.60475, - 0.10208, - 0.00327 ), vec3( - 0.53108, 1.10813, - 0.07276 ), vec3( - 0.07367, - 0.00605, 1.07602 ) );
  color *= 1.0 / 0.6;
  color = inM * color;
  color = RRTAndODTFit( color );
  color = outM * color;
  return clamp( color, 0.0, 1.0 );
}
void main() {
  vec2 c = vUv - 0.5;
  float aspect = uRes.x / uRes.y;
  float r = length( c * vec2( aspect, 1.0 ) ) / length( vec2( aspect, 1.0 ) * 0.5 );
  vec2 uv = vUv;
  vec2 frost = vec2( 0.0 );
  if ( uFrost > 0.003 ) {
    frost = frostField( c, aspect, r );
    uv -= c * frost.x * ( frost.y - 0.6 ) * 0.05;   // ice bends the picture
  }
  vec3 col;
  if ( uKick > 0.004 ) {
    // radial smear with the channels pulled apart
    vec2 dir = c * uKick * ( 0.35 + r );
    col = vec3( 0.0 );
    for ( int i = 0; i < 4; i ++ ) {
      float k = 0.012 + 0.014 * float( i );
      col.r += texture2D( tScene, uv - dir * k * 1.7 ).r;
      col.g += texture2D( tScene, uv - dir * k ).g;
      col.b += texture2D( tScene, uv - dir * k * 0.3 ).b;
    }
    col *= 0.25;
  } else {
    col = texture2D( tScene, uv ).rgb;
  }
  #ifdef USE_BLOOM
    col += texture2D( tBloom, uv ).rgb * uBloom;
  #endif
  col *= uExposure * ( 1.0 + uImpact * 0.9 );
  col = aces( col );

  // filmic grade: teal in the shadows, amber in the highlights, a gentle S-curve
  const vec3 W = vec3( 0.2126, 0.7152, 0.0722 );
  float l = dot( col, W );
  col *= mix( vec3( 0.88, 1.0, 1.12 ), vec3( 1.10, 1.0, 0.87 ), smoothstep( 0.03, 0.62, l ) );
  col = mix( vec3( dot( col, W ) ), col, 1.12 );
  col = mix( col, col * col * ( 3.0 - 2.0 * col ), 0.3 );

  // impact frame: contrast pop + slight white-out
  col = ( col - 0.5 ) * ( 1.0 + uImpact * 0.55 ) + 0.5;
  col = mix( col, vec3( 1.0 ), uImpact * 0.2 );
  col = max( col, 0.0 );
  // death: drain the colour
  l = dot( col, W );
  col = mix( col, vec3( l ) * vec3( 0.86, 0.95, 1.08 ) * 0.82, uDesat );
  // vignette
  col *= 1.0 - smoothstep( 0.35, 1.3, r ) * uVignette;
  // low health: a heartbeat of dark red at the edges
  float beat = 0.72 + 0.28 * pow( 0.5 + 0.5 * sin( uTime * 5.2 ), 3.0 );
  col = mix( col, vec3( 0.30, 0.0, 0.012 ), smoothstep( 0.42, 1.12, r ) * uDanger * beat * 0.78 );
  // hurt: a red pulse closing in
  float hz = smoothstep( 0.18, 1.05, r + ( vnoise( c * 9.0 + uTime ) - 0.5 ) * 0.2 );
  col = mix( col, vec3( 0.80, 0.03, 0.03 ), hz * uHurt * 0.62 );
  col.r += uHurt * 0.04;
  // frost creeping in from the edges
  col = mix( col, vec3( 0.74, 0.88, 1.0 ) * frost.y, frost.x * 0.86 );
  col += vec3( 0.35, 0.5, 0.6 ) * uFrost * 0.05;

  col = clamp( col, 0.0, 1.0 );
  col = mix( col * 12.92, 1.055 * pow( col, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, col ) );
  // grain (stronger in the dark) doubles as dither against banding in the sky
  float g = hash12( gl_FragCoord.xy + fract( uTime * 7.13 ) * 173.0 ) - 0.5;
  col += g * ( uGrain * ( 1.0 - l * 0.55 ) + 1.0 / 255.0 );
  gl_FragColor = vec4( col, 1.0 );
}
`;

// FXAA (after Timothy Lottes' 3.11, the compact console variant) on the sRGB image
const FXAA_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
float luma( vec3 c ) { return dot( c, vec3( 0.299, 0.587, 0.114 ) ); }
void main() {
  vec3 rgbNW = texture2D( tSrc, vUv + vec2( - 1.0, - 1.0 ) * uTexel ).rgb;
  vec3 rgbNE = texture2D( tSrc, vUv + vec2( 1.0, - 1.0 ) * uTexel ).rgb;
  vec3 rgbSW = texture2D( tSrc, vUv + vec2( - 1.0, 1.0 ) * uTexel ).rgb;
  vec3 rgbSE = texture2D( tSrc, vUv + vec2( 1.0, 1.0 ) * uTexel ).rgb;
  vec3 rgbM = texture2D( tSrc, vUv ).rgb;
  float lNW = luma( rgbNW ), lNE = luma( rgbNE ), lSW = luma( rgbSW ), lSE = luma( rgbSE ), lM = luma( rgbM );
  float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
  float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
  vec2 dir = vec2( - ( ( lNW + lNE ) - ( lSW + lSE ) ), ( lNW + lSW ) - ( lNE + lSE ) );
  float reduce = max( ( lNW + lNE + lSW + lSE ) * 0.03125, 0.0078125 );
  float rcp = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + reduce );
  dir = clamp( dir * rcp, vec2( - 8.0 ), vec2( 8.0 ) ) * uTexel;
  vec3 a = 0.5 * ( texture2D( tSrc, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb + texture2D( tSrc, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
  vec3 b = a * 0.5 + 0.25 * ( texture2D( tSrc, vUv - dir * 0.5 ).rgb + texture2D( tSrc, vUv + dir * 0.5 ).rgb );
  float lB = luma( b );
  gl_FragColor = vec4( ( lB < lMin || lB > lMax ) ? a : b, 1.0 );
}
`;

// Low quality: every screen effect as one premultiplied-alpha overlay on the finished frame.
const OVERLAY_FRAG = /* glsl */`
varying vec2 vUv;
${FX_UNIFORMS}
void over( inout vec4 acc, vec3 c, float k ) { acc.rgb = acc.rgb * ( 1.0 - k ) + c * k; acc.a = acc.a + k - acc.a * k; }
void main() {
  vec2 c = vUv - 0.5;
  float aspect = uRes.x / uRes.y;
  float r = length( c * vec2( aspect, 1.0 ) ) / length( vec2( aspect, 1.0 ) * 0.5 );
  vec4 acc = vec4( 0.0 );
  over( acc, vec3( 0.13, 0.15, 0.19 ), uDesat * 0.62 );
  over( acc, vec3( 0.0 ), smoothstep( 0.35, 1.3, r ) * uVignette );
  over( acc, vec3( 0.55, 0.62, 0.8 ), uKick * smoothstep( 0.3, 1.1, r ) * 0.28 );
  float beat = 0.72 + 0.28 * pow( 0.5 + 0.5 * sin( uTime * 5.2 ), 3.0 );
  over( acc, vec3( 0.58, 0.0, 0.03 ), smoothstep( 0.42, 1.12, r ) * uDanger * beat * 0.78 );
  over( acc, vec3( 0.9, 0.1, 0.1 ), smoothstep( 0.18, 1.05, r ) * uHurt * 0.62 );
  if ( uFrost > 0.003 ) {
    vec2 f = frostField( c, aspect, r );
    over( acc, vec3( 0.88, 0.95, 1.0 ) * f.y, f.x * 0.86 );
  }
  over( acc, vec3( 1.0 ), uImpact * 0.26 );
  gl_FragColor = acc;
}
`;

interface Tier { hdr: boolean; msaa: number; fxaa: boolean; levels: number; grain: number }
const TIERS: Record<QualityLevel, Tier> = {
  low: { hdr: false, msaa: 0, fxaa: false, levels: 0, grain: 0 },
  medium: { hdr: true, msaa: 0, fxaa: true, levels: 5, grain: 0.022 },
  high: { hdr: true, msaa: 4, fxaa: false, levels: 6, grain: 0.028 },
  ultra: { hdr: true, msaa: 4, fxaa: false, levels: 7, grain: 0.028 },
};

class PostFXImpl implements PostFX {
  private tier: Tier;
  private bloomOn = true;
  private hdrSupported: boolean;
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private ldrRT: THREE.WebGLRenderTarget | null = null;
  private mips: THREE.WebGLRenderTarget[] = [];
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private fsMesh: THREE.Mesh;
  private prefilter: THREE.ShaderMaterial;
  private down: THREE.ShaderMaterial;
  private up: THREE.ShaderMaterial;
  private final: THREE.ShaderMaterial;
  private fxaa: THREE.ShaderMaterial;
  private overlay: THREE.ShaderMaterial;
  private fx: Record<string, THREE.IUniform>;
  private size = new THREE.Vector2(1, 1);
  private buf = new THREE.Vector2(1, 1);
  private time = 0;
  private impactV = 0; private impactHold = 0;
  private hurtV = 0; private kickV = 0;
  private danger = 0; private desat = 0; private frost = 0;
  private reduce = false;

  constructor(private renderer: THREE.WebGLRenderer, quality: QualityLevel) {
    this.hdrSupported = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    this.tier = TIERS[quality];
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // only takes effect on the direct (low) path
    renderer.toneMappingExposure = EXPOSURE;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fx = {
      uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
      uImpact: { value: 0 }, uHurt: { value: 0 }, uDanger: { value: 0 }, uDesat: { value: 0 }, uKick: { value: 0 }, uFrost: { value: 0 },
      uVignette: { value: 0.42 },
    };
    const mk = (frag: string, uniforms: Record<string, THREE.IUniform>, extra: THREE.ShaderMaterialParameters = {}) => new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, fog: false, ...extra,
    });
    this.prefilter = mk(PREFILTER_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uKnee: { value: 0.5 } });
    this.down = mk(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = mk(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, transparent: true });
    this.final = mk(FINAL_FRAG, { ...this.fx, tScene: { value: null }, tBloom: { value: null }, uExposure: { value: EXPOSURE }, uBloom: { value: 0.16 }, uGrain: { value: 0.03 } }, { defines: { USE_BLOOM: 1 } });
    this.fxaa = mk(FXAA_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.overlay = mk(OVERLAY_FRAG, { ...this.fx }, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation, transparent: true });
    this.fsMesh = new THREE.Mesh(geo, this.final);
    this.fsMesh.frustumCulled = false;
    this.fsScene.add(this.fsMesh);
    this.rebuild();
  }

  private get hdr(): boolean { return this.tier.hdr && this.hdrSupported; }

  /** How many bloom mips fit under a w x h frame for the current tier. */
  private bloomLevels(w: number, h: number): number {
    if (!this.bloomOn || !this.hdr) return 0;
    let n = 0, mw = w >> 1, mh = h >> 1;
    while (n < this.tier.levels && mw >= 4 && mh >= 4) { n++; mw >>= 1; mh >>= 1; }
    return n;
  }

  private disposeTargets(): void {
    this.sceneRT?.dispose(); this.sceneRT = null;
    this.ldrRT?.dispose(); this.ldrRT = null;
    for (const m of this.mips) m.dispose();
    this.mips.length = 0;
  }

  /** (Re)create the render targets for the current tier and size. Called on quality / size changes only. */
  private rebuild(): void {
    this.disposeTargets();
    const w = Math.max(2, Math.floor(this.buf.x)), h = Math.max(2, Math.floor(this.buf.y));
    (this.fx.uRes.value as THREE.Vector2).set(w, h);
    if (!this.hdr) return;
    const samples = Math.min(this.tier.msaa, this.renderer.capabilities.maxSamples);
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false, samples, generateMipmaps: false,
    });
    this.sceneRT.texture.name = 'vind-scene-hdr';
    if (this.tier.fxaa) {
      this.ldrRT = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      });
    }
    const levels = this.bloomLevels(w, h);
    let mw = w >> 1, mh = h >> 1;
    for (let i = 0; i < levels; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      }));
      mw >>= 1; mh >>= 1;
    }
    const useBloom = this.mips.length > 0;
    if ((this.final.defines.USE_BLOOM !== undefined) !== useBloom) {
      if (useBloom) this.final.defines.USE_BLOOM = 1; else delete this.final.defines.USE_BLOOM;
      this.final.needsUpdate = true;
    }
    this.final.uniforms.uGrain.value = this.tier.grain;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    const r = this.renderer;
    if (r.getPixelRatio() !== pixelRatio) r.setPixelRatio(pixelRatio);
    r.getSize(this.size);
    if (this.size.x !== width || this.size.y !== height) r.setSize(width, height, false);
    r.getDrawingBufferSize(this.size);
    if (this.size.x === this.buf.x && this.size.y === this.buf.y) return;
    this.buf.copy(this.size);
    const w = Math.max(2, Math.floor(this.buf.x)), h = Math.max(2, Math.floor(this.buf.y));
    (this.fx.uRes.value as THREE.Vector2).set(w, h);
    // a different mip count (or the very first real size) needs the chain rebuilt
    if (this.hdr && (!this.sceneRT || this.bloomLevels(w, h) !== this.mips.length)) { this.rebuild(); return; }
    // otherwise resize in place: the target objects are kept, only their storage is reallocated
    this.sceneRT?.setSize(w, h);
    this.ldrRT?.setSize(w, h);
    let mw = w >> 1, mh = h >> 1;
    for (const m of this.mips) { m.setSize(Math.max(2, mw), Math.max(2, mh)); mw >>= 1; mh >>= 1; }
  }

  setQuality(q: QualityLevel, bloom: boolean): void {
    const t = TIERS[q];
    if (t === this.tier && bloom === this.bloomOn) return;
    this.tier = t; this.bloomOn = bloom;
    if (this.buf.x < 2) this.renderer.getDrawingBufferSize(this.buf);
    this.rebuild();
  }

  impact(strength: number): void {
    const s = Math.min(1, Math.max(0, strength)) * (this.reduce ? 0.3 : 1);
    if (s > this.impactV) { this.impactV = s; this.impactHold = 0.034; }
  }
  hurt(strength: number): void { this.hurtV = Math.min(1, Math.max(this.hurtV, Math.min(1, strength) * (this.reduce ? 0.55 : 1))); }
  setDanger(v: number): void { this.danger = Math.min(1, Math.max(0, v)); }
  setDesaturate(v: number): void { this.desat = Math.min(1, Math.max(0, v)); }
  kick(strength: number): void { this.kickV = Math.min(1, Math.max(this.kickV, Math.min(1, strength) * (this.reduce ? 0.5 : 1))); }
  setFrost(v: number): void { this.frost = Math.min(1, Math.max(0, v)); }
  setReduceFlashes(on: boolean): void { this.reduce = on; }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.fsMesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number): void {
    const r = this.renderer;
    if (this.buf.x < 2) { r.getDrawingBufferSize(this.buf); this.rebuild(); }
    // ---- advance the transient effects
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time = (this.time + dt) % 3600;
    if (this.impactHold > 0) this.impactHold -= dt; else this.impactV *= Math.exp(-dt * 26);
    if (this.impactV < 0.004) this.impactV = 0;
    this.hurtV *= Math.exp(-dt * 3.1); if (this.hurtV < 0.004) this.hurtV = 0;
    this.kickV *= Math.exp(-dt * 6.5); if (this.kickV < 0.004) this.kickV = 0;
    const fx = this.fx;
    fx.uTime.value = this.time;
    fx.uImpact.value = this.impactV; fx.uHurt.value = this.hurtV; fx.uKick.value = this.kickV;
    fx.uDanger.value = this.danger * (this.reduce ? 0.7 : 1); fx.uDesat.value = this.desat; fx.uFrost.value = this.frost;

    const prevAuto = r.autoClear;
    if (!this.hdr || !this.sceneRT) {
      // ---- direct path
      fx.uVignette.value = 0.3;
      r.setRenderTarget(null);
      r.autoClear = true;
      r.render(scene, camera);
      r.autoClear = false;
      this.pass(this.overlay, null);
      r.autoClear = prevAuto;
      return;
    }
    fx.uVignette.value = 0.42;
    r.autoClear = true;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);

    const mips = this.mips;
    if (mips.length > 0) {
      const src = this.sceneRT;
      (this.prefilter.uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      this.prefilter.uniforms.tSrc.value = src.texture;
      this.pass(this.prefilter, mips[0]);
      for (let i = 1; i < mips.length; i++) {
        (this.down.uniforms.uTexel.value as THREE.Vector2).set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
        this.down.uniforms.tSrc.value = mips[i - 1].texture;
        this.pass(this.down, mips[i]);
      }
      r.autoClear = false;
      for (let i = mips.length - 1; i > 0; i--) {
        (this.up.uniforms.uTexel.value as THREE.Vector2).set(1 / mips[i].width, 1 / mips[i].height);
        this.up.uniforms.tSrc.value = mips[i].texture;
        this.up.uniforms.uWeight.value = 1.0;
        this.pass(this.up, mips[i - 1]);
      }
      r.autoClear = true;
      this.final.uniforms.tBloom.value = mips[0].texture;
      this.final.uniforms.uBloom.value = 1.05 / mips.length;
    }
    this.final.uniforms.tScene.value = this.sceneRT.texture;
    if (this.ldrRT) {
      this.pass(this.final, this.ldrRT);
      (this.fxaa.uniforms.uTexel.value as THREE.Vector2).set(1 / this.ldrRT.width, 1 / this.ldrRT.height);
      this.fxaa.uniforms.tSrc.value = this.ldrRT.texture;
      this.pass(this.fxaa, null);
    } else {
      this.pass(this.final, null);
    }
    r.setRenderTarget(null);
    r.autoClear = prevAuto;
  }

  dispose(): void {
    this.disposeTargets();
    this.fsMesh.geometry.dispose();
    for (const m of [this.prefilter, this.down, this.up, this.final, this.fxaa, this.overlay]) m.dispose();
  }
}

export function createPostFX(renderer: THREE.WebGLRenderer, quality: QualityLevel): PostFX {
  return new PostFXImpl(renderer, quality);
}
