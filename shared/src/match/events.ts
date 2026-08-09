import type { CarveCircle } from '../terrain/mask';
import type { Seat, SimEvent } from '../sim/types';

export interface ShotSummary {
  /** HP per seat after the shot (adopting the event log's hpAfter values). */
  hp: [number, number];
  alive: [boolean, boolean];
  /** Damage the shooter actually landed on the opponent (capped by HP). */
  damageToOpponent: number;
  directHits: number;
  carves: CarveCircle[];
  /** Final resting y per seat when a fall occurred (x never changes). */
  fallY: [number | null, number | null];
}

/**
 * Replays a shot's event log for bookkeeping — the server uses this to track
 * authoritative HP/credits without simulating physics, and clients use it to
 * sync tank state after playing back a remote shot.
 */
export function summarizeShotEvents(
  events: SimEvent[],
  shooterSeat: Seat,
  startHp: [number, number],
): ShotSummary {
  const hp: [number, number] = [startHp[0], startHp[1]];
  const alive: [boolean, boolean] = [startHp[0] > 0, startHp[1] > 0];
  const fallY: [number | null, number | null] = [null, null];
  const carves: CarveCircle[] = [];
  let damageToOpponent = 0;
  let directHits = 0;

  for (const e of events) {
    switch (e.t) {
      case 'damage': {
        const applied = Math.max(0, hp[e.seat] - e.hpAfter);
        hp[e.seat] = Math.max(0, e.hpAfter);
        if (e.seat !== shooterSeat) {
          damageToOpponent += applied;
          if (e.direct) directHits++;
        }
        break;
      }
      case 'fall': {
        hp[e.seat] = Math.max(0, e.hpAfter);
        fallY[e.seat] = e.toY;
        break;
      }
      case 'die':
        alive[e.seat] = false;
        hp[e.seat] = 0;
        break;
      case 'carve':
        carves.push(...e.circles);
        break;
    }
  }
  return { hp, alive, damageToOpponent, directHits, carves, fallY };
}
