import { WORLD_H, WORLD_W } from '@mortar/shared';
import type { Container } from 'pixi.js';

export interface InterestBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const SMOOTHING = 5.5; // spring-ish exponential smoothing rate

/**
 * How much world height a coarse-pointer (phone) screen should show. Phones
 * zoom in to keep tanks readable and the camera follows the action; wide
 * pointer screens fit the whole battlefield width instead.
 */
const MOBILE_VIEW_HEIGHT_WU = 700;
const MOBILE_MAX_SCALE = 1.2;

/**
 * Desktop: fit-width overview — whole battlefield visible, floor pinned to
 * the bottom edge, sky extends upward so no aspect ratio letterboxes.
 * Phone: zoomed to a readable slice, centered on the focus tank while
 * aiming and panning along the interest box (projectiles) during shots.
 * Screen shake composes in as pivot offsets.
 */
export class Camera {
  shakeX = 0;
  shakeY = 0;
  shakeRot = 0;

  private vw = 1;
  private vh = 1;
  private fitScale = 1;
  private baseScale = 1;
  private scale = 1;
  private cx = WORLD_W / 2;
  private cy = WORLD_H / 2;
  private focusX = WORLD_W / 2;
  private focusY = WORLD_H * 0.6;
  private snapped = false;

  constructor(
    private readonly root: Container,
    private readonly coarse = false,
  ) {}

  setViewport(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.vw = w;
    this.vh = h;
    this.fitScale = w / WORLD_W;
    this.baseScale = this.coarse
      ? Math.min(Math.max(this.fitScale, h / MOBILE_VIEW_HEIGHT_WU), MOBILE_MAX_SCALE)
      : this.fitScale;
    this.snapped = false; // re-snap to the new framing
  }

  /** Point of interest at rest — the tank whose turn it is. */
  setFocus(x: number, y: number): void {
    this.focusX = x;
    this.focusY = y;
  }

  /** Is the phone zoom active (view narrower than the world)? */
  get zoomedIn(): boolean {
    return this.baseScale > this.fitScale + 1e-6;
  }

  /** World x of the screen's left edge — used for parallax layers. */
  get worldLeft(): number {
    return this.cx - this.vw / this.scale / 2;
  }

  get currentScale(): number {
    return this.scale;
  }

  update(dtSec: number, interest: InterestBox | null): void {
    const span = this.vh / this.baseScale;
    const halfW = this.vw / this.baseScale / 2;
    const bottomCy = WORLD_H - span / 2;
    const clampX = (x: number) =>
      halfW * 2 >= WORLD_W ? WORLD_W / 2 : Math.min(Math.max(x, halfW), WORLD_W - halfW);

    const tScale = this.baseScale;
    let tcx: number;
    let tcy: number;
    if (interest) {
      // Pan (never zoom) to keep the action centered.
      tcx = clampX((interest.x0 + interest.x1) / 2);
      tcy = Math.min(bottomCy, (interest.y0 + interest.y1) / 2);
    } else if (this.zoomedIn) {
      // At-rest phone framing: focus tank about 65% down the screen.
      tcx = clampX(this.focusX);
      tcy = Math.min(bottomCy, this.focusY - span * 0.15);
    } else {
      tcx = WORLD_W / 2;
      tcy = bottomCy;
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
