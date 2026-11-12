// Third-person aiming shared by the client camera and the server: where does the crosshair point?

import { dirFromYawPitch, type Vec3 } from '../math';
import type { World } from '../world';
import { CHEST_HEIGHT } from '../types';

/** Camera boom: pivot height above the feet, distance behind, and over-the-shoulder offset. */
export const CAM_HEIGHT = 2.0;
export const CAM_DIST = 4.7;
export const CAM_SIDE = 0.55;

const tmpDir = { x: 0, y: 0, z: 0 };

/** Camera pivot (the point the boom swings around) for a fighter at feet position (x,y,z). */
export function cameraPivot(x: number, y: number, z: number, yaw: number, out: Vec3): Vec3 {
  out.x = x + Math.cos(yaw) * CAM_SIDE;
  out.y = y + CAM_HEIGHT;
  out.z = z - Math.sin(yaw) * CAM_SIDE;
  return out;
}

/**
 * The world point under the crosshair of a fighter standing at (x,y,z) aiming along yaw/pitch.
 * `direct` aims straight from the chest (bots); otherwise the ray starts at the ideal camera
 * position so shots converge on what the player sees under the crosshair.
 */
export function aimPoint(world: World, x: number, y: number, z: number, yaw: number, pitch: number, range: number, direct: boolean, out: Vec3): Vec3 {
  const d = dirFromYawPitch(yaw, pitch);
  tmpDir.x = d.x; tmpDir.y = d.y; tmpDir.z = d.z;
  if (direct) {
    const oy = y + CHEST_HEIGHT;
    const hit = world.raycast(x, oy, z, d.x, d.y, d.z, range);
    const t = hit ? hit.t : range;
    out.x = x + d.x * t; out.y = oy + d.y * t; out.z = z + d.z * t;
    return out;
  }
  cameraPivot(x, y, z, yaw, out);
  // start the ray just beyond the fighter so cover between camera and fighter is ignored
  const t0 = 1.2;
  const ox = out.x + d.x * t0, oy = out.y + d.y * t0, oz = out.z + d.z * t0;
  const hit = world.raycast(ox, oy, oz, d.x, d.y, d.z, range);
  const t = hit ? hit.t : range;
  out.x = ox + d.x * t; out.y = oy + d.y * t; out.z = oz + d.z * t;
  return out;
}

/**
 * Unit direction from a muzzle point toward the aim point (falls back to the raw aim direction
 * when the target point is too close to be meaningful).
 */
export function shotDirection(mx: number, my: number, mz: number, aim: Vec3, yaw: number, pitch: number, out: Vec3): Vec3 {
  const dx = aim.x - mx, dy = aim.y - my, dz = aim.z - mz;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (l < 2.2) { const d = dirFromYawPitch(yaw, pitch); out.x = d.x; out.y = d.y; out.z = d.z; return out; }
  out.x = dx / l; out.y = dy / l; out.z = dz / l;
  return out;
}
