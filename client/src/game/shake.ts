import type { Camera } from './camera';

const MAX_OFFSET = 28; // px
const MAX_ROT = 0.006; // rad
const DECAY = 1.4; // trauma per second

/** Trauma-based screen shake: intensity = trauma², sampled layered sines. */
export class ScreenShake {
  private trauma = 0;
  private t = Math.random() * 100;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dtSec: number, camera: Camera): void {
    this.t += dtSec;
    this.trauma = Math.max(0, this.trauma - DECAY * dtSec);
    const m = this.trauma * this.trauma;
    if (m < 0.0001) {
      camera.shakeX = 0;
      camera.shakeY = 0;
      camera.shakeRot = 0;
      return;
    }
    const { t } = this;
    camera.shakeX = MAX_OFFSET * m * (Math.sin(t * 127.1) * 0.6 + Math.sin(t * 311.7 + 1.3) * 0.4);
    camera.shakeY = MAX_OFFSET * m * (Math.sin(t * 139.4 + 2.1) * 0.6 + Math.sin(t * 283.1 + 0.7) * 0.4);
    camera.shakeRot = MAX_ROT * m * Math.sin(t * 97.3);
  }
}
