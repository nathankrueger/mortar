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
/** Furthest the flight zoom-out may go (fraction of the resting scale). */
const MAX_ZOOM_OUT = 0.5;
/**
 * When the viewport can't show the full world height (phone landscape), trade
 * up to this much deep dirt for sky so shell arcs fit without camera moves.
 */
const SKY_BIAS_MAX = 200;
/** Never crop closer than this below the lowest tank (wu). */
const FLOOR_PAD = 80;

/**
 * Resting framing: fit the battlefield width, pin the ground to the bottom
 * edge (with the sky-bias trade on cropped viewports). While a shot is in
 * flight the camera never pans — it zooms out slightly, bottom still pinned,
 * just enough to keep the highest shell in frame, then eases back in.
 * Screen shake composes in as pivot offsets.
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
  private floorY = WORLD_H;
  private snapped = false;

  constructor(private readonly root: Container) {}

  setViewport(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.vw = w;
    this.vh = h;
    this.fitScale = w / WORLD_W;
    this.snapped = false; // re-snap to the new framing
  }

  /** Lowest tank y — the sky bias never crops within FLOOR_PAD of it. */
  setFloorY(y: number): void {
    this.floorY = y;
  }

  /** World x of the screen's left edge — used for parallax layers. */
  get worldLeft(): number {
    return this.cx - this.vw / this.scale / 2;
  }

  get currentScale(): number {
    return this.scale;
  }

  update(dtSec: number, interest: InterestBox | null): void {
    const restSpan = this.vh / this.fitScale;
    // Sky bias: when height is cropped anyway, prefer cropping deep dirt so
    // more of the shell arc fits (never within FLOOR_PAD of the lowest tank).
    const missing = Math.max(0, WORLD_H - restSpan);
    const bias = Math.max(
      0,
      Math.min(missing, SKY_BIAS_MAX, WORLD_H - (this.floorY + FLOOR_PAD)),
    );
    const bottomEdge = WORLD_H - bias;

    let tScale = this.fitScale;
    if (interest) {
      // Zoom out (never pan) just enough that the highest shell fits.
      const restTop = bottomEdge - restSpan;
      const neededTop = Math.min(restTop, interest.y0 - TRACK_MARGIN);
      tScale = Math.max(
        this.fitScale * MAX_ZOOM_OUT,
        Math.min(this.fitScale, this.vh / (bottomEdge - neededTop)),
      );
    }
    const span = this.vh / tScale;
    const tcx = WORLD_W / 2;
    const tcy = bottomEdge - span / 2;

    if (!this.snapped) {
      this.scale = tScale;
      this.cx = tcx;
      this.cy = tcy;
      this.snapped = true;
    } else {
      const a = 1 - Math.exp(-dtSec * SMOOTHING);
      // Zoom out fast enough to stay ahead of a rising shell; ease back
      // in gently once it's falling.
      const aScale = 1 - Math.exp(-dtSec * (tScale < this.scale ? 16 : 3));
      this.scale += (tScale - this.scale) * aScale;
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
