import {
  carveSurfaceCircle,
  cssColor,
  moundSurfaceCircle,
  WORLD_H,
  WORLD_W,
  type CarveCircle,
  type EdgeSurfaces,
  type TerrainTheme,
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
  init(heights: Float64Array, theme: TerrainTheme, aprons?: TerrainAprons): void;
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
export class CpuTileTerrain implements TerrainView {
  readonly container = new Container();
  private tiles: Tile[] = [];
  private apronSprites: Sprite[] = [];
  private surfaces: Float64Array = new Float64Array(WORLD_W);
  private width = WORLD_W;
  private cols = 0;
  private theme: TerrainTheme | null = null;
  private noise: CanvasPattern | null = null;
  /** Fixed wall heights at the world edges (apron index 0) for settling. */
  private edges: EdgeSurfaces | undefined;

  init(heights: Float64Array, theme: TerrainTheme, aprons?: TerrainAprons): void {
    this.disposeTiles();
    this.surfaces = Float64Array.from(heights);
    this.width = heights.length;
    this.cols = Math.ceil(this.width / TILE_W);
    this.theme = theme;
    this.noise = makeNoisePattern();
    this.edges = aprons
      ? {
          left: aprons.left.length > 0 ? aprons.left[0] : null,
          right: aprons.right.length > 0 ? aprons.right[0] : null,
        }
      : undefined;
    if (aprons) {
      this.paintApron(aprons.left, 'left');
      this.paintApron(aprons.right, 'right');
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
    for (const c of circles) {
      const range = c.add
        ? moundSurfaceCircle(this.surfaces, WORLD_H, c.x, c.r, this.edges)
        : carveSurfaceCircle(this.surfaces, WORLD_H, c.x, c.y, c.r, this.edges);
      if (!c.add) scorches.push(c);
      if (!range) continue;
      const c0 = Math.max(0, Math.floor((range.x0 - 10) / TILE_W));
      const c1 = Math.min(this.cols - 1, Math.floor((range.x1 + 10) / TILE_W));
      for (let col = c0; col <= c1; col++) dirtyCols.add(col);
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

    ctx.restore();
  }

  /**
   * Decorative hills past the world edge, drawn once at half resolution so
   * zoomed-out framing never shows bare sky. arr[0] hugs the edge. The apron
   * tucks APRON_OVERLAP px under the edge tiles (tiles paint on top): abutting
   * exactly leaves a hairline of sky at the seam at fractional zoom scales.
   */
  private paintApron(arr: Float64Array, side: 'left' | 'right'): void {
    const theme = this.theme;
    if (!theme || arr.length === 0) return;
    const A = arr.length;
    const cw = Math.ceil(A / 2) + APRON_OVERLAP / 2;
    const ch = Math.ceil(WORLD_H / 2);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;

    // Canvas x → apron index (left apron is mirrored: outward = leftward).
    // The overlap strip clamps to arr[0], the height at the world edge.
    const idxAt = (cx: number) =>
      Math.min(A - 1, Math.max(0, side === 'left' ? A - 1 - cx * 2 : cx * 2 - APRON_OVERLAP));

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

    const sprite = new Sprite(Texture.from(canvas));
    sprite.scale.set(2);
    sprite.position.set(side === 'left' ? -A : this.width - APRON_OVERLAP, 0);
    this.container.addChild(sprite);
    this.apronSprites.push(sprite);
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
    for (const s of this.apronSprites) {
      const tex = s.texture;
      s.destroy();
      tex.destroy(true);
    }
    this.apronSprites = [];
  }

  destroy(): void {
    this.disposeTiles();
    this.container.destroy();
  }
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
