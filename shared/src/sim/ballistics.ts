import { GRAVITY, muzzlePerPower, POWER_MAX, POWER_MIN, WORLD_W } from '../constants';

export function muzzleSpeed(power: number, worldW = WORLD_W): number {
  const p = Math.min(POWER_MAX, Math.max(POWER_MIN, power));
  return p * muzzlePerPower(worldW);
}

/** Initial velocity for an angle (deg, CCW from +x) and power. y is down. */
export function muzzleVelocity(
  angleDeg: number,
  power: number,
  worldW = WORLD_W,
): { vx: number; vy: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const v = muzzleSpeed(power, worldW);
  return { vx: Math.cos(rad) * v, vy: -Math.sin(rad) * v };
}

/** Flat-ground range with no wind — the AI's closed-form first guess. */
export function flatRange(angleDeg: number, power: number, worldW = WORLD_W): number {
  const rad = (angleDeg * Math.PI) / 180;
  const v = muzzleSpeed(power, worldW);
  return (v * v * Math.sin(2 * rad)) / GRAVITY;
}

/**
 * Closed-form (angle, power) guess to land at horizontal distance dx (signed)
 * with a 45°-class lofted arc. Returns null when out of reach at max power.
 */
export function aimForRange(dx: number, worldW = WORLD_W): { angleDeg: number; power: number } | null {
  const dist = Math.abs(dx);
  const bestAngle = dx >= 0 ? 45 : 135;
  // v^2 = g * d at 45°.
  const v = Math.sqrt(GRAVITY * dist);
  const power = v / muzzlePerPower(worldW);
  if (power > POWER_MAX) return null;
  return { angleDeg: bestAngle, power: Math.max(POWER_MIN, power) };
}
