// Signature weapons. Built in the weapon bone's frame: the grip is at the bone origin, the
// weapon extends along local -Z ("a", toward the head / tip), the cutting edge faces local -Y ("d").

import { Color, Vector3 } from 'three';
import { MeshBuilder, K_LEATHER, K_METAL, K_PLAIN, K_STONE, K_WOOD, K_CLOTH } from './meshgen';
import { B, REST } from './rig';
import type { Look, WeaponClass } from './look';

export interface WeaponInfo {
  /** Socket points in weapon-bone space. */
  tip: Vector3; base: Vector3;
  /** Where the off hand holds a two-handed weapon (weapon-bone space), if it can. */
  grip2: Vector3 | null;
}

/** Glyph strokes of each element's rune in a unit box (x right, y up, -0.5..0.5). */
export const RUNES: Record<string, number[][]> = {
  ember: [[0.2, 0.42, -0.2, 0], [-0.2, 0, 0.2, -0.42]],
  frost: [[0, 0.5, 0, -0.5], [-0.14, 0.2, 0.14, 0.34], [-0.14, -0.34, 0.14, -0.2]],
  storm: [[-0.15, 0.5, -0.15, -0.5], [-0.15, 0.27, 0.2, 0], [0.2, 0, -0.15, -0.27]],
  stone: [[-0.2, -0.5, -0.2, 0.5], [-0.2, 0.5, 0.2, 0.18], [0.2, 0.18, 0.2, -0.5]],
  gale: [[-0.15, -0.5, -0.15, 0.5], [-0.15, 0.5, 0.2, 0.25], [0.2, 0.25, -0.15, 0]],
  tide: [[-0.1, -0.5, -0.1, 0.5], [-0.1, 0.5, 0.22, 0.14]],
  umbra: [[0, -0.5, 0, 0.5], [0, 0.5, 0.22, 0.27], [0, -0.5, -0.22, -0.27]],
  dawn: [[0.18, 0.5, -0.18, 0.17], [-0.18, 0.17, 0.18, -0.17], [0.18, -0.17, -0.18, -0.5]],
};

const mixc = (a: Color, b: Color, t: number): Color => a.clone().lerp(b, t);

export function buildWeapon(b: MeshBuilder, look: Look, cls: WeaponClass): WeaponInfo {
  const info: WeaponInfo = { tip: new Vector3(0, 0, -0.1), base: new Vector3(0, 0, 0), grip2: null };
  if (cls === 'none') return info;
  const g = REST.weapon;
  const seg = Math.max(5, Math.round(b.seg * 0.55));
  b.rigid(B.weapon);
  const saveShade = b.shadeFn;
  b.shadeFn = null;
  b.push().translate(g[0], g[1], g[2]);
  /** Tube along the weapon axis: y = distance toward the tip. */
  const shaft = (fn: () => void): void => { b.push().rotX(-90); fn(); b.pop(); };
  /** Plate frame: x = toward the tip, y = toward the edge side. */
  const plane = (fn: () => void): void => { b.push().rotY(90).rotX(180); fn(); b.pop(); };
  const metal = look.metal, dark = look.metalDark, el = look.elColor, core = look.elCore;
  const edgeCol = mixc(el, core, 0.35);

  if (cls === 'axe') {
    shaft(() => {
      b.color(look.wood).surf(K_WOOD, 0.75);
      b.loft([{ y: -0.26, rx: 0.021 }, { y: -0.2, rx: 0.0175 }, { y: 0.3, rx: 0.0165 }, { y: 0.68, rx: 0.02 }], { seg, capA: true, capB: true });
      b.color(look.leatherDark).surf(K_LEATHER, 0.8);
      b.loft([{ y: -0.12, rx: 0.0205 }, { y: 0, rx: 0.0215 }, { y: 0.12, rx: 0.0205 }], { seg });
      b.color(dark).surf(K_METAL, 0.42, 0.9);
      b.loft([{ y: -0.285, rx: 0.012 }, { y: -0.265, rx: 0.026 }, { y: -0.235, rx: 0.023 }], { seg, capA: true });
      b.color(metal).surf(K_METAL, 0.38, 0.95);
      b.loft([{ y: 0.5, rx: 0.03, rz: 0.036, ex: 3 }, { y: 0.63, rx: 0.03, rz: 0.036, ex: 3 }], { seg, capA: true, capB: true });
      // glowing binding under the head
      b.color(el).surf(K_PLAIN, 0.5, 0, 1.4);
      b.loft([{ y: 0.455, rx: 0.019 }, { y: 0.467, rx: 0.023 }, { y: 0.479, rx: 0.019 }], { seg });
    });
    plane(() => {
      b.color(metal).surf(K_METAL, 0.32, 1);
      b.plate([[0.63, 0.02], [0.72, 0.2], [0.675, 0.265], [0.57, 0.31], [0.4, 0.29], [0.355, 0.24], [0.47, 0.1], [0.5, 0.02]], 0.034, 0.42, 1.15, edgeCol);
      b.color(dark).surf(K_METAL, 0.45, 0.9);
      b.plate([[0.515, -0.02], [0.615, -0.02], [0.595, -0.085], [0.535, -0.085]], 0.03, 0.3);
    });
    info.tip.set(0, -0.2, -0.62); info.base.set(0, 0, -0.38);
  } else if (cls === 'sword') {
    const ice = mixc(el, new Color(0xffffff), 0.5);
    shaft(() => {
      b.color(look.leatherDark).surf(K_LEATHER, 0.8);
      b.loft([{ y: -0.095, rx: 0.017 }, { y: 0, rx: 0.019 }, { y: 0.095, rx: 0.017 }], { seg, capA: true });
      b.color(metal).surf(K_METAL, 0.35, 1);
      b.ellipsoid(0, -0.12, 0, 0.03, 0.03, 0.03, { seg, rings: 4 });
      b.box(0, 0.108, 0, 0.036, 0.03, 0.22);
      b.box(0, 0.108, 0.11, 0.044, 0.044, 0.03);
      b.box(0, 0.108, -0.11, 0.044, 0.044, 0.03);
      // the ice blade: a faceted crystal
      b.color(ice).surf(K_PLAIN, 0.1, 0.1, 0.13);
      b.loft([
        { y: 0.12, rx: 0.011, rz: 0.03, g: 0.45 }, { y: 0.2, rx: 0.017, rz: 0.06 }, { y: 0.36, rx: 0.014, rz: 0.044, g: 0.3 },
        { y: 0.5, rx: 0.017, rz: 0.06 }, { y: 0.7, rx: 0.013, rz: 0.042, g: 0.34 }, { y: 0.86, rx: 0.01, rz: 0.034 }, { y: 1.02, rx: 0, rz: 0, g: 0.8 },
      ], { seg: 4, flat: true });
      // crystal growths at the guard
      b.push().translate(0, 0.14, 0.02).rotX(28);
      b.loft([{ y: 0, rx: 0.012, rz: 0.02 }, { y: 0.07, rx: 0.014, rz: 0.024 }, { y: 0.19, rx: 0, rz: 0, g: 0.7 }], { seg: 4, flat: true });
      b.pop();
      b.push().translate(0, 0.14, -0.02).rotX(-24);
      b.loft([{ y: 0, rx: 0.011, rz: 0.018 }, { y: 0.05, rx: 0.013, rz: 0.022 }, { y: 0.15, rx: 0, rz: 0, g: 0.7 }], { seg: 4, flat: true });
      b.pop();
    });
    info.tip.set(0, 0, -1.02); info.base.set(0, 0, -0.14);
  } else if (cls === 'rod') {
    shaft(() => {
      b.color(dark).surf(K_METAL, 0.4, 0.95);
      b.loft([{ y: -0.16, rx: 0.014 }, { y: -0.12, rx: 0.018 }, { y: 0.34, rx: 0.016 }, { y: 0.38, rx: 0.03 }], { seg, capA: true, capB: true });
      b.color(look.leatherDark).surf(K_LEATHER, 0.8);
      b.loft([{ y: -0.09, rx: 0.0195 }, { y: 0.09, rx: 0.0195 }], { seg });
      b.color(el).surf(K_PLAIN, 0.4, 0, 1.6);
      for (const y of [0.13, 0.18, 0.23, 0.28]) b.loft([{ y, rx: 0.019 }, { y: y + 0.011, rx: 0.0245 }, { y: y + 0.022, rx: 0.019 }], { seg });
      b.color(metal).surf(K_METAL, 0.3, 1);
      for (const s of [1, -1]) {
        b.loft([{ y: 0.37, rx: 0.011, rz: 0.012, z: s * 0.022 }, { y: 0.45, rx: 0.01, rz: 0.011, z: s * 0.04 }, { y: 0.53, rx: 0.008, rz: 0.009, z: s * 0.03 }, { y: 0.56, rx: 0, z: s * 0.022 }], { seg: 5 });
      }
      b.color(core).surf(K_PLAIN, 0.3, 0, 2.0);
      b.ellipsoid(0, 0.455, 0, 0.022, 0.03, 0.022, { seg: 6, rings: 4 });
      b.color(el).surf(K_PLAIN, 0.4, 0, 1.2);
      b.ellipsoid(0, -0.175, 0, 0.02, 0.02, 0.02, { seg: 6, rings: 4 });
    });
    info.tip.set(0, 0, -0.5); info.base.set(0, 0, -0.1);
  } else if (cls === 'hammer') {
    const stone = mixc(new Color(0x7d766c), look.elDark, 0.25);
    shaft(() => {
      b.color(look.wood).surf(K_WOOD, 0.75);
      b.loft([{ y: -0.54, rx: 0.024 }, { y: -0.3, rx: 0.021 }, { y: 0.3, rx: 0.021 }, { y: 0.62, rx: 0.025 }], { seg, capA: true });
      b.color(look.leatherDark).surf(K_LEATHER, 0.8);
      b.loft([{ y: -0.12, rx: 0.025 }, { y: 0.12, rx: 0.025 }], { seg });
      b.loft([{ y: -0.5, rx: 0.026 }, { y: -0.28, rx: 0.025 }], { seg });
      b.color(dark).surf(K_METAL, 0.42, 0.9);
      b.loft([{ y: -0.575, rx: 0.014 }, { y: -0.555, rx: 0.031 }, { y: -0.525, rx: 0.027 }], { seg, capA: true });
      b.loft([{ y: 0.5, rx: 0.03 }, { y: 0.585, rx: 0.034 }], { seg });
      // the head: a rune-carved block of stone bound in iron
      b.color(stone).surf(K_STONE, 0.92, 0);
      b.box(0, 0.72, 0, 0.19, 0.24, 0.4);
      b.box(0, 0.72, 0, 0.215, 0.2, 0.34);
      b.color(dark).surf(K_METAL, 0.45, 0.9);
      b.box(0, 0.72, 0.125, 0.225, 0.255, 0.05);
      b.box(0, 0.72, -0.125, 0.225, 0.255, 0.05);
      b.loft([{ y: 0.84, rx: 0.035 }, { y: 0.9, rx: 0 }], { seg: 5 });
      // glowing rune on both cheeks + striking faces
      b.color(el).surf(K_PLAIN, 0.5, 0, 1.5);
      const rn = RUNES[look.element];
      for (const sx of [1, -1]) {
        for (const s of rn) b.stroke(sx * 0.111, 0.72 + s[1] * 0.13, -s[0] * 0.13 * sx, sx * 0.111, 0.72 + s[3] * 0.13, -s[2] * 0.13 * sx, 0.02, sx, 0, 0);
      }
      b.glow(0.9);
      for (const sz of [1, -1]) {
        b.stroke(-0.04, 0.68, sz * 0.203, 0.04, 0.76, sz * 0.203, 0.012, 0, 0, sz);
        b.stroke(-0.04, 0.76, sz * 0.203, 0.04, 0.68, sz * 0.203, 0.012, 0, 0, sz);
      }
    });
    info.tip.set(0, 0, -0.78); info.base.set(0, 0, -0.34); info.grip2 = new Vector3(0, 0, 0.33);
  } else if (cls === 'harpoon') {
    shaft(() => {
      b.color(look.wood).surf(K_WOOD, 0.75);
      b.loft([{ y: -0.66, rx: 0.017 }, { y: 0, rx: 0.0175 }, { y: 0.86, rx: 0.016 }], { seg, capA: true });
      b.color(look.leatherDark).surf(K_LEATHER, 0.8);
      b.loft([{ y: -0.11, rx: 0.021 }, { y: 0.11, rx: 0.021 }], { seg });
      b.loft([{ y: 0.3, rx: 0.02 }, { y: 0.5, rx: 0.02 }], { seg });
      // rope lashing
      b.color(0xcdbf9c).surf(K_CLOTH, 0.95);
      for (let i = 0; i < 5; i++) { const y = 0.66 + i * 0.027; b.loft([{ y, rx: 0.018 }, { y: y + 0.0135, rx: 0.0245 }, { y: y + 0.027, rx: 0.018 }], { seg }); }
      b.color(metal).surf(K_METAL, 0.35, 1);
      b.loft([{ y: 0.8, rx: 0.024 }, { y: 0.9, rx: 0.02 }], { seg, capB: true });
      b.loft([{ y: -0.7, rx: 0.008 }, { y: -0.68, rx: 0.026 }, { y: -0.655, rx: 0.02 }], { seg, capA: true });
      b.color(el).surf(K_PLAIN, 0.5, 0, 1.4);
      b.loft([{ y: 0.795, rx: 0.02 }, { y: 0.806, rx: 0.028 }, { y: 0.817, rx: 0.02 }], { seg });
    });
    plane(() => {
      b.color(metal).surf(K_METAL, 0.3, 1);
      b.plate([[0.88, -0.026], [1.0, -0.05], [1.2, 0], [1.0, 0.045], [0.88, 0.026]], 0.022, 0.45, 1.0, edgeCol);
      // the hook
      b.plate([[0.9, 0.02], [0.955, 0.03], [0.945, 0.13], [0.87, 0.21], [0.78, 0.2], [0.85, 0.125], [0.87, 0.06]], 0.02, 0.4, 1.2, edgeCol);
    });
    info.tip.set(0, 0, -1.2); info.base.set(0, -0.12, -0.84); info.grip2 = null;
  } else if (cls === 'dagger') {
    shaft(() => {
      b.color(look.leatherDark).surf(K_LEATHER, 0.8);
      b.loft([{ y: -0.07, rx: 0.016 }, { y: 0, rx: 0.018 }, { y: 0.065, rx: 0.016 }], { seg, capA: true });
      b.color(dark).surf(K_METAL, 0.35, 1);
      b.loft([{ y: -0.12, rx: 0 }, { y: -0.085, rx: 0.02 }, { y: -0.065, rx: 0.017 }], { seg: 5 });
      b.box(0, 0.075, 0, 0.03, 0.022, 0.11);
    });
    plane(() => {
      b.color(mixc(dark, look.elDark, 0.4)).surf(K_METAL, 0.25, 1);
      b.plate([[0.085, -0.026], [0.34, -0.034], [0.58, 0.004], [0.38, 0.04], [0.085, 0.03]], 0.016, 0.5, 1.25, edgeCol);
    });
    info.tip.set(0, 0, -0.58); info.base.set(0, 0, -0.09);
  } else if (cls === 'spear') {
    const gold = mixc(new Color(0xe0b85a), metal, 0.25);
    shaft(() => {
      b.color(mixc(look.wood, new Color(0xcdb48a), 0.5)).surf(K_WOOD, 0.7);
      b.loft([{ y: -0.92, rx: 0.016 }, { y: 0, rx: 0.0175 }, { y: 1.22, rx: 0.016 }], { seg, capA: true });
      b.color(look.leather).surf(K_LEATHER, 0.8);
      b.loft([{ y: -0.11, rx: 0.021 }, { y: 0.11, rx: 0.021 }], { seg });
      b.loft([{ y: 0.36, rx: 0.02 }, { y: 0.54, rx: 0.02 }], { seg });
      b.color(gold).surf(K_METAL, 0.3, 1);
      b.loft([{ y: -1.04, rx: 0 }, { y: -0.93, rx: 0.02 }, { y: -0.9, rx: 0.018 }], { seg: 5 });
      b.loft([{ y: 1.13, rx: 0.019 }, { y: 1.17, rx: 0.027 }, { y: 1.26, rx: 0.02 }], { seg });
      b.box(0, 1.215, 0, 0.022, 0.03, 0.17);
      b.loft([{ y: 0.7, rx: 0.019 }, { y: 0.715, rx: 0.023 }, { y: 0.73, rx: 0.019 }], { seg });
      b.color(el).surf(K_PLAIN, 0.4, 0, 1.6);
      b.loft([{ y: 1.085, rx: 0.019 }, { y: 1.1, rx: 0.03 }, { y: 1.115, rx: 0.019 }], { seg });
    });
    plane(() => {
      b.color(gold).surf(K_METAL, 0.25, 1);
      b.plate([[1.24, -0.022], [1.36, -0.062], [1.68, 0], [1.36, 0.062], [1.24, 0.022]], 0.022, 0.5, 0.9, mixc(el, core, 0.4));
    });
    info.tip.set(0, 0, -1.68); info.base.set(0, 0, -1.22); info.grip2 = new Vector3(0, 0, -0.45);
  }
  b.pop();
  b.shadeFn = saveShade;
  return info;
}
