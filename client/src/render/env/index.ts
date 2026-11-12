// Environment entry point: the world outside the hall building, sky and atmosphere, lighting,
// and post-processing. Implements `EnvironmentModule` from ../../contracts.
import * as THREE from 'three';
import { clamp01, hash1, hash2, lerp } from '@shared/math';
import { CLOUD_SEA_Y, type Landmass, type World } from '@shared/world';
import type { Weather } from '@shared/weather';
import type { ElementId } from '@shared/elements';
import type { Environment, PedestalState } from '../../contracts';
import type { QualityLevel } from '../../settings';
import type { HallBuild } from './hallContract';
import { buildHall } from './hall';
import { ENV_QUALITY, Geo, acesFilmic, makeSharedUniforms, nextFrame, type EnvQuality, type SharedUniforms } from './common';
import { makeBoughTexture, makeDetailTexture, makeGrassTexture, makeRockTexture, makeRuneAtlas } from './textures';
import { makeGrassMaterial, makeMetalMaterial, makeRuneMaterial, makeSurfaceMaterial, makeTerrainMaterial, setWarmCount } from './materials';
import { buildCliff, buildLandmassTop, makeTuftGeometry, scatterGrass, type Tuft } from './terrain';
import { dressColliders, type BatchMaterial, type PropsBuild } from './props';
import { blobGeometry, shardGeometry, tube } from './shapes';
import { Sky } from './sky';
import { Clouds } from './clouds';
import { Crystals, Fires, Snow } from './particles';
import { Lighting } from './lighting';
import { EXPOSURE, createPostFX } from './postfx';

export { createPostFX };

const FOG_CLEAR = new THREE.Color(0.082, 0.112, 0.18);
const FOG_SNOW = new THREE.Color(0.17, 0.205, 0.275);
const FOG_STORM = new THREE.Color(0.05, 0.06, 0.1);

interface Bolt { x: number; z: number; start: number; strength: number; fired: boolean; radius: number }

class EnvironmentImpl implements Environment {
  onLightning: ((distance: number, strength: number) => void) | null = null;

  readonly root = new THREE.Group();
  private q: EnvQuality;
  private level: QualityLevel;
  private shared: SharedUniforms;
  private surfaceMats: THREE.Material[] = [];
  private grassMeshes: { mesh: THREE.InstancedMesh; total: number }[] = [];
  private grassFade = { value: new THREE.Vector2(55, 75) };
  private pebbleMeshes: { mesh: THREE.InstancedMesh; total: number }[] = [];
  private farRocks: THREE.InstancedMesh | null = null;
  private farRockTotal = 0;
  private shadowCasters: THREE.Object3D[] = [];
  private sky!: Sky;
  private clouds!: Clouds;
  private snow!: Snow;
  private fires!: Fires;
  private crystals!: Crystals;
  private lighting!: Lighting;
  private hall!: HallBuild;
  private fog!: THREE.FogExp2;
  private fogLinear = new THREE.Color();
  private envTexture: THREE.Texture | null = null;
  private ownedTextures: THREE.Texture[] = [];
  private clock = 0;
  private bolts: Bolt[] = [];
  private lastSlot = -1;
  private reduceFlashes = false;
  private flash = 0;
  private wFog = 0; private wStorm = 0; private wSnow = 0.14;
  private disposed = false;
  /** Statistics for the dev harness. */
  stats: Record<string, number> = {};

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private world: World, quality: QualityLevel) {
    this.level = quality;
    this.q = ENV_QUALITY[quality];
    this.shared = makeSharedUniforms();
    this.root.name = 'environment';
    for (let i = 0; i < 2; i++) this.bolts.push({ x: 0, z: 0, start: -100, strength: 0, fired: true, radius: 200 });
  }

  // ------------------------------------------------------------------------------------------ build

  async build(progress: (p: number, label: string) => void): Promise<void> {
    const { scene, renderer, world, shared, q } = this;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    progress(0.02, 'Carving runes');
    shared.uRockTex.value = makeRockTexture(512, Math.min(q.anisotropy, maxAniso));
    await nextFrame();
    shared.uDetailTex.value = makeDetailTexture(256, Math.min(q.anisotropy, maxAniso));
    const atlas = makeRuneAtlas();
    await nextFrame();

    const warm = q.warmLights;
    const boughTex = makeBoughTexture();
    this.ownedTextures.push(boughTex);
    const mats: Record<BatchMaterial, THREE.Material> = {
      stone: makeSurfaceMaterial('stone', shared, warm),
      wood: makeSurfaceMaterial('wood', shared, warm),
      ice: makeSurfaceMaterial('ice', shared, warm),
      foliage: makeSurfaceMaterial('foliage', shared, warm, boughTex),
      metal: makeMetalMaterial(),
    };
    const terrainMat = makeTerrainMaterial(shared, warm);
    const bladeTex = makeGrassTexture();
    this.ownedTextures.push(bladeTex, atlas.texture);
    const grassMat = makeGrassMaterial(shared, warm, this.grassFade, bladeTex);
    this.surfaceMats = [mats.stone, mats.wood, mats.ice, mats.foliage, terrainMat, grassMat];
    const runeMat = makeRuneMaterial(shared, atlas.texture);

    // ---- sky first: it also provides fog and the image-based fill everything else is lit by
    progress(0.08, 'Raising the moon');
    this.fog = new THREE.FogExp2(FOG_CLEAR.getHex(), 0.002);
    scene.fog = this.fog;
    scene.background = null;
    this.sky = new Sky(shared, q);
    this.root.add(this.sky.group);
    this.sky.uniforms.uFogCol.value.copy(FOG_CLEAR);
    this.envTexture = this.sky.bakeEnvironment(renderer);
    scene.environment = this.envTexture;
    this.clouds = new Clouds(shared, this.sky.uniforms, q);
    this.root.add(this.clouds.group);
    await nextFrame();

    // ---- terrain
    const tufts: Tuft[] = [];
    const rootGeo = new Geo();
    const icicles: { x: number; y: number; z: number; len: number }[] = [];
    const lms = world.landmasses;
    for (let i = 0; i < lms.length; i++) {
      const lm = lms[i];
      progress(0.12 + 0.3 * (i / lms.length), `Shaping ${lm.name}`);
      const step = lm.kind === 'islet' ? 0.6 : 1.0;
      const lb = buildLandmassTop(world, lm, step);
      const top = new THREE.Mesh(lb.top, terrainMat);
      top.name = `terrain-${lm.name}`;
      top.receiveShadow = true;
      top.castShadow = false;
      this.root.add(top);
      const g = new Geo();
      buildCliff(world, lm, lb, g);
      const cliff = new THREE.Mesh(g.build(), mats.stone);
      cliff.name = `cliff-${lm.name}`;
      cliff.receiveShadow = true;
      cliff.castShadow = false;
      this.root.add(cliff);
      icicles.push(...lb.icicles);
      for (const r of lb.roots) this.addRoot(rootGeo, r);
      this.stats.terrainTris = (this.stats.terrainTris || 0) + lb.top.index!.count / 3 + g.triangles;
      await nextFrame();
      scatterGrass(world, lm, lm.kind === 'hall' ? 0.9 : 0.47, tufts);
      await nextFrame();
    }

    if (rootGeo.count) {
      const roots = new THREE.Mesh(rootGeo.build(), mats.wood);
      roots.name = 'roots';
      roots.receiveShadow = true;
      this.root.add(roots);
    }

    // ---- colliders
    progress(0.45, 'Raising the stones');
    const props = dressColliders(world, atlas);
    await nextFrame();
    progress(0.6, 'Raising the stones');
    let propTris = 0;
    for (const [key, g] of props.batches) {
      if (g.count === 0) continue;
      const mat = key.split('|')[0] as BatchMaterial;
      const mesh = new THREE.Mesh(g.build(), mats[mat]);
      mesh.name = `props-${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.shadowCasters.push(mesh);
      this.root.add(mesh);
      propTris += g.triangles;
    }
    this.stats.propTris = propTris;
    Object.assign(this.stats, props.stats);
    const runes = new THREE.Mesh(props.runes.build(), runeMat);
    runes.name = 'runes';
    runes.renderOrder = 10;
    this.root.add(runes);
    icicles.push(...props.icicles);
    await nextFrame();

    // ---- grass
    progress(0.68, 'Sowing the meadows');
    this.buildGrass(tufts, grassMat);
    await nextFrame();

    // ---- loose detail
    progress(0.76, 'Scattering stones');
    this.buildPebbles(props, mats.stone);
    this.buildIcicles(icicles, mats.ice);
    this.buildFarRocks(mats.stone);
    this.buildChains(mats.metal);
    await nextFrame();

    // ---- atmosphere
    progress(0.84, 'Calling the snow');
    this.snow = new Snow(shared, q);
    this.root.add(this.snow.mesh);
    this.fires = new Fires(shared, props.flames, q);
    this.root.add(this.fires.group);
    this.crystals = new Crystals(props.crystals);
    this.root.add(this.crystals.mesh);
    await nextFrame();

    // ---- the hall (built by the hall set piece) and the lights
    progress(0.9, 'Lighting the hearth');
    this.hall = buildHall(world, this.level);
    this.root.add(this.hall.group);
    // warm sources: fires first so they always get a slot
    const sources = [...props.warm].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'fire' ? -1 : 1));
    this.lighting = new Lighting(scene, sources, q, true);
    this.stats.warmSources = sources.length;
    this.stats.lights = 3 + this.hall.lights.length;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.add(this.root);
    this.applyFog(0);
    progress(1, 'Vindheim awaits');
    await nextFrame();
  }

  /** A root dangling from under the turf at the cliff's lip (below the rim, out of reach). */
  private addRoot(g: Geo, r: { x: number; y: number; z: number; len: number; ax: number; az: number }): void {
    const pts: THREE.Vector3[] = [];
    const seed = Math.round(r.x * 13 + r.z * 7);
    const N = 6;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const out = 0.15 + Math.sin(t * 2.6 + hash1(seed, 3) * 3) * 0.3 * t;
      const side = Math.sin(t * 4.1 + hash1(seed, 5) * 6) * 0.22 * t;
      pts.push(new THREE.Vector3(r.x + r.ax * out - r.az * side, r.y - r.len * t, r.z + r.az * out + r.ax * side));
    }
    g.color([0.11, 0.085, 0.07]).surface(0, 0.4, 0, 0);
    const r0 = 0.05 + hash1(seed, 7) * 0.06;
    tube(g, pts, (t) => r0 * (1 - t * 0.85) + 0.012, 4, false);
  }

  private buildGrass(tufts: Tuft[], mat: THREE.Material): void {
    const geo = makeTuftGeometry();
    const CELL = 34;
    const cells = new Map<string, Tuft[]>();
    for (const t of tufts) {
      const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
      let arr = cells.get(k);
      if (!arr) cells.set(k, (arr = []));
      arr.push(t);
    }
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    let total = 0;
    for (const arr of cells.values()) {
      arr.sort((a, b) => a.order - b.order); // any prefix is an even thinning
      const mesh = new THREE.InstancedMesh(geo, mat, arr.length);
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        qt.setFromAxisAngle(yAxis, t.yaw);
        m.compose(p.set(t.x, t.y, t.z), qt, s.set(t.scale * 0.95, t.scale * (0.8 + 0.5 * t.order), t.scale * 0.95));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.setRGB(t.tint[0], t.tint[1], t.tint[2]));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = 'grass';
      this.grassMeshes.push({ mesh, total: arr.length });
      this.root.add(mesh);
      total += arr.length;
    }
    this.stats.grassTufts = total;
    this.applyGrassQuality();
  }

  private applyGrassQuality(): void {
    for (const g of this.grassMeshes) g.mesh.count = Math.max(0, Math.floor(g.total * this.q.grass));
    const far = this.level === 'low' ? 34 : this.level === 'medium' ? 52 : this.level === 'high' ? 70 : 95;
    this.grassFade.value.set(far * 0.72, far);
  }

  private buildPebbles(props: PropsBuild, mat: THREE.Material): void {
    const world = this.world;
    const list = props.pebbles.slice();
    // plus a thin scatter of stones over every landmass
    for (const lm of world.landmasses) {
      const n = Math.round(lm.radius * lm.radius * 0.035);
      for (let i = 0; i < n; i++) {
        const a = hash2(i, 1, lm.seed + 41) * Math.PI * 2, r = Math.sqrt(hash2(i, 2, lm.seed + 41)) * lm.radius;
        const x = lm.cx + Math.cos(a) * r, z = lm.cz + Math.sin(a) * r;
        if (world.rimDistance(lm, x, z) < 0.6) continue;
        const y = world.landHeight(lm, x, z);
        if (world.topAt(x, z) > y + 0.01) continue; // something stands here
        const b = world.biomeAt(x, z);
        if (b.ice > 0.3) continue;
        const sc = 0.05 + hash2(i, 3, lm.seed + 41) ** 2 * 0.17;
        list.push({ x, y: y + sc * 0.15, z, s: sc, yaw: a * 5, tint: [0.25 + b.rock * 0.03, 0.245, 0.29], snow: b.snow });
      }
    }
    const geos = [blobGeometry(3, 1, 0.75, 0.6), blobGeometry(11, 1, 0.55, 0.5)];
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler();
    for (let v = 0; v < geos.length; v++) {
      const mine = list.filter((_, i) => i % geos.length === v);
      // shuffle deterministically so lower qualities keep an even subset
      mine.sort((a, b) => hash2(Math.round(a.x * 31), Math.round(a.z * 17), 5) - hash2(Math.round(b.x * 31), Math.round(b.z * 17), 5));
      const mesh = new THREE.InstancedMesh(geos[v], mat, Math.max(1, mine.length));
      mine.forEach((pb, i) => {
        qt.setFromEuler(e.set(Math.sin(pb.yaw) * 0.4, pb.yaw, Math.cos(pb.yaw * 1.7) * 0.4));
        m.compose(p.set(pb.x, pb.y, pb.z), qt, s.set(pb.s, pb.s * 0.8, pb.s * (0.8 + 0.4 * hash1(i, 9))));
        mesh.setMatrixAt(i, m);
        const sn = 1 + pb.snow * 0.5;
        mesh.setColorAt(i, c.setRGB(pb.tint[0] * sn, pb.tint[1] * sn, pb.tint[2] * sn));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = 'pebbles';
      this.pebbleMeshes.push({ mesh, total: mine.length });
      this.root.add(mesh);
    }
    this.stats.pebbles = list.length;
    for (const g of this.pebbleMeshes) g.mesh.count = Math.floor(g.total * this.q.pebbles);
  }

  private buildIcicles(list: { x: number; y: number; z: number; len: number }[], mat: THREE.Material): void {
    if (!list.length) return;
    const g = new Geo();
    g.color([0.2, 0.34, 0.5]).surface(0, 0, 0, 0);
    const SEG = 5;
    const top = g.count;
    for (let i = 0; i < SEG; i++) { const a = (i / SEG) * Math.PI * 2; g.v(Math.cos(a), 0, Math.sin(a), i / SEG, 0); }
    const mid = g.count;
    for (let i = 0; i < SEG; i++) { const a = (i / SEG) * Math.PI * 2 + 0.3; g.v(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5, i / SEG, 0.5); }
    const tip = g.v(0, -1, 0, 0.5, 1);
    g.bridge(top, mid, SEG, true);
    for (let i = 0; i < SEG; i++) g.tri(mid + i, mid + (i + 1) % SEG, tip);
    const mesh = new THREE.InstancedMesh(g.build(), mat, list.length);
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    list.forEach((ic, i) => {
      const r = 0.035 + ic.len * 0.04;
      qt.setFromEuler(e.set((hash1(i, 3) - 0.5) * 0.12, hash1(i, 5) * 6.28, (hash1(i, 7) - 0.5) * 0.12));
      m.compose(p.set(ic.x, ic.y, ic.z), qt, s.set(r, ic.len, r));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'icicles';
    this.root.add(mesh);
    this.stats.icicles = list.length;
  }

  /** Shards of the old world hanging in the haze, far beyond anything reachable. */
  private buildFarRocks(mat: THREE.Material): void {
    const geo = shardGeometry(21, 3);
    const N = 40;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler();
    for (let i = 0; i < N; i++) {
      const a = hash1(i, 61) * Math.PI * 2;
      const d = 480 + Math.pow(hash1(i, 62), 1.3) * 640;
      const size = (12 + hash1(i, 63) ** 2 * 40) * (0.7 + d / 1100);
      const y = -30 + hash1(i, 64) * 120 + (d - 480) * 0.05;
      // ring centred between the two islands
      p.set(Math.cos(a) * d, y, -60 + Math.sin(a) * d);
      qt.setFromEuler(e.set((hash1(i, 65) - 0.5) * 0.12, hash1(i, 66) * 6.28, (hash1(i, 67) - 0.5) * 0.12));
      m.compose(p, qt, s.set(size, size * (0.75 + hash1(i, 68) * 0.8), size * (0.65 + hash1(i, 69) * 0.5)));
      mesh.setMatrixAt(i, m);
      const k = 0.24 + hash1(i, 70) * 0.08;
      mesh.setColorAt(i, c.setRGB(k, k * 0.97, k * 1.16));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = 'far-rocks';
    mesh.count = Math.min(N, this.q.farRocks);
    this.farRocks = mesh;
    this.farRockTotal = N;
    this.root.add(mesh);
  }

  /** Two great chains tethering the hall island to the arena, anchored in the cliffs below both rims. */
  private buildChains(mat: THREE.Material): void {
    const world = this.world;
    const arena = world.landmasses.find((l) => l.kind === 'arena'), hallLm = world.landmasses.find((l) => l.kind === 'hall');
    if (!arena || !hallLm) return;
    const anchor = (lm: Landmass, angle: number, down: number, inset: number) => {
      const r = world.edgeRadius(lm, angle) * inset;
      return new THREE.Vector3(lm.cx + Math.cos(angle) * r, lm.baseY - down, lm.cz + Math.sin(angle) * r);
    };
    const link = new THREE.TorusGeometry(0.62, 0.17, 6, 12);
    link.scale(1.45, 1, 1);
    const mats: THREE.Matrix4[] = [];
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const side of [-1, 1]) {
      const a = anchor(hallLm, Math.PI / 2 + side * 0.52, 8, 0.9);
      const b = anchor(arena, -Math.PI / 2 - side * 0.34, 10, 0.92);
      const len = a.distanceTo(b);
      const n = Math.round(len / 1.42);
      const pt = (t: number, out: THREE.Vector3) => out.copy(a).lerp(b, t).setY(lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * 9);
      const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        pt(i / n, p0); pt((i + 1) / n, p1);
        X.subVectors(p1, p0).normalize();
        Z.crossVectors(X, up).normalize();
        Y.crossVectors(Z, X);
        const m = new THREE.Matrix4().makeBasis(X, Y, Z);
        if (i % 2) m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        m.setPosition(p0.add(p1).multiplyScalar(0.5));
        mats.push(m);
      }
    }
    const mesh = new THREE.InstancedMesh(link, mat, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'chains';
    this.root.add(mesh);
    this.stats.chainLinks = mats.length;
  }

  // ------------------------------------------------------------------------------------------ per frame

  private applyFog(dt: number): void {
    const k = dt <= 0 ? 1 : Math.min(1, dt * 0.6);
    const c = this.fogLinear;
    const target = this.tmpColor.copy(FOG_CLEAR).lerp(FOG_SNOW, clamp01(this.wFog * 0.9 + (this.wSnow - 0.14) * 0.35)).lerp(FOG_STORM, this.wStorm * 0.7);
    if (dt <= 0) c.copy(target); else c.lerp(target, k);
    // lightning lifts the whole haze for an instant
    this.sky.uniforms.uFogCol.value.copy(c).multiplyScalar(1 + this.flash * 0.45);
    // On the direct-to-screen path three.js blends fog after tone mapping, so pre-tone-map it there.
    if (this.level === 'low') acesFilmic(this.fog.color.copy(this.sky.uniforms.uFogCol.value), EXPOSURE);
    else this.fog.color.copy(this.sky.uniforms.uFogCol.value);
    this.fog.density = 0.0019 + this.wFog * 0.0062 + Math.max(0, this.wSnow - 0.14) * 0.0016 + this.wStorm * 0.0008;
  }
  private tmpColor = new THREE.Color();

  private updateLightning(time: number, camera: THREE.PerspectiveCamera, weather: Weather): void {
    const SLOT = 1.9;
    const slot = Math.floor(time / SLOT);
    if (slot !== this.lastSlot) {
      if (this.lastSlot >= 0 && slot === this.lastSlot + 1 && hash1(slot, 911) < weather.storm * 0.62) {
        // reuse the older bolt
        const b = this.bolts[0].start < this.bolts[1].start ? this.bolts[0] : this.bolts[1];
        const a = hash1(slot, 912) * Math.PI * 2, d = 150 + hash1(slot, 913) * 720;
        b.x = Math.cos(a) * d; b.z = -50 + Math.sin(a) * d;
        b.start = slot * SLOT + hash1(slot, 914) * 1.1;
        b.strength = 0.45 + hash1(slot, 915) * 0.55;
        b.radius = 90 + b.strength * 130;
        b.fired = false;
      }
      this.lastSlot = slot;
    }
    let flash = 0, skyW = 0, skyX = 1, skyZ = 0;
    for (let i = 0; i < 2; i++) {
      const b = this.bolts[i];
      const age = time - b.start;
      let env = 0;
      if (age >= 0 && age < 1.6) {
        if (!b.fired) {
          b.fired = true;
          const dist = Math.hypot(b.x - camera.position.x, b.z - camera.position.z, CLOUD_SEA_Y - camera.position.y);
          if (this.onLightning) this.onLightning(dist, b.strength);
        }
        if (this.reduceFlashes) {
          // one slow, dim swell instead of a stutter of hard flashes
          env = 0.3 * Math.sin(Math.min(1, age / 1.6) * Math.PI) ** 2;
        } else {
          const g = (c: number, w: number) => Math.exp(-((age - c) * (age - c)) / w);
          env = Math.max(g(0.04, 0.0012), 0.7 * g(0.17, 0.0016), 0.9 * g(0.3, 0.004)) + 0.25 * Math.exp(-age * 3.2);
        }
        env *= b.strength;
      }
      this.clouds.bolts[i].set(b.x, b.z, b.radius, env * (this.reduceFlashes ? 0.7 : 1.7));
      if (env > 0) {
        const dx = b.x - camera.position.x, dz = b.z - camera.position.z;
        const d = Math.hypot(dx, dz);
        const prox = 1 / (1 + (d / 220) ** 2);
        flash += env * prox;
        if (env * prox >= skyW) { skyW = env * (0.35 + 0.65 * prox); skyX = dx / Math.max(d, 1); skyZ = dz / Math.max(d, 1); }
      }
    }
    this.flash = Math.min(1, flash);
    this.sky.uniforms.uFlash.value.set(skyX, skyZ, 0, skyW * (this.reduceFlashes ? 0.2 : 0.55));
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3, weather: Weather): void {
    if (this.disposed) return;
    dt = Math.min(Math.max(dt, 0), 0.25);
    this.clock = (this.clock + dt) % 14400;
    const sh = this.shared;
    sh.uTime.value = this.clock;
    const wx = Math.cos(weather.windDir), wz = Math.sin(weather.windDir);
    sh.uWind.value.set(wx, wz, weather.wind, this.clock);
    const k = Math.min(1, dt * 0.8);
    this.wFog += (weather.fog - this.wFog) * k;
    this.wStorm += (weather.storm - this.wStorm) * k;
    this.wSnow += (weather.snow - this.wSnow) * k;
    const overcast = clamp01(this.wFog * 0.95 + (this.wSnow - 0.14) * 0.25);
    this.sky.uniforms.uOvercast.value = overcast;
    this.sky.uniforms.uStorm.value = this.wStorm;
    sh.uSparkle.value = (1 - overcast * 0.85) * (1 - this.wStorm * 0.5);
    sh.uSnowfall.value = clamp01((this.wSnow - 0.14) * 1.2);

    this.updateLightning(time, camera, weather);
    this.applyFog(dt);
    this.sky.update(dt, weather);
    const cloudSpeed = 2.5 + weather.wind * 16;
    this.clouds.update(dt, camera, wx * cloudSpeed, wz * cloudSpeed, this.wFog, this.wStorm);
    this.snow.update(dt, weather, this.flash);
    this.crystals.update(this.clock);
    this.lighting.update(dt, this.clock, focus, weather, this.flash, sh);
    this.hall.update(dt, time, camera, weather);
  }

  setQuality(q: QualityLevel, shadows: boolean): void {
    const prev = this.level;
    this.level = q;
    this.q = ENV_QUALITY[q];
    const aniso = Math.min(this.q.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    for (const t of [this.shared.uRockTex.value, this.shared.uDetailTex.value]) if (t && t.anisotropy !== aniso) { t.anisotropy = aniso; t.needsUpdate = true; }
    for (const m of this.surfaceMats) setWarmCount(m, this.q.warmLights);
    this.applyGrassQuality();
    for (const g of this.pebbleMeshes) g.mesh.count = Math.floor(g.total * this.q.pebbles);
    if (this.farRocks) this.farRocks.count = Math.min(this.farRockTotal, this.q.farRocks);
    this.sky.setQuality(this.q);
    this.clouds.setQuality(this.q);
    this.snow.setQuality(this.q);
    this.fires.setQuality(this.q);
    this.renderer.shadowMap.enabled = shadows;
    this.lighting.applyQuality(this.q, shadows);
    for (const o of this.shadowCasters) o.castShadow = shadows;
    if (prev !== q) this.hall.setQuality(q);
    this.applyFog(0);
  }

  setPedestalState(el: ElementId, state: PedestalState): void { this.hall.setPedestalState(el, state); }
  setReduceFlashes(on: boolean): void { this.reduceFlashes = on; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.root);
    this.hall.dispose();
    this.root.remove(this.hall.group);
    const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => mats.add(x)); else if (m) mats.add(m);
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    this.lighting.dispose();
    this.shared.uRockTex.value?.dispose();
    this.shared.uDetailTex.value?.dispose();
    this.envTexture?.dispose();
    for (const tx of this.ownedTextures) tx.dispose();
    if (this.scene.environment === this.envTexture) this.scene.environment = null;
    if (this.scene.fog === this.fog) this.scene.fog = null;
  }
}

export async function createEnvironment(
  scene: THREE.Scene, renderer: THREE.WebGLRenderer, world: World, quality: QualityLevel,
  progress?: (p: number, label: string) => void,
): Promise<Environment> {
  const env = new EnvironmentImpl(scene, renderer, world, quality);
  await env.build(progress ?? (() => {}));
  // match the renderer to the environment's assumptions (the game core may override shadows later via setQuality)
  renderer.shadowMap.enabled = true;
  env.setQuality(quality, true);
  return env;
}

// compile-time check that this module satisfies the contract
import type { EnvironmentModule } from '../../contracts';
const _module: EnvironmentModule = { createEnvironment, createPostFX };
void _module;
