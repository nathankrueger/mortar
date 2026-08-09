import type { Seat, WeaponId } from '@mortar/shared';

/**
 * The single command surface the UI talks to. LocalSession (hotseat / vs AI)
 * and NetworkSession implement it and feed the identical event stream to the
 * renderer, so networking is a transport swap rather than a rewrite.
 */
export interface GameSession {
  start(): void;
  /** Relative aim adjustment for the seat this client controls right now. */
  aimBy(dAngle: number, dPower: number): void;
  setAim(angleDeg: number, power: number): void;
  selectWeapon(id: WeaponId): void;
  fire(): void;
  dispose(): void;
  /** Which seat the local player controls this turn (hotseat: the turn seat). */
  readonly localSeat: Seat;
}
