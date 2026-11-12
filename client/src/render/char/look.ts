// Appearance: who a fighter is (from the seed) and what they wear (from the element).
// The person — skin, hair, beard, build, cloth dyes — is stable across elements; the element
// decides gear, accent colours and the signature weapon.

import { Color } from 'three';
import { ELEMENTS, type ElementId } from '@shared/elements';
import { makeRng } from './mathx';

export type HairStyle = 'bald' | 'short' | 'long' | 'braids' | 'topknot' | 'mohawk';
export type BeardStyle = 'none' | 'short' | 'full' | 'braided' | 'forked';
export type HelmStyle = 'none' | 'nasal' | 'spectacle' | 'horned' | 'hood' | 'deephood' | 'furcap' | 'circlet' | 'winged' | 'headband';
export type MantleStyle = 'fur' | 'pauldrons' | 'feather' | 'scale' | 'collar' | 'none';
export type CloakStyle = 'long' | 'short' | 'half' | 'none';
export type WeaponClass = 'axe' | 'sword' | 'rod' | 'hammer' | 'none' | 'harpoon' | 'dagger' | 'spear';

export const WEAPON_OF: Record<ElementId, WeaponClass> = {
  ember: 'axe', frost: 'sword', storm: 'rod', stone: 'hammer', gale: 'none', tide: 'harpoon', umbra: 'dagger', dawn: 'spear',
};

export interface Look {
  seed: number;
  element: ElementId;
  dummy: boolean;
  skin: Color; hair: Color; brow: Color;
  hairStyle: HairStyle; beardStyle: BeardStyle; helm: HelmStyle; mantle: MantleStyle; cloak: CloakStyle;
  weapon: WeaponClass;
  /** Build multipliers. */
  shoulders: number; girth: number; limb: number; headScale: number;
  /** Overall height multiplier. */
  scale: number;
  tunic: Color; trim: Color; trousers: Color; leather: Color; leatherDark: Color; metal: Color; metalDark: Color;
  cloakCol: Color; lining: Color; fur: Color; wrap: Color; wood: Color;
  /** Element colours (linear). */
  elColor: Color; elCore: Color; elDark: Color;
  bareArms: boolean; legWraps: boolean; warpaint: number; scar: boolean;
  eyeGlow: number;
  /** Variation numbers 0..1 for small details. */
  v: number[];
}

const hex = (h: number): Color => new Color().setHex(h);
const mix = (a: Color, b: Color, t: number): Color => a.clone().lerp(b, t);

const SKINS = [0xf0c9a8, 0xe3b08c, 0xcf9670, 0xb07850, 0x8a5a3a, 0x6a4028, 0xe8bfa0, 0xd9a47e];
const HAIRS = [0xd9b86a, 0xc0803a, 0xa8421c, 0x6b4426, 0x3a2a1e, 0x1c1814, 0xb9b4aa, 0xe6e0d2, 0x8a5a2a];
// muted Norse dyes
const TUNICS = [0x7a3b2a, 0x8a6a2e, 0x3f5a3a, 0x3a5068, 0x5a5560, 0x2f5a5a, 0x5e3a56, 0x8a4a26, 0x6b6b4a, 0x444a58];
const TROUSERS = [0x3c3028, 0x4a4238, 0x2e3238, 0x55483a, 0x383028, 0x2a2a30];
const LEATHERS = [0x5a3a22, 0x4a2e1c, 0x6b4a2c, 0x3a2a20];
const FURS = [0x8a7a66, 0x5a4a3c, 0xcfc8ba, 0x3a342e, 0x9a8468, 0x6e665e];
const METALS = [0x8e949c, 0x7d8690, 0xa08a5a, 0x6a6e76];

const HELMS: Record<ElementId, HelmStyle[]> = {
  ember: ['nasal', 'none', 'nasal', 'spectacle', 'none', 'furcap'],
  frost: ['hood', 'furcap', 'nasal', 'none', 'spectacle', 'hood'],
  storm: ['spectacle', 'none', 'circlet', 'nasal', 'none', 'spectacle'],
  stone: ['horned', 'horned', 'nasal', 'spectacle', 'none', 'horned'],
  gale: ['headband', 'none', 'headband', 'circlet', 'none', 'headband'],
  tide: ['none', 'headband', 'nasal', 'none', 'spectacle', 'furcap'],
  umbra: ['deephood', 'deephood', 'deephood', 'deephood', 'deephood', 'deephood'],
  dawn: ['winged', 'circlet', 'winged', 'none', 'winged', 'circlet'],
};
const MANTLES: Record<ElementId, MantleStyle[]> = {
  ember: ['fur', 'pauldrons', 'fur'], frost: ['fur', 'fur', 'collar'], storm: ['pauldrons', 'collar', 'pauldrons'], stone: ['pauldrons', 'pauldrons', 'fur'],
  gale: ['feather', 'feather', 'feather'], tide: ['scale', 'scale', 'collar'], umbra: ['collar', 'none', 'collar'], dawn: ['pauldrons', 'collar', 'pauldrons'],
};
const CLOAKS: Record<ElementId, CloakStyle[]> = {
  ember: ['long', 'short', 'long'], frost: ['long', 'long', 'short'], storm: ['short', 'long', 'half'], stone: ['none', 'short', 'none'],
  gale: ['none', 'none', 'short'], tide: ['long', 'short', 'half'], umbra: ['long', 'long', 'long'], dawn: ['half', 'long', 'half'],
};

export function makeLook(seed: number, element: ElementId, dummy: boolean): Look {
  // person
  const r = makeRng((seed >>> 0) * 2654435761 + 12345);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
  const skin = hex(pick(SKINS));
  const hairHex = pick(HAIRS);
  const hair = hex(hairHex);
  const hairStyle = pick<HairStyle>(['short', 'long', 'braids', 'topknot', 'mohawk', 'bald', 'braids', 'long']);
  const beardStyle = pick<BeardStyle>(['none', 'short', 'full', 'braided', 'forked', 'full', 'none', 'short']);
  const shoulders = 0.93 + r() * 0.17;
  const girth = 0.9 + r() * 0.24;
  const limb = 0.93 + r() * 0.16;
  const headScale = 1.06 + r() * 0.07;
  const scale0 = 0.95 + r() * 0.1;
  const tunicBase = hex(pick(TUNICS));
  const trousers = hex(pick(TROUSERS));
  const leather = hex(pick(LEATHERS));
  const fur = hex(pick(FURS));
  const metalBase = hex(pick(METALS));
  const warpaint = r() < 0.4 ? 1 + Math.floor(r() * 3) : 0;
  const scar = r() < 0.3;
  const v: number[] = [];
  for (let i = 0; i < 12; i++) v.push(r());
  const gearIdx = Math.floor(r() * 6);
  const gearIdx2 = Math.floor(r() * 3);
  const gearIdx3 = Math.floor(r() * 3);

  // element
  const ed = ELEMENTS[element];
  const elColor = hex(ed.color), elCore = hex(ed.core), elDark = hex(ed.dark);
  // cloth leans toward the element's dark tone so a team of one element reads as a set, but keeps its dye
  const tunic = mix(tunicBase, elDark, 0.34).multiplyScalar(1.35);
  const trimCol = mix(elColor, elDark, 0.45);
  const cloakCol = mix(mix(tunicBase, hex(0x20242c), 0.55), elDark, 0.5);
  const lining = mix(elColor, elDark, 0.6);
  let metal = metalBase, wrap = hex(0xd8cfc0);
  if (element === 'dawn') metal = mix(hex(0xd8b25a), metalBase, 0.2);
  if (element === 'stone') metal = mix(hex(0x8a7a5a), metalBase, 0.5);
  if (element === 'umbra') metal = mix(hex(0x3a3640), metalBase, 0.3);
  if (element === 'gale') wrap = mix(hex(0xe8efe6), elColor, 0.12);

  const look: Look = {
    seed, element, dummy,
    skin, hair, brow: mix(hair, hex(0x1a1410), 0.45),
    hairStyle, beardStyle,
    helm: HELMS[element][gearIdx], mantle: MANTLES[element][gearIdx2], cloak: CLOAKS[element][gearIdx3],
    weapon: WEAPON_OF[element],
    shoulders, girth, limb, headScale, scale: scale0,
    tunic, trim: trimCol, trousers, leather, leatherDark: mix(leather, hex(0x0c0a08), 0.5), metal, metalDark: mix(metal, hex(0x101214), 0.55),
    cloakCol, lining, fur, wrap, wood: hex(0x5a4028),
    elColor, elCore, elDark,
    bareArms: element === 'gale' || (element === 'stone' && v[3] < 0.5) || (element === 'ember' && v[3] < 0.25),
    legWraps: element === 'gale' || v[4] < 0.35,
    warpaint, scar,
    eyeGlow: element === 'umbra' ? 1.6 : 0.35,
    v,
  };
  if (element === 'umbra') { look.tunic = mix(tunicBase, hex(0x15101c), 0.72); look.cloakCol = mix(hex(0x120e1a), elDark, 0.35); look.trousers = mix(trousers, hex(0x101014), 0.5); }
  if (element === 'frost') { look.fur = mix(fur, hex(0xe6ecf2), 0.6); look.cloakCol = mix(hex(0x3a4a5e), elDark, 0.4); }
  if (element === 'stone') { look.girth *= 1.08; look.shoulders *= 1.05; look.scale *= 1.03; }
  if (element === 'gale') { look.girth *= 0.93; look.scale *= 0.975; look.tunic = mix(tunicBase, hex(0xd8e0d4), 0.45); }
  if (element === 'dawn') { look.tunic = mix(tunicBase, hex(0xe8dcc0), 0.5); look.cloakCol = mix(hex(0xe8e0cc), elDark, 0.25); look.lining = mix(elColor, hex(0xffffff), 0.1); }
  if (element === 'tide') { look.cloakCol = mix(hex(0x1c3a4a), elDark, 0.45); }
  if (dummy) {
    look.helm = 'nasal'; look.mantle = 'none'; look.cloak = 'none'; look.weapon = 'none';
    look.shoulders = 1; look.girth = 1.08; look.limb = 1; look.headScale = 1.1; look.scale = 1;
  }
  return look;
}
