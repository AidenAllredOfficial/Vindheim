// Interface sounds: small, tasteful ticks of wood, iron and rune-chime. Never in the way.

import { G, P, S, X } from '../kit';
import type { DefMap, SoundDef } from '../bank';
import type { UiSound } from '../../contracts';
import { horn, warDrum, frameDrum } from '../music/voices';
import { LV } from './common';

const WOOD: [number, number, number][] = [[1, 1, 0.07], [2.35, 0.5, 0.05], [4.1, 0.25, 0.035]];
const IRON: [number, number, number][] = [[1, 1, 0.22], [2.36, 0.6, 0.18], [3.79, 0.42, 0.14], [5.46, 0.25, 0.1]];
const RUNE: [number, number, number][] = [[1, 1, 1], [2, 0.3, 0.7], [3, 0.1, 0.45]];

const wood = (g: G, at: number, f: number, gain = 1, decay = 1): void => { g.modal(at, WOOD, gain * 0.35, undefined, { mul: f, decay }); g.click(at, f * 4, gain * 0.35, undefined, 0.006, 1); };
const iron = (g: G, at: number, f: number, gain = 1, decay = 1): void => { g.modal(at, IRON, gain * 0.2, undefined, { mul: f, decay }); g.click(at, 4800, gain * 0.5, undefined, 0.005, 1); };
const rune = (g: G, at: number, f: number, gain = 1, decay = 0.5): void => g.modal(at, RUNE, gain * 0.22, undefined, { mul: f, decay });

export const UI_SOUNDS: UiSound[] = ['hover', 'click', 'back', 'open', 'close', 'equip', 'unlock', 'denied', 'glory', 'chat', 'countdown', 'deploy', 'toast'];

const ui = (dur: number, build: (g: G) => void, lvl = LV.ui): SoundDef => ({ dur, build, lvl });

export function uiDefs(): DefMap {
  const d: Record<UiSound, SoundDef> = {
    hover: ui(0.07, (g) => { wood(g, 0, 1900, 1, 0.5); }, 0.035),
    click: ui(0.14, (g) => { wood(g, 0, 430, 1); iron(g, 0.002, 2600, 0.25, 0.25); }),
    back: ui(0.2, (g) => { wood(g, 0, 500, 0.9); wood(g, 0.07, 370, 1); }, 0.075),
    open: ui(0.5, (g) => {
      g.nz('white', 'bandpass', X(0, 0.2, 900, 3200), 1.5, S(0, 0.24, 0.5, 0.6));
      wood(g, 0, 340, 0.8);
      rune(g, 0.08, 587.3, 0.7, 0.4);
      rune(g, 0.1, 880, 0.5, 0.4);
    }),
    close: ui(0.3, (g) => {
      g.nz('white', 'bandpass', X(0, 0.16, 2800, 800), 1.5, S(0, 0.18, 0.5, 0.25));
      wood(g, 0.1, 260, 1, 1.3);
    }),
    equip: ui(0.6, (g) => {
      // a latch, a strap pulled tight, a rune answering
      iron(g, 0, 820, 1);
      g.nz('pink', 'bandpass', 500, 0.9, P(0.03, 0.01, 0.1, 0.8));
      g.thump(0.03, 130, 70, 0.08, 0.5);
      rune(g, 0.1, 880, 0.6, 0.5);
      rune(g, 0.13, 1174.7, 0.45, 0.5);
    }, 0.11),
    unlock: ui(1.7, (g) => {
      // chains fall away, then the rune lights: D - A - D - F# rising, a bloom under it
      iron(g, 0, 640, 1);
      iron(g, 0.06, 910, 0.8);
      g.ticks({ n: 9, from: 0.02, to: 0.3, f: [2500, 6000], q: 4, len: [0.004, 0.012], g: 0.5, bias: 1.4 });
      [587.3, 880, 1174.7, 1480].forEach((f, i) => rune(g, 0.3 + i * 0.09, f, 0.9 - i * 0.08, 1.1));
      g.tone('sine', 146.8, P(0.3, 0.05, 1.1, 0.3));
      g.tone('sine', 220, P(0.3, 0.05, 1.0, 0.15));
      g.blips(14, 0.6, 1.6, [3000, 7000], 1.02, [0.02, 0.06], 0.04, undefined, 1.3);
    }, 0.13),
    denied: ui(0.3, (g) => {
      wood(g, 0, 210, 1, 1.2);
      wood(g, 0.09, 198, 0.9, 1.2);
      g.tone('square', 104, P(0, 0.004, 0.2, 0.08));
      g.tone('square', 110.5, P(0, 0.004, 0.2, 0.06));
    }),
    glory: ui(0.55, (g) => {
      rune(g, 0, 880, 0.8, 0.4);
      rune(g, 0.07, 1318.5, 0.9, 0.5);
      g.blips(6, 0.08, 0.5, [3500, 7000], 1.02, [0.02, 0.05], 0.04, undefined, 1.4);
    }, 0.075),
    chat: ui(0.22, (g) => {
      g.modal(0, [[1, 1, 0.12], [3.9, 0.25, 0.05]], 0.3, undefined, { mul: 880 });
      g.modal(0.07, [[1, 1, 0.14], [3.9, 0.25, 0.05]], 0.3, undefined, { mul: 1108.7 });
    }, 0.06),
    countdown: ui(0.3, (g) => {
      frameDrum(g, 0, 0.9, 'tak');
      wood(g, 0, 300, 0.7, 1.4);
      g.thump(0, 120, 70, 0.1, 0.5);
    }, 0.11),
    deploy: ui(1.4, (g) => {
      // through the Skygate: a low horn, a drum, the rush of the drop
      warDrum(g, 0, 0.9, undefined, { hard: 0.8 });
      horn(g, 0, 0.7, 110, 0.5);
      horn(g, 0.02, 0.7, 165, 0.35);
      g.nz('white', 'bandpass', X(0.1, 1.1, 500, 3600), 1.4, S(0.1, 1.25, 0.6, 0.7));
      rune(g, 0, 587.3, 0.5, 0.8);
    }, 0.14),
    toast: ui(0.7, (g) => { rune(g, 0, 1174.7, 0.9, 0.7); rune(g, 0.012, 1760, 0.5, 0.6); }, 0.06),
  };
  const out: DefMap = {};
  for (const k of UI_SOUNDS) out['ui.' + k] = d[k];
  return out;
}
