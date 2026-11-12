// Balance harness: runs bot-only matches (one bot per element, equal skill) and prints how each
// element performs. Usage: npx tsx tools/balance.ts [matches=12] [skill=0.7]
import { Game } from '../shared/sim/game';
import { ELEMENT_ORDER } from '../shared/elements';

const matches = Number(process.argv[2] || 12);
const skill = Number(process.argv[3] || 0.7);
const stat = ELEMENT_ORDER.map(() => ({ k: 0, d: 0, dmg: 0, falls: 0, wins: 0, ring: 0 }));
const byKey: Record<string, { hits: number; dmg: number; kills: number }> = {};
let totalFalls = 0, totalDeaths = 0, selfFalls = 0;
const t0 = performance.now();
for (let m = 0; m < matches; m++) {
  const g = new Game({ bots: false, population: 8, seed: 1000 + m * 7919 });
  ELEMENT_ORDER.forEach((el, i) => g.addFighter(el, true, i, false, skill));
  for (let i = 0; i < 60 * 312; i++) {
    g.step();
    for (const ev of g.events) {
      if (ev.e === 'hit') {
        const s = (byKey[ev.k] ||= { hits: 0, dmg: 0, kills: 0 });
        s.hits++; s.dmg += ev.dmg; if (ev.kill) s.kills++;
      } else if (ev.e === 'death') {
        const f = g.fighters.get(ev.p);
        if (!f || f.dummy) continue;
        totalDeaths++;
        if (ev.fall) { totalFalls++; stat[f.equipped].falls++; if (!ev.killer) selfFalls++; else { const kf = g.fighters.get(ev.killer); if (kf) stat[kf.equipped].ring++; (byKey[ev.k] ||= { hits: 0, dmg: 0, kills: 0 }).kills++; } }
      }
    }
    g.events.length = 0; g.privateEvents.clear();
    if (g.match.phase === 'results') break;
  }
  const fs = [...g.fighters.values()].filter((f) => !f.dummy);
  fs.sort((a, b) => b.kills - a.kills);
  stat[fs[0].equipped].wins++;
  for (const f of fs) { const s = stat[f.equipped]; s.k += f.kills; s.d += f.deaths; s.dmg += f.dmg; }
}
console.log(`${matches} matches, skill ${skill}, ${((performance.now() - t0) / 1000).toFixed(1)}s; deaths/match ${(totalDeaths / matches).toFixed(1)}, falls ${(100 * totalFalls / totalDeaths).toFixed(0)}% (unforced ${selfFalls})`);
console.log('element   kills  deaths   K/D   dmg/match  wins  ringouts  fell');
ELEMENT_ORDER.forEach((el, i) => {
  const s = stat[i];
  console.log(`${el.padEnd(8)} ${(s.k / matches).toFixed(1).padStart(6)} ${(s.d / matches).toFixed(1).padStart(7)} ${(s.k / Math.max(1, s.d)).toFixed(2).padStart(6)} ${(s.dmg / matches).toFixed(0).padStart(10)} ${String(s.wins).padStart(5)} ${String(s.ring).padStart(8)} ${String(s.falls).padStart(6)}`);
});
const keys = Object.entries(byKey).sort((a, b) => b[1].dmg - a[1].dmg);
console.log('\nability            hits/m   dmg/m  kills/m');
for (const [k, s] of keys) console.log(`${k.padEnd(16)} ${(s.hits / matches).toFixed(1).padStart(8)} ${(s.dmg / matches).toFixed(0).padStart(7)} ${(s.kills / matches).toFixed(1).padStart(7)}`);
