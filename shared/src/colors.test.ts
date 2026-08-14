import { describe, expect, it } from 'vitest';
import { resolveSeatColors, seatColorsForSeed, TANK_PALETTE } from './colors';

describe('seatColorsForSeed', () => {
  it('is deterministic per seed', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(seatColorsForSeed(seed)).toEqual(seatColorsForSeed(seed));
    }
  });

  it('always picks two distinct palette entries', () => {
    for (let seed = 0; seed < 200; seed++) {
      const [a, b] = seatColorsForSeed(seed);
      expect(a).not.toBe(b);
      expect(TANK_PALETTE).toContain(a);
      expect(TANK_PALETTE).toContain(b);
    }
  });

  it('varies across seeds', () => {
    const combos = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const [a, b] = seatColorsForSeed(seed);
      combos.add(`${a.name}/${b.name}`);
    }
    expect(combos.size).toBeGreaterThan(5);
  });
});

describe('resolveSeatColors', () => {
  it('honors explicit picks', () => {
    for (let seed = 0; seed < 20; seed++) {
      const [a, b] = resolveSeatColors(seed, [2, 4]);
      expect(a).toBe(TANK_PALETTE[2]);
      expect(b).toBe(TANK_PALETTE[4]);
    }
  });

  it('rolls the unpicked seat away from the picked color', () => {
    for (let seed = 0; seed < 100; seed++) {
      const [a, b] = resolveSeatColors(seed, [3, null]);
      expect(a).toBe(TANK_PALETTE[3]);
      expect(b).not.toBe(TANK_PALETTE[3]);
      const [c, d] = resolveSeatColors(seed, [null, 0]);
      expect(d).toBe(TANK_PALETTE[0]);
      expect(c).not.toBe(TANK_PALETTE[0]);
    }
  });

  it('on a collision seat 0 keeps the pick and seat 1 rerolls', () => {
    for (let seed = 0; seed < 100; seed++) {
      const [a, b] = resolveSeatColors(seed, [1, 1]);
      expect(a).toBe(TANK_PALETTE[1]);
      expect(b).not.toBe(TANK_PALETTE[1]);
    }
  });

  it('ignores out-of-range picks', () => {
    const [a, b] = resolveSeatColors(7, [99, -3]);
    expect(TANK_PALETTE).toContain(a);
    expect(TANK_PALETTE).toContain(b);
    expect(a).not.toBe(b);
  });
});
