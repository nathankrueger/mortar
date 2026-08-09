import {
  carveSurfaceCircle,
  cssColor,
  moundSurfaceCircle,
  WORLD_H,
  WORLD_W,
  type CarveCircle,
  type TerrainTheme,
} from '@mortar/shared';
import { Container, Sprite, Texture } from 'pixi.js';

/**
 * Renderer-side terrain. Must stay column-faithful to the shared TerrainMask:
 * it mirrors the same carve/mound circles into its own surface model.
 */
export interface TerrainView {
  readonly container: Container;
  init(heights: Float64Array, theme: TerrainTheme): void;
  applyCarves(circles: readonly CarveCircle[]): void;
  destroy(): void;
}

const TILE_W = 300;
const TILE_H = 450;
const ROWS = WORLD_H / TILE_H; // 3

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
  private surfaces: Float64Array = new Float64Array(WORLD_W);
  private width = WORLD_W;
  private cols = 0;
  private theme: TerrainTheme | null = null;
  private noise: CanvasPattern | null = null;

  init(heights: Float64Array, theme: TerrainTheme): void {
    this.disposeTiles();
    this.surfaces = Float64Array.from(heights);
    this.width = heights.length;
    this.cols = Math.ceil(this.width / TILE_W);
    this.theme = theme;
    this.noise = makeNoisePattern();

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
        ? moundSurfaceCircle(this.surfaces, c.x, c.r)
        : carveSurfaceCircle(this.surfaces, WORLD_H, c.x, c.y, c.r);
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
    const from = Math.max(0, x0 - 8);
    const to = Math.min(this.width - 1, x0 + tileW + 8);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(from, -10);
    for (let x = from; x <= to; x++) ctx.lineTo(x, this.surfaces[x]);
    ctx.lineTo(to, -10);
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
