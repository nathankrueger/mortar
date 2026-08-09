import { WORLD_H, WORLD_W } from '@mortar/shared';
import type { Container } from 'pixi.js';

export interface InterestBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const FOLLOW_PAD = 120; // wu of breathing room around the interest box
const MAX_ZOOM_FACTOR = 1.35;
const SMOOTHING = 5.5; // spring-ish exponential smoothing rate

/**
 * Fit-width camera: at rest the whole battlefield width is visible and the
 * world floor hugs the bottom of the screen (sky simply extends upward, so no
 * aspect ratio ever letterboxes). During flight an interest box pulls a gentle
 * follow/zoom; screen shake composes in as pivot offsets.
 */
export class Camera {
  shakeX = 0;
  shakeY = 0;
  shakeRot = 0;

  private vw = 1;
  private vh = 1;
  private baseScale = 1;
  private scale = 1;
  private cx = WORLD_W / 2;
  private cy = WORLD_H / 2;
  private snapped = false;

  constructor(private readonly root: Container) {}

  setViewport(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.vw = w;
    this.vh = h;
    this.baseScale = w / WORLD_W;
    this.snapped = false; // re-snap to the new overview framing
  }

  /** World x of the screen's left edge — used for parallax layers. */
  get worldLeft(): number {
    return this.cx - this.vw / this.scale / 2;
  }

  get currentScale(): number {
    return this.scale;
  }

  update(dtSec: number, interest: InterestBox | null): void {
    // Overview framing: full width, floor anchored to the screen bottom.
    let tScale = this.baseScale;
    let tcx = WORLD_W / 2;
    let tcy = WORLD_H - this.vh / this.baseScale / 2;

    if (interest) {
      const bw = interest.x1 - interest.x0 + FOLLOW_PAD * 2;
      const bh = interest.y1 - interest.y0 + FOLLOW_PAD * 2;
      const fit = Math.min(this.vw / bw, this.vh / bh);
      tScale = Math.min(Math.max(fit, this.baseScale), this.baseScale * MAX_ZOOM_FACTOR);
      const halfW = this.vw / tScale / 2;
      const halfH = this.vh / tScale / 2;
      tcx = Math.min(Math.max((interest.x0 + interest.x1) / 2, halfW), WORLD_W - halfW);
      // Never show below the floor; above the sky is always fine.
      tcy = Math.min((interest.y0 + interest.y1) / 2, WORLD_H - halfH + 30);
    }

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
