// Fighters: procedural character models and a fully procedural animation system.
//
//   import * as chars from './render/char';
//   chars.preload(quality);
//   const view = chars.create({ seed, element, kind: 'fighter', quality });
//   scene.add(view.root);  ...  view.update(dt, playerView, time);
//
// Each character is ONE SkinnedMesh / one draw call (plus one in the shadow pass): body, gear,
// cloak, weapon and glowing trim share a vertex stream and a material. See view.ts.

import type { Camera, Scene, WebGLRenderer } from 'three';
import type { CharacterModule, CharacterOptions, CharacterView } from '../../contracts';
import type { QualityLevel } from '../../settings';
import { getDetailTexture } from './material';
import { keyedFor } from './anims';
import { FighterView } from './view';

export { FighterView } from './view';

/** Build the shared detail texture and the pose library up front. */
export function preload(_quality: QualityLevel): void {
  getDetailTexture();
  keyedFor('swing', 'axe');
}

export function create(opts: CharacterOptions): CharacterView {
  return new FighterView(opts);
}

/**
 * Optional: compile the character shaders (including the stealth variant) inside the live scene so
 * nothing hitches mid-match. Not part of CharacterModule; safe to skip.
 */
export function warmup(renderer: WebGLRenderer, camera: Camera, scene: Scene, quality: QualityLevel): void {
  const v = new FighterView({ seed: 1, element: 'ember', kind: 'fighter', quality });
  v.precompile(renderer, camera, scene);
  v.dispose();
}

const mod: CharacterModule = { preload, create };
export default mod;
