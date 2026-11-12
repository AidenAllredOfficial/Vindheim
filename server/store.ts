// Profile persistence: a single JSON file, loaded at start, written atomically and debounced.
// Small, dependency-free, and plenty for a game of this scale (a profile is ~400 bytes).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import type { Profile } from '../shared/types';
import type { ProfileStore } from '../shared/net/lobby';

export class FileProfileStore implements ProfileStore {
  private data = new Map<string, Profile>();
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string, private debounceMs = 2000) {
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        for (const [k, v] of Object.entries(raw)) this.data.set(k, v as Profile);
      }
    } catch (err) {
      // never lose data silently: keep the unreadable file aside and start clean
      const backup = `${file}.corrupt-${Date.now()}`;
      try { renameSync(file, backup); } catch { /* nothing to move */ }
      console.error(`[store] could not read ${file} (${(err as Error).message}); moved to ${backup}`);
    }
  }

  get size(): number { return this.data.size; }

  load(token: string): Profile | null { return this.data.get(token) ?? null; }

  save(token: string, profile: Profile): void {
    this.data.set(token, profile);
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.debounceMs);
  }

  newToken(): string { return randomBytes(24).toString('hex'); }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.data)));
      renameSync(tmp, this.file);
    } catch (err) {
      this.dirty = true;
      console.error(`[store] write failed: ${(err as Error).message}`);
    }
  }
}
