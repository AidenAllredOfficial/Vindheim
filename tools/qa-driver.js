// QA driver injected into the page by tools/qa.sh: seeds an offline profile and plays the game by
// writing to the input manager (window.__vindheim is the running App).
window.QA = {
  seed(equipped, n, glory) {
    const els = ['ember','frost','storm','stone','gale','tide','umbra','dawn'];
    localStorage.setItem('vindheim.offline.profile', JSON.stringify({ name: 'Skald', glory: glory == null ? 640 : glory, owned: els.slice(0, n || 8), equipped: equipped || 'ember', created: Date.now(), stats: { kills: 212, deaths: 148, ringouts: 31, falls: 9, damage: 48210, hits: 3120, matches: 37, wins: 9, podiums: 21, bestStreak: 9, bestMatchKills: 17, gloryEarned: 9390, playSeconds: 15400, elementKills: {} } }));
    localStorage.setItem('vindheim.settings.v1', JSON.stringify({ dynamicResolution: false, quality: 'high' })); localStorage.setItem('vindheim.tutorial.v1', JSON.stringify({ move: 1, pedestal: 1, ring: 1, deploy: 1, arena: 1, edge: 1, glory: 1, recall: 1 }));
  },
  nearest() {
    const a = __vindheim, m = a.state.myView; let best = null, bd = 1e9;
    for (const r of a.state.remotes.values()) { const v = r.view; if (!v.alive || !v.visible || v.inHall !== m.inHall || (m.inHall && !v.isDummy)) continue; const d = Math.hypot(v.x - m.x, v.z - m.z); if (d < bd) { bd = d; best = v; } }
    return best ? { v: best, d: bd } : null;
  },
  aim() {
    const a = __vindheim, m = a.state.myView, n = this.nearest(); if (!n) return null;
    const dx = n.v.x - m.x, dz = n.v.z - m.z, dy = (n.v.y + 1.0) - (m.y + 2.0);
    a.input.yaw = Math.atan2(-dx, -dz) - 0.06; a.input.pitch = Math.atan2(dy, n.d) + 0.02; return n;
  },
  fight(pref) {
    const a = __vindheim; a.input.enabled = true; clearInterval(this.iv); let k = 0;
    this.iv = setInterval(() => {
      const n = this.aim(); const d = a.input.down; k++;
      d.delete('Mouse0'); d.delete('Mouse2'); d.delete('KeyE'); d.delete('KeyR');
      if (!n) { d.add('KeyW'); return; }
      if (n.d > (pref || 9)) d.add('KeyW'); else d.delete('KeyW');
      const phase = Math.floor(k / 25) % 4;
      if (n.d < 3.4) d.add('Mouse0'); else if (phase === 0) d.add('Mouse2'); else if (phase === 1) d.add('KeyE'); else if (phase === 2) d.add('KeyR'); else d.add('Mouse2');
    }, 33);
  },
  stop() { clearInterval(this.iv); __vindheim.input.down.clear(); },
  press(code, ms) { const d = __vindheim.input.down; d.add(code); setTimeout(() => d.delete(code), ms || 120); },
  info() { const a = __vindheim, m = a.state.me; return JSON.stringify({ fps: a.fps, q: a.quality, scale: a.dynScale, hp: m.hp, alive: m.alive, hall: m.hall, el: m.el, pos: [m.x.toFixed(1), m.y.toFixed(1), m.z.toFixed(1)], phase: a.match.phase, ents: a.state.ents.size }); },
};
QA.walkTo = (x, z, stop = 1.2) => new Promise((res) => { const a = __vindheim; a.input.enabled = true; const iv = setInterval(() => { const m = a.state.me; const dx = x - m.x, dz = z - m.z; const d = Math.hypot(dx, dz); a.input.yaw = Math.atan2(-dx, -dz); a.input.pitch = -0.1; if (d < stop) { a.input.down.delete('KeyW'); clearInterval(iv); res(d); } else a.input.down.add('KeyW'); }, 30); setTimeout(() => { clearInterval(iv); a.input.down.delete('KeyW'); res(-1); }, 12000); });
QA.toRing = async () => { await QA.walkTo(0, -146.5); await QA.walkTo(0, -140); await QA.walkTo(10, -133); await QA.walkTo(16.2, -133, 0.8); QA.aim(); return QA.info(); };
QA.cast = (el, code) => { __vindheim.net.send({ t: 'cmd', c: 'trial', v: el }); setTimeout(() => { QA.aim(); QA.press(code, 150); }, 500); };
