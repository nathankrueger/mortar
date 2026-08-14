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

/** A player's chosen palette index, or null for "surprise me each match". */
export type ColorPick = number | null;

/**
 * The match's two liveries, always distinct. Explicit picks are honored;
 * empty seats roll deterministically from the round seed so online clients
 * agree. Uses its own child seed — the terrain a seed generates is
 * unaffected. If both players picked the same color, seat 0 keeps it and
 * seat 1 rolls a random different one.
 */
export function resolveSeatColors(seed: number, picks: [ColorPick, ColorPick]): [TankColor, TankColor] {
  const n = TANK_PALETTE.length;
  const rng = mulberry32(deriveSeed(seed, SALT_COLORS));
  const valid = (p: ColorPick): number =>
    p !== null && Number.isInteger(p) && p >= 0 && p < n ? p : -1;
  let c0 = valid(picks[0]);
  let c1 = valid(picks[1]);
  if (c1 === c0) c1 = -1;
  if (c0 === -1) {
    do c0 = randInt(rng, 0, n - 1);
    while (c0 === c1);
  }
  if (c1 === -1) {
    do c1 = randInt(rng, 0, n - 1);
    while (c1 === c0);
  }
  return [TANK_PALETTE[c0], TANK_PALETTE[c1]];
}

/** Both seats random — the no-picks default. */
export function seatColorsForSeed(seed: number): [TankColor, TankColor] {
  return resolveSeatColors(seed, [null, null]);
}
