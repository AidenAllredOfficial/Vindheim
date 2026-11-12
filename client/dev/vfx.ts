// Effects harness. A dusk-lit patch of the real World, stand-in capsule fighters and a small
// driver that replays what the game core would send to the effects layer:
//   castStart -> (wind-up) -> castRelease -> spawnEntity / fx -> live entity updates -> despawn / hit …
// See vfx.html for the URL parameters.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getStaticWorld, VOID, type World } from '@shared/world';
import { ELEMENTS, ELEMENT_ORDER, ZONES, elementIndex, type AbilityDef, type ElementId, type EntityKind } from '@shared/elements';
import { MV_DASH, MV_GLIDE, MV_LEAP, MV_NONE, MV_RAY, MV_SOAR, MV_SURGE, type EntityState, type GameEvent } from '@shared/types';
import { dirFromYawPitch, yawFromDir } from '@shared/math';
import type { FighterLookup, PlayerView, SocketName, Vfx } from '../src/contracts';
import type { QualityLevel } from '../src/settings';
import { createVfx } from '../src/render/vfx/index';
import { reseed } from '../src/render/vfx/core/rand';

const params = new URLSearchParams(location.search);
const P = (k: string, d = '') => params.get(k) ?? d;
const quality = (P('q', 'high') as QualityLevel);
const surface = P('surface', 'grass');
const freezeT = params.has('t') ? parseFloat(P('t')) : -1;
const sheet = params.has('sheet') ? P('sheet').split(',').map(parseFloat) : null;
const camMode = P('cam', 'third');
let whyParam = params.has('why') ? parseInt(P('why')) : -1;

// ------------------------------------------------------------------------------------ renderer
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1424);
scene.fog = new THREE.FogExp2(0x16223a, 0.0075);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 600);

const moon = new THREE.DirectionalLight(0xbcd0ff, 1.5);
moon.position.set(30, 60, 24);
scene.add(moon, moon.target);
scene.add(new THREE.HemisphereLight(0x5c76a8, 0x2c2622, 1.0));
const rimLight = new THREE.DirectionalLight(0xff9a5a, 0.35);
rimLight.position.set(-40, 8, -30);
scene.add(rimLight);

let W = 1280, H = 720;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.5, 0.35, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const useComposer = quality !== 'low' || params.has('bloom');

function resize(w: number, h: number): void {
  W = w; H = h;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------------------------ world patch
const world: World = getStaticWorld();

function findSpot(surf: string): { x: number; z: number } {
  // scan the arena for the most open stretch of the wanted surface
  let best = { x: 0, z: 0 }, bestScore = -1e9;
  for (let x = -54; x <= 54; x += 3) for (let z = -54; z <= 54; z += 3) {
    if (world.terrainHeight(x, z) <= VOID * 0.5) continue;
    let score = 0, n = 0;
    for (let dx = -14; dx <= 14; dx += 3.5) for (let dz = -14; dz <= 14; dz += 3.5) {
      n++;
      const h = world.terrainHeight(x + dx, z + dz);
      if (h <= VOID * 0.5) { score -= 0.5; continue; }
      if (world.terrainSurface(x + dx, z + dz) === surf) score += 1;
    }
    score /= n;
    for (const cl of world.colliders) { const d = Math.hypot(cl.x - x, cl.z - z) - Math.max(cl.hx, cl.hz); if (d < 16) score -= 0.12 * (1 - Math.max(0, d) / 16); }
    if (score > bestScore) { bestScore = score; best = { x, z }; }
  }
  return best;
}
const spot = findSpot(surface);

function buildGround(): void {
  const N = 140, size = 140, half = size / 2;
  const geo = new THREE.PlaneGeometry(size, size, N, N).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x4c5631), cSnow = new THREE.Color(0xc4d2e4), cIce = new THREE.Color(0x86bcd8), cRock = new THREE.Color(0x56545e), cDirt = new THREE.Color(0x4b4033);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + spot.x, z = pos.getZ(i) + spot.z;
    let h = world.terrainHeight(x, z);
    if (h <= VOID * 0.5) h = -80;
    pos.setXYZ(i, x, h, z);
    const b = world.biomeAt(x, z);
    c.copy(cGrass).lerp(cDirt, b.dirt).lerp(cRock, b.rock).lerp(cSnow, b.snow).lerp(cIce, b.ice);
    const n = 0.9 + 0.2 * (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 % 1);
    col[i * 3] = c.r * n; col[i * 3 + 1] = c.g * n; col[i * 3 + 2] = c.b * n;
  }
  void half;
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })));
  // colliders near the patch, as plain grey solids (context + something for decals to respect)
  const mat = new THREE.MeshStandardMaterial({ color: 0x5c5a66, roughness: 0.9 });
  for (const cl of world.colliders) {
    if (Math.abs(cl.x - spot.x) > 70 || Math.abs(cl.z - spot.z) > 70) continue;
    const h = cl.y1 - cl.y0;
    if (h <= 0 || h > 60) continue;
    const g = cl.shape === 'cyl' ? new THREE.CylinderGeometry(cl.hx, cl.hx, h, 14) : new THREE.BoxGeometry(cl.hx * 2, h, cl.hz * 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(cl.x, cl.y0 + h / 2, cl.z);
    m.rotation.y = -cl.yaw;
    scene.add(m);
  }
}
buildGround();

// ------------------------------------------------------------------------------------ fighters
interface Dummy extends PlayerView {
  mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial;
  hx: number; hz: number; hyaw: number;   // home
  burnT: number; chillT: number; frozenT: number; shockT: number; rootT: number; bubbleT: number; stealthT: number; invT: number;
  mvT: number; respawnT: number; returnT: number;
}
const dummies: Dummy[] = [];
const capsule = new THREE.CapsuleGeometry(0.42, 0.96, 6, 14).translate(0, 0.9, 0);
const nose = new THREE.BoxGeometry(0.16, 0.16, 0.5).translate(0, 1.45, -0.42);

function addFighter(id: number, element: ElementId, x: number, z: number, yaw: number, isLocal = false): Dummy {
  const mat = new THREE.MeshStandardMaterial({ color: 0x39414f, roughness: 0.65, emissive: new THREE.Color(ELEMENTS[element].color), emissiveIntensity: 0.12, transparent: true });
  const mesh = new THREE.Mesh(capsule, mat);
  mesh.add(new THREE.Mesh(nose, mat));
  scene.add(mesh);
  const d: Dummy = {
    id, name: 'F' + id, seed: id * 7919, element, isLocal, isBot: !isLocal, isDummy: false,
    x, y: world.topAt(x, z), z, vx: 0, vy: 0, vz: 0, face: yaw, aimYaw: yaw, aimPitch: 0, onGround: true, alive: true, hp: 100, inHall: false,
    act: -1, actT: 0, mv: MV_NONE, stun: 0, launched: false, down: 0, invuln: false,
    burning: false, chill: 0, frozen: false, shocked: false, rooted: false, slowed: false, bubbled: false, stealth: false, visible: true,
    mesh, mat, hx: x, hz: z, hyaw: yaw,
    burnT: 0, chillT: 0, frozenT: 0, shockT: 0, rootT: 0, bubbleT: 0, stealthT: 0, invT: 0, mvT: 0, respawnT: 0, returnT: 0,
  };
  dummies.push(d);
  return d;
}

const tmpV = new THREE.Vector3();
const lookup: FighterLookup = {
  get: (id) => dummies.find((d) => d.id === id),
  socket(id: number, name: SocketName, out: THREE.Vector3): THREE.Vector3 {
    const d = dummies.find((q) => q.id === id);
    if (!d) return out.set(0, 0, 0);
    const fx = -Math.sin(d.face), fz = -Math.cos(d.face), rx = -fz, rz = fx; // forward, right
    switch (name) {
      case 'feet': return out.set(d.x, d.y, d.z);
      case 'head': return out.set(d.x, d.y + 1.65, d.z);
      case 'chest': return out.set(d.x, d.y + 1.1, d.z);
      case 'handL': return out.set(d.x - rx * 0.45 + fx * 0.3, d.y + 1.15, d.z - rz * 0.45 + fz * 0.3);
      case 'weaponBase': case 'handR': return out.set(d.x + rx * 0.45 + fx * 0.3, d.y + 1.15, d.z + rz * 0.45 + fz * 0.3);
      default: return out.set(d.x + rx * 0.45 + fx * 1.05, d.y + 1.4, d.z + rz * 0.45 + fz * 1.05);
    }
  },
  all: () => dummies,
};

const vfx: Vfx = createVfx(scene, world, lookup, quality);

// ------------------------------------------------------------------------------------ mini simulation
let simT = 0;
let nextId = 1;
interface Ent { e: EntityState; done: boolean; tick: (en: Ent, dt: number) => void; data: number }
let ents: Ent[] = [];
let timers: { t: number; fn: () => void }[] = [];
const at = (delay: number, fn: () => void) => { timers.push({ t: simT + delay, fn }); };

function mkEnt(k: EntityKind, owner: Dummy, x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, life: number, extra: Partial<EntityState>, tick: Ent['tick']): Ent {
  const e: EntityState = { id: nextId++, k, o: owner.id, el: elementIndex(owner.element), x, y, z, vx, vy, vz, yaw: 0, r, life, age: 0, g: 0, p: 0, q: 0, ...extra };
  const en: Ent = { e, done: false, tick, data: 0 };
  ents.push(en);
  vfx.spawnEntity(e);
  return en;
}
function despawn(en: Ent, why: 0 | 1 | 2 | 3 | 4, x = en.e.x, y = en.e.y, z = en.e.z): void {
  if (en.done) return;
  en.done = true;
  vfx.despawnEntity(en.e.id, x, y, z, why);
}
const groundAt = (x: number, z: number, ref = 1e6) => { const g = world.ground(x, z, ref).y; return g <= VOID * 0.5 ? -80 : g; };
const chestY = 1.1;

function emitHit(target: Dummy, src: Dummy, key: string, dmg: number, heavy: boolean, dx: number, dy: number, dz: number, eid = 0, crit = false): void {
  if (!target.alive) return;
  target.hp -= dmg;
  const kill = target.hp <= 0;
  const l = Math.hypot(dx, dy, dz) || 1;
  const ev: GameEvent = { e: 'hit', t: target.id, s: src.id, eid, k: key, el: elementIndex(src.element), dmg, x: target.x - (dx / l) * 0.35, y: target.y + chestY, z: target.z - (dz / l) * 0.35, dx: dx / l, dy: dy / l, dz: dz / l, heavy: heavy ? 1 : 0, crit: crit ? 1 : 0, kill: kill ? 1 : 0 };
  vfx.onEvent(ev);
  if (target.frozen) { target.frozen = false; target.frozenT = 0; vfx.onEvent({ e: 'pop', p: target.id, k: 'freeze', x: target.x, y: target.y + 1, z: target.z }); }
  if (target.bubbled) { target.bubbled = false; target.bubbleT = 0; vfx.onEvent({ e: 'pop', p: target.id, k: 'bubble', x: target.x, y: target.y + 1, z: target.z }); }
  if (kill) {
    target.alive = false; target.visible = false; target.respawnT = 2.2;
    vfx.onEvent({ e: 'death', p: target.id, killer: src.id, k: key, fall: 0, x: target.x, y: target.y, z: target.z });
    return;
  }
  const kb = heavy ? 7 : 2.5;
  target.vx = (dx / l) * kb; target.vz = (dz / l) * kb; target.vy = heavy ? 8 : 2.5;
  target.launched = heavy; target.onGround = false; target.stun = 0.3; target.returnT = 1.6;
}
function applyStatus(t: Dummy, k: string, secs: number): void {
  if (k === 'burn') t.burnT = secs;
  else if (k === 'chill') { t.chill = Math.min(4, t.chill + 1); t.chillT = secs; if (t.chill >= 4) { t.chill = 0; t.frozenT = 1.3; } }
  else if (k === 'freeze') t.frozenT = secs;
  else if (k === 'shock') t.shockT = secs;
  else if (k === 'root') t.rootT = secs;
  else if (k === 'bubble') t.bubbleT = secs;
}
function hitSpec(target: Dummy, src: Dummy, key: string, h: { dmg: number; heavy?: boolean; status?: { k: string; t: number }[] }, dx: number, dy: number, dz: number, eid = 0): void {
  emitHit(target, src, key, h.dmg, !!h.heavy, dx, dy, dz, eid);
  if (h.status) for (const s of h.status) applyStatus(target, s.k, s.t);
}
const others = (src: Dummy) => dummies.filter((d) => d !== src && d.alive);

function projTick(def: AbilityDef, src: Dummy) {
  const fx = def.fx as Extract<AbilityDef['fx'], { t: 'proj' }>;
  return (en: Ent, dt: number) => {
    const e = en.e;
    e.vy -= e.g * dt;
    e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
    if (whyParam !== 0 && whyParam !== 1) for (const t of others(src)) {
      const d = Math.hypot(t.x - e.x, t.y + chestY - e.y, t.z - e.z);
      if (d < e.r + 0.55 && en.data !== t.id) {
        hitSpec(t, src, def.key, fx.hit, e.vx, e.vy * 0.3, e.vz, e.id);
        if (fx.special === 'bubble') t.bubbleT = 1.9;
        if (fx.special === 'swap') {
          const l = Math.hypot(e.vx, e.vz) || 1;
          const nx = t.x + (e.vx / l) * 1.4, nz = t.z + (e.vz / l) * 1.4;
          vfx.onEvent({ e: 'tp', p: src.id, k: 'duskstep', x: src.x, y: src.y, z: src.z, x2: nx, y2: groundAt(nx, nz), z2: nz });
          src.x = nx; src.z = nz; src.y = groundAt(nx, nz); src.face = yawFromDir(t.x - nx, t.z - nz); src.aimYaw = src.face; src.returnT = 1.4;
        }
        if (fx.pierce) { en.data = t.id; continue; }
        if (fx.explode) for (const o of others(src)) if (o !== t && Math.hypot(o.x - e.x, o.z - e.z) < fx.explode.r) hitSpec(o, src, def.key, fx.explode.hit, o.x - e.x, 0.3, o.z - e.z);
        despawn(en, fx.special === 'orb' ? 3 : 2);
        return;
      }
    }
    if (world.solidAt(e.x, e.y, e.z, e.r * 0.6)) { despawn(en, fx.special === 'orb' ? 3 : 1); return; }
    if (e.age >= e.life) despawn(en, fx.special === 'orb' ? 3 : 0);
  };
}

function aimAt(src: Dummy, tx: number, ty: number, tz: number): { x: number; y: number; z: number } {
  const dx = tx - src.x, dy = ty - (src.y + chestY), dz = tz - src.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  src.aimYaw = yawFromDir(dx, dz); src.aimPitch = Math.asin(dy / l); src.face = src.aimYaw;
  return { x: dx / l, y: dy / l, z: dz / l };
}

function zoneEnt(k: EntityKind, src: Dummy, x: number, z: number, extra: Partial<EntityState> = {}): Ent {
  const zd = ZONES[k]!;
  return mkEnt(k, src, x, groundAt(x, z, src.y + 3), z, 0, 0, 0, zd.radius, zd.life, { p: zd.arm || 0, ...extra }, (en) => {
    if (en.e.age >= en.e.life) despawn(en, 0);
  });
}

/** Perform one ability the way the game would. Returns the time until the whole thing is over. */
function cast(src: Dummy, slot: number, target: Dummy): number {
  const def = ELEMENTS[src.element].abilities[slot];
  const fx = def.fx;
  const aim = aimAt(src, target.x, target.y + chestY, target.z);
  src.act = slot; src.actT = 0;
  vfx.castStart(src, slot);
  let extra = 1.0;
  let charge: Ent | null = null;
  if (fx.t === 'beam' && fx.ent === 'sunlance') {
    charge = mkEnt('sunlance', src, src.x, src.y + chestY, src.z, aim.x, aim.y, aim.z, 0, def.windup, { p: fx.range, q: fx.width }, (en) => {
      const a = dirFromYawPitch(src.aimYaw, src.aimPitch);
      en.e.x = src.x; en.e.y = src.y + chestY; en.e.z = src.z; en.e.vx = a.x; en.e.vy = a.y; en.e.vz = a.z;
    });
  }
  at(def.windup, () => {
    const a = dirFromYawPitch(src.aimYaw, src.aimPitch);
    const ox = src.x + a.x * 0.7, oy = src.y + chestY + a.y * 0.7, oz = src.z + a.z * 0.7;
    vfx.castRelease(src, slot);
    switch (fx.t) {
      case 'melee': {
        for (const t of others(src)) if (Math.hypot(t.x - src.x, t.z - src.z) < fx.range + 0.4) hitSpec(t, src, def.key, fx.hit, fx.pull ? -a.x : a.x, 0.2, fx.pull ? -a.z : a.z);
        break;
      }
      case 'proj': {
        const n = fx.count || 1, burst = fx.burst || 1;
        for (let b = 0; b < burst; b++) at(b * (fx.interval || 0), () => {
          for (let i = 0; i < n; i++) {
            const yaw = src.aimYaw + (n > 1 ? ((i / (n - 1)) - 0.5) * 2 * (fx.spread || 0) * Math.PI / 180 : 0);
            let pitch = src.aimPitch;
            if (fx.gravity) { const R = Math.hypot(target.x - src.x, target.z - src.z); pitch = 0.5 * Math.asin(Math.min(1, (R * fx.gravity) / (fx.speed * fx.speed))); }
            if (whyParam === 1) pitch = -0.35;
            if (whyParam === 0) pitch = 0.5;
            const d = dirFromYawPitch(yaw, pitch);
            mkEnt(fx.ent, src, ox, oy, oz, d.x * fx.speed, d.y * fx.speed, d.z * fx.speed, fx.radius, whyParam === 0 ? Math.min(fx.life, 0.5) : fx.life, { g: fx.gravity || 0 }, projTick(def, src));
          }
        });
        extra = Math.min(fx.life, 2.2) + 1.2;
        if (fx.special === 'orb') extra = (whyParam === 4 ? 2.6 : 3.0);
        if (fx.special === 'orb' && whyParam === 4) at(1.4, () => {
          const orb = ents.find((q) => q.e.k === 'balllightning' && !q.done);
          if (!orb) return;
          vfx.onEvent({ e: 'fx', k: 'arcbolt', o: src.id, el: elementIndex(src.element), x: src.x, y: src.y + chestY, z: src.z, x2: orb.e.x, y2: orb.e.y, z2: orb.e.z, r: 36 });
          for (const o of others(src)) if (Math.hypot(o.x - orb.e.x, o.z - orb.e.z) < 5.6) hitSpec(o, src, def.key, ZONES.balllightning!.overload!.hit, o.x - orb.e.x, 0.4, o.z - orb.e.z);
          despawn(orb, 4);
        });
        break;
      }
      case 'beam': {
        if (fx.ent === 'sunlance') {
          if (charge) despawn(charge, 0);
          const hit = world.raycast(src.x, src.y + chestY, src.z, a.x, a.y, a.z, fx.range);
          const L = hit ? hit.t : fx.range;
          vfx.onEvent({ e: 'fx', k: 'sunlance', o: src.id, el: elementIndex(src.element), x: src.x + a.x, y: src.y + chestY + a.y, z: src.z + a.z, x2: src.x + a.x * L, y2: src.y + chestY + a.y * L, z2: src.z + a.z * L, r: fx.width });
          for (const t of others(src)) hitSpec(t, src, def.key, fx.hit, a.x, 0.2, a.z);
        } else {
          vfx.onEvent({ e: 'fx', k: fx.ent, o: src.id, el: elementIndex(src.element), x: ox, y: oy, z: oz, x2: target.x, y2: target.y + chestY, z2: target.z, r: fx.range });
          hitSpec(target, src, def.key, fx.hit, a.x, 0.2, a.z);
          const second = others(src).find((o) => o !== target);
          if (second && fx.chain) at(0.06, () => {
            vfx.onEvent({ e: 'fx', k: fx.ent, o: src.id, el: elementIndex(src.element), x: target.x, y: target.y + chestY, z: target.z, x2: second.x, y2: second.y + chestY, z2: second.z, r: fx.chain!.range });
            emitHit(second, src, def.key, fx.hit.dmg * 0.5, false, second.x - target.x, 0.2, second.z - target.z);
          });
        }
        break;
      }
      case 'channel': {
        const en = mkEnt(fx.ent, src, src.x, src.y + chestY, src.z, a.x, a.y, a.z, 0, def.active, { p: fx.range, q: fx.width }, (q, dt) => {
          src.aimYaw += 0.45 * dt * (fx.ent === 'waterjet' ? -1 : 1); src.face = src.aimYaw;
          const d = dirFromYawPitch(src.aimYaw, src.aimPitch);
          q.e.x = src.x; q.e.y = src.y + chestY; q.e.z = src.z; q.e.vx = d.x; q.e.vy = d.y; q.e.vz = d.z;
          q.data += dt;
          if (q.data >= fx.tick) { q.data = 0; for (const t of others(src)) { const along = (t.x - src.x) * d.x + (t.z - src.z) * d.z; const off = Math.abs((t.x - src.x) * d.z - (t.z - src.z) * d.x); if (along > 0 && along < fx.range && off < fx.width * 0.5 + 0.5) emitHit(t, src, def.key, fx.hit.dmg, false, d.x, 0, d.z); } }
          if (q.e.age >= q.e.life) { if (fx.finisher) for (const t of others(src)) emitHit(t, src, def.key, fx.finisher.dmg, true, d.x, 0.3, d.z); despawn(q, 0); }
        });
        void en;
        extra = def.active + 1;
        break;
      }
      case 'cone': {
        vfx.onEvent({ e: 'fx', k: fx.ent, o: src.id, el: elementIndex(src.element), x: src.x, y: src.y + chestY, z: src.z, x2: src.x + a.x * fx.range, y2: src.y + chestY + a.y * fx.range, z2: src.z + a.z * fx.range, r: fx.range });
        for (const t of others(src)) if (Math.hypot(t.x - src.x, t.z - src.z) < fx.range) at(0.08, () => hitSpec(t, src, def.key, fx.hit, a.x, 0.3, a.z));
        break;
      }
      case 'burst': {
        const cy = fx.ent === 'solarflare' ? src.y + chestY : src.y;
        vfx.onEvent({ e: 'fx', k: fx.ent, o: src.id, el: elementIndex(src.element), x: src.x, y: cy, z: src.z, x2: src.x, y2: cy, z2: src.z, r: fx.radius });
        for (const t of others(src)) { const d = Math.hypot(t.x - src.x, t.z - src.z); if (d < fx.radius) at(fx.ent === 'earthshatter' ? d / 32 : 0.05, () => hitSpec(t, src, def.key, fx.hit, t.x - src.x, 0.5, t.z - src.z)); }
        break;
      }
      case 'strike': {
        const tx = target.x, tz = target.z, ty = groundAt(tx, tz, target.y + 2);
        mkEnt(fx.ent, src, tx, ty, tz, 0, 0, 0, fx.radius, fx.delay + 0.05, { p: fx.delay }, (en) => {
          if (en.e.age >= en.e.p) {
            despawn(en, 3);
            for (const t of others(src)) if (Math.hypot(t.x - tx, t.z - tz) < fx.radius) hitSpec(t, src, def.key, fx.hit, t.x - tx + 0.01, 0.6, t.z - tz);
            if (fx.leave) zoneEnt(fx.leave, src, tx, tz);
          }
        });
        extra = fx.delay + (fx.leave ? 4.2 : 1.6);
        break;
      }
      case 'line': {
        const l = Math.hypot(a.x, a.z) || 1;
        mkEnt(fx.ent, src, src.x, src.y, src.z, a.x / l, 0, a.z / l, fx.width / 2, fx.length / fx.speed + 0.6, { p: fx.length, q: fx.speed }, (en) => {
          const front = en.e.age * en.e.q;
          for (const t of others(src)) { const along = (t.x - src.x) * en.e.vx + (t.z - src.z) * en.e.vz; if (en.data !== t.id + 1 && along > 0 && along < front && along < fx.length && Math.abs((t.x - src.x) * en.e.vz - (t.z - src.z) * en.e.vx) < fx.width / 2 + 0.4) { en.data = t.id + 1; hitSpec(t, src, def.key, fx.hit, 0, 1, 0); } }
          if (en.e.age >= en.e.life) despawn(en, 0);
        });
        extra = 2.0;
        break;
      }
      case 'trap': {
        const tx = src.x + (target.x - src.x) * 0.75, tz = src.z + (target.z - src.z) * 0.75;
        const en = mkEnt(fx.ent, src, tx, groundAt(tx, tz, src.y + 3), tz, 0, 0, 0, fx.trigger, fx.life, { p: fx.arm }, () => { /* static */ });
        at(2.6, () => {
          despawn(en, whyParam === 0 ? 0 : 3);
          if (whyParam === 0) return;
          vfx.onEvent({ e: 'fx', k: 'rimeburst', o: src.id, el: elementIndex(src.element), x: en.e.x, y: en.e.y, z: en.e.z, x2: en.e.x, y2: en.e.y, z2: en.e.z, r: fx.radius });
          for (const t of others(src)) if (Math.hypot(t.x - en.e.x, t.z - en.e.z) < fx.radius + 2.5) hitSpec(t, src, def.key, fx.hit, 0, 0.2, 0);
        });
        extra = 5.2;
        break;
      }
      case 'zone': {
        const zd = ZONES[fx.ent]!;
        if (zd.speed) {
          const l = Math.hypot(a.x, a.z) || 1;
          const sx = src.x + (a.x / l) * fx.range, sz = src.z + (a.z / l) * fx.range;
          mkEnt(fx.ent, src, sx, groundAt(sx, sz, src.y + 3), sz, (a.x / l) * zd.speed, 0, (a.z / l) * zd.speed, zd.radius, zd.life, {}, (en, dt) => {
            en.e.x += en.e.vx * dt; en.e.z += en.e.vz * dt; en.e.y = groundAt(en.e.x, en.e.z, en.e.y + 2);
            en.data += dt;
            if (en.data > zd.tick) { en.data = 0; for (const t of others(src)) if (Math.hypot(t.x - en.e.x, t.z - en.e.z) < zd.radius) hitSpec(t, src, def.key, zd.hit!, 0, 1, 0); }
            if (en.e.age >= en.e.life) despawn(en, 0);
          });
          extra = Math.min(zd.life, 3.4) + 1;
        } else {
          zoneEnt(fx.ent, src, target.x, target.z);
          at(zd.arm || 0, () => { for (const t of others(src)) if (Math.hypot(t.x - target.x, t.z - target.z) < zd.radius && zd.rootOnEnter) applyStatus(t, 'root', zd.rootOnEnter); });
          extra = zd.life + 0.8;
        }
        break;
      }
      case 'wall': {
        const f = dirFromYawPitch(src.face, 0);
        const wx = src.x + f.x * fx.dist, wz = src.z + f.z * fx.dist;
        const en = mkEnt(fx.ent, src, wx, groundAt(wx, wz, src.y + 2), wz, 0, 0, 0, fx.thick / 2, fx.life, { yaw: Math.atan2(-f.x, f.z), p: fx.width, q: fx.height }, (q) => { if (q.e.age >= q.e.life) despawn(q, 0); });
        const endAt = whyParam === 4 ? 2.2 : whyParam === 0 ? 2.2 : -1;
        if (endAt > 0) at(endAt, () => {
          despawn(en, whyParam === 4 ? 4 : 0);
          if (whyParam === 4) for (let i = 0; i < 9; i++) {
            const s = (i / 8 - 0.5) * fx.width, yaw = src.face + (Math.random() - 0.5) * 0.7;
            const d = dirFromYawPitch(yaw, 0.15 + Math.random() * 0.25);
            mkEnt('rockshard', src, wx + Math.cos(en.e.yaw) * s, en.e.y + 0.6 + Math.random() * 2.4, wz + Math.sin(en.e.yaw) * s, d.x * 24, d.y * 24, d.z * 24, 0.3, 1.2, { g: 16 }, (q, dt) => {
              q.e.vy -= q.e.g * dt; q.e.x += q.e.vx * dt; q.e.y += q.e.vy * dt; q.e.z += q.e.vz * dt;
              for (const t of others(src)) if (Math.hypot(t.x - q.e.x, t.y + chestY - q.e.y, t.z - q.e.z) < 0.9) { emitHit(t, src, 'rockshard', 9, false, q.e.vx, 0.2, q.e.vz); despawn(q, 2); return; }
              if (world.solidAt(q.e.x, q.e.y, q.e.z, 0.2)) despawn(q, 1); else if (q.e.age > q.e.life) despawn(q, 0);
            });
          }
        });
        extra = endAt > 0 ? endAt + 1.6 : Math.min(fx.life, 3.2) + 0.5;
        break;
      }
      case 'wave': {
        const l = Math.hypot(a.x, a.z) || 1, dx = a.x / l, dz = a.z / l;
        const sx = src.x + dx * 1.6, sz = src.z + dz * 1.6;
        mkEnt(fx.ent, src, sx, groundAt(sx, sz, src.y + 2), sz, dx * fx.speed, 0, dz * fx.speed, 0, fx.range / fx.speed, { yaw: Math.atan2(-dx, dz), p: fx.width, q: fx.height }, (en, dt) => {
          en.e.x += en.e.vx * dt; en.e.z += en.e.vz * dt; en.e.y = groundAt(en.e.x, en.e.z, en.e.y + 2);
          for (const t of others(src)) if (en.data !== t.id + 1 && Math.abs((t.x - en.e.x) * dx + (t.z - en.e.z) * dz) < 0.8) { en.data = t.id + 1; hitSpec(t, src, def.key, fx.hit, dx, 0.2, dz); }
          if (en.e.age >= en.e.life) despawn(en, 0);
        });
        extra = fx.range / fx.speed + 1.2;
        break;
      }
      // ---- movement
      case 'dash': {
        src.mv = MV_DASH; src.mvT = fx.time; src.returnT = 1.6;
        const f = dirFromYawPitch(src.face, 0), sp = fx.dist / fx.time;
        src.vx = f.x * sp; src.vz = f.z * sp;
        if (fx.trail) for (let i = 0; i < 5; i++) at((i + 0.5) * fx.time / 5, () => zoneEnt(fx.trail!, src, src.x, src.z));
        extra = 3.2;
        break;
      }
      case 'glide': {
        src.mv = MV_GLIDE; src.mvT = fx.time; src.returnT = fx.time + 1.2;
        if (fx.trail) for (let i = 0; i < 14; i++) at((i + 0.5) * fx.time / 14, () => zoneEnt(fx.trail!, src, src.x, src.z));
        extra = fx.time + 2.2;
        break;
      }
      case 'blink': {
        const nx = src.x + a.x * fx.dist, ny0 = src.y + a.y * fx.dist, nz = src.z + a.z * fx.dist;
        const ny = Math.max(groundAt(nx, nz, ny0 + 2), ny0);
        vfx.onEvent({ e: 'fx', k: fx.burst.ent, o: src.id, el: elementIndex(src.element), x: src.x, y: src.y, z: src.z, x2: src.x, y2: src.y, z2: src.z, r: fx.burst.radius });
        vfx.onEvent({ e: 'tp', p: src.id, k: 'thunderstep', x: src.x, y: src.y, z: src.z, x2: nx, y2: ny, z2: nz });
        src.x = nx; src.y = ny; src.z = nz; src.returnT = 1.5;
        extra = 1.8;
        break;
      }
      case 'leap': {
        src.mv = MV_LEAP; src.mvT = 9; src.onGround = false; src.returnT = 3;
        const f = dirFromYawPitch(src.face, 0);
        src.vx = f.x * fx.speed; src.vz = f.z * fx.speed; src.vy = fx.up;
        extra = 2.6;
        break;
      }
      case 'soar': {
        src.mv = MV_SOAR; src.mvT = fx.time; src.onGround = false; src.vy = fx.up; src.returnT = fx.time + 1.2;
        const f = dirFromYawPitch(src.face, 0); src.vx = f.x * 4; src.vz = f.z * 4;
        extra = fx.time + 1.5;
        break;
      }
      case 'surge': {
        src.mv = MV_SURGE; src.mvT = fx.time; src.returnT = fx.time + 1.2;
        const f = dirFromYawPitch(src.face, 0); src.vx = f.x * fx.speed; src.vz = f.z * fx.speed;
        extra = fx.time + 1.6;
        break;
      }
      case 'meld': { src.stealthT = fx.time; extra = fx.time + 1.2; break; }
      case 'ray': {
        src.mv = MV_RAY; src.mvT = fx.time; src.returnT = 1.6;
        const sx = src.x, sy = src.y, sz = src.z, sp = fx.dist / fx.time;
        const up = dirFromYawPitch(src.aimYaw, 0.25);
        src.vx = up.x * sp; src.vy = up.y * sp; src.vz = up.z * sp; src.onGround = false;
        at(fx.time, () => vfx.onEvent({ e: 'fx', k: fx.burst.ent, o: src.id, el: elementIndex(src.element), x: sx, y: sy + chestY, z: sz, x2: src.x, y2: src.y + chestY, z2: src.z, r: fx.burst.radius }));
        extra = 1.8;
        break;
      }
    }
  });
  at(def.windup + def.active + def.recovery, () => { if (src.act === slot) { src.act = -1; src.actT = 0; } });
  return def.windup + def.active + def.recovery + extra;
}

function stepFighters(dt: number): void {
  for (const d of dummies) {
    if (d.act >= 0) d.actT += dt;
    // movement modes
    if (d.mv !== MV_NONE) {
      d.mvT -= dt;
      if (d.mv === MV_GLIDE) { d.face += 1.5 * dt; d.aimYaw = d.face; const f = dirFromYawPitch(d.face, 0); d.vx = f.x * 15.5; d.vz = f.z * 15.5; }
      if (d.mv === MV_SOAR) d.vy -= 27 * 0.2 * dt;
      if (d.mv === MV_LEAP) d.vy -= 27 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const g = groundAt(d.x, d.z, d.y + 0.6);
      if (d.mv === MV_DASH || d.mv === MV_GLIDE || d.mv === MV_SURGE) { d.y = Math.max(g, d.y - 20 * dt); if (g > -50) d.y = g; }
      const landed = (d.mv === MV_LEAP || d.mv === MV_SOAR) && d.vy < 0 && d.y <= g;
      if (landed || d.mvT <= 0) {
        if (d.mv === MV_LEAP && landed) {
          d.y = g;
          vfx.onEvent({ e: 'fx', k: 'leapslam', o: d.id, el: elementIndex(d.element), x: d.x, y: d.y, z: d.z, x2: d.x, y2: d.y, z2: d.z, r: 4.2 });
          vfx.footfall(d, 'land', world.terrainSurface(d.x, d.z));
        }
        if (d.mv === MV_SOAR || d.mv === MV_RAY) { d.vx = d.vz = 0; d.launched = false; d.onGround = false; d.stun = 0; d.vy = Math.min(d.vy, 0); }
        else { d.vx = d.vy = d.vz = 0; d.onGround = true; }
        d.mv = MV_NONE;
      }
    } else if (!d.onGround) {
      if (d.bubbled) { d.vy = 1.2; d.vx *= 0.9; d.vz *= 0.9; } else d.vy -= 27 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const g = groundAt(d.x, d.z, d.y + 0.6);
      if (d.y <= g && d.vy <= 0) { d.y = g; d.onGround = true; d.vx = d.vz = d.vy = 0; if (d.launched) { d.launched = false; d.down = 0.9; } vfx.footfall(d, 'land', world.terrainSurface(d.x, d.z)); }
      if (d.y < -45 && d.alive) { d.alive = false; d.visible = false; d.respawnT = 2.2; vfx.onEvent({ e: 'death', p: d.id, killer: 0, k: 'fall', fall: 1, x: d.x, y: d.y, z: d.z }); }
    } else if (d.bubbled) { d.onGround = false; d.vy = 1.2; }
    d.stun = Math.max(0, d.stun - dt); d.down = Math.max(0, d.down - dt);
    // statuses
    const dec = (v: number) => Math.max(0, v - dt);
    d.burnT = dec(d.burnT); d.burning = d.burnT > 0;
    d.chillT = dec(d.chillT); if (d.chillT <= 0) d.chill = 0;
    const wasF = d.frozen; d.frozenT = dec(d.frozenT); d.frozen = d.frozenT > 0;
    if (wasF && !d.frozen) vfx.onEvent({ e: 'pop', p: d.id, k: 'freeze', x: d.x, y: d.y + 1, z: d.z });
    d.shockT = dec(d.shockT); d.shocked = d.shockT > 0;
    d.rootT = dec(d.rootT); d.rooted = d.rootT > 0;
    const wasB = d.bubbled; d.bubbleT = dec(d.bubbleT); d.bubbled = d.bubbleT > 0;
    if (wasB && !d.bubbled) vfx.onEvent({ e: 'pop', p: d.id, k: 'bubble', x: d.x, y: d.y + 1, z: d.z });
    d.stealthT = dec(d.stealthT); d.stealth = d.stealthT > 0;
    d.invT = dec(d.invT); d.invuln = d.invT > 0;
    // going home
    if (d.returnT > 0 && d.alive) { d.returnT -= dt; if (d.returnT <= 0 && d.mv === MV_NONE) { d.x = d.hx; d.z = d.hz; d.y = groundAt(d.hx, d.hz); d.face = d.aimYaw = d.hyaw; d.vx = d.vy = d.vz = 0; d.onGround = true; d.launched = false; d.down = 0; } }
    if (!d.alive) {
      d.respawnT -= dt;
      if (d.respawnT <= 0) {
        d.alive = true; d.visible = true; d.hp = 100; d.x = d.hx; d.z = d.hz; d.y = groundAt(d.hx, d.hz); d.vx = d.vy = d.vz = 0; d.onGround = true; d.launched = false;
        d.burnT = d.chillT = d.frozenT = d.shockT = d.rootT = d.bubbleT = 0; d.chill = 0; d.invT = 1.6;
        vfx.onEvent({ e: 'respawn', p: d.id, x: d.x, y: d.y, z: d.z, hall: 0 });
      }
    }
    d.mesh.visible = d.visible;
    d.mesh.position.set(d.x, d.y, d.z);
    d.mesh.rotation.y = d.face;
    d.mesh.rotation.x = d.down > 0 ? -1.3 : d.launched ? simT * 9 : 0;
    d.mat.opacity = d.stealth ? (d.isLocal ? 0.35 : 0.06) : 1;
  }
}

// ------------------------------------------------------------------------------------ scenarios
const KIND_SOURCE: Record<string, { el: ElementId; slot: number; why?: number }> = {
  firepatch: { el: 'ember', slot: 3 }, cindertrail: { el: 'ember', slot: 4 }, icetrail: { el: 'frost', slot: 4 }, rimeburst: { el: 'frost', slot: 3 },
  staticburst: { el: 'storm', slot: 4 }, rockshard: { el: 'stone', slot: 2, why: 4 }, leapslam: { el: 'stone', slot: 4 }, raydash: { el: 'dawn', slot: 4 },
  spikes: { el: 'frost', slot: 2 }, tidalwave: { el: 'tide', slot: 3 },
};
function findKind(k: string): { el: ElementId; slot: number } | null {
  if (KIND_SOURCE[k]) return KIND_SOURCE[k];
  for (const id of ELEMENT_ORDER) for (const a of ELEMENTS[id].abilities) {
    const fx = a.fx as { ent?: string; trail?: string };
    if (fx.ent === k || fx.trail === k) return { el: id, slot: a.slot };
  }
  return null;
}

let caster!: Dummy, target!: Dummy, third!: Dummy;
let scenario: () => void = () => { /* set below */ };
let loopLen = 6;
const yaw0 = P('yaw') ? parseFloat(P('yaw')) : 0.6;

function setup(): void {
  const k = P('k'), elp = P('el') as ElementId, status = P('status'), event = P('event');
  let el: ElementId = ELEMENTS[elp] ? elp : 'ember';
  let slots: number[] = params.has('slot') ? [parseInt(P('slot'))] : [0, 1, 2, 3, 4];
  if (k) { const s = findKind(k); if (s) { el = s.el; slots = [s.slot]; } }
  const f = dirFromYawPitch(yaw0, 0);
  const def0 = ELEMENTS[el].abilities[slots[0]];
  let dist = params.has('dist') ? parseFloat(P('dist')) : 10;
  if (!params.has('dist') && slots.length === 1) {
    const t = def0.fx.t;
    if (t === 'melee') dist = 2.4; else if (t === 'cone') dist = 5; else if (t === 'burst') dist = 4.2; else if (t === 'wall') dist = 9; else if (t === 'beam' && def0.key === 'sunlance') dist = 22;
  }
  caster = addFighter(1, el, spot.x, spot.z, yaw0, true);
  const targetEl: ElementId = (P('tel') as ElementId) || (el === 'frost' ? 'ember' : 'frost');
  target = addFighter(2, ELEMENTS[targetEl] ? targetEl : 'frost', spot.x + f.x * dist, spot.z + f.z * dist, yaw0 + Math.PI);
  third = addFighter(3, 'gale', spot.x + f.x * (dist + 3) - f.z * 4.5, spot.z + f.z * (dist + 3) + f.x * 4.5, yaw0 + Math.PI);

  if (k === 'healrune') {
    loopLen = 6;
    scenario = () => {
      const hx = target.x, hz = target.z; target.x += 3; target.hx += 0;
      const en = mkEnt('healrune', caster, hx, groundAt(hx, hz) + 1.1, hz, 0, 0, 0, 1, 1e6, {}, () => { /* static */ });
      target.x = target.hx - f.z * 3; target.z = target.hz + f.x * 3;
      at(3.5, () => { despawn(en, 2); vfx.onEvent({ e: 'pickup', p: caster.id, id: en.e.id, heal: 35, x: en.e.x, y: en.e.y, z: en.e.z }); });
    };
  } else if (status === 'all') {
    // one of each continuous status, side by side
    const names = ['burning', 'chill', 'frozen', 'shocked', 'rooted', 'bubbled', 'invuln'];
    const els: ElementId[] = ['stone', 'stone', 'ember', 'stone', 'stone', 'stone', 'dawn'];
    const row: Dummy[] = names.map((_, i) => addFighter(20 + i, els[i], target.x - f.z * (i - 3) * 2.3, target.z + f.x * (i - 3) * 2.3, yaw0 + Math.PI));
    target.visible = false; target.alive = false; target.respawnT = 1e9; third.visible = false; third.alive = false; third.respawnT = 1e9;
    loopLen = 6;
    scenario = () => { row.forEach((d, i) => { const k = names[i]; if (k === 'burning') d.burnT = 99; else if (k === 'chill') { d.chill = 4; d.chillT = 99; } else if (k === 'frozen') d.frozenT = 99; else if (k === 'shocked') d.shockT = 99; else if (k === 'rooted') d.rootT = 99; else if (k === 'bubbled') d.bubbleT = 99; else d.invT = 99; }); };
  } else if (status) {
    loopLen = status === 'frozen' ? 3.2 : status === 'bubbled' ? 3.6 : status === 'stealth' ? 5 : 6;
    scenario = () => {
      for (const d of [target, caster]) {
        if (status === 'burning') d.burnT = 99; else if (status === 'chill') { d.chill = d === target ? 4 : 2; d.chillT = 99; }
        else if (status === 'frozen') d.frozenT = 1.6; else if (status === 'shocked') d.shockT = 99; else if (status === 'rooted') d.rootT = 99;
        else if (status === 'bubbled') d.bubbleT = 1.9; else if (status === 'stealth') at(0.6, () => { d.stealthT = 2.8; }); else if (status === 'invuln') d.invT = 99;
        d.returnT = loopLen - 0.2;
      }
    };
  } else if (event) {
    const els = ELEMENT_ORDER;
    if (event === 'hit') {
      loopLen = 8 * 0.9 + 0.5;
      const mode = P('mode', 'heavy');
      scenario = () => { els.forEach((id, i) => at(0.3 + i * 0.9, () => { caster.element = id; target.hp = mode === 'kill' ? 1 : 100; emitHit(target, caster, id + '_melee', mode === 'light' ? 8 : 22, mode !== 'light', f.x, 0.25, f.z, 0, mode === 'crit'); if (!target.alive) target.respawnT = 0.45; })); };
    } else if (event === 'death') {
      loopLen = 7;
      scenario = () => {
        at(0.3, () => { target.hp = 1; emitHit(target, caster, 'ember_melee', 20, true, f.x, 0.2, f.z); });
        at(3.2, () => { third.alive = false; third.visible = false; third.respawnT = 3; vfx.onEvent({ e: 'death', p: third.id, killer: caster.id, k: 'fall', fall: 1, x: third.x, y: third.y - 3, z: third.z }); });
      };
    } else if (event === 'respawn') {
      loopLen = 3.2;
      scenario = () => { at(0.3, () => { target.invT = 1.6; vfx.onEvent({ e: 'respawn', p: target.id, x: target.x, y: target.y, z: target.z, hall: 0 }); }); };
    } else if (event === 'tp') {
      loopLen = 7.5;
      scenario = () => {
        const tpTo = (who: Dummy, kind: string, dx: number, dz: number, dy = 0) => { const nx = who.x + dx, nz = who.z + dz, ny = groundAt(nx, nz) + dy; vfx.onEvent({ e: 'tp', p: who.id, k: kind, x: who.x, y: who.y, z: who.z, x2: nx, y2: ny, z2: nz }); who.x = nx; who.y = ny; who.z = nz; who.returnT = 1.8; };
        at(0.4, () => { target.element = 'storm'; tpTo(target, 'thunderstep', -f.z * 9, f.x * 9); });
        at(2.8, () => { target.element = 'umbra'; tpTo(target, 'duskstep', f.z * 7, -f.x * 7); });
        at(5.2, () => { target.element = 'dawn'; vfx.onEvent({ e: 'tp', p: target.id, k: 'deploy', x: target.x, y: target.y + 40, z: target.z - 60, x2: target.x, y2: target.y, z2: target.z }); target.invT = 1.6; });
      };
    } else if (event === 'pickup') {
      loopLen = 3;
      scenario = () => { at(0.4, () => vfx.onEvent({ e: 'pickup', p: target.id, id: 0, heal: 35, x: target.x, y: target.y + 1.1, z: target.z })); };
    } else if (event === 'pop') {
      loopLen = 5;
      scenario = () => { target.frozenT = 1.0; at(2.4, () => { target.bubbleT = 1.2; }); };
    } else if (event === 'foot') {
      loopLen = 4;
      scenario = () => {
        const surf = world.terrainSurface(target.x, target.z);
        for (let i = 0; i < 12; i++) at(0.2 + i * 0.28, () => { target.x += f.z * 0.9; target.z -= f.x * 0.9; target.y = groundAt(target.x, target.z); target.vx = f.z * 6; target.vz = -f.x * 6; vfx.footfall(target, i === 6 ? 'jump' : i === 9 ? 'land' : 'step', surf); });
        target.returnT = 3.9;
      };
    }
  } else if (params.has('all')) {
    // stress: eight casters in a ring, each running through its kit
    const ring: Dummy[] = [];
    ELEMENT_ORDER.forEach((id, i) => { const a = (i / 8) * Math.PI * 2; ring.push(addFighter(10 + i, id, spot.x + Math.cos(a) * 13, spot.z + Math.sin(a) * 13, yawFromDir(-Math.cos(a), -Math.sin(a)))); });
    caster.visible = false; caster.alive = false; caster.respawnT = 1e9; target.hx = target.x = spot.x; target.hz = target.z = spot.z; third.hx = third.x = spot.x + 3; third.hz = third.z = spot.z + 2;
    loopLen = 14;
    scenario = () => { ring.forEach((r, i) => { for (let s = 0; s < 5; s++) at(0.3 + s * 2.6 + i * 0.12, () => { if (r.alive) cast(r, (s + i) % 5, i % 2 ? target : third); }); }); };
  } else {
    let tt = 0.3;
    const plan: { t: number; slot: number }[] = [];
    for (const s of slots) {
      plan.push({ t: tt, slot: s });
      const d = ELEMENTS[el].abilities[s];
      tt += d.windup + d.active + d.recovery + 2.0;
      if (slots.length === 1) tt = 0; // measured at run time below
    }
    const srcWhy = k ? KIND_SOURCE[k]?.why : undefined;
    if (srcWhy !== undefined && whyParam < 0) whyParam = srcWhy;
    loopLen = slots.length === 1 ? 0 : tt + 2;
    scenario = () => {
      if (slots.length === 1) { at(0.3, () => { const len = cast(caster, slots[0], target); if (loopLen === 0 || !loopFixed) { loopLen = 0.3 + len; loopFixed = true; } }); }
      else {
        let t2 = 0.3;
        for (const s of slots) { const tNow = t2; at(tNow, () => cast(caster, s, target)); const d = ELEMENTS[el].abilities[s]; const fxT = d.fx.t; t2 += d.windup + d.active + d.recovery + (fxT === 'strike' ? 5 : fxT === 'zone' || fxT === 'wall' ? 5 : fxT === 'trap' ? 5 : fxT === 'glide' || fxT === 'soar' || fxT === 'meld' ? 4 : 2.4); }
        loopLen = t2 + 1;
      }
    };
    if (slots.length === 1) loopLen = 30;
  }
}
let loopFixed = false;

function resetSim(): void {
  vfx.clear();
  reseed(1234567);
  for (const en of ents) en.done = true;
  ents = []; timers = []; simT = 0; nextId = 1;
  for (const d of dummies) {
    d.x = d.hx; d.z = d.hz; d.y = groundAt(d.hx, d.hz); d.vx = d.vy = d.vz = 0; d.face = d.aimYaw = d.hyaw; d.aimPitch = 0; d.onGround = true;
    d.alive = d.respawnT < 1e8; d.visible = d.alive; d.hp = 100; d.act = -1; d.actT = 0; d.mv = MV_NONE; d.launched = false; d.down = 0; d.stun = 0;
    d.burnT = d.chillT = d.frozenT = d.shockT = d.rootT = d.bubbleT = d.stealthT = d.invT = 0; d.chill = 0; d.returnT = 0; if (d.alive) d.respawnT = 0;
    d.burning = d.frozen = d.shocked = d.rooted = d.bubbled = d.stealth = d.invuln = false;
  }
  scenario();
}

function step(dt: number): void {
  simT += dt;
  // timers (may schedule more)
  for (let guard = 0; guard < 8; guard++) {
    const due = timers.filter((t) => t.t <= simT);
    if (!due.length) break;
    timers = timers.filter((t) => t.t > simT);
    due.sort((a, b) => a.t - b.t).forEach((t) => t.fn());
  }
  for (const en of ents) { if (en.done) continue; en.e.age += dt; en.tick(en, dt); }
  ents = ents.filter((e) => !e.done);
  stepFighters(dt);
  placeCamera();
  vfx.update(dt, simT, camera);
}

// ------------------------------------------------------------------------------------ camera
function placeCamera(): void {
  const cx = (caster.hx + target.hx) / 2, cz = (caster.hz + target.hz) / 2;
  const f = dirFromYawPitch(yaw0, 0);
  const cy = groundAt(cx, cz);
  const span = Math.hypot(target.hx - caster.hx, target.hz - caster.hz);
  const zoom = params.has('zoom') ? parseFloat(P('zoom')) : 1;
  if (camMode === 'row') { camera.position.set(target.hx - f.x * 7.5 * zoom, cy + 2.4, target.hz - f.z * 7.5 * zoom); camera.lookAt(target.hx, cy + 1.0, target.hz); }
  else if (camMode === 'side') { const d = (6 + span * 0.9) * zoom; camera.position.set(cx - f.z * d, cy + 2.6 + span * 0.12, cz + f.x * d); camera.lookAt(cx, cy + 1.3, cz); }
  else if (camMode === 'top') { camera.position.set(cx + 0.01, cy + (12 + span) * zoom, cz + 0.01); camera.lookAt(cx, cy, cz); }
  else if (camMode === 'far') { camera.position.set(target.hx - f.z * 40, cy + 9, target.hz + f.x * 40); camera.lookAt(target.hx, cy + 1, target.hz); }
  else if (camMode === 'front') { const d = (5 + span * 0.5) * zoom; camera.position.set(target.hx + f.x * d - f.z * 2.5, cy + 3.2, target.hz + f.z * d + f.x * 2.5); camera.lookAt(cx, cy + 1.2, cz); }
  else if (camMode === 'close') { camera.position.set(target.hx - f.z * 4.2 * zoom - f.x * 2.2, cy + 2.2, target.hz + f.x * 4.2 * zoom - f.z * 2.2); camera.lookAt(target.hx, cy + 1.1, target.hz); }
  else if (camMode === 'self') { camera.position.set(caster.hx - f.z * 4.2 * zoom + f.x * 2.2, cy + 2.2, caster.hz + f.x * 4.2 * zoom + f.z * 2.2); camera.lookAt(caster.hx, cy + 1.1, caster.hz); }
  else { const back = (5.5 + span * 0.25) * zoom; camera.position.set(caster.hx - f.x * back - f.z * 3.4, cy + 3.6 + span * 0.1, caster.hz - f.z * back + f.x * 3.4); camera.lookAt(cx + f.x * span * 0.1, cy + 1.0, cz + f.z * span * 0.1); }
  camera.updateMatrixWorld();
}

// ------------------------------------------------------------------------------------ run
const hud = document.getElementById('hud')!;
let baseCalls = -1, lastCalls = 0;
function render(): void {
  renderer.info.reset();
  if (useComposer) composer.render(); else renderer.render(scene, camera);
  lastCalls = renderer.info.render.calls;
}
function statsLine(): string {
  const s = (vfx as unknown as { stats?: () => { particles: number; decals: number; strips: number; inst: number; capacity: number; draws: number } }).stats?.();
  return `t=${simT.toFixed(2)} q=${quality} frameDraws=${lastCalls} effectDraws=${s ? s.draws : -1} tris=${renderer.info.render.triangles}` + (s ? ` particles=${s.particles}/${s.capacity} decals=${s.decals} strips=${s.strips} meshInst=${s.inst}` : '');
}

setup();
const TW = params.has('tile') ? parseInt(P('tile')) : 640, TH = Math.round(TW * 9 / 16);
resize(sheet ? TW : window.innerWidth, sheet ? TH : window.innerHeight);
resetSim();
placeCamera();
// idle frame first: compiles nothing of ours (all effect meshes are hidden), gives the baseline
render(); baseCalls = lastCalls;

const api = window as unknown as Record<string, unknown>;
api.vfxSeek = (t: number) => { resetSim(); const n = Math.round(t * 60); for (let i = 0; i < n; i++) step(1 / 60); render(); return statsLine(); };
api.vfxStats = () => statsLine();
api.vfx = vfx;

if (sheet) {
  const sc = document.getElementById('sheet') as HTMLCanvasElement;
  const cols = params.has('cols') ? parseInt(P('cols')) : sheet.length <= 4 ? 2 : 3, rows = Math.ceil(sheet.length / cols);
  sc.width = cols * TW; sc.height = rows * TH; sc.style.display = 'block'; canvas.style.display = 'none'; document.getElementById('help')!.style.display = 'none';
  const g = sc.getContext('2d')!;
  let peakP = 0, peakD = 0;
  resetSim();
  let cur = 0;
  // one pass through time: stop at each requested moment (must be ascending)
  sheet.forEach((t, i) => {
    const n = Math.round(t * 60);
    for (; cur < n; cur++) {
      step(1 / 60);
      const s = (vfx as unknown as { stats?: () => { particles: number; draws: number } }).stats?.();
      if (s && s.particles > peakP) peakP = s.particles;
      if (s && s.draws > peakD) peakD = s.draws;
    }
    render();
    g.drawImage(canvas, (i % cols) * TW, Math.floor(i / cols) * TH);
    g.fillStyle = '#fff'; g.font = '14px monospace'; g.fillText(`t=${t.toFixed(2)}`, (i % cols) * TW + 8, Math.floor(i / cols) * TH + 18);
  });
  console.log(`[vfx] sheet done · peak particles ${peakP} · peak effect draws ${peakD} · ${statsLine()}`);
  api.vfxReady = true;
} else {
  window.addEventListener('resize', () => resize(window.innerWidth, window.innerHeight));
  if (freezeT >= 0) {
    const n = Math.round(freezeT * 60);
    for (let i = 0; i < n; i++) step(1 / 60);
    render();
    console.log('[vfx] ' + statsLine());
  }
  let last = performance.now(), acc = 0, logT = 0, peakP = 0, peakD = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (freezeT < 0) {
      acc += dt;
      while (acc >= 1 / 60) { step(1 / 60); acc -= 1 / 60; if (simT > loopLen) resetSim(); }
    } else { vfx.update(0, simT, camera); }
    render();
    const s = (vfx as unknown as { stats?: () => { particles: number; draws: number } }).stats?.();
    if (s) { peakP = Math.max(peakP, s.particles); peakD = Math.max(peakD, s.draws); }
    logT += dt;
    hud.textContent = statsLine() + `\npeak particles ${peakP} · peak effect draws ${peakD} · loop ${loopLen.toFixed(1)}s`;
    if (logT > 2 && freezeT < 0) { logT = 0; console.log('[vfx] ' + statsLine() + ` peakP=${peakP} peakDraws=${peakD}`); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
void tmpV;
