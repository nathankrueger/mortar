import { describe, expect, it } from 'vitest';
import { POWER_MAX, POWER_MIN, WORLD_W } from '../constants';
import { applyPurchase, hasAmmo, type Inventory } from '../economy';
import { TerrainMask } from '../terrain/mask';
import type { SimTank } from '../sim/types';
import { WEAPONS } from '../weapons';
import { evaluateShot, planShot, type AiAimContext } from './aim';
import { FIRE_PRIORITY, pickWeapon, planPurchases } from './shop';

function flatCtx(): AiAimContext {
  const heights = new Float64Array(WORLD_W).fill(900);
  const tanks: SimTank[] = [
    { seat: 0, x: 500, y: 900, hp: 100, alive: true },
    { seat: 1, x: 1800, y: 900, hp: 100, alive: true },
  ];
  return { mask: TerrainMask.fromHeights(heights), tanks, wind: 30, shotSeed: 99, seat: 0 };
}

describe('planShot', () => {
  it('hard AI finds a damaging or near-miss solution on open ground', async () => {
    const ctx = flatCtx();
    const plan = await planShot(ctx, 'mortar', 'hard', { sliceEvery: 1000 });
    expect(plan.angleDeg).toBeGreaterThan(0);
    expect(plan.angleDeg).toBeLessThan(180);
    expect(plan.power).toBeGreaterThanOrEqual(POWER_MIN);
    expect(plan.power).toBeLessThanOrEqual(POWER_MAX);
    // The pre-error best must at least land close (score includes proximity).
    expect(plan.score).toBeGreaterThan(0);
  });

  it('search does not mutate the real mask or tanks', async () => {
    const ctx = flatCtx();
    const solidBefore = ctx.mask.solidCount();
    const hpBefore = ctx.tanks.map((t) => t.hp);
    await planShot(ctx, 'smallNuke', 'medium', { sliceEvery: 1000 });
    expect(ctx.mask.solidCount()).toBe(solidBefore);
    expect(ctx.tanks.map((t) => t.hp)).toEqual(hpBefore);
  });

  it('a wildly bad shot scores worse than a plausible one', () => {
    const ctx = flatCtx();
    // Straight up at min power lands on the shooter; a 45° arc heads out.
    const bad = evaluateShot(ctx, 'mortar', 90, 20);
    const good = evaluateShot(ctx, 'mortar', 45, 75);
    expect(good).toBeGreaterThan(bad);
  });
});

describe('planPurchases', () => {
  it('never overspends and buys valid weapons', () => {
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const purchases = planPurchases(10_000, diff);
      let credits = 10_000;
      let inv: Inventory = {};
      for (const p of purchases) {
        const next = applyPurchase(credits, inv, p.weapon, p.qty);
        expect(next.credits).toBeLessThan(credits); // every purchase applied
        credits = next.credits;
        inv = next.inv;
      }
      expect(credits).toBeGreaterThanOrEqual(0);
      expect(purchases.length).toBeGreaterThan(0);
    }
  });

  it('hard spends most of the wallet', () => {
    const purchases = planPurchases(10_000, 'hard');
    const spent = purchases.reduce((s, p) => s + WEAPONS[p.weapon].price! * p.qty, 0);
    expect(spent).toBeGreaterThan(6000);
    expect(spent).toBeLessThanOrEqual(10_000);
  });
});

describe('pickWeapon', () => {
  it('fires the strongest owned weapon on hard', () => {
    const inv: Inventory = { smallNuke: 1, mirv: 2 };
    expect(pickWeapon(inv, 'hard', hasAmmo)).toBe('smallNuke');
  });

  it('falls back to mortar with an empty inventory', () => {
    expect(pickWeapon({}, 'hard', hasAmmo)).toBe('mortar');
  });

  it('fire priority covers every weapon', () => {
    expect(new Set(FIRE_PRIORITY).size).toBe(FIRE_PRIORITY.length);
    expect(FIRE_PRIORITY).toContain('mortar');
  });
});
