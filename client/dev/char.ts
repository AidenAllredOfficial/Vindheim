// Character harness: neutral ground, game-like lighting, HDR + bloom, and a scenario player that
// drives a PlayerView the way the game would.
//
//   ?el=ember|frost|storm|stone|gale|tide|umbra|dawn|dummy|all     (all = line-up of eight + dummy)
//   ?seed=7            appearance seed            ?q=low|medium|high|ultra
//   ?anim=idle|run|walk|runstop|turn|jump|melee|a1|a2|a3|move|<AnimKind>|flinch|knock|down|tech|
//          bubbled|rooted|frozen|death|deathfall|burning|chill|shocked|invuln|flash|stealth|status|strafe
//   ?el=a,b,c          a custom line-up        ?el=seeds&of=frost   eight seeds of one element
//   ?turn=1            turnaround sheet (four sides)      ?rot=90  turn every fighter (view sides / backs)
//   ?keys=1            with strip: frames at the action's beats (wind-up, pre, release, follow, hold, recover)
//   ?piny=1            cancel vertical travel (airborne strips)   ?slidelog=1  log planted-foot drift
//   ?t=0.25            freeze the scenario at this time (seconds; action start = 0)
//   ?strip=8&t0=-0.05&t1=0.8   contact sheet: N copies of the fighter at evenly spaced times
//   ?speed=7.2&dir=0   locomotion speed (m/s) and direction (deg, 0 forward, 90 right, 180 back)
//   ?cam=front|side|back|three|top   ?dist=4.5  ?h=1.1   ?pitch=20 (aim pitch, deg)  ?yaw=0 (aim yaw offset)
//   ?opacity=0.06      setOpacity value used by the stealth scenario
// Without `t`, scenarios loop in real time.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ELEMENTS, ELEMENT_ORDER, type AbilityDef, type AnimKind, type ElementId } from '@shared/elements';
import { DOWN_TIME, GRAVITY, JUMP_VELOCITY, MV_DASH, MV_GLIDE, MV_LEAP, MV_RAY, MV_SOAR, MV_SURGE, TECH_TIME } from '@shared/types';
import type { PlayerView } from '../src/contracts';
import type { QualityLevel } from '../src/settings';
import * as chars from '../src/render/char';
import type { FighterView } from '../src/render/char';

const Q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (Q.has(k) && Q.get(k) !== '' && !Number.isNaN(Number(Q.get(k))) ? Number(Q.get(k)) : d);
const str = (k: string, d: string): string => Q.get(k) || d;

const quality = str('q', 'high') as QualityLevel;
const elParam = str('el', 'ember');
const animName = str('anim', 'idle');
const seed = num('seed', 7);
const frozenT = Q.has('t') ? num('t', 0) : null;
const strip = Math.floor(num('strip', 0));
const camMode = str('cam', 'front');
const speedParam = num('speed', Q.has('speed') ? 7.2 : -1);
const dirParam = num('dir', 0) * (Math.PI / 180);
const aimPitch = num('pitch', 0) * (Math.PI / 180);
const aimYawOff = num('yaw', 0) * (Math.PI / 180);
const opacityParam = num('opacity', 0.06);

// ------------------------------------------------------------------------------------------ renderer
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1524);
scene.fog = new THREE.Fog(0x0d1524, 30, 90);

const camera = new THREE.PerspectiveCamera(num('fov', 38), innerWidth / innerHeight, 0.1, 300);

// lighting like the game: cool moon key (shadows), warm horizon rim, blue sky fill
const moon = new THREE.DirectionalLight(0xb4ccff, 2.4);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.bias = -0.0004;
moon.shadow.normalBias = 0.02;
scene.add(moon, moon.target);
const rim = new THREE.DirectionalLight(0xff9a52, 1.5);
scene.add(rim, rim.target);
scene.add(new THREE.HemisphereLight(0x5f84c4, 0x3a2c24, 0.95));

// ground with a metre grid (so foot sliding is visible)
{
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#4a515c'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${200 + Math.random() * 55 | 0},${200 + Math.random() * 55 | 0},255,${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 10, 3 + Math.random() * 10); }
  g.strokeStyle = '#2c313a'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#3a404a'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(400, 400); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
}

let composer: EffectComposer | null = null;
if (quality !== 'low') {
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.55, 1.0));
  composer.addPass(new OutputPass());
}

// ------------------------------------------------------------------------------------------ fighters
const makePV = (id: number, element: ElementId, isDummy: boolean): PlayerView => ({
  id, name: 'F' + id, seed: seed + id * 13, element, isLocal: id === 0, isBot: false, isDummy,
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, face: 0, aimYaw: 0, aimPitch: 0, onGround: true, alive: true, hp: 100, inHall: false,
  act: -1, actT: 0, mv: 0, stun: 0, launched: false, down: 0, invuln: false,
  burning: false, chill: 0, frozen: false, shocked: false, rooted: false, slowed: false, bubbled: false, stealth: false, visible: true,
});

interface Actor {
  pv: PlayerView; view: FighterView; holder: THREE.Group;
  /** Scenario state. */
  t: number; target: number | null; ox: number; oz: number; s: Record<string, number>;
  slide: number; plantPos: THREE.Vector3[]; plantHad: boolean[]; plantKey: number[]; label?: HTMLDivElement; rot: number;
  flashed: boolean;
}

chars.preload(quality);
const actors: Actor[] = [];
const addActor = (element: ElementId, dummy: boolean, slotX: number, sd: number, target: number | null): Actor => {
  const pv = makePV(actors.length, element, dummy);
  pv.seed = sd;
  const view = chars.create({ seed: sd, element, kind: dummy ? 'dummy' : 'fighter', quality }) as FighterView;
  const holder = new THREE.Group();
  holder.add(view.root);
  scene.add(holder);
  const a: Actor = { pv, view, holder, t: 0, target, ox: slotX, oz: 0, s: {}, slide: 0, plantPos: [new THREE.Vector3(), new THREE.Vector3()], plantHad: [false, false], plantKey: [0, 0], rot: 0, flashed: false };
  actors.push(a);
  return a;
};

const SPACING = num('gap', strip ? 1.9 : 1.55);
if (strip > 0) {
  const t0 = num('t0', -0.05), t1 = num('t1', 0.8);
  const el = (elParam === 'all' || elParam === 'dummy' ? 'ember' : elParam) as ElementId;
  // ?keys=1: frames at the beats of the action (wind-up, just before, release, follow, hold, recover)
  let keyTimes: number[] | null = null;
  if (Q.has('keys')) {
    const sl = animName in { melee: 1, a1: 1, a2: 1, a3: 1, move: 1 } ? ({ melee: 0, a1: 1, a2: 2, a3: 3, move: 4 } as Record<string, number>)[animName] : ELEMENTS[el].abilities.findIndex((a) => a.anim === animName);
    const d = ELEMENTS[el].abilities[Math.max(0, sl)];
    const T = d.windup + d.active + d.recovery;
    keyTimes = [d.windup * 0.5, d.windup - 0.035, d.windup, d.windup + 0.07, d.windup + d.active + d.recovery * 0.35, T - 0.03, T + 0.2];
  }
  for (let i = 0; i < strip; i++) {
    const a = addActor(el, elParam === 'dummy', -(i - (strip - 1) / 2) * SPACING, seed, keyTimes ? keyTimes[Math.min(i, keyTimes.length - 1)] : t0 + ((t1 - t0) * i) / Math.max(1, strip - 1));
    const d = document.createElement('div'); d.className = 'lbl'; d.textContent = 't=' + a.target!.toFixed(3); document.body.appendChild(d); a.label = d;
  }
} else if (elParam === 'all' || elParam.includes(',')) {
  const list = (elParam === 'all' ? [...ELEMENT_ORDER, 'dummy'] : elParam.split(',')) as (ElementId | 'dummy')[];
  list.forEach((e, i) => addActor(e === 'dummy' ? 'ember' : e, e === 'dummy', -(i - (list.length - 1) / 2) * SPACING, seed + i * 101, frozenT));
} else if (elParam === 'seeds') {
  const el = str('of', 'ember') as ElementId;
  for (let i = 0; i < 8; i++) addActor(el, false, -(i - 3.5) * SPACING, seed + i * 37, frozenT);
} else if (num('turn', 0) > 0) {
  // turnaround sheet: the same fighter seen from four sides
  for (let i = 0; i < 4; i++) { const a = addActor((elParam === 'dummy' ? 'ember' : elParam) as ElementId, elParam === 'dummy', -(i - 1.5) * SPACING * 1.15, seed, frozenT); a.rot = i * Math.PI / 2; }
} else {
  addActor((elParam === 'dummy' ? 'ember' : elParam) as ElementId, elParam === 'dummy', 0, seed, frozenT);
}
const rotAll = num('rot', 0) * (Math.PI / 180);
if (rotAll) for (const a of actors) a.rot += rotAll;

// ------------------------------------------------------------------------------------------ scenarios
const SLOTS: Record<string, number> = { melee: 0, a1: 1, a2: 2, a3: 3, move: 4 };
const slotFor = (el: ElementId, name: string): number => {
  if (name in SLOTS) return SLOTS[name];
  return ELEMENTS[el].abilities.findIndex((a) => a.anim === (name as AnimKind));
};
const PRE = 0.7; // seconds of lead-in before t = 0
const moveSpeed = speedParam >= 0 ? speedParam : 0;

function setVelLocal(pv: PlayerView, fwd: number, right: number): void {
  const c = Math.cos(pv.face), s = Math.sin(pv.face);
  pv.vx = -s * fwd + c * right; pv.vz = -c * fwd - s * right;
}

/** Advance one actor's scenario by dt. Scenario time a.t; t = 0 is "the event". */
function stepScenario(a: Actor, dt: number): void {
  const pv = a.pv, t = a.t + dt, s = a.s;
  const name = animName;
  const el = pv.element;
  // defaults each step
  pv.act = -1; pv.actT = 0; pv.stun = Math.max(0, pv.stun - dt);
  pv.aimYaw = pv.face + aimYawOff; pv.aimPitch = aimPitch;
  let fwd = Math.cos(dirParam) * moveSpeed, right = Math.sin(dirParam) * moveSpeed;
  let gravity = GRAVITY;
  let loop = 0;
  const slot = pv.isDummy ? -1 : slotFor(el, name);
  const def: AbilityDef | null = slot >= 0 ? ELEMENTS[el].abilities[slot] : null;

  if (def) {
    const total = def.windup + def.active + def.recovery;
    loop = Math.max(1.5, total + 1.0);
    if (t >= 0 && t < total) { pv.act = slot; pv.actT = t; fwd *= def.moveMul; right *= def.moveMul; }
    const k = def.anim;
    if (def.fx.t === 'melee' && t >= def.windup - 0.06 && t < def.windup + 0.08 && num('lunge', 1)) fwd += def.fx.lunge;
    if (k === 'dash') { if (t >= 0 && t < 0.2) { pv.mv = MV_DASH; const d = dirParam; fwd = Math.cos(d) * 47.5; right = Math.sin(d) * 47.5; } else pv.mv = 0; loop = 1.6; }
    if (k === 'glide') { if (t >= 0 && t < 1.5) { pv.mv = MV_GLIDE; fwd = 15.5; right = 0; pv.face += Math.sin(t * 3) * 1.6 * dt; } else pv.mv = 0; loop = 3; }
    if (k === 'surge') { if (t >= 0 && t < 0.55) { pv.mv = MV_SURGE; fwd = 22; right = 0; pv.face += Math.sin(t * 9) * 1.2 * dt; } else pv.mv = 0; loop = 2; }
    if (k === 'blink') { if (t >= def.windup && !s.blinked) { s.blinked = 1; pv.z -= 12; } loop = 1.6; }
    if (k === 'leap') {
      loop = 3.2;
      if (t >= def.windup && !s.leapt) { s.leapt = 1; pv.mv = MV_LEAP; pv.vy = 15; pv.onGround = false; }
      if (pv.mv === MV_LEAP) { fwd = 15; right = 0; }
    }
    if (k === 'soar') {
      loop = 5;
      if (t >= 0 && !s.soared) { s.soared = 1; pv.vy = 13.5; pv.onGround = false; }
      if (t >= 0 && t < 2.6 && !pv.onGround) { pv.mv = MV_SOAR; gravity = GRAVITY * 0.2; fwd = moveSpeed || 7.2; pv.act = slot; pv.actT = t; } else pv.mv = 0;
    }
    if (k === 'meld') { pv.stealth = t >= 0 && t < 2.8; a.view.setOpacity(pv.stealth ? opacityParam : 1); if (pv.stealth) { fwd *= 1.38; right *= 1.38; } loop = 4; }
    if (k === 'ray') {
      loop = 2.4;
      const rp = aimPitch || 0.35;
      if (t >= def.windup && t < def.windup + 0.16) { pv.mv = MV_RAY; pv.onGround = false; fwd = 106 * Math.cos(rp); right = 0; pv.vy = 106 * Math.sin(rp); gravity = 0; }
      else { if (pv.mv === MV_RAY) pv.vy = 0; pv.mv = 0; }
    }
  } else switch (name) {
    case 'idle': break;
    case 'run': if (speedParam < 0) fwd = 7.2 * Math.cos(dirParam), right = 7.2 * Math.sin(dirParam); break;
    case 'walk': fwd = 2.5 * Math.cos(dirParam); right = 2.5 * Math.sin(dirParam); break;
    case 'runstop': { loop = 3; const on = (t > 0 && t < 1.2); const sp = speedParam >= 0 ? speedParam : 7.2; const tgt = on ? sp : 0; s.sp = (s.sp || 0) + Math.sign(tgt - (s.sp || 0)) * Math.min(Math.abs(tgt - (s.sp || 0)), 60 * dt); fwd = s.sp * Math.cos(dirParam); right = s.sp * Math.sin(dirParam); break; }
    case 'turn': pv.face += dt * 1.6 * (Math.sin(t * 0.7) > 0 ? 1 : -1); fwd = right = 0; break;
    case 'strafe': { loop = 0; const sp = speedParam >= 0 ? speedParam : 7.2; const ang = t * 0.9; fwd = sp * Math.cos(ang); right = sp * Math.sin(ang); break; }
    case 'jump': { loop = 1.7; if (t >= 0 && !s.jumped) { s.jumped = 1; pv.vy = JUMP_VELOCITY; pv.onGround = false; } break; }
    case 'flinch': { loop = 0; const n = Math.floor((t + 10) / 0.9); if (t >= 0 && s.fl !== n) { s.fl = n; pv.stun = 0.3; const ang = n * 2.4; s.kx = Math.sin(ang) * 6; s.kz = Math.cos(ang) * 6; } s.kx = (s.kx || 0) * Math.exp(-14 * dt); s.kz = (s.kz || 0) * Math.exp(-14 * dt); break; }
    case 'knock': case 'deathfall': {
      loop = 4;
      if (t >= 0 && !s.hit) { s.hit = 1; pv.launched = true; pv.onGround = false; pv.vy = 11; s.kb = 9; a.view.flash(1); }
      if (pv.launched) { fwd = -s.kb * Math.cos(dirParam); right = -s.kb * Math.sin(dirParam); }
      if (name === 'deathfall' && t > 0.35) pv.alive = false;
      break;
    }
    case 'down': if (t >= 0 && !s.hit) { s.hit = 1; pv.down = DOWN_TIME; } loop = 2.5; break;
    case 'tech': if (t >= 0 && !s.hit) { s.hit = 1; pv.down = TECH_TIME; } loop = 2; break;
    case 'bubbled': pv.bubbled = t >= 0 && t < 1.9; if (pv.bubbled) { pv.onGround = false; pv.vy = 1.3; gravity = 0; } loop = 4; break;
    case 'rooted': pv.rooted = t >= 0; break;
    case 'frozen': { loop = 3.5; if (speedParam < 0) fwd = t < 0 || t > 1.3 ? 7.2 : 0; pv.frozen = t >= 0 && t < 1.3; if (pv.frozen) fwd = right = 0; break; }
    case 'death': pv.alive = t < 0; loop = 4; break;
    case 'status': {
      // one status per actor, for a single comparison sheet
      const k = pv.id % 8;
      if (k === 1) pv.burning = true; else if (k === 2) pv.chill = 4; else if (k === 3) pv.shocked = true; else if (k === 4) pv.frozen = t > 0;
      else if (k === 5) pv.invuln = true; else if (k === 6) { pv.stealth = true; a.view.setOpacity(0.35); } else if (k === 7) { pv.stealth = true; a.view.setOpacity(0.06); }
      break;
    }
    case 'burning': pv.burning = true; break;
    case 'chill': pv.chill = 4; break;
    case 'shocked': pv.shocked = true; break;
    case 'invuln': pv.invuln = true; break;
    case 'flash': loop = 1.2; if (t >= 0 && !a.flashed) { a.flashed = true; a.view.flash(1); } break;
    case 'stealth': pv.stealth = true; a.view.setOpacity(opacityParam); break;
    default: break;
  }
  if (pv.down > 0) { pv.down = Math.max(0, pv.down - dt); pv.invuln = pv.down <= 0; if (pv.invuln) s.inv = 0.55; fwd = right = 0; }
  if (s.inv > 0) { s.inv -= dt; pv.invuln = s.inv > 0; }
  if (pv.rooted) fwd = right = 0;

  // integrate
  setVelLocal(pv, fwd, right);
  pv.vx += s.kx || 0; pv.vz += s.kz || 0;
  if (!pv.onGround) pv.vy -= gravity * dt; else pv.vy = 0;
  pv.x += pv.vx * dt; pv.z += pv.vz * dt; pv.y += pv.vy * dt;
  if (pv.y <= 0 && pv.vy <= 0 && !pv.onGround) {
    pv.y = 0; pv.onGround = true;
    if (pv.mv === MV_LEAP || pv.mv === MV_SOAR) pv.mv = 0;
    if (pv.launched) { pv.launched = false; pv.down = DOWN_TIME; }
  }
  if (pv.y < 0) pv.y = 0;
  a.t += dt;
  // loop
  if (a.target === null && loop > 0 && a.t > loop - PRE) resetActor(a);
}

function resetActor(a: Actor): void {
  const keep = { id: a.pv.id, seed: a.pv.seed, element: a.pv.element, isDummy: a.pv.isDummy, face: 0 };
  Object.assign(a.pv, makePV(keep.id, keep.element, keep.isDummy), keep);
  a.t = -PRE; a.s = {}; a.flashed = false;
  a.view.setOpacity(1);
}

const _v = new THREE.Vector3();
let simTime = 0;
let slideLogs = 0;
function simulate(a: Actor, dt: number): void {
  stepScenario(a, dt);
  a.view.update(dt, a.pv, simTime);
  // planted feet must not move in the world
  for (let f = 0; f < 2; f++) {
    if (a.view.footPlanted(f)) {
      a.view.bonePos(f === 0 ? 'toeL' : 'toeR', _v);
      a.holder.worldToLocal(_v);
      const key = a.view.plantKey(f);
      if (a.plantHad[f] && key !== a.plantKey[f]) a.plantHad[f] = false;
      a.plantKey[f] = key;
      if (a.plantHad[f] && dt > 1e-4) {
        const sp = _v.distanceTo(a.plantPos[f]) / dt;
        a.slide = Math.max(a.slide, sp);
        if (sp > 0.25 && slideLogs < 10 && Q.has('slidelog')) { slideLogs++; console.log('[slide] t=' + a.t.toFixed(3) + ' foot=' + f + ' v=' + sp.toFixed(2) + ' d=(' + (_v.x - a.plantPos[f].x).toFixed(4) + ',' + (_v.y - a.plantPos[f].y).toFixed(4) + ',' + (_v.z - a.plantPos[f].z).toFixed(4) + ') dt=' + dt.toFixed(4)); }
      }
      a.plantPos[f].copy(_v); a.plantHad[f] = true;
    } else a.plantHad[f] = false;
  }
}

// pre-roll every actor to its target time with a fixed step
const STEP = 1 / 60;
for (const a of actors) {
  resetActor(a);
  if (a.target !== null) {
    let guard = 0;
    while (a.t < a.target - 1e-6 && guard++ < 2000) { const dt = Math.min(STEP, a.target - a.t); simTime += dt; simulate(a, dt); }
  }
}

// ------------------------------------------------------------------------------------------ camera / loop
const info = document.getElementById('info')!;
const focus = new THREE.Vector3();
const camDist = num('dist', 0);
function placeCamera(): void {
  // actors are drawn at their slot; the holder cancels the scenario's travel in strip / freeze mode
  let cx = 0, cy = 0, cz = 0, n = 0, minX = 1e9, maxX = -1e9;
  for (const a of actors) {
    const pinned = strip > 0 || actors.length > 1;
    a.holder.rotation.y = a.rot;
    const cr = Math.cos(a.rot), sr = Math.sin(a.rot);
    const rx = a.pv.x * cr + a.pv.z * sr, rz = -a.pv.x * sr + a.pv.z * cr;
    const pinY = Q.has('piny') ? -a.pv.y : 0;
    if (pinned) a.holder.position.set(a.ox - rx, pinY, a.oz - rz); else a.holder.position.set(0, pinY, 0);
    const wx = a.holder.position.x + rx, wz = a.holder.position.z + rz;
    cx += wx; cz += wz; cy += a.pv.y + pinY; n++; minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
  }
  cx /= n; cz /= n; cy /= n;
  focus.set(cx, num('h', 1.05) + cy, cz);
  const width = maxX - minX;
  const dist = camDist || Math.max(4.6, width * 1.02 + 2.6);
  const face = actors.length === 1 ? actors[0].pv.face : 0;
  const fx = -Math.sin(face), fz = -Math.cos(face);
  const rx = Math.cos(face), rz = -Math.sin(face);
  const p = camera.position;
  switch (camMode) {
    case 'back': p.set(cx - fx * dist + rx * 0.5, focus.y + 0.75, cz - fz * dist + rz * 0.5); break;
    case 'side': p.set(cx + rx * dist, focus.y + 0.15, cz + rz * dist); break;
    case 'left': p.set(cx - rx * dist, focus.y + 0.15, cz - rz * dist); break;
    case 'three': p.set(cx + fx * dist * 0.72 + rx * dist * 0.62, focus.y + 0.55, cz + fz * dist * 0.72 + rz * dist * 0.62); break;
    case 'threeback': p.set(cx - fx * dist * 0.72 + rx * dist * 0.62, focus.y + 0.7, cz - fz * dist * 0.72 + rz * dist * 0.62); break;
    case 'top': p.set(cx + 0.01, focus.y + dist, cz + 0.01); break;
    default: p.set(cx + fx * dist, focus.y + 0.2, cz + fz * dist); break;
  }
  camera.lookAt(focus);
  moon.position.set(focus.x - 5, 9, focus.z - 6.5); moon.target.position.copy(focus);
  rim.position.set(focus.x + 6, 2.2, focus.z + 7); rim.target.position.copy(focus);
  const sc = moon.shadow.camera as THREE.OrthographicCamera;
  const ext = Math.max(5, width * 0.6 + 4);
  if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 0.5; sc.far = 40; sc.updateProjectionMatrix(); }
}

let last = performance.now();
let frames = 0;
let reported = false;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const a of actors) {
    if (a.target === null) { simTime += dt / actors.length; simulate(a, dt); }
    else a.view.update(0, a.pv, simTime); // frozen: keep the pose, keep uniforms fresh
  }
  placeCamera();
  renderer.info.reset();
  if (composer) composer.render(dt); else renderer.render(scene, camera);
  for (const a of actors) {
    if (!a.label) continue;
    _v.set(a.ox, 0, a.oz).project(camera);
    a.label.style.left = ((_v.x * 0.5 + 0.5) * innerWidth) + 'px';
    a.label.style.top = Math.min(innerHeight - 18, (-_v.y * 0.5 + 0.5) * innerHeight + 6) + 'px';
  }
  frames++;
  if (frames === 3 && !reported) {
    reported = true;
    const tri = actors.map((a) => a.view.triangles);
    console.log('[char] ' + JSON.stringify({
      el: elParam, anim: animName, q: quality, actors: actors.length, trianglesPerChar: tri, verts: actors.map((a) => a.view.vertices),
      drawCalls: renderer.info.render.calls, sceneTriangles: renderer.info.render.triangles,
      slideMaxMps: actors.map((a) => +a.slide.toFixed(3)),
    }));
  }
  info.textContent = `el=${elParam} anim=${animName} q=${quality} seed=${seed}` + (frozenT !== null ? ` t=${frozenT}` : ` t=${actors[0].t.toFixed(2)}`) + `  slide=${Math.max(...actors.map((a) => a.slide)).toFixed(2)} m/s`;
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  composer?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
(window as unknown as Record<string, unknown>).__char = { actors, renderer, scene, camera };
requestAnimationFrame(frame);
