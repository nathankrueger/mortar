import type { WeaponId } from '../weapons';

export type Seat = 0 | 1;

/** Mutable tank state inside the sim. y is the ground-contact (bottom) line. */
export interface SimTank {
  seat: Seat;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

export interface ShotParams {
  seat: Seat;
  weapon: WeaponId;
  /** Degrees in (0,180], CCW from +x. 90 = straight up. */
  angleDeg: number;
  /** POWER_MIN..POWER_MAX. */
  power: number;
}

/** Everything a shot needs; mask and tanks are mutated during resolution. */
export interface ShotContext {
  mask: import('../terrain/mask').TerrainMask;
  tanks: SimTank[];
  /** Horizontal acceleration, wu/s^2 (signed). */
  wind: number;
  /** Server-rolled per-turn seed driving all in-shot randomness. */
  seed: number;
}

export type ProjectileKind = WeaponId | 'warhead' | 'nukelet';

export type SimEvent =
  | {
      t: 'spawn';
      id: number;
      kind: ProjectileKind;
      weapon: WeaponId;
      x: number;
      y: number;
      vx: number;
      vy: number;
      tick: number;
    }
  | {
      /** Sampled positions for playback: sample i is at startTick + i*stride. */
      t: 'path';
      id: number;
      startTick: number;
      stride: number;
      xs: number[];
      ys: number[];
    }
  | { t: 'split'; id: number; tick: number }
  | { t: 'bounce'; id: number; x: number; y: number; vx: number; vy: number; n: number; tick: number }
  | { t: 'explode'; id: number; x: number; y: number; r: number; tier: number; tick: number }
  | {
      t: 'carve';
      circles: { x: number; y: number; r: number; add?: boolean }[];
      tick: number;
    }
  | { t: 'fizzle'; id: number; x: number; y: number; tick: number }
  | {
      t: 'damage';
      seat: Seat;
      amount: number;
      direct: boolean;
      hpAfter: number;
      tick: number;
    }
  | { t: 'fall'; seat: Seat; x: number; fromY: number; toY: number; dmg: number; hpAfter: number; tick: number }
  | { t: 'die'; seat: Seat; tick: number };

export interface ShotOutcome {
  events: SimEvent[];
  /** Damage dealt by the shooter to the opponent (for credit awards). */
  damageToOpponent: number;
  directHits: number;
  /** Ticks the whole resolution took (playback duration). */
  ticks: number;
}
