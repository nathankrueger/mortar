import { FALL_DAMAGE_CAP, FALL_DAMAGE_FREE_WU, FALL_DAMAGE_PER_WU } from '../weapons';
import type { ShotContext, SimEvent } from './types';

/** Half-width of the footprint band a tank actually rests on. */
const REST_HALF_W = 10;

/**
 * After terrain changes, settle every tank onto the new surface.
 * Ground blown away → the tank falls and takes distance-scaled damage.
 * Dirt piled on top (fallen crater lips, dirt bombs) → the tank is pushed
 * up to sit on the new surface, damage-free.
 */
export function settleTanks(ctx: ShotContext, events: SimEvent[], tick: number): void {
  for (const tank of ctx.tanks) {
    const rest = ctx.mask.restingY(tank.x, REST_HALF_W);
    const delta = rest - tank.y;
    if (Math.abs(delta) < 1) continue;

    const fromY = tank.y;
    tank.y = rest;
    let dmg = 0;
    if (delta > 0 && tank.alive) {
      // Falling down hurts; riding rising dirt up does not.
      dmg = Math.round(
        Math.min(FALL_DAMAGE_CAP, FALL_DAMAGE_PER_WU * Math.max(0, delta - FALL_DAMAGE_FREE_WU)),
      );
      const applied = Math.min(dmg, tank.hp);
      tank.hp -= applied;
    }
    events.push({
      t: 'fall',
      seat: tank.seat,
      x: tank.x,
      fromY,
      toY: rest,
      dmg,
      hpAfter: tank.hp,
      tick,
    });
    if (tank.alive && tank.hp <= 0) {
      tank.alive = false;
      events.push({ t: 'die', seat: tank.seat, tick });
    }
  }
}
