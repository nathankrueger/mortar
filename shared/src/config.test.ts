import { describe, expect, it } from 'vitest';
import { driftWind, WIND_DRIFT_FRAC } from './config';
import { mulberry32 } from './rng';

describe('driftWind', () => {
  it('moves in small bounded steps', () => {
    const rng = mulberry32(42);
    let wind = 0;
    const maxStep = Math.ceil(120 * WIND_DRIFT_FRAC) + 1; // rounding slack
    for (let turn = 0; turn < 500; turn++) {
      const next = driftWind(wind, rng, 120);
      expect(Math.abs(next - wind)).toBeLessThanOrEqual(maxStep);
      wind = next;
    }
  });

  it('never escapes ±windMax', () => {
    const rng = mulberry32(7);
    let wind = 118;
    for (let turn = 0; turn < 500; turn++) {
      wind = driftWind(wind, rng, 120);
      expect(Math.abs(wind)).toBeLessThanOrEqual(120);
    }
  });

  it('actually wanders over a long match', () => {
    const rng = mulberry32(99);
    let wind = 0;
    const seen = new Set<number>();
    for (let turn = 0; turn < 60; turn++) {
      wind = driftWind(wind, rng, 120);
      seen.add(wind);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('is deterministic for a given rng stream', () => {
    const run = () => {
      const rng = mulberry32(1234);
      let w = 0;
      const out: number[] = [];
      for (let i = 0; i < 20; i++) out.push((w = driftWind(w, rng, 120)));
      return out;
    };
    expect(run()).toEqual(run());
  });
});
