// CharacterView: one skinned mesh + its animator, material state and sockets.

import { Color, DetachedBindMode, Group, Matrix4, Skeleton, SkinnedMesh, Sphere, Vector3, type Camera, type Scene, type WebGLRenderer } from 'three';
import type { ElementId } from '@shared/elements';
import { ELEMENTS } from '@shared/elements';
import type { CharacterOptions, CharacterView, PlayerView, SocketName } from '../../contracts';
import type { QualityLevel } from '../../settings';
import { Animator } from './animator';
import { makeLook, type Look } from './look';
import { makeCharMaterial, makeUniforms, type CharMaterial, type CharUniforms } from './material';
import { buildModel, type ModelInfo } from './model';
import { B } from './rig';
import { clamp, damp } from './mathx';

const _c = new Color();

export class FighterView implements CharacterView {
  readonly root = new Group();
  /** Geometry statistics (debug / budgets). */
  triangles = 0; vertices = 0;

  private readonly mesh: SkinnedMesh;
  private readonly anim: Animator;
  private readonly uniforms: CharUniforms;
  private readonly matOpaque: CharMaterial;
  private readonly matFade: CharMaterial;
  private readonly quality: QualityLevel;
  private readonly seed: number;
  private readonly dummy: boolean;
  private element: ElementId;
  private look: Look;
  private model: ModelInfo;
  private flashV = 0;
  private flashSq = 0;
  private opacity = 1;
  private frozenV = 0; private shimV = 0; private tintA = 0;
  private wasVisible = false;

  constructor(opts: CharacterOptions) {
    this.quality = opts.quality; this.seed = opts.seed; this.dummy = opts.kind === 'dummy'; this.element = opts.element;
    this.look = makeLook(this.seed, this.element, this.dummy);
    this.model = buildModel(this.look, this.quality);
    this.triangles = this.model.triangles; this.vertices = this.model.vertices;
    this.uniforms = makeUniforms();
    this.matOpaque = makeCharMaterial(this.quality, this.uniforms, false);
    this.matFade = makeCharMaterial(this.quality, this.uniforms, true);
    this.anim = new Animator(this.animConfig());
    const mesh = new SkinnedMesh(this.model.geometry, this.matOpaque);
    mesh.bindMode = DetachedBindMode;
    mesh.bind(new Skeleton(this.anim.skel.bones, this.anim.skel.inverses), new Matrix4());
    mesh.boundingSphere = new Sphere(new Vector3(0, 1, 0), 3.4);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = this.dummy ? 'dummy' : 'fighter';
    this.mesh = mesh;
    this.root.add(mesh);
    this.root.name = 'character';
    this.uniforms.uEdgeCol.value.setHex(ELEMENTS[this.element].color);
  }

  private animConfig() {
    const m = this.model;
    return {
      element: this.element, cls: this.look.weapon, dummy: this.dummy, quality: this.quality,
      grip2: m.weapon.grip2, cloakSegs: m.cloakSegs, hasBraids: m.hasBraids, hasBeard: m.hasBeard, hasHair: m.hasHair, seed: this.seed % 1000, scale: this.look.scale,
    };
  }

  update(dt: number, p: PlayerView, time: number): void {
    this.root.visible = p.visible;
    if (!p.visible) { this.wasVisible = false; return; }
    if (p.element !== this.element && !this.dummy) this.setElement(p.element);
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.face;
    this.anim.update(this.wasVisible ? dt : 0, p, time);
    this.wasVisible = true;

    // ---- squash & stretch (landing, impacts, hit flash)
    this.flashSq = damp(this.flashSq, 0, 22, dt);
    const sq = clamp(this.anim.squash * 0.75 - this.flashSq, -0.2, 0.14);
    const hs = this.look.scale;
    this.root.scale.set(hs * (1 - sq * 0.5), hs * (1 + sq), hs * (1 - sq * 0.5));
    this.root.updateMatrixWorld(true);

    // ---- material state
    const u = this.uniforms;
    u.uTime.value = time;
    this.flashV = Math.max(0, this.flashV - dt / 0.15);
    u.uFlash.value = this.flashV * this.flashV * (3 - 2 * this.flashV) * 1.05;
    this.frozenV = damp(this.frozenV, p.frozen ? 1 : 0, p.frozen ? 14 : 8, dt);
    u.uFrozen.value = this.frozenV;
    this.shimV = damp(this.shimV, p.invuln && p.alive ? 1 : 0, 10, dt);
    u.uShimmer.value = this.shimV;
    // tints: subtle, the effects layer draws the real thing
    let r = 0, g = 0, b = 0, w = 0;
    if (p.burning) { const k = 0.2 + 0.06 * Math.sin(time * 17); r += 1.0 * k; g += 0.42 * k; b += 0.1 * k; w += k; }
    if (p.chill > 0) { const k = 0.1 * Math.min(4, p.chill); r += 0.5 * k; g += 0.78 * k; b += 1.0 * k; w += k; }
    if (p.shocked) { const k = 0.14 + 0.14 * (Math.sin(time * 47) > 0.2 ? 1 : 0); r += 0.74 * k; g += 0.62 * k; b += 1.0 * k; w += k; }
    this.tintA = damp(this.tintA, Math.min(0.5, w), 12, dt);
    if (w > 0.001) u.uTint.value.set(r / w, g / w, b / w, this.tintA); else u.uTint.value.w = this.tintA;
    u.uDissolve.value = this.anim.dissolve;
    u.uGlowAmt.value = 2.6 * (p.alive ? 1 : Math.max(0, 1 - this.anim.dissolve * 1.5));
    const fade = this.opacity < 0.995;
    const mat = fade ? this.matFade : this.matOpaque;
    if (this.mesh.material !== mat) this.mesh.material = mat;
    u.uFade.value = this.opacity;
    this.mesh.castShadow = this.opacity > 0.5 && this.anim.dissolve < 0.35;
  }

  getSocket(name: SocketName, out: Vector3): Vector3 {
    const sk = this.anim.skel;
    switch (name) {
      case 'handR': sk.point(B.handR, -0.03, -0.095, 0, out); break;
      case 'handL': sk.point(B.handL, 0.03, -0.095, 0, out); break;
      case 'weaponTip':
        if (this.dummy) sk.point(B.handR, 0, -0.14, 0, out);
        else if (this.look.weapon === 'none') sk.point(B.toeR, 0, -0.01, -0.12, out);
        else { const t = this.model.weapon.tip; sk.point(B.weapon, t.x, t.y, t.z, out); }
        break;
      case 'weaponBase':
        if (this.dummy) out.copy(sk.wp[B.larmR]);
        else if (this.look.weapon === 'none') out.copy(sk.wp[B.llegR]);
        else { const t = this.model.weapon.base; sk.point(B.weapon, t.x, t.y, t.z, out); }
        break;
      case 'chest': sk.point(B.chest, 0, 0.1, -0.04, out); break;
      case 'head': sk.point(B.head, 0, 0.12, -0.01, out); break;
      default: out.set(0, 0, 0); break;
    }
    return out.applyMatrix4(this.root.matrixWorld);
  }

  setElement(el: ElementId): void {
    if (el === this.element) return;
    this.element = el;
    this.look = makeLook(this.seed, el, this.dummy);
    const old = this.model.geometry;
    this.model = buildModel(this.look, this.quality);
    this.triangles = this.model.triangles; this.vertices = this.model.vertices;
    this.mesh.geometry = this.model.geometry;
    old.dispose();
    this.anim.configure(this.animConfig());
    this.uniforms.uEdgeCol.value.setHex(ELEMENTS[el].color);
  }

  flash(strength: number): void {
    const s = clamp(strength, 0, 1);
    this.flashV = Math.max(this.flashV, 0.45 + 0.55 * s);
    this.flashSq = Math.max(this.flashSq, 0.05 + 0.09 * s);
    _c.setHex(ELEMENTS[this.element].core);
    this.uniforms.uFlashCol.value.setRGB(1, 0.97, 0.9).lerp(_c, 0.25);
  }

  setOpacity(alpha: number): void { this.opacity = clamp(alpha, 0, 1); }

  /** Is the given foot planted (0 left, 1 right)? Debug / tooling. */
  footPlanted(f: number): boolean { return this.anim.footPlanted(f); }
  plantKey(f: number): number { return this.anim.plantKey(f); }
  /** 'step' | 'land' when a foot touched down during the last update. */
  get footEvent(): string { return this.anim.footEvent; }
  /** Model-space bone position (debug). */
  bonePos(bone: keyof typeof B, out: Vector3): Vector3 { return out.copy(this.anim.skel.wp[B[bone]]).applyMatrix4(this.root.matrixWorld); }

  /**
   * Compile both shader variants (opaque + stealth fade) against the real scene's lights so the
   * first Shadowmeld does not hitch. Optional; call once after the environment exists.
   */
  precompile(renderer: WebGLRenderer, camera: Camera, scene: Scene): void {
    const parent = this.root.parent;
    scene.add(this.root);
    this.mesh.material = this.matFade;
    renderer.compile(this.root, camera, scene);
    this.mesh.material = this.matOpaque;
    renderer.compile(this.root, camera, scene);
    if (parent) parent.add(this.root); else scene.remove(this.root);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.model.geometry.dispose();
    this.mesh.skeleton.dispose();
    this.matOpaque.dispose();
    this.matFade.dispose();
  }
}
