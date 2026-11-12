// 2D drawing vocabulary for the hall's procedural textures: Elder Futhark runes as stroke data
// (no font dependency), interlaced knotwork bands / rings, and a few Norse emblems.

export type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

// Each rune: polylines in a 0.6 x 1 box, y up.
const R: Record<string, Pt[][]> = {
  fehu: [[[0.15, 0], [0.15, 1]], [[0.15, 0.42], [0.55, 0.74]], [[0.15, 0.68], [0.55, 1]]],
  uruz: [[[0.1, 0], [0.1, 1], [0.5, 0.7], [0.5, 0]]],
  thurisaz: [[[0.15, 0], [0.15, 1]], [[0.15, 0.76], [0.5, 0.5], [0.15, 0.24]]],
  ansuz: [[[0.15, 0], [0.15, 1]], [[0.15, 1], [0.5, 0.74]], [[0.15, 0.7], [0.5, 0.44]]],
  raidho: [[[0.15, 0], [0.15, 1], [0.5, 0.78], [0.15, 0.55], [0.5, 0]]],
  kaunan: [[[0.5, 0.88], [0.12, 0.5], [0.5, 0.12]]],
  gebo: [[[0.05, 0.08], [0.55, 0.92]], [[0.55, 0.08], [0.05, 0.92]]],
  wunjo: [[[0.15, 0], [0.15, 1], [0.5, 0.75], [0.15, 0.5]]],
  hagalaz: [[[0.1, 0], [0.1, 1]], [[0.5, 0], [0.5, 1]], [[0.1, 0.66], [0.5, 0.34]]],
  nauthiz: [[[0.3, 0], [0.3, 1]], [[0.1, 0.66], [0.5, 0.34]]],
  isaz: [[[0.3, 0], [0.3, 1]]],
  jera: [[[0.36, 0.92], [0.1, 0.66], [0.36, 0.4]], [[0.24, 0.6], [0.5, 0.34], [0.24, 0.08]]],
  eihwaz: [[[0.08, 0.24], [0.3, 0], [0.3, 1], [0.52, 0.76]]],
  perthro: [[[0.5, 1], [0.3, 0.8], [0.1, 1], [0.1, 0], [0.3, 0.2], [0.5, 0]]],
  algiz: [[[0.3, 0], [0.3, 1]], [[0.05, 0.95], [0.3, 0.55], [0.55, 0.95]]],
  sowilo: [[[0.47, 1], [0.13, 0.68], [0.47, 0.36], [0.13, 0]]],
  tiwaz: [[[0.3, 0], [0.3, 1]], [[0.05, 0.7], [0.3, 1], [0.55, 0.7]]],
  berkano: [[[0.12, 0], [0.12, 1], [0.48, 0.75], [0.12, 0.5], [0.48, 0.25], [0.12, 0]]],
  ehwaz: [[[0.08, 0], [0.08, 1], [0.3, 0.7], [0.52, 1], [0.52, 0]]],
  mannaz: [[[0.08, 0], [0.08, 1], [0.52, 0.55]], [[0.52, 0], [0.52, 1], [0.08, 0.55]]],
  laguz: [[[0.2, 0], [0.2, 1], [0.5, 0.68]]],
  ingwaz: [[[0.3, 0.86], [0.55, 0.5], [0.3, 0.14], [0.05, 0.5], [0.3, 0.86]]],
  dagaz: [[[0.05, 0.1], [0.05, 0.9], [0.55, 0.1], [0.55, 0.9], [0.05, 0.1]]],
  othala: [[[0.08, 0], [0.52, 0.62], [0.3, 1], [0.08, 0.62], [0.52, 0]]],
};

export const RUNE_NAMES = Object.keys(R);
const BY_CHAR: Record<string, string> = {
  'ᚠ': 'fehu', 'ᚢ': 'uruz', 'ᚦ': 'thurisaz', 'ᚨ': 'ansuz', 'ᚱ': 'raidho', 'ᚲ': 'kaunan', 'ᚷ': 'gebo', 'ᚹ': 'wunjo',
  'ᚺ': 'hagalaz', 'ᚾ': 'nauthiz', 'ᛁ': 'isaz', 'ᛃ': 'jera', 'ᛇ': 'eihwaz', 'ᛈ': 'perthro', 'ᛉ': 'algiz', 'ᛊ': 'sowilo',
  'ᛏ': 'tiwaz', 'ᛒ': 'berkano', 'ᛖ': 'ehwaz', 'ᛗ': 'mannaz', 'ᛚ': 'laguz', 'ᛜ': 'ingwaz', 'ᛞ': 'dagaz', 'ᛟ': 'othala',
};

/** Index of a rune (0..23) from its Unicode character or name. */
export function runeIndex(charOrName: string): number {
  const name = BY_CHAR[charOrName] || charOrName;
  const i = RUNE_NAMES.indexOf(name);
  return i < 0 ? RUNE_NAMES.indexOf('isaz') : i;
}

/** Trace a rune's strokes as a path, centred on (cx, cy), `h` tall. Caller strokes it. */
export function runePath(c: Ctx, rune: number | string, cx: number, cy: number, h: number, rot = 0): void {
  const name = typeof rune === 'number' ? RUNE_NAMES[((rune % 24) + 24) % 24] : (BY_CHAR[rune] || rune);
  const strokes = R[name] || R.isaz;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  c.beginPath();
  for (const s of strokes) {
    for (let i = 0; i < s.length; i++) {
      const lx = (s[i][0] - 0.3) * h, ly = -(s[i][1] - 0.5) * h;
      const x = cx + lx * cs - ly * sn, y = cy + lx * sn + ly * cs;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
  }
}

export function strokeRune(c: Ctx, rune: number | string, cx: number, cy: number, h: number, width: number, style: string, rot = 0): void {
  c.save();
  c.lineCap = 'square'; c.lineJoin = 'miter';
  c.lineWidth = width; c.strokeStyle = style;
  runePath(c, rune, cx, cy, h, rot);
  c.stroke();
  c.restore();
}

// ------------------------------------------------------------------------------------------------
// Interlace
// ------------------------------------------------------------------------------------------------

export interface RibbonStyle {
  width: number;
  /** Ribbon body, dark outline, thin centre line (optional). */
  body: string; edge: string; line?: string;
  /** Extra outline thickness. */
  edgeW?: number;
}

/**
 * Draws N sinusoidal strands  offset_k(t) = amp * sin(omega t + phase_k)  with correct
 * over/under alternation. `map(t, offset)` places a point (straight band, ring, arc ...).
 */
export function interlace(
  c: Ctx, phases: number[], omega: number, amp: number, t0: number, t1: number,
  map: (t: number, off: number) => Pt, st: RibbonStyle, steps = 220,
): void {
  const n = phases.length;
  const strand = (k: number, a: number, b: number) => {
    const m = Math.max(4, Math.ceil((steps * (b - a)) / (t1 - t0)));
    c.beginPath();
    for (let i = 0; i <= m; i++) {
      const t = a + ((b - a) * i) / m;
      const [x, y] = map(t, amp * Math.sin(omega * t + phases[k]));
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
  };
  const paint = (k: number, a: number, b: number, cap: CanvasLineCap) => {
    c.lineCap = cap; c.lineJoin = 'round';
    strand(k, a, b); c.lineWidth = st.width + (st.edgeW ?? st.width * 0.45) * 2; c.strokeStyle = st.edge; c.stroke();
    strand(k, a, b); c.lineWidth = st.width; c.strokeStyle = st.body; c.stroke();
    if (st.line) { strand(k, a, b); c.lineWidth = Math.max(1, st.width * 0.16); c.strokeStyle = st.line; c.stroke(); }
  };
  c.save();
  for (let k = 0; k < n; k++) paint(k, t0, t1, 'butt');
  // crossings: sin(w t + pi) = sin(w t + pj)  ->  w t = (pi - p_i - p_j) / 2 + m pi
  const cross: { t: number; i: number; j: number }[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a0 = (Math.PI - phases[i] - phases[j]) / 2;
    const mLo = Math.ceil((omega * t0 - a0) / Math.PI - 1e-6), mHi = Math.floor((omega * t1 - a0) / Math.PI + 1e-6);
    for (let m = mLo; m <= mHi; m++) cross.push({ t: (a0 + m * Math.PI) / omega, i, j });
  }
  cross.sort((a, b) => a.t - b.t);
  const last: (boolean | undefined)[] = new Array(n).fill(undefined); // true = was over at its previous crossing
  const span = (Math.PI / omega) * (n === 2 ? 0.3 : 0.2);
  for (const x of cross) {
    let top: number;
    if (last[x.i] !== undefined) top = last[x.i] ? x.j : x.i;
    else if (last[x.j] !== undefined) top = last[x.j] ? x.i : x.j;
    else top = x.i;
    last[x.i] = top === x.i; last[x.j] = top === x.j;
    paint(top, Math.max(t0, x.t - span), Math.min(t1, x.t + span), 'butt');
  }
  c.restore();
}

/** Straight interlace band filling (x0..x1), centred on yc. `periods` whole waves keep it tileable. */
export function braidBand(c: Ctx, x0: number, x1: number, yc: number, amp: number, periods: number, strands: number, st: RibbonStyle): void {
  const phases = Array.from({ length: strands }, (_, k) => (k * Math.PI * 2) / strands);
  const w = x1 - x0;
  // draw one period beyond each side so the cell wraps cleanly
  const om = (Math.PI * 2 * periods) / w;
  interlace(c, phases, om, amp, -w / periods, w + w / periods, (t, off) => [x0 + t, yc + off], st, 260 + periods * 30);
}

/** Circular interlace ring. */
export function braidRing(c: Ctx, cx: number, cy: number, radius: number, amp: number, lobes: number, strands: number, st: RibbonStyle): void {
  const phases = Array.from({ length: strands }, (_, k) => (k * Math.PI * 2) / strands);
  interlace(c, phases, lobes, amp, 0, Math.PI * 2 + 0.0001, (t, off) => [cx + Math.cos(t) * (radius + off), cy + Math.sin(t) * (radius + off)], st, 420);
}

// ------------------------------------------------------------------------------------------------
// Emblems
// ------------------------------------------------------------------------------------------------

/** Valknut: three interlocked triangles. */
export function valknut(c: Ctx, cx: number, cy: number, r: number, st: RibbonStyle): void {
  c.save();
  c.lineJoin = 'miter';
  const tri = (ox: number, oy: number, s: number, pass: number) => {
    c.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      const x = ox + Math.cos(a) * s, y = oy + Math.sin(a) * s;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
    if (pass === 0) { c.lineWidth = st.width + (st.edgeW ?? st.width * 0.45) * 2; c.strokeStyle = st.edge; } else { c.lineWidth = st.width; c.strokeStyle = st.body; }
    c.stroke();
  };
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    const ox = cx + Math.cos(a) * r * 0.36, oy = cy + Math.sin(a) * r * 0.36;
    tri(ox, oy, r * 0.62, 0); tri(ox, oy, r * 0.62, 1);
  }
  c.restore();
}

/** Triskelion: three spirals. */
export function triskele(c: Ctx, cx: number, cy: number, r: number, st: RibbonStyle): void {
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 3; k++) {
      const a0 = (k * Math.PI * 2) / 3;
      const ox = cx + Math.cos(a0) * r * 0.42, oy = cy + Math.sin(a0) * r * 0.42;
      c.beginPath();
      c.moveTo(cx, cy);
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const ang = a0 + Math.PI + t * Math.PI * 2.6;
        const rad = r * 0.42 * (1 - t * 0.86);
        c.lineTo(ox + Math.cos(ang) * rad, oy + Math.sin(ang) * rad);
      }
      if (pass === 0) { c.lineWidth = st.width + (st.edgeW ?? st.width * 0.45) * 2; c.strokeStyle = st.edge; } else { c.lineWidth = st.width; c.strokeStyle = st.body; }
      c.stroke();
    }
  }
  c.restore();
}

/** World-tree: trunk, curling branches above, roots below. */
export function worldTree(c: Ctx, cx: number, cy: number, r: number, st: RibbonStyle, seed = 1): void {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 233280 + 12345) % 2147483647; return (s % 10000) / 10000; };
  const segs: { pts: Pt[]; w: number }[] = [];
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number, curl: number) => {
    const pts: Pt[] = [[x, y]];
    let a = ang;
    const n = 7;
    for (let i = 0; i < n; i++) { a += curl / n; x += Math.cos(a) * (len / n); y += Math.sin(a) * (len / n); pts.push([x, y]); }
    segs.push({ pts, w });
    if (depth <= 0) return;
    const spread = 0.55 + rnd() * 0.25;
    branch(x, y, a - spread, len * 0.68, w * 0.7, depth - 1, -0.9 - rnd() * 0.8);
    branch(x, y, a + spread, len * 0.68, w * 0.7, depth - 1, 0.9 + rnd() * 0.8);
    if (depth > 1 && rnd() > 0.4) branch(x, y, a, len * 0.55, w * 0.6, depth - 2, (rnd() - 0.5) * 1.2);
  };
  // crown
  branch(cx, cy + r * 0.25, -Math.PI / 2, r * 0.52, st.width * 1.9, 4, 0);
  // roots
  branch(cx, cy + r * 0.2, Math.PI / 2 - 0.5, r * 0.36, st.width * 1.2, 2, -0.7);
  branch(cx, cy + r * 0.2, Math.PI / 2 + 0.5, r * 0.36, st.width * 1.2, 2, 0.7);
  branch(cx, cy + r * 0.2, Math.PI / 2, r * 0.3, st.width * 1.1, 1, 0);
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) for (const sg of segs) {
    c.beginPath();
    sg.pts.forEach((p, i) => (i === 0 ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1])));
    if (pass === 0) { c.lineWidth = sg.w + (st.edgeW ?? st.width * 0.45) * 2; c.strokeStyle = st.edge; } else { c.lineWidth = sg.w; c.strokeStyle = st.body; }
    c.stroke();
  }
  c.restore();
}

/** Sun-wheel: ring, cross and rays. */
export function sunWheel(c: Ctx, cx: number, cy: number, r: number, st: RibbonStyle, rays = 12): void {
  c.save();
  c.lineCap = 'butt';
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 0) { c.lineWidth = st.width + (st.edgeW ?? st.width * 0.45) * 2; c.strokeStyle = st.edge; } else { c.lineWidth = st.width; c.strokeStyle = st.body; }
    c.beginPath(); c.arc(cx, cy, r * 0.55, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, r * 0.2, 0, Math.PI * 2); c.stroke();
    c.beginPath();
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; c.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2); c.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55); }
    for (let i = 0; i < rays; i++) { const a = (i * Math.PI * 2) / rays + 0.26; c.moveTo(cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66); c.lineTo(cx + Math.cos(a) * r * (i % 2 ? 0.86 : 1), cy + Math.sin(a) * r * (i % 2 ? 0.86 : 1)); }
    c.stroke();
  }
  c.restore();
}

/** A row of runes (decorative inscription). */
export function runeRow(c: Ctx, x0: number, x1: number, yc: number, h: number, width: number, style: string, seed = 0): void {
  const step = h * 0.86;
  const n = Math.max(1, Math.floor((x1 - x0) / step));
  const pad = (x1 - x0 - n * step) / 2;
  for (let i = 0; i < n; i++) strokeRune(c, (i * 7 + seed * 5 + ((i * i) % 5)) % 24, x0 + pad + step * (i + 0.5), yc, h, width, style);
}

/** Runes set around a circle, feet toward the centre. */
export function runeCircle(c: Ctx, cx: number, cy: number, radius: number, h: number, count: number, width: number, style: string, seed = 0): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    strokeRune(c, (i + seed) % 24, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, h, width, style, a + Math.PI / 2);
  }
}
