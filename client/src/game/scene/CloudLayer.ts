import { WORLD_W, type TerrainTheme } from '@mortar/shared';
import { Container, Sprite } from 'pixi.js';
import { cloudTexture } from './cloudTexture';

interface Cloud {
  sprite: Sprite;
  vx: number;
}

const WRAP_MARGIN = 400;

/** World-space cumulus drifting over the battlefield; direction follows wind. */
export class CloudLayer {
  readonly container = new Container();
  private clouds: Cloud[] = [];
  private windSign = 1;
  private worldW = WORLD_W;

  setTheme(theme: TerrainTheme, worldW = WORLD_W): void {
    this.worldW = worldW;
    for (const c of this.clouds) c.sprite.destroy();
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const sprite = new Sprite(cloudTexture(i));
      sprite.anchor.set(0.5);
      sprite.tint = theme.cloudTint;
      sprite.alpha = theme.cloudAlpha * (0.45 + Math.random() * 0.35);
      const s = 0.7 + Math.random() * 1.1;
      sprite.scale.set(s);
      sprite.position.set(Math.random() * worldW, 90 + Math.random() * 330);
      this.container.addChild(sprite);
      this.clouds.push({ sprite, vx: (4 + Math.random() * 9) * (Math.random() < 0.5 ? -1 : 1) });
    }
  }

  /** Nudge cloud drift to match the current wind direction. */
  setWind(wind: number): void {
    this.windSign = wind === 0 ? this.windSign : Math.sign(wind);
  }

  update(dtSec: number): void {
    for (const c of this.clouds) {
      const dir = Math.sign(c.vx) === this.windSign ? 1 : -0.4; // drift turns slowly
      c.sprite.x += Math.abs(c.vx) * this.windSign * dtSec * (dir > 0 ? 1 : 0.4);
      if (c.sprite.x > this.worldW + WRAP_MARGIN) c.sprite.x = -WRAP_MARGIN;
      if (c.sprite.x < -WRAP_MARGIN) c.sprite.x = this.worldW + WRAP_MARGIN;
    }
  }
}
