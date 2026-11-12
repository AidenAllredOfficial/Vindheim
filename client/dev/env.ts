// Dev harness for the environment subsystem: the whole world with a free camera, screenshot
// presets, quality / weather switches and renderer statistics.
//   ?view=<name>  ?q=low|medium|high|ultra  ?weather=clear|snow|blizzard|storm|auto  ?t=<seconds>
//   ?p=x,z,yawDeg[,pitchDeg]  third-person framing at a spot   ?cam=x,y,z,lx,ly,lz  explicit camera
//   ?fx=impact|hurt|danger|frost|kick|desat   ?hud=0   ?dummy=0   ?shadows=0   ?bloom=0   ?fov=72
import * as THREE from 'three';
import { colliderContains, getStaticWorld, HALL } from '@shared/world';
import { weatherAt, type Weather } from '@shared/weather';
import { dirFromYawPitch } from '@shared/math';
import type { QualityLevel } from '../src/settings';
import { createEnvironment, createPostFX } from '../src/render/env';

const params = new URLSearchParams(location.search);
const QUALITIES: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
let quality = (QUALITIES.includes(params.get('q') as QualityLevel) ? params.get('q') : 'high') as QualityLevel;
let weatherName = params.get('weather') || 'clear';
const showHud = params.get('hud') !== '0';
const world = getStaticWorld();

const WEATHERS: Record<string, Weather> = {
  clear: { snow: 0.14, wind: 0.24, windDir: 0.7, storm: 0, aurora: 1, fog: 0, label: 'clear' },
  snow: { snow: 0.62, wind: 0.46, windDir: 0.4, storm: 0, aurora: 0.5, fog: 0.4, label: 'snow' },
  blizzard: { snow: 1, wind: 0.92, windDir: 0.2, storm: 0.1, aurora: 0.1, fog: 0.78, label: 'blizzard' },
  storm: { snow: 0.3, wind: 0.7, windDir: 2.4, storm: 1, aurora: 0.12, fog: 0.35, label: 'storm' },
};

type View = { cam?: number[]; p?: number[] };
// p = [x, z, yawDeg, pitchDeg]: a 1.8 m fighter standing there, camera 4.5 m behind and 1 m above the head
const VIEWS: Record<string, View> = {
  aerial: { cam: [165, 92, 78, 0, 4, -72] },
  title: { cam: [-118, 46, 104, 0, 2, -34] },
  top: { cam: [0, 190, 30, 0, 0, -30] },
  centre: { p: [2.5, 19, 5, 4] },
  highlands: { p: [-17, -17, 0, 8] },
  tier: { p: [2, -38, 180, -8] },
  lake: { p: [23, 5, -80, 2] },
  ship: { p: [33.5, 1.5, -44, 6] },
  ruins: { p: [4, 20, 180, 6] },
  ruinsin: { p: [3, 41, 150, 4] },
  chasm: { p: [-16, 21, 70, -6] },
  chasmtop: { cam: [-20, 14, 44, -27, -8, 27] },
  islet: { p: [-53, 2.5, 90, -2] },
  frostholm: { p: [55, 7.5, -90, -2] },
  laststep: { p: [8.5, 57, 178, -4] },
  woods: { p: [-40, 24, 60, 4] },
  terrace: { p: [0, -127, 180, -14] },
  uphall: { p: [-7, -27, 2, 24] },
  under: { cam: [-128, -20, 96, 0, -6, -40] },
  hall: { p: [0, -158, 180, 0] },
  shrine: { p: [-24, 14, 60, 0] },
  raven: { p: [-80, 6, 250, 0] },
  peak: { p: [5, -44.5, 200, -14] },
};
const VIEW_KEYS = ['aerial', 'centre', 'highlands', 'lake', 'ruins', 'chasm', 'islet', 'terrace', 'uphall'];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const load = document.getElementById('load') as HTMLDivElement;
if (!showHud) { hud.style.display = 'none'; (document.getElementById('help') as HTMLElement).style.display = 'none'; }

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') || 72), 1, 0.15, 3200);
const focus = new THREE.Vector3();
let yaw = 0, pitch = 0;

// a stand-in fighter so scale and lighting on a character can be judged
const dummy = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.08, 6, 14), new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.75 }));
  body.position.y = 0.9; body.castShadow = true; body.receiveShadow = true;
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.15, 12), new THREE.MeshStandardMaterial({ color: 0x4a1612, roughness: 0.9 }));
  cloak.position.set(0, 0.95, 0.12); cloak.castShadow = true;
  dummy.add(body, cloak);
  dummy.visible = false;
  scene.add(dummy);
}

function setView(name: string): void {
  const v = VIEWS[name];
  if (!v) return;
  if (v.cam) applyCam(v.cam);
  else if (v.p) applyPlayer(v.p);
}
function applyCam(c: number[]): void {
  camera.position.set(c[0], c[1], c[2]);
  const d = new THREE.Vector3(c[3] - c[0], c[4] - c[1], c[5] - c[2]).normalize();
  yaw = Math.atan2(-d.x, -d.z); pitch = Math.asin(d.y);
  focus.set(c[3], c[4], c[5]);
  dummy.visible = false;
}
function applyPlayer(p: number[]): void {
  const x = p[0], z = p[1];
  yaw = (p[2] || 0) * Math.PI / 180; pitch = (p[3] || 0) * Math.PI / 180;
  const inHall = x > HALL.minX && x < HALL.maxX && z > HALL.minZ && z < HALL.maxZ;
  const y = inHall ? world.ground(x, z, HALL.floorY + 0.4).y : world.topAt(x, z);
  const f = dirFromYawPitch(yaw, 0);
  camera.position.set(x - f.x * 4.5, y + 2.8, z - f.z * 4.5);
  focus.set(x, y + 1, z);
  dummy.position.set(x, y, z);
  dummy.rotation.y = yaw;
  dummy.visible = params.get('dummy') !== '0';
}

const post = createPostFX(renderer, quality);
function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  post.setSize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const keys = new Set<string>();
let dragging = false;
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  const n = Number(e.key);
  if (n >= 1 && n <= 9) setView(VIEW_KEYS[n - 1]);
  if (e.code === 'BracketRight') setQ(QUALITIES[Math.min(3, QUALITIES.indexOf(quality) + 1)]);
  if (e.code === 'BracketLeft') setQ(QUALITIES[Math.max(0, QUALITIES.indexOf(quality) - 1)]);
  if (e.code === 'Backslash') { const k = [...Object.keys(WEATHERS), 'auto']; weatherName = k[(k.indexOf(weatherName) + 1) % k.length]; }
  if (e.code === 'KeyF') { post.impact(1); post.kick(1); post.hurt(0.8); }
  if (e.code === 'KeyH') hud.style.display = hud.style.display === 'none' ? '' : 'none';
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('pointerdown', () => { dragging = true; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= e.movementX * 0.004; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.004));
});

let env: Awaited<ReturnType<typeof createEnvironment>> | null = null;
function setQ(q: QualityLevel): void {
  quality = q;
  post.setQuality(q, params.get('bloom') !== '0');
  env?.setQuality(q, params.get('shadows') !== '0');
}

const t0 = Number(params.get('t') || 0);
let time = t0, last = performance.now(), frame = 0, fpsAcc = 0, fpsN = 0, fps = 0;
const stat = { calls: 0, tris: 0 };

function tick(now: number): void {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  if (!env) return;
  // free camera
  const sp = (keys.has('ShiftLeft') ? 60 : 12) * dt;
  const f = dirFromYawPitch(yaw, pitch), r = dirFromYawPitch(yaw - Math.PI / 2, 0);
  let moved = false;
  const mv = (x: number, y: number, z: number, k: number) => { camera.position.x += x * k; camera.position.y += y * k; camera.position.z += z * k; moved = true; };
  if (keys.has('KeyW')) mv(f.x, f.y, f.z, sp);
  if (keys.has('KeyS')) mv(f.x, f.y, f.z, -sp);
  if (keys.has('KeyD')) mv(r.x, 0, r.z, sp);
  if (keys.has('KeyA')) mv(r.x, 0, r.z, -sp);
  if (keys.has('KeyE')) mv(0, 1, 0, sp);
  if (keys.has('KeyQ')) mv(0, 1, 0, -sp);
  if (moved) { focus.copy(camera.position).addScaledVector(new THREE.Vector3(f.x, f.y, f.z), 6); dummy.visible = false; }
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.updateMatrixWorld();

  const weather = weatherName === 'auto' ? weatherAt(time) : WEATHERS[weatherName] || WEATHERS.clear;
  const fx = params.get('fx');
  if (fx === 'danger') post.setDanger(1);
  if (fx === 'frost') post.setFrost(1);
  if (fx === 'desat') post.setDesaturate(1);
  if (fx === 'impact' && frame % 30 === 0) post.impact(1);
  if (fx === 'hurt' && frame % 30 === 0) post.hurt(1);
  if (fx === 'kick' && frame % 20 === 0) post.kick(1);

  renderer.info.reset();
  env.update(dt, time, camera, focus, weather);
  post.render(scene, camera, dt);
  stat.calls = renderer.info.render.calls; stat.tris = renderer.info.render.triangles;
  frame++;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (showHud && frame % 10 === 0) {
    hud.textContent = `q ${quality}  weather ${weatherName}  fps ${fps.toFixed(0)}\ncalls ${stat.calls}  tris ${(stat.tris / 1000).toFixed(0)}k\ngeo ${renderer.info.memory.geometries}  tex ${renderer.info.memory.textures}  programs ${renderer.info.programs?.length ?? 0}\ncam ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}  yaw ${(yaw * 180 / Math.PI).toFixed(0)} pitch ${(pitch * 180 / Math.PI).toFixed(0)}`;
  }
  if (frame === 20 || frame === 120) {
    console.log(`[env] q=${quality} view=${params.get('view') || 'aerial'} frame=${frame} draw calls=${stat.calls} triangles=${stat.tris} programs=${renderer.info.programs?.length ?? 0} textures=${renderer.info.memory.textures} geometries=${renderer.info.memory.geometries} fps=${fps.toFixed(1)}`);
  }
}

/**
 * "What you see is what you collide with" audit: drop rays on random spots of the arena and
 * compare the first visible solid surface with the physics top (world.topAt). Canopies, banners,
 * braziers, pebbles and glow decals are excluded (purely visual by design).
 */
function verify(samples = 1500): unknown {
  const targets: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const n = o.name || '';
    if (n.startsWith('terrain-') || n.startsWith('cliff-') || n.startsWith('props-stone') || n.startsWith('props-wood') || n.startsWith('props-ice')) targets.push(o);
  });
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
  const bins = { exact2cm: 0, within10cm: 0, within30cm: 0, over30cm: 0, bothVoid: 0, phantomNearSurface: 0, missingSurface: 0, skippedTree: 0, edgeBand: 0 };
  const missing: unknown[] = [];
  const worst: { x: number; z: number; world: number; seen: number; kind: string }[] = [];
  const byKind: Record<string, { n: number; max: number }> = {};
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const hit: THREE.Intersection[] = [];
  for (let i = 0; i < samples; i++) {
    const x = -95 + rnd() * 190, z = -72 + rnd() * 170;
    const g = world.ground(x, z, 1e6);
    if (g.collider && g.collider.kind === 'tree') { bins.skippedTree++; continue; }
    // the outer 0.3 m of a footprint is bevel / stand-on margin: judged separately
    if (g.collider && !colliderContains(g.collider, x, z, -0.3)) { bins.edgeBand++; continue; }
    const wy = g.y;
    from.set(x, 90, z);
    ray.set(from, down);
    hit.length = 0;
    ray.intersectObjects(targets, false, hit);
    const sy = hit.length ? hit[0].point.y : -1e9;
    const kind = g.collider ? g.collider.kind : 'terrain';
    if (wy < -1e8) {
      if (sy < -1e8) bins.bothVoid++;
      else if (sy > -3) { bins.phantomNearSurface++; if (worst.length < 400) worst.push({ x, z, world: NaN, seen: sy, kind: 'void' }); }
      else bins.bothVoid++; // cliff / underside far below the rim
      continue;
    }
    if (sy < -1e8) { bins.missingSurface++; missing.push({ x: +x.toFixed(2), z: +z.toFixed(2), world: +wy.toFixed(2), kind, rim: world.landmassAt(x, z) ? +world.rimDistance(world.landmassAt(x, z)!, x, z).toFixed(3) : null }); continue; }
    const d = Math.abs(sy - wy);
    if (d <= 0.02) bins.exact2cm++; else if (d <= 0.1) bins.within10cm++; else if (d <= 0.3) bins.within30cm++; else { bins.over30cm++; worst.push({ x, z, world: wy, seen: sy, kind }); }
    const k = (byKind[kind] ||= { n: 0, max: 0 });
    k.n++; if (d > k.max) k.max = d;
  }
  worst.sort((a, b) => Math.abs((b.seen || 0) - (b.world || 0)) - Math.abs((a.seen || 0) - (a.world || 0)));
  return { bins, byKind, missing, worst: worst.slice(0, 14).map((w) => ({ x: +w.x.toFixed(1), z: +w.z.toFixed(1), world: +w.world.toFixed(2), seen: +w.seen.toFixed(2), kind: w.kind })) };
}

(async () => {
  const tBuild = performance.now();
  env = await createEnvironment(scene, renderer, world, quality, (p, label) => { load.textContent = `${label.toUpperCase()}  ${(p * 100).toFixed(0)}%`; });
  env.onLightning = (d, s) => console.log(`[env] lightning ${d.toFixed(0)} m, strength ${s.toFixed(2)}`);
  setQ(quality);
  console.log(`[env] built in ${(performance.now() - tBuild).toFixed(0)} ms`, JSON.stringify((env as unknown as { stats: unknown }).stats));
  load.remove();
  if (params.get('cam')) applyCam(params.get('cam')!.split(',').map(Number));
  else if (params.get('p')) applyPlayer(params.get('p')!.split(',').map(Number));
  else setView(params.get('view') || 'aerial');
  Object.assign(window, { __env: { env, post, scene, camera, renderer, setView, setQ, world, HALL, cam: applyCam, p: applyPlayer, verify, now: () => time, setWeather: (w: string) => { weatherName = w; }, stat } });
  requestAnimationFrame(tick);
})().catch((e) => { console.error(e); load.textContent = String(e); });
