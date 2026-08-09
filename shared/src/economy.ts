import { WEAPONS, type WeaponId } from './weapons';

// Credits: earned by hurting your opponent, spent in the shop.
export const CREDITS_PER_HP = 18;
export const DIRECT_HIT_BONUS = 150;

export type Inventory = Partial<Record<WeaponId, number>>;

export function shotEarnings(damageToOpponent: number, directHits: number): number {
  return damageToOpponent * CREDITS_PER_HP + directHits * DIRECT_HIT_BONUS;
}

export interface PurchaseCheck {
  ok: boolean;
  cost: number;
  reason?: 'free-weapon' | 'bad-qty' | 'insufficient-funds';
}

export function checkPurchase(credits: number, weapon: WeaponId, qty: number): PurchaseCheck {
  const price = WEAPONS[weapon].price;
  if (price === null) return { ok: false, cost: 0, reason: 'free-weapon' };
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { ok: false, cost: 0, reason: 'bad-qty' };
  const cost = price * qty;
  if (cost > credits) return { ok: false, cost, reason: 'insufficient-funds' };
  return { ok: true, cost };
}

/** Pure purchase application; call only after checkPurchase().ok. */
export function applyPurchase(
  credits: number,
  inv: Inventory,
  weapon: WeaponId,
  qty: number,
): { credits: number; inv: Inventory } {
  const { ok, cost } = checkPurchase(credits, weapon, qty);
  if (!ok) return { credits, inv };
  return {
    credits: credits - cost,
    inv: { ...inv, [weapon]: (inv[weapon] ?? 0) + qty },
  };
}

/** The basic Mortar never runs out. */
export function hasAmmo(inv: Inventory, weapon: WeaponId): boolean {
  if (WEAPONS[weapon].price === null) return true;
  return (inv[weapon] ?? 0) > 0;
}

export function consumeAmmo(inv: Inventory, weapon: WeaponId): Inventory {
  if (WEAPONS[weapon].price === null) return inv;
  const left = Math.max(0, (inv[weapon] ?? 0) - 1);
  return { ...inv, [weapon]: left };
}
