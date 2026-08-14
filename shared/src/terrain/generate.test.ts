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
    expect(a.trees).toEqual(b.trees);
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

  it('places spawns 5–15% in from each side', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { spawnX } = generateTerrain(seed);
      expect(spawnX[0]).toBeGreaterThanOrEqual(0.05 * WORLD_W);
      expect(spawnX[0]).toBeLessThanOrEqual(0.15 * WORLD_W);
      expect(spawnX[1]).toBeGreaterThanOrEqual(0.85 * WORLD_W);
      expect(spawnX[1]).toBeLessThanOrEqual(0.95 * WORLD_W);
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

  it('generates cosmetic side aprons that join the edges smoothly', () => {
    for (const seed of [2, 11, 99]) {
      const g = generateTerrain(seed);
      expect(g.apronLeft.length).toBe(WORLD_W / 2);
      expect(g.apronRight.length).toBe(WORLD_W / 2);
      // Index 0 hugs the world edge — continuity within a couple texels.
      expect(Math.abs(g.apronLeft[0] - g.heights[0])).toBeLessThan(2);
      expect(Math.abs(g.apronRight[0] - g.heights[WORLD_W - 1])).toBeLessThan(2);
      for (const arr of [g.apronLeft, g.apronRight]) {
        for (let i = 0; i < arr.length; i += 37) {
          expect(arr[i]).toBeGreaterThanOrEqual(0.3 * WORLD_H - 1e-9);
          expect(arr[i]).toBeLessThanOrEqual(0.95 * WORLD_H + 1e-9);
        }
      }
    }
  });

  it('aprons do not disturb the playfield RNG (same heights as before)', () => {
    const a = generateTerrain(1234);
    const b = generateTerrain(1234);
    expect([...a.heights]).toEqual([...b.heights]);
    expect([...a.apronLeft]).toEqual([...b.apronLeft]);
  });

  it('hits every macro feature across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(generateTerrain(seed).macro);
    expect(seen.size).toBe(4);
  });
});

describe('tree cover', () => {
  it('plants small trees in swaths on most maps', () => {
    let mapsWithTrees = 0;
    for (let seed = 0; seed < 20; seed++) {
      const { trees, spawnX } = generateTerrain(seed);
      if (trees.length === 0) continue;
      mapsWithTrees++;
      for (const t of trees) {
        expect(t.h).toBeGreaterThan(8);
        expect(t.h).toBeLessThan(45);
        expect(Math.abs(t.x - spawnX[0])).toBeGreaterThan(60);
        expect(Math.abs(t.x - spawnX[1])).toBeGreaterThan(60);
      }
    }
    expect(mapsWithTrees).toBeGreaterThan(10);
  });

  it('leaves bare stretches — trees cluster instead of carpeting', () => {
    let sawGap = 0;
    for (let seed = 0; seed < 20; seed++) {
      const { trees, heights } = generateTerrain(seed);
      if (trees.length < 5) continue;
      let maxGap = 0;
      for (let i = 1; i < trees.length; i++) {
        maxGap = Math.max(maxGap, trees[i].x - trees[i - 1].x);
      }
      if (maxGap > 0.1 * heights.length) sawGap++;
    }
    expect(sawGap).toBeGreaterThan(5);
  });
});
