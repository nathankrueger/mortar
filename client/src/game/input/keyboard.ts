export interface KeyboardCallbacks {
  onFire: () => void;
  onEscape: () => void;
}

const AIM_BASE = 30; // deg/s
const POWER_BASE = 26; // power/s
const ACCEL_RAMP = 1.6; // multiplier growth per held second
const ACCEL_MAX = 3;

/**
 * Arrow keys: ←/→ swing the barrel (CCW/CW), ↑/↓ adjust power, with
 * hold-to-accelerate. Space fires, Escape opens the menu.
 */
export class KeyboardInput {
  private held = new Set<string>();
  private holdTime = 0;

  constructor(private readonly cbs: KeyboardCallbacks) {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    switch (e.code) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        this.held.add(e.code);
        e.preventDefault();
        break;
      case 'Space':
        this.cbs.onFire();
        e.preventDefault();
        break;
      case 'Escape':
        this.cbs.onEscape();
        break;
    }
  };

  private onUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private onBlur = (): void => {
    this.held.clear();
  };

  /** Poll aim deltas for this frame. */
  poll(dtSec: number): { dAngle: number; dPower: number } {
    const aiming =
      this.held.has('ArrowLeft') ||
      this.held.has('ArrowRight') ||
      this.held.has('ArrowUp') ||
      this.held.has('ArrowDown');
    this.holdTime = aiming ? this.holdTime + dtSec : 0;
    const accel = Math.min(ACCEL_MAX, 1 + this.holdTime * ACCEL_RAMP);

    let dAngle = 0;
    let dPower = 0;
    if (this.held.has('ArrowLeft')) dAngle += AIM_BASE * accel * dtSec;
    if (this.held.has('ArrowRight')) dAngle -= AIM_BASE * accel * dtSec;
    if (this.held.has('ArrowUp')) dPower += POWER_BASE * accel * dtSec;
    if (this.held.has('ArrowDown')) dPower -= POWER_BASE * accel * dtSec;
    return { dAngle, dPower };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
