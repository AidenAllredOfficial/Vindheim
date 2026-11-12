// The interface's voice: loading tips, announcements, rule summaries. Short, confident, Norse.

import type { AnnounceKind } from '@shared/types';

export const LOADING_LINES: string[] = [
  'Nothing can be blocked. Be somewhere else.',
  'Knockback grows as health falls. A wounded warrior flies further.',
  'The cloud sea takes everyone equally. Know where the edge is.',
  'Heavy hits launch. Tap jump just before you land to roll out of the knockdown.',
  'Four stacks of Chill freeze a foe solid. The next hit shatters them.',
  'A bubbled foe pops for bonus damage — and goes wherever you send them.',
  'Health runes wake on the outer islets. The paths there are narrow on purpose.',
  'Glory is earned in the arena and spent in the hall. Eight elements, one ladder.',
  'Every attack has a tell. Watch the hands, not the health bar.',
  'Ring-outs pay extra glory. The last one to hit them gets the credit.',
  'Try any element in the sparring ring before you spend a single point of glory.',
  'The hall is safe ground. Step through the Skygate when you are ready.',
  'Ice slides. Walls block. The terrain is a weapon — use it first.',
  'They say the island is the bone of a dead giant. It still remembers how to stand.',
];

export const ANNOUNCE: Record<AnnounceKind, { title: string; sub: (name: string, n: number) => string; tone: 'gold' | 'blood' | 'frost' | 'plain'; minor?: boolean }> = {
  firstblood: { title: 'First Blood', sub: (name) => (name ? `${name} draws first` : 'The arena wakes'), tone: 'blood' },
  double: { title: 'Double Kill', sub: (name) => name, tone: 'gold' },
  triple: { title: 'Triple Kill', sub: (name) => name, tone: 'gold' },
  rampage: { title: 'Rampage', sub: (name, n) => (n > 0 ? `${name} · ${n} without falling` : name), tone: 'blood' },
  unstoppable: { title: 'Unstoppable', sub: (name, n) => (n > 0 ? `${name} · ${n} without falling` : name), tone: 'blood' },
  shutdown: { title: 'Shutdown', sub: (name, n) => (n > 0 ? `${name} ends a streak of ${n}` : `${name} ends the streak`), tone: 'frost' },
  ringout: { title: 'Ring Out', sub: (name) => (name ? `${name} feeds the cloud sea` : 'The cloud sea is fed'), tone: 'frost' },
  matchstart: { title: 'Fight', sub: (_n, n) => (n > 0 ? `First to ${n} kills` : 'The Skygate is open'), tone: 'gold' },
  oneminute: { title: 'One Minute', sub: () => 'The horn sounds soon', tone: 'plain' },
  tenseconds: { title: 'Ten Seconds', sub: () => 'Make them count', tone: 'blood' },
  matchend: { title: 'Match Over', sub: (name) => (name ? `${name} takes the day` : 'Back to the hearth'), tone: 'gold' },
  lead: { title: 'Takes the Lead', sub: (name) => name, tone: 'plain', minor: true },
};

export const GLORY_WHY: Record<string, string> = {
  hit: 'Damage', kill: 'Kill', ringout: 'Ring out', place: 'Placement', match: 'Match fought',
};

export const RULES: { icon: string; title: string; text: string }[] = [
  { icon: 'swords', title: 'Nothing can be blocked', text: 'No guard, no parry. Every clean hit interrupts. You defend by not being there.' },
  { icon: 'spark', title: 'Light hits flinch, heavy hits launch', text: 'A launched fighter tumbles helpless and is knocked down on landing. Tap jump just before you land to roll out of it.' },
  { icon: 'fall', title: 'The edge kills', text: 'Knockback grows as health drops. Fall into the cloud sea and you are gone — the last warrior to hit you takes the kill.' },
  { icon: 'flame', title: 'Statuses stack the odds', text: 'Burn eats health. Four Chill freezes — shatter it. Shock and Slow drag, Root pins, a Bubble floats you helpless until popped.' },
  { icon: 'heart', title: 'Health runes sit where it is dangerous', text: 'They wake on the outer islets and landmarks. The walk there is narrow on purpose.' },
  { icon: 'trophy', title: 'Five minutes or twenty kills', text: 'Drop in any time through the Skygate. When the horn sounds, the top three take the podium and everyone returns to the hall.' },
];

export const GLORY_LINES: { icon: string; title: string; text: string }[] = [
  { icon: 'glory', title: 'Earned in the arena', text: 'Every point of damage pays. Kills pay more, ring-outs more still, and the podium pays best of all.' },
  { icon: 'lock', title: 'Spent in the hall', text: 'Walk up to a pedestal in the gallery to study an element. Glory unlocks them one at a time, in order.' },
  { icon: 'dummy', title: 'Try before you buy', text: 'Any element can be taken into the sparring ring for free. The dummies do not mind.' },
  { icon: 'star', title: 'Never power', text: 'Glory buys new ways to fight, not stronger ones. Every element is tuned to win.' },
];

export const TOUCH_GUIDE: { glyph: string; title: string; text: string }[] = [
  { glyph: 'stick', title: 'Left thumb', text: 'Touch anywhere on the left to place the stick, then drag to move.' },
  { glyph: 'look', title: 'Right thumb', text: 'Drag anywhere on the right to aim. Dragging off a button keeps aiming while it fires.' },
  { glyph: 'melee', title: 'The big button', text: 'Your melee strike. The three around it are your element\'s attacks.' },
  { glyph: 'move', title: 'Outer arc', text: 'Your signature move and jump sit under the thumb\'s reach.' },
];

export const CONNECTION_LABEL: Record<string, string> = {
  connecting: 'Reaching the hall…', online: 'Online', reconnecting: 'Reconnecting…', offline: 'Offline',
};

export const DIFFICULTY_LABEL = ['', 'Straightforward', 'Demanding', 'Unforgiving'];
