import { deriveSeed, mulberry32, randInt } from './rng';

/** One tank livery: hull/dome color plus a darker barrel/trim shade. */
export interface TankColor {
  name: string;
  main: number;
  deep: number;
}

/** Small palette of liveries; every entry reads clearly against every sky theme. */
export const TANK_PALETTE: readonly TankColor[] = [
  { name: 'blue', main: 0x4f9cf9, deep: 0x2f6fd4 },
  { name: 'coral', main: 0xff7a59, deep: 0xd94f2f },
  { name: 'emerald', main: 0x34d399, deep: 0x059669 },
  { name: 'violet', main: 0xa78bfa, deep: 0x7c3aed },
  { name: 'gold', main: 0xfbbf24, deep: 0xd97706 },
  { name: 'pink', main: 0xf472b6, deep: 0xdb2777 },
];

const SALT_COLORS = 0x51c2;

/**
 * The match's two liveries, always distinct, rolled deterministically from the
 * round seed so online clients agree. Uses its own child seed — the terrain a
 * seed generates is unaffected.
 */
export function seatColorsForSeed(seed: number): [TankColor, TankColor] {
  const rng = mulberry32(deriveSeed(seed, SALT_COLORS));
  const first = randInt(rng, 0, TANK_PALETTE.length - 1);
  const shift = randInt(rng, 1, TANK_PALETTE.length - 1);
  return [TANK_PALETTE[first], TANK_PALETTE[(first + shift) % TANK_PALETTE.length]];
}
