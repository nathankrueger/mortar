import { WORLD_H, WORLD_W, type TerrainTheme } from '@mortar/shared';
import { Container } from 'pixi.js';
import { ParticleSystem } from './particles';

/** Cosmetic rain/snow drifting with the wind. */
export class WeatherLayer {
  readonly container = new Container();
  private system = new ParticleSystem(false, 700);
  private kind: 'clear' | 'rain' | 'snow' = 'clear';
  private wind = 0;
  private accum = 0;
  private worldW = WORLD_W;

  constructor() {
    this.container.addChild(this.system.container);
  }

  setTheme(theme: TerrainTheme, worldW = WORLD_W): void {
    this.worldW = worldW;
    this.kind = theme.weather;
    this.system.clear();
  }

  setWind(wind: number): void {
    this.wind = wind;
  }

  update(dtSec: number): void {
    if (this.kind !== 'clear') {
      this.accum += dtSec;
      const interval = this.kind === 'rain' ? 0.02 : 0.045;
      while (this.accum > interval) {
        this.accum -= interval;
        const rain = this.kind === 'rain';
        this.system.burst({
          x: Math.random() * (this.worldW + 800) - 400,
          y: -30,
          count: rain ? 3 : 2,
          speed: rain ? [900, 1200] : [90, 150],
          angle: [Math.PI / 2 - 0.06, Math.PI / 2 + 0.06], // downward
          gravity: 0,
          drag: 0,
          life: rain ? [1.2, 1.6] : [8, 12],
          scale: rain ? [0.22, 0.22] : [0.3, 0.26],
          tints: rain ? [0xbcd4e8] : [0xffffff],
          alpha: rain ? 0.55 : 0.8,
          stretchY: rain ? 7 : 1,
        });
      }
    }
    // Wind shear: nudge every live drop horizontally.
    this.system.shear(this.wind * 1.6 * dtSec, WORLD_H);
    this.system.update(dtSec);
  }
}
