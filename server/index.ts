// Vindheim game server: serves the built client, accepts WebSocket connections and runs the
// authoritative simulation for every room at 60 Hz.
//
//   PORT       port to listen on (default 8787)
//   HOST       interface to bind (default 0.0.0.0)
//   DATA_DIR   where profiles are stored (default ./data)
//   CLIENT_DIR built client to serve (default ./dist/client next to the working directory)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby, type Conn } from '../shared/net/lobby';
import type { ClientMsg, ServerMsg } from '../shared/net/protocol';
import { TICK_RATE } from '../shared/types';
import { getNav } from '../shared/sim/nav';
import { FileProfileStore } from './store';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = resolve(process.env.DATA_DIR || 'data');
const CLIENT_DIR = resolve(process.env.CLIENT_DIR || 'dist/client');

const store = new FileProfileStore(join(DATA_DIR, 'profiles.json'));
const lobby = new Lobby(store);
const startedAt = Date.now();

// ------------------------------------------------------------------------------ static files
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

function sendFile(res: ServerResponse, file: string, cache: string, head: boolean) {
  const st = statSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  if (head) { res.end(); return; }
  createReadStream(file).pipe(res);
}

function handleHttp(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ...lobby.stats(), profiles: store.size, uptime: Math.round((Date.now() - startedAt) / 1000) }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel: string;
  try { rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''); } catch { res.writeHead(400); res.end(); return; }
  let file = join(CLIENT_DIR, rel);
  if (file !== CLIENT_DIR && !file.startsWith(CLIENT_DIR + sep)) { res.writeHead(403); res.end(); return; }
  const head = req.method === 'HEAD';
  try {
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (existsSync(file)) {
      // hashed build assets never change; everything else is revalidated
      sendFile(res, file, rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', head);
      return;
    }
    const index = join(CLIENT_DIR, 'index.html');
    if (!extname(rel) && existsSync(index)) { sendFile(res, index, 'no-cache', head); return; }
  } catch { /* fall through to 404 */ }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(existsSync(CLIENT_DIR) ? 'Not found' : 'Client build not found. Run "npm run build" first (or use "npm run dev").');
}

const server = createServer((req, res) => {
  // a malformed request line must never take the process (and every room with it) down
  try { handleHttp(req, res); }
  catch { try { if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Bad request'); } catch { /* socket already gone */ } }
});
server.on('clientError', (_err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* gone */ } });

// ------------------------------------------------------------------------------ websockets
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 16 * 1024,
  perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 3 }, concurrencyLimit: 8 },
});

const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS || 2000);
const MAX_PER_ADDRESS = Number(process.env.MAX_PER_ADDRESS || 16);
const perAddress = new Map<string, number>();

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  // behind a proxy the first forwarded address is the client
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const addr = fwd || req.socket.remoteAddress || 'unknown';
  const mine = (perAddress.get(addr) || 0) + 1;
  if (wss.clients.size > MAX_CONNECTIONS || mine > MAX_PER_ADDRESS) { ws.close(1013, 'busy'); return; }
  perAddress.set(addr, mine);
  const conn: Conn = {
    send(msg: ServerMsg) {
      if (ws.readyState !== ws.OPEN) return;
      // a client that cannot keep up gets dropped rather than ballooning server memory
      if (ws.bufferedAmount > 1_500_000) { ws.terminate(); return; }
      ws.send(JSON.stringify(msg));
    },
    close() { ws.close(1008, 'policy'); },
  };
  let alive = true;
  lobby.connect(conn);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try { lobby.receive(conn, msg); } catch (err) { console.error('[ws] message error', err); }
  });
  ws.on('pong', () => { alive = true; });
  const beat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    try { ws.ping(); } catch { /* closing */ }
  }, 15000);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    clearInterval(beat);
    const left = (perAddress.get(addr) || 1) - 1;
    if (left <= 0) perAddress.delete(addr); else perAddress.set(addr, left);
    lobby.disconnect(conn);
  };
  ws.on('close', end);
  ws.on('error', end);
});

// ------------------------------------------------------------------------------ simulation loop
// Fixed 60 Hz with an accumulator so timer jitter never changes game speed.
const STEP_MS = 1000 / TICK_RATE;
let last = performance.now();
let acc = 0;
let slowTicks = 0;
function loop() {
  const now = performance.now();
  acc += now - last;
  last = now;
  if (acc > STEP_MS * 8) { slowTicks += Math.floor(acc / STEP_MS) - 8; acc = STEP_MS * 8; }
  while (acc >= STEP_MS) {
    acc -= STEP_MS;
    try { lobby.tick(); } catch (err) { console.error('[sim] tick error', err); }
  }
  setTimeout(loop, Math.max(1, STEP_MS - acc));
}

getNav(); // build the bot navigation grid before anyone connects
server.listen(PORT, HOST, () => {
  console.log(`[vindheim] listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (profiles: ${store.size}, client: ${existsSync(CLIENT_DIR) ? CLIENT_DIR : 'not built'})`);
  last = performance.now();
  loop();
});

setInterval(() => {
  if (slowTicks > 0) { console.warn(`[sim] dropped ${slowTicks} ticks in the last minute (server overloaded?)`); slowTicks = 0; }
}, 60000).unref();

function shutdown() {
  console.log('[vindheim] shutting down');
  lobby.flush();
  store.flush();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
// last line of defence: log and keep the rooms alive rather than dropping every player
process.on('uncaughtException', (err) => console.error('[vindheim] uncaught exception', err));
process.on('unhandledRejection', (err) => console.error('[vindheim] unhandled rejection', err));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
