import { describe, expect, it } from 'vitest';
import { WORLD_H, WORLD_W } from '../constants';
import { generateTerrain } from './generate';
import { THEMES } from './themes';

function heightsHash(heights: Float64Array): number {
  // FNV-1a over deci-wu quantized heights — bit-stable across runs/engines.
  let h = 0x811c9dc5;
  for (let i = 0; i < heights.length; i++) {
    const q = Math.round(heights[i] * 10);
    h ^= q & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

describe('generateTerrain', () => {
  it('is fully deterministic for a given seed', () => {
    const a = generateTerrain(1234);
    const b = generateTerrain(1234);
    expect(heightsHash(a.heights)).toBe(heightsHash(b.heights));
    expect(a.spawnX).toEqual(b.spawnX);
    expect(a.macro).toBe(b.macro);
    expect(a.themeIndex).toBe(b.themeIndex);
  });

  it('different seeds produce different terrain', () => {
    const hashes = new Set<number>();
    for (let seed = 0; seed < 25; seed++) hashes.add(heightsHash(generateTerrain(seed).heights));
    expect(hashes.size).toBe(25);
  });

  it('keeps every surface height within the playable band', () => {
    for (const seed of [0, 7, 99, 4242, 0xffff_ffff]) {
      const { heights } = generateTerrain(seed);
      expect(heights.length).toBe(WORLD_W);
      for (let x = 0; x < heights.length; x++) {
        expect(heights[x]).toBeGreaterThanOrEqual(0.4 * WORLD_H - 1e-9);
        expect(heights[x]).toBeLessThanOrEqual(0.92 * WORLD_H + 1e-9);
      }
    }
  });

  it('places spawns 10–20% in from each side', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { spawnX } = generateTerrain(seed);
      expect(spawnX[0]).toBeGreaterThanOrEqual(0.1 * WORLD_W);
      expect(spawnX[0]).toBeLessThanOrEqual(0.2 * WORLD_W);
      expect(spawnX[1]).toBeGreaterThanOrEqual(0.8 * WORLD_W);
      expect(spawnX[1]).toBeLessThanOrEqual(0.9 * WORLD_W);
    }
  });

  it('flattens a level shelf around each spawn', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { heights, spawnX } = generateTerrain(seed);
      for (const sx of spawnX) {
        const shelfY = heights[sx];
        for (let x = sx - 30; x <= sx + 30; x++) {
          expect(Math.abs(heights[x] - shelfY)).toBeLessThan(0.5);
        }
      }
    }
  });

  it('rolls a valid theme index', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { themeIndex } = generateTerrain(seed);
      expect(themeIndex).toBeGreaterThanOrEqual(0);
      expect(themeIndex).toBeLessThan(THEMES.length);
    }
  });

  it('hits every macro feature across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(generateTerrain(seed).macro);
    expect(seen.size).toBe(4);
  });
});
