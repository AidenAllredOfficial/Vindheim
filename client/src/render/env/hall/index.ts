// The Hearth-Hall set piece: everything built on the hall island (hall inside and out, pedestal
// gallery, terrace, sparring ring, Skygate). Geometry dresses the colliders of shared/world.ts
// exactly; lighting inside is baked into vertex attributes (plus one flickering PointLight for
// the long fire and one accent PointLight in the Skygate).
import * as THREE from 'three';
import type { BuildHall, HallBuild } from '../hallContract';
import type { QualityLevel } from '../../../settings';
import { HALL } from '@shared/world';
import { bakeGeometry, disposePrimitiveCaches, type BakeSetup, type Batch } from './geo';
import { disposeProps, makeKit, type EmitEnv } from './kit';
import { buildTextures } from './textures';
import { coalMaterial, flameMaterial, glyphMaterial, hallStandard, makeUniforms, membraneMaterial, spriteMaterial } from './materials';
import { buildExterior } from './exterior';
import { buildInterior } from './interior';
import { buildGallery } from './gallery';
import { buildOutside } from './outside';
import { Sprites } from './particles';

const QMUL: Record<QualityLevel, number> = { low: 0.45, medium: 0.75, high: 1, ultra: 1.4 };
const SPRITE_CAP: Record<QualityLevel, number> = { low: 500, medium: 1000, high: 1800, ultra: 2800 };
const FIRE_INTENSITY = 48, GATE_INTENSITY = 26;
/** The fire light's reach is kept short so it cannot leak through the walls onto the snow outside. */
const FIRE_REACH = 17;

export const buildHall: BuildHall = (world, quality) => {
  const group = new THREE.Group();
  group.name = 'hearth-hall';
  const t0 = performance.now();
  const T = buildTextures(quality);
  const t1 = performance.now();
  const U = makeUniforms();
  const k = makeKit(world, quality, T);

  buildExterior(k);
  const int = buildInterior(k);
  const gal = buildGallery(k, U);
  const out = buildOutside(k);

  const t2 = performance.now();

  // ---------------------------------------------------------------- materials
  const D = THREE.DoubleSide;
  const mats = {
    woodIn: hallStandard({ map: T.wood.map, normalMap: T.wood.normalMap, roughness: 0.8 }, U),
    woodOut: hallStandard({ map: T.wood.map, normalMap: T.wood.normalMap, roughness: 0.86 }, U, { snow: true }),
    planksIn: hallStandard({ map: T.planks.map, normalMap: T.planks.normalMap, roughness: 0.74 }, U),
    planksOut: hallStandard({ map: T.planks.map, normalMap: T.planks.normalMap, roughness: 0.86, side: D }, U),
    rockIn: hallStandard({ map: T.rock.map, normalMap: T.rock.normalMap, roughness: 0.88 }, U),
    rockOut: hallStandard({ map: T.rock.map, normalMap: T.rock.normalMap, roughness: 0.88 }, U, { snow: true }),
    masonIn: hallStandard({ map: T.masonry.map, normalMap: T.masonry.normalMap, roughness: 0.9 }, U),
    masonOut: hallStandard({ map: T.masonry.map, normalMap: T.masonry.normalMap, roughness: 0.9 }, U, { snow: true }),
    pave: hallStandard({ map: T.paving.map, normalMap: T.paving.normalMap, roughness: 0.85 }, U, { snow: true }),
    roof: hallStandard({ map: T.shingles.map, normalMap: T.shingles.normalMap, roughness: 0.9, side: D }, U, { snow: true }),
    snow: hallStandard({ roughness: 0.82, side: D }, U),
    iron: hallStandard({ roughness: 0.5, metalness: 0.5, side: D }, U),
    carve: hallStandard({ map: T.carve, normalMap: T.carveNormal, roughness: 0.66, metalness: 0.08, side: D }, U),
    cloth: hallStandard({ map: T.cloth, alphaTest: 0.5, roughness: 1, side: D }, U, { sway: true }),
  };
  mats.woodIn.normalScale.set(1.1, 1.1);
  mats.carve.normalScale.set(1.2, 1.2);

  // ---------------------------------------------------------------- bake + meshes
  const setup: BakeSetup = {
    lights: k.lights, occluders: k.occluders,
    ambientIn: [0.085, 0.11, 0.17], ambientOut: [0.03, 0.045, 0.08],
    peds: gal.centres, pedRadius: 6.5, skyIn: 0.05, shadows: quality !== 'low',
  };
  const geos: THREE.BufferGeometry[] = [];
  let tris = 0;
  const add = (name: string, b: Batch, m: THREE.Material, cast: boolean) => {
    if (b.vertexCount === 0) return;
    const g = b.build();
    bakeGeometry(g, b, setup);
    geos.push(g);
    tris += b.triangleCount;
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'hall:' + name;
    mesh.castShadow = cast; mesh.receiveShadow = cast;
    group.add(mesh);
  };
  add('woodIn', k.woodIn, mats.woodIn, false);
  add('woodOut', k.woodOut, mats.woodOut, true);
  add('planksIn', k.planksIn, mats.planksIn, false);
  add('planksOut', k.planksOut, mats.planksOut, true);
  add('rockIn', k.rockIn, mats.rockIn, false);
  add('rockOut', k.rockOut, mats.rockOut, true);
  add('masonIn', k.masonIn, mats.masonIn, false);
  add('masonOut', k.masonOut, mats.masonOut, true);
  add('pave', k.pave, mats.pave, true);
  add('roof', k.roof, mats.roof, true);
  add('snow', k.snow, mats.snow, false);
  add('ironIn', k.ironIn, mats.iron, false);
  add('ironOut', k.ironOut, mats.iron, false);
  add('carveIn', k.carveIn, mats.carve, false);
  add('carveOut', k.carveOut, mats.carve, false);
  add('clothIn', k.clothIn, mats.cloth, false);
  add('clothOut', k.clothOut, mats.cloth, false);

  const coalMat = coalMaterial(T, U);
  const coals = new THREE.Mesh(int.coals, coalMat);
  coals.name = 'hall:coals';
  group.add(coals);
  geos.push(int.coals);

  const glyphMat = glyphMaterial(T, U);
  const glyphGeo = k.glyph.build();
  const glyphs = new THREE.Mesh(glyphGeo, glyphMat);
  glyphs.name = 'hall:glyphs'; glyphs.renderOrder = 3;
  group.add(glyphs);
  geos.push(glyphGeo);

  for (const o of gal.objects) group.add(o);

  const memMat = membraneMaterial(T, U, quality);
  memMat.uniforms.uHalfW.value = HALL.gate.halfWidth + 0.02;
  memMat.uniforms.uSpring.value = out.springRel;
  const membrane = new THREE.Mesh(out.membrane, memMat);
  membrane.name = 'hall:skygate'; membrane.renderOrder = 4;
  group.add(membrane);
  geos.push(out.membrane);

  const flameMat = flameMaterial(T, U, quality);
  const flameGeo = k.flames.build();
  const flames = new THREE.Mesh(flameGeo, flameMat);
  flames.name = 'hall:flames'; flames.frustumCulled = false; flames.renderOrder = 5;
  group.add(flames);
  geos.push(flameGeo);

  const spriteMat = spriteMaterial(T);
  const sprites = new Sprites(SPRITE_CAP[quality], spriteMat);
  sprites.mesh.name = 'hall:sprites';
  group.add(sprites.mesh);

  // ---------------------------------------------------------------- lights (exactly two, fixed)
  const fireLight = new THREE.PointLight(0xffb070, FIRE_INTENSITY, FIRE_REACH, 1.6);
  fireLight.position.set(int.fire[0], int.fire[1], int.fire[2]);
  fireLight.name = 'hall:fireLight';
  const gateLight = new THREE.PointLight(0x58ffd6, GATE_INTENSITY, 22, 1.8);
  gateLight.position.set(out.gate[0], out.gate[1], out.gate[2]);
  gateLight.name = 'hall:gateLight';
  group.add(fireLight, gateLight);
  const lights = [fireLight, gateLight];

  // ---------------------------------------------------------------- per-frame
  const emitters = k.emitters;
  const buildQ = quality;
  let q: QualityLevel = quality;
  let fireZ = 0;
  const env: EmitEnv = { time: 0, dt: 0, cam: new THREE.Vector3(), wind: 0.3, windX: 1, windZ: 0, k: 1 };
  const centre = new THREE.Vector3(HALL.cx, HALL.floorY + 3, (HALL.minZ + HALL.gate.z) / 2);
  group.userData.stats = {
    triangles: tris, sprites: 0, flames: k.flames.count, bakeLights: k.lights.length,
    ms: { textures: Math.round(t1 - t0), geometry: Math.round(t2 - t1), bake: Math.round(performance.now() - t2) },
    textureMs: T.timing,
  };

  const hall: HallBuild = {
    group, lights,
    update(dt, time, camera, weather) {
      U.uTime.value = time;
      const fl = 1 + 0.1 * Math.sin(time * 10.7) * Math.sin(time * 3.3 + 1) + 0.045 * Math.sin(time * 23.1) + 0.05 * Math.sin(time * 1.7 + 2);
      U.uFlick.value = fl;
      U.uWind.value = weather.wind;
      fireLight.intensity = FIRE_INTENSITY * fl * fl;
      // the fire is ten metres long but the budget is one light: slide it along the pit toward the viewer
      const want = THREE.MathUtils.clamp(camera.position.z - int.fire[2], -int.fireHalf, int.fireHalf);
      fireZ += (want - fireZ) * (1 - Math.exp(-dt * 2.5));
      fireLight.position.set(int.fire[0] + Math.sin(time * 7.3) * 0.12, int.fire[1] + Math.sin(time * 9.1) * 0.08, int.fire[2] + fireZ + Math.sin(time * 5.7) * 0.2);
      gateLight.intensity = GATE_INTENSITY * (0.85 + 0.15 * Math.sin(time * 1.3) + 0.06 * Math.sin(time * 7.1));
      env.time = time; env.dt = dt;
      env.cam.copy(camera.position);
      env.wind = weather.wind; env.windX = Math.cos(weather.windDir); env.windZ = Math.sin(weather.windDir);
      const dist = camera.position.distanceTo(centre);
      env.k = (QMUL[q] / QMUL[buildQ]) * THREE.MathUtils.clamp(1.7 - dist / 90, 0.35, 1);
      sprites.begin();
      gal.update(dt, time, dist < 75 ? sprites : null, env);
      for (let i = 0; i < emitters.length; i++) emitters[i](sprites, env);
      sprites.end();
      (group.userData.stats as { sprites: number }).sprites = sprites.count;
    },
    setPedestalState(el, state) { gal.setState(el, state); },
    setQuality(nq) {
      if (nq === q) return;
      q = nq;
      const lod = nq === 'low' ? 0 : nq === 'medium' ? 1 : 2;
      if (flameMat.defines.FLAME_LOD !== lod) { flameMat.defines.FLAME_LOD = lod; flameMat.needsUpdate = true; }
      if (memMat.defines.GATE_LOD !== lod) { memMat.defines.GATE_LOD = lod; memMat.needsUpdate = true; }
      flameGeo.instanceCount = Math.max(8, Math.round(k.flames.count * Math.min(1, QMUL[nq] / QMUL[buildQ])));
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of Object.values(mats)) m.dispose();
      for (const m of [coalMat, glyphMat, memMat, flameMat, spriteMat]) m.dispose();
      sprites.dispose();
      gal.dispose();
      T.dispose();
      disposeProps();
      disposePrimitiveCaches();
      group.removeFromParent();
    },
  };
  return hall;
};
