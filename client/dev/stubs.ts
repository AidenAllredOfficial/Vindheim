// Bare-bones stand-ins for the presentation subsystems: flat-shaded collision geometry,
// capsule fighters, dots for projectiles, silence. Used by /dev/core.html to exercise the game
// core (networking, prediction, camera, input, HUD wiring) in isolation, and handy as a
// "what does the physics actually see" debug view.

import * as THREE from 'three';
import { VOID, colliderTop, type World } from '@shared/world';
import { ELEMENTS } from '@shared/elements';
import type { EntityState } from '@shared/types';
import { ENTITY_CLASS } from '@shared/sim/entities';
import type {
  AudioEngine, AudioModule, CharacterModule, CharacterView, EnvironmentModule, PlayerView, PostFX, Vfx, VfxModule,
} from '../src/contracts';

export const stubChar: CharacterModule = {
  preload() {},
  create(opts): CharacterView {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: opts.kind === 'dummy' ? 0x9a8a60 : ELEMENTS[opts.element].color, roughness: 0.7, transparent: true });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.95, 4, 12), mat);
    body.position.y = 0.9; body.castShadow = true;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    nose.position.set(0, 1.45, -0.42);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.1), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    arm.position.set(0.5, 1.1, -0.3);
    root.add(body, nose, arm);
    let flashT = 0;
    return {
      root,
      update(dt: number, p: PlayerView) {
        root.visible = p.visible;
        root.position.set(p.x, p.y, p.z);
        root.rotation.set(0, p.face, 0);
        const lying = p.down > 0.4 ? 1 : p.launched ? 0.6 : 0;
        body.rotation.x = -lying * 1.4; body.position.y = 0.9 - lying * 0.55;
        // crude action tell: the arm swings through the wind-up
        const ab = p.act >= 0 ? ELEMENTS[p.element].abilities[p.act] : null;
        arm.rotation.x = ab ? (p.actT < ab.windup ? -1.2 * (p.actT / Math.max(0.01, ab.windup)) : 0.9) : 0;
        arm.visible = p.alive;
        flashT = Math.max(0, flashT - dt * 6);
        mat.emissive.setScalar(flashT + (p.stun > 0 ? 0.25 : 0));
        if (p.frozen) mat.emissive.set(0x4488aa);
        if (!p.alive) root.scale.setScalar(Math.max(0.01, root.scale.x - dt * 0.6)); else root.scale.setScalar(1);
      },
      getSocket(name, out) {
        const h = name === 'feet' ? 0 : name === 'head' ? 1.65 : 1.15;
        return out.set(root.position.x, root.position.y + h, root.position.z);
      },
      setElement(el) { mat.color.set(ELEMENTS[el].color); },
      flash(s) { flashT = s; },
      setOpacity(a) { mat.opacity = a; },
      dispose() { body.geometry.dispose(); mat.dispose(); },
    };
  },
};

const KIND_COLOR: Record<string, number> = {
  rock: 0x6b6f7a, ramp: 0x7a7468, ledge: 0x5d6270, icecrystal: 0x9fe0ff, tree: 0x4a3524, stepstone: 0x6b6f7a, standing: 0x8d8f96,
  fallen: 0x8d8f96, dais: 0x80838c, monolith: 0xa0a4b0, floor: 0x8a8578, pillar: 0x9a9588, wall: 0x8a8578, rubble: 0x7d786c,
  archpost: 0x8a8578, lintel: 0x8a8578, bridge: 0x6e5a40, ship: 0x5a4630, mast: 0x5a4630, shrine: 0xc0b070,
  hallfloor: 0x6b4a2e, hallwall: 0x4e3622, hallroof: 0x3a2818, halllintel: 0x4e3622, timber: 0x5e4028, firepit: 0xff7a30, bench: 0x7a5636,
  table: 0x7a5636, pedestal: 0xb0a890, highdais: 0x6b4a2e, throne: 0x8a6a3a, terrace: 0x777a84, ring: 0x8a8d98, gatepost: 0x9aa0ff,
};

export const stubEnv: EnvironmentModule = {
  async createEnvironment(scene, renderer, world: World, _q, progress) {
    progress?.(0.2, 'Stub terrain');
    scene.background = new THREE.Color(0x101a2c);
    scene.fog = new THREE.FogExp2(0x101a2c, 0.004);
    renderer.shadowMap.enabled = true;
    const sun = new THREE.DirectionalLight(0xbfd4ff, 2.2);
    sun.position.set(40, 80, 30); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.far = 220;
    scene.add(sun, sun.target, new THREE.HemisphereLight(0x8fb0ff, 0x2a2420, 1.1));
    const fire = new THREE.PointLight(0xff9040, 60, 40, 2); fire.position.set(0, 21, -160); scene.add(fire);

    // terrain: a grid over each landmass, vertices outside the rim dropped
    for (const lm of world.landmasses) {
      const R = lm.radius * (1 + lm.rough) + 1, N = Math.ceil((R * 2) / 1.2);
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      const id = new Int32Array((N + 1) * (N + 1)).fill(-1);
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const x = lm.cx - R + (i / N) * 2 * R, z = lm.cz - R + (j / N) * 2 * R;
        if (world.rimDistance(lm, x, z) <= 0) continue;
        id[j * (N + 1) + i] = pos.length / 3;
        pos.push(x, world.landHeight(lm, x, z), z);
        const b = world.biomeAt(x, z);
        const c = new THREE.Color(0x4a5a38).lerp(new THREE.Color(0x6a6660), b.dirt).lerp(new THREE.Color(0x63666e), b.rock).lerp(new THREE.Color(0xdfe6ee), b.snow).lerp(new THREE.Color(0x7fb8d8), b.ice);
        col.push(c.r, c.g, c.b);
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = id[j * (N + 1) + i], b = id[j * (N + 1) + i + 1], c = id[(j + 1) * (N + 1) + i], d = id[(j + 1) * (N + 1) + i + 1];
        if (a >= 0 && b >= 0 && c >= 0) idx.push(a, c, b);
        if (b >= 0 && c >= 0 && d >= 0) idx.push(b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
      m.receiveShadow = true; scene.add(m);
    }
    await new Promise((r) => requestAnimationFrame(r));
    progress?.(0.7, 'Stub colliders');
    const roofMat = new THREE.MeshStandardMaterial({ color: KIND_COLOR.hallroof, transparent: true, opacity: 0.25 });
    for (const c of world.colliders) {
      const h = Math.max(0.05, Math.max(c.y1, c.y1b ?? c.y1) - c.y0);
      const mat = c.kind === 'hallroof' ? roofMat : new THREE.MeshStandardMaterial({ color: KIND_COLOR[c.kind] ?? 0xff00ff, roughness: 0.85 });
      let mesh: THREE.Mesh;
      if (c.shape === 'cyl') mesh = new THREE.Mesh(new THREE.CylinderGeometry(c.hx, c.hx, h, 20), mat);
      else {
        const geo = new THREE.BoxGeometry(c.hx * 2, h, c.hz * 2);
        if (c.y1b !== undefined) {
          // slope the top to match the ramp plane
          const p = geo.attributes.position;
          for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
            const wx = c.x + Math.cos(c.yaw) * p.getX(i) - Math.sin(c.yaw) * p.getZ(i), wz = c.z + Math.sin(c.yaw) * p.getX(i) + Math.cos(c.yaw) * p.getZ(i);
            p.setY(i, colliderTop(c, wx, wz) - (c.y0 + h / 2));
          }
          geo.computeVertexNormals();
        }
        mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.y = -c.yaw;
      }
      mesh.position.set(c.x, c.y0 + h / 2, c.z);
      mesh.castShadow = c.kind !== 'hallroof'; mesh.receiveShadow = true;
      scene.add(mesh);
    }
    void VOID;
    return {
      update(_dt, _t, _cam, focus) { sun.position.set(focus.x + 40, focus.y + 80, focus.z + 30); sun.target.position.copy(focus); },
      setQuality() {}, setPedestalState() {}, onLightning: null, setReduceFlashes() {}, dispose() {},
    };
  },
  createPostFX(renderer): PostFX {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    return {
      render(scene, camera) { renderer.render(scene, camera); },
      setSize() {}, setQuality() {}, impact() {}, hurt() {}, setDanger() {}, setDesaturate() {}, kick() {}, setFrost() {}, setReduceFlashes() {}, dispose() {},
    };
  },
};

export const stubVfx: VfxModule = {
  createVfx(scene, _world, fighters): Vfx {
    const live = new Map<number, { e: EntityState; mesh: THREE.Mesh }>();
    const fades: { mesh: THREE.Mesh; t: number }[] = [];
    const ball = new THREE.SphereGeometry(1, 12, 8);
    const ring = new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2);
    const puff = (x: number, y: number, z: number, r: number, color: number) => {
      const m = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
      m.position.set(x, y, z); m.scale.setScalar(r); scene.add(m); fades.push({ mesh: m, t: 0.35 });
    };
    return {
      spawnEntity(e) {
        const cls = ENTITY_CLASS[e.k];
        const color = e.k === 'healrune' ? 0x9cff9c : ELEMENTS[['ember', 'frost', 'storm', 'stone', 'gale', 'tide', 'umbra', 'dawn'][e.el] as 'ember'].color;
        const flat = cls === 'zone' || cls === 'strike' || cls === 'trap';
        const mesh = new THREE.Mesh(cls === 'wall' ? new THREE.BoxGeometry(1, 1, 1) : flat ? ring : ball, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: flat ? 0.9 : 0.85, side: THREE.DoubleSide }));
        if (cls === 'wall') { mesh.scale.set(e.p, e.q, e.r * 2); mesh.rotation.y = -e.yaw; }
        else mesh.scale.setScalar(Math.max(0.2, e.r));
        scene.add(mesh); live.set(e.id, { e, mesh });
      },
      despawnEntity(id, x, y, z, why) {
        const l = live.get(id); if (!l) return;
        scene.remove(l.mesh); live.delete(id);
        if (why > 0) puff(x, y, z, Math.max(1, l.e.r * 2), 0xffffff);
      },
      onEvent(ev) {
        if (ev.e === 'hit') puff(ev.x, ev.y, ev.z, ev.heavy ? 0.9 : 0.45, 0xffe0a0);
        else if (ev.e === 'fx') puff(ev.x2, ev.y2, ev.z2, Math.min(ev.r, 6), 0xa0c8ff);
        else if (ev.e === 'death') puff(ev.x, ev.y + 1, ev.z, 1.6, 0xff4040);
      },
      castStart() {}, castRelease() {}, footfall() {},
      update(dt) {
        for (const { e, mesh } of live.values()) {
          const cls = ENTITY_CLASS[e.k];
          if (cls === 'wall') mesh.position.set(e.x, e.y + e.q / 2, e.z);
          else if (cls === 'channel') { mesh.position.set(e.x + e.vx * e.p * 0.5, e.y + e.vy * e.p * 0.5, e.z + e.vz * e.p * 0.5); mesh.scale.setScalar(e.q * 0.5); }
          else mesh.position.set(e.x, e.y + (cls === 'zone' || cls === 'strike' || cls === 'trap' ? 0.08 : 0), e.z);
        }
        for (let i = fades.length - 1; i >= 0; i--) {
          const f = fades[i]; f.t -= dt;
          (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.t / 0.35) * 0.6;
          if (f.t <= 0) { scene.remove(f.mesh); fades.splice(i, 1); }
        }
        void fighters;
      },
      setQuality() {},
      clear() { for (const l of live.values()) scene.remove(l.mesh); live.clear(); },
      dispose() {},
    };
  },
};

const noop = () => {};
export const stubAudio: AudioModule = {
  createAudio(): AudioEngine {
    return {
      unlock: noop, unlocked: false, update: noop, setMusicState: noop, applySettings: noop, castStart: noop, castRelease: noop,
      entitySpawn: noop, entityMove: noop, entityDespawn: noop, fx: noop, hit: noop, death: noop, respawn: noop, teleport: noop, pop: noop,
      pickup: noop, footstep: noop, thunder: noop, announce: noop, ui: noop, duck: noop, dispose: noop,
    };
  },
};
