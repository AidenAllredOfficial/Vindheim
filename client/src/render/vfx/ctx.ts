// Shared context handed to every effect: the toolkit, the world, palettes and small helpers.

import * as THREE from 'three';
import type { World, GroundHit, Surface } from '@shared/world';
import { VOID } from '@shared/world';
import { ELEMENT_LIST } from '@shared/elements';
import type { FighterLookup } from '../../contracts';
import type { QualityLevel } from '../../settings';
import { Particles, type Palette } from './core/particles';
import { Strips, Bolts } from './core/strips';
import { Decals } from './core/decals';
import { createBatches, type Batches } from './core/inst';
import { Lights } from './core/lights';
import { buildGlyphAtlas, buildParticleAtlas, buildRuneBand } from './core/atlas';

export interface QualityCfg {
  /** Particle pool size (hard cap) and emission multiplier. */
  particles: number; density: number;
  /** Mesh detail multiplier (debris chunks, bolt branches …). */
  detail: number;
}

export const QUALITY: Record<QualityLevel, QualityCfg> = {
  low: { particles: 1500, density: 0.34, detail: 0.5 },
  medium: { particles: 4000, density: 0.62, detail: 0.75 },
  high: { particles: 8000, density: 1.0, detail: 1 },
  ultra: { particles: 12000, density: 1.35, detail: 1.25 },
};

const pal = (color: number, core: number, dark: number): Palette => ({
  color: new THREE.Color(color), core: new THREE.Color(core), dark: new THREE.Color(dark),
});

export class Ctx {
  now = 0; dt = 0;
  camera!: THREE.PerspectiveCamera;
  readonly camPos = new THREE.Vector3();
  cfg: QualityCfg;
  quality: QualityLevel;

  readonly P: Particles;
  readonly strips: Strips;
  readonly bolts: Bolts;
  readonly decals: Decals;
  readonly B: Batches;
  readonly lights: Lights;

  /** Palettes by element index (ELEMENT_ORDER). */
  readonly pals: Palette[];
  readonly heal = pal(0xb9f060, 0xfff3b0, 0x2f6a1c);
  readonly neutral = pal(0xd8e2f0, 0xffffff, 0x38404c);
  /** Stone-coloured rock for debris that is not elemental. */
  readonly rock = new THREE.Color(0x6e6a70);
  readonly white = new THREE.Color(1, 1, 1);
  readonly black = new THREE.Color(0, 0, 0);
  readonly tmpColor = new THREE.Color();

  private readonly hit: GroundHit = { y: 0, surf: 'grass', collider: null };
  private readonly textures: THREE.Texture[] = [];
  private lightScan = 0;
  private readonly v = new THREE.Vector3();

  constructor(readonly scene: THREE.Scene, readonly world: World, readonly fighters: FighterLookup, quality: QualityLevel) {
    this.quality = quality;
    this.cfg = QUALITY[quality];
    this.pals = ELEMENT_LIST.map((e) => pal(e.color, e.core, e.dark));
    const atlas = buildParticleAtlas(), glyphs = buildGlyphAtlas(), band = buildRuneBand();
    this.textures.push(atlas, glyphs, band);
    this.decals = new Decals(scene, world, 96, band, glyphs);
    this.B = createBatches(scene, glyphs, 1);
    this.strips = new Strips(scene, 96);
    this.bolts = new Bolts(this.strips, 48);
    this.P = new Particles(scene, atlas, this.cfg.particles, this.pals[0]);
    this.P.density = this.cfg.density;
    this.lights = new Lights(scene);
  }

  setQuality(q: QualityLevel): void {
    if (q === this.quality) return;
    this.quality = q;
    this.cfg = QUALITY[q];
    this.P.setCapacity(this.cfg.particles);
    this.P.density = this.cfg.density;
  }

  /** Select an element palette for subsequent particle emission and return it. */
  use(el: number): Palette {
    const p = this.pals[el] || this.pals[0];
    this.P.setPalette(p);
    return p;
  }
  usePal(p: Palette): Palette { this.P.setPalette(p); return p; }

  /** Detail-scaled count for mesh debris (never zero when n > 0). */
  d(n: number): number { return n <= 0 ? 0 : Math.max(1, Math.round(n * this.cfg.detail)); }

  /** Ground height under (x, z) for something whose feet are near refY. Falls back to refY over the abyss. */
  groundY(x: number, z: number, refY: number): number {
    const y = this.world.ground(x, z, refY + 0.7, this.hit).y;
    return y <= VOID * 0.5 || y < refY - 8 ? refY : y;
  }
  /** Is there ground within `reach` metres below y? (ground marks are skipped for mid-air bursts) */
  nearGround(x: number, y: number, z: number, reach: number): boolean {
    const g = this.world.ground(x, z, y + 0.7, this.hit).y;
    return g > VOID * 0.5 && y - g < reach;
  }
  surface(x: number, z: number, refY: number): Surface {
    this.world.ground(x, z, refY + 0.7, this.hit);
    return this.hit.surf;
  }

  begin(dt: number, camera: THREE.PerspectiveCamera): void {
    this.dt = dt;
    this.now += dt;
    this.camera = camera;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.P.update(this.now);
    this.decals.update(this.now);
    // follow the scene's key light so rocks and ice sit in the world's lighting
    this.lightScan -= dt;
    if (this.lightScan <= 0) { this.lightScan = 1.5; this.scanLights(); }
  }

  /** Upload everything written this frame. */
  end(): void {
    this.bolts.update(this.now);
    this.strips.update(this.dt, this.now, this.camera);
    this.B.update(this.now);
    this.decals.flush();
    this.P.flush();
    this.lights.update(this.dt);
  }

  private scanLights(): void {
    let dir: THREE.DirectionalLight | null = null, hemi: THREE.HemisphereLight | null = null;
    const kids = this.scene.children;
    const visit = (o: THREE.Object3D) => {
      const l = o as unknown as { isDirectionalLight?: boolean; isHemisphereLight?: boolean; intensity: number };
      if (l.isDirectionalLight && (!dir || l.intensity > dir.intensity)) dir = o as THREE.DirectionalLight;
      else if (l.isHemisphereLight && !hemi) hemi = o as THREE.HemisphereLight;
    };
    for (let i = 0; i < kids.length; i++) { visit(kids[i]); const k2 = kids[i].children; for (let j = 0; j < k2.length; j++) visit(k2[j]); }
    if (!dir) return;
    const d = dir as THREE.DirectionalLight;
    this.v.copy(d.position).sub(d.target.position).normalize();
    const lc = this.tmpColor.copy(d.color).multiplyScalar(Math.min(d.intensity, 3) * 0.55);
    const h = hemi as THREE.HemisphereLight | null;
    const sky = h ? skyC.copy(h.color).multiplyScalar(h.intensity * 0.5) : skyC.setRGB(0.2, 0.26, 0.4);
    const gr = h ? groundC.copy(h.groundColor).multiplyScalar(h.intensity * 0.5) : groundC.setRGB(0.12, 0.1, 0.09);
    this.B.setLight(this.v, lc, sky, gr);
  }

  clear(): void {
    this.P.clear(); this.strips.clear(); this.bolts.clear(); this.decals.clear(); this.B.clear(); this.lights.clear();
  }

  dispose(): void {
    this.P.dispose(); this.strips.dispose(); this.decals.dispose(); this.B.dispose(); this.lights.dispose();
    for (const t of this.textures) t.dispose();
  }
}

const skyC = new THREE.Color(), groundC = new THREE.Color();

/** Dust / debris colour of a surface (linear). */
const SURF: Record<string, THREE.Color> = {
  grass: new THREE.Color(0x5d6b34), rock: new THREE.Color(0x77747c), snow: new THREE.Color(0xdfe9f6),
  ice: new THREE.Color(0xbfe6fb), stone: new THREE.Color(0x8a8890), wood: new THREE.Color(0x7c5d3c),
};
const SURF_DUST: Record<string, THREE.Color> = {
  grass: new THREE.Color(0x7a6d52), rock: new THREE.Color(0x8b8890), snow: new THREE.Color(0xe9f1fb),
  ice: new THREE.Color(0xd6f0ff), stone: new THREE.Color(0x96939a), wood: new THREE.Color(0x8d7354),
};
export const surfColor = (s: string): THREE.Color => SURF[s] || SURF.rock;
export const surfDust = (s: string): THREE.Color => SURF_DUST[s] || SURF_DUST.rock;
