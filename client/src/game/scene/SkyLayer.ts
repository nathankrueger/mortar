import { cssColor, type TerrainTheme } from '@mortar/shared';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { cloudTexture, glowTexture } from './cloudTexture';

interface FarCloud {
  sprite: Sprite;
  speed: number;
}

/**
 * Screen-space backdrop: theme gradient, sun/moon with glow, and slow far
 * clouds with ×0.1 parallax against the camera.
 */
export class SkyLayer {
  readonly container = new Container();

  private gradient = new Sprite(Texture.WHITE);
  private glow = new Sprite(glowTexture());
  private disc = new Graphics();
  private crescent = new Graphics();
  private farClouds: FarCloud[] = [];
  private theme: TerrainTheme | null = null;
  private vw = 1;
  private vh = 1;
  private drift = 0;
  private glowBaseScale = 1;

  constructor() {
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.container.addChild(this.gradient, this.glow, this.disc, this.crescent);
  }

  setTheme(theme: TerrainTheme): void {
    this.theme = theme;
    this.gradient.texture = makeGradientTexture(theme);

    this.glow.tint = theme.sunColor;
    this.glow.alpha = theme.moon ? 0.35 : 0.55;

    for (const c of this.farClouds) c.sprite.destroy();
    this.farClouds = [];
    for (let i = 0; i < 5; i++) {
      const sprite = new Sprite(cloudTexture(i));
      sprite.anchor.set(0.5);
      sprite.tint = theme.cloudTint;
      sprite.alpha = 0.35 * theme.cloudAlpha;
      this.container.addChild(sprite);
      this.farClouds.push({ sprite, speed: 2 + Math.random() * 3 });
    }
    this.layout();
  }

  resize(w: number, h: number): void {
    this.vw = w;
    this.vh = h;
    this.layout();
  }

  private layout(): void {
    const t = this.theme;
    this.gradient.width = this.vw;
    this.gradient.height = this.vh;
    if (!t) return;

    const sx = t.sunX * this.vw;
    const sy = t.sunY * this.vh;
    const r = Math.min(this.vw, this.vh) * 0.055;

    this.glow.position.set(sx, sy);
    this.glowBaseScale = (r * 9) / this.glow.texture.width;
    this.glow.scale.set(this.glowBaseScale);

    this.disc.clear().circle(sx, sy, r).fill({ color: t.sunColor, alpha: 0.95 });
    this.crescent.clear();
    if (t.moon) {
      this.crescent.circle(sx + r * 0.45, sy - r * 0.2, r * 0.92).fill({ color: t.skyTop, alpha: 0.9 });
    }

    for (const c of this.farClouds) {
      c.sprite.position.set(Math.random() * this.vw, this.vh * (0.06 + Math.random() * 0.24));
      const s = 0.9 + Math.random() * 1.1;
      c.sprite.scale.set(s);
    }
  }

  update(dtSec: number, worldLeft: number, worldScale: number): void {
    this.drift += dtSec;
    const parallax = -worldLeft * worldScale * 0.1;
    for (const c of this.farClouds) {
      c.sprite.x += c.speed * dtSec;
      const wrapped = ((c.sprite.x + 200) % (this.vw + 400) + (this.vw + 400)) % (this.vw + 400) - 200;
      c.sprite.x = wrapped;
      c.sprite.pivot.x = -parallax / Math.max(c.sprite.scale.x, 0.001);
    }
    // Gentle living glow (absolute scale — never compound frame over frame).
    const pulse = 1 + Math.sin(this.drift * 0.9) * 0.04;
    this.glow.scale.set(this.glowBaseScale * pulse);
  }
}

function makeGradientTexture(theme: TerrainTheme): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, cssColor(theme.skyTop));
  g.addColorStop(0.55, cssColor(theme.skyMid));
  g.addColorStop(1, cssColor(theme.skyHorizon));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 512);
  return Texture.from(canvas);
}
