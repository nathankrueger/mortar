import type { ProjectileKind } from '@mortar/shared';
import { Container, Graphics } from 'pixi.js';

/** Simple shell sprites keyed by projectile id (trails arrive with M3 FX). */
export class ProjectileLayer {
  readonly container = new Container();
  private sprites = new Map<number, Graphics>();

  spawn(id: number, kind: ProjectileKind, x: number, y: number): void {
    const g = new Graphics();
    const r = kind === 'nukelet' ? 5.5 : kind === 'warhead' ? 3.5 : 4.5;
    g.circle(0, 0, r).fill({ color: 0x1d232e });
    g.circle(-r * 0.3, -r * 0.3, r * 0.45).fill({ color: 0xffffff, alpha: 0.35 });
    g.position.set(x, y);
    this.container.addChild(g);
    this.sprites.set(id, g);
  }

  move(id: number, x: number, y: number): void {
    this.sprites.get(id)?.position.set(x, y);
  }

  remove(id: number): void {
    const g = this.sprites.get(id);
    if (g) {
      g.destroy();
      this.sprites.delete(id);
    }
  }

  positions(): { x: number; y: number }[] {
    return [...this.sprites.values()].map((g) => ({ x: g.x, y: g.y }));
  }

  clear(): void {
    for (const g of this.sprites.values()) g.destroy();
    this.sprites.clear();
  }
}
