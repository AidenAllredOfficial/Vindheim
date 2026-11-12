// Vindheim audio: a fully synthesised spatial sound-effects engine, ambience and adaptive score.
// No audio files — every sound is generated in code with the Web Audio API.
//
//   import { createAudio } from './audio';
//   const audio = createAudio(world);     // starts rendering the sound bank in the background
//   audio.unlock();                       // from the first user gesture: creates the AudioContext
//
// Layout:
//   dsp.ts / kit.ts      DSP helpers and the terse synthesis kit every recipe is written in
//   bank.ts              SoundDef -> OfflineAudioContext -> levelled AudioBuffer, cached
//   sfx/*                the recipes: eight element families, core combat, footsteps, UI,
//                        announcer stingers, ambience beds
//   music/*              instrument voices, the sampled orchestra, the conductor (the score)
//   catalog.ts           the bank, and the tables mapping entity / fx / teleport kinds to sounds
//   mix.ts               buses, reverbs, duck, master chain (shared with offline analysis)
//   ambience.ts          weather-driven beds, the hall fire, timber creaks
//   engine.ts            the live engine implementing AudioEngine
//   analyze.ts           measurements (level, spectrum, loop seams) and waveform/spectrogram drawing
//   devtools/analysis.ts the offline verification suite behind client/dev/audio.html?analyze=…

import type { AudioEngine, AudioModule } from '../contracts';
import type { World } from '@shared/world';
import { Engine } from './engine';

export function createAudio(world: World): AudioEngine {
  return new Engine(world);
}

export const audioModule: AudioModule = { createAudio };
export { Engine } from './engine';
