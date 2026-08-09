// The single source of truth for every weapon: the sim reads behavior from it,
// the shop UI reads prices, the economy validates against it, and the AI ranks
// purchases with it. All numbers are per the design table and freely tunable.

export type WeaponId =
  | 'mortar'
  | 'sniper'
  | 'largeMortar'
  | 'dirtBomb'
  | 'roller'
  | 'bounceBomb'
  | 'mirv'
  | 'digger'
  | 'smallNuke'
  | 'airstrike'
  | 'multiMirv'
  | 'mirvBounce'
  | 'mnw'
  | 'medNuke'
  | 'largeNuke'
  | 'bigOne';

export type WeaponBehavior =
  | 'shell'
  | 'mirv'
  | 'bounce'
  | 'mirvBounce'
  | 'mnw'
  | 'roller'
  | 'digger'
  | 'airstrike'
  | 'dirt';

export interface SplitSpec {
  /** Number of warheads at apex. */
  count: number;
  /** Horizontal velocity separation between adjacent warheads (wu/s). */
  spreadVx: number;
  /** Seeded jitter added to each child's vx (± wu/s). */
  jitterVx: number;
}

export interface BounceSpec {
  /** Hop count rolled in [min, max] from the shot seed. */
  min: number;
  max: number;
  /** Horizontal velocity retained per hop. */
  restitution: number;
  /** Seeded random horizontal kick per hop (± wu/s). */
  nudge: number;
  /** Probability the FINAL landing fizzles instead of delivering the finale. */
  dudChance: number;
  /** Every landing before the finale detonates with these stats. */
  hopBlastR: number;
  hopDmg: number;
}

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  blurb: string;
  /** null = free and unlimited (the basic Mortar). */
  price: number | null;
  behavior: WeaponBehavior;
  /** Blast radius (wu) — per warhead for splitting weapons; mound radius for dirt. */
  blastR: number;
  /** Epicenter splash damage — per warhead for splitting weapons. */
  dmg: number;
  /** FX/audio tier: 0 shell … 4 The Big One. */
  tier: 0 | 1 | 2 | 3 | 4;
  split?: SplitSpec;
  bounce?: BounceSpec;
  /** MNW: weights for launching k = 1..5 warheads. */
  mnwWeights?: readonly number[];
  /** Digger: how much soil it can tunnel through before detonating. */
  dig?: { depth: number };
  /** Airstrike: the barrage called in on the marker. */
  airstrike?: { count: number; spread: number; blastR: number; dmg: number };
}

export const DIRECT_HIT_MULTIPLIER = 1.85;
export const DIRECT_HIT_DAMAGE_CAP = 100;
export const SPLASH_FALLOFF_EXP = 1.3;
export const FALL_DAMAGE_PER_WU = 0.15;
export const FALL_DAMAGE_FREE_WU = 48;
export const FALL_DAMAGE_CAP = 60;

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  mortar: {
    id: 'mortar',
    name: 'Mortar',
    blurb: 'Trusty standard shell. Free, forever.',
    price: null,
    behavior: 'shell',
    blastR: 40,
    dmg: 24,
    tier: 0,
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper Shell',
    blurb: 'Tiny blast, brutal on a direct hit. Aim true.',
    price: 350,
    behavior: 'shell',
    blastR: 18,
    dmg: 30,
    tier: 0,
  },
  largeMortar: {
    id: 'largeMortar',
    name: 'Large Mortar',
    blurb: 'A heavier casing with real dig.',
    price: 450,
    behavior: 'shell',
    blastR: 58,
    dmg: 34,
    tier: 0,
  },
  dirtBomb: {
    id: 'dirtBomb',
    name: 'Dirt Bomb',
    blurb: 'No boom — just a fresh hill. Bury them, or wall yourself in.',
    price: 600,
    behavior: 'dirt',
    blastR: 65,
    dmg: 0,
    tier: 0,
  },
  roller: {
    id: 'roller',
    name: 'Roller',
    blurb: 'Rolls downhill and detonates in the valley. Feeds on campers.',
    price: 700,
    behavior: 'roller',
    blastR: 55,
    dmg: 30,
    tier: 0,
  },
  digger: {
    id: 'digger',
    name: 'Digger',
    blurb: 'Burrows deep before detonating. The ground above simply leaves.',
    price: 1600,
    behavior: 'digger',
    blastR: 70,
    dmg: 40,
    tier: 1,
    dig: { depth: 150 },
  },
  airstrike: {
    id: 'airstrike',
    name: 'Airstrike',
    blurb: 'Mark the spot; six shells arrive from above.',
    price: 2600,
    behavior: 'airstrike',
    blastR: 20,
    dmg: 5,
    tier: 0,
    airstrike: { count: 6, spread: 160, blastR: 34, dmg: 15 },
  },
  mirv: {
    id: 'mirv',
    name: 'Mirv',
    blurb: 'Splits into five warheads at the top of its arc.',
    price: 1300,
    behavior: 'mirv',
    blastR: 34,
    dmg: 15,
    tier: 0,
    split: { count: 5, spreadVx: 55, jitterVx: 12 },
  },
  multiMirv: {
    id: 'multiMirv',
    name: 'Multi Mirv',
    blurb: 'Nine-way saturation. Blot out the sky.',
    price: 2900,
    behavior: 'mirv',
    blastR: 30,
    dmg: 12,
    tier: 0,
    split: { count: 9, spreadVx: 46, jitterVx: 14 },
  },
  smallNuke: {
    id: 'smallNuke',
    name: 'Small Nuke',
    blurb: 'Entry-level atom splitting.',
    price: 2200,
    behavior: 'shell',
    blastR: 95,
    dmg: 48,
    tier: 1,
  },
  medNuke: {
    id: 'medNuke',
    name: 'Medium Nuke',
    blurb: 'The dependable workhorse of mass destruction.',
    price: 4200,
    behavior: 'shell',
    blastR: 135,
    dmg: 62,
    tier: 2,
  },
  largeNuke: {
    id: 'largeNuke',
    name: 'Large Nuke',
    blurb: 'Redraws the map in your favor.',
    price: 6800,
    behavior: 'shell',
    blastR: 180,
    dmg: 78,
    tier: 3,
  },
  bigOne: {
    id: 'bigOne',
    name: 'The Big One',
    blurb: 'You will feel this one through the screen.',
    price: 12000,
    behavior: 'shell',
    blastR: 260,
    dmg: 95,
    tier: 4,
  },
  mnw: {
    id: 'mnw',
    name: 'MNW',
    blurb: 'Gamble: bursts into one to five small nukes.',
    price: 3800,
    behavior: 'mnw',
    blastR: 95, // per launched warhead (small-nuke class)
    dmg: 48,
    tier: 1,
    mnwWeights: [10, 20, 30, 25, 15],
  },
  bounceBomb: {
    id: 'bounceBomb',
    name: 'Bounce Bomb',
    blurb: 'Detonates, leaps away, detonates again. Usually finishes big.',
    price: 900,
    behavior: 'bounce',
    blastR: 62, // finale
    dmg: 34,
    tier: 0,
    bounce: {
      min: 3,
      max: 6,
      restitution: 0.6,
      nudge: 110,
      dudChance: 0.18,
      hopBlastR: 46,
      hopDmg: 16,
    },
  },
  mirvBounce: {
    id: 'mirvBounce',
    name: 'Mirv Bounce',
    blurb: 'Five warheads, each hopping and blasting on its own.',
    price: 3400,
    behavior: 'mirvBounce',
    blastR: 38, // finale per warhead
    dmg: 18,
    tier: 0,
    split: { count: 5, spreadVx: 55, jitterVx: 12 },
    bounce: {
      min: 2,
      max: 2,
      restitution: 0.6,
      nudge: 110,
      dudChance: 0,
      hopBlastR: 30,
      hopDmg: 10,
    },
  },
};

export const WEAPON_ORDER: readonly WeaponId[] = [
  'mortar',
  'sniper',
  'largeMortar',
  'dirtBomb',
  'roller',
  'bounceBomb',
  'mirv',
  'digger',
  'smallNuke',
  'airstrike',
  'multiMirv',
  'mirvBounce',
  'mnw',
  'medNuke',
  'largeNuke',
  'bigOne',
];

export function weaponSpec(id: WeaponId): WeaponSpec {
  return WEAPONS[id];
}
