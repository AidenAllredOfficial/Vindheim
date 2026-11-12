// Core simulation types and tuning constants shared by server, client prediction and bots.

import type { ElementId, EntityKind } from './elements';

// ---------------------------------------------------------------- timing
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** Snapshots are sent every N ticks. */
export const SNAPSHOT_EVERY = 2;

// ---------------------------------------------------------------- body
export const PLAYER_RADIUS = 0.45;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.55;
/** Height of the chest above the feet (where most effects aim). */
export const CHEST_HEIGHT = 1.1;
export const MAX_HP = 100;

// ---------------------------------------------------------------- movement tuning
export const MOVE_SPEED = 7.2;
export const GROUND_ACCEL = 75;
export const GROUND_FRICTION = 14;
export const AIR_ACCEL = 20;
export const ICE_ACCEL = 9;
export const ICE_FRICTION = 0.9;
export const JUMP_VELOCITY = 9.8;
export const GRAVITY = 27;
export const MAX_FALL_SPEED = 46;
export const COYOTE_TIME = 0.1;

// ---------------------------------------------------------------- combat tuning
/** Default hit-stun of a light hit. */
export const LIGHT_STUN = 0.3;
/** Helpless time after a heavy launch. Land within it and you are knocked down; outlast it in the air and you recover. */
export const HEAVY_STUN = 0.5;
/** Seconds spent on the ground after a heavy launch (includes the get-up). */
export const DOWN_TIME = 0.95;
/** Portion of DOWN_TIME that is the get-up animation. */
export const GETUP_TIME = 0.4;
/** Knockdown is shortened to this when the victim "techs" (taps jump just before landing). */
export const TECH_TIME = 0.32;
export const TECH_WINDOW = 0.22;
/** Invulnerability granted when getting up, so knockdowns cannot be chained forever. */
export const GETUP_INVULN = 0.55;
/** Knockback grows as the victim loses health: x (1 + KB_HP_SCALE * missingFraction). */
export const KB_HP_SCALE = 0.9;
export const CHILL_MAX = 4;
export const CHILL_SLOW = 0.12;
export const FREEZE_TIME = 1.3;
export const FREEZE_SHATTER_MUL = 1.3;
export const BUBBLE_POP_MUL = 1.25;
export const BURN_DPS = 3;
export const RESPAWN_TIME = 3.2;
export const SPAWN_INVULN = 1.6;
/** A fall is credited to whoever hit the victim within this many seconds. */
export const KILL_CREDIT_WINDOW = 8;

// ---------------------------------------------------------------- economy
export const GLORY_PER_DAMAGE = 0.5;
export const GLORY_PER_KILL = 30;
export const GLORY_RINGOUT_BONUS = 15;
export const GLORY_PLACEMENT = [120, 80, 50];
export const GLORY_PARTICIPATION = 20;

// ---------------------------------------------------------------- match
export const MATCH_TIME = 300;
export const MATCH_KILL_TARGET = 20;
export const INTERMISSION_TIME = 22;
export const RESULTS_TIME = 11;
export const ROOM_MAX_PLAYERS = 10;
export const ROOM_TARGET_POPULATION = 8;
export const ROOM_MAX_HUMANS = 8;
export const NAME_MAX = 16;
export const CHAT_MAX = 140;

// ---------------------------------------------------------------- input
export const BTN_JUMP = 1, BTN_MELEE = 2, BTN_A1 = 4, BTN_A2 = 8, BTN_A3 = 16, BTN_MOVE = 32;
/** Button bit for an action slot (0 melee, 1..3 attacks, 4 movement). */
export const SLOT_BUTTON = [BTN_MELEE, BTN_A1, BTN_A2, BTN_A3, BTN_MOVE];

export interface Input {
  seq: number;
  /** Strafe (-1 left .. +1 right) and forward (-1 back .. +1 forward), relative to aim yaw. */
  mx: number; mz: number;
  /** Aim direction (camera). See math.dirFromYawPitch for the convention. */
  yaw: number; pitch: number;
  /** Button bitmask (BTN_*). */
  b: number;
}

// ---------------------------------------------------------------- player state
/** Special movement modes (the signature abilities). */
export const MV_NONE = 0, MV_DASH = 1, MV_GLIDE = 2, MV_SOAR = 3, MV_SURGE = 4, MV_LEAP = 5, MV_RAY = 6;

/**
 * Complete simulation state of one fighter. Everything that influences movement lives here so
 * the owning client can predict it exactly.
 */
export interface PlayerState {
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Aim. */
  yaw: number; pitch: number;
  /** Body facing (yaw). */
  face: number;
  onGround: boolean;
  /** Surface under the feet: 0 normal, 1 ice. */
  ice: boolean;
  hp: number;
  alive: boolean;
  /** Element index into ELEMENT_ORDER. */
  el: number;
  /** In the hall safe zone. */
  hall: boolean;

  // ---- action state machine
  /** Current action slot (-1 = none). */
  act: number;
  /** Seconds since the action began. */
  actT: number;
  /** Aim locked at action start (melee, dashes). */
  actYaw: number; actPitch: number;
  /** How many effect releases of the current action have happened (multi-shot bursts). */
  actN: number;
  /** Remaining cooldown per slot (seconds). */
  cd: number[];

  // ---- hit reactions
  /** Hit-stun remaining. */
  stun: number;
  /** Airborne from a heavy hit; no air control, knocked down on landing. */
  launched: boolean;
  /** Knockdown remaining (lying, then getting up during the last GETUP_TIME). */
  down: number;
  /** Invulnerability remaining. */
  inv: number;
  /** Seconds since jump was last pressed (for teching a knockdown). */
  sinceJump: number;

  // ---- movement
  coyote: number;
  /** Previous tick's buttons (edge detection). */
  pb: number;
  /** Movement mode (MV_*) and its timer / direction. */
  mv: number; mvT: number; mvX: number; mvY: number; mvZ: number;
  /** Mid-air movement ability already used since last touching ground. */
  airUsed: boolean;
  /** Buffered action press (slot or -1) and how long it stays valid; buffered jump timer. */
  buf: number; bufT: number; jbuf: number;

  // ---- statuses (seconds remaining unless noted)
  burn: number;
  chill: number;      // stacks
  chillT: number;
  freeze: number;
  freezeImm: number;
  shock: number;
  root: number;
  slow: number;       // generic slow (zones)
  slowMul: number;
  bubble: number;
  stealth: number;
  haste: number;
  hasteMul: number;
}

// ---------------------------------------------------------------- entities (projectiles, zones, traps…)
export interface EntityState {
  id: number;
  k: EntityKind;
  /** Owner player id. */
  o: number;
  /** Owner's element index (for colouring). */
  el: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  /** Collision / effect radius. */
  r: number;
  /** Total lifetime in seconds, and age so far. */
  life: number;
  age: number;
  /** Gravity applied to the entity (m/s²). */
  g: number;
  /**
   * Extra parameter, by kind:
   *   strikes (meteor, thunderstrike): fuse delay · spikes: line length · rampart: width
   *   tidalwave: width · traps: arm time · channels (jetstream, waterjet, sunlance): range
   */
  p: number;
  /** Second extra parameter: rampart height · spikes/wave speed · channel width. */
  q: number;
}

// ---------------------------------------------------------------- events (server -> client)
export type DespawnWhy = 0 /* expired */ | 1 /* hit the world */ | 2 /* hit a fighter */ | 3 /* triggered / detonated */ | 4 /* overloaded / shattered */;

export type GameEvent =
  | ({ e: 'spawn' } & EntityState)
  | { e: 'despawn'; id: number; x: number; y: number; z: number; why: DespawnWhy }
  /** A fighter was hit. (x,y,z) is the impact point, (dx,dy,dz) the knockback direction. */
  | { e: 'hit'; t: number; s: number; /** Entity id that dealt it (0 = none). */ eid: number; k: string; el: number; dmg: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; heavy: 0 | 1; crit: 0 | 1; kill: 0 | 1 }
  /**
   * Instant effect with no entity: flamewave, arcbolt, staticburst, earthshatter, leapslam,
   * solarflare, sunlance, raydash, rimeburst, and 'melee' swings that connected with terrain.
   * (x,y,z) origin, (x2,y2,z2) end point for beams / facing target for cones, r radius or range.
   */
  | { e: 'fx'; k: EntityKind | 'melee'; o: number; el: number; x: number; y: number; z: number; x2: number; y2: number; z2: number; r: number }
  | { e: 'death'; p: number; killer: number; k: string; fall: 0 | 1; x: number; y: number; z: number }
  | { e: 'respawn'; p: number; x: number; y: number; z: number; hall: 0 | 1 }
  /** Teleport (thunderstep, duskstep, deploy). */
  | { e: 'tp'; p: number; k: string; x: number; y: number; z: number; x2: number; y2: number; z2: number }
  | { e: 'pop'; p: number; k: 'freeze' | 'bubble'; x: number; y: number; z: number }
  | { e: 'pickup'; p: number; id: number; heal: number; x: number; y: number; z: number }
  | { e: 'announce'; k: AnnounceKind; p: number; n: number }
  | { e: 'chat'; p: number; name: string; text: string; sys: 0 | 1 }
  | { e: 'join'; p: number }
  | { e: 'leave'; p: number; name: string }
  /** Private to the recipient: a short notice to show as a toast. */
  | { e: 'note'; text: string; kind: 'info' | 'good' | 'bad' }
  /** Private to the recipient: glory earned. */
  | { e: 'glory'; n: number; why: 'hit' | 'kill' | 'ringout' | 'place' | 'match' };

export type AnnounceKind =
  | 'firstblood' | 'double' | 'triple' | 'rampage' | 'unstoppable' | 'shutdown' | 'ringout'
  | 'matchstart' | 'oneminute' | 'tenseconds' | 'matchend' | 'lead';

// ---------------------------------------------------------------- roster / match / profile
export interface RosterEntry {
  id: number;
  name: string;
  bot: boolean;
  dummy: boolean;
  el: number;
  kills: number;
  deaths: number;
  streak: number;
  dmg: number;
  /** In the hall (not deployed). */
  hall: boolean;
  ping: number;
}

export type MatchPhase = 'intermission' | 'live' | 'results';
export interface MatchInfo {
  phase: MatchPhase;
  /** Seconds left in the current phase. */
  timeLeft: number;
  killTarget: number;
  /** Match counter for this room. */
  round: number;
}

export interface MatchResults {
  round: number;
  /** Sorted best first. */
  standings: { id: number; name: string; bot: boolean; el: number; kills: number; deaths: number; dmg: number }[];
  /** For the recipient. */
  you: { place: number; glory: number; bonus: number; kills: number; deaths: number; dmg: number; bestStreak: number } | null;
}

export interface ProfileStats {
  kills: number; deaths: number; ringouts: number; falls: number;
  damage: number; hits: number;
  matches: number; wins: number; podiums: number;
  bestStreak: number; bestMatchKills: number;
  gloryEarned: number;
  playSeconds: number;
  /** Kills per element id. */
  elementKills: Record<string, number>;
}

export interface Profile {
  name: string;
  glory: number;
  owned: ElementId[];
  equipped: ElementId;
  stats: ProfileStats;
  created: number;
}

export interface RoomInfo {
  code: string;
  isPrivate: boolean;
  bots: boolean;
  humans: number;
  capacity: number;
}
