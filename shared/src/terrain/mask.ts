import { WORLD_H, WORLD_W } from '../constants';

export interface CarveCircle {
  x: number;
  y: number;
  r: number;
  /** true = deposit a dirt mound instead of blasting a crater (Dirt Bomb). */
  add?: boolean;
}

/**
 * Carve a blast circle into a surface-height column model with falling dirt:
 * the pixels the circle removes from a column simply drop the column's
 * surface by that amount (Scorched-Earth gravity — no floating overhangs,
 * crater lips slump inward). Mutates `surfaces`; returns the affected column
 * range, or null when nothing changed.
 */
export function carveSurfaceCircle(
  surfaces: Float64Array,
  worldH: number,
  cx: number,
  cy: number,
  r: number,
): { x0: number; x1: number } | null {
  const w = surfaces.length;
  const x0 = Math.max(0, Math.ceil(cx - r));
  const x1 = Math.min(w - 1, Math.floor(cx + r));
  if (x1 < x0) return null;
  const r2 = r * r;
  let changed = false;
  for (let x = x0; x <= x1; x++) {
    const dx = x - cx;
    const half = Math.sqrt(Math.max(0, r2 - dx * dx));
    const top = cy - half;
    const bot = Math.min(cy + half, worldH);
    const overlap = bot - Math.max(top, surfaces[x]);
    if (overlap > 0) {
      surfaces[x] = Math.min(worldH, surfaces[x] + overlap);
      changed = true;
    }
  }
  return changed ? { x0, x1 } : null;
}

/**
 * Deposit a half-disc dirt pile onto the surface. Mutates `surfaces`;
 * returns the affected column range.
 */
export function moundSurfaceCircle(
  surfaces: Float64Array,
  cx: number,
  r: number,
): { x0: number; x1: number } | null {
  const w = surfaces.length;
  const x0 = Math.max(0, Math.ceil(cx - r));
  const x1 = Math.min(w - 1, Math.floor(cx + r));
  if (x1 < x0) return null;
  const r2 = r * r;
  for (let x = x0; x <= x1; x++) {
    const dx = x - cx;
    const dome = Math.sqrt(Math.max(0, r2 - dx * dx));
    surfaces[x] = Math.max(0, surfaces[x] - dome);
  }
  return { x0, x1 };
}

/**
 * Collision terrain under falling-dirt rules: every column is a single solid
 * run from its surface down to bedrock, tracked as solid-pixel counts. This
 * is the single collision truth for the sim; the renderer mirrors the same
 * carve circles into its own surface model.
 *
 * Out-of-bounds semantics: left/right/above = air; at/below the world floor =
 * solid bedrock (tanks can never fall out of the world).
 */
export class TerrainMask {
  readonly w: number;
  readonly h: number;
  /** Solid pixels per column, bottom-aligned. */
  readonly counts: Int32Array;

  constructor(w = WORLD_W, h = WORLD_H, counts?: Int32Array) {
    this.w = w;
    this.h = h;
    this.counts = counts ?? new Int32Array(w);
  }

  static fromHeights(heights: ArrayLike<number>, w = WORLD_W, h = WORLD_H): TerrainMask {
    const mask = new TerrainMask(w, h);
    for (let x = 0; x < w; x++) {
      mask.counts[x] = Math.max(0, Math.min(h, h - Math.round(heights[x])));
    }
    return mask;
  }

  clone(): TerrainMask {
    return new TerrainMask(this.w, this.h, this.counts.slice());
  }

  /** Topmost solid y in a column (h = bare bedrock). */
  surfaceYAt(x: number): number {
    const xi = x | 0;
    if (xi < 0 || xi >= this.w) return this.h;
    return this.h - this.counts[xi];
  }

  solidAt(x: number, y: number): boolean {
    if (y >= this.h) return true; // bedrock
    if (x < 0 || x >= this.w || y < 0) return false;
    return y >= this.h - this.counts[x | 0];
  }

  /** Blast a circle out; displaced dirt above the hole falls in immediately. */
  carveCircle(cx: number, cy: number, r: number): void {
    const x0 = Math.max(0, Math.ceil(cx - r));
    const x1 = Math.min(this.w - 1, Math.floor(cx + r));
    const r2 = r * r;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const half = Math.sqrt(Math.max(0, r2 - dx * dx));
      const surface = this.h - this.counts[x];
      const overlap = Math.min(cy + half, this.h) - Math.max(cy - half, surface);
      if (overlap > 0) {
        this.counts[x] = Math.max(0, this.counts[x] - Math.round(overlap));
      }
    }
  }

  /** Pile a half-disc of dirt on top of the surface. */
  addMound(cx: number, r: number): void {
    const x0 = Math.max(0, Math.ceil(cx - r));
    const x1 = Math.min(this.w - 1, Math.floor(cx + r));
    const r2 = r * r;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dome = Math.sqrt(Math.max(0, r2 - dx * dx));
      this.counts[x] = Math.min(this.h, this.counts[x] + Math.round(dome));
    }
  }

  applyCarves(circles: readonly CarveCircle[]): void {
    for (const c of circles) {
      if (c.add) this.addMound(c.x, c.r);
      else this.carveCircle(c.x, c.y, c.r);
    }
  }

  /** First solid y at or below fromY in a column. */
  firstSolidBelow(x: number, fromY: number): number {
    return Math.min(this.h, Math.max(this.surfaceYAt(x), Math.ceil(fromY)));
  }

  /** Resting y for a tank: the highest ground under the central footprint. */
  restingY(centerX: number, halfW: number): number {
    const x0 = Math.round(centerX - halfW);
    const x1 = Math.round(centerX + halfW);
    let rest = this.h;
    for (let x = x0; x <= x1; x++) rest = Math.min(rest, this.surfaceYAt(x));
    return rest;
  }

  /**
   * March along a segment in ≤1 wu steps; return the first solid sample, or
   * null if the whole segment is air.
   */
  raycastSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { x: number; y: number } | null {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      if (this.solidAt(x, y)) return { x, y };
    }
    return null;
  }

  /** Count of solid texels — used by tests and convergence checks. */
  solidCount(): number {
    let n = 0;
    for (let i = 0; i < this.counts.length; i++) n += this.counts[i];
    return n;
  }
}
