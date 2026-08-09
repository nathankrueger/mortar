import { describe, expect, it } from 'vitest';
import {
  applyPurchase,
  checkPurchase,
  consumeAmmo,
  CREDITS_PER_HP,
  DIRECT_HIT_BONUS,
  hasAmmo,
  shotEarnings,
  type Inventory,
} from './economy';
import { WEAPONS } from './weapons';

describe('shotEarnings', () => {
  it('pays per HP plus direct-hit bonuses', () => {
    expect(shotEarnings(0, 0)).toBe(0);
    expect(shotEarnings(44, 1)).toBe(44 * CREDITS_PER_HP + DIRECT_HIT_BONUS);
    expect(shotEarnings(30, 0)).toBe(30 * 36);
  });
});

describe('checkPurchase / applyPurchase', () => {
  it('rejects buying the free mortar', () => {
    expect(checkPurchase(99999, 'mortar', 1).reason).toBe('free-weapon');
  });

  it('rejects bad quantities', () => {
    expect(checkPurchase(99999, 'mirv', 0).reason).toBe('bad-qty');
    expect(checkPurchase(99999, 'mirv', 1.5).reason).toBe('bad-qty');
    expect(checkPurchase(99999, 'mirv', -3).reason).toBe('bad-qty');
  });

  it('rejects purchases beyond the wallet', () => {
    const price = WEAPONS.bigOne.price!;
    expect(checkPurchase(price - 1, 'bigOne', 1).reason).toBe('insufficient-funds');
    expect(checkPurchase(price, 'bigOne', 1).ok).toBe(true);
  });

  it('applies cost and stacks inventory', () => {
    let credits = 10_000;
    let inv: Inventory = {};
    ({ credits, inv } = applyPurchase(credits, inv, 'bounceBomb', 2));
    ({ credits, inv } = applyPurchase(credits, inv, 'bounceBomb', 1));
    ({ credits, inv } = applyPurchase(credits, inv, 'smallNuke', 1));
    expect(inv.bounceBomb).toBe(3);
    expect(inv.smallNuke).toBe(1);
    expect(credits).toBe(10_000 - 3 * WEAPONS.bounceBomb.price! - WEAPONS.smallNuke.price!);
  });

  it('never lets credits go negative on a failed purchase', () => {
    const start = 100;
    const { credits, inv } = applyPurchase(start, {}, 'largeNuke', 1);
    expect(credits).toBe(start);
    expect(inv.largeNuke).toBeUndefined();
  });
});

describe('ammo', () => {
  it('mortar is always available and never consumed', () => {
    expect(hasAmmo({}, 'mortar')).toBe(true);
    expect(consumeAmmo({}, 'mortar')).toEqual({});
  });

  it('consumes purchased shells down to zero, never below', () => {
    let inv: Inventory = { mirv: 2 };
    inv = consumeAmmo(inv, 'mirv');
    expect(inv.mirv).toBe(1);
    expect(hasAmmo(inv, 'mirv')).toBe(true);
    inv = consumeAmmo(inv, 'mirv');
    expect(inv.mirv).toBe(0);
    expect(hasAmmo(inv, 'mirv')).toBe(false);
    inv = consumeAmmo(inv, 'mirv');
    expect(inv.mirv).toBe(0);
  });
});
