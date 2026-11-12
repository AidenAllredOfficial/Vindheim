// What sounds what: the sound groups, and the tables that map the game's vocabulary (entity
// kinds, `fx` kinds, despawn reasons, teleports) onto sound keys. Typed against the shared
// definitions, so adding an entity kind without giving it a voice is a compile error.

import type { ElementId, EntityKind } from '@shared/elements';
import { SoundBank } from './bank';
import { emberDefs } from './sfx/ember';
import { frostDefs } from './sfx/frost';
import { stormDefs } from './sfx/storm';
import { stoneDefs } from './sfx/stone';
import { galeDefs } from './sfx/gale';
import { tideDefs } from './sfx/tide';
import { umbraDefs } from './sfx/umbra';
import { dawnDefs } from './sfx/dawn';
import { coreDefs, footstepDefs } from './sfx/core';
import { uiDefs } from './sfx/ui';
import { announceDefs } from './sfx/announce';
import { ambienceDefs } from './sfx/ambience';
import { musicDefs } from './music/instruments';

export const ELEMENT_IDS: ElementId[] = ['ember', 'frost', 'storm', 'stone', 'gale', 'tide', 'umbra', 'dawn'];

/** Render order: what the player can hear first comes first. */
export const GROUP_ORDER = ['ui', 'music', 'amb', 'foot', 'core', 'announce', 'el.ember', 'el.frost', 'el.storm', 'el.stone', 'el.gale', 'el.tide', 'el.umbra', 'el.dawn'];

/** The one bank shared by the engine and the analysis harness. */
export const bank = new SoundBank();
bank.register('ui', uiDefs);
bank.register('music', musicDefs);
bank.register('amb', ambienceDefs);
bank.register('foot', footstepDefs);
bank.register('core', coreDefs);
bank.register('announce', announceDefs);
bank.register('el.ember', emberDefs);
bank.register('el.frost', frostDefs);
bank.register('el.storm', stormDefs);
bank.register('el.stone', stoneDefs);
bank.register('el.gale', galeDefs);
bank.register('el.tide', tideDefs);
bank.register('el.umbra', umbraDefs);
bank.register('el.dawn', dawnDefs);

// ----------------------------------------------------------------------------------------------
// Entities
// ----------------------------------------------------------------------------------------------

export interface EntSpec {
  /** One-shot when the entity appears. */
  spawn?: string;
  /** The spawn sound lasts for the entity's fuse and is cut if the entity ends early. */
  fuse?: boolean;
  /** Looping sound that follows the entity. */
  loop?: string;
  loopGain?: number;
  loopRate?: number;
  /** Do not start another loop of this kind within this many metres of one already playing. */
  merge?: number;
  /** The loop intensifies over the entity's life (a charge). */
  swell?: boolean;
  /** Play the spawn / end one-shots at the middle of the entity's line (spikes). */
  line?: boolean;
  /** Up to this many seconds of random delay so a volley does not sound like one hit. */
  stagger?: number;
  /** Despawn sound by reason (0 expired, 1 world, 2 fighter, 3 triggered, 4 overloaded). */
  end?: Partial<Record<0 | 1 | 2 | 3 | 4, string>>;
  endGain?: number;
  endRate?: number;
}

const all = (key: string): Record<0 | 1 | 2 | 3 | 4, string> => ({ 0: key, 1: key, 2: key, 3: key, 4: key });

export const ENTITY: Record<EntityKind, EntSpec> = {
  // ember
  fireball: { loop: 'ent.fireball.loop', end: { 0: 'ent.fireball.fizz', 1: 'ent.fireball.burst', 2: 'ent.fireball.burst', 3: 'ent.fireball.burst', 4: 'ent.fireball.burst' } },
  flamewave: {},
  meteor: { spawn: 'ent.meteor.fall', fuse: true, end: { 3: 'ent.meteor.impact' } },
  firepatch: { spawn: 'ent.firepatch.spawn', loop: 'ent.firepatch.loop', end: all('ent.firepatch.end') },
  cindertrail: { spawn: 'ent.cindertrail.spawn', stagger: 0.03, loop: 'ent.firepatch.loop', loopGain: 0.6, loopRate: 1.25, merge: 9, end: all('ent.firepatch.end'), endGain: 0.45, endRate: 1.3 },
  // frost
  iceshard: { spawn: 'ent.iceshard.spawn', end: { 1: 'ent.iceshard.break', 2: 'ent.iceshard.break' }, endGain: 0.8 },
  spikes: { spawn: 'ent.spikes.erupt', line: true, end: all('ent.spikes.crumble') },
  rimerune: { spawn: 'ent.rimerune.spawn', loop: 'ent.rimerune.loop', end: { 0: 'ent.rimerune.fade', 1: 'ent.rimerune.fade', 2: 'ent.rimerune.trigger', 3: 'ent.rimerune.trigger', 4: 'ent.rimerune.fade' } },
  rimeburst: {},
  icetrail: { spawn: 'ent.icetrail.spawn', stagger: 0.04, end: all('ent.icetrail.end') },
  // storm
  arcbolt: {},
  balllightning: { loop: 'ent.balllightning.loop', end: { 0: 'ent.balllightning.fizz', 1: 'ent.balllightning.detonate', 2: 'ent.balllightning.detonate', 3: 'ent.balllightning.detonate', 4: 'ent.balllightning.overload' } },
  thunderstrike: { spawn: 'ent.thunderstrike.charge', fuse: true, end: { 3: 'ent.thunderstrike.bolt' } },
  staticburst: {},
  // stone
  boulder: { loop: 'ent.boulder.loop', end: { 1: 'ent.boulder.smash', 2: 'ent.boulder.smash', 3: 'ent.boulder.smash', 4: 'ent.boulder.smash' } },
  rampart: { spawn: 'ent.rampart.rise', end: { 0: 'ent.rampart.crumble', 1: 'ent.rampart.crumble', 2: 'ent.rampart.crumble', 3: 'ent.rampart.crumble', 4: 'ent.rampart.shatter' } },
  earthshatter: {},
  rockshard: { end: { 1: 'ent.rockshard.hit', 2: 'ent.rockshard.hit' } },
  leapslam: {},
  // gale
  gustblade: { loop: 'ent.gustblade.loop', end: { 0: 'ent.gustblade.end', 1: 'ent.gustblade.end' } },
  cyclone: { loop: 'ent.cyclone.loop', end: all('ent.cyclone.end') },
  jetstream: { loop: 'ent.jetstream.loop', end: all('ent.jetstream.end') },
  // tide
  waterjet: { loop: 'ent.waterjet.loop', end: all('ent.waterjet.end') },
  bubble: { loop: 'ent.bubble.loop', end: { 0: 'ent.bubble.pop', 1: 'ent.bubble.pop', 2: 'ent.bubble.catch', 3: 'ent.bubble.pop', 4: 'ent.bubble.pop' } },
  tidalwave: { spawn: 'ent.tidalwave.spawn', loop: 'ent.tidalwave.loop', end: all('ent.tidalwave.crash') },
  // umbra
  dagger: { spawn: 'ent.dagger.spawn', stagger: 0.035, end: { 1: 'ent.dagger.hit' } },
  snare: { spawn: 'ent.snare.spawn', loop: 'ent.snare.loop', end: all('ent.snare.end') },
  shade: { loop: 'ent.shade.loop', end: { 0: 'ent.shade.fade', 1: 'ent.shade.fade', 2: 'ent.shade.hit', 3: 'ent.shade.hit', 4: 'ent.shade.fade' } },
  // dawn
  glint: { spawn: 'ent.glint.spawn', end: { 1: 'ent.glint.hit', 2: 'ent.glint.hit' } },
  solarflare: {},
  sunlance: { loop: 'ent.sunlance.loop', swell: true },
  raydash: {},
  // world
  healrune: { spawn: 'ent.healrune.spawn', loop: 'ent.healrune.loop', end: { 0: 'ent.healrune.fade', 1: 'ent.healrune.fade', 3: 'ent.healrune.fade', 4: 'ent.healrune.fade' } },
};

// ----------------------------------------------------------------------------------------------
// Instant effects
// ----------------------------------------------------------------------------------------------

export interface FxSpec {
  key: string;
  /** A beam: play at the point of the segment nearest the listener. */
  beam?: boolean;
  /** Second sound at the end point. */
  end?: string;
}

/** `fx` kinds with a dedicated sound. Anything else falls back to the element's heavy hit layer. */
export const FX: Partial<Record<EntityKind | 'melee', FxSpec>> = {
  flamewave: { key: 'fx.flamewave' },
  rimeburst: { key: 'fx.rimeburst' },
  arcbolt: { key: 'fx.arcbolt', beam: true, end: 'fx.arcbolt.end' },
  staticburst: { key: 'fx.staticburst' },
  earthshatter: { key: 'fx.earthshatter' },
  leapslam: { key: 'fx.leapslam' },
  solarflare: { key: 'fx.solarflare' },
  sunlance: { key: 'fx.sunlance', beam: true },
  raydash: { key: 'fx.raydash', beam: true, end: 'fx.raydash.end' },
  melee: { key: 'fx.melee' },
};

/** Teleport kinds: [vanish sound at the origin, arrival sound at the destination]. */
export const TELEPORT: Record<string, [string, string]> = {
  thunderstep: ['tp.thunderstep.out', 'tp.thunderstep.in'],
  duskstep: ['tp.duskstep.out', 'tp.duskstep.in'],
  deploy: ['tp.deploy.out', 'tp.deploy.in'],
};
export const TELEPORT_DEFAULT: [string, string] = ['tp.generic.out', 'tp.generic.in'];
