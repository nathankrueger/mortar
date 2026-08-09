import { TICK_HZ, type CarveCircle, type ProjectileKind, type Seat, type SimEvent } from '@mortar/shared';

export interface PlaybackDelegate {
  spawn(id: number, kind: ProjectileKind, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  remove(id: number): void;
  bounce(x: number, y: number): void;
  explode(x: number, y: number, r: number, tier: number): void;
  carve(circles: CarveCircle[]): void;
  fizzle(x: number, y: number): void;
  damage(seat: Seat, amount: number, direct: boolean, hpAfter: number): void;
  fall(seat: Seat, x: number, fromY: number, toY: number, dmg: number, hpAfter: number): void;
  die(seat: Seat): void;
  done(): void;
}

interface PathChunk {
  startTick: number;
  stride: number;
  xs: number[];
  ys: number[];
}

const TAIL_TICKS = 90; // linger ~0.75 s after the last event

/**
 * Replays a SimEvent log on a 120 Hz virtual clock: discrete events fire at
 * their tick, projectile positions interpolate between 30 Hz path samples.
 * The same machinery plays local shots and remote (networked) shots.
 */
export class ShotPlayback {
  private discrete: Exclude<SimEvent, { t: 'path' }>[] = [];
  private paths = new Map<number, PathChunk[]>();
  private live = new Set<number>();
  private cursor = 0;
  private tickFloat = 0;
  private lastTick = 0;
  private finished = false;

  constructor(private readonly delegate: PlaybackDelegate) {}

  load(events: SimEvent[]): void {
    for (const e of events) {
      if (e.t === 'path') {
        let list = this.paths.get(e.id);
        if (!list) this.paths.set(e.id, (list = []));
        list.push({ startTick: e.startTick, stride: e.stride, xs: e.xs, ys: e.ys });
      } else {
        this.discrete.push(e);
        this.lastTick = Math.max(this.lastTick, e.tick);
      }
    }
    this.discrete.sort((a, b) => a.tick - b.tick);
    for (const list of this.paths.values()) list.sort((a, b) => a.startTick - b.startTick);
  }

  get active(): boolean {
    return !this.finished;
  }

  update(dtSec: number): void {
    if (this.finished) return;
    this.tickFloat += dtSec * TICK_HZ;
    const tick = this.tickFloat;

    while (this.cursor < this.discrete.length && this.discrete[this.cursor].tick <= tick) {
      this.dispatch(this.discrete[this.cursor]);
      this.cursor++;
    }

    for (const id of this.live) {
      const pos = this.positionAt(id, tick);
      if (pos) this.delegate.move(id, pos.x, pos.y);
    }

    if (this.cursor >= this.discrete.length && tick > this.lastTick + TAIL_TICKS) {
      this.finished = true;
      this.delegate.done();
    }
  }

  private dispatch(e: Exclude<SimEvent, { t: 'path' }>): void {
    const d = this.delegate;
    switch (e.t) {
      case 'spawn':
        this.live.add(e.id);
        d.spawn(e.id, e.kind, e.x, e.y);
        break;
      case 'split':
        this.live.delete(e.id);
        d.remove(e.id);
        break;
      case 'bounce':
        d.bounce(e.x, e.y);
        break;
      case 'explode':
        this.live.delete(e.id);
        d.remove(e.id);
        d.explode(e.x, e.y, e.r, e.tier);
        break;
      case 'carve':
        d.carve(e.circles);
        break;
      case 'fizzle':
        this.live.delete(e.id);
        d.remove(e.id);
        d.fizzle(e.x, e.y);
        break;
      case 'damage':
        d.damage(e.seat, e.amount, e.direct, e.hpAfter);
        break;
      case 'fall':
        d.fall(e.seat, e.x, e.fromY, e.toY, e.dmg, e.hpAfter);
        break;
      case 'die':
        d.die(e.seat);
        break;
    }
  }

  private positionAt(id: number, tick: number): { x: number; y: number } | null {
    const chunks = this.paths.get(id);
    if (!chunks || chunks.length === 0) return null;
    // Find the chunk containing this tick (or the last one before it).
    let chunk = chunks[0];
    for (const c of chunks) {
      if (c.startTick <= tick) chunk = c;
      else break;
    }
    const rel = (tick - chunk.startTick) / chunk.stride;
    const i = Math.floor(rel);
    const n = chunk.xs.length;
    if (i < 0) return { x: chunk.xs[0], y: chunk.ys[0] };
    if (i >= n - 1) return { x: chunk.xs[n - 1], y: chunk.ys[n - 1] };
    const f = rel - i;
    return {
      x: chunk.xs[i] + (chunk.xs[i + 1] - chunk.xs[i]) * f,
      y: chunk.ys[i] + (chunk.ys[i + 1] - chunk.ys[i]) * f,
    };
  }
}
