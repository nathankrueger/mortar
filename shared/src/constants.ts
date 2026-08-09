// Protocol version — bump on any wire-format change so stale clients fail loudly.
export const PROTOCOL_VERSION = 1;

// World: 1 world unit (wu) = 1 terrain texel. y grows downward; gravity is +y.
export const WORLD_W = 2400;
export const WORLD_H = 1350;

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;

export const GRAVITY = 800; // wu/s^2

// Wind is a horizontal acceleration applied to every airborne projectile.
export const WIND_MAX_DEFAULT = 120; // wu/s^2

export const POWER_MIN = 5;
export const POWER_MAX = 100;
export const MUZZLE_SPEED_PER_POWER = 14; // v0 = power * 14 wu/s

// Angle convention: degrees in (0, 180], measured CCW from +x.
// 90 = straight up, <90 fires right, >90 fires left.
export const ANGLE_MIN = 2;
export const ANGLE_MAX = 178;

export const TANK_HALF_W = 22; // 44 wu footprint
export const TANK_H = 18;
// Distance from tank center within which a projectile counts as touching the hull.
export const TANK_HIT_RADIUS = 16;

export const MAX_PROJECTILE_SECONDS = 15; // per-projectile lifetime cap
export const MAX_RESOLUTION_SECONDS = 20; // whole-shot watchdog

// Out-of-bounds margins before a projectile fizzles.
export const OOB_MARGIN_X = 200;
export const OOB_MARGIN_Y_BOTTOM = 50;

// ---- Wire quantization -------------------------------------------------
// Positions travel as tenths of a wu; angles as deci-degrees. Integers only
// on the wire keeps payloads compact and avoids float-formatting drift.

export const quantPos = (v: number): number => Math.round(v * 10);
export const dequantPos = (q: number): number => q / 10;
export const quantAngle = (deg: number): number => Math.round(deg * 10);
export const dequantAngle = (deci: number): number => deci / 10;
