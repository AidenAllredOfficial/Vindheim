// Bespoke inline-SVG iconography: one glyph per ability key (40), an emblem and a hand-drawn
// Elder Futhark rune per element, and the interface icon set. Everything is drawn in a single
// bold glyph language — solid shapes in `currentColor`, a dimmer secondary tone for motion and
// echoes — so the element colour comes from CSS, never from the artwork.

import type { ElementId } from '@shared/elements';

// ---------------------------------------------------------------------------------- primitives
const o = (a: number): string => (a < 1 ? ` opacity="${a}"` : '');
/** Filled path. */
const F = (d: string, a = 1): string => `<path d="${d}"${o(a)}/>`;
/** Filled path with holes (even-odd). */
const E = (d: string, a = 1): string => `<path fill-rule="evenodd" d="${d}"${o(a)}/>`;
/** Stroked path. */
const S = (d: string, w = 3.5, a = 1): string => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${o(a)}/>`;
/** Filled circle. */
const C = (cx: number, cy: number, r: number, a = 1): string => `<circle cx="${cx}" cy="${cy}" r="${r}"${o(a)}/>`;
/** Ring. */
const R = (cx: number, cy: number, r: number, w = 3, a = 1): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${w}"${o(a)}/>`;
/** Ellipse ring. */
const EL = (cx: number, cy: number, rx: number, ry: number, w = 3, a = 1): string => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="currentColor" stroke-width="${w}"${o(a)}/>`;
const G = (transform: string, inner: string): string => `<g transform="${transform}">${inner}</g>`;
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Triangular rays around a centre (sun bursts). */
function rays(cx: number, cy: number, n: number, r0: number, r1: number, halfWidthDeg: number, a = 1, startDeg = -90, r1Alt = r1): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const ang = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    const hw = (halfWidthDeg * Math.PI) / 180;
    const tip = i % 2 ? r1Alt : r1;
    d += `M${f1(cx + Math.cos(ang - hw) * r0)} ${f1(cy + Math.sin(ang - hw) * r0)}L${f1(cx + Math.cos(ang) * tip)} ${f1(cy + Math.sin(ang) * tip)}L${f1(cx + Math.cos(ang + hw) * r0)} ${f1(cy + Math.sin(ang + hw) * r0)}Z`;
  }
  return F(d, a);
}

/** Rays fanned across an arc (a rising sun). */
function arcRays(cx: number, cy: number, n: number, r0: number, r1: number, r1Alt: number, halfWidthDeg: number, fromDeg: number, toDeg: number): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const ang = ((fromDeg + ((toDeg - fromDeg) / (n - 1)) * i) * Math.PI) / 180;
    const hw = (halfWidthDeg * Math.PI) / 180;
    const tip = i % 2 ? r1Alt : r1;
    d += `M${f1(cx + Math.cos(ang - hw) * r0)} ${f1(cy + Math.sin(ang - hw) * r0)}L${f1(cx + Math.cos(ang) * tip)} ${f1(cy + Math.sin(ang) * tip)}L${f1(cx + Math.cos(ang + hw) * r0)} ${f1(cy + Math.sin(ang + hw) * r0)}Z`;
  }
  return F(d);
}

/** Six-armed snow crystal drawn with strokes. */
function snowflake(cx: number, cy: number, r: number, w: number, a = 1, ticks = true): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const ang = ((-90 + 60 * i) * Math.PI) / 180;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    d += `M${f1(cx)} ${f1(cy)}L${f1(cx + ux * r)} ${f1(cy + uy * r)}`;
    if (ticks) {
      const bx = cx + ux * r * 0.58, by = cy + uy * r * 0.58;
      for (const s of [-1, 1]) {
        const ta = ang + s * 0.95;
        d += `M${f1(bx)} ${f1(by)}L${f1(bx + Math.cos(ta) * r * 0.34)} ${f1(by + Math.sin(ta) * r * 0.34)}`;
      }
    }
  }
  return S(d, w, a);
}

const person = (x: number, a = 1): string => C(x, 13, 5, a) + F(`M${x - 7.5} 41C${x - 7.5} 27 ${x - 4.5} 21 ${x} 21C${x + 4.5} 21 ${x + 7.5} 27 ${x + 7.5} 41Z`, a);
const dagger = F('M24 3L28.5 23H19.5Z') + S('M17 24.5H31', 3.2) + S('M24 26V33', 3.6);

// ---------------------------------------------------------------------------------- abilities
const ABILITY: Record<string, string> = {
  // ---- ember
  ember_melee:
    S('M11 41L29 15', 4.2) +
    F('M24 12L32 4C41 7 46 16 43 26L33 21C32 17 29 14 24 12Z') +
    F('M8 27C8 22 12 20 12 14C17 18 19 23 17 28C15.6 31.4 9 31.6 8 27Z', 0.55),
  fireball:
    E('M5 43C9 29 15 21 22.2 10.2A11 11 0 1 1 37.8 25.8C27 33 19 39 5 43ZM30 12.5A5.5 5.5 0 1 0 30 23.5A5.5 5.5 0 1 0 30 12.5Z') +
    S('M6 28L12 21', 2.6, 0.5) + S('M20 43L27 37', 2.6, 0.5),
  flamewave:
    F('M4 37C16 36 30 30 38 8C41 15 41 20 39 25C41 24 43 23 45 20C44 31 38 37 31 39.5C33 40.5 35 40.5 37 40C28 46 13 45 4 37Z') +
    S('M5 27C13 26 21 21 25 11', 3, 0.5) + S('M4 17C8 16.5 12 14 14 9', 2.6, 0.32),
  meteor:
    F('M27 17L44 3L31 27Z', 0.5) + S('M36 24L45 15', 2.6, 0.45) + S('M22 12L30 5', 2.6, 0.45) +
    F('M9 26L15 18L25 17L30 25L26 35L15 37Z') +
    EL(20, 42, 15, 3.4, 2.6, 0.6),
  cinderdash:
    F('M45 24L30 10V18C21 18 13 15 4 10C8 17 10 20 14 24C10 28 8 31 4 38C13 33 21 30 30 30V38Z') +
    C(8, 24, 2, 0.55) + C(3.5, 24, 1.3, 0.4),
  // ---- frost
  frost_melee:
    S('M11 41L28 16', 4.2) +
    F('M22 13L33 3L45 13L41 27L31 21Z') +
    snowflake(9, 19, 7.5, 2.2, 0.6, false),
  iceshards:
    F('M43 5L35 17L24 24L32 12Z') + F('M29 11L21 23L10 30L18 18Z') + F('M40 22L32 34L21 41L29 29Z') +
    S('M8 38L13 33', 2.6, 0.5) + S('M17 43L20 40', 2.6, 0.5),
  glacialspikes:
    F('M3 41L7.5 29L12 41Z', 0.6) + F('M10 41L17 20L24 41Z') + F('M21 41L31 7L39 41Z') + F('M36 41L41.5 25L46 41Z', 0.75) +
    S('M3 43.500H45', 2.6),
  rimerune:
    snowflake(24, 17, 12.5, 2.8) +
    EL(24, 37, 19, 6.5, 2.8) + EL(24, 37, 10, 3, 2.2, 0.5),
  glacierglide:
    S('M5 39C17 39 15 27 24 24C32 21.5 31 13 38 10', 6.5) + F('M33 3L47 6L41 19Z') +
    S('M6 29C11 28 13 24 15 20', 2.6, 0.5) + S('M26 38C33 37 37 32 39 27', 2.6, 0.5),
  // ---- storm
  storm_melee:
    E('M12 16A4 4 0 0 1 16 12H34A4 4 0 0 1 38 16V28A10 10 0 0 1 28 38H22A10 10 0 0 1 12 28ZM18 12V23H19.7V12ZM24.2 12V23H25.9V12ZM30.4 12V23H32.1V12ZM12 25.4V27.1H29.5V25.4Z') +
    S('M41 11L45 8L44 13L47.5 11', 2.6) + S('M42.5 24H47', 2.6) + S('M41 37L45 40L44 35L47.5 37', 2.6) +
    S('M2.5 13L8 16.5M1.5 24H7M2.5 35L8 31.5', 2.6, 0.5),
  arcbolt:
    F('M29 2L9 27H21L16 46L39 19H26Z') +
    S('M37 30L43 34L40 37L45 42', 2.6, 0.55),
  balllightning:
    C(24, 24, 8) + R(24, 24, 13.5, 2.4, 0.45) +
    S('M6 7L12 11L10 14L15.5 16', 2.6) + S('M42 7L36 11L38 14L32.5 16', 2.6) +
    S('M6 41L12 37L10 34L15.5 32', 2.6) + S('M42 41L36 37L38 34L32.5 32', 2.6),
  thunderstrike:
    F('M29 1L13 22H22L17 37L35 15H26.500Z') +
    EL(24, 41, 18, 5, 2.8) + EL(24, 41, 8.5, 2, 2.2, 0.5),
  thunderstep:
    person(10, 0.38) + person(38) +
    S('M17 32L24 25L23 31L30 24', 3),
  // ---- stone
  stone_melee:
    S('M13 43L29 19', 4.6) +
    F('M44.5 17L37 28.500L17.5 15.500L25 4Z') +
    S('M5 29L9 33', 2.6, 0.5) + S('M3 38H8', 2.6, 0.5),
  boulder:
    E('M21 17L33 13L43 21L45 34L35 43L22 41L15 30ZM31 17.500L24 20L20 29.500L22.5 31L26.5 22L32 19Z') +
    S('M3 30C5 17 12 9 22 7', 2.8, 0.5),
  rampart:
    F('M5 42V21L10.5 14L16 21V42Z') + F('M18 42V12L24 4L30 12V42Z') + F('M32 42V21L37.5 14L43 21V42Z') +
    S('M3 44H45', 2.4, 0.6),
  earthshatter:
    F('M24 13L27 22L36 17L31 26L43 30L31 32L35 43L25 35L17 44L18 33L5 34L15 27L8 17L20 21Z') +
    F('M9 7L15 5L16 11L10 12Z', 0.55) + F('M34 4L40 8L36 12L32 9Z', 0.55),
  seismicleap:
    S('M6 38C7 14 27 7 35 26', 4.2) + F('M27 26L43 22L38 38Z') +
    S('M24 43H46', 2.8, 0.6) + S('M4 43H10', 2.8, 0.6),
  // ---- gale
  gale_melee:
    G('rotate(-18 26 24)', F('M17 6H29V23L41 29C44 30.5 45 33 45 36V40H17Z')) +
    S('M3 15H11', 2.8, 0.55) + S('M1 25H10', 2.8, 0.55) + S('M4 35H12', 2.8, 0.55),
  gustblade:
    F('M33 3A22 22 0 0 0 15 45A27 27 0 0 1 33 3Z') +
    S('M27 19C33 18 38 20 43 24', 2.8, 0.5) + S('M24 30C30 29 36 32 41 37', 2.8, 0.5),
  cyclone:
    F('M5 5H43L38.5 13H9.5Z') + F('M12.5 16.5H40L35 24.5H16.5Z') + F('M14.5 28H33L29 35H18.5Z') + F('M20.5 38.5H29L23.5 46Z') +
    C(41.5, 31, 1.9, 0.55) + C(8, 23, 1.7, 0.55) + C(36, 41, 1.4, 0.4),
  jetstream:
    S('M4 14H29C35 14 37 8 32.5 6.500C29.5 5.5 27 8 28 10.5', 3.6) +
    S('M4 24H38C44.5 24 46 31 41 33C38 34 36 32 36.5 30', 3.6) +
    S('M4 34H22C27 34 28.5 39.5 25 41.5', 3.6, 0.6),
  zephyrsoar:
    F('M4 29C13 11 28 5 45 5C41 11 37 13.5 33 15.500C37 16 39 16 42 15C38 22 33 24.5 28 25.500C31 26.5 33 26.5 36 26C30 32 19 34 4 29Z') +
    S('M15 44L24 37L33 44', 3, 0.6),
  // ---- tide
  tide_melee:
    F('M30 3C41 9 46 22 39 33C32 43 17 43 11 33C8 28 9 21 14 17C13 23 15 28 19 31C24 34.5 31 32.5 33.5 26C36.5 18 34.5 10 30 3Z') +
    F('M8 5C11 9.5 12.5 12 12.5 14A4.5 4.5 0 0 1 3.5 14C3.5 12 5 9.5 8 5Z', 0.55),
  waterjet:
    F('M3 21L33 17C38 17 40.5 20 40.5 24C40.5 28 38 31 33 31L3 27Z') +
    C(44, 14, 2.2, 0.6) + C(45.5, 24, 2, 0.6) + C(44, 34, 2.2, 0.6) + S('M6 13H18', 2.4, 0.4) + S('M6 35H18', 2.4, 0.4),
  bubble:
    R(24, 22, 16.5, 3.4) + S('M13 17A12 12 0 0 1 21 10', 2.8, 0.6) +
    C(24, 17.5, 3.6, 0.75) + F('M17.5 32C17.5 25 20.5 22.5 24 22.500C27.5 22.5 30.5 25 30.5 32Z', 0.75) +
    R(41, 41, 3, 2.2, 0.6) + C(7, 42, 2, 0.6),
  tidalwave:
    F('M2 41C2 22 14 7 30 7C39 7 45 12.5 45 19C45 23.5 41.5 26.5 37.5 26.500C34 26.5 32 24 32.5 21C28 21 24.5 25 24.5 31C24.5 36 28 40 34 41Z') +
    C(40, 32, 2.2, 0.6) + C(44.5, 37, 1.7, 0.6) + S('M2 44.500H46', 2.4, 0.6),
  riptide:
    F('M46 22L32 8V15.500C23 15.5 17.5 19 13.5 24C10.5 27.8 7 30 2 30C6 35 12 37 17 35C22 33 23.5 28.5 32 28.500V36Z') +
    S('M4 40C9 43 14 43 19 40C24 37 29 37 34 40C37 41.8 40 42.2 43 41.5', 2.8, 0.55),
  // ---- umbra
  umbra_melee:
    F('M43 5C38 20 29 29 21 33.500L14.5 27C19 19 28 10 43 5Z') +
    S('M11 23L25 37', 4) + S('M15 33L8.5 39.5', 4.6) + C(6.5, 41.5, 2.6),
  daggers:
    G('rotate(-30 24 46)', dagger) + G('rotate(30 24 46)', dagger) + dagger,
  snare:
    `<ellipse cx="24" cy="39" rx="20" ry="6"${o(0.5)}/>` +
    S('M13 38C10 30 17 27 14 18L11 14M14 18L18 15', 3.2) +
    S('M24 39C27 29 20 24 24 12L21 7M24 12L28 8', 3.2) +
    S('M35 38C38 31 32 27 35 20L32 16M35 20L39 17', 3.2),
  duskstep:
    E('M45 20C45 11.5 38.5 5 30.5 5C22.5 5 17 11 17 18.500C17 26 12 31.5 3 33.500C9.5 40.5 20 43 29 40.500C39 37.8 45 29.5 45 20ZM24 15.500L30 18L24.5 21.500ZM40 15.500L34 18L39.5 21.500Z') +
    S('M3 22L9 20', 2.6, 0.5) + S('M5 14L10 14', 2.6, 0.5),
  shadowmeld:
    E('M24 3C13.5 3 8.5 12.5 8.5 22C8.5 30 6 37 3 43H45C42 37 39.5 30 39.5 22C39.5 12.5 34.5 3 24 3ZM24 11.500C18 11.5 14.5 16.5 14.5 23C14.5 28.5 18.5 32 24 32C29.5 32 33.5 28.5 33.5 23C33.5 16.5 30 11.5 24 11.500Z') +
    F('M17.5 21L22.5 23L18 25.500Z') + F('M30.5 21L25.5 23L30 25.500Z'),
  // ---- dawn
  dawn_melee:
    S('M6 42L30 18', 3.8) + F('M45 3L37.5 22L30.5 20.500L27.5 17.500L26 10.500Z') +
    rays(11, 13, 8, 3, 8.5, 12, 0.6),
  glint:
    F('M31 2L34.5 14.500L47 18L34.5 21.500L31 34L27.5 21.500L15 18L27.5 14.500Z') +
    F('M22.5 23.500L3 45L25.5 26.500Z', 0.55),
  solarflare:
    C(24, 24, 8.5) + rays(24, 24, 12, 11.5, 22.5, 9.5, 1, -90, 17),
  sunlance:
    C(10.5, 37.5, 7.5) + F('M15 29L41 1L47 7L19 33Z') +
    S('M9 22L24 6', 2.4, 0.5) + S('M26 39L42 24', 2.4, 0.5),
  lightray:
    F('M45 3L43 25L36.5 18.500L14 41L7 34L29.5 11.500L23 5Z') +
    S('M5 22L16 11', 2.6, 0.5) + S('M26 43L37 32', 2.6, 0.5),
};

const FALLBACK_ABILITY = R(24, 24, 15, 3.4) + C(24, 24, 5);

function svg(inner: string, box: number, cls: string): string {
  return `<svg class="${cls}" viewBox="0 0 ${box} ${box}" fill="currentColor" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/** Inline SVG markup of an ability icon. */
export const abilityIcon = (key: string): string => svg(ABILITY[key] || FALLBACK_ABILITY, 48, 'vi vi-ability');
export const ABILITY_ICON_KEYS: string[] = Object.keys(ABILITY);

// ---------------------------------------------------------------------------------- element emblems
const EMBLEM: Record<ElementId, string> = {
  ember: E('M25 3C28 12 38 17 38 29A14 14 0 0 1 10 29C10 22 13.5 18.5 16 13C18 17.5 19.5 19 22 20.500C21.5 13.5 22.5 8.5 25 3ZM24.5 24C22.5 27.5 19 29.5 19 33.500A5.5 5.5 0 0 0 30 33.500C30 30 27 28 24.5 24Z'),
  frost: snowflake(24, 24, 19, 3.4),
  storm: F('M29 2L9 27H21L16 46L39 19H26Z'),
  stone: F('M24 4L39 18L24 23.500L9 18Z') + F('M7.5 21.500L22.5 27V44H13Z', 0.8) + F('M40.5 21.500L25.5 27V44H35Z', 0.6),
  gale: S('M41 14C33 3 12 6 9 22C7 35 20 43 30 37C37 33 36 23 28.5 21.5C23 20.5 19.5 25 21.5 28.5', 4.4) + S('M34 44H43', 4, 0.7),
  tide: E('M24 3C32.5 13.5 39 21 39 29A15 15 0 0 1 9 29C9 21 15.5 13.5 24 3ZM14.5 29.500C17.5 26.5 20.8 26.5 24 29.500C27.2 32.5 30.5 32.5 33.5 29.500V33.500C30.5 36.5 27.2 36.5 24 33.500C20.8 30.5 17.5 30.5 14.5 33.500Z'),
  umbra: F('M29 4A20 20 0 1 0 44 30A16 16 0 0 1 29 4Z') + F('M35 9L36.8 14.200L42 16L36.8 17.800L35 23L33.2 17.800L28 16L33.2 14.200Z'),
  dawn: F('M11 35A13 13 0 0 1 37 35Z') + arcRays(24, 35, 7, 16.5, 27, 21.5, 6.5, -172, -8) + S('M4 40.500H44', 3.4),
};

export const elementEmblem = (id: ElementId): string => svg(EMBLEM[id] || FALLBACK_ABILITY, 48, 'vi vi-emblem');

// ---------------------------------------------------------------------------------- runes (Elder Futhark, hand-drawn)
const RUNE: Record<ElementId, string> = {
  ember: 'M16 4.500L8 12L16 19.5',             // ᚲ kenaz — torch
  frost: 'M12 3.500V20.5',                      // ᛁ isa — ice
  storm: 'M9 3V21M9 7.500L16 12L9 16.5',        // ᚦ thurisaz — thunder-giant
  stone: 'M7 21V3.500L17 10V21',                  // ᚢ uruz — aurochs, strength
  gale: 'M9 21V3L16.5 7.500L9 12',              // ᚹ wunjo — the wind's joy
  tide: 'M9.5 21V3L17 9.5',                   // ᛚ laguz — water
  umbra: 'M12 3V21M12 3L17 8M12 21L7 16',         // ᛇ eihwaz — the yew, death and passage
  dawn: 'M15.5 3L8 10L16 14L8.5 21',          // ᛊ sowilo — the sun
};
export const runeGlyph = (id: ElementId): string => svg(S(RUNE[id] || RUNE.ember, 2.4), 24, 'vi vi-rune');
/** Decorative rune strip for ornaments (all eight, in ladder order). */
export const RUNE_PATHS: Record<ElementId, string> = RUNE;

// ---------------------------------------------------------------------------------- interface icons (24 box)
const s2 = (d: string, a = 1): string => S(d, 2, a);
const UI: Record<string, string> = {
  close: s2('M6 6L18 18M18 6L6 18'),
  check: S('M4.5 12.500L10 18L19.5 6.5', 2.4),
  left: S('M14.5 5L7.5 12L14.5 19', 2.4),
  right: S('M9.5 5L16.5 12L9.5 19', 2.4),
  up: S('M5 14.500L12 7.500L19 14.5', 2.4),
  down: S('M5 9.500L12 16.500L19 9.5', 2.4),
  play: F('M7 4.500V19.500L20 12Z'),
  gear: E('M10.3 2H13.700L14.3 4.800L16.2 5.600L18.6 4L21 6.400L19.4 8.800L20.2 10.700L23 11.300V13.700L20.2 14.300L19.4 16.200L21 18.600L18.6 21L16.2 19.400L14.3 20.200L13.7 23H10.300L9.7 20.200L7.8 19.400L5.4 21L3 18.600L4.6 16.200L3.8 14.300L1 13.700V11.300L3.8 10.700L4.6 8.800L3 6.400L5.4 4L7.8 5.600L9.7 4.800ZM12 8.500A3.5 3.5 0 1 0 12 15.500A3.5 3.5 0 1 0 12 8.500Z'),
  copy: s2('M9 9H19V20H9ZM15 9V4H5V15H9'),
  link: s2('M10 14A4 4 0 0 0 15.7 14L19 10.700A4 4 0 0 0 13.3 5L12 6.300M14 10A4 4 0 0 0 8.3 10L5 13.300A4 4 0 0 0 10.7 19L12 17.7'),
  crown: F('M3 8L7.5 12L12 5L16.5 12L21 8L19 18.500H5Z') + F('M5 20H19V21.500H5Z', 0.7),
  bot: E('M11 2H13V5H17A3 3 0 0 1 20 8V16A3 3 0 0 1 17 19H7A3 3 0 0 1 4 16V8A3 3 0 0 1 7 5H11ZM8.8 9.500A1.7 1.7 0 1 0 8.8 12.900A1.7 1.7 0 1 0 8.8 9.500ZM15.2 9.500A1.7 1.7 0 1 0 15.2 12.900A1.7 1.7 0 1 0 15.2 9.500ZM8.5 14.800V16.300H15.500V14.800Z') + F('M1.5 10H3V14H1.500ZM21 10H22.500V14H21Z', 0.7),
  skull: E('M12 2C6.5 2 3 6 3 10.500C3 13.5 4.5 15.5 6.5 16.800V20A1.5 1.5 0 0 0 8 21.500H9.500V19H11V21.500H13V19H14.500V21.500H16A1.5 1.5 0 0 0 17.5 20V16.800C19.5 15.5 21 13.5 21 10.500C21 6 17.5 2 12 2ZM8.5 9A2.3 2.3 0 1 0 8.5 13.600A2.3 2.3 0 1 0 8.5 9ZM15.5 9A2.3 2.3 0 1 0 15.5 13.600A2.3 2.3 0 1 0 15.5 9ZM12 13.500L10.7 16H13.300Z'),
  chat: s2('M4 5H20V16H11L6.5 20V16H4Z'),
  menu: S('M4 6.500H20M4 12H20M4 17.500H20', 2.2),
  list: S('M9 6.500H20M9 12H20M9 17.500H20', 2.2) + C(4.8, 6.5, 1.4) + C(4.8, 12, 1.4) + C(4.8, 17.5, 1.4),
  lock: E('M7.5 10V7.500A4.5 4.5 0 0 1 16.5 7.500V10H18A1 1 0 0 1 19 11V20A1 1 0 0 1 18 21H6A1 1 0 0 1 5 20V11A1 1 0 0 1 6 10ZM9.5 10H14.500V7.500A2.5 2.5 0 0 0 9.5 7.500ZM12 13.500A1.6 1.6 0 0 0 11.2 16.500V18.500H12.800V16.500A1.6 1.6 0 0 0 12 13.500Z'),
  glory: E('M12 1.500L21 6.700V17.300L12 22.500L3 17.300V6.700ZM9.3 6V18H11.100V13.300L15.3 10.200L14.3 8.800L11.1 11.100V9.700L14.3 7.400L13.3 6L11.1 7.600V6Z'),
  volume: F('M3 9.500H7L12 5V19L7 14.500H3Z') + s2('M15.5 9A4.5 4.5 0 0 1 15.5 15M18 6A8.5 8.5 0 0 1 18 18'),
  monitor: s2('M3 4.500H21V16H3ZM8.5 20H15.500M12 16V20'),
  keyboard: s2('M2.5 6H21.500V18H2.500ZM6 9.500H6.100M10 9.500H10.100M14 9.500H14.100M18 9.500H18.100M6 13H6.100M18 13H18.100M9 14.500H15'),
  accessibility: C(12, 4.3, 2.1) + S('M4.5 8.500C9 10 15 10 19.5 8.500M12 9.500V14M12 14L8.5 21M12 14L15.5 21', 2.2),
  users: C(9, 8, 3.4) + F('M2.5 20C2.5 15.5 5.5 13 9 13C12.5 13 15.5 15.5 15.5 20Z') + C(17, 9, 2.6, 0.7) + F('M16.5 13.200C19.5 13.2 21.5 15.5 21.5 19.500H17.300C17.2 17 16.5 14.8 15.3 13.500C15.7 13.3 16.1 13.2 16.5 13.200Z', 0.7),
  signal: F('M3 16H6V20H3Z') + F('M8 12.500H11V20H8Z') + F('M13 8.500H16V20H13Z') + F('M18 4H21V20H18Z'),
  exit: s2('M10 4H5V20H10M14 8L18.5 12L14 16M18.5 12H9'),
  swords: S('M4.5 4.5L15.5 15.5M12.5 18.5L18.5 12.5M17 17L20.5 20.5M19.5 4.5L8.5 15.5M11.5 18.5L5.5 12.5M7 17L3.5 20.5', 2.2),
  info: R(12, 12, 9, 2) + S('M12 11V16.5', 2.2) + C(12, 7.6, 1.3),
  help: R(12, 12, 9, 2) + s2('M9.3 9.500A2.8 2.8 0 1 1 13 12.200C12.3 12.6 12 13.1 12 14') + C(12, 17, 1.2),
  warn: s2('M12 3.500L21.5 20H2.500Z') + S('M12 10V14.5', 2.2) + C(12, 17.2, 1.1),
  rotate: s2('M6.500 3H13A1.500 1.500 0 0 1 14.500 4.500V19.500A1.500 1.500 0 0 1 13 21H6.500A1.500 1.500 0 0 1 5 19.500V4.500A1.500 1.500 0 0 1 6.500 3Z') + s2('M17.500 6.500A8 8 0 0 1 21 13.500M21 13.500L18.300 12.300M21 13.500L22.300 10.800'),
  fall: F('M12 13L16.5 6.500H13.300V2H10.700V6.500H7.500Z') + s2('M3 19C5 16.5 7.5 16.5 9 18C10.5 15.5 13.5 15.5 15 18C16.5 16.5 19 16.5 21 19', 0.8) + s2('M5 22H19', 0.5),
  heart: F('M12 21C5 15.5 2.5 12 2.5 8.500A4.8 4.8 0 0 1 12 6.500A4.8 4.8 0 0 1 21.5 8.500C21.5 12 19 15.5 12 21Z'),
  timer: R(12, 13, 8, 2) + S('M12 8.500V13L15 15M9.5 2.500H14.5', 2.2),
  target: R(12, 12, 8.5, 2) + C(12, 12, 2.4) + s2('M12 1.500V5M12 19V22.500M1.5 12H5M19 12H22.5'),
  star: F('M12 2L14.9 8.600L22 9.300L16.6 14L18.2 21L12 17.300L5.8 21L7.4 14L2 9.300L9.1 8.600Z'),
  flame: F('M12.5 2C14 6.5 19 9 19 14.500A7 7 0 0 1 5 14.500C5 11 6.8 9.3 8 6.500C9 8.8 9.8 9.5 11 10.300C10.8 6.8 11.2 4.3 12.5 2Z'),
  dummy: C(12, 5.5, 3.2) + S('M12 9V21M5 12.500H19M8 21.500H16', 2.4),
  door: E('M5 21V4.500A1.5 1.5 0 0 1 6.5 3H17.500A1.5 1.5 0 0 1 19 4.500V21H21V22.500H3V21ZM14.5 11A1.3 1.3 0 1 0 14.5 13.600A1.3 1.3 0 1 0 14.5 11Z'),
  eye: s2('M2 12C5 6.5 9 5 12 5C15 5 19 6.5 22 12C19 17.5 15 19 12 19C9 19 5 17.5 2 12Z') + C(12, 12, 3),
  reset: s2('M4 12A8 8 0 1 0 6.5 6.200M6.5 2.500V6.500H10.5'),
  expand: S('M5 9.500L12 16.500L19 9.5', 2.4),
  touch: s2('M9 11V4.500A1.8 1.8 0 0 1 12.6 4.500V10.500L17.3 11.500A2.5 2.5 0 0 1 19.3 14.200L18.5 21H10L5.5 15A1.7 1.7 0 0 1 8 12.700Z'),
  mouse: s2('M12 2.500A5.5 5.5 0 0 1 17.5 8V16A5.5 5.5 0 0 1 6.5 16V8A5.5 5.5 0 0 1 12 2.500ZM12 6V10'),
  mouseL: s2('M12 2.500A5.5 5.5 0 0 1 17.5 8V16A5.5 5.5 0 0 1 6.5 16V8A5.5 5.5 0 0 1 12 2.500Z') + F('M12 2.500A5.5 5.5 0 0 0 6.5 8V11H12Z'),
  mouseR: s2('M12 2.500A5.5 5.5 0 0 1 17.5 8V16A5.5 5.5 0 0 1 6.5 16V8A5.5 5.5 0 0 1 12 2.500Z') + F('M12 2.500A5.5 5.5 0 0 1 17.5 8V11H12Z'),
  mouseM: s2('M12 2.500A5.5 5.5 0 0 1 17.5 8V16A5.5 5.5 0 0 1 6.5 16V8A5.5 5.5 0 0 1 12 2.500Z') + F('M10.7 5H13.300V11H10.700Z'),
  jump: S('M5 13L12 6L19 13M5 19.500L12 12.500L19 19.5', 2.6),
  spark: F('M12 1.500L14 10L22.5 12L14 14L12 22.500L10 14L1.5 12L10 10Z'),
  trophy: E('M7 3H17V5H21V8A4 4 0 0 1 16.6 12A5.2 5.2 0 0 1 13 14.900V18H16.500V21H7.500V18H11V14.900A5.2 5.2 0 0 1 7.4 12A4 4 0 0 1 3 8V5H7ZM5 7V8A2 2 0 0 0 7 10V7ZM17 7V10A2 2 0 0 0 19 8V7Z'),
};

export type UiIconName = keyof typeof UI;
export const uiIcon = (name: string): string => svg(UI[name] || UI.info, 24, `vi vi-ui vi-${name}`);

/** The Vindheim sigil: a rune-ring around a peak with a rising flame — used by the wordmark and loader. */
export function sigil(): string {
  let ticks = '';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r0 = i % 3 === 0 ? 41 : 43.5, r1 = 46;
    ticks += `M${f1(50 + Math.cos(a) * r0)} ${f1(50 + Math.sin(a) * r0)}L${f1(50 + Math.cos(a) * r1)} ${f1(50 + Math.sin(a) * r1)}`;
  }
  return `<svg class="vi vi-sigil" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
    `<circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/>` +
    `<circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>` +
    `<path d="${ticks}" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".6"/>` +
    `<path d="M50 14L76 70H63L50 42L37 70H24Z" fill="currentColor"/>` +
    `<path d="M50 50C53 57 59 60 59 68A9 9 0 0 1 41 68C41 63 44.5 61 46 57C47.5 60 48.5 61 50 62C49.5 57 49 54 50 50Z" fill="currentColor" opacity=".7"/>` +
    `<path d="M20 78H80" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".7"/>` +
    `</svg>`;
}
