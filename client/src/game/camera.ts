import { WORLD_H, WORLD_W } from '@mortar/shared';
import type { Container } from 'pixi.js';

export interface InterestBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const SMOOTHING = 5.5; // spring-ish exponential smoothing rate
/** Keep tracked shells at least this far below the top edge (wu). */
const TRACK_MARGIN = 90;

/**
 * One framing, no zoom, ever: fit the battlefield width, pin the floor to the
 * bottom edge, let the sky absorb extra height. While a shot is in flight the
 * camera pans straight up just enough to keep the highest shell in frame,
 * then eases back down. Screen shake composes in as pivot offsets.
 */
export class Camera {
  shakeX = 0;
  shakeY = 0;
  shakeRot = 0;

  private vw = 1;
  private vh = 1;
  private fitScale = 1;
  private scale = 1;
  private cx = WORLD_W / 2;
  private cy = WORLD_H / 2;
  private snapped = false;

  constructor(private readonly root: Container) {}

  setViewport(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.vw = w;
    this.vh = h;
    this.fitScale = w / WORLD_W;
    this.snapped = false; // re-snap to the new framing
  }

  /** World x of the screen's left edge — used for parallax layers. */
  get worldLeft(): number {
    return this.cx - this.vw / this.scale / 2;
  }

  get currentScale(): number {
    return this.scale;
  }

  update(dtSec: number, interest: InterestBox | null): void {
    const tScale = this.fitScale;
    const span = this.vh / tScale;
    const bottomCy = WORLD_H - span / 2;
    const tcx = WORLD_W / 2;
    // Pan up only as far as needed to keep the highest shell in frame.
    const tcy = interest
      ? Math.min(bottomCy, interest.y0 + span / 2 - TRACK_MARGIN)
      : bottomCy;

    if (!this.snapped) {
      this.scale = tScale;
      this.cx = tcx;
      this.cy = tcy;
      this.snapped = true;
    } else {
      const a = 1 - Math.exp(-dtSec * SMOOTHING);
      this.scale += (tScale - this.scale) * a;
      this.cx += (tcx - this.cx) * a;
      this.cy += (tcy - this.cy) * a;
    }

    this.root.pivot.set(this.cx, this.cy);
    this.root.position.set(this.vw / 2 + this.shakeX, this.vh / 2 + this.shakeY);
    this.root.scale.set(this.scale);
    this.root.rotation = this.shakeRot;
  }

  /** Screen → world for pointer input. */
  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.cx + (sx - this.vw / 2) / this.scale,
      y: this.cy + (sy - this.vh / 2) / this.scale,
    };
  }
}
