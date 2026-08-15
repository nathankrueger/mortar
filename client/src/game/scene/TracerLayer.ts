import { Container, Graphics } from 'pixi.js';

/** Points retained at full strength — the tracer's longest possible tail. */
const MAX_POINTS = 130;
/** Alpha/width bands along the tail; more bands = smoother taper, more draws. */
const BANDS = 5;
/** Seconds the tail lingers after its shell is gone. */
const FADE_SEC = 0.45;
/** Minimum world-unit travel before a new point is recorded. */
const MIN_STEP = 1.5;

interface Trail {
  g: Graphics;
  pts: { x: number; y: number }[];
  hot: boolean;
  /** Countdown once the shell is gone; null while it is still flying. */
  fading: number | null;
}

/**
 * Thin tracer streaks behind shells in flight: a polyline of recent positions
 * drawn in alpha/width bands so the tail fades out behind the shell, then
 * lingers briefly after impact. Strength (0..1) scales the tail length;
 * 0 disables tracers entirely and nothing is allocated.
 */
export class TracerLayer {
  readonly container = new Container();
  private trails = new Map<number, Trail>();
  private strength = 0;

  /** 0 = off, 1 = longest tail. */
  setStrength(v: number): void {
    const next = Math.min(1, Math.max(0, v));
    this.strength = next;
    if (next === 0) this.clear();
  }

  get enabled(): boolean {
    return this.strength > 0;
  }

  private get maxPoints(): number {
    return Math.max(8, Math.round(MAX_POINTS * this.strength));
  }

  spawn(id: number, x: number, y: number, hot: boolean): void {
    if (!this.enabled) return;
    const g = new Graphics();
    this.container.addChild(g);
    this.trails.set(id, { g, pts: [{ x, y }], hot, fading: null });
  }

  push(id: number, x: number, y: number): void {
    const t = this.trails.get(id);
    if (!t || t.fading !== null) return;
    const last = t.pts[t.pts.length - 1];
    if (last && Math.abs(last.x - x) < MIN_STEP && Math.abs(last.y - y) < MIN_STEP) return;
    t.pts.push({ x, y });
    const cap = this.maxPoints;
    if (t.pts.length > cap) t.pts.splice(0, t.pts.length - cap);
    this.redraw(t);
  }

  /** The shell is gone — let its streak fade out instead of vanishing. */
  release(id: number): void {
    const t = this.trails.get(id);
    if (t && t.fading === null) t.fading = FADE_SEC;
  }

  update(dtSec: number): void {
    for (const [id, t] of this.trails) {
      if (t.fading === null) continue;
      t.fading -= dtSec;
      if (t.fading <= 0) {
        t.g.destroy();
        this.trails.delete(id);
      } else {
        t.g.alpha = t.fading / FADE_SEC;
      }
    }
  }

  private redraw(t: Trail): void {
    const { g, pts } = t;
    g.clear();
    const n = pts.length;
    if (n < 2) return;
    const color = t.hot ? 0xffc46b : 0xe6edf7;
    // Bands share an endpoint with their neighbour so the line stays unbroken.
    const per = Math.ceil((n - 1) / BANDS);
    for (let b = 0; b < BANDS; b++) {
      const start = b * per;
      const end = Math.min(n - 1, start + per);
      if (end <= start) break;
      g.moveTo(pts[start].x, pts[start].y);
      for (let i = start + 1; i <= end; i++) g.lineTo(pts[i].x, pts[i].y);
      const f = (b + 1) / BANDS; // 1 = newest end of the tail
      g.stroke({
        width: 0.7 + f * 1.5,
        color,
        alpha: (0.1 + f * 0.5) * (t.hot ? 1 : 0.85),
        cap: 'round',
        join: 'round',
      });
    }
  }

  clear(): void {
    for (const t of this.trails.values()) t.g.destroy();
    this.trails.clear();
  }
}
