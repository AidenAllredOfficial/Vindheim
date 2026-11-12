// Contracts between the client's subsystems. The game core (net, prediction, camera, input,
// glue) talks to rendering, effects, audio and interface ONLY through these interfaces, so each
// subsystem can be built and tested on its own.
//
// Rendering conventions (three.js r170, WebGL2):
//  * The scene is rendered into a linear HDR (half-float) buffer; post-processing then applies
//    bloom (luminance threshold ~1.0), ACES tone mapping and sRGB conversion. So lit surfaces stay
//    in 0..1 and anything meant to GLOW outputs 1.5 .. 8 (emissiveIntensity / colour multipliers).
//  * Every custom ShaderMaterial fragment shader must end with
//        #include <tonemapping_fragment>
//        #include <colorspace_fragment>
//    so it is also correct when the low-quality path renders straight to the screen.
//  * World-space materials should honour scene fog (fog: true + the fog shader chunks).
//  * Units are metres and seconds. +Y up. Yaw 0 looks toward -Z; a character facing yaw `a`
//    uses `object.rotation.y = a`.
//  * Light budget: the environment owns the sun/moon (the only shadow caster), hemisphere fill and
//    at most 3 point lights; effects own at most 3 pooled point lights. The NUMBER of lights never
//    changes after start-up (changing it recompiles every material) – unused ones go to intensity 0.

import type * as THREE from 'three';
import type { World } from '@shared/world';
import type { Weather } from '@shared/weather';
import type { ElementId, EntityKind } from '@shared/elements';
import type { EntityState, GameEvent, MatchInfo, MatchResults, Profile, RoomInfo, RosterEntry, AnnounceKind } from '@shared/types';
import type { QualityLevel } from './settings';

// =============================================================================================
// Fighters as seen by presentation code
// =============================================================================================

/**
 * A fighter as the presentation layers see it: the local player (predicted) and remote
 * players (interpolated) look identical through this interface. Objects are long-lived and
 * mutated in place every frame.
 */
export interface PlayerView {
  id: number;
  name: string;
  /** Appearance seed (stable per identity). */
  seed: number;
  element: ElementId;
  isLocal: boolean;
  isBot: boolean;
  /** Training dummy in the sparring ring. */
  isDummy: boolean;
  /** Feet position. */
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Body facing yaw, aim yaw and aim pitch (radians). */
  face: number;
  aimYaw: number;
  aimPitch: number;
  onGround: boolean;
  alive: boolean;
  hp: number;
  inHall: boolean;
  /** Current action slot: -1 none, 0 melee, 1..3 attacks, 4 movement signature. */
  act: number;
  /** Seconds since the action started (compare against the AbilityDef windup/active/recovery). */
  actT: number;
  /** Movement mode: one of the MV_* constants from @shared/types (0 = none). */
  mv: number;
  /** Seconds of hit-stun remaining (> 0: flinching). */
  stun: number;
  /** Airborne from a heavy hit (tumbling, helpless). */
  launched: boolean;
  /** Knockdown seconds remaining: lying on the ground, then getting up during the last GETUP_TIME. */
  down: number;
  /** Briefly invulnerable (spawn / get-up). */
  invuln: boolean;
  // statuses
  burning: boolean;
  /** Chill stacks 0..4. */
  chill: number;
  frozen: boolean;
  shocked: boolean;
  rooted: boolean;
  slowed: boolean;
  bubbled: boolean;
  stealth: boolean;
  /** False while the fighter should not be drawn at all (dead and gone, not yet spawned). */
  visible: boolean;
}

export type SocketName = 'handR' | 'handL' | 'weaponTip' | 'weaponBase' | 'chest' | 'head' | 'feet';

// =============================================================================================
// Characters
// =============================================================================================

export interface CharacterOptions {
  seed: number;
  element: ElementId;
  /** 'dummy' is the straw-stuffed training mannequin of the sparring ring. */
  kind: 'fighter' | 'dummy';
  quality: QualityLevel;
}

export interface CharacterView {
  /** Add this to the scene. The view positions/rotates it itself in update(). */
  readonly root: THREE.Object3D;
  /** Pose the character from simulation state. Call once per rendered frame. */
  update(dt: number, p: PlayerView, time: number): void;
  /** World-space attachment point (valid after update()). */
  getSocket(name: SocketName, out: THREE.Vector3): THREE.Vector3;
  /** Re-skin gear, weapon and glow colours for another element. */
  setElement(el: ElementId): void;
  /** Hit feedback: a brief bright rim flash + squash. strength 0..1 */
  flash(strength: number): void;
  /** Overall opacity 0..1 (Shadowmeld: the owner sees ~0.35, others ~0.06). */
  setOpacity(alpha: number): void;
  dispose(): void;
}

export interface CharacterModule {
  /** Build shared geometry/materials up front. */
  preload(quality: QualityLevel): void;
  create(opts: CharacterOptions): CharacterView;
}

// =============================================================================================
// Environment + post-processing
// =============================================================================================

export type PedestalState = 'equipped' | 'owned' | 'next' | 'locked';

export interface Environment {
  /** Per-frame update. `focus` is the point shadows and local weather should centre on (the player). */
  update(dt: number, time: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3, weather: Weather): void;
  setQuality(q: QualityLevel, shadows: boolean): void;
  /** How a pedestal in the hall should present itself (glow, chains, banner …). */
  setPedestalState(el: ElementId, state: PedestalState): void;
  /** Called by the environment whenever lightning flashes: distance in metres, strength 0..1. */
  onLightning: ((distance: number, strength: number) => void) | null;
  /** Soften lightning flashes (accessibility). */
  setReduceFlashes(on: boolean): void;
  dispose(): void;
}

export interface PostFX {
  /** Render the frame (replaces renderer.render). */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, dt: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  setQuality(q: QualityLevel, bloom: boolean): void;
  /** One-or-two-frame impact flash (contrast pop + slight white-out). strength 0..1 */
  impact(strength: number): void;
  /** Red vignette pulse when the local player is hurt. strength 0..1 */
  hurt(strength: number): void;
  /** Persistent low-health vignette 0..1. */
  setDanger(v: number): void;
  /** 0 = full colour, 1 = fully desaturated (dead). */
  setDesaturate(v: number): void;
  /** Chromatic aberration / radial blur kick for big hits and dashes. strength 0..1 */
  kick(strength: number): void;
  /** Frost on the screen edges while chilled / frozen 0..1. */
  setFrost(v: number): void;
  setReduceFlashes(on: boolean): void;
  dispose(): void;
}

export interface EnvironmentModule {
  /**
   * Build the whole world: terrain, every collider dressed by kind, hall interior, sky, clouds,
   * aurora, snow, lights. Adds itself to `scene` and configures scene.fog / scene.background.
   * `progress` reports 0..1 with a label for the loading screen. May yield between stages.
   */
  createEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, world: World, quality: QualityLevel, progress?: (p: number, label: string) => void): Promise<Environment>;
  createPostFX(renderer: THREE.WebGLRenderer, quality: QualityLevel): PostFX;
}

// =============================================================================================
// Effects
// =============================================================================================

/** How effects look up fighters (positions, sockets, colours). */
export interface FighterLookup {
  get(id: number): PlayerView | undefined;
  /** World-space socket of a fighter's character model; falls back to an estimate if unseen. */
  socket(id: number, name: SocketName, out: THREE.Vector3): THREE.Vector3;
  /** All fighters currently in the scene. */
  all(): Iterable<PlayerView>;
}

export interface Vfx {
  /** A simulated entity appeared (projectile, zone, trap, wall, strike telegraph, channel …). */
  spawnEntity(e: EntityState): void;
  /**
   * An entity ended. why: 0 expired · 1 hit the world · 2 hit a fighter · 3 triggered/detonated ·
   * 4 overloaded/shattered. (x,y,z) is where it ended.
   */
  despawnEntity(id: number, x: number, y: number, z: number, why: number): void;
  /** Any other game event (hit, fx, death, respawn, tp, pop, pickup). Unknown events are ignored. */
  onEvent(ev: GameEvent): void;
  /** A fighter began an action (wind-up starts): show the tell (charge glow, runes, trails). */
  castStart(p: PlayerView, slot: number): void;
  /** The action's effect was released (after the wind-up): muzzle flash, swing arc, etc. */
  castRelease(p: PlayerView, slot: number): void;
  /** Footfall / landing puff. kind: 'step' | 'land' | 'jump' */
  footfall(p: PlayerView, kind: 'step' | 'land' | 'jump', surface: string): void;
  /** Per-frame update. Also draws continuous status effects (burning, frozen, bubble …) for every fighter. */
  update(dt: number, time: number, camera: THREE.PerspectiveCamera): void;
  setQuality(q: QualityLevel): void;
  /** Remove everything (room change). */
  clear(): void;
  dispose(): void;
}

export interface VfxModule {
  createVfx(scene: THREE.Scene, world: World, fighters: FighterLookup, quality: QualityLevel): Vfx;
}

// =============================================================================================
// Audio
// =============================================================================================

export interface MusicState {
  /** Where the listener is. */
  scene: 'title' | 'hall' | 'arena' | 'results';
  /** Combat intensity 0..1 (recent hits given/taken, enemies close). */
  intensity: number;
  /** 0..1: low health / last minute of the match. */
  danger: number;
}

export interface AudioPos { x: number; y: number; z: number }

/** One-shot interface sounds. */
export type UiSound = 'hover' | 'click' | 'back' | 'open' | 'close' | 'equip' | 'unlock' | 'denied' | 'glory' | 'chat' | 'countdown' | 'deploy' | 'toast';

export interface AudioEngine {
  /** Must be called from a user gesture; resumes the AudioContext and starts music/ambience. */
  unlock(): void;
  readonly unlocked: boolean;
  /** Per-frame: listener transform (camera), weather and whether the listener is indoors (0 outdoors .. 1 deep in the hall). */
  update(dt: number, listenerPos: AudioPos, listenerForward: AudioPos, weather: Weather, indoors: number): void;
  setMusicState(s: MusicState): void;
  /** Re-read volumes from the settings store (also subscribes on its own). */
  applySettings(): void;

  // ---- combat (all positional unless noted)
  /** A fighter starts an action: the wind-up / tell sound. */
  castStart(el: ElementId, slot: number, abilityKey: string, pos: AudioPos, isLocal: boolean): void;
  /** The action releases: whoosh / launch / swing. */
  castRelease(el: ElementId, slot: number, abilityKey: string, pos: AudioPos, isLocal: boolean): void;
  /** An entity appeared (looping sounds for cyclone, ball lightning, channels … start here). */
  entitySpawn(e: EntityState): void;
  entityMove(id: number, pos: AudioPos): void;
  entityDespawn(id: number, kind: EntityKind, pos: AudioPos, why: number): void;
  /** Instant effect event ('fx' GameEvent). */
  fx(kind: EntityKind | 'melee', el: ElementId, pos: AudioPos, end: AudioPos): void;
  /** A hit landed. `involvesLocal`: the local player dealt or received it (play it bigger, non-positional layer). */
  hit(el: ElementId, abilityKey: string, dmg: number, heavy: boolean, crit: boolean, pos: AudioPos, involvesLocal: 'dealt' | 'taken' | null): void;
  death(pos: AudioPos, fall: boolean, involvesLocal: 'killer' | 'victim' | null): void;
  respawn(pos: AudioPos, isLocal: boolean): void;
  teleport(kind: string, from: AudioPos, to: AudioPos): void;
  pop(kind: 'freeze' | 'bubble', pos: AudioPos): void;
  pickup(pos: AudioPos, isLocal: boolean): void;
  footstep(surface: string, pos: AudioPos, isLocal: boolean, kind: 'step' | 'land' | 'jump'): void;
  /** Thunder for a lightning flash `distance` metres away. */
  thunder(distance: number, strength: number): void;

  // ---- non-positional
  announce(kind: AnnounceKind): void;
  ui(sound: UiSound): void;
  /** Brief low-pass "duck" of the whole mix (hit-stop, death). seconds */
  duck(seconds: number, depth: number): void;
  dispose(): void;
}

export interface AudioModule {
  createAudio(world: World): AudioEngine;
}

// =============================================================================================
// Interface (DOM)
// =============================================================================================

export interface HudFrame {
  /** False on the title screen. */
  inGame: boolean;
  zone: 'hall' | 'arena';
  alive: boolean;
  hp: number;
  maxHp: number;
  /** Element currently wielded (may be a trial element in the hall). */
  element: ElementId;
  /** True if `element` is a not-yet-owned element being tried in the hall. */
  trial: boolean;
  /** Per slot: remaining cooldown seconds and total cooldown seconds. */
  cooldown: number[];
  cooldownTotal: number[];
  /** Slot currently being performed (-1 none). */
  activeSlot: number;
  /** Per slot: cannot be used right now (stunned, airborne-only restriction …). */
  locked: boolean[];
  /** Active statuses with seconds remaining (keys of STATUS_INFO). */
  statuses: { k: string; t: number; n?: number }[];
  glory: number;
  /** Seconds until respawn while dead. */
  respawnIn: number;
  /** Contextual prompt, e.g. { key: 'F', text: 'Inspect Frost' }. null = none. */
  prompt: { action: string; text: string } | null;
  /** Hold-to-return progress 0..1 (0 = not channelling). */
  recall: number;
  /** Crosshair: is an enemy under it, and how far. */
  targetId: number;
  ping: number;
  fps: number;
  weather: string;
  /** Kill streak of the local player. */
  streak: number;
}

export interface Nameplate {
  id: number;
  name: string;
  /** Screen position in CSS pixels of the point above the head, and distance in metres. */
  sx: number; sy: number; dist: number;
  onScreen: boolean;
  hp: number;
  element: ElementId;
  isBot: boolean;
  isDummy: boolean;
  /** Occluded by terrain (fade the plate). */
  hidden: boolean;
  /** Is leading the match (show a crown). */
  leader: boolean;
}

export interface FeedEntry { killer: string; victim: string; killerEl: ElementId | null; ability: string; fall: boolean; youKiller: boolean; youVictim: boolean }
export interface ChatLine { name: string; text: string; system: boolean; self: boolean; element?: ElementId }
export interface DamageNumber { sx: number; sy: number; amount: number; kind: 'dealt' | 'taken' | 'crit' | 'heal' | 'dot'; heavy: boolean }
export interface DeathInfo { killerName: string; killerEl: ElementId | null; ability: string; fall: boolean; respawnIn: number }
export interface Hint { id: string; title: string; text: string; /** Bind actions to show as keycaps. */ actions?: string[] }

/** What the interface can ask the game to do. */
export interface UiActions {
  setName(name: string): void;
  /** Quick-play into a public room, create a private room, or join one by code. */
  play(mode: { type: 'public' } | { type: 'create'; bots: boolean } | { type: 'join'; code: string }): void;
  leaveRoom(): void;
  deploy(): void;
  returnToHall(): void;
  /** Equip an owned element (only in the hall). */
  equip(el: ElementId): void;
  /** Spend glory to unlock the next element. */
  unlock(el: ElementId): void;
  /**
   * Optional: the gallery is now showing this element (null = closed), so the game can frame that
   * pedestal with the camera. Call it whenever the selection changes.
   */
  inspect?(el: ElementId | null): void;
  /** Try any element in the hall's sparring ring (null = back to the equipped one). */
  trial(el: ElementId | null): void;
  sendChat(text: string): void;
  /** The interface opened/closed something that needs the mouse; the game releases/reacquires pointer lock. */
  setUiFocus(open: boolean): void;
  /** Unlock audio + start (first click on the title screen). */
  userGesture(): void;
  playUiSound(s: UiSound): void;
}

/** Touch controls state the game core reads every frame (owned by the interface). */
export interface TouchInput {
  /** True once any touch control has been used. */
  active: boolean;
  /** Left stick, each -1..1 (y forward positive). */
  moveX: number; moveY: number;
  /** Accumulated look deltas in pixels since last read; the game resets them to 0 after reading. */
  lookDX: number; lookDY: number;
  /** Button bitmask using BTN_* from @shared/types. */
  buttons: number;
}

export interface Ui {
  readonly touch: TouchInput;
  /** Is a menu / panel / chat box capturing input right now? */
  isBlocking(): boolean;

  setLoading(progress: number, label: string): void;
  /** 'loading' -> 'title' -> 'game'. */
  setScreen(screen: 'loading' | 'title' | 'game'): void;
  setConnection(state: 'connecting' | 'online' | 'reconnecting' | 'offline', detail?: string): void;
  setProfile(p: Profile): void;
  setRoom(room: RoomInfo | null): void;
  setRoster(roster: RosterEntry[], localId: number): void;
  setMatch(m: MatchInfo): void;
  /** Called every frame while in game. Must be cheap: diff before touching the DOM. */
  setHud(h: HudFrame): void;
  setNameplates(list: Nameplate[]): void;

  /** Open the pedestal gallery focused on an element (null closes it). */
  showPedestal(el: ElementId | null): void;
  showResults(r: MatchResults | null): void;
  showDeath(d: DeathInfo | null): void;
  setHint(h: Hint | null): void;
  /** Toggle the pause menu / scoreboard (bound keys are handled by the game core). */
  toggleMenu(open?: boolean): void;
  showScoreboard(show: boolean): void;
  openChat(): void;

  pushFeed(entry: FeedEntry): void;
  pushChat(line: ChatLine): void;
  pushAnnouncement(kind: AnnounceKind, playerName: string, n: number): void;
  pushDamageNumber(d: DamageNumber): void;
  /** Crosshair hit confirmation. */
  hitMarker(kind: 'hit' | 'heavy' | 'kill'): void;
  /** Direction (radians, 0 = from ahead, clockwise) the local player just took damage from. */
  damageFrom(angle: number, strength: number): void;
  gloryGain(amount: number, why: string): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
}

export interface UiModule {
  createUi(root: HTMLElement, actions: UiActions): Ui;
}
