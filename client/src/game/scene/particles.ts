import { Particle, ParticleContainer, Texture } from 'pixi.js';

let dotCache: Texture | null = null;
function dotTexture(): Texture {
  if (dotCache) return dotCache;
  const c = document.createElement('canvas');
  c.width = 12;
  c.height = 12;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(6, 6, 1, 6, 6, 6);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 12, 12);
  dotCache = Texture.from(c);
  return dotCache;
}

export interface BurstOpts {
  x: number;
  y: number;
  count: number;
  speed: [number, number];
  /** Emission arc in radians (default full circle). */
  angle?: [number, number];
  gravity?: number;
  drag?: number;
  life: [number, number];
  scale: [number, number];
  tints: readonly number[];
  alpha?: number;
  /** Vertical stretch factor (rain streaks). */
  stretchY?: number;
}

interface Live {
  p: Particle;
  vx: number;
  vy: number;
  age: number;
  life: number;
  gravity: number;
  drag: number;
  s0: number;
  s1: number;
  a0: number;
  stretchY: number;
}

/** Pooled point-particle system over Pixi v8's ParticleContainer. */
export class ParticleSystem {
  readonly container: ParticleContainer;
  private live: Live[] = [];
  private cap: number;

  constructor(additive: boolean, cap = 2000) {
    this.cap = cap;
    this.container = new ParticleContainer({
      dynamicProperties: { position: true, scale: true, color: true, rotation: false },
    });
    if (additive) this.container.blendMode = 'add';
  }

  burst(opts: BurstOpts): void {
    const [a0, a1] = opts.angle ?? [0, Math.PI * 2];
    const gravity = opts.gravity ?? 720;
    const drag = opts.drag ?? 0.4;
    const n = Math.min(opts.count, this.cap - this.live.length);
    for (let i = 0; i < n; i++) {
      const ang = a0 + Math.random() * (a1 - a0);
      const speed = opts.speed[0] + Math.random() * (opts.speed[1] - opts.speed[0]);
      const life = opts.life[0] + Math.random() * (opts.life[1] - opts.life[0]);
      const tint = opts.tints[(Math.random() * opts.tints.length) | 0];
      const alpha = opts.alpha ?? 1;
      const stretchY = opts.stretchY ?? 1;
      const p = new Particle({
        texture: dotTexture(),
        x: opts.x,
        y: opts.y,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: opts.scale[0],
        scaleY: opts.scale[0] * stretchY,
        tint,
        alpha,
      });
      this.container.addParticle(p);
      this.live.push({
        p,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        age: 0,
        life,
        gravity,
        drag,
        s0: opts.scale[0],
        s1: opts.scale[1],
        a0: alpha,
        stretchY,
      });
    }
  }

  update(dtSec: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.age += dtSec;
      const f = l.age / l.life;
      if (f >= 1) {
        this.container.removeParticle(l.p);
        this.live.splice(i, 1);
        continue;
      }
      l.vy += l.gravity * dtSec;
      const damp = Math.max(0, 1 - l.drag * dtSec);
      l.vx *= damp;
      l.vy *= damp;
      l.p.x += l.vx * dtSec;
      l.p.y += l.vy * dtSec;
      const s = l.s0 + (l.s1 - l.s0) * f;
      l.p.scaleX = s;
      l.p.scaleY = s * l.stretchY;
      l.p.alpha = l.a0 * (1 - f);
    }
    this.container.update();
  }

  /** Horizontal drift for weather; drops past maxY are retired early. */
  shear(dx: number, maxY: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.p.x += dx;
      if (l.p.y > maxY + 40) l.age = l.life;
    }
  }

  clear(): void {
    for (const l of this.live) this.container.removeParticle(l.p);
    this.live = [];
    this.container.update();
  }

  get count(): number {
    return this.live.length;
  }
}
