import { describe, expect, it } from 'vitest';
import { seatColorsForSeed, TANK_PALETTE } from './colors';

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
