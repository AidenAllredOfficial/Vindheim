// Landmass meshes. The walkable top is triangulated on a regular grid clipped exactly to the
// outline (marching squares with bisected rim crossings), with every vertex placed by
// world.landHeight(), so feet and ground agree. The rim loop that falls out of the clipping is
// lofted downward into the cliff and the tapering, lobed underside.
import * as THREE from 'three';
import { clamp01, fbm2, hash2, lerp, smoothstep } from '@shared/math';
import { colliderContains, colliderTop, type Landmass, type World } from '@shared/world';
import { Geo, fbm3, type RGB } from './common';

export interface RimPoint { x: number; y: number; z: number }

export interface LandmassBuild {
  top: THREE.BufferGeometry;
  /** Rim loop in theta order (x toward z). */
  rim: RimPoint[];
  /** Places under the overhang where icicles can hang: position + suggested length. */
  icicles: { x: number; y: number; z: number; len: number }[];
  /** Where roots dangle from under the turf: anchor, length, outward direction. */
  roots: { x: number; y: number; z: number; len: number; ax: number; az: number }[];
}

const HALL_KINDS = new Set(['hallfloor', 'hallwall', 'hallroof', 'halllintel', 'timber', 'firepit', 'bench', 'table', 'pedestal', 'highdais', 'throne', 'terrace', 'ring', 'gatepost']);

function footprintDistance(c: { shape: string; x: number; z: number; hx: number; hz: number; yaw: number }, x: number, z: number): number {
  const dx = x - c.x, dz = z - c.z;
  if (c.shape === 'cyl') return Math.max(0, Math.sqrt(dx * dx + dz * dz) - c.hx);
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const lx = Math.abs(dx * cs + dz * sn) - c.hx, lz = Math.abs(-dx * sn + dz * cs) - c.hz;
  return Math.hypot(Math.max(0, lx), Math.max(0, lz));
}

/** Baked contact shadow from nearby colliders (1 = open ground). */
export function contactAO(world: World, x: number, z: number, h: number): number {
  let ao = 1;
  const cs = world.near(x, z, 3);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const top = colliderTop(c, x, z);
    if (top < h + 0.25) continue;
    const d = footprintDistance(c, x, z);
    if (c.y0 > h + 0.7) {
      // something overhead (bridge deck, lintel): a soft, wide shadow
      const k = 0.72 + 0.28 * smoothstep(0, 2.2, d);
      if (k < ao) ao = k;
      continue;
    }
    const reach = c.kind === 'tree' ? 1.0 : Math.min(2.4, 0.8 + (top - h) * 0.5);
    const floor = c.kind === 'tree' ? 0.62 : HALL_KINDS.has(c.kind) ? 0.6 : 0.42;
    const k = lerp(floor, 1, smoothstep(0, reach, d));
    if (k < ao) ao = k;
  }
  return ao;
}

/** Top surface + rim loop for one landmass. */
export function buildLandmassTop(world: World, lm: Landmass, step: number): LandmassBuild {
  const R = lm.radius * (1 + lm.rough) + step * 2;
  const i0 = Math.floor((lm.cx - R) / step), i1 = Math.ceil((lm.cx + R) / step);
  const j0 = Math.floor((lm.cz - R) / step), j1 = Math.ceil((lm.cz + R) / step);
  const nx = i1 - i0 + 1, nz = j1 - j0 + 1;
  const inside = new Uint8Array(nx * nz);
  const nodeV = new Int32Array(nx * nz).fill(-1);
  const edgeX = new Int32Array(nx * nz).fill(-1), edgeZ = new Int32Array(nx * nz).fill(-1);
  const P: number[] = [];
  const isRim: number[] = [];
  const addV = (x: number, z: number, rim: number) => { P.push(x, world.landHeight(lm, x, z), z); isRim.push(rim); return P.length / 3 - 1; };
  const wx = (i: number) => (i0 + i) * step, wz = (j: number) => (j0 + j) * step;

  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (world.rimDistance(lm, wx(i), wz(j)) > 0) { inside[j * nx + i] = 1; nodeV[j * nx + i] = addV(wx(i), wz(j), 0); }
  }
  const cross = (ax: number, az: number, bx: number, bz: number): number => {
    // a is inside, b outside (or the reverse): bisect for the rim
    let lo = 0, hi = 1;
    const aIn = world.rimDistance(lm, ax, az) > 0;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      const mIn = world.rimDistance(lm, ax + (bx - ax) * m, az + (bz - az) * m) > 0;
      if (mIn === aIn) lo = m; else hi = m;
    }
    const t = (lo + hi) / 2;
    return addV(ax + (bx - ax) * t, az + (bz - az) * t, 1);
  };
  const ex = (i: number, j: number) => { const k = j * nx + i; return edgeX[k] >= 0 ? edgeX[k] : (edgeX[k] = cross(wx(i), wz(j), wx(i + 1), wz(j))); };
  const ez = (i: number, j: number) => { const k = j * nx + i; return edgeZ[k] >= 0 ? edgeZ[k] : (edgeZ[k] = cross(wx(i), wz(j), wx(i), wz(j + 1))); };

  const idx: number[] = [];
  const next = new Map<number, number>(); // rim segment: from -> to (theta order)
  const poly: number[] = [], polyRim: boolean[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = inside[j * nx + i], b = inside[j * nx + i + 1], c = inside[(j + 1) * nx + i + 1], d = inside[(j + 1) * nx + i];
    const n = a + b + c + d;
    if (n === 0) continue;
    if (n === 4) {
      const va = nodeV[j * nx + i], vb = nodeV[j * nx + i + 1], vc = nodeV[(j + 1) * nx + i + 1], vd = nodeV[(j + 1) * nx + i];
      // alternate the diagonal so the grid has no directional grain
      if ((i + j) & 1) idx.push(va, vc, vb, va, vd, vc); else idx.push(va, vd, vb, vb, vd, vc);
      continue;
    }
    // walk a -> b -> c -> d (theta order), inserting rim crossings where the state flips
    poly.length = 0; polyRim.length = 0;
    if (a) { poly.push(nodeV[j * nx + i]); polyRim.push(false); }
    if (a !== b) { poly.push(ex(i, j)); polyRim.push(true); }
    if (b) { poly.push(nodeV[j * nx + i + 1]); polyRim.push(false); }
    if (b !== c) { poly.push(ez(i + 1, j)); polyRim.push(true); }
    if (c) { poly.push(nodeV[(j + 1) * nx + i + 1]); polyRim.push(false); }
    if (c !== d) { poly.push(ex(i, j + 1)); polyRim.push(true); }
    if (d) { poly.push(nodeV[(j + 1) * nx + i]); polyRim.push(false); }
    if (d !== a) { poly.push(ez(i, j)); polyRim.push(true); }
    for (let k = 1; k < poly.length - 1; k++) idx.push(poly[0], poly[k + 1], poly[k]);
    for (let k = 0; k < poly.length; k++) {
      const k2 = (k + 1) % poly.length;
      if (polyRim[k] && polyRim[k2]) {
        // a crossing followed directly by a crossing: either a rim segment (outside between them)
        // or two crossings on the same corner's edges with that corner inside (then a node sits between them).
        next.set(poly[k], poly[k2]);
      }
    }
  }

  // make every triangle face up
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ny = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]);
    if (ny < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }

  // chain the rim segments into the longest loop
  let best: number[] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: number[] = [];
    let cur = start;
    while (!seen.has(cur) && next.has(cur)) { seen.add(cur); loop.push(cur); cur = next.get(cur)!; }
    if (loop.length > best.length) best = loop;
  }
  // theta order check (signed area in x/z must be positive)
  let area = 0;
  for (let k = 0; k < best.length; k++) {
    const a = best[k] * 3, b = best[(k + 1) % best.length] * 3;
    area += (P[a] - lm.cx) * (P[b + 2] - lm.cz) - (P[b] - lm.cx) * (P[a + 2] - lm.cz);
  }
  if (area < 0) best.reverse();
  const rim: RimPoint[] = best.map((v) => ({ x: P[v * 3], y: P[v * 3 + 1], z: P[v * 3 + 2] }));

  // attributes
  const count = P.length / 3;
  const nrm = new Float32Array(count * 3), biome = new Float32Array(count * 4), misc = new Float32Array(count * 3);
  const e = 0.45;
  for (let v = 0; v < count; v++) {
    const x = P[v * 3], h = P[v * 3 + 1], z = P[v * 3 + 2];
    const dx = world.landHeight(lm, x + e, z) - world.landHeight(lm, x - e, z);
    const dz = world.landHeight(lm, x, z + e) - world.landHeight(lm, x, z - e);
    const il = 1 / Math.hypot(dx, 2 * e, dz);
    nrm[v * 3] = -dx * il; nrm[v * 3 + 1] = 2 * e * il; nrm[v * 3 + 2] = -dz * il;
    const b = world.biomeAt(x, z);
    biome[v * 4] = b.rock; biome[v * 4 + 1] = b.snow; biome[v * 4 + 2] = b.ice; biome[v * 4 + 3] = b.dirt;
    misc[v * 3] = contactAO(world, x, z, h);
    misc[v * 3 + 1] = isRim[v] ? 0 : Math.min(6, Math.max(0, world.rimDistance(lm, x, z)));
    misc[v * 3 + 2] = 0;
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  top.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  top.setAttribute('aBiome', new THREE.BufferAttribute(biome, 4));
  top.setAttribute('aMisc', new THREE.BufferAttribute(misc, 3));
  top.setIndex(new THREE.BufferAttribute(count > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  top.computeBoundingSphere(); top.computeBoundingBox();
  return { top, rim, icicles: [], roots: [] };
}

const ROCK_TOP: RGB = [0.215, 0.208, 0.262];
const ROCK_DEEP: RGB = [0.12, 0.12, 0.165];

/**
 * Loft the rim loop down into a cliff and a tapering underside: a funnel of hanging rock whose
 * depth is broken into lobes, with stalactite spires under the deepest of them. Ring 0 reuses the
 * exact rim positions (watertight against the top). Everything is at or below the rim and bulges
 * outward by at most a hand's width near the top.
 */
export function buildCliff(world: World, lm: Landmass, build: LandmassBuild, g: Geo): void {
  const rim = build.rim, n = rim.length;
  if (n < 3) return;
  const big = lm.radius > 20;
  const cliffH = big ? Math.min(12, lm.depth * 0.28) : lm.depth * 0.3;
  const US = big
    ? [0, 0.012, 0.03, 0.055, 0.085, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 0.41, 0.47, 0.53, 0.59, 0.65, 0.71, 0.77, 0.83, 0.88, 0.93, 0.97, 1]
    : [0, 0.03, 0.07, 0.12, 0.18, 0.25, 0.33, 0.42, 0.52, 0.62, 0.72, 0.82, 0.91, 0.97, 1];
  const uc = big ? 0.3 : 0.33;
  const seed = lm.seed * 13 + 7;
  const ang = new Float32Array(n), rad = new Float32Array(n), arc = new Float32Array(n);
  let acc = 0;
  for (let j = 0; j < n; j++) {
    const p = rim[j], q = rim[(j + n - 1) % n];
    if (j > 0) acc += Math.hypot(p.x - q.x, p.z - q.z);
    arc[j] = acc;
    ang[j] = Math.atan2(p.z - lm.cz, p.x - lm.cx);
    rad[j] = Math.hypot(p.x - lm.cx, p.z - lm.cz);
  }
  // smoothed outward normal of the outline at each rim vertex (so the walls of a notch get relief too)
  const onx = new Float32Array(n), onz = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const a = rim[(j + n - 3) % n], b = rim[(j + 3) % n];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    onx[j] = tz / l; onz[j] = -tx / l;
  }
  const lobeScale = 1 / (lm.radius * 0.3);
  /** How far the hanging rock reaches down at a spot (0..1 of the taper depth). */
  const lobeAt = (x: number, z: number, fr: number): number => {
    const a = fbm2(x * lobeScale + 3.1, z * lobeScale + 7.7, 3, seed);
    const b = 1 - Math.abs(2 * fbm2(x * lobeScale * 2.3 - 5.1, z * lobeScale * 2.3 + 1.7, 2, seed + 9) - 1);
    let l = smoothstep(0.3, 0.75, a) * 0.7 + b * b * 0.3;
    l = lerp(l, 1, Math.pow(1 - fr, 2.2));
    return l;
  };
  const starts: number[] = [];
  const spireSpots: { x: number; y: number; z: number; l: number }[] = [];
  for (let k = 0; k < US.length; k++) {
    const u = US[k];
    const cz = clamp01(u / uc);                   // 0..1 down the cliff face
    const tz = u <= uc ? 0 : (u - uc) / (1 - uc);  // 0..1 along the taper
    starts.push(g.count);
    for (let j = 0; j < n; j++) {
      const p = rim[j];
      const ux = (p.x - lm.cx) / Math.max(rad[j], 1e-4), uz = (p.z - lm.cz) / Math.max(rad[j], 1e-4);
      // radial fraction: a nearly vertical cliff, an undercut, then a funnel to the keel
      let fr = 1 - 0.09 * cz * cz - 0.91 * Math.pow(tz, 1.15);
      if (fr < 0) fr = 0;
      const rr = rad[j] * fr;
      let dispX = 0, dispZ = 0;
      const lxp = lm.cx + ux * rr, lzp = lm.cz + uz * rr;
      const lobe = lobeAt(lxp, lzp, fr);
      let y = p.y - cliffH * cz * (0.7 + 0.6 * fbm2(ang[j] * 3.1 + 11, 0.5, 2, seed + 3))
        - (lm.depth - cliffH) * Math.pow(tz, 1.25) * (0.16 + 0.84 * lobe);
      if (k > 0) {
        const fade = Math.min(1, k / 3);                // first rings stay close to the true rim
        const s = arc[j];
        const buttress = (fbm2(s * 0.09, y * 0.035 + 2, 3, seed + 21) - 0.5) * 2;
        const chunk = (fbm3(lxp * 0.33, y * 0.4, lzp * 0.33, 3, seed + 37) - 0.5) * 2;
        // bedding: stepped strata, each bed standing a little proud of the one below
        const bedPos = y / 1.15 + fbm2(s * 0.03, 1.3, 2, seed + 5) * 3;
        const bed = (hash2(Math.floor(bedPos), seed & 1023, 55) - 0.5) * 2;
        let d = (buttress * 1.6 + chunk * 0.9 + bed * 0.7 * (1 - tz)) * fade * (big ? 1 : 0.5);
        // never bulge out past the walkable rim by more than a little; undercut freely
        d = Math.min(d, 0.22 + 0.5 * tz) - 0.55 * fade * (1 - tz) - (1 - tz) * cz * (big ? 0.9 : 0.3);
        d *= Math.max(0.15, fr);
        // push along the outline normal on the cliff, blending to radial as the funnel closes
        const kN = 1 - tz;
        dispX = (onx[j] * kN + ux * (1 - kN)) * d;
        dispZ = (onz[j] * kN + uz * (1 - kN)) * d;
        y += chunk * 0.9 * fade * tz;
      }
      const x = lm.cx + ux * rr + dispX, z = lm.cz + uz * rr + dispZ;
      const depthK = clamp01((p.y - y) / lm.depth);
      const shade = lerp(1, 0.5, Math.pow(depthK, 0.7));
      g.color([lerp(ROCK_TOP[0], ROCK_DEEP[0], depthK) * shade, lerp(ROCK_TOP[1], ROCK_DEEP[1], depthK) * shade, lerp(ROCK_TOP[2], ROCK_DEEP[2], depthK) * shade]);
      // snow settles on the cliff's ledges near the top only; a little moss under the lip
      g.surface(lerp(0.85, 0, clamp01(depthK * 5)), lerp(0.5, 0, clamp01(depthK * 7)), 0, 0);
      g.v(x, y, z, arc[j], y);
      if (k === 4 && hash2(j, 17, seed) < (big ? 0.2 : 0.3)) {
        build.icicles.push({ x, y: y + 0.1, z, len: 0.7 + hash2(j, 29, seed) * (big ? 2.6 : 1.4) });
      }
      if (k === 3 && hash2(j, 41, seed) < (big ? 0.07 : 0.1) && world.biomeAt(p.x, p.z).rock < 0.6) {
        build.roots.push({ x, y: y + 0.25, z, len: 1.4 + hash2(j, 43, seed) * (big ? 3.4 : 1.6), ax: ux, az: uz });
      }
      if (tz > 0.3 && tz < 0.93 && lobe > 0.62 && hash2(j, k * 7 + 3, seed + 71) < (big ? 0.035 : 0.05)) spireSpots.push({ x, y, z, l: lobe });
    }
  }
  for (let k = 0; k < US.length - 1; k++) g.bridge(starts[k], starts[k + 1], n, true);

  // stalactite spires hanging under the deepest lobes
  const scale = big ? lm.radius / 62 : 0.34;
  let made = 0;
  for (let i = 0; i < spireSpots.length && made < (big ? 26 : 5); i++) {
    const sp = spireSpots[i];
    // keep them apart
    let ok = true;
    for (let k = 0; k < i; k++) if (Math.hypot(spireSpots[k].x - sp.x, spireSpots[k].z - sp.z) < 7 * scale) { ok = false; break; }
    if (!ok) continue;
    made++;
    const r0 = (2.2 + hash2(i, 3, seed + 81) * 3.4) * scale * (0.7 + sp.l * 0.5);
    const len = (7 + hash2(i, 5, seed + 81) * 13) * scale * (0.6 + sp.l * 0.6);
    const SEG = 7, RINGS = 5;
    const lx = (hash2(i, 7, seed + 81) - 0.5) * r0 * 1.2, lz = (hash2(i, 9, seed + 81) - 0.5) * r0 * 1.2;
    const st: number[] = [];
    for (let rI = 0; rI <= RINGS; rI++) {
      const t = rI / RINGS;
      st.push(g.count);
      const rr = r0 * Math.pow(1 - t, 1.25) * (1 + 0.25 * Math.sin(t * 9 + i)) + 0.02;
      const cy = sp.y + r0 * 0.9 - (len + r0 * 0.9) * Math.pow(t, 0.9);
      const dk = clamp01((rim[0].y - cy) / lm.depth);
      const shade = lerp(0.62, 0.36, dk);
      g.color([ROCK_DEEP[0] * shade * 1.7, ROCK_DEEP[1] * shade * 1.7, ROCK_DEEP[2] * shade * 1.7]).surface(0, 0, 0, 0);
      for (let q = 0; q < SEG; q++) {
        const a = (q / SEG) * Math.PI * 2 + rI * 0.35;
        const wob = 0.75 + 0.5 * hash2(q + rI * 13, i, seed + 91);
        g.v(sp.x + lx * t + Math.cos(a) * rr * wob, cy, sp.z + lz * t + Math.sin(a) * rr * wob, a * rr, cy);
      }
    }
    for (let rI = 0; rI < RINGS; rI++) g.bridge(st[rI], st[rI + 1], SEG, true);
  }
}

// ----------------------------------------------------------------------------------------------
// Grass placement
// ----------------------------------------------------------------------------------------------

export interface Tuft { x: number; y: number; z: number; scale: number; yaw: number; tint: RGB; order: number }

/** Scatter grass tufts over a landmass where the terrain is grassy and nothing stands. */
export function scatterGrass(world: World, lm: Landmass, spacing: number, out: Tuft[]): void {
  const R = lm.radius * (1 + lm.rough);
  const n = Math.ceil((R * 2) / spacing);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const hx = hash2(i, j, lm.seed + 301), hz = hash2(i, j, lm.seed + 302);
    const x = lm.cx - R + (i + hx) * spacing, z = lm.cz - R + (j + hz) * spacing;
    const rd = world.rimDistance(lm, x, z);
    if (rd < 0.5) continue;
    const b = world.biomeAt(x, z);
    const grass = 1 - Math.max(b.rock, b.ice, b.snow * 0.92);
    const clump = fbm2(x * 0.16 + 3, z * 0.16 + 9, 2, 77);
    // dead straw pokes through thin snow; bare dirt and rock stay bare
    let keep = grass * (1 - b.dirt * 0.9) * smoothstep(0.25, 0.6, clump + grass * 0.35);
    const straw = b.snow > 0.45 && b.ice < 0.05 && b.rock < 0.4 ? 0.1 * smoothstep(0.55, 0.75, clump) : 0;
    keep = Math.max(keep, straw);
    const pick = hash2(i, j, lm.seed + 303);
    if (pick > keep) continue;
    const h = world.landHeight(lm, x, z);
    let blocked = false;
    const cs = world.near(x, z, 0.5);
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      if (c.y0 > h + 2.5) continue;
      if (colliderTop(c, x, z) > h - 0.05 && colliderContains(c, x, z, 0.25)) { blocked = true; break; }
    }
    if (blocked) continue;
    const dry = hash2(i, j, lm.seed + 304);
    const snowy = b.snow > 0.22;
    const base: RGB = snowy ? [0.5, 0.44, 0.27] : dry < 0.3 ? [0.29, 0.245, 0.1] : dry < 0.75 ? [0.2, 0.185, 0.075] : [0.125, 0.15, 0.062];
    const vary = 0.75 + 0.5 * hash2(i, j, lm.seed + 305);
    out.push({
      x, y: h - 0.03, z,
      scale: (0.7 + 0.75 * hash2(i, j, lm.seed + 306)) * (snowy ? 0.7 : 1) * (0.75 + 0.5 * clump),
      yaw: hash2(i, j, lm.seed + 307) * Math.PI * 2,
      tint: [base[0] * vary, base[1] * vary, base[2] * vary],
      order: hash2(i, j, lm.seed + 308),
    });
  }
}

/** One tuft: three crossed cards of blades. uv.y = height (0 root .. 1 tip); uv.x picks a window of the blade texture. */
export function makeTuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], nrm: number[] = [];
  const CARDS = 3;
  for (let c = 0; c < CARDS; c++) {
    const a = (c / CARDS) * Math.PI + 0.3;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = 0.46, h = 0.4;
    // lean each card a little away from its own plane so the tuft has volume from every side
    const lx = -dz * 0.12 * (c - 1), lz = dx * 0.12 * (c - 1);
    const u0 = c * 0.37;
    const base = pos.length / 3;
    pos.push(-dx * w, -0.04, -dz * w, dx * w, -0.04, dz * w, dx * w + lx, h, dz * w + lz, -dx * w + lx, h, -dz * w + lz);
    uv.push(u0, 0, u0 + 0.5, 0, u0 + 0.5, 1, u0, 1);
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}
