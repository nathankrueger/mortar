import type { Seat } from '@mortar/shared';
import { Container, Graphics } from 'pixi.js';

const DEG2RAD = Math.PI / 180;
const SEAT_COLORS: [number, number] = [0x4f9cf9, 0xff7a59];
const SEAT_DEEP: [number, number] = [0x2f6fd4, 0xd94f2f];

/**
 * Minimal rounded-geometry tank: body + dome + pivoting barrel.
 * The container's position is the ground-contact point (bottom center).
 */
export class TankView {
  readonly container = new Container();
  private readonly barrel = new Graphics();
  private readonly body = new Graphics();
  private dead = false;
  private fallTween: { from: number; to: number; t: number; dur: number } | null = null;

  constructor(readonly seat: Seat) {
    const color = SEAT_COLORS[seat];
    const deep = SEAT_DEEP[seat];

    this.barrel
      .roundRect(0, -3, 27, 6, 3)
      .fill({ color: deep })
      .circle(0, 0, 5)
      .fill({ color: deep });
    this.barrel.position.set(0, -17);

    this.body
      // treads
      .roundRect(-22, -9, 44, 9, 4.5)
      .fill({ color: 0x1c2431, alpha: 0.9 })
      // hull
      .roundRect(-20, -16, 40, 10, 5)
      .fill({ color })
      // dome
      .circle(0, -17, 8.5)
      .fill({ color });

    this.container.addChild(this.barrel, this.body);
    this.setAim(seat === 0 ? 60 : 120);
  }

  setPosition(x: number, y: number): void {
    this.container.position.set(x, y);
  }

  setAim(angleDeg: number): void {
    if (this.dead) return;
    this.barrel.rotation = -angleDeg * DEG2RAD;
  }

  /** Animate a fall from the sim's fall event. */
  startFall(fromY: number, toY: number): void {
    const dist = toY - fromY;
    this.fallTween = { from: fromY, to: toY, t: 0, dur: Math.min(0.7, 0.18 + dist / 500) };
  }

  update(dtSec: number): void {
    if (this.fallTween) {
      const tw = this.fallTween;
      tw.t += dtSec;
      const f = Math.min(1, tw.t / tw.dur);
      this.container.y = tw.from + (tw.to - tw.from) * f * f; // ease-in (gravity)
      if (f >= 1) this.fallTween = null;
    }
  }

  setDead(): void {
    if (this.dead) return;
    this.dead = true;
    this.barrel.rotation = 0.35;
    this.body.tint = 0x555555;
    this.barrel.tint = 0x555555;
    this.container.alpha = 0.85;
  }

  get isFalling(): boolean {
    return this.fallTween !== null;
  }
}
