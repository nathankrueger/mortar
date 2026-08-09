import { checkPurchase, type Inventory } from '../economy';
import type { WeaponId } from '../weapons';
import { AI_PROFILES, type AiDifficulty } from './difficulty';

// Purchase priority, strongest first. The AI walks the list greedily until
// its budget fraction is spent.
const HARD_PRIORITY: WeaponId[] = [
  'megaMnw',
  'largeNuke',
  'medNuke',
  'mnw',
  'airstrike',
  'smallNuke',
  'digger',
  'mirvBounce',
  'multiMirv',
  'mirv',
  'bounceBomb',
  'roller',
  'largeMortar',
];
const EASY_PRIORITY: WeaponId[] = [
  'bounceBomb',
  'roller',
  'largeMortar',
  'sniper',
  'mirv',
  'smallNuke',
];

/** Turn-order weapon preference (fire the best thing you own). Never the
 * Dirt Bomb — the AI has no notion of building defenses yet. */
export const FIRE_PRIORITY: WeaponId[] = [
  'megaMnw',
  'bigOne',
  'largeNuke',
  'medNuke',
  'mnw',
  'airstrike',
  'digger',
  'smallNuke',
  'mirvBounce',
  'multiMirv',
  'mirv',
  'bounceBomb',
  'roller',
  'largeMortar',
  'sniper',
  'mortar',
];

export function planPurchases(
  credits: number,
  difficulty: AiDifficulty,
): { weapon: WeaponId; qty: number }[] {
  const profile = AI_PROFILES[difficulty];
  const budget = Math.floor(credits * profile.shopBudgetFrac);
  const list = difficulty === 'easy' ? EASY_PRIORITY : HARD_PRIORITY;
  const purchases: { weapon: WeaponId; qty: number }[] = [];
  let spent = 0;

  for (let pass = 0; pass < 4; pass++) {
    for (const weapon of list) {
      const check = checkPurchase(budget - spent, weapon, 1);
      if (!check.ok) continue;
      purchases.push({ weapon, qty: 1 });
      spent += check.cost;
    }
    if (spent >= budget * 0.85) break;
  }
  return purchases;
}

/** Best owned weapon by fire priority; respects the profile's mortar bias. */
export function pickWeapon(
  inv: Inventory,
  difficulty: AiDifficulty,
  hasAmmoFn: (inv: Inventory, w: WeaponId) => boolean,
): WeaponId {
  if (Math.random() < AI_PROFILES[difficulty].mortarBias) return 'mortar';
  for (const w of FIRE_PRIORITY) {
    if (hasAmmoFn(inv, w)) return w;
  }
  return 'mortar';
}
