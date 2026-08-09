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
 * While following a shot on a phone, frame about this much world height so
 * the shell is readable. Never used while aiming.
 */
const FOLLOW_VIEW_HEIGHT_WU = 700;
const FOLLOW_MAX_SCALE = 1.2;

/**
 * At rest (aiming included): fit-width overview on every device — the whole
 * battlefield and both tanks visible, floor pinned to the bottom edge, sky
 * absorbing any extra height. You can always see what you're aiming at.
 *
 * Only while an interest box is provided (phones, during shot playback) does
 * the camera zoom toward the action and pan with it, easing back to the
 * overview afterwards. Screen shake composes in as pivot offsets.
 */
export class Camera {
  shakeX = 0;
  shakeY = 0;
  shakeRot = 0;

  private vw = 1;
  private vh = 1;
  private fitScale = 1;
  private followScale = 1;
  private scale = 1;
  private cx = WORLD_W / 2;
  private cy = WORLD_H / 2;
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
    this.followScale = this.coarse
      ? Math.min(Math.max(this.fitScale, h / FOLLOW_VIEW_HEIGHT_WU), FOLLOW_MAX_SCALE)
      : this.fitScale;
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
    let tScale: number;
    let tcx: number;
    let tcy: number;

    if (interest) {
      // Shot in flight: zoom to the follow framing and pan with the shells.
      tScale = this.followScale;
      const span = this.vh / tScale;
      const halfW = this.vw / tScale / 2;
      const bottomCy = WORLD_H - span / 2;
      const cx = (interest.x0 + interest.x1) / 2;
      tcx =
        halfW * 2 >= WORLD_W
          ? WORLD_W / 2
          : Math.min(Math.max(cx, halfW), WORLD_W - halfW);
      tcy = Math.min(bottomCy, (interest.y0 + interest.y1) / 2);
    } else {
      // Overview: everything visible, floor pinned to the screen bottom.
      tScale = this.fitScale;
      tcx = WORLD_W / 2;
      tcy = WORLD_H - this.vh / tScale / 2;
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
