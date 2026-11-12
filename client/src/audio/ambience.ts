// Live ambience: layers the pre-rendered beds and steers them from the weather every frame.
// Outdoors: wind (body + voice, gusting), blizzard howl, snowfall hush, far storm rumble, the
// cloud-sea bed, aurora shimmer. In the hall: the long fire (positional), timber creaks, and the
// same wind heard muffled through the walls.

import type { Weather } from '@shared/weather';
import { HALL } from '@shared/world';
import type { SoundBank } from './bank';
import { clamp01, smoothstep } from './dsp';
import { CREAK_VARIANTS } from './sfx/ambience';

interface Vec { x: number; y: number; z: number }

/** One looping bed that only runs while it is audible. */
class Bed {
  private src: AudioBufferSourceNode | null = null;
  private readonly g: GainNode;
  private level = 0;
  private rate = 1;
  private quiet = 0;

  constructor(private ctx: BaseAudioContext, private bank: SoundBank, private key: string, dest: AudioNode, private phase = 0) {
    this.g = ctx.createGain();
    this.g.gain.value = 0;
    this.g.connect(dest);
  }

  set(level: number, rate = 1): void { this.level = level; this.rate = rate; }

  update(dt: number): void {
    const now = this.ctx.currentTime;
    if (this.level > 0.004) {
      this.quiet = 0;
      if (!this.src) {
        const s = this.bank.get(this.key);
        if (!s) return;
        const src = this.ctx.createBufferSource();
        src.buffer = s.buffer;
        src.loop = true;
        src.start(now, this.phase * s.buffer.duration);
        src.connect(this.g);
        this.src = src;
      }
      this.src.playbackRate.setTargetAtTime(this.rate, now, 0.3);
    } else if (this.src && (this.quiet += dt) > 2.5) {
      this.src.stop();
      this.src.disconnect();
      this.src = null;
    }
    this.g.gain.setTargetAtTime(this.level, now, 0.35);
  }

  dispose(): void {
    if (this.src) { try { this.src.stop(); } catch { /* not started */ } this.src.disconnect(); }
    this.g.disconnect();
  }
}

export class Ambience {
  private readonly outLP: BiquadFilterNode;
  private readonly outGain: GainNode;
  private readonly windPan: StereoPannerNode;
  private readonly firePan: PannerNode;
  private readonly fireWide: GainNode;
  private readonly beds: Record<'windL' | 'windR' | 'windHigh' | 'howl' | 'snow' | 'rumble' | 'clouds' | 'aurora' | 'fire', Bed>;
  private time = 0;
  private creakIn = 4;
  private seed = 12345;

  /** `creak` is called with a variant index and a position when a timber should groan. */
  constructor(private ctx: BaseAudioContext, bank: SoundBank, dest: AudioNode, private creak: (variant: number, pos: Vec) => void) {
    // everything outdoors passes through one filter: inside the hall the weather is a muffled presence
    this.outLP = ctx.createBiquadFilter();
    this.outLP.type = 'lowpass'; this.outLP.frequency.value = 18000; this.outLP.Q.value = 0.5;
    this.outGain = ctx.createGain();
    this.outLP.connect(this.outGain); this.outGain.connect(dest);
    const pan = (v: number): StereoPannerNode => { const p = ctx.createStereoPanner(); p.pan.value = v; p.connect(this.outLP); return p; };
    this.windPan = pan(0);
    this.firePan = ctx.createPanner();
    this.firePan.panningModel = 'equalpower';
    this.firePan.distanceModel = 'inverse';
    this.firePan.refDistance = 3.5;
    this.firePan.rolloffFactor = 1.3;
    this.firePan.connect(dest);
    this.fireWide = ctx.createGain();
    this.fireWide.gain.value = 0;
    this.fireWide.connect(dest);
    const fireIn = ctx.createGain();
    fireIn.connect(this.firePan); fireIn.connect(this.fireWide);
    this.beds = {
      windL: new Bed(ctx, bank, 'amb.windLow', pan(-0.65), 0),
      windR: new Bed(ctx, bank, 'amb.windLow', pan(0.65), 0.47),
      windHigh: new Bed(ctx, bank, 'amb.windHigh', this.windPan, 0.2),
      howl: new Bed(ctx, bank, 'amb.howl', this.windPan, 0.6),
      snow: new Bed(ctx, bank, 'amb.snow', this.outLP, 0),
      rumble: new Bed(ctx, bank, 'amb.rumble', this.outLP, 0.3),
      clouds: new Bed(ctx, bank, 'amb.clouds', this.outLP, 0.1),
      aurora: new Bed(ctx, bank, 'amb.aurora', this.outLP, 0.5),
      fire: new Bed(ctx, bank, 'amb.fire', fireIn, 0),
    };
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(dt: number, w: Weather, indoors: number, lp: Vec, fwd: Vec): void {
    const now = this.ctx.currentTime, b = this.beds;
    this.time += dt;
    const t = this.time;
    indoors = clamp01(indoors);

    // gusts: three slow incommensurate waves, deeper when the wind is up
    const gust = clamp01(0.5 + 0.28 * Math.sin(t * 0.37) + 0.17 * Math.sin(t * 0.83 + 1.3) + 0.12 * Math.sin(t * 1.9 + 4));
    const wind = clamp01(w.wind), base = 0.1 + 0.9 * wind;
    const body = base * (0.7 + 0.6 * gust * wind + 0.15 * gust);
    b.windL.set(body * 0.9, 0.92 + 0.14 * wind);
    b.windR.set(body * 0.9, 0.96 + 0.14 * wind);
    b.windHigh.set(Math.pow(wind, 1.4) * (0.3 + 1.1 * gust) * 1.15, 0.85 + 0.3 * gust * wind + 0.2 * wind);
    b.howl.set(smoothstep(0.45, 0.9, wind) * smoothstep(0.4, 0.9, w.snow) * (0.6 + 1.0 * gust), 0.9 + 0.25 * gust);
    b.snow.set(clamp01(w.snow) * 0.9 * (1 - 0.3 * wind));
    b.rumble.set(clamp01(w.storm) * 0.95);
    b.clouds.set(0.45);
    b.aurora.set(clamp01(w.aurora) * (1 - 0.6 * wind) * 0.9);

    // the wind arrives from where it blows from: lean it to that side of the listener
    const fromX = -Math.cos(w.windDir), fromZ = -Math.sin(w.windDir);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const rightX = -fwd.z / fl, rightZ = fwd.x / fl;
    this.windPan.pan.setTargetAtTime((fromX * rightX + fromZ * rightZ) * 0.55, now, 0.5);

    // indoors: wind and weather sink behind the timber walls
    this.outLP.frequency.setTargetAtTime(18000 * Math.pow(420 / 18000, indoors), now, 0.2);
    this.outGain.gain.setTargetAtTime(1 - 0.7 * indoors, now, 0.2);

    // the long fire: sound comes from the nearest point of the pit
    const pit = HALL.firepit;
    const fz = Math.max(pit.z - pit.hz, Math.min(pit.z + pit.hz, lp.z));
    const fy = HALL.floorY + 0.4;
    const dist = Math.hypot(lp.x - pit.x, lp.y - fy, lp.z - fz);
    if (dist < 75) {
      setPannerPos(this.firePan, pit.x, fy, fz, now);
      b.fire.set(0.9 + 0.22 * Math.sin(t * 0.6) * Math.sin(t * 0.23));
      // up close a ten-metre fire is all around you, not a point to one side
      const ref = this.firePan.refDistance;
      this.fireWide.gain.setTargetAtTime(0.3 * (ref / (ref + Math.max(0, dist - ref))) * (1 - smoothstep(4, 16, dist)), now, 0.2);
    } else b.fire.set(0);

    for (const k of Object.keys(b) as (keyof typeof b)[]) b[k].update(dt);

    // timbers settle now and then, somewhere overhead
    if (indoors > 0.5) {
      this.creakIn -= dt;
      if (this.creakIn <= 0) {
        this.creakIn = 6 + this.rand() * 12;
        this.creak(Math.floor(this.rand() * CREAK_VARIANTS), {
          x: HALL.minX + this.rand() * (HALL.maxX - HALL.minX),
          y: HALL.floorY + 3 + this.rand() * 6,
          z: HALL.minZ + this.rand() * (HALL.maxZ - HALL.minZ),
        });
      }
    }
  }

  dispose(): void {
    for (const k of Object.keys(this.beds) as (keyof typeof this.beds)[]) this.beds[k].dispose();
    this.outGain.disconnect();
    this.firePan.disconnect();
    this.fireWide.disconnect();
  }
}

/** Position a panner on browsers with and without AudioParam positions. */
export function setPannerPos(p: PannerNode, x: number, y: number, z: number, t: number): void {
  if (p.positionX) {
    p.positionX.setTargetAtTime(x, t, 0.03);
    p.positionY.setTargetAtTime(y, t, 0.03);
    p.positionZ.setTargetAtTime(z, t, 0.03);
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}
