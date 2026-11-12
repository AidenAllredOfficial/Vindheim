// Game core harness: the real client loop (net, prediction, camera, input) with any mix of real
// and stand-in presentation modules.  /dev/core.html?real=ui,env   (default: ui only)
// Stand-ins show flat-shaded collision geometry, capsule fighters and dots for projectiles.
import { App, type Modules } from '../src/app';
import { stubAudio, stubChar, stubEnv, stubVfx } from './stubs';

const want = new Set((new URLSearchParams(location.search).get('real') || 'ui').split(','));
const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

(async () => {
  const mods: Modules = {
    ui: await import('../src/ui'),
    env: want.has('env') ? await import('../src/render/env') : stubEnv,
    char: want.has('char') ? await import('../src/render/char') : stubChar,
    vfx: want.has('vfx') ? await import('../src/render/vfx') : stubVfx,
    audio: want.has('audio') ? await import('../src/audio') : stubAudio,
  };
  await new App(canvas, uiRoot, mods).start();
})().catch((e) => console.error(e));
