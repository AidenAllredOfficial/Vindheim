// Entry point: start the game on the page's canvas and interface root.
import { App } from './app';
import * as char from './render/char';
import * as env from './render/env';
import * as vfx from './render/vfx';
import * as audio from './audio';
import * as ui from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const app = new App(canvas, uiRoot, { char, env, vfx, audio, ui });
app.start().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:#070b14;color:#e8e2d0;font:16px/1.5 system-ui,sans-serif;text-align:center;z-index:9999';
  el.textContent = 'Vindheim could not start on this device. Please try a recent version of Chrome, Firefox, Edge or Safari with hardware acceleration enabled.';
  document.body.appendChild(el);
});
