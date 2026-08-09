import {
  generateTerrain,
  TerrainMask,
  themeFor,
  type CarveCircle,
  type ProjectileKind,
  type Seat,
  type SimEvent,
  type TerrainTheme,
} from '@mortar/shared';
import { WEAPONS, type WeaponId } from '@mortar/shared';
import { Application, Container, Sprite, Texture } from 'pixi.js';
import { IS_COARSE_POINTER } from '../app/platform';
import { sfx } from '../audio/sfx';
import { Camera, type InterestBox } from './camera';
import { ShotPlayback, type PlaybackDelegate } from './playback';
import { CloudLayer } from './scene/CloudLayer';
import { FxLayer } from './scene/FxLayer';
import { ProjectileLayer } from './scene/ProjectileView';
import { SkyLayer } from './scene/SkyLayer';
import { CpuTileTerrain } from './scene/TerrainView';
import { TankView } from './scene/TankView';
import { WeatherLayer } from './scene/WeatherLayer';
import { ScreenShake } from './shake';

export interface RoundInfo {
  seed: number;
  macro: string;
  themeName: string;
  weather: string;
  spawnX: [number, number];
  heights: Float64Array;
}

export interface TankSnapshot {
  seat: Seat;
  x: number;
  y: number;
  alive: boolean;
}

/** Session-provided hooks for game-state side effects during playback. */
export interface ShotHooks {
  onCarve?: (circles: CarveCircle[]) => void;
  onDamage?: (seat: Seat, amount: number, direct: boolean, hpAfter: number) => void;
  onFall?: (seat: Seat, hpAfter: number) => void;
  onDie?: (seat: Seat) => void;
  onDone: () => void;
}

/**
 * Owns the Pixi application and the layered battlefield:
 *   stage ── SkyLayer (screen space)
 *         └─ worldRoot (camera+shake) ── clouds ── terrain ── tanks ── shells ── fx
 */
export class GameApp {
  readonly app = new Application();
  readonly worldRoot = new Container();
  readonly camera = new Camera(this.worldRoot, IS_COARSE_POINTER);
  readonly sky = new SkyLayer();
  readonly clouds = new CloudLayer();
  readonly shake = new ScreenShake();
  readonly projectiles = new ProjectileLayer();
  readonly fx = new FxLayer();
  readonly weather = new WeatherLayer();

  mask: TerrainMask | null = null;
  terrain: CpuTileTerrain | null = null;
  theme: TerrainTheme | null = null;

  onRoundLoaded: ((info: RoundInfo) => void) | null = null;

  private tankLayer = new Container();
  private tanks = new Map<Seat, TankView>();
  private playback: ShotPlayback | null = null;
  private screenFlash: Sprite | null = null;
  private projHot = new Map<number, boolean>();
  private lastTrail = new Map<number, number>();

  private host: HTMLElement | null = null;
  private ready = false;
  private disposed = false;
  private pendingSeed: number | null = null;
  private readyResolvers: (() => void)[] = [];
  private lastHostW = 0;
  private lastHostH = 0;

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    await this.app.init({
      preference: 'webgl',
      antialias: false,
      background: 0x0b1220,
      resizeTo: host,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      powerPreference: 'high-performance',
    });
    if (this.disposed) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);
    // Debug/e2e handle (harmless in prod; used by headless verification).
    (window as unknown as { __game?: GameApp }).__game = this;

    this.app.stage.addChild(this.sky.container, this.worldRoot);
    this.worldRoot.addChild(this.clouds.container);

    // Full-screen flash quad for The Big One (above the world).
    this.screenFlash = new Sprite(Texture.WHITE);
    this.screenFlash.alpha = 0;
    this.app.stage.addChild(this.screenFlash);

    this.syncViewport(true);
    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS / 1000));

    this.ready = true;
    for (const r of this.readyResolvers) r();
    this.readyResolvers = [];
    if (this.pendingSeed !== null) {
      const seed = this.pendingSeed;
      this.pendingSeed = null;
      this.loadRound(seed);
    }
  }

  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.readyResolvers.push(resolve));
  }

  /** Build (or rebuild) the battlefield for a seed. Safe to call pre-init. */
  loadRound(seed: number): void {
    if (!this.ready) {
      this.pendingSeed = seed;
      return;
    }
    const gen = generateTerrain(seed);
    this.mask = TerrainMask.fromHeights(gen.heights);
    this.theme = themeFor(gen.themeIndex);

    this.sky.setTheme(this.theme);
    this.clouds.setTheme(this.theme);
    this.fx.setTheme(this.theme);

    this.terrain?.destroy();
    this.terrain = new CpuTileTerrain();
    this.terrain.init(gen.heights, this.theme);

    // Rebuild layer order above the clouds.
    this.worldRoot.addChild(
      this.terrain.container,
      this.tankLayer,
      this.projectiles.container,
      this.fx.container,
      this.weather.container,
    );
    this.weather.setTheme(this.theme);
    this.fx.onTrauma = (amount) => this.shake.add(amount);
    this.projectiles.clear();
    this.fx.clear();
    for (const t of this.tanks.values()) t.container.destroy();
    this.tanks.clear();
    this.playback = null;

    this.onRoundLoaded?.({
      seed,
      macro: gen.macro,
      themeName: this.theme.name,
      weather: this.theme.weather,
      spawnX: gen.spawnX,
      heights: gen.heights,
    });
  }

  /** Create or reposition tank views to match sim state. */
  setTanks(states: TankSnapshot[]): void {
    for (const s of states) {
      let view = this.tanks.get(s.seat);
      if (!view) {
        view = new TankView(s.seat);
        this.tankLayer.addChild(view.container);
        this.tanks.set(s.seat, view);
      }
      view.setPosition(s.x, s.y);
      if (!s.alive) view.setDead();
    }
  }

  setAim(seat: Seat, angleDeg: number): void {
    this.tanks.get(seat)?.setAim(angleDeg);
  }

  /** Phone camera rests on whoever is up. */
  focusTank(seat: Seat): void {
    const t = this.tanks.get(seat);
    if (t) this.camera.setFocus(t.container.x, t.container.y);
  }

  /** Per-turn wind: drives cloud drift and weather shear. */
  setWind(wind: number): void {
    this.clouds.setWind(wind);
    this.weather.setWind(wind);
  }

  /** Visual-only carve (the sim already carved its mask before playback). */
  carveVisual(circles: readonly CarveCircle[]): void {
    this.terrain?.applyCarves(circles);
  }

  /** Play a resolved shot's event log; hooks receive state side effects. */
  playShot(events: SimEvent[], shooterSeat: Seat, hooks: ShotHooks): void {
    void shooterSeat;
    this.projHot.clear();
    this.lastTrail.clear();
    const delegate: PlaybackDelegate = {
      spawn: (id, kind: ProjectileKind, x, y) => {
        const spec = (WEAPONS as Record<string, { tier: number } | undefined>)[kind as WeaponId];
        const hot = kind === 'nukelet' || (spec?.tier ?? 0) >= 1;
        this.projHot.set(id, hot);
        if (id === 1) sfx.fire(spec?.tier ?? 0);
        this.projectiles.spawn(id, kind, x, y);
      },
      move: (id, x, y) => {
        this.projectiles.move(id, x, y);
        const now = performance.now();
        if (now - (this.lastTrail.get(id) ?? 0) > 26) {
          this.lastTrail.set(id, now);
          this.fx.trail(x, y, this.projHot.get(id) ?? false);
        }
      },
      remove: (id) => this.projectiles.remove(id),
      bounce: (x, y) => {
        this.fx.bounce(x, y);
        sfx.bounce();
      },
      explode: (x, y, r, tier) => {
        this.fx.explode(x, y, r, tier);
        sfx.explosion(tier);
        if (tier >= 4 && this.screenFlash) this.screenFlash.alpha = 0.85;
      },
      carve: (circles) => {
        this.carveVisual(circles);
        hooks.onCarve?.(circles);
      },
      fizzle: (x, y) => {
        this.fx.fizzle(x, y);
        sfx.dud();
      },
      damage: (seat, amount, direct, hpAfter) => {
        const tank = this.tanks.get(seat);
        if (tank && amount > 0) {
          this.fx.damagePopup(tank.container.x, tank.container.y - 46, amount, direct);
        }
        hooks.onDamage?.(seat, amount, direct, hpAfter);
      },
      fall: (seat, _x, fromY, toY, dmg, hpAfter) => {
        this.tanks.get(seat)?.startFall(fromY, toY);
        sfx.fall();
        if (dmg > 0) {
          const tank = this.tanks.get(seat);
          if (tank) this.fx.damagePopup(tank.container.x, toY - 46, dmg, false);
        }
        hooks.onFall?.(seat, hpAfter);
      },
      die: (seat) => {
        this.tanks.get(seat)?.setDead();
        hooks.onDie?.(seat);
      },
      done: () => {
        this.playback = null;
        hooks.onDone();
      },
    };
    this.playback = new ShotPlayback(delegate);
    this.playback.load(events);
  }

  get shotInProgress(): boolean {
    return this.playback !== null;
  }

  /**
   * Re-measure the host and re-frame everything when its size changed.
   * Polled every frame instead of trusting resize events — iOS Safari
   * delivers stale sizes around rotation, which used to leave a portrait
   * camera on a landscape screen (nothing but sky).
   */
  private syncViewport(force = false): void {
    const host = this.host;
    if (!host) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!force && w === this.lastHostW && h === this.lastHostH) return;
    if (w <= 0 || h <= 0) return;
    this.lastHostW = w;
    this.lastHostH = h;
    this.app.resize(); // let Pixi adopt the new canvas size now
    // Logical (CSS) size — renderer.width/height are PHYSICAL pixels, and
    // on a dpr>1 phone using those aims the camera off-screen (pure sky).
    const { width, height } = this.app.renderer.screen;
    this.camera.setViewport(width, height);
    this.sky.resize(width, height);
    if (this.screenFlash) {
      this.screenFlash.width = width;
      this.screenFlash.height = height;
    }
  }

  /** On phones the camera pans to the shells in flight; desktop stays wide. */
  private followInterest(): InterestBox | null {
    if (!IS_COARSE_POINTER || !this.playback) return null;
    const pts = [...this.projectiles.positions(), ...this.fx.hotPoints()];
    if (pts.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  }

  private tick(rawDt: number): void {
    const dt = Math.min(rawDt, 0.1); // clamp tab-switch jumps
    this.syncViewport();
    this.playback?.update(dt);
    if (this.screenFlash && this.screenFlash.alpha > 0) {
      this.screenFlash.alpha = Math.max(0, this.screenFlash.alpha - dt * 1.1);
    }
    for (const t of this.tanks.values()) t.update(dt);
    this.shake.update(dt, this.camera);
    this.camera.update(dt, this.followInterest());
    this.sky.update(dt, this.camera.worldLeft, this.camera.currentScale);
    this.clouds.update(dt);
    this.fx.update(dt);
    this.weather.update(dt);
  }

  destroy(): void {
    this.disposed = true;
    if (!this.ready) return;
    if (this.host && this.app.canvas?.parentElement === this.host) {
      this.host.removeChild(this.app.canvas);
    }
    this.app.destroy(true);
  }
}
