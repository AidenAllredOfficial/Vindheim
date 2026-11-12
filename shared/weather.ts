// Deterministic weather: every client derives the same sky from the shared server clock,
// so the whole room sees the same snow squall roll in.

import { clamp01, noise2, smoothstep } from './math';

export interface Weather {
  /** Snowfall density 0..1 (there is always a little drifting snow). */
  snow: number;
  /** Wind strength 0..1 and direction (radians, direction the wind blows toward, as atan2(z, x)). */
  wind: number;
  windDir: number;
  /** Thunderstorm intensity 0..1 (distant lightning in the cloud sea, darker sky). */
  storm: number;
  /** Aurora brightness 0..1 (strongest when the sky is clear). */
  aurora: number;
  /** Extra fog 0..1. */
  fog: number;
  /** Name of the dominant condition, for the HUD / music. */
  label: 'clear' | 'snow' | 'blizzard' | 'storm';
}

/** Weather at a given server time (seconds). Slow, smooth, never repeats exactly. */
export function weatherAt(t: number): Weather {
  const a = noise2(t / 95, 1.7, 101);          // snow fronts
  const b = noise2(t / 140 + 31.4, 9.2, 202);  // storm fronts
  const c = noise2(t / 60 + 7.7, 4.4, 303);    // gusts
  const snowFront = smoothstep(0.5, 0.82, a);
  const storm = smoothstep(0.62, 0.86, b);
  const snow = clamp01(0.14 + snowFront * 0.86);
  const wind = clamp01(0.18 + c * 0.35 + snowFront * 0.3 + storm * 0.3);
  const windDir = noise2(t / 200, 77.7, 404) * Math.PI * 4;
  const aurora = clamp01(1 - snowFront * 0.75 - storm * 0.85);
  const fog = clamp01(snowFront * 0.7 + storm * 0.35);
  const label = storm > 0.5 ? 'storm' : snowFront > 0.75 ? 'blizzard' : snowFront > 0.3 ? 'snow' : 'clear';
  return { snow, wind, windDir, storm, aurora, fog, label };
}
