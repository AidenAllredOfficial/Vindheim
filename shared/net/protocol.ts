// Wire protocol between client and server (JSON over WebSocket), plus the compact encodings of
// fighter state used in snapshots.

import type { EntityState, GameEvent, MatchInfo, MatchResults, PlayerState, Profile, RoomInfo, RosterEntry } from '../types';
import { STATE_FIELDS } from '../sim/player';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------- client -> server
export type ClientMsg =
  | { t: 'hello'; v: number; token?: string; name?: string }
  | { t: 'join'; mode: 'public' | 'create' | 'join'; code?: string; bots?: boolean }
  | { t: 'leave' }
  /** Inputs: [seq, mx, mz, yaw, pitch, buttons] per tick, oldest first. */
  | { t: 'in'; i: number[][] }
  | { t: 'cmd'; c: 'deploy' | 'hall' | 'equip' | 'unlock' | 'trial' | 'name' | 'chat'; v?: string | number | null }
  | { t: 'ping'; c: number; rtt?: number };

// ---------------------------------------------------------------- server -> client
export type ServerMsg =
  | { t: 'welcome'; v: number; token: string; profile: Profile; now: number }
  | { t: 'profile'; profile: Profile }
  | { t: 'joined'; room: RoomInfo; you: number; tick: number; roster: RosterEntry[]; ents: EntityState[]; match: MatchInfo; results: MatchResults | null }
  | { t: 'left' }
  /** Snapshot: k tick, a last processed input seq, me own full state, p other fighters, e events. */
  | { t: 's'; k: number; a: number; me: number[]; p: number[][]; e?: GameEvent[] }
  | { t: 'roster'; roster: RosterEntry[]; room: RoomInfo }
  | { t: 'match'; match: MatchInfo; results: MatchResults | null }
  | { t: 'pong'; c: number; now: number }
  | { t: 'err'; code: 'version' | 'room-not-found' | 'room-full' | 'bad-request' | 'rate' | 'replaced'; msg: string };

// ---------------------------------------------------------------- fighter encodings
const q2 = (v: number) => Math.round(v * 100) / 100;
const q3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 10000) / 10000;

export const F_GROUND = 1, F_ALIVE = 2, F_LAUNCHED = 4, F_HALL = 8, F_INV = 16, F_BURN = 32, F_FROZEN = 64,
  F_SHOCK = 128, F_ROOT = 256, F_SLOW = 512, F_BUBBLE = 1024, F_STEALTH = 2048, F_ICE = 4096;

/** Indices into the remote-fighter array. */
export const R = { id: 0, x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, face: 7, yaw: 8, pitch: 9, hp: 10, act: 11, actT: 12, mv: 13, flags: 14, down: 15, stun: 16, chill: 17 } as const;

export function playerFlags(s: PlayerState): number {
  return (s.onGround ? F_GROUND : 0) | (s.alive ? F_ALIVE : 0) | (s.launched ? F_LAUNCHED : 0) | (s.hall ? F_HALL : 0)
    | (s.inv > 0 ? F_INV : 0) | (s.burn > 0 ? F_BURN : 0) | (s.freeze > 0 ? F_FROZEN : 0) | (s.shock > 0 ? F_SHOCK : 0)
    | (s.root > 0 ? F_ROOT : 0) | (s.slow > 0 ? F_SLOW : 0) | (s.bubble > 0 ? F_BUBBLE : 0) | (s.stealth > 0 ? F_STEALTH : 0)
    | (s.ice ? F_ICE : 0);
}

/** Compact view of a fighter for everyone else. */
export function encodeRemote(s: PlayerState): number[] {
  return [s.id, q2(s.x), q2(s.y), q2(s.z), q2(s.vx), q2(s.vy), q2(s.vz), q3(s.face), q3(s.yaw), q3(s.pitch), Math.ceil(s.hp),
    s.act, q2(s.actT), s.mv, playerFlags(s), q2(s.down), q2(s.stun), s.chill];
}

const NUM_FIELDS = STATE_FIELDS;

/**
 * Full state of a fighter for its owner (prediction needs every field). The caller quantises the
 * state first (quantizePlayer) so what is sent is exactly what the server goes on simulating.
 */
export function encodeSelf(s: PlayerState): number[] {
  const out: number[] = new Array(6 + NUM_FIELDS.length);
  out[0] = (s.onGround ? 1 : 0) | (s.ice ? 2 : 0) | (s.alive ? 4 : 0) | (s.hall ? 8 : 0) | (s.launched ? 16 : 0) | (s.airUsed ? 32 : 0);
  for (let i = 0; i < 5; i++) out[1 + i] = q4(s.cd[i]);
  for (let i = 0; i < NUM_FIELDS.length; i++) out[6 + i] = q4((s as any)[NUM_FIELDS[i]]);
  return out;
}

export function decodeSelf(a: number[], s: PlayerState): PlayerState {
  const b = a[0];
  s.onGround = !!(b & 1); s.ice = !!(b & 2); s.alive = !!(b & 4); s.hall = !!(b & 8); s.launched = !!(b & 16); s.airUsed = !!(b & 32);
  for (let i = 0; i < 5; i++) s.cd[i] = a[1 + i];
  for (let i = 0; i < NUM_FIELDS.length; i++) (s as any)[NUM_FIELDS[i]] = a[6 + i];
  return s;
}

/** Room codes: five characters from an alphabet without look-alikes. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
export const normalizeCode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
