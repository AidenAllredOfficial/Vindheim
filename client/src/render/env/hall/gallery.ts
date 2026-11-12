// The pedestal gallery: eight stone pedestals, a floating rune stone per element with a bespoke
// idle effect, name plaques and banners, and the four presentation states
// (equipped / owned / next / locked).
import * as THREE from 'three';
import { ELEMENT_ORDER, ELEMENTS, type ElementId } from '@shared/elements';
import type { PedestalState } from '../../../contracts';
import { hashf, lin, torus, trs, type V3 } from './geo';
import { C, F, XI, type EmitEnv, type Kit, type SpriteSink } from './kit';
import { emblemMaterial, propMaterial, type HallUniforms } from './materials';
import { runeIndex } from './runes';
import { SPR } from './textures';

export interface Gallery {
  objects: THREE.Object3D[];
  /** Emblem positions (for the light baker), element order. */
  centres: V3[];
  setState(el: ElementId, s: PedestalState): void;
  update(dt: number, time: number, P: SpriteSink | null, e: EmitEnv): void;
  dispose(): void;
}

interface Ped {
  el: ElementId; x: number; z: number; top: number; sgn: number;
  col: V3; core: V3; dark: V3;
  state: PedestalState;
  // smoothed presentation values
  glow: number; fx: number; ped: number; lock: number; crown: number;
  chainFrom: number; chainCount: number;
}

const STONE_SCALE = 1.25, HOVER = 1.18;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

function stoneGeometry(): THREE.BufferGeometry {
  const ring: [number, number][] = [[0.23, 0], [0.15, 0.1], [-0.15, 0.1], [-0.23, 0], [-0.15, -0.1], [0.15, -0.1]];
  const levels: [number, number, number][] = [[-0.52, 0.04, 0], [-0.3, 0.86, 0], [0, 1, 0], [0.3, 0.9, 0], [0.45, 0.52, 0.03], [0.5, 0.2, 0.05]];
  const pos: number[] = [], rune: number[] = [], uv: number[] = [];
  const P = (l: number, i: number): V3 => {
    const [y, s, tilt] = levels[l];
    const [x, z] = ring[i % 6];
    return [x * s, y + x * tilt * 3, z * (0.6 + 0.4 * s)];
  };
  const push = (a: V3, b: V3, c: V3, face: number) => {
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      uv.push(p[0] * 1.6 + 0.5 + face * 0.37, p[1] * 1.6 + 0.5);
      // u runs left -> right for a viewer facing each rune face, so the glyph is never mirrored
      if (face === 1 || face === 4) rune.push(0.5 + ((face === 1 ? 1 : -1) * p[0]) / 0.43, 0.5 + p[1] / 0.84);
      else rune.push(-1, -1);
    }
  };
  for (let l = 0; l < levels.length - 1; l++) for (let i = 0; i < 6; i++) {
    const a = P(l, i), b = P(l, i + 1), c = P(l + 1, i + 1), d = P(l + 1, i);
    const isFace = (i === 1 || i === 4) && l >= 1 && l <= 2 ? i : -1;
    push(a, c, b, isFace); push(a, d, c, isFace);
  }
  const top = levels.length - 1;
  for (let i = 1; i < 5; i++) push(P(top, 0), P(top, i + 1), P(top, i), -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRuneUv', new THREE.Float32BufferAttribute(rune, 2));
  g.computeVertexNormals();
  return g;
}

function crownGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ringG = new THREE.TorusGeometry(0.34, 0.02, 5, 28); ringG.rotateX(Math.PI / 2); parts.push(ringG);
  const ring2 = new THREE.TorusGeometry(0.34, 0.012, 4, 28); ring2.rotateX(Math.PI / 2); ring2.translate(0, 0.07, 0); parts.push(ring2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, h = i % 2 ? 0.13 : 0.24;
    const sp = new THREE.ConeGeometry(0.035, h, 4);
    sp.translate(Math.cos(a) * 0.34, h / 2 + 0.06, Math.sin(a) * 0.34);
    parts.push(sp);
  }
  // merge (positions only; unlit material)
  let n = 0;
  for (const p of parts) n += (p.index ? p.index.count : p.attributes.position.count);
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const src = p.toNonIndexed();
    pos.set(src.attributes.position.array as Float32Array, o);
    o += src.attributes.position.count * 3;
    src.dispose(); p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildGallery(k: Kit, U: HallUniforms): Gallery {
  const { rockIn, carveIn, clothIn, woodIn, ironIn } = k;
  const R = k.T.carveRects;
  const cols = k.world.colliders.filter((c) => c.kind === 'pedestal');
  const peds: Ped[] = [];
  const centres: V3[] = [];

  // chain link budget
  const linkStep = [0.17, 0.13, 0.11, 0.095][k.d], linkR = linkStep * 0.6;
  const linkMats: THREE.Matrix4[] = [];
  const lockMats: THREE.Matrix4[] = [];

  ELEMENT_ORDER.forEach((el, i) => {
    const c = cols.find((p) => p.tag === el);
    if (!c) return;
    const E = ELEMENTS[el];
    const sgn = Math.sign(c.x) || 1;      // which wall
    const face = -sgn;                     // +x or -x: toward the aisle
    const y0 = c.y0, y1 = c.y1, r = c.hx;

    // ---- stone drum
    rockIn.cyl(r, r, 0.14, c.x, y0, c.z, { radial: 24, color: C.stoneDark, tile: 1.6 });
    rockIn.cyl(r - 0.08, r - 0.08, y1 - y0 - 0.28, c.x, y0 + 0.14, c.z, { radial: 24, color: C.stone, tile: 1.6, open: true });
    rockIn.cyl(r, r, 0.14, c.x, y1 - 0.14, c.z, { radial: 24, color: C.stone, tile: 1.6 });
    carveIn.ringBand(c.x, y0 + 0.18, y0 + 0.66, c.z, r - 0.072, R.bandStone, 3, 24, { color: 0xd8d4e0 });
    const ang = face > 0 ? 0 : Math.PI, arc = 1.34 / (r - 0.05);
    carveIn.ringBand(c.x, y0 + 0.25, y0 + 0.59, c.z, r - 0.05, R.plaque[el], 1, 8, { start: ang - arc / 2, arc, emit: [0.14, 0.09, 0.03] });
    carveIn.disc(c.x, y1 + 0.004, c.z, 0, r - 0.06, 28, 2, { uvRect: R.inlay, color: 0xd8d4e0 });
    for (let a = 0; a < 4; a++) {
      const an = Math.PI / 4 + (a * Math.PI) / 2;
      ironIn.add(torus(0.06, 0.016, 4, 8), trs(c.x + Math.cos(an) * 0.8, y1 + 0.03, c.z + Math.sin(an) * 0.8, { ry: -an }, _m), { color: C.ironDark });
    }
    k.occluders.push({ t: 'cyl', x: c.x, z: c.z, r, y0, y1 });

    // ---- banner and name board on the wall behind
    const bx = sgn * (XI - 0.2), bw = 1.3, by0 = F + 1.3, by1 = F + 5.85;
    const zl = c.z + (face > 0 ? bw / 2 : -bw / 2), zr = c.z - (face > 0 ? bw / 2 : -bw / 2);
    clothIn.quad([bx, by0, zl], [bx, by0, zr], [bx, by1, zr], [bx, by1, zl], { uvRect: k.T.clothRects.elementBanner[el], nu: 3, nv: 9, swayFromTop: 0.09 });
    woodIn.log([bx, by1 + 0.04, zl + Math.sign(zl - zr) * 0.14], [bx, by1 + 0.04, zr - Math.sign(zl - zr) * 0.14], 0.05, { radial: 6, color: C.timberDark });
    for (const zz of [zl, zr]) woodIn.beam([sgn * XI, by1 + 0.04, zz], [bx, by1 + 0.04, zz], 0.05, 0.05, { color: C.timberDark });
    const px = sgn * (XI - 0.1), pw = 2.3, py0 = F + 6.15, py1 = py0 + pw / 4;
    const pl = c.z + (face > 0 ? pw / 2 : -pw / 2), pr = c.z - (face > 0 ? pw / 2 : -pw / 2);
    woodIn.box(0.1, py1 - py0 + 0.12, pw + 0.12, sgn * (XI - 0.05), (py0 + py1) / 2, c.z, { color: C.timberDark, grain: 2 });
    carveIn.quad([px - sgn * 0.004, py0, pl], [px - sgn * 0.004, py0, pr], [px - sgn * 0.004, py1, pr], [px - sgn * 0.004, py1, pl], { uvRect: R.plaque[el], emit: [0.3, 0.19, 0.07] });

    const p: Ped = {
      el, x: c.x, z: c.z, top: y1, sgn, col: lin(E.color), core: lin(E.core), dark: lin(E.dark),
      state: i === 0 ? 'equipped' : 'locked', glow: 0, fx: 0, ped: 0, lock: 0, crown: 0, chainFrom: linkMats.length, chainCount: 0,
    };
    centres.push([c.x, y1 + HOVER, c.z]);

    // ---- chains (pose of the locked stone: sunk and tilted)
    const cy = y1 + HOVER - 0.24;
    const apex: V3 = [c.x, cy + 0.56 * STONE_SCALE, c.z];
    const link = (a: V3, b: V3, idx: number) => {
      _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), idx % 2 ? Math.PI / 2 : 0);
      _q.multiply(roll);
      linkMats.push(new THREE.Matrix4().compose(_p, _q, _s.set(1.35, 0.9, 1)));
    };
    const run = (a: V3, b: V3, sag: number) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const n = Math.max(2, Math.round(len / linkStep));
      let prev = a;
      for (let j = 1; j <= n; j++) {
        const t = j / n;
        const q: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
        link(prev, q, j);
        prev = q;
      }
    };
    for (let a = 0; a < 4; a++) {
      const an = Math.PI / 4 + (a * Math.PI) / 2;
      const anchor: V3 = [c.x + Math.cos(an) * 0.8, y1 + 0.05, c.z + Math.sin(an) * 0.8];
      const shoulder: V3 = [c.x + Math.cos(an) * 0.2, cy + 0.34 * STONE_SCALE, c.z + Math.sin(an) * 0.2];
      run(anchor, shoulder, 0.05);
      run(shoulder, apex, -0.03);
    }
    // waist loop around the stone
    const nl = Math.round((Math.PI * 2 * 0.3) / linkStep);
    for (let j = 0; j < nl; j++) {
      const a0 = (j / nl) * Math.PI * 2, a1 = ((j + 1) / nl) * Math.PI * 2;
      // ellipse hugging the flat stone: wide along the wall, thin toward the aisle
      const e = (a: number): V3 => [c.x + Math.cos(a) * 0.17 * STONE_SCALE, cy - 0.02 + Math.sin(a * 2) * 0.03, c.z + Math.sin(a) * 0.33 * STONE_SCALE];
      link(e(a0), e(a1), j);
    }
    p.chainCount = linkMats.length - p.chainFrom;
    lockMats.push(new THREE.Matrix4().compose(_p.set(c.x + face * 0.2 * STONE_SCALE, cy - 0.1, c.z), _q.setFromEuler(_e.set(0, face > 0 ? Math.PI / 2 : -Math.PI / 2, 0.06)), _s.set(1, 1, 1)));
    peds.push(p);
  });

  // ------------------------------------------------------------------ instanced, state-driven meshes
  const n = peds.length;
  const stoneG = stoneGeometry();
  const aGlow = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const aBody = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  aGlow.setUsage(THREE.DynamicDrawUsage); aBody.setUsage(THREE.DynamicDrawUsage);
  stoneG.setAttribute('aGlow', aGlow); stoneG.setAttribute('aBody', aBody);
  const stoneM = emblemMaterial(k.T, U);
  const stones = new THREE.InstancedMesh(stoneG, stoneM, n);
  stones.frustumCulled = false;
  stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  peds.forEach((p, i) => { aGlow.setW(i, runeIndex(ELEMENTS[p.el].rune)); stones.setColorAt(i, _c.setRGB(1, 1, 1)); });

  const linkG = new THREE.TorusGeometry(linkR, linkR * 0.27, k.d >= 2 ? 4 : 3, k.d >= 2 ? 7 : 6);
  const ironM = propMaterial({ color: 0x4a4744, roughness: 0.45, metalness: 0.75 }, 0.5);
  const chains = new THREE.InstancedMesh(linkG, ironM, linkMats.length);
  chains.frustumCulled = false;
  const lockG = (() => {
    const body = new THREE.BoxGeometry(0.2, 0.22, 0.08).toNonIndexed();
    const sh = new THREE.TorusGeometry(0.075, 0.02, 4, 8, Math.PI).toNonIndexed(); sh.translate(0, 0.11, 0);
    const pos = new Float32Array(body.attributes.position.count * 3 + sh.attributes.position.count * 3);
    pos.set(body.attributes.position.array as Float32Array, 0);
    pos.set(sh.attributes.position.array as Float32Array, body.attributes.position.count * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    body.dispose(); sh.dispose();
    return g;
  })();
  const locks = new THREE.InstancedMesh(lockG, ironM, n);
  locks.frustumCulled = false;

  const crownG = crownGeometry();
  const crownM = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const crowns = new THREE.InstancedMesh(crownG, crownM, n);
  crowns.frustumCulled = false;
  crowns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  peds.forEach((_p2, i) => crowns.setColorAt(i, _c.setRGB(1, 1, 1)));

  const NPEB = 7;
  const pebG = new THREE.IcosahedronGeometry(1, 0);
  const pebM = propMaterial({ color: 0xb49b78, roughness: 0.9, metalness: 0, map: k.T.rock.map, flatShading: true }, 0.55);
  const pebbles = new THREE.InstancedMesh(pebG, pebM, NPEB);
  pebbles.frustumCulled = false;
  pebbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const stonePed = peds.find((p) => p.el === 'stone');

  const applyChains = (i: number, on: boolean) => {
    const p = peds[i];
    for (let j = 0; j < p.chainCount; j++) chains.setMatrixAt(p.chainFrom + j, on ? linkMats[p.chainFrom + j] : _zero);
    locks.setMatrixAt(i, on ? lockMats[i] : _zero);
    chains.instanceMatrix.needsUpdate = true;
    locks.instanceMatrix.needsUpdate = true;
  };
  peds.forEach((p, i) => applyChains(i, p.state === 'locked'));

  const target = (s: PedestalState, t: number): [number, number, number, number] => {
    // glow, particle intensity, ambient pedestal light, crown
    switch (s) {
      case 'equipped': return [6.0 + 0.7 * Math.sin(t * 3.1), 1, 1.7, 1];
      case 'owned': return [2.4, 0.7, 0.7, 0];
      case 'next': { const pu = 0.5 + 0.5 * Math.sin(t * 2.0); return [0.45 + 2.3 * pu * pu, 0.22 + 0.2 * pu, 0.16 + 0.5 * pu * pu, 0]; }
      default: return [0.035, 0, 0.012, 0];
    }
  };

  let first = true;
  const gal: Gallery = {
    objects: [stones, chains, locks, crowns, pebbles],
    centres,
    setState(el, s) {
      const i = peds.findIndex((p) => p.el === el);
      if (i < 0 || peds[i].state === s) return;
      peds[i].state = s;
      applyChains(i, s === 'locked');
    },
    update(dt, time, P, e) {
      const kk = first ? 1 : 1 - Math.exp(-dt * 5);
      first = false;
      peds.forEach((p, i) => {
        const [tg, tf, tp, tc] = target(p.state, time + i * 0.7);
        p.glow += (tg - p.glow) * kk; p.fx += (tf - p.fx) * kk; p.ped += (tp - p.ped) * kk; p.crown += (tc - p.crown) * kk;
        p.lock += ((p.state === 'locked' ? 1 : 0) - p.lock) * kk;
        const lk = p.lock;
        const face = -p.sgn;
        // pose
        const bob = Math.sin(time * 1.15 + i * 1.9) * 0.055 * (1 - lk);
        const cy = p.top + HOVER + bob - 0.24 * lk + 0.06 * p.crown;
        const yaw = (face > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(time * 0.5 + i) * 0.38 * (1 - lk);
        _e.set(0.03 * Math.sin(time * 0.8 + i) * (1 - lk), yaw, 0.1 * lk, 'YXZ');
        _m.compose(_p.set(p.x, cy, p.z), _q.setFromEuler(_e), _s.setScalar(STONE_SCALE));
        stones.setMatrixAt(i, _m);
        const mixc = 0.25;
        const gr = (p.col[0] * (1 - mixc) + p.core[0] * mixc) * p.glow, gg = (p.col[1] * (1 - mixc) + p.core[1] * mixc) * p.glow, gb = (p.col[2] * (1 - mixc) + p.core[2] * mixc) * p.glow;
        aGlow.setXYZ(i, gr, gg, gb);
        const rim = Math.min(0.16, p.glow * 0.035);
        aBody.setXYZW(i, 0.2 - 0.1 * lk + gr * 0.02, 0.13 - 0.06 * lk + gg * 0.02, 0.09 - 0.03 * lk + gb * 0.02, rim);
        const tint = 0.34 - 0.14 * lk;
        stones.setColorAt(i, _c.setRGB(tint * (0.8 + 1.2 * p.dark[0]), tint * (0.8 + 1.2 * p.dark[1]), tint * (0.85 + 1.2 * p.dark[2])));
        const fl = 0.94 + 0.06 * Math.sin(time * 7 + i * 3);
        U.uPed.value[i].set(p.col[0] * p.ped * fl, p.col[1] * p.ped * fl, p.col[2] * p.ped * fl);
        // crown
        if (p.crown > 0.01) {
          _e.set(0.12 * Math.sin(time * 0.9), time * 0.7, 0.1 * Math.cos(time * 0.9), 'YXZ');
          _m.compose(_p.set(p.x, cy + 0.74 * STONE_SCALE + 0.05 * Math.sin(time * 2), p.z), _q.setFromEuler(_e), _s.setScalar(p.crown));
          crowns.setMatrixAt(i, _m);
          crowns.setColorAt(i, _c.setRGB((p.core[0] * 1.6 + p.col[0] * 1.4) * 1.5, (p.core[1] * 1.6 + p.col[1] * 1.4) * 1.5, (p.core[2] * 1.6 + p.col[2] * 1.4) * 1.5));
        } else crowns.setMatrixAt(i, _zero);
        if (P) sprites(P, p, i, cy, time, e);
      });
      // orbiting pebbles of the Stone emblem
      if (stonePed) {
        const a = Math.min(1, stonePed.fx * 1.6);
        const cy = stonePed.top + HOVER;
        for (let j = 0; j < NPEB; j++) {
          const sp = 0.5 + hashf(j, 3) * 0.6, rad = 0.52 + hashf(j, 4) * 0.3, tilt = (hashf(j, 5) - 0.5) * 0.9;
          const an = time * sp + j * 0.9;
          const sz = (0.05 + hashf(j, 6) * 0.07) * a;
          _e.set(time * (0.6 + hashf(j, 7)), time * 0.8 + j, j);
          _m.compose(_p.set(stonePed.x + Math.cos(an) * rad, cy + Math.sin(an + j) * rad * tilt + Math.sin(time * 0.7 + j) * 0.08, stonePed.z + Math.sin(an) * rad), _q.setFromEuler(_e), _s.set(sz, sz * 0.75, sz * 1.1));
          pebbles.setMatrixAt(j, _m);
        }
        pebbles.instanceMatrix.needsUpdate = true;
      }
      stones.instanceMatrix.needsUpdate = true;
      if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
      aGlow.needsUpdate = true; aBody.needsUpdate = true;
    },
    dispose() {
      for (const g of [stoneG, linkG, lockG, crownG, pebG]) g.dispose();
      for (const m of [stoneM, ironM, crownM, pebM]) m.dispose();
    },
  };
  return gal;
}

// ------------------------------------------------------------------------------------------------
// Sprite effects
// ------------------------------------------------------------------------------------------------

function sprites(P: SpriteSink, p: Ped, i: number, cy: number, t: number, e: EmitEnv): void {
  const { x, z, top, col, core, dark } = p;
  const g = p.glow, f = p.fx;
  if (g < 0.02 && f < 0.02) return;
  const dens = Math.max(0.5, Math.min(1.4, e.k));
  // shared: soft halo behind the stone and a glowing ring on the pedestal top
  const hg = Math.min(1.6, g * 0.26);
  P.add(x, cy, z, 2.3, 2.6, 0, SPR.blob, 0, col[0] * 0.3 * hg, col[1] * 0.3 * hg, col[2] * 0.3 * hg, 0);
  const rg = Math.min(1.1, g * 0.2);
  P.add(x, top + 0.03, z, 1.86, 1.86, t * 0.2 + i, SPR.ring, 1, col[0] * rg, col[1] * rg, col[2] * rg, 0);

  if (p.state === 'next') {
    // inviting pulses rising from the pedestal
    for (let j = 0; j < 3; j++) {
      const ph = (t * 0.42 + j / 3 + i * 0.13) % 1;
      const a = Math.sin(ph * Math.PI) * 1.5;
      P.add(x, top + 0.05 + ph * 1.5, z, 1.8 * (1 - ph * 0.45), 1.8 * (1 - ph * 0.45), 0, SPR.ring, 1, col[0] * a, col[1] * a, col[2] * a, 0);
    }
    const tw = 0.5 + 0.5 * Math.sin(t * 2.0 + i * 0.7);
    P.add(x, cy, z, 1.0 + tw * 0.5, 1.0 + tw * 0.5, t * 0.3, SPR.flare, 0, core[0] * tw * 0.9, core[1] * tw * 0.9, core[2] * tw * 0.9, 0);
  }
  if (p.crown > 0.02) {
    const c = p.crown;
    const hy = cy + 0.74 * STONE_SCALE + 0.1;
    // column of light, halo, flare, rising glints
    P.add(x, top + 0.02, z, 2.1, 6.2, 0, SPR.ray, 2.25, col[0] * 0.2 * c, col[1] * 0.2 * c, col[2] * 0.2 * c, 0);
    P.add(x, top + 0.02, z, 0.9, 4.2, 0, SPR.ray, 2.25, core[0] * 0.14 * c, core[1] * 0.14 * c, core[2] * 0.14 * c, 0);
    P.add(x, hy, z, 1.25, 1.25, t * 0.6, SPR.halo, 1, core[0] * 1.3 * c, core[1] * 1.3 * c, core[2] * 1.3 * c, 0);
    const fl = 0.8 + 0.2 * Math.sin(t * 5.3);
    P.add(x, hy, z, 1.6 * fl, 1.6 * fl, t * 0.25, SPR.flare, 0, core[0] * 0.6 * c, core[1] * 0.6 * c, core[2] * 0.6 * c, 0);
    P.add(x, top + 0.03, z, 2.5, 2.5, -t * 0.4, SPR.halo, 1, col[0] * 0.22 * c, col[1] * 0.22 * c, col[2] * 0.22 * c, 0);
    for (let j = 0; j < 8; j++) {
      const ph = (t * (0.22 + hashf(j, 11) * 0.2) + hashf(j, 12)) % 1;
      const an = j * 2.4 + t * 0.4, rr = 0.75 - ph * 0.3;
      const a = Math.sin(ph * Math.PI) * 3 * c;
      P.add(x + Math.cos(an) * rr, top + 0.1 + ph * 3.4, z + Math.sin(an) * rr, 0.09, 0.09, 0, SPR.spark, 0, core[0] * a, core[1] * a, core[2] * a, 0);
    }
  }
  if (f < 0.03) return;

  switch (p.el) {
    case 'ember': {
      const n = Math.round(16 * dens);
      for (let j = 0; j < n; j++) {
        const life = 1.4 + hashf(j, 21) * 1.4, ph = (t / life + hashf(j, 22)) % 1;
        const an = j * 2.39 + ph * 2.2, rr = (0.34 + hashf(j, 23) * 0.2) * (1 - ph * 0.55);
        const a = Math.min(1, ph * 8) * Math.pow(1 - ph, 1.4) * f * 5;
        const s = 0.05 + hashf(j, 24) * 0.05;
        P.add(x + Math.cos(an) * rr, cy - 0.7 + ph * 1.9, z + Math.sin(an) * rr, s, s * 1.7, j, SPR.ember, 0, 1.0 * a, (0.55 - ph * 0.35) * a, 0.07 * a, 0);
      }
      for (let j = 0; j < 5; j++) {
        // licking tongues of fire around the base of the stone
        const ph = (t * (1.1 + hashf(j, 25) * 0.5) + hashf(j, 26)) % 1;
        const an = j * 1.26 + Math.sin(t * 0.7 + j) * 0.3;
        const a = Math.sin(ph * Math.PI) * f * 1.5;
        P.add(x + Math.cos(an) * 0.3, cy - 0.78 + ph * 0.3, z + Math.sin(an) * 0.3, 0.3, 0.62 + ph * 0.3, Math.sin(t * 3 + j) * 0.2, SPR.wisp, 2.25, 1.0 * a, 0.36 * a, 0.05 * a, 0);
      }
      break;
    }
    case 'frost': {
      for (let j = 0; j < 6; j++) {
        const an = t * 0.45 + (j / 6) * Math.PI * 2, rr = 0.6 + 0.07 * Math.sin(t * 0.9 + j);
        const a = f * 2.0 * (0.75 + 0.25 * Math.sin(t * 2.3 + j * 1.7));
        P.add(x + Math.cos(an) * rr, cy + Math.sin(t * 0.8 + j * 1.1) * 0.22, z + Math.sin(an) * rr, 0.17, 0.3, Math.sin(t * 0.6 + j) * 0.35, SPR.crystal, 2, col[0] * a + core[0] * a * 0.4, col[1] * a + core[1] * a * 0.4, col[2] * a + core[2] * a * 0.4, 0);
      }
      const n = Math.round(12 * dens);
      for (let j = 0; j < n; j++) {
        // drifting snow motes and twinkles
        const life = 3 + hashf(j, 31) * 2, ph = (t / life + hashf(j, 32)) % 1;
        const an = j * 2.1 + t * 0.2, rr = 0.25 + hashf(j, 33) * 0.6;
        const tw = Math.pow(Math.max(0, Math.sin(t * (2 + hashf(j, 34) * 3) + j * 4)), 6);
        const a = Math.sin(ph * Math.PI) * f * (1.2 + tw * 5);
        P.add(x + Math.cos(an) * rr, cy + 0.8 - ph * 1.7, z + Math.sin(an) * rr, 0.05 + tw * 0.09, 0.05 + tw * 0.09, 0, tw > 0.3 ? SPR.spark : SPR.mote, 0, core[0] * a, core[1] * a, core[2] * a, 0);
      }
      P.add(x, top + 0.01, z, 2.5, 1.0, 0, SPR.smoke, 2.25, 0.2 * f, 0.3 * f, 0.38 * f, 0.1 * f);
      break;
    }
    case 'storm': {
      for (let j = 0; j < 4; j++) {
        const rate = 3.2 + j * 1.3;
        const step = Math.floor(t * rate + j * 0.37), ph = (t * rate + j * 0.37) % 1;
        if (hashf(step, 41 + j) > 0.42 * Math.min(1.3, f * 1.4)) continue;
        const an = hashf(step, 45 + j) * Math.PI * 2;
        const a = (1 - ph) * 9 * f;
        const rr = 0.2 + hashf(step, 47 + j) * 0.25;
        P.add(x + Math.cos(an) * rr, cy - 0.15 + (hashf(step, 48 + j) - 0.5) * 0.5, z + Math.sin(an) * rr, 0.6, 1.0 + hashf(step, 49 + j) * 0.5, (hashf(step, 50 + j) - 0.5) * 1.6, j % 2 ? SPR.boltA : SPR.boltB, 0, core[0] * a * 0.6 + col[0] * a * 0.5, core[1] * a * 0.6 + col[1] * a * 0.5, core[2] * a * 0.6 + col[2] * a * 0.5, 0);
        P.add(x, cy, z, 1.8, 1.8, 0, SPR.blob, 0, col[0] * a * 0.07, col[1] * a * 0.07, col[2] * a * 0.07, 0);
      }
      for (let j = 0; j < 3; j++) {
        // charged motes racing on tilted orbits
        const an = t * (3.4 + j * 0.9) + j * 2.1, tl = 0.5 + j * 0.9;
        const ox = Math.cos(an) * 0.55, oy = Math.sin(an) * 0.55 * Math.sin(tl), oz = Math.sin(an) * 0.55 * Math.cos(tl);
        P.add(x + ox, cy + oy, z + oz, 0.16, 0.16, an, SPR.spark, 0, core[0] * 2.4 * f, core[1] * 2.4 * f, core[2] * 2.6 * f, 0);
      }
      break;
    }
    case 'stone': {
      const n = Math.round(9 * dens);
      for (let j = 0; j < n; j++) {
        // dust sifting down
        const life = 2.6 + hashf(j, 51) * 2, ph = (t / life + hashf(j, 52)) % 1;
        const an = j * 2.4, rr = 0.2 + hashf(j, 53) * 0.55;
        const a = Math.sin(ph * Math.PI) * f * 0.3;
        const s = 0.24 + ph * 0.3;
        P.add(x + Math.cos(an) * rr, cy + 0.3 - ph * 1.3, z + Math.sin(an) * rr, s, s, j + ph, SPR.smoke, 0, col[0] * a * 0.9, col[1] * a * 0.9, col[2] * a * 0.9, a * 0.5);
      }
      P.add(x, top + 0.035, z, 1.5, 1.5, -t * 0.3, SPR.halo, 1, col[0] * 0.9 * f, col[1] * 0.9 * f, col[2] * 0.9 * f, 0);
      break;
    }
    case 'gale': {
      for (let j = 0; j < 5; j++) {
        const rr = 0.95 + 0.35 * Math.sin(j * 2.2), sp = (j % 2 ? -1 : 1) * (2.6 + j * 0.5);
        const a = f * (2.4 + 0.9 * Math.sin(t * 1.7 + j));
        P.add(x, cy - 0.6 + j * 0.3 + Math.sin(t * 1.2 + j) * 0.06, z, rr, rr, t * sp + j, SPR.arc, 1, core[0] * a * 0.7 + col[0] * a * 0.5, core[1] * a * 0.7 + col[1] * a * 0.5, core[2] * a * 0.7 + col[2] * a * 0.5, 0);
      }
      const n = Math.round(10 * dens);
      for (let j = 0; j < n; j++) {
        // motes riding a rising helix
        const life = 1.8 + hashf(j, 61), ph = (t / life + hashf(j, 62)) % 1;
        const an = ph * 9 + j * 1.3, rr = 0.42 + 0.2 * Math.sin(ph * Math.PI);
        const a = Math.sin(ph * Math.PI) * f * 2.6;
        P.add(x + Math.cos(an) * rr, cy - 0.8 + ph * 1.9, z + Math.sin(an) * rr, 0.06, 0.06, 0, SPR.mote, 0, core[0] * a, core[1] * a, core[2] * a, 0);
      }
      break;
    }
    case 'tide': {
      for (let j = 0; j < 9; j++) {
        const an = t * 0.9 + (j / 9) * Math.PI * 2, rr = 0.58;
        const wy = Math.sin(an * 2 + t * 1.6) * 0.22;
        const a = f * 1.9;
        P.add(x + Math.cos(an) * rr, cy + wy, z + Math.sin(an) * rr, 0.14, 0.2, Math.cos(an * 2 + t * 1.6) * 0.5, SPR.drop, 2, col[0] * a + core[0] * a * 0.35, col[1] * a + core[1] * a * 0.35, col[2] * a + core[2] * a * 0.35, 0);
      }
      for (let j = 0; j < 3; j++) {
        // ripples spreading on the pedestal
        const ph = (t * 0.5 + j / 3) % 1;
        const a = (1 - ph) * (1 - ph) * f * 2.2;
        P.add(x, top + 0.04, z, 0.4 + ph * 1.9, 0.4 + ph * 1.9, 0, SPR.ring, 1, col[0] * a, col[1] * a, col[2] * a, 0);
      }
      const n = Math.round(6 * dens);
      for (let j = 0; j < n; j++) {
        // beads rising then falling in an arc
        const life = 1.6 + hashf(j, 71), ph = (t / life + hashf(j, 72)) % 1;
        const an = j * 2.3, rr = 0.2 + ph * 0.5;
        const a = Math.sin(ph * Math.PI) * f * 2.2;
        P.add(x + Math.cos(an) * rr, top + 0.1 + Math.sin(ph * Math.PI) * 0.9, z + Math.sin(an) * rr, 0.07, 0.07, 0, SPR.mote, 0, core[0] * a, core[1] * a, core[2] * a, 0);
      }
      break;
    }
    case 'umbra': {
      // a pall that swallows the light, wisps drawn inward
      P.add(x, cy, z, 2.3, 2.5, t * 0.1, SPR.smoke, 0, dark[0] * 0.3 * f, dark[1] * 0.2 * f, dark[2] * 0.5 * f, 0.62 * f);
      const n = Math.round(11 * dens);
      for (let j = 0; j < n; j++) {
        const life = 2.2 + hashf(j, 81) * 1.6, ph = (t / life + hashf(j, 82)) % 1;
        const an = j * 2.4 + ph * 2.6, rr = 1.05 * (1 - ph) + 0.12;
        const al = Math.sin(ph * Math.PI) * f * 0.6;
        const s = 0.5 + (1 - ph) * 0.35;
        P.add(x + Math.cos(an) * rr, cy + (hashf(j, 83) - 0.5) * 1.2 * (1 - ph), z + Math.sin(an) * rr, s * 0.6, s, an + 1.57, SPR.wisp, 0, col[0] * al * 0.55, col[1] * al * 0.3, col[2] * al * 0.75, al * 0.8);
      }
      for (let j = 0; j < 5; j++) {
        const tw = Math.pow(Math.max(0, Math.sin(t * (1.3 + j * 0.4) + j * 2.4)), 8);
        const an = j * 1.9 + t * 0.3;
        P.add(x + Math.cos(an) * 0.5, cy + Math.sin(j * 3 + t * 0.4) * 0.45, z + Math.sin(an) * 0.5, 0.1 + tw * 0.1, 0.1 + tw * 0.1, 0, SPR.spark, 0, core[0] * tw * 3.5 * f, core[1] * tw * 2.5 * f, core[2] * tw * 3.8 * f, 0);
      }
      break;
    }
    case 'dawn': {
      for (let j = 0; j < 10; j++) {
        const an = (j / 10) * Math.PI * 2 + t * 0.12 * (j % 2 ? 1 : -0.6);
        const len = 1.1 + 0.5 * Math.sin(t * 1.3 + j * 2.1);
        const a = f * (0.55 + 0.4 * Math.sin(t * 1.9 + j * 1.3));
        P.add(x, cy, z, 0.34, len, an, SPR.ray, 0.25, col[0] * a + core[0] * a * 0.4, col[1] * a + core[1] * a * 0.4, col[2] * a + core[2] * a * 0.4, 0);
      }
      const fl = 0.75 + 0.25 * Math.sin(t * 2.7);
      P.add(x, cy, z, 1.5 * fl, 1.5 * fl, t * 0.15, SPR.flare, 0, core[0] * 0.9 * f, core[1] * 0.9 * f, core[2] * 0.9 * f, 0);
      const n = Math.round(8 * dens);
      for (let j = 0; j < n; j++) {
        const life = 2.4 + hashf(j, 91), ph = (t / life + hashf(j, 92)) % 1;
        const an = j * 2.4, rr = 0.3 + hashf(j, 93) * 0.4;
        const a = Math.sin(ph * Math.PI) * f * 3;
        P.add(x + Math.cos(an) * rr, cy - 0.8 + ph * 2.2, z + Math.sin(an) * rr, 0.06, 0.06, 0, SPR.mote, 0, core[0] * a, core[1] * a * 0.9, core[2] * a * 0.6, 0);
      }
      break;
    }
  }
}
