// Deterministic PRNG used for everything random in shared code.
// Math.random is banned in shared/ — every roll must be reproducible from a seed.
//
// Cross-engine determinism: only integer ops (imul/xor/shift) and the exactly
// specified IEEE-754 ops (+ - * /) are used, so sequences are bit-identical on
// V8, JavaScriptCore, and SpiderMonkey.

export type Rng = () => number; // uniform in [0, 1)

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One splitmix32 scramble step; good for deriving child seeds. */
export function splitmix32(seed: number): number {
  let z = (seed + 0x9e3779b9) >>> 0;
  z ^= z >>> 16;
  z = Math.imul(z, 0x21f0aaad);
  z ^= z >>> 15;
  z = Math.imul(z, 0x735a2d97);
  z ^= z >>> 15;
  return z >>> 0;
}

/** Stable child-seed derivation: same (seed, salt) always yields the same child. */
export function deriveSeed(seed: number, salt: number): number {
  return splitmix32((seed ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Integer in [min, max] inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)];
}

/** Index drawn according to non-negative weights (need not sum to 1). */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Center-biased value in [-max, max] (sum of two uniforms → triangular).
 * Used for wind so extreme gusts are rarer than mild ones.
 */
export function triangular(rng: Rng, max: number): number {
  return (rng() + rng() - 1) * max;
}
