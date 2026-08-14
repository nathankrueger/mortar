import { WORLD_H, WORLD_W } from '../constants';

export interface CarveCircle {
  x: number;
  y: number;
  r: number;
  /** true = deposit a dirt mound instead of blasting a crater (Dirt Bomb). */
  add?: boolean;
}

/**
 * Cosmetic hills past both world edges. Index 0 hugs the edge, increasing
 * outward. Terrain there is indestructible: shells collide with it (so
 * near-edge shots explode instead of tunneling behind scenery) but carves
 * never touch it.
 */
export interface ApronSurfaces {
  left: ArrayLike<number>;
  right: ArrayLike<number>;
}

/** Surface y just outside each world edge (null = open edge, no apron). */
export interface EdgeSurfaces {
  left: number | null;
  right: number | null;
}

/** How far a slide may spread past a blast, and how hard we chase settling. */
const RELAX_MAX_PASSES = 60;

/**
 * Deterministic per-boundary repose step (px of height difference tolerated
 * between neighbor columns). Jittered by column so settled slopes come out
 * ragged instead of machine-straight. Integer ops only — must be identical
 * on every JS engine.
 */
function reposeStep(x: number): number {
  let z = Math.imul(x + 0x9e37, 0x85ebca6b);
  z ^= z >>> 13;
  z = Math.imul(z, 0xc2b2ae35);
  z ^= z >>> 16;
  return 3 + ((z >>> 0) % 6); // 3..8
}

/**
 * Angle-of-repose settling: wherever neighbor columns differ by more than the
 * (jittered) repose step, dirt slides from the taller into the shorter until
 * the range is stable — fresh crater walls slump into ragged scree instead of
 * standing as 90° slots. Columns just outside the world act as fixed-height
 * walls when an apron exists: dirt can slide in from them (or vanish past
 * them) but they never change. Mutates `surfaces`; returns the settled range.
 */
export function relaxSurfaceRange(
  surfaces: Float64Array,
  worldH: number,
  cx0: number,
  cx1: number,
  r: number,
  edges?: EdgeSurfaces,
): { x0: number; x1: number } {
  const w = surfaces.length;
  const margin = Math.min(240, Math.ceil(r) + 24);
  const x0 = Math.max(0, cx0 - margin);
  const x1 = Math.min(w - 1, cx1 + margin);
  const leftEdge = edges?.left ?? null;
  const rightEdge = edges?.right ?? null;

  const at = (x: number): number => {
    if (x < 0) return leftEdge ?? surfaces[0];
    if (x >= w) return rightEdge ?? surfaces[w - 1];
    return surfaces[x];
  };
  // Slide between columns x and x+1; virtual out-of-world columns are fixed.
  const settle = (x: number): boolean => {
    if ((x < 0 && leftEdge === null) || (x + 1 >= w && rightEdge === null)) return false;
    const a = at(x);
    const b = at(x + 1);
    const m = reposeStep(x);
    const diff = a - b; // y-down: positive = column x sits lower than x+1
    if (diff <= m && diff >= -m) return false;
    const t = (Math.abs(diff) - m) / 2;
    if (diff > m) {
      if (x >= 0 && x < w) surfaces[x] = a - t;
      if (x + 1 < w) surfaces[x + 1] = b + t;
    } else {
      if (x >= 0 && x < w) surfaces[x] = a + t;
      if (x + 1 < w) surfaces[x + 1] = b - t;
    }
    return true;
  };

  for (let pass = 0; pass < RELAX_MAX_PASSES; pass++) {
    let moved = false;
    for (let x = x0 - 1; x <= x1; x++) if (settle(x)) moved = true;
    for (let x = x1; x >= x0 - 1; x--) if (settle(x)) moved = true;
    if (!moved) break;
  }
  for (let x = x0; x <= x1; x++) {
    surfaces[x] = Math.min(worldH, Math.max(0, surfaces[x]));
  }
  return { x0, x1 };
}

/**
 * Carve a blast circle into a surface-height column model with falling dirt:
 * the pixels the circle removes from a column simply drop the column's
 * surface by that amount (Scorched-Earth gravity — no floating overhangs),
 * then the crater walls settle to a ragged angle of repose. Mutates
 * `surfaces`; returns the affected column range, or null when nothing
 * changed.
 */
export function carveSurfaceCircle(
  surfaces: Float64Array,
  worldH: number,
  cx: number,
  cy: number,
  r: number,
  edges?: EdgeSurfaces,
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
  if (!changed) return null;
  return relaxSurfaceRange(surfaces, worldH, x0, x1, r, edges);
}

/**
 * Deposit a half-disc dirt pile onto the surface, then let its flanks settle.
 * Mutates `surfaces`; returns the affected column range.
 */
export function moundSurfaceCircle(
  surfaces: Float64Array,
  worldH: number,
  cx: number,
  r: number,
  edges?: EdgeSurfaces,
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
  return relaxSurfaceRange(surfaces, worldH, x0, x1, r, edges);
}

/**
 * Collision terrain under falling-dirt rules: every column is a single solid
 * run from its surface down to bedrock, tracked as solid-pixel counts. This
 * is the single collision truth for the sim; the renderer mirrors the same
 * carve circles into its own surface model.
 *
 * Out-of-bounds semantics: within the aprons = indestructible cosmetic hills
 * (solid below their surface, so near-edge shots explode on scenery instead
 * of tunneling behind it); past the aprons left/right/above = air; at/below
 * the world floor = solid bedrock (tanks can never fall out of the world).
 */
export class TerrainMask {
  readonly w: number;
  readonly h: number;
  /** Solid pixels per column, bottom-aligned. */
  readonly counts: Int32Array;
  private readonly aprons: ApronSurfaces | null;

  constructor(w = WORLD_W, h = WORLD_H, counts?: Int32Array, aprons: ApronSurfaces | null = null) {
    this.w = w;
    this.h = h;
    this.counts = counts ?? new Int32Array(w);
    this.aprons = aprons;
  }

  static fromHeights(
    heights: ArrayLike<number>,
    w = heights.length,
    h = WORLD_H,
    aprons: ApronSurfaces | null = null,
  ): TerrainMask {
    const mask = new TerrainMask(w, h, undefined, aprons);
    for (let x = 0; x < w; x++) {
      mask.counts[x] = Math.max(0, Math.min(h, h - Math.round(heights[x])));
    }
    return mask;
  }

  clone(): TerrainMask {
    return new TerrainMask(this.w, this.h, this.counts.slice(), this.aprons);
  }

  /** Apron surface y for an out-of-world column, or null past the aprons. */
  private apronSurfaceAt(xi: number): number | null {
    if (!this.aprons) return null;
    const arr = xi < 0 ? this.aprons.left : this.aprons.right;
    const idx = xi < 0 ? -1 - xi : xi - this.w;
    if (idx >= arr.length) return null;
    return arr[idx];
  }

  /** Fixed wall heights the settling pass leans on at the world edges. */
  private edgeSurfaces(): EdgeSurfaces | undefined {
    if (!this.aprons) return undefined;
    return {
      left: this.aprons.left.length > 0 ? this.aprons.left[0] : null,
      right: this.aprons.right.length > 0 ? this.aprons.right[0] : null,
    };
  }

  /** Topmost solid y in a column (h = bare bedrock). */
  surfaceYAt(x: number): number {
    const xi = x | 0;
    if (xi < 0 || xi >= this.w) return this.apronSurfaceAt(xi) ?? this.h;
    return this.h - this.counts[xi];
  }

  solidAt(x: number, y: number): boolean {
    if (y >= this.h) return true; // bedrock
    if (y < 0) return false;
    if (x < 0 || x >= this.w) {
      const apron = this.apronSurfaceAt(Math.floor(x));
      return apron !== null && y >= apron;
    }
    return y >= this.h - this.counts[x | 0];
  }

  /** Column surfaces as y values — the shared carve/settle math runs on this. */
  private surfaceView(): Float64Array {
    const surf = new Float64Array(this.w);
    for (let x = 0; x < this.w; x++) surf[x] = this.h - this.counts[x];
    return surf;
  }

  private commitSurfaces(surf: Float64Array, x0: number, x1: number): void {
    for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
      this.counts[x] = Math.max(0, Math.min(this.h, this.h - Math.round(surf[x])));
    }
  }

  /** Blast a circle out; displaced dirt falls in and the walls settle. */
  carveCircle(cx: number, cy: number, r: number): void {
    const surf = this.surfaceView();
    const range = carveSurfaceCircle(surf, this.h, cx, cy, r, this.edgeSurfaces());
    if (range) this.commitSurfaces(surf, range.x0, range.x1);
  }

  /** Pile a half-disc of dirt on top of the surface; flanks settle. */
  addMound(cx: number, r: number): void {
    const surf = this.surfaceView();
    const range = moundSurfaceCircle(surf, this.h, cx, r, this.edgeSurfaces());
    if (range) this.commitSurfaces(surf, range.x0, range.x1);
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
