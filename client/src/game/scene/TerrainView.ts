import {
  blendApron,
  carveSurfaceCircle,
  cssColor,
  moundSurfaceCircle,
  WORLD_H,
  WORLD_W,
  type CarveCircle,
  type TerrainTheme,
  type TerrainTree,
} from '@mortar/shared';
import { Container, Sprite, Texture } from 'pixi.js';

/**
 * Renderer-side terrain. Must stay column-faithful to the shared TerrainMask:
 * it mirrors the same carve/mound circles into its own surface model.
 */
export interface TerrainAprons {
  left: Float64Array;
  right: Float64Array;
}

export interface TerrainView {
  readonly container: Container;
  init(
    heights: Float64Array,
    theme: TerrainTheme,
    aprons?: TerrainAprons,
    trees?: readonly TerrainTree[],
  ): void;
  applyCarves(circles: readonly CarveCircle[]): void;
  destroy(): void;
}

const TILE_W = 300;
const TILE_H = 450;
const ROWS = WORLD_H / TILE_H; // 3
/** World px each apron extends inward, under the edge tiles (even number). */
const APRON_OVERLAP = 8;

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: Texture;
  sprite: Sprite;
  x0: number;
  y0: number;
  w: number;
}

/**
 * Terrain as offscreen 2D canvas tiles uploaded as textures. Under the
 * falling-dirt model the world is always a per-column heightmap, so any
 * terrain change = update `surfaces` + repaint the touched tiles from it.
 */
interface ApronSide {
  side: 'left' | 'right';
  /** As generated — the blend's far anchor. */
  original: Float64Array;
  /** Inner columns re-anchored on the live world edge (what gets painted). */
  live: Float64Array;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: Texture;
  sprite: Sprite;
}

export class CpuTileTerrain implements TerrainView {
  readonly container = new Container();
  private tiles: Tile[] = [];
  private apronSides: ApronSide[] = [];
  private surfaces: Float64Array = new Float64Array(WORLD_W);
  private width = WORLD_W;
  private cols = 0;
  private theme: TerrainTheme | null = null;
  private noise: CanvasPattern | null = null;
  /** Living scenery trees; blasts prune them, survivors ride the surface. */
  private trees: TerrainTree[] = [];

  init(
    heights: Float64Array,
    theme: TerrainTheme,
    aprons?: TerrainAprons,
    trees?: readonly TerrainTree[],
  ): void {
    this.disposeTiles();
    this.surfaces = Float64Array.from(heights);
    this.width = heights.length;
    this.cols = Math.ceil(this.width / TILE_W);
    this.theme = theme;
    this.trees = trees ? [...trees] : [];
    this.noise = makeNoisePattern();
    if (aprons) {
      this.setupApron(aprons.left, 'left');
      this.setupApron(aprons.right, 'right');
    }

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x0 = col * TILE_W;
        const y0 = row * TILE_H;
        const tileW = Math.min(TILE_W, this.width - x0);
        const canvas = document.createElement('canvas');
        canvas.width = tileW;
        canvas.height = TILE_H;
        const ctx = canvas.getContext('2d')!;
        const tile: Tile = {
          canvas,
          ctx,
          texture: Texture.EMPTY,
          sprite: new Sprite(),
          x0,
          y0,
          w: tileW,
        };
        this.paintTile(tile);
        tile.texture = Texture.from(canvas);
        tile.sprite.texture = tile.texture;
        tile.sprite.position.set(x0, y0);
        this.container.addChild(tile.sprite);
        this.tiles.push(tile);
      }
    }
  }

  applyCarves(circles: readonly CarveCircle[]): void {
    if (!this.theme) return;
    const dirtyCols = new Set<number>();
    const scorches: CarveCircle[] = [];
    // Blasts clear the woods around ground zero (mounds just bury trunks).
    for (const c of circles) {
      if (!c.add) this.trees = this.trees.filter((t) => Math.abs(t.x - c.x) > c.r * 0.9);
    }
    let edgeTouched: { left: boolean; right: boolean } = { left: false, right: false };
    for (const c of circles) {
      const range = c.add
        ? moundSurfaceCircle(this.surfaces, WORLD_H, c.x, c.r)
        : carveSurfaceCircle(this.surfaces, WORLD_H, c.x, c.y, c.r);
      if (!c.add) scorches.push(c);
      if (!range) continue;
      if (range.x0 <= 2) edgeTouched = { ...edgeTouched, left: true };
      if (range.x1 >= this.width - 3) edgeTouched = { ...edgeTouched, right: true };
      const c0 = Math.max(0, Math.floor((range.x0 - 10) / TILE_W));
      const c1 = Math.min(this.cols - 1, Math.floor((range.x1 + 10) / TILE_W));
      for (let col = c0; col <= c1; col++) dirtyCols.add(col);
    }

    // Edge carves: flow the apron scenery onto the new edge height so no
    // vertical seam wall appears where the destructible world ends.
    for (const a of this.apronSides) {
      if (a.side === 'left' ? !edgeTouched.left : !edgeTouched.right) continue;
      const edgeH = this.surfaces[a.side === 'left' ? 0 : this.width - 1];
      blendApron(a.live, a.original, edgeH);
      this.paintApronSide(a);
      a.texture.source.update();
    }

    for (const col of dirtyCols) {
      for (let row = 0; row < ROWS; row++) {
        const tile = this.tiles[row * this.cols + col];
        this.paintTile(tile);
        // Char the rims of fresh craters that touch this tile.
        for (const c of scorches) this.scorch(tile, c);
        tile.texture.source.update();
      }
    }
  }

  /** Full repaint of one tile from the surface model. */
  private paintTile(tile: Tile): void {
    const theme = this.theme;
    if (!theme) return;
    const { ctx, x0, y0, w: tileW } = tile;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, tileW, TILE_H);
    ctx.translate(-x0, -y0);

    // 1) Soil strata gradient across the whole world height.
    const g = ctx.createLinearGradient(0, 0.38 * WORLD_H, 0, WORLD_H);
    g.addColorStop(0, cssColor(theme.soilTop));
    g.addColorStop(1, cssColor(theme.soilDeep));
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, tileW, TILE_H);

    // 2) Grain so the dirt isn't a flat wash.
    if (this.noise) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = this.noise;
      ctx.fillRect(x0, y0, tileW, TILE_H);
      ctx.globalAlpha = 1;
    }

    // 3) Cut away everything above the surface curve (margin avoids seams).
    // The ±2 side extensions matter at the world edges: a polygon ending
    // exactly on the last column leaves it unerased — a full-height soil
    // line hanging in the sky right at the wall.
    const from = Math.max(0, x0 - 8);
    const to = Math.min(this.width - 1, x0 + tileW + 8);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(from - 2, -10);
    ctx.lineTo(from - 2, this.surfaces[from]);
    for (let x = from; x <= to; x++) ctx.lineTo(x, this.surfaces[x]);
    ctx.lineTo(to + 2, this.surfaces[to]);
    ctx.lineTo(to + 2, -10);
    ctx.closePath();
    ctx.fill();

    // 4) Grass/snow cap hugging the surface.
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(from, this.surfaces[from] + 3);
    for (let x = from; x <= to; x++) ctx.lineTo(x, this.surfaces[x] + 3);
    ctx.strokeStyle = cssColor(theme.grass);
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 5) Trees rooted in this tile's column span (crowns may overhang the
    //    row above/below — every row draws them, the clip sorts it out).
    for (const t of this.trees) {
      if (t.x >= x0 - 30 && t.x <= x0 + tileW + 30) this.drawTree(ctx, theme, t);
    }

    ctx.restore();
  }

  /** Tiny scenery tree standing on the surface at its column. */
  private drawTree(ctx: CanvasRenderingContext2D, theme: TerrainTheme, t: TerrainTree): void {
    const xi = Math.min(this.width - 1, Math.max(0, Math.round(t.x)));
    const base = this.surfaces[xi] + 2;
    const h = t.h;
    ctx.fillStyle = cssColor(shade(theme.soilDeep, 0.72));
    ctx.fillRect(t.x - 1.1, base - h * 0.4, 2.2, h * 0.4);
    ctx.fillStyle = cssColor(shade(theme.grass, t.kind === 1 ? 0.52 : 0.64));
    if (t.kind === 2) {
      // Round crown: a clump of overlapping blobs.
      ctx.beginPath();
      ctx.arc(t.x, base - h * 0.62, h * 0.3, 0, Math.PI * 2);
      ctx.arc(t.x - h * 0.18, base - h * 0.48, h * 0.22, 0, Math.PI * 2);
      ctx.arc(t.x + h * 0.18, base - h * 0.5, h * 0.24, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Conifer: stacked triangles, slimmer for kind 1.
      const wHalf = h * (t.kind === 1 ? 0.2 : 0.28);
      for (let layer = 0; layer < 3; layer++) {
        const ly = base - h * (0.3 + 0.23 * layer);
        const lw = wHalf * (1 - layer * 0.26);
        ctx.beginPath();
        ctx.moveTo(t.x - lw, ly);
        ctx.lineTo(t.x + lw, ly);
        ctx.lineTo(t.x, ly - h * 0.34);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /**
   * Decorative hills past the world edge, drawn at half resolution so
   * zoomed-out framing never shows bare sky. arr[0] hugs the edge. The apron
   * tucks APRON_OVERLAP px under the edge tiles (tiles paint on top): abutting
   * exactly leaves a hairline of sky at the seam at fractional zoom scales.
   * Kept repaintable: edge carves re-anchor the inner columns (blendApron)
   * and redraw so the scenery flows out of craters instead of walling up.
   */
  private setupApron(arr: Float64Array, side: 'left' | 'right'): void {
    if (arr.length === 0) return;
    const cw = Math.ceil(arr.length / 2) + APRON_OVERLAP / 2;
    const ch = Math.ceil(WORLD_H / 2);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const a: ApronSide = {
      side,
      original: arr,
      live: Float64Array.from(arr),
      canvas,
      ctx: canvas.getContext('2d')!,
      texture: Texture.EMPTY,
      sprite: new Sprite(),
    };
    this.paintApronSide(a);
    a.texture = Texture.from(canvas);
    a.sprite.texture = a.texture;
    a.sprite.scale.set(2);
    a.sprite.position.set(side === 'left' ? -arr.length : this.width - APRON_OVERLAP, 0);
    this.container.addChild(a.sprite);
    this.apronSides.push(a);
  }

  private paintApronSide(a: ApronSide): void {
    const theme = this.theme;
    if (!theme) return;
    const { ctx, live: arr, side } = a;
    const A = arr.length;
    const cw = a.canvas.width;
    const ch = a.canvas.height;

    // Canvas x → apron index (left apron is mirrored: outward = leftward).
    // The overlap strip clamps to arr[0], the height at the world edge.
    const idxAt = (cx: number) =>
      Math.min(A - 1, Math.max(0, side === 'left' ? A - 1 - cx * 2 : cx * 2 - APRON_OVERLAP));

    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, cw, ch);
    const g = ctx.createLinearGradient(0, 0.19 * WORLD_H, 0, ch);
    g.addColorStop(0, cssColor(theme.soilTop));
    g.addColorStop(1, cssColor(theme.soilDeep));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    if (this.noise) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = this.noise;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }
    // Close the cut with vertical edges past the canvas: a diagonal closure
    // leaves an unerased soil sliver in the end columns — a needle of dirt
    // sticking into the sky right at the world edge.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(-2, -10);
    ctx.lineTo(-2, arr[idxAt(0)] / 2);
    for (let cx = 0; cx < cw; cx++) ctx.lineTo(cx, arr[idxAt(cx)] / 2);
    ctx.lineTo(cw + 2, arr[idxAt(cw - 1)] / 2);
    ctx.lineTo(cw + 2, -10);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(0, arr[idxAt(0)] / 2 + 1.5);
    for (let cx = 0; cx < cw; cx++) ctx.lineTo(cx, arr[idxAt(cx)] / 2 + 1.5);
    ctx.strokeStyle = cssColor(theme.grass);
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  private scorch(tile: Tile, c: CarveCircle): void {
    const scorchR = c.r * 1.2;
    if (
      c.x + scorchR < tile.x0 ||
      c.x - scorchR > tile.x0 + tile.w ||
      c.y + scorchR < tile.y0 ||
      c.y - scorchR > tile.y0 + TILE_H
    ) {
      return;
    }
    const { ctx } = tile;
    const lx = c.x - tile.x0;
    const ly = c.y - tile.y0;
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createRadialGradient(lx, ly, c.r * 0.82, lx, ly, scorchR);
    g.addColorStop(0, 'rgba(24,14,8,0.5)');
    g.addColorStop(0.55, 'rgba(30,18,10,0.22)');
    g.addColorStop(1, 'rgba(30,18,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lx, ly, scorchR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  private disposeTiles(): void {
    for (const tile of this.tiles) {
      tile.sprite.destroy();
      if (tile.texture !== Texture.EMPTY) tile.texture.destroy(true);
    }
    this.tiles = [];
    for (const a of this.apronSides) {
      a.sprite.destroy();
      if (a.texture !== Texture.EMPTY) a.texture.destroy(true);
    }
    this.apronSides = [];
  }

  destroy(): void {
    this.disposeTiles();
    this.container.destroy();
  }
}

/** Multiply an 0xRRGGBB color's channels by f (0..1 darkens). */
function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((c & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

let noisePattern: CanvasPattern | null | undefined;
function makeNoisePattern(): CanvasPattern | null {
  if (noisePattern !== undefined) return noisePattern;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 900; i++) {
    const v = Math.random();
    ctx.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect((Math.random() * 96) | 0, (Math.random() * 96) | 0, 1, 1);
  }
  noisePattern = ctx.createPattern(c, 'repeat');
  return noisePattern;
}
