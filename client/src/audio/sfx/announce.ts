// The announcer has no voice: each AnnounceKind is a short figure for lur horns, war drums,
// choir, bell and anvil, recorded "in a big room" (reverb baked in) and played non-positionally.

import { G, P, S, H, X } from '../kit';
import type { DefMap, SoundDef } from '../bank';
import type { AnnounceKind } from '@shared/types';
import { horn, choir, warDrum, frameDrum, bell, anvil } from '../music/voices';

// equal-tempered pitches used below
const A2 = 110, Bb2 = 116.54, C3 = 130.81, D3 = 146.83, E3 = 164.81, F3 = 174.61, G3 = 196, A3 = 220, D4 = 293.66, F4 = 349.23, Fs4 = 369.99, A4 = 440;

/** A stage: returns the node to play into; signal reaches the output dry and through the room. */
function stage(g: G, wet = 0.28): GainNode {
  const input = g.gain(1);
  input.connect(g.out);
  input.connect(g.reverb('big', wet));
  return input;
}

const sting = (dur: number, lvl: number, build: (g: G, st: GainNode) => void): SoundDef => ({ dur, lvl, fadeOut: 0.25, build: (g) => build(g, stage(g)) });

export const ANNOUNCE_KINDS: AnnounceKind[] = ['firstblood', 'double', 'triple', 'rampage', 'unstoppable', 'shutdown', 'ringout', 'matchstart', 'oneminute', 'tenseconds', 'matchend', 'lead'];

export function announceDefs(): DefMap {
  const d: Record<AnnounceKind, SoundDef> = {
    // a single war horn rising a fifth over one great drum
    firstblood: sting(2.4, 0.2, (g, s) => {
      warDrum(g, 0, 1, s, { hard: 1 });
      horn(g, 0, 0.26, D3, 0.7, s);
      horn(g, 0.32, 1.0, A3, 0.8, s, { bright: 1.2 });
      horn(g, 0.32, 1.0, D3, 0.4, s);
    }),
    // two strokes, two notes
    double: sting(1.8, 0.19, (g, s) => {
      frameDrum(g, 0, 0.9, 'dum', s);
      warDrum(g, 0.18, 1, s, { hard: 0.8 });
      horn(g, 0, 0.14, A3, 0.7, s, { attack: 0.03 });
      horn(g, 0.18, 0.7, D4, 0.8, s, { bright: 1.2 });
    }),
    // three strokes climbing D - A - D
    triple: sting(2.1, 0.2, (g, s) => {
      frameDrum(g, 0, 0.7, 'dum', s);
      frameDrum(g, 0.15, 0.85, 'dum', s, 1.1);
      warDrum(g, 0.3, 1, s, { hard: 1 });
      horn(g, 0, 0.11, D3, 0.6, s, { attack: 0.03 });
      horn(g, 0.15, 0.11, A3, 0.7, s, { attack: 0.03 });
      horn(g, 0.3, 0.85, D4, 0.85, s, { bright: 1.25 });
      horn(g, 0.3, 0.85, A3, 0.4, s);
    }),
    // an accelerating roll into a full open chord and an anvil blow
    rampage: sting(2.6, 0.22, (g, s) => {
      [0, 0.11, 0.21, 0.3, 0.38, 0.45].forEach((t, i) => frameDrum(g, t, 0.45 + i * 0.1, 'dum', s, 1 + i * 0.03));
      warDrum(g, 0.52, 1.1, s, { hard: 1 });
      anvil(g, 0.52, 0.7, s);
      horn(g, 0.52, 1.1, D3, 0.6, s, { bright: 1.3 });
      horn(g, 0.52, 1.1, A3, 0.7, s, { bright: 1.3 });
      horn(g, 0.52, 1.1, D4, 0.75, s, { bright: 1.3 });
    }),
    // the choir enters: a D minor wall, four hammer strokes, horns climbing the triad
    unstoppable: sting(3.4, 0.23, (g, s) => {
      for (const f of [D3, D4, F4, A4]) choir(g, 0, 1.9, f, 0.5, 'ah', s, { attack: 0.08, release: 0.5 });
      [0, 0.4, 0.8, 1.2].forEach((t, i) => warDrum(g, t, 0.8 + i * 0.08, s, { hard: 0.7 + i * 0.1 }));
      horn(g, 0, 0.36, D3, 0.6, s);
      horn(g, 0.4, 0.36, F3, 0.65, s);
      horn(g, 0.8, 0.36, A3, 0.7, s);
      horn(g, 1.2, 1.0, D4, 0.85, s, { bright: 1.3 });
      bell(g, 1.2, D4, 0.6, 1.6, s);
      anvil(g, 1.2, 0.5, s);
    }),
    // a streak ended: the horn falls back down the triad onto one low stroke
    shutdown: sting(2.3, 0.18, (g, s) => {
      horn(g, 0, 0.28, A3, 0.7, s, { bright: 0.9 });
      horn(g, 0.32, 0.28, F3, 0.7, s, { bright: 0.8 });
      horn(g, 0.64, 0.9, D3, 0.75, s, { bright: 0.7 });
      warDrum(g, 0.64, 1, s, { f: 52, hard: 0.6 });
      frameDrum(g, 0, 0.6, 'ka', s);
    }),
    // someone went over the edge: the horn itself falls
    ringout: sting(2.4, 0.18, (g, s) => {
      const filt = g.lp([[0, 300], [0.06, 2000, 'e'], [1.0, 600, 'e']], 1.2);
      const amp = g.gain(H(0, 0.05, 0.75, 0.3, 0.7));
      g.pipe(s, filt, amp);
      g.pipe(filt, g.osc('sawtooth', [[0, 233], [0.12, 233], [1.0, 110, 'e']]), g.gain(0.5));
      g.pipe(filt, g.osc('sawtooth', [[0, 235], [0.12, 235], [1.0, 111, 'e']]), g.gain(0.35));
      g.nz('white', 'bandpass', X(0, 1.2, 3000, 300), 2, S(0, 1.3, 0.5, 0.15), s);
      frameDrum(g, 0, 0.8, 'dum', s);
      warDrum(g, 0.95, 0.9, s, { f: 50, hard: 0.5 });
    }),
    // the call to battle: D - A - D over "DUM . dum dum DUM", choir and bell on the arrival
    matchstart: sting(3.8, 0.23, (g, s) => {
      warDrum(g, 0, 1, s, { hard: 1 });
      warDrum(g, 0.5, 0.7, s, { hard: 0.6 });
      warDrum(g, 0.75, 0.8, s, { hard: 0.7 });
      warDrum(g, 1.0, 1.1, s, { hard: 1 });
      horn(g, 0, 0.42, D3, 0.7, s);
      horn(g, 0.5, 0.42, A3, 0.75, s);
      horn(g, 1.0, 1.6, D4, 0.85, s, { bright: 1.25 });
      horn(g, 1.0, 1.6, A3, 0.5, s);
      horn(g, 1.0, 1.6, D3, 0.5, s);
      choir(g, 1.0, 1.5, D4, 0.35, 'ah', s, { attack: 0.3, release: 0.6 });
      choir(g, 1.0, 1.5, A4, 0.3, 'ah', s, { attack: 0.3, release: 0.6 });
      bell(g, 1.0, D4, 0.6, 2, s);
    }),
    // one minute: two tolls and a long low horn
    oneminute: sting(3.2, 0.17, (g, s) => {
      bell(g, 0, D4, 1, 2.2, s);
      bell(g, 0.9, D4, 0.75, 2, s);
      horn(g, 0.1, 1.7, A2, 0.5, s, { bright: 0.8, attack: 0.2 });
      frameDrum(g, 0, 0.5, 'ka', s);
      frameDrum(g, 0.9, 0.4, 'ka', s);
    }),
    // ten seconds: a hurried figure on rim and anvil, a horn stab
    tenseconds: sting(1.8, 0.2, (g, s) => {
      [0, 0.12, 0.24, 0.36].forEach((t, i) => frameDrum(g, t, 0.6 + i * 0.1, 'tak', s));
      warDrum(g, 0.48, 1, s, { hard: 1 });
      anvil(g, 0, 0.6, s);
      anvil(g, 0.48, 0.8, s, 1.12);
      horn(g, 0.48, 0.34, A3, 0.75, s, { bright: 1.4, attack: 0.03 });
      horn(g, 0.48, 0.34, D4, 0.75, s, { bright: 1.4, attack: 0.03 });
    }),
    // the end: B-flat, C, and home to a bright D major
    matchend: sting(4.0, 0.23, (g, s) => {
      for (const f of [Bb2, D3, F3]) horn(g, 0, 0.48, f, 0.55, s);
      for (const f of [C3, E3, G3]) horn(g, 0.55, 0.48, f, 0.6, s);
      for (const f of [D3, A3, D4, Fs4]) horn(g, 1.1, 1.7, f, 0.6, s, { bright: 1.25 });
      warDrum(g, 0, 0.9, s, { hard: 0.8 });
      warDrum(g, 0.55, 0.95, s, { hard: 0.9 });
      [0.8, 0.9, 1.0].forEach((t, i) => frameDrum(g, t, 0.5 + i * 0.15, 'dum', s));
      warDrum(g, 1.1, 1.15, s, { hard: 1 });
      bell(g, 1.1, D4, 0.7, 2.4, s);
      bell(g, 1.1, A4, 0.4, 2, s);
      for (const f of [D4, Fs4, A4]) choir(g, 1.1, 1.6, f, 0.3, 'ah', s, { attack: 0.2, release: 0.7 });
    }),
    // took the lead: a quick bright two-note lift with a rune glint
    lead: sting(1.3, 0.15, (g, s) => {
      frameDrum(g, 0, 0.6, 'tak', s);
      horn(g, 0, 0.1, A3, 0.6, s, { attack: 0.03 });
      horn(g, 0.14, 0.42, D4, 0.75, s, { bright: 1.2, attack: 0.04 });
      g.modal(0.14, [[1174.7, 1, 0.5], [1760, 0.6, 0.4], [2349, 0.3, 0.3]], 0.12, s);
      g.tone('sine', 3520, P(0.16, 0.002, 0.2, 0.02), s);
    }),
  };
  const out: DefMap = {};
  for (const k of ANNOUNCE_KINDS) out['ann.' + k] = d[k];
  return out;
}
