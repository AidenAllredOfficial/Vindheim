// Dev harness for the Hearth-Hall set piece.
//   ?view=door|nave|aisle|fire|gallery|galleryE|seat|throne|back|top|
//         ped-equipped|ped-owned|ped-next|ped-locked|ped-<element>|
//         front|approach|terrace|aerial|side|north|gate|gate-far|ring|ringlow      (default: door)
//   ?q=low|medium|high|ultra      quality (default high)
//   ?ped=ember:equipped,frost:owned,...   or   ?states=eonlllll  (element order; e/o/n/l)
//   ?t=12.5      freeze time (deterministic screenshots)      ?orbit=1   mouse orbit
//   ?bloom=0     no bloom       ?exp=1.0  exposure      ?shadows=0     ?hud=0     ?dummy=0
//   ?wind=0.35   wind strength for banners / smoke
//   ?direct=1    skip the HDR composer and render straight to the canvas (the game's low-quality path)
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getStaticWorld, HALL } from '@shared/world';
import { ELEMENT_ORDER, type ElementId } from '@shared/elements';
import type { Weather } from '@shared/weather';
import type { PedestalState } from '../src/contracts';
import type { QualityLevel } from '../src/settings';
import { buildHall } from '../src/render/env/hall';

const params = new URLSearchParams(location.search);
const quality = (params.get('q') || 'high') as QualityLevel;
const viewName = params.get('view') || 'door';
const frozen = params.has('t') ? Number(params.get('t')) : null;
const direct = params.get('direct') === '1';
const F = HALL.floorY, TY = HALL.terrace.y;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get('exp') || 1);
const shadowsOn = params.get('shadows') !== '0' && quality !== 'low';
renderer.shadowMap.enabled = shadowsOn;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

canvas.addEventListener('webglcontextlost', () => console.warn('[hall] WebGL context lost'));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1830);
scene.fog = new THREE.FogExp2(0x16243d, 0.0055);

// lit like the game: cool dim moon + low blue hemisphere
const moon = new THREE.DirectionalLight(0xa9c2ff, 1.15);
moon.position.set(-46, 70, -100);
moon.target.position.set(0, 20, -150);
moon.castShadow = shadowsOn;
moon.shadow.mapSize.set(2048, 2048);
const sc = moon.shadow.camera;
sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 10; sc.far = 220;
moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.06;
scene.add(moon, moon.target);
scene.add(new THREE.HemisphereLight(0x4a6ea8, 0x1c1e2a, 0.55));

// stand-in ground
const ground = new THREE.Mesh(new THREE.CircleGeometry(38, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xaab8cf, roughness: 1 }));
ground.position.set(HALL.cx, HALL.baseY, HALL.cz);
ground.receiveShadow = true;
scene.add(ground);

const world = getStaticWorld();
const t0 = performance.now();
const hall = buildHall(world, quality);
const buildMs = performance.now() - t0;
scene.add(hall.group);

// ---- pedestal states
const letters: Record<string, PedestalState> = { e: 'equipped', o: 'owned', n: 'next', l: 'locked' };
const states: Record<string, PedestalState> = { ember: 'equipped', frost: 'owned', storm: 'next' };
const st = params.get('states');
if (st) ELEMENT_ORDER.forEach((el, i) => { if (letters[st[i]]) states[el] = letters[st[i]]; });
for (const pair of (params.get('ped') || '').split(',')) {
  const [el, s] = pair.split(':');
  if (el && s) states[el] = s as PedestalState;
}
for (const el of ELEMENT_ORDER) hall.setPedestalState(el, states[el] || 'locked');

// ---- camera + views
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);
type View = { pos: [number, number, number]; look: [number, number, number]; dummy?: [number, number, number] };
const pedView = (el: ElementId): View => {
  const p = world.pedestals[el];
  const face = p.x < 0 ? 1 : -1;
  return { pos: [p.x + face * 4.3, p.y + 1.25, p.z + 1.7], look: [p.x, p.y + 1.25, p.z] };
};
const byState = (s: PedestalState): ElementId => ELEMENT_ORDER.find((el) => (states[el] || 'locked') === s) || 'ember';
const views: Record<string, View> = {
  door: { pos: [0, F + 1.9, -144.9], look: [0, F + 2.3, -166] },
  nave: { pos: [0, F + 2.7, -145.4], look: [0, F + 1.7, -158], dummy: [0, F, -149.9] },
  aisle: { pos: [4.3, F + 2.6, -151.3], look: [4.0, F + 1.6, -161], dummy: [4.3, F, -155.8] },
  gallery: { pos: [-6.6, F + 2.1, -146.6], look: [-9.2, F + 2.0, -166] },
  galleryE: { pos: [6.6, F + 2.1, -146.6], look: [9.2, F + 2.0, -166] },
  seat: { pos: [0, F + 2.3, -168.2], look: [0, F + 2.5, -180] },
  fire: { pos: [5.2, F + 1.7, -153.5], look: [0, F + 1.2, -160] },
  back: { pos: [3.5, F + 2.6, -175.5], look: [-1, F + 2.4, -150] },
  top: { pos: [0, 27.0, -152], look: [0, F, -164] },
  'ped-equipped': pedView(byState('equipped')), 'ped-owned': pedView(byState('owned')), 'ped-next': pedView(byState('next')), 'ped-locked': pedView(byState('locked')),
  front: { pos: [0, TY + 1.9, -121.8], look: [0, 27.5, -150] },
  terrace: { pos: [0, F + 1.9, -141.5], look: [0, 21.5, -119] },
  aerial: { pos: [40, 56, -98], look: [3, 22, -147] },
  side: { pos: [36, 24, -146], look: [0, 27, -160] },
  north: { pos: [-22, 30, -206], look: [0, 28, -165] },
  gate: { pos: [3.6, TY + 1.7, -128.6], look: [0, 22.8, -119.4], dummy: [1.2, TY, -124.6] },
  'gate-far': { pos: [-5, TY + 2.2, -138], look: [0, 22.5, -119.4] },
  ring: { pos: [11.8, 21.6, -124.2], look: [20.5, 18.4, -133.5] },
  ringlow: { pos: [13, TY + 1.8, -135.5], look: [22, 18.6, -132] },
  approach: { pos: [-8.5, TY + 1.9, -124.5], look: [1, 30.5, -150] },
  throne: { pos: [2.6, F + 2.2, -173.2], look: [0, F + 1.9, -178.6] },
};
for (const el of ELEMENT_ORDER) views['ped-' + el] = pedView(el);
const view = views[viewName] || views.door;
camera.position.set(...view.pos);
camera.lookAt(...view.look);
if (view.dummy && params.get('dummy') !== '0') {
  const d = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.08, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a8f9a, roughness: 0.8 }));
  d.position.set(view.dummy[0], view.dummy[1] + 0.9, view.dummy[2]);
  d.castShadow = true;
  scene.add(d);
}
let controls: OrbitControls | null = null;
if (params.get('orbit') === '1') {
  controls = new OrbitControls(camera, canvas);
  controls.target.set(...view.look);
  controls.update();
}

// ---- HDR pipeline: half-float target -> bloom (threshold ~1) -> ACES + sRGB
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.6, 1.0);
if (params.get('bloom') !== '0') composer.addPass(bloom);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const weather: Weather = { snow: 0.3, wind: Number(params.get('wind') || 0.35), windDir: 0.6, storm: 0, aurora: 1, fog: 0, label: 'clear' };
const hud = document.getElementById('hud')!;
if (params.get('hud') === '0') hud.style.display = 'none';
const probe = new THREE.WebGLRenderTarget(64, 64);
const clock = new THREE.Clock();
let frame = 0, acc = 0, fps = 0, last = 0;

function measure(): { calls: number; triangles: number } {
  renderer.info.autoReset = false;
  renderer.info.reset();
  const sh = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(probe);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = sh;
  const r = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  renderer.info.autoReset = true;
  return r;
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, clock.getDelta());
  const time = frozen !== null ? frozen + frame * 0.0001 : clock.elapsedTime;
  hall.update(dt, time, camera, weather);
  controls?.update();
  if (direct) renderer.render(scene, camera); else composer.render(dt);
  frame++;
  acc += dt;
  if (acc > 0.5) { fps = Math.round((frame - last) / acc); last = frame; acc = 0; }
  if (frame === 20 || frame % 120 === 0) {
    const m = measure();
    const s = hall.group.userData.stats as { triangles: number; sprites: number; flames: number; bakeLights: number; ms: { textures: number; geometry: number; bake: number } };
    const hallCalls = m.calls - 1 - (view.dummy && params.get('dummy') !== '0' ? 1 : 0);
    const line = `hall q=${quality} view=${viewName}  draw calls (scene, no shadow pass): ${m.calls} (hall ${hallCalls})  triangles in view: ${m.triangles}  static tris: ${s.triangles}  sprites: ${s.sprites}  flames: ${s.flames}  bake lights: ${s.bakeLights}  build: ${buildMs.toFixed(0)} ms (tex ${s.ms.textures} / geo ${s.ms.geometry} / bake ${s.ms.bake})  fps: ${fps}`;
    hud.textContent = line;
    if (frame === 20) console.log('[hall] ' + line);
  }
}
tick();

Object.assign(window, {
  __hall: {
    hall, scene, camera, renderer, measure, world,
    /**
     * Collision honesty check: counts static hall vertices between shin and head height that stick out
     * more than `proud` metres from every collider footprint (anything a player could expect to bump into).
     */
    audit: (proud = 0.32) => {
      const out: Record<string, number> = {};
      const cols = world.colliders.filter((c) => c.z < -100);
      hall.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry.attributes.aBake) return;
        const p = m.geometry.attributes.position;
        let bad = 0;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          const g = world.topAt(x, z);
          const base = g > -1e8 ? Math.min(g, HALL.floorY) : HALL.baseY;
          if (y < base + 0.42 || y > HALL.baseY + 3.0) continue;
          let ok = false;
          for (const c of cols) {
            if (c.y1 < y - 0.4 || c.y0 > y) continue;
            let d: number;
            if (c.shape === 'cyl') d = Math.hypot(x - c.x, z - c.z) - c.hx;
            else { const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw); const lx = (x - c.x) * cs + (z - c.z) * sn, lz = -(x - c.x) * sn + (z - c.z) * cs; d = Math.max(Math.abs(lx) - c.hx, Math.abs(lz) - c.hz); }
            if (d <= proud) { ok = true; break; }
          }
          if (!ok) bad++;
        }
        if (bad) out[m.name] = bad;
      });
      return out;
    },
    setPed: (el: ElementId, s: PedestalState) => hall.setPedestalState(el, s),
    setQuality: (q: QualityLevel) => hall.setQuality(q),
    look: (px: number, py: number, pz: number, lx: number, ly: number, lz: number) => { camera.position.set(px, py, pz); camera.lookAt(lx, ly, lz); },
  },
});
