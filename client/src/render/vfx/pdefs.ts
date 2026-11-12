// Particle presets. Colours are roles (resolved against the active element palette at emit
// time), so one preset serves every element.

import { C, pdef } from './core/particles';
import { SPR } from './core/atlas';

// ------------------------------------------------------------------ generic light
/** One-frame-ish bright pop. */
export const FLASH = pdef({ spr: SPR.GLOW, life: 0.1, lifeVar: 0.1, s0: 1.0, s1: 1.7, sVar: 0.1, c0: C.CORE, m0: 3.2, c1: C.COLOR, m1: 1.6, fadeIn: 0.02, fadePow: 1.6, drag: 0, heat: 1.2, rot: 0 });
/** Softer, longer bloom of colour. */
export const GLOW = pdef({ spr: SPR.GLOW, life: 0.35, s0: 0.7, s1: 1.4, c0: C.COLOR, m0: 2.6, c1: C.COLOR, m1: 1.0, fadeIn: 0.1, fadePow: 1.5, drag: 2, heat: 0.3, rot: 0 });
export const STAR = pdef({ spr: SPR.STAR, life: 0.16, lifeVar: 0.15, s0: 1.4, s1: 2.6, sVar: 0.15, c0: C.CORE, m0: 4, c1: C.COLOR, m1: 2, fadeIn: 0.03, fadePow: 1.8, drag: 0, heat: 1, rot: 0.08, spin: 0.6 });
export const GLINT = pdef({ spr: SPR.GLINT, life: 0.4, lifeVar: 0.4, s0: 0.1, s1: 0.5, sVar: 0.5, c0: C.CORE, m0: 5, c1: C.COLOR, m1: 3, fadeIn: 0.3, fadePow: 1, drag: 2, heat: 1, rot: 0.02, turb: 0.05 });
export const RINGPUFF = pdef({ spr: SPR.RING, life: 0.3, s0: 0.3, s1: 2.0, sVar: 0.1, c0: C.CORE, m0: 4, c1: C.COLOR, m1: 1.5, fadeIn: 0.04, fadePow: 1.6, drag: 0, heat: 0.6, rot: 0 });

// ------------------------------------------------------------------ sparks
/** Fast, gravity-bound, velocity-stretched sparks. */
export const SPARK = pdef({ spr: SPR.STREAK, life: 0.42, lifeVar: 0.45, s0: 0.07, s1: 0.02, sVar: 0.4, c0: C.CORE, m0: 7, c1: C.COLOR, m1: 3, cPow: 0.6, fadeIn: 0.01, fadePow: 0.7, drag: 2.4, grav: 13, stretch: 0.045, heat: 1 });
/** Light sparks that float (no gravity) – magic, not metal. */
export const SPARK_FLOAT = pdef({ spr: SPR.STREAK, life: 0.34, lifeVar: 0.4, s0: 0.06, s1: 0.015, sVar: 0.4, c0: C.CORE, m0: 6, c1: C.COLOR, m1: 3, fadeIn: 0.01, fadePow: 0.8, drag: 4.5, grav: 0, stretch: 0.05, heat: 1 });
export const MOTE = pdef({ spr: SPR.MOTE, life: 0.8, lifeVar: 0.4, s0: 0.12, s1: 0.03, sVar: 0.5, c0: C.CORE, m0: 4.5, c1: C.COLOR, m1: 2.5, fadeIn: 0.15, fadePow: 1, drag: 1.5, grav: -0.6, turb: 0.12, heat: 0.8, spin: 2 });
/** Motes that get sucked toward where they are thrown (use negative-outward velocities). */
export const GATHER = pdef({ spr: SPR.STREAK, life: 0.3, lifeVar: 0.25, s0: 0.05, s1: 0.09, sVar: 0.3, c0: C.COLOR, m0: 2.5, c1: C.CORE, m1: 6, fadeIn: 0.35, fadePow: 0.4, drag: 0, grav: 0, stretch: 0.035, heat: 0.8 });

// ------------------------------------------------------------------ fire
export const FLAME = pdef({ spr: SPR.FLAME, sprN: 2, life: 0.5, lifeVar: 0.35, s0: 0.6, s1: 0.2, sVar: 0.45, c0: C.HOT, m0: 2.6, c1: C.DARK, m1: 2.0, cPow: 0.7, add0: 1, add1: 0.8, fadeIn: 0.15, fadePow: 1.2, drag: 1.6, grav: -4.5, rot: 0.1, spin: 1.2, turb: 0.08, heat: 1.0, vVar: 0.7 });
export const FLAME_BIG = pdef({ ...FLAME, life: 0.7, s0: 1.1, s1: 0.4, sVar: 0.5, m0: 2.2, grav: -6, turb: 0.12 });
/** Fireball burst: fat blobs of fire that roll outward and blacken. */
export const FIREBLOB = pdef({ spr: SPR.SMOKE, sprN: 2, life: 0.5, lifeVar: 0.3, s0: 0.6, s1: 1.5, sVar: 0.3, c0: C.HOT, m0: 3.6, c1: C.DARK, m1: 0.6, cPow: 0.6, add0: 1, add1: 0.1, a0: 1, a1: 0.7, fadeIn: 0.04, fadePow: 1.2, drag: 3.2, grav: -1.5, spin: 1.2, heat: 0.8 });
export const EMBER = pdef({ spr: SPR.EMBER, life: 1.1, lifeVar: 0.5, s0: 0.085, s1: 0.03, sVar: 0.5, c0: C.HOT, m0: 5.5, c1: C.COLOR, m1: 2.5, cPow: 0.5, fadeIn: 0.03, fadePow: 0.8, drag: 1.3, grav: -1.6, turb: 0.3, heat: 0.7, vVar: 0.6 });
export const SMOKE = pdef({ front: false, spr: SPR.SMOKE, sprN: 2, life: 1.3, lifeVar: 0.35, s0: 0.5, s1: 1.9, sVar: 0.35, c0: C.SMOKE, m0: 1.6, c1: C.SMOKE, m1: 0.8, a0: 0.55, a1: 0.3, add0: 0, add1: 0, fadeIn: 0.15, fadePow: 1.3, drag: 1.8, grav: -1.3, spin: 0.7, turb: 0.15, heat: 0, vVar: 0.3 });
/** Smoke born glowing: for explosions. */
export const SMOKE_HOT = pdef({ ...SMOKE, c0: C.DARK, m0: 1.6, c1: C.SMOKE, m1: 0.7, cPow: 0.4, add0: 0.6, add1: 0, a0: 0.75, a1: 0.35, life: 1.0 });

// ------------------------------------------------------------------ earth
export const DUST = pdef({ front: false, spr: SPR.DUST, life: 0.9, lifeVar: 0.35, s0: 0.45, s1: 1.5, sVar: 0.4, c0: C.A, m0: 0.55, c1: C.A, m1: 0.45, a0: 0.5, a1: 0.25, add0: 0, add1: 0, fadeIn: 0.1, fadePow: 1.4, drag: 3.0, grav: -0.25, spin: 0.8, turb: 0.08, heat: 0 });
export const DUST_BIG = pdef({ ...DUST, life: 1.5, s0: 0.9, s1: 3.0, a0: 0.5, drag: 2.6 });
export const DEBRIS = pdef({ front: false, spr: SPR.CHUNK, life: 0.9, lifeVar: 0.35, s0: 0.13, s1: 0.1, sVar: 0.6, c0: C.A, m0: 0.6, c1: C.A, m1: 0.5, add0: 0, add1: 0, fadeIn: 0.01, fadePow: 0.35, drag: 0.5, grav: 20, spin: 12, heat: 0 });
export const FLECK = pdef({ front: false, spr: SPR.LEAF, life: 0.7, lifeVar: 0.3, s0: 0.11, s1: 0.09, sVar: 0.5, c0: C.A, m0: 0.7, c1: C.A, m1: 0.5, add0: 0, add1: 0, fadeIn: 0.02, fadePow: 0.5, drag: 1.6, grav: 11, spin: 9, turb: 0.05, heat: 0 });

// ------------------------------------------------------------------ ice
export const ICE_CHIP = pdef({ spr: SPR.SHARD, life: 0.75, lifeVar: 0.4, s0: 0.2, s1: 0.1, sVar: 0.55, c0: C.CORE, m0: 2.6, c1: C.COLOR, m1: 1.4, add0: 0.75, add1: 0.6, fadeIn: 0.01, fadePow: 0.5, drag: 0.8, grav: 17, spin: 10, heat: 0.6 });
export const FLAKE = pdef({ spr: SPR.FLAKE, life: 1.2, lifeVar: 0.4, s0: 0.16, s1: 0.08, sVar: 0.5, c0: C.CORE, m0: 3.6, c1: C.COLOR, m1: 2.2, fadeIn: 0.15, fadePow: 1, drag: 2.5, grav: 0.7, spin: 2.5, turb: 0.14, heat: 0.4 });
export const FROST_MIST = pdef({ front: false, spr: SPR.SMOKE, sprN: 2, life: 1.2, lifeVar: 0.35, s0: 0.6, s1: 1.9, sVar: 0.35, c0: C.CORE, m0: 0.85, c1: C.COLOR, m1: 0.55, a0: 0.3, a1: 0.16, add0: 0.45, add1: 0.3, fadeIn: 0.2, fadePow: 1.4, drag: 2.8, grav: 0.15, spin: 0.5, turb: 0.1, heat: 0 });

// ------------------------------------------------------------------ storm
export const ARC = pdef({ spr: SPR.ARC, life: 0.1, lifeVar: 0.4, s0: 0.5, s1: 0.65, sVar: 0.45, c0: C.CORE, m0: 6, c1: C.COLOR, m1: 4, fadeIn: 0.02, fadePow: 0.4, drag: 0, heat: 1 });
export const ZAP = pdef({ ...SPARK_FLOAT, life: 0.22, s0: 0.05, drag: 6, stretch: 0.06, m0: 8 });

// ------------------------------------------------------------------ gale
export const WIND = pdef({ spr: SPR.STREAK, life: 0.38, lifeVar: 0.35, s0: 0.07, s1: 0.03, sVar: 0.4, c0: C.CORE, m0: 1.5, c1: C.COLOR, m1: 0.9, a0: 0.8, a1: 0.5, fadeIn: 0.2, fadePow: 1, drag: 1.2, grav: 0, stretch: 0.09, heat: 0.4 });
export const CURL = pdef({ spr: SPR.CURL, life: 0.5, lifeVar: 0.3, s0: 0.5, s1: 1.2, sVar: 0.4, c0: C.CORE, m0: 1.8, c1: C.COLOR, m1: 0.9, a0: 0.7, a1: 0.4, fadeIn: 0.15, fadePow: 1.3, drag: 2.5, grav: -0.3, spin: 9, heat: 0.3 });
export const WISP = pdef({ spr: SPR.WISP, life: 0.5, lifeVar: 0.3, s0: 0.6, s1: 1.3, sVar: 0.4, c0: C.CORE, m0: 1.7, c1: C.COLOR, m1: 0.9, a0: 0.7, a1: 0.4, fadeIn: 0.15, fadePow: 1.3, drag: 2.2, grav: -0.2, spin: 5, heat: 0.3 });
export const GUST_PUFF = pdef({ front: false, spr: SPR.SMOKE, sprN: 2, life: 0.6, lifeVar: 0.3, s0: 0.5, s1: 1.6, sVar: 0.3, c0: C.CORE, m0: 0.8, c1: C.COLOR, m1: 0.5, a0: 0.22, a1: 0.1, add0: 0.5, add1: 0.4, fadeIn: 0.15, fadePow: 1.3, drag: 2.4, grav: -0.2, spin: 1.5, heat: 0 });

// ------------------------------------------------------------------ tide
export const DROP = pdef({ spr: SPR.DROP, life: 0.65, lifeVar: 0.4, s0: 0.13, s1: 0.07, sVar: 0.5, c0: C.CORE, m0: 2.0, c1: C.COLOR, m1: 1.3, add0: 0.7, add1: 0.6, a0: 0.95, a1: 0.8, fadeIn: 0.02, fadePow: 0.5, drag: 0.7, grav: 16, stretch: 0.012, heat: 1.2 });
export const SPRAY = pdef({ front: false, spr: SPR.SMOKE, sprN: 2, life: 0.55, lifeVar: 0.35, s0: 0.35, s1: 1.3, sVar: 0.4, c0: C.WHITE, m0: 0.95, c1: C.CORE, m1: 0.7, a0: 0.5, a1: 0.2, add0: 0.35, add1: 0.3, fadeIn: 0.08, fadePow: 1.3, drag: 2.6, grav: 4, spin: 1.2, heat: 0 });
export const FOAM = pdef({ spr: SPR.SPLASH, life: 0.4, lifeVar: 0.3, s0: 0.4, s1: 1.3, sVar: 0.4, c0: C.WHITE, m0: 1.5, c1: C.CORE, m1: 1.0, a0: 0.8, a1: 0.4, add0: 0.6, add1: 0.5, fadeIn: 0.05, fadePow: 1.3, drag: 3, grav: 3, spin: 1, heat: 0.4 });
export const BUBBLET = pdef({ spr: SPR.BUBBLE, life: 0.9, lifeVar: 0.4, s0: 0.1, s1: 0.2, sVar: 0.6, c0: C.CORE, m0: 2.2, c1: C.COLOR, m1: 1.6, fadeIn: 0.1, fadePow: 0.4, drag: 2.4, grav: -1.4, turb: 0.1, heat: 1 });

// ------------------------------------------------------------------ umbra
export const SHADOW = pdef({ front: false, spr: SPR.SMOKE, sprN: 2, life: 0.8, lifeVar: 0.35, s0: 0.5, s1: 1.4, sVar: 0.35, c0: C.DARK, m0: 0.45, c1: C.BLACK, m1: 1, a0: 0.85, a1: 0.5, add0: 0, add1: 0, fadeIn: 0.1, fadePow: 1.3, drag: 2.6, grav: -0.5, spin: 1.2, turb: 0.1, heat: 0 });
/** Purple edge-light that rides with shadow smoke. */
export const SHADOW_GLOW = pdef({ spr: SPR.WISP, life: 0.5, lifeVar: 0.3, s0: 0.5, s1: 1.1, sVar: 0.4, c0: C.COLOR, m0: 2.2, c1: C.DARK, m1: 1.5, fadeIn: 0.15, fadePow: 1.4, drag: 2.6, grav: -0.3, spin: 4, heat: 0.2 });
export const SHADOW_MOTE = pdef({ spr: SPR.MOTE, life: 0.7, lifeVar: 0.4, s0: 0.1, s1: 0.03, sVar: 0.5, c0: C.CORE, m0: 3, c1: C.COLOR, m1: 2, fadeIn: 0.2, fadePow: 1, drag: 1, grav: -0.4, turb: 0.1, heat: 0.5, spin: 3 });

// ------------------------------------------------------------------ dawn
export const RAY = pdef({ spr: SPR.STREAK, life: 0.28, lifeVar: 0.3, s0: 0.11, s1: 0.03, sVar: 0.4, c0: C.CORE, m0: 6, c1: C.COLOR, m1: 3, fadeIn: 0.02, fadePow: 0.9, drag: 3.5, grav: 0, stretch: 0.085, heat: 1 });
export const SUNMOTE = pdef({ ...MOTE, life: 1.0, grav: -1.2, m0: 5.5, m1: 3, turb: 0.18 });

// ------------------------------------------------------------------ souls / runes
export const SOUL = pdef({ spr: SPR.WISP, life: 1.6, lifeVar: 0.3, s0: 0.35, s1: 0.9, sVar: 0.4, c0: C.CORE, m0: 2.6, c1: C.COLOR, m1: 1.0, a0: 0.9, a1: 0.5, fadeIn: 0.15, fadePow: 1.6, drag: 0.9, grav: -2.2, spin: 2.5, turb: 0.3, heat: 0.4 });
export const SOUL_MOTE = pdef({ ...MOTE, life: 1.8, grav: -1.8, turb: 0.25, s0: 0.1 });
