// The elemental roster. Pure data: every number that defines how a fighting style plays lives
// here, along with the names / descriptions / colours the interface and effects use.
//
// Each element has five actions, addressed by slot:
//   0 melee (a committed strike)   1..3 elemental attacks   4 the signature movement ability

import { ELEMENT_ORDER, type ElementId } from './ids';
export { ELEMENT_ORDER, type ElementId } from './ids';

export const SLOT_MELEE = 0, SLOT_A1 = 1, SLOT_A2 = 2, SLOT_A3 = 3, SLOT_MOVE = 4;
export const SLOT_COUNT = 5;

export type StatusKind = 'burn' | 'chill' | 'freeze' | 'shock' | 'root' | 'slow' | 'bubble';
export interface StatusApply { k: StatusKind; t: number; n?: number }

/** What happens to a body that gets hit. */
export interface HitSpec {
  dmg: number;
  /** Horizontal knockback speed (m/s) away from the source (negative pulls toward it). */
  kb: number;
  /** Vertical launch speed (m/s). */
  lift: number;
  /** Heavy hits launch the target and knock it down when it lands. Light hits flinch. */
  heavy?: boolean;
  /** Hit-stun override in seconds (light hits default to LIGHT_STUN). */
  stun?: number;
  status?: StatusApply[];
}

/** Animation archetypes the character animator understands. */
export type AnimKind =
  | 'swing' | 'overhead' | 'thrust' | 'kick' | 'jab' | 'hook' | 'stab'      // melee
  | 'throw' | 'cast' | 'castUp' | 'castDown' | 'sweep' | 'slam' | 'channel' | 'charge' | 'burstOut' // attacks
  | 'dash' | 'glide' | 'blink' | 'leap' | 'soar' | 'surge' | 'meld' | 'ray'; // movement

/** Hints for the bots. */
export interface AiHint {
  /** poke: use freely at range · burst: close-range payoff · zone: place where the target is heading
   *  trap: drop while kiting · push: use when the target is near an edge · escape/engage: movement */
  use: 'melee' | 'poke' | 'burst' | 'zone' | 'trap' | 'push' | 'wall' | 'self' | 'escape';
  min: number; max: number;
  /** Projectile speed for target leading (0 = instant). */
  lead?: number;
  /** Fuse time for delayed strikes (aim where the target will be). */
  delay?: number;
  /** Ballistic gravity (for arcing shots). */
  arc?: number;
}

export type Effect =
  | { t: 'melee'; range: number; arc: number; hit: HitSpec; lunge: number; pull?: boolean; backstab?: number }
  | {
      t: 'proj'; ent: EntityKind; speed: number; gravity?: number; radius: number; life: number; hit: HitSpec;
      count?: number; spread?: number; burst?: number; interval?: number; pierce?: boolean;
      explode?: { r: number; hit: HitSpec }; leave?: EntityKind;
      special?: 'bubble' | 'swap' | 'orb'; farBonus?: { dist: number; mul: number };
    }
  | { t: 'beam'; ent: EntityKind; range: number; width: number; hit: HitSpec; chain?: { range: number; mul: number }; pierce?: boolean }
  | { t: 'channel'; ent: EntityKind; range: number; width: number; tick: number; hit: HitSpec; push: number; finisher?: HitSpec }
  | { t: 'cone'; ent: EntityKind; range: number; arc: number; hit: HitSpec }
  | { t: 'burst'; ent: EntityKind; radius: number; hit: HitSpec; groundedOnly?: boolean }
  | { t: 'strike'; ent: EntityKind; range: number; delay: number; radius: number; hit: HitSpec; leave?: EntityKind }
  | { t: 'line'; ent: EntityKind; length: number; width: number; speed: number; hit: HitSpec }
  | { t: 'trap'; ent: EntityKind; range: number; arm: number; life: number; trigger: number; radius: number; hit: HitSpec; max: number }
  | { t: 'zone'; ent: EntityKind; range: number }
  | { t: 'wall'; ent: EntityKind; dist: number; width: number; height: number; thick: number; life: number; hit: HitSpec }
  | { t: 'wave'; ent: EntityKind; width: number; speed: number; range: number; height: number; hit: HitSpec; end: HitSpec }
  // ---- movement signatures
  | { t: 'dash'; dist: number; time: number; trail?: EntityKind }
  | { t: 'glide'; time: number; speed: number; turn: number; trail?: EntityKind }
  | { t: 'blink'; dist: number; burst: { ent: EntityKind; radius: number; hit: HitSpec } }
  | { t: 'leap'; up: number; speed: number; land: { ent: EntityKind; radius: number; hit: HitSpec } }
  | { t: 'soar'; up: number; time: number; gravityMul: number }
  | { t: 'surge'; time: number; speed: number; radius: number; hit: HitSpec }
  | { t: 'meld'; time: number; haste: number }
  | { t: 'ray'; dist: number; time: number; burst: { ent: EntityKind; radius: number; hit: HitSpec } };

export interface AbilityDef {
  /** Unique key, also the icon id. */
  key: string;
  name: string;
  /** One-line rules text shown in the hall and in tooltips. */
  desc: string;
  /** Short tactical tip. */
  tip: string;
  slot: number;
  cooldown: number;
  /** Seconds before the effect comes out (the tell). */
  windup: number;
  /** Seconds the effect stays active (channels, dashes). 0 for instant effects. */
  active: number;
  /** Seconds of commitment after the effect. */
  recovery: number;
  /** Movement speed multiplier while performing the action. */
  moveMul: number;
  /** Usable while airborne? */
  air: boolean;
  /** Unstoppable wind-up: light hits still hurt but do not interrupt or shove the fighter. */
  armor?: boolean;
  anim: AnimKind;
  fx: Effect;
  ai: AiHint;
}

/** Zone-type entity parameters (lingering areas). */
export interface ZoneDef {
  radius: number; life: number; tick: number;
  hit?: HitSpec;
  /** Moves forward at this speed (m/s). */
  speed?: number;
  /** Seconds before it starts affecting anyone. */
  arm?: number;
  pullRadius?: number; pull?: number;
  /** Root applied once per victim on entry. */
  rootOnEnter?: number;
  /** Slow multiplier while inside. */
  slow?: number;
  /** Detonation when it expires or touches someone (ball lightning). */
  detonate?: { r: number; hit: HitSpec };
  overload?: { r: number; hit: HitSpec };
}

/**
 * Every kind of simulated / rendered combat entity. The effects layer keys its visuals off
 * these names, so each one needs a distinct, readable look.
 */
export type EntityKind =
  // ember
  | 'fireball' | 'flamewave' | 'meteor' | 'firepatch' | 'cindertrail'
  // frost
  | 'iceshard' | 'spikes' | 'rimerune' | 'rimeburst' | 'icetrail'
  // storm
  | 'arcbolt' | 'balllightning' | 'thunderstrike' | 'staticburst'
  // stone
  | 'boulder' | 'rampart' | 'earthshatter' | 'rockshard' | 'leapslam'
  // gale
  | 'gustblade' | 'cyclone' | 'jetstream'
  // tide
  | 'waterjet' | 'bubble' | 'tidalwave'
  // umbra
  | 'dagger' | 'snare' | 'shade'
  // dawn
  | 'glint' | 'solarflare' | 'sunlance' | 'raydash'
  // world
  | 'healrune';

export const ZONES: Partial<Record<EntityKind, ZoneDef>> = {
  firepatch: { radius: 3.2, life: 3.6, tick: 0.5, hit: { dmg: 4, kb: 0, lift: 0, stun: 0, status: [{ k: 'burn', t: 2 }] } },
  cindertrail: { radius: 1.35, life: 2.4, tick: 0.4, hit: { dmg: 3, kb: 0, lift: 0, stun: 0, status: [{ k: 'burn', t: 2 }] } },
  icetrail: { radius: 1.5, life: 3.2, tick: 0.8, hit: { dmg: 1, kb: 0, lift: 0, stun: 0, status: [{ k: 'chill', t: 3, n: 1 }] } },
  balllightning: {
    radius: 5, life: 4.5, tick: 0.45, speed: 8.5,
    hit: { dmg: 4, kb: 0, lift: 0, stun: 0, status: [{ k: 'shock', t: 0.6 }] },
    detonate: { r: 3.2, hit: { dmg: 12, kb: 9, lift: 7, heavy: true } },
    overload: { r: 5.6, hit: { dmg: 24, kb: 14, lift: 11, heavy: true, status: [{ k: 'shock', t: 1 }] } },
  },
  cyclone: { radius: 2.8, life: 4.6, tick: 0.7, speed: 7.5, pullRadius: 7.5, pull: 15, hit: { dmg: 7, kb: 3, lift: 13, heavy: true } },
  snare: { radius: 3.4, life: 5.5, tick: 0.5, arm: 0.5, rootOnEnter: 1.1, slow: 0.6, hit: { dmg: 3, kb: 0, lift: 0, stun: 0 } },
};

export interface ElementDef {
  id: ElementId;
  name: string;
  /** Epithet shown under the name. */
  title: string;
  /** Two or three sentences of flavour for the hall gallery. */
  lore: string;
  /** How it plays, in one sentence. */
  style: string;
  /** Role tags. */
  tags: string[];
  /** 1 (straightforward) .. 3 (demanding). */
  difficulty: 1 | 2 | 3;
  /** Glory needed to unlock (0 = starter). */
  cost: number;
  /** The rune carved on the pedestal (Elder Futhark). */
  rune: string;
  /** Colours as 0xRRGGBB: main body of effects, hot core / highlight, dark accent. */
  color: number; core: number; dark: number;
  abilities: [AbilityDef, AbilityDef, AbilityDef, AbilityDef, AbilityDef];
}

const burn = (t: number): StatusApply => ({ k: 'burn', t });
const chill = (n = 1): StatusApply => ({ k: 'chill', t: 3.5, n });
const shock = (t: number): StatusApply => ({ k: 'shock', t });

export const ELEMENTS: Record<ElementId, ElementDef> = {
  // =========================================================================== EMBER
  ember: {
    id: 'ember', name: 'Ember', title: 'Brand of Muspel',
    lore: 'The first fire still smoulders under Vindheim. Those who carry its brand fight the old way: walk forward, and let the world burn behind you.',
    style: 'An honest all-rounder. Pressure with fireballs, punish with Flame Wave, and cut off escapes with fire that lingers.',
    tags: ['All-rounder', 'Zoning', 'Burn'], difficulty: 1, cost: 0, rune: 'ᚲ',
    color: 0xff6a1a, core: 0xffe08a, dark: 0x8a1c05,
    abilities: [
      {
        key: 'ember_melee', name: 'Brand Cleave', slot: 0, cooldown: 0.5, windup: 0.26, active: 0.1, recovery: 0.32, moveMul: 0.45, air: true, anim: 'swing',
        desc: 'A wide burning axe-sweep that knocks foes back and sets them alight.',
        tip: 'The lunge covers more ground than you expect. Swing a beat early.',
        fx: { t: 'melee', range: 2.8, arc: 120, lunge: 7, hit: { dmg: 12, kb: 9, lift: 4.5, status: [burn(2)] } },
        ai: { use: 'melee', min: 0, max: 3.1 },
      },
      {
        key: 'fireball', name: 'Fireball', slot: 1, cooldown: 1.0, windup: 0.16, active: 0, recovery: 0.2, moveMul: 0.75, air: true, anim: 'throw',
        desc: 'Hurl a ball of fire that bursts on impact and ignites everything nearby.',
        tip: 'Aim at their feet. The splash still burns when the ball misses.',
        fx: { t: 'proj', ent: 'fireball', speed: 36, radius: 0.45, life: 1.5, hit: { dmg: 13, kb: 7, lift: 3, status: [burn(2.5)] }, explode: { r: 2.4, hit: { dmg: 7, kb: 5, lift: 2.5, status: [burn(2)] } } },
        ai: { use: 'poke', min: 4, max: 34, lead: 36 },
      },
      {
        key: 'flamewave', name: 'Flame Wave', slot: 2, cooldown: 6.5, windup: 0.28, active: 0.12, recovery: 0.34, moveMul: 0.4, air: true, anim: 'sweep',
        desc: 'Sweep a roaring arc of flame in front of you, launching everyone it touches.',
        tip: 'Your answer to anyone who gets too close.',
        fx: { t: 'cone', ent: 'flamewave', range: 7.2, arc: 85, hit: { dmg: 17, kb: 15, lift: 6.5, heavy: true, status: [burn(3)] } },
        ai: { use: 'burst', min: 0, max: 6.2 },
      },
      {
        key: 'meteor', name: 'Meteor', slot: 3, cooldown: 13, windup: 0.42, active: 0, recovery: 0.4, moveMul: 0.3, air: false, anim: 'castUp',
        desc: 'Call down a meteor on the marked ground. It lands after a moment, launches everything, and leaves the earth burning.',
        tip: 'Throw it where they must go — a bridge, a ledge, a doorway.',
        fx: { t: 'strike', ent: 'meteor', range: 34, delay: 1.15, radius: 4.6, hit: { dmg: 30, kb: 14, lift: 13, heavy: true, status: [burn(3)] }, leave: 'firepatch' },
        ai: { use: 'zone', min: 6, max: 32, delay: 1.5 },
      },
      {
        key: 'cinderdash', name: 'Cinder Dash', slot: 4, cooldown: 4.5, windup: 0, active: 0.2, recovery: 0.08, moveMul: 0, air: true, anim: 'dash',
        desc: 'Dash in your movement direction, leaving a trail of fire that burns those who cross it.',
        tip: 'Dash across their path, not just away from it.',
        fx: { t: 'dash', dist: 9.5, time: 0.2, trail: 'cindertrail' },
        ai: { use: 'escape', min: 0, max: 99 },
      },
    ],
  },

  // =========================================================================== FROST
  frost: {
    id: 'frost', name: 'Frost', title: 'Breath of Niflheim',
    lore: 'Cold is patient. It waits in the cracks of the world for warm things to make a mistake. Frost-callers learn to wait with it.',
    style: 'A controller. Stack Chill with shards and spikes until foes freeze solid, then shatter them.',
    tags: ['Control', 'Traps', 'Freeze'], difficulty: 2, cost: 250, rune: 'ᛁ',
    color: 0x6fd3ff, core: 0xf2fbff, dark: 0x1b4f8c,
    abilities: [
      {
        key: 'frost_melee', name: 'Rime Cleave', slot: 0, cooldown: 0.5, windup: 0.28, active: 0.1, recovery: 0.34, moveMul: 0.45, air: true, anim: 'swing',
        desc: 'A freezing cleave that knocks foes back and Chills them.',
        tip: 'Four stacks of Chill freeze a foe solid. Melee counts.',
        fx: { t: 'melee', range: 2.8, arc: 110, lunge: 6.5, hit: { dmg: 11, kb: 8.5, lift: 4.5, status: [chill()] } },
        ai: { use: 'melee', min: 0, max: 3.1 },
      },
      {
        key: 'iceshards', name: 'Ice Shards', slot: 1, cooldown: 1.6, windup: 0.14, active: 0.2, recovery: 0.18, moveMul: 0.7, air: true, anim: 'throw',
        desc: 'Loose three razor shards in quick succession. Each one Chills.',
        tip: 'Track your target through the whole volley — all three hitting is three Chill.',
        fx: { t: 'proj', ent: 'iceshard', speed: 46, radius: 0.3, life: 1.1, burst: 3, interval: 0.09, hit: { dmg: 6, kb: 3, lift: 1, stun: 0.18, status: [chill()] } },
        ai: { use: 'poke', min: 4, max: 32, lead: 46 },
      },
      {
        key: 'glacialspikes', name: 'Glacial Spikes', slot: 2, cooldown: 7.5, windup: 0.34, active: 0.1, recovery: 0.38, moveMul: 0.3, air: false, anim: 'slam',
        desc: 'Strike the ground and send a line of ice spikes racing ahead, popping foes into the air.',
        tip: 'A popped-up enemy cannot dodge. Have a volley ready.',
        fx: { t: 'line', ent: 'spikes', length: 15, width: 2.6, speed: 32, hit: { dmg: 18, kb: 3, lift: 13, heavy: true, status: [chill()] } },
        ai: { use: 'burst', min: 2, max: 13 },
      },
      {
        key: 'rimerune', name: 'Rime Rune', slot: 3, cooldown: 9, windup: 0.3, active: 0, recovery: 0.24, moveMul: 0.5, air: false, anim: 'castDown',
        desc: 'Etch a hidden rune on the ground. The first foe to step near is frozen solid along with anyone beside them.',
        tip: 'Two runes can be out at once. Guard the bridges.',
        fx: { t: 'trap', ent: 'rimerune', range: 20, arm: 0.8, life: 25, trigger: 2.0, radius: 3.2, max: 2, hit: { dmg: 10, kb: 0, lift: 0, stun: 0, status: [{ k: 'freeze', t: 1.5 }] } },
        ai: { use: 'trap', min: 0, max: 16 },
      },
      {
        key: 'glacierglide', name: 'Glacier Glide', slot: 4, cooldown: 6, windup: 0, active: 1.5, recovery: 0.05, moveMul: 0, air: false, anim: 'glide',
        desc: 'Surf a ribbon of ice at great speed, steering with your aim. The trail Chills foes. Jump to leap off early.',
        tip: 'Circle a foe to wrap them in a chilling trail.',
        fx: { t: 'glide', time: 1.5, speed: 15.5, turn: 2.6, trail: 'icetrail' },
        ai: { use: 'escape', min: 0, max: 99 },
      },
    ],
  },

  // =========================================================================== STORM
  storm: {
    id: 'storm', name: 'Storm', title: 'Voice of the Thunderer',
    lore: 'Lightning does not negotiate and it does not arrive late. Storm-speakers live in the half second between the flash and the thunder.',
    style: 'Fast and precise. Instant bolts interrupt, lightning orbs hold space, and Thunderstep puts you anywhere.',
    tags: ['Precision', 'Tempo', 'Stun'], difficulty: 2, cost: 500, rune: 'ᚦ',
    color: 0x9d7bff, core: 0xeaf0ff, dark: 0x2a1a7a,
    abilities: [
      {
        key: 'storm_melee', name: 'Static Jab', slot: 0, cooldown: 0.42, windup: 0.19, active: 0.08, recovery: 0.26, moveMul: 0.5, air: true, anim: 'jab',
        desc: 'The fastest strike on the island. A crackling jab that locks muscles for an instant.',
        tip: 'Too quick to react to. Use it to win scrambles.',
        fx: { t: 'melee', range: 2.6, arc: 90, lunge: 6, hit: { dmg: 9, kb: 7, lift: 3.5, stun: 0.42, status: [shock(0.5)] } },
        ai: { use: 'melee', min: 0, max: 2.9 },
      },
      {
        key: 'arcbolt', name: 'Arc Bolt', slot: 1, cooldown: 1.1, windup: 0.12, active: 0, recovery: 0.2, moveMul: 0.75, air: true, anim: 'cast',
        desc: 'An instant bolt of lightning that leaps to a second foe. Strike your own Ball Lightning to overload it.',
        tip: 'No travel time: if your crosshair is on them, it hits.',
        fx: { t: 'beam', ent: 'arcbolt', range: 36, width: 0.5, hit: { dmg: 9, kb: 4, lift: 2, stun: 0.28, status: [shock(0.4)] }, chain: { range: 7.5, mul: 0.5 } },
        ai: { use: 'poke', min: 3, max: 34, lead: 0 },
      },
      {
        key: 'balllightning', name: 'Ball Lightning', slot: 2, cooldown: 9, windup: 0.25, active: 0, recovery: 0.28, moveMul: 0.6, air: true, anim: 'cast',
        desc: 'Release a drifting orb that zaps nearby foes and detonates on contact. Hit it with Arc Bolt for a massive overload.',
        tip: 'Send it ahead of you, then choose the moment to detonate.',
        fx: { t: 'proj', ent: 'balllightning', speed: 8.5, radius: 0.85, life: 4.5, special: 'orb', hit: { dmg: 12, kb: 9, lift: 7, heavy: true } },
        ai: { use: 'zone', min: 5, max: 22, lead: 8.5 },
      },
      {
        key: 'thunderstrike', name: 'Thunderstrike', slot: 3, cooldown: 11, windup: 0.3, active: 0, recovery: 0.34, moveMul: 0.4, air: false, anim: 'castUp',
        desc: 'Mark the ground. A heartbeat later a thunderbolt hammers it, launching and stunning everything inside.',
        tip: 'Faster than a meteor, smaller too. Read the dodge.',
        fx: { t: 'strike', ent: 'thunderstrike', range: 36, delay: 0.75, radius: 3.4, hit: { dmg: 24, kb: 6, lift: 9, heavy: true, status: [shock(1.2)] } },
        ai: { use: 'zone', min: 5, max: 34, delay: 1.05 },
      },
      {
        key: 'thunderstep', name: 'Thunderstep', slot: 4, cooldown: 5.5, windup: 0.06, active: 0.02, recovery: 0.1, moveMul: 0, air: true, anim: 'blink',
        desc: 'Vanish and reappear where you aim in a clap of thunder, shocking anyone who was next to you.',
        tip: 'It follows your aim — look up to step into the air, or across a gap.',
        fx: { t: 'blink', dist: 12, burst: { ent: 'staticburst', radius: 3.2, hit: { dmg: 5, kb: 4, lift: 2, stun: 0.4, status: [shock(0.5)] } } },
        ai: { use: 'escape', min: 0, max: 99 },
      },
    ],
  },

  // =========================================================================== STONE
  stone: {
    id: 'stone', name: 'Stone', title: 'Bones of Ymir',
    lore: 'The island is the bone of a dead giant, and bone remembers. Stone-wardens ask it, politely, to stand up.',
    style: 'Slow, heavy and terrifying up close. Reshape the arena with walls and send foes flying with every hit.',
    tags: ['Bruiser', 'Terrain', 'Launcher'], difficulty: 2, cost: 800, rune: 'ᚢ',
    color: 0xc9a36b, core: 0xfff0c8, dark: 0x4a3a28,
    abilities: [
      {
        key: 'stone_melee', name: 'Hammerfall', slot: 0, cooldown: 0.65, windup: 0.36, active: 0.1, recovery: 0.4, moveMul: 0.4, air: true, armor: true, anim: 'overhead',
        desc: 'A slow, unstoppable overhead blow that launches foes skyward — light hits will not interrupt it. Strike your own Rampart to shatter it into a hail of rock.',
        tip: 'It is slow. Swing where they will be, not where they are.',
        fx: { t: 'melee', range: 3.2, arc: 105, lunge: 6.5, hit: { dmg: 19, kb: 8, lift: 11.5, heavy: true } },
        ai: { use: 'melee', min: 0, max: 3.2 },
      },
      {
        key: 'boulder', name: 'Boulder Toss', slot: 1, cooldown: 2.0, windup: 0.32, active: 0, recovery: 0.3, moveMul: 0.5, air: true, anim: 'throw',
        desc: 'Lob a heavy boulder in an arc. It flattens whoever it lands on.',
        tip: 'It arcs. Aim above distant foes and lob it over cover.',
        fx: { t: 'proj', ent: 'boulder', speed: 30, gravity: 16, radius: 0.8, life: 4, hit: { dmg: 20, kb: 14, lift: 7, heavy: true }, explode: { r: 2.0, hit: { dmg: 8, kb: 6, lift: 4 } } },
        ai: { use: 'poke', min: 5, max: 30, lead: 30, arc: 16 },
      },
      {
        key: 'rampart', name: 'Rampart', slot: 2, cooldown: 10, windup: 0.3, active: 0, recovery: 0.3, moveMul: 0.4, air: false, anim: 'castUp',
        desc: 'Raise a wall of rock in front of you. It blocks movement and projectiles, and throws anyone standing there into the air.',
        tip: 'Wall off a bridge, block a beam, or build your own high ground.',
        fx: { t: 'wall', ent: 'rampart', dist: 4.6, width: 7, height: 3.4, thick: 1.3, life: 7, hit: { dmg: 8, kb: 2, lift: 12, heavy: true } },
        ai: { use: 'wall', min: 3, max: 14 },
      },
      {
        key: 'earthshatter', name: 'Earthshatter', slot: 3, cooldown: 9, windup: 0.5, active: 0.1, recovery: 0.45, moveMul: 0.2, air: false, armor: true, anim: 'slam',
        desc: 'Slam the ground and send a shockwave outward, launching every foe standing on the earth. Airborne foes are untouched. The wind-up cannot be interrupted by light hits.',
        tip: 'They will try to jump it. Delay, and catch the landing.',
        fx: { t: 'burst', ent: 'earthshatter', radius: 7, groundedOnly: true, hit: { dmg: 22, kb: 6, lift: 14, heavy: true } },
        ai: { use: 'burst', min: 0, max: 6 },
      },
      {
        key: 'seismicleap', name: 'Seismic Leap', slot: 4, cooldown: 7, windup: 0.12, active: 0, recovery: 0.2, moveMul: 0, air: false, anim: 'leap',
        desc: 'Vault high through the air toward your aim and crash down with a launching shockwave.',
        tip: 'The landing hits hard. Leap onto people, not near them.',
        fx: { t: 'leap', up: 15, speed: 15, land: { ent: 'leapslam', radius: 4.6, hit: { dmg: 14, kb: 8, lift: 9.5, heavy: true } } },
        ai: { use: 'escape', min: 6, max: 18 },
      },
    ],
  },

  // =========================================================================== GALE
  gale: {
    id: 'gale', name: 'Gale', title: 'Wing of Hræsvelgr',
    lore: 'At the edge of the sky sits an eagle whose wingbeats are every wind there is. Its chosen do not kill their enemies. The fall does.',
    style: 'The ring-out specialist. Low damage, enormous knockback, and the freedom to fight where others cannot follow.',
    tags: ['Ring-out', 'Mobility', 'Displacement'], difficulty: 3, cost: 1150, rune: 'ᚹ',
    color: 0x9af5c8, core: 0xf4fff8, dark: 0x1c6b5a,
    abilities: [
      {
        key: 'gale_melee', name: 'Tempest Kick', slot: 0, cooldown: 0.5, windup: 0.22, active: 0.1, recovery: 0.3, moveMul: 0.5, air: true, anim: 'kick',
        desc: 'A wind-wreathed kick. Little damage, but it sends foes flying a very long way.',
        tip: 'Always know which way the edge is.',
        fx: { t: 'melee', range: 2.7, arc: 100, lunge: 7, hit: { dmg: 8, kb: 17, lift: 6.5, heavy: true } },
        ai: { use: 'melee', min: 0, max: 3.0 },
      },
      {
        key: 'gustblade', name: 'Gust Blade', slot: 1, cooldown: 1.5, windup: 0.16, active: 0, recovery: 0.22, moveMul: 0.75, air: true, anim: 'sweep',
        desc: 'Fling a wide crescent of wind that passes through foes and shoves each one back hard.',
        tip: 'Wide and fast. Fire it down bridges and ledges.',
        fx: { t: 'proj', ent: 'gustblade', speed: 48, radius: 1.05, life: 0.9, pierce: true, hit: { dmg: 8, kb: 15, lift: 4.5 } },
        ai: { use: 'push', min: 3, max: 36, lead: 48 },
      },
      {
        key: 'cyclone', name: 'Cyclone', slot: 2, cooldown: 10.5, windup: 0.34, active: 0, recovery: 0.3, moveMul: 0.5, air: false, anim: 'castUp',
        desc: 'Unleash a roaming whirlwind that drags foes in and hurls them into the sky.',
        tip: 'A foe in the air is a foe you can kick anywhere you like.',
        fx: { t: 'zone', ent: 'cyclone', range: 3 },
        ai: { use: 'zone', min: 4, max: 20, lead: 7.5 },
      },
      {
        key: 'jetstream', name: 'Jetstream', slot: 3, cooldown: 9, windup: 0.2, active: 1.3, recovery: 0.25, moveMul: 0.5, air: true, anim: 'channel',
        desc: 'Channel a howling river of wind that drives everything in front of you steadily backward, then blasts it away.',
        tip: 'Catch someone with their back to the void and simply hold on.',
        fx: { t: 'channel', ent: 'jetstream', range: 15, width: 2.8, tick: 0.13, push: 42, hit: { dmg: 2, kb: 0, lift: 0, stun: 0 }, finisher: { dmg: 4, kb: 13, lift: 5, heavy: true } },
        ai: { use: 'push', min: 2, max: 13 },
      },
      {
        key: 'zephyrsoar', name: 'Zephyr Soar', slot: 4, cooldown: 6.5, windup: 0, active: 2.6, recovery: 0, moveMul: 1, air: true, anim: 'soar',
        desc: 'Burst upward on a column of wind, then glide. Works in mid-air — even over the abyss.',
        tip: 'You can follow a falling foe off the edge, finish them, and still come home.',
        fx: { t: 'soar', up: 13.5, time: 2.6, gravityMul: 0.2 },
        ai: { use: 'escape', min: 0, max: 99 },
      },
    ],
  },

  // =========================================================================== TIDE
  tide: {
    id: 'tide', name: 'Tide', title: 'Daughter of Rán',
    lore: 'The sea took its share of every longship that ever sailed. Even here above the clouds, the tide remembers how to take.',
    style: 'Master of displacement. Pull foes in, carry them away, lift them helpless in bubbles and decide where they come down.',
    tags: ['Displacement', 'Setups', 'Control'], difficulty: 3, cost: 1550, rune: 'ᛚ',
    color: 0x2f9bff, core: 0xd8f6ff, dark: 0x0c2f7a,
    abilities: [
      {
        key: 'tide_melee', name: 'Undertow Hook', slot: 0, cooldown: 0.5, windup: 0.27, active: 0.1, recovery: 0.32, moveMul: 0.45, air: true, anim: 'hook',
        desc: 'A sweeping hook of water with long reach that drags foes toward and past you.',
        tip: 'Stand between them and the edge, then hook. They go where you were looking from.',
        fx: { t: 'melee', range: 3.2, arc: 100, lunge: 5, pull: true, hit: { dmg: 10, kb: -11, lift: 5 } },
        ai: { use: 'melee', min: 0, max: 3.3 },
      },
      {
        key: 'waterjet', name: 'Water Jet', slot: 1, cooldown: 2.6, windup: 0.15, active: 0.8, recovery: 0.2, moveMul: 0.6, air: true, anim: 'channel',
        desc: 'Channel a pressurised jet that batters foes and pushes them steadily back.',
        tip: 'Sweep it. The jet follows your aim for the whole channel.',
        fx: { t: 'channel', ent: 'waterjet', range: 16, width: 1.3, tick: 0.16, push: 30, hit: { dmg: 3.5, kb: 0, lift: 0, stun: 0.12 } },
        ai: { use: 'poke', min: 2, max: 14 },
      },
      {
        key: 'bubble', name: 'Bubble Prison', slot: 2, cooldown: 11, windup: 0.3, active: 0, recovery: 0.3, moveMul: 0.6, air: true, anim: 'cast',
        desc: 'Send out a slow bubble that swallows the first foe it touches and floats them helplessly upward. Any hit pops it — and hits harder.',
        tip: 'A bubbled foe near the edge is one push from gone.',
        fx: { t: 'proj', ent: 'bubble', speed: 15, radius: 1.0, life: 2.4, special: 'bubble', hit: { dmg: 6, kb: 0, lift: 0, stun: 0, status: [{ k: 'bubble', t: 1.9 }] } },
        ai: { use: 'burst', min: 3, max: 18, lead: 15 },
      },
      {
        key: 'tidalwave', name: 'Tidal Wave', slot: 3, cooldown: 12.5, windup: 0.45, active: 0, recovery: 0.4, moveMul: 0.3, air: false, anim: 'sweep',
        desc: 'Raise a wall of water that rolls forward, sweeping up foes and carrying them along before throwing them down.',
        tip: 'It carries people twenty metres. Aim it at the abyss.',
        fx: { t: 'wave', ent: 'tidalwave', width: 9, speed: 15, range: 20, height: 3.2, hit: { dmg: 14, kb: 0, lift: 3, stun: 0.3 }, end: { dmg: 0, kb: 11, lift: 8, heavy: true } },
        ai: { use: 'push', min: 2, max: 16 },
      },
      {
        key: 'riptide', name: 'Riptide Surge', slot: 4, cooldown: 6, windup: 0, active: 0.55, recovery: 0.08, moveMul: 0, air: true, anim: 'surge',
        desc: 'Become a rushing wave and surge forward, steering as you go and bowling aside anyone in the way. Crosses gaps.',
        tip: 'Surge through a foe, turn, and hook them back the other way.',
        fx: { t: 'surge', time: 0.55, speed: 22, radius: 1.6, hit: { dmg: 6, kb: 9, lift: 5 } },
        ai: { use: 'escape', min: 0, max: 99 },
      },
    ],
  },

  // =========================================================================== UMBRA
  umbra: {
    id: 'umbra', name: 'Umbra', title: 'Shade of Náströnd',
    lore: 'Where the hall-fire does not reach there are older tenants. Shade-walkers made a bargain with them, and never say what it cost.',
    style: 'A trickster and assassin. Vanish, ensnare, appear behind your target — and strike from where they are not looking.',
    tags: ['Assassin', 'Stealth', 'Traps'], difficulty: 3, cost: 2000, rune: 'ᛇ',
    color: 0xb04dff, core: 0xf0c8ff, dark: 0x1a0b33,
    abilities: [
      {
        key: 'umbra_melee', name: 'Dusk Fang', slot: 0, cooldown: 0.45, windup: 0.22, active: 0.08, recovery: 0.28, moveMul: 0.5, air: true, anim: 'stab',
        desc: 'A quick, short stab. Strikes from behind or from Shadowmeld deal heavy bonus damage and knock the victim down.',
        tip: 'Never fight face to face. Find their back.',
        fx: { t: 'melee', range: 2.6, arc: 90, lunge: 7, backstab: 1.9, hit: { dmg: 10, kb: 8, lift: 4 } },
        ai: { use: 'melee', min: 0, max: 2.9 },
      },
      {
        key: 'daggers', name: 'Night Daggers', slot: 1, cooldown: 1.7, windup: 0.14, active: 0, recovery: 0.2, moveMul: 0.75, air: true, anim: 'throw',
        desc: 'Throw a fan of three shadow daggers.',
        tip: 'Up close all three land on one target.',
        fx: { t: 'proj', ent: 'dagger', speed: 46, radius: 0.3, life: 0.95, count: 3, spread: 9, hit: { dmg: 6, kb: 3.5, lift: 1.5, stun: 0.2 } },
        ai: { use: 'poke', min: 2, max: 26, lead: 46 },
      },
      {
        key: 'snare', name: 'Shadow Snare', slot: 2, cooldown: 10, windup: 0.3, active: 0, recovery: 0.28, moveMul: 0.5, air: false, anim: 'castDown',
        desc: 'Open a pool of grasping shadow on the ground. Foes who enter are rooted in place, then slowed while they stay.',
        tip: 'A rooted foe cannot turn. Walk around behind them.',
        fx: { t: 'zone', ent: 'snare', range: 18 },
        ai: { use: 'zone', min: 3, max: 17, delay: 0.7 },
      },
      {
        key: 'duskstep', name: 'Dusk Step', slot: 3, cooldown: 9, windup: 0.18, active: 0, recovery: 0.22, moveMul: 0.7, air: true, anim: 'cast',
        desc: 'Throw a shade. If it strikes a foe you instantly appear behind them while they reel.',
        tip: 'You arrive behind them. Dusk Fang is already a backstab.',
        fx: { t: 'proj', ent: 'shade', speed: 36, radius: 0.55, life: 0.85, special: 'swap', hit: { dmg: 8, kb: 0, lift: 0, stun: 0.5 } },
        ai: { use: 'burst', min: 5, max: 26, lead: 36 },
      },
      {
        key: 'shadowmeld', name: 'Shadowmeld', slot: 4, cooldown: 9, windup: 0, active: 0.05, recovery: 0, moveMul: 1, air: true, anim: 'meld',
        desc: 'Melt into shadow: nearly invisible and much faster for a few seconds. Attacking ends it.',
        tip: 'They know you vanished. Do not come from where you left.',
        fx: { t: 'meld', time: 2.8, haste: 1.38 },
        ai: { use: 'escape', min: 0, max: 99 },
      },
    ],
  },

  // =========================================================================== DAWN
  dawn: {
    id: 'dawn', name: 'Dawn', title: 'Spear of Sól',
    lore: 'The sun is chased across the sky by a wolf and has never once been caught. Her spear-bearers fight the same way: far away, and first.',
    style: 'The marksman. Devastating at range and with perfect timing, in real trouble when cornered. Every Sunlance is a gamble.',
    tags: ['Marksman', 'Long range', 'High risk'], difficulty: 3, cost: 2500, rune: 'ᛊ',
    color: 0xffd65a, core: 0xfffbe6, dark: 0x8a5a00,
    abilities: [
      {
        key: 'dawn_melee', name: 'Sun Lance', slot: 0, cooldown: 0.55, windup: 0.3, active: 0.08, recovery: 0.34, moveMul: 0.45, air: true, anim: 'thrust',
        desc: 'A long, narrow spear-thrust of light. The longest melee reach in the arena — if you can aim it.',
        tip: 'It is a line, not an arc. Face them exactly.',
        fx: { t: 'melee', range: 4.1, arc: 34, lunge: 6, hit: { dmg: 13, kb: 12, lift: 4.5 } },
        ai: { use: 'melee', min: 0, max: 4.0 },
      },
      {
        key: 'glint', name: 'Glint', slot: 1, cooldown: 1.05, windup: 0.14, active: 0, recovery: 0.2, moveMul: 0.75, air: true, anim: 'cast',
        desc: 'Fire a needle of light, the fastest projectile there is. It strikes far harder at long range.',
        tip: 'Beyond twenty paces it hits like a hammer. Keep your distance.',
        fx: { t: 'proj', ent: 'glint', speed: 85, radius: 0.28, life: 0.75, hit: { dmg: 11, kb: 5, lift: 2 }, farBonus: { dist: 22, mul: 1.6 } },
        ai: { use: 'poke', min: 6, max: 60, lead: 85 },
      },
      {
        key: 'solarflare', name: 'Solar Flare', slot: 2, cooldown: 8, windup: 0.28, active: 0.1, recovery: 0.32, moveMul: 0.4, air: true, anim: 'burstOut',
        desc: 'Erupt in a blast of light that hurls nearby foes away from you.',
        tip: 'Your only close-range answer. Do not waste it.',
        fx: { t: 'burst', ent: 'solarflare', radius: 5.6, hit: { dmg: 10, kb: 14, lift: 6, heavy: true } },
        ai: { use: 'burst', min: 0, max: 4.8 },
      },
      {
        key: 'sunlance', name: 'Sunlance', slot: 3, cooldown: 13, windup: 1.0, active: 0.15, recovery: 0.45, moveMul: 0, air: false, anim: 'charge',
        desc: 'Root yourself and gather the dawn, then loose a colossal beam that pierces everything in its path. Everyone can see it coming.',
        tip: 'The beam turns slowly while charging. Fire along the path they must take.',
        fx: { t: 'beam', ent: 'sunlance', range: 70, width: 1.6, pierce: true, hit: { dmg: 36, kb: 16, lift: 9, heavy: true } },
        ai: { use: 'poke', min: 12, max: 60, lead: 0 },
      },
      {
        key: 'lightray', name: 'Lightray', slot: 4, cooldown: 7, windup: 0.05, active: 0.16, recovery: 0.1, moveMul: 0, air: true, anim: 'ray',
        desc: 'Become a ray of light and streak in a straight line wherever you aim — up, down, across — ending in a dazzling flash.',
        tip: 'Aim high to reach a perch. Snipers belong on perches.',
        fx: { t: 'ray', dist: 17, time: 0.16, burst: { ent: 'raydash', radius: 2.8, hit: { dmg: 6, kb: 6, lift: 3, stun: 0.35 } } },
        ai: { use: 'escape', min: 0, max: 99 },
      },
    ],
  },
};

export const ELEMENT_LIST: ElementDef[] = ELEMENT_ORDER.map((id) => ELEMENTS[id]);
export const elementIndex = (id: ElementId): number => ELEMENT_ORDER.indexOf(id);
export const elementByIndex = (i: number): ElementDef => ELEMENT_LIST[i] || ELEMENT_LIST[0];

const abilityIndex = new Map<string, AbilityDef>();
for (const el of ELEMENT_LIST) for (const a of el.abilities) abilityIndex.set(a.key, a);
export const abilityByKey = (key: string): AbilityDef | undefined => abilityIndex.get(key);
/** Which element owns an ability key. */
export const elementOfAbility = (key: string): ElementDef | undefined => ELEMENT_LIST.find((e) => e.abilities.some((a) => a.key === key));

/** Human-readable status names for the HUD. */
export const STATUS_INFO: Record<string, { name: string; desc: string; color: number }> = {
  burn: { name: 'Burning', desc: 'Taking fire damage over time.', color: 0xff6a1a },
  chill: { name: 'Chilled', desc: 'Slowed. Four stacks freeze you solid.', color: 0x6fd3ff },
  freeze: { name: 'Frozen', desc: 'Encased in ice. The next hit shatters it for bonus damage.', color: 0xbfeaff },
  shock: { name: 'Shocked', desc: 'Muscles locked: moving slowly.', color: 0x9d7bff },
  root: { name: 'Rooted', desc: 'Cannot move.', color: 0xb04dff },
  slow: { name: 'Slowed', desc: 'Moving slowly.', color: 0x9aa7b8 },
  bubble: { name: 'Bubbled', desc: 'Floating helplessly. Any hit pops the bubble.', color: 0x2f9bff },
  stealth: { name: 'Shadowmeld', desc: 'Nearly invisible and faster. Attacking ends it.', color: 0xb04dff },
};
