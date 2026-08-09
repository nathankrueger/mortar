import { TANK_H, TANK_HIT_RADIUS } from '../constants';
import {
  DIRECT_HIT_DAMAGE_CAP,
  DIRECT_HIT_MULTIPLIER,
  SPLASH_FALLOFF_EXP,
} from '../weapons';
import type { Seat, ShotContext, SimEvent, SimTank } from './types';

export interface DamageTally {
  damageToOpponent: number;
  directHits: number;
}

function tankCenterY(tank: SimTank): number {
  return tank.y - TANK_H / 2;
}

/**
 * Detonation: carve the crater, deal direct + splash damage.
 * The direct-hit tank (if any) takes the multiplied hit and skips its own
 * splash; everyone else takes distance-falloff splash. Self-damage counts.
 */
export function applyExplosion(
  ctx: ShotContext,
  events: SimEvent[],
  opts: {
    id: number;
    x: number;
    y: number;
    blastR: number;
    dmg: number;
    tier: number;
    tick: number;
    directTank: SimTank | null;
    shooterSeat: Seat;
    tally: DamageTally;
  },
): void {
  const { id, x, y, blastR, dmg, tier, tick, directTank, shooterSeat, tally } = opts;

  events.push({ t: 'explode', id, x, y, r: blastR, tier, tick });
  ctx.mask.carveCircle(x, y, blastR);
  events.push({ t: 'carve', circles: [{ x, y, r: blastR }], tick });

  for (const tank of ctx.tanks) {
    if (!tank.alive) continue;
    let amount = 0;
    let direct = false;
    if (tank === directTank) {
      amount = Math.min(DIRECT_HIT_DAMAGE_CAP, dmg * DIRECT_HIT_MULTIPLIER);
      direct = true;
    } else {
      const dx = x - tank.x;
      const dy = y - tankCenterY(tank);
      const d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - TANK_HIT_RADIUS);
      if (d < blastR) {
        amount = dmg * Math.pow(1 - d / blastR, SPLASH_FALLOFF_EXP);
      }
    }
    amount = Math.round(amount);
    if (amount < 1) continue;

    const applied = Math.min(amount, tank.hp);
    tank.hp -= applied;
    if (tank.seat !== shooterSeat) {
      tally.damageToOpponent += applied;
      if (direct) tally.directHits++;
    }
    events.push({ t: 'damage', seat: tank.seat, amount, direct, hpAfter: tank.hp, tick });
    if (tank.hp <= 0) {
      tank.alive = false;
      events.push({ t: 'die', seat: tank.seat, tick });
    }
  }
}
