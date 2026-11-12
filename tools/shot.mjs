#!/usr/bin/env node
// Headless screenshot / smoke-test helper (dev tool). Drives the system Firefox through
// puppeteer-core (WebDriver BiDi) with WebGL enabled.
//
// Usage:
//   node tools/shot.mjs <url> <out.png> [--w=1280] [--h=720] [--wait=3000] [--logs=40]
//                                        [--eval="step;;;step;;;..."]
// Eval steps (separated by ";;;") run in the page after the initial wait:
//   sleep:500            wait
//   shot:/tmp/a.png      take an extra screenshot
//   anything else        evaluated as JavaScript in the page; a returned value is logged
// Console output and page errors are printed (last --logs lines).
//
// Only ONE headless browser runs at a time machine-wide (memory is tight): callers queue on a
// lock directory, so several people can use the tool concurrently.

import puppeteer from 'puppeteer-core';
import { mkdirSync, rmdirSync, statSync } from 'node:fs';

const LOCK = '/tmp/vindheim-shot.lock';
async function acquire() {
  const start = Date.now();
  for (;;) {
    try { mkdirSync(LOCK); return; } catch {
      try { if (Date.now() - statSync(LOCK).mtimeMs > 180000) rmdirSync(LOCK); } catch { /* raced */ }
      if (Date.now() - start > 900000) throw new Error('timed out waiting for the screenshot lock');
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
    }
  }
}
const release = () => { try { rmdirSync(LOCK); } catch { /* already gone */ } };
process.on('SIGINT', () => { release(); process.exit(1); });
process.on('SIGTERM', () => { release(); process.exit(1); });

const args = process.argv.slice(2);
const url = args[0];
const out = args[1] || '/tmp/shot.png';
const opt = Object.fromEntries(args.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/s); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const w = +(opt.w || 1280), h = +(opt.h || 720), wait = +(opt.wait || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// .jpg / .jpeg outputs are written as JPEG (quality 90), everything else as PNG
const shotOpts = (path) => (/\.jpe?g$/i.test(path) ? { path, type: 'jpeg', quality: 90 } : { path });

if (!url) { console.error('usage: node tools/shot.mjs <url> <out.png> [--w= --h= --wait= --eval=]'); process.exit(2); }

await acquire();
let browser;
try {
  browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: process.env.FIREFOX_BIN || '/run/current-system/sw/bin/firefox',
    headless: true,
    args: ['--width=' + w, '--height=' + h],
    extraPrefsFirefox: {
      'webgl.force-enabled': true,
      'webgl.disabled': false,
      'media.autoplay.default': 0,
      'media.autoplay.blocking_policy': 0,
      'media.autoplay.block-webaudio': false,
      'dom.w3c_touch_events.enabled': opt.mobile ? 1 : 0,
    },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await sleep(wait);
  if (opt.eval) {
    for (const step of opt.eval.split(';;;')) {
      const s = step.trim();
      if (!s) continue;
      const m = s.match(/^sleep:(\d+)$/);
      if (m) { await sleep(+m[1]); continue; }
      const sm = s.match(/^shot:(.+)$/);
      if (sm) { await page.screenshot(shotOpts(sm[1])); continue; }
      try { const r = await page.evaluate(s); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); }
      catch (e) { logs.push('[eval-error] ' + e.message); }
    }
  }
  await page.screenshot(shotOpts(out));
  console.log(logs.slice(-(+(opt.logs || 40))).join('\n'));
  console.log('saved', out);
} finally {
  try { if (browser) await browser.close(); } finally { release(); }
}
