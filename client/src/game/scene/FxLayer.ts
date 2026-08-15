import type { TerrainTheme } from '@mortar/shared';
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { glowTexture } from './cloudTexture';
import { ParticleSystem } from './particles';

interface Fx {
  age: number;
  dur: number;
  update(f: number, dt: number): void;
  destroy(): void;
}

const TIER_TRAUMA = [0.22, 0.38, 0.52, 0.72, 1.0];
const SPARK_TINTS = [0xffd27a, 0xffb85c, 0xfff1c4];

/** Cooling-fire palette, white-hot at t=0 down to smoldering red at t=1. */
const FIRE_STOPS = [0xfff7dc, 0xffd968, 0xff9030, 0xe0501e, 0x6e2012];

function lerpColor(a: number, b: number, t: number): number {
  const ar = a >> 16, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = b >> 16, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    (((ar + (br - ar) * t) | 0) << 16) |
    (((ag + (bg - ag) * t) | 0) << 8) |
    ((ab + (bb - ab) * t) | 0)
  );
}

function fireTint(t: number): number {
  const p = Math.min(0.999, Math.max(0, t)) * (FIRE_STOPS.length - 1);
  const i = p | 0;
  return lerpColor(FIRE_STOPS[i], FIRE_STOPS[i + 1], p - i);
}

/**
 * Explosion visuals: additive flash + shock ring + debris/spark particles +
 * buoyant smoke, with rising mushroom clouds for the nuke tiers.
 */
export class FxLayer {
  readonly container = new Container();
  private fx: Fx[] = [];
  private debris = new ParticleSystem(false, 2200);
  private sparks = new ParticleSystem(true, 1200);
  private smokeHolder = new Container();
  private debrisTints: number[] = [0x8a6f4d, 0x6b543d, 0x4c3a28];
  onTrauma: ((amount: number) => void) | null = null;
  private recentBlasts: { x: number; y: number; age: number }[] = [];

  constructor() {
    // Smoke under particles so sparks read on top.
    this.container.addChild(this.smokeHolder, this.debris.container, this.sparks.container);
  }

  setTheme(theme: TerrainTheme): void {
    this.debrisTints = [theme.soilTop, theme.soilDeep, theme.grass];
  }

  explode(x: number, y: number, r: number, tier: number): void {
    this.onTrauma?.(TIER_TRAUMA[tier] ?? 0.3);
    this.recentBlasts.push({ x, y, age: 0 });

    // Core flash.
    const flash = new Sprite(glowTexture());
    flash.anchor.set(0.5);
    flash.position.set(x, y);
    flash.blendMode = 'add';
    flash.tint = tier >= 1 ? 0xfff6d8 : 0xffe9b0;
    this.container.addChild(flash);
    const flashScale = (r * (3.2 + tier * 0.5)) / flash.texture.width;
    this.push(0.38 + tier * 0.1, (f) => {
      flash.scale.set(flashScale * (0.35 + 0.65 * Math.min(1, f * 3)));
      flash.alpha = 1 - f;
    }, () => flash.destroy());

    // Shock ring.
    const ring = new Graphics();
    ring.position.set(x, y);
    this.container.addChild(ring);
    this.push(0.5 + tier * 0.12, (f) => {
      const radius = r * (0.3 + (1.15 + tier * 0.2) * f);
      ring
        .clear()
        .circle(0, 0, radius)
        .stroke({ width: 3 + 6 * (1 - f), color: 0xffffff, alpha: 0.7 * (1 - f) });
    }, () => ring.destroy());

    // Debris + sparks scale with tier.
    this.debris.burst({
      x,
      y,
      count: 36 + tier * 46,
      speed: [90, 340 + tier * 110],
      angle: [Math.PI * 1.05, Math.PI * 1.95], // mostly upward fan
      life: [0.5, 1.3 + tier * 0.25],
      scale: [0.5, 0.22],
      tints: this.debrisTints,
      gravity: 760,
      drag: 0.25,
    });
    this.sparks.burst({
      x,
      y,
      count: 22 + tier * 30,
      speed: [180, 520 + tier * 150],
      life: [0.2, 0.55],
      scale: [0.45, 0.1],
      tints: SPARK_TINTS,
      gravity: 300,
      drag: 0.8,
    });

    // Rolling fireball for the heavy tiers, then lingering smoke.
    if (tier >= 1) this.fireball(x, y, r, tier);
    this.smokePuffs(x, y - r * 0.2, 5 + tier * 5, r, tier);
    if (tier >= 1) this.mushroom(x, y, r, tier);
  }

  /**
   * Boiling additive fire: a cluster of glow blobs that swell, rise, and cool
   * white → yellow → orange → deep red before the smoke takes over.
   */
  private fireball(x: number, y: number, r: number, tier: number): void {
    const count = 10 + tier * 7;
    for (let i = 0; i < count; i++) {
      const ball = new Sprite(glowTexture());
      ball.anchor.set(0.5);
      ball.blendMode = 'add';
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * r * 0.55;
      ball.position.set(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad * 0.7 - r * 0.1);
      this.container.addChild(ball);
      const base = (r * (0.45 + Math.random() * 0.5)) / ball.texture.width;
      const rise = 30 + Math.random() * 50 + tier * 25;
      const drift = Math.cos(ang) * (20 + Math.random() * 30);
      const dur = 0.55 + Math.random() * 0.35 + tier * 0.16;
      const delay = Math.random() * 0.09;
      this.push(
        dur + delay,
        (f, dt) => {
          const t = Math.max(0, (f * (dur + delay) - delay) / dur);
          if (t <= 0) {
            ball.alpha = 0;
            return;
          }
          ball.tint = fireTint(t);
          ball.alpha = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
          ball.scale.set(base * (0.45 + t * 1.35));
          ball.y -= rise * dt;
          ball.x += drift * dt;
        },
        () => ball.destroy(),
      );
    }
  }

  private smokePuffs(x: number, y: number, count: number, r: number, tier: number): void {
    for (let i = 0; i < count; i++) {
      const puff = new Sprite(glowTexture());
      puff.anchor.set(0.5);
      puff.blendMode = 'normal';
      puff.tint = 0x59524b;
      puff.alpha = 0;
      const px = x + (Math.random() - 0.5) * r * 0.9;
      const py = y + (Math.random() - 0.5) * r * 0.4;
      puff.position.set(px, py);
      this.smokeHolder.addChild(puff);
      const base = (r * (0.5 + Math.random() * 0.5)) / puff.texture.width;
      const rise = 26 + Math.random() * 40;
      const drift = (Math.random() - 0.5) * 30;
      const dur = 1.6 + Math.random() * 1.8 + tier * 0.5;
      const delay = Math.random() * 0.25;
      this.push(dur + delay, (f, dt) => {
        const t = Math.max(0, (f * (dur + delay) - delay) / dur);
        if (t <= 0) return;
        puff.alpha = 0.34 * Math.sin(Math.PI * Math.min(1, t)) * (1 - t * 0.3);
        puff.scale.set(base * (0.7 + t * 1.6));
        puff.y -= rise * dt;
        puff.x += drift * dt;
      }, () => puff.destroy());
    }
  }

  /** Rising stem + rolling cap for nuke tiers. */
  private mushroom(x: number, groundY: number, r: number, tier: number): void {
    const rise = 130 + tier * 90;
    const stemDur = 0.8 + tier * 0.25;
    let emitted = 0;
    const state = { h: 0 };
    this.push(stemDur, (f, dt) => {
      state.h = rise * f;
      // Stem puffs at the current column height.
      const want = Math.floor(f * (10 + tier * 6));
      while (emitted < want) {
        emitted++;
        const puff = new Sprite(glowTexture());
        puff.anchor.set(0.5);
        puff.tint = 0x6e675e;
        puff.alpha = 0.4;
        puff.position.set(x + (Math.random() - 0.5) * r * 0.35, groundY - state.h * Math.random());
        this.smokeHolder.addChild(puff);
        const base = (r * 0.5) / puff.texture.width;
        const dur = 1.6 + Math.random() + tier * 0.4;
        this.push(dur, (ff, ddt) => {
          puff.alpha = 0.4 * (1 - ff);
          puff.scale.set(base * (0.6 + ff * 1.1));
          puff.y -= 18 * ddt;
        }, () => puff.destroy());
      }
      void dt;
    }, () => {
      // Cap blooms once the stem tops out.
      const capY = groundY - rise;
      for (let i = 0; i < 10 + tier * 6; i++) {
        const puff = new Sprite(glowTexture());
        puff.anchor.set(0.5);
        puff.tint = 0x7d766c;
        puff.alpha = 0;
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * r * (0.5 + tier * 0.12);
        puff.position.set(x + Math.cos(ang) * rad, capY + Math.sin(ang) * rad * 0.45);
        this.smokeHolder.addChild(puff);
        const base = (r * (0.55 + Math.random() * 0.4)) / puff.texture.width;
        const dur = 2.2 + Math.random() * 1.6 + tier * 0.5;
        const spreadX = Math.cos(ang) * (16 + tier * 8);
        this.push(dur, (ff, ddt) => {
          puff.alpha = 0.45 * Math.sin(Math.PI * Math.min(1, ff)) ;
          puff.scale.set(base * (0.7 + ff * 1.4));
          puff.y -= 22 * ddt;
          puff.x += spreadX * ddt;
        }, () => puff.destroy());
      }
    });
  }

  /**
   * Flames licking up a burning tree — called repeatedly while it burns,
   * with intensity falling off as the tree is consumed.
   */
  treeFire(x: number, groundY: number, h: number, intensity: number): void {
    const i = Math.max(0.15, Math.min(1, intensity));

    // Flame body: short-lived additive blobs, re-emitted faster than they die
    // so the tree wears a continuously flickering fire.
    for (let k = 0; k < 2; k++) {
      const flame = new Sprite(glowTexture());
      flame.anchor.set(0.5);
      flame.blendMode = 'add';
      const spread = h * 0.22;
      const fx = x + (Math.random() - 0.5) * spread;
      const fy = groundY - h * (0.2 + Math.random() * 0.55);
      flame.position.set(fx, fy);
      this.container.addChild(flame);
      const base = (h * (0.5 + Math.random() * 0.45) * (0.55 + i * 0.6)) / flame.texture.width;
      const dur = 0.22 + Math.random() * 0.2;
      this.push(
        dur,
        (f, dt) => {
          flame.tint = fireTint(0.15 + f * 0.7);
          flame.alpha = (0.75 * i) * Math.sin(Math.PI * f);
          flame.scale.set(base * (0.7 + f * 0.5));
          flame.y -= (18 + 26 * i) * dt;
        },
        () => flame.destroy(),
      );
    }

    this.sparks.burst({
      x: x + (Math.random() - 0.5) * h * 0.45,
      y: groundY - h * (0.15 + Math.random() * 0.6),
      count: 2,
      speed: [14, 46 + 40 * i],
      angle: [Math.PI * 1.3, Math.PI * 1.7], // upward fan
      life: [0.22, 0.5],
      scale: [0.16 + 0.2 * i, 0.02],
      tints: FIRE_STOPS.slice(0, 4),
      gravity: -55,
      drag: 0.6,
      alpha: 0.85,
    });
    if (Math.random() < 0.16) {
      const puff = new Sprite(glowTexture());
      puff.anchor.set(0.5);
      puff.tint = 0x4a443d;
      puff.alpha = 0;
      puff.position.set(x + (Math.random() - 0.5) * h * 0.3, groundY - h * 0.7);
      this.smokeHolder.addChild(puff);
      const s = (h * 0.5) / puff.texture.width;
      const dur = 1.4 + Math.random();
      this.push(
        dur,
        (f, dt) => {
          puff.alpha = 0.3 * Math.sin(Math.PI * f);
          puff.scale.set(s * (0.5 + f * 1.5));
          puff.y -= 26 * dt;
          puff.x += 8 * dt;
        },
        () => puff.destroy(),
      );
    }
  }

  /** Emit a short-lived trail mote behind a moving shell. */
  trail(x: number, y: number, hot: boolean): void {
    this.sparks.burst({
      x,
      y,
      count: 1,
      speed: [2, 14],
      life: [0.18, 0.35],
      scale: [hot ? 0.4 : 0.28, 0.05],
      tints: hot ? SPARK_TINTS : [0xffffff],
      gravity: 0,
      drag: 1,
      alpha: hot ? 0.9 : 0.5,
    });
  }

  bounce(x: number, y: number): void {
    this.debris.burst({
      x,
      y: y - 2,
      count: 10,
      speed: [50, 170],
      angle: [Math.PI * 1.1, Math.PI * 1.9],
      life: [0.3, 0.7],
      scale: [0.4, 0.15],
      tints: this.debrisTints,
      gravity: 700,
      drag: 0.3,
    });
  }

  fizzle(x: number, y: number): void {
    const puff = new Sprite(glowTexture());
    puff.anchor.set(0.5);
    puff.position.set(x, y);
    puff.tint = 0x9aa2ad;
    this.smokeHolder.addChild(puff);
    const s = 44 / puff.texture.width;
    this.push(0.6, (f) => {
      puff.scale.set(s * (0.5 + f * 0.8));
      puff.alpha = 0.55 * (1 - f);
    }, () => puff.destroy());
  }

  /** Floating damage number above a tank. */
  damagePopup(x: number, y: number, amount: number, direct: boolean): void {
    const text = new Text({
      text: `-${Math.round(amount)}`,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: direct ? 34 : 26,
        fontWeight: '800',
        fill: direct ? 0xffd34d : 0xffffff,
        stroke: { color: 0x000000, width: 4, join: 'round' },
      },
    });
    text.anchor.set(0.5);
    text.position.set(x, y);
    this.container.addChild(text);
    this.push(
      1.1,
      (f, dt) => {
        text.y -= 42 * dt;
        text.alpha = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
        text.scale.set(f < 0.12 ? 0.6 + (f / 0.12) * 0.4 : 1);
      },
      () => text.destroy(),
    );
  }

  hotPoints(): { x: number; y: number }[] {
    return this.recentBlasts.filter((b) => b.age < 1).map((b) => ({ x: b.x, y: b.y }));
  }

  private push(dur: number, update: (f: number, dt: number) => void, destroy: () => void = () => {}): void {
    this.fx.push({ age: 0, dur, update, destroy });
  }

  update(dtSec: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const fx = this.fx[i];
      fx.age += dtSec;
      const f = Math.min(1, fx.age / fx.dur);
      fx.update(f, dtSec);
      if (f >= 1) {
        fx.destroy();
        this.fx.splice(i, 1);
      }
    }
    this.debris.update(dtSec);
    this.sparks.update(dtSec);
    for (let i = this.recentBlasts.length - 1; i >= 0; i--) {
      this.recentBlasts[i].age += dtSec;
      if (this.recentBlasts[i].age > 1.5) this.recentBlasts.splice(i, 1);
    }
  }

  clear(): void {
    for (const fx of this.fx) fx.destroy();
    this.fx = [];
    this.debris.clear();
    this.sparks.clear();
    this.recentBlasts = [];
  }
}
