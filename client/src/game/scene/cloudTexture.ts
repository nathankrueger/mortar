import { Texture } from 'pixi.js';

// Soft procedural cloud sprites — white so they can be tinted per theme.
// Cosmetic only, so plain Math.random is fine here.

const cache: Texture[] = [];
const VARIANTS = 4;

function makeCloudCanvas(): HTMLCanvasElement {
  const w = 340;
  const h = 170;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const blobs = 10 + Math.floor(Math.random() * 5);
  for (let i = 0; i < blobs; i++) {
    const bx = 50 + Math.random() * (w - 100);
    const by = 55 + Math.random() * 50;
    const br = 28 + Math.random() * 44;
    const g = ctx.createRadialGradient(bx, by, br * 0.15, bx, by, br);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(bx - br, by - br, br * 2, br * 2);
  }

  // Flatten the underside so it reads as a cloud, not a puff of smoke.
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, h * 0.66, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, h * 0.66, w, h * 0.34);
  ctx.globalCompositeOperation = 'source-over';

  return canvas;
}

export function cloudTexture(variant: number): Texture {
  const i = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  if (!cache[i]) cache[i] = Texture.from(makeCloudCanvas());
  return cache[i];
}

/** Radial glow texture (white core → transparent) for suns, flashes, halos. */
let glowCache: Texture | null = null;
export function glowTexture(): Texture {
  if (glowCache) return glowCache;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowCache = Texture.from(canvas);
  return glowCache;
}
