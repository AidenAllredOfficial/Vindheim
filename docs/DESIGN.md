# Vindheim — design & art direction

Vindheim is a multiplayer 3D elemental arena fighter for desktop and mobile browsers.
This document is the creative and technical brief every part of the game is built against.

## The pitch

A shard of the old world floats above an endless sea of cloud. On it stands a firelit hall, and
below the hall an arena island of grass, rock, ice and ruin. Warriors gather at the hearth, take up
one of eight elemental disciplines from the pedestal gallery, step through the Skygate and fight a
free-for-all where **nothing can be blocked**: every clean hit interrupts, launches or knocks down,
and the abyss is always one mistake away. Fights are won with spacing, timing, prediction and
terrain — never with stats.

## Pillars

1. **Readable.** Every attack has a tell, a colour and a silhouette you can identify at a glance.
   Ground telegraphs are drawn on the ground. Enemies' effects are never subtler than your own.
2. **Physical.** Hits have weight: anticipation, impact frame, hit-stop, shake, knockback, a body
   that tumbles and lands. The terrain matters — edges kill, ice slides, walls block.
3. **Eight characters, not eight colours.** Each element changes how you move, where you want to
   stand and what you are afraid of.
4. **A place, not a menu.** The hall is a real room you walk around in. The gallery is physical.

## World

* **Vindheim (arena island)** — ~125 m across, centred on the origin. The Thing-stead (a ring of
  standing stones around a great rune monolith) in the middle; rocky two-tier highlands and the
  narrow Raven's Walk ledges to the north; a frozen lake with ice crystals and a wrecked longship to
  the east; a ruined temple to the south; pine woods and a deep chasm (bridged) to the south-west.
  Four outlying islets — Raven Rock, The Shard, Frostholm, Last Step — are reached by narrow
  bridges, ledges and stepping stones, and hold the health runes.
* **Hearth-Hall island** — floats north of the arena and higher. A timber long-hall with a long
  fire, carved posts, the pedestal gallery (four along each wall), the high seat; outside, a stone
  terrace, the sparring ring with three training dummies, and the Skygate looking down on the arena.
* **Sky** — perpetual arctic dusk: deep blue-teal zenith, a band of ember-orange at the horizon,
  a large pale moon, stars, green-violet aurora ribbons, and an endless slowly-rolling cloud sea far
  below. Weather drifts between clear, snowfall, blizzard and distant thunderstorm.

All collision geometry is defined in `shared/world.ts`; the renderer dresses those exact shapes.

## Art direction

**Stylised realism — painterly, moody, high contrast.** Think a AAA Norse fantasy seen through a
slightly stylised lens: chunky readable forms, rich PBR materials, strong rim light, deliberate
colour. Not cartoony, not low-poly-flat, not photoreal.

* **Palette.** The world is cold and desaturated (slate blues, grey-violet rock, pale snow, dark
  pine green, dull ochre grass) so that *warmth* and *elemental colour* carry all the emphasis:
  the hall's firelight (deep amber), torches and braziers in the arena, the glowing runes, and the
  eight saturated element colours.
* **Light.** A cool key light from the moon (casts the shadows), warm rim from the horizon glow,
  blue ambient from the sky. In the hall: warm, low, flickering fire light, deep shadows, drifting
  embers and dust, cold blue light spilling in through the door.
* **Shape language.** Norse: knotwork borders, Elder Futhark runes (glowing where magic is live),
  dragon-head beam ends, round shields, banners, longship curves, weathered timber, rough-hewn
  stone, iron rivets, fur and wool.
* **Characters.** Stylised warriors ~1.8 m: broad shoulders, big readable hands and weapons, cloak
  or fur mantle, helm or hood. Their element shows in gear colour, glowing runes and weapon.
* **Effects.** Hot cores, saturated bodies, dark accents. Each element owns one colour family and
  one motion language (see `shared/elements.ts` for exact colours):
  Ember — orange fire, embers rise; Frost — pale cyan crystal, sharp and brittle; Storm —
  violet-white lightning, instant and jagged; Stone — tan rock and dust, heavy and falling;
  Gale — mint-white wind streaks, curved and fast; Tide — deep blue water, round and flowing;
  Umbra — purple-black smoke, inward and silent; Dawn — gold-white light, straight lines and flares.
* **Interface.** Clean and characterful: dark slate glass panels with thin warm-gold rules, runic
  ornament used sparingly, a display serif for titles and a crisp sans for numbers. It must scale
  from a phone in landscape to a 4K monitor.

## Combat rules (summary)

* 100 health. No blocking, no parrying.
* **Light hits** flinch (interrupt + brief hit-stun) and shove. **Heavy hits** launch: the victim
  tumbles helplessly for about half a second. Land inside that window and you are knocked down
  (then get up with a moment of invulnerability; tapping jump just before landing "techs" it into
  a quick roll). Outlast it in the air and you right yourself — which is your one chance to steer
  or use your movement ability to get back to solid ground.
* Knockback grows as health drops. Falling into the cloud sea is death; the last attacker gets the kill.
* Statuses: Burn (damage over time), Chill ×4 → Freeze (shatter for bonus damage), Shock (slow),
  Root, Slow, Bubble (floating, helpless; pop for bonus damage), Shadowmeld (near-invisible).
* Health runes appear on the risky islets and landmarks.
* **Glory** (credit) is earned for damage dealt and kills, with bonuses for ring-outs and match
  placement, and is spent in the hall to unlock the next element.

## Match flow

Rooms run forever: **intermission** in the hall → **live** match (5 minutes or 20 kills; drop in
any time) → **results** podium → intermission. Public rooms are topped up with bots; private rooms
are joined by code.

## Architecture

```
shared/   deterministic simulation: world, elements, player physics, combat, bots, protocol
server/   Node + ws: rooms, matchmaking, authoritative simulation at 60 Hz, persistence
client/   three.js renderer, prediction/interpolation, effects, audio, interface
```

The server is authoritative. The client predicts its own fighter with the same `shared/` step
function and reconciles against snapshots (30 Hz); other fighters are interpolated. Projectiles and
zones are replicated as spawn/despawn events and simulated locally in between.

## Appendix — entity & event catalogue

Combat is replicated as **entities** (`EntityState`, announced by a `spawn` event and ended by a
`despawn` event) and **instant events** (`fx`, `hit`, `tp`, `pop`, …) — see `shared/types.ts`.
The client core owns the entity objects and advances them every frame (position, velocity, age);
presentation code renders from the live object it was handed.

Despawn reasons (`why`): 0 expired · 1 hit the world · 2 hit a fighter · 3 triggered/detonated ·
4 overloaded/shattered.

| kind | element | what it is | fields / behaviour |
|---|---|---|---|
| `fireball` | ember | projectile | straight, r 0.45, 36 m/s. Ends in a 2.4 m fiery burst (why 1/2). |
| `flamewave` | ember | `fx` cone | origin = caster chest, (x2,y2,z2) = point at full range along the aim, r = range 7.2 m, arc 85°. |
| `meteor` | ember | delayed strike | sits at the ground target; `p` = fuse (1.15 s), `r` = blast radius 4.6. Telegraph ring fills while a meteor falls from the sky and arrives exactly at `age == p`; despawn why 3 = impact. A `firepatch` follows. |
| `firepatch` | ember | zone | static burning ground, r 3.2, 3.6 s. |
| `cindertrail` | ember | zone | small burning patches (r 1.35, 2.4 s) laid in a row along a Cinder Dash. |
| `iceshard` | frost | projectile | thin fast shard, 46 m/s, fired in volleys of three. |
| `spikes` | frost | line eruption | origin at caster's feet, direction = normalised (vx,0,vz), `p` = length 15, `q` = front speed 32, `r` = half width. Spikes erupt as the front (age·q) passes, linger ~0.6 s, crumble. |
| `rimerune` | frost | trap | static rune on the ground; `p` = arm time, `r` = trigger radius. Owner sees it clearly, others only a faint shimmer. why 3 = triggered (a `rimeburst` fx follows). |
| `rimeburst` | frost | `fx` burst | freezing nova at (x,y,z), r 3.2. |
| `icetrail` | frost | zone | ribbon patches of ice (r 1.5, 3.2 s) laid behind a Glacier Glide. |
| `arcbolt` | storm | `fx` beam | instant lightning from (x,y,z) to (x2,y2,z2). A chain jump is a second `fx`. |
| `balllightning` | storm | moving zone | drifting orb (body r 0.85, 8.5 m/s, 4.5 s) that zaps fighters within 5 m — each zap is a `hit` event whose `eid` is the orb. why 3 = detonation (r 3.2), why 4 = overload (r 5.6, much bigger). |
| `thunderstrike` | storm | delayed strike | like meteor: `p` = fuse 0.75 s, r 3.4. A bolt from the sky at `age == p`. |
| `staticburst` | storm | `fx` burst | crackling ring where a Thunderstep began, r 3.2. Thunderstep itself is a `tp` event (k `thunderstep`). |
| `boulder` | stone | projectile | heavy arcing rock (gravity `g` 16), r 0.8; shatters on impact (r 2). |
| `rampart` | stone | wall | (x,y,z) = centre of the base on the ground, `yaw` = collider yaw (the wall's long axis is the collider's local x), `p` = length 7, `q` = height 3.4, `r` = half thickness. Rises in ~0.25 s, stands 7 s; why 0 = crumbles, why 4 = shattered by its owner's hammer (`rockshard`s fly). |
| `rockshard` | stone | projectile | small rock fragments from a shattered rampart. |
| `earthshatter` | stone | `fx` burst | ground shockwave from the caster's feet, r 7. |
| `leapslam` | stone | `fx` burst | landing shockwave of a Seismic Leap, r 4.6. |
| `gustblade` | gale | projectile | wide crescent of wind (r 1.05), 48 m/s, pierces. Oriented along its velocity. |
| `cyclone` | gale | moving zone | tornado funnel r 2.8 (pulls from 7.5 m), 7.5 m/s, 4.6 s. |
| `jetstream` | gale | channel | attached to the caster: (x,y,z) = origin at the chest, (vx,vy,vz) = unit aim direction (updated every frame), `p` = range 15, `q` = width 2.8, 1.3 s. |
| `waterjet` | tide | channel | as jetstream: `p` = 16, `q` = 1.3, 0.8 s. A tight pressurised stream. |
| `bubble` | tide | projectile | slow wobbling bubble (r 1.0, 15 m/s). A caught fighter gets the `bubbled` status (draw the bubble around them); a `pop` event ends it. |
| `tidalwave` | tide | moving wall | (x,y,z) = centre at ground level moving at (vx,vz) = 15 m/s, `yaw` = collider-style yaw of the crest line, `p` = width 9, `q` = height 3.2, 1.33 s. |
| `dagger` | umbra | projectile | fan of three shadow daggers, 46 m/s. |
| `snare` | umbra | zone | pool of grasping shadow r 3.4, 5.5 s; `p` = arm time 0.5. |
| `shade` | umbra | projectile | a thrown shade, 36 m/s. On hit the caster teleports behind the victim (`tp` event, k `duskstep`). |
| `glint` | dawn | projectile | needle of light, 85 m/s — draw it as a streak. |
| `solarflare` | dawn | `fx` burst | radial blast of light around the caster, r 5.6. |
| `sunlance` | dawn | channel then `fx` beam | while charging (1.0 s) an entity attached to the caster: origin, unit direction, `p` = range 70, `q` = width 1.6 — a thin warning line that brightens. On release an `fx` k `sunlance` from (x,y,z) to (x2,y2,z2): a colossal beam that lingers ~0.4 s. |
| `raydash` | dawn | `fx` | Lightray: (x,y,z) = start, (x2,y2,z2) = end, r = flash radius 2.8 at the end. A streak of light between, a flare at the end. |
| `healrune` | world | pickup | floating glowing rune at a landmark; why 2 = taken. |

Other events: `hit` (impact point, knockback direction, damage, heavy/crit/kill flags), `death`
(with `fall` for ring-outs), `respawn`, `tp` (also k `deploy` when a fighter drops into the arena),
`pop` (freeze shattered / bubble burst), `pickup`.

Fighter movement signatures are read from `PlayerView.mv`: `MV_DASH` (Ember), `MV_GLIDE` (Frost),
`MV_SOAR` (Gale), `MV_SURGE` (Tide), `MV_LEAP` (Stone), `MV_RAY` (Dawn). Storm's Thunderstep is a
`tp` event and Umbra's Shadowmeld is the `stealth` status.
