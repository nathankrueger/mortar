import { describe, expect, it } from 'vitest';
import {
  chance,
  deriveSeed,
  mulberry32,
  pick,
  randInt,
  randRange,
  splitmix32,
  triangular,
  weightedIndex,
} from './rng';

// Independent re-implementation of the same algorithm. Guards rng.ts against
// accidental refactors changing the sequence (which would corrupt terrain
// seeds, bounce patterns, and replays).
function referenceMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it('matches the reference implementation exactly', () => {
    for (const seed of [0, 1, 42, 0xdeadbeef, 2 ** 31, -7]) {
      const impl = mulberry32(seed);
      const ref = referenceMulberry32(seed);
      for (let i = 0; i < 100; i++) expect(impl()).toBe(ref());
    }
  });

  it('produces values in [0, 1) with a reasonable spread', () => {
    const rng = mulberry32(777);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
  });

  it('different seeds produce different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const same = Array.from({ length: 20 }, () => a() === b()).filter(Boolean);
    expect(same.length).toBeLessThan(3);
  });
});

describe('splitmix32 / deriveSeed', () => {
  it('is a pure function of its input', () => {
    expect(splitmix32(123)).toBe(splitmix32(123));
    expect(deriveSeed(999, 4)).toBe(deriveSeed(999, 4));
  });

  it('produces distinct children for distinct salts', () => {
    const seen = new Set<number>();
    for (let salt = 0; salt < 1000; salt++) seen.add(deriveSeed(42, salt));
    expect(seen.size).toBe(1000);
  });

  it('stays within uint32 range', () => {
    for (let i = 0; i < 100; i++) {
      const v = splitmix32(i * 7919);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('randInt covers the inclusive range and nothing else', () => {
    const rng = mulberry32(5);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = randInt(rng, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6, 7]));
  });

  it('randRange stays within bounds', () => {
    const rng = mulberry32(6);
    for (let i = 0; i < 1000; i++) {
      const v = randRange(rng, -2.5, 4.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4.5);
    }
  });

  it('chance approximates its probability', () => {
    const rng = mulberry32(7);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (chance(rng, 0.18)) hits++;
    expect(hits / 20_000).toBeGreaterThan(0.16);
    expect(hits / 20_000).toBeLessThan(0.2);
  });

  it('pick only returns array members', () => {
    const rng = mulberry32(8);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 300; i++) expect(arr).toContain(pick(rng, arr));
  });

  it('weightedIndex respects weights (including zeros)', () => {
    const rng = mulberry32(9);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 30_000; i++) counts[weightedIndex(rng, [1, 0, 3, 6])]++;
    expect(counts[1]).toBe(0);
    expect(counts[0] / 30_000).toBeCloseTo(0.1, 1);
    expect(counts[2] / 30_000).toBeCloseTo(0.3, 1);
    expect(counts[3] / 30_000).toBeCloseTo(0.6, 1);
  });

  it('triangular is centered and bounded', () => {
    const rng = mulberry32(10);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) {
      const v = triangular(rng, 120);
      expect(Math.abs(v)).toBeLessThanOrEqual(120);
      sum += v;
    }
    expect(Math.abs(sum / 20_000)).toBeLessThan(3);
  });
});
