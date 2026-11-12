// Connection to the game: a WebSocket to the server, or — when no server can be reached — the
// same lobby code running in-page for offline practice against bots.

import { Lobby, sanitizeProfile, type Conn, type ProfileStore } from '@shared/net/lobby';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@shared/net/protocol';
import { TICK_RATE, type Profile } from '@shared/types';

export type NetState = 'connecting' | 'online' | 'reconnecting' | 'offline';

const TOKEN_KEY = 'vindheim.token';
const LOCAL_PROFILE_KEY = 'vindheim.offline.profile';

function getStored(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function setStored(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

class LocalStore implements ProfileStore {
  load(): Profile | null {
    try { return sanitizeProfile(JSON.parse(getStored(LOCAL_PROFILE_KEY) || 'null')); } catch { return null; }
  }
  save(_token: string, profile: Profile): void { setStored(LOCAL_PROFILE_KEY, JSON.stringify(profile)); }
  newToken(): string { return 'a'.repeat(32); }
}

export class Net {
  state: NetState = 'connecting';
  /** True when running the simulation in-page (no server). */
  local = false;
  /** Round-trip time in ms (0 offline). */
  rtt = 0;
  /** Server clock (seconds) minus local clock (seconds). */
  clockOffset = 0;
  onMessage: (m: ServerMsg) => void = () => {};
  onState: (s: NetState, detail?: string) => void = () => {};

  private ws: WebSocket | null = null;
  private attempts = 0;
  private everOnline = false;
  private closed = false;
  private pingTimer = 0;
  private lobby: Lobby | null = null;
  private localConn: Conn | null = null;
  private localTimer = 0;
  private name: string | undefined;

  constructor(private url: string) {}

  /** @param forceLocal skip the server entirely (offline practice / static hosting) */
  start(name?: string, forceLocal = false): void {
    this.name = name;
    if (forceLocal) this.startLocal(); else this.connect();
    window.addEventListener('beforeunload', () => { this.closed = true; this.ws?.close(); });
  }

  private setState(s: NetState, detail?: string) { this.state = s; this.onState(s, detail); }

  private connect() {
    if (this.closed) return;
    this.setState(this.everOnline ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.failed(); return; }
    this.ws = ws;
    const timeout = window.setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 5000);
    ws.onopen = () => {
      clearTimeout(timeout);
      this.attempts = 0; this.everOnline = true;
      this.setState('online');
      this.raw({ t: 'hello', v: PROTOCOL_VERSION, token: getStored(TOKEN_KEY) || undefined, name: this.name });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.raw({ t: 'ping', c: performance.now(), rtt: this.rtt }), 2000);
      this.raw({ t: 'ping', c: performance.now() });
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data as string); } catch { return; }
      this.handle(m);
    };
    ws.onclose = () => {
      clearTimeout(timeout); clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.failed();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private failed() {
    if (this.closed) return;
    this.attempts++;
    // never reached a server: after two tries, play offline. Lost a live connection: keep retrying.
    if (!this.everOnline && this.attempts >= 2) { this.startLocal(); return; }
    this.setState(this.everOnline ? 'reconnecting' : 'connecting');
    window.setTimeout(() => this.connect(), Math.min(8000, 600 * 2 ** Math.min(this.attempts, 4)));
  }

  private handle(m: ServerMsg) {
    if (m.t === 'welcome') { if (!this.local) setStored(TOKEN_KEY, m.token); this.clockOffset = m.now - Date.now() / 1000; }
    else if (m.t === 'pong') {
      if (!this.local) {
        const rtt = performance.now() - m.c;
        this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
        this.clockOffset = m.now + rtt / 2000 - Date.now() / 1000;
      }
      return;
    }
    this.onMessage(m);
  }

  /** Run the whole game in this page: same simulation, same bots, progress saved locally. */
  private startLocal() {
    this.local = true;
    this.rtt = 0;
    const lobby = new Lobby(new LocalStore());
    this.lobby = lobby;
    const conn: Conn = { send: (msg) => { queueMicrotask(() => this.handle(structuredCloneSafe(msg))); } };
    this.localConn = conn;
    lobby.connect(conn);
    let last = performance.now(), acc = 0;
    const step = 1000 / TICK_RATE;
    this.localTimer = window.setInterval(() => {
      const now = performance.now();
      acc = Math.min(acc + now - last, step * 6);
      last = now;
      while (acc >= step) { acc -= step; lobby.tick(); }
    }, 8);
    this.setState('offline', 'practice against bots on this device; progress is saved locally');
    lobby.receive(conn, { t: 'hello', v: PROTOCOL_VERSION, token: 'a'.repeat(32), name: this.name });
  }

  private raw(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  send(msg: ClientMsg): void {
    if (this.local && this.lobby && this.localConn) this.lobby.receive(this.localConn, msg);
    else this.raw(msg);
  }

  /** Estimated server wall-clock time in seconds (drives the shared weather). */
  serverNow(): number { return Date.now() / 1000 + this.clockOffset; }
}

/** Local messages share object references with the simulation; copy them like a socket would. */
function structuredCloneSafe<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

export function defaultServerUrl(): string {
  const env = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
